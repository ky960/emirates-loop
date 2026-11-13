import type { AppCtx } from "../app";
import { climbBetween } from "../elevation";
import { download, rideToTcx } from "../export/tcx";
import { ZONE_COLORS, ZONE_NAMES } from "../ride/metrics";
import type { RideRecord } from "../ride/types";
import { avgKmh } from "../ride/types";
import { pointAt } from "../route";
import { deleteRide, progressOf } from "../store/rides";
import { fmtDuration, fmtShortDuration } from "../util";
import { drawRideChart, drawWeekly } from "./charts";
import { html, raw, sheet, toast } from "./dom";

const SRC: Record<string, string> = { wheel: "Speed sensor", cadence: "Cadence", trainer: "Smart trainer", hr: "Heart rate", sim: "Simulated" };

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

export function renderHistory(el: HTMLElement, ctx: AppCtx) {
  const rides = ctx.rides, route = ctx.route;
  const progress = progressOf(rides, route.id);
  const lap = route.loop ? Math.floor(progress / route.total) + 1 : 1;
  const lapPos = route.loop ? progress % route.total : Math.min(progress, route.total);
  const secs = rides.reduce((a, r) => a + r.moving, 0);
  const weekStart = (() => { const n = new Date(), d = (n.getDay() + 6) % 7; return new Date(n.getFullYear(), n.getMonth(), n.getDate() - d).getTime(); })();
  const weekKm = rides.filter((r) => r.start >= weekStart).reduce((a, r) => a + r.dist, 0) / 1000;
  const longR = rides.filter((r) => r.moving >= 600);
  const best = longR.length ? Math.max(...longR.map(avgKmh)) : null;
  const longest = rides.reduce<RideRecord | null>((a, r) => (!a || r.dist > a.dist ? r : a), null);
  const climb = rides.reduce<RideRecord | null>((a, r) => (!a || r.climb > a.climb ? r : a), null);
  const f10 = rides.map((r) => ({ r, t: fastest(r, 10000) })).filter((x) => x.t !== null).sort((a, b) => a.t! - b.t!)[0];
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  el.innerHTML = html`
    <div class="totals">
      <div class="stat"><span class="label">${route.loop ? `Lap ${lap} progress` : "Route progress"}</span><div class="big">${(lapPos / 1000).toFixed(1)}<em>of ${(route.total / 1000).toFixed(0)} km</em></div><span class="sub">${(progress / 1000).toFixed(0)} km ridden in total</span></div>
      <div class="stat"><span class="label">This week</span><div class="big">${weekKm.toFixed(1)}<em>km</em></div></div>
      <div class="stat"><span class="label">Rides</span><div class="big">${rides.length}</div><span class="sub">${fmtShortDuration(secs)} in the saddle</span></div>
      <div class="stat"><span class="label">Best average</span><div class="big">${best ? best.toFixed(1) : "—"}<em>km/h</em></div><span class="sub">rides of 10 min or more</span></div>
    </div>
    <div class="grid2">
      <div class="card"><h2>Weekly distance</h2><canvas class="chart small" id="weekCv"></canvas></div>
      <div class="card"><h2>${route.loop ? `The loop · lap ${lap}` : route.name}</h2><div class="legs">${route.legs.map((l) => {
        const f = Math.min(1, Math.max(0, (lapPos - l.m0) / (l.m1 - l.m0))), cls = f >= 1 ? "done" : f > 0 ? "here" : "";
        return html`<div class="leg ${cls}"><span class="dot"></span><div style="min-width:0"><b>${l.from} → ${l.to}</b><div class="bar"><div style="width:${(f * 100).toFixed(1)}%"></div></div></div><span class="km">${((l.m1 - l.m0) / 1000).toFixed(1)} km${ctx.profile.source !== "flat" ? raw(`<br>↑ ${Math.round(climbBetween(ctx.profile, route.total, l.m0, l.m1))} m`) : ""}</span></div>`;
      })}</div></div>
    </div>
    <div class="card"><h2>Records</h2><div class="records">
      <div><span class="label">Longest ride</span><b>${longest ? (longest.dist / 1000).toFixed(1) + " km" : "—"}</b><span class="muted">${longest ? day(longest.start) : ""}</span></div>
      <div><span class="label">Best average</span><b>${best ? best.toFixed(1) + " km/h" : "—"}</b></div>
      <div><span class="label">Fastest 10 km</span><b>${f10 ? fmtDuration(f10.t!) : "—"}</b><span class="muted">${f10 ? day(f10.r.start) : ""}</span></div>
      <div><span class="label">Most climbing</span><b>${climb && climb.climb ? climb.climb + " m" : "—"}</b><span class="muted">${climb && climb.climb ? day(climb.start) : ""}</span></div>
    </div></div>
    <div class="card"><h2>Rides</h2><div id="rideList">${rides.length ? rides.map((r) => rideRow(r, best)) : html`<p class="muted" style="margin:0">No rides yet. Connect your sensors on the Ride tab and start pedalling — the ride starts by itself.</p>`}</div></div>
  `.s;
  drawWeekly(el.querySelector<HTMLCanvasElement>("#weekCv")!, rides);

  el.querySelector("#rideList")?.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>(".ride");
    if (!row) return;
    const r = rides.find((x) => x.id === row.dataset.id);
    if (!r) return;
    if (t.closest("[data-x=toggle]")) {
      const d = row.querySelector<HTMLElement>(".detail")!;
      d.hidden = !d.hidden;
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

function rideRow(r: RideRecord, best: number | null) {
  const d = new Date(r.start);
  const when = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const src = r.sources.filter((s) => s !== "hr").map((s) => SRC[s] || s)[0] ?? "";
  const isBest = best !== null && r.moving >= 600 && Math.abs(avgKmh(r) - best) < 0.01;
  const total = r.zones.slice(1).reduce((a, b) => a + b, 0) || 1;
  return html`<div class="ride" data-id="${r.id}">
    <button data-x="toggle" aria-expanded="false">
      <div style="min-width:0"><div class="when">${when}${src ? html`<span class="tag">${src}</span>` : ""}${r.avgBpm ? html`<span class="tag hr">♥ ${r.avgBpm}</span>` : ""}${isBest ? html`<span class="tag pr">Best avg</span>` : ""}</div>
      <div class="meta">${fmtDuration(r.moving)} · ${avgKmh(r).toFixed(1)} km/h avg${r.avgRpm ? ` · ${r.avgRpm} rpm` : ""}${r.climb ? ` · ↑ ${r.climb} m` : ""}</div></div>
      <div class="km">${(r.dist / 1000).toFixed(1)} <span>km</span></div>
    </button>
    <div class="detail" hidden>
      <canvas class="chart"></canvas>
      <div class="kv">
        <div><span class="label">Max speed</span><b>${r.maxKmh.toFixed(1)} km/h</b></div>
        ${r.avgBpm ? html`<div><span class="label">Heart rate</span><b>${r.avgBpm} / ${r.maxBpm} bpm</b></div>` : ""}
        <div><span class="label">Calories</span><b>${r.kcal || "—"}</b></div>
        ${r.load ? html`<div><span class="label">Training load</span><b>${r.load}</b></div>` : ""}
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
