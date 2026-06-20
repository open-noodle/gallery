// collection.service.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickerCollection } from '$lib/components/shared-components/collection-selection/collection-selection-utils';
import { addAssetsToCollections } from './collection.service';

const addAssetsToAlbums = vi.fn();
const addAssetsToSpace = vi.fn();
const primary = vi.fn();

vi.mock('$lib/services/album.service', () => ({ addAssetsToAlbums: (...a: unknown[]) => addAssetsToAlbums(...a) }));
vi.mock('$lib/services/space.service', () => ({ addAssetsToSpace: (...a: unknown[]) => addAssetsToSpace(...a) }));
vi.mock('@immich/ui', () => ({ toastManager: { primary: (...a: unknown[]) => primary(...a) } }));
vi.mock('$lib/utils/i18n', () => ({
  getFormatter: () =>
    Promise.resolve((key: string, opts?: { values?: { count?: number } }) => `${key}:${opts?.values?.count ?? ''}`),
}));

const albumCol = (id: string): PickerCollection =>
  ({ kind: 'album', id, name: id, album: { id } }) as unknown as PickerCollection;
const spaceCol = (id: string): PickerCollection =>
  ({ kind: 'space', id, name: id, space: { id } }) as unknown as PickerCollection;

beforeEach(() => {
  vi.clearAllMocks();
  addAssetsToAlbums.mockResolvedValue(true);
  addAssetsToSpace.mockResolvedValue(true);
});

describe('addAssetsToCollections', () => {
  it('single album → addAssetsToAlbums notify:true, no aggregate toast, returns true', async () => {
    await expect(addAssetsToCollections([albumCol('a1')], ['x'])).resolves.toBe(true);
    expect(addAssetsToAlbums).toHaveBeenCalledWith(['a1'], ['x'], { notify: true });
    expect(primary).not.toHaveBeenCalled();
  });

  it('single album failure returns false (keep modal open)', async () => {
    addAssetsToAlbums.mockResolvedValue(false);
    await expect(addAssetsToCollections([albumCol('a1')], ['x'])).resolves.toBe(false);
  });

  it('single space → addAssetsToSpace notify:true, no aggregate toast, returns true', async () => {
    await expect(addAssetsToCollections([spaceCol('s1')], ['x'])).resolves.toBe(true);
    expect(addAssetsToSpace).toHaveBeenCalledWith('s1', ['x'], { notify: true });
    expect(primary).not.toHaveBeenCalled();
  });

  it('mixed multi → each notify:false, one aggregate toast counting successes, returns true', async () => {
    await expect(addAssetsToCollections([albumCol('a1'), albumCol('a2'), spaceCol('s1')], ['x'])).resolves.toBe(true);
    expect(addAssetsToAlbums).toHaveBeenCalledWith(['a1', 'a2'], ['x'], { notify: false });
    expect(addAssetsToSpace).toHaveBeenCalledWith('s1', ['x'], { notify: false });
    expect(primary).toHaveBeenCalledWith('added_to_collections_count:3'); // 2 albums + 1 space
  });

  it('partial failure → aggregate counts only successes; returns true; no throw', async () => {
    addAssetsToSpace.mockResolvedValue(false); // space fails
    await expect(addAssetsToCollections([albumCol('a1'), spaceCol('s1')], ['x'])).resolves.toBe(true);
    expect(primary).toHaveBeenCalledWith('added_to_collections_count:1');
  });

  it('total failure → no aggregate toast, returns false', async () => {
    addAssetsToAlbums.mockResolvedValue(false);
    addAssetsToSpace.mockResolvedValue(false);
    await expect(addAssetsToCollections([albumCol('a1'), spaceCol('s1')], ['x'])).resolves.toBe(false);
    expect(primary).not.toHaveBeenCalled();
  });

  it('over-cap selection skips spaces but still adds albums', async () => {
    const assetIds = Array.from({ length: 10_001 }, (_, i) => `x${i}`);
    await expect(addAssetsToCollections([albumCol('a1'), spaceCol('s1')], assetIds)).resolves.toBe(true);
    expect(addAssetsToSpace).not.toHaveBeenCalled();
    expect(addAssetsToAlbums).toHaveBeenCalledWith(['a1'], assetIds, { notify: true }); // total becomes 1 → single path
  });

  it('empty selection is a no-op and returns true', async () => {
    await expect(addAssetsToCollections([], ['x'])).resolves.toBe(true);
    expect(addAssetsToAlbums).not.toHaveBeenCalled();
    expect(addAssetsToSpace).not.toHaveBeenCalled();
  });
});
