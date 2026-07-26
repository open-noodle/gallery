# Video Trim on S3 — Slice 4: The `EncodedVideo` blind spot (dead input branch + undo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unreachable "prefer the encoded video as ffmpeg input" branch, and make undo actually delete the trimmed video.

**Architecture:** `getForGenerateThumbnailJob` (`asset-job.repository.ts:135`) loads only `Thumbnail`, `Preview` and `FullSize` files — never `EncodedVideo`. One fact, two consequences.

(a) `handleVideoTrim`'s `existingEncoded = asset.files.find(f => f.type === EncodedVideo && !f.isEdited)` is **always `undefined`**, so the trim already reads the original. The branch is dead — and the issue's "S3 key fed to ffmpeg" defect cannot happen. Delete it; trimming the original is also the better source.

(b) The undo path does `syncFiles(asset.files.filter(f => f.isEdited), [])`, and since `asset.files` cannot hold the edited **encoded video**, undo deletes the edited thumbnails but leaves the trimmed video row behind. `AssetRepository.getForVideo` orders `isEdited DESC LIMIT 1`, so playback keeps serving the trimmed video after an undo — **on disk installs too**. Fix by fetching that row explicitly and deleting it.

**Tech Stack:** NestJS, Kysely, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-video-trim-s3-design.md`, Slice 4 (and Problem → Layer 2 defect 3, Layer 3).
- Slices 1–3 are complete.
- Both findings were confirmed by running the real stack, not by reading code. Do not "restore" the encoded-video preference — it was never working.
- Do NOT add `ensureLocalFile` for the trim input. There is nothing to materialize: the input is always `localPath`, which the caller already materialized.
- Do NOT add `@GenerateSql` to the new repository method — that would require regenerating the SQL query docs (`make sql`), which needs a running dev DB. Undecorated repository methods are simply not documented; several already are.
- Do NOT touch `getForGenerateThumbnailJob`'s file-type filter. Adding `EncodedVideo` there looks tempting but `handleGenerateThumbnails` calls `syncFiles(asset.files, generated.files)` — encoded videos would then be unmatched old files and get **deleted on every thumbnail regen**. That is a data-loss landmine; the targeted query below avoids it.
- **`server/test/vitest.config.mjs` sets no `restoreMocks`.** Restore any `StorageService` spies in `afterEach`.
- Run tests from `server/`: `pnpm test -- --run src/services/media.service.spec.ts`, then the full suite.

---

### Task 1: Delete the dead encoded-video input branch

**Files:**

- Modify: `server/src/services/media.service.ts`, `handleVideoTrim` (lines ~291–294)
- Test: `server/src/services/media.service.spec.ts` (with the other trim tests)

**Interfaces:** no signature changes.

- [ ] **Step 1: Write the failing test**

Production never puts an `EncodedVideo` row in `asset.files`, but a unit test can construct one — which is exactly what pins the behaviour: even then, ffmpeg must read the original.

```ts
it('always trims the original, even if an encoded video row is present', async () => {
  const asset = AssetFactory.from({ type: AssetType.Video })
    .exif()
    .edit({ action: AssetEditAction.Trim, parameters: { startTime: 5, endTime: 25 } as any })
    .files([{ type: AssetFileType.EncodedVideo, isEdited: false, path: 'encoded-video/owner/ab/cd/video.mp4' }])
    .build();
  mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
  mocks.media.probe.mockResolvedValue({
    ...videoInfoStub.noAudioStreams,
    format: { ...videoInfoStub.noAudioStreams.format, duration: 20 },
  });
  mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
  mocks.media.getImageMetadata.mockResolvedValue({ width: 1920, height: 1080, isTransparent: false });

  await sut.handleAssetEditThumbnailGeneration({ id: asset.id });

  // The encoded video is never a valid ffmpeg input: on S3 its path is a relative key.
  // The original is both readable and higher quality.
  expect(mocks.media.trim).toHaveBeenCalledWith(asset.originalPath, expect.any(String), 5, 20);
});
```

If `AssetFactory`'s `.files([...])` entries need more fields, copy the shape used by the existing `'should handle video undo by cleaning up edited files'` test in the same file.

- [ ] **Step 2: Run it — expect RED**

```bash
cd server
pnpm test -- --run src/services/media.service.spec.ts
```

Expected: **FAILS** — `trim` was called with `'encoded-video/owner/ab/cd/video.mp4'` instead of the original's path. (Note: `getForGenerateThumbnail` is a test mapper, so it happily passes through the `EncodedVideo` row the real query would never return.)

- [ ] **Step 3: Implement**

In `handleVideoTrim`, replace the input selection:

```ts
// ffmpeg always reads the original. The asset's encoded video is not a candidate:
// getForGenerateThumbnailJob never loads EncodedVideo rows (asset-job.repository.ts),
// and on S3 its path would be a relative key ffmpeg cannot open anyway.
const inputPath = localPath;
```

Delete the `existingEncoded` lookup entirely.

- [ ] **Step 4: Run — expect GREEN**

```bash
pnpm test -- --run src/services/media.service.spec.ts
```

Expected: PASS, and every existing trim test still green.

---

### Task 2: Undo deletes the edited encoded video

**Files:**

- Modify: `server/src/repositories/asset.repository.ts` (new method near `getForVideo`, ~line 1667)
- Modify: `server/src/services/media.service.ts`, the video-undo branch (~lines 227–235)
- Test: `server/src/services/media.service.spec.ts`

**Interfaces:**

- Produces: `AssetRepository.getEditedEncodedVideo(assetId: string): Promise<{ id: string; path: string } | undefined>` — the asset's edited `EncodedVideo` `asset_file` row, if any.
- Consumes: `AssetRepository.deleteFiles(files: Pick<Selectable<AssetFileTable>, 'id'>[])` (existing, `asset.repository.ts:1548`); `JobName.FileDelete` (already used by `syncFiles`).

- [ ] **Step 1: Write the failing tests**

```ts
it('deletes the edited encoded video when the trim is undone', async () => {
  const asset = AssetFactory.from({ type: AssetType.Video })
    .exif()
    .files([{ type: AssetFileType.Preview, isEdited: true, path: '/data/preview_edited.jpeg' }])
    .build();
  // no edits => the undo path
  mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue({
    ...getForGenerateThumbnail(asset),
    edits: [],
  } as any);
  mocks.asset.getEditedEncodedVideo.mockResolvedValue({
    id: 'file-id-1',
    path: 'encoded-video/owner/ab/cd/video_edited.mp4',
  });

  await sut.handleAssetEditThumbnailGeneration({ id: asset.id });

  // Without this, getForVideo (isEdited DESC) keeps serving the TRIMMED video after an undo.
  expect(mocks.asset.deleteFiles).toHaveBeenCalledWith([expect.objectContaining({ id: 'file-id-1' })]);
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.FileDelete,
    data: { files: ['encoded-video/owner/ab/cd/video_edited.mp4'] },
  });
});

it('undoes cleanly when there is no edited encoded video', async () => {
  const asset = AssetFactory.from({ type: AssetType.Video })
    .exif()
    .files([{ type: AssetFileType.Preview, isEdited: true, path: '/data/preview_edited.jpeg' }])
    .build();
  mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue({
    ...getForGenerateThumbnail(asset),
    edits: [],
  } as any);
  mocks.asset.getEditedEncodedVideo.mockResolvedValue(undefined);

  const result = await sut.handleAssetEditThumbnailGeneration({ id: asset.id });

  expect(result).toBe(JobStatus.Success);
  expect(mocks.asset.deleteFiles).not.toHaveBeenCalledWith([expect.objectContaining({ id: expect.anything() })]);
});
```

If the existing undo test (`'should handle video undo by cleaning up edited files'`) now needs `mocks.asset.getEditedEncodedVideo` stubbed, the automock returns `undefined` by default, which is the no-op path — it should keep passing untouched. If it does not, report rather than editing it.

- [ ] **Step 2: Run — expect RED**

```bash
pnpm test -- --run src/services/media.service.spec.ts
```

Expected:

- **U1** "deletes the edited encoded video when the trim is undone" → **FAILS**: `mocks.asset.getEditedEncodedVideo` is not a function (the repository method does not exist yet). After Step 3's repository addition it will fail on the assertion instead — `deleteFiles` never called. Both are the same red.
- **U2** "undoes cleanly when there is no edited encoded video" → **PASSES** once the method exists (GUARD).

- [ ] **Step 3: Add the repository method**

In `server/src/repositories/asset.repository.ts`, next to `getForVideo`:

```ts
  async getEditedEncodedVideo(assetId: string) {
    return this.db
      .selectFrom('asset_file')
      .select(['asset_file.id', 'asset_file.path'])
      .where('asset_file.assetId', '=', assetId)
      .where('asset_file.type', '=', AssetFileType.EncodedVideo)
      .where('asset_file.isEdited', '=', true)
      .executeTakeFirst();
  }
```

No `@GenerateSql` decorator — see Global Constraints.

- [ ] **Step 4: Wire it into the undo branch**

In `server/src/services/media.service.ts`, the video-undo branch:

```ts
if (asset.type === AssetType.Video && asset.edits.length === 0) {
  // Video undo path — clean up edited files and regenerate thumbnails from original
  await this.syncFiles(
    asset.files.filter((file) => file.isEdited),
    [],
  );

  // asset.files never contains EncodedVideo rows (getForGenerateThumbnailJob only loads
  // thumbnail/preview/fullsize), so syncFiles cannot see the trimmed video. Without this,
  // getForVideo (isEdited DESC) would keep serving the trimmed video after an undo.
  const editedVideo = await this.assetRepository.getEditedEncodedVideo(asset.id);
  if (editedVideo) {
    await this.assetRepository.deleteFiles([editedVideo]);
    await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [editedVideo.path] } });
  }

  await this.jobRepository.queue({ name: JobName.AssetGenerateThumbnails, data: { id } });
  return JobStatus.Success;
}
```

`FileDelete` resolves both disk paths and S3 keys via `StorageService.resolveBackendForKey`, so this works on either backend.

- [ ] **Step 5: Run — expect GREEN**

```bash
pnpm test -- --run src/services/media.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Mutation-prove the U2 guard**

Drop the `if (editedVideo)` guard so it deletes unconditionally:

```ts
const editedVideo = await this.assetRepository.getEditedEncodedVideo(asset.id);
await this.assetRepository.deleteFiles([editedVideo!]); // MUTATION
await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [editedVideo!.path] } });
```

Run the file. Expected: **U2 FAILS** (it throws on `undefined.path`, or `deleteFiles` is called with `[undefined]`). Revert, confirm green.

- [ ] **Step 7: Full server unit suite**

```bash
pnpm test -- --run
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add server/src/services/media.service.ts server/src/services/media.service.spec.ts server/src/repositories/asset.repository.ts
git commit -m "fix(media): drop the dead trim-input branch, delete the trimmed video on undo

Two consequences of one fact: getForGenerateThumbnailJob never loads
EncodedVideo rows, so asset.files cannot contain them.

1. handleVideoTrim's 'prefer the non-edited encoded video as ffmpeg input'
   branch was unreachable — existingEncoded is always undefined. The trim
   already read the original (which is the better source anyway), so gh#671's
   'S3 key fed to ffmpeg' defect could not actually occur. Delete the branch.

2. Undo called syncFiles over asset.files, which cannot see the edited encoded
   video, so the trimmed video row survived an undo — and getForVideo orders by
   isEdited DESC, so playback kept serving the trimmed video forever. This was
   broken on disk installs too. Fetch the row explicitly and delete it.

Both confirmed against a live server before fixing."
```

---

## Self-Review

**Spec coverage:** B1 (RED, ffmpeg always gets the original), U1 (RED, undo deletes the edited encoded video row + queues its file delete), U2 (GUARD, no edited video → clean no-op, mutation-proved). Matches the spec's revised Slice 4.

**Placeholders:** none.

**Type consistency:** `getEditedEncodedVideo` returns `{ id, path } | undefined`, which is exactly what `deleteFiles(files: Pick<Selectable<AssetFileTable>, 'id'>[])` accepts and what the `FileDelete` job's `{ files: string[] }` needs. `mocks.asset` is the `AssetRepository` automock, so `getEditedEncodedVideo` appears on it automatically once the method exists.

**Not in this slice:** persisting the trimmed video (Slice 5), persisting its thumbnails (Slice 6), e2e wiring (Slice 7). The e2e phase stays red until Slice 6.
