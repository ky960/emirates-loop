import type { AppCtx } from "../app";
import { download, rideToTcx } from "../export/tcx";
import { badges, streak, type Badge } from "../ride/badges";
import { landmarkLog, localChallengeStore } from "../ride/challenges";
import { fitnessSeries, formLabel } from "../ride/fitness";
import { ZONE_COLORS, ZONE_NAMES } from "../ride/metrics";
import type { RideRecord } from "../ride/types";
import { avgKmh } from "../ride/types";
import { legAt, pointAt, type Route } from "../route";
import { deleteRide, progressOf, sameRoute } from "../store/rides";
import { fmtDuration, fmtShortDuration } from "../util";
import { drawFitness, drawRideChart, drawWeekly } from "./charts";
import { html, raw, sheet, toast } from "./dom";
import { badgeIcon, icon } from "./icons";

type Period = "week" | "month" | "year";
let period: Period = "week";
let showAll = false;
const ROWS = 8;

/** Fastest time (s) to cover `meters` within a ride, from its 1 Hz samples. */
function fastest(r: RideRecord, meters: number): number | null {
  const s = r.samples;
  if (!s || s.d.length < 2 || s.d[s.d.length - 1] < meters) return null;
  let best = Infinity, j = 0;
  for (let i = 0; i < s.d.length; i++) {
    while (j < s.d.length && s.d[j] - s.d[i] < meters) j++;
    if (j >= s.d.length) break;
    best = Math.min(best, s.t[j] - s.t[i]);
  }
  return isFinite(best) ? best : null;
}

/** Start of the current and previous period (local time). */
function windows(p: Period, now = new Date()): { from: number; prev: number; label: string } {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  if (p === "week") { const dow = (now.getDay() + 6) % 7, from = new Date(y, m, d - dow).getTime(); return { from, prev: new Date(y, m, d - dow - 7).getTime(), label: "Last week" }; }
  if (p === "month") return { from: new Date(y, m, 1).getTime(), prev: new Date(y, m - 1, 1).getTime(), label: "Last month" };
  return { from: new Date(y, 0, 1).getTime(), prev: new Date(y - 1, 0, 1).getTime(), label: "Last year" };
}

const sum = (rs: RideRecord[], f: (r: RideRecord) => number) => rs.reduce((a, r) => a + f(r), 0);
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** "Stage 1 · Abu Dhabi → Dubai" when the ride was on the current route, else the saved route name. */
function rideName(r: RideRecord, route: Route): string {
  if (!sameRoute(route.id, r.routeId) || !route.legs.length) return r.routeName || "Free ride";
  const leg = legAt(route, r.startM), i = route.legs.indexOf(leg);
  return `Stage ${i + 1} · ${leg.from} → ${leg.to}`;
}

export function renderHistory(el: HTMLElement, ctx: AppCtx) {
  const rides = ctx.rides, route = ctx.route;
  const progress = progressOf(rides, route.id);
  const lap = route.loop ? Math.floor(progress / route.total) + 1 : 1;
  const lapPos = route.loop ? progress % route.total : Math.min(progress, route.total);

  // Period totals
  const w = windows(period);
  const cur = rides.filter((r) => r.start >= w.from), prev = rides.filter((r) => r.start >= w.prev && r.start < w.from);
  const km = sum(cur, (r) => r.dist) / 1000, prevKm = sum(prev, (r) => r.dist) / 1000;
  const secs = sum(cur, (r) => r.moving), climbM = sum(cur, (r) => r.climb), load = sum(cur, (r) => r.load ?? 0);
  const fit = fitnessSeries(rides), form = formLabel(fit[fit.length - 1]);
  const hasLoad = rides.some((r) => r.load);

  // Records
  const longR = rides.filter((r) => r.moving >= 600);
  const best = longR.length ? Math.max(...longR.map(avgKmh)) : null;
  const bestR = best !== null ? longR.find((r) => Math.abs(avgKmh(r) - best) < 0.01) : undefined;
  const longest = rides.reduce<RideRecord | null>((a, r) => (!a || r.dist > a.dist ? r : a), null);
  const climb = rides.reduce<RideRecord | null>((a, r) => (!a || r.climb > a.climb ? r : a), null);
  const f10 = rides.map((r) => ({ r, t: fastest(r, 10000) })).filter((x) => x.t !== null).sort((a, b) => a.t! - b.t!)[0];

  // Achievements
  const lmLog = landmarkLog(), seen = new Set(lmLog.map((e) => e.name));
  const bs = badges(rides, route, localChallengeStore().log(), Date.now(), [...seen]), st = streak(rides);
  const earned = bs.filter((b) => b.earned);
  const close = bs.filter((b) => !b.earned && b.progress && b.progress[0] > 0).sort((a, b) => b.progress![0] / b.progress![1] - a.progress![0] / a.progress![1]);
  const show = [...earned.slice(-4).reverse(), ...close].slice(0, 4);
  while (show.length < 4) { const nx = bs.find((b) => !show.includes(b)); if (!nx) break; show.push(nx); }

  const list = showAll ? rides : rides.slice(0, ROWS);
  const kpi = (label: string, val: string, unit: string, sub: string, tone = "") => html`<div class="hx-kpi"><span class="hx-lbl">${label}</span><div class="hx-val">${val}${unit ? html`<em>${unit}</em>` : ""}</div><span class="hx-sub ${tone}">${sub}</span></div>`;

  el.innerHTML = html`<div class="hx">
    <div class="hx-head">
      <h2 class="hx-title">Training</h2>
      <div class="hx-period" role="group" aria-label="Period">${(["week", "month", "year"] as Period[]).map((p) => html`<button type="button" data-period="${p}" aria-pressed="${p === period}">${p[0].toUpperCase() + p.slice(1)}</button>`)}</div>
    </div>

    <div class="hx-kpis">
      ${kpi("Distance", km.toFixed(1), "km", `${w.label} ${prevKm.toFixed(1)} km`)}
      ${kpi("Riding time", secs ? fmtShortDuration(secs) : "0 min", "", `${cur.length} ride${cur.length === 1 ? "" : "s"}`)}
      ${kpi("Climbing", Math.round(climbM).toLocaleString(), "m", st.current ? `Streak ${st.current} day${st.current === 1 ? "" : "s"}` : `Best streak ${st.best} day${st.best === 1 ? "" : "s"}`)}
      ${kpi("Training load", hasLoad ? String(Math.round(load)) : "—", "", form.text, form.tone)}
    </div>

    <div class="hx-grid2">
      <section class="hx-card"><div class="hx-ch"><h3>Weekly distance</h3><span class="hx-note">Last 12 weeks · km</span></div><canvas class="hx-chart" id="weekCv" aria-label="Distance per week for the last 12 weeks"></canvas></section>
      <section class="hx-card"><div class="hx-ch"><h3>Fitness and fatigue</h3><span class="hx-legend"><span><i style="background:var(--hx-fitness)"></i>Fitness</span><span><i style="background:var(--hx-fatigue)"></i>Fatigue</span></span></div>
        ${hasLoad ? html`<canvas class="hx-chart" id="fitCv" aria-label="Fitness and fatigue over the last 12 weeks"></canvas>` : html`<p class="hx-empty">Ride with your heart-rate strap and your fitness and fatigue trend builds up here.</p>`}</section>
    </div>

    <section class="hx-card">
      <div class="hx-ch"><h3>${route.loop ? `The loop · lap ${lap}` : route.name}</h3><span class="hx-note">${(lapPos / 1000).toFixed(0)} of ${(route.total / 1000).toFixed(0)} km</span></div>
      <div class="hx-loop">${route.legs.map((l) => {
        const f = Math.min(1, Math.max(0, (lapPos - l.m0) / (l.m1 - l.m0)));
        return html`<div class="hx-leg" style="flex:${((l.m1 - l.m0) / 1000).toFixed(1)}" title="${l.from} → ${l.to} · ${((l.m1 - l.m0) / 1000).toFixed(1)} km"><div class="hx-legbar"><i style="width:${(f * 100).toFixed(1)}%"></i></div><span>${l.m1 - l.m0 > route.total * 0.06 ? `${l.from} → ${l.to}` : ""}</span></div>`;
      })}</div>
    </section>

    <section class="hx-card hx-rides">
      <div class="hx-ch"><h3>Rides</h3><span class="hx-note">${rides.length} saved · ${fmtShortDuration(sum(rides, (r) => r.moving))} in the saddle</span></div>
      ${rides.length ? html`
        <div class="hx-tr hx-th" aria-hidden="true"><span>Date</span><span>Ride</span><span>Distance</span><span>Time</span><span>Avg speed</span><span>Avg HR</span><span>Load</span><span></span></div>
        <div id="rideList">${list.map((r) => rideRow(r, route, bestR?.id))}</div>
        ${rides.length > ROWS ? html`<button type="button" class="hx-more" id="moreRides">${showAll ? "Show fewer" : `Show all ${rides.length} rides`}</button>` : ""}`
      : html`<p class="hx-empty">No rides yet. Connect your sensors on the Ride tab and start pedalling; the ride starts by itself.</p>`}
    </section>

    <div class="hx-grid2">
      <section class="hx-card"><div class="hx-ch"><h3>Records</h3></div><div class="hx-recs">
        <div><span>Longest ride</span><b>${longest ? (longest.dist / 1000).toFixed(1) + " km" : "—"}</b><small>${longest ? day(longest.start) : ""}</small></div>
        <div><span>Fastest 10 km</span><b>${f10 ? fmtDuration(f10.t!) : "—"}</b><small>${f10 ? day(f10.r.start) : ""}</small></div>
        <div><span>Best average</span><b>${best ? best.toFixed(1) + " km/h" : "—"}</b><small>${bestR ? day(bestR.start) : "rides of 10 min or more"}</small></div>
        <div><span>Most climbing</span><b>${climb && climb.climb ? climb.climb + " m" : "—"}</b><small>${climb && climb.climb ? day(climb.start) : ""}</small></div>
      </div></section>
      <section class="hx-card"><div class="hx-ch"><h3>Achievements</h3><button type="button" class="hx-link" id="allBadges">${earned.length} of ${bs.length} · View all</button></div>
        <div class="hx-badges">${show.map(badgeTile)}</div>
      </section>
    </div>
  </div>`.s;

  drawWeekly(el.querySelector<HTMLCanvasElement>("#weekCv")!, rides);
  const fc = el.querySelector<HTMLCanvasElement>("#fitCv");
  if (fc) drawFitness(fc, fit);

  el.querySelector(".hx-period")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-period]");
    if (b && b.dataset.period !== period) { period = b.dataset.period as Period; renderHistory(el, ctx); }
  });
  el.querySelector("#moreRides")?.addEventListener("click", () => { showAll = !showAll; renderHistory(el, ctx); });
  el.querySelector("#allBadges")?.addEventListener("click", () => {
    const sights = route.places.filter((p) => p.kind === "poi" && p.m !== undefined).sort((a, b) => a.m! - b.m!);
    void sheet(html`<div class="hx hx-sheet"><div class="hx-ch"><h3 class="hx-title">Achievements</h3><button type="button" class="hx-close" data-act="close" aria-label="Close">${raw(icon("close", 20))}</button></div>
      <p class="hx-note">${earned.length} of ${bs.length} earned${st.best ? ` · best streak ${st.best} day${st.best === 1 ? "" : "s"}` : ""}</p>
      <div class="hx-badges all">${bs.map(badgeTile)}</div>
      ${sights.length ? html`<h3 class="hx-sh">Landmarks · ${sights.filter((p) => seen.has(p.name)).length} of ${sights.length}</h3>
        <div class="hx-sights">${sights.map((p) => html`<div class="${seen.has(p.name) ? "on" : ""}">${raw(icon("pin", 18))}<span><b>${p.name}</b><small>${seen.has(p.name) ? (p.fact ?? "Reached") : `${(p.m! / 1000).toFixed(0)} km into the loop`}</small></span></div>`)}</div>` : ""}
</div>`);
  });

  el.querySelector("#rideList")?.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>(".hx-ride");
    if (!row) return;
    const r = rides.find((x) => x.id === row.dataset.id);
    if (!r) return;
    if (t.closest("[data-x=toggle]")) {
      const d = row.querySelector<HTMLElement>(".hx-detail")!;
      d.hidden = !d.hidden;
      row.classList.toggle("open", !d.hidden);
      row.querySelector("[data-x=toggle]")!.setAttribute("aria-expanded", String(!d.hidden));
      if (!d.hidden) drawRideChart(d.querySelector("canvas")!, r);
    } else if (t.closest("[data-x=tcx]")) {
      const pos = r.routeId === ctx.route.id || (r.routeId.startsWith("loop") && ctx.route.id.startsWith("loop")) ? (m: number) => pointAt(ctx.route, m).p : undefined;
      const name = `emirates-loop-${new Date(r.start).toISOString().slice(0, 10)}.tcx`;
      download(name, new Blob([rideToTcx(r, pos)], { type: "application/vnd.garmin.tcx+xml" }));
      toast("Exported. Upload it to Strava or Garmin Connect as a virtual ride.", 4500);
    } else if (t.closest("[data-x=del]")) {
      const act = await sheet(html`<h2>Delete this ride?</h2><p>${(r.dist / 1000).toFixed(2)} km on ${day(r.start)}. This can't be undone, and your loop progress moves back by that distance.</p>
        <div class="acts"><button class="btn danger" data-act="yes">Delete ride</button><button class="btn ghost" data-act="no">Cancel</button></div>`);
      if (act === "yes") {
        await deleteRide(r.id);
        await ctx.reloadRides();
        toast("Ride deleted");
        renderHistory(el, ctx);
      }
    }
  });
}

function badgeTile(b: Badge) {
  const sub = b.earned ? b.desc : b.progress ? `${b.progress[0].toLocaleString()} / ${b.progress[1].toLocaleString()}` : b.desc;
  return html`<div class="hx-badge ${b.earned ? "earned" : ""}" title="${b.desc}">${raw(icon(badgeIcon(b.id), 22))}<b>${b.title}</b><small>${sub}</small>${!b.earned && b.progress ? html`<div class="hx-prog"><i style="width:${((b.progress[0] / b.progress[1]) * 100).toFixed(0)}%"></i></div>` : ""}</div>`;
}

function rideRow(r: RideRecord, route: Route, bestId: string | undefined) {
  const d = new Date(r.start);
  const when = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const total = r.zones.slice(1).reduce((a, b) => a + b, 0) || 1;
  return html`<div class="hx-ride" data-id="${r.id}">
    <button type="button" class="hx-tr" data-x="toggle" aria-expanded="false">
      <span class="hx-date">${when}<small>${time}</small></span>
      <span class="hx-name">${rideName(r, route)}${r.id === bestId ? html`<span class="hx-tag">Best avg</span>` : ""}${r.legacy ? html`<span class="hx-tag muted">Imported</span>` : ""}</span>
      <span>${(r.dist / 1000).toFixed(1)} km</span>
      <span>${fmtDuration(r.moving)}</span>
      <span>${avgKmh(r).toFixed(1)} km/h</span>
      <span>${r.avgBpm ?? "—"}</span>
      <span class="hx-dim">${r.load ?? "—"}</span>
      <span class="hx-chev">${raw(icon("chevron", 18))}</span>
    </button>
    <div class="hx-detail" hidden>
      <canvas class="chart"></canvas>
      <div class="kv">
        <div><span class="label">Max speed</span><b>${r.maxKmh.toFixed(1)} km/h</b></div>
        ${r.avgRpm ? html`<div><span class="label">Cadence</span><b>${r.avgRpm} rpm</b></div>` : ""}
        ${r.avgBpm ? html`<div><span class="label">Heart rate</span><b>${r.avgBpm} / ${r.maxBpm} bpm</b></div>` : ""}
        ${r.climb ? html`<div><span class="label">Climbing</span><b>${r.climb} m</b></div>` : ""}
        <div><span class="label">Calories</span><b>${r.kcal || "—"}</b></div>
        <div><span class="label">Elapsed</span><b>${fmtDuration(r.elapsed)}</b></div>
      </div>
      ${r.avgBpm ? html`<div class="zones">${raw(r.zones.map((s, i) => (i && s ? `<i style="width:${((s / total) * 100).toFixed(1)}%;background:${ZONE_COLORS[i]}"></i>` : "")).join(""))}</div>
        <div class="zleg">${r.zones.map((s, i) => (i ? html`<span style="--c:${ZONE_COLORS[i]}">Z${i} ${ZONE_NAMES[i]} ${Math.round(s / 60)} min</span>` : ""))}</div>` : ""}
      ${r.legacy ? html`<p class="muted" style="margin:0">Imported from the previous version of the app (no second-by-second data).</p>` : ""}
      <div class="row">
        ${r.samples ? html`<button class="btn sm ghost" data-x="tcx">Export for Strava (TCX)</button>` : ""}
        <button class="btn sm danger" data-x="del">Delete</button>
      </div>
    </div>
  </div>`;
}

