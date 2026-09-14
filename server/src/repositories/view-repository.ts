import { Expression, ExpressionBuilder, Kysely, SqlBool } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { asUuid, withExif } from 'src/utils/database';
import { favoriteExistsFor } from 'src/utils/favorite';
import {
  hiddenFromOwnTimeline,
  spaceAssetPathBranches,
  TimelineHiddenScope,
  timelineHiddenScopeIsEmpty,
} from 'src/utils/shared-space-album-scope';

// #1041 §3: `ownedOrSpaceAccessible` already ORs a visible-path branch alongside the owner term
// over the same `visibleSpaceIds`, so the subtraction must NOT emit a second copy of it. Hoisted to
// a const rather than written inline: the space-visibility guard attributes a space-asset read to
// the nearest preceding `identifier(` line and requires a visibility gate within ±50 lines, so
// growing that function pushes `getAssetsByOriginalPath`'s gate out of range and misattributes the
// arm (the guard's own NON_DECL list documents this trap).
const SIBLING_ARM = { kind: 'sibling-arm' } as const;

export class ViewRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  async getUniqueOriginalPaths(userId: string, hiddenScope?: TimelineHiddenScope, visibleSpaceIds?: string[]) {
    const results = await this.db
      .selectFrom('asset')
      .select((eb) => eb.fn<string>('substring', ['asset.originalPath', eb.val('^(.*/)[^/]*$')]).as('directoryPath'))
      .distinct()
      .where((eb) => this.ownedOrSpaceAccessible(eb, userId, hiddenScope, visibleSpaceIds))
      .where('visibility', '=', AssetVisibility.Timeline)
      .where('deletedAt', 'is', null)
      .where('fileCreatedAt', 'is not', null)
      .where('fileModifiedAt', 'is not', null)
      .where('localDateTime', 'is not', null)
      .orderBy('directoryPath', 'asc')
      .execute();

    return results.map((row) => row.directoryPath.replaceAll(/\/$/g, ''));
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async getAssetsByOriginalPath(
    userId: string,
    partialPath: string,
    hiddenScope?: TimelineHiddenScope,
    visibleSpaceIds?: string[],
  ) {
    const normalizedPath = partialPath.replaceAll(/\/$/g, '');

    return (
      this.db
        .selectFrom('asset')
        .selectAll('asset')
        .$call(withExif)
        // #763: userId doubles as the caller here (this repository has only one user concept — no
        // owner/caller split like the shared-space browse paths), so it's also the right id to
        // project the per-user isFavorite overlay for. Gated on `.$if` (always true — userId is a
        // required param) purely so Kysely infers `isFavoriteForUser` as optional, matching
        // MapAsset and every other projection site instead of forcing it required here alone.
        .$if(!!userId, (qb) => qb.select((eb) => favoriteExistsFor(eb, userId).as('isFavoriteForUser')))
        .where((eb) => this.ownedOrSpaceAccessible(eb, userId, hiddenScope, visibleSpaceIds))
        .where('visibility', '=', AssetVisibility.Timeline)
        .where('deletedAt', 'is', null)
        .where('fileCreatedAt', 'is not', null)
        .where('fileModifiedAt', 'is not', null)
        .where('localDateTime', 'is not', null)
        .where('originalPath', 'like', `%${normalizedPath}/%`)
        .where('originalPath', 'not like', `%${normalizedPath}/%/%`)
        .orderBy(
          (eb) => eb.fn('regexp_replace', ['asset.originalPath', eb.val('.*/(.+)'), eb.val(String.raw`\1`)]),
          'asc',
        )
        .execute()
    );
  }

  // The folder explorer shows folders for assets a user can actually see: their own,
  // plus any reachable through a shared space they are a member of — either added to
  // the space directly or via a library linked to the space. Mirrors the access rules
  // in AccessRepository.checkSpaceAccess so non-admin space members are not stuck with
  // an empty tree (issue #637).
  //
  // #1041: this is a personal-timeline surface — Archive parity (§4). The owner term carries the
  // caller's-own-timeline subtraction (`hiddenFromOwnTimeline`, omitted entirely when `hiddenScope`
  // is empty/absent so a viewer who has hidden nothing pays nothing), and the album arm gates on the
  // VIEWER's own per-user hide (`albumTimelineGate: 'personal'`) rather than the shared
  // showInTimeline flag — a folder is not a per-viewer-partner surface, so there is no
  // partner-trap split here: `userId` IS the viewer.
  //
  // `visibleSpaceIds` (mirrors timeline.service.ts's `timelineSpaceIds`, resolved the same way via
  // `getSpaceIdsForTimeline`): without it the space arm used PLAIN `{ memberUserId }` scope — ANY
  // role, regardless of `shared_space_member.showInTimeline` — so a member who hid a whole SPACE
  // for themselves would still see their own directly-added assets resurface here via this arm,
  // even though the owner term above correctly subtracted them (they are OR'd). Falls back to
  // `{ memberUserId }` when omitted so a caller that hasn't been updated keeps today's behavior.
  private ownedOrSpaceAccessible(
    eb: ExpressionBuilder<DB, 'asset'>,
    userId: string,
    hiddenScope?: TimelineHiddenScope,
    visibleSpaceIds?: string[],
  ) {
    const subtraction =
      hiddenScope && !timelineHiddenScopeIsEmpty(hiddenScope)
        ? hiddenFromOwnTimeline(eb, hiddenScope, SIBLING_ARM)
        : undefined;
    const ownerTerm: Expression<SqlBool> = subtraction
      ? eb.and([eb('asset.ownerId', '=', asUuid(userId)), subtraction])
      : eb('asset.ownerId', '=', asUuid(userId));

    return eb.or([
      ownerTerm,
      ...spaceAssetPathBranches(eb, {
        correlateAssetId: 'asset.id',
        correlateLibraryId: 'asset.libraryId',
        scope: visibleSpaceIds ? { spaceIds: visibleSpaceIds } : { memberUserId: userId },
        albumTimelineGate: 'personal',
        viewerId: userId,
      }),
    ]);
  }
}
