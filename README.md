# Emirates Loop

Indoor ride tracker: ride the 618 km Emirates Loop (Abu Dhabi → Dubai → Sharjah → Fujairah → Hatta → Al Ain → Abu Dhabi) on a real map, with Bluetooth speed, cadence and heart-rate sensors.

Built for one rider on a Samsung Galaxy Tab S7+ in Chrome, with a CYCPLUS speed/cadence sensor and an Amazfit Helio Strap.

## What it does

- **Sensors:** any number of Bluetooth sensors at once. Speed (CSC wheel), cadence (CSC crank), heart rate, and smart trainers (FTMS). A CYCPLUS unit in speed mode (blue light) or cadence mode (green light) is detected automatically. Sensors reconnect on their own after a dropout.
- **Real gradients:** elevation comes from the open terrain model (or the GPX file). With "Climbs slow you down" on, your sensor speed counts as flat-road effort and the route's gradient changes your virtual speed.
- **3D road view:** the road follows the real elevation. Detailed 3D models for the rider, date palms and traffic (Camry, Patrol). Landmarks at their real places (Burj Khalifa, Burj Al Arab, Sheikh Zayed Grand Mosque), dhows on the water and camels in the desert. City streets have people walking, waving UAE flags, bougainvillea in the median, zebra crossings and bus shelters. Real buildings, parks and water come from OpenStreetMap. Desert, city, oasis and Hajar mountain scenery, green distance signs in English and Arabic, and a rider whose legs follow your cadence (estimated from speed when only a speed sensor is connected).
- **Choose your ride:** when the app opens, continue where your last saved ride ended or start any of the six stages from its beginning (also under *Stages* on the Ride tab), so the 617 km loop is ridden over many sessions. Every ride begins in a roadside car park and rolls out onto the road.
- **Cinematic camera:** the road view glides from the chase view to an aerial, a side and a front view of you, then back (Settings → Display).
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
- `app/public/models/*`: 3D models from Sketchfab under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Each was compressed (meshopt geometry, WebP textures, some mesh simplification). The cyclist also gets a painted-on jersey, a helmet and pedalling legs in code, and the Camry's interior was dropped.
  - `cyclist.glb`: ["Rigged cyclist"](https://sketchfab.com/3d-models/rigged-cyclist-ff9f413898844f1d8ee7318f048b3619) by novusod
  - `date_palm.glb`: ["Date Palm"](https://sketchfab.com/3d-models/date-palm-11acf710e6c149daa8d6fb8cdc5d087f) by evolveduk
  - `camry.glb`: ["Toyota Camry 40"](https://sketchfab.com/3d-models/toyota-camry-40-560c174d073f4a10bb153ded41ada8c9) by Ford mondeo
  - `patrol.glb`: ["Nissan Patrol Nismo"](https://sketchfab.com/3d-models/nissan-patrol-nismo-80162fe6fadd4650a2a6c38fca3662a0) by radekstepan
  - `ped_nathan.glb`: ["Nathan Animated 003 - Walking 3D Man"](https://sketchfab.com/3d-models/nathan-animated-003-walking-3d-man-143a2b1ea5eb4385ae90a73657aca3bc) by Renderpeople
  - `ped_eric.glb`: ["Eric Rigged 001 - Rigged 3D Business Man"](https://sketchfab.com/3d-models/eric-rigged-001-rigged-3d-business-man-a46bc9f67aaa415bb4f3241eef900e7f) by Renderpeople (walks with Nathan's animation)
  - `ped_claudia.glb`: ["Claudia Rigged 002 - 3D Rigged Business Women"](https://sketchfab.com/3d-models/claudia-rigged-002-3d-rigged-business-women-c659bd0accab47c6bbe390cf822a2b92) by Renderpeople (walks with Nathan's animation)
  - `lm_burj_khalifa.glb`: ["Burj Khalifa Dubai"](https://sketchfab.com/3d-models/burj-khalifa-dubai-f8ec435f7f084037a6e7de3540c19173) by farhad.Guli
  - `lm_burj_al_arab.glb`: ["18-burj-al-arab-jumeirah"](https://sketchfab.com/3d-models/18-burj-al-arab-jumeirah-70302a0ddc804715ae3aa61db8a7d444) by Success isaac
  - `lm_zayed_mosque.glb`: ["Sheikh Zayed Mosque"](https://sketchfab.com/3d-models/sheikh-zayed-mosque-67c1e0727de44c9082d5c8987e1ffb62) by rizariyaz145
  - `dhow.glb`: ["Low Poly Ancient Dhow Ship"](https://sketchfab.com/3d-models/low-poly-ancient-dhow-ship-f25b4552dce24d379833160dd217db84) by Nisa Nurul Azizah
  - `camel.glb`: ["camel"](https://sketchfab.com/3d-models/camel-44ef2ea4b50a49e395e5e3ebbdc99f98) by omarme37
