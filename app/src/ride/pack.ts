import { powerFor, speedFor, type Rider } from "../physics";
import { clamp, rng } from "../util";

/**
 * Other cyclists on the road. Each rides at a pace set relative to your own recent average speed, some a little
 * faster (they come up from behind and pass you), most a little slower (you reel them in). A small group of three
 * rides together in team kit. They climb and descend with the same physics as you.
 */
export interface Bot {
  id: number;
  name: string;
  /** Jersey colour. */
  kit: number;
  /** Route position (m, cumulative) and speed (m/s). */
  m: number;
  v: number;
  /** Their flat-road pace relative to yours (1 = same). */
  pace: number;
  /** Offset (m) right of the centreline: they ride on the left of the lane, you on the right. */
  lat: number;
  /** Crank angle (rad) for their legs. */
  crank: number;
  /** Members of the group share a leader and keep their place behind it. */
  leader?: Bot;
  slot: number;
  /** A character look (night-hero mode villains); plain kit when absent. */
  look?: unknown;
}

/** A cast for the pack: names, kit colours and looks by rider, and one look for the group. */
export interface Cast { solo: Array<{ name: string; kit: number; look?: unknown }>; group: { names: string[]; kit: number; look?: unknown } }

const NAMES = ["Ahmed", "Fatima", "Omar", "Sara", "Khalid", "Maryam", "Yousef", "Noura", "Rashid", "Aisha", "Hamdan", "Layla"];
const KITS = [0x1f6feb, 0xd7263d, 0x2ec4b6, 0xf4d35e, 0x6a4c93, 0x1b1b1f, 0xf2f2f2, 0x2a9d8f, 0xff7b00];
const TEAM_KIT = 0x00732f; // the group rides in UAE green

/** Slipstream reduces your air drag by up to a third when tucked in close behind another rider. */
export const MAX_DRAFT = 0.33;

export class Pack {
  bots: Bot[] = [];
  /** Your recent average speed (km/h): the pack's pace is set from it. */
  private avgKmh = 25;
  private r = rng(2024);
  private ready = false;

  constructor(n: number, private rider: () => Rider) {
    const group = n >= 4, solo = group ? n - 3 : n, r = this.r;
    for (let i = 0; i < solo; i++) {
      this.bots.push({ id: i, name: NAMES[i % NAMES.length], kit: KITS[i % KITS.length], m: 0, v: 0, pace: 1, lat: 0.85 + r() * 0.3, crank: r() * 6.28, slot: 0 });
    }
    if (group) {
      const lead: Bot = { id: solo, name: NAMES[(solo) % NAMES.length], kit: TEAM_KIT, m: 0, v: 0, pace: 1, lat: 1.0, crank: 0, slot: 0 };
      this.bots.push(lead);
      for (let k = 1; k < 3; k++) this.bots.push({ id: solo + k, name: NAMES[(solo + k) % NAMES.length], kit: TEAM_KIT, m: 0, v: 0, pace: 1, lat: k % 2 ? 0.75 : 1.2, crank: k * 2, leader: lead, slot: k });
    }
  }

  private spawn(b: Bot, pos: number, initial: boolean) {
    const r = this.r;
    // Mostly slower than you (to catch: one every few minutes), some a bit faster (to come past).
    b.pace = r() < 0.65 ? 0.74 + r() * 0.16 : 1.04 + r() * 0.08;
    if (initial) b.m = pos - 100 + r() * 600;
    else b.m = b.pace > 1 ? pos - 80 - r() * 160 : pos + 150 + r() * 350;
    b.v = (this.avgKmh / 3.6) * b.pace;
  }

  /** dt (s); rider position (m) and speed; gradeAt(m) for the route's gradient. */
  update(dt: number, pos: number, kmh: number, riding: boolean, gradeAt: (m: number) => number) {
    if (riding && kmh > 8) this.avgKmh += (kmh - this.avgKmh) * (1 - Math.exp(-dt / 90));
    this.avgKmh = clamp(this.avgKmh, 15, 45);
    if (!this.ready) { this.bots.forEach((b) => !b.leader && this.spawn(b, pos, true)); this.ready = true; }
    const rider = this.rider();
    for (const b of this.bots) {
      if (b.leader) continue;
      // Out of the picture (dropped well behind, or gone far ahead): bring them back into view.
      const gap = b.m - pos;
      if (gap < -250 || gap > 1200) this.spawn(b, pos, false);
      // Same physics as you: their flat-road effort applied to the gradient, with a few seconds of momentum.
      const target = speedFor(powerFor((this.avgKmh / 3.6) * b.pace, 0, rider), gradeAt(b.m), rider);
      b.v += (target - b.v) * (1 - Math.exp(-dt / 3));
      b.m += b.v * dt;
    }
    for (const b of this.bots) {
      if (b.leader) { b.v = b.leader.v; b.pace = b.leader.pace; b.m = b.leader.m - b.slot * 1.7; }
      b.crank += ((b.v > 0.5 ? 72 + b.v * 1.5 : 0) / 60) * 6.283 * dt;
    }
  }

  /** Air-drag reduction (0..MAX_DRAFT) for a rider at `pos`: largest right behind another rider, gone by 6 m back. */
  draft(pos: number): number {
    let best = 0;
    for (const b of this.bots) {
      const gap = b.m - pos;
      if (gap > 0.3 && gap < 6) best = Math.max(best, MAX_DRAFT * clamp((6 - gap) / 5, 0, 1));
    }
    return best;
  }

  /** The nearest rider ahead within `range` m, if any. */
  ahead(pos: number, range = 500): { bot: Bot; gap: number } | null {
    let best: { bot: Bot; gap: number } | null = null;
    for (const b of this.bots) {
      const gap = b.m - pos;
      if (gap > 0.3 && gap < range && (!best || gap < best.gap)) best = { bot: b, gap };
    }
    return best;
  }

  private defaults: Array<{ name: string; kit: number }> | null = null;
  /** Recast the riders (e.g. as villains), or back to ordinary cyclists with null. Positions are kept. */
  cast(c: Cast | null) {
    this.defaults ??= this.bots.map((b) => ({ name: b.name, kit: b.kit }));
    let si = 0, gi = 0;
    this.bots.forEach((b, i) => {
      const d = this.defaults![i], grouped = d.kit === TEAM_KIT;
      if (!c) { b.name = d.name; b.kit = d.kit; b.look = undefined; return; }
      if (grouped) { b.name = c.group.names[gi++ % c.group.names.length]; b.kit = c.group.kit; b.look = c.group.look; }
      else { const s = c.solo[si++ % c.solo.length]; b.name = s.name; b.kit = s.kit; b.look = s.look; }
    });
  }

  reset() { this.ready = false; }
}
