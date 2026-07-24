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


def streaming_metrics(
    emb: np.ndarray,
    ids: np.ndarray,
    chunk: int = 512,
    bins: int = 200_000,
) -> dict[str, float]:
    """AUC/EER/Top-1/mAP over a full test split, in bounded memory.

    The dense scorers above materialize the whole NxN similarity matrix (11 GB at
    N=53,830), which is why Phase 1 could only score a capped identity sample. Here the
    matrix is consumed one row-chunk at a time:

    - verification (AUC/EER): accumulate positive/negative score histograms — 200k bins
      over [-1, 1] resolves thresholds to 1e-5, far finer than the metric's precision;
    - identification (Top-1/mAP): exact, with each relevant item's rank obtained by
      *counting* higher-scoring gallery entries instead of sorting the row.

    Self-pairs are excluded everywhere. Results match the dense scorers (see tests).
    """
    emb = np.ascontiguousarray(emb, dtype=np.float32)
    ids = np.asarray(ids)
    n = len(ids)
    pos_hist = np.zeros(bins, dtype=np.int64)
    all_hist = np.zeros(bins, dtype=np.int64)
    top1_hits, ap_sum = 0, 0.0

    for start in range(0, n, chunk):
        stop = min(start + chunk, n)
        rows = np.arange(start, stop)
        sim = emb[start:stop] @ emb.T
        np.clip(sim, -1.0, 1.0, out=sim)  # keep float slop out of the histogram range
        same = ids[start:stop, None] == ids[None, :]
        # Drop self-pairs: -2 is below every cosine, so a self never wins an argmax,
        # never out-ranks a relevant item, and falls outside the histogram range.
        sim[np.arange(stop - start), rows] = -2.0
        same[np.arange(stop - start), rows] = False

        pos_hist += np.histogram(sim[same], bins=bins, range=(-1.0, 1.0))[0]
        all_hist += np.histogram(sim, bins=bins, range=(-1.0, 1.0))[0]

        best = np.argmax(sim, axis=1)
        top1_hits += int(same[np.arange(stop - start), best].sum())

        for k in range(stop - start):
            rel = sim[k][same[k]]
            if rel.size == 0:
                continue  # no relevant gallery item -> AP 0, same as the dense scorer
            ranks = np.sort((sim[k][:, None] > rel[None, :]).sum(axis=0) + 1)
            ap_sum += float(np.mean(np.arange(1, rel.size + 1) / ranks))

    neg_hist = all_hist - pos_hist
    p, q = pos_hist.sum(), neg_hist.sum()
    if p == 0 or q == 0:
        raise ValueError("need both matching and non-matching pairs to score verification")
    # sweep the threshold from high similarity down
    tpr = np.cumsum(pos_hist[::-1]) / p
    fpr = np.cumsum(neg_hist[::-1]) / q
    idx = int(np.argmin(np.abs(fpr - (1.0 - tpr))))
    eer = float((fpr[idx] + (1.0 - tpr[idx])) / 2)
    auc = float(np.trapezoid(np.concatenate([[0.0], tpr]), np.concatenate([[0.0], fpr])))
    return {"n": float(n), "auc": auc, "eer": eer, "top1": top1_hits / n, "map": ap_sum / n}


def clustering_quality(emb: np.ndarray, ids: np.ndarray, distance_threshold: float) -> tuple[float, float]:
    clusterer = AgglomerativeClustering(
        n_clusters=None, metric="cosine", linkage="average", distance_threshold=distance_threshold
    )
    pred = clusterer.fit_predict(emb)
    hom, comp, _v = homogeneity_completeness_v_measure(ids, pred)
    return float(hom), float(comp)
