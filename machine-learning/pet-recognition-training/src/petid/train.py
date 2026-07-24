# src/petid/train.py
import argparse
import contextlib
import os

import torch
from torch.utils.data import DataLoader

from petid.dataset import PetDataset, label_map_for
from petid.model import ArcMarginProduct, PetEmbedder
from petid.records import read_manifest


def train_run(
    manifest: str,
    out_dir: str,
    config: str,
    epochs: int,
    batch: int,
    bf16: bool,
    device: str,
    limit: int | None = None,
    seed: int = 0,
) -> str:
    torch.manual_seed(seed)
    os.makedirs(out_dir, exist_ok=True)
    recs = [r for r in read_manifest(manifest) if r.split == "train"]
    if limit:
        recs = recs[:limit]
    label_map = label_map_for(recs)

    # Always start from the pretrained DINOv2 backbone (zeroshot = pretrained weights, no head training).
    embedder = PetEmbedder(pretrained=True).to(device)
    ckpt_path = os.path.join(out_dir, "best.pt")

    if config == "zeroshot":
        torch.save({"embedder": embedder.state_dict(), "config": config}, ckpt_path)
        return ckpt_path

    if config == "head":
        for p in embedder.backbone.parameters():
            p.requires_grad_(False)

    head = ArcMarginProduct(384, out_features=len(label_map)).to(device)
    params = [p for p in embedder.parameters() if p.requires_grad] + list(head.parameters())
    opt = torch.optim.AdamW(params, lr=1e-4)
    loss_fn = torch.nn.CrossEntropyLoss()
    loader = DataLoader(PetDataset(recs, label_map, train=True), batch_size=batch, shuffle=True)

    def ctx():
        return torch.autocast(device_type=device, dtype=torch.bfloat16) if bf16 else contextlib.nullcontext()

    embedder.train()
    for _epoch in range(epochs):
        for x, y in loader:
            x, y = x.to(device), y.to(device)
            opt.zero_grad()
            with ctx():
                loss = loss_fn(head(embedder(x), y), y)
            loss.backward()
            opt.step()
    torch.save({"embedder": embedder.state_dict(), "config": config}, ckpt_path)
    return ckpt_path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", choices=["zeroshot", "head", "full"], required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--bf16", action="store_true")
    ap.add_argument("--device", default="mps")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    path = train_run(a.manifest, a.out, a.config, a.epochs, a.batch, a.bf16, a.device, a.limit, a.seed)
    print(f"checkpoint: {path}")


if __name__ == "__main__":
    main()
