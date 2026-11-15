import type { ElevationProfile } from "../elevation";
import { eleAt } from "../elevation";
import type { Route } from "../route";
import { mod, rng } from "../util";

/**
 * Mini-challenges along the route, a few minutes apart: real climbs (from the terrain profile), sprints between two
 * chequered lines, and holds (keep your cadence, or speed without a cadence sensor, above a target for 60 s).
 * Positions are fixed along the route, so the same sprint comes round again and you can beat your best.
 */
export type ChallengeKind = "climb" | "sprint" | "hold";
export interface Challenge {
  id: string;
  kind: ChallengeKind;
  name: string;
  /** Start and end, metres along one lap of the route. */
  m0: number;
  m1: number;
  /** Climbs: height gained (m) and average gradient. */
  gain?: number;
  avg?: number;
}

/** Where challenges sit on a route. Climbs come from the profile; sprints and holds fill the gaps about every 4 km. */
export function planChallenges(route: Route, profile: ElevationProfile): Challenge[] {
  const out: Challenge[] = [], total = route.total;
  if (profile.source !== "flat") {
    // Climbs: rises of at least 25 m at 2 % or more on average, merged across short dips.
    const step = 50;
    let start = -1, low = 0;
    for (let m = 0; m <= total; m += step) {
      const e = eleAt(profile, total, m), ahead = eleAt(profile, total, Math.min(total, m + 400));
      const rising = (ahead - e) / 400 > 0.015;
      if (rising && start < 0) { start = m; low = e; }
      else if (!rising && start >= 0) {
        const gain = e - low, len = m - start;
        if (gain >= 25 && len >= 600 && gain / len >= 0.02) {
          out.push({ id: `climb-${Math.round(start / 100)}`, kind: "climb", name: `${(len / 1000).toFixed(1)} km climb`, m0: start, m1: m, gain, avg: gain / len });
        }
        start = -1;
      }
    }
  }
  const busy = (a: number, b: number) => out.some((c) => c.m0 < b + 600 && c.m1 > a - 600);
  const SLOT = 4000;
  for (let k = 1; k * SLOT < total - 1500; k++) {
    const r = rng(k * 7919 + 17), m0 = k * SLOT + Math.floor(r() * 1500);
    const sprint = r() < 0.5, len = sprint ? 500 + Math.round(r() * 6) * 50 : 2000;
    if (busy(m0, m0 + len)) continue;
    out.push(sprint
      ? { id: `sprint-${Math.round(m0 / 100)}`, kind: "sprint", name: `${len} m sprint`, m0, m1: m0 + len }
      : { id: `hold-${Math.round(m0 / 100)}`, kind: "hold", name: "Hold it", m0, m1: m0 + len });
  }
  return out.sort((a, b) => a.m0 - b.m0);
}

export type Medal = "gold" | "silver" | "bronze";
/** XP for each medal, and a bonus for a personal best. */
export const MEDAL_XP: Record<Medal, number> = { gold: 150, silver: 100, bronze: 60 };
export const PB_XP = 50;
/** XP for each landmark the first time you reach it on a lap. */
export const LANDMARK_XP = 40;

/** Landmarks you've reached (name and when), stored on this device. */
export function landmarkLog(): Array<{ name: string; at: number }> {
  try { return JSON.parse(localStorage.getItem("el3.landmarks") || "[]"); } catch { return []; }
}
export function recordLandmark(name: string) {
  try { const l = landmarkLog(); l.push({ name, at: Date.now() }); localStorage.setItem("el3.landmarks", JSON.stringify(l.slice(-1000))); } catch { /* storage unavailable */ }
}

/** The rival you race: your best time on this challenge, or a pacer a little quicker than your usual pace. */
export interface Rival { name: string; time: number; isBest: boolean }

export type ChallengeEvent =
  | { type: "approach"; c: Challenge; dist: number; target?: string; rival?: Rival }
  | { type: "countdown"; c: Challenge; n: number }
  | { type: "start"; c: Challenge; target?: string; rival?: Rival }
  | { type: "overtake"; c: Challenge; ahead: boolean }
  | { type: "finish"; c: Challenge; time: number; best: number | null; pr: boolean; medal: Medal; xp: number; rival?: Rival }
  | { type: "done"; c: Challenge; target: string; medal: Medal; xp: number }
  | { type: "fail"; c: Challenge; why: string };

export interface ChallengeStatus {
  c: Challenge; label: string; value: string; sub?: string;
  /** Live race: 0..1 through the challenge, your gap to the rival (s, negative = ahead), and where the rival is. */
  live?: { progress: number; gap?: number; rivalM?: number; urgency: number; holdOn?: boolean };
}

/** Personal bests (s) by challenge id, and a log of what you've completed (for badges and XP). */
export interface ChallengeStore { best(id: string): number | null; record(id: string, kind: ChallengeKind, time: number | null, medal?: Medal, xp?: number): void }

const HOLD_SECS = 60;
const PACERS = ["Rashid", "Mariam", "Saeed", "Hessa", "Majid", "Shamma"];

/** Runs the challenges during a ride: call update() every frame with where you are and how you're riding. */
export class ChallengeRunner {
  private active: { c: Challenge; t: number; held: number; below: number; resets: number; target: number; byCadence: boolean; rival?: Rival; ahead: boolean; lap: number } | null = null;
  private announced = new Set<string>();
  private counted = new Map<string, number>();
  private done = new Set<string>();
  /** Your recent cadence and speed, to set hold targets and pacers you can just about beat. */
  private avgRpm = 80;
  private avgKmh = 26;
  /** Names for the pacers you race the first time round (villains in night-hero mode). */
  pacers = PACERS;

  /** estTime(c, kmh): how long the challenge takes at a flat-road pace of kmh (climbs: on their gradient). */
  constructor(private list: () => Challenge[], private route: () => Route, private store: ChallengeStore, private estTime?: (c: Challenge, kmh: number) => number) {}

  /** Lap position of a cumulative route position, and which lap it's on. */
  private lap(pos: number) { const r = this.route(); return r.loop ? mod(pos, r.total) : pos; }
  private lapNo(pos: number) { const r = this.route(); return r.loop ? Math.floor(pos / r.total) : 0; }

  private holdTarget(byCadence: boolean) {
    return byCadence ? Math.max(70, Math.round((this.avgRpm + 6) / 5) * 5) : Math.max(15, Math.round(this.avgKmh + 2));
  }

  private rival(c: Challenge): Rival | undefined {
    if (c.kind === "hold") return undefined;
    const best = this.store.best(c.id);
    if (best !== null) return { name: "Your best", time: best, isBest: true };
    const t = this.estTime ? this.estTime(c, this.avgKmh * 1.06) : (c.m1 - c.m0) / ((this.avgKmh * 1.06) / 3.6);
    return { name: this.pacers[Math.abs(Math.round(c.m0)) % this.pacers.length], time: t, isBest: false };
  }

  update(dt: number, f: { pos: number; kmh: number; rpm: number | null; riding: boolean }): { events: ChallengeEvent[]; status: ChallengeStatus | null } {
    const events: ChallengeEvent[] = [];
    if (f.riding && f.kmh > 8) {
      this.avgKmh += (f.kmh - this.avgKmh) * (1 - Math.exp(-dt / 120));
      if (f.rpm) this.avgRpm += (f.rpm - this.avgRpm) * (1 - Math.exp(-dt / 120));
    }
    const at = this.lap(f.pos), byCadence = f.rpm !== null;
    const unit = byCadence ? "rpm" : "km/h";
    const a = this.active;
    if (a) {
      if (!f.riding) { this.active = null; events.push({ type: "fail", c: a.c, why: "Paused" }); return { events, status: null }; }
      a.t += dt;
      const len = a.c.m1 - a.c.m0;
      if (a.c.kind === "hold") {
        const v = a.byCadence ? f.rpm ?? 0 : f.kmh;
        if (v >= a.target) { a.held += dt; a.below = 0; } else { a.below += dt; if (a.below > 2 && a.held > 0) { a.held = 0; a.resets++; } }
        if (a.held >= HOLD_SECS) {
          const medal: Medal = a.resets === 0 ? "gold" : a.resets === 1 ? "silver" : "bronze", xp = MEDAL_XP[medal];
          this.active = null; this.done.add(a.c.id);
          this.store.record(a.c.id, "hold", null, medal, xp);
          events.push({ type: "done", c: a.c, target: `${a.target} ${a.byCadence ? "rpm" : "km/h"}`, medal, xp });
          return { events, status: null };
        }
        if (at > a.c.m1 || at < a.c.m0 - 50) { this.active = null; events.push({ type: "fail", c: a.c, why: "Out of road" }); return { events, status: null }; }
        const on = v >= a.target;
        return { events, status: { c: a.c, label: `Hold ${a.target}+ ${a.byCadence ? "rpm" : "km/h"}`, value: `${Math.ceil(HOLD_SECS - a.held)} s`, sub: on ? "On target" : `${Math.round(v)} now · keep going!`,
          live: { progress: a.held / HOLD_SECS, urgency: a.held / HOLD_SECS, holdOn: on } } };
      }
      const progress = Math.min(1, Math.max(0, (at - a.c.m0) / len));
      if (at >= a.c.m1) {
        const best = this.store.best(a.c.id), pr = best === null || a.t < best, target = a.rival?.time ?? a.t;
        const medal: Medal = a.t <= target ? "gold" : a.t <= target * 1.05 ? "silver" : "bronze";
        const xp = MEDAL_XP[medal] + (pr && best !== null ? PB_XP : 0);
        this.active = null; this.done.add(a.c.id);
        this.store.record(a.c.id, a.c.kind, a.t, medal, xp);
        events.push({ type: "finish", c: a.c, time: a.t, best, pr, medal, xp, rival: a.rival });
        return { events, status: null };
      }
      if (at < a.c.m0 - 50) { this.active = null; return { events, status: null }; }
      // Race against the rival riding the course at an even pace.
      let gap: number | undefined, rivalM: number | undefined;
      if (a.rival) {
        gap = a.t - a.rival.time * progress;
        const rp = Math.min(1, a.t / a.rival.time);
        rivalM = a.c.m0 + rp * len + a.lap * this.route().total;
        const ahead = gap < 0;
        if (ahead !== a.ahead && a.t > 1.5) events.push({ type: "overtake", c: a.c, ahead });
        a.ahead = ahead;
      }
      const best = this.store.best(a.c.id);
      return { events, status: { c: a.c, label: a.c.name, value: fmtSecs(a.t), sub: `${Math.round(a.c.m1 - at)} m to go${best !== null ? ` · best ${fmtSecs(best)}` : ""}`,
        live: { progress, gap, rivalM, urgency: progress } } };
    }
    if (!f.riding) return { events, status: null };
    const mps = Math.max(1, f.kmh / 3.6);
    for (const c of this.list()) {
      if (this.done.has(c.id)) continue;
      const d = c.m0 - at;
      if (d > 0 && d < 400 && !this.announced.has(c.id)) {
        this.announced.add(c.id);
        events.push({ type: "approach", c, dist: d, target: c.kind === "hold" ? `${this.holdTarget(byCadence)}+ ${unit} for 60 s` : undefined, rival: this.rival(c) });
      }
      // 3, 2, 1 as you roll up to the line.
      if (d > 0 && d < 4 * mps) {
        const n = Math.ceil(d / mps);
        if (n <= 3 && n !== this.counted.get(c.id)) { this.counted.set(c.id, n); events.push({ type: "countdown", c, n }); }
      }
      if (at >= c.m0 && at < c.m0 + 30) {
        const target = this.holdTarget(byCadence), rival = this.rival(c);
        this.active = { c, t: 0, held: 0, below: 0, resets: 0, target, byCadence, rival, ahead: false, lap: this.lapNo(f.pos) };
        events.push({ type: "start", c, target: c.kind === "hold" ? `${target}+ ${unit} for 60 s` : undefined, rival });
        break;
      }
    }
    // Next challenge coming up (within 1 km), as a heads-up.
    const next = this.list().find((c) => !this.done.has(c.id) && c.m0 - at > 0 && c.m0 - at < 1000);
    return { events, status: next ? { c: next, label: next.kind === "hold" ? "Hold challenge" : next.name, value: `in ${Math.round(next.m0 - at)} m` } : null };
  }

  /** Start fresh (a new ride): every challenge is available again. */
  reset() { this.active = null; this.announced.clear(); this.counted.clear(); this.done.clear(); }
}

/** XP total and level from the challenge log plus distance ridden (10 XP per km). Level n needs 250·n·(n+1) XP. */
export function xpLevel(log: Array<{ xp?: number }>, km: number, landmarks = 0) {
  const xp = Math.round(log.reduce((a, e) => a + (e.xp ?? 0), 0) + km * 10 + landmarks * LANDMARK_XP);
  let level = 1;
  while (xp >= 250 * level * (level + 1)) level++;
  const from = 250 * (level - 1) * level, to = 250 * level * (level + 1);
  return { xp, level, into: xp - from, need: to - from };
}

export const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s * 10) % 10)}`;

/** Bests and a completion log in local storage. */
export function localChallengeStore(): ChallengeStore & { log(): Array<{ id: string; kind: ChallengeKind; at: number; time: number | null; medal?: Medal; xp?: number }> } {
  const BEST = "el3.bests", LOG = "el3.challenges";
  const read = <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
  return {
    best: (id) => read<Record<string, number>>(BEST, {})[id] ?? null,
    record(id, kind, time, medal, xp) {
      try {
        if (time !== null) {
          const b = read<Record<string, number>>(BEST, {});
          if (b[id] === undefined || time < b[id]) { b[id] = time; localStorage.setItem(BEST, JSON.stringify(b)); }
        }
        const l = read<Array<unknown>>(LOG, []);
        l.push({ id, kind, at: Date.now(), time, medal, xp });
        localStorage.setItem(LOG, JSON.stringify(l.slice(-500)));
      } catch { /* storage unavailable */ }
    },
    log: () => read(LOG, []),
  };
}
