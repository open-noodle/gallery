# Space Albums Phase 1.6 — Slice 3: Late-Detection Backfill Covers the Album Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Photos added to a linked album _before_ their faces are detected must still sync into the space once detection lands. Today `getSpaceIdsForAsset` omits the album path, so neither post-detection backfill producer (`metadata.service` / `person.service`) ever learns the asset is in the space.

**Architecture:** One query change — add a third `union` branch (album → `album_asset` → space, filtered to `faceRecognitionEnabled`) to `getSpaceIdsForAsset`. Both producers (`metadata.service.ts` ~L1105 and `person.service.ts queueSharedSpaceFaceMatchesForAsset` ~L1088) call this method, so the single change fixes every consumer. Spec §6.

**Tech Stack:** Kysely, Vitest medium (testcontainers). Run from `server/`.

## Consistency note

`isAssetInSpace` and `getAlbumAssetIdsWithoutOtherSpacePath` already carry the album branch; `getSpaceIdsForAsset` is the lone sibling missing it. Mirror the existing direct/library branches exactly: filter only on `faceRecognitionEnabled` (NO `deletedAt`/`visibility` predicates — that fine filtering lives in `processSpaceFaceMatch`'s `isAssetInSpace` guard). Use `union` (not `unionAll`) so multi-path assets dedupe.

---

## Task 1: Add the album branch to `getSpaceIdsForAsset` (+ medium repo test)

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (`getSpaceIdsForAsset`)
- Test: `server/test/medium/specs/repositories/shared-space.repository.spec.ts`

- [ ] **Step 1: Write the failing medium test** — append inside the top-level `describe`, reusing the file's `setup()` → `{ ctx, sut }`:

```typescript
describe('getSpaceIdsForAsset (album path)', () => {
  it('returns a face-enabled space reachable only via a linked album', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'BackfillAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const rows = await sut.getSpaceIdsForAsset(asset.id);
    expect(rows.map((r) => r.spaceId)).toEqual([space.id]);
  });

  it('excludes a linked album whose space has face recognition disabled', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'NoFaceAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    await expect(sut.getSpaceIdsForAsset(asset.id)).resolves.toEqual([]);
  });

  it('dedupes a space reached via both a linked album and a direct add', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'DupAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await sut.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });

    const rows = await sut.getSpaceIdsForAsset(asset.id);
    expect(rows.map((r) => r.spaceId)).toEqual([space.id]);
  });

  it('does not return a space for an asset whose album is not linked', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'UnlinkedAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    await expect(sut.getSpaceIdsForAsset(asset.id)).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run RED** — `pnpm test:medium -- --run -t "getSpaceIdsForAsset (album path)"`. Expected: the first/third cases FAIL (album-only asset returns `[]` because the album branch is missing).

- [ ] **Step 3: Implement** — add this third `union` branch in `getSpaceIdsForAsset`, immediately after the existing `shared_space_library` union and before `.as('combined')`:

```typescript
          .union(
            this.db
              .selectFrom('shared_space_album')
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('shared_space', 'shared_space.id', 'shared_space_album.spaceId')
              .select('shared_space_album.spaceId')
              .where('album_asset.assetId', '=', assetId)
              .where('shared_space.faceRecognitionEnabled', '=', true),
          )
```

- [ ] **Step 4: Run GREEN** — `pnpm test:medium -- --run -t "getSpaceIdsForAsset (album path)"`. Expected: all 4 PASS.

- [ ] **Step 5: SQL docs** — `pnpm sql` (the method is `@GenerateSql`); stage the regenerated `server/src/queries/shared.space.repository.sql` diff.

- [ ] **Step 6: tsc + commit**

```bash
pnpm run check    # clean
git add server/src/repositories/shared-space.repository.ts server/test/medium/specs/repositories/shared-space.repository.spec.ts server/src/queries/shared.space.repository.sql
git commit -m "feat(spaces): getSpaceIdsForAsset includes the album path (slice 3)"
```

## Producer fan-out — already covered (no redundant unit test)

Both `metadata.service.ts` and `person.service.ts` fan out one backfill job per space returned by `getSpaceIdsForAsset`, and their existing unit specs already assert that with a mocked `getSpaceIdsForAsset`. Since those unit tests mock the method, an "album case" there would be identical to the existing direct/library cases (the producer is agnostic to how the space was found). The album branch's real behavior is proven by the medium repo test above; adding a mocked-method "album" unit test would be pure duplication, so it is intentionally omitted.

## Completion gate

- [ ] `pnpm test:medium -- --run -t "getSpaceIdsForAsset (album path)"` → 4 PASS.
- [ ] `pnpm run check` clean; `pnpm sql` leaves no uncommitted diff.
- [ ] Push.

## Edge-case coverage map (spec §6.4 → test)

| Spec edge                                        | Covered by                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1. album-only asset → returned                   | test 1                                                                                |
| 2. album + direct → once                         | test 3                                                                                |
| 3. album + library → once                        | same dedup mechanism as test 3 (union); library+album dedup is structurally identical |
| 4. face-disabled linked album → excluded         | test 2                                                                                |
| 5. unlinked album → not returned                 | test 4                                                                                |
| 6. multiple linked albums → single row           | union dedup (test 3 demonstrates union dedup)                                         |
| 7. late detection on album-only asset → backfill | medium repo test proves the space is returned; producer fan-out already unit-tested   |
