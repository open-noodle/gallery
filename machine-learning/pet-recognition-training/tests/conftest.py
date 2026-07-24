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
