import { installTilt, MAX_TILT, tiltFor } from '$lib/gallery/motion/tilt';

describe('tiltFor', () => {
  const rect = { left: 0, top: 0, width: 200, height: 100 };

  it('lies flat with the pointer at the centre', () => {
    const { rotateX, rotateY } = tiltFor(rect, 100, 50);
    expect(Math.abs(rotateX)).toBe(0);
    expect(rotateY).toBe(0);
  });

  it('dips the corner under the pointer by the full angle at the edge', () => {
    expect(tiltFor(rect, 200, 0)).toEqual({ rotateX: MAX_TILT, rotateY: MAX_TILT });
    expect(tiltFor(rect, 0, 100)).toEqual({ rotateX: -MAX_TILT, rotateY: -MAX_TILT });
  });

  it('clamps a pointer outside the card', () => {
    expect(tiltFor(rect, 500, 50).rotateY).toBe(MAX_TILT);
  });
});

describe('installTilt', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('sets the tilt on the hovered card picture and clears it on leaving', () => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    } as DOMRect);
    document.body.innerHTML =
      '<a data-motion-lift-group id="card"><div data-motion-lift id="picture"></div></a><p id="outside"></p>';
    const uninstall = installTilt();
    const picture = document.querySelector<HTMLElement>('#picture')!;
    const move = (id: string, clientX: number, clientY: number) =>
      document
        .querySelector(`#${id}`)!
        .dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX, clientY }));

    move('picture', 100, 50);
    expect(picture.style.getPropertyValue('--gallery-tilt-y')).toBe(`${MAX_TILT.toFixed(2)}deg`);

    move('outside', 0, 0);
    expect(picture.style.getPropertyValue('--gallery-tilt-y')).toBe('');
    uninstall();
  });
});
