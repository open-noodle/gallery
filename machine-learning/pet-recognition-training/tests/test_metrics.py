import numpy as np

from petid.metrics import clustering_quality, identification, verification_scores


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
