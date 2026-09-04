# src/petid/evaluate.py
"""Score a trained projection over the FULL test splits.

Phase 1 could only score a capped ~600-identity sample because the metrics materialized the
whole NxN similarity matrix. `streaming_metrics` removes that limit, so the numbers a model
is locked on come from every test image (16,469 dog / 102 cat identities).

Backbone features for the test splits are cached per backbone, so re-scoring a retrained
projection costs seconds.
"""

import argparse
import json
import os

import numpy as np
import torch

from petid.embed_cache import extract_features, load_backbone
from petid.metrics import cluster_sweep, clustering_quality, streaming_metrics
from petid.model import PetProjection, resolve_backbone
from petid.records import ImageRecord, ids_to_int, read_manifest

#: Agglomerative clustering is O(N^2) in memory, so its two metrics (a sanity signal for
#: the production clustering threshold) are computed on a bounded random subsample.
CLUSTER_SAMPLE = 5000


def eval_splits(manifest: str) -> dict[str, list[ImageRecord]]:
    recs = read_manifest(manifest)
    splits = {
        "dog": [r for r in recs if r.split == "test" and r.species == "dog"],
        "cat": [r for r in recs if r.split == "test" and r.species == "cat"],
        "dog_dogfacenet": [r for r in recs if r.split == "eval_only"],
    }
    return {name: rs for name, rs in splits.items() if rs}


def get_eval_cache(
    path: str,
    backbone: str,
    manifest: str | None,
    device: str,
    pretrained: bool = True,
    batch: int = 256,
    workers: int = 12,
) -> dict:
    """Cached backbone features for every eval split, built once per backbone."""
    if os.path.exists(path):
        print(f"using cached eval features: {path}", flush=True)
        return torch.load(path, weights_only=False)
    if not manifest:
        raise ValueError(f"no cached eval features at {path} and no manifest to build them from")
    model = load_backbone(backbone, device, pretrained=pretrained)
    splits = {}
    for name, records in eval_splits(manifest).items():
        print(f"extracting {len(records):,} eval features for {name}...", flush=True)
        feats = extract_features(records, model, device, batch=batch, workers=workers, log_every=batch * 40)
        splits[name] = (feats, ids_to_int(records))
    cache = {"backbone": resolve_backbone(backbone), "splits": splits}
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    torch.save(cache, path)
    return cache


def _score(emb: np.ndarray, ids: np.ndarray, chunk: int, cluster_threshold: float, seed: int = 0) -> dict:
    m = streaming_metrics(emb, ids, chunk=chunk)
    m["identities"] = float(len(set(ids.tolist())))
    if len(emb) > CLUSTER_SAMPLE:
        pick = np.random.default_rng(seed).choice(len(emb), CLUSTER_SAMPLE, replace=False)
        sample_emb, sample_ids = emb[pick], ids[pick]
    else:
        sample_emb, sample_ids = emb, ids
    hom, comp = clustering_quality(sample_emb, sample_ids, distance_threshold=cluster_threshold)
    m["homogeneity"], m["completeness"] = hom, comp
    m["cluster_n"] = float(len(sample_emb))
    m["cluster_sweep"] = cluster_sweep(sample_emb, sample_ids)
    return m


def evaluate(
    manifest: str | None,
    checkpoint: str,
    out_md: str,
    device: str = "mps",
    cache: str | None = None,
    chunk: int = 512,
    cluster_threshold: float = 0.5,
    pretrained: bool = True,
    batch: int = 256,
    workers: int = 12,
    json_path: str | None = None,
) -> dict:
    blob = torch.load(checkpoint, map_location="cpu", weights_only=False)
    backbone = resolve_backbone(blob["backbone"])
    weight = blob["projection"]["linear.weight"]
    proj = PetProjection(int(weight.shape[1]), int(weight.shape[0]))
    proj.load_state_dict(blob["projection"])
    proj.eval()

    cache_path = cache or os.path.join("runs", f"eval_cache_{backbone.split('/')[-1]}.pt")
    feature_cache = get_eval_cache(
        cache_path, backbone, manifest, device, pretrained=pretrained, batch=batch, workers=workers
    )

    result: dict[str, dict] = {}
    for name, (feats, ids) in feature_cache["splits"].items():
        if len(set(np.asarray(ids).tolist())) < 2:
            continue
        with torch.no_grad():
            projected = proj(feats).numpy()
        print(f"scoring {name}: {len(ids):,} images...", flush=True)
        result[name] = {
            # the cached features are already L2-normalized, i.e. the zeroshot embedding
            "zeroshot": _score(feats.numpy(), np.asarray(ids), chunk, cluster_threshold),
            "projection": _score(projected, np.asarray(ids), chunk, cluster_threshold),
        }

    _write_report(out_md, checkpoint, backbone, blob, result)
    if json_path:
        os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
        with open(json_path, "w") as f:
            json.dump(result, f, indent=2)
    return result


def _write_report(out_md: str, checkpoint: str, backbone: str, blob: dict, result: dict) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(out_md)), exist_ok=True)
    with open(out_md, "w") as f:
        f.write(f"# Pet Re-ID Eval — `{backbone}` ({blob.get('out_dim')}-d)\n\n")
        f.write(f"- checkpoint: `{checkpoint}`\n")
        f.write(f"- projection init: `{blob.get('init')}`, seed `{blob.get('seed')}`, ")
        f.write(f"epochs `{blob.get('epochs')}`, lr `{blob.get('lr')}`\n")
        f.write(f"- train identities: {blob.get('n_identities')}\n\n")
        f.write("Full test splits (no identity cap). Homogeneity/completeness are on a ")
        f.write(f"{CLUSTER_SAMPLE}-image random subsample (agglomerative clustering is O(N^2) memory).\n\n")
        f.write("| Split | Images | IDs | Model | AUC | EER | Top-1 | mAP | Homog. | Compl. |\n")
        f.write("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n")
        for name, variants in result.items():
            for model_name, m in variants.items():
                f.write(
                    f"| {name} | {int(m['n'])} | {int(m['identities'])} | {model_name} | {m['auc']:.3f} | "
                    f"{m['eer']:.3f} | {m['top1']:.3f} | {m['map']:.3f} | "
                    f"{m['homogeneity']:.3f} | {m['completeness']:.3f} |\n"
                )
        f.write("\n## Clustering threshold sweep (projection, cosine distance)\n\n")
        f.write("Input for the production `maxDistance`: low = pure but fragmented clusters, ")
        f.write("high = distinct pets merged into one.\n\n")
        for name, variants in result.items():
            sweep = variants["projection"].get("cluster_sweep") or []
            if not sweep:
                continue
            f.write(f"\n**{name}**\n\n| Distance | Homogeneity | Completeness |\n| --- | --- | --- |\n")
            for row in sweep:
                f.write(f"| {row['threshold']:.2f} | {row['homogeneity']:.3f} | {row['completeness']:.3f} |\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=None, help="only needed when the eval cache must be built")
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", default=None, help="cached eval features (default: runs/eval_cache_<name>.pt)")
    ap.add_argument("--device", default="mps")
    ap.add_argument("--chunk", type=int, default=512)
    ap.add_argument("--json", dest="json_path", default=None, help="also write metrics as JSON (for publish.py)")
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args()
    res = evaluate(
        a.manifest,
        a.checkpoint,
        a.out,
        device=a.device,
        cache=a.cache,
        chunk=a.chunk,
        workers=a.workers,
        json_path=a.json_path,
    )
    for name, variants in res.items():
        for model_name, m in variants.items():
            print(
                f"{name:16s} {model_name:10s} n={int(m['n']):6d} ids={int(m['identities']):5d} "
                f"AUC={m['auc']:.3f} EER={m['eer']:.3f} Top1={m['top1']:.3f} mAP={m['map']:.3f}",
                flush=True,
            )


if __name__ == "__main__":
    main()
