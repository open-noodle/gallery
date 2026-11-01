import { estimateTarget, installViewerZoom, transformBetween } from '$lib/gallery/motion/viewer-zoom';

describe('estimateTarget', () => {
  const viewport = { width: 1000, height: 800 };

  it('fits a landscape photo to the window width, centred vertically', () => {
    expect(estimateTarget(2, viewport)).toEqual({ left: 0, top: 150, width: 1000, height: 500 });
  });

  it('fits a portrait photo to the window height, centred horizontally', () => {
    expect(estimateTarget(0.5, viewport)).toEqual({ left: 300, top: 0, width: 400, height: 800 });
  });
});

describe('transformBetween', () => {
  it('maps the laid-out box onto the target box', () => {
    const base = { left: 100, top: 50, width: 400, height: 200 };
    expect(transformBetween({ left: 10, top: 20, width: 100, height: 50 }, base)).toBe(
      'translate(-90px, -30px) scale(0.25, 0.25)',
    );
    expect(transformBetween(base, base)).toBe('translate(0px, 0px) scale(1, 1)');
  });
});

describe('installViewerZoom', () => {
  let uninstall: () => void;

  const thumbnail = () => {
    document.body.innerHTML = `
      <div data-thumbnail-focus-container data-asset="a1" role="link">
        <img src="/api/assets/a1/thumbnail?size=thumbnail" />
        <a href="/photos/a1" aria-label="Thumbnail URL"></a>
        <button role="checkbox" aria-checked="false"><span data-icon-select></span></button>
      </div>`;
    const image = document.querySelector('img')!;
    Object.defineProperty(image, 'currentSrc', { value: image.src });
    image.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 10, width: 100, height: 100 });
    return document.querySelector<HTMLElement>('[data-thumbnail-focus-container]')!;
  };
  const flyers = () => document.querySelectorAll('[data-motion-flyer]').length;

  beforeEach(() => {
    Element.prototype.animate ??= vi.fn() as unknown as Element['animate'];
    uninstall = installViewerZoom();
  });

  afterEach(() => {
    uninstall();
    document.body.replaceChildren();
  });

  it('puts the copy up when the photo itself is clicked', () => {
    thumbnail().querySelector('img')!.click();
    expect(flyers()).toBe(1);
  });

  it('puts the copy up when the link covering a hovered photo is clicked', () => {
    thumbnail().querySelector('a')!.click();
    expect(flyers()).toBe(1);
  });

  it('puts no copy up when the select circle is clicked, which never opens the viewer', () => {
    thumbnail().querySelector<HTMLElement>('[data-icon-select]')!.click();
    expect(flyers()).toBe(0);
  });
});
