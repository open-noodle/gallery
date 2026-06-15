# Library Manifest Export — Slice 2 Implementation Plan (Keyset Pagination)

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add `?cursor=<assetId>` keyset pagination. Fetch `MANIFEST_PAGE_SIZE + 1`, trim to page size, set `nextCursor` to the last kept asset id iff more remain (else `null`). Stable across a changing library; `400` on an invalid cursor.

**Baseline:** Slice 1 is complete (single page, `nextCursor: null`). Build on it.

**Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/library-manifest-export`. `export PATH="$HOME/.local/share/mise/shims:$PATH"`; run pnpm from `server/`.

**Testability note:** `getManifest` gains an internal `pageSize` parameter defaulting to `MANIFEST_PAGE_SIZE`, so boundary tests use a tiny page size instead of seeding 1001 rows. The controller always uses the default.

---

## Task 1: Query DTO (cursor)

**Files:** Modify `server/src/dtos/library-manifest.dto.ts`

- [ ] **Step 1:** Add to the DTO file (after the response schema, before/after the exported classes):

```typescript
const LibraryManifestQuerySchema = z
  .object({
    cursor: z.uuidv4().optional().describe('Asset id cursor from the previous page (nextCursor)'),
  })
  .meta({ id: 'LibraryManifestQueryDto' });

export class LibraryManifestQueryDto extends createZodDto(LibraryManifestQuerySchema) {}
```

- [ ] **Step 2:** `pnpm exec tsc --noEmit` — clean. Commit:

```bash
git add server/src/dtos/library-manifest.dto.ts
git commit -m "feat(manifest): add cursor query DTO"
```

---

## Task 2: Repository cursor predicate + service trim (TDD)

**Files:**

- Modify `server/src/repositories/asset.repository.ts` (`getOwnedManifestAssets` gains a `cursor` arg)
- Modify `server/src/services/library-manifest.service.ts` (`getManifest` gains `cursor` + internal `pageSize`, computes `nextCursor`)
- Modify `server/test/medium/specs/services/library-manifest.service.spec.ts` (add pagination tests)

- [ ] **Step 1: Write failing pagination tests.** Append inside `describe('getManifest', ...)`:

```typescript
it('sets nextCursor and trims to pageSize when more rows remain', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const made = [];
  for (let i = 0; i < 3; i++) {
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    made.push(asset.id);
  }
  const ordered = [...made].toSorted();
  const auth = factory.auth({ user: { id: user.id } });

  const page1 = await sut.getManifest(auth, user.id, undefined, 2);
  expect(page1.assets.map((a) => a.assetId)).toEqual(ordered.slice(0, 2));
  expect(page1.nextCursor).toBe(ordered[1]);

  const page2 = await sut.getManifest(auth, user.id, page1.nextCursor ?? undefined, 2);
  expect(page2.assets.map((a) => a.assetId)).toEqual([ordered[2]]);
  expect(page2.nextCursor).toBeNull();
});

it('returns nextCursor null when the page exactly equals pageSize', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  await ctx.newAsset({ ownerId: user.id });
  await ctx.newAsset({ ownerId: user.id });
  const auth = factory.auth({ user: { id: user.id } });

  const page = await sut.getManifest(auth, user.id, undefined, 2);
  expect(page.assets).toHaveLength(2);
  expect(page.nextCursor).toBeNull();
});

it('paginates to exhaustion with no duplicates or skips', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const all = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    all.add(asset.id);
  }
  const auth = factory.auth({ user: { id: user.id } });

  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 10; guard++) {
    const page = await sut.getManifest(auth, user.id, cursor, 2);
    seen.push(...page.assets.map((a) => a.assetId));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  expect(seen).toHaveLength(5);
  expect(new Set(seen)).toEqual(all);
});

it('returns an empty page for a cursor past the end', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  await ctx.newAsset({ ownerId: user.id });
  const auth = factory.auth({ user: { id: user.id } });

  const page = await sut.getManifest(auth, user.id, 'ffffffff-ffff-4fff-bfff-ffffffffffff', 2);
  expect(page.assets).toEqual([]);
  expect(page.nextCursor).toBeNull();
});

it('accepts a cursor whose asset no longer exists (returns rows ordered after it)', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const auth = factory.auth({ user: { id: user.id } });

  // a random uuid less-than the existing id is unlikely; use a known-small cursor
  const page = await sut.getManifest(auth, user.id, '00000000-0000-4000-8000-000000000000', 2);
  expect(page.assets.map((a) => a.assetId)).toContain(asset.id);
});
```

- [ ] **Step 2: Run — expect RED** (`sut.getManifest` 4-arg form / nextCursor not computed):
      `pnpm test:medium -- library-manifest.service` → failures on nextCursor/pagination assertions.

- [ ] **Step 3: Update the repository method** in `asset.repository.ts`:

```typescript
  @GenerateSql({ params: [DummyValue.UUID, 1000, DummyValue.UUID] })
  getOwnedManifestAssets(ownerId: string, limit: number, cursor?: string) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.checksum',
        'asset.checksumAlgorithm',
        'asset.type',
        'asset.fileCreatedAt',
        'asset.fileModifiedAt',
      ])
      .select('asset_exif.fileSizeInByte as size')
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '=', AssetStatus.Active)
      .where('asset.libraryId', 'is', null)
      .where('asset.isExternal', '=', false)
      .$if(!!cursor, (qb) => qb.where('asset.id', '>', asUuid(cursor!)))
      .orderBy('asset.id')
      .limit(limit)
      .execute();
  }
```

- [ ] **Step 4: Update the service** `getManifest` in `library-manifest.service.ts`:

Change the signature and body:

```typescript
  async getManifest(
    auth: AuthDto,
    id: string,
    cursor?: string,
    pageSize: number = MANIFEST_PAGE_SIZE,
  ): Promise<LibraryManifestResponseDto> {
    const user = await this.userRepository.get(id, { withDeleted: true });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const rows = await this.assetRepository.getOwnedManifestAssets(id, pageSize + 1, cursor);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

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
      albumIds: [],
    }));

    return {
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      owner: { id: user.id, email: user.email },
      albums: [],
      assets,
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }
```

- [ ] **Step 5: Run — expect GREEN.** `pnpm test:medium -- library-manifest.service` → all pass (Slice 1 tests still green; new pagination tests pass).

- [ ] **Step 6: Commit.**

```bash
git add server/src/repositories/asset.repository.ts server/src/services/library-manifest.service.ts server/test/medium/specs/services/library-manifest.service.spec.ts
git commit -m "feat(manifest): keyset pagination (cursor + nextCursor, TDD)"
```

---

## Task 3: Controller wires the cursor + 400 test

**Files:**

- Modify `server/src/controllers/library-manifest.controller.ts`
- Modify `server/src/controllers/library-manifest.controller.spec.ts`

- [ ] **Step 1: Add the failing controller test** (append inside the describe):

```typescript
it('rejects an invalid cursor with 400', async () => {
  const { status } = await request(ctx.getHttpServer()).get(
    `/admin/users/aaaaaaaa-0000-4000-8000-000000000000/library-manifest?cursor=not-a-uuid`,
  );
  expect(status).toBe(400);
});
```

- [ ] **Step 2: Run — expect RED** (cursor not validated yet; returns 200/other): `pnpm test -- library-manifest.controller`.

- [ ] **Step 3: Wire the query DTO** in the controller — update imports and the handler:

```typescript
import { Controller, Get, Param, Query } from '@nestjs/common';
// add to the manifest dto import:
import { LibraryManifestQueryDto, LibraryManifestResponseDto } from 'src/dtos/library-manifest.dto';
```

```typescript
  getLibraryManifest(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() { cursor }: LibraryManifestQueryDto,
  ): Promise<LibraryManifestResponseDto> {
    return this.service.getManifest(auth, id, cursor);
  }
```

- [ ] **Step 4: Run — expect GREEN** (`pnpm test -- library-manifest.controller`): authenticated + bad `:id` 400 + bad cursor 400 all pass.

- [ ] **Step 5: tsc + lint** (`pnpm exec tsc --noEmit` clean; `pnpm exec eslint --max-warnings 0 <changed files>` clean), then commit:

```bash
git add server/src/controllers/library-manifest.controller.ts server/src/controllers/library-manifest.controller.spec.ts
git commit -m "feat(manifest): wire cursor query param into the controller (TDD)"
```

---

## Task 4: Extend the e2e (pagination)

**Files:** Modify `e2e/src/specs/server/api/library-manifest.e2e-spec.ts`

- [ ] **Step 1:** Add a test that creates 2 assets, requests with no cursor, and (if the default page is large) asserts both returned with `nextCursor: null`; and a 400 test for `?cursor=not-a-uuid`:

```typescript
it('rejects an invalid cursor (400)', async () => {
  const { status } = await request(app)
    .get(`/admin/users/${admin.userId}/library-manifest?cursor=not-a-uuid`)
    .set(asBearerAuth(admin.accessToken));
  expect(status).toBe(400);
});
```

- [ ] **Step 2:** Commit (e2e runs in CI):

```bash
git add e2e/src/specs/server/api/library-manifest.e2e-spec.ts
git commit -m "test(manifest): e2e for invalid cursor (400)"
```

---

## Slice 2 Done Criteria

- `pnpm test:medium -- library-manifest.service` green (all Slice 1 + pagination tests).
- `pnpm test -- library-manifest.controller` green (incl. 400 invalid cursor).
- `pnpm exec tsc --noEmit` 0 errors; eslint clean on changed files.
- (OpenAPI regen deferred to the end-of-feature batch.)
