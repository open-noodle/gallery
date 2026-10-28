import { prefersReducedMotion } from '#lib/gallery/motion/tokens.ts';

/**
Cards tilt a few degrees toward the mouse, as if the picture were a physical print under the
cursor (the "follow the pointer" kind of motion). Only the picture that lifts on hover tilts; the
angle lives in two CSS variables that motion.css turns into a transform, so leaving the card lets
the transition settle it back flat.
*/
const GROUP = "[data-motion-lift-group], [data-testid='album-card']";
const PICTURE = "[data-motion-lift]:not([data-motion-lift='flat']), img.aspect-square";

/** Degrees at the card's edge. */
export const MAX_TILT = 7;

/** Tilt for a pointer at (x, y) inside a rect: the edge under the pointer sinks away, like pressing a print. */
export const tiltFor = (rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, x: number, y: number) => {
  const dx = Math.min(1, Math.max(0, (x - rect.left) / rect.width)) - 0.5;
  const dy = Math.min(1, Math.max(0, (y - rect.top) / rect.height)) - 0.5;
  return { rotateY: dx * 2 * MAX_TILT, rotateX: -dy * 2 * MAX_TILT };
};

let current: HTMLElement | undefined;
let frame = 0;

const reset = (picture: HTMLElement) => {
  picture.style.removeProperty('--gallery-tilt-x');
  picture.style.removeProperty('--gallery-tilt-y');
};

const onPointerMove = (event: PointerEvent) => {
  if (event.pointerType !== 'mouse' || !(event.target instanceof Element)) {
    return;
  }
  const group = event.target.closest<HTMLElement>(GROUP);
  const picture = group?.querySelector<HTMLElement>(PICTURE) ?? undefined;
  if (current && current !== picture) {
    reset(current);
    current = undefined;
  }
  if (!picture || prefersReducedMotion()) {
    return;
  }
  current = picture;
  const { clientX, clientY } = event;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const { rotateX, rotateY } = tiltFor(picture.getBoundingClientRect(), clientX, clientY);
    picture.style.setProperty('--gallery-tilt-x', `${rotateX.toFixed(2)}deg`);
    picture.style.setProperty('--gallery-tilt-y', `${rotateY.toFixed(2)}deg`);
  });
};

const onPointerLeave = () => {
  cancelAnimationFrame(frame);
  if (current) {
    reset(current);
    current = undefined;
  }
};

/** Installs the document listener. Returns the uninstaller. */
export const installTilt = (target: Document = document): (() => void) => {
  target.addEventListener('pointermove', onPointerMove, { passive: true });
  target.documentElement.addEventListener('pointerleave', onPointerLeave);
  return () => {
    onPointerLeave();
    target.removeEventListener('pointermove', onPointerMove);
    target.documentElement.removeEventListener('pointerleave', onPointerLeave);
  };
};
