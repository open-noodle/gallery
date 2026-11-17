# Video pets: detect pets across the whole video

**Date:** 2026-11-16
**Status:** Implemented on `feat/video-pet-detection` (server, admin settings, moments guards, docs); unit tested.
Medium tests written, not yet run (no local database). Not yet replayed on real pet clips: `maxDistance` 0.55 is pet
recognition's default. Replayed on five public clips and run on a copy of the owner's library (see Replays).

## Summary

Pet detection looks at one image per video: the poster frame. A dog that is not in the poster is never found, and a
pet that is found has one face with no moments, so the moments panel of #1283 is empty for it and its crop is cut
from the upscaled poster.

Video faces (#1261, #1310, #1283) fixed the same problem for people by sampling frames across the whole video. This
feature does the same for pets, inside the pet detection job, which keeps owning pets as it does today. It reuses the
video face building blocks: the frame plan, frame extraction, the tracker, the sightings table and the best-frame
folder. Off by default.

## How it works today

1. `PetDetectionService.handlePetDetection` sends the asset's preview file to the ML service. For a video that is the
   poster `generateVideoThumbnails` made; nothing else in the video is looked at.
2. Dogs and cats with an embedding (pet recognition on) get an `asset_face` and a `pet_search` row and go to
   `PetRecognition`. Everything else goes under a per-owner species person ("bucket"). Both writers only insert.
3. `VideoFaceDetector` (face detection) samples videos for people only. On a rescan it leaves pet faces alone
   (`!face.isPet` in `applyTracks`), so poster pets survive it, and nothing else looks for pets in a video.

## Goals and non-goals

Goals:

- Find pets anywhere in a video, with one face per pet per video, its box and crop from the pet's best view, and
  sightings for the moments panel.
- Keep the pet job and the face job independent: each can run without the other, with its own settings, queue,
  Missing and Reset.
- Change nothing while the setting is off: the poster path runs exactly as today.

Non-goals:

- Sharing decoded frames with the face job. Running both decodes each video twice; the separation is worth more.
- Tiled detection and the sharper-view pass for pets. Pets are large in frame compared with faces in a crowd, and the
  pet detector already finds them at the default resolution. Either can follow if replays show the need.
- Moving pet sightings between a pet face and a person's face. The server refuses it (see Moments).

## Setting

`machineLearning.petDetection.video`, admin-only like the rest of `petDetection`:

| Key              | Default | Meaning                                                                          |
| ---------------- | ------- | -------------------------------------------------------------------------------- |
| `enabled`        | false   | Detect pets in frames sampled across the whole video                             |
| `sampleInterval` | 2       | Seconds between sampled frames (at least once a second for clips up to 60 s)     |
| `sceneDetection` | true    | Also sample just after every scene cut                                           |
| `maxFrames`      | 900     | Frame budget per video; past it the interval stretches to cover the whole video  |
| `maxDistance`    | 0.55    | Largest pet-embedding distance at which two views in one video are the same pet  |
| `minSightings`   | 2       | Sampled frames a pet must be seen in to be kept (capped at the frames read)      |

The defaults follow video faces, except `maxFrames` (half: pet detection runs on a queue of concurrency 1, and a pet
is in frame for longer than a face is turned to the camera) and `maxDistance` (pet recognition's default).

`machineLearning.petDetection.video` sits inside a section Gallery already owns, so it goes in its own list,
`galleryNestedConfigPaths`, which only `UpstreamConfigBodyInterceptor` reads: an older Gallery admin page that saves
`petDetection` without it keeps the stored value. It is not in `galleryConfigPaths`, whose specs strip every listed
path from a body and so cannot hold a path nested inside another listed one.

## The job

`PetDetectionService.handlePetDetection` hands a video to `VideoPetDetector.detect` (`src/gallery/utils/
video-pet-detector.ts`) first when `petDetection.video.enabled` is on, the same shape as `VideoFaceDetector.detect` in
face detection. It returns undefined for anything it does not handle (not a video, setting off), and the poster path
runs. A video with no readable stream or no readable frame falls back to the poster path too, stamped
`videoPetsSampledAt` first so Missing does not queue it again.

For each sampled frame (the plan from `planSampleTimes`, extracted by `VideoFrameReader`), it calls `detectPets` on the
frame with recognition when recognition is on, at the configured `minScore`. Duplicate boxes are dropped first
(`dedupePetDetections`): boxes where one animal found twice would be (`isSameBox`, as tiled face detection uses),
whatever their labels, keep only the most confident. RF-DETR has no non-maximum suppression and sometimes puts a second
box, under the other species, on one animal; left in, the pair reads as two pets seen together and keeps that animal's
tracks from ever merging. The rest split two ways, as on photos:

- **Embeddable** (a recognizable species with an embedding): one `FaceTracker` for dogs and cats together at
  `petDetection.video.maxDistance`, with `minScore` as the confident score, so every detection counts as confident.
  The final merge (`mergeSeenApart`) runs as for faces: two tracks seen in one frame are two pets. A pet's species is
  the label most of its sightings carry, weighted by score: the detector's label for one animal flips between frames
  (a cat called a dog in a third of the frames of one clip), so tracking per species split one animal in two.
- **Bucketed** (every other species, or recognition off): there is no embedding to tell two animals apart, and on
  photos they all go to one species person anyway. One face per species per video, with one sighting per frame: the
  highest-scoring box of that species in that frame. Its best view is the best quality sighting.

`acceptTrack`'s confidence rule is not used: detection already runs at `minScore`. A track is kept when it was seen in
at least `minSightings` frames (default 2), or in every frame read when the clip has fewer, so a one-second clip keeps
its pet as a photo would, and seen at least once at a detector score of `VIDEO_PET_CONFIDENT_SCORE` (0.5). Detection
runs at the photo `minScore` (0.3 by default); across hundreds of frames that lets through small, unsure boxes, which
recognition then matches to whichever pet they happen to resemble. Quality is `sightingQuality` (score × size ×
sharpness), as for faces.

## What is stored

The same rows as a video face: `asset_face` (box in the sampled frame's pixels), `asset_face_video_frame` (best frame
path in the video's `<asset>_faces` folder, best time, quality, sightings) and, for embeddable pets, `pet_search`
(the track embedding: the normalised mean of its best few sightings, with the species). The frame row's `version` is
`VIDEO_PET_SAMPLER_VERSION`, its own series.

`asset_job_status_gallery.videoPetsSampledAt` (fork migration) marks a video sampled for pets, as
`videoFacesSampledAt` does for faces. `petsDetectedAt` is stamped too, so every existing reader of it (Missing, the
nightly recognition skip) keeps working.

## Re-scanning a video

A rescan replaces this job's earlier pet faces on the video, keeping names:

- Embeddable: existing embedded pet faces are matched to tracks with `matchExistingFaces` (embedding distance, plus
  the poster window for an old poster face), exactly as video faces keep their ids, whatever species either was
  given: the species is a vote that can come out differently from one scan to the next. A matched face keeps its id and
  person; an unmatched unassigned face is deleted; an unmatched face with a person stays, unless `absorbedFaces` says
  a matched face of the same person took its place.
- Bucketed: the video's existing bucket faces of a species give their first id (one with a frame first) to the new
  face of that species; the others of the same person are deleted. The bucket person is the same either way.

As for faces, an unmatched face without a person is deleted and one with a person stays, unless a matched face of the
same person took its place (`absorbedPets`). A bucket face of a species the rescan no longer sees therefore stays: the
job cannot tell a bucket person from a pet the user named.

Manual faces and human faces are never touched.

Missing (not Reset, which queues every asset) queues, beside assets with no `petsDetectedAt`, the visible videos
already detected but not sampled for pets (`videoPetsSampledAt` null, or a pet frame row from an older
`VIDEO_PET_SAMPLER_VERSION`), while the setting is on. Turning the setting on therefore rescans nothing until an admin
runs Missing, as for faces.

## Effects on the face side

- `VideoFaceRepository.streamUnsampled` (face Missing) checks the sampler version only on faces that are not pets.
  Pet frame rows carry their own version, and the face job never rewrites them, so without this a face sampler bump
  would requeue every video with a pet on every Missing run.
- `VideoFaceService` (moments): `getSightings` reports whether the face is a pet. Moving or combining requires all
  faces to be pets or all people. Splitting a pet sighting takes its embedding from `detectPets` on that frame and
  writes it to `pet_search` with the source face's species, so the new face stays a pet. A bucketed pet face (no
  `pet_search` row) cannot be split: its moments all belong to one species person already. If recognition is off or
  the pet is not found again in that frame, the split fails before anything is written. Remove and restore work
  unchanged.
- Web: the moments strip moves a moment by splitting it and reassigning the new face. For a pet's moment, **Move to a
  new person** creates the person and then switches it to a pet (`PUT /people/{id}` with `type: pet`, from
  `specs/2026-11-04-person-pet-type-switch-design.md`), so the new face does not land on a human person. The pet flag
  comes from the person tile (`person.type`), not from the sightings response, which stays unchanged. **Move to another
  person** can still hand a pet's moment to a human, as Edit faces can with any pet face today.

## Reset and model switch

Every pet purge (`PetDetectionQueueAll` force, `PetRecognitionQueueAll` force, a model switch) deletes pet faces by
cascade, which removes their frame rows but not their frame files. Each purge first reads the frame paths of the pet
faces it is about to delete (`getPetFramePaths`, embedded faces only for the model switch's scoped purge) and removes
those files afterwards, as `VideoFaceDetector` does for faces a rescan drops. `videoPetsSampledAt` is left as it is:
the requeued run is forced and goes through every asset, and a video stamped but left without pets by a purge with
detection off behaves as a photo does after such a purge (Missing skips it until the next Reset).

## Replays

Five freely licensed clips from Wikimedia Commons (a cat with a laser pointer, two poodles, a dog fetching from a river,
two cats play-fighting, and a dog with a cat in archive footage), sampled as the job samples them, with both model sets
(`rfdetr-nano` + `pet-recognition-base`, and `rfdetr-small` + `pet-recognition-large`). Detections were dumped once and
replayed through the tracker offline.

- One animal's embedding moves a lot between samples: consecutive sightings of one track are a median 0.25 to 0.55
  apart. Two pets of one breed seen together can be as close as 0.07 between centroids (the poodles), so the tracker
  tells them apart by being seen together, not by looks.
- Per-species tracking without dedupe, the first version: the two-cats clip gave 8 or 9 pets and the dog-and-cat clip
  11 or 12. With dedupe and one tracker for both species: 3 to 4 and 5 to 7, with the extra tracks mostly one-frame
  fragments, which `minSightings` 2 drops. The poodles stay two dogs plus one short track, and the laser cat one cat.
- `maxDistance` between 0.5 and 0.6 changes little once the splits above are fixed; 0.55 stays.

Library copy (the owner's own videos, `rfdetr-small` and `pet-recognition-large`, pet recognition on): the 53 videos
with a pet face from the poster (62 faces, all assigned, 11 pets) and 60 random videos up to two minutes without one,
97 of the 113 scanned when the numbers were taken.

- Every pet face kept its person; none ended unassigned. 49 poster-pet videos now hold 72 pet faces with sightings
  (median 6, up to 70); 55 on named pets, 17 on unnamed ones. Unmatched poster faces with a person stay beside them.
- A pet named twice in one video is mostly two animals seen together that pet recognition gives the same pet: two cats
  lying side by side (boxes overlapping 15 %, in 61 of 62 frames), two animals far apart, a scene with many dogs. The
  poster already had the same doubles (5 videos). Faces seen together are not kept from sharing a pet, as #1310 does for
  people; that is a pet recognition change, left for a follow-up.
- In the random videos, 3 of 48 got a pet, all small or unsure detections (best scores 0.35 to 0.53, 75 to 86 px), and
  recognition matched three to named pets. `VIDEO_PET_CONFIDENT_SCORE` came from this: at 0.5 it drops two of them and
  five weak tracks in the poster-pet videos (three fragments in the many-dogs scene, two weak tracks of named pets, whose
  poster faces stay).
- No video failed once the ML service could write its model cache. A failed ML request now fails only that video's job.

## Cost

One `detectPets` call per sampled frame, up to `maxFrames` (900) per video, plus one ffmpeg seek per frame. A one-minute
clip is 60 calls; RF-DETR nano runs at a few tens of milliseconds per frame on the ML host. With recognition on, each
detected dog or cat also gets an embedding in the same call.

## Version pairings

- New server, old app: pet faces in videos show as faces with sightings, exactly as people do since #1283. An app from
  before #1283 shows the face without moments. An older Gallery web moves a pet's moment to a new human person.
- Old server, new app: the admin page hides the video pet settings when the server sends no `petDetection.video`. The
  moments strip's switch to a pet works against any server with the type switch.
- No response field is added: `isPet` and `petSpecies` on `VideoFaceRepository.getSightings` are server-internal.
- Stock Immich on a Gallery database: pet faces are already invisible to it beyond their `asset_face` rows; the new
  column is in a fork table.

## Layering compliance

New code is fork code: `src/gallery/utils/video-pet-detector.ts`, `video-pets.ts` and `pet-buckets.ts`, and the web
component `web/src/lib/gallery/components/admin/video-pet-settings.svelte`. The rest edits fork files: the fork-only
`pet-detection.service.ts` and `pet-recognition.service.ts`, `pet-face.repository.ts`, `video-face.repository.ts`,
`video-face.service.ts`, the fork config and interceptor, and the moments components under `web/src/lib/gallery/`.
The migration is in `migrations-gallery`, on the fork table `asset_job_status_gallery`; its `down()` drops the column
(a timestamp marker, rebuilt by a rescan).

Upstream files: one render line in `MachineLearningSettings.svelte` (inside the fork's pet section), the generated
OpenAPI spec and SDK, and the `petDetection` literals in three specs that already carried fork config
(`machine-learning.repository.spec.ts`, `system-config.service.spec.ts`, `MachineLearningSettings.spec.ts`).

## Testing

- Unit (server): bucket grouping (best box per frame, one face per species), per-species tracking (a dog and a cat
  never one track), `minSightings`, rescan matching (named face kept, unassigned unmatched deleted, bucket ids
  reused), the poster fallback, the mid-flight model-switch guard, Missing's queue, purge file cleanup on Reset and on
  a model switch, the nested config path, and the moments guards (pet/person move and combine refused, pet split
  writes `pet_search`, bucket split refused, pet not found refused before any write).
- Unit (web): the settings section (hidden against an older server, disabled until pet detection is on) and a pet's
  moment moved to a new person becoming a pet.
- Medium (`test/medium/specs/gallery/pet-face-video.repository.spec.ts`): `getForVideoPetDetect`,
  `applyVideoPets`, `markVideoPetsSampled`, `streamVideosForPetSampling`, `getPetFramePaths`, face Missing ignoring a
  pet frame's version, `getSightings` pet fields, and a pet split's `pet_search` row.
- Replays: public dog and cat clips, detections dumped once and replayed offline, as for #1306, to check
  `maxDistance` against the pet embedding model before the default is final.
