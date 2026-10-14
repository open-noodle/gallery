import type { ExpressionBuilder } from 'kysely';
import type { DB } from 'src/schema/index.js';

/**
 * The length clients show: the probed length of the trimmed file for a trimmed video (Gallery serves that file),
 * otherwise asset.duration. Selected after `asset.*`, the later `duration` column wins in the result row.
 */
export const projectedDuration = (eb: ExpressionBuilder<DB, 'asset'>) =>
  eb.fn
    .coalesce(
      eb
        .selectFrom('asset_video_trim')
        .select('asset_video_trim.duration')
        .whereRef('asset_video_trim.assetId', '=', 'asset.id'),
      eb.ref('asset.duration'),
    )
    .as('duration');
