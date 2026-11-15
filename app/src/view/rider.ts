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

/**
 * A character look for the detailed rider: a full suit, cape, headgear and bike. Used for the Shadow Falcon (an
 * original night hero) and the villains who ride against him.
 */
export interface Look {
  /** Full-body suit and its trim (shorts, gloves, boots). */
  suit: number; trim: number;
  cape?: number; capeLining?: number;
  head: "cowl" | "horns" | "tophat" | "hood" | "crown";
  /** Glowing eyes or visor colour. */
  eyes?: number;
  bike: "hero" | "villain";
  bikeColor: number;
  /** Gold falcon emblem on the chest. */
  emblem?: boolean;
  /** Armour: chest plate, shoulder guards, gauntlets, shin guards and a belt, in this colour (with gold trim). */
  armor?: number;
  /** Headlight beam (the hero only: it's a real light). */
  light?: boolean;
  /**
   * A rigged character (Mixamo skeleton) to wear instead of the built-in body: it's posed every frame to match the
   * cyclist's pedalling skeleton, so it rides the same bike. Headgear, emblem and armour are then left off.
   */
  body?: THREE.Object3D;
}
export interface RiderKit { jersey: number; panel: number; frame: number; look?: Look }
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
  const full = !!kit.look;
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
      if (full) m += w; // a full suit: everything
      else if (k === 1 || k === 2) m += w;
      else if (k === 3 && p.distanceTo(joint[b]) < 0.17) m += w; // short sleeves
    }
    mask[i] = m;
  }
  g.setAttribute("jersey", new THREE.BufferAttribute(mask, 1));
  const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
  const col = new THREE.Color(kit.look ? kit.look.suit : kit.jersey);
  if (kit.look) { mat.roughness = 0.45; mat.metalness = 0.25; }
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
  const look = kit.look;
  const followers: Array<() => void> = [];
  let capeUpdate: ((dt: number, mps: number) => void) | null = null, jetUpdate: ((mps: number) => void) | null = null;
  const bodyBones = bones;
  if (look) dressUp(look);

  function dressUp(L: Look) {
    if (L.body) wear(L.body);
    const M = (c: number, o: { r?: number; m?: number; e?: number; ec?: number } = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.45, metalness: o.m ?? 0.2, emissive: new THREE.Color(o.ec ?? 0), emissiveIntensity: o.e ?? 0 });
    const glow = (c: number, opacity = 0.9) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    // Shorts, shoes and other clothing in the trim colour; bike in its colour.
    for (const m of meshes) {
      if (m === body) continue;
      const mm = (m.material as THREE.MeshStandardMaterial).clone();
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) { mm.color.set(L.trim); mm.roughness = 0.5; }
      else { const isWheel = wheels.some((w) => w.children.includes(m)); mm.color.set(isWheel ? 0x18181b : L.bikeColor); mm.metalness = isWheel ? 0.1 : 0.7; mm.roughness = isWheel ? 0.8 : 0.3; }
      m.material = mm;
    }
    // Headgear replaces the cycling helmet.
    helmet.visible = false;
    const hat = new THREE.Group();
    hat.visible = !L.body;
    helmetPivot.add(hat);
    const headMat = M(L.head === "cowl" ? L.suit : L.trim, { r: 0.4, m: 0.3 });
    if (L.head === "cowl" || L.head === "hood") {
      const cowl = new THREE.Mesh(new THREE.SphereGeometry(0.118, 22, 16), headMat);
      cowl.scale.set(0.95, 1.08, 1.12); cowl.position.set(0, 0.04, -0.012); hat.add(cowl);
      if (L.head === "cowl") {
        // A swept-back crest, like a falcon's: not ears.
        const crest = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.26, 4), headMat);
        crest.scale.set(0.35, 1, 1.6); crest.rotation.x = -1.25; crest.position.set(0, 0.16, -0.1); hat.add(crest);
        // Falcon brow: a sharp beak-like ridge over the visor, and swept cheek guards.
        const brow = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 4), headMat);
        brow.scale.set(1.6, 1, 0.5); brow.rotation.x = Math.PI / 2 + 0.55; brow.position.set(0, 0.085, 0.115); hat.add(brow);
        for (const sd of [-1, 1]) {
          const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.09, 0.11), headMat);
          cheek.position.set(sd * 0.1, 0.0, 0.035); cheek.rotation.set(0.35, sd * 0.25, sd * -0.12); hat.add(cheek);
          const wing = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.12, 3), M(0x8a6a10, { m: 0.9, r: 0.3 }));
          wing.position.set(sd * 0.105, 0.07, -0.04); wing.rotation.set(-1.1, 0, sd * 0.5); hat.add(wing);
        }
      } else {
        const peak = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.16, 16), headMat);
        peak.rotation.x = -0.9; peak.position.set(0, 0.1, -0.1); hat.add(peak);
      }
    } else if (L.head === "horns") {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 12, 0, TAU, 0, Math.PI * 0.62), headMat);
      cap.scale.set(0.95, 0.95, 1.1); cap.position.y = 0.06; hat.add(cap);
      for (const sd of [-1, 1]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.14, 10), M(0xf2e8d0, { r: 0.6 })); h.position.set(sd * 0.08, 0.16, 0.02); h.rotation.z = -sd * 0.55; hat.add(h); }
    } else if (L.head === "tophat") {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 24), headMat); brim.position.y = 0.11; hat.add(brim);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.105, 0.2, 24), headMat); top.position.y = 0.21; hat.add(top);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.106, 0.106, 0.035, 24), M(L.eyes ?? 0x9b1c31)); band.position.y = 0.14; hat.add(band);
    } else {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.07, 8, 1, true), M(0xe8b923, { m: 0.9, r: 0.25 }));
      ring.position.y = 0.13; hat.add(ring);
      for (let k = 0; k < 8; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 6), ring.material); const a = (k / 8) * TAU; sp.position.set(Math.sin(a) * 0.11, 0.19, Math.cos(a) * 0.11); hat.add(sp); }
    }
    if (L.eyes !== undefined) {
      if (L.head === "cowl") {
        // Glowing visor across the eyes.
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.022, 0.03), glow(L.eyes)); visor.position.set(0, 0.055, 0.112); hat.add(visor);
      } else for (const sd of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), glow(L.eyes)); e.position.set(sd * 0.034, 0.05, 0.11); hat.add(e); }
    }
    // Chest emblem (the hero's gold falcon wings), following the upper spine.
    if (L.emblem && !L.body && bodyBones.Spine2) {
      const pv = follow(bodyBones.Spine2);
      const wing = new THREE.Shape();
      wing.moveTo(0, -0.03); wing.lineTo(0.09, 0.035); wing.lineTo(0.05, 0.03); wing.lineTo(0.075, 0.06); wing.lineTo(0.02, 0.035); wing.lineTo(0, 0.07);
      wing.lineTo(-0.02, 0.035); wing.lineTo(-0.075, 0.06); wing.lineTo(-0.05, 0.03); wing.lineTo(-0.09, 0.035); wing.closePath();
      const em = new THREE.Mesh(new THREE.ShapeGeometry(wing), new THREE.MeshStandardMaterial({ color: 0xffc400, metalness: 0.9, roughness: 0.25, emissive: new THREE.Color(0xffa000), emissiveIntensity: 0.6, side: THREE.DoubleSide }));
      em.position.set(0, 0.05, L.armor !== undefined ? 0.165 : 0.14); em.rotation.x = -0.25;
      pv.add(em);
    }
    if (L.armor !== undefined && !L.body) armour(L.armor);
    // Cape: cloth hanging from the shoulders, streaming back with speed.
    if (L.cape !== undefined && bodyBones.Neck) {
      const SEG_X = 6, SEG_Y = 10, geo = new THREE.PlaneGeometry(1, 1, SEG_X, SEG_Y);
      const mats = [M(L.cape, { r: 0.7, m: 0 }), M(L.capeLining ?? L.cape, { r: 0.6, m: 0.1 })];
      mats[0].side = THREE.BackSide; mats[1].side = THREE.FrontSide; // outside in the cape colour, lining inside
      const cape = new THREE.Group(), front = new THREE.Mesh(geo, mats[0]), back = new THREE.Mesh(geo, mats[1]);
      front.castShadow = true; cape.add(front, back);
      scene.add(cape);
      const pos = geo.getAttribute("position") as THREE.BufferAttribute, base = Float32Array.from(pos.array as Float32Array);
      const neck = bodyBones.Neck, anchor = new THREE.Vector3(), down = new THREE.Vector3(), side = new THREE.Vector3(), nrm = new THREE.Vector3();
      let t = 0;
      capeUpdate = (dt: number, mps: number) => {
        t += dt;
        neck.getWorldPosition(anchor); scene.worldToLocal(anchor);
        anchor.z -= 0.09; anchor.y -= 0.03; // just behind the shoulders
        // Streams back from near vertical (standing) to almost flat at speed. Back is -Z (the model faces +Z).
        const a = 0.25 + Math.min(1, mps / 11) * 1.05;
        down.set(0, -Math.cos(a), -Math.sin(a)); side.set(1, 0, 0); nrm.crossVectors(side, down).normalize();
        const flap = Math.min(1, mps / 6) * 0.07;
        for (let i = 0; i < pos.count; i++) {
          const u = base[i * 3], v = 0.5 - base[i * 3 + 1]; // u -0.5..0.5 across, v 0 (top) .. 1 (hem)
          // Over a full suit the cape is narrower and shorter, so the suit still shows from behind.
          const heavy = L.armor !== undefined && !L.body, w = L.body ? 0.3 + 0.26 * v : heavy ? 0.42 + 0.42 * v : 0.36 + 0.32 * v, len = L.body ? 0.95 : heavy ? 1.3 : 1.05;
          const ripple = (Math.sin(t * 9 - v * 5 + u * 2) * flap * v + Math.sin(t * 4.3 + u * 6) * 0.015 * v) * (heavy ? 0.7 : 1);
          const sag = v * v * 0.12 * (1 - Math.min(1, mps / 11));
          pos.setXYZ(i, anchor.x + u * w, anchor.y + down.y * v * len - sag + nrm.y * ripple, anchor.z + down.z * v * len + nrm.z * ripple);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
      };
    }
    // Hero / villain bike parts, on the bike (model space: +Z is forward, wheels at z ±0.6, hubs at y 0.345).
    const bm = M(L.bikeColor, { m: 0.8, r: 0.25 }), accent = M(L.eyes ?? 0xffc400, { m: 0.6, r: 0.3, e: 0.8, ec: L.eyes ?? 0xffa000 });
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), bm);
    nose.scale.set(0.55, 0.42, 1.35); nose.position.set(0, 0.8, 0.66); nose.castShadow = true; scene.add(nose);
    // Swept tail fin over the back wheel, with a glowing edge.
    const finShape = new THREE.Shape(); finShape.moveTo(0, 0); finShape.lineTo(-0.5, 0); finShape.quadraticCurveTo(-0.46, 0.2, -0.62, 0.38); finShape.quadraticCurveTo(-0.2, 0.18, 0, 0);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.025, bevelEnabled: false }).translate(0, 0, -0.0125).rotateY(-Math.PI / 2);
    const fin = new THREE.Mesh(finGeo, bm); fin.position.set(0, 0.74, -0.3); fin.castShadow = true; scene.add(fin);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.42), accent); edge.position.set(0, 0.95, -0.72); edge.rotation.x = 0.62; scene.add(edge);
    // Disc wheels with a glowing ring.
    for (const w of wheels) {
      for (const sd of [-1, 1]) { const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 28), bm); disc.position.x = sd * 0.03; disc.rotation.y = sd * Math.PI / 2; w.add(disc); }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.012, 6, 36), glow(L.eyes ?? 0xffc400, 0.85)); ring.rotation.y = Math.PI / 2; w.add(ring);
    }
    // Lights: headlight (with a beam for the hero), tail light, and jet glow that grows with speed.
    const head = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), glow(0xfff2c0, 1)); head.position.set(0, 0.8, 0.935); scene.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), glow(0xff2030, 1)); tail.position.set(0, 0.86, -0.86); scene.add(tail);
    if (L.light) {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1.6, 9, 24, 1, true), glow(0xfff2c0, 0.07));
      beam.rotation.x = -Math.PI / 2; beam.position.set(0, 0.45, 5.4); scene.add(beam);
      const spot = new THREE.SpotLight(0xfff2c0, 60, 40, 0.45, 0.5, 1.4);
      spot.position.set(0, 0.85, 0.9); spot.target.position.set(0, 0, 12); scene.add(spot, spot.target);
    }
    const jets: THREE.Mesh[] = [];
    for (const sd of [-1, 1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.22, 12), bm); pipe.rotation.x = Math.PI / 2; pipe.position.set(sd * 0.09, 0.62, -0.78); scene.add(pipe);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.4, 12, 1, true), glow(L.bike === "hero" ? 0x58c8ff : 0xff6a20, 0.8));
      flame.rotation.x = -Math.PI / 2; flame.position.set(sd * 0.09, 0.62, -1.0); scene.add(flame); jets.push(flame);
    }
    jetUpdate = (mps: number) => { const k = Math.min(1, mps / 12); for (const j of jets) { j.scale.set(0.6 + k * 0.6, 0.3 + k * (1.4 + Math.random() * 0.3), 0.6 + k * 0.6); j.position.z = -0.9 - j.scale.y * 0.2; } };
  }
  /**
   * Wear a rigged character: hide the cyclist's body (its skeleton keeps pedalling) and, every frame, turn each of the
   * character's bones to point the same way as the cyclist's, with the hips placed and turned to match.
   */
  function wear(suit: THREE.Object3D) {
    const sb: Record<string, THREE.Bone> = {};
    suit.traverse((o) => {
      if ((o as THREE.Bone).isBone) sb[o.name.replace(/^mixamorig:?/, "").replace(/_\d+$/, "")] = o as THREE.Bone;
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; if (/Cap/i.test(m.name)) m.visible = false; }
      if (m.isMesh && /Glass/i.test(m.name)) m.material = new THREE.MeshBasicMaterial({ color: 0xffb020, toneMapped: false });
    });
    const need = ["Hips", "Spine", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "LeftArm", "LeftForeArm", "LeftHand"];
    if (need.some((n) => !sb[n] || !bodyBones[n])) return;
    for (const m of skinned) m.visible = false;
    helmet.visible = false;
    const wrap = new THREE.Group();
    wrap.add(suit);
    scene.add(wrap);
    // Same leg length as the cyclist.
    const w = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
    scene.updateMatrixWorld(true);
    const legC = w(bodyBones.LeftUpLeg).distanceTo(w(bodyBones.LeftLeg)) + w(bodyBones.LeftLeg).distanceTo(w(bodyBones.LeftFoot));
    const legS = w(sb.LeftUpLeg).distanceTo(w(sb.LeftLeg)) + w(sb.LeftLeg).distanceTo(w(sb.LeftFoot));
    wrap.scale.multiplyScalar(legC / legS);
    scene.updateMatrixWorld(true);
    const rest = new Map<THREE.Bone, THREE.Quaternion>();
    Object.values(sb).forEach((b) => rest.set(b, b.quaternion.clone()));
    // Bone -> the child that gives its direction.
    // (Neck and head keep the suit's own pose: its helmet sits on the collar as modelled.)
    const chain: Array<[string, string]> = [["Spine", "Spine1"], ["Spine1", "Spine2"]];
    for (const sd of ["Left", "Right"]) chain.push([sd + "Shoulder", sd + "Arm"], [sd + "Arm", sd + "ForeArm"], [sd + "ForeArm", sd + "Hand"], [sd + "Hand", sd + "HandMiddle1"], [sd + "UpLeg", sd + "Leg"], [sd + "Leg", sd + "Foot"], [sd + "Foot", sd + "ToeBase"]);
    const usable = chain.filter(([a, b]) => sb[a] && sb[b] && bodyBones[a] && bodyBones[b]);
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), dc = new THREE.Vector3(), ds = new THREE.Vector3();
    const q = new THREE.Quaternion(), qw = new THREE.Quaternion(), qp = new THREE.Quaternion(), m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4();
    const frame = (hips: THREE.Object3D, spine: THREE.Object3D, l: THREE.Object3D, r: THREE.Object3D, out: THREE.Matrix4) => {
      const up = w(spine).sub(w(hips)).normalize(), side = w(r).sub(w(l));
      const fwd = new THREE.Vector3().crossVectors(side, up).normalize(), x = new THREE.Vector3().crossVectors(up, fwd).normalize();
      return out.makeBasis(x, up, fwd);
    };
    followers.push(() => {
      for (const [b, rq] of rest) b.quaternion.copy(rq);
      wrap.updateMatrixWorld(true);
      // Hips: same place, same turn (from the hips->spine and left->right leg directions).
      const H = sb.Hips;
      const target = w(bodyBones.Hips);
      frame(bodyBones.Hips, bodyBones.Spine, bodyBones.LeftUpLeg, bodyBones.RightUpLeg, m1);
      frame(H, sb.Spine, sb.LeftUpLeg, sb.RightUpLeg, m2);
      q.setFromRotationMatrix(m1).multiply(qp.setFromRotationMatrix(m2).invert());
      H.getWorldQuaternion(qw).premultiply(q);
      H.parent!.getWorldQuaternion(qp);
      H.quaternion.copy(qp.invert().multiply(qw));
      H.parent!.worldToLocal(H.position.copy(target));
      H.updateMatrixWorld(true);
      // Every other bone: swing to point where the cyclist's does.
      for (const [a, b] of usable) {
        const A = sb[a], B2 = sb[b];
        A.getWorldPosition(pa); B2.getWorldPosition(pb); ds.subVectors(pb, pa).normalize();
        bodyBones[a].getWorldPosition(pa); bodyBones[b].getWorldPosition(pb); dc.subVectors(pb, pa).normalize();
        q.setFromUnitVectors(ds, dc);
        A.getWorldQuaternion(qw).premultiply(q);
        A.parent!.getWorldQuaternion(qp);
        A.quaternion.copy(qp.invert().multiply(qw));
        A.updateMatrixWorld(true);
      }
      // Hands on the grips: two-bone IK from each shoulder to where the cyclist's hand is, elbows out and down.
      const right = w(bodyBones.RightUpLeg).sub(w(bodyBones.LeftUpLeg)).normalize(), down = new THREE.Vector3(0, -1, 0);
      for (const sd of ["Left", "Right"]) {
        const A = sb[sd + "Arm"], F = sb[sd + "ForeArm"], Hd = sb[sd + "Hand"], tgtB = bodyBones[sd + "Hand"];
        if (!A || !F || !Hd || !tgtB) continue;
        const S = w(A), K = w(F), Hp = w(Hd), T = w(tgtB);
        const L1 = S.distanceTo(K), L2 = K.distanceTo(Hp), dir = T.clone().sub(S), d = THREE.MathUtils.clamp(dir.length(), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
        dir.normalize();
        const a = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
        const pole = right.clone().multiplyScalar(sd === "Left" ? -1 : 1).add(down).normalize();
        pole.addScaledVector(dir, -pole.dot(dir)).normalize();
        const elbow = S.clone().addScaledVector(dir, L1 * Math.cos(a)).addScaledVector(pole, L1 * Math.sin(a));
        aim(A, K.sub(S), elbow.clone().sub(S));
        const K2 = w(F), H2 = w(Hd);
        aim(F, H2.sub(K2), T.sub(K2));
      }
    });
  }

  /** Armour plates that move with the body: chest, shoulders, forearms, shins, belt. */
  function armour(col: number) {
    const B = bodyBones;
    const plate = new THREE.MeshStandardMaterial({ color: col, metalness: 0.75, roughness: 0.3 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9a514, metalness: 0.95, roughness: 0.25, emissive: new THREE.Color(0x5a3a00), emissiveIntensity: 0.4 });
    const add = (pv: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.x = rx; m.castShadow = true; pv.add(m); return m;
    };
    if (B.Spine2) {
      const chest = follow(B.Spine2);
      // A broad, flat chest plate with a centre ridge (a shallow shell, not a dome).
      add(chest, new THREE.SphereGeometry(0.15, 20, 14, 0, TAU, 0, Math.PI * 0.5), plate, 0, 0.0, 0.035, 1.22, 0.62, 1.0, Math.PI / 2 - 0.1); // dome axis forward, squashed along it
      add(chest, new THREE.BoxGeometry(0.012, 0.13, 0.02), plate, 0, 0.0, 0.122);
      add(chest, new THREE.BoxGeometry(0.2, 0.012, 0.02), gold, 0, -0.035, 0.135); // gold rib across the plate
    }
    if (B.Spine) {
      const abs = follow(B.Spine);
      for (let k = 0; k < 3; k++) add(abs, new THREE.BoxGeometry(0.15 - k * 0.012, 0.035, 0.03), plate, 0, 0.1 - k * 0.045, 0.115 - k * 0.004);
    }
    if (B.Hips) {
      const hips = follow(B.Hips);
      add(hips, new THREE.TorusGeometry(0.12, 0.016, 8, 28), gold, 0, 0.07, 0.01, 1.0, 1.0, 1.0, Math.PI / 2).scale.set(1.1, 0.82, 1);
      add(hips, new THREE.BoxGeometry(0.05, 0.045, 0.02), gold, 0, 0.07, 0.108);
      for (const sd of [-1, 1]) add(hips, new THREE.BoxGeometry(0.035, 0.04, 0.025), plate, sd * 0.085, 0.065, 0.085);
    }
    for (const side of ["Left", "Right"]) {
      const arm = B[side + "Arm"], fore = B[side + "ForeArm"], hand = B[side + "Hand"], leg = B[side + "Leg"], foot = B[side + "Foot"];
      if (arm) { const sh = follow(arm); add(sh, new THREE.SphereGeometry(0.085, 16, 10, 0, TAU, 0, Math.PI / 2), plate, 0, 0.0, 0, 1.15, 0.85, 1.25); }
      if (fore && hand) limb(fore, hand, new THREE.CylinderGeometry(0.048, 0.04, 1, 12), plate, 0.62, 0.62);
      if (fore && hand) limb(fore, hand, new THREE.CylinderGeometry(0.05, 0.05, 1, 12), gold, 0.92, 0.06);
      if (leg && foot) limb(leg, foot, new THREE.CylinderGeometry(0.058, 0.066, 1, 12), plate, 0.62, 0.62);
    }
  }
  /** A piece along a limb, from bone a to bone b: centred at t (0..1) and `len` of the limb long. */
  function limb(a: THREE.Object3D, b: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, t: number, len: number) {
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; scene.add(m);
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), d = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    followers.push(() => {
      a.getWorldPosition(pa); scene.worldToLocal(pa); b.getWorldPosition(pb); scene.worldToLocal(pb);
      d.subVectors(pb, pa); const L = d.length();
      m.position.copy(pa).addScaledVector(d, t);
      m.quaternion.setFromUnitVectors(Y, d.normalize());
      m.scale.set(1, L * len, 1);
    });
  }
  /** A group that follows a bone (position and turn since the rest pose), for things worn on the body. */
  function follow(bone: THREE.Object3D) {
    const pv = new THREE.Group();
    scene.add(pv);
    const bind = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(scene.getWorldQuaternion(new THREE.Quaternion()).invert()).invert();
    followers.push(() => {
      bone.updateMatrixWorld(true);
      bone.getWorldPosition(pv.position); scene.worldToLocal(pv.position);
      bone.getWorldQuaternion(pv.quaternion).premultiply(scene.getWorldQuaternion(_q1).invert()).multiply(bind);
    });
    return pv;
  }
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
    followers.forEach((f) => f());
    capeUpdate?.(dt, mps);
    jetUpdate?.(mps);
  }
  return { g, update };
}
