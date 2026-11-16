import { ExpressionBuilder, sql } from 'kysely';
import { AssetType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';

/**
Recognition search hook for `SearchRepository.searchFaces` (issue 1306), with two rules for a video face. Photos keep
upstream's behaviour: neither rule matches a face without a video frame row.

The other faces of the same video are left out, keeping the face itself, so upstream's "the matches include the face
itself" count still holds. Video face detection already decided which faces of one video are one person: the tracker
merges a person's sightings, and keeps two faces apart only when it found no good reason to merge them, usually
because both were on screen together. Counted as recognition evidence, those leftovers vouch for each other. Three
faces of one person split in one video then reach `minFaces` on their own and found a person nobody else matches, and
a face can take the person of another face it was kept apart from.

Every face of a person that already has a face seen together with this one is left out too. Two faces in one frame are
two people, so that person is someone else. Without this, small or blurry faces, whose embeddings crowd together, all
went to whoever was nearest: four singers of a choir to one person, a driver and a passenger to one named person. The
face then matches its next nearest person, or none. Collage videos lose a little: a person shown in two photos at once
keeps the person on one face only.
*/
export const notOtherFaceOfSameVideo = (eb: ExpressionBuilder<DB, 'asset_face' | 'asset'>, faceId: string) =>
  eb.and([
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
    ),
    eb.or([
      eb('asset_face.personGroupId', 'is', null),
      eb('asset_face.personGroupId', 'not in', personsSeenWith(eb, faceId)),
    ]),
  ]);

/**
The persons of the other faces of this face's video that share a sampled frame with it: a stored sighting at the same
time, the evidence the tracker's own "seen together" rule uses (`video-faces.ts`). Sightings at one time are one frame,
since the sample and sharpen times are each extracted once.
*/
const personsSeenWith = (eb: ExpressionBuilder<DB, 'asset_face' | 'asset'>, faceId: string) =>
  eb
    .selectFrom('asset_face as other')
    .innerJoin('asset_face_video_frame as otherFrame', 'otherFrame.faceId', 'other.id')
    .innerJoin('asset_face as self', (join) => join.onRef('self.assetId', '=', 'other.assetId'))
    .innerJoin('asset_face_video_frame as selfFrame', 'selfFrame.faceId', 'self.id')
    .select('other.personGroupId')
    .where('self.id', '=', asUuid(faceId))
    .where('other.id', '!=', asUuid(faceId))
    .where('other.deletedAt', 'is', null)
    .where('other.personGroupId', 'is not', null)
    .where(
      sql<boolean>`exists (
        select 1
        from jsonb_array_elements("otherFrame"."sightings") as theirs, jsonb_array_elements("selfFrame"."sightings") as ours
        where (theirs ->> 't')::double precision = (ours ->> 't')::double precision
      )`,
    );
