# Space Map Markers — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make photos from shared spaces a user belongs to appear on the user's personal map, mirroring the existing timeline behavior, on web and mobile.

**Architecture:** Add an optional `withSharedSpaces` flag to both map-marker DTOs; when set on the basic endpoint (`GET /map/markers`), resolve `sharedSpaceRepository.getSpaceIdsForTimeline(userId)` and feed it into the SQL as two additional EXISTS clauses (constrained to `visibility=Timeline`); on the filtered endpoint (`GET /gallery-map/markers/filtered`), pass `timelineSpaceIds` into the existing `searchAssetBuilder` path. Web and mobile callers hardcode `true`. No new user pref, no new UI toggle, no DB migration.

**Tech Stack:** NestJS 11 / Kysely (server), Svelte 5 / SvelteKit (web), Flutter + Riverpod (mobile). Vitest for server + web unit, real-DB medium tests via testcontainers, Playwright for web E2E, flutter_test for mobile.

**Design reference:** `docs/plans/2026-04-17-space-map-markers-design.md`. The permission matrix (rows 1-24) is the source of truth for expected behavior; every test task in this plan cites the row numbers it covers.

**Working directory:** `/home/pierre/dev/gallery/.worktrees/space-map` on branch `feat/space-map-markers`.

---

## Phase 0 — Pre-flight

### Task 0.1: Confirm worktree and install deps

**Files:** none — environment setup only.

**Step 1:** Verify you're in the right worktree on the right branch.

```bash
cd /home/pierre/dev/gallery/.worktrees/space-map
git status
# Expected: "On branch feat/space-map-markers" + "nothing to commit, working tree clean"
git log --oneline -3
# Expected: two commits ahead of main — design doc + review-feedback fixes
```

**Step 2:** Install dependencies once (prettier ran this during design, but a fresh session may not be warm).

```bash
pnpm install
```

**Step 3:** Confirm symlink for e2e test assets (worktree convention — see memory `feedback_worktree_test_assets.md`).

```bash
ls -la e2e/test-assets
# Expected: symlink → /home/pierre/dev/gallery/e2e/test-assets
# If missing: rm -rf e2e/test-assets && ln -s /home/pierre/dev/gallery/e2e/test-assets e2e/test-assets
```

No commit for this task.

---

## Phase 1 — Server DTO + repository interface

### Task 1.1: Add `withSharedSpaces` to `MapMarkerDto`

**Files:**

- Modify: `server/src/dtos/map.dto.ts`

**Step 1:** Open the file, locate the `MapMarkerDto` class (ends around line 47), and add a new field at the bottom of the class body, modeled on `withPartners` / `withSharedAlbums`:

```ts
@ValidateBoolean({ optional: true, description: 'Include shared space assets' })
withSharedSpaces?: boolean;
```

**Step 2:** Type-check the server.

```bash
cd server && pnpm check && cd ..
# Expected: no errors
```

**Step 3:** Commit.

```bash
git add server/src/dtos/map.dto.ts
git commit -m "feat(server): add withSharedSpaces to MapMarkerDto"
```

### Task 1.2: Add `withSharedSpaces` to `FilteredMapMarkerDto`

**Files:**

- Modify: `server/src/dtos/gallery-map.dto.ts`

**Step 1:** Open the file and add the field to `FilteredMapMarkerDto`, modeled on the existing `isFavorite` field:

```ts
@ValidateBoolean({ optional: true, description: 'Include shared space assets' })
withSharedSpaces?: boolean;
```

**Step 2:** Type-check.

```bash
cd server && pnpm check && cd ..
```

**Step 3:** Commit.

```bash
git add server/src/dtos/gallery-map.dto.ts
git commit -m "feat(server): add withSharedSpaces to FilteredMapMarkerDto"
```

### Task 1.3: Add `timelineSpaceIds` to `MapMarkerSearchOptions`

**Files:**

- Modify: `server/src/repositories/map.repository.ts`

**Step 1:** Locate the `MapMarkerSearchOptions` interface near the top (lines 18-23). Add `timelineSpaceIds?: string[]` at the end:

```ts
export interface MapMarkerSearchOptions {
  isArchived?: boolean;
  isFavorite?: boolean;
  fileCreatedBefore?: Date;
  fileCreatedAfter?: Date;
  timelineSpaceIds?: string[];
}
```

**Step 2:** Type-check.

```bash
cd server && pnpm check && cd ..
```

**Step 3:** Commit.

```bash
git add server/src/repositories/map.repository.ts
git commit -m "refactor(server): add timelineSpaceIds to MapMarkerSearchOptions"
```

---

## Phase 2 — `MapService` unit tests (TDD) + implementation

Every test in this phase lives in `server/src/services/map.service.spec.ts`. The existing `describe('getMapMarkers', ...)` block starts at line 18; add new `it(...)` blocks inside it.

### Task 2.1: Test — passes `timelineSpaceIds` when `withSharedSpaces=true` and user has enabled spaces (matrix row 5)

**Files:**

- Modify: `server/src/services/map.service.spec.ts`

**Step 1:** Write the failing test. Add this block after the existing `it('should include assets from shared albums', ...)` test (ends around line 94):

```ts
it('should pass space IDs when withSharedSpaces is true and user has enabled spaces', async () => {
  const auth = AuthFactory.create();
  const spaceId = '00000000-0000-4000-8000-000000000001';
  mocks.partner.getAll.mockResolvedValue([]);
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
  mocks.map.getMapMarkers.mockResolvedValue([]);

  await sut.getMapMarkers(auth, { withSharedSpaces: true });

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(auth.user.id);
  expect(mocks.map.getMapMarkers).toHaveBeenCalledWith(
    [auth.user.id],
    expect.anything(),
    expect.objectContaining({ timelineSpaceIds: [spaceId] }),
  );
});
```

**Step 2:** Run and expect failure (service doesn't resolve space IDs yet).

```bash
cd server && pnpm test -- --run src/services/map.service.spec.ts && cd ..
# Expected: the new test FAILS with "expected mock to have been called"
```

### Task 2.2: Test — no `timelineSpaceIds` when user has no enabled spaces (matrix supports row 7)

**Step 1:** Add next to the previous test:

```ts
it('should not pass timelineSpaceIds when user has no enabled spaces', async () => {
  const auth = AuthFactory.create();
  mocks.partner.getAll.mockResolvedValue([]);
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([]);
  mocks.map.getMapMarkers.mockResolvedValue([]);

  await sut.getMapMarkers(auth, { withSharedSpaces: true });

  expect(mocks.map.getMapMarkers).toHaveBeenCalledWith(
    [auth.user.id],
    expect.anything(),
    expect.not.objectContaining({ timelineSpaceIds: expect.anything() }),
  );
});
```

**Step 2:** Run — should fail.

```bash
cd server && pnpm test -- --run src/services/map.service.spec.ts && cd ..
```

### Task 2.3: Test — `isFavorite=true` suppresses space resolution (matrix row 15)

**Step 1:** Add:

```ts
it('should not resolve space IDs when isFavorite=true', async () => {
  const auth = AuthFactory.create();
  mocks.partner.getAll.mockResolvedValue([]);
  mocks.map.getMapMarkers.mockResolvedValue([]);

  await sut.getMapMarkers(auth, { withSharedSpaces: true, isFavorite: true });

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
  expect(mocks.map.getMapMarkers).toHaveBeenCalledWith(
    [auth.user.id],
    expect.anything(),
    expect.not.objectContaining({ timelineSpaceIds: expect.anything() }),
  );
});
```

**Step 2:** Run — should fail.

### Task 2.4: Test — `isArchived=true` keeps space resolution (matrix row 5, critical semantics)

**Step 1:** Add:

```ts
it('should resolve space IDs when isArchived=true (archive toggle is additive)', async () => {
  const auth = AuthFactory.create();
  const spaceId = '00000000-0000-4000-8000-000000000002';
  mocks.partner.getAll.mockResolvedValue([]);
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
  mocks.map.getMapMarkers.mockResolvedValue([]);

  await sut.getMapMarkers(auth, { withSharedSpaces: true, isArchived: true });

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(auth.user.id);
  expect(mocks.map.getMapMarkers).toHaveBeenCalledWith(
    [auth.user.id],
    expect.anything(),
    expect.objectContaining({ timelineSpaceIds: [spaceId], isArchived: true }),
  );
});
```

**Step 2:** Run — should fail.

### Task 2.5: Test — no resolution when `withSharedSpaces` is omitted (matrix row 16)

**Step 1:** Add:

```ts
it('should not resolve space IDs when withSharedSpaces is omitted', async () => {
  const auth = AuthFactory.create();
  mocks.partner.getAll.mockResolvedValue([]);
  mocks.map.getMapMarkers.mockResolvedValue([]);

  await sut.getMapMarkers(auth, {});

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
});
```

**Step 2:** Run — should fail.

### Task 2.6: Implement `MapService.getMapMarkers` to satisfy the tests

**Files:**

- Modify: `server/src/services/map.service.ts`

**Step 1:** Replace the body of `getMapMarkers` (current code lines 9-27). The full updated file should be:

```ts
import { Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { MapMarkerDto, MapMarkerResponseDto, MapReverseGeocodeDto } from 'src/dtos/map.dto';
import { MapMarkerSearchOptions } from 'src/repositories/map.repository';
import { BaseService } from 'src/services/base.service';
import { getMyPartnerIds } from 'src/utils/asset.util';

@Injectable()
export class MapService extends BaseService {
  async getMapMarkers(auth: AuthDto, options: MapMarkerDto): Promise<MapMarkerResponseDto[]> {
    const userIds = [auth.user.id];
    if (options.withPartners) {
      const partnerIds = await getMyPartnerIds({ userId: auth.user.id, repository: this.partnerRepository });
      userIds.push(...partnerIds);
    }

    const albumIds: string[] = [];
    if (options.withSharedAlbums) {
      const [ownedAlbums, sharedAlbums] = await Promise.all([
        this.albumRepository.getOwned(auth.user.id),
        this.albumRepository.getShared(auth.user.id),
      ]);
      albumIds.push(...ownedAlbums.map((album) => album.id), ...sharedAlbums.map((album) => album.id));
    }

    const searchOptions: MapMarkerSearchOptions = {
      isArchived: options.isArchived,
      isFavorite: options.isFavorite,
      fileCreatedBefore: options.fileCreatedBefore,
      fileCreatedAfter: options.fileCreatedAfter,
    };

    if (options.withSharedSpaces && options.isFavorite !== true) {
      const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
      if (spaceRows.length > 0) {
        searchOptions.timelineSpaceIds = spaceRows.map((row) => row.spaceId);
      }
    }

    return this.mapRepository.getMapMarkers(userIds, albumIds, searchOptions);
  }

  async reverseGeocode(dto: MapReverseGeocodeDto) {
    const { lat: latitude, lon: longitude } = dto;
    const result = await this.mapRepository.reverseGeocode({ latitude, longitude });
    return result ? [result] : [];
  }
}
```

Note: the existing `getMapMarkers` passed the DTO directly as the third arg. The new version builds an explicit `MapMarkerSearchOptions` so `timelineSpaceIds` can be attached without leaking the DTO's `withSharedSpaces` / `withPartners` / `withSharedAlbums` into the repo layer.

**Step 2:** The existing tests that assert the third arg (lines 61-65, 90-94) expect specific shapes. Check them — they use `{ withPartners: true }` directly. Update those assertions so they still pass with the new shape. In `map.service.spec.ts`:

Find (line ~61):

```ts
expect(mocks.map.getMapMarkers).toHaveBeenCalledWith([auth.user.id, partner.sharedById], expect.arrayContaining([]), {
  withPartners: true,
});
```

Replace with:

```ts
expect(mocks.map.getMapMarkers).toHaveBeenCalledWith(
  [auth.user.id, partner.sharedById],
  expect.arrayContaining([]),
  expect.objectContaining({
    isArchived: undefined,
    isFavorite: undefined,
    fileCreatedAfter: undefined,
    fileCreatedBefore: undefined,
  }),
);
```

The existing `'should include assets from shared albums'` test doesn't assert on the third arg beyond the setup, so it should still pass.

**Step 3:** Run all map.service tests.

```bash
cd server && pnpm test -- --run src/services/map.service.spec.ts && cd ..
# Expected: all green, including the 5 new tests from 2.1-2.5
```

**Step 4:** Commit.

```bash
git add server/src/services/map.service.ts server/src/services/map.service.spec.ts
git commit -m "feat(server): resolve timeline space IDs for map markers"
```

---

## Phase 3 — `SharedSpaceService.getFilteredMapMarkers` unit tests + implementation

The existing `describe('getFilteredMapMarkers', ...)` block in `server/src/services/shared-space.service.spec.ts` starts at line 5701.

### Task 3.1: Test — `withSharedSpaces=true` resolves `timelineSpaceIds` in personal branch (matrix rows 2, 4)

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`

**Step 1:** Append a new test inside the existing `describe('getFilteredMapMarkers', ...)` block:

```ts
it('should resolve timelineSpaceIds when withSharedSpaces is true and no spaceId', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
  mocks.sharedSpace.getFilteredMapMarkers.mockResolvedValue([]);

  await sut.getFilteredMapMarkers(auth, { withSharedSpaces: true });

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).toHaveBeenCalledWith(auth.user.id);
  expect(mocks.sharedSpace.getFilteredMapMarkers).toHaveBeenCalledWith(
    expect.objectContaining({
      userIds: [auth.user.id],
      timelineSpaceIds: [spaceId],
    }),
  );
});
```

**Step 2:** Run and expect failure.

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts && cd ..
# Expected: new test FAILS
```

### Task 3.2: Test — `spaceId` present suppresses `timelineSpaceIds` resolution (matrix rows 17, 19, 20)

**Step 1:** Append:

```ts
it('should NOT call getSpaceIdsForTimeline when spaceId is set (even with withSharedSpaces=true)', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceId]));
  mocks.sharedSpace.getFilteredMapMarkers.mockResolvedValue([]);

  await sut.getFilteredMapMarkers(auth, { spaceId, withSharedSpaces: true });

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
  expect(mocks.sharedSpace.getFilteredMapMarkers).toHaveBeenCalledWith(
    expect.not.objectContaining({ timelineSpaceIds: expect.anything() }),
  );
});
```

**Step 2:** Run — should fail.

### Task 3.3: Test — `isFavorite=true` suppresses space resolution on filtered endpoint

**Step 1:** Append:

```ts
it('should not resolve timelineSpaceIds when isFavorite=true', async () => {
  const auth = factory.auth();
  mocks.sharedSpace.getFilteredMapMarkers.mockResolvedValue([]);

  await sut.getFilteredMapMarkers(auth, { withSharedSpaces: true, isFavorite: true });

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
});
```

**Step 2:** Run — should fail.

### Task 3.4: Test — no resolution when `withSharedSpaces` is omitted

**Step 1:** Append:

```ts
it('should not resolve timelineSpaceIds when withSharedSpaces is omitted', async () => {
  const auth = factory.auth();
  mocks.sharedSpace.getFilteredMapMarkers.mockResolvedValue([]);

  await sut.getFilteredMapMarkers(auth, {});

  expect(mocks.sharedSpace.getSpaceIdsForTimeline).not.toHaveBeenCalled();
});
```

**Step 2:** Run — should fail.

### Task 3.5: Test — `personIds` still resolve as global, not space (matrix row 21)

Verify that the existing branch at `shared-space.service.ts:596-597` isn't broken when `withSharedSpaces` is added.

**Step 1:** Append:

```ts
it('should pass personIds as global (not spacePersonIds) when no spaceId + withSharedSpaces=true', async () => {
  const auth = factory.auth();
  mocks.sharedSpace.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: newUuid() }]);
  mocks.sharedSpace.getFilteredMapMarkers.mockResolvedValue([]);

  await sut.getFilteredMapMarkers(auth, {
    withSharedSpaces: true,
    personIds: ['person-1'],
  });

  expect(mocks.sharedSpace.getFilteredMapMarkers).toHaveBeenCalledWith(
    expect.objectContaining({
      personIds: ['person-1'],
      spacePersonIds: undefined,
    }),
  );
});
```

**Step 2:** Run — should fail.

### Task 3.6: Implement `SharedSpaceService.getFilteredMapMarkers`

**Files:**

- Modify: `server/src/services/shared-space.service.ts`

**Step 1:** Locate `getFilteredMapMarkers` starting line 588. Replace its body:

```ts
async getFilteredMapMarkers(auth: AuthDto, dto: FilteredMapMarkerDto): Promise<MapMarkerResponseDto[]> {
  if (dto.spaceId) {
    await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
  }

  let timelineSpaceIds: string[] | undefined;
  if (!dto.spaceId && dto.withSharedSpaces && dto.isFavorite !== true) {
    const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
    if (spaceRows.length > 0) {
      timelineSpaceIds = spaceRows.map((row) => row.spaceId);
    }
  }

  const markers = await this.sharedSpaceRepository.getFilteredMapMarkers({
    userIds: dto.spaceId ? undefined : [auth.user.id],
    spaceId: dto.spaceId,
    timelineSpaceIds,
    personIds: dto.spaceId ? undefined : dto.personIds,
    spacePersonIds: dto.spaceId ? dto.personIds : undefined,
    tagIds: dto.tagIds,
    make: dto.make,
    model: dto.model,
    rating: dto.rating,
    type: dto.type === 'IMAGE' ? AssetType.Image : dto.type === 'VIDEO' ? AssetType.Video : undefined,
    takenAfter: dto.takenAfter,
    takenBefore: dto.takenBefore,
    isFavorite: dto.isFavorite,
    city: dto.city,
    country: dto.country,
    visibility: AssetVisibility.Timeline,
    personMatchAny: true,
    tagMatchAny: true,
  });

  return markers.map((marker) => ({
    id: marker.id,
    lat: marker.lat,
    lon: marker.lon,
    city: marker.city ?? null,
    state: marker.state ?? null,
    country: marker.country ?? null,
  }));
}
```

**Step 2:** Run all affected tests.

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts && cd ..
# Expected: all green, including the 5 new tests
```

**Step 3:** Commit.

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(server): thread timelineSpaceIds through filtered map markers"
```

### Task 3.7: Behavioral test — cross-space leak guard (matrix row 19)

Row 19 is the user-facing outcome of the double-scope guard: a member of spaces A + B queries the filtered endpoint with `spaceId=B`, but the asset lives only in space A. The marker must NOT be returned. Task 3.2 asserts `getSpaceIdsForTimeline` was not called; this task asserts the repo was called with a shape that cannot leak A's content.

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts`

**Step 1:** Append inside the existing `describe('getFilteredMapMarkers', ...)` block:

```ts
it('should NOT leak other-space content when spaceId is set (row 19)', async () => {
  const auth = factory.auth();
  const spaceB = newUuid();

  mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set([spaceB]));
  mocks.sharedSpace.getFilteredMapMarkers.mockResolvedValue([]);

  await sut.getFilteredMapMarkers(auth, { spaceId: spaceB, withSharedSpaces: true });

  // With spaceId set, the service must scope only to that space — no userIds, no timelineSpaceIds.
  expect(mocks.sharedSpace.getFilteredMapMarkers).toHaveBeenCalledWith(
    expect.objectContaining({
      spaceId: spaceB,
      userIds: undefined,
    }),
  );
  expect(mocks.sharedSpace.getFilteredMapMarkers).toHaveBeenCalledWith(
    expect.not.objectContaining({ timelineSpaceIds: expect.anything() }),
  );
});
```

**Step 2:** Run.

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts && cd ..
# Expected: green (the Task 3.6 implementation already satisfies this behavior;
# this test locks it in against future regressions).
```

**Step 3:** Commit.

```bash
git add server/src/services/shared-space.service.spec.ts
git commit -m "test(server): lock cross-space leak guard on filtered markers (row 19)"
```

---

## Phase 4 — `MapRepository.getMapMarkers` SQL change

This is the critical SQL change for the basic endpoint. It has a subtle semantic constraint: the space EXISTS branches must also require `asset.visibility = Timeline` so owner-archived space content stays hidden even when the member enables `isArchived=true`.

### Task 4.1: Extend `MapRepository.getMapMarkers` with space EXISTS clauses

**Files:**

- Modify: `server/src/repositories/map.repository.ts`

**Step 1:** Locate the OR block at lines 117-136. Replace it (retaining the `deletedAt` filter and the rest of the method unchanged):

```ts
.where('deletedAt', 'is', null)
.where((eb) => {
  const expression: Expression<SqlBool>[] = [];

  if (ownerIds.length > 0) {
    expression.push(eb('ownerId', 'in', ownerIds));
  }

  if (albumIds.length > 0) {
    expression.push(
      eb.exists((eb) =>
        eb
          .selectFrom('album_asset')
          .whereRef('asset.id', '=', 'album_asset.assetId')
          .where('album_asset.albumId', 'in', albumIds),
      ),
    );
  }

  if (timelineSpaceIds && timelineSpaceIds.length > 0) {
    expression.push(
      eb.and([
        eb('asset.visibility', '=', AssetVisibility.Timeline),
        eb.exists((eb) =>
          eb
            .selectFrom('shared_space_asset')
            .whereRef('asset.id', '=', 'shared_space_asset.assetId')
            .where('shared_space_asset.spaceId', 'in', timelineSpaceIds),
        ),
      ]),
    );
    expression.push(
      eb.and([
        eb('asset.visibility', '=', AssetVisibility.Timeline),
        eb.exists((eb) =>
          eb
            .selectFrom('shared_space_library')
            .whereRef('asset.libraryId', '=', 'shared_space_library.libraryId')
            .where('shared_space_library.spaceId', 'in', timelineSpaceIds),
        ),
      ]),
    );
  }

  return eb.or(expression);
})
```

`timelineSpaceIds` comes from the `options` param; destructure it from the existing `options` destructure at the top of the method (line 83):

```ts
getMapMarkers(
  ownerIds: string[],
  albumIds: string[],
  { isArchived, isFavorite, fileCreatedAfter, fileCreatedBefore, timelineSpaceIds }: MapMarkerSearchOptions = {},
) {
```

**Step 2:** Type-check and run the existing map.service tests (they mock the repo, so they'll still pass; this is a smoke check for TypeScript).

```bash
cd server && pnpm check && pnpm test -- --run src/services/map.service.spec.ts && cd ..
```

**Step 3:** Commit.

```bash
git add server/src/repositories/map.repository.ts
git commit -m "feat(server): add space EXISTS clauses to MapRepository.getMapMarkers"
```

### Task 4.2: Regenerate the SQL query file

`MapRepository.getMapMarkers` is `@GenerateSql`-decorated (line 79 of the repo). The corresponding SQL snapshot at `server/src/queries/map.repository.sql` must be regenerated.

**Files:**

- Modify: `server/src/queries/map.repository.sql`

**Step 1:** If the dev DB is running, run `make sql`:

```bash
make sql
```

If the DB isn't running, commit the task anyway and let CI show the diff. Per memory `feedback_sql_query_regen.md`, applying the CI diff manually is acceptable. Per memory `feedback_make_sql_no_db.md`, do **not** run `make sql` without a running DB — it will delete all query files.

**Step 2:** Verify the diff on `map.repository.sql` shows the new EXISTS branches. If the diff is empty or catastrophic, the DB isn't running; revert and let CI handle it.

```bash
git diff server/src/queries/map.repository.sql | head -80
```

**Step 3:** Commit.

```bash
git add server/src/queries/map.repository.sql
git commit -m "chore(server): regenerate map.repository.sql for timelineSpaceIds"
```

---

## Phase 5 — SDK regeneration (TypeScript + Dart)

### Task 5.1: Regenerate TypeScript SDK

**Files:**

- Modify: `open-api/typescript-sdk/*` (generated), `web/src/lib/…` consumers if needed (unlikely).

**Step 1:** Rebuild server and sync specs.

```bash
cd server
pnpm build
pnpm sync:open-api
cd ..
```

**Step 2:** Regenerate both clients.

```bash
make open-api
```

**Step 3:** Inspect the diff — the OpenAPI spec and generated SDK should show `withSharedSpaces?: boolean` on `MapMarkerDto` and `FilteredMapMarkerDto`.

```bash
git status
# Expected: modified files under open-api/, mobile/openapi/
git diff open-api/typescript-sdk/src/open-api/api.ts | grep -A2 withSharedSpaces
```

**Step 4:** Commit.

```bash
git add open-api/ mobile/openapi/
git commit -m "chore(sdk): regenerate for withSharedSpaces on map DTOs"
```

---

## Phase 6 — Medium (real-DB) tests for `MapRepository`

Per memory `feedback_worktree_test_assets.md`, the e2e test-assets are symlinked. Medium tests use testcontainers, independent of that.

### Task 6.1: Scaffold the medium test file

**Files:**

- Create: `server/test/medium/specs/repositories/map.repository.spec.ts`

**Step 1:** Create the file with the standard medium-test scaffold (mirroring `shared-space.repository.spec.ts`):

```ts
import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MapRepository } from 'src/repositories/map.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(MapRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(MapRepository.name, () => {
  describe('getMapMarkers', () => {
    // Tests added in Tasks 6.2 - 6.11
  });
});
```

**Step 2:** Run the file to confirm the scaffold compiles.

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/map.repository.spec.ts && cd ..
# Expected: "No tests found" (or similar), no errors
```

**Step 3:** Commit.

```bash
git add server/test/medium/specs/repositories/map.repository.spec.ts
git commit -m "test(server): scaffold map.repository medium spec"
```

> **Shared test helper** — each test below needs the owner + a GPS-tagged asset. Read `shared-space.repository.spec.ts` patterns (`ctx.newUser`, `ctx.newAsset`, `ctx.newSharedSpace`, `ctx.newSharedSpaceMember`, `ctx.newSharedSpaceAsset`, `ctx.newLibrary`, `ctx.newSharedSpaceLibrary`) and use them directly. Inspect `newAsset` in `medium.factory.ts` to understand whether it sets GPS (`asset_exif.latitude`/`longitude`). If it doesn't, create the exif row explicitly via `ctx.database.insertInto('asset_exif').values({ assetId, latitude, longitude }).execute()` — locate `ctx.newAsset` by grepping the factory and follow its convention.

### Task 6.2: Test — direct `shared_space_asset` included for member (matrix row 1)

**Files:**

- Modify: `server/test/medium/specs/repositories/map.repository.spec.ts`

**Step 1:** Inside `describe('getMapMarkers', ...)`, add:

```ts
it('should include a direct shared_space_asset for a member with showInTimeline=true', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  await ctx.database
    .insertInto('asset_exif')
    .values({ assetId: asset.id, latitude: 48.8566, longitude: 2.3522, city: 'Paris', state: null, country: 'France' })
    .execute();
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

  const results = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [space.id] });

  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ id: asset.id, lat: 48.8566, lon: 2.3522 });
});
```

**Step 2:** Run.

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/map.repository.spec.ts && cd ..
# Expected: 1 passing
```

**Step 3:** Commit.

```bash
git add server/test/medium/specs/repositories/map.repository.spec.ts
git commit -m "test(server): medium test for direct space asset on map (row 1)"
```

### Task 6.3: Test — library-linked asset included for member (matrix rows 3, 4)

**Step 1:** Append:

```ts
it('should include a library-linked asset via shared_space_library for a member', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
  const { library } = await ctx.newLibrary({ ownerId: owner.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
  const { asset } = await ctx.newAsset({
    ownerId: owner.id,
    libraryId: library.id,
    visibility: AssetVisibility.Timeline,
  });
  await ctx.database
    .insertInto('asset_exif')
    .values({ assetId: asset.id, latitude: 40.7128, longitude: -74.006 })
    .execute();

  const results = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [space.id] });

  expect(results).toHaveLength(1);
  expect(results[0].id).toBe(asset.id);
});
```

**Step 2:** Run; commit.

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/map.repository.spec.ts && cd ..
git add server/test/medium/specs/repositories/map.repository.spec.ts
git commit -m "test(server): medium test for library-linked space asset on map (row 3)"
```

### Task 6.4: Test — owner-archived space asset hidden by default (matrix row 10)

```ts
it('should NOT include space asset when owner visibility=Archive and isArchived=undefined', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
  await ctx.database.insertInto('asset_exif').values({ assetId: asset.id, latitude: 1, longitude: 1 }).execute();
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

  const results = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [space.id] });

  expect(results.find((r) => r.id === asset.id)).toBeUndefined();
});
```

Run; commit.

### Task 6.5: Test — owner-archived space asset hidden even with `isArchived=true` (matrix row 11, critical)

```ts
it('should NOT include owner-archived space asset even when isArchived=true (member archive toggle does not leak owner archive)', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
  await ctx.database.insertInto('asset_exif').values({ assetId: asset.id, latitude: 2, longitude: 2 }).execute();
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

  const results = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [space.id], isArchived: true });

  expect(results.find((r) => r.id === asset.id)).toBeUndefined();
});
```

Run; commit with message `"test(server): critical — owner archive not leaked via space (row 11)"`.

### Task 6.6: Test — asset without GPS excluded (matrix row 12)

```ts
it('should exclude space asset without GPS coordinates', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  // no asset_exif row — asset has no GPS
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

  const results = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [space.id] });

  expect(results.find((r) => r.id === asset.id)).toBeUndefined();
});
```

Run; commit.

### Task 6.7: Test — trashed space asset excluded (matrix row 13)

```ts
it('should exclude trashed space asset', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
  const { asset } = await ctx.newAsset({
    ownerId: owner.id,
    visibility: AssetVisibility.Timeline,
    deletedAt: new Date(),
  });
  await ctx.database.insertInto('asset_exif').values({ assetId: asset.id, latitude: 3, longitude: 3 }).execute();
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

  const results = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [space.id] });

  expect(results.find((r) => r.id === asset.id)).toBeUndefined();
});
```

Run; commit.

> If `ctx.newAsset` doesn't accept `deletedAt`, insert via `ctx.database.updateTable('asset').set({ deletedAt: ... })` after creation.

### Task 6.8: Test — Locked-visibility space asset excluded (matrix row 14)

```ts
it('should exclude Locked-visibility space asset', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
  await ctx.database.insertInto('asset_exif').values({ assetId: asset.id, latitude: 4, longitude: 4 }).execute();
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

  const results = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [space.id] });

  expect(results.find((r) => r.id === asset.id)).toBeUndefined();
});
```

Run; commit.

### Task 6.9: Test — library in two spaces, mixed `showInTimeline` (matrix row 18)

This is a service-level scenario but the repo test verifies the SQL: with only space A's ID passed, the asset shows via A; passing no space IDs hides it.

```ts
it('should include library-linked asset when at least one containing space is passed in timelineSpaceIds', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.id, name: 'A' });
  const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.id, name: 'B' });
  await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: member.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: member.id });
  const { library } = await ctx.newLibrary({ ownerId: owner.id });
  await ctx.newSharedSpaceLibrary({ spaceId: spaceA.id, libraryId: library.id });
  await ctx.newSharedSpaceLibrary({ spaceId: spaceB.id, libraryId: library.id });
  const { asset } = await ctx.newAsset({
    ownerId: owner.id,
    libraryId: library.id,
    visibility: AssetVisibility.Timeline,
  });
  await ctx.database.insertInto('asset_exif').values({ assetId: asset.id, latitude: 5, longitude: 5 }).execute();

  const viaA = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [spaceA.id] });
  expect(viaA.find((r) => r.id === asset.id)).toBeDefined();

  const none = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [] });
  expect(none.find((r) => r.id === asset.id)).toBeUndefined();
});
```

Run; commit.

### Task 6.10: Test — direct asset in two spaces, mixed `showInTimeline` (matrix row 22)

```ts
it('should include direct space asset when at least one containing space is in timelineSpaceIds', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.id, name: 'A' });
  const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.id, name: 'B' });
  await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: member.id });
  await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: member.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  await ctx.database.insertInto('asset_exif').values({ assetId: asset.id, latitude: 6, longitude: 6 }).execute();
  await ctx.newSharedSpaceAsset({ spaceId: spaceA.id, assetId: asset.id });
  await ctx.newSharedSpaceAsset({ spaceId: spaceB.id, assetId: asset.id });

  const viaA = await sut.getMapMarkers([member.id], [], { timelineSpaceIds: [spaceA.id] });
  expect(viaA.find((r) => r.id === asset.id)).toBeDefined();
});
```

Run; commit.

### Task 6.11: Tag + rating filter medium tests on the filtered endpoint (matrix rows 23, 24)

These go in `server/test/medium/specs/repositories/shared-space.repository.spec.ts` since they exercise `SharedSpaceRepository.getFilteredMapMarkers` which uses `searchAssetBuilder`.

**Files:**

- Modify: `server/test/medium/specs/repositories/shared-space.repository.spec.ts`

**Step 1:** Near the bottom of the file, append a `describe('getFilteredMapMarkers — space filter interaction', ...)` block with two tests:

```ts
describe('getFilteredMapMarkers — space filter interaction', () => {
  it('should include tagged space assets when tagIds filter is applied with timelineSpaceIds', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.database.insertInto('asset_exif').values({ assetId: asset.id, latitude: 10, longitude: 10 }).execute();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    // Create a tag owned by the owner and attach it to the asset
    const tag = await ctx.database
      .insertInto('tag')
      .values({ value: 'landscape', userId: owner.id, parentId: null })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database.insertInto('tag_asset').values({ tagId: tag.id, assetId: asset.id }).execute();

    const results = await sut.getFilteredMapMarkers({
      userIds: [member.id],
      timelineSpaceIds: [space.id],
      tagIds: [tag.id],
      tagMatchAny: true,
      visibility: AssetVisibility.Timeline,
    });

    expect(results.find((r) => r.id === asset.id)).toBeDefined();
  });

  it('should filter space assets by owner-set rating', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.database
      .insertInto('asset_exif')
      .values({ assetId: asset.id, latitude: 11, longitude: 11, rating: 5 })
      .execute();
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const matching = await sut.getFilteredMapMarkers({
      userIds: [member.id],
      timelineSpaceIds: [space.id],
      rating: 5,
      visibility: AssetVisibility.Timeline,
    });
    expect(matching.find((r) => r.id === asset.id)).toBeDefined();

    const nonMatching = await sut.getFilteredMapMarkers({
      userIds: [member.id],
      timelineSpaceIds: [space.id],
      rating: 1,
      visibility: AssetVisibility.Timeline,
    });
    expect(nonMatching.find((r) => r.id === asset.id)).toBeUndefined();
  });
});
```

**Step 2:** Run.

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts && cd ..
```

**Step 3:** Commit.

```bash
git add server/test/medium/specs/repositories/shared-space.repository.spec.ts
git commit -m "test(server): tag and rating filter × space interaction (rows 23, 24)"
```

### Task 6.12: Filtered endpoint — direct + library-linked inclusion (matrix rows 2, 4)

Rows 2 and 4 mirror rows 1 and 3 but on `SharedSpaceRepository.getFilteredMapMarkers` instead of `MapRepository.getMapMarkers`. The medium tests live in the same file as Task 6.11 since it's the shared-space repo.

**Files:**

- Modify: `server/test/medium/specs/repositories/shared-space.repository.spec.ts`

**Step 1:** Append to the `describe('getFilteredMapMarkers — space filter interaction', ...)` block (or add a sibling block titled `describe('getFilteredMapMarkers — space membership inclusion', ...)` if you want them grouped logically):

```ts
it('should include a direct shared_space_asset via timelineSpaceIds (row 2)', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
  const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
  await ctx.database.insertInto('asset_exif').values({ assetId: asset.id, latitude: 20, longitude: 20 }).execute();
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

  const results = await sut.getFilteredMapMarkers({
    userIds: [member.id],
    timelineSpaceIds: [space.id],
    visibility: AssetVisibility.Timeline,
  });

  expect(results.find((r) => r.id === asset.id)).toBeDefined();
});

it('should include a library-linked asset via timelineSpaceIds (row 4)', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: member } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id });
  const { library } = await ctx.newLibrary({ ownerId: owner.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });
  const { asset } = await ctx.newAsset({
    ownerId: owner.id,
    libraryId: library.id,
    visibility: AssetVisibility.Timeline,
  });
  await ctx.database.insertInto('asset_exif').values({ assetId: asset.id, latitude: 21, longitude: 21 }).execute();

  const results = await sut.getFilteredMapMarkers({
    userIds: [member.id],
    timelineSpaceIds: [space.id],
    visibility: AssetVisibility.Timeline,
  });

  expect(results.find((r) => r.id === asset.id)).toBeDefined();
});
```

**Step 2:** Run.

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts && cd ..
```

**Step 3:** Commit.

```bash
git add server/test/medium/specs/repositories/shared-space.repository.spec.ts
git commit -m "test(server): filtered endpoint direct + library inclusion (rows 2, 4)"
```

---

## Phase 7 — Web wiring

### Task 7.1: Pass `withSharedSpaces: true` in `map.svelte`

**Files:**

- Modify: `web/src/lib/components/shared-components/map/map.svelte`

**Step 1:** Find `loadMapMarkers` at line 231. In the `getMapMarkers({...})` call (lines 244-256), add `withSharedSpaces: true`:

```ts
return await getMapMarkers(
  {
    isArchived: includeArchived || undefined,
    isFavorite: onlyFavorites || undefined,
    fileCreatedAfter: fileCreatedAfter || undefined,
    fileCreatedBefore,
    withPartners: withPartners || undefined,
    withSharedAlbums: withSharedAlbums || undefined,
    withSharedSpaces: true,
  },
  {
    signal: abortController.signal,
  },
);
```

**Step 2:** Run web type-check.

```bash
cd web && pnpm check && cd ..
# Expected: no errors
```

**Step 3:** Commit.

```bash
git add web/src/lib/components/shared-components/map/map.svelte
git commit -m "feat(web): include shared spaces on basic map marker fetch"
```

### Task 7.2: Pass `withSharedSpaces: true` in the filter-panel effect

**Files:**

- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte`

**Step 1:** Find the `$effect` at line 103 that calls `getFilteredMapMarkers`. In the object passed, add `...(!currentSpaceId && { withSharedSpaces: true })`:

```ts
void getFilteredMapMarkers({
  ...(currentSpaceId && { spaceId: currentSpaceId }),
  ...(!currentSpaceId && { withSharedSpaces: true }),
  ...(personIds.length > 0 && { personIds }),
  ...(make && { make }),
  ...(model && { model }),
  ...(tagIds.length > 0 && { tagIds }),
  ...(rating !== undefined && { rating }),
  ...(mediaType !== 'all' && { $type: mediaType === 'image' ? 'IMAGE' : 'VIDEO' }),
  ...(isFavorite !== undefined && { isFavorite }),
  ...(city && { city }),
  ...(country && { country }),
  ...(context?.takenAfter && { takenAfter: context.takenAfter }),
  ...(context?.takenBefore && { takenBefore: context.takenBefore }),
});
```

**Step 2:** Run web type-check.

```bash
cd web && pnpm check && cd ..
```

**Step 3:** Commit.

```bash
git add web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte
git commit -m "feat(web): include shared spaces on filtered map markers"
```

---

## Phase 8 — Mobile wiring

### Task 8.1: Add `withSharedSpaces` to `MapService.getMapMarkers`

**Files:**

- Modify: `mobile/lib/services/map.service.dart`

**Step 1:** Replace the method signature and body (lines 22-44):

```dart
Future<Iterable<MapMarker>> getMapMarkers({
  bool? isFavorite,
  bool? withArchived,
  bool? withPartners,
  bool? withSharedSpaces,
  DateTime? fileCreatedAfter,
  DateTime? fileCreatedBefore,
}) async {
  return logError(
    () async {
      final markers = await _apiService.mapApi.getMapMarkers(
        isFavorite: isFavorite,
        isArchived: withArchived,
        withPartners: withPartners,
        withSharedSpaces: withSharedSpaces,
        fileCreatedAfter: fileCreatedAfter,
        fileCreatedBefore: fileCreatedBefore,
      );

      return markers?.map(MapMarker.fromDto) ?? [];
    },
    defaultValue: [],
    errorMessage: "Failed to get map markers",
  );
}
```

**Step 2:** Analyze.

```bash
cd mobile && dart analyze lib/services/map.service.dart && cd ..
```

**Step 3:** Commit.

```bash
git add mobile/lib/services/map.service.dart
git commit -m "feat(mobile): thread withSharedSpaces through MapService"
```

### Task 8.2: Pass `withSharedSpaces: true` from the provider

**Files:**

- Modify: `mobile/lib/providers/map/map_marker.provider.dart`

**Step 1:** In the `service.getMapMarkers(...)` call (lines 26-31), add `withSharedSpaces: true`:

```dart
final markers = await service.getMapMarkers(
  isFavorite: isFavorite,
  withArchived: isIncludeArchived,
  withPartners: isWithPartners,
  withSharedSpaces: true,
  fileCreatedAfter: fileCreatedAfter,
);
```

**Step 2:** Analyze.

```bash
cd mobile && dart analyze lib/providers/map/ && cd ..
```

**Step 3:** Commit.

```bash
git add mobile/lib/providers/map/map_marker.provider.dart
git commit -m "feat(mobile): always include shared spaces on map"
```

### Task 8.3: Flutter unit test — flag reaches the API

**Files:**

- Create: `mobile/test/services/map_service_test.dart` (follow existing mobile test dir convention; if `mobile/test/services/` doesn't exist yet, create it).

**Step 1:** Scaffold the test:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/services/map.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../api.mocks.dart';

void main() {
  group('MapService.getMapMarkers', () {
    late MockApiService apiService;
    late MockMapApi mapApi;
    late MapService sut;

    setUp(() {
      apiService = MockApiService();
      mapApi = MockMapApi();
      when(() => apiService.mapApi).thenReturn(mapApi);
      sut = MapService(apiService);
    });

    test('passes withSharedSpaces through to the API client', () async {
      when(() => mapApi.getMapMarkers(
            isFavorite: any(named: 'isFavorite'),
            isArchived: any(named: 'isArchived'),
            withPartners: any(named: 'withPartners'),
            withSharedSpaces: any(named: 'withSharedSpaces'),
            fileCreatedAfter: any(named: 'fileCreatedAfter'),
            fileCreatedBefore: any(named: 'fileCreatedBefore'),
          )).thenAnswer((_) async => []);

      await sut.getMapMarkers(withSharedSpaces: true);

      verify(() => mapApi.getMapMarkers(
            isFavorite: null,
            isArchived: null,
            withPartners: null,
            withSharedSpaces: true,
            fileCreatedAfter: null,
            fileCreatedBefore: null,
          )).called(1);
    });
  });
}
```

**Step 2:** Check `mobile/test/api.mocks.dart` to confirm `MockApiService` and `MockMapApi` are exported. If `MockMapApi` doesn't exist, either generate it (common mocktail pattern: `class MockMapApi extends Mock implements MapApi {}` in the same file) or inline the class at the top of the test file.

```bash
grep -n "MockMapApi\|MockApiService" mobile/test/api.mocks.dart
```

If missing, inline at the top of the test file:

```dart
class MockMapApi extends Mock implements MapApi {}
class MockApiService extends Mock implements ApiService {}
```

**Step 3:** Run.

```bash
cd mobile && flutter test test/services/map_service_test.dart && cd ..
# Expected: 1 passing
```

**Step 4:** Commit.

```bash
git add mobile/test/services/map_service_test.dart
git commit -m "test(mobile): verify withSharedSpaces reaches API client"
```

---

## Phase 9 — E2E web spec

### Task 9.1: E2E spec — member visibility on personal map

**Files:**

- Create: `e2e/src/specs/web/space-map-markers.e2e-spec.ts`

**SDK helper verification (do this first, before writing any code):** some helpers referenced in earlier drafts of this plan were never in `utils`. Confirmed available vs. missing by `grep -n "^  [a-zA-Z]*:" e2e/src/utils.ts`:

- `utils.adminSetup()` ✅
- `utils.userSetup(accessToken, dto)` ✅ — **creates** a user, returns a `UserAdminResponseDto`. Does NOT log the user in.
- `utils.createSpace`, `utils.addSpaceMember`, `utils.addSpaceAssets`, `utils.createAsset` ✅
- `utils.setAuthCookies(context, accessToken)` ✅
- `utils.login(...)` ❌ — NOT a helper. Call the SDK's `login` directly: `login({ loginCredentialDto: { email, password } })`.
- `utils.updateAssets(...)` ❌ — NOT a helper. Call the SDK's `updateAssets` directly.
- `utils.updateSpaceMember(...)` ❌ — NOT a helper. Use the SDK's `updateMemberTimeline` (confirmed at `open-api/typescript-sdk/src/fetch-client.ts:6847`, endpoint `PATCH /shared-spaces/{id}/members/me/timeline`). **Must be called with the member's own access token** (it's the `/me/` form).
- `utils.removeSpaceMember(...)` — check `e2e/src/utils.ts`; if absent, call the SDK's `removeMember` directly against `DELETE /shared-spaces/{id}/members/{userId}` from admin.

**Step 1:** Create the file with all four sub-tests (rows 1, 7, 8, 9):

```ts
import {
  asBearerAuth,
  login,
  removeMember as removeSpaceMember,
  updateAssets,
  updateMemberTimeline,
} from '@immich/sdk';
import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

// Asset-creation helper: createAsset in utils doesn't set GPS coords, so we
// patch the asset after upload via the SDK's bulk update endpoint.
async function setAssetGeo(accessToken: string, assetId: string, latitude: number, longitude: number) {
  await updateAssets(
    { assetBulkUpdateDto: { ids: [assetId], latitude, longitude } },
    { headers: asBearerAuth(accessToken) },
  );
}

async function loginAs(email: string, password: string): Promise<LoginResponseDto> {
  return login({ loginCredentialDto: { email, password } });
}

test.describe('Space photos on personal map', () => {
  let admin: LoginResponseDto;
  let memberLogin: LoginResponseDto;
  let memberId: string;
  let spaceId: string;
  let ownerAssetId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Admin (owner) creates the space and member
    const member = await utils.userSetup(admin.accessToken, {
      email: 'member@test.com',
      name: 'Member',
      password: 'password',
    });
    memberId = member.id;
    memberLogin = await loginAs('member@test.com', 'password');

    const space = await utils.createSpace(admin.accessToken, { name: 'Trip Photos' });
    spaceId = space.id;
    await utils.addSpaceMember(admin.accessToken, space.id, { userId: member.id, role: 'viewer' });

    // Owner uploads an asset, sets its GPS, adds it to the space
    const asset = await utils.createAsset(admin.accessToken);
    ownerAssetId = asset.id;
    await setAssetGeo(admin.accessToken, asset.id, 48.8566, 2.3522); // Paris
    await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);
  });

  async function fetchMarkersOnMap(
    context: import('@playwright/test').BrowserContext,
    page: import('@playwright/test').Page,
    accessToken: string,
  ) {
    await utils.setAuthCookies(context, accessToken);
    const [markerResponse] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/map/markers') && resp.request().method() === 'GET'),
      page.goto('/map'),
    ]);
    return (await markerResponse.json()) as Array<{ id: string }>;
  }

  test('member sees space marker on personal map (matrix row 1)', async ({ context, page }) => {
    const markers = await fetchMarkersOnMap(context, page, memberLogin.accessToken);
    expect(markers.find((m) => m.id === ownerAssetId)).toBeDefined();
  });

  test('marker disappears when member sets showInTimeline=false (matrix row 7)', async ({ context, page }) => {
    // Self-PATCH — `/me/timeline` requires the member's own token, not admin's.
    await updateMemberTimeline(
      { id: spaceId, sharedSpaceMemberTimelineDto: { showInTimeline: false } },
      { headers: asBearerAuth(memberLogin.accessToken) },
    );

    const markers = await fetchMarkersOnMap(context, page, memberLogin.accessToken);
    expect(markers.find((m) => m.id === ownerAssetId)).toBeUndefined();

    // Restore so subsequent tests in this describe don't inherit the off state.
    await updateMemberTimeline(
      { id: spaceId, sharedSpaceMemberTimelineDto: { showInTimeline: true } },
      { headers: asBearerAuth(memberLogin.accessToken) },
    );
  });

  test('non-member sees no space markers (matrix row 8)', async ({ context, page }) => {
    await utils.userSetup(admin.accessToken, {
      email: 'outsider@test.com',
      name: 'Outsider',
      password: 'password',
    });
    const outsiderLogin = await loginAs('outsider@test.com', 'password');

    const markers = await fetchMarkersOnMap(context, page, outsiderLogin.accessToken);
    expect(markers.find((m) => m.id === ownerAssetId)).toBeUndefined();
  });

  test('former member (removed from space) sees no marker (matrix row 9)', async ({ context, page }) => {
    // Admin removes the member from the space.
    await removeSpaceMember({ id: spaceId, userId: memberId }, { headers: asBearerAuth(admin.accessToken) });

    const markers = await fetchMarkersOnMap(context, page, memberLogin.accessToken);
    expect(markers.find((m) => m.id === ownerAssetId)).toBeUndefined();

    // Re-add the member so we leave state consistent if other specs share this file's describe.
    await utils.addSpaceMember(admin.accessToken, spaceId, { userId: memberId, role: 'viewer' });
  });
});
```

**Step 2:** Verify the exact SDK names imported above compile against the regenerated TS SDK (Phase 5 must be done first):

```bash
cd e2e && pnpm tsc --noEmit && cd ..
```

If `removeMember` (aliased as `removeSpaceMember`), `updateMemberTimeline`, `updateAssets`, or `login` have different exported names in your regenerated SDK, grep for the actual name:

```bash
grep -n "export function" open-api/typescript-sdk/src/fetch-client.ts | grep -i "member\|login\|updateAssets" | head
```

Adjust the imports accordingly. The SDK is generated from `open-api/immich-openapi-specs.json`; names are stable across regens for unchanged endpoints.

**Step 3:** Run the e2e suite against a running dev stack.

```bash
# Terminal 1:
make dev
# Wait for healthy (server + web + postgres + redis + ml)
# Terminal 2 — run just this spec:
cd e2e && pnpm exec playwright test src/specs/web/space-map-markers.e2e-spec.ts && cd ..
```

**Step 4:** All four tests should pass. If any flake on marker-list timing, the issue is likely the map page's debounced fetch vs. `page.goto` race — add `await page.waitForLoadState('networkidle')` after the goto, or switch to polling the SDK directly instead of intercepting the network response.

**Step 5:** Commit.

```bash
git add e2e/src/specs/web/space-map-markers.e2e-spec.ts
git commit -m "test(e2e): space photos on personal map — rows 1, 7, 8, 9"
```

---

## Phase 10 — Full verification

### Task 10.1: Server-wide type-check + lint + unit tests

```bash
make check-server
cd server && pnpm test && cd ..
```

Expected: all green. Fix any regression introduced upstream (existing `map.service` spec assertions may need the `objectContaining` tweak from Task 2.6 if not already applied).

### Task 10.2: Web-wide type-check + lint + unit tests

```bash
make check-web
cd web && pnpm test && cd ..
```

### Task 10.3: Mobile-wide static analysis

```bash
cd mobile && dart analyze && cd ..
```

Per memory `feedback_openapi_dart_generation.md`: never run `dart format` on generated `*.g.dart` files. Any DCM warnings surfaced by the rebase are pre-existing (see `project_rebase_v262_fixups.md`) — do not "fix" unrelated warnings.

### Task 10.4: Regenerate generated artifacts if stale

If any generated file (OpenAPI spec, SQL snapshot) is out of sync:

```bash
cd server && pnpm build && pnpm sync:open-api && cd ..
make open-api
# Only run make sql if dev DB is running:
make dev   # separate terminal
make sql
```

Commit any diffs with `chore(generated): sync after …`.

### Task 10.5: Final commit hygiene check

```bash
git log --oneline main..feat/space-map-markers
```

You should see a logical sequence: DTO adds → repo interface → service implementations → repo SQL → SDK regen → medium tests → web wiring → mobile wiring → E2E → verification. Squash / reorder with interactive rebase only if explicitly asked — per CLAUDE.md, prefer new commits to amends, and never use `rebase -i` non-interactively.

---

## Phase 11 — Manual QA (cannot be automated)

### Task 11.1: Web golden path

1. `make dev`; wait for `https://localhost:2283` to be reachable.
2. Sign in as admin; create a second user via admin → users; log out.
3. As admin: upload a geo-tagged photo (drag-drop any image with GPS exif); create a shared space; add the second user as member; add the photo to the space.
4. As second user: visit `/map`; expect a marker at the photo's location.
5. Via `/spaces/<spaceId>/settings` (or a member's space menu), toggle `showInTimeline=false`; reload `/map`; expect the marker gone.
6. Toggle back; expect the marker returns.

### Task 11.2: Web filter-panel path

Repeat the above, then expand the filter panel on `/map`, apply a rating / tag filter, and confirm the member can surface the owner's asset through the filter.

### Task 11.3: Negative-matrix sweep

Seed a dev stack with the scenarios in the design doc's "Final manual QA" section:

- Two users, two spaces, one linked library.
- Assets in mixed visibility states (Timeline, Archive, Locked, trashed, no-GPS).

Walk the negative rows of the permission matrix (cases 7-17, 19, 22) manually against `/map`. Each should match the expected behavior in the design doc. If any row diverges, file a bug — do not ship.

### Task 11.4: Mobile smoke check (on device)

Build the mobile app from the branch, sign in as the member, open the map screen. Verify the space marker appears (online path). If it doesn't, inspect logs — the most common cause is a stale Dart SDK (`make open-api-dart` may need a re-run).

Document any findings in the PR description.

---

## Phase 12 — PR preparation

### Task 12.1: Update `feat/space-map-markers` branch with any missed changes

```bash
git status
# Expected: clean
git log --oneline main..feat/space-map-markers
```

### Task 12.2: Push and open PR

```bash
git push -u origin feat/space-map-markers
gh pr create \
  --title "feat: shared-space photos on personal map" \
  --body "$(cat <<'EOF'
## Summary

- Shared-space photos a user belongs to (via `shared_space_asset` direct or `shared_space_library` linked) now appear on the user's personal `/map`.
- Same `showInTimeline` per-space pref that controls timeline inclusion also controls map inclusion.
- Owner-archived space content stays hidden even when the member enables "include archived" (inner `visibility=Timeline` clause on the EXISTS).
- Member's `isFavorite=true` toggle silently drops space content (per-owner semantic doesn't generalize).
- Applies to both basic (`GET /map/markers`) and filtered (`GET /gallery-map/markers/filtered`) endpoints.
- Mobile remote API path updated; local Drift path already handled.

## Design & plan

- `docs/plans/2026-04-17-space-map-markers-design.md`
- `docs/plans/2026-04-17-space-map-markers-implementation.md`

## Test plan

- [ ] Server unit: `map.service.spec.ts`, `shared-space.service.spec.ts` (9 new tests)
- [ ] Server medium: `map.repository.spec.ts`, appended cases in `shared-space.repository.spec.ts`
- [ ] E2E web: `space-map-markers.e2e-spec.ts`
- [ ] Flutter unit: `map_service_test.dart`
- [ ] Manual QA sweep (design doc rows 7-17, 19, 22)
- [ ] Optional: `EXPLAIN ANALYZE` on `MapRepository.getMapMarkers` against realistic data
EOF
)"
```

### Task 12.3: CI babysit

Per memory `feedback_no_merge_before_green.md`, wait for all checks green. If CI fails, diagnose root cause (not a flaky-retry). Use the `babysit` skill if helpful.

---

## Execution notes

- **TDD rhythm** — every phase with server code follows red → green → commit. Do **not** batch multiple test-plus-impl steps into a single commit.
- **Generated files** — run `make open-api` and (if DB running) `make sql` only once at the boundary (Phase 5); avoid regenerating mid-phase.
- **Branding** — this change has no Immich→Gallery string swaps; the `apply-branding.sh` script is not relevant.
- **Permission memories to respect**:
  - `feedback_always_use_prs.md`: never push to main; PR is mandatory.
  - `feedback_never_merge_without_asking.md`: do not auto-merge; wait for user green light.
  - `feedback_review_before_merge.md`: user reviews the PR before merge, regardless of green CI.
