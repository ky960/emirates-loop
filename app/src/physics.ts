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
 * Virtual bike with real momentum. Your sensor speed is the effort you'd hold on flat ground; that power drives
 * the virtual bike against gravity, rolling resistance and air drag, integrated in small steps.
 *
 * When you stop pedalling you coast like a real bike: slowing quickly uphill, gently on the flat, and gaining
 * speed downhill. Stopping pedalling is detected from cadence when there's a cadence sensor, otherwise from
 * the trainer wheel spinning down. Once the wheel has stopped on flat ground or a climb, the rider brakes to a
 * halt in a few seconds rather than gliding for half a minute.
 */
export class VirtualSpeed {
  v = 0;
  private vsSm = 0;      // smoothed sensor speed (m/s)
  private decel = 0;     // smoothed rate the sensor speed is falling (m/s²; negative when rising)
  private spinFor = 0;   // how long the wheel has been spinning down (s)
  coasting = false;
  constructor(public rider: Rider) {}
  reset() { this.v = this.vsSm = this.decel = this.spinFor = 0; this.coasting = false; }

  /**
   * sensorKmh: flat-equivalent speed from the sensor; rpm: measured cadence, or null without a cadence sensor.
   * Returns the virtual speed (km/h).
   */
  update(dt: number, sensorKmh: number, grade: number, rpm: number | null = null): number {
    const vs = sensorKmh / 3.6;
    if (dt <= 0) return this.v * 3.6;
    // Trend of the sensor speed (it updates about once a second, so smooth before differentiating).
    const prev = this.vsSm;
    this.vsSm += (vs - this.vsSm) * (1 - Math.exp(-dt / 0.5));
    this.decel += ((prev - this.vsSm) / dt - this.decel) * (1 - Math.exp(-dt / 0.6));

    if (vs < 0.3) this.coasting = true;
    else if (rpm !== null) this.coasting = rpm < 15;
    else {
      // Wheel sensor only: a trainer wheel spinning down keeps slowing (fast, or gently for several seconds) when
      // you stop pedalling; one that holds its speed means you're pedalling.
      this.spinFor = this.decel > 0.15 ? this.spinFor + dt : 0;
      if ((this.decel > 0.45 && this.spinFor > 1) || this.spinFor > 2.5) this.coasting = true;
      else if (this.decel < 0.08) this.coasting = false;
    }
    const m = this.rider.massKg + this.rider.bikeKg, th = Math.atan(grade);
    // Pedalling: the power that holds your wheel speed on the flat, plus the extra force that speeds your wheel up
    // (or less while you ease off), so the virtual bike accelerates and slows in step with your effort.
    // Coasting on flat ground or a climb, the bike slows at least as fast as your trainer wheel (indoors, your
    // wheel and legs are the reference); downhill, gravity alone decides and you keep rolling.
    const P = this.coasting ? 0 : powerFor(this.vsSm, 0, this.rider), push = this.coasting ? 0 : -(m + 1.5) * this.decel;
    const follow = this.coasting && grade > -0.02 ? -Math.max(0, this.decel) : 0; // m/s², slowing with the wheel
    // Coasting down to a near stop on flat ground or a climb: you're stopping, so brake (~2.5 m/s², a firm but
    // normal stop) instead of rolling on until the trainer wheel has quite stopped.
    const braking = this.coasting && vs < 10 / 3.6 && grade > -0.02;

    for (let t = 0; t < dt - 1e-9; ) {
      const h = Math.min(0.05, dt - t);
      t += h;
      const drive = Math.max(0, (P * ETA) / Math.max(this.v, 2) + push), resist = m * G * (CRR * Math.cos(th) + Math.sin(th)) + 0.5 * RHO * CDA * this.v * this.v;
      let a = (Math.min(drive, 600) - resist) / (m + 1.5) + follow; // +1.5 kg: wheels' rotating inertia
      if (braking) a -= 2.5;
      // Rolling resistance and brakes hold a stopped bike; they never push it backwards.
      this.v = Math.max(0, this.v + a * h);
      if (this.v < 0.15 && this.coasting && grade > -0.02) this.v = 0;
    }
    this.v = Math.min(this.v, MAX_DESCENT_MS);
    return this.v * 3.6;
  }
}

/** Estimated rider power (W) for a flat-equivalent sensor speed. */
export const estPower = (sensorKmh: number, r: Rider) => (sensorKmh > 1 ? powerFor(sensorKmh / 3.6, 0, r) : 0);
