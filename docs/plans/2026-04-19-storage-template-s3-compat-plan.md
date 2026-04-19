# Storage Template S3 Compatibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close one remaining production-code gap from issue #383 (`MediaService.handleQueueMigration` unguarded `removeEmptyDirs`), harden unit tests for the existing skip guards, and add six nightly E2E phases that lock in the storage-template × S3 interaction.

**Architecture:** Three independent slices. Slice A patches the server (one `checkFileExists` pre-check + delete unused helper + unit test hardening); every server change is TDD. Slice B adds shared helpers to `e2e/src/storage-migration.ts` without new files. Slice C adds one phase per task, each self-contained, each registered in the existing phase dispatcher. Slice D wires the workflow YAML.

**Tech Stack:** NestJS 11, Vitest, Kysely, Docker Compose (MinIO), tsx, Playwright (unused here). Prettier+ESLint. All server tests go through `newTestService(Service)` in `server/test/utils.ts` — `{sut, mocks}` pairs with automocked repositories.

**Reference:** design doc at `docs/plans/2026-04-19-storage-template-s3-compat-design.md` (commits `0a865a712`, `3e17c10da`).

---

## Task 1: Direct `moveFile` relative-path guard test

**Files:**

- Modify: `server/src/cores/storage.core.spec.ts` (currently only tests static helpers)
- Reference: `server/test/utils.ts:285` (`getMocks()`)

**Step 1: Add the test**

Append a new `describe('moveFile', …)` block at the end of the outer `describe('StorageCore', …)`. This block instantiates a real `StorageCore` via the singleton factory, with the `getMocks()` pool, and asserts the guard short-circuits before any side-effect.

```ts
import { StorageCore } from 'src/cores/storage.core';
import { AssetFileType, AssetPathType, ImageFormat, StorageFolder } from 'src/enum';
// ... existing imports

// at bottom of the outer describe('StorageCore', () => { ... })

describe('moveFile', () => {
  let core: StorageCore;
  let mocks: ReturnType<typeof getMocks>;

  beforeEach(() => {
    StorageCore.reset();
    StorageCore.setMediaLocation('/data');
    mocks = getMocks();
    core = StorageCore.create(
      mocks.asset as any,
      mocks.config as any,
      mocks.crypto as any,
      mocks.move as any,
      mocks.person as any,
      mocks.storage as any,
      mocks.systemMetadata as any,
      mocks.logger as any,
    );
  });

  it('should skip when oldPath is a relative S3 key', async () => {
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

Add `import { getMocks } from 'test/utils';` at the top of the file.

**Step 2: Run — expect PASS on first run**

The production guard at `storage.core.ts:189` already exists. This test locks in that behavior.

```bash
cd server && pnpm test -- --run src/cores/storage.core.spec.ts
```

Expected: all existing tests pass; new `should skip when oldPath is a relative S3 key` passes.

**Step 3: Commit**

```bash
git add server/src/cores/storage.core.spec.ts
git commit -m "test(storage-core): add direct moveFile guard test for relative S3 keys"
```

---

## Task 2: Tighten bulk-S3 assertions in storage-template spec

**Files:**

- Modify: `server/src/services/storage-template.service.spec.ts` around line 650

**Step 1: Add two negative assertions to the existing `should skip S3 assets with relative paths during bulk migration` test**

Find the test at line ~650 and append:

```ts
expect(mocks.move.create).not.toHaveBeenCalled();
expect(mocks.storage.stat).not.toHaveBeenCalled();
```

**Step 2: Run — expect PASS**

```bash
cd server && pnpm test -- --run src/services/storage-template.service.spec.ts
```

Expected: all tests still pass. The new assertions prove `moveAsset` short-circuits at `storage-template.service.ts:229` before entering `moveFile` (where `move.create` and `storage.stat` would fire).

**Step 3: Commit**

```bash
git add server/src/services/storage-template.service.spec.ts
git commit -m "test(storage-template): tighten bulk-S3-skip to assert no moveFile side effects"
```

---

## Task 3: Mixed-backend live-photo unit test

**Files:**

- Modify: `server/src/services/storage-template.service.spec.ts` (add inside the existing `describe('handleMigrationSingle', …)` block)

**Step 1: Add the test**

Place near the existing "should skip S3 assets with relative paths" test (line ~113). Uses the same `AssetFactory`/`getForStorageTemplate` helpers already imported in this file.

```ts
it('should migrate a disk still photo and skip its S3 motion video', async () => {
  const motion = AssetFactory.from({
    type: AssetType.Video,
    originalPath: 'upload/user/ab/cd/motion.mp4', // relative — on S3
    fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
  })
    .exif()
    .build();
  const still = AssetFactory.from({
    livePhotoVideoId: motion.id,
    originalPath: '/data/upload/user/ab/cd/still.jpg', // absolute — on disk
    fileCreatedAt: new Date('2022-06-19T23:41:36.910Z'),
  })
    .exif()
    .build();

  mocks.user.get.mockResolvedValue(userStub.user1);
  mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(still));
  mocks.assetJob.getForStorageTemplateJob.mockResolvedValueOnce(getForStorageTemplate(motion));
  mocks.move.create.mockResolvedValue({
    id: 'move-1',
    entityId: still.id,
    pathType: AssetPathType.Original,
    oldPath: still.originalPath,
    newPath: `/data/library/${still.ownerId}/2022/2022-06-19/${still.originalFileName}`,
  });

  await expect(sut.handleMigrationSingle({ id: still.id })).resolves.toBe(JobStatus.Success);
  expect(mocks.storage.rename).toHaveBeenCalledTimes(1); // only the still
  expect(mocks.storage.rename).toHaveBeenCalledWith(still.originalPath, expect.any(String));
});
```

**Step 2: Run — expect PASS**

```bash
cd server && pnpm test -- --run src/services/storage-template.service.spec.ts
```

Expected: new test passes. Proves the composition of guards (`handleMigrationSingle` outer guard fires on still-S3 case; inner `moveAsset` guard fires on motion-S3 case when still is disk).

**Step 3: Commit**

```bash
git add server/src/services/storage-template.service.spec.ts
git commit -m "test(storage-template): cover mixed-backend live photo (still disk, motion S3)"
```

---

## Task 4: Production fix — guard `handleQueueMigration` removeEmptyDirs

This is the only real TDD task — red-first.

**Files:**

- Modify: `server/src/services/media.service.ts:162-167`
- Modify: `server/src/services/media.service.spec.ts` (around line 285)
- Modify: `server/src/cores/storage.core.ts` (delete `removeEmptyDirs` wrapper at lines 305-307)

**Step 1: Write failing negative test**

In `media.service.spec.ts`, find the `describe('handleQueueMigration', …)` block at line 285. Before the existing "removes empty dirs" test, add:

```ts
it('should skip removeEmptyDirs when storage folders do not exist (pure-S3 deployment)', async () => {
  mocks.job.getJobCounts.mockResolvedValue({ active: 1, waiting: 0 } as any);
  mocks.storage.checkFileExists.mockResolvedValue(false); // /data/thumbs, /data/encoded-video absent
  mocks.assetJob.streamForMigrationJob.mockReturnValue(makeStream([]));
  mocks.person.getAll.mockReturnValue(makeStream([]));

  await expect(sut.handleQueueMigration()).resolves.toBe(JobStatus.Success);

  expect(mocks.storage.checkFileExists).toHaveBeenCalledTimes(2);
  expect(mocks.storage.removeEmptyDirs).not.toHaveBeenCalled();
});
```

Also update the existing test that asserts `removeEmptyDirs` called twice — add a `checkFileExists` mock returning `true` so both calls fire. Find the test that reads `expect(mocks.storage.removeEmptyDirs).toHaveBeenCalledTimes(2)` near line 296 and add at its top:

```ts
mocks.storage.checkFileExists.mockResolvedValue(true);
```

**Step 2: Run — expect both the new test AND the existing test to FAIL**

```bash
cd server && pnpm test -- --run src/services/media.service.spec.ts -t "handleQueueMigration"
```

Expected: new "should skip removeEmptyDirs" test fails with `expected not to have been called, was called 2 times`. Existing positive test still passes (because `checkFileExists` isn't a gate yet). If the positive test fails unexpectedly, something else is wrong — investigate before proceeding.

**Step 3: Apply production fix**

Edit `server/src/services/media.service.ts` around line 164. Replace:

```ts
if (active === 1 && waiting === 0) {
  await this.storageCore.removeEmptyDirs(StorageFolder.Thumbnails);
  await this.storageCore.removeEmptyDirs(StorageFolder.EncodedVideo);
}
```

with:

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

If `StorageCore` is not already imported in this file, add `import { StorageCore } from 'src/cores/storage.core';` (grep confirms it's already imported via `ImagePathOptions, StorageCore, ThumbnailPathEntity`).

**Step 4: Delete the now-unused wrapper**

In `server/src/cores/storage.core.ts`, delete lines 305-307 (the `removeEmptyDirs(folder: StorageFolder)` method). It has no other callers (verified).

**Step 5: Run all three — expect PASS**

```bash
cd server && pnpm test -- --run src/services/media.service.spec.ts src/cores/storage.core.spec.ts
```

Expected: all tests pass. If `storage.core.spec.ts` has a test touching the deleted wrapper, update or remove it (grep before running: no such test exists).

**Step 6: Commit**

```bash
git add server/src/services/media.service.ts server/src/services/media.service.spec.ts server/src/cores/storage.core.ts
git commit -m "fix(server): guard handleQueueMigration removeEmptyDirs against missing S3-mode dirs

Pure-S3 deployments that never wrote thumbnails or encoded videos to disk
would hit ENOENT on fs.lstat when FileMigrationQueueAll kicks off the first
batch. Same bug class as #383; matches the handleMigration precedent of
checkFileExists before removeEmptyDirs. Wrapper StorageCore.removeEmptyDirs
deleted (single caller inlined)."
```

**Step 7: Full-suite sanity check after the deletion**

Removing the `StorageCore.removeEmptyDirs` wrapper could break any test that referenced it. Grep already confirmed no callers, but run the full server suite once to catch any latent reference:

```bash
cd server && pnpm test -- --run
```

Expected: all tests pass. If anything fails unexpectedly, inspect the failure before proceeding to E2E work.

---

## Task 5: Shared E2E helpers

**Files:**

- Modify: `e2e/src/storage-migration.ts` (add helpers near the other exports; no new file)

**Step 1: Add helpers**

Below the existing `waitForMigration` helper (around line 307), add:

```ts
export async function setStorageTemplate(token: string, opts: { enabled?: boolean; template?: string }): Promise<void> {
  const config = await api('GET', '/system-config', { token });
  if (opts.enabled !== undefined) {
    config.storageTemplate.enabled = opts.enabled;
  }
  if (opts.template !== undefined) {
    config.storageTemplate.template = opts.template;
  }
  await api('PUT', '/system-config', { body: config, token });
}

export async function triggerQueueCommand(token: string, queueName: string): Promise<void> {
  await api('PUT', `/jobs/${queueName}`, { body: { command: 'start' }, token });
}

export async function countMoveHistory(assetId?: string): Promise<number> {
  const rows = assetId
    ? await queryDb<{ c: string }>('SELECT COUNT(*)::text c FROM move_history WHERE "entityId" = $1', [assetId])
    : await queryDb<{ c: string }>('SELECT COUNT(*)::text c FROM move_history');
  return Number(rows[0].c);
}

export function captureContainerLogsSince(service: string, sinceMs: number): string {
  // docker compose --since accepts ISO-8601 OR a relative duration (e.g. "42s").
  // Bare epoch seconds are NOT accepted — compute elapsed seconds.
  // Substring matches work regardless of JSON vs plaintext logger mode;
  // the warning text appears verbatim in either.
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

Also extend the existing `uploadAsset` helper (line 133-164) to accept arbitrary extra form fields. Change its signature and body:

```ts
export async function uploadAsset(
  token: string,
  filename: string,
  data: Buffer,
  sidecar?: Buffer,
  extraFields?: Record<string, string>,
): Promise<{ id: string; status: number }> {
  const form = new FormData();
  form.append('assetData', new Blob([new Uint8Array(data)]), filename);
  form.append('deviceAssetId', `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  form.append('deviceId', 'e2e-storage-migration');
  form.append('fileCreatedAt', new Date().toISOString());
  form.append('fileModifiedAt', new Date().toISOString());

  if (sidecar) {
    form.append('sidecarData', new Blob([new Uint8Array(sidecar)]), `${filename}.xmp`);
  }
  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) {
      form.append(k, v);
    }
  }

  const url = `${BASE_URL}/assets`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Upload asset failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return { id: body.id, status: res.status };
}
```

**Step 2: Verify compilation**

```bash
cd e2e && pnpm exec tsc --noEmit
```

Expected: no type errors.

**Step 3: Commit**

```bash
git add e2e/src/storage-migration.ts
git commit -m "test(e2e): add storage-template helpers (setStorageTemplate, triggerQueueCommand, countMoveHistory, log scrape)"
```

---

## Task 6: Phase `template-s3-bulk-skipped`

**Files:**

- Modify: `e2e/src/storage-migration.ts` (add phase function + dispatcher case)

**Step 1: Add the phase function**

Append after `phaseSidecarVerify` (around line 1450), before the `main` function:

```ts
// ---------------------------------------------------------------------------
// Phase: Template bulk migration skips S3 assets (regression for #383)
// Precondition: S3 backend, assets already on S3
// ---------------------------------------------------------------------------
async function phaseTemplateS3BulkSkipped(): Promise<void> {
  console.log('=== Phase: template-s3-bulk-skipped ===');
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false }); // invariant reset
  const startMs = Date.now();
  const preCount = await countMoveHistory();
  const preState = await captureState();

  // Precondition: every asset has a relative S3 path
  for (const a of preState.assets) {
    assert.ok(!a.originalPath.startsWith('/'), `Precondition failed: asset ${a.id} path is absolute`);
  }

  try {
    await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MM}}/{{filename}}' });
    await triggerQueueCommand(token, 'storageTemplateMigration');
    await waitForProcessing(token);

    const postState = await captureState();

    // Every asset path unchanged
    for (const pre of preState.assets) {
      const post = postState.assets.find((a) => a.id === pre.id);
      assert.ok(post, `Asset ${pre.id} disappeared`);
      assert.equal(post.originalPath, pre.originalPath, `Path changed for asset ${pre.id}`);
    }

    // MinIO keys still exist
    minioSetupAlias();
    for (const a of postState.assets) {
      assert.ok(minioFileExists(a.originalPath), `MinIO key missing: ${a.originalPath}`);
    }

    // No new move_history rows
    const postCount = await countMoveHistory();
    assert.equal(postCount, preCount, `move_history grew from ${preCount} to ${postCount}`);

    // Log-scrape (secondary)
    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, 'template-s3-bulk-skipped');

    console.log('  Bulk template migration skipped S3 assets cleanly.');
  } finally {
    await setStorageTemplate(token, { enabled: false });
  }
  console.log('=== Phase: template-s3-bulk-skipped complete ===');
}
```

**Step 2: Register in dispatcher**

In `main()` at the bottom of the file, add inside the `switch (phase)` block:

```ts
case 'template-s3-bulk-skipped': {
  await phaseTemplateS3BulkSkipped();
  break;
}
```

Also update the `default` error message listing valid phases.

**Step 3: Verify compilation**

```bash
cd e2e && pnpm exec tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add e2e/src/storage-migration.ts
git commit -m "test(e2e): phase template-s3-bulk-skipped — regression for #383"
```

---

## Task 7: Phase `template-s3-upload-skipped`

**Files:**

- Modify: `e2e/src/storage-migration.ts`

**Step 1: Add phase function**

Append after `phaseTemplateS3BulkSkipped`:

```ts
async function phaseTemplateS3UploadSkipped(): Promise<void> {
  console.log('=== Phase: template-s3-upload-skipped ===');
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false });
  const startMs = Date.now();

  try {
    await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MMMM}}/{{filename}}' });

    const png = createPng();
    const { id: newAssetId } = await uploadAsset(token, 'template-upload-skip.png', png);
    await waitForProcessing(token);

    const rows = await queryDb<{ originalPath: string }>('SELECT "originalPath" FROM asset WHERE id = $1', [
      newAssetId,
    ]);
    assert.ok(rows[0], `Asset ${newAssetId} not found`);
    const { originalPath } = rows[0];

    assert.ok(!originalPath.startsWith('/'), `Expected relative path, got ${originalPath}`);
    assert.ok(originalPath.startsWith('upload/'), `Expected upload/ prefix, got ${originalPath}`);

    minioSetupAlias();
    assert.ok(minioFileExists(originalPath), `MinIO key missing: ${originalPath}`);

    const count = await countMoveHistory(newAssetId);
    assert.equal(count, 0, `Expected 0 move_history rows for new asset, got ${count}`);

    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, 'template-s3-upload-skipped');

    console.log(`  New S3 upload ${newAssetId} stayed at ${originalPath}.`);
  } finally {
    await setStorageTemplate(token, { enabled: false });
  }
  console.log('=== Phase: template-s3-upload-skipped complete ===');
}
```

**Step 2: Register in dispatcher**

Add a `case 'template-s3-upload-skipped'` branch in `main`.

**Step 3: Verify compilation**

```bash
cd e2e && pnpm exec tsc --noEmit
```

**Step 4: Commit**

```bash
git add e2e/src/storage-migration.ts
git commit -m "test(e2e): phase template-s3-upload-skipped — single-asset AssetMetadataExtracted path"
```

---

## Task 8: Phase `template-s3-live-photo-skipped`

**Files:**

- Modify: `e2e/src/storage-migration.ts`

**Step 1: Add phase function**

```ts
async function phaseTemplateS3LivePhotoSkipped(): Promise<void> {
  console.log('=== Phase: template-s3-live-photo-skipped ===');
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false });
  const startMs = Date.now();

  try {
    // Upload motion video first; then still with livePhotoVideoId linking to motion.
    // A valid video payload is required for a ffprobe-driven asset flow, but in e2e
    // the upload path only stores the bytes — metadata extraction handles the rest
    // and tolerates minimal MP4 headers. A 1x1 PNG stands in fine for the still.
    const motionBytes = Buffer.from([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f,
      0x6d, 0x69, 0x73, 0x6f, 0x32, 0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31,
    ]);
    const { id: motionId } = await uploadAsset(token, 'lp-motion.mp4', motionBytes);
    const { id: stillId } = await uploadAsset(token, 'lp-still.png', createPng(), undefined, {
      livePhotoVideoId: motionId,
    });

    await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MM}}/{{filename}}' });
    await waitForProcessing(token);

    const rows = await queryDb<{ id: string; originalPath: string }>(
      'SELECT id, "originalPath" FROM asset WHERE id = ANY($1)',
      [[motionId, stillId]],
    );
    assert.equal(rows.length, 2, `Expected 2 assets, got ${rows.length}`);
    for (const r of rows) {
      assert.ok(!r.originalPath.startsWith('/'), `Expected relative path for ${r.id}, got ${r.originalPath}`);
      assert.ok(r.originalPath.startsWith('upload/'), `Expected upload/ prefix for ${r.id}`);
    }

    for (const id of [motionId, stillId]) {
      const c = await countMoveHistory(id);
      assert.equal(c, 0, `Asset ${id} has ${c} move_history rows, expected 0`);
    }

    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, 'template-s3-live-photo-skipped');

    console.log(`  Live photo pair (still=${stillId}, motion=${motionId}) skipped template migration.`);
  } finally {
    await setStorageTemplate(token, { enabled: false });
  }
  console.log('=== Phase: template-s3-live-photo-skipped complete ===');
}
```

**Step 2: Register in dispatcher**

Add `case 'template-s3-live-photo-skipped'`.

**Step 3: Verify compilation**

```bash
cd e2e && pnpm exec tsc --noEmit
```

**Step 4: Commit**

```bash
git add e2e/src/storage-migration.ts
git commit -m "test(e2e): phase template-s3-live-photo-skipped — live photo fan-out skip"
```

---

## Task 9: Phase `template-s3-sidecar-skipped`

**Files:**

- Modify: `e2e/src/storage-migration.ts`

**Step 1: Add phase function**

```ts
async function phaseTemplateS3SidecarSkipped(): Promise<void> {
  console.log('=== Phase: template-s3-sidecar-skipped ===');
  const token = await loginAdmin();
  const saved = loadState();
  assert.ok(saved.sidecarAssetId, 'No sidecarAssetId — run `setup` and `migrate-to-s3` first');
  const sidecarAssetId: string = saved.sidecarAssetId;

  await setStorageTemplate(token, { enabled: false });
  const startMs = Date.now();
  const preCount = await countMoveHistory(sidecarAssetId);

  const preRows = await queryDb<{ id: string; path: string }>(
    `SELECT af.id, af.path FROM asset_file af WHERE af."assetId" = $1 AND af.type = 'sidecar'`,
    [sidecarAssetId],
  );
  assert.equal(preRows.length, 1, `Expected 1 sidecar row, got ${preRows.length}`);
  const preSidecarPath = preRows[0].path;

  const preAssetRows = await queryDb<{ originalPath: string }>('SELECT "originalPath" FROM asset WHERE id = $1', [
    sidecarAssetId,
  ]);
  const preOriginalPath = preAssetRows[0].originalPath;

  try {
    await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MMMM}}/{{filename}}' });
    await triggerQueueCommand(token, 'storageTemplateMigration');
    await waitForProcessing(token);

    const postRows = await queryDb<{ path: string }>(`SELECT path FROM asset_file WHERE id = $1`, [preRows[0].id]);
    assert.equal(postRows[0].path, preSidecarPath, `Sidecar path changed`);

    const postAssetRows = await queryDb<{ originalPath: string }>('SELECT "originalPath" FROM asset WHERE id = $1', [
      sidecarAssetId,
    ]);
    assert.equal(postAssetRows[0].originalPath, preOriginalPath, `Original path changed`);

    const postCount = await countMoveHistory(sidecarAssetId);
    assert.equal(postCount, preCount, `move_history grew for ${sidecarAssetId}: ${preCount} → ${postCount}`);

    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, 'template-s3-sidecar-skipped');

    console.log(`  Sidecar asset ${sidecarAssetId} and its .xmp row both unchanged.`);
  } finally {
    await setStorageTemplate(token, { enabled: false });
  }
  console.log('=== Phase: template-s3-sidecar-skipped complete ===');
}
```

**Step 2: Register in dispatcher**

Add `case 'template-s3-sidecar-skipped'`.

**Step 3: Verify compilation**

```bash
cd e2e && pnpm exec tsc --noEmit
```

**Step 4: Commit**

```bash
git add e2e/src/storage-migration.ts
git commit -m "test(e2e): phase template-s3-sidecar-skipped — sidecar asset_file row stable"
```

---

## Task 10: Phase `template-s3-queue-migration-skipped`

**Files:**

- Modify: `e2e/src/storage-migration.ts`

**Step 1: Add phase function**

```ts
async function phaseTemplateS3QueueMigrationSkipped(): Promise<void> {
  console.log('=== Phase: template-s3-queue-migration-skipped ===');
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false });
  const startMs = Date.now();

  const config = await api('GET', '/system-config', { token });
  const originalFormat: string = config.image.thumbnail.format;
  const flippedFormat = originalFormat === 'webp' ? 'jpeg' : 'webp';

  const preThumbs = await queryDb<{ id: string; path: string }>(
    `SELECT id, path FROM asset_file WHERE type = 'thumbnail'`,
  );
  const prePersons = await queryDb<{ id: string; thumbnailPath: string }>(
    `SELECT id, "thumbnailPath" FROM person WHERE "thumbnailPath" != ''`,
  );

  try {
    // Flip thumbnail format
    const flipped = {
      ...config,
      image: { ...config.image, thumbnail: { ...config.image.thumbnail, format: flippedFormat } },
    };
    await api('PUT', '/system-config', { body: flipped, token });

    // Trigger FileMigrationQueueAll (fans out AssetFileMigration + PersonFileMigration)
    await triggerQueueCommand(token, 'migration');
    await waitForProcessing(token);

    // Thumbnails unchanged (still point at pre-flip extension — intended skip behavior)
    const postThumbs = await queryDb<{ id: string; path: string }>(
      `SELECT id, path FROM asset_file WHERE type = 'thumbnail'`,
    );
    assert.equal(postThumbs.length, preThumbs.length, `thumbnail row count changed`);
    for (const pre of preThumbs) {
      const post = postThumbs.find((r) => r.id === pre.id);
      assert.ok(post, `thumbnail row ${pre.id} disappeared`);
      assert.equal(post.path, pre.path, `thumbnail path changed for ${pre.id}`);
    }

    // Person thumbnails unchanged
    const postPersons = await queryDb<{ id: string; thumbnailPath: string }>(
      `SELECT id, "thumbnailPath" FROM person WHERE "thumbnailPath" != ''`,
    );
    for (const pre of prePersons) {
      const post = postPersons.find((r) => r.id === pre.id);
      assert.ok(post, `person ${pre.id} thumbnailPath disappeared`);
      assert.equal(post.thumbnailPath, pre.thumbnailPath, `person ${pre.id} thumbnailPath changed`);
    }

    // Primary catch: no ENOENT from handleQueueMigration removeEmptyDirs on pure-S3
    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, 'template-s3-queue-migration-skipped');

    console.log(`  Format flipped ${originalFormat}→${flippedFormat}; DB paths stable; no ENOENT.`);
  } finally {
    // Restore original thumbnail format
    const restore = await api('GET', '/system-config', { token });
    restore.image.thumbnail.format = originalFormat;
    await api('PUT', '/system-config', { body: restore, token });
  }
  console.log('=== Phase: template-s3-queue-migration-skipped complete ===');
}
```

**Step 2: Register in dispatcher**

Add `case 'template-s3-queue-migration-skipped'`.

**Step 3: Verify compilation**

```bash
cd e2e && pnpm exec tsc --noEmit
```

**Step 4: Commit**

```bash
git add e2e/src/storage-migration.ts
git commit -m "test(e2e): phase template-s3-queue-migration-skipped — FileMigrationQueueAll no ENOENT on pure-S3"
```

---

## Task 11: Phase `template-disk-baseline`

**Files:**

- Modify: `e2e/src/storage-migration.ts`

**Step 1: Add phase function**

```ts
async function phaseTemplateDiskBaseline(): Promise<void> {
  console.log('=== Phase: template-disk-baseline ===');
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false });
  const startMs = Date.now();

  // Set a predictable storageLabel on admin so library paths are stable.
  // Note: upload paths use userId (UUID), NOT storageLabel — only library paths use it.
  //
  // `PUT /users/me` does NOT accept storageLabel (UserUpdateMeDto omits it).
  // Use the admin endpoint `PUT /admin/users/:id` (UserAdminUpdateDto accepts storageLabel).
  // Admin users can update themselves via this endpoint.
  //
  // This write is idempotent — if a prior run on the same DB already set
  // storageLabel='admin', the re-update is a no-op from the asset path's
  // perspective. No teardown needed (last phase in the workflow).
  const me = await api('GET', '/users/me', { token });
  await api('PUT', `/admin/users/${me.id}`, { body: { storageLabel: 'admin' }, token });

  const preCount = await countMoveHistory();
  const preState = await captureState();

  // Every asset is on disk (absolute) post-rollback
  for (const a of preState.assets) {
    assert.ok(a.originalPath.startsWith('/'), `Pre-baseline: asset ${a.id} not absolute`);
  }
  const preAssetPaths = new Map(preState.assets.map((a) => [a.id, a.originalPath]));

  await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{y}}-{{MM}}-{{dd}}/{{filename}}' });
  await triggerQueueCommand(token, 'storageTemplateMigration');
  await waitForProcessing(token);

  const postState = await captureState();

  for (const a of postState.assets) {
    assert.ok(
      a.originalPath.startsWith('/usr/src/app/upload/library/admin/'),
      `Expected library/admin/ path, got ${a.originalPath}`,
    );
    assert.ok(diskFileExists(a.originalPath), `New disk path missing: ${a.originalPath}`);

    // Old path gone
    const prePath = preAssetPaths.get(a.id);
    assert.ok(prePath, `Asset ${a.id} missing from pre-state`);
    if (prePath !== a.originalPath) {
      assert.ok(!diskFileExists(prePath), `Old disk path still exists: ${prePath}`);
    }
  }

  // Sidecar followed the asset
  const saved = loadState();
  if (saved.sidecarAssetId) {
    const sidecarAssetId: string = saved.sidecarAssetId;
    const asset = postState.assets.find((a) => a.id === sidecarAssetId);
    assert.ok(asset, 'Sidecar asset missing from post-state');
    const sidecar = postState.assetFiles.find((f) => f.type === 'sidecar' && f.path.startsWith(asset.originalPath));
    assert.ok(sidecar, `Sidecar .xmp did not follow asset to ${asset.originalPath}`);
  }

  // move_history returns to baseline (each successful move deletes its own row)
  const postCount = await countMoveHistory();
  assert.equal(postCount, preCount, `move_history delta: ${preCount} → ${postCount}`);

  const logs = captureContainerLogsSince('immich-server', startMs);
  assertNoMoveEnoent(logs, 'template-disk-baseline');

  console.log(`  Disk template migration moved ${postState.assets.length} assets to library/admin/…`);
  console.log('=== Phase: template-disk-baseline complete ===');
}
```

**Step 2: Register in dispatcher**

Add `case 'template-disk-baseline'`.

**Step 3: Verify compilation**

```bash
cd e2e && pnpm exec tsc --noEmit
```

**Step 4: Commit**

```bash
git add e2e/src/storage-migration.ts
git commit -m "test(e2e): phase template-disk-baseline — regression guard for disk template feature"
```

---

## Task 12: Wire the workflow YAML

**Files:**

- Modify: `.github/workflows/storage-migration-tests.yml`

**Step 1: Insert template phases into Phase group 2**

Open the file. Find the line `# Phase group 2: backend=s3 — migrate to S3, verify` (around line 62). After the `- name: 'Phase: migrate-to-s3'` step and BEFORE `- name: 'Phase: no-files'`, insert:

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

**Step 2: Append the disk-baseline step group**

After the `- name: 'Phase: rollback'` step (around line 132), add:

```yaml
# ---------------------------------------------------------------
# Phase group 7: backend=disk — template-disk-baseline regression guard
# Runs last; no further phases after this.
# ---------------------------------------------------------------
- name: Restart server (backend=disk, post-rollback)
  run: |
    IMMICH_STORAGE_BACKEND=disk \
    docker compose up -d --no-deps --force-recreate --wait --wait-timeout 120 immich-server

- name: 'Phase: template-disk-baseline'
  run: pnpm tsx src/storage-migration.ts template-disk-baseline
```

**Step 3: Bump timeout**

Change `timeout-minutes: 30` → `timeout-minutes: 45`.

**Step 4: Validate YAML**

```bash
yamllint .github/workflows/storage-migration-tests.yml 2>&1 | head -5 || true
```

If `yamllint` isn't installed, skip — GitHub will parse on push.

**Step 5: Commit**

```bash
git add .github/workflows/storage-migration-tests.yml
git commit -m "ci(storage-migration): add 6 template×S3 phases + disk-baseline regression guard

Inserts template-s3-bulk-skipped, -upload-skipped, -live-photo-skipped,
-sidecar-skipped, -queue-migration-skipped between migrate-to-s3 and
no-files. Adds a trailing disk restart + template-disk-baseline as a
feature regression guard. Bumps timeout-minutes 30 → 45."
```

---

## Validation after all tasks

Run the full server test suite before opening PR:

```bash
cd server && pnpm test -- --run
```

Expected: all tests pass, no new failures, no skips.

Run type check on e2e:

```bash
cd e2e && pnpm exec tsc --noEmit
```

Expected: no errors.

CI validation: push the branch, watch the storage-migration-tests workflow on the next scheduled run or trigger via `workflow_dispatch`.

---

## Notes for the implementer

- The unit-test hardening tasks (1-3) are **not classic TDD** — the production guards already exist; these tests lock in behavior. They should pass on first run. If any fails, the production code has a bug — stop and investigate before proceeding.
- Task 4 **is** classic TDD — write red test, confirm red, write production fix, confirm green.
- E2E phase tasks (6-11) cannot be verified locally without the full docker stack — rely on `tsc --noEmit` + visual review. CI is the final validation.
- Every commit should leave `main` mergeable. Tasks 1-4 are independent of 5-12 and could land as their own PR if the E2E work drags.
- `setStorageTemplate` uses PUT /system-config which replaces the entire config — always GET first, mutate, PUT.
- The Gallery fork uses `docker compose` (no hyphen). If adapting commands, keep that form.
- `assertNoMoveEnoent` is a secondary signal. Structural assertions (paths, MinIO keys, `move_history` counts) are primary.
- Frequent commits after each task keep rollback targets tight if a later phase surfaces an issue.
- No OpenAPI or SQL regen needed — no new controllers or `@GenerateSql` methods in this plan.

---

## Out of scope (carried from design)

- Backend-swap phases (`template-mixed-disk-then-s3`, `template-s3-rollback-preserves-templated-paths`).
- Stale `move_history` cleanup.
- `AssetService.copySidecar` on S3 targets.
- Helper extraction to `storage-harness.ts`.
- Per-PR workflow trigger.
