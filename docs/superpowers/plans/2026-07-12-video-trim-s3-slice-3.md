# Video Trim on S3 — Slice 3: `persistFile` onto the repository layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `MediaService.persistFile` stream and unlink through `storageRepository` instead of raw `node:fs`, so that S3-mode behaviour in this file becomes testable at all.

**Architecture:** `persistFile` currently calls `createReadStream` from `node:fs`. Under vitest the generated paths do not exist and the mocked backend `put` never consumes the stream, so the failed open emits an unhandled `'error'` event that crashes or flakes the run — which is why no S3 test exists for this file. `asset.service`'s S3 sidecar path already avoids this by streaming through `storageRepository.createPlainReadStream` (mocked in tests as `mocks.storage.createPlainReadStream`). `persistFile` adopts the same pattern, and `handleVideoTrim`'s two raw `unlink` calls move to `storageRepository.unlink` for the same reason: it makes failure-path cleanup assertable in Slice 4. Production behaviour is unchanged.

**Tech Stack:** NestJS, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-video-trim-s3-design.md`, Slice 3 (design §3).
- Slices 1–2 are complete. Slice 2 enabled trim on S3 at the API; this slice starts fixing the job.
- **Behaviour must not change.** This is a pure refactor plus the two tests it unlocks. The existing `media.service.spec.ts` suite must stay green with **zero changes to existing tests**.
- Do not change `handleVideoTrim`'s logic in this slice beyond swapping the two `unlink` calls — no `ensureLocalFile`, no `persistFile` call for the video, no `persistImageFiles`. Those are Slices 4–6.
- **`server/test/vitest.config.mjs` sets no `restoreMocks` and there are no `setupFiles`.** A `vi.spyOn(StorageService, 'getWriteBackend')` leaks into every later test in the file and would silently run the disk-mode tests against S3. The new S3 test MUST restore its spies in `afterEach`.
- Disk mode in `media.service.spec.ts` works because `StorageService.diskBackend` is `undefined` there, so `persistFile` takes its `!writeBackend` branch. Do not "fix" that by constructing a `DiskStorageBackend`.
- Run tests from `server/`: `pnpm test -- --run src/services/media.service.spec.ts`.

---

### Task 1: Route `persistFile` and the trim unlinks through `storageRepository`

**Files:**

- Modify: `server/src/services/media.service.ts` (lines 2–3 imports; `persistFile` at 78–94; `handleVideoTrim` unlinks at 303 and 335)
- Test: `server/src/services/media.service.spec.ts` (new `describe('persistFile', …)` block)

**Interfaces:**

- Consumes: `StorageRepository.createPlainReadStream(filepath: string): Readable` and `StorageRepository.unlink(file: string): Promise<void>` (both exist; `unlink` warns on ENOENT and rethrows other errors). `StorageService.getWriteBackend(): StorageBackend` (static).
- Produces: no signature change. `private async persistFile(localPath: string, relativeKey: string, contentType?: string): Promise<string>` keeps its contract: disk → returns `localPath` and touches nothing; S3 → uploads, unlinks the local temp, returns `relativeKey`.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `server/src/services/media.service.spec.ts`, at the top level inside the outermost `describe('MediaService', …)` (place it directly before the first `describe('handleQueueGenerateThumbnails'…)` or any other existing block — order does not matter, but it must be a sibling):

```ts
describe('persistFile', () => {
  afterEach(() => {
    // vitest.config.mjs sets no restoreMocks and there are no setupFiles, so a
    // getWriteBackend spy would leak into every later test in this file and
    // silently run the disk-mode tests against S3.
    vi.restoreAllMocks();
  });

  it('uploads to the write backend and removes the local temp (S3 mode)', async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const stream = makeStream([Buffer.from('data')]);
    const { StorageService } = await import('src/services/storage.service.js');
    vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put } as any);
    mocks.storage.createPlainReadStream.mockReturnValue(stream as any);

    const result = await (sut as any).persistFile('/local/out.jpg', 'thumbs/aa/bb/x.jpg', 'image/jpeg');

    expect(mocks.storage.createPlainReadStream).toHaveBeenCalledWith('/local/out.jpg');
    expect(put).toHaveBeenCalledWith('thumbs/aa/bb/x.jpg', stream, { contentType: 'image/jpeg' });
    expect(mocks.storage.unlink).toHaveBeenCalledWith('/local/out.jpg');
    expect(result).toBe('thumbs/aa/bb/x.jpg');
  });

  it('returns the local path and deletes nothing (disk mode)', async () => {
    // StorageService.diskBackend is undefined in this spec file, so getWriteBackend()
    // returns undefined and persistFile takes its disk branch.
    const result = await (sut as any).persistFile('/local/out.jpg', 'thumbs/aa/bb/x.jpg', 'image/jpeg');

    expect(result).toBe('/local/out.jpg');
    expect(mocks.storage.createPlainReadStream).not.toHaveBeenCalled();
    expect(mocks.storage.unlink).not.toHaveBeenCalled();
  });
});
```

`makeStream` is already imported in this spec (`test/utils`). Add `afterEach` and `vi` to the existing `vitest` import if they are not already there.

- [ ] **Step 2: Run the tests to verify A1 fails**

```bash
cd server
pnpm test -- --run src/services/media.service.spec.ts -t "persistFile"
```

Expected:

- **A1** ("uploads to the write backend and removes the local temp (S3 mode)") → **FAILS**: `mocks.storage.createPlainReadStream` was never called (the code uses raw `node:fs`). You may also see an unhandled ENOENT error from the real `createReadStream` — that is the exact hazard this slice removes.
- **A2** ("returns the local path and deletes nothing (disk mode)") → **PASSES already**. It is the GUARD; Step 5 proves it.

- [ ] **Step 3: Implement**

In `server/src/services/media.service.ts`:

1. Delete the now-unused imports on lines 2–3 (`createReadStream` from `node:fs` is used only in `persistFile`; `unlink` from `node:fs/promises` is used only at lines 89, 303, 335 — all three are replaced below). Remove both import lines entirely.

2. Replace the body of `persistFile` (currently lines ~78–94) with:

```ts
  private async persistFile(localPath: string, relativeKey: string, contentType?: string): Promise<string> {
    const writeBackend = StorageService.getWriteBackend();
    if (!writeBackend || writeBackend instanceof DiskStorageBackend) {
      // Disk mode: the file was already written to the final path
      return localPath;
    }
    // S3 mode: upload the locally-generated file
    const stream = this.storageRepository.createPlainReadStream(localPath);
    await writeBackend.put(relativeKey, stream, { contentType });
    // Clean up local temp file
    await this.storageRepository.unlink(localPath).catch(() => {
      /* ignore */
    });
    return relativeKey;
  }
```

3. In `handleVideoTrim`, replace the two raw unlinks:

```ts
// line ~303, in the trim catch block
await this.storageRepository.unlink(outputPath).catch(() => {});
```

```ts
// line ~335, after extractFrame
await this.storageRepository.unlink(framePath).catch(() => {});
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test -- --run src/services/media.service.spec.ts
```

Expected: PASS — both new tests, and **every existing test in the file unchanged and still green**. If an existing test needed editing, stop: that means behaviour changed, which this slice forbids.

- [ ] **Step 5: Mutation-prove the A2 guard**

A2 passed before the implementation, so prove it has teeth. Temporarily make `persistFile` unlink unconditionally by moving the unlink above the disk-mode early return:

```ts
  private async persistFile(localPath: string, relativeKey: string, contentType?: string): Promise<string> {
    await this.storageRepository.unlink(localPath).catch(() => {});   // MUTATION
    const writeBackend = StorageService.getWriteBackend();
    if (!writeBackend || writeBackend instanceof DiskStorageBackend) {
      return localPath;
    }
    ...
```

Run `pnpm test -- --run src/services/media.service.spec.ts -t "persistFile"`.

Expected: **A2 FAILS** (`mocks.storage.unlink` was called). This is what stops a future "simplification" from deleting the very file disk mode just wrote. Then **revert the mutation** and confirm green. If A2 survives the mutation, the test is broken — fix it before continuing.

- [ ] **Step 6: Run the full server unit suite**

```bash
pnpm test -- --run
```

Expected: green. `persistFile` is called by four job paths (thumbnails, edit thumbnails, video conversion, person thumbnails) — their existing tests are the blast-radius guard.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/media.service.ts server/src/services/media.service.spec.ts
git commit -m "refactor(media): stream persistFile through the storage repository

persistFile read the generated file with node:fs createReadStream. Under
vitest those paths do not exist, and because a mocked backend put never
consumes the stream, the failed open emits an unhandled 'error' event — so
nothing in this file could be tested in S3 mode. Stream and unlink through
storageRepository instead, matching asset.service's S3 sidecar path.

handleVideoTrim's two unlinks move for the same reason: it makes the
failure-path cleanup assertable in the next slice. No behaviour change."
```

---

## Self-Review

**Spec coverage:** A1 (RED, S3 persist streams via the repository, uploads with content type, unlinks the temp, returns the key) and A2 (GUARD, disk mode returns the local path and deletes nothing, mutation-proved) — both present, matching the spec's Slice 3.

**Placeholders:** none.

**Type consistency:** `createPlainReadStream(filepath: string): Readable` and `unlink(file: string): Promise<void>` match `server/src/repositories/storage.repository.ts:163` and `:207`. `StorageService.getWriteBackend()` and `DiskStorageBackend` are already imported in `media.service.ts`. `makeStream` is already imported in the spec from `test/utils`.

**Not in this slice:** `ensureLocalFile` on the trim input (Slice 4), `StorageCore` keys and video persistence (Slice 5), `persistImageFiles` (Slice 6), e2e wiring (Slice 7).
