import { galleryTimeBucketHandlers } from '#test/medium/gallery/time-buckets.ts';
import type { MockData } from '#test/medium/mock/data.ts';
import type { Handlers } from '#test/medium/mock/types.ts';

// Default answers for the Gallery endpoints the web app calls on most pages, so upstream's medium specs run
// against Gallery's web unchanged. Registered after upstream's handlers in mock.ts; a spec can override any of
// them with `api.on(...)`.
export const galleryHandlers = (data: MockData): Handlers => ({
  ...galleryTimeBucketHandlers(data),
  getAllSpaces: () => ({ json: [] }),
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
