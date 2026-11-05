import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import AlbumStackEvents from '$lib/gallery/stack/AlbumStackEvents.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';

describe('AlbumStackEvents', () => {
  const reloadAlbumStacks = vi.fn();
  const timelineManager = { reloadAlbumStacks } as unknown as TimelineManager;
  const stack = { id: 'stack-1', primaryAssetId: 'a', assets: [] };

  beforeEach(() => {
    reloadAlbumStacks.mockReset();
  });

  it('asks the album timeline to reload after stack edits', async () => {
    render(AlbumStackEvents, { albumId: 'album-1', timelineManager });
    await tick();

    eventManager.emit('StackCreate', stack);
    eventManager.emit('StackUpdate', stack);
    eventManager.emit('StackDelete', { id: 'stack-1', assets: [] });

    expect(reloadAlbumStacks).toHaveBeenCalledTimes(3);
  });

  it('reloads after photos are added to this album, not another', async () => {
    render(AlbumStackEvents, { albumId: 'album-1', timelineManager });
    await tick();

    eventManager.emit('AlbumAddAssets', { assetIds: ['a'], albumIds: ['other-album'] });
    expect(reloadAlbumStacks).not.toHaveBeenCalled();

    eventManager.emit('AlbumAddAssets', { assetIds: ['a'], albumIds: ['album-1'] });
    expect(reloadAlbumStacks).toHaveBeenCalledTimes(1);
  });
});
