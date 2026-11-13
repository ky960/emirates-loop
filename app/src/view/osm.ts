import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { lat2tileY, lon2tileX, type LngLat } from "../geo";

/** Real map features near the rider, decoded from OpenFreeMap vector tiles (z14). */
export interface OsmData {
  b: Array<{ rings: LngLat[][]; h: number; mh: number }>;
  w: LngLat[][][];
  g: Array<{ c: number; rings: LngLat[][] }>;
  u: Array<{ c: number; rings: LngLat[][] }>;
  r: Array<{ w: number; line: LngLat[]; cls: string }>;
}

const ROAD_W: Record<string, number> = { motorway: 15, trunk: 13, primary: 11, secondary: 9, tertiary: 8, minor: 6.5, service: 4.5 };
const GREEN: Record<string, number> = { grass: 0x86a85e, park: 0x7fa65a, wood: 0x5e8a45, farmland: 0x9db46a, wetland: 0x7f9e6a, golf: 0x8db862 };
const LANDUSE: Record<string, number> = {
  residential: 0xdcd2c2, commercial: 0xd9cfc4, retail: 0xd9cfc4, industrial: 0xcdc8bf, school: 0xd9d0bc,
  hospital: 0xdccfc6, stadium: 0xcfc9b6, cemetery: 0xc9c2a6, university: 0xd9d0bc,
};

const empty = (): OsmData => ({ b: [], w: [], g: [], u: [], r: [] });

export class OsmTiles {
  /** z14 for detail near the road; z13 covers a wider area for the distant skyline. */
  constructor(private Z = 14) {}
  private tmpl: string | null = null;
  private failed = false;
  private cache = new Map<string, OsmData>();
  private inflight = new Map<string, Promise<OsmData>>();
  enabled = true;

  private async template(): Promise<string | null> {
    if (this.tmpl || this.failed) return this.tmpl;
    try {
      const tj = await (await fetch("https://tiles.openfreemap.org/planet")).json();
      this.tmpl = tj.tiles[0];
    } catch {
      this.failed = true;
    }
    return this.tmpl;
  }

  /** Tile keys covering a set of route points (with a margin of ~800 m). */
  keysFor(pts: LngLat[], margin = 0.0075): string[] {
    let a = 180, b = -180, c = 90, d = -90;
    for (const p of pts) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); }
    a -= margin; b += margin; c -= margin * 0.9; d += margin * 0.9;
    const Z = this.Z, keys: string[] = [];
    for (let x = Math.floor(lon2tileX(a, Z)); x <= Math.floor(lon2tileX(b, Z)); x++)
      for (let y = Math.floor(lat2tileY(d, Z)); y <= Math.floor(lat2tileY(c, Z)); y++) keys.push(x + "/" + y);
    return keys;
  }

  /** Cached data for the keys: complete, partial or none yet. */
  get(keys: string[]): { state: "complete" | "partial" | "pending" | "none"; data: OsmData | null } {
    if (!this.enabled || this.failed) return { state: "none", data: null };
    const have = keys.filter((k) => this.cache.has(k));
    if (!have.length) return { state: "pending", data: null };
    const data = empty();
    for (const k of have) {
      const t = this.cache.get(k)!;
      data.b.push(...t.b); data.w.push(...t.w); data.g.push(...t.g); data.u.push(...t.u); data.r.push(...t.r);
    }
    return { state: have.length === keys.length ? "complete" : "partial", data };
  }

  /** Fetch missing tiles; resolves when all are in. */
  async fetch(keys: string[]): Promise<void> {
    if (!this.enabled) return;
    await Promise.all(keys.filter((k) => !this.cache.has(k)).map((k) => this.fetchTile(k)));
  }

  private fetchTile(key: string): Promise<OsmData> {
    const c = this.cache.get(key);
    if (c) return Promise.resolve(c);
    const f = this.inflight.get(key);
    if (f) return f;
    const p = (async () => {
      const tmpl = await this.template();
      let data = empty();
      if (tmpl) {
        const [x, y] = key.split("/").map(Number);
        try {
          const res = await fetch(tmpl.replace("{z}", String(this.Z)).replace("{x}", String(x)).replace("{y}", String(y)));
          if (res.ok) data = decodeTile(await res.arrayBuffer(), x, y, this.Z);
        } catch { /* offline: keep empty */ }
      }
      this.cache.set(key, data);
      this.inflight.delete(key);
      if (this.cache.size > 160) this.cache.delete(this.cache.keys().next().value!);
      return data;
    })();
    this.inflight.set(key, p);
    return p;
  }
}

function polysOf(g: GeoJSON.Geometry): LngLat[][][] {
  if (g.type === "Polygon") return [g.coordinates as LngLat[][]];
  if (g.type === "MultiPolygon") return g.coordinates as LngLat[][][];
  return [];
}
function linesOf(g: GeoJSON.Geometry): LngLat[][] {
  if (g.type === "LineString") return [g.coordinates as LngLat[]];
  if (g.type === "MultiLineString") return g.coordinates as LngLat[][];
  return [];
}

function decodeTile(buf: ArrayBuffer, x: number, y: number, Z: number): OsmData {
  const t = new VectorTile(new Pbf(new Uint8Array(buf))), out = empty();
  const each = (name: string, fn: (p: Record<string, unknown>, g: GeoJSON.Geometry) => void) => {
    const L = t.layers[name];
    if (!L) return;
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i);
      try { fn(f.properties as Record<string, unknown>, f.toGeoJSON(x, y, Z).geometry as GeoJSON.Geometry); } catch { /* bad feature */ }
    }
  };
  each("building", (p, g) => {
    if (p.hide_3d) return;
    for (const poly of polysOf(g)) out.b.push({ rings: poly, h: +(p.render_height as number) || 6, mh: +(p.render_min_height as number) || 0 });
  });
  each("water", (_p, g) => { for (const poly of polysOf(g)) out.w.push(poly); });
  each("landcover", (p, g) => { const c = GREEN[p.class as string]; if (!c) return; for (const poly of polysOf(g)) out.g.push({ c, rings: poly }); });
  each("park", (_p, g) => { for (const poly of polysOf(g)) out.g.push({ c: GREEN.park, rings: poly }); });
  each("landuse", (p, g) => { const c = LANDUSE[p.class as string]; if (!c) return; for (const poly of polysOf(g)) out.u.push({ c, rings: poly }); });
  each("transportation", (p, g) => {
    const w = ROAD_W[p.class as string];
    if (!w || p.brunnel === "tunnel") return;
    for (const line of linesOf(g)) out.r.push({ w, line, cls: p.class as string });
  });
  return out;
}
