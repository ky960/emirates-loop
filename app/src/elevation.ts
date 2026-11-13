import { lat2tileY, lon2tileX } from "./geo";
import type { Route } from "./route";
import { pointAt } from "./route";
import { clamp, mod } from "./util";

export interface ElevationProfile {
  /** Sample spacing in metres along the route. */
  step: number;
  /** Smoothed elevation (m) per sample. */
  ele: Float32Array;
  /** Road gradient as a fraction (0.05 = 5 %) per sample. */
  grade: Float32Array;
  gain: number;
  loss: number;
  min: number;
  max: number;
  loop: boolean;
  source: "dem" | "gpx" | "flat";
}

export const PROFILE_STEP = 25;
const DEM_ZOOM = 12;
const DEM_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const idx = (n: number, i: number, loop: boolean) => (loop ? mod(i, n) : clamp(i, 0, n - 1));

function median(a: Float32Array, w: number, loop: boolean): Float32Array {
  const n = a.length, o = new Float32Array(n), h = w >> 1, buf: number[] = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    for (let k = -h; k <= h; k++) buf.push(a[idx(n, i + k, loop)]);
    buf.sort((x, y) => x - y);
    o[i] = buf[h];
  }
  return o;
}

function boxAvg(a: Float32Array, w: number, loop: boolean): Float32Array {
  const n = a.length, o = new Float32Array(n), h = w >> 1;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -h; k <= h; k++) s += a[idx(n, i + k, loop)];
    o[i] = s / (2 * h + 1);
  }
  return o;
}

/**
 * Turn raw elevation samples into a rideable profile: remove spikes (bridges, DEM noise),
 * smooth, and derive a gradient over a ~200 m window, clamped to ±18 %.
 */
export function processProfile(raw: Float32Array, step: number, loop: boolean, source: ElevationProfile["source"]): ElevationProfile {
  const n = raw.length;
  const cleaned = raw.map((v) => (isFinite(v) ? Math.max(0, v) : 0));
  let ele = median(cleaned, 9, loop);
  ele = boxAvg(ele, 9, loop);
  ele = boxAvg(ele, 5, loop);
  const g = new Float32Array(n), W = Math.max(1, Math.round(100 / step));
  for (let i = 0; i < n; i++) {
    const a = ele[idx(n, i - W, loop)], b = ele[idx(n, i + W, loop)];
    const span = loop ? 2 * W * step : (idx(n, i + W, false) - idx(n, i - W, false)) * step || step;
    g[i] = clamp((b - a) / span, -0.18, 0.18);
  }
  const grade = boxAvg(g, 5, loop);
  let gain = 0, loss = 0, min = Infinity, max = -Infinity;
  // Hysteresis of 2 m so DEM ripple doesn't inflate climbing totals.
  let ref = ele[0];
  for (let i = 0; i < n; i++) {
    const e = ele[i];
    min = Math.min(min, e); max = Math.max(max, e);
    if (e - ref > 2) { gain += e - ref; ref = e; } else if (ref - e > 2) { loss += ref - e; ref = e; }
  }
  return { step, ele, grade, gain, loss, min, max, loop, source };
}

export function flatProfile(route: Route): ElevationProfile {
  const n = Math.max(2, Math.ceil(route.total / PROFILE_STEP) + 1);
  return { step: PROFILE_STEP, ele: new Float32Array(n), grade: new Float32Array(n), gain: 0, loss: 0, min: 0, max: 0, loop: route.loop, source: "flat" };
}

function sample(p: ElevationProfile, arr: Float32Array, m: number, total: number): number {
  const n = arr.length;
  const mm = p.loop ? mod(m, total) : clamp(m, 0, total);
  const f = mm / p.step, i = Math.floor(f), t = f - i;
  const a = arr[idx(n, i, p.loop)], b = arr[idx(n, i + 1, p.loop)];
  return a + (b - a) * t;
}
export const eleAt = (p: ElevationProfile, total: number, m: number) => sample(p, p.ele, m, total);
export const gradeAt = (p: ElevationProfile, total: number, m: number) => sample(p, p.grade, m, total);

/** Climbing (m) between two route distances, m0 < m1 (may span the loop seam). */
export function climbBetween(p: ElevationProfile, total: number, m0: number, m1: number): number {
  let gain = 0, prev = eleAt(p, total, m0);
  for (let m = m0 + p.step; m <= m1; m += p.step) {
    const e = eleAt(p, total, m);
    if (e > prev) gain += e - prev;
    prev = e;
  }
  return gain;
}

// ---- DEM sampling (browser only) ----
type Tile = { w: number; h: number; d: Uint8ClampedArray } | null;

async function loadTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<Tile> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(DEM_URL(z, x, y), { signal, mode: "cors" });
      if (!r.ok) return null;
      const bmp = await createImageBitmap(await r.blob());
      const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
      const g = (cv as HTMLCanvasElement).getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      g.drawImage(bmp, 0, 0);
      const w = bmp.width, h = bmp.height;
      const d = g.getImageData(0, 0, w, h).data;
      bmp.close(); // width/height read as 0 after close(), so they're captured first
      return { w, h, d };
    } catch (e) {
      if (signal?.aborted) throw e;
      if (attempt === 0 && !navigator.onLine) return null;
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
    }
  }
  return null;
}

const terrarium = (t: NonNullable<Tile>, px: number, py: number) => {
  const x = clamp(Math.floor(px), 0, t.w - 1), y = clamp(Math.floor(py), 0, t.h - 1), o = (y * t.w + x) * 4;
  return t.d[o] * 256 + t.d[o + 1] + t.d[o + 2] / 256 - 32768;
};

/** Sample the Terrarium DEM along the route every PROFILE_STEP metres. */
export async function demProfile(route: Route, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<ElevationProfile> {
  const n = Math.max(2, Math.ceil(route.total / PROFILE_STEP) + 1);
  const coords: Array<[number, number]> = [];
  const need = new Map<string, [number, number]>();
  for (let i = 0; i < n; i++) {
    const p = pointAt(route, Math.min(route.total, i * PROFILE_STEP)).p;
    const tx = lon2tileX(p[0], DEM_ZOOM), ty = lat2tileY(p[1], DEM_ZOOM);
    coords.push([tx, ty]);
    // bilinear needs the neighbouring pixel's tile too; include the tile of (tx, ty) only — edge pixels clamp.
    const k = `${Math.floor(tx)}/${Math.floor(ty)}`;
    if (!need.has(k)) need.set(k, [Math.floor(tx), Math.floor(ty)]);
  }
  const tiles = new Map<string, Tile>();
  const keys = [...need.keys()];
  let done = 0, failed = 0;
  const worker = async () => {
    while (keys.length) {
      // Offline or blocked: stop early instead of retrying every tile.
      if (failed >= 8 && failed > done / 2) return;
      const k = keys.shift()!;
      const [x, y] = need.get(k)!;
      const t = await loadTile(DEM_ZOOM, x, y, signal);
      if (!t) failed++;
      tiles.set(k, t);
      onProgress?.(++done / need.size);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (keys.length) throw new Error("Elevation data unavailable");
  const raw = new Float32Array(n);
  let missing = 0;
  for (let i = 0; i < n; i++) {
    const [tx, ty] = coords[i];
    const t = tiles.get(`${Math.floor(tx)}/${Math.floor(ty)}`);
    if (!t) { raw[i] = NaN; missing++; continue; }
    const px = (tx - Math.floor(tx)) * t.w - 0.5, py = (ty - Math.floor(ty)) * t.h - 0.5;
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    const a = terrarium(t, x0, y0), b = terrarium(t, x0 + 1, y0), c = terrarium(t, x0, y0 + 1), d = terrarium(t, x0 + 1, y0 + 1);
    raw[i] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  if (missing > n * 0.2) throw new Error("Elevation data unavailable");
  // Fill gaps by carrying the last value forward.
  let last = 0;
  for (let i = 0; i < n; i++) { if (isNaN(raw[i])) raw[i] = last; else last = raw[i]; }
  return processProfile(raw, PROFILE_STEP, route.loop, "dem");
}

/** Elevation profile from the GPX file's own <ele> values. */
export function gpxProfile(route: Route): ElevationProfile | null {
  if (!route.gpxEle) return null;
  const n = Math.max(2, Math.ceil(route.total / PROFILE_STEP) + 1), raw = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const m = Math.min(route.total, i * PROFILE_STEP);
    while (j < route.cum.length - 2 && route.cum[j + 1] < m) j++;
    const t = (m - route.cum[j]) / Math.max(1e-6, route.cum[j + 1] - route.cum[j]);
    raw[i] = route.gpxEle[j] + (route.gpxEle[j + 1] - route.gpxEle[j]) * clamp(t, 0, 1);
  }
  return processProfile(raw, PROFILE_STEP, route.loop, "gpx");
}
