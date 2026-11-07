import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import AlbumRow from './album-row.svelte';

vi.mock('@immich/ui', async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  IconButton: vi.fn(() => ({ $$typeof: Symbol.for('svelte.component') })),
}));

describe('album-row', () => {
  const baseProps = {
    item: {
      id: 'a1',
      albumName: 'Hawaii 2024',
      shared: false,
      albumThumbnailAssetId: 't1',
      assetCount: 5,
    },
    isPending: false,
  };

  it('renders album name', async () => {
    await render(AlbumRow, { props: baseProps as never });
    await expect.element(page.getByText('Hawaii 2024')).toBeInTheDocument();
  });

  it('renders shared badge when shared=true', async () => {
    await render(AlbumRow, {
      props: { ...baseProps, item: { ...baseProps.item, shared: true } } as never,
    });
    await expect.element(page.getByText(/shared/i)).toBeInTheDocument();
  });

  it('omits shared badge when shared=false', async () => {
    await render(AlbumRow, { props: baseProps as never });
    expect(page.getByText(/shared/i).query()).toBeNull();
  });

  it('cover uses createUrl() (src prefixed with /api/)', async () => {
    const { container } = await render(AlbumRow, { props: baseProps as never });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toMatch(/^\/api\//);
  });

  it('renders pending style when isPending=true', async () => {
    const { container } = await render(AlbumRow, {
      props: { ...baseProps, isPending: true } as never,
    });
    expect(container.querySelector('.opacity-50')).not.toBeNull();
    await expect.element(page.getByTestId('pending-spinner')).toBeInTheDocument();
  });

  it('long name truncates with ellipsis class', async () => {
    const longName = 'A'.repeat(200);
    await render(AlbumRow, {
      props: { ...baseProps, item: { ...baseProps.item, albumName: longName } } as never,
    });
    const nameEl = page.getByText(longName).element();
    expect(nameEl.className).toMatch(/truncate|line-clamp/);
  });
});
