import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeWalkers, type Walker } from "./people";

/**
 * Realistic 3D models (Sketchfab, CC BY 4.0; credits in the README and the About panel),
 * compressed for the tablet into /models. The scene starts with the built-in procedural
 * shapes and swaps these in once they have loaded, so a slow or failed load never blocks a ride.
 */

/** One piece of a model, baked into model space (metres, ground at y = 0, facing -Z). */
export interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; paint?: boolean; shadow?: boolean }
export interface Models { palm?: Part[]; palmHeight: number; cars: Part[][]; cyclist?: GLTF; walkers: Walker[]; dhow?: Part[]; camel?: Part[] }

const FILES = { palm: "date_palm.glb", camry: "camry.glb", patrol: "patrol.glb", cyclist: "cyclist.glb", dhow: "dhow.glb", camel: "camel.glb" };
/** Pedestrians (RenderPeople, CC BY 4.0); the first one carries the walk cycle. */
const PEOPLE = ["ped_nathan.glb", "ped_eric.glb", "ped_claudia.glb"];

/** Real overall lengths (m) the car models are scaled to. */
const CAR_LENGTH = { camry: 4.85, patrol: 5.3 };

/**
 * Bake every (non-skinned) mesh into model space with `xf` applied, merging meshes that share a material.
 * Turning by 180° makes the models face -Z like the rest of the scene.
 */
function bake(root: THREE.Object3D, xf: THREE.Matrix4, skip: (m: THREE.Mesh) => boolean = () => false): Part[] {
  root.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || skip(m)) return;
    const g = toFloat(m.geometry);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(xf, m.matrixWorld));
    const mat = m.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g);
  });
  const out: Part[] = [];
  for (const [mat, geos] of byMat) {
    const same = geos.every((x) => !!x.index) || geos.every((x) => !x.index);
    const g = geos.length === 1 ? geos[0] : mergeGeometries(same ? geos : geos.map((x) => (x.index ? x.toNonIndexed() : x)));
    if (g) out.push({ geo: g, mat });
  }
  return out;
}

/**
 * Copy of a geometry with plain float position/normal/uv. The compressed models store these as
 * quantized integers (dequantized by the node transform), which can't be transformed in place.
 */
function toFloat(src: THREE.BufferGeometry) {
  const g = new THREE.BufferGeometry();
  for (const k of ["position", "normal", "uv"]) {
    const a = src.getAttribute(k);
    if (!a) continue;
    const n = a.count, size = a.itemSize, arr = new Float32Array(n * size);
    const get = [a.getX, a.getY, a.getZ, a.getW];
    for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) arr[i * size + c] = get[c].call(a, i);
    g.setAttribute(k, new THREE.BufferAttribute(arr, size));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  return g;
}

/** Scale so the model's longest horizontal side is `len` metres, centre it, put its lowest point at y = 0, and turn it to face -Z. */
function fit(root: THREE.Object3D, len: number) {
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
  const s = len / Math.max(size.x, size.z);
  return new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -bb.min.y, -c.z));
}

/** Like fit, but scaled to a height. */
function fitHeight(root: THREE.Object3D, h: number) {
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
  const s = h / size.y;
  return new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -bb.min.y, -c.z));
}

function tuneStd(mat: THREE.Material, f: (m: THREE.MeshStandardMaterial) => void) {
  if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) f(mat as THREE.MeshStandardMaterial);
}

export async function loadModels(base: string): Promise<Models> {
  const L = new GLTFLoader();
  L.setMeshoptDecoder(MeshoptDecoder);
  const get = (f: string) => L.loadAsync(base + "models/" + f).catch((e) => { console.warn("model failed to load", f, e); return null; });
  const [palm, camry, patrol, cyclist, dhow, camel, ...people] = await Promise.all([get(FILES.palm), get(FILES.camry), get(FILES.patrol), get(FILES.cyclist), get(FILES.dhow), get(FILES.camel), ...PEOPLE.map(get)]);
  const out: Models = { palmHeight: 7.34, cars: [], walkers: [] };
  // Traditional dhow (~16 m) for the water near the road, and camels (~2.1 m) for the desert.
  if (dhow) { out.dhow = bake(dhow.scene, fit(dhow.scene, 16)); out.dhow.forEach((p) => (p.shadow = true)); }
  if (camel) { out.camel = bake(camel.scene, fitHeight(camel.scene, 2.1)); out.camel.forEach((p) => (p.shadow = true)); }
  try { out.walkers = makeWalkers(people.filter((g): g is GLTF => !!g)); } catch (e) { console.warn("pedestrians unavailable", e); }

  if (palm) {
    palm.scene.updateMatrixWorld(true);
    out.palmHeight = new THREE.Box3().setFromObject(palm.scene).max.y;
    out.palm = bake(palm.scene, new THREE.Matrix4());
    for (const p of out.palm) tuneStd(p.mat, (m) => {
      // Fronds are alpha-masked cards: draw both sides and keep the cut-out crisp.
      if (m.alphaTest > 0 || m.transparent) { m.side = THREE.DoubleSide; m.transparent = false; m.alphaTest = 0.5; }
      m.envMapIntensity = 0.5;
    });
  }

  if (camry) {
    const parts = bake(camry.scene, fit(camry.scene, CAR_LENGTH.camry), (m) => /CAMRY_int/.test(m.name));
    for (const p of parts) {
      const n = p.mat.name;
      tuneStd(p.mat, (m) => {
        m.side = THREE.FrontSide;
        if (n === "CAMRY") { m.color.set(0xffffff); m.metalness = 0.55; m.roughness = 0.28; p.paint = true; }
        if (n === "vidrios") { m.color.set(0x1a222a); m.opacity = 0.85; m.metalness = 0.6; m.roughness = 0.05; }
        m.envMapIntensity = 1;
      });
      p.shadow = n === "CAMRY" || n === "bajo";
    }
    out.cars.push(parts);
  }

  if (patrol) {
    const parts = bake(patrol.scene, fit(patrol.scene, CAR_LENGTH.patrol));
    for (const p of parts) {
      tuneStd(p.mat, (m) => { m.side = THREE.FrontSide; m.envMapIntensity = 1; });
      // "set1" is the body texture (light grey), so an instance colour tints the paint.
      if (p.mat.name === "set1") p.paint = true;
      p.shadow = true;
    }
    out.cars.push(parts);
  }

  if (cyclist) out.cyclist = cyclist;
  return out;
}

// ---------------------------------------------------------------------------------------------
// UAE landmarks at their real positions and sizes (Sketchfab, CC BY 4.0), downloaded only when the ride comes
// near one. Any OpenStreetMap building standing on the same spot is left out so the two don't overlap.

export interface Landmark {
  id: string; name: string; file: string;
  /** Position (lng, lat). */
  at: [number, number];
  /** Scale to this height (m), or this longest horizontal side (m). */
  height?: number; length?: number;
  /** Turn (degrees, clockwise seen from above), or "osm" to line up with the matching OpenStreetMap footprint. */
  turn: number | "osm";
  /** Leave out OpenStreetMap buildings within this radius (m). */
  clear: number;
}

export const LANDMARKS: Landmark[] = [
  { id: "burj_khalifa", name: "Burj Khalifa", file: "lm_burj_khalifa.glb", at: [55.2744, 25.1972], height: 828, turn: 0, clear: 90 },
  { id: "burj_al_arab", name: "Burj Al Arab", file: "lm_burj_al_arab.glb", at: [55.1853, 25.1412], height: 321, turn: -45, clear: 80 },
  { id: "zayed_mosque", name: "Sheikh Zayed Grand Mosque", file: "lm_zayed_mosque.glb", at: [54.4749, 24.4129], length: 420, turn: "osm", clear: 260 },
];

const lmCache = new Map<string, Promise<THREE.Object3D | null>>();

/** Landmark model scaled to real size, centred on its footprint, standing on y = 0, ready to place. */
export function loadLandmark(base: string, lm: Landmark): Promise<THREE.Object3D | null> {
  let p = lmCache.get(lm.id);
  if (!p) {
    const L = new GLTFLoader();
    L.setMeshoptDecoder(MeshoptDecoder);
    p = L.loadAsync(base + "models/" + lm.file).then((g) => {
      const root = g.scene;
      root.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(root), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      const s = lm.height ? lm.height / size.y : (lm.length ?? 100) / Math.max(size.x, size.z);
      const inner = new THREE.Group();
      inner.add(root);
      root.position.set(-c.x, -bb.min.y, -c.z);
      inner.scale.setScalar(s);
      // Seen from kilometres away, so let them show through the haze more than nearby scenery does.
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
          const mm = x.clone();
          mm.onBeforeCompile = (sh) => {
            sh.fragmentShader = sh.fragmentShader.replace("#include <fog_fragment>", `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * 0.15 * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`);
          };
          return mm;
        });
        m.material = Array.isArray(m.material) ? mats : mats[0];
      });
      const out = new THREE.Group();
      out.add(inner);
      out.userData.longSideAlongX = size.x >= size.z;
      return out as THREE.Object3D;
    }).catch((e) => { console.warn("landmark failed to load", lm.file, e); return null; });
    lmCache.set(lm.id, p);
  }
  return p;
}
