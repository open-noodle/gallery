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

  it('constrains the image via max-h + object-contain without aspect-ratio wrapping', () => {
    // Regression guard for two related bugs:
    //   1. `object-cover` cropped portraits and landscapes — replaced with object-contain.
    //   2. `aspect-[4/3]` + `h-full` caused overflow because percent heights don't
    //      resolve reliably inside aspect-ratio containers, so h-full fell back to the
    //      image's natural height and spilled out of the overflow-hidden frame.
    // The current pattern: a direct `max-h-[200px] max-w-full object-contain` on the
    // <img> with `mx-auto` for horizontal centering. No wrapper frame, no percent
    // heights — just natural sizing capped by max-h.
    const { container } = render(PhotoPreview, {
      props: { photo: { id: 'a1', originalFileName: 'plain.jpg' } as never },
    });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.className).toContain('object-contain');
    expect(img?.className).not.toContain('object-cover');
    expect(img?.className).toContain('max-h-[200px]');
    expect(img?.className).toContain('max-w-full');
    // Explicitly assert the image is NOT wrapped in an aspect-ratio frame — this
    // prevents anyone from reintroducing the h-full-inside-aspect-ratio pattern.
    const parent = img?.parentElement as HTMLElement | null;
    expect(parent?.className).not.toContain('aspect-[4/3]');
  });
});
