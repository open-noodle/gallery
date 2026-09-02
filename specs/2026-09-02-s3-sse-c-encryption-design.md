# S3 Encryption at Rest via SSE-C

## Problem

Gallery's S3-compatible storage backend (`S3StorageBackend`) writes and reads objects in
plaintext as far as the app is concerned. Provider-side default bucket encryption (SSE-S3) may or
may not be enabled by the operator, and Gallery has no way to require or verify it — encryption
at rest today is entirely an infrastructure concern outside the app's control.

This adds an app-controlled option: **SSE-C** (Server-Side Encryption with Customer-provided
Keys). S3 still does the actual AES-256 encrypt/decrypt work — Gallery never implements a cipher
— but Gallery supplies and controls the key on every request, rather than trusting the bucket's
default encryption configuration.

## Why SSE-C and not app-managed envelope encryption

An earlier design considered implementing AES-256-GCM directly inside `S3StorageBackend` (encrypt
before `put`, decrypt after `get`/`downloadToTemp`). That approach was rejected in favor of SSE-C
because:

- No new cipher code, no IV/nonce/authTag schema migration on `asset_file`, no new dependency.
- S3 (or the S3-compatible provider) already implements SSE-C correctly; Gallery's job is limited
  to attaching three well-defined headers on the right commands.
- The chokepoint this needs to touch (`S3StorageBackend`) is exactly the same either way — see
  "Why this stays inside S3StorageBackend" below — so the SSE-C version does strictly less work
  for the same architectural insertion point.

## Why SSE-KMS is not implemented (yet)

SSE-KMS would avoid the redirect-mode restriction entirely (see below), because S3 needs no
special headers on `GetObject` for a KMS-encrypted object — decrypt authorization is via IAM/KMS
key policy on the credentials that signed the request, so a presigned URL just works. That makes
it strictly better for buckets on a provider with real KMS integration.

It isn't implemented here because most self-hosted S3-compatible targets Gallery is deployed
against (bare MinIO, Ceph RGW without a KMS backend, etc.) don't have a KMS to point at, whereas
SSE-C is a plain header-based feature nearly every S3-compatible implementation supports. The
config is shaped as a discriminated union (`S3SseConfig`) specifically so adding an `sse-kms`
variant later is a config-shape non-event — see `server/src/interfaces/storage-backend.interface.ts`.

## Decision: SSE-C inside `S3StorageBackend`, forced proxy serve mode

Three headers (`SSECustomerAlgorithm: AES256`, `SSECustomerKey`, `SSECustomerKeyMD5`), computed
once at construction from `IMMICH_S3_SSE_C_KEY`, are attached to every `put`, `get`
(`GetObjectCommand`), and `exists` (`HeadObjectCommand`) call. `deletePrefix`/`getPrefixUsage`
(list/delete metadata operations) and the `HeadBucket` startup health check do not need them —
they never touch object bytes.

### Why this stays inside `S3StorageBackend`

Nearly every service that touches file bytes (`ensureLocalFile`, `serveFromBackend`,
`persistFile`/`put`, `resolveBackendForKey`) already only sees the `StorageBackend` interface, not
the S3 SDK directly. Putting SSE-C headers inside the backend implementation means all of that
code needs zero changes. Three call sites bypass those chokepoints and call `backend.get()`/`put()`
directly (`download.service.ts`'s ZIP stream, `machine-learning.repository.ts`'s inference upload,
`storage-migration.service.ts`'s disk↔S3 copy) — all three still only call `get()`/`put()` on the
backend instance, so they inherit SSE-C transparently too.

Checksums (SHA-1, used for dedup) are computed during the initial multer upload to local disk,
before the S3 backend is ever invoked — see `file-upload.interceptor.ts`. Because encryption is
applied only inside the S3 backend's `put()`, dedup is completely unaffected.

### Why redirect serve mode is incompatible with SSE-C

`IMMICH_S3_SERVE_MODE=redirect` hands the browser a presigned `GetObject` URL and gets the Node
process out of the media byte path entirely (see `2026-05-02-s3-direct-media-delivery-design.md`,
written specifically to move *away* from proxying every byte through the API process for
stability reasons). A presigned URL only signs which headers must be present and their values as
part of the signature — it does not let a plain `<img>`/`<video>` browser fetch, or a bare
`ffprobe <url>` invocation, attach a custom header. S3 requires the SSE-C customer-key header on
every `GetObject` of an SSE-C object, so a redirect target would just serve ciphertext to
whatever's on the other end.

**Decision: hard-fail at startup**, not silent fallback. `StorageService.onBootstrap()` throws an
`ImmichStartupError` if `IMMICH_S3_SSE_MODE=sse-c` and `IMMICH_S3_SERVE_MODE=redirect` (the
default) are both set. The admin must explicitly set `IMMICH_S3_SERVE_MODE=proxy`. A silent
override was considered and rejected: a config value silently not doing what it says is worse
than an explicit failure with a clear remediation message, especially for a security-relevant
setting. This means **SSE-C reintroduces the exact class of production risk** the redirect-mode
change was built to eliminate (API-process-in-the-hot-byte-path saturation under fast-scroll
load) — this is an inherent tradeoff of the approach, not a bug, and is the primary reason SSE-C
should be opt-in rather than a default.

### `getProbeInput` / ffprobe fallback

`getProbeInput()` normally returns a short-TTL presigned URL so `ffprobe` can read an S3 original
without a full download. That URL has the same problem as redirect serving. `StorageBackend` now
exposes a `supportsReadableUrl: boolean` flag (`false` only for S3 with SSE-C active); when false,
`BaseService.getProbeInput()` falls back to the existing `ensureLocalFile`/`downloadToTemp`
bracket instead, at the cost of the skip-the-download optimization in that case only. No other
`ensureLocalFile` call site changes — they already download-to-temp unconditionally, and
`downloadToTemp` decrypts correctly today because it's built on `get()`.

## Existing-object migration (`storage-migration` job queue)

Turning on SSE-C does not retroactively encrypt objects already in the bucket, and — this is the
sharp edge — **enabling SSE-C headers on a bucket with pre-existing unencrypted objects breaks
reads of those objects**: S3 doesn't silently ignore SSE-C headers on an object that isn't SSE-C
encrypted, it errors, because sending decryption headers for a plaintext object is treated as a
mismatch rather than a no-op.

A new job type (`S3EnableEncryptionQueueAll` / `S3EnableEncryptionSingle`, running on the existing
`QueueName.StorageBackendMigration` queue) re-encrypts existing S3 objects in place, added to
`StorageMigrationService` alongside the existing disk↔S3 migration:

- **Mechanism**: `S3StorageBackend.reencryptInPlace(key)` issues a `CopyObjectCommand` with
  `CopySource` equal to the object's own key (a self-copy) and only *destination* SSE-C headers —
  no `CopySourceSSECustomerKey*` headers, since the source is assumed unencrypted. This happens
  entirely inside S3/the provider; Gallery's process never sees the bytes. This is why
  `reencryptInPlace` is used instead of the disk↔S3 migration's `get()`+`put()` pattern.
- **Key difference from disk↔S3 migration**: the object's key never changes, only its encryption
  state — there is no DB path column to update. `IStorageMigrationJob`'s "check if target path
  already exists" idempotency check doesn't apply here (the "target" and "source" are the same
  key). Instead, completion is tracked via the existing `storage_migration_log` table
  (`direction = 's3EnableEncryption'`, `oldPath = newPath = key`), because `reencryptInPlace`
  itself is not safely re-runnable against an object it has already encrypted — a second call
  would need `CopySourceSSECustomerKey*` headers this call deliberately omits, and would fail.
- **Deploy-order requirement**: `IMMICH_S3_SSE_MODE=sse-c` (and a valid 32-byte
  `IMMICH_S3_SSE_C_KEY`) must already be configured and the server restarted with that config
  *before* starting this migration job — the job re-encrypts using whatever key the running S3
  backend already holds. There is no separate "target key" parameter.
- **Rollback**: not implemented as a mirror job in this change. Because the key doesn't move, a
  rollback would need a second `CopyObjectCommand` with the key as *source* SSE-C headers and no
  destination encryption — structurally different from the existing path-swap `rollback()`, which
  assumes reverting means writing the old path back into the DB column. Left as a follow-up if
  actually needed; SSE-C is opt-in and reversible at the config level (unsetting
  `IMMICH_S3_SSE_MODE` stops *new* writes from being encrypted) even though already-migrated
  objects would need this follow-up work to read again without the key.

## Key management

`IMMICH_S3_SSE_C_KEY` is base64-encoded, must decode to exactly 32 raw bytes (AES-256), and is
validated at startup (`StorageService.onBootstrap`) rather than in the zod env schema, so the
error message can reference the env var by name directly (matching how the "S3 bucket configured
but backend isn't s3" check is also deferred past schema parsing).

**S3 never stores the SSE-C key** — losing it means permanently losing access to every object
encrypted with it. There is no recovery path. This is categorically different from a typical
misconfiguration and should be called out prominently in deployment docs, not just in this file.

No new secrets-storage mechanism was built for this key. It follows the existing `IMMICH_S3_*`
precedent (env var only, never DB-stored) rather than the `system_metadata` JSONB blob used for
SMTP/OAuth secrets — that blob has no field-level encryption and is admin-UI-editable, which would
be a worse fit for a value whose accidental loss is unrecoverable.

## Out of scope

- **SSE-KMS.** Config shape reserved (`S3SseConfig` discriminated union in
  `storage-backend.interface.ts`), zero implementation. See "Why SSE-KMS is not implemented" above.
- **Client-side / end-to-end encryption.** A fundamentally different, much larger design — the
  server would need to stop generating thumbnails/transcodes from plaintext, which touches the
  entire media pipeline, not just the storage backend.
- **Disk-backed storage.** SSE-C is an S3-protocol feature; `DiskStorageBackend` always reports
  `supportsReadableUrl: true` and is otherwise untouched.
- **External libraries.** Already out of scope for the S3 backend entirely (local disk paths,
  never copied into Gallery-managed storage) — see `2026-03-02-s3-storage-design.md` §9.
- **Rollback job for the enable-encryption migration.** See "Rollback" above.

## Files changed

- `server/src/dtos/env.dto.ts` — `IMMICH_S3_SSE_MODE`, `IMMICH_S3_SSE_C_KEY`
- `server/src/repositories/config.repository.ts` — parses/decodes the SSE-C key once at
  config-load time (`parseS3SseConfig`)
- `server/src/interfaces/storage-backend.interface.ts` — `S3SseConfig` discriminated union,
  `StorageBackend.supportsReadableUrl`
- `server/src/backends/s3-storage.backend.ts` — SSE-C headers on `put`/`get`/`exists`, forced
  proxy strategy in `getServeStrategy`, new `reencryptInPlace`
- `server/src/backends/disk-storage.backend.ts` — `supportsReadableUrl = true`
- `server/src/services/base.service.ts` — `getProbeInput` falls back to `ensureLocalFile` when
  `!supportsReadableUrl`
- `server/src/services/storage.service.ts` — startup validation (key length, redirect+SSE-C
  hard-fail)
- `server/src/repositories/storage-migration.repository.ts`,
  `server/src/services/storage-migration.service.ts`,
  `server/src/controllers/storage-migration.controller.ts`,
  `server/src/dtos/storage-migration.dto.ts` — enable-encryption-in-place migration
- `server/src/enum.ts`, `server/src/types.ts` — `JobName.S3EnableEncryption{QueueAll,Single}`
