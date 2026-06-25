/**
 * Shared framer-motion vocabulary (Phase 4.5 motion pass).
 *
 * These presets are the JS counterpart to the CSS tokens/keyframes in
 * `globals.css`. Keep the numbers in sync with the `--motion-*` / `--ease-*`
 * custom properties there — this file is the single source of truth for the
 * framer layer, that block is the source of truth for the CSS layer.
 *
 * Reduced-motion is handled globally by <MotionConfig reducedMotion="user">
 * in providers.tsx, so individual variants don't need to branch on it.
 */
import type { Transition, Variants } from "framer-motion";

// Durations in seconds (framer uses seconds; CSS uses ms — same values).
export const DURATION = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
} as const;

// Cubic-bezier easings, mirroring the CSS --ease-* tokens.
export const EASE = {
  standard: [0.2, 0, 0, 1],
  entrance: [0.05, 0.7, 0.1, 1],
  exit: [0.3, 0, 0.8, 0.15],
} as const;

export const transitionBase: Transition = {
  duration: DURATION.base,
  ease: EASE.standard,
};

/** Panel expand/collapse: animate height:auto + opacity (e.g. collapsible panels). */
export const panelExpand: Variants = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: "auto",
    opacity: 1,
    transition: { height: { duration: DURATION.base, ease: EASE.entrance }, opacity: { duration: DURATION.base } },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: { height: { duration: DURATION.fast, ease: EASE.exit }, opacity: { duration: DURATION.fast } },
  },
};

/** A diff/preview card entering and leaving (fade + slight rise). */
export const cardEnterExit: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.entrance } },
  exit: { opacity: 0, y: -4, transition: { duration: DURATION.fast, ease: EASE.exit } },
};

/** Parent that staggers its children's entrance (use with cardEnterExit items). */
export const staggerChildren: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
  exit: {},
};

/**
 * Table-row enter/exit. OPACITY ONLY — never height, never `transform`/`y`, and
 * never `layout`. The <tr> already carries dnd-kit's transform/transition inline
 * for the drag-shuffle; if framer animated `y` it would take permanent ownership
 * of `transform` and clobber dnd-kit's drag transforms. Reorder stays dnd-kit's
 * job; framer only fades rows in on add and out on delete.
 */
export const rowEnterExit: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.base, ease: EASE.entrance } },
  exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE.exit } },
};
