import type { RideRecord } from "../ride/types";
import { db } from "./db";
import { legacyRides } from "./settings";

const MIGRATED = "el3.migrated";

/** All saved rides, newest first. Imports the old app's rides the first time. */
export async function loadRides(): Promise<RideRecord[]> {
  let rides = await db.all<RideRecord>("rides");
  if (!localStorage.getItem(MIGRATED)) {
    const old = legacyRides();
    let startM = 0;
    // Oldest first so cumulative positions line up with the old app's progress.
    for (const r of [...old].sort((a, b) => a.at - b.at)) {
      const rec: RideRecord = {
        id: `legacy-${r.at}`,
        start: r.at,
        routeId: "loop",
        routeName: "Emirates Loop",
        startM,
        dist: Math.round(r.km * 1000),
        moving: r.sec,
        elapsed: r.sec,
        maxKmh: r.maxKmh ?? 0,
        avgRpm: r.cad || null,
        avgBpm: null,
        maxBpm: null,
        zones: [0, 0, 0, 0, 0, 0],
        kcal: 0,
        load: null,
        climb: 0,
        sources: r.src === "demo" ? ["sim"] : [r.src === "speed" ? "wheel" : r.src || "cadence"],
        gradientEffect: false,
        legacy: true,
      };
      startM += rec.dist;
      // Demo rides from the old app were never real; leave them out.
      if (r.src !== "demo" && !rides.some((x) => x.id === rec.id)) await db.put("rides", rec);
    }
    localStorage.setItem(MIGRATED, "1");
    rides = await db.all<RideRecord>("rides");
  }
  return rides.sort((a, b) => b.start - a.start);
}

export const saveRide = (r: RideRecord) => db.put("rides", r);
export const deleteRide = (id: string) => db.del("rides", id);

const loopish = (id: string) => id === "loop" || id.startsWith("loop-");
/** Same journey? (The loop's id changes with the road route it was built from.) */
export const sameRoute = (a: string, b: string) => (loopish(a) ? loopish(b) : a === b);

/** Total distance ridden on this route. */
export function progressOf(rides: RideRecord[], routeId: string): number {
  return rides.filter((r) => sameRoute(routeId, r.routeId)).reduce((a, r) => a + r.dist, 0);
}

/** Where "Continue" picks up: the end of your most recent saved ride on this route (0 before the first). */
export function resumeOf(rides: RideRecord[], routeId: string): number {
  const mine = rides.filter((r) => sameRoute(routeId, r.routeId));
  if (!mine.length) return 0;
  const last = mine.reduce((a, r) => (r.start > a.start ? r : a));
  return last.startM + last.dist;
}

// ---- chosen start (a stage picked in "Choose your ride") ----
const START_KEY = "el3.startAt";
export interface StartAt { routeId: string; m: number }
export function loadStartAt(): StartAt | null {
  try { const v = JSON.parse(localStorage.getItem(START_KEY) || "null"); return v && typeof v.m === "number" && typeof v.routeId === "string" ? v : null; } catch { return null; }
}
export function saveStartAt(v: StartAt | null) {
  try { if (v) localStorage.setItem(START_KEY, JSON.stringify(v)); else localStorage.removeItem(START_KEY); } catch { /* storage unavailable */ }
}

// ---- backup ----
export interface Backup { app: "emirates-loop"; version: 3; exported: string; settings: unknown; rides: RideRecord[] }

export async function exportBackup(settings: unknown): Promise<Blob> {
  const rides = await db.all<RideRecord>("rides");
  const b: Backup = { app: "emirates-loop", version: 3, exported: new Date().toISOString(), settings, rides };
  return new Blob([JSON.stringify(b)], { type: "application/json" });
}

/** Merge rides from a backup file. Returns how many rides were added. */
export async function importBackup(text: string): Promise<{ added: number; settings: unknown }> {
  const b = JSON.parse(text) as Backup;
  if (b?.app !== "emirates-loop" || !Array.isArray(b.rides)) throw new Error("That isn't an Emirates Loop backup file.");
  const have = new Set((await db.all<RideRecord>("rides")).map((r) => r.id));
  let added = 0;
  for (const r of b.rides) {
    if (!r?.id || have.has(r.id) || typeof r.dist !== "number") continue;
    await db.put("rides", r);
    added++;
  }
  return { added, settings: b.settings };
}
