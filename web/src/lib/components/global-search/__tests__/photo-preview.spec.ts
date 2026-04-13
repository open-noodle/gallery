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
});
