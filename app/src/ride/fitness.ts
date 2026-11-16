import type { RideRecord } from "./types";

const DAY = 86400000;
const dayStart = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

export interface FitnessPoint { day: number; fitness: number; fatigue: number }

/**
 * Fitness (42-day) and fatigue (7-day) as exponentially weighted averages of daily training load,
 * the usual chronic/acute training-load model. Returns one point per day for the last `days` days,
 * ending today. Rides without a load (no heart rate) count as zero.
 */
export function fitnessSeries(rides: RideRecord[], now = Date.now(), days = 84): FitnessPoint[] {
  const today = dayStart(now);
  const loads = new Map<number, number>();
  let first = today;
  for (const r of rides) {
    if (!r.load) continue;
    const d = dayStart(r.start);
    loads.set(d, (loads.get(d) ?? 0) + r.load);
    first = Math.min(first, d);
  }
  const from = Math.min(first, today - (days - 1) * DAY);
  const out: FitnessPoint[] = [];
  let fit = 0, fat = 0;
  for (let d = from; d <= today; d = dayStart(d + DAY * 1.5)) {
    const l = loads.get(d) ?? 0;
    fit += (l - fit) / 42;
    fat += (l - fat) / 7;
    if (d > today - days * DAY) out.push({ day: d, fitness: fit, fatigue: fat });
  }
  return out;
}

/** A plain-words reading of form (fitness minus fatigue). */
export function formLabel(p: FitnessPoint | undefined): { text: string; tone: "good" | "neutral" | "warn" } {
  if (!p || (p.fitness < 1 && p.fatigue < 1)) return { text: "Needs rides with heart rate", tone: "neutral" };
  const form = p.fitness - p.fatigue;
  if (form > 5) return { text: "Fresh · ready for a hard ride", tone: "good" };
  if (form >= -10) return { text: "Maintaining", tone: "neutral" };
  if (form >= -30) return { text: "Productive · building fitness", tone: "good" };
  return { text: "Very tired · ease off", tone: "warn" };
}
