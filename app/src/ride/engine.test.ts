import { describe, expect, it } from "vitest";
import { flatProfile } from "../elevation";
import type { Route } from "../route";
import type { Live } from "../sensors/hub";
import { DEFAULTS } from "../store/settings";
import { RideEngine } from "./engine";
import { Ghost } from "./ghost";

function straightRoute(): Route {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 1000; i++) pts.push([55 + i * 0.001, 25]);
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + 100.9;
  const total = cum[pts.length - 1];
  return {
    id: "t", name: "Test", kind: "gpx", loop: false, pts, cum, total,
    legs: [{ from: "A", to: "B", m0: 0, m1: total }], stops: [{ name: "B", m: total, stage: 1, lnglat: pts[1000] }], places: [],
  };
}

function setup(over: Partial<typeof DEFAULTS> = {}) {
  let t = 1_000_000;
  const live: Live = { kmh: 0, speedSource: "cadence", rpm: 0, bpm: null, watts: null, active: true };
  const route = straightRoute();
  const prof = flatProfile(route);
  const settings = { ...DEFAULTS, ...over };
  const engine = new RideEngine({
    input: { read: () => live, takeWheelMeters: () => 0, hasAnySource: () => true, simulating: false },
    route: () => route,
    profile: () => prof,
    settings: () => settings,
    basePos: () => 0,
    ghost: () => new Ghost(null),
    now: () => t,
  });
  const advance = (sec: number, step: number) => {
    for (let s = 0; s < sec - 1e-9; s += step) { t += step * 1000; engine.update(); }
  };
  return { engine, live, advance };
}

describe("RideEngine", () => {
  it("auto-starts when you pedal", () => {
    const { engine, live, advance } = setup({ gradientEffect: false });
    live.kmh = 20; live.rpm = 80;
    advance(1, 0.1);
    expect(engine.state).toBe("idle");
    advance(1, 0.1);
    expect(engine.state).toBe("riding");
  });

  it("keeps exact time and distance no matter how often it is updated", () => {
    const a = setup({ gradientEffect: false });
    const b = setup({ gradientEffect: false });
    for (const s of [a, b]) { s.live.kmh = 36; s.live.rpm = 90; s.engine.start(); }
    a.advance(600, 1 / 60); // smooth 60 fps
    b.advance(600, 2.5); // badly throttled
    expect(a.engine.current.timer).toBeCloseTo(600, 3);
    expect(b.engine.current.timer).toBeCloseTo(600, 3);
    expect(a.engine.current.dist).toBeCloseTo(6000, 0);
    expect(b.engine.current.dist).toBeCloseTo(6000, 0);
  });

  it("auto-pauses when you stop and resumes when you pedal again", () => {
    const { engine, live, advance } = setup({ gradientEffect: false });
    live.kmh = 30; engine.start(); advance(10, 0.1);
    live.kmh = 0; advance(6, 0.1);
    expect(engine.state).toBe("autopaused");
    const timer = engine.current.timer;
    advance(20, 0.5);
    expect(engine.current.timer).toBeCloseTo(timer, 1);
    live.kmh = 25; advance(1, 0.1);
    expect(engine.state).toBe("riding");
  });

  it("records one sample per second and produces a record", () => {
    const { engine, live, advance } = setup({ gradientEffect: true });
    live.kmh = 30; live.rpm = 85; live.bpm = 140;
    engine.start(); advance(120, 0.25);
    const rec = engine.finish()!;
    expect(rec.samples!.t.length).toBeGreaterThanOrEqual(119);
    expect(rec.samples!.t.length).toBeLessThanOrEqual(121);
    expect(rec.avgRpm).toBe(85);
    expect(rec.avgBpm).toBe(140);
    expect(rec.kcal).toBeGreaterThan(10);
    expect(rec.dist).toBeGreaterThan(800); // accelerates from 0 to ~30 km/h
    expect(engine.state).toBe("idle");
  });

  it("does not auto-start again right after finishing while still moving", () => {
    const { engine, live, advance } = setup({ gradientEffect: false });
    live.kmh = 30; engine.start(); advance(60, 0.5);
    engine.finish();
    advance(5, 0.1);
    expect(engine.state).toBe("idle");
    live.kmh = 0; advance(1, 0.1);
    live.kmh = 30; advance(2, 0.1);
    expect(engine.state).toBe("riding");
  });
});
