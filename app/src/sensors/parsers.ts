/** Pure Bluetooth GATT payload parsers. All little-endian per the Bluetooth SIG specs. */

export interface CscRaw {
  wheelRevs?: number; // cumulative uint32
  wheelTime?: number; // last wheel event, 1/1024 s, uint16
  crankRevs?: number; // cumulative uint16
  crankTime?: number; // last crank event, 1/1024 s, uint16
}

/** CSC Measurement (0x2A5B). */
export function parseCsc(dv: DataView): CscRaw {
  const f = dv.getUint8(0);
  let o = 1;
  const out: CscRaw = {};
  if (f & 1 && dv.byteLength >= o + 6) {
    out.wheelRevs = dv.getUint32(o, true);
    out.wheelTime = dv.getUint16(o + 4, true);
    o += 6;
  }
  if (f & 2 && dv.byteLength >= o + 4) {
    out.crankRevs = dv.getUint16(o, true);
    out.crankTime = dv.getUint16(o + 2, true);
  }
  return out;
}

export interface HrRaw {
  bpm: number;
  contact?: boolean; // undefined when the sensor doesn't support contact detection
  energyKj?: number;
  rr: number[]; // seconds
}

/** Heart Rate Measurement (0x2A37). */
export function parseHr(dv: DataView): HrRaw {
  const f = dv.getUint8(0);
  let o = 1;
  let bpm: number;
  if (f & 1) { bpm = dv.getUint16(o, true); o += 2; } else { bpm = dv.getUint8(o); o += 1; }
  const contactSupported = !!(f & 4);
  const out: HrRaw = { bpm, rr: [], contact: contactSupported ? !!(f & 2) : undefined };
  if (f & 8 && dv.byteLength >= o + 2) { out.energyKj = dv.getUint16(o, true); o += 2; }
  if (f & 16) {
    while (dv.byteLength >= o + 2) { out.rr.push(dv.getUint16(o, true) / 1024); o += 2; }
  }
  return out;
}

export interface FtmsRaw { kmh?: number; rpm?: number; watts?: number; hr?: number }

/** FTMS Indoor Bike Data (0x2AD2). */
export function parseIndoorBike(dv: DataView): FtmsRaw {
  const f = dv.getUint16(0, true);
  let o = 2;
  const out: FtmsRaw = {};
  const has = (n: number) => dv.byteLength >= o + n;
  if (!(f & 0x0001) && has(2)) { out.kmh = dv.getUint16(o, true) / 100; o += 2; } // instantaneous speed (present when "more data" = 0)
  if (f & 0x0002) o += 2; // average speed
  if (f & 0x0004 && has(2)) { out.rpm = dv.getUint16(o, true) / 2; o += 2; }
  if (f & 0x0008) o += 2; // average cadence
  if (f & 0x0010) o += 3; // total distance
  if (f & 0x0020) o += 2; // resistance level
  if (f & 0x0040 && has(2)) { out.watts = dv.getInt16(o, true); o += 2; }
  if (f & 0x0080) o += 2; // average power
  if (f & 0x0100) o += 5; // expended energy
  if (f & 0x0200 && has(1)) { out.hr = dv.getUint8(o); o += 1; }
  return out;
}

/**
 * Turns successive cumulative CSC counters into rates, handling counter roll-over,
 * repeated notifications (no new event) and implausible jumps (sensor reset).
 */
export class RevCounter {
  private revs: number | null = null;
  private time: number | null = null;
  /** Wall-clock ms when the counter last advanced. */
  lastEvent = 0;
  /** Revolutions per second from the latest valid delta. */
  rate = 0;

  constructor(private revMod: number, private maxDelta: number) {}

  /** Returns revolutions added since the previous sample (0 if none / invalid). */
  push(revs: number, time1024: number, now: number): number {
    if (this.revs === null || this.time === null) {
      this.revs = revs; this.time = time1024; this.lastEvent = now;
      return 0;
    }
    const dr = (revs - this.revs + this.revMod) % this.revMod;
    const dt = ((time1024 - this.time + 65536) % 65536) / 1024;
    this.revs = revs;
    this.time = time1024;
    if (dr === 0 || dt === 0) return 0; // repeat of the previous event
    if (dr > this.maxDelta || dt > 8) { this.rate = 0; return 0; } // reset or long gap
    this.rate = dr / dt;
    this.lastEvent = now;
    return dr;
  }

  /**
   * Rate at wall-clock time `now`: once the next revolution is overdue, the wheel (or crank) can be turning at
   * most one revolution per time elapsed, so the rate falls away as soon as it stops instead of holding.
   */
  rateAt(now: number): number {
    if (!this.lastEvent || this.rate <= 0) return 0;
    const el = (now - this.lastEvent) / 1000;
    return el > 1.5 / this.rate ? Math.min(this.rate, 1 / el) : this.rate;
  }

  reset() { this.revs = this.time = null; this.rate = 0; this.lastEvent = 0; }
}
