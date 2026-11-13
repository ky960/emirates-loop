/** One saved ride. Samples are recorded once per second of ride time. */
export interface RideRecord {
  id: string;
  /** Start time (epoch ms). */
  start: number;
  routeId: string;
  routeName: string;
  /** Position on the route when the ride started (m, cumulative across laps). */
  startM: number;
  dist: number;
  /** Timer time (riding, excluding pauses), s. */
  moving: number;
  /** Wall-clock duration from start to finish, s. */
  elapsed: number;
  maxKmh: number;
  avgRpm: number | null;
  avgBpm: number | null;
  maxBpm: number | null;
  /** Seconds in heart-rate zones 1–5 (index 0 = below zone 1). */
  zones: number[];
  kcal: number;
  /** Training load (Banister TRIMP), only with heart rate. */
  load: number | null;
  climb: number;
  /** What measured this ride: wheel, cadence, trainer, hr. */
  sources: string[];
  /** Virtual speed on gradients (true) or sensor speed as-is (false). */
  gradientEffect: boolean;
  samples?: RideSamples;
  /** Imported from the old app (no samples). */
  legacy?: boolean;
  note?: string;
}

export interface RideSamples {
  /** Timer seconds. */
  t: number[];
  /** Distance (m). */
  d: number[];
  /** Speed (km/h ×10, rounded). */
  v: number[];
  /** Cadence rpm, −1 when not measured. */
  c: number[];
  /** Heart rate bpm, −1 when not measured. */
  h: number[];
  /** Elevation (m ×10, rounded). */
  e: number[];
}

export const avgKmh = (r: Pick<RideRecord, "dist" | "moving">) => (r.moving > 0 ? r.dist / 1000 / (r.moving / 3600) : 0);
