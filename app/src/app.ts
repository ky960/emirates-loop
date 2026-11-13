import type { ElevationProfile } from "./elevation";
import type { RideEngine } from "./ride/engine";
import type { RideRecord } from "./ride/types";
import type { Route } from "./route";
import type { SensorHub } from "./sensors/hub";
import type { Settings } from "./store/settings";

/** Shared app state handed to the History and Settings views. */
export interface AppCtx {
  settings: Settings;
  saveSettings(): void;
  rides: RideRecord[];
  reloadRides(): Promise<void>;
  route: Route;
  profile: ElevationProfile;
  hub: SensorHub;
  engine: RideEngine;
  /** Re-select the route after the GPX or route settings change. */
  applyRoute(): Promise<void>;
  addSensor(): Promise<void>;
  startSim(mode: import("./sensors/hub").SimMode): void;
  applyQuality(): void;
  info(): { scene: string; map: string; elevation: string; version: string };
}
