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

// ---------------------------------------------------------------------------------------------
// Detailed rider: rigged cyclist model ("Rigged cyclist" by novusod, CC BY 4.0).
// Its legs are driven by two-bone IK so the feet follow the crank, like the procedural rider.

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

/** Turn `bone` (in world space) so the direction `from` points along `to`. */
function aim(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  _q1.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  bone.getWorldQuaternion(_q2);
  _q2.premultiply(_q1);
  bone.parent!.getWorldQuaternion(_q1);
  bone.quaternion.copy(_q1.invert().multiply(_q2));
  bone.updateMatrixWorld(true);
}

/**
 * Paint a cycling jersey over the bare torso of the body mesh: vertices weighted to the spine,
 * shoulders and the top of the upper arms get the kit colour.
 */
function jerseyMaterial(mesh: THREE.SkinnedMesh, kit: RiderKit) {
  const g = mesh.geometry, sk = mesh.skeleton, si = g.getAttribute("skinIndex"), sw = g.getAttribute("skinWeight"), pos = g.getAttribute("position");
  const kind = sk.bones.map((b) => (/Spine|Shoulder/.test(b.name) ? 1 : /Hips/.test(b.name) ? 2 : /(Left|Right)Arm(_\d+)?$/.test(b.name) ? 3 : 0));
  const joint = sk.boneInverses.map((m) => new THREE.Vector3().setFromMatrixPosition(m.clone().invert()));
  const mask = new Float32Array(pos.count), get = [si.getX, si.getY, si.getZ, si.getW], getW = [sw.getX, sw.getY, sw.getZ, sw.getW];
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    let m = 0;
    for (let c = 0; c < 4; c++) {
      const b = get[c].call(si, i), w = getW[c].call(sw, i), k = kind[b];
      if (k === 1 || k === 2) m += w;
      else if (k === 3 && p.distanceTo(joint[b]) < 0.17) m += w; // short sleeves
    }
    mask[i] = m;
  }
  g.setAttribute("jersey", new THREE.BufferAttribute(mask, 1));
  const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
  const col = new THREE.Color(kit.jersey);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.jerseyColor = { value: col };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float jersey;\nvarying float vJersey;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvJersey = jersey;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 jerseyColor;\nvarying float vJersey;")
      .replace("#include <map_fragment>", "#include <map_fragment>\nfloat jm = smoothstep(0.35, 0.6, vJersey);\ndiffuseColor.rgb = mix(diffuseColor.rgb, jerseyColor, jm);")
      // Fabric is smooth: drop most of the skin's muscle detail from the normal map under the jersey.
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nvec3 jerseyN = normal;")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(mix(normal, jerseyN, jm * 0.85));");
  };
  return mat;
}

export function buildModelRider(gltf: { scene: THREE.Group }, kit: RiderKit = DEFAULT_KIT): RiderModel | null {
  const scene = gltf.scene;
  const bones: Record<string, THREE.Bone> = {};
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name.replace(/^mixamorig:?/, "").replace(/_\d+$/, "")] = o as THREE.Bone;
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const need = ["Hips", "Spine", "Head", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"];
  if (need.some((n) => !bones[n])) return null;

  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI; // model faces +Z; the scene expects -Z
  inner.add(scene);
  scene.position.z = -0.04; // centre between the wheel hubs
  g.add(inner);
  g.updateMatrixWorld(true);

  // Body (largest skinned mesh) gets the jersey; hair is hidden under the helmet.
  const skinned = meshes.filter((m) => (m as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh[];
  const size = (m: THREE.Mesh) => m.geometry.getAttribute("position").count;
  const body = skinned.reduce((a, b) => (size(a) > size(b) ? a : b));
  body.material = jerseyMaterial(body, kit);
  const hair = skinned.find((m) => new THREE.Box3().setFromObject(m).min.y > 1.4);
  if (hair) hair.visible = false;
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }

  // Wheels: re-pivot each tyre about its hub so it can spin.
  const wheels: THREE.Group[] = [];
  for (const m of meshes) {
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) continue;
    const bb = new THREE.Box3().setFromObject(m), s = bb.getSize(_v1);
    if (s.y < 0.6 || s.x > 0.3 || s.z > 0.8) continue; // the frame is wider/longer than a wheel
    const c = scene.worldToLocal(bb.getCenter(new THREE.Vector3()));
    const pivot = new THREE.Group();
    pivot.position.copy(c);
    scene.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(m);
    wheels.push(pivot);
  }

  // Crank: pedal axle at the chainring centre; our own arms and pedals turn with the legs.
  const BB = new THREE.Vector3(0, 0.34, 0.053), CR = 0.16;
  const crank = new THREE.Group();
  crank.position.copy(BB);
  scene.add(crank);
  const black = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.4, metalness: 0.6 });
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, CR + 0.02), black);
    arm.position.set(s * 0.085, 0, (-s * CR) / 2); // right arm (x < 0) points forward at angle 0
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.07), black);
    pedal.position.set(s * 0.13, 0, -s * CR);
    arm.castShadow = pedal.castShadow = true;
    crank.add(arm, pedal);
  }

  // Helmet, following the head bone.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 12, 0, TAU, 0, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.35 }));
  helmet.scale.set(0.9, 0.85, 1.16);
  helmet.castShadow = true;
  // Placed in model space (Y up, +Z forward) relative to the head bone, then turned with the head.
  const helmetPivot = new THREE.Group();
  helmetPivot.add(helmet);
  helmet.position.set(0, 0.098, -0.008);
  helmet.rotation.x = -0.14; // front edge up at the brow, back down over the nape
  scene.add(helmetPivot);
  const headBind = bones.Head.getWorldQuaternion(new THREE.Quaternion()).premultiply(scene.getWorldQuaternion(new THREE.Quaternion()).invert()).invert();

  // Bind pose, in scene space, to reset from every frame.
  const legs = (["Right", "Left"] as const).map((side, i) => {
    const up = bones[side + "UpLeg"], low = bones[side + "Leg"], foot = bones[side + "Foot"];
    const toe = bones[side + "ToeBase"] ?? foot;
    const ankle = scene.worldToLocal(foot.getWorldPosition(new THREE.Vector3())), ball = scene.worldToLocal(toe.getWorldPosition(new THREE.Vector3()));
    return {
      up, low, foot, phase: i * Math.PI, x: ball.x,
      q: [up.quaternion.clone(), low.quaternion.clone(), foot.quaternion.clone()],
      // Ankle position relative to the ball of the foot (which sits on the pedal).
      off: ankle.sub(ball),
      footW: foot.getWorldQuaternion(new THREE.Quaternion()).premultiply(scene.getWorldQuaternion(new THREE.Quaternion()).invert()),
    };
  });
  const spine = bones.Spine, spineQ = spine.quaternion.clone();
  const sceneQ = new THREE.Quaternion(), fwd = new THREE.Vector3(), tgt = new THREE.Vector3(), H = new THREE.Vector3(), K = new THREE.Vector3(), A = new THREE.Vector3();

  function update(dt: number, mps: number, ck: number) {
    wheels.forEach((w) => (w.rotation.x += (mps / 0.35) * dt));
    crank.rotation.x = ck;
    const eff = Math.min(1, mps / 5);
    spine.quaternion.copy(spineQ).multiply(_q1.setFromAxisAngle(_v1.set(0, 0, 1), Math.sin(ck) * 0.035 * eff));
    g.rotation.z = Math.sin(ck) * 0.01 * Math.min(1, mps / 2);
    g.updateMatrixWorld(true);
    scene.getWorldQuaternion(sceneQ);
    fwd.set(0, 0, 1).applyQuaternion(sceneQ);
    for (const l of legs) {
      l.up.quaternion.copy(l.q[0]); l.low.quaternion.copy(l.q[1]); l.foot.quaternion.copy(l.q[2]);
      l.up.updateMatrixWorld(true);
      const th = ck + l.phase;
      // Pedal (ball of foot) on the crank circle, ankle a little behind and above it; heel drops slightly on the downstroke.
      const ankling = -0.25 * Math.sin(th) + 0.1;
      const off = _v3.copy(l.off).applyAxisAngle(_v1.set(1, 0, 0), ankling);
      tgt.set(l.x, BB.y - CR * Math.sin(th), BB.z + CR * Math.cos(th)).add(off);
      scene.localToWorld(tgt);
      l.up.getWorldPosition(H); l.low.getWorldPosition(K); l.foot.getWorldPosition(A);
      const L1 = H.distanceTo(K), L2 = K.distanceTo(A);
      const dir = _v2.subVectors(tgt, H), d = clamp(dir.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
      dir.normalize();
      const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
      const pole = fwd.clone().addScaledVector(dir, -fwd.dot(dir)).normalize(); // knees bend forward
      const knee = H.clone().addScaledVector(dir, L1 * Math.cos(a)).addScaledVector(pole, L1 * Math.sin(a));
      aim(l.up, K.clone().sub(H), knee.clone().sub(H));
      l.low.getWorldPosition(K); l.foot.getWorldPosition(A);
      aim(l.low, A.clone().sub(K), tgt.clone().sub(K));
      // Keep the foot at its modelled angle (plus ankling) instead of following the shin.
      const want = _q2.copy(sceneQ).multiply(l.footW).premultiply(_q1.setFromAxisAngle(_v1.set(1, 0, 0).applyQuaternion(sceneQ), ankling));
      l.foot.parent!.getWorldQuaternion(_q1);
      l.foot.quaternion.copy(_q1.invert().multiply(want));
    }
    // Helmet follows the head: same offset, turned by however far the head has rotated from its rest pose.
    const head = bones.Head;
    head.updateMatrixWorld(true);
    head.getWorldPosition(helmetPivot.position); scene.worldToLocal(helmetPivot.position);
    head.getWorldQuaternion(helmetPivot.quaternion).premultiply(_q1.copy(sceneQ).invert()).multiply(headBind);
  }
  return { g, update };
}
