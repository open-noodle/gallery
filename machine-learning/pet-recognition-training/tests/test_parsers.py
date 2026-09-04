# tests/test_parsers.py
from pathlib import Path

from petid.parsers import parse_all, parse_dogfacenet, parse_dogsworld


def test_dogsworld_ids_are_prefixed_and_dog(synthetic_data_root):
    recs = parse_dogsworld(str(synthetic_data_root / "dogs-world"))
    assert {r.individual_id for r in recs} == {"dogsworld:dog_A", "dogsworld:dog_B", "dogsworld:dog_singleton"}
    assert all(r.species == "dog" and r.dataset == "dogsworld" for r in recs)
    assert len([r for r in recs if r.individual_id == "dogsworld:dog_A"]) == 3


def test_dogsworld_skips_multi_dog_images(synthetic_data_root):
    recs = parse_dogsworld(str(synthetic_data_root / "dogs-world"))
    # h7 carries two identities -> must be dropped; only the 6 single-dog images remain.
    assert len(recs) == 6
    assert "h7.png" not in {Path(r.path).name for r in recs}


def test_dogfacenet_is_eval_only(synthetic_data_root):
    recs = parse_dogfacenet(str(synthetic_data_root / "dogfacenet"))
    assert recs and all(r.split == "eval_only" and r.species == "dog" for r in recs)


def test_parse_all_covers_three_datasets(synthetic_data_root):
    recs = parse_all(str(synthetic_data_root))
    assert {r.dataset for r in recs} == {"dogsworld", "catind", "dogfacenet"}
