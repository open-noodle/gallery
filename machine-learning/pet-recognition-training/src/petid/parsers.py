# src/petid/parsers.py
import json
from pathlib import Path

from petid.records import ImageRecord

_EXTS = {".jpg", ".jpeg", ".png"}


def _folder_per_individual(root: str, species: str, dataset: str, split: str = "") -> list[ImageRecord]:
    base = Path(root)
    out: list[ImageRecord] = []
    if not base.is_dir():
        return out
    for ind_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        for img in sorted(ind_dir.iterdir()):
            if img.is_file() and img.suffix.lower() in _EXTS:
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
    """Dogs-World ships a flat ``images/`` folder plus ``metadata/<hash>.json``. Each
    metadata file records the image's dog(s) in ``identities`` and the image ``path``.
    We keep only single-dog images (``identities`` length 1) so every record is an
    unambiguous individual (multi-dog photos have no per-dog crop, so they're dropped)."""
    base = Path(root)
    meta_dir = base / "metadata"
    out: list[ImageRecord] = []
    if not meta_dir.is_dir():
        return out
    for mj in sorted(meta_dir.glob("*.json")):
        try:
            d = json.loads(mj.read_text())
        except (ValueError, OSError):
            continue
        idents = d.get("identities") or []
        rel = d.get("path")
        if len(idents) != 1 or not rel:
            continue
        img_path = base / rel
        if not img_path.is_file():
            continue
        out.append(
            ImageRecord(
                path=str(img_path),
                species="dog",
                individual_id=f"dogsworld:{idents[0]['identity']}",
                dataset="dogsworld",
                split="",
            )
        )
    return out


def parse_cat_individuals(root: str) -> list[ImageRecord]:
    """Cat Individual Images unzips to ``cat_individuals_dataset/<cat_id>/<img>``."""
    base = Path(root)
    nested = base / "cat_individuals_dataset"
    if nested.is_dir():
        base = nested
    return _folder_per_individual(str(base), "cat", "catind")


def parse_dogfacenet(root: str) -> list[ImageRecord]:
    """DogFaceNet (eval-only, aligned faces): folder-per-dog. Descends through a single
    wrapper directory if the archive unzipped into one (e.g. ``DogFaceNet_224resized/``)."""
    base = Path(root)
    if base.is_dir():
        subs = [p for p in base.iterdir() if p.is_dir()]
        images_directly_here = any(
            any(f.is_file() and f.suffix.lower() in _EXTS for f in s.iterdir()) for s in subs[:3]
        )
        if len(subs) == 1 and not images_directly_here:
            base = subs[0]
    return _folder_per_individual(str(base), "dog", "dogfacenet", split="eval_only")


def parse_all(data_root: str) -> list[ImageRecord]:
    base = Path(data_root)
    return (
        parse_dogsworld(str(base / "dogs-world"))
        + parse_cat_individuals(str(base / "cat-individuals"))
        + parse_dogfacenet(str(base / "dogfacenet"))
    )
