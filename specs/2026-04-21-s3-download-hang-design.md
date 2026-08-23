# S3 Download Hang Design

**Date:** 2026-04-21  
**Branch:** `s3-download-hang-design`  
**Scope:** `download.service.ts` + `download.controller.ts`

## Problem

Users on S3 backends (Wasabi, MinIO, etc.) who download large selections (~150 assets) via the
Gallery web UI experience a server hang:

1. The download dialog appears but stays at 0% indefinitely.
2. Thumbnail loading for new assets also stalls.
3. Cancelling the download and refreshing the UI — the server stops responding entirely.
4. No server-side errors log. Memory is not exhausted.

Reported on v4.52.0 with Wasabi S3 and `serveMode: proxy`.

## Root Cause

`downloadArchive()` in `server/src/services/download.service.ts:88-133` loops over all N assets
and calls `await backend.get(filePath)` for each S3 asset **upfront**, before archiver has consumed
any of them.

`backend.get()` sends a `GetObjectCommand` to S3, opening a real TCP connection and beginning the
HTTP response body stream. `archive.append(stream, ...)` queues the stream in archiver, but
archiver uses an internal sequential queue (`async.queue(..., 1)`) and processes entries one at a
time. So N−1 connections sit stalled:

- Their Node.js `Readable` internal buffers fill to the `highWaterMark`.
- TCP backpressure kicks in (receive window → 0).
- S3 holds the connection open but stops sending.

With 150 assets, 150 sockets are held simultaneously.

**Why thumbnails also stall (`serveMode: proxy`):** every thumbnail request calls
`backend.get()` via `getServeStrategy()`, consuming a socket from the same AWS SDK connection
pool. Those requests queue behind the stalled download connections and make no progress until
a download socket frees up — which doesn't happen because archiver is draining them one-by-one.

**Why the server appears dead after cancel:** there is no disconnect cleanup. When the client
cancels, the 150 stalled connections persist until TCP keepalive timeout. During this window the
connection pool remains exhausted for all S3-backed requests.

**Why nothing logs:** no errors occur — the sockets are valid and alive, just idle with full
receive buffers.

## Fix

### Part 1 — LazyS3Readable (eliminates the socket pile-up)

Introduce `LazyS3Readable extends Readable` inside `download.service.ts`. Its `_read()` method
defers `backend.get()` until archiver's internal pipeline actually calls `_read()` for the first
time — which only happens when archiver has started processing that specific entry.

Because archiver's internal queue runs at concurrency 1, `_read()` on entry N+1 is never called
until entry N has fully drained. At any moment, exactly one S3 socket is open.

**Loop change:**

```typescript
// Before: opens socket immediately for every asset
const { stream } = await backend.get(filePath);
zip.addFile(stream, filename);

// After: defers socket until archiver reaches this entry
const lazy = new LazyS3Readable(backend, filePath);
lazies.push(lazy);
zip.addFile(lazy, filename);
```

The S3 branch of the loop becomes synchronous — no `await backend.get()` per asset. Disk assets
still call `await this.storageRepository.realpath(filePath)` inside the same loop; that path is
unchanged.

**`LazyS3Readable` class:**

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
      // Source was paused by backpressure — resume it
      if (this.source.isPaused()) this.source.resume();
      return;
    }
    if (this.started) return; // fetch already in flight
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
    // destroy() without error arg emits 'close' on source, not 'error',
    // so archiver's error listener on the piped stream is not triggered.
    this.source?.destroy();
    callback(err);
  }
}
```

Backpressure notes:

- When `this.push(chunk)` returns false (consumer is slow), `source.pause()` applies backpressure
  to the S3 stream.
- When the consumer calls `_read()` again (internal Node.js stream machinery, not the `'resume'`
  event), `source.isPaused()` is true and `source.resume()` is called.
- The `'resume'` event on a `Readable` does **not** fire as part of Node.js internal backpressure
  resolution and must not be used for this purpose.

Error handling notes:

- `backend.get()` rejection inside the async `.then()/.catch()` chain must be caught explicitly;
  without `.catch()`, a rejected promise inside `_read()` (which is synchronous) becomes an
  unhandled rejection.
- Mid-stream S3 errors are forwarded via `stream.on('error', (err) => this.destroy(err))`.

### Part 2 — Disconnect cleanup (prevents post-cancel hang)

Even with the lazy fix, the one currently-open S3 socket must be closed when the client disconnects.
`archive.stream.destroy()` alone is not sufficient — archiver does not override `_destroy()` to
propagate to its source streams (`compress-commons` has no destroy propagation).

**Approach:** collect all `LazyS3Readable` instances in an array and destroy all of them in
`abort()`. At most one has an active S3 socket (the one archiver is consuming); the rest have
`source === undefined` so `_destroy()` is a no-op for them.

```typescript
const lazies: LazyS3Readable[] = [];
// built in the loop above

const abort = () => {
  zip.stream.destroy();
  for (const lazy of lazies) lazy.destroy();
};
```

**Controller wiring:**

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

The service return type changes locally from `ImmichReadStream` to `{ stream: Readable; abort: () => void }`.
`ImmichReadStream` and `asStreamableFile` are untouched; the one-liner `.then(asStreamableFile)`
in the controller is replaced by the `async/await` form above.

## Files Changed

| File                                            | Change                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `server/src/services/download.service.ts`       | Add `LazyS3Readable`; change S3 branch to use it; collect `lazies`; return `{ stream, abort }` |
| `server/src/controllers/download.controller.ts` | Add `@Req() req: Request`; `async/await` form; wire `req.on('close', abort)`                   |

**No changes to:** `S3StorageBackend`, `StorageRepository`, `StorageBackend` interface,
`ImmichReadStream` (globally), archiver wiring, disk-asset path.

## Approaches Considered and Rejected

| Approach                                 | Why rejected                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pin `maxSockets` on the AWS SDK agent    | Bounds pool size but does not fix the deadlock: N streams are still registered upfront, N−1 still stall                                                       |
| Sequential `await`-before-append         | Requires archiver per-entry completion signals; archiver does not expose these without significant additional wiring                                          |
| Presigned URL manifest (client-side zip) | Correct long-term architecture for very large archives but a major scope change (web app changes, new API shape, OpenAPI churn); wrong fix for a one-file bug |
| Async semaphore (K=2 prefetch)           | More complex than needed; marginal throughput gain not worth the complexity for a bug fix                                                                     |

## Testing

### Unit tests (`server/src/services/download.service.spec.ts`)

- Mock `backend.get()` to return a mock `Readable`. Verify it is **not** called during loop
  construction — only after archiver has started draining the first entry.
- Call `abort()` and verify `destroy()` is called on each registered `LazyS3Readable`.
- Verify a `backend.get()` rejection inside `_read()` calls `this.destroy(err)` (no unhandled
  rejection).

### Manual smoke test (MinIO or Wasabi)

- Download 150 assets. While the download is in progress, run `ss -tnp | grep <s3-port>` —
  should show **1** `ESTABLISHED` connection, not 150.
- Load thumbnails during the download — they should appear normally (no socket contention).
- Cancel the download mid-way. The server should remain responsive immediately; `ss` should show
  0 connections within a few seconds.
- Repeat with `serveMode: redirect` to confirm no regression.

## Out of Scope

- `2026-04-21-s3-relative-path-audit-design.md` — a separate class of S3 bug (relative paths
  reaching local-FS ops). No overlap with this fix.
- `maxSockets` pin on `S3StorageBackend` — not needed; the lazy approach means at most 1 socket
  per download is ever in use.
