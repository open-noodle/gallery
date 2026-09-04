# Pet Recognition — Phase 1: Training Spike (Design)

- **Status:** Approved design, pending implementation plan
- **Date:** 2026-07-24
- **Author:** Pierre (with Claude Code)
- **Feature line:** Pet detection → pet **recognition** (individual pet identity)

## 1. Context

Gallery already ships **pet detection**: the ML service (RF-DETR) finds animals in
a photo and labels them by species, and the server creates **one `person` per
`(owner, species)`** — every dog you own collapses into a single `dog` entry
(`pet-detection.service.ts` groups detections by species label; no embedding is
ever produced).

**Pet recognition** is the missing stage that turns "this is a dog" into "this is
_Rex_." The agreed product direction is to **mirror the existing human
face-recognition flow as closely as possible**:

```
People:  detect (RetinaFace) → embed (ArcFace 512-d) → NN-cluster → person   ✅ exists
Pets:    detect (RF-DETR)    → embed (pet re-ID)      → NN-cluster → pet      ⟵ add the middle, reuse the rest
```

The fork's schema already carries half the scaffolding for this
(`person.type='pet'` + `person.species`, a `face_identity` table with
`type IN ('person','pet')`, and a `face_identity_face` join), so the integration
is largely "point the existing clustering machinery at a pet embedder."

### 1.1 Why two phases

The work splits into two independently-valuable pieces:

- **Phase 1 (this doc) — the training spike.** A self-contained ML experiment,
  run outside the app, that answers _"can we train a commercially-shippable pet
  re-ID embedder on license-clean data, good enough to cluster individual pets?"_
  Output = a model, an ONNX export, and a measured per-species quality verdict.
- **Phase 2 (later) — product integration.** Wire the embedder into the people
  flow: an ML recognition model, embedding storage, NN clustering, and the
  pet-identity UI. **Moot until Phase 1 proves a viable model**, so it is
  specified separately, _after_ Phase 1's results are in.

This decomposition keeps the risky, unknowable part (does a clean-data model
actually work?) cheap and up front.

## 2. Goal & non-goals

**Goal:** Produce a commercially-shippable, license-clean embedder for individual
**dog and cat** recognition, plus a measured, per-species quality report that
tells us whether — and for which species — to proceed to Phase 2.

**Non-goals (Phase 1):**

- No application/server/web/mobile changes. No detection-pipeline changes.
- No face-alignment / pet-face-detector stage (see §5, whole-animal crops).
- No per-breed classification; identity only.
- Not a shippable release — this is a spike to _measure feasibility_.

## 3. Scope

Individual recognition is trained and evaluated for **dog (primary) and cat**
only. Rationale and the full six-species survey are in §11.

- **Dog** — the must-have. Must clear the usability bar (§9).
- **Cat** — best-effort; measured and reported, weaker data expected.
- **Cattle** — clean data _does_ exist (BECA + CoBRA, CC-BY), but scoped **out by
  decision** to keep v1 to the two species users photograph as pets (§11).
- **Horse, sheep, bird** — **out for lack of data.** No commercial-clean
  individual-ID data exists for them today (§11).
- All out-of-scope species keep today's species-bucket behavior. Phase 2 gates
  recognition **per species**, so unsupported species simply stay buckets with no
  special-casing.

## 4. Constraints (the non-obvious ones)

- **License-clean only.** The feature ships in a commercial product (hosted +
  self-hosted), so every artifact must be commercially licensed. This **excludes
  PetFace** (non-commercial for dataset, code, _and_ trained models) and — because
  they are PetFace-derived — **the ready-made AvitoTech pet embedders**. It also
  excludes MegaDescriptor (CC-BY-NC). Rolling our own is therefore not the
  convenient path; it is the _only legal_ one.
- **Reuse the people flow.** Design choices should keep Phase 2 able to reuse
  `face_search` / `searchFaces` / `face_identity` wherever practical.

## 5. Key decisions

| Decision            | Choice                                              | Why                                                                                                                                                      |
| ------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model family        | `facebook/dinov2-small` (Apache-2.0) + ArcFace head | Small/fast, ONNX-exportable, permissive base; matches the metric-learning approach used by prior art                                                     |
| Embedding dim       | 384 (native)                                        | Keep the spike simple; the 384-vs-512 storage question is a Phase 2 decision (§10, §12)                                                                  |
| **Crop convention** | **Whole-animal, end-to-end**                        | Matches RF-DETR's whole-animal boxes at serve time; no separate pet-face detector to build; unlocks the bulk datasets; coat/body is real identity signal |
| Training venue      | Local, on the M5 Max (MPS, bf16)                    | Measured ~6–8.5 h for a full fine-tune, $0 (§8); 128 GB unified memory fits the large ArcFace head                                                       |
| Identity split      | Split by **individual**, not by image               | Eval identities must be unseen in training or the re-ID metrics are meaningless                                                                          |

The crop convention is the load-bearing decision. DogFaceNet is tightly aligned
_face_ crops; every other dataset (and our production detector) is whole-animal.
Training across mixed crop domains wrecks quality, so we standardize on
whole-animal and treat DogFaceNet's aligned crops as an **eval-only** set rather
than training data.

## 6. Data

All datasets are commercially licensed. CC-BY sources require an attribution
manifest committed with the model (§10).

| Species | Dataset               | Identities | Images   | Crop         | License    | Role in Phase 1                          |
| ------- | --------------------- | ---------- | -------- | ------------ | ---------- | ---------------------------------------- |
| Dog     | Dogs-World            | 126,550\*  | 313,688  | Whole dog    | CC0        | **Primary training** (filter ≥2 img/ID)  |
| Dog     | DogFaceNet            | 1,393      | 8,363    | Aligned face | CC-BY-4.0  | **Eval-only** (different crop domain)    |
| Cat     | Cat Individual Images | 518        | 13,536   | Whole cat    | CC-BY-4.0  | **Primary training** (clean core)        |
| Cat     | LCW                   | ~140,000\* | ~380,924 | Whole cat\*  | Apache-2.0 | **Optional**, only after a cleaning pass |

\*Uncertain / needs local verification: Dogs-World is singleton-heavy (~2.5
img/ID) so the re-ID-usable dog count after filtering to ≥2 images/ID is unknown
until processed; LCW's ~140k identity count, label reliability, and crop nature
are the dataset author's unverified claims.

**Data prep tasks:** download; filter to identities with ≥2 images; build a
held-out split by individual (e.g. 80/20 by identity, so test individuals are
never seen in training); normalize all crops to a single whole-animal convention
(square resize to 224×224 to match DINOv2); optionally run an LCW cleaning/vetting
pass before deciding whether to include it.

## 7. Model & training

Backbone `dinov2-small` → 384-d CLS embedding → L2-normalized. Similarity =
cosine. ArcFace classification head over the union of all training identities
(dog + cat). We run **three configurations** so we can attribute any quality to
the training rather than to DINOv2's priors:

1. **Zero-shot control** — frozen DINOv2, no head training. Establishes the "does
   fine-tuning even help?" baseline.
2. **Head-only (linear probe)** — freeze backbone, cache embeddings once, train
   just the ArcFace head. Sub-hour; a fast first read.
3. **Full fine-tune** — backbone adapts (bf16). The real candidate; ~6 h measured.

## 8. Environment & reproducibility

- Machine: MacBook Pro **M5 Max, 40-core GPU, 128 GB unified memory**.
- Stack: `uv` venv (Python 3.12), PyTorch MPS, `transformers`; export via
  `torch.onnx` / `optimum`.
- **Measured throughput** (dinov2-small, 50k-class ArcFace head, on this machine):

  | Precision       | Inference   | Training  | Full fine-tune (400k imgs × 15 ep) |
  | --------------- | ----------- | --------- | ---------------------------------- |
  | fp32, batch 64  | 806 img/s   | 195 img/s | 8.5 h                              |
  | bf16, batch 128 | 1,542 img/s | 263 img/s | 6.3 h                              |

  Embedding extraction (one pass, head-only prep) is ~4–8 min for the whole
  dataset. So: full fine-tune is an **overnight run, $0**; the head-only prototype
  loop is **sub-hour**.

## 9. Evaluation & go/no-go

Metrics are computed **per species on held-out identities**, never blended (a
combined average can hide a bad cat model behind a good dog model):

- **Verification:** ROC-AUC and EER (directly comparable to published pet-ID
  numbers).
- **Identification:** Top-1 accuracy and mAP.
- **Clustering-realism test:** simulate what Phase 2 will actually do — given N
  photos of M known individuals plus distractors, run threshold-based
  nearest-neighbour grouping and measure cluster purity / completeness. This is
  the metric that matters for the product.

**Go/no-go bar:**

- **Dog (gating):** must (a) beat the zero-shot control by a material margin and
  (b) cluster cleanly at a conservative distance threshold in the realism test.
  Exact numeric thresholds are deliberately **not pre-committed** — they will be
  fixed _after_ the zero-shot baseline is measured, so we calibrate against a real
  number instead of a guess.
- **Cat:** measured and reported. Phase 2 enables cat recognition only if it
  clears the same bar; otherwise cats stay a species-bucket.

## 10. Deliverables

1. **Reproducible pipeline** — data prep, training (all three configs), and eval,
   runnable end-to-end.
2. **Trained weights + ONNX export** with a documented I/O contract (input shape,
   normalization, output embedding dim/semantics), in the same model-card style as
   the RF-DETR detector.
3. **Per-species evaluation report** — the metrics table, the
   zero-shot/head-only/full-finetune comparison, the clustering-realism result,
   and an explicit per-species go/no-go recommendation.
4. **License/attribution manifest** for every dataset used (CC-BY attribution
   text, links, "changes made" note).
5. **Phase 2 appendix** — the embedding-dimension decision (ship 384-d and add a
   pet vector column, or project to 512-d to reuse `face_search` as-is; §12),
   recommended clustering threshold defaults, and confirmation of the crop
   strategy.

## 11. Six-species data survey (why dog + cat)

Mapping commercial-clean individual-ID data onto RF-DETR's detected classes:

| Species | Clean-license individual-ID data             | v1 recognition                      |
| ------- | -------------------------------------------- | ----------------------------------- |
| Dog     | DogFaceNet (CC-BY) + Dogs-World (CC0)        | ✅ primary                          |
| Cat     | Cat Individual Images (CC-BY) + LCW (Apache) | ✅ best-effort                      |
| Cattle  | BECA + CoBRA (CC-BY)                         | Deferred (out of scope by decision) |
| Horse   | none (only CC-BY-NC exists)                  | ❌ species-bucket                   |
| Sheep   | none confirmed clean                         | ❌ species-bucket                   |
| Bird    | none clean (best set unlicensed)             | ❌ species-bucket                   |

Cattle _is_ trainable on clean data (a genuine surprise), but was scoped out to
keep v1 focused on the two species users actually photograph as pets.

## 12. Phase 2 preview (not in scope, for context)

If Phase 1 clears the bar, Phase 2 mirrors the human face flow:

- **ML:** a pet-recognition model with `depends=[(DETECTION, PET_DETECTION)]`
  (mirroring `FaceRecognizer`), registered as a `(RECOGNITION, PET_DETECTION)`
  case; `detectPets` extended to request recognition so the response carries
  embeddings.
- **Storage decision:** `face_search.embedding` is hard-fixed `vector(512)`. A
  384-d pet embedder needs either a projection to 512-d (to reuse `face_search` /
  `searchFaces` / `face_identity` wholesale) or its own vector column/table.
  Phase 1's report will recommend which.
- **Clustering:** reuse `handleRecognizeFaces`-style NN search with
  pet-specific thresholds; replace the species-bucket grouping in
  `pet-detection.service.ts` with per-individual clustering, keeping `species` as
  metadata on the pet person.
- **Serve-time per-species gate:** turn individual recognition on only for species
  that cleared Phase 1's bar; others remain species-buckets.

## 13. Risks & open questions

- **Dogs-World singleton skew** — real usable dog count is unknown until filtered.
- **LCW quality** — noisy per-listing labels and unconfirmed crop nature; may be
  dropped in favor of Cat Individual Images alone for v1.
- **Whole-animal < face crops?** — if whole-animal embeddings underperform, the
  fallback (a "Phase 1.5") is to add a pet-face detect+align stage and retrain on
  aligned crops. Chosen against up front for simplicity, but kept as an escape
  hatch.
- **Cat ceiling** — curated clean cat identities number only ~500–1,000; cats may
  simply not clear the bar, in which case v1 ships dog-only.
- **384 vs 512 embedding dim** — deferred to Phase 2 but flagged now so the
  training doesn't foreclose either option.
