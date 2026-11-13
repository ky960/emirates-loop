import type { LngLat } from "../geo";
import type { RideRecord } from "../ride/types";

/**
 * Garmin TCX export (Strava, Garmin Connect, TrainingPeaks all import it).
 * Positions are included so the ride shows on the map as a virtual ride along the route.
 */
export function rideToTcx(r: RideRecord, position?: (m: number) => LngLat): string {
  const s = r.samples;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const start = iso(r.start);
  const pts: string[] = [];
  if (s && s.t.length) {
    for (let i = 0; i < s.t.length; i++) {
      const p = position?.(r.startM + s.d[i]);
      const parts = [`<Time>${iso(r.start + s.t[i] * 1000)}</Time>`];
      if (p) parts.push(`<Position><LatitudeDegrees>${p[1].toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${p[0].toFixed(6)}</LongitudeDegrees></Position>`);
      parts.push(`<AltitudeMeters>${(s.e[i] / 10).toFixed(1)}</AltitudeMeters>`);
      parts.push(`<DistanceMeters>${s.d[i].toFixed(1)}</DistanceMeters>`);
      if (s.h[i] > 0) parts.push(`<HeartRateBpm><Value>${s.h[i]}</Value></HeartRateBpm>`);
      if (s.c[i] >= 0) parts.push(`<Cadence>${Math.min(254, s.c[i])}</Cadence>`);
      parts.push(`<Extensions><ns3:TPX><ns3:Speed>${(s.v[i] / 36).toFixed(2)}</ns3:Speed></ns3:TPX></Extensions>`);
      pts.push(`<Trackpoint>${parts.join("")}</Trackpoint>`);
    }
  }
  const hr = r.avgBpm ? `<AverageHeartRateBpm><Value>${r.avgBpm}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${r.maxBpm}</Value></MaximumHeartRateBpm>` : "";
  const cad = r.avgRpm ? `<Cadence>${r.avgRpm}</Cadence>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${start}</Id>
<Lap StartTime="${start}"><TotalTimeSeconds>${r.moving}</TotalTimeSeconds><DistanceMeters>${r.dist}</DistanceMeters><MaximumSpeed>${(r.maxKmh / 3.6).toFixed(2)}</MaximumSpeed><Calories>${r.kcal}</Calories>${hr}<Intensity>Active</Intensity>${cad}<TriggerMethod>Manual</TriggerMethod>
<Track>${pts.join("\n")}</Track></Lap>
<Notes>Emirates Loop indoor ride — ${r.routeName}</Notes>
<Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>Emirates Loop</Name><UnitId>0</UnitId><ProductID>0</ProductID></Creator>
</Activity></Activities></TrainingCenterDatabase>`;
}

export function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
