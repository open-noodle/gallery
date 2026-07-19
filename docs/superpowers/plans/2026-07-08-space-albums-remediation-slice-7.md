# Slice 7 — Album-Link Ownership Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an album owner the ability to see and revoke every shared-space link to their album, and pin the (intentional) fact that album-path assets carry no space-editor metadata-edit affordances in the web UI — closing `rbac-6`, `rbac-5 / albums-8`, and `C4` from the space-albums review.

**Architecture:** Three coordinated changes. (1) **Server rbac-6:** the album owner — and only the owner — receives a `sharedSpaceLinks` list on `GET /albums/:id`, and the album owner may call `unlinkAlbum` even without space membership (an OR-arm added to the existing space-Editor guard). (2) **Web rbac-6 + rbac-5/albums-8:** a small `AlbumSharedSpaceLinks` component surfaces those links with per-link unlink buttons on the personal album detail page, and the space-linked-album detail control bar is pinned (comment + regression test) to expose only Download + RemoveFromAlbum. (3) **Playwright C4:** extend the shared-space web e2e so a space Viewer sees none of the link / unlink / add-photos / remove-from-album affordances that an Editor/Owner sees.

**Tech Stack:** NestJS 11 + Kysely (server), Zod DTOs + `@immich/sdk` (generated client), SvelteKit / Svelte 5 + `@testing-library/svelte` + Vitest (web), Playwright (web e2e), Vitest + supertest (server API e2e).

## Global Constraints

- **Base branch / worktree:** `fix/space-albums-remediation` in worktree `/Users/pierre/dev/gallery/.claude/worktrees/space-albums-remediation`. Slices 1–6 are already committed (baseline).
- **Docker is DOWN in this environment.** Server API e2e (`e2e/src/specs/server/api/*`) and Playwright web e2e (`e2e/src/specs/web/*`) **cannot run locally**. Author them fully and mark them **"authored, CI-deferred"** — do not treat their non-execution as a failure.
- **Line numbers are navigation hints against the current worktree.** Re-confirm every symbol/line before editing (per spec §0).
- **SDK regen is required** because Task 2 adds a field to `AlbumResponseDto`. It does **not** need Docker (needs Node; Dart step needs Java). It **is** a prerequisite for the web typecheck (Task 5 reads `album.sharedSpaceLinks`). Sequence it in Task 3 before any web task.
- **No `make sql` / `mise sql`** is run in this slice — the one new repository method is deliberately left **without** `@GenerateSql` (see Task 1) so no query-doc regen against a scratch DB is required. Never run `make sql` without a running migrated DB.
- **No Claude co-author / "Generated-with" trailers** on any commit.
- **Server local gate:** `cd server && pnpm run check && pnpm run lint && pnpm test --run`.
- **Web local gate:** `cd web && pnpm run check && pnpm run lint && pnpm test` (runs after Task 3's SDK build).
- **Commit boundaries (3 commits):**
  1. rbac-6 **server** (DTO field + repo method + `album.service.get` + `unlinkAlbum` owner-arm + server unit tests + authored server API e2e) **including the SDK regen output**.
  2. rbac-6 **web** UI + rbac-5/albums-8 **web** pin (component + mount + control-bar comment/testid + web unit tests).
  3. **C4 Playwright** (authored, CI-deferred).

---

## Key investigation findings (decisions locked in)

**Owner-visible link shape — DECISION: a new optional field `sharedSpaceLinks` on `AlbumResponseDto`, NOT a new endpoint.**

- Rationale: it mirrors the two existing conditionally-populated optional fields on the same DTO — `contributorCounts` (populated only in `get()` when shared) and the shared-space DTO's admin-only `linkedLibraries` — so it is an established, low-churn pattern. The web album detail page already fetches `getAlbumInfo` (`GET /albums/:id`), so no extra round-trip or new route/controller surface is needed. Owner-gating is enforced in the service (populated only when the caller owns the album; `undefined` otherwise), exactly like `contributorCounts`.
- Cost: it is a DTO change → **SDK regen required** (Task 3). A new endpoint would have the same regen cost with more surface, so the field wins on churn.

**Album ownership detection.** The `album` table has **no `ownerId` column** (confirmed: `server/src/schema/tables/album.table.ts`); ownership is modelled via `album_user` with `role = 'owner'`. The authoritative owner check is `accessRepository.album.checkOwnerAccess(userId, ids)` (the primitive behind `Permission.AlbumDelete`, `server/src/utils/access.ts:218-220`). Use it for both the owner-visible list and the `unlinkAlbum` owner-arm.

**`unlinkAlbum` guard mechanism.** Current guard is `await this.requireRole(auth, spaceId, SharedSpaceRole.Editor)` (`shared-space.service.ts:674`). Replace it with: fetch the membership, allow if the caller is a space Editor+, **else** fall back to `checkAccess({ permission: AlbumDelete })` (album-owner). The Editor path short-circuits before the owner check, so the space-Editor path is not weakened.

**Web album-path distinction — NOT feasible per-asset.** `TimelineAsset` (`web/src/lib/managers/timeline-manager/types.ts`) carries no album-origin flag, and the **direct** space timeline merges direct + album-path assets server-side; the client cannot tell them apart in that grid. Therefore rbac-5/albums-8 is handled as: (a) the **space-linked-album detail route** (`.../spaces/[spaceId]/albums/[albumId=id]/...`) is entirely album-path and its control bar **already** exposes only Download + RemoveFromAlbum — pin it with a comment + regression test; (b) in the merged direct-space grid the metadata-edit affordances are **already** owner-gated (`isAllUserOwned`), so a space Editor can never trigger a metadata edit on a non-owned album-path asset from the UI; (c) the residual mixed-bulk case is the **documented 400-on-mixed-bulk** server behavior (the space-edit `AssetUpdate` gate rejects album-path-only ids) — the UI cannot pre-empt it without a new server-provided per-asset origin signal (out of scope).

**Web space-role guard.** Each space surface derives `currentMember = members.find((m) => m.userId === authManager.user.id)` then `isEditor = role ∈ {Owner, Editor}` / `isOwner = role === Owner` (`web/src/routes/(user)/spaces/[spaceId]/+layout.svelte:51-57`). The album-detail page additionally OR-s the album role: `canManage = isSpaceEditor || isAlbumEditor` (`.../albums/[albumId=id]/.../+page.svelte:73-83`).

---

## File Structure

**Server (Commit 1):**

- Modify `server/src/dtos/album.dto.ts` — add `AlbumSharedSpaceLinkResponseSchema` + optional `sharedSpaceLinks` field on `AlbumResponseSchema`.
- Modify `server/src/repositories/shared-space.repository.ts` — add `getAlbumSpaceLinks(albumId)` (no `@GenerateSql`).
- Modify `server/src/services/album.service.ts` — populate `sharedSpaceLinks` in `get()` for the album owner only.
- Modify `server/src/services/shared-space.service.ts` — `unlinkAlbum` owner-arm.
- Modify `server/src/services/album.service.spec.ts` — owner/non-owner `sharedSpaceLinks` unit tests.
- Modify `server/src/services/shared-space.service.spec.ts` — `unlinkAlbum` owner-arm unit tests.
- Modify `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts` — authored rbac-6 API e2e block.
- Regenerated: `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`, `mobile/openapi/**` (Dart), `packages/sdk/build/**`.

**Web (Commit 2):**

- Create `web/src/lib/components/album-page/AlbumSharedSpaceLinks.svelte`.
- Create `web/src/lib/components/album-page/__tests__/AlbumSharedSpaceLinks.spec.ts`.
- Modify `web/src/lib/components/album-page/AlbumViewer.svelte` — mount the component.
- Modify `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte` — control-bar comment + a `data-testid` on the RemoveFromAlbum control.
- Modify `.../[[assetId=id]]/space-album-detail-page.spec.ts` — control-bar regression test.

**Playwright (Commit 3):**

- Modify `e2e/src/specs/web/spaces-albums.e2e-spec.ts` (and/or `spaces-albums-journey.e2e-spec.ts`) — Viewer-vs-Editor affordance matrix.

---

# COMMIT 1 — rbac-6 server: album owner can view + revoke space-album links

### Task 1: `getAlbumSpaceLinks` repository query

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (add method next to `getLinkedAlbums` / `getSpacesLinkedToAlbum`, ~`:576-614`)

**Interfaces:**

- Produces: `SharedSpaceRepository.getAlbumSpaceLinks(albumId: string): Promise<{ spaceId: string; spaceName: string; linkedById: string | null; showInTimeline: boolean }[]>` — every shared space the album is currently linked into, ordered by space name.

- [ ] **Step 1: Add the method (no `@GenerateSql`)**

Insert after `getSpacesLinkedToAlbum` (around line 614), before `hasAlbumLink`:

```ts
  // rbac-6: the album owner's view of every space this album is linked into, so they can
  // review + revoke links. Intentionally NOT decorated with @GenerateSql — decorating it would
  // require a `make sql` regen against a scratch migrated DB, which is out of scope for this slice.
  getAlbumSpaceLinks(albumId: string) {
    return this.db
      .selectFrom('shared_space_album')
      .innerJoin('shared_space', 'shared_space.id', 'shared_space_album.spaceId')
      .select([
        'shared_space_album.spaceId as spaceId',
        'shared_space.name as spaceName',
        'shared_space_album.addedById as linkedById',
        'shared_space_album.showInTimeline as showInTimeline',
      ])
      .where('shared_space_album.albumId', '=', albumId)
      .orderBy('shared_space.name', 'asc')
      .orderBy('shared_space_album.spaceId', 'asc')
      .execute();
  }
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd server && pnpm run check`
Expected: PASS (no `tsc` errors). This is verified end-to-end once Task 2's consumer is added; a standalone typecheck here confirms the Kysely column names resolve.

---

### Task 2: `sharedSpaceLinks` DTO field + owner-gated population in `album.service.get`

**Files:**

- Modify: `server/src/dtos/album.dto.ts:108-141` (add sub-schema + field) and export near `:152`
- Modify: `server/src/services/album.service.ts:93-129` (`get`)
- Test: `server/src/services/album.service.spec.ts` (new `describe('get — sharedSpaceLinks (rbac-6)')`)

**Interfaces:**

- Consumes: `SharedSpaceRepository.getAlbumSpaceLinks` (Task 1); `accessRepository.album.checkOwnerAccess(userId, ids: Set<string>): Promise<Set<string>>`.
- Produces: `AlbumResponseDto.sharedSpaceLinks?: AlbumSharedSpaceLinkResponseDto[]` where `AlbumSharedSpaceLinkResponseDto = { spaceId: string; spaceName: string; linkedById: string | null; showInTimeline: boolean }`. Populated **only** when the caller owns the album; `undefined` for every other caller.

- [ ] **Step 1: Write the failing unit tests**

Add to `server/src/services/album.service.spec.ts` (mirror the `AuthFactory` / `AlbumFactory` / `getForAlbum` / `mocks.access.album.*` patterns already in the file, e.g. `:126-186`):

```ts
describe('get — sharedSpaceLinks (rbac-6)', () => {
  it('returns sharedSpaceLinks to the album owner', async () => {
    const auth = AuthFactory.create();
    const album = AlbumFactory.from().owner(auth.user).build();
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
    mocks.album.getById.mockResolvedValue(getForAlbum(album));
    mocks.album.getMetadataForIds.mockResolvedValue([
      { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
    ]);
    mocks.sharedSpace.getAlbumSpaceLinks.mockResolvedValue([
      { spaceId: 'space-1', spaceName: 'Trip', linkedById: 'editor-1', showInTimeline: true },
      { spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'editor-2', showInTimeline: false },
    ]);

    const result = await sut.get(auth, album.id);

    expect(result.sharedSpaceLinks).toEqual([
      { spaceId: 'space-1', spaceName: 'Trip', linkedById: 'editor-1', showInTimeline: true },
      { spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'editor-2', showInTimeline: false },
    ]);
    expect(mocks.sharedSpace.getAlbumSpaceLinks).toHaveBeenCalledWith(album.id);
  });

  it('omits sharedSpaceLinks for a non-owner space-linked reader', async () => {
    const auth = AuthFactory.create();
    const album = AlbumFactory.from().albumUser().build(); // owned by someone else
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set()); // not the owner
    mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set()); // not a shared album_user
    mocks.access.album.checkSpaceLinkedAlbumReadAccess.mockResolvedValue(new Set([album.id])); // reaches via space
    mocks.album.getById.mockResolvedValue(getForAlbum(album));
    mocks.album.getMetadataForIds.mockResolvedValue([
      { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
    ]);

    const result = await sut.get(auth, album.id);

    expect(result.sharedSpaceLinks).toBeUndefined();
    expect(mocks.sharedSpace.getAlbumSpaceLinks).not.toHaveBeenCalled();
  });

  it('omits sharedSpaceLinks for a non-owner album EDITOR (owner-only policy)', async () => {
    const auth = AuthFactory.create();
    const album = AlbumFactory.from().albumUser().build();
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set()); // not the owner
    mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set([album.id])); // album editor/viewer
    mocks.album.getById.mockResolvedValue(getForAlbum(album));
    mocks.album.getMetadataForIds.mockResolvedValue([
      { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
    ]);

    const result = await sut.get(auth, album.id);

    expect(result.sharedSpaceLinks).toBeUndefined();
    expect(mocks.sharedSpace.getAlbumSpaceLinks).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/album.service.spec.ts -t "sharedSpaceLinks"`
Expected: FAIL — `result.sharedSpaceLinks` is `undefined` in the owner test (field not yet added), and `mocks.sharedSpace.getAlbumSpaceLinks` is not a function / never called.

- [ ] **Step 3a: Add the DTO sub-schema + field**

In `server/src/dtos/album.dto.ts`, add above `AlbumResponseSchema` (before line 108):

```ts
const AlbumSharedSpaceLinkResponseSchema = z
  .object({
    spaceId: z.uuidv4().describe('Shared space ID this album is linked into'),
    spaceName: z.string().describe('Shared space name'),
    linkedById: z.uuidv4().nullable().describe('User who linked the album into the space'),
    showInTimeline: z.boolean().describe('Whether the album appears in the aggregated space timeline'),
  })
  .meta({ id: 'AlbumSharedSpaceLinkResponseDto' });
```

Inside `AlbumResponseSchema` (after `contributorCounts`, before `.meta(...)` at `:139-141`) add:

```ts
    // rbac-6: shared-space links for this album — populated ONLY when the caller owns the album.
    sharedSpaceLinks: z.array(AlbumSharedSpaceLinkResponseSchema).optional(),
```

Add the exported class next to the other `createZodDto` exports (near `:152`):

```ts
export class AlbumSharedSpaceLinkResponseDto extends createZodDto(AlbumSharedSpaceLinkResponseSchema) {}
```

- [ ] **Step 3b: Populate it in `album.service.get`**

In `server/src/services/album.service.ts`, inside `get()` (between the security-8 `hasDirectAccess` block ending at `:117` and the `return {` at `:119`), add:

```ts
// rbac-6: the album OWNER (and only the owner) sees the list of shared spaces this album is
// linked into, so they can review + revoke links (a space editor can link an owner's album).
// Non-owner callers — including album editors/viewers and space-only readers — get no list.
const isAlbumOwner = (await this.accessRepository.album.checkOwnerAccess(auth.user.id, new Set([id]))).has(id);
const sharedSpaceLinks = isAlbumOwner
  ? (await this.sharedSpaceRepository.getAlbumSpaceLinks(id)).map((link) => ({
      spaceId: link.spaceId,
      spaceName: link.spaceName,
      linkedById: link.linkedById,
      showInTimeline: link.showInTimeline,
    }))
  : undefined;
```

Add `sharedSpaceLinks,` to the returned object (in the `return { ...mapped, ... }` block, after `contributorCounts`):

```ts
      contributorCounts: isShared ? await this.albumRepository.getContributorCounts(album.id) : undefined,
      sharedSpaceLinks,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/album.service.spec.ts -t "sharedSpaceLinks"`
Expected: PASS (all three).

---

### Task 3: `unlinkAlbum` album-owner arm

**Files:**

- Modify: `server/src/services/shared-space.service.ts:673-690` (`unlinkAlbum`)
- Test: `server/src/services/shared-space.service.spec.ts` (new `describe('unlinkAlbum — owner arm (rbac-6)')`)

**Interfaces:**

- Consumes: `BaseService.checkAccess({ auth, permission, ids })` (`base.service.ts:336`); `Permission.AlbumDelete` → `access.album.checkOwnerAccess`; `getSharedSpaceRoleScore` + `ROLE_HIERARCHY` (already in `shared-space.service.ts:71-77`).
- Produces: `unlinkAlbum` now succeeds for (space Editor+) **OR** (album owner, even a non-member); rejects everyone else with `ForbiddenException`.

- [ ] **Step 1: Write the failing unit tests**

Add to `server/src/services/shared-space.service.spec.ts` (mirror `makeMemberResult` / `factory.auth` / `mocks.sharedSpace.*` / `mocks.access.album.*` patterns, e.g. `:7789-7912`, `:10427-10447`):

```ts
describe('unlinkAlbum — owner arm (rbac-6)', () => {
  it('allows the album owner to unlink even without space membership', async () => {
    const auth = factory.auth({ user: { isAdmin: false } });
    const spaceId = newUuid();
    const albumId = newUuid();
    mocks.sharedSpace.getMember.mockResolvedValue(void 0); // not a space member
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId])); // owns the album
    mocks.album.getById.mockResolvedValue({ albumName: 'Trip' } as any);
    mocks.sharedSpace.getAlbumAssetIdsWithoutOtherSpacePath.mockResolvedValue([]);
    mocks.sharedSpace.removeAlbum.mockResolvedValue(void 0 as any);
    mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

    await sut.unlinkAlbum(auth, spaceId, albumId);

    expect(mocks.sharedSpace.removeAlbum).toHaveBeenCalledWith(spaceId, albumId);
  });

  it('rejects unlink from a non-owner non-member', async () => {
    const auth = factory.auth({ user: { isAdmin: false } });
    mocks.sharedSpace.getMember.mockResolvedValue(void 0);
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());

    await expect(sut.unlinkAlbum(auth, newUuid(), newUuid())).rejects.toThrow(ForbiddenException);
    expect(mocks.sharedSpace.removeAlbum).not.toHaveBeenCalled();
  });

  it('rejects unlink from a space Viewer who does not own the album', async () => {
    const auth = factory.auth({ user: { isAdmin: false } });
    const spaceId = newUuid();
    const albumId = newUuid();
    mocks.sharedSpace.getMember.mockResolvedValue(
      makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Viewer }),
    );
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());

    await expect(sut.unlinkAlbum(auth, spaceId, albumId)).rejects.toThrow(ForbiddenException);
    expect(mocks.sharedSpace.removeAlbum).not.toHaveBeenCalled();
  });

  it('still allows a space Editor who is NOT the album owner to unlink (space-editor path not weakened)', async () => {
    const auth = factory.auth({ user: { isAdmin: false } });
    const spaceId = newUuid();
    const albumId = newUuid();
    mocks.sharedSpace.getMember.mockResolvedValue(
      makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor }),
    );
    mocks.album.getById.mockResolvedValue({ albumName: 'Trip' } as any);
    mocks.sharedSpace.getAlbumAssetIdsWithoutOtherSpacePath.mockResolvedValue([]);
    mocks.sharedSpace.removeAlbum.mockResolvedValue(void 0 as any);
    mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

    await sut.unlinkAlbum(auth, spaceId, albumId);

    expect(mocks.sharedSpace.removeAlbum).toHaveBeenCalledWith(spaceId, albumId);
    // Editor path short-circuits before the owner check.
    expect(mocks.access.album.checkOwnerAccess).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t "owner arm"`
Expected: FAIL — the "album owner without membership" test throws `ForbiddenException` (current `requireRole` rejects a non-member), and the Editor test's `checkOwnerAccess` assertion is meaningless until the new arm exists.

- [ ] **Step 3: Implement the owner arm**

In `server/src/services/shared-space.service.ts`, replace the first line of `unlinkAlbum` (`:674`):

```ts
await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
```

with:

```ts
// rbac-6: current-space Editors curate space links; ADDITIONALLY the album owner can always
// revoke a link to their own album, even without space membership (otherwise an owner cannot
// discover or undo an editor's link). The Editor path short-circuits, so it is not weakened.
const member = await this.sharedSpaceRepository.getMember(spaceId, auth.user.id);
const isSpaceEditor = !!member && getSharedSpaceRoleScore(member.role) >= ROLE_HIERARCHY[SharedSpaceRole.Editor];
if (!isSpaceEditor) {
  const ownedAlbums = await this.checkAccess({ auth, permission: Permission.AlbumDelete, ids: [albumId] });
  if (!ownedAlbums.has(albumId)) {
    throw new ForbiddenException('Insufficient role');
  }
}
```

(`ForbiddenException` and `Permission` are already imported at `:1` and `:50`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t "owner arm"`
Expected: PASS (all four). Also re-run the existing unlink test to confirm no regression:
Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t "unlinkAlbum logs an album_unlink"`
Expected: PASS.

---

### Task 4: Authored server API e2e for rbac-6 (CI-deferred)

**Files:**

- Modify: `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts` (add a `describe('rbac-6 — album-link ownership controls')` block near the existing rbac-2 / rbac-3 blocks at the bottom)

**Interfaces:**

- Consumes: `utils.adminSetup`, `utils.userSetup`, `utils.createSpace`, `utils.addSpaceMember`, `utils.createAsset`, `utils.createAlbum({ albumName, albumUsers, assetIds })`, `utils.linkSpaceAlbum(token, spaceId, albumId)`; SDK `getAlbumInfo`; raw `request(app)` for `DELETE /shared-spaces/:spaceId/albums/:albumId`.

- [ ] **Step 1: Write the e2e block**

Add this block (adapt to the file's existing setup/import style — `request`, `app`, `asBearerAuth`, `utils`, `SharedSpaceRole`, `AlbumUserRole`, `getAlbumInfo` from `@immich/sdk`):

```ts
describe('rbac-6 — album-link ownership controls', () => {
  let albumOwner: LoginResponseDto; // owns the album; NOT a member of the space
  let spaceEditor: LoginResponseDto; // space owner + album editor → performs the link
  let stranger: LoginResponseDto; // no relationship to album or space
  let spaceA: SharedSpaceResponseDto;
  let spaceB: SharedSpaceResponseDto;
  let album: AlbumResponseDto;

  beforeAll(async () => {
    const admin = await utils.adminSetup();
    [albumOwner, spaceEditor, stranger] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('rbac6-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('rbac6-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('rbac6-stranger')),
    ]);

    const asset = await utils.createAsset(albumOwner.accessToken);
    album = await utils.createAlbum(albumOwner.accessToken, {
      albumName: 'Owner Album',
      albumUsers: [{ userId: spaceEditor.userId, role: AlbumUserRole.Editor }],
      assetIds: [asset.id],
    });

    // spaceEditor owns both spaces (space owner is an Editor+); albumOwner is NOT a member of either.
    spaceA = await utils.createSpace(spaceEditor.accessToken, { name: 'Space A' });
    spaceB = await utils.createSpace(spaceEditor.accessToken, { name: 'Space B' });
    await utils.linkSpaceAlbum(spaceEditor.accessToken, spaceA.id, album.id);
    await utils.linkSpaceAlbum(spaceEditor.accessToken, spaceB.id, album.id);
  });

  it('shows the album owner every space link (multi-space), with showInTimeline', async () => {
    const info = await getAlbumInfo({ id: album.id }, { headers: asBearerAuth(albumOwner.accessToken) });
    expect(info.sharedSpaceLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ spaceId: spaceA.id, spaceName: 'Space A', showInTimeline: true }),
        expect.objectContaining({ spaceId: spaceB.id, spaceName: 'Space B', showInTimeline: true }),
      ]),
    );
    expect(info.sharedSpaceLinks).toHaveLength(2);
  });

  it('does NOT show sharedSpaceLinks to a space member who is not the album owner', async () => {
    // spaceEditor is a space owner + album editor but NOT the album owner.
    const info = await getAlbumInfo({ id: album.id }, { headers: asBearerAuth(spaceEditor.accessToken) });
    expect(info.sharedSpaceLinks).toBeUndefined();
  });

  it('lets the album owner (not a space member) unlink one space, leaving the other + the album intact', async () => {
    await request(app)
      .delete(`/shared-spaces/${spaceA.id}/albums/${album.id}`)
      .set('Authorization', `Bearer ${albumOwner.accessToken}`)
      .expect(204);

    const info = await getAlbumInfo({ id: album.id }, { headers: asBearerAuth(albumOwner.accessToken) });
    expect(info.sharedSpaceLinks).toEqual([expect.objectContaining({ spaceId: spaceB.id, spaceName: 'Space B' })]);
    // The album itself is untouched.
    expect(info.id).toBe(album.id);
    expect(info.assetCount).toBe(1);
  });

  it('rejects unlink from a non-owner non-member (403)', async () => {
    await request(app)
      .delete(`/shared-spaces/${spaceB.id}/albums/${album.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(403);
  });
});
```

- [ ] **Step 2: Typecheck the e2e (cannot run — Docker down)**

Run: `cd e2e && pnpm exec tsc --noEmit -p tsconfig.json` (or the repo's e2e check command)
Expected: PASS (types resolve). **Mark the block "authored, CI-deferred"** — it will execute in CI where the e2e Docker stack is up. Do not attempt `pnpm test` here.

---

### Task 5: SDK regen (required before web tasks)

**Files:**

- Regenerated (do not hand-edit): `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`, `mobile/openapi/**`, `packages/sdk/build/**`.

**Interfaces:**

- Produces: SDK type `AlbumResponseDto.sharedSpaceLinks?: AlbumSharedSpaceLinkResponseDto[]` and type `AlbumSharedSpaceLinkResponseDto` importable from `@immich/sdk` (consumed by Task 6/7).

- [ ] **Step 1: Build the server so the spec generator sees the new DTO**

Run: `cd server && pnpm build`
Expected: build succeeds (`nest build`).

- [ ] **Step 2: Regenerate the OpenAPI spec + clients**

Run (from repo root): `mise open-api`
Expected: regenerates `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`, and the Dart client. If Java is unavailable and only the `open-api-dart` sub-task fails, run just the TS path the web needs: `mise //server:sync-open-api && mise open-api-typescript`.

- [ ] **Step 3: Verify the diff is additive-only**

Run: `git --no-pager diff --stat open-api/ packages/sdk/src/fetch-client.ts`
Expected: only `AlbumSharedSpaceLinkResponseDto` + the `sharedSpaceLinks` field appear. Confirm with:
Run: `git --no-pager grep -n "sharedSpaceLinks\|AlbumSharedSpaceLinkResponseDto" packages/sdk/src/fetch-client.ts`
Expected: matches present. If unrelated drift appears, investigate before continuing (do not commit stray regen churn).

- [ ] **Step 4: Build the TypeScript SDK + plugin SDK (so web/cli/plugins typecheck)**

Run: `pnpm --filter @immich/sdk build && pnpm --filter @immich/plugin-sdk build`
Expected: both compile.

- [ ] **Step 5: Server gate + commit**

Run: `cd server && pnpm run check && pnpm run lint && pnpm test --run`
Expected: PASS.

```bash
git add server/src/dtos/album.dto.ts \
  server/src/repositories/shared-space.repository.ts \
  server/src/services/album.service.ts server/src/services/album.service.spec.ts \
  server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts \
  e2e/src/specs/server/api/shared-space-album.e2e-spec.ts \
  open-api/immich-openapi-specs.json packages/sdk/src/fetch-client.ts \
  mobile/openapi
git commit -m "feat(spaces): album owner can view + revoke space-album links (rbac-6)"
```

> **RISK (call out in the PR):** the `sharedSpaceLinks` field forces an SDK/Dart regen that cannot be executed in the Docker-down environment for its _runtime_ verification (only compile-time). The regenerated `mobile/openapi/**` Dart is additive/optional and mobile is out of slice-7 scope, but it must be committed so the checked-in client matches the spec. If Java was unavailable, the Dart step must be completed in a Java-capable/CI environment before merge, or CI's OpenAPI check will flag drift.

---

# COMMIT 2 — rbac-6 web UI + rbac-5/albums-8 web pin

> Requires Commit 1's SDK build (Task 5) so `@immich/sdk` exposes `sharedSpaceLinks` / `AlbumSharedSpaceLinkResponseDto`.

### Task 6: `AlbumSharedSpaceLinks` component + unit test

**Files:**

- Create: `web/src/lib/components/album-page/AlbumSharedSpaceLinks.svelte`
- Test: `web/src/lib/components/album-page/__tests__/AlbumSharedSpaceLinks.spec.ts`

**Interfaces:**

- Consumes: `AlbumResponseDto` (with `sharedSpaceLinks`) from `@immich/sdk`; `unlinkAlbum({ id, albumId })` from `@immich/sdk`.
- Produces: `AlbumSharedSpaceLinks` component — props `{ album: AlbumResponseDto }`; renders one row per `album.sharedSpaceLinks` entry (space name + timeline indicator + unlink button); on unlink calls `unlinkAlbum({ id: link.spaceId, albumId: album.id })` and removes the row from local state. Renders nothing when `sharedSpaceLinks` is empty/undefined.

- [ ] **Step 1: Write the failing unit test**

Create `web/src/lib/components/album-page/__tests__/AlbumSharedSpaceLinks.spec.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AlbumSharedSpaceLinks from '$lib/components/album-page/AlbumSharedSpaceLinks.svelte';

const unlinkAlbum = vi.fn().mockResolvedValue(undefined);
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  unlinkAlbum: (args: unknown) => unlinkAlbum(args),
}));

const albumWith = (sharedSpaceLinks: unknown) =>
  ({ id: 'album-1', albumName: 'Owner Album', sharedSpaceLinks }) as never;

describe('AlbumSharedSpaceLinks', () => {
  it('renders one row per space link with the space name', () => {
    render(AlbumSharedSpaceLinks, {
      album: albumWith([
        { spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true },
        { spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'e2', showInTimeline: false },
      ]),
    });
    expect(screen.getByText('Trip')).toBeInTheDocument();
    expect(screen.getByText('Zoo')).toBeInTheDocument();
    expect(screen.getAllByTestId('album-space-link-unlink')).toHaveLength(2);
  });

  it('calls unlinkAlbum with the space id + album id on click', async () => {
    render(AlbumSharedSpaceLinks, {
      album: albumWith([{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }]),
    });
    await userEvent.click(screen.getByTestId('album-space-link-unlink'));
    expect(unlinkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'album-1' });
  });

  it('renders nothing when there are no links', () => {
    const { container } = render(AlbumSharedSpaceLinks, { album: albumWith(undefined) });
    expect(container.querySelector('[data-testid="album-space-links"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/components/album-page/__tests__/AlbumSharedSpaceLinks.spec.ts`
Expected: FAIL — component file does not exist.

- [ ] **Step 3: Create the component**

Create `web/src/lib/components/album-page/AlbumSharedSpaceLinks.svelte`:

```svelte
<script lang="ts">
  import { unlinkAlbum, type AlbumResponseDto } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiLinkVariantOff } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    album: AlbumResponseDto;
  }

  let { album }: Props = $props();

  // Owner-only: the server populates `sharedSpaceLinks` on GET /albums/:id only for the album owner.
  let links = $state([...(album.sharedSpaceLinks ?? [])]);

  const handleUnlink = async (spaceId: string) => {
    await unlinkAlbum({ id: spaceId, albumId: album.id });
    links = links.filter((link) => link.spaceId !== spaceId);
  };
</script>

{#if links.length > 0}
  <section data-testid="album-space-links" class="flex flex-col gap-2">
    <h2 class="text-sm font-medium text-immich-fg/60">{$t('linked_spaces')}</h2>
    <ul class="flex flex-col gap-1">
      {#each links as link (link.spaceId)}
        <li class="flex items-center justify-between gap-2" data-testid="album-space-link">
          <span class="flex items-center gap-2">
            <span>{link.spaceName}</span>
            {#if !link.showInTimeline}
              <span class="text-xs text-immich-fg/50">{$t('hidden_from_space_timeline')}</span>
            {/if}
          </span>
          <IconButton
            shape="round"
            variant="ghost"
            color="secondary"
            size="small"
            icon={mdiLinkVariantOff}
            aria-label={$t('unlink_album_from_space', { values: { space: link.spaceName } })}
            data-testid="album-space-link-unlink"
            onclick={() => handleUnlink(link.spaceId)}
          />
        </li>
      {/each}
    </ul>
  </section>
{/if}
```

> **i18n keys:** add `linked_spaces`, `hidden_from_space_timeline`, and `unlink_album_from_space` to `web/src/lib/i18n/en.json` (English source only). If the repo's convention forbids raw strings, mirror an existing space-albums key. Confirm keys resolve so `pnpm check` / lint pass.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/components/album-page/__tests__/AlbumSharedSpaceLinks.spec.ts`
Expected: PASS (all three).

---

### Task 7: Mount `AlbumSharedSpaceLinks` in the album detail page

**Files:**

- Modify: `web/src/lib/components/album-page/AlbumViewer.svelte` (the personal album-detail component that receives the `AlbumResponseDto`)

**Interfaces:**

- Consumes: `AlbumSharedSpaceLinks` (Task 6); the `album` object already in `AlbumViewer` scope.

- [ ] **Step 1: Import + mount the component**

In `web/src/lib/components/album-page/AlbumViewer.svelte`, add the import alongside the other `album-page` imports:

```ts
import AlbumSharedSpaceLinks from '$lib/components/album-page/AlbumSharedSpaceLinks.svelte';
```

Mount it in the album header / summary / options region where album metadata is rendered (near `AlbumSummary` or the album options block — re-confirm the exact block by reading the file). The component self-hides when there are no links, so no extra guard is needed:

```svelte
    <AlbumSharedSpaceLinks {album} />
```

- [ ] **Step 2: Verify the web typecheck passes**

Run: `cd web && pnpm run check`
Expected: PASS (svelte-check + tsc; `album.sharedSpaceLinks` resolves because the SDK was rebuilt in Task 5).

---

### Task 8: Pin the space-linked-album control bar (rbac-5 / albums-8) + regression test

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte:214-222` (control-bar comment + `data-testid` for Playwright)
- Test: `.../[[assetId=id]]/space-album-detail-page.spec.ts` (control-bar regression)

**Interfaces:**

- Produces: a stable `data-testid="album-remove-from-album"` marker on the space-album RemoveFromAlbum control (consumed by Task 9 Playwright); a pinned control-bar shape (Download + `canManage`-gated RemoveFromAlbum, no metadata-edit affordances).

- [ ] **Step 1: Write the failing regression test**

Add to the existing `space-album-detail-page.spec.ts` (mirror its existing render harness / `mock-asset-select-control-bar.test-wrapper.svelte` usage — re-confirm the wrapper the file uses to drive the control bar):

```ts
describe('rbac-5/albums-8: album-path control bar exposes no editor metadata affordances', () => {
  it('shows Download + RemoveFromAlbum for a manager and NO metadata-edit affordances', () => {
    // render with canManage = true (space editor or album editor) and a selection active
    // (reuse the file's existing render helper / props for the browse-mode control bar).
    // Assert the only actions are Download + RemoveFromAlbum:
    expect(screen.getByTestId('album-remove-from-album')).toBeInTheDocument();
    expect(screen.queryByTestId('change-date-action')).toBeNull();
    expect(screen.queryByTestId('change-location-action')).toBeNull();
    expect(screen.queryByTestId('archive-action')).toBeNull();
    expect(screen.queryByTestId('tag-action')).toBeNull();
  });

  it('hides RemoveFromAlbum for a non-manager (viewer)', () => {
    // render with canManage = false
    expect(screen.queryByTestId('album-remove-from-album')).toBeNull();
  });
});
```

> The exact `queryByTestId` targets depend on this repo's action testids; if the metadata-edit actions have no testids, assert the control bar's rendered button set by role/text instead (`screen.queryByRole('button', { name: /archive|change date|change location|tag/i })` → `null`). The load-bearing assertions are: RemoveFromAlbum present iff `canManage`, and no metadata-edit control present in any case.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/space-album-detail-page.spec.ts"`
Expected: FAIL — `album-remove-from-album` testid does not exist yet.

- [ ] **Step 3: Add the comment + testid**

In `.../[[assetId=id]]/+page.svelte`, update the browse-mode control-bar block (`:214-222`):

```svelte
  <!-- Browse selection control bar (shows when assets are selected in browse mode).
       rbac-5/albums-8: album-path assets never grant space-editor metadata-edit (checkSpaceEditAccess
       omits the album arm, pinned by shared-space-album-scope.guard.spec.ts). This route is entirely
       album-path, so it intentionally exposes ONLY Download + RemoveFromAlbum — never Archive / Change
       date/location / Tag / visibility. In the MERGED direct-space timeline those metadata-edit actions
       are separately gated by `isAllUserOwned`, so an editor can never trigger them on a non-owned
       album-path asset; the residual mixed-bulk case is refused server-side (400 on album-path-only ids),
       which the client cannot pre-empt without a per-asset origin signal (none exists on TimelineAsset). -->
  {#if mode === 'browse' && assetMultiSelectManager.selectionActive}
    <AssetSelectControlBar>
      <DownloadAction filename="{album.albumName}.zip" />
      {#if canManage}
        <RemoveFromAlbum bind:album onRemove={handleRemoveAssets} data-testid="album-remove-from-album" />
      {/if}
    </AssetSelectControlBar>
  {/if}
```

> If `RemoveFromAlbum` (`RemoveFromAlbumAction.svelte`) does not forward `data-testid` to its rendered button, add `data-testid` passthrough there (a `$props()` rest spread onto the button), or wrap the action in a `<span data-testid="album-remove-from-album">`. Keep the testid on the element the Playwright test will assert on.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/space-album-detail-page.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Web gate + commit**

Run: `cd web && pnpm run check && pnpm run lint && pnpm test`
Expected: PASS (svelte-check + tsc clean; lint tolerates the repo's pre-existing tailwind warnings; vitest green).

```bash
git add web/src/lib/components/album-page/AlbumSharedSpaceLinks.svelte \
  web/src/lib/components/album-page/__tests__/AlbumSharedSpaceLinks.spec.ts \
  web/src/lib/components/album-page/AlbumViewer.svelte \
  web/src/lib/i18n/en.json \
  "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte" \
  "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/space-album-detail-page.spec.ts" \
  web/src/lib/components/timeline/actions/RemoveFromAlbumAction.svelte
git commit -m "feat(web): surface album space-links to owner; pin space-album edit affordances (rbac-6, rbac-5/albums-8)"
```

---

# COMMIT 3 — C4 Playwright: Viewer sees no space-album affordances

### Task 9: Viewer-vs-Editor affordance matrix (authored, CI-deferred)

**Files:**

- Modify: `e2e/src/specs/web/spaces-albums.e2e-spec.ts` (extend the existing viewer-gating tests) and/or `e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts`

**Interfaces:**

- Consumes: existing fixture (`owner`/`editor`/`viewer` via `utils.createSpace`/`utils.addSpaceMember`/`utils.createAlbum({ albumUsers })`/`utils.linkSpaceAlbum`); `utils.setAuthCookies`; existing selectors `link-album-button`, `space-album-card-menu`, `add-photos-button`; new selector `album-remove-from-album` (Task 8).

- [ ] **Step 1: Extend the spec with the affordance matrix**

Add to `e2e/src/specs/web/spaces-albums.e2e-spec.ts` (reuse the file's `beforeAll` fixture with `owner`/`editor`/`viewer` + `space` + linked `album`; auth per test via `utils.setAuthCookies(context, token)` then `page.goto`):

```ts
test.describe('Spaces — Albums UI (C4: role-gating of link/unlink/edit affordances)', () => {
  test('viewer sees no link / unlink / add-photos affordances', async ({ context, page }) => {
    await utils.setAuthCookies(context, viewer.accessToken);
    await page.goto(`/spaces/${space.id}/albums`);
    await expect(page.getByTestId('link-album-button')).toHaveCount(0);
    await expect(page.getByTestId('create-album-button')).toHaveCount(0);
    await expect(page.getByTestId('space-album-card-menu')).toHaveCount(0); // unlink / show-in-timeline menu
  });

  test('editor sees link + unlink affordances', async ({ context, page }) => {
    await utils.setAuthCookies(context, editor.accessToken);
    await page.goto(`/spaces/${space.id}/albums`);
    await expect(page.getByTestId('link-album-button')).toBeVisible();
    await expect(page.getByTestId('space-album-card-menu').first()).toBeVisible();
  });

  test('viewer sees no remove-from-album affordance in the space album detail', async ({ context, page }) => {
    await utils.setAuthCookies(context, viewer.accessToken);
    await page.goto(`/spaces/${space.id}/albums/${album.id}`);
    // Enter selection on the first asset, then assert the remove control is absent.
    const thumb = page.locator(`[data-thumbnail-focus-container][data-asset="${asset.id}"]`).first();
    await thumb.hover();
    await thumb.getByRole('checkbox').click();
    await expect(page.getByTestId('add-photos-button')).toHaveCount(0);
    await expect(page.getByTestId('album-remove-from-album')).toHaveCount(0);
  });

  test('editor sees the remove-from-album affordance in the space album detail', async ({ context, page }) => {
    await utils.setAuthCookies(context, editor.accessToken);
    await page.goto(`/spaces/${space.id}/albums/${album.id}`);
    const thumb = page.locator(`[data-thumbnail-focus-container][data-asset="${asset.id}"]`).first();
    await thumb.hover();
    await thumb.getByRole('checkbox').click();
    await expect(page.getByTestId('album-remove-from-album')).toBeVisible();
  });
});
```

> The selection-entry gesture (hover + checkbox click) must match this repo's thumbnail selection interaction — re-confirm against an existing selection test in the space specs and adapt if the gesture differs (e.g. long-press / a dedicated select button). The load-bearing assertions are the `toHaveCount(0)` (viewer) vs `toBeVisible()` (editor) pairs.

- [ ] **Step 2: Typecheck (cannot run — Docker down)**

Run: `cd e2e && pnpm exec tsc --noEmit -p tsconfig.json` (or the repo's e2e web check)
Expected: PASS. **Mark "authored, CI-deferred"** — Playwright runs against the `make e2e` stack (`:2285`) in CI, not locally.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/spaces-albums.e2e-spec.ts
git commit -m "test(e2e): space Viewer cannot see space-album link/unlink/edit affordances (C4)"
```

---

## Edge-case coverage map (every Slice 7 edge case → a named test)

- **Album linked into multiple spaces → owner sees + unlinks each independently** → Task 4 e2e "shows the album owner every space link (multi-space)" + "lets the album owner unlink one space, leaving the other + the album intact".
- **Owner IS a space Editor → both paths work (no double-grant weirdness)** → Task 3 unit "still allows a space Editor who is NOT the album owner" (Editor path short-circuits; owner check never runs) + the owner in Task 4 who is also a space-Editor/owner still gets the list.
- **Owner unlink removes only the space link, not the album** → Task 4 e2e "leaving the other + the album intact" (`info.id`, `info.assetCount` unchanged).
- **`showInTimeline` surfaced per link** → DTO field (Task 2) + Task 4 e2e `showInTimeline: true` assertion + Task 6 unit renders `hidden_from_space_timeline` for `showInTimeline: false`.
- **Non-owner album-editor visibility policy = OWNER-ONLY** → Task 2 unit "omits sharedSpaceLinks for a non-owner album EDITOR" + Task 4 e2e "does NOT show sharedSpaceLinks to a space member who is not the album owner".
- **Viewer sees no affordances / Editor does** → Task 8 web unit (RemoveFromAlbum iff `canManage`) + Task 9 Playwright matrix.
- **Space-editor path not weakened** → Task 3 unit asserts `checkOwnerAccess` is not called on the Editor path.
- **rbac-5/albums-8 mixed-bulk fallback documented** → Task 8 code comment + the "no metadata-edit affordance" regression test (fallback is the server-side 400-on-mixed-bulk, restated in the comment).

---

## Self-Review checklist (run before handing off)

1. **Spec coverage:** rbac-6 owner-visible links → Tasks 1,2,4,6,7. rbac-6 owner unlink → Tasks 3,4. rbac-5/albums-8 web → Task 8. C4 Playwright → Task 9. All Slice-7 edge cases mapped above. ✅
2. **Placeholder scan:** every code step shows real code; the two web assertion targets that depend on repo-local testids are explicitly flagged with a concrete fallback (assert by role/text). No "TBD"/"handle edge cases". ✅
3. **Type consistency:** `getAlbumSpaceLinks` returns `{ spaceId, spaceName, linkedById, showInTimeline }` — identical field names in the repo (Task 1), DTO (Task 2), service mapper (Task 2), unit mocks (Task 2), e2e assertions (Task 4), and the Svelte component (Task 6). `unlinkAlbum({ id, albumId })` used identically in the component (Task 6) and its test. ✅

---

## Final validation (per touched package)

- **Server** (after Commit 1): `cd server && pnpm run check && pnpm run lint && pnpm test --run`.
- **Web** (after Commit 2, requires Task 5's SDK build): `cd web && pnpm run check && pnpm run lint && pnpm test`.
- **e2e** (Tasks 4 + 9): typecheck only locally (`cd e2e && pnpm exec tsc --noEmit`); full runs are **CI-deferred** (Docker down → API e2e on the `make e2e` stack and Playwright on `:2285` execute in CI).
- **SDK regen** (Task 5): committed regenerated `open-api/immich-openapi-specs.json` + `packages/sdk/src/fetch-client.ts` (+ Dart) verified additive-only; if the Dart step could not run locally (no Java), complete it in CI/a Java-capable env before merge.
