/**
 * Ambient ride sound, synthesised (no audio files): wind that rises with speed,
 * a freewheel ticking when you coast, and a chime when you reach a stage town.
 */
export class RideAudio {
  private ctx: AudioContext | null = null;
  private wind?: GainNode;
  private windFilter?: BiquadFilterNode;
  private tickGain?: GainNode;
  private master?: GainNode;
  private tickPhase = 0;
  enabled = true;

  /** Must be called from a user gesture (tap) the first time. */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return; }
      this.build();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    // Wind: looping pink-ish noise through a band-pass whose centre follows speed.
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass"; this.windFilter.Q.value = 0.6; this.windFilter.frequency.value = 300;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    src.connect(this.windFilter).connect(this.wind).connect(this.master);
    src.start();
    this.tickGain = ctx.createGain();
    this.tickGain.gain.value = 0.18;
    this.tickGain.connect(this.master);
  }

  /** Call every frame. coasting = moving without pedalling. */
  update(dt: number, kmh: number, coasting: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.wind || !this.windFilter) return;
    const t = ctx.currentTime, on = this.enabled ? 1 : 0;
    const v = Math.min(1, kmh / 55);
    this.wind.gain.setTargetAtTime(on * (v * v * 0.55 + (kmh > 1 ? 0.02 : 0)), t, 0.4);
    this.windFilter.frequency.setTargetAtTime(220 + v * 900, t, 0.4);
    if (on && coasting && kmh > 4) {
      this.tickPhase += dt * (kmh / 3.6 / 2.1) * 24; // ~24 pawl clicks per wheel turn
      while (this.tickPhase >= 1) { this.tickPhase -= 1; this.click(); }
    } else this.tickPhase = 0;
  }

  private click() {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = "square"; o.frequency.value = 3200 + Math.random() * 400;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
    o.connect(g).connect(this.tickGain!);
    o.start(t); o.stop(t + 0.03);
  }

  chime() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.master) return;
    const t = ctx.currentTime;
    [659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.22, t + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 1.2);
      o.connect(g).connect(this.master!);
      o.start(t + i * 0.14); o.stop(t + i * 0.14 + 1.3);
    });
  }

  private tone(f: number, at: number, dur: number, vol: number, type: OscillatorType = "sine", slideTo?: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, at);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master!);
    o.start(at); o.stop(at + dur + 0.05);
  }
  private noise(at: number, dur: number, vol: number, freq: number, q = 0.7) {
    const ctx = this.ctx!, len = Math.ceil(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + dur * 0.15); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(at); src.stop(at + dur);
  }
  private get live() { return !!this.ctx && this.enabled && !!this.master; }

  /** Race countdown: short beeps for 3, 2, 1 and a long high one for GO. */
  countdown(n: number) {
    if (!this.live) return;
    const t = this.ctx!.currentTime;
    if (n > 0) this.tone(880, t, 0.18, 0.28, "triangle");
    else { this.tone(1760, t, 0.6, 0.3, "triangle"); this.noise(t, 0.5, 0.12, 2500); }
  }
  /** Racing heartbeat: a low thud, quicker and louder as the finish nears (urgency 0..1). */
  pulse(urgency: number) {
    if (!this.live) return;
    const t = this.ctx!.currentTime, v = 0.25 + urgency * 0.35;
    this.tone(70, t, 0.22, v, "sine", 42);
    this.tone(70, t + 0.16, 0.2, v * 0.6, "sine", 42);
  }
  /** You passed your rival. */
  whoosh() {
    if (!this.live) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.55, 0.3, 900, 0.9);
    this.tone(520, t + 0.05, 0.35, 0.15, "sawtooth", 1300);
  }
  /** Finish: crowd cheer plus a fanfare that grows with the medal (3 gold, 2 silver, 1 bronze). */
  fanfare(level: number) {
    if (!this.live) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 2.2, 0.22 + level * 0.06, 1400, 0.4); // crowd
    this.noise(t + 0.3, 1.8, 0.12, 3000, 0.5);
    const notes = level >= 3 ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : level === 2 ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
    notes.forEach((f, i) => { this.tone(f, t + i * 0.11, 0.9, 0.2, "triangle"); this.tone(f * 2, t + i * 0.11, 0.5, 0.06, "sine"); });
    if (level >= 3) [1046.5, 1318.5, 1568].forEach((f) => this.tone(f, t + notes.length * 0.11 + 0.1, 1.6, 0.14, "triangle"));
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on && this.wind && this.ctx) this.wind.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }
}
