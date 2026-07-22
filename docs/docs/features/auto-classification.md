# Auto-Classification

Gallery can automatically tag and optionally archive photos based on their visual content. You define categories with text descriptions, and Gallery uses its CLIP AI model to match photos that look like what you described.

## Use Cases

- **Screenshots** — Auto-tag phone screenshots so they don't clutter your timeline
- **Receipts** — Collect receipt photos under one tag for easy retrieval
- **Documents** — Separate scanned documents from personal photos
- **Nature/Pets** — Auto-tag outdoor scenes or pet photos
- **Sensitive content** — Auto-archive content you don't want visible on the timeline

## Choosing a CLIP model

**Model choice is the single biggest factor in classification quality.** Before spending time tuning prompts, make sure you are on a model that can actually resolve the concepts you are describing.

Classification does not have its own model setting — it reuses the **Smart Search** CLIP model configured at `Administration > Settings > Machine Learning Settings > Smart Search`. Changing it affects search and classification together.

The default, `ViT-B-32__openai`, is among the smallest and fastest options, but it also sits **near the bottom of the quality range** (69.9% recall on the English benchmark — roughly 16 points behind the best model available). It is fine for casual search, but it frequently cannot separate "a scanned document" from "a photo of a book", which is why classification with default settings often tags very little or nothing at all.

### Recommended models

| Hardware                                  | Model                              | Memory (MiB) | Time (ms) | Recall (%) |
| ----------------------------------------- | ---------------------------------- | ------------ | --------- | ---------- |
| **Beefy (GPU, or lots of RAM and time)**  | `ViT-SO400M-16-SigLIP2-384__webli` | 3854         | 56.57     | **85.99**  |
| Nearly as good, roughly half the compute  | `ViT-SO400M-16-SigLIP2-256__webli` | 3611         | 27.84     | 85.62      |
| Balanced — near-top quality, 10× faster   | `ViT-B-16-SigLIP2__webli`          | 3038         | 5.81      | 84.86      |
| Low memory (~1 GiB)                       | `ViT-B-16-SigLIP-384__webli`       | 1128         | 13.53     | 83.19      |
| _Gallery default — weak for this feature_ | `ViT-B-32__openai`                 | 1004         | 2.26      | 69.9       |

:::tip Best results
If your machine can afford it, use **`ViT-SO400M-16-SigLIP2-384__webli`**. It is the highest-scoring model in Gallery's English benchmark and is Pareto-optimal — no other model beats it on quality without costing more memory or time. The memory figure in the table above is peak RSS for the model alone; one user running it on a real library [reported around 4.6 GB](https://github.com/open-noodle/gallery/discussions/795) once image decoding and concurrency are included, so budget above the table value. A GPU is strongly recommended for large libraries — a CPU-only pass is roughly 10× slower than `ViT-B-16-SigLIP2__webli`.
:::

Note that the SigLIP2 models above all sit in the same ~3–4 GiB memory band — the real tradeoff between them is **inference time**, not memory. If RAM is your constraint rather than CPU, drop to a `ViT-B-16-SigLIP*` model instead of a smaller SO400M variant.

The numbers above are for **English** search. If your prompts are in another language, check the per-language tables and the multilingual model guidance in [Searching > CLIP models](/features/searching#clip-models), which also documents how these figures were measured.

### Switching models

Because classification compares an asset's stored Smart Search embedding against your prompt embeddings, both must come from the **same** model. After changing the model you must re-encode your library, or every comparison is meaningless:

1. Change the model in [Smart Search settings][smart-search-settings] and save
2. Go to the [Job Status page][job-status-page] and click **All** next to **Smart Search**
3. Wait for Smart Search to finish — assets without an embedding are skipped by classification entirely
4. Go to **Administration** > **Settings** > **Classification** and click **Scan All Libraries**
5. Re-tune your similarity thresholds (see below)

:::warning Similarity thresholds are model-specific
Cosine similarity values are **not comparable across models**. The 0.28 default was chosen for the default model; a SigLIP2 model will produce a different range entirely. After switching models, expect to re-tune every category — if a model change results in nothing being tagged, a too-high threshold is the most likely cause, not a broken setup.
:::

## Configuration

Classification categories are managed through Gallery's system configuration. There are three ways to configure them:

### Option 1: Admin UI

1. Go to **Administration** > **Settings** > **Classification**
2. Click **Add Category**
3. Fill in:
   - **Name** — A descriptive label (e.g., "Screenshots"). Matching assets get tagged as `Auto/Screenshots`.
   - **Prompts** — One per line. Describe what the photos look like in natural language. Use 2-5 prompts for best results.
   - **Similarity** — How closely a photo must match your prompts (see below).
   - **Action** — "Tag only" or "Tag and archive".
4. Click **Save**

Categories can be enabled/disabled individually without deleting them. The global **Enabled** toggle disables all classification processing.

### Option 2: Config File (YAML)

If you use `IMMICH_CONFIG_FILE`, add categories directly to your YAML configuration:

```yaml
classification:
  enabled: true
  categories:
    - name: Screenshots
      prompts:
        - 'a screenshot of a phone screen'
        - 'a screenshot of a website'
        - 'a screenshot of a chat conversation'
      similarity: 0.28
      action: tag
      faceExclusion: off
      enabled: true
    - name: Receipts
      prompts:
        - 'a photo of a paper receipt'
        - 'a receipt from a store'
        - 'a restaurant bill'
      similarity: 0.28
      action: tag_and_archive
      faceExclusion: off
      enabled: true
```

### Option 3: API

Classification categories are part of the system config endpoint:

```bash
# Read current config
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:2283/api/system-config | jq '.classification'

# Update config (sends full config object)
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:2283/api/system-config -d @config.json
```

### Category Fields

| Field           | Type     | Required | Description                                                                                               |
| --------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `name`          | string   | Yes      | Category name. Must be unique. Used as the tag name (`Auto/{name}`).                                      |
| `prompts`       | string[] | Yes      | At least one text prompt describing photos to match.                                                      |
| `similarity`    | number   | Yes      | Threshold 0-1. Higher = stricter matching. Default: 0.28.                                                 |
| `action`        | string   | Yes      | `tag` (tag only) or `tag_and_archive` (tag and move to archive).                                          |
| `faceExclusion` | string   | No       | Face exclusion mode: `off`, `any_assigned_face`, `named_people`, or `named_visible_people`. Default: off. |
| `enabled`       | boolean  | Yes      | Whether this category is active. Disabled categories are skipped.                                         |

### Writing Good Prompts

Prompts describe the visual content of photos you want to match. Write them as if describing what you see in the image:

| Category    | Example Prompts                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Screenshots | `a screenshot of a phone screen`, `a screenshot of a website`, `a screenshot of a chat conversation` |
| Receipts    | `a photo of a paper receipt`, `a receipt from a store`, `a restaurant bill`                          |
| Documents   | `a scanned document`, `a photo of a printed page`, `a page of text`                                  |
| Nature      | `a landscape photo of mountains`, `a photo of a forest`, `a sunset over water`                       |
| Pets        | `a photo of a dog`, `a photo of a cat playing`, `a close-up of a pet`                                |

More prompts covering different angles and variations of the same concept improve recall without hurting precision.

Negative-sounding prompts ("no people, no faces, no landscapes") are a commonly used trick, but be aware of what they actually do: CLIP has no notion of negation, so such a prompt is simply another vector that an asset can match against. In practice they work as _contrastive_ prompts — they tend to pull the category's best-match score toward text-heavy, non-photographic images — but they do not exclude anything. For genuine exclusion, use [Face exclusion](#face-exclusion) instead.

### A real-world example

The configuration below comes from a Gallery user running auto-classification over a large personal library ([discussion #795](https://github.com/open-noodle/gallery/discussions/795)). It is a useful starting point because it shows realistic prompt density and per-category similarity values rather than one-line examples.

Treat the thresholds as a starting point, not a target — they were tuned for that user's model and library. See [Choosing a CLIP model](#choosing-a-clip-model) and the [similarity threshold](#similarity-threshold) notes above.

<details>
<summary>Full example configuration (YAML)</summary>

```yaml
classification:
  enabled: true
  categories:
    - action: tag_and_archive
      enabled: true
      name: Documents
      prompts:
        - A photo of a document, paper sheet with printed text, scanned page, flat layout, high text density
        - An image primarily showing a document, such as a report, form, or printed page, minimal background, text-focused
        - Scanned or photographed document inside an image, including receipts, letters, or pages with structured text
        - 'no people, no faces, no landscapes, no animals, no buildings, no natural scenery'
        - 'not a photo of objects, food, products, or everyday scenes, avoid cluttered backgrounds and non-text-focused images'
        - 'no artwork, paintings, illustrations, memes, or graphics with minimal text'
        - 'exclude screenshots of videos, games, or UI with dominant visual elements instead of text'
        - 'no handwriting-only images without structured layout, no blank pages, no low-text or decorative content'
      similarity: 0.28
    - action: tag_and_archive
      enabled: true
      name: Screenshots
      prompts:
        - 'a screenshot of a phone, computer, or application interface'
        - 'UI elements, menus, buttons, chat interface, or software screen'
        - 'screen capture with sharp digital text and interface layout'
        - 'no facetime calls'
        - 'no long videos with absolutely no text'
        - 'no real-world camera photos'
        - 'no memes with large caption text unless clearly UI-based'
        - 'no natural scenes or physical objects'
      similarity: 0.29
    - action: tag_and_archive
      enabled: true
      name: Receipts and barcodes
      prompts:
        - A photo of a receipt, often showing itemized purchases, prices, and store information.
        - A photo of a barcode or QR code, typically found on products, tickets, or packaging.
      similarity: 0.28
    - action: tag_and_archive
      enabled: true
      name: Memes
      prompts:
        - 'a meme image with overlaid text, captions, or jokes'
        - 'viral image, reaction meme, edited photo with text'
        - 'image with large text at top or bottom in meme format'
        - 'screenshot of a social media post, tweet, or online content'
        - 'frame from a video with subtitles or captions'
        - 'video screenshot with text overlay, subtitles, or closed captions'
        - 'vertical video frame typical of tiktok, reels, or shorts'
        - 'image with video player UI elements such as progress bar, play button, or timestamps'
        - 'image with watermarks, logos, or platform branding'
        - 'not a clean photograph, not a document, not a plain image'
        - 'no natural unedited photos, no camera-only images without overlays'
      similarity: 0.24
    - action: tag_and_archive
      enabled: true
      name: NSFW
      prompts:
        - A photo containing nudity, sexual content, or adult themes that may be inappropriate for all audiences.
        - An explicit image depicting sexual acts, nudity, or adult content that is not suitable for minors.
      similarity: 0.28
```

</details>

This example predates the **Face exclusion** setting, so every category runs with `faceExclusion: off`. Categories like `Documents`, `Screenshots` and `Receipts and barcodes` are good candidates for `faceExclusion: named_people`, which stops them from swallowing genuine photos of people who happen to be holding a menu or standing in front of a sign.

### Similarity Threshold

The similarity slider controls how closely a photo must match your prompts:

| Range       | Label  | Behavior                                              |
| ----------- | ------ | ----------------------------------------------------- |
| 0.15 - 0.22 | Loose  | Catches more matches but may include unrelated photos |
| 0.22 - 0.35 | Normal | Recommended. Good balance of coverage and accuracy    |
| 0.35 - 0.45 | Strict | Only very strong matches. May miss borderline photos  |

The default is **0.28** (Normal). Start there and adjust based on results.

### Actions

- **Tag only** (`tag`) — Matching photos get an `Auto/{category name}` tag. They stay on your timeline.
- **Tag and archive** (`tag_and_archive`) — Matching photos get tagged AND moved to the Archive. Useful for screenshots or receipts you want organized but not on your timeline.

### Face exclusion

Each category can optionally skip assets that contain known human faces. This is useful when a category should classify non-personal images, such as receipts, nature photos, or screenshots, without tagging genuine photos of people.

The **Face exclusion** setting has four modes:

| Mode                  | Behavior                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Off                   | Classifies assets as usual.                                                                        |
| Any assigned face     | Skips the category when the asset has a visible face assigned to a person cluster.                 |
| Named people          | Skips the category when the asset has a visible face assigned to a named person.                   |
| Named, visible people | Skips the category when the asset has a visible face assigned to a named person who is not hidden. |

Unassigned detected faces do not count as known faces, and pets do not count as human faces for this filter.

Face-aware categories require facial recognition. If facial recognition is disabled, Gallery skips those categories instead of treating the asset as safe to classify. Categories set to **Off** continue to run normally.

Face exclusion is future-only. Changing the setting does not remove existing `Auto/...` tags, and later face recognition, person naming, hiding, or merging does not clean up old tags automatically. Run **Scan All Libraries** after changing rules if you want assets to be evaluated again under the new settings; a forced scan can add new matches, but it still does not remove old `Auto/...` tags that are now excluded.

## Scanning Your Library

New uploads are classified automatically. To classify your existing library:

1. Go to **Administration** > **Settings** > **Classification**
2. Click **Scan All Libraries**

Or via API:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:2283/api/classification/scan
```

This queues all assets across all users for classification. It's additive — existing tags are kept, and new matches get tagged.

## Troubleshooting

### Nothing is being tagged

This is the most common complaint, and it is almost always tuning rather than a broken install. Work through these in order:

1. **Check your similarity threshold first.** This is the usual culprit. Lower the value (e.g. 0.28 → 0.22) and rescan. Lower matches more; higher matches less. If a category matches nothing at all, its threshold is too high for your model.
2. **Check your model.** The default `ViT-B-32__openai` is weak at this task. See [Choosing a CLIP model](#choosing-a-clip-model).
3. **Confirm Smart Search has finished.** Classification only runs on assets that already have a Smart Search embedding — assets still queued for Smart Search are skipped silently. Check the [Job Status page][job-status-page].
4. **If you recently changed the CLIP model**, re-run Smart Search on **All** before rescanning classification, then re-tune thresholds. See [Switching models](#switching-models).
5. **Confirm the category and the global toggle are both enabled**, and that `classification.enabled` is `true`.
6. **Check Face exclusion.** A category set to `named_people` skips any asset containing a named person, which can be far more of your library than you expect.

There is no universally correct threshold. Prompts and thresholds that work well on one library can tag nothing on another, because resolution, image quality and subject matter all shift the similarity distribution. Expect to iterate: change one category's threshold, rescan, inspect the `Auto/{name}` tag, repeat.

### Too many false positives

Raise the similarity threshold in small steps (0.02–0.03), and prefer adding more specific prompts over broad ones. For categories that should never match photos of people, set **Face exclusion** to `named_people` or `named_visible_people`.

Note that raising a threshold **removes** existing auto-tags for that category and unarchives the affected assets — see the warning under [Behavior on Config Changes](#behavior-on-config-changes).

## Job Concurrency

Classification runs as a dedicated job queue. By default, it processes one asset at a time (concurrency 1). You can increase this for faster processing:

1. Go to **Administration** > **Jobs**
2. Find the **Classification** queue
3. Adjust the concurrency slider

Higher concurrency is safe — prompt embeddings are cached in memory and deduplicated across concurrent jobs. On machines with fast ML inference (GPU), increasing concurrency to 3-5 can significantly speed up library scans.

You can also configure concurrency via the system config:

```yaml
job:
  classification:
    concurrency: 3
```

## Behavior on Config Changes

When you modify classification categories, Gallery handles changes automatically:

| Change                              | Behavior                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add a category**                  | New category takes effect on next classification run. Run "Scan All Libraries" to classify existing assets.                                                                                                                           |
| **Remove a category**               | Existing `Auto/{name}` tags are cleaned up and affected archived assets are unarchived.                                                                                                                                               |
| **Rename a category**               | Old tags are cleaned up (treated as removal + addition). Run scan to re-tag with the new name.                                                                                                                                        |
| **Increase similarity (stricter)**  | Existing auto-tags are removed, archived assets are unarchived. The UI prompts to rescan so only assets matching the new threshold get re-tagged. For config-file admins, this cleanup runs automatically on the next server restart. |
| **Decrease similarity (looser)**    | Takes effect on next classification run. Run scan to find newly-matching assets.                                                                                                                                                      |
| **Change prompts**                  | Prompt embedding cache is cleared. New prompts are encoded on next classification run.                                                                                                                                                |
| **Change action**                   | Takes effect on next classification run. Changing to `tag_and_archive` does not retroactively archive already-tagged assets — run scan to apply.                                                                                      |
| **Disable/enable a category**       | Immediate. Disabled categories are skipped during classification.                                                                                                                                                                     |
| **Disable classification globally** | All classification jobs are skipped. No assets are processed until re-enabled.                                                                                                                                                        |
| **CLIP model change**               | Embedding cache is automatically cleared. All prompts are re-encoded with the new model on next use.                                                                                                                                  |

:::warning Unarchive side effect
Cleaning up an `Auto/{name}` tag (whether by removing the category, renaming it, or tightening its similarity) unarchives **every** asset that currently holds that tag — including photos you manually archived for unrelated reasons. Gallery cannot tell the difference between an auto-archived asset and one you archived yourself.

For config-file admins, this cleanup runs automatically on the next server restart whenever the YAML changes. Watch your server startup logs (`Classification category "X" similarity increased ... clearing auto-tag assignments`) so you know when it happens.
:::

## How It Works

Classification runs automatically after Smart Search processes a photo. The CLIP AI model compares the photo's visual embedding against your category prompts. If the best-matching prompt exceeds the similarity threshold, the photo is classified into that category.

Multiple categories can match the same photo. If any matching category has the "Tag and archive" action, the photo is archived.

## Technical Implementation

### Architecture

Classification categories are stored in Gallery's system configuration (the same `system_metadata` table or YAML config file used for all admin settings). Categories can be managed through the Admin UI, API, or config file. However, if you use a config file (`IMMICH_CONFIG_FILE`), the UI and API are read-only — all changes must be made in the YAML file. This applies to all admin settings, not just classification.

Prompt embeddings (CLIP text vectors) are **not stored in the database**. They are computed lazily by the ML service and cached in memory on the microservices worker. The cache is keyed by `{modelName}::{prompt}` and is cleared automatically when the classification config or CLIP model changes.

### Embedding Cache

```
handleClassify(assetId)
       │
       ├─ getConfig() → classification.categories
       ├─ For each enabled category:
       │   └─ For each prompt:
       │       └─ getOrEncodePrompt(prompt, modelName)
       │           ├─ Check embeddingCache → hit? return cached
       │           ├─ Check pendingEncodes → in-flight? await same promise
       │           └─ Miss? call ML encodeText(), cache result
       │
       └─ Compare cosine similarity, tag/archive as needed
```

The cache ensures each unique prompt is encoded exactly once, regardless of how many assets are processed. Concurrent jobs that need the same prompt share a single in-flight encode via promise deduplication.

### Job Flow

```
Upload / Re-encode
       │
       ▼
  Smart Search (CLIP encode image)
       │
       ▼
  Asset Classify (dedicated queue, configurable concurrency)
       │
       ├─ Load asset embedding from smart_search table
       ├─ Load config: classification.categories (enabled only)
       ├─ For each category: encode prompts (cached), compute max cosine similarity
       ├─ If max similarity ≥ threshold → match
       │   ├─ Create/reuse Auto/{name} tag
       │   ├─ Apply tag to asset
       │   └─ If action = tag_and_archive → archive
       └─ Mark asset as classified (classifiedAt timestamp)
```

### Config Change Handling

Two paths handle config changes, depending on how classification is managed:

**UI / API updates (`onConfigUpdate`)** — fired immediately when an admin saves via the UI or API:

1. If neither classification config nor CLIP model name changed → no action
2. Clear embedding cache (prompts or model may have changed)
3. Diff old vs new categories: for each removed category or category whose similarity increased, call `removeAutoTagAssignments` to clean up `Auto/{name}` tags and unarchive affected assets
4. Persist the new classification config as a snapshot in `system_metadata`

**Config file (`onConfigInit`)** — fired on every server boot, including after a YAML edit + restart:

1. Read the previous classification snapshot from `system_metadata`
2. If a snapshot exists, run the same diff logic against the freshly-loaded config (the file is the source of truth)
3. Persist the current classification config as the new snapshot

The snapshot is the bridge between the two paths. Both paths write it after running cleanup, so the boot-time check never re-runs cleanup that was already handled by the UI path. On the very first boot after upgrading, the snapshot is missing — Gallery just stores a baseline and skips cleanup, so existing tags are preserved.

### Key Details

- **Cosine similarity** computed in-process (dot product / magnitude product), not via database query
- **Batch processing** — `scanLibrary` streams unclassified assets and queues individual jobs in batches of 1,000
- **Idempotent tagging** — Re-classification never duplicates tags (uses upsert)
- **Global kill switch** — `classification.enabled: false` short-circuits both the queue-all job and individual classify jobs without processing any assets
- **Duplicate name validation** — Category names must be unique (enforced by DTO validation)
- **Error resilience** — If the ML service is down, individual classify jobs fail and are retried by BullMQ. Failed encodes are not cached, so the next attempt re-tries the ML call.

[smart-search-settings]: https://my.immich.app/admin/system-settings?isOpen=machine-learning+smart-search
[job-status-page]: https://my.immich.app/admin/queues
