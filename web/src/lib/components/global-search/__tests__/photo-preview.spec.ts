import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
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

  it('letterboxes the image with object-contain (not cropped via object-cover)', () => {
    // Regression guard: images inside the preview must NOT be cropped to fit 4:3 —
    // portrait photos would lose their top/bottom and the user sees a "cut off"
    // preview. Instead, wrap in an aspect-[4/3] container with bg-subtle and use
    // object-contain so the full image shows, letterboxed when the source aspect
    // doesn't match.
    const { container } = render(PhotoPreview, {
      props: { photo: { id: 'a1', originalFileName: 'plain.jpg' } as never },
    });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.className).toContain('object-contain');
    expect(img?.className).not.toContain('object-cover');
    // The aspect-ratio frame is on the parent wrapper, not the image itself.
    const frame = img?.parentElement as HTMLElement | null;
    expect(frame?.className).toContain('aspect-[4/3]');
  });
});
