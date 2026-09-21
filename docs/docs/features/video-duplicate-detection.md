# Video Duplicate Detection

Gallery detects duplicate videos even when a copy has been re-encoded, resized, or converted to a different format. It runs the same CLIP-based model as image duplicate detection, extended to video by sampling several frames and averaging them.

## How It Works

When a video is processed for Smart Search, Gallery extracts several frames and encodes each one with CLIP into an embedding vector. Those per-frame embeddings are then averaged into a single vector that stands for the whole video. Two videos with the same visual content land on nearly identical vectors, whatever their codec, resolution or bitrate.

### Frame Sampling Strategy

The number of frames extracted depends on the video duration:

| Duration        | Frames Extracted                   |
| --------------- | ---------------------------------- |
| Invalid / 0     | 1 frame at the start (t=0)         |
| Under 2 seconds | 1 frame at the midpoint            |
| 2+ seconds      | 8 frames evenly spaced (5% to 95%) |

Short clips and corrupt videos still get processed this way. Longer videos get coverage spread across their whole timeline.

### Matching Rules

- Videos only ever match other videos, never images.
- The duplicate detection distance threshold is the same one used for image duplicates, configurable in **Administration > Machine Learning Settings**.
- Byte-identical uploads per user are already blocked by checksum deduplication. Video duplicate detection catches re-encoded and resized copies that have completely different bytes but the same visual content.

## Configuration

Video duplicate detection needs two features enabled in **Administration > Machine Learning Settings**:

1. Smart Search (CLIP), so that video frames can be encoded into CLIP embeddings. On by default.
2. Duplicate Detection, so that embeddings are compared to find matches. Also on by default.

If both are already on, video duplicates work with no further setup.

### Settings

| Setting                            | Default | Description                                                                                                         |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| Machine Learning > Enabled         | On      | Master toggle for all ML features. Turning it off disables Smart Search, duplicate detection, plus everything else. |
| Smart Search > Enabled             | On      | Enables CLIP encoding for both images and videos.                                                                   |
| Duplicate Detection > Enabled      | On      | Enables duplicate grouping based on CLIP embedding similarity.                                                      |
| Duplicate Detection > Max Distance | 0.01    | Maximum cosine distance between two embeddings to consider them duplicates. Lower = stricter.                       |

### Disabling

There is no video-only toggle. The duplicate detection setting covers images and videos alike. To disable all duplicate detection, turn off **Duplicate Detection > Enabled**. To keep image duplicates but skip videos, disable **Smart Search**, which also disables image smart search.

## Using Video Duplicates

### Reviewing Duplicates

1. Go to **Utilities > Duplicates**.
2. Video duplicates appear in the same list as image duplicates.
3. Review them side by side. The comparison shows file size, resolution, codec, plus any other metadata.
4. Choose to **keep** the highest quality version and **trash** the rest, or **stack** them together.

### Re-scanning Existing Videos

To detect duplicates in videos uploaded before this feature was available:

1. Go to **Administration > Jobs**.
2. Run the **Smart Search** job for all assets. That generates CLIP embeddings for videos that don't have them yet.
3. Run the **Duplicate Detection** job to find matches.

## Technical Implementation

### Encoding Pipeline

```
┌──────────────────────────────────────────────────────────────────────┐
│  Smart Search Job (per video asset)                                  │
│                                                                      │
│  ┌─────────┐    ┌───────────────┐    ┌───────────────┐              │
│  │ ffprobe │───►│ Calculate     │───►│ Extract       │              │
│  │ duration │    │ timestamps    │    │ frames (JPEG) │              │
│  └─────────┘    │ (8 @ 5%-95%) │    │ via ffmpeg    │              │
│                  └───────────────┘    └───────┬───────┘              │
│                                               │                      │
│                                    ┌──────────▼──────────┐           │
│                                    │ CLIP encode each    │           │
│                                    │ frame (sequential)  │           │
│                                    └──────────┬──────────┘           │
│                                               │                      │
│                                    ┌──────────▼──────────┐           │
│                                    │ Average embeddings  │           │
│                                    │ (element-wise mean) │           │
│                                    └──────────┬──────────┘           │
│                                               │                      │
│                                    ┌──────────▼──────────┐           │
│                                    │ Upsert into         │           │
│                                    │ smart_search table  │           │
│                                    └─────────────────────┘           │
└──────────────────────────────────────────────────────────────────────┘
```

1. Probe: `ffprobe` reads the video duration from the container metadata.
2. Timestamp calculation: 8 evenly spaced timestamps are generated from 5% to 95% of the duration, adapted for short or invalid videos as described above.
3. Frame extraction: for each timestamp, `ffmpeg -ss <t> -frames:v 1` extracts a single JPEG frame into a temporary directory.
4. CLIP encoding: each extracted frame goes to the machine learning service's existing `/predict` endpoint. Frames are encoded one at a time so the ML service is not overloaded.
5. Averaging: the per-frame embedding vectors are combined by element-wise mean into a single 512-dimensional vector.
6. Storage: the averaged vector is upserted into the existing `smart_search` table, the same table used for image embeddings.

### Key Implementation Details

- No schema changes: video embeddings live in the same `smart_search` table as image embeddings. One vector per asset.
- No API changes: the `GET /duplicates` endpoint and `DuplicateResponseDto` are type-agnostic and work with image and video duplicate groups alike.
- No frontend changes: video duplicates appear in the existing Duplicates page, whose comparison UI already renders video assets.
- No ML service changes: the ML service receives individual frame images through the existing CLIP encoding endpoint.
- Temp file isolation: each job creates a unique temporary directory via `mkdtemp`, so concurrent Smart Search jobs cannot collide. The directory is cleaned up in a `finally` block whether the job succeeded or failed.
- Graceful degradation: if some frames fail to extract (a seek past the end of the file, say), the frames that did come out are averaged. The job only fails when every frame fails, or when `ffprobe` cannot read the video.

### Job Flow

Video duplicate detection reuses the existing job pipeline. No new queues:

1. Smart Search job: when processing a video asset, `handleEncodeClip` in `smart-info.service.ts` detects the asset type and branches into the video encoding path (probe, extract frames, encode, average, upsert).
2. Duplicate Detection job: the existing `duplicate.service.ts` queues per-asset detection jobs. `duplicate.repository.ts` runs a vector similarity search filtered by `asset.type`, so videos only match videos.
3. No new configuration: the existing `duplicateDetection` admin settings (enabled toggle, distance threshold) apply to images and videos alike.
