import { describe, expect, it, vi } from 'vitest';

const { eventManagerMock, faceManagerMock, getAssetInfoMock } = vi.hoisted(() => ({
  eventManagerMock: { emit: vi.fn() },
  faceManagerMock: { clear: vi.fn(), getAssetFaces: vi.fn().mockResolvedValue(undefined) },
  getAssetInfoMock: vi.fn(),
}));

vi.mock('$lib/managers/event-manager.svelte', () => ({ eventManager: eventManagerMock }));
vi.mock('$lib/stores/face.svelte', () => ({ faceManager: faceManagerMock }));
vi.mock('@immich/sdk', () => ({ getAssetInfo: getAssetInfoMock }));

const { refreshAssetPeople } = await import('./refresh-asset-people');

describe('refreshAssetPeople', () => {
  /**
   * The People row and the face boxes over the photo are two DIFFERENT stale surfaces after a face
   * edit, refreshed by two different means. The on-photo SpaceFaceEditor originally did neither and
   * simply closed itself, so a newly tagged person stayed invisible until a full page reload.
   *
   * Asserting all three calls is the point: covering only the emit would still let the photo's face
   * boxes go stale, and covering only faceManager would still let the People row go stale.
   */
  it('re-reads the asset in its space, republishes it, and reloads the face boxes', async () => {
    const refreshed = { id: 'asset-1', people: [{ id: 'p-1', name: 'Dana' }] };
    getAssetInfoMock.mockResolvedValue(refreshed);

    await refreshAssetPeople('asset-1', 'space-1');

    expect(getAssetInfoMock).toHaveBeenCalledWith({ id: 'asset-1', spaceId: 'space-1' });
    expect(eventManagerMock.emit).toHaveBeenCalledWith('AssetUpdate', refreshed);
    expect(faceManagerMock.clear).toHaveBeenCalled();
    expect(faceManagerMock.getAssetFaces).toHaveBeenCalledWith('asset-1');
  });

  it('re-reads without a space when the caller has none', async () => {
    getAssetInfoMock.mockResolvedValue({ id: 'asset-2' });

    await refreshAssetPeople('asset-2');

    expect(getAssetInfoMock).toHaveBeenCalledWith({ id: 'asset-2', spaceId: undefined });
  });
});
