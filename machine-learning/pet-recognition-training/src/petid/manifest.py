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
