import { animateRemoval, arcControl, arcPoint } from '#lib/gallery/motion/removal.ts';

describe('arc', () => {
  const from = { x: 400, y: 300 };
  const to = { x: 40, y: 500 };

  it('runs from the photo to the target', () => {
    const control = arcControl(from, to);
    expect(arcPoint(from, control, to, 0)).toEqual(from);
    expect(arcPoint(from, control, to, 1)).toEqual(to);
  });

  it('peaks above the higher end, so photos are thrown rather than slid', () => {
    const control = arcControl(from, to);
    expect(arcPoint(from, control, to, 0.25).y).toBeLessThan(from.y);
  });
});

describe('animateRemoval', () => {
  let animate: ReturnType<typeof vi.fn>;

  const rect = (left: number, top: number, size: number) =>
    ({ left, top, width: size, height: size, right: left + size, bottom: top + size }) as DOMRect;

  beforeEach(() => {
    animate = vi.fn(() => ({ finished: Promise.resolve() }));
    Element.prototype.animate = animate as unknown as Element['animate'];
    document.body.innerHTML = `
      <nav><a href="/archive"><svg></svg>Archive</a><a href="/trash"><svg></svg>Trash</a></nav>
      <div data-asset="a1"><img src="/a1.jpg" /></div>
      <div data-asset="a2"><img src="/a2.jpg" /></div>`;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.matches('a') ? rect(10, 500, 40) : rect(300, 200, 120);
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const layer = () => document.querySelector('[data-gallery-removal]');

  it('throws each visible photo into the Trash link, which gulps them', async () => {
    animateRemoval(['a1', 'a2', 'not-on-screen'], 'trash');

    const ghosts = layer()!.querySelectorAll('img');
    expect([...ghosts].map((image) => new URL(image.src, 'http://x').pathname)).toEqual(['/a1.jpg', '/a2.jpg']);
    // two flights plus the link's gulp
    expect(animate).toHaveBeenCalledTimes(3);
    const lastFrame = animate.mock.calls[0][0].at(-1);
    // centre of the photo (360, 260) to the centre of the link (30, 520)
    expect(lastFrame.translate).toBe('-330px 260px');

    await vi.waitFor(() => expect(layer()).toBeNull());
  });

  it('throws archived photos into the Archive link', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.matches('a[href="/archive"]')) {
        return rect(10, 400, 40);
      }
      return this.matches('a') ? rect(10, 500, 40) : rect(300, 200, 120);
    });
    animateRemoval(['a1'], 'archive');
    expect(animate.mock.calls[0][0].at(-1).translate).toBe('-330px 160px');
  });

  it('dissolves photos in place on a permanent delete', () => {
    animateRemoval(['a1'], 'delete');
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0].at(-1).filter).toContain('blur');
  });

  it('does nothing when none of the photos are on screen', () => {
    animateRemoval(['missing'], 'trash');
    expect(layer()).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it('respects reduced motion', () => {
    vi.spyOn(globalThis, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    animateRemoval(['a1'], 'trash');
    expect(layer()).toBeNull();
  });
});
