import FacePhotoModal from '#lib/components/face-cleanup/FacePhotoModal.svelte';
import { Settings } from 'luxon';
import { init, register, waitLocale } from 'svelte-i18n';
import { SvelteSet } from 'svelte/reactivity';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return {
    ...mod,
    Icon: noop.default,
  };
});

// Real English strings, NOT the key-echoing `dev` locale: the date-formatting tests below assert on what
// actually RENDERS, so a translation that drops `values` would make them unfalsifiable. (A `vi.mock` of
// svelte-i18n cannot work in browser mode: the test setup has already loaded the real module.)
beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
  await waitLocale('en-US');
});

const face = (overrides: Record<string, unknown> = {}) => ({
  assetFaceId: 'face-1',
  localDateTime: '2019-07-04T10:30:00.000Z',
  imageWidth: 400,
  imageHeight: 300,
  boundingBoxX1: 100,
  boundingBoxY1: 75,
  boundingBoxX2: 200,
  boundingBoxY2: 150,
  ...overrides,
});

// The preview URL never loads in the unit tier (it 404s), so naturalWidth is 0 and getContentMetrics would
// divide by zero. Stubbing the four metrics pins the overlay geometry to known numbers.
const sizeImage = (img: HTMLImageElement) => {
  for (const [property, value] of [
    ['naturalWidth', 400],
    ['naturalHeight', 300],
    ['width', 800],
    ['height', 600],
  ] as const) {
    Object.defineProperty(img, property, { configurable: true, value });
  }
  img.dispatchEvent(new Event('load'));
};

describe('FacePhotoModal', () => {
  it('T6.1: shows the admin preview for the face at `index`', async () => {
    await render(FacePhotoModal, { faces: [face(), face({ assetFaceId: 'face-2' })], index: 1, onClose: vi.fn() });

    await expect
      .element(page.getByTestId('face-photo'))
      .toHaveAttribute('src', '/api/admin/face-repair/faces/face-2/preview');
  });

  it('T6.2/T6.23: draws exactly one box, positioned from the rendered image metrics', async () => {
    await render(FacePhotoModal, { faces: [face()], index: 0, onClose: vi.fn() });
    sizeImage((await page.getByTestId('face-photo').findElement()) as HTMLImageElement);

    await expect.element(page.getByTestId('face-photo-box').first()).toBeInTheDocument();
    const boxes = page.getByTestId('face-photo-box').elements();
    expect(boxes).toHaveLength(1);
    // 400x300 natural inside 800x600 client => contentWidth 800, offset 0; x1 100/400 * 800 = 200.
    expect(boxes[0].style.left).toBe('200px');
    expect(boxes[0].style.width).toBe('200px');
  });

  // I1 regression: the image metrics are stubbed (the preview never loads here), so this runner cannot
  // reproduce the actual portrait misalignment (the box would land at the same computed offset either way). What CAN be pinned structurally is the
  // coordinate origin the box and the img must share: `left`/`top` are measured from getContentMetrics(img),
  // which is relative to the IMG's own box. If the img's positioning ancestor (the nearest `position:relative`
  // element) is a wider element than the img itself — e.g. a `justify-center` flex row that centers the img
  // inside it — the box's offset and the img's rendered position diverge by exactly the centring gap, which is
  // 0 for a landscape photo that fills the row and nonzero for a portrait one. Asserting the box's offset
  // parent is an element that shrink-wraps the img (i.e. is not the outer flex/justify-center container) is
  // the structural invariant that catches a reintroduction of that bug even though this runner can't measure
  // the pixel gap directly.
  it('I1: the box and the img share the same offset parent, not the outer centring container', async () => {
    await render(FacePhotoModal, { faces: [face()], index: 0, onClose: vi.fn() });
    const img = (await page.getByTestId('face-photo').findElement()) as HTMLImageElement;
    sizeImage(img);

    const box = await page.getByTestId('face-photo-box').findElement();

    // The box's positioning parent must be the SAME element that directly wraps the img — not some ancestor
    // further out. `position:absolute` resolves against the nearest positioned ancestor, so this is exactly
    // "do they share a coordinate origin".
    const boxParent = box.parentElement;
    expect(boxParent).not.toBeNull();
    await expect.element(page.elementLocator(boxParent!)).toContainElement(img);

    // The regression this guards against: wrapping the img directly in the `justify-center` flex row (no
    // shrink-wrapping element in between) would make the box's parent equal the img's parent AND that parent
    // a flex container that centers a narrower img inside a wider box — i.e. the img's own parent is the
    // `justify-center` container. A correct, shrink-wrapped structure puts a dedicated element between the
    // flex row and the img, so the img's parent must NOT itself carry `justify-center`.
    const imgParent = img.parentElement;
    expect(imgParent).not.toBeNull();
    expect(imgParent?.className).not.toMatch(/justify-center/);
  });

  it('T6.3: renders the photo but no box when imageWidth is 0', async () => {
    await render(FacePhotoModal, { faces: [face({ imageWidth: 0 })], index: 0, onClose: vi.fn() });
    sizeImage((await page.getByTestId('face-photo').findElement()) as HTMLImageElement);

    await expect.element(page.getByTestId('face-photo')).toBeInTheDocument(); // positive control
    await expect.element(page.getByTestId('face-photo-box')).not.toBeInTheDocument();
  });

  it('T6.4: renders no box for a degenerate box', async () => {
    await render(FacePhotoModal, { faces: [face({ boundingBoxX2: 100 })], index: 0, onClose: vi.fn() });
    sizeImage((await page.getByTestId('face-photo').findElement()) as HTMLImageElement);

    await expect.element(page.getByTestId('face-photo')).toBeInTheDocument();
    await expect.element(page.getByTestId('face-photo-box')).not.toBeInTheDocument();
  });

  it('T6.5: clamps a box that runs past the image edge', async () => {
    await render(FacePhotoModal, {
      faces: [face({ boundingBoxX1: -100, boundingBoxX2: 900 })],
      index: 0,
      onClose: vi.fn(),
    });
    sizeImage((await page.getByTestId('face-photo').findElement()) as HTMLImageElement);

    const box = await page.getByTestId('face-photo-box').findElement();
    expect(box.style.left).toBe('0px');
    expect(box.style.width).toBe('800px');
  });

  it('T6.6: the arrows page forward and back, and the photo follows', async () => {
    await render(FacePhotoModal, { faces: [face(), face({ assetFaceId: 'face-2' })], index: 0, onClose: vi.fn() });

    await userEvent.click(page.getByTestId('face-photo-next'));
    await expect
      .element(page.getByTestId('face-photo'))
      .toHaveAttribute('src', '/api/admin/face-repair/faces/face-2/preview');

    await userEvent.click(page.getByTestId('face-photo-prev'));
    await expect
      .element(page.getByTestId('face-photo'))
      .toHaveAttribute('src', '/api/admin/face-repair/faces/face-1/preview');
  });

  it('T6.7: clamps at both ends rather than wrapping', async () => {
    const { unmount } = await render(FacePhotoModal, {
      faces: [face(), face({ assetFaceId: 'face-2' })],
      index: 0,
      onClose: vi.fn(),
    });
    await expect.element(page.getByTestId('face-photo-prev')).toBeDisabled();
    await expect.element(page.getByTestId('face-photo-next')).toBeEnabled(); // positive control
    await unmount();

    await render(FacePhotoModal, { faces: [face(), face({ assetFaceId: 'face-2' })], index: 1, onClose: vi.fn() });
    await expect.element(page.getByTestId('face-photo-next')).toBeDisabled();
  });

  // E13 — localDateTime stores local wall-clock time as a UTC timestamp, so it must be parsed with
  // zone: 'UTC'. `vite.config.ts` pins `env.TZ = 'UTC'` for every vitest run, so without deliberately
  // overriding the zone here, neither case below could ever distinguish a UTC parse from a local one — do
  // not delete these overrides as noise. `process.env.TZ` does NOT work for this: Node/ICU resolves and
  // caches the process's timezone from the pinned env var before these tests run, so reassigning
  // process.env.TZ mid-process is silently ignored by Luxon/Intl here (verified: both cases below still
  // passed even with `zone: 'UTC'` removed from the component while using that approach). Luxon's own
  // `Settings.defaultZone` is in-process and is read on every parse, so it isn't subject to that caching.
  // Each case pins a fixed zone (not the runner's own) so it is unconditionally discriminating on any
  // machine: T6.9a pins a zone BEHIND UTC, where a naive local parse of a 00:30Z photo would render 3 July;
  // T6.9b pins a zone AHEAD of UTC, where a naive local parse of a 23:30Z photo would render 5 July.
  it('T6.9a: a 00:30Z photo keeps its own day in a zone behind UTC', async () => {
    const previousZone = Settings.defaultZone;
    Settings.defaultZone = 'America/Los_Angeles';

    try {
      await render(FacePhotoModal, {
        faces: [face({ localDateTime: '2019-07-04T00:30:00.000Z' })],
        index: 0,
        onClose: vi.fn(),
      });

      await expect.element(page.getByTestId('face-photo-taken')).toMatchTextContent('Jul 4, 2019');
      await expect.element(page.getByTestId('face-photo-taken')).not.toMatchTextContent('Jul 3');
    } finally {
      Settings.defaultZone = previousZone;
    }
  });

  it('T6.9b: a 23:30Z photo keeps its own day in a zone ahead of UTC', async () => {
    const previousZone = Settings.defaultZone;
    Settings.defaultZone = 'Asia/Tokyo';

    try {
      await render(FacePhotoModal, {
        faces: [face({ localDateTime: '2019-07-04T23:30:00.000Z' })],
        index: 0,
        onClose: vi.fn(),
      });

      await expect.element(page.getByTestId('face-photo-taken')).toMatchTextContent('Jul 4, 2019');
      await expect.element(page.getByTestId('face-photo-taken')).not.toMatchTextContent('Jul 5');
    } finally {
      Settings.defaultZone = previousZone;
    }
  });

  it('T6.10: omits the caption rather than rendering "Invalid DateTime"', async () => {
    await render(FacePhotoModal, { faces: [face({ localDateTime: 'not-a-date' })], index: 0, onClose: vi.fn() });

    await expect.element(page.getByTestId('face-photo-taken')).not.toBeInTheDocument();
    await expect.element(page.getByText(/Invalid DateTime/)).not.toBeInTheDocument();
  });

  // Selecting from inside the lightbox. The point is triage without closing: page through 48 faces, marking
  // the wrong ones as you go, then apply once from the dock. This does NOT weaken "opening a photo never
  // stages a decision" — that invariant is about the MAGNIFIER click (pinned by the page specs' T7.3/T7.6/
  // T8.2); the control below is a deliberate, explicit act taken inside the modal.
  describe('selection', () => {
    it('renders no selection control when the caller does not supply one', async () => {
      await render(FacePhotoModal, { faces: [face()], index: 0, onClose: vi.fn() });

      await expect.element(page.getByTestId('face-photo')).toBeInTheDocument(); // positive control: the modal did render
      await expect.element(page.getByTestId('face-photo-select')).not.toBeInTheDocument();
    });

    it('toggles the CURRENT face, and keeps targeting the right face after paging', async () => {
      const onToggleSelect = vi.fn();
      await render(FacePhotoModal, {
        faces: [face(), face({ assetFaceId: 'face-2' })],
        index: 0,
        onClose: vi.fn(),
        isSelected: () => false,
        onToggleSelect,
      });

      await userEvent.click(page.getByTestId('face-photo-select'));
      expect(onToggleSelect).toHaveBeenCalledWith('face-1');

      await userEvent.click(page.getByTestId('face-photo-next'));
      await userEvent.click(page.getByTestId('face-photo-select'));
      expect(onToggleSelect).toHaveBeenLastCalledWith('face-2');
    });

    it("reflects the current face's selection state", async () => {
      const { unmount } = await render(FacePhotoModal, {
        faces: [face()],
        index: 0,
        onClose: vi.fn(),
        isSelected: () => false,
        onToggleSelect: vi.fn(),
      });
      await expect.element(page.getByTestId('face-photo-select')).toHaveAttribute('aria-pressed', 'false');
      await unmount();

      await render(FacePhotoModal, {
        faces: [face()],
        index: 0,
        onClose: vi.fn(),
        isSelected: () => true,
        onToggleSelect: vi.fn(),
      });
      await expect.element(page.getByTestId('face-photo-select')).toHaveAttribute('aria-pressed', 'true');
    });

    it('Space toggles the current face', async () => {
      const onToggleSelect = vi.fn();
      await render(FacePhotoModal, {
        faces: [face()],
        index: 0,
        onClose: vi.fn(),
        isSelected: () => false,
        onToggleSelect,
      });

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      expect(onToggleSelect).toHaveBeenCalledWith('face-1');
    });

    // The rest-of-cluster grid's gate is ASYMMETRIC: a staged face can always be removed, but a new one can
    // only be added once a valid destination is chosen — otherwise the tile ribbon would name a destination
    // Apply refuses to use. The modal must mirror that exactly, or the control lies about what it will do.
    it('disables ADDING when the caller says the face cannot be selected', async () => {
      await render(FacePhotoModal, {
        faces: [face()],
        index: 0,
        onClose: vi.fn(),
        isSelected: () => false,
        canSelect: () => false,
        onToggleSelect: vi.fn(),
      });

      await expect.element(page.getByTestId('face-photo-select')).toBeDisabled();
    });

    it('still allows REMOVING an already-selected face when adding is gated', async () => {
      const onToggleSelect = vi.fn();
      await render(FacePhotoModal, {
        faces: [face()],
        index: 0,
        onClose: vi.fn(),
        isSelected: () => true,
        canSelect: () => false,
        onToggleSelect,
      });

      const control = page.getByTestId('face-photo-select');
      await expect.element(control).toBeEnabled(); // the asymmetry: deselecting is never blocked
      await userEvent.click(control);
      expect(onToggleSelect).toHaveBeenCalledWith('face-1');
    });

    // The callers hand in closures over their own reactive stores, so the control's pressed state only tracks
    // reality if reading through that closure inside a $derived registers the dependency. A plain object or a
    // captured boolean would render correctly once and then go stale — the button would stop reflecting the
    // selection the moment the admin used it, which is exactly the workflow this control exists for.
    it('updates its pressed state when the caller’s selection changes underneath it', async () => {
      const staged = new SvelteSet<string>();
      await render(FacePhotoModal, {
        faces: [face()],
        index: 0,
        onClose: vi.fn(),
        isSelected: (id: string) => staged.has(id),
        onToggleSelect: (id: string) => (staged.has(id) ? staged.delete(id) : staged.add(id)),
      });

      const control = page.getByTestId('face-photo-select');
      await expect.element(control).toHaveAttribute('aria-pressed', 'false');

      await userEvent.click(control);
      await expect.element(page.getByTestId('face-photo-select')).toHaveAttribute('aria-pressed', 'true');

      await userEvent.click(page.getByTestId('face-photo-select'));
      await expect.element(page.getByTestId('face-photo-select')).toHaveAttribute('aria-pressed', 'false');
    });

    it('does not fire on Space when adding is gated', async () => {
      const onToggleSelect = vi.fn();
      await render(FacePhotoModal, {
        faces: [face()],
        index: 0,
        onClose: vi.fn(),
        isSelected: () => false,
        canSelect: () => false,
        onToggleSelect,
      });

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      expect(onToggleSelect).not.toHaveBeenCalled();
    });
  });
});
