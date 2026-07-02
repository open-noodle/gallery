# Slice 8 — M5: `assetV2` sync path applies the #627 motion-asset hide sweep

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 8"
**Findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` M5
**Branch / worktree:** `rebase/upstream-rolling-20260509-active`

---

## Step A — grounding

### The #627 predicate (already a single shared private method)

`mobile/lib/infrastructure/repositories/sync_stream.repository.dart`:

- `updateAssetsV1` (asset sync V1, line ~203) writes the batch, then calls
  `await _hideReferencedLivePhotoMotionAssets();` (line 239).
- `_hideReferencedLivePhotoMotionAssets()` (line 285) is a raw-SQL sweep, **not**
  scoped to the incoming batch — it re-derives the predicate from the whole table
  every time it runs:

  ```sql
  UPDATE remote_asset_entity
  SET visibility = ?              -- AssetVisibility.hidden.index
  WHERE id IN (
    SELECT live_photo_video_id
    FROM remote_asset_entity
    WHERE live_photo_video_id IS NOT NULL
  )
  AND visibility != ?             -- AssetVisibility.hidden.index (no-op if already hidden)
  ```

  **Predicate in plain terms:** a `remote_asset_entity` row is a live-photo motion
  part iff its `id` is referenced by some other row's `live_photo_video_id` column
  (i.e. some still-image row points at it as its paired video). Any such row that
  isn't already `hidden` gets flipped to `AssetVisibility.hidden`. "Hidden" is
  represented purely as the `visibility` column value on `remote_asset_entity`
  (`AssetVisibility.hidden`, enum index 1) — no separate boolean/flag.

- `updateAssetsV2` (asset sync V2, line ~246 — the v3 `assetV2` protocol) writes
  the batch with the **same** companion shape (including `livePhotoVideoId`) but
  never calls `_hideReferencedLivePhotoMotionAssets()`. This is the M5 gap: a
  v3 server drives `assetV2`, so the still→motion link lands in the DB but the
  motion row's `visibility` is never swept to hidden — it reappears in the
  timeline.

### Callers confirm `updateAssetsV2` is the v3 catch-all asset path

`mobile/lib/domain/services/sync_stream.service.dart` routes ALL v2/v3 asset
entity kinds through `updateAssetsV2`: `assetV2`, `partnerAssetV2`,
`partnerAssetBackfillV2`, `albumAssetCreateV2`, `albumAssetUpdateV2`,
`albumAssetBackfillV2` — mirroring how `updateAssetsV1` is the catch-all for the
V1 kinds. Since the sweep is a whole-table re-derivation (not batch-scoped),
fixing it once inside `updateAssetsV2` covers every v2/v3 call site
identically to how the one call inside `updateAssetsV1` covers every v1
call site — no per-call-site changes needed in `sync_stream.service.dart`.

### Predicate is already factored — no duplication needed

`_hideReferencedLivePhotoMotionAssets()` is a private instance method with zero
parameters; it does not read from the batch passed to `updateAssetsV1`/`V2` at
all (it re-scans the table). So "factor the shared predicate into one place" is
already satisfied by the existing method — the minimal fix is a single call,
not a new helper.

---

## Step B — files / tests / impl

### Files changed

1. `mobile/lib/infrastructure/repositories/sync_stream.repository.dart` —
   add `await _hideReferencedLivePhotoMotionAssets();` at the end of the
   `updateAssetsV2` try block, mirroring `updateAssetsV1` line 239.
2. `mobile/test/domain/repositories/sync_stream_repository_test.dart` —
   extend the existing `SyncStreamRepository - Live photos` group with V2
   coverage (see below).

   > **Deviation from the spec/prompt's literal path** (
   > `mobile/test/infrastructure/repositories/sync_stream_repository_test.dart`):
   > that path does not exist, and `SyncStreamRepository` — despite living
   > under `lib/infrastructure/repositories/` — has its **only** existing test
   > file at `mobile/test/domain/repositories/sync_stream_repository_test.dart`
   > (confirmed: no other repository test is split this way; every other
   > `infrastructure/repositories/*.dart` file's test lives under
   > `test/infrastructure/repositories/`, but this one repo's test predates
   > that convention and already covers `updateAssetsV1`'s live-photo sweep in
   > a `Live photos` group at that path). Creating a second, parallel test
   > file at the "correct" directory would duplicate `setUp`/`tearDown`
   > boilerplate and split one repository's coverage across two files.
   > Extending the existing file is the literal reading of "mirror the
   > existing sync-stream test setup — look for existing tests of this
   > repository['s] ... motion handling to copy the mocking/DB pattern."
3. `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` — M5 Status →
   `FIXED (slice S8)`.

### RED test — extend `SyncStreamRepository - Live photos` group

Reuse the file's existing `_createAsset` (already takes `livePhotoVideoId`) —
but it builds a `SyncAssetV1`. Add a small `SyncAssetV2` builder mirroring the
same fields (V2 asset lacks `deletedAt`/`libraryId`? — check the DTO; V2 has a
narrower shape, `duration` is already an `int` not `Optional<Period>`,
`deletedAt` and `stackId`/`libraryId` still present). New tests:

1. **`hides motion asset when a V2-synced still references it`** — sync a
   motion asset and a still via `updateAssetsV2` (linking `livePhotoVideoId`).
   Assert the motion row's `visibility.name == 'hidden'` after the still syncs.
   Expected RED: `updateAssetsV2` never calls the sweep, so the motion row
   stays `timeline`.
2. **`does not hide a non-motion asset in the same V2 batch`** — a batch
   containing the still + motion + a third, unrelated normal asset (no
   `livePhotoVideoId` link to/from it) — assert the normal asset's visibility
   is unchanged (`timeline`).
3. **`hides a motion part synced with no linked still (edge case)`** — sync
   only a video asset via `updateAssetsV2` with no other row referencing it as
   `live_photo_video_id` — assert it stays **visible** (`timeline`), matching
   the old path's behavior: the predicate only fires when some *other* row's
   `live_photo_video_id` points at it, so an orphaned/unreferenced video is
   never hidden by this sweep either path.
4. **`idempotent re-sync of the same V2 batch stays hidden, no error`** — call
   `updateAssetsV2` with the identical `[motion, still]` batch twice; assert
   no throw and the motion row is still hidden after the second call.

Expected RED (from test 1): `flutter test` fails —
`Expected: 'hidden' Actual: 'timeline'` (or equivalent) on the motion row's
`visibility.name` assertion.

**Command:**
`cd mobile && mise exec -- flutter test test/domain/repositories/sync_stream_repository_test.dart`

### Minimal impl (GREEN)

In `updateAssetsV2`, after the `_db.batch(...)` write and before the closing
`catch`, add:

```dart
await _hideReferencedLivePhotoMotionAssets();
```

(Identical statement to the one in `updateAssetsV1`; no new method, no schema
change — `_hideReferencedLivePhotoMotionAssets` is untouched.)

### Edge cases covered

- Motion part **with** a linked still → hidden (test 1).
- Motion part **without** a linked still → stays visible per old-path semantics
  (test 3) — the sweep is a join, not "hide all videos".
- Normal (non-motion) asset in the same batch → unaffected (test 2).
- Idempotent re-sync of the same batch → still hidden, no error (test 4) — the
  sweep's `AND visibility != ?` guard makes re-running it a no-op on
  already-hidden rows, and the batch upsert (`onConflict: DoUpdate`) makes the
  asset write itself idempotent too.

### GREEN commands

```
cd mobile && mise exec -- flutter test test/domain/repositories/sync_stream_repository_test.dart
cd mobile && mise exec -- dart analyze lib/infrastructure/repositories/sync_stream.repository.dart test/domain/repositories/sync_stream_repository_test.dart
```

### Commit

`fix(mobile): hide live-photo motion assets on assetV2 sync path (M5)`
