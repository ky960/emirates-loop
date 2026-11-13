import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Realistic 3D models (Sketchfab, CC BY 4.0; credits in the README and the About panel),
 * compressed for the tablet into /models. The scene starts with the built-in procedural
 * shapes and swaps these in once they have loaded, so a slow or failed load never blocks a ride.
 */

/** One piece of a model, baked into model space (metres, ground at y = 0, facing -Z). */
export interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; paint?: boolean; shadow?: boolean }
export interface Models { palm?: Part[]; palmHeight: number; cars: Part[][]; cyclist?: GLTF }

const FILES = { palm: "date_palm.glb", camry: "camry.glb", patrol: "patrol.glb", cyclist: "cyclist.glb" };

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

function tuneStd(mat: THREE.Material, f: (m: THREE.MeshStandardMaterial) => void) {
  if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) f(mat as THREE.MeshStandardMaterial);
}

export async function loadModels(base: string): Promise<Models> {
  const L = new GLTFLoader();
  L.setMeshoptDecoder(MeshoptDecoder);
  const get = (f: string) => L.loadAsync(base + "models/" + f).catch((e) => { console.warn("model failed to load", f, e); return null; });
  const [palm, camry, patrol, cyclist] = await Promise.all([get(FILES.palm), get(FILES.camry), get(FILES.patrol), get(FILES.cyclist)]);
  const out: Models = { palmHeight: 7.34, cars: [] };

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
