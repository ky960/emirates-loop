import { D2R } from "./util";

export type LngLat = [number, number];

const R = 6371000;

/** Great-circle distance in metres. */
export function hav(a: LngLat, b: LngLat): number {
  const la1 = a[1] * D2R, la2 = b[1] * D2R, dla = la2 - la1, dlo = (b[0] - a[0]) * D2R;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees (0 = north). */
export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin((b[0] - a[0]) * D2R) * Math.cos(b[1] * D2R);
  const x = Math.cos(a[1] * D2R) * Math.sin(b[1] * D2R) - Math.sin(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.cos((b[0] - a[0]) * D2R);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

/** Chaikin corner cutting. */
export function chaikin(p: LngLat[], n = 3): LngLat[] {
  for (let k = 0; k < n; k++) {
    const o: LngLat[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    o.push(p[p.length - 1]);
    p = o;
  }
  return p;
}

/** Insert points so that no segment is longer than `step` metres. */
export function densify(p: LngLat[], step = 40): LngLat[] {
  const o: LngLat[] = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], n = Math.max(1, Math.ceil(hav(a, b) / step));
    for (let k = 1; k <= n; k++) o.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return o;
}

/** Remove consecutive duplicate points. */
export function dedupe(p: LngLat[]): LngLat[] {
  return p.filter((q, i) => i === 0 || q[0] !== p[i - 1][0] || q[1] !== p[i - 1][1]);
}

/** Decode a Google/OSRM encoded polyline (precision 5 or 6) into [lng, lat] pairs. */
export function decodePolyline(str: string, precision = 6): LngLat[] {
  const f = Math.pow(10, precision), out: LngLat[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    let b: number, s = 0, r = 0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32);
    lat += r & 1 ? ~(r >> 1) : r >> 1;
    s = 0; r = 0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32);
    lng += r & 1 ? ~(r >> 1) : r >> 1;
    out.push([lng / f, lat / f]);
  }
  return out;
}

/** Encode [lng, lat] pairs as a polyline (inverse of decodePolyline). */
export function encodePolyline(pts: LngLat[], precision = 6): string {
  const f = Math.pow(10, precision);
  let out = "", plat = 0, plng = 0;
  const enc = (v: number) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of pts) {
    const la = Math.round(lat * f), ln = Math.round(lng * f);
    out += enc(la - plat) + enc(ln - plng);
    plat = la; plng = ln;
  }
  return out;
}

// ---- slippy-map tile math ----
export const lon2tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const lat2tileY = (lat: number, z: number) => {
  const r = lat * D2R;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/** Ground resolution (metres per CSS pixel) for a 512-px-tile web-mercator map at a zoom level. */
export const metersPerPixel = (lat: number, zoom: number) => (156543.03 * Math.cos(lat * D2R)) / Math.pow(2, zoom);
