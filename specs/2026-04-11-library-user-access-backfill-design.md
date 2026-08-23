# Library Access Backfill via `library_user` Table — Design

## Problem

When a user gains access to a pre-existing library via a shared-space link — either by joining a space that already has libraries linked, by having a library newly linked to a space they're already in, or by rejoining a space after previously leaving — the server fails to stream:

1. The library metadata row (`LibraryV1`)
2. The library's assets (`LibraryAssetBackfillV1`)

The link row (`SharedSpaceLibraryV1`) is delivered correctly via the per-link backfill loop in `syncSharedSpaceLibrariesV1`, but the library itself and its 40k+ assets are not, leaving the client's space detail view blank for any library-backed space the user wasn't a member of at their initial sync.

### Root cause

- `LibrarySync.getCreatedAfter` keys off `library.createId`. Pre-existing libraries have old createIds < the user's backfill checkpoint → they're not returned → per-library asset backfill never runs for them.
- `LibrarySync.getUpserts` keys off `library.updateId > checkpoint`. The library row's updateId is also old → not returned.
- `LibraryAssetSync.getUpserts` keys off `asset.updateId > checkpoint`. The assets haven't changed → not returned.
- The existing comment on `LibrarySync.getCreatedAfter` acknowledges the gap: "SharedSpaceLibrarySync's per-link backfill loop in sync.service.ts handles that case" — but looking at `syncSharedSpaceLibrariesV1`, it only streams link rows, never recursing into library metadata or asset backfill. The intended handling was never implemented.

### Scenarios that fail

1. **User re-added to a space after leaving** (observed live in testing). Mobile's `deleteLibrariesV1` handler swept the orphan library assets from `remote_asset_entity` when the leave-side `LibraryDeleteV1` events arrived. After re-add, server delivers nothing library-related → user's local DB stays empty.
2. **First-time invite to a space with pre-existing libraries.** User's initial sync happened before they were a member, so their `LibraryAssetBackfillV1` checkpoint is at HEAD. New member row arrives via `SharedSpaceMemberV1`, but no library flow.
3. **Library newly linked to a space the user is already in.** New `shared_space_library` row arrives via `SharedSpaceLibraryV1`, but the referenced library and its assets are stale on the server side.

All three are the same underlying bug: there is no per-user "access was granted to library X" signal that drives the sync backfill.

## Solution

Introduce a new denormalization table `library_user` that mirrors the existing patterns used by `shared_space_member`, `album_user`, and `partner` — one row per (userId, libraryId) access grant, with its own `createId`.

The fork already has a companion `library_audit` table (from migration `1778200000000-LibraryAuditTables.ts`) plus a `user_has_library_path()` helper and trigger fan-out logic for the **delete side** of per-user library access tracking. This design adds the symmetric **create side** that was never implemented.

After the fix:

- `LibrarySync.getCreatedAfter` queries `library_user` instead of `library`, returning rows keyed by the per-user access-grant createId. Each access grant is a unique row with a unique createId, so the existing per-entity backfill loop in `syncLibraryAssetsV1` / `syncLibraryAssetExifsV1` works unchanged.
- Insert triggers on `library`, `shared_space_member`, and `shared_space_library` populate `library_user` atomically with the event that grants access. Each trigger also bumps `library.updateId` so `LibrarySync.getUpserts` delivers the library metadata row on the newly-accessing user's next sync — mirroring the existing `album_user_after_insert` and `shared_space_member_after_insert` patterns.
- An `AFTER INSERT` trigger on `library_audit` deletes the corresponding `library_user` row whenever the existing delete trigger chain determines the user has lost all paths to the library. This keeps all the "user lost access" policy in one place (the existing trigger fan-out) and makes the create-side table a simple consumer of it.

No changes to any sync service method. No new sync entity types. No mobile changes.

## Schema

New table `library_user`:

```sql
CREATE TABLE "library_user" (
  "userId"    uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "libraryId" uuid NOT NULL REFERENCES "library"(id) ON DELETE CASCADE,
  "createId"  uuid NOT NULL DEFAULT immich_uuid_v7(),
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "libraryId")
);

-- Hot-path index: LibrarySync.getCreatedAfter filters by userId then
-- createId, so a composite leading with userId lets the planner seek
-- directly to the user's slice and walk sorted. PK (userId, libraryId)
-- doesn't serve this query because it's ordered on the wrong column.
CREATE INDEX "library_user_userId_createId_idx" ON "library_user" ("userId", "createId");
```

The `library_user_delete_after_audit` consumer trigger joins on `(userId, libraryId)` which is served by the primary key — no extra index needed for that path. A standalone `libraryId` index was considered for "which users have access to library X" admin queries but has no concrete caller, so it's dropped per YAGNI. Easy to add later if such a query shows up.

- `(userId, libraryId)` primary key prevents duplicates when the same user gains access via multiple paths.
- `createId` (uuid_v7) is the per-user access-grant timestamp. Unique per row, monotonic, drives the backfill loop.
- `createdAt` is informational, mirrors other per-user tables.
- **No `updateId` or `updatedAt`** — `library_user` rows are write-once: they're inserted via the create-side triggers, deleted via the `library_audit` consumer trigger, and never UPDATEd. Adding per-user library metadata (e.g. "hide this library from my timeline") is a future feature that can add the column at that point via a simple ALTER.
- FK cascades ensure library_user is cleaned up when users or libraries are hard-deleted.

Migration file: `server/src/schema/migrations-gallery/<ts>-AddLibraryUserTable.ts`.

## Triggers

### Create-side (three new triggers)

**1. `library_after_insert`** — when a library is created, insert the owner's library_user row. The insert explicitly propagates `library.createId` and `library.createdAt` instead of letting the column defaults generate fresh values. This preserves the invariant (established in the migration's Pass 1) that **owner-path rows always share the library's own createId**, which matters because existing clients' sync checkpoints are already past `library.createId` and we don't want a new-library insert to appear "fresh" enough to retrigger an already-completed backfill on reconnection. Post-migration and post-insert the rule is the same: owner rows copy from the library row.

```sql
CREATE OR REPLACE FUNCTION library_after_insert()
RETURNS TRIGGER LANGUAGE PLPGSQL AS $$
BEGIN
  INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
  SELECT "ownerId", "id", "createId", "createdAt"
  FROM inserted_rows
  WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;

CREATE TRIGGER "library_after_insert"
AFTER INSERT ON "library"
REFERENCING NEW TABLE AS "inserted_rows"
FOR EACH STATEMENT
EXECUTE FUNCTION library_after_insert();
```

No `library.updateId` bump needed here — the library was just created so its updateId is already fresh.

**2. `shared_space_member_after_insert_library`** — when a user joins a space, grant access to every library currently linked to that space. Also bump the library.updateId of each affected library so `LibrarySync.getUpserts` delivers the library row on the new member's next sync (mirrors `shared_space_member_after_insert`'s `shared_space.updateId` bump).

```sql
CREATE OR REPLACE FUNCTION shared_space_member_after_insert_library()
RETURNS TRIGGER LANGUAGE PLPGSQL AS $$
BEGIN
  -- Grant per-user library access
  INSERT INTO library_user ("userId", "libraryId")
  SELECT DISTINCT ir."userId", ssl."libraryId"
  FROM inserted_rows ir
  INNER JOIN shared_space_library ssl ON ssl."spaceId" = ir."spaceId"
  ON CONFLICT DO NOTHING;

  -- Bump updateId on affected libraries so the upsert stream redelivers metadata
  UPDATE library
  SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
  WHERE "id" IN (
    SELECT DISTINCT ssl."libraryId"
    FROM inserted_rows ir
    INNER JOIN shared_space_library ssl ON ssl."spaceId" = ir."spaceId"
  );
  RETURN NULL;
END
$$;

CREATE TRIGGER "shared_space_member_after_insert_library"
AFTER INSERT ON "shared_space_member"
REFERENCING NEW TABLE AS "inserted_rows"
FOR EACH STATEMENT
EXECUTE FUNCTION shared_space_member_after_insert_library();
```

The trigger name is suffixed with `_library` so it sorts alphabetically AFTER the existing `shared_space_member_after_insert` trigger — Postgres fires AFTER triggers in name order and the existing `shared_space.updateId` bump should run first for stable ordering in test assertions. Both triggers are idempotent so the order is not functionally required.

**3. `shared_space_library_after_insert_user`** — when a library is linked to a space, grant access to every current member of that space and bump the library's updateId.

```sql
CREATE OR REPLACE FUNCTION shared_space_library_after_insert_user()
RETURNS TRIGGER LANGUAGE PLPGSQL AS $$
BEGIN
  INSERT INTO library_user ("userId", "libraryId")
  SELECT DISTINCT ssm."userId", ir."libraryId"
  FROM inserted_rows ir
  INNER JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
  ON CONFLICT DO NOTHING;

  UPDATE library
  SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
  WHERE "id" IN (SELECT DISTINCT "libraryId" FROM inserted_rows);
  RETURN NULL;
END
$$;

CREATE TRIGGER "shared_space_library_after_insert_user"
AFTER INSERT ON "shared_space_library"
REFERENCING NEW TABLE AS "inserted_rows"
FOR EACH STATEMENT
EXECUTE FUNCTION shared_space_library_after_insert_user();
```

### Delete-side (one new trigger)

**4. `library_user_delete_after_audit`** — when a row is inserted into `library_audit`, delete the corresponding `library_user` row. The existing delete trigger chain (`shared_space_delete_library_audit`, `shared_space_library_delete_audit`, `shared_space_member_delete_library_audit`) already encodes the "user has lost all paths" policy via `user_has_library_path()` — we consume its output unconditionally.

```sql
CREATE OR REPLACE FUNCTION library_user_delete_after_audit()
RETURNS TRIGGER LANGUAGE PLPGSQL AS $$
BEGIN
  -- Trusts the gating at library_audit insertion time: every existing path
  -- that inserts into library_audit already gates on
  -- `NOT user_has_library_path(..., excludeSpaceId)`, so an audit row means
  -- "this (user, library) pair has definitively lost access". We do NOT
  -- re-check here.
  --
  -- Why not defensive re-check: an earlier design attempted a defensive
  -- `NOT user_has_library_path(..., NULL)` filter here, but it is BROKEN
  -- during `shared_space` hard-delete. `shared_space_delete_library_audit`
  -- is a BEFORE DELETE ROW trigger, so when it inserts into library_audit
  -- the FK-cascade deletes of shared_space_library / shared_space_member
  -- have NOT yet run — `user_has_library_path(lib, user, NULL)` still finds
  -- the about-to-be-cascaded rows and returns TRUE, which would incorrectly
  -- skip the delete and leave stale library_user rows. Trust the gate.
  DELETE FROM library_user lu
  USING inserted_rows ir
  WHERE lu."userId" = ir."userId"
    AND lu."libraryId" = ir."libraryId";
  RETURN NULL;
END
$$;

CREATE TRIGGER "library_user_delete_after_audit"
AFTER INSERT ON "library_audit"
REFERENCING NEW TABLE AS "inserted_rows"
FOR EACH STATEMENT
EXECUTE FUNCTION library_user_delete_after_audit();
```

**Trust boundary:** any future code path that inserts into `library_audit` MUST gate on `NOT user_has_library_path(libraryId, userId, excludeSpaceId)` with the correct `excludeSpaceId` for the operation being performed — otherwise it will strip access it shouldn't. This is now a documented invariant of the `library_audit` table and is exercised by the test suite (see "defensive gate is owned by the inserter" in Testing strategy below).

## Migration: backfill `library_user` from current state

The table is populated in two passes in the same migration transaction, both using `ON CONFLICT DO NOTHING` so the migration is re-runnable:

```sql
-- Pass 1: owned libraries. Use library.createId so existing synced clients
-- don't re-backfill libraries they already have.
INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
SELECT "ownerId", "id", "createId", "createdAt"
FROM library
WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
ON CONFLICT ("userId", "libraryId") DO NOTHING;

-- Pass 2: transitive access via shared_space_library. Use a FRESH createId
-- (default immich_uuid_v7()) so users in the broken state get their missing
-- libraries re-delivered on next sync. The ON CONFLICT DO NOTHING preserves
-- the owned-path row if the user owns AND has transitive access to the same
-- library, so they don't get a wasteful re-sync.
--
-- Soft-deleted libraries are deliberately INCLUDED here — matches the
-- existing `accessibleLibraries` comment that soft-deleted libraries are
-- still reachable via a linked space until they're hard-deleted.
INSERT INTO library_user ("userId", "libraryId")
SELECT DISTINCT ssm."userId", ssl."libraryId"
FROM shared_space_library ssl
INNER JOIN shared_space_member ssm ON ssl."spaceId" = ssm."spaceId"
ON CONFLICT ("userId", "libraryId") DO NOTHING;
```

### Why owned uses old createId and transitive uses fresh

- **Owned libraries**: users who own a library were guaranteed to receive it via their initial sync (`library.getCreatedAfter(afterCreateId=null)` at initial sync returns all accessible libraries with no upper bound). Their sync checkpoint is past the library's createId. Populating `library_user` with the original `library.createId` means the migrated row is _also_ past the checkpoint, so the next sync's `getCreatedAfter` correctly returns nothing for this library.
- **Transitive libraries**: before this fix, users could never have successfully synced a library via the transitive path after their initial sync — that's the bug we're fixing. So on the day this migration runs, every user with transitive access who gained it _after_ their initial sync is in the broken state for that library. Giving those rows fresh createIds triggers a one-time re-backfill that heals their local DB.

  There is a corner case: a user whose _initial_ sync happened _after_ they were added to a space with linked libraries. They received those libraries via `getCreatedAfter(null)` at initial sync and are not in the broken state. After the migration, they get a fresh `library_user.createId` and the next sync will re-stream the library assets. This is wasted bandwidth (upserts are idempotent) but bounded: one extra sync per such user per library. For Pierre's instance this is fine. For larger future deployments, we'd need either per-user checkpoint-aware backfill detection or a "initial sync timestamp" signal.

### Ordering of the two passes

Pass 1 runs first so that owner rows land with the old createId. Pass 2's `ON CONFLICT DO NOTHING` then skips any (userId, libraryId) pair that's already present, preserving the owner's low-cost path. Users who own AND have transitive access to the same library keep the owner-path row and avoid a re-sync.

## Sync repository changes

Only one method changes:

```ts
// server/src/repositories/sync.repository.ts
export class LibrarySync extends BaseSync {
  // BEFORE: queried `library` keyed by library.createId — misses re-adds and
  // new invites because the library's own createId is past the user's
  // checkpoint. AFTER: queries `library_user` keyed by the per-user access
  // grant createId, mirroring SharedSpaceSync.getCreatedAfter and
  // AlbumSync.getCreatedAfter.
  //
  // The `library.id IN accessibleLibraries(userId)` filter is preserved
  // (via an IN subquery) so that soft-deleted owned libraries are excluded
  // from the backfill loop — matching the existing behavior where
  // `accessibleLibraries` drops the ownership branch when `deletedAt IS NOT
  // NULL`, while keeping soft-deleted libraries visible via the space-link
  // branch. Without this filter, an owner who soft-deletes a library would
  // still see its assets re-streamed on every subsequent sync.
  @GenerateSql({ params: [dummyCreateAfterOptions] })
  getCreatedAfter({ nowId, userId, afterCreateId }: SyncCreatedAfterOptions) {
    return this.db
      .selectFrom('library_user')
      .select(['library_user.libraryId as id', 'library_user.createId'])
      .where('library_user.userId', '=', userId)
      .where('library_user.libraryId', 'in', (eb) => accessibleLibraries(eb, userId))
      .$if(!!afterCreateId, (qb) => qb.where('library_user.createId', '>=', afterCreateId!))
      .where('library_user.createId', '<', nowId)
      .orderBy('library_user.createId', 'asc')
      .execute();
  }

  // getUpserts is UNCHANGED — it still filters by `library.id IN accessibleLibraries`
  // and `library.updateId > checkpoint`. The new insert triggers bump
  // library.updateId when a user gains access, so newly-accessible libraries
  // flow through this stream automatically.
  ...
}
```

`syncLibrariesV1`, `syncLibraryAssetsV1`, and `syncLibraryAssetExifsV1` are **unchanged**. The per-library backfill loops in the latter two already call `library.getCreatedAfter` and iterate the returned rows — the new implementation returns the right set.

## Mobile changes

**None.** The wire protocol is unchanged: `LibraryV1`, `LibraryAssetBackfillV1`, `LibraryAssetExifBackfillV1`, and `LibraryDeleteV1` are all existing event types that the mobile dispatches correctly. The only difference is that they start arriving for access-grant scenarios they previously missed.

## Schema-tools registration

The fork's schema pipeline requires every trigger function and trigger to be mirrored in both TypeScript-decorator form (for `make sql` / schema diff) and a `migration_overrides` row in the migration body (for `sql-tools` to pick up during CLI migrations). The `1778200000000-LibraryAuditTables.ts` migration is the canonical example — the new migration will add roughly the same volume of boilerplate for its new symbols. Concrete work items:

1. **`server/src/schema/tables/library-user.table.ts`** (new file): Kysely table definition with column decorators (`@Column`, `@Index`, `@PrimaryColumn`, `@ForeignKeyColumn`). Must match the migration's `CREATE TABLE` statement exactly.
2. **`server/src/schema/functions.ts`**: add `registerFunction` entries for the four new trigger functions: `library_after_insert`, `shared_space_member_after_insert_library`, `shared_space_library_after_insert_user`, `library_user_delete_after_audit`. Each entry declares the body SQL that `make sql` will diff against the runtime DB.
3. **`server/src/schema/index.ts`**: import and register the four new functions in the schema registry export so they participate in schema diffing.
4. **Trigger declarations**: add `@TriggerFunction` entries alongside the new table's decorator block so `make sql` emits matching trigger definitions.
5. **Migration body `migration_overrides` inserts**: for each of the four functions and their triggers, insert a `migration_overrides` row storing the canonical SQL. This is what `sql-tools` consults when running `pnpm migrations:run`. Pattern lifted from `1778200000000-LibraryAuditTables.ts` lines 139–195 (function overrides) and 153–158 (trigger overrides).
6. **Down-migration**: drop triggers, drop functions, delete the `migration_overrides` rows, drop indexes, drop the table. Mirror the up-migration in reverse.

Skipping any of these will cause `make sql` and CI schema checks to diff, which blocks PR merge. Budget ~100 lines of boilerplate beyond the design SQL.

## Known limitations / edge cases

### Concurrent member+link insert race

If two transactions concurrently insert `shared_space_member(user=U, space=S)` and `shared_space_library(space=S, library=L)`, each trigger runs against a snapshot that doesn't see the other transaction's uncommitted row. Neither insert ends up creating `library_user(U, L)`, and U doesn't get the library on next sync.

This is a pre-existing weakness of trigger-based denormalization in the fork — the existing `shared_space_member_after_insert` (bumps `shared_space.updateId`) has the same shape and the same theoretical race. In practice the hazard is low because the two operations are different API calls that are rarely issued concurrently.

**Not fixed in v1.** If it becomes a real problem, options are: advisory lock on `spaceId` during both inserts; SERIALIZABLE isolation with retry; or a periodic reconciliation job that finds (user, library) pairs where access exists but `library_user` is missing. Filed as a known limitation; tests document the hazard and pin current behavior.

### Library ownership transfer

Libraries do not currently support ownership transfer — there is no `PATCH /library/:id` endpoint or service method that updates `library.ownerId`. If such a feature is added later, the new owner needs a `library_user` row and the old owner needs the consumer-trigger-driven cleanup (assuming they lose all paths). A trigger on `UPDATE library WHEN OLD.ownerId IS DISTINCT FROM NEW.ownerId` would be required: insert a new `library_user` row for the new owner, and insert a `library_audit` row for the old owner (which our consumer trigger would then use to delete the stale `library_user` row).

**Not in scope for this design.** Flagged so that whoever adds ownership transfer later knows to add the matching trigger.

### Soft-delete of an owned library

The owner soft-deletes their library (sets `deletedAt`). Current behavior: `accessibleLibraries` drops the ownership branch for soft-deleted libraries, so subsequent syncs exclude them from delivery. Our design preserves this behavior via the `accessibleLibraries` filter in `getCreatedAfter` (see Sync repository changes above). The `library_user` row stays in place — we don't trigger on soft-delete because un-soft-delete would need the inverse trigger and the edge case doesn't materially affect correctness. On soft-delete the library simply stops appearing in the backfill loop's output; on un-soft-delete it starts appearing again at the stored createId, which is already past the user's checkpoint, so nothing is re-streamed (the client still has the data from before the soft-delete).

### Migration re-run

Both passes use `ON CONFLICT DO NOTHING` so the migration is idempotent. Running it twice is a no-op on the second run. Useful for local dev workflows and CI test fixtures that may reset and re-seed the DB.

### Dependence on the "creator is always a member" invariant

The create-side triggers handle the space-creator case indirectly: `SharedSpaceService.create` invariantly inserts a `shared_space_member` row for the creator when a space is created, and our `shared_space_member_after_insert_library` trigger then grants library_user rows from whatever libraries are linked to that space. The `user_has_library_path()` helper that drives the delete-side also defensively includes a "creator of the space that links the library" branch, so a creator-but-not-member case won't spuriously lose access if it ever arises.

If a future change to `SharedSpaceService.create` breaks the "creator is always a member" invariant, our design's create-side silently fails to insert `library_user` for the creator while the delete-side still defends them. That asymmetry would manifest as a creator seeing a space's libraries go missing after a cache-reset sync (the delete path preserves them, but the create path never populated the row). Pre-existing implicit invariant, but worth noting so whoever touches space creation later knows to check.

### Bulk cascade performance

The `library_user_delete_after_audit` consumer trigger does a single unconditional `DELETE ... USING inserted_rows`, so its cost is linear in the number of audit rows delivered by the BEFORE-trigger fan-out. Each deletion is a PK lookup on `library_user (userId, libraryId)`. For a hypothetical deployment hard-deleting a 1000-member space linking 50 libraries, that's ~50k PK lookups — fast. No `user_has_library_path` calls from the consumer; all path evaluation happens once, at insertion time, inside the existing audit triggers.

## Testing strategy

### Unit / small tests (`server/src/repositories/sync.repository.spec.ts` additions or new `library-user.repository.spec.ts`)

- `LibrarySync.getCreatedAfter` returns rows in `createId` order
- Filters correctly by `afterCreateId`
- Returns empty for a user with no library access
- Returns owned + transitive without duplicates
- **Excludes a soft-deleted owned library when the user has no space-linked path to it** (regression guard for the `accessibleLibraries` filter)
- **Includes a soft-deleted library when the user is a member of a space that links it** (matches existing `accessibleLibraries` behavior for the space-link branch)
- **Set equality with `accessibleLibraries`**: seed a user with a mix of owned, owned-and-soft-deleted, and space-linked libraries, then assert that the set of `libraryId`s returned by `getCreatedAfter(userId, afterCreateId=null)` is exactly the same as the set returned by querying `accessibleLibraries(userId)` directly. Regression guard against any future drift between the two sources of truth — if someone changes one without the other, this test fails loudly.

### Medium tests (new file `server/test/medium/specs/sync/library-user.spec.ts`)

Trigger and consumer behavior against a real DB.

**Create-side triggers**:

- Insert library as owner → library_user row created for owner with `createId = library.createId` (and `createdAt = library.createdAt`) — pins the I4 invariant
- Insert library with `ownerId IS NULL` → no library_user row
- Insert library with `deletedAt IS NOT NULL` → no library_user row (trigger WHERE excludes)
- **Bulk library insert** — insert 10 libraries in one statement, all with distinct owners → 10 library_user rows created with 10 distinct createIds that each match the corresponding library's own createId (pins the statement-level trigger semantics and VOLATILE uuid_v7 generation)
- Insert shared_space_member for a space with N linked libraries → N library_user rows for the new member with fresh createIds; `library.updateId` bumped for each of the N libraries
- Insert shared_space_member for a space with zero linked libraries → no library_user rows, no library UPDATEs
- Insert shared_space_library for a space with M members → M library_user rows; `library.updateId` bumped on the newly-linked library
- Insert shared_space_library into a space with zero members → no library_user rows, but the library.updateId is still bumped (consistent with the trigger body)
- **`LibrarySync.getUpserts` re-delivery**: after a `shared_space_member_after_insert_library` trigger fires, assert that `LibrarySync.getUpserts({ userId: newMember, ack: { updateId: <pre-bump>, ... } })` returns the affected library. Pins the integration path that depends on the `updateId` bump — if the bump breaks (or if `getUpserts` grows a filter that excludes newly-accessible libraries), the integration tests in Task 14 might still pass by accidentally riding the `getCreatedAfter` stream, masking the regression. This test asserts the upsert stream independently.
- **Creator-not-member asymmetry (documentation test)**: manually insert a `shared_space` row via direct SQL without creating the matching `shared_space_member` row for the creator, link a library, then attempt a sync as the creator. Assert that `library_user` does NOT contain a row for the creator, documenting the known limitation where the create-side silently fails if the "creator is always a member" invariant is ever broken. Marked with a comment referencing the Known Limitations section.

**Delete-side consumer**:

- Delete shared_space_member (user leaves space) → library_user rows removed IF no other path; owned-library rows preserved
- Delete shared_space_library (link removed) → library_user rows removed for members who have no other path; owner's row preserved
- **Delete shared_space (whole space)** → all affected (member, library) pairs with no other path get library_user removed; owner of a still-linked-elsewhere library retains access. **This test is the regression guard for the dropped "defensive re-check" clause** — under the original design that clause would incorrectly re-detect the still-alive (pre-cascade) shared_space_library/shared_space_member rows and leave stale library_user entries behind.
- **Delete library (hard delete) via FK cascade**: directly `DELETE FROM library WHERE id = ?` → all matching `library_user` rows disappear via the `ON DELETE CASCADE` FK; assert that no `library_audit` rows are emitted (the audit chain only fires on `shared_space_*` delete paths, not on a direct `DELETE library`) and that no dangling `library_user` rows remain
- Owner leaves a space that also links their own library → library_user row stays (owner path still valid; delete audit never gets emitted because the leave-trigger's `NOT user_has_library_path(..., o.spaceId)` gate already excludes the owner)
- **Trust-the-gate contract**: manually insert a row into `library_audit` for a (user, library) pair where the user still has access via an owned path, then assert that `library_user` IS deleted. This pins the fact that the consumer trusts the inserter's gating and does NOT re-check — and is the regression guard that future code touching `library_audit` must continue to gate on `NOT user_has_library_path(libraryId, userId, excludeSpaceId)` before inserting.
- **Bulk cascade**: delete a shared_space containing many members × libraries → audit rows fan-out correctly, consumer trigger deletes exactly the pairs flagged by the BEFORE-trigger gate.

**Multi-path deduplication**:

- User owns library AND is a member of a space that links it → single library_user row from the owner trigger; the member-insert trigger's `ON CONFLICT DO NOTHING` preserves the row
- User joins space S1 linking library L, then joins space S2 also linking L → second member insert is a no-op (library_user row already exists)

**Concurrency race (optional, documents known limitation)**:

- Using `pg_sleep()` inside one of the transactions, force T1 (member insert) and T2 (link insert) to overlap such that neither sees the other's uncommitted row. Assert that the library_user row is missing afterwards. This test PINS the current hazard so anyone later adding locking/serialization can see what the fix addresses. Annotated as `it.skip(...)` or marked with a comment as a documentation test if it's flaky.

### Integration tests (new file `server/test/medium/specs/sync/library-access-backfill.spec.ts`)

End-to-end sync stream assertions for the three failing scenarios, using the medium test harness against a real DB:

1. **Re-add to space**: user is member, syncs, leaves, syncs, re-added, syncs → third sync delivers `LibraryV1` + `LibraryAssetBackfillV1` events for the space's libraries
2. **First-time invite to existing space**: new user created, initial sync (empty), user added to existing space with linked libraries, second sync → delivers library metadata + assets
3. **Library linked to existing space**: user is already in space, syncs, library linked to space, second sync → delivers library metadata + assets

### Migration backfill test (`server/test/medium/specs/sync/library-user-migration.spec.ts`)

- **Owned-rows use old createId**: seed library with known createId, run migration, assert `library_user.createId = library.createId`
- **Transitive rows use fresh createId**: seed shared_space_library + shared_space_member, run migration, assert `library_user.createId > now() - ε AND > library.createId`
- **Owned + transitive to the same library**: seed both paths, run migration, assert only ONE row with the OLD owned createId (Pass 1 wins, Pass 2 `ON CONFLICT` preserves)
- **Idempotent re-run**: run migration twice, assert row count is stable and createIds are unchanged between runs
- **No duplicates**: seed the DB with arbitrary overlapping owned/transitive grants, run migration, assert `(userId, libraryId)` pairs are unique
- **Soft-deleted owned library is skipped in Pass 1** but **included in Pass 2** if linked to a space

### E2E spec (`e2e/src/specs/server/api/sync-library.e2e-spec.ts` additions)

HTTP-level coverage matching the failure mode we observed empirically (server API returned `SyncCompleteV1` with nothing for a broken session). Three new `describe` blocks mirroring the three scenarios, each:

1. Issues real login requests to get session tokens
2. Makes real `POST /sync/stream` calls
3. Asserts the expected `LibraryV1`, `LibraryAssetCreateV1` / `LibraryAssetBackfillV1` events appear in the response

This is the authoritative check that the fix actually closes the bug from the client's perspective. Medium tests verify trigger and query behavior; the E2E test verifies the integration through the HTTP boundary.

### Regression: existing sync-library suites must still pass

- `e2e/src/specs/server/api/sync-library.e2e-spec.ts` covers `LibrariesV1`, `LibraryAssetsV1`, `LibraryAssetExifsV1`, and `SharedSpaceLibrariesV1`. All existing tests must remain green.
- `server/test/medium/specs/sync/library-audit-triggers.spec.ts` — the change is additive at the trigger level; existing delete-side assertions should still pass.
- `server/test/medium/specs/sync/sync-library.spec.ts`, `sync-library-asset.spec.ts`, `sync-library-asset-exif.spec.ts` — verify the rewritten `getCreatedAfter` returns the same set these tests expect, plus the new cases.

## Rollback plan

The migration is purely additive:

- **Application code rollback only**: the new table and triggers stay in place harmlessly. The old `LibrarySync.getCreatedAfter` (keyed off `library.createId`) would work against the existing `library` table as before. The new trigger-maintained `library_user` would keep growing but be unread. `library.updateId` bumps would continue, which is mildly wasteful but consistent with how `album` and `shared_space` already behave.
- **Migration rollback**: `down()` drops the table, triggers, and functions. The `library.updateId` bumps from the running version stay — that's a minor inflation of updateIds but sync correctness is unaffected.
- **Concurrent old+new code**: triggers fire regardless of whether the reading code path is the old or new `LibrarySync.getCreatedAfter`. Safe to roll forward or back without coordinated restarts.
- **Checkpoint value-space shift for in-flight clients**: the `afterCreateId` checkpoint that clients send with `getCreatedAfter` changes meaning under this migration — pre-fix it was a `library.createId` watermark, post-fix it is a `library_user.createId` watermark. A client whose checkpoint was captured mid-sync just before the deploy will carry a value into the post-fix system that does not correspond to a row in `library_user`. Because the new query uses `library_user.createId >= afterCreateId`, this is fine: the client will either match (no re-delivery needed) or exceed (re-delivers from a point already past) without producing incorrect results. The worst case is a one-time harmless re-delivery of rows the client already has — upserts are idempotent in the mobile sync handler. The implementation plan adds a dedicated regression test in `sync.repository.spec.ts` that seeds a checkpoint from the pre-fix value-space and asserts the post-fix query returns a consistent superset of the user's accessible libraries.

## YAGNI rejections

- **No `updateId` / `updatedAt` column** — `library_user` rows are write-once (inserted via triggers, deleted via audit consumer). There is no code path that UPDATEs them. Add later via ALTER if per-user library metadata becomes a feature.
- **No `role` column** — library access is binary (you have it or you don't). Unlike `shared_space_member` which has owner/editor/viewer roles.
- **No separate `LibraryBackfillV1` sync event type** — the existing `LibraryV1` upsert type (re-triggered by the `library.updateId` bump) delivers library metadata. No new wire protocol needed.
- **No modification of existing delete trigger functions** — the `library_audit` insert-trigger approach lets us reuse the existing `user_has_library_path()` logic without touching the trigger bodies that implement it.
- **No per-library completion tracking** — the per-entity backfill loop's current `(createId, complete)` checkpoint is sufficient. Each library_user row's createId is unique.
- **No ownership-transfer trigger** — libraries don't currently support ownership transfer. Flagged in known limitations; add when the feature lands.
- **No concurrency lock on the member+link race** — pre-existing hazard in the fork's trigger-based denormalization. Document and test-pin; fix only if it materializes.
