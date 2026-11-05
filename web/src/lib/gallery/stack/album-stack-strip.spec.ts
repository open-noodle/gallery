import type { StackResponseDto } from '@immich/sdk';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { albumStackPreferences } from '$lib/gallery/stack/album-stack-preferences.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import { reactivePageMock } from '@test-data/mocks/reactive-page.mock.svelte';
import { albumStackSuccessor, loadAlbumStackStripIds, stackStrip, viewerAlbumId } from './album-stack-strip';

vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

const [a, b, c] = [assetFactory.build(), assetFactory.build(), assetFactory.build()];
const stack: StackResponseDto = { id: 'stack-1', primaryAssetId: a.id, assets: [a, b, c] };

describe('album stack strip', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    reactivePageMock.reset('http://localhost/photos');
  });

  afterEach(() => {
    albumStackPreferences.stripInAlbum = false;
  });

  it('takes the album the viewer was given, else the album in the route', () => {
    expect(viewerAlbumId({ id: 'album-1' })).toBe('album-1');
    expect(viewerAlbumId()).toBeUndefined();

    reactivePageMock.reset('http://localhost/spaces/s1/albums/album-2', {
      params: { spaceId: 's1', albumId: 'album-2' },
    });
    expect(viewerAlbumId()).toBe('album-2');
  });

  it('shows the whole stack unless the setting is on inside an album', async () => {
    await expect(loadAlbumStackStripIds('stack-1', 'album-1')).resolves.toBeUndefined();

    albumStackPreferences.stripInAlbum = true;
    await expect(loadAlbumStackStripIds('stack-1', undefined)).resolves.toBeUndefined();
    expect(sdkMock.getAlbumStack).not.toHaveBeenCalled();
  });

  it("narrows the strip to the album's members when the setting is on", async () => {
    albumStackPreferences.stripInAlbum = true;
    sdkMock.getAlbumStack.mockResolvedValue({ ...stack, assets: [a, c] });

    const ids = await loadAlbumStackStripIds('stack-1', 'album-1');

    expect(sdkMock.getAlbumStack).toHaveBeenCalledWith({ id: 'album-1', stackId: 'stack-1' });
    expect(stackStrip(stack, ids)?.assets).toEqual([a, c]);
  });

  it('falls back to the whole stack when the lookup fails', async () => {
    albumStackPreferences.stripInAlbum = true;
    sdkMock.getAlbumStack.mockRejectedValue(new Error('boom'));

    await expect(loadAlbumStackStripIds('stack-1', 'album-1')).resolves.toBeUndefined();
  });

  describe('albumStackSuccessor', () => {
    const removed = { ...a, stack: { id: 'stack-1', primaryAssetId: a.id, assetCount: 3 } };

    it('moves to the earliest stack-mate the album still holds once the primary leaves it', async () => {
      const later = { ...b, fileCreatedAt: '2026-03-02T12:00:00.000Z' };
      const earlier = { ...c, fileCreatedAt: '2026-03-01T12:00:00.000Z' };
      sdkMock.getAlbumStack.mockResolvedValue({ ...stack, assets: [later, earlier] });

      await expect(albumStackSuccessor('album-1', removed)).resolves.toBe(earlier);
      expect(sdkMock.getAlbumStack).toHaveBeenCalledWith({ id: 'album-1', stackId: 'stack-1' });
    });

    it('prefers the primary when the album still holds it', async () => {
      const shown = { ...b, stack: { id: 'stack-1', primaryAssetId: a.id, assetCount: 3 } };
      sdkMock.getAlbumStack.mockResolvedValue({ ...stack, assets: [c, a] });

      await expect(albumStackSuccessor('album-1', shown)).resolves.toBe(a);
    });

    it('looks the stack up for a photo picked in the strip, whose record carries none', async () => {
      const picked = { ...b, stack: undefined };
      sdkMock.getAssetInfo.mockResolvedValue({ ...b, stack: { id: 'stack-1', primaryAssetId: a.id, assetCount: 3 } });
      sdkMock.getAlbumStack.mockResolvedValue({ ...stack, assets: [b, c] });

      await expect(albumStackSuccessor('album-1', picked)).resolves.toBe(c);
      expect(sdkMock.getAssetInfo).toHaveBeenCalledWith({ id: b.id });
      expect(sdkMock.getAlbumStack).toHaveBeenCalledWith({ id: 'album-1', stackId: 'stack-1' });
    });

    it('has none for an unstacked photo, a stack the album no longer holds, or a failed lookup', async () => {
      sdkMock.getAssetInfo.mockResolvedValue({ ...a, stack: null });
      await expect(albumStackSuccessor('album-1', { ...a, stack: null })).resolves.toBeUndefined();
      expect(sdkMock.getAlbumStack).not.toHaveBeenCalled();

      sdkMock.getAlbumStack.mockResolvedValue({ ...stack, assets: [] });
      await expect(albumStackSuccessor('album-1', removed)).resolves.toBeUndefined();

      sdkMock.getAlbumStack.mockRejectedValue(new Error('not the owner'));
      await expect(albumStackSuccessor('album-1', removed)).resolves.toBeUndefined();
    });
  });

  it('shows no strip when the album holds fewer than two of the stack', () => {
    expect(stackStrip(stack, new Set([a.id]))).toBeUndefined();
    expect(stackStrip(stack, undefined)).toBe(stack);
    expect(stackStrip(undefined, new Set([a.id]))).toBeUndefined();
  });
});
