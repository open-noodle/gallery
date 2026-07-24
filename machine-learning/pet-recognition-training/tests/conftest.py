# tests/conftest.py
import json
from pathlib import Path

import pytest
from PIL import Image


def _img(path: Path, color: tuple[int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), color).save(path)


def _dogsworld_image(dw: Path, hash_: str, identities: list[str], color: tuple[int, int, int]) -> None:
    """Write a Dogs-World image plus its metadata sidecar mapping the image to its dog(s)."""
    _img(dw / "images" / f"{hash_}.png", color)
    meta = dw / "metadata" / f"{hash_}.json"
    meta.parent.mkdir(parents=True, exist_ok=True)
    meta.write_text(
        json.dumps(
            {
                "identities": [{"name": i, "identity": i} for i in identities],
                "path": f"images/{hash_}.png",
            }
        )
    )


@pytest.fixture
def synthetic_data_root(tmp_path) -> Path:
    root = tmp_path / "data"
    # Dogs-World: flat images/ + metadata/<hash>.json mapping each image to its dog(s).
    dw = root / "dogs-world"
    _dogsworld_image(dw, "h1", ["dog_A"], (10, 0, 0))
    _dogsworld_image(dw, "h2", ["dog_A"], (20, 0, 0))
    _dogsworld_image(dw, "h3", ["dog_A"], (30, 0, 0))
    _dogsworld_image(dw, "h4", ["dog_B"], (40, 0, 0))
    _dogsworld_image(dw, "h5", ["dog_B"], (50, 0, 0))
    _dogsworld_image(dw, "h6", ["dog_singleton"], (60, 0, 0))
    # multi-dog image: two identities -> the parser must SKIP it (ambiguous for re-ID).
    _dogsworld_image(dw, "h7", ["dog_A", "dog_B"], (70, 0, 0))
    # Cat Individual Images: cat_individuals_dataset/<cat_id>/<img>.jpg (nested one level).
    for cat, n in [("cat_A", 3), ("cat_B", 2)]:
        for i in range(n):
            _img(root / "cat-individuals" / "cat_individuals_dataset" / cat / f"{cat}_{i}.jpg", (0, i * 10, 0))
    # DogFaceNet resized: <root>/dogfacenet/<dog_id>/<img>.jpg (eval-only, aligned faces).
    for dog, n in [("dfn_1", 2), ("dfn_2", 2)]:
        for i in range(n):
            _img(root / "dogfacenet" / dog / f"{i}.jpg", (0, 0, i * 10))
    return root
