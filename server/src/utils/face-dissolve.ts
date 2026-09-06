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
    // tsconfig has no `noImplicitReturns`, so without this a future fifth scope would fall through and
    // return `undefined` straight into `eb.and([predicate, undefined])` — silently dropping the scope term
    // from an irreversible delete. `satisfies never` makes that a compile error instead.
    default: {
      return scope satisfies never;
    }
  }
};

/**
 * The full "which faces does this dissolve touch" predicate: the target person AND the scope.
 *
 * Shared deliberately. The preview (`getCounts`) and the apply (`dissolve`) MUST describe the same face set
 * — a one-sided edit would make the dialog promise one thing and the transaction do another, on an
 * operation with no undo, and no test would catch it. One definition, two call sites.
 */
export const dissolveFacePredicate = (
  eb: ExpressionBuilder<DB, 'asset_face'>,
  personId: string,
  scope: DissolveScope,
): Expression<SqlBool> => eb.and([eb('asset_face.personId', '=', personId), dissolveScopePredicate(eb, scope)]);
