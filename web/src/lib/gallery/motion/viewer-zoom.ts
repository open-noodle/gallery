import { onDestroy, onMount } from 'svelte';
import { ease, prefersReducedMotion, spring } from '$lib/gallery/motion/tokens';

/**
 * Opening a photo zooms it out of its timeline thumbnail into the viewer, and closing flies it back
 * into the thumbnail, like the mobile app. A copy of the image flies on top of the page; the viewer's
 * own photo is hidden underneath until the copy lands, so the viewer's zoom, swipe and image loading
 * are untouched. When the thumbnail is not on screen (a photo swiped to, a deep link) the viewer just
 * fades.
 *
 * Positions are read while they can be: the timeline is hidden while the viewer is open, so the
 * thumbnail is recorded when it is clicked (`installViewerZoom`); and the viewer's photo is gone by the
 * time the viewer's teardown runs, so it is recorded on every input that could close it (a key, a
 * click, the browser's back button).
 *
 * Hooks: `installViewerZoom` in setupMotion, one `useViewerZoom` call in AssetViewer.
 */
const VIEWER = '#immich-asset-viewer';
const THUMBNAIL = '[data-thumbnail-focus-container]';
/** AdaptiveImage's box around the displayed photo (upstream markup). */
const PHOTO_BOX = '[data-viewer-content] .size-full.overflow-hidden > .pointer-events-none.absolute.overflow-hidden';
/** A click older than this did not open the viewer that is mounting now. */
const CLICK_MAX_AGE_MS = 3000;

type Box = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

interface Shot {
  assetId: string;
  rect: Box;
  src: string;
  at: number;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The element's rect, or nothing when it is not laid out or entirely off screen. */
const onScreen = (element: Element | null | undefined): DOMRect | undefined => {
  const rect = element?.getBoundingClientRect();
  if (
    !rect ||
    rect.width === 0 ||
    rect.bottom < 0 ||
    rect.top > innerHeight ||
    rect.right < 0 ||
    rect.left > innerWidth
  ) {
    return;
  }
  return rect;
};

/** A transform that draws an element laid out at `base` over `target` (origin top left). */
export const transformBetween = (target: Box, base: Box): string =>
  `translate(${target.left - base.left}px, ${target.top - base.top}px) scale(${target.width / base.width}, ${target.height / base.height})`;

const placeFlyer = (flyer: HTMLElement, rect: Box) =>
  Object.assign(flyer.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });

const layer = (src: string): HTMLImageElement => {
  const image = document.createElement('img');
  image.src = src;
  image.alt = '';
  Object.assign(image.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    objectFit: 'cover',
  });
  return image;
};

/**
 * The flying copy: the image already on screen, and, when given, a sharper one that fades in over it
 * once decoded, so the photo sharpens during the flight instead of snapping sharp after it.
 */
const createFlyer = (src: string, rect: Box, sharpSrc?: string): HTMLDivElement => {
  const flyer = document.createElement('div');
  flyer.setAttribute('aria-hidden', 'true');
  flyer.dataset.motionFlyer = '';
  placeFlyer(flyer, rect);
  Object.assign(flyer.style, {
    position: 'fixed',
    overflow: 'hidden',
    transformOrigin: '0 0',
    pointerEvents: 'none',
    zIndex: '10000',
    willChange: 'transform',
  });
  flyer.append(layer(src));
  if (sharpSrc && sharpSrc !== src) {
    const sharp = layer(sharpSrc);
    sharp.style.opacity = '0';
    sharp.style.transition = `opacity 240ms ${ease.standard}`;
    flyer.append(sharp);
    void sharp
      .decode()
      .then(() => (sharp.style.opacity = '1'))
      .catch(() => {});
  }
  document.body.append(flyer);
  return flyer;
};

/** The viewer requests the preview with the thumbnail's URL at another size, so this hits the same cache entry. */
const previewOf = (thumbnailSrc: string): string | undefined =>
  thumbnailSrc.includes('size=thumbnail') ? thumbnailSrc.replace('size=thumbnail', 'size=preview') : undefined;

/** Resolves once the viewer's photo box shows a loaded image sharper than the thumbnail, or on timeout. */
const viewerSharp = async (box: HTMLElement, timeoutMs: number) => {
  const until = performance.now() + timeoutMs;
  let interrupted = false;
  const interrupt = () => (interrupted = true);
  const inputs = ['keydown', 'pointerdown', 'wheel'] as const;
  for (const type of inputs) {
    document.addEventListener(type, interrupt, { capture: true, passive: true, once: true });
  }
  while (!interrupted && performance.now() < until) {
    const sharp = [...box.querySelectorAll('img')].some(
      (image) => image.complete && image.naturalWidth > 0 && !image.currentSrc.includes('size=thumbnail'),
    );
    if (sharp) {
      break;
    }
    await nextFrame();
  }
  for (const type of inputs) {
    document.removeEventListener(type, interrupt, { capture: true });
  }
};

/** Fast out, settling exactly on the target: a spring's overshoot would draw the photo bigger than it is. */
const flight = () => ({ duration: spring.snappy.duration, easing: ease.settle });

const canAnimate = () => typeof Element.prototype.animate === 'function' && !prefersReducedMotion();

// ── Opening ──────────────────────────────────────────────────────────────

interface Clicked extends Shot {
  flyer: HTMLDivElement;
  /** The photo's width over height. */
  ratio: number;
  /** Set once the flight has started, before the viewer could measure where the photo goes. */
  flight?: { animation: Animation; target: Box; startedAt: number };
}

let clicked: Clicked | undefined;

const dropClicked = () => {
  clicked?.flyer?.remove();
  clicked = undefined;
};

/** A plain click or Enter on a thumbnail opens the viewer, unless photos are being selected. */
const opensViewer = (event: Event) =>
  !document.querySelector('#control-bar') &&
  (event instanceof KeyboardEvent
    ? event.key === 'Enter'
    : event instanceof MouseEvent && event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey);

const recordThumbnail = (event: Event) => {
  const thumbnail = event.target instanceof Element ? event.target.closest<HTMLElement>(THUMBNAIL) : null;
  const image = thumbnail?.querySelector('img');
  const rect = onScreen(image);
  const assetId = thumbnail?.dataset.asset;
  dropClicked();
  if (!assetId || !rect || !image?.currentSrc || !opensViewer(event) || !canAnimate()) {
    return;
  }
  // The copy goes up at once: the timeline hides as soon as the route changes, while the viewer is
  // still loading, and the copy covers that gap. If no viewer claims it, it goes away.
  const flyer = createFlyer(image.currentSrc, rect, previewOf(image.currentSrc));
  const ratio =
    image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : rect.width / rect.height;
  const shot: Clicked = {
    assetId,
    rect: rect.toJSON() as Box,
    src: image.currentSrc,
    at: performance.now(),
    flyer,
    ratio,
  };
  clicked = shot;
  setTimeout(() => clicked === shot && dropClicked(), CLICK_MAX_AGE_MS);
};

/** Where the viewer will most likely draw the photo: fitted into the window, centred. */
export const estimateTarget = (ratio: number, viewport?: { width: number; height: number }): Box => {
  const { width: viewWidth, height: viewHeight } = viewport ?? { width: innerWidth, height: innerHeight };
  const width = Math.min(viewWidth, viewHeight * ratio);
  const height = width / ratio;
  return { left: (viewWidth - width) / 2, top: (viewHeight - height) / 2, width, height };
};

const startFlight = (shot: Clicked) => {
  if (shot.flight) {
    return;
  }
  const target = estimateTarget(shot.ratio);
  placeFlyer(shot.flyer, target);
  const animation = shot.flyer.animate(
    [{ transform: transformBetween(shot.rect, target) }, { transform: 'none' }],
    flight(),
  );
  shot.flight = { animation, target, startedAt: performance.now() };
};

/**
 * setupMotion's `beforeNavigate`: the router heading for the clicked photo is the signal that the click
 * opens the viewer (pickers reuse the same thumbnails to select), and it comes well before the viewer has
 * loaded, so the flight starts now, toward an estimate. zoomIn corrects course once the viewer measured.
 */
export const viewerZoomBeforeNavigate = (navigation: { to: { params: Record<string, string> | null } | null }) => {
  if (clicked && navigation.to?.params?.assetId === clicked.assetId && canAnimate()) {
    startFlight(clicked);
  }
};

const zoomIn = async (assetId: string) => {
  const viewer = document.querySelector<HTMLElement>(VIEWER);
  if (!viewer) {
    return;
  }
  viewer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: ease.standard });

  const from = clicked?.assetId === assetId ? clicked : undefined;
  if (!from?.flyer) {
    dropClicked();
    return;
  }
  clicked = undefined;
  // The copy sits on the thumbnail since the click; the viewer sizes the photo once its container is
  // measured, a frame or two after mounting, and only then does the copy know where to fly.
  const flyer = from.flyer;
  let box: HTMLElement | null = null;
  for (let frame = 0; frame < 20; frame++) {
    box = viewer.querySelector<HTMLElement>(PHOTO_BOX);
    if (onScreen(box)) {
      break;
    }
    await nextFrame();
  }
  const to = onScreen(box);
  if (!box || !to) {
    await flyer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150 }).finished.catch(() => {});
    flyer.remove();
    return;
  }
  box.style.visibility = 'hidden';
  const started = from.flight;
  const off = (a: Box, b: Box) =>
    Math.abs(a.left - b.left) + Math.abs(a.top - b.top) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
  if (!started) {
    // Lay the copy out at the photo's final size (sharp when it lands), drawn over the thumbnail to start.
    placeFlyer(flyer, to);
    await flyer
      .animate([{ transform: transformBetween(from.rect, to) }, { transform: 'none' }], flight())
      .finished.catch(() => {});
  } else if (off(started.target, to) > 2) {
    // The estimate missed (an open info panel, say): glide from wherever the copy is now to the real spot.
    const current = flyer.getBoundingClientRect();
    started.animation.cancel();
    placeFlyer(flyer, to);
    const remaining = Math.max(180, spring.snappy.duration - (performance.now() - started.startedAt));
    await flyer
      .animate([{ transform: transformBetween(current, to) }, { transform: 'none' }], {
        duration: remaining,
        easing: ease.settle,
      })
      .finished.catch(() => {});
  } else {
    await started.animation.finished.catch(() => {});
  }
  // Hand over once the viewer's own sharp image is in: the copy, sharpened on the way, stays on top until
  // then and fades out over an identical photo. Any input hands over at once.
  await viewerSharp(box, 1200);
  box.style.visibility = '';
  await flyer
    .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: ease.standard })
    .finished.catch(() => {});
  flyer.remove();
};

// ── Closing ──────────────────────────────────────────────────────────────

/** Where the viewer's photo is and which image it shows. */
const snapshotViewer = (assetId: string): Shot | undefined => {
  const box = document.querySelector<HTMLElement>(`${VIEWER} ${PHOTO_BOX}`);
  const rect = onScreen(box);
  const images = [...(box?.querySelectorAll('img') ?? [])].filter((image) => image.complete && image.naturalWidth > 0);
  const src = images.at(-1)?.currentSrc;
  return rect && src ? { assetId, rect: rect.toJSON() as Box, src, at: performance.now() } : undefined;
};

const zoomOut = async ({ assetId, rect }: Shot, flyer: HTMLDivElement) => {
  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    background: 'black',
    zIndex: '9999',
    pointerEvents: 'none',
  });
  document.body.append(backdrop);
  placeFlyer(flyer, rect);
  flyer.style.visibility = '';
  void backdrop
    .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: ease.standard, fill: 'forwards' })
    .finished.catch(() => {})
    .then(() => backdrop.remove());

  // The timeline shows again, and may scroll the photo into view, as the viewer closes.
  await nextFrame();
  await nextFrame();
  const thumbnail = document.querySelector<HTMLElement>(`${THUMBNAIL}[data-asset="${CSS.escape(assetId)}"] img`);
  const to = onScreen(thumbnail);
  if (!thumbnail || !to) {
    await flyer
      .animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.92)' }], { duration: 200, easing: ease.exit })
      .finished.catch(() => {});
    flyer.remove();
    return;
  }
  thumbnail.style.visibility = 'hidden';
  await flyer
    .animate([{ transform: 'none' }, { transform: transformBetween(to, rect) }], flight())
    .finished.catch(() => {});
  thumbnail.style.visibility = '';
  flyer.remove();
};

// ── Hooks ────────────────────────────────────────────────────────────────

/** setupMotion: records the thumbnail a click lands on, before the viewer hides the timeline. */
export const installViewerZoom = (target: Document = document): (() => void) => {
  target.addEventListener('click', recordThumbnail, { capture: true, passive: true });
  target.addEventListener('keydown', recordThumbnail, { capture: true, passive: true });
  return () => {
    target.removeEventListener('click', recordThumbnail, { capture: true });
    target.removeEventListener('keydown', recordThumbnail, { capture: true });
  };
};

/** AssetViewer: zoom in from the thumbnail on mount, back into it on close. */
export const useViewerZoom = (assetId: () => string): void => {
  let lastShot: Shot | undefined;
  // A hidden copy of the photo on show, decoded ahead of time: a copy made only when the viewer closes
  // paints a black frame first while its image decodes.
  let standby: HTMLDivElement | undefined;
  const record = () => {
    const shot = snapshotViewer(assetId());
    if (!shot) {
      return;
    }
    lastShot = shot;
    standby ??= createFlyer(shot.src, shot.rect);
    standby.style.visibility = 'hidden';
    const image = standby.querySelector('img')!;
    if (image.src !== shot.src) {
      image.src = shot.src;
    }
    void image.decode().catch(() => {});
  };
  let refresh: ReturnType<typeof setTimeout> | undefined;
  /** Record now (the input may close the viewer), and again once whatever it changed has settled. */
  const onInput = () => {
    record();
    clearTimeout(refresh);
    refresh = setTimeout(record, 600);
  };
  onMount(() => {
    if (!canAnimate()) {
      return;
    }
    // Ready for a close before any input: once the photo has landed, and once its preview has loaded.
    void zoomIn(assetId()).then(onInput);
    document.addEventListener('keydown', onInput, { capture: true, passive: true });
    document.addEventListener('pointerdown', onInput, { capture: true, passive: true });
    addEventListener('popstate', record, { capture: true });
    return () => {
      clearTimeout(refresh);
      document.removeEventListener('keydown', onInput, { capture: true });
      document.removeEventListener('pointerdown', onInput, { capture: true });
      removeEventListener('popstate', record, { capture: true });
    };
  });
  onDestroy(() => {
    // Only a snapshot of the photo the viewer was showing when it closed.
    if (standby && lastShot?.assetId === assetId()) {
      void zoomOut(lastShot, standby);
    } else {
      standby?.remove();
    }
  });
};
