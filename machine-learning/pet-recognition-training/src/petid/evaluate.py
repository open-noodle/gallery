# src/petid/evaluate.py
import argparse

import numpy as np
import torch
from PIL import Image

from petid.dataset import build_transform
from petid.metrics import clustering_quality, identification, verification_scores
from petid.model import PetEmbedder
from petid.records import ImageRecord, read_manifest


def embed_records(records: list[ImageRecord], checkpoint: str, device: str, batch: int = 64):
    blob = torch.load(checkpoint, map_location=device)
    model = PetEmbedder(pretrained=False).to(device)
    model.load_state_dict(blob["embedder"])
    model.eval()
    tf = build_transform(train=False)

    id_to_int: dict[str, int] = {}
    embs, species, ids = [], [], []
    with torch.no_grad():
        for start in range(0, len(records), batch):
            chunk = records[start : start + batch]
            xs = torch.stack([tf(Image.open(r.path).convert("RGB")) for r in chunk]).to(device)
            out = model(xs).cpu().numpy()
            for r, e in zip(chunk, out):
                embs.append(e)
                species.append(r.species)
                ids.append(id_to_int.setdefault(r.individual_id, len(id_to_int)))
    return np.array(embs), np.array(species, dtype=object), np.array(ids)


def _metrics_for(emb, ids) -> dict:
    if len(set(ids.tolist())) < 2:
        return {"note": "insufficient identities to score", "n": int(len(ids))}
    auc, eer = verification_scores(emb, ids)
    top1, mAP = identification(emb, ids)
    hom, comp = clustering_quality(emb, ids, distance_threshold=0.5)
    return {"n": int(len(ids)), "auc": auc, "eer": eer, "top1": top1, "map": mAP, "homogeneity": hom, "completeness": comp}


def evaluate(manifest: str, checkpoint: str, out_md: str, device: str) -> dict:
    recs = read_manifest(manifest)
    test = [r for r in recs if r.split == "test"]
    dfn = [r for r in recs if r.split == "eval_only"]

    result: dict = {}
    for species in ("dog", "cat"):
        sp = [r for r in test if r.species == species]
        if sp:
            emb, _spv, ids = embed_records(sp, checkpoint, device)
            result[species] = _metrics_for(emb, ids)
    if dfn:
        emb, _spv, ids = embed_records(dfn, checkpoint, device)
        result["dog_dogfacenet_eval"] = _metrics_for(emb, ids)

    with open(out_md, "w") as f:
        f.write(f"# Pet Re-ID Eval — {checkpoint}\n\n")
        f.write("| Split | N | AUC | EER | Top-1 | mAP | Homog. | Compl. |\n")
        f.write("| --- | --- | --- | --- | --- | --- | --- | --- |\n")
        for name, m in result.items():
            if "auc" in m:
                f.write(
                    f"| {name} | {m['n']} | {m['auc']:.3f} | {m['eer']:.3f} | {m['top1']:.3f} | "
                    f"{m['map']:.3f} | {m['homogeneity']:.3f} | {m['completeness']:.3f} |\n"
                )
            else:
                f.write(f"| {name} | {m.get('n', 0)} | — | — | — | — | — | — |\n")
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="mps")
    a = ap.parse_args()
    res = evaluate(a.manifest, a.checkpoint, a.out, a.device)
    print(res)


if __name__ == "__main__":
    main()
