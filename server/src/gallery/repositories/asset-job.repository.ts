import { SelectQueryBuilder } from 'kysely';
import { AssetStatus } from 'src/enum.js';
import { DB } from 'src/schema/index.js';

/** Offline legacy rows can have deletedAt without ever having been explicitly deleted. */
export const withExplicitAssetDeletion = <O>(query: SelectQueryBuilder<DB, 'asset', O>) =>
  query.where('asset.status', 'in', [AssetStatus.Trashed, AssetStatus.Deleted]);
