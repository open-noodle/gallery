import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import PhotoRow from '../rows/photo-row.svelte';

describe('photo-row', () => {
  it('renders filename and subtitle from exifInfo', async () => {
    await render(PhotoRow, {
      props: {
        item: {
          id: 'a1',
          originalFileName: 'sunset.jpg',
          exifInfo: { dateTimeOriginal: '2024-03-01T00:00:00Z', city: 'Santa Cruz' },
        } as never,
      },
    });
    await expect.element(page.getByText('sunset.jpg')).toBeInTheDocument();
    await expect.element(page.getByText(/Santa Cruz/)).toBeInTheDocument();
  });

  it('uses /api/ asset thumbnail URL', async () => {
    const { container } = await render(PhotoRow, {
      props: { item: { id: 'a1', originalFileName: 'x.jpg' } as never },
    });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toContain('/api/');
  });

  it('does NOT set role="option" — Command.Item wraps it', async () => {
    const { container } = await render(PhotoRow, {
      props: { item: { id: 'a1', originalFileName: 'x.jpg' } as never },
    });
    expect(container.querySelector('[role="option"]')).toBeNull();
  });

  it('renders without subtitle when exifInfo is missing', async () => {
    await render(PhotoRow, {
      props: { item: { id: 'a1', originalFileName: 'plain.jpg' } as never },
    });
    await expect.element(page.getByText('plain.jpg')).toBeInTheDocument();
  });
});
