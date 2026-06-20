// album-list-item.spec.ts
import { mdiImageMultipleOutline } from '@mdi/js';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import AlbumListItem from './album-list-item.svelte';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const album = { id: 'a1', albumName: 'Trip', assetCount: 3, albumThumbnailAssetId: null, shared: false } as any;
const noop = () => {};

describe('AlbumListItem badge', () => {
  it('renders no badge by default', () => {
    render(AlbumListItem, { album, selected: false, onAlbumClick: noop, onMultiSelect: noop });
    expect(screen.queryByTestId('collection-row-badge')).toBeNull();
  });

  it('renders a badge when badgeIcon is provided', () => {
    render(AlbumListItem, {
      album,
      selected: false,
      onAlbumClick: noop,
      onMultiSelect: noop,
      badgeIcon: mdiImageMultipleOutline,
    });
    expect(screen.queryByTestId('collection-row-badge')).not.toBeNull();
  });
});
