import { describe, expect, it } from "vitest";
import { decodePolyline, encodePolyline } from "./geo";
import { buildApproxLoop, buildStreetLoop, legAt, nextStop, pointAt } from "./route";

describe("route", () => {
  const r = buildApproxLoop();
  it("builds the six-stage loop", () => {
    expect(r.legs.map((l) => l.to)).toEqual(["Dubai", "Sharjah", "Fujairah", "Hatta", "Al Ain", "Abu Dhabi"]);
    expect(r.total / 1000).toBeGreaterThan(550);
    expect(r.total / 1000).toBeLessThan(750);
    expect(r.loop).toBe(true);
  });
  it("wraps positions around the loop", () => {
    expect(pointAt(r, r.total + 1000).p).toEqual(pointAt(r, 1000).p);
    expect(legAt(r, r.total + 10).to).toBe("Dubai");
    const ns = nextStop(r, r.total - 1000);
    expect(ns.stop.name).toBe("Abu Dhabi");
    expect(ns.dist).toBeCloseTo(1000, -1);
  });
  it("round-trips encoded polylines", () => {
    const pts: [number, number][] = [[54.370487, 24.476525], [55.2708, 25.2048], [56.3265, 25.1288]];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
  });
  it("builds the street loop from an OSRM polyline and leg distances", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 600; i++) pts.push([54 + i * 0.002, 24.5]);
    const s = buildStreetLoop({ poly: encodePolyline(pts), legs: [10, 10, 10, 10, 10, 10], at: 0 });
    expect(s.legs).toHaveLength(6);
    expect(s.legs[3].m0 / s.total).toBeCloseTo(0.5, 1);
  });
});
