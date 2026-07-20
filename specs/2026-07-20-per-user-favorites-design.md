# Per-user favorites (`asset_favorite` overlay) — design

## 0. Meta

| Field      | Value                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| Date       | 2026-07-20                                                                             |
| Issue      | [#763](https://github.com/open-noodle/gallery/issues/763)                              |
| Status     | Approved — ready for `/impl-loop`                                                      |
| Branch     | `worktree-fix-763-space-member-favorite`                                               |
| Scope      | server + web + mobile, landing atomically                                              |
| Supersedes | Known gap 4 in `docs/plans/shared-spaces-permission-matrix.md:178` (favorite arm only) |

Method: **TDD, red first**, on every slice. Each slice states its BDD scenarios, the failing
test that proves the gap, the fix, and an explicit edge-case list that must have assertions.
No slice is done until its negatives are asserted, not just its happy path.

---

## 1. Problem

In a Shared Space, the favorite (heart) action is absent from the photo action menu for anyone
who is not the asset's owner. The reporter's framing — "favoriting is a personal, per-user
curation action" — describes behavior the data model does not implement.

Three facts define the problem:

1. **Favorite is global asset state.** `isFavorite` is a single boolean column on the `asset`
   row (`server/src/schema/tables/asset.table.ts:93-94`), present since
   `1744910873969-InitialMigration.ts:120`. There is no per-user favorite table anywhere in
   `server/src/schema/tables/`.

2. **The web UI gates strictly on ownership.** `web/src/lib/services/asset.service.ts:115`
   computes `isOwner = authUser.id === asset.ownerId`; the Favorite and Unfavorite actions gate
   on it at `:170-176` and `:178-184`. The gate covers both the rendered button and the `f`
   shortcut (both are `ActionItem.$if` from `@immich/ui`). The multi-select bar does the same via
   `asset-multi-select-manager.svelte.ts:23-25,30-31`, which is why space pages hide the heart
   entirely once a selection includes a photo you don't own
   (`routes/(user)/spaces/[spaceId]/…/+page.svelte:883-888`).

3. **The server is looser than the UI, in the wrong direction.** `Permission.AssetUpdate` unions
   in `checkSpaceEditAccess` (`server/src/utils/access.ts:155-159`), and the field-level owner
   guard in `asset.service.ts:224-237,324-340` covers only `visibility` and `livePhotoVideoId` —
   `isFavorite` passes through unchecked (`:341`). A space **editor or owner** can therefore
   `PUT /assets/:id {isFavorite:true}` on another member's photo today and flip the real owner's
   flag. The web UI never issues that call, so it is reachable only via API/mobile, but the authz
   layer permits it and `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts:705` asserts it
   as intended behavior.

So the bug report and the latent authz bug are the same bug seen from two sides: favorite is
modelled as owned, global state, and every surface has patched around that inconsistently.

### 1.1 What is already correct

The fork has **already implemented the per-user read semantics** against the global column, by
masking on ownership:

- `server/src/dtos/asset-response.dto.ts:228` —
  `isFavorite: options.auth?.user.id === entity.ownerId && entity.isFavorite`
- `server/src/repositories/asset.repository.ts:1432` —
  ``sql`asset."isFavorite" and asset."ownerId" = ${auth.user.id}`.as('isFavorite')``
- `sync.repository.ts` — `CASE WHEN ownerId = $1 …` on every cross-user stream
  (`:240,260,283` album; `:998,1029,1059` shared space; `:1310,1347` library;
  `:1827,1852,1886,1909,1941,1965` shared-space album), and hardcoded `false` for partners
  (`:661,:681`, with `schema/migrations/1777897107000-PartnerAssetSyncReset.ts` cleaning up a
  server ≤2.x leak).

**Consequence for the design:** `AssetResponseDto.isFavorite` already means "favorited by you".
The API contract does not change. This work replaces each ownership-masking expression with a
join against an overlay table, and makes the write path per-user. It is a substitution, not new
plumbing.

**Consequence for review:** claims elsewhere that the thumbnail heart badge leaks the owner's
favorite state to space members are **false** — `Thumbnail.svelte:337` renders
`asset.isFavorite`, which `asset-response.dto.ts:228` has already zeroed for non-owners.

### 1.2 The guard that encodes the bug

`server/src/services/timeline.service.ts` throws `BadRequestException` when `isFavorite` is
combined with `withPartners` or `withSharedSpaces` — the `isFavorite` checks are at `:180,192`,
the `throw`s at `:183-185,195-197`. Note the predicate is
`dto.isFavorite === true || dto.isFavorite === false`, so it trips on **`false` as well as
`true`**; both arms change in slice 4. Web mirrors it in ~12 places as
`withSharedSpaces: filters.isFavorite === undefined` (heaviest:
`routes/(user)/photos/[[assetId=id]]/+page.svelte`). `shared-space.service.ts:1040` skips
space-ID resolution when `isFavorite === true`; `map.service.ts:21,26` does the same.

That guard exists **only** because the column is global — favorites could not be meaningfully
combined with a cross-user scope. Removing it is what actually delivers #763: favorites that
work across spaces.

---

## 2. Goals & non-goals

### Goals

- Favoriting is personal for **every** user, including the asset owner. Your favorite is
  invisible to, and independent of, everyone else's.
- Any user who can **read** an asset can favorite it — space viewers included.
- Favorites compose with cross-user scopes (spaces, partners) instead of being mutually exclusive.
- A space editor can no longer alter the owner's favorite state, by construction.
- `AssetResponseDto` keeps its current shape; existing API consumers keep working.
- Server, web and mobile stay consistent at every commit.

### Non-goals

- **Archive (`visibility`) and rating (`asset_exif.rating`)** have the identical owner-gated,
  global-state problem (same known-gap line, `shared-spaces-permission-matrix.md:178`). This
  design deliberately covers **favorite only** and documents the overlay as the reusable pattern
  (§11.1). Archive additionally interacts with trash and the visibility enum in ways favorite
  does not.
- `person.isFavorite` is a **separate feature** on the person table. Untouched. Roughly half of
  all repo-wide `isFavorite` matches are person favorites or mobile's device-local backup mirror
  (`local_asset.entity.dart:16-17,44`, `trashed_local_asset.entity.dart:25,46`) — neither is in
  scope, and neither should be counted when sizing a slice.
- No favorites UI redesign. Same heart, same `/favorites` route, same filter chips.
- No shared/collaborative "space favorites" concept.

---

## 3. The core invariant

> A favorite is a fact about **(user, asset)**, never about an asset alone. Reading it requires
> the reader's identity; writing it requires only that the writer can read the asset; and no
> write by user A can ever change what user B sees.

Two corollaries the slices must assert as negatives:

- **No cross-user write.** There is no code path by which any role — space owner, space editor,
  album owner, partner, or system admin — mutates another user's favorite. Admin elevation
  (`hasElevatedPermission`) does not grant it.
- **No cross-user read.** A favorite row for user B never surfaces in user A's response payload,
  timeline bucket, sync stream, statistic, or map marker.

---

## 4. Data model

New fork table, structurally a copy of the established per-user overlay precedent
`server/src/schema/tables/shared-space-person-alias.table.ts` (composite `(entityId, userId)` PK
letting each member hold their own value for a shared entity without touching the shared row):

```ts
@Table('asset_favorite')
export class AssetFavoriteTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', primary: true })
  userId!: string;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', primary: true })
  assetId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  // Sync watermarks — see §4.3. Favorites are their own synced entity, not a field
  // on the asset row, so they need their own createId/updateId cursors.
  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

**PK order is `(userId, assetId)`, deliberately.** The dominant query is "my favorites"
(`/favorites` route, `isFavorite: true` filters, statistics), which is `userId`-leading. The
`assetId` foreign key carries its own index for the per-asset existence check used by the read
path.

**Both FKs are `ON DELETE CASCADE`**: deleting a user or an asset removes the rows. There is no
`addedById`-style nullable actor column — the `userId` _is_ the actor, so `SET NULL` would be
meaningless.

`createdAt` is not read by any slice in this design. It is included because favorite-ordering
("recently favorited") is a plausible near-term ask and adding a timestamp column later to a
large table is more expensive than carrying it from the start. Slices must not build behavior on it.

### 4.3 Sync watermarks and the audit table — RESOLVED: both are required

An earlier draft of this section assumed favorites were single-user state that mobile could
reconcile without a tombstone stream, and deferred the question to a slice-0 proof. **That proof
was run during slice-0 planning and the assumption is refuted.** The resolution is recorded here
because it changes the table definition above.

**The mechanism.** Sync streams page on `updateId`, a UUIDv7 watermark column — see
`server/src/repositories/sync.repository.ts:136-143`:

```ts
const updateIdRef = ref(`${t}.updateId`);
  .where(updateIdRef, '<', nowId)
  .where(updateIdRef, '<=', beforeUpdateId)
  .$if(!!afterUpdateId, (qb) => qb.where(updateIdRef, '>', afterUpdateId!))
```

An asset is re-emitted to a device only when `asset.updateId` advances. If a favorite write
touches only `asset_favorite`, the asset's watermark never moves, the incremental stream never
re-emits that asset, and **the favorite never reaches the device**. A full resync masks this
entirely, so it would not surface in a naive slice-6 test.

**The two candidate fixes, and why one loses.**

1. _Favorite writes bump `asset.updateId`._ Rejected. A viewer favoriting would mutate the
   **owner's** asset row, re-syncing that asset to every member of the space — cross-user write
   amplification triggered by a personal action, and in tension with §3's invariant that no write
   by user A changes what user B sees.
2. _`asset_favorite` becomes its own synced entity._ **Chosen.** It carries `createId` / `updateId`
   watermarks and an `asset_favorite_audit` tombstone table for the delete stream, exactly
   mirroring `album_space_asset` + `album_space_asset_audit`.

**Consequences.** `asset_favorite_audit` is created in **slice 0**, alongside the main table and
its delete trigger — never later, because slice 3 is irreversible. Slice 6 consumes these streams
rather than introducing them. Both tables need DROP lines, step-8 migration entries and step-9
guard entries in `revert-to-immich.sql` (§4.2), and `asset_favorite_audit` ends with `_audit`, so
it _is_ caught by the existing `revert-to-immich.spec.ts` filter — but `asset_favorite` still is
not, so the filter widening in §4.2 remains required.

**Note on the API-shape claim (§1.1).** `AssetResponseDto.isFavorite` still does not change shape.
Favorites being a separately-synced entity is a **sync-transport** decision, not a REST-payload
one; the REST asset response continues to carry a resolved per-user boolean.

### 4.1 Migration

Fork migration in `server/src/schema/migrations-gallery/`, round timestamp per the house
convention:

1. `CREATE TABLE asset_favorite …`
2. Backfill:
   `INSERT INTO asset_favorite ("userId", "assetId") SELECT "ownerId", id FROM asset WHERE "isFavorite" = true`
   — camelCase identifiers **must** be double-quoted or Postgres folds them to lowercase and the
   insert fails against the generated schema.
3. Drop `asset."isFavorite"` — **in slice 3, not slice 0** (see §9 ordering rationale).

The backfill assigns each existing favorite to the **owner**, which is exactly what the current
masking semantics already imply: nobody but the owner could ever observe it.

Must apply cleanly on a database that already has every #752 migration, via the unordered-migration
path (`allowUnorderedMigrations: true`, `DatabaseRepository.createMigrator()`).

### 4.2 Revert-to-immich — a new step class

`scripts/revert-to-immich.sql` today **only ever DROPs fork tables** — `grep "ADD COLUMN"`
returns nothing across the file. Dropping `asset.isFavorite` makes this the **first fork change
that removes upstream schema**, so the revert path must now _restore_ it:

1. `ALTER TABLE asset ADD COLUMN "isFavorite" boolean NOT NULL DEFAULT false`
2. Backfill from the overlay, **owner rows only**:
   `UPDATE asset SET "isFavorite" = true FROM asset_favorite f WHERE f."assetId" = asset.id AND f."userId" = asset."ownerId"`
3. `DROP TABLE IF EXISTS "asset_favorite" CASCADE;`

Non-owner favorite rows are **intentionally discarded** on revert — plain Immich has nowhere to
put them. This is lossy and must be stated in the script's comments and in the switch-back guide
under `docs/docs/guides/`.

Ordering matters: the `ADD COLUMN` + backfill must run **before** the `DROP TABLE`, which sits in
a block (`revert-to-immich.sql:107-145`) that currently assumes drop-only semantics.

**`revert-to-immich.spec.ts` will _not_ catch a missing DROP line for this table — read this
before assuming it does.** The spec derives `createdTables` from what `migrations-gallery/`
actually `CREATE`s, but then narrows it (`server/src/schema/revert-to-immich.spec.ts:38`):

```ts
const forkTables = [...createdTables].filter((name) => name.startsWith('shared_space') || name.endsWith('_audit'));
```

`asset_favorite` matches **neither** predicate, so it is silently excluded from both the
drop-every-fork-table test and the step-9 guard-list test. Left as-is, this table would ship with
**zero** revert coverage — exactly the drift the file's own header comment (`:20-23`) says it was
rewritten to prevent.

Slice 0 must therefore **widen that filter** so non-`shared_space` fork tables are covered, not
merely add a DROP line under the existing one.

The genuine red available at slice 0 is the **third** test — every `migrations-gallery` migration
must appear in the step-8 `kysely_migrations` DELETE block — which our new migration files do trip.
The spec must additionally be extended to assert the column-restore steps exist and are correctly
ordered, since its current guards understand only DROP lines. CI gate:
`.github/workflows/gallery-revert-to-immich-validation.yml`.

---

## 5. Access & visibility model

### 5.1 Who may favorite

Gate on the existing **`Permission.AssetRead`**. That already resolves own assets, shared-space
assets at _any_ role including viewer, shared-album assets, and partner-shared assets. No new
authz concept is introduced.

This is a deliberate widening relative to today's `Permission.AssetUpdate`
(`utils/access.ts:155-159`), and it is the crux of #763: the reporter's family members are space
**viewers**, and viewers currently receive 403 on any asset write.

Space roles are `owner` / `editor` / `viewer` (`server/src/enum.ts:73-77`); there is no
space-level "admin". The issue's "Space Admin" is the space **owner**, and its "regular member"
is a viewer or editor. Slices must use the real role names.

**Shared-link sessions may never favorite — and this requires an explicit guard.** It does _not_
fall out for free. `server/src/dtos/auth.dto.ts:16,18` declares `user: AuthUser` as
**non-optional** and `sharedLink?: AuthSharedLink` as the optional field, so a shared-link request
carries the **link owner's** identity. Without an explicit `auth.sharedLink` rejection on the
canonical endpoint, an anonymous visitor holding a share link would create `asset_favorite` rows
**attributed to the link's owner** — an unauthenticated write in a real user's name.

The endpoint must reject any request where `auth.sharedLink` is set, and E6 must assert it.

### 5.2 Losing access

**Favorite rows are never cleaned up on access loss. Visibility is re-derived on read.**

When a user leaves a space, an album is unshared, partner sharing is revoked, or an asset is
removed from a space, the user's `asset_favorite` rows for now-unreadable assets **remain in the
table** and are filtered out by the read path's access check. Rejoining restores them.

Rationale, and why the alternative was rejected:

- **Fail-safe direction.** With re-derivation, a forgotten cleanup hook is harmless — the read
  filter still hides the asset. With hard deletion, a forgotten hook is a **privacy leak**. There
  are many revocation sites (space member removal, asset removed from space, album unshare,
  partner unshare), and the fork has prior evidence of this being fragile:
  `cleanupDepartingMemberFaces` from #752 shipped with zero test coverage.
- **Matches the documented house principle.** The header comment on
  `server/src/schema/tables/album-space-asset.table.ts` states exactly this: keep cross-owner
  state in a side table whose visibility is re-derived from live membership rather than mutated.
- **Preserves curation** across a leave/rejoin cycle.

**The cost, stated honestly:** the favorites read path must now apply an access filter. Today
`/favorites` is implicitly safe because favorites are owner-only, so no filter exists. Slice 1
adds one, and slice 1's edge cases must assert it — an unfiltered favorites query would surface
assets the user can no longer read, which is precisely the leak this design claims to prevent.

**Mechanically, the safety today comes from owner-scoping, and that is also the second blocker.**
`server/src/services/timeline.service.ts:164` sets `dto.userId = dto.userId || auth.user.id`, and
`server/src/utils/database.ts:880` applies a bare `qb.where('asset.isFavorite', '=', …)` with no
owner or space awareness of its own. So the query is restricted to assets the caller **owns**.
That is why removing the `BadRequestException` guard alone (§1.2) is **not sufficient** — the
owner-scoping would still filter every non-owned favorite out, and the slice would pass its own
tests while delivering nothing. Slice 4 must replace owner-scoping with readable-asset scoping,
not merely delete the guard.

### 5.3 Storage growth

Rows for permanently-lost access accumulate. This is accepted: the row is three columns, the
volume is bounded by user curation activity, and a periodic reaper can be added later without a
schema change. **No reaper in this design.** If one is added, it must delete only rows whose
asset is unreadable by that user _and_ has been so for a defined grace period — never on the
revocation event itself, which would reintroduce the leave/rejoin data loss.

---

### 5.4 Stacked assets — favorites are per-photo

**Decision (approved 2026-07-20): a favorite applies to the exact asset favorited, never to its
stack.** Favoriting a stack **child** favorites that child only; favoriting the **primary**
favorites the primary only. A favorited child appears in `/favorites` as a standalone asset even
though it is normally hidden behind its stack primary elsewhere in the timeline.

Rationale: it is the only option that needs no special-casing, and it follows directly from §3 —
a favorite is a fact about `(user, asset)`. The alternatives (redirect the favorite to the stack
primary; or render the stack in Favorites with the favorited child inside it) both introduce a
second notion of what a favorite attaches to, which is the ambiguity this whole design exists to
remove.

Accepted cost: a user can see a photo in Favorites that appears nowhere else in their timeline,
which can read as a bug. It is rare, and it is literally what the user asked for by favoriting
that photo. Do **not** add stack-collapsing logic to the favorites view to hide it.

Why it becomes reachable now: today only owners favorite, and owners can restack and manage their
own assets. Once space viewers can favorite, users who can neither see nor manage the stack can
reach this state.

## 6. Lifecycle & edge cases — assertion source for the slices

Every row here must have an explicit assertion in the slice named. This table is the contract;
a slice is not done while a row in it is unasserted.

| #    | Scenario                                                              | Expected                                                                                                         | Slice |
| ---- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- |
| E1   | Two users favorite the same asset                                     | Two independent rows; each sees only their own `isFavorite: true`                                                | 1, 2  |
| E2   | Owner unfavorites; member had favorited                               | Member's row untouched; member still sees `true`                                                                 | 2     |
| E3   | Space **viewer** favorites a space asset                              | 200; row created; owner's view unchanged                                                                         | 2     |
| E4   | Space **editor** attempts to set another member's favorite            | Impossible — no endpoint accepts a target user                                                                   | 2     |
| E5   | Non-member attempts to favorite a space asset                         | 403; no row created                                                                                              | 2     |
| E6   | Shared-link session attempts to favorite                              | Rejected by an **explicit** `auth.sharedLink` guard; no row created for the link owner                           | 2     |
| E7   | System admin (`hasElevatedPermission`) favorites another user's asset | Creates the **admin's own** row only; target user unaffected                                                     | 2     |
| E8   | Favorite twice (idempotency)                                          | Second call is a no-op, not a 500 (`onConflict do nothing`)                                                      | 2     |
| E9   | Unfavorite something never favorited                                  | No-op, 200, not 404                                                                                              | 2     |
| E10  | Member favorites, then leaves the space                               | Row persists; asset absent from their `/favorites` and from `isFavorite: true` filters                           | 4     |
| E11  | …then rejoins the space                                               | Asset reappears in their favorites                                                                               | 4     |
| E12  | Asset deleted                                                         | Rows CASCADE for all users                                                                                       | 0     |
| E13  | User deleted                                                          | Their rows CASCADE; other users' rows for the same assets survive                                                | 0     |
| E14  | Asset trashed then restored                                           | Favorite survives (trash never touched favorite before and must not now)                                         | 7     |
| E15  | `isFavorite: true` + `withSharedSpaces`                               | Works, returns cross-space favorites — no longer a 400                                                           | 4     |
| E16  | `isFavorite: true` + `withPartners`                                   | Works — no longer a 400                                                                                          | 4     |
| E16b | `isFavorite: **false**` + either cross-user scope                     | Also works — the guard trips on `false` too today, so both arms must be asserted                                 | 4     |
| E17  | Deprecated `UpdateAssetDto.isFavorite` from an owner                  | Writes the caller's own row; identical result to the canonical endpoint                                          | 2     |
| E18  | Deprecated alias from a space **viewer**                              | Still 403 — the alias is strictly narrower and must never widen access                                           | 2     |
| E19  | Upload with `isFavorite: true`                                        | Creates the uploader's row (uploader is always the owner)                                                        | 7     |
| E20  | Asset copy with `favorite: true`                                      | Copies the **acting user's** row only, not every user's                                                          | 7     |
| E21  | Duplicate merge                                                       | Union of all source assets' rows onto the keeper, **per user**, before sources CASCADE                           | 7     |
| E22  | Statistics `isFavorite: true`                                         | Counts only the caller's rows                                                                                    | 1     |
| E23  | Map markers `isFavorite: true`                                        | Only caller's favorites; cross-space markers now included                                                        | 4     |
| E24  | Timeline bucket parallel array                                        | `isFavorite[]` aligns 1:1 with the bucket's asset order for the caller                                           | 1     |
| E25  | Mobile sync, non-owned space asset                                    | Stream carries the **recipient's** favorite, not a masked `false`                                                | 6     |
| E26  | Mobile unfavorite while offline, then sync                            | Converges to the user's intent; no cross-user write                                                              | 6     |
| E27  | Concurrent favorite + unfavorite of the same `(user, asset)`          | Converges deterministically; no PK violation, no 500, no orphaned row                                            | 2     |
| E28  | Bulk request with an oversized `ids` array                            | Bounded — documented limit enforced with a 400, not an unbounded statement                                       | 2     |
| E29  | Album **unshared** after the user favorited an asset in it            | Same as E10: row persists, asset drops out of their favorites                                                    | 4     |
| E30  | Partner sharing **revoked** after favoriting                          | Same as E10                                                                                                      | 4     |
| E31  | Stacked assets (`/favorites` sends `withStacked: true`)               | **Per-photo** (§5.4): favoriting a stack child favorites only that asset, and it appears standalone in Favorites | 4     |
| E32  | Mobile toggle direction on a mixed-ownership selection                | Direction derives from the **same** set that is mutated (see slice 6)                                            | 6     |

---

## 7. Surfaces

Sizing from the call-site sweep. Person-favorite and mobile device-local-mirror sites are
excluded throughout.

| Surface              | Sites                                    | Nature                                                                                                           |
| -------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Server repo reads    | ~24 expressions                          | Substitute masking → EXISTS join                                                                                 |
| Server SQL snapshots | 4 files, ~21 blocks                      | Regenerate: `asset.repository.sql` (4), `search.repository.sql` (5), `sync.repository.sql` (12)                  |
| Server writes        | **5**                                    | `asset.service.ts:313,341,501`; `asset-media.service.ts:352`; `duplicate.service.ts:305`                         |
| Search / filters     | ~12                                      | Mostly boolean passthrough; real work at `search.repository.ts:655,1413-1414`, `utils/database.ts:880`           |
| Timeline             | ~7                                       | `asset.repository.ts:447,1432,1494`; `time-bucket.dto.ts:29,131`; `timeline.service.ts:180,192`                  |
| Stats                | 3                                        | `asset.repository.ts:1255,1265`; `UserUsageStatistic.svelte:54`                                                  |
| Memories             | **0**                                    | No favorite weighting exists anywhere. Confirmed.                                                                |
| Mobile sync          | 22 server expr / 12 snapshots + ~15 Dart | `sync.repository.ts`; `sync_stream.repository.dart:236,277`                                                      |
| Mobile UI            | ~35                                      | `favorite.action.dart:9-37` (note `:22` owner filter), action buttons, `drift_favorite.page.dart`, filters, map  |
| Web                  | ~85 non-test                             | `asset.service.ts:173,181,432-448`; `FavoriteAction.svelte`; `/favorites` route; ~40 filter-plumbing passthrough |
| API DTOs             | ~16 hand-written + 69 generated          | `asset-response.dto.ts:96,140,228`; `asset.dto.ts:11,82,162`; regenerate both SDKs                               |
| CLI                  | **0**                                    | Confirmed no favorite handling.                                                                                  |
| Tests                | ~42 e2e + ~90 unit                       | See §9 per slice                                                                                                 |

---

## 8. Decisions taken

Recorded so `/impl-loop` does not relitigate them.

| Decision                  | Choice                                                    | Rejected alternative & why                                                                                          |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Semantics                 | Per-user overlay for **everyone**, owner included         | Space-scoped-only overlay: two code paths for one user-visible concept, and "my favorites" would have to union both |
| `asset.isFavorite` column | Backfill, then **drop** — overlay is sole source of truth | Dual-write cache: two sources of truth that drift silently                                                          |
| Who may favorite          | Anything readable (`Permission.AssetRead`)                | Own+space only: unexplainable to users ("why can I heart this space photo but not this album photo?")               |
| Access revocation         | Keep rows, re-derive on read                              | Hard delete: every missed hook is a leak, and rejoining loses curation                                              |
| Platforms                 | Server + web + mobile atomically                          | Staged: a window where the sync stream and server disagree about what `isFavorite` means                            |
| Write API                 | Dedicated endpoint **+ deprecated alias**                 | Alias-free: breaks third-party API consumers. Guard-relaxation-only: one missed field is privilege escalation       |
| Sibling actions           | Favorite only; pattern documented (§11.1)                 | All three: archive drags in trash/visibility semantics                                                              |

### 8.1 On the deprecated alias

The alias (`UpdateAssetDto.isFavorite`, `AssetBulkUpdateDto`) is **not** a second authorization
path. It routes into the _same_ service method as the canonical endpoint, behind the _stricter_
`Permission.AssetUpdate` route guard. It is therefore structurally incapable of being more
permissive than the canonical endpoint — a second door to one room, not a second room. E18
asserts this.

Removal is out of scope; it needs a deprecation window announced to API consumers.

---

## 9. Slice overview

| #   | Slice                                                          | Layers                 | Depends on  | Self-contained?      |
| --- | -------------------------------------------------------------- | ---------------------- | ----------- | -------------------- |
| 0   | `asset_favorite` schema, migration, backfill, revert-to-immich | server medium          | —           | foundation           |
| 1   | Read path: masking → EXISTS join, + favorites access filter    | server medium + unit   | 0           | foundation           |
| 2   | Write path: canonical endpoint, deprecated alias, authz        | server e2e + unit      | 1           | ✅ (API)             |
| 3   | Drop `asset.isFavorite`; regenerate SQL snapshots              | server medium          | 1, 2, **7** | irreversible gate    |
| 4   | Cross-scope favorites: guard **and** owner-scoping removal     | server e2e + web       | 3           | ✅                   |
| 5   | Web: un-gate the heart in viewer + multi-select                | web unit + Playwright  | 2           | ✅ — **closes #763** |
| 6   | Mobile: sync stream, Drift, un-gate the action                 | server medium + mobile | 3           | ✅                   |
| 7   | Secondary writes: upload, copy, duplicate-merge, trash         | server e2e + unit      | 2           | ✅                   |

Ordering: **0 → 1 → 1b → 2 → 7 → 3 → {4, 5, 6}**. Each `/impl-loop` run does one slice, TDD.

**Correction (2026-07-20): slice 7 must precede slice 3.** The original ordering put the
secondary writes after the column drop. That is wrong and would have broken the build at the one
irreversible step. Three sites still write or read the raw column and would fail the moment it is
dropped:

- `asset-media.service.ts:352` — upload writes `isFavorite: dto.isFavorite` into the asset create
- `asset.service.ts:557` — copy writes `{ id: targetId, isFavorite: sourceAsset.isFavorite }`
- `duplicate.service.ts:308` — merge reads `assets.some((asset) => asset.isFavorite)`

The symptom was already visible before the reorder: after slice 1b made statistics read the
overlay while upload still wrote the column, `GET /assets/statistics?isFavorite` returned zero for
freshly-uploaded favorited assets — three failing e2e assertions in `asset.e2e-spec.ts`. Those
failures are the read/write asymmetry, and slice 7 closes it. **Do not run slice 3 until slice 7
is green.**

**All eight slices land as a single PR.** §8 records the decision that server, web and mobile ship
atomically, so there is no window where the sync stream and the server disagree about what
`isFavorite` means. "Self-contained" in the table above means the slice is a coherent, separately
reviewable unit whose tests pass on their own — **not** that it may be merged alone. In
particular, shipping slice 5 by itself would un-gate the web heart against a server that still
owner-scopes favorites (§5.2), and shipping 0–5 without 6 would leave mobile reading a column that
slice 3 deleted.

**Why slice 3 (the drop) sits mid-sequence, not last.** Slices 0–2 leave the column present but
unread and unwritten — a dead column. Deferring the drop past 4–7 would mean every later slice
must reason about whether the dead column matters, and would leave a long window where a
rebase-imported upstream query could silently start reading stale data with no test failing.
Dropping it as soon as nothing depends on it converts that silent-staleness risk into a loud
compile/query error. Slice 3 is the point of no return; 0–2 are reversible.

---

## Slice 0 — Schema foundation: `asset_favorite`

**Delivers.** The storage substrate, its cascade guarantees, the backfill, and a correct revert
path. No user-facing behavior (the one non-vertical slice besides 1); fully covered by medium
tests against the live schema.

**Behavior (BDD)**

- _Given_ a user and an asset, _When_ an `asset_favorite` row is inserted, _Then_ it persists and
  is readable by `(userId, assetId)`.
- _Given_ two users and one asset, _When_ both insert rows, _Then_ both persist independently.
- _Given_ an `asset_favorite` row, _When_ its **asset** is deleted, _Then_ the row is
  cascade-deleted; _When_ its **user** is deleted, _Then_ the row is cascade-deleted and other
  users' rows for that asset survive.
- _Given_ a database with `asset."isFavorite" = true` rows, _When_ the migration runs, _Then_ each
  produces exactly one `asset_favorite` row keyed to that asset's **owner**.
- _Given_ the revert script runs, _When_ it completes, _Then_ `asset."isFavorite"` exists again and
  is `true` exactly for assets the **owner** had favorited.

**TDD — red first**

- **Medium** (`server/test/medium/specs/…`): create the table via migration on the testcontainers
  DB; assert insert/read, composite-PK uniqueness, and each FK cascade. Red because the table
  does not exist.
- **Migration test**: seed `asset` rows with `isFavorite` true/false across two owners, run the
  migration, assert the backfilled row set exactly.
- **Unit** (`server/src/schema/revert-to-immich.spec.ts`): the available red is the **step-8
  `kysely_migrations` DELETE block** test, which the new `migrations-gallery` migration trips
  immediately. The drop-every-fork-table test will **not** go red — `asset_favorite` is filtered
  out at `:38` (§4.2) — so this slice must first **widen that filter** to cover non-`shared_space`
  fork tables, which makes the DROP-line test go red, and only then add the DROP line. Extend the
  spec to assert the `ADD COLUMN` + backfill + `DROP TABLE` steps exist **and are correctly
  ordered**; its current guards understand only DROP lines.
- **Medium (audit-table decision, §4)**: assert a client can reconcile favorite **deletes** from
  the user's own full row set with no tombstone stream. If this cannot be satisfied,
  `asset_favorite_audit` is created **in this slice** — never later, since slice 3 is irreversible.

**Fix (green).**

- `server/src/schema/tables/asset-favorite.table.ts` per §4.
- Migration in `migrations-gallery/` with a round timestamp: create + backfill. **Does not drop
  the column** — that is slice 3.
- `scripts/revert-to-immich.sql`: the three ordered steps from §4.2, with a comment stating the
  non-owner-row loss, **plus** `asset_favorite` in the step-9 `fork_tables_left` guard list and
  the new migration name in the step-8 DELETE block.
- `revert-to-immich.spec.ts:38` — widen the `forkTables` filter so fork tables outside the
  `shared_space*` / `*_audit` naming conventions are covered.
- Register the repository in `test/medium.factory.ts`'s `newRealRepository` switch, and in
  `BaseService` at **all three sites** — import, constructor, and the `static create()` positional
  list. Missing the third shifts every later repository and fails only in medium tests.
- Document the lossy revert in the switch-back guide under `docs/docs/guides/`.

**Edge cases (explicit assertions)**

- Duplicate `(userId, assetId)` insert → PK conflict handled, not a 500. (E8 substrate)
- Asset delete cascades for **all** users, not just the owner. (E12)
- User delete leaves other users' rows for the same asset intact. (E13)
- Migration is idempotent-safe on a DB with zero favorites (empty backfill, no error).
- Migration applies cleanly on a DB that already has every #752 migration (unordered path).
- Revert on a DB with **only** non-owner favorites → column added, all `false`, no crash.

**Green.** Medium schema suite green; `revert-to-immich.spec.ts` green; revert-to-immich CI
workflow green; `make sql` diff limited to the new table; server `check` clean.

---

## Slice 1 — Read path: masking → overlay join

**Delivers.** Every read of "is this favorited" resolves against `asset_favorite` for the
requesting user, and the favorites read path gains the access filter §5.2 requires.

**This slice is _not_ a pure refactor, despite mostly looking like one.** The substitution of
masking expressions for overlay joins is behaviour-preserving — the backfill guarantees owner
parity, and that parity is the regression suite. But adding the readable-asset filter is a real
behaviour change (E10), and it is the one part of this slice that can leak if it is wrong. Treat
the substitution as refactor-with-parity-tests and the access filter as new behaviour with its own
red-first test.

**Behavior (BDD)**

- _Given_ a user who favorited an asset, _When_ they fetch it, _Then_ `isFavorite: true`.
- _Given_ user A favorited an asset and user B did not, _When_ B fetches it, _Then_
  `isFavorite: false` — regardless of who owns it. (E1)
- _Given_ a user favorited a space asset and then lost access, _When_ they list favorites,
  _Then_ the asset is absent, _And_ the row still exists in the table. (E10)
- _Given_ a timeline bucket request, _When_ it returns, _Then_ `isFavorite[]` aligns 1:1 with the
  bucket's asset order for the caller. (E24)
- _Given_ `getAssetStatistics({ isFavorite: true })`, _When_ it runs, _Then_ it counts only the
  caller's rows. (E22)

**TDD — red first**

- **Medium**: seed two users favoriting overlapping assets via `asset_favorite` directly; assert
  each read surface returns the correct per-user value. Red because reads still consult the
  column, which the direct inserts never set.
- **Unit** (`asset-response.dto` mapper): assert the mapper reads the joined value, not
  `ownerId` equality.
- **Medium (the leak test)**: favorite a space asset, revoke space membership, assert the asset
  is absent from the favorites listing **and** the row is still present. Red because no access
  filter exists today.

**Fix (green).** Substitute at each site:

- `dtos/asset-response.dto.ts:228` — read the joined value.
- `repositories/asset.repository.ts:1432` (masked select), `:1494` (`array_agg`), `:447`
  (`withTimeBucketAssetFilters` WHERE), `:1061` (`getForCopy`), `:1265` (`getStatistics`).
- `search.repository.ts:655,1413-1414`, `:324,359,377,397,507`; `utils/database.ts:880`
  (drives 4 snapshots **and** `shared-space.repository.ts:1534`); `map.repository.ts:21,95,109`.
- `database.ts:249,451,454,509,582` column-list constants — note `:582` already comments
  "syncAsset minus isFavorite".
- Add the readable-asset filter to the favorites read path per §5.2.
- Leave `sync.repository.ts` for slice 6 and writes for slice 2; the column stays present.

**Edge cases**

- Asset the user cannot read at all → never appears, even with a row. (E10)
- Owner's own favorites unchanged vs. pre-migration (parity regression suite).
- Bucket `isFavorite[]` alignment holds when the caller favorited a strict subset. (E24)
- Empty favorites → empty result, not an error.
- `isFavorite: false` filter means "not favorited **by me**", including assets others favorited.
- Statistics never count another user's rows. (E22)

**Green.** Medium + unit suites green; existing e2e still green (owner parity); server `check`
and `prettier --check` clean on all modified files.

---

## Slice 2 — Write path: canonical endpoint + deprecated alias

**Delivers.** The #763 capability at the API layer: any user who can read an asset can favorite
it for themselves, and no user can alter anyone else's favorite.

**Behavior (BDD)** — space S; Alice owns asset X in S; Bob is a **viewer** of S; Carol is a non-member.

- _Given_ Bob, _When_ he `PUT /assets/favorites {ids:[X], isFavorite:true}`, _Then_ 200, _And_ Bob
  sees `isFavorite: true`, _And_ Alice's view of X is unchanged. (E3)
- _Given_ Alice had favorited X, _When_ she unfavorites it, _Then_ Bob still sees `true`. (E2)
- _Given_ Carol, _When_ she calls the endpoint for X, _Then_ 403 and no row. (E5)
- _Given_ a shared-link session, _When_ it calls the endpoint, _Then_ rejected, no row. (E6)
- _Given_ an admin with elevated permission, _When_ they favorite X, _Then_ only the **admin's**
  row is created. (E7)
- _Given_ Alice, _When_ she uses the deprecated `PUT /assets/:id {isFavorite:true}`, _Then_
  identical result to the canonical endpoint. (E17)
- _Given_ Bob (viewer), _When_ he uses the deprecated alias, _Then_ **still 403** — the alias never
  widens access. (E18)

**TDD — red first**

- **E2E** (`e2e/src/specs/server/api/asset.e2e-spec.ts` + a new favorites spec): the full matrix
  above. Red because the endpoint does not exist and viewers currently 403 on any asset write.
- **Unit** (`asset.service.spec.ts`): the service method writes/deletes rows for
  `auth.user.id` only, and accepts no caller-supplied target user.
- **Invert the bug-encoding test.** `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts:705`
  currently asserts an editor can bulk-favorite another member's asset. Rewrite it to assert the
  editor's write creates the **editor's own** row and leaves the owner's state untouched. This
  inversion is a required deliverable, not incidental churn.

**Fix (green).**

- Canonical route `PUT /assets/favorites` `{ ids: string[], isFavorite: boolean }`, guarded by
  `Permission.AssetRead`.
- Service method: `onConflict do nothing` insert / delete-by-key, scoped to `auth.user.id`.
- Wire `UpdateAssetDto.isFavorite` and `AssetBulkUpdateDto` (`asset.service.ts:313,341`) into the
  same method; remove `isFavorite` from the `_.omitBy` column write at `:341`.
- Mark the DTO field `@deprecated` with a pointer to the canonical route.
- Regenerate OpenAPI spec + **both** SDKs (`make open-api` — TS-only regeneration leaves the Dart
  client stale and fails CI).

**Edge cases**

- Idempotent favorite / no-op unfavorite. (E8, E9)
- Bulk request mixing readable and unreadable ids → per-id outcome, no partial-success lie
  (mirrors the #764 toast lesson).
- Empty `ids` → 400 or clean no-op, explicitly asserted either way.
- Oversized `ids` array → bounded by a documented limit, rejected with 400 rather than issuing an
  unbounded statement. (E28)
- Concurrent favorite + unfavorite of the same `(user, asset)` → converges deterministically; the
  `onConflict do nothing` insert and the delete-by-key must not race into a 500 or an orphan. (E27)
- Nonexistent asset id → 400/404, never a 500.
- No request shape permits naming another user as the favorite subject. (E4)
- Elevated permission does not widen the subject. (E7)
- A request carrying `auth.sharedLink` is rejected before any row is written. (E6, §5.1)

**Green.** New + inverted e2e green; `asset.service.spec.ts` green; SDKs regenerated and
committed; server `check` + `prettier --check` clean.

---

## Slice 3 — Drop `asset.isFavorite`

**Delivers.** Single source of truth. The point of no return.

**Behavior (BDD)**

- _Given_ a user who had favorited assets before the column was dropped, _When_ they fetch those
  assets, list `/favorites`, request a timeline bucket, and read their favorite statistic, _Then_
  every result is byte-identical to the pre-drop response.
- _Given_ a second user who favorited a subset of the same assets, _When_ both users read, _Then_
  each still sees only their own favorites — the drop changes storage, never semantics.
- _Given_ the column is gone, _When_ the server boots and runs its migrations, _Then_ startup
  succeeds and no query references the removed column.

**TDD — red first**

- **Grep gate** (a real assertion, not a manual step): a unit test asserting zero references to
  `asset."isFavorite"` / `asset.isFavorite` remain in `server/src/`, excluding the migration
  history and person favorites. Red until every site is converted.
- **Medium**: full favorite suite from slices 1–2 re-run against the post-drop schema.

**Fix (green).**

- Migration in `migrations-gallery/`: `ALTER TABLE asset DROP COLUMN "isFavorite"`.
- Remove the field from `asset.table.ts:93-94`.
- Regenerate the 4 SQL snapshot files (~21 blocks) against a scratch migrated DB.
  **Never run `make sql` without a running DB — it deletes all query files.**

**Edge cases**

- Snapshot regeneration diff contains **only** favorite-related changes — a wider diff means a
  stale or wrong DB.
- `sync.repository.sql` blocks still compile with the column gone (slice 6 changes semantics; this
  slice must not break the build in between).
- Drop migration applies on a DB where the slice-0 backfill already ran.
- Revert-to-immich still round-trips post-drop (re-run slice 0's revert assertions).

**Green.** Grep gate green; all prior favorite suites green; `make sql` diff scoped;
revert-to-immich CI green.

---

## Slice 4 — Cross-scope favorites

**Delivers.** Favorites that compose with spaces and partners — the behavioral payoff of the
whole design.

**Behavior (BDD)**

- _Given_ a user with favorites across their own library and two spaces, _When_ they request
  `isFavorite: true` with `withSharedSpaces: true`, _Then_ 200 with the union — not a 400, **and
  the non-owned favorites are actually present in the result**. (E15)
- _Given_ the same with `withPartners: true`, _Then_ 200 with partner-owned favorites present. (E16)
- _Given_ `isFavorite: false` with either cross-user scope, _Then_ 200 — the current guard trips on
  `false` as well as `true`, so both arms change. (E16b)
- _Given_ a user who favorited a space asset then left, _When_ they list favorites, _Then_ absent;
  _When_ they rejoin, _Then_ present again. (E10, E11)
- _Given_ an album is unshared, or partner sharing revoked, after favoriting, _Then_ the same
  drop-out behaviour as leaving a space. (E29, E30)
- _Given_ map markers filtered by favorite, _When_ requested, _Then_ cross-space markers included. (E23)

**TDD — red first**

- **E2E**: the combinations above. Two distinct reds, and the second is the one that matters —
  first the 400 from the guard, then, once the guard is gone, an **empty/short result** because
  the query is still owner-scoped. A test that only asserts "not a 400" would pass against a
  feature that returns nothing; every scenario must assert the non-owned favorite is **in** the
  payload.
- **Unit** (`timeline.service.spec.ts`): the 5 existing tests asserting the rejection must be
  **inverted** — they currently encode the limitation.
- **Web unit**: filter-options specs asserting favorites no longer suppress `withSharedSpaces`.

**Fix (green).** Two independent blockers — removing only the first yields a green-but-inert slice:

1. Delete the `BadRequestException` guards in `timeline.service.ts` (the `isFavorite` checks are
   at `:180,192`; the `throw`s at `:183-185,195-197`). Both trip on `isFavorite: false` too.
2. **Replace owner-scoping with readable-asset scoping** (§5.2). `timeline.service.ts:164` sets
   `dto.userId = dto.userId || auth.user.id`, and `utils/database.ts:880` applies a bare
   `qb.where('asset.isFavorite', '=', …)`. Together these restrict results to assets the caller
   **owns**, which would filter out every cross-space favorite even with the guard gone.

- Remove the ~12 web mirrors (`withSharedSpaces: filters.isFavorite === undefined`), heaviest in
  `routes/(user)/photos/[[assetId=id]]/+page.svelte`.
- Remove the space-resolution skip at `shared-space.service.ts:1040` and the `map.service.ts:21,26`
  equivalent.

**Edge cases**

- Favorites + space + partner **simultaneously**.
- Favorite in a space with `showInTimeline: false` → respects the existing timeline preference.
- Favorited asset in a space the user owns _and_ one they're a viewer of → appears once, not twice.
- Trashed favorited asset stays out of the favorites timeline.
- `/favorites` route unchanged for a user with no spaces (regression).
- Album unshare (E29) and partner revoke (E30) drop favorites out, exactly as leaving a space does.
- **Stacks**: `/favorites` sends `withStacked: true`. Favoriting a stack **child** vs. the
  **primary** must have one defined behaviour — pick it, state it, assert it. Today the question
  cannot arise because only owners favorite; it becomes reachable here. (E31)
- **Performance**: `utils/database.ts:880` goes from a bare indexed column predicate to a join, at
  the same time as the result set widens across spaces. Assert the §10 budget on a seeded
  many-spaces dataset — this is the shape of regression that produced the People-page incident.

**Green.** E2E green; inverted `timeline.service.spec.ts` green; web unit green; web
`check:typescript` + `check:svelte` + `pnpm lint` clean.

---

## Slice 5 — Web: un-gate the heart — closes #763

**Delivers.** The literal user-visible fix from the issue: a space viewer opens a photo they
don't own and the heart is there.

**Behavior (BDD)**

- _Given_ Bob is a space **viewer** viewing Alice's photo, _When_ he opens the action menu,
  _Then_ Favorite is present, _And_ pressing `f` toggles it.
- _Given_ Bob favorited it, _When_ he reopens the menu, _Then_ **Unfavorite** is shown.
- _Given_ Bob multi-selects photos including ones he doesn't own, _When_ the action bar renders,
  _Then_ the heart is present and applies to the **whole** selection.
- _Given_ a shared-link viewer, _When_ the menu renders, _Then_ **no** favorite action.

**TDD — red first**

- **Web unit** (`web/src/lib/services/asset.service.spec.ts`): assert the Favorite/Unfavorite
  `$if` no longer consults `isOwner`. Red because of `asset.service.ts:170-184`.
- **Web unit** (`asset-multi-select-manager.svelte.spec.ts`, `selection-command-handlers.spec.ts`):
  assert the favorite command targets **all** selected assets, not `ownedAssets`.
- **Playwright**: a space viewer favorites a non-owned photo and the heart persists across reload.

**Fix (green).**

- Drop `isOwner` from the two `$if` gates (`asset.service.ts:173,181`); keep it for genuinely
  owner-only actions (delete, archive, edit, stack, visibility).
- `FavoriteAction.svelte:30` — target the full selection, not
  `assetMultiSelectManager.ownedAssets`.
- `asset-multi-select-manager.svelte.ts:23-25,30-31` — stop using `isAllUserOwned` to gate favorite.
- Un-gate the space-page heart (`spaces/[spaceId]/…/+page.svelte:883-888` and the
  people variant `:720-725`).
- Point web writes at the canonical endpoint (`asset.service.ts:432-448`).
- Update `docs/plans/shared-spaces-permission-matrix.md:70` (Favorite row → Yes/Yes/Yes) and amend
  known-gap 4 at `:178` to cover only archive/edit/rating.

**Edge cases**

- Owner's experience unchanged (regression).
- Shared-link viewer: no action, and the `f` shortcut is inert.
- Mixed selection (owned + non-owned) → single toggle applies to all.
- Toggling from the space **people** page as well as the space timeline.
- Optimistic UI reverts correctly on server error.
- Heart badge reflects the **viewer's** state on a non-owned thumbnail.

**Green.** Web unit + Playwright green; `check:typescript` + `check:svelte` + `pnpm lint` clean
from `web/`. **#763 is closable at the end of this slice.**

---

## Slice 6 — Mobile: sync, Drift, un-gate

**Delivers.** Mobile parity — the recipient's own favorite flows through the sync stream and the
mobile heart works on non-owned space assets.

**Behavior (BDD)**

- _Given_ Bob favorited Alice's space asset, _When_ his device syncs, _Then_ the local row carries
  `isFavorite: true` — not the masked `false` the stream sends today. (E25)
- _Given_ Bob unfavorites on mobile, _When_ it syncs, _Then_ his row is removed and Alice is
  unaffected.
- _Given_ Bob toggles offline, _When_ connectivity returns, _Then_ state converges with no
  cross-user write. (E26)
- _Given_ a non-owned asset, _When_ Bob opens the viewer, _Then_ the heart is present and enabled.

**TDD — red first**

- **Medium** (server): assert each sync stream emits the **recipient's** favorite. Red because of
  the `CASE WHEN ownerId = $1` masking and the partner hardcoded `false`.
- **Flutter** (`flutter test`): `favorite.action.dart` no longer filters on
  `asset.ownerId == scope.authUser.id` (`:22`); the repository writes via the canonical endpoint.
- **Flutter (toggle-direction bug, E32)**: with a mixed-ownership selection, assert the toggle
  direction matches the set actually mutated. Red today — `favorite.action.dart:11` computes
  `shouldFavorite = assets.any((asset) => !asset.isFavorite)` over the **unfiltered** selection
  while `:22` filters to owned assets, so a non-owned asset can already flip the direction while
  being excluded from the mutation. Latent today; load-bearing once `:22` is un-gated.

**Fix (green).**

- Convert the 22 `sync.repository.ts` expressions to overlay joins: album (`:240,260,283`), shared
  space (`:998,1029,1059`), library (`:1310,1347`), shared-space album
  (`:1827,1852,1886,1909,1941,1965`), partner (`:661,681` — drop the hardcoded `false`), own
  (`:478`). Update the explanatory comments at `:985,1017,1048,1298,1337,1810`, which currently
  document the masking rationale.
- Regenerate the 12 `sync.repository.sql` snapshot blocks.
- Re-confirm the §4 no-audit-table decision against the real stream (the decision itself, and any
  `asset_favorite_audit` table, belongs to **slice 0** — it must not be introduced here, after the
  irreversible slice 3).
- Dart: `favorite.action.dart:11` — derive `shouldFavorite` from the same filtered set that gets
  mutated, not the raw selection (E32); `:22` un-gate; `remote_asset.repository.dart:119-124` and
  `asset_api.repository.dart:45-46` to the canonical endpoint; verify
  `timeline.repository.dart` favorite queries and `merged_asset.drift`.
- Leave `local_asset` / `trashed_local_asset` favorite mirrors alone — device-local backup state.

**Edge cases**

- Partner assets now carry real favorites — confirm no regression of the
  `1777897107000-PartnerAssetSyncReset` leak (that reset existed because favorites _should not_
  have crossed; now they legitimately do, for the recipient's own rows only).
- Full resync from empty produces the same state as incremental.
- Two devices, same user → converge.
- Asset leaves a space → local row removal on next sync.
- Local-only asset (not yet uploaded) favorite still works.

**Green.** Server medium + regenerated snapshots green; `dart analyze --fatal-infos lib test`
**and** `dart format --set-exit-if-changed` clean (CI runs both; local `flutter analyze lib`
misses test lints); `flutter test` green on Flutter 3.41.7.

---

## Slice 7 — Secondary write paths

**Delivers.** Upload, copy, duplicate-merge and trash behave correctly under per-user favorites.

**Behavior (BDD)**

- _Given_ an upload with `isFavorite: true`, _When_ it completes, _Then_ the **uploader's** row
  exists. (E19)
- _Given_ an asset copy with `favorite: true`, _When_ it completes, _Then_ the **acting user's**
  row is copied — not every user's. (E20)
- _Given_ a duplicate merge where two users favorited different source assets, _When_ it
  completes, _Then_ the keeper carries **both** users' rows. (E21)
- _Given_ a favorited asset is trashed then restored, _Then_ the favorite survives. (E14)

**TDD — red first**

- **E2E** (`asset-copy.e2e-spec.ts:164-203`, `duplicate.e2e-spec.ts`): red because these still
  assert global-column semantics.
- **Unit** (`asset.service.spec.ts`, `duplicate.service.spec.ts`, `asset-media.service.spec.ts`).

**Fix (green).**

- `asset-media.service.ts:352` — write the uploader's overlay row instead of the create column.
- `asset.service.ts:501` — copy the acting user's row; keep `dto.favorite` default `true`
  (`asset.dto.ts:162`).
- `duplicate.service.ts:305` — replace the boolean OR with a per-user union of source rows onto the
  keeper, **before** the sources are deleted and CASCADE removes them.
- Confirm trash/restore still never touches favorites (currently zero hits in `trash.service.ts` /
  `trash.repository.ts` — assert this stays true).

**Edge cases**

- Merge where **no** source was favorited → no rows created.
- Merge where the same user favorited multiple sources → exactly one keeper row (dedup). (E8)
- Copy by a non-owner who can read the source.
- Upload with `isFavorite: false` → no row.
- Merge sources with favorites from a user who has since lost access → row still transfers
  (visibility is a read-time concern, per §5.2).

**Green.** E2E + unit green; server `check` + `prettier --check` clean.

---

## 10. Global acceptance criteria

1. Every row of §6 has a passing assertion in its named slice.
2. `Permission.AssetRead` is sufficient to favorite; `Permission.AssetUpdate` is not required.
3. No code path lets any actor write another user's favorite. Asserted, not assumed. (E4, E7)
4. No response, bucket, sync stream, statistic or map marker exposes another user's favorite.
5. `asset."isFavorite"` does not exist post-slice-3; the grep gate enforces it.
6. `revert-to-immich.sql` restores the column with owner rows and passes its CI workflow, **and**
   `asset_favorite` is actually covered by `revert-to-immich.spec.ts` (its filter widened — §4.2).
7. `AssetResponseDto` shape is unchanged; both SDKs regenerated via `make open-api`.
8. **A shared-link request can never write a favorite row.** Explicitly guarded, explicitly
   asserted. (§5.1, E6)
9. **Cross-scope favorites actually return non-owned assets** — not merely "no longer a 400".
   Owner-scoping replaced by readable-asset scoping. (§5.2, slice 4)
10. **Performance budget**: on a seeded dataset with a user in ≥10 spaces and ≥10k favorites,
    `/favorites` first-page latency stays within the pre-change budget. Record the measurement in
    the PR. The People-page incident came from exactly this shape of change.
11. Full local gate green: `make lint-all`, `make check-all`, server + web unit, server medium,
    e2e API + web, `dart analyze --fatal-infos lib test`, `dart format --set-exit-if-changed`,
    `flutter test`.
12. `docs/plans/shared-spaces-permission-matrix.md` updated at both `:70` and `:178`.
13. #763 verified manually on a real space with a **viewer**-role member.
14. All eight slices land as **one PR** (§8, §9).

**Verification discipline:** run the full gate yourself at the end. Subagent "green" reports have
repeatedly missed what integrated CI catches. `pnpm test -- --run <path>` silently drops the path
filter; `make check-server` does not exist. `prettier --check` and eslint are separate CI gates —
eslint green does not imply prettier green.

---

## 11. Out of scope

- **Archive** (`visibility`) and **rating** (`asset_exif.rating`) — same owner-gated global-state
  problem, same known-gap line. Deferred (§11.1).
- Removing the deprecated `UpdateAssetDto.isFavorite` alias — needs a consumer deprecation window.
- A reaper for favorite rows on permanently-lost access (§5.3).
- `person.isFavorite` — separate feature, untouched.
- Favorite-ordering UI, despite `createdAt` being carried.
- Shared/collaborative "space favorites".
- Favorite counts or activity notifications.

### 11.1 The reusable pattern

For a future archive/rating slice, the pattern this design establishes:

1. Overlay table `(userId, entityId)` with composite PK, both FKs `CASCADE`, modelled on
   `shared_space_person_alias`.
2. Backfill the existing global column to the **owner's** rows; drop the column once nothing
   reads it.
3. Replace ownership-masking expressions with overlay joins — in this codebase the masking
   already exists, so this is substitution rather than new plumbing.
4. Gate writes on `Permission.AssetRead` via a dedicated endpoint; keep the old DTO field as a
   strictly-narrower deprecated alias into the same service method.
5. Never clean up rows on access loss; re-derive visibility on read.
6. Remove any `X × cross-user-scope` rejection guard the global column forced into existence.

Archive carries one extra hazard favorite does not: `visibility` is an enum entangled with trash
and the sync streams, so it cannot be modelled as row-presence/absence the way a boolean can.
