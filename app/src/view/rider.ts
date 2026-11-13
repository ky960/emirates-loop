import * as THREE from "three";
import { clamp, TAU } from "../util";

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);

function orient(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a), len = d.length();
  m.position.copy(a).addScaledVector(d, 0.5);
  m.scale.set(1, len, 1);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
}

export interface RiderKit { jersey: number; panel: number; frame: number }
export const DEFAULT_KIT: RiderKit = { jersey: 0xf0622e, panel: 0xfff4e6, frame: 0x12898a };

export interface RiderModel {
  g: THREE.Group;
  /** dt (s), road speed (m/s), crank angle (rad), climbing effort 0..1 (out of the saddle on steep climbs). */
  update(dt: number, mps: number, crank: number, climb?: number): void;
  setOpacity?(o: number): void;
}

/** Low-poly cyclist with inverse-kinematics legs that follow the crank. */
export function buildRider(override?: THREE.Material, kit: RiderKit = DEFAULT_KIT): RiderModel {
  const M = (c: number, o: { r?: number; m?: number } = {}) =>
    override || new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.6, metalness: o.m ?? 0 });
  const rod = (rT: number, rB: number, m: THREE.Material, seg = 12) => new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, 1, seg), m);
  const ball = (r: number, m: THREE.Material) => new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m);
  const g = new THREE.Group();
  const P = (f: number, y: number, x = 0) => V3(x, y, -f);
  const frame = M(kit.frame, { r: 0.35, m: 0.3 }), carbon = M(0x17181c, { r: 0.4 }), alloy = M(0xc8ccd2, { r: 0.3, m: 0.9 });
  const jersey = M(kit.jersey), panel = M(kit.panel), bib = M(0x1e1f26, { r: 0.7 }), skin = M(0xc98a62, { r: 0.55 }), white = M(0xf7f6f2, { r: 0.35 });
  const wheels: THREE.Group[] = [];
  for (const f of [-0.5, 0.5]) {
    const w = new THREE.Group();
    w.position.copy(P(f, 0.34));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 10, 40), carbon);
    rim.rotation.y = Math.PI / 2;
    w.add(rim);
    const tr = new THREE.Mesh(new THREE.TorusGeometry(0.336, 0.02, 8, 44), M(0x2a2a2e, { r: 0.9 }));
    tr.rotation.y = Math.PI / 2;
    w.add(tr);
    for (let i = 0; i < 6; i++) {
      const s = rod(0.006, 0.006, alloy, 4);
      s.scale.y = 0.58;
      s.rotation.x = (i * Math.PI) / 6;
      w.add(s);
    }
    g.add(w);
    wheels.push(w);
  }
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, m = frame) => { const t = rod(r, r, m); orient(t, a, b); g.add(t); };
  tube(P(0, 0.27), P(-0.15, 0.82), 0.026); tube(P(-0.15, 0.82), P(0.38, 0.84), 0.024); tube(P(0, 0.27), P(0.42, 0.69), 0.032);
  tube(P(0.42, 0.69), P(0.38, 0.84), 0.03); tube(P(0, 0.27), P(-0.5, 0.34), 0.016); tube(P(-0.15, 0.82), P(-0.5, 0.34), 0.014);
  tube(P(0.42, 0.69), P(0.5, 0.34), 0.018); tube(P(-0.15, 0.82), P(-0.2, 0.93), 0.016, carbon); tube(P(0.38, 0.84), P(0.48, 0.88), 0.018, carbon);
  { const b = rod(0.016, 0.016, carbon); orient(b, P(0.48, 0.88, -0.21), P(0.48, 0.88, 0.21)); g.add(b); }

  const hipSeat = P(-0.18, 0.98);
  const upper = new THREE.Group();
  upper.position.copy(hipSeat);
  g.add(upper);
  const U = (f: number, y: number, x = 0) => P(f, y, x).sub(hipSeat);
  const sv = U(0.25, 1.33), tl = sv.length();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, tl - 0.1, 6, 14), jersey);
  torso.position.copy(sv).multiplyScalar(0.5);
  torso.quaternion.setFromUnitVectors(UP, sv.clone().normalize());
  torso.scale.set(1.28, 1, 0.88);
  upper.add(torso);
  if (!override) {
    const pn = new THREE.Mesh(new THREE.CapsuleGeometry(0.143, tl - 0.36, 4, 14), panel);
    pn.position.copy(torso.position);
    pn.quaternion.copy(torso.quaternion);
    pn.scale.set(1.3, 1, 0.5);
    upper.add(pn);
  }
  const pel = ball(0.15, bib);
  pel.scale.set(1.25, 0.9, 1.1);
  upper.add(pel);
  const head = new THREE.Group();
  head.position.copy(U(0.37, 1.48));
  upper.add(head);
  head.add(ball(0.105, skin));
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 12, 0, TAU, 0, Math.PI * 0.55), white);
  helm.position.set(0, 0.02, 0.02);
  helm.scale.set(1, 0.85, 1.32);
  helm.rotation.x = 0.28;
  head.add(helm);
  for (const s of [-1, 1]) {
    const a = U(0.24, 1.32, s * 0.19), h = U(0.54, 0.86, s * 0.21), e = a.clone().lerp(h, 0.5).add(V3(s * 0.05, -0.07, 0));
    const ua = rod(0.056, 0.046, jersey); orient(ua, e, a); upper.add(ua);
    const fa = rod(0.043, 0.034, skin); orient(fa, h, e); upper.add(fa);
  }
  const legs = [-1, 1].map((s) => {
    const o = {
      s, th: rod(0.086, 0.06, bib), sh: rod(0.056, 0.038, skin), kn: ball(0.06, skin),
      shoe: new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.19, 4, 10), white), cr: rod(0.016, 0.016, alloy),
    };
    o.shoe.geometry.rotateX(Math.PI / 2);
    g.add(o.th, o.sh, o.kn, o.shoe, o.cr);
    return o;
  });
  const L1 = 0.45, L2 = 0.43, CR = 0.17;
  let stand = 0;

  function update(dt: number, mps: number, ck: number, climb = 0) {
    wheels.forEach((w) => (w.rotation.x -= (mps / 0.336) * dt));
    // Out of the saddle on steep climbs: hips forward and up, more rock.
    stand += (clamp(climb, 0, 1) - stand) * Math.min(1, dt * 1.5);
    const eff = Math.min(1, mps / 5) * (1 + stand * 2.2);
    const hipF = -0.18 + stand * 0.12, hipY = 0.98 + stand * 0.05;
    upper.position.copy(P(hipF, hipY));
    upper.rotation.z = Math.sin(ck) * 0.03 * eff;
    head.rotation.z = -upper.rotation.z * 0.9;
    g.rotation.z = Math.sin(ck) * (0.01 + stand * 0.05) * Math.min(1, mps / 2);
    legs.forEach((l) => {
      const th = ck + (l.s > 0 ? 0 : Math.PI), x = l.s * 0.1, pf = CR * Math.cos(th), py = 0.27 - CR * Math.sin(th);
      const pitch = -0.18 - 0.26 * Math.sin(th) + 0.08 * Math.cos(th);
      const af = pf - 0.055 * Math.cos(pitch) - 0.075 * Math.sin(pitch), ay = py + 0.075 * Math.cos(pitch) - 0.055 * Math.sin(pitch);
      const dx = af - hipF, dy = ay - hipY, d = Math.min(L1 + L2 - 0.002, Math.hypot(dx, dy));
      const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)), base = Math.atan2(dy, dx);
      const kf = hipF + L1 * Math.cos(base + a), ky = hipY + L1 * Math.sin(base + a);
      orient(l.th, P(kf, ky, x), P(hipF, hipY, x));
      orient(l.sh, P(af, ay, x), P(kf, ky, x));
      l.kn.position.copy(P(kf, ky, x));
      l.shoe.position.copy(P(pf + 0.01, py + 0.045, x * 1.15));
      l.shoe.rotation.x = -pitch;
      orient(l.cr, P(0, 0.27, x * 1.25), P(pf, py, x * 1.25));
    });
  }
  const setOpacity = override
    ? (o: number) => { (override as THREE.Material & { opacity: number }).opacity = o; g.visible = o > 0.01; }
    : undefined;
  return { g, update, setOpacity };
}
