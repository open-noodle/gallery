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
