# src/petid/train.py
"""Train the projection head on cached frozen-backbone features.

The recipe validated in Phase 1: extract the backbone's features once, then train ONLY the
projection + an ArcFace classifier on that cache. The backbone stays frozen — a full
fine-tune overfits the training identities and forgets DINOv2's general features.
"""

import argparse
import os
import random
import time

import numpy as np
import torch
from torch import nn

from petid.embed_cache import default_cache_path, get_train_cache
from petid.model import DEFAULT_BACKBONE, OUT_DIM, ArcMarginProduct, PetProjection, resolve_backbone
from petid.records import read_manifest


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def train_projection(
    feats: torch.Tensor,
    labels: torch.Tensor | np.ndarray,
    out_dim: int = OUT_DIM,
    init: str = "identity",
    epochs: int = 30,
    batch: int = 4096,
    lr: float = 1e-3,
    seed: int = 0,
    device: str = "mps",
    log_every: int = 10,
) -> tuple[PetProjection, list[float]]:
    """Returns the trained projection and the per-epoch mean loss."""
    _seed_everything(seed)
    x = feats.to(device)
    y = torch.as_tensor(np.asarray(labels), dtype=torch.long, device=device)
    n_classes = int(y.max().item()) + 1

    proj = PetProjection(x.shape[1], out_dim, init).to(device)
    head = ArcMarginProduct(out_dim, n_classes).to(device)
    opt = torch.optim.AdamW(list(proj.parameters()) + list(head.parameters()), lr=lr)
    loss_fn = nn.CrossEntropyLoss()

    history: list[float] = []
    for epoch in range(epochs):
        t0 = time.perf_counter()
        perm = torch.randperm(x.shape[0], device=device)
        total, n_batches = 0.0, 0
        for i in range(0, len(perm), batch):
            idx = perm[i : i + batch]
            opt.zero_grad()
            loss = loss_fn(head(proj(x[idx]), y[idx]), y[idx])
            loss.backward()
            opt.step()
            total += loss.item()
            n_batches += 1
        history.append(total / max(n_batches, 1))
        if log_every and (epoch % log_every == 0 or epoch == epochs - 1):
            print(f"  epoch {epoch}: loss={history[-1]:.3f}  ({time.perf_counter() - t0:.1f}s)", flush=True)
    return proj, history


def train_run(
    out_dir: str,
    backbone: str = DEFAULT_BACKBONE,
    cache: str | None = None,
    manifest: str | None = None,
    out_dim: int = OUT_DIM,
    init: str = "identity",
    epochs: int = 30,
    batch: int = 4096,
    lr: float = 1e-3,
    seed: int = 0,
    device: str = "mps",
    pretrained: bool = True,
    extract_batch: int = 256,
    workers: int = 12,
) -> str:
    """Train a projection for `backbone` and save the checkpoint. Returns its path."""
    backbone = resolve_backbone(backbone)
    os.makedirs(out_dir, exist_ok=True)
    cache_path = cache or default_cache_path(backbone)

    def train_records():
        if not manifest:
            raise ValueError(f"no cached features at {cache_path} and no --manifest to build them from")
        return [r for r in read_manifest(manifest) if r.split == "train"]

    blob = get_train_cache(
        cache_path,
        backbone,
        train_records,
        device,
        pretrained=pretrained,
        batch=extract_batch,
        workers=workers,
    )
    feats, labels = blob["train_emb"], blob["train_ids"]
    n_identities = int(np.asarray(labels).max()) + 1
    print(
        f"backbone={backbone} dim={blob['dim']} -> {out_dim}  "
        f"train: {feats.shape[0]:,} features, {n_identities:,} identities  (init={init}, seed={seed})",
        flush=True,
    )

    proj, history = train_projection(
        feats, labels, out_dim=out_dim, init=init, epochs=epochs, batch=batch, lr=lr, seed=seed, device=device
    )

    ckpt_path = os.path.join(out_dir, "best.pt")
    torch.save(
        {
            "backbone": backbone,
            "out_dim": out_dim,
            "init": init,
            "seed": seed,
            "epochs": epochs,
            "lr": lr,
            "batch": batch,
            "n_identities": n_identities,
            "final_loss": history[-1] if history else None,
            "projection": {k: v.cpu() for k, v in proj.state_dict().items()},
        },
        ckpt_path,
    )
    return ckpt_path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backbone", default=DEFAULT_BACKBONE, help="small | base | large | full hub id")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", default=None, help="cached backbone features (default: runs/emb_cache_<name>.pt)")
    ap.add_argument("--manifest", default=None, help="only needed when the cache must be built")
    ap.add_argument("--init", choices=["identity", "xavier"], default="identity")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=4096)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args()
    path = train_run(
        out_dir=a.out,
        backbone=a.backbone,
        cache=a.cache,
        manifest=a.manifest,
        init=a.init,
        epochs=a.epochs,
        batch=a.batch,
        lr=a.lr,
        seed=a.seed,
        device=a.device,
        workers=a.workers,
    )
    print(f"checkpoint: {path}")


if __name__ == "__main__":
    main()
