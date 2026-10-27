import { duration, ease, prefersReducedMotion, spring, springEasing } from '$lib/gallery/motion/tokens';

/**
 * Site-wide press and hover feedback: every button-like control squishes while held and springs back
 * on release, and buttons grow a touch under the mouse. It runs from document listeners, so upstream
 * components get it without being edited.
 *
 * Opt a custom element in with `data-press`, or out with `data-no-press` (on it or any ancestor).
 * Everything inside a map is out.
 */
export const PRESSABLE =
  'button, [role="button"], [role="switch"], [role="checkbox"], [role="tab"], [role="menuitem"], [role="option"], [data-press]';

/** How long `data-just-pressed` stays after release, so CSS can pop what the press changed. */
export const JUST_PRESSED_MS = 700;

/**
 * Never animated. Maps position their markers with their own transforms, and a marker that grows under
 * the cursor moves its hit area, so hover flickers on and off and the marker is hard to click.
 */
const NO_MOTION = '[data-no-press], .maplibregl-map';

/** Hover grows buttons only; rows in menus and lists, tabs and checkboxes highlight instead. */
const HOVERABLE = 'button, [role="button"], [data-press]';
const NOT_HOVERABLE = '[role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"]';

/** Elements larger than this (px²) are surfaces, not controls: a squish would read as the page lurching. */
const MAX_AREA = 600 * 200;
/** Wider than this, a hover grow reads as the layout shifting. */
const MAX_HOVER_WIDTH = 400;

/**
 * Scale for a held control. The squish is about 14px across whatever the width, so icons and buttons
 * dip clearly (0.86) and wide rows still move (0.95).
 */
export const pressScale = (width: number): number => 1 - Math.min(0.14, Math.max(0.05, 14 / Math.max(width, 1)));

/** Scale for a hovered button: about 5px of growth, so icons pop (1.1) and wide buttons swell (1.02). */
export const hoverScale = (width: number): number => 1 + Math.min(0.1, Math.max(0.02, 5 / Math.max(width, 1)));

export interface PressPoint {
  x: number;
  y: number;
  at: number;
}

let lastPoint: PressPoint | undefined;

/** Where the last pointer press landed, for effects that start from the user's finger (see `celebrate`). */
export const lastPressPoint = (maxAgeMs: number): PressPoint | undefined =>
  lastPoint && performance.now() - lastPoint.at <= maxAgeMs ? lastPoint : undefined;

const findPressable = (target: EventTarget | null, selector = PRESSABLE): HTMLElement | undefined => {
  if (!(target instanceof Element)) {
    return;
  }
  const element = target.closest<HTMLElement>(selector);
  if (
    !element ||
    typeof element.animate !== 'function' ||
    element.closest(NO_MOTION) ||
    element.matches(':disabled, [aria-disabled="true"]') ||
    prefersReducedMotion()
  ) {
    return;
  }
  const { width, height } = element.getBoundingClientRect();
  if (width * height > MAX_AREA) {
    return;
  }
  return element;
};

interface Held {
  element: HTMLElement;
  scale: number;
  startedAt: number;
  animation: Animation;
}

let held: Held | undefined;
const justPressedTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

const markJustPressed = (element: HTMLElement) => {
  clearTimeout(justPressedTimers.get(element));
  element.dataset.justPressed = '';
  justPressedTimers.set(
    element,
    setTimeout(() => delete element.dataset.justPressed, JUST_PRESSED_MS),
  );
};

// `composite: 'add'` multiplies onto any scale the element already has (hover:scale-*, selection),
// so the squish never resets a component's own transform.
const pressIn = (element: HTMLElement) => {
  release();
  const scale = pressScale(element.getBoundingClientRect().width);
  const animation = element.animate([{ scale: 1 }, { scale }], {
    duration: duration.instant,
    easing: ease.standard,
    fill: 'forwards',
    composite: 'add',
  });
  held = { element, scale, startedAt: performance.now(), animation };
  markJustPressed(element);
};

// Return to rest from wherever the press got to, on the bouncy spring: the overshoot is the "boing".
const settle = ({ element, scale, startedAt, animation }: Held) => {
  const progress = Math.min(1, (performance.now() - startedAt) / duration.instant);
  const from = 1 + (scale - 1) * progress;
  animation.cancel();
  if (element.isConnected) {
    element.animate([{ scale: from }, { scale: 1 }], {
      duration: spring.bouncy.duration,
      easing: springEasing(spring.bouncy),
      composite: 'add',
    });
  }
};

const release = () => {
  if (!held) {
    return;
  }
  const pressed = held;
  held = undefined;
  // A click is often shorter than the press-in: let the dip land before springing back, or a quick
  // tap shows nothing at all.
  const remaining = duration.instant - (performance.now() - pressed.startedAt);
  if (remaining > 0) {
    setTimeout(() => settle(pressed), remaining);
  } else {
    settle(pressed);
  }
};

let hovered: { element: HTMLElement; scale: number; animation: Animation } | undefined;

const hoverIn = (element: HTMLElement) => {
  const { width } = element.getBoundingClientRect();
  if (width > MAX_HOVER_WIDTH || element.matches(NOT_HOVERABLE)) {
    return;
  }
  const scale = hoverScale(width);
  const animation = element.animate([{ scale: 1 }, { scale }], {
    duration: spring.bouncy.duration,
    easing: springEasing(spring.bouncy),
    fill: 'forwards',
    composite: 'add',
  });
  hovered = { element, scale, animation };
};

const hoverOut = () => {
  if (!hovered) {
    return;
  }
  const { element, scale, animation } = hovered;
  hovered = undefined;
  animation.cancel();
  if (element.isConnected) {
    element.animate([{ scale }, { scale: 1 }], { duration: duration.base, easing: ease.settle, composite: 'add' });
  }
};

const onPointerOver = (event: PointerEvent) => {
  if (event.pointerType !== 'mouse') {
    return;
  }
  const element = findPressable(event.target, HOVERABLE);
  if (element === hovered?.element) {
    return;
  }
  hoverOut();
  if (element) {
    hoverIn(element);
  }
};

const onPointerOut = (event: PointerEvent) => {
  if (!hovered || (event.relatedTarget instanceof Node && hovered.element.contains(event.relatedTarget))) {
    return;
  }
  hoverOut();
};

const onPointerDown = (event: PointerEvent) => {
  lastPoint = { x: event.clientX, y: event.clientY, at: performance.now() };
  if (event.button !== 0) {
    return;
  }
  const element = findPressable(event.target);
  if (element) {
    pressIn(element);
  }
};

const onKeyDown = (event: KeyboardEvent) => {
  // Whatever happens next was not started by the pointer, so effects must not start from it.
  lastPoint = undefined;
  if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) {
    return;
  }
  const element = findPressable(event.target);
  if (!element) {
    return;
  }
  pressIn(element);
  // Enter clicks on keydown, so it is a tap; Space clicks on keyup and is held like a pointer.
  if (event.key === 'Enter') {
    release();
  }
};

const onKeyUp = (event: KeyboardEvent) => {
  if (event.key === ' ') {
    release();
  }
};

/** Installs the document listeners. Returns the uninstaller. */
export const installPressFeedback = (target: Document = document): (() => void) => {
  const listeners: [string, EventListener][] = [
    ['pointerdown', onPointerDown as EventListener],
    ['pointerover', onPointerOver as EventListener],
    ['pointerout', onPointerOut as EventListener],
    ['pointerup', release],
    ['pointercancel', release],
    ['dragstart', release],
    ['keydown', onKeyDown as EventListener],
    ['keyup', onKeyUp as EventListener],
  ];
  for (const [type, listener] of listeners) {
    target.addEventListener(type, listener, { capture: true, passive: true });
  }
  const onBlur = () => release();
  addEventListener('blur', onBlur);

  return () => {
    release();
    hoverOut();
    for (const [type, listener] of listeners) {
      target.removeEventListener(type, listener, { capture: true });
    }
    removeEventListener('blur', onBlur);
  };
};
