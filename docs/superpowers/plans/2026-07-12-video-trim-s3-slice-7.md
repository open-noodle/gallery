# Video Trim on S3 — Slice 7: Turn the e2e phase green and wire it in

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the fix end to end against real MinIO and real ffmpeg, then wire the `video-trim-s3` phase into CI so #671 cannot come back.

**Architecture:** Slice 1 added the phase and left it unwired (reachable only via `--phase video-trim-s3`), so CI stayed green while the fix landed across Slices 2–6. Now the phase should pass. Once it does — and only once it has passed three times in a row — add it to the explicit phase list in the CI workflow's `backend=s3` group and to the full-workflow sequence in `storage-migration.sh`, and delete the "no video asset upload" line from the harness README's known gaps, because it is no longer true.

**Tech Stack:** Docker Compose (MinIO + Immich server + Postgres), `tsx`, GitHub Actions.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-video-trim-s3-design.md`, Slice 7.
- Slices 1–6 are complete: trim is enabled on S3 at the API, and the job materializes its input, persists the trimmed video under an `_edited` key, and persists its thumbnails.
- **No flaky test gets wired into CI.** If the phase is not green three consecutive times, do not wire it — fix the root cause. Never add retries or sleeps to paper over a failure.
- This stack binds :2285 and Postgres :5435. Do not run it alongside `make dev` or `make e2e`.
- All commands run from `e2e/` with `export COMPOSE_FILE=docker-compose.yml:docker-compose.storage-migration.yml`.

---

### Task 1: Rebuild the server image and turn the phase green

**Files:** none (verification only)

- [ ] **Step 1: Rebuild the server image with the fix and bring the stack up in S3 mode**

```bash
cd e2e
export COMPOSE_FILE=docker-compose.yml:docker-compose.storage-migration.yml
docker compose down -v --remove-orphans
IMMICH_STORAGE_BACKEND=disk docker compose up -d --build --wait --wait-timeout 600
docker compose exec -T minio sh -c "mc alias set local http://localhost:9000 minioadmin minioadmin && mc mb local/immich-test --ignore-existing"
pnpm tsx src/storage-migration.ts setup
IMMICH_STORAGE_BACKEND=s3 docker compose up -d --no-deps --force-recreate --wait --wait-timeout 180 immich-server
```

The `down -v` matters: the image must be rebuilt from the fixed source, and a stale volume would carry assets from earlier runs.

- [ ] **Step 2: Run the phase — expect GREEN**

```bash
pnpm tsx src/storage-migration.ts video-trim-s3
```

Expected: `=== Phase: video-trim-s3 complete ===`, with every assertion passing — the edited video and thumbnails present in MinIO under relative `_edited` keys, the transcoded original byte-identical, playback 200, no local leftover, and the undo removing the edited objects.

If it fails, read the failure carefully before touching anything:

- 400 `cloud-stored` → Slice 2 did not land in the built image; rebuild.
- ENOENT in the trim job → Slice 4 did not land.
- `Edited encoded_video missing from MinIO` → Slice 5.
- `Edited preview/thumbnail missing from MinIO` → Slice 6.
- `Trimmed video left on local disk` → `persistFile` uploaded but did not unlink.
- `Non-edited encoded video was overwritten` → the edited key is colliding with the non-edited one; Slice 5's `StorageCore` statics are wrong.

- [ ] **Step 3: Prove it is not flaky — three consecutive green runs**

```bash
for i in 1 2 3; do
  echo "=== run $i ==="
  pnpm tsx src/storage-migration.ts video-trim-s3 || { echo "RUN $i FAILED"; break; }
done
```

Expected: three passes. The phase deletes its asset and restores the ffmpeg config in a `finally`, so runs are independent — a second run re-uploads the same bytes and gets a fresh asset.

If any run fails, that is a real defect (most likely a race with `waitForProcessing`, or teardown not restoring state). Fix the cause. **Do not** wire a flaky phase into CI; if it cannot be made deterministic, stop and report, leaving the phase unwired and saying so in the PR.

---

### Task 2: Wire the phase into CI and the full workflow

**Files:**

- Modify: `.github/workflows/storage-migration-tests.yml`
- Modify: `e2e/storage-migration.sh`
- Modify: `e2e/README-storage-migration.md`

- [ ] **Step 1: Add the phase to the CI workflow**

In `.github/workflows/storage-migration-tests.yml`, in the `backend=s3` phase group, immediately after the `'Phase: copy-asset-sidecar-s3'` step:

```yaml
- name: 'Phase: video-trim-s3'
  run: pnpm tsx src/storage-migration.ts video-trim-s3
```

It must sit inside the s3 group (the server is restarted into `IMMICH_STORAGE_BACKEND=s3` there) and **before** the later `migrate-to-disk` step.

- [ ] **Step 2: Add the phase to the full-workflow sequence**

In `e2e/storage-migration.sh`, in the `Main` block's full-workflow branch, after `run_phase migrate-to-s3` (the server is in s3 mode at that point):

```bash
  run_phase video-trim-s3
```

- [ ] **Step 3: Update the README's known gaps**

In `e2e/README-storage-migration.md`, delete the `- No video asset upload (transcoding too slow/unreliable in e2e)` bullet from the **Known gaps** list — it is now false — and document the phase under **Phases**:

```markdown
4. **video-trim-s3** - Uploads a video, forces a transcode, trims it, and validates that the edited
   encoded video and its thumbnails are persisted to S3 under `_edited` keys, that the transcoded
   original is not overwritten, that nothing is left on local disk, and that undo removes the edited
   objects. Covers gh#671.
```

- [ ] **Step 4: Run the whole harness end to end**

```bash
cd e2e
./storage-migration.sh --cleanup --verbose
```

Expected: `ALL PHASES PASSED`. This is the regression check that matters — `migrate-to-disk` runs after our phase and has never seen `encoded-video` rows before.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/storage-migration-tests.yml e2e/storage-migration.sh e2e/README-storage-migration.md
git commit -m "ci(e2e): gate video trim on S3 with the video-trim-s3 phase (#671)

The phase reproduced #671 before the fix and passes after it. Wire it into the
backend=s3 group so the gap that let this ship — 'no video asset upload' in the
storage-migration harness — is closed."
```

---

### Task 3: Push and open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin worktree-fix-671-video-trim-s3
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --repo open-noodle/gallery --base main \
  --title "fix(editing): enable video trim on S3-backed storage (#671)" \
  --body "$(cat <<'EOF'
Closes #671.

## What was broken

Two layers, and the issue only described the inner one.

**The feature was fenced off at the API.** `AssetService.editAsset` rejected any trim whose asset was not an `isImmichPath` — which is every S3-backed asset, since those originals are relative keys. `PUT /assets/:id/edits` returned 400 "Video trimming is not available for cloud-stored videos" before a job was ever queued. The web editor has no matching client-side gate, so S3 users saw the trim tool, hit save, and got a refusal.

**Behind that guard, `handleVideoTrim` was broken for S3** in three ways (latent, because the guard made them unreachable): it never persisted the trimmed video, never persisted the trim thumbnails, and handed the existing encoded video's S3 key straight to ffmpeg (ENOENT for any already-transcoded asset — the common case).

## What changed

- The API guard now rejects only absolute paths outside the media location (external-library videos), so S3 assets are allowed through. The pre-flight audio-only probe resolves its input via the new `StorageBackend.getReadableUrl` — an absolute path on disk, a presigned URL on S3 — so ffprobe reads the header without downloading the whole video inside the request.
- `handleVideoTrim` materializes its encoded-video input with `ensureLocalFile`, persists the trimmed video under a new `_edited` key (`getRelativeEncodedVideoPath` returns the NON-edited key — persisting with it would have overwritten the asset's transcoded original in the bucket), and persists its thumbnails.
- The persist loop was copy-pasted three times and missing from the trim path, which is how this was missed. It is now one `persistImageFiles` helper used by all four image output paths.

## Tests

- 12 unit tests across `media.service`, `asset.service`, and both storage backends. Five of them are guards that pass on arrival, so each was mutation-proved — the mutation is named in the spec and was run.
- A new **`video-trim-s3` e2e phase** in the MinIO storage-migration harness: it uploads a video, forces a transcode, trims it, and asserts the edited video and thumbnails land in the bucket under `_edited` keys, the transcoded original is byte-identical afterwards, nothing is left on local disk, playback serves the trimmed video, and undo removes the edited objects. It failed against unfixed code with the exact 400 above, and passes now.
- That phase closes the harness gap ("no video asset upload") that let #671 ship in the first place.

## Notes

- This **enables a feature on S3 installs** (trim was previously unavailable there), so it wants a release-note line.
- Fix-forward only: no S3 install ever produced a broken trim, because the guard blocked it, so there is nothing to repair.
- #741 (realtime HLS ignores the trim) is a separate follow-up and depends on this: it needs the trimmed video to actually exist in the bucket.

Spec: `docs/superpowers/specs/2026-07-12-video-trim-s3-design.md`
EOF
)"
```

- [ ] **Step 3: Babysit CI** — follow the `babysit` skill until green.

---

## Self-Review

**Spec coverage:** all five Slice 7 steps — green run, three-run stability gate, CI + `.sh` wiring, full-harness regression run, README gap removal.

**Placeholders:** none.

**Consistency:** the CI step goes in the `backend=s3` group next to `copy-asset-sidecar-s3` (spec), and before `migrate-to-disk` (which the phase's teardown is designed not to disturb). The PR body's claims match what the slices actually did.
