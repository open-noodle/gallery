import pytest
import torch
import torch.nn.functional as F
from PIL import Image

from petid.dataset import build_transform
from petid.embed_cache import build_train_cache, extract_features, get_train_cache, load_backbone, load_train_cache
from petid.manifest import build
from petid.records import read_manifest


def _train_records(data_root, tmp_path):
    manifest = tmp_path / "m.json"
    build(str(data_root), str(manifest), min_images=2, test_frac=0.5, seed=0)
    return [r for r in read_manifest(str(manifest)) if r.split == "train"]


def test_extract_features_matches_a_sequential_reference(synthetic_data_root, tmp_path):
    """Threaded loading must not reorder rows relative to the record list."""
    recs = _train_records(synthetic_data_root, tmp_path)
    model = load_backbone("facebook/dinov2-small", device="cpu", pretrained=False)

    feats = extract_features(recs, model, device="cpu", batch=2, workers=4, bf16=False)

    tf = build_transform(train=False)
    with torch.no_grad():
        xs = torch.stack([tf(Image.open(r.path).convert("RGB")) for r in recs])
        expected = F.normalize(model(xs).pooler_output, dim=1)
    assert feats.shape == (len(recs), 384)
    assert torch.allclose(feats, expected, atol=1e-5)
    assert torch.allclose(feats.norm(dim=1), torch.ones(len(recs)), atol=1e-5)


def test_build_train_cache_round_trips(synthetic_data_root, tmp_path):
    recs = _train_records(synthetic_data_root, tmp_path)
    path = tmp_path / "cache.pt"
    cache = build_train_cache(recs, "facebook/dinov2-small", device="cpu", path=str(path), pretrained=False, batch=2)

    assert path.exists()
    reloaded = load_train_cache(str(path))
    assert reloaded["dim"] == 384
    assert torch.allclose(reloaded["train_emb"], cache["train_emb"])
    assert reloaded["train_ids"].tolist() == cache["train_ids"].tolist()
    # labels are contiguous ints, one per record
    assert len(reloaded["train_ids"]) == len(recs)


def test_load_train_cache_infers_dim_for_legacy_caches(tmp_path):
    """The Phase-1 small-backbone cache predates the `dim` key."""
    path = tmp_path / "legacy.pt"
    torch.save({"train_emb": torch.randn(4, 384), "train_ids": [0, 0, 1, 1]}, path)
    assert load_train_cache(str(path))["dim"] == 384


def test_get_train_cache_reuses_an_existing_file_without_extracting(tmp_path):
    path = tmp_path / "cache.pt"
    torch.save({"dim": 384, "train_emb": torch.randn(4, 384), "train_ids": [0, 0, 1, 1]}, path)

    def explode():
        raise AssertionError("must not re-extract when the cache exists")

    cache = get_train_cache(str(path), "facebook/dinov2-small", explode, device="cpu")
    assert cache["train_emb"].shape == (4, 384)


def test_get_train_cache_builds_when_missing(synthetic_data_root, tmp_path):
    recs = _train_records(synthetic_data_root, tmp_path)
    path = tmp_path / "cache.pt"
    cache = get_train_cache(
        str(path), "facebook/dinov2-small", lambda: recs, device="cpu", pretrained=False, batch=2
    )
    assert path.exists() and cache["train_emb"].shape == (len(recs), 384)


def test_load_backbone_is_frozen_and_eval(tmp_path):
    model = load_backbone("facebook/dinov2-small", device="cpu", pretrained=False)
    assert not model.training
    assert not any(p.requires_grad for p in model.parameters())


def test_unknown_backbone_is_rejected():
    with pytest.raises(ValueError):
        load_backbone("facebook/dinov2-giant", device="cpu", pretrained=False)
