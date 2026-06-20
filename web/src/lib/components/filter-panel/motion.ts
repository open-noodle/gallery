import { quintOut } from 'svelte/easing';

/**
 * Decelerating "settle" curve for CSS transitions (panel width, hovers, chips).
 * NOTE: in Tailwind classes this must be written spaceless — `ease-[cubic-bezier(0.22,1,0.36,1)]` —
 * or the class won't compile. This spaced literal is only for JS/inline-style use.
 */
export const SETTLE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Shared animation durations (ms) so the panel feels consistent. */
export const PANEL_DURATION_MS = 420;
export const SECTION_DURATION_MS = 300;

export interface SlideMotion {
  duration: number;
  easing?: (t: number) => number;
}

/**
 * Svelte `slide` config for section expand/collapse. Collapses to an instant
 * (duration 0) when the user prefers reduced motion.
 */
export function slideMotion(reducedMotion: boolean): SlideMotion {
  return reducedMotion ? { duration: 0 } : { duration: SECTION_DURATION_MS, easing: quintOut };
}
