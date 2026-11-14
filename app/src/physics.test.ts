import { describe, expect, it } from "vitest";
import { powerFor, speedFor, VirtualSpeed } from "./physics";

const r = { massKg: 75, bikeKg: 9 };

describe("physics", () => {
  it("round-trips power and speed on flat ground", () => {
    const p = powerFor(30 / 3.6, 0, r);
    expect(p).toBeGreaterThan(150);
    expect(p).toBeLessThan(260);
    expect(speedFor(p, 0, r) * 3.6).toBeCloseTo(30, 1);
  });

  it("slows you down on a climb and speeds you up downhill", () => {
    const p = powerFor(30 / 3.6, 0, r);
    expect(speedFor(p, 0.06, r) * 3.6).toBeLessThan(18);
    expect(speedFor(p, -0.04, r) * 3.6).toBeGreaterThan(40);
  });

  it("virtual speed converges to the flat speed on flat road", () => {
    const vs = new VirtualSpeed(r);
    let v = 0;
    for (let i = 0; i < 200; i++) v = vs.update(0.1, 30, 0);
    expect(v).toBeCloseTo(30, 0);
  });

  it("stops within a few seconds once the wheel stops on flat road", () => {
    const vs = new VirtualSpeed(r);
    for (let i = 0; i < 300; i++) vs.update(0.1, 30, 0);
    let v = 30, t = 0;
    while (v > 0 && t < 30) { v = vs.update(0.1, 0, 0); t += 0.1; }
    expect(v).toBe(0);
    expect(t).toBeLessThan(5);
  });

  it("slows with the trainer wheel when you stop pedalling, then stops", () => {
    const vs = new VirtualSpeed(r);
    for (let i = 0; i < 300; i++) vs.update(0.1, 30, 0);
    // Wheel spinning down at ~3 km/h per second (no cadence sensor).
    let v = 30;
    for (let i = 0; i < 50; i++) v = vs.update(0.1, 30 - i * 0.3, 0);
    expect(vs.coasting).toBe(true);
    expect(v).toBeGreaterThan(14);
    expect(v).toBeLessThan(24);
    let t = 0;
    for (; v > 0 && t < 20; t += 0.1) v = vs.update(0.1, Math.max(0, 15.3 - t * 3), 0);
    expect(t).toBeLessThan(6); // stopped before the wheel has quite stopped
  });

  it("settles at the new speed when you ease off but keep pedalling", () => {
    const vs = new VirtualSpeed(r);
    for (let i = 0; i < 300; i++) vs.update(0.1, 30, 0);
    let v = 30;
    for (let i = 0; i < 300; i++) v = vs.update(0.1, Math.max(20, 30 - i * 0.2), 0);
    expect(vs.coasting).toBe(false);
    expect(Math.abs(v - 20)).toBeLessThan(2);
  });

  it("detects coasting from cadence and keeps rolling downhill", () => {
    const vs = new VirtualSpeed(r);
    for (let i = 0; i < 300; i++) vs.update(0.1, 30, -0.05, 85);
    const v0 = vs.update(0.1, 30, -0.05, 85);
    let v = v0;
    for (let i = 0; i < 100; i++) v = vs.update(0.1, 25, -0.05, 0);
    expect(vs.coasting).toBe(true);
    expect(v).toBeGreaterThan(30); // gravity keeps you going on a 5 % descent
  });

  it("slows quickly when you stop pedalling on a climb", () => {
    const vs = new VirtualSpeed(r);
    for (let i = 0; i < 400; i++) vs.update(0.1, 30, 0.06, 85);
    const v0 = vs.update(0.1, 30, 0.06, 85);
    let v = v0;
    for (let i = 0; i < 30; i++) v = vs.update(0.1, 28, 0.06, 0);
    expect(v).toBeLessThan(v0 - 5);
  });
});
