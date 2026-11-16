import { describe, expect, it } from "vitest";
import { fitnessSeries, formLabel } from "./fitness";
import type { RideRecord } from "./types";

const DAY = 86400000;
const ride = (start: number, load: number | null): RideRecord => ({
  id: String(start), start, routeId: "loop", routeName: "Loop", startM: 0, dist: 20000, moving: 3600, elapsed: 3700,
  maxKmh: 40, avgRpm: null, avgBpm: load ? 140 : null, maxBpm: null, zones: [0, 0, 0, 0, 0, 0], kcal: 500, load, climb: 0, sources: ["wheel"], gradientEffect: true,
});

describe("fitnessSeries", () => {
  const now = new Date(2026, 10, 16, 12).getTime();

  it("returns one point per day, ending today", () => {
    const s = fitnessSeries([], now, 84);
    expect(s).toHaveLength(84);
    expect(new Date(s[83].day).getDate()).toBe(16);
    expect(s.every((p) => p.fitness === 0 && p.fatigue === 0)).toBe(true);
  });

  it("fatigue reacts faster than fitness and both decay", () => {
    const s = fitnessSeries([ride(now - 10 * DAY, 100)], now, 30);
    const peak = s.find((p) => p.fatigue > 0)!;
    expect(peak.fatigue).toBeCloseTo(100 / 7, 5);
    expect(peak.fitness).toBeCloseTo(100 / 42, 5);
    expect(s[29].fatigue).toBeLessThan(peak.fatigue);
    expect(s[29].fitness).toBeLessThan(peak.fitness);
  });

  it("ignores rides without heart-rate load", () => {
    expect(fitnessSeries([ride(now, null)], now, 7).every((p) => p.fitness === 0)).toBe(true);
  });

  it("labels form", () => {
    expect(formLabel(undefined).text).toMatch(/heart rate/);
    expect(formLabel({ day: 0, fitness: 40, fatigue: 30 }).text).toBe("Fresh · ready for a hard ride");
    expect(formLabel({ day: 0, fitness: 40, fatigue: 60 }).tone).toBe("good");
    expect(formLabel({ day: 0, fitness: 40, fatigue: 90 }).tone).toBe("warn");
  });
});
