import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass

import numpy as np


@dataclass(frozen=True)
class ImageRecord:
    path: str
    species: str
    individual_id: str
    dataset: str
    split: str = ""


def write_manifest(records: list[ImageRecord], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"records": [asdict(r) for r in records]}, f, indent=2)


def read_manifest(path: str) -> list[ImageRecord]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return [ImageRecord(**r) for r in data["records"]]


def ids_to_int(records: Sequence[ImageRecord]) -> np.ndarray:
    """Contiguous integer labels, numbered in first-appearance order."""
    seen: dict[str, int] = {}
    return np.array([seen.setdefault(r.individual_id, len(seen)) for r in records])
