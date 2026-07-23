# Pet Detection RF-DETR — Slices 4 & 5: Admin UI and documentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin UI offer the two RF-DETR models and make the documentation describe what actually ships.

**Architecture:** Both slices are presentation-only. Slice 4 replaces a hardcoded `options` array in one Svelte component and corrects two i18n strings. Slice 5 rewrites the feature documentation page and one README bullet. Neither introduces branching logic, so neither has a red-first test cycle; the gates are type-checking, linting and prettier.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript (strict), `svelte-i18n`, Docusaurus markdown, Prettier.

## Global Constraints

From the spec (`docs/superpowers/specs/2026-07-23-pet-detection-rfdetr-design.md`):

- Models offered: `rfdetr-nano` (default) and `rfdetr-small`. No third option.
- Detected classes are exactly: bird, cat, dog, horse, sheep, cow.
- Default `minScore` is 0.3.
- `i18n/` is shared between web and mobile — grep both before deleting a key. New keys only need `en.json`.
- Web lint tolerates pre-existing Tailwind **warnings** but not errors.
- CI Docs Build runs prettier over `docs/`, including `docs/superpowers/`.
- Scope: `web/`, `i18n/`, `docs/`, `README.md`. No server or ML changes.

## Why these two slices share one plan

Both are mechanical, single-file-per-concern edits with no logic to test red-first. Splitting
them would produce two plans whose combined content is smaller than the ceremony around them.
They are still committed separately so each can be reverted on its own.

---

## File Structure

| File                                                                  | Status      | Responsibility                           |
| --------------------------------------------------------------------- | ----------- | ---------------------------------------- |
| `web/src/routes/admin/system-settings/MachineLearningSettings.svelte` | **Modify**  | Model dropdown options.                  |
| `i18n/en.json`                                                        | **Modify**  | Two strings that name the wrong model.   |
| `docs/docs/features/pet-detection.md`                                 | **Rewrite** | Model table, class list, pipeline, tips. |
| `README.md`                                                           | **Modify**  | Feature bullet naming YOLO11.            |

## Reference: commands

```bash
cd web && pnpm check:typescript
cd web && pnpm check:svelte
cd web && pnpm lint            # tailwind warnings expected; errors are not
cd docs && pnpm format         # mirrors CI Docs Build prettier
```

---

## Task 1 (Slice 4): Admin dropdown and strings

**Files:**

- Modify: `web/src/routes/admin/system-settings/MachineLearningSettings.svelte:361-365`
- Modify: `i18n/en.json:249`, `i18n/en.json:399`

- [ ] **Step 1: Replace the dropdown options**

In `web/src/routes/admin/system-settings/MachineLearningSettings.svelte`, replace:

```svelte
            options={[
              { value: 'yolo11n', text: 'yolo11n (fast, least accurate)' },
              { value: 'yolo11s', text: 'yolo11s (balanced, recommended)' },
              { value: 'yolo11m', text: 'yolo11m (slow, most accurate)' },
            ]}
```

with:

```svelte
            options={[
              { value: 'rfdetr-nano', text: 'rfdetr-nano (fast, recommended)' },
              { value: 'rfdetr-small', text: 'rfdetr-small (slower, better with small pets)' },
            ]}
```

The wording for `rfdetr-small` is deliberate: on COCO it leads nano by 7.9 points on
small objects specifically, which is the only reason to pick it.

- [ ] **Step 2: Correct the two stale i18n strings**

In `i18n/en.json`, replace line 249:

```json
    "machine_learning_pet_detection_description": "Detect cats, dogs, and other animals in photos (YOLOv8)",
```

with:

```json
    "machine_learning_pet_detection_description": "Detect cats, dogs, and other animals in photos (RF-DETR)",
```

That string said "YOLOv8" while the service ran YOLO11 — it was already wrong before this
change.

Leave `machine_learning_pet_detection_model_description` (line 251) as-is: "Model used for
detecting pets. Nano is faster, Small is more accurate." already matches the new two-option
lineup exactly.

- [ ] **Step 3: Verify no other i18n locale hardcodes a model name**

Run: `grep -rn "yolo\|YOLO" i18n/`
Expected: no output. If a translated locale names YOLO, correct it the same way — the key is
shared with mobile.

- [ ] **Step 4: Type-check and lint**

Run:

```bash
cd web && pnpm check:typescript && pnpm check:svelte
cd web && pnpm lint
```

Expected: no errors. Pre-existing Tailwind warnings are acceptable; new errors are not.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/admin/system-settings/MachineLearningSettings.svelte i18n/en.json
git commit -m "feat(web): offer the RF-DETR pet detection models in admin settings"
```

---

## Task 2 (Slice 5): Documentation

**Files:**

- Rewrite: `docs/docs/features/pet-detection.md`
- Modify: `README.md:75`

- [ ] **Step 1: Rewrite the feature page**

Replace the whole of `docs/docs/features/pet-detection.md` with:

````markdown
# Pet Detection

Gallery can automatically detect pets and other animals in your photos using RF-DETR object
detection. Detected animals appear in the **People** section alongside human faces, making it
easy to browse all photos of a specific pet.

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

## Configuration

### Admin Settings

1. Go to **Administration** > **Machine Learning Settings**.
2. Under **Pet Detection**, choose your preferred model from the dropdown.
3. Adjust the **minimum confidence score** if needed (default: 0.3).

### Re-running Detection

To detect pets in existing photos that were uploaded before pet detection was enabled:

1. Go to **Administration** > **Jobs**.
2. Run the **Pet Detection** job for all assets.

:::note Upgrading from a previous version
If pet detection was enabled before Gallery moved to RF-DETR, your existing detections were
produced by the older, less accurate pipeline. Use **Jobs → Pet Detection → Reset** to clear
them and re-run. Instances that had a YOLO model selected are switched to `rfdetr-nano`
automatically.
:::

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

### Job Flow

Pet detection runs as a dedicated BullMQ queue (`petDetection`) with concurrency of 1:

1. **On upload** — The job service automatically queues a `PetDetection` job alongside face
   detection and smart search.
2. **Manual re-run** — An admin can trigger `PetDetectionQueueAll` from the Jobs page, which
   streams all unprocessed assets and queues individual jobs.
3. **Per-asset job** — Each job calls the ML service with the asset's preview file, creates or
   reuses person entries per species, records `asset_face` bounding boxes, and queues
   thumbnail generation for new pet persons.
````

- [ ] **Step 2: Update the README bullet**

In `README.md`, replace line 75:

```markdown
- **[Pet Detection](https://opennoodle.de/features/pet-detection)** — YOLO11 detects dogs, cats, birds, and other animals and surfaces them alongside people; browse by individual pet, toggle pets per space, and pick from three model sizes. ([Docs](https://docs.opennoodle.de/features/pet-detection))
```

with:

```markdown
- **[Pet Detection](https://opennoodle.de/features/pet-detection)** — RF-DETR detects dogs, cats, birds, horses, sheep, and cows and surfaces them alongside people; browse by species, toggle pets per space, and pick between two model sizes. ([Docs](https://docs.opennoodle.de/features/pet-detection))
```

Two corrections beyond the model name: it is **two** sizes now, and "browse by individual pet"
was never accurate — the server creates one person per species per owner
(`server/src/services/pet-detection.service.ts:74-91`), so "browse by species" is what the
feature actually does.

- [ ] **Step 3: Format the docs**

Run: `cd docs && pnpm format`
Expected: reformats if needed; CI Docs Build prettier must then pass.

- [ ] **Step 4: Verify no stale references remain**

Run: `grep -rn "yolo\|YOLO" docs/docs/ README.md`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add docs/docs/features/pet-detection.md README.md
git commit -m "docs(pet-detection): describe RF-DETR and the domestic class set"
```

---

## Self-Review

**Spec coverage.** Slice 4's two files and Slice 5's two files are all present. The spec's
note that the marketing site needs the same correction is out of scope for this repository and
is flagged in the spec's Slice 5 section for release time.

**Placeholders.** None.

**Accuracy check.** The "browse by individual pet" correction is a factual fix discovered while
reading `pet-detection.service.ts` — the README has been claiming a capability the code does
not have. Worth correcting here rather than leaving a known-false claim in place, but note it
is a documentation fix, not a behaviour change: individual pet identity remains unimplemented.
