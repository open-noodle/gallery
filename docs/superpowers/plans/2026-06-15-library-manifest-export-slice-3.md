# Library Manifest Export — Slice 3 Implementation Plan (Album Membership)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Populate `albums` (the target user's OWN albums, `{id, name}`) on every page, and each asset's `albumIds` (the owner-owned albums it belongs to). Both scoped to `album.ownerId = :id` so every id in any `albumIds` resolves in `albums`. Assets that live only in another user's shared album get `albumIds: []`.

**Baseline:** Slices 1-2 complete (paginated single-attribute manifest with `albums: []`, `albumIds: []`). The response DTO already declares `albums` and `albumIds` — no DTO change needed.

**Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/library-manifest-export`. `export PATH="$HOME/.local/share/mise/shims:$PATH"`; pnpm from `server/`.

**Reuse:** `AlbumRepository.getOwnedNames(ownerId)` already exists and returns `{ id, albumName, ... }` for the owner's albums — use it for the `albums` list. Add one new grouped query for per-asset album ids.

---

## Task 1: Album-ids-for-assets repository query (TDD via the service)

**Files:**

- Modify `server/src/repositories/album.repository.ts` (add `getOwnedAlbumIdsForAssets`)
- Modify `server/src/services/library-manifest.service.ts` (fetch albums + memberships, populate fields)
- Modify `server/test/medium/specs/services/library-manifest.service.spec.ts` (album tests)

- [ ] **Step 1: Write failing album tests.** Append inside `describe('getManifest', ...)`:

```typescript
it('populates albumIds for an asset in multiple owned albums and lists the albums', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { album: a1 } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Trip' }, [asset.id]);
  const { album: a2 } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Family' }, [asset.id]);

  const auth = factory.auth({ user: { id: user.id } });
  const result = await sut.getManifest(auth, user.id);

  const entry = result.assets.find((x) => x.assetId === asset.id)!;
  expect(entry.albumIds.toSorted()).toEqual([a1.id, a2.id].toSorted());
  expect(result.albums.map((al) => al.id).toSorted()).toEqual([a1.id, a2.id].toSorted());
  expect(result.albums).toEqual(
    expect.arrayContaining([
      { id: a1.id, name: 'Trip' },
      { id: a2.id, name: 'Family' },
    ]),
  );
});

it('gives an asset in no album an empty albumIds', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });

  const auth = factory.auth({ user: { id: user.id } });
  const result = await sut.getManifest(auth, user.id);

  expect(result.assets.find((x) => x.assetId === asset.id)!.albumIds).toEqual([]);
});

it('does not include foreign shared-album membership and keeps the envelope consistent', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const { user: other } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  // other user's album containing this user's asset (a shared album owned by someone else)
  await ctx.newAlbum({ ownerId: other.id, albumName: 'Shared' }, [asset.id]);

  const auth = factory.auth({ user: { id: user.id } });
  const result = await sut.getManifest(auth, user.id);

  const entry = result.assets.find((x) => x.assetId === asset.id)!;
  expect(entry.albumIds).toEqual([]);
  // consistency invariant: every albumId referenced resolves in `albums`
  const albumIdSet = new Set(result.albums.map((al) => al.id));
  for (const a of result.assets) {
    for (const albumId of a.albumIds) {
      expect(albumIdSet.has(albumId)).toBe(true);
    }
  }
});

it('repeats the same albums list on every page', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const { asset: a } = await ctx.newAsset({ ownerId: user.id });
  const { asset: b } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newAlbum({ ownerId: user.id, albumName: 'All' }, [a.id, b.id]);

  const auth = factory.auth({ user: { id: user.id } });
  const page1 = await sut.getManifest(auth, user.id, undefined, 1);
  const page2 = await sut.getManifest(auth, user.id, page1.nextCursor ?? undefined, 1);

  expect(page1.albums).toEqual(page2.albums);
  expect(page1.albums).toHaveLength(1);
});
```

- [ ] **Step 2: Run — expect RED:** `pnpm test:medium -- library-manifest.service` → album tests fail (albumIds empty, albums empty).

- [ ] **Step 3: Add the repository method** to `album.repository.ts` (near `getMetadataForIds`/`getOwnedNames`). `DummyValue`, `GenerateSql`, `sql` are already imported; the `in`-with-array + empty-guard pattern mirrors `getMetadataForIds`:

```typescript
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async getOwnedAlbumIdsForAssets(ownerId: string, assetIds: string[]) {
    if (assetIds.length === 0) {
      return [];
    }

    return this.db
      .selectFrom('album_asset')
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .where('album.ownerId', '=', ownerId)
      .where('album.deletedAt', 'is', null)
      .where('album_asset.assetId', 'in', assetIds)
      .select('album_asset.assetId as assetId')
      .select((eb) => eb.fn<string[]>('array_agg', ['album_asset.albumId']).as('albumIds'))
      .groupBy('album_asset.assetId')
      .execute();
  }
```

- [ ] **Step 4: Update the service** `library-manifest.service.ts`. After computing `pageRows`, fetch albums + memberships and use them in the map + envelope:

```typescript
const assetIds = pageRows.map((row) => row.id);
const [ownedAlbums, albumMemberships] = await Promise.all([
  this.albumRepository.getOwnedNames(id),
  this.albumRepository.getOwnedAlbumIdsForAssets(id, assetIds),
]);
const albumIdsByAsset = new Map(albumMemberships.map((m) => [m.assetId, m.albumIds]));

const assets: LibraryManifestAssetDto[] = pageRows.map((row) => ({
  assetId: row.id,
  objectKey: row.originalPath,
  originalFileName: row.originalFileName,
  checksum: hexOrBufferToBase64(row.checksum)!,
  checksumAlgorithm: row.checksumAlgorithm,
  size: row.size ?? null,
  type: row.type,
  fileCreatedAt: asDateString(row.fileCreatedAt),
  fileModifiedAt: asDateString(row.fileModifiedAt),
  albumIds: albumIdsByAsset.get(row.id) ?? [],
}));

return {
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  owner: { id: user.id, email: user.email },
  albums: ownedAlbums.map((album) => ({ id: album.id, name: album.albumName })),
  assets,
  nextCursor: hasMore ? pageRows.at(-1)!.id : null,
};
```

(Remove the old `albums: []` and the old inline `albumIds: []`; keep everything else.)

- [ ] **Step 5: Run — expect GREEN:** `pnpm test:medium -- library-manifest.service` → all pass (Slices 1-2 tests + the 4 album tests). The Slice-1 happy-path test still expects `albums: []`/`albumIds: []` because that user has no albums and the asset is in none — still true.

- [ ] **Step 6: tsc + lint, then commit.**

```bash
pnpm exec tsc --noEmit            # 0 errors (trust this over LSP "cannot find module")
pnpm exec eslint --max-warnings 0 src/repositories/album.repository.ts src/services/library-manifest.service.ts test/medium/specs/services/library-manifest.service.spec.ts
git add server/src/repositories/album.repository.ts server/src/services/library-manifest.service.ts server/test/medium/specs/services/library-manifest.service.spec.ts
git commit -m "feat(manifest): owner-scoped album membership + albums list (TDD)"
```

---

## Task 2: e2e album assertion

**Files:** Modify `e2e/src/specs/server/api/library-manifest.e2e-spec.ts`

- [ ] **Step 1:** In the 200 happy-path test (or a new test), after creating the asset, create an album containing it and assert `albums`/`albumIds`. Use a raw request if no SDK helper is imported. Minimal addition — confirm there is a `utils.createAlbum` helper first (`grep -n "createAlbum" e2e/src/utils.ts`); if present:

```typescript
it('includes owned album membership', async () => {
  const asset = await utils.createAsset(admin.accessToken);
  const album = await utils.createAlbum(admin.accessToken, { albumName: 'E2E', assetIds: [asset.id] });
  const { status, body } = await request(app)
    .get(`/admin/users/${admin.userId}/library-manifest`)
    .set(asBearerAuth(admin.accessToken));
  expect(status).toBe(200);
  expect(body.albums.map((a: { id: string }) => a.id)).toContain(album.id);
  const entry = body.assets.find((a: { assetId: string }) => a.assetId === asset.id);
  expect(entry.albumIds).toContain(album.id);
});
```

If there is no `utils.createAlbum` helper, SKIP this Task 2 e2e addition (the medium tests fully cover album behavior) and note it — do not invent an unverified helper.

- [ ] **Step 2:** If added: commit.

```bash
git add e2e/src/specs/server/api/library-manifest.e2e-spec.ts
git commit -m "test(manifest): e2e for owned album membership"
```

---

## Slice 3 Done Criteria

- `pnpm test:medium -- library-manifest.service` green (Slices 1-2 + 4 album tests).
- `pnpm exec tsc --noEmit` 0 errors; eslint clean on changed files.
- `albums` and `albumIds` are owner-scoped and mutually consistent.
- (OpenAPI regen happens in the end-of-feature batch.)
