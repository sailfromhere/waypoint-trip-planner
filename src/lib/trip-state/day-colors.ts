// Shared day palette so the map, calendar, and any future day-keyed view agree
// on which color means "day 3". Index by the trip's sorted distinct dates.
//
// "Cartographic Field Guide" palette: a curated, roughly equal-luminance set of
// muted hues that walks the color wheel (warm → green → cool → magenta → warm)
// so adjacent days stay distinguishable, and that sits naturally on warm paper
// instead of reading like a chart. Replaces the old raw Tailwind-500 swatches.
// DAY owns hue across the whole app; category is distinguished by icon only.
// NOTE: keep this array in sync with the `.wp-band-N` gradient colors in
// globals.css (the month-view day bands select by index).
export const DAY_COLORS = [
  "#C2683C", // 0 terracotta
  "#BE9A3A", // 1 ochre
  "#6E8240", // 2 moss
  "#2F7E6E", // 3 pine
  "#2E6B7E", // 4 ocean
  "#4E6E8E", // 5 slate-blue
  "#5E5E97", // 6 indigo
  "#8A5A78", // 7 plum
  "#B05060", // 8 rose
  "#A8553E", // 9 rust
];

export function buildDayColorMap(
  dates: (string | null)[]
): Map<string, string> {
  const distinct = Array.from(
    new Set(dates.filter((d): d is string => !!d))
  ).sort();
  const map = new Map<string, string>();
  distinct.forEach((d, i) => map.set(d, DAY_COLORS[i % DAY_COLORS.length]));
  return map;
}
