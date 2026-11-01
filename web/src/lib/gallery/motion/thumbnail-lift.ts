/**
 * A hovered timeline photo lifts out of the grid (motion.css). Two things here keep that lift tidy:
 *
 * - **Grow where there is room.** The timeline's scroll area clips at its edges (beside the filter panel,
 *   under the scrubber, at the top and bottom of the view), so a photo growing from its centre lost its
 *   outer strip there. On entering a photo, its zoom is anchored on any edge too close to the scroll
 *   area's (`--gallery-lift-origin`), so it grows only toward the open side.
 * - **Settle smoothly.** The rules raising the photo's clipping and stacking ancestors key off `:hover`,
 *   so on leaving they dropped at once while the photo was still shrinking back: it was cut off and sank
 *   behind its neighbours mid-way, which read as a jump. `data-motion-settling` stays on the photo until
 *   the shrink has finished, and motion.css keeps the ancestors raised for it too.
 * - **Keep the date's distance.** A photo in a day's first row grows up toward the day's date, so the
 *   date moves up by the same amount (`data-motion-title-lift` + `--gallery-title-lift` on the day).
 */
import { prefersReducedMotion } from '$lib/gallery/motion/tokens';

const THUMBNAIL = '[data-thumbnail-focus-container]';
export const SETTLING_ATTR = 'data-motion-settling';
export const ORIGIN_VAR = '--gallery-lift-origin';
export const TITLE_LIFT_ATTR = 'data-motion-title-lift';
export const TITLE_LIFT_VAR = '--gallery-title-lift';

/** The hover scale in motion.css. */
export const LIFT_SCALE = 1.1;

/** As long as the shrink back in motion.css, plus a frame. */
export const SETTLE_MS = 420;

type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;

/**
 * The transform-origin that keeps a photo growing by `scale` inside `clip`: anchored on each side whose
 * edge is closer than the growth, centred otherwise (and centred when both sides of an axis are tight,
 * where nothing would help).
 */
export const liftOrigin = (photo: Box, clip: Box, scale = LIFT_SCALE): string => {
  const axis = (size: number, before: number, after: number, start: string, end: string) => {
    const grow = (size * (scale - 1)) / 2;
    const tightStart = before < grow;
    const tightEnd = after < grow;
    if (tightStart === tightEnd) {
      return 'center';
    }
    return tightStart ? start : end;
  };
  const x = axis(photo.width, photo.left - clip.left, clip.right - photo.right, 'left', 'right');
  const y = axis(photo.height, photo.top - clip.top, clip.bottom - photo.bottom, 'top', 'bottom');
  return `${x} ${y}`;
};

/** The nearest ancestor that clips its overflow (the timeline's scroll area), or the viewport. */
const clipBox = (element: Element): Box => {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent);
    if (/auto|scroll|hidden|clip/.test(overflowX + overflowY) && !parent.matches('[data-image-grid]')) {
      return parent.getBoundingClientRect();
    }
  }
  return { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
};

/**
 * How far a photo's top edge rises when it grows by `scale` from `origin`: half its growth from the
 * centre, all of it from the bottom, none from the top.
 */
export const topEdgeRise = (origin: string, height: number, scale = LIFT_SCALE): number => {
  const grow = height * (scale - 1);
  if (origin.endsWith(' bottom')) {
    return grow;
  }
  return origin.endsWith(' top') ? 0 : grow / 2;
};

const leaving = (event: MouseEvent, thumbnail: Element) =>
  !(event.relatedTarget instanceof Node && thumbnail.contains(event.relatedTarget));

/** The day section whose date sits right above this photo, if the photo is in the day's first row. */
const dayAbove = (thumbnail: Element, rect: Box): HTMLElement | undefined => {
  const grid = thumbnail.closest('[data-image-grid]');
  if (!grid || Math.abs(rect.top - grid.getBoundingClientRect().top) > 1) {
    return;
  }
  return thumbnail.closest<HTMLElement>('section[data-group]') ?? undefined;
};

const onMouseOver = (event: MouseEvent) => {
  const thumbnail = event.target instanceof Element ? event.target.closest<HTMLElement>(THUMBNAIL) : null;
  if (!thumbnail || !leaving(event, thumbnail)) {
    return;
  }
  const rect = thumbnail.getBoundingClientRect();
  const origin = liftOrigin(rect, clipBox(thumbnail));
  thumbnail.style.setProperty(ORIGIN_VAR, origin);

  const day = dayAbove(thumbnail, rect);
  const rise = topEdgeRise(origin, rect.height);
  if (day && rise > 0 && thumbnail.dataset.selected === undefined && !prefersReducedMotion()) {
    day.style.setProperty(TITLE_LIFT_VAR, `${rise.toFixed(1)}px`);
    day.setAttribute(TITLE_LIFT_ATTR, '');
  }
};

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

const onMouseOut = (event: MouseEvent) => {
  const thumbnail = event.target instanceof Element ? event.target.closest(THUMBNAIL) : null;
  if (!thumbnail || !leaving(event, thumbnail)) {
    return;
  }
  // The date eases back down alongside the photo's shrink.
  thumbnail.closest('section[data-group]')?.removeAttribute(TITLE_LIFT_ATTR);
  clearTimeout(timers.get(thumbnail));
  thumbnail.setAttribute(SETTLING_ATTR, '');
  timers.set(
    thumbnail,
    setTimeout(() => {
      thumbnail.removeAttribute(SETTLING_ATTR);
      timers.delete(thumbnail);
    }, SETTLE_MS),
  );
};

/** Installs the document listeners. Returns the uninstaller. */
export const installThumbnailLift = (target: Document = document): (() => void) => {
  target.addEventListener('mouseover', onMouseOver, { passive: true });
  target.addEventListener('mouseout', onMouseOut, { passive: true });
  return () => {
    target.removeEventListener('mouseover', onMouseOver);
    target.removeEventListener('mouseout', onMouseOut);
  };
};
