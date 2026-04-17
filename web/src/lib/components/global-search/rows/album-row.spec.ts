import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
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

  it('renders album name', () => {
    render(AlbumRow, { props: baseProps as never });
    expect(screen.getByText('Hawaii 2024')).toBeInTheDocument();
  });

  it('renders shared badge when shared=true', () => {
    render(AlbumRow, {
      props: { ...baseProps, item: { ...baseProps.item, shared: true } } as never,
    });
    expect(screen.getByText(/shared/i)).toBeInTheDocument();
  });

  it('omits shared badge when shared=false', () => {
    render(AlbumRow, { props: baseProps as never });
    expect(screen.queryByText(/shared/i)).toBeNull();
  });

  it('cover uses createUrl() (src prefixed with /api/)', () => {
    const { container } = render(AlbumRow, { props: baseProps as never });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toMatch(/^\/api\//);
  });

  it('renders pending style when isPending=true', () => {
    const { container } = render(AlbumRow, {
      props: { ...baseProps, isPending: true } as never,
    });
    expect(container.querySelector('.opacity-50')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="pending-spinner"]')).toBeInTheDocument();
  });

  it('long name truncates with ellipsis class', () => {
    const longName = 'A'.repeat(200);
    render(AlbumRow, {
      props: { ...baseProps, item: { ...baseProps.item, albumName: longName } } as never,
    });
    const nameEl = screen.getByText(longName);
    expect(nameEl.className).toMatch(/truncate|line-clamp/);
  });
});
