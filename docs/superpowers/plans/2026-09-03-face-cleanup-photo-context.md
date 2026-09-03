# Face Cleanup Photo Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin open the full source photo — with the detected face boxed and the capture date shown — from any face tile in the Face Cleanup console, through an admin-gated route rather than the owner-scoped photo viewer.

**Architecture:** One new file-serving route (`GET /admin/face-repair/faces/:assetFaceId/preview`) that serves the already-generated preview file uncropped, plus seven context fields added to two existing list DTOs whose queries already join `asset`. Web renders a date pill and a magnifier on each tile; the magnifier opens a modal that draws the face box over the photo using the existing `getBoundingBox` geometry helper.

**Tech Stack:** NestJS 11 + Kysely (server), Zod DTOs, SvelteKit + Svelte 5 runes + `@immich/ui` (web), Vitest (unit/medium/e2e), Luxon (dates).

**Spec:** `docs/superpowers/specs/2026-09-03-face-cleanup-photo-context-design.md` — read it alongside this plan; every task below cites the spec section it implements.

## Global Constraints

- **Server has no relative imports.** Always use the `src/` path alias.
- **Server lint is `--max-warnings 0`,** and `prettier --check` is a **separate** CI gate that runs over `src/` **and** `test/`. `pnpm lint` passing does not mean prettier passes.
- **`pnpm test -- --run <path>` silently drops the path filter** and runs the entire suite. Always use
  `pnpm exec vitest --run <path>`. In `server/` that form ALSO needs the config flag —
  `pnpm exec vitest --config test/vitest.config.mjs --run <path>` — or it fails with
  `describe is not defined`. Medium tests use `--config test/vitest.config.medium.mjs` as already shown.
- **Every user-facing string lands in ten locale files in the same commit:** `en` plus `de` · `fr` · `it` · `nl` · `pl` · `es` · `ru` · `zh_Hans` · `zh_Hant`. Keys alphabetically sorted, 2-space indent, unescaped Unicode. Do not touch the other ~80 locale files.
- **`i18n/` is shared by web and mobile.** Grep both before renaming a key.
- **Markdown under `docs/` uses the docs package's prettier**, not web's: `pnpm -C docs exec prettier --write <file>`.
- **Regeneration after any `server/src/repositories/` or route change:** `mise open-api` and `mise sql`, run
  **from the repo ROOT** — both are root-level `mise.toml` tasks. `server/mise.toml` defines `sql` and
  `sync-open-api`, but NOT `open-api`, so `mise open-api` fails from `server/`. `make open-api` / `make sql`
  no longer exist at all.
- **Commit messages** end with `Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK` and never add a Claude co-author trailer.
- **Every test must be proven capable of failing.** After writing a test, run it and see red before implementing. Assertions that pass whether or not the feature exists (`queryBy...` without a paired positive control) do not count as coverage.

---

## File Structure

**Server — created:** none. Every change extends an existing file.

**Server — modified:**

| File                                                     | Responsibility added                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| `server/src/repositories/person.repository.ts`           | `getFaceByIdOnLiveAsset` — face lookup that refuses trashed assets    |
| `server/src/services/face-repair.service.ts`             | `getAdminFacePreview`; context passthrough in `getPersonFlaggedFaces` |
| `server/src/controllers/face-repair-admin.controller.ts` | the `/preview` route                                                  |
| `server/src/dtos/face-repair.dto.ts`                     | `FacePhotoContextSchema`, folded into the two list DTOs               |
| `server/src/repositories/face-repair-scan.repository.ts` | context columns on `getScanFlaggedFaces`                              |
| `server/src/repositories/face-repair.repository.ts`      | context columns on `getClusterFacePage`                               |

**Web — created:**

| File                                                         | Responsibility                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `web/src/lib/components/face-cleanup/FaceTileOverlay.svelte` | the date pill + magnifier chrome, shared by all three grids so the markup exists once |
| `web/src/lib/components/face-cleanup/FacePhotoModal.svelte`  | the lightbox: photo, box overlay, caption, arrow paging                               |

**Web — modified:** `people-utils.ts` (URL helper + `isUsableFaceBox`), the guided page and its `review.svelte.ts`, the manual page and its `manual-review.svelte.ts`.

**Tests — created:** `FaceTileOverlay.spec.ts`, `FacePhotoModal.spec.ts`, `e2e/src/specs/server/api/face-repair-preview.e2e-spec.ts`.

---

## Task 1: Repository — a face lookup that refuses trashed assets

Implements spec §4.1 (repository), tests T1.1–T1.5, edge cases E1, E2, E20.

**Files:**

- Modify: `server/src/repositories/person.repository.ts:565-580`
- Test: `server/test/medium/specs/repositories/person.repository.spec.ts:1241-1274` (add a sibling `describe`)

**Interfaces:**

- Consumes: nothing.
- Produces: `PersonRepository.getFaceByIdOnLiveAsset(id: string): Promise<Selectable<AssetFaceTable> & { person: ... }>` — rejects (via `executeTakeFirstOrThrow`) when no row matches. Task 2 consumes it.

- [ ] **Step 1: Write the failing tests**

Add this `describe` immediately after the existing `describe('getFaceByIdIncludingTombstoned')` block, which ends at `person.repository.spec.ts:1274`:

```ts
// The preview route serves the WHOLE source photo rather than a 250px crop, so it refuses a face whose
// asset is in the trash. The face tombstone stays allowed (the resolutions history renders tombstoned
// faces) — that asymmetry is the only difference from getFaceByIdIncludingTombstoned, and T1.4/T1.5 pin
// both halves of it.
describe('getFaceByIdOnLiveAsset', () => {
  it('T1.1/T1.2: returns a face on a live timeline asset, throws once its asset is trashed', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    const { asset: liveAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace: liveFace } = await ctx.newAssetFace({ assetId: liveAsset.id, personId: null });

    const { asset: trashedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace: trashedFace } = await ctx.newAssetFace({ assetId: trashedAsset.id, personId: null });
    await ctx.database.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', trashedAsset.id).execute();

    await expect(sut.getFaceByIdOnLiveAsset(liveFace.id)).resolves.toMatchObject({ id: liveFace.id }); // positive control
    await expect(sut.getFaceByIdOnLiveAsset(trashedFace.id)).rejects.toThrow();
  });

  it('T1.3: throws for a face on a locked asset', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
    const { assetFace: lockedFace } = await ctx.newAssetFace({ assetId: lockedAsset.id, personId: null });

    await expect(sut.getFaceByIdOnLiveAsset(lockedFace.id)).rejects.toThrow();
  });

  it('T1.4: still returns a tombstoned face whose asset is live', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
    await ctx.database
      .updateTable('asset_face')
      .set({ deletedAt: new Date() })
      .where('id', '=', assetFace.id)
      .execute();

    await expect(sut.getFaceByIdOnLiveAsset(assetFace.id)).resolves.toMatchObject({ id: assetFace.id });
  });

  it('T1.5 (pin): getFaceByIdIncludingTombstoned STILL returns a face on a trashed asset', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
    await ctx.database.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', asset.id).execute();

    // The three shipped crop surfaces must not change. If this ever goes red, the deletedAt filter was
    // added to the wrong method.
    await expect(sut.getFaceByIdIncludingTombstoned(assetFace.id)).resolves.toMatchObject({ id: assetFace.id });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/person.repository.spec.ts -t 'getFaceByIdOnLiveAsset'
```

Expected: FAIL — `sut.getFaceByIdOnLiveAsset is not a function`. T1.5 is not in this filter; it names the old method and would pass immediately, which is the point of a pin.

- [ ] **Step 3: Add the repository method**

Insert immediately after `getFaceByIdIncludingTombstoned`, which ends at `person.repository.ts:580`:

```ts
  // Sibling of getFaceByIdIncludingTombstoned for the admin PREVIEW route, which serves the whole source
  // photo rather than a 250px crop. It adds one filter: the asset must not be in the trash. The face
  // tombstone is deliberately still allowed through — the resolutions history renders tombstoned faces, so
  // a future magnifier there needs no server change.
  @GenerateSql({ params: [DummyValue.UUID] })
  getFaceByIdOnLiveAsset(id: string) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .select(withPerson)
      .where('asset_face.id', '=', id)
      .where('asset.deletedAt', 'is', null)
      .where((eb) => reviewableAssetVisibility(eb))
      .executeTakeFirstOrThrow();
  }
```

No new imports: `GenerateSql`, `DummyValue`, `withPerson` and `reviewableAssetVisibility` are all already imported in this file.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/person.repository.spec.ts
```

Expected: PASS, including T1.5.

- [ ] **Step 5: Prove the new filter is load-bearing**

Temporarily delete the `.where('asset.deletedAt', 'is', null)` line, re-run, and confirm T1.1/T1.2 goes RED. Restore the line. A filter that passes with and without itself is not tested.

- [ ] **Step 6: Regenerate SQL and run the proximity-sensitive guard**

`@GenerateSql` means this method emits a documented query. The visibility guard spec matches its allowlist by **proximity**, so inserting a method can flip the verdict on a neighbour that did not change.

```bash
cd server && mise sql
pnpm exec vitest --config test/vitest.config.mjs --run src/utils/shared-space-album-scope.guard.spec.ts
```

Expected: both clean. If `mise sql` emits empty files, it needs a clean `dist` (`rm -rf dist && pnpm build`) and a migrated throwaway Postgres.

- [ ] **Step 7: Commit**

```bash
git add server/src/repositories/person.repository.ts server/test/medium/specs/repositories/person.repository.spec.ts server/src/queries
git commit -m "$(cat <<'EOF'
feat(server): add a face lookup that refuses trashed assets

Sibling of getFaceByIdIncludingTombstoned for the upcoming admin preview
route. The face tombstone stays allowed; only the asset trash is refused,
because a preview serves the whole photo rather than a face crop.

Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK
EOF
)"
```

---

## Task 2: Service + controller — the preview route

Implements spec §4.1 (service, controller), tests T2.1–T2.9 and T3.1–T3.2, edge cases E3–E7, E18, E19, E22.

**Files:**

- Modify: `server/src/services/face-repair.service.ts:1288-1302` (add a sibling method)
- Modify: `server/src/controllers/face-repair-admin.controller.ts:207-220` (add a sibling route)
- Test: `server/src/services/face-repair.service.spec.ts`
- Test: `server/src/controllers/face-repair-admin.controller.spec.ts`

**Interfaces:**

- Consumes: `PersonRepository.getFaceByIdOnLiveAsset` (Task 1).
- Produces: `FaceRepairService.getAdminFacePreview(assetFaceId: string): Promise<ImmichMediaResponse>` and the route `GET /admin/face-repair/faces/:assetFaceId/preview`. Tasks 5 and 6 consume the route.

- [ ] **Step 1: Write the failing service tests**

Add this `describe` inside the existing `describe(FaceRepairService.name, ...)` in `face-repair.service.spec.ts`, after the `getAdminFaceThumbnail` block:

```ts
describe('getAdminFacePreview', () => {
  // The whole point of this route is that it is CHEAPER than the crop it sits beside: getFaceThumbnailSource
  // already located a generated preview file, so serving it uncropped is a straight backend serve — no
  // decode, no sharp, no temp dir. T2.2 and T2.8 are the tests that keep it that way.
  const stubServe = () =>
    vi
      .spyOn(sut as any, 'serveFromBackend')
      .mockResolvedValue(
        new ImmichFileResponse({ path: '/preview.jpg', contentType: 'image/jpeg', cacheControl: CacheControl.None }),
      );

  it('T2.1/T2.2/T2.7/T2.8: serves another user’s preview uncropped, via the backend, cached', async () => {
    const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
    mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(getForAssetFace(face));
    mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.jpg' } as any);
    const serve = stubServe();

    await sut.getAdminFacePreview('face-1');

    expect(mocks.person.getFaceByIdOnLiveAsset).toHaveBeenCalledWith('face-1');
    expect(mocks.access.person.checkOwnerAccess).not.toHaveBeenCalled();
    expect(mocks.media.generateThumbnail).not.toHaveBeenCalled(); // uncropped: no sharp pass
    expect(mocks.media.decodeImage).not.toHaveBeenCalled();
    expect(serve).toHaveBeenCalledWith('/preview.jpg', 'image/jpeg', CacheControl.PrivateWithCache);
  });

  it('T2.9: asks for the UNEDITED preview — the box lives in that image’s coordinate space', async () => {
    const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
    mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(getForAssetFace(face));
    mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.jpg' } as any);
    stubServe();

    await sut.getAdminFacePreview('face-1');

    expect(mocks.asset.getForThumbnail).toHaveBeenCalledWith('asset-1', AssetFileType.Preview, false);
  });

  it('T2.3: falls back to the thumbnail file when there is no preview file', async () => {
    const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
    mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(getForAssetFace(face));
    mocks.asset.getForThumbnail
      .mockResolvedValueOnce({ path: null } as any)
      .mockResolvedValueOnce({ path: '/thumb.jpg' } as any);
    const serve = stubServe();

    await sut.getAdminFacePreview('face-1');

    expect(serve).toHaveBeenCalledWith('/thumb.jpg', 'image/jpeg', CacheControl.PrivateWithCache);
  });

  it('T2.6: derives the content type from the file — a webp preview is not served as jpeg', async () => {
    const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
    mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(getForAssetFace(face));
    mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.webp' } as any);
    const serve = stubServe();

    await sut.getAdminFacePreview('face-1');

    expect(serve).toHaveBeenCalledWith('/preview.webp', 'image/webp', CacheControl.PrivateWithCache);
  });

  it('T2.5: throws NotFound for an unknown, trashed or locked face id — all indistinguishable', async () => {
    mocks.person.getFaceByIdOnLiveAsset.mockRejectedValue(new Error('no rows'));

    await expect(sut.getAdminFacePreview('nope')).rejects.toThrow(NotFoundException);
  });

  it('T2.4: throws NotFound when the asset has neither a preview nor a thumbnail file', async () => {
    const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
    mocks.person.getFaceByIdOnLiveAsset.mockResolvedValue(getForAssetFace(face));
    mocks.asset.getForThumbnail.mockResolvedValue({ path: null } as any);

    await expect(sut.getAdminFacePreview('face-1')).rejects.toThrow(NotFoundException);
  });
});
```

Extend the file's existing imports to cover the new names:

```ts
import { ImmichFileResponse, ImmichStreamResponse } from 'src/utils/file';
import { AssetFileType, CacheControl } from 'src/enum';
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.service.spec.ts
```

Expected: FAIL — `sut.getAdminFacePreview is not a function`.

- [ ] **Step 3: Add the service method**

Insert immediately after `getAdminFaceThumbnail`, which ends at `face-repair.service.ts:1302`:

```ts
  // Sibling of getAdminFaceThumbnail: same admin-only, face-keyed, ownership-free resolution, but serves
  // the SOURCE photo instead of the crop, so an admin can judge a face in context (issue #1061 — similar
  // -looking children are indistinguishable at 250px). getFaceThumbnailSource has already located the
  // generated preview file, so this is a straight serve: no decode, no crop, no temp dir. It is genuinely
  // cheaper than the thumbnail route beside it.
  async getAdminFacePreview(assetFaceId: string): Promise<ImmichMediaResponse> {
    let face: AssetFace;
    try {
      // NOT getFaceByIdIncludingTombstoned: that one serves faces on trashed assets, which is tolerable for
      // a face crop and not for a whole photo.
      face = await this.personRepository.getFaceByIdOnLiveAsset(assetFaceId);
    } catch {
      throw new NotFoundException();
    }

    const sourcePath = await this.getFaceThumbnailSource(face.assetId);
    if (!sourcePath) {
      throw new NotFoundException();
    }

    // serveFromBackend, not a bare ImmichFileResponse: the preview may live in S3, and the content type is
    // read from the file because image.preview.format is configurable (jpeg or webp).
    return this.serveFromBackend(sourcePath, mimeTypes.lookup(sourcePath), CacheControl.PrivateWithCache);
  }
```

Add these imports to `face-repair.service.ts`:

```ts
import { CacheControl } from 'src/enum';
import { mimeTypes } from 'src/utils/mime-types';
```

`src/enum` is already imported for `JobName, JobStatus, QueueName` — add `CacheControl` to that existing import rather than writing a second one.

- [ ] **Step 4: Run the service tests to verify they pass**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing controller tests**

Add to `face-repair-admin.controller.spec.ts`, after the thumbnail `describe` that ends at `:966`:

```ts
// Same shape as the thumbnail route's coverage above, and for the same reason: this route is new and
// returns any user's source photo by face id, so it must not be the one route on this controller with no
// coverage.
describe('GET /admin/face-repair/faces/:assetFaceId/preview', () => {
  const assetFaceId = '00000000-0000-4000-a000-000000000061';

  it('T3.1: should be an authenticated admin route', async () => {
    await request(ctx.getHttpServer()).get(`/admin/face-repair/faces/${assetFaceId}/preview`);
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ adminRoute: true }),
      }),
    );
  });

  it('T3.2: delegates to service.getAdminFacePreview with the assetFaceId', async () => {
    // ImmichRedirectResponse exercises sendFile's real dispatch without touching the filesystem.
    service.getAdminFacePreview.mockResolvedValue(
      new ImmichRedirectResponse({ url: 'https://example.com/photo.jpg', cacheControl: CacheControl.None }),
    );
    const { status, headers } = await request(ctx.getHttpServer())
      .get(`/admin/face-repair/faces/${assetFaceId}/preview`)
      .set('Authorization', 'Bearer token');
    expect(status).toBe(302);
    expect(headers.location).toBe('https://example.com/photo.jpg');
    expect(service.getAdminFacePreview).toHaveBeenCalledWith(assetFaceId);
  });

  it('rejects a non-uuid assetFaceId with 400', async () => {
    const { status } = await request(ctx.getHttpServer())
      .get('/admin/face-repair/faces/not-a-uuid/preview')
      .set('Authorization', 'Bearer token');
    expect(status).toBe(400);
    expect(service.getAdminFacePreview).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the controller tests to verify they fail**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/controllers/face-repair-admin.controller.spec.ts
```

Expected: FAIL — 404, because the route does not exist yet.

- [ ] **Step 7: Add the controller route**

Insert immediately after `getFaceRepairFaceThumbnail`, before the closing brace of the class at `face-repair-admin.controller.ts:221`:

```ts
  // The source photo behind a face crop (#1061). Admin-gated and face-keyed for exactly the reason the
  // thumbnail above is: the console repairs clusters in other people's libraries, and the owner-scoped
  // asset routes enforce Permission.AssetView with no admin bypass, so they would 403 on the main case.
  @Get('faces/:assetFaceId/preview')
  @FileResponse()
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Get an admin face-repair source photo', history: new HistoryBuilder().added('v1') })
  async getFaceRepairFacePreview(
    @Res() res: Response,
    @Next() next: NextFunction,
    @Param('assetFaceId', new ParseUUIDPipe({ version: '4' })) assetFaceId: string,
  ): Promise<void> {
    await sendFile(res, next, () => this.service.getAdminFacePreview(assetFaceId), this.logger);
  }
```

No new imports: every decorator and helper used here is already imported by this controller.

- [ ] **Step 8: Run both suites to verify they pass**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/controllers/face-repair-admin.controller.spec.ts src/services/face-repair.service.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Lint and format**

```bash
cd server && pnpm lint && pnpm exec prettier --check src test
```

Expected: clean. Note that eslint emits one false "unused eslint-disable directive" warning per `tscompat:off` directive; zero **errors** is the pass condition.

- [ ] **Step 10: Commit**

```bash
git add server/src/services/face-repair.service.ts server/src/services/face-repair.service.spec.ts server/src/controllers/face-repair-admin.controller.ts server/src/controllers/face-repair-admin.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): serve the source photo behind an admin face crop (#1061)

GET /admin/face-repair/faces/:id/preview serves the already-generated
preview file uncropped, so it costs less than the crop route beside it.
Admin-gated and face-keyed, because the owner-scoped asset routes enforce
AssetView with no admin bypass and would refuse the clusters this console
exists to repair.

Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK
EOF
)"
```

---

## Task 3: Context fields on the two list DTOs

Implements spec §4.2, tests T2.10–T2.11, T4.1–T4.3, T5.1–T5.3, edge case E12.

**Files:**

- Modify: `server/src/dtos/face-repair.dto.ts:134-138` and `:304-311`
- Modify: `server/src/repositories/face-repair-scan.repository.ts:294-320`
- Modify: `server/src/repositories/face-repair.repository.ts:217-248`
- Modify: `server/src/services/face-repair.service.ts:696-724`
- Test: `server/src/dtos/face-repair.dto.spec.ts`
- Test: `server/test/medium/specs/repositories/face-repair.repository.spec.ts`
- Test: `server/test/medium/specs/repositories/face-repair-scan-flagged-face.repository.spec.ts`
- Test: `server/src/services/face-repair.service.spec.ts`

**Interfaces:**

- Consumes: nothing from Tasks 1–2 (independent; may run in parallel).
- Produces: every face in `FaceRepairPersonFacesDto.flaggedFaces` and `FaceRepairClusterFacesResponseDto.faces` gains `localDateTime: string` plus `boundingBoxX1/Y1/X2/Y2`, `imageWidth`, `imageHeight` (all `number`). Tasks 6–9 consume these.

- [ ] **Step 1: Write the failing DTO tests**

Append to `server/src/dtos/face-repair.dto.spec.ts`:

```ts
// The console's grids need enough of the source photo to judge a face in context (#1061). These fields ride
// the two list DTOs rather than a second endpoint, because both underlying queries already join `asset`.
describe('face photo context on the list DTOs', () => {
  const context = {
    localDateTime: '2019-07-04T10:30:00.000Z',
    boundingBoxX1: 100,
    boundingBoxY1: 120,
    boundingBoxX2: 300,
    boundingBoxY2: 340,
    imageWidth: 1440,
    imageHeight: 1080,
  };

  it('T4.1: FaceRepairPersonFacesSchema accepts a flagged face carrying context', () => {
    const result = FaceRepairPersonFacesSchema.safeParse({
      personId: UUID_V4,
      flaggedFaces: [{ assetFaceId: UUID_V4, suspectedOwnerId: UUID_V4, ...context }],
    });
    expect(result.success).toBe(true);
  });

  it('T4.2: FaceRepairClusterFacesResponseSchema accepts a cluster face carrying context', () => {
    const result = FaceRepairClusterFacesResponseSchema.safeParse({
      faces: [{ assetFaceId: UUID_V4, ...context }],
      total: 1,
      hasMore: false,
    });
    expect(result.success).toBe(true);
  });

  it('T4.3: both reject a face missing localDateTime — the pill has no silent empty state', () => {
    const { localDateTime: _dropped, ...withoutDate } = context;

    expect(
      FaceRepairPersonFacesSchema.safeParse({
        personId: UUID_V4,
        flaggedFaces: [{ assetFaceId: UUID_V4, suspectedOwnerId: UUID_V4, ...withoutDate }],
      }).success,
    ).toBe(false);
    expect(
      FaceRepairClusterFacesResponseSchema.safeParse({
        faces: [{ assetFaceId: UUID_V4, ...withoutDate }],
        total: 1,
        hasMore: false,
      }).success,
    ).toBe(false);
  });
});
```

Add `FaceRepairPersonFacesSchema` and `FaceRepairClusterFacesResponseSchema` to the file's existing import from `src/dtos/face-repair.dto`.

- [ ] **Step 2: Run to verify they fail**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/dtos/face-repair.dto.spec.ts
```

Expected: T4.1 and T4.2 FAIL (unknown keys are stripped, so the parse succeeds but the fields vanish — assert on the parsed **data** if the schema is not strict; see Step 3's note). T4.3 FAILS because a missing field is currently permitted.

If T4.1/T4.2 pass trivially because zod strips unknown keys, tighten them to assert the parsed output instead:

```ts
expect(result.success && result.data.flaggedFaces[0].localDateTime).toBe('2019-07-04T10:30:00.000Z');
```

Use that form — a test that passes because the field was silently discarded is exactly the assertion-that-cannot-fail trap.

- [ ] **Step 3: Add the DTO schema**

In `face-repair.dto.ts`, replace line 134's `FlaggedFaceSchema` declaration with:

```ts
// Enough of the source photo to judge a face in context (#1061): when it was taken, and where in the frame
// the detection sits. Both list queries already inner-join `asset`, so these are added columns on queries
// that already run — no new join, no second round-trip.
//
// FLAT, not nested: this is byte-for-byte web's existing `FaceBox` type (web/src/lib/utils/people-utils.ts),
// so the client hands it straight to getBoundingBox/getFaceCropTransform.
const FacePhotoContextShape = {
  localDateTime: z.string().meta({ format: 'date-time' }),
  boundingBoxX1: z.number(),
  boundingBoxY1: z.number(),
  boundingBoxX2: z.number(),
  boundingBoxY2: z.number(),
  imageWidth: z.number(),
  imageHeight: z.number(),
};

const FlaggedFaceSchema = z.object({
  assetFaceId: z.string(),
  suspectedOwnerId: z.string(),
  ...FacePhotoContextShape,
});
```

And at line 306, replace the cluster-faces element:

```ts
    faces: z.array(z.object({ assetFaceId: z.string(), ...FacePhotoContextShape })),
```

- [ ] **Step 4: Run the DTO tests to verify they pass**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/dtos/face-repair.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing repository tests**

In `server/test/medium/specs/repositories/face-repair.repository.spec.ts`, inside the `getClusterFacePage` describe (or a new one if none exists):

```ts
it('T5.1: returns the photo context alongside each face id', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { person } = await ctx.newPerson({ ownerId: user.id });
  const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: person.id,
    sourceType: SourceType.MachineLearning,
    boundingBoxX1: 10,
    boundingBoxY1: 20,
    boundingBoxX2: 30,
    boundingBoxY2: 40,
    imageWidth: 400,
    imageHeight: 300,
  });
  // getClusterFacePage INNER JOINs face_search, so a face without an embedding row never appears. There is
  // no ctx.newFaceSearch helper — this direct insert with the file's existing EMBEDDING const (defined at
  // face-repair.repository.spec.ts:30) is the idiom every other test in this file uses.
  await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: EMBEDDING }).execute();

  const page = await sut.getClusterFacePage(person.id, { excludeFaceIds: [], limit: 10, offset: 0 });

  expect(page.faces).toEqual([
    expect.objectContaining({
      assetFaceId: assetFace.id,
      boundingBoxX1: 10,
      boundingBoxY1: 20,
      boundingBoxX2: 30,
      boundingBoxY2: 40,
      imageWidth: 400,
      imageHeight: 300,
    }),
  ]);
  expect(page.faces[0].localDateTime).toBeInstanceOf(Date);
});

it('T5.3 (pin): a face on a trashed asset is still absent from the page', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { person } = await ctx.newPerson({ ownerId: user.id });
  const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: person.id,
    sourceType: SourceType.MachineLearning,
  });
  // getClusterFacePage INNER JOINs face_search, so a face without an embedding row never appears. There is
  // no ctx.newFaceSearch helper — this direct insert with the file's existing EMBEDDING const (defined at
  // face-repair.repository.spec.ts:30) is the idiom every other test in this file uses.
  await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: EMBEDDING }).execute();
  await ctx.database.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', asset.id).execute();

  const page = await sut.getClusterFacePage(person.id, { excludeFaceIds: [], limit: 10, offset: 0 });

  expect(page.faces).toEqual([]);
});
```

Write the mirror of T5.1 as **T5.2** against `getScanFlaggedFaces` in `face-repair-scan-flagged-face.repository.spec.ts`, following whatever seeding helper that file already uses to create a scan row and a flagged-face row — read the file's existing `describe` blocks and reuse their setup verbatim rather than inventing new fixtures.

- [ ] **Step 6: Run to verify they fail**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-repair.repository.spec.ts test/medium/specs/repositories/face-repair-scan-flagged-face.repository.spec.ts
```

Expected: T5.1 and T5.2 FAIL on the missing fields. T5.3 passes immediately — it is a pin.

- [ ] **Step 7: Add the columns to both queries**

In `face-repair.repository.ts`, change `getClusterFacePage`'s signature and its `rows` select. Replace the return type at `:220`:

```ts
  ): Promise<{ faces: FaceWithPhotoContext[]; total: number; hasMore: boolean }> {
```

Replace the `rows` query at `:236-241`:

```ts
const rows = await base
  .select([
    'asset_face.id as assetFaceId',
    // #1061: the console needs the capture date and the box to render a source-photo preview. `asset` is
    // already joined above, so these are free columns rather than a second query.
    'asset.localDateTime',
    'asset_face.boundingBoxX1',
    'asset_face.boundingBoxY1',
    'asset_face.boundingBoxX2',
    'asset_face.boundingBoxY2',
    'asset_face.imageWidth',
    'asset_face.imageHeight',
  ])
  .orderBy('asset_face.id')
  .limit(options.limit)
  .offset(options.offset)
  .execute();
```

And the mapping at `:244`:

```ts
      faces: rows,
```

Add the shared type to `server/src/utils/face-review.ts` (which both repositories already import from):

```ts
// #1061: the face-review console renders a source-photo preview with the detection boxed, so both list
// reads carry the capture date and the box. Flat field names deliberately mirror web's `FaceBox` type.
export interface FaceWithPhotoContext {
  assetFaceId: string;
  localDateTime: Date;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
  imageWidth: number;
  imageHeight: number;
}
```

Apply the same select block to `getScanFlaggedFaces` in `face-repair-scan.repository.ts:304`, keeping its existing two columns:

```ts
        .select([
          'ff.assetFaceId as assetFaceId',
          'ff.suspectedOwnerId as suspectedOwnerId',
          'asset.localDateTime',
          'asset_face.boundingBoxX1',
          'asset_face.boundingBoxY1',
          'asset_face.boundingBoxX2',
          'asset_face.boundingBoxY2',
          'asset_face.imageWidth',
          'asset_face.imageHeight',
        ])
```

and widen its return type to `Promise<(FaceWithPhotoContext & { suspectedOwnerId: string })[]>`.

**Do not touch `getScanFlaggedFacesForPersons` (`:328`).** It feeds the dashboard and the apply path, neither of which renders a photo.

- [ ] **Step 8: Write the failing service tests for the passthrough**

Add to `face-repair.service.spec.ts`:

```ts
describe('getPersonFlaggedFaces photo context', () => {
  const stored = (assetFaceId: string) => ({
    assetFaceId,
    suspectedOwnerId: 'owner-1',
    localDateTime: new Date('2019-07-04T10:30:00.000Z'),
    boundingBoxX1: 10,
    boundingBoxY1: 20,
    boundingBoxX2: 30,
    boundingBoxY2: 40,
    imageWidth: 400,
    imageHeight: 300,
  });

  it('T2.10: carries the context of a surviving face through the verdict filter', async () => {
    mocks.faceRepairScan.getLatestScan.mockResolvedValue({ id: 'scan-1' } as any);
    mocks.faceRepairScan.getScanFlaggedFaces.mockResolvedValue([stored('face-1')]);
    vi.spyOn(sut as any, 'buildVerdictMaps').mockResolvedValue({
      manualLinkedFaceIds: new Set(),
      negativeFaceTargets: new Map(),
      ownerTokens: new Map(),
      mutedPersons: new Set(),
    });

    const result = await sut.getPersonFlaggedFaces('person-1');

    expect(result.flaggedFaces).toEqual([expect.objectContaining({ assetFaceId: 'face-1', imageWidth: 400 })]);
  });

  it('T2.11: a face the verdict layer removes contributes no context', async () => {
    mocks.faceRepairScan.getLatestScan.mockResolvedValue({ id: 'scan-1' } as any);
    mocks.faceRepairScan.getScanFlaggedFaces.mockResolvedValue([stored('face-1')]);
    // Settled by a manual link — the same mechanism the dashboard uses to drop a face.
    vi.spyOn(sut as any, 'buildVerdictMaps').mockResolvedValue({
      manualLinkedFaceIds: new Set(['face-1']),
      negativeFaceTargets: new Map(),
      ownerTokens: new Map(),
      mutedPersons: new Set(),
    });

    const result = await sut.getPersonFlaggedFaces('person-1');

    expect(result.flaggedFaces).toEqual([]);
  });
});
```

If `buildVerdictMaps`'s real `VerdictMaps` shape differs from the four keys above, read it in `face-repair.service.ts` and copy the actual shape — do not guess.

- [ ] **Step 9: Run to verify T2.10 fails**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.service.spec.ts -t 'photo context'
```

Expected: T2.10 FAILS (no `imageWidth` on the result). T2.11 passes already — it is a pin on existing filtering.

- [ ] **Step 10: Wire the passthrough**

In `getPersonFlaggedFaces` (`face-repair.service.ts:696`), the shared `FlaggedFace` type must **not** grow — it
is also used by `withLiveFlaggedCounts`, which feeds the dashboard. Carry the context in a side map instead.

Replace **exactly these five existing lines** (`:717-724`) — note the block below re-includes the
`applyVerdictFilters` call, so do not leave the original in place as well:

```ts
applyVerdictFilters(byPerson, verdictMaps);
const flaggedFaces = (byPerson.get(personId) ?? []).map((f) => ({
  assetFaceId: f.assetFaceId,
  suspectedOwnerId: f.suspectedOwnerId,
}));
return { personId, flaggedFaces };
```

with:

```ts
// FlaggedFace is shared with withLiveFlaggedCounts (the dashboard recompute), so the photo context does
// not go on it. Keep it in a side map keyed by face id and re-join after filtering — a face the verdict
// layer drops then contributes nothing, rather than leaking a context row for a face the admin will
// never see.
const contextByFace = new Map(
  stored.map((s) => [
    s.assetFaceId,
    {
      localDateTime: s.localDateTime,
      boundingBoxX1: s.boundingBoxX1,
      boundingBoxY1: s.boundingBoxY1,
      boundingBoxX2: s.boundingBoxX2,
      boundingBoxY2: s.boundingBoxY2,
      imageWidth: s.imageWidth,
      imageHeight: s.imageHeight,
    },
  ]),
);

applyVerdictFilters(byPerson, verdictMaps);

// flatMap, not map: a survivor with no context row is dropped rather than emitted half-populated.
const flaggedFaces = (byPerson.get(personId) ?? []).flatMap((f) => {
  const context = contextByFace.get(f.assetFaceId);
  return context ? [{ assetFaceId: f.assetFaceId, suspectedOwnerId: f.suspectedOwnerId, ...context }] : [];
});
return { personId, flaggedFaces };
```

Widen the method's declared return type at `:697-698` to include the context fields — reuse `FaceWithPhotoContext & { suspectedOwnerId: string }`.

- [ ] **Step 11: Run every server suite touched so far**

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.service.spec.ts src/dtos/face-repair.dto.spec.ts src/controllers/face-repair-admin.controller.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/
```

Expected: PASS. The medium suite is resource-flaky on a Mac at default concurrency; if unrelated files fail, re-run with `--maxWorkers=2` before investigating.

- [ ] **Step 12: Lint, format, and commit**

```bash
cd server && pnpm lint && pnpm exec prettier --check src test
cd .. && git add server/src server/test
git commit -m "$(cat <<'EOF'
feat(server): carry capture date and face box on the cleanup list DTOs

Both list queries already inner-join asset, so the console's grids get the
context they need to judge a face without a second endpoint. The shared
FlaggedFace type stays unchanged — the dashboard recompute uses it too, so
the context rides a side map that is re-joined after verdict filtering.

Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK
EOF
)"
```

---

## Task 4: Regenerate the API clients

Implements spec §4.2 (regeneration). No new tests — this task's deliverable is generated code the web tasks compile against.

**Files:**

- Modify: `open-api/` and `packages/sdk/` output, `mobile/openapi/` output, `server/src/queries/`

**Interfaces:**

- Consumes: Tasks 2 and 3.
- Produces: `@immich/sdk` types `FaceRepairPersonFacesDto` and `FaceRepairClusterFacesResponseDto` with the seven context fields per face. Tasks 6–9 consume these.

- [ ] **Step 1: Build the server**

```bash
cd server && rm -rf dist && pnpm build   # dist must be fresh before `mise sql`
```

- [ ] **Step 2: Regenerate**

```bash
# From the repo ROOT — both are root-level mise tasks (`mise open-api` does not exist in server/).
mise open-api && mise sql
```

`mise sql` needs a migrated throwaway Postgres. If it emits empty or error-laden query files, start one and point `DB_URL` at it before re-running.

- [ ] **Step 3: Verify the generated types carry the new fields**

```bash
cd .. && grep -n "localDateTime" packages/sdk/src/fetch-client.ts | head
```

Expected: `localDateTime` appears within the `FaceRepairPersonFacesDto` and `FaceRepairClusterFacesResponseDto` shapes. If the SDK path differs, find it with `git status` — the regen output is whatever changed.

- [ ] **Step 4: Commit the regeneration on its own**

Keeping generated output in a separate commit makes the next review diff readable.

```bash
git add -A open-api packages mobile/openapi server/src/queries
git commit -m "$(cat <<'EOF'
chore: regenerate API clients for the face-repair preview route

Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK
EOF
)"
```

---

## Task 5: API end-to-end — the cross-owner promise

Implements spec §7 T10.1–T10.5, edge cases E1, E7, E20. This is the only test that proves the feature does what issue #1061 asked for.

**Files:**

- Create: `e2e/src/specs/server/api/face-repair-preview.e2e-spec.ts`

**Interfaces:**

- Consumes: the route from Task 2.
- Produces: nothing consumed by later tasks. May run in parallel with Tasks 6–9.

- [ ] **Step 1: Rebuild the e2e stack**

`mise e2e` runs `docker compose up` **without** `--build` and will happily serve 404s for a new route from a stale image.

```bash
cd e2e && COMPOSE_BAKE=true docker compose -f ./docker-compose.yml up --build -d
```

- [ ] **Step 2: Write the spec**

```ts
/**
 * #1061 — the Face Cleanup console must be able to show the SOURCE PHOTO behind a face crop, including for
 * assets the admin does not own. That cross-owner read is the whole point of the route and the one thing no
 * unit test exercises end to end: the owner-scoped asset routes enforce Permission.AssetView with no admin
 * bypass, so a naive implementation via /assets/:id/thumbnail would pass every unit test and 403 in
 * production on exactly the clusters this console exists to repair.
 */

import { LoginResponseDto } from '@immich/sdk';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('GET /admin/face-repair/faces/:assetFaceId/preview', () => {
  let admin: LoginResponseDto;
  let member: LoginResponseDto;
  let memberFaceId: string;
  let trashedFaceId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    member = await utils.userSetup(admin.accessToken, {
      email: 'member@immich.cloud',
      name: 'Member',
      password: 'password',
    });

    const person = await utils.createPerson(member.accessToken, { name: 'Member Person' });

    // Owned by the MEMBER, not the admin — the case the admin console exists for.
    const memberAsset = await utils.createAsset(member.accessToken);
    memberFaceId = await utils.createFace({ assetId: memberAsset.id, personId: person.id });

    const trashedAsset = await utils.createAsset(member.accessToken);
    trashedFaceId = await utils.createFace({ assetId: trashedAsset.id, personId: person.id });

    // Previews are generated by a job; without this the route 404s on a missing source file rather than on
    // the thing under test. waitForQueueFinish is ADMIN-ONLY, so it must use the admin token even though the
    // assets belong to the member.
    await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');

    await utils.deleteAssets(member.accessToken, [trashedAsset.id]);
  });

  it('T10.1: an admin reads the source photo for a face on another user’s asset', async () => {
    const { status, headers } = await request(app)
      .get(`/admin/face-repair/faces/${memberFaceId}/preview`)
      .set(asBearerAuth(admin.accessToken));

    expect(status).toBe(200);
    expect(headers['content-type']).toMatch(/^image\//);
  });

  it('T10.2: a non-admin is refused the same face id', async () => {
    const { status } = await request(app)
      .get(`/admin/face-repair/faces/${memberFaceId}/preview`)
      .set(asBearerAuth(member.accessToken));

    expect(status).toBe(403);
  });

  it('T10.3: an unauthenticated request is refused', async () => {
    const { status } = await request(app).get(`/admin/face-repair/faces/${memberFaceId}/preview`);

    expect(status).toBe(401);
  });

  it('T10.4: a face whose asset is trashed 404s, even for the admin', async () => {
    const { status } = await request(app)
      .get(`/admin/face-repair/faces/${trashedFaceId}/preview`)
      .set(asBearerAuth(admin.accessToken));

    expect(status).toBe(404);
  });

  it('T10.5 (pin): the CROP route still serves that same trashed face', async () => {
    // Pairs with T1.5 from the other side of the stack: the deletedAt filter belongs to the preview route
    // only, and must not have leaked into the three shipped crop surfaces.
    const { status } = await request(app)
      .get(`/admin/face-repair/faces/${trashedFaceId}/thumbnail`)
      .set(asBearerAuth(admin.accessToken));

    expect(status).toBe(200);
  });
});
```

Before running, open `e2e/src/utils.ts` and confirm the exact names and signatures of `adminSetup`, `userSetup`, `createPerson`, `createAsset`, `createFace`, `waitForQueueFinish` and `deleteAssets`. Adapt the calls to what is actually there — do not assume.

- [ ] **Step 3: Run the spec**

```bash
cd e2e && pnpm test src/specs/server/api/face-repair-preview.e2e-spec.ts
```

Expected: PASS. If T10.1 returns 404, the stack is serving a stale image — rebuild (Step 1). If it returns 200 with a zero-length body, the thumbnail job had not finished; `waitForQueueFinish` counts a paused queue as empty, so add an explicit poll on the asset's thumbnail availability instead.

- [ ] **Step 4: Prove T10.2 can fail**

Temporarily change `@Authenticated({ admin: true })` to `@Authenticated()` on the preview route, re-run, and confirm T10.2 goes RED. Restore it.

- [ ] **Step 5: Commit**

```bash
cd .. && git add e2e/src/specs/server/api/face-repair-preview.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): pin the cross-owner read on the face-repair preview route

Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK
EOF
)"
```

---

## Task 6: Web helpers and the ten locale files

Implements spec §4.3 (URL helper, guard) and §4.6, tests T9.1 and the guard half of T6.3–T6.5, edge cases E8–E10.

**Files:**

- Modify: `web/src/lib/utils/people-utils.ts:110-176`
- Test: `web/src/lib/utils/people-utils.spec.ts`
- Modify: `i18n/en.json` + the nine maintained locales

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `getAdminFacePreviewUrl(assetFaceId: string, updatedAt?: string): string`
  - `isUsableFaceBox(face: FaceBox): boolean`
  - `clampFaceBoxToImage(face: FaceBox): FaceBox`
  - i18n keys `admin.face_cleanup_view_photo`, `admin.face_cleanup_photo_modal_title`, `admin.face_cleanup_photo_modal_taken`

  Tasks 7–9 consume all of these.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/utils/people-utils.spec.ts`, and add `clampFaceBoxToImage`, `getAdminFacePreviewUrl`, `isUsableFaceBox` plus `type FaceBox` to its existing import block:

```ts
describe('getAdminFacePreviewUrl', () => {
  it('T9.1: points at the admin-gated, face-keyed preview route', () => {
    // `/api` prefix included: createUrl returns `getBaseUrl() + path`, and getBaseUrl defaults to `/api`.
    // The sibling getAdminFaceThumbnailUrl is mocked with the same prefix in three existing page specs.
    expect(getAdminFacePreviewUrl('face-1')).toBe('/api/admin/face-repair/faces/face-1/preview');
  });
});

describe('isUsableFaceBox', () => {
  const box = (overrides: Partial<FaceBox> = {}): FaceBox => ({
    imageWidth: 400,
    imageHeight: 300,
    boundingBoxX1: 100,
    boundingBoxY1: 75,
    boundingBoxX2: 200,
    boundingBoxY2: 150,
    ...overrides,
  });

  it('accepts an ordinary box (positive control)', () => {
    expect(isUsableFaceBox(box())).toBe(true);
  });

  it('rejects zero image dimensions — 0/0 is NaN, not a small number', () => {
    expect(isUsableFaceBox(box({ imageWidth: 0 }))).toBe(false);
    expect(isUsableFaceBox(box({ imageHeight: 0 }))).toBe(false);
  });

  it('rejects a degenerate box', () => {
    expect(isUsableFaceBox(box({ boundingBoxX2: 100 }))).toBe(false);
    expect(isUsableFaceBox(box({ boundingBoxY2: 50 }))).toBe(false);
  });

  it('accepts a full-frame box, which getFaceCropTransform separately rejects', () => {
    // The two predicates deliberately differ at the upper bound: a box covering the whole image renders fine
    // as an overlay, but has no meaningful CSS crop transform.
    expect(isUsableFaceBox(box({ boundingBoxX1: 0, boundingBoxY1: 0, boundingBoxX2: 400, boundingBoxY2: 300 }))).toBe(
      true,
    );
  });
});

describe('clampFaceBoxToImage', () => {
  it('pulls an out-of-range box back inside the image', () => {
    const clamped = clampFaceBoxToImage({
      imageWidth: 400,
      imageHeight: 300,
      boundingBoxX1: -50,
      boundingBoxY1: -10,
      boundingBoxX2: 900,
      boundingBoxY2: 700,
    });

    expect(clamped).toMatchObject({
      boundingBoxX1: 0,
      boundingBoxY1: 0,
      boundingBoxX2: 400,
      boundingBoxY2: 300,
    });
  });

  it('leaves an in-range box untouched (positive control)', () => {
    const original = {
      imageWidth: 400,
      imageHeight: 300,
      boundingBoxX1: 100,
      boundingBoxY1: 75,
      boundingBoxX2: 200,
      boundingBoxY2: 150,
    };

    expect(clampFaceBoxToImage(original)).toEqual(original);
  });
});

describe('getFaceCropTransform (regression)', () => {
  it('still returns the cover fallback for a full-frame box after the guard was extracted', () => {
    const transform = getFaceCropTransform({
      imageWidth: 400,
      imageHeight: 300,
      boundingBoxX1: 0,
      boundingBoxY1: 0,
      boundingBoxX2: 400,
      boundingBoxY2: 300,
    });

    expect(transform).toEqual({ backgroundSize: 'cover', backgroundPosition: 'center' });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd web && pnpm exec vitest --run src/lib/utils/people-utils.spec.ts
```

Expected: FAIL on the three missing exports. The `getFaceCropTransform` regression test passes already — it pins existing behaviour before the refactor in Step 3.

- [ ] **Step 3: Add the helpers**

In `people-utils.ts`, after `getAdminFaceThumbnailUrl` at `:111`:

```ts
// The SOURCE PHOTO behind that crop (#1061), for the same admin-gated, face-keyed reason: the console shows
// clusters the admin does not own, and the owner-scoped asset routes would 403 on them.
export const getAdminFacePreviewUrl = (assetFaceId: string, updatedAt?: string) =>
  createUrl(`/admin/face-repair/faces/${assetFaceId}/preview`, { updatedAt });
```

After the `FaceBox` type at `:135`, add the shared guard and the clamp:

```ts
/**
 * Whether a face box can be mapped onto its image at all. `getBoundingBox` divides by imageWidth/imageHeight
 * without validating, so a legacy row with 0 dimensions yields NaN and an inverted box yields a negative
 * rect — both render as garbage rather than failing loudly.
 *
 * `Number.isFinite` rather than `bw <= 0`: imageWidth/imageHeight can be 0, and 0/0 is NaN. `!(NaN > 0)` is
 * true but `NaN <= 0` is false, so the obvious rewrite the linter suggests would silently drop the NaN
 * guard. This form also catches ±Infinity explicitly.
 *
 * Deliberately has NO upper bound: a box covering the whole frame is a perfectly renderable overlay.
 * `getFaceCropTransform` adds its own `>= 1` rejection on top, because a full-frame CSS crop is degenerate.
 */
export const isUsableFaceBox = (face: FaceBox): boolean => {
  const bw = (face.boundingBoxX2 - face.boundingBoxX1) / face.imageWidth;
  const bh = (face.boundingBoxY2 - face.boundingBoxY1) / face.imageHeight;
  return Number.isFinite(bw) && Number.isFinite(bh) && bw > 0 && bh > 0;
};

/** Pulls a box back inside its image, so a bad detection cannot paint an overlay outside the photo. */
export const clampFaceBoxToImage = (face: FaceBox): FaceBox => ({
  ...face,
  boundingBoxX1: Math.max(0, Math.min(face.imageWidth, face.boundingBoxX1)),
  boundingBoxX2: Math.max(0, Math.min(face.imageWidth, face.boundingBoxX2)),
  boundingBoxY1: Math.max(0, Math.min(face.imageHeight, face.boundingBoxY1)),
  boundingBoxY2: Math.max(0, Math.min(face.imageHeight, face.boundingBoxY2)),
});
```

Then rewrite `getFaceCropTransform`'s guard at `:152` to reuse it, preserving its extra bound exactly:

```ts
if (!isUsableFaceBox(face) || bw >= 1 || bh >= 1) {
  return { backgroundSize: 'cover', backgroundPosition: 'center' };
}
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd web && pnpm exec vitest --run src/lib/utils/people-utils.spec.ts
```

Expected: PASS, including the `getFaceCropTransform` regression — the refactor must not change its behaviour.

- [ ] **Step 5: Add the three keys to all ten locales**

Insert alphabetically inside each file's `admin` object. `face_cleanup_photo_modal_taken` and `face_cleanup_photo_modal_title` sort between `face_cleanup_mode_*` and `face_cleanup_review_*`; `face_cleanup_view_photo` sorts after every `face_cleanup_s*` key.

| Locale    | `..._view_photo`             | `..._photo_modal_title` | `..._photo_modal_taken` |
| --------- | ---------------------------- | ----------------------- | ----------------------- |
| `en`      | View the original photo      | Original photo          | Taken {date}            |
| `de`      | Originalfoto ansehen         | Originalfoto            | Aufgenommen am {date}   |
| `fr`      | Voir la photo d'origine      | Photo d'origine         | Prise le {date}         |
| `it`      | Visualizza la foto originale | Foto originale          | Scattata il {date}      |
| `nl`      | Bekijk de originele foto     | Originele foto          | Genomen op {date}       |
| `pl`      | Zobacz oryginalne zdjęcie    | Oryginalne zdjęcie      | Zrobione {date}         |
| `es`      | Ver la foto original         | Foto original           | Tomada el {date}        |
| `ru`      | Посмотреть исходное фото     | Исходное фото           | Снято {date}            |
| `zh_Hans` | 查看原始照片                 | 原始照片                | 拍摄于 {date}           |
| `zh_Hant` | 檢視原始照片                 | 原始照片                | 拍攝於 {date}           |

German, Italian and Spanish address the user informally; French and Russian formally. None of these three strings addresses the user directly, so no register choice arises — but check the neighbouring `face_cleanup_*` keys in each file and match their terminology for "photo".

- [ ] **Step 6: Format the locales**

```bash
cd .. && npx prettier --write i18n/*.json
```

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/utils/people-utils.ts web/src/lib/utils/people-utils.spec.ts i18n
git commit -m "$(cat <<'EOF'
feat(web): add the face-preview URL helper and a shared face-box guard

isUsableFaceBox extracts the NaN/degenerate check getFaceCropTransform
already carried, so the upcoming overlay cannot reinvent it wrongly. The
crop keeps its own full-frame rejection; an overlay has no reason to.

Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK
EOF
)"
```

---

## Task 7: The lightbox

Implements spec §4.3, tests T6.1–T6.11, edge cases E8–E10, E13, E15, E16, E21, E23.

**Files:**

- Create: `web/src/lib/components/face-cleanup/face-photo.ts`
- Create: `web/src/lib/components/face-cleanup/FacePhotoModal.svelte`
- Test: `web/src/lib/components/face-cleanup/FacePhotoModal.spec.ts`

**Interfaces:**

- Consumes: `getAdminFacePreviewUrl`, `isUsableFaceBox`, `clampFaceBoxToImage`, `getBoundingBox` (Task 6); the i18n keys (Task 6).
- Produces:
  - `web/src/lib/components/face-cleanup/face-photo.ts` exporting

    ```ts
    import type { FaceBox } from '$lib/utils/people-utils';

    /** One face as the photo modal and the tile overlay need it: the box, plus which face and when. */
    export type FacePhotoFace = FaceBox & { assetFaceId: string; localDateTime: string };
    ```

    A plain `.ts` module, NOT an `export type` inside the component: every type-from-a-module import in
    this codebase points at a `.ts` / `.svelte.ts` file, never at a `.svelte` component's instance script,
    which needs a `<script module>` block to export anything. `face-actions.ts` in this same folder is the
    precedent.

  - a component with props `{ faces: FacePhotoFace[]; index: number; onClose: () => void }`

  Tasks 8 and 9 open it via `modalManager.show(FacePhotoModal, { faces, index })`.

- [ ] **Step 1: Write the failing tests**

Create `FacePhotoModal.spec.ts`:

```ts
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import FacePhotoModal from '$lib/components/face-cleanup/FacePhotoModal.svelte';

const face = (overrides: Record<string, unknown> = {}) => ({
  assetFaceId: 'face-1',
  localDateTime: '2019-07-04T10:30:00.000Z',
  imageWidth: 400,
  imageHeight: 300,
  boundingBoxX1: 100,
  boundingBoxY1: 75,
  boundingBoxX2: 200,
  boundingBoxY2: 150,
  ...overrides,
});

// happy-dom reports naturalWidth/width as 0 for every <img>, so getContentMetrics would divide by zero.
// Stubbing them is what makes the overlay geometry observable at all in this runner.
const sizeImage = (img: HTMLImageElement) => {
  for (const [property, value] of [
    ['naturalWidth', 400],
    ['naturalHeight', 300],
    ['width', 800],
    ['height', 600],
  ] as const) {
    Object.defineProperty(img, property, { configurable: true, value });
  }
  fireEvent.load(img);
};

describe('FacePhotoModal', () => {
  it('T6.1: shows the admin preview for the face at `index`', () => {
    render(FacePhotoModal, { faces: [face(), face({ assetFaceId: 'face-2' })], index: 1, onClose: vi.fn() });

    expect(screen.getByTestId('face-photo')).toHaveAttribute('src', '/admin/face-repair/faces/face-2/preview');
  });

  it('T6.2/T6.23: draws exactly one box, positioned from the rendered image metrics', async () => {
    render(FacePhotoModal, { faces: [face()], index: 0, onClose: vi.fn() });
    sizeImage(screen.getByTestId('face-photo') as HTMLImageElement);

    const boxes = await screen.findAllByTestId('face-photo-box');
    expect(boxes).toHaveLength(1);
    // 400x300 natural inside 800x600 client => contentWidth 800, offset 0; x1 100/400 * 800 = 200.
    expect(boxes[0].style.left).toBe('200px');
    expect(boxes[0].style.width).toBe('200px');
  });

  it('T6.3: renders the photo but no box when imageWidth is 0', () => {
    render(FacePhotoModal, { faces: [face({ imageWidth: 0 })], index: 0, onClose: vi.fn() });
    sizeImage(screen.getByTestId('face-photo') as HTMLImageElement);

    expect(screen.getByTestId('face-photo')).toBeInTheDocument(); // positive control
    expect(screen.queryByTestId('face-photo-box')).not.toBeInTheDocument();
  });

  it('T6.4: renders no box for a degenerate box', () => {
    render(FacePhotoModal, { faces: [face({ boundingBoxX2: 100 })], index: 0, onClose: vi.fn() });
    sizeImage(screen.getByTestId('face-photo') as HTMLImageElement);

    expect(screen.getByTestId('face-photo')).toBeInTheDocument();
    expect(screen.queryByTestId('face-photo-box')).not.toBeInTheDocument();
  });

  it('T6.5: clamps a box that runs past the image edge', async () => {
    render(FacePhotoModal, { faces: [face({ boundingBoxX1: -100, boundingBoxX2: 900 })], index: 0, onClose: vi.fn() });
    sizeImage(screen.getByTestId('face-photo') as HTMLImageElement);

    const box = await screen.findByTestId('face-photo-box');
    expect(box.style.left).toBe('0px');
    expect(box.style.width).toBe('800px');
  });

  it('T6.6: the arrows page forward and back, and the photo follows', async () => {
    render(FacePhotoModal, { faces: [face(), face({ assetFaceId: 'face-2' })], index: 0, onClose: vi.fn() });

    await fireEvent.click(screen.getByTestId('face-photo-next'));
    expect(screen.getByTestId('face-photo')).toHaveAttribute('src', '/admin/face-repair/faces/face-2/preview');

    await fireEvent.click(screen.getByTestId('face-photo-prev'));
    expect(screen.getByTestId('face-photo')).toHaveAttribute('src', '/admin/face-repair/faces/face-1/preview');
  });

  it('T6.7: clamps at both ends rather than wrapping', () => {
    const { unmount } = render(FacePhotoModal, {
      faces: [face(), face({ assetFaceId: 'face-2' })],
      index: 0,
      onClose: vi.fn(),
    });
    expect(screen.getByTestId('face-photo-prev')).toBeDisabled();
    expect(screen.getByTestId('face-photo-next')).toBeEnabled(); // positive control
    unmount();

    render(FacePhotoModal, { faces: [face(), face({ assetFaceId: 'face-2' })], index: 1, onClose: vi.fn() });
    expect(screen.getByTestId('face-photo-next')).toBeDisabled();
  });

  it('T6.9: formats the date in UTC — a 00:30 photo keeps its own day', () => {
    render(FacePhotoModal, {
      faces: [face({ localDateTime: '2019-07-04T00:30:00.000Z' })],
      index: 0,
      onClose: vi.fn(),
    });

    expect(screen.getByTestId('face-photo-taken')).toHaveTextContent('2019');
    expect(screen.getByTestId('face-photo-taken')).not.toHaveTextContent('Jul 3');
  });

  it('T6.10: omits the caption rather than rendering "Invalid DateTime"', () => {
    render(FacePhotoModal, { faces: [face({ localDateTime: 'not-a-date' })], index: 0, onClose: vi.fn() });

    expect(screen.queryByTestId('face-photo-taken')).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid DateTime/)).not.toBeInTheDocument();
  });
});
```

T6.8 (Escape closes) is delegated to `@immich/ui`'s `Modal` and is not re-asserted here; note that in the component comment.

The suite needs the same `@immich/ui` mock the guided page spec uses (`Icon` replaced with the noop component). Copy that `vi.mock('@immich/ui', ...)` block from `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts:39-55`, and mock `svelte-i18n`'s `t` the way that file does so keys render verbatim.

- [ ] **Step 2: Run to verify they fail**

```bash
cd web && pnpm exec vitest --run src/lib/components/face-cleanup/FacePhotoModal.spec.ts
```

Expected: FAIL — the component does not exist.

- [ ] **Step 3: Write the component**

```svelte
<script lang="ts">
  import { Button, Icon, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiChevronLeft, mdiChevronRight } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { get } from 'svelte/store';
  import { locale, t } from 'svelte-i18n';
  import { dateFormats } from '$lib/constants';
  import { getContentMetrics, type ContentMetrics } from '$lib/utils/container-utils';
  import {
    clampFaceBoxToImage,
    getAdminFacePreviewUrl,
    getBoundingBox,
    isUsableFaceBox,
  } from '$lib/utils/people-utils';
  import type { FacePhotoFace } from '$lib/components/face-cleanup/face-photo';

  // #1061: a 250px face crop cannot separate two similar-looking children. This shows the SOURCE PHOTO with
  // the detection boxed, through the admin-gated preview route — never /photos/{assetId}, which enforces
  // Permission.AssetView with no admin bypass and would 403 on every cluster the admin does not own.
  //
  // Escape-to-dismiss and the focus trap come from @immich/ui's Modal; they are not re-implemented or
  // re-asserted here.
  interface Props {
    faces: FacePhotoFace[];
    index: number;
    onClose: () => void;
  }

  const { faces, index, onClose }: Props = $props();

  // Clamped, never wrapped: the modal only knows the faces LOADED in the grid it was opened from, and both
  // grids paginate — wrapping would imply a cycle over the whole cluster that this array does not represent.
  let current = $state(index);
  const face = $derived(faces[current]);
  const hasPrev = $derived(current > 0);
  const hasNext = $derived(current < faces.length - 1);

  let metrics = $state<ContentMetrics | null>(null);
  const onImageLoad = (event: Event) => {
    metrics = getContentMetrics(event.currentTarget as HTMLImageElement);
  };

  // Re-measure when the face changes: a portrait following a landscape has different content metrics, and a
  // stale measurement would paint the box in the wrong place for one frame.
  $effect(() => {
    void face.assetFaceId;
    metrics = null;
  });

  const box = $derived.by(() => {
    if (!metrics || !isUsableFaceBox(face)) {
      return null;
    }
    return getBoundingBox([{ id: face.assetFaceId, ...clampFaceBoxToImage(face) }], metrics)[0] ?? null;
  });

  // Luxon directly rather than fromISODateTimeUTC: that helper casts to `DateTime<true>`, which erases the
  // invalid case at the type level — and the invalid case is exactly what this guard is for. UTC because
  // localDateTime stores local wall-clock time as a UTC timestamp; the viewer's zone would shift a 00:30
  // photo to the previous day.
  const takenLabel = $derived.by(() => {
    const parsed = DateTime.fromISO(face.localDateTime, { zone: 'UTC', locale: get(locale) ?? undefined });
    return parsed.isValid ? parsed.toLocaleString(dateFormats.album) : null;
  });
</script>

<Modal title={$t('admin.face_cleanup_photo_modal_title')} {onClose} size="large">
  <ModalBody>
    <div class="relative flex max-h-[70vh] justify-center">
      <img
        src={getAdminFacePreviewUrl(face.assetFaceId)}
        alt=""
        class="max-h-[70vh] w-auto object-contain"
        data-testid="face-photo"
        onload={onImageLoad}
      />
      {#if box}
        <!-- Only the CLICKED face is boxed. The console holds no data for the other people in the frame, and
             one box answers the question the admin is actually asking. -->
        <div
          class="pointer-events-none absolute rounded border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
          style="top: {box.top}px; left: {box.left}px; width: {box.width}px; height: {box.height}px;"
          data-testid="face-photo-box"
        ></div>
      {/if}
    </div>

    {#if takenLabel}
      <p class="mt-3 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="face-photo-taken">
        {$t('admin.face_cleanup_photo_modal_taken', { values: { date: takenLabel } })}
      </p>
    {/if}
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full items-center justify-between gap-2">
      <Button
        shape="round"
        color="secondary"
        disabled={!hasPrev}
        onclick={() => (current -= 1)}
        data-testid="face-photo-prev"
      >
        <Icon icon={mdiChevronLeft} size="18" />
      </Button>
      <span class="text-sm text-gray-500 dark:text-gray-400">{current + 1} / {faces.length}</span>
      <Button
        shape="round"
        color="secondary"
        disabled={!hasNext}
        onclick={() => (current += 1)}
        data-testid="face-photo-next"
      >
        <Icon icon={mdiChevronRight} size="18" />
      </Button>
    </div>
  </ModalFooter>
</Modal>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'ArrowLeft' && hasPrev) {
      current -= 1;
    }
    if (event.key === 'ArrowRight' && hasNext) {
      current += 1;
    }
  }}
/>
```

If `size="large"` is not a valid `Modal` size in the installed `@immich/ui`, `pnpm check` will say so — pick the largest size it does offer.

- [ ] **Step 4: Run to verify they pass**

```bash
cd web && pnpm exec vitest --run src/lib/components/face-cleanup/FacePhotoModal.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Prove the guard is load-bearing**

Temporarily change `!isUsableFaceBox(face)` to `false`, re-run, and confirm T6.3 and T6.4 go RED. Restore.

- [ ] **Step 6: Type-check and commit**

```bash
cd web && pnpm check
cd .. && git add web/src/lib/components/face-cleanup/FacePhotoModal.svelte web/src/lib/components/face-cleanup/FacePhotoModal.spec.ts
git commit -m "$(cat <<'EOF'
feat(web): a lightbox showing the source photo behind a face crop (#1061)

Draws the detection over the photo using the existing getBoundingBox
geometry, guarded for the legacy rows whose image dimensions are zero, and
pages within the grid it was opened from without wrapping.

Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK
EOF
)"
```

---

## Task 8: Guided page — both grids

Implements spec §4.4 and §4.5, tests T7.1–T7.7, edge cases E14, E17.

**Files:**

- Create: `web/src/lib/components/face-cleanup/FaceTileOverlay.svelte`
- Create: `web/src/lib/components/face-cleanup/FaceTileOverlay.spec.ts`
- Modify: `web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts:30-34`
- Modify: `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` (`:85`, `:670-710`, `:812-859`)
- Test: `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts`

**Interfaces:**

- Consumes: `FacePhotoModal` and `FacePhotoFace` (Task 7); the helpers and keys (Task 6); the SDK types (Task 4).
- Produces: `FaceTileOverlay.svelte` with props `{ localDateTime: string; onOpen: () => void }`, rendering `data-testid="face-tile-date"` and `data-testid="face-tile-view-photo"`. Task 9 consumes it.

- [ ] **Step 1: Write the failing overlay tests**

Create `FaceTileOverlay.spec.ts`:

```ts
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import FaceTileOverlay from '$lib/components/face-cleanup/FaceTileOverlay.svelte';

describe('FaceTileOverlay', () => {
  it('renders a month-and-year pill — the cheapest signal that separates two similar children', () => {
    render(FaceTileOverlay, { localDateTime: '2019-07-04T10:30:00.000Z', onOpen: vi.fn() });

    expect(screen.getByTestId('face-tile-date')).toHaveTextContent('2019');
  });

  it('omits the pill for an unparseable date rather than rendering "Invalid DateTime"', () => {
    render(FaceTileOverlay, { localDateTime: 'not-a-date', onOpen: vi.fn() });

    expect(screen.queryByTestId('face-tile-date')).not.toBeInTheDocument();
    expect(screen.getByTestId('face-tile-view-photo')).toBeInTheDocument(); // positive control
  });

  it('calls onOpen and stops the click from reaching the tile beneath', async () => {
    const onOpen = vi.fn();
    const onTileClick = vi.fn();
    const { container } = render(FaceTileOverlay, { localDateTime: '2019-07-04T10:30:00.000Z', onOpen });
    container.addEventListener('click', onTileClick);

    await fireEvent.click(screen.getByTestId('face-tile-view-photo'));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onTileClick).not.toHaveBeenCalled();
  });

  it('labels the magnifier for screen readers', () => {
    render(FaceTileOverlay, { localDateTime: '2019-07-04T10:30:00.000Z', onOpen: vi.fn() });

    expect(screen.getByTestId('face-tile-view-photo')).toHaveAccessibleName('admin.face_cleanup_view_photo');
  });
});
```

- [ ] **Step 2: Run to verify they fail, then write the component**

```bash
cd web && pnpm exec vitest --run src/lib/components/face-cleanup/FaceTileOverlay.spec.ts
```

Then create `FaceTileOverlay.svelte`:

```svelte
<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { get } from 'svelte/store';
  import { locale, t } from 'svelte-i18n';

  // The per-tile chrome for all three cleanup grids, so the markup and the testid contract exist ONCE.
  //
  // The date is not decoration: for babies and toddlers it is usually a stronger signal than the crop, and it
  // costs nothing extra because the column rides a query that already ran.
  //
  // The magnifier is always rendered rather than hover-only, which would strand touch and keyboard users; it
  // dims instead. Its click MUST NOT reach the tile button behind it — selecting a face is a staged decision,
  // and looking at a photo is not.
  interface Props {
    localDateTime: string;
    onOpen: () => void;
  }

  const { localDateTime, onOpen }: Props = $props();

  // Luxon directly, and UTC: see FacePhotoModal for why fromISODateTimeUTC's `DateTime<true>` cast is the
  // wrong tool when invalid input is a real case. Month + year fits a ~90px tile in the 8-column grid.
  const takenLabel = $derived.by(() => {
    const parsed = DateTime.fromISO(localDateTime, { zone: 'UTC', locale: get(locale) ?? undefined });
    return parsed.isValid ? parsed.toLocaleString({ month: 'short', year: 'numeric' }) : null;
  });
</script>

{#if takenLabel}
  <span
    class="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1 py-px text-[9px] font-semibold text-white"
    data-testid="face-tile-date"
  >
    {takenLabel}
  </span>
{/if}

<button
  type="button"
  class="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-md bg-black/55 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
  aria-label={$t('admin.face_cleanup_view_photo')}
  title={$t('admin.face_cleanup_view_photo')}
  data-testid="face-tile-view-photo"
  onclick={(event) => {
    event.stopPropagation();
    onOpen();
  }}
>
  <Icon icon={mdiMagnify} size="12" color="white" />
</button>
```

Run the spec again; expected PASS.

- [ ] **Step 3: Write the failing page tests**

Add to `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts`. Extend the existing SDK mock's `getFaceRepairPersonFaces` / `getFaceRepairClusterFaces` fixtures so every face carries the seven context fields — find the existing fixture builders in that file and widen them rather than adding new ones.

```ts
// #1061. T7.3 and T7.6 are the load-bearing tests of the whole change: opening a photo must never be
// mistaken for staging a decision, on either grid.
describe('source-photo access', () => {
  it('T7.1/T7.4: every flagged tile carries a labelled magnifier and a date pill', async () => {
    await renderPageWithFlaggedFaces(); // reuse this file's existing render helper
    const tiles = screen.getAllByTestId('face-tile');

    expect(screen.getAllByTestId('face-tile-view-photo')).toHaveLength(tiles.length);
    expect(screen.getAllByTestId('face-tile-date')).toHaveLength(tiles.length);
  });

  it('T7.2: clicking the magnifier opens the photo modal at that face', async () => {
    await renderPageWithFlaggedFaces();

    await fireEvent.click(screen.getAllByTestId('face-tile-view-photo')[1]);

    expect(modalManager.show).toHaveBeenCalledWith(FacePhotoModal, expect.objectContaining({ index: 1 }));
  });

  it('T7.3: clicking the magnifier changes NO selection or state on the flagged grid', async () => {
    await renderPageWithFlaggedFaces();
    const tile = screen.getAllByTestId('face-tile')[0];
    const stateBefore = tile.dataset.state;

    await fireEvent.click(within(tile.parentElement!).getByTestId('face-tile-view-photo'));

    expect(tile.dataset.state).toBe(stateBefore);
    // `face-dock` really is the testid, and the dock really is conditional — page.spec.ts asserts its
    // presence at :327 and its absence at :1271. Querying a testid that never exists would return null
    // whether or not the feature works, which is the failure mode this whole plan keeps warning about.
    expect(screen.queryByTestId('face-dock')).not.toBeInTheDocument(); // nothing became selected
  });

  it('T7.5/T7.6: the rest grid’s magnifier opens the modal and stages nothing, with no destination chosen', async () => {
    await renderPageWithRestFaces(); // no destination picked in this fixture
    const tile = screen.getAllByTestId('rest-tile')[0];
    expect(tile.dataset.selected).toBe('false'); // positive control

    await fireEvent.click(within(tile.parentElement!).getByTestId('face-tile-view-photo'));

    expect(modalManager.show).toHaveBeenCalledWith(FacePhotoModal, expect.anything());
    expect(tile.dataset.selected).toBe('false');
  });

  it('T7.7: the magnifier is a SIBLING of the tile button, never nested inside it', async () => {
    await renderPageWithFlaggedFaces();
    const magnifier = screen.getAllByTestId('face-tile-view-photo')[0];

    // A button inside a button is invalid HTML and browsers recover from it unpredictably.
    expect(magnifier.closest('[data-testid="face-tile"]')).toBeNull();
  });
});
```

Replace `renderPageWithFlaggedFaces` / `renderPageWithRestFaces` with whatever this file already uses — read it
first. `face-dock` is verified; the render helpers are not.

- [ ] **Step 4: Run to verify they fail**

```bash
cd web && pnpm exec vitest --run 'src/routes/admin/face-cleanup/[personId]/page.spec.ts'
```

Expected: FAIL — no `face-tile-view-photo` in the DOM.

- [ ] **Step 5: Widen the web `FlaggedFace` type**

In `review.svelte.ts:30`, extend the interface. Server-side the same-named type deliberately does **not** grow; web's is not shared with any count path, which is what makes the asymmetry safe.

```ts
export interface FlaggedFace {
  assetFaceId: string;
  // Per-face suspected owner from the persisted scan snapshot — a mixed cluster can flag faces toward
  // different owners, so "move to owner" groups by each face's OWN suspectedOwnerId, not one destination.
  suspectedOwnerId: string;
  // #1061: enough of the source photo to judge the face in context. Rides through into FaceEntry, so the
  // grid and the modal read the same object. NOTE the asymmetry with the SERVER's FlaggedFace, which must
  // NOT grow these — it is shared with the dashboard's live flagged-count recompute.
  localDateTime: string;
  imageWidth: number;
  imageHeight: number;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
}
```

- [ ] **Step 6: Wire the flagged grid**

In `+page.svelte`, widen the rest-faces state at `:85`:

```ts
let restFaces = $state<FacePhotoFace[]>([]);
```

Add the imports and one handler:

```ts
import FacePhotoModal from '$lib/components/face-cleanup/FacePhotoModal.svelte';
import FaceTileOverlay from '$lib/components/face-cleanup/FaceTileOverlay.svelte';
import type { FacePhotoFace } from '$lib/components/face-cleanup/face-photo';

const openPhoto = (faces: FacePhotoFace[], index: number) => {
  void modalManager.show(FacePhotoModal, { faces, index });
};
```

Replace the flagged tile at `:670-710`. The tile button becomes `absolute inset-0` inside a positioned wrapper, exactly as the rest grid already does, so the overlay can be a sibling:

```svelte
          {#each visibleFaces as face, tileIndex (face.assetFaceId)}
            {@const selected = vm.isSelected(face.assetFaceId)}
            <div class="relative aspect-square">
              <button
                type="button"
                class={[
                  'absolute inset-0 overflow-hidden rounded-xl border-2 transition-all',
                  selected ? 'border-primary' : 'border-transparent',
                ].join(' ')}
                style={selected ? 'box-shadow: 0 0 0 3px rgba(79,70,229,0.32);' : ''}
                onclick={(event) => handleTileClick(face.assetFaceId, event)}
                data-testid="face-tile"
                data-faceid={face.assetFaceId}
                data-state={face.state}
              >
                <!-- ... every existing child of this button is unchanged: the <img>, the selected scrim,
                     the state indicator and the ribbon. Do not rewrite them. -->
              </button>
              <FaceTileOverlay
                localDateTime={face.localDateTime}
                onOpen={() => openPhoto(visibleFaces, tileIndex)}
              />
            </div>
          {/each}
```

- [ ] **Step 7: Wire the rest grid**

At `:815` the wrapper `<div class="relative aspect-square">` already exists. Add the overlay as the last child of that div, after the closing `</button>`, and add `, tileIndex` to the `{#each}`:

```svelte
            {#each restFaces as face, tileIndex (face.assetFaceId)}
              <!-- ... existing wrapper div and button, unchanged ... -->
              <FaceTileOverlay localDateTime={face.localDateTime} onOpen={() => openPhoto(restFaces, tileIndex)} />
            </div>
            {/each}
```

- [ ] **Step 8: Run to verify they pass**

```bash
cd web && pnpm exec vitest --run 'src/routes/admin/face-cleanup/[personId]/page.spec.ts' src/lib/components/face-cleanup/
```

Expected: PASS, including the page's pre-existing tests — the tile's testids, `data-state` and ribbon text were all preserved.

- [ ] **Step 9: Prove T7.3 can fail**

Temporarily delete `event.stopPropagation()` from `FaceTileOverlay.svelte`, re-run, and confirm T7.3 goes RED. Restore it. This is the acceptance criterion the whole change hangs on.

- [ ] **Step 10: Type-check and commit**

```bash
cd web && pnpm check
cd .. && git add web/src
git commit -m "$(cat <<'EOF'
feat(web): open the source photo from a guided-review face tile (#1061)

Adds a magnifier and a capture-date pill to both guided grids. The
magnifier is a sibling of the tile button rather than nested inside it,
and stops propagation, so looking at a photo is never mistaken for
staging a decision.

Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK
EOF
)"
```

---

## Task 9: Manual review page, screenshots, and the full gate

Implements spec §4.4, §4.5 and §8, tests T8.1–T8.3, edge case E14.

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/people/[personId]/manual-review.svelte.ts:16-19`
- Modify: `web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte:569-600`
- Test: `web/src/routes/admin/face-cleanup/people/[personId]/page.spec.ts`

**Interfaces:**

- Consumes: `FaceTileOverlay`, `FacePhotoModal`, `openPhoto` pattern (Tasks 7–8).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

Add to the manual page's `page.spec.ts`, widening its cluster-faces fixture to carry the seven context fields:

```ts
describe('source-photo access', () => {
  it('T8.1/T8.3: manual tiles carry a labelled magnifier and a date pill', async () => {
    await renderManualPage(); // reuse this file's existing helper
    const tiles = screen.getAllByTestId('face-tile');

    expect(screen.getAllByTestId('face-tile-view-photo')).toHaveLength(tiles.length);
    expect(screen.getAllByTestId('face-tile-date')).toHaveLength(tiles.length);
  });

  it('T8.2: clicking the magnifier leaves the tile at `keep` — nothing is staged', async () => {
    await renderManualPage();
    const tile = screen.getAllByTestId('face-tile')[0];
    expect(tile.dataset.state).toBe('keep'); // positive control: manual defaults to keep
    expect(tile.dataset.selected).toBe('false');

    await fireEvent.click(within(tile.parentElement!).getByTestId('face-tile-view-photo'));

    expect(tile.dataset.state).toBe('keep');
    expect(tile.dataset.selected).toBe('false');
    expect(modalManager.show).toHaveBeenCalledWith(FacePhotoModal, expect.objectContaining({ index: 0 }));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd web && pnpm exec vitest --run 'src/routes/admin/face-cleanup/people/[personId]/page.spec.ts'
```

Expected: FAIL.

- [ ] **Step 3: Widen `ManualFace`**

In `manual-review.svelte.ts:16`:

```ts
export interface ManualFace {
  // NOTE: no suspectedOwnerId — manual mode has no scan snapshot to suggest a destination.
  assetFaceId: string;
  // #1061: the source-photo context, arriving through appendFaces on the same cluster-faces DTO the guided
  // rest grid reads.
  localDateTime: string;
  imageWidth: number;
  imageHeight: number;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
}
```

- [ ] **Step 4: Wire the manual grid**

In the manual `+page.svelte`, add the same three imports and the `openPhoto` helper from Task 8 Step 6, then wrap the tile at `:572`. As on the guided flagged grid, the button moves from `relative aspect-square` to `absolute inset-0` inside a new positioned wrapper; every child of the button stays exactly as it is:

```svelte
          {#each vm.faces as face, tileIndex (face.assetFaceId)}
            {@const selected = vm.isSelected(face.assetFaceId)}
            {@const state = vm.stateOf(face.assetFaceId)}
            <div class="relative aspect-square">
              <button
                type="button"
                class={[
                  'absolute inset-0 overflow-hidden rounded-xl border-2 transition-all',
                  selected ? 'border-primary' : 'border-transparent',
                ].join(' ')}
                style={selected ? 'box-shadow: 0 0 0 3px rgba(79,70,229,0.32);' : ''}
                onclick={(event) => handleTileClick(face.assetFaceId, event)}
                data-testid="face-tile"
                data-faceid={face.assetFaceId}
                data-state={state}
                data-selected={selected}
              >
                <!-- ... existing children unchanged ... -->
              </button>
              <FaceTileOverlay localDateTime={face.localDateTime} onOpen={() => openPhoto(vm.faces, tileIndex)} />
            </div>
          {/each}
```

- [ ] **Step 5: Run every web suite**

```bash
cd web && pnpm exec vitest --run src/lib/components/face-cleanup/ src/lib/utils/people-utils.spec.ts 'src/routes/admin/face-cleanup/'
```

Expected: PASS.

- [ ] **Step 6: Screenshot the three grids**

Spec §4.5 leaves exact tile chrome placement to a render. Start the dev stack, seed a scan, and capture the guided flagged grid, the guided rest grid, and the manual grid. Confirm against the constraints: the magnifier does not collide with the state icon at `top-1.5 left-1.5`; the date pill does not collide with the ribbon at `inset-x-0 bottom-0`; neither obscures the centre of the crop. If the pill and the ribbon overlap on the flagged tile, narrow the ribbon from `inset-x-0` to a right-aligned pill — keep its text and testid unchanged so the page specs stay valid. Share the screenshots before finalising.

- [ ] **Step 7: Run the full gate**

```bash
cd server && pnpm lint && pnpm exec prettier --check src test
pnpm exec vitest --config test/vitest.config.mjs --run src/services/face-repair.service.spec.ts src/controllers/face-repair-admin.controller.spec.ts src/dtos/face-repair.dto.spec.ts src/utils/shared-space-album-scope.guard.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/
cd ../web && pnpm check && pnpm lint
cd .. && npx prettier --check 'i18n/*.json'
```

`check:svelte` is effectively a push-only gate — a `$t` key typed as `string` passes both tsc and local svelte-check and still fails CI. Confirm the three new keys are referenced as string literals, never through a variable.

- [ ] **Step 8: Commit**

```bash
git add web/src i18n
git commit -m "$(cat <<'EOF'
feat(web): open the source photo from a manual-review face tile (#1061)

Same magnifier and capture-date pill as the guided grids, through the
shared FaceTileOverlay. A manual tile defaults to `keep`, so the test that
matters is that opening a photo leaves it there.

Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK
EOF
)"
```

- [ ] **Step 9: Update the admin documentation**

`docs/docs/administration/face-cleanup.md` has drifted from the shipped console before. Add a sentence to the review-page section describing the magnifier, verifying vocabulary against `i18n/en.json` and the route files rather than older spec documents. Format with the docs prettier and commit.

```bash
pnpm -C docs exec prettier --write docs/administration/face-cleanup.md
git add docs/docs/administration/face-cleanup.md
git commit -m "$(cat <<'EOF'
docs: describe the source-photo control on the face cleanup review pages

Claude-Session: https://claude.ai/code/session_01HqnsLPcwJhmVAjccwzMUbK
EOF
)"
```

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: §4.1 → Tasks 1–2, §4.2 → Task 3, regeneration → Task 4, §7 T10 → Task 5, §4.3 → Tasks 6–7, §4.4/§4.5 → Tasks 8–9, §4.6 → Task 6, §8 → Task 9, §10 docs note → Task 9 Step 9. All 23 edge cases are claimed by a numbered test except E11 (video assets), which §7 documents as deliberately untested.

**Type consistency.** `FacePhotoFace` lives in `face-photo.ts` (Task 7) and is `FaceBox` + `assetFaceId` + `localDateTime`; web's `FlaggedFace` (Task 8) and `ManualFace` (Task 9) are structurally assignable to it, which is what lets `openPhoto` take all three grids' arrays. `getFaceByIdOnLiveAsset` (Task 1) is the exact name Task 2 calls and Task 3's tests mock. `isUsableFaceBox` / `clampFaceBoxToImage` (Task 6) are the exact names Task 7 imports.

**Deliberate carry-overs to the executor.** Three places name a helper this plan could not verify without reading a file it does not modify: `renderPageWithFlaggedFaces` and friends in the two page specs, the seeding helper in `face-repair-scan-flagged-face.repository.spec.ts`, and the e2e `utils.*` signatures. Each step says to read the file and reuse what is there rather than invent — inventing a fixture that shadows an existing one is how these suites grow false greens.
