# Video Trimming Design

**Date:** 2026-03-26
**Status:** Approved

## Overview

Add video trimming as the first video editing capability in Gallery. Extends the existing image edit system (crop/rotate/mirror) to support temporal edits on video assets. Uses FFmpeg stream copy for near-instant, lossless trimming at keyframe boundaries.

## Key Decisions

- **Keep original, generate edited copy** — same pattern as image edits. Original untouched, trimmed version stored as edited `EncodedVideo` file.
- **Stream copy only** — no re-encoding. Fast but cuts land on nearest keyframe (potentially several seconds off for sparse GOPs). Known v1 trade-off.
- **Trim as editor tool** — new `EditToolType.Trim` inside the existing editor, not a separate action. Same save/cancel/undo flow as image transforms.
- **Local storage only** — S3-backed videos excluded for v1 to avoid download/upload complexity.

## 1. Backend: Data Model

### EditAction Enum

Add `Trim` to the existing enum:

```typescript
enum EditAction {
  Crop,
  Rotate,
  Mirror,
  Trim,
}
```

### TrimParameters

Client-facing DTO (what the client sends):

```typescript
class TrimParameters {
  @IsNumber() startTime: number; // seconds as float (e.g. 1.5)
  @IsNumber() endTime: number; // seconds as float
}
```

Server enriches with `originalDuration` (float seconds) before storing to JSONB, so the original duration can be restored on undo without re-probing the file.

### Validation Split

- **DTO layer:** `startTime >= 0`, `endTime > startTime`, at most one Trim per edit sequence
- **Service layer:** asset must be `AssetType.Video` (not image, live photo, panorama, GIF), `endTime <= parsedDuration`, no in-progress transcode/edit jobs, local storage only

### Storage

Same `asset_edit` table, same JSONB `parameters` column. No database migration needed.

### Duration Format

Asset table stores duration as a string (`"0:05:23.456789"`). Service converts between string format and float seconds when validating/applying trims.

### Sequencing

For v1, trim is the only edit action allowed on videos. No sequence ordering constraints needed until spatial video edits are introduced.

## 2. Backend: FFmpeg Execution & Job Pipeline

### MediaRepository.trim()

```typescript
async trim(input: string, output: string, startTime: number, duration: number): Promise<void>
```

Runs: `ffmpeg -ss {startTime} -i {input} -t {duration} -c copy -avoid_negative_ts make_zero {output}`

- `-ss` before `-i` for fast keyframe-seeking
- `-t` for unambiguous duration (`duration = endTime - startTime`)
- `-c copy` copies all streams (video + audio, no re-encoding)

### Video Playback Serving

`getForVideo()` in the asset repository must prefer `isEdited: true` encoded video when one exists, mirroring how thumbnail serving works for edited images.

### Job Handler

Extend `handleAssetEditThumbnailGeneration()`. When edits include a Trim action:

1. Ensure local file availability
2. Select input: existing encoded video if available, otherwise original upload
3. Run `MediaRepository.trim()` → write to edited `EncodedVideo` path (`isEdited: true`)
4. Re-probe trimmed output for actual resulting duration, update `asset.duration`
5. Extract a frame from the trimmed video (~10% in) via ffmpeg
6. Generate thumbnail/preview/fullsize from that extracted frame — separate code path from image edit pipeline (which applies spatial transforms)
7. Sync files via existing `syncFiles()` mechanism
8. Emit `AssetEditReadyV1` WebSocket event

### Undo Flow

In `removeAssetEdits()` service method, **before clearing edits:**

1. Read current edits → extract `originalDuration` from Trim parameters
2. Restore `asset.duration` to `originalDuration`
3. Clear edits via `replaceAll(id, [])`
4. Queue job → `syncFiles()` deletes orphaned edited encoded video, thumbnails regenerate from original

### Concurrency

Check for in-progress edit jobs before accepting new trim requests. Reject with a clear error if one is already running.

### Available Tools Header

The GET `/assets/:id/edits` endpoint returns tool availability as a **response header** (`X-Available-Tools`) rather than changing the response body shape. The response remains an array of edits — no breaking API change.

Server logic for computing available tools:

- Image → `Transform`
- Video + local storage + duration known + no active transcode/edit jobs → `Trim`
- Video + S3, or duration null, or job in progress → (empty)
- Live photo → `Transform`

## 3. Frontend: TrimManager & Editor Integration

### TrimManager

New class at `web/src/lib/managers/edit/trim-manager.svelte.ts`. Svelte 5 runes.

**State:**

- `startTime`, `endTime`, `duration` (seconds, float)
- `currentTime`, `isPlaying` — synced from video element via event listeners
- `activeHandle: 'start' | 'end' | null`

**Derived:** `trimmedDuration`, `hasChanges`, `startPercent`, `endPercent`, `currentPercent`

**Video element reference:** AssetViewer holds a `$state<HTMLVideoElement | null>` variable. VideoNativeViewer sets it via `bind:this` through a setter prop. AssetViewer passes the element reference down to EditorPanel as a prop. TrimManager uses an `$effect` that watches the element ref and attaches listeners when it becomes non-null (handles the case where video hasn't mounted yet).

**Seeking:** Handle drag calls `videoElement.currentTime = newTime`, throttled to every 100ms. Final precise seek on drag end.

**Constrained playback:** `$effect` watches `currentTime` — when `>= endTime`, pauses and seeks to `startTime`. ~250ms overshoot from `timeupdate` frequency is acceptable for preview. No loop risk since seeking to `startTime` puts `currentTime < endTime`.

**Handle clamping:** Dragging start past end clamps to `end - 1s`. Dragging end before start clamps to `start + 1s`. Minimum 1-second trimmed duration enforced.

**Keyboard shortcuts:** `I` sets in point, `O` sets out point at current position. Suppressed when `document.activeElement` is an input element.

### Editor Integration

- Add `EditToolType.Trim` to tool types
- `EditManager.activateTool()` reads `X-Available-Tools` header from GET edits response. If Trim isn't available, editor shows a message with the reason — user never sees controls they can't use.
- `EditorPanel` becomes a shell delegating to `ImageEditorLayout` (canvas-based, for transform tool) or `VideoEditorLayout` (keeps video player visible, adds timeline below, sidebar has trim controls). Shell handles shared concerns (save/cancel, edit loading, WebSocket wait). **This is the highest-risk frontend change.**
- `canEdit` guard in `web/src/lib/services/asset.service.ts` expanded to allow videos (currently returns `false` for non-images).
- WebSocket timeout for `AssetEditReadyV1` made asset-type-aware (longer for video).

### Sidebar Controls (when Trim is active)

- Trimmed duration (large, prominent)
- Start / end times (editable text inputs, MM:SS.s format, secondary)
- "Set In" / "Set Out" buttons
- Original duration (tertiary, read-only)
- Reset button

## 4. Frontend: TrimTimeline Component

New component `TrimTimeline.svelte`, positioned below the video player in `VideoEditorLayout`.

### Structure

```
┌──────────────────────────────────────────────────┐
│  ▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▓▓▓▓  │
│  ┊  ├─── kept region (full opacity) ───┤  ┊     │
│  ┊  ▲                    ▲             ┊  ┊     │
│  ┊  in handle         playhead         ┊  ┊     │
│  ┊                                out handle     │
│  └── dimmed ──┘                    └─ dimmed ──┘ │
├──────────────────────────────────────────────────┤
│ 0:00          0:15          0:30          0:45    │
└──────────────────────────────────────────────────┘
```

**Interactive mockup:** `docs/mockups/trim-timeline-mockup.html`

### Layers

1. **Track bar** — full-width, theme's muted/surface color
2. **Trim region overlay** — full opacity between handles, accent border top/bottom. Dimmed+desaturated regions outside.
3. **Playhead** — thin white vertical line with dot cap, moves in real time during playback

### Handles

- Vertical bars with grab affordance (three horizontal grip lines)
- Draggable via `pointerdown` → `pointermove` → `pointerup` on `window`
- `col-resize` cursor on hover/drag
- Drag triggers throttled video seeking via TrimManager

### Interactions

- **Click anywhere on track** → seeks video to that position (moves playhead, not handles)
- **Drag handles** → adjusts trim region, video seeks to handle position
- **Space** → play/pause (loops within trimmed region)
- **I / O keys** → set in/out at current playhead position

### Time Labels

- Start/end times displayed at edges of trim region, update reactively on drag
- Full duration tick marks along bottom
- Format: `M:SS.s` for < 1 hour, `H:MM:SS` for longer

### Sizing & Accessibility

- Full width of video player area, ~48px height
- Handles focusable with `tabindex="0"`, arrow keys nudge ±0.5s
- `aria-label`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` on handles

## 5. Permissions & API

**No new endpoints.** Trim uses the existing edit endpoints:

- **PUT** `/assets/:id/edits` — save trim (`AssetEditCreate` permission)
- **GET** `/assets/:id/edits` — load edits + `X-Available-Tools` header (`AssetEditGet` permission)
- **DELETE** `/assets/:id/edits` — undo/clear (`AssetEditDelete` permission)

Shared spaces: same permission model as existing edits. No special handling.

## 6. Edge Cases

| Scenario                 | Behavior                                                           |
| ------------------------ | ------------------------------------------------------------------ |
| No encoded video yet     | Trim operates on original upload, output is edited `EncodedVideo`  |
| Video still transcoding  | Trim excluded from `X-Available-Tools`, editor shows message       |
| Very short videos (< 2s) | Trim disabled — minimum output is 1 second                         |
| Duration not yet known   | Trim disabled until metadata extraction completes                  |
| Keyframe imprecision     | After trim, server re-probes for actual duration and updates asset |
| Live photos              | Trim not available (treated as images)                             |
| Concurrent edit requests | Service rejects if edit job already in progress                    |
| S3-backed videos         | Trim excluded from `X-Available-Tools`                             |

## 7. Not Included (YAGNI)

- No re-encode option (stream copy only)
- No frame-accurate cuts
- No thumbnail strip/filmstrip in the timeline
- No video preview of trimmed result before saving
- No spatial transforms on video (crop/rotate)
- No multi-segment trimming
- No mobile support
- No S3 storage support
- No undo history / multiple versions
