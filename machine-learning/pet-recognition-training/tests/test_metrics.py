import numpy as np
import pytest

from petid.metrics import clustering_quality, identification, streaming_metrics, verification_scores


def _noisy(n_ids: int = 40, per_id: int = 6, dim: int = 16, spread: float = 0.9, seed: int = 1):
    """Overlapping identities — metrics land mid-range, so agreement is discriminating."""
    rng = np.random.default_rng(seed)
    centers = rng.normal(size=(n_ids, dim))
    emb, ids = [], []
    for k in range(n_ids):
        for _ in range(per_id):
            v = centers[k] + rng.normal(0, spread, size=dim)
            emb.append(v / np.linalg.norm(v))
            ids.append(k)
    return np.array(emb), np.array(ids)


def _separable():
    # 3 identities, 4 imgs each, near-duplicate embeddings per identity
    rng = np.random.default_rng(0)
    centers = np.eye(3)[:, :3]
    emb, ids = [], []
    for k in range(3):
        base = np.concatenate([centers[k], np.zeros(5)])
        for _ in range(4):
            v = base + rng.normal(0, 1e-3, size=8)
            emb.append(v / np.linalg.norm(v))
            ids.append(k)
    return np.array(emb), np.array(ids)


def test_verification_perfect_on_separable():
    emb, ids = _separable()
    auc, eer = verification_scores(emb, ids)
    assert auc > 0.99 and eer < 0.02


def test_identification_perfect_on_separable():
    emb, ids = _separable()
    top1, mAP = identification(emb, ids)
    assert top1 > 0.99 and mAP > 0.99


def test_clustering_recovers_groups():
    emb, ids = _separable()
    hom, comp = clustering_quality(emb, ids, distance_threshold=0.5)
    assert hom > 0.99 and comp > 0.99


def test_streaming_matches_dense_on_overlapping_identities():
    """The chunked scorer must reproduce the dense O(N^2) scores it replaces."""
    emb, ids = _noisy()
    auc, eer = verification_scores(emb, ids)
    top1, mAP = identification(emb, ids)
    m = streaming_metrics(emb, ids, chunk=17)

    assert 0.05 < eer < 0.45, "fixture must be non-trivial for the comparison to mean anything"
    assert m["n"] == len(ids)
    assert m["auc"] == pytest.approx(auc, abs=1e-3)
    assert m["eer"] == pytest.approx(eer, abs=1e-3)
    assert m["top1"] == pytest.approx(top1, abs=1e-9)
    assert m["map"] == pytest.approx(mAP, abs=1e-6)


def test_streaming_matches_dense_on_separable():
    emb, ids = _separable()
    auc, eer = verification_scores(emb, ids)
    top1, mAP = identification(emb, ids)
    m = streaming_metrics(emb, ids, chunk=5)
    assert m["auc"] == pytest.approx(auc, abs=1e-3)
    assert m["eer"] == pytest.approx(eer, abs=1e-3)
    assert m["top1"] == pytest.approx(top1, abs=1e-9)
    assert m["map"] == pytest.approx(mAP, abs=1e-6)


def test_streaming_is_invariant_to_chunk_size():
    emb, ids = _noisy(seed=2)
    small = streaming_metrics(emb, ids, chunk=3)
    large = streaming_metrics(emb, ids, chunk=10_000)
    for key in ("auc", "eer", "top1", "map"):
        assert small[key] == pytest.approx(large[key], abs=1e-9), key
