import { chaikin, decodePolyline, dedupe, densify, hav, type LngLat } from "./geo";
import { clamp, mod } from "./util";
import type { ElevationProfile } from "./elevation";
import DATA from "./data/uae.json";

export interface Leg { from: string; to: string; m0: number; m1: number }
export interface Stop { name: string; m: number; stage: number; lnglat: LngLat }
export interface Place { name: string; lnglat: LngLat; m?: number; kind: "city" | "poi" }

export interface Route {
  id: string;
  name: string;
  kind: "street" | "approx" | "gpx";
  loop: boolean;
  pts: LngLat[];
  cum: Float64Array;
  total: number;
  legs: Leg[];
  stops: Stop[];
  places: Place[];
  /** Elevation from the GPX file itself, sampled on `pts` (GPX routes only). */
  gpxEle?: Float32Array;
  profile?: ElevationProfile;
}

export const CITY: Record<string, LngLat> = {
  "Abu Dhabi": [54.3705, 24.4764],
  Dubai: [55.2708, 25.2048],
  Sharjah: [55.4033, 25.3463],
  Fujairah: [56.3265, 25.1288],
  Hatta: [56.1335, 24.7998],
  "Al Ain": [55.7447, 24.2075],
};
export const CITY_AR: Record<string, string> = {
  "Abu Dhabi": "أبوظبي", Dubai: "دبي", Sharjah: "الشارقة", Fujairah: "الفجيرة", Hatta: "حتا", "Al Ain": "العين",
};
const POI: Array<[string, number, number]> = [
  ["Yas Island", 54.6031, 24.4886],
  ["Ghantoot", 54.827, 24.858],
  ["Jebel Ali", 55.0272, 24.9857],
  ["Dubai Marina", 55.1403, 25.0805],
  ["Masafi", 56.172, 25.304],
];
export const LOOP_WAYPOINTS = ["Abu Dhabi", "Dubai", "Sharjah", "Fujairah", "Hatta", "Al Ain", "Abu Dhabi"];

interface RawLeg { from: string; to: string; i0: number }

function finish(r: { id: string; name: string; kind: Route["kind"]; loop: boolean; pts: LngLat[]; legsRaw: RawLeg[]; gpxEle?: Float32Array }): Route {
  const n = r.pts.length, cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + hav(r.pts[i - 1], r.pts[i]);
  const total = cum[n - 1];
  const legs: Leg[] = r.legsRaw.map((l, i) => ({
    from: l.from, to: l.to, m0: cum[l.i0], m1: i < r.legsRaw.length - 1 ? cum[r.legsRaw[i + 1].i0] : total,
  }));
  const route: Route = { id: r.id, name: r.name, kind: r.kind, loop: r.loop, pts: r.pts, cum, total, legs, stops: [], places: [], gpxEle: r.gpxEle };
  route.stops = legs.map((l, i) => ({ name: l.to, m: l.m1, stage: i + 1, lnglat: pointAt(route, l.m1 - 0.01).p }));
  if (r.loop && r.kind !== "gpx") {
    route.places = Object.entries(CITY).map(([name, lnglat]) => ({ name, lnglat, kind: "city" as const }));
    for (const [name, x, y] of POI) {
      let best = 0, bd = 1e12;
      for (let i = 0; i < n; i += 4) {
        const d = hav(r.pts[i], [x, y]);
        if (d < bd) { bd = d; best = cum[i]; }
      }
      if (bd < 6000) route.places.push({ name, lnglat: [x, y], m: best, kind: "poi" });
    }
  } else {
    route.places = [
      { name: "Start", lnglat: r.pts[0], m: 0, kind: "city" },
      { name: "Finish", lnglat: r.pts[n - 1], m: total, kind: "city" },
    ];
  }
  return route;
}

/** Wrap or clamp a distance onto the route. */
export function wrapM(r: Route, m: number): number {
  return r.loop ? mod(m, r.total) : clamp(m, 0, r.total);
}

/** Index of the last vertex at or before distance m (binary search). */
export function indexAt(r: Route, m: number): number {
  let lo = 0, hi = r.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.cum[mid] <= m) lo = mid; else hi = mid;
  }
  return lo;
}

/** Position on the route at distance m. */
export function pointAt(r: Route, m: number): { p: LngLat; i: number } {
  m = wrapM(r, m);
  const lo = indexAt(r, m), hi = Math.min(r.pts.length - 1, lo + 1);
  const t = (m - r.cum[lo]) / Math.max(1e-6, r.cum[hi] - r.cum[lo]);
  const a = r.pts[lo], b = r.pts[hi];
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], i: lo };
}

export function legAt(r: Route, m: number): Leg {
  const w = wrapM(r, m);
  return r.legs.find((l) => w >= l.m0 && w < l.m1) ?? r.legs[r.legs.length - 1];
}

/** Next stop strictly ahead of distance m (wrapping on loops). */
export function nextStop(r: Route, m: number): { stop: Stop; dist: number } {
  const w = wrapM(r, m);
  const s = r.stops.find((x) => x.m > w + 1) ?? r.stops[0];
  const dist = r.loop ? mod(s.m - w, r.total) || r.total : s.m - w;
  return { stop: s, dist };
}

/** Approximate loop from the embedded Natural Earth highways (works offline). */
export function buildApproxLoop(): Route {
  let pts: LngLat[] = [];
  const legs: RawLeg[] = [];
  (DATA.legs as Array<{ from: string; to: string; pts: LngLat[] }>).forEach((l) => {
    let p = l.pts.slice();
    p[0] = CITY[l.from];
    p.push(CITY[l.to]);
    p = densify(chaikin(p), 40);
    if (pts.length) p.shift();
    legs.push({ from: l.from, to: l.to, i0: pts.length });
    pts = pts.concat(p);
  });
  return finish({ id: "loop-approx", name: "Emirates Loop", kind: "approx", loop: true, pts, legsRaw: legs });
}

export interface StreetCache { poly: string; legs: number[]; at: number }

/** Street-accurate loop from an OSRM polyline6 and per-leg distances. */
export function buildStreetLoop(c: StreetCache): Route {
  const pts = densify(dedupe(decodePolyline(c.poly)), 40);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
  const tot = c.legs.reduce((a, b) => a + b, 0), legsRaw: RawLeg[] = [];
  let acc = 0;
  c.legs.forEach((d, k) => {
    const target = (cum[cum.length - 1] * acc) / tot;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid; else hi = mid;
    }
    legsRaw.push({ from: LOOP_WAYPOINTS[k], to: LOOP_WAYPOINTS[k + 1], i0: k === 0 ? 0 : lo });
    acc += d;
  });
  return finish({ id: "loop-street-" + c.poly.length, name: "Emirates Loop", kind: "street", loop: true, pts, legsRaw });
}

export interface GpxTrack { name: string; pts: LngLat[]; ele?: number[] }

export function buildGpxRoute(g: GpxTrack): Route {
  // Keep elevation aligned with points while smoothing lightly and densifying.
  const hasEle = !!g.ele && g.ele.length === g.pts.length && g.ele.some((e) => e !== 0);
  const pts: LngLat[] = [];
  const ele: number[] = [];
  for (let i = 0; i < g.pts.length; i++) {
    if (i > 0) {
      const a = g.pts[i - 1], b = g.pts[i], n = Math.max(1, Math.ceil(hav(a, b) / 30));
      for (let k = 1; k < n; k++) {
        pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
        if (hasEle) ele.push(g.ele![i - 1] + ((g.ele![i] - g.ele![i - 1]) * k) / n);
      }
    }
    pts.push(g.pts[i]);
    if (hasEle) ele.push(g.ele![i]);
  }
  const closes = hav(pts[0], pts[pts.length - 1]) < 150 && pts.length > 10;
  let h = 0;
  for (const p of g.pts) h = (h * 31 + Math.round(p[0] * 1e4) + Math.round(p[1] * 1e4)) | 0;
  return finish({
    id: "gpx-" + (h >>> 0).toString(36) + "-" + g.pts.length,
    name: g.name || "Your route",
    kind: "gpx",
    loop: closes,
    pts,
    legsRaw: [{ from: "Start", to: closes ? "Start" : "Finish", i0: 0 }],
    gpxEle: hasEle ? Float32Array.from(ele) : undefined,
  });
}

/** Parse GPX text (tracks or routes). Thins very long tracks to ~6000 points. */
export function parseGpx(text: string, fallbackName: string): GpxTrack {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Not a valid GPX file");
  const nodes = [...xml.querySelectorAll("trkpt, rtept")];
  let pts: LngLat[] = [], ele: number[] = [];
  for (const n of nodes) {
    const lon = +(n.getAttribute("lon") ?? NaN), lat = +(n.getAttribute("lat") ?? NaN);
    if (!isFinite(lon) || !isFinite(lat)) continue;
    pts.push([lon, lat]);
    const e = n.querySelector("ele");
    ele.push(e ? +(e.textContent ?? 0) || 0 : 0);
  }
  if (pts.length < 2) throw new Error("No track points found in that file");
  const step = Math.max(1, Math.floor(pts.length / 6000));
  if (step > 1) {
    pts = pts.filter((_, i) => i % step === 0);
    ele = ele.filter((_, i) => i % step === 0);
  }
  const nm = xml.querySelector("trk > name, rte > name, metadata > name")?.textContent?.trim() || fallbackName;
  return { name: nm.slice(0, 60), pts, ele };
}

// ---- street route: fetched once from OSRM and cached on the device ----
const STREET_KEY = "el3.street";
const OLD_STREET_KEY = "emiratesLoop.street.v1";

export function cachedStreet(): StreetCache | null {
  for (const k of [STREET_KEY, OLD_STREET_KEY]) {
    try {
      const c = JSON.parse(localStorage.getItem(k) || "null");
      if (c && typeof c.poly === "string" && Array.isArray(c.legs) && c.legs.length === 6) return c;
    } catch { /* ignore */ }
  }
  return null;
}

export async function fetchStreet(signal?: AbortSignal): Promise<StreetCache | null> {
  const coords = LOOP_WAYPOINTS.map((n) => CITY[n].join(",")).join(";");
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 20000);
  signal?.addEventListener("abort", () => ac.abort());
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=polyline6&steps=false`, { signal: ac.signal });
    const j = await r.json();
    if (j.code !== "Ok" || !j.routes?.[0]) return null;
    const c: StreetCache = { poly: j.routes[0].geometry, legs: j.routes[0].legs.map((l: { distance: number }) => l.distance), at: Date.now() };
    try { localStorage.setItem(STREET_KEY, JSON.stringify(c)); } catch { /* quota */ }
    return c;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}
