/** Confetti burst on a canvas over the ride view: paper pieces that tumble, flutter and fall, then stop drawing. */
export class Confetti {
  private parts: Array<{ x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; c: string; t: number }> = [];
  private running = false;
  constructor(private cv: HTMLCanvasElement) {}

  burst(n = 150, colors = ["#f0622e", "#ffc400", "#2ec4b6", "#ffffff", "#b45cff", "#7cf0a0"]) {
    const W = (this.cv.width = this.cv.clientWidth * devicePixelRatio), H = (this.cv.height = this.cv.clientHeight * devicePixelRatio);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, a = -Math.PI / 2 + side * (0.25 + Math.random() * 0.6);
      const sp = (0.9 + Math.random() * 0.9) * H * 0.9;
      this.parts.push({ x: W / 2 + side * W * 0.18, y: H * 0.62, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, w: (6 + Math.random() * 8) * devicePixelRatio, h: (3 + Math.random() * 5) * devicePixelRatio, c: colors[i % colors.length], t: 0 });
    }
    if (!this.running) { this.running = true; let last = performance.now(); const tick = (now: number) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (this.step(dt)) requestAnimationFrame(tick); else this.running = false; }; requestAnimationFrame(tick); }
  }

  private step(dt: number): boolean {
    const g = this.cv.getContext("2d")!, H = this.cv.height;
    g.clearRect(0, 0, this.cv.width, H);
    this.parts = this.parts.filter((p) => p.y < H + 40 && p.t < 6);
    for (const p of this.parts) {
      p.t += dt;
      p.vy += H * 0.9 * dt; // gravity
      p.vx *= 1 - 1.2 * dt; p.vy *= 1 - 1.4 * dt; // air drag: flutter down
      p.x += (p.vx + Math.sin(p.t * 6 + p.r) * 40) * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(1, Math.cos(p.t * 9 + p.r)); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
    }
    return this.parts.length > 0;
  }
}
