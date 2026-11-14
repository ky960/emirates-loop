import { describe, expect, it } from "vitest";
import { buildApproxLoop } from "../route";
import { badges, newlyEarned, streak } from "./badges";
import type { RideRecord } from "./types";

const route = buildApproxLoop();
const DAY = 86400000, t0 = new Date(2026, 10, 1, 18, 0).getTime();
const ride = (day: number, startM: number, km: number, extra: Partial<RideRecord> = {}): RideRecord => ({
  id: "r" + day + startM, start: t0 + day * DAY, routeId: "loop", routeName: "Emirates Loop", startM, dist: km * 1000, moving: km * 130, elapsed: km * 130,
  maxKmh: 35, avgRpm: 85, avgBpm: null, maxBpm: null, zones: [0, 0, 0, 0, 0, 0], kcal: 0, load: null, climb: 0, sources: ["wheel"], gradientEffect: true, ...extra,
});
const got = (b: ReturnType<typeof badges>, id: string) => b.find((x) => x.id === id)!;

describe("badges", () => {
  it("counts days in a row", () => {
    const rides = [ride(0, 0, 10), ride(1, 10000, 10), ride(2, 20000, 10), ride(5, 30000, 10), ride(6, 40000, 10)];
    expect(streak(rides, t0 + 6 * DAY + 3600000)).toEqual({ current: 2, best: 3 });
    expect(streak(rides, t0 + 9 * DAY).current).toBe(0);
  });

  it("awards distance and stage badges, with progress", () => {
    const l1 = route.legs[0];
    // Stage 1 ridden over three sessions; the last one crosses its finish.
    const rides = [ride(0, 0, 50), ride(1, 50000, 50), ride(2, 100000, (l1.m1 - 100000) / 1000 + 5)];
    const b = badges(rides, route, []);
    expect(got(b, "first").earned).toBe(true);
    expect(got(b, "km100").earned).toBe(true);
    expect(got(b, "km250").earned).toBe(false);
    expect(got(b, "km250").progress![0]).toBeGreaterThan(100);
    expect(got(b, "stage1").earned).toBe(true);
    expect(got(b, "stage2").earned).toBe(false);
    expect(got(b, "long50").earned).toBe(true);
    expect(got(b, "streak3").earned).toBe(true);
  });

  it("counts a stage finished on a later lap", () => {
    const l2 = route.legs[1];
    const b = badges([ride(0, route.total + l2.m1 - 2000, 4)], route, []);
    expect(got(b, "stage2").earned).toBe(true);
  });

  it("awards challenge badges and reports what's new", () => {
    const before = badges([], route, []);
    const log = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: "hold-" + i, kind: "hold" as const, at: i, time: null })),
      { id: "sprint-1", kind: "sprint" as const, at: 10, time: 60 }, { id: "sprint-1", kind: "sprint" as const, at: 20, time: 55 },
      { id: "climb-1", kind: "climb" as const, at: 30, time: 300 }, { id: "sprint-2", kind: "sprint" as const, at: 40, time: 50 },
    ];
    const after = badges([ride(0, 0, 5)], route, log);
    expect(got(after, "holds5").earned).toBe(true);
    expect(got(after, "chal10").earned).toBe(true);
    expect(got(after, "pb").earned).toBe(true);
    expect(newlyEarned(before, after).map((b) => b.id)).toEqual(expect.arrayContaining(["first", "holds5", "chal10", "pb"]));
  });
});
