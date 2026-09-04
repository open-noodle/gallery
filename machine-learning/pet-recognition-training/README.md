# Pet Re-ID Model Training

Isolated training project that produces Gallery's **pet recognition** models —
`open-noodle/pet-recognition-{small,base,large}`. Not part of the production ML service; the service
only consumes the published ONNX.

## The recipe

A **frozen DINOv2 backbone** plus a **trained linear projection** to a uniform **512-d**
embedding. The projection's L2-normalized output *is* the embedding.

- The backbone never trains — a full fine-tune overfits the training identities and forgets
  DINOv2's general features (Phase 1 measured dogs getting *worse* at every learning rate).
- So the backbone's features over a fixed image set never change: they are extracted
  **once** into a cache, and every projection run trains on that cache in minutes.
- Because the projection is trained on **L2-normalized** backbone features, inference
  normalizes twice: `backbone -> normalize -> projection -> normalize`. The exported ONNX
  fuses exactly that.

## Setup

```bash
uv sync --extra dev
export PETID_DATA_ROOT=/path/to/petid-data   # NOT inside the repo (345 GB)
```

## Build the models

```bash
bash scripts/download_data.sh
uv run python -m petid.manifest build --data-root "$PETID_DATA_ROOT" --out manifest.json
scripts/build_models.sh            # train + evaluate + export + stage, for all 3 backbones
```

`build_models.sh` runs, per backbone:

```bash
uv run python -m petid.train      --backbone base --out runs/pet-recognition-base --manifest manifest.json
uv run python -m petid.evaluate   --checkpoint runs/pet-recognition-base/best.pt --manifest manifest.json \
                                  --out runs/pet-recognition-base/report.md --json runs/pet-recognition-base/metrics.json
uv run python -m petid.export_onnx --checkpoint runs/pet-recognition-base/best.pt --out runs/pet-recognition-base/model.onnx
uv run python -m petid.publish    --onnx runs/pet-recognition-base/model.onnx --backbone base \
                                  --metrics runs/pet-recognition-base/metrics.json   # add --upload to push
```

## Caches

Feature extraction is the only expensive step, so both caches are keyed by backbone and
reused across runs:

| Cache | Path | Contents |
| --- | --- | --- |
| Train | `runs/emb_cache_dinov2-<size>.pt` | frozen features for the full train split |
| Eval | `runs/eval_cache_dinov2-<size>.pt` | frozen features for every test split |

Retraining a projection (different init, lr, epochs) reuses both, so a full retrain +
re-score is minutes rather than the ~10/15/30 min a cold extraction costs.

Images are loaded with a `ThreadPoolExecutor`, **not** DataLoader workers: `num_workers > 0`
deadlocks on macOS + MPS, and JPEG decoding releases the GIL anyway.

## Evaluation

`petid.evaluate` scores the **full** test splits (16,469 dog / 102 cat held-out identities)
via `streaming_metrics`, which consumes the similarity matrix in row chunks instead of
materializing it (11 GB at dog scale). Every model is reported against its own zeroshot
baseline, so the projection's contribution is always visible.

## Tests

```bash
uv run pytest
```

No network and no dataset needed — tests build backbones offline (`pretrained=False`) over
synthetic images.
