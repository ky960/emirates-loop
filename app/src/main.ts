import "./styles.css";
import type { AppCtx } from "./app";
import { climbBetween, demProfile, gradeAt, flatProfile, gpxProfile, processProfile, type ElevationProfile } from "./elevation";
import { RideEngine, type Frame, type RideState } from "./ride/engine";
import { Ghost, pickBest } from "./ride/ghost";
import { Pack } from "./ride/pack";
import { ChallengeRunner, fmtSecs, LANDMARK_XP, landmarkLog, localChallengeStore, planChallenges, recordLandmark, type Challenge, type Medal } from "./ride/challenges";
import { powerFor, speedFor } from "./physics";
import type { Bot } from "./ride/pack";
import { Confetti } from "./ui/confetti";
import { BURSTS, GANG, HERO_NAME, VILLAINS } from "./view/characters";
import { badges, newlyEarned, type Badge } from "./ride/badges";
import { ZONE_COLORS, ZONE_NAMES } from "./ride/metrics";
import type { RideRecord } from "./ride/types";
import { avgKmh } from "./ride/types";
import { buildApproxLoop, buildGpxRoute, buildStreetLoop, cachedStreet, fetchStreet, legAt, nextStop, wrapM, type Route } from "./route";
import { SensorHub, type SimMode } from "./sensors/hub";
import { db, persistStorage } from "./store/db";
import { loadRides, loadStartAt, resumeOf, sameRoute, saveRide, saveStartAt } from "./store/rides";
import { loadSettings, maxHrOf, saveSettings, type Camera } from "./store/settings";
import { drawStageProfile } from "./ui/charts";
import { $, html, raw, sheet, toast } from "./ui/dom";
import { icon } from "./ui/icons";
import { renderHistory } from "./ui/history";
import { renderSettings } from "./ui/settings";
import { fmtDuration, TAU } from "./util";
import { RideAudio } from "./view/audio";
import { MapView } from "./view/map";
import { OsmTiles } from "./view/osm";
import { RoadView } from "./view/road";

const VERSION = "3.0.0";
const settings = loadSettings();
const DEV_KM = +(location.hash.match(/^#km(\d+)$/)?.[1] ?? 0);

let rides: RideRecord[] = [];
let route: Route = buildApproxLoop();
let profile: ElevationProfile = flatProfile(route);
let ghost = new Ghost(null);

const hub = new SensorHub(() => ({ wheelMm: settings.wheelMm, strokeM: settings.strokeM }));
// Other cyclists on the road (fewer on the Battery preset).
const pack = new Pack(settings.quality === "battery" ? 3 : settings.quality === "balanced" ? 6 : 7, () => ({ massKg: settings.weightKg, bikeKg: 9 }));
// Mini-challenges along the route (re-planned when the route or its terrain changes). Simulated rides set no records.
const challengeStore = localChallengeStore();
let challengeKey = "", challengeList: Challenge[] = [];
const challenges = () => {
  const k = `${route.id}|${profile.source}|${Math.round(profile.gain)}`;
  if (k !== challengeKey) { challengeKey = k; challengeList = planChallenges(route, profile); }
  return settings.challenges ? challengeList : [];
};
const runner = new ChallengeRunner(challenges, () => route, {
  best: challengeStore.best,
  record: (id, kind, t, medal, xp) => { if (!engine.current.sim) { challengeStore.record(id, kind, t, medal, xp); setTimeout(checkBadges, 7500); } },
}, (c, kmh) => {
  // Pacer time: that flat-road effort on the challenge's real gradient.
  const r = { massKg: settings.weightKg, bikeKg: 9 }, v = speedFor(powerFor(kmh / 3.6, 0, r), c.avg ?? 0, r);
  return (c.m1 - c.m0) / Math.max(1, v);
});
// Your rival in a race, ridden on the road in gold.
const rivalBot: Bot = { id: 900, name: "Rival", kit: 0xffc400, m: 0, v: 0, pace: 1, lat: 0.6, crank: 0, slot: 0 };
let rivalOn = false;

// Badges: announce any newly earned (after a saved ride or a completed challenge), one banner at a time.
let knownBadges: Badge[] | null = null;
function checkBadges() {
  const now = badges(rides, route, challengeStore.log(), Date.now(), landmarkLog().map((e) => e.name));
  const fresh = knownBadges ? newlyEarned(knownBadges, now) : [];
  knownBadges = now;
  fresh.forEach((b, i) => setTimeout(() => { showBanner("Badge earned", `${b.icon} ${b.title}`, b.desc, 5000); audio.chime(); }, i * 5500));
}
const engine = new RideEngine({
  input: hub,
  route: () => route,
  profile: () => profile,
  settings: () => settings,
  basePos: () => nextStart() + DEV_KM * 1000,
  ghost: () => ghost,
  draft: (pos) => (settings.riders ? pack.draft(pos) : 0),
});
const osm = new OsmTiles(14);
// The skyline needs building heights, which only the z14 tiles carry; share one cache.
const osmFar = osm;
const road = new RoadView($<HTMLCanvasElement>("road"), { route: () => route, profile: () => profile, settings: () => settings, osm, osmFar, pack: () => [...(settings.riders ? pack.bots : []), ...(rivalOn ? [rivalBot] : [])],
  marks: () => challenges().flatMap((c) => {
    const what = c.kind === "climb" ? `CLIMB · ${(c.m1 - c.m0) >= 1000 ? ((c.m1 - c.m0) / 1000).toFixed(1) + " KM" : Math.round(c.m1 - c.m0) + " M"}` : c.kind === "sprint" ? `SPRINT · ${Math.round(c.m1 - c.m0)} M` : "HOLD IT · 60 S";
    return c.kind === "hold" ? [{ m: c.m0, label: what, finish: false }] : [{ m: c.m0, label: what, finish: false }, { m: c.m1, label: "FINISH", finish: true }];
  }) });
const mapView = new MapView($("map"), () => settings);
const audio = new RideAudio();
audio.enabled = settings.sound;
let camMode: Camera = settings.camera;
let view: "ride" | "history" | "settings" = "ride";
let wake: WakeLockSentinel | null = null;
let profileJob: AbortController | null = null;
let pendingRoute: Route | null = null;

const ctx: AppCtx = {
  settings,
  saveSettings: () => saveSettings(settings),
  get rides() { return rides; },
  set rides(v) { rides = v; },
  reloadRides: async () => {
    rides = await loadRides();
    ghost = new Ghost(pickBest(rides, settings.gradientEffect));
  },
  get route() { return route; },
  get profile() { return profile; },
  hub,
  engine,
  applyRoute: () => selectRoute(true),
  addSensor,
  startSim,
  applyQuality: () => toast("Frame rate changes now; shadows and detail change the next time the app opens.", 4000),
  info: () => ({
    scene: road.info,
    map: mapView.live ? "Live map (OpenStreetMap via OpenFreeMap)" : "Offline map (Natural Earth)",
    elevation: profile.source === "flat" ? "Loading…" : `${profile.source === "dem" ? "Terrain model" : "From your GPX"} · ${Math.round(profile.gain)} m of climbing`,
    version: VERSION,
  }),
};

// ===================== where the next ride starts =====================
/** "Continue" (the end of your last saved ride), or the start of a stage you picked in "Choose your ride". */
function nextStart(): number {
  const pick = loadStartAt(), leg = pick && sameRoute(pick.routeId, route.id) ? route.legs[pick.leg] : undefined;
  return leg ? pick!.lap * route.total + leg.m0 : resumeOf(rides, route.id);
}

/** "Choose your ride": continue where you left off, or start any stage of the journey from its beginning. */
async function chooseStart() {
  if (engine.active || !$("sheet").hidden) return; // a ride is on, or another question is showing
  const cont = resumeOf(rides, route.id), lapBase = route.loop ? Math.floor(cont / route.total) * route.total : 0;
  const lapPos = cont - lapBase, here = legAt(route, cont), pick = loadStartAt();
  const picked = pick && sameRoute(pick.routeId, route.id) ? pick.leg : -1;
  const km = (m: number) => (m / 1000).toFixed(1);
  const climb = (l: (typeof route.legs)[number]) => (profile.source !== "flat" ? ` · ↑ ${Math.round(climbBetween(profile, route.total, l.m0, l.m1))} m` : "");
  const act = await sheet(html`
    <h2>Choose your ride</h2>
    <p class="muted">${route.name} · ${km(route.total)} km in ${route.legs.length} stage${route.legs.length > 1 ? "s" : ""}${route.loop && cont >= route.total ? ` · lap ${Math.floor(cont / route.total) + 1}` : ""}</p>
    <div class="rideas">
      <span class="label">Ride as</span>
      <button class="btn sm ${settings.hero ? "ghost" : "primary"}" data-act="as:cyclist">🚴 Cyclist</button>
      <button class="btn sm hero ${settings.hero ? "primary" : "ghost"}" data-act="as:hero">🦅 ${HERO_NAME}</button>
      <small class="muted">${settings.hero ? "Night falls, the falcon signal lights the sky, and the villains are out." : "Ride as a masked night hero against comic villains."}</small>
    </div>
    <button class="btn primary continue" data-act="continue">
      <span>${cont > 0 ? "Continue" : "Start the journey"}</span>
      <small>${cont > 0 ? `${here.from} → ${here.to} · ${km(cont - lapBase - here.m0)} of ${km(here.m1 - here.m0)} km` : `${route.legs[0].from} → ${route.legs[0].to}`}</small>
    </button>
    <div class="legs stages">${route.legs.map((l, i) => {
      const f = Math.min(1, Math.max(0, (lapPos - l.m0) / (l.m1 - l.m0))), cls = f >= 1 ? "done" : f > 0 ? "here" : "";
      return html`<div class="leg ${cls}${i === picked ? " picked" : ""}"><span class="dot"></span>
        <div style="min-width:0"><b>Stage ${i + 1} · ${l.from} → ${l.to}</b><span class="sub">${km(l.m1 - l.m0)} km${climb(l)}</span><div class="bar"><div style="width:${(f * 100).toFixed(1)}%"></div></div></div>
        <button class="btn sm ${i === picked ? "primary" : "ghost"}" data-act="stage:${i}">${i === picked ? "Chosen" : "Start here"}</button></div>`;
    })}</div>
    <p class="muted" style="font-size:14px">Rides always count toward your history. After a ride you saved, "Continue" picks up where it ended.</p>`);
  if (act?.startsWith("as:")) { setHero(act === "as:hero"); return chooseStart(); }
  if (act === "continue") {
    saveStartAt(null);
    toast(cont > 0 ? `Continuing ${here.from} → ${here.to}` : `Starting ${route.legs[0].from} → ${route.legs[0].to}`);
  } else if (act?.startsWith("stage:")) {
    const l = route.legs[+act.slice(6)];
    saveStartAt({ routeId: route.id, leg: +act.slice(6), lap: route.loop ? Math.round(lapBase / route.total) : 0 });
    toast(`Next ride starts at the beginning of ${l.from} → ${l.to}`);
  }
}

// ===================== night-hero mode =====================
/** Switch the Shadow Falcon mode on or off: your rider, the villains, the challenge rivals and the night. */
function setHero(on: boolean) {
  settings.hero = on;
  saveSettings(settings);
  applyHero();
}
function applyHero() {
  const on = settings.hero;
  pack.cast(on ? {
    solo: VILLAINS.map((v) => ({ name: v.name, kit: v.look.suit, look: v.look })),
    group: { names: ["Sandstorm's goon", "Dusty", "Grit"], kit: GANG.look.suit, look: { ...GANG.look, head: "hood" } },
  } : null);
  runner.pacers = on ? VILLAINS.map((v) => v.name) : ["Rashid", "Mariam", "Saeed", "Hessa", "Majid", "Shamma"];
  document.body.classList.toggle("hero", on);
}
const villainOf = (name: string) => VILLAINS.find((v) => v.name === name);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
/** A comic-book sound burst on screen. */
function burst(word = pick(BURSTS)) {
  const el = $("comic");
  el.textContent = word;
  el.style.setProperty("--rot", `${Math.round((Math.random() - 0.5) * 24)}deg`);
  el.style.left = `${30 + Math.random() * 40}%`;
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
}
// Villains taunt you when they pass and complain when you pass them (once a minute at most).
const passSide = new Map<number, number>();
let lastTaunt = 0;
function villainBanter(f: Frame) {
  if (!settings.hero || !settings.riders || f.state !== "riding") { passSide.clear(); return; }
  const now = performance.now();
  for (const b of pack.bots) {
    const gap = b.m - f.pos, side = Math.sign(gap), prev = passSide.get(b.id);
    passSide.set(b.id, side);
    if (prev === undefined || prev === side || Math.abs(gap) > 12 || now - lastTaunt < 45000) continue;
    const v = villainOf(b.name);
    lastTaunt = now;
    if (side < 0) { burst(); toast(`${b.name}: “${v ? pick(v.beaten) : "Nooo!"}”`, 3200); audio.whoosh(); }
    else toast(`${b.name}: “${v ? pick(v.taunts) : "Too slow!"}”`, 3200);
  }
}

// ===================== route & elevation =====================
function chooseRoute(): Route {
  if (settings.gpx && settings.gpx.pts.length > 1) return buildGpxRoute(settings.gpx);
  const sc = cachedStreet();
  if (sc) { try { return buildStreetLoop(sc); } catch { /* fall through */ } }
  return buildApproxLoop();
}

async function loadProfile(r: Route): Promise<ElevationProfile> {
  const g = gpxProfile(r);
  if (g) return g;
  try {
    const c = await db.get<{ step: number; raw: Float32Array; loop: boolean }>(`profile2:${r.id}`);
    if (c?.raw?.length) return processProfile(c.raw, c.step, c.loop, "dem");
  } catch { /* none cached */ }
  return flatProfile(r);
}

/** Fetch real elevation in the background and switch to it when ready. */
function fetchElevation(r: Route) {
  if (profile.source !== "flat") return;
  profileJob?.abort();
  const ac = new AbortController();
  profileJob = ac;
  demProfile(r, undefined, ac.signal)
    .then(async (p) => {
      if (ac.signal.aborted || r !== route) return;
      if (p.max - p.min < 1) return; // nothing usable came back; try again next launch
      profile = p;
      try { await db.set(`profile2:${r.id}`, { step: p.step, raw: p.ele, loop: p.loop }); } catch { /* ignore */ }
      toast(`Real gradients loaded · ${Math.round(p.gain).toLocaleString()} m of climbing on this route`);
    })
    .catch(() => { /* offline: stay flat, try again next launch */ });
}

async function selectRoute(force = false) {
  const next = chooseRoute();
  if (!force && next.id === route.id) return;
  if (engine.active) { pendingRoute = next; return; }
  route = next;
  profile = await loadProfile(route);
  knownBadges = badges(rides, route, challengeStore.log(), Date.now(), landmarkLog().map((e) => e.name)); // stage ends moved with the route: re-baseline quietly
  mapView.setRoute(route);
  fetchElevation(route);
  setCam(camMode);
}

// ===================== sensors =====================
async function addSensor() {
  audio.unlock();
  try {
    await hub.add();
    const list = hub.list().filter((s) => !s.sim);
    settings.sensors = list.map((s) => ({ id: s.id, name: s.name }));
    saveSettings(settings);
    toast("Sensor connected");
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err?.name === "NotFoundError") return;
    const last = hub.list().find((s) => s.note);
    toast(last?.note || err?.message || "Couldn't connect to the sensor", 5000);
  }
}

function startSim(mode: SimMode) {
  audio.unlock();
  hub.startSim(mode);
  hub.simTarget.kmh = +$<HTMLInputElement>("simSpd").value;
  document.body.classList.add("sim");
  $("simBar").hidden = false;
  if (view !== "ride") show("ride");
  setTimeout(() => { mapView.resize(); resizeRoad(); }, 50);
}

function stopSim() {
  if (engine.active && engine.isSim) engine.discard();
  hub.stopSim();
  document.body.classList.remove("sim");
  $("simBar").hidden = true;
  setTimeout(() => { mapView.resize(); resizeRoad(); }, 50);
}

hub.on("change", () => { renderPills(); renderControls(); if (view === "settings") renderSettings($("v-settings"), ctx); });

function renderPills() {
  const list = hub.list();
  const el = $("pills");
  if (!list.length) { el.innerHTML = html`<span class="pill"><i></i>No sensors</span>`.s; return; }
  const label = (k: string[]) => k.map((x) => ({ speed: "Speed", cadence: "Cadence", hr: "Heart rate", trainer: "Trainer" })[x] ?? x).join(" + ");
  el.innerHTML = list.map((s) => {
    const cls = s.sim ? "sim" : s.status === "connected" ? "on" : "wait";
    const what = s.kinds.length ? label(s.kinds) : s.name;
    return html`<span class="pill ${cls}" title="${s.name}"><i></i>${what}${s.status !== "connected" ? " · reconnecting" : ""}</span>`.s;
  }).join("");
  // In-ride warning when a sensor drops out
  const lost = list.filter((s) => s.status !== "connected");
  const chip = $("sensorChip");
  chip.hidden = !lost.length;
  if (lost.length) chip.textContent = `${lost.map((s) => s.name).join(", ")} reconnecting…`;
}

// ===================== ride controls =====================
function renderControls() {
  const c = $("controls"), st = engine.state, any = hub.hasAnySource();
  let h;
  if (st === "idle") {
    const stages = html`<button class="btn ghost" data-c="stages">Stages</button>`;
    h = any
      ? html`<button class="btn primary" data-c="start">Start ride</button><button class="btn ghost" data-c="add">Add sensor</button>${stages}`
      : hub.simulating
        ? html`<button class="btn primary" data-c="start">Start ride</button>${stages}`
        : html`<button class="btn primary" data-c="add">Connect sensors</button><button class="btn ghost" data-c="sim">Try a simulated ride</button>${stages}`;
  } else if (st === "riding") {
    h = html`<button class="btn" data-c="pause">Pause</button><button class="btn primary" data-c="finish">Finish</button>`;
  } else {
    h = html`<button class="btn primary" data-c="resume">Resume</button><button class="btn" data-c="finish">Finish</button>`;
  }
  c.innerHTML = h.s;
  $("who").textContent = settings.name ? `${settings.name}'s rides` : "Indoor ride tracker";
}

$("controls").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-c]");
  if (!b) return;
  audio.unlock();
  const a = b.dataset.c;
  if (a === "add") addSensor();
  else if (a === "sim") startSim("speed+hr");
  else if (a === "stages") chooseStart();
  else if (a === "start") engine.start();
  else if (a === "pause") engine.pause();
  else if (a === "resume") engine.resume();
  else if (a === "finish") askFinish();
});

async function askFinish() {
  const prevState = engine.state;
  engine.pause();
  const r = engine.preview();
  if (!r) { engine.discard(); return; }
  const sim = r.sources.includes("sim");
  const zones = r.avgBpm ? zoneBar(r.zones) : "";
  const act = await sheet(html`
    <h2>${sim ? "Simulated ride" : "Save this ride?"}</h2>
    <div class="kv">
      <div><span class="label">Distance</span><b>${(r.dist / 1000).toFixed(2)} km</b></div>
      <div><span class="label">Time</span><b>${fmtDuration(r.moving)}</b></div>
      <div><span class="label">Avg speed</span><b>${avgKmh(r).toFixed(1)} km/h</b></div>
      <div><span class="label">Climbing</span><b>${r.climb} m</b></div>
      ${r.avgBpm ? html`<div><span class="label">Avg heart rate</span><b>${r.avgBpm} bpm</b></div>` : ""}
      <div><span class="label">Calories</span><b>${r.kcal} kcal</b></div>
    </div>
    ${zones ? html`<div class="zones">${raw(zones)}</div>` : ""}
    ${sim ? html`<p class="muted">Simulated rides aren't saved, so they never count toward your progress or records.</p>` : ""}
    ${r.dist < 50 ? html`<p class="muted">Too short to save.</p>` : ""}
    <div class="acts">
      ${!sim && r.dist >= 50 ? html`<button class="btn primary" data-act="save">Save ride</button>` : ""}
      <button class="btn danger" data-act="discard">Discard</button>
      <button class="btn ghost" data-act="keep">Keep riding</button>
    </div>`, { dismissable: false });
  if (act === "save") {
    const rec = engine.finish();
    if (rec) {
      const prevBest = pickBest(rides, rec.gradientEffect);
      await saveRide(rec);
      saveStartAt(null); // "Continue" now picks up where this ride ended
      await db.unset("active").catch(() => {});
      await ctx.reloadRides();
      setTimeout(checkBadges, 4500);
      const pr = rec.moving >= 600 && (!prevBest || avgKmh(rec) > avgKmh(prevBest));
      toast(pr ? `Saved · new best average ${avgKmh(rec).toFixed(1)} km/h` : `Saved ${(rec.dist / 1000).toFixed(2)} km`, 4000);
    }
  } else if (act === "discard") {
    engine.discard();
    await db.unset("active").catch(() => {});
    toast("Ride discarded");
  } else {
    if (prevState !== "paused") engine.resume();
  }
}

function zoneBar(z: number[]): string {
  const total = z.slice(1).reduce((a, b) => a + b, 0) || 1;
  return z.map((s, i) => (i && s ? `<i style="width:${((s / total) * 100).toFixed(1)}%;background:${ZONE_COLORS[i]}" title="Z${i} ${ZONE_NAMES[i]}"></i>` : "")).join("");
}

engine.on("state", (s: RideState) => {
  document.body.classList.toggle("riding", s !== "idle");
  document.body.classList.toggle("paused", s === "paused" || s === "autopaused");
  $("pausedOv").hidden = !(s === "paused" || s === "autopaused");
  $("pausedSub").textContent = s === "autopaused" ? "Pedal to resume" : "Tap Resume to continue";
  renderControls();
  if (s === "riding") keepAwake();
  if (s === "idle") {
    runner.reset(); // a new ride: every challenge is on offer again
    try { wake?.release(); } catch { /* ignore */ }
    wake = null;
    if (pendingRoute) { pendingRoute = null; selectRoute(true); }
  }
  setTimeout(() => { mapView.resize(); resizeRoad(); }, 40);
});
engine.on("autostart", () => toast("Ride started · pedalling detected"));
engine.on("checkpoint", (cp) => { db.set("active", cp).catch(() => {}); });
let bannerUntil = 0;
function showBanner(label: string, big: string, sub: string, ms = 5000, fact = "") {
  $("bFact").hidden = !fact;
  $("bFact").textContent = fact;
  $("banner").classList.toggle("withfact", !!fact);
  $("bLbl").textContent = label;
  $("bName").textContent = big;
  $("bSub").textContent = sub;
  $("bSub").hidden = !sub;
  bannerUntil = performance.now() + ms;
}
// Landmarks: an arrival moment with a fact, a little celebration and XP (once per landmark per day on real rides).
engine.on("landmark", (pl) => {
  const today = new Date().toDateString(), seenToday = landmarkLog().some((e) => e.name === pl.name && new Date(e.at).toDateString() === today);
  const real = !engine.current.sim, xp = real && !seenToday;
  showBanner("Now passing", `${pl.icon ?? "📍"} ${pl.name}`, xp ? `+${LANDMARK_XP} XP` : pl.ar ?? "", 9000, pl.fact ?? "");
  if (pl.ar && xp) { const s2 = $("bSub"); s2.textContent = `${pl.ar} · +${LANDMARK_XP} XP`; }
  audio.chime();
  confetti.burst(70, ["#c8873a", "#f2d6a2", "#ffffff", "#00732f", "#ff0000"]);
  if (settings.hero) burst("ZOOM!");
  if (real) { recordLandmark(pl.name); setTimeout(checkBadges, 9500); }
});
engine.on("arrival", (st) => {
  $("bLbl").textContent = "Now arriving"; $("bSub").hidden = false; $("bFact").hidden = true;
  $("bName").textContent = st.name;
  $("bSub").textContent = route.loop && route.kind !== "gpx" ? `Stage ${st.stage} of ${route.legs.length} complete` : "Route complete";
  bannerUntil = performance.now() + 6000;
  audio.chime();
  if (camMode === "stage") setTimeout(() => setCam("stage"), 1500);
});

async function keepAwake() {
  try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch { /* ignore */ }
}
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") hiddenAt = Date.now();
  if (document.visibilityState === "visible" && engine.active) keepAwake();
  // An installed app is usually resumed rather than restarted: after a break, ask where to ride again.
  if (document.visibilityState === "visible" && !engine.active && hiddenAt && Date.now() - hiddenAt > 10 * 60_000) chooseStart();
  engine.update();
});

// ===================== camera & layout =====================
function setCam(c: Camera) {
  camMode = c;
  if (c === "road" && !road.ready) camMode = c = "map";
  settings.camera = c;
  saveSettings(settings);
  document.querySelectorAll<HTMLElement>("[data-cam]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cam === c)));
  $("stage").classList.toggle("roadmode", c === "road");
  mapView.setCamera(c, engine.current.pos);
  setTimeout(() => { mapView.resize(); resizeRoad(); }, 40);
}
document.querySelectorAll<HTMLElement>("[data-cam]").forEach((b) => b.addEventListener("click", () => setCam(b.dataset.cam as Camera)));

function resizeRoad() {
  const r = $("stage").getBoundingClientRect();
  road.resize(r.width, r.height);
}
new ResizeObserver(() => { mapView.resize(); resizeRoad(); }).observe($("stage"));

function show(v: typeof view) {
  view = v;
  for (const x of ["ride", "history", "settings"] as const) {
    $(`v-${x}`).hidden = x !== v;
    $(`t-${x}`).setAttribute("aria-selected", String(x === v));
  }
  if (v === "history") renderHistory($("v-history"), ctx);
  if (v === "settings") renderSettings($("v-settings"), ctx);
  if (v === "ride") setTimeout(() => { mapView.resize(); resizeRoad(); }, 30);
}
document.querySelectorAll<HTMLElement>("nav.tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.v as typeof view)));

const simSpd = $<HTMLInputElement>("simSpd");
simSpd.addEventListener("input", () => { hub.simTarget.kmh = +simSpd.value; $("simOut").textContent = `${(+simSpd.value).toFixed(1)} km/h`; });
$("simStop").addEventListener("click", stopSim);
document.addEventListener("pointerdown", () => audio.unlock(), { once: true });
document.addEventListener("el:sound", (e) => audio.setEnabled((e as CustomEvent<boolean>).detail));
document.addEventListener("el:terrain", () => mapView.applyTerrain());
document.addEventListener("el:hero", () => applyHero());

// ===================== challenges =====================
let chalStatus: ReturnType<ChallengeRunner["update"]>["status"] = null, lastTimer = 0, nextBeat = 0;
const confetti = new Confetti($<HTMLCanvasElement>("confetti"));
const MEDAL = { gold: ["Gold", "#E3C068", 3], silver: ["Silver", "#C9CED6", 2], bronze: ["Bronze", "#C98C5A", 1] } as const;
/** Target line for the segment that is coming up or running (shown under its name). */
let segNote = "", segAvg = "";
const kindName = (c: Challenge) => (c.kind === "climb" ? "Climb" : c.kind === "sprint" ? "Sprint" : "Hold");

function countdown(n: number) {
  const el = $("count");
  el.textContent = n > 0 ? `Starts in ${n}` : "Go";
  el.classList.toggle("go", n === 0);
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  audio.countdown(n);
}

/** Result of a segment: a short, quiet card with the time and how it compares. */
function celebrate(medal: Medal, kind: string, time: string, note: string) {
  const [label, col, lvl] = MEDAL[medal];
  const m = $("medal");
  m.style.setProperty("--medal", col);
  $("medalKind").textContent = `${kind} · ${label}`;
  $("medalTime").textContent = time;
  $("medalNote").textContent = engine.current.sim ? `${note} · simulated, not saved` : note;
  m.hidden = false;
  clearTimeout(resTimer);
  resTimer = setTimeout(() => (m.hidden = true), 4500);
  if (settings.hero) { burst(medal === "gold" ? "KAPOW!" : medal === "silver" ? "WHAM!" : "BAM!"); setTimeout(() => burst(), 650); }
  audio.fanfare(lvl);
  road.celebrate(4);
}
let resTimer: ReturnType<typeof setTimeout> | undefined;

function challengeFrame(_dt: number, f: Frame) {
  // Time challenges by the ride clock, not frame time: right even when frames are slow or the app is in the background.
  const dt = Math.max(0, Math.min(5, f.timer - lastTimer));
  lastTimer = f.timer;
  const { events, status } = runner.update(dt, { pos: f.pos, kmh: f.kmh, rpm: f.rpm, riding: f.state === "riding" });
  chalStatus = status;
  const live = status?.live;
  // Rival on the road, racing you.
  rivalOn = !!live?.rivalM;
  if (live?.rivalM !== undefined) {
    const v = settings.hero ? villainOf(rivalBot.name) ?? VILLAINS[1] : undefined;
    rivalBot.look = v?.look; rivalBot.kit = v ? v.look.suit : 0xffc400;
    const was = rivalBot.m;
    rivalBot.m = live.rivalM;
    rivalBot.v = Math.max(0, Math.min(25, (rivalBot.m - was) / Math.max(1 / 60, _dt)));
    rivalBot.crank += ((80 + rivalBot.v * 1.2) / 60) * TAU * _dt;
  }
  $("stage").classList.toggle("racing", !!live);
  road.raceBoost = live && status!.c.kind !== "hold" ? 1 : 0;
  // Heartbeat, quicker towards the finish.
  if (live) {
    const now = performance.now(), period = 1000 - live.urgency * 520;
    if (now > nextBeat) { nextBeat = now + period; audio.pulse(live.urgency); }
  }
  for (const e of events) {
    const kind = kindName(e.c);
    if (e.type === "finish" || e.type === "done" || e.type === "fail") segNote = segAvg = "";
    if (e.type === "approach") {
      const r = e.rival;
      segAvg = e.c.kind === "climb" ? `${Math.round((e.c.avg ?? 0) * 100)} % avg` : "";
      segNote = [segAvg, e.target ?? (r ? (r.isBest ? `Your best ${fmtSecs(r.time)}` : `${r.name} ${fmtSecs(r.time)}`) : "")].filter(Boolean).join(" · ");
      audio.countdown(3);
    } else if (e.type === "countdown") countdown(e.n);
    else if (e.type === "start") {
      countdown(0);
      rivalBot.name = e.rival ? (e.rival.isBest ? (settings.hero ? "The Mirage" : "Rival") : e.rival.name) : "Rival";
      segNote = e.target ?? "";
    } else if (e.type === "overtake") {
      const v = settings.hero ? villainOf(rivalBot.name) : undefined;
      if (e.ahead) { audio.whoosh(); if (settings.hero) burst(); if (v) toast(`${v.name}: “${pick(v.beaten)}”`, 2200); }
      else if (v) toast(`${v.name}: “${pick(v.taunts)}”`, 2200);
    } else if (e.type === "finish") {
      const r = e.rival, d = r ? e.time - r.time : 0;
      const note = r ? (d <= 0 ? `${r.isBest ? "New best" : `Beat ${r.name}`} by ${Math.abs(d).toFixed(1)} s` : `${d.toFixed(1)} s behind ${r.isBest ? "your best" : r.name}`) : e.c.name;
      celebrate(e.medal, kind, fmtSecs(e.time), note);
    } else if (e.type === "done") {
      celebrate(e.medal, kind, "60 s", `${e.target}${e.medal === "gold" ? " · no breaks" : ""}`);
    } else if (e.type === "fail") toast(`${kind} called off · ${e.why.toLowerCase()}`);
  }
}

// ===================== HUD =====================
let lastHud = 0, lastProfile = 0, lastNext = 0, nextCache = { name: "", lbl: "", sub: "" };
function hud(f: Frame, now: number) {
  if (now - lastHud < 150) return;
  lastHud = now;
  $("hSpd").textContent = f.kmh.toFixed(1);
  $("hCad").textContent = f.rpm !== null ? String(Math.round(f.rpm)) : "—";
  const hasHr = hub.has("hr");
  $("hrCell").hidden = !hasHr;
  if (hasHr) {
    $("hHr").textContent = f.bpm ? String(f.bpm) : "—";
    $("hZone").textContent = f.bpm ? `Z${f.zone}` : "";
    const bar = $("hZoneBar");
    bar.style.width = f.bpm ? `${Math.min(100, (f.bpm / maxHrOf(settings)) * 100)}%` : "0";
    bar.style.background = ZONE_COLORS[f.zone];
    $("hZone").style.color = ZONE_COLORS[f.zone];
  }
  const g = f.grade * 100;
  $("hGrade").textContent = `${g > 0.05 ? "+" : ""}${g.toFixed(1)}`;
  $("hGrade").style.color = g > 6 ? "#FF8A7A" : g > 3 ? "#FFC58A" : "";
  const pw = f.watts !== null;
  $("pwCell").hidden = !pw;
  if (pw) { $("hPw").textContent = String(f.watts); $("pwLbl").textContent = f.wattsEstimated ? "Est. power" : "Power"; }
  $("hKm").textContent = (f.dist / 1000).toFixed(2);
  $("hTime").textContent = fmtDuration(f.timer);
  // ghost
  $("ghostChip").hidden = !f.ghostOn;
  if (f.ghostOn) {
    const gap = f.ghostGap, a = Math.abs(gap);
    $("ghostTxt").textContent = gap >= 0 ? "Ghost ahead" : "You lead";
    $("ghostVal").textContent = `${gap >= 0 ? "+" : "−"}${a < 1000 ? a.toFixed(0) + " m" : (a / 1000).toFixed(2) + " km"}`;
  }
  // Other riders: slipstream, or who's next up the road.
  const draft = settings.riders ? pack.draft(f.pos) : 0, next = settings.riders ? pack.ahead(f.pos, 400) : null;
  const pc = $("packChip");
  pc.hidden = !(draft > 0.02 || next);
  pc.classList.toggle("draft", draft > 0.02);
  if (draft > 0.02) { $("packTxt").textContent = "Slipstream"; $("packVal").textContent = `−${Math.round(draft * 100)}% drag`; }
  else if (next) { $("packTxt").textContent = `${next.bot.name} ahead`; $("packVal").textContent = `${Math.round(next.gap)} m`; }
  const nb = draft > 0.02 ? pack.ahead(f.pos, 7) : next;
  if (nb) $("packDot").style.setProperty("--kit", "#" + nb.bot.kit.toString(16).padStart(6, "0"));
  const cs = chalStatus, cc = $("chalChip"), lv = cs?.live, race = $("race");
  cc.hidden = !cs || !!lv;
  race.hidden = !lv;
  if (lv && cs) {
    race.classList.toggle("hold", cs.c.kind === "hold");
    race.classList.toggle("off", lv.holdOn === false);
    race.classList.toggle("ahead", lv.gap !== undefined && lv.gap < 0);
    race.classList.toggle("behind", lv.gap !== undefined && lv.gap > 0);
    if (race.dataset.kind !== cs.c.kind) { race.dataset.kind = cs.c.kind; $("raceIco").innerHTML = icon(cs.c.kind === "climb" ? "mountain" : cs.c.kind === "sprint" ? "bolt" : "gauge", 16); }
    $("raceName").textContent = cs.label;
    $("raceGap").textContent = lv.gap !== undefined ? `${lv.gap <= 0 ? "−" : "+"}${Math.abs(lv.gap).toFixed(1)} s` : cs.value;
    $("raceFill").style.width = `${(lv.progress * 100).toFixed(1)}%`;
    const rv = $("raceRival");
    rv.hidden = lv.rivalM === undefined;
    if (lv.rivalM !== undefined) rv.style.left = `${Math.min(100, ((lv.rivalM - (route.loop ? Math.floor(lv.rivalM / route.total) * route.total : 0) - cs.c.m0) / (cs.c.m1 - cs.c.m0)) * 100).toFixed(1)}%`;
    $("raceSub").textContent = cs.sub ?? "";
    $("raceVs").textContent = lv.gap !== undefined ? (rivalBot.name === "Rival" || rivalBot.name === "The Mirage" ? "vs best" : `vs ${rivalBot.name}`) : cs.c.kind === "hold" ? "left" : "";
    $("raceAux").textContent = segAvg;
  }
  if (cs && !lv) { $("chalTxt").textContent = cs.label; $("chalVal").textContent = cs.value; const sub = cs.sub ?? segNote; $("chalSub").textContent = sub; $("chalSub").hidden = !sub; }
  $("simChip").hidden = !f.sim;
  $("banner").classList.toggle("on", now < bannerUntil);
  // next stop card (every 2 s: includes a climb calculation)
  if (now - lastNext > 2000) {
    lastNext = now;
    const lm = wrapM(route, f.pos), leg = legAt(route, f.pos), { stop, dist } = nextStop(route, f.pos);
    const poi = route.places.find((p) => p.kind === "poi" && p.m !== undefined && p.m > lm + 50 && p.m < leg.m1);
    const climb = profile.source !== "flat" ? climbBetween(profile, route.total, lm, lm + dist) : 0;
    const climbTxt = climb > 30 ? ` · ↑ ${Math.round(climb)} m` : "";
    nextCache = poi
      ? { lbl: "Next landmark", name: poi.name, sub: `${((poi.m! - lm) / 1000).toFixed(1)} km · ${stop.name} in ${(dist / 1000).toFixed(1)} km${climbTxt}` }
      : { lbl: route.kind === "gpx" ? "To the finish" : "Next stop", name: stop.name, sub: `${(dist / 1000).toFixed(1)} km${climbTxt}` };
    $("nextLbl").textContent = nextCache.lbl;
    $("nextName").textContent = nextCache.name;
    $("nextSub").textContent = nextCache.sub;
  }
  if (now - lastProfile > 500) {
    lastProfile = now;
    const leg = legAt(route, f.pos);
    $("pFrom").textContent = leg.from;
    $("pTo").textContent = leg.to;
    const pois = route.places.filter((p) => p.kind === "poi" && p.m !== undefined).map((p) => ({ name: p.name, m: p.m! }));
    drawStageProfile($<HTMLCanvasElement>("profileCv"), route, profile, leg, f.pos, f.ghostOn ? f.ghostPos : null, pois);
  }
}

// ===================== main loop =====================
let crank = 0, lastFrame = performance.now(), lastRender = 0;
function loop(now: number) {
  requestAnimationFrame(loop);
  const cap = settings.quality === "battery" ? 30 : settings.quality === "balanced" ? 60 : 0;
  if (cap && now - lastRender < 1000 / cap - 2) return;
  lastRender = now;
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const f = engine.update();
  crank += (f.animRpm / 60) * TAU * dt;
  if (settings.riders) pack.update(dt, f.pos, f.kmh, f.state === "riding", (m) => gradeAt(profile, route.total, m));
  challengeFrame(dt, f);
  villainBanter(f);
  if (view === "ride") {
    if (camMode === "road" && road.ready) { try { road.render(f, dt, crank); } catch (e) { console.error(e); } }
    mapView.update(f, dt, crank, now);
    hud(f, now);
  }
  const coasting = f.state === "riding" && f.kmh > 4 && (f.rpm === 0 || (f.sensorKmh < 1 && f.kmh > 4));
  audio.update(dt, f.state === "idle" ? 0 : f.kmh, coasting);
}
// Keep the ride clock right even when the screen is off or the tab is in the background.
setInterval(() => { if (document.hidden) engine.update(); }, 1000);

// ===================== boot =====================
async function boot() {
  persistStorage();
  renderPills();
  renderControls();
  // Installable app + offline cache: register first so a new version arrives (and reloads) before you've chosen anything.
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
  }
  try { await ctx.reloadRides(); } catch (e) { console.error(e); }
  route = chooseRoute();
  profile = await loadProfile(route);
  checkBadges(); // what you've already earned, so only new ones are announced
  applyHero();
  openingQuestions(); // straight away, not after the map has loaded
  $("loadingTxt").textContent = "Loading the map…";
  try {
    await mapView.init(route);
  } catch (e) {
    console.error(e);
    $("loadingTxt").textContent = "The map couldn't start on this device (WebGL is needed).";
    return;
  }
  $("attr").textContent = mapView.attribution;
  road.init();
  resizeRoad();
  setCam(camMode);
  $("loading").hidden = true;
  requestAnimationFrame(loop);

  // Background work after first paint
  if (!settings.gpx && route.kind !== "street") {
    fetchStreet().then((c) => { if (c && !settings.gpx) { selectRoute(true).then(() => toast("Street-accurate route loaded")); } });
  }
  fetchElevation(route);
  hub.restore(settings.sensors.map((s) => s.id));
  if (!hub.supported) toast("This browser has no Bluetooth. Use Chrome on Android to connect sensors.", 6000);

}

/** On opening: offer to finish an interrupted ride, otherwise ask where to ride. Runs while the map loads behind. */
async function openingQuestions() {
  // Unfinished ride from a reload or crash?
  try {
    const cp = await db.get<{ v: number; acc: { dist: number; timer: number; startWall: number; sim: boolean }; routeId: string; savedAt: number }>("active");
    if (cp?.acc && cp.acc.dist > 50 && !cp.acc.sim) {
      const when = new Date(cp.acc.startWall).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
      const act = await sheet(html`
        <h2>Unfinished ride</h2>
        <p>${when} · ${(cp.acc.dist / 1000).toFixed(2)} km in ${fmtDuration(cp.acc.timer)}. The app closed before it was saved.</p>
        <div class="acts"><button class="btn primary" data-act="resume">Resume</button><button class="btn" data-act="save">Save it</button><button class="btn danger" data-act="discard">Discard</button></div>`, { dismissable: false });
      if (act === "discard") await db.unset("active");
      else {
        engine.restore(cp as never);
        if (act === "save") await askFinish();
        else toast("Ride restored · start pedalling to continue");
      }
    } else if (cp) await db.unset("active");
  } catch { /* ignore */ }
  // Ask where to ride, unless an unfinished ride was just restored.
  if (!engine.active) await chooseStart();
}

boot();
