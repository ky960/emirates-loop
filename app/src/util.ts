export const TAU = Math.PI * 2;
export const D2R = Math.PI / 180;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Deterministic PRNG (mulberry32). */
export const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const hash01 = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898e3 + y * 78.233e3) * 43758.5453;
  return s - Math.floor(s);
};

export function fmtDuration(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function fmtShortDuration(sec: number): string {
  if (sec >= 3600) return `${(sec / 3600).toFixed(1)} h`;
  return `${Math.round(sec / 60)} min`;
}

export function fmtKm(m: number, digits = 1): string {
  return (m / 1000).toFixed(digits);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Positive modulo. */
export const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Exponential smoothing factor for a time constant tau (seconds) over dt. */
export const ema = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-6, tau));

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let h: ReturnType<typeof setTimeout> | undefined;
  return ((...a: any[]) => {
    clearTimeout(h);
    h = setTimeout(() => fn(...a), ms);
  }) as T;
}

/** Tiny typed event emitter. */
export class Emitter<E extends Record<string, unknown>> {
  private h: { [K in keyof E]?: Array<(v: E[K]) => void> } = {};
  on<K extends keyof E>(k: K, f: (v: E[K]) => void): () => void {
    (this.h[k] ??= []).push(f);
    return () => {
      this.h[k] = this.h[k]!.filter((x) => x !== f);
    };
  }
  emit<K extends keyof E>(k: K, v: E[K]) {
    for (const f of this.h[k] ?? []) {
      try {
        f(v);
      } catch (e) {
        console.error(e);
      }
    }
  }
}
