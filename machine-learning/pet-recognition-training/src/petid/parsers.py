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
