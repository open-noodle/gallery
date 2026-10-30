import { mdiHeart } from '@mdi/js';
import { lastPressPoint } from '$lib/gallery/motion/press';
import { duration, ease, prefersReducedMotion, spring, springEasing } from '$lib/gallery/motion/tokens';

/**
 * Small particle bursts for moments worth marking (favoriting, finishing something). Kept rare and
 * small on purpose: a burst on every click stops being a reward. The pieces fly under simple gravity
 * from where the user pressed, so the effect is tied to their action and to nothing else on screen.
 */
export type CelebrationKind = 'favorite' | 'success';

export interface Origin {
  x: number;
  y: number;
}

interface Piece {
  /** SVG path (24×24 viewBox), or undefined for a plain dot. */
  path?: string;
  color: string;
  size: number;
}

const HEART_COLORS = ['#ed79b5', '#fa2921', '#ff8fab', '#f06292'];
const SUCCESS_COLORS = ['#fa2921', '#ed79b5', '#ffb400', '#1e83f7', '#18c249'];

const PIECES: Record<CelebrationKind, { count: number; piece: (index: number) => Piece; spread: number }> = {
  favorite: {
    count: 12,
    spread: Math.PI * 2,
    piece: (index) => ({
      path: mdiHeart,
      color: HEART_COLORS[index % HEART_COLORS.length],
      size: 12 + (index % 3) * 3,
    }),
  },
  success: {
    count: 22,
    spread: Math.PI * 1.3,
    piece: (index) => ({ color: SUCCESS_COLORS[index % SUCCESS_COLORS.length], size: 6 + (index % 3) * 2 }),
  },
};

/** px/s² pulling pieces back down; low enough that a 650ms flight reads as a float, not a drop. */
const GRAVITY = 700;
const FLIGHT_MS = 850;
const STEPS = 10;

/** Where a piece is `t` seconds after launch. Exported for the spec. */
export const trajectory = (angle: number, speed: number, t: number) => ({
  x: Math.cos(angle) * speed * t,
  y: Math.sin(angle) * speed * t + 0.5 * GRAVITY * t * t,
});

const createLayer = () => {
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset.galleryCelebration = '';
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '9999',
    overflow: 'hidden',
  });
  document.body.append(layer);
  return layer;
};

const createPiece = ({ path, color, size }: Piece, origin: Origin) => {
  const element = document.createElement('div');
  Object.assign(element.style, {
    position: 'absolute',
    left: `${origin.x - size / 2}px`,
    top: `${origin.y - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    color,
  });
  if (path) {
    element.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="currentColor" d="${path}"/></svg>`;
  } else {
    Object.assign(element.style, { background: color, borderRadius: '9999px' });
  }
  return element;
};

/** A soft ring that expands from the origin: the "landing" the pieces fly out of. */
const ring = (layer: HTMLElement, origin: Origin, color: string) => {
  const size = 72;
  const element = document.createElement('div');
  Object.assign(element.style, {
    position: 'absolute',
    left: `${origin.x - size / 2}px`,
    top: `${origin.y - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '9999px',
    border: `2px solid ${color}`,
  });
  layer.append(element);
  return element.animate(
    [
      { scale: 0.2, opacity: 0.9 },
      { scale: 1, opacity: 0 },
    ],
    { duration: duration.slow, easing: ease.settle, fill: 'forwards' },
  ).finished;
};

const fly = (layer: HTMLElement, piece: Piece, origin: Origin, angle: number, speed: number) => {
  const element = createPiece(piece, origin);
  layer.append(element);
  const spin = (Math.random() - 0.5) * 120;
  const keyframes: Keyframe[] = Array.from({ length: STEPS + 1 }, (_, step) => {
    const progress = step / STEPS;
    const { x, y } = trajectory(angle, speed, (progress * FLIGHT_MS) / 1000);
    return {
      translate: `${x}px ${y}px`,
      rotate: `${spin * progress}deg`,
      opacity: progress < 0.6 ? 1 : 1 - (progress - 0.6) / 0.4,
      scale: step === 0 ? 0.3 : 1,
      offset: progress,
    };
  });
  return element.animate(keyframes, { duration: FLIGHT_MS, easing: 'linear', fill: 'forwards' }).finished;
};

/**
 * Bursts particles from `origin`, or from the user's last press when it was recent. Does nothing
 * without an origin (a keyboard shortcut has no point to burst from) or when reduced motion is on.
 */
export const celebrate = (kind: CelebrationKind, origin?: Origin): void => {
  const from = origin ?? lastPressPoint(1500);
  if (
    !from ||
    typeof document === 'undefined' ||
    typeof document.body.animate !== 'function' ||
    prefersReducedMotion()
  ) {
    return;
  }
  const config = PIECES[kind];
  const layer = createLayer();
  const flights: Promise<unknown>[] = [ring(layer, from, config.piece(0).color)];
  // Bursts aim upward: -90° is straight up in screen coordinates.
  const start = -Math.PI / 2 - config.spread / 2;
  for (let index = 0; index < config.count; index++) {
    const jitter = (Math.random() - 0.5) * (config.spread / config.count) * 0.6;
    const angle = start + (config.spread * (index + 0.5)) / config.count + jitter;
    const speed = 220 + Math.random() * 160;
    flights.push(fly(layer, config.piece(index), from, angle, speed));
  }
  void Promise.allSettled(flights).then(() => layer.remove());
};

/** Pops an element in: a check landing, a badge appearing. */
export const pop = (element: Element): void => {
  if (typeof element.animate !== 'function' || prefersReducedMotion()) {
    return;
  }
  element.animate([{ scale: 0.4 }, { scale: 1 }], {
    duration: spring.bouncy.duration,
    easing: springEasing(spring.bouncy),
    composite: 'add',
  });
};

/** Swells an element once to draw the eye to it: a button that just became useful. */
export const pulse = (element: Element): void => {
  if (typeof element.animate !== 'function' || prefersReducedMotion()) {
    return;
  }
  element.animate([{ scale: 1 }, { scale: 1.08 }, { scale: 1 }], {
    duration: spring.snappy.duration,
    easing: ease.standard,
    composite: 'add',
  });
};
