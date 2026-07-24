import numpy as np
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import homogeneity_completeness_v_measure, roc_auc_score


def _cosine_matrix(emb: np.ndarray) -> np.ndarray:
    return emb @ emb.T


def verification_scores(emb: np.ndarray, ids: np.ndarray) -> tuple[float, float]:
    sim = _cosine_matrix(emb)
    iu = np.triu_indices(len(ids), k=1)
    scores = sim[iu]
    labels = (ids[iu[0]] == ids[iu[1]]).astype(int)
    auc = float(roc_auc_score(labels, scores))
    # EER: sweep thresholds, find |FAR - FRR| minimum
    order = np.argsort(-scores)
    l_sorted = labels[order]
    P, N = l_sorted.sum(), len(l_sorted) - l_sorted.sum()
    tp = np.cumsum(l_sorted)
    fp = np.cumsum(1 - l_sorted)
    frr = 1 - tp / max(P, 1)
    far = fp / max(N, 1)
    idx = int(np.argmin(np.abs(far - frr)))
    eer = float((far[idx] + frr[idx]) / 2)
    return auc, eer


def identification(emb: np.ndarray, ids: np.ndarray) -> tuple[float, float]:
    sim = _cosine_matrix(emb)
    np.fill_diagonal(sim, -np.inf)  # leave-one-out
    n = len(ids)
    top1_hits, aps = 0, []
    for i in range(n):
        # -inf on the diagonal guarantees self sorts last; drop it so the probe
        # is never scored against itself as a gallery entry.
        order = np.argsort(-sim[i])[:-1]
        rel = (ids[order] == ids[i]).astype(int)
        if rel[0] == 1:
            top1_hits += 1
        # average precision
        cum = np.cumsum(rel)
        ranks = np.arange(1, n)
        precision_at_hits = cum[rel == 1] / ranks[rel == 1]
        aps.append(precision_at_hits.mean() if rel.sum() else 0.0)
    return top1_hits / n, float(np.mean(aps))


def clustering_quality(emb: np.ndarray, ids: np.ndarray, distance_threshold: float) -> tuple[float, float]:
    clusterer = AgglomerativeClustering(
        n_clusters=None, metric="cosine", linkage="average", distance_threshold=distance_threshold
    )
    pred = clusterer.fit_predict(emb)
    hom, comp, _v = homogeneity_completeness_v_measure(ids, pred)
    return float(hom), float(comp)
