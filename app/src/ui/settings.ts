import type { AppCtx } from "../app";
import { download } from "../export/tcx";
import { parseGpx } from "../route";
import type { SimMode } from "../sensors/hub";
import { db } from "../store/db";
import { exportBackup, importBackup } from "../store/rides";
import { maxHrOf, type Quality, type Settings, type Sex } from "../store/settings";
import { html, sheet, toast } from "./dom";

const KIND: Record<string, string> = { speed: "Speed", cadence: "Cadence", hr: "Heart rate", trainer: "Smart trainer" };
const ICON: Record<string, string> = { speed: "SPD", cadence: "CAD", hr: "HR", trainer: "FTMS" };

export function renderSettings(el: HTMLElement, ctx: AppCtx) {
  const s = ctx.settings, hub = ctx.hub, info = ctx.info();
  const sensors = hub.list();
  const sw = (key: keyof Settings, label: string, help: string) => html`
    <div class="field"><span class="flabel" id="lb-${key}">${label}</span>
      <label class="switch"><input type="checkbox" data-k="${key}" aria-labelledby="lb-${key}" ${s[key] ? "checked" : ""}><span></span></label>
      <small>${help}</small></div>`;
  const num = (key: keyof Settings, label: string, help: string, min: number, max: number, step = 1, placeholder = "") => html`
    <div class="field"><label for="f-${key}">${label}</label>
      <input id="f-${key}" type="number" inputmode="decimal" data-n="${key}" min="${min}" max="${max}" step="${step}" value="${s[key] ?? ""}" placeholder="${placeholder}">
      ${help ? html`<small>${help}</small>` : ""}</div>`;
  const seg = (key: keyof Settings, opts: Array<[string, string]>) => html`<div class="seg" role="group">${opts.map(([v, l]) => html`<button data-seg="${key}" data-v="${v}" aria-pressed="${String(s[key]) === v}">${l}</button>`)}</div>`;

  el.innerHTML = html`
  <div class="grid2">
    <div class="card">
      <h2>Sensors <button class="btn sm primary" data-a="add">Add sensor</button></h2>
      ${!hub.supported ? html`<div class="note">This browser has no Bluetooth. Open the app in Chrome on Android to connect sensors.</div>` : ""}
      <div>${sensors.length ? sensors.map((x) => html`
        <div class="sensor">
          <span class="ico">${ICON[x.kinds[0]] ?? "BT"}</span>
          <div style="min-width:0"><b>${x.name}</b><div class="st ${x.status === "connected" ? "on" : "wait"}">${x.status === "connected" ? "Connected" : x.status === "connecting" ? "Connecting…" : x.status === "reconnecting" ? "Reconnecting…" : "Not connected"}${x.kinds.length ? " · " + x.kinds.map((k) => KIND[k]).join(" + ") : ""}${x.battery !== undefined ? ` · battery ${x.battery}%` : ""}</div>${x.note ? html`<div class="st wait">${x.note}</div>` : ""}</div>
          <button class="linkbtn" data-forget="${x.id}">${x.sim ? "Stop" : "Forget"}</button>
        </div>`) : html`<p class="muted" style="margin:0">No sensors yet. Add your CYCPLUS sensor (blue light = speed mode, green = cadence mode) and your heart-rate strap (turn on heart-rate broadcast in the Zepp app first). You can add several.</p>`}</div>
      <h3>No bike handy?</h3>
      <div class="row">${(["speed+hr", "cadence+hr", "speed"] as SimMode[]).map((m) => html`<button class="btn sm ghost" data-sim="${m}">Simulate ${m.replace("+hr", " + heart rate").replace("speed", "speed sensor").replace("cadence", "cadence sensor")}</button>`)}</div>
    </div>

    <div class="card">
      <h2>You</h2>
      <div class="field"><label for="f-name">Name</label><input id="f-name" type="text" maxlength="40" autocomplete="off" value="${s.name}" data-t="name"></div>
      ${num("age", "Age", "", 10, 99)}
      ${num("weightKg", "Weight (kg)", "Used for climbing speed and calories.", 30, 200, 0.5)}
      <div class="field"><span class="flabel">Sex</span>${seg("sex", [["male", "Male"], ["female", "Female"], ["unspecified", "Not set"]])}<small>Only used for the calorie and training-load formulas.</small></div>
      ${num("maxHr", "Max heart rate", `Leave empty to estimate from your age (${Math.round(208 - 0.7 * s.age)} bpm). Zones: 50–60–70–80–90 % of ${maxHrOf(s)} bpm.`, 120, 230, 1, String(Math.round(208 - 0.7 * s.age)))}
      ${num("restHr", "Resting heart rate", "For training load.", 30, 110)}
    </div>

    <div class="card">
      <h2>Bike</h2>
      ${num("wheelMm", "Wheel circumference (mm)", "For a speed sensor on the rear wheel: 2105 mm suits 700×25c, 2136 mm suits 700×28c. On a spin-bike flywheel, adjust until the speed feels right.", 500, 3000)}
      ${num("strokeM", "Metres per pedal turn", "For a cadence-only sensor. At 5.5 m, 80 rpm reads about 26 km/h.", 1, 12, 0.1)}
    </div>

    <div class="card">
      <h2>Ride</h2>
      ${sw("gradientEffect", "Climbs slow you down", "Your sensor speed is treated as your flat-road effort; climbs and descents on the route change your virtual speed, like riding outdoors.")}
      ${sw("autoPause", "Auto-pause", "Stops the clock when you stop pedalling; pedal to carry on.")}
      ${sw("ghost", "Race your ghost", "Replays your best ride second by second.")}
      ${sw("sound", "Ride sound", "Wind, freewheel and a chime at each town.")}
      ${sw("traffic", "Traffic", "Cars on the road in the 3D view. Changes the next time the app opens.")}
      ${sw("showPower", "Show estimated power", "Estimated from speed — not a power meter.")}
    </div>

    <div class="card">
      <h2>Display</h2>
      <div class="field"><span class="flabel">Graphics</span>${seg("quality", [["battery", "Battery"], ["balanced", "Balanced"], ["max", "Max"]])}
        <small>Battery: 30 fps, no shadows — coolest for long rides. Balanced: 60 fps. Max: full detail at the screen's refresh rate.</small></div>
      ${sw("terrain", "3D terrain on the map", "Hills and mountains on the map views.")}
      <div class="field"><span class="flabel">Full screen</span><button class="btn sm ghost" data-a="fs">Go full screen</button><small>Or add the app to your home screen from Chrome's menu — it then always opens full screen.</small></div>
    </div>

    <div class="card">
      <h2>Route</h2>
      <p style="margin:0 0 6px"><b>${ctx.route.name}</b> · ${(ctx.route.total / 1000).toFixed(1)} km${ctx.route.kind === "approx" ? " (approximate until the street route downloads)" : ""}</p>
      <p class="muted" style="margin:0 0 10px">Elevation: ${info.elevation}</p>
      <div class="row">
        <label class="btn sm ghost filebtn">Import GPX route<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" data-a="gpx"></label>
        ${s.gpx ? html`<button class="btn sm ghost" data-a="loop">Back to the Emirates Loop</button>` : ""}
      </div>
      <small class="muted">Draw a route in komoot or Strava and export it as GPX. Its own elevation is used when it has one.</small>
    </div>

    <div class="card">
      <h2>Your data</h2>
      <p class="muted" style="margin:0 0 10px">Rides live only on this tablet. Back them up now and then.</p>
      <div class="row">
        <button class="btn sm ghost" data-a="backup">Download backup</button>
        <label class="btn sm ghost filebtn">Restore backup<input type="file" accept="application/json,.json" data-a="restore"></label>
        <button class="btn sm danger" data-a="wipe">Delete all rides</button>
      </div>
    </div>

    <div class="card">
      <h2>About</h2>
      <p class="muted" style="margin:0">Emirates Loop ${info.version} · ${info.map}${info.scene ? ` · ${info.scene}` : ""}</p>
      <p class="muted" style="margin:8px 0 0;font-size:14px">Map data © OpenStreetMap contributors via OpenFreeMap and OpenMapTiles. Routing by OSRM. Terrain from open elevation tiles on AWS (Mapzen). Offline fallback: Natural Earth (public domain).</p>
    </div>
  </div>`.s;

  const rerender = () => renderSettings(el, ctx);
  el.querySelectorAll<HTMLInputElement>("[data-k]").forEach((i) => i.addEventListener("change", () => {
    const k = i.dataset.k as keyof Settings;
    (s as unknown as Record<string, unknown>)[k] = i.checked;
    ctx.saveSettings();
    if (k === "gradientEffect") ctx.reloadRides();
    if (k === "terrain") toast(i.checked ? "3D terrain on" : "3D terrain off");
    if (k === "sound") document.dispatchEvent(new CustomEvent("el:sound", { detail: i.checked }));
    if (k === "terrain") document.dispatchEvent(new CustomEvent("el:terrain"));
  }));
  el.querySelectorAll<HTMLInputElement>("[data-n]").forEach((i) => i.addEventListener("change", () => {
    const k = i.dataset.n as keyof Settings, v = i.value === "" ? null : +i.value;
    const min = +i.min, max = +i.max;
    if (k === "maxHr" && v === null) { s.maxHr = null; ctx.saveSettings(); rerender(); return; }
    if (v === null || !isFinite(v) || v < min || v > max) { i.value = String(s[k] ?? ""); toast(`Enter a value between ${min} and ${max}`); return; }
    (s as unknown as Record<string, unknown>)[k] = v;
    ctx.saveSettings();
    toast("Saved");
    if (k === "age" || k === "maxHr") rerender();
  }));
  el.querySelector<HTMLInputElement>("[data-t=name]")?.addEventListener("input", (e) => { s.name = (e.target as HTMLInputElement).value.trim(); ctx.saveSettings(); });
  el.querySelectorAll<HTMLElement>("[data-seg]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.seg as "sex" | "quality";
    if (k === "sex") s.sex = b.dataset.v as Sex;
    if (k === "quality") { s.quality = b.dataset.v as Quality; ctx.applyQuality(); }
    ctx.saveSettings();
    rerender();
  }));
  el.querySelectorAll<HTMLElement>("[data-forget]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.forget!;
    hub.forget(id);
    s.sensors = s.sensors.filter((x) => x.id !== id);
    ctx.saveSettings();
    rerender();
  }));
  el.querySelectorAll<HTMLElement>("[data-sim]").forEach((b) => b.addEventListener("click", () => ctx.startSim(b.dataset.sim as SimMode)));

  el.querySelector("[data-a=add]")?.addEventListener("click", () => ctx.addSensor().then(rerender));
  el.querySelector("[data-a=fs]")?.addEventListener("click", () => document.documentElement.requestFullscreen?.().catch(() => toast("Full screen isn't available here")));
  el.querySelector<HTMLInputElement>("[data-a=gpx]")?.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    if (!f) return;
    if (ctx.engine.active) { toast("Finish your ride before changing the route"); input.value = ""; return; }
    try {
      s.gpx = parseGpx(await f.text(), f.name.replace(/\.gpx$/i, ""));
      ctx.saveSettings();
      await ctx.applyRoute();
      toast(`Route loaded: ${(ctx.route.total / 1000).toFixed(1)} km`);
      rerender();
    } catch (err) {
      toast((err as Error).message || "Couldn't read that GPX file");
    }
    input.value = "";
  });
  el.querySelector("[data-a=loop]")?.addEventListener("click", async () => {
    if (ctx.engine.active) { toast("Finish your ride before changing the route"); return; }
    s.gpx = null;
    ctx.saveSettings();
    await ctx.applyRoute();
    toast("Back on the Emirates Loop");
    rerender();
  });
  el.querySelector("[data-a=backup]")?.addEventListener("click", async () => {
    download(`emirates-loop-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup({ ...s, gpx: s.gpx }));
  });
  el.querySelector<HTMLInputElement>("[data-a=restore]")?.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    if (!f) return;
    try {
      const { added } = await importBackup(await f.text());
      await ctx.reloadRides();
      toast(added ? `Restored ${added} ride${added > 1 ? "s" : ""}` : "Nothing new in that backup");
    } catch (err) {
      toast((err as Error).message || "Couldn't read that backup");
    }
    input.value = "";
  });
  el.querySelector("[data-a=wipe]")?.addEventListener("click", async () => {
    const act = await sheet(html`<h2>Delete all rides?</h2><p>This removes ${ctx.rides.length} rides and resets your loop progress. It can't be undone — download a backup first if you might want them.</p>
      <div class="acts"><button class="btn danger" data-act="yes">Delete everything</button><button class="btn ghost" data-act="no">Cancel</button></div>`);
    if (act !== "yes") return;
    await db.clear("rides");
    await ctx.reloadRides();
    toast("All rides deleted");
  });
}
