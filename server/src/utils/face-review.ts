import { Expression, ExpressionBuilder, ReferenceExpression, SqlBool } from 'kysely';
import { DB } from 'src/schema';
import { spaceVisibleAssetVisibilities } from 'src/utils/shared-space-album-scope';

/**
 * A face is REVIEWABLE if a human may be shown its crop by either face-review engine.
 * Locked-folder and Hidden assets are excluded: the Locked folder is designed to require the
 * OWNER's elevated re-authentication, and neither the suggestion queue nor the admin cleanup
 * console re-authenticates. Face detection already skips `hidden`, so `locked` is the live gap —
 * both are excluded so the predicate states the whole rule.
 *
 * Deliberately NOT applied to facial recognition itself (handleRecognizeFaces /
 * handleQueueRecognizeFaces): recognition clustering Locked faces into the owner's own people is
 * upstream behaviour and out of scope here. Pinned by S1.2 and S1.14.
 */
export const reviewableAssetVisibility = (
  eb: ExpressionBuilder<DB, keyof DB>,
  column: ReferenceExpression<DB, keyof DB> = 'asset.visibility',
): Expression<SqlBool> => eb(column, 'in', spaceVisibleAssetVisibilities);
