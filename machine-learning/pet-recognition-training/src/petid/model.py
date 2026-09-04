"""The shipped pet re-ID model: a frozen DINOv2 backbone + a trained projection head.

The projection's L2-normalized output IS the embedding. The backbone is never trained
(a full fine-tune overfits and forgets DINOv2's features — see the Phase 1 results); only
the projection and the training-time ArcFace classifier are.
"""

import math

import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import Dinov2Config, Dinov2Model

#: Selectable backbones, by short name.
BACKBONES = {
    "small": "facebook/dinov2-small",
    "base": "facebook/dinov2-base",
    "large": "facebook/dinov2-large",
}
DEFAULT_BACKBONE = BACKBONES["base"]

#: Embedding width, uniform across backbones so every model writes into the same
#: `vector(512)` store and users can switch models without a schema change.
OUT_DIM = 512

# Architecture of each published DINOv2 checkpoint. Only needed to build a backbone
# offline (`pretrained=False`, tests); the real weights come from the hub.
_ARCH: dict[str, dict[str, int]] = {
    "facebook/dinov2-small": {"hidden_size": 384, "num_hidden_layers": 12, "num_attention_heads": 6},
    "facebook/dinov2-base": {"hidden_size": 768, "num_hidden_layers": 12, "num_attention_heads": 12},
    "facebook/dinov2-large": {"hidden_size": 1024, "num_hidden_layers": 24, "num_attention_heads": 16},
}


def resolve_backbone(backbone: str) -> str:
    """Accept either a short name ("base") or a full hub id ("facebook/dinov2-base")."""
    resolved = BACKBONES.get(backbone, backbone)
    if resolved not in _ARCH:
        raise ValueError(f"unknown backbone {backbone!r}; expected one of {sorted(BACKBONES)} or a full hub id")
    return resolved


def hidden_size_for(backbone: str) -> int:
    return _ARCH[resolve_backbone(backbone)]["hidden_size"]


class PetProjection(nn.Module):
    """Maps L2-normalized backbone features (384/768/1024-d) to the 512-d embedding."""

    def __init__(self, in_dim: int, out_dim: int = OUT_DIM, init: str = "identity"):
        super().__init__()
        self.linear = nn.Linear(in_dim, out_dim)
        nn.init.zeros_(self.linear.bias)
        match init:
            case "identity":
                # Warm start at (a truncated/padded) pass-through, i.e. close to zeroshot.
                nn.init.eye_(self.linear.weight)
            case "xavier":
                nn.init.xavier_uniform_(self.linear.weight)
            case _:
                raise ValueError(f"unknown projection init {init!r}; expected 'identity' or 'xavier'")

    def forward(self, feats: torch.Tensor) -> torch.Tensor:
        return F.normalize(self.linear(feats), dim=1)


class PetEmbedder(nn.Module):
    """Frozen backbone -> L2-normalize -> projection -> L2-normalize.

    The intermediate normalize is load-bearing: the projection is trained on normalized
    backbone features, so inference must feed it the same thing.
    """

    def __init__(
        self,
        backbone: str = DEFAULT_BACKBONE,
        out_dim: int = OUT_DIM,
        pretrained: bool = True,
        init: str = "identity",
    ):
        super().__init__()
        self.backbone_name = resolve_backbone(backbone)
        if pretrained:
            self.backbone = Dinov2Model.from_pretrained(self.backbone_name)
        else:
            # image_size=518 matches the published configs so position_embeddings (and thus
            # the state_dict) stay checkpoint-compatible — DINOv2 interpolates position
            # encodings at runtime, so actual 224x224 inputs are unaffected.
            self.backbone = Dinov2Model(
                Dinov2Config(**_ARCH[self.backbone_name], patch_size=14, image_size=518)
            )
        for p in self.backbone.parameters():
            p.requires_grad_(False)
        self.projection = PetProjection(hidden_size_for(self.backbone_name), out_dim, init)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        pooled = self.backbone(x).pooler_output
        return self.projection(F.normalize(pooled, dim=1))

    @classmethod
    def from_checkpoint(cls, path: str, device: str = "cpu", pretrained: bool = True) -> "PetEmbedder":
        """Rebuild the shippable model: hub backbone + the checkpoint's trained projection."""
        blob = torch.load(path, map_location="cpu", weights_only=False)
        weight = blob["projection"]["linear.weight"]
        model = cls(backbone=blob["backbone"], out_dim=int(weight.shape[0]), pretrained=pretrained)
        model.projection.load_state_dict(blob["projection"])
        return model.to(device).eval()


class ArcMarginProduct(nn.Module):
    """Training-time ArcFace classifier over the projection output. Discarded at inference."""

    def __init__(self, in_features: int, out_features: int, s: float = 30.0, m: float = 0.5):
        super().__init__()
        self.s = s
        self.weight = nn.Parameter(torch.empty(out_features, in_features))
        nn.init.xavier_uniform_(self.weight)
        self.cos_m = math.cos(m)
        self.sin_m = math.sin(m)
        self.th = math.cos(math.pi - m)  # threshold: cos(pi - m)
        self.mm = math.sin(math.pi - m) * m  # linear fallback below threshold

    def forward(self, emb: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        cosine = F.linear(F.normalize(emb, dim=1), F.normalize(self.weight, dim=1)).clamp(-1.0, 1.0)
        sine = torch.sqrt((1.0 - cosine**2).clamp(min=1e-9))
        phi = cosine * self.cos_m - sine * self.sin_m  # = cos(theta + m)
        phi = torch.where(cosine > self.th, phi, cosine - self.mm)  # monotonicity guard
        one_hot = F.one_hot(labels, num_classes=self.weight.shape[0]).float()
        return torch.where(one_hot.bool(), phi, cosine) * self.s
