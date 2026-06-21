// Shared day palette so the map, calendar, and any future day-keyed view agree
// on which color means "day 3". Index by the trip's sorted distinct dates.
export const DAY_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
  "#6366f1",
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
