import { searchPerson, type AssetResponseDto, type AssetVisibility } from '@immich/sdk';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { registerSelectionContext } from '$lib/managers/command-context-manager.svelte';

/**
 * #830: the search page is Gallery's global search surface, but a URL-driven search only ever
 * covered the caller's own (and partner) assets. A Space member who opened "Show similar photos" on
 * a photo shared with them, or pasted the same `queryAssetId` URL, got zero results while the space
 * owner got a long list. Opt into shared spaces the way the command palette already does (#894); the
 * server scopes them to spaces the member has kept in their timeline. Spread before the URL terms so
 * an explicit value there still wins. A space-scoped URL gets nothing: the server rejects `spaceId`
 * together with `withSharedSpaces`.
 */
export const sharedSpacesDefault = (terms: { spaceId?: string }) => (terms.spaceId ? {} : { withSharedSpaces: true });

/** `withSharedSpaces` is a scope default, not a filter the user chose, so it gets no chip. */
export const isVisibleSearchKey = (key: string) => key !== 'withSharedSpaces';

const isScopedPersonToken = (personId: string) =>
  personId.startsWith('person:') || personId.startsWith('space-person:');

/**
 * Names for the scoped `person:` / `space-person:` filter tokens among `personIds` ('' when the
 * token resolves to nobody). Bare person ids are left out: the caller reads those with `getPerson`.
 */
export const getScopedPersonNames = async (personIds: string[]) => {
  const scopedPersonIds = personIds.filter((personId) => isScopedPersonToken(personId));
  if (scopedPersonIds.length === 0) {
    return new Map<string, string>();
  }

  const people = await searchPerson({ name: '', withHidden: true, withSharedSpaces: true });
  const peopleByFilterId = new Map(people.map((person) => [person.filterId ?? `person:${person.id}`, person]));
  return new Map(scopedPersonIds.map((personId) => [personId, peopleByFilterId.get(personId)?.name ?? '']));
};

type SearchSelectionOptions = {
  getAssets: () => AssetResponseDto[];
  setAssets: (assets: AssetResponseDto[]) => void;
  getVisibility: () => AssetVisibility | undefined;
  onDelete: (assetIds: string[]) => void;
  reload: () => Promise<void>;
};

/**
 * Hands the page's selection to the command palette, and returns the result-list updates the
 * favorite and archive actions share with it. Call during component init.
 */
export const registerSearchSelection = ({
  getAssets,
  setAssets,
  getVisibility,
  onDelete,
  reload,
}: SearchSelectionOptions) => {
  const onFavorite = (ids: string[], isFavorite: boolean) => {
    for (const id of ids) {
      const asset = getAssets().find((asset) => asset.id === id);
      if (asset) {
        asset.isFavorite = isFavorite;
      }
    }
  };

  const onArchive = (ids: string[], visibility: AssetVisibility) => {
    const idSet = new Set(ids);
    const termsVisibility = getVisibility();
    if (termsVisibility && termsVisibility !== visibility) {
      setAssets(getAssets().filter((asset) => !idSet.has(asset.id)));
      return;
    }
    for (const id of ids) {
      const asset = getAssets().find((asset) => asset.id === id);
      if (asset) {
        asset.visibility = visibility;
      }
    }
  };

  const onUndoDelete = () => {
    void reload();
  };

  registerSelectionContext({
    getAssets: () => assetMultiSelectManager.assets,
    clearSelection: () => assetMultiSelectManager.clear(),
    canAddToAlbum: () => true,
    getOnFavorite: () => onFavorite,
    getOnArchive: () => onArchive,
    getOnDelete: () => onDelete,
    getOnUndoDelete: () => onUndoDelete,
  });

  return { onFavorite, onArchive };
};
