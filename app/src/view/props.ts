import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng, TAU } from "../util";

/** Date palm crown: ~22 arching, drooping fronds with a folded (V-shaped) cross-section. */
export function palmCrownGeometry(): THREE.BufferGeometry {
  const r = rng(21);
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const SEG = 10;
  const frond = (az: number, el: number, len: number, droop: number, dead: boolean) => {
    const base = pos.length / 3;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
    const c = dead ? [0.95, 0.72, 0.45] : [1, 1, 1];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const p = dir.clone().multiplyScalar(len * t);
      p.y -= droop * t * t * len;
      // tangent for the fold direction
      const w = 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08 + 0.04)), 0.7) * (dead ? 0.7 : 1);
      const fold = 0.12 * w;
      const l = p.clone().addScaledVector(side, -w); l.y -= fold;
      const rr = p.clone().addScaledVector(side, w); rr.y -= fold;
      pos.push(l.x, l.y, l.z, p.x, p.y + fold * 0.3, p.z, rr.x, rr.y, rr.z);
      uv.push(0, t, 0.5, t, 1, t);
      for (let k = 0; k < 3; k++) col.push(...c);
      if (i < SEG) {
        const a = base + i * 3;
        idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
      }
    }
  };
  const N = 22;
  for (let k = 0; k < N; k++) {
    const az = (k / N) * TAU + r() * 0.25;
    const ring = k % 3;
    const el = ring === 0 ? 0.75 + r() * 0.2 : ring === 1 ? 0.35 + r() * 0.2 : 0.05 + r() * 0.15;
    frond(az, el, 3.0 + r() * 0.8, ring === 0 ? 0.25 : 0.5 + r() * 0.25, false);
  }
  // A few young upright fronds and dry hanging ones under the crown.
  for (let k = 0; k < 4; k++) frond(r() * TAU, 1.25, 2.2, 0.1, false);
  for (let k = 0; k < 5; k++) frond(r() * TAU, -0.9 - r() * 0.3, 1.8, 0.05, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function palmTrunkGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.17, 0.25, 1, 10, 8, true);
  g.translate(0, 0.5, 0);
  // Slight bulge just under the crown, like a real date palm.
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), s = 1 + 0.25 * Math.exp(-((y - 0.97) ** 2) / 0.002);
    p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s);
  }
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 6);
  g.computeVertexNormals();
  return g;
}

/** Ghaf tree: crooked trunk with branches and a wide, lumpy, layered canopy. */
export function ghafGeometry(): { wood: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const r = rng(77);
  const woods: THREE.BufferGeometry[] = [];
  const limb = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number) => {
    const d = b.clone().sub(a), len = d.length();
    const c = new THREE.CylinderGeometry(r1, r0, len, 6, 1);
    c.translate(0, len / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    c.translate(a.x, a.y, a.z);
    woods.push(c);
  };
  const top = new THREE.Vector3(0.15, 1.7, 0.05);
  limb(new THREE.Vector3(0, 0, 0), top, 0.22, 0.16);
  const tips: THREE.Vector3[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + r(), tip = new THREE.Vector3(Math.cos(a) * (1.2 + r()), 2.6 + r() * 0.7, Math.sin(a) * (1.2 + r()));
    limb(top, tip, 0.12, 0.05);
    tips.push(tip);
  }
  const blobs: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  const blob = (at: THREE.Vector3, s: number) => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position as THREE.BufferAttribute, cols: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.18 * Math.sin(x * 5.1 + z * 3.7) * Math.cos(y * 4.3) + (r() - 0.5) * 0.12;
      p.setXYZ(i, x * n * s * 1.25, y * n * s * 0.55, z * n * s * 1.25);
      c.setHSL(0.2 + r() * 0.04, 0.32 + r() * 0.1, 0.27 + y * 0.06 + r() * 0.04);
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    g.translate(at.x, at.y, at.z);
    blobs.push(g);
  };
  blob(new THREE.Vector3(0.1, 2.9, 0), 1.7);
  for (const t of tips) blob(t.clone().add(new THREE.Vector3(0, 0.25, 0)), 0.9 + r() * 0.4);
  const wood = mergeGeometries(woods)!;
  const canopy = mergeGeometries(blobs.map((b) => (b.index ? b.toNonIndexed() : b)))!;
  canopy.computeVertexNormals();
  return { wood, canopy };
}

/** Sedan / SUV made of an extruded side profile, with separate glass, wheels and lights. */
export function carGeometry(kind: "sedan" | "suv") {
  const L = kind === "suv" ? 4.8 : 4.6, H = kind === "suv" ? 1.75 : 1.42, W = kind === "suv" ? 1.95 : 1.8;
  const s = new THREE.Shape();
  const cl = 0.32; // ground clearance (bottom of body)
  if (kind === "suv") {
    s.moveTo(-L / 2, cl); s.lineTo(L / 2, cl); s.lineTo(L / 2, 0.95); s.lineTo(L / 2 - 0.25, 1.1); s.lineTo(L / 2 - 1.1, 1.18);
    s.lineTo(L / 2 - 1.6, H); s.lineTo(-L / 2 + 0.15, H); s.lineTo(-L / 2, 1.2); s.lineTo(-L / 2, cl);
  } else {
    s.moveTo(-L / 2, cl); s.lineTo(L / 2, cl); s.lineTo(L / 2, 0.82); s.lineTo(L / 2 - 0.3, 0.98); s.lineTo(L / 2 - 1.3, 1.04);
    s.lineTo(L / 2 - 2.0, H); s.lineTo(-L / 2 + 1.05, H); s.lineTo(-L / 2 + 0.25, 1.05); s.lineTo(-L / 2, 0.98); s.lineTo(-L / 2, cl);
  }
  const body = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2, steps: 1 });
  body.translate(0, 0, -W / 2);
  body.rotateY(Math.PI / 2); // length along -Z / +Z
  // Glass: slightly inset band around the cabin
  const gs = new THREE.Shape();
  const g0 = kind === "suv" ? 1.18 : 1.05, g1 = H - 0.06;
  if (kind === "suv") { gs.moveTo(L / 2 - 1.15, g0); gs.lineTo(L / 2 - 1.58, g1); gs.lineTo(-L / 2 + 0.2, g1); gs.lineTo(-L / 2 + 0.06, g0); }
  else { gs.moveTo(L / 2 - 1.35, g0); gs.lineTo(L / 2 - 1.95, g1); gs.lineTo(-L / 2 + 1.08, g1); gs.lineTo(-L / 2 + 0.32, g0); }
  gs.closePath();
  const glass = new THREE.ExtrudeGeometry(gs, { depth: W + 0.1, bevelEnabled: false });
  glass.translate(0, 0, -(W + 0.1) / 2);
  glass.rotateY(Math.PI / 2);
  const wheels: THREE.BufferGeometry[] = [];
  for (const z of [L / 2 - 0.85, -L / 2 + 0.8]) for (const x of [-W / 2 - 0.02, W / 2 + 0.02]) {
    const w = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
    w.rotateZ(Math.PI / 2);
    w.translate(x, 0.34, z);
    wheels.push(w);
  }
  const lamps: THREE.BufferGeometry[] = [];
  for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) {
    lamps.push(new THREE.BoxGeometry(0.42, 0.12, 0.06).translate(x, kind === "suv" ? 0.92 : 0.78, L / 2 + 0.09)); // tail lights: the rear is +Z after the rotation
  }
  const heads: THREE.BufferGeometry[] = [];
  for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) heads.push(new THREE.BoxGeometry(0.4, 0.1, 0.06).translate(x, kind === "suv" ? 0.88 : 0.74, -L / 2 - 0.09));
  return { body, glass, wheels: mergeGeometries(wheels)!, tail: mergeGeometries(lamps)!, head: mergeGeometries(heads)!, length: L };
}

/** Sweep a 2-D cross-section (lateral offset, height) along a centreline. */
export function sweep(C: THREE.Vector3[], profile: Array<[number, number]>, lateral: number, closedEnds = false): THREE.BufferGeometry {
  const n = C.length, m = profile.length, pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2), idx: number[] = [];
  let acc = 0;
  const t = new THREE.Vector3(0, 0, -1);
  for (let i = 0; i < n; i++) {
    const a = C[Math.max(0, i - 1)], b = C[Math.min(n - 1, i + 1)], d = b.clone().sub(a);
    d.y = 0;
    if (d.lengthSq() > 1e-8) t.copy(d.normalize());
    const nx = -t.z, nz = t.x;
    if (i) acc += C[i].distanceTo(C[i - 1]);
    for (let k = 0; k < m; k++) {
      const [o, h] = profile[k], off = lateral + o;
      pos.set([C[i].x + nx * off, C[i].y + h, C[i].z + nz * off], (i * m + k) * 3);
      uv.set([acc / 4, k / (m - 1)], (i * m + k) * 2);
    }
    if (i < n - 1) for (let k = 0; k < m - 1; k++) {
      const p = i * m + k, q = p + m;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  void closedEnds;
  return g;
}

/** New Jersey concrete barrier cross-section (centred on 0, 0.81 m tall). */
export const JERSEY: Array<[number, number]> = [[-0.3, 0], [-0.28, 0.08], [-0.13, 0.33], [-0.08, 0.81], [0.08, 0.81], [0.13, 0.33], [0.28, 0.08], [0.3, 0]];
/** W-beam guardrail face (thin vertical band facing the road). */
export const WBEAM: Array<[number, number]> = [[0, 0.52], [0.05, 0.6], [0, 0.68], [0.05, 0.76], [0, 0.84]];
