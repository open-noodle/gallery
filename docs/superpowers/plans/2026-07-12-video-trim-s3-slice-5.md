# Video Trim on S3 — Slice 5: Defect 1, persist the trimmed video

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload the trimmed video to the write backend and store its key, instead of storing a local path that S3 deployments cannot serve.

**Architecture:** `handleVideoTrim` writes the trimmed video to a local nested path and puts that path straight into the `EncodedVideo` `asset_file` row. It needs a `persistFile` call — but `getRelativeEncodedVideoPath(asset)` returns the **non-edited** key (`…/{id}.mp4`), so reusing it would overwrite the asset's transcoded original in the bucket. Add fork-only `StorageCore` statics that derive the local path and the S3 key for the `_edited` variant from one filename helper, then persist with those. The persist call must come **after** probe and frame extraction, because `persistFile` unlinks the local file once it is uploaded.

**Tech Stack:** NestJS, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-video-trim-s3-design.md`, Slice 5 (design §4 and §6, fix 1).
- Slices 1–4 are complete.
- Add **only** the video persistence. Do NOT touch the thumbnails (`persistImageFiles` is Slice 6).
- Leave upstream's `StorageCore.getEncodedVideoPath` untouched — the new statics go in the fork-only relative-key block near `getRelativeEncodedVideoPath` (`storage.core.ts:350-371`), which keeps upstream rebases clean.
- The local disk path must not change: `getEditedEncodedVideoPath` has to produce exactly what the current inline `getNestedPath(StorageFolder.EncodedVideo, asset.ownerId, \`${asset.id}\_edited.mp4\`)` produces, so disk deployments need no migration.
- **`server/test/vitest.config.mjs` sets no `restoreMocks`.** Restore `StorageService` spies in `afterEach`.
- Run tests from `server/`: `pnpm test -- --run src/services/media.service.spec.ts`.

---

### Task 1: `StorageCore` statics for the edited encoded video

**Files:**

- Modify: `server/src/cores/storage.core.ts` (fork-only relative-key block, after `getRelativeEncodedVideoPath` at ~line 361)
- Test: `server/src/cores/storage.core.spec.ts`

**Interfaces:**

- Produces:
  - `static getEditedEncodedVideoPath(asset: ThumbnailPathEntity): string` — absolute local path.
  - `static getRelativeEditedEncodedVideoPath(asset: ThumbnailPathEntity): string` — storage-backend key.
  - Both consumed by `handleVideoTrim` in Task 2.

- [ ] **Step 1: Write the failing tests**

`storage.core.spec.ts` already calls `StorageCore.setMediaLocation('/media')` in its setup — follow the existing tests' shape. Add:

```ts
describe('getEditedEncodedVideoPath', () => {
  it('nests the _edited video beside the non-edited one', () => {
    StorageCore.setMediaLocation('/media');
    const asset = { id: 'abcd1234-0000-0000-0000-000000000000', ownerId: 'owner-id' };

    expect(StorageCore.getEditedEncodedVideoPath(asset as any)).toBe(
      '/media/encoded-video/owner-id/ab/cd/abcd1234-0000-0000-0000-000000000000_edited.mp4',
    );
  });
});

describe('getRelativeEditedEncodedVideoPath', () => {
  it('returns the _edited key', () => {
    const asset = { id: 'abcd1234-0000-0000-0000-000000000000', ownerId: 'owner-id' };

    expect(StorageCore.getRelativeEditedEncodedVideoPath(asset as any)).toBe(
      'encoded-video/owner-id/ab/cd/abcd1234-0000-0000-0000-000000000000_edited.mp4',
    );
  });

  it('never collides with the non-edited encoded video key', () => {
    const asset = { id: 'abcd1234-0000-0000-0000-000000000000', ownerId: 'owner-id' };

    expect(StorageCore.getRelativeEditedEncodedVideoPath(asset as any)).not.toBe(
      StorageCore.getRelativeEncodedVideoPath(asset as any),
    );
  });
});
```

Note the `{xx}/{yy}` nesting comes from the **filename**, so `{id}_edited.mp4` lands in the same folder as `{id}.mp4` — the keys differ only in the basename. That is what the third test pins.

- [ ] **Step 2: Run to verify they fail**

```bash
cd server
pnpm test -- --run src/cores/storage.core.spec.ts
```

Expected: FAIL — `StorageCore.getEditedEncodedVideoPath is not a function`.

- [ ] **Step 3: Implement**

In `server/src/cores/storage.core.ts`, in the `// --- Relative key methods` block, after `getRelativeEncodedVideoPath`:

```ts
  private static getEditedEncodedVideoFilename(asset: ThumbnailPathEntity): string {
    return `${asset.id}_edited.mp4`;
  }

  static getEditedEncodedVideoPath(asset: ThumbnailPathEntity): string {
    return StorageCore.getNestedPath(
      StorageFolder.EncodedVideo,
      asset.ownerId,
      StorageCore.getEditedEncodedVideoFilename(asset),
    );
  }

  static getRelativeEditedEncodedVideoPath(asset: ThumbnailPathEntity): string {
    return StorageCore.getRelativeNestedPath(
      StorageFolder.EncodedVideo,
      asset.ownerId,
      StorageCore.getEditedEncodedVideoFilename(asset),
    );
  }
```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm test -- --run src/cores/storage.core.spec.ts
```

Expected: PASS.

---

### Task 2: Persist the trimmed video in `handleVideoTrim`

**Files:**

- Modify: `server/src/services/media.service.ts`, `handleVideoTrim`
- Test: `server/src/services/media.service.spec.ts` (alongside the other trim tests)

**Interfaces:**

- Consumes: `StorageCore.getEditedEncodedVideoPath` / `getRelativeEditedEncodedVideoPath` (Task 1); `persistFile(localPath, relativeKey, contentType)` (Slice 3).

- [ ] **Step 1: Write the failing tests**

Add to the trim `describe` in `media.service.spec.ts`. These need S3 mode, so spy `getWriteBackend` and restore in `afterEach`.

```ts
it('uploads the trimmed video under the _edited key and stores that key (S3)', async () => {
  const put = vi.fn().mockResolvedValue(void 0);
  const { StorageService } = await import('src/services/storage.service.js');
  vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
  mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('mp4')]) as any);

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

  const editedKey = StorageCore.getRelativeEditedEncodedVideoPath(asset as any);
  expect(put).toHaveBeenCalledWith(editedKey, expect.anything(), { contentType: 'video/mp4' });
  expect(mocks.asset.upsertFiles).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ type: AssetFileType.EncodedVideo, isEdited: true, path: editedKey }),
    ]),
  );
});

it('never uploads the trimmed video over the transcoded original (S3)', async () => {
  const put = vi.fn().mockResolvedValue(void 0);
  const { StorageService } = await import('src/services/storage.service.js');
  vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
  mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('mp4')]) as any);

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

  const nonEditedKey = StorageCore.getRelativeEncodedVideoPath(asset as any);
  const keys = put.mock.calls.map((call) => call[0]);
  expect(keys).not.toContain(nonEditedKey);
});

it('uploads the trimmed video only after the thumbnail frame is extracted (S3)', async () => {
  const put = vi.fn().mockResolvedValue(void 0);
  const { StorageService } = await import('src/services/storage.service.js');
  vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
  mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('mp4')]) as any);

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

  // persistFile unlinks the local file after upload, so extractFrame MUST run first.
  const extractOrder = mocks.media.extractFrame.mock.invocationCallOrder[0];
  const putOrder = put.mock.invocationCallOrder[0];
  expect(extractOrder).toBeLessThan(putOrder);
});

it('does not delete the edited video it just re-uploaded when re-trimming (S3)', async () => {
  const put = vi.fn().mockResolvedValue(void 0);
  const { StorageService } = await import('src/services/storage.service.js');
  vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
  mocks.storage.createPlainReadStream.mockReturnValue(makeStream([Buffer.from('mp4')]) as any);

  const asset = AssetFactory.from({ type: AssetType.Video })
    .exif()
    .edit({ action: AssetEditAction.Trim, parameters: { startTime: 5, endTime: 25 } as any })
    .build();
  const editedKey = StorageCore.getRelativeEditedEncodedVideoPath(asset as any);
  const withExistingEdit = {
    ...getForGenerateThumbnail(asset),
    files: [
      { type: AssetFileType.EncodedVideo, isEdited: true, path: editedKey, isProgressive: false, isTransparent: false },
    ],
  };
  mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(withExistingEdit as any);
  mocks.media.probe.mockResolvedValue({
    ...videoInfoStub.noAudioStreams,
    format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
  });
  mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
  mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

  await sut.handleAssetEditThumbnailGeneration({ id: asset.id });

  // The key is deterministic, so the re-trim overwrote the same object. syncFiles must
  // NOT then queue a delete for it — that would erase what we just uploaded.
  const deletedFiles = mocks.job.queue.mock.calls
    .filter(([job]) => job.name === JobName.FileDelete)
    .flatMap(([job]) => (job as any).data.files as string[]);
  expect(deletedFiles).not.toContain(editedKey);
});
```

Import `StorageCore` in the spec if it is not already imported (`import { StorageCore } from 'src/cores/storage.core';`).

- [ ] **Step 2: Run to verify the reds**

```bash
pnpm test -- --run src/services/media.service.spec.ts
```

Expected:

- **C1** "uploads the trimmed video under the \_edited key…" → **FAILS**: `put` was never called. This is #671's defect 1.
- **C3a** "never uploads … over the transcoded original" → **FAILS**: `put` was never called (the assertion cannot be satisfied vacuously — it is paired with C1, which proves an upload happens at all).
- **D1** "uploads … only after the thumbnail frame is extracted" → **FAILS**: `put.mock.invocationCallOrder[0]` is undefined.
- **D3** "does not delete the edited video it just re-uploaded" → **PASSES already** (GUARD).

- [ ] **Step 3: Implement**

In `handleVideoTrim`:

1. Replace the `outputPath` assignment:

```ts
const outputPath = StorageCore.getEditedEncodedVideoPath(asset);
```

2. After the thumbnail generation and frame cleanup, **before** `syncFiles`, persist the video:

```ts
// persistFile unlinks the local file after uploading, so this must come AFTER
// probe() and extractFrame() have read outputPath.
const editedVideoPath = await this.persistFile(
  outputPath,
  StorageCore.getRelativeEditedEncodedVideoPath(asset),
  'video/mp4',
);

const editedVideoFile: UpsertFileOptions = {
  assetId: asset.id,
  type: AssetFileType.EncodedVideo,
  path: editedVideoPath,
  isEdited: true,
  isProgressive: false,
  isTransparent: false,
};
```

(The existing `editedVideoFile` declaration is replaced by this one; keep the rest of the function — `newFiles`, `syncFiles`, the thumbhash update — as it is.)

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm test -- --run src/services/media.service.spec.ts
```

Expected: PASS, including the pre-existing disk-mode trim tests (in disk mode `persistFile` returns the absolute path unchanged, so they are unaffected).

- [ ] **Step 5: Mutation-prove D1 and D3**

**D1** — move the `persistFile` call to immediately after the `trim`/`probe` block, before `extractFrame`. Run the file. Expected: **D1 FAILS** (`extractOrder` is no longer less than `putOrder`). This is the entire reason D1 exists — the reordering is the natural-looking mistake, and every other test in this slice still passes under it. Revert.

**D3** — make the key non-deterministic in `storage.core.ts`:

```ts
  private static getEditedEncodedVideoFilename(asset: ThumbnailPathEntity): string {
    return `${asset.id}_edited_${Date.now()}.mp4`;   // MUTATION
  }
```

Run the file. Expected: **D3 FAILS** — the new key differs from the stored one, so `syncFiles` queues a `FileDelete` for the old key, which on S3 is the object that was just overwritten. Revert, and confirm green.

- [ ] **Step 6: Full server unit suite**

```bash
pnpm test -- --run
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add server/src/cores/storage.core.ts server/src/cores/storage.core.spec.ts server/src/services/media.service.ts server/src/services/media.service.spec.ts
git commit -m "fix(media): persist the trimmed video to the write backend (#671)

handleVideoTrim stored the trimmed video's local path in the EncodedVideo
asset_file row without ever uploading it, so on S3 the file existed only on
the pod's disk and vanished with the pod.

The edited video needs its own key: getRelativeEncodedVideoPath returns the
NON-edited key, so persisting with it would overwrite the asset's transcoded
original in the bucket. Add fork-only StorageCore statics for the _edited
variant and persist with those. The upload happens after probe/extractFrame,
because persistFile unlinks the local file once it is uploaded."
```

---

## Self-Review

**Spec coverage:** C1 (RED, upload under the `_edited` key, key stored), C3a (RED, never overwrites the transcoded original), D1 (RED + mutation-proved, upload strictly after `extractFrame`), D3 (GUARD + mutation-proved, deterministic key means no self-delete on re-trim). All four from the spec's Slice 5, plus the `StorageCore` unit tests.

**Placeholders:** none.

**Type consistency:** `UpsertFileOptions` is the local interface at `media.service.ts:54`. `ThumbnailPathEntity` is what the other `StorageCore` path helpers take. `mocks.asset.upsertFiles` matches `syncFiles`'s `assetRepository.upsertFiles(toUpsert)`. `JobName.FileDelete` matches `syncFiles`'s delete queue.

**Not in this slice:** thumbnails are still written locally and their paths still land in `syncFiles` unpersisted — that is defect 2, fixed in Slice 6, whose C2 test will fail until then. The e2e phase therefore stays red until Slice 6.
