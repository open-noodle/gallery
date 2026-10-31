# Spatial Scene: depth parallax for still photos

**Date:** 2026-10-29
**Status:** Draft; prototype run on stock photos and a 492-photo personal library, suitability rule settled

## Summary

Apple Photos (iOS 26) offers **Spatial Scene** on suitable photos: a button that turns an ordinary 2D photo into a
3D-looking scene whose layers shift as the phone is tilted. Gallery gains the same option on the web and in the mobile
app.

A monocular depth model runs once per photo at upload, alongside face detection, OCR and pet detection. Its output, a
small greyscale depth map, is stored next to the asset's thumbnails, together with a few numbers describing how well the
photo separates into foreground and background. The asset viewer offers a **Spatial** toggle on photos that pass that
test (or on every photo, if the admin chooses), and renders the parallax in a WebGL shader driven by the pointer, the
device's tilt or a gentle idle sway.

v1 shipped on the web; the mobile app followed (see Mobile app). Neither does generative fill. The cost of that is visible stretching at the edges of the subject when the
scene moves. v1 keeps it small by limiting the movement and keeping the subject still. Filling the hidden background
is phase 2.

## What Apple ships, and what this matches

| Apple Spatial Scene                                                             | Gallery v1                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| On-device depth estimation from a single 2D photo                               | Server-side depth estimation at upload (Depth Anything V2)    |
| Offered only on photos it judges suitable (clear subject)                       | Same, from depth-map statistics; admin can offer it on all    |
| Gyroscope-driven parallax in Photos and on the Lock Screen                      | Pointer on desktop, gyroscope on phone browsers, idle sway    |
| Generative fill of the background revealed behind the subject                   | Not in v1: edge dilation and limited movement (phase 2: fill) |
| iPhone app                                                                      | Web, then the Gallery mobile app (iOS and Android)            |

This is **not** Apple's _spatial photos_ (stereo HEIC pairs captured by an iPhone 15 Pro or later for Vision Pro).
Displaying those would be a separate feature: they already contain both views and need no depth model.

## Goals and non-goals

**Goals**

- Every newly uploaded photo gets a depth map without user action, under the same admin controls as the other ML jobs.
- Existing libraries can be backfilled from the admin Jobs page.
- The viewer offers the option only where it looks good by default, mimicking Apple, with an admin setting to offer it
  on every photo.
- Nothing changes for stock Immich clients or for a database switched back to Immich.

**Non-goals (v1)**

- Generative or learned fill of revealed background.
- Videos, panoramas (equirectangular / `.insp`) and spatial (stereo) HEIC.
- Exporting a spatial scene as a video or Live Photo.

## Depth model

The admin picks one of three models, all with the Depth Anything V2 architecture (DINOv2 encoder, DPT head). They share
preprocessing and output, so one model class (`DepthEstimator`, `machine-learning/immich_ml/models/depth_estimation/`)
runs all of them. Each is published in Gallery's Hugging Face org as `open-noodle/<name>` and loaded through
`GalleryHostedModel` (`machine-learning/immich_ml/models/gallery_hosted.py`), as the RF-DETR pet detector is.

| Model                               | Params | Licence    | Files (fp32 / int8) | For                       |
| ----------------------------------- | ------ | ---------- | ------------------- | ------------------------- |
| `depth-anything-v2-small` (default) | 25M    | Apache-2.0 | 101 MB / 29 MB      | Any CPU                   |
| `distill-any-depth-small`           | 25M    | MIT        | 101 MB / 29 MB      | Any CPU                   |
| `distill-any-depth-large`           | 335M   | MIT        | 1.3 GB / none       | A GPU (≈11 s/photo on CPU) |

- **Why these.** Depth Anything V2 Small is the strongest small relative-depth model with a permissive licence.
  Distill-Any-Depth (Westlake AGI Lab) retrains the same architecture by distillation and reports better zero-shot
  accuracy. It is the only permissive source of a large model: Depth Anything V2's own Base and Large weights are
  CC-BY-NC-4.0 and cannot ship in an AGPL product.
- **Rejected.** Depth Anything 3 Small/Base are Apache-2.0 but are built for multi-view geometry (depth plus camera
  pose), and its monocular and large models are non-commercial. Apple's Depth Pro has conflicting licence statements
  (Apple Sample Code licence on GitHub, research-only on Hugging Face). Distill-Any-Depth Base is published only in the
  project's own checkpoint format, not the Transformers format the export uses; it can be added later.
- **Export.** From the official Transformers checkpoints with PyTorch's dynamo exporter, height and width symbolic in
  multiples of 14 and named `height`/`width` so `ShapePolicy` can pin them. Transformers sizes the head's last resize
  with `int(patch_height * patch_size)`, which every exporter freezes at the dummy input's size, so a portrait photo
  came back landscape. The export replaces it with the equivalent constant scale factor (1.75, checked across three
  input sizes before it is applied). The Depth Anything V2 Small export matches the onnx-community reference export to
  correlation 1.0000.
- **fp32 and int8.** Each repo ships `depth/model.onnx` (fp32); the two small ones also ship `depth/model_int8.onnx`
  (dynamic int8 weights), which is loaded, and the only file downloaded, when the CPU provider runs a small model.
  Accelerators get fp32. The large model is fp32 everywhere: int8 kept only 85% of its decisions.
- **Model comparison** (100 of the owner's photos, CPU, against Depth Anything V2 Small fp32):

  | Model                          | Output correlation | Same Spatial decision |
  | ------------------------------ | ------------------ | --------------------- |
  | Depth Anything V2 Small, int8  | 0.999              | 95%                   |
  | Distill-Any-Depth Small, fp32  | 0.990              | 97%                   |
  | Distill-Any-Depth Small, int8  | 0.990              | 95%                   |
  | Distill-Any-Depth Large, fp32  | 0.983              | 96%                   |
  | Distill-Any-Depth Large, int8  | 0.974              | 85%                   |

  The disagreements are photos sitting at a threshold. By eye, the two small models are interchangeable; the large one
  is sharper on thin structures (railings, strings, contrails) and separates people standing close together better.
- **Fixed shapes for accelerators.** A static-shape provider compiles one graph per shape, so a photo snaps to the
  nearest of seven canvases: square, 4:3, 3:2 and 16:9 both ways round, short side 518. The CPU provider takes the
  photo's own aspect, up to 160 patches a side.
- **Cost.** Measured on an Apple M2 CPU (ONNX Runtime CPU provider, 4 threads, 1440 px previews): fp32 about 650 ms per
  photo (99 MB of weights); the int8 export about 490 ms (27 MB), with output correlating 0.999 with fp32 and a mean
  absolute difference under 1%. Ship int8 as the default. Expect two to three seconds per photo on a typical NAS CPU,
  which makes this by far the heaviest ML job (RF-DETR pet detection is about 40 ms). Depth maps average about 50 KB.
- **Input.** The asset's preview file (edited preview when the asset is edited), resized so the short side is 518 px and
  rounded to a multiple of 14, RGB, ImageNet normalisation.
- **Output.** A disparity map at the model's resolution, normalised to 0–255 per image (near = 255), encoded as an
  8-bit greyscale PNG. 8 bits is enough: the shader's maximum offset is a few percent of the image width, so each grey
  level moves less than a pixel.

Licences to be confirmed against the model cards before the weights are published to the org.

### ML service changes

Following the pet-detection precedent (`models/pet_detection/`):

- `schemas.py`: `ModelTask.DEPTH_ESTIMATION = "depth-estimation"`, `ModelType.DEPTH = "depth"`,
  `ModelSource.DEPTH_ANYTHING`, and `DepthEstimationOptions` / `DepthEstimationOutput`.
- `models/depth_estimation/depth.py`: `DepthEstimator(GalleryHostedModel[DepthEstimationOptions])`.
- `models/constants.py`: map `depth-anything-v2-small` to `ModelSource.DEPTH_ANYTHING`.

`/predict` answers with JSON, so the depth map travels as a base64 PNG inside it (roughly 50–200 KB per photo), together
with the suitability metrics, computed in Python where the float disparity is already in memory:

```json
{
  "depth-estimation": {
    "depth": "<base64 PNG>",
    "width": 518,
    "height": 686,
    "boundarySharpness": 0.092,
    "edgeDensity": 0.0129,
    "foregroundRatio": 0.299,
    "focus": 0.83
  },
  "imageHeight": 1440,
  "imageWidth": 1080
}
```

A binary response would save the base64 overhead but would need a second endpoint or a multipart response. That is
not worth it at this size.

## Deciding which photos to offer it on

Apple does not publish its criteria. It visibly favours photos with a clear subject standing in front of a
distinguishable background: portraits, pets, objects, landscapes with a near foreground. It does not offer the option
on flat scenes such as documents, screenshots, walls or distant skylines, or on open ground planes (beach, sea, field)
where parallax would only look like a tilt.

Depth Anything's output is relative: its scale and shift are unknown per image. So every metric is computed on the
map after normalising it to 0–1 (1st to 99th percentile), and must not depend on the absolute range.

**What did not work.** The first draft used Otsu's threshold to split foreground from background and scored the gap
between the two class means (`separation`). In the prototype, both flat screenshots scored 0.44–0.45, the same as real
photos: normalisation stretches even a soft blur into two classes.

**What does work** is looking for sharp depth edges, where a subject is cut out against its background:

1. Split the normalised disparity into foreground and background with Otsu's threshold.
2. **`boundarySharpness`**: the median depth gradient (Sobel, per pixel at the 518 px short side) along the boundary of
   that foreground. A subject's outline is an occlusion edge, so the gradient there is high. On a ground plane the
   boundary is a line across a smooth ramp; on a screenshot it is a soft blur. Both score low.
3. **`edgeDensity`**: the share of pixels whose gradient exceeds an occlusion-sized step (0.04). This catches scenes
   whose depth edges are many and thin rather than one subject: tree trunks, railings, street canyons.
4. **`foregroundRatio`**: the share of pixels in the foreground, as a sanity band.

5. **People and pets.** Depth edges alone miss many photos of people. In a group on a lawn or two people in a room, the
   Otsu split lands on the floor or lawn ramp rather than on the people's outlines. A close-up portrait fills the frame,
   so the foreground band rejects it, and the band cannot be loosened because walls and posters filling the frame have
   the same `foregroundRatio` (0.76–0.81 for both in the sample). Gallery already knows where the faces are:
   `asset_face` holds person faces and pet detections, with bounding boxes, at no extra ML cost.

A photo is suitable when

```
(  (boundarySharpness >= 0.03 OR edgeDensity >= 0.02) AND 0.01 <= foregroundRatio <= 0.75 )
OR the asset has a face (person or pet) whose box height is at least 3% of the image height
```

**Evidence.** On 18 stock photos plus 2 flat screenshots, every unsuitable photo (both screenshots, beach, sea, field,
forest path) scored `boundarySharpness <= 0.025` and `edgeDensity <= 0.0103`, and every clearly suitable one passed an
edge test. On the owner's library of 492 iPhone photos, the owner judged the offered set good, and a hand-labelled set
of 40 borderline photos (16 just above the edge threshold, 16 just below it, and the 12 excluded by the foreground band)
showed the face rule's value. The prototype measured faces with OpenCV's YuNet as a stand-in. The dev stack then re-ran
the 492 previews through Gallery's own detector (`buffalo_l`, minimum score 0.7, the defaults), which is what the
server reads:

| Rule                                    | Suitable offered | Unsuitable offered | Library offered |
| --------------------------------------- | ---------------- | ------------------ | --------------- |
| Depth edges only                        | 12 of 29         | 1 of 11            | 376 of 492      |
| Depth edges, or a face ≥ 3% (YuNet)     | 21 of 29         | 2 of 11            | 408 of 492      |
| Depth edges, or a face ≥ 3% (buffalo_l) | 22 of 29         | 2 of 11            | 404 of 492      |

Where both detectors find a face, their box heights agree (median ratio 0.98), so the 3% cut-off carries over. They
disagree on which faces exist: YuNet alone reports 29 faces of 3% or more, mostly ones `buffalo_l` scores below 0.7,
and `buffalo_l` alone reports 4. Lowering the cut-off to 1.5% adds one suitable photo and no unsuitable one, too
little evidence to move it. The remaining misses have no detectable face (a chair in front of a desk, a vase close-up, crowds seen from behind) and
are left to the `all` offer mode. The two unsuitable photos offered were a lake with one tree edge and a wall of text
with a person in front of it.

Because eligibility is decided at read time, the order of the depth job and face detection after upload does not
matter: both have finished long before anyone opens the photo, and a later face edit is picked up automatically.

The ML service returns only the raw metrics. The server stores them, and decides eligibility at read time against
admin-configurable thresholds, so retuning needs no reprocessing. `focus` (the mean foreground disparity) is also
returned; the viewer uses it as the still plane.

Assets are skipped outright, with no depth map, when they are videos, `Hidden`, equirectangular or `.insp` panoramas.
Screenshots get a map like everything else and fail the edge tests on their own.

### Offer mode

The admin setting `offer` takes:

- **`suitable`** (default): the toggle appears only on photos that pass the thresholds, as in Apple Photos.
- **`all`**: the toggle appears on every photo with a depth map.

Whether users should also be able to override this for themselves is an open question (below).

## Server

### Job

A new queue `spatialScene` with `SpatialSceneQueueAll` and `SpatialScene` jobs, handled by a fork
`SpatialSceneService` in `server/src/gallery/services/` and registered in `server/src/gallery/index.ts`.

- **Upload.** Like `PetDetectionService`, it chains off `JobSuccess` for `AssetGenerateThumbnails` (upload or notify
  sources only), so upstream's follow-up list in `JobService.onDone` stays untouched.
- **Edits.** It also chains off `JobSuccess` for `AssetEditThumbnailGeneration`. A crop or rotation changes the geometry,
  so the map is recomputed from the edited preview. A colour adjustment does not change the geometry, but re-running on
  it is harmless and keeps the rule simple.
- **Backfill.** `SpatialSceneQueueAll` streams photos with no `asset_spatial_scene` row (all photos with `force`), the
  same shape as `streamForPetDetectionJob`. The admin Jobs page starts it.
- **Model switch.** A config change to `modelName` queues a forced run, mirroring `PetRecognitionService.handleModelSwitch`.
  The in-flight model-switch guard from `handlePetDetection` applies here too.

Registering a queue touches the upstream files pet detection already touches, one line each: `QueueName` / `JobName`
in `enum.ts`, the job union in `types.ts`, the `QueueService` switch, and `queue-legacy.dto.ts`.

### Storage

A new fork table, keyed to the asset:

```sql
CREATE TABLE "asset_spatial_scene" (
  "assetId" uuid NOT NULL,
  "path" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "boundarySharpness" real NOT NULL,
  "edgeDensity" real NOT NULL,
  "foregroundRatio" real NOT NULL,
  "focus" real NOT NULL,
  "modelName" text NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "asset_spatial_scene_pkey" PRIMARY KEY ("assetId"),
  CONSTRAINT "asset_spatial_scene_assetId_fkey" FOREIGN KEY ("assetId")
    REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);
```

The row's existence is the "processed" stamp, so no column is added to `asset_job_status_gallery`.

**Why not an `asset_file` row.** `AssetFileType` is upstream's enum on upstream's table. A `depth` type would put a value
into Immich's table that stock Immich does not know (layering rule 1), and the revert script would have to clean it out.
The trim, adjust and favorite precedents all chose a side table.

**The file** sits beside the thumbnails, at `StorageCore.getNestedPath(StorageFolder.Thumbnails, ownerId,
'<assetId>_depth.png')`. It is written through `StorageService.getWriteBackend()` as `MediaService.persistFile` does: on
disk at the absolute path, on S3 under the relative key from `getRelativeNestedPath`. `path` records whichever form was
written, so `StorageService.backendFor` resolves it like any other file.

**Deletion.** `AssetDelete` fires after the cascade has already removed the row, so the handler cannot read `path`.
Instead the path is deterministic: the fork's `AssetDelete` handler rebuilds it from `{ assetId, userId }` and queues a
`FileDelete` in the current write backend's form. `FileDelete` only logs a missing file. A file left on the old backend
after an admin switched backends without running the storage migration is the one gap. The storage migration
(`StorageMigrationService`) moves depth maps whenever previews are selected, since each is made from its preview
(`fileType: 'depthMap'` on an `asset` entry, like encoded videos), and counts them with the previews, so the admin
form needs no new option. `revert-to-immich.sql`'s S3 guard leaves them out: Immich never reads a depth map.

**Migration** `server/src/schema/migrations-gallery/1799700000000-AddAssetSpatialSceneTable.ts` (or the next round number above the
newest upstream and fork migrations at implementation time). Its `down()` drops the table: depth maps are derived data,
regenerated by the backfill job, so there is nothing to move back. The files stay on disk; an older build simply ignores
them.

### API

- **`GET /assets/{id}/depth`** in `GalleryAssetController`: streams the PNG through `this.backendMedia`, with the same
  access check as the preview thumbnail (`Permission.AssetView`, so shared links and space members work). 404 when there
  is no map.
- **Availability on the asset.** `applyAssetResponseOverlay` sets `spatialScene: boolean` on `GET /assets/{id}`: true when
  a map exists and the offer mode allows it. The face rule reads the largest face box from the `faces` the overlay
  already receives, so it needs no extra query. The field is declared once, as an extension of `AssetResponseDto` in a fork
  DTO. Stock clients ignore unknown fields, and the timeline's bulk responses stay unchanged, so the cost is one join on
  a call the viewer already makes.
- **`spatialScene` in `GET /server/features`**, optional, true when the feature is enabled (`isSpatialSceneEnabled`).
  Spread into `ServerFeaturesSchema` from the fork DTO and into `getFeatures` from `src/gallery/utils/spatial-scene.ts`.
  The mobile app reads it before asking for any asset's flag, because its viewer does not otherwise call
  `GET /assets/{id}`.

### Config

Under `machineLearning`, next to `petDetection` (schema in `server/src/gallery/dtos/config.dto.ts`):

```ts
spatialScene: {
  enabled: boolean;          // default: see open questions
  modelName: string;         // 'depth-anything-v2-small'
  offer: 'suitable' | 'all'; // default 'suitable'
  minBoundarySharpness: number; // default 0.03
  minEdgeDensity: number;       // default 0.02
  minForegroundRatio: number;   // default 0.01
  maxForegroundRatio: number;   // default 0.75
  minFaceHeight: number;        // default 0.03 (share of image height); 0 disables the face rule
}
```

The admin ML settings page gains a Spatial Scene section beside Pet Detection.

## Web viewer

### Placement

- **Toggle.** Show and Hide actions from `getSpatialSceneActions` (`web/src/lib/gallery/spatial/spatial-scene.svelte.ts`),
  rendered by two `ActionButton` lines in `AssetViewerNavBar`, offered when `asset.spatialScene` is true, the photo is an
  image and the browser has WebGL2. The state is `spatialSceneState`, which holds the id of the photo the Spatial view is
  on rather than a flag in the upstream `assetViewerManager`, so moving to another photo leaves the view with nothing to
  reset.
- **Viewer.** `AssetViewer.svelte`'s `viewerKind` gains one arm returning `'SpatialSceneViewer'` for the active photo
  (after the editor arms, so opening the editor wins), and the template gains one branch rendering
  `web/src/lib/gallery/spatial/SpatialSceneViewer.svelte`. If the map fails to load, it shows a toast and returns to the
  normal view.
- **Admin.** `SpatialSceneSettings.svelte` (`web/src/lib/gallery/admin/`), included by one line in the upstream
  `MachineLearningSettings.svelte`: enable, model and offer mode. The thresholds are config-file only.

Those are the upstream web hunks: one viewer arm, one template branch, two nav bar lines, one settings line, and the
queue's entries in the four lists every queue appears in.

### Rendering

A single WebGL2 full-screen quad samples the preview image and the depth map:

- **Ray-marched parallax** (parallax occlusion mapping in screen space). For each output pixel, step along the view
  offset through the depth map (16–32 steps) to find the source pixel that lands there. Unlike a displaced mesh, this
  gets occlusion right: the foreground correctly covers the background as it moves.
- **Focus plane on the subject.** Zero parallax sits at the foreground's mean disparity, recomputed in the browser from
  the map by the same Otsu split the server uses (`subjectDepth`, so the API carries no extra field), so the
  subject stays put and the background moves behind it, which is the look Apple uses. It also moves the stretching
  artifacts to the background, where they are least noticeable.
- **Edge dilation.** The depth map is max-filtered by a few pixels before upload to the GPU, so foreground edges bleed
  slightly into the background. This is the standard way to stop slivers of the subject ghosting onto the background.
- **Limited amplitude.** Maximum offset of about 3% of the shorter image side, plus a slight zoom (about 1.05×) so revealed
  edges never show a blank border.
- **Inputs.** Pointer position over the image on desktop; `deviceorientation` on phone and tablet browsers (iOS needs
  `DeviceOrientationEvent.requestPermission()` on the toggle's tap); a slow idle sway when there is no input for a few
  seconds. Movement is smoothed with a spring so it feels physical.
- **Accessibility and fallback.** With `prefers-reduced-motion`, the idle sway is off and movement is limited to direct
  pointer or tilt input. Without WebGL2, the button is hidden.

The preview image (not the original) is the colour source: it is already loaded by the viewer, and the depth map's
resolution would not do justice to an original anyway.

## Mobile app

### Placement

- **Flag.** The app's local database is filled by sync, which carries no `spatialScene`. So the viewer reads
  `spatialScene` from `GET /server/features` as the app's server info already holds it (`ServerFeatures.spatialScene`,
  read by `spatialSceneEnabledProvider`). The app loads those features at sign-in and reloads them whenever the socket
  connects or the server sends `on_config_update`, so an admin turning the feature on or off reaches an open app. Only
  when the flag is on does the viewer ask `GET /assets/{id}` for each photo shown (`spatialSceneOfferedProvider`), the
  same endpoint the people strip uses for assets the viewer does not own. A server that predates the feature flag, or a
  stock Immich server, counts as off, and the app makes no per-photo request.
- **Toggle.** `SpatialSceneToggleButton`, a round button beside the OCR toggle in the viewer's bottom bar (one line in
  `bottom_bar.widget.dart`). The state is `spatialSceneAssetProvider`, the remote id of the photo the view is on, like the
  web's `spatialSceneState`.
- **Viewer.** `SpatialSceneOverlay`, one `Positioned` in `asset_page.widget.dart`'s stack, right above the photo and sized
  to the viewport like it (the stack is taller: the details sheet sits below the photo).
  It renders nothing unless its photo is the active one. It ignores touches, so swiping, tapping for the controls and
  dragging up for the details keep working, and swiping to another photo leaves the view. If the preview or the map
  fails to load, it shows a toast and returns to the photo.
- Everything else lives in `mobile/lib/gallery/spatial/` and `mobile/shaders/spatial_scene.frag`.

### Rendering

The web viewer's pipeline, ported one to one: `depth.dart` is `depth.ts` (`subjectDepth`, `dilate`, the spring), with
the same tests, and `spatial_scene.frag` is the same fragment shader in Flutter's runtime-effect GLSL, compiled by
`impellerc` for Metal, Vulkan and GLES. The preview and the depth map load through `RemoteImageProvider`, so they use the
app's HTTP client, auth headers and client certificates; the map is filtered in an isolate.

- **Input.** Tilt, from the accelerometer's gravity vector via `sensors_plus` (`tilt.dart`): roll and pitch relative to
  how the phone was held when the view opened, smoothed, with the web's 20° range. Gravity gives the tilt without the
  gyroscope's drift. Finger drag is not used, because the viewer's swipe and drag gestures own the touch.
- **Idle sway** after 2.5 s in which the tilt changes less than 3% of the range, which a held phone always does. Off when
  the system asks for reduced motion (`MediaQuery.disableAnimations`).
- **iOS purpose string.** `sensors_plus` links `CMAltimeter`, so `Info.plist` carries `NSMotionUsageDescription`. Reading
  the accelerometer shows no permission prompt.

### Version pairings

| App            | Server                         | What the viewer does                                                     |
| -------------- | ------------------------------ | ------------------------------------------------------------------------ |
| With the toggle | With the features flag         | Offers it on photos the server marks                                     |
| With the toggle | Gallery from before the flag   | No button and no extra requests                                          |
| With the toggle | Stock Immich                   | No button and no extra requests                                          |
| Without it      | Any                            | Unchanged: the new features field is optional and ignored                |

## Layering compliance

| Rule                                 | How this design meets it                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1. Immich's tables keep their meaning | Fork table `asset_spatial_scene`; nothing added to `asset_file` or `asset_job_status`. FK listed in `gallery-upstream-fks.json` under `asset_pkey`. |
| 2. Stock Immich keeps working        | New endpoint and an ignored extra field only; no sync stream changes.                                         |
| 3. Switching back stays safe         | `revert-to-immich.sql` drops the table; `down()` drops it too (derived data, regenerated by the backfill). Leftover `_depth.png` files are inert. |
| 4. Prefer Immich's code              | Reuses the ML `/predict` pipeline, the job queue, `backendMedia` and the thumbnail path scheme.              |
| 5. Hooks, not logic, in upstream files | Queue registration lines (as pet detection); one viewer arm, one branch, one nav button; one DTO extension each for the asset and the server features. Mobile: one button line, one overlay line, one field on `ServerFeatures` (as `localTakenRange`), the shader and dependency in `pubspec.yaml`, the purpose string. |

## i18n

New strings (the Spatial button and its tooltip, admin settings labels and descriptions, the Jobs page queue name) go
into `i18n/gallery/en.json` and the nine maintained locales in the same commit.

## Testing

- **ML:** unit tests for `DepthEstimator` and the metrics: output shape and resolution, PNG round-trip, and metrics on
  synthetic maps (a smooth ramp and a blurred blob score low on both edge tests; a sharp-edged disc on a far plane
  scores high `boundarySharpness` with the expected `foregroundRatio`).
- **Server unit:** `SpatialSceneService` chains on the two `JobSuccess` cases only, skips videos, hidden assets and
  panoramas, writes the row and file, handles a hard-deleted asset as Skipped, and applies the model-switch guard. Offer
  mode, thresholds and the face rule (person and pet faces, the 3% height cut-off, `minFaceHeight: 0`) in the overlay.
- **Medium:** repository stream and upsert; the access oracle snapshot for the new endpoint's permission check.
- **Guards:** `gallery-upstream-fks.spec.ts` (new FK), `revert-to-immich.spec.ts` (new table), and the revert workflow
  seeding a row.
- **Web:** `SpatialSceneViewer` falls back cleanly without WebGL2; the button follows `asset.spatialScene`; the flag
  clears on navigation.
- **Mobile:** `depth_test.dart` mirrors `depth.spec.ts`; `tilt_test.dart` covers roll, pitch, the rest position and the
  clamp; the provider test covers each pairing above (feature off, flag absent, stock server, photo not marked, read
  failure); the widget test opens and closes the view from the button, keeps it off another photo, closes it on a load
  failure, and draws a scene with the real shader.

## Roadmap

- **Prototype (done, 2026-10-29).** A standalone harness ran the ONNX model over 20 stock photos and then the owner's
  492 iPhone photos, writing depth maps, metrics and a WebGL page with the shader and live threshold controls. It settled
  the cost and the map size (above), showed that Depth Anything V2 Small's silhouettes are clean on fur and people,
  replaced the separation metric with the edge-based one, and added the face rule. Still open: how noticeable the
  stretching is without fill, which decides how urgent phase 2 is.
- **v1 (web):** everything above.
- **Phase 2: background fill.** At job time, also produce a background layer with the foreground removed and filled in,
  stored as `<assetId>_depth_bg.webp`; the shader composites two layers. Candidates: OpenCV Telea inpainting (cheap,
  CPU, smeary) and LaMa in ONNX (much better, realistically GPU-only, `gallery-ml:*-cuda`). Diffusion inpainting matches
  Apple but only as an opt-in for GPU installs.
- **Phase 3: mobile.** Done: see Mobile app.

## Open questions

1. **Default on or off?** The owner's direction is to compute at upload like faces and OCR. At two to three seconds per
   photo on NAS hardware, a default-on backfill of a large library takes days. Recommendation: ship with
   `enabled: false` in the first release, and turn it on by default once real installs have run it.
2. **Per-user override of the offer mode?** For example, a user setting "Show Spatial on all photos". This is cheap to
   add later, because eligibility is already decided at read time.
3. **Shared-link viewers** get the toggle: `spatialScene` is set before the overlay's shared-link return, and the depth
   endpoint uses `AssetView` with `sharedLink: true`, like the thumbnail. Revisit if owners object.
