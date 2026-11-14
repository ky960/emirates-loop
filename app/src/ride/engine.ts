import { eleAt, gradeAt, type ElevationProfile } from "../elevation";
import { estPower, VirtualSpeed } from "../physics";
import type { Route, Stop } from "../route";
import { wrapM } from "../route";
import type { Live } from "../sensors/hub";
import type { Settings } from "../store/settings";
import { maxHrOf } from "../store/settings";
import { ema, Emitter, mod } from "../util";
import { Ghost } from "./ghost";
import { hrZone, kcalFromWork, kcalPerMinHr, trimp } from "./metrics";
import type { RideRecord, RideSamples } from "./types";

export type RideState = "idle" | "riding" | "paused" | "autopaused";

export interface Input {
  read(now: number): Live;
  takeWheelMeters(): number;
  hasAnySource(): boolean;
  readonly simulating: boolean;
}

export interface EngineDeps {
  input: Input;
  route: () => Route;
  profile: () => ElevationProfile;
  settings: () => Settings;
  /** Route position (m, cumulative) where the next ride starts: total of saved rides. */
  basePos: () => number;
  ghost: () => Ghost;
  now?: () => number;
}

/** Everything the UI and the 3D views need for one frame. */
export interface Frame {
  state: RideState;
  /** Speed you're moving at on the route (km/h). */
  kmh: number;
  /** Speed from the sensor before gradient (km/h). */
  sensorKmh: number;
  rpm: number | null;
  /** Cadence for animating the legs (measured, or estimated from speed). */
  animRpm: number;
  bpm: number | null;
  zone: number;
  watts: number | null;
  wattsEstimated: boolean;
  grade: number;
  ele: number;
  dist: number;
  timer: number;
  elapsed: number;
  /** Cumulative route position (m). */
  pos: number;
  /** Where this ride started (m, cumulative); before a ride, where the next one will start. */
  startM: number;
  ghostOn: boolean;
  ghostPos: number;
  /** Ghost minus you (m): positive = ghost ahead. */
  ghostGap: number;
  speedSource: Live["speedSource"];
  sim: boolean;
}

interface Acc {
  startWall: number;
  startM: number;
  dist: number;
  timer: number;
  elapsed: number;
  maxKmh: number;
  rpmSum: number; rpmT: number;
  bpmSum: number; bpmT: number; maxBpm: number;
  zones: number[];
  kcal: number;
  load: number;
  climb: number;
  sources: string[];
  sim: boolean;
  gradientEffect: boolean;
  nextSampleT: number;
  samples: RideSamples;
  lastEle: number;
}

const CHECKPOINT_MS = 5000;

export class RideEngine extends Emitter<{ state: RideState; arrival: Stop; checkpoint: object; autostart: void }> {
  state: RideState = "idle";
  private acc: Acc | null = null;
  private last = 0;
  private vs: VirtualSpeed;
  private displayKmh = 0;
  private moveFor = 0;
  private stillFor = 0;
  private autoArmed = true;
  private lastCheckpoint = 0;
  private frame: Frame;
  private now: () => number;

  constructor(private d: EngineDeps) {
    super();
    this.now = d.now ?? Date.now;
    this.vs = new VirtualSpeed({ massKg: d.settings().weightKg, bikeKg: 9 });
    this.frame = this.emptyFrame();
    this.last = this.now();
  }

  get current(): Frame { return this.frame; }
  get active() { return this.state !== "idle"; }
  get isSim() { return this.acc?.sim ?? this.d.input.simulating; }

  private emptyFrame(): Frame {
    const pos = this.d.basePos();
    return {
      state: "idle", kmh: 0, sensorKmh: 0, rpm: null, animRpm: 0, bpm: null, zone: 0, watts: null, wattsEstimated: false,
      grade: 0, ele: 0, dist: 0, timer: 0, elapsed: 0, pos, startM: pos, ghostOn: false, ghostPos: pos, ghostGap: 0, speedSource: null, sim: false,
    };
  }

  private setState(s: RideState) {
    if (s === this.state) return;
    this.state = s;
    this.emit("state", s);
  }

  start() {
    if (this.state === "idle") {
      const s = this.d.settings();
      this.vs.rider.massKg = s.weightKg;
      this.acc = {
        startWall: this.now(), startM: this.d.basePos(), dist: 0, timer: 0, elapsed: 0, maxKmh: 0,
        rpmSum: 0, rpmT: 0, bpmSum: 0, bpmT: 0, maxBpm: 0, zones: [0, 0, 0, 0, 0, 0], kcal: 0, load: 0, climb: 0,
        sources: [], sim: this.d.input.simulating, gradientEffect: s.gradientEffect, nextSampleT: 0,
        samples: { t: [], d: [], v: [], c: [], h: [], e: [] }, lastEle: NaN,
      };
      this.d.input.takeWheelMeters();
      this.lastCheckpoint = this.now();
    }
    this.setState("riding");
  }

  pause() { if (this.state === "riding" || this.state === "autopaused") this.setState("paused"); }
  resume() { if (this.state === "paused" || this.state === "autopaused") { this.stillFor = 0; this.setState("riding"); } }

  /** End the ride and return the record to save (or null if too short). Engine returns to idle. */
  finish(): RideRecord | null {
    const a = this.acc;
    const rec = a && a.dist >= 50 ? this.toRecord(a) : null;
    this.reset();
    return rec;
  }

  /** The ride so far as a record, without ending it. */
  preview(): RideRecord | null { return this.acc ? this.toRecord(this.acc) : null; }

  discard() { this.reset(); }

  private reset() {
    this.acc = null;
    this.vs.reset();
    this.displayKmh = 0;
    this.autoArmed = false; // wait until the wheels stop before auto-starting again
    this.setState("idle");
    this.frame = this.emptyFrame();
  }

  private toRecord(a: Acc): RideRecord {
    return {
      id: `r${a.startWall.toString(36)}`,
      start: a.startWall,
      routeId: this.d.route().id,
      routeName: this.d.route().name,
      startM: a.startM,
      dist: Math.round(a.dist),
      moving: Math.round(a.timer),
      elapsed: Math.round(a.elapsed),
      maxKmh: +a.maxKmh.toFixed(1),
      avgRpm: a.rpmT > 30 ? Math.round(a.rpmSum / a.rpmT) : null,
      avgBpm: a.bpmT > 30 ? Math.round(a.bpmSum / a.bpmT) : null,
      maxBpm: a.bpmT > 30 ? a.maxBpm : null,
      zones: a.zones.map(Math.round),
      kcal: Math.round(a.kcal),
      load: a.bpmT > 30 ? Math.round(a.load) : null,
      climb: Math.round(a.climb),
      sources: a.sources,
      gradientEffect: a.gradientEffect,
      samples: a.samples,
    };
  }

  /** Snapshot for crash recovery. */
  checkpoint(): object | null {
    if (!this.acc) return null;
    return { v: 1, state: this.state, acc: this.acc, savedAt: this.now(), routeId: this.d.route().id };
  }

  /** Resume a ride from a checkpoint (paused, so the rider chooses when to continue). */
  restore(cp: { v: number; acc: Acc; routeId: string }) {
    if (cp?.v !== 1 || !cp.acc) return false;
    this.acc = cp.acc;
    this.vs.reset();
    this.autoArmed = true;
    // Auto-paused, so simply pedalling picks the ride back up.
    this.setState("autopaused");
    this.last = this.now();
    this.update();
    return true;
  }

  /** Advance the ride to the current wall-clock time. Safe to call at any rate. */
  update(): Frame {
    const now = this.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0;
    const route = this.d.route(), prof = this.d.profile(), s = this.d.settings();
    const live = this.d.input.read(now);

    // ---- auto start / pause ----
    if (live.kmh < 1) this.autoArmed = true;
    if (this.state === "idle") {
      if (this.d.input.hasAnySource() && live.kmh > 3 && this.autoArmed) {
        this.moveFor += dt;
        if (this.moveFor > 1.5) { this.moveFor = 0; this.start(); this.emit("autostart", undefined); }
      } else this.moveFor = 0;
    } else if (this.state === "riding" && s.autoPause) {
      if (live.kmh < 1 && this.vs.v < 0.3) { this.stillFor += dt; if (this.stillFor > 4) this.setState("autopaused"); }
      else this.stillFor = 0;
    } else if (this.state === "autopaused" && live.kmh > 2) {
      this.stillFor = 0;
      this.setState("riding");
    }

    const a = this.acc;
    const wheelM = this.d.input.takeWheelMeters();
    // Integrate in ≤1 s steps so a long gap (tab in background) is handled smoothly.
    let remaining = Math.min(dt, 3600), kmh = this.frame.kmh;
    const prevPos = a ? a.startM + a.dist : this.d.basePos();
    const grade0 = gradeAt(prof, route.total, prevPos);
    while (remaining > 0) {
      const h = Math.min(1, remaining);
      remaining -= h;
      if (a) a.elapsed += h;
      if (!a || this.state !== "riding") { kmh = 0; continue; }
      const pos = a.startM + a.dist, grade = gradeAt(prof, route.total, pos);
      let step: number;
      if (a.gradientEffect) {
        kmh = this.vs.update(h, live.kmh, grade, live.rpm);
        step = (kmh / 3.6) * h;
      } else {
        kmh = live.kmh;
        step = live.speedSource === "wheel" ? 0 : (kmh / 3.6) * h;
      }
      a.dist += step;
      a.timer += h;
      a.maxKmh = Math.max(a.maxKmh, kmh);
      if (live.rpm && live.rpm > 0) { a.rpmSum += live.rpm * h; a.rpmT += h; }
      if (live.bpm) {
        const mhr = maxHrOf(s);
        a.bpmSum += live.bpm * h; a.bpmT += h; a.maxBpm = Math.max(a.maxBpm, live.bpm);
        a.zones[hrZone(live.bpm, mhr)] += h;
        a.load += trimp(h, live.bpm, s.restHr, mhr, s.sex);
        a.kcal += (kcalPerMinHr(live.bpm, s.weightKg, s.age, s.sex) * h) / 60;
      } else {
        a.kcal += kcalFromWork((live.watts ?? estPower(live.kmh, this.vs.rider)) * h);
      }
      this.recordSources(a, live);
    }
    if (a && this.state === "riding" && !a.gradientEffect && wheelM > 0) a.dist += wheelM;

    // ---- per-frame derived values ----
    const pos = a ? a.startM + a.dist : this.d.basePos();
    if (a) {
      const e = eleAt(prof, route.total, pos);
      if (isFinite(a.lastEle) && e > a.lastEle) a.climb += e - a.lastEle;
      a.lastEle = e;
      while (a.timer >= a.nextSampleT && this.state === "riding") {
        const sm = a.samples;
        sm.t.push(Math.round(a.nextSampleT));
        sm.d.push(Math.round(a.dist));
        sm.v.push(Math.round(kmh * 10));
        sm.c.push(live.rpm !== null ? Math.round(live.rpm) : -1);
        sm.h.push(live.bpm ?? -1);
        sm.e.push(Math.round(e * 10));
        a.nextSampleT += 1;
      }
      this.detectArrivals(route, prevPos, pos);
      if (now - this.lastCheckpoint > CHECKPOINT_MS) {
        this.lastCheckpoint = now;
        const cp = this.checkpoint();
        if (cp) this.emit("checkpoint", cp);
      }
    }
    this.displayKmh += (kmh - this.displayKmh) * ema(dt, 0.6);
    if (kmh === 0 && this.displayKmh < 0.2) this.displayKmh = 0;

    const ghostOn = !!a && s.ghost;
    const ghostDist = a ? this.d.ghost().distAt(a.timer) : 0;
    const ghostPos = a ? a.startM + ghostDist : pos;
    const animRpm = live.rpm !== null ? live.rpm : estimateCadence(kmh);
    const watts = live.watts ?? (s.showPower && live.kmh > 1 ? estPower(live.kmh, this.vs.rider) : null);
    this.frame = {
      state: this.state,
      kmh: this.state === "idle" ? live.kmh : this.displayKmh,
      sensorKmh: live.kmh,
      rpm: live.rpm,
      animRpm: this.state === "idle" ? estimateCadence(live.kmh, live.rpm) : animRpm,
      bpm: live.bpm,
      zone: live.bpm ? hrZone(live.bpm, maxHrOf(s)) : 0,
      watts: watts !== null ? Math.round(watts) : null,
      wattsEstimated: live.watts === null,
      grade: a ? gradeAt(prof, route.total, pos) : grade0,
      ele: eleAt(prof, route.total, pos),
      dist: a?.dist ?? 0,
      timer: a?.timer ?? 0,
      elapsed: a?.elapsed ?? 0,
      pos,
      startM: a ? a.startM : pos,
      ghostOn,
      ghostPos,
      ghostGap: ghostOn ? ghostPos - pos : 0,
      speedSource: live.speedSource,
      sim: a?.sim ?? this.d.input.simulating,
    };
    return this.frame;
  }

  private recordSources(a: Acc, live: Live) {
    const add = (k: string) => { if (!a.sources.includes(k)) a.sources.push(k); };
    if (live.speedSource) add(live.speedSource);
    if (live.rpm !== null && live.speedSource !== "cadence") add("cadence");
    if (live.bpm !== null) add("hr");
    if (a.sim) add("sim");
  }

  private detectArrivals(route: Route, m0: number, m1: number) {
    if (m1 <= m0) return;
    for (const st of route.stops) {
      const crossed = route.loop
        ? Math.floor((m0 - st.m) / route.total) !== Math.floor((m1 - st.m) / route.total)
        : m0 < st.m && m1 >= st.m;
      if (crossed) this.emit("arrival", st);
    }
  }
}

/** Plausible pedalling cadence for a speed, for animation when no cadence sensor is present. */
export function estimateCadence(kmh: number, measured: number | null = null): number {
  if (measured !== null) return measured;
  if (kmh < 2) return 0;
  // ~6.2 m per crank turn (mid gear), held between 55 and 105 rpm.
  return Math.min(105, Math.max(55, (kmh / 3.6 / 6.2) * 60));
}

/** Loop-relative position helper. */
export const lapPos = (route: Route, m: number) => (route.loop ? mod(m, route.total) : wrapM(route, m));
