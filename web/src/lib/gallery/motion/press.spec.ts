import { hoverScale, installPressFeedback, lastPressPoint, pressScale } from '$lib/gallery/motion/press';

describe('pressScale', () => {
  it('dips small controls the most, capped at 0.86', () => {
    expect(pressScale(24)).toBe(0.86);
    expect(pressScale(100)).toBeCloseTo(0.86);
  });

  it('squishes about 14px across wider buttons', () => {
    expect(pressScale(200)).toBeCloseTo(0.93);
  });

  it('still moves wide rows', () => {
    expect(pressScale(500)).toBe(0.95);
    expect(pressScale(2000)).toBe(0.95);
  });
});

describe('hoverScale', () => {
  it('pops icons the most, capped at 1.1', () => {
    expect(hoverScale(40)).toBe(1.1);
  });

  it('grows wide buttons less', () => {
    expect(hoverScale(300)).toBe(1.02);
  });
});

describe('installPressFeedback', () => {
  let uninstall: () => void;
  let animate: ReturnType<typeof vi.fn>;

  const press = (element: Element) => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 20 }));
  };

  beforeEach(() => {
    animate = vi.fn(() => ({ cancel: vi.fn() }));
    Element.prototype.animate = animate as unknown as Element['animate'];
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 36 } as DOMRect);
    uninstall = installPressFeedback();
  });

  afterEach(() => {
    uninstall();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('squishes a pressed button and springs it back on release', async () => {
    document.body.innerHTML = '<button><span id="label">Save</span></button>';
    press(document.querySelector('#label')!);

    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0]).toEqual([{ scale: 1 }, { scale: 0.86 }]);
    expect(document.querySelector('button')!.dataset.justPressed).toBe('');

    // a quick tap still lets the dip land before springing back
    document.dispatchEvent(new PointerEvent('pointerup'));
    expect(animate).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(animate).toHaveBeenCalledTimes(2));
    expect(animate.mock.calls[1][0][1]).toEqual({ scale: 1 });
  });

  it('grows a hovered button under the mouse, and not menu rows', () => {
    document.body.innerHTML = '<button id="b">b</button><div role="menuitem" id="m">m</div>';
    const hover = (id: string, pointerType = 'mouse') =>
      document.querySelector(`#${id}`)!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType }));

    hover('m');
    hover('b', 'touch');
    expect(animate).not.toHaveBeenCalled();

    hover('b');
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0]).toEqual([{ scale: 1 }, { scale: 1.05 }]);

    document
      .querySelector('#b')!
      .dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[1][0].at(-1)).toEqual({ scale: 1 });
  });

  it('keeps the press but skips the hover grow on data-no-hover-grow', () => {
    document.body.innerHTML = '<button data-no-hover-grow id="chip">2022</button>';
    const chip = document.querySelector('#chip')!;
    chip.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    expect(animate).not.toHaveBeenCalled();

    press(chip);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('leaves disabled and opted-out controls alone', () => {
    document.body.innerHTML = '<button disabled>a</button><div data-no-press><button>b</button></div>';
    for (const button of document.querySelectorAll('button')) {
      press(button);
    }
    expect(animate).not.toHaveBeenCalled();
  });

  it('leaves map markers alone, on press and on hover', () => {
    document.body.innerHTML = '<div class="maplibregl-map"><div role="button" id="marker">12</div></div>';
    const marker = document.querySelector('#marker')!;
    press(marker);
    marker.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    expect(animate).not.toHaveBeenCalled();
  });

  it('leaves surfaces larger than a control alone', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1200, height: 800 } as DOMRect);
    document.body.innerHTML = '<button>backdrop</button>';
    press(document.querySelector('button')!);
    expect(animate).not.toHaveBeenCalled();
  });

  it('records where the pointer pressed, and forgets it on keyboard input', () => {
    document.body.innerHTML = '<p>text</p>';
    press(document.querySelector('p')!);
    expect(lastPressPoint(1000)).toMatchObject({ x: 10, y: 20 });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    expect(lastPressPoint(1000)).toBeUndefined();
  });
});
