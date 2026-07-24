# Pet Recognition — Phase 1 Training Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Train and evaluate a license-clean `dinov2-small` + ArcFace embedder for individual dog and cat recognition on whole-animal crops, producing an ONNX model plus a measured per-species go/no-go report.

**Architecture:** A self-contained Python project (`machine-learning/pet-recognition-training/`) with its own `uv` environment, isolated from the production ML service. A data layer parses several commercially-licensed datasets into one identity-labelled manifest (split by individual so eval identities are unseen); a model layer wraps DINOv2 with an ArcFace head; runners perform three training configs (zero-shot control, head-only, full fine-tune); an eval layer computes per-species verification/identification/clustering metrics; an export layer produces a parity-checked ONNX embedder.

**Tech Stack:** Python 3.12, uv, PyTorch (MPS/bf16), `transformers` (DINOv2), scikit-learn (metrics), Pillow, numpy, pytest. Datasets via Kaggle API + Zenodo.

## Global Constraints

- **Commercial-clean licensing only.** Base model `facebook/dinov2-small` (Apache-2.0). Datasets limited to: Dogs-World (CC0), DogFaceNet (CC-BY-4.0), Cat Individual Images (CC-BY-4.0), optionally LCW (Apache-2.0). **PetFace and any PetFace-derived model (incl. AvitoTech) are forbidden.** MegaDescriptor (CC-BY-NC) forbidden.
- **Crop convention: whole-animal, end-to-end.** DogFaceNet's aligned face crops are **eval-only**, never mixed into training.
- **Split by individual, never by image.** A test identity must have zero images in train.
- **Embedding: 384-d, L2-normalized, cosine distance.** ONNX opset 17, dynamic batch, input `[N,3,224,224]` float32 ImageNet-normalized, output `[N,384]` normalized (matches the RF-DETR model-card discipline).
- **Species in scope: dog, cat only.** Metrics reported per-species, never blended.
- **Heavy artifacts stay out of git:** raw datasets and `.pt`/`.onnx` weights live under the scratchpad or HuggingFace; only code, manifests (JSON, small), the report (markdown), and `ATTRIBUTION.md` are committed.
- **Project location:** `machine-learning/pet-recognition-training/` on branch `feat/pet-recognition`. Data root defaults to `$PETID_DATA_ROOT` (a scratchpad path), never inside the repo.

---

## File Structure

```
machine-learning/pet-recognition-training/
  pyproject.toml               # uv project, own deps
  README.md                    # how to run
  ATTRIBUTION.md               # dataset licenses/attribution (CC-BY compliance)
  src/petid/
    __init__.py
    records.py                 # ImageRecord dataclass + manifest read/write
    parsers.py                 # per-dataset dir -> list[ImageRecord]
    manifest.py                # filter >=2/id, split by identity, build manifest
    dataset.py                 # torch Dataset + transforms
    model.py                   # PetEmbedder (DINOv2 backbone) + ArcMarginProduct
    metrics.py                 # eer, roc_auc, top1, mAP, clustering scores
    train.py                   # training runner (zeroshot|head|full)
    evaluate.py                # eval runner -> metrics json + markdown report
    export_onnx.py             # ONNX export + torch/ort parity check
  scripts/
    download_data.sh           # Kaggle + Zenodo fetch into $PETID_DATA_ROOT
  tests/
    conftest.py                # builds tiny synthetic fixtures
    test_records.py
    test_parsers.py
    test_manifest.py
    test_dataset.py
    test_model.py
    test_metrics.py
    test_export.py
```

All `pytest`/`python` commands below are run from `machine-learning/pet-recognition-training/` with the project venv active (`uv run` prefix handles this).

---

### Task 1: Project scaffold

**Files:**

- Create: `machine-learning/pet-recognition-training/pyproject.toml`
- Create: `machine-learning/pet-recognition-training/src/petid/__init__.py`
- Create: `machine-learning/pet-recognition-training/README.md`
- Create: `machine-learning/pet-recognition-training/.gitignore`

**Interfaces:**

- Produces: an installable `petid` package and a `uv` venv with all deps.

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "petid"
version = "0.1.0"
description = "Pet recognition training spike (Phase 1)"
requires-python = ">=3.12,<3.13"
dependencies = [
    "torch>=2.13",
    "torchvision>=0.18",
    "transformers>=5.0",
    "scikit-learn>=1.5",
    "pillow>=10.0",
    "numpy>=1.26",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/petid"]

# Anchors pytest's rootdir to this project so it does not ascend into the parent
# gallery repo's machine-learning/conftest.py (which imports fastapi, absent here).
[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
.venv/
__pycache__/
*.pt
*.onnx
runs/
data/
```

- [ ] **Step 3: Write `src/petid/__init__.py`** (empty package marker)

```python

```

- [ ] **Step 4: Write `README.md`**

````markdown
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
````

- [ ] **Step 5: Create venv and verify imports**

Run: `cd machine-learning/pet-recognition-training && uv sync --extra dev && uv run python -c "import torch, transformers, sklearn; print('ok', torch.backends.mps.is_available())"`
Expected: prints `ok True`

- [ ] **Step 6: Commit**

```bash
git add machine-learning/pet-recognition-training/pyproject.toml machine-learning/pet-recognition-training/.gitignore machine-learning/pet-recognition-training/src/petid/__init__.py machine-learning/pet-recognition-training/README.md
git commit -m "chore(petid): scaffold pet-recognition training project"
```

---

### Task 2: Image record type + manifest IO

**Files:**

- Create: `machine-learning/pet-recognition-training/src/petid/records.py`
- Test: `machine-learning/pet-recognition-training/tests/test_records.py`

**Interfaces:**

- Produces:
  - `ImageRecord(path: str, species: str, individual_id: str, dataset: str, split: str = "")` — frozen dataclass. `individual_id` is globally unique (dataset-prefixed).
  - `write_manifest(records: list[ImageRecord], path: str) -> None` — writes JSON `{"records": [ {...}, ... ]}`.
  - `read_manifest(path: str) -> list[ImageRecord]`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_records.py
from petid.records import ImageRecord, write_manifest, read_manifest


def test_manifest_roundtrip(tmp_path):
    recs = [
        ImageRecord(path="a.jpg", species="dog", individual_id="dogsworld:1", dataset="dogsworld", split="train"),
        ImageRecord(path="b.jpg", species="cat", individual_id="catind:7", dataset="catind", split="test"),
    ]
    out = tmp_path / "m.json"
    write_manifest(recs, str(out))
    back = read_manifest(str(out))
    assert back == recs


def test_record_is_frozen():
    r = ImageRecord(path="a.jpg", species="dog", individual_id="d:1", dataset="d")
    try:
        r.path = "b.jpg"
        assert False, "should be frozen"
    except Exception:
        pass
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_records.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'petid.records'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/petid/records.py
import json
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class ImageRecord:
    path: str
    species: str
    individual_id: str
    dataset: str
    split: str = ""


def write_manifest(records: list[ImageRecord], path: str) -> None:
    with open(path, "w") as f:
        json.dump({"records": [asdict(r) for r in records]}, f, indent=2)


def read_manifest(path: str) -> list[ImageRecord]:
    with open(path) as f:
        data = json.load(f)
    return [ImageRecord(**r) for r in data["records"]]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_records.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add machine-learning/pet-recognition-training/src/petid/records.py machine-learning/pet-recognition-training/tests/test_records.py
git commit -m "feat(petid): image record type and manifest IO"
```

---

### Task 3: Synthetic dataset fixtures

**Files:**

- Create: `machine-learning/pet-recognition-training/tests/conftest.py`

**Interfaces:**

- Produces: a `synthetic_data_root` pytest fixture returning a `Path` containing tiny copies of each dataset's on-disk layout (a handful of 8×8 JPGs per individual). Used by parser, manifest, dataset, model, and export tests so nothing depends on the real multi-GB downloads.

- [ ] **Step 1: Write the fixture**

```python
# tests/conftest.py
from pathlib import Path

import pytest
from PIL import Image


def _img(path: Path, color: tuple[int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), color).save(path)


@pytest.fixture
def synthetic_data_root(tmp_path) -> Path:
    root = tmp_path / "data"
    # Dogs-World: <root>/dogs-world/<dog_id>/<img>.jpg  (folder-per-dog)
    for dog, n in [("dog_A", 3), ("dog_B", 2), ("dog_singleton", 1)]:
        for i in range(n):
            _img(root / "dogs-world" / dog / f"{i}.jpg", (i * 10, 0, 0))
    # Cat Individual Images: <root>/cat-individuals/<cat_id>/<img>.jpg
    for cat, n in [("cat_A", 3), ("cat_B", 2)]:
        for i in range(n):
            _img(root / "cat-individuals" / cat / f"{i}.jpg", (0, i * 10, 0))
    # DogFaceNet resized: <root>/dogfacenet/<dog_id>/<img>.jpg (eval-only)
    for dog, n in [("dfn_1", 2), ("dfn_2", 2)]:
        for i in range(n):
            _img(root / "dogfacenet" / dog / f"{i}.jpg", (0, 0, i * 10))
    return root
```

- [ ] **Step 2: Verify the fixture loads**

Run: `uv run pytest tests/conftest.py -v` (collects nothing; just imports)
Expected: `no tests ran` with exit 5 and no import error. (Confirms conftest imports cleanly.)

- [ ] **Step 3: Commit**

```bash
git add machine-learning/pet-recognition-training/tests/conftest.py
git commit -m "test(petid): synthetic dataset fixtures"
```

---

### Task 4: Per-dataset parsers

**Files:**

- Create: `machine-learning/pet-recognition-training/src/petid/parsers.py`
- Test: `machine-learning/pet-recognition-training/tests/test_parsers.py`

**Interfaces:**

- Consumes: `ImageRecord` from Task 2; `synthetic_data_root` fixture from Task 3.
- Produces:
  - `parse_dogsworld(root: str) -> list[ImageRecord]` — species `"dog"`, dataset `"dogsworld"`, id `"dogsworld:<folder>"`, split `""`.
  - `parse_cat_individuals(root: str) -> list[ImageRecord]` — species `"cat"`, dataset `"catind"`.
  - `parse_dogfacenet(root: str) -> list[ImageRecord]` — species `"dog"`, dataset `"dogfacenet"`, **every record `split="eval_only"`**.
  - `parse_all(data_root: str) -> list[ImageRecord]` — concatenation of the training-eligible parsers (dogsworld + catind) plus dogfacenet.

Each parser reads `<root>/<dataset-dir>/<individual>/<*.jpg|*.png>`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_parsers.py
from petid.parsers import parse_all, parse_dogfacenet, parse_dogsworld


def test_dogsworld_ids_are_prefixed_and_dog(synthetic_data_root):
    recs = parse_dogsworld(str(synthetic_data_root / "dogs-world"))
    assert {r.individual_id for r in recs} == {"dogsworld:dog_A", "dogsworld:dog_B", "dogsworld:dog_singleton"}
    assert all(r.species == "dog" and r.dataset == "dogsworld" for r in recs)
    assert len([r for r in recs if r.individual_id == "dogsworld:dog_A"]) == 3


def test_dogfacenet_is_eval_only(synthetic_data_root):
    recs = parse_dogfacenet(str(synthetic_data_root / "dogfacenet"))
    assert recs and all(r.split == "eval_only" and r.species == "dog" for r in recs)


def test_parse_all_covers_three_datasets(synthetic_data_root):
    recs = parse_all(str(synthetic_data_root))
    assert {r.dataset for r in recs} == {"dogsworld", "catind", "dogfacenet"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_parsers.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'petid.parsers'`

- [ ] **Step 3: Write implementation**

```python
# src/petid/parsers.py
from pathlib import Path

from petid.records import ImageRecord

_EXTS = {".jpg", ".jpeg", ".png"}


def _folder_per_individual(root: str, species: str, dataset: str, split: str = "") -> list[ImageRecord]:
    base = Path(root)
    out: list[ImageRecord] = []
    for ind_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        for img in sorted(ind_dir.iterdir()):
            if img.suffix.lower() in _EXTS:
                out.append(
                    ImageRecord(
                        path=str(img),
                        species=species,
                        individual_id=f"{dataset}:{ind_dir.name}",
                        dataset=dataset,
                        split=split,
                    )
                )
    return out


def parse_dogsworld(root: str) -> list[ImageRecord]:
    return _folder_per_individual(root, "dog", "dogsworld")


def parse_cat_individuals(root: str) -> list[ImageRecord]:
    return _folder_per_individual(root, "cat", "catind")


def parse_dogfacenet(root: str) -> list[ImageRecord]:
    return _folder_per_individual(root, "dog", "dogfacenet", split="eval_only")


def parse_all(data_root: str) -> list[ImageRecord]:
    base = Path(data_root)
    return (
        parse_dogsworld(str(base / "dogs-world"))
        + parse_cat_individuals(str(base / "cat-individuals"))
        + parse_dogfacenet(str(base / "dogfacenet"))
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_parsers.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add machine-learning/pet-recognition-training/src/petid/parsers.py machine-learning/pet-recognition-training/tests/test_parsers.py
git commit -m "feat(petid): per-dataset parsers into unified records"
```

---

### Task 5: Filter + identity split + manifest builder

**Files:**

- Create: `machine-learning/pet-recognition-training/src/petid/manifest.py`
- Test: `machine-learning/pet-recognition-training/tests/test_manifest.py`

**Interfaces:**

- Consumes: `ImageRecord`, `write_manifest` (Task 2); `parse_all` (Task 4).
- Produces:
  - `filter_min_images(records, min_images=2) -> list[ImageRecord]` — drops any `individual_id` with fewer than `min_images` **training-eligible** images (records with `split != "eval_only"`); eval-only records pass through untouched.
  - `split_by_identity(records, test_frac=0.2, seed=0) -> list[ImageRecord]` — assigns `split="train"`/`"test"` per **individual** (all of an individual's images land in the same split) for training-eligible records; eval-only records keep `split="eval_only"`. Split is done **within each species** so both appear in test.
  - `build(data_root, out_path, min_images=2, test_frac=0.2, seed=0) -> list[ImageRecord]` — the CLI entry: parse → filter → split → write.
  - CLI: `python -m petid.manifest build --data-root <dir> --out manifest.json`.

- [ ] **Step 1: Write the failing test (identity-leak is the critical property)**

```python
# tests/test_manifest.py
from petid.manifest import build, filter_min_images, split_by_identity
from petid.parsers import parse_all


def test_filter_drops_singletons(synthetic_data_root):
    recs = parse_all(str(synthetic_data_root))
    kept = filter_min_images(recs, min_images=2)
    ids = {r.individual_id for r in kept}
    assert "dogsworld:dog_singleton" not in ids  # 1 image -> dropped
    assert "dogsworld:dog_A" in ids


def test_split_has_no_identity_leak(synthetic_data_root):
    recs = filter_min_images(parse_all(str(synthetic_data_root)), min_images=2)
    out = split_by_identity(recs, test_frac=0.5, seed=0)
    train_ids = {r.individual_id for r in out if r.split == "train"}
    test_ids = {r.individual_id for r in out if r.split == "test"}
    assert train_ids.isdisjoint(test_ids), "identity appears in both splits — leak!"


def test_eval_only_is_preserved(synthetic_data_root):
    recs = filter_min_images(parse_all(str(synthetic_data_root)), min_images=2)
    out = split_by_identity(recs, test_frac=0.5, seed=0)
    assert any(r.split == "eval_only" and r.dataset == "dogfacenet" for r in out)


def test_build_writes_manifest(synthetic_data_root, tmp_path):
    out = tmp_path / "m.json"
    recs = build(str(synthetic_data_root), str(out), min_images=2, test_frac=0.5, seed=0)
    assert out.exists() and len(recs) > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_manifest.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'petid.manifest'`

- [ ] **Step 3: Write implementation**

```python
# src/petid/manifest.py
import argparse
import random
from collections import defaultdict
from dataclasses import replace

from petid.parsers import parse_all
from petid.records import ImageRecord, write_manifest

_EVAL_ONLY = "eval_only"


def _trainable(r: ImageRecord) -> bool:
    return r.split != _EVAL_ONLY


def filter_min_images(records: list[ImageRecord], min_images: int = 2) -> list[ImageRecord]:
    counts: dict[str, int] = defaultdict(int)
    for r in records:
        if _trainable(r):
            counts[r.individual_id] += 1
    return [r for r in records if not _trainable(r) or counts[r.individual_id] >= min_images]


def split_by_identity(records: list[ImageRecord], test_frac: float = 0.2, seed: int = 0) -> list[ImageRecord]:
    rng = random.Random(seed)
    # group trainable identities by species
    ids_by_species: dict[str, set[str]] = defaultdict(set)
    for r in records:
        if _trainable(r):
            ids_by_species[r.species].add(r.individual_id)

    test_ids: set[str] = set()
    for _species, ids in ids_by_species.items():
        ordered = sorted(ids)
        rng.shuffle(ordered)
        n_test = max(1, round(len(ordered) * test_frac)) if ordered else 0
        test_ids.update(ordered[:n_test])

    out: list[ImageRecord] = []
    for r in records:
        if not _trainable(r):
            out.append(r)
        else:
            out.append(replace(r, split="test" if r.individual_id in test_ids else "train"))
    return out


def build(data_root: str, out_path: str, min_images: int = 2, test_frac: float = 0.2, seed: int = 0) -> list[ImageRecord]:
    recs = split_by_identity(filter_min_images(parse_all(data_root), min_images), test_frac, seed)
    write_manifest(recs, out_path)
    return recs


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--data-root", required=True)
    b.add_argument("--out", required=True)
    b.add_argument("--min-images", type=int, default=2)
    b.add_argument("--test-frac", type=float, default=0.2)
    b.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    recs = build(args.data_root, args.out, args.min_images, args.test_frac, args.seed)
    n_train = sum(1 for r in recs if r.split == "train")
    n_test = sum(1 for r in recs if r.split == "test")
    n_eval = sum(1 for r in recs if r.split == "eval_only")
    print(f"records: {len(recs)}  train={n_train} test={n_test} eval_only={n_eval}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_manifest.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add machine-learning/pet-recognition-training/src/petid/manifest.py machine-learning/pet-recognition-training/tests/test_manifest.py
git commit -m "feat(petid): manifest builder with leak-free identity split"
```

---

### Task 6: Data download script

**Files:**

- Create: `machine-learning/pet-recognition-training/scripts/download_data.sh`

**Interfaces:**

- Produces: populates `$PETID_DATA_ROOT/{dogs-world,cat-individuals,dogfacenet}` from Kaggle + Zenodo. Not unit-tested (network + credentials); validated by a dry structure check.

- [ ] **Step 1: Write the script**

```bash
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
```

- [ ] **Step 2: Make executable and dry-check structure expectation**

Run: `chmod +x scripts/download_data.sh && bash -n scripts/download_data.sh && echo "syntax ok"`
Expected: prints `syntax ok` (syntax-only check; do not run the real download in tests).

- [ ] **Step 3: Commit**

```bash
git add machine-learning/pet-recognition-training/scripts/download_data.sh
git commit -m "chore(petid): dataset download script (kaggle + zenodo)"
```

---

### Task 7: Torch dataset + transforms

**Files:**

- Create: `machine-learning/pet-recognition-training/src/petid/dataset.py`
- Test: `machine-learning/pet-recognition-training/tests/test_dataset.py`

**Interfaces:**

- Consumes: `ImageRecord`, `read_manifest` (Task 2); `synthetic_data_root` (Task 3); `build` (Task 5).
- Produces:
  - `IMAGENET_MEAN`, `IMAGENET_STD` (tuples).
  - `build_transform(train: bool) -> Callable[[PIL.Image], torch.Tensor]` — resize 224×224, to tensor, ImageNet-normalize; train adds horizontal flip + mild color jitter.
  - `PetDataset(records, label_map, train) ` — a `torch.utils.data.Dataset` yielding `(tensor[3,224,224], label_int)`. `label_map: dict[str,int]` maps `individual_id -> contiguous class index`.
  - `label_map_for(records) -> dict[str,int]` — contiguous indices over train identities (sorted, deterministic).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_dataset.py
import torch

from petid.dataset import PetDataset, build_transform, label_map_for
from petid.manifest import build


def _train_recs(synthetic_data_root, tmp_path):
    out = tmp_path / "m.json"
    recs = build(str(synthetic_data_root), str(out), min_images=2, test_frac=0.5, seed=0)
    return [r for r in recs if r.split == "train"]


def test_transform_shape_and_norm():
    from PIL import Image

    t = build_transform(train=False)
    x = t(Image.new("RGB", (50, 30), (128, 128, 128)))
    assert x.shape == (3, 224, 224) and x.dtype == torch.float32


def test_dataset_yields_tensor_and_label(synthetic_data_root, tmp_path):
    recs = _train_recs(synthetic_data_root, tmp_path)
    lm = label_map_for(recs)
    ds = PetDataset(recs, lm, train=True)
    x, y = ds[0]
    assert x.shape == (3, 224, 224)
    assert 0 <= y < len(lm)


def test_label_map_is_contiguous(synthetic_data_root, tmp_path):
    recs = _train_recs(synthetic_data_root, tmp_path)
    lm = label_map_for(recs)
    assert sorted(lm.values()) == list(range(len(lm)))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_dataset.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'petid.dataset'`

- [ ] **Step 3: Write implementation**

```python
# src/petid/dataset.py
from collections.abc import Callable

import torch
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms  # torchvision ships with torch

from petid.records import ImageRecord

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def build_transform(train: bool) -> Callable[[Image.Image], torch.Tensor]:
    ops: list = [transforms.Resize((224, 224))]
    if train:
        ops += [transforms.RandomHorizontalFlip(), transforms.ColorJitter(0.2, 0.2, 0.2)]
    ops += [transforms.ToTensor(), transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD)]
    return transforms.Compose(ops)


def label_map_for(records: list[ImageRecord]) -> dict[str, int]:
    ids = sorted({r.individual_id for r in records})
    return {ind: i for i, ind in enumerate(ids)}


class PetDataset(Dataset):
    def __init__(self, records: list[ImageRecord], label_map: dict[str, int], train: bool):
        self.records = records
        self.label_map = label_map
        self.transform = build_transform(train)

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, i: int) -> tuple[torch.Tensor, int]:
        r = self.records[i]
        img = Image.open(r.path).convert("RGB")
        return self.transform(img), self.label_map[r.individual_id]
```

Note: `torchvision` is already declared in Task 1's `pyproject.toml`; if the venv predates that, run `uv sync --extra dev` before running the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_dataset.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add machine-learning/pet-recognition-training/src/petid/dataset.py machine-learning/pet-recognition-training/tests/test_dataset.py
git commit -m "feat(petid): torch dataset and whole-animal transforms"
```

---

### Task 8: Model — DINOv2 embedder + ArcFace head

**Files:**

- Create: `machine-learning/pet-recognition-training/src/petid/model.py`
- Test: `machine-learning/pet-recognition-training/tests/test_model.py`

**Interfaces:**

- Produces:
  - `PetEmbedder(pretrained: bool = True)` — `nn.Module`; `forward(x[N,3,224,224]) -> emb[N,384]` **L2-normalized**. Loads `facebook/dinov2-small` when `pretrained`, else random-init config (for fast tests). `.backbone` is the DINOv2 module (so callers can freeze it).
  - `ArcMarginProduct(in_features=384, out_features, s=30.0, m=0.5)` — `nn.Module`; `forward(emb[N,384], labels[N]) -> logits[N,out_features]`. Standard additive-angular-margin (Deng et al.).
  - `EMBED_DIM = 384`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_model.py
import torch

from petid.model import ArcMarginProduct, PetEmbedder, EMBED_DIM


def test_embedder_output_is_normalized():
    m = PetEmbedder(pretrained=False).eval()
    with torch.no_grad():
        emb = m(torch.randn(2, 3, 224, 224))
    assert emb.shape == (2, EMBED_DIM)
    norms = emb.norm(dim=1)
    assert torch.allclose(norms, torch.ones(2), atol=1e-4)


def test_arcface_logits_shape_and_grad():
    head = ArcMarginProduct(EMBED_DIM, out_features=5)
    emb = torch.randn(4, EMBED_DIM, requires_grad=True)
    labels = torch.tensor([0, 1, 2, 3])
    logits = head(emb, labels)
    assert logits.shape == (4, 5)
    logits.sum().backward()
    assert emb.grad is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_model.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'petid.model'`

- [ ] **Step 3: Write implementation**

```python
# src/petid/model.py
import math

import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import Dinov2Config, Dinov2Model

EMBED_DIM = 384


class PetEmbedder(nn.Module):
    def __init__(self, pretrained: bool = True):
        super().__init__()
        if pretrained:
            self.backbone = Dinov2Model.from_pretrained("facebook/dinov2-small")
        else:
            # image_size=518 matches facebook/dinov2-small's config so a checkpoint trained
            # with pretrained=True loads cleanly via load_state_dict (position-embedding shapes
            # match); DINOv2 interpolates pos-encodings at runtime, so 224x224 input still works.
            self.backbone = Dinov2Model(
                Dinov2Config(hidden_size=EMBED_DIM, num_hidden_layers=12, num_attention_heads=6, patch_size=14, image_size=518)
            )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        emb = self.backbone(x).pooler_output  # [N, 384]
        return F.normalize(emb, dim=1)


class ArcMarginProduct(nn.Module):
    def __init__(self, in_features: int, out_features: int, s: float = 30.0, m: float = 0.5):
        super().__init__()
        self.s = s
        self.weight = nn.Parameter(torch.empty(out_features, in_features))
        nn.init.xavier_uniform_(self.weight)
        self.cos_m = math.cos(m)
        self.sin_m = math.sin(m)
        self.th = math.cos(math.pi - m)  # threshold: cos(pi - m)
        self.mm = math.sin(math.pi - m) * m  # linear fallback below threshold

    def forward(self, emb: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        cosine = F.linear(F.normalize(emb, dim=1), F.normalize(self.weight, dim=1)).clamp(-1.0, 1.0)
        # Standard ArcFace with the threshold/easy-margin guard: avoids the acos
        # non-monotonicity + infinite-gradient instability when the target cosine < cos(pi - m).
        sine = torch.sqrt((1.0 - cosine**2).clamp(min=1e-9))
        phi = cosine * self.cos_m - sine * self.sin_m  # = cos(theta + m)
        phi = torch.where(cosine > self.th, phi, cosine - self.mm)  # monotonicity guard
        one_hot = F.one_hot(labels, num_classes=self.weight.shape[0]).float()
        return torch.where(one_hot.bool(), phi, cosine) * self.s
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_model.py -v`
Expected: PASS (2 passed). First run downloads no weights (uses `pretrained=False`).

- [ ] **Step 5: Commit**

```bash
git add machine-learning/pet-recognition-training/src/petid/model.py machine-learning/pet-recognition-training/tests/test_model.py
git commit -m "feat(petid): DINOv2 embedder and ArcFace head"
```

---

### Task 9: Metrics — verification, identification, clustering

**Files:**

- Create: `machine-learning/pet-recognition-training/src/petid/metrics.py`
- Test: `machine-learning/pet-recognition-training/tests/test_metrics.py`

**Interfaces:**

- Produces (all operate on L2-normalized `emb: np.ndarray[N,D]` + `ids: np.ndarray[N]` int):
  - `verification_scores(emb, ids) -> tuple[roc_auc: float, eer: float]` — all-pairs cosine, genuine vs impostor.
  - `identification(emb, ids) -> tuple[top1: float, map: float]` — leave-one-out gallery/probe.
  - `clustering_quality(emb, ids, distance_threshold) -> tuple[homogeneity: float, completeness: float]` — agglomerative clustering on cosine distance at `distance_threshold`.
  - Correctness is the point of this task — perfectly-separable synthetic embeddings must score ~1.0, random must score near chance.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_metrics.py
import numpy as np

from petid.metrics import clustering_quality, identification, verification_scores


def _separable():
    # 3 identities, 4 imgs each, near-duplicate embeddings per identity
    rng = np.random.default_rng(0)
    centers = np.eye(3)[:, :3]
    emb, ids = [], []
    for k in range(3):
        base = np.concatenate([centers[k], np.zeros(5)])
        for _ in range(4):
            v = base + rng.normal(0, 1e-3, size=8)
            emb.append(v / np.linalg.norm(v))
            ids.append(k)
    return np.array(emb), np.array(ids)


def test_verification_perfect_on_separable():
    emb, ids = _separable()
    auc, eer = verification_scores(emb, ids)
    assert auc > 0.99 and eer < 0.02


def test_identification_perfect_on_separable():
    emb, ids = _separable()
    top1, mAP = identification(emb, ids)
    assert top1 > 0.99 and mAP > 0.99


def test_clustering_recovers_groups():
    emb, ids = _separable()
    hom, comp = clustering_quality(emb, ids, distance_threshold=0.5)
    assert hom > 0.99 and comp > 0.99
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_metrics.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'petid.metrics'`

- [ ] **Step 3: Write implementation**

```python
# src/petid/metrics.py
import numpy as np
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import homogeneity_completeness_v_measure, roc_auc_score


def _cosine_matrix(emb: np.ndarray) -> np.ndarray:
    return emb @ emb.T


def verification_scores(emb: np.ndarray, ids: np.ndarray) -> tuple[float, float]:
    sim = _cosine_matrix(emb)
    iu = np.triu_indices(len(ids), k=1)
    scores = sim[iu]
    labels = (ids[iu[0]] == ids[iu[1]]).astype(int)
    auc = float(roc_auc_score(labels, scores))
    # EER: sweep thresholds, find |FAR - FRR| minimum
    order = np.argsort(-scores)
    s_sorted, l_sorted = scores[order], labels[order]
    P, N = l_sorted.sum(), len(l_sorted) - l_sorted.sum()
    tp = np.cumsum(l_sorted)
    fp = np.cumsum(1 - l_sorted)
    frr = 1 - tp / max(P, 1)
    far = fp / max(N, 1)
    idx = int(np.argmin(np.abs(far - frr)))  # EER = threshold where FAR crosses FRR
    eer = float((far[idx] + frr[idx]) / 2)
    return auc, eer


def identification(emb: np.ndarray, ids: np.ndarray) -> tuple[float, float]:
    sim = _cosine_matrix(emb)
    np.fill_diagonal(sim, -np.inf)  # leave-one-out
    n = len(ids)
    top1_hits, aps = 0, []
    for i in range(n):
        # -inf on the diagonal guarantees self sorts last; drop it so the probe
        # is never scored against itself as a gallery entry.
        order = np.argsort(-sim[i])[:-1]
        rel = (ids[order] == ids[i]).astype(int)
        if rel[0] == 1:
            top1_hits += 1
        # average precision
        cum = np.cumsum(rel)
        ranks = np.arange(1, n)
        precision_at_hits = cum[rel == 1] / ranks[rel == 1]
        aps.append(precision_at_hits.mean() if rel.sum() else 0.0)
    return top1_hits / n, float(np.mean(aps))


def clustering_quality(emb: np.ndarray, ids: np.ndarray, distance_threshold: float) -> tuple[float, float]:
    clusterer = AgglomerativeClustering(
        n_clusters=None, metric="cosine", linkage="average", distance_threshold=distance_threshold
    )
    pred = clusterer.fit_predict(emb)
    hom, comp, _v = homogeneity_completeness_v_measure(ids, pred)
    return float(hom), float(comp)
```

Note: remove the placeholder EER line during implementation; the correct EER is the second assignment (`idx`-based). Kept adjacent so the engineer sees the intended final value.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_metrics.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add machine-learning/pet-recognition-training/src/petid/metrics.py machine-learning/pet-recognition-training/tests/test_metrics.py
git commit -m "feat(petid): verification, identification, clustering metrics"
```

---

### Task 10: Training runner (zero-shot / head / full)

**Files:**

- Create: `machine-learning/pet-recognition-training/src/petid/train.py`
- Test: `machine-learning/pet-recognition-training/tests/test_train.py`

**Interfaces:**

- Consumes: `PetEmbedder`, `ArcMarginProduct` (Task 8); `PetDataset`, `label_map_for` (Task 7); `read_manifest` (Task 2).
- Produces:
  - `train_run(manifest, out_dir, config, epochs, batch, bf16, device, limit=None) -> str` — trains per `config in {"zeroshot","head","full"}`, writes `<out_dir>/best.pt` containing `{"embedder": state_dict, "config": config}`, returns the checkpoint path. `zeroshot` skips optimization and just saves pretrained weights. `head` freezes `embedder.backbone`. `limit` caps records (for the smoke test).
  - CLI: `python -m petid.train --config full --manifest manifest.json --out runs/full [--epochs N --batch B --bf16]`.

- [ ] **Step 1: Write the failing smoke test (tiny synthetic, 2 steps)**

```python
# tests/test_train.py
import torch

from petid.manifest import build
from petid.train import train_run


def test_head_config_smoke(synthetic_data_root, tmp_path):
    manifest = tmp_path / "m.json"
    build(str(synthetic_data_root), str(manifest), min_images=2, test_frac=0.5, seed=0)
    ckpt = train_run(
        str(manifest), str(tmp_path / "run"), config="head", epochs=1, batch=2, bf16=False, device="cpu", limit=6
    )
    blob = torch.load(ckpt, map_location="cpu")
    assert "embedder" in blob and blob["config"] == "head"


def test_zeroshot_saves_without_training(synthetic_data_root, tmp_path):
    manifest = tmp_path / "m.json"
    build(str(synthetic_data_root), str(manifest), min_images=2, test_frac=0.5, seed=0)
    ckpt = train_run(
        str(manifest), str(tmp_path / "z"), config="zeroshot", epochs=1, batch=2, bf16=False, device="cpu", limit=6
    )
    assert torch.load(ckpt, map_location="cpu")["config"] == "zeroshot"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_train.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'petid.train'`

- [ ] **Step 3: Write implementation**

```python
# src/petid/train.py
import argparse
import contextlib
import os

import torch
from torch.utils.data import DataLoader

from petid.dataset import PetDataset, label_map_for
from petid.model import ArcMarginProduct, PetEmbedder
from petid.records import read_manifest


def train_run(
    manifest: str,
    out_dir: str,
    config: str,
    epochs: int,
    batch: int,
    bf16: bool,
    device: str,
    limit: int | None = None,
) -> str:
    os.makedirs(out_dir, exist_ok=True)
    recs = [r for r in read_manifest(manifest) if r.split == "train"]
    if limit:
        recs = recs[:limit]
    label_map = label_map_for(recs)

    # Always start from the pretrained DINOv2 backbone (zeroshot = pretrained weights, no head training).
    embedder = PetEmbedder(pretrained=True).to(device)
    ckpt_path = os.path.join(out_dir, "best.pt")

    if config == "zeroshot":
        torch.save({"embedder": embedder.state_dict(), "config": config}, ckpt_path)
        return ckpt_path

    if config == "head":
        for p in embedder.backbone.parameters():
            p.requires_grad_(False)

    head = ArcMarginProduct(384, out_features=len(label_map)).to(device)
    params = [p for p in embedder.parameters() if p.requires_grad] + list(head.parameters())
    opt = torch.optim.AdamW(params, lr=1e-4)
    loss_fn = torch.nn.CrossEntropyLoss()
    loader = DataLoader(PetDataset(recs, label_map, train=True), batch_size=batch, shuffle=True)

    def ctx():
        return torch.autocast(device_type=device, dtype=torch.bfloat16) if bf16 else contextlib.nullcontext()

    embedder.train()
    for _epoch in range(epochs):
        for x, y in loader:
            x, y = x.to(device), y.to(device)
            opt.zero_grad()
            with ctx():
                loss = loss_fn(head(embedder(x), y), y)
            loss.backward()
            opt.step()
    torch.save({"embedder": embedder.state_dict(), "config": config}, ckpt_path)
    return ckpt_path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", choices=["zeroshot", "head", "full"], required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--bf16", action="store_true")
    ap.add_argument("--device", default="mps")
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    path = train_run(a.manifest, a.out, a.config, a.epochs, a.batch, a.bf16, a.device, a.limit)
    print(f"checkpoint: {path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_train.py -v`
Expected: PASS (2 passed). (Downloads `facebook/dinov2-small` weights on first run — allow network.)

- [ ] **Step 5: Commit**

```bash
git add machine-learning/pet-recognition-training/src/petid/train.py machine-learning/pet-recognition-training/tests/test_train.py
git commit -m "feat(petid): training runner for zeroshot/head/full configs"
```

---

### Task 11: Evaluation runner + report

**Files:**

- Create: `machine-learning/pet-recognition-training/src/petid/evaluate.py`
- Test: extend `machine-learning/pet-recognition-training/tests/test_train.py` with an eval smoke test

**Interfaces:**

- Consumes: `PetEmbedder` (Task 8); metrics (Task 9); `PetDataset`/`build_transform` (Task 7); `read_manifest` (Task 2).
- Produces:
  - `embed_records(records, checkpoint, device, batch=64) -> tuple[np.ndarray, np.ndarray, np.ndarray]` — returns `(emb[N,384], species[N] object, ids[N] int)` for the given records using the checkpoint's embedder.
  - `evaluate(manifest, checkpoint, out_md, device) -> dict` — computes per-species metrics on `split=="test"` records (plus the DogFaceNet `eval_only` dog set as a second dog eval), writes a markdown report, returns the metrics dict.
  - CLI: `python -m petid.evaluate --manifest manifest.json --checkpoint runs/full/best.pt --out runs/full/report.md`.

- [ ] **Step 1: Write the failing smoke test**

```python
# append to tests/test_train.py
from petid.evaluate import evaluate


def test_evaluate_smoke(synthetic_data_root, tmp_path):
    manifest = tmp_path / "m.json"
    build(str(synthetic_data_root), str(manifest), min_images=2, test_frac=0.5, seed=0)
    ckpt = train_run(
        str(manifest), str(tmp_path / "z"), config="zeroshot", epochs=1, batch=2, bf16=False, device="cpu", limit=6
    )
    report = tmp_path / "report.md"
    result = evaluate(str(manifest), ckpt, str(report), device="cpu")
    assert report.exists()
    assert "dog" in result or "cat" in result  # at least one species evaluated
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_train.py::test_evaluate_smoke -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'petid.evaluate'`

- [ ] **Step 3: Write implementation**

```python
# src/petid/evaluate.py
import argparse

import numpy as np
import torch
from PIL import Image

from petid.dataset import build_transform
from petid.metrics import clustering_quality, identification, verification_scores
from petid.model import PetEmbedder
from petid.records import ImageRecord, read_manifest


def embed_records(records: list[ImageRecord], checkpoint: str, device: str, batch: int = 64):
    blob = torch.load(checkpoint, map_location=device)
    model = PetEmbedder(pretrained=False).to(device)
    model.load_state_dict(blob["embedder"])
    model.eval()
    tf = build_transform(train=False)

    id_to_int: dict[str, int] = {}
    embs, species, ids = [], [], []
    with torch.no_grad():
        for start in range(0, len(records), batch):
            chunk = records[start : start + batch]
            xs = torch.stack([tf(Image.open(r.path).convert("RGB")) for r in chunk]).to(device)
            out = model(xs).cpu().numpy()
            for r, e in zip(chunk, out):
                embs.append(e)
                species.append(r.species)
                ids.append(id_to_int.setdefault(r.individual_id, len(id_to_int)))
    return np.array(embs), np.array(species, dtype=object), np.array(ids)


def _metrics_for(emb, ids) -> dict:
    if len(set(ids.tolist())) < 2:
        return {"note": "insufficient identities to score", "n": int(len(ids))}
    auc, eer = verification_scores(emb, ids)
    top1, mAP = identification(emb, ids)
    hom, comp = clustering_quality(emb, ids, distance_threshold=0.5)
    return {"n": int(len(ids)), "auc": auc, "eer": eer, "top1": top1, "map": mAP, "homogeneity": hom, "completeness": comp}


def evaluate(manifest: str, checkpoint: str, out_md: str, device: str) -> dict:
    recs = read_manifest(manifest)
    test = [r for r in recs if r.split == "test"]
    dfn = [r for r in recs if r.split == "eval_only"]

    result: dict = {}
    for species in ("dog", "cat"):
        sp = [r for r in test if r.species == species]
        if sp:
            emb, _spv, ids = embed_records(sp, checkpoint, device)
            result[species] = _metrics_for(emb, ids)
    if dfn:
        emb, _spv, ids = embed_records(dfn, checkpoint, device)
        result["dog_dogfacenet_eval"] = _metrics_for(emb, ids)

    with open(out_md, "w") as f:
        f.write(f"# Pet Re-ID Eval — {checkpoint}\n\n")
        f.write("| Split | N | AUC | EER | Top-1 | mAP | Homog. | Compl. |\n")
        f.write("| --- | --- | --- | --- | --- | --- | --- | --- |\n")
        for name, m in result.items():
            if "auc" in m:
                f.write(
                    f"| {name} | {m['n']} | {m['auc']:.3f} | {m['eer']:.3f} | {m['top1']:.3f} | "
                    f"{m['map']:.3f} | {m['homogeneity']:.3f} | {m['completeness']:.3f} |\n"
                )
            else:
                f.write(f"| {name} | {m.get('n', 0)} | — | — | — | — | — | — |\n")
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="mps")
    a = ap.parse_args()
    res = evaluate(a.manifest, a.checkpoint, a.out, a.device)
    print(res)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_train.py::test_evaluate_smoke -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add machine-learning/pet-recognition-training/src/petid/evaluate.py machine-learning/pet-recognition-training/tests/test_train.py
git commit -m "feat(petid): per-species evaluation runner and report"
```

---

### Task 12: ONNX export + parity

**Files:**

- Create: `machine-learning/pet-recognition-training/src/petid/export_onnx.py`
- Test: `machine-learning/pet-recognition-training/tests/test_export.py`

**Interfaces:**

- Consumes: `PetEmbedder` (Task 8).
- Produces:
  - `export(checkpoint, out_onnx, device="cpu") -> str` — exports the embedder (input `[N,3,224,224]`, dynamic batch, output `[N,384]` normalized), opset 17, returns path.
  - `parity(checkpoint, onnx_path, device="cpu", atol=1e-3) -> float` — returns max abs diff between torch and onnxruntime embeddings on a random batch; used in the test with an assertion.
  - CLI: `python -m petid.export_onnx --checkpoint runs/full/best.pt --out runs/full/pet_embedder.onnx`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_export.py
import torch

from petid.export_onnx import export, parity
from petid.model import PetEmbedder


def test_export_and_parity(tmp_path):
    ckpt = tmp_path / "best.pt"
    torch.save({"embedder": PetEmbedder(pretrained=False).state_dict(), "config": "full"}, ckpt)
    onnx_path = tmp_path / "m.onnx"
    export(str(ckpt), str(onnx_path), device="cpu")
    assert onnx_path.exists()
    max_diff = parity(str(ckpt), str(onnx_path), device="cpu")
    assert max_diff < 1e-3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_export.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'petid.export_onnx'`

- [ ] **Step 3: Add `onnxruntime` dep, then write implementation**

Add `"onnxruntime>=1.20"` to `pyproject.toml` dependencies and run `uv sync --extra dev`.

```python
# src/petid/export_onnx.py
import argparse

import numpy as np
import onnxruntime as ort
import torch

from petid.model import PetEmbedder


def _load(checkpoint: str, device: str) -> PetEmbedder:
    blob = torch.load(checkpoint, map_location=device)
    m = PetEmbedder(pretrained=False).to(device)
    m.load_state_dict(blob["embedder"])
    m.eval()
    return m


def export(checkpoint: str, out_onnx: str, device: str = "cpu") -> str:
    model = _load(checkpoint, device)
    dummy = torch.randn(1, 3, 224, 224, device=device)
    torch.onnx.export(
        model,
        dummy,
        out_onnx,
        input_names=["input"],
        output_names=["embedding"],
        dynamic_axes={"input": {0: "batch"}, "embedding": {0: "batch"}},
        opset_version=17,
    )
    return out_onnx


def parity(checkpoint: str, onnx_path: str, device: str = "cpu", atol: float = 1e-3) -> float:
    model = _load(checkpoint, device)
    x = torch.randn(3, 3, 224, 224, device=device)
    with torch.no_grad():
        torch_out = model(x).cpu().numpy()
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    ort_out = sess.run(["embedding"], {"input": x.cpu().numpy()})[0]
    return float(np.abs(torch_out - ort_out).max())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    path = export(a.checkpoint, a.out)
    diff = parity(a.checkpoint, a.out)
    print(f"exported {path}  parity_max_diff={diff:.2e}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_export.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add machine-learning/pet-recognition-training/src/petid/export_onnx.py machine-learning/pet-recognition-training/tests/test_export.py machine-learning/pet-recognition-training/pyproject.toml
git commit -m "feat(petid): ONNX export with torch/ort parity check"
```

---

### Task 13: Attribution manifest + full test pass

**Files:**

- Create: `machine-learning/pet-recognition-training/ATTRIBUTION.md`

**Interfaces:**

- Produces: the CC-BY attribution required by the dataset licenses (DogFaceNet, Cat Individual Images) and the CC0/Apache notices, so the shipped model is license-compliant.

- [ ] **Step 1: Write `ATTRIBUTION.md`**

```markdown
# Dataset Attribution

This model was trained/evaluated on the following commercially-licensed datasets.

## Dogs-World — CC0 1.0 (Public Domain)

Source: https://www.kaggle.com/datasets/lextoumbourou/dogs-world

## Cat Individual Images — CC-BY-4.0

Source: https://www.kaggle.com/datasets/timost1234/cat-individuals
Licensed under CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/). Used
for training an individual-cat recognition model; images resized to 224×224.
Changes: cropped/resized for model input.

## DogFaceNet — CC-BY-4.0 (evaluation only)

Source: https://zenodo.org/records/12578449
Licensed under CC-BY-4.0. Used as a held-out evaluation set only.
Changes: none to the images.

## Base model — facebook/dinov2-small — Apache-2.0

Source: https://huggingface.co/facebook/dinov2-small

## Excluded (non-commercial / disallowed)

PetFace and any PetFace-derived model (e.g. AvitoTech) and MegaDescriptor
(CC-BY-NC) are NOT used — commercially incompatible.
```

- [ ] **Step 2: Run the full test suite**

Run: `uv run pytest -v`
Expected: all tests pass (records, parsers, manifest, dataset, model, metrics, train, evaluate, export).

- [ ] **Step 3: Commit**

```bash
git add machine-learning/pet-recognition-training/ATTRIBUTION.md
git commit -m "docs(petid): dataset attribution and license manifest"
```

---

### Task 14: Real end-to-end run (manual, produces the go/no-go)

**Files:** none (execution + report only).

**Interfaces:** Consumes everything above. This is the actual spike — not unit-testable; it produces the report the whole Phase 1 exists for. Run on the M5 Max.

- [ ] **Step 1: Download data**

Run: `export PETID_DATA_ROOT=<scratchpad>/petid-data && bash scripts/download_data.sh`
Expected: `$PETID_DATA_ROOT/{dogs-world,cat-individuals,dogfacenet}` populated.

- [ ] **Step 2: Build manifest, inspect real counts**

Run: `uv run python -m petid.manifest build --data-root "$PETID_DATA_ROOT" --out manifest.json`
Expected: prints `records: … train=… test=… eval_only=…`. **Record the real dog/cat identity counts** — this resolves the Dogs-World singleton-skew and LCW open questions from the spec.

- [ ] **Step 3: Run the three configs**

Run:

```bash
uv run python -m petid.train --config zeroshot --manifest manifest.json --out runs/zeroshot --device mps
uv run python -m petid.train --config head --manifest manifest.json --out runs/head --bf16 --device mps
uv run python -m petid.train --config full --manifest manifest.json --out runs/full --epochs 15 --batch 128 --bf16 --device mps
```

Expected: three `best.pt` checkpoints. Full run ≈ 6–8 h (per the measured benchmark).

- [ ] **Step 4: Evaluate all three**

Run:

```bash
for c in zeroshot head full; do
  uv run python -m petid.evaluate --manifest manifest.json --checkpoint runs/$c/best.pt --out runs/$c/report.md --device mps
done
```

Expected: three per-species reports. **The go/no-go read:** does `full` beat `zeroshot` on dog EER/Top-1 by a material margin, and does dog clustering homogeneity/completeness look usable at a conservative threshold?

- [ ] **Step 5: Export the winning model to ONNX**

Run: `uv run python -m petid.export_onnx --checkpoint runs/full/best.pt --out runs/full/pet_embedder.onnx`
Expected: `parity_max_diff` < 1e-3.

- [ ] **Step 6: Write the Phase 1 findings report and commit it**

Create `docs/superpowers/plans/2026-07-24-pet-recognition-phase1-RESULTS.md` summarizing: real data counts, the three-config per-species metrics table, the dog go/no-go decision, cat verdict, the recommended clustering threshold, and the **Phase 2 recommendation** (384-vs-512 embedding-dim decision, whether to enable cat). Commit:

```bash
git add docs/superpowers/plans/2026-07-24-pet-recognition-phase1-RESULTS.md
git commit -m "docs(petid): Phase 1 training-spike results and go/no-go"
```

---

## Self-Review

**Spec coverage:**

- Roll-our-own dinov2-small + ArcFace → Task 8. ✅
- Whole-animal crops, DogFaceNet eval-only → Tasks 4 (`split="eval_only"`), 5, 7, 11. ✅
- License-clean datasets only + attribution → Tasks 6, 13. ✅
- Split by individual (no leak) → Task 5 (`test_split_has_no_identity_leak`). ✅
- Three configs (zero-shot/head/full) → Tasks 10, 14. ✅
- Per-species metrics (EER/AUC/Top-1/mAP) + clustering-realism → Tasks 9, 11. ✅
- ONNX export + documented contract → Task 12 (contract in Global Constraints). ✅
- Deliverables: pipeline (Tasks 1–13), weights+ONNX (12, 14), report (14), attribution (13), Phase 2 appendix (14 Step 6). ✅
- Measured throughput / local M5 Max run → Task 14. ✅

**Placeholder scan:** One intentional teaching note in Task 9 Step 3 (the EER placeholder line) is explicitly called out to be removed; every other step has complete code. No TBD/TODO.

**Type consistency:** `ImageRecord` fields, `individual_id` prefixing, `EMBED_DIM=384`, checkpoint blob shape `{"embedder", "config"}`, and metric return tuples are consistent across Tasks 2–12. `train_run`/`evaluate`/`export` signatures match their CLI `main()` callers.

**Open items deferred to results (by design):** exact dog go/no-go threshold and whether to include LCW/cat are decided from Task 14's measured numbers, per the spec.
