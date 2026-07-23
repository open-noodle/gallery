# Pet Detection — RF-DETR migration and domestic class set

**Date:** 2026-07-23
**Status:** Design approved, implementation pending
**Issue:** Pet detection produces poor results; dogs are reported as bears.

## Summary

Pet detection currently runs YOLO11 through an inference pipeline with two defects that
between them lose roughly one in ten pets, and emits a class list containing safari animals
that mislabel bear-shaped dog breeds. This design replaces the detector with RF-DETR,
restricts detection to the six animal classes a household photo library actually contains,
and lowers the confidence threshold.

Measured on 592 photos sampled evenly across all 37 breeds of the Oxford-IIIT Pet dataset,
this takes species recall from **84.8% to 98.1%**, drops the no-detection rate from **10.0%
to 0.7%**, and eliminates the bear misclassification entirely — at unchanged CPU cost.

## Problem

### What users see

Dogs are labelled as bears. The symptom is documented in our own feature page
(`docs/docs/features/pet-detection.md`), which advises switching model size as a workaround.

### What is actually wrong

Three separate problems, only one of which causes the reported symptom.

**1. The image reaches the model as BGR.** `PetDetector._predict` calls `decode_cv2`
(`machine-learning/immich_ml/models/pet_detection/detection.py:72`), which routes through
`pil_to_cv2` (`machine-learning/immich_ml/models/transforms.py:47`) and applies
`COLOR_RGB2BGR`. YOLO's ONNX export expects RGB. The only other consumers of `decode_cv2`
are the InsightFace face detector and recogniser
(`machine-learning/immich_ml/models/facial_recognition/`), both of which genuinely want BGR,
so the helper is correct and the pet detector is the outlier. Cost: **5.1 points of recall.**

**2. The 640x640 resize is a stretch, not a letterbox.** `detection.py:82` calls
`cv2.resize(image, (640, 640))` directly. Ultralytics trains and infers with
`LetterBox(center=True)`, preserving aspect ratio and padding with grey. Squashing a 16:9
photo to square distorts every subject. The box coordinates scale back correctly, so the
defect is invisible in testing — it only costs recall. Cost: **3.9 points of recall.**

**3. The class list contains safari animals.** `_ANIMAL_CLASSES` includes `bear`, `zebra`,
`giraffe` and `elephant`. In practice the only effect is that YOLO confidently labels
bear-shaped dog breeds as bears. **This, not the preprocessing, is the cause of the reported
symptom.**

### What is not wrong

The postprocessing filter at `detection.py:97-113` takes `argmax` over all 80 COCO classes
before restricting to animals, which in principle could discard an anchor whose top class is
not an animal. Measured at thresholds 0.6 and 0.25, this **never fires** and has no effect on
any metric. It is not a bug. It is being replaced only because the RF-DETR postprocess is
subspace-by-construction, not because it was causing harm.

## Evidence

### Method

A standalone harness replicates the shipped pipeline exactly, then toggles one defect at a
time. Ground truth comes from the Oxford-IIIT Pet dataset, whose filename convention encodes
species (cat breeds capitalised, dog breeds lowercase) across 7,390 real pet photos. The
sample is 16 images per breed across all 37 breeds, seeded for reproducibility.

Metrics: **species recall** (at least one detection naming the correct species), **no
detection**, **wrong species**, and **bear rate**.

### Cumulative effect of each change (yolo11s)

| Step                                      | Recall    | No detection | Wrong species | Bears    |
| ----------------------------------------- | --------- | ------------ | ------------- | -------- |
| Shipped (BGR, stretch, 10 classes, 0.6)   | 84.8%     | 10.0%        | 5.2%          | 1.5%     |
| Fix BGR to RGB                            | 89.9%     | 4.7%         | 5.4%          | 1.5%     |
| Add letterboxing                          | 93.8%     | 3.0%         | 3.2%          | 1.7%     |
| Drop safari classes, threshold 0.6 to 0.3 | 95.6%     | 2.0%         | 2.4%          | **0.0%** |
| Switch to RF-DETR-nano                    | **98.1%** | 0.7%         | 1.2%          | 0.0%     |

### Why the bears happen

The bear misclassifications are concentrated in specific breeds and are highly confident
(scores 0.86–0.94): Newfoundland, Keeshond, Great Pyrenees, Pomeranian, Staffordshire Bull
Terrier. On those images the model emits **bear only and never dog** (bear-with-correct = 0
across every variant tested), so no "prefer dog over bear" tiebreak can recover them.
Removing the class is the only effective fix.

### Model comparison

All candidates evaluated on the same sample with the same domestic class set at
`min_score=0.3`. YOLO weights are official Ultralytics exports; the RF-DETR adapter was
cross-validated against the `rfdetr` library's own `predict()` and agrees within 0.01
confidence.

| Model               | Input | Recall    | No detection | Wrong species | CPU       | License    |
| ------------------- | ----- | --------- | ------------ | ------------- | --------- | ---------- |
| rfdetr-small        | 512   | **98.3%** | 0.7%         | 1.0%          | 73 ms     | Apache-2.0 |
| rfdetr-medium       | 576   | 98.3%     | 0.8%         | 0.8%          | 88 ms     | Apache-2.0 |
| **rfdetr-nano**     | 384   | **98.1%** | 0.7%         | 1.2%          | **41 ms** | Apache-2.0 |
| yolo11l             | 640   | 96.8%     | 1.2%         | 2.0%          | 126 ms    | AGPL-3.0   |
| yolo26l             | 640   | 96.6%     | 1.9%         | 1.5%          | 130 ms    | AGPL-3.0   |
| yolo26m             | 640   | 96.5%     | 2.0%         | 1.5%          | 103 ms    | AGPL-3.0   |
| yolo11m             | 640   | 96.3%     | 0.7%         | 3.0%          | 100 ms    | AGPL-3.0   |
| yolo11s _(current)_ | 640   | 95.6%     | 2.0%         | 2.4%          | 44 ms     | AGPL-3.0   |
| yolo26s             | 640   | 95.6%     | 2.0%         | 2.4%          | 43 ms     | AGPL-3.0   |
| yolo26n             | 640   | 93.4%     | 4.6%         | 2.0%          | 18 ms     | AGPL-3.0   |
| yolo11n             | 640   | 92.7%     | 3.4%         | 3.9%          | 19 ms     | AGPL-3.0   |

`rfdetr-nano` beats every YOLO at any size while costing what `yolo11s` costs today, and
beats `yolo11l` which is three times slower.

**YOLO26 is not an upgrade for this task.** `yolo26s` ties `yolo11s` exactly; `yolo26m`
loses to `yolo11l` at comparable cost. Its higher COCO mAP lives in small and crowded
objects, which does not transfer to pets filling the frame.

RF-DETR is also intrinsically less bear-confused before any class filtering: 0.8% for
small/medium and 1.5% for nano, against 1.9% for yolo11s and 3.2% for yolo11n.

## Decisions

| Decision           | Choice                                                        |
| ------------------ | ------------------------------------------------------------- |
| Detector           | RF-DETR, replacing YOLO11 entirely                            |
| Sizes offered      | `rfdetr-nano` (default), `rfdetr-small`                       |
| Classes            | `bird`, `cat`, `dog`, `horse`, `sheep`, `cow`                 |
| Default `minScore` | 0.3 (from 0.6)                                                |
| Legacy config      | Any `yolo*` value maps to `rfdetr-nano`; YOLO support removed |

`rfdetr-medium` is excluded: it matches `rfdetr-small` on recall for 15 ms more per image.

## Design

### Machine learning service

**`machine-learning/immich_ml/models/constants.py`**

Replace `_YOLO_MODELS = {"yolo11n", "yolo11s", "yolo11m"}` with
`_RFDETR_MODELS = {"rfdetr-nano", "rfdetr-small"}` and rename `ModelSource.YOLO` to
`ModelSource.RFDETR`. Update the `get_model_source` branch and the `get_model_class` match
arm in `models/__init__.py`.

**`machine-learning/immich_ml/models/pet_detection/detection.py`** — rewritten.

Preprocessing, which is the model's correctness contract:

1. Decode with `decode_pil` and `np.array`, yielding RGB directly. Do **not** use
   `decode_cv2` — the RGB to BGR to RGB round-trip is what caused the original defect.
2. Resize to the session's input size (384 for nano, 512 for small), read from the ONNX
   input shape rather than hardcoded. RF-DETR uses a plain square resize; letterboxing is a
   YOLO convention and does not apply. This was confirmed by matching the library's own
   inference.
3. Scale to `[0, 1]`, then normalise with ImageNet statistics:
   mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]`.
4. Transpose HWC to CHW, add batch dimension.

Postprocessing:

1. Two outputs: `dets` shaped `(1, 300, 4)` as cx/cy/w/h normalised to `[0, 1]`, and
   `labels` shaped `(1, 300, 91)` of pre-sigmoid logits. Identify them by trailing dimension
   rather than by position.
2. Apply sigmoid to the logits.
3. Restrict to the six domestic classes **in the 91-class COCO id space**:
   `bird=16, cat=17, dog=18, horse=19, sheep=20, cow=21`. This is not YOLO's contiguous
   80-class indexing, where the same animals sit at 14–19. Getting this wrong silently
   mislabels every detection.
4. Take the best remaining class per query, threshold at `minScore`.
5. Convert cx/cy/w/h to x1/y1/x2/y2, scale by original image dimensions, clip to bounds.

Delete `_nms` and the entire anchor-head postprocess. RF-DETR's 300 queries are already
deduplicated; there is no NMS step.

### Model hosting

`PetDetector._download` fetches `Deeds67/<model_name>` from Hugging Face. Two new
repositories are required, each containing `detection/model.onnx`:

- `Deeds67/rfdetr-nano` (~108 MB)
- `Deeds67/rfdetr-small` (~114 MB)

Weights are produced by `rfdetr`'s `export()`. **This step requires Hugging Face credentials
and must be performed by the repository owner.** Implementation cannot complete without it.

### Server

- `server/src/config.ts:357-361` — default `modelName` becomes `rfdetr-nano`, `minScore`
  becomes `0.3`.
- `server/src/dtos/model-config.dto.ts` — `PetDetectionConfigSchema` inherits an
  unconstrained `modelName` string from `ModelConfigSchema`. Add a preprocess step mapping
  any value beginning `yolo` to `rfdetr-nano`. Placing it in the schema means both the admin
  API read path and internal `getConfig` see the migrated value, so the settings dropdown
  does not render blank on existing installs.

No change to `pet-detection.service.ts`; it persists whatever label the ML service returns.

### Web

`web/src/routes/admin/system-settings/MachineLearningSettings.svelte:362-364` — replace the
three YOLO options with two RF-DETR options. Update the corresponding i18n strings in
`i18n/en.json` (shared between web and mobile; only `en.json` needs new keys).

### Documentation

`docs/docs/features/pet-detection.md` — model table, the six-class list, the inference
pipeline diagram, and removal of the "yolo11n misclassifies dogs as bears" tip, which
describes behaviour this change eliminates.

### Testing

`machine-learning/test_main.py::TestPetDetection` currently builds mock sessions via a
`_make_yolo_output` helper producing the `(1, 84, 8400)` tensor. All of it is replaced by a
`_make_rfdetr_output` helper producing the two-tensor signature. Tests are written first and
must fail before implementation:

1. **Channel order** — a known-coloured input reaches the session as RGB. This is the direct
   regression test for the defect that cost 5 points of recall.
2. **Normalisation** — ImageNet mean and std are applied after scaling to `[0, 1]`.
3. **Class restriction** — safari classes are never emitted even when scoring 0.99.
4. **Label mapping** — 91-class ids map to the correct species names.
5. **Box conversion** — normalised cx/cy/w/h becomes pixel x1/y1/x2/y2, including clipping at
   image edges.
6. **Threshold** — `minScore` is honoured, and `configure()` updates it.
7. **Empty result** — nothing clearing threshold yields `[]`, not an error.

Also updated: `server/src/services/pet-detection.service.spec.ts`,
`server/src/services/system-config.service.spec.ts`,
`server/src/repositories/machine-learning.repository.spec.ts`, and the e2e `/server/config`
fixture. The e2e fixture is not covered by the server suite and has caused breakage in this
repository before.

### Rollout

Existing libraries hold detections produced by the defective pipeline. Users must run
**Jobs → Pet Detection → Reset**, which already purges pet people and their shared-space
copies correctly (#718, #719). This is documented in the feature page and release notes; it
is not triggered automatically, because re-scanning an entire library without being asked is
not a decision to make on a user's behalf.

## Risks and open questions

**RF-DETR-nano runs at 384x384 against YOLO's 640.** Oxford-IIIT is centred, well-lit,
single-pet portraits, so the benchmark cannot measure pets that are small, distant or partly
hidden — exactly where reduced input resolution hurts. A COCO val2017 evaluation with
size-stratified recall is in progress to close this. If small-object recall regresses,
`rfdetr-small` at 512 becomes the default instead of `rfdetr-nano`.

**Model download grows from 38 MB to ~108 MB** per instance, a one-time cost on first use.

**Both model families train on COCO**, so a COCO-based validation is in-distribution for
both. It is a fair head-to-head but not an out-of-distribution test.

**All measurements come from public datasets, not real user libraries.** Before release,
spot-check against a real instance with family photos, which is the actual target
distribution and is represented by neither dataset.

**Silent failure mode.** Wrong normalisation, channel order or label space produces
plausible-looking but degraded output rather than an error — which is how the original defect
survived. The preprocessing tests above are the guard.
