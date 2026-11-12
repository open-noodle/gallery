import type { MockData } from '#test/common/data.ts';
import { galleryTimeBucketHandlers } from '#test/common/gallery/time-buckets.ts';
import type { Handlers, OperationId } from '#test/common/types.ts';

// Gallery endpoints that use POST to read (a body too large for a query string). The dispatcher treats
// them like upstream's `searchAssets`: not a mutation a spec has to assert.
export const galleryReadOperations: OperationId[] = [
  'getAlbumAddTargets',
  'getAssetSpaces',
  'getCleanupAssetsInSpaces',
  'getEditableAssets',
  'getFaceRepairClusterFaces',
  'getSearchOptions',
  'getSharedSpaceAssetLinkedAlbums',
  'searchSmartFacets',
];

// Default answers for the Gallery endpoints the web app calls on most pages, so upstream's unit and medium specs
// run against Gallery's web unchanged. Registered after upstream's handlers in the shared dispatcher
// (test/common/dispatcher.ts); a spec can override any of them with `api.on(...)`.
export const galleryHandlers = (data: MockData): Handlers => ({
  ...galleryTimeBucketHandlers(data),
  getAllSpaces: () => ({ json: [] }),
  // App init probes family access once signed in (lib/utils/client.ts); the feature is off by default, so no access.
  getMyRoot: () => ({ status: 403, json: { message: 'Forbidden', statusCode: 403 } }),
  // Every mounted thumbnail asks which spaces hold its asset (the space badge); none here.
  getAssetSpaces: () => ({ json: { assets: [] } }),
  getFilterSuggestions: () => ({
    json: {
      cameraMakes: [],
      countries: [],
      hasAssetsInAlbum: false,
      hasAssetsNotInAlbum: false,
      hasFavorites: false,
      hasUnnamedPeople: false,
      mediaTypes: [],
      people: [],
      ratings: [],
      tags: [],
    },
  }),
  // Gallery's maps read filtered markers; unfiltered, they are upstream's markers for the same album.
  getFilteredMapMarkers: ({ params = {} }) => ({ json: data.mapMarkers(params.albumId) }),
  // Gallery favorites are per user (asset_favorite), written through PUT /assets/favorites rather than
  // updateAsset's isFavorite; the mock applies them to the same asset state.
  updateAssetFavorites: ({ body }) => {
    data.updateAssets({ ids: body.ids, isFavorite: body.isFavorite });
    return { status: 204 };
  },
});
