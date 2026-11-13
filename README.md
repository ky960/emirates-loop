# Emirates Loop

Indoor ride tracker: ride the 618 km Emirates Loop (Abu Dhabi → Dubai → Sharjah → Fujairah → Hatta → Al Ain → Abu Dhabi) on a real map, with Bluetooth speed, cadence and heart-rate sensors.

Built for one rider on a Samsung Galaxy Tab S7+ in Chrome, with a CYCPLUS speed/cadence sensor and an Amazfit Helio Strap.

## What it does

- **Sensors:** any number of Bluetooth sensors at once. Speed (CSC wheel), cadence (CSC crank), heart rate, and smart trainers (FTMS). A CYCPLUS unit in speed mode (blue light) or cadence mode (green light) is detected automatically. Sensors reconnect on their own after a dropout.
- **Real gradients:** elevation comes from the open terrain model (or the GPX file). With "Climbs slow you down" on, your sensor speed counts as flat-road effort and the route's gradient changes your virtual speed.
- **3D road view:** the road follows the real elevation. Real buildings, parks and water come from OpenStreetMap. Desert, city, oasis and Hajar mountain scenery, green distance signs in English and Arabic, and a rider whose legs follow your cadence (estimated from speed when only a speed sensor is connected).
- **Ghost:** replays your best ride second by second.
- **Trustworthy data:**
  - Ride time comes from the clock, not the screen's frame rate, and distance from the sensor.
  - Auto-start and auto-pause.
  - The ride is saved every 5 s and offered back after a crash or reload.
  - Simulated rides never count toward your stats.
- **History:** lap progress by stage, weekly distance, records (longest, best average, fastest 10 km, most climbing), per-ride charts with heart-rate zones, calories and training load.
- **Export:** TCX for Strava or Garmin Connect, plus a full JSON backup and restore.
- **Installable:** add to the home screen from Chrome's menu and it opens full screen and works offline. Map tiles you've ridden through stay cached.
- **Graphics presets:** Battery (30 fps, no shadows), Balanced (60 fps) and Max.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (parsers, ride engine, physics, elevation, route, export)
npm run build      # type-check + production build into dist/
```

Source lives in `app/`. The old single-file app (`index.html` at the repo root) stays live until cut-over.

## Deploy

**Preview (no settings change):** copy the contents of `dist/` into a `next/` folder in the repo and push. The new app is then at `https://ky960.github.io/emirates-loop/next/`, while the old app keeps running at the root.

Both share the same origin, so the new app imports the old app's settings and rides the first time it opens. It stores everything under new keys, so the old app's data is left untouched.

**Cut-over:**
1. Set *Settings → Pages → Source* to **GitHub Actions**.
2. Run the **Deploy** workflow (Actions tab → Deploy → Run workflow). It builds `app/` and publishes it at the site root.

## Map data

© OpenStreetMap contributors via OpenFreeMap and OpenMapTiles · routing by OSRM · terrain from open elevation tiles on AWS (Mapzen) · offline fallback: Natural Earth (public domain).

## Asset credits

- `app/public/env/quarry_01_1k.hdr`: "Quarry 01" HDRI by Poly Haven (CC0), via the three.js examples.
- `app/public/tex/*`: procedurally generated for this app (CC0).
