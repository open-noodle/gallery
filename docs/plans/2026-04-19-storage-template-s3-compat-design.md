# Storage Template S3 Compatibility — Design

## Overview

Issue [#383](https://github.com/open-noodle/gallery/issues/383) reported ENOENT errors on S3 deployments when the storage-template migration job tried to `fs.rename` an S3 relative key (`upload/uuid/4e/e6/file.jpg`) onto an absolute disk path. The `fix/s3-storage-move` branch adds `isAbsolute()` skip guards at five call sites to prevent this. This design captures:

1. One remaining production-code gap of the same bug class, surfaced during review (`MediaService.handleQueueMigration` unguarded `removeEmptyDirs`).
2. Unit-test hardening for the existing skip paths (direct `moveFile` guard test, tightened bulk-S3 assertions).
3. Six new E2E phases covering the storage-template × S3 intersection. The existing harness (`e2e/src/storage-migration.ts`) has zero coverage of this area — the original bug would not have been caught by any test in the repo.

## Context: what the branch already ships

Already on `fix/s3-storage-move` (+81/−10):

| Location                          | Change                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage.core.ts:136`             | `isImmichPath` returns `false` for relative paths (fixes CWD-based `resolve()` false positive)                                                                                                                                        |
| `storage.core.ts:189`             | `moveFile` returns early for relative `oldPath` before `ensureFolders`, `move_history`, or any fs call                                                                                                                                |
| `storage-template.service.ts:229` | `moveAsset` skips relative paths + external assets + android-motion paths                                                                                                                                                             |
| `storage-template.service.ts:154` | `handleMigrationSingle` skips S3 still assets before the live-photo fan-out (still-is-S3 case). Mixed-backend cases (still disk / motion S3) are handled by the inner `moveAsset` guard composing correctly; see test addition below. |
| `storage-template.service.ts:213` | `handleMigration` bulk job guards `removeEmptyDirs(libraryFolder)` with a `checkFileExists` pre-check                                                                                                                                 |
| `media.service.ts:204`            | `handleAssetMigration` returns `JobStatus.Skipped` for relative `originalPath`                                                                                                                                                        |
| `person.service.ts:595`           | `handlePersonMigration` returns `JobStatus.Skipped` for relative or empty `thumbnailPath`                                                                                                                                             |
| `asset-job.repository.ts`         | `getForMigrationJob` now selects `originalPath` (required for the new guard)                                                                                                                                                          |

All guards are covered by unit tests in the same diff.

## In scope for this design

### 1. Production code: `handleQueueMigration` guard

Same bug class as #383, different job handler. `MediaService.handleQueueMigration` (`media.service.ts:162`) currently runs:

```ts
if (active === 1 && waiting === 0) {
  await this.storageCore.removeEmptyDirs(StorageFolder.Thumbnails);
  await this.storageCore.removeEmptyDirs(StorageFolder.EncodedVideo);
}
```

`StorageRepository.removeEmptyDirs` calls `fs.lstat(directory)` (`storage.repository.ts:164`) which throws `ENOENT` if the directory doesn't exist. On a pure-S3 deployment that has never written thumbnails or encoded videos locally, `/data/thumbs` and `/data/encoded-video` may not exist, failing the `FileMigrationQueueAll` job on its first run.

**Fix:** inline the same `checkFileExists` pre-check already used at `storage-template.service.ts:213`, switching the call site from the `storageCore` wrapper to the repository directly (consistent with that precedent):

```ts
if (active === 1 && waiting === 0) {
  for (const folder of [StorageFolder.Thumbnails, StorageFolder.EncodedVideo]) {
    const path = StorageCore.getBaseFolder(folder);
    if (await this.storageRepository.checkFileExists(path)) {
      await this.storageRepository.removeEmptyDirs(path);
    }
  }
}
```

This inlining makes the `StorageCore.removeEmptyDirs(folder)` wrapper unused (`media.service.ts:165-166` was its only caller). Delete the wrapper in the same change.

### 2. Unit test hardening

**`storage.core.spec.ts` — add `moveFile` describe block with direct guard test.**

Current spec only exercises static helpers. Add an instance-level test that constructs a `StorageCore` with mocked repositories and calls `moveFile` with a relative `oldPath`. Assert the guard fires before any side-effect:

```ts
describe('moveFile', () => {
  it('should skip when oldPath is relative (S3 key)', async () => {
    // StorageCore.create(...) with mocks
    await core.moveFile({
      entityId: 'asset-1',
      pathType: AssetPathType.Original,
      oldPath: 'upload/user/ab/cd/file.jpg',
      newPath: '/data/library/user/2021/file.jpg',
    });
    expect(mocks.storage.mkdirSync).not.toHaveBeenCalled();
    expect(mocks.move.getByEntity).not.toHaveBeenCalled();
    expect(mocks.move.create).not.toHaveBeenCalled();
    expect(mocks.storage.rename).not.toHaveBeenCalled();
  });
});
```

**`storage-template.service.spec.ts:650` — tighten bulk-S3-skip assertions.**

Add negative assertions that prove `moveAsset` short-circuits before entering `moveFile`:

```ts
expect(mocks.move.create).not.toHaveBeenCalled();
expect(mocks.storage.stat).not.toHaveBeenCalled();
```

**`storage-template.service.spec.ts` — add mixed-backend live-photo test (new).**

Close the one untested composition: still asset absolute (disk), motion video relative (S3). The still should be migrated; the motion's own `moveAsset` guard should skip it. Asserts the inner guard does the work when the outer `handleMigrationSingle` guard doesn't catch the mixed case:

```ts
it('should migrate a disk still and skip an S3 motion video', async () => {
  const motion = AssetFactory.from({
    type: AssetType.Video,
    originalPath: 'upload/user/ab/cd/motion.mp4', // relative — on S3
  })
    .exif()
    .build();
  const still = AssetFactory.from({
    livePhotoVideoId: motion.id,
    originalPath: '/data/upload/user/ab/cd/still.jpg', // absolute — on disk
  })
    .exif()
    .build();

  mocks.user.get.mockResolvedValue(userStub.user1);
  mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(still));
  mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motion));

  await expect(sut.handleMigrationSingle({ id: still.id })).resolves.toBe(JobStatus.Success);
  expect(mocks.storage.rename).toHaveBeenCalledWith(still.originalPath, expect.any(String));
  expect(mocks.storage.rename).toHaveBeenCalledTimes(1); // motion skipped
});
```

**`media.service.spec.ts:285` — update `handleQueueMigration` tests for the new guard.**

The existing "removes empty dirs" test asserts `removeEmptyDirs` was called twice. With the new `checkFileExists` pre-check, that mock now needs to return `true` before the two calls fire. Add a new negative test where `checkFileExists` returns `false` and `removeEmptyDirs` is never called. Without these updates, the production-code fix fails its own unit suite.

### 3. E2E phases (six)

All new phases extend `e2e/src/storage-migration.ts` via its existing `phase` multiplexer. No new files, no helper extraction. Dropped from the initial outline: `template-s3-config-change-logs-clean` (template-disabled config edits can't trigger the bug class — the `!enabled` check at `handleMigrationSingle:145` short-circuits before any `isAbsolute` logic, so the phase would catch nothing).

#### Shared helpers to add to `storage-migration.ts`

```ts
export async function setStorageTemplate(token: string, opts: { enabled?: boolean; template?: string }): Promise<void> {
  // GET full config, mutate storageTemplate subtree, PUT (endpoint replaces whole config)
}

export async function triggerQueueCommand(token: string, queueName: string): Promise<void> {
  // PUT /jobs/:name { command: 'start' } — one wrapper used by two phases
}

export async function countMoveHistory(assetId?: string): Promise<number> {
  const q = assetId
    ? 'SELECT COUNT(*)::int c FROM move_history WHERE "entityId" = $1'
    : 'SELECT COUNT(*)::int c FROM move_history';
  const rows = await queryDb<{ c: number }>(q, assetId ? [assetId] : []);
  return rows[0].c;
}

export function captureContainerLogsSince(service: string, sinceMs: number): string {
  // docker compose `--since` accepts ISO-8601 or relative durations (e.g. "42s"),
  // NOT raw epoch seconds. Compute elapsed-seconds as a relative duration.
  // MyConsoleLogger defaults to non-JSON output; substring matches work in JSON mode too
  // (the warning message appears verbatim in the `message` field).
  const elapsedSec = Math.max(1, Math.ceil((Date.now() - sinceMs) / 1000));
  return execSync(`${COMPOSE} logs --since ${elapsedSec}s --no-color ${service}`, {
    cwd: E2E_DIR,
    timeout: 30_000,
    encoding: 'utf8',
  });
}

export function assertNoMoveEnoent(logs: string, phaseTag: string): void {
  const bad = logs.split('\n').filter((l) => l.includes('Unable to complete move') || /ENOENT.*rename/.test(l));
  assert.equal(bad.length, 0, `[${phaseTag}] unexpected ENOENT/move warnings:\n${bad.join('\n')}`);
}
```

`assertNoMoveEnoent` is a secondary signal. Structural invariants (paths unchanged, MinIO keys intact, `move_history` count stable) are the primary signal.

#### Phase specifications

Each phase follows the pattern:

1. **Invariant reset** — `setStorageTemplate(token, { enabled: false })` as the first action. Guards against prior-phase crash-before-teardown (e.g., SIGKILL or throw-in-finally).
2. Capture start time (`Date.now()`).
3. Capture `preMoveHistoryCount = countMoveHistory()` (baseline for delta assertions).
4. Precondition assertions (state matches phase's documented precondition).
5. Setup (config change, uploads).
6. Trigger (job or config event).
7. `waitForProcessing(token)`.
8. Structural assertions — compare `countMoveHistory()` against `preMoveHistoryCount` rather than asserting `=== 0` (prior phases may have left legitimate rows; `cleanMoveHistory` only removes orphans of deleted assets).
9. Log-scrape via `assertNoMoveEnoent(logs, phaseTag)`.
10. Teardown in `finally` (restore default config). Not load-bearing — invariant reset at step 1 is the actual safety net.

**`template-s3-bulk-skipped`** _(backend=s3, runs after `migrate-to-s3`)_

- Capture `captureState()` as pre-state (all paths relative).
- `setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MM}}/{{filename}}' })`.
- `triggerQueueCommand(token, 'storageTemplateMigration')` → wait.
- Assert every asset's `originalPath` unchanged, MinIO keys unchanged, `countMoveHistory()` equals the baseline captured in step 3.
- `assertNoMoveEnoent`.
- Teardown: `setStorageTemplate(token, { enabled: false })`.

**`template-s3-upload-skipped`** _(backend=s3)_

- `setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MMMM}}/{{filename}}' })`.
- Upload a fresh PNG → capture `newAssetId` → `waitForProcessing` (drains metadata extraction + single-migration job).
- Assert DB `originalPath` starts with `upload/{userId}/…`, MinIO object exists there, `countMoveHistory(newAssetId) === 0`, no ENOENT warnings.
- Teardown: disable template.

**`template-s3-live-photo-skipped`** _(backend=s3)_

- Upload a motion MP4 → capture `motionId`.
- Upload a PNG with `livePhotoVideoId: motionId` form field (extend the existing `uploadAsset` helper to accept arbitrary form fields; the field is already valid per `asset-media.dto.ts:75`).
- Enable template, wait for processing.
- Both `originalPath`s begin with `upload/…`; both `countMoveHistory(id) === 0`; no ENOENT.
- Teardown: disable template.

**`template-s3-sidecar-skipped`** _(backend=s3, reuses the sidecar asset from `setup`)_

- Query `asset_file` row where `assetId = sidecarAssetId AND type = 'sidecar'` — capture path.
- Enable template with a different preset.
- Trigger bulk migration, wait.
- Assert sidecar path unchanged, asset `originalPath` unchanged, `countMoveHistory(sidecarAssetId) === 0`, no ENOENT.
- Teardown: disable template.

**`template-s3-queue-migration-skipped`** _(backend=s3)_

- GET system config; capture current `image.thumbnail.format`.
- Flip to the other value (webp↔jpeg); PUT config.
- `triggerQueueCommand(token, 'migration')` → wait.
- Assert `asset_file.path` rows for `type='thumbnail'` unchanged (still point at the PRE-flip extension, e.g., `thumbs/…/*_thumbnail.webp` even though config now advertises jpeg). This is intended: `handleAssetMigration` skips S3 assets, so the DB path stays on the old extension and the thumbnail would be rewritten only on the next regeneration. Not a bug under this fix.
- Assert `person.thumbnailPath` unchanged.
- `assertNoMoveEnoent` — **this is the primary catch for the `handleQueueMigration` `removeEmptyDirs` ENOENT**. Without the production-code fix above, this phase fails.
- Teardown: restore original thumbnail format.

**`template-disk-baseline`** _(backend=disk, runs LAST, standalone)_

- Regression guard that the template feature still works end-to-end on disk.
- Reuses the post-rollback disk restart added below.
- **Upload path format for reference:** uploads land at `<mediaLocation>/upload/<userUuid>/<uuid0..2>/<uuid2..4>/<uuid>.<ext>` (see `AssetMediaService.getUploadFolder` → `StorageCore.getNestedFolder(StorageFolder.Upload, user.id, file.uuid)`). The path uses `userId` (UUID), NOT `storageLabel`. Only the _library_ path (template destination) uses `storageLabel`.
- Set `storageLabel='admin'` on the admin user via `PUT /users/me` or direct DB update so the _library_ path component is predictable — without this, the library path contains the admin UUID (unstable across runs).
- Before migration: capture pre-state via `captureState()` so pre-migration paths are known for delta assertions; capture `preMoveHistoryCount = countMoveHistory()`.
- Enable template with `{{y}}/{{y}}-{{MM}}-{{dd}}/{{filename}}`, trigger bulk migration, wait.
- Assert admin asset new `originalPath` matches `/usr/src/app/upload/library/admin/YYYY/YYYY-MM-DD/…` (library folder + storageLabel + template).
- Assert each captured pre-migration upload path no longer exists on disk, and the corresponding new path does exist. Do not hardcode `upload/admin/…` — pre-state paths contain the user UUID.
- Assert sidecar followed to `${newPath}.xmp`.
- Assert `countMoveHistory()` equals `preMoveHistoryCount` (each successful move deletes its own row via `moveRepository.delete` at `storage.core.ts:262`; count should return to baseline even if prior phases left legitimate rows).
- No teardown needed — last phase.

### 4. Workflow wiring

`.github/workflows/storage-migration-tests.yml`:

**Phase group 2 (backend=s3) — insert after `migrate-to-s3` and before `no-files`:**

```yaml
- name: 'Phase: template-s3-bulk-skipped'
  run: pnpm tsx src/storage-migration.ts template-s3-bulk-skipped
- name: 'Phase: template-s3-upload-skipped'
  run: pnpm tsx src/storage-migration.ts template-s3-upload-skipped
- name: 'Phase: template-s3-live-photo-skipped'
  run: pnpm tsx src/storage-migration.ts template-s3-live-photo-skipped
- name: 'Phase: template-s3-sidecar-skipped'
  run: pnpm tsx src/storage-migration.ts template-s3-sidecar-skipped
- name: 'Phase: template-s3-queue-migration-skipped'
  run: pnpm tsx src/storage-migration.ts template-s3-queue-migration-skipped
```

**New trailing group — after `rollback`, restart server on disk, run disk baseline:**

```yaml
- name: Restart server (backend=disk, post-rollback)
  run: |
    IMMICH_STORAGE_BACKEND=disk \
    docker compose up -d --no-deps --force-recreate --wait --wait-timeout 120 immich-server

- name: 'Phase: template-disk-baseline'
  run: pnpm tsx src/storage-migration.ts template-disk-baseline
```

Raise `timeout-minutes` from 30 → 45.

## Out of scope

- **`template-mixed-disk-then-s3`** and **`template-s3-rollback-preserves-templated-paths`** — backend-swap phases excluded per the scope decision. They test downstream S3-migration behavior not directly affected by this fix. Candidate for a follow-up spec.
- **Stale `move_history` cleanup.** Pre-existing: failed pre-fix bulk runs left `move_history` rows with relative `oldPath` that now masquerade as "incomplete move" and block legitimate future migrations. Separate design if pursued; workaround today is `DELETE FROM move_history WHERE "oldPath" NOT LIKE '/%'`.
- **`AssetService.copySidecar` on S3 targets** (`asset.service.ts:345`). Adjacent concern surfaced during the code-path audit: `storageRepository.copyFile(src, '${targetAsset.originalPath}.xmp')` will create a file relative to CWD if `targetAsset.originalPath` is a relative S3 key. Different trigger path (asset duplication/stack creation, not storage template). Not addressed here; flagged for a follow-up audit.
- **Helper extraction into `storage-harness.ts`** (Approaches 2/3 from brainstorming).
- **Per-PR workflow trigger.** Retains existing nightly + `workflow_dispatch`.
- **API endpoint for manually triggering single-asset template migration.** Not needed; `AssetMetadataExtracted` is the trigger in production, and uploads exercise it.

## Data flow

```
User changes template config
  → ConfigUpdate event
  → Template recompiles in-memory
  → No file ops until the next AssetMetadataExtracted or manual bulk trigger

Upload asset (S3 backend)
  → POST /assets (object lands in MinIO under upload/{uuid}/…)
  → MetadataExtraction job
  → AssetMetadataExtracted event
  → StorageTemplateMigrationSingle queued
  → handleMigrationSingle:
    ├─ template disabled         → Skipped
    ├─ originalPath relative      → Skipped  [SHIP]
    └─ else → moveAsset → moveFile (redundant relative guard) [SHIP]

Admin triggers bulk migration (S3)
  → StorageTemplateMigration job
  → handleMigration:
    ├─ cleanMoveHistory (orphaned rows only)
    ├─ stream assets → moveAsset [relative → return] [SHIP]
    └─ removeEmptyDirs(libraryFolder) with pre-check [SHIP]

FileMigrationQueueAll (format change, S3)
  → handleQueueMigration:
    ├─ if idle: removeEmptyDirs(Thumbnails/EncodedVideo) [THIS DESIGN adds pre-check]
    ├─ stream assets → queue AssetFileMigration [relative → Skipped] [SHIP]
    └─ stream persons → queue PersonFileMigration [relative/empty → Skipped] [SHIP]
```

## Error handling

- Phase scripts use `try { … } finally { teardown(); }` so a failed assertion still restores template state.
- `waitForProcessing` is the existing 60s-timeout helper; no new polling logic.
- `assertNoMoveEnoent` is advisory — failures on log scrape alone would be a weak signal, so structural assertions are primary. Log-scrape catches silent regressions where a move happens but fails post-hoc.
- Phases that mutate global config (storage template, thumbnail format) restore the prior value in `finally` — subsequent phases inherit a known-clean state.

## Testing strategy and coverage matrix

| Path                                                         | Unit (now)   | Unit (new) | E2E (new)                |
| ------------------------------------------------------------ | ------------ | ---------- | ------------------------ |
| Bulk template migration S3 skip                              | ✓            | —          | ✓                        |
| Single template migration S3 skip                            | ✓            | —          | ✓                        |
| Live-photo fan-out S3 skip (both on S3)                      | ✓ (indirect) | —          | ✓                        |
| Live-photo mixed-backend (still disk / motion S3)            | —            | ✓ (new)    | —                        |
| Sidecar file S3 skip                                         | —            | —          | ✓                        |
| Asset file migration format-change S3 skip                   | ✓            | —          | ✓                        |
| Person file migration S3 skip                                | ✓            | —          | — (nightly cost skipped) |
| `moveFile` direct guard                                      | indirect     | ✓          | —                        |
| `handleQueueMigration` `checkFileExists` pre-check           | —            | ✓          | ✓                        |
| Template feature still works on disk (regression)            | ✓            | —          | ✓                        |
| Template rendering error recovery (`getTemplatePath` throws) | ✓ (:540)     | —          | —                        |
| `moveFile` EXDEV cross-filesystem copy fallback              | ✓ (:723)     | —          | —                        |

## Risk & cost

- **CI time:** +10–15 min to the nightly workflow (6 phases × ~1.5–2 min each, plus one extra disk restart). Well under the bumped 45-min `timeout-minutes`.
- **File size:** `storage-migration.ts` grows from ~1525 to ~1850 lines. Below the 2000-line threshold where splitting becomes compelling.
- **Log-scraping flakiness:** mitigated by using structural assertions as primary signal. `docker compose logs --since` takes a relative duration (`42s`), not epoch seconds — helper implementation reflects this.
- **Production-code change:** a single `checkFileExists` pre-check plus deletion of a now-unused `StorageCore.removeEmptyDirs` wrapper. Same pattern as the already-reviewed precedent in `handleMigration`. Low risk.
- **Helper additions:** `setStorageTemplate`, `triggerQueueCommand`, `countMoveHistory`, `captureContainerLogsSince`, `assertNoMoveEnoent`. All thin wrappers over existing primitives.
- **Crash resilience:** every S3 phase starts by resetting `storageTemplate.enabled = false` before any other action — protects against prior-phase crash-before-teardown bleeding state into the next phase.

## Self-review checkpoints

Verified before drafting:

- `livePhotoVideoId` is a valid form field (`asset-media.dto.ts:75`).
- `PUT /jobs/:name` with `{ command: 'start' }` is the queue trigger (`job.controller.ts:45`).
- `removeEmptyDirs` + `checkFileExists` both exist in `StorageRepository` (`storage.repository.ts:137, 162`).
- Phase ordering: `template-disk-baseline` runs last on its own disk restart, avoiding interaction with other phases.
- `StorageCore.removeEmptyDirs` wrapper has only one caller (`media.service.ts:165-166`). Safe to delete after inlining.

Applied from code-reviewer subagent feedback on the draft:

- `docker compose logs --since` takes a relative duration or ISO timestamp, NOT raw epoch seconds — helper rewritten.
- Existing `handleQueueMigration` unit test at `media.service.spec.ts:286` will break with the new pre-check — update it, plus add a negative test where `checkFileExists` returns `false`.
- `template-disk-baseline` path component is the user UUID by default (no `storageLabel` on admin); phase sets `storageLabel='admin'` explicitly for predictable _library_ assertions. Upload paths remain `upload/<userUuid>/…` regardless of `storageLabel` — documented inline in the phase.
- `countMoveHistory` assertions use pre/post delta instead of `=== 0` (prior phases may leave legitimate rows that `cleanMoveHistory` doesn't purge). Applied to `template-disk-baseline` too.
- `template-s3-queue-migration-skipped` expectation explicitly documented: DB path stays on pre-flip extension — intended skip behavior, not a latent bug.
- Dropped `template-s3-config-change-logs-clean` — cannot catch any bug in this fix's scope.
- Crash-resilience: every phase starts with an invariant-reset step rather than relying solely on `finally`.

Applied from post-commit review pass:

- Path assertion in `template-disk-baseline` originally read "Assert old `upload/admin/…` paths no longer exist on disk" — fixed. Upload paths use `userId` (UUID), not `storageLabel`. Corrected to "capture pre-migration paths, assert those specific strings no longer exist."
- Added unit test for mixed-backend live photo (still disk / motion S3) — closes the only untested composition in the guard graph. The outer `handleMigrationSingle` guard handles the still-S3/motion-disk case; the new test covers the reverse.
- Added `AssetService.copySidecar` (asset.service.ts:345) as a flagged follow-up in "Out of scope" — adjacent S3-relative-path concern surfaced during the code-path audit, different trigger path (asset duplication), not storage-template.
- Added existing-coverage rows to the matrix (template-render error recovery, EXDEV fallback) for completeness.
- Verified `QueueName.StorageTemplateMigration = 'storageTemplateMigration'` and `QueueName.Migration = 'migration'` — design's `triggerQueueCommand` strings match the enum exactly.
- Verified `AssetMediaService.getUploadFolder` produces `upload/<userId>/<uuid0..2>/<uuid2..4>/<uuid>.<ext>` — documented inline.
