# Space Albums Phase 1.6 — Slice 1: Linked-Album Live Add/Remove People Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When photos are added to or removed from an album that is linked to one or more shared spaces, keep each space's people in sync — add → queue per-asset face match for every face-enabled linked space; remove → clean up space-people that lose their only path into the space.

**Architecture:** Event-driven seam. `album.service` (upstream) emits thin `AlbumAssetsAdd` / `AlbumAssetsRemove` events after a successful DB mutation; `shared-space.service` (fork) handles them via `@OnEvent`, reusing existing repository primitives and the private `queueSpacePersonMetadataBackfill` helper. A new repository method `getAssetIdsWithoutOtherSpacePath` provides per-asset multi-path orphan detection.

**Tech Stack:** NestJS 11, Kysely, BullMQ jobs, Vitest (unit + medium/testcontainers). Spec: `docs/superpowers/specs/2026-06-14-space-albums-phase-1.6-linked-album-live-sync-and-viewer-design.md` §4 (Slice 1 / Section A).

---

## Spec linchpin (already verified, do not change)

`processSpaceFaceMatch` (shared-space.service.ts) early-returns unless `isAssetInSpace(spaceId, assetId)` is true, and `isAssetInSpace` **already includes the album union branch** (`shared_space_album → album_asset → asset`). Therefore the queued `SharedSpaceFaceMatch` does real work for album-only assets, AND a stale job after a concurrent unlink creates no ghost (the guard returns early). Task 5 includes a regression test pinning this.

## File structure

- **Modify** `server/src/repositories/event.repository.ts` — add two entries to the `EventMap` `// album events` block.
- **Modify** `server/src/repositories/shared-space.repository.ts` — add `getAssetIdsWithoutOtherSpacePath`; drop the now-stale "Reserved for Phase 2" comment above `getSpacesLinkedToAlbum`.
- **Modify** `server/src/services/shared-space.service.ts` — add `@OnEvent` handlers `onAlbumAssetsAdd` / `onAlbumAssetsRemove`; add `OnEvent` + `ArgOf` imports.
- **Modify** `server/src/services/album.service.ts` — emit `AlbumAssetsAdd` in `addAssets` and `addAssetsToAlbums`; emit `AlbumAssetsRemove` in `removeAssets`.
- **Test (unit)** `server/src/services/shared-space.service.spec.ts` — handler unit tests.
- **Test (unit)** `server/src/services/album.service.spec.ts` — emit unit tests.
- **Test (medium)** `server/test/medium/specs/repositories/shared-space.repository.spec.ts` — `getAssetIdsWithoutOtherSpacePath` cases.
- **Test (medium)** `server/test/medium/specs/services/shared-space-album.service.spec.ts` — add/remove end-to-end + linchpin regression.
- **Test (e2e, infra-gated)** `e2e/src/specs/web/spaces-albums.e2e-spec.ts` — real-API add → person appears.

Run all server commands from `server/`. Run e2e from `e2e/`.

---

## Task 1: Repository — `getAssetIdsWithoutOtherSpacePath`

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`
- Test: `server/test/medium/specs/repositories/shared-space.repository.spec.ts`

- [ ] **Step 1: Write the failing medium test**

Append to `server/test/medium/specs/repositories/shared-space.repository.spec.ts` (inside the top-level `describe`, after the last test; reuse the file's existing `setup()` → `{ ctx, sut }` and `defaultDatabase`):

```typescript
describe('getAssetIdsWithoutOtherSpacePath', () => {
  it('returns only assets with no remaining path into the space', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });

    const { result: albumA } = await ctx.newAlbum({ ownerId: user.id, albumName: 'A' });
    const { result: albumB } = await ctx.newAlbum({ ownerId: user.id, albumName: 'B' });

    // orphan: only ever in albumA (which we treat as already-removed below)
    const { asset: orphan } = await ctx.newAsset({ ownerId: user.id });
    // direct: also directly added to the space
    const { asset: direct } = await ctx.newAsset({ ownerId: user.id });
    // otherAlbum: also in albumB which is linked to the space
    const { asset: otherAlbum } = await ctx.newAsset({ ownerId: user.id });

    await sut.addAlbum({ spaceId: space.id, albumId: albumA.id, addedById: user.id });
    await sut.addAlbum({ spaceId: space.id, albumId: albumB.id, addedById: user.id });

    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: direct.id });
    await ctx.newAlbumAsset({ albumId: albumB.id, assetId: otherAlbum.id });

    // Simulate "removed from albumA": none of the three are in albumA anymore.
    const result = await sut.getAssetIdsWithoutOtherSpacePath(space.id, [orphan.id, direct.id, otherAlbum.id]);

    expect(result).toEqual([orphan.id]);
  });

  it('returns [] for an empty asset list', async () => {
    const { sut } = setup();
    await expect(sut.getAssetIdsWithoutOtherSpacePath('00000000-0000-0000-0000-000000000000', [])).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts -t "getAssetIdsWithoutOtherSpacePath"`
Expected: FAIL — `sut.getAssetIdsWithoutOtherSpacePath is not a function`.

- [ ] **Step 3: Implement the repository method**

In `server/src/repositories/shared-space.repository.ts`, add this method directly after the existing `getAlbumAssetIdsWithoutOtherSpacePath` method (it already imports `DummyValue` and `GenerateSql`):

```typescript
// Per-asset analogue of getAlbumAssetIdsWithoutOtherSpacePath. Call AFTER the album_asset
// rows for the removed assets are deleted, so "any linked album" already excludes the album
// they were removed from. Returns the subset of assetIds with NO remaining space path.
@GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
async getAssetIdsWithoutOtherSpacePath(spaceId: string, assetIds: string[]): Promise<string[]> {
  if (assetIds.length === 0) {
    return [];
  }
  const rows = await this.db
    .selectFrom('asset')
    .select('asset.id')
    .where('asset.id', 'in', assetIds)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('shared_space_asset')
            .whereRef('shared_space_asset.assetId', '=', 'asset.id')
            .where('shared_space_asset.spaceId', '=', spaceId),
        ),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('shared_space_album')
            .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
            .whereRef('album_asset.assetId', '=', 'asset.id')
            .where('shared_space_album.spaceId', '=', spaceId),
        ),
      ),
    )
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('shared_space_library')
            .innerJoin('asset as libAsset', 'libAsset.libraryId', 'shared_space_library.libraryId')
            .whereRef('libAsset.id', '=', 'asset.id')
            .where('shared_space_library.spaceId', '=', spaceId),
        ),
      ),
    )
    .execute();
  return rows.map((r) => r.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts -t "getAssetIdsWithoutOtherSpacePath"`
Expected: PASS (both cases).

- [ ] **Step 5: Sync SQL docs**

Run: `pnpm sql`
Expected: regenerates SQL docs for the new `@GenerateSql` method; stage the produced diff.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/test/medium/specs/repositories/shared-space.repository.spec.ts server/src/queries
git commit -m "feat(spaces): add getAssetIdsWithoutOtherSpacePath repo method (slice 1)"
```

(If `pnpm sql` writes elsewhere than `server/src/queries`, stage the actual changed path it reports.)

---

## Task 2: Event types

**Files:**

- Modify: `server/src/repositories/event.repository.ts`

- [ ] **Step 1: Add the event declarations**

In `server/src/repositories/event.repository.ts`, in the `EventMap` type, immediately after the `// album events` lines (`AlbumUpdate` / `AlbumInvite`), add:

```typescript
  AlbumAssetsAdd: [{ albumId: string; assetIds: string[] }];
  AlbumAssetsRemove: [{ albumId: string; assetIds: string[] }];
```

- [ ] **Step 2: Verify it type-checks**

Run: `make check-server`
Expected: PASS (no type errors). This is a type-only addition with no behavior yet; no separate runtime test. The emit/handler tests in Tasks 3–4 exercise it.

- [ ] **Step 3: Commit**

```bash
git add server/src/repositories/event.repository.ts
git commit -m "feat(spaces): add AlbumAssetsAdd/Remove event types (slice 1)"
```

---

## Task 3: Service — `@OnEvent` handlers in shared-space.service

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Test: `server/src/services/shared-space.service.spec.ts`

- [ ] **Step 1: Write the failing unit tests**

Add to `server/src/services/shared-space.service.spec.ts` (the file already sets up `{ sut, mocks } = newTestService(SharedSpaceService)` in `beforeEach`; `JobName` is imported from `src/enum`; add `import { newUuid } from 'test/small.factory';` if not present):

```typescript
describe('onAlbumAssetsAdd', () => {
  it('queues SharedSpaceFaceMatch per asset only for face-enabled linked spaces', async () => {
    const albumId = newUuid();
    const spaceA = newUuid();
    const spaceB = newUuid();
    const a1 = newUuid();
    const a2 = newUuid();
    mocks.sharedSpace.getSpacesLinkedToAlbum.mockResolvedValue([
      { spaceId: spaceA, faceRecognitionEnabled: true },
      { spaceId: spaceB, faceRecognitionEnabled: false },
    ] as any);

    await sut.onAlbumAssetsAdd({ albumId, assetIds: [a1, a2] });

    expect(mocks.job.queueAll).toHaveBeenCalledWith([
      { name: JobName.SharedSpaceFaceMatch, data: { spaceId: spaceA, assetId: a1 } },
      { name: JobName.SharedSpaceFaceMatch, data: { spaceId: spaceA, assetId: a2 } },
    ]);
  });

  it('does nothing when there are no face-enabled linked spaces', async () => {
    mocks.sharedSpace.getSpacesLinkedToAlbum.mockResolvedValue([
      { spaceId: newUuid(), faceRecognitionEnabled: false },
    ] as any);
    await sut.onAlbumAssetsAdd({ albumId: newUuid(), assetIds: [newUuid()] });
    expect(mocks.job.queueAll).not.toHaveBeenCalled();
  });

  it('does nothing for an empty asset list', async () => {
    await sut.onAlbumAssetsAdd({ albumId: newUuid(), assetIds: [] });
    expect(mocks.sharedSpace.getSpacesLinkedToAlbum).not.toHaveBeenCalled();
    expect(mocks.job.queueAll).not.toHaveBeenCalled();
  });
});

describe('onAlbumAssetsRemove', () => {
  it('removes orphaned faces + persons and queues metadata backfill', async () => {
    const albumId = newUuid();
    const space = newUuid();
    const a1 = newUuid();
    const a2 = newUuid();
    mocks.sharedSpace.getSpacesLinkedToAlbum.mockResolvedValue([
      { spaceId: space, faceRecognitionEnabled: true },
    ] as any);
    mocks.sharedSpace.getAssetIdsWithoutOtherSpacePath.mockResolvedValue([a1]);
    mocks.sharedSpace.removePersonFacesByAssetIds.mockResolvedValue();
    mocks.sharedSpace.deleteOrphanedPersons.mockResolvedValue();

    await sut.onAlbumAssetsRemove({ albumId, assetIds: [a1, a2] });

    expect(mocks.sharedSpace.getAssetIdsWithoutOtherSpacePath).toHaveBeenCalledWith(space, [a1, a2]);
    expect(mocks.sharedSpace.removePersonFacesByAssetIds).toHaveBeenCalledWith(space, [a1]);
    expect(mocks.sharedSpace.deleteOrphanedPersons).toHaveBeenCalledWith(space);
    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SharedSpacePersonMetadataBackfill, data: {} });
  });

  it('skips cleanup and backfill when nothing is orphaned', async () => {
    const space = newUuid();
    mocks.sharedSpace.getSpacesLinkedToAlbum.mockResolvedValue([
      { spaceId: space, faceRecognitionEnabled: true },
    ] as any);
    mocks.sharedSpace.getAssetIdsWithoutOtherSpacePath.mockResolvedValue([]);

    await sut.onAlbumAssetsRemove({ albumId: newUuid(), assetIds: [newUuid()] });

    expect(mocks.sharedSpace.removePersonFacesByAssetIds).not.toHaveBeenCalled();
    expect(mocks.sharedSpace.deleteOrphanedPersons).not.toHaveBeenCalled();
    expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.SharedSpacePersonMetadataBackfill, data: {} });
  });

  it('does nothing for an empty asset list', async () => {
    await sut.onAlbumAssetsRemove({ albumId: newUuid(), assetIds: [] });
    expect(mocks.sharedSpace.getSpacesLinkedToAlbum).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- --run src/services/shared-space.service.spec.ts -t "onAlbumAssets"`
Expected: FAIL — `sut.onAlbumAssetsAdd is not a function`.

- [ ] **Step 3: Implement the handlers**

In `server/src/services/shared-space.service.ts`:

1. Ensure `OnEvent` is imported from `src/decorators` (the file already imports `OnJob`, `GenerateSql`, etc. from there — add `OnEvent` to that import list).
2. Add `ArgOf` to the import from `src/repositories/event.repository` (if the file doesn't import from there yet, add `import { ArgOf } from 'src/repositories/event.repository';`).
3. Add these two methods to the `SharedSpaceService` class (place them near the other `@OnJob`/`@OnEvent` members):

```typescript
@OnEvent({ name: 'AlbumAssetsAdd' })
async onAlbumAssetsAdd({ albumId, assetIds }: ArgOf<'AlbumAssetsAdd'>): Promise<void> {
  if (assetIds.length === 0) {
    return;
  }
  const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
  const jobs = spaces
    .filter((space) => space.faceRecognitionEnabled)
    .flatMap((space) =>
      assetIds.map((assetId) => ({
        name: JobName.SharedSpaceFaceMatch as const,
        data: { spaceId: space.spaceId, assetId },
      })),
    );
  if (jobs.length > 0) {
    await this.jobRepository.queueAll(jobs);
  }
}

@OnEvent({ name: 'AlbumAssetsRemove' })
async onAlbumAssetsRemove({ albumId, assetIds }: ArgOf<'AlbumAssetsRemove'>): Promise<void> {
  if (assetIds.length === 0) {
    return;
  }
  const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
  let anyOrphanWork = false;
  for (const space of spaces) {
    if (!space.faceRecognitionEnabled) {
      continue;
    }
    const orphaned = await this.sharedSpaceRepository.getAssetIdsWithoutOtherSpacePath(space.spaceId, assetIds);
    if (orphaned.length === 0) {
      continue;
    }
    await this.sharedSpaceRepository.removePersonFacesByAssetIds(space.spaceId, orphaned);
    await this.sharedSpaceRepository.deleteOrphanedPersons(space.spaceId);
    anyOrphanWork = true;
  }
  if (anyOrphanWork) {
    await this.queueSpacePersonMetadataBackfill();
  }
}
```

- [ ] **Step 4: Run to verify passing**

Run: `pnpm test -- --run src/services/shared-space.service.spec.ts -t "onAlbumAssets"`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(spaces): sync space people on linked-album asset add/remove (slice 1)"
```

---

## Task 4: Service — emit events from album.service

**Files:**

- Modify: `server/src/services/album.service.ts`
- Test: `server/src/services/album.service.spec.ts`

- [ ] **Step 1: Write the failing unit tests**

Add to `server/src/services/album.service.spec.ts` (uses `AuthFactory`, `UserFactory`, `AlbumFactory`, `AssetFactory`, `getForAlbum`, `newTestService`). Mirror the existing `addAssets` / `addAssetsToAlbums` / `removeAssets` success tests for the arrange blocks:

```typescript
describe('AlbumAssets events (space sync)', () => {
  it('addAssets emits AlbumAssetsAdd with the successfully added asset ids', async () => {
    const owner = UserFactory.create({ isAdmin: true });
    const album = AlbumFactory.from().owner(owner).build();
    const [asset1, asset2] = [AssetFactory.create(), AssetFactory.create()];
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
    mocks.album.getById.mockResolvedValue(getForAlbum(album));
    mocks.album.getAssetIds.mockResolvedValueOnce(new Set());

    await sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id, asset2.id] });

    expect(mocks.event.emit).toHaveBeenCalledWith('AlbumAssetsAdd', {
      albumId: album.id,
      assetIds: [asset1.id, asset2.id],
    });
  });

  it('addAssets does not emit AlbumAssetsAdd when nothing was added', async () => {
    const owner = UserFactory.create({ isAdmin: true });
    const album = AlbumFactory.from().owner(owner).build();
    const asset1 = AssetFactory.create();
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id]));
    mocks.album.getById.mockResolvedValue(getForAlbum(album));
    mocks.album.getAssetIds.mockResolvedValueOnce(new Set([asset1.id])); // already present → no success

    await sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id] });

    expect(mocks.event.emit).not.toHaveBeenCalledWith('AlbumAssetsAdd', expect.anything());
  });

  it('addAssetsToAlbums emits one AlbumAssetsAdd per album with its added ids', async () => {
    const album1 = AlbumFactory.create();
    const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
    const album2 = AlbumFactory.create();
    const [asset1, asset2] = [AssetFactory.create(), AssetFactory.create()];
    mocks.access.album.checkOwnerAccess.mockResolvedValueOnce(new Set([album1.id, album2.id]));
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
    mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
    mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

    await sut.addAssetsToAlbums(AuthFactory.create(owner), {
      albumIds: [album1.id, album2.id],
      assetIds: [asset1.id, asset2.id],
    });

    expect(mocks.event.emit).toHaveBeenCalledWith('AlbumAssetsAdd', {
      albumId: album1.id,
      assetIds: [asset1.id, asset2.id],
    });
    expect(mocks.event.emit).toHaveBeenCalledWith('AlbumAssetsAdd', {
      albumId: album2.id,
      assetIds: [asset1.id, asset2.id],
    });
  });

  it('removeAssets emits AlbumAssetsRemove with the removed ids', async () => {
    const owner = UserFactory.create({ isAdmin: true });
    const album = AlbumFactory.from().owner(owner).build();
    const [asset1, asset2] = [AssetFactory.create(), AssetFactory.create()];
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
    mocks.album.getById.mockResolvedValue(getForAlbum(album));
    mocks.album.getAssetIds.mockResolvedValueOnce(new Set([asset1.id, asset2.id]));

    await sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id, asset2.id] });

    expect(mocks.event.emit).toHaveBeenCalledWith('AlbumAssetsRemove', {
      albumId: album.id,
      assetIds: [asset1.id, asset2.id],
    });
  });
});
```

> Note for the implementer: the `removeAssets` arrange must make the `removeAssets(...)` helper return `success: true` for both ids. Match the existing successful `removeAssets` test in this file for the exact `mocks.access.*` / `mocks.album.*` stubs (e.g. `mocks.access.album.checkOwnerAccess`, `mocks.album.getAssetIds`, and any `mocks.access.asset.*` the helper calls). If the existing test stubs differ, copy that test's arrange verbatim and only add the `event.emit` assertion.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- --run src/services/album.service.spec.ts -t "AlbumAssets events"`
Expected: FAIL — `event.emit` not called with `AlbumAssetsAdd` / `AlbumAssetsRemove`.

- [ ] **Step 3: Implement the emits**

In `server/src/services/album.service.ts`:

**`addAssets`** — inside the existing `if (firstNewAssetId) { ... }` block, after the `AlbumUpdate` emit loop, add:

```typescript
const addedAssetIds = results.filter(({ success }) => success).map(({ id }) => id);
await this.eventRepository.emit('AlbumAssetsAdd', { albumId: id, assetIds: addedAssetIds });
```

**`addAssetsToAlbums`** — after `await this.albumRepository.addAssetIdsToAlbums(albumAssetValues);` (and the existing `AlbumUpdate` loop), add:

```typescript
const addedByAlbum = new Map<string, string[]>();
for (const { albumId, assetId } of albumAssetValues) {
  const ids = addedByAlbum.get(albumId);
  if (ids) {
    ids.push(assetId);
  } else {
    addedByAlbum.set(albumId, [assetId]);
  }
}
for (const [albumId, assetIds] of addedByAlbum) {
  await this.eventRepository.emit('AlbumAssetsAdd', { albumId, assetIds });
}
```

**`removeAssets`** — after `const removedIds = results.filter(({ success }) => success).map(({ id }) => id);`, add:

```typescript
if (removedIds.length > 0) {
  await this.eventRepository.emit('AlbumAssetsRemove', { albumId: id, assetIds: removedIds });
}
```

- [ ] **Step 4: Run to verify passing**

Run: `pnpm test -- --run src/services/album.service.spec.ts -t "AlbumAssets events"`
Expected: PASS (4 cases). Then run the whole file to catch regressions: `pnpm test -- --run src/services/album.service.spec.ts` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/album.service.ts server/src/services/album.service.spec.ts
git commit -m "feat(spaces): emit AlbumAssetsAdd/Remove on album asset mutations (slice 1)"
```

---

## Task 5: Medium end-to-end + linchpin regression

**Files:**

- Test: `server/test/medium/specs/services/shared-space-album.service.spec.ts`

Use `setupWithFaceMatch()` (already defined in this file: real `AccessRepository, AlbumRepository, AlbumUserRepository, AssetRepository, SharedSpaceRepository, UserRepository, FaceIdentityRepository, PersonRepository, ConfigRepository, SystemMetadataRepository, SearchRepository`; mocked `EventRepository, LoggingRepository, JobRepository, StorageRepository`; returns `{ ctx, sut, jobs, faceIdentityRepository }`). The face-seeding block is copied verbatim from the existing `handleSharedSpaceAlbumFaceSync` test in this file.

- [ ] **Step 1: Write the failing add end-to-end test**

```typescript
describe('onAlbumAssetsAdd (medium)', () => {
  it('queues face match for an album-only asset and produces a space person when run', async () => {
    const { ctx, sut, faceIdentityRepository, jobs } = setupWithFaceMatch();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'AddSyncAlbum' });

    const { result: person } = await ctx.newPerson({ ownerId: user.id, name: 'AddedPerson' });
    const identity = await faceIdentityRepository.ensurePersonIdentity(person.id);

    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();
    await faceIdentityRepository.linkFace({
      assetFaceId: assetFace.id,
      identityId: identity.id,
      source: 'owner-person',
    });

    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    // The event handler queues a per-asset face match for the face-enabled linked space.
    await sut.onAlbumAssetsAdd({ albumId: album.id, assetIds: [asset.id] });
    expect(jobs.queueAll).toHaveBeenCalledWith([
      { name: JobName.SharedSpaceFaceMatch, data: { spaceId: space.id, assetId: asset.id } },
    ]);

    // Running that match against the real DB creates the space person (linchpin: isAssetInSpace
    // recognises the album path, so processSpaceFaceMatch does NOT early-return).
    const status = await sut.handleSharedSpaceFaceMatch({ spaceId: space.id, assetId: asset.id });
    expect(status).toBe(JobStatus.Success);
    const spacePersons = await ctx.database
      .selectFrom('shared_space_person')
      .select('id')
      .where('spaceId', '=', space.id)
      .execute();
    expect(spacePersons.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it passes (no new impl — validates Task 1+3 against real DB)**

Run: `pnpm test:medium -- --run test/medium/specs/services/shared-space-album.service.spec.ts -t "onAlbumAssetsAdd"`
Expected: PASS. (This test asserts already-implemented behavior end-to-end; if it fails, it reveals a real wiring bug in Task 3 — fix Task 3, do not weaken the test.)

- [ ] **Step 3: Write the remove end-to-end test**

Model on the existing "removes faces for album-only assets but retains faces for assets with another space path" unlink test in this file, but drive it through the event handler and per-asset removal:

```typescript
describe('onAlbumAssetsRemove (medium)', () => {
  it('removes faces for an album-only removed asset but retains faces for a removed asset with a direct path', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'RemoveSyncAlbum' });

    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id }); // album-only → face removed
    const { asset: a2 } = await ctx.newAsset({ ownerId: user.id }); // album + direct → face retained

    await ctx.newAlbumAsset({ albumId: album.id, assetId: a1.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: a2.id });
    await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: a2.id });

    const { result: face1Id } = await ctx.newAssetFace({ assetId: a1.id });
    const { result: face2Id } = await ctx.newAssetFace({ assetId: a2.id });
    const repo = ctx.get(SharedSpaceRepository);
    const spacePerson = await repo.createPerson({
      spaceId: space.id,
      name: 'Test Person',
      type: 'person',
      representativeFaceId: null,
    });
    await repo.addPersonFaces([
      { personId: spacePerson.id, assetFaceId: face1Id },
      { personId: spacePerson.id, assetFaceId: face2Id },
    ]);

    // Simulate the real removeAssets ordering: album_asset rows for a1,a2 are deleted FIRST.
    await ctx.database
      .deleteFrom('album_asset')
      .where('albumId', '=', album.id)
      .where('assetId', 'in', [a1.id, a2.id])
      .execute();

    await sut.onAlbumAssetsRemove({ albumId: album.id, assetIds: [a1.id, a2.id] });

    const facesAfter = await ctx.database
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', spacePerson.id)
      .execute();
    const faceIds = facesAfter.map((f) => f.assetFaceId);
    expect(faceIds).not.toContain(face1Id);
    expect(faceIds).toContain(face2Id);
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:medium -- --run test/medium/specs/services/shared-space-album.service.spec.ts -t "onAlbumAssetsRemove"`
Expected: PASS. (Validates Task 1+3 remove path end-to-end. If `newAssetFace` returns a shape other than `{ result: faceId }`, match the existing unlink test's destructuring exactly.)

- [ ] **Step 5: Commit**

```bash
git add server/test/medium/specs/services/shared-space-album.service.spec.ts
git commit -m "test(spaces): medium e2e for linked-album add/remove people sync (slice 1)"
```

---

## Task 6: E2E API coverage (infra-gated)

**Files:**

- Test: `e2e/src/specs/web/spaces-albums.e2e-spec.ts` (or a new `e2e/src/specs/<area>.e2e-spec.ts` API spec if the web spec lacks face-recognition setup)

> This task requires the e2e stack (`make e2e`/running server + DB). If the stack is not available in this environment, write the test, attempt to run it, and if it cannot run, record that clearly in the commit body and leave it for CI — do NOT delete it or fake a pass.

- [ ] **Step 1: Write the test**

Add a `test.describe('Spaces — linked-album live people sync')` that, using `utils` helpers: `adminSetup`, `userSetup`, `createSpace` (with `faceRecognitionEnabled: true` if the create DTO supports it, else `updateSpace`), `createAlbum`, `linkSpaceAlbum`, and `createAsset`. Then add an asset (with a detectable/seeded face) to the album via the album add-assets API and assert the space's people listing includes the person; remove it and assert it is gone. Reuse `utils.createSpacePerson` seeding semantics where direct face detection is not deterministic, and follow the existing spec's no-arbitrary-timeout, await-visible-state convention.

- [ ] **Step 2: Run (if infra available)**

Run: `pnpm test:web -- spaces-albums.e2e-spec.ts` (Playwright) or the API runner `pnpm test -- --run src/specs/<area>.e2e-spec.ts`.
Expected: PASS, or a documented infra-unavailable skip.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/web/spaces-albums.e2e-spec.ts
git commit -m "test(e2e): linked-album live people sync add/remove (slice 1)"
```

---

## Slice 1 completion gate

- [ ] `cd server && pnpm test -- --run src/services/album.service.spec.ts src/services/shared-space.service.spec.ts` → all PASS.
- [ ] `cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-album.service.spec.ts test/medium/specs/repositories/shared-space.repository.spec.ts` → all PASS.
- [ ] `make check-server` → clean.
- [ ] `cd server && pnpm sql` → no uncommitted diff.
- [ ] Push the branch (no merge).

## Edge-case coverage map (spec §4.4 → test)

| Spec edge                                      | Covered by                                                                                                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add: face-enabled space → per-asset job        | Task 3 unit #1, Task 5 add                                                                                                                                                                                                               |
| Add: mixed face on/off spaces                  | Task 3 unit #1                                                                                                                                                                                                                           |
| Add: face-disabled only → no jobs              | Task 3 unit #2                                                                                                                                                                                                                           |
| Add: no linked space → no jobs                 | Task 3 unit #2 (empty/false)                                                                                                                                                                                                             |
| Add: multi-album fan-out                       | Task 4 unit #3                                                                                                                                                                                                                           |
| Add: only newly-inserted ids                   | Task 4 unit #1/#2                                                                                                                                                                                                                        |
| Add: already-in-space idempotent               | covered by `processSpaceFaceMatch` idempotency (Task 5 runs real match)                                                                                                                                                                  |
| Add: no successful inserts → no emit           | Task 4 unit #2                                                                                                                                                                                                                           |
| Remove: direct path retained                   | Task 5 remove (a2)                                                                                                                                                                                                                       |
| Remove: other-album path retained              | Task 1 repo test (otherAlbum)                                                                                                                                                                                                            |
| Remove: library path retained                  | Task 1 repo test (extend with a library case if a `newSharedSpaceLibrary`/library seeder exists; otherwise the direct + other-album cases plus the library NOT-EXISTS branch are exercised by the query shape — note this in the commit) |
| Remove: true orphan removed                    | Task 1 repo test (orphan), Task 5 remove (a1)                                                                                                                                                                                            |
| Remove: album linked to no/face-disabled space | Task 3 unit (#3 / disabled)                                                                                                                                                                                                              |
| Remove: empty / no faces                       | Task 3 unit #4, repo empty-list case                                                                                                                                                                                                     |
| Remove: ordering (rows deleted first)          | Task 5 remove (deletes album_asset before handler)                                                                                                                                                                                       |
| Remove: multiple spaces independent            | Task 3 unit (loop) — extend mock to 2 spaces if desired                                                                                                                                                                                  |
| Stale match after unlink (no ghost)            | Task 5 add note + linchpin (isAssetInSpace guard)                                                                                                                                                                                        |
| Hidden/deleted/offline assets                  | guarded by isAssetInSpace; no code path added                                                                                                                                                                                            |
