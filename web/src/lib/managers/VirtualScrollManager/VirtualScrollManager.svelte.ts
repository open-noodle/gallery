import { debounce } from 'lodash-es';

// Largest *scrollable range* the engine will actually deliver. This is not the same as the
// largest element it will lay out, and the two engines differ in both value and unit:
//
//   Chromium/WebKit — saturates LayoutUnit at 2^31/64 = 33,554,428 DEVICE pixels, and scrolls the
//     full element. On a 2x display a 33,000,000px CSS request becomes 66,000,000 device pixels
//     and the element comes back silently halved, hence the dpr division below.
//   Firefox — lays out up to nscoord_MAX (2^30/60 = 17,895,697px) but caps the scrollable range
//     at half of it. Measured on a 750k-asset library at dpr 1: a 17,537,784px element reported
//     scrollHeight 8,947,850 and would not scroll past 8,946,658. Using the layout ceiling here
//     leaves domScrollMax ~2x the range the browser grants, stranding the tail at ~51%.
//
// The Firefox check is inlined (not imported from asset-utils's `isFirefox`) to avoid the
// circular import asset-utils → TimelineManager → VirtualScrollManager.
const IS_FIREFOX = typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');
export const SCROLL_CEILING_FIREFOX_PX = 8_947_848; // nscoord_MAX / 2
export const SCROLL_CEILING_CHROMIUM_PX = 33_554_428; // LayoutUnit saturation, device px
export const BROWSER_MAX_SCROLL_DEVICE_PX = IS_FIREFOX ? SCROLL_CEILING_FIREFOX_PX : SCROLL_CEILING_CHROMIUM_PX;

// Headroom below the ceiling so the browser's own layout rounding never trips it.
const SCROLL_HEIGHT_SAFETY = 0.98;

/**
 * CSS-pixel height budget for the scroll container on a display of the given devicePixelRatio.
 *
 * The ceiling above is a *device*-pixel limit, so on a HiDPI screen each CSS pixel spends `dpr`
 * of it. Asking for a flat CSS-pixel height gets silently clamped — the element comes back
 * ~`1/dpr` of what was requested while `domScrollMax` keeps being derived from the requested
 * value, so `domToLogical` divides by a scroll range that does not exist and the tail of the
 * list becomes unreachable. Dividing here keeps the request under the ceiling so nothing clamps.
 *
 * Firefox's ceiling is nominally in CSS pixels rather than device pixels (only measured at dpr 1
 * so far); dividing anyway is deliberately conservative — it only shrinks the DOM range, and
 * never lets the request exceed the real ceiling on either engine.
 */
export function maxScrollHeightForDevicePixelRatio(
  dpr: number,
  ceiling: number = BROWSER_MAX_SCROLL_DEVICE_PX,
): number {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.floor((ceiling * SCROLL_HEIGHT_SAFETY) / ratio);
}

type LayoutOptions = {
  headerHeight: number;
  rowHeight: number;
  gap: number;
};
export abstract class VirtualScrollManager {
  topSectionHeight = $state(0);
  bodySectionHeight = $state(0);
  bottomSectionHeight = $state(0);
  totalViewerHeight = $derived.by(() => this.topSectionHeight + this.bodySectionHeight + this.bottomSectionHeight);

  visibleWindow = $derived.by(() => ({
    top: this.#scrollTop,
    bottom: this.#scrollTop + this.viewportHeight,
  }));

  #viewportHeight = $state(0);
  #viewportWidth = $state(0);
  #scrollTop = $state(0);
  maxScrollHeight = $state(maxScrollHeightForDevicePixelRatio(globalThis.devicePixelRatio));
  #cachedDomScrollTop = $state(0);
  #rowHeight = $state(235);
  #headerHeight = $state(48);
  #gap = $state(12);
  #scrolling = $state(false);
  #suspendTransitions = $state(false);
  #resetScrolling = debounce(() => (this.#scrolling = false), 1000);
  #resetSuspendTransitions = debounce(() => (this.suspendTransitions = false), 1000);
  #justifiedLayoutOptions = $derived({
    spacing: 2,
    heightTolerance: 0.5,
    rowHeight: this.#rowHeight,
    rowWidth: Math.floor(this.viewportWidth),
  });

  constructor() {
    this.setLayoutOptions();
  }

  get domScrollTop(): number {
    return 0;
  }

  get scrollTop(): number {
    return this.domToLogical(this.domScrollTop);
  }

  get renderOffset(): number {
    return this.#cachedDomScrollTop - this.#scrollTop;
  }

  get domHeight(): number {
    return Math.min(this.totalViewerHeight, this.maxScrollHeight);
  }

  get logicalScrollMax(): number {
    return Math.max(0, this.totalViewerHeight - this.viewportHeight);
  }

  get domScrollMax(): number {
    return Math.max(0, this.domHeight - this.viewportHeight);
  }

  get scrollScale(): number {
    return this.logicalScrollMax > 0 ? this.domScrollMax / this.logicalScrollMax : 1;
  }

  domToLogical(dom: number): number {
    return this.domScrollMax > 0 ? (dom * this.logicalScrollMax) / this.domScrollMax : 0;
  }

  logicalToDom(logical: number): number {
    return this.logicalScrollMax > 0 ? (logical * this.domScrollMax) / this.logicalScrollMax : 0;
  }

  get justifiedLayoutOptions() {
    return this.#justifiedLayoutOptions;
  }

  get maxScrollPercent() {
    const totalHeight = this.totalViewerHeight;
    return (totalHeight - this.viewportHeight) / totalHeight;
  }

  get maxScroll() {
    return this.totalViewerHeight - this.viewportHeight;
  }

  #setHeaderHeight(value: number) {
    if (this.#headerHeight === value) {
      return false;
    }
    this.#headerHeight = value;
    return true;
  }

  get headerHeight() {
    return this.#headerHeight;
  }

  #setGap(value: number) {
    if (this.#gap === value) {
      return false;
    }
    this.#gap = value;
    return true;
  }

  get gap() {
    return this.#gap;
  }

  #setRowHeight(value: number) {
    if (this.#rowHeight === value) {
      return false;
    }
    this.#rowHeight = value;
    return true;
  }

  get rowHeight() {
    return this.#rowHeight;
  }

  set scrolling(value: boolean) {
    this.#scrolling = value;
    if (value) {
      this.suspendTransitions = true;
      this.#resetScrolling();
    }
  }

  get scrolling() {
    return this.#scrolling;
  }

  set suspendTransitions(value: boolean) {
    this.#suspendTransitions = value;
    if (value) {
      this.#resetSuspendTransitions();
    }
  }

  get suspendTransitions() {
    return this.#suspendTransitions;
  }

  // dpr changes when the window moves between displays of different density (or on browser zoom).
  // There is no dedicated event for it, but such a move always lands as a geometry update here,
  // so re-derive the budget then — otherwise the cap stays at the old display's value and the
  // browser clamps the element behind our back again.
  #refreshScrollCap() {
    const next = maxScrollHeightForDevicePixelRatio(globalThis.devicePixelRatio);
    if (this.maxScrollHeight !== next) {
      this.maxScrollHeight = next;
    }
  }

  set viewportWidth(value: number) {
    const changed = value !== this.#viewportWidth;
    this.#viewportWidth = value;
    this.suspendTransitions = true;
    this.#refreshScrollCap();
    void this.updateViewportGeometry(changed);
  }

  get viewportWidth() {
    return this.#viewportWidth;
  }

  set viewportHeight(value: number) {
    this.#viewportHeight = value;
    this.#suspendTransitions = true;
    this.#refreshScrollCap();
    void this.updateViewportGeometry(false);
  }

  get viewportHeight() {
    return this.#viewportHeight;
  }

  get hasEmptyViewport() {
    return this.viewportWidth === 0 || this.viewportHeight === 0;
  }

  protected updateViewportProximities(): void {}

  protected updateViewportGeometry(_: boolean) {}

  setLayoutOptions({ headerHeight = 48, rowHeight = 235, gap = 12 }: Partial<LayoutOptions> = {}) {
    let changed = false;
    changed ||= this.#setHeaderHeight(headerHeight);
    changed ||= this.#setGap(gap);
    changed ||= this.#setRowHeight(rowHeight);
    if (changed) {
      this.refreshLayout();
    }
  }

  updateSlidingWindow() {
    const domScrollTop = this.domScrollTop;
    const scrollTop = this.domToLogical(domScrollTop);
    if (this.#scrollTop !== scrollTop || this.#cachedDomScrollTop !== domScrollTop) {
      this.#cachedDomScrollTop = domScrollTop;
      this.#scrollTop = scrollTop;
      this.updateViewportProximities();
    }
  }

  // Re-derive the cached DOM↔logical scroll mapping from the current DOM scrollTop under the
  // present scale. A geometry change (viewport resize, width reflow) shifts domScrollMax/
  // logicalScrollMax without a scroll event, so the cached logical position — and therefore
  // renderOffset — would otherwise stay computed against the old scale and teleport the timeline
  // on the next scroll. Unlike updateSlidingWindow this skips the change guard: the DOM scrollTop
  // may be unchanged while the scale is not.
  protected resyncScrollMapping(): void {
    this.#cachedDomScrollTop = this.domScrollTop;
    this.#scrollTop = this.domToLogical(this.#cachedDomScrollTop);
  }

  refreshLayout() {
    this.updateViewportProximities();
  }

  destroy(): void {}
}
