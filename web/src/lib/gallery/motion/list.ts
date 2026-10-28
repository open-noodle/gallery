import { quintOut } from 'svelte/easing';
import { duration, prefersReducedMotion } from '$lib/gallery/motion/tokens';

/** Svelte `animate:` / `Tween` options: an easing function, not a CSS curve. */
export interface ListMotion {
  duration: number;
  easing?: (t: number) => number;
}

/**
 * `animate:flip` for a grid or list that loses items: the rest slide into the gap on the settle
 * curve (quintOut is the JS twin of `ease.settle`). Instant under reduced motion.
 */
export const flipMotion = (): ListMotion =>
  prefersReducedMotion() ? { duration: 0 } : { duration: duration.slow, easing: quintOut };

/** A `Tween` for a figure that changes (bytes freed, counts): it counts to the new value. */
export const countMotion = (): ListMotion =>
  prefersReducedMotion() ? { duration: 0 } : { duration: duration.slow * 2, easing: quintOut };

/** `animation-delay` for the `index`th item of a staggered reveal; the whole stagger stays within `maxTotalMs`. */
export const staggerDelay = (index: number, stepMs = 40, maxTotalMs = 360): string =>
  prefersReducedMotion() ? '0ms' : `${Math.min(index * stepMs, maxTotalMs)}ms`;

/**
 * Keyframes for content arriving from the direction of travel: 1 (forward, a later day or the next photo)
 * comes in from the right, -1 from the left. Empty (no animation) for 0 and under reduced motion.
 */
export const slideFrom = (direction: -1 | 0 | 1, distancePx = 12): Keyframe[] =>
  prefersReducedMotion() || direction === 0
    ? []
    : [
        { translate: `${direction * distancePx}px 0`, opacity: 0 },
        { translate: '0 0', opacity: 1 },
      ];
