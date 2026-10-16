import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { SpaceAlbumRepository } from 'src/gallery/repositories/space-album.repository.js';
import type { EventRepository } from 'src/repositories/event.repository.js';
import type { JobRepository } from 'src/repositories/job.repository.js';
import type { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { BulkIdErrorReason, BulkIdResponseDto } from 'src/dtos/asset-ids.response.dto.js';
import { JobName } from 'src/enum.js';

// Fork side of AlbumService's asset add/remove: the AlbumAssetsAdd/AlbumAssetsRemove events that drive space people
// sync, and #764 cross-owner contributions (`album_space_asset` rows, never `album_asset`).

type SpaceAlbumContributionDependencies = {
  event: EventRepository;
  job: JobRepository;
  sharedSpace: SharedSpaceRepository;
  spaceAlbum: SpaceAlbumRepository;
};

/**
 * Runs after upstream's AlbumService.addAssets. First the face/sync event for the caller's OWN newly-added assets
 * (real `album_asset` rows, the successes upstream counted); then #764: assets denied above (not owned / no partner
 * share) may still be added as space bookmarks when the album is space-linked and the caller is a space Editor of the
 * space the asset is visible through. These go to `album_space_asset`, so the album owner never gains a permanent
 * grant, and they drive neither the thumbnail default nor the event.
 */
export const addAlbumAssetContributions = async (
  deps: SpaceAlbumContributionDependencies,
  { auth, albumId, results }: { auth: AuthDto; albumId: string; results: BulkIdResponseDto[] },
): Promise<void> => {
  const ownedNewAssetIds = results.filter(({ success }) => success).map(({ id }) => id);
  if (ownedNewAssetIds.length > 0) {
    await deps.event.emit('AlbumAssetsAdd', { albumId, assetIds: ownedNewAssetIds });
  }

  await tryContributeDeniedAssets(deps, auth, albumId, results);
};

/**
 * Upgrade `no_permission` results to cross-owner contributions where eligible. Mutates `results` in place (denied →
 * success, or → duplicate if already contributed).
 */
const tryContributeDeniedAssets = async (
  deps: SpaceAlbumContributionDependencies,
  auth: AuthDto,
  albumId: string,
  results: BulkIdResponseDto[],
): Promise<void> => {
  const deniedIds = results
    .filter(({ success, error }) => !success && error === BulkIdErrorReason.NO_PERMISSION)
    .map(({ id }) => id);
  if (deniedIds.length === 0) {
    return;
  }

  const [contributable, alreadyContributed] = await Promise.all([
    deps.sharedSpace.getContributableAssetSpaces(auth.user.id, albumId, deniedIds),
    deps.spaceAlbum.getContributedAssetIds(albumId, deniedIds),
  ]);
  const spaceByAsset = new Map(contributable.map(({ assetId, spaceId }) => [assetId, spaceId]));

  const toInsert: { albumId: string; assetId: string; spaceId: string; addedById: string }[] = [];
  for (const result of results) {
    if (result.success || result.error !== BulkIdErrorReason.NO_PERMISSION) {
      continue;
    }
    if (alreadyContributed.has(result.id)) {
      result.error = BulkIdErrorReason.DUPLICATE;
      continue;
    }
    const spaceId = spaceByAsset.get(result.id);
    if (!spaceId) {
      continue;
    }

    toInsert.push({ albumId, assetId: result.id, spaceId, addedById: auth.user.id });
    result.success = true;
    delete result.error;
  }

  if (toInsert.length === 0) {
    return;
  }

  await deps.spaceAlbum.addContributedAssets(toInsert);
  // D3 (#752 P1-7): a contribution's faces must reach space People without waiting for a coarse
  // reconcile trigger — enqueue the targeted per-asset match, mirroring the space-pool add path
  // (SharedSpaceService.addAssets). The handler re-guards on space + faceRecognitionEnabled.
  const spaceIds = [...new Set(toInsert.map(({ spaceId }) => spaceId))];
  const spaces = await Promise.all(spaceIds.map((spaceId) => deps.sharedSpace.getById(spaceId)));
  const faceEnabled = new Set(spaces.filter((space) => space?.faceRecognitionEnabled).map((space) => space!.id));
  const jobs = toInsert
    .filter(({ spaceId }) => faceEnabled.has(spaceId))
    .map(({ spaceId, assetId }) => ({ name: JobName.SharedSpaceFaceMatch as const, data: { spaceId, assetId } }));
  if (jobs.length > 0) {
    await deps.job.queueAll(jobs);
  }
};

/**
 * Runs right after upstream's removeAssets util in AlbumService.removeAssets, before upstream counts what was removed.
 * #764: a contribution is never in `album_asset`, so the util reports it NOT_FOUND. The caller already passed
 * AlbumAssetDelete, so removing it (deleting the `album_space_asset` row) is authorized; the underlying asset is
 * untouched. Face/sync cleanup (AlbumAssetsRemove) only applies to real album_asset rows, not contributions.
 */
export const removeAlbumAssetContributions = async (
  deps: Pick<SpaceAlbumContributionDependencies, 'event' | 'spaceAlbum'>,
  { albumId, results }: { albumId: string; results: BulkIdResponseDto[] },
): Promise<void> => {
  const albumAssetRemovedIds = results.filter(({ success }) => success).map(({ id }) => id);

  const notFoundIds = results
    .filter(({ success, error }) => !success && error === BulkIdErrorReason.NOT_FOUND)
    .map(({ id: assetId }) => assetId);
  if (notFoundIds.length > 0) {
    const contributed = await deps.spaceAlbum.getContributedAssetIds(albumId, notFoundIds);
    if (contributed.size > 0) {
      await deps.spaceAlbum.removeContributedAssetIds(albumId, [...contributed]);
      for (const result of results) {
        if (!contributed.has(result.id)) {
          continue;
        }

        result.success = true;
        delete result.error;
      }
    }
  }

  if (albumAssetRemovedIds.length > 0) {
    await deps.event.emit('AlbumAssetsRemove', { albumId, assetIds: albumAssetRemovedIds });
  }
};

/**
 * Runs after upstream's AlbumService.addAssetsToAlbums. Best-effort space people sync: albumAssetValues already
 * excludes assets present in the album (upstream's notPresentAssetIds filter), so in the normal path these are exactly
 * the newly-inserted rows. A concurrent insert could make addAssetIdsToAlbums' onConflict-do-nothing skip one; the
 * downstream SharedSpaceFaceMatch is idempotent and guards on isAssetInSpace, so a spurious id is harmless. We accept
 * best-effort here rather than plumbing inserted ids back.
 */
export const emitAlbumAssetsAdd = async (
  event: EventRepository,
  albumAssetValues: { albumId: string; assetId: string }[],
): Promise<void> => {
  const addedByAlbum = new Map<string, string[]>();
  for (const { albumId, assetId } of albumAssetValues) {
    const ids = addedByAlbum.get(albumId);
    if (ids) {
      ids.push(assetId);
    } else {
      addedByAlbum.set(albumId, [assetId]);
    }
  }
  for (const [albumId, assetIds] of addedByAlbum) {
    await event.emit('AlbumAssetsAdd', { albumId, assetIds });
  }
};
