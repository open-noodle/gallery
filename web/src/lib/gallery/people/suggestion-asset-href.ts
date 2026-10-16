import { Route } from '$lib/route';

/**
 * Where "Open photo" in the face suggestion review points (#1039), shared by the link and the `o` shortcut.
 *
 * A space viewer may be able to reach this asset ONLY through the space: /photos/{id} enforces the owner's
 * AssetView and would 403 for them. Route has no space-asset helper (it is an upstream module this fork does
 * not edit), so the space form is built here.
 */
export const getSuggestionAssetHref = (assetId: string, spaceId?: string) =>
  spaceId ? `/spaces/${spaceId}/photos/${assetId}` : Route.viewAsset({ id: assetId });
