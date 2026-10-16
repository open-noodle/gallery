import { type ExpressionBuilder, sql } from 'kysely';
import { AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { spaceAlbumAssetExists } from 'src/utils/shared-space-album-scope.js';

/**
 * The memories `GET /memories` lists to `userId`: their own, plus any memory holding a live timeline asset they reach
 * as its owner, a partner or a Space member. Hand-written on purpose: `ownedOrSharedWithViewer` is not equivalent (it
 * would admit archived Space assets and drop the offline-library filter).
 */
export const memoryAccessibleTo = (eb: ExpressionBuilder<DB, 'memory'>, userId: string) =>
  eb.or([
    eb('memory.ownerId', '=', userId),
    eb.exists(
      eb
        .selectFrom('memory_asset')
        .innerJoin('asset', 'asset.id', 'memory_asset.assetId')
        .select('memory_asset.assetId')
        .whereRef('memory_asset.memoriesId', '=', 'memory.id')
        .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
        .where('asset.deletedAt', 'is', null)
        .where((eb) =>
          eb.or([
            eb('asset.ownerId', '=', userId),
            eb.exists(
              eb
                .selectFrom('partner')
                .select('partner.sharedById')
                .where('partner.sharedWithId', '=', userId)
                .whereRef('partner.sharedById', '=', 'asset.ownerId'),
            ),
            eb.exists(
              eb
                .selectFrom('shared_space_asset')
                .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
                .select('shared_space_asset.assetId')
                .where('shared_space_member.userId', '=', userId)
                .whereRef('shared_space_asset.assetId', '=', 'asset.id'),
            ),
            eb.exists(
              eb
                .selectFrom('shared_space_library')
                .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
                .select('shared_space_library.libraryId')
                .where('shared_space_member.userId', '=', userId)
                .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
                .where('asset.isOffline', '=', false),
            ),
            spaceAlbumAssetExists(eb, {
              correlateAssetId: 'asset.id',
              scope: { memberUserId: userId },
              albumTimelineGate: 'space-tab',
            }),
          ]),
        ),
    ),
  ]);
