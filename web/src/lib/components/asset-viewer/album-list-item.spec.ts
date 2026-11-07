// album-list-item.spec.ts
import { mdiImageMultipleOutline } from '@mdi/js';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AlbumListItem from './AlbumListItem.svelte';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const album = { id: 'a1', albumName: 'Trip', assetCount: 3, albumThumbnailAssetId: null, shared: false } as any;
const noop = () => {};

describe('AlbumListItem badge', () => {
  it('renders no badge by default', async () => {
    const screen = await render(AlbumListItem, { album, selected: false, onAlbumClick: noop, onMultiSelect: noop });
    expect(screen.getByTestId('collection-row-badge').query()).toBeNull();
  });

  it('renders a badge when badgeIcon is provided', async () => {
    const screen = await render(AlbumListItem, {
      album,
      selected: false,
      onAlbumClick: noop,
      onMultiSelect: noop,
      badgeIcon: mdiImageMultipleOutline,
    });
    expect(screen.getByTestId('collection-row-badge').query()).not.toBeNull();
  });
});
