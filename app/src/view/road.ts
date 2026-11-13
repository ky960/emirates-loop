import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { eleAt, type ElevationProfile } from "../elevation";
import { hav, type LngLat } from "../geo";
import type { Frame } from "../ride/engine";
import type { Route } from "../route";
import { CITY_AR, nextStop, pointAt, wrapM } from "../route";
import type { Quality, Settings } from "../store/settings";
import { clamp, D2R, hash01, rng, smoothstep, TAU } from "../util";
import type { OsmData, OsmTiles } from "./osm";
import { carGeometry, ghafGeometry, JERSEY, palmCrownGeometry, palmTrunkGeometry, sweep, WBEAM } from "./props";
import { buildRider, type RiderModel } from "./rider";
import { barkTexture, blobTexture, facadeTextures, frondTexture, groundDetailTexture, kerbTexture, pavingTexture, wBeamTexture, type FacadeStyle } from "./textures";

type Biome = "desert" | "city" | "mountains" | "oasis" | "flat";
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const KX = Math.cos(24.8 * D2R) * 111320, KY = 110574;
const BIOME_LABEL: Record<Biome, string> = { desert: "Desert highway", city: "City", mountains: "Hajar mountains", oasis: "Al Ain oasis", flat: "Coast" };

const QUALITY: Record<Quality, { grid: number; shadow: number; shadowR: number; dpr: number; buildings: number; palms: number; cars: number; skyline: number }> = {
  battery: { grid: 100, shadow: 0, shadowR: 0, dpr: 1, buildings: 700, palms: 160, cars: 8, skyline: 0 },
  balanced: { grid: 150, shadow: 2048, shadowR: 30, dpr: 1.25, buildings: 1800, palms: 300, cars: 18, skyline: 500 },
  max: { grid: 180, shadow: 4096, shadowR: 42, dpr: 1.6, buildings: 2600, palms: 380, cars: 26, skyline: 900 },
};
/** Horizon haze: fog and the far ground fade into the sky colour so there is no hard edge. */
const HAZE = 0xdcd2c2;

const lerpAngle = (a: number, b: number, t: number) => a + (((((b - a) % TAU) + TAU * 1.5) % TAU) - Math.PI) * t;

// ---------- terrain shape ----------
function hDesert(gx: number, gz: number) {
  const w = gx * 0.011 + 1.3 * Math.sin(gz * 0.0037) + 0.6 * Math.sin(gz * 0.011 + gx * 0.002);
  const crest = Math.pow(1 - Math.abs(Math.sin(w)), 2);
  return 10 * crest * (0.6 + 0.4 * Math.sin(gx * 0.0021 + gz * 0.0017)) + 4 * (0.5 + 0.5 * Math.sin(gx * 0.0043 - gz * 0.0051)) + 0.6 * Math.sin(gx * 0.07) * Math.sin(gz * 0.061);
}
function hMount(gx: number, gz: number) {
  const r1 = Math.pow(1 - Math.abs(Math.sin(gx * 0.0031 + gz * 0.0019 + 0.8 * Math.sin(gz * 0.0013))), 1.6);
  const r2 = Math.pow(1 - Math.abs(Math.sin(gx * 0.0072 - gz * 0.0058 + 1.7)), 2.2);
  return 190 * r1 + 80 * r2 + 12 * (0.5 + 0.5 * Math.sin(gx * 0.019 + gz * 0.023)) + 4 * Math.sin(gx * 0.09) * Math.sin(gz * 0.077);
}
/** Height above the nearest road point for a spot `d` metres from the road. */
function heightAt(b: Biome, gx: number, gz: number, d: number) {
  const sink = d < 30 ? -0.35 : 0;
  if (b === "desert") return sink + hDesert(gx, gz) * smoothstep(30, 85, d) + 6 * smoothstep(250, 900, d) * (0.5 + 0.5 * Math.sin(gx * 0.0009 + gz * 0.0007));
  if (b === "mountains") return sink + hMount(gx, gz) * smoothstep(32, 300, d) + Math.max(0, d - 30) * 0.015 + hDesert(gx, gz) * 0.25 * smoothstep(30, 60, d);
  if (b === "oasis") return sink + hDesert(gx, gz) * 0.7 * smoothstep(160, 520, d) + 0.25 * Math.sin(gx * 0.05) * Math.sin(gz * 0.04) * smoothstep(30, 45, d);
  if (b === "flat") return sink + 0.02 * Math.sin(gx * 0.03) * Math.sin(gz * 0.027) * smoothstep(30, 45, d);
  return sink + 0.03 * Math.sin(gx * 0.03) * Math.sin(gz * 0.027) * smoothstep(30, 45, d) + hDesert(gx, gz) * 0.4 * smoothstep(900, 1400, d);
}
function colorAt(b: Biome, h: number, d: number, n: number) {
  const c = new THREE.Color();
  if (b === "desert") c.set(0xd7ae78).lerp(new THREE.Color(0xf4ddb2), clamp(h / 12, 0, 1));
  else if (b === "mountains") { c.set(0xc29a72); if (h > 6) c.lerp(new THREE.Color(0x6a4636), clamp((h - 6) / 50, 0, 1)).lerp(new THREE.Color(0xa88e7a), clamp((h - 60) / 150, 0, 1)); }
  else if (b === "oasis") { c.set(0x5a8a3e).lerp(new THREE.Color(0x86a452), n); c.lerp(new THREE.Color(0xddbe8c), smoothstep(70, 200, d)); }
  else { c.set(0xd6cbb8).lerp(new THREE.Color(0x7e9a5a), d < 24 ? 0.85 : n > 0.72 && d < 120 ? 0.7 : 0); c.lerp(new THREE.Color(0xe0c597), smoothstep(700, 1300, d)); }
  c.offsetHSL(0, 0, (n - 0.5) * 0.03);
  return c;
}
function zoneAt(p: LngLat, ele: number): Biome {
  const near = (c: LngLat, km: number) => hav(p, c) < km * 1000;
  if (near([55.7447, 24.2075], 16)) return "oasis";
  if (near([54.3705, 24.4764], 11) || near([54.6, 24.49], 4) || near([55.1403, 25.0805], 8) || near([55.2, 25.11], 6) || near([55.2708, 25.2048], 9) || near([55.4033, 25.3463], 7) || near([55.03, 24.99], 5)) return "city";
  if (ele > 160 || p[0] > 55.93) return "mountains";
  return "desert";
}

// ---------- geometry helpers ----------
function rTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Strip along the centreline C between lateral offsets o0..o1, following the road's height plus `y`. */
function ribbon(C: THREE.Vector3[], o0: number, o1: number, y: number, vLen: number) {
  const n = C.length, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx: number[] = [];
  let acc = 0;
  const pt = V3(0, 0, -1);
  for (let i = 0; i < n; i++) {
    const a = C[Math.max(0, i - 1)], b = C[Math.min(n - 1, i + 1)], t = b.clone().sub(a);
    t.y = 0;
    if (t.lengthSq() < 1e-8) t.copy(pt); else t.normalize();
    pt.copy(t);
    const nx = -t.z, nz = t.x;
    if (i) acc += C[i].distanceTo(C[i - 1]);
    const p = C[i];
    pos.set([p.x + nx * o0, p.y + y, p.z + nz * o0, p.x + nx * o1, p.y + y, p.z + nz * o1], i * 6);
    uv.set([0, acc / vLen, 1, acc / vLen], i * 4);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface Item { x: number; y: number; z: number; s?: number; sx?: number; sy?: number; sz?: number; rx?: number; ry?: number; rz?: number; c?: number }
const _lm = new THREE.Matrix4(), _li = new THREE.Matrix4(), _o = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
function inst(geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], shadow = true) {
  if (!items.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    _e.set(it.rx || 0, it.ry || 0, it.rz || 0);
    _q.setFromEuler(_e);
    _s.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
    _m.compose(_p.set(it.x, it.y, it.z), _q, _s);
    im.setMatrixAt(i, _m);
    if (it.c !== undefined) im.setColorAt(i, new THREE.Color(it.c));
  });
  im.castShadow = shadow;
  im.receiveShadow = true;
  im.frustumCulled = false;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  return im;
}

function ringArea(r: THREE.Vector2[]) {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

/** Nearest centreline point: coarse pass over every 8th point, then refine locally. */
class Nearest {
  private coarse: number[] = [];
  constructor(private C: THREE.Vector3[]) { for (let i = 0; i < C.length; i += 8) this.coarse.push(i); }
  query(x: number, z: number): { i: number; d: number } {
    const C = this.C;
    let bi = 0, bq = Infinity;
    for (const i of this.coarse) { const dx = C[i].x - x, dz = C[i].z - z, q = dx * dx + dz * dz; if (q < bq) { bq = q; bi = i; } }
    const lo = Math.max(0, bi - 9), hi = Math.min(C.length - 1, bi + 9);
    for (let i = lo; i <= hi; i++) { const dx = C[i].x - x, dz = C[i].z - z, q = dx * dx + dz * dz; if (q < bq) { bq = q; bi = i; } }
    return { i: bi, d: Math.sqrt(bq) };
  }
}

interface Win {
  group: THREE.Group;
  m0: number;
  O: { x: number; y: number };
  e0: number;
  route: Route;
  osmState: string;
  keys: string[];
  farKeys: string[];
  profile: ElevationProfile;
  biome: Biome;
  label: string;
}

// ---------- shared materials ----------
const MAT: Record<string, THREE.Material> = {};
const GEO: Record<string, THREE.BufferGeometry> = {};

const FACADE_STYLES: FacadeStyle[] = ["glass", "office", "residential", "villa"];
function facadeMaterials(): Record<string, THREE.Material> {
  const out: Record<string, THREE.Material> = {};
  const look: Record<FacadeStyle, { r: number; m: number; e: number }> = {
    glass: { r: 0.12, m: 0.7, e: 0.18 }, office: { r: 0.45, m: 0.25, e: 0.12 }, residential: { r: 0.85, m: 0, e: 0.1 }, villa: { r: 0.9, m: 0, e: 0.06 },
  };
  for (const st of FACADE_STYLES) {
    const { map, emissive } = facadeTextures(st), l = look[st];
    out["facade_" + st] = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: l.r, metalness: l.m, emissive: new THREE.Color(0xffffff), emissiveMap: emissive, emissiveIntensity: l.e, envMapIntensity: st === "glass" ? 1.4 : 0.8 });
  }
  out.roof = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  return out;
}

function makeShared() {
  if (GEO.post) return;
  const asph = rTex(256, 512, (c, w, h) => {
    c.fillStyle = "#5E5D62"; c.fillRect(0, 0, w, h);
    let s = 11; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 26000; i++) { const v = (70 + r() * 46) | 0; c.fillStyle = `rgba(${v + 3},${v},${v - 2},${0.2 + r() * 0.35})`; c.fillRect(r() * w, r() * h, 1 + r() * 1.6, 1 + r() * 1.6); }
    c.fillStyle = "rgba(20,20,24,.14)"; c.fillRect(w * 0.16, 0, w * 0.12, h); c.fillRect(w * 0.66, 0, w * 0.12, h);
    c.fillStyle = "rgba(255,255,255,.05)"; c.fillRect(w * 0.47, 0, w * 0.06, h);
  });
  const dash = rTex(16, 64, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = "#F4F1E8"; c.fillRect(0, 0, w, h * 0.4); });
  const ripple = (() => {
    const N = 256, cv = document.createElement("canvas"); cv.width = cv.height = N;
    const c = cv.getContext("2d")!, img = c.createImageData(N, N), hg = new Float32Array(N * N);
    let s = 5; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const u = x / N, v = y / N; hg[y * N + x] = Math.sin(TAU * (u * 8 + 0.4 * Math.sin(TAU * v * 2))) * 0.6 + Math.sin(TAU * (u * 21 + v * 3)) * 0.2 + (r() - 0.5) * 0.25; }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const L = hg[y * N + ((x - 1 + N) % N)], R2 = hg[y * N + ((x + 1) % N)], D2 = hg[((y - 1 + N) % N) * N + x], U = hg[((y + 1) % N) * N + x];
      const nx = (L - R2) * 1.3, ny = (D2 - U) * 1.3, l = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255; img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255; img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(160, 160); return t;
  })();
  MAT._ripple = new THREE.MeshBasicMaterial({ map: ripple }); // holder so the texture is shared
  const std = (color: number, o: { r?: number; m?: number; x?: THREE.MeshStandardMaterialParameters } = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.8, metalness: o.m ?? 0, ...o.x });
  // Road layers are separated by real height; offsets only break ties and stay tiny so the road can never be drawn over the rider.
  const off = (n: number) => ({ polygonOffset: true, polygonOffsetFactor: Math.sign(n) * 0.5, polygonOffsetUnits: Math.sign(n) * 1 });
  Object.assign(MAT, {
    asph: new THREE.MeshStandardMaterial({ map: asph, roughness: 0.92 }),
    shoulder: std(0xd4b585, { r: 1 }),
    white: std(0xefebe2, { r: 0.6, x: off(-6) }),
    yellow: std(0xe6b13a, { r: 0.6, x: off(-6) }),
    dash: new THREE.MeshStandardMaterial({ map: dash, transparent: true, alphaTest: 0.5, roughness: 0.6, ...off(-6) }),
    kerb: std(0xcfcac0, { r: 0.85 }),
    median: std(0x8a9a5b, { r: 1 }),
    post: std(0xf2f0ea, { r: 0.6 }),
    refl: std(0xf07a1a, { r: 0.3, x: { emissive: new THREE.Color(0xf07a1a), emissiveIntensity: 0.7 } }),
    pole: std(0xb8b6b0, { r: 0.35, m: 0.7 }),
    lamp: std(0xfff4dc, { x: { emissive: new THREE.Color(0xffe7b8), emissiveIntensity: 1.6 } }),
    trunk: new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95 }),
    frond: new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.75 }),
    paving: new THREE.MeshStandardMaterial({ map: (() => { const t = pavingTexture(); t.repeat.set(2, 1); return t; })(), roughness: 0.9 }),
    kerbPaint: new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.7, ...off(-5) }),
    concrete: std(0xffffff, { r: 0.85 }),
    wbeam: new THREE.MeshStandardMaterial({ map: wBeamTexture(), metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide }),
    gpost: std(0x9aa1a6, { r: 0.4, m: 0.7 }),
    gantry: std(0xb9bec2, { r: 0.35, m: 0.75 }),
    roofUnit: std(0xd6d6d2, { r: 0.6, m: 0.2 }),
    ghafT: std(0x6a4e36, { r: 0.95 }),
    ghafC: std(0xffffff, { r: 0.95, x: { flatShading: true, vertexColors: true } }),
    shrub: std(0x9a9257, { r: 1, x: { flatShading: true } }),
    rock: std(0x8a6a55, { r: 0.95, x: { flatShading: true } }),
    ...facadeMaterials(),
    sign: std(0x8e8e8a, { r: 0.5, m: 0.5 }),
  });
  GEO.post = new THREE.BoxGeometry(0.1, 0.95, 0.1).translate(0, 0.475, 0);
  GEO.refl = new THREE.BoxGeometry(0.105, 0.14, 0.105).translate(0, 0.82, 0);
  GEO.pole = new THREE.CylinderGeometry(0.08, 0.13, 1, 8).translate(0, 0.5, 0);
  GEO.arm = new THREE.BoxGeometry(0.08, 0.08, 1).translate(0, 0, 0.5);
  GEO.lamp = new THREE.BoxGeometry(0.38, 0.14, 1);
  GEO.trunk = palmTrunkGeometry();
  GEO.crown = palmCrownGeometry();
  const gh = ghafGeometry();
  GEO.ghafWood = gh.wood;
  GEO.ghafCanopy = gh.canopy;
  GEO.gpost = new THREE.BoxGeometry(0.12, 0.86, 0.14).translate(0, 0.43, 0);
  GEO.roofUnit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  GEO.ghafT = new THREE.CylinderGeometry(0.12, 0.2, 1, 6).translate(0, 0.5, 0);
  GEO.ghafC = new THREE.IcosahedronGeometry(1, 1);
  GEO.shrub = new THREE.IcosahedronGeometry(1, 0);
  GEO.rock = new THREE.DodecahedronGeometry(1, 0);
}
const SHARED_GEOS = () => new Set(Object.values(GEO));
let groundDetail: THREE.Texture | null = null;
/** Shared terrain detail map, tiled every ~70 m over the 4.4 km terrain patch. */
const GROUND_DETAIL = () => {
  if (!groundDetail) { groundDetail = groundDetailTexture(); groundDetail.repeat.set(4400 / 70, 4400 / 70); }
  return groundDetail;
};

/** Tileable PBR sets (albedo, normal, roughness) shipped with the app in /tex. */
const PBR: Record<string, { map?: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture }> = {};
function loadPbr(onDone: () => void) {
  const base = import.meta.env.BASE_URL + "tex/", L = new THREE.TextureLoader();
  const sets: Array<[string, [number, number]]> = [["asphalt", [2, 2.2]], ["sand", [1, 1]], ["concrete", [1, 1]], ["paving", [3.6, 5]]];
  let pending = sets.length * 3;
  for (const [name, rep] of sets) {
    const t: (typeof PBR)[string] = (PBR[name] = {});
    for (const [k, file, srgb] of [["map", "albedo", true], ["normalMap", "normal", false], ["roughnessMap", "rough", false]] as const) {
      L.load(base + `${name}_${file}.jpg`, (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(rep[0], rep[1]);
        tex.anisotropy = 8;
        if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
        t[k] = tex;
        if (--pending === 0) onDone();
      }, undefined, () => { if (--pending === 0) onDone(); });
    }
  }
}
function applyPbr() {
  const set = (m: THREE.Material | undefined, name: string, normalScale = 1, keepMap = false) => {
    const sm = m as THREE.MeshStandardMaterial, p = PBR[name];
    if (!sm || !p) return;
    if (p.map && !keepMap) sm.map = p.map;
    if (p.normalMap) { sm.normalMap = p.normalMap; sm.normalScale = new THREE.Vector2(normalScale, normalScale); }
    if (p.roughnessMap) { sm.roughnessMap = p.roughnessMap; sm.roughness = 1; }
    sm.needsUpdate = true;
  };
  set(MAT.asph, "asphalt", 0.9);
  set(MAT.shoulder, "asphalt", 0.6);
  set(MAT.concrete, "concrete", 0.8);
  set(MAT.paving, "paving", 1.0);
  set(MAT.kerb, "concrete", 0.6);
}
/** How strongly each surface picks up the sky's image-based light; glass and metal reflect most. */
function tuneEnv() {
  for (const [k, m] of Object.entries(MAT)) {
    const sm = m as THREE.MeshStandardMaterial;
    if (!("envMapIntensity" in sm)) continue;
    sm.envMapIntensity = k === "facade_glass" ? 1.3 : k === "wbeam" || k === "gantry" || k === "gpost" ? 0.9 : k.startsWith("facade") ? 0.5 : 0.35;
  }
}

function signBoard(name: string, km: number) {
  return rTex(512, 256, (c, w, h) => {
    c.fillStyle = "#0B6A3A"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "#F4F4EF"; c.lineWidth = 9; c.strokeRect(12, 12, w - 24, h - 24);
    c.fillStyle = "#F7F7F2"; c.textBaseline = "middle"; c.textAlign = "left";
    if (CITY_AR[name]) { c.font = "600 60px 'Noto Naskh Arabic', 'Segoe UI', Tahoma, sans-serif"; c.fillText(CITY_AR[name], 40, h * 0.33); }
    c.font = `700 ${name.length > 8 ? 54 : 64}px Barlow, Arial, sans-serif`;
    c.fillText(name.toUpperCase(), 40, CITY_AR[name] ? h * 0.7 : h * 0.5);
    c.fillRect(w - 168, 40, 5, h - 80);
    c.font = "700 92px 'Barlow Condensed', 'Arial Narrow', sans-serif"; c.textAlign = "right";
    c.fillText(String(km), w - 32, h * 0.52);
  });
}

// ---------- traffic ----------
interface Car { m: number; lane: 0 | 1 | 2; v: number; kind: 0 | 1; idx: number }
const PAINT = [0xf4f4f2, 0xf4f4f2, 0xeeeeec, 0xb9bdc1, 0x8e9399, 0x2b2e33, 0x17191c, 0x1f3a5c, 0x8a1c1c, 0xcbb592, 0x3d4a3a];

/** Cars on both carriageways: some overtake you in the next lane, the rest come the other way. */
class Traffic {
  group = new THREE.Group();
  private parts: THREE.InstancedMesh[][] = [];
  private cars: Car[] = [];
  private ready = false;
  private r = rng(1234);
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(n: number) {
    const body = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.3, envMapIntensity: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x141b22, metalness: 0.8, roughness: 0.08 });
    const wheel = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.85 });
    const tail = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, emissive: new THREE.Color(0xff2a1a), emissiveIntensity: 1.2 });
    const head = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: new THREE.Color(0xfff6e0), emissiveIntensity: 1.4 });
    const mats = [body, glass, wheel, tail, head];
    const per = [Math.ceil(n * 0.6), n - Math.ceil(n * 0.6)];
    (["sedan", "suv"] as const).forEach((kind, ki) => {
      const k = carGeometry(kind), cnt = Math.max(1, per[ki]);
      const parts = [k.body, k.glass, k.wheels, k.tail, k.head].map((g, pi) => {
        const im = new THREE.InstancedMesh(g, mats[pi], cnt);
        im.frustumCulled = false;
        im.castShadow = pi < 3;
        im.receiveShadow = pi === 0;
        this.group.add(im);
        return im;
      });
      for (let i = 0; i < cnt; i++) {
        parts[0].setColorAt(i, new THREE.Color(PAINT[Math.floor(this.r() * PAINT.length)]));
        this.cars.push({ m: 0, lane: (this.cars.length % 3) as 0 | 1 | 2, v: 0, kind: ki as 0 | 1, idx: i });
      }
      if (parts[0].instanceColor) parts[0].instanceColor.needsUpdate = true;
      this.parts.push(parts);
    });
  }

  private spawn(c: Car, pos: number, initial: boolean) {
    const r = this.r;
    c.v = (c.lane === 0 ? 27 : 25) + r() * 8;
    if (initial) c.m = pos - 250 + r() * 1800;
    else c.m = c.lane === 0 ? pos - 260 - r() * 260 : pos + 1250 + r() * 500;
  }

  update(dt: number, pos: number, w: { toL: (m: number) => THREE.Vector3; city: boolean; lo: number; hi: number }) {
    if (!this.ready) { this.cars.forEach((c) => this.spawn(c, pos, true)); this.ready = true; }
    const lanes = w.city ? [-1.9, -12.6, -16.4] : [-1.9, -7.45, -11.3];
    for (const c of this.cars) {
      c.m += (c.lane === 0 ? 1 : -1) * c.v * dt;
      if ((c.lane === 0 && (c.m > pos + 1700 || c.m < pos - 600)) || (c.lane !== 0 && (c.m < pos - 320 || c.m > pos + 2000))) this.spawn(c, pos, false);
      const parts = this.parts[c.kind];
      let mtx = this.zero;
      if (c.m > w.lo && c.m < w.hi) {
        const p = w.toL(c.m), d = w.toL(c.m + 3).sub(w.toL(c.m - 3));
        d.y = 0;
        if (d.lengthSq() > 1e-8) {
          d.normalize();
          p.addScaledVector(new THREE.Vector3(-d.z, 0, d.x), lanes[c.lane]);
          p.y += 0.1;
          this.e.set(0, Math.atan2(-d.x, -d.z) + (c.lane === 0 ? 0 : Math.PI), 0);
          mtx = this.m4.compose(p, this.q.setFromEuler(this.e), new THREE.Vector3(1, 1, 1));
        }
      }
      for (const im of parts) im.setMatrixAt(c.idx, mtx);
    }
    for (const parts of this.parts) for (const im of parts) im.instanceMatrix.needsUpdate = true;
  }

  reset() { this.ready = false; }
}

// =====================================================================================
export class RoadView {
  ready = false;
  info = "";
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private cam!: THREE.PerspectiveCamera;
  private sky!: Sky;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private base!: THREE.Mesh;
  private rider!: RiderModel;
  private ghost!: RiderModel;
  private win: Win | null = null;
  private building: { gen: Generator<void, Win, void>; m0: number } | null = null;
  private yaw: number | undefined;
  private camOff: THREE.Vector3 | null = null;
  private lookOff: THREE.Vector3 | null = null;
  private t = 0;
  private quality: Quality;
  private traffic: Traffic | null = null;

  constructor(private canvas: HTMLCanvasElement, private deps: { route: () => Route; profile: () => ElevationProfile; settings: () => Settings; osm: OsmTiles; osmFar?: OsmTiles }) {
    this.quality = deps.settings().quality;
  }

  init(): boolean {
    try {
      const q = QUALITY[this.quality];
      const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality !== "battery", powerPreference: "high-performance" });
      r.setPixelRatio(Math.min(q.dpr, devicePixelRatio || 1));
      r.shadowMap.enabled = q.shadow > 0;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 0.78;
      r.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer = r;
    } catch {
      return false;
    }
    makeShared();
    tuneEnv();
    const s = new THREE.Scene();
    this.scene = s;
    const sky = new Sky();
    sky.scale.setScalar(25000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4.5; u.rayleigh.value = 2.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.88;
    s.add(sky);
    this.sky = sky;
    s.fog = new THREE.FogExp2(HAZE, 0.00042);
    // Image-based lighting from a real sunny-sky HDRI (Poly Haven "Quarry 01", CC0) for natural ambient light and reflections.
    const pm = new THREE.PMREMGenerator(this.renderer);
    new RGBELoader().load(import.meta.env.BASE_URL + "env/quarry_01_1k.hdr", (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      s.environment = pm.fromEquirectangular(hdr).texture;
      hdr.dispose();
      pm.dispose();
      this.hemi.intensity = 0.1;
    }, undefined, () => pm.dispose());
    loadPbr(() => applyPbr());
    this.hemi = new THREE.HemisphereLight(0xfff0dc, 0x9a7a58, 0.55);
    s.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffd9ac, 3.1);
    const q = QUALITY[this.quality];
    if (q.shadow) {
      // Shadow box covers the road ahead (palms, lamps, cars, gantries), not just the rider.
      sun.castShadow = true;
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      const R = q.shadowR;
      Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 260 });
      sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04; sun.shadow.radius = 2.5;
    }
    s.add(sun, sun.target);
    this.sun = sun;
    const base = new THREE.Mesh(new THREE.CircleGeometry(14000, 64), new THREE.MeshStandardMaterial({ color: 0xd9bf98, roughness: 1 }));
    base.rotation.x = -Math.PI / 2;
    s.add(base);
    this.base = base;
    this.cam = new THREE.PerspectiveCamera(52, 1, 0.3, 30000);
    this.rider = buildRider();
    this.rider.g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    // Soft contact shadow under the bike: grounds the rider at every quality level, even without shadow maps.
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
    blob.position.y = 0.012;
    blob.renderOrder = 1;
    this.rider.g.add(blob);
    s.add(this.rider.g);
    this.ghost = buildRider(new THREE.MeshBasicMaterial({ color: 0x18d6c8, transparent: true, opacity: 0.5, depthWrite: false }));
    s.add(this.ghost.g);
    if (this.deps.settings().traffic) { this.traffic = new Traffic(QUALITY[this.quality].cars); s.add(this.traffic.group); }
    this.ready = true;
    return true;
  }

  resize(w: number, h: number) {
    if (!this.ready) return;
    this.renderer.setSize(Math.max(200, w), Math.max(150, h), false);
    this.cam.aspect = w / h;
    this.cam.fov = w / h < 1.1 ? 66 : 52;
    this.cam.updateProjectionMatrix();
  }

  get biome(): string { return this.win ? BIOME_LABEL[this.win.biome] : ""; }

  // ---------- window building (incremental) ----------
  private *buildWindow(m0: number): Generator<void, Win, void> {
    const route = this.deps.route(), prof = this.deps.profile(), q = QUALITY[this.quality];
    const group = new THREE.Group();
    const add = (o: THREE.Object3D | null) => { if (o) group.add(o); };
    const op = pointAt(route, m0).p, O = { x: op[0] * KX, y: op[1] * KY };
    const e0 = eleAt(prof, route.total, m0);
    const toL = (p: LngLat, y = 0) => V3(p[0] * KX - O.x, y, -(p[1] * KY - O.y));
    const A = -500, B = 2700, STEP = 6, C: THREE.Vector3[] = [];
    for (let d = A; d <= B; d += STEP) C.push(toL(pointAt(route, m0 + d).p, eleAt(prof, route.total, m0 + d) - e0));
    const near = new Nearest(C);
    const zoneP = pointAt(route, m0 + 500).p, zoneEle = eleAt(prof, route.total, m0 + 500);
    const zone = zoneAt(zoneP, zoneEle);
    const keys = this.deps.osm.keysFor(C.filter((_, i) => i % 25 === 0).map((v) => [(v.x + O.x) / KX, (-v.z + O.y) / KY] as LngLat));
    const ctx = this.deps.osm.get(keys);
    if (ctx.state !== "complete" && ctx.state !== "none") this.deps.osm.fetch(keys).then(() => this.osmArrived(m0));
    // Wider, lower-detail tiles for the distant skyline (towers several kilometres away).
    const farTiles = q.skyline && this.deps.osmFar ? this.deps.osmFar : null;
    const farKeys = farTiles ? farTiles.keysFor(C.filter((_, i) => i % 25 === 0).map((v) => [(v.x + O.x) / KX, (-v.z + O.y) / KY] as LngLat), 0.032) : [];
    const far = farTiles ? farTiles.get(farKeys) : { state: "none" as const, data: null };
    if (farTiles && far.state !== "complete" && far.state !== "none") farTiles.fetch(farKeys).then(() => this.osmArrived(m0));
    yield;

    let scen: ReturnType<RoadView["scenery"]> | null = null;
    if (ctx.data) { try { scen = this.scenery(ctx.data, toL, near, C, zone, q); } catch (e) { console.error(e); } }
    const urban = !!scen && scen.buildings >= 40;
    const mountainous = zone === "mountains";
    let hb: Biome, cb: Biome, pb: Biome;
    if (urban) { pb = cb = "city"; hb = mountainous ? "mountains" : scen!.water ? "flat" : "city"; }
    else if (scen) { pb = cb = zone === "city" ? "desert" : zone; hb = scen.water && !mountainous ? "flat" : pb; }
    else { hb = cb = pb = zone; }
    yield;

    const along = (d: number) => {
      const i = clamp(Math.round((d - A) / STEP), 1, C.length - 2), t = C[i + 1].clone().sub(C[i - 1]);
      t.y = 0;
      if (t.lengthSq() < 1e-8) t.set(0, 0, -1);
      t.normalize();
      return { p: C[i], t, n: V3(-t.z, 0, t.x), i };
    };
    const clear = (pt: THREE.Vector3, minD: number, i0: number) => {
      for (let k = Math.max(0, i0 - 45); k < Math.min(C.length, i0 + 45); k++) { const dx = C[k].x - pt.x, dz = C[k].z - pt.z; if (dx * dx + dz * dz < minD * minD) return false; }
      return true;
    };
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; return m; };
    // Road surface, shoulders, kerbs and markings follow the real elevation.
    const city = pb === "city";
    const R = (o0: number, o1: number, y: number, mat: THREE.Material, v = 9) => add(mk(ribbon(C, o0, o1, y, v), mat));
    // Our carriageway: two lanes with centre dashes and edge lines.
    R(-3.8, 3.8, 0.1, MAT.asph);
    R(-0.11, 0.11, 0.14, MAT.dash, 12);
    if (city) {
      // Boulevard: painted kerbs, paved sidewalks, planted median, opposite carriageway.
      R(-3.62, -3.46, 0.14, MAT.white); R(3.46, 3.62, 0.14, MAT.white);
      R(3.8, 4.1, 0.24, MAT.kerbPaint, 4); R(4.1, 8.4, 0.22, MAT.paving, 6);
      R(-4.1, -3.8, 0.24, MAT.kerbPaint, 4); R(-10.4, -4.1, 0.22, MAT.median); R(-10.7, -10.4, 0.24, MAT.kerbPaint, 4);
      R(-18.3, -10.7, 0.1, MAT.asph); R(-14.6, -14.4, 0.14, MAT.dash, 12);
      R(-18.6, -18.3, 0.24, MAT.kerbPaint, 4); R(-22.8, -18.6, 0.22, MAT.paving, 6);
    } else {
      // Dual-carriageway highway: shoulders, concrete median barrier, guardrails.
      R(3.8, 6.6, 0.09, MAT.asph); R(-4.8, -3.8, 0.09, MAT.asph);
      R(-3.62, -3.46, 0.14, MAT.yellow); R(3.46, 3.62, 0.14, MAT.white);
      add(mk(sweep(C, JERSEY, -5.15), MAT.concrete));
      R(-13.4, -5.5, 0.1, MAT.asph); R(-9.56, -9.34, 0.14, MAT.dash, 12);
      R(-5.88, -5.72, 0.14, MAT.yellow); R(-13.2, -13.04, 0.14, MAT.white);
      const rail = mk(sweep(C, WBEAM, 7.05), MAT.wbeam); rail.castShadow = true; add(rail);
      const rail2 = mk(sweep(C, WBEAM.map(([o, h]) => [-o, h] as [number, number]), -14.0), MAT.wbeam); add(rail2);
    }
    yield;

    // Terrain grid: height = nearest road height + biome shape by distance from the road.
    const mid = along(1000).p, SZ = 4400, N = q.grid;
    const geo = new THREE.PlaneGeometry(SZ, SZ, N, N);
    geo.rotateX(-Math.PI / 2);
    geo.translate(mid.x, 0, mid.z);
    const pos = geo.attributes.position as THREE.BufferAttribute, cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), nr = near.query(x, z);
      const gx = x + O.x, gz = z - O.y, h = heightAt(hb, gx, gz, nr.d), n = 0.5 + 0.5 * Math.sin(gx * 0.013) * Math.sin(gz * 0.017);
      pos.setY(i, C[nr.i].y + h - 0.02);
      const c = colorAt(cb, h, nr.d, n);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
      if (i % ((N + 1) * 14) === 0) yield;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    // Detail map mottles the vertex colours (tile ~70 m; its finest octave gives sub-metre specks).
    const tm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: hb === "mountains", map: GROUND_DETAIL() });
    tm.userData.own = true;
    tm.envMapIntensity = 0.35;
    tm.polygonOffset = true; tm.polygonOffsetFactor = 1; tm.polygonOffsetUnits = 2;
    if (cb === "desert" || cb === "oasis" || hb === "mountains") {
      const sand = PBR.sand;
      if (sand?.normalMap) {
        // Sand normal/roughness tiled every ~6 m across the 4.4 km terrain patch.
        const nm = sand.normalMap.clone(); nm.repeat.set(SZ / 6, SZ / 6); nm.needsUpdate = true;
        tm.normalMap = nm; tm.normalScale = new THREE.Vector2(cb === "desert" ? 0.9 : 0.5, cb === "desert" ? 0.9 : 0.5);
        tm.userData.ownNormal = true;
      } else { tm.normalMap = (MAT._ripple as THREE.MeshBasicMaterial).map; tm.normalScale = new THREE.Vector2(0.6, 0.6); }
    }
    const terr = new THREE.Mesh(geo, tm);
    terr.receiveShadow = true;
    add(terr);
    const hAt = (pt: THREE.Vector3, lat: number) => { const nr = near.query(pt.x, pt.z); return C[nr.i].y + heightAt(hb, pt.x + O.x, pt.z - O.y, Math.abs(lat)); };
    if (scen) scen.meshes.forEach(add);
    if (far.data) {
      const toMap = (p: LngLat) => { const v = toL(p); return new THREE.Vector2(v.x, -v.z); };
      const seen = new Set<string>(), sky: Bld[] = [];
      for (const b of far.data.b) {
        if (b.h < 40) continue;
        const v = toL(b.rings[0][0]), nr = near.query(v.x, v.z);
        if (nr.d < (b.h > 60 ? 1600 : 650) || nr.d > 4500) continue;
        const k = Math.round(v.x / 4) + "," + Math.round(v.z / 4);
        if (seen.has(k)) continue;
        seen.add(k);
        sky.push({ ...b, y: C[nr.i].y });
        if (sky.length >= q.skyline) break;
      }
      buildingMeshes(sky, toMap, true, { shadows: false }).forEach(add);
    }
    yield;

    // Props, placed by route distance so they don't jump when the window is rebuilt.
    const it: Record<string, Item[]> = { post: [], refl: [], pole: [], arm: [], lamp: [], trunk: [], crown: [], ghafW: [], ghafCan: [], shrub: [], rock: [], gpost: [], roofUnit: scen?.roofUnits ?? [] };
    // Scenery off the road must clear the opposite carriageway on the left.
    const off = (sd: number, base: number) => (sd > 0 ? base : -(base + (city ? 14 : 9)));
    const each = (spacing: number, fn: (d: number, r: () => number) => void) => {
      const k0 = Math.ceil((m0 + A + 30) / spacing), k1 = Math.floor((m0 + B - 30) / spacing);
      for (let k = k0; k <= k1; k++) fn(k * spacing - m0, rng(k * 7919 + spacing * 31 + 3));
    };
    const place = (d: number, lat: number) => { const a = along(d); return { a, pt: a.p.clone().addScaledVector(a.n, lat) }; };
    if (!city) {
      each(4, (d) => { for (const lat of [7.16, -14.11]) { const { pt } = place(d, lat); it.gpost.push({ x: pt.x, y: pt.y, z: pt.z }); } });
      each(24, (d) => { const { pt } = place(d, 7.12); it.refl.push({ x: pt.x, y: pt.y - 0.05, z: pt.z }); });
    }
    const lampAt = (d: number, lat: number) => {
      const { a, pt } = place(d, lat), top = 11;
      it.pole.push({ x: pt.x, y: pt.y, z: pt.z, sy: top });
      for (const sd of [1, -1]) {
        const dir = a.n.clone().multiplyScalar(sd), ay = Math.atan2(dir.x, dir.z), armLen = 2.6;
        it.arm.push({ x: pt.x, y: pt.y + top - 0.2, z: pt.z, ry: ay, sz: armLen });
        const hp = pt.clone().addScaledVector(dir, armLen);
        it.lamp.push({ x: hp.x, y: pt.y + top - 0.3, z: hp.z, ry: ay, sz: 0.9 });
      }
    };
    // Double-arm lamps down the median, lighting both carriageways.
    if (city) each(36, (d) => lampAt(d, -7.25));
    else if (pb !== "mountains") each(50, (d) => lampAt(d, -5.15));
    const palm = (pt: THREE.Vector3, s: number, r: () => number) => {
      const h = 5.5 + r() * 3.5;
      it.trunk.push({ x: pt.x, y: pt.y, z: pt.z, sx: s, sz: s, sy: h * s, rz: (r() - 0.5) * 0.12 });
      it.crown.push({ x: pt.x, y: pt.y + h * s - 0.1, z: pt.z, s: s * (0.9 + r() * 0.3), ry: r() * TAU });
    };
    if (scen?.palms) { const rp2 = rng(77); scen.palms.forEach((p) => palm(V3(p.x, C[near.query(p.x, p.z).i].y + 0.05, p.z), p.s, rp2)); }
    if (pb === "city") {
      // Palms between the median lamps and along both sidewalks.
      each(36, (d, r) => { const { a, pt } = place(d + 18, -7.25); pt.y = a.p.y + 0.22; palm(pt, 0.95 + r() * 0.15, r); });
      each(14, (d, r) => { for (const lat of [6.6, -20.6]) { const { a, pt } = place(d + (lat > 0 ? 0 : 7), lat); pt.y = a.p.y + 0.22; palm(pt, 0.85 + r() * 0.2, r); } });
      const fill: Bld[] = [];
      if (!scen || scen.buildings < 40) each(18, (d, r) => {
        if (r() < 0.5) {
          const sd = r() > 0.5 ? 1 : -1, lat = off(sd, 80 + 560 * Math.pow(r(), 1.2)), { a, pt } = place(d, lat);
          if (clear(pt, 30, a.i)) {
            const far = Math.abs(lat) / 640, hgt = 16 + r() * (35 + 170 * far), wd = 16 + r() * 24;
            // Rectangular footprint, built like an OSM building so it gets real facades, a roof and rooftop plant.
            const dp = wd * (0.7 + r() * 0.6), ry = r() * TAU, cs = Math.cos(ry), sn = Math.sin(ry);
            const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([u, v]) => {
              const x = pt.x + (u * wd * cs - v * dp * sn) / 2, z = pt.z + (u * wd * sn + v * dp * cs) / 2;
              return [(x + O.x) / KX, (O.y - z) / KY] as LngLat;
            });
            fill.push({ rings: [ring], h: hgt, mh: 0, y: hAt(pt, lat) });
          }
        }
      });
      if (fill.length) buildingMeshes(fill, (p) => { const v = toL(p); return new THREE.Vector2(v.x, -v.z); }, true, { roofUnits: it.roofUnit }).forEach(add);
    } else if (pb === "oasis") {
      each(6, (d, r) => { if (r() < 0.75) { const sd = r() > 0.5 ? 1 : -1, lat = off(sd, 9 + 130 * Math.pow(r(), 1.4)), { a, pt } = place(d, lat); if (clear(pt, 7.5, a.i)) { pt.y = hAt(pt, lat); palm(pt, 0.8 + r() * 0.4, r); } } });
    } else if (pb === "desert") {
      each(28, (d, r) => {
        if (r() < 0.5) {
          const sd = r() > 0.5 ? 1 : -1, lat = off(sd, 14 + 170 * Math.pow(r(), 1.5)), { a, pt } = place(d, lat);
          if (clear(pt, 10, a.i)) {
            const y = hAt(pt, lat) - 0.1, s = 0.75 + r() * 0.6, ry = r() * TAU;
            it.ghafW.push({ x: pt.x, y, z: pt.z, s, ry });
            it.ghafCan.push({ x: pt.x, y, z: pt.z, s, ry });
          }
        }
      });
      each(5, (d, r) => { if (r() < 0.5) { const sd = r() > 0.5 ? 1 : -1, lat = off(sd, 8.5 + 70 * Math.pow(r(), 1.2)), { a, pt } = place(d, lat); if (clear(pt, 8, a.i)) { const s = 0.25 + r() * 0.45; it.shrub.push({ x: pt.x, y: hAt(pt, lat) + s * 0.3, z: pt.z, sx: s, sy: s * 0.6, sz: s, ry: r() * TAU }); } } });
    } else {
      // Mountains: rocks half-buried in the slope so they sit on the ground rather than float.
      each(5, (d, r) => {
        if (r() < 0.65) {
          const sd = r() > 0.5 ? 1 : -1, lat = off(sd, 8.5 + 170 * Math.pow(r(), 1.3)), { a, pt } = place(d, lat);
          if (clear(pt, 8, a.i)) { const s = 0.4 + r() * (1 + Math.abs(lat) / 30); it.rock.push({ x: pt.x, y: hAt(pt, lat) - s * 0.25, z: pt.z, sx: s * (1 + r() * 0.6), sy: s * (0.6 + r() * 0.5), sz: s, rx: r() * 3, ry: r() * 3 }); }
        }
      });
    }
    add(inst(GEO.gpost, MAT.gpost, it.gpost)); add(inst(GEO.refl, MAT.refl, it.refl, false));
    add(inst(GEO.roofUnit, MAT.roofUnit, it.roofUnit));
    add(inst(GEO.pole, MAT.pole, it.pole)); add(inst(GEO.arm, MAT.pole, it.arm)); add(inst(GEO.lamp, MAT.lamp, it.lamp, false));
    add(inst(GEO.trunk, MAT.trunk, it.trunk)); add(inst(GEO.crown, MAT.frond, it.crown));
    add(inst(GEO.ghafWood, MAT.ghafT, it.ghafW)); add(inst(GEO.ghafCanopy, MAT.ghafC, it.ghafCan)); add(inst(GEO.shrub, MAT.shrub, it.shrub, false));
    add(inst(GEO.rock, MAT.rock, it.rock));
    yield;

    // Green motorway distance signs every 5 km to the next stop (English + Arabic).
    const lm = wrapM(route, m0);
    const { stop, dist: toNext } = nextStop(route, lm);
    for (let d = toNext % 5000; d < B - 40; d += 5000) {
      if (d < A + 40) continue;
      const km = Math.round((toNext - d) / 1000);
      if (km < 1) continue;
      const gantry = km % 10 === 0 || km === 2;
      const { a, pt } = place(d, gantry ? 0 : 9.4), face = Math.atan2(-a.t.x, -a.t.z), g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ map: signBoard(stop.name, km), toneMapped: false, fog: true });
      mat.userData.own = true; mat.userData.ownMap = true;
      if (gantry) {
        // Overhead gantry spanning our carriageway, posts on the verge and the median.
        const left = city ? -7.25 : -5.15, right = city ? 8.0 : 7.8, span = right - left, cx = (left + right) / 2;
        for (const x of [left, right]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 7.4, 10), MAT.gantry); p.position.set(x, 3.7, 0); p.castShadow = true; g.add(p); }
        for (const y of [6.2, 7.1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(span, 0.2, 0.2), MAT.gantry); b.position.set(cx, y, 0); b.castShadow = true; g.add(b); }
        for (let k = 0; k < 8; k++) { const x = left + (span * (k + 0.5)) / 8; const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.06), MAT.gantry); s2.position.set(x, 6.65, 0); s2.rotation.z = k % 2 ? 0.6 : -0.6; g.add(s2); }
        const board = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.3), mat); board.position.set(0.6, 5.15, 0.16); g.add(board);
        const back = new THREE.Mesh(new THREE.BoxGeometry(6.7, 3.4, 0.12), MAT.sign); back.position.set(0.6, 5.15, 0.08); back.castShadow = true; g.add(back);
      } else {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.3), mat); board.position.set(0, 4.2, 0.03); g.add(board);
        const back = new THREE.Mesh(new THREE.BoxGeometry(4.7, 2.4, 0.08), MAT.sign); back.position.set(0, 4.2, -0.02); back.castShadow = true; g.add(back);
        for (const dx of [-1.7, 1.7]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.2, 8), MAT.pole); leg.position.set(dx, 2.1, -0.08); leg.castShadow = true; g.add(leg); }
      }
      g.position.copy(pt); g.rotation.y = face; add(g);
    }
    const label = BIOME_LABEL[pb] + (scen?.buildings ? ` · ${scen.buildings} buildings from OpenStreetMap` : "");
    const osmState = ctx.state === "none" ? "none" : ctx.state === "complete" && (far.state === "complete" || far.state === "none") ? "complete" : "partial";
    return { group, m0, O, e0, route, osmState, keys, farKeys, profile: prof, biome: pb, label };
  }

  private osmArrived(m0: number) {
    // Rebuild the current window once its map data has arrived (incrementally, no hitch).
    if (this.win && this.win.m0 === m0 && this.win.osmState !== "complete" && !this.building) this.building = { gen: this.buildWindow(m0), m0 };
  }

  private scenery(ctx: OsmData, toL: (p: LngLat, y?: number) => THREE.Vector3, near: Nearest, C: THREE.Vector3[], zone: Biome, q: (typeof QUALITY)[Quality]) {
    const yAt = (x: number, z: number) => C[near.query(x, z).i].y;
    const toMap = (p: LngLat) => { const v = toL(p); return new THREE.Vector2(v.x, -v.z); };
    const bbox = (rings: LngLat[][]) => {
      let a = 1e12, b = -1e12, c = 1e12, d = -1e12;
      for (const p of rings[0]) { const v = toL(p); a = Math.min(a, v.x); b = Math.max(b, v.x); c = Math.min(c, v.z); d = Math.max(d, v.z); }
      return { cx: (a + b) / 2, cz: (c + d) / 2, r: Math.hypot(b - a, d - c) / 2 };
    };
    const res = { meshes: [] as THREE.Object3D[], buildings: 0, water: false, palms: [] as Array<{ x: number; z: number; s: number }>, roofUnits: [] as Item[] };
    // Buildings within 650 m of the road, never on it. Tall ones are kept out to 1.6 km for a skyline.
    const seen = new Set<string>(), blds: Array<OsmData["b"][number] & { y: number }> = [];
    for (const b of ctx.b) {
      const bb = bbox(b.rings), k = Math.round(bb.cx) + "," + Math.round(bb.cz) + "," + Math.round(b.h);
      if (seen.has(k)) continue;
      seen.add(k);
      const nr = near.query(bb.cx, bb.cz);
      const limit = b.h > 60 ? 1600 : 650;
      if (nr.d > limit || nr.d - bb.r < 12) continue;
      blds.push({ ...b, y: C[nr.i].y });
      if (blds.length > q.buildings) break;
    }
    res.buildings = blds.length;
    res.meshes.push(...buildingMeshes(blds, toMap, zone === "city" || blds.length > 120, { roofUnits: res.roofUnits }));
    const pick = <T extends { rings: LngLat[][] }>(arr: T[], R: number) => arr.filter((f) => { const bb = bbox(f.rings); return near.query(bb.cx, bb.cz).d - bb.r < R; });
    const water = pick(ctx.w.map((rings) => ({ rings })), 1500);
    res.water = water.length > 0;
    const W = polyMesh(water.map((f) => ({ rings: f.rings, color: 0x2c88aa })), toMap, yAt, 0.06, -2, { r: 0.12, m: 0.15 });
    if (W) res.meshes.push(W);
    const greens = pick(ctx.g, 1200);
    const G = polyMesh(greens.map((f) => ({ rings: f.rings, color: f.c })), toMap, yAt, 0.065, -2, {});
    if (G) res.meshes.push(G);
    const inside = (pt: THREE.Vector2, ring: THREE.Vector2[]) => {
      let c2 = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b2 = ring[j];
        if (a.y > pt.y !== b2.y > pt.y && pt.x < ((b2.x - a.x) * (pt.y - a.y)) / (b2.y - a.y) + a.x) c2 = !c2;
      }
      return c2;
    };
    for (const f of greens) {
      if (res.palms.length > q.palms) break;
      const bb = bbox(f.rings);
      if (near.query(bb.cx, bb.cz).d - bb.r > 420) continue;
      const ring = f.rings[0].map(toMap);
      let a = 1e12, b2 = -1e12, c3 = 1e12, d2 = -1e12;
      for (const p of ring) { a = Math.min(a, p.x); b2 = Math.max(b2, p.x); c3 = Math.min(c3, p.y); d2 = Math.max(d2, p.y); }
      const area = Math.abs(ringArea(ring)), n = Math.min(40, Math.floor(area / 500)), r = rng(Math.floor(hash01(f.rings[0][0][0], f.rings[0][0][1]) * 1e9));
      for (let k = 0; k < n * 2 && res.palms.length <= q.palms; k++) {
        const pt = new THREE.Vector2(a + r() * (b2 - a), c3 + r() * (d2 - c3));
        if (!inside(pt, ring)) continue;
        const dd = near.query(pt.x, -pt.y).d;
        if (dd < 10 || dd > 450) continue;
        res.palms.push({ x: pt.x, z: -pt.y, s: 0.8 + r() * 0.4 });
      }
    }
    const uses = pick(ctx.u, 1200);
    const U = polyMesh(uses.map((f) => ({ rings: f.rings, color: f.c })), toMap, yAt, 0.05, -1, {});
    if (U) res.meshes.push(U);
    // Side roads and junctions — but not the stretch we're riding on (it would show as dark bands beside our road).
    const roads = ctx.r.filter((r) => {
      const mid = toL(r.line[(r.line.length / 2) | 0]), dMid = near.query(mid.x, mid.z).d;
      if (dMid > 700) return false;
      const a = toL(r.line[0]), b = toL(r.line[r.line.length - 1]);
      return !(dMid < 24 && near.query(a.x, a.z).d < 24 && near.query(b.x, b.z).d < 24);
    }).slice(0, 1800);
    const R = roadMeshes(roads, toL, yAt);
    if (R) res.meshes.push(R);
    return res;
  }

  // ---------- per frame ----------
  render(f: Frame, dt: number, crank: number) {
    if (!this.ready) return;
    const route = this.deps.route();
    // Build windows ahead of need, a few milliseconds per frame.
    if (!this.win || this.win.route !== route || this.win.profile !== this.deps.profile()) {
      if (this.win) this.dropWin();
      const gen = this.buildWindow(f.pos);
      let r = gen.next();
      while (!r.done) r = gen.next();
      this.swapIn(r.value);
      this.building = null;
    } else if (!this.building && (f.pos > this.win.m0 + 800 || f.pos < this.win.m0 - 300)) {
      this.building = { gen: this.buildWindow(f.pos), m0: f.pos };
    }
    if (this.building) {
      const t0 = performance.now();
      let r = this.building.gen.next();
      while (!r.done && performance.now() - t0 < 7) r = this.building.gen.next();
      if (r.done) { this.swapIn(r.value); this.building = null; }
      else if (f.pos > this.win!.m0 + 2400) { while (!r.done) r = this.building.gen.next(); this.swapIn(r.value); this.building = null; }
    }
    const w = this.win!;
    const prof = this.deps.profile();
    const toL = (m: number) => {
      const p = pointAt(route, m).p;
      return V3(p[0] * KX - w.O.x, eleAt(prof, route.total, m) - w.e0, -(p[1] * KY - w.O.y));
    };
    const m = f.pos, mps = f.kmh / 3.6;
    const dir = toL(m + 5).sub(toL(m - 5)); dir.y = 0;
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
    dir.normalize();
    const yawT = Math.atan2(-dir.x, -dir.z);
    this.yaw = this.yaw === undefined ? yawT : lerpAngle(this.yaw, yawT, Math.min(1, dt * 3.5));
    const rn = V3(-dir.z, 0, dir.x), rp = toL(m).addScaledVector(rn, 1.9);
    rp.y += 0.13; // asphalt sits 0.10 m above the centreline; tyres touch it
    const R = this.rider.g;
    R.position.copy(rp);
    R.rotation.set(Math.atan(f.grade) * 0.9, this.yaw, 0, "YXZ");
    this.rider.update(dt, mps, crank, clamp((f.grade - 0.05) / 0.05, 0, 1) * Math.min(1, f.kmh / 8));

    const fwd = V3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = V3(-fwd.z, 0, fwd.x), portrait = this.cam.aspect < 1.1, sp = Math.min(1.4, mps / 9);
    const want = rp.clone().addScaledVector(fwd, -(portrait ? 4.4 : 5.2) - sp * 0.6).addScaledVector(right, portrait ? 0.8 : 1.2);
    want.y = rp.y + (portrait ? 2.3 : 1.95) + Math.sin(this.t * 0.4) * 0.05;
    const lookW = rp.clone().addScaledVector(fwd, 9);
    lookW.y = toL(m + 9).y + 1.05;
    this.t += dt;
    const offW = want.clone().sub(rp), lookOffW = lookW.clone().sub(rp);
    if (!this.camOff || !isFinite(this.camOff.x + this.camOff.y + this.camOff.z)) { this.camOff = offW.clone(); this.lookOff = lookOffW.clone(); }
    this.camOff.lerp(offW, Math.min(1, dt * 3));
    this.lookOff!.lerp(lookOffW, Math.min(1, dt * 4));
    const camPos = rp.clone().add(this.camOff), look = rp.clone().add(this.lookOff!);
    const shake = 0.01 * sp;
    this.cam.position.copy(camPos).add(V3(Math.sin(this.t * 31) * shake, Math.sin(this.t * 27) * shake, 0));
    this.cam.lookAt(look);

    // Ghost rides in the next lane and fades out as it nears the camera instead of clipping through it.
    const G = this.ghost.g;
    const gNear = f.ghostOn && Math.abs(f.ghostGap) < 320;
    if (gNear) {
      const gd = toL(f.ghostPos + 5).sub(toL(f.ghostPos - 5)); gd.y = 0;
      if (gd.lengthSq() < 1e-8) gd.set(0, 0, -1);
      gd.normalize();
      G.position.copy(toL(f.ghostPos).addScaledVector(V3(-gd.z, 0, gd.x), 0.5));
      G.position.y += 0.1;
      G.rotation.y = Math.atan2(-gd.x, -gd.z);
      this.ghost.update(dt, mps || 7, crank * 1.02);
      this.ghost.setOpacity?.(0.5 * smoothstep(3.5, 9, G.position.distanceTo(this.cam.position)));
    } else this.ghost.setOpacity?.(0);

    const sky = fwd.clone().applyAxisAngle(UP, 0.55);
    this.sky.material.uniforms.sunPosition.value.set(sky.x, 0.11, sky.z).normalize();
    const key = fwd.clone().applyAxisAngle(UP, 1.15), ld = V3(key.x * 0.82, 0.55, key.z * 0.82).normalize();
    // Centre the shadow box ahead of the rider, where the camera is looking, and snap it to whole
    // shadow texels so shadow edges don't shimmer as the rider moves.
    const sq = QUALITY[this.quality], ahead = rp.clone().addScaledVector(fwd, sq.shadowR * 0.6);
    if (sq.shadow) {
      const texel = (sq.shadowR * 2) / sq.shadow;
      _lm.lookAt(ld, _o, UP);
      _li.copy(_lm).invert();
      ahead.applyMatrix4(_li);
      ahead.x = Math.round(ahead.x / texel) * texel; ahead.y = Math.round(ahead.y / texel) * texel;
      ahead.applyMatrix4(_lm);
    }
    this.sun.position.copy(ahead).addScaledVector(ld, 120);
    this.sun.target.position.copy(ahead);
    this.base.position.set(rp.x, rp.y - 1.5, rp.z);
    if (this.traffic) this.traffic.update(dt, f.pos, { toL, city: w.biome === "city", lo: w.m0 - 480, hi: w.m0 + 2680 });
    this.renderer.render(this.scene, this.cam);
  }

  private swapIn(w: Win) {
    if (this.win) this.dropWin();
    this.win = w;
    this.scene.add(w.group);
    this.info = w.label;
    // Map data may have arrived while this window was being built.
    const farDone = !w.farKeys.length || this.deps.osmFar?.get(w.farKeys).state === "complete";
    if (w.osmState !== "complete" && w.osmState !== "none" && this.deps.osm.get(w.keys).state === "complete" && farDone) this.osmArrived(w.m0);
  }

  private dropWin() {
    const w = this.win;
    if (!w) return;
    this.scene.remove(w.group);
    const shared = SHARED_GEOS();
    w.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if ((o as THREE.InstancedMesh).isInstancedMesh) { (o as THREE.InstancedMesh).dispose(); return; }
      if (mesh.geometry && !shared.has(mesh.geometry)) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material & { map?: THREE.Texture | null };
      if (mat?.userData?.ownMap) mat.map?.dispose();
      if (mat?.userData?.ownNormal) (mat as THREE.MeshStandardMaterial).normalMap?.dispose();
      if (mat?.userData?.own) mat.dispose();
    });
    this.win = null;
  }

  dispose() {
    this.dropWin();
    this.renderer?.dispose();
    this.ready = false;
  }
}

// ---------- OSM meshes ----------
function polyMesh(polys: Array<{ rings: LngLat[][]; color: number }>, toMap: (p: LngLat) => THREE.Vector2, yAt: (x: number, z: number) => number, y: number, offset: number, mo: { r?: number; m?: number }) {
  const pos: number[] = [], col: number[] = [], c = new THREE.Color();
  for (const { rings, color } of polys) {
    const rs = rings.map((r) => { const pts = r.map(toMap); if (pts.length > 1 && pts[0].equals(pts[pts.length - 1])) pts.pop(); return pts; }).filter((r) => r.length >= 3);
    if (!rs.length) continue;
    if (ringArea(rs[0]) < 0) rs[0].reverse();
    for (let k = 1; k < rs.length; k++) if (ringArea(rs[k]) > 0) rs[k].reverse();
    let faces: number[][];
    try { faces = THREE.ShapeUtils.triangulateShape(rs[0], rs.slice(1)); } catch { continue; }
    const all = rs.flat();
    c.set(color);
    // Flat polygons sit at the elevation of the road point nearest their middle.
    let cx = 0, cz = 0;
    for (const v of rs[0]) { cx += v.x; cz += -v.y; }
    const py = yAt(cx / rs[0].length, cz / rs[0].length) + y;
    for (const f of faces) {
      let [i, j, k] = f;
      const A = all[i], B = all[j], C2 = all[k];
      if ((B.x - A.x) * (C2.y - A.y) - (B.y - A.y) * (C2.x - A.x) < 0) [j, k] = [k, j];
      for (const v of [all[i], all[j], all[k]]) { pos.push(v.x, py, -v.y); col.push(c.r, c.g, c.b); }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: mo.r ?? 0.95, metalness: mo.m ?? 0, polygonOffset: true, polygonOffsetFactor: 1 - offset * 0.2, polygonOffsetUnits: 2 });
  m.userData.own = true;
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}

function estHeight(b: { rings: LngLat[][]; h: number; mh: number }, area: number, city: boolean) {
  if (b.h > 5.5 || b.mh > 0) return b.h;
  const p = b.rings[0][0], r = hash01(p[0], p[1]), r2 = hash01(p[1], p[0]);
  if (area < 120) return 5 + 3 * r;
  if (area < 450) return city ? 8 + 6 * r : 7 + 3 * r;
  if (area < 1600) return city ? (r2 > 0.35 ? 16 + 26 * r : 9 + 6 * r) : 9 + 6 * r;
  return city ? (r2 > 0.5 ? 22 + 40 * r : 12 + 8 * r) : 10 + 6 * r;
}

type Bld = { rings: LngLat[][]; h: number; mh: number; y: number };
/** Height over which building walls darken toward the ground. */
const AO_H = 5;
const TINTS: Record<FacadeStyle, number[]> = {
  glass: [0xffffff, 0xd2ecff, 0xc9e6dc, 0xf3e0c4, 0xe2e6ea],
  office: [0xffffff, 0xf2ece2, 0xe4eaf0, 0xeee4d6],
  residential: [0xffffff, 0xf7eee0, 0xf1e4cf, 0xece6dc, 0xf6e7d6],
  villa: [0xffffff, 0xfaf0dc, 0xf3e3c6, 0xf6ead8],
};
const ROOF: Record<FacadeStyle, number> = { glass: 0x8f9aa1, office: 0xb3ada2, residential: 0xcbbfa9, villa: 0xc9b28e };

function styleOf(p0: LngLat, h: number, area: number): FacadeStyle {
  const t = hash01(p0[1] * 3.1, p0[0] * 1.7);
  if (h > 45) return t < 0.7 ? "glass" : "office";
  if (h > 16) return t < 0.4 ? "office" : t < 0.55 ? "glass" : "residential";
  if (h <= 9 && area < 450) return "villa";
  return "residential";
}

/** Extruded OSM footprints with real-scale facade textures (≈3 m bays, 3.4 m floors) grouped by style. */
function buildingMeshes(blds: Bld[], toMap: (p: LngLat) => THREE.Vector2, city: boolean, opts: { shadows?: boolean; roofUnits?: Item[] } = {}) {
  const walls: Record<string, { p: number[]; u: number[]; c: number[] }> = {};
  const rp: number[] = [], rc: number[] = [], c = new THREE.Color();
  for (const b of blds) {
    const rs = b.rings.map((r) => { const pts = r.map(toMap); if (pts.length > 1 && pts[0].equals(pts[pts.length - 1])) pts.pop(); return pts; }).filter((r) => r.length >= 3);
    if (!rs.length) continue;
    if (ringArea(rs[0]) < 0) rs[0].reverse();
    for (let k = 1; k < rs.length; k++) if (ringArea(rs[k]) > 0) rs[k].reverse();
    const area = Math.abs(ringArea(rs[0]));
    const h = Math.max(4, estHeight(b, area, city)), y0 = b.y + Math.min(Math.max(0, b.mh), h - 2) - 0.5, y1 = b.y + h;
    const p0 = b.rings[0][0], st = styleOf(p0, h, area), tints = TINTS[st];
    c.set(tints[Math.floor(hash01(p0[0] * 7.3, p0[1] * 2.9) * tints.length)]);
    const w = (walls[st] ??= { p: [], u: [], c: [] });
    const cAo = b.mh > 0 ? c : c.clone().multiplyScalar(0.5); // raised parts (bridges, overhangs) aren't on the ground
    const vOff = hash01(p0[0], p0[1] * 5) * 0.5;
    for (const r of rs) {
      let acc = hash01(p0[1], p0[0]) * 24;
      for (let i = 0; i < r.length; i++) {
        const a = r[i], q = r[(i + 1) % r.length], len = a.distanceTo(q), u0 = acc / 24, u1 = (acc + len) / 24;
        acc += len;
        // Two bands: the lowest few metres darken toward the ground (cheap ambient occlusion), the rest is plain.
        const ya = Math.min(y1, y0 + AO_H), va = vOff + (ya - y0) / 27.2, v1 = vOff + (y1 - y0) / 27.2;
        const band = (yb: number, yt: number, vb: number, vt: number, cb: THREE.Color, ct: THREE.Color) => {
          w.p.push(a.x, yb, -a.y, q.x, yb, -q.y, q.x, yt, -q.y, a.x, yb, -a.y, q.x, yt, -q.y, a.x, yt, -a.y);
          w.u.push(u0, vb, u1, vb, u1, vt, u0, vb, u1, vt, u0, vt);
          for (const cc of [cb, cb, ct, cb, ct, ct]) w.c.push(cc.r, cc.g, cc.b);
        };
        band(y0, ya, vOff, va, cAo, c);
        if (y1 > ya) band(ya, y1, va, v1, c, c);
      }
    }
    let faces: number[][];
    try { faces = THREE.ShapeUtils.triangulateShape(rs[0], rs.slice(1)); } catch { faces = []; }
    const all = rs.flat(), rcol = new THREE.Color(ROOF[st]).multiplyScalar(0.9 + hash01(p0[0] * 3, p0[1]) * 0.15);
    for (const f of faces) {
      let [i, j, k] = f;
      const A = all[i], B = all[j], C2 = all[k];
      if ((B.x - A.x) * (C2.y - A.y) - (B.y - A.y) * (C2.x - A.x) < 0) [j, k] = [k, j];
      for (const v of [all[i], all[j], all[k]]) { rp.push(v.x, y1, -v.y); rc.push(rcol.r, rcol.g, rcol.b); }
    }
    // Rooftop plant (AC units, stair heads) on larger flat roofs.
    if (opts.roofUnits && area > 250 && st !== "villa") {
      let cx = 0, cy = 0;
      for (const v of rs[0]) { cx += v.x; cy += v.y; }
      cx /= rs[0].length; cy /= rs[0].length;
      const rr = rng(Math.floor(hash01(p0[0], p0[1]) * 1e9)), n = 1 + Math.floor(rr() * 3), rad = Math.sqrt(area) * 0.22;
      for (let k = 0; k < n; k++) {
        const sx = 1.6 + rr() * 2.6, sz = 1.4 + rr() * 2.2, sy = 1 + rr() * 1.8;
        opts.roofUnits.push({ x: cx + (rr() - 0.5) * rad, y: y1 - 0.05, z: -(cy + (rr() - 0.5) * rad), sx, sy, sz, ry: rr() * TAU });
      }
    }
  }
  const out: THREE.Mesh[] = [];
  for (const st of FACADE_STYLES) {
    const w = walls[st];
    if (!w?.p.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(w.p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(w.u, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(w.c, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, MAT["facade_" + st]);
    mesh.castShadow = opts.shadows !== false; mesh.receiveShadow = true;
    out.push(mesh);
  }
  if (rp.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(rp, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(rc, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, MAT.roof);
    mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}

function roadMeshes(roads: OsmData["r"], toL: (p: LngLat, y?: number) => THREE.Vector3, yAt: (x: number, z: number) => number) {
  const geos: THREE.BufferGeometry[] = [];
  for (const r of roads) {
    const C = r.line.map((p) => { const v = toL(p); v.y = yAt(v.x, v.z); return v; });
    if (C.length < 2) continue;
    const g = ribbon(C, -r.w / 2, r.w / 2, 0.06, 9);
    g.deleteAttribute("uv");
    geos.push(g);
  }
  if (!geos.length) return null;
  let merged: THREE.BufferGeometry | null;
  try { merged = mergeGeometries(geos); } catch { return null; }
  geos.forEach((g) => g.dispose());
  if (!merged) return null;
  const m = new THREE.MeshStandardMaterial({ color: 0x66656a, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 1 });
  m.userData.own = true;
  const mesh = new THREE.Mesh(merged, m);
  mesh.receiveShadow = true;
  return mesh;
}
