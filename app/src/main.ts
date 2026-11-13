import "./styles.css";
import type { AppCtx } from "./app";
import { climbBetween, demProfile, flatProfile, gpxProfile, processProfile, type ElevationProfile } from "./elevation";
import { RideEngine, type Frame, type RideState } from "./ride/engine";
import { Ghost, pickBest } from "./ride/ghost";
import { ZONE_COLORS, ZONE_NAMES } from "./ride/metrics";
import type { RideRecord } from "./ride/types";
import { avgKmh } from "./ride/types";
import { buildApproxLoop, buildGpxRoute, buildStreetLoop, cachedStreet, fetchStreet, legAt, nextStop, wrapM, type Route } from "./route";
import { SensorHub, type SimMode } from "./sensors/hub";
import { db, persistStorage } from "./store/db";
import { loadRides, progressOf, saveRide } from "./store/rides";
import { loadSettings, maxHrOf, saveSettings, type Camera } from "./store/settings";
import { drawStageProfile } from "./ui/charts";
import { $, html, raw, sheet, toast } from "./ui/dom";
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
const engine = new RideEngine({
  input: hub,
  route: () => route,
  profile: () => profile,
  settings: () => settings,
  basePos: () => progressOf(rides, route.id) + DEV_KM * 1000,
  ghost: () => ghost,
});
const osm = new OsmTiles();
const road = new RoadView($<HTMLCanvasElement>("road"), { route: () => route, profile: () => profile, settings: () => settings, osm });
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
    h = any
      ? html`<button class="btn primary" data-c="start">Start ride</button><button class="btn ghost" data-c="add">Add sensor</button>`
      : hub.simulating
        ? html`<button class="btn primary" data-c="start">Start ride</button>`
        : html`<button class="btn primary" data-c="add">Connect sensors</button><button class="btn ghost" data-c="sim">Try a simulated ride</button>`;
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
      await db.unset("active").catch(() => {});
      await ctx.reloadRides();
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
  $("pausedOv").hidden = !(s === "paused" || s === "autopaused");
  $("pausedSub").textContent = s === "autopaused" ? "Pedal to resume" : "Tap Resume to continue";
  renderControls();
  if (s === "riding") keepAwake();
  if (s === "idle") {
    try { wake?.release(); } catch { /* ignore */ }
    wake = null;
    if (pendingRoute) { pendingRoute = null; selectRoute(true); }
  }
  setTimeout(() => { mapView.resize(); resizeRoad(); }, 40);
});
engine.on("autostart", () => toast("Ride started · pedalling detected"));
engine.on("checkpoint", (cp) => { db.set("active", cp).catch(() => {}); });
let bannerUntil = 0;
engine.on("arrival", (st) => {
  $("bName").textContent = st.name;
  $("bSub").textContent = route.loop && route.kind !== "gpx" ? `Stage ${st.stage} of ${route.legs.length} complete` : "Route complete";
  bannerUntil = performance.now() + 6000;
  audio.chime();
  if (camMode === "stage") setTimeout(() => setCam("stage"), 1500);
});

async function keepAwake() {
  try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch { /* ignore */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && engine.active) keepAwake();
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
  try { await ctx.reloadRides(); } catch (e) { console.error(e); }
  route = chooseRoute();
  profile = await loadProfile(route);
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

  // Installable app + offline cache
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
  }
}

boot();
