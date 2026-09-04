# Pet Detection

Gallery can automatically detect pets and other animals in your photos using RF-DETR object
detection. Detected animals appear in the **People** section alongside human faces, making it
easy to browse all photos of a specific pet.

By default every animal of a species shares one entry — one "dog", one "cat". Turn on [Pet Recognition](/features/pet-recognition) to tell your individual dogs and cats apart and name them.

## How It Works

When a photo is uploaded or reprocessed, the machine learning service runs an RF-DETR model to
detect animals. Each detected animal is cropped and added to the People section as a
recognisable entity, similar to how face detection works for people.

The model detects the following animal categories: bird, cat, dog, horse, sheep, and cow.

Wild animals such as bears, zebras, giraffes and elephants are deliberately **not** detected.
They are rare in a household photo library, and including them caused bear-like dog breeds —
Newfoundlands, Keeshonds, Great Pyrenees — to be confidently mislabelled as bears.

## Model Options

Two models are available:

| Model          | Input   | Speed        | Best for                                   |
| -------------- | ------- | ------------ | ------------------------------------------ |
| `rfdetr-nano`  | 384×384 | Fastest      | Almost everyone. The default.              |
| `rfdetr-small` | 512×512 | ~1.8× slower | Libraries with many small or distant pets. |

The default is **rfdetr-nano**. On a benchmark of real pet photos it correctly identified the
species in 98% of images, and it is more accurate than the previous YOLO11 models at every
size while costing the same time per photo as the old default.

`rfdetr-small` is worth choosing if your pets are often small in frame — in the background of
a landscape, or across a room. On COCO it detects roughly 8% more small objects than the nano
model.

## Accuracy

Measured two ways: on **Oxford-IIIT Pet** (7,390 photos, sampled evenly across all 37 breeds),
which represents the common case of a pet filling the frame; and on **COCO val2017**, which
represents pets that are small, partly hidden, or in cluttered scenes.

Species recall — the share of photos where the correct species was detected:

| Model                     | Pet portraits | Cluttered scenes | Small pets | Time per photo |
| ------------------------- | ------------- | ---------------- | ---------- | -------------- |
| `rfdetr-small`            | 98.3%         | 78.9%            | 56.2%      | ~73 ms         |
| `rfdetr-nano` _(default)_ | 98.1%         | 74.5%            | 48.3%      | ~41 ms         |
| `yolo11s` _(old default)_ | 95.6%         | 68.8%            | 42.5%      | ~44 ms         |

`rfdetr-nano` is more accurate than every YOLO11 model at any size, including ones three times
slower, while costing about what the old default cost.

The gap widens on harder photos: on cluttered scenes `rfdetr-nano` leads the old default by
5.7 points rather than 2.5, and it finds more small pets at 384×384 than YOLO11 did at 640×640.

Together with the RGB and letterboxing corrections that ship alongside the new model, end-to-end
species recall on pet portraits moves from **84.8% to 98.1%**, and photos where no animal was
detected at all fall from 10.0% to 0.7%.

:::note One thing to watch
RF-DETR produces roughly twice as many low-confidence extra boxes per image as YOLO11 did. Much
of that is an artefact of how the benchmark counts near-duplicate boxes on the same animal, but
if you do see spurious detections, raising the **minimum confidence score** is the lever.
:::

## Configuration

### Admin Settings

1. Go to **Administration** > **Machine Learning Settings**.
2. Under **Pet Detection**, choose your preferred model from the dropdown.
3. Adjust the **minimum confidence score** if needed (default: 0.3).

### Re-running Detection

To detect pets in existing photos that were uploaded before pet detection was enabled:

1. Go to **Administration** > **Jobs**.
2. Run the **Pet Detection** job for **Missing** assets.

:::danger "All" is a destructive reset, not a top-up
Running the job for **All** assets (the **Reset** button) is a full reset: it **deletes every pet person and every pet detection first**, including any names you gave them and the copies projected into shared spaces, and only then re-detects. Names are not recoverable.

The deletion happens even when pet detection is disabled — that is deliberate, so you can turn detection off and then clear out the pets it already created. But it means resetting while detection is off leaves you with no pets at all until you re-enable it and reset again.

**Missing** is the safe option, and the one you want here: it only processes assets that have never been through pet detection.
:::

## Upgrading from YOLO11

Earlier versions of Gallery used YOLO11 (`yolo11n`, `yolo11s`, `yolo11m`). If you had pet
detection enabled before this release, here is exactly what changes.

:::warning Your existing photos are not reprocessed automatically
Nothing is re-detected, re-embedded or re-clustered on upgrade. The new model applies to
**newly uploaded photos only** until you explicitly rebuild — so none of the accuracy above
reaches the photos already in your library until you run a Reset.

This is deliberate: an automatic rebuild would delete every pet name you have set and put hours
of machine-learning work on your server without asking.
:::

### What happens on its own

- **Your model setting is migrated.** Any `yolo*` value becomes `rfdetr-nano` when the server
  starts. There is nothing to do, and the old names are no longer offered.
- **The new model downloads on first use** — about 108 MB for `rfdetr-nano`, cached afterwards.
- **New photos use RF-DETR immediately.**

### What does _not_ happen on its own

- **Existing detections are left exactly as they were.** They were produced by the old model,
  so they keep its mistakes. Nothing re-runs over them.
- **Wild-animal entries become permanent until you rebuild.** Any bear, zebra, giraffe or
  elephant YOLO11 created stays in your People section. RF-DETR will never produce those
  species again, so nothing will ever correct or replace them on its own — a Reset is the only
  thing that clears them.
- **Individual pets are not re-clustered.** If you use [Pet Recognition](/features/pet-recognition),
  your existing pets keep the embeddings the old detector's crops produced.
- **Your confidence threshold is not migrated.** This is the one to check. If you never changed
  it, you get the new default of `0.3` and nothing more is needed. But if you _explicitly_ set a
  value for YOLO11, it carries over — and the two models are calibrated differently, so the old
  default of `0.6` behaves roughly twice as strictly under RF-DETR and will miss pets. Open
  **Administration → Machine Learning Settings → Pet Detection** and set it back to `0.3` unless
  you have a reason not to.

Until you rebuild, your library is in a mixed state: older photos carry YOLO11's detections and
newer ones carry RF-DETR's. If you want the improved accuracy across your whole library, the
Reset below is not optional — it is the only thing that applies it.

### Rebuilding

To re-detect everything with the new model, run **Administration → Jobs → Pet Detection →
Reset**.

:::danger Reset deletes your named pets
Reset removes every pet person and detection first — including any names you gave them and the
copies projected into shared spaces — and only then re-detects. Names are not recoverable. On a
large library the rebuild takes a while, since every photo goes through the detector again.
:::

If you use [Pet Recognition](/features/pet-recognition), the rebuild also re-embeds and
re-clusters your dogs and cats, so individual pets are rebuilt from scratch too.

## Tips

- Lower the confidence threshold if pets are being missed; raise it if you see spurious
  detections. The default of 0.3 works well for most libraries.
- Detected pets can be renamed and merged in the People section, just like human faces.
- A few unusually bear-like dogs may not be detected at all rather than being mislabelled.
  This is intentional — see the note about wild animals above.

## Technical Implementation

### Inference Pipeline

```
                         Machine Learning Service
┌──────────┐    ┌──────────────────────────────────────────────┐
│  Server  │    │                                              │
│          │    │  ┌────────────┐  ┌──────────┐  ┌──────────┐  │
│ POST ────┼───►│  │ Preprocess │─►│ RF-DETR  │─►│ Post-    │  │
│ /predict │    │  │ RGB resize │  │ ONNX     │  │ process  │  │
│          │◄───┼──│ ImageNet   │  │ Runtime  │  │ filter + │  │
│ [pets]   │    │  │ NCHW float │  │          │  │ rescale  │  │
└──────────┘    │  └────────────┘  └──────────┘  └──────────┘  │
                └──────────────────────────────────────────────┘
```

1. **Preprocessing** — The preview image is decoded to RGB, resized to the model's input size
   (384 or 512), scaled to `[0,1]` and normalised with ImageNet statistics, then transposed to
   NCHW.
2. **Inference** — ONNX Runtime runs the RF-DETR model, producing 300 object queries: box
   coordinates plus class logits over the 91-class COCO label space.
3. **Postprocessing** — Logits are passed through a sigmoid, restricted to the six domestic
   animal classes, and thresholded by the configured `minScore`. Boxes are converted from
   normalised centre/width/height to pixel corners and clipped to the image. No
   non-maximum-suppression step is needed — RF-DETR's queries are already deduplicated.

Models are downloaded from Hugging Face Hub on first use and cached locally. Inference
supports CUDA, OpenVINO, CoreML, and CPU backends via ONNX Runtime.

### Database Changes

Pet detection extends two existing tables rather than creating new ones:

- **`person`** — Added `type` column (VARCHAR, default `'person'`) to distinguish humans from
  pets, and `species` column (VARCHAR, nullable) for the animal label (e.g., `'dog'`,
  `'cat'`).
- **`asset_job_status`** — Added `petsDetectedAt` timestamp to track which assets have been
  processed.

Detected pets are stored as `person` rows with `type = 'pet'`. Each species creates one person
entry per user (e.g., one "dog" person, one "cat" person), and individual detections are
stored as `asset_face` rows with bounding box coordinates linked to that person. This reuses
the existing face/person infrastructure for thumbnails, naming, merging, and browsing.

:::note Pet Recognition covers dogs and cats only
When [Pet Recognition](/features/pet-recognition) is enabled, **dogs and cats** are grouped into individual pets you can name, instead of one shared bucket per species. The other four detected categories (bird, horse, sheep, cow) always keep the one-person-per-species behaviour described above.

This is a limit of the recognition model, not an oversight: it is trained on dog and cat identities, so it has no basis for telling one bird or one horse apart from another. Restricting it also contains the cost of a misdetection — the detector occasionally labels a person as an animal, and a shared species bucket absorbs that far more gracefully than an individual identity would.
:::

### Job Flow

Pet detection runs as a dedicated BullMQ queue (`petDetection`) with concurrency of 1:

1. **On upload** — The job service automatically queues a `PetDetection` job alongside face
   detection and smart search.
2. **Manual re-run** — An admin can trigger `PetDetectionQueueAll` from the Jobs page, which
   streams all unprocessed assets and queues individual jobs.
3. **Per-asset job** — Each job calls the ML service with the asset's preview file, creates or
   reuses person entries per species, records `asset_face` bounding boxes, and queues
   thumbnail generation for new pet persons.
