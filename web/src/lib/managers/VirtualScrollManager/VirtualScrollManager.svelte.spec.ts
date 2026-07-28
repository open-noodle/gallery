import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_MAX_SCROLL_DEVICE_PX,
  maxScrollHeightForDevicePixelRatio,
  SCROLL_CEILING_FIREFOX_PX,
  VirtualScrollManager,
} from './VirtualScrollManager.svelte';

class TestScroller extends VirtualScrollManager {
  #dom = 0;
  override get domScrollTop() {
    return this.#dom;
  }
  setDomScrollTop(value: number) {
    this.#dom = value;
  }
}

function makeScroller({ body, viewport, cap }: { body: number; viewport: number; cap?: number }) {
  const scroller = new TestScroller();
  scroller.bodySectionHeight = body;
  scroller.viewportHeight = viewport;
  if (cap !== undefined) {
    scroller.maxScrollHeight = cap;
  }
  return scroller;
}

describe('VirtualScrollManager scaling', () => {
  it('1. is identity below the cap', () => {
    const s = makeScroller({ body: 10_000, viewport: 1000, cap: 1_000_000 });
    expect(s.domHeight).toBe(10_000); // == totalViewerHeight
    expect(s.scrollScale).toBe(1);
    expect(s.domToLogical(500)).toBe(500);
    expect(s.logicalToDom(500)).toBe(500);

    s.setDomScrollTop(500);
    s.updateSlidingWindow();
    expect(s.scrollTop).toBe(500); // logical
    expect(s.renderOffset).toBe(0);
  });

  it('2. leaves scale at 1 exactly at the cap', () => {
    const s = makeScroller({ body: 10_000, viewport: 1000, cap: 10_000 });
    expect(s.domHeight).toBe(10_000);
    expect(s.scrollScale).toBe(1);
  });

  it('3. clamps domHeight and scales above the cap', () => {
    const s = makeScroller({ body: 100_000, viewport: 1000, cap: 10_000 });
    expect(s.domHeight).toBe(10_000);
    expect(s.scrollScale).toBeGreaterThan(0);
    expect(s.scrollScale).toBeLessThan(1);
  });

  it('4. maps both endpoints so the tail is reachable', () => {
    const s = makeScroller({ body: 100_000, viewport: 1000, cap: 10_000 });
    expect(s.logicalToDom(0)).toBe(0);
    expect(s.logicalToDom(s.logicalScrollMax)).toBeCloseTo(s.domScrollMax, 6);
  });

  it('5. round-trips dom↔logical', () => {
    const s = makeScroller({ body: 100_000, viewport: 1000, cap: 10_000 });
    for (const x of [0, 50_000, s.logicalScrollMax]) {
      expect(s.domToLogical(s.logicalToDom(x))).toBeCloseTo(x, 6);
    }
  });

  it('6. keeps the bottom item bounded within the capped DOM height', () => {
    const s = makeScroller({ body: 100_000, viewport: 1000, cap: 10_000 });
    s.setDomScrollTop(s.domScrollMax);
    s.updateSlidingWindow();
    expect(s.scrollTop).toBeCloseTo(s.logicalScrollMax, 6); // 99_000
    expect(s.renderOffset).toBeCloseTo(-90_000, 6);
    // an item at logical top == total lands exactly at domHeight, not at 100_000px
    expect(s.totalViewerHeight + s.renderOffset).toBeCloseTo(s.domHeight, 6);
  });

  it('7. guards against divide-by-zero and NaN at the geometry edges', () => {
    // (a) content fits the viewport → logicalScrollMax == 0 (spec edge #4/#5)
    const fits = makeScroller({ body: 500, viewport: 1000, cap: 10_000 });
    expect(fits.logicalScrollMax).toBe(0);
    expect(fits.domToLogical(123)).toBe(0);
    expect(fits.logicalToDom(123)).toBe(0);
    expect(fits.scrollScale).toBe(1);
    expect(Number.isFinite(fits.domToLogical(123))).toBe(true);

    // (b) zero-height viewport (transient, before layout) → no NaN/Infinity (spec edge #6)
    const noViewport = makeScroller({ body: 100_000, viewport: 0, cap: 10_000 });
    expect(noViewport.domHeight).toBe(10_000);
    expect(Number.isFinite(noViewport.domToLogical(5000))).toBe(true);
    expect(Number.isFinite(noViewport.logicalToDom(50_000))).toBe(true);
    expect(Number.isFinite(noViewport.scrollScale)).toBe(true);
  });

  it('8. renderOffset reads cached state, updating only after updateSlidingWindow', () => {
    const s = makeScroller({ body: 100_000, viewport: 1000, cap: 10_000 });
    s.setDomScrollTop(s.domScrollMax);
    expect(s.renderOffset).toBe(0); // cached state not yet refreshed
    s.updateSlidingWindow();
    expect(s.renderOffset).toBeCloseTo(-90_000, 6);
  });
});

// Regression: #713 follow-up. The browser's element-height ceiling is expressed in DEVICE
// pixels, but the cap was a flat CSS-pixel constant. On a HiDPI display every CSS pixel costs
// `devicePixelRatio` device pixels, so a 33,000,000px CSS request asks for 66,000,000 device
// pixels on a 2x screen. The browser silently clamps the element to ~16,777,214px while
// domScrollMax keeps being computed from the *requested* 33,000,000 — so domToLogical divides
// by a scroll range that does not exist and the tail of the timeline becomes unreachable
// (observed: 750k assets stuck at ~2023, exactly 50.8% of the library).
describe('VirtualScrollManager HiDPI scroll cap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('9. keeps the requested height under the browser device-pixel ceiling at every dpr', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 2.5, 3]) {
      const cssPx = maxScrollHeightForDevicePixelRatio(dpr);
      expect(cssPx * dpr).toBeLessThanOrEqual(BROWSER_MAX_SCROLL_DEVICE_PX);
      expect(cssPx).toBeGreaterThan(0);
    }
  });

  it('10. falls back to a 1x budget for absent or nonsensical devicePixelRatio values', () => {
    const oneX = maxScrollHeightForDevicePixelRatio(1);
    for (const bogus of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(maxScrollHeightForDevicePixelRatio(bogus)).toBe(oneX);
    }
  });

  it('11. a manager built on a 2x display caps at half the 1x budget', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const oneX = new TestScroller().maxScrollHeight;

    vi.stubGlobal('devicePixelRatio', 2);
    const twoX = new TestScroller().maxScrollHeight;

    expect(twoX).toBe(maxScrollHeightForDevicePixelRatio(2));
    expect(twoX).toBeLessThan(oneX);
    expect(twoX * 2).toBeLessThanOrEqual(BROWSER_MAX_SCROLL_DEVICE_PX);
  });

  it('13. re-derives the cap when the display dpr changes under a live manager', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const s = new TestScroller();
    s.bodySectionHeight = 75_520_000;
    s.viewportHeight = 941;
    expect(s.maxScrollHeight).toBe(maxScrollHeightForDevicePixelRatio(1));

    // Dragging the window onto a 2x monitor changes dpr; the accompanying geometry update is
    // the manager's only signal. Without re-deriving, the cap stays at the 1x budget and the
    // browser clamps the element right back to half of it.
    vi.stubGlobal('devicePixelRatio', 2);
    s.viewportHeight = 940;

    expect(s.maxScrollHeight).toBe(maxScrollHeightForDevicePixelRatio(2));
    expect(s.domHeight * 2).toBeLessThanOrEqual(BROWSER_MAX_SCROLL_DEVICE_PX);
  });

  // Firefox is a separate ceiling, not a dpr problem. It happily lays out an element up to
  // nscoord_MAX (17,895,697px) but caps the *scrollable range* at half that. Measured on a 750k
  // library at dpr 1: a 17,537,784px element reported scrollHeight 8,947,850 and refused to
  // scroll past 8,946,658 — so domScrollMax was ~2x the range the browser would actually give,
  // stranding the timeline at ~51% exactly like the Chrome HiDPI case.
  it('14. keeps the request inside Firefox’s scrollable range, not its layout ceiling', () => {
    const s = new TestScroller();
    s.bodySectionHeight = 62_760_582; // the reported Firefox library
    s.viewportHeight = 1192;
    // set last: the geometry setters re-derive the cap from the running engine
    s.maxScrollHeight = maxScrollHeightForDevicePixelRatio(1, SCROLL_CEILING_FIREFOX_PX);

    expect(s.domHeight).toBeLessThanOrEqual(SCROLL_CEILING_FIREFOX_PX);

    s.setDomScrollTop(s.domScrollMax);
    s.updateSlidingWindow();
    expect(s.scrollTop).toBeCloseTo(s.logicalScrollMax, 6);
  });

  it('15. never exceeds the Firefox scroll ceiling at any dpr', () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      const cssPx = maxScrollHeightForDevicePixelRatio(dpr, SCROLL_CEILING_FIREFOX_PX);
      expect(cssPx * dpr).toBeLessThanOrEqual(SCROLL_CEILING_FIREFOX_PX);
    }
  });

  it('12. maps the logical tail into a DOM range the 2x browser can actually deliver', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const s = new TestScroller();
    s.bodySectionHeight = 75_520_000; // the reported 750k-asset library
    s.viewportHeight = 941;

    // The element the browser will actually lay out, in device pixels.
    expect(s.domHeight * 2).toBeLessThanOrEqual(BROWSER_MAX_SCROLL_DEVICE_PX);

    // Scrolling to the real bottom must land on the last logical pixel, not ~50% of it.
    s.setDomScrollTop(s.domScrollMax);
    s.updateSlidingWindow();
    expect(s.scrollTop).toBeCloseTo(s.logicalScrollMax, 6);
  });
});
