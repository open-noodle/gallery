# Video Trim on S3 — Slice 2: Enable trim on S3 at the API (Layer 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the API rejecting video trims on S3-backed assets, and give the pre-flight audio-only probe an input it can read without downloading the whole video.

**Architecture:** Two changes. (1) The guard in `AssetService.editAsset` currently rejects any non-`isImmichPath` original, which includes every S3 relative key; it becomes a check that rejects only _absolute_ paths outside the media location (external libraries). (2) The pre-flight `probe(asset.originalPath)` runs inside the HTTP request, so instead of downloading the object we add `getReadableUrl(key)` to the `StorageBackend` interface — the disk backend returns a local path, the S3 backend returns a presigned URL that ffprobe reads directly, fetching only the header it needs. `BaseService.getProbeInput` picks between them.

**Tech Stack:** NestJS, vitest, `@aws-sdk/s3-request-presigner` (already a dependency, already mocked in the S3 backend spec).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-video-trim-s3-design.md`, Slice 2 (design §1 and §2).
- Slice 1 is complete (commit `a510ecfde2`): the e2e phase `video-trim-s3` exists and currently fails with the 400 this slice removes.
- **Do not touch `media.service.ts` or `storage.core.ts`** — those are Slices 3–6.
- The media location under unit tests is `/data`, set at import time by `server/test/repositories/storage.repository.mock.ts:47`. So `/data/library/x.mp4` is an Immich path, `/mnt/external/x.mp4` is external, `upload/admin/ab/cd/x.mp4` is an S3 key.
- Run tests from `server/`: `pnpm test -- --run src/services/asset.service.spec.ts` (and the backend specs by path).
- Every test must be seen failing. RED tests must fail with the named reason before implementation. The one GUARD test (E4) passes on arrival and must be proved with the named mutation.
- `asset.service.ts` already imports `isAbsolute` from `node:path` (line 5). `base.service.ts` already imports it too (line 6). No new imports needed for those two files.

---

### Task 1: `getReadableUrl` on both storage backends

**Files:**

- Modify: `server/src/interfaces/storage-backend.interface.ts`
- Modify: `server/src/backends/disk-storage.backend.ts`
- Modify: `server/src/backends/s3-storage.backend.ts`
- Test: `server/src/backends/disk-storage.backend.spec.ts`, `server/src/backends/s3-storage.backend.spec.ts`

**Interfaces:**

- Consumes: `DiskStorageBackend.resolvePath(key)` (private, existing — returns absolute paths as-is, else `join(this.mediaLocation, key)`); `S3StorageBackend.presignedUrlExpiry`, `this.client`, `this.bucket`; `getSignedUrl` from `@aws-sdk/s3-request-presigner` (already imported at line 11).
- Produces: `StorageBackend.getReadableUrl(key: string): Promise<string>` — a path or URL that ffmpeg/ffprobe can read directly, without downloading. Consumed by `BaseService.getProbeInput` in Task 2.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('DiskStorageBackend', ...)` block in `server/src/backends/disk-storage.backend.spec.ts`:

```ts
describe('getReadableUrl', () => {
  it('returns the resolved local path for a relative key', async () => {
    await expect(backend.getReadableUrl('upload/admin/ab/cd/video.mp4')).resolves.toBe(
      join(testDir, 'upload/admin/ab/cd/video.mp4'),
    );
  });

  it('returns absolute paths unchanged', async () => {
    await expect(backend.getReadableUrl('/data/library/video.mp4')).resolves.toBe('/data/library/video.mp4');
  });
});
```

Append to `server/src/backends/s3-storage.backend.spec.ts`, inside the top-level `describe('S3StorageBackend', ...)` block (the file already mocks `@aws-sdk/s3-request-presigner` with `getSignedUrl` resolving to `'https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc123'`):

```ts
describe('getReadableUrl', () => {
  it('returns a presigned GET url for the key', async () => {
    const url = await backend.getReadableUrl('upload/admin/ab/cd/video.mp4');

    expect(url).toBe('https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc123');
    expect(GetObjectCommand).toHaveBeenCalledWith(expect.objectContaining({ Key: 'upload/admin/ab/cd/video.mp4' }));
  });
});
```

If `GetObjectCommand` is not already imported in that spec, add it to the existing `@aws-sdk/client-s3` import. Match the existing spec's `backend` construction in its `beforeEach`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server
pnpm test -- --run src/backends/disk-storage.backend.spec.ts src/backends/s3-storage.backend.spec.ts
```

Expected: FAIL — `backend.getReadableUrl is not a function` (E5, E6).

- [ ] **Step 3: Implement `getReadableUrl`**

In `server/src/interfaces/storage-backend.interface.ts`, add to the `StorageBackend` interface (after `getServeStrategy`):

```ts
  /**
   * A path or URL that external tools (ffmpeg/ffprobe) can read directly,
   * without downloading the object first. Disk returns a filesystem path;
   * S3 returns a presigned URL.
   */
  getReadableUrl(key: string): Promise<string>;
```

In `server/src/backends/disk-storage.backend.ts`:

```ts
  getReadableUrl(key: string): Promise<string> {
    return Promise.resolve(this.resolvePath(key));
  }
```

In `server/src/backends/s3-storage.backend.ts`:

```ts
  async getReadableUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: this.presignedUrlExpiry,
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test -- --run src/backends/disk-storage.backend.spec.ts src/backends/s3-storage.backend.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/interfaces/storage-backend.interface.ts server/src/backends/
git commit -m "feat(storage): add StorageBackend.getReadableUrl for download-free probing"
```

---

### Task 2: `BaseService.getProbeInput`

**Files:**

- Modify: `server/src/services/base.service.ts` (add next to `ensureLocalFile`, around line 398)

**Interfaces:**

- Consumes: `StorageBackend.getReadableUrl` (Task 1); `StorageService.resolveBackendForKey(key)` (existing static).
- Produces: `protected async getProbeInput(filePath: string): Promise<string>` — consumed by `AssetService.editAsset` in Task 3.

- [ ] **Step 1: Implement (covered by Task 3's tests — no separate test)**

This is a two-line delegation with no behaviour of its own; Task 3's E1/E3/E4 exercise both of its branches through `editAsset`. Add immediately after `ensureLocalFile` in `server/src/services/base.service.ts`:

```ts
  /**
   * Returns something ffmpeg/ffprobe can read directly: an absolute path as-is,
   * or a presigned URL for a storage-backend key. Unlike ensureLocalFile this
   * does NOT download the object, so it is safe to call inside a request handler.
   */
  protected async getProbeInput(filePath: string): Promise<string> {
    if (isAbsolute(filePath)) {
      return filePath;
    }
    // lazy import to avoid circular dependency (StorageService extends BaseService)
    const { StorageService } = await import('./storage.service.js');
    return StorageService.resolveBackendForKey(filePath).getReadableUrl(filePath);
  }
```

- [ ] **Step 2: Commit with Task 3** (this alone changes no behaviour)

---

### Task 3: Lift the guard and probe via `getProbeInput`

**Files:**

- Modify: `server/src/services/asset.service.ts:728-737`
- Test: `server/src/services/asset.service.spec.ts` (rewrite the test at line ~2301, add three more)

**Interfaces:**

- Consumes: `BaseService.getProbeInput` (Task 2).
- Produces: no new exports. Behaviour change: `PUT /assets/:id/edits` with a Trim now accepts S3-backed assets.

- [ ] **Step 1: Write the failing tests**

In `server/src/services/asset.service.spec.ts`, **replace** the existing test `'should reject trim on cloud-stored videos'` (line ~2301) — it encodes the old behaviour and must go — with the following four tests. Keep the surrounding `describe` block and its existing setup.

```ts
it('should accept trim on S3-backed videos and probe via a presigned url', async () => {
  const assetId = newUuid();
  const getReadableUrl = vi.fn().mockResolvedValue('https://bucket.s3/key?X-Amz-Signature=abc');
  const { StorageService } = await import('src/services/storage.service.js');
  vi.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue({ getReadableUrl } as any);

  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  mocks.asset.getForEdit.mockResolvedValue({
    type: AssetType.Video,
    livePhotoVideoId: null,
    originalPath: 'upload/admin/ab/cd/video.mp4',
    originalFileName: 'video.mp4',
    duration: 30_000,
    exifImageWidth: 1920,
    exifImageHeight: 1080,
    orientation: null,
    projectionType: null,
  } as any);
  mocks.assetEdit.getAll.mockResolvedValue([]);
  mocks.assetEdit.replaceAll.mockResolvedValue([] as any);
  mocks.media.probe.mockResolvedValue({
    videoStreams: [{}],
    audioStreams: [{}],
    format: {},
  } as any);

  await sut.editAsset(authStub.admin, assetId, {
    edits: [{ action: AssetEditAction.Trim, parameters: { startTime: 5, endTime: 25 } }],
  });

  expect(getReadableUrl).toHaveBeenCalledWith('upload/admin/ab/cd/video.mp4');
  expect(mocks.media.probe).toHaveBeenCalledWith('https://bucket.s3/key?X-Amz-Signature=abc');
  expect(mocks.assetEdit.replaceAll).toHaveBeenCalled();
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.AssetEditThumbnailGeneration,
    data: { id: assetId },
  });

  vi.restoreAllMocks();
});

it('should reject trim on external library videos', async () => {
  const assetId = newUuid();
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  mocks.asset.getForEdit.mockResolvedValue({
    type: AssetType.Video,
    livePhotoVideoId: null,
    originalPath: '/mnt/external/video.mp4',
    originalFileName: 'video.mp4',
    duration: 30_000,
    exifImageWidth: 1920,
    exifImageHeight: 1080,
    orientation: null,
    projectionType: null,
  } as any);

  await expect(
    sut.editAsset(authStub.admin, assetId, {
      edits: [{ action: AssetEditAction.Trim, parameters: { startTime: 5, endTime: 25 } }],
    }),
  ).rejects.toThrow('Video trimming is not available for external library videos');
});

it('should reject trim on audio-only S3 files', async () => {
  const assetId = newUuid();
  const getReadableUrl = vi.fn().mockResolvedValue('https://bucket.s3/key?X-Amz-Signature=abc');
  const { StorageService } = await import('src/services/storage.service.js');
  vi.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue({ getReadableUrl } as any);

  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  mocks.asset.getForEdit.mockResolvedValue({
    type: AssetType.Video,
    livePhotoVideoId: null,
    originalPath: 'upload/admin/ab/cd/audio.m4a',
    originalFileName: 'audio.m4a',
    duration: 180_000,
    exifImageWidth: null,
    exifImageHeight: null,
    orientation: null,
    projectionType: null,
  } as any);
  mocks.assetEdit.getAll.mockResolvedValue([]);
  mocks.media.probe.mockResolvedValue({ videoStreams: [], audioStreams: [{}], format: {} } as any);

  await expect(
    sut.editAsset(authStub.admin, assetId, {
      edits: [{ action: AssetEditAction.Trim, parameters: { startTime: 10, endTime: 60 } }],
    }),
  ).rejects.toThrow('Cannot trim audio-only files');

  vi.restoreAllMocks();
});

it('should probe disk-backed videos by absolute path, without presigning', async () => {
  const assetId = newUuid();
  const { StorageService } = await import('src/services/storage.service.js');
  const resolveSpy = vi.spyOn(StorageService, 'resolveBackendForKey');

  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  mocks.asset.getForEdit.mockResolvedValue({
    type: AssetType.Video,
    livePhotoVideoId: null,
    originalPath: '/data/library/video.mp4',
    originalFileName: 'video.mp4',
    duration: 30_000,
    exifImageWidth: 1920,
    exifImageHeight: 1080,
    orientation: null,
    projectionType: null,
  } as any);
  mocks.assetEdit.getAll.mockResolvedValue([]);
  mocks.assetEdit.replaceAll.mockResolvedValue([] as any);
  mocks.media.probe.mockResolvedValue({ videoStreams: [{}], audioStreams: [{}], format: {} } as any);

  await sut.editAsset(authStub.admin, assetId, {
    edits: [{ action: AssetEditAction.Trim, parameters: { startTime: 5, endTime: 25 } }],
  });

  expect(mocks.media.probe).toHaveBeenCalledWith('/data/library/video.mp4');
  expect(resolveSpy).not.toHaveBeenCalled();

  vi.restoreAllMocks();
});
```

Check the top of the spec for the imports these need (`vi`, `JobName`, `AssetEditAction`, `AssetType`, `newUuid`, `authStub`) and add only what is missing.

- [ ] **Step 2: Run the tests to verify they fail with the named reasons**

```bash
cd server
pnpm test -- --run src/services/asset.service.spec.ts
```

Expected reds:

- "should accept trim on S3-backed videos…" → FAILS: throws `Video trimming is not available for cloud-stored videos` (E1).
- "should reject trim on external library videos" → FAILS: message is `…not available for cloud-stored videos`, not `…external library videos` (E2).
- "should reject trim on audio-only S3 files" → FAILS: the cloud-stored guard throws before the probe (E3).
- "should probe disk-backed videos by absolute path…" → **PASSES already** (E4). This is the GUARD; its mutation proof is Step 5.

- [ ] **Step 3: Implement the guard replacement and the probe input**

In `server/src/services/asset.service.ts`, replace lines 728–737 (the `// S3/cloud storage check` block through the `probe` call and its audio-only check) with:

```ts
// Block external-library videos: absolute paths outside the media location.
// S3-backed originals are relative keys, resolved through the storage backend.
if (isAbsolute(asset.originalPath) && !StorageCore.isImmichPath(asset.originalPath)) {
  throw new BadRequestException('Video trimming is not available for external library videos');
}

// Audio-only file check. getProbeInput hands ffprobe an absolute path (disk) or a
// presigned URL (S3) — it does NOT download the video, which matters here because
// this runs inside the request.
const probeResult = await this.mediaRepository.probe(await this.getProbeInput(asset.originalPath));
if (!probeResult.videoStreams || probeResult.videoStreams.length === 0) {
  throw new BadRequestException('Cannot trim audio-only files');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test -- --run src/services/asset.service.spec.ts
```

Expected: PASS, all four, and every other test in the file still green.

- [ ] **Step 5: Mutation-prove the E4 guard**

E4 passed before the implementation, so prove it has teeth. Temporarily change `getProbeInput` in `base.service.ts` to always presign:

```ts
  protected async getProbeInput(filePath: string): Promise<string> {
    const { StorageService } = await import('./storage.service.js');
    return StorageService.resolveBackendForKey(filePath).getReadableUrl(filePath);
  }
```

Run `pnpm test -- --run src/services/asset.service.spec.ts`.

Expected: "should probe disk-backed videos by absolute path, without presigning" **FAILS** (`resolveSpy` was called). Then **revert the mutation** and confirm the suite is green again. If the test still passes under the mutation, the test is broken — fix it before continuing.

- [ ] **Step 6: Run the full server unit suite**

```bash
pnpm test -- --run
```

Expected: green. `getProbeInput` is new and `editAsset` is the only caller, so the blast radius is small — but confirm.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/asset.service.ts server/src/services/base.service.ts server/src/services/asset.service.spec.ts
git commit -m "feat(editing): allow video trim on S3-backed assets (#671)

The API guard rejected any non-isImmichPath original, which includes every S3
relative key, so trim was fenced off entirely on S3 installs. It now rejects
only absolute paths outside the media location (external libraries).

The pre-flight audio-only probe runs inside the request, so it resolves its
input via the new BaseService.getProbeInput: an absolute path on disk, a
presigned URL on S3. ffprobe reads the header without downloading the video."
```

---

## Self-Review

**Spec coverage:** E1 (accept S3 trim + presigned probe), E2 (external library still rejected, new message), E3 (audio-only on S3), E4 (disk guard, mutation-proved), E5 (S3 `getReadableUrl`), E6 (disk `getReadableUrl`), and the rewrite of the obsolete `asset.service.spec.ts:2301` test — all present.

**Placeholders:** none; every step has complete code or a runnable command.

**Type consistency:** `getReadableUrl(key: string): Promise<string>` is identical in the interface, both backends, the `getProbeInput` call site, and the test doubles. `mocks.assetEdit` matches `server/test/utils.ts:234`. `mocks.job.queue` and `JobName.AssetEditThumbnailGeneration` match `asset.service.ts:811`.

**Not in this slice:** `media.service.ts`, `storage.core.ts`, the e2e wiring. The e2e phase will still fail after this slice — but deeper, inside the trim job with ENOENT, which is the Slice 2 "done when" signal and the proof that Layer 2 is real.
