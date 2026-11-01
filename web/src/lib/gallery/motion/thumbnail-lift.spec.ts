import {
  installThumbnailLift,
  liftOrigin,
  ORIGIN_VAR,
  SETTLE_MS,
  SETTLING_ATTR,
  TITLE_LIFT_ATTR,
  TITLE_LIFT_VAR,
  topEdgeRise,
} from '$lib/gallery/motion/thumbnail-lift';

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe('liftOrigin', () => {
  // A 1000x800 scroll area; a 200x100 photo grows 10px sideways and 5px up and down at scale 1.1.
  const clip = box(0, 0, 1000, 800);

  it('grows from the centre with room on every side', () => {
    expect(liftOrigin(box(400, 300, 200, 100), clip)).toBe('center center');
  });

  it('anchors on the edge that would cut it off', () => {
    expect(liftOrigin(box(0, 300, 200, 100), clip)).toBe('left center');
    expect(liftOrigin(box(800, 300, 200, 100), clip)).toBe('right center');
    expect(liftOrigin(box(400, 2, 200, 100), clip)).toBe('center top');
    expect(liftOrigin(box(0, 700, 200, 100), clip)).toBe('left bottom');
  });

  it('stays centred when both sides of an axis are tight', () => {
    expect(liftOrigin(box(0, 300, 1000, 100), clip)).toBe('center center');
  });
});

describe('topEdgeRise', () => {
  it('rises by half the growth from the centre, all of it from the bottom, none from the top', () => {
    expect(topEdgeRise('center center', 200)).toBeCloseTo(10);
    expect(topEdgeRise('left bottom', 200)).toBeCloseTo(20);
    expect(topEdgeRise('right top', 200)).toBe(0);
  });
});

describe('installThumbnailLift', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  const setup = () => {
    document.body.innerHTML =
      '<div data-thumbnail-focus-container id="photo"><div><img id="img" /></div></div><p id="outside"></p>';
    return {
      photo: document.querySelector('#photo')!,
      img: document.querySelector('#img')!,
      outside: document.querySelector('#outside')!,
    };
  };

  const leave = (from: Element, to: Element) =>
    from.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }));

  it('marks a photo as settling while it shrinks back, then clears it', () => {
    const { photo, img, outside } = setup();
    const uninstall = installThumbnailLift();

    leave(img, outside);
    expect(photo.hasAttribute(SETTLING_ATTR)).toBe(true);

    vi.advanceTimersByTime(SETTLE_MS);
    expect(photo.hasAttribute(SETTLING_ATTR)).toBe(false);
    uninstall();
  });

  it('sets the growth anchor when the pointer enters a photo', () => {
    const { photo, img, outside } = setup();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(box(0, 300, 200, 100) as DOMRect);
    const uninstall = installThumbnailLift();

    img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: outside }));
    expect((photo as HTMLElement).style.getPropertyValue(ORIGIN_VAR)).toBe('left center');
    uninstall();
    vi.restoreAllMocks();
  });

  it("moves the day's date up with a first-row photo, and back when it is left", () => {
    document.body.innerHTML =
      '<section data-group id="day"><div>Sun, Nov 23</div><div data-image-grid>' +
      '<div data-thumbnail-focus-container id="photo"><div><img id="img" /></div></div></div></section>' +
      '<p id="outside"></p>';
    // Every box at (400, 300), 200x200: the photo is in the grid's first row, with room on every side.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(box(400, 300, 200, 200) as DOMRect);
    const day = document.querySelector<HTMLElement>('#day')!;
    const img = document.querySelector('#img')!;
    const outside = document.querySelector('#outside')!;
    const uninstall = installThumbnailLift();

    img.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: outside }));
    expect(day.hasAttribute(TITLE_LIFT_ATTR)).toBe(true);
    expect(day.style.getPropertyValue(TITLE_LIFT_VAR)).toBe('10.0px');

    leave(img, outside);
    expect(day.hasAttribute(TITLE_LIFT_ATTR)).toBe(false);
    uninstall();
    vi.restoreAllMocks();
  });

  it('ignores moves between parts of the same photo', () => {
    const { photo, img } = setup();
    const uninstall = installThumbnailLift();

    leave(img, photo);
    expect(photo.hasAttribute(SETTLING_ATTR)).toBe(false);
    uninstall();
  });

  it('restarts the countdown when the photo is left again', () => {
    const { photo, img, outside } = setup();
    const uninstall = installThumbnailLift();

    leave(img, outside);
    vi.advanceTimersByTime(SETTLE_MS - 50);
    leave(img, outside);
    vi.advanceTimersByTime(100);
    expect(photo.hasAttribute(SETTLING_ATTR)).toBe(true);
    uninstall();
  });
});
