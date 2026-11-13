import { ExpressionBuilder } from 'kysely';
import { AssetType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';

/**
Recognition search hook for `SearchRepository.searchFaces` (issue 1306): leaves out the other faces of the same video,
keeping the face itself, so upstream's "the matches include the face itself" count still holds.

Video face detection already decided which faces of one video are one person: the tracker merges a person's
sightings, and keeps two faces apart only when it found no good reason to merge them, usually because both were on
screen together. Counted as recognition evidence, those leftovers vouch for each other. Three faces of one person
split in one video then reach `minFaces` on their own and found a person nobody else matches, and a face can take
the person of another face it was kept apart from. Photos keep upstream's behaviour.
*/
export const notOtherFaceOfSameVideo = (eb: ExpressionBuilder<DB, 'asset_face' | 'asset'>, faceId: string) =>
  eb.not(
    eb.and([
      eb('asset.type', '=', AssetType.Video),
      eb('asset_face.id', '!=', asUuid(faceId)),
      eb(
        'asset_face.assetId',
        '=',
        eb.selectFrom('asset_face as self').select('self.assetId').where('self.id', '=', asUuid(faceId)),
      ),
    ]),
  );
