# Video Trim on S3 — Slice 6: Defect 2, persist the trim thumbnails

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload the thumbnails a trim generates, instead of storing local paths that S3 deployments cannot serve — and make it structurally hard to forget this again.

**Architecture:** The persist loop (derive the relative key from `fileType`/`format`/`isEdited`, `persistFile`, reassign `file.path`) is copy-pasted **three times** in `media.service.ts` and is missing from `handleVideoTrim`, which is exactly defect 2. Extract it into one `persistImageFiles(asset, files)` and route all four call sites through it, so every image output path persists by construction.

**Tech Stack:** NestJS, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-video-trim-s3-design.md`, Slice 6 (design §5).
- Slices 1–5 are complete. Slice 5 persists the trimmed video; this slice persists its thumbnails.
- The three existing loops are at: `handleAssetEditThumbnailGeneration` (over `generated.files`, ~line 240), `handleGenerateThumbnails` (over `generated.files`, ~line 394), and `handleGenerateThumbnails` again (over `editedGenerated.files`, ~line 406). All three must be replaced by the helper — leaving one behind defeats the point.
- **`server/test/vitest.config.mjs` sets no `restoreMocks`.** Restore `StorageService` spies in `afterEach`.
- Run tests from `server/`: `pnpm test -- --run src/services/media.service.spec.ts`, then the full suite.

---

### Task 1: Extract `persistImageFiles` and use it in `handleVideoTrim`

**Files:**

- Modify: `server/src/services/media.service.ts`
- Test: `server/src/services/media.service.spec.ts`

**Interfaces:**

- Consumes: `persistFile(localPath, relativeKey, contentType)` (Slice 3); `StorageCore.getRelativeImagePath(asset, { fileType, format, isEdited })` (existing).
- Produces: `private async persistImageFiles(asset: ThumbnailAsset, files: UpsertFileOptions[]): Promise<void>` — mutates each file's `path` in place to the persisted location (the key on S3, the unchanged local path on disk).

- [ ] **Step 1: Write the failing tests**

Add to the trim `describe` in `media.service.spec.ts`:

```ts
it('uploads the trim thumbnails under _edited keys and stores those keys (S3)', async () => {
  const put = vi.fn().mockResolvedValue(void 0);
  const { StorageService } = await import('src/services/storage.service.js');
  vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
  mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('data')]) as any);

  const asset = AssetFactory.from({ type: AssetType.Video })
    .exif()
    .edit({ action: AssetEditAction.Trim, parameters: { startTime: 5, endTime: 25 } as any })
    .build();
  mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
  mocks.media.probe.mockResolvedValue({
    ...videoInfoStub.noAudioStreams,
    format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
  });
  mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
  mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

  await sut.handleAssetEditThumbnailGeneration({ id: asset.id });

  const putKeys = put.mock.calls.map((call) => call[0] as string);
  const thumbnailKeys = putKeys.filter((key) => key.startsWith('thumbs/'));

  // preview + thumbnail at minimum (fullsize too, when the config generates one)
  expect(thumbnailKeys.length).toBeGreaterThanOrEqual(2);
  for (const key of thumbnailKeys) {
    expect(key).toContain('_edited');
  }

  // and the keys — not local paths — are what get written to the DB
  const upserted = mocks.asset.upsertFiles.mock.calls.flatMap(([files]) => files as any[]);
  const upsertedThumbs = upserted.filter((file) => file.type !== AssetFileType.EncodedVideo);
  expect(upsertedThumbs.length).toBeGreaterThanOrEqual(2);
  for (const file of upsertedThumbs) {
    expect(file.path.startsWith('/')).toBe(false);
    expect(file.path).toContain('_edited');
  }
});

it('never overwrites the non-edited preview or thumbnail objects (S3)', async () => {
  const put = vi.fn().mockResolvedValue(void 0);
  const { StorageService } = await import('src/services/storage.service.js');
  vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
  mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('data')]) as any);

  const asset = AssetFactory.from({ type: AssetType.Video })
    .exif()
    .edit({ action: AssetEditAction.Trim, parameters: { startTime: 5, endTime: 25 } as any })
    .build();
  mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
  mocks.media.probe.mockResolvedValue({
    ...videoInfoStub.noAudioStreams,
    format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
  });
  mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
  mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

  await sut.handleAssetEditThumbnailGeneration({ id: asset.id });

  // A trim must not clobber the asset's normal preview/thumbnail objects: every
  // image key it writes carries the _edited marker.
  const putKeys = put.mock.calls.map((call) => call[0] as string);
  for (const key of putKeys.filter((k) => k.startsWith('thumbs/'))) {
    expect(key).toContain('_edited');
  }
});
```

- [ ] **Step 2: Run to verify the reds**

```bash
cd server
pnpm test -- --run src/services/media.service.spec.ts
```

Expected:

- **C2** "uploads the trim thumbnails under \_edited keys…" → **FAILS**: no `thumbs/` key is ever passed to `put` — only the video key from Slice 5. `thumbnailKeys.length` is 0. This is #671's defect 2.
- **C3b** "never overwrites the non-edited preview or thumbnail objects" → **FAILS** for the same reason (no thumbnail `put` at all, so the loop body never runs and `putKeys.filter(...)` is empty — verify it fails on C2's assertion first, then treat C3b as meaningful only once C2 is green).

Note: C3b is only informative once thumbnails are uploaded at all. Its job is to pin that they carry `_edited` **forever after** — including if someone later changes `getRelativeImagePath`'s arguments.

- [ ] **Step 3: Implement `persistImageFiles` and route all four call sites**

In `server/src/services/media.service.ts`, add the helper next to `persistFile`:

```ts
  /**
   * Persists every generated image file and rewrites its path to the stored location.
   * Every ffmpeg/sharp output path must go through this — forgetting it is how the
   * trim thumbnails ended up unpersisted on S3 (gh#671).
   */
  private async persistImageFiles(asset: ThumbnailAsset, files: UpsertFileOptions[]): Promise<void> {
    for (const file of files) {
      const relativeKey = StorageCore.getRelativeImagePath(asset, {
        fileType: file.type,
        format: file.path.split('.').pop() as ImageFormat,
        isEdited: file.isEdited,
      });
      file.path = await this.persistFile(file.path, relativeKey, mimeTypes.lookup(file.path));
    }
  }
```

Replace **all four** call sites:

1. `handleAssetEditThumbnailGeneration` (~line 240), the loop over `generated.files`:

```ts
// Persist output files to S3 if needed
if (generated?.files) {
  await this.persistImageFiles(asset, generated.files);
}
```

2. `handleGenerateThumbnails` (~line 394), the loop over `generated.files`:

```ts
// Persist output files to S3 if needed
await this.persistImageFiles(asset, generated.files);
```

3. `handleGenerateThumbnails` (~line 406), the loop over `editedGenerated.files`:

```ts
const editedGenerated = await this.generateEditedThumbnails(asset, config, localPath);
if (editedGenerated) {
  await this.persistImageFiles(asset, editedGenerated.files);
  generated.files.push(...editedGenerated.files);
}
```

4. `handleVideoTrim`, immediately after the frame temp is unlinked and **before** the video's `persistFile` call added in Slice 5:

```ts
await this.persistImageFiles(asset, thumbnailResult.files);
```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm test -- --run src/services/media.service.spec.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Mutation-prove the C4 guard (disk mode)**

The disk-mode trim tests (`'should trim video when edits contain Trim action'`, `'should generate thumbnails from extracted frame after trim'`, etc.) are the C4 guard: they pin that disk mode still stores absolute paths and uploads nothing. Prove they have teeth by forcing `persistFile` into its S3 branch:

```ts
  private async persistFile(localPath: string, relativeKey: string, contentType?: string): Promise<string> {
    return relativeKey;   // MUTATION: pretend everything is S3
  }
```

Run `pnpm test -- --run src/services/media.service.spec.ts`.

Expected: disk-mode assertions **FAIL** (paths become relative keys). Revert and confirm green. If everything still passes under this mutation, the disk-mode tests are not actually pinning paths — say so in your report rather than papering over it.

- [ ] **Step 6: Full server unit suite**

```bash
pnpm test -- --run
```

Expected: green. This slice touches `handleGenerateThumbnails` and `handleAssetEditThumbnailGeneration`, whose existing tests are the blast-radius guard — they must pass **unmodified**.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/media.service.ts server/src/services/media.service.spec.ts
git commit -m "fix(media): persist trim thumbnails to the write backend (#671)

The thumbnails a trim generates went straight into syncFiles as local paths,
so on S3 the preview/thumbnail rows pointed at files that only existed on the
pod's disk.

The persist loop was copy-pasted three times and missing from the trim path,
which is precisely how this was missed. Extract persistImageFiles and route
all four image output paths through it, so persisting is structural rather
than remembered."
```

---

## Self-Review

**Spec coverage:** C2 (RED, thumbnails uploaded under `_edited` keys, keys stored in the DB), C3b (RED→guard, no `put` targets a non-edited thumbnail key), C4 (GUARD, disk mode unchanged, mutation-proved). All from the spec's Slice 6, plus the DRY extraction that is the point of the slice.

**Placeholders:** none.

**Type consistency:** `persistImageFiles(asset: ThumbnailAsset, files: UpsertFileOptions[])` — `ThumbnailAsset` and `UpsertFileOptions` are both declared in `media.service.ts` (lines ~54 and ~63). `mimeTypes` and `ImageFormat` are already imported there. `StorageCore.getRelativeImagePath` takes `{ fileType, format, isEdited }` (`storage.core.ts:356`).

**Not in this slice:** the e2e phase wiring and its green run (Slice 7). After this slice the trim job should be fully correct on S3, so the e2e phase is expected to go green — Slice 7 proves it.
