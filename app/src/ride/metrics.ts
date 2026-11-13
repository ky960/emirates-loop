import type { Sex } from "../store/settings";

/** Heart-rate zone 1–5 by % of max HR (50/60/70/80/90). 0 = below zone 1. */
export function hrZone(bpm: number, maxHr: number): number {
  const p = bpm / maxHr;
  if (p >= 0.9) return 5;
  if (p >= 0.8) return 4;
  if (p >= 0.7) return 3;
  if (p >= 0.6) return 2;
  if (p >= 0.5) return 1;
  return 0;
}

export const ZONE_NAMES = ["Rest", "Easy", "Endurance", "Tempo", "Threshold", "Max"];
export const ZONE_COLORS = ["#7C8A93", "#5B9BD5", "#4CC38A", "#E8B33A", "#F0812E", "#EF4B4B"];

/** Energy expenditure from heart rate (Keytel et al. 2005), kcal per minute. */
export function kcalPerMinHr(bpm: number, weightKg: number, age: number, sex: Sex): number {
  const m = (-55.0969 + 0.6309 * bpm + 0.1988 * weightKg + 0.2017 * age) / 4.184;
  const f = (-20.4022 + 0.4472 * bpm - 0.1263 * weightKg + 0.074 * age) / 4.184;
  const v = sex === "male" ? m : sex === "female" ? f : (m + f) / 2;
  return Math.max(0, v);
}

/** Energy from mechanical work: ~24 % gross efficiency. kcal for `joules` of work. */
export const kcalFromWork = (joules: number) => joules / 4184 / 0.24;

/** Banister TRIMP increment for dt seconds at bpm. */
export function trimp(dtSec: number, bpm: number, restHr: number, maxHr: number, sex: Sex): number {
  const hrr = Math.min(1, Math.max(0, (bpm - restHr) / Math.max(1, maxHr - restHr)));
  const k = sex === "female" ? 0.86 * Math.exp(1.67 * hrr) : 0.64 * Math.exp(1.92 * hrr);
  return (dtSec / 60) * hrr * k;
}
