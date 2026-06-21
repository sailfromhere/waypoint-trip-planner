"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ItineraryItem } from "@/db/types";
import type { DayRoute, DriveRoute } from "@/app/api/trips/[tripId]/routes/route";

const DAY_COLORS = [
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

// Day-sequence connectors render in a neutral gray so they read as secondary
// and never get confused with the day-colored drive routes.
const CONNECTOR_COLOR = "#9ca3af";

const CATEGORY_META: Record<string, { icon: string; label: string }> = {
  drive: { icon: "🚗", label: "Drive" },
  flight: { icon: "✈️", label: "Flight" },
  activity: { icon: "📍", label: "Activity" },
  meal: { icon: "🍽️", label: "Meal" },
  lodging: { icon: "🛏️", label: "Lodging" },
  transit: { icon: "🚌", label: "Transit" },
  rest: { icon: "💤", label: "Rest" },
  other: { icon: "📌", label: "Other" },
};

// Per-category icon overrides, persisted per-browser (no schema change).
const ICON_STORAGE_KEY = "waypoint-category-icons";

function loadIconOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(ICON_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function getTileStyle(): string | maplibregl.StyleSpecification {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) {
    return `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`;
  }
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        ],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/">CARTO</a>',
      },
    },
    layers: [
      { id: "carto-tiles", type: "raster", source: "carto", minzoom: 0, maxzoom: 19 },
    ],
  };
}

interface MapMarkerPoint {
  key: string;
  itemId: string;
  lat: number;
  lng: number;
  icon: string;
  color: string;
  title: string;
  label: string;
  date: string | null;
  size: number;
  offset: [number, number];
}

function createMarkerElement(point: MapMarkerPoint): HTMLDivElement {
  const el = document.createElement("div");
  const s = point.size;
  el.style.cssText = `
    width: ${s}px; height: ${s}px; border-radius: 50%;
    background: white; border: 3px solid ${point.color};
    display: flex; align-items: center; justify-content: center;
    font-size: ${Math.round(s * 0.5)}px; cursor: pointer;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  `;
  el.textContent = point.icon;
  el.title = point.title;

  el.addEventListener("mouseenter", () => {
    el.style.outline = `3px solid ${point.color}`;
    el.style.outlineOffset = "2px";
  });
  el.addEventListener("mouseleave", () => {
    el.style.outline = "none";
  });

  return el;
}

function formatLegendDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Custom MapLibre control so "Fit" sits with the zoom controls (top-right on
// the map), not among the category-filter pills.
class FitControl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  constructor(private onFit: () => void) {}
  onAdd(): HTMLElement {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Fit all to view";
    btn.setAttribute("aria-label", "Fit all to view");
    btn.textContent = "⤢";
    btn.style.fontSize = "16px";
    btn.addEventListener("click", () => this.onFit());
    div.appendChild(btn);
    this.container = div;
    return div;
  }
  onRemove(): void {
    this.container?.remove();
    this.container = null;
  }
}

interface TripMapProps {
  items: ItineraryItem[];
  days: DayRoute[];
  drives: DriveRoute[];
  selectedItemId: string | null;
  onItemSelect: (itemId: string | null) => void;
}

export function TripMap({ items, days, drives, selectedItemId, onItemSelect }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const routeSourceIds = useRef<string[]>([]);
  const activePopupRef = useRef<maplibregl.Popup | null>(null);
  // Stable refs so the one-time init effect can call the latest callbacks
  // without re-creating the map.
  const fitAllRef = useRef<() => void>(() => {});
  const onSelectRef = useRef(onItemSelect);
  useEffect(() => {
    onSelectRef.current = onItemSelect;
  }, [onItemSelect]);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [iconOverrides, setIconOverrides] = useState<Record<string, string>>(loadIconOverrides);
  const [showIconEditor, setShowIconEditor] = useState(false);
  // True once a map instance exists; gates marker/route effects so they re-run
  // against a freshly-built map (StrictMode mount→unmount→remount).
  const [mapReady, setMapReady] = useState(false);

  const getIcon = useCallback(
    (cat: string) =>
      iconOverrides[cat] ?? CATEGORY_META[cat]?.icon ?? CATEGORY_META.other.icon,
    [iconOverrides]
  );

  const setIconOverride = useCallback((cat: string, emoji: string) => {
    setIconOverrides((prev) => {
      const next = { ...prev };
      if (emoji.trim()) next[cat] = emoji.trim();
      else delete next[cat];
      try {
        localStorage.setItem(ICON_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / private-mode errors */
      }
      return next;
    });
  }, []);

  const dates = useMemo(
    () => [...new Set(items.map((i) => i.date).filter(Boolean) as string[])].sort(),
    [items]
  );

  const getDayColor = useCallback(
    (date: string | null) => {
      if (!date) return "#6b7280";
      const idx = dates.indexOf(date);
      return idx >= 0 ? DAY_COLORS[idx % DAY_COLORS.length] : "#6b7280";
    },
    [dates]
  );

  // Markers for non-drive items only — drives are drawn as lines (no start/end
  // icons), per the "a line is enough" requirement.
  const markerPoints: MapMarkerPoint[] = useMemo(() => {
    const points: MapMarkerPoint[] = [];
    for (const item of items) {
      if (item.category === "drive") continue;
      if (hiddenCategories.has(item.category)) continue;
      if (item.destinationLat == null || item.destinationLng == null) continue;
      points.push({
        key: item.id,
        itemId: item.id,
        lat: item.destinationLat,
        lng: item.destinationLng,
        icon: getIcon(item.category),
        color: getDayColor(item.date),
        title: item.title,
        label: item.destinationName ?? item.title,
        date: item.date,
        size: 32,
        offset: [0, 0],
      });
    }

    // Fan out markers that land on the same coordinate.
    const byCoord = new Map<string, MapMarkerPoint[]>();
    for (const p of points) {
      const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
      const list = byCoord.get(k) ?? [];
      list.push(p);
      byCoord.set(k, list);
    }
    for (const group of byCoord.values()) {
      if (group.length < 2) continue;
      const radius = 12;
      group.forEach((p, i) => {
        const angle = (2 * Math.PI * i) / group.length;
        p.offset = [
          Math.round(Math.cos(angle) * radius),
          Math.round(Math.sin(angle) * radius),
        ];
      });
    }

    return points;
  }, [items, hiddenCategories, getDayColor, getIcon]);

  // All coordinates worth fitting into view (markers + drive endpoints).
  const fitCoords: [number, number][] = useMemo(() => {
    const coords: [number, number][] = [];
    for (const item of items) {
      if (hiddenCategories.has(item.category)) continue;
      if (item.category === "drive") {
        if (item.originLat != null && item.originLng != null)
          coords.push([item.originLng, item.originLat]);
        if (item.destinationLat != null && item.destinationLng != null)
          coords.push([item.destinationLng, item.destinationLat]);
      } else if (item.destinationLat != null && item.destinationLng != null) {
        coords.push([item.destinationLng, item.destinationLat]);
      }
    }
    return coords;
  }, [items, hiddenCategories]);

  const coordSignature = useMemo(
    () => fitCoords.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).sort().join("|"),
    [fitCoords]
  );

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || fitCoords.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const c of fitCoords) bounds.extend(c);
    map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 500 });
  }, [fitCoords]);
  useEffect(() => {
    fitAllRef.current = fitAll;
  }, [fitAll]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getTileStyle(),
      center: [-98.5, 39.8],
      zoom: 3,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new FitControl(() => fitAllRef.current()), "top-right");
    // Trackpad two-finger scroll produces many tiny deltas, so the default
    // trackpad zoom rate (1/100) feels sluggish — speed it up. Mouse wheel
    // (setWheelZoomRate, 1/450) already feels good, so leave it.
    map.scrollZoom.setZoomRate(1 / 45);
    mapRef.current = map;

    // Gate readiness on the map's 'load' event (style fully ready). Gating on
    // construction caused drive routes to vanish on hide/show: on remount the
    // cached style finished loading before the route effect attached its
    // 'style.load' listener, so the draw never fired.
    const onLoad = () => setMapReady(true);
    map.on("load", onLoad);

    // Clicking empty map (not a marker) clears the selection — keeps the table
    // row in sync when you click away from a marker.
    const onBgClick = () => onSelectRef.current(null);
    map.on("click", onBgClick);

    // Test hook: lets e2e introspect layers (drive routes are canvas-drawn,
    // not DOM, so they can't be asserted via selectors).
    (window as unknown as { __waypointMap?: maplibregl.Map }).__waypointMap = map;

    return () => {
      map.off("load", onLoad);
      map.off("click", onBgClick);
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      routeSourceIds.current = [];
      setMapReady(false);
      delete (window as unknown as { __waypointMap?: maplibregl.Map }).__waypointMap;
    };
  }, []);

  // Sync markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const activeKeys = new Set(markerPoints.map((p) => p.key));

    for (const [key, marker] of markersRef.current) {
      if (!activeKeys.has(key)) {
        marker.remove();
        markersRef.current.delete(key);
      }
    }

    for (const point of markerPoints) {
      if (markersRef.current.has(point.key)) {
        const marker = markersRef.current.get(point.key)!;
        marker.setLngLat([point.lng, point.lat]);
        marker.setOffset(point.offset);
        // Icon may have changed via override — refresh the element content.
        const el = marker.getElement();
        if (el.textContent !== point.icon) el.textContent = point.icon;
        continue;
      }

      const el = createMarkerElement(point);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onItemSelect(point.itemId);
      });

      const marker = new maplibregl.Marker({ element: el, offset: point.offset })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
      markersRef.current.set(point.key, marker);
    }
  }, [markerPoints, onItemSelect, mapReady]);

  // Fit bounds only when the set of coordinates actually changes.
  useEffect(() => {
    if (!mapReady) return;
    fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordSignature, mapReady]);

  // Draw route polylines: drive routes (solid, day-colored) + day connectors
  // (faint gray dashed).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const draw = () => {
      for (const id of routeSourceIds.current) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      routeSourceIds.current = [];

      // Drive routes — origin → destination, routed via OSRM (falls back to a
      // straight line only if routing failed).
      if (!hiddenCategories.has("drive")) {
        for (const drive of drives) {
          const item = items.find((i) => i.id === drive.itemId);
          if (!item) continue;
          let geometry = drive.geometry;
          if (!geometry) {
            if (
              item.originLng == null ||
              item.originLat == null ||
              item.destinationLng == null ||
              item.destinationLat == null
            )
              continue;
            geometry = {
              type: "LineString",
              coordinates: [
                [item.originLng, item.originLat],
                [item.destinationLng, item.destinationLat],
              ],
            };
          }

          const sourceId = `drive-${drive.itemId}`;
          map.addSource(sourceId, {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry },
          });
          map.addLayer({
            id: sourceId,
            type: "line",
            source: sourceId,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": getDayColor(drive.date),
              "line-width": 4,
              "line-opacity": 0.9,
            },
          });
          routeSourceIds.current.push(sourceId);
        }
      }

      // Day-sequence connectors between consecutive stops.
      for (const day of days) {
        for (let i = 0; i < day.legs.length; i++) {
          const leg = day.legs[i];
          let geom = leg.geometry;
          if (!geom) {
            const fromItem = items.find((item) => item.id === leg.fromItemId);
            const toItem = items.find((item) => item.id === leg.toItemId);
            if (
              fromItem?.destinationLng == null ||
              fromItem?.destinationLat == null ||
              toItem?.destinationLng == null ||
              toItem?.destinationLat == null
            )
              continue;
            geom = {
              type: "LineString",
              coordinates: [
                [fromItem.destinationLng, fromItem.destinationLat],
                [toItem.destinationLng, toItem.destinationLat],
              ],
            };
          }

          const sourceId = `conn-${day.date}-${i}`;
          map.addSource(sourceId, {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: geom },
          });
          map.addLayer({
            id: sourceId,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": CONNECTOR_COLOR,
              "line-width": 1.5,
              "line-opacity": 0.55,
              "line-dasharray": [2, 2],
            },
          });
          routeSourceIds.current.push(sourceId);
        }
      }
    };

    // mapReady fires on the map's 'load' event, so the style is ready here —
    // but guard anyway in case a later style swap is mid-flight.
    if (map.isStyleLoaded()) {
      draw();
    } else {
      map.once("style.load", draw);
      return () => {
        map.off("style.load", draw);
      };
    }
  }, [days, drives, items, hiddenCategories, getDayColor, mapReady]);

  // Popup for the selected item — derived from the item itself (works for
  // drives, which no longer have markers).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (activePopupRef.current) {
      activePopupRef.current.remove();
      activePopupRef.current = null;
    }

    if (!selectedItemId) return;
    const item = items.find((i) => i.id === selectedItemId);
    if (!item) return;

    let anchor: [number, number] | null = null;

    if (item.category === "drive") {
      const hasOrigin = item.originLat != null && item.originLng != null;
      const hasDest = item.destinationLat != null && item.destinationLng != null;
      if (hasOrigin && hasDest) {
        const bounds = new maplibregl.LngLatBounds();
        bounds.extend([item.originLng!, item.originLat!]);
        bounds.extend([item.destinationLng!, item.destinationLat!]);
        map.fitBounds(bounds, { padding: 80, maxZoom: 11, duration: 500 });
        anchor = [item.destinationLng!, item.destinationLat!];
      } else if (hasDest) {
        anchor = [item.destinationLng!, item.destinationLat!];
      } else if (hasOrigin) {
        anchor = [item.originLng!, item.originLat!];
      }
    } else if (item.destinationLat != null && item.destinationLng != null) {
      anchor = [item.destinationLng, item.destinationLat];
      map.flyTo({ center: anchor, zoom: Math.max(map.getZoom(), 10), duration: 500 });
    }

    if (!anchor) return;

    const subtitle =
      item.category === "drive"
        ? `${item.originName ?? "?"} → ${item.destinationName ?? "?"}`
        : item.destinationName ?? "";

    const popup = new maplibregl.Popup({ offset: 20, closeOnClick: true, closeButton: true })
      .setLngLat(anchor)
      .setHTML(
        `<div style="font-size:13px;max-width:220px">
          <strong>${item.title}</strong>
          ${subtitle ? `<br/><span style="color:#666">${subtitle}</span>` : ""}
          ${item.date ? `<br/><span style="color:#888">${item.date}</span>` : ""}
        </div>`
      )
      .addTo(map);

    activePopupRef.current = popup;
    popup.on("close", () => {
      if (activePopupRef.current === popup) activePopupRef.current = null;
    });
  }, [selectedItemId, items, mapReady]);

  const presentCategories = [...new Set(items.map((i) => i.category))];
  const hasDrives = presentCategories.includes("drive");

  const toggleCategory = (cat: string) => {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="relative flex flex-col h-full">
      {/* Controls: fit, icon settings, category filter pills */}
      <div className="shrink-0 flex flex-wrap items-center gap-1 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <button
          onClick={() => setShowIconEditor((s) => !s)}
          className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
            showIconEditor
              ? "border-zinc-400 dark:border-zinc-500 bg-zinc-100 dark:bg-zinc-800"
              : "border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          } text-zinc-700 dark:text-zinc-300`}
          title="Customize category icons"
        >
          ⚙ Icons
        </button>
        {presentCategories.length > 1 &&
          presentCategories.map((cat) => {
            const label = CATEGORY_META[cat]?.label ?? cat;
            const hidden = hiddenCategories.has(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  hidden
                    ? "border-zinc-200 dark:border-zinc-700 text-zinc-400 bg-zinc-50 dark:bg-zinc-800"
                    : "border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900"
                }`}
              >
                {getIcon(cat)} {label}
              </button>
            );
          })}
      </div>

      {/* Icon editor popover */}
      {showIconEditor && (
        <div className="absolute top-12 left-3 z-20 w-60 rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-lg p-2 space-y-1.5">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 px-1">
            Type an emoji to change a category icon
          </div>
          {presentCategories.map((cat) => (
            <div key={cat} className="flex items-center gap-2 px-1">
              <span className="text-base w-6 text-center">{getIcon(cat)}</span>
              <span className="text-xs text-zinc-600 dark:text-zinc-300 flex-1">
                {CATEGORY_META[cat]?.label ?? cat}
              </span>
              <input
                value={iconOverrides[cat] ?? ""}
                onChange={(e) => setIconOverride(cat, e.target.value)}
                placeholder={CATEGORY_META[cat]?.icon ?? ""}
                maxLength={4}
                className="w-12 text-center text-sm bg-transparent border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 outline-none focus:border-zinc-500"
              />
            </div>
          ))}
        </div>
      )}

      {/* Map container — plain flex-1 element so MapLibre measures a real height. */}
      <div ref={containerRef} className="flex-1 min-h-0" />

      {/* Legend */}
      {fitCoords.length > 0 && (
        <div className="absolute bottom-2 left-2 z-10 max-h-[45%] overflow-y-auto rounded-md bg-white/90 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-700 px-2 py-1.5 text-[10px] text-zinc-600 dark:text-zinc-300 shadow-sm space-y-1">
          {dates.map((d, i) => (
            <div key={d} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: DAY_COLORS[i % DAY_COLORS.length] }}
              />
              <span>
                Day {i + 1} · {formatLegendDate(d)}
              </span>
            </div>
          ))}
          {hasDrives && (
            <div className="pt-1 mt-1 border-t border-zinc-200 dark:border-zinc-700 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-5 h-0.5 bg-zinc-500" />
                <span>Drive route</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-5 border-t border-dashed border-zinc-400" />
                <span>Connection</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
