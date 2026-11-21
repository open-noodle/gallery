import { ExpressionBuilder } from 'kysely';
import { DB } from 'src/schema/index.js';

/**
The ids of the tags on `assetId` that belong to the asset's owner. Since #992 a space Owner/Editor may put their own tag
on a member's photo, so upstream's "every tag on an asset is its owner's" no longer holds: metadata extraction must
replace only the owner's tag links and leave the tagger's.
*/
export const assetOwnerTagIds = (assetId: string) => (eb: ExpressionBuilder<DB, 'tag_asset'>) =>
  eb
    .selectFrom('tag')
    .innerJoin('asset', 'asset.ownerId', 'tag.userId')
    .select('tag.id')
    .where('asset.id', '=', assetId);
