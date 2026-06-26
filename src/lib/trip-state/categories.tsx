// Central category registry — the single source of truth for how each itinerary
// category is labeled and drawn. Replaces (a) the emoji `CATEGORY_META` +
// per-browser localStorage override that used to live in trip-map.tsx and (b)
// the duplicate Tailwind `CATEGORY_COLORS` pill map in planning-panel.tsx.
//
// Why app-bundled SVG, not emoji: OS emoji render differently on every device
// (iOS vs Android vs Windows), and a per-browser override can't follow a user
// across devices once we have accounts + mobile. Vectors defined here render
// identically everywhere. Any future user-customization should be a server-
// stored choice from this curated set, never a localStorage hack.
//
// Design system note: DAY owns hue everywhere (see day-colors.ts). Category is
// distinguished by its monochrome ICON only — never a competing color. So the
// icon is always stroked in the current text/ink color.
//
// One source, two consumers: `path` is raw <svg> inner markup. The React
// <CategoryIcon> renders it via dangerouslySetInnerHTML (safe — these are our
// own constant strings); `categoryIconSvg()` returns a full <svg> string for
// imperative DOM contexts (the MapLibre marker + popup are built by hand).
// Icon outlines are lucide-style (24×24, stroke, round caps).

export type CategoryMeta = { label: string; path: string };

export const CATEGORIES: Record<string, CategoryMeta> = {
  activity: {
    label: "Activity",
    path: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  },
  drive: {
    label: "Drive",
    path: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  },
  flight: {
    label: "Flight",
    path: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  },
  meal: {
    label: "Meal",
    path: '<path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  },
  lodging: {
    label: "Lodging",
    path: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v3"/>',
  },
  transit: {
    label: "Transit",
    path: '<path d="M8 6v6M15 6v6M2 12h19.6"/><path d="M18 18h3c.3 0 .5-.2.6-.5L22 14V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8l.4 3.5c.1.3.3.5.6.5h3"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  },
  rest: {
    label: "Rest",
    path: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  },
  other: {
    label: "Other",
    path: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  },
};

/** Ordered category keys (registry insertion order). */
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export function categoryMeta(category: string): CategoryMeta {
  return CATEGORIES[category] ?? CATEGORIES.other;
}

export function categoryLabel(category: string): string {
  return CATEGORIES[category]?.label ?? category;
}

/** Full <svg> string for imperative DOM (MapLibre marker/popup). */
export function categoryIconSvg(
  category: string,
  opts: { size?: number; stroke?: string; strokeWidth?: number } = {}
): string {
  const { size = 14, stroke = "currentColor", strokeWidth = 1.9 } = opts;
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${categoryMeta(category).path}</svg>`
  );
}

/** React icon — stroked in currentColor, so the caller controls ink via text color. */
export function CategoryIcon({
  category,
  size = 16,
  strokeWidth = 1.9,
  className,
}: {
  category: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: categoryMeta(category).path }}
    />
  );
}
