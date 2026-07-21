# Space Album Drill-Down in the Web Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show up to three linked albums beneath each space in the web sidebar's Spaces dropdown, behind a chevron that appears only on spaces that have linked albums, and make album linking count as space activity.

**Architecture:** Add a computed `albumCount` to the shared-space DTO (populated in the existing `getAll` loop) so the sidebar knows on first paint which spaces have albums. The sidebar hand-rolls a chevron in `recent-spaces.svelte` (NOT `NavbarItem`, which cannot render the space thumbnail), lazily fetches a space's albums on first expand, caches them, and persists per-space expansion. Linking an album bumps the space's `lastActivityAt` (so it rises into the top three) and emits a client event that invalidates the sidebar cache.

**Tech Stack:** NestJS + Kysely (server), Zod DTOs, SvelteKit + Svelte 5 runes (web), Vitest (+ testcontainers for medium tests), generated `@immich/sdk`.

**Spec:** `docs/superpowers/specs/2026-07-20-space-album-drilldown-design.md`

## Global Constraints

- **No relative imports in server code** — use the `src/` path alias.
- **DTO counts are `.optional()`** — match `memberCount` / `assetCount` / `newAssetCount`.
- **`albumCount` and the sidebar list both ignore `showInTimeline`** and both exclude soft-deleted albums (`album.deletedAt is null`) — count and list must never disagree.
- **`i18n/` is shared between web and mobile** — add new keys to `i18n/en.json` only; grep both before deleting any key.
- **Prettier is a separate CI gate from ESLint** — run `prettier --check` on every modified file, source included.
- **Full `make open-api`** after any DTO change — a TypeScript-only regen leaves the Dart client stale and CI fails.
- **No `Co-Authored-By` / `Generated-with` trailers** in commits.
- **Run commands with mise shims on PATH:** `export PATH="$HOME/.local/share/mise/shims:$PATH"`.

---

## Task 1: Server — `albumCount` on the space DTO

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (add `getLinkedAlbumCount` near `getLinkedAlbums`, ~`:957`)
- Modify: `server/src/dtos/shared-space.dto.ts` (`SharedSpaceResponseSchema`, ~`:79-103`)
- Modify: `server/src/services/shared-space.service.ts` (`getAll` loop, `:133-194`)
- Test: `server/src/services/shared-space.service.spec.ts` (`describe('getAll')`, ~`:395`)
- Test: `server/test/medium/specs/services/shared-space-getlinkedalbums.medium.spec.ts`

**Interfaces:**

- Produces: `SharedSpaceRepository.getLinkedAlbumCount(spaceId: string): Promise<number>`
- Produces: `SharedSpaceResponseDto.albumCount?: number`

- [ ] **Step 1: Write the failing service unit tests**

Add inside `describe('getAll', () => { ... })` in `server/src/services/shared-space.service.spec.ts`:

```ts
it('includes albumCount from getLinkedAlbumCount for each space', async () => {
  const auth = factory.auth();
  const space = factory.sharedSpace({ name: 'Space 1' });

  mocks.sharedSpace.getAllByUserId.mockResolvedValue([space]);
  mocks.sharedSpace.getMembers.mockResolvedValue([]);
  mocks.sharedSpace.getAssetCount.mockResolvedValue(0);
  mocks.sharedSpace.getRecentAssets.mockResolvedValue([]);
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ lastViewedAt: null }));
  mocks.sharedSpace.getLinkedAlbumCount.mockResolvedValue(3);

  const result = await sut.getAll(auth);

  expect(result[0].albumCount).toBe(3);
  expect(mocks.sharedSpace.getLinkedAlbumCount).toHaveBeenCalledWith(space.id);
});

it('reports albumCount per space independently', async () => {
  const auth = factory.auth();
  const spaceA = factory.sharedSpace({ name: 'A' });
  const spaceB = factory.sharedSpace({ name: 'B' });

  mocks.sharedSpace.getAllByUserId.mockResolvedValue([spaceA, spaceB]);
  mocks.sharedSpace.getMembers.mockResolvedValue([]);
  mocks.sharedSpace.getAssetCount.mockResolvedValue(0);
  mocks.sharedSpace.getRecentAssets.mockResolvedValue([]);
  mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ lastViewedAt: null }));
  mocks.sharedSpace.getLinkedAlbumCount.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

  const result = await sut.getAll(auth);

  expect(result[0].albumCount).toBe(2);
  expect(result[1].albumCount).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="$HOME/.local/share/mise/shims:$PATH" && cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t albumCount`
Expected: FAIL — `mocks.sharedSpace.getLinkedAlbumCount` is undefined (method does not exist yet), or `albumCount` is undefined.

- [ ] **Step 3: Add the repository method**

In `server/src/repositories/shared-space.repository.ts`, add immediately above `getLinkedAlbums(spaceId: string)` (~`:957`). Note the `album` join + `deletedAt` filter — this keeps the count consistent with `getLinkedAlbums`, which excludes soft-deleted albums:

```ts
@GenerateSql({ params: [DummyValue.UUID] })
async getLinkedAlbumCount(spaceId: string): Promise<number> {
  const result = await this.db
    .selectFrom('shared_space_album')
    .innerJoin('album', 'album.id', 'shared_space_album.albumId')
    .where('shared_space_album.spaceId', '=', spaceId)
    .where('album.deletedAt', 'is', null)
    .select((eb) => eb.fn.countAll().$castTo<number>().as('count'))
    .executeTakeFirst();
  return result?.count ?? 0;
}
```

- [ ] **Step 4: Add the DTO field**

In `server/src/dtos/shared-space.dto.ts`, inside `SharedSpaceResponseSchema` (~`:87`, next to `assetCount`):

```ts
    albumCount: z.number().optional().describe('Number of linked albums'),
```

- [ ] **Step 5: Wire it into `getAll`**

In `server/src/services/shared-space.service.ts`, inside the `for (const space of spaces)` loop in `getAll` (~`:139`, next to the other per-space `await`s):

```ts
const albumCount = await this.sharedSpaceRepository.getLinkedAlbumCount(space.id);
```

Then add `albumCount` to the object pushed to `results` (~`:184`, next to `assetCount`):

```ts
        assetCount,
        albumCount,
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t albumCount`
Expected: PASS (2 tests). Also run the full `getAll` describe to confirm no regression: `pnpm test -- --run src/services/shared-space.service.spec.ts -t getAll`

- [ ] **Step 7: Write the medium test (real SQL)**

Append to `server/test/medium/specs/services/shared-space-getlinkedalbums.medium.spec.ts` (the `setup()` there already wires the real `SharedSpaceRepository` + `AlbumRepository`):

```ts
describe('SharedSpaceService.getAll — albumCount', () => {
  it('counts linked albums per space and excludes soft-deleted albums', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const { result: a1 } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'One' });
    const { result: a2 } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Two' });
    const { result: trashed } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Trashed' });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: a1.id, addedById: owner.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: a2.id, addedById: owner.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: trashed.id, addedById: owner.id });
    await ctx.softDeleteAlbum(trashed.id);

    const result = await sut.getAll(authFromUser(owner));

    const target = result.find((s) => s.id === space.id);
    expect(target?.albumCount).toBe(2);
  });

  it('returns albumCount 0 for a space with no linked albums', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

    const result = await sut.getAll(authFromUser(owner));

    expect(result.find((s) => s.id === space.id)?.albumCount).toBe(0);
  });
});
```

- [ ] **Step 8: Run the medium test to verify it passes**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-getlinkedalbums.medium.spec.ts`
Expected: PASS (existing `getLinkedAlbums` tests + the 2 new `albumCount` tests). Requires Docker (testcontainers).

- [ ] **Step 9: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/src/dtos/shared-space.dto.ts server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts server/test/medium/specs/services/shared-space-getlinkedalbums.medium.spec.ts
git commit -m "feat(spaces): add albumCount to shared-space getAll response (#816)"
```

---

## Task 2: Server — bump `lastActivityAt` when an album is linked

**Files:**

- Modify: `server/src/services/shared-space.service.ts` (`linkAlbum`, `:734-766`)
- Test: `server/src/services/shared-space.service.spec.ts` (`describe('linkAlbum')` ~`:8681`, `describe('unlinkAlbum …')` ~`:8957`)

**Interfaces:**

- Consumes: `SharedSpaceRepository.update(id, values)` (already exists), `addAlbum` returns the inserted row or `undefined` on idempotent re-link.

- [ ] **Step 1: Write the failing unit tests**

Add inside `describe('linkAlbum', () => { ... })` in `server/src/services/shared-space.service.spec.ts`:

```ts
it('bumps lastActivityAt on a newly created link', async () => {
  const auth = factory.auth({ user: { isAdmin: false } });
  const space = factory.sharedSpace({ faceRecognitionEnabled: false });
  const albumId = newUuid();
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Owner });

  mocks.sharedSpace.getMember.mockResolvedValue(member);
  mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
  mocks.sharedSpace.addAlbum.mockResolvedValue({
    spaceId: space.id,
    albumId,
    addedById: auth.user.id,
    createdAt: new Date(),
    updatedAt: new Date(),
    createId: newUuid(),
    updateId: newUuid(),
  } as any);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.album.getById.mockResolvedValue({ albumName: 'Test Album' } as any);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.linkAlbum(auth, space.id, albumId);

  expect(mocks.sharedSpace.update).toHaveBeenCalledWith(space.id, { lastActivityAt: expect.any(Date) });
});

it('does NOT bump lastActivityAt on an idempotent re-link', async () => {
  const auth = factory.auth({ user: { isAdmin: false } });
  const space = factory.sharedSpace({ faceRecognitionEnabled: false });
  const albumId = newUuid();
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Owner });

  mocks.sharedSpace.getMember.mockResolvedValue(member);
  mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
  mocks.sharedSpace.addAlbum.mockResolvedValue(void 0 as any);

  await sut.linkAlbum(auth, space.id, albumId);

  expect(mocks.sharedSpace.update).not.toHaveBeenCalled();
});
```

Add inside `describe('unlinkAlbum — owner arm (rbac-6)', () => { ... })` (or the nearest `unlinkAlbum` describe):

```ts
it('does NOT bump lastActivityAt when unlinking', async () => {
  const auth = factory.auth({ user: { isAdmin: false } });
  const space = factory.sharedSpace();
  const albumId = newUuid();
  const member = makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Editor });

  mocks.sharedSpace.getMember.mockResolvedValue(member);
  mocks.sharedSpace.hasAlbumLink.mockResolvedValue(true);
  mocks.album.getById.mockResolvedValue({ albumName: 'Test Album' } as any);
  mocks.sharedSpace.getAlbumAssetIdsWithoutOtherSpacePath.mockResolvedValue([]);
  mocks.sharedSpace.removeAlbum.mockResolvedValue(void 0);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.unlinkAlbum(auth, space.id, albumId);

  expect(mocks.sharedSpace.update).not.toHaveBeenCalledWith(space.id, { lastActivityAt: expect.any(Date) });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t "lastActivityAt"`
Expected: FAIL — the "bumps" test fails because `update` is not called; the "does NOT bump" tests pass vacuously (still run them to confirm they don't error).

- [ ] **Step 3: Add the bump inside `if (result)`**

In `server/src/services/shared-space.service.ts`, inside `linkAlbum`'s `if (result) {` block (~`:754`, as the first statement inside the block, before the face-sync check):

```ts
    if (result) {
      await this.sharedSpaceRepository.update(spaceId, { lastActivityAt: new Date() });
      const space = await this.sharedSpaceRepository.getById(spaceId);
```

(The `const space = ...` line already exists — insert the `update` line immediately above it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t "lastActivityAt"`
Expected: PASS (3 tests). Re-run the whole `linkAlbum` + `unlinkAlbum` describes to confirm no regression: `pnpm test -- --run src/services/shared-space.service.spec.ts -t "Album"`

- [ ] **Step 5: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(spaces): bump lastActivityAt when an album is linked (#816)"
```

---

## Task 3: Regenerate the SDK (TypeScript + Dart)

**Files:**

- Modify (generated): `packages/sdk/src/fetch-client.ts`, `open-api/immich-openapi-specs.json`, `mobile/openapi/**`

- [ ] **Step 1: Build the server and sync the OpenAPI spec**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH" && cd server && pnpm build && pnpm sync:open-api
```

Expected: `open-api/immich-openapi-specs.json` now contains `albumCount` under `SharedSpaceResponseDto`.

- [ ] **Step 2: Regenerate both clients**

Run: `cd /Users/pierre/dev/gallery/.claude/worktrees/feat-space-album-drilldown && make open-api`
Expected: completes without error (Java required for the Dart generator).

- [ ] **Step 3: Verify the field landed in both clients**

Run:

```bash
grep -n "albumCount" packages/sdk/src/fetch-client.ts
grep -rn "albumCount" mobile/openapi/lib/model/shared_space_response_dto.dart
```

Expected: `albumCount?: number` in the TS `SharedSpaceResponseDto`, and a nullable `albumCount` field in the Dart DTO.

- [ ] **Step 4: Rebuild the SDK build output the web app imports**

Run: `cd /Users/pierre/dev/gallery/.claude/worktrees/feat-space-album-drilldown && pnpm --filter @immich/sdk build`
Expected: exit 0; `packages/sdk/build/fetch-client.d.ts` mentions `albumCount`.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk open-api mobile/openapi
git commit -m "chore(sdk): regenerate clients for albumCount (#816)"
```

---

## Task 4: Web — `Route.viewSpaceAlbum` helper and call-site migration

**Files:**

- Modify: `web/src/lib/route.ts` (near `viewSpace`, ~`:127`)
- Modify: `web/src/lib/components/spaces/space-album-card.svelte:49`
- Modify: `web/src/lib/components/spaces/space-albums-table.svelte:41`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte:101`
- Test: `web/src/lib/route.spec.ts`

**Interfaces:**

- Produces: `Route.viewSpaceAlbum({ spaceId, albumId }: { spaceId: string; albumId: string }): string` → `/spaces/${spaceId}/albums/${albumId}`
- Produces: `Route.viewSpaceAlbums({ id }: { id: string }): string` → `/spaces/${id}/albums` (the album tab, consumed by Task 10's "See all")

- [ ] **Step 1: Write the failing tests**

Add to `web/src/lib/route.spec.ts` inside `describe('Route', () => { ... })`:

```ts
describe('viewSpaceAlbum', () => {
  it('links to an album inside a space', () => {
    expect(Route.viewSpaceAlbum({ spaceId: 'space-1', albumId: 'album-2' })).toBe('/spaces/space-1/albums/album-2');
  });

  it('links to a space albums tab', () => {
    expect(Route.viewSpaceAlbums({ id: 'space-1' })).toBe('/spaces/space-1/albums');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="$HOME/.local/share/mise/shims:$PATH" && cd web && pnpm test -- --run src/lib/route.spec.ts -t viewSpaceAlbum`
Expected: FAIL — `Route.viewSpaceAlbum is not a function`.

- [ ] **Step 3: Add the helpers**

In `web/src/lib/route.ts`, in the `// spaces` block (~`:127`, right after `viewSpace`):

```ts
  viewSpaceAlbums: ({ id }: { id: string }) => `/spaces/${id}/albums`,
  viewSpaceAlbum: ({ spaceId, albumId }: { spaceId: string; albumId: string }) => `/spaces/${spaceId}/albums/${albumId}`,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/route.spec.ts -t viewSpaceAlbum`
Expected: PASS (both cases — the `-t viewSpaceAlbum` filter matches the `viewSpaceAlbum` describe that now holds both).

- [ ] **Step 5: Migrate the three call sites**

`web/src/lib/components/spaces/space-album-card.svelte:49` — replace:

```svelte
  <a href="/spaces/{spaceId}/albums/{album.id}" data-testid="space-album-card-link">
```

with:

```svelte
  <a href={Route.viewSpaceAlbum({ spaceId, albumId: album.id })} data-testid="space-album-card-link">
```

Add `import { Route } from '$lib/route';` to that file's `<script>` if not already imported.

`web/src/lib/components/spaces/space-albums-table.svelte:41` — replace:

```svelte
        href="/spaces/{spaceId}/albums/{album.id}"
```

with:

```svelte
        href={Route.viewSpaceAlbum({ spaceId, albumId: album.id })}
```

Add `import { Route } from '$lib/route';` if not already imported.

`web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte:101` — replace:

```svelte
      await goto(`/spaces/${space.id}/albums/${newAlbum.id}`);
```

with:

```svelte
      await goto(Route.viewSpaceAlbum({ spaceId: space.id, albumId: newAlbum.id }));
```

Add `import { Route } from '$lib/route';` if not already imported.

- [ ] **Step 6: Verify existing call-site specs stay green**

Run: `cd web && pnpm test -- --run src/lib/components/spaces src/routes/\(user\)/spaces/\[spaceId\]/albums`
Expected: PASS — the rendered hrefs are byte-identical, so `space-albums-page.spec.ts` and any card/table specs still pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/route.ts web/src/lib/route.spec.ts web/src/lib/components/spaces/space-album-card.svelte web/src/lib/components/spaces/space-albums-table.svelte "web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte"
git commit -m "refactor(web): add Route.viewSpaceAlbum helper and use it (#816)"
```

---

## Task 5: Web — scaffolding (factory field, linked-album factory, `spaceAlbums` cache, i18n)

This task adds the data plumbing the sidebar consumes, with no behavior change yet. Each piece is exercised by later tasks; here we only extend shared fixtures/state and confirm the suite stays green.

**Files:**

- Modify: `web/src/test-data/factories/shared-space-factory.ts`
- Create: `web/src/test-data/factories/shared-space-linked-album-factory.ts`
- Modify: `web/src/lib/stores/user.svelte.ts` (interface + default)
- Modify: `i18n/en.json`

**Interfaces:**

- Produces: `sharedSpaceLinkedAlbumFactory` building `SharedSpaceLinkedAlbumDto`
- Produces: `userInteraction.spaceAlbums?: Record<string, SharedSpaceLinkedAlbumDto[]>`
- Produces: i18n key `failed_to_load_albums`

- [ ] **Step 1: Add `albumCount` to the shared-space factory**

In `web/src/test-data/factories/shared-space-factory.ts`, add to the factory object (after `newAssetCount`):

```ts
  albumCount: 0,
```

- [ ] **Step 2: Create the linked-album factory**

Create `web/src/test-data/factories/shared-space-linked-album-factory.ts`:

```ts
import { faker } from '@faker-js/faker';
import { AssetOrder, type SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { Sync } from 'factory.ts';

export const sharedSpaceLinkedAlbumFactory = Sync.makeFactory<SharedSpaceLinkedAlbumDto>({
  id: Sync.each(() => faker.string.uuid()),
  albumName: Sync.each(() => faker.commerce.product()),
  description: '',
  albumThumbnailAssetId: null,
  assetCount: Sync.each((i) => i % 5),
  createdAt: Sync.each(() => faker.date.past().toISOString()),
  updatedAt: Sync.each(() => faker.date.past().toISOString()),
  shared: false,
  hasSharedLink: false,
  isActivityEnabled: true,
  order: AssetOrder.Desc,
  ownerId: Sync.each(() => faker.string.uuid()),
  showInTimeline: true,
  addedById: Sync.each(() => faker.string.uuid()),
  linkedAt: Sync.each(() => faker.date.recent().toISOString()),
});
```

If `pnpm check` later reports a missing or extra property, reconcile the factory against the generated `SharedSpaceLinkedAlbumDto` in `packages/sdk/src/fetch-client.ts` — the generated type is the source of truth.

- [ ] **Step 3: Add the `spaceAlbums` cache to `userInteraction`**

In `web/src/lib/stores/user.svelte.ts`:

Add `SharedSpaceLinkedAlbumDto` to the type import:

```ts
import type {
  AlbumResponseDto,
  ServerAboutResponseDto,
  ServerStorageResponseDto,
  ServerVersionHistoryResponseDto,
  SharedSpaceLinkedAlbumDto,
  SharedSpaceResponseDto,
} from '@immich/sdk';
```

Add to the `UserInteractions` interface (after `recentSpaces`):

```ts
  spaceAlbums?: Record<string, SharedSpaceLinkedAlbumDto[]>;
```

Add to `defaultUserInteraction` (after `recentSpaces`):

```ts
  spaceAlbums: undefined,
```

(The `AuthLogout` → `reset()` handler already clears everything via `Object.assign(userInteraction, defaultUserInteraction)`, so `spaceAlbums` is cleared on logout with no extra wiring.)

- [ ] **Step 4: Add the i18n key**

In `i18n/en.json`, add (keep keys alphabetically sorted where the file is sorted):

```json
  "failed_to_load_albums": "Failed to load albums",
```

- [ ] **Step 5: Verify the suite still passes and types check**

Run:

```bash
cd web && pnpm test -- --run src/lib/stores/user.svelte.spec.ts && pnpm check:typescript
```

Expected: PASS; no type errors from the new factory or interface field.

- [ ] **Step 6: Commit**

```bash
git add web/src/test-data/factories/shared-space-factory.ts web/src/test-data/factories/shared-space-linked-album-factory.ts web/src/lib/stores/user.svelte.ts i18n/en.json
git commit -m "chore(web): scaffolding for space album drill-down (factory, cache, i18n) (#816)"
```

---

## Task 6: Web — `SpaceLinkAlbum` / `SpaceUnlinkAlbum` events and cache invalidation

**Files:**

- Modify: `web/src/lib/managers/event-manager.svelte.ts` (event map, ~`:50`)
- Modify: `web/src/lib/stores/user.svelte.ts` (event handlers, ~`:44`)
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte` (`handleUnlink` `:59`, `handleCreateAlbum` `:93`, `openLinkAlbumModal` `:109`)
- Test: `web/src/lib/stores/user.svelte.spec.ts`
- Test: `web/src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts`

**Interfaces:**

- Produces events: `SpaceLinkAlbum: [{ spaceId: string }]`, `SpaceUnlinkAlbum: [{ spaceId: string }]`
- Consumes: `userInteraction.spaceAlbums` (Task 5), `userInteraction.recentSpaces`

- [ ] **Step 1: Write the failing store-reset tests**

Add to `web/src/lib/stores/user.svelte.spec.ts` inside `describe('userInteraction.recentSpaces', () => { ... })`:

```ts
it('resets recentSpaces and drops the space album cache on SpaceLinkAlbum', () => {
  userInteraction.recentSpaces = [sharedSpaceFactory.build()];
  userInteraction.spaceAlbums = { s1: [], s2: [] };

  eventManager.emit('SpaceLinkAlbum', { spaceId: 's1' });

  expect(userInteraction.recentSpaces).toBeUndefined();
  expect(userInteraction.spaceAlbums?.s1).toBeUndefined();
  expect(userInteraction.spaceAlbums?.s2).toBeDefined();
});

it('resets recentSpaces and drops the space album cache on SpaceUnlinkAlbum', () => {
  userInteraction.recentSpaces = [sharedSpaceFactory.build()];
  userInteraction.spaceAlbums = { s1: [] };

  eventManager.emit('SpaceUnlinkAlbum', { spaceId: 's1' });

  expect(userInteraction.recentSpaces).toBeUndefined();
  expect(userInteraction.spaceAlbums?.s1).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test -- --run src/lib/stores/user.svelte.spec.ts -t "SpaceLinkAlbum"`
Expected: FAIL — `SpaceLinkAlbum` is not a known event (type error / emit no-op leaves state unchanged).

- [ ] **Step 3: Declare the events**

In `web/src/lib/managers/event-manager.svelte.ts`, next to the existing space events (~`:51`):

```ts
  SpaceAddAssets: [{ assetIds: string[]; spaceId: string }];
  SpaceRemoveAssets: [{ assetIds: string[]; spaceId: string }];
  SpaceLinkAlbum: [{ spaceId: string }];
  SpaceUnlinkAlbum: [{ spaceId: string }];
```

- [ ] **Step 4: Add the reset handlers**

In `web/src/lib/stores/user.svelte.ts`, add a helper next to `resetRecentSpaces` (~`:33`):

```ts
const dropSpaceAlbumCache = (spaceId: string) => {
  if (userInteraction.spaceAlbums) {
    const { [spaceId]: _removed, ...rest } = userInteraction.spaceAlbums;
    userInteraction.spaceAlbums = rest;
  }
};
```

Then extend the `eventManager.on({ ... })` map (~`:44`):

```ts
  SpaceAddAssets: () => resetRecentSpaces(),
  SpaceRemoveAssets: () => resetRecentSpaces(),
  SpaceLinkAlbum: ({ spaceId }) => {
    resetRecentSpaces();
    dropSpaceAlbumCache(spaceId);
  },
  SpaceUnlinkAlbum: ({ spaceId }) => {
    resetRecentSpaces();
    dropSpaceAlbumCache(spaceId);
  },
```

- [ ] **Step 5: Run the store tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/stores/user.svelte.spec.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing page-emit tests**

In `web/src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts`, import the **real** event manager near the other imports:

```ts
import { eventManager } from '$lib/managers/event-manager.svelte';
```

Do **not** `vi.mock` the whole module — the page and its child components call `eventManager.on(...)` during mount, and replacing the module with `{ emit: vi.fn() }` would break those subscriptions. Instead spy on `emit` per test (it still calls through, so real handlers run harmlessly).

Add a new `describe` (mirror the existing unlink/link test setup at `:215-335` for how the page is rendered and the confirm dialog resolved):

```ts
describe('album link/unlink events', () => {
  it('emits SpaceUnlinkAlbum after a confirmed unlink', async () => {
    const emitSpy = vi.spyOn(eventManager, 'emit');
    // ...render the page with a linked album and a space where the user is owner/editor,
    // resolve the confirm dialog to true, click the unlink control (copy setup from the
    // existing 'unlink: after confirm resolves true, calls unlinkAlbum' test at ~:215)...
    sdkMock.unlinkAlbum.mockResolvedValue(undefined as never);

    // trigger unlink here (same interaction as the existing unlink test)

    await waitFor(() => expect(emitSpy).toHaveBeenCalledWith('SpaceUnlinkAlbum', { spaceId: 'space-1' }));
  });

  it('emits SpaceLinkAlbum after creating and linking a new album', async () => {
    const emitSpy = vi.spyOn(eventManager, 'emit');
    // ...copy setup from the existing 'linkAlbum' create test at ~:323...
    sdkMock.linkAlbum.mockResolvedValue(undefined as never);

    // trigger the create-album flow here (same interaction as the existing create test)

    await waitFor(() => expect(emitSpy).toHaveBeenCalledWith('SpaceLinkAlbum', { spaceId: BASE_SPACE.id }));
  });
});
```

> Implementer note: reuse the exact render/interaction lines from the neighbouring tests at `:215` (unlink) and `:323` (create+link) — they already establish `BASE_SPACE`, the modal manager mock, and the confirm-dialog resolution. Only the `emitSpy` assertion is new. If the file's `beforeEach` calls `vi.restoreAllMocks()`, the per-test `vi.spyOn` is already isolated; otherwise add `emitSpy.mockRestore()` at the end of each test.

- [ ] **Step 7: Run to verify failure**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts" -t "events"`
Expected: FAIL — the page does not emit yet.

- [ ] **Step 8: Emit from the three page handlers**

In `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte`, add the import:

```ts
import { eventManager } from '$lib/managers/event-manager.svelte';
```

`handleUnlink` — after `await unlinkAlbum({ id: space.id, albumId: album.id });` (`:68`):

```ts
await unlinkAlbum({ id: space.id, albumId: album.id });
eventManager.emit('SpaceUnlinkAlbum', { spaceId: space.id });
```

`handleCreateAlbum` — after `await linkAlbum({ id: space.id, albumId: newAlbum.id });` (`:99`):

```ts
await linkAlbum({ id: space.id, albumId: newAlbum.id });
eventManager.emit('SpaceLinkAlbum', { spaceId: space.id });
```

`openLinkAlbumModal` — inside `if (linkedCount) { ... }` (`:116`), alongside the existing reload/invalidate:

```ts
if (linkedCount) {
  eventManager.emit('SpaceLinkAlbum', { spaceId: space.id });
  await reload();
  await invalidateAll();
}
```

- [ ] **Step 9: Run the page tests to verify they pass**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts"`
Expected: PASS — new event tests green and all existing link/unlink tests still green.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/managers/event-manager.svelte.ts web/src/lib/stores/user.svelte.ts web/src/lib/stores/user.svelte.spec.ts "web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte" "web/src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts"
git commit -m "feat(web): invalidate sidebar cache on space album link/unlink (#816)"
```

---

## Task 7: Web — per-space expansion store with prune-on-write

**Files:**

- Modify: `web/src/lib/stores/preferences.store.ts` (~`:158`)
- Create: `web/src/lib/stores/preferences.store.spec.ts` (only if none exists; otherwise append)

**Interfaces:**

- Produces: `recentSpaceAlbumsExpanded` — a `persisted<Record<string, boolean>>('recent-space-albums-open', {})`
- Produces: `setSpaceAlbumsExpanded(spaceId: string, expanded: boolean, validSpaceIds: string[]): void` — sets the flag and prunes keys not in `validSpaceIds`
- Produces: `isSpaceAlbumsExpanded(state: Record<string, boolean>, spaceId: string): boolean`

- [ ] **Step 1: Write the failing store tests**

Create (or append to) `web/src/lib/stores/preferences.store.spec.ts`:

```ts
import { get } from 'svelte/store';
import { recentSpaceAlbumsExpanded, setSpaceAlbumsExpanded } from '$lib/stores/preferences.store';

describe('recentSpaceAlbumsExpanded', () => {
  beforeEach(() => {
    recentSpaceAlbumsExpanded.set({});
  });

  it('defaults to collapsed (missing key)', () => {
    expect(get(recentSpaceAlbumsExpanded)['space-1']).toBeUndefined();
  });

  it('setSpaceAlbumsExpanded records the flag for a space', () => {
    setSpaceAlbumsExpanded('space-1', true, ['space-1', 'space-2']);
    expect(get(recentSpaceAlbumsExpanded)['space-1']).toBe(true);
  });

  it('prunes keys for spaces no longer in the valid set', () => {
    setSpaceAlbumsExpanded('space-1', true, ['space-1', 'gone-1']);
    expect(get(recentSpaceAlbumsExpanded)['gone-1']).toBeUndefined();

    // 'gone-1' had been expanded earlier; a later write with a set that excludes it removes it
    setSpaceAlbumsExpanded('gone-1', true, ['gone-1']); // seed it
    setSpaceAlbumsExpanded('space-1', false, ['space-1']); // valid set excludes gone-1
    expect(get(recentSpaceAlbumsExpanded)['gone-1']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test -- --run src/lib/stores/preferences.store.spec.ts`
Expected: FAIL — `recentSpaceAlbumsExpanded` / `setSpaceAlbumsExpanded` are not exported.

- [ ] **Step 3: Implement the store and helpers**

In `web/src/lib/stores/preferences.store.ts`, after `recentSpacesDropdown` (~`:158`):

```ts
export const recentSpaceAlbumsExpanded = persisted<Record<string, boolean>>('recent-space-albums-open', {}, {});

export const isSpaceAlbumsExpanded = (state: Record<string, boolean>, spaceId: string): boolean =>
  state[spaceId] === true;

export const setSpaceAlbumsExpanded = (spaceId: string, expanded: boolean, validSpaceIds: string[]): void => {
  recentSpaceAlbumsExpanded.update((state) => {
    const valid = new Set(validSpaceIds);
    const next: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(state)) {
      if (valid.has(id)) {
        next[id] = value;
      }
    }
    next[spaceId] = expanded;
    return next;
  });
};
```

- [ ] **Step 4: Run to verify passing**

Run: `cd web && pnpm test -- --run src/lib/stores/preferences.store.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/stores/preferences.store.ts web/src/lib/stores/preferences.store.spec.ts
git commit -m "feat(web): per-space album expansion store with prune-on-write (#816)"
```

---

## Task 8: Web — sidebar chevron (present iff `albumCount > 0`)

**Files:**

- Modify: `web/src/lib/components/shared-components/side-bar/recent-spaces.svelte`
- Test: `web/src/lib/components/shared-components/side-bar/recent-spaces.spec.ts`

**Interfaces:**

- Consumes: `space.albumCount` (Task 1 DTO), `recentSpaceAlbumsExpanded` / `setSpaceAlbumsExpanded` (Task 7)
- Produces: chevron button `data-testid="sidebar-space-chevron-{spaceId}"` rendered only when `albumCount > 0`

- [ ] **Step 1: Write the failing tests**

Add to `web/src/lib/components/shared-components/side-bar/recent-spaces.spec.ts` a new describe:

```ts
describe('album drill-down chevron', () => {
  it('shows a chevron when albumCount > 0', async () => {
    const space = sharedSpaceFactory.build({ id: 'has-albums', albumCount: 2 });
    sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
    await renderAndFlush();

    expect(screen.getByTestId('sidebar-space-chevron-has-albums')).toBeInTheDocument();
  });

  it('shows no chevron when albumCount is 0', async () => {
    const space = sharedSpaceFactory.build({ id: 'no-albums', albumCount: 0 });
    sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
    await renderAndFlush();

    expect(screen.queryByTestId('sidebar-space-chevron-no-albums')).not.toBeInTheDocument();
  });

  it('shows no chevron when albumCount is undefined', async () => {
    const space = sharedSpaceFactory.build({ id: 'undef-albums' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (space as any).albumCount = undefined;
    sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
    await renderAndFlush();

    expect(screen.queryByTestId('sidebar-space-chevron-undef-albums')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test -- --run src/lib/components/shared-components/side-bar/recent-spaces.spec.ts -t "chevron"`
Expected: FAIL — no chevron testid rendered.

- [ ] **Step 3: Add the chevron to the component**

In `web/src/lib/components/shared-components/side-bar/recent-spaces.svelte`:

Extend the `<script>` imports:

```ts
import {
  isSpaceAlbumsExpanded,
  recentSpaceAlbumsExpanded,
  setSpaceAlbumsExpanded,
} from '$lib/stores/preferences.store';
import { Icon } from '@immich/ui';
import { mdiChevronDown, mdiChevronRight } from '@mdi/js';
```

Add a derived list of the current top-3 space ids and a toggle handler (in the `<script>`, after the `spaces` derived):

```ts
const topSpaceIds = $derived(spaces.map((s) => s.id));

const toggleAlbums = (spaceId: string) => {
  const expanded = !isSpaceAlbumsExpanded($recentSpaceAlbumsExpanded, spaceId);
  setSpaceAlbumsExpanded(spaceId, expanded, topSpaceIds);
};
```

Inside the `{#each spaces as space (space.id)}` block, wrap the existing `<a>` in a container and add the chevron as a sibling. Replace the opening of the each block so the row and its (future) album list live in one wrapper:

```svelte
{#each spaces as space (space.id)}
  {@const active = page.url.pathname.startsWith(`/spaces/${space.id}`)}
  {@const hasAlbums = (space.albumCount ?? 0) > 0}
  {@const expanded = isSpaceAlbumsExpanded($recentSpaceAlbumsExpanded, space.id)}
  <div class="relative">
    {#if hasAlbums}
      <button
        type="button"
        aria-label={expanded ? $t('collapse') : $t('expand')}
        aria-expanded={expanded}
        data-testid="sidebar-space-chevron-{space.id}"
        class="absolute start-2 top-1/2 z-10 hidden -translate-y-1/2 rounded-lg p-0.5 hover:bg-subtle md:block"
        onclick={() => toggleAlbums(space.id)}
      >
        <Icon icon={expanded ? mdiChevronDown : mdiChevronRight} size="1.25em" />
      </button>
    {/if}
    <a
      href={Route.viewSpace({ id: space.id })}
      ...existing attributes unchanged...
    >
      ...existing row contents unchanged...
    </a>
  </div>
{/each}
```

> Keep every existing attribute and child of the `<a>` exactly as-is — only wrap it in `<div class="relative">` and add the chevron button before it. The chevron is `absolute z-10` over the row's start padding (the `<a>` keeps `ps-10`, so the thumbnail begins ~40px in and the chevron at `start-2` clears it); because the chevron is a sibling `<button>` with `z-10`, clicking it toggles without navigating, while the rest of the row still follows the link. The `collapse` / `expand` i18n keys already exist (used by `@immich/ui`'s NavbarItem); confirm with `grep '"collapse"\|"expand"' i18n/en.json` and add them only if missing.

> **Visual check (not unit-testable):** the chevron offset (`start-2`) and the album-row indent (`ps-14`) are layout choices happy-dom cannot verify. After this task and Task 9, run the app (`make dev`, or the `run` skill) and eyeball the sidebar: chevron should not overlap the thumbnail, and album rows should sit one clear level under their space. Adjust `start-*` / `ps-*` if needed.

- [ ] **Step 4: Run to verify passing**

Run: `cd web && pnpm test -- --run src/lib/components/shared-components/side-bar/recent-spaces.spec.ts`
Expected: PASS — new chevron tests green, all existing RecentSpaces tests still green (the `<a>` rows are unchanged, so `getAllByRole('link')` counts hold).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/shared-components/side-bar/recent-spaces.svelte web/src/lib/components/shared-components/side-bar/recent-spaces.spec.ts
git commit -m "feat(web): sidebar chevron on spaces with linked albums (#816)"
```

---

## Task 9: Web — expand to fetch, cache, and render album rows

**Files:**

- Modify: `web/src/lib/components/shared-components/side-bar/recent-spaces.svelte`
- Test: `web/src/lib/components/shared-components/side-bar/recent-spaces.spec.ts`

**Interfaces:**

- Consumes: `getSharedSpaceAlbums` (SDK), `userInteraction.spaceAlbums` (Task 5), `Route.viewSpaceAlbum` (Task 4)
- Produces: album rows `data-testid="sidebar-space-album-{albumId}"`

- [ ] **Step 1: Write the failing tests**

Add to `recent-spaces.spec.ts`. Import the linked-album factory at the top:

```ts
import { sharedSpaceLinkedAlbumFactory } from '@test-data/factories/shared-space-linked-album-factory';
import { recentSpaceAlbumsExpanded } from '$lib/stores/preferences.store';
import { fireEvent } from '@testing-library/svelte';
```

Reset the expansion store in `beforeEach`:

```ts
recentSpaceAlbumsExpanded.set({});
userInteraction.spaceAlbums = undefined;
```

New describe:

```ts
describe('album drill-down list', () => {
  const buildSpaceWithAlbums = (albums: number) =>
    sharedSpaceFactory.build({ id: 'space-a', albumCount: albums, newAssetCount: 0 });

  it('fetches albums once on first expand and caches on the second', async () => {
    const space = buildSpaceWithAlbums(2);
    const albums = sharedSpaceLinkedAlbumFactory.buildList(2);
    sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue(albums);
    await renderAndFlush();

    await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
    await tick();
    await tick();
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 'space-a' });

    // collapse then expand again — served from cache, no second call
    await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
    await tick();
    await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
    await tick();
    await tick();
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
  });

  it('renders albums sorted by linkedAt descending, sliced to three', async () => {
    const space = buildSpaceWithAlbums(4);
    const albums = [
      sharedSpaceLinkedAlbumFactory.build({ id: 'old', albumName: 'Old', linkedAt: '2024-01-01T00:00:00Z' }),
      sharedSpaceLinkedAlbumFactory.build({ id: 'new', albumName: 'New', linkedAt: '2024-06-01T00:00:00Z' }),
      sharedSpaceLinkedAlbumFactory.build({ id: 'mid', albumName: 'Mid', linkedAt: '2024-03-01T00:00:00Z' }),
      sharedSpaceLinkedAlbumFactory.build({ id: 'older', albumName: 'Older', linkedAt: '2023-01-01T00:00:00Z' }),
    ];
    sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue(albums);
    await renderAndFlush();

    await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
    await tick();
    await tick();

    const rows = screen.getAllByTestId(/^sidebar-space-album-/);
    expect(rows.map((r) => r.getAttribute('href'))).toEqual([
      '/spaces/space-a/albums/new',
      '/spaces/space-a/albums/mid',
      '/spaces/space-a/albums/old',
    ]);
  });

  it('renders nothing when the fetch resolves empty despite a stale albumCount > 0', async () => {
    const space = buildSpaceWithAlbums(2); // stale count says 2...
    sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([]); // ...but the space actually has none now
    await renderAndFlush();

    await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
    await tick();
    await tick();

    // No album rows, no "See all", no crash — the derived `expanded` collapses on an empty result.
    expect(screen.queryAllByTestId(/^sidebar-space-album-/)).toHaveLength(0);
    expect(screen.queryByTestId('sidebar-space-see-all-space-a')).not.toBeInTheDocument();
    // Cached empty → a second expand does not refetch.
    await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
    await tick();
    await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
    await tick();
    await tick();
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledTimes(1);
  });

  it('toasts and collapses on fetch failure', async () => {
    const space = buildSpaceWithAlbums(1);
    sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
    sdkMock.getSharedSpaceAlbums.mockRejectedValueOnce(new Error('nope'));
    await renderAndFlush();

    await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
    await tick();
    await tick();

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), expect.any(String));
    expect(screen.queryAllByTestId(/^sidebar-space-album-/)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test -- --run src/lib/components/shared-components/side-bar/recent-spaces.spec.ts -t "drill-down list"`
Expected: FAIL — no fetch, no album rows.

- [ ] **Step 3: Implement fetch + cache + render**

In `recent-spaces.svelte` `<script>`, extend imports:

```ts
import { getAllSpaces, getSharedSpaceAlbums, UserAvatarColor } from '@immich/sdk';
```

Add fetch-on-expand logic. The `toggleAlbums` below **replaces the stub from Task 8** (it now also triggers the fetch). `loadAlbums` fetches once and caches (including an empty result, so we never refetch). It does **not** imperatively collapse on empty — the derived `expanded` (below) handles that declaratively. Only the error path collapses, and it leaves the cache unset so a later expand retries:

```ts
const loadAlbums = async (spaceId: string) => {
  if (userInteraction.spaceAlbums?.[spaceId]) {
    return; // already fetched (possibly an empty list) — never refetch
  }
  try {
    const albums = await getSharedSpaceAlbums({ id: spaceId });
    const sorted = [...albums].sort((a, b) => (a.linkedAt > b.linkedAt ? -1 : a.linkedAt < b.linkedAt ? 1 : 0));
    userInteraction.spaceAlbums = { ...(userInteraction.spaceAlbums ?? {}), [spaceId]: sorted };
  } catch (error) {
    handleError(error, $t('failed_to_load_albums'));
    setSpaceAlbumsExpanded(spaceId, false, topSpaceIds); // cache stays unset → retry on next expand
  }
};

const toggleAlbums = (spaceId: string) => {
  const nowExpanded = !isSpaceAlbumsExpanded($recentSpaceAlbumsExpanded, spaceId);
  setSpaceAlbumsExpanded(spaceId, nowExpanded, topSpaceIds);
  if (nowExpanded) {
    void loadAlbums(spaceId);
  }
};
```

Now make `expanded` (the `{@const}` from Task 8, used for both the chevron icon and the `{#if}`) also account for the fetched result, so an **empty** fetched list renders as collapsed with no dangling open chevron. Replace the Task 8 `expanded` line inside the `{#each}`:

```svelte
  {@const cachedAlbums = userInteraction.spaceAlbums?.[space.id]}
  {@const expanded =
    isSpaceAlbumsExpanded($recentSpaceAlbumsExpanded, space.id) && (cachedAlbums === undefined || cachedAlbums.length > 0)}
```

`userInteraction.spaceAlbums` is a Svelte 5 `$state` proxy, so reading `cachedAlbums` here creates a reactive dependency — when `loadAlbums` reassigns it, `expanded` re-derives with no extra plumbing. Truth table: not fetched (`undefined`) → follows the persisted flag (lets the first expand trigger the fetch); fetched non-empty → expanded; fetched empty → collapsed regardless of the persisted flag.

Render the album rows inside the `<div class="relative">`, after the `<a>` space row, when expanded (`getAssetMediaUrl` is already imported):

```svelte
    {#if expanded}
      {#each (cachedAlbums ?? []).slice(0, 3) as album (album.id)}
        <a
          href={Route.viewSpaceAlbum({ spaceId: space.id, albumId: album.id })}
          title={album.albumName}
          data-testid="sidebar-space-album-{album.id}"
          class="flex w-full place-items-center gap-4 rounded-e-full py-2 ps-14 hover:cursor-pointer hover:bg-subtle hover:text-immich-primary dark:text-immich-dark-fg dark:hover:bg-immich-dark-gray dark:hover:text-immich-dark-primary"
        >
          <div
            class="size-6 rounded-sm bg-gray-200 bg-cover dark:bg-gray-600"
            style={album.albumThumbnailAssetId
              ? `background-image:url('${getAssetMediaUrl({ id: album.albumThumbnailAssetId })}')`
              : ''}
          ></div>
          <div class="grow truncate text-sm font-medium">{album.albumName}</div>
        </a>
      {/each}
    {/if}
```

- [ ] **Step 4: Run to verify passing**

Run: `cd web && pnpm test -- --run src/lib/components/shared-components/side-bar/recent-spaces.spec.ts`
Expected: PASS — all drill-down list tests green; existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/shared-components/side-bar/recent-spaces.svelte web/src/lib/components/shared-components/side-bar/recent-spaces.spec.ts
git commit -m "feat(web): lazily fetch and render linked albums under spaces (#816)"
```

---

## Task 10: Web — "See all" overflow row

**Files:**

- Modify: `web/src/lib/components/shared-components/side-bar/recent-spaces.svelte`
- Test: `web/src/lib/components/shared-components/side-bar/recent-spaces.spec.ts`
- Modify: `i18n/en.json`

**Interfaces:**

- Produces: overflow row `data-testid="sidebar-space-see-all-{spaceId}"` → `/spaces/{spaceId}/albums`, shown only when the fetched list length > 3, labelled with the fetched length.

- [ ] **Step 1: Write the failing tests**

Add to the `describe('album drill-down list', ...)` block in `recent-spaces.spec.ts`:

```ts
it('shows no "See all" row at exactly three albums', async () => {
  const space = sharedSpaceFactory.build({ id: 'space-a', albumCount: 3, newAssetCount: 0 });
  sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
  sdkMock.getSharedSpaceAlbums.mockResolvedValue(sharedSpaceLinkedAlbumFactory.buildList(3));
  await renderAndFlush();

  await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
  await tick();
  await tick();

  expect(screen.queryByTestId('sidebar-space-see-all-space-a')).not.toBeInTheDocument();
});

it('shows a "See all (N)" row above three albums using the fetched length', async () => {
  const space = sharedSpaceFactory.build({ id: 'space-a', albumCount: 3, newAssetCount: 0 }); // stale count
  sdkMock.getAllSpaces.mockResolvedValueOnce([space]);
  sdkMock.getSharedSpaceAlbums.mockResolvedValue(sharedSpaceLinkedAlbumFactory.buildList(5)); // fetched truth
  await renderAndFlush();

  await fireEvent.click(screen.getByTestId('sidebar-space-chevron-space-a'));
  await tick();
  await tick();

  const seeAll = screen.getByTestId('sidebar-space-see-all-space-a');
  expect(seeAll).toHaveAttribute('href', '/spaces/space-a/albums');
  expect(seeAll.textContent).toContain('5');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test -- --run src/lib/components/shared-components/side-bar/recent-spaces.spec.ts -t "See all"`
Expected: FAIL — no see-all row.

- [ ] **Step 3: Add the i18n key**

In `i18n/en.json`:

```json
  "sidebar_space_see_all_albums": "See all ({count})",
```

- [ ] **Step 4: Render the overflow row**

In `recent-spaces.svelte`, inside the `{#if expanded}` block, after the album `{#each}` (still inside the `<div class="relative">`). Uses `cachedAlbums` (defined in Task 9) as the length source of truth, and the `Route.viewSpaceAlbums` tab helper added in Task 4:

```svelte
      {#if (cachedAlbums?.length ?? 0) > 3}
        <a
          href={Route.viewSpaceAlbums({ id: space.id })}
          data-testid="sidebar-space-see-all-{space.id}"
          class="flex w-full place-items-center rounded-e-full py-2 ps-14 text-sm font-medium text-immich-primary hover:bg-subtle dark:text-immich-dark-primary"
        >
          {$t('sidebar_space_see_all_albums', { values: { count: cachedAlbums?.length ?? 0 } })}
        </a>
      {/if}
```

- [ ] **Step 5: Run to verify passing**

Run: `cd web && pnpm test -- --run src/lib/components/shared-components/side-bar/recent-spaces.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/shared-components/side-bar/recent-spaces.svelte web/src/lib/components/shared-components/side-bar/recent-spaces.spec.ts i18n/en.json
git commit -m "feat(web): 'See all' overflow row under spaces with >3 albums (#816)"
```

---

## Task 11: Full verification gate

**Files:** none (verification only). Fix any failure in the owning task before proceeding.

- [ ] **Step 1: Server unit + type + lint**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH" && cd server && pnpm test -- --run src/services/shared-space.service.spec.ts && pnpm check && pnpm lint
```

Expected: all green.

- [ ] **Step 2: Server medium test**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-getlinkedalbums.medium.spec.ts`
Expected: PASS (Docker required).

- [ ] **Step 3: Web unit + type + lint**

Run:

```bash
cd web && pnpm test -- --run src/lib/components/shared-components/side-bar src/lib/stores src/lib/route.spec.ts "src/routes/(user)/spaces/[spaceId]/albums" && pnpm check:typescript && pnpm lint
```

Expected: all green.

- [ ] **Step 4: Prettier on every modified file**

Run:

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat-space-album-drilldown && npx prettier --check $(git diff --name-only main...HEAD | grep -E '\.(ts|svelte|json|md)$')
```

Expected: "All matched files use Prettier code style!" — if not, `prettier --write` the offenders and amend the owning commit.

- [ ] **Step 5: Confirm SDK clients are not stale**

Run: `git diff --stat main...HEAD -- packages/sdk mobile/openapi open-api`
Expected: shows the Task 3 regen only; if server DTOs changed after Task 3, re-run Task 3's steps.

- [ ] **Step 6: Mobile Dart analyze (Dart client changed)**

Run (from `mobile/`, Flutter 3.41.7 per CLAUDE.md):

```bash
cd mobile && dart analyze --fatal-infos lib test
```

Expected: no new issues from the regenerated `shared_space_response_dto.dart`.

---

## Self-Review (completed by plan author)

**Spec coverage:**

- `albumCount` DTO + repo + getAll → Task 1 ✓ (unit + medium, incl. per-space isolation and soft-delete exclusion)
- `lastActivityAt` bump inside `if (result)`, no bump on re-link/unlink → Task 2 ✓
- SDK regen (TS + Dart) → Task 3 ✓
- `Route.viewSpaceAlbum` (album) + `Route.viewSpaceAlbums` (tab) + 3 call sites → Task 4 ✓
- `SpaceLinkAlbum`/`SpaceUnlinkAlbum` events + emits from all three page handlers + cache reset → Task 6 ✓
- Per-space persisted expansion with prune-on-write → Task 7 ✓
- Chevron only when `albumCount > 0` (0 and undefined) → Task 8 ✓
- Lazy fetch, cache-once, sort by `linkedAt` desc, slice 3, thumbnail/name, error toast → Task 9 ✓
- Empty-fetch collapse (resolves `[]` with stale count) → Task 9 ✓ (declarative via derived `expanded`; asserted explicitly)
- "See all (N)" using fetched length, absent at 3 / present at 4 → Task 10 ✓
- `failed_to_load_albums` i18n → Task 5 ✓; `sidebar_space_see_all_albums` → Task 10 ✓
- Verification gates (server/web/medium/prettier/openapi/dart) → Task 11 ✓

**Deliberately deferred / documented (not gaps):**

- Cross-user real-time updates: out of scope per spec (matches today's local-emit asset behavior).
- Chevron/indent pixel placement: not unit-testable — Task 8 carries an explicit in-browser visual-check step.

**Correctness fixes applied during plan review (verified against source):**

- `linkAlbum` already logs an `AlbumLink` activity (`:755-761`) — the bump is additive inside `if (result)`; there is no "no activity log" assertion (it would be false).
- `NavbarItem` renders an mdi icon only, not the space thumbnail — the chevron is hand-rolled, the `<a>` row is untouched.
- `getLinkedAlbumCount` joins `album` and filters `deletedAt is null` to match `getLinkedAlbums`, so count and list agree (soft-delete case covered by the medium test).
- Page-emit tests use `vi.spyOn(eventManager, 'emit')`, not a full `vi.mock` of the module — the page's child components subscribe via `eventManager.on(...)` at mount and a full mock would break them.
- The empty-fetch collapse is declarative (derived `expanded` folds in `cachedAlbums.length`), avoiding a fragile imperative double-collapse that misbehaved on re-expand of a cached-empty space.

**Type consistency:** `getLinkedAlbumCount(spaceId): Promise<number>` (Task 1) is called and mocked identically. `SpaceLinkAlbum`/`SpaceUnlinkAlbum` payload `{ spaceId: string }` is declared, emitted, and asserted identically (Task 6). `setSpaceAlbumsExpanded(spaceId, expanded, validSpaceIds)` (Task 7) matches its calls in `recent-spaces.svelte` (Tasks 8–10). `Route.viewSpaceAlbum({ spaceId, albumId })` and `Route.viewSpaceAlbums({ id })` (Task 4) match every call site.
