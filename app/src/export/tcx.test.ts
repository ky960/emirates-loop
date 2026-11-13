import { describe, expect, it } from "vitest";
import { rideToTcx } from "./tcx";
import type { RideRecord } from "../ride/types";

describe("TCX export", () => {
  it("writes trackpoints with HR, cadence and position", () => {
    const r: RideRecord = {
      id: "x", start: Date.UTC(2026, 10, 13, 6, 0, 0), routeId: "loop", routeName: "Emirates Loop", startM: 0, dist: 20,
      moving: 2, elapsed: 2, maxKmh: 36, avgRpm: 85, avgBpm: 140, maxBpm: 141, zones: [0, 0, 0, 2, 0, 0], kcal: 1, load: 1, climb: 0,
      sources: ["wheel", "hr"], gradientEffect: true,
      samples: { t: [0, 1], d: [0, 10], v: [360, 360], c: [85, -1], h: [140, -1], e: [55, 56] },
    };
    const x = rideToTcx(r, (m) => [55 + m / 1e5, 25]);
    expect(x).toContain("<Id>2026-11-13T06:00:00Z</Id>");
    expect(x.match(/<Trackpoint>/g)!.length).toBe(2);
    expect(x).toContain("<HeartRateBpm><Value>140</Value></HeartRateBpm><Cadence>85</Cadence>");
    expect(x).toContain("<LongitudeDegrees>55.000100</LongitudeDegrees>");
    expect(x).toContain("<ns3:Speed>10.00</ns3:Speed>");
    expect(x.split("<HeartRateBpm>").length).toBe(2); // only the first sample has heart rate
  });
});
