# Space Editor Asset Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Shared Space Owner/Editor edit the content and metadata of assets belonging to other members of that space, on the web, without granting delete, visibility, or stacking.

**Architecture:** One rule lives in `AccessRepository.checkSpaceEditAccess` (SQL, three access paths, owner-must-be-a-space-member). Every write already routes through it via `Permission.AssetUpdate`; the asset-edit permissions are widened to match. The client never re-derives the rule — the server answers per asset (`canEdit` on the asset DTO) and per selection (`POST /assets/editable`), with a client-side space derivation used only as a degradation when those are unavailable.

**Tech Stack:** NestJS 11 · Kysely (not TypeORM) · PostgreSQL · Vitest (unit + medium/testcontainers) · SvelteKit + Svelte 5 runes · Playwright

**Spec:** `specs/2026-08-14-space-editor-asset-permissions-design.md` — read it alongside this plan. The plan argues from the spec; scenario ids (S-1…S-46, W-1…W-18) refer to spec §6.

## Global Constraints

- **No relative imports in `server/`** — use the `src/` path alias. Enforced by ESLint.
- **Prettier:** 120 columns, single quotes, trailing commas, semicolons. `--max-warnings 0`.
- **i18n:** any new user-facing string updates `en` **plus** `de · fr · it · nl · pl · es · ru · zh_Hans · zh_Hant` in the **same commit**. Keys are alphabetically sorted, 2-space indent, unescaped Unicode. Finish with `npx prettier --write i18n/*.json`.
- **`make sql` requires a running PostgreSQL.** Run without one and it **deletes every file** in `server/src/queries/`. Order is: fresh Postgres → `pnpm build` → `pnpm migrations:run` → `node ./dist/bin/sync-sql.js`.
- **No `Co-Authored-By` or `Generated with` trailers** in commits.
- **The rule is never written twice.** Any new "can this user edit this asset" logic must call `Permission.AssetUpdate` through `checkAccess`/`requireAccess`, never re-implement it. The single client-side exception is the documented fallback in Task 6.
- **`checkSpaceEditAccess` carries `@GenerateSql` and `@ChunkedSet({ paramIndex: 1 })`.** Both decorators stay. Changing the method body means regenerating `server/src/queries/*.sql` (Task 1, Step 8).

---

## File Structure

**Server — modified**

| File                                           | Responsibility after this plan                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/src/repositories/access.repository.ts` | `checkSpaceEditAccess` gains a third (linked-album) union arm and an owner-is-member `EXISTS` on all three. The single source of the rule. |
| `server/src/utils/access.ts`                   | `AssetEditGet`/`AssetEditCreate`/`AssetEditDelete` switch from owner-only to the same union `AssetUpdate` uses.                            |
| `server/src/dtos/asset-response.dto.ts`        | Adds optional `canEdit?: boolean`.                                                                                                         |
| `server/src/dtos/asset.dto.ts`                 | Adds `AssetEditableDto` / `AssetEditableResponseDto`.                                                                                      |
| `server/src/controllers/asset.controller.ts`   | Adds `POST /assets/editable`.                                                                                                              |
| `server/src/services/asset.service.ts`         | Populates `canEdit` in `getAssetInfo`; adds `getEditable`; logs cross-owner edit activity.                                                 |
| `server/src/services/stack.service.ts`         | `create` gains an owned-ids guard.                                                                                                         |
| `server/src/enum.ts`                           | Adds `SharedSpaceActivityType.AssetEdit`.                                                                                                  |

**Server — created**

| File                                                                         | Responsibility                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| `server/test/medium/specs/repositories/access-space-edit.repository.spec.ts` | The rule, against a real database. S-1…S-13, S-43, S-44. |

**Web — modified**

| File                                                           | Responsibility after this plan                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `web/src/lib/services/asset.service.ts`                        | `canEditImage`/`canEditVideo` gate on editability, not ownership.                                   |
| `web/src/lib/components/asset-viewer/AssetViewerNavBar.svelte` | Rating + job block gate on editability; delete/archive/visibility/stack/TagPeople stay owner-gated. |
| `web/src/lib/components/asset-viewer/DetailPanel.svelte`       | Threads `canEdit` to five rows; the people row keeps `isOwner`.                                     |
| `web/src/lib/managers/command-context-manager.svelte.ts`       | `SelectionCommandContext` gains `editableSelectedAssetIds`.                                         |
| `web/src/lib/managers/selection-capabilities.ts`               | `canEditMetadata`/`canTag` become subset-based; `canSetVisibility` splits out.                      |
| `web/src/lib/components/timeline/SelectionToolbar.svelte`      | Consumes the split capability.                                                                      |

**Web — created**

| File                                          | Responsibility                                                      |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `web/src/lib/utils/asset-editability.ts`      | Pure `canEditAsset(asset, ctx)` — the one place the fallback lives. |
| `web/src/lib/utils/asset-editability.spec.ts` | W-5…W-8.                                                            |

---

## Task 1: The authority rule

**Files:**

- Modify: `server/src/repositories/access.repository.ts:489-545`
- Test: `server/test/medium/specs/repositories/access-space-edit.repository.spec.ts` (create)

**Interfaces:**

- Consumes: `spaceAlbumAssetExists`, `spaceVisibilityGate` from `src/utils/shared-space-album-scope`
- Produces: `AccessRepository.asset.checkSpaceEditAccess(userId: string, assetIds: Set<string>): Promise<Set<string>>` — unchanged signature, widened result. Every later task depends on this and none may bypass it.

**Why medium and not unit:** the rule is SQL. A mocked `AccessRepository` asserts nothing about a three-arm `UNION` with correlated `EXISTS` and per-arm visibility gates. S-4, S-5, S-7…S-10 can only fail against Postgres.

- [ ] **Step 1: Write the failing test file**

Create `server/test/medium/specs/repositories/access-space-edit.repository.spec.ts`. The harness mirrors the sibling `access-space-visibility.repository.spec.ts` exactly.

```ts
/**
 * Medium tests for `AccessRepository.asset.checkSpaceEditAccess` — the space-editor
 * write rule (#734, spec §2).
 *
 * Rule: you may edit an asset if you own it, or if you are Owner/Editor of a space
 * that shows it AND its owner is a member of that space.
 *
 * These tests are the only place S-4 (Carol), S-5 (Dave), S-7/S-8 (Hidden/Locked),
 * S-9 (trashed) and S-10 (offline) can fail. A refactor that swaps the bespoke arms
 * for `spaceAssetPathBranches` drops those gates and still compiles — this file is
 * what catches it.
 */
import { Kysely } from "kysely";
import { AssetVisibility } from "src/enum";
import { AccessRepository } from "src/repositories/access.repository";
import { LoggingRepository } from "src/repositories/logging.repository";
import { SharedSpaceRepository } from "src/repositories/shared-space.repository";
import { DB } from "src/schema";
import { BaseService } from "src/services/base.service";
import { newMediumService } from "test/medium.factory";
import { getKyselyDB } from "test/utils";

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [AccessRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  return { ctx, accessRepo: ctx.get(AccessRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const markOffline = (assetId: string) => defaultDatabase.updateTable("asset").set({ isOffline: true }).where("id", "=", assetId).execute();

const trash = (assetId: string) => defaultDatabase.updateTable("asset").set({ deletedAt: new Date() }).where("id", "=", assetId).execute();

/** Anna (Editor) + Bob (Member) in one space. */
const newSpaceWithEditorAndMember = async (ctx: ReturnType<typeof setup>["ctx"]) => {
  const { user: anna } = await ctx.newUser();
  const { user: bob } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: bob.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: bob.id, role: "owner" });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: anna.id, role: "editor" });
  return { anna, bob, space };
};

describe("checkSpaceEditAccess — the three access paths", () => {
  it("S-1: grants a directly-added asset owned by a space member", async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });

  it("S-2: grants an asset reaching the space through a linked library", async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { library } = await ctx.newLibrary({ ownerId: bob.id });
    const { asset } = await ctx.newAsset({
      ownerId: bob.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });

  it("S-3: grants an asset reaching the space through a linked album (NEW)", async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: "Trip" });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });

  it("S-11: the album arm ignores showInTimeline", async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: "Quiet" });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, showInTimeline: false });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });
});

describe("checkSpaceEditAccess — owner must be a space member", () => {
  it("S-4: denies Carol’s asset, reached via a linked album, when Carol is not in the space", async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { user: carol } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: "Shared" });
    await ctx.newAlbumUser({ albumId: album.id, userId: carol.id });
    const { asset } = await ctx.newAsset({ ownerId: carol.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it("S-5: denies Dave’s partner-shared asset that Bob direct-added (tightening, spec §2.3)", async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { user: dave } = await ctx.newUser();
    await ctx.newPartner({ sharedById: dave.id, sharedWithId: bob.id });
    const { asset } = await ctx.newAsset({ ownerId: dave.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: bob.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it("S-13: membership binds to the space granting the role, not to any space", async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space: spaceA } = await newSpaceWithEditorAndMember(ctx);
    // Bob leaves A; he is a member of B only. His asset still reaches A via a linked album.
    await defaultDatabase.deleteFrom("shared_space_member").where("spaceId", "=", spaceA.id).where("userId", "=", bob.id).execute();
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: bob.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: bob.id, role: "owner" });

    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: "Cross" });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: spaceA.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });
});

describe("checkSpaceEditAccess — role gate", () => {
  it("S-6: denies a Viewer on the direct path", async () => {
    const { ctx, accessRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { user: vic } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: vic.id, role: "viewer" });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(vic.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it("S-44: denies a Viewer on the NEW album path", async () => {
    const { ctx, accessRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { user: vic } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: vic.id, role: "viewer" });
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: "ViewerAlbum" });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(vic.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it("S-43: grants a space Owner, not only an Editor", async () => {
    const { ctx, accessRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { user: olive } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: olive.id, role: "owner" });
    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: "OwnerAlbum" });
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(olive.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set([asset.id]));
  });
});

describe("checkSpaceEditAccess — gates that must survive any refactor", () => {
  it.each([
    ["S-7 Hidden", AssetVisibility.Hidden],
    ["S-8 Locked", AssetVisibility.Locked],
  ])("%s: denies a non-space-shareable visibility on every path", async (_label, visibility) => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);

    const { asset: direct } = await ctx.newAsset({ ownerId: bob.id, visibility });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: direct.id });

    const { result: album } = await ctx.newAlbum({ ownerId: bob.id, albumName: "V" });
    const { asset: viaAlbum } = await ctx.newAsset({ ownerId: bob.id, visibility });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: viaAlbum.id });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([direct.id, viaAlbum.id]));

    expect(allowed).toEqual(new Set());
  });

  it("S-9: denies a trashed asset", async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    await trash(asset.id);

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it("S-10: denies an offline library asset", async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { library } = await ctx.newLibrary({ ownerId: bob.id });
    const { asset } = await ctx.newAsset({
      ownerId: bob.id,
      libraryId: library.id,
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
    await markOffline(asset.id);

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([asset.id]));

    expect(allowed).toEqual(new Set());
  });

  it("S-12: resolves the motion half of a live photo", async () => {
    const { ctx, accessRepo } = setup();
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { asset: motion } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    const { asset: still } = await ctx.newAsset({
      ownerId: bob.id,
      visibility: AssetVisibility.Timeline,
      livePhotoVideoId: motion.id,
    });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: still.id });

    const allowed = await accessRepo.asset.checkSpaceEditAccess(anna.id, new Set([motion.id]));

    expect(allowed).toEqual(new Set([motion.id]));
  });
});
```

- [ ] **Step 2: Run the tests and confirm exactly the expected failures**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/access-space-edit.repository.spec.ts`

Expected: **S-3, S-11, S-43, S-44 FAIL** (no album arm yet), **S-5 and S-13 FAIL** (no owner-is-member condition yet). Everything else passes, because it already holds.

If S-4 fails at this point, stop and investigate — it should already pass, and a failure means the fixture is wrong rather than the code.

- [ ] **Step 3: Add the owner-is-member condition to the two existing arms**

In `server/src/repositories/access.repository.ts`, inside `checkSpaceEditAccess`, add one `.where(...)` to the **direct** arm, after its existing `.where('shared_space_member.role', 'in', ['editor', 'owner'])`:

```ts
.where((eb) =>
  eb.exists(
    eb
      .selectFrom('shared_space_member as owner_member')
      .select(eb.lit(1).as('exists'))
      .whereRef('owner_member.spaceId', '=', 'shared_space_asset.spaceId')
      .whereRef('owner_member.userId', '=', 'asset.ownerId'),
  ),
)
```

And the same on the **library** arm, correlating to that arm's own space id:

```ts
.where((eb) =>
  eb.exists(
    eb
      .selectFrom('shared_space_member as owner_member')
      .select(eb.lit(1).as('exists'))
      .whereRef('owner_member.spaceId', '=', 'shared_space_library.spaceId')
      .whereRef('owner_member.userId', '=', 'asset.ownerId'),
  ),
)
```

Change nothing else in these two arms. Their `spaceVisibilityGate`, `asset.deletedAt IS NULL`, and (library only) `isOffline = false` predicates stay exactly as written.

- [ ] **Step 4: Add the third union arm for linked albums**

Chain a second `.union(...)` after the library arm, still inside the subquery that is aliased `combined`:

```ts
.union(
  this.db
    .selectFrom('asset')
    .innerJoin('shared_space_member', (join) =>
      join
        .on('shared_space_member.userId', '=', userId)
        .on('shared_space_member.role', 'in', [SharedSpaceRole.Editor, SharedSpaceRole.Owner]),
    )
    .select(['asset.id', 'asset.livePhotoVideoId'])
    .where('asset.deletedAt', 'is', null)
    .where((eb) => spaceVisibilityGate(eb))
    .where((eb) =>
      eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
    )
    // The album leg. `spaceIdRef` correlates the album's space to the actor's OWN
    // membership row, which is what makes the owner-is-member check below bind to the
    // same space (spec §2.4). Deliberately NO requireShowInTimeline: editability must
    // not depend on a timeline display toggle.
    .where((eb) =>
      spaceAlbumAssetExists(eb, {
        correlateAssetId: 'asset.id',
        scope: { spaceIdRef: 'shared_space_member.spaceId' },
      }),
    )
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('shared_space_member as owner_member')
          .select(eb.lit(1).as('exists'))
          .whereRef('owner_member.spaceId', '=', 'shared_space_member.spaceId')
          .whereRef('owner_member.userId', '=', 'asset.ownerId'),
      ),
    ),
)
```

Add `spaceAlbumAssetExists` to the existing import from `src/utils/shared-space-album-scope`, and `SharedSpaceRole` to the `src/enum` import if not already present.

- [ ] **Step 5: Run the tests and verify they all pass**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/access-space-edit.repository.spec.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Run the neighbouring access medium specs for regressions**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/access-space-visibility.repository.spec.ts test/medium/specs/utils/`
Expected: PASS. `checkSpaceAccess` (read) is untouched; this confirms it.

- [ ] **Step 7: Check the query plan before committing**

Start `psql` against the medium-test database and run `EXPLAIN` on the generated statement for a user with several spaces. The album arm's `EXISTS` subqueries are the shape that previously caused a PostgreSQL JIT blowup on the People page (spec §11). If the plan shows a JIT-compiled sequential scan over `asset`, note the timing in the commit message so the reviewer sees it was checked. This is a measurement step, not a gate — do not tune unless it is visibly pathological.

- [ ] **Step 8: Regenerate the SQL snapshots**

`checkSpaceEditAccess` is `@GenerateSql`-decorated, so `server/src/queries/access.repository.sql` must be regenerated. **Never run `make sql` without a live database — it deletes every file in `server/src/queries/`.**

```bash
docker run --rm -d -p 5439:5432 -e POSTGRES_PASSWORD=postgres --name gallery-sqlgen ghcr.io/immich-app/postgres:16-vectorchord0.4.3
cd server && pnpm build && DB_URL='postgres://postgres:postgres@localhost:5439/postgres' pnpm migrations:run
DB_URL='postgres://postgres:postgres@localhost:5439/postgres' node ./dist/bin/sync-sql.js
docker rm -f gallery-sqlgen
git diff --stat server/src/queries/
```

Expected diff: `access.repository.sql` only. Any other file changing means the build or migrations ran against the wrong schema — `git checkout -- server/src/queries` and redo in the stated order.

- [ ] **Step 9: Commit**

```bash
git add server/src/repositories/access.repository.ts server/src/queries/access.repository.sql server/test/medium/specs/repositories/access-space-edit.repository.spec.ts
git commit -m "feat(server): let space editors edit member assets reached via linked albums (#734)

checkSpaceEditAccess gains a third union arm for the linked-album path, so
an asset behaves the same whether it reached the space directly, through a
linked library, or through a linked album.

All three arms now also require the asset OWNER to be a member of the same
space that grants the caller their Owner/Editor role. That closes an
existing gap: direct-add accepts partner-shared assets (AssetShare = owner
union partner), so a space editor could previously edit a non-member
partner's asset.

The bespoke direct and library arms are kept rather than swapped onto
spaceAssetPathBranches, which carries neither the visibility gate nor the
deletedAt/isOffline filters."
```

---

## Task 2: Widen the asset-edit permissions

**Files:**

- Modify: `server/src/utils/access.ts:169-179`
- Test: `server/src/services/asset.service.spec.ts`

**Interfaces:**

- Consumes: `AccessRepository.asset.checkSpaceEditAccess` (Task 1)
- Produces: `Permission.AssetEditGet`, `AssetEditCreate`, `AssetEditDelete` now resolve to owner ∪ space-edit, identical to `AssetUpdate`.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/services/asset.service.spec.ts`. The mock shape matches the existing `rbac-3` tests in that file.

```ts
describe("asset edits — space editor access (#734)", () => {
  it("S-15: allows a space editor to READ the edits of a member asset", async () => {
    const auth = AuthFactory.create();
    const asset = AssetFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([asset.id]));
    mocks.assetEdit.getAll.mockResolvedValue([]);

    await expect(sut.getAssetEdits(auth, asset.id)).resolves.toEqual({ assetId: asset.id, edits: [] });
  });

  it("S-16: allows a space editor to WRITE edits on a member asset", async () => {
    const auth = AuthFactory.create();
    const asset = AssetFactory.create({ type: AssetType.Image });
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getForEdit.mockResolvedValue(getForAsset(asset));
    mocks.assetEdit.replaceAll.mockResolvedValue([]);

    await sut.editAsset(auth, asset.id, {
      edits: [{ action: AssetEditAction.Rotate, parameters: { degrees: 90 } }],
    } as AssetEditsCreateDto);

    expect(mocks.assetEdit.replaceAll).toHaveBeenCalled();
  });

  it("S-18: allows a space editor to REVERT edits on a member asset", async () => {
    const auth = AuthFactory.create();
    const asset = AssetFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));

    await expect(sut.removeAssetEdits(auth, asset.id)).resolves.not.toThrow();
  });

  it("S-19: still rejects an asset the caller has no space-edit access to", async () => {
    const auth = AuthFactory.create();
    const asset = AssetFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set());

    await expect(sut.editAsset(auth, asset.id, { edits: [] } as AssetEditsCreateDto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("S-45: allows a space editor to upsert asset metadata on a member asset", async () => {
    const auth = AuthFactory.create();
    const asset = AssetFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.upsertMetadata.mockResolvedValue([]);

    await expect(sut.upsertMetadata(auth, asset.id, { items: [] })).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify S-15/S-16/S-18 fail**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts -t "space editor access"`
Expected: S-15, S-16, S-18 FAIL with `BadRequestException` / forbidden from the access gate. S-19 and S-45 already pass.

- [ ] **Step 3: Widen the three permissions**

In `server/src/utils/access.ts`, replace the three owner-only cases at `:169-179`:

```ts
    case Permission.AssetEditGet:
    case Permission.AssetEditCreate:
    case Permission.AssetEditDelete: {
      // #734: asset edits (rotate/crop/trim and revert) follow the same rule as
      // AssetUpdate — owner OR space Owner/Editor over a member's asset. Get is
      // included deliberately: handleQuickRotate reads the existing edit list
      // before composing a rotation onto it, so an owner-only Get breaks editor
      // rotate on the read, before the write is ever attempted.
      const isOwner = await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
      const isSpaceEditor = await access.asset.checkSpaceEditAccess(auth.user.id, setDifference(ids, isOwner));
      return setUnion(isOwner, isSpaceEditor);
    }
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/access.ts server/src/services/asset.service.spec.ts
git commit -m "feat(server): widen asset-edit permissions to space editors (#734)

AssetEditGet/Create/Delete now resolve to owner union space-edit, matching
AssetUpdate. Get is included because quick-rotate reads the existing edit
list first and composes onto it; leaving Get owner-only would fail editor
rotate on the read with a misleading error."
```

---

## Task 3: Guards that must not move

**Files:**

- Modify: `server/src/services/stack.service.ts:20-21`
- Test: `server/src/services/stack.service.spec.ts`, `server/src/services/asset.service.spec.ts`

**Interfaces:**

- Consumes: `Permission.AssetDelete` as the pure-owner arm (the same trick `rbac-3` uses at `asset.service.ts:220-223`)
- Produces: no new symbols. `StackService.create` rejects any request naming an asset the caller does not own.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/services/stack.service.spec.ts`:

```ts
describe("create — owner-only guard (#734)", () => {
  it("S-26: rejects stacking an asset the caller does not own", async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    // AssetUpdate passes via space-edit, but the asset is not owned.
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));

    await expect(sut.create(auth, { assetIds: [assetId] })).rejects.toBeInstanceOf(ForbiddenException);

    expect(mocks.stack.create).not.toHaveBeenCalled();
  });

  it("S-27: rejects the whole request when only some assets are owned", async () => {
    const auth = AuthFactory.create();
    const mine = newUuid();
    const theirs = newUuid();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([mine]));
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([theirs]));

    await expect(sut.create(auth, { assetIds: [mine, theirs] })).rejects.toBeInstanceOf(ForbiddenException);

    expect(mocks.stack.create).not.toHaveBeenCalled();
  });

  it("S-28: still stacks the caller’s own assets", async () => {
    const auth = AuthFactory.create();
    const a = newUuid();
    const b = newUuid();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([a, b]));
    mocks.stack.create.mockResolvedValue(StackFactory.create({ ownerId: auth.user.id }));

    await sut.create(auth, { assetIds: [a, b] });

    expect(mocks.stack.create).toHaveBeenCalled();
  });
});
```

And, in `server/src/services/asset.service.spec.ts`, add a regression pin proving `rbac-3` still holds now that `AssetUpdate` is wider (S-22/S-23 already exist in that file — verify they pass rather than duplicating them).

- [ ] **Step 2: Run to verify S-26 and S-27 fail**

Run: `cd server && pnpm test -- --run src/services/stack.service.spec.ts -t "owner-only guard"`
Expected: S-26 and S-27 FAIL — the stack is created. S-28 passes.

- [ ] **Step 3: Add the guard**

In `server/src/services/stack.service.ts`, in `create`, directly after the existing `requireAccess`:

```ts
await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: dto.assetIds });

// #734: AssetUpdate now grants a space Owner/Editor write access over other members'
// assets, but stacking is owner-only filing — and StackUpdate/StackDelete are
// stack-owner-only, so a stack created over someone else's assets would leave the
// asset owner unable to manage it. AssetDelete is the pure owner arm (checkOwnerAccess,
// same hasElevatedPermission as the AssetUpdate gate's isOwner sub-check). Mirrors the
// rbac-3 shape in asset.service.ts.
const ownedIds = await this.checkAccess({ auth, permission: Permission.AssetDelete, ids: dto.assetIds });
if (ownedIds.size !== new Set(dto.assetIds).size) {
  throw new ForbiddenException("Stacks can only be created from assets you own");
}
```

Add `ForbiddenException` to the `@nestjs/common` import.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd server && pnpm test -- --run src/services/stack.service.spec.ts src/services/asset.service.spec.ts`
Expected: PASS. The pre-existing `rbac-3` visibility tests must still pass untouched — they are the proof that widening `AssetUpdate` did not leak past the downstream guards.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/stack.service.ts server/src/services/stack.service.spec.ts
git commit -m "fix(server): restrict stack creation to assets you own (#734)

Stack creation gates on AssetUpdate, which now reaches other space members'
assets. StackUpdate and StackDelete are stack-owner-only, so an editor could
create a stack over a member's photos that the member could not unstack.
Guard on the pure owner arm and reject the whole request otherwise."
```

---

## Task 4: The capability signal

**Files:**

- Modify: `server/src/dtos/asset-response.dto.ts:116`, `server/src/dtos/asset.dto.ts`, `server/src/controllers/asset.controller.ts`, `server/src/services/asset.service.ts:100-148`
- Test: `server/src/services/asset.service.spec.ts`

**Interfaces:**

- Consumes: `Permission.AssetUpdate` via `this.checkAccess`
- Produces:
  - `AssetResponseDto.canEdit?: boolean` — present only from `getAssetInfo`, absent everywhere `mapAsset` is used
  - `AssetService.getEditable(auth: AuthDto, dto: AssetEditableDto): Promise<AssetEditableResponseDto>`
  - `POST /assets/editable`, body `{ assetIds: string[]; spaceId?: string }`, response `{ editableAssetIds: string[] }`

- [ ] **Step 1: Write the failing tests**

```ts
describe("canEdit / editable (#734)", () => {
  it("S-29: sets canEdit true for a space editor viewing a member asset", async () => {
    const auth = AuthFactory.create();
    const asset = AssetFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));

    const result = (await sut.get(auth, asset.id)) as AssetResponseDto;

    expect(result.canEdit).toBe(true);
  });

  it("S-30: sets canEdit false when the caller has no edit access", async () => {
    const auth = AuthFactory.create();
    const asset = AssetFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set());
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));

    const result = (await sut.get(auth, asset.id)) as AssetResponseDto;

    expect(result.canEdit).toBe(false);
  });

  it("S-33: returns only the editable subset", async () => {
    const auth = AuthFactory.create();
    const mine = newUuid();
    const editable = newUuid();
    const forbidden = newUuid();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([mine]));
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([editable]));

    const result = await sut.getEditable(auth, { assetIds: [mine, editable, forbidden] });

    expect(new Set(result.editableAssetIds)).toEqual(new Set([mine, editable]));
  });

  it("S-34: handles an empty request without error", async () => {
    const auth = AuthFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set());

    await expect(sut.getEditable(auth, { assetIds: [] })).resolves.toEqual({ editableAssetIds: [] });
  });

  it("S-35: silently excludes an unknown id rather than 404ing", async () => {
    const auth = AuthFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set());

    await expect(sut.getEditable(auth, { assetIds: [newUuid()] })).resolves.toEqual({ editableAssetIds: [] });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts -t "canEdit / editable"`
Expected: FAIL — `result.canEdit` is `undefined`, and `sut.getEditable is not a function`.

- [ ] **Step 3: Add the DTO field**

In `server/src/dtos/asset-response.dto.ts`, beside `resolvedSpaceId` at `:116`:

```ts
    canEdit: z
      .boolean()
      .optional()
      .describe(
        'Whether the caller may edit this asset (owner, or Owner/Editor of a space whose member owns it). Present only on single-asset reads; absent from list responses, where resolving it per asset would be an N+1 access check.',
      ),
```

Do **not** set it in `mapAsset`. Absent means "not resolved", matching `resolvedSpaceId`.

- [ ] **Step 4: Add the request/response DTOs**

In `server/src/dtos/asset.dto.ts`:

```ts
const AssetEditableSchema = z
  .object({
    assetIds: z.array(z.uuidv4()).describe("Asset IDs to resolve editability for"),
    spaceId: z.uuidv4().optional().describe("Space context the assets are being viewed through"),
  })
  .meta({ id: "AssetEditableDto" });

const AssetEditableResponseSchema = z
  .object({
    editableAssetIds: z.array(z.string()).describe("Subset of the requested IDs the caller may edit"),
  })
  .meta({ id: "AssetEditableResponseDto" });

export class AssetEditableDto extends createZodDto(AssetEditableSchema) {}
export class AssetEditableResponseDto extends createZodDto(AssetEditableResponseSchema) {}
```

- [ ] **Step 5: Populate `canEdit` in `getAssetInfo`**

In `server/src/services/asset.service.ts`, in the method that builds `data` (`:100-148`), just before `return data;`:

```ts
// #734: resolve editability once, here, where the space context already is. Never in
// mapAsset — it has no AuthDto and feeds list endpoints, where this would be N+1.
if (!auth.sharedLink) {
  const editable = await this.checkAccess({ auth, permission: Permission.AssetUpdate, ids: [id] });
  data.canEdit = editable.has(id);
}
```

- [ ] **Step 6: Add the service method**

```ts
  async getEditable(auth: AuthDto, dto: AssetEditableDto): Promise<AssetEditableResponseDto> {
    // Deliberately a bare access check, not a second implementation of the rule: this IS
    // the same call the write will make, so the answer cannot drift from enforcement.
    const editable = await this.checkAccess({ auth, permission: Permission.AssetUpdate, ids: dto.assetIds });
    return { editableAssetIds: [...editable] };
  }
```

- [ ] **Step 7: Add the route**

In `server/src/controllers/asset.controller.ts`, next to the existing `@Post('jobs')` at `:44` (there is no `@Post(':id')` in this controller, so ordering is not a hazard):

```ts
  @Post('editable')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Resolve which of the given assets the caller may edit',
    description:
      'Returns the subset of the requested asset IDs the caller is allowed to edit — owned assets, plus assets belonging to a member of a space where the caller is Owner or Editor.',
    history: new HistoryBuilder().added('v2'),
  })
  getEditableAssets(@Auth() auth: AuthDto, @Body() dto: AssetEditableDto): Promise<AssetEditableResponseDto> {
    return this.service.getEditable(auth, dto);
  }
```

Decorator order and the `@Endpoint({ summary, description, history })` shape match the sibling routes in this file (`@Post('jobs')` at `:44`, `@Get(':id')` at `:92`) — a bare `@Endpoint({ summary })` is not the house style here.

Gate the route itself on `AssetRead`, not `AssetUpdate` — the API-key permission must not require write to ask a read-only question, and `@Post('jobs')` sets the precedent that the route-level permission need not match the inner check. The per-asset `AssetUpdate` check inside the service is what enforces the rule.

- [ ] **Step 8: Run the tests and verify they pass**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts`
Expected: PASS.

- [ ] **Step 9: Regenerate the OpenAPI spec and clients**

```bash
cd server && pnpm build && pnpm sync:open-api
cd .. && make open-api
git status --short open-api/ packages/sdk/ mobile/openapi/
```

Expected: the new `AssetEditableDto`/`AssetEditableResponseDto` schemas, the new path, and `canEdit` on `AssetResponseDto`. The Dart client regenerates too even though mobile is out of scope — that is expected and must be committed.

- [ ] **Step 10: Commit**

```bash
git add server/src/dtos/ server/src/controllers/asset.controller.ts server/src/services/asset.service.ts server/src/services/asset.service.spec.ts open-api/ packages/sdk/ mobile/openapi/
git commit -m "feat(server): expose per-asset editability (#734)

Adds optional canEdit to the single-asset response, resolved where the space
context already is, and POST /assets/editable for batch resolution. canEdit
is deliberately optional and never set by mapAsset: that helper has no auth
context and feeds list endpoints, where resolving it would be an N+1 access
check and a required field would emit a wrong false for owners."
```

---

## Task 5: Attribution

**Files:**

- Modify: `server/src/enum.ts:78-93`, `server/src/services/asset.service.ts`
- Test: `server/src/services/asset.service.spec.ts`

**Interfaces:**

- Consumes: `sharedSpaceRepository.logActivity({ spaceId, userId, type, data })`, `sharedSpaceRepository.findSpaceForAssetAndUser(assetId, userId)`, and `Permission.AssetDelete` as the pure owner arm
- Produces: `SharedSpaceActivityType.AssetEdit = 'asset_edit'`, and a private `AssetService.logCrossOwnerEdit(auth: AuthDto, assetIds: string[]): Promise<void>` helper

**The helper takes ids, not asset rows.** `updateAll` only ever has ids, and `findSpaceForAssetAndUser` takes an asset id — so the owner id is never actually needed. "Which of these are cross-owner" comes from `checkAccess({ permission: AssetDelete, ids })`, the same pure-owner-arm trick `rbac-3` uses at `asset.service.ts:220-223`. A `getByIds` fetch would work too, but it makes every bulk edit pay for a full asset read just to decide whether to write an activity row.

**No migration.** `shared_space_activity.type` is `character varying(30)`, not a PostgreSQL enum (`server/src/schema/tables/shared-space-activity.table.ts:26-27`). `asset_edit` is 10 characters.

- [ ] **Step 1: Write the failing tests**

```ts
describe("cross-owner edit attribution (#734)", () => {
  it("S-37: logs one activity row when an editor edits a member asset", async () => {
    const auth = AuthFactory.create();
    const asset = AssetFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    mocks.asset.update.mockResolvedValue(getForAsset(asset));
    mocks.sharedSpace.findSpaceForAssetAndUser.mockResolvedValue({ spaceId: "space-1" });

    await sut.update(auth, asset.id, { description: "fixed" });

    expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith(expect.objectContaining({ spaceId: "space-1", userId: auth.user.id, type: SharedSpaceActivityType.AssetEdit }));
  });

  it("S-38: logs nothing when the owner edits their own asset", async () => {
    const asset = AssetFactory.create();
    const auth = AuthFactory.create({ id: asset.ownerId });
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    mocks.asset.update.mockResolvedValue(getForAsset(asset));

    await sut.update(auth, asset.id, { description: "mine" });

    expect(mocks.sharedSpace.logActivity).not.toHaveBeenCalled();
  });

  it("S-40: logs nothing, and does not throw, when no space contains the asset", async () => {
    const auth = AuthFactory.create();
    const asset = AssetFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    mocks.asset.update.mockResolvedValue(getForAsset(asset));
    mocks.sharedSpace.findSpaceForAssetAndUser.mockResolvedValue(null);

    await expect(sut.update(auth, asset.id, { description: "x" })).resolves.toBeDefined();
    expect(mocks.sharedSpace.logActivity).not.toHaveBeenCalled();
  });

  it("S-41: a failing logActivity must not fail the edit", async () => {
    const auth = AuthFactory.create();
    const asset = AssetFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(getForAsset(asset));
    mocks.asset.update.mockResolvedValue(getForAsset(asset));
    mocks.sharedSpace.findSpaceForAssetAndUser.mockResolvedValue({ spaceId: "space-1" });
    mocks.sharedSpace.logActivity.mockRejectedValue(new Error("activity insert failed"));

    await expect(sut.update(auth, asset.id, { description: "x" })).resolves.toBeDefined();
  });

  it("S-46: groups a bulk edit by space — one row per space, none for spaceless assets", async () => {
    const auth = AuthFactory.create();
    const inA1 = newUuid();
    const inA2 = newUuid();
    const inB = newUuid();
    const nowhere = newUuid();
    const ids = [inA1, inA2, inB, nowhere];
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set(ids));
    // No getByIds mock: logCrossOwnerEdit derives cross-owner from the pure owner arm
    // (checkOwnerAccess above returning empty) rather than fetching asset rows.
    mocks.sharedSpace.findSpaceForAssetAndUser.mockImplementation((assetId: string) => Promise.resolve(assetId === inB ? { spaceId: "space-b" } : assetId === nowhere ? null : { spaceId: "space-a" }));

    await sut.updateAll(auth, { ids, description: "bulk" });

    expect(mocks.sharedSpace.logActivity).toHaveBeenCalledTimes(2);
    expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith(expect.objectContaining({ spaceId: "space-a", data: expect.objectContaining({ count: 2 }) }));
    expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith(expect.objectContaining({ spaceId: "space-b", data: expect.objectContaining({ count: 1 }) }));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts -t "cross-owner edit attribution"`
Expected: S-37, S-41, S-46 FAIL (no logging exists). S-38 and S-40 pass vacuously — that is fine; they become meaningful once the logging lands.

- [ ] **Step 3: Add the enum member**

In `server/src/enum.ts`, inside `SharedSpaceActivityType`, alongside `AssetAdd`/`AssetRemove`:

```ts
  AssetEdit = 'asset_edit',
```

- [ ] **Step 4: Add the helper**

In `server/src/services/asset.service.ts`:

```ts
  /**
   * #734: record an edit made by someone who is not the asset owner, so the owner can see
   * what changed and who changed it. Owner self-edits — nearly all editing — log nothing,
   * which is what keeps this low-volume.
   *
   * Grouped by resolved space, one row per space: a bulk edit can span several spaces, and
   * attributing all of it to whichever space resolved first would be wrong. Assets that
   * resolve to no space contribute no row.
   *
   * Never throws. Attribution is secondary to the edit that triggered it.
   */
  private async logCrossOwnerEdit(auth: AuthDto, assetIds: string[]): Promise<void> {
    try {
      // Which of these does the caller own? AssetDelete is the pure owner arm — the same
      // trick rbac-3 uses at :220-223. Deliberately NOT a getByIds fetch: findSpaceForAssetAndUser
      // takes an asset id, so the owner id itself is never needed, and a bulk edit should not pay
      // for a full asset read just to decide whether to write an activity row.
      const ownedIds = await this.checkAccess({ auth, permission: Permission.AssetDelete, ids: assetIds });
      const crossOwnerIds = assetIds.filter((id) => !ownedIds.has(id));
      if (crossOwnerIds.length === 0) {
        return;
      }

      const bySpace = new Map<string, string[]>();
      for (const assetId of crossOwnerIds) {
        const space = await this.sharedSpaceRepository.findSpaceForAssetAndUser(assetId, auth.user.id);
        if (!space) {
          continue;
        }
        const ids = bySpace.get(space.spaceId) ?? [];
        ids.push(assetId);
        bySpace.set(space.spaceId, ids);
      }

      for (const [spaceId, assetIds] of bySpace) {
        await this.sharedSpaceRepository.logActivity({
          spaceId,
          userId: auth.user.id,
          type: SharedSpaceActivityType.AssetEdit,
          data: { count: assetIds.length, assetIds: assetIds.slice(0, 4) },
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to log cross-owner edit activity: ${error}`);
    }
  }
```

- [ ] **Step 5: Call it from the write paths**

Call it with the ids the write touched — `await this.logCrossOwnerEdit(auth, [id])` in `update`, `editAsset` and `removeAssetEdits`; `await this.logCrossOwnerEdit(auth, ids)` in `updateAll`; and the corresponding asset ids in the tag add/remove paths. Always **after** the write succeeds, so a rejected write logs nothing.

**Do not call it from `run` (jobs).** Refresh-thumbnails is maintenance, not a change to shared truth; an activity row reading "Anna edited 40 photos" after a thumbnail refresh is worse than no row.

- [ ] **Step 6: Run the tests and verify they pass**

Run: `cd server && pnpm test -- --run src/services/asset.service.spec.ts`
Expected: PASS, including S-46 with exactly two rows.

- [ ] **Step 7: Render the new type on the web feed**

In `web/src/lib/components/spaces/space-activity-feed.svelte`, add a case beside the existing ones (`:93` is the `spaces_activity_default` fallback, which already covers this type safely if the branch is missed — but add it):

```svelte
      case SharedSpaceActivityType.AssetEdit:
        return $t('spaces_activity_edited_photos', { values: { name, count } });
```

The i18n key lands in Task 8.

- [ ] **Step 8: Commit**

```bash
git add server/src/enum.ts server/src/services/asset.service.ts server/src/services/asset.service.spec.ts web/src/lib/components/spaces/space-activity-feed.svelte
git commit -m "feat(server): record cross-owner asset edits in the space activity feed (#734)

An editor may now change another member's photo, so the owner needs to be
able to see that it happened. Owner self-edits log nothing, which keeps the
feed low-volume. Bulk edits group by resolved space and write one row per
space; a failed insert never fails the edit that triggered it.

No migration: shared_space_activity.type is varchar(30), not a PG enum."
```

---

## Task 6: Web — asset viewer and detail panel

**Files:**

- Create: `web/src/lib/utils/asset-editability.ts`, `web/src/lib/utils/asset-editability.spec.ts`
- Modify: `web/src/lib/services/asset.service.ts:284-305`, `web/src/lib/components/asset-viewer/AssetViewerNavBar.svelte:140,204`, `web/src/lib/components/asset-viewer/DetailPanel.svelte:60`
- Test: `web/src/lib/components/asset-viewer/AssetViewerNavBar.spec.ts`

**Interfaces:**

- Consumes: `AssetResponseDto.canEdit` (Task 4)
- Produces: `canEditAsset(asset: { ownerId?: string; canEdit?: boolean }, ctx?: EditabilityContext): boolean` where `EditabilityContext = { userId?: string; space?: { canWrite: boolean; members: { userId: string }[] } | null }`

- [ ] **Step 1: Write the failing test for the pure helper**

Create `web/src/lib/utils/asset-editability.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canEditAsset } from "./asset-editability";

const space = (canWrite: boolean, memberIds: string[]) => ({
  canWrite,
  members: memberIds.map((userId) => ({ userId })),
});

describe("canEditAsset", () => {
  it("W-1: trusts a server canEdit of true", () => {
    expect(canEditAsset({ ownerId: "bob", canEdit: true }, { userId: "anna" })).toBe(true);
  });

  it("W-3: trusts a server canEdit of false even for the owner", () => {
    expect(canEditAsset({ ownerId: "anna", canEdit: false }, { userId: "anna" })).toBe(false);
  });

  it("W-5: falls back to ownership when canEdit is absent", () => {
    expect(canEditAsset({ ownerId: "anna" }, { userId: "anna" })).toBe(true);
  });

  it("W-6: falls back to the space derivation for a non-owner editor", () => {
    expect(canEditAsset({ ownerId: "bob" }, { userId: "anna", space: space(true, ["anna", "bob"]) })).toBe(true);
  });

  it("W-7: denies when the asset owner is not a space member", () => {
    expect(canEditAsset({ ownerId: "carol" }, { userId: "anna", space: space(true, ["anna", "bob"]) })).toBe(false);
  });

  it("W-15: denies when the caller cannot write to the space", () => {
    expect(canEditAsset({ ownerId: "bob" }, { userId: "anna", space: space(false, ["anna", "bob"]) })).toBe(false);
  });

  it("W-8: denies a non-owner with no space context", () => {
    expect(canEditAsset({ ownerId: "bob" }, { userId: "anna" })).toBe(false);
  });

  it("W-16: denies when there is no authenticated user (shared link)", () => {
    expect(canEditAsset({ ownerId: "bob" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/utils/asset-editability.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `web/src/lib/utils/asset-editability.ts`:

```ts
export interface EditabilityContext {
  userId?: string;
  space?: { canWrite: boolean; members: { userId: string }[] } | null;
}

/**
 * "May this user edit this asset?" — one place, so the rule is never spelled twice.
 *
 * The server is authoritative: when `canEdit` is present (single-asset reads) it wins
 * outright. The fallbacks exist only for surfaces that never resolved it — list responses
 * omit the field deliberately, because resolving it per asset would be an N+1 access check.
 *
 * The space derivation mirrors the server rule (space Owner/Editor, and the asset's owner
 * is a member of that space). It is near-exact on a space surface, because every asset
 * visible there arrived through one of that space's three paths. It is only ever advisory —
 * the server enforces on write regardless.
 */
export function canEditAsset(asset: { ownerId?: string; canEdit?: boolean }, ctx: EditabilityContext = {}): boolean {
  if (asset.canEdit !== undefined) {
    return asset.canEdit;
  }

  const { userId, space } = ctx;
  if (!userId) {
    return false;
  }

  if (asset.ownerId === userId) {
    return true;
  }

  if (!space?.canWrite || !asset.ownerId) {
    return false;
  }

  return space.members.some((member) => member.userId === asset.ownerId);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/utils/asset-editability.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing viewer tests**

Add to `web/src/lib/components/asset-viewer/AssetViewerNavBar.spec.ts`. Assert presence with `getBy*` and absence with an explicit null check — never `queryBy*` plus a truthiness check, which passes either way.

**Two mechanics this file already establishes, and which the tests must follow.** Top-bar buttons are reached with `getByLabelText`, but the actions this task unlocks mostly live **inside the "more" context menu**, which must be opened first and whose items are matched by **`getByText`**, not `getByLabelText` — see the `#889` block at `:93-112`. i18n is identity-mocked, so the key _is_ the visible string. The file's existing `renderSpaceViewer` helper is already exactly the fixture needed (non-owned asset, space context), so extend it rather than writing a third render path:

```ts
// #734: a space editor may edit a member's asset. The server answers per asset via
// `canEdit`; these tests pin that the nav bar honours it without leaking the owner-only
// actions.
describe("space editor on a member photo (#734)", () => {
  const renderEditableSpacePhoto = async (canEdit: boolean) => {
    authManager.setUser(userAdminFactory.build({ id: "space-member" }));
    authManager.setPreferences(preferencesFactory.build({ cast: { gCastEnabled: false } }));
    const asset = assetFactory.build({
      id: "space-photo",
      ownerId: "space-owner",
      isTrashed: false,
      canEdit,
    });

    renderWithTooltips(AssetViewerNavBar, {
      asset,
      space: { id: "space-1", canWrite: true },
      ...additionalProps,
    });
    await fireEvent.click(screen.getByLabelText("more"));
  };

  it("W-1: offers rotate and the re-processing jobs when canEdit is true", async () => {
    await renderEditableSpacePhoto(true);

    expect(screen.getByText("rotate_left")).toBeInTheDocument();
    expect(screen.getByText("rotate_180")).toBeInTheDocument();
    expect(screen.getByText("refresh_faces")).toBeInTheDocument();
    expect(screen.getByText("refresh_metadata")).toBeInTheDocument();
  });

  it("W-2: still withholds the owner-only actions from a non-owner", async () => {
    await renderEditableSpacePhoto(true);

    expect(screen.queryByLabelText("delete")).toBeNull();
    expect(screen.queryByText("archive")).toBeNull();
    expect(screen.queryByText("add_to_stack")).toBeNull();
    expect(screen.queryByText("view_in_timeline")).toBeNull();
  });

  it("W-3: withholds the edit actions when canEdit is false", async () => {
    await renderEditableSpacePhoto(false);

    expect(screen.queryByText("rotate_left")).toBeNull();
    expect(screen.queryByText("refresh_faces")).toBeNull();
  });
});
```

W-2 is the important one: it proves the widening did not leak past the owner-only gates. W-3 proves the gate is real rather than a menu that always renders — without it, W-1 would pass against a component that ignores `canEdit` entirely.

- [ ] **Step 6: Run to verify W-1 fails while W-2 and W-3 pass**

Run: `cd web && pnpm test -- --run src/lib/components/asset-viewer/AssetViewerNavBar.spec.ts`
Expected: **W-1 FAIL** (the actions are still owner-gated), **W-2 and W-3 PASS** (vacuously — nothing renders yet). W-3 becoming meaningful only after Step 7 is expected; what matters is that it must **still** pass afterwards.

- [ ] **Step 7: Swap the gates**

In `web/src/lib/services/asset.service.ts`, replace `isOwner` with the editability check inside `canEditImage` and `canEditVideo` only (`:284-305`). Leave `ViewInTimeline` (`:330-335`), `Favorite`/`Unfavorite` and `TagPeople` (`:307-313`) on `isOwner`.

`TagPeople` stays owner-gated deliberately: person and face writes gate on `checkFaceOwnerAccess`/`checkOwnerAccess` (`server/src/utils/access.ts:276-277`, `:315-317`, `:328-332`), none of which has a space-edit arm, so opening the face editor to an editor would give them a panel whose every write 403s.

In `AssetViewerNavBar.svelte`, change the `{#if isOwner}` at `:140` (rating) and `:204` (job block) to the editability check. Leave `:147`, `:169`, `:192`, `:198` alone.

In `DetailPanel.svelte:60`, add a `canEdit` derivation beside the existing `isOwner`, and pass `canEdit` to `DetailPanelDescription`, `DetailPanelRating`, `DetailPanelDate`, `DetailPanelLocation` and `DetailPanelTags`. **`DetailPanelPeople` keeps `isOwner`** (W-18).

- [ ] **Step 8: Run the web tests and verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/asset-viewer/ src/lib/utils/asset-editability.spec.ts src/lib/services/asset.service.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/utils/asset-editability.ts web/src/lib/utils/asset-editability.spec.ts web/src/lib/services/asset.service.ts web/src/lib/components/asset-viewer/
git commit -m "feat(web): surface space-editor asset actions in the viewer (#734)

Rotate, the image editor, video trim, rating, the detail-panel metadata rows
and the re-processing jobs now gate on editability rather than ownership.
Delete, archive, set-visibility, stacking, view-in-timeline and the people
row stay owner-only.

One pure helper owns the rule client-side; it trusts the server's canEdit
whenever present and derives from space membership only where the field was
never resolved."
```

---

## Task 7: Web — bulk selection

**Files:**

- Modify: `web/src/lib/managers/command-context-manager.svelte.ts:44-61`, `web/src/lib/managers/selection-capabilities.ts:91-107`, `web/src/lib/components/timeline/SelectionToolbar.svelte:209-215`
- Test: `web/src/lib/managers/selection-capabilities.spec.ts`

**Interfaces:**

- Consumes: `POST /assets/editable` (Task 4), `canEditAsset` (Task 6)
- Produces: `SelectionCommandContext.editableSelectedAssetIds: string[] | undefined`; `SelectionCapabilities.canSetVisibility: boolean`; `SelectionCapabilities.capabilitiesPending: boolean`

- [ ] **Step 1: Write the failing tests**

Add to `web/src/lib/managers/selection-capabilities.spec.ts`, reusing that file's existing `makeMixedSelection` factory:

```ts
describe("space-editor bulk editing (#734)", () => {
  it("W-9: allows metadata edits on the editable subset but never visibility", () => {
    const ctx = makeContext({
      selection: makeSelection({
        selectedAssetIds: ["mine-1", "theirs-1", "theirs-2"],
        ownedSelectedAssetIds: ["mine-1"],
        isAllUserOwned: false,
        editableSelectedAssetIds: ["mine-1", "theirs-1"],
      }),
      space: makeSpace({ canWrite: true }),
    });

    const caps = getSelectionCapabilities(ctx, true);

    expect(caps.canEditMetadata).toBe(true);
    expect(caps.canSetVisibility).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it("W-11: reports pending while editability is unresolved", () => {
    const ctx = makeContext({
      selection: makeSelection({
        selectedAssetIds: ["mine-1", "theirs-1"],
        ownedSelectedAssetIds: ["mine-1"],
        isAllUserOwned: false,
        editableSelectedAssetIds: undefined,
      }),
      space: makeSpace({ canWrite: true }),
    });

    const caps = getSelectionCapabilities(ctx, true);

    expect(caps.capabilitiesPending).toBe(true);
  });

  it("W-12: an all-owned selection is never pending and never needs a request", () => {
    const ctx = makeContext({
      selection: makeSelection({ selectedAssetIds: ["mine-1"], isAllUserOwned: true }),
    });

    const caps = getSelectionCapabilities(ctx, true);

    expect(caps.capabilitiesPending).toBe(false);
    expect(caps.canEditMetadata).toBe(true);
    expect(caps.canSetVisibility).toBe(true);
  });

  it("denies metadata edits when nothing in the selection is editable", () => {
    const ctx = makeContext({
      selection: makeSelection({
        selectedAssetIds: ["theirs-1"],
        ownedSelectedAssetIds: [],
        isAllUserOwned: false,
        editableSelectedAssetIds: [],
      }),
      space: makeSpace({ canWrite: true }),
    });

    expect(getSelectionCapabilities(ctx, true).canEditMetadata).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/managers/selection-capabilities.spec.ts`
Expected: FAIL — `canSetVisibility` and `capabilitiesPending` do not exist.

- [ ] **Step 3: Extend the selection context type**

In `command-context-manager.svelte.ts`, add to `SelectionCommandContext`:

```ts
  /**
   * Which of `selectedAssetIds` the caller may edit. `undefined` means not yet resolved —
   * the toolbar renders those actions disabled-pending rather than popping them in late.
   * An all-owned selection resolves synchronously, without a request.
   */
  editableSelectedAssetIds: string[] | undefined;
```

- [ ] **Step 4: Split the capability**

In `selection-capabilities.ts`, add both fields to `SelectionCapabilities` and `NO_CAPABILITIES` (`capabilitiesPending: false`, `canSetVisibility: false`), then change the returned object:

```ts
  // #734: an editable subset, not all-or-nothing — the same shape canShare already uses
  // for the owned subset. `undefined` means unresolved, which is pending, not denied.
  const editable = sel.editableSelectedAssetIds;
  const capabilitiesPending = editable === undefined && !sel.isAllUserOwned;
  const hasEditable = sel.isAllUserOwned || (editable !== undefined && editable.length > 0);

  return {
    ...
    canEditMetadata: hasEditable,
    // Archive / SetVisibility are NOT metadata edits: rbac-3 restricts visibility to owned
    // assets, so they must not ride on canEditMetadata the way they used to.
    canSetVisibility: sel.isAllUserOwned,
    canTag: hasEditable && tagsEnabled,
    capabilitiesPending,
    ...
  };
```

- [ ] **Step 5: Split the toolbar block**

In `SelectionToolbar.svelte`, move `ArchiveAction` and `SetVisibilityAction` out of the `{#if caps.canEditMetadata}` block at `:209-215` into their own `{#if caps.canSetVisibility}` block. Rotate, ChangeDate, ChangeDescription and ChangeLocation stay under `canEditMetadata`.

- [ ] **Step 6: Resolve editability on selection change**

Where the selection context is registered, resolve `editableSelectedAssetIds`:

- if `isAllUserOwned` → set it to `selectedAssetIds` synchronously, issue **no** request
- otherwise → debounce (250ms), call `POST /assets/editable` with the selected ids and the current `spaceId`, and apply the response **only if the selection has not changed since** (W-14)
- on rejection → fall back to filtering `selectedAssetIds` through `canEditAsset` with the space context, and show no error toast (W-13)

- [ ] **Step 7: Report partial application**

Where the bulk metadata actions run, send only `editableSelectedAssetIds`. When that is shorter than the selection, include the skipped count in the success notification using the `assets_skipped_not_editable` key added in Task 8.

- [ ] **Step 8: Run the tests and verify they pass**

Run: `cd web && pnpm test -- --run src/lib/managers/ src/lib/components/timeline/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/managers/ web/src/lib/components/timeline/SelectionToolbar.svelte
git commit -m "feat(web): allow bulk metadata edits on the editable subset in a space (#734)

canEditMetadata and canTag move from all-or-nothing ownership to the
editable subset, matching how canShare already handles the owned subset.

Archive and SetVisibility split out into canSetVisibility, still owner-only:
they were sharing the canEditMetadata gate, and rbac-3 restricts visibility
changes to owned assets, so riding along would have produced 403s.

An all-owned selection resolves without a request; anything else resolves
through POST /assets/editable, debounced, with the actions disabled until
the answer lands."
```

---

## Task 8: i18n, end-to-end, and the full gate

**Files:**

- Modify: `i18n/en.json` + `de` `fr` `it` `nl` `pl` `es` `ru` `zh_Hans` `zh_Hant`
- Test: `e2e/src/`

**Interfaces:**

- Consumes: everything above
- Produces: `assets_skipped_not_editable`, `spaces_activity_edited_photos`

- [ ] **Step 1: Add the English keys**

In `i18n/en.json`, in alphabetical position:

```json
  "assets_skipped_not_editable": "{count, plural, one {# photo was skipped because you cannot edit it} other {# photos were skipped because you cannot edit them}}",
```

and beside the other `spaces_activity_*` keys (`:3016-3025`):

```json
  "spaces_activity_edited_photos": "{name} edited {count, plural, one {# photo} other {# photos}}",
```

- [ ] **Step 2: Translate into the nine required locales**

Both keys go into `de · fr · it · nl · pl · es · ru · zh_Hans · zh_Hant` in this same commit. Match each file's existing register — German, Italian and Spanish address the user informally (`du` / `tu` / `tú`); French and Russian use formal `vous` / `вы`. Reuse each file's existing word for "photo"; look up the nearest existing key rather than inventing a synonym.

- [ ] **Step 3: Format and verify**

```bash
npx prettier --write i18n/*.json
npx prettier --check i18n/*.json
```

Expected: clean. CI checks this.

- [ ] **Step 4: Check the `ui` Playwright project for route mocks**

```bash
grep -rn "assets" e2e/src/ui | grep -i "route\|mock"
```

The `ui` project runs the real web bundle against `page.route`-mocked APIs. A new endpoint the viewer or toolbar calls will hang those specs at the awaited-request step, and **neither web unit tests nor `--project=web` catch it**. If any spec mocks asset routes broadly, add `POST /assets/editable` to the mock.

Run: `cd e2e && pnpm exec playwright test --project=ui`
Expected: PASS. Note: goto-date (`g`) flows in that suite fail on this Mac but pass in CI — that is a known local-environment failure, not a regression.

- [ ] **Step 5: Write the end-to-end journey**

An API-level e2e in `e2e/src/api/specs/` covering the reporter's path: Anna (space Editor) opens Bob's photo in a space, rotates it, corrects its date, and an activity row appears in the space feed. Assert Anna is refused when she tries to archive or delete it.

- [ ] **Step 6: Run the full gate**

```bash
make lint-all && make format-all && make check-all
cd server && pnpm test && pnpm test:medium
cd ../web && pnpm test && pnpm check:typescript && pnpm check:svelte
cd ../e2e && pnpm test
```

`pnpm check:svelte` can silently scan **0 files** locally and still report success — do not treat a clean local run as proof. CI is the gate for the `canEdit` typing.

- [ ] **Step 7: Commit**

```bash
git add i18n/ e2e/
git commit -m "feat: space editors can edit space members' assets (#734)

Adds the partial-application and activity-feed strings across all ten
locales, plus the end-to-end journey from discussion #734: an editor opens a
space member's photo, rotates it, fixes the date, and the owner sees it in
the space activity feed.

Behaviour change to call out in the PR: a space editor can no longer edit an
asset owned by someone who is not a member of that space. Direct-add accepts
partner-shared assets, so this previously granted every space editor write
access over a non-member partner's photos."
```

---

## Self-Review

**Spec coverage.** §2 rule → Task 1. §3.2 withheld set → Tasks 3, 6 (`TagPeople` explicitly kept owner-gated in Task 6 Step 7). §4.1 → Task 1. §4.2 → Task 2. §4.3/§4.4 → Task 4. §4.5 → Task 3. §4.6 → Task 5. §4.7 widened consumers → S-45 in Task 2, stack in Task 3. §5.1 → Task 6. §5.2 → Task 7. §5.3 → Task 6 helper. §6 scenarios: S-1…S-13, S-43, S-44 in Task 1; S-15…S-19, S-45 in Task 2; S-26…S-28 in Task 3; S-29…S-35 in Task 4; S-37…S-41, S-46 in Task 5; W-1…W-8, W-15, W-16, W-18 in Task 6; W-9…W-14, W-17 in Task 7. §8 traps: `make sql` ordering in Task 1 Step 8, `ui` route mocks in Task 8 Step 4, `check:svelte` in Task 8 Step 6. §9 i18n → Task 8.

**Gaps accepted:** S-14, S-20…S-25, S-36, S-42 are covered by existing tests or fall out of the code as written; they are listed in the spec for completeness and do not each need a new test. S-36 (chunking) is exercised by `@ChunkedSet`, which has its own coverage.

**Type consistency.** `canEditAsset(asset, ctx)` — same signature in Task 6 Steps 3 and 7. `editableSelectedAssetIds` — same name in Task 7 Steps 1, 3, 6, 7. `getEditable` / `AssetEditableDto` / `AssetEditableResponseDto` / `editableAssetIds` — same names in Task 4 Steps 1, 4, 6, 7 and Task 7 Step 6. `SharedSpaceActivityType.AssetEdit` — same in Task 5 Steps 1, 3, 4, 7.
