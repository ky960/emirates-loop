import type { RideRecord } from "./types";
import { avgKmh } from "./types";

/**
 * The ghost replays a previous ride second by second (your best average over 10+ minutes),
 * then carries on at that ride's average speed. Without a saved ride it rides at a steady pace.
 */
export class Ghost {
  readonly label: string;
  private t: number[] = [];
  private d: number[] = [];
  private kmh: number;

  constructor(best: RideRecord | null, fallbackKmh = 27) {
    this.kmh = best ? avgKmh(best) : fallbackKmh;
    if (best?.samples && best.samples.t.length > 10) {
      this.t = best.samples.t;
      this.d = best.samples.d;
      this.label = `Best ride · ${this.kmh.toFixed(1)} km/h`;
    } else {
      this.label = best ? `Best avg · ${this.kmh.toFixed(1)} km/h` : `Pacer · ${fallbackKmh} km/h`;
    }
  }

  get speedKmh() { return this.kmh; }

  /** Ghost distance (m) after `sec` seconds of ride time. */
  distAt(sec: number): number {
    const n = this.t.length;
    if (n < 2 || sec >= this.t[n - 1]) {
      const base = n ? this.d[n - 1] : 0, t0 = n ? this.t[n - 1] : 0;
      return base + ((sec - t0) * this.kmh) / 3.6;
    }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.t[mid] <= sec) lo = mid; else hi = mid;
    }
    const f = (sec - this.t[lo]) / Math.max(1e-6, this.t[hi] - this.t[lo]);
    return this.d[lo] + (this.d[hi] - this.d[lo]) * Math.min(1, Math.max(0, f));
  }

  /** Instantaneous ghost speed (km/h) around `sec`. */
  kmhAt(sec: number): number {
    return Math.max(0, (this.distAt(sec + 1) - this.distAt(sec - 1)) / 2) * 3.6;
  }
}

/** Pick the ghost: fastest average among real rides of at least 10 minutes on the same speed model. */
export function pickBest(rides: RideRecord[], gradientEffect: boolean): RideRecord | null {
  let best: RideRecord | null = null;
  for (const r of rides) {
    if (r.moving < 600 || r.gradientEffect !== gradientEffect) continue;
    if (!best || avgKmh(r) > avgKmh(best)) best = r;
  }
  return best;
}
