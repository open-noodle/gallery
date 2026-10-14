import { chunk } from 'lodash-es';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { Permission, SharedSpaceActivityType } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { checkAccess } from 'src/utils/access.js';

// Bounds the space lookups for activity attribution only, not the edit itself. Never apply it to
// AssetBulkUpdateDto or POST /assets/editable: both must answer for the whole selection.
const MAX_ATTRIBUTION_ASSETS = 500;

/**
 * Records an edit made by someone who is not the asset owner, so the owner can see
 * what changed and who changed it. Owner self-edits (nearly all editing) log nothing,
 * which is what keeps this low-volume.
 *
 * Grouped by resolved space, one row per space: a bulk edit can span several spaces, and
 * attributing all of it to whichever space resolved first would be wrong. Assets that
 * resolve to no space contribute no row.
 *
 * Never throws. Attribution is secondary to the edit that triggered it.
 */
export const logCrossOwnerEdit = async (
  accessRepository: AccessRepository,
  sharedSpaceRepository: SharedSpaceRepository,
  logger: LoggingRepository,
  auth: AuthDto,
  assetIds: string[],
): Promise<void> => {
  // Callers pass a validated array; the check lets CodeQL prove the loop below is bounded (js/loop-bound-injection).
  if (!Array.isArray(assetIds)) {
    return;
  }

  try {
    // AssetDelete has no Gallery grant, so it answers "does the caller own it" without reading the assets.
    const ownedIds = await checkAccess(accessRepository, { auth, permission: Permission.AssetDelete, ids: assetIds });
    const crossOwnerIds = assetIds.filter((id) => !ownedIds.has(id));
    if (crossOwnerIds.length === 0) {
      return;
    }

    // findSpaceForAssetAndUser is a UNION of two three-join subqueries; a large cross-owner bulk
    // edit is this feature's headline case, so resolving one id at a time, sequentially, would add
    // a serial-latency term proportional to the batch size. Chunk into bounded-concurrency batches
    // instead of firing all of them at once (connection-pool safety) or one at a time (latency).
    const truncated = crossOwnerIds.length > MAX_ATTRIBUTION_ASSETS;
    const sampledIds = crossOwnerIds.slice(0, MAX_ATTRIBUTION_ASSETS);
    const bySpace = new Map<string, string[]>();
    for (const batch of chunk(sampledIds, 10)) {
      const spaces = await Promise.all(
        batch.map((assetId) => sharedSpaceRepository.findSpaceForAssetAndUser(assetId, auth.user.id)),
      );
      for (const [index, space] of spaces.entries()) {
        if (!space) {
          continue;
        }
        const assetId = batch[index];
        const ids = bySpace.get(space.spaceId) ?? [];
        ids.push(assetId);
        bySpace.set(space.spaceId, ids);
      }
    }

    for (const [spaceId, ids] of bySpace) {
      await sharedSpaceRepository.logActivity({
        spaceId,
        userId: auth.user.id,
        type: SharedSpaceActivityType.AssetEdit,
        data: { count: ids.length, assetIds: ids.slice(0, 4), ...(truncated && { truncated: true }) },
      });
    }
  } catch (error) {
    logger.warn(`Failed to log cross-owner edit activity: ${error}`);
  }
};
