# S3 Download Hang Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix a server hang where downloading N S3-backed assets opens N concurrent S3 sockets, exhausting the connection pool and stalling thumbnails and all subsequent S3 requests.

**Architecture:** Replace upfront `await backend.get()` in `downloadArchive()` with a `LazyS3Readable` that defers the S3 GET until archiver actually starts consuming each entry. Since archiver is sequential (concurrency 1), at most one socket is ever open. A collected `lazies` array lets `abort()` destroy the one active socket on client disconnect, wired via `req.on('close')` in the controller.

**Tech Stack:** Node.js `Readable` streams, archiver (zip, store mode), NestJS `@Req()`, AWS SDK v3 `GetObjectCommand` (via existing `backend.get()`), Vitest

**Design doc:** `docs/plans/2026-04-21-s3-download-hang-design.md`

---

### Task 1: Fix existing tests — new return shape + S3 lazy behaviour

The service return type changes from `ImmichReadStream` (`{ stream }`) to `{ stream, abort }`.
All existing assertions using `resolves.toEqual({ stream: ... })` will fail because `toEqual`
is strict about extra keys. Switch them to `toMatchObject` so `abort` being present doesn't break
existing tests.

The existing S3 test (`should stream S3 assets by resolving the backend`) currently asserts
`backend.get()` was called during `downloadArchive()`. After the fix it won't be called until
archiver drains the entry, so rewrite that test to assert `get()` was NOT called during construction
and that the stream passed to `addFile` is a `Readable` (the lazy wrapper), not the raw S3 stream.

**Files:**
- Modify: `server/src/services/download.service.spec.ts`

**Step 1: Replace all `resolves.toEqual({ stream: ... })` with `resolves.toMatchObject`**

There are 11 occurrences across the `downloadArchive` describe block (lines 48, 71, 95, 117, 139,
168, 194, 216, 236, 257, 278, 298). Replace every instance.

Find: `resolves.toEqual({`
Replace with: `resolves.toMatchObject({`

Only replace inside the `downloadArchive` describe block. The `getDownloadInfo` tests don't return
streams and are unaffected.

**Step 2: Rewrite the S3 streaming test**

Replace the test at lines 306–333 (`should stream S3 assets by resolving the backend`) with:

```typescript
it('should use a LazyS3Readable for S3 assets without calling backend.get() upfront', async () => {
  const archiveMock = {
    addFile: vitest.fn(),
    finalize: vitest.fn(),
    stream: new Readable(),
  };

  // Relative path → isAbsolute returns false → S3 branch
  const asset = AssetFactory.create();
  const s3Asset = { ...asset, originalPath: 'upload/library/photo.jpg' };

  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([s3Asset.id]));
  mocks.asset.getForOriginals.mockResolvedValue([s3Asset]);
  mocks.storage.createZipStream.mockReturnValue(archiveMock);

  const mockBackend = { get: vitest.fn() };
  vitest.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(mockBackend as any);

  await sut.downloadArchive(authStub.admin, { assetIds: [s3Asset.id] });

  // backend.get() must NOT be called during archive construction — it is lazy
  expect(mockBackend.get).not.toHaveBeenCalled();

  // addFile receives a Readable (the LazyS3Readable wrapper), not a raw S3 stream
  expect(archiveMock.addFile).toHaveBeenCalledTimes(1);
  const [passedStream, passedName] = archiveMock.addFile.mock.calls[0];
  expect(passedStream).toBeInstanceOf(Readable);
  expect(passedName).toBe(s3Asset.originalFileName);
});
```

**Step 3: Run the full spec to see which tests now fail**

```bash
cd /home/pierre/dev/gallery/.worktrees/s3-download-hang-design/server
pnpm test -- --run src/services/download.service.spec.ts
```

Expected outcome: all existing tests pass except the rewritten S3 test (which now fails because the
implementation still calls `backend.get()` upfront). This establishes the red baseline.

---

### Task 2: Add three new failing unit tests

**Files:**
- Modify: `server/src/services/download.service.spec.ts`

Add the three tests below inside the `downloadArchive` describe block, after the rewritten S3 test.

**Step 1: Add test — abort() destroys all registered lazy streams**

```typescript
it('should destroy all lazy streams when abort() is called', async () => {
  const capturedStreams: Readable[] = [];
  const archiveMock = {
    addFile: vitest.fn().mockImplementation((input: Readable | string) => {
      if (typeof input !== 'string') capturedStreams.push(input);
    }),
    finalize: vitest.fn(),
    stream: new Readable(),
  };

  const asset1 = AssetFactory.create();
  const asset2 = AssetFactory.create();
  const s3Asset1 = { ...asset1, originalPath: 'upload/library/a.jpg' };
  const s3Asset2 = { ...asset2, originalPath: 'upload/library/b.jpg' };

  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([s3Asset1.id, s3Asset2.id]));
  mocks.asset.getForOriginals.mockResolvedValue([s3Asset1, s3Asset2]);
  mocks.storage.createZipStream.mockReturnValue(archiveMock);

  const mockBackend = { get: vitest.fn() };
  vitest.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(mockBackend as any);

  const { abort } = await sut.downloadArchive(authStub.admin, {
    assetIds: [s3Asset1.id, s3Asset2.id],
  });

  const destroySpies = capturedStreams.map((s) => vitest.spyOn(s, 'destroy'));

  abort();

  for (const spy of destroySpies) {
    expect(spy).toHaveBeenCalled();
  }
});
```

**Step 2: Add test — backend.get() rejection surfaces as stream error**

```typescript
it('should forward backend.get() rejection as a stream error on _read()', async () => {
  let capturedLazy: Readable | undefined;
  const archiveMock = {
    addFile: vitest.fn().mockImplementation((input: Readable | string) => {
      if (typeof input !== 'string') capturedLazy = input;
    }),
    finalize: vitest.fn(),
    stream: new Readable(),
  };

  const asset = AssetFactory.create();
  const s3Asset = { ...asset, originalPath: 'upload/library/photo.jpg' };

  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([s3Asset.id]));
  mocks.asset.getForOriginals.mockResolvedValue([s3Asset]);
  mocks.storage.createZipStream.mockReturnValue(archiveMock);

  const fetchError = new Error('S3 connection refused');
  const mockBackend = { get: vitest.fn().mockRejectedValue(fetchError) };
  vitest.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(mockBackend as any);

  await sut.downloadArchive(authStub.admin, { assetIds: [s3Asset.id] });

  // Register an error handler before triggering _read()
  const errorHandler = vitest.fn();
  capturedLazy!.on('error', errorHandler);

  // Trigger _read() — this starts the fetch which will reject
  capturedLazy!.read();

  // Let the rejected promise settle
  await new Promise<void>((resolve) => setImmediate(resolve));

  expect(errorHandler).toHaveBeenCalledWith(fetchError);
});
```

**Step 3: Add test — mid-stream S3 error forwarded**

```typescript
it('should forward a mid-stream S3 error to the lazy readable', async () => {
  let capturedLazy: Readable | undefined;
  const archiveMock = {
    addFile: vitest.fn().mockImplementation((input: Readable | string) => {
      if (typeof input !== 'string') capturedLazy = input;
    }),
    finalize: vitest.fn(),
    stream: new Readable(),
  };

  const asset = AssetFactory.create();
  const s3Asset = { ...asset, originalPath: 'upload/library/photo.jpg' };

  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([s3Asset.id]));
  mocks.asset.getForOriginals.mockResolvedValue([s3Asset]);
  mocks.storage.createZipStream.mockReturnValue(archiveMock);

  const s3Stream = new Readable({ read() {} });
  const mockBackend = { get: vitest.fn().mockResolvedValue({ stream: s3Stream }) };
  vitest.spyOn(StorageService, 'resolveBackendForKey').mockReturnValue(mockBackend as any);

  await sut.downloadArchive(authStub.admin, { assetIds: [s3Asset.id] });

  const errorHandler = vitest.fn();
  capturedLazy!.on('error', errorHandler);
  capturedLazy!.read(); // starts fetch

  await new Promise<void>((resolve) => setImmediate(resolve)); // let .then() run

  const midStreamError = new Error('S3 connection reset');
  s3Stream.emit('error', midStreamError);

  expect(errorHandler).toHaveBeenCalledWith(midStreamError);
});
```

**Step 4: Run to confirm all three new tests fail**

```bash
cd /home/pierre/dev/gallery/.worktrees/s3-download-hang-design/server
pnpm test -- --run src/services/download.service.spec.ts
```

Expected: 4 failures (the rewritten S3 test + the 3 new tests). All other tests pass.

---

### Task 3: Implement LazyS3Readable and update downloadArchive()

**Files:**
- Modify: `server/src/services/download.service.ts`

**Step 1: Add import for Readable at the top of the file**

The file already imports from `node:path`. Add `Readable` to the existing Node imports:

```typescript
import { Readable } from 'node:stream';
```

**Step 2: Add the LazyS3Readable class**

Insert this class just above the `@Injectable()` decorator (before the `DownloadService` class):

```typescript
class LazyS3Readable extends Readable {
  private source?: Readable;
  private started = false;

  constructor(
    private readonly backend: StorageBackend,
    private readonly key: string,
  ) {
    super();
  }

  override _read(): void {
    if (this.source) {
      if (this.source.isPaused()) this.source.resume();
      return;
    }
    if (this.started) return;
    this.started = true;

    this.backend
      .get(this.key)
      .then(({ stream }) => {
        this.source = stream;
        stream.on('data', (chunk: Buffer) => {
          if (!this.push(chunk)) stream.pause();
        });
        stream.on('end', () => this.push(null));
        stream.on('error', (err: Error) => this.destroy(err));
      })
      .catch((err: Error) => this.destroy(err));
  }

  override _destroy(err: Error | null, callback: (err?: Error | null) => void): void {
    this.source?.destroy();
    callback(err);
  }
}
```

**Step 3: Add StorageBackend to the imports**

`StorageBackend` is the interface type used in the constructor. It is already used via
`StorageService.resolveBackendForKey()`, but the class constructor parameter needs the type.
Add to the existing import line at the top:

```typescript
import { StorageBackend } from 'src/interfaces/storage-backend.interface';
```

**Step 4: Rewrite the S3 branch of downloadArchive()**

Replace the current S3 else-branch and return statement (lines 122–132):

```typescript
      } else {
        // S3 asset — stream from backend
        const backend = StorageService.resolveBackendForKey(filePath);
        const { stream } = await backend.get(filePath);
        zip.addFile(stream, filename);
      }
    }

    void zip.finalize();

    return { stream: zip.stream };
```

With:

```typescript
      } else {
        // S3 asset — open socket lazily when archiver starts consuming this entry.
        // All N sockets would open concurrently if we awaited backend.get() here;
        // archiver is sequential (concurrency 1) so only 1 socket is ever needed at once.
        const backend = StorageService.resolveBackendForKey(filePath);
        const lazy = new LazyS3Readable(backend, filePath);
        lazies.push(lazy);
        zip.addFile(lazy, filename);
      }
    }

    void zip.finalize();

    const abort = (): void => {
      zip.stream.destroy();
      for (const lazy of lazies) lazy.destroy();
    };

    return { stream: zip.stream, abort };
```

**Step 5: Declare the lazies array at the top of downloadArchive()**

Just after `const paths: Record<string, number> = {};` (line 94), add:

```typescript
const lazies: LazyS3Readable[] = [];
```

**Step 6: Update the return type of downloadArchive()**

Change the method signature from:

```typescript
async downloadArchive(auth: AuthDto, dto: DownloadArchiveDto): Promise<ImmichReadStream> {
```

To:

```typescript
async downloadArchive(auth: AuthDto, dto: DownloadArchiveDto): Promise<{ stream: Readable; abort: () => void }> {
```

Remove `ImmichReadStream` from the import at the top of the file if it is no longer used anywhere
else in this file (check — it's only used in `downloadArchive`'s return type, so remove it).

**Step 7: Run the spec to verify all tests now pass**

```bash
cd /home/pierre/dev/gallery/.worktrees/s3-download-hang-design/server
pnpm test -- --run src/services/download.service.spec.ts
```

Expected: all tests pass, 0 failures.

**Step 8: Commit**

```bash
cd /home/pierre/dev/gallery/.worktrees/s3-download-hang-design
git add server/src/services/download.service.ts server/src/services/download.service.spec.ts
git commit -m "fix(download): lazy S3 socket opening and abort cleanup"
```

---

### Task 4: Update the download controller

**Files:**
- Modify: `server/src/controllers/download.controller.ts`

**Step 1: Add `@Req()` import and `Request` type**

NestJS re-exports `@Req()` from `@nestjs/common`. Add `Req` to the existing import:

```typescript
import { Body, Controller, HttpCode, HttpStatus, Post, Req, StreamableFile } from '@nestjs/common';
```

Add the Express `Request` type import below the NestJS import:

```typescript
import { Request } from 'express';
```

**Step 2: Rewrite downloadArchive() in the controller**

Replace:

```typescript
  downloadArchive(@Auth() auth: AuthDto, @Body() dto: DownloadArchiveDto): Promise<StreamableFile> {
    return this.service.downloadArchive(auth, dto).then(asStreamableFile);
  }
```

With:

```typescript
  async downloadArchive(
    @Auth() auth: AuthDto,
    @Body() dto: DownloadArchiveDto,
    @Req() req: Request,
  ): Promise<StreamableFile> {
    const { stream, abort } = await this.service.downloadArchive(auth, dto);
    req.on('close', abort);
    return new StreamableFile(stream);
  }
```

`asStreamableFile` is no longer called from this method. Check if it is still imported and used
elsewhere in the file — if not, remove the import.

**Step 3: Run a type-check to catch any import or type errors**

```bash
cd /home/pierre/dev/gallery/.worktrees/s3-download-hang-design/server
pnpm exec tsc --noEmit
```

Expected: no errors. If `Request` is not found, the express type package is `@types/express` which
is already a devDependency of the server workspace.

**Step 4: Commit**

```bash
cd /home/pierre/dev/gallery/.worktrees/s3-download-hang-design
git add server/src/controllers/download.controller.ts
git commit -m "fix(download): wire req.on('close', abort) to release S3 socket on disconnect"
```

---

### Task 5: Full test run and type-check

**Step 1: Run the full server test suite**

```bash
cd /home/pierre/dev/gallery/.worktrees/s3-download-hang-design/server
pnpm test
```

Expected: all tests pass. `download.service.spec.ts` should show 0 failures.

**Step 2: TypeScript type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

**Step 3: If any failures — diagnose before fixing**

Common issues:
- `ImmichReadStream` import left dangling → remove it from `download.service.ts`
- `asStreamableFile` import left dangling in controller → remove it
- `Request` from express not found → confirm `@types/express` is in `server/package.json` devDeps
  (it is — NestJS installs it transitively)

---

### Manual smoke test checklist (against MinIO or Wasabi — not required to merge, but good to do)

Run the dev stack (`make dev` from repo root) with an S3 backend configured.

- [ ] Select ~150 S3-backed photos and click Download. While downloading:
  - `ss -tnp | grep <minio-port>` shows **1** ESTABLISHED connection, not 150
  - Thumbnails load normally during the download
- [ ] Cancel the download mid-way. Server stays responsive; connection count drops to 0 within ~10 s
- [ ] Repeat with 1 and 20 photos to confirm no regressions at small scale
- [ ] Repeat with disk-only assets to confirm the disk path is unaffected
