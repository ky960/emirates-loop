import { Emitter } from "../util";
import { parseCsc, parseHr, parseIndoorBike, RevCounter } from "./parsers";

const SVC = { csc: 0x1816, hr: 0x180d, ftms: 0x1826, battery: 0x180f } as const;
const CHR = { csc: 0x2a5b, hr: 0x2a37, ftms: 0x2ad2, battery: 0x2a19 } as const;

export type SensorKind = "speed" | "cadence" | "hr" | "trainer";
export type SensorStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface SensorInfo {
  id: string;
  name: string;
  status: SensorStatus;
  /** What this device has actually reported so far. */
  kinds: SensorKind[];
  battery?: number;
  note?: string;
  sim?: boolean;
}

export interface Live {
  /** Flat-road-equivalent speed from the sensors (km/h). */
  kmh: number;
  speedSource: "wheel" | "trainer" | "cadence" | null;
  /** Measured cadence (rpm) or null when no crank data. */
  rpm: number | null;
  bpm: number | null;
  watts: number | null;
  /** Any real data in the last few seconds. */
  active: boolean;
}

export interface HubSettings { wheelMm: number; strokeM: number }

const STALE_MS = 3000;
const HR_STALE_MS = 5000;

interface Conn {
  info: SensorInfo;
  device?: BluetoothDevice;
  retry: number;
  timer?: ReturnType<typeof setTimeout>;
  forgotten?: boolean;
}

/** Owns all Bluetooth sensors (any number) and fuses their readings into one live stream. */
export class SensorHub extends Emitter<{ change: SensorInfo[]; data: Live; error: string }> {
  readonly supported = typeof navigator !== "undefined" && !!navigator.bluetooth?.requestDevice;
  private conns = new Map<string, Conn>();
  private wheel = new RevCounter(2 ** 32, 200);
  private crank = new RevCounter(65536, 50);
  private wheelPending = 0; // wheel revolutions not yet consumed by the ride engine
  private hr = { bpm: 0, at: 0, contact: true as boolean | undefined };
  private trainer = { kmh: 0, rpm: 0, watts: 0, at: 0, hasRpm: false, hasW: false };
  private lastAny = 0;

  constructor(private settings: () => HubSettings) { super(); }

  list(): SensorInfo[] { return [...this.conns.values()].map((c) => ({ ...c.info, kinds: [...c.info.kinds] })); }

  /** Live, fused readings at time `now` (ms). */
  read(now = Date.now()): Live {
    const s = this.settings();
    let kmh = 0, speedSource: Live["speedSource"] = null, rpm: number | null = null, watts: number | null = null;
    const wheelFresh = this.wheel.lastEvent > 0 && now - this.wheel.lastEvent < STALE_MS;
    const crankFresh = this.crank.lastEvent > 0 && now - this.crank.lastEvent < STALE_MS;
    const trainerFresh = now - this.trainer.at < STALE_MS;
    const haveWheel = this.has("speed"), haveCrank = this.has("cadence"), haveTrainer = this.has("trainer");
    if (haveWheel) { kmh = wheelFresh ? this.wheel.rate * (s.wheelMm / 1000) * 3.6 : 0; speedSource = "wheel"; }
    else if (haveTrainer) { kmh = trainerFresh ? this.trainer.kmh : 0; speedSource = "trainer"; }
    if (haveCrank) rpm = crankFresh ? this.crank.rate * 60 : 0;
    else if (haveTrainer && this.trainer.hasRpm) rpm = trainerFresh ? this.trainer.rpm : 0;
    if (!speedSource && rpm !== null) { kmh = (rpm / 60) * s.strokeM * 3.6; speedSource = "cadence"; }
    if (haveTrainer && this.trainer.hasW) watts = trainerFresh ? this.trainer.watts : 0;
    const bpm = this.hr.bpm > 0 && now - this.hr.at < HR_STALE_MS && this.hr.contact !== false ? this.hr.bpm : null;
    return { kmh, speedSource, rpm, bpm, watts, active: now - this.lastAny < STALE_MS };
  }

  /** Wheel distance (m) measured since the last call — exact revolution counting for speed sensors. */
  takeWheelMeters(): number {
    const m = this.wheelPending * (this.settings().wheelMm / 1000);
    this.wheelPending = 0;
    return m;
  }

  has(kind: SensorKind): boolean {
    for (const c of this.conns.values()) if (c.info.status === "connected" && c.info.kinds.includes(kind)) return true;
    return false;
  }

  hasAnySource(): boolean {
    return this.has("speed") || this.has("cadence") || this.has("trainer");
  }

  // ---------- Bluetooth ----------

  /** Opens the browser's device chooser and connects the chosen sensor. */
  async add(): Promise<void> {
    if (!this.supported) throw new Error("This browser has no Web Bluetooth. Use Chrome on Android.");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SVC.csc] }, { services: [SVC.hr] }, { services: [SVC.ftms] }],
      optionalServices: [SVC.csc, SVC.hr, SVC.ftms, SVC.battery],
    });
    await this.attachDevice(device);
  }

  /** Reconnect sensors the browser already has permission for (Chrome's getDevices). */
  async restore(rememberedIds: string[]): Promise<void> {
    const bt = navigator.bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };
    if (!bt?.getDevices) return;
    try {
      const devices = await bt.getDevices();
      for (const d of devices) if (rememberedIds.includes(d.id) && !this.conns.has(d.id)) this.attachDevice(d).catch(() => {});
    } catch { /* not available */ }
  }

  private async attachDevice(device: BluetoothDevice) {
    let c = this.conns.get(device.id);
    if (!c) {
      c = { info: { id: device.id, name: device.name || "Sensor", status: "connecting", kinds: [] }, device, retry: 0 };
      this.conns.set(device.id, c);
      device.addEventListener("gattserverdisconnected", () => this.onDisconnect(device.id));
    }
    c.forgotten = false;
    c.info.status = "connecting";
    this.changed();
    try {
      await this.subscribe(c);
      c.retry = 0;
      c.info.status = "connected";
      c.info.note = undefined;
      this.changed();
    } catch (e) {
      c.info.status = "disconnected";
      c.info.note = friendlyError(e);
      this.changed();
      try { device.gatt?.disconnect(); } catch { /* ignore */ }
      throw e;
    }
  }

  private async subscribe(c: Conn) {
    const server = await c.device!.gatt!.connect();
    const services = await server.getPrimaryServices().catch(() => [] as BluetoothRemoteGATTService[]);
    const uuids = new Set(services.map((s) => s.uuid));
    const u = (n: number) => BluetoothUUID.getService(n);
    let any = false;
    if (uuids.has(u(SVC.ftms))) {
      const ch = await (await server.getPrimaryService(SVC.ftms)).getCharacteristic(CHR.ftms);
      ch.addEventListener("characteristicvaluechanged", (e) => this.onFtms(c, (e.target as BluetoothRemoteGATTCharacteristic).value!));
      await ch.startNotifications();
      any = true;
    } else if (uuids.has(u(SVC.csc))) {
      const ch = await (await server.getPrimaryService(SVC.csc)).getCharacteristic(CHR.csc);
      ch.addEventListener("characteristicvaluechanged", (e) => this.onCsc(c, (e.target as BluetoothRemoteGATTCharacteristic).value!));
      await ch.startNotifications();
      any = true;
    }
    if (uuids.has(u(SVC.hr))) {
      const ch = await (await server.getPrimaryService(SVC.hr)).getCharacteristic(CHR.hr);
      ch.addEventListener("characteristicvaluechanged", (e) => this.onHr(c, (e.target as BluetoothRemoteGATTCharacteristic).value!));
      await ch.startNotifications();
      any = true;
    }
    if (!any) throw new Error("This device doesn't offer speed, cadence, heart rate or trainer data.");
    if (uuids.has(u(SVC.battery))) {
      try {
        const v = await (await (await server.getPrimaryService(SVC.battery)).getCharacteristic(CHR.battery)).readValue();
        c.info.battery = v.getUint8(0);
      } catch { /* optional */ }
    }
  }

  private onDisconnect(id: string) {
    const c = this.conns.get(id);
    if (!c || c.forgotten) return;
    c.info.status = "reconnecting";
    this.changed();
    const delay = Math.min(30000, 1000 * 2 ** c.retry++);
    clearTimeout(c.timer);
    c.timer = setTimeout(async () => {
      if (c.forgotten) return;
      try {
        await this.subscribe(c);
        c.retry = 0;
        c.info.status = "connected";
        this.changed();
      } catch {
        this.onDisconnect(id);
      }
    }, delay);
  }

  /** Disconnect and stop reconnecting to one sensor. */
  forget(id: string) {
    const c = this.conns.get(id);
    if (!c) return;
    c.forgotten = true;
    clearTimeout(c.timer);
    if (c.info.sim) this.stopSim();
    try { c.device?.gatt?.disconnect(); } catch { /* ignore */ }
    this.conns.delete(id);
    if (!this.has("speed")) this.wheel.reset();
    if (!this.has("cadence")) this.crank.reset();
    this.changed();
  }

  private mark(c: Conn, k: SensorKind) {
    if (!c.info.kinds.includes(k)) { c.info.kinds.push(k); this.changed(); }
  }

  private onCsc(c: Conn, dv: DataView) {
    const now = Date.now(), r = parseCsc(dv);
    if (r.wheelRevs !== undefined) { this.mark(c, "speed"); this.wheelPending += this.wheel.push(r.wheelRevs, r.wheelTime!, now); }
    if (r.crankRevs !== undefined) { this.mark(c, "cadence"); this.crank.push(r.crankRevs, r.crankTime!, now); }
    this.lastAny = now;
    this.emit("data", this.read(now));
  }

  private onHr(c: Conn, dv: DataView) {
    const now = Date.now(), r = parseHr(dv);
    this.mark(c, "hr");
    if (r.bpm > 0) { this.hr.bpm = r.bpm; this.hr.at = now; }
    this.hr.contact = r.contact;
    this.emit("data", this.read(now));
  }

  private onFtms(c: Conn, dv: DataView) {
    const now = Date.now(), r = parseIndoorBike(dv);
    this.mark(c, "trainer");
    if (r.kmh !== undefined) this.trainer.kmh = r.kmh;
    if (r.rpm !== undefined) { this.trainer.rpm = r.rpm; this.trainer.hasRpm = true; }
    if (r.watts !== undefined) { this.trainer.watts = r.watts; this.trainer.hasW = true; }
    if (r.hr) { this.hr.bpm = r.hr; this.hr.at = now; this.hr.contact = true; }
    this.trainer.at = now;
    this.lastAny = now;
    this.emit("data", this.read(now));
  }

  private changed() { this.emit("change", this.list()); }

  // ---------- Simulated sensors (for trying the app without a bike) ----------
  private sim: { timer?: ReturnType<typeof setInterval>; wr: number; wt: number; cr: number; ct: number; hr: number; t: number } | null = null;
  simTarget = { kmh: 28, mode: "speed+hr" as SimMode };

  startSim(mode: SimMode) {
    this.stopSim();
    this.simTarget.mode = mode;
    const id = "sim";
    const kinds: SensorKind[] = [];
    if (mode.includes("speed")) kinds.push("speed");
    if (mode.includes("cadence")) kinds.push("cadence");
    if (mode.includes("hr")) kinds.push("hr");
    this.conns.set(id, { info: { id, name: "Simulated sensors", status: "connected", kinds, sim: true }, retry: 0 });
    this.sim = { wr: 0, wt: 0, cr: 0, ct: 0, hr: 95, t: 0 };
    this.wheel.reset(); this.crank.reset();
    const fake = this.conns.get(id)!;
    let wAcc = 0, cAcc = 0, last = performance.now();
    // 4 Hz like a real sensor; counters advance in whole revolutions with matching event times.
    this.sim.timer = setInterval(() => {
      const s = this.sim!, nowP = performance.now(), dt = Math.min(1, (nowP - last) / 1000);
      last = nowP; s.t += dt;
      const kmh = Math.max(0, this.simTarget.kmh + Math.sin(s.t / 6) * 0.8);
      const wheelHz = kmh / 3.6 / (this.settings().wheelMm / 1000), crankHz = kmh > 0.5 ? (kmh / 3.6 / 6.2) * (1 + Math.sin(s.t / 4) * 0.03) : 0;
      wAcc += wheelHz * dt; cAcc += crankHz * dt;
      const now = Date.now();
      if (mode.includes("speed") && wAcc >= 1) {
        const n = Math.floor(wAcc); wAcc -= n; s.wr += n; s.wt = (s.wt + Math.round((n / wheelHz) * 1024)) % 65536;
        const b = new DataView(new ArrayBuffer(7)); b.setUint8(0, 1); b.setUint32(1, s.wr >>> 0, true); b.setUint16(5, s.wt, true);
        this.onCsc(fake, b);
      }
      if (mode.includes("cadence") && cAcc >= 1) {
        const n = Math.floor(cAcc); cAcc -= n; s.cr = (s.cr + n) % 65536; s.ct = (s.ct + Math.round((n / crankHz) * 1024)) % 65536;
        const b = new DataView(new ArrayBuffer(5)); b.setUint8(0, 2); b.setUint16(1, s.cr, true); b.setUint16(3, s.ct, true);
        this.onCsc(fake, b);
      }
      if (mode.includes("hr")) {
        const target = 70 + Math.pow(kmh / 40, 1.6) * 105;
        s.hr += (target - s.hr) * (1 - Math.exp(-dt / 25));
        const b = new DataView(new ArrayBuffer(2)); b.setUint8(0, 0); b.setUint8(1, Math.round(s.hr + Math.sin(s.t) * 1.2));
        this.onHr(fake, b);
      }
      this.lastAny = now;
    }, 250);
    this.changed();
  }

  stopSim() {
    if (!this.sim) return;
    clearInterval(this.sim.timer);
    this.sim = null;
    this.conns.delete("sim");
    this.wheel.reset(); this.crank.reset(); this.hr.at = 0;
    this.changed();
  }

  get simulating() { return !!this.sim; }
}

export type SimMode = "speed" | "cadence" | "speed+hr" | "cadence+hr" | "speed+cadence+hr";

function friendlyError(e: unknown): string {
  const err = e as { name?: string; message?: string };
  if (err?.name === "NotFoundError") return "No sensor chosen.";
  if (err?.name === "SecurityError" || err?.name === "NotAllowedError")
    return "Bluetooth was blocked. Allow Bluetooth for Chrome and try again.";
  if (err?.name === "NetworkError")
    return "Couldn't connect. Make sure no other app (Zepp, Zwift, CYCPLUS) is connected to this sensor, then try again.";
  if (/encrypt|auth|bond|insufficient/i.test(err?.message ?? ""))
    return "The sensor needs pairing. Pair it once in Android Bluetooth settings, then add it here again.";
  return err?.message || String(e);
}
