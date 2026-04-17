import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import GlobalSearchPreview from '../global-search-preview.svelte';

// Avoid real navigation side-effects from child previews' Open buttons.
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// Mirror the mocking shape used by the per-kind preview specs so the @immich/ui
// Button / IconButton chain resolves against the real module's Tooltip.Provider
// context without pulling the full widget tree into the render.
vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  return { ...mod, IconButton: vi.fn(() => ({ $$typeof: Symbol.for('svelte.component') })) };
});

describe('GlobalSearchPreview dispatcher', () => {
  it('renders AlbumPreview when activeItem.kind is album', () => {
    const activeItem = {
      kind: 'album' as const,
      data: {
        id: 'a1',
        albumName: 'x',
        shared: false,
        albumThumbnailAssetId: null,
        assetCount: 1,
      },
    };
    const { container } = render(GlobalSearchPreview, { props: { activeItem } as never });
    // album-preview renders the placeholder frame when albumThumbnailAssetId is null.
    expect(container.querySelector('[data-testid="album-preview-placeholder"]')).toBeInTheDocument();
  });

  it('renders SpacePreview when activeItem.kind is space', () => {
    const activeItem = {
      kind: 'space' as const,
      data: {
        id: 's1',
        name: 'Family',
        memberCount: 1,
        assetCount: 0,
        color: 'primary',
        recentAssetIds: [],
        recentAssetThumbhashes: [],
        members: [],
      },
    };
    const { container } = render(GlobalSearchPreview, { props: { activeItem } as never });
    // space-preview renders the gradient fallback when recentAssetIds is empty.
    expect(container.querySelector('[data-testid="space-preview-gradient"]')).toBeInTheDocument();
  });
});
