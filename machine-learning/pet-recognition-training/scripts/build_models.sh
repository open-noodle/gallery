#!/usr/bin/env bash
# Build every shippable pet re-ID model: train the projection on cached frozen-backbone
# features, score it on the full test splits, export the fused ONNX, and stage the HF repo.
#
#   scripts/build_models.sh                 # all three
#   BACKBONES="base" scripts/build_models.sh
#
# Publishing is deliberately NOT part of this script: run petid.publish --upload once the
# reports have been reviewed.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PY:-uv run python}"
BACKBONES="${BACKBONES:-small base large}"
DEVICE="${DEVICE:-mps}"
INIT="${INIT:-identity}"
MANIFEST="${MANIFEST:-manifest.json}"

for B in $BACKBONES; do
  OUT="runs/pet-reid-$B"
  echo "=== $B: train ==="
  $PY -m petid.train --backbone "$B" --out "$OUT" --manifest "$MANIFEST" --init "$INIT" --device "$DEVICE"

  echo "=== $B: evaluate (full test splits) ==="
  $PY -m petid.evaluate --checkpoint "$OUT/best.pt" --manifest "$MANIFEST" \
    --out "$OUT/report.md" --json "$OUT/metrics.json" --device "$DEVICE"

  echo "=== $B: export ONNX ==="
  $PY -m petid.export_onnx --checkpoint "$OUT/best.pt" --out "$OUT/model.onnx"

  echo "=== $B: stage HF repo ==="
  $PY -m petid.publish --onnx "$OUT/model.onnx" --backbone "$B" \
    --metrics "$OUT/metrics.json" --staging "runs/publish/pet-reid-$B"
done

echo "done. reports: runs/pet-reid-*/report.md"
