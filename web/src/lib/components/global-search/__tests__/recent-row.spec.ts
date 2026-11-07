import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import RecentRow from '../rows/recent-row.svelte';

vi.mock('@immich/ui', async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  IconButton: vi.fn(() => ({ $$typeof: Symbol.for('svelte.component') })),
}));

describe('recent-row', () => {
  beforeAll(async () => {
    // Load the real en bundle so SpaceRow's `$t('cmdk_preview_member_count', ...)` and
    // AlbumRow's `$t('items_count', ...)` resolve to English ICU output instead of the
    // raw key (global test setup uses `fallbackLocale: 'dev'` which returns keys).
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  it('renders query kind with text', async () => {
    await render(RecentRow, {
      props: { entry: { kind: 'query', id: 'query:beach', text: 'beach', lastUsed: 1 } },
    });
    await expect.element(page.getByTestId('query-row')).toBeInTheDocument();
    await expect.element(page.getByText('beach')).toBeInTheDocument();
  });

  it('dispatches to PhotoRow for photo kind', async () => {
    await render(RecentRow, {
      props: { entry: { kind: 'photo', id: 'photo:a1', assetId: 'a1', label: 'sunset.jpg', lastUsed: 1 } },
    });
    await expect.element(page.getByText('sunset.jpg')).toBeInTheDocument();
  });

  it('dispatches to PersonRow for person kind', async () => {
    await render(RecentRow, {
      props: { entry: { kind: 'person', id: 'person:p1', personId: 'p1', label: 'Alice', lastUsed: 1 } },
    });
    await expect.element(page.getByText('Alice')).toBeInTheDocument();
  });

  it('dispatches to PlaceRow for place kind', async () => {
    await render(RecentRow, {
      props: {
        entry: {
          kind: 'place',
          id: 'place:48.8566:2.3522',
          latitude: 48.8566,
          longitude: 2.3522,
          label: 'Paris',
          lastUsed: 1,
        },
      },
    });
    await expect.element(page.getByText('Paris')).toBeInTheDocument();
  });

  it('dispatches to TagRow for tag kind', async () => {
    await render(RecentRow, {
      props: { entry: { kind: 'tag', id: 'tag:t1', tagId: 't1', label: 'beach', lastUsed: 1 } },
    });
    await expect.element(page.getByText('beach')).toBeInTheDocument();
  });

  describe('album entry', () => {
    it('renders album label and cover thumbnail from cmdk.recent', async () => {
      const { container } = await render(RecentRow, {
        props: {
          entry: {
            kind: 'album',
            id: 'album:abc',
            albumId: 'abc',
            label: 'Iceland Trip 2024',
            thumbnailAssetId: 'asset-1',
            lastUsed: 1,
          },
        },
      });
      await expect.element(page.getByText('Iceland Trip 2024')).toBeInTheDocument();
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toMatch(/^\/api\//);
    });

    it('renders album with null thumbnail via placeholder', async () => {
      const { container } = await render(RecentRow, {
        props: {
          entry: {
            kind: 'album',
            id: 'album:abc',
            albumId: 'abc',
            label: 'No Thumbnail',
            thumbnailAssetId: null,
            lastUsed: 1,
          },
        },
      });
      await expect.element(page.getByText('No Thumbnail')).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
    });
  });

  describe('space entry', () => {
    it('renders space label and color swatch from cmdk.recent', async () => {
      await render(RecentRow, {
        props: {
          entry: {
            kind: 'space',
            id: 'space:s1',
            spaceId: 's1',
            label: 'Family',
            colorHex: 'primary',
            lastUsed: 1,
          },
        },
      });
      await expect.element(page.getByText('Family')).toBeInTheDocument();
    });
  });

  describe('navigate entry', () => {
    it('renders navigate kind with translated label', async () => {
      await render(RecentRow, {
        props: {
          entry: {
            kind: 'navigate',
            id: 'navigate:/photos',
            route: '/photos',
            labelKey: 'photos',
            icon: 'mdi:image',
            adminOnly: false,
            lastUsed: 1,
          },
        },
      });
      // 'photos' is a real i18n key; the translated label should be present
      await expect.element(page.getByText(/photos/i)).toBeInTheDocument();
    });
  });
});
