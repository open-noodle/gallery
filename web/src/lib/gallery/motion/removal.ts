import { lastPressPoint } from '$lib/gallery/motion/press';
import { duration, ease, prefersReducedMotion, spring, springEasing } from '$lib/gallery/motion/tokens';

/**
 * Photos leaving the view because the user sent them somewhere. Trashed or archived photos lift
 * slightly, then arc into the sidebar link for where they went (Trash, Archive), which gulps them.
 * With that link hidden (the asset viewer covers it, or the sidebar is collapsed), they arc into the
 * button the user pressed instead, and with neither they drop off the page under gravity.
 * A permanent delete has no destination, so the photos dissolve in place.
 *
 * Call it after the server confirmed the delete and before the photos leave the DOM: it copies what
 * is on screen into a fixed overlay, so the timeline can remove and reflow at once underneath.
 */
export type RemovalKind = 'trash' | 'archive' | 'restore' | 'delete';

/** The sidebar link each kind of removal flies into. */
const DESTINATION: Record<Exclude<RemovalKind, 'delete'>, string> = {
  trash: '/trash',
  archive: '/archive',
  restore: '/photos',
};

/**
 * `'visible'` animates every photo on screen, for actions that clear a whole page (empty trash,
 * restore all) and remove the photos later from a server event. Those originals are hidden at once
 * and stay hidden, so they do not reappear under their own animation.
 */
export type RemovalTarget = string[] | 'visible';

interface Point {
  x: number;
  y: number;
}

/** Photos animated individually; a bigger selection still shows its first few flying, the rest just go. */
const MAX_FLYING = 12;
/** Dissolving costs nothing to follow, so a cleared page can dissolve far more at once. */
const MAX_DISSOLVING = 48;
/** The whole stagger fits in this, however many photos go. */
const MAX_STAGGER_TOTAL_MS = 360;
const STAGGER_MS = 45;
const FLIGHT_MS = 640;
const STEPS = 16;
/** How far above the higher endpoint the arc peaks, px. */
const ARC_HEIGHT = 140;

/** A point on the quadratic Bézier from `from` to `to` through `control`. Exported for the spec. */
export const arcPoint = (from: Point, control: Point, to: Point, t: number): Point => {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
};

export const arcControl = (from: Point, to: Point): Point => ({
  x: (from.x + to.x) / 2,
  y: Math.min(from.y, to.y) - ARC_HEIGHT,
});

const center = (rect: DOMRect): Point => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

const isOnScreen = (rect: DOMRect) =>
  rect.width > 0 &&
  rect.height > 0 &&
  rect.bottom > 0 &&
  rect.right > 0 &&
  rect.top < innerHeight &&
  rect.left < innerWidth;

/** The element actually under `point`, or true when the browser can't tell us (assume visible). */
const isTopmostAt = (element: Element, point: Point) => {
  if (typeof document.elementFromPoint !== 'function') {
    return true;
  }
  const hit = document.elementFromPoint(point.x, point.y);
  return !hit || element.contains(hit);
};

/** The sidebar link to `path` when the user can see it. */
const findDestinationLink = (path: string): HTMLElement | undefined => {
  for (const link of document.querySelectorAll<HTMLElement>(`a[href$="${CSS.escape(path)}"]`)) {
    const rect = link.getBoundingClientRect();
    if (isOnScreen(rect) && isTopmostAt(link, center(rect))) {
      return link;
    }
  }
};

const isVisible = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return isOnScreen(rect) && isTopmostAt(element, center(rect));
};

/** What each removed asset looks like on screen right now: its thumbnail, or the open viewer's photo. */
const findSources = (target: RemovalTarget): HTMLElement[] => {
  if (target === 'visible') {
    return [...document.querySelectorAll<HTMLElement>('[data-asset]')].filter((element) => isVisible(element));
  }
  const ids = target;
  const sources: HTMLElement[] = [];
  for (const id of ids) {
    const thumbnail = document.querySelector<HTMLElement>(`[data-asset="${CSS.escape(id)}"]`);
    if (thumbnail && isVisible(thumbnail)) {
      sources.push(thumbnail);
    }
  }
  if (sources.length === 0 && ids.length === 1) {
    const photo = largestImage(document.querySelector('[data-viewer-content]'));
    if (photo) {
      sources.push(photo);
    }
  }
  return sources;
};

const largestImage = (root: Element | null): HTMLElement | undefined => {
  let best: HTMLElement | undefined;
  let bestArea = 0;
  for (const image of root?.querySelectorAll<HTMLElement>('img') ?? []) {
    const { width, height } = image.getBoundingClientRect();
    if (width * height <= bestArea) {
      continue;
    }
    best = image;
    bestArea = width * height;
  }
  return best;
};

/** A fixed-position copy of what `source` shows, so it can fly after the original is gone. */
const ghost = (layer: HTMLElement, source: HTMLElement) => {
  const image = source instanceof HTMLImageElement ? source : source.querySelector('img');
  // The image's own rect: a selected thumbnail shows its photo shrunk inside the frame.
  const imageRect = image?.getBoundingClientRect();
  const rect = imageRect && imageRect.width > 0 ? imageRect : source.getBoundingClientRect();
  const element = document.createElement('div');
  Object.assign(element.style, {
    position: 'absolute',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 8px 24px rgb(0 0 0 / 0.25)',
    backgroundColor: 'rgb(128 128 128 / 0.3)',
    willChange: 'translate, scale, opacity',
  });
  if (image?.currentSrc || image?.getAttribute('src')) {
    const copy = document.createElement('img');
    copy.src = image.currentSrc || image.getAttribute('src')!;
    copy.alt = '';
    Object.assign(copy.style, { width: '100%', height: '100%', objectFit: 'cover' });
    element.append(copy);
  }
  layer.append(element);
  return { element, rect };
};

const flyInto = (layer: HTMLElement, source: HTMLElement, target: Point, delay: number) => {
  const { element, rect } = ghost(layer, source);
  const from = center(rect);
  const control = arcControl(from, target);
  // Land as a ~20px chip, whatever size it started.
  const endScale = Math.min(1, 20 / Math.max(rect.width, rect.height));
  const tilt = from.x > target.x ? -18 : 18;
  const keyframes: Keyframe[] = [{ translate: '0 0', scale: 1, rotate: '0deg', opacity: 1, offset: 0 }];
  // Anticipation: a short lift before the throw.
  keyframes.push({ translate: '0 -6px', scale: 1.04, rotate: '0deg', opacity: 1, offset: 0.12 });
  for (let step = 1; step <= STEPS; step++) {
    const t = step / STEPS;
    const point = arcPoint(from, control, target, t);
    keyframes.push({
      translate: `${point.x - from.x}px ${point.y - from.y}px`,
      scale: 1.04 + (endScale - 1.04) * t,
      rotate: `${tilt * t}deg`,
      opacity: t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15,
      offset: 0.12 + 0.88 * t,
    });
  }
  return element.animate(keyframes, {
    duration: FLIGHT_MS,
    delay,
    // Accelerate into the bin, like something thrown and falling in.
    easing: 'cubic-bezier(0.45, 0, 0.75, 0.4)',
    fill: 'both',
  }).finished;
};

const drop = (layer: HTMLElement, source: HTMLElement, delay: number) => {
  const { element } = ghost(layer, source);
  const spin = (Math.random() - 0.5) * 30;
  return element.animate(
    [
      { translate: '0 0', scale: 1, rotate: '0deg', opacity: 1 },
      { translate: '0 -8px', scale: 1.03, rotate: '0deg', opacity: 1, offset: 0.15 },
      { translate: `0 ${innerHeight * 0.6}px`, scale: 0.7, rotate: `${spin}deg`, opacity: 0 },
    ],
    { duration: FLIGHT_MS, delay, easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)', fill: 'both' },
  ).finished;
};

/** Permanent delete: the photo loses its colour and comes apart where it stood. */
const dissolve = (layer: HTMLElement, source: HTMLElement, delay: number) => {
  const { element } = ghost(layer, source);
  return element.animate(
    [
      { scale: 1, opacity: 1, filter: 'grayscale(0) blur(0)' },
      { scale: 0.97, opacity: 1, filter: 'grayscale(1) blur(0)', offset: 0.35 },
      { scale: 0.85, opacity: 0, filter: 'grayscale(1) blur(8px)' },
    ],
    { duration: duration.slow + 100, delay, easing: ease.standard, fill: 'both' },
  ).finished;
};

/** The bin catching what was thrown in: a quick swell that springs back. */
const gulp = (target: HTMLElement, delay: number) => {
  const icon = target.querySelector('svg') ?? target;
  icon.animate([{ scale: 1 }, { scale: 1.35 }, { scale: 1 }], {
    duration: spring.gentle.duration,
    delay,
    easing: springEasing(spring.gentle),
    composite: 'add',
  });
};

export const animateRemoval = (target: RemovalTarget, kind: RemovalKind): void => {
  if (typeof document === 'undefined' || typeof document.body.animate !== 'function' || prefersReducedMotion()) {
    return;
  }
  const found = findSources(target);
  if (found.length === 0) {
    return;
  }
  // Every photo goes, but only the first few get their own flight; more would be noise.
  const sources = found.slice(0, kind === 'delete' ? MAX_DISSOLVING : MAX_FLYING);
  const stagger = Math.min(STAGGER_MS, MAX_STAGGER_TOTAL_MS / sources.length);
  if (target === 'visible') {
    for (const source of found) {
      source.style.visibility = 'hidden';
    }
  }

  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset.galleryRemoval = '';
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '9999',
    overflow: 'hidden',
  });
  document.body.append(layer);

  const link = kind === 'delete' ? undefined : findDestinationLink(DESTINATION[kind]);
  const pressed = kind !== 'delete' && !link ? lastPressPoint(1500) : undefined;
  const destination = link ? center(link.getBoundingClientRect()) : pressed;

  const flights = sources.map((source, index) => {
    const delay = index * stagger;
    if (kind === 'delete') {
      return dissolve(layer, source, delay);
    }
    return destination ? flyInto(layer, source, destination, delay) : drop(layer, source, delay);
  });

  if (link) {
    gulp(link, FLIGHT_MS * 0.9);
  }
  void Promise.allSettled(flights).then(() => layer.remove());
};
