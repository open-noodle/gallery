# S3-Relative Path Audit Fixes — Design

## Context

Gallery supports disk and S3 storage backends simultaneously. On S3, asset and file paths stored in the database are relative keys (e.g. `upload/<uuid>/a4/c2/<uuid>.MP4`). Code that passes these directly to local-FS or local-process operations (`fs.*`, `fluent-ffmpeg`, `exiftool-vendored`, `sharp`) resolves them against the process CWD and fails with `ENOENT`.

The repository already has an `ensureLocalFile(path)` helper that branches on `isAbsolute` — returning the path unchanged for disk, and `{ localPath: tempPath, cleanup }` via `StorageService.resolveBackendForKey(key).downloadToTemp(key)` for S3. Today it is duplicated verbatim in:

- `server/src/services/media.service.ts:80`
- `server/src/services/metadata.service.ts:184`

A second shared helper, `BaseService.serveFromBackend` (`server/src/services/base.service.ts:230-266`), already uses a lazy `StorageService` import to avoid the `BaseService ← StorageService ← BaseService` cycle. That pattern is the precedent for backend-aware helpers in `BaseService`.

Related already-fixed instances of the same bug class, for reference only: PR #323 (sidecar write wrote bogus `asset_file` rows on S3), PR #391 (storage-template migration jobs fed S3 keys to `fs.rename`).

## Bugs in scope

### 1. Issue #396 — video CLIP encoding fails on S3

`server/src/services/smart-info.service.ts:143 encodeVideoClip` passes `asset.originalPath` directly to `mediaRepository.probe` (line 146) and `mediaRepository.extractVideoFrames` (line 167). On S3 `asset.originalPath` is a relative key, so both ffmpeg-backed calls resolve against the worker's CWD and throw `ENOENT`.

Trigger: `JobName.SmartSearch` for video assets. Every video upload on an S3 instance with smart search enabled. Reporter is on v4.52.0 (current release).

### 2. `copySidecar` fails on S3

`server/src/services/asset.service.ts:313 copySidecar` calls `storageRepository.unlink(targetFile.path)` (line 327) and `storageRepository.copyFile(sourceFile.path, ...)` with destination `${targetAsset.originalPath}.xmp` (line 330). Both `storage.repository.ts` primitives call `fs.*` directly and throw on relative keys.

Trigger: `copyAssetProperties({ sidecar: true })`. Asset-duplicate/copy operation on an S3 backend. Flagged as an out-of-scope follow-up in the PR #391 commit message.

## Bugs explicitly out of scope

- Orphan S3 cleanup on user delete (`user.service.ts:286`); tracked separately.
- S3 coverage for ML calls (face detection, OCR, pet detection, image CLIP encoding). Already S3-aware via `MachineLearningRepository.getFormData` at `server/src/repositories/machine-learning.repository.ts:315-327`, which branches on `isAbsolute(imagePath)` and streams via `StorageService.resolveBackendForKey(...).get(...)`.
- `withLocalFile(fn)` ergonomics refactor. Keeping the current `{ localPath, cleanup }` shape.
- Renaming `storage-migration-tests.yml` to reflect broader S3 coverage.
- S3 download-hang on bulk selection (separate bug class — resource management, not path handling). Hypothesis: `download.service.ts` opens all S3 `Readable` streams upfront via `await backend.get(...)` in a sequential loop, leaving 149/150 sockets idle-but-held while `archiver` consumes one at a time, exhausting the S3 client socket pool and starving `serveMode: 'proxy'` thumbnail requests. Tracked in its own design (next iteration).

## Audited-safe-by-invariant

These paths work correctly today, but their correctness depends on invariants rather than guards. Documenting here so the audit coverage is explicit rather than implied:

- `server/src/services/asset-media.service.ts:345,347` — `storageRepository.utimes(...)` on upload-temp paths. Safe because NestJS/multer writes incoming uploads to local disk first; the S3 move (line 365) happens only after `utimes`. Implementation step: cite the multer disk-storage config (`server/src/middleware/file-upload.interceptor.ts` or equivalent) in the PR body so the invariant is checkable against a specific line, not a handwave.
- `server/src/services/asset-media.service.ts:361,371` — `createReadStream(...)` of upload-temp paths feeding into S3 `put`. Same invariant.

All other `mediaRepository.probe` / `.transcode` / `.extractFrame` / `.extractVideoFrames` callers are either wrapped via `ensureLocalFile` (media.service.ts, metadata.service.ts), operate on output paths known to be local (media.service.ts:323), or are gated by `StorageCore.isImmichPath` (asset.service.ts:662).

## Changes

### C1. Lift `ensureLocalFile` to `BaseService`

Add `protected async ensureLocalFile(filePath)` to `server/src/services/base.service.ts`. Implementation matches the two existing duplicates verbatim except for a lazy `StorageService` import (matching `serveFromBackend` at base.service.ts:230). The helper's docstring notes that `downloadToTemp` throws for missing remote files; callers decide whether to catch or propagate.

Remove the two duplicated private methods in `media.service.ts:80` and `metadata.service.ts:184`. All existing call sites already call `this.ensureLocalFile(...)` via service inheritance, so no call-site changes.

### C2. Fix issue #396 — smart-info video CLIP encoding

In `encodeVideoClip` (smart-info.service.ts:143), wrap the incoming `originalPath` with `ensureLocalFile` around the entire function body. Replace the two passes of `originalPath` into `probe` and `extractVideoFrames` with `localPath`. Cleanup in the outer `finally`. Error logs continue referencing the DB `originalPath` so operators can correlate failures to assets.

### C3. Fix `copySidecar` — route through `ensureLocalFile`, drop the redundant delete

In `copySidecar` (asset.service.ts:313):

- Remove the `storageRepository.unlink(targetFile.path)` call. The existing `targetFile.path`, when present, equals `${targetAsset.originalPath}.xmp` (because that's how metadata.service.ts:488 writes it), which is the same key the new copy writes to. `fs.copyFile` (disk) and `backend.put` (S3) both overwrite. Dropping the unlink is behaviorally equivalent to the old `unlink + copyFile` sequence and strictly safer on partial failure (no window where the asset is sidecar-less).
- Wrap `sourceFile.path` via `ensureLocalFile`.
- Branch once on the destination: `isAbsolute(targetSidecarPath)` → `storageCore.ensureFolders(target)` + `storageRepository.copyFile(localPath, target)`; otherwise → `StorageService.resolveBackendForKey(target).put(target, createReadStream(localPath), { contentType: 'application/xml' })`.
- Cleanup in `finally`.
- `upsertFile({ path: targetSidecarPath })` and queue `AssetExtractMetadata` unchanged.

Rationale for always routing through a local temp on S3→S3 (same backend): sidecars are <10KB, `copyAssetProperties` is a background admin op, and the single-destination-branch is materially simpler than a 4-way disk/S3 × src/dst matrix. If profiling later shows the extra round-trip matters, adding `backend.copy(src, dst)` as an optimization is a trivial follow-up.

## Testing

### Unit

- `server/src/services/base.service.spec.ts` — new coverage for `ensureLocalFile`:
  - Absolute path returns passthrough with no-op cleanup.
  - Relative path calls `StorageService.resolveBackendForKey(key).downloadToTemp(key)` and returns its `{ tempPath, cleanup }`; invoking the returned cleanup triggers the backend-side cleanup.
  - `StorageService.resolveBackendForKey` throws for an unknown backend prefix → error propagates, no cleanup leaked (nothing was captured yet).
  - `downloadToTemp` throws after the backend resolves → error propagates, no cleanup leaked.
- `server/src/services/smart-info.service.spec.ts` — extend the `handleEncodeClip` video case:
  - Relative `originalPath` → `ensureLocalFile` invoked; `probe` and `extractVideoFrames` receive the local temp path; cleanup called on the success path.
  - `probe` throws → inner catch returns `null` early; outer `finally` still runs cleanup.
  - `extractVideoFrames` throws → inner catch at smart-info.service.ts:168 returns `null`; outer `finally` still runs cleanup.
  - `machineLearningRepository.encodeImage` throws on a frame → inner catch at smart-info.service.ts:181 returns `null`; outer `finally` still runs cleanup.
  - Absolute `originalPath` (disk) → `ensureLocalFile` returns passthrough; behavior unchanged (regression guard for the non-S3 path).
- `server/src/services/asset.service.spec.ts` — `copySidecar` tests:
  - All 4 source/target backend combinations: disk→disk (regression guard; unchanged semantics but new code path), disk→S3, S3→disk, S3→S3.
  - **Target has an existing sidecar → the new copy overwrites it.** This is the headline behavioral change of this PR (no more unlink); assert content matches source in the overwrite case so a future accidental "empty put" regression is caught.
  - Target has no existing sidecar (`files: []`) → the `targetFile?.path` branch short-circuits cleanly, copy still succeeds.
  - Source has no sidecar → early return at asset.service.ts:322; no copy attempted, no cleanup needed.
  - Cleanup called on `put` / `copyFile` failure.
  - Source and target sidecar paths asserted distinct (documented as safe-by-invariant from the `copy` endpoint's `sourceId === targetId` rejection at asset.service.ts:269).
- Remove any `ensureLocalFile` tests from `media.service.spec.ts` / `metadata.service.spec.ts` if they exist; consolidated into the base service spec. (If no such tests exist today, this bullet is a no-op — verify during implementation.)

### Medium

None — no DB contract change.

### E2E

Two phases added to `e2e/src/storage-migration.ts` (the harness created by PR #391), wired into the existing workflow `.github/workflows/storage-migration-tests.yml` between current phases.

Both phases use the existing `waitForQueueFinish` helper from `e2e/src/utils.ts:741` and inline the `expect(asset.originalPath).not.toMatch(/^\//)` assertion consistent with the six existing sites in the file (lines 589, 618, 960, 1126, 1156, 1264). No new helpers extracted.

- **`phaseSmartSearchS3VideoClip`** — upload a video to S3, assert the resulting `originalPath` is a relative key (proves backend config), wait for the `SmartSearch` queue to drain, assert a `smart_search` row exists for the asset. Pre-fix: job throws `ENOENT`, no row. Post-fix: embedding persisted.
- **`phaseCopyAssetSidecarS3`** — upload a photo + XMP sidecar pair to S3, call the asset-copy endpoint with `sidecar: true`, assert the target has a `Sidecar` row in `asset_file` AND `backend.exists(target)` returns true AND the S3 object's size is > 0 (cheap content check so an accidental empty `put` doesn't silently pass).

### Manual smoke (pre-merge)

Via `/rc-personal` to Pierre's personal S3 instance:

- Upload a video; verify a `smart_search` row appears for the asset.
- Duplicate an asset with an XMP sidecar via the UI/API; verify the target sidecar exists in S3.

## Rollout

Single PR targeting main. No migration, no config, no backwards-compat shim. Reporter on #396 gets the fix in the release that ships after merge; @-mention the reporter in the PR body and ask them to confirm on their instance once the release is live.

Expected rough diff size: ≈400–600 LOC of production code and tests (excluding the E2E phase bodies, which add ≈100–200 more). If the implementation plan grows materially beyond this, re-scope before continuing.

## Risks

- **Lazy `StorageService` import in `BaseService`.** Blast radius shared with `serveFromBackend` (same file, same pattern). That helper has been stable. Risk is low.
- **Dropping the pre-copy unlink in `copySidecar`.** Changes delete semantics from "unlink-then-copy" to "overwrite-via-copy/put". For identical keys (always the case here) this is semantically equivalent and strictly safer on partial failure. The claim that no caller of `copyAssetProperties({ sidecar: true })` inspects filesystem state synchronously after return was reasoned from the call graph but not grep-verified at design time; implementation task 1 is to grep-verify and record the callers in the PR body before shipping.
