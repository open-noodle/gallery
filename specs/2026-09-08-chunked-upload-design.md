# Chunked / resumable upload

**Status:** design, not yet implemented
**Date:** 2026-09-08
**Upstream context:** [immich-app/immich discussion 1674](https://github.com/immich-app/immich/discussions/1674) (locked 2024-10-27, never implemented). Verified against `upstream/main` on 2026-09-08: upstream carries no tus, chunked, or resumable upload code. There is nothing to inherit and nothing to converge on.

## 1. Problem

Every Gallery client uploads an asset as a single `POST /assets` multipart request whose body is the whole file. That fails in two ways:

1. **Reverse-proxy body limits.** Cloudflare caps request bodies at 100 MB and it cannot be raised; `docs/docs/FAQ.mdx:104` already documents this as a hard wall. `docs/docs/administration/reverse-proxy.md:22` tells self-hosters to set `client_max_body_size 50000M`, which is a workaround, not a fix, and is unavailable behind a managed proxy.
2. **No resumption.** A failure at 95% of a 4 GB video discards 4 GB of transfer. Mobile backup over a mobile network hits this constantly.

## 2. Goals and non-goals

**Goals**

- Upload a file of any size through a proxy that caps bodies at 100 MB.
- Retry an individual failed chunk instead of the whole file.
- Reject an over-quota upload before a byte moves, instead of after the whole file has transferred.
- Ship on all four clients: web, CLI, mobile foreground, mobile background.
- Add as little upstream-conflicting surface as possible (§10).

**Non-goals**

- **Resumption across a client restart.** Decided: within-session only. Closing the browser tab or losing the Dart isolate abandons the upload; the server session is swept by TTL. Mobile background gets restart survival incidentally (§7.4) because the chain state lives in a field background_downloader already persists, but no client persists session state deliberately, and no client offers a resume UI.
- **Full tus protocol compliance.** We implement a subset with two deliberate deviations (§4.2). Third-party tus clients are not a supported target.
- **S3 multipart.** Not needed. Uploads land on local disk first in every configuration (§4.4).
- **Admin-configurable chunk size.** A constant, with the value advertised to clients. Env/system-config tunability is deferred until someone asks.
- **Parallel chunks within one file.** Chunks are strictly sequential. Parallelism stays where it already is: across files.

## 3. Decisions

| Decision          | Choice                                                     | Rationale                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope             | Server + web + CLI + mobile foreground + mobile background | Explicit call, made with §10's rebase cost on the table                                                                                                                                                                                                                                                 |
| Resume depth      | Within-session only                                        | No IndexedDB store, no Drift table, no resume UI, no orphan reconciliation                                                                                                                                                                                                                              |
| Protocol          | Hand-rolled tus subset inside Nest                         | Keeps the Nest auth guard, DI and DTOs; appears in OpenAPI, so create/HEAD/delete get generated TS SDK **and** Dart client methods. `@tus/server` would move auth outside the guard, add two runtime deps, and be invisible to the OpenAPI generator — so all three clients would hand-roll HTTP anyway |
| Session store     | JSON sidecar on disk                                       | No fork migration, so no `scripts/revert-to-immich.sql` blocks and no `server/src/schema/revert-to-immich.spec.ts` guard update                                                                                                                                                                         |
| Capability signal | One integer on `ServerConfigDto`                           | `uploadChunkSize`; `0` means unsupported. Serves as both the version gate and the tunable                                                                                                                                                                                                               |

## 4. Wire protocol

### 4.1 Endpoints

```
POST /assets/upload-session
  Content-Type: application/json
  { filename, size, fileCreatedAt, fileModifiedAt,
    isFavorite?, visibility?, livePhotoVideoId?, duration?,
    metadata?, checksum?, sidecar? }
  -> 201 { id, offset: 0, expiresAt }
  -> 200 AssetMediaResponseDto      (checksum supplied and already known: duplicate, no session created)

HEAD /assets/upload-session/{id}
  -> 200  Upload-Offset: <bytes committed>   Upload-Length: <declared>

PATCH /assets/upload-session/{id}
  Content-Type: application/offset+octet-stream
  Upload-Offset: <start byte>
  <raw chunk body>
  -> 204  Upload-Offset: <new offset>     (more chunks expected)
  -> 201  AssetMediaResponseDto           (final chunk; asset created)
  -> 200  AssetMediaResponseDto           (final chunk; duplicate)
  -> 409  { offset: <server's actual offset> }

DELETE /assets/upload-session/{id}
  -> 204
```

### 4.2 Deviations from tus core, and why

1. **Create takes a JSON DTO, not the base64 `Upload-Metadata` header.** This is the entire reason the hand-rolled approach was chosen: a real zod schema means a real OpenAPI schema, which means generated TypeScript SDK and Dart client methods for create/HEAD/delete. With a `Upload-Metadata` header, all four clients would hand-encode metadata.
2. **The final `PATCH` returns `AssetMediaResponseDto` (201/200) instead of tus's 204.** Saves a round trip, and means every client's existing `AssetMediaStatus.DUPLICATE` branch works unchanged.

No `Tus-Resumable` header. No extensions (creation-with-upload, concatenation, expiration, checksum).

The `PATCH` shape — offset header, `application/offset+octet-stream`, 409-on-mismatch — is kept tus-identical on purpose. That is the part proxies see, the part background_downloader can drive natively, and the part that would have to match if upstream ever ships tus.

### 4.3 The create schema is new, not a reuse of `AssetMediaCreateSchema`

**This is the single easiest thing to get wrong.** `AssetMediaCreateSchema` (`server/src/dtos/asset-media.dto.ts:47`) is built for **multipart string fields** and will reject a JSON body:

| Field                              | Multipart schema                                                                           | Why it fails on JSON                                                                                                                                            | Create-session schema                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `isFavorite`                       | `stringToBool` = `z.stringbool({ truthy: ['true'], falsy: ['false'], case: 'sensitive' })` | Accepts only the **strings** `"true"` / `"false"`. A JSON `false` is rejected.                                                                                  | `z.boolean().optional()`                            |
| `metadata`                         | `JsonParsed.pipe(z.array(AssetMetadataUpsertItemSchema))`                                  | Expects a JSON **string** to parse. A real array is rejected.                                                                                                   | `z.array(AssetMetadataUpsertItemSchema).optional()` |
| `duration`                         | `z.coerce.number().int().min(0)`                                                           | Works, but the coercion is pointless on JSON.                                                                                                                   | `z.int().min(0).optional()`                         |
| `fileCreatedAt` / `fileModifiedAt` | `isoDatetimeToDate`                                                                        | Works as-is — a codec from ISO string to `Date`, and JSON dates are strings.                                                                                    | reuse `isoDatetimeToDate`                           |
| `visibility`, `livePhotoVideoId`   | `AssetVisibilitySchema`, `z.uuidv4()`                                                      | Work as-is.                                                                                                                                                     | reuse both                                          |
| `filename`                         | `z.string().optional()`                                                                    | Optional there because multer supplies `file.originalName` as a fallback. **There is no such fallback here** — the server derives the stored extension from it. | `z.string()` — **required**                         |
| `assetData` / `sidecarData`        | `z.any()` with `format: binary`                                                            | Binary multipart fields; must not appear in a JSON schema at all.                                                                                               | omitted                                             |

Two further rules:

- The inline sidecar field is named **`sidecar`** (a UTF-8 XMP string, capped at 1 MiB), deliberately _not_ `sidecarData`, so nobody mistakes it for the binary multipart field of the same name in the generated SDKs.
- `deviceAssetId` and `deviceId` are **not** in the create schema. Mobile still sends them on the multipart path (`background_upload.service.dart:394`) only for servers v2.7.5 and below; the current server ignores them. Do not add them.

At finalize the service constructs an object matching `AssetMediaCreateDto`'s **output** (post-transform) types — `Date`, `boolean`, parsed array — and passes it to `uploadAsset()`. The input schemas differ; the output shape is identical, which is what makes the hand-off in §5.5 work.

### 4.4 Why no S3 multipart

`StorageRepository` is pure `node:fs`; `createWriteStream` (`server/src/repositories/storage.repository.ts:78`) writes to local disk. The S3 backend (`server/src/backends/s3-storage.backend.ts`) is only reached later, by the storage-template job. Uploads land on local disk in every configuration, so chunk assembly is a local-disk concern and the S3 path is untouched.

## 5. Server design

### 5.1 Files

| Path                                                  | New/mod | Notes                                                                                                       |
| ----------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `server/src/controllers/upload-session.controller.ts` | new     | 4 routes                                                                                                    |
| `server/src/services/upload-session.service.ts`       | new     | extends `BaseService`                                                                                       |
| `server/src/dtos/upload-session.dto.ts`               | new     | zod schemas, `createZodDto`                                                                                 |
| `server/src/utils/upload-session-store.ts`            | new     | sidecar read/write, positional write, finalize claim                                                        |
| `server/src/controllers/index.ts`                     | mod     | 1 import + 1 array entry                                                                                    |
| `server/src/services/index.ts`                        | mod     | 1 import + 1 array entry                                                                                    |
| `server/src/enum.ts`                                  | mod     | 2 lines: `JobName.UploadSessionCleanup`, `DatabaseLock.UploadSessionCleanup` (there is no JobPriority enum) |
| `server/src/types.ts`                                 | mod     | 1 line in the `JobItem` union                                                                               |
| `server/src/services/queue.service.ts`                | mod     | 1 line in `handleNightlyJobs()`                                                                             |
| `server/src/dtos/server.dto.ts`                       | mod     | 1 line: `uploadChunkSize` on `ServerConfigSchema`                                                           |
| `server/src/services/server.service.ts`               | mod     | 1 line in `getSystemConfig()`                                                                               |
| `server/src/constants.ts`                             | mod     | 4 lines: `UPLOAD_CHUNK_SIZE`, `UPLOAD_SESSION_TTL`, and the two open-session caps (§5.6)                    |

**No new repository.** The session store is filesystem-only and uses the existing `StorageRepository`. That means no `BaseService` constructor change, no `newTestService` positional-list edit (`server/test/utils.ts:401`), and no medium-test factory registration — sidestepping two known recurring traps.

### 5.2 Route collision analysis

`AssetController` is `@Controller(RouteKey.Asset)` (`/assets`) and declares `@Get(':id')`, `@Put(':id')` and `@Patch(':id')`. It is registered before `AssetMediaController` in `server/src/controllers/index.ts`.

`UploadSessionController` uses the literal multi-segment prefix `@Controller('assets/upload-session')`. No collision exists:

- `POST /assets/upload-session` — 2 segments. `AssetController` has no `@Post(':id')`; its only 2-segment POST is the literal `@Post('jobs')`.
- `HEAD|PATCH|DELETE /assets/upload-session/{id}` — 3 segments. `AssetController`'s `:id` routes are 2 segments; its 4-segment routes are `:id/metadata/:key`.

Express resolves HEAD against GET handlers, which is why the 3-segment check matters for HEAD specifically. A controller spec asserts every route resolves to this controller and not to `AssetController` (§9.1).

### 5.3 Storage layout

`POST` allocates a uuid and derives the folder exactly as the existing flow does:

```
folder = StorageCore.getNestedFolder(StorageFolder.Upload, auth.user.id, uuid)   # storage.core.ts:393
data   = <folder>/<uuid><ext>          # same name a single-shot upload produces
state  = <folder>/<uuid>.session.json
```

The data file uses the same name `AssetMediaService.getUploadFilename()` would produce (`sanitize(uuid + extension)`, `asset-media.service.ts:106`), so **finalize hands `uploadAsset()` a path indistinguishable from a normal upload.** There is no assembly copy — the chunks are written into the final file in place, which matters at multi-GB sizes.

Path traversal is structurally impossible: the filename is uuid-derived, and only the extension comes from user input, through the same `sanitize()` call the existing path uses.

`<uuid>.session.json` holds:

```jsonc
{
  "userId": "...",
  "sharedLinkId": "...", // present only for shared-link uploads
  "size": 123456789, // declared Upload-Length
  "originalName": "IMG_1234.CR3",
  "checksum": "...", // optional, base64 sha1 as declared at create
  "createdAt": "2026-09-08T10:00:00.000Z",
  "dto": {
    /* the create-schema fields, already parsed to their output types (§4.3) */
  },
}
```

### 5.4 Offset, concurrency and idempotency

Three rules, and they remove the need for any lock:

1. **The committed offset is derived from `fs.stat(data).size`. It is never stored.** Nothing to race, nothing to get out of sync with the file.
2. **`PATCH` writes positionally** — `fd.write(buf, 0, len, offset)` against a handle opened `r+`, not append. A replayed or duplicated chunk rewrites identical bytes at the same position, so it is idempotent.
3. **`Upload-Offset` must equal the current size**, else 409 carrying the server's actual offset. This enforces strict sequentiality, which is what makes rule 1 sound.

A client that is _behind_ (replaying an already-committed chunk) also gets 409 rather than an accepted rewrite, because the server cannot verify the replayed bytes are identical. The client re-syncs from the returned offset.

**Finalize is claimed by `unlink`.** Whichever request successfully unlinks `<uuid>.session.json` owns finalization; a racing second finaliser gets `ENOENT` and returns 404. `unlink` is atomic, so this gives mutual exclusion across replicas with no database lock and no in-process mutex.

Three invariants fall out of the rules above. Each is load-bearing and each has a test in §9:

- **No sparse holes.** Rule 3 rejects any offset greater than the current size, so a positional write can never land past EOF. This is the _only_ thing preventing a sparse file, so rule 3 must not be relaxed to "offset ≤ size" as a convenience for replays.
- **A partial write is self-healing.** If the process dies mid-`fd.write`, the file size reflects only the bytes that landed. The next `PATCH` therefore gets a 409 carrying the true offset, and the client resumes from exactly there. No torn-chunk bookkeeping is needed.
- **The server never enforces a chunk size.** It accepts any chunk length, provided the offset matches and the total does not exceed `Upload-Length`. This matters because `uploadChunkSize` can change under a client mid-upload when a deploy lands: the in-flight upload must keep working at its original chunk size.

### 5.5 Finalize

When `offset + chunkLength === size`:

1. Claim finalization by unlinking the sidecar (§5.4). Lose the race, return 404.
2. Compute sha1 over the assembled file. (A running hash cannot be used: `node:crypto` hashes are not serializable across requests. Re-reading a local-disk file once is the cheap, correct option.)
3. If the create call declared a `checksum` and it does not match, delete the data file and return 400.
4. Build `UploadFile` — `{ uuid, checksum, originalPath, originalName, size }` (`server/src/types.ts:666`). Note `originalName` is taken verbatim from the create DTO; it must **not** go through the `Buffer.from(name, 'latin1').toString('utf8')` re-decode in `mapToUploadFile` (`server/src/utils/asset.util.ts:190`), which exists only to undo a multer artifact.
5. If the create call carried `sidecarData`, write it to `<uuid>.xmp` and build a second `UploadFile` for it.
6. Call the existing `AssetMediaService.uploadAsset(auth, dto, file, sidecarFile)` (`asset-media.service.ts:140`) unchanged.

Step 6 is the point of the whole design: asset creation, checksum-constraint duplicate handling, quota re-check, live-photo linking, shared-link attachment and spaces all execute the existing code, and `handleUploadError` already queues `JobName.FileDelete` for the upload path on failure.

### 5.6 Quota and abuse limits

`AssetMediaService.requireQuota` is `private` (`asset-media.service.ts:457`) and reads only `auth.user.quotaSizeInBytes` / `auth.user.quotaUsageInBytes` off the `AuthDto` — no repository call. The new service **duplicates those three lines** rather than exporting the private method, deliberately: a three-line duplication in a fork-only file is cheaper across rebases than an edit to `asset-media.service.ts`.

Enforcement:

- **At create:** `requireUploadAccess`, `canUploadFile` (mime, by filename), quota against the declared `size`, and a per-user cap on open sessions — **32 concurrent sessions**, and, when the user has a quota, a total declared open-session size not exceeding their remaining quota. Both constants live in `server/src/constants.ts` beside `UPLOAD_CHUNK_SIZE`.
- **At every `PATCH`:** the same `@Authenticated({ permission: Permission.AssetUpload, sharedLink: true })` guard as the existing endpoint, plus session ownership checked against `auth.user.id`.
- **Hard cap:** a `PATCH` that would push the file past the declared `Upload-Length` is rejected with 400 and writes nothing. Abuse is therefore bounded by the declared size, which was already quota-checked at create.

This is strictly better than today, where quota rejection happens only after the entire file has transferred.

### 5.7 Cleanup

`UploadSessionCleanup` follows the `HlsSessionCleanup` precedent exactly — 5 touch points, 4 of them one-liners:

| File                                     | Change                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/src/enum.ts:949` area            | `UploadSessionCleanup = 'UploadSessionCleanup'` in `JobName`                                                                                     |
| `server/src/enum.ts:1082` `DatabaseLock` | `UploadSessionCleanup = 870` (next free: `HlsSessionCleanup = 850`, `PetRecognitionModelSwitch = 860`)                                           |
| `server/src/types.ts:563` area           | `\| { name: JobName.UploadSessionCleanup; data?: IBaseJob }`                                                                                     |
| `server/src/services/queue.service.ts`   | one entry in the `config.nightlyTasks.databaseCleanup` block of `handleNightlyJobs()`                                                            |
| `upload-session.service.ts`              | `@OnJob({ name: JobName.UploadSessionCleanup, queue: QueueName.BackgroundTask })`, wrapped in `withLock(DatabaseLock.UploadSessionCleanup, ...)` |

The fork already added `SharedSpaceAlbumGrantReconcileSweep` to that same block, so this is a paid-for pattern.

The sweep walks the upload folder for `*.session.json` older than `UPLOAD_SESSION_TTL` (24 h) and deletes the sidecar and its data file. Grouping it under `nightlyTasks.databaseCleanup` matches the existing all-maintenance-off admin contract.

### 5.8 Capability advertisement

One integer, on the DTO clients already fetch:

- `server/src/dtos/server.dto.ts:114` `ServerConfigSchema` gains `uploadChunkSize: z.int().describe('Chunk size in bytes for resumable uploads; 0 if unsupported')`.
- `server/src/services/server.service.ts:159` `getSystemConfig()` returns `UPLOAD_CHUNK_SIZE`.

`ServerConfigDto` already carries fork additions (`minFaces`, `availableMemoryTypes`), so this is in keeping.

One number does three jobs: it is the version gate (absent or `0` on an old server, so clients fall back to single-shot), the chunk size, and the threshold — a file is chunked when `size > uploadChunkSize`. No separate boolean, no separate threshold.

Default: **32 MiB**. Comfortably under Cloudflare's 100 MB, large enough that a 4 GB video is 128 chunks rather than thousands.

## 6. Client design — web and CLI

### 6.1 Web

New `web/src/lib/utils/chunked-upload.ts`:

- Creates the session through the generated SDK.
- Loops `PATCH` per chunk over `XMLHttpRequest` (not `fetch`) so `xhr.upload.onprogress` keeps working — this mirrors the existing `uploadRequest` in `web/src/lib/utils.ts`.
- Reports **globally monotonic** progress: `loaded = committedBytes + thisChunkLoaded`, `total = file.size`, so `uploadAssetsStore.updateProgress` semantics are unchanged.
- On chunk failure: `HEAD` to resync the offset, retry from there, up to N attempts with backoff.
- On abort: aborts the in-flight XHR **and** issues `DELETE` so the server session does not linger for the full TTL. Wires into the existing `trackUpload` mechanism.

`uploadRequest` is **not** rewritten — the new function sits beside it. `web/src/lib/utils.ts` takes 33 upstream commits a year; an added export conflicts far less than a changed one.

Callers:

- `web/src/lib/utils/file-uploader.ts:171` `fileUploader()` gains a threshold branch. The existing `hashFile` result (`:137`) is passed as the create call's `checksum`, so the duplicate shortcut now also covers large files.
- `web/src/lib/utils/google-takeout-uploader.ts` takes the same branch. Fork-only file, so zero rebase cost.

`uploadExecutionQueue` (concurrency 2, `file-uploader.ts:44`) is unchanged: chunks are sequential within a file, files remain concurrent.

### 6.2 CLI

`packages/cli/src/commands/asset.ts` gains `uploadFileChunked()` beside `uploadFile()`, selected by size against the fetched `uploadChunkSize`. Plain `fetch`, no XHR. The progress bar advances per chunk instead of per file, which is an improvement. Sidecars are carried on the create call (§8, case 27), preserving today's `findSidecar` behaviour.

## 7. Client design — mobile

### 7.1 The constraint that shapes it

`background_downloader`'s `UploadTask` hardcodes `allowPause: false` (`task.dart:924`, `:960`), so there is no native resumable upload. But it does support **binary uploads with a `Range` header** for partial uploads (`doc/uploads.md:38`) — `bytes=100-149` sends 50 bytes from offset 100, and the `Range` header is **not** forwarded to the server. `PATCH` is in `validHttpMethods` (`task.dart:31`).

The binding constraint: a binary `UploadTask` asserts `fields` is empty (`task.dart:917`). Mobile currently sends 8+ multipart fields (`background_upload.service.dart:394`). **This is why metadata had to move to a create call** — the protocol shape was dictated by the client, not chosen.

### 7.2 Foreground

`foreground_upload.service.dart` replaces `ProgressMultipartRequest` (`upload.repository.dart:153`) with a chunk loop, keeping the same `onProgress(bytes, totalBytes)` callback shape so everything upstream of it is untouched. The cancel token aborts the current chunk and issues `DELETE`.

### 7.3 Background — chunk chain

- Session created eagerly at enqueue time via the generated Dart client (ordinary HTTP; the app is alive at enqueue).
- One binary `UploadTask` per chunk from `buildUploadTask` (`background_upload.service.dart:372`), with `httpRequestMethod: 'PATCH'`, `post: 'binary'`, `fields` empty, and headers carrying `Upload-Offset`, `Content-Type: application/offset+octet-stream`, `Range: bytes=<start>-<end>`, plus the usual auth headers.
- `taskId: '<deviceAssetId>#<chunkIndex>'` keeps ids unique. **Every existing lookup keyed on a bare `deviceAssetId` must be swept at implementation time** — that is the highest-risk mechanical change in the whole feature.
- The existing `taskStatusCallback` registered in `UploadRepository` (`upload.repository.dart:23`) enqueues chunk k+1 when chunk k completes.
- `retries: 3` now applies per chunk, which is strictly better than per file.
- The final chunk's response body carries `AssetMediaResponseDto`, so the existing "asset created → id" handling and the live-photo two-step chain (`getLivePhotoUploadTask`, `:327`) keep working, just anchored to the last chunk instead of the only chunk.

### 7.4 Chain state, and restart survival for free

Chain state rides in the task's existing `metaData` field as JSON:

```json
{ "chunkCount": 128, "chunkIndex": 7, "deviceAssetId": "...", "sessionId": "..." }
```

`background_downloader` persists `metaData` in its own database, so the chain is reconstructible after an app restart **without a new Drift table**. On `FileDownloader().start()` — which `UploadRepository.start()` (`:65`) already calls — a reconciliation pass over `database.allRecords(group:)` finds any chain whose last chunk completed with no successor enqueued, and enqueues the next one.

This is why the earlier concern (a chunk sequence driven by in-memory Dart state would be _less_ reliable than today's single persisted `UploadTask`) does not materialise. The reconciliation pass is ~40 lines and is the only reason background chunking is not a reliability regression. **It is not optional.**

### 7.5 Progress

`providers/backup/asset_upload_progress.provider.dart` and `utils/upload_speed_calculator.dart` aggregate across chunks: `(chunkIndex * chunkSize + chunkLoaded) / totalSize`.

## 8. Edge cases

Every row is a required test (§9).

**Create**

| #   | Case                                    | Behaviour                                                                         |
| --- | --------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | No upload permission                    | 401/403 via the guard                                                             |
| 2   | Unsupported mime for `filename`         | 400, delegated to `canUploadFile`                                                 |
| 3   | `size <= 0`                             | 400                                                                               |
| 4   | `size` exceeds remaining quota          | 400, before any session exists                                                    |
| 5   | Open-session count or byte cap exceeded | 400                                                                               |
| 6   | `checksum` supplied and already known   | 200 `AssetMediaResponseDto` DUPLICATE, no session created, zero bytes transferred |
| 7   | `sidecar` present                       | stored in session state, written at finalize                                      |
| 8   | `sidecar` over 1 MiB                    | 400 (also bounded by the global `json({limit:'10mb'})` at `app.common.ts:58`)     |
| 43  | `sidecar` is not valid UTF-8            | 400 — XMP is XML text; binary content is rejected rather than written             |

**Patch**

| #   | Case                                                        | Behaviour                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | Unknown session id                                          | 404                                                                                                                                                                                                                 |
| 10  | Session belongs to another user                             | 404, not 403 — no id enumeration                                                                                                                                                                                    |
| 11  | Shared-link session, different link                         | 404                                                                                                                                                                                                                 |
| 12  | Missing `Upload-Offset`                                     | 400                                                                                                                                                                                                                 |
| 13  | Negative or non-integer `Upload-Offset`                     | 400                                                                                                                                                                                                                 |
| 14  | Wrong `Content-Type`                                        | 415                                                                                                                                                                                                                 |
| 15  | Offset ahead of committed                                   | 409 with actual offset                                                                                                                                                                                              |
| 16  | Offset behind committed (replay)                            | 409 with actual offset                                                                                                                                                                                              |
| 17  | Chunk would exceed `Upload-Length`                          | 400, nothing written                                                                                                                                                                                                |
| 18  | Zero-byte chunk                                             | 400, mirroring the existing "File is empty" check (`file-upload.interceptor.ts:133`)                                                                                                                                |
| 19  | Body longer than `Content-Length` claims                    | stream capped at `size - offset`; excess aborts the request with 400                                                                                                                                                |
| 20  | Two concurrent PATCHes at the same offset                   | Positional write makes it idempotent; the later one gets 409 once the first commits                                                                                                                                 |
| 21  | Two concurrent _final_ chunks                               | Exactly one wins the `unlink` claim; the loser gets 404                                                                                                                                                             |
| 22  | Declared checksum mismatch at finalize                      | 400, data file deleted                                                                                                                                                                                              |
| 23  | `livePhotoVideoId` invalid                                  | `onBeforeLink` throws inside `uploadAsset`; `handleUploadError` cleans up                                                                                                                                           |
| 24  | Quota consumed by other uploads between create and finalize | `uploadAsset`'s own `requireQuota` rejects; `handleUploadError` cleans up                                                                                                                                           |
| 25  | Disk full mid-write                                         | 500; session left on disk, swept by TTL                                                                                                                                                                             |
| 26  | Server restart mid-session                                  | Data + sidecar persist; `HEAD` reports the real on-disk offset; resumable within TTL                                                                                                                                |
| 27  | Session expired (TTL)                                       | 404 on the next PATCH                                                                                                                                                                                               |
| 44  | Auth _kind_ mismatch                                        | 404. The session records `sharedLinkId`; every PATCH must match **both** the user id and the shared-link id (both null, or both equal). A user-token session may not be continued with a shared link, or vice versa |
| 45  | Crash mid-`fd.write` leaves a partial chunk                 | Next PATCH gets 409 with the true on-disk offset; the client resumes from exactly there. No torn-chunk bookkeeping (§5.4 invariant)                                                                                 |
| 46  | `uploadChunkSize` changes under an in-flight upload         | Accepted. The server enforces no chunk size, so a deploy landing mid-upload does not break it (§5.4 invariant)                                                                                                      |
| 47  | Two clients upload byte-identical files concurrently        | Both finalize. The asset checksum constraint makes one a DUPLICATE via `handleUploadError`, which queues `FileDelete` for the loser's on-disk copy                                                                  |
| 48  | Admin lowers the user's quota mid-upload                    | Finalize's own `requireQuota` rejects; `handleUploadError` cleans up                                                                                                                                                |

**Delete / lifecycle**

| #   | Case                                | Behaviour                                                                        |
| --- | ----------------------------------- | -------------------------------------------------------------------------------- |
| 28  | `DELETE` unknown or foreign session | 404                                                                              |
| 29  | `DELETE` valid                      | 204; both files unlinked                                                         |
| 30  | Sweep                               | Sessions older than TTL removed; fresh ones untouched; runs under `DatabaseLock` |

**Parity**

| #   | Case                                               | Behaviour                                                                                         |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 31  | `visibility`, `isFavorite`, `metadata`, `duration` | Byte-for-byte identical asset row to a single-shot upload of the same bytes — asserted explicitly |

**Clients**

| #   | Case                                                                      | Behaviour                                                                                                                                             |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 32  | Server advertises `uploadChunkSize: 0` or omits it                        | All clients fall back to single-shot                                                                                                                  |
| 33  | File smaller than one chunk                                               | Single-shot; the session path is never entered                                                                                                        |
| 34  | Web: tab closed mid-upload                                                | Session orphaned, swept by TTL. Accepted under within-session-only                                                                                    |
| 35  | Web: source `File` becomes unreadable mid-upload                          | Chunk read throws; item marked error; session DELETEd                                                                                                 |
| 36  | Web: auth expires mid-upload                                              | 401 on a chunk; existing `authManager.authenticated` logout branch applies                                                                            |
| 37  | Web/mobile: abort                                                         | In-flight request cancelled **and** session DELETEd                                                                                                   |
| 38  | Mobile: `Range` rejected at enqueue on iOS (documented package behaviour) | Fall back to single-shot for that asset                                                                                                               |
| 39  | Mobile: source file deleted between chunks                                | Chunk task fails; session DELETEd; asset re-queued on a later backup run                                                                              |
| 40  | Mobile: app killed mid-chain                                              | Reconciliation on `start()` re-enqueues the next chunk (§7.4)                                                                                         |
| 41  | Mobile: chunk exhausts its retries                                        | Whole asset marked failed; session DELETEd                                                                                                            |
| 42  | Old client, new server                                                    | Existing `POST /assets` unchanged and still used                                                                                                      |
| 49  | Live photo where one of the pair is chunked and the other is not          | The video finalizes first; its id is passed as `livePhotoVideoId` on the image's create call. Ordering holds regardless of which path each file takes |

Cases 43–49 were added during spec review and are numbered by discovery order, not table order, so that §9's existing ranges stay valid.

## 9. Test plan (TDD)

**Every slice is written test-first**, one edge case at a time:

1. Write one failing test for one row of §8.
2. Run it. **Confirm it fails for the reason the row describes** — not because of a typo, a missing import, or an unrelated throw. A test that fails for the wrong reason proves nothing.
3. Implement the smallest change that makes it pass.
4. Re-run the whole file before moving to the next row.

Never write the implementation first and backfill tests against it: a test written against existing behaviour asserts what the code does, not what it should do, and every one of §8's 49 rows is a case where those differ.

Three project-specific honesty rules apply, each corresponding to a way tests in this repo have silently passed before:

- **Web:** assert on call arguments, not merely on absence. A `queryBy`-style assertion that passes whether or not the code ran is not a test. Note that vitest here leaks mock _implementations_ between tests, not call history — so a stubbed return from an earlier test can satisfy a later one.
- **Mobile:** prove each test red by flipping the behaviour under test before implementing. Mobile widget tests false-green easily. Also note `dart analyze` is not a substitute for `flutter test` — generated-code compile errors only surface when a test actually compiles.
- **Server:** a green `tsc` means nothing on a re-key. The chunked path re-keys the upload flow onto a new DTO shape (§4.3), which is exactly the situation where type-checking passes and runtime validation rejects every request.

**Coverage rule:** every row of §8 maps to at least one named test below. A row with no test is a row that will regress.

### 9.1 Server unit — `server/src/services/upload-session.service.spec.ts`

Via `newTestService(UploadSessionService)`. Covers edge cases **1–24, 27–30, 43, 44, 46, 48**. Cases 25, 26, 45 and 47 need a real filesystem and are covered in §9.2. No new repository, so no `newTestService` change is required.

Case 44 (auth-kind mismatch) needs all four combinations asserted, not two: user-session/user-patch and link-session/link-patch succeed; user-session/link-patch and link-session/user-patch both 404. Testing only the two failing directions would pass against an implementation that rejects everything.

Additionally `server/src/controllers/upload-session.controller.spec.ts`, following the `controllerSetup` + `mockBaseService` + supertest convention of `asset-media.controller.spec.ts`:

- unauthenticated → 401 on all four routes;
- each route resolves to `UploadSessionController` and not to `AssetController`'s `:id` handlers (§5.2) — assert on `HEAD` specifically, since Express resolves it against `GET` handlers;
- DTO validation rejects a malformed create body, **including** a body that would have been valid under the multipart schema: `isFavorite: "false"` as a string and `metadata` as a JSON string must both be rejected (§4.3).

### 9.2 Server medium — `server/test/medium/specs/services/upload-session.service.spec.ts`

Real filesystem, no mocks. These are the tests that would catch a wrong `fd.write` offset, which unit tests with a mocked storage repository cannot. Covers cases **25, 26, 45, 47** plus the three §5.4 invariants:

- A 3-chunk round trip produces a file **byte-identical** to a single-shot upload of the same bytes.
- A replayed middle chunk leaves the file byte-identical (idempotence).
- After a simulated crash, `HEAD` reports the true on-disk size (case 26).
- A truncated write leaves the file short, and the next `PATCH` 409s with the true offset (case 45).
- Two concurrent finalisers create exactly one asset (case 21 at the FS level).
- Two byte-identical concurrent uploads yield one asset and one DUPLICATE, and **the loser's file is gone from the upload folder afterwards** (case 47). Asserting only the DUPLICATE response would miss the leak.
- **No sparse file is ever produced** — assert the on-disk block count matches the byte count after a full round trip. This is the only direct test of the invariant that rule 3 protects; without it, relaxing rule 3 to `offset <= size` would pass every other test in this file.
- Chunks of unequal size (e.g. 10 MiB, then 1 MiB, then 10 MiB) complete successfully (case 46).

### 9.3 Web — `web/src/lib/utils/chunked-upload.spec.ts`

Covers 32–37, plus: correct chunk count and offsets for a given size; monotonic aggregated progress; retry after a `HEAD` resync; give-up after N retries surfaces the error; identical `visibility`/`isFavorite`/`metadata` to the single-shot path.

`web/src/lib/utils/file-uploader.spec.ts` gains threshold-routing tests (below → single-shot, above → chunked). It is currently 72 lines, so this roughly triples it.

### 9.4 CLI — `packages/cli/src/commands/asset.spec.ts`

Large file → create + N parts; small file → single-shot; old server → single-shot; sidecar carried on create.

### 9.5 Mobile — `mobile/test/services/`

Both target files already have tests (`background_upload.service_test.dart`, 406 lines; `foreground_upload.service_test.dart`, 200 lines).

- Chunk task built with `PATCH`, `post: 'binary'`, **empty `fields`**, and correct `Range` + `Upload-Offset` headers.
- `taskId` format, and no residual bare-`deviceAssetId` lookups.
- `metaData` carries the chain state.
- Status callback enqueues chunk k+1 on completion of k.
- Final chunk response parses into `remoteAssetId`.
- Failure path issues `DELETE`.
- Restart reconciliation enqueues the correct next chunk (case 40).
- Fallback when the server advertises `0` (case 32) and when `Range` enqueue fails (case 38).
- Progress aggregation across chunks.
- Live-photo pairing where the video is chunked and the still is not, **and the reverse** (case 49). Both directions are needed: an implementation that only ever chunks the larger file would pass the first and fail the second.
- Source file deleted between chunks issues `DELETE` and does not leave the asset half-created (case 39).

### 9.6 e2e

`e2e/src/utils.ts:407` `createAsset` already takes an `options` argument (`{ allowDuplicate?: boolean }`); extend it with `chunked?: boolean`. It already returns `AssetMediaResponseDto`, which the final `PATCH` also returns, so the chunked path drops in with no signature change for callers.

Rather than "a slice of the suite", name the specs that run both ways — chosen because each exercises a distinct part of the post-upload pipeline that the chunked path must not disturb:

| Spec                                               | What it proves survives chunking        |
| -------------------------------------------------- | --------------------------------------- |
| `e2e/src/specs/server/api/asset.e2e-spec.ts`       | Core asset creation, dedupe, trash      |
| `e2e/src/specs/server/api/shared-link.e2e-spec.ts` | Shared-link upload auth (cases 11, 44)  |
| `e2e/src/specs/server/cli/upload.e2e-spec.ts`      | CLI path end to end, including sidecars |
| `e2e/src/specs/server/api/video-trim.e2e-spec.ts`  | A genuinely large-media path            |

Note the chunked variant must force chunking on small fixtures — otherwise every case falls below the threshold and the flag silently tests nothing. Drive it by lowering `uploadChunkSize` for the e2e server, not by generating large fixtures.

New `e2e/src/specs/server/api/chunked-upload.e2e-spec.ts`: happy path, offset mismatch, abort, expiry, quota rejection at create, duplicate-by-checksum at create, sidecar, shared-link upload, cross-user 404, and the auth-kind mismatch matrix (case 44).

### 9.7 Coverage map

The §9 coverage rule is only meaningful if it can be checked. Every row of §8 appears here exactly once:

| §8 rows        | Covered by                                                                         |
| -------------- | ---------------------------------------------------------------------------------- |
| 1–24           | §9.1 server unit                                                                   |
| 25, 26         | §9.2 server medium (need a real filesystem)                                        |
| 27–30          | §9.1 server unit                                                                   |
| 31             | §9.6 e2e — the both-ways parity table                                              |
| 32, 33         | §9.3 web, §9.4 CLI, §9.5 mobile (once per client; see §12)                         |
| 34–36          | §9.3 web                                                                           |
| 37             | §9.3 web, §9.5 mobile foreground                                                   |
| 38–41          | §9.5 mobile                                                                        |
| 42             | §9.6 — the **existing** e2e suite passing unmodified is the assertion; no new test |
| 43, 44, 46, 48 | §9.1 server unit                                                                   |
| 45, 47         | §9.2 server medium                                                                 |
| 49             | §9.5 mobile                                                                        |

Case 42 is the one row with no dedicated test, deliberately: "the old multipart endpoint still works" is asserted by the whole pre-existing suite continuing to pass. If that suite is ever run only in chunked mode, case 42 loses its cover — which is why §9.6 runs the named specs **both** ways rather than switching them over.

## 10. Divergence ledger

The risk in this fork is not textual conflicts; it is upstream refactoring something the fork calls, merging cleanly, and breaking silently. So the number that matters is the coupling surface.

**Contracts this feature depends on, and their upstream churn over 12 months:**

| Contract                                                  | Upstream commits        |
| --------------------------------------------------------- | ----------------------- |
| `AssetMediaService.uploadAsset()` signature               | 1                       |
| `UploadFile` type (`server/src/types.ts:666`)             | 0                       |
| `canUploadFile` / `getUploadFilename` / `getUploadFolder` | 2 (both small bugfixes) |

These are among the most stable seams in the codebase, even though the files around them churn.

**Where the code lands:**

| Category                                                                                                                                                     | Production LOC | Conflict exposure                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New files (4 server, 1 web)                                                                                                                                  | ~770           | None                                                                                                                                                    |
| Union/registry one-liners (14 lines across `enum.ts`, `types.ts`, `queue.service.ts`, both `index.ts`, `server.dto.ts`, `server.service.ts`, `constants.ts`) | ~14            | Trivial, mechanical                                                                                                                                     |
| `web/src/lib/utils.ts`, `file-uploader.ts`, `google-takeout-uploader.ts`                                                                                     | ~45            | Moderate (33 and 18 upstream commits/yr; the takeout uploader is fork-only and free)                                                                    |
| `packages/cli/src/commands/asset.ts`                                                                                                                         | ~95            | Low (4 upstream commits/yr)                                                                                                                             |
| `mobile/.../upload.repository.dart`, progress providers                                                                                                      | ~195           | Low–moderate (8 upstream commits/yr on the repository)                                                                                                  |
| `mobile/.../background_upload.service.dart`, `foreground_upload.service.dart`                                                                                | ~380           | **High** (19 and 21 upstream commits/yr; `foreground_upload.service.dart` currently has zero fork edits, so this creates a new permanent conflict site) |

Totals to ~1,495 production lines. **~530 of those land in files upstream touches more than fifteen times a year, and 380 of the 530 are the two mobile upload services.** A further ~195 land in mobile files upstream touches less often. That is the recurring tax, and it was accepted knowingly.

Explicitly avoided: `server/src/middleware/file-upload.interceptor.ts` is **byte-identical to `upstream/main`** and is not touched. Nor is `app.common.ts` — `json({limit:'10mb'})` at line 58 is content-type gated, so an `application/offset+octet-stream` body streams through untouched.

## 11. Size estimate

| Area              | Total LOC  | Of which test |
| ----------------- | ---------- | ------------- |
| Server            | ~1,070     | ~480          |
| Web               | ~415       | ~180          |
| CLI               | ~175       | ~80           |
| Mobile            | ~865       | ~290          |
| e2e / docs / i18n | ~450       | ~270 (e2e)    |
| **Total**         | **~2,975** | **~1,300**    |

Of the ~1,675 non-test lines, ~180 are documentation and i18n, leaving **~1,495 production lines** — the figure §10 apportions.

Revised upward from ~2,825 during spec review: the seven edge cases added in review (43–49), their tests, the sparse-file and unequal-chunk medium tests, the auth-kind matrix, and the separate create schema in §4.3 all add test and DTO code. Production lines are unchanged; the growth is almost entirely test.

Generated OpenAPI spec, TypeScript SDK and Dart client output is on top of this but is regenerated, not written.

These are estimates from the existing files' shape, not measurements. For calibration: `server/src/services/asset-media.service.spec.ts` is 1,636 lines, `mobile/test/services/background_upload.service_test.dart` is 406, `packages/cli/src/commands/asset.spec.ts` is 431, and `web/src/lib/utils/file-uploader.spec.ts` is 72.

## 12. Implementation slices

Each slice is independently shippable. Every slice follows the same loop, and **a slice is not done until the last step passes**:

- Write the §9 tests for that slice's §8 rows. Run them; confirm each fails for the reason the row states.
- Implement until green.
- Run the full suite for the touched package, not just the new file.
- Re-check the §8 rows assigned to the slice. Any row without a passing named test blocks the slice.

| #   | Slice                         | §8 rows covered         | Notes                                                                                                                                                                                                 |
| --- | ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Server protocol, disk only    | 1–29, 43–48             | Store util, service, DTOs (§4.3 — the create schema is **new**, not a reuse), controller, unit + controller + medium specs. No cleanup job, no capability flag                                        |
| 2   | Cleanup job + capability flag | 30                      | `UploadSessionCleanup` and `uploadChunkSize` on `ServerConfigDto`. OpenAPI regen                                                                                                                      |
| 3   | e2e                           | 31 + the parity matrix  | `createAsset` gains `chunked`; new chunked-upload spec. The slice that proves parity with single-shot                                                                                                 |
| 4   | Web                           | 32–37                   | `chunked-upload.ts` plus threshold routing in both uploaders                                                                                                                                          |
| 5   | CLI                           | 32, 33 (CLI variants)   | `uploadFileChunked()` beside `uploadFile()`                                                                                                                                                           |
| 6   | Mobile foreground             | 37 (foreground variant) | Chunk loop replacing `ProgressMultipartRequest`                                                                                                                                                       |
| 7   | Mobile background             | 38–42, 49               | Chunk chain, `metaData` state, the `deviceAssetId` keying sweep, progress aggregation, restart reconciliation. Largest and riskiest — deliberately last, behind six slices of proven server behaviour |
| 8   | Docs                          | —                       | `docs/docs/administration/reverse-proxy.md`, `docs/docs/FAQ.mdx:104` (the Cloudflare note changes meaning), a feature page, and i18n across all nine maintained locales                               |

All 49 rows of §8 are covered above, with no gaps — that is the check that no edge case falls between slices. Rows 32, 33 and 37 are client-generic and deliberately recur in slices 4, 5 and 6: each client needs its own test of the same behaviour, and a shared assertion in one of them would not catch a regression in the others.

## 13. Deferred

- Restart-resume as a deliberate, UI-visible client feature (web IndexedDB, mobile Drift).
- Admin- or env-configurable chunk size.
- Parallel chunks within one file.
- Full tus compliance and third-party client support.
- Chunked upload for profile images and database-backup restore, which share `FileUploadInterceptor` but are not size-constrained in the same way.
