#!/usr/bin/env bash
set -euo pipefail
: "${PETID_DATA_ROOT:?set PETID_DATA_ROOT to a scratchpad path outside the repo}"
mkdir -p "$PETID_DATA_ROOT"
cd "$PETID_DATA_ROOT"

# Requires: `pip install kaggle` and ~/.kaggle/kaggle.json (Kaggle API token).
echo "== Dogs-World (CC0) =="
kaggle datasets download -d lextoumbourou/dogs-world -p dogs-world --unzip

echo "== Cat Individual Images (CC-BY-4.0) =="
kaggle datasets download -d timost1234/cat-individuals -p cat-individuals --unzip

echo "== DogFaceNet resized (CC-BY-4.0, eval-only) =="
mkdir -p dogfacenet
# Zenodo record 12578449 — DogFaceNet_224resized archive.
curl -L -o dogfacenet/dfn.zip "https://zenodo.org/records/12578449/files/DogFaceNet_224resized.zip?download=1"
unzip -q dogfacenet/dfn.zip -d dogfacenet && rm dogfacenet/dfn.zip

echo "Done. Verify layout: <root>/<dataset>/<individual>/<img>."
