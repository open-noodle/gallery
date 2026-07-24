# Pet Recognition — Phase 2 §4.1 Model Production: Results

- **Status:** ✅ Models built, validated at full test scale, exported and staged. **Not yet uploaded** to the Hub.
- **Date:** 2026-07-24
- **Design:** [`2026-07-24-pet-recognition-phase2-design.md`](../specs/2026-07-24-pet-recognition-phase2-design.md) §4.1
- **Supersedes the model numbers in:** [`2026-07-24-pet-recognition-phase1-RESULTS.md`](2026-07-24-pet-recognition-phase1-RESULTS.md)
  (Phase 1 scored a capped ~600-identity sample; these are the full splits)
- **Pipeline:** `machine-learning/pet-recognition-training/` (`scripts/build_models.sh`)

## The lineup

Three selectable models, all emitting a **uniform 512-d L2-normalized** embedding, so they share
one `pet_search` schema and a model switch only requires re-embedding.

| Model            | Backbone (frozen)       | ONNX   | 🐕 dog EER | 🐈 cat EER | 🐕 dog Top-1 | torch↔ORT parity |
| ---------------- | ----------------------- | ------ | ---------- | ---------- | ------------ | ---------------- |
| `pet-reid-small` | `facebook/dinov2-small` | 85 MB  | 0.068      | 0.065      | 0.535        | 6.3e-07          |
| `pet-reid-base`  | `facebook/dinov2-base`  | 332 MB | 0.047      | 0.045      | 0.612        | 8.6e-07          |
| `pet-reid-large` | `facebook/dinov2-large` | 1.1 GB | **0.034**  | **0.041**  | **0.672**    | 1.3e-06          |

`base` stays the default: it captures most of large's quality at a quarter of the size.

## Full-scale evaluation

Every model scored against **its own zeroshot baseline** on the complete test splits — no identity
cap. Verification EER (lower better) / identification Top-1 (higher better):

| Split                                    | Images | IDs    | Model | small         | base          | large         |
| ---------------------------------------- | ------ | ------ | ----- | ------------- | ------------- | ------------- |
| Dogs (Dogs-World, held-out)              | 53,830 | 16,469 | zero  | 0.097 / 0.428 | 0.075 / 0.483 | 0.063 / 0.526 |
|                                          |        |        | proj  | 0.068 / 0.535 | 0.047 / 0.612 | 0.034 / 0.672 |
| Cats (Cat Individual, held-out)          | 2,575  | 102    | zero  | 0.099 / 0.906 | 0.088 / 0.912 | 0.096 / 0.913 |
|                                          |        |        | proj  | 0.065 / 0.913 | 0.045 / 0.916 | 0.041 / 0.915 |
| Dogs (DogFaceNet, unseen, aligned faces) | 8,363  | 1,393  | zero  | 0.046 / 0.880 | 0.036 / 0.922 | 0.036 / 0.924 |
|                                          |        |        | proj  | 0.055 / 0.899 | 0.031 / 0.943 | 0.024 / 0.957 |

**The projection beats zeroshot everywhere except one cell:** `small` on DogFaceNet (0.046 → 0.055).
The smallest projection buys in-domain gains at a small cross-domain cost on aligned faces — a
different image domain than it was trained on. Phase 1 saw the same regression (0.046 → 0.057), so
it reproduces rather than being a fluke. `base` and `large` improve on that split too.

### What changed vs Phase 1 (and why)

Phase 1's O(N²) metrics forced a capped ~600-identity dog sample. Scoring all 16,469 identities
makes the task genuinely harder, and the honest dog numbers are ~1.5× the capped ones:

| Backbone | dog EER (Phase 1, capped) | **dog EER (full split)** | cat EER (both full) |
| -------- | ------------------------- | ------------------------ | ------------------- |
| small    | 0.060                     | **0.068**                | 0.067 → 0.065       |
| base     | 0.039                     | **0.047**                | 0.044 → 0.045       |
| large    | 0.023                     | **0.034**                | 0.044 → 0.041       |

- **Cats validate the port.** Cats were already scored in full in Phase 1 (all 102 identities), and
  they land within ±0.003 of the Phase-1 values through the new 512-d pipeline and the new streaming
  metrics. That is independent evidence that the rewrite is faithful and that 768/1024 → **512**
  costs nothing.
- **Dog Top-1 falls a lot** (base 0.860 → 0.612) — expected, and not a regression: ranking against a
  53,830-image gallery is a much harder retrieval problem than against a ~2k sample.
- **Cats are not perfectly flat after all.** Phase 1 measured base = large = 0.044; at full scale
  large is slightly better (0.045 → 0.041). The gain is still 3× smaller than the dog gain, so
  "cats are data-limited, not model-limited" stands.
- **Quote the full-split numbers from now on.** Cross-paper comparisons (e.g. AvitoTech's 0.055)
  are indicative only — different dataset, different protocol.

## Artifact validation

- **Fused ONNX**, opset 17, dynamic batch: `input [N,3,224,224]` float32 → `embedding [N,512]`
  L2-normalized. Backbone + projection + both normalizes in one graph, one session.
- **Parity** torch ↔ onnxruntime ≤ 1.3e-06 for all three (gate: < 1e-3).
- **Under the ONNX 2 GB single-file limit** — large is 1.14 GB, so no external-data format. (This is
  what ruled `giant` out: ~4.5 GB.)
- **Real-photo smoke test** on 120 held-out dog photos (60 dogs × 2), with preprocessing
  reimplemented **from the model card alone** rather than from the training code — so it also
  verifies the card is accurate enough for §4.2 to build against:

  | Model | rank-1 | same-dog cosine | other-dog cosine |
  | ----- | ------ | --------------- | ---------------- |
  | small | 0.817  | 0.463           | 0.006            |
  | base  | 0.950  | 0.490           | 0.004            |
  | large | 0.950  | 0.517           | 0.002            |

- **Reproducible:** training is seeded end-to-end. `base` was trained twice (init A/B, then the
  production run) and reproduced its loss (5.895) and every reported metric digit-for-digit.

## Tuning inputs for §4.2

**Projection init.** The 512-d projection is non-square, so Phase 1's identity init no longer simply
passes features through. Identity and xavier were A/B'd on `base` at full scale and tied
(dog 0.047 vs 0.048, cat 0.045 both, DFN 0.031 vs 0.032 — all within noise). **Identity ships**: it
warm-starts at (truncated) pass-through, so training starts from the zeroshot baseline and degrades
gracefully rather than arbitrarily.

**Clustering `maxDistance`.** Homogeneity/completeness across cosine distances (5,000-image
subsample, `large`; `base` is within 0.01):

| Distance | dog hom / comp | cat hom / comp |
| -------- | -------------- | -------------- |
| 0.40     | 0.994 / 0.987  | 0.985 / 0.877  |
| 0.50     | 0.992 / 0.989  | 0.976 / 0.928  |
| 0.60     | 0.983 / 0.993  | 0.940 / 0.965  |
| 0.70     | 0.940 / 0.995  | 0.865 / 0.979  |

Cats need a looser threshold than dogs (completeness is only 0.88 at 0.40), so a shared default
lands around **0.55–0.6**. Corroborated by the smoke test's genuine/impostor gap (same-dog cosine
≈ 0.49, impostor ≤ 0.30, i.e. distances ≈ 0.51 vs ≥ 0.70). Treat as a starting point, not a final
value: this is agglomerative clustering over curated corpora, while production does greedy NN-assign
over real libraries.

## Integration notes for §4.2

- **Repo layout is already what the service expects.** Each staged repo is
  `recognition/model.onnx` + `README.md` + `metrics.json`, matching
  `InferenceModel.model_path` (`<cache_dir>/<model_type>/model.onnx`) — no path special-casing, and
  `PetDetector._download`'s `Deeds67/<clean_name>` convention applies unchanged.
- **Preprocessing is NOT the face path.** `FaceRecognizer` hands `decode_cv2` output (BGR uint8)
  straight to insightface, which normalizes internally. `PetRecognizer` must do its own:
  crop the detector box → resize 224×224 → **BGR→RGB** → `/255` → ImageNet mean/std → CHW float32.
  Getting the channel order or normalization wrong silently degrades embeddings without erroring.
- **No landmark alignment**: whole-animal crop, unlike ArcFace's aligned face.
- **Cosine similarity == dot product** (outputs are unit vectors).
- **Model names** for `petRecognition.modelName`: `pet-reid-small` / `pet-reid-base` (default) /
  `pet-reid-large`.

## Publishing

All three repos are staged locally at `runs/publish/pet-reid-{small,base,large}/`. Upload is a
deliberate, separate step and is **still pending approval**:

```bash
uv run python -m petid.publish --onnx runs/pet-reid-base/model.onnx --backbone base \
  --metrics runs/pet-reid-base/metrics.json --upload
```

## Out of scope here

§4.2+ (ML service embedder, `pet_search` storage, server clustering pipeline, config/jobs, admin
UI) is a separate `/impl-loop` pass. Mobile stays deferred per the design.
