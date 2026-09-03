import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { Settings } from 'luxon';
import { describe, expect, it, vi } from 'vitest';
import FacePhotoModal from '$lib/components/face-cleanup/FacePhotoModal.svelte';

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return {
    ...mod,
    Icon: noop.default,
  };
});

vi.mock('svelte-i18n', async () => {
  const { readable } = await import('svelte/store');
  // Interpolating, NOT the key-echoing mock the page specs use: the date-formatting tests below assert on
  // what actually RENDERS, so a mock that drops `values` would make them unfalsifiable.
  const formatMessage = (key: string, options?: { values?: Record<string, unknown> }) => {
    const date = options?.values?.date;
    return date === undefined ? key : `${key} ${date}`;
  };
  return { locale: readable('en-US'), t: readable(formatMessage) };
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

// happy-dom reports naturalWidth/width as 0 for every <img>, so getContentMetrics would divide by zero.
// Stubbing them is what makes the overlay geometry observable at all in this runner.
const sizeImage = (img: HTMLImageElement) => {
  for (const [property, value] of [
    ['naturalWidth', 400],
    ['naturalHeight', 300],
    ['width', 800],
    ['height', 600],
  ] as const) {
    Object.defineProperty(img, property, { configurable: true, value });
  }
  fireEvent.load(img);
};

describe('FacePhotoModal', () => {
  it('T6.1: shows the admin preview for the face at `index`', () => {
    render(FacePhotoModal, { faces: [face(), face({ assetFaceId: 'face-2' })], index: 1, onClose: vi.fn() });

    expect(screen.getByTestId('face-photo')).toHaveAttribute('src', '/api/admin/face-repair/faces/face-2/preview');
  });

  it('T6.2/T6.23: draws exactly one box, positioned from the rendered image metrics', async () => {
    render(FacePhotoModal, { faces: [face()], index: 0, onClose: vi.fn() });
    sizeImage(screen.getByTestId('face-photo') as HTMLImageElement);

    const boxes = await screen.findAllByTestId('face-photo-box');
    expect(boxes).toHaveLength(1);
    // 400x300 natural inside 800x600 client => contentWidth 800, offset 0; x1 100/400 * 800 = 200.
    expect(boxes[0].style.left).toBe('200px');
    expect(boxes[0].style.width).toBe('200px');
  });

  it('T6.3: renders the photo but no box when imageWidth is 0', () => {
    render(FacePhotoModal, { faces: [face({ imageWidth: 0 })], index: 0, onClose: vi.fn() });
    sizeImage(screen.getByTestId('face-photo') as HTMLImageElement);

    expect(screen.getByTestId('face-photo')).toBeInTheDocument(); // positive control
    expect(screen.queryByTestId('face-photo-box')).not.toBeInTheDocument();
  });

  it('T6.4: renders no box for a degenerate box', () => {
    render(FacePhotoModal, { faces: [face({ boundingBoxX2: 100 })], index: 0, onClose: vi.fn() });
    sizeImage(screen.getByTestId('face-photo') as HTMLImageElement);

    expect(screen.getByTestId('face-photo')).toBeInTheDocument();
    expect(screen.queryByTestId('face-photo-box')).not.toBeInTheDocument();
  });

  it('T6.5: clamps a box that runs past the image edge', async () => {
    render(FacePhotoModal, { faces: [face({ boundingBoxX1: -100, boundingBoxX2: 900 })], index: 0, onClose: vi.fn() });
    sizeImage(screen.getByTestId('face-photo') as HTMLImageElement);

    const box = await screen.findByTestId('face-photo-box');
    expect(box.style.left).toBe('0px');
    expect(box.style.width).toBe('800px');
  });

  it('T6.6: the arrows page forward and back, and the photo follows', async () => {
    render(FacePhotoModal, { faces: [face(), face({ assetFaceId: 'face-2' })], index: 0, onClose: vi.fn() });

    await fireEvent.click(screen.getByTestId('face-photo-next'));
    expect(screen.getByTestId('face-photo')).toHaveAttribute('src', '/api/admin/face-repair/faces/face-2/preview');

    await fireEvent.click(screen.getByTestId('face-photo-prev'));
    expect(screen.getByTestId('face-photo')).toHaveAttribute('src', '/api/admin/face-repair/faces/face-1/preview');
  });

  it('T6.7: clamps at both ends rather than wrapping', () => {
    const { unmount } = render(FacePhotoModal, {
      faces: [face(), face({ assetFaceId: 'face-2' })],
      index: 0,
      onClose: vi.fn(),
    });
    expect(screen.getByTestId('face-photo-prev')).toBeDisabled();
    expect(screen.getByTestId('face-photo-next')).toBeEnabled(); // positive control
    unmount();

    render(FacePhotoModal, { faces: [face(), face({ assetFaceId: 'face-2' })], index: 1, onClose: vi.fn() });
    expect(screen.getByTestId('face-photo-next')).toBeDisabled();
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
  it('T6.9a: a 00:30Z photo keeps its own day in a zone behind UTC', () => {
    const previousZone = Settings.defaultZone;
    Settings.defaultZone = 'America/Los_Angeles';

    try {
      render(FacePhotoModal, {
        faces: [face({ localDateTime: '2019-07-04T00:30:00.000Z' })],
        index: 0,
        onClose: vi.fn(),
      });

      expect(screen.getByTestId('face-photo-taken')).toHaveTextContent('Jul 4, 2019');
      expect(screen.getByTestId('face-photo-taken')).not.toHaveTextContent('Jul 3');
    } finally {
      Settings.defaultZone = previousZone;
    }
  });

  it('T6.9b: a 23:30Z photo keeps its own day in a zone ahead of UTC', () => {
    const previousZone = Settings.defaultZone;
    Settings.defaultZone = 'Asia/Tokyo';

    try {
      render(FacePhotoModal, {
        faces: [face({ localDateTime: '2019-07-04T23:30:00.000Z' })],
        index: 0,
        onClose: vi.fn(),
      });

      expect(screen.getByTestId('face-photo-taken')).toHaveTextContent('Jul 4, 2019');
      expect(screen.getByTestId('face-photo-taken')).not.toHaveTextContent('Jul 5');
    } finally {
      Settings.defaultZone = previousZone;
    }
  });

  it('T6.10: omits the caption rather than rendering "Invalid DateTime"', () => {
    render(FacePhotoModal, { faces: [face({ localDateTime: 'not-a-date' })], index: 0, onClose: vi.fn() });

    expect(screen.queryByTestId('face-photo-taken')).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid DateTime/)).not.toBeInTheDocument();
  });
});
