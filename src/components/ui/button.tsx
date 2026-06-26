import { forwardRef } from "react";

/**
 * The single source of truth for action buttons across Waypoint.
 *
 * Why this exists: buttons used to be styled inline (~50+ instances) and the same
 * role rendered differently (amber vs dark-ink primaries, drifting padding/radius,
 * disabled primaries that looked like dead grey slabs). This component fixes
 * size/padding/radius/color/focus/disabled in one place.
 *
 * Decisions (see plan): primary = trail-amber (`--accent`); utility/toolbar = "quiet"
 * (muted bordered). The amber tokens flip for dark mode automatically (CSS var), so
 * `primary`/`danger` need no `dark:` classes; the zinc-based variants do, matching the
 * warm-remapped ramp in globals.css.
 *
 * NOT for stateful toggles (right-panel tabs, map filter pills, theme menu items) or
 * in-cell affordances (row ✕) — those carry selected-state semantics of their own.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "quiet"
  | "ghost"
  | "dashed"
  | "danger"
  | "danger-ghost";

export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium " +
  "transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40";

const SIZES: Record<ButtonSize, string> = {
  sm: "text-xs px-2.5 py-1",
  md: "text-sm px-3 py-1.5",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-110",
  secondary:
    "border border-zinc-300 dark:border-zinc-700 text-[var(--ink)] " +
    "hover:bg-zinc-100 dark:hover:bg-zinc-800",
  quiet:
    "border border-zinc-300 dark:border-zinc-700 text-zinc-500 " +
    "hover:text-zinc-700 dark:hover:text-zinc-300 " +
    "hover:border-zinc-400 dark:hover:border-zinc-500",
  ghost:
    "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 " +
    "hover:bg-zinc-100 dark:hover:bg-zinc-800",
  dashed:
    "border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 " +
    "hover:text-zinc-700 dark:hover:text-zinc-300 " +
    "hover:border-zinc-400 dark:hover:border-zinc-500",
  danger: "bg-red-600 text-white hover:bg-red-700",
  "danger-ghost":
    "text-red-500 hover:text-red-600 dark:hover:text-red-400",
};

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional leading glyph/SVG, rendered at a consistent muted tone + gap. */
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", icon, className, children, type, ...rest },
    ref
  ) {
    return (
      <button
        ref={ref}
        // Default to type="button" so a Button inside a <form> doesn't accidentally
        // submit; callers pass type="submit" explicitly where they mean it.
        type={type ?? "button"}
        className={cn(BASE, SIZES[size], VARIANTS[variant], className)}
        {...rest}
      >
        {icon != null && <span className="shrink-0 opacity-85">{icon}</span>}
        {children}
      </button>
    );
  }
);
