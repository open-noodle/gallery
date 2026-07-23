# Pet Detection — RF-DETR migration and domestic class set

**Date:** 2026-07-23
**Status:** Design approved, sliced for implementation
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

### Validation on COCO val2017

Oxford-IIIT is centred single-pet portraits and cannot measure small or partly hidden pets.
COCO val2017 can: 719 images containing 1,845 ground-truth `bird/cat/dog/horse/sheep/cow`
objects in real cluttered scenes, matched at IoU ≥ 0.5 and stratified by COCO's size buckets.

| Model               | All       | Small (n=640) | Medium (n=564) | Large (n=641) | FP/img | CPU    |
| ------------------- | --------- | ------------- | -------------- | ------------- | ------ | ------ |
| rfdetr-small        | **78.9%** | **56.2%**     | 87.2%          | 94.2%         | 0.69   | 77 ms  |
| **rfdetr-nano**     | 74.5%     | 48.3%         | 83.9%          | 92.4%         | 0.65   | 44 ms  |
| yolo11m             | 72.2%     | 46.6%         | 81.2%          | 89.9%         | 0.33   | 101 ms |
| yolo11s _(current)_ | 68.8%     | 42.5%         | 75.9%          | 88.8%         | 0.34   | 45 ms  |

Three things this settles:

1. **RF-DETR's advantage grows on hard images.** `rfdetr-nano` beats `yolo11s` by 5.7 points
   overall here against 2.5 on Oxford, and beats `yolo11m`, which is 2.3x slower.
2. **The 384px concern did not materialise.** `rfdetr-nano` scores 48.3% on small objects
   against `yolo11s`'s 42.5% at 640px — better on precisely the case where lower input
   resolution should have hurt. The DINOv2 backbone more than compensates. This was the main
   open risk in the design and it is resolved.
3. **Oxford masked a real gap between nano and small.** They tie at ~98% on portraits, but on
   small objects `rfdetr-small` leads `rfdetr-nano` by 7.9 points. That is the justification
   for keeping `rfdetr-small` in the lineup.

**False positives.** RF-DETR shows ~0.65–0.69 unmatched predictions per image against YOLO's
~0.34. This figure is soft and should not be read as a measured regression: predictions
overlapping `iscrowd` regions count as false positives because crowd annotations are excluded
from ground truth, and near-duplicate boxes on the same animal also count. Both systematically
penalise the model that detects more. It is a signal to watch in real use; `minScore` is the
lever if it proves noisy.

Both model families train on COCO train2017, so this is in-distribution for both. It is a
fair head-to-head on a much harder image set than Oxford, but not an out-of-distribution test.

## Decisions

| Decision           | Choice                                                        |
| ------------------ | ------------------------------------------------------------- |
| Detector           | RF-DETR, replacing YOLO11 entirely                            |
| Sizes offered      | `rfdetr-nano` (default), `rfdetr-small`                       |
| Classes            | `bird`, `cat`, `dog`, `horse`, `sheep`, `cow`                 |
| Default `minScore` | 0.3 (from 0.6)                                                |
| Legacy config      | Any `yolo*` value maps to `rfdetr-nano`; YOLO support removed |

`rfdetr-medium` is excluded: it matches `rfdetr-small` on recall for 15 ms more per image.

**Why `rfdetr-nano` remains the default despite `rfdetr-small` scoring higher on COCO.**
`rfdetr-nano` beats the currently shipped `yolo11s` on every size bucket at identical CPU
cost, so it carries no performance regression for any existing install. Defaulting to
`rfdetr-small` would nearly double per-photo CPU (44 ms to 77 ms) for every self-hoster to
buy accuracy most libraries will not notice. Users with many small or distant pets can opt
into `rfdetr-small`, which is what the option is for.

## Design

### Inference contract

These four properties are the model's correctness contract. Violating any of them degrades
output silently rather than raising — which is exactly how the original defect survived.

| Property      | Required value                                                     |
| ------------- | ------------------------------------------------------------------ |
| Colour order  | RGB                                                                |
| Resize        | Plain square resize to the session's input size. **No letterbox.** |
| Normalisation | Scale to `[0,1]`, then ImageNet mean/std                           |
| Label space   | 91-class COCO ids, **not** YOLO's contiguous 80-class space        |

ImageNet constants: mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]`.

Domestic class ids in the 91-class space:
`bird=16, cat=17, dog=18, horse=19, sheep=20, cow=21`. The same animals occupy 14–19 in
YOLO's 80-class space; confusing the two silently mislabels every detection.

Model input sizes differ by variant — `rfdetr-nano` is 384, `rfdetr-small` is 512 — so the
input size **must be read from the ONNX session**, never hardcoded.

### Machine learning service

`machine-learning/immich_ml/schemas.py:50` — rename `ModelSource.YOLO` to
`ModelSource.RFDETR`.

`machine-learning/immich_ml/models/constants.py:91` — replace
`_YOLO_MODELS = {"yolo11n", "yolo11s", "yolo11m"}` with
`_RFDETR_MODELS = {"rfdetr-nano", "rfdetr-small"}`, and update the `get_model_source` branch.

`machine-learning/immich_ml/models/__init__.py:39-42` — update the `get_model_class` match
arm to `ModelSource.RFDETR`.

`machine-learning/immich_ml/models/pet_detection/detection.py` — rewritten:

- **Decode** with `decode_pil` then `np.array`, which yields RGB directly. Do **not** use
  `decode_cv2`; the RGB→BGR→RGB round-trip is what caused the original defect.
- **Preprocess** per the contract above, with input size read from
  `session.get_inputs()[0].shape`.
- **Postprocess**: identify the two outputs by trailing dimension (4 = `dets`, 91 = `labels`)
  rather than by position; sigmoid the logits; select the best of the six domestic classes per
  query; threshold at `minScore`; convert normalised cx/cy/w/h to pixel x1/y1/x2/y2; clip to
  image bounds.
- **Delete** `_nms` and the entire anchor-head postprocess. RF-DETR's 300 queries are already
  deduplicated.

### Model hosting

`PetDetector._download` fetches `Deeds67/<clean_name(model_name)>`. `clean_name`
(`machine-learning/immich_ml/config.py:92-96`) translates only `:\/` and strips `.`, so
dashes survive and the repository names are `Deeds67/rfdetr-nano` and `Deeds67/rfdetr-small`,
each containing `detection/model.onnx`.

### Server

- `server/src/config.ts:357-361` — default `modelName` becomes `rfdetr-nano`, `minScore`
  becomes `0.3`.
- `server/src/dtos/model-config.dto.ts` — `PetDetectionConfigSchema` inherits an
  unconstrained `modelName` string from `ModelConfigSchema`. Add a preprocess step mapping any
  value beginning `yolo` to `rfdetr-nano`. Placing it in the schema means both the admin API
  read path and internal `getConfig` see the migrated value, so the settings dropdown does not
  render blank on existing installs.

`pet-detection.service.ts` is unchanged; it persists whatever label the ML service returns.

### Web

`web/src/routes/admin/system-settings/MachineLearningSettings.svelte:362-364` — replace the
three YOLO options with `rfdetr-nano` and `rfdetr-small`.

`i18n/en.json:249` currently reads "Detect cats, dogs, and other animals in photos (YOLOv8)"
— stale even today, since the service runs YOLO11. Update to name RF-DETR. `i18n/en.json:251`
already reads "Nano is faster, Small is more accurate", which matches the new two-option
lineup. Only `en.json` needs new keys; the directory is shared with mobile.

### Documentation

- `docs/docs/features/pet-detection.md` — model table, six-class list, pipeline diagram, and
  removal of the "yolo11n misclassifies dogs as bears" tip, which describes behaviour this
  change eliminates.
- `README.md:75` — names YOLO11 and "three model sizes"; both are now wrong.

## Test matrix

Written **red first** in every slice. Grouped by concern; each row is one test.

### Preprocessing (Slice 2)

| #   | Case                    | Assertion                                                                  |
| --- | ----------------------- | -------------------------------------------------------------------------- |
| 1   | Channel order           | A pure-red image arrives with channel 0 dominant — RGB, not BGR            |
| 2   | Input size from session | A 384 session yields `(1,3,384,384)`; a 512 session yields `(1,3,512,512)` |
| 3   | Scale then normalise    | A known pixel maps to `(v/255 - mean) / std`                               |
| 4   | Layout                  | Output is NCHW float32                                                     |
| 5   | No letterbox            | A non-square image produces no `114` padding band                          |
| 6   | Non-RGB input           | Greyscale and palette images are converted, not rejected                   |

### Postprocessing (Slice 2)

| #   | Case                    | Assertion                                                            |
| --- | ----------------------- | -------------------------------------------------------------------- |
| 7   | Sigmoid applied         | A raw logit of 0 becomes probability 0.5                             |
| 8   | Label mapping           | Ids 16–21 map to bird/cat/dog/horse/sheep/cow                        |
| 9   | Safari classes excluded | Ids 22–25 at score 0.99 emit nothing                                 |
| 10  | Non-animals excluded    | `person=1`, `car=3` at 0.99 emit nothing                             |
| 11  | Score is subspace max   | Score reported is the max over the six domestic classes only         |
| 12  | Box conversion          | Normalised cx/cy/w/h becomes pixel x1/y1/x2/y2 against original dims |
| 13  | Box clipping            | A box extending past the edge is clipped to image bounds             |
| 14  | Threshold honoured      | Score just below `minScore` dropped; just above kept                 |
| 15  | Output order robustness | Swapping the two output tensors still resolves correctly             |
| 16  | Multiple detections     | All queries above threshold are returned                             |
| 17  | Empty result            | Nothing above threshold returns `[]`, not an error                   |

### Edge cases (Slice 2)

| #   | Case                  | Assertion                                                  |
| --- | --------------------- | ---------------------------------------------------------- |
| 18  | Degenerate box        | Zero width or height does not raise                        |
| 19  | Box fully outside     | Clipped to zero area and dropped rather than emitted       |
| 20  | Extreme aspect ratio  | 4000x100 input produces correctly scaled boxes             |
| 21  | Tiny image            | 10x10 input does not raise                                 |
| 22  | All 300 queries fire  | Max-detection case returns all of them without error       |
| 23  | `configure()`         | Updates `min_score` at runtime                             |
| 24  | `model_path` fallback | Resolves `detection/model.onnx`, then the flat legacy path |
| 25  | `_download` target    | Calls `snapshot_download` with `Deeds67/rfdetr-nano`       |

### Server (Slice 3)

| #   | Case                | Assertion                                                       |
| --- | ------------------- | --------------------------------------------------------------- |
| 26  | Defaults            | `modelName='rfdetr-nano'`, `minScore=0.3`                       |
| 27  | Legacy migration    | `yolo11n`, `yolo11s`, `yolo11m` all read back as `rfdetr-nano`  |
| 28  | Unknown legacy      | Any other `yolo*` value maps to `rfdetr-nano`                   |
| 29  | Passthrough         | `rfdetr-nano` and `rfdetr-small` are left untouched             |
| 30  | Persisted overrides | A stored `yolo11s` config surfaces as `rfdetr-nano` via the API |

### Integration (Slice 1, needs published weights)

| #   | Case               | Assertion                                                        |
| --- | ------------------ | ---------------------------------------------------------------- |
| 31  | Real-weights smoke | Downloaded `rfdetr-nano` loads and detects a dog in a real photo |

## Implementation slices

Sized for `impl-loop`. Each slice is independently verifiable and leaves the tree green.

### Slice 1 — Publish RF-DETR weights to HuggingFace

**Goal:** `Deeds67/rfdetr-nano` and `Deeds67/rfdetr-small` exist publicly, each containing
`detection/model.onnx` and a model card documenting the inference contract.

**Blocked on:** a HuggingFace token with write scope. The currently configured token has role
`read` and cannot create repositories.

**Acceptance:** `PetDetector("rfdetr-nano")._download()` into a temp cache produces a file
that loads in onnxruntime with input shape `[1,3,384,384]` and outputs `dets`/`labels`.

**Tests:** #31.

### Slice 2 — ML service RF-DETR detector

**Goal:** `PetDetector` runs RF-DETR correctly; YOLO support removed.

**Files:** `schemas.py`, `models/constants.py`, `models/__init__.py`,
`models/pet_detection/detection.py`, `test_main.py`.

**Order:** rewrite `TestPetDetection` against a new `_make_rfdetr_output` helper (red), then
implement (green). The existing `_make_yolo_output` helper and its seven tests are deleted.

**Acceptance:** `uv run pytest test_main.py` green; tests #1–#25 present and passing.

**Depends on:** nothing. Uses mocked sessions, so it does not wait on Slice 1.

### Slice 3 — Server config defaults and legacy migration

**Goal:** New defaults ship, and existing installs holding `yolo*` migrate transparently.

**Files:** `server/src/config.ts`, `server/src/dtos/model-config.dto.ts`,
`server/src/services/pet-detection.service.spec.ts`,
`server/src/services/system-config.service.spec.ts`,
`server/src/repositories/machine-learning.repository.spec.ts`,
`e2e/src/specs/server/api/pet-detection.e2e-spec.ts`.

The e2e spec asserts default config and ships in this slice; splitting it would break e2e.

**Acceptance:** `pnpm test` green in `server/`; tests #26–#30 passing.

### Slice 4 — Web admin UI

**Goal:** The model dropdown offers the two RF-DETR options; strings no longer name YOLO.

**Files:** `web/src/routes/admin/system-settings/MachineLearningSettings.svelte`,
`i18n/en.json`.

**Acceptance:** `pnpm check:typescript` and `pnpm check:svelte` green in `web/`.

### Slice 5 — Documentation

**Goal:** Docs and README describe what actually ships.

**Files:** `docs/docs/features/pet-detection.md`, `README.md`.

**Acceptance:** `cd docs && pnpm format` leaves no diff; CI Docs Build prettier passes.

**Note:** the marketing site (separate `platform` repo) also describes this feature and will
need the same correction. Out of scope here; flag it at release.

## Rollout

Existing libraries hold detections produced by the defective pipeline. Users must run
**Jobs → Pet Detection → Reset**, which already purges pet people and their shared-space
copies correctly (#718, #719). This is documented in the feature page and release notes; it
is not triggered automatically, because re-scanning an entire library without being asked is
not a decision to make on a user's behalf.

## Risks and open questions

**~~RF-DETR-nano runs at 384x384 against YOLO's 640.~~ Resolved.** COCO val2017 shows
`rfdetr-nano` ahead of `yolo11s` on small objects (48.3% vs 42.5%) despite the lower input
resolution. See the COCO validation above.

**False-positive rate is the remaining unknown.** RF-DETR emits roughly twice as many
unmatched predictions as YOLO on COCO. The measurement is confounded (see above), but if
spurious pet entries appear in real libraries, raising `minScore` above 0.3 is the first
response.

**Model download grows from 38 MB to ~108 MB** per instance, a one-time cost on first use.

**All measurements come from public datasets, not real user libraries.** Before release,
spot-check against a real instance with family photos, which is the actual target
distribution and is represented by neither dataset.

**Silent failure mode.** Wrong normalisation, channel order or label space produces
plausible-looking but degraded output rather than an error. The preprocessing tests are the
guard, which is why they are written first.
