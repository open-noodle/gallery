# Slice 3 — #757 purge bypass: asset.service transition path (TDD plan)

> Line-exact TDD plan for Slice 3 of `docs/superpowers/specs/2026-07-08-space-albums-review-remediation-design.md`.
> Closes **security-4 (=correctness-2=albums-1), correctness-6, correctness-8, gaps-5**, plus the confirmed
> **metadata motion-photo bypass writer**. Slices 1–2 are already committed on this branch and are baseline.
> Line numbers are confirmed against the worktree tip; re-confirm before editing (treat as navigation hints).

## Goal

Every visibility-transition side-effect that #757 introduced lives **only** in `AssetService.updateAll`
(`asset.service.ts:312-343`): `removeAssetsFromAll` on Locked, plus the six
`emitDirect/Album/LibraryAssetVisibilityPurge/Restore` emits. Three write paths bypass it and silently leak
bytes onto already-synced member devices:

1. The single-asset `PUT /assets/:id` (`update()`, `asset.service.ts:222-255`) writes `visibility` straight
   through `assetRepository.update({ id, ...rest })` — no tombstones, and Locked stays in the owner's albums.
2. The metadata motion-photo path (`metadata.service.ts:890-894` extraction-hide; `232` live-photo match)
   flips a motion video Timeline→Hidden without any space purge.
3. Every emit branches only on the **target** visibility, never the prior state → duplicate tombstones on
   re-hide and full fan-out on a no-op re-affirm (bulk favorite+visibility, unarchive).

And the album + direct purge tombstones are **not owner-gated** (the library arm already is) → the owner
receives a delete for their **own** hidden asset (over-purge, blocking the deferred "owner sees own" design).

The fix, in **green-between-commits** order:

- **Task 1 (security-4, pure refactor)** — extract `312-343` into a private helper
  `applyVisibilityTransitionSideEffects`, call it from `updateAll`. **Behaviour identical**, zero test churn.
- **Task 2 (security-4)** — call the helper from `update()` when `dto.visibility` is set (adds the Locked→
  `removeAssetsFromAll` + tombstones to the single path). Also the **correctness-6** no-transaction rationale
  comment.
- **Task 3 (motion-photo bypass)** — route the motion-photo hide/restore through the **existing `AssetHide`/
  `AssetShow` domain events** via new `@OnEvent` handlers on `AssetService`, and emit `AssetHide` from the one
  motion path that doesn't (`metadata.service.ts:891-894`).
- **Task 4 (correctness-8)** — the helper takes **prior** visibilities and emits **only for boundary-crossers**
  (shareable = Timeline/Archive; non-shareable = Hidden/Locked). Callers fetch priors before the write.
- **Task 5 (gaps-5)** — owner-gate the **album** + **direct** purge `getDeletes` arms (sync.repository.ts) to
  match the library arm.
- **Task 6** — full-suite validation.

## Architecture

- **Server** — NestJS 11 + Kysely. Services extend `BaseService`, which exposes
  `this.assetRepository`, `this.albumRepository`, `this.sharedSpaceRepository`, `this.eventRepository`.
- **The transition block is cleanly extractable.** `asset.service.ts:312-343` references only `visibility`,
  `ids`, `this.albumRepository`, `this.sharedSpaceRepository`, and `AssetVisibility` — no `updateAll`-only
  locals. It moves verbatim into a private helper.
- **The six emits are no-ops for non-shared assets** (verified): `emitDirectAssetVisibilityPurge` selects from
  `shared_space_asset` (empty for non-shared), `emitAlbumAssetVisibilityPurge` from `album_asset ⋈
shared_space_album` (empty), `emitLibraryAssetVisibilityPurge` from `asset WHERE libraryId IN
shared_space_library` (empty). `removeAssetsFromAll(ids)` removes the asset from **all** albums it is in —
  this is existing Immich Locked semantics and already runs in `updateAll`; routing `update()` through the
  helper simply extends it to the single-asset path (the **intended** security-4 fix).
- **Motion-photo fix = event handler, not direct call (justified).** `AssetHide`/`AssetShow`
  (`event.repository.ts:51-52`) are already emitted by the three live-photo/motion paths
  (`asset.util.ts:162` onBeforeLink, `asset.util.ts:187` onAfterUnlink, `metadata.service.ts:236`
  linkLivePhotos) and semantically **mean** "crossed the shareable boundary" (they fire only on a
  Timeline→Hidden / Hidden→visible flip). The review flagged that "nothing routes that [AssetHide] to the
  space purge." Adding one `@OnEvent('AssetHide')` + one `@OnEvent('AssetShow')` handler on `AssetService`
  fixes **all four** motion paths at once (the three that already emit + the extraction-hide path once it
  emits), where a direct helper call would fix only the sites we manually patch and duplicate the removal
  logic in `metadata.service`. The only motion path that does **not** yet emit is the extraction-hide at
  `metadata.service.ts:891-894` — add the emit there. The **created-Hidden** motion path
  (`metadata.service.ts:849-861`) needs **no** change: an asset created Hidden was never visible to any
  member, so there is nothing to purge. `classification.service` (Archive↔Timeline) and
  `trash.repository.restoreAll` never cross the shareable boundary → no change (state this).
- **gaps-5 owner-gate lives in the `getDeletes` read side, not the emit write side.** The emit methods take no
  `userId` and write one per-`(space/album, asset)` tombstone that must serve **all** members but not the
  owner; only `getDeletes` (which has `options.userId`) can express `asset.ownerId != userId`. This is exactly
  where the library arm carries it (`sync.repository.ts:1319`). So the emit methods
  (`shared-space.repository.ts` `emitDirectAssetVisibilityPurge` / `emitAlbumAssetVisibilityPurge`) are **not**
  changed — the fix is two `getDeletes` arms. **Divergence from the spec's phrasing** (which lists the emit
  methods): recorded and justified below.
- **INNER vs LEFT join (the key gaps-5 subtlety).** The **album** purge audit table
  `shared_space_album_asset_audit` is **purge-only** (no delete trigger — confirmed; only
  `emitAlbumAssetVisibilityPurge` writes it), so its arm can `innerJoin('asset')` + `asset.ownerId != userId`
  exactly like the library arm. The **direct** audit table `shared_space_asset_audit` is **dual-purpose**: it
  also receives tombstones from the `shared_space_asset_delete_audit` AFTER-DELETE trigger
  (`schema/functions.ts:354-364`, wired at `schema/tables/shared-space-asset.table.ts:18-23`), which fires on
  join-row deletion **including the FK cascade when the asset is physically deleted** (asset row gone). An
  `innerJoin('asset')` there would **drop physical-delete tombstones** (no asset row to join) → members never
  learn the asset was deleted. So the direct arm uses a **LEFT JOIN** + `(asset.ownerId IS NULL OR
asset.ownerId != userId)`: physical-delete tombstones (null owner) reach everyone; visibility-purge
  tombstones (asset still exists) exclude the owner. See the documented consequence in Task 5.

## Tech Stack

- Server unit: **vitest** via `newTestService()` auto-mocking (`test/utils.ts`), run with
  `cd server && pnpm test --run <path>` (NOT `pnpm test -- --run`).
- Server medium: **vitest** + real Postgres (testcontainers) via `newMediumService()`
  (`test/medium.factory.ts`), run `cd server && pnpm test:medium --run <path>`.
- e2e: API vitest + supertest (`e2e/`).
- Type/lint gate: `cd server && pnpm run check` (tsc --noEmit) and `cd server && pnpm run lint`
  (eslint `--max-warnings 0`).

## Global Constraints (from spec §0.3 + environment)

- **Docker is DOWN** — `pnpm test:medium` and the e2e API suite **cannot run locally**. The emit/tombstone/
  owner-gate/boundary-crossing behaviour on a real DB is **MEDIUM/e2e-tested and CI-deferred**. The primary
  **local** proof is the **unit** layer (`asset.service.spec.ts`, `metadata.service.spec.ts`) run red→green
  with mocked repos: helper invoked from `update()`/`updateAll()`/event handlers; boundary-crossing
  computation; no emit on no-op / Timeline↔Archive; Locked triggers `removeAssetsFromAll` once. Every
  CI-deferred test is **authored** and the step records the RED reasoning.
- **No Claude co-author trailers.** One commit per task (coherent fix-group); boundaries defined per task.
- **Never run `make sql` / migrations without a DB.** Task 5 touches `@GenerateSql`-decorated `getDeletes`
  methods, so `server/src/queries/sync.repository.sql` **will drift**; regen against a scratch migrated DB is
  **CI/DB-deferred before merge** and does not fail `pnpm run check`/`lint`. No new repo method is added
  (`assetRepository.getByIds` already exists and returns `visibility`), so **no additional** SQL-doc drift
  from the prior-fetch.
- **No DTO/endpoint shape change** in this slice → **no SDK/OpenAPI regen**. (If `@immich/plugin-sdk` dist is
  missing and a build fails to resolve it, run
  `pnpm --filter @immich/sdk build && pnpm --filter @immich/plugin-sdk build`.)
- **Kysely:** never issue `this.db` queries inside a `transaction()` callback — this is exactly why
  correctness-6 does **not** wrap the transition in a transaction (the UPDATE + `removeAssetsFromAll` + emits
  each run on a different repo's `this.db`; a single `transaction()` would deadlock the pool, #595). Resilience
  is ordering + idempotent tombstones (correctness-8 makes re-emit safe).

---

## Task 1 — security-4 (pure refactor): extract `applyVisibilityTransitionSideEffects`, call from `updateAll`

**Closes the structural half of security-4.** Extract the transition block verbatim into a private helper and
call it from `updateAll`. **No behaviour change** — `updateAll` stays byte-identical, so every existing
`updateAll` emit test passes unchanged (zero churn). This is the safe base the behavioural tasks build on.

**Unit-testable and locally runnable. This task adds no new tests** — its correctness is proven by the
**existing** `updateAll` suite staying green.

### Files

- `server/src/services/asset.service.ts` — extract helper; replace `312-343` with a single call.
- `server/src/services/asset.service.spec.ts` — **no change** (existing tests must stay green as the proof).

### Interfaces

```ts
private async applyVisibilityTransitionSideEffects(ids: string[], visibility: AssetVisibility): Promise<void>
```

Contains, in the current order: `removeAssetsFromAll` on Locked → direct purge/restore → album purge/restore
→ library purge. Idempotent and safe to re-run (see the correctness-6 comment added in Task 2).

### Steps

- [ ] **Add the private helper** to `AssetService` (place it directly after `updateAll`, before `copy`),
      moving the block from `asset.service.ts:312-343` **verbatim** (comments included):

  ```ts
  private async applyVisibilityTransitionSideEffects(ids: string[], visibility: AssetVisibility): Promise<void> {
    if (visibility === AssetVisibility.Locked) {
      await this.albumRepository.removeAssetsFromAll(ids);
    }

    // Slice 4.B DIRECT-path purge/restore (see updateAll history).
    if (visibility === AssetVisibility.Hidden || visibility === AssetVisibility.Locked) {
      await this.sharedSpaceRepository.emitDirectAssetVisibilityPurge(ids);
    } else if (visibility === AssetVisibility.Timeline || visibility === AssetVisibility.Archive) {
      await this.sharedSpaceRepository.emitDirectAssetVisibilityRestore(ids);
    }

    // Slice 1 ALBUM-path purge/restore. Locked is covered by removeAssetsFromAll above.
    if (visibility === AssetVisibility.Hidden) {
      await this.sharedSpaceRepository.emitAlbumAssetVisibilityPurge(ids);
    } else if (visibility === AssetVisibility.Timeline || visibility === AssetVisibility.Archive) {
      await this.sharedSpaceRepository.emitAlbumAssetVisibilityRestore(ids);
    }

    // Slice 2 LIBRARY-path purge. Restore is automatic (the visibility UPDATE bumps asset.updateId).
    if (visibility === AssetVisibility.Hidden || visibility === AssetVisibility.Locked) {
      await this.sharedSpaceRepository.emitLibraryAssetVisibilityPurge(ids);
    }
  }
  ```

- [ ] **Replace `updateAll`'s block** (`asset.service.ts:312-343`) with a single guarded call, immediately
      after `if (Object.keys(assetDto).length > 0) { await this.assetRepository.updateAll(...) }` (`308-310`):

  ```ts
  if (visibility !== undefined) {
    await this.applyVisibilityTransitionSideEffects(ids, visibility);
  }
  ```

  > Byte-identical: when `visibility` is `undefined` the old block fired no branch and `removeAssetsFromAll`
  > did not run; the guard reproduces that exactly. When set, the helper runs the same four blocks in the same
  > order on the same `ids`.

- [ ] **Run**: `cd server && pnpm test --run src/services/asset.service.spec.ts`. Expected **GREEN** — every
      existing `updateAll` test (lines 1019-1143: `removeAssetsFromAll`, direct/album/library purge/restore
      dispatch, "not touched when visibility not provided") passes **unchanged**. This green-with-no-churn run
      **is** the refactor's proof.

- [ ] **Local gate**: `cd server && pnpm run check` then `cd server && pnpm run lint`. Expected **GREEN**.

- [ ] **Commit**:
      `git add server/src/services/asset.service.ts`
      `git commit -m "refactor(spaces): extract applyVisibilityTransitionSideEffects from updateAll (security-4)"`

---

## Task 2 — security-4: call the helper from `update()` (single-asset PUT) + correctness-6 comment

**Closes the behavioural half of security-4 for the single endpoint** and documents **correctness-6**. The
single-asset `PUT /assets/:id` (`update()`, `asset.service.ts:222-255`) writes `visibility` straight through
and skips the transition entirely. Route it through the helper when `dto.visibility` is set — this **adds**
Locked→`removeAssetsFromAll` and the tombstones to the single path (the intended fix). Safe for non-shared
assets: the emits are no-ops (Architecture) and `removeAssetsFromAll` matches existing bulk behaviour.

**Unit-testable — runs locally red→green.** e2e (byte-for-byte parity with the bulk path) authored, CI-deferred.

### Files

- `server/src/services/asset.service.ts` — one call in `update()`; correctness-6 doc comment on the helper.
- `server/src/services/asset.service.spec.ts` — new tests in `describe('update')`.
- `e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts` — new "single endpoint == bulk"
  block (CI-deferred).

### Interfaces

- `AssetService.update(auth, id, dto)` — unchanged signature; now runs the transition side-effects when
  `dto.visibility` is present.

### Steps

- [ ] **Write the failing unit tests** in `asset.service.spec.ts`, appended to `describe('update')`
      (after the geocode test, ~line 880). The `update` beforeEach already resolves the emit mocks (lines
      47-53) and the access check; mock `getById` + `update` to return the asset:

  ```ts
  it('purges direct/album/library space paths when a single PUT sets visibility Hidden (security-4)', async () => {
    const asset = AssetFactory.create({ visibility: AssetVisibility.Timeline });
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(asset);
    mocks.asset.update.mockResolvedValue({ ...asset, visibility: AssetVisibility.Hidden });

    await sut.update(AuthFactory.create({ id: asset.ownerId }), asset.id, { visibility: AssetVisibility.Hidden });

    expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).toHaveBeenCalledWith([asset.id]);
    expect(mocks.sharedSpace.emitAlbumAssetVisibilityPurge).toHaveBeenCalledWith([asset.id]);
    expect(mocks.sharedSpace.emitLibraryAssetVisibilityPurge).toHaveBeenCalledWith([asset.id]);
    expect(mocks.album.removeAssetsFromAll).not.toHaveBeenCalled();
  });

  it('removes from all albums AND purges when a single PUT sets visibility Locked (security-4)', async () => {
    const asset = AssetFactory.create({ visibility: AssetVisibility.Timeline });
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(asset);
    mocks.asset.update.mockResolvedValue({ ...asset, visibility: AssetVisibility.Locked });

    await sut.update(AuthFactory.create({ id: asset.ownerId }), asset.id, { visibility: AssetVisibility.Locked });

    expect(mocks.album.removeAssetsFromAll).toHaveBeenCalledWith([asset.id]);
    expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).toHaveBeenCalledWith([asset.id]);
    expect(mocks.sharedSpace.emitLibraryAssetVisibilityPurge).toHaveBeenCalledWith([asset.id]);
    expect(mocks.sharedSpace.emitAlbumAssetVisibilityPurge).not.toHaveBeenCalled(); // Locked → removeAssetsFromAll covers albums
  });

  it('restores direct/album space paths when a single PUT sets visibility Timeline (security-4)', async () => {
    const asset = AssetFactory.create({ visibility: AssetVisibility.Hidden });
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(asset);
    mocks.asset.update.mockResolvedValue({ ...asset, visibility: AssetVisibility.Timeline });

    await sut.update(AuthFactory.create({ id: asset.ownerId }), asset.id, { visibility: AssetVisibility.Timeline });

    expect(mocks.sharedSpace.emitDirectAssetVisibilityRestore).toHaveBeenCalledWith([asset.id]);
    expect(mocks.sharedSpace.emitAlbumAssetVisibilityRestore).toHaveBeenCalledWith([asset.id]);
    expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).not.toHaveBeenCalled();
  });

  it('does not run any visibility transition when a single PUT omits visibility (security-4)', async () => {
    const asset = AssetFactory.create();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
    mocks.asset.getById.mockResolvedValue(asset);
    mocks.asset.update.mockResolvedValue({ ...asset, isFavorite: true });

    await sut.update(AuthFactory.create({ id: asset.ownerId }), asset.id, { isFavorite: true });

    expect(mocks.album.removeAssetsFromAll).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.emitDirectAssetVisibilityRestore).not.toHaveBeenCalled();
  });
  ```

  > The `getById` mock is unused by the naive helper in this task but is **forward-compatible** with Task 4,
  > where `update()` reads the prior visibility from it — so these tests survive Task 4 unchanged.

- [ ] **Run**: `cd server && pnpm test --run src/services/asset.service.spec.ts`. Expected **RED** on the first
      three new tests — current `update()` never calls the helper, so no emit / `removeAssetsFromAll` fires.
      The fourth ("omits visibility") passes already.

- [ ] **Implement the call** in `update()` (`asset.service.ts:222-255`). After the `if (!asset) { throw ... }`
      guard (line 252) and before `return mapAsset(asset, { auth })` (line 254), insert:

  ```ts
  // security-4: the single-asset PUT previously wrote `visibility` straight through, skipping every
  // #757 transition side-effect the bulk path runs — member devices kept hidden/locked bytes forever and
  // Locked assets stayed in the owner's albums. Route it through the same helper so a single PUT is
  // byte-for-byte equivalent to a one-id bulk update. No-op for non-space assets (the emits match nothing).
  if (dto.visibility !== undefined) {
    await this.applyVisibilityTransitionSideEffects([id], dto.visibility);
  }
  ```

- [ ] **Add the correctness-6 rationale** as a doc comment on `applyVisibilityTransitionSideEffects` (from
      Task 1):

  ```ts
  /**
   * Runs every #757 visibility-transition side-effect (removeAssetsFromAll on Locked + the direct/album/
   * library space purge/restore emits). Shared by updateAll (bulk), update (single) and the AssetHide/
   * AssetShow event handlers (motion photos).
   *
   * correctness-6 — NOT wrapped in a Kysely transaction: the UPDATE, removeAssetsFromAll and each emit run
   * on a DIFFERENT repository's own `this.db` handle, so a single `transaction()` would hit the
   * `this.db`-inside-`transaction()` pool deadlock (#595). Resilience instead comes from (a) idempotent
   * tombstones — re-running emits the same audit rows harmlessly (Task 4's boundary-crossing check makes a
   * re-affirm a genuine no-op), and (b) a re-flip re-emitting the tombstone. A crash between the UPDATE and
   * the emits therefore leaves a RECOVERABLE state (re-run converges), not a corrupted one. A periodic
   * reconciliation sweep (grants/tombstones vs. live rows) is a possible follow-up; not required here.
   */
  ```

- [ ] **Run**: `cd server && pnpm test --run src/services/asset.service.spec.ts`. Expected **GREEN** (four new
      tests + all existing update/updateAll tests).

- [ ] **Write the CI-deferred e2e** in `shared-space-visibility-negatives.e2e-spec.ts`, appended as a new
      `describe` (reuse the module's space+member+link helpers; compare the single endpoint against the bulk
      endpoint tombstone):

  ```ts
  describe('PUT /assets/:id visibility — single endpoint emits the same purge as bulk (security-4)', () => {
    it('single PUT {visibility:hidden} tombstones an album-linked asset for a synced member, same as bulk', async () => {
      // owner uploads A, links an album containing A into a space with a synced Viewer member, syncs once.
      // Then: PUT /assets/:A {visibility:hidden} (single) and assert the member's /sync delete stream carries
      // the same (albumId, A) tombstone as PUT /assets {ids:[A], visibility:hidden} does for a sibling B.
      // Assert byte-for-byte: same delete type, same assetId shape.
    });
    it('single PUT {visibility:locked} removes A from ALL the owner albums AND tombstones it (security-4)', async () => {
      // after the single PUT locked, GET /albums/:id no longer lists A; member /sync receives the delete.
    });
  });
  ```

- [ ] **Run (CI-deferred)**: `cd e2e && pnpm test -- shared-space-visibility-negatives`. Record: "Docker down —
      deferred to CI; RED reasoning: pre-fix `update()` writes visibility without emitting any tombstone."

- [ ] **Local gate**: `cd server && pnpm run check` then `cd server && pnpm run lint`. Expected **GREEN**.

- [ ] **Commit**:
      `git add server/src/services/asset.service.ts server/src/services/asset.service.spec.ts e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts`
      `git commit -m "fix(spaces): route single-asset visibility PUT through the space purge helper (security-4)"`

---

## Task 3 — motion-photo bypass: route AssetHide/AssetShow to the space purge

**Closes the confirmed metadata motion-photo bypass writer.** Add `@OnEvent('AssetHide')` /
`@OnEvent('AssetShow')` handlers on `AssetService` that delegate to the helper, and emit `AssetHide` from the
one motion path that doesn't (`metadata.service.ts:891-894`). This routes all four motion flows
(onBeforeLink, onAfterUnlink, linkLivePhotos, extraction-hide) through the space purge. The created-Hidden
path (`849-861`) is left untouched (never visible → nothing to purge).

**Unit-testable — runs locally red→green.** Both the handler (asset.service.spec) and the new emit
(metadata.service.spec) are unit-provable; `eventRepository.emit` is mocked in unit tests, so the handler is
tested by calling it directly.

### Files

- `server/src/services/asset.service.ts` — imports + two `@OnEvent` handlers.
- `server/src/services/asset.service.spec.ts` — handler unit tests.
- `server/src/services/metadata.service.ts` — emit `AssetHide` at the extraction-hide path.
- `server/src/services/metadata.service.spec.ts` — assert the extraction-hide emit.

### Interfaces

```ts
@OnEvent({ name: 'AssetHide' }) async onAssetHide({ assetId }: ArgOf<'AssetHide'>): Promise<void>
@OnEvent({ name: 'AssetShow' }) async onAssetShow({ assetId }: ArgOf<'AssetShow'>): Promise<void>
```

Both delegate to `applyVisibilityTransitionSideEffects` — `AssetHide` with `Hidden`, `AssetShow` with
`Timeline`. `AssetHide`/`AssetShow` fire **only** on a genuine boundary crossing, so no prior-diffing is
needed (in Task 4 the handlers pass a **synthetic** prior to keep the same helper signature — see there).

### Steps

- [ ] **Write the failing handler unit tests** in `asset.service.spec.ts`, as a new
      `describe('onAssetHide / onAssetShow')` block:

  ```ts
  describe('onAssetHide / onAssetShow', () => {
    it('purges direct/album/library space paths when a motion asset is hidden (motion bypass)', async () => {
      const assetId = newUuid();
      await sut.onAssetHide({ assetId, userId: newUuid() });
      expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).toHaveBeenCalledWith([assetId]);
      expect(mocks.sharedSpace.emitAlbumAssetVisibilityPurge).toHaveBeenCalledWith([assetId]);
      expect(mocks.sharedSpace.emitLibraryAssetVisibilityPurge).toHaveBeenCalledWith([assetId]);
    });

    it('restores direct/album space paths when a motion asset is shown again (motion bypass)', async () => {
      const assetId = newUuid();
      await sut.onAssetShow({ assetId, userId: newUuid() });
      expect(mocks.sharedSpace.emitDirectAssetVisibilityRestore).toHaveBeenCalledWith([assetId]);
      expect(mocks.sharedSpace.emitAlbumAssetVisibilityRestore).toHaveBeenCalledWith([assetId]);
      expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Run**: `cd server && pnpm test --run src/services/asset.service.spec.ts`. Expected **RED** —
      `sut.onAssetHide` / `sut.onAssetShow` do not exist.

- [ ] **Implement the handlers** in `asset.service.ts`. Extend the decorators import (line 9) and add the
      event-arg import (after line 46):

  ```ts
  import { OnEvent, OnJob } from 'src/decorators';
  import { ArgOf } from 'src/repositories/event.repository';
  ```

  Add the two handlers (place near `update`):

  ```ts
  // Motion-photo bypass: the live-photo/motion paths (asset.util onBeforeLink/onAfterUnlink,
  // metadata linkLivePhotos, metadata extraction-hide) flip a motion video's visibility directly and emit
  // AssetHide/AssetShow — but nothing routed those to the #757 space purge, so a motion video in a
  // space-linked library kept its bytes on member devices. AssetHide/AssetShow fire only on a genuine
  // Timeline↔Hidden crossing, so we run the same transition side-effects for the single asset.
  @OnEvent({ name: 'AssetHide' })
  async onAssetHide({ assetId }: ArgOf<'AssetHide'>): Promise<void> {
    await this.applyVisibilityTransitionSideEffects([assetId], AssetVisibility.Hidden);
  }

  @OnEvent({ name: 'AssetShow' })
  async onAssetShow({ assetId }: ArgOf<'AssetShow'>): Promise<void> {
    await this.applyVisibilityTransitionSideEffects([assetId], AssetVisibility.Timeline);
  }
  ```

  > `notification.service` already has `@OnEvent('AssetHide')`/`@OnEvent('AssetShow')` handlers; the event bus
  > dispatches to all handlers, so a second pair on `AssetService` is fine. No double emit vs. Task 2:
  > `update()`/`updateAll()` do not emit `AssetHide`/`AssetShow` for a `dto.visibility` change (those events
  > come only from the live-photo/motion util paths), so the two routes are disjoint.

- [ ] **Write the failing metadata emit test** by extending `metadata.service.spec.ts` line 1302
      ("should link and hide motion video asset…"), adding after the existing `mocks.asset.update` assertions
      (~line 1326):

  ```ts
  expect(mocks.event.emit).toHaveBeenCalledWith('AssetHide', {
    assetId: motionAsset.id,
    userId: motionAsset.ownerId,
  });
  ```

- [ ] **Run**: `cd server && pnpm test --run src/services/metadata.service.spec.ts`. Expected **RED** — the
      extraction-hide path (`metadata.service.ts:890-896`) does not emit `AssetHide`.

- [ ] **Implement the emit** in `metadata.service.ts`. Inside the `if (motionAsset.visibility ===
AssetVisibility.Timeline)` block (`890-896`), after the `assetRepository.update(...)` / log line:

  ```ts
  await this.eventRepository.emit('AssetHide', { assetId: motionAsset.id, userId: motionAsset.ownerId });
  ```

  > Do **not** touch the created-Hidden path (`849-861`) — a motion asset created Hidden was never visible to
  > any space member, so there is nothing to tombstone. `linkLivePhotos` (`232-236`) already emits AssetHide
  > and is now fixed for free by the handler.

- [ ] **Run**: `cd server && pnpm test --run src/services/asset.service.spec.ts src/services/metadata.service.spec.ts`.
      Expected **GREEN** (handlers + metadata emit; existing motion tests unaffected).

- [ ] **Local gate**: `cd server && pnpm run check` then `cd server && pnpm run lint`. Expected **GREEN**.

- [ ] **Commit**:
      `git add server/src/services/asset.service.ts server/src/services/asset.service.spec.ts server/src/services/metadata.service.ts server/src/services/metadata.service.spec.ts`
      `git commit -m "fix(spaces): route motion-photo AssetHide/AssetShow through the space purge (motion bypass)"`

---

## Task 4 — correctness-8: emit only for boundary-crossers (state-diff on prior visibility)

**Closes correctness-8.** Today every emit branches solely on the **target** visibility → re-hiding an
already-Hidden asset writes a duplicate tombstone, and a bulk `favorite + visibility` re-affirm (or an
`unarchive`) fans a full purge/restore out over every join row. Fix: the helper takes each asset's **prior**
visibility and emits only for assets that actually cross the shareable boundary (shareable = Timeline/Archive;
non-shareable = Hidden/Locked). Callers fetch priors **before** the UPDATE; the event handlers pass a
**synthetic** prior (the event itself is the crossing).

**Unit-testable — runs locally red→green.** Extends the existing `updateAll` emit tests (which now must seed a
prior) and adds the no-op cases. Medium DB-level boundary assertions authored, CI-deferred.

### Files

- `server/src/services/asset.service.ts` — helper signature `+ priorVisibilities`; `updateAll`/`update`/both
  handlers fetch/pass priors.
- `server/src/services/asset.service.spec.ts` — seed `getByIds`/`getById` priors in existing emit tests; add
  no-op tests.
- `server/test/medium/specs/sync/sync-space-visibility-purge-cross-path.spec.ts` — boundary-crossing DB
  assertions (CI-deferred).

### Interfaces

```ts
private async applyVisibilityTransitionSideEffects(
  ids: string[],
  nextVisibility: AssetVisibility,
  priorVisibilities: Map<string, AssetVisibility | undefined>,
): Promise<void>
```

**Prior fetch (no new repo method).** `updateAll` bulk-fetches via the existing
`assetRepository.getByIds(ids)` (`asset.repository.ts:881`, returns full rows incl. `visibility`,
`@ChunkedArray` so large id-sets are safe) **before** `assetRepository.updateAll` writes. `update()`
fetches the single prior via the existing `assetRepository.getById(id)` **before** `assetRepository.update`.
The handlers build a synthetic one-entry map. **No `@GenerateSql` method is added → no extra SQL-doc drift.**

### Steps

- [ ] **Rewrite the helper body** to diff prior→next (keep the correctness-6 comment; keep the
      removeAssetsFromAll-first order):

  ```ts
  private async applyVisibilityTransitionSideEffects(
    ids: string[],
    nextVisibility: AssetVisibility,
    priorVisibilities: Map<string, AssetVisibility | undefined>,
  ): Promise<void> {
    const shareable = (v: AssetVisibility | undefined) =>
      v === AssetVisibility.Timeline || v === AssetVisibility.Archive;

    if (nextVisibility === AssetVisibility.Timeline || nextVisibility === AssetVisibility.Archive) {
      // Restore: only assets whose PRIOR was non-shareable (Hidden/Locked) cross back in. A shareable→
      // shareable move (e.g. Timeline↔Archive, unarchive re-affirm) is not a crossing → no emit.
      const restoreIds = ids.filter((id) => !shareable(priorVisibilities.get(id)));
      if (restoreIds.length > 0) {
        await this.sharedSpaceRepository.emitDirectAssetVisibilityRestore(restoreIds);
        await this.sharedSpaceRepository.emitAlbumAssetVisibilityRestore(restoreIds);
        // Library restore is automatic (the visibility UPDATE bumped asset.updateId) — no emit.
      }
      return;
    }

    // nextVisibility is non-shareable (Hidden or Locked).
    if (nextVisibility === AssetVisibility.Locked) {
      // Strip album membership exactly once — skip assets already Locked (re-lock = no-op).
      const lockIds = ids.filter((id) => priorVisibilities.get(id) !== AssetVisibility.Locked);
      if (lockIds.length > 0) {
        await this.albumRepository.removeAssetsFromAll(lockIds);
      }
    }

    // Purge: only assets whose PRIOR was shareable cross out. Re-hide (Hidden→Hidden), Hidden→Locked and
    // Locked→Hidden are non-shareable→non-shareable → no duplicate purge (already purged when first hidden).
    const purgeIds = ids.filter((id) => shareable(priorVisibilities.get(id)));
    if (purgeIds.length > 0) {
      await this.sharedSpaceRepository.emitDirectAssetVisibilityPurge(purgeIds);
      if (nextVisibility === AssetVisibility.Hidden) {
        // Locked's album removal is handled by removeAssetsFromAll above → no album tombstone for Locked.
        await this.sharedSpaceRepository.emitAlbumAssetVisibilityPurge(purgeIds);
      }
      await this.sharedSpaceRepository.emitLibraryAssetVisibilityPurge(purgeIds);
    }
  }
  ```

- [ ] **Update `updateAll`** to fetch priors before the write. Immediately before
      `if (Object.keys(assetDto).length > 0) { await this.assetRepository.updateAll(ids, assetDto); }`
      (`asset.service.ts:308`), capture priors only when a visibility change is requested; then pass them:

  ```ts
  const priorVisibilities =
    visibility !== undefined
      ? new Map((await this.assetRepository.getByIds(ids)).map((a) => [a.id, a.visibility]))
      : new Map<string, AssetVisibility>();
  ```

  and change the guarded call (added in Task 1) to:

  ```ts
  if (visibility !== undefined) {
    await this.applyVisibilityTransitionSideEffects(ids, visibility, priorVisibilities);
  }
  ```

- [ ] **Update `update()`** to fetch the single prior before the write. Before
      `const asset = await this.assetRepository.update({ id, ...rest });` (line 240), add:

  ```ts
  const priorVisibility =
    dto.visibility !== undefined ? (await this.assetRepository.getById(id))?.visibility : undefined;
  ```

  and change the Task 2 call to:

  ```ts
  if (dto.visibility !== undefined) {
    await this.applyVisibilityTransitionSideEffects([id], dto.visibility, new Map([[id, priorVisibility]]));
  }
  ```

- [ ] **Update both event handlers** to pass a synthetic prior (the event is the crossing):

  ```ts
  @OnEvent({ name: 'AssetHide' })
  async onAssetHide({ assetId }: ArgOf<'AssetHide'>): Promise<void> {
    // AssetHide fires only on Timeline→Hidden → seed a shareable prior so it registers as a crossing.
    await this.applyVisibilityTransitionSideEffects([assetId], AssetVisibility.Hidden, new Map([[assetId, AssetVisibility.Timeline]]));
  }

  @OnEvent({ name: 'AssetShow' })
  async onAssetShow({ assetId }: ArgOf<'AssetShow'>): Promise<void> {
    await this.applyVisibilityTransitionSideEffects([assetId], AssetVisibility.Timeline, new Map([[assetId, AssetVisibility.Hidden]]));
  }
  ```

- [ ] **Seed priors in the existing `updateAll`/`update` emit tests** (behavioural change → expected churn).
      For each existing **purge** assertion (Hidden/Locked; `asset.service.spec.ts:1041-1051, 1075-1082,
1115-1124`) add a shareable prior before the call:
      `mocks.asset.getByIds.mockResolvedValue([{ id: 'asset-1', visibility: AssetVisibility.Timeline } as any]);`
      For each existing **restore** assertion (Timeline/Archive; `1053-1063, 1093-1103`) add a non-shareable
      prior:
      `mocks.asset.getByIds.mockResolvedValue([{ id: 'asset-1', visibility: AssetVisibility.Hidden } as any]);`
      The Task 2/3 tests already mock `getById` with a crossing prior and need no change. (The
      "visibility not provided" tests never call the helper — `getByIds` returns the empty default, fine.)

- [ ] **Add the no-op / mixed-bulk tests** in `describe('updateAll')`:

  ```ts
  it('does NOT re-purge an already-Hidden asset (correctness-8 idempotency)', async () => {
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
    mocks.asset.getByIds.mockResolvedValue([{ id: 'asset-1', visibility: AssetVisibility.Hidden } as any]);
    await sut.updateAll(authStub.admin, { ids: ['asset-1'], visibility: AssetVisibility.Hidden });
    expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.emitAlbumAssetVisibilityPurge).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.emitLibraryAssetVisibilityPurge).not.toHaveBeenCalled();
  });

  it('does NOT purge or restore on a Timeline→Archive move (both shareable, correctness-8)', async () => {
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
    mocks.asset.getByIds.mockResolvedValue([{ id: 'asset-1', visibility: AssetVisibility.Timeline } as any]);
    await sut.updateAll(authStub.admin, { ids: ['asset-1'], visibility: AssetVisibility.Archive });
    expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.emitDirectAssetVisibilityRestore).not.toHaveBeenCalled();
  });

  it('emits only for boundary-crossers in a mixed bulk favorite+visibility flip (correctness-8)', async () => {
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1', 'asset-2']));
    // asset-1 crosses Timeline→Hidden; asset-2 was already Hidden (no-op).
    mocks.asset.getByIds.mockResolvedValue([
      { id: 'asset-1', visibility: AssetVisibility.Timeline } as any,
      { id: 'asset-2', visibility: AssetVisibility.Hidden } as any,
    ]);
    await sut.updateAll(authStub.admin, {
      ids: ['asset-1', 'asset-2'],
      isFavorite: true,
      visibility: AssetVisibility.Hidden,
    });
    expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).toHaveBeenCalledWith(['asset-1']);
    expect(mocks.sharedSpace.emitAlbumAssetVisibilityPurge).toHaveBeenCalledWith(['asset-1']);
  });

  it('removes from albums exactly once and skips a re-lock (correctness-8)', async () => {
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
    mocks.asset.getByIds.mockResolvedValue([{ id: 'asset-1', visibility: AssetVisibility.Locked } as any]);
    await sut.updateAll(authStub.admin, { ids: ['asset-1'], visibility: AssetVisibility.Locked });
    expect(mocks.album.removeAssetsFromAll).not.toHaveBeenCalled(); // already Locked → no-op
    expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).not.toHaveBeenCalled();
  });
  ```

- [ ] **Run**: `cd server && pnpm test --run src/services/asset.service.spec.ts`. Expected **RED first** on the
      new no-op tests against a naive (pre-diff) helper if run before the impl; **GREEN** after the helper
      rewrite + seeded priors. Confirm the whole `asset.service.spec.ts` passes.

- [ ] **Author the CI-deferred medium boundary assertions** in
      `sync-space-visibility-purge-cross-path.spec.ts`: (a) re-hide an already-Hidden direct/album asset →
      **zero** new `shared_space_asset_audit` / `shared_space_album_asset_audit` rows; (b) Timeline→Archive →
      no new tombstone; (c) a mixed bulk where one asset crosses and one is already Hidden → exactly one new
      tombstone. Record RED reasoning (current code writes a duplicate on re-hide).

- [ ] **Run (CI-deferred)**: `cd server && pnpm test:medium --run test/medium/specs/sync/sync-space-visibility-purge-cross-path.spec.ts`.

- [ ] **Local gate**: `cd server && pnpm run check` then `cd server && pnpm run lint`. Expected **GREEN**.

- [ ] **Commit**:
      `git add server/src/services/asset.service.ts server/src/services/asset.service.spec.ts server/test/medium/specs/sync/sync-space-visibility-purge-cross-path.spec.ts`
      `git commit -m "fix(spaces): emit visibility purge/restore only for boundary-crossers (correctness-8)"`

---

## Task 5 — gaps-5: owner-gate the album + direct purge delete streams

**Closes gaps-5.** The library purge arm is owner-gated (`sync.repository.ts:1319`
`asset.ownerId != userId`); the **album** (`SharedSpaceAlbumToAssetSync.getDeletes` spaceAlbumAssetArm,
`sync.repository.ts:1563-1568`) and **direct** (`SharedSpaceToAssetSync.getDeletes`, `1121-1127`) arms are not
→ the **owner** receives a delete for their **own** hidden asset (over-purge; blocks the deferred "owner sees
own hidden" design). Add the owner-gate to both, matching the library arm. **Not a byte leak** — over-purge
prevention.

**Fix is in `getDeletes` (read side), not the emit methods** — only `getDeletes` has `options.userId` (see
Architecture; this is a documented divergence from the spec's phrasing, which also names the emit methods).

**Pure SQL predicate change → not unit-testable. Medium + e2e authored, CI-deferred. Local proof = `check` +
`lint`.**

### Files

- `server/src/repositories/sync.repository.ts` — album arm (inner join) + direct arm (left join).
- `server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts` — album owner-exclusion test.
- `server/test/medium/specs/sync/sync-shared-space-visibility-purge.spec.ts` — direct owner-exclusion test +
  physical-delete regression.
- `e2e/src/specs/server/api/sync-shared-space.e2e-spec.ts` — owner-gate seam assertion (CI-deferred).

### Interfaces

- `SharedSpaceAlbumToAssetSync.getDeletes(options)` / `SharedSpaceToAssetSync.getDeletes(options)` — unchanged
  signatures; the space-purge arm now excludes the requesting owner.

### Steps

- [ ] **Author the album medium test** in `sync-shared-space-album-visibility-purge.spec.ts`, extending the
      existing `describe('SharedSpaceAlbumToAssetSync — album visibility purge/restore')` (its
      `seed...` helper already takes a distinct `memberId`):

  ```ts
  it('A6: owner does NOT receive a delete for their OWN album-linked asset flipped to Hidden (gaps-5)', async () => {
    // space owner = asset owner; a Viewer member is also synced. Flip A to Hidden, ack past, re-sync.
    // Assert: the MEMBER's getDeletes contains (albumId, A); the OWNER's getDeletes does NOT.
  });
  ```

- [ ] **Author the direct medium tests** in `sync-shared-space-visibility-purge.spec.ts`:

  ```ts
  it('owner does NOT receive a delete for their OWN direct asset flipped to Hidden (gaps-5)', async () => {
    // owner's getDeletes excludes the purge tombstone for their own asset; a member's includes it.
  });
  it('a PHYSICAL asset delete still reaches the owner via getDeletes (LEFT JOIN null-owner regression)', async () => {
    // hard-delete the asset (cascade fires shared_space_asset_delete_audit; asset row gone) → the owner's
    // getDeletes STILL carries the delete (asset.ownerId IS NULL passes the gate). Proves the LEFT JOIN
    // does not drop physical-delete tombstones.
  });
  ```

- [ ] **Run (CI-deferred)**:
      `cd server && pnpm test:medium --run test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts test/medium/specs/sync/sync-shared-space-visibility-purge.spec.ts`.
      RED reasoning: current arms have no owner filter → the owner receives their own purge tombstone.

- [ ] **Implement the album arm** (`sync.repository.ts:1563-1568`). `shared_space_album_asset_audit` is
      purge-only (no delete trigger) so `innerJoin('asset')` is safe; qualify the ambiguous `id` select:

  ```ts
  const spaceAlbumAssetArm = this.db
    .selectFrom('shared_space_album_asset_audit')
    // gaps-5: owner-gate the album visibility-purge arm to match the library arm — the album owner must
    // never receive a delete for their OWN hidden asset (over-purge). This table is purge-only (no delete
    // trigger), so the asset row always exists → a plain INNER JOIN is correct.
    .innerJoin('asset', 'asset.id', 'shared_space_album_asset_audit.assetId')
    .select([
      'shared_space_album_asset_audit.id as id',
      'shared_space_album_asset_audit.assetId as assetId',
      'shared_space_album_asset_audit.albumId as albumId',
    ])
    .where('shared_space_album_asset_audit.id', '<', nowId)
    .$if(!!ack, (qb) => qb.where('shared_space_album_asset_audit.id', '>', ack!.updateId))
    .where('shared_space_album_asset_audit.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
    .where('asset.ownerId', '!=', userId);
  ```

  > `albumAssetArm` (the `album_asset_audit` physical-removal arm, `1556-1561`) is **left unchanged** — a
  > physical album removal is a real delete everyone (owner included) should receive.

- [ ] **Implement the direct arm** (`sync.repository.ts:1121-1127`). `shared_space_asset_audit` is
      **dual-purpose** (delete-audit trigger + visibility purge), so use a **LEFT JOIN** and a null-owner
      disjunct; qualify the ambiguous `id` select:

  ```ts
    getDeletes(options: SyncQueryOptions) {
      return this.auditQuery('shared_space_asset_audit', options)
        // gaps-5: owner-gate the visibility-purge tombstones (owner must not lose their OWN hidden asset).
        // shared_space_asset_audit is DUAL-PURPOSE — it also receives physical/link-delete tombstones from
        // the shared_space_asset_delete_audit trigger, whose asset row may be GONE (FK cascade on asset
        // delete). A LEFT JOIN keeps those (asset.ownerId IS NULL → delivered to everyone incl. the owner);
        // visibility-purge tombstones (asset still exists) exclude the owner via ownerId != userId.
        .leftJoin('asset', 'asset.id', 'shared_space_asset_audit.assetId')
        .select([
          'shared_space_asset_audit.id as id',
          'shared_space_asset_audit.assetId as assetId',
          'shared_space_asset_audit.spaceId as spaceId',
        ])
        .where('shared_space_asset_audit.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
        .where((eb) => eb.or([eb('asset.ownerId', 'is', null), eb('asset.ownerId', '!=', options.userId)]))
        .stream();
    }
  ```

  > **Accepted consequence (documented):** with the asset still present, the owner is also excluded from a
  > direct _unlink_-of-own-asset delete on this arm (the dual-purpose table cannot distinguish unlink from
  > visibility-purge without a discriminator column, which is a migration → out of Slice-3 scope). This is
  > minor and aligns with the deferred "owner sees own" direction: the owner initiated the unlink (client
  > already updated) and a full backfill reconciles; **members still receive** the delete, and **physical**
  > deletes still reach everyone (null-owner disjunct). A clean split (discriminator column) is a follow-up
  > for the migration slices.

- [ ] **Author the CI-deferred e2e** in `sync-shared-space.e2e-spec.ts`: HTTP hide of an owner's own
      space-linked asset → the owner's `/sync` does **not** carry the purge delete, a member's does; a
      physical delete reaches both. Record RED reasoning.

- [ ] **Local gate**: `cd server && pnpm run check` then `cd server && pnpm run lint`. Expected **GREEN**.

- [ ] **Commit** (record the `sync.repository.sql` DB-deferred regen in the body):
      `git add server/src/repositories/sync.repository.ts server/test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts server/test/medium/specs/sync/sync-shared-space-visibility-purge.spec.ts e2e/src/specs/server/api/sync-shared-space.e2e-spec.ts`
      `git commit -m "fix(spaces): owner-gate album + direct visibility-purge delete streams (gaps-5)"`

---

## Task 6 — Full-suite validation

**No new code.** Confirm the slice is green at the layers that run locally, and enumerate the CI-deferred
layers.

### Steps

- [ ] **Server unit suite**: `cd server && pnpm test --run`. Expected **GREEN** (all unit specs, incl. the
      changed `asset.service.spec.ts` + `metadata.service.spec.ts`). If `@immich/plugin-sdk` fails to resolve,
      run `pnpm --filter @immich/sdk build && pnpm --filter @immich/plugin-sdk build` first.
- [ ] **Type gate**: `cd server && pnpm run check`. Expected **GREEN** (tsc --noEmit).
- [ ] **Lint gate**: `cd server && pnpm run lint`. Expected **GREEN** (eslint `--max-warnings 0`).
- [ ] **Record CI-deferred layers** (Docker down — must be green before merge):
  - `cd server && pnpm test:medium --run test/medium/specs/sync/sync-space-visibility-purge-cross-path.spec.ts` (correctness-8)
  - `cd server && pnpm test:medium --run test/medium/specs/sync/sync-shared-space-album-visibility-purge.spec.ts` (gaps-5 album)
  - `cd server && pnpm test:medium --run test/medium/specs/sync/sync-shared-space-visibility-purge.spec.ts` (gaps-5 direct + physical-delete regression)
  - `cd e2e && pnpm test -- shared-space-visibility-negatives` (security-4 single==bulk)
  - `cd e2e && pnpm test -- sync-shared-space` (gaps-5 seam)
- [ ] **Record DB-deferred regen** (scratch migrated DB only — CI/pre-merge): `make sql` to refresh
      `server/src/queries/sync.repository.sql` (drifted by the Task 5 `getDeletes` join changes). Never run
      against the dev-stack DB or without a DB. No other query file drifts (no new `@GenerateSql` method).
- [ ] **No SDK/OpenAPI regen** — verify `git diff --stat origin/HEAD` shows no `*.dto.ts` / controller
      signature changes.

---

## Coverage map (every Slice 3 edge case → named test)

| Spec edge case                                                                  | Test                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PUT` with `visibility` **unchanged** → no emit, no album removal               | Task 2 unit "does not run any visibility transition when a single PUT omits visibility"; Task 4 unit "does NOT re-purge an already-Hidden asset" (re-affirm) |
| Timeline↔Archive (both shareable) → **no** purge                                | Task 4 unit "does NOT purge or restore on a Timeline→Archive move"; Task 4 medium (b)                                                                        |
| Restore (Hidden→Timeline) via single endpoint → emits **restore**               | Task 2 unit "restores direct/album space paths when a single PUT sets visibility Timeline"                                                                   |
| Bulk `updateAll` mixed visibility + favorite → only boundary-crossers emit      | Task 4 unit "emits only for boundary-crossers in a mixed bulk favorite+visibility flip"; Task 4 medium (c)                                                   |
| Locked transition removes from albums exactly once; re-lock → no-op             | Task 2 unit "removes from all albums AND purges … Locked"; Task 4 unit "removes from albums exactly once and skips a re-lock"                                |
| Motion video in a space-linked library flipped Hidden → purge tombstone emitted | Task 3 unit "purges … when a motion asset is hidden" + metadata "emits AssetHide"; (linkLivePhotos/onBeforeLink/onAfterUnlink fixed for free by the handler) |
| Owner gets **no** delete for their **own** album/direct asset (gaps-5)          | Task 5 medium album "A6 owner does NOT receive…" + direct "owner does NOT receive…"                                                                          |
| Physical asset delete still reaches the owner (direct LEFT-JOIN regression)     | Task 5 medium "a PHYSICAL asset delete still reaches the owner"                                                                                              |
| Single endpoint emits the **same** tombstone as bulk (security-4)               | Task 2 e2e "single PUT {visibility:hidden} … same purge as bulk"                                                                                             |
| Locked single PUT removes from ALL owner albums + tombstones                    | Task 2 e2e "single PUT {visibility:locked} removes A from ALL the owner albums AND tombstones it"                                                            |
| Crash between UPDATE and emits → recoverable (idempotent, not atomic)           | correctness-6 helper doc comment (Task 2) + Task 4 idempotency test (re-run emits harmlessly)                                                                |
| classification (Archive↔Timeline) / trash.restoreAll unchanged                  | No code touched — documented in Architecture (neither crosses the shareable boundary)                                                                        |
