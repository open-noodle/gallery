# Image Adjustments — Slice 2: Ephemeral preview render endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A non-persisting `POST /assets/:id/edits/preview` endpoint that renders an asset's image with the _proposed_ edit actions applied, so the plan card can show an accurate "after" preview without saving anything.

**Architecture:** The endpoint renders the proposed edits **over the asset's existing generated image** (thumbnail or preview file, per the requested `size`) — not the original. This is simple, cheap, inherently resolution-matched to the "before" thumbnail, and correct for the v1 tonal/flip ops. A new `MediaRepository.renderEditedImage(buffer, edits)` applies the edits via sharp and returns an encoded buffer; the service streams it back as an `ImmichStreamResponse`; nothing is written to `asset_edit`.

**Tech Stack:** NestJS, sharp, Vitest (real-sharp behavioral + mocked-repo service tests).

Spec: `docs/superpowers/specs/2026-06-06-pi-agent-image-adjustments-design.md` (Slice 2).

> **Deviation from spec (intentional, folded in here):** the spec's Slice 2 said "merge incoming with persisted edits and render the original via `mergeEdits`". This plan instead **renders the proposed edits over the asset's existing generated image** at the requested size. Rationale: (1) avoids reading the original from the storage backend (S3) on every preview/revise; (2) the source is already at thumbnail/preview size so before/after match resolution automatically; (3) correct for the v1 scope (tonal + flip — these compose cleanly over a base render). Consequence: the **shared `mergeEdits` util moves to Slice 3** (where the apply path genuinely needs to merge into the persisted edit list). Documented limitations: an asset that _already_ has a persisted adjust will show the proposed adjust composed over the baked-in one (rare; the user self-corrects via the live preview); geometry ops (crop/rotate) are not meaningfully previewed by this endpoint and the plan card (Slice 4) only shows previews for adjust/flip ops.

---

## File Structure

- **Modify** `server/src/repositories/media.repository.ts` — add public `renderEditedImage(input: Buffer, edits): Promise<Buffer>`.
- **Modify** `server/src/services/asset.service.ts` — add `previewAssetEdits(auth, id, dto, size)`.
- **Modify** `server/src/controllers/asset.controller.ts` — add `POST :id/edits/preview`.
- **Modify** `server/src/dtos/editing.dto.ts` — add a tiny query DTO for `size` (or reuse `AssetMediaSize`).
- Tests: `media.repository.spec.ts`, `asset.service.spec.ts`, `asset.controller.spec.ts`.

---

## Task 1: `MediaRepository.renderEditedImage`

**Files:**

- Modify: `server/src/repositories/media.repository.ts`
- Test: `server/src/repositories/media.repository.spec.ts`

- [ ] **Step 1: Write the failing test** (real sharp; append to the existing spec)

```ts
describe('renderEditedImage', () => {
  it('applies a tonal edit and returns an encoded image buffer', async () => {
    const src = await solid(128, 128, 128).jpeg().toBuffer();
    const out = await sut.renderEditedImage(src, [
      { action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.ModerateIncrease } },
    ]);
    expect(Buffer.isBuffer(out)).toBe(true);
    const px = await getPixelColor(out, 5, 5);
    expect(px.r).toBeGreaterThan(140);
  });

  it('applies a flip (mirror) edit', async () => {
    // left red, right green; horizontal mirror swaps them
    const img = await sharp({
      create: { width: 20, height: 10, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .composite([
        {
          input: { create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } },
          left: 10,
          top: 0,
        },
      ])
      .jpeg()
      .toBuffer();
    const out = await sut.renderEditedImage(img, [
      { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
    ]);
    const left = await getPixelColor(out, 2, 5);
    expect(left.g).toBeGreaterThan(left.r); // left is now green after horizontal mirror
  });
});
```

(`solid` is the module-scope helper added in Slice 1; `MirrorAxis` is already imported in this spec.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C server test -- --run src/repositories/media.repository.spec.ts`
Expected: FAIL — `sut.renderEditedImage is not a function`.

- [ ] **Step 3: Implement**

In `media.repository.ts`, add a public method that reuses the existing private `applyEdits` and re-encodes:

```ts
async renderEditedImage(input: Buffer, edits: AssetEditActionItem[]): Promise<Buffer> {
  const pipeline = await this.applyEdits(sharp(input, { failOn: 'none', limitInputPixels: false, unlimited: true }), edits);
  return pipeline.jpeg().toBuffer();
}
```

> `applyEdits` defaults `colorspace` to `Colorspace.Srgb` (Slice 1) — fine for an already-decoded thumbnail/preview source. No resize: the input is already at the requested size.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C server test -- --run src/repositories/media.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/media.repository.ts server/src/repositories/media.repository.spec.ts
git commit -m "feat(editing): MediaRepository.renderEditedImage (in-memory edited render)"
```

---

## Task 2: `AssetService.previewAssetEdits`

**Files:**

- Modify: `server/src/services/asset.service.ts` (near `getAssetEdits` ~line 648)
- Test: `server/src/services/asset.service.spec.ts`

**Behavior** (`previewAssetEdits(auth, id, dto, size)`):

1. `requireAccess({ auth, permission: Permission.AssetRead, ids: [id] })` (same as `getAssetEdits`).
2. `const asset = await this.assetRepository.getById(id)`; if `!asset` → `NotFoundException`; if not an image (`asset.type !== AssetType.Image`) → `BadRequestException('Preview is only available for images')`.
3. Map `size` (`AssetMediaSize.Thumbnail | Preview`, default Preview) → `AssetFileType.Thumbnail | Preview`. `const { path } = await this.assetRepository.getForThumbnail(id, fileType, false)` (unedited base). If `!path` → `NotFoundException('Asset media not available')`.
4. `const source = await this.storageRepository.readFile(path)`.
5. `const rendered = await this.mediaRepository.renderEditedImage(source, dto.edits)`.
6. `return new ImmichStreamResponse({ stream: Readable.from(rendered), contentType: 'image/jpeg', cacheControl: CacheControl.None })`.
7. **Never** calls `editAsset` / any edit-write — persists nothing.

> Verify `asset.service.ts` injects `mediaRepository` (it does — used at ~line 693) and `storageRepository` (via BaseService); if `storageRepository` isn't already referenced, it's available on BaseService. Import `ImmichStreamResponse` + `CacheControl` from `src/utils/file` and `src/enum`, `Readable` from `node:stream`, `AssetType`/`AssetFileType`/`AssetMediaSize` from `src/enum`. If `CacheControl.None` doesn't map to a no-store header, use the enum member whose `cacheControlHeaders` value is `null` (no caching).

- [ ] **Step 1: Write the failing tests**

In `asset.service.spec.ts` (follow the file's `newTestService(AssetService)` mocking style — `mocks.access`, `mocks.asset`, `mocks.media`, `mocks.storage`):

```ts
describe('previewAssetEdits', () => {
  const editsDto = {
    edits: [{ action: AssetEditAction.Adjust, parameters: { brightness: TonalLevel.ModerateIncrease } }],
  };

  it('requires AssetRead access', async () => {
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set()); // or the helper your suite uses to deny
    await expect(
      sut.previewAssetEdits(authStub.admin, 'asset-1', editsDto, AssetMediaSize.Thumbnail),
    ).rejects.toThrow();
  });

  it('rejects a non-image asset', async () => {
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
    mocks.asset.getById.mockResolvedValue({ id: 'asset-1', type: AssetType.Video } as any);
    await expect(
      sut.previewAssetEdits(authStub.admin, 'asset-1', editsDto, AssetMediaSize.Thumbnail),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renders the proposed edits over the sized base image and persists nothing', async () => {
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
    mocks.asset.getById.mockResolvedValue({ id: 'asset-1', type: AssetType.Image } as any);
    mocks.asset.getForThumbnail.mockResolvedValue({
      path: '/thumbs/a.webp',
      originalPath: '/o.jpg',
      originalFileName: 'o.jpg',
    } as any);
    mocks.storage.readFile.mockResolvedValue(Buffer.from('src'));
    mocks.media.renderEditedImage.mockResolvedValue(Buffer.from('rendered'));

    const res = await sut.previewAssetEdits(authStub.admin, 'asset-1', editsDto, AssetMediaSize.Thumbnail);

    expect(mocks.asset.getForThumbnail).toHaveBeenCalledWith('asset-1', AssetFileType.Thumbnail, false);
    expect(mocks.media.renderEditedImage).toHaveBeenCalledWith(Buffer.from('src'), editsDto.edits);
    expect(mocks.asset.upsertFiles ?? (() => {})).not.toBeNull(); // (illustrative) — assert NO edit-write happened:
    expect(res).toBeInstanceOf(ImmichStreamResponse);
    expect(res.contentType).toBe('image/jpeg');
  });

  it('defaults to the preview file type when size is preview', async () => {
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
    mocks.asset.getById.mockResolvedValue({ id: 'asset-1', type: AssetType.Image } as any);
    mocks.asset.getForThumbnail.mockResolvedValue({ path: '/p.webp' } as any);
    mocks.storage.readFile.mockResolvedValue(Buffer.from('src'));
    mocks.media.renderEditedImage.mockResolvedValue(Buffer.from('r'));
    await sut.previewAssetEdits(authStub.admin, 'asset-1', editsDto, AssetMediaSize.Preview);
    expect(mocks.asset.getForThumbnail).toHaveBeenCalledWith('asset-1', AssetFileType.Preview, false);
  });

  it('throws NotFound when no base media file exists', async () => {
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
    mocks.asset.getById.mockResolvedValue({ id: 'asset-1', type: AssetType.Image } as any);
    mocks.asset.getForThumbnail.mockResolvedValue({ path: null } as any);
    await expect(
      sut.previewAssetEdits(authStub.admin, 'asset-1', editsDto, AssetMediaSize.Thumbnail),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

> **Match the suite's real mock API.** Read the top of `asset.service.spec.ts` for how access denial/grant is expressed (`mocks.access...`), how `getById`/`getForThumbnail` are mocked, and the auth stub name (`authStub.admin` or similar). The "persists nothing" assertion = assert no edit-writing repo/service method is called (there is no `editAsset` call in the method, so simply verify the only repo calls are `getById`, `getForThumbnail`, `storage.readFile`, `media.renderEditedImage`). Adjust the illustrative line accordingly.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C server test -- --run src/services/asset.service.spec.ts`
Expected: FAIL — `sut.previewAssetEdits is not a function`.

- [ ] **Step 3: Implement** the method per the Behavior list above.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm -C server test -- --run src/services/asset.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/asset.service.ts server/src/services/asset.service.spec.ts
git commit -m "feat(editing): AssetService.previewAssetEdits (ephemeral edited render, persists nothing)"
```

---

## Task 3: `POST /assets/:id/edits/preview` controller route

**Files:**

- Modify: `server/src/controllers/asset.controller.ts` (next to the other `:id/edits` routes ~line 212-247)
- Modify: `server/src/dtos/editing.dto.ts` — a query DTO for `size`
- Test: `server/src/controllers/asset.controller.spec.ts`

- [ ] **Step 1: Write the failing test** (mirror the existing `PUT /assets/:id/edits` controller test ~line 333)

```ts
describe('POST /assets/:id/edits/preview', () => {
  it('should be an authenticated route', async () => {
    await request(ctx.getHttpServer()).post(`/assets/${factory.uuid()}/edits/preview`).send({ edits: [] });
    expect(ctx.authenticate).toHaveBeenCalled();
  });

  it('rejects an empty edits array', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post(`/assets/${factory.uuid()}/edits/preview`)
      .send({ edits: [] });
    expect(status).toBe(400);
  });
});
```

> The endpoint streams binary via `sendFile`, so a deep 200-body assertion isn't practical in the controller spec — validation (empty/malformed → 400) + auth is the controller-level contract; rendering correctness is covered in Tasks 1-2. Match how the other media/streaming routes are tested in this spec file; if they assert via `sendFile` mocking, mirror that.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C server test -- --run src/controllers/asset.controller.spec.ts`
Expected: FAIL — route 404 / `status` not 400.

- [ ] **Step 3: Implement**

Add a `size` query DTO in `editing.dto.ts`:

```ts
const AssetEditPreviewQuerySchema = z
  .object({ size: z.enum(['thumbnail', 'preview']).default('preview') })
  .meta({ id: 'AssetEditPreviewQueryDto' });
export class AssetEditPreviewQueryDto extends createZodDto(AssetEditPreviewQuerySchema) {}
```

In `asset.controller.ts` (import `Res`, `Next`, `sendFile`, `AssetMediaSize`, the query DTO; mirror the streaming controllers in `asset-media.controller.ts`):

```ts
@Post(':id/edits/preview')
@Authenticated({ permission: Permission.AssetEditGet })
@ApiOperation({ summary: 'Preview edits without saving', description: 'Render an image with the given edit actions applied, without persisting them.' })
previewAssetEdits(
  @Res() res: Response,
  @Next() next: NextFunction,
  @Auth() auth: AuthDto,
  @Param() { id }: UUIDParamDto,
  @Query() { size }: AssetEditPreviewQueryDto,
  @Body() dto: AssetEditsCreateDto,
) {
  const mediaSize = size === 'thumbnail' ? AssetMediaSize.Thumbnail : AssetMediaSize.Preview;
  return sendFile(res, next, () => this.service.previewAssetEdits(auth, id, dto, mediaSize), this.logger);
}
```

> Use `Permission.AssetEditGet` (the read-edits permission already on `GET :id/edits`) so callers who can view edits can preview them. Confirm the controller has `this.logger` (used elsewhere) and the `Response`/`NextFunction` imports from express, matching `asset-media.controller.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C server test -- --run src/controllers/asset.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/controllers/asset.controller.ts server/src/dtos/editing.dto.ts server/src/controllers/asset.controller.spec.ts
git commit -m "feat(editing): POST /assets/:id/edits/preview route"
```

---

## Task 4: OpenAPI regen (TS + Dart) + gates

- [ ] **Step 1: Type-check, lint, format**

```bash
make check-server && make lint-server
pnpm -C server exec prettier --write src/controllers/asset.controller.ts src/services/asset.service.ts src/repositories/media.repository.ts src/dtos/editing.dto.ts src/services/asset.service.spec.ts src/controllers/asset.controller.spec.ts src/repositories/media.repository.spec.ts
```

- [ ] **Step 2: Regenerate OpenAPI (TS + Dart)**

```bash
pnpm -C server build && pnpm -C server sync:open-api && make open-api
```

- [ ] **Step 3: Verify the new route + query DTO landed in both clients**

```bash
git status --porcelain open-api/ mobile/openapi/
grep -rl "edits/preview\|previewAssetEdits\|AssetEditPreviewQuery" open-api/typescript-sdk/src >/dev/null && echo "TS ok"
```

Expected: the preview route present in the TS SDK; `mobile/openapi/` regenerated (run `make open-api-dart` if Dart didn't update).

- [ ] **Step 4: Re-run the Slice-2 specs together**

```bash
pnpm -C server test -- --run src/repositories/media.repository.spec.ts src/services/asset.service.spec.ts src/controllers/asset.controller.spec.ts
```

Expected: all green.

- [ ] **Step 5: Commit generated clients**

```bash
git add open-api/ mobile/openapi/
git commit -m "chore(openapi): regenerate clients for edits/preview endpoint (TS + Dart)"
```

---

## Edge cases covered (from the spec)

- Empty `{ edits: [] }` → 400 (Task 3, existing min-1 DTO rule).
- Non-image asset → `BadRequestException` (Task 2).
- Inaccessible asset → access throws, no render (Task 2).
- `size` thumbnail vs preview → correct `AssetFileType` passed; default preview (Task 2).
- Missing/unreadable base media file → `NotFoundException`, no 500 (Task 2).
- **Persists nothing** — no edit-write method called (Task 2).
- Concurrent previews → stateless (no shared state in the method).

## Self-review checklist

- Spec Slice-2 tests mapped: controller validation → T3; access/image-only/persists-nothing/size/missing-source → T2; render behavior → T1; OpenAPI TS+Dart → T4. ✅
- Deviation from spec (render-over-base vs merge-original) documented at top; `mergeEdits` deferred to Slice 3. ✅
- No placeholders; concrete code + exact mirror references (`viewThumbnail`, `asset-media.controller.ts` streaming). ✅
- No future-slice work (no agent op, no web). ✅

```

```
