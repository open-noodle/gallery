# Pet Recognition — Phase 1 Spike Results & Go/No-Go

> **The EERs below are superseded.** They were measured on a capped ~600-identity dog sample. The
> shipped models were re-validated on the full test splits in
> [`2026-07-24-pet-recognition-phase2-model-production-RESULTS.md`](2026-07-24-pet-recognition-phase2-model-production-RESULTS.md)
> — dogs land ~1.5× higher there (base 0.039 → 0.047, large 0.023 → 0.034); cats, already scored in
> full here, hold. Quote the full-split numbers. This document stands as the spike's record.

- **Status:** ✅ **GO** — feasible, with a validated license-clean recipe
- **Date:** 2026-07-24
- **Spec:** `docs/superpowers/specs/2026-07-24-pet-recognition-phase1-training-spike-design.md`
- **Plan:** `docs/superpowers/plans/2026-07-24-pet-recognition-phase1-training-spike.md`

## TL;DR

Individual pet re-identification is feasible on **commercially license-clean** data. The
winning recipe is **not** the plan's fine-tune configs — it's a **frozen DINOv2 backbone +
a small trained projection head** on whole-animal crops:

> **Frozen `dinov2-base` + linear projection head → dog EER 0.039, cat EER 0.044.**
> Beats AvitoTech's fine-tuned SOTA (0.055), with an Apache-2.0 backbone + a ~150k-param
> projection trained only on CC0 (Dogs-World) + CC-BY (cats) data.

## Results matrix (EER — lower is better; verification on held-out identities)

| Backbone     | Recipe                | 🐕 Dog EER | 🐈 Cat EER | 🐕 Dog Top-1 | 🐈 Cat Top-1 |
| ------------ | --------------------- | ---------- | ---------- | ------------ | ------------ |
| small (22M)  | zeroshot              | 0.103      | 0.099      | 0.714        | 0.906        |
| small        | full fine-tune 1e-4   | 0.325 ❌   | 0.111      | 0.346        | 0.863        |
| small        | full fine-tune 1e-5   | 0.178 ❌   | 0.072      | 0.526        | 0.897        |
| small        | linear projection     | 0.060      | 0.067      | 0.810        | 0.914        |
| small        | MLP projection        | **0.053**  | 0.066      | 0.807        | 0.914        |
| base (86M)   | zeroshot              | 0.071      | 0.088      | 0.770        | 0.912        |
| base         | linear projection     | 0.039      | 0.044      | 0.860        | 0.916        |
| large (300M) | zeroshot              | 0.051      | 0.096      | 0.799        | 0.913        |
| **large**    | **linear projection** | **0.023**  | 0.044      | **0.919**    | 0.915        |

**Backbone scaling: dogs keep improving, cats plateau.** Dog EER falls monotonically with
backbone size (0.060 → 0.039 → **0.023**), but cat EER is flat at 0.044 for base **and** large —
cats are limited by their **data**, not the model (only 407 train identities). But note (see
§"Cat ceiling"): more data alone does **not** fix it — the ceiling is data _quality_, not volume.
**giant was skipped**: cats can't benefit, dogs are already excellent at 0.023, and it crosses
ONNX's 2 GB single-file limit (external-data format) for ~4.5 GB — cost far exceeds the marginal
dog gain.

## What the spike learned (the arc)

1. **Zeroshot already works.** Plain DINOv2 separates individual pets out of the box
   (dog EER ~0.10) — the datasets may only be needed to train the projection, not as a
   licensing liability.
2. **Full fine-tuning is the wrong lever.** Backprop through the whole ViT overfits the
   train identities and _forgets_ DINOv2's general features — dogs regressed badly at every
   learning rate tried.
3. **A frozen-backbone projection head is the answer.** It can't destroy the backbone, and
   the tiny learned projection re-shapes the frozen features for pet identity. Cleanly beats
   zeroshot on **both** species. (This is what the plan's no-op "head" config _should_ have
   been — see Phase 2 note.)
4. **Bigger backbone helps dogs (and cats plateau).** Dog EER fell 0.060→0.039→0.023 across
   small→base→large; cat EER flattened at 0.044 (base=large) because cats are data-limited. So
   backbone size and cat data are independent levers.
5. **But the cat ceiling is data _quality_, not volume** — see below.

## Cat ceiling — LCW does NOT break the plateau

We tested the obvious cat lever: add **LCW** (135,267 cats, Apache-2.0) to the 407-cat training
pool. Result (base backbone, +30k LCW cats = 74× more cat data, projection retrained):

| Eval set               | cats WITHOUT LCW | cats WITH +30k LCW |
| ---------------------- | ---------------- | ------------------ |
| Cat-Individual (clean) | **0.044**        | 0.052 (≈flat)      |
| LCW held-out (noisy)   | 0.109 (zeroshot) | 0.074 (proj)       |

**74× more cat data left the clean Cat-Individual EER flat** (0.044→0.052, within run-to-run
variance — the projection training isn't seeded). LCW's label noise (Petfinder re-listings → the
same cat under multiple IDs = contradictory supervision) cancels its volume. So the cat ceiling is
a **data-quality** limit, not volume — more noisy data won't fix it, and no genuinely-clean large
cat set exists off-the-shelf (surveyed). LCW _does_ add cross-distribution robustness (it improves
LCW-style cats, 0.109→0.074), just not clean-cat quality. **Decision: ship cats at ~0.044 for v1**
(strong, Top-1 0.916); cleaning/dedup-merging LCW is a deferred Phase-1.5 experiment.

## Datasets — what's full vs. sampled

**Training used the FULL data; only the eval is sampled.** Specifics:

| Split                      | Identities | Images  | Notes                                     |
| -------------------------- | ---------- | ------- | ----------------------------------------- |
| Dog train (Dogs-World)     | 65,875     | 215,651 | CC0, whole-animal                         |
| Dog test (Dogs-World)      | 16,469     | 53,830  | held-out individuals                      |
| Dog eval-only (DogFaceNet) | 1,393      | 8,363   | CC-BY, aligned _faces_ (different domain) |
| Cat train (Cat Individual) | 407        | 10,446  | CC-BY, whole-animal                       |
| Cat test (Cat Individual)  | 102        | 2,575   | held-out individuals                      |

- **Projection training: the full 226,097-image / 66,282-identity train split** — not a subset.
- **Eval: a capped sample** (~600 of 16,469 dog test identities; all 102 cat test identities;
  600 DogFaceNet) — capped because the verification/identification metrics are O(N²). So the
  reported EERs are trained on full data but validated on a sample; directionally solid, but
  **final numbers should use a scalable eval over the full test set** before locking.
- **Dogs-World mapping:** the image→dog link is **not** in the folder structure — it's in
  `metadata/<image_hash>.json` sidecars (`identities[].identity` + `path`). We use only
  single-dog images (multi-dog photos dropped, no per-dog crop).
- **LCW (~135k cats, Apache-2.0):** tested (see §"Cat ceiling") — its label noise cancels the
  volume, so it does NOT improve clean cats. Not used for v1.

## Cost / timing — the projection recipe is cheap

The recipe extracts frozen embeddings **once** (the only expensive step), then trains a tiny
head — so there are **no per-epoch backbone passes**. Measured extraction throughput on the
M5 Max (bf16, thread-loaded) and full-execution estimate per model over the 226k-image train set:

| Backbone | Extraction | Extract 226k | + projection train | **Full model ≈** |
| -------- | ---------- | ------------ | ------------------ | ---------------- |
| small    | 767 img/s  | ~5 min       | ~5 min             | **~10 min**      |
| base     | 405 img/s  | ~9 min       | ~5 min             | **~15 min**      |
| large    | 159 img/s  | ~24 min      | ~5 min             | **~30 min**      |

- **All 3 production models ≈ under an hour of compute, $0** (local M5 Max).
- **Contrast:** a full fine-tune is ~5 h **per model** — the projection recipe is ~20× cheaper
  because the backbone forward happens once, not once per epoch.

## Recommendation for Phase 2

**Ship a selectable small / base / large lineup** (mirrors the RF-DETR pet detector's two
selectable models). Key design points:

- **Uniform 512-d output:** the projection head can map any backbone (384/768/1024) → **512-d**,
  so all three models write into the same `vector(512)` store and reuse the existing
  `face_search` / `searchFaces` / `face_identity` infrastructure. Users can switch models without
  a schema change (switching re-embeds all pets — standard, same as changing the CLIP/face model).
- **Redesign the pipeline's "head" config as a real projection head** with backbone selection and
  a fused backbone+projection ONNX export (opset 17, like RF-DETR); upload the 3 models + cards to
  HuggingFace.
- **The models are the cheap part** (~1–2 days incl. large; 1→3 adds ~1 day). The multi-week work
  is the Phase 2 recognition subsystem (ML embedder + server clustering + admin/UI + tests + docs),
  needed regardless of model count.

## Phase 1.5 — the ceiling-raisers (deferred)

Two independent levers, both deferred out of v1:

- **Dogs → face crops.** DogFaceNet **aligned-face** zeroshot (EER 0.045) beat whole-animal dog
  zeroshot (0.103) — faces carry cleaner identity signal. A **pet-face detect + align** stage in
  front, with the projection trained on face crops, would likely push dogs below 0.023. Needs a new
  pet-face detector (real infrastructure).
- **Cats → cleaned LCW.** The cat ceiling is LCW's label noise, not volume (above). **Dedup-merging
  LCW's re-listed cats** (cluster near-identical individuals by embedding, merge IDs) could unlock
  its 135k volume as _clean_ supervision. Uncertain payoff, so it's an R&D experiment, not v1.

## Reproducibility

- Isolated `uv` project: `machine-learning/pet-recognition-training/` (own deps; 24 tests green).
- Real-layout parsers (Dogs-World metadata sidecars, nested cat dirs), parallel data loader,
  `--lr`/`--num-workers`/per-epoch progress — committed.
- Spike harness (`runs/proj_experiment.py`, thread-loaded extraction + cached embeddings) and the
  345 GB of downloaded data live under scratch/`$PETID_DATA_ROOT`, **out of git**.
