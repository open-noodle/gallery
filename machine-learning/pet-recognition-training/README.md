# Pet Recognition Training Spike (Phase 1)

Isolated training project. Not part of the production ML service.

## Setup

```bash
uv sync --extra dev
export PETID_DATA_ROOT=/path/to/scratchpad/petid-data   # NOT inside the repo
```

## Run

```bash
bash scripts/download_data.sh
uv run python -m petid.manifest build --data-root "$PETID_DATA_ROOT" --out manifest.json
uv run python -m petid.train --config full --manifest manifest.json --out runs/full
uv run python -m petid.evaluate --manifest manifest.json --checkpoint runs/full/best.pt --out runs/full/report.md
uv run python -m petid.export_onnx --checkpoint runs/full/best.pt --out runs/full/pet_embedder.onnx
```
