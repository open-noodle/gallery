import { Expression, ExpressionBuilder, SqlBool, sql } from 'kysely';
import { SourceType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { petFacePredicate } from 'src/utils/database.js';

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
  personGroupId: string,
  scope: DissolveScope,
): Expression<SqlBool> =>
  eb.and([eb('asset_face.personGroupId', '=', personGroupId), dissolveScopePredicate(eb, scope)]);

/**
 * A box someone drew by hand. `createdBy` is the SOLE deletability signal for a hand-drawn face
 * (specs/2026-08-23-space-editor-face-assignment-design.md §6.6): it is NULL for every detector face and every
 * pre-existing row, and `sourceType` cannot stand in for it (owner-drawn boxes are `manual` with no `createdBy`).
 *
 * A dissolve never deletes one. Both delete outcomes UNASSIGN in-scope hand-drawn faces instead — the exact
 * treatment the `unassign` outcome gives every face — so the box stays on the photo, unnamed, ready to assign.
 * The preview counts them (`handDrawn`) with this same predicate, so the dialog and the transaction agree.
 */
export const handDrawnFacePredicate = (eb: ExpressionBuilder<DB, 'asset_face'>): Expression<SqlBool> =>
  eb('asset_face.createdBy', 'is not', null);

/**
 * The faces a DELETE outcome actually deletes: in scope, and not hand-drawn. Shared for the same reason as
 * dissolveFacePredicate — the repository's delete statement must not be able to disagree with this rule.
 */
export const dissolveDeletableFacePredicate = (
  eb: ExpressionBuilder<DB, 'asset_face'>,
  personGroupId: string,
  scope: DissolveScope,
): Expression<SqlBool> => eb.and([dissolveFacePredicate(eb, personGroupId, scope), eb.not(handDrawnFacePredicate(eb))]);
