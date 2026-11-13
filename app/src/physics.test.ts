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

  it("coasts to a stop on flat road when you stop pedalling", () => {
    const vs = new VirtualSpeed(r);
    for (let i = 0; i < 200; i++) vs.update(0.1, 30, 0);
    let v = 30;
    for (let i = 0; i < 600; i++) v = vs.update(0.1, 0, 0);
    expect(v).toBe(0);
  });
});
