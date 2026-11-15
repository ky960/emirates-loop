import { describe, expect, it } from "vitest";
import { VirtualSpeed } from "../physics";
import { MAX_DRAFT, Pack } from "./pack";

const r = { massKg: 75, bikeKg: 9 };

describe("pack of other riders", () => {
  it("keeps riders around you, some to catch and some that come past", () => {
    const p = new Pack(6, () => r);
    let pos = 0;
    let passedYou = 0, youPassed = 0;
    const prev = new Map<number, number>();
    for (let i = 0; i < 20 * 60 * 10; i++) { // 20 min at 28 km/h
      pos += (28 / 3.6) * 0.1;
      p.update(0.1, pos, 28, true, () => 0);
      for (const b of p.bots) {
        const was = prev.get(b.id);
        if (was !== undefined) { if (was < 0 && b.m - pos >= 0) passedYou++; if (was > 0 && b.m - pos <= 0) youPassed++; }
        prev.set(b.id, b.m - pos);
      }
    }
    expect(youPassed).toBeGreaterThan(3);
    expect(passedYou).toBeGreaterThan(0);
    for (const b of p.bots) expect(Math.abs(b.m - pos)).toBeLessThan(1600);
  });

  it("the group rides together", () => {
    const p = new Pack(6, () => r);
    for (let i = 0; i < 600; i++) p.update(0.1, i * 0.8, 28, true, () => 0.02);
    const team = p.bots.filter((b) => b.kit === p.bots[p.bots.length - 1].kit);
    expect(team).toHaveLength(3);
    expect(Math.max(...team.map((b) => b.m)) - Math.min(...team.map((b) => b.m))).toBeLessThan(4);
  });

  it("gives a slipstream right behind a rider and none further back or ahead", () => {
    const p = new Pack(1, () => r);
    p.update(0.1, 0, 28, true, () => 0);
    const b = p.bots[0];
    expect(p.draft(b.m - 1)).toBeCloseTo(MAX_DRAFT, 2);
    expect(p.draft(b.m - 3.5)).toBeGreaterThan(0.1);
    expect(p.draft(b.m - 8)).toBe(0);
    expect(p.draft(b.m + 2)).toBe(0);
  });

  it("drafting makes you faster for the same effort", () => {
    const alone = new VirtualSpeed(r), tucked = new VirtualSpeed(r);
    let a = 0, t = 0;
    for (let i = 0; i < 600; i++) { a = alone.update(0.1, 30, 0, 85); t = tucked.update(0.1, 30, 0, 85, MAX_DRAFT); }
    expect(t).toBeGreaterThan(a + 3);
  });
});

describe("pack cast", () => {
  it("recasts riders as villains and back, keeping the group together", () => {
    const p = new Pack(6, () => r);
    p.cast({ solo: [{ name: "A", kit: 1 }, { name: "B", kit: 2 }, { name: "C", kit: 3 }], group: { names: ["G1", "G2", "G3"], kit: 9 } });
    expect(p.bots.map((b) => b.name)).toEqual(["A", "B", "C", "G1", "G2", "G3"]);
    expect(p.bots.filter((b) => b.kit === 9)).toHaveLength(3);
    p.cast(null);
    expect(p.bots[0].name).toBe("Ahmed");
    expect(p.bots[3].kit).toBe(0x00732f);
  });
});
