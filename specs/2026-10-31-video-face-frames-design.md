# Video faces: detect across the whole video, keep the best view

**Date:** 2026-10-31
**Status:** Phase 1 implemented (server sampling, tracking, best-frame crops, web crop source, admin settings); unit
tested, not yet run on a real library or against a database. Phase 2 (sightings UI) not started.

## Summary

Faces in videos are hard to name: the crop shown when assigning one is usually a blurry smudge, and people who appear
after the first second or two are never found at all. Both come from the same place: Immich runs face detection on
**one frame per video**, the video's preview image, and that frame is chosen without regard to faces or sharpness.

With this feature, face detection samples frames across the whole video from the original file. It groups the
detections that belong to the same person, and keeps **one face per person per video**. Each face's box comes from the
sharpest, largest, most confident view of that person, and its embedding is averaged over their best few views. That
best frame is stored, so every face crop (the person thumbnail, the review and face-cleanup crops, the asset viewer
panel) is cut from a sharp, full-resolution frame instead of the upscaled poster.

Phase 2 uses the sightings stored here to show, when assigning a video face, a strip of the frames where that person
appears, each one opening the video at that moment.

## How it works today

1. `PersonService.handleDetectFaces` (`server/src/services/person.service.ts`) sends the asset's preview file to the
   ML service. For a video that is the single poster image `generateVideoThumbnails` made; nothing else in the video
   is looked at.
2. The poster comes from `ThumbnailConfig` (`server/src/utils/media.ts`): keyframes only (`-skip_frame nointra`),
   resampled to 12 fps, `thumbnail=12`, then the first scene change above 0.1 or whatever frame it reaches by frame 20.
   In practice that is the first second or two, often while the camera is still moving.
3. The poster is downscaled to the preview size and lossily encoded. The person thumbnail
   (`MediaService.handleGeneratePersonThumbnail`) and the fork crop route (`BackendMediaServer.generateFaceThumbnailResponse`)
   cut the face out of it and upscale it to 250 × 250 (`FACE_THUMBNAIL_SIZE`).
4. The web asset viewer does worse: `zoomImageToBase64` (`web/src/lib/utils/people-utils.ts`) crops video faces in the
   browser from the asset's **thumbnail** (250 px on the long edge), so a face 20 px wide is blown up to fill the panel.
5. The embedding is taken from that same blurry face, so recognition matches videos less reliably than photos.

The face-cleanup photo-context design listed "face on a video asset" as working because the preview is an image
(`specs/2026-09-03-face-cleanup-photo-context-design.md`, E11). That holds for the plumbing, not for the result.

## Goals and non-goals

**Goals**

- Find every person who is on screen for more than a moment, however long the video.
- Show each video face from its best moment: sharp, large, frontal enough for the detector to be confident.
- Better embeddings for video faces, so recognition assigns them as reliably as photo faces.
- Re-scanning an existing video keeps the user's assignments.
- Nothing changes for photos, for stock Immich clients, or for a database switched back to Immich beyond what is
  listed under Version pairings.

**Non-goals (Phase 1)**

- A UI listing every sighting (Phase 2).
- Face boxes drawn over a playing video.
- Changing how the video poster is chosen. That is upstream's `ThumbnailConfig`, and the poster is also the timeline
  thumbnail.

## Sampling frames

Detection runs on frames extracted from the **original** file (staged locally through `backendMedia.ensureLocalFile`
when it lives in S3), not on the encoded playback copy, which may be heavily compressed.

Timestamps come from two sources, merged and de-duplicated:

1. **An even interval**, every `sampleInterval` seconds (default 2), starting half an interval in so a 1-second clip
   still gets a frame. A clip of a minute or less is sampled at least once a second whatever the setting
   (`sampleIntervalFor`): on test clips of 9 to 23 seconds, 5 to 12 frames gave each person too few chances to be seen
   clearly, and per-person confidence (below) needs several sightings to work.
2. **Scene cuts**, when `sceneDetection` is on (default). One ffmpeg pass decodes keyframes only (`-skip_frame nokey`)
   through `select='gt(scene,0.3)'` and reports their times, at a fraction of the cost of a full decode. A sample is
   added just after each cut, so a shot shorter than the interval is still looked at. This only sees cuts the encoder
   marked with a keyframe. x264 and x265 usually do, but not always: on a generated test clip with two hard cuts, x264
   keyframed one, and the pass found exactly that one. An unmarked cut is still covered by the interval samples unless
   its shot is shorter than the interval. Finding every cut would mean decoding every frame, roughly the cost of the
   video's own transcode, which is too much to spend on every video by default. Phone footage has no cuts and costs
   one cheap pass.

There is **no small fixed cap**. An early draft capped every video at 30 frames, which on a 20-minute video means one
frame every 40 seconds and missed people in long videos. Instead `maxFrames` (default 1800, admin range 10 to 10 000)
is a budget: when interval samples plus cut samples would exceed it, the interval is stretched until they fit, so the
whole video is still covered evenly. 1800 frames is one hour at the default interval; a three-hour video is sampled
every 6 seconds. An admin who wants denser coverage of long videos raises the budget.

A trimmed video (`asset_video_trim`) is sampled only inside its kept range, so people cut out of the video are not
found in it. Times are stored in the original's timeline, which is the one `asset_video_trim` uses.

Frames are extracted with a fast input seek, scaled to 1440 px on the short edge (never enlarged) and tone-mapped with
the same filters the poster uses (`BaseConfig.getFilterOptions` on a `ThumbnailConfig`, without its poster-picking
filters), so an HDR phone video is not washed out. They are written as JPEG to a temporary folder. 1440 px is well
above what the detector uses (it letterboxes to 640) and plenty for a 250 px crop with room to zoom. The next frame is extracted while the ML service works on the current one. A frame is deleted as
soon as it is not the best view of any person, so the temporary folder holds a handful of files, not the whole video.

## Grouping detections into people

Each detection is a box, a detector score and a 512-d embedding. Detections are grouped into **tracks**, one per person,
in time order:

- A detection joins the track whose centroid (the normalised mean of its embeddings) or latest sighting is nearest by
  cosine distance, if that distance is under `facialRecognition.maxDistance` (default 0.5, the threshold recognition
  already uses to tie faces to a person).
- If the track was also seen in the previous sample and the face is still where it was (its centre within one face of
  the old centre, at no more than twice or half the size), the threshold is relaxed by 0.1. An overlap test (IoU > 0.3)
  came first, and split a 10 px face in a 320 x 240 clip into three people: a second's drift of half its width left the
  boxes overlapping by 16 %, while faces that small have embeddings 0.51-0.54 apart.
  A person turning their head between two samples is still the same track.
- Two detections in one frame never join the same track: each frame is matched one-to-one, best pairs first.
- A detection that matches no track starts a new one.

A final pass merges two tracks whose centroids are within `maxDistance` and which never appear in the same frame. This
catches a person first seen in profile and later frontally.

### Per-person confidence

A photo face is kept when the detector scores it at least `facialRecognition.minScore` (default 0.7). Applied to each
video frame on its own, that loses people. On a 320 x 240 test clip, two people clearly on screen, with faces of 60 to
109 px, scored 0.37 to 0.59 in every frame for seconds at a time and were never found, while a third crossed 0.7 in
one frame only. In a video, being found again and again is evidence a photo cannot offer.

So frames are searched at a lower score, `VIDEO_FACE_LOW_SCORE` (0.45, or the admin's minimum if that is lower), and
after tracking each person is judged as a whole (`acceptTrack`). A track whose largest face is under 20 px across
(short side, frame pixels) is dropped first, however confident the detector was. On the same clip, two people sitting
side by side at 10 to 17 px were each kept as several confident faces, and even the widened crop could not show which
of the two a face was, so they only added people nobody could name. Otherwise a track is kept when either:

- its best sighting reaches `minScore`, as a photo face must; or
- it was seen in at least 3 sampled frames, with a median score of at least 0.45 and a median face of at least 32 px.

The size floor matters for crowds. A crowd shot yields dozens of consistent 13 to 25 px faces, too small to recognise
or to name, which would otherwise fill the People list. The finish log line reports how many candidate tracks were
found and how many were kept.

## Picking the best view

Each sighting gets a quality score:

```
quality = detectorScore × size × sharpness
size      = min(1, shortSideOfBox / 112)          (112 px is the recognition model's input)
sharpness = 1 − exp(−laplacianVariance / 150)     (on the greyscale face, resized to 112 × 112)
```

The track's best sighting supplies the face's box and frame. Its embedding is the normalised mean of its three
best-quality sightings. Averaging a few good views gives recognition a steadier signal than any single frame.

### A sharper view near the best sample

Samples a second or more apart can land on a moment when someone is mid-turn or blurred by motion, with a clearer
moment a quarter of a second away. On a 1080p test clip every kept face was 23 to 28 px wide and every best view
measured soft, and two of the seven crops could not be told apart. So after tracking, for the people kept, the
detector looks at a few more frames: 0.25 s and 0.5 s either side of each person's best sample (`planSharpenTimes`),
inside the span and not at a time already sampled. People best seen at the same moment share those frames, so a crowd
shot costs four extra frames, not four per person.

Each extra frame is searched like a sample (tiled too when tiled detection is on). A person is found in it by the
tracker's continuity rule (`findAgain`): where their best view was, and within the relaxed distance of their looks,
the closest in looks when several qualify. A find of higher quality becomes their best view and is added to their
sightings (`withSighting`), so it can also join the averaged embedding. The pass picks a better view of someone already
found. It never adds a person, drops one or merges two, because only tracks that were already kept are looked for.

## What is stored

**`asset_face`** keeps Immich's meaning: one row per person per video, `sourceType = machine-learning`. Its box and
`imageWidth`/`imageHeight` are in the **best frame's** pixel space. The best frame has the video's aspect ratio, as
the poster does, so the box is also a proportionally valid region of the poster, just possibly at a different moment.

**`face_search`** holds the averaged embedding, as for any face.

**`asset_face_video_frame`** (fork table, one row per video face):

| Column        | Type             | Meaning                                                             |
| ------------- | ---------------- | ------------------------------------------------------------------- |
| `faceId`      | uuid, PK, FK     | `asset_face.id`, `ON DELETE CASCADE`                                |
| `path`        | text             | The best frame (JPEG), disk path or S3 key                          |
| `timeSeconds` | double precision | Where the best frame is, in the original's timeline                 |
| `quality`     | real             | The best sighting's score                                           |
| `sightings`   | jsonb            | Every sighting: `{ t, x1, y1, x2, y2, score }`, box in frame pixels |
| `version`     | smallint         | Sampler version, so a later change can find videos to rescan        |
| `createdAt`   | timestamptz      |                                                                     |

The width and height of the frame are the face's `imageWidth`/`imageHeight`, so they are not repeated.

The frames live in one folder per video beside its thumbnails, at
`thumbs/<ownerId>/<aa>/<bb>/<assetId>_faces/<faceId>.jpeg` (the nested-path layout `StorageCore` uses). A deterministic
folder lets `AssetDelete` remove it after the cascade has deleted the rows, through the backend's `deletePrefix`, as
Spatial Scene does for its depth maps. Files are written before the database transaction and stale ones removed after
it, so a crash leaves at worst an orphan file, never a row pointing at nothing. Integrity's untracked-file scan learns
these paths through the same lookup that covers depth maps.

The rows carry everything Phase 2 needs. A sighting strip extracts its frames on demand from `t`, or simply seeks the
player there.

## Hook into face detection

`handleDetectFaces` gains one call after its visibility check:

```ts
const videoResult = await this.videoFaces.detect(asset.id, machineLearning, force);
if (videoResult) {
  return videoResult;
}
```

`VideoFaceDetector` (`server/src/gallery/utils/video-face-detector.ts`) is a plain class built once in `BaseService`,
like `BackendMediaServer`. It returns `undefined` for anything it does not handle (a photo, or the feature turned
off), so upstream's single-frame path runs unchanged. It runs on the existing face-detection queue, so the admin's
concurrency setting and the existing "Face detection" job buttons apply.

When the feature is off, videos are detected exactly as upstream does.

## Re-scanning a video

A forced run of face detection (`AssetDetectFacesQueueAll` with `force`) already deletes every machine-learning face
first. The detector then sees no existing faces and simply inserts.

Otherwise a video can already have faces: single-frame ones from before the feature was on, or a previous multi-frame
run. Those faces may be named, and a re-scan must not lose that. Each existing machine-learning face (pets and manual
faces are never touched) is matched one-to-one to a new track, best pairs first:

- by embedding: the smallest cosine distance between the old face's embedding and any of the track's sightings, under
  `maxDistance`; or
- for an old single-frame face (no `asset_face_video_frame` row), by position: a track sighting in the first 3 seconds
  whose box overlaps the old box with IoU > 0.5, after scaling both to the same image size. The poster comes from the
  first second or two, so the old face is almost always one of those sightings.

A matched face keeps its id, and with it its person, identity links and any space-person links. Its box, embedding and
frame are replaced. If it was unassigned, recognition is queued for it again, since the better embedding may now find
its person. If it is some person's representative face, that person's thumbnail is regenerated.

An unmatched track becomes a new face and is queued for recognition, as upstream does for a new face.

An unmatched old face is deleted if it was **unassigned**, as upstream drops faces that fall below the detection
threshold. An unmatched old face that **is assigned to a person is kept** unchanged: its box still refers to the
poster, which is still where the crop route looks for a face without a frame row. Losing a name the user gave is worse
than a duplicate face, which the face-cleanup console can already resolve.

### Re-scanning existing videos

Turning the setting on changes how videos are detected from then on: new uploads, and any video whose faces are
refreshed (the asset viewer's **Refresh faces**, which queues `AssetDetectFaces` for that one asset). It does not
rescan the library by itself. A library rescan can take hours, so it starts only from the Jobs page, through the Face
Detection job's existing buttons:

| Button      | What it does with this feature on                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| **Missing** | Upstream's never-detected assets, **plus every video not yet sampled across the whole video**. Names kept. |
| **Refresh** | Every asset, photos included, without deleting anything first. Videos are matched as above; names kept.    |
| **Reset**   | Upstream's reset: deletes every machine-learning face in the library and its names, then detects all.      |

Missing is the way to bring an existing library's videos over: it touches videos only, keeps names, and can be stopped
and run again, picking up where it left off. Refresh does the same for videos but redoes every photo too. Reset is not
a migration path, since it throws away the names the matching above exists to keep. No new button or job was added:
"assets missing this kind of detection" is what Missing already means, and the face detection tile needs no change.

"Not yet sampled" is `asset_job_status_gallery.videoFacesSampledAt IS NULL` (`VideoFaceRepository.streamUnsampled`),
restricted to visible videos face detection has already been through, so it never overlaps upstream's half of Missing.
The detector stamps every video it handles, faces or not, and also a video it falls back on for lack of a readable
stream, so Missing does not queue the same video on every run. `VideoFaceDetector.queueMissing` adds these jobs from
one call at the end of `PersonService.handleQueueDetectFaces`, only for `force: false` and only while the setting is on.

## Tiled detection

The face detector letterboxes every image to 640 x 640 before it looks (`FACE_DETECTION_SIZE`). A 1080p frame is shrunk
to a third, so a 30 px face in a crowd reaches the detector at about 10 px, around the smallest it can find at all. On a
test crowd clip, the detector saw 5 to 40 faces per frame, all 13 to 38 px, with only a few reaching 0.7 in any frame.

With `tiledDetection` on (off by default), a frame whose long edge is over 960 px is searched five times: whole, and
as four quarters that overlap by 15 % of their size (`planTiles`; on a 1080p frame, 1104 x 621 tiles sharing a 288 px
band). Each quarter reaches the detector at about twice the size the whole frame does. Boxes found in a quarter are moved
into frame pixels and merged with the whole-frame finds, keeping the more confident of any two that overlap by an IoU over
0.4 (`mergeDetections`). The whole frame is still searched for faces larger than the overlap band, which a quarter's edge
could cut in two. It costs about five times the detection work, which is why it is a separate setting.

## Serving crops

`BackendMediaServer.getFaceThumbnailSource` takes the face instead of the asset id, and returns the face's stored frame
when it has one, else the preview as before. All six callers (the person face crop, the three shared-space crops, the
admin face-repair crop and preview) are fork code, so every crop and the admin "photo in context" view switch to the
best frame with no change in their own logic.

`MediaService.handleGeneratePersonThumbnail` (upstream) takes its video input from one fork call that returns the
representative face's frame, falling back to the preview.

A small face cut from its best frame is cropped with its surroundings (`widenSmallFace`). Under 80 px on its longest
side, the crop region is widened around the face's centre by a factor that rises from 1 at 80 px to 2.5 at 40 px and
below, so a 25 px face is shown with its hair, head and shoulders instead of as an upscaled smudge. That is the
difference between recognising someone and guessing. Only the crop is widened. The box stored on the face stays the
face, because recognition, the face overlays and stock Immich all read it as one. Both crop paths apply it: the
person thumbnail, through the region `getPersonThumbnailSource` returns, and every face-keyed crop, when the source
`getFaceThumbnailSource` chose is the face's frame. Photo faces and unsampled video faces are cropped as before.

A new fork route, `GET /faces/{id}/thumbnail`, serves a face-keyed crop to anyone holding `FaceRead` on the face's
asset. That is the permission upstream's `GET /faces?id=` already checks, so no access rule is added. The crop
routes above are all person-keyed or admin-only, and the asset viewer needs crops of unassigned faces too.

## Web

`zoomImageToBase64` fetches `GET /faces/{id}/thumbnail` for a **video** face and returns it as a data URL. If the
request fails (an older server without the route, or no access), it falls back to today's thumbnail crop. That covers
the person side panels (own and shared space), the detail panel's people row and the "use as feature photo" action in
the assign panel. Photos keep their in-browser crop from the full image already on screen.

## Config

`machineLearning.facialRecognition.video`, beside the fork's `suggestions` (both spread from
`GalleryFacialRecognitionExtension`, so upstream's schema costs one line, not one per field):

| Field            | Default | Range       | Meaning                                                  |
| ---------------- | ------- | ----------- | -------------------------------------------------------- |
| `enabled`        | `false` |             | Detect video faces across the whole video                |
| `sampleInterval` | `2`     | 0.5 to 60 s | Seconds between sampled frames                           |
| `sceneDetection` | `true`  |             | Also sample just after every scene cut                   |
| `maxFrames`      | `1800`  | 10 to 10000 | Frame budget per video; the interval stretches to fit it |
| `tiledDetection` | `false` |             | Also search large frames as four overlapping quarters    |

Off by default, like the fork's other heavier ML jobs (pet detection, Spatial Scene), so a fresh install behaves as
upstream until an admin opts in. Admin-only. The admin UI is `web/src/lib/gallery/components/admin/video-face-settings.svelte`,
rendered with one line at the end of the facial recognition section and indexed for settings search. It hides itself
against an older server that sends no `video` block.

## Logging

Every sampled video logs one line when it starts and one when it finishes, at `log` level:

```
Sampling 1800 frames across 1h of video <id> (about every 2s, 3 scene cuts)
Found 4 faces in 1800 frames of video <id> in 21m, 30s: 2 added, 1 updated, 1 deleted, 2 dropped as too small or unsure, 3 sharper views from 16 extra frames
```

A video sampled from 100 frames or more also logs its progress every 10%, with an estimate of the time left, worked
out from the average time per frame so far:

```
Video faces 40% done (720 of 1800 frames, 5 faces tracked so far), estimated 12m, 54s remaining for video <id>
```

This follows transcoding's progress lines (`MediaRepository.transcode`), with two differences. They are at `log`
level, not `debug`, because a long video can hold a face detection slot for tens of minutes and default-level logs
would otherwise show nothing until it finished. And short videos log no progress at all, so a library of phone clips
adds two lines per video, not twelve. "Faces tracked so far" counts every candidate track before the final merge and
per-person confidence, so it is usually higher than the number of people found.

## Cost

Per sampled frame: one ffmpeg seek and decode (about 0.1 to 0.5 s for 4K HEVC in software), one ML detection and
recognition call (about 0.1 to 0.3 s on CPU, much less on a GPU), and a sharp crop for the score. A 2-minute phone
video at the default interval is 60 frames, well under a minute of work. A one-hour video uses the full 1800-frame
budget: tens of minutes on a CPU-only server, in the background, on the face-detection queue. That is comparable to
transcoding it. The admin can trade coverage for time with `sampleInterval` and `maxFrames`.

The search for sharper views adds at most four frames per kept person, fewer when people share a best moment: about
25 frames for a 23-second clip with seven people, and a rounding error on an hour-long video.

Storage: one JPEG of about 200 to 400 KB per video face.

## Version pairings

- **Old app, new server:** the faces it receives are ordinary faces. The old web app's in-browser video crop now cuts
  the box from the poster at a moment the poster may not show: the right region of the frame, possibly the wrong
  content. Person thumbnails, which come from the server, are correct. The fix needs an updated web app; there is
  nothing a server can do for the old one short of keeping poster-space boxes, which do not exist for people the
  poster does not show.
- **New web, old server:** `GET /faces/{id}/thumbnail` 404s and the web falls back to today's crop.
- **Mobile:** uses server crops and person thumbnails only; no change needed, and better results.
- **Stock Immich clients:** as old app.
- **Stock Immich server on a Gallery database:** faces are valid rows. Existing person thumbnail files keep serving.
  A thumbnail Immich regenerates, and Immich's web crop, cut the frame-space box out of the poster, as above.
- **Switching back:** `revert-to-immich.sql` drops `asset_face_video_frame`. The `asset_face` rows stay (they are the
  user's people), with the same caveat. The `<assetId>_faces/` folders stay in the thumbnails folder, where Immich
  never reads them.

## Layering compliance

- New table is fork-owned and keyed to `asset_face.id`; the FK is listed under `asset_face_pkey` in
  `gallery-upstream-fks.json`.
- Upstream files touched, each with one call or registration:
  - `person.service.ts`: the `videoFaces.detect` call, and the `videoFaces.queueMissing` call in the Missing job;
  - `media.service.ts`: the person-thumbnail video source;
  - `base.service.ts`: repository and detector registration, the established pattern;
  - `dtos/config.dto.ts`: `suggestions` becomes a spread of `GalleryFacialRecognitionExtension` (net zero lines);
  - `integrity.service.ts` and `integrity.repository.ts`: the tracked-path lookup;
  - `web/src/lib/utils/people-utils.ts`: one call to `fetchVideoFaceCrop` in the video branch of `zoomImageToBase64`;
  - `web/src/routes/admin/system-settings/MachineLearningSettings.svelte`: the settings component's import and render.
- `asset_job_status_gallery` (a fork table) gains `videoFacesSampledAt`.
- `asset_face` keeps Immich's meaning: one face of one person in one asset, with a box in the stated image space.

## Testing

- Unit (`video-faces.spec.ts`): timestamp planning (interval, cuts, budget stretch, trim window, short clips); quality;
  tracking (same person across frames, two people in one frame, continuity relaxation by position, a small face that
  drifted off its old box, late entry, merge of a person seen apart, no merge of co-occurring tracks); embedding
  averaging; re-scan matching (embedding, poster position); per-person confidence and the 20 px floor; the sharper-view
  plan, re-finding and sighting merge; tiles and their merge; widened crops for small faces.
- Unit (`video-face-detector.spec.ts`, through `PersonService.handleDetectFaces`): feature-off, photo and unreadable
  video pass-through to upstream; sampling, trim and scene cuts; one face per person with its best frame stored;
  re-scan (named face kept by embedding with its person thumbnail redone, poster face matched by position and
  re-recognised, unmatched unnamed face and its frame dropped, unmatched named face kept, pets and manual faces
  untouched); forced runs; only best frames kept; the Missing job adds unsampled videos only while the setting is
  on, and Reset and Refresh add nothing; a fallback to the poster is stamped; tiled detection; the sharper view taken
  from a nearby frame, never someone else's face or the same looks elsewhere, with frames shared between people;
  progress and finish log lines.
- Unit (`video-face.service.spec.ts`, `gallery-face.controller.spec.ts`): frame folder
  cleanup on delete, the face crop route's source, access and not-found cases, route permission and UUID validation.
- Unit: `getFaceThumbnailSource` returns the frame for a video face and the preview otherwise; the person-thumbnail
  hook.
- Medium (`test/medium/specs/repositories/video-face.repository.spec.ts`): `getForDetect` (trim, live faces with
  embedding, frame and pet flag, trashed video); `apply` (insert, a kept face moved with its embedding replaced, a
  dropped face's frame row cascading, and a failed re-scan writing nothing); the frame and representative-face lookups;
  `streamUnsampled` and `markSampled` (videos only, visible, through face detection, not yet sampled; other columns of
  the job status row kept). `schema-drift.spec.ts` passes with the new table.
- Web: `zoomImageToBase64` uses the route for video faces, never for photos, falls back on failure, and asks for a new
  crop when a refresh moved the face (the route lets the browser cache a crop, so the face's box is in the URL); the
  settings component's enable and disable states, and its absence against an older server.
- Manual, on a test instance with real phone clips: a 320 x 240 clip whose clearer people scored under 0.7 in every
  frame (found by per-person confidence; two tiny people at 10 to 17 px dropped by the floor instead of split across
  several faces); a 1080p clip of 23 to 28 px faces (wider crops; three of seven best views replaced by sharper ones
  nearby, each checked to be the same person); a 9-second HDR crowd clip (no one found before; 7 with per-person
  confidence; 24 with tiled detection, in 70 s instead of 16 s). Still to try: a 30-minute video, a trimmed video and
  an S3-backed instance.

## Phase 2: sightings in the assign UI

Assigning a video face shows a strip of that person's sightings (thumbnails cut on demand at `t`, a handful spread
across the video, best first), each opening the video at that moment. It reads `asset_face_video_frame.sightings` and
needs no change to the stored data.

## Open questions

- Should the scene-cut threshold (0.3) be configurable? It stays a constant until a video shows it needs tuning.
- Short tracks: a person seen in one sampled frame becomes a face, as in a photo, if the detector was confident and
  the face is at least 20 px. If that proves noisy, require two sightings for videos longer than a few intervals.
- A head turn can split one person in two: on the 320 x 240 clip, one man's two views a second apart in the same place
  were 0.76 apart, as far as two different people usually are. Merging on position alone would also merge one person
  stepping out and another stepping into the same spot, which hides a person under another's name. The split costs
  the user one extra assignment, so it stays until real libraries show it is common.
- A dedicated queue would keep a long video from holding a face-detection slot for minutes. That costs upstream queue
  registrations, so it waits until it is needed.
