import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import PhotoPreview from '../previews/photo-preview.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  return { ...mod, Button: mod.Button };
});

describe('photo-preview', () => {
  it('renders filename + exif lines', () => {
    render(PhotoPreview, {
      props: {
        photo: {
          id: 'a1',
          originalFileName: 'sunset.jpg',
          exifInfo: {
            dateTimeOriginal: '2024-03-01T00:00:00Z',
            city: 'Santa Cruz',
            make: 'Canon',
            fNumber: 2.8,
            exposureTime: '1/125',
          },
        } as never,
      },
    });
    expect(screen.getByText('sunset.jpg')).toBeInTheDocument();
    expect(screen.getByText(/Santa Cruz/)).toBeInTheDocument();
    expect(screen.getByText(/Canon/)).toBeInTheDocument();
  });

  it('renders without exif subtitle when exifInfo is missing', () => {
    render(PhotoPreview, {
      props: { photo: { id: 'a1', originalFileName: 'plain.jpg' } as never },
    });
    expect(screen.getByText('plain.jpg')).toBeInTheDocument();
  });

  it('wraps the image in an explicit-height flex-centered frame (not aspect-ratio)', () => {
    // Regression guard for the long chain of preview-clipping bugs:
    //   1. object-cover cropped portraits/landscapes.
    //   2. aspect-[4/3] + h-full overflowed because percent heights don't resolve
    //      reliably inside aspect-ratio containers.
    //   3. A bare img with max-h worked in isolation but the parent flex context
    //      (h-full cascade + content-sized row) still produced clipping.
    // The current pattern: a fixed h-[200px] flex-center wrapper with overflow-hidden,
    // and the img capped at max-h-full / max-w-full with object-contain. Every
    // dimension is definite (pixels, not percents or aspect ratios) so the image can
    // never overflow or clip its container regardless of source aspect ratio.
    const { container } = render(PhotoPreview, {
      props: { photo: { id: 'a1', originalFileName: 'plain.jpg' } as never },
    });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.className).toContain('object-contain');
    expect(img?.className).not.toContain('object-cover');
    expect(img?.className).toContain('max-h-full');
    expect(img?.className).toContain('max-w-full');
    // Parent frame assertions — fixed 200px height, flex-centered, overflow-hidden.
    const frame = img?.parentElement as HTMLElement | null;
    expect(frame?.className).toContain('h-[200px]');
    expect(frame?.className).toContain('items-center');
    expect(frame?.className).toContain('justify-center');
    expect(frame?.className).toContain('overflow-hidden');
    // Explicitly guard against the earlier aspect-ratio approach.
    expect(frame?.className).not.toContain('aspect-[4/3]');
  });
});
