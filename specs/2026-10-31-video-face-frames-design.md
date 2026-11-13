# Video faces: detect across the whole video, keep the best view

**Date:** 2026-10-31
**Status:** Phase 1 implemented (server sampling, tracking, best-frame crops, web crop source, admin settings); unit
tested, not yet run on a real library or against a database. Merged as #1261. Phase 2 (sightings UI) designed below,
in progress.

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
  cosine distance, if that distance is under the video's own `maxDistance` setting (default 0.5, the value recognition
  uses by default; separate since issue 1306, so recognition can be stricter without splitting people in videos).
- If the track was also seen in the previous sample and the face is still where it was (its centre within one face of
  the old centre, at no more than twice or half the size), the threshold is relaxed by 0.1. An overlap test (IoU > 0.3)
  came first, and split a 10 px face in a 320 x 240 clip into three people: a second's drift of half its width left the
  boxes overlapping by 16 %, while faces that small have embeddings 0.51-0.54 apart.
  A person turning their head between two samples is still the same track.
- Two detections in one frame never join the same track: each frame is matched one-to-one, best pairs first.
- A detection that matches no track starts a new one.

A final pass merges tracks that are the same person seen apart, closest pair first. Two tracks seen in the same frame
are two people and never merge. Any other pair merges on either kind of evidence:

- **looks**: the nearer of their centroids and their *stored* embeddings (the mean of each one's best three confident
  sightings, the embedding the face is saved with) is under `maxDistance`. Comparing centroids alone, as the first
  version did, missed pairs whose stored embeddings were 0.19 apart (issue 1306): sideways and blurred views drag a
  centroid off.
- **continuity**: one track was seen in the sample right after the other, in the same place, and the pair is within the
  relaxed threshold the tracker applies from one sample to the next. A person who turned their head between two
  samples otherwise stays split, because the online tracker compares the new view with the track as it was then.

Both kinds of evidence count only between **confident** sightings: a detector score of at least `minScore` (default
0.7). This came from replaying recorded detections of four clips through the old and new tracker and checking every
merge by eye (issue 1306). Backs and sides of heads score around 0.5, and their embeddings look alike from one person
to the next: three audience members seen from behind, 0.29 apart, were merged into one face, as were two back-of-head
tracks of different people in a second panel video. Every correct merge was between detections scoring 0.78 to 0.89:
panelists drinking, pointing, covering their face, or in profile. A track never seen confidently is compared on its
centroid alone, as before.

Two other rules were tried and dropped. A link on the single closest pair of sightings (under 0.3) never fired on any
clip. Treating a shared frame where both boxes overlap as one face found twice merged two audience members sitting one
behind the other; the detector's own suppression already removes real duplicates, and `mergeDetections` removes the
ones tiling creates (a find mostly inside another counts as the same face, whatever their IoU).

Results on the four clips, at the defaults (old tracker → new): a one-hour panel 41 → 37 faces, a 9-minute Q&A panel
64 → 60, Tears of Steel 14 → 14, a crowd clip 12 → 12. Every merge was checked by eye; one is wrong, between two
audience members only ever seen from behind (the old tracker happened to join one man's two halves instead), which no
ordering can tell apart.

Most splits that remain are views of one person more than 0.6 apart: a face from the front and from behind, or looking
down. Merging on looks that far apart would also merge different people, so those faces stay separate and recognition
or the user ties them to the same person. The debug log lists each pair of faces left apart near the threshold and why
(distance, or seen together), as evidence for tuning.

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
these paths through the same lookup that covers depth maps. The disk/S3 storage migration moves them, under its
person thumbnails option, since they are what person thumbnails are cut from (`streamVideoFaceFrames`,
`updateVideoFaceFramePath`).

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

Old faces with a person are matched before those without, closest first within each group, so a track several old
faces match keeps the name or the recognition result.

An unmatched old face is deleted if it was **unassigned**, as upstream drops faces that fall below the detection
threshold. An unmatched old face that **is assigned to a person is kept** unchanged: its box still refers to the
poster, which is still where the crop route looks for a face without a frame row. Losing a name the user gave is worse
than a duplicate face, which the face-cleanup console can already resolve. The exception (`absorbedFaces`, issue 1306)
is an unmatched face that matches a track whose kept face has the **same person**: one person an older tracker split
in two, both halves since recognised as them. It is deleted, as the kept face carries the person. One whose person
differs is left for the user.

### Re-scanning existing videos

Turning the setting on changes how videos are detected from then on: new uploads, and any video whose faces are
refreshed (the asset viewer's **Refresh faces**, which queues `AssetDetectFaces` for that one asset). It does not
rescan the library by itself. A library rescan can take hours, so it starts only from the Jobs page, through the Face
Detection job's existing buttons:

| Button      | What it does with this feature on                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| **Missing** | Upstream's never-detected assets, **plus every video not yet sampled across the whole video**, or with a face from an older `VIDEO_FACE_SAMPLER_VERSION`. Names kept. |
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

## Recognition of video faces

Recognition runs per face, as upstream's does, with one fork filter (`excludeOtherFacesOfVideo` on
`SearchRepository.searchFaces`, built by `src/gallery/utils/video-face-search.ts`): for a video face, the other faces of
the same video are left out of both searches, the `minFaces` count and the nearest named face. The face itself still
counts, so upstream's "the matches include the face itself" logic is unchanged, and photos are untouched.

Without it (issue 1306), the faces the tracker kept apart vouched for each other. Three faces of one person split in one
video reached `minFaces: 3` on their own and founded a person nobody else matched: 188 of 339 new people in the
reporter's library came from exactly one video. And a face could take the person of another face it had been kept
apart from because both were on screen together, which is proof they are two people.


`machineLearning.facialRecognition.video`, beside the fork's `suggestions` (both spread from
`GalleryFacialRecognitionExtension`, so upstream's schema costs one line, not one per field):

| Field            | Default | Range       | Meaning                                                  |
| ---------------- | ------- | ----------- | -------------------------------------------------------- |
| `enabled`        | `false` |             | Detect video faces across the whole video                |
| `sampleInterval` | `2`     | 0.5 to 60 s | Seconds between sampled frames                           |
| `sceneDetection` | `true`  |             | Also sample just after every scene cut                   |
| `maxFrames`      | `1800`  | 10 to 10000 | Frame budget per video; the interval stretches to fit it |
| `tiledDetection` | `false` |             | Also search large frames as four overlapping quarters    |
| `maxDistance`    | `0.5`   | 0.1 to 1    | Same-person distance within a video (tracking, re-scan)  |
| `minFaceSize`    | `20`    | 0 to 500 px | A person whose largest face is narrower is not kept      |
| `minSightings`   | `1`     | 1 to 100    | Sampled frames a person must be seen in to be kept       |
| `createPeople`   | `true`  |             | Off: a video face only joins an existing person          |

The last four came with issue 1306. `maxDistance` is the video's own, so an admin who keeps recognition strict (the
reporter used 0.4) does not split people inside videos with it. `minFaceSize` and `minSightings` cut background faces
and passers-by. `createPeople` off makes a video face non-core evidence in recognition (`VideoFaceDetector.mayStartPerson`,
one call in `handleRecognizeFaces`): it joins a person found elsewhere, and otherwise stays unassigned, as a face on a
hidden asset does.

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
  - none in `base.service.ts`: the repository registers in `GalleryRepositories` and the detector is built in
    `GalleryBaseService.initGallery`;
  - `dtos/config.dto.ts`: `suggestions` becomes a spread of `GalleryFacialRecognitionExtension` (net zero lines);
  - `integrity.service.ts`: the depth-map lookup becomes one call to `GalleryBaseService.getGalleryThumbnailFolderPaths`
    (net zero lines); `integrity.repository.ts`: one more union in the tracked-path query;
  - `web/src/lib/utils/people-utils.ts`: one call to `fetchVideoFaceCrop` in the video branch of `zoomImageToBase64`;
  - `web/src/routes/admin/system-settings/MachineLearningSettings.svelte`: the settings component's import and render.
- `asset_job_status_gallery` (a fork table) gains `videoFacesSampledAt`.
- The migration's `down()` drops `asset_face_video_frame` and `videoFacesSampledAt` rather than moving them back:
  both are derived, and there is nowhere older to move them. The faces themselves are `asset_face` rows and stay, with
  the caveat under Version pairings for a build that crops from the poster. Upgrading again leaves those videos
  unstamped, so face detection's Missing job samples them afresh and matches the existing faces, names included.
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

**Status:** designed 2026-11-06, in progress on `feat/video-face-sightings`.

Picking a person for a video face means recognising someone from one crop. Phase 1 made that crop the person's best
view, but the best view can still be a profile, or a face too small to tell apart from a sibling. The tracker has
already found that person at every moment they were on screen. Phase 2 shows those moments.

### What the user sees

In the asset viewer, on a video, the "Select face" picker (owner's `AssignFaceSidePanel` and the space editor's
`SpacePersonSidePanel`, both through the fork's `PersonPickerPanel`) shows a strip above the search field:

- A heading, "Seen at N moments" (`video_face_sightings_count`).
- **Every** sighting as a square crop, in time order, in one horizontally scrolling row. Each tile carries its time
  (`0:42`, or `1:02:05` past an hour) and the best view is marked with a star, the same sighting the face crop shows.
  Tiles load lazily (`loading="lazy"`), so a video with dozens of sightings only cuts the ones scrolled into view.
- Clicking a tile seeks the player to that moment and pauses it, so the frame stays on screen beside the picker.
  The tile stays highlighted until another one is clicked. Tiles are buttons labelled "Show at 0:42"
  (`video_face_sightings_show_at`).
- While paused there, the face is marked on the video as a photo marks a highlighted face: a white rounded box with
  the rest of the picture dimmed. The box goes when the video plays, when it is scrubbed to another moment, when
  another tile is clicked, and when the picker closes. Added after the first test on real videos: in a crowd, a
  paused frame alone did not say which of the people the sighting was.
- The strip is absent, with no placeholder, for a photo, for a video face that has no stored sightings (a face
  detected on the poster by an older build, or with video sampling off), when the request fails, and against a server
  without the route.

The same strip opens from the info panel, so a named person's moments do not need the edit pencils. On a video, each
People tile with a face in it (`faceManager.facesByPersonId`, the lookup the hover highlight uses, which matches for
space members too) gets a film button in its top-left corner, labelled "Show moments in this video: Alice"
(`video_person_sightings_show`). It opens `VideoPersonMoments` under the People grid: the person's name, a close
button, and the strip over **all** of the person's faces in the video (one person tracked more than once), merged
in time order, each crop cut from its own face. A second click, the close button, or another person's button
closes or switches it; the button shows pressed while open. The pick is held with its asset id
(`video-person-sightings.svelte.ts`), so another asset never shows it. Where no face of the person has stored
sightings, it says "No moments recorded in this video" (`video_person_sightings_none`) instead of showing nothing,
because here the user asked. Added after the first real-video test: the user named a person and found the big pencil
then the small pencil a long way round to where they are in the clip. Anyone who can read the asset can read the
sightings, so viewers get the button too.

The asset's owner can move a moment to someone else or take it out of a face. Each tile of a face that has more than
one moment gets a small menu button in its top-left corner ("Moment options", `video_face_sighting_options`), in the
owner's picker and in the info panel's strip; a Space editor's picker and other viewers do not get it, since both
hold `FaceDelete`, which only the owner has. The menu has "Move to another person…", "Move to a new person", "Move to
unassigned" and "Remove the moment at 0:42" (`video_face_sighting_move_person`, `_move_new`, `_move_unassigned`,
`video_face_sighting_remove`).

A move to a person who already has a face in this video (found in the asset's faces, other than the strip's own)
joins that face (`POST /faces/{id}/sightings/move`), so the person keeps one face here instead of gaining one per
move; moving the moment back puts it back in its old place, and so does the Undo. When the moment was its face's
last, that face goes, and the Undo splits the moment out again and gives it back to the strip's person. If the
server refuses the target (a face not sampled from the video), the move falls back to a face of its own. Otherwise a
move splits the moment off into a face of its own, then gives that face to the target through the reassign the
face editor already uses (`PUT /faces/{id}` with the person; `POST /people` first for a new person, which starts
unnamed). "Another person" picks from the owner's people in the existing `PeoplePickerModal`, leaving out the
strip's own person in the info panel. The tile leaves the strip, the info panel reloads the asset's faces so the
People grid shows where it went, and a toast says "Moment moved to Bob", "Moment moved to a new person" or "Moment
moved to unassigned" (`video_face_sighting_moved_person`, `_moved_new`, `_moved_unassigned`; `_moved` for a person
with no name) with an Undo for 5 seconds, which deletes the new face and restores the moment. If giving the new face
to the person fails, the moment stays moved, unassigned, and says so. A picker closed without a choice moves
nothing. Added after the first real-video tests, as the "Not this person" action the open question below asked for,
one moment at a time.

Removing takes the tile out at once and shows "Moment removed"
(`video_face_sighting_removed`) with an Undo button for 5 seconds (`undo`), which puts it back. Removing the starred
moment makes the remaining moment with the highest score the best view: the star moves, and the face crop and box
follow it.

A face's only moment cannot be split off or removed, since a face needs a frame to be cut from: it stands for the whole
face. In the info panel's strip, where the person is known, its menu acts on the face instead: "Move to another
person…" and "Move to a new person" reassign the face itself (`PUT /faces/{id}`), undone by giving it back to the
strip's person, and "Delete the face" (`video_face_sighting_delete_face`) asks first
(`video_face_sighting_delete_face_prompt`) and deletes it as the face editor does (`DELETE /faces/{id}`, not forced),
with no undo ("Face deleted", `video_face_sighting_face_deleted`). There is no "Move to unassigned" for it: Immich has
no way to unassign a face. In the picker, which is already naming that face, its only moment has no menu. When the
person has no face left in the asset afterwards, their moments close. Added after the second test: a moment moved to
a new person is that person's only moment, and could not be moved on or deleted from the strip. A failure says "Could not remove the moment" or "Could not bring the moment
back" (`video_face_sighting_remove_failed`, `video_face_sighting_restore_failed`) and leaves the strip as it was.
Added after the first real-video test, for the case the open question below describes: a moment in a person's strip
that is someone else and should belong to nobody. Neither a move nor a removal recomputes the old face's embedding.

A person can still have several faces in one video: the tracker splits one at a head turn, and moves made before
joining existed made one face per moment. The info panel's strip then offers the owner "Combine into one face"
(`video_person_faces_combine`, a merge icon beside the close button), which folds them into the face with the most
moments (`POST /faces/sightings/merge`), says "Faces combined" (`video_person_faces_combined`), and has no undo; the
edit people dialog then lists one face for them. After any move, undo or combine, the strip follows the person's
faces as the asset now has them. Added after the third test: a moment moved to B and back left A with three
one-moment faces, three rows in the edit people dialog.

The button sat behind the film button, where testers did not find it. Naming a second face of someone in the same
video is when it helps, so the edit people dialog now offers it (`src/lib/gallery/asset-viewer/video-face-combine-offer.ts`,
one call from upstream's `PersonSidePanel`): after a save on a video, each person the save gave a face to who now has
more than one face in it gets a toast, "Carol has 2 faces in this video" (`video_person_faces_combine_offer`,
`_offer_unnamed` for a person with no name), with "Combine into one face" for 10 seconds. It only combines when
clicked, since combining deletes the emptied faces and has no undo, and only people the save touched are offered, so
a split the owner chose to keep is not raised again. A new person cannot have a second face yet, so creating one is
never offered. After combining, the person's open strip moves to the kept face and the asset's people are re-read.
The offer and the moment strip's Undo toasts close when their button is clicked: left open, a second Combine sent
faces that no longer existed, and a second Undo sent the restore again. Added after the fourth test.

A strip over several faces (the info panel's, for a person tracked more than once, or given moments one move at a
time, each its own face) stars one moment: the best view the detector was surest of, not each face's. Found in the
second test, where two moments moved to one new person both showed a star.

The order was "a handful, best first" in the Phase 1 summary. Showing all of them changes that: in time order the
strip reads as a timeline the user scrubs through, and the star finds the best one.

### Server

Two routes on `GalleryFaceController`, under `Permission.FaceRead`, with the same access check as
`GET /faces/{id}/thumbnail`: the face must be on a live asset the caller can read (`requireAccess` with
`Permission.AssetRead`, which already covers space members through `checkAccess`'s grants, so the access oracle is
the enumerating test).

**`GET /faces/{id}/sightings`** returns `{ sightings: [{ time, score, isBest, box }] }`:

- `time` is seconds in the **player's** timeline, rounded to the millisecond. Sightings are stored in the original's
  timeline; a trimmed video plays its trimmed encode, whose zero is the trim start, so `time = t − trimStart`. The
  trim is read from `asset_video_trim` when the request is made, not when the video was sampled, so a trim changed
  later still maps correctly. Sightings outside the current trim window are left out.
- `isBest` marks the sighting at the frame row's `timeSeconds`.
- `box` is where the face was at that moment, `{ x1, y1, x2, y2 }` as fractions of the frame (0 to 1, rounded to four
  places, clamped inside it). Sightings are stored in the sampled frame's pixels, which the face's
  `imageWidth`/`imageHeight` describe, so fractions let the player draw the box at whatever size it shows the video,
  whichever encode it plays. A face without a usable `imageWidth`/`imageHeight` lists no sightings; video sampling
  always writes them.
- A face with no `asset_face_video_frame` row (a photo face, a poster face, a manual face) returns an empty list,
  not a 404: "no sightings" is an ordinary answer, and the client hides the strip either way.

**`GET /faces/{id}/sightings/thumbnail?time=<seconds>`** returns the crop of one sighting as a JPEG:

- The sighting is looked up by `time` (player timeline, matched within a millisecond after adding the trim start),
  not by position in the list. A re-scan can renumber sightings but never moves one to another moment, so the time
  is a stable key: the browser may cache the URL, and a URL for a moment that no longer exists returns 404 instead of
  another moment's face. The route never seeks to an arbitrary time the client picks.
- The frame is extracted from the original at the stored `t` with the same `VideoFrameReader.extractFrame` the
  sampler used (1440 px short edge, rotated upright, tone-mapped), so the sighting's box, stored in frame pixels,
  lands where it was found. The box is scaled to the extracted frame's size anyway, in case the original changed.
- The original is read through `backendMedia.getProbeInput`: a disk path as is, or a presigned URL that ffmpeg reads
  with range requests. Nothing is staged, which matters here, because a request handler must not download a whole
  S3 video for one frame.
- The crop goes through `generateFaceThumbnailResponse`, widened when small as the best-frame crop is
  (`widenSmallFace`), 250 px, cacheable (`PrivateWithCache`).

**`DELETE /faces/{id}/sightings?time=<seconds>`** takes a moment out, and **`POST /faces/{id}/sightings/restore?time=`**
brings it back; both return the face's sightings as `GET` does:

- Both need `Permission.FaceDelete`, checked by `requireAccess` on the face id, which upstream's `checkAccess` grants
  the asset's owner only (`checkFaceOwnerAccess`); the fork adds no grant. The access oracle is therefore the
  enumerating test, as for the read routes.
- A removed sighting stays in `asset_face_video_frame.sightings`, marked `removed`, so Undo restores exactly what was
  there, box and score included. `sightingsForPlayer` and the thumbnail route leave it out; the restore route finds
  it by the same player time.
- Removing the best view promotes the remaining sighting with the highest score, preferring one inside the current
  trim, and marks the removed one `wasBest`; restoring a `wasBest` sighting promotes it back. A promotion extracts the
  new best's frame from the original as the thumbnail route does and writes it over the face's frame path, then moves
  the face's box (`asset_face`) and `timeSeconds` in one transaction, then queues `PersonGenerateThumbnail` for every
  person this face represents. The frame is written before the box moves, so the box never points into another
  moment's frame for longer than the request. `quality` is left as it was: sightings store no sharpness, and nothing
  reads `quality` after sampling.
- The face's last sighting stays (400), and a time with nothing to remove or restore is 404.
- A rescan of the video rebuilds every face's sightings from the new sample, so it brings removed moments back, as it
  rebuilds the track itself. Keeping a removal across rescans needs the tracker constraint the open question
  describes.
- No schema change: the flags are optional fields of the fork table's jsonb, which a revert drops with the table.

**`POST /faces/{id}/sightings/split?time=`** moves a moment out into a new face and returns
`{ faceId, sightings }`: the new face's id and the old face's remaining sightings.

- Same access as removing (`FaceDelete` on the old face, owner only), and the same refusals: the face's last sighting
  stays (400; moving all of a face is reassigning it), and a time with nothing shown is 404.
- The old face loses the sighting exactly as `DELETE` takes it out, with the best view promoted when that one moved
  and `removed` kept, so the Undo (delete the new face with `force`, then restore) puts the face back as it was.
- The new face is on the same asset, in the same frame pixel space (`imageWidth`/`imageHeight` of the old face), with
  the sighting's box, unassigned, and `sourceType` **manual**: the user made it. Upstream's recognition skips
  non-machine-learning faces (`PersonService` "Skipping face due to source"), so an unassigned moved moment is never
  assigned back automatically, and a full "detect faces again" deletes only machine-learning faces, so a move
  survives it; a rescan of the video still rebuilds the old face's track, moment included, as it does after a
  removal.
- Its frame is the moment's frame cut from the original, stored beside the old face's frame as `<newFaceId>.jpeg`,
  with a frame row holding that one sighting (`quality` 0: not measured), so its crop, the thumbnail route and the
  strip work as for any sampled face.
- Its embedding comes from running face detection on that frame again and taking the detection overlapping the
  sighting's box most (IoU at least 0.3, `detectionAt`), with the same lowered minimum score sampling uses. When
  recognition is off, the service fails, or the detector misses the face (a small one sampling found only in a
  tile), the face has no embedding: it can still be named and shown, but face search and merge suggestions do not
  see it.
- The old face's sightings, the new face, its `face_search` row and its frame row are written in one transaction
  (`VideoFaceRepository.splitSighting`), after both frame files are written.

**`POST /faces/{id}/sightings/move?time=&toFaceId=`** moves a moment into another face of the same video and returns
`{ sightings, targetSightings }`, the two faces' sightings after it:

- `FaceDelete` on both faces (owner only). Both need a frame row, the same asset and the same frame size, or 400:
  boxes are only comparable in one frame space. Moving to the same face is 400.
- The source loses the moment as `DELETE` takes it out (best view promoted, `removed` kept), except that its last
  sighting may go too (`takeSightingAt`): the face is then deleted, and `sightings` is empty.
- The target takes it with `addSightings`: a sighting it already stored at that moment and had moved away comes
  back in place, as the best view again when it was (`wasBest`), which is what makes moving back an undo; one it
  already shows stays; any other is appended. Its best view otherwise stays.
- One transaction (`VideoFaceRepository.moveSightings`) writes both faces and, when the source goes, points any
  person whose cover was the source at the target, then deletes the source (frame row and embedding cascade). The
  service then unlinks the deleted face's identity, as upstream's face delete does, deletes its frame file, and
  queues person thumbnails for promoted faces and repointed people.

**`POST /faces/sightings/merge`** with `{ faceIds }` (at least two) combines faces of one video and returns
`{ faceId, sightings }`: the kept face, the one with the most live sightings, takes every live sighting of the others
(`addSightings`, so one at a moment it already has is not doubled) and keeps its best view; the others are deleted as
above, their people repointed to it. Faces without a frame row are skipped; fewer than two sampled faces, faces of
different videos or frame sizes, or missing access is 400. Like any face delete, a combine has no undo.

### Seeking the player

The side panel and the player have no reference to each other. A fork module,
`web/src/lib/gallery/asset-viewer/video-seek.ts`, holds the current `<video>` element: `VideoNativeViewer` registers
it through the fork attachment `galleryViewerVideo`, which replaced the fork's existing volume attachment on the same
element and composes both, and the attachment's cleanup clears it. The strip calls `seekViewerVideo(time, box)`. A
seek with no registered player does nothing.

Each seek starts with a muted `play()` and `pause()` (given up to 300 ms to start), then sets `currentTime` and shows
the box. The first real-video test found that Safari, once the window is resized, stops drawing a paused video's
seeks: the clock and the box moved, the picture stayed on the old frame, and pressing play brought it back. Clicks
made while that play is under way go to the same play and land on the latest one, so the mute state it restores is
always the viewer's own. Costs: the mute toggle passes through the persisted volume preference and ends where it
started, and if the video never played before, the viewer's first-`playing` handler moves focus to it.

The box lives in `video-face-box.svelte.ts` (the box and the moment it belongs to). `VideoFaceBox.svelte` draws it
over the video with the face editor's geometry (`computeImageContentMetrics`: the video fitted to its container and
centred), with `pointer-events: none` so the player's controls still work. The attachment clears the box on the
video's `play` event and on a `seeking` event more than 0.1 s from the box's moment, which leaves the seek that
placed it alone; the strip clears it when it unmounts. The time is already in the player's
timeline, which holds for every source `VideoNativeViewer` plays: HLS is used only for unedited videos (whose
timeline is the original's), and the playback and original URLs of a trimmed video both serve the trimmed encode
(`edited=true` is the default).

### Version pairings

- **New web, old server:** `GET /faces/{id}/sightings` 404s and the strip is not shown.
- **Old web, new server:** nothing changes; the routes are only called by the new strip.
- **Mobile and stock Immich clients:** no assign UI calls these routes; nothing changes.
- **Database:** no schema change. Phase 1's rows already carry the sightings; a removed one is a flag inside them,
  which an older Gallery build would ignore and show again.
- **Remove, restore, move and combine:** the routes ship with the strip. No released server has the read route, so a web build that
  shows the strip is always talking to a server that has these too.

### Layering

Server work is all fork code (`GalleryFaceController`, `VideoFaceService`, `VideoFaceRepository`, a fork DTO).
Upstream files: `AssignFaceSidePanel.svelte` passes the face to the picker, with whether its moments may be moved
and removed (one prop line, `videoFace={{ id, canEdit: true }}`), and
`VideoNativeViewer.svelte` registers its player by swapping the fork's volume attachment for `galleryViewerVideo` (no
change in size) and renders `VideoFaceBox` (an import and one line, +2 against the upstream tag), and
`DetailPanelPeople.svelte` renders `VideoPersonMoments` under the People grid, passing `canEdit={isOwner}` (an
import and one line, +2); the film
button lives in the fork's `PersonTile.svelte`. `PersonPickerPanel.svelte` and
`SpacePersonSidePanel.svelte` are fork files. The open-api spec and SDK are generated.

### Cost

One thumbnail is a probe and a single-frame seek of the original, then a crop: about the cost of a person thumbnail
for a video, plus the seek (fast on a disk file, a few range requests on S3). Lazy loading bounds a visit to the
tiles in view, about four in the panel's width plus the browser's look-ahead, and a revisit is served from the
browser cache.

### Testing

- Unit (`video-face.service.spec.ts`): sightings mapped through a trim and filtered to its window, `isBest`, time
  order, an empty list for a face without a frame row, not found and no access; the thumbnail looked up by time
  (with and without a trim), a time with no sighting is 404, the frame extracted from the probe input at the stored
  `t`, the crop cut at the sighting's box.
- Unit (`gallery-face.controller.spec.ts`): both routes require `FaceRead` and a UUID; `time` must be a non-negative
  number.
- Medium (`video-face.repository.spec.ts`): `getSightings` with and without a trim, for a face without a frame row,
  and on a trashed video.
- Unit (`video-faces.spec.ts`): boxes as frame fractions, clamped inside the frame; no sightings without a frame size.
- Web (`VideoFaceSightings.spec.ts`): hidden when empty, on error and for a photo; tiles in time order with the best
  starred and lazy images keyed by time; a click seeks with the sighting's box; the box goes when the strip closes.
  `video-seek.spec.ts`: seek with and without a registered player, cleanup on unregister, the box shown by a seek and
  cleared by play, by a scrub away and by unregistering; the muted wake-up play before each seek, quick seeks
  sharing it and landing on the latest, a play that never starts or is refused, a seek dropped when its video goes.
  `VideoFaceBox.spec.ts`: nothing drawn without a box or before the video's size is known; the box placed on a
  letterboxed picture. `VideoFaceSightings.spec.ts` also: several faces merged in time order with each crop from its
  own face, one face failing, the empty message only once loaded. `DetailPanelPeople.gallery.spec.ts`: no film button
  on a photo or for a person with no face in the video; the button opens all the person's moments, shows pressed,
  closes on a second click or the close button, switches between people, says when nothing was recorded, does not
  carry over to another asset, shows the moment menu to the owner only, and reloads the asset's faces after a move.
  `VideoFaceSightings.spec.ts` also: no menu without permission or on a face's last moment; removal replacing the
  face's moments with the server's (star moved), the Undo toast restoring them, the face box going with its moment, a
  failure reported with nothing to undo; a move to a picked person (the strip's own person left out of the picker),
  to a new person and to unassigned, a closed picker moving nothing, the Undo deleting the new face and restoring the
  moment, a failed reassign leaving the moment unassigned with its Undo, a failed split moving nothing; a face's only
  moment getting the whole-face menu (with the person known), the face moved to a picked or new person and given back
  on undo, the face deleted only once confirmed; one star across several faces; a move to a person with a face here
  joining it (moved back on undo), a face's only moment joining it (split back out to the strip's person on undo),
  falling back to a face of its own when the server refuses. `DetailPanelPeople.gallery.spec.ts` also: a person's
  moments closing once their only face has gone to someone else; "Combine into one face" for the owner only, with
  more than one face, the strip following the faces left. `video-face-combine-offer.spec.ts`: no offer on a photo, for
  an edit that touched no existing person, or for a split the edit did not touch; the offer for a person with two faces
  now, combining only on click, closing its toast, moving the open strip to the kept face and re-reading the people;
  quiet when the faces cannot be read; a failed combine reported, the people still re-read. The Undo toast closing
  on click is checked in `VideoFaceSightings.spec.ts`.
- Unit (`video-faces.spec.ts`) also: `takeSightingAt` including the last sighting, `addSightings` appending, restoring
  a moved-away moment in place (as best when it was), `liveSightings`. `video-face.service.spec.ts`: a move between
  faces keeping both best views; the source deleted with its last sighting, identity unlinked, frame deleted, person
  repointed and thumbnail queued; a move back restoring in place as the best view; refusals for another video,
  another frame size, the same face, a missing face and missing access; combining into the face with the most
  sightings, and its refusals. Controller: both routes under `FaceDelete`, the query and body validated. Medium:
  `moveSightings` writing faces, repointing a person's cover and deleting the emptied face (not run locally).
- Unit (`video-faces.spec.ts`): removing marks the sighting and keeps the best; removing the best promotes the
  highest score left, preferring the trim, and marks `wasBest`; the last one is kept; nothing found at a time with no
  shown sighting; restore brings a sighting back as it was, and a `wasBest` one as the best; removed sightings are
  not listed. `video-face.service.spec.ts`: remove without and with a promotion (frame extracted at the new best,
  written over the face's frame path before the box moves, person thumbnail queued), the last sighting kept, 404s,
  `FaceDelete` required for both routes, restore of a plain and of a best sighting. Controller: both routes under
  `FaceDelete`, the time passed through, invalid ids and times rejected (split too). Unit also: `splitSightingAt`
  as removal plus the moved sighting, refusing the last; `detectionAt` picking the most overlapping detection or none.
  `video-face.service.spec.ts`: a split writing the new face's frame beside the old one, with the embedding of the
  matching detection; promoting the next best when the best moved, with its frame and person thumbnail; no embedding
  when detection misses or fails; the last sighting kept, 404s, `FaceDelete` required. Medium
  (`video-face.repository.spec.ts`): `setSightings` with and without a new best view, and `splitSighting` making an
  unassigned manual face with its frame row and `face_search` row (not run locally: needs Docker).

## Phase 3: moments on mobile, view only

The app shows a person's moments in a video and jumps the player to them, as the web's info panel does. Correcting
faces (move, remove, combine) stays on the web: the app has no face editing to build on yet (no assign, reassign or
delete face), so that would be a new editor designed for a phone, and it waits until people ask for it.

### What the user sees

- In the asset viewer's details, on a video, each person in the **People** row with a face in that video gets a
  small film badge on the top-left of their picture. Tapping the picture still opens the person page, as before;
  only the badge is new. The badge is a separate tap target, so the two cannot be confused.
- Tapping the badge opens the person's moments in a row under the People row (a second tap, or the close button,
  closes it): their name, "Seen at N moments" (`video_face_sightings_count`), and a crop per moment in time order,
  with the time under it and one star on the best view the detector was surest of. Several faces of the person in
  the video are listed together, as on the web. With nothing recorded it says so (`video_person_sightings_none`).
- Tapping a crop pauses the video at that moment and draws the white rounded box around the face with the rest of
  the picture dimmed. The box goes when the video plays, or when the position moves more than 2 s from the moment
  (a scrub). The details sheet keeps the video in view above it, so the jump is visible while the row stays open.
- Inline under People rather than in a bottom sheet: a sheet would cover the video the crops seek.

### How it works

- Face ids come from `GET /faces?id=<asset>` (the endpoint the web's face manager reads), grouped by person id,
  fetched when the details of a video open. The moments are `GET /faces/{id}/sightings` per face, merged; crops are
  `GET /faces/{id}/sightings/thumbnail?time=` through `RemoteImageProvider`, which adds the session headers.
- Rule 6 (version mixing): the app probes `GET /faces/{id}/sightings` for the video's first face once; a 404 there,
  for a face id the server just listed, means the server predates the route, and no badge is shown. An older app on
  a newer server sees nothing new.
- The player is `videoPlayerProvider(asset.id)`: `seekTo` then `pause`, which flushes the seek at once. The iOS
  plugin seeks with zero tolerance and ExoPlayer seeks exactly by default, so the paused frame is the moment's.
- The box is drawn inside `NativeVideoViewer`'s stack, which `PhotoView.customChild` sizes to the video's own
  aspect (`childSize` is the asset's width and height, `tightMode`), so the box is the sighting's frame fractions of
  that stack with no letterbox to subtract, and it follows pinch zoom.
- Fork code lives in `mobile/lib/gallery/video_faces/`; the faces API is built from the shared client
  (`FacesApi(peopleApi.apiClient)`), so `ApiService` is not touched. Strings are the web's overlay keys, which the
  app reads from the same merged i18n.

### Layering

Upstream files get hooks only: `people_details.widget.dart` passes its avatar list through the fork's
`withVideoMomentsBadges` and renders the moments row under the People row (an import, two changed lines and one
new one), and `video_viewer.widget.dart` renders the box overlay
in its stack (an import and one line).

### Testing

- `mobile/test/gallery/video_faces/video_moments_test.dart`: moments merged across faces in time order, one star
  (the surest best view), times formatted as the player shows them, the 2 s rule for leaving a moment, the box as
  frame fractions of the picture; the repository over the real generated client and an in-memory server (faces
  grouped by person with unassigned ones left out, the route probe, moments merged with an unreadable face skipped,
  the crop URL); no badges on a server without the route; in widgets, the badge on a video's people with a face and
  not on a photo, the row opening with one star and closing on a second tap, the empty message, a tapped moment
  seeking then pausing the player and boxing the face until it plays, and the box going on a scrub and when the row
  closes. The existing people strip, video viewer and memory card tests still pass with the hooks in place.
- On a phone: a release build on an iPhone 16 Pro Max against the test stack. The badge is easy to hit without opening
  the person page, the row under People reads well, and the box lands on the face, also after pinch zoom.

### Limits

- Space people: a person shown from a Space carries the Space person's id, while `GET /faces` names the global
  person, so their badge does not appear. The owner's own videos, the common case, work.
- No editing, as above.
- Zoomed in, a jump does not pan to the face: the box is drawn where the face is, which can be outside the zoomed
  view. Found on the first phone test and accepted for now; panning would need the asset page's `PhotoView`
  controller, another hook in an upstream file.

## Open questions

- Should the scene-cut threshold (0.3) be configurable? It stays a constant until a video shows it needs tuning.
- Short tracks: a person seen in one sampled frame becomes a face, as in a photo, if the detector was confident and
  the face is at least 20 px. If that proves noisy, require two sightings for videos longer than a few intervals.
- A head turn can split one person in two: on the 320 x 240 clip, one man's two views a second apart in the same place
  were 0.76 apart, as far as two different people usually are. Merging on position alone would also merge one person
  stepping out and another stepping into the same spot, which hides a person under another's name. Since issue 1306
  the final pass merges on continuity between confident views within the relaxed threshold; anything further apart
  stays split. A face moved to another person still leaves that person's other faces in the same video behind;
  moving them together is a UI change for later.
- The opposite, two people merged into one track, is possible: lookalikes or small faces within `maxDistance`, one
  person stepping into the spot another left between two samples (the position relaxation to 0.6), or the final pass
  joining two tracks that never share a frame. The name then goes on the face cut from the best view, and the other
  person has no face in that video, so a search for them misses it. If a merged sighting is among the best three, it
  also pulls the averaged embedding toward the wrong person. A rescan builds the same track again. The Phase 2 strip
  shows such a mix, and the owner can move a wrong moment to the right person (into their face here when they have
  one), or remove it. That is one moment at a time, the old face's embedding stays averaged, and a rescan merges the
  moment back into the old track (a moved face of its own stays, so the moment then shows twice). The fuller fix would split a sighting together with
  the sightings nearer to it than to the best view, and store the split as a constraint the tracker honours on
  rescan, so the next "Refresh faces" does not merge them again. The threshold is the one recognition already uses to
  tie two photos to one person, so merges are expected to be rarer than head-turn splits. This waits until moving one
  moment at a time proves too slow, or rescans undo moves in practice.
- A dedicated queue would keep a long video from holding a face-detection slot for minutes. That costs upstream queue
  registrations, so it waits until it is needed.
