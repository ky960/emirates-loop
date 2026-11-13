import type { GpxTrack } from "../route";

export type Quality = "battery" | "balanced" | "max";
export type Camera = "road" | "map" | "stage" | "loop";
export type Sex = "male" | "female" | "unspecified";

export interface Settings {
  name: string;
  age: number;
  weightKg: number;
  sex: Sex;
  /** null = estimate from age (Tanaka: 208 − 0.7 × age). */
  maxHr: number | null;
  restHr: number;
  wheelMm: number;
  strokeM: number;
  gradientEffect: boolean;
  autoPause: boolean;
  ghost: boolean;
  terrain: boolean;
  sound: boolean;
  showPower: boolean;
  quality: Quality;
  camera: Camera;
  /** Bluetooth devices to reconnect automatically. */
  sensors: Array<{ id: string; name: string }>;
  gpx: GpxTrack | null;
}

export const DEFAULTS: Settings = {
  name: "",
  age: 35,
  weightKg: 75,
  sex: "unspecified",
  maxHr: null,
  restHr: 60,
  wheelMm: 2105,
  strokeM: 5.5,
  gradientEffect: true,
  autoPause: true,
  ghost: true,
  terrain: true,
  sound: true,
  showPower: false,
  quality: "balanced",
  camera: "road",
  sensors: [],
  gpx: null,
};

const KEY = "el3.settings";
const OLD_KEY = "emiratesLoop.v2";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* fall through */ }
  // First run of v3: carry over the old app's settings.
  const s = { ...DEFAULTS };
  try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
    if (old) {
      if (typeof old.name === "string") s.name = old.name;
      if (old.wheelMm >= 500 && old.wheelMm <= 3000) s.wheelMm = old.wheelMm;
      if (old.strokeM >= 1 && old.strokeM <= 12) s.strokeM = old.strokeM;
      if (typeof old.ghost === "boolean") s.ghost = old.ghost;
      if (typeof old.terrain === "boolean") s.terrain = old.terrain;
      if (old.gpx?.pts?.length > 1) s.gpx = { name: old.gpx.name || "Your route", pts: old.gpx.pts };
    }
  } catch { /* ignore */ }
  return s;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* quota: GPX may be too big; settings still live in memory */ }
}

export const maxHrOf = (s: Settings) => s.maxHr ?? Math.round(208 - 0.7 * s.age);

/** Rides saved by the old single-file app (localStorage), for one-time import. */
export function legacyRides(): Array<{ at: number; km: number; sec: number; maxKmh?: number; cad?: number; src?: string; sample?: boolean }> {
  try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
    return Array.isArray(old?.rides) ? old.rides.filter((r: { sample?: boolean; src?: string }) => !r.sample) : [];
  } catch {
    return [];
  }
}
