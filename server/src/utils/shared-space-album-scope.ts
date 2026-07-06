// Fork-owned scope helpers for the shared-space "linked album" access path.
//
// Background: an asset is visible inside a shared space through one of three
// paths — a directly-added asset (`shared_space_asset`), a linked library
// (`shared_space_library`), or a LINKED ALBUM (`shared_space_album` ->
// `album_asset`). Before this module the linked-album branch was hand-cloned
// across ~30 upstream + ~19 fork call sites, each re-deriving the same
// `shared_space_album ⋈ album ⋈ album_asset` join and each having to remember the
// `album.deletedAt IS NULL` guard ("A1 invariant") and, on timeline surfaces, the
// `shared_space_album.showInTimeline = true` gate.
//
// This module encodes that album path — and the A1 invariant — exactly ONCE.
// Every call site routes its album leg through `spaceAlbumAssetExists` (used
// positively for read/scope, or negated via `eb.not(...)` for "no other space
// path" face cleanup). Because the module is fork-only, an upstream rebase never
// touches it; each upstream call site shrinks to a single, stable helper call.
//
// See docs / data/sa-abstraction-spec-t8/report.md for the full design + slices.
import { Expression, ExpressionBuilder, RawBuilder, ReferenceExpression, sql, SqlBool } from 'kysely';
import { DB } from 'src/schema';
import { anyUuid, asUuid } from 'src/utils/database';

/**
 * How a space-scoped branch is bound to the space(s) it applies to. Mirrors the
 * exact predicates the hand-cloned branches used:
 *  - `{ spaceId }`      -> `shared_space_album.spaceId = <uuid>`        (literal)
 *  - `{ spaceIds }`     -> `shared_space_album.spaceId = any(<uuid[]>)` (timeline set)
 *  - `{ memberUserId }` -> inner-join `shared_space_member` on the user  (membership)
 *  - `{ spaceIdRef }`   -> `shared_space_album.spaceId = <outer column>` (correlated)
 */
export type SpaceScope =
  | { spaceId: string }
  | { spaceIds: string[] }
  | { memberUserId: string }
  | { spaceIdRef: ReferenceExpression<DB, keyof DB> };

export interface SpaceAlbumAssetOptions {
  /** Outer column the album's asset must match, e.g. 'asset.id' / 'asset_face.assetId'. */
  correlateAssetId: ReferenceExpression<DB, keyof DB>;
  scope: SpaceScope;
  /** Timeline surfaces only: require `shared_space_album.showInTimeline = true`. Default false. */
  requireShowInTimeline?: boolean;
  /**
   * The A1 invariant: require `album.deletedAt IS NULL`. Default true. Passing
   * false reproduces the pre-fix soft-delete hole at the four legacy sites and is
   * ONLY used to keep Slices 1-14 behavior-preserving; Slice 15 removes those.
   */
  requireAlbumNotDeleted?: boolean;
  /** Exclude a specific linked album (the "other album" self-exclusion at getAlbumAssetIdsWithoutOtherSpacePath). */
  excludeAlbumId?: string;
}

/**
 * Spaces a user can access — created OR a member. Relocated here (from
 * sync.repository.ts) so the whole "accessible*" scoping family lives in one
 * fork-owned module; sync.repository.ts re-exports it for its existing callers.
 *
 * Usage: `.where('shared_space.id', 'in', (eb) => accessibleSpaces(eb, userId))`
 */
export function accessibleSpaces(eb: ExpressionBuilder<DB, keyof DB>, userId: string) {
  return eb
    .selectFrom('shared_space')
    .select('shared_space.id')
    .where('shared_space.createdById', '=', userId)
    .union(
      eb
        .selectFrom('shared_space_member')
        .select('shared_space_member.spaceId as id')
        .where('shared_space_member.userId', '=', userId),
    );
}

/**
 * Album ids linked to spaces the user can access, excluding soft-deleted albums
 * (A1). Relocated from sync.repository.ts; re-exported from there.
 *
 * Usage: `.where('album.id', 'in', (eb) => accessibleSpaceAlbums(eb, userId))`
 */
export function accessibleSpaceAlbums(eb: ExpressionBuilder<DB, keyof DB>, userId: string) {
  return eb
    .selectFrom('shared_space_album')
    .innerJoin('album', 'album.id', 'shared_space_album.albumId')
    .select('shared_space_album.albumId as id')
    .where('album.deletedAt', 'is', null)
    .where('shared_space_album.spaceId', 'in', (e) => accessibleSpaces(e, userId));
}

/**
 * The single definition of the linked-album access path, as an `EXISTS (...)`
 * predicate. Negate with `eb.not(spaceAlbumAssetExists(...))` for anti-join /
 * "no other space path" uses.
 */
export function spaceAlbumAssetExists(
  eb: ExpressionBuilder<DB, keyof DB>,
  options: SpaceAlbumAssetOptions,
): Expression<SqlBool> {
  const notDeleted = options.requireAlbumNotDeleted ?? true;
  const { scope } = options;

  return eb.exists(
    eb
      .selectFrom('shared_space_album')
      .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
      // A1 invariant — the album must not be soft-deleted (unless explicitly opted out).
      .$if(notDeleted, (qb) =>
        qb.innerJoin('album', (join) =>
          join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
        ),
      )
      // Membership scope joins the member table inside the subquery.
      .$if('memberUserId' in scope, (qb) =>
        qb
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
          .where('shared_space_member.userId', '=', asUuid((scope as { memberUserId: string }).memberUserId)),
      )
      .select(eb.lit(1).as('exists'))
      .whereRef('album_asset.assetId', '=', options.correlateAssetId)
      .$if('spaceId' in scope, (qb) =>
        qb.where('shared_space_album.spaceId', '=', asUuid((scope as { spaceId: string }).spaceId)),
      )
      .$if('spaceIds' in scope, (qb) =>
        qb.where('shared_space_album.spaceId', '=', anyUuid((scope as { spaceIds: string[] }).spaceIds)),
      )
      .$if('spaceIdRef' in scope, (qb) =>
        qb.whereRef(
          'shared_space_album.spaceId',
          '=',
          (scope as { spaceIdRef: ReferenceExpression<DB, keyof DB> }).spaceIdRef,
        ),
      )
      .$if(!!options.requireShowInTimeline, (qb) => qb.where('shared_space_album.showInTimeline', '=', true))
      .$if(!!options.excludeAlbumId, (qb) => qb.where('shared_space_album.albumId', '!=', options.excludeAlbumId!)),
  );
}

export interface SpacePathBranchOptions {
  /** Outer asset-id column for the direct + album arms, e.g. 'asset.id'. */
  correlateAssetId: ReferenceExpression<DB, keyof DB>;
  /** Outer library-id column for the library arm, e.g. 'asset.libraryId'. */
  correlateLibraryId: ReferenceExpression<DB, keyof DB>;
  scope: SpaceScope;
  requireShowInTimeline?: boolean;
}

/** The directly-added-asset arm (`shared_space_asset`), matching the clean asset-outer sites. */
export function spaceDirectAssetExists(
  eb: ExpressionBuilder<DB, keyof DB>,
  options: { correlateAssetId: ReferenceExpression<DB, keyof DB>; scope: SpaceScope },
): Expression<SqlBool> {
  const { scope } = options;
  return eb.exists(
    eb
      .selectFrom('shared_space_asset')
      .$if('memberUserId' in scope, (qb) =>
        qb
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
          .where('shared_space_member.userId', '=', asUuid((scope as { memberUserId: string }).memberUserId)),
      )
      .select(eb.lit(1).as('exists'))
      .whereRef('shared_space_asset.assetId', '=', options.correlateAssetId)
      .$if('spaceId' in scope, (qb) =>
        qb.where('shared_space_asset.spaceId', '=', asUuid((scope as { spaceId: string }).spaceId)),
      )
      .$if('spaceIds' in scope, (qb) =>
        qb.where('shared_space_asset.spaceId', '=', anyUuid((scope as { spaceIds: string[] }).spaceIds)),
      )
      .$if('spaceIdRef' in scope, (qb) =>
        qb.whereRef(
          'shared_space_asset.spaceId',
          '=',
          (scope as { spaceIdRef: ReferenceExpression<DB, keyof DB> }).spaceIdRef,
        ),
      ),
  );
}

/** The linked-library arm (`shared_space_library`), correlating on the outer library id. */
export function spaceLibraryAssetExists(
  eb: ExpressionBuilder<DB, keyof DB>,
  options: { correlateLibraryId: ReferenceExpression<DB, keyof DB>; scope: SpaceScope },
): Expression<SqlBool> {
  const { scope } = options;
  return eb.exists(
    eb
      .selectFrom('shared_space_library')
      .$if('memberUserId' in scope, (qb) =>
        qb
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
          .where('shared_space_member.userId', '=', asUuid((scope as { memberUserId: string }).memberUserId)),
      )
      .select(eb.lit(1).as('exists'))
      .whereRef('shared_space_library.libraryId', '=', options.correlateLibraryId)
      .$if('spaceId' in scope, (qb) =>
        qb.where('shared_space_library.spaceId', '=', asUuid((scope as { spaceId: string }).spaceId)),
      )
      .$if('spaceIds' in scope, (qb) =>
        qb.where('shared_space_library.spaceId', '=', anyUuid((scope as { spaceIds: string[] }).spaceIds)),
      )
      .$if('spaceIdRef' in scope, (qb) =>
        qb.whereRef(
          'shared_space_library.spaceId',
          '=',
          (scope as { spaceIdRef: ReferenceExpression<DB, keyof DB> }).spaceIdRef,
        ),
      ),
  );
}

/**
 * The three access-path arms `[direct, library, album]`, ready to spread into
 * `eb.or([...ownExtras, ...spaceAssetPathBranches(eb, opts)])`. Only for the
 * "clean" asset-outer sites (correlate on asset.id / asset.libraryId with no
 * per-arm isOffline quirk); other sites route just the album arm through
 * `spaceAlbumAssetExists` and keep their bespoke direct/library arms inline.
 */
export function spaceAssetPathBranches(
  eb: ExpressionBuilder<DB, keyof DB>,
  options: SpacePathBranchOptions,
): [Expression<SqlBool>, Expression<SqlBool>, Expression<SqlBool>] {
  return [
    spaceDirectAssetExists(eb, { correlateAssetId: options.correlateAssetId, scope: options.scope }),
    spaceLibraryAssetExists(eb, { correlateLibraryId: options.correlateLibraryId, scope: options.scope }),
    spaceAlbumAssetExists(eb, {
      correlateAssetId: options.correlateAssetId,
      scope: options.scope,
      requireShowInTimeline: options.requireShowInTimeline,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Raw-SQL family — for the sites that author queries with `sql``` tagged
// templates (face-identity.repository.ts, shared-space.repository.ts stats).
// These emit the SAME album path as the Kysely helpers above; the equivalence is
// pinned by test/medium/specs/utils/shared-space-album-scope-sql.medium.spec.ts.
// ---------------------------------------------------------------------------

export interface SpaceAlbumAssetSqlOptions {
  /** Raw fragment for the outer asset id, e.g. sql`asset.id`. */
  assetIdColumn: RawBuilder<unknown>;
  /**
   * Raw JOIN fragment that scopes `shared_space_album.spaceId` to the target
   * space(s), placed directly after `FROM shared_space_album`, e.g.
   * sql`INNER JOIN timeline_spaces ON timeline_spaces."spaceId" = shared_space_album."spaceId"`.
   */
  spaceScopeJoin: RawBuilder<unknown>;
  /** A1 invariant: require `album.deletedAt IS NULL`. Default true. */
  requireAlbumNotDeleted?: boolean;
}

/**
 * Raw-SQL analogue of `spaceAlbumAssetExists` — an `EXISTS (...)` fragment over
 * the linked-album access path, for interpolation into `sql``` queries.
 */
export function spaceAlbumAssetExistsSql(options: SpaceAlbumAssetSqlOptions): RawBuilder<SqlBool> {
  const albumJoin =
    (options.requireAlbumNotDeleted ?? true)
      ? sql`INNER JOIN album ON album.id = shared_space_album."albumId" AND album."deletedAt" IS NULL`
      : sql``;
  return sql<SqlBool>`EXISTS (
              SELECT 1
              FROM shared_space_album
              ${options.spaceScopeJoin}
              ${albumJoin}
              INNER JOIN album_asset ON album_asset."albumId" = shared_space_album."albumId"
              WHERE album_asset."assetId" = ${options.assetIdColumn}
            )`;
}
