"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Supercluster from "supercluster";
import type { ItineraryItem } from "@/db/types";
import type { DriveRoute } from "@/app/api/trips/[tripId]/routes/route";
import { clusteredBoundsCoords, type Pt } from "@/lib/trip-state/anchor";
import { computeRouteSegments } from "@/lib/trip-state/route-offsets";
import { isUntitled, UNTITLED_LABEL } from "@/lib/format";

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

// Point properties carried through Supercluster onto each leaf feature.
interface PointProps {
  itemId: string;
  icon: string;
  color: string;
  title: string;
  label: string;
  priority: number; // itinerary order — lower wins a label-collision tie
}

const MARKER_SIZE = 22;

// Shared label style — a small white-haloed caption under a marker, legible over
// any basemap. Used by both point markers and cluster bubbles.
function styleLabel(el: HTMLDivElement): void {
  el.style.cssText = `
    position: absolute; top: calc(100% + 1px); left: 50%;
    transform: translateX(-50%); white-space: nowrap; pointer-events: none;
    font-size: 11px; line-height: 1.1; font-weight: 600; color: #27272a;
    text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff;
  `;
}

// A point marker: emoji in a white circle with a day-colored ring, plus a
// place-name label underneath (collision-managed by applyLabelCollision).
function createPointElement(p: PointProps): { el: HTMLDivElement; labelEl: HTMLDivElement } {
  const el = document.createElement("div");
  const s = MARKER_SIZE;
  // NOTE: do NOT set `position` here — MapLibre's `.maplibregl-marker` class sets
  // `position: absolute` to place the marker, and an inline `position: relative`
  // would override it and make every marker float to its in-flow position. The
  // absolute marker is already a containing block for the absolute label child.
  el.style.cssText = `
    width: ${s}px; height: ${s}px; border-radius: 50%;
    background: white; border: 1.5px solid ${p.color};
    display: flex; align-items: center; justify-content: center;
    font-size: ${Math.round(s * 0.5)}px; cursor: pointer;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  `;

  const iconSpan = document.createElement("span");
  iconSpan.className = "waypoint-icon";
  iconSpan.textContent = p.icon;
  el.appendChild(iconSpan);

  const labelEl = document.createElement("div");
  labelEl.className = "waypoint-label";
  labelEl.textContent = p.label;
  styleLabel(labelEl);
  el.appendChild(labelEl);

  el.addEventListener("mouseenter", () => {
    el.style.outline = `1.5px solid ${p.color}`;
    el.style.outlineOffset = "2px";
    labelEl.style.visibility = "visible"; // hovered marker always shows its name
    labelEl.style.zIndex = "1";
  });
  el.addEventListener("mouseleave", () => {
    el.style.outline = "none";
  });

  return { el, labelEl };
}

// A cluster bubble: neutral zinc circle with the member count, plus a label
// naming one member + "+N more" (matches the Apple-Maps reference).
function createClusterElement(count: number, label: string): HTMLDivElement {
  const s = Math.round(Math.min(42, 24 + count * 1.6));
  const el = document.createElement("div");
  // No inline `position` — see createPointElement (MapLibre needs absolute).
  el.style.cssText = `
    width: ${s}px; height: ${s}px; border-radius: 50%;
    background: #3f3f46; border: 2px solid white; color: white;
    display: flex; align-items: center; justify-content: center;
    font-size: ${Math.round(s * 0.42)}px; font-weight: 700; cursor: pointer;
    box-shadow: 0 2px 5px rgba(0,0,0,0.35);
  `;
  const countSpan = document.createElement("span");
  countSpan.textContent = String(count);
  el.appendChild(countSpan);

  const labelEl = document.createElement("div");
  labelEl.textContent = label;
  styleLabel(labelEl);
  el.appendChild(labelEl);

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
  drives: DriveRoute[];
  selectedItemId: string | null;
  onItemSelect: (itemId: string | null) => void;
}

interface MarkerPoint {
  itemId: string;
  lat: number;
  lng: number;
  props: PointProps;
}

export function TripMap({ items, drives, selectedItemId, onItemSelect }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // All rendered markers (points + clusters), keyed `point-<id>` / `cluster-<id>`.
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  // Per-shown-point label metadata, rebuilt each render; drives label collision.
  const pointMetaRef = useRef<Map<string, { labelEl: HTMLDivElement; priority: number }>>(
    new Map()
  );
  const indexRef = useRef<Supercluster<PointProps> | null>(null);
  const routeSourceIds = useRef<string[]>([]);
  const activePopupRef = useRef<maplibregl.Popup | null>(null);
  // Stable refs so the one-time init effect can call the latest callbacks
  // without re-creating the map.
  const fitAllRef = useRef<() => void>(() => {});
  const renderClustersRef = useRef<() => void>(() => {});
  const onSelectRef = useRef(onItemSelect);
  const selectedRef = useRef(selectedItemId);
  useEffect(() => {
    onSelectRef.current = onItemSelect;
  }, [onItemSelect]);
  useEffect(() => {
    selectedRef.current = selectedItemId;
  }, [selectedItemId]);
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
  const markerPoints: MarkerPoint[] = useMemo(() => {
    const points: MarkerPoint[] = [];
    let priority = 0;
    for (const item of items) {
      if (item.category === "drive") continue;
      if (hiddenCategories.has(item.category)) continue;
      if (item.destinationLat == null || item.destinationLng == null) continue;
      points.push({
        itemId: item.id,
        lat: item.destinationLat,
        lng: item.destinationLng,
        props: {
          itemId: item.id,
          icon: getIcon(item.category),
          color: getDayColor(item.date),
          title: item.title,
          label: item.destinationName ?? item.title,
          priority: priority++,
        },
      });
    }
    return points;
  }, [items, hiddenCategories, getDayColor, getIcon]);

  // All coordinates worth fitting into view (markers + drive endpoints), then
  // trimmed to the trip's main cluster so a long home→destination leg doesn't
  // zoom the whole map out (#2 smart fit-bounds).
  const fitCoords: [number, number][] = useMemo(() => {
    const pts: Pt[] = [];
    for (const item of items) {
      if (hiddenCategories.has(item.category)) continue;
      if (item.category === "drive") {
        if (item.originLat != null && item.originLng != null)
          pts.push({ lat: item.originLat, lng: item.originLng });
        if (item.destinationLat != null && item.destinationLng != null)
          pts.push({ lat: item.destinationLat, lng: item.destinationLng });
      } else if (item.destinationLat != null && item.destinationLng != null) {
        pts.push({ lat: item.destinationLat, lng: item.destinationLng });
      }
    }
    return clusteredBoundsCoords(pts).map((p) => [p.lng, p.lat] as [number, number]);
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

  // Hide point labels that would overlap a higher-priority label. Clusters keep
  // their label; the selected (and hovered) marker's label always wins. Uses
  // `visibility` (not `display`) so hidden labels still report a layout rect we
  // can measure on the next pass.
  const applyLabelCollision = useCallback(() => {
    const sel = selectedRef.current;
    const entries = [...pointMetaRef.current.entries()].sort((a, b) => {
      const as = a[0] === `point-${sel}` ? 0 : 1;
      const bs = b[0] === `point-${sel}` ? 0 : 1;
      if (as !== bs) return as - bs;
      return a[1].priority - b[1].priority;
    });
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    for (const [, meta] of entries) {
      const rect = meta.labelEl.getBoundingClientRect();
      const box = { l: rect.left, r: rect.right, t: rect.top, b: rect.bottom };
      const overlaps = placed.some(
        (q) => !(box.r < q.l || box.l > q.r || box.b < q.t || box.t > q.b)
      );
      if (overlaps) {
        meta.labelEl.style.visibility = "hidden";
      } else {
        meta.labelEl.style.visibility = "visible";
        placed.push(box);
      }
    }
  }, []);

  // Render the current view's clusters/points as DOM markers, diffing against
  // what's already on the map. Stable (uses refs) so the init effect can bind it
  // to map move/zoom without re-creating the map.
  const renderClusters = useCallback(() => {
    const map = mapRef.current;
    const index = indexRef.current;
    if (!map || !index) return;

    const b = map.getBounds();
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];
    const zoom = Math.round(map.getZoom());
    const clusters = index.getClusters(bbox, zoom);

    const activeKeys = new Set<string>();
    pointMetaRef.current.clear();

    for (const c of clusters) {
      const [lng, lat] = c.geometry.coordinates;
      const cp = c.properties as PointProps & {
        cluster?: boolean;
        cluster_id?: number;
        point_count?: number;
      };

      if (cp.cluster) {
        const key = `cluster-${cp.cluster_id}`;
        activeKeys.add(key);
        if (!markersRef.current.has(key)) {
          const count = cp.point_count ?? 0;
          const leaves = index.getLeaves(cp.cluster_id!, 1);
          const first = (leaves[0]?.properties as PointProps | undefined)?.label ?? "";
          const label = count > 1 ? `${first} +${count - 1} more` : first;
          const el = createClusterElement(count, label);
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            try {
              const ez = index.getClusterExpansionZoom(cp.cluster_id!);
              map.easeTo({ center: [lng, lat], zoom: ez, duration: 400 });
            } catch {
              map.easeTo({ center: [lng, lat], zoom: zoom + 2, duration: 400 });
            }
          });
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([lng, lat])
            .addTo(map);
          markersRef.current.set(key, marker);
        } else {
          markersRef.current.get(key)!.setLngLat([lng, lat]);
        }
      } else {
        const itemId = cp.itemId;
        const key = `point-${itemId}`;
        activeKeys.add(key);
        let marker = markersRef.current.get(key);
        if (!marker) {
          const { el } = createPointElement(cp);
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            onSelectRef.current(itemId);
          });
          marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
          markersRef.current.set(key, marker);
        } else {
          marker.setLngLat([lng, lat]);
          const el = marker.getElement();
          const iconSpan = el.querySelector(".waypoint-icon");
          if (iconSpan && iconSpan.textContent !== cp.icon) iconSpan.textContent = cp.icon;
        }
        const labelEl = marker.getElement().querySelector(".waypoint-label") as HTMLDivElement;
        if (labelEl) pointMetaRef.current.set(key, { labelEl, priority: cp.priority });
      }
    }

    for (const [key, marker] of markersRef.current) {
      if (!activeKeys.has(key)) {
        marker.remove();
        markersRef.current.delete(key);
      }
    }

    applyLabelCollision();
  }, [applyLabelCollision]);
  useEffect(() => {
    renderClustersRef.current = renderClusters;
  }, [renderClusters]);

  // (Re)build the Supercluster index whenever the marker set changes, then
  // render. Rebuilding also picks up icon-override changes (baked into props).
  useEffect(() => {
    const index = new Supercluster<PointProps>({ radius: 60, maxZoom: 16 });
    index.load(
      markerPoints.map((p) => ({
        type: "Feature" as const,
        properties: p.props,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      }))
    );
    indexRef.current = index;
    if (mapReady) renderClusters();
  }, [markerPoints, mapReady, renderClusters]);

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
    // trackpad zoom rate (1/100) feels sluggish — speed it up. The mouse wheel
    // felt over-sensitive at the default (1/450), so slow it a touch (1/650).
    map.scrollZoom.setZoomRate(1 / 45);
    map.scrollZoom.setWheelZoomRate(1 / 650);
    mapRef.current = map;

    // Re-cluster/re-collide on every settle (pan brings new points into view;
    // zoom merges/splits clusters).
    const onMove = () => renderClustersRef.current();
    map.on("moveend", onMove);
    map.on("zoomend", onMove);

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
      map.off("moveend", onMove);
      map.off("zoomend", onMove);
      map.off("load", onLoad);
      map.off("click", onBgClick);
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      pointMetaRef.current.clear();
      routeSourceIds.current = [];
      setMapReady(false);
      delete (window as unknown as { __waypointMap?: maplibregl.Map }).__waypointMap;
    };
  }, []);

  // Fit bounds only when the set of coordinates actually changes.
  useEffect(() => {
    if (!mapReady) return;
    fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordSignature, mapReady]);

  // Draw route polylines: drive routes (solid, day-colored, zoom-scaled width)
  // drawn from the PERSISTED routeGeometry on each drive item (instant on load,
  // no OSRM wait), and day connectors (faint gray dashed) built client-side as
  // straight lines between consecutive same-day stops.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const drivesById = new Map(drives.map((d) => [d.itemId, d]));

    const draw = () => {
      for (const id of routeSourceIds.current) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      routeSourceIds.current = [];

      // Drive routes — drawn only from real routed geometry (persisted on the item
      // or freshly routed by the routes query). A drive with no routed geometry yet
      // draws nothing rather than a misleading straight line.
      if (!hiddenCategories.has("drive")) {
        // Resolve every drive's geometry FIRST, so computeRouteSegments can split
        // each route into runs and offset only the stretches it shares with a
        // different day — overlapping roads fan into parallel lanes while the
        // unique stretches stay on the true road.
        const driveGeoms: { item: ItineraryItem; geometry: GeoJSON.LineString }[] = [];
        for (const item of items) {
          if (item.category !== "drive") continue;
          const geometry: GeoJSON.LineString | undefined =
            item.routeGeometry ?? drivesById.get(item.id)?.geometry;
          if (!geometry) continue;
          driveGeoms.push({ item, geometry });
        }

        const segsByItem = computeRouteSegments(
          driveGeoms.map(({ item, geometry }) => ({
            itemId: item.id,
            geometry,
            // Color bucket — only cross-day overlaps are fanned apart.
            day: item.date,
          })),
          3 // 3px lanes — tight parallels, small line-offset overshoot.
        );

        for (const { item } of driveGeoms) {
          const segments = segsByItem.get(item.id);
          if (!segments || segments.length === 0) continue;
          const sourceId = `drive-${item.id}`;
          map.addSource(sourceId, {
            type: "geojson",
            // One feature per offset-tagged run. `itemId` is carried so the
            // (upcoming) hover handler can identify the drive; `offset` drives the
            // per-feature line-offset below.
            data: {
              type: "FeatureCollection",
              features: segments.map((s) => ({
                type: "Feature" as const,
                properties: { itemId: item.id, offset: s.offset },
                geometry: { type: "LineString" as const, coordinates: s.coordinates },
              })),
            },
          });
          map.addLayer({
            id: sourceId,
            type: "line",
            source: sourceId,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": getDayColor(item.date),
              // Thin lines throughout — now that overlapping routes sit side-by-side
              // (line-offset), heavy strokes read as one fuzzy blob. Slim at every
              // zoom, only modestly thicker up close.
              "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1, 9, 1.8, 14, 2.5],
              "line-opacity": 0.9,
              // Per-segment lateral offset: 0 on unique stretches, fanned where
              // shared with another day. line-offset is data-driven in MapLibre.
              "line-offset": ["get", "offset"],
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
  }, [drives, items, hiddenCategories, getDayColor, mapReady]);

  // Popup for the selected item — derived from the item itself (works for
  // drives, which no longer have markers).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (activePopupRef.current) {
      activePopupRef.current.remove();
      activePopupRef.current = null;
    }

    // Re-evaluate label collision so the newly selected marker's label wins.
    applyLabelCollision();

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

    // Build the popup from DOM nodes (NOT setHTML): every user-entered value
    // (title, origin/destination names, date) is assigned via textContent, so
    // markup in a field can never be parsed as HTML — XSS is structurally
    // impossible here, no escaping to remember on each interpolation.
    const root = document.createElement("div");
    root.style.cssText = "font-size:13px;max-width:220px";

    // Title — muted italic "Untitled" placeholder when empty, else bold.
    const titleEl = document.createElement(isUntitled(item.title) ? "em" : "strong");
    if (isUntitled(item.title)) {
      titleEl.style.color = "#9ca3af";
      titleEl.textContent = UNTITLED_LABEL;
    } else {
      titleEl.textContent = item.title;
    }
    root.appendChild(titleEl);

    if (subtitle) {
      const sub = document.createElement("span");
      sub.style.color = "#666";
      sub.textContent = subtitle;
      root.appendChild(document.createElement("br"));
      root.appendChild(sub);
    }
    if (item.date) {
      const dateEl = document.createElement("span");
      dateEl.style.color = "#888";
      dateEl.textContent = item.date;
      root.appendChild(document.createElement("br"));
      root.appendChild(dateEl);
    }

    // focusAfterOpen:false — MapLibre otherwise moves focus to the popup's close
    // button when it opens (its default). This effect re-runs on every `items`
    // change, so editing a field on the SELECTED, located row re-opens the popup
    // and would yank focus out of the cell you're typing in (e.g. the Category
    // <select> snapping shut right after you picked a location). The popup still
    // shows; it just no longer steals focus.
    const popup = new maplibregl.Popup({
      offset: 20,
      closeOnClick: true,
      closeButton: true,
      focusAfterOpen: false,
    })
      .setLngLat(anchor)
      .setDOMContent(root)
      .addTo(map);

    activePopupRef.current = popup;
    popup.on("close", () => {
      if (activePopupRef.current === popup) activePopupRef.current = null;
    });
  }, [selectedItemId, items, mapReady, applyLabelCollision]);

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
            <div className="pt-1 mt-1 border-t border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-5 h-0.5 bg-zinc-500" />
                <span>Drive route</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
