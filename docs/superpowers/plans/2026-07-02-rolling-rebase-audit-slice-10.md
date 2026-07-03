# Slice 10 — M1: realtime HLS transcoding `ensureLocalFile` + trim-aware input

**Finding:** M1 · `server/src/services/transcoding.service.ts` (~:240)
**Date:** 2026-07-02
**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 10 — M1"

---

## Grounding (verified against the code)

### The realtime-HLS pipeline is session-based and packet-metadata-driven

- `HlsService.getMainPlaylist` / `getMediaPlaylist` (`hls.service.ts`) generate the
  client playlist. `getSegmentation` / `generateMediaPlaylist` compute `segmentCount`,
  `fps`, `framesPerSegment`, and each segment's `#EXTINF` duration from
  `asset.packets` + `asset.videoStream` (fetched via
  `videoStreamRepository.getForMainPlaylist` / `getForMediaPlaylist`).
- `TranscodingService.startTranscode` (`transcoding.service.ts:180`) spawns a
  **persistent** ffmpeg via `processRepository.spawn` that streams segments into
  `variantDir` over the session lifetime, re-invoked on seek/variant change. Its seek
  math (`fps`, `gop`, `seekSeconds` at :212-214) uses the **same** `asset.packets` /
  `asset.videoStream` (via `videoStreamRepository.getForTranscoding`).
- **`asset_keyframe` / `asset_video` are probed from `originalPath` only**
  (`metadata.service.ts:1257` `probePackets(originalPath, …)`; keyframe rows written at
  `asset.repository.ts:429`). A trim (`media.service.ts handleVideoTrim`, run from
  `handleAssetEditThumbnailGeneration`) writes a shorter `_edited.mp4`
  (`AssetFileType.EncodedVideo, isEdited:true`) and updates only `asset.duration` +
  thumbnails — it never recomputes `asset_keyframe` / `asset_video`.

### The bug (M1)

`startTranscode` at :240 passes `inputPath: asset.originalPath` straight to
`getHlsCommand`. `getForTranscoding` selects `asset.originalPath` — a **relative S3
key** on S3-primary installs. So:

- **(a) S3 correctness:** ffmpeg gets a bare key, not a readable local path → fails
  outright on S3-primary storage (the gh#671 shape). **PRIMARY bug.**
- **(b) Trim-awareness:** ffmpeg reads the original, ignoring the fork's trimmed
  `_edited.mp4`.

### ensureLocalFile (`base.service.ts:398`)

`protected async ensureLocalFile(filePath)` → `{ localPath, cleanup }`. Absolute path →
`{ localPath: filePath, cleanup: async () => {} }` (cheap passthrough, disk unaffected).
Relative key → downloads via the S3 backend to a temp file; `cleanup` removes it.

---

## Decision: implement (a); STOP-report (b)

### (a) S3 correctness + session-scoped cleanup — IMPLEMENT (this slice)

Self-contained to `transcoding.service.ts` + its `Session` type. Materialize the local
input **once per session** and clean it up on every teardown path.

### (b) Trim-awareness — DEFER + report (STOP condition triggered)

Two independent reasons, both matching the spec's STOP conditions:

1. **The non-realtime path selects differently than the task's pointer.** The fork's
   _authoritative playback_ selector is `AssetMediaService.playbackVideo`
   (`asset-media.service.ts:246-252`): `getForVideo(id)` →
   `filepath = asset.encodedVideoPath || asset.originalPath`, where `encodedVideoPath`
   is the `EncodedVideo` file `ORDER BY isEdited DESC LIMIT 1`
   (`asset.repository.ts:1720-1735`) — i.e. prefer the trimmed `_edited.mp4`. The task
   pointed at `handleVideoTrim` (`media.service.ts:292`
   `files.find(f => f.type === EncodedVideo && !f.isEdited)`), but that is the trim
   **source** selector (must be _un-trimmed_), not the playback selector.
2. **A bare input swap desyncs the HLS pipeline → a WORSE bug.** The playlist's
   `segmentCount` / `#EXTINF` durations and the transcode seek math are both derived
   from the **original's** `asset_keyframe` / `asset_video`, which a trim does not
   recompute. Feeding ffmpeg the shorter `_edited.mp4` while the playlist advertises the
   original's (longer) segment count means: segments past the trimmed duration never
   materialize → the dir watcher never fires → `HlsService.pendingSegments.wait` times
   out (15 s) → client stalls; in-range segments are misaligned. Current behaviour
   (plays the untrimmed original coherently) is strictly better than that.

Proper trim support in realtime HLS therefore requires threading the **trimmed video's
own** packet/keyframe metadata through `getForMainPlaylist` / `getForMediaPlaylist` /
`getForTranscoding` **and** `hls.service.ts` segmentation — i.e. recomputing packets for
`_edited.mp4` (a `probePackets` on the edited path + storage/threading). That is a
multi-file feature spanning `hls.service.ts`, `video-stream.repository.ts`, and the
keyframe pipeline — well beyond "touches only `transcoding.service.ts` + its `Session`
type". Deferred to a dedicated follow-up slice.

---

## Files & lines (implemented half)

- `server/src/services/transcoding.service.ts`
  - `Session` type (~:24): add `input: Promise<{ localPath: string; cleanup: () => Promise<void> }> | null`.
  - `onSessionRequest` (~:70): initialize `input: null` on the new session object.
  - `startTranscode` (~:216-240): materialize once —
    `session.input ??= this.ensureLocalFile(asset.originalPath)` (synchronous assign, no
    await between read+assign → concurrent-start safe), `const { localPath } = await session.input;`
    then `inputPath: localPath` in `getHlsCommand`.
  - `onSessionEnd` (~:106): `await this.cleanupSessionInput(session);` before/after the
    existing teardown.
  - New private `cleanupSessionInput(session)`: null-safe + idempotent (nulls
    `session.input`) + rejection-safe (download failure has nothing to clean).
- `server/src/services/transcoding.service.spec.ts` — new tests (below).

`failSession` and `removeInactiveSessions` (idle eviction) already funnel through
`onSessionEnd`, so cleanup is inherited on those paths for free.

---

## RED tests (transcoding.service.spec.ts)

Shared harness change: in the top-level `beforeEach`, spy
`ensureLocalFile` to passthrough (`{ localPath: p, cleanup: <tracked> }`) so the existing
command/seek suites (fixtures use relative bare filenames like `eiffel-tower.mp4`) stay
green and my impl's call is observable. On current code this spy is inert (impl never
calls it), so existing tests stay green and the new tests go RED.

1. **S3 local input:** with `ensureLocalFile` returning a distinct temp path, a
   first-segment request calls `ensureLocalFile(asset.originalPath)` and the spawned
   ffmpeg args contain `-i <tempPath>` and NOT the raw key. RED: impl passes the raw key,
   never calls the spy.
2. **Cleanup at session end (exactly once, not in a spawn-finally):** after a transcode
   starts, `onSessionEnd` invokes the stored cleanup exactly once. RED: no cleanup wired.
3. **Cleanup via failSession:** a config-create failure (`failSession` → `onSessionEnd`)
   invokes cleanup exactly once. RED: no cleanup wired.
4. **Cleanup via idle eviction:** the inactivity sweeper (`removeInactiveSessions` →
   `onSessionEnd`) invokes cleanup exactly once. RED: no cleanup wired.
5. **Null-safe for never-transcoded session:** `onSessionRequest` then `onSessionEnd`
   with no segment request → cleanup never called, no throw. (GREEN on current code too —
   guard/no-regression assertion.)
6. **Re-transcode reuse:** two segment requests forcing a variant-change restart call
   `ensureLocalFile` **once** (once per session, not per transcode). RED: 0 calls now.
7. **Concurrent sessions independent temp files:** two sessions each materialize their
   own temp file and each cleanup fires independently on its own `onSessionEnd`. RED.
8. **Local passthrough no-regression:** absolute `originalPath` → ffmpeg `-i <sameAbsPath>`
   (spy passthrough), cleanup is the no-op. (Reinforced by existing command suites.)

RED command:
`cd server && pnpm test -- --run src/services/transcoding.service.spec.ts`

Expected RED: tests 1,2,3,4,6,7 fail (impl passes `asset.originalPath` directly, never
calls `ensureLocalFile`, no per-session cleanup). 5,8 stay green.

---

## GREEN

`cd server && pnpm test -- --run src/services/transcoding.service.spec.ts` → all green.
`cd server && npx tsc --noEmit -p tsconfig.json` → no new `error TS` (ignore the 3
pre-existing `exif/audio-video.spec.ts` ffprobe failures).

## Commit

`fix(server): realtime HLS uses local file on S3 (M1 part a)` — body: session-scoped
`ensureLocalFile` materialization (once per session, reused across seek/variant
re-transcodes) with cleanup on every teardown path (onSessionEnd / failSession / idle
eviction / shutdown), null-safe + idempotent. Notes trim-aware input deferred (part b)
with the packet-metadata-desync rationale.

## Status

Set M1 in the findings doc to `PARTIAL (slice S10)` — S3 local-file half landed;
trim-aware input deferred with rationale (NOT full `FIXED`, to stay accurate).
