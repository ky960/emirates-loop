import type { Route } from "../route";
import { sameRoute } from "../store/rides";
import type { RideRecord } from "./types";

/** Badges earned from your saved rides and the challenges you've completed. Worked out fresh each time, so nothing to migrate. */
export interface Badge {
  id: string;
  icon: string;
  title: string;
  desc: string;
  earned: boolean;
  /** For badges in progress: how far along (same units as the goal). */
  progress?: [number, number];
}

export interface ChallengeLogEntry { id: string; kind: "climb" | "sprint" | "hold"; at: number; time: number | null }

const dayIndex = (t: number) => { const d = new Date(t); return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000); };

/** Days in a row with a ride: the current run (counting today or yesterday) and your best. */
export function streak(rides: RideRecord[], now = Date.now()): { current: number; best: number } {
  const days = [...new Set(rides.map((r) => dayIndex(r.start)))].sort((a, b) => a - b);
  let best = 0, run = 0;
  for (let i = 0; i < days.length; i++) { run = i && days[i] === days[i - 1] + 1 ? run + 1 : 1; best = Math.max(best, run); }
  const today = dayIndex(now), last = days[days.length - 1];
  const current = last !== undefined && today - last <= 1 ? run : 0;
  return { current, best };
}

export function badges(rides: RideRecord[], route: Route, log: ChallengeLogEntry[], now = Date.now()): Badge[] {
  const km = rides.reduce((a, r) => a + r.dist, 0) / 1000;
  const climb = rides.reduce((a, r) => a + (r.climb || 0), 0);
  const longest = Math.max(0, ...rides.map((r) => r.dist / 1000));
  const longestT = Math.max(0, ...rides.map((r) => r.moving));
  const st = streak(rides, now);
  const out: Badge[] = [];
  const goal = (id: string, icon: string, title: string, desc: string, cur: number, target: number) =>
    out.push({ id, icon, title, desc, earned: cur >= target, progress: [Math.min(cur, target), target] });

  goal("first", "🚴", "First ride", "Save your first ride", rides.length, 1);
  for (const k of [50, 100, 250, 500, 1000]) goal(`km${k}`, k >= 500 ? "🌍" : "🛣️", `${k} km`, `Ride ${k} km in total`, Math.floor(km), k);

  // Stages: done once you've ridden past a stage's finish (over as many sessions as it takes).
  const mine = rides.filter((r) => sameRoute(route.id, r.routeId));
  const passed = (m: number) => mine.some((r) => {
    if (!route.loop) return r.startM < m && r.startM + r.dist >= m;
    const n = Math.floor((r.startM - m) / route.total) + 1;
    return [n - 1, n].some((k) => { const at = m + k * route.total; return r.startM < at && r.startM + r.dist >= at; });
  });
  const stages = route.legs.map((l, i) => {
    const ok = passed(l.m1);
    out.push({ id: `stage${i + 1}`, icon: "🏁", title: `Stage ${i + 1}`, desc: `${l.from} → ${l.to}`, earned: ok });
    return ok;
  });
  if (route.loop && route.legs.length > 1) out.push({ id: "loop", icon: "🇦🇪", title: route.name, desc: "Every stage of the loop", earned: stages.every(Boolean), progress: [stages.filter(Boolean).length, stages.length] });

  goal("climb500", "⛰️", "Climber", "Climb 500 m in total", Math.round(climb), 500);
  goal("climb2000", "🏔️", "Mountain goat", "Climb 2,000 m in total", Math.round(climb), 2000);
  goal("long50", "💪", "Half century", "50 km in one ride", Math.floor(longest), 50);
  goal("long100", "💯", "Century", "100 km in one ride", Math.floor(longest), 100);
  goal("hour", "⏱️", "An hour in", "Ride for an hour", Math.floor(longestT / 60), 60);
  goal("twohours", "⌛", "Long haul", "Ride for two hours", Math.floor(longestT / 60), 120);
  goal("streak3", "🔥", "On a roll", "Ride 3 days in a row", st.best, 3);
  goal("streak7", "🔥", "Week of wheels", "Ride 7 days in a row", st.best, 7);

  const done = log.length, holds = log.filter((e) => e.kind === "hold").length;
  const timed = new Map<string, number>();
  let improved = false;
  for (const e of [...log].sort((a, b) => a.at - b.at)) {
    if (e.time === null) continue;
    const prev = timed.get(e.id);
    if (prev !== undefined && e.time < prev) improved = true;
    timed.set(e.id, prev === undefined ? e.time : Math.min(prev, e.time));
  }
  goal("chal10", "🎯", "Challenger", "Complete 10 challenges", done, 10);
  goal("holds5", "🎚️", "Steady", "Complete 5 holds", holds, 5);
  out.push({ id: "pb", icon: "⚡", title: "Personal best", desc: "Beat your time on a sprint or climb", earned: improved });

  const hours = rides.map((r) => new Date(r.start).getHours());
  out.push({ id: "early", icon: "🌅", title: "Early bird", desc: "Start a ride before 7 am", earned: hours.some((h) => h < 7 && h >= 3) });
  out.push({ id: "night", icon: "🌙", title: "Night owl", desc: "Start a ride after 9 pm", earned: hours.some((h) => h >= 21 || h < 3) });
  return out;
}

/** Badges earned in `after` that weren't in `before`. */
export const newlyEarned = (before: Badge[], after: Badge[]) => after.filter((b) => b.earned && !before.find((x) => x.id === b.id)?.earned);
