# Space Albums Phase 2A — Slice A3: Delete-side Fan-out + Consumer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add the delete-side trigger topology that revokes `shared_space_album_user` grants and records audit rows when an album is unlinked, a member leaves, a space is deleted, or an album is hard-deleted — mirroring the shipped library delete-side blueprint exactly.

**Architecture:** Two audit channels (created in A1): `shared_space_album_audit` (ungated link-removal, `(spaceId, albumId)`) and `shared_space_album_user_audit` (gated grant-revocation, `(albumId, userId)`). Three fan-out triggers populate them; one consumer drains the grant. The write-attribution is the crux (get it exactly right):

- `shared_space_album_delete_audit` (AFTER DELETE on `shared_space_album`): **section 1** writes the link audit UNCONDITIONALLY (fires for unlink + whole-space-delete cascade + album-hard-delete cascade); **sections 2/3** write the gated grant audit with an `EXISTS(shared_space)` guard (skips during whole-space delete — the BEFORE trigger owns it then).
- `shared_space_member_delete_album_audit` (AFTER DELETE on `shared_space_member`): writes **only** the gated grant audit.
- `shared_space_delete_album_audit` (BEFORE DELETE on `shared_space`, row-level): writes **only** the gated grant audit (single source for whole-space delete; link audit comes from the cascade-fired section 1).
- `shared_space_album_user_delete_after_audit` (AFTER INSERT on `shared_space_album_user_audit`): blindly DELETEs the matching grant row (trusts the gate).

All gated on `NOT user_has_album_path(albumId, userId, excludeSpaceId)` (A2). This is a 1:1 clone of `shared_space_library_delete_audit` / `shared_space_member_delete_library_audit` / `shared_space_delete_library_audit` / `library_user_delete_after_audit`, swapping `library`→`album` and the audit-table column shapes.

**Tech Stack:** PL/pgSQL triggers, `@immich/sql-tools` decorators, Kysely migration, Vitest medium tests.

**Spec:** §4.2–4.3 (audit channels), §5.3 (delete-side topology), §8 (edge-case table), §11 (A3).

**Depends on A1 (grant + 2 audit tables) + A2 (`user_has_album_path` + create-side). Scope guard:** NO sync read logic (getDeletes/getUpserts/getBackfill — A4). This slice is triggers + consumer + their tests only.

---

## File Structure

- Modify: `server/src/schema/functions.ts` — add four `registerFunction`s: `shared_space_album_delete_audit`, `shared_space_member_delete_album_audit`, `shared_space_delete_album_audit`, `shared_space_album_user_delete_after_audit`.
- Modify: `server/src/schema/tables/shared-space-album.table.ts` — add `@AfterDeleteTrigger(shared_space_album_delete_audit)`.
- Modify: `server/src/schema/tables/shared-space-member.table.ts` — add a 4th trigger `@AfterDeleteTrigger(shared_space_member_delete_album_audit)`.
- Modify: `server/src/schema/tables/shared-space.table.ts` — add a 3rd `@TriggerFunction(before/delete/row, shared_space_delete_album_audit)`.
- Modify: `server/src/schema/tables/shared-space-album-user-audit.table.ts` — add `@AfterInsertTrigger(shared_space_album_user_delete_after_audit)` (A1 created this table without a trigger).
- Create: `server/src/schema/migrations-gallery/1779200000000-AddSharedSpaceAlbumDeleteSideTriggers.ts` — 4 functions + 4 triggers + 8 `migration_overrides` + `down()`.
- Create: `server/test/medium/specs/sync/shared-space-album-delete-triggers.spec.ts` — the revocation matrix (mirror `library-audit-triggers.spec.ts` / `shared-space-audit-triggers.spec.ts`).

> **Run-command note:** scope medium tests with `pnpm test:medium <path>`. **migration_overrides:** follow the A2 plan's guidance exactly — auto-generate via `pnpm migrations:generate` if a DB is reachable, else hand-write mirroring 1778300000000's escaping; the CI `schema-check` drift gate is the backstop.

---

### Task 1: Consumer trigger — RED → GREEN (smallest piece first; the audit→grant-delete link)

**Files:** test `shared-space-album-delete-triggers.spec.ts`; `functions.ts`; `shared-space-album-user-audit.table.ts`; migration `1779200000000-…`.

- [ ] **Step 1: Write the failing consumer test** (read `library-user-triggers.spec.ts` for the audit→delete pattern)

```ts
import { Kysely, sql } from 'kysely';
import { AlbumUserRole, SharedSpaceRole } from 'src/enum';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;
beforeAll(async () => {
  db = await getKyselyDB();
});

const grantsFor = (albumId: string) =>
  db.selectFrom('shared_space_album_user').selectAll().where('albumId', '=', albumId).execute();

describe('shared_space_album_user_delete_after_audit (consumer)', () => {
  it('deletes the grant row when a matching grant-revocation audit row lands', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    await db.insertInto('shared_space_album_user').values({ userId: user.id, albumId: album.id }).execute();
    expect(await grantsFor(album.id)).toHaveLength(1);

    await db.insertInto('shared_space_album_user_audit').values({ albumId: album.id, userId: user.id }).execute();

    expect(await grantsFor(album.id)).toHaveLength(0);
  });

  it('leaves non-matching grants intact', async () => {
    const ctx = new SyncTestContext(db);
    const { user: u1 } = await ctx.newUser();
    const { user: u2 } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: u1.id });
    await db.insertInto('shared_space_album_user').values({ userId: u1.id, albumId: album.id }).execute();
    await db.insertInto('shared_space_album_user').values({ userId: u2.id, albumId: album.id }).execute();

    await db.insertInto('shared_space_album_user_audit').values({ albumId: album.id, userId: u1.id }).execute();

    const remaining = await grantsFor(album.id);
    expect(remaining.map((r) => r.userId)).toEqual([u2.id]);
  });
});
```

- [ ] **Step 2: Run, verify RED** — `cd server && pnpm test:medium test/medium/specs/sync/shared-space-album-delete-triggers.spec.ts` → FAIL (grant not deleted; no consumer trigger).

- [ ] **Step 3: Add `shared_space_album_user_delete_after_audit` to `functions.ts`** (clone `library_user_delete_after_audit`)

```ts
export const shared_space_album_user_delete_after_audit = registerFunction({
  name: 'shared_space_album_user_delete_after_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      DELETE FROM shared_space_album_user ssau
      USING inserted_rows ir
      WHERE ssau."userId" = ir."userId"
        AND ssau."albumId" = ir."albumId";
      RETURN NULL;
    END`,
});
```

- [ ] **Step 4: Add the `@AfterInsertTrigger` to `SharedSpaceAlbumUserAuditTable`** (clone `library-audit.table.ts`'s consumer decorator)

```ts
import { AfterInsertTrigger } from '@immich/sql-tools';
import { shared_space_album_user_delete_after_audit } from 'src/schema/functions';
// ...
@Table('shared_space_album_user_audit')
@AfterInsertTrigger({
  name: 'shared_space_album_user_delete_after_audit',
  scope: 'statement',
  referencingNewTableAs: 'inserted_rows',
  function: shared_space_album_user_delete_after_audit,
})
export class SharedSpaceAlbumUserAuditTable {
  /* unchanged columns */
}
```

- [ ] **Step 5: Start the migration** `1779200000000-AddSharedSpaceAlbumDeleteSideTriggers.ts` — `up()` creates this function + trigger + 2 `migration_overrides`; `down()` drops them. (Tasks 2–3 append the other three functions/triggers to the same file.)

- [ ] **Step 6: Run, verify GREEN** — same command → 2 consumer tests pass.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(spaces): add album grant-revocation consumer trigger (Phase 2A slice A3)"`

---

### Task 2: The three fan-out triggers — RED → GREEN (the revocation matrix)

**Files:** test (same file, more describes); `functions.ts`; `shared-space-album.table.ts`; `shared-space-member.table.ts`; `shared-space.table.ts`; migration (append).

- [ ] **Step 1: Write the failing fan-out tests** (mirror `library-audit-triggers.spec.ts`; cover every §8 delete-side row)

```ts
describe('unlink album from space', () => {
  it('writes a link-removal audit (ungated) for the (space, album) and revokes grants for members with no other path', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .execute();
    // create-side (A2) granted owner + viewer
    expect((await grantsFor(album.id)).length).toBe(2);

    await db.deleteFrom('shared_space_album').where('spaceId', '=', space.id).where('albumId', '=', album.id).execute();

    // link audit (ungated): one (space, album) row
    const linkAudit = await db
      .selectFrom('shared_space_album_audit')
      .selectAll()
      .where('albumId', '=', album.id)
      .where('spaceId', '=', space.id)
      .execute();
    expect(linkAudit).toHaveLength(1);
    // viewer had no other path → grant revoked by the consumer; owner is the album owner (album_user role='owner') → grant retained
    const remaining = (await grantsFor(album.id)).map((r) => r.userId);
    expect(remaining).toEqual([owner.id]);
  });

  it('does NOT touch a member’s manual album_user share (separate-table invariant)', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: shared } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    await db
      .insertInto('album_user')
      .values({ albumId: album.id, userId: shared.id, role: AlbumUserRole.Editor })
      .execute();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: shared.id, role: SharedSpaceRole.Viewer });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .execute();

    await db.deleteFrom('shared_space_album').where('spaceId', '=', space.id).where('albumId', '=', album.id).execute();

    // grant revoked (user_has_album_path is true via album_user, so actually NOT revoked!) — verify retention
    expect((await grantsFor(album.id)).some((g) => g.userId === shared.id)).toBe(true);
    // the album_user row itself is untouched
    const au = await db
      .selectFrom('album_user')
      .selectAll()
      .where('albumId', '=', album.id)
      .where('userId', '=', shared.id)
      .execute();
    expect(au).toHaveLength(1);
  });
});

describe('album linked to two spaces; member in only one', () => {
  it('unlink from S keeps the grant when the member reaches the album via S2', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space: s1 } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: s2 } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: s1.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await ctx.newSharedSpaceMember({ spaceId: s2.id, userId: member.id, role: SharedSpaceRole.Viewer });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: s1.id, albumId: album.id, addedById: owner.id })
      .execute();
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: s2.id, albumId: album.id, addedById: owner.id })
      .execute();

    await db.deleteFrom('shared_space_album').where('spaceId', '=', s1.id).where('albumId', '=', album.id).execute();

    expect((await grantsFor(album.id)).some((g) => g.userId === member.id)).toBe(true); // kept via s2
  });
});

describe('member leaves space', () => {
  it('revokes the grant (gated) and writes NO link-removal row', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .execute();

    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', viewer.id)
      .execute();

    expect((await grantsFor(album.id)).some((g) => g.userId === viewer.id)).toBe(false); // revoked
    const linkAudit = await db
      .selectFrom('shared_space_album_audit')
      .selectAll()
      .where('albumId', '=', album.id)
      .where('spaceId', '=', space.id)
      .execute();
    expect(linkAudit).toHaveLength(0); // link persists for remaining members
  });
});

describe('whole-space delete', () => {
  it('revokes all members’ grants (BEFORE trigger) and writes a link-removal row via cascade', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .execute();

    await db.deleteFrom('shared_space').where('id', '=', space.id).execute();

    expect((await grantsFor(album.id)).some((g) => g.userId === viewer.id)).toBe(false); // revoked (no other path)
    const linkAudit = await db
      .selectFrom('shared_space_album_audit')
      .selectAll()
      .where('albumId', '=', album.id)
      .execute();
    expect(linkAudit.length).toBeGreaterThanOrEqual(1); // section 1 fired via cascade
  });
});

describe('album hard-delete', () => {
  it('revokes grants and writes a link-removal row when the album is deleted (cascade)', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
    await db
      .insertInto('shared_space_album')
      .values({ spaceId: space.id, albumId: album.id, addedById: owner.id })
      .execute();

    await db.deleteFrom('album').where('id', '=', album.id).execute();

    // FK cascade removed the grant rows directly; assert none remain
    expect(await grantsFor(album.id)).toHaveLength(0);
    const linkAudit = await db
      .selectFrom('shared_space_album_audit')
      .selectAll()
      .where('albumId', '=', album.id)
      .execute();
    expect(linkAudit.length).toBeGreaterThanOrEqual(1); // section 1 fired during shared_space_album cascade
  });
});
```

> Verify factory helper names/signatures against `test/medium.factory.ts` and the library audit spec. If `ctx.newSharedSpaceMember` doesn't fire triggers, insert `shared_space_member` rows directly. The "manual album_user share" test asserts retention (user_has_album_path true via album_user) — read it carefully; it proves the grant is NOT revoked AND the `album_user` row is untouched.

- [ ] **Step 2: Run, verify RED** — `cd server && pnpm test:medium test/medium/specs/sync/shared-space-album-delete-triggers.spec.ts` → the new describes FAIL (no audit rows, grants not revoked).

- [ ] **Step 3: Add the three fan-out functions to `functions.ts`** (clone the library bodies; substitute album + the two audit-table shapes)

```ts
export const shared_space_album_delete_audit = registerFunction({
  name: 'shared_space_album_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      -- 1. Always record the (space, album) link delete (ungated) so clients drop the space-album.
      INSERT INTO shared_space_album_audit ("spaceId", "albumId")
      SELECT "spaceId", "albumId" FROM "old";

      -- 2. Gated grant revocation per member; skips during shared_space cascade (BEFORE-row handles it).
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT o."albumId", ssm."userId"
      FROM "old" o
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = o."spaceId"
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
        AND NOT user_has_album_path(o."albumId", ssm."userId", o."spaceId");

      -- 3. Gated grant revocation for the space creator.
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT o."albumId", ss."createdById"
      FROM "old" o
      INNER JOIN shared_space ss ON ss."id" = o."spaceId"
      WHERE NOT user_has_album_path(o."albumId", ss."createdById", o."spaceId");

      RETURN NULL;
    END`,
});

export const shared_space_member_delete_album_audit = registerFunction({
  name: 'shared_space_member_delete_album_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT ssa."albumId", o."userId"
      FROM "old" o
      INNER JOIN shared_space_album ssa ON ssa."spaceId" = o."spaceId"
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
        AND NOT user_has_album_path(ssa."albumId", o."userId", o."spaceId");
      RETURN NULL;
    END`,
});

export const shared_space_delete_album_audit = registerFunction({
  name: 'shared_space_delete_album_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT DISTINCT "albumId", "userId" FROM (
        SELECT ssa."albumId", ssm."userId"
        FROM shared_space_album ssa
        INNER JOIN shared_space_member ssm ON ssm."spaceId" = ssa."spaceId"
        WHERE ssa."spaceId" = OLD."id"
          AND NOT user_has_album_path(ssa."albumId", ssm."userId", OLD."id")
        UNION
        SELECT ssa."albumId", OLD."createdById"
        FROM shared_space_album ssa
        WHERE ssa."spaceId" = OLD."id"
          AND NOT user_has_album_path(ssa."albumId", OLD."createdById", OLD."id")
      ) AS targets;
      RETURN OLD;
    END`,
});
```

- [ ] **Step 4: Add the trigger decorators**

`shared-space-album.table.ts` — add (import `AfterDeleteTrigger` + the function):

```ts
@AfterDeleteTrigger({
  scope: 'statement',
  function: shared_space_album_delete_audit,
  referencingOldTableAs: 'old',
})
```

`shared-space-member.table.ts` — add a 4th trigger (alongside the existing `shared_space_member_delete_library_audit`):

```ts
@AfterDeleteTrigger({
  name: 'shared_space_member_delete_album_audit',
  scope: 'statement',
  function: shared_space_member_delete_album_audit,
  referencingOldTableAs: 'old',
})
```

`shared-space.table.ts` — add a 3rd `@TriggerFunction` (before/delete/row), import the function:

```ts
@TriggerFunction({
  timing: 'before',
  actions: ['delete'],
  scope: 'row',
  function: shared_space_delete_album_audit,
})
```

- [ ] **Step 5: Append CREATE FUNCTION/TRIGGER SQL + `migration_overrides` to `1779200000000-…`** for all three functions/triggers (the AFTER-DELETE triggers on `shared_space_album`/`shared_space_member` use `REFERENCING OLD TABLE AS "old" FOR EACH STATEMENT`; the BEFORE trigger on `shared_space` uses `BEFORE DELETE … FOR EACH ROW`). Copy escaping from 1778300000000. Update `down()` to drop all 4 triggers (before their functions) + delete all 8 `migration_overrides` rows + drop all 4 functions.

```ts
// down() — full
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" IN (
    'function_shared_space_album_delete_audit','trigger_shared_space_album_delete_audit',
    'function_shared_space_member_delete_album_audit','trigger_shared_space_member_delete_album_audit',
    'function_shared_space_delete_album_audit','trigger_shared_space_delete_album_audit',
    'function_shared_space_album_user_delete_after_audit','trigger_shared_space_album_user_delete_after_audit'
  );`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_user_delete_after_audit" ON "shared_space_album_user_audit";`.execute(
    db,
  );
  await sql`DROP FUNCTION IF EXISTS shared_space_album_user_delete_after_audit();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_delete_album_audit" ON "shared_space";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_delete_album_audit();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_member_delete_album_audit" ON "shared_space_member";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_member_delete_album_audit();`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "shared_space_album_delete_audit" ON "shared_space_album";`.execute(db);
  await sql`DROP FUNCTION IF EXISTS shared_space_album_delete_audit();`.execute(db);
}
```

- [ ] **Step 6: Run, verify GREEN** — `cd server && pnpm test:medium test/medium/specs/sync/shared-space-album-delete-triggers.spec.ts` → all describes pass. Re-run A2's create-trigger spec + A1's migration spec to confirm no regression.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(spaces): add delete-side album grant fan-out triggers (Phase 2A slice A3)"`

---

### Task 3: Schema-consistency + cross-trigger regression

- [ ] **Step 1: tsc + schema-drift** — `cd server && pnpm check`; then the drift check per the A2 plan (`pnpm migrations:generate` empty, or defer to CI `schema-check`). Reconcile any `migration_overrides` mismatch.
- [ ] **Step 2: Broader regression** — `cd server && pnpm test:medium test/medium/specs/sync/library-audit-triggers.spec.ts test/medium/specs/sync/shared-space-audit-triggers.spec.ts test/medium/specs/sync/shared-space-album-create-triggers.spec.ts` → PASS (the new album delete triggers coexist with the existing library/space delete triggers; create-side still green). Also run `pnpm test -- --run src/services/sync.service.spec.ts` (the onAuditTableCleanup auto-discovery — no new audit table added in A3, so it stays green).
- [ ] **Step 3: Commit any fixes** — `git add -A && git commit -m "fix(spaces): align A3 migration_overrides / triggers"`

---

## Self-Review (completed by plan author)

- **Spec coverage:** §4.2 link audit (ungated, section 1) + §4.3 grant audit (gated, consumer) → Tasks 1–2. §5.3 three fan-out triggers + consumer with exact write-attribution → Task 2 functions + decorators. §8 delete-side rows: unlink, remove-member, whole-space delete, album hard-delete, two-space retention, manual `album_user` untouched → Task 2 tests. §11 A3 RED tests → Tasks 1–2. ✓
- **Scope:** No sync read logic (A4). No new tables (A1) / create-side (A2). ✓
- **No placeholders:** all function bodies, decorators, down(), and tests are concrete. The `migration_overrides` escaped JSON is delegated to the A2 mechanism (generate-or-mirror + CI drift gate) — a verification loop, not a TODO. ✓
- **Type/name consistency:** function names `shared_space_album_delete_audit` / `shared_space_member_delete_album_audit` / `shared_space_delete_album_audit` / `shared_space_album_user_delete_after_audit` and the two audit tables (`shared_space_album_audit` `(spaceId, albumId)`; `shared_space_album_user_audit` `(albumId, userId)`) are consistent across functions.ts, decorators, migration, down(), and tests. Uses `user_has_album_path` (A2) + the grant table (A1). ✓
- **Attribution correctness (the crux):** link audit written ONLY by `shared_space_album_delete_audit` section 1 (unconditional); grant audit gated everywhere; BEFORE-row trigger writes only grant audit. Mirrors the verified library bodies. ✓
