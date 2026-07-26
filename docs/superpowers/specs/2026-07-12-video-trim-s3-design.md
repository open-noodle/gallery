# Video trim on S3 storage — design

Fixes [#671](https://github.com/open-noodle/gallery/issues/671).

## Problem

Video trim does not work on S3-backed deployments. There are **three layers** to that, and #671 describes only the
middle one — and describes it partly wrongly. Layers 1 and 3 were found by running the code, not reading it.

### Layer 1 — the feature is fenced off at the API (the reason nobody has hit the inner bugs)

`AssetService.editAsset` (`server/src/services/asset.service.ts:729`) rejects any trim whose asset is not stored on
local disk:

```ts
// S3/cloud storage check
if (!StorageCore.isImmichPath(asset.originalPath)) {
  throw new BadRequestException('Video trimming is not available for cloud-stored videos');
}
```

`StorageCore.isImmichPath` returns `false` for any non-absolute path, and on S3 `originalPath` **is** a relative
key. So `PUT /assets/:id/edits` with a Trim action returns 400 before a job is ever queued. The guard shipped with
the original trim feature (`f5218d5749`, #191) and is deliberate. The web editor has **no** matching client-side
gate — it shows the trim tool, the user hits save, and the server refuses.

Consequence: the three `handleVideoTrim` defects below are **latent, not live**. No S3 user has lost a trimmed
video, because no S3 user can trim. Fixing #671 therefore means _enabling_ trim on S3, not merely repairing the job.

A second blocker sits right behind the guard, at `asset.service.ts:734`: the pre-flight audio-only check calls
`mediaRepository.probe(asset.originalPath)` — also a relative key on S3, and it runs inside the HTTP request.

### Layer 2 — `handleVideoTrim` is broken for S3 (the latent bugs, #671 proper)

`handleVideoTrim` (`server/src/services/media.service.ts:282`) is the only ffmpeg output path in the media pipeline
that never persists its outputs to the write backend, and it can hand an S3-relative key straight to ffmpeg:

1. **Trimmed video never persisted.** `outputPath` is a local nested path; it goes into the `EncodedVideo`
   `asset_file` row and on to `syncFiles` without a `persistFile` call. On S3 the video would never be uploaded and
   the DB would record a local path.
2. **Trim thumbnails never persisted.** The files returned by `generateImageThumbnails` (local paths) go straight
   into `syncFiles` with no persist loop, unlike `handleAssetEditThumbnailGeneration`.
3. ~~**S3 key fed to ffmpeg.**~~ **This defect does not exist.** `const inputPath = existingEncoded?.path || localPath`
   looks dangerous, but `existingEncoded` is **always `undefined`**: `getForGenerateThumbnailJob`
   (`asset-job.repository.ts:135`) loads only `Thumbnail`, `Preview` and `FullSize` files, never `EncodedVideo`. The
   branch is unreachable, ffmpeg always reads the original, and no ENOENT is possible. Verified by running the trim
   against a real S3 server with a transcoded video present: the trim **succeeded**. #671's third claim was
   code-read, not executed.

Lift the guard without fixing defects 1 and 2 and the trim writes the video and its thumbnails to the pod's local
disk with absolute paths in the DB, which survives until the pod is replaced and then 404s forever. Confirmed live:
after Slices 2–3 the e2e phase gets past the API and produces
`/usr/src/app/upload/encoded-video/…/{id}_edited.mp4` in the DB while the bucket holds nothing.

### Layer 3 — undo never deletes the edited encoded video (a live bug on disk too)

Same root cause as the phantom defect 3: because `asset.files` cannot contain `EncodedVideo` rows, the undo path
(`media.service.ts:227` — `syncFiles(asset.files.filter((file) => file.isEdited), [])`) deletes the edited
thumbnails but **never the edited encoded video**. `AssetRepository.getForVideo` orders `asset_file.isEdited DESC
LIMIT 1`, so after a user undoes a trim, playback keeps serving the **trimmed** video forever.

Verified live (disk-backed rows shown mid-fix):

```
--- AFTER TRIM ---                        --- AFTER UNDO ---
encoded_video  isEdited=false  <key>      encoded_video  isEdited=false  <key>
encoded_video  isEdited=true   <path>     encoded_video  isEdited=true   <path>   ← survives
preview/thumbnail/fullsize isEdited=true  preview/thumbnail isEdited=false only
```

This is **not S3-specific** — it is broken on disk installs today. It is in scope because it is the same feature and
because this PR's own e2e phase asserts that undo removes the edited objects from the bucket.

### Why CI never caught it

The unit tests for trim mock storage and assert only ffmpeg arguments, in disk mode. The MinIO-backed S3 e2e suite
(`e2e/src/storage-migration.ts`, 20 phases, gated by `.github/workflows/storage-migration-tests.yml`) lists as its
first known gap: _"No video asset upload (transcoding too slow/unreliable in e2e)"_. Every S3 output path except the
video ones is covered there. That gap is the hole #671 came through, and closing it is part of this fix.

### Already correct, and therefore out of scope

The serving side is backend-aware: `playbackVideo` selects the edited `EncodedVideo` row
(`orderBy asset_file.isEdited desc` in `AssetRepository.getForVideo`) and passes the path to `serveFromBackend` →
`StorageService.resolveBackendForKey`. Storing a relative key is sufficient; no changes to playback or download.

Realtime HLS ([#741](https://github.com/open-noodle/gallery/issues/741)) reads `asset.originalPath` only
(`transcoding.service.ts:227`) and never consults the `EncodedVideo` rows, so this work neither triggers nor
half-fixes it. #741 lands afterwards and depends on this: it needs the trimmed video to exist in the bucket, and
inherits the `StorageCore` helpers added here to locate it.

## Scope

**Enable video trim on S3.** That is a feature enablement for every S3 install, not a pure bugfix — it wants a
release-note line.

Also fixes the Layer-3 undo bug, which affects disk installs too. It is the same root cause and the same feature, and
this PR's e2e phase asserts it.

Fix forward only. No repair job and no migration: nothing to repair, because the guard means no S3 install has ever
produced a broken trim.

External-library videos (absolute paths outside the media location) stay blocked — the current guard catches them
too, and the replacement must keep doing so.

Unchanged and accepted (pre-existing): if `probe`, `extractFrame`, or thumbnail generation throws _after_ a
successful trim, the exception propagates and the local partial output is left behind. The next successful trim
overwrites it.

The local disk path of the trimmed video is **unchanged** — `StorageCore.getEditedEncodedVideoPath` produces exactly
what the current inline `getNestedPath(EncodedVideo, ownerId, \`${asset.id}\_edited.mp4\`)` produces — so disk-mode
deployments need no data migration.

## Design

### 1. Lift the guard, keep external libraries out

Replace the `isImmichPath` check with one that blocks only absolute paths **outside** the media location. Relative
paths are storage-backend keys and are now allowed:

```ts
// Block external-library videos (absolute paths outside the media location).
// S3-backed originals are relative keys, resolved through the storage backend.
if (isAbsolute(asset.originalPath) && !StorageCore.isImmichPath(asset.originalPath)) {
  throw new BadRequestException('Video trimming is not available for external library videos');
}
```

The existing unit test `asset.service.spec.ts:2301` ("should reject trim on cloud-stored videos") asserts the old
behaviour and **must be rewritten**, not preserved. It is the one place in this work where "existing tests stay
green" does not hold, and that is intentional: it encodes the bug.

### 2. Probe without downloading: `getReadableUrl`

The pre-flight audio-only check runs inside the HTTP request, so `ensureLocalFile` there would download the whole
video (fine at 20 MB, a gateway timeout at 4 GB). ffprobe can read an HTTPS URL and fetches only the header/moov
atom it needs, so give the backends a way to hand one over.

Add to `StorageBackend` (`server/src/interfaces/storage-backend.interface.ts`) — non-optional, both backends
implement it:

```ts
/**
 * A path or URL that external tools (ffmpeg/ffprobe) can read directly,
 * without downloading the object first.
 */
getReadableUrl(key: string): Promise<string>;
```

- `DiskStorageBackend`: `return this.resolvePath(key)` — the existing private `join(this.mediaLocation, key)`.
- `S3StorageBackend`: a presigned `GetObjectCommand` URL via `getSignedUrl` (already imported for redirect serve
  mode) with the existing `this.presignedUrlExpiry`.

`BaseService` gains a sibling to `ensureLocalFile`, with the same lazy-import trick to dodge the circular dependency:

```ts
protected async getProbeInput(filePath: string): Promise<string> {
  if (isAbsolute(filePath)) {
    return filePath;
  }
  const { StorageService } = await import('./storage.service.js');
  return StorageService.resolveBackendForKey(filePath).getReadableUrl(filePath);
}
```

`editAsset` then probes `await this.getProbeInput(asset.originalPath)`. Disk installs keep passing an absolute path
and never presign.

### 3. Prerequisite for testing `persistFile`

`persistFile` reads the generated file with `createReadStream` from `node:fs`. Under vitest those paths do not exist,
and because the mocked backend `put` never consumes the stream, the failed open emits an `'error'` event with no
listener — an unhandled error that crashes or flakes the run. **Nothing in `media.service.ts` can be tested in S3
mode until that changes**, which is why no such test exists today.

`asset.service`'s S3 sidecar path already avoids this by streaming through the repository layer
(`storageRepository.createPlainReadStream`, mocked as `mocks.storage.createPlainReadStream`). `persistFile` adopts
the same pattern:

- `createReadStream(localPath)` → `this.storageRepository.createPlainReadStream(localPath)`
- `unlink(localPath)` → `this.storageRepository.unlink(localPath)` (still best-effort; `StorageRepository.unlink`
  warns on ENOENT but rethrows other errors, so keep the surrounding swallow)

`handleVideoTrim`'s two raw `node:fs` unlinks — the partial output on ffmpeg failure, and the extracted frame temp —
move to `this.storageRepository.unlink(...).catch(() => {})` for the same reason: it makes failure-path cleanup
assertable. Production behaviour is identical.

### 4. `StorageCore`: one filename convention, two forms

The edited encoded video needs an S3 key. `getRelativeEncodedVideoPath(asset)` returns the **non-edited** key
(`…/{id}.mp4`), so reusing it would make a trim overwrite the asset's transcoded original in the bucket — a worse bug
than the one being fixed.

Add fork-only statics next to the existing relative-key block, deriving the local path and the S3 key from one
private filename helper, leaving upstream's `getEncodedVideoPath` untouched (keeps upstream rebases clean):

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

The two-level nesting derives from the **filename** (`filename.slice(0, 2)` / `slice(2, 4)`), so `{id}_edited.mp4`
lands in the same `{xx}/{yy}` folder as `{id}.mp4`; the keys differ only in the basename.

The key is deterministic per asset, so a re-trim overwrites the same object in place. `syncFiles` then sees an
unchanged path and correctly queues no `FileDelete`. If the key ever became non-deterministic, `syncFiles` would
delete the object just uploaded — test D3 locks that down.

### 5. `MediaService`: extract `persistImageFiles`

The persist loop (relative key from `fileType` / `format` / `isEdited`, `persistFile`, reassign `file.path`) exists
**three times** already:

- `handleAssetEditThumbnailGeneration`, over `generated.files`
- `handleGenerateThumbnails`, over `generated.files`
- `handleGenerateThumbnails`, again over `editedGenerated.files`

and is needed a fourth time in `handleVideoTrim`. Forgetting it is precisely defect 2. Extract it and route all four
call sites through it:

```ts
private async persistImageFiles(asset: ThumbnailAsset, files: UpsertFileOptions[]) {
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

All four loops are fork-only lines, so this adds no upstream-rebase risk.

### 6. `handleVideoTrim`: the three fixes and their ordering

```
trim(localPath, outputPath)                              ← outputPath = getEditedEncodedVideoPath(asset)
                                                            (input is always the original — see Slice 4a)
probe(outputPath)                        ─┐
extractFrame(outputPath, framePath)      ─┤ every local read of outputPath
generateImageThumbnails(frame)           ─┘
persistImageFiles(asset, thumbnailResult.files)          ← fix 2
editedVideoFile.path = await persistFile(
  outputPath, StorageCore.getRelativeEditedEncodedVideoPath(asset), 'video/mp4')   ← fix 1
syncFiles(oldEdited, [editedVideoFile, ...thumbnailResult.files])
thumbhash update (unchanged)
```

The load-bearing invariant: **`persistFile` unlinks the local file after upload**, so probe and frame extraction must
run before it. Persisting eagerly right after `trim` is the natural-looking mistake, and it would break frame
extraction on S3 while still satisfying every persistence assertion. Test D1 asserts the call order; carry an inline
comment too.

`storageCore.ensureFolders(outputPath)` stays: even on S3 the file is written locally first, then uploaded and
unlinked. In disk mode `persistFile` returns the absolute path unchanged, so disk behaviour is byte-for-byte what it
is today.

### 7. Error handling

Unchanged: an ffmpeg failure logs, unlinks the partial output, returns `JobStatus.Failed`. The original's temp file
is cleaned by the caller's `finally` in `handleAssetEditThumbnailGeneration`.

## Test mechanics (get these wrong and the suite lies)

- **`server/test/vitest.config.mjs` sets no `restoreMocks` / `mockReset`, and there are no `setupFiles`.** A
  `vi.spyOn(StorageService, 'getWriteBackend')` therefore leaks into every later test in the file, silently running
  the disk-mode tests against an S3 backend. Every S3 test must restore its spies in `afterEach`.
- **Disk mode in `media.service.spec.ts` works because `StorageService.diskBackend` is `undefined` there**, so
  `persistFile` takes its `!writeBackend` branch. Load-bearing — do not "fix" it by constructing a
  `DiskStorageBackend`.
- S3 mode in `media.service.spec.ts` is simulated by spying `StorageService.getWriteBackend` to return a fake backend
  (any object that is not a `DiskStorageBackend` takes the S3 branch), plus a `resolveBackendForKey` stub whose
  `downloadToTemp` backs `ensureLocalFile`.
- **The media location under unit tests is `/data`**, set at import time by
  `server/test/repositories/storage.repository.mock.ts:47`. So `/data/library/x.mp4` is an Immich path,
  `/mnt/external/x.mp4` is an external-library path, and `upload/admin/ab/cd/x.mp4` is an S3 key.
- `persistFile` is private; call it directly as `(sut as any).persistFile(...)`, following `asset.service.spec.ts`'s
  `copySidecar` tests.
- `s3-storage.backend.spec.ts` already mocks `@aws-sdk/s3-request-presigner`'s `getSignedUrl`.

## Every test must be seen failing

Two kinds of test below, and they are **not** interchangeable:

- **RED** — fails against the code as it stands when its slice begins. The expected failure is named; a red for a
  different reason means stop and find out why.
- **GUARD** — passes on arrival (it pins behaviour that is already correct and must stay correct). A guard that has
  never failed proves nothing, so each names a **mutation**: make that change, watch the guard fail, revert. A guard
  that survives its mutation is a bug in the test.

## Slices

### Slice 1 — Reproduce on real S3 (e2e phase, unwired)

Author the `video-trim-s3` phase in the MinIO harness and watch it fail against unfixed code. Commit it wired into
the `switch` in `storage-migration.ts` **only** — not into `storage-migration.sh` or the CI workflow, which run an
explicit phase list. An unwired phase is inert, so every intermediate commit keeps CI green. Slice 7 wires it up.

`e2e/src/storage-migration.ts` provides every helper needed: `api`, `uploadAsset`, `waitForProcessing`, `queryDb`,
`dockerExec`, `minioFileExists`, `diskFileExists`, `loginAdmin`.

Arrange (server in s3 write mode):

1. Force transcoding so the defect-3 precondition exists: set `ffmpeg.transcode = 'all'` via `GET`/`PUT`
   `/system-config` (mirror `setStorageTemplate`), restoring the original config in teardown.
2. Build a tiny mp4 without committing a binary fixture: `dockerExec('immich-server', …)` runs ffmpeg's `lavfi` test
   source — **at least 3 seconds** (`editAsset` rejects videos under 2 s), small frame size — base64s it
   (`base64 … | tr -d '\n'`), and the runner decodes it into a Buffer.
3. Upload, `waitForProcessing`, then assert the preconditions: `asset.duration` is set, and a non-edited
   `EncodedVideo` row exists with a relative path whose object exists in MinIO. Record its `mc stat` size/etag.

Act: `PUT /assets/{id}/edits` with `{ edits: [{ action: 'trim', parameters: { startTime, endTime } }] }`, then
`waitForProcessing`.

Assert:

- Every `isEdited` `asset_file` row (encoded video, preview, thumbnail, fullsize if generated) has a **relative** path.
- The edited video key is `encoded-video/{ownerId}/{xx}/{yy}/{id}_edited.mp4` and the object exists in MinIO.
- Each edited thumbnail key contains `_edited` and exists in MinIO.
- The **non-edited** encoded object still exists with an unchanged size/etag — the collision guard, end to end.
- `GET /assets/{id}/video/playback` returns 200 — the trimmed video is served from S3.
- `asset.duration` matches the trimmed length.
- `diskFileExists(<local encoded-video path>)` is **false** — proof the output was uploaded and the local copy
  released, not merely written to the pod's disk.
- The phase's server logs contain no `FFmpeg trim failed` and no ENOENT.

Then undo (`DELETE /assets/{id}/edits`), `waitForProcessing`, and assert the edited objects are **gone from MinIO**
and playback still returns 200 (falling back to the transcoded original). Nothing tests the undo path on S3 today.
Assert only object deletion and playback — if something else about undo looks wrong (e.g. `duration` not restored),
**file it separately; do not grow this PR**.

Teardown: delete the asset, empty the trash, restore the ffmpeg config. `migrate-to-disk` runs later in the same CI
job and has never seen `encoded-video` rows.

**Expected RED:** `PUT /assets/{id}/edits` returns **400 "Video trimming is not available for cloud-stored videos"** —
the Layer-1 guard. That is the outermost blocker and the first thing Slice 2 removes. If instead the phase fails at
the precondition (no non-edited `EncodedVideo`, or no duration), the transcode never ran — fix the arrange step,
because without that precondition the phase cannot reproduce #671's Layer-2 defects.

**Done when:** the phase fails with that 400, and `phaseMigrateToDisk` still passes when run after it.

### Slice 2 — Enable trim on S3 at the API (Layer 1)

Guard replacement (Design §1) plus `getReadableUrl` / `getProbeInput` (Design §2).

- **E1 (RED)** `asset.service.spec.ts`: S3 asset (`originalPath: 'upload/admin/ab/cd/video.mp4'`) → trim edit is
  **accepted**; `mediaRepository.probe` is called with the presigned URL the backend returns; the edit is persisted
  and the thumbnail job queued. _Expected red:_ throws `Video trimming is not available for cloud-stored videos`.
- **E2 (RED)** External-library video (`/mnt/external/video.mp4`, absolute, outside `/data`) → still rejected, with
  the new message `Video trimming is not available for external library videos`. _Expected red:_ the old
  "cloud-stored" message.
- **E3 (RED)** Audio-only on S3: the presigned-URL probe returns no video streams → 400 `Cannot trim audio-only
files`. _Expected red:_ the cloud-stored guard throws first.
- **E4 (GUARD)** Disk asset (`/data/library/video.mp4`) → `probe` is called with the **absolute path**; no presign
  happens. _Mutation:_ make `getProbeInput` always presign; E4 must fail.
- **E5 (RED)** `s3-storage.backend.spec.ts`: `getReadableUrl(key)` returns the presigned URL from `getSignedUrl` for
  a `GetObjectCommand` on the right bucket/key. _Expected red:_ method does not exist.
- **E6 (RED)** `disk-storage.backend.spec.ts`: `getReadableUrl(key)` returns `join(mediaLocation, key)`. _Expected
  red:_ method does not exist.
- **Rewrite** `asset.service.spec.ts:2301` ("should reject trim on cloud-stored videos") into E1/E2. It encodes the
  bug; deleting it is the point.

**Done when:** E1–E3, E5, E6 pass; E4 passes and is mutation-proved; the full server unit suite is green; re-running
the e2e phase now fails **inside the trim job with ENOENT** (defect 3) instead of at the 400 — the red has moved
inward, which is the proof Layer 1 is done and Layer 2 is real.

### Slice 3 — `persistFile` onto the repository layer

Design §3. Enables every S3 test that follows.

- **A1 (RED)** S3: `(sut as any).persistFile('/local/out.jpg', 'thumbs/aa/bb/x.jpg', 'image/jpeg')` streams via
  `mocks.storage.createPlainReadStream`, calls `backend.put(key, thatStream, { contentType })`, unlinks the local
  temp via `mocks.storage.unlink`, and returns the key. _Expected red:_ `createPlainReadStream` is never called (the
  code uses raw `node:fs`). Run this test alone for the red observation — the raw stream's ENOENT may also surface as
  an unhandled error.
- **A2 (GUARD)** Disk (`getWriteBackend()` → undefined): returns the local path, calls no `put`, and **does not
  unlink**. _Mutation:_ make `persistFile` unlink unconditionally; A2 must fail. Without this guard, a later
  "simplification" deletes the file disk mode just wrote.

**Done when:** A1, A2 pass; A2 is mutation-proved; `media.service.spec.ts` is green with **zero changes to existing
tests**.

### Slice 4 — The `EncodedVideo` blind spot: dead input branch, and undo

`asset.files` never contains `EncodedVideo` rows. That one fact produces both the phantom defect 3 and the live undo
bug, so both are fixed here.

**(a) Delete the dead input branch.** `existingEncoded` is always `undefined`, so `handleVideoTrim` already trims the
original — which is also the better source (higher quality than re-trimming a transcoded copy). Remove the lookup and
read `localPath` directly. No `ensureLocalFile`, no behaviour change, and the phantom S3 hazard goes with it.

**(b) Delete the edited encoded video on undo.** Add `AssetRepository.getEditedEncodedVideo(assetId)` returning the
row's `{ id, path }`, and in the video-undo branch delete that row and queue a `FileDelete` for its path.
`FileDelete` already resolves disk paths and S3 keys through `StorageService.resolveBackendForKey`.

- **B1 (RED)** Even when an asset's `files` contain a non-edited `EncodedVideo` (which production never produces, but
  a unit test can construct), `mediaRepository.trim` receives the **original**, not the encoded video's path.
  _Expected red:_ `trim` is called with the encoded video's path.
- **U1 (RED)** Video undo (`asset.edits` empty) → `assetRepository.deleteFiles` is called with the edited encoded
  video's row, and a `FileDelete` job is queued for its path. _Expected red:_ neither happens — the row survives.
- **U2 (GUARD)** Video undo with no edited encoded video → no `deleteFiles` call for one, no crash. _Mutation:_ drop
  the `if (editedVideo)` guard so it deletes unconditionally; U2 must fail.

**Done when:** B1 and U1 pass; U2 passes and is mutation-proved; the suite is green.

### Slice 5 — Defect 1: persist the trimmed video

Add the three `StorageCore` statics (Design §4); use `getEditedEncodedVideoPath` for the local output and
`persistFile` + `getRelativeEditedEncodedVideoPath` for the upload.

- **C1 (RED)** S3: `put` called with `encoded-video/{ownerId}/{xx}/{yy}/{id}_edited.mp4` and `video/mp4`; the upserted
  `EncodedVideo` row carries that key, not an absolute path. _Expected red:_ `put` is never called.
- **C3a (RED)** S3: the persisted video key differs from `StorageCore.getRelativeEncodedVideoPath(asset)` — a trim
  must never overwrite the transcoded original. _Expected red:_ `put` is never called.
- **D1 (RED)** Ordering: the video `put` happens **after** `extractFrame` (compare `invocationCallOrder`), proving the
  local file still existed when the frame was pulled. _Expected red:_ `put` is never called. _After green,
  mutation-prove it:_ move the `persistFile` call above `extractFrame`; D1 must fail. A D1 that cannot catch the
  reordering is worthless.
- **D3 (GUARD)** Re-trim idempotency: an asset that already has edited files at the same keys queues **no**
  `FileDelete` for the edited video key. _Mutation:_ make the edited filename non-deterministic (append a suffix); D3
  must fail, because `syncFiles` would then delete the object just uploaded.

**Done when:** C1, C3a, D1 pass; D3 passes and is mutation-proved; D1 is mutation-proved; the suite is green.

### Slice 6 — Defect 2: persist the trim thumbnails

Extract `persistImageFiles` (Design §5); route all **four** call sites through it.

- **C2 (RED)** S3: `put` is called for every file `generateImageThumbnails` returns (preview, thumbnail, and fullsize
  when generated) with `_edited` relative keys, and those keys reach `upsertFiles`. _Expected red:_ `put` is called
  only for the video (Slice 5), never for the thumbnails.
- **C3b (RED)** S3: no `put` targets a non-edited thumbnail key — a trim must not overwrite the asset's normal
  preview/thumbnail objects. _Expected red:_ no thumbnail `put` happens at all.
- **C4 (GUARD)** Disk: existing trim tests still pass, paths stay absolute, no `put` occurs. _Mutation:_ force
  `persistFile` into its S3 branch; C4 must fail.

**Done when:** C2, C3b pass; C4 passes and is mutation-proved; the **whole server unit suite** is green — this slice
touches `handleGenerateThumbnails` and `handleAssetEditThumbnailGeneration`, so their tests are the blast-radius guard.

### Slice 7 — Turn the e2e phase green and wire it in

1. Re-run `./storage-migration.sh --phase video-trim-s3` — it must now pass, including the undo assertions.
2. Run it **three consecutive times**. Flaky means not done: fix the root cause, never add retries.
3. Only then wire it into `.github/workflows/storage-migration-tests.yml` (the `backend=s3` group, next to
   `copy-asset-sidecar-s3`) and into the full-workflow sequence in `storage-migration.sh`.
4. Run the full `./storage-migration.sh --cleanup` suite to prove no existing phase regressed — `migrate-to-disk`
   especially.
5. Update `e2e/README-storage-migration.md`: drop "No video asset upload" from the known gaps, document the phase.

If the phase proves unstable in CI but not locally, it stays a local `make` target and the PR says so explicitly.
**No flaky test gets wired into CI.**

**Done when:** the phase is green three times running, the full harness passes, and CI on the branch is green.

## Verification

- `cd server && pnpm test -- --run src/services/media.service.spec.ts src/services/asset.service.spec.ts`, then the
  full server unit suite.
- Final gate only (not per slice): `make check-server` and `make lint-server`.
- `cd e2e && ./storage-migration.sh --phase video-trim-s3` — red in Slice 1 (400), red-but-deeper after Slice 2
  (ENOENT), green in Slice 7, ×3 for stability. This stack binds the same ports as the e2e stack (:2285, pg :5435) —
  do not run it alongside `make dev` or `make e2e`.
- Recommended before release: RC build to the personal instance (real S3 on OVH) and trim a video that already has a
  transcoded version.

## Files touched

- `server/src/services/asset.service.ts` — guard replacement, `getProbeInput` probe (Slice 2).
- `server/src/services/base.service.ts` — `getProbeInput` (Slice 2).
- `server/src/interfaces/storage-backend.interface.ts` — `getReadableUrl` (Slice 2).
- `server/src/backends/s3-storage.backend.ts`, `disk-storage.backend.ts` — `getReadableUrl` (Slice 2).
- `server/src/services/media.service.ts` — `persistFile` streaming source and the two trim unlinks (Slice 3); dead
  input branch removed + undo deletes the edited encoded video (Slice 4); `StorageCore` keys and video persistence
  (Slice 5); `persistImageFiles` extraction and its four call sites (Slice 6).
- `server/src/repositories/asset.repository.ts` — `getEditedEncodedVideo` (Slice 4).
- `server/src/cores/storage.core.ts` — three fork-only statics (Slice 5).
- Specs: `asset.service.spec.ts` (E1–E4 + rewrite), `s3-storage.backend.spec.ts` (E5),
  `disk-storage.backend.spec.ts` (E6), `media.service.spec.ts` (A1–A2, B1–B3, C1–C4, D1–D3).
- `e2e/src/storage-migration.ts` — `video-trim-s3` phase (Slice 1).
- `e2e/storage-migration.sh`, `.github/workflows/storage-migration-tests.yml`,
  `e2e/README-storage-migration.md` — wiring and docs (Slice 7).
