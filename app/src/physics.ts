import { clamp } from "./util";

/**
 * Road-cycling physics used to turn the sensor's "flat road" speed into a speed on the
 * route's real gradient. The sensor speed is treated as the effort you'd hold on flat
 * ground; that effort (watts) is then applied to the current gradient.
 */
export interface Rider { massKg: number; bikeKg: number }

const G = 9.81, RHO = 1.2, CRR = 0.004, CDA = 0.36, ETA = 0.97;
export const MAX_DESCENT_MS = 75 / 3.6;

/** Power (W) needed to hold speed v (m/s) on gradient `grade` (0.05 = 5 %). */
export function powerFor(v: number, grade: number, r: Rider): number {
  const m = r.massKg + r.bikeKg, th = Math.atan(grade);
  return ((m * G * (CRR * Math.cos(th) + Math.sin(th)) + 0.5 * RHO * CDA * v * v) * v) / ETA;
}

/** Steady-state speed (m/s) for power P (W) on gradient `grade`. Unique root via bisection. */
export function speedFor(P: number, grade: number, r: Rider): number {
  P = Math.max(0, P);
  let lo = 0, hi = 40;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (powerFor(mid, grade, r) < P) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Virtual-speed model with momentum: each update moves the virtual speed toward the
 * steady-state target with a time constant that is longer when coasting downhill.
 */
export class VirtualSpeed {
  v = 0;
  constructor(public rider: Rider) {}
  reset() { this.v = 0; }
  /** sensorKmh: flat-equivalent speed from the sensor; returns virtual speed (km/h). */
  update(dt: number, sensorKmh: number, grade: number): number {
    const vs = sensorKmh / 3.6;
    let target: number;
    if (vs < 0.3) {
      // Not pedalling: freewheel. Downhill keeps rolling; flat/uphill slows to a stop.
      target = grade < -0.01 ? speedFor(0, grade, this.rider) : 0;
    } else {
      target = speedFor(powerFor(vs, 0, this.rider), grade, this.rider);
    }
    target = clamp(target, 0, MAX_DESCENT_MS);
    const tau = target < this.v ? (vs < 0.3 ? 6 : 2.5) : 2;
    this.v += (target - this.v) * (1 - Math.exp(-dt / tau));
    if (this.v < 0.05 && target === 0) this.v = 0;
    return this.v * 3.6;
  }
}

/** Estimated rider power (W) for a flat-equivalent sensor speed. */
export const estPower = (sensorKmh: number, r: Rider) => (sensorKmh > 1 ? powerFor(sensorKmh / 3.6, 0, r) : 0);
