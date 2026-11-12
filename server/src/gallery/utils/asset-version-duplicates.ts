import type { AssetVersionRepository } from 'src/gallery/repositories/asset-version.repository.js';

// Asset versions and Immich's duplicate detection (specs/2026-11-07-asset-versions-design.md, decided 2026-11-10).
// Discarding a duplicate deletes the photo, and with it the files behind it. A camera file and its RAW are one unit:
// the user who discards the photo means both. A photo whose shot includes an edit is another matter: the edit is work
// that exists nowhere else, and a look-alike (an edit Gallery did not recognise, say, which can be the larger file
// and so the one suggested to keep) must not take it down. Such a photo is no duplicate of anything: it neither
// looks for duplicates nor is found as one.

/**
What the duplicate search found for `assetId`, without photos whose shot includes an edit; nothing at all when
`assetId` is such a photo itself (the job then takes it out of any group it was in, as for an asset with no
duplicates).
*/
export const withoutEditedShots = async <T extends { assetId: string }>(
  repository: AssetVersionRepository,
  assetId: string,
  found: T[],
): Promise<T[]> => {
  const edited = new Set(await repository.getPhotosWithEdits([assetId, ...found.map((item) => item.assetId)]));
  return edited.has(assetId) ? [] : found.filter((item) => !edited.has(item.assetId));
};
