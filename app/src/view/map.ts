import maplibregl, { type CustomLayerInterface, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as THREE from "three";
import type { LngLat } from "../geo";
import { bearing, metersPerPixel } from "../geo";
import type { Frame } from "../ride/engine";
import type { Route } from "../route";
import { legAt, pointAt, wrapM } from "../route";
import type { Camera, Settings } from "../store/settings";
import { D2R, TAU } from "../util";
import { buildRider, type RiderModel } from "./rider";
import DATA from "../data/uae.json";

const LIVE_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DEM_TILES = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"];

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function pattern(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const d = g.getImageData(0, 0, size, size);
  return { width: size, height: size, data: new Uint8Array(d.data.buffer) };
}

function offlineStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      land: { type: "geojson", data: DATA.land as GeoJSON.FeatureCollection },
      urban: { type: "geojson", data: DATA.urban as GeoJSON.FeatureCollection },
      roads: { type: "geojson", data: DATA.roads as GeoJSON.FeatureCollection },
    },
    layers: [
      { id: "sea", type: "background", paint: { "background-pattern": "sea" } },
      { id: "shallows", type: "line", source: "land", paint: { "line-color": "#5FC2C7", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 26], "line-blur": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 22], "line-opacity": 0.55 } },
      { id: "land-flat", type: "fill", source: "land", paint: { "fill-color": "#E3C08C" } },
      { id: "land", type: "fill", source: "land", minzoom: 10.5, paint: { "fill-pattern": "sand", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10.5, 0, 11.5, 1] } },
      { id: "beach", type: "line", source: "land", paint: { "line-color": "#F6E3BF", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 14, 6] } },
      { id: "urban", type: "fill", source: "urban", paint: { "fill-color": "#C9B69E", "fill-opacity": 0.85 } },
      { id: "roads-case", type: "line", source: "roads", paint: { "line-color": "#9C8466", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.5, 14, 9], "line-opacity": 0.7 } },
      { id: "roads", type: "line", source: "roads", paint: { "line-color": "#FFF6E6", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 14, 6] } },
    ],
  };
}

const RIDER_PX: Record<Camera, number> = { map: 46, stage: 0, loop: 0, road: 0 };

class RiderLayer implements CustomLayerInterface {
  id: string;
  type = "custom" as const;
  renderingMode = "3d" as const;
  m = 0; brg = 0; mps = 0; crank = 0; visible = true; lateral = 0;
  rider!: RiderModel;
  private camera = new THREE.Camera();
  private scene = new THREE.Scene();
  private renderer!: THREE.WebGLRenderer;
  constructor(id: string, private ghost: boolean, private view: MapView) { this.id = id; }
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (!this.ghost) {
      this.scene.add(new THREE.HemisphereLight(0xfff2e0, 0x8a6a4a, 2.2));
      const s = new THREE.DirectionalLight(0xffe2bc, 2.4);
      s.position.set(-1, 1.4, 0.6);
      this.scene.add(s);
    }
    this.rider = buildRider(this.ghost ? new THREE.MeshBasicMaterial({ color: 0x14c8bc, transparent: true, opacity: 0.55, depthWrite: false }) : undefined);
    this.scene.add(this.rider.g);
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: ArrayLike<number>) {
    const px = RIDER_PX[this.view.camMode];
    if (!this.visible || px === 0 || !this.view.route) return;
    const map = this.view.map!;
    const pos = pointAt(this.view.route, this.m).p;
    let elev = 0;
    if (this.view.terrainOn) { try { elev = map.queryTerrainElevation(pos) || 0; } catch { /* ignore */ } }
    const sc = (px * metersPerPixel(pos[1], map.getZoom())) / 1.6;
    const merc = maplibregl.MercatorCoordinate.fromLngLat(pos as [number, number], elev), s = merc.meterInMercatorCoordinateUnits() * sc;
    const l = new THREE.Matrix4().makeTranslation(merc.x, merc.y, merc.z).scale(new THREE.Vector3(s, -s, s))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationY(-this.brg * D2R));
    if (this.lateral) l.multiply(new THREE.Matrix4().makeTranslation(this.lateral, 0, 0));
    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(Array.from(matrix)).multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }
}

export class MapView {
  map: maplibregl.Map | null = null;
  live = false;
  route: Route | null = null;
  camMode: Camera = "road";
  terrainOn = false;
  private rider?: RiderLayer;
  private ghost?: RiderLayer;
  private markers: maplibregl.Marker[] = [];
  private meMarker?: maplibregl.Marker;
  private ghMarker?: maplibregl.Marker;
  private lastJump = 0;
  private lastDone = 0;
  private smoothBrg = 0;
  private ready = false;

  constructor(private el: HTMLElement, private settings: () => Settings) {}

  async init(route: Route): Promise<void> {
    this.route = route;
    this.live = await canReach(LIVE_STYLE, 4000);
    const s = this.settings();
    const startPos = pointAt(route, 0).p;
    const dprCap = s.quality === "battery" ? 1 : s.quality === "balanced" ? 1.5 : 2;
    this.map = new maplibregl.Map({
      container: this.el,
      style: this.live ? LIVE_STYLE : offlineStyle(),
      center: startPos as [number, number],
      zoom: 12.9, pitch: 60, bearing: 30,
      attributionControl: false,
      maxPitch: 75,
      pixelRatio: Math.min(devicePixelRatio || 1, dprCap),
      fadeDuration: 0,
    });
    const map = this.map;
    map.on("styleimagemissing", (e) => {
      if (map.hasImage(e.id)) return;
      if (e.id === "sand") map.addImage("sand", SAND());
      if (e.id === "sea") map.addImage("sea", SEA());
    });
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      map.once("load", finish);
      // Never block the app on slow tiles: continue after 12 s; layers are added when the style is ready.
      setTimeout(finish, 12000);
    });
    const setup = () => {
      this.addRouteLayers();
      this.addTerrain();
      this.placeMarkers();
      this.ghost = new RiderLayer("ghost", true, this);
      this.rider = new RiderLayer("rider", false, this);
      this.ghost.lateral = 1.1;
      map.addLayer(this.ghost);
      map.addLayer(this.rider);
      const meEl = document.createElement("div"); meEl.className = "me-dot";
      const ghEl = document.createElement("div"); ghEl.className = "gh-dot";
      this.meMarker = new maplibregl.Marker({ element: meEl }).setLngLat(startPos as [number, number]).addTo(map);
      this.ghMarker = new maplibregl.Marker({ element: ghEl }).setLngLat(startPos as [number, number]).addTo(map);
      this.ready = true;
    };
    if (map.isStyleLoaded()) setup(); else map.once("load", setup);
  }

  get attribution(): string {
    return this.live
      ? "© OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors · Routing OSRM · Terrain Mapzen/AWS"
      : "Map: Natural Earth (public domain)";
  }

  setRoute(route: Route) {
    this.route = route;
    if (!this.ready) return;
    this.addRouteLayers();
    this.placeMarkers();
  }

  private addRouteLayers() {
    const map = this.map!, r = this.route!;
    const src = (id: string, data: GeoJSON.Feature) => {
      const s = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (s) s.setData(data); else map.addSource(id, { type: "geojson", data, tolerance: 0.5 });
    };
    src("route", { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.pts } });
    src("done", { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.pts.slice(0, 2) } });
    const w = (a: number, b: number) => ["interpolate", ["linear"], ["zoom"], 5, a, 15, b] as maplibregl.ExpressionSpecification;
    const layers: maplibregl.LayerSpecification[] = [
      { id: "route-case", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2A1405", "line-width": w(5, 13), "line-opacity": 0.65 } },
      { id: "route-ahead", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FF9A2E", "line-width": w(2.6, 8) } },
      { id: "route-done", type: "line", source: "done", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#C2410C", "line-width": w(3.2, 9.5) } },
    ];
    for (const l of layers) if (!map.getLayer(l.id)) map.addLayer(l);
  }

  private addTerrain() {
    const map = this.map!;
    if (!this.live) return;
    if (!map.getSource("dem")) map.addSource("dem", { type: "raster-dem", tiles: DEM_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 14 });
    if (!map.getSource("hs")) map.addSource("hs", { type: "raster-dem", tiles: DEM_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 14 });
    const first = map.getStyle().layers.find((l) => l.type === "symbol");
    if (!map.getLayer("hillshade"))
      map.addLayer({ id: "hillshade", type: "hillshade", source: "hs", paint: { "hillshade-shadow-color": "#5A3E2A", "hillshade-highlight-color": "#FFF2DC", "hillshade-exaggeration": 0.55, "hillshade-illumination-direction": 300 } }, first?.id);
    this.applyTerrain();
  }

  applyTerrain() {
    const map = this.map;
    if (!map || !this.live || !map.getSource("dem")) return;
    const on = this.settings().terrain && this.settings().quality !== "battery";
    try {
      map.setTerrain(on ? { source: "dem", exaggeration: 1.4 } : null);
      if (map.getLayer("hillshade")) map.setLayoutProperty("hillshade", "visibility", on ? "visible" : "none");
      this.terrainOn = on;
    } catch { /* ignore */ }
  }

  private placeMarkers() {
    const map = this.map!;
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    for (const p of this.route!.places) {
      const el = document.createElement("div");
      el.className = "city" + (p.kind === "city" ? " big" : " poi");
      const span = document.createElement("span");
      span.textContent = p.name;
      el.append(span, document.createElement("i"));
      this.markers.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(p.lnglat as [number, number]).addTo(map));
    }
  }

  setCamera(mode: Camera, pos: number) {
    this.camMode = mode;
    const map = this.map, r = this.route;
    if (!map || !r) return;
    const flat = mode !== "map";
    this.meMarker?.getElement().classList.toggle("hidden", !flat);
    if (mode === "loop" || mode === "stage") {
      const b = new maplibregl.LngLatBounds();
      if (mode === "loop") r.pts.forEach((p) => b.extend(p as [number, number]));
      else {
        const l = legAt(r, pos);
        for (let i = 0; i < r.pts.length; i += 3) if (r.cum[i] >= l.m0 && r.cum[i] <= l.m1) b.extend(r.pts[i] as [number, number]);
      }
      map.fitBounds(b, { padding: { top: 120, bottom: 230, left: 60, right: 60 }, pitch: 20, bearing: 0, duration: 1200 });
    }
    setTimeout(() => map.resize(), 30);
  }

  /** Per-frame update. `crank` in radians. */
  update(f: Frame, dt: number, crank: number, now: number) {
    const map = this.map, r = this.route;
    if (!map || !r || !this.ready) return;
    const here = pointAt(r, f.pos).p, ahead = pointAt(r, f.pos + 250).p;
    const b = bearing(here, ahead);
    this.smoothBrg = (this.smoothBrg + ((((b - this.smoothBrg + 540) % 360) - 180) * Math.min(1, dt * 2.5)) + 360) % 360;
    const mps = f.kmh / 3.6;
    if (this.rider) {
      this.rider.m = f.pos; this.rider.brg = this.smoothBrg;
      this.rider.rider?.update(dt, mps, crank, Math.max(0, (f.grade - 0.05) / 0.05) * Math.min(1, f.kmh / 8));
    }
    if (this.ghost) {
      this.ghost.visible = f.ghostOn && Math.abs(f.ghostGap) < 400;
      this.ghost.m = f.ghostPos;
      this.ghost.brg = bearing(pointAt(r, f.ghostPos).p, pointAt(r, f.ghostPos + 250).p);
      this.ghost.rider?.update(dt, mps, crank * 1.02);
    }
    const g = this.ghMarker?.getElement();
    if (g) g.classList.toggle("hidden", !(f.ghostOn && this.camMode !== "map"));
    if (this.camMode === "map") {
      map.jumpTo({ center: pointAt(r, f.pos + (this.live ? 300 : 900)).p as [number, number], bearing: this.smoothBrg, pitch: 62, zoom: this.live ? 14.6 : 12.9 });
      map.triggerRepaint();
    } else if (now - this.lastJump > (this.camMode === "road" ? 120 : 250)) {
      // The minimap and overview cameras don't need 60 fps; this keeps the GPU free for the road view.
      this.lastJump = now;
      if (this.camMode === "road") map.jumpTo({ center: here as [number, number], bearing: this.smoothBrg, pitch: 0, zoom: this.live ? 13.6 : 11.4 });
      this.meMarker?.setLngLat(here as [number, number]);
      if (f.ghostOn) this.ghMarker?.setLngLat(pointAt(r, f.ghostPos).p as [number, number]);
    }
    if (now - this.lastDone > 400) {
      this.lastDone = now;
      const lm = wrapM(r, f.pos), i = pointAt(r, lm).i;
      (map.getSource("done") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.pts.slice(0, i + 1).concat([here]) },
      });
    }
  }

  resize() { this.map?.resize(); }
  bearingDeg() { return this.smoothBrg; }
  here(f: Frame): LngLat | null { return this.route ? pointAt(this.route, f.pos).p : null; }
}

async function canReach(url: string, ms: number): Promise<boolean> {
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), ms);
    const r = await fetch(url, { signal: ac.signal });
    clearTimeout(to);
    return r.ok;
  } catch {
    return false;
  }
}

const SAND = () => pattern(256, (g, s) => {
  g.fillStyle = "#E9C894"; g.fillRect(0, 0, s, s);
  for (let k = 0; k < 9; k++) {
    const y0 = ((k + 0.5) * s) / 9, gr = g.createLinearGradient(0, y0 - 14, 0, y0 + 14);
    gr.addColorStop(0, "rgba(255,236,200,0)"); gr.addColorStop(0.45, "rgba(255,238,205,.5)"); gr.addColorStop(0.55, "rgba(176,122,64,.3)"); gr.addColorStop(1, "rgba(176,122,64,0)");
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, y0 - 14);
    for (let x = 0; x <= s; x += 8) g.lineTo(x, y0 - 14 + Math.sin((x / s) * TAU * 2 + k * 1.7) * 7);
    g.lineTo(s, y0 + 14);
    for (let x = s; x >= 0; x -= 8) g.lineTo(x, y0 + 14 + Math.sin((x / s) * TAU * 2 + k * 1.7) * 7);
    g.closePath(); g.fill();
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = rnd() > 0.5 ? `rgba(255,240,215,${0.12 + rnd() * 0.18})` : `rgba(170,120,70,${0.06 + rnd() * 0.12})`;
    g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
  }
});
const SEA = () => pattern(128, (g, s) => {
  g.fillStyle = "#1B6B83"; g.fillRect(0, 0, s, s);
  g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 1.2;
  for (let k = 0; k < 6; k++) {
    g.beginPath();
    for (let x = -4; x <= s + 4; x += 4) { const y = ((k + 0.5) * s) / 6 + Math.sin((x / s) * TAU * 3 + k * 2) * 2.5; if (x === -4) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
  }
});
