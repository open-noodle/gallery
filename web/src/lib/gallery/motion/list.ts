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
