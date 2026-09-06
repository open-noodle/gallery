import { Expression, ExpressionBuilder, SqlBool, sql } from 'kysely';
import { SourceType } from 'src/enum';
import { DB } from 'src/schema';
import { petFacePredicate } from 'src/utils/database';

export enum DissolveScope {
  All = 'all',
  Exif = 'exif',
  MachineLearning = 'machine-learning',
  WithoutEmbedding = 'without-embedding',
}

/**
 * Which of a person's faces a dissolve touches. Pets are excluded from EVERY scope (L6): pet faces carry
 * `pet_search` rather than `face_search`, so `WithoutEmbedding` would otherwise match all of them, and pet
 * re-detection is a separate pipeline that clearing `facesRecognizedAt` does not drive.
 */
export const dissolveScopePredicate = (
  eb: ExpressionBuilder<DB, 'asset_face'>,
  scope: DissolveScope,
): Expression<SqlBool> => {
  const notPet = eb.not(petFacePredicate(eb));

  switch (scope) {
    case DissolveScope.All: {
      return notPet;
    }
    case DissolveScope.Exif: {
      return eb.and([notPet, eb('asset_face.sourceType', '=', SourceType.Exif)]);
    }
    case DissolveScope.MachineLearning: {
      return eb.and([notPet, eb('asset_face.sourceType', '=', SourceType.MachineLearning)]);
    }
    case DissolveScope.WithoutEmbedding: {
      return eb.and([
        notPet,
        eb.not(
          eb.exists(
            eb
              .selectFrom('face_search')
              .select(sql`1`.as('one'))
              .whereRef('face_search.faceId', '=', 'asset_face.id'),
          ),
        ),
      ]);
    }
  }
};
