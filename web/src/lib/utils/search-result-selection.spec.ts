import { AssetTypeEnum, AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import type { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { removeSearchResults, selectAllSearchResults, updateSearchResults } from '$lib/utils/search-result-selection';

const asset = (id: string, overrides: Partial<AssetResponseDto> = {}): AssetResponseDto =>
  ({
    id,
    ownerId: 'owner-1',
    type: AssetTypeEnum.Image,
    originalFileName: `${id}.jpg`,
    fileCreatedAt: '2024-06-15T10:00:00.000Z',
    localDateTime: '2024-06-15T10:00:00.000Z',
    createdAt: '2024-06-15T10:00:00.000Z',
    isFavorite: false,
    isTrashed: false,
    visibility: AssetVisibility.Timeline,
    duration: null,
    ...overrides,
  }) as AssetResponseDto;

describe('search-result-selection', () => {
  describe('selectAllSearchResults', () => {
    it('selects every loaded result and flags the selection as select-all', () => {
      const selectAssets = vi.fn();
      const assetInteraction = { selectAll: false, selectAssets } as unknown as AssetMultiSelectManager;

      selectAllSearchResults([asset('a'), asset('b')], assetInteraction);

      expect(assetInteraction.selectAll).toBe(true);
      expect(selectAssets).toHaveBeenCalledTimes(1);
      expect(selectAssets.mock.calls[0][0].map((a: { id: string }) => a.id)).toEqual(['a', 'b']);
    });

    it('converts results to timeline assets so the toolbar can read selection capabilities', () => {
      const selectAssets = vi.fn();
      const assetInteraction = { selectAll: false, selectAssets } as unknown as AssetMultiSelectManager;

      selectAllSearchResults([asset('a', { isFavorite: true })], assetInteraction);

      const [selected] = selectAssets.mock.calls[0][0];
      expect(selected).toMatchObject({ id: 'a', isFavorite: true, isImage: true });
    });
  });

  describe('removeSearchResults', () => {
    it('removes every matching asset in place', () => {
      const results = [asset('a'), asset('b'), asset('c')];

      removeSearchResults(results, ['a', 'c']);

      expect(results.map((a) => a.id)).toEqual(['b']);
    });

    it('leaves the array untouched when nothing matches', () => {
      const results = [asset('a'), asset('b')];

      removeSearchResults(results, ['zzz']);

      expect(results.map((a) => a.id)).toEqual(['a', 'b']);
    });

    it('removes adjacent matches without skipping (reverse iteration)', () => {
      const results = [asset('a'), asset('b'), asset('c'), asset('d')];

      removeSearchResults(results, ['b', 'c']);

      expect(results.map((a) => a.id)).toEqual(['a', 'd']);
    });
  });

  describe('updateSearchResults', () => {
    it('applies the edit only to the matching assets', () => {
      const results = [asset('a'), asset('b')];

      updateSearchResults(results, ['b'], (a) => (a.isFavorite = true));

      expect(results[0].isFavorite).toBe(false);
      expect(results[1].isFavorite).toBe(true);
    });

    it('can update visibility for archive toggles', () => {
      const results = [asset('a'), asset('b')];

      updateSearchResults(results, ['a', 'b'], (a) => (a.visibility = AssetVisibility.Archive));

      expect(results.map((a) => a.visibility)).toEqual([AssetVisibility.Archive, AssetVisibility.Archive]);
    });
  });
});
