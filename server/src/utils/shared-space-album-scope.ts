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
// This module encodes that album path — and the A1 invariant — in TWO places, not
// one. `spaceAlbumAssetExists` is the EXISTS/per-row form nearly every call site
// routes its album leg through (positively for read/scope, or negated via
// `eb.not(...)` for "no other space path" face cleanup). `spaceAssetIdUnion` is a
// second, hand-written encoding of the same path, used only when driving FROM the
// space's membership rows instead of testing membership per candidate row (see its
// own doc comment for why that split exists). Because the module is fork-only, an
// upstream rebase never touches it; each upstream call site still shrinks to a
// single, stable helper call — only `spaceAssetIdUnion`'s callers carry the second
// copy. The two encodings are pinned separately, not against each other: the
// static SQL-shape guard in game.repository.spec.ts pins `spaceAssetIdUnion`'s
// emitted arms directly, and this file's own guard.spec.ts pins that a
// `shared_space_library` reference in a scanned file always has album coverage
// nearby, so a future call site can't lose the album leg silently.
//
// See docs / data/sa-abstraction-spec-t8/report.md for the full design + slices.
import { Expression, ExpressionBuilder, Kysely, RawBuilder, ReferenceExpression, sql, SqlBool } from 'kysely';
import { AssetVisibility, SharedSpaceRole } from 'src/enum';
import { DB } from 'src/schema';
import { anyUuid, asUuid } from 'src/utils/database';

/**
 * The canonical set of asset visibilities that are shareable through a space.
 * Hidden and Locked assets are never shareable; Archive and Timeline are.
 * This is the single source of truth — previously declared as three local
 * constants under two names across shared-space, face-identity, and person
 * repositories.
 */
export const spaceVisibleAssetVisibilities = [AssetVisibility.Archive, AssetVisibility.Timeline];

/**
 * Returns an `eb.in` predicate restricting `column` to the two space-shareable
 * visibility values (`archive`, `timeline`).
 *
 * Default column presumes an `asset`-rooted/joined query; not usable on an
 * `asset`-less builder.
 *
 * Usage: `.where((eb) => spaceVisibilityGate(eb))`
 */
export function spaceVisibilityGate(
  eb: ExpressionBuilder<DB, keyof DB>,
  column: ReferenceExpression<DB, keyof DB> = 'asset.visibility',
): Expression<SqlBool> {
  return eb(column, 'in', spaceVisibleAssetVisibilities);
}

/**
 * How a space-scoped branch is bound to the space(s) it applies to. Mirrors the
 * exact predicates the hand-cloned branches used:
 *  - `{ spaceId }`      -> `shared_space_album.spaceId = <uuid>`        (literal)
 *  - `{ spaceIds }`     -> `shared_space_album.spaceId = any(<uuid[]>)` (timeline set)
 *  - `{ memberUserId }` -> inner-join `shared_space_member` on the user  (membership)
 *  - `{ spaceIdRef }`   -> `shared_space_album.spaceId = <outer column>` (correlated)
 *
 * `{ memberUserId }` additionally accepts an optional `memberRole` — when set, the membership
 * join also requires `shared_space_member.role IN (memberRole)` (e.g. restricting to Owner/Editor
 * for a write-capable scope). Omitting it preserves the original any-role membership check.
 *
 * It also accepts an optional `memberShowInTimeline` — when true, the membership join additionally
 * requires `shared_space_member.showInTimeline = true`: the member has not hidden that space from
 * their own timeline. This is the PER-MEMBER flag, independent of `requireShowInTimeline` below
 * (which is the per-LINK `shared_space_album.showInTimeline`); a surface that wants "spaces this
 * user actually wants to see" needs both. It defaults to false so every pre-existing caller keeps
 * the behaviour it was written with — the surfaces that already honour the flag resolve the
 * timeline-enabled space ids themselves and pass `{ spaceIds }`, so only a caller scoping purely
 * by membership has to decide, and it has to decide deliberately.
 */
export type SpaceScope =
  | { spaceId: string }
  | { spaceIds: string[] }
  | { memberUserId: string; memberRole?: SharedSpaceRole[]; memberShowInTimeline?: boolean }
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
 * The linked-album access path, as an `EXISTS (...)` predicate. Covers BOTH sources of a linked
 * album's contents: the album owner's own `album_asset` rows AND cross-owner `album_space_asset`
 * contributions (#764). Because both arms are unioned here, every consumer of the album arm
 * (timeline, search, map, view, memory, access, …) surfaces contributions with the exact same
 * membership / role / showInTimeline / not-deleted scoping it already applies — no per-site change.
 *
 * Negate with `eb.not(spaceAlbumAssetExists(...))` for anti-join / "no other space path" uses:
 * `NOT (albumAsset OR contributed)` correctly excludes both.
 */
export function spaceAlbumAssetExists(
  eb: ExpressionBuilder<DB, keyof DB>,
  options: SpaceAlbumAssetOptions,
): Expression<SqlBool> {
  return eb.or([linkedAlbumAssetExists(eb, options), spaceContributedAssetExists(eb, options)]);
}

/** The `album_asset` arm — the album owner's own contents (unchanged pre-#764 behavior). */
function linkedAlbumAssetExists(
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
          .where('shared_space_member.userId', '=', asUuid((scope as { memberUserId: string }).memberUserId))
          .$if(!!(scope as { memberRole?: SharedSpaceRole[] }).memberRole?.length, (qb2) =>
            qb2.where('shared_space_member.role', 'in', (scope as { memberRole: SharedSpaceRole[] }).memberRole),
          )
          .$if(!!(scope as { memberShowInTimeline?: boolean }).memberShowInTimeline, (qb2) =>
            qb2.where('shared_space_member.showInTimeline', '=', true),
          ),
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

/**
 * The `album_space_asset` arm — cross-owner contributions (#764). Mirrors {@link linkedAlbumAssetExists}
 * exactly, except the join additionally correlates `album_space_asset.spaceId` to the link's space so
 * a contribution is only ever visible through the SINGLE space it was contributed to (a multi-space
 * album never leaks a contribution to members of a different linked space). Exported for direct use
 * where only the contributed arm is wanted.
 */
export function spaceContributedAssetExists(
  eb: ExpressionBuilder<DB, keyof DB>,
  options: SpaceAlbumAssetOptions,
): Expression<SqlBool> {
  const notDeleted = options.requireAlbumNotDeleted ?? true;
  const { scope } = options;

  return eb.exists(
    eb
      .selectFrom('shared_space_album')
      .innerJoin('album_space_asset', (join) =>
        join
          .onRef('album_space_asset.albumId', '=', 'shared_space_album.albumId')
          .onRef('album_space_asset.spaceId', '=', 'shared_space_album.spaceId'),
      )
      .$if(notDeleted, (qb) =>
        qb.innerJoin('album', (join) =>
          join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
        ),
      )
      .$if('memberUserId' in scope, (qb) =>
        qb
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
          .where('shared_space_member.userId', '=', asUuid((scope as { memberUserId: string }).memberUserId))
          .$if(!!(scope as { memberRole?: SharedSpaceRole[] }).memberRole?.length, (qb2) =>
            qb2.where('shared_space_member.role', 'in', (scope as { memberRole: SharedSpaceRole[] }).memberRole),
          )
          .$if(!!(scope as { memberShowInTimeline?: boolean }).memberShowInTimeline, (qb2) =>
            qb2.where('shared_space_member.showInTimeline', '=', true),
          ),
      )
      .select(eb.lit(1).as('exists'))
      .whereRef('album_space_asset.assetId', '=', options.correlateAssetId)
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
          .where('shared_space_member.userId', '=', asUuid((scope as { memberUserId: string }).memberUserId))
          .$if(!!(scope as { memberRole?: SharedSpaceRole[] }).memberRole?.length, (qb2) =>
            qb2.where('shared_space_member.role', 'in', (scope as { memberRole: SharedSpaceRole[] }).memberRole),
          )
          .$if(!!(scope as { memberShowInTimeline?: boolean }).memberShowInTimeline, (qb2) =>
            qb2.where('shared_space_member.showInTimeline', '=', true),
          ),
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
          .where('shared_space_member.userId', '=', asUuid((scope as { memberUserId: string }).memberUserId))
          .$if(!!(scope as { memberRole?: SharedSpaceRole[] }).memberRole?.length, (qb2) =>
            qb2.where('shared_space_member.role', 'in', (scope as { memberRole: SharedSpaceRole[] }).memberRole),
          )
          .$if(!!(scope as { memberShowInTimeline?: boolean }).memberShowInTimeline, (qb2) =>
            qb2.where('shared_space_member.showInTimeline', '=', true),
          ),
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

/**
 * How a `spaceAssetIdUnion` is bound: to ONE space, or to every space a user belongs to. The
 * narrower cousin of `SpaceScope` - the union form has no correlated outer row to reference, so
 * the `spaceIdRef` and `spaceIds` cases have no meaning here. `memberShowInTimeline` means the same
 * thing it does there, and defaults the same way.
 */
export type SpaceAssetUnionScope = { spaceId: string } | { memberUserId: string; memberShowInTimeline?: boolean };

/**
 * Every asset id reachable from one space - or from every space a user belongs to - as a UNION
 * over the four access paths.
 *
 * The counterpart to `spaceAssetPathBranches`, which tests membership per candidate row. Both
 * express the same set; they differ in which side drives. Use the branches when you already have
 * a specific asset (one index probe); use this union when you are SELECTING the space's assets,
 * because the correlated form makes cost proportional to the whole asset table rather than to the
 * space - measured at 3.7 GB of buffers and 14 s cold for a 56.5k-asset space, versus 406 MB and
 * 169 ms driving from here.
 *
 * `union` (not `union all`) because the paths overlap: an asset can be both directly added and
 * present through a linked album. Under `{ memberUserId }` they overlap harder still - two of the
 * user's spaces can each hold the same asset - and the dedup is what keeps that from weighting a
 * photo twice in whatever the caller does downstream.
 *
 * `requireShowInTimeline` defaults to `true` here, unlike `spaceAssetPathBranches` (whose default
 * is `false`) - every current caller (`GameRepository`'s candidate queries) is a timeline surface,
 * so this keeps their call sites unchanged. The two album arms below hardcode the flag onto their
 * own `shared_space_album.showInTimeline` filter with no other escape hatch, so a non-timeline
 * consumer MUST pass `requireShowInTimeline: false` explicitly rather than relying on the default.
 */
export function spaceAssetIdUnion(
  db: Kysely<DB>,
  scope: SpaceAssetUnionScope,
  options: { requireShowInTimeline?: boolean } = {},
) {
  const requireShowInTimeline = options.requireShowInTimeline ?? true;
  // Keyed off which case of the scope was passed, never off the truthiness of the id it carries.
  // An empty-string id under a truthiness test would drop the filter entirely and hand back every
  // space's assets - failing OPEN, the one direction this function must never fail in. Written
  // this way it emits `= ''`, which matches nothing.
  const bySpaceId = 'spaceId' in scope;
  const byMember = 'memberUserId' in scope;
  const spaceId = bySpaceId ? scope.spaceId : '';
  const memberUserId = byMember ? scope.memberUserId : '';
  // Same per-member flag, same default, and the same reasoning as `SpaceScope` - see its doc.
  const memberShowInTimeline = byMember && !!scope.memberShowInTimeline;

  return db
    .selectFrom('shared_space_asset')
    .select('shared_space_asset.assetId as assetId')
    .$if(bySpaceId, (qb) => qb.where('shared_space_asset.spaceId', '=', asUuid(spaceId)))
    .$if(byMember, (qb) =>
      qb
        .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
        .where('shared_space_member.userId', '=', asUuid(memberUserId))
        .$if(memberShowInTimeline, (qb2) => qb2.where('shared_space_member.showInTimeline', '=', true)),
    )
    .union(
      db
        .selectFrom('asset')
        .innerJoin('shared_space_library', (join) => {
          const onLibrary = join.onRef('shared_space_library.libraryId', '=', 'asset.libraryId');
          return bySpaceId ? onLibrary.on('shared_space_library.spaceId', '=', asUuid(spaceId)) : onLibrary;
        })
        .$if(byMember, (qb) =>
          qb
            .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
            .where('shared_space_member.userId', '=', asUuid(memberUserId))
            .$if(memberShowInTimeline, (qb2) => qb2.where('shared_space_member.showInTimeline', '=', true)),
        )
        .select('asset.id as assetId'),
    )
    .union(
      db
        .selectFrom('shared_space_album')
        .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
        .innerJoin('album', (join) =>
          join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
        )
        .$if(byMember, (qb) =>
          qb
            .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
            .where('shared_space_member.userId', '=', asUuid(memberUserId))
            .$if(memberShowInTimeline, (qb2) => qb2.where('shared_space_member.showInTimeline', '=', true)),
        )
        .select('album_asset.assetId as assetId')
        .$if(bySpaceId, (qb) => qb.where('shared_space_album.spaceId', '=', asUuid(spaceId)))
        .$if(requireShowInTimeline, (qb) => qb.where('shared_space_album.showInTimeline', '=', true)),
    )
    .union(
      db
        .selectFrom('shared_space_album')
        .innerJoin('album_space_asset', (join) =>
          join
            .onRef('album_space_asset.albumId', '=', 'shared_space_album.albumId')
            .onRef('album_space_asset.spaceId', '=', 'shared_space_album.spaceId'),
        )
        .innerJoin('album', (join) =>
          join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
        )
        .$if(byMember, (qb) =>
          qb
            .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
            .where('shared_space_member.userId', '=', asUuid(memberUserId))
            .$if(memberShowInTimeline, (qb2) => qb2.where('shared_space_member.showInTimeline', '=', true)),
        )
        .select('album_space_asset.assetId as assetId')
        .$if(bySpaceId, (qb) => qb.where('shared_space_album.spaceId', '=', asUuid(spaceId)))
        .$if(requireShowInTimeline, (qb) => qb.where('shared_space_album.showInTimeline', '=', true)),
    );
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
  /** Timeline surfaces only: require `shared_space_album.showInTimeline = true`. Default false. */
  requireShowInTimeline?: boolean;
}

/**
 * Raw-SQL analogue of `spaceAlbumAssetExists` — an `EXISTS (...) OR EXISTS (...)` fragment over
 * the linked-album access path, for interpolation into `sql``` queries. Emits BOTH arms, mirroring
 * spaceAlbumAssetExists: the album owner's own `album_asset` rows, and cross-owner `album_space_asset`
 * contributions (#752 P1-7 — previously this raw-SQL analogue only emitted the `album_asset` arm,
 * despite its header claiming parity with the two-arm Kysely helper). The outer parentheses keep
 * this precedence-safe for every consumer that interpolates it into a larger `OR ${...}` / negates
 * it via `NOT (...)`.
 */
/**
 * "Can this viewer see `asset` on a timeline surface?" — the predicate the People-page aggregates
 * correlate per face row. A viewer reaches an asset by owning it, or through one of three space
 * paths: a directly-added asset, a linked library, or a linked album.
 *
 * **Every space arm joins the `timeline_spaces` CTE**, so a viewer who belongs to no
 * timeline-enabled space cannot satisfy any of them, and the predicate is exactly
 * `asset."ownerId" = <viewer>`. Postgres cannot deduce that at plan time — it evaluates the whole
 * OR per candidate row, which on a large single-user library meant hundreds of thousands of index
 * probes into `asset` that removed nothing. Passing `hasTimelineSpaces: false` emits the collapsed
 * form instead.
 *
 * The caller is responsible for establishing `hasTimelineSpaces` (a `shared_space_member` lookup
 * on `userId` + `showInTimeline`), and for defining the `timeline_spaces` CTE this correlates
 * against when it is true.
 *
 * If a future space path is added here that is NOT gated on `timeline_spaces`, the collapsed form
 * becomes wrong — `accessible-timeline-asset-predicate.medium.spec.ts` compares the two forms'
 * result sets and will fail.
 */
export function accessibleTimelineAssetPredicate(options: {
  userId: string;
  hasTimelineSpaces: boolean;
}): RawBuilder<SqlBool> {
  if (!options.hasTimelineSpaces) {
    return sql<SqlBool>`asset."ownerId" = ${options.userId}`;
  }

  return sql<SqlBool>`asset."ownerId" = ${options.userId}
            OR EXISTS (
              SELECT 1
              FROM shared_space_asset
              INNER JOIN timeline_spaces ON timeline_spaces."spaceId" = shared_space_asset."spaceId"
              WHERE shared_space_asset."assetId" = asset.id
            )
            OR EXISTS (
              SELECT 1
              FROM shared_space_library
              INNER JOIN timeline_spaces ON timeline_spaces."spaceId" = shared_space_library."spaceId"
              WHERE shared_space_library."libraryId" = asset."libraryId"
            )
            OR ${spaceAlbumAssetExistsSql({
              assetIdColumn: sql`asset.id`,
              spaceScopeJoin: sql`INNER JOIN timeline_spaces ON timeline_spaces."spaceId" = shared_space_album."spaceId"`,
              requireShowInTimeline: true,
            })}`;
}

export function spaceAlbumAssetExistsSql(options: SpaceAlbumAssetSqlOptions): RawBuilder<SqlBool> {
  const albumJoin =
    (options.requireAlbumNotDeleted ?? true)
      ? sql`INNER JOIN album ON album.id = shared_space_album."albumId" AND album."deletedAt" IS NULL`
      : sql``;
  const timelineGate = options.requireShowInTimeline ? sql`AND "shared_space_album"."showInTimeline" = true` : sql``;
  return sql<SqlBool>`(EXISTS (
              SELECT 1
              FROM shared_space_album
              ${options.spaceScopeJoin}
              ${albumJoin}
              INNER JOIN album_asset ON album_asset."albumId" = shared_space_album."albumId"
              WHERE album_asset."assetId" = ${options.assetIdColumn}
              ${timelineGate}
            ) OR EXISTS (
              SELECT 1
              FROM shared_space_album
              ${options.spaceScopeJoin}
              ${albumJoin}
              INNER JOIN album_space_asset ON album_space_asset."albumId" = shared_space_album."albumId"
                AND album_space_asset."spaceId" = shared_space_album."spaceId"
              WHERE album_space_asset."assetId" = ${options.assetIdColumn}
              ${timelineGate}
            ))`;
}
