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
    const n = 600, raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = 100 + 50 * Math.sin(i / 30); // hills ~4.7 km apart
    const p = processProfile(raw, 25, false, "dem");
    expect(climbBetween(p, (n - 1) * 25, 0, (n - 1) * 25)).toBeGreaterThan(100);
  });

  it("keeps a flat city road flat despite rooftop and tree bumps in the terrain model", () => {
    const n = 1200, raw = new Float32Array(n);
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    // 5 m road, with 5-10 m bumps lasting 50-200 m every few hundred metres, plus 2 m noise.
    for (let i = 0; i < n; i++) raw[i] = 5 + (r() - 0.5) * 4;
    for (let k = 0; k < 60; k++) { const at = Math.floor(r() * n), len = 2 + Math.floor(r() * 7), h = 5 + r() * 5; for (let j = at; j < Math.min(n, at + len); j++) raw[j] += h; }
    const p = processProfile(raw, 25, false, "dem"), total = (n - 1) * 25;
    let worst = 0;
    for (let m = 1000; m < total - 1000; m += 25) worst = Math.max(worst, Math.abs(gradeAt(p, total, m)));
    expect(worst).toBeLessThan(0.01);
  });
});
