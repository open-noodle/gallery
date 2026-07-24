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
