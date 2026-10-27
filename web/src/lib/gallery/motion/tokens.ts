/**
 * Gallery motion tokens. `motion.css` mirrors these as custom properties, and
 * `tokens.spec.ts` keeps the two in sync. Design: specs/2026-10-23-web-motion-language-design.md.
 */

/** Durations (ms) for eased motion. Springs carry their own duration below. */
export const duration = {
  /** Press-in, hover tints: feedback the hand should feel immediately. */
  instant: 90,
  /** Small things appearing: tooltips, menus, chips. */
  quick: 160,
  /** Panels and overlays fading. */
  base: 240,
  /** Large surfaces moving: sheets, sidebars. Nothing blocking runs longer. */
  slow: 400,
} as const;

/** Cubic-bezier curves for motion that should not overshoot. */
export const ease = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  /** Fast start, long settle; the filter panel already uses it (SETTLE_EASE). */
  settle: 'cubic-bezier(0.22, 1, 0.36, 1)',
  exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
} as const;

export interface SpringToken {
  /** A damped-spring step response sampled into a CSS `linear()` easing. */
  easing: string;
  /** The time the spring takes to settle, in ms. */
  duration: number;
}

/**
 * Springs, generated from stiffness/damping (mass 1). Regenerate with the script in the design doc.
 * Overshoot is the peak past the target: keep everyday motion under ~8%.
 */
export const spring = {
  /** stiffness 300, damping 22: 7.6% overshoot. Releases, entrances, selection. */
  gentle: {
    easing:
      'linear(0, 0.07, 0.23, 0.424, 0.614, 0.776, 0.901, 0.989, 1.042, 1.069, 1.076, 1.07, 1.058, 1.043, 1.029, 1.017, 1.007, 1.001, 0.997, 0.995, 0.994, 0.995, 0.996, 0.997, 1)',
    duration: 560,
  },
  /** stiffness 600, damping 34: 4.8% overshoot. Toggles and switches. */
  snappy: {
    easing:
      'linear(0, 0.081, 0.26, 0.465, 0.653, 0.806, 0.916, 0.988, 1.028, 1.045, 1.048, 1.042, 1.033, 1.023, 1.015, 1.008, 1.003, 1, 0.998, 0.998, 1)',
    duration: 360,
  },
  /** stiffness 380, damping 16: 24% overshoot. Small "pops" only: a check landing, a heart. */
  bouncy: {
    easing:
      'linear(0, 0.124, 0.405, 0.723, 0.991, 1.165, 1.238, 1.23, 1.172, 1.095, 1.024, 0.973, 0.946, 0.941, 0.952, 0.97, 0.988, 1.003, 1.011, 1.014, 1.013, 1.009, 1.004, 1, 0.998, 0.997, 0.997, 0.997, 1)',
    duration: 780,
  },
} as const satisfies Record<string, SpringToken>;

let linearSupported: boolean | undefined;

/** A spring's easing, or the settle curve on browsers without CSS `linear()` (WAAPI throws on it). */
export const springEasing = (token: SpringToken): string => {
  linearSupported ??= typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', 'linear(0, 1)');
  return linearSupported ? token.easing : ease.settle;
};

/** Defensive about `matchMedia`: some environments (and test stubs) return nothing from it. */
export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && !!matchMedia('(prefers-reduced-motion: reduce)')?.matches;
