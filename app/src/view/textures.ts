import * as THREE from "three";
import { rng } from "../util";

/** Procedural canvas textures for the road scene (no image files to download). */

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, opts: { srgb?: boolean; repeat?: boolean; mips?: boolean } = {}) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** One date-palm frond seen from above: a midrib with leaflets on both sides, on transparent background. */
export function frondTexture() {
  return canvasTex(128, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const r = rng(9);
    const mid = w / 2;
    for (let y = h * 0.04; y < h * 0.97; y += 5) {
      const t = y / h, len = (w * 0.47) * Math.sin(Math.min(1, t * 1.15) * Math.PI) ** 0.7 * (0.85 + r() * 0.25);
      for (const s of [-1, 1]) {
        const g = 70 + r() * 40 | 0;
        c.strokeStyle = `rgb(${g - 30 + (r() * 12 | 0)},${g + 50},${g - 35})`;
        c.lineWidth = 2.2 + r() * 1.2;
        c.beginPath();
        c.moveTo(mid, y);
        c.quadraticCurveTo(mid + s * len * 0.5, y - 6, mid + s * len, y - 14 - r() * 6);
        c.stroke();
      }
    }
    c.strokeStyle = "#7d8a45"; c.lineWidth = 4;
    c.beginPath(); c.moveTo(mid, 0); c.lineTo(mid, h); c.stroke();
  }, { repeat: false });
}

export function barkTexture() {
  return canvasTex(64, 256, (c, w, h) => {
    c.fillStyle = "#7a5f43"; c.fillRect(0, 0, w, h);
    const r = rng(4);
    // Diamond leaf-base pattern of a date palm trunk
    for (let y = 0; y < h; y += 16) {
      for (let x = (y / 16) % 2 ? 0 : 8; x < w + 16; x += 16) {
        const v = 95 + r() * 40 | 0;
        c.fillStyle = `rgb(${v + 20},${v},${v - 25})`;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 8, y + 8); c.lineTo(x, y + 16); c.lineTo(x - 8, y + 8); c.closePath(); c.fill();
        c.strokeStyle = "rgba(40,28,18,.55)"; c.lineWidth = 1.5; c.stroke();
      }
    }
  });
}

export type FacadeStyle = "glass" | "office" | "residential" | "villa";

/**
 * Facade atlases: 8 window bays × 8 floors per texture. Bays are ~3 m wide and floors 3.4 m,
 * so windows come out at real-world size. Emissive map lights a few windows.
 */
export function facadeTextures(style: FacadeStyle): { map: THREE.Texture; emissive: THREE.Texture } {
  const W = 256, H = 256, bw = W / 8, fh = H / 8;
  const r = rng(style.length * 131);
  const lit: Array<[number, number, number, number]> = [];
  const map = canvasTex(W, H, (c) => {
    if (style === "glass") {
      for (let f = 0; f < 8; f++) for (let b = 0; b < 8; b++) {
        const g = c.createLinearGradient(0, f * fh, 0, (f + 1) * fh);
        const t = 150 + r() * 30;
        g.addColorStop(0, `rgb(${t * 0.55 | 0},${t * 0.78 | 0},${t * 0.92 | 0})`);
        g.addColorStop(1, `rgb(${t * 0.4 | 0},${t * 0.6 | 0},${t * 0.75 | 0})`);
        c.fillStyle = g; c.fillRect(b * bw, f * fh, bw, fh);
      }
      c.fillStyle = "rgba(210,220,226,.85)";
      for (let b = 0; b <= 8; b++) c.fillRect(b * bw - 1, 0, 2, H);
      c.fillStyle = "rgba(190,200,206,.9)";
      for (let f = 0; f <= 8; f++) c.fillRect(0, f * fh - 2, W, 4);
    } else if (style === "office") {
      c.fillStyle = "#d9d3c8"; c.fillRect(0, 0, W, H);
      for (let f = 0; f < 8; f++) {
        const y = f * fh + fh * 0.28;
        const g = c.createLinearGradient(0, y, 0, y + fh * 0.52);
        g.addColorStop(0, "#5f7d93"); g.addColorStop(1, "#3c556a");
        c.fillStyle = g; c.fillRect(0, y, W, fh * 0.52);
        c.fillStyle = "rgba(230,226,218,.9)";
        for (let b = 0; b < 8; b++) c.fillRect(b * bw + bw - 3, y, 3, fh * 0.52);
        c.fillStyle = "rgba(0,0,0,.08)"; c.fillRect(0, f * fh + fh - 3, W, 3);
      }
    } else {
      const wall = style === "villa" ? ["#efe3cc", "#e8dcc4"] : ["#e6d6bb", "#ddd0b8"];
      c.fillStyle = wall[0]; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(120,95,60,${r() * 0.05})`; c.fillRect(r() * W, r() * H, 2, 2); }
      for (let f = 0; f < 8; f++) for (let b = 0; b < 8; b++) {
        if (style === "villa" && r() < 0.45) continue;
        const x = b * bw + bw * 0.22, y = f * fh + fh * 0.22, ww = bw * 0.56, wh = fh * 0.5;
        c.fillStyle = "rgba(120,100,70,.25)"; c.fillRect(x - 2, y - 2, ww + 4, wh + 5);
        const g = c.createLinearGradient(x, y, x, y + wh);
        g.addColorStop(0, "#6f8798"); g.addColorStop(1, "#43586a");
        c.fillStyle = g; c.fillRect(x, y, ww, wh);
        if (r() < 0.3) { c.fillStyle = "rgba(240,236,226,.85)"; c.fillRect(x, y, ww, wh * (0.3 + r() * 0.6)); } // blinds
        if (style === "residential" && r() < 0.25) { c.fillStyle = "#cfc9be"; c.fillRect(x + ww * 0.15, y + wh + 2, ww * 0.6, 5); } // AC unit
        if (style === "residential" && b % 4 === 1) { c.fillStyle = "rgba(90,80,65,.35)"; c.fillRect(b * bw + 2, y + wh + 6, bw * 1.6, 3); } // balcony rail
        if (r() < 0.12) lit.push([x, y, ww, wh]);
      }
      c.fillStyle = wall[1];
      for (let f = 0; f < 8; f++) c.fillRect(0, f * fh, W, 2);
    }
    if (style === "glass" || style === "office") for (let i = 0; i < 6; i++) lit.push([(r() * 8 | 0) * bw + 3, (r() * 8 | 0) * fh + 4, bw - 6, fh - 8]);
  });
  const emissive = canvasTex(W, H, (c) => {
    c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(255,214,150,.9)";
    for (const [x, y, w, h] of lit) c.fillRect(x, y, w, h);
  });
  return { map, emissive };
}

export function wBeamTexture() {
  return canvasTex(16, 64, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#9aa2a8"); g.addColorStop(0.25, "#e4e8ea"); g.addColorStop(0.5, "#8c949a"); g.addColorStop(0.75, "#e0e4e6"); g.addColorStop(1, "#8a9298");
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
}

export function pavingTexture() {
  return canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = "#cbbfae"; c.fillRect(0, 0, w, h);
    const r = rng(3);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < w; x += 32) {
      const v = 190 + r() * 25 | 0;
      c.fillStyle = `rgb(${v},${v - 10},${v - 26})`; c.fillRect(x + 1, y + 1, 30, 14);
    }
  });
}

export function kerbTexture() {
  // Black-and-white painted kerb, common on UAE roads
  return canvasTex(8, 64, (c, w, h) => {
    c.fillStyle = "#f2f0ea"; c.fillRect(0, 0, w, h / 2);
    c.fillStyle = "#25262a"; c.fillRect(0, h / 2, w, h / 2);
  });
}

/** Soft elliptical contact shadow (white on transparent; tinted by the material colour). */
export function blobTexture() {
  return canvasTex(64, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.save();
    c.scale(1, h / w);
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, w, w);
    c.restore();
  }, { repeat: false, srgb: false });
}

/**
 * Tileable mottling for the terrain: grey around 0.9 multiplied over the vertex colours, so grass,
 * sand and rock get patchy light/dark variation and small specks instead of one flat colour.
 */
export function groundDetailTexture() {
  const N = 256;
  return canvasTex(N, N, (c) => {
    const img = c.createImageData(N, N), r = rng(17);
    // Value noise at a few octaves, wrapped so the tile repeats seamlessly.
    const grid = (g: number) => { const a = new Float32Array(g * g); for (let i = 0; i < a.length; i++) a[i] = r(); return a; };
    const oct = [[4, 0.45], [8, 0.3], [32, 0.15], [128, 0.1]].map(([g, a]) => ({ g, a, v: grid(g) }));
    const sm = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0;
      for (const o of oct) {
        const fx = (x / N) * o.g, fy = (y / N) * o.g, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
        const at = (i: number, j: number) => o.v[((j + o.g) % o.g) * o.g + ((i + o.g) % o.g)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx, b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        v += (a + (b - a) * ty) * o.a;
      }
      const g = Math.round(255 * (0.78 + 0.26 * v)), i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, g); img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }, { srgb: false });
}
