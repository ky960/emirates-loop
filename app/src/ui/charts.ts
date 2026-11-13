import { eleAt, type ElevationProfile } from "../elevation";
import type { Leg, Route } from "../route";
import { wrapM } from "../route";
import type { RideRecord } from "../ride/types";
import { cssVar } from "./dom";

function fit(cv: HTMLCanvasElement) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h: r.height };
}

/** Elevation profile of the current stage with you, the ghost and landmarks. Drawn on dark glass. */
export function drawStageProfile(cv: HTMLCanvasElement, route: Route, prof: ElevationProfile, leg: Leg, pos: number, ghostPos: number | null, pois: Array<{ name: string; m: number }>) {
  const { g, w, h } = fit(cv);
  g.clearRect(0, 0, w, h);
  const len = leg.m1 - leg.m0, N = Math.min(400, Math.max(40, Math.floor(w / 2)));
  const ys: number[] = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= N; i++) { const e = eleAt(prof, route.total, leg.m0 + (len * i) / N); ys.push(e); lo = Math.min(lo, e); hi = Math.max(hi, e); }
  const span = Math.max(30, hi - lo), top = 6, bot = h - 4;
  const X = (i: number) => (i / N) * w, Y = (e: number) => bot - ((e - lo) / span) * (bot - top);
  const lp = wrapM(route, pos), f = Math.min(1, Math.max(0, (lp - leg.m0) / len));
  const path = () => { g.beginPath(); g.moveTo(0, bot); ys.forEach((e, i) => g.lineTo(X(i), Y(e))); g.lineTo(w, bot); g.closePath(); };
  path(); g.fillStyle = "rgba(255,255,255,.16)"; g.fill();
  g.save(); g.beginPath(); g.rect(0, 0, f * w, h); g.clip(); path(); g.fillStyle = "rgba(242,154,74,.75)"; g.fill(); g.restore();
  g.beginPath(); ys.forEach((e, i) => (i ? g.lineTo(X(i), Y(e)) : g.moveTo(X(i), Y(e)))); g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 1.2; g.stroke();
  g.font = "600 10px Barlow, sans-serif"; g.textAlign = "center"; g.fillStyle = "rgba(255,255,255,.85)";
  for (const p of pois) {
    if (p.m <= leg.m0 || p.m >= leg.m1) continue;
    const x = ((p.m - leg.m0) / len) * w;
    g.fillRect(x - 0.5, top, 1, bot - top);
    if (w > 500) g.fillText(p.name, x, top + 8);
  }
  if (ghostPos !== null) {
    const gf = (wrapM(route, ghostPos) - leg.m0) / len;
    if (gf >= 0 && gf <= 1) {
      const gi = Math.round(gf * N);
      g.beginPath(); g.arc(gf * w, Y(ys[gi]), 5, 0, Math.PI * 2); g.fillStyle = "#5FF2E6"; g.shadowColor = "#5FF2E6"; g.shadowBlur = 8; g.fill(); g.shadowBlur = 0;
    }
  }
  const mi = Math.round(f * N);
  g.beginPath(); g.arc(f * w, Y(ys[mi]), 7, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill(); g.lineWidth = 3; g.strokeStyle = "#F29A4A"; g.stroke();
}

/** Speed (and heart rate, elevation) over distance for one ride. */
export function drawRideChart(cv: HTMLCanvasElement, r: RideRecord) {
  const s = r.samples;
  const { g, w, h } = fit(cv);
  g.clearRect(0, 0, w, h);
  if (!s || s.t.length < 3) {
    g.fillStyle = cssVar("--muted"); g.font = "500 14px Barlow, sans-serif"; g.fillText("No second-by-second data for this ride.", 8, 24);
    return;
  }
  const n = s.t.length, padL = 36, padR = 36, top = 10, bot = h - 22;
  const maxD = Math.max(1, s.d[n - 1]);
  const X = (d: number) => padL + (d / maxD) * (w - padL - padR);
  // Elevation area (background)
  let eLo = Infinity, eHi = -Infinity;
  for (const e of s.e) { eLo = Math.min(eLo, e / 10); eHi = Math.max(eHi, e / 10); }
  const eSpan = Math.max(20, eHi - eLo);
  g.beginPath(); g.moveTo(X(0), bot);
  for (let i = 0; i < n; i++) g.lineTo(X(s.d[i]), bot - ((s.e[i] / 10 - eLo) / eSpan) * (bot - top) * 0.45);
  g.lineTo(X(maxD), bot); g.closePath();
  g.fillStyle = cssVar("--surface-2"); g.fill();
  // Speed
  const smooth = (arr: number[], k: number, ok: (v: number) => boolean) => arr.map((_, i) => {
    let sum = 0, c = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) if (ok(arr[j])) { sum += arr[j]; c++; }
    return c ? sum / c : NaN;
  });
  const v = smooth(s.v.map((x) => x / 10), 5, () => true);
  const vMax = Math.max(10, ...v.filter(isFinite)) * 1.1;
  const line = (vals: number[], max: number, min: number, color: string, width: number) => {
    g.beginPath();
    let on = false;
    for (let i = 0; i < n; i++) {
      if (!isFinite(vals[i])) { on = false; continue; }
      const x = X(s.d[i]), y = bot - ((vals[i] - min) / (max - min)) * (bot - top);
      if (on) g.lineTo(x, y); else { g.moveTo(x, y); on = true; }
    }
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = "round"; g.stroke();
  };
  line(v, vMax, 0, cssVar("--dune"), 2);
  const hasHr = s.h.some((x) => x > 0);
  let hLo = 0, hHi = 0;
  if (hasHr) {
    const hr = smooth(s.h, 3, (x) => x > 0);
    hLo = Math.min(...hr.filter(isFinite)) - 5; hHi = Math.max(...hr.filter(isFinite)) + 5;
    line(hr, hHi, hLo, cssVar("--bad"), 1.6);
  }
  // Axes labels
  g.fillStyle = cssVar("--muted"); g.font = "500 11px Barlow, sans-serif";
  g.textAlign = "right"; g.fillText(`${Math.round(vMax)}`, padL - 6, top + 8); g.fillText("km/h", padL - 6, top + 20); g.fillText("0", padL - 6, bot);
  if (hasHr) { g.textAlign = "left"; g.fillStyle = cssVar("--bad"); g.fillText(`${Math.round(hHi)}`, w - padR + 6, top + 8); g.fillText("bpm", w - padR + 6, top + 20); g.fillText(`${Math.round(hLo)}`, w - padR + 6, bot); }
  g.fillStyle = cssVar("--muted"); g.textAlign = "center";
  const stepKm = maxD > 40000 ? 10 : maxD > 15000 ? 5 : maxD > 6000 ? 2 : 1;
  for (let k = stepKm; k * 1000 < maxD; k += stepKm) g.fillText(`${k} km`, X(k * 1000), h - 6);
}

/** Distance per week, last `weeks` weeks (Monday-based). */
export function drawWeekly(cv: HTMLCanvasElement, rides: RideRecord[], weeks = 12) {
  const { g, w, h } = fit(cv);
  g.clearRect(0, 0, w, h);
  const now = new Date(), day = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
  const WEEK = 7 * 86400000, km = new Array(weeks).fill(0);
  for (const r of rides) {
    const k = Math.floor((monday + WEEK - r.start) / WEEK);
    if (k >= 0 && k < weeks) km[weeks - 1 - k] += r.dist / 1000;
  }
  const max = Math.max(20, ...km) * 1.15, padB = 20, bw = (w / weeks) * 0.62;
  g.font = "600 11px Barlow, sans-serif"; g.textAlign = "center";
  km.forEach((v, i) => {
    const x = (i + 0.5) * (w / weeks), bh = (v / max) * (h - padB - 14);
    g.fillStyle = i === weeks - 1 ? cssVar("--dune") : cssVar("--surface-2");
    const y = h - padB - bh;
    g.beginPath(); g.roundRect(x - bw / 2, y, bw, Math.max(2, bh), 4); g.fill();
    if (v > 0) { g.fillStyle = cssVar("--fg"); g.fillText(v.toFixed(0), x, y - 4); }
    if (i % 2 === (weeks - 1) % 2) {
      const d = new Date(monday - (weeks - 1 - i) * WEEK);
      g.fillStyle = cssVar("--muted");
      g.fillText(d.toLocaleDateString(undefined, { day: "numeric", month: "short" }), x, h - 5);
    }
  });
}
