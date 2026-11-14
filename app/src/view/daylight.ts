import * as THREE from "three";
import type { TimeOfDay } from "../store/settings";

/**
 * Lighting through the day, as keyframes by hour (UAE: sunrise ~6:20, sunset ~17:50). Between keyframes everything
 * blends smoothly, so "Changes as you ride" glides from dawn to night.
 */
export interface Daylight {
  /** Sun height above the horizon (rad); negative at night (the light then stands in for the moon). */
  sunElev: number;
  sun: THREE.Color; sunI: number;
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number;
  haze: THREE.Color;
  exposure: number;
  /** 0 by day, 1 at full night: lit windows, lamp pools, stars, no sky reflections. */
  night: number;
}

type Key = [hour: number, elevDeg: number, sun: number, sunI: number, sky: number, ground: number, hemiI: number, haze: number, exposure: number, night: number];
const KEYS: Key[] = [
  [0, -30, 0x9fb4e0, 0.6, 0x2c3b5a, 0x241c14, 0.45, 0x121b2b, 1.25, 1],
  [5.2, -6, 0x9fb4e0, 0.6, 0x34446a, 0x261e15, 0.45, 0x1d2840, 1.2, 1],
  [6.0, 1, 0xff9a5a, 1.2, 0x9c8db0, 0x5a4636, 0.3, 0xc99a84, 0.85, 0.35],
  [6.8, 6, 0xffb27a, 2.2, 0xd9c2ae, 0x8a6a4c, 0.18, 0xe0b694, 0.8, 0],
  [8.5, 18, 0xffd9ac, 3.0, 0xfff0dc, 0x9a7a58, 0.12, 0xdcd2c2, 0.78, 0],
  [12, 34, 0xfff1dc, 3.2, 0xfff4e6, 0x9a7a58, 0.12, 0xe2dccf, 0.74, 0],
  [15.5, 22, 0xffd9ac, 3.1, 0xfff0dc, 0x9a7a58, 0.12, 0xdcd2c2, 0.78, 0],
  [17.2, 6, 0xffa964, 2.4, 0xe8c3a2, 0x8a6244, 0.16, 0xe3ad83, 0.82, 0],
  [17.85, 1, 0xff7e45, 1.3, 0xb48ca0, 0x5a3e30, 0.26, 0xc98a72, 0.9, 0.3],
  [18.6, -6, 0x9fb4e0, 0.6, 0x3a4566, 0x261e15, 0.45, 0x2a3350, 1.15, 0.9],
  [20, -20, 0x9fb4e0, 0.6, 0x2c3b5a, 0x241c14, 0.45, 0x121b2b, 1.25, 1],
  [24, -30, 0x9fb4e0, 0.6, 0x2c3b5a, 0x241c14, 0.45, 0x121b2b, 1.25, 1],
];

const ca = new THREE.Color(), cb = new THREE.Color();
const mix = (a: number, b: number, t: number, out = new THREE.Color()) => out.copy(ca.set(a)).lerp(cb.set(b), t);

export function daylightAt(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = THREE.MathUtils.smootherstep((h - a[0]) / (b[0] - a[0]), 0, 1);
  const L = (k: number) => THREE.MathUtils.lerp(a[k] as number, b[k] as number, t);
  return {
    sunElev: L(1) * THREE.MathUtils.DEG2RAD,
    sun: mix(a[2], b[2], t), sunI: L(3),
    hemiSky: mix(a[4], b[4], t), hemiGround: mix(a[5], b[5], t), hemiI: L(6),
    haze: mix(a[7], b[7], t),
    exposure: L(8),
    night: L(9),
  };
}


/** Hour of day to show: your clock, a fixed time, or a day passing over an hour of riding (sunrise to night). */
export function hourFor(mode: TimeOfDay, rideSecs: number, now = new Date()): number {
  switch (mode) {
    case "sunrise": return 6.5;
    case "day": return 11;
    case "sunset": return 17.6;
    case "night": return 21;
    case "cycle": return 6 + ((rideSecs / 3600) * 15) % 18;
    default: return now.getHours() + now.getMinutes() / 60;
  }
}

/** A dome of stars for the night sky (faded in with the night factor). */
export function starField(n = 1400): THREE.Points {
  const pos = new Float32Array(n * 3);
  let s = 3;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const az = r() * Math.PI * 2, el = Math.asin(0.05 + 0.95 * r()), R = 20000;
    pos.set([Math.cos(el) * Math.cos(az) * R, Math.sin(el) * R, Math.cos(el) * Math.sin(az) * R], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

/** Soft warm circle of light on the road under a street lamp (additive, shown at night). */
export function lampPoolTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d")!, g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,.45)"); g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  return t;
}
