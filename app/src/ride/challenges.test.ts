import { describe, expect, it } from "vitest";
import { flatProfile, processProfile } from "../elevation";
import { buildApproxLoop } from "../route";
import { ChallengeRunner, planChallenges, type ChallengeKind, type ChallengeStore } from "./challenges";

const route = buildApproxLoop();

function memStore(): ChallengeStore & { rec: Array<[string, ChallengeKind, number | null]> } {
  const bests: Record<string, number> = {}, rec: Array<[string, ChallengeKind, number | null]> = [];
  return { rec, best: (id) => bests[id] ?? null, record(id, kind, t) { rec.push([id, kind, t]); if (t !== null && (bests[id] === undefined || t < bests[id])) bests[id] = t; } };
}

describe("challenges", () => {
  it("places sprints and holds every few km, and finds real climbs in the profile", () => {
    const n = Math.ceil(route.total / 25) + 1, raw = new Float32Array(n);
    // A 3 km climb of 150 m starting at 50 km.
    for (let i = 0; i < n; i++) { const m = i * 25; raw[i] = m < 50000 ? 10 : m < 53000 ? 10 + (m - 50000) * 0.05 : 160; }
    const list = planChallenges(route, processProfile(raw, 25, true, "dem"));
    const climbs = list.filter((c) => c.kind === "climb");
    expect(climbs.length).toBeGreaterThan(0);
    expect(climbs.some((c) => c.m0 < 50500 && c.m1 > 52000 && c.gain! > 100)).toBe(true);
    const others = list.filter((c) => c.kind !== "climb");
    expect(others.length).toBeGreaterThan(route.total / 6000);
    for (let i = 1; i < list.length; i++) expect(list[i].m0).toBeGreaterThan(list[i - 1].m1); // never overlapping
  });

  it("times a sprint and keeps your best", () => {
    const list = planChallenges(route, flatProfile(route)), sprint = list.find((c) => c.kind === "sprint")!;
    const store = memStore(), run = new ChallengeRunner(() => list, () => route, store);
    const events: string[] = [];
    let pos = sprint.m0 - 400;
    for (let i = 0; i < 2000 && pos < sprint.m1 + 100; i++) {
      pos += 10 * 0.1; // 36 km/h
      for (const e of run.update(0.1, { pos, kmh: 36, rpm: 90, riding: true }).events) events.push(e.type);
    }
    expect(events).toEqual(["approach", "start", "finish"]);
    const t = store.rec[0][2]!;
    expect(t).toBeCloseTo((sprint.m1 - sprint.m0) / 10, 0);
  });

  it("completes a hold when you keep above the target for 60 s, and restarts the count if you drop", () => {
    const list = planChallenges(route, flatProfile(route)), hold = list.find((c) => c.kind === "hold")!;
    const store = memStore(), run = new ChallengeRunner(() => list, () => route, store);
    let pos = hold.m0 - 50, done = false, target = "";
    for (let i = 0; i < 1500 && !done; i++) {
      pos += 7 * 0.1;
      const rpm = i > 300 && i < 330 ? 60 : 100; // a 3 s dip resets the hold
      for (const e of run.update(0.1, { pos, kmh: 25, rpm, riding: true }).events) { if (e.type === "start") target = e.target!; if (e.type === "done") done = true; }
    }
    expect(target).toMatch(/rpm/);
    expect(done).toBe(true);
    expect(store.rec[0][1]).toBe("hold");
  });

  it("calls a challenge off if you stop", () => {
    const list = planChallenges(route, flatProfile(route)), sprint = list.find((c) => c.kind === "sprint")!;
    const run = new ChallengeRunner(() => list, () => route, memStore());
    run.update(0.1, { pos: sprint.m0 + 1, kmh: 30, rpm: 85, riding: true });
    const r = run.update(0.1, { pos: sprint.m0 + 2, kmh: 0, rpm: 0, riding: false });
    expect(r.events[0]?.type).toBe("fail");
  });
});
