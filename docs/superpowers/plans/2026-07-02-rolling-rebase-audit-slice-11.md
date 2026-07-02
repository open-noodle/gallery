# Slice 11 — LOW#4: restore video-trim e2e transcoding coverage

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §Slice 11
**Finding:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` LOW#4
**Scope:** test-only, `e2e/src/specs/server/api/video-trim.e2e-spec.ts`. No non-test code changes.

## 1. Problem restated

`beforeAll` in `video-trim.e2e-spec.ts` sets `config.ffmpeg.transcode = TranscodePolicy.Disabled`
for the entire suite (fork `main` did not). Under `Disabled`, `handleVideoConversion`
(`server/src/services/media.service.ts` `isVideoTranscodeRequired`/`isAudioTranscodeRequired`)
always returns `false`/skips, so **no `AssetFileType.EncodedVideo` (non-edited) file is ever
created** for any asset in this suite. Consequently `handleVideoTrim`'s input-selection line:

```ts
// server/src/services/media.service.ts ~292-295
const existingEncoded = asset.files.find((f) => f.type === AssetFileType.EncodedVideo && !f.isEdited);
const inputPath = existingEncoded?.path || localPath;
```

always takes the `localPath` (raw original) fallback — the `existingEncoded.path` branch is
never exercised by any test in this file. This is a **coverage gap**, not a functional bug:
grepping `server/src/services/media.service.spec.ts` confirms no unit test builds an asset with
a pre-existing non-edited `EncodedVideo` file either (`handleAssetEditThumbnailGeneration`
describe block, ~L1432-1670) — every trim-related unit test starts from an asset with no
files, so `existingEncoded` is `undefined` there too. Restoring unit-level coverage is out of
scope for this slice (LOW#4 names only the e2e file); noting it here for visibility.

## 2. Why `Disabled` was added (git history)

Commit `test(e2e): drain video trim background queues` (fork-only, rebased forward each sync)
added the `Disabled` override alongside draining `metadataExtraction`/`editor`/
`thumbnailGeneration`/`videoConversion` queues in `afterAll`. None of the file's existing
assertions depend on whether an encoded variant exists (rejection tests are synchronous
validation errors; mutation tests assert only the `edits` array in the immediate response,
never `asset.files` or a re-probed `duration`). So `Disabled` was very likely chosen for
determinism/speed (skip real ffmpeg transcode calls entirely, 8 tests × fresh 4s video), not
because any test's assertion requires it. Confirmed safe to scope the override to a single new
test rather than flip it back globally.

## 3. Feasibility check — how do we prove "reads the encoded input" from black-box e2e?

Investigated three options:

1. **Direct file/asset introspection** — `AssetResponseDto` declares `files?` but `mapAsset()`
   (`server/src/dtos/asset-response.dto.ts` ~194-241) never populates it on the public
   `GET /assets/:id` response. No existing e2e spec queries encoded-video presence via API.
   Not available without a server DTO change (out of scope — test-only slice).
2. **docker-exec ffprobe on the server's internal storage path** — feasible in principle
   (`StorageCore.getNestedPath` pattern is predictable) but requires importing/duplicating
   server-internal path logic into the e2e spec and shelling into the container; no existing
   e2e spec does this for media files. Rejected as disproportionate complexity for a
   coverage-restoration slice.
3. **Deterministic precondition + behavioral assertion (chosen)** — force `TranscodePolicy.All`
   (transcodes unconditionally, unlike `Required`/`Optimal`/`Bitrate` which can skip if the
   source already matches target codec/resolution) and **wait for the `videoConversion` queue
   to drain before trimming**. This guarantees a non-edited `EncodedVideo` file exists at the
   moment the trim job runs, so `handleVideoTrim`'s own selection predicate deterministically
   takes the `existingEncoded.path` branch — proven by precondition, not by re-deriving it
   independently. The e2e assertion then verifies the **integration** (real ffmpeg trim off
   that input, real job queue draining, real re-probed duration written back) doesn't
   regress — which is exactly what "e2e coverage" of this branch means (the unit level is
   where exact branch-selection would be asserted with mocks; that's a separate, already-noted
   gap, out of scope here).

**No race condition:** `job.service.ts` (`JobName.AssetGenerateThumbnails` completion handler,
~L177-211) enqueues `JobName.AssetEncodeVideo` via `jobRepository.queueAll(jobs)`
**synchronously before** emitting the `on_upload_success` websocket event that
`uploadVideo()`'s `waitForWebsocketEvent({ event: 'assetUpload', ... })` already awaits. So by
the time `uploadVideo()` resolves, the video-conversion job is already enqueued — calling
`utils.waitForQueueFinish(admin.accessToken, 'videoConversion', ...)` right after cannot
false-resolve on an empty-but-not-yet-populated queue.

## 4. Planned test change

Add a new `describe` block **after** the existing `'PUT /assets/:id/edits (trim mutations)'`
block, so it runs last and cannot affect any other test's config assumptions. Scope the
`TranscodePolicy.All` override to this block only, and restore `Disabled` in its own
`afterAll` (defensive/self-contained, even though it's already the last block and the file's
outer `afterAll` fully resets config via `resetAdminConfig` at final teardown regardless).

```ts
describe('PUT /assets/:id/edits (trim from an existing encoded video)', () => {
  afterAll(async () => {
    const config = await utils.getSystemConfig(admin.accessToken);
    config.ffmpeg.transcode = TranscodePolicy.Disabled;
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });
  });

  it('should trim from the already-transcoded EncodedVideo variant, not the raw upload', async () => {
    const config = await utils.getSystemConfig(admin.accessToken);
    config.ffmpeg.transcode = TranscodePolicy.All;
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

    const videoId = await uploadVideo();

    // Guarantees a non-edited EncodedVideo file exists before we trim (see §3).
    await utils.waitForQueueFinish(admin.accessToken, 'videoConversion', 60_000);

    const { status, body } = await request(app)
      .put(`/assets/${videoId}/edits`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ edits: [{ action: 'trim', parameters: { startTime: 1, endTime: 3 } }] });

    expect(status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        assetId: videoId,
        edits: expect.arrayContaining([
          expect.objectContaining({
            action: 'trim',
            parameters: expect.objectContaining({ startTime: 1, endTime: 3 }),
          }),
        ]),
      }),
    );

    await utils.waitForQueueFinish(admin.accessToken, 'editor', 60_000);

    const info = await utils.getAssetInfo(admin.accessToken, videoId);
    // `-c copy` trims to the nearest keyframe (server/src/repositories/media.repository.ts
    // `trim()`), so allow generous tolerance around the requested 2s (1s-3s) window — this
    // proves a real trim occurred (not a no-op leaving the untouched 4s original, and not a
    // silent failure).
    expect(info.duration).toBeGreaterThan(500);
    expect(info.duration).toBeLessThan(3500);
  }, 30_000);
});
```

No changes to the existing `beforeAll`/rejection tests/mutation tests — they keep the
suite-wide `Disabled` baseline for speed/determinism (edge case: "trim from raw original with
no encoded variant" — already covered by every existing mutation test, since `Disabled` there
guarantees `existingEncoded` is always `undefined`).

## 5. Edge cases covered

- **Trim from raw original (no encoded variant)** — already covered by all existing mutation
  tests under the suite-wide `Disabled` baseline (unchanged).
- **Trim from an encoded variant** — new test, `TranscodePolicy.All` + drained
  `videoConversion` queue guarantees the precondition deterministically.
- **S3 vs disk** — the e2e docker-compose stack (`e2e/docker-compose.yml`) is disk-only (no S3
  service); S3 matrix is out of scope (not supported by this e2e stack at all, not something
  this slice can add without infra changes).
- **Scoped, not global** — override lives in its own `describe`/`it` + its own `afterAll`
  restores `Disabled`; no other test's config assumptions change.

## 6. RED / GREEN

The e2e Docker stack was actually run (see §7) — both RED and GREEN are backed by real
executions plus direct Postgres inspection of the running `immich-e2e-postgres` container's
`asset_file` table, not just reasoning.

**RED (actually run):** Temporarily stripped the new test down to remove the scoped
`TranscodePolicy.All` override and the `videoConversion` drain-wait (i.e., simulate the pre-fix
world: rely solely on the suite-wide `Disabled` `beforeAll`, exactly the historical shape).
Result: **the test still reports PASS** (`11 passed (11)`) — silently, with no functional
signal that the branch was skipped. Querying the DB directly after that run:

```sql
select type, "isEdited", count(*) from asset_file group by 1,2;
--      type      | isEdited | count
-- ---------------+----------+-------
--  fullsize      | t        |     1
--  encoded_video | t        |     1   <- only the trim OUTPUT (isEdited=true)
--  preview       | f        |     3
--  thumbnail     | t        |     1
--  preview       | t        |     1
--  thumbnail     | f        |     3
```

Zero `encoded_video, isEdited=false` rows exist anywhere in the database — confirming
`existingEncoded` was `undefined` for every trim in the run, i.e. `handleVideoTrim`'s
`existingEncoded?.path || localPath` (media.service.ts ~294-295) took the `localPath` fallback
100% of the time. This is the literal, DB-verified shape of the coverage gap: the branch is
**structurally unreachable**, not just untested by coincidence — and a naively-added assertion
that doesn't force the precondition would give false confidence (test passes, branch still
never hit).

**GREEN (actually run):** Restored the fix (scoped `TranscodePolicy.All` override +
`waitForQueueFinish(..., 'videoConversion', ...)` drain wait). Ran the new test in isolation
(`npx vitest run -t "should trim from the already-transcoded EncodedVideo variant" ...`) and
queried the DB for that exact asset immediately after:

```sql
select type, path, "isEdited" from asset_file where "assetId" = '<the test's videoId>';
--      type      |                          path                           | isEdited
-- ---------------+----------------------------------------------------------+----------
--  encoded_video | .../<id>.mp4                                             | f   <- proves existingEncoded was found
--  encoded_video | .../<id>_edited.mp4                                      | t   <- trim output
--  ...(thumbnails)
select duration from asset where id = '<the test's videoId>';
-- 3083   (requested window 1s-3s = 2000ms; -c copy snaps to nearest keyframe, well inside the
--         [500, 3500) tolerance and far below the untouched 4000ms original)
```

The non-edited `encoded_video` row is proven present *before* the trim request (guaranteed by
the drain-wait), so `handleVideoTrim`'s selector deterministically resolved
`existingEncoded.path` — not by inference, by direct row presence. Then ran the full file
(all 11 tests, real ffmpeg, real queues): **`Test Files 1 passed (1)` / `Tests 11 passed
(11)`**, ~1.3s wall time (per-test times: rejections 6-132ms, mutations 20-41ms, new test
242-263ms).

**Aside (pre-existing, unrelated, out of scope):** both the RED and GREEN runs logged one
async `ERROR` from the *existing* `'should re-trim (widen) on a fresh asset'` test: `Input file
is missing: .../<id>_edited.mp4.frame.jpg` (a `handleVideoTrim` → `extractFrame` →
`generateImageThumbnails` race when two trim jobs land on the same asset in quick succession,
exactly what that test's own comment "before async job modifies duration" is exploiting).
Reproduced this in isolation (`-t "should re-trim"`, no interaction with the new test) — it is
a latent, pre-existing race in production code, unrelated to this slice's diff, and it does not
fail the test (the async error fires after the HTTP response already returned 200, and that
test does not wait on the editor queue). Not fixed here per the "test-only, stop if non-test
code needs to change" instruction — this is worth a follow-up finding, not a Slice 11 change.

## 7. Execution log

- Docker/e2e images were not pre-built for this worktree; first `docker compose up --build`
  exceeded the e2e harness's hardcoded 60s readiness timeout (`e2e/src/docker-compose.ts`) and
  the vitest run reported `Error: Timeout starting e2e environment` — but the containers kept
  initializing in the background and came up healthy ~30s later. Re-running with the stack
  already up (`vitest` skips `docker-compose.ts` once `GET /api/server/ping` succeeds) worked
  cleanly from then on. Not a code issue — just first-boot image build/migration time in this
  environment.
- `cd e2e && npx tsc --noEmit` — clean, no errors.
- `cd e2e && npx eslint src/specs/server/api/video-trim.e2e-spec.ts --max-warnings 0` — clean.
- Scoped runs used `VITEST_DISABLE_DOCKER_SETUP=true npx vitest run --reporter=verbose
  src/specs/server/api/video-trim.e2e-spec.ts` (the `pnpm test -- --run <path>` form doubles up
  `--run` via the package.json script and vitest then ran the *entire* 61-file suite instead of
  the one file — still useful once: it surfaced 5 pre-existing, unrelated failing files
  (`library.e2e-spec.ts`, CLI specs) with **zero** failures in `video-trim.e2e-spec.ts`,
  corroborating the scoped result).
- Tore down the stack afterward: `cd e2e && docker compose down -v`.

## 8. Commit

`test(e2e): cover trim-from-encoded input with transcoding enabled (LOW #4)`

Body: restores e2e coverage of `handleVideoTrim`'s `existingEncoded` input-selection branch
(`server/src/services/media.service.ts` ~294-295), lost when the fork's rebase-conflict
resolution disabled transcoding for the whole suite. Scopes `TranscodePolicy.All` to a single
new test (rather than flipping the suite-wide default) and waits for the `videoConversion`
queue to drain before trimming, deterministically guaranteeing the encoded variant exists.
