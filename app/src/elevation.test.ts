import { describe, expect, it } from "vitest";
import { climbBetween, eleAt, gradeAt, processProfile } from "./elevation";

describe("elevation profile", () => {
  it("derives a steady 5 % gradient from a clean ramp", () => {
    const n = 200, step = 25, raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = i * step * 0.05;
    const p = processProfile(raw, step, false, "dem");
    const total = (n - 1) * step;
    expect(gradeAt(p, total, total / 2)).toBeCloseTo(0.05, 2);
    expect(p.gain).toBeGreaterThan(220);
    expect(eleAt(p, total, total / 2)).toBeCloseTo(total / 2 * 0.05, -1);
  });

  it("removes single-sample spikes such as a bridge over a creek", () => {
    const n = 100, raw = new Float32Array(n).fill(20);
    raw[50] = -15; // DEM sees the water under the bridge
    const p = processProfile(raw, 25, false, "dem");
    expect(Math.min(...p.ele)).toBeGreaterThan(18);
    expect(Math.abs(gradeAt(p, 99 * 25, 50 * 25))).toBeLessThan(0.005);
  });

  it("clamps implausible gradients", () => {
    const raw = new Float32Array(100);
    for (let i = 50; i < 100; i++) raw[i] = 400;
    const p = processProfile(raw, 25, false, "dem");
    expect(Math.max(...p.grade)).toBeLessThanOrEqual(0.18 + 1e-6);
  });

  it("measures climbing between two points", () => {
    const n = 100, raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = 100 + 50 * Math.sin(i / 10);
    const p = processProfile(raw, 25, false, "dem");
    expect(climbBetween(p, 99 * 25, 0, 99 * 25)).toBeGreaterThan(100);
  });
});
