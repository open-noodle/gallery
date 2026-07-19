# Space-Albums Remediation — Slice 6 (RBAC escalation + destructive visibility) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two HIGH RBAC findings in shared-space asset writes — `rbac-2` (a space Viewer re-shares album-read assets to gain write access) and `rbac-3` (a space Editor flips another member's asset visibility, destroying it fleet-wide).

**Architecture:** Two independent server-service edits, each TDD'd at the unit layer and pinned by CI-deferred e2e negatives. `rbac-2` tightens one permission enum in `SharedSpaceService.addAssets` (`AssetRead` → `AssetShare`). `rbac-3` adds an **owner-only guard** to `AssetService.updateAll` (bulk `visibility`) and `AssetService.update` (single `visibility` + `livePhotoVideoId`) that runs **before** the Slice-3 destructive cascade (`applyVisibilityTransitionSideEffects`). The guard computes the owned subset via the existing owner-access primitive and **rejects the whole request** if a restricted field is set on any non-owned id.

**Tech Stack:** NestJS 11 + TypeScript, Kysely, vitest (unit via `newTestService()` auto-mocks), Playwright/vitest e2e (`e2e/`). No DTO/endpoint/SQL/migration changes → **no SDK regen, no `make sql`, no migration**.

## Global Constraints

- **Docker is DOWN** → medium + e2e suites are **CI-deferred**. This slice is service-layer, so it is fully **unit-testable red→green locally**. Author the e2e negatives but **do not run them**; mark them CI-deferred in-comment.
- **Gate (run from `server/`):** `pnpm run check` (`tsc --noEmit`) and `pnpm run lint` (`eslint … --max-warnings 0`). Single-file unit run: `pnpm test --run <path>` (optionally `-t "<name>"`).
- **No `make sql`** — no `@GenerateSql`-decorated query changes (the guard reuses existing `checkAccess`/`checkOwnerAccess`; no new repository method or SQL). Running `make sql` without a DB deletes query files — never do it here.
- **No migrations, no DTO changes, no SDK regen** — `visibility`/`livePhotoVideoId`/`assetIds` already exist on their DTOs; the SDK functions `updateAssets`, `updateAsset`, `addAssets` already exist.
- **Commits:** exactly **two** feature commits, exact messages, **no Claude co-author / "Generated with" trailers**:
  - rbac-2: `fix(spaces): require AssetShare (not AssetRead) to add assets to a space`
  - rbac-3: `fix(spaces): restrict visibility and livePhotoVideoId writes to owned assets`
- **Scope (fixed by the spec):** rbac-3 restricts **`visibility` + `livePhotoVideoId` ONLY**. Do **not** touch `upsertBulkMetadata` / `upsertMetadata` / `deleteMetadataByKey` / `deleteBulkMetadata` — general metadata-edit stays the documented, pinned space-editor capability.

---

## Key design decisions (resolved)

### D1 — Mixed bulk: **REJECT** (not split)

When `visibility` (bulk) or `visibility`/`livePhotoVideoId` (single) is set on **any** non-owned id, **reject the whole request** with `ForbiddenException` (HTTP 403). Rationale:

1. **Security + simplicity.** A single early guard, no partial-write state to reason about or get wrong.
2. **Clean composition with Slice 3.** `AssetService.updateAll`/`update` already route visibility through the extracted `applyVisibilityTransitionSideEffects(ids, nextVisibility, priorVisibilities)` helper, called with the **full** `ids` (bulk) / `[id]` (single). REJECT leaves that call site untouched: if the guard passes, **every** id is owned, so the helper still receives all ids exactly as Slice 3 wrote it. The existing Slice-3 tests mock `checkOwnerAccess` to return the **full** id set (e.g. `asset.service.spec.ts:962,988,1116,1150`), so the owner-split — which reuses `checkOwnerAccess` — sees all ids owned and never throws. **Zero Slice-3 regressions.** A SPLIT would force a second `updateAll` write, a narrowed prior-visibility fetch, and a narrowed helper `ids` argument — regressing the Slice-3 `mocks.asset.updateAll`/emit assertions.
3. **Deterministic + debuggable.** A mixed-ownership visibility request fails loudly (403) instead of silently mutating a subset. The web client (Slice 7) hides the visibility affordance for non-owned/album-path assets, so such a mixed request should not originate from the UI.

**Trade-off (documented):** a bulk request mixing `isFavorite` + `visibility` across an ownership boundary is rejected wholesale, even though the `isFavorite` on the non-owned ids is otherwise editor-allowed. This is deliberate: it is safer and more predictable than a silent partial apply, and is asserted explicitly.

### D2 — Owner-check primitive

`this.checkAccess({ auth, permission: Permission.AssetDelete, ids })`. `AssetDelete` resolves (`utils/access.ts:161-163`) to `access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission)` — the **pure owner arm**, identical to the `isOwner` sub-check inside the `AssetUpdate` case and using the **same** `hasElevatedPermission` flag (so a caller's own Locked asset resolves consistently between the gate and the guard). `checkOwnerAccess` filters `where('asset.ownerId','=',userId)` (`access.repository.ts:230-243`), so a **library-backed asset owned by another user is NOT returned** → correctly treated as non-owned. Reusing `AssetDelete` adds **no** new SQL.

### D3 — Insertion points

- **`updateAll`** (`asset.service.ts`): the guard goes **immediately after** `requireAccess({ permission: AssetUpdate, ids })` (line 312) and **before** the `assetDto` build (314), the prior-visibility fetch (351-357), the `assetRepository.updateAll` write (359-361), and the `applyVisibilityTransitionSideEffects` call (363-365). It runs only when `visibility !== undefined`.
- **`update`** (`asset.service.ts`): the guard goes **immediately after** `requireAccess({ permission: AssetUpdate, ids:[id] })` (line 224) and **before** the `livePhotoVideoId` link/unlink side-effects (`onBeforeLink`/`onBeforeUnlink`, lines 230-237) and the visibility helper call (267-269). It runs when `dto.visibility !== undefined || dto.livePhotoVideoId !== undefined`.

### D4 — rbac-2 status is 400, not 403

`rbac-2` is a one-line permission swap; `requireAccess` throws `BadRequestException` → **HTTP 400** on denial (the codebase convention, confirmed by `shared-space-album.e2e-spec.ts:126` and `shared-space-visibility-negatives.e2e-spec.ts`). The spec text says "403" for rbac-2 — that is inaccurate for this code path; the e2e asserts **400**. (rbac-3 throws our own `ForbiddenException` → 403.)

---

## File Structure

| File                                                      | Change                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `server/src/services/shared-space.service.ts`             | rbac-2: `addAssets` line 573 — `Permission.AssetRead` → `Permission.AssetShare`.   |
| `server/src/services/shared-space.service.spec.ts`        | rbac-2: 2 new tests in the `addAssets` describe (~line 2141).                      |
| `server/src/services/asset.service.ts`                    | rbac-3: owner-guard in `updateAll` (after line 312) and `update` (after line 224). |
| `server/src/services/asset.service.spec.ts`               | rbac-3: 3 reject tests + 2 positive pins across `update`/`updateAll` describes.    |
| `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts` | rbac-2 + rbac-3: 2 new top-level `describe` blocks (CI-deferred).                  |

**No files created.** All edits extend existing files.

---

## Task 1: rbac-2 — `addAssets` requires `AssetShare`

**Files:**

- Modify: `server/src/services/shared-space.service.ts:573`
- Test: `server/src/services/shared-space.service.spec.ts` (`describe('addAssets', …)`, ~line 2141)
- Test (e2e, CI-deferred): `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts`

**Interfaces:**

- Consumes: `this.requireAccess({ auth, permission, ids })` (BaseService → `utils/access.requireAccess`, throws `BadRequestException` on denial). `Permission.AssetShare` (`utils/access.ts:127-131`) = `checkOwnerAccess(false) ∪ checkPartnerAccess` — **no** album/space arm.
- Produces: nothing new; only tightens an existing call.

**Background (why this is the escalation):** `AssetRead`'s space arm is `access.asset.checkSpaceAccess`, which unions a `shared_space_album` branch (`access.repository.ts:310-327`) with **no role filter**. A space **Viewer** of a space linking album X therefore reads X's assets, then re-adds them as **direct** assets to a space they own — where `checkSpaceEditAccess` grants them `AssetUpdate` over the real owner's assets. `AssetShare` (owner ∪ partner) is what album-add already requires and closes the gap.

- [ ] **Step 1: Write the two failing/pinning tests**

Add inside `describe('addAssets', () => { … })` in `server/src/services/shared-space.service.spec.ts` (after the existing `'should reject adding assets the user does not have access to'` test, ~line 2184). `BadRequestException` and `ForbiddenException` are already imported (line 1); `factory`, `makeMemberResult`, `newUuid`, `SharedSpaceRole` are already in use.

```ts
it('rejects re-adding an asset the caller can only READ via a space-linked album (rbac-2)', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const albumOnlyAssetId = newUuid();
  const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });

  mocks.sharedSpace.getMember.mockResolvedValue(editorMember);
  // Caller neither owns nor partners the asset — they only reach it through a space-linked album.
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
  mocks.access.asset.checkPartnerAccess.mockResolvedValue(new Set());
  mocks.access.asset.checkAlbumAccess.mockResolvedValue(new Set([albumOnlyAssetId]));
  mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([albumOnlyAssetId]));

  await expect(sut.addAssets(auth, spaceId, { assetIds: [albumOnlyAssetId] })).rejects.toBeInstanceOf(
    BadRequestException,
  );

  expect(mocks.sharedSpace.addAssets).not.toHaveBeenCalled();
  // AssetShare must NOT consult the album/space READ arms — those are the escalation surface.
  expect(mocks.access.asset.checkAlbumAccess).not.toHaveBeenCalled();
  expect(mocks.access.asset.checkSpaceAccess).not.toHaveBeenCalled();
});

it('allows an editor to add a partner-shared asset (AssetShare includes partner) (rbac-2)', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const partnerAssetId = newUuid();
  const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: false });

  mocks.sharedSpace.getMember.mockResolvedValue(editorMember);
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
  mocks.access.asset.checkPartnerAccess.mockResolvedValue(new Set([partnerAssetId]));
  mocks.sharedSpace.addAssets.mockResolvedValue([{ spaceId, assetId: partnerAssetId, addedById: auth.user.id }] as any);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.update.mockResolvedValue(space);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.addAssets(auth, spaceId, { assetIds: [partnerAssetId] });

  expect(mocks.sharedSpace.addAssets).toHaveBeenCalledWith([
    { spaceId, assetId: partnerAssetId, addedById: auth.user.id },
  ]);
});
```

- [ ] **Step 2: Run the tests to verify the first one FAILS (red)**

Run: `pnpm test --run src/services/shared-space.service.spec.ts -t "rbac-2"`
Expected: the `'rejects re-adding … space-linked album'` test **FAILS** — on the current `AssetRead` code, `checkSpaceAccess`/`checkAlbumAccess` return the id, so `requireAccess` passes, `mocks.sharedSpace.addAssets` **is** called, and no exception is thrown (the `.rejects` and the two `not.toHaveBeenCalled` assertions fail). The `'allows … partner-shared'` test passes on both old and new code (it is a guard-rail pin).

- [ ] **Step 3: Apply the fix**

In `server/src/services/shared-space.service.ts`, replace line 573:

```ts
await this.requireAccess({ auth, permission: Permission.AssetRead, ids: dto.assetIds });
```

with:

```ts
// rbac-2: AssetRead's space arm (checkSpaceAccess) includes an un-role-gated shared_space_album branch,
// so a space Viewer of a space linking album X could read X's assets and re-add them as DIRECT assets
// into a space they own — gaining AssetUpdate over the owner's assets via checkSpaceEditAccess. AssetShare
// (owner ∪ partner only, no album/space arm) is the same permission album-add already requires and closes
// the read→re-share→write escalation.
await this.requireAccess({ auth, permission: Permission.AssetShare, ids: dto.assetIds });
```

(`Permission` is already imported; `AssetShare` is a member of the same enum.)

- [ ] **Step 4: Run the tests to verify they PASS (green)**

Run: `pnpm test --run src/services/shared-space.service.spec.ts -t "rbac-2"`
Expected: **both** new tests PASS.

- [ ] **Step 5: Run the whole addAssets spec file to confirm no regression**

Run: `pnpm test --run src/services/shared-space.service.spec.ts`
Expected: PASS. The existing `'should add assets when editor'` (mocks `checkOwnerAccess` to the full id set → `AssetShare` still passes) and `'should reject adding assets the user does not have access to'` (owner⊇{ownedAssetId} but request contains a foreign id → still throws) remain green.

- [ ] **Step 6: Author the CI-deferred e2e (rbac-2 escalation negative)**

Append a new top-level `describe` to `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts` (imports `AlbumResponseDto, AlbumUserRole, AssetMediaResponseDto, LoginResponseDto, SharedSpaceRole` from `@immich/sdk`, `createUserDto` from `src/fixtures`, `app, utils` from `src/utils`, `request` from `supertest` are already present):

```ts
// rbac-2 (CI-deferred — Docker down): a space Viewer must not re-share album assets they can only READ.
describe('rbac-2: addAssets requires AssetShare (read→re-share escalation)', () => {
  let admin: LoginResponseDto;
  let victim: LoginResponseDto; // owns album X (asset A) and space S1
  let attacker: LoginResponseDto; // Viewer of S1, Owner of S2

  let assetA: AssetMediaResponseDto;
  let attackerSpaceId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [victim, attacker] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('rbac2-victim')),
      utils.userSetup(admin.accessToken, createUserDto.create('rbac2-attacker')),
    ]);

    // Victim owns asset A (Timeline → shareable via the space-album read arm) inside album X.
    assetA = await utils.createAsset(victim.accessToken);
    const albumX = await utils.createAlbum(victim.accessToken, {
      albumName: 'rbac2 album X',
      assetIds: [assetA.id],
    });

    // Victim's space S1 links album X; attacker joins S1 as Viewer → AssetRead on A via checkSpaceAccess's album arm.
    const s1 = await utils.createSpace(victim.accessToken, { name: 'rbac2 S1' });
    await utils.addSpaceMember(victim.accessToken, s1.id, { userId: attacker.userId, role: SharedSpaceRole.Viewer });
    await utils.linkSpaceAlbum(victim.accessToken, s1.id, albumX.id);

    // Attacker owns space S2 (they are its Owner ≥ Editor, so requireRole(Editor) passes and the asset gate is reached).
    const s2 = await utils.createSpace(attacker.accessToken, { name: 'rbac2 S2' });
    attackerSpaceId = s2.id;
  });

  const addAssets = (token: string, spaceId: string, assetIds: string[]) =>
    request(app).post(`/shared-spaces/${spaceId}/assets`).set('Authorization', `Bearer ${token}`).send({ assetIds });

  it('attacker cannot re-add a victim asset they only READ via the linked album → 400', async () => {
    const { status } = await addAssets(attacker.accessToken, attackerSpaceId, [assetA.id]);
    expect(status).toBe(400); // requireAccess(AssetShare) denial → BadRequestException (was 204 pre-fix)
  });

  it('victim can still add their own asset to their own space → 204', async () => {
    const s = await utils.createSpace(victim.accessToken, { name: 'rbac2 victim space' });
    const { status } = await addAssets(victim.accessToken, s.id, [assetA.id]);
    expect(status).toBe(204);
  });
});
```

Do **not** run this suite (Docker down). It compiles against the existing SDK (no regen).

- [ ] **Step 7: Type-check and lint the touched server files**

Run: `pnpm run check`
Expected: no errors.
Run: `pnpm run lint`
Expected: no errors/warnings. (If prettier/eslint rewraps the new comment, accept the autofix.)

- [ ] **Step 8: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts e2e/src/specs/server/api/shared-space-album.e2e-spec.ts
git commit -m "fix(spaces): require AssetShare (not AssetRead) to add assets to a space"
```

---

## Task 2: rbac-3 — restrict `visibility` + `livePhotoVideoId` to owned assets

**Files:**

- Modify: `server/src/services/asset.service.ts` — `updateAll` (after line 312) and `update` (after line 224)
- Test: `server/src/services/asset.service.spec.ts` — `describe('update', …)` (~613) and `describe('updateAll', …)` (~954)
- Test (e2e, CI-deferred): `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts`

**Interfaces:**

- Consumes: `this.checkAccess({ auth, permission: Permission.AssetDelete, ids }): Promise<Set<string>>` (BaseService → `utils/access.checkAccess`; `AssetDelete` = `checkOwnerAccess(userId, ids, hasElevatedPermission)`). `ForbiddenException` (already imported, `asset.service.ts:1`). The extracted Slice-3 helper `applyVisibilityTransitionSideEffects(ids, nextVisibility, priorVisibilities)` (unchanged — still called with full `ids`/`[id]`).
- Produces: no new symbols; two in-method guards.

- [ ] **Step 1: Write the failing bulk-reject test + the bulk positive pins**

Add inside `describe('updateAll', () => { … })` in `server/src/services/asset.service.spec.ts` (after the existing `'should update all assets'` test, ~line 969). `AssetVisibility`, `AuthFactory`, `authStub`, `ForbiddenException` are already imported.

```ts
it('rejects a bulk visibility change that includes a non-owned (space-edit) asset (rbac-3)', async () => {
  const auth = AuthFactory.create();
  // Editor owns asset-1; has space-edit rights over asset-2 (another member's asset) → AssetUpdate gate passes.
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
  mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set(['asset-2']));
  mocks.asset.getByIds.mockResolvedValue([
    { id: 'asset-1', visibility: AssetVisibility.Timeline } as any,
    { id: 'asset-2', visibility: AssetVisibility.Timeline } as any,
  ]);

  await expect(
    sut.updateAll(auth, { ids: ['asset-1', 'asset-2'], visibility: AssetVisibility.Locked }),
  ).rejects.toBeInstanceOf(ForbiddenException);

  // The destructive cascade must NOT have fired for anyone (guard runs before the write + side-effects).
  expect(mocks.asset.updateAll).not.toHaveBeenCalled();
  expect(mocks.album.removeAssetsFromAll).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.emitAlbumAssetVisibilityPurge).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.emitLibraryAssetVisibilityPurge).not.toHaveBeenCalled();
});

it('allows a space editor to change a NON-visibility field on a non-owned asset (existing policy) (rbac-3)', async () => {
  const auth = AuthFactory.create();
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
  mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set(['asset-2']));

  await sut.updateAll(auth, { ids: ['asset-2'], isFavorite: true });

  // No visibility → owner-split guard never runs → editor keeps their metadata-edit capability.
  expect(mocks.asset.updateAll).toHaveBeenCalledWith(['asset-2'], { isFavorite: true });
});
```

> Note: the owner-flips-own-bulk positive is already pinned by the existing `'should update all assets'` test (line 960 — `checkOwnerAccess` returns both ids, `visibility: Archive`, asserts `updateAll` called). It stays green because the guard sees all ids owned.

- [ ] **Step 2: Write the failing single-PUT reject tests + the single positive pin**

Add inside `describe('update', () => { … })` (~line 613), after the existing `'does not run any visibility transition …'` test (~line 933). `getForAsset`, `AssetFactory`, `newUuid`, `AssetType` are already imported.

```ts
it('rejects a single-PUT visibility change on a non-owned (space-edit) asset (rbac-3)', async () => {
  const auth = AuthFactory.create();
  const asset = AssetFactory.create({ visibility: AssetVisibility.Timeline });
  // Caller does not own the asset but has space-edit rights → AssetUpdate gate passes.
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
  mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(getForAsset(asset));
  mocks.asset.update.mockResolvedValue({ ...getForAsset(asset), visibility: AssetVisibility.Locked });

  await expect(sut.update(auth, asset.id, { visibility: AssetVisibility.Locked })).rejects.toBeInstanceOf(
    ForbiddenException,
  );

  expect(mocks.asset.update).not.toHaveBeenCalled();
  expect(mocks.album.removeAssetsFromAll).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.emitDirectAssetVisibilityPurge).not.toHaveBeenCalled();
});

it('rejects setting livePhotoVideoId on a non-owned (space-edit) asset (rbac-3)', async () => {
  const auth = AuthFactory.create();
  const asset = AssetFactory.create();
  const motionId = newUuid();
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
  mocks.access.asset.checkSpaceEditAccess.mockResolvedValue(new Set([asset.id]));

  await expect(sut.update(auth, asset.id, { livePhotoVideoId: motionId })).rejects.toBeInstanceOf(ForbiddenException);

  // Guard runs before onBeforeLink, so the motion-link side-effects never execute.
  expect(mocks.asset.update).not.toHaveBeenCalled();
});

it('allows changing visibility on an asset the caller owns even as a space editor (rbac-3)', async () => {
  const asset = AssetFactory.create({ visibility: AssetVisibility.Timeline });
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getById.mockResolvedValue(getForAsset(asset));
  mocks.asset.update.mockResolvedValue({ ...getForAsset(asset), visibility: AssetVisibility.Archive });

  await sut.update(AuthFactory.create({ id: asset.ownerId }), asset.id, { visibility: AssetVisibility.Archive });

  expect(mocks.asset.update).toHaveBeenCalledWith({ id: asset.id, visibility: AssetVisibility.Archive });
});
```

- [ ] **Step 3: Run the new tests to verify the reject tests FAIL (red)**

Run: `pnpm test --run src/services/asset.service.spec.ts -t "rbac-3"`
Expected: the three reject tests **FAIL** on current code —

- bulk: with no guard, `requireAccess(AssetUpdate)` passes (owner ∪ space-edit = both ids), so `updateAll`/`removeAssetsFromAll`/purge emits fire → the `not.toHaveBeenCalled` assertions fail, and no `ForbiddenException` is thrown.
- single visibility: the cascade fires (or the flow throws `BadRequestException`, not `ForbiddenException`) → `.rejects.toBeInstanceOf(ForbiddenException)` fails.
- single livePhotoVideoId: `onBeforeLink('…')` runs and throws `BadRequestException` (motion not found), not `ForbiddenException` → fails.

The two positive tests pass on both old and new code (pins).

- [ ] **Step 4: Apply the `updateAll` guard**

In `server/src/services/asset.service.ts`, insert immediately **after** line 312 (`await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids });`), before the `const assetDto = …` line:

```ts
// rbac-3: `visibility` is destructive — flipping an asset to Locked/Hidden strips it from the owner's
// albums (removeAssetsFromAll) and #757-tombstones it off every member device. AssetUpdate grants a space
// EDITOR that power over OTHER members' direct+library assets (checkSpaceEditAccess), which would let an
// editor wipe another member's asset fleet-wide. Restrict visibility to OWNED ids: reject the whole request
// if visibility is set on any id the caller does not own. This guard MUST run before the write and the
// applyVisibilityTransitionSideEffects cascade below, or the destructive side-effects fire before the guard.
// AssetDelete == the pure owner arm (checkOwnerAccess, same hasElevatedPermission as the AssetUpdate gate's
// isOwner sub-check); a library-backed asset owned by another user is correctly NOT returned as owned.
if (visibility !== undefined) {
  const ownedIds = await this.checkAccess({ auth, permission: Permission.AssetDelete, ids });
  if (ownedIds.size !== new Set(ids).size) {
    throw new ForbiddenException('Visibility can only be changed on assets you own');
  }
}
```

- [ ] **Step 5: Apply the `update` guard**

In the same file, insert immediately **after** line 224 (`await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [id] });`), before `const { description, … } = dto;`:

```ts
// rbac-3: visibility AND livePhotoVideoId are owner-only structural writes (see updateAll). A space editor
// holds AssetUpdate over other members' assets via checkSpaceEditAccess, but must not flip their visibility
// (fleet-wide tombstone) or re-link their motion video. Reject if either is set on an asset the caller does
// not own; other metadata (description/rating/…) stays editor-allowed. Runs BEFORE the livePhotoVideoId
// link/unlink side-effects and the visibility transition helper below.
if (dto.visibility !== undefined || dto.livePhotoVideoId !== undefined) {
  const ownedIds = await this.checkAccess({ auth, permission: Permission.AssetDelete, ids: [id] });
  if (!ownedIds.has(id)) {
    throw new ForbiddenException('Visibility and live-photo linkage can only be changed on assets you own');
  }
}
```

- [ ] **Step 6: Run the rbac-3 tests to verify they PASS (green)**

Run: `pnpm test --run src/services/asset.service.spec.ts -t "rbac-3"`
Expected: all five rbac-3 tests PASS.

- [ ] **Step 7: Run the whole asset spec to confirm no Slice-3 regression**

Run: `pnpm test --run src/services/asset.service.spec.ts`
Expected: PASS. The Slice-3 visibility/security-4 tests (`update`/`updateAll`/`onAssetHide`/`onAssetShow`) all mock `checkOwnerAccess` to return the full id set, so both the `AssetUpdate` gate **and** the new `AssetDelete` owner-split see every id owned → no throw → the helper is still invoked with the full ids and the existing purge/restore assertions hold.

- [ ] **Step 8: Author the CI-deferred e2e (rbac-3 destructive-visibility negative)**

Append a second new top-level `describe` to `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts`. Add `AssetVisibility` to the existing `@immich/sdk` import at the top of the file:

```ts
import {
  AlbumResponseDto,
  AlbumUserRole,
  AssetMediaResponseDto,
  AssetVisibility,
  LoginResponseDto,
  SharedSpaceRole,
} from '@immich/sdk';
```

Then:

```ts
// rbac-3 (CI-deferred — Docker down): a space Editor must not flip another member's asset visibility.
describe('rbac-3: visibility writes are restricted to owned assets', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto; // space owner
  let editor: LoginResponseDto; // space editor (attacker)
  let victim: LoginResponseDto; // contributes an asset to the space

  let spaceId: string;
  let victimAsset: AssetMediaResponseDto;
  let victimAlbum: AlbumResponseDto;
  let editorAsset: AssetMediaResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [owner, editor, victim] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('rbac3-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('rbac3-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('rbac3-victim')),
    ]);

    const space = await utils.createSpace(owner.accessToken, { name: 'rbac3 space' });
    spaceId = space.id;
    await utils.addSpaceMember(owner.accessToken, spaceId, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, spaceId, { userId: victim.userId, role: SharedSpaceRole.Editor });

    // Victim owns an asset in a personal album AND direct in the space → editor gains checkSpaceEditAccess over it.
    victimAsset = await utils.createAsset(victim.accessToken);
    victimAlbum = await utils.createAlbum(victim.accessToken, {
      albumName: 'rbac3 victim album',
      assetIds: [victimAsset.id],
    });
    await utils.addSpaceAssets(victim.accessToken, spaceId, [victimAsset.id]);

    // Editor owns their own asset in the space (positive control).
    editorAsset = await utils.createAsset(editor.accessToken);
    await utils.addSpaceAssets(editor.accessToken, spaceId, [editorAsset.id]);
  });

  const bulkUpdate = (token: string, body: Record<string, unknown>) =>
    request(app).put('/assets').set('Authorization', `Bearer ${token}`).send(body);
  const singleUpdate = (token: string, id: string, body: Record<string, unknown>) =>
    request(app).put(`/assets/${id}`).set('Authorization', `Bearer ${token}`).send(body);

  it('editor cannot bulk-lock the victim asset → 403; asset stays Timeline and stays in the victim album', async () => {
    const { status } = await bulkUpdate(editor.accessToken, {
      ids: [victimAsset.id],
      visibility: AssetVisibility.Locked,
    });
    expect(status).toBe(403);

    // Cascade did NOT fire: visibility unchanged and still an album member.
    const { status: getStatus, body } = await request(app)
      .get(`/assets/${victimAsset.id}`)
      .set('Authorization', `Bearer ${victim.accessToken}`);
    expect(getStatus).toBe(200);
    expect(body.visibility).toBe(AssetVisibility.Timeline);

    const { body: album } = await request(app)
      .get(`/albums/${victimAlbum.id}`)
      .set('Authorization', `Bearer ${victim.accessToken}`);
    expect((album.assets as Array<{ id: string }>).map((a) => a.id)).toContain(victimAsset.id);
  });

  it('editor cannot single-PUT the victim asset to Hidden → 403', async () => {
    const { status } = await singleUpdate(editor.accessToken, victimAsset.id, {
      visibility: AssetVisibility.Hidden,
    });
    expect(status).toBe(403);
  });

  it('editor CAN change visibility on their OWN asset → 204', async () => {
    const { status } = await bulkUpdate(editor.accessToken, {
      ids: [editorAsset.id],
      visibility: AssetVisibility.Archive,
    });
    expect(status).toBe(204);
  });

  it('editor CAN still set a non-visibility field on the victim asset (existing policy) → 204', async () => {
    const { status } = await bulkUpdate(editor.accessToken, { ids: [victimAsset.id], isFavorite: true });
    expect(status).toBe(204);
  });
});
```

Do **not** run this suite (Docker down). It uses existing SDK types/routes only (no regen). `livePhotoVideoId`-on-non-owned is covered by the unit test in Step 2 (a motion-video e2e fixture is heavy and CI-deferred anyway).

- [ ] **Step 9: Type-check and lint**

Run: `pnpm run check`
Expected: no errors.
Run: `pnpm run lint`
Expected: no errors/warnings.

- [ ] **Step 10: Commit**

```bash
git add server/src/services/asset.service.ts server/src/services/asset.service.spec.ts e2e/src/specs/server/api/shared-space-album.e2e-spec.ts
git commit -m "fix(spaces): restrict visibility and livePhotoVideoId writes to owned assets"
```

---

## Task 3: Final validation gate

**Files:** none (verification only).

- [ ] **Step 1: Run both touched unit specs in full**

Run (from `server/`):

```bash
pnpm test --run src/services/asset.service.spec.ts src/services/shared-space.service.spec.ts
```

Expected: PASS — all new rbac-2/rbac-3 tests plus every pre-existing test in both files.

- [ ] **Step 2: Type-check the server package**

Run: `pnpm run check`
Expected: no errors.

- [ ] **Step 3: Lint the server package**

Run: `pnpm run lint`
Expected: no errors, zero warnings.

- [ ] **Step 4: Confirm CI-deferred surface is recorded**

Confirm the two new e2e `describe` blocks in `shared-space-album.e2e-spec.ts` each carry the `CI-deferred — Docker down` comment and were **not** executed locally. They run in CI (`cd e2e && pnpm test`) once the stack is up. No medium tests are required for this slice (pure service-layer logic; no SQL/trigger change).

- [ ] **Step 5: Confirm commit boundaries**

Run: `git log --oneline -2`
Expected exactly:

```
<sha> fix(spaces): restrict visibility and livePhotoVideoId writes to owned assets
<sha> fix(spaces): require AssetShare (not AssetRead) to add assets to a space
```

No `Co-Authored-By` / "Generated with" trailers.

---

## Self-Review

**1. Spec coverage (Slice 6 edge cases → task):**

| Slice-6 edge case                                                       | Where                                                                                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| rbac-2 Viewer re-share → denied                                         | Task 1 unit `'rejects re-adding … space-linked album'`; e2e `'attacker cannot re-add …'`                                          |
| Owner/partner add own asset → allowed                                   | Task 1 unit `'allows … partner-shared'`; existing `'should add assets when editor'`; e2e `'victim can still add …'`               |
| Mixed bulk owned+others with visibility → **reject whole request** (D1) | Task 2 unit `'rejects a bulk visibility change …'`; e2e `'editor cannot bulk-lock …'`                                             |
| Owner flips own → unchanged                                             | Task 2 unit `'allows changing visibility on an asset the caller owns …'`; existing `'should update all assets'`                   |
| livePhotoVideoId on non-owned single → restricted                       | Task 2 unit `'rejects setting livePhotoVideoId …'`                                                                                |
| Editor edits own asset visibility → allowed                             | Task 2 unit positive + e2e `'editor CAN change visibility on their OWN asset'`                                                    |
| Editor edits NON-visibility field on shared asset → allowed             | Task 2 unit `'allows a space editor to change a NON-visibility field …'`; e2e `'editor CAN still set a non-visibility field …'`   |
| Cascade must not fire before the guard                                  | Asserted via `removeAssetsFromAll`/`emit*` `not.toHaveBeenCalled` (Task 2 unit) and visibility-unchanged + album-membership (e2e) |

**2. Placeholder scan:** none — every step has concrete code/commands/expected output.

**3. Type consistency:** the owner-check is `this.checkAccess({ auth, permission: Permission.AssetDelete, ids })` in both guards; both throw `ForbiddenException` (already imported). Unit tests drive the gate via `mocks.access.asset.checkSpaceEditAccess` and the split via `mocks.access.asset.checkOwnerAccess` (both default to `new Set()` in the access mock; `checkSpaceEditAccess` confirmed present). `getByIds` defaults to `[]`. Success/deny status codes verified against controllers: addAssets 204/deny-400; bulk `PUT /assets` 204/deny-403; single `PUT /assets/:id` 200/deny-403.

**Risks / divergences (carry into review):**

- **rbac-2 status is 400, not the spec's "403"** (D4) — deliberate; asserted as 400.
- **REJECT (not split) for mixed bulk** (D1) — a bulk mixing `isFavorite` + `visibility` across an ownership boundary fails wholesale; documented and asserted, chosen for security/simplicity and zero Slice-3 regression.
- **Double `checkOwnerAccess` call** when `visibility` is set (once in the `AssetUpdate` gate, once in the `AssetDelete` split). No existing test asserts a `checkOwnerAccess` call-count, so this is safe; the second call is an O(1) extra owner-scoped access check only on visibility writes.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-space-albums-remediation-slice-6.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
