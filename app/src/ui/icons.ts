/** Line icons (24×24, stroke = currentColor). Used instead of emoji so the UI reads as one consistent set. */
const P: Record<string, string> = {
  bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17 9 9h6l3.5 8M9 9 12 17h-1M14 5h2l-1 4"/>',
  road: '<path d="M4 21 9 3M20 21 15 3M12 6v2M12 11v2M12 16v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  loop: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  mountain: '<path d="m3 20 6-9 4 5 3-4 5 8z"/>',
  peaks: '<path d="m2 20 7-12 5 8 3-5 5 9z"/><path d="m7.5 10.5 1.5 1.5 1.5-1.5"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8.5 11 6 3h4l2 5 2-5h4l-2.5 8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-7 0-4-3-6-4-10-2 2-2 4-2 5-1-1-2-2-2-4-3 3-6 5.5-6 9 0 4.3 3 7 7 7Z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 14 4-5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  sunrise: '<path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 4v4M4.9 8.9l1.4 1.4M19.1 8.9l-1.4 1.4M9 21h6"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

export const icon = (name: string, size = 20, extra = "") =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${extra}>${P[name] ?? P.medal}</svg>`;

/** Which icon each badge gets (by badge id; stage badges share one). */
export function badgeIcon(id: string): string {
  if (id.startsWith("stage")) return "flag";
  const m: Record<string, string> = {
    first: "bike", km50: "road", km100: "road", km250: "road", km500: "globe", km1000: "globe", loop: "loop",
    climb500: "mountain", climb2000: "peaks", long50: "gauge", long100: "gauge", hour: "clock", twohours: "hourglass",
    streak3: "flame", streak7: "flame", chal10: "target", holds5: "gauge", pb: "bolt", sights3: "pin", sightsAll: "map",
    early: "sunrise", night: "moon",
  };
  return m[id] ?? "medal";
}
