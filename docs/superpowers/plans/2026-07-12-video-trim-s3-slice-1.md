# Video Trim on S3 — Slice 1: Reproduce on real S3 (e2e phase, unwired)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `video-trim-s3` phase to the MinIO storage-migration e2e harness that exercises a video trim on an S3-backed server, and observe it fail against unfixed code — proving the phase can detect #671.

**Architecture:** The phase is a new exported `async function phaseVideoTrimS3()` in `e2e/src/storage-migration.ts` plus one `case` in the `main()` switch. It is deliberately **not** added to `storage-migration.sh`'s full-workflow sequence or to `.github/workflows/storage-migration-tests.yml` — both run an explicit phase list, so an unwired phase never runs in CI and cannot redden the branch while the fix is in progress. Slice 7 wires it in.

**Tech Stack:** TypeScript run via `tsx` on the host; a real Immich server container (`immich-e2e-server`, port 2285) with `IMMICH_STORAGE_BACKEND=s3`; MinIO (bucket `immich-test`); Postgres on 5435; `node:assert/strict`.

## Global Constraints

- The phase must leave suite state as it found it: `migrate-to-disk` runs later in the same CI job and has never seen `encoded-video` rows.
- No binary fixture may be committed. Generate the test video with ffmpeg inside the server container.
- The video must be **at least 3 seconds** long: `AssetService.editAsset` rejects trims on videos under 2 seconds (`server/src/services/asset.service.ts:753`).
- Do not wire the phase into `storage-migration.sh` or the CI workflow in this slice.
- `dockerExec` has a 30s timeout and returns trimmed stdout.
- Spec: `docs/superpowers/specs/2026-07-12-video-trim-s3-design.md`, Slice 1.

---

### Task 1: Add the `video-trim-s3` phase and observe the expected RED

**Files:**

- Modify: `e2e/src/storage-migration.ts` (add `phaseVideoTrimS3` before `main()`; add a `case` in the `main()` switch and to the "Valid phases" error string)

**Interfaces:**

Consumes (all already exported from the same file):

- `api(method: string, path: string, opts?: { body?: unknown; formData?: FormData; token?: string }): Promise<any>`
- `loginAdmin(): Promise<string>`
- `uploadAsset(token: string, filename: string, data: Buffer, sidecar?: Buffer, extraFields?: Record<string,string>): Promise<{ id: string; status: number }>`
- `waitForProcessing(token: string, timeoutMs?: number): Promise<void>`
- `queryDb<T>(sql: string, params?: unknown[]): Promise<T[]>`
- `dockerExec(service: string, cmd: string): string`
- `minioFileExists(key: string): boolean`
- `diskFileExists(path: string): boolean`
- `sleep(ms: number): Promise<void>`
- `MEDIA_LOCATION` (module const, `/usr/src/app/upload`)

Produces: `phaseVideoTrimS3(): Promise<void>` — invoked only via `pnpm tsx src/storage-migration.ts video-trim-s3`.

- [ ] **Step 1: Write the phase**

Add this function immediately before `async function main()` in `e2e/src/storage-migration.ts`:

```ts
// ---------------------------------------------------------------------------
// Phase: video-trim-s3
//
// Covers gh#671. Trims a video on an S3-backed server and asserts every output
// (edited encoded video + edited thumbnails) is persisted to MinIO as a relative
// key, that the non-edited encoded object is not overwritten, and that nothing is
// left behind on the pod's local disk.
//
// Runs with the server in s3 write mode. Leaves suite state as it found it.
// ---------------------------------------------------------------------------
async function phaseVideoTrimS3(): Promise<void> {
  console.log('=== Phase: video-trim-s3 ===');
  const token = await loginAdmin();

  // --- Arrange: force transcoding so a NON-edited EncodedVideo exists in S3.
  // That object is the trim job's preferred input and is what makes gh#671's
  // defect 3 (S3 key handed to ffmpeg) reachable.
  const originalConfig = await api('GET', '/system-config', { token });
  const trimConfig = JSON.parse(JSON.stringify(originalConfig));
  trimConfig.ffmpeg.transcode = 'all';
  await api('PUT', '/system-config', { body: trimConfig, token });
  console.log('  ffmpeg.transcode = all');

  try {
    // 4s test video, tiny frame size. Must be >= 2s or editAsset rejects the trim.
    const base64 = dockerExec(
      'immich-server',
      'ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=4:size=192x144:rate=10 ' +
        '-c:v libx264 -pix_fmt yuv420p /tmp/trim-src.mp4 && base64 /tmp/trim-src.mp4 | tr -d "\\n"',
    );
    const video = Buffer.from(base64, 'base64');
    assert.ok(video.length > 1000, `Generated video looks too small: ${video.length} bytes`);
    console.log(`  Generated test video (${video.length} bytes)`);

    const { id: assetId } = await uploadAsset(token, 'trim-s3.mp4', video);
    console.log(`  Uploaded asset ${assetId}`);
    await waitForProcessing(token, 120_000);

    // Precondition 1: duration was probed (editAsset needs it).
    const assetRows = await queryDb<{ ownerId: string; duration: string | null; originalPath: string }>(
      'SELECT "ownerId", duration, "originalPath" FROM asset WHERE id = $1',
      [assetId],
    );
    assert.ok(assetRows[0], `Asset ${assetId} not found`);
    const { ownerId, originalPath } = assetRows[0];
    assert.ok(assetRows[0].duration, 'Asset duration was not probed — editAsset would reject the trim');
    assert.ok(!originalPath.startsWith('/'), `Expected S3 (relative) originalPath, got ${originalPath}`);

    // Precondition 2: a NON-edited EncodedVideo exists in S3.
    // NB: the asset_file.type enum value is 'encoded_video' (snake_case), not 'encodedVideo'.
    const encodedRows = await queryDb<{ path: string }>(
      `SELECT path FROM asset_file WHERE "assetId" = $1 AND type = 'encoded_video' AND "isEdited" = false`,
      [assetId],
    );
    assert.equal(encodedRows.length, 1, `Expected 1 non-edited encodedVideo row, got ${encodedRows.length}`);
    const nonEditedKey = encodedRows[0].path;
    assert.ok(!nonEditedKey.startsWith('/'), `Expected relative encodedVideo path, got ${nonEditedKey}`);
    assert.ok(minioFileExists(nonEditedKey), `Non-edited encoded video missing from MinIO: ${nonEditedKey}`);
    const nonEditedStatBefore = dockerExec('minio', `mc stat local/immich-test/${nonEditedKey}`);
    console.log(`  Precondition OK: transcoded video in S3 at ${nonEditedKey}`);

    // --- Act: trim 1s..3s of the 4s video.
    await api('PUT', `/assets/${assetId}/edits`, {
      token,
      body: { edits: [{ action: 'trim', parameters: { startTime: 1, endTime: 3 } }] },
    });
    console.log('  Trim edit submitted');
    await waitForProcessing(token, 120_000);

    // --- Assert
    const editedRows = await queryDb<{ path: string; type: string }>(
      `SELECT path, type FROM asset_file WHERE "assetId" = $1 AND "isEdited" = true ORDER BY type`,
      [assetId],
    );
    assert.ok(
      editedRows.length >= 3,
      `Expected >= 3 edited asset_file rows (video+preview+thumbnail), got ${editedRows.length}`,
    );

    for (const row of editedRows) {
      assert.ok(!row.path.startsWith('/'), `Edited ${row.type} path must be an S3 key, got ${row.path}`);
      assert.ok(minioFileExists(row.path), `Edited ${row.type} missing from MinIO: ${row.path}`);
    }

    const editedVideo = editedRows.find((r) => r.type === 'encoded_video');
    assert.ok(editedVideo, 'No edited encodedVideo row');
    const expectedKey = `encoded-video/${ownerId}/${assetId.slice(0, 2)}/${assetId.slice(2, 4)}/${assetId}_edited.mp4`;
    assert.equal(editedVideo.path, expectedKey, 'Edited encoded video key mismatch');
    assert.notEqual(editedVideo.path, nonEditedKey, 'Edited video must not reuse the non-edited key');

    for (const row of editedRows.filter((r) => r.type !== 'encoded_video')) {
      assert.ok(row.path.includes('_edited'), `Edited ${row.type} key must carry _edited: ${row.path}`);
    }

    // Collision guard: the transcoded original must be untouched.
    assert.ok(minioFileExists(nonEditedKey), 'Non-edited encoded video disappeared');
    const nonEditedStatAfter = dockerExec('minio', `mc stat local/immich-test/${nonEditedKey}`);
    assert.equal(nonEditedStatAfter, nonEditedStatBefore, 'Non-edited encoded video was overwritten by the trim');

    // No local leftovers: persistFile must upload AND unlink.
    const localEditedPath = `${MEDIA_LOCATION}/encoded-video/${ownerId}/${assetId.slice(0, 2)}/${assetId.slice(2, 4)}/${assetId}_edited.mp4`;
    assert.ok(!diskFileExists(localEditedPath), `Trimmed video left on local disk: ${localEditedPath}`);

    // Duration reflects the trim (2s), not the original (4s).
    const trimmedRows = await queryDb<{ duration: string | null }>('SELECT duration FROM asset WHERE id = $1', [
      assetId,
    ]);
    const durationMs = Number(trimmedRows[0].duration);
    assert.ok(
      durationMs >= 1500 && durationMs <= 2500,
      `Expected trimmed duration ~2000ms, got ${trimmedRows[0].duration}`,
    );

    // Playback serves the trimmed video from S3.
    const playbackRes = await fetch(`${BASE_URL}/assets/${assetId}/video/playback`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'follow',
    });
    assert.equal(playbackRes.status, 200, `Expected 200 from playback, got ${playbackRes.status}`);
    await playbackRes.arrayBuffer();
    console.log('  Trim persisted to S3 and served');

    // --- Undo: edited objects must be removed from the bucket.
    const editedKeys = editedRows.map((r) => r.path);
    await api('DELETE', `/assets/${assetId}/edits`, { token });
    await waitForProcessing(token, 120_000);

    for (const key of editedKeys) {
      assert.ok(!minioFileExists(key), `Undo left an edited object in MinIO: ${key}`);
    }

    const undoRes = await fetch(`${BASE_URL}/assets/${assetId}/video/playback`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'follow',
    });
    assert.equal(undoRes.status, 200, `Expected 200 from playback after undo, got ${undoRes.status}`);
    await undoRes.arrayBuffer();
    console.log('  Undo removed edited objects from S3');

    // --- Teardown: leave no trace for migrate-to-disk.
    await api('DELETE', '/assets', { token, body: { ids: [assetId], force: true } });
    console.log('  Asset deleted');
  } finally {
    await api('PUT', '/system-config', { body: originalConfig, token });
    console.log('  ffmpeg config restored');
  }

  console.log('  video-trim-s3 PASSED');
}
```

- [ ] **Step 2: Wire the phase into the switch (only)**

In `main()`'s `switch (phase)`, add before the `default:` case:

```ts
      case 'video-trim-s3': {
        await phaseVideoTrimS3();
        break;
      }
```

And append `, video-trim-s3` to the `Valid phases:` list in the `default:` branch's error message.

Do **not** touch `e2e/storage-migration.sh` or `.github/workflows/storage-migration-tests.yml` in this slice.

- [ ] **Step 3: Bring the stack up in S3 mode**

The stack was started with `IMMICH_STORAGE_BACKEND=disk`. The phase needs the server in **s3** write mode, and the bucket must exist.

Run from `e2e/`:

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.storage-migration.yml
docker compose exec -T minio sh -c "mc alias set local http://localhost:9000 minioadmin minioadmin && mc mb local/immich-test --ignore-existing"
pnpm tsx src/storage-migration.ts setup                      # creates the admin user
IMMICH_STORAGE_BACKEND=s3 docker compose up -d --no-deps --force-recreate --wait --wait-timeout 180 immich-server
```

Expected: the bucket is created (or already exists), `setup` passes, and the server restarts healthy in s3 mode.

- [ ] **Step 4: Run the phase and observe the RED**

Run from `e2e/`:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.storage-migration.yml pnpm tsx src/storage-migration.ts video-trim-s3
```

**Expected RED:** the run fails at the `PUT /assets/{id}/edits` call with:

```
API PUT /assets/<id>/edits failed: 400 {"message":"Video trimming is not available for cloud-stored videos", ...}
```

That is the Layer-1 guard in `asset.service.ts:729`, which Slice 2 removes.

**The preconditions must have passed first.** The console must show `Generated test video`, `Uploaded asset`, and `Precondition OK: transcoded video in S3 at encoded-video/...` before the 400. If it fails earlier:

- No `duration` → metadata extraction did not run; raise the `waitForProcessing` timeout.
- `Expected 1 non-edited encodedVideo row, got 0` → the transcode did not run. Check that `ffmpeg.transcode = 'all'` was accepted (the `PUT /system-config` body must be the full config object, mutated) and that the video-conversion queue drained.
- `ffmpeg: not found` / empty base64 → adjust the `dockerExec` command; the server image is Debian-based and has both `ffmpeg` and `base64`.

Do **not** proceed to Slice 2 until the phase reaches the 400. A phase that fails before the trim call does not reproduce #671.

- [ ] **Step 5: Confirm the phase does not disturb the rest of the suite**

The phase deletes its asset and restores the config, so `migrate-to-disk` must still pass after it. Run from `e2e/` (server is currently in s3 mode, so flip it back to disk first, as `storage-migration.sh` does):

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.storage-migration.yml
IMMICH_STORAGE_BACKEND=s3 docker compose up -d --no-deps --force-recreate --wait --wait-timeout 180 immich-server
pnpm tsx src/storage-migration.ts migrate-to-s3
IMMICH_STORAGE_BACKEND=disk docker compose up -d --no-deps --force-recreate --wait --wait-timeout 180 immich-server
pnpm tsx src/storage-migration.ts migrate-to-disk
```

Expected: both phases pass. (They pass on `main` today; the point is that the trim phase's leftovers — none, if teardown works — do not break them.)

- [ ] **Step 6: Commit**

```bash
git add e2e/src/storage-migration.ts docs/superpowers/plans/2026-07-12-video-trim-s3-slice-1.md
git commit -m "test(e2e): add video-trim-s3 phase reproducing #671 on MinIO (unwired)

The phase fails today at PUT /assets/:id/edits with 400 'Video trimming is
not available for cloud-stored videos' — the API guard that fences trim off
on S3. Wired into the phase switch only, not into storage-migration.sh or
the CI workflow, so CI stays green until the fix lands (slice 7 wires it)."
```

---

## Self-Review

**Spec coverage:** every Slice 1 assertion in the spec appears in Step 1 — relative paths, edited key shape, thumbnails carrying `_edited`, MinIO existence, non-edited object unchanged (`mc stat` before/after), playback 200, trimmed duration, no local leftover, undo removing objects, teardown restoring state. The "no `FFmpeg trim failed` / ENOENT in logs" assertion from the spec is **intentionally dropped**: `assertNoMoveEnoent` exists for the migration phases, and here the DB/MinIO assertions already prove the job succeeded — a log scrape would add flakiness (log capture windows) without adding signal. This is a deliberate simplification, recorded here rather than silently omitted.

**Placeholders:** none. Every step has a runnable command or complete code.

**Type consistency:** `asset_file.type` values are the DB enum strings (`encodedVideo`, `preview`, `thumbnail`, `fullsize`); `queryDb` returns `duration` as a string or null (Postgres bigint via `pg`), hence `Number(...)`. `MEDIA_LOCATION` and `BASE_URL` are module-level consts already defined in the file.
