# Slice 4 — #757 purge bypass: link-row sync streams — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close correctness-1 (=security-6) and security-7 by visibility-gating the four link-row sync streams (`SharedSpaceToAssetSync` + `SharedSpaceAlbumToAssetSync`, both `getBackfill` and `getUpserts`) and excluding the owner's partner from the library visibility-purge tombstone arm.

**Architecture:** The link-row streams emit `(space/album, asset)` join rows with **no** visibility filter, while sync handlers stream deletes _before_ upserts. A restore bumps the join row's `updateId`; a later hide writes a purge tombstone; in one sync window the delete drops the link, then the pending `updateId`-bumped link row **re-adds** it → a now-Hidden asset stays visible forever (and the ungated stream also leaks existence/membership metadata for Hidden assets). The fix adds an `asset` INNER JOIN + a **flat** `spaceVisibilityGate(eb)` to all four stream methods, mirroring the _content_ streams (`SharedSpaceAssetSync`/`SharedSpaceAlbumAssetSync`), so the stream gates on the _current_ asset visibility and converges automatically. Separately, security-7 excludes assets whose owner shares with the syncing user (partner entitlement) from the library purge arm so a partner-and-member doesn't drop an asset they still legitimately hold.

**Tech Stack:** NestJS 11, Kysely (type-safe SQL builder), PostgreSQL, vitest medium tests (testcontainers + real `SyncService`/`SyncRepository`), Playwright/vitest e2e (`e2e/`).

---

## 0. Orientation, key decisions, and environment constraints

Read this whole section before touching code. It resolves the three questions Slice 4 must answer and bakes in the local tooling reality.

### 0.1 The owner-visibility decision — FLAT `spaceVisibilityGate` (no `own OR`)

`spaceVisibilityGate(eb, column = 'asset.visibility')` is a **pure predicate** (`visibility IN ('archive','timeline')`) that takes **no** `userId` (see `server/src/utils/shared-space-album-scope.ts:42-47`). Two shapes exist in the codebase:

- **`own OR spaceVisibilityGate`** — used by `LibraryAssetSync.getBackfill`/`getUpserts` (`sync.repository.ts:1275,1294`). The owner still streams **all** visibilities of their own library assets.
- **flat `spaceVisibilityGate`** — used by the _content_ streams `SharedSpaceAssetSync` (`sync.repository.ts:1003,1029,1056`) and `SharedSpaceAlbumAssetSync` (`sync.repository.ts:1639,1663,1686`). **No** owner exception.

**Decision: the four link-row streams use the FLAT gate (no `own OR`).** Reasons, all three of which must hold:

1. **The link row's direct sibling is a FLAT content stream.** `SharedSpaceToAssetSync` streams the join row for `shared_space_asset`; its content sibling `SharedSpaceAssetSync` streams the asset row with a **flat** gate. `SharedSpaceAlbumToAssetSync` ↔ `SharedSpaceAlbumAssetSync` (also flat). If the link stream used `own OR` while the content stream stayed flat, the owner would receive a membership row (`asset A is in space S`) with **no** matching content — a dangling membership (the mobile-5 "42 photos, 37 in detail" class of inconsistency). Link and content **must** gate identically → flat.
2. **`LibraryAssetSync`'s `own OR` is not the right template here.** The library stream is `own OR` because it streams the asset row itself (membership _and_ content in one) and a library holds the owner's own personal photos, reachable via _both_ direct ownership and the space-link branch. The direct/album space path deliberately chose FLAT for its content in Slices 1–3 (pinned by `sync-shared-space-visibility-gate.spec.ts`), so Slice 4's link rows follow the flat _content_ sibling, not the library stream.
3. **Consistent with Slice 3's owner-gate direction.** Slice 3 owner-gated the _delete_ tombstones (`sync.repository.ts:1137` direct arm, `:1590` album arm, `:1332` library arm) so the owner is **not** purged of their own Hidden asset (they keep an already-synced copy — the absence of a delete). The flat upsert gate never _removes_ an existing row (upserts are additive), so it cannot contradict that: an already-synced owner keeps their stale link row (Slice 3), while a **fresh** owner backfill omits their own Hidden link row (flat gate) — exactly matching the flat content stream, which also omits it. The deferred "owner sees own hidden content" **feature** (spec §5) would flip _both_ the link and content streams to `own OR` together, later; implementing `own OR` on the link row alone now would ship a broken half-feature.

**Practical corroboration:** `SharedSpaceToAssetSync.getBackfill(options, spaceId)` and `SharedSpaceAlbumToAssetSync.getBackfill(options, albumId)` do **not** receive a `userId` (see the callers `sync.service.ts:774` and `:1135`). A flat gate needs no signature change; an `own OR` gate would force a new `userId` param threaded through `sync.service.ts`. Flat is both correct and minimal.

### 0.2 Does the `asset` INNER JOIN require column re-qualification or change checkpoint columns? — NO

For all four methods:

- The base `FROM` table is unchanged (`backfillQuery('shared_space_asset'|'album_asset', ...)` / `upsertQuery('shared_space_asset'|'album_asset', ...)`), so the checkpoint ordering — `ORDER BY "<base>"."updateId" ASC` — and the `updateId` bounds are untouched. The join does not move the base table.
- Every selected column is **already table-qualified** (`shared_space_asset.assetId as assetId`, `album_asset.albumId as albumId`, `…updateId`). We select **no** bare `id`/`updateId`/`visibility`, so adding `asset` introduces **no** ambiguity. Unlike Slice 3's `getDeletes` (which selected `id` from an audit table joined to `asset` and had to alias `shared_space_asset_audit.id as id`), these methods need **no** re-qualification.
- `asset.id` is unique and each join row has exactly one `assetId`, so `asset INNER JOIN` is 1:1 — no row duplication, no `distinctOn` needed. The join only supplies `asset.visibility` for the flat gate (and, as a correct side effect, drops link rows whose asset was hard-deleted — those are already handled by the delete-audit path).

### 0.3 The security-7 partner NOT EXISTS form

Partner table columns are `sharedById` (the sharer/owner) and `sharedWithId` (the recipient) — confirmed at `PartnerSync.getCreatedAfter` (`sync.repository.ts:623`) and `AccessRepository.checkPartnerAccess` (`access.repository.ts:259`). "User P is owner O's partner (O shares with P)" is `partner.sharedById = O AND partner.sharedWithId = P`. In the library purge arm O = `asset.ownerId`, P = `userId`. The exclusion appended to the arm:

```ts
.where((eb) =>
  eb.not(
    eb.exists(
      eb
        .selectFrom('partner')
        .select(eb.lit(1).as('exists'))
        .whereRef('partner.sharedById', '=', 'asset.ownerId')
        .where('partner.sharedWithId', '=', userId),
    ),
  ),
)
```

`NOT EXISTS` (not `NOT IN`) is chosen deliberately: `NOT IN` with a subquery mis-behaves on NULLs, and `eb.not(eb.exists(...))` is the pattern the fork already uses (`shared-space-album-scope.ts` documents `eb.not(spaceAlbumAssetExists(...))`).

### 0.4 RISK review — does gating the upsert break normal convergence?

- **Archive stays included.** `spaceVisibilityGate` = `visibility IN ('archive','timeline')`. It excludes **only** Hidden/Locked. An Archived (shareable) asset's link row still streams — the flat gate matches the content sibling, so link + content stay consistent for Archive. This is pinned by an explicit regression test (Task 3). **No** regression for Archive/Timeline convergence.
- **No divergence from spec line refs.** The spec cites `sync.repository.ts:1108-1143,1539-1582`; after Slice 3 the exact current lines are: `SharedSpaceToAssetSync.getBackfill` 1109-1119, `getUpserts` 1146-1156; `SharedSpaceAlbumToAssetSync.getBackfill` 1553-1559, `getUpserts` 1595-1604; the library `spaceLibraryAssetArm` 1325-1332. Re-confirm before editing (Slice 3's `getDeletes` edits shifted lines).
- **Hard-deleted asset:** the `INNER JOIN asset` drops a link row whose asset row is gone. That is correct for backfill/upsert (never stream a link to a nonexistent asset); the delete-audit path already tombstones such rows. No behavior loss.

### 0.5 Environment / tooling constraints (Docker is DOWN)

- **Medium + e2e cannot run locally** (no testcontainers Postgres, no e2e stack). Author every medium/e2e test **exactly** per this plan and mark it **"authored, CI-deferred."** The local RED→GREEN substitute is: the tests **compile** (`cd server && pnpm run check`) and the reasoning in each task states why each is red against current code and green after the edit. CI runs the real red→green.
- **Local gate after each commit:** `cd server && pnpm run check` (tsc) **and** `cd server && pnpm run lint` (eslint, zero-warnings). NOT `make`.
- **Single-file unit run (if needed):** `pnpm test --run <path>` (no extra `--`). This slice is pure SQL-stream logic; there is **no** meaningful unit-testable assertion (unit tests auto-mock the repository, so the SQL predicate isn't exercised). Local proof = `pnpm run check` + `pnpm run lint` + the authored medium/e2e.
- **SQL drift:** the four link-row streams and the library `getDeletes` are `@GenerateSql` decorated → `server/src/queries/sync.repository.sql` will drift (entries at `:1585`, `:1628`, `:2308`, `:2394`, plus the library `getDeletes`). **Do NOT run `make sql`** — there is no DB, and `make sql` without a running DB deletes all query files. The drift is CI/DB-regenerated. Do not hand-edit the `.sql` file.
- **No migrations, no DTO/endpoint changes, no SDK regen, no `revert-to-immich.sql` change** in this slice.
- **Commits:** exactly **two**, one per fix-group. **No** Claude co-author / "Generated with" trailers.

---

## File Structure

**Modify (production code — `server/src/repositories/sync.repository.ts`):**

- `SharedSpaceToAssetSync.getBackfill` (~1109-1119) — add `asset` join + flat gate.
- `SharedSpaceToAssetSync.getUpserts` (~1146-1156) — add `asset` join + flat gate.
- `SharedSpaceAlbumToAssetSync.getBackfill` (~1553-1559) — add `asset` join + flat gate.
- `SharedSpaceAlbumToAssetSync.getUpserts` (~1595-1604) — add `asset` join + flat gate.
- `LibraryAssetSync.getDeletes` `spaceLibraryAssetArm` (~1325-1332) — append partner NOT EXISTS.

`spaceVisibilityGate`, `accessibleSpaces`, `accessibleSpaceAlbums` are **already imported** (`sync.repository.ts:8`). No new imports needed. The partner NOT EXISTS uses only `eb` primitives — no import.

**Extend (medium tests):**

- `server/test/medium/specs/sync/sync-shared-space-to-asset.spec.ts` — direct-path metadata gate + Archive regression.
- `server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts` — album-path metadata gate + two-spaces + Archive regression.
- `server/test/medium/specs/sync/sync-shared-space-visibility-purge.spec.ts` — direct restore-then-hide convergence + backfill-after-purge + owner-stream consistency.
- `server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts` — album restore-then-hide convergence + two-spaces gating.
- `server/test/medium/specs/sync/sync-shared-space-library-visibility-purge.spec.ts` — security-7 partner exclusion + non-partner control.

**Extend (e2e):**

- `e2e/src/specs/server/api/sync-shared-space.e2e-spec.ts` — HTTP seam: restore-then-hide converges on the member's `/sync`.

---

## Commit group 1 — correctness-1 (=security-6): gate the four link-row streams

Tasks 1–5. All land in ONE commit (Task 5). Keep `pnpm run check` + `pnpm run lint` green before committing.

### Task 1: Direct-path metadata gate + implementation (`SharedSpaceToAssetSync`)

**Files:**

- Test: `server/test/medium/specs/sync/sync-shared-space-to-asset.spec.ts`
- Modify: `server/src/repositories/sync.repository.ts:1109-1119` (`getBackfill`), `:1146-1156` (`getUpserts`)

- [ ] **Step 1: Add the failing metadata-gate + Archive-regression tests**

Append these `it` blocks inside the existing `describe(SyncRequestType.SharedSpaceToAssetsV1, …)` block (the file already imports `AssetVisibility`? — it does not; add `AssetVisibility` to the `src/enum` import at the top, i.e. change `import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';` to `import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';`):

```ts
it('security-6: does NOT emit a join row for a Hidden direct-space asset (upsert path)', async () => {
  const { auth: ownerAuth, ctx } = await setup();
  const { auth: memberAuth } = await ctx.newSyncAuthUser();
  const { space } = await ctx.newSharedSpace({ createdById: ownerAuth.user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerAuth.user.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberAuth.user.id, role: SharedSpaceRole.Editor });
  const { asset } = await ctx.newAsset({ ownerId: ownerAuth.user.id, visibility: AssetVisibility.Hidden });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

  const response = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
  const joinEvents = response.filter(
    (r: { type: string }) =>
      r.type === SyncEntityType.SharedSpaceToAssetV1 || r.type === SyncEntityType.SharedSpaceToAssetBackfillV1,
  );
  const assetIds = joinEvents.map((e) => (e as { data: { assetId: string } }).data.assetId);
  expect(assetIds).not.toContain(asset.id);
});

it('security-6: does NOT backfill a Hidden direct-space link row to a newly-added member', async () => {
  const { auth: ownerAuth, ctx } = await setup();
  const { auth: memberAuth } = await ctx.newSyncAuthUser();
  const { space } = await ctx.newSharedSpace({ createdById: ownerAuth.user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerAuth.user.id, role: SharedSpaceRole.Owner });
  const { asset: hiddenAsset } = await ctx.newAsset({
    ownerId: ownerAuth.user.id,
    visibility: AssetVisibility.Hidden,
  });
  const { asset: timelineAsset } = await ctx.newAsset({
    ownerId: ownerAuth.user.id,
    visibility: AssetVisibility.Timeline,
  });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: hiddenAsset.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: timelineAsset.id });

  // Member joins the pre-existing space → triggers the per-space backfill loop.
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberAuth.user.id, role: SharedSpaceRole.Editor });

  const next = await ctx.syncStream(memberAuth, [
    SyncRequestType.SharedSpacesV1,
    SyncRequestType.SharedSpaceToAssetsV1,
  ]);
  const joinEvents = next.filter(
    (r: { type: string }) =>
      r.type === SyncEntityType.SharedSpaceToAssetV1 || r.type === SyncEntityType.SharedSpaceToAssetBackfillV1,
  );
  const assetIds = joinEvents.map((e) => (e as { data: { assetId: string } }).data.assetId);
  expect(assetIds).toContain(timelineAsset.id); // shareable link still delivered
  expect(assetIds).not.toContain(hiddenAsset.id); // Hidden link withheld
});

it('regression: an Archive direct-space asset link row is still emitted (flat gate keeps Archive)', async () => {
  const { auth: ownerAuth, ctx } = await setup();
  const { auth: memberAuth } = await ctx.newSyncAuthUser();
  const { space } = await ctx.newSharedSpace({ createdById: ownerAuth.user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerAuth.user.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberAuth.user.id, role: SharedSpaceRole.Editor });
  const { asset } = await ctx.newAsset({ ownerId: ownerAuth.user.id, visibility: AssetVisibility.Archive });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

  const response = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
  const joinEvents = response.filter(
    (r: { type: string }) =>
      r.type === SyncEntityType.SharedSpaceToAssetV1 || r.type === SyncEntityType.SharedSpaceToAssetBackfillV1,
  );
  const assetIds = joinEvents.map((e) => (e as { data: { assetId: string } }).data.assetId);
  expect(assetIds).toContain(asset.id);
});
```

- [ ] **Step 2: Verify the tests compile (local RED substitute)**

Run: `cd server && pnpm run check`
Expected: PASS (types compile). The two `security-6` tests are **red against current code** (the ungated stream emits the Hidden link row) and will fail in CI until Step 3; the Archive regression is green both before and after. Docker is down → the actual medium run is **CI-deferred**.

- [ ] **Step 3: Add the `asset` INNER JOIN + flat gate to both direct-path methods**

In `server/src/repositories/sync.repository.ts`, replace `SharedSpaceToAssetSync.getBackfill`:

```ts
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_asset', options)
      .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
      .select([
        'shared_space_asset.assetId as assetId',
        'shared_space_asset.spaceId as spaceId',
        'shared_space_asset.updateId',
      ])
      .where('shared_space_asset.spaceId', '=', spaceId)
      // correctness-1/security-6: flat visibility gate — never stream a link row for a
      // Hidden/Locked asset (matches the SharedSpaceAssetSync content sibling; converges on restore).
      .where((eb) => spaceVisibilityGate(eb))
      .stream();
  }
```

and replace `SharedSpaceToAssetSync.getUpserts`:

```ts
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_asset', options)
      .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
      .select([
        'shared_space_asset.assetId as assetId',
        'shared_space_asset.spaceId as spaceId',
        'shared_space_asset.updateId',
      ])
      .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      // correctness-1/security-6: flat visibility gate — a restore's updateId bump must not re-add a
      // now-Hidden asset after the delete tombstone (resurrection); also blocks the metadata leak.
      .where((eb) => spaceVisibilityGate(eb))
      .stream();
  }
```

- [ ] **Step 4: Verify check + lint stay green**

Run: `cd server && pnpm run check && pnpm run lint`
Expected: PASS. (After Step 3 the two `security-6` tests become green in CI; the SQL query file `src/queries/sync.repository.sql` now drifts for these two methods — that is expected and CI-regenerated. **Do not** run `make sql`.)

### Task 2: Album-path metadata gate + implementation (`SharedSpaceAlbumToAssetSync`)

**Files:**

- Test: `server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts`
- Modify: `server/src/repositories/sync.repository.ts:1553-1559` (`getBackfill`), `:1595-1604` (`getUpserts`)

- [ ] **Step 1: Add failing album metadata-gate, two-spaces, and Archive-regression tests**

The file currently imports only `SharedSpaceRole` from `src/enum`. Change that import to `import { AssetVisibility, SharedSpaceRole } from 'src/enum';`. Then append inside the existing `describe('SharedSpaceAlbumToAssetSync.getUpserts', …)` block:

```ts
it('security-6: excludes a Hidden album asset link row from the member upsert stream', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset: hidden } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
  const { asset: timeline } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: hidden.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: timeline.id });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

  const stream = sut.getUpserts({ nowId: NOW_ID, userId: member.id });
  const result: any[] = [];
  for await (const row of stream) {
    result.push(row);
  }
  const assetIds = result.map((r: any) => r.assetId);
  expect(assetIds).toContain(timeline.id); // shareable membership delivered
  expect(assetIds).not.toContain(hidden.id); // Hidden membership withheld
});

it('security-6: excludes a Hidden album asset link row from the per-album backfill stream', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset: hidden } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
  const { asset: timeline } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: hidden.id });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: timeline.id });

  const stream = sut.getBackfill({ nowId: NOW_ID, beforeUpdateId: BEFORE_UPDATE_ID }, album.id);
  const result: any[] = [];
  for await (const row of stream) {
    result.push(row);
  }
  const assetIds = result.map((r: any) => r.assetId);
  expect(assetIds).toContain(timeline.id);
  expect(assetIds).not.toContain(hidden.id);
});

it('security-6: an album linked into TWO spaces gates the Hidden asset in both member streams', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: memberA } = await ctx.newUser();
  const { user: memberB } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset: hidden } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: hidden.id });

  const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: memberA.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: spaceA.id, albumId: album.id });

  const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: memberB.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: spaceB.id, albumId: album.id });

  for (const userId of [memberA.id, memberB.id]) {
    const stream = sut.getUpserts({ nowId: NOW_ID, userId });
    const result: any[] = [];
    for await (const row of stream) {
      result.push(row);
    }
    expect(result.map((r: any) => r.assetId)).not.toContain(hidden.id);
  }
});

it('regression: an Archive album asset link row is still emitted (flat gate keeps Archive)', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { album } = await ctx.newAlbum({ ownerId: owner.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

  const stream = sut.getUpserts({ nowId: NOW_ID, userId: member.id });
  const result: any[] = [];
  for await (const row of stream) {
    result.push(row);
  }
  expect(result.map((r: any) => r.assetId)).toContain(asset.id);
});
```

> Note: `newSharedSpaceAlbum` fires the A2 create-side trigger that populates `shared_space_album_user`, so `getUpserts` (which joins the grant) resolves without an explicit grant insert — same as the existing passing tests in this file.

- [ ] **Step 2: Verify the tests compile (local RED substitute)**

Run: `cd server && pnpm run check`
Expected: PASS (compiles). The three `security-6` tests are **red against current code** (ungated album stream emits the Hidden link row); the Archive regression is green both ways. Medium run **CI-deferred**.

- [ ] **Step 3: Add the `asset` INNER JOIN + flat gate to both album-path methods**

Replace `SharedSpaceAlbumToAssetSync.getBackfill`:

```ts
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, albumId: string) {
    return this.backfillQuery('album_asset', options)
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .select(['album_asset.assetId as assetId', 'album_asset.albumId as albumId', 'album_asset.updateId'])
      .where('album_asset.albumId', '=', albumId)
      // correctness-1/security-6: flat visibility gate — never backfill a Hidden/Locked album asset's
      // link row (matches the SharedSpaceAlbumAssetSync content sibling; converges on restore).
      .where((eb) => spaceVisibilityGate(eb))
      .stream();
  }
```

and replace `SharedSpaceAlbumToAssetSync.getUpserts`:

```ts
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.upsertQuery('album_asset', options)
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .select(['album_asset.assetId as assetId', 'album_asset.albumId as albumId', 'album_asset.updateId'])
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_asset.albumId')
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      // correctness-1/security-6: flat visibility gate — a restore's updateId bump must not re-add a
      // now-Hidden album asset after the delete tombstone (resurrection); also blocks the metadata leak.
      .where((eb) => spaceVisibilityGate(eb))
      .stream();
  }
```

- [ ] **Step 4: Verify check + lint stay green**

Run: `cd server && pnpm run check && pnpm run lint`
Expected: PASS. SQL drift for these two methods is expected and CI-regenerated.

### Task 3: Convergence (restore-then-hide) + owner-consistency tests — DIRECT path

**Files:**

- Test: `server/test/medium/specs/sync/sync-shared-space-visibility-purge.spec.ts`

This spec already imports `Kysely`, `SharedSpaceRole`, `SyncEntityType`, `SyncRequestType`, `SharedSpaceRepository`, and has `seedSpaceWithDirectAsset`. Add `AssetVisibility` to the `src/enum` import: change `import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';` to `import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';`.

- [ ] **Step 1: Add the failing convergence + owner-consistency tests**

Append inside the existing `describe('SharedSpaceToAssetSync — visibility purge/restore (direct path)', …)` block:

```ts
// correctness-1: restore bumps the join-row updateId; a later hide writes a tombstone. In one sync
// window the handler streams deletes BEFORE upserts, so without the gate the pending updateId-bumped
// link row RE-ADDS the now-Hidden asset after the delete drops it (resurrection). The flat gate on
// getUpserts blocks the re-add → the member converges to ABSENT.
it('correctness-1: restore-then-hide within one window does NOT resurrect the asset for a member', async () => {
  const { auth: ownerAuth, ctx } = await setup();
  const { auth: memberAuth } = await ctx.newSyncAuthUser();
  const { space, asset } = await seedSpaceWithDirectAsset(ctx, ownerAuth.user.id, memberAuth.user.id);

  // Member already synced the asset while Timeline.
  const initial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
  await ctx.syncAckAll(memberAuth, initial);
  await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);

  // Restore (updateId bump) then hide (tombstone), both after the ack, in one window.
  await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityRestore([asset.id]);
  await defaultDatabase
    .updateTable('asset')
    .set({ visibility: AssetVisibility.Hidden })
    .where('id', '=', asset.id)
    .execute();
  await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([asset.id]);

  const next = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
  const upserts = next
    .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetV1)
    .map((e) => (e as { data: { spaceId: string; assetId: string } }).data);
  const deletes = next
    .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1)
    .map((e) => (e as { data: { spaceId: string; assetId: string } }).data);

  // The tombstone drops the link; the flat gate blocks the stale-updateId re-add → converge to absent.
  expect(deletes).toContainEqual(expect.objectContaining({ spaceId: space.id, assetId: asset.id }));
  expect(upserts).not.toContainEqual(expect.objectContaining({ spaceId: space.id, assetId: asset.id }));

  // Ack all; the next window must be empty (no re-delivery from the stale updateId).
  await ctx.syncAckAll(memberAuth, next);
  await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
});

// correctness-1 edge: a member backfilling a space AFTER an asset was purged/hidden must not receive
// the tombstoned link row via the backfill path.
it('correctness-1: backfill after a purge does NOT re-deliver the Hidden asset link row', async () => {
  const { auth: ownerAuth, ctx } = await setup();
  const { space, asset } = await seedSpaceWithDirectAsset(ctx, ownerAuth.user.id);

  // Hide + purge before any member has synced.
  await defaultDatabase
    .updateTable('asset')
    .set({ visibility: AssetVisibility.Hidden })
    .where('id', '=', asset.id)
    .execute();
  await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([asset.id]);

  // A fresh member joins and backfills the space.
  const { auth: memberAuth } = await ctx.newSyncAuthUser();
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: memberAuth.user.id, role: SharedSpaceRole.Editor });

  const next = await ctx.syncStream(memberAuth, [
    SyncRequestType.SharedSpacesV1,
    SyncRequestType.SharedSpaceToAssetsV1,
  ]);
  const joinEvents = next.filter(
    (r: { type: string }) =>
      r.type === SyncEntityType.SharedSpaceToAssetV1 || r.type === SyncEntityType.SharedSpaceToAssetBackfillV1,
  );
  expect(joinEvents.map((e) => (e as { data: { assetId: string } }).data.assetId)).not.toContain(asset.id);
});

// Owner-stream consistency with slice 3: the owner-gated tombstone means an already-synced owner keeps
// their own Hidden asset (no delete). The FLAT upsert gate (slice 4) means a FRESH owner backfill omits
// that same Hidden link row — identical to the SharedSpaceAssetsV1 content stream, which also omits it.
// Pins the flat decision; the deferred "owner sees own hidden" feature would flip BOTH streams together.
it('owner consistency: owner keeps an already-synced Hidden asset (no delete) but a fresh backfill omits it (flat gate)', async () => {
  const { auth: ownerAuth, ctx } = await setup();
  const { space, asset } = await seedSpaceWithDirectAsset(ctx, ownerAuth.user.id);

  const initial = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
  await ctx.syncAckAll(ownerAuth, initial);
  await ctx.assertSyncIsComplete(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);

  await defaultDatabase
    .updateTable('asset')
    .set({ visibility: AssetVisibility.Hidden })
    .where('id', '=', asset.id)
    .execute();
  await ctx.get(SharedSpaceRepository).emitDirectAssetVisibilityPurge([asset.id]);

  // slice 3: owner gets NO delete for their own hidden asset (over-purge guard).
  const afterHide = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1]);
  const ownerDeletes = afterHide.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceToAssetDeleteV1);
  expect(ownerDeletes).toHaveLength(0);

  // slice 4 flat gate: a FRESH (reset) backfill omits the owner's own Hidden link row...
  const reset = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceToAssetsV1], true);
  const resetLinks = reset.filter(
    (r: { type: string }) =>
      r.type === SyncEntityType.SharedSpaceToAssetV1 || r.type === SyncEntityType.SharedSpaceToAssetBackfillV1,
  );
  expect(resetLinks.map((e) => (e as { data: { assetId: string } }).data.assetId)).not.toContain(asset.id);

  // ...matching the content stream, which also omits it for the owner (both flat).
  const content = await ctx.syncStream(ownerAuth, [SyncRequestType.SharedSpaceAssetsV1], true);
  const contentAssetEvents = content.filter(
    (r: { type: string }) =>
      r.type === SyncEntityType.SharedSpaceAssetCreateV1 || r.type === SyncEntityType.SharedSpaceAssetBackfillV1,
  );
  expect(contentAssetEvents.map((e) => (e as { data: { id: string } }).data.id)).not.toContain(asset.id);
});
```

> `SyncTestContext.syncStream(auth, types, reset?)` takes a **positional** `reset` boolean (verified at `test/medium.factory.ts:404`), hence `ctx.syncStream(ownerAuth, [...], true)` above (not an options object). The e2e file's own `syncStream(accessToken, types, reset = false)` helper is likewise positional.

- [ ] **Step 2: Verify the tests compile (local RED substitute)**

Run: `cd server && pnpm run check`
Expected: PASS (compiles). `correctness-1: restore-then-hide …` is **red against pre-Task-1 code** (resurrection: the ungated `getUpserts` re-adds the asset) and **green after Task 1's edit**; the other two are green after Task 1. Medium run **CI-deferred**.

### Task 4: Convergence + two-spaces tests — ALBUM path

**Files:**

- Test: `server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts`

This spec already imports `AssetVisibility`? — it imports `SharedSpaceRole, SyncEntityType, SyncRequestType` from `src/enum` and has `seedSpaceWithAlbumAsset`. Add `AssetVisibility`: change `import { SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';` to `import { AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType } from 'src/enum';`.

- [ ] **Step 1: Add the failing album convergence + two-spaces tests**

Append inside the existing `describe('SharedSpaceAlbumToAssetSync — album visibility purge/restore', …)` block:

```ts
// correctness-1 (album): restore-then-hide in one window must not resurrect a now-Hidden album asset.
it('correctness-1: album restore-then-hide within one window converges to absent for a member', async () => {
  const { auth: ownerAuth, ctx } = await setup();
  const { auth: memberAuth } = await ctx.newSyncAuthUser();
  const { album, asset } = await seedSpaceWithAlbumAsset(ctx, ownerAuth.user.id, { memberId: memberAuth.user.id });

  const initial = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
  await ctx.syncAckAll(memberAuth, initial);
  await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);

  await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityRestore([asset.id]);
  await defaultDatabase
    .updateTable('asset')
    .set({ visibility: AssetVisibility.Hidden })
    .where('id', '=', asset.id)
    .execute();
  await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

  const next = await ctx.syncStream(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
  const upserts = next
    .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1)
    .map((e) => (e as { data: { albumId: string; assetId: string } }).data);
  const deletes = next
    .filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1)
    .map((e) => (e as { data: { albumId: string; assetId: string } }).data);

  expect(deletes).toContainEqual(expect.objectContaining({ albumId: album.id, assetId: asset.id }));
  expect(upserts).not.toContainEqual(expect.objectContaining({ albumId: album.id, assetId: asset.id }));

  await ctx.syncAckAll(memberAuth, next);
  await ctx.assertSyncIsComplete(memberAuth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
});

// correctness-1 edge: an album linked into TWO spaces gates the Hidden asset in both members' streams.
it('correctness-1: album linked into two spaces gates a Hidden asset in both members', async () => {
  const { auth: ownerAuth, ctx } = await setup();
  const { auth: memberA } = await ctx.newSyncAuthUser();
  const { auth: memberB } = await ctx.newSyncAuthUser();
  const { album } = await ctx.newAlbum({ ownerId: ownerAuth.user.id });
  const { asset } = await ctx.newAsset({ ownerId: ownerAuth.user.id, visibility: AssetVisibility.Timeline });
  await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

  const { space: spaceA } = await ctx.newSharedSpace({ createdById: ownerAuth.user.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: ownerAuth.user.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: memberA.user.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: spaceA.id, albumId: album.id });

  const { space: spaceB } = await ctx.newSharedSpace({ createdById: ownerAuth.user.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: ownerAuth.user.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: memberB.user.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceAlbum({ spaceId: spaceB.id, albumId: album.id });

  // Both members sync + ack the asset while visible.
  for (const auth of [memberA, memberB]) {
    const initial = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    await ctx.syncAckAll(auth, initial);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
  }

  // Hide + purge.
  await defaultDatabase
    .updateTable('asset')
    .set({ visibility: AssetVisibility.Hidden })
    .where('id', '=', asset.id)
    .execute();
  await ctx.get(SharedSpaceRepository).emitAlbumAssetVisibilityPurge([asset.id]);

  for (const auth of [memberA, memberB]) {
    const next = await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1]);
    const deletes = next.filter((r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetDeleteV1);
    // Each member gets exactly one delete (their own space's album link) and no re-add.
    expect(deletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(true);
    await ctx.syncAckAll(auth, next);
    const upserts = (await ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumToAssetsV1])).filter(
      (r: { type: string }) => r.type === SyncEntityType.SharedSpaceAlbumToAssetV1,
    );
    expect(upserts.map((e) => (e as { data: { assetId: string } }).data.assetId)).not.toContain(asset.id);
  }
});
```

- [ ] **Step 2: Verify the tests compile (local RED substitute)**

Run: `cd server && pnpm run check`
Expected: PASS. `correctness-1: album restore-then-hide …` is **red against pre-Task-2 code** (resurrection via the ungated album `getUpserts`) and **green after Task 2's edit**. Medium run **CI-deferred**.

### Task 5: e2e HTTP seam + commit group 1

**Files:**

- Test: `e2e/src/specs/server/api/sync-shared-space.e2e-spec.ts`
- Commit: all of Tasks 1–5.

- [ ] **Step 1: Add the failing HTTP-seam convergence test**

The file already imports `AssetVisibility`, `SharedSpaceRole`, `SyncRequestType`, `updateAssets` from `@immich/sdk` and has `syncStream` / `ackAll` helpers. Append a new `describe` block just before the final closing `});` of the top-level `describe('/sync — shared-space streams', …)`:

```ts
// Slice 4 seam (correctness-1): HTTP hide → emit → real DB → HTTP /sync must converge. A restore-then-hide
// in one window must NOT resurrect the now-Hidden asset on the member's device via a stale updateId.
describe('slice 4: restore-then-hide converges on the member /sync (no resurrection)', () => {
  it('member converges to absent after a restore then hide of a direct-space asset', async () => {
    const space = await utils.createSpace(admin.accessToken, { name: 'Slice4 Converge' });
    await utils.addSpaceMember(admin.accessToken, space.id, {
      userId: member.userId,
      role: SharedSpaceRole.Editor,
    });
    const asset = await utils.createAsset(admin.accessToken);
    await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

    const types = [SyncRequestType.SharedSpaceToAssetsV1];
    const initial = await syncStream(member.accessToken, types, true);
    await ackAll(member.accessToken, initial);

    // Three boundary crossings, no member sync between them, so all land in ONE window:
    //   hide (tombstone) → restore (join-row updateId bump) → hide (tombstone).
    // Slice 3 only emits on a shareable-boundary cross, so Timeline→Timeline would NOT bump; the
    // restore MUST come from Hidden→Timeline to produce the stale updateId that drives resurrection.
    await updateAssets(
      { assetBulkUpdateDto: { ids: [asset.id], visibility: AssetVisibility.Hidden } },
      { headers: asBearerAuth(admin.accessToken) },
    );
    await updateAssets(
      { assetBulkUpdateDto: { ids: [asset.id], visibility: AssetVisibility.Timeline } },
      { headers: asBearerAuth(admin.accessToken) },
    );
    await updateAssets(
      { assetBulkUpdateDto: { ids: [asset.id], visibility: AssetVisibility.Hidden } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    const next = await syncStream(member.accessToken, types);
    const links = next
      .filter((l) => l.type === 'SharedSpaceToAssetV1')
      .map((l) => l.data as { spaceId: string; assetId: string });
    const deletes = next
      .filter((l) => l.type === 'SharedSpaceToAssetDeleteV1')
      .map((l) => l.data as { spaceId: string; assetId: string });

    // Delete drops the link; the flat gate blocks the stale-updateId re-add → member converges to absent.
    expect(deletes).toContainEqual({ spaceId: space.id, assetId: asset.id });
    expect(links).not.toContainEqual({ spaceId: space.id, assetId: asset.id });

    // Acking must leave the next window empty (no re-delivery).
    await ackAll(member.accessToken, next);
    const after = await syncStream(member.accessToken, types);
    const residual = after.filter(
      (l) => l.type === 'SharedSpaceToAssetV1' && (l.data as { assetId: string }).assetId === asset.id,
    );
    expect(residual).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify e2e spec compiles**

Run: `cd e2e && pnpm exec tsc --noEmit`
Expected: PASS (types compile). The e2e stack is down → the run is **CI-deferred**. Against pre-Task-1 server code this asserts red (resurrection re-adds the link); green after the gate.

- [ ] **Step 3: Final gate for commit group 1**

Run: `cd server && pnpm run check && pnpm run lint`
Expected: PASS (both). Do **not** run `make sql` (no DB). The `src/queries/sync.repository.sql` drift for the four edited methods is CI-regenerated.

- [ ] **Step 4: Commit group 1**

```bash
git add server/src/repositories/sync.repository.ts \
  server/test/medium/specs/sync/sync-shared-space-to-asset.spec.ts \
  server/test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts \
  server/test/medium/specs/sync/sync-shared-space-visibility-purge.spec.ts \
  server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts \
  e2e/src/specs/server/api/sync-shared-space.e2e-spec.ts
git commit -m "fix(spaces): visibility-gate link-row sync streams (correctness-1/security-6)

Add an asset INNER JOIN + flat spaceVisibilityGate to SharedSpaceToAssetSync
and SharedSpaceAlbumToAssetSync getBackfill/getUpserts, matching the content
sibling streams. Blocks the restore-then-hide resurrection (a stale updateId
re-adding a now-Hidden asset after the delete tombstone) and the Hidden-asset
membership metadata leak. Owner-visibility is flat (no own-OR), consistent with
the flat content streams and slice 3's owner-gated tombstones."
```

---

## Commit group 2 — security-7: partner exclusion on the library purge arm

### Task 6: Partner-exclusion test + implementation

**Files:**

- Test: `server/test/medium/specs/sync/sync-shared-space-library-visibility-purge.spec.ts`
- Modify: `server/src/repositories/sync.repository.ts:1325-1332` (`LibraryAssetSync.getDeletes` `spaceLibraryAssetArm`)

- [ ] **Step 1: Add the failing partner-exclusion test + non-partner control**

This spec already imports `AssetVisibility, SharedSpaceRole, SyncEntityType, SyncRequestType`, `SharedSpaceRepository`, and has `seedSpaceWithLibraryAsset` + `setup`. Append inside the existing `describe('LibraryAssetSync — library visibility purge (space members, not owner)', …)` block:

```ts
// security-7: a member who is ALSO the owner's partner keeps partner-entitled access to the asset (a
// partner may see Hidden). The library purge tombstone must NOT reach them, or their client drops the
// remote_asset row despite the partner entitlement. A non-partner member still gets the purge (control).
it('S7: a partner-and-member does NOT receive the library purge; a non-partner member does', async () => {
  const owner = await setup();
  const partnerMember = await owner.ctx.newSyncAuthUser();
  const plainMember = await owner.ctx.newSyncAuthUser();

  // Space with a linked library + one Timeline asset; both members are Editors.
  const { space } = await owner.ctx.newSharedSpace({ createdById: owner.auth.user.id });
  await owner.ctx.newSharedSpaceMember({
    spaceId: space.id,
    userId: owner.auth.user.id,
    role: SharedSpaceRole.Owner,
  });
  await owner.ctx.newSharedSpaceMember({
    spaceId: space.id,
    userId: partnerMember.user.id,
    role: SharedSpaceRole.Editor,
  });
  await owner.ctx.newSharedSpaceMember({
    spaceId: space.id,
    userId: plainMember.user.id,
    role: SharedSpaceRole.Editor,
  });
  const { library } = await owner.ctx.newLibrary({ ownerId: owner.auth.user.id });
  const { asset } = await owner.ctx.newAsset({
    ownerId: owner.auth.user.id,
    libraryId: library.id,
    visibility: AssetVisibility.Timeline,
  });
  await owner.ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

  // Owner shares with partnerMember (owner = sharedById, partnerMember = sharedWithId).
  await owner.ctx.newPartner({ sharedById: owner.auth.user.id, sharedWithId: partnerMember.user.id });

  // Both members sync + ack the asset while visible.
  for (const auth of [partnerMember.auth, plainMember.auth]) {
    const initial = await owner.ctx.syncStream(auth, [SyncRequestType.LibraryAssetsV1]);
    await owner.ctx.syncAckAll(auth, initial);
  }

  // Owner hides → library purge tombstone written for the space-linked library.
  await owner.ctx.get(SharedSpaceRepository).emitLibraryAssetVisibilityPurge([asset.id]);

  // Partner-and-member: NO delete (partner entitlement preserved).
  const partnerNext = await owner.ctx.syncStream(partnerMember.auth, [SyncRequestType.LibraryAssetsV1]);
  const partnerDeletes = partnerNext.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
  expect(partnerDeletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(false);

  // Plain member (no partner): still purged.
  const plainNext = await owner.ctx.syncStream(plainMember.auth, [SyncRequestType.LibraryAssetsV1]);
  const plainDeletes = plainNext.filter((r: { type: string }) => r.type === SyncEntityType.LibraryAssetDeleteV1);
  expect(plainDeletes.some((e) => (e as { data: { assetId: string } }).data.assetId === asset.id)).toBe(true);
});
```

- [ ] **Step 2: Verify the test compiles (local RED substitute)**

Run: `cd server && pnpm run check`
Expected: PASS (compiles). The partner assertion (`partnerDeletes … toBe(false)`) is **red against current code** (the library arm gates only on `asset.ownerId != userId`, so the partner-member IS purged) and green after Step 3; the non-partner control is green both ways. Medium run **CI-deferred**.

- [ ] **Step 3: Append the partner NOT EXISTS to the library purge arm**

In `server/src/repositories/sync.repository.ts`, in `LibraryAssetSync.getDeletes`, extend `spaceLibraryAssetArm` — replace:

```ts
const spaceLibraryAssetArm = this.db
  .selectFrom('shared_space_library_asset_audit')
  .innerJoin('asset', 'asset.id', 'shared_space_library_asset_audit.assetId')
  .select(['shared_space_library_asset_audit.id as id', 'shared_space_library_asset_audit.assetId as assetId'])
  .where('shared_space_library_asset_audit.id', '<', nowId)
  .$if(!!ack, (qb) => qb.where('shared_space_library_asset_audit.id', '>', ack!.updateId))
  .where('shared_space_library_asset_audit.libraryId', 'in', (eb) => accessibleLibraries(eb, userId))
  .where('asset.ownerId', '!=', userId);
```

with:

```ts
const spaceLibraryAssetArm = this.db
  .selectFrom('shared_space_library_asset_audit')
  .innerJoin('asset', 'asset.id', 'shared_space_library_asset_audit.assetId')
  .select(['shared_space_library_asset_audit.id as id', 'shared_space_library_asset_audit.assetId as assetId'])
  .where('shared_space_library_asset_audit.id', '<', nowId)
  .$if(!!ack, (qb) => qb.where('shared_space_library_asset_audit.id', '>', ack!.updateId))
  .where('shared_space_library_asset_audit.libraryId', 'in', (eb) => accessibleLibraries(eb, userId))
  .where('asset.ownerId', '!=', userId)
  // security-7: a member who is ALSO the owner's partner keeps partner-entitled access to the asset
  // (a partner may see Hidden). Do not purge it from their device — exclude assets whose owner shares
  // with this user via the partner table (sharedById = owner, sharedWithId = this user).
  .where((eb) =>
    eb.not(
      eb.exists(
        eb
          .selectFrom('partner')
          .select(eb.lit(1).as('exists'))
          .whereRef('partner.sharedById', '=', 'asset.ownerId')
          .where('partner.sharedWithId', '=', userId),
      ),
    ),
  );
```

- [ ] **Step 4: Final gate for commit group 2**

Run: `cd server && pnpm run check && pnpm run lint`
Expected: PASS (both). SQL drift for `LibraryAssetSync.getDeletes` is CI-regenerated; do **not** run `make sql`.

- [ ] **Step 5: Commit group 2**

```bash
git add server/src/repositories/sync.repository.ts \
  server/test/medium/specs/sync/sync-shared-space-library-visibility-purge.spec.ts
git commit -m "fix(spaces): exclude the owner's partner from the library purge arm (security-7)

The library visibility-purge tombstone arm gated only on asset.ownerId != userId,
so a member who is also the owner's partner dropped an asset their partner
entitlement still covers. Add a NOT EXISTS on the partner table (sharedById =
asset.ownerId, sharedWithId = userId) so a partner-and-member is never purged;
a non-partner member is still purged."
```

---

## Validation (run before declaring done)

- [ ] **Local type + lint gate (authoritative local proof):**
  - Run: `cd server && pnpm run check` → Expected: PASS (0 errors)
  - Run: `cd server && pnpm run lint` → Expected: PASS (0 warnings)
  - Run: `cd e2e && pnpm exec tsc --noEmit` → Expected: PASS
- [ ] **Confirm no stray `make sql` / migration / SDK changes.** `git diff --stat` should show only `server/src/repositories/sync.repository.ts`, the five medium specs, and the one e2e spec. In particular `server/src/queries/sync.repository.sql`, `server/src/schema/migrations-gallery/`, `open-api/`, and `scripts/revert-to-immich.sql` must be **unchanged**.

**CI-deferred (Docker down — cannot run locally; CI runs these):**

- `cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-to-asset.spec.ts` — direct metadata gate + Archive regression.
- `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts` — album metadata gate + two-spaces + Archive regression.
- `cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-visibility-purge.spec.ts` — direct restore-then-hide convergence + backfill-after-purge + owner consistency.
- `cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts` — album restore-then-hide convergence + two-spaces.
- `cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-library-visibility-purge.spec.ts` — security-7 partner exclusion + non-partner control.
- `cd e2e && pnpm test` (or the web/API e2e job) — `sync-shared-space.e2e-spec.ts` restore-then-hide seam.
- `make sql` regen for the five drifted `@GenerateSql` methods (CI or a scratch migrated DB — never the dev-stack DB, never without a DB).

**Edge-case coverage map (every Slice 4 edge case → a named test):**

| Slice 4 edge case                                                                | Test                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Album linked into two spaces; asset hidden → gated in both                       | `shared-space-album-to-asset-sync.spec.ts` "security-6: an album linked into TWO spaces…" + `sync-shared-space-album-visibility-purge.spec.ts` "album linked into two spaces gates…"                   |
| Asset restored after purge → link row re-appears (restore still works post-gate) | Pre-existing `sync-shared-space-visibility-purge.spec.ts` "re-emits an upsert … restored to Timeline" + `sync-shared-space-album-visibility-purge.spec.ts` A2 (both still green — gate keeps Timeline) |
| Backfill after purge does NOT re-deliver tombstoned ids                          | `sync-shared-space-visibility-purge.spec.ts` "backfill after a purge does NOT re-deliver…"                                                                                                             |
| Non-partner non-owner member still gets the library purge                        | `sync-shared-space-library-visibility-purge.spec.ts` S7 (the non-partner control arm)                                                                                                                  |
| Owner stream consistency with slice 3                                            | `sync-shared-space-visibility-purge.spec.ts` "owner keeps an already-synced Hidden asset (no delete) but a fresh backfill omits it"                                                                    |
| Restore-then-hide resurrection blocked (the core bug)                            | `sync-shared-space-visibility-purge.spec.ts` + `sync-shared-space-album-visibility-purge.spec.ts` "restore-then-hide … converges to absent" + e2e seam                                                 |
| Archive stays shareable (no over-gating)                                         | direct + album "regression: an Archive … link row is still emitted"                                                                                                                                    |
| Metadata leak (Hidden membership) blocked                                        | direct + album "security-6: …" gate tests                                                                                                                                                              |

---

## Self-Review notes (spec coverage confirmed)

- **correctness-1 (=security-6):** the four link-row streams gated (Tasks 1–2); metadata leak, backfill re-delivery, restore-then-hide resurrection, two-spaces, and Archive-included all tested (Tasks 1–5).
- **security-7:** partner NOT EXISTS on the library purge arm with a non-partner control (Task 6).
- **Owner-visibility question:** resolved to FLAT with reasoning (§0.1) and pinned by the owner-consistency test (Task 3).
- **No placeholders; exact file paths + line ranges + full code in every step.** Types/props (`SharedSpaceToAssetV1`, `SharedSpaceAlbumToAssetDeleteV1`, `LibraryAssetDeleteV1`, `emitDirectAssetVisibilityPurge/Restore`, `emitAlbumAssetVisibilityPurge/Restore`, `emitLibraryAssetVisibilityPurge`, `newPartner({sharedById,sharedWithId})`) all match the existing repository/factory symbols verified against the worktree.
- **Repo stays green between the two commits:** each commit lands its tests + its production edit together; local gate is `pnpm run check` + `pnpm run lint` (medium/e2e CI-deferred, Docker down).
