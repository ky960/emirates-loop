import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { rng } from "../util";

/**
 * Pedestrians on the city sidewalks: RenderPeople scans (CC BY 4.0) sharing one skeleton. Nathan comes with a
 * walk cycle; it is retargeted onto the others by bone name (rotations only), so every walker can use it.
 */

/** "rp_nathan_animated_003_walking_hip_02" -> "hip_02", so all RenderPeople skeletons share bone names. */
const norm = (name: string) => name.replace(/^rp_[a-z]+_[a-z]+_\d+_[a-z]+_/, "");

export interface Walker { make(): { obj: THREE.Object3D; mixer: THREE.AnimationMixer } }

/** Walk cycle: ~1.4 m/s at normal speed (two steps of ~1.4 m per 2 s cycle). */
export const WALK_SPEED = 1.4;

export function makeWalkers(gltfs: GLTF[]): Walker[] {
  const src = gltfs.find((g) => g.animations.length);
  if (!src) return [];
  const base = src.animations[0].clone();
  base.tracks.forEach((t) => (t.name = norm(t.name)));
  return gltfs.map((g) => {
    const scene = g.scene;
    const names = new Set<string>();
    scene.traverse((o) => {
      o.name = norm(o.name);
      names.add(o.name);
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.envMapIntensity = 0.6;
      }
    });
    // The walk's own skeleton keeps its hip bob; others take rotations only (their proportions differ).
    const own = g === src;
    const clip = new THREE.AnimationClip("walk", base.duration, base.tracks.filter((t) => names.has(t.name.split(".")[0]) && (own || t.name.endsWith(".quaternion"))));
    // Height: scale so the figure is ~1.75 m, standing on y = 0 and facing -Z like the rest of the scene.
    scene.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(scene), h = bb.max.y - bb.min.y || 1;
    const s = 1.75 / h;
    return {
      make() {
        const obj = cloneSkinned(scene);
        const holder = new THREE.Group(), inner = new THREE.Group();
        inner.add(obj);
        inner.scale.setScalar(s);
        inner.position.y = -bb.min.y * s;
        inner.rotation.y = Math.PI;
        holder.add(inner);
        const mixer = new THREE.AnimationMixer(obj);
        const act = mixer.clipAction(clip);
        act.play();
        act.time = Math.random() * clip.duration;
        return { obj: holder, mixer };
      },
    };
  });
}

interface Ped { obj: THREE.Object3D; mixer: THREE.AnimationMixer; m: number; lat: number; dir: 1 | -1; v: number }

/** Sidewalk lanes (m right of the centreline) clear of the palms (6.6 m and -20.6 m) and the bus shelters. */
const LANES = [4.9, 5.8, -19.3, -21.9];

export class Pedestrians {
  group = new THREE.Group();
  private peds: Ped[] = [];
  private ready = false;
  private r = rng(4242);

  constructor(walkers: Walker[], n: number) {
    if (!walkers.length) return;
    for (let i = 0; i < n; i++) {
      const { obj, mixer } = walkers[i % walkers.length].make();
      obj.visible = false;
      this.group.add(obj);
      this.peds.push({ obj, mixer, m: 0, lat: 0, dir: 1, v: WALK_SPEED });
    }
  }

  private spawn(p: Ped, pos: number, initial: boolean) {
    const r = this.r;
    p.lat = LANES[Math.floor(r() * LANES.length)];
    p.dir = r() < 0.5 ? 1 : -1;
    p.v = 1.15 + r() * 0.45;
    p.m = initial ? pos - 30 + r() * 300 : pos + 140 + r() * 160;
    p.mixer.timeScale = p.v / WALK_SPEED;
  }

  /** `sidewalkY`: sidewalk height above the centreline. Hidden outside the city. */
  update(dt: number, pos: number, w: { onPath: (m: number, lat?: number) => { p: THREE.Vector3; t: THREE.Vector3 }; city: boolean; sidewalkY: number }) {
    this.group.visible = w.city;
    if (!w.city || !this.peds.length) { this.ready = false; return; }
    if (!this.ready) { this.peds.forEach((p) => this.spawn(p, pos, true)); this.ready = true; }
    for (const p of this.peds) {
      p.m += p.dir * p.v * dt;
      if (p.m < pos - 50 || p.m > pos + 320) this.spawn(p, pos, false);
      const { p: at, t } = w.onPath(p.m, p.lat);
      p.obj.position.set(at.x, at.y + w.sidewalkY, at.z);
      p.obj.rotation.y = Math.atan2(-t.x * p.dir, -t.z * p.dir);
      p.obj.visible = true;
      p.mixer.update(dt);
    }
  }

  reset() { this.ready = false; }
}
