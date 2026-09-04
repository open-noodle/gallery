"""Frozen-backbone feature extraction and caching.

The backbone never trains, so its features over a fixed image set never change: extract
them ONCE and every later projection experiment trains on the cache in minutes instead of
re-running the ViT each epoch.

Images are loaded with a ThreadPoolExecutor rather than DataLoader workers on purpose —
`num_workers > 0` deadlocks on macOS + MPS, and JPEG decoding releases the GIL anyway.
"""

import os
import time
from collections.abc import Callable, Sequence

import torch
import torch.nn.functional as F
from PIL import Image
from transformers import Dinov2Model

from petid.dataset import build_transform
from petid.model import _ARCH, resolve_backbone
from petid.records import ImageRecord, ids_to_int

_TRANSFORM = build_transform(train=False)


def load_backbone(backbone: str, device: str, pretrained: bool = True) -> Dinov2Model:
    """Load a frozen, eval-mode DINOv2 backbone. `pretrained=False` is for tests."""
    name = resolve_backbone(backbone)
    if pretrained:
        model = Dinov2Model.from_pretrained(name)
    else:
        from transformers import Dinov2Config

        model = Dinov2Model(Dinov2Config(**_ARCH[name], patch_size=14, image_size=518))
    model = model.to(device).eval()
    for p in model.parameters():
        p.requires_grad_(False)
    return model


def _load_image(record: ImageRecord) -> torch.Tensor:
    return _TRANSFORM(Image.open(record.path).convert("RGB"))


@torch.no_grad()
def extract_features(
    records: Sequence[ImageRecord],
    model: Dinov2Model,
    device: str,
    batch: int = 256,
    workers: int = 12,
    bf16: bool = True,
    log_every: int = 0,
) -> torch.Tensor:
    """L2-normalized backbone features, one row per record, in record order."""
    from concurrent.futures import ThreadPoolExecutor

    out: list[torch.Tensor] = []
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for start in range(0, len(records), batch):
            chunk = list(pool.map(_load_image, records[start : start + batch]))
            xs = torch.stack(chunk).to(device)
            if bf16:
                with torch.autocast(device_type=device, dtype=torch.bfloat16):
                    feats = model(xs).pooler_output
            else:
                feats = model(xs).pooler_output
            out.append(F.normalize(feats.float(), dim=1).cpu())
            if log_every and start and start % log_every == 0:
                rate = start / (time.perf_counter() - t0)
                print(f"    {start:,}/{len(records):,}  ({rate:.0f} img/s)", flush=True)
    return torch.cat(out) if out else torch.empty(0)


def load_train_cache(path: str) -> dict:
    cache = torch.load(path, weights_only=False)  # numpy label arrays
    # The Phase-1 small-backbone cache predates the `dim` key.
    cache.setdefault("dim", int(cache["train_emb"].shape[1]))
    return cache


def build_train_cache(
    records: Sequence[ImageRecord],
    backbone: str,
    device: str,
    path: str,
    pretrained: bool = True,
    batch: int = 256,
    workers: int = 12,
    bf16: bool = True,
) -> dict:
    model = load_backbone(backbone, device, pretrained=pretrained)
    print(f"extracting {len(records):,} frozen features with {resolve_backbone(backbone)}...", flush=True)
    feats = extract_features(
        records, model, device, batch=batch, workers=workers, bf16=bf16, log_every=batch * 40
    )
    cache = {"dim": int(feats.shape[1]), "train_emb": feats, "train_ids": ids_to_int(records)}
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    torch.save(cache, path)
    return cache


def get_train_cache(
    path: str,
    backbone: str,
    records_fn: Callable[[], Sequence[ImageRecord]],
    device: str,
    **kwargs,
) -> dict:
    """Load the cached features for `backbone`, extracting them only if absent."""
    if os.path.exists(path):
        print(f"using cached features: {path}", flush=True)
        return load_train_cache(path)
    return build_train_cache(records_fn(), backbone, device, path, **kwargs)


def default_cache_path(backbone: str, runs_dir: str = "runs") -> str:
    return os.path.join(runs_dir, f"emb_cache_{resolve_backbone(backbone).split('/')[-1]}.pt")
