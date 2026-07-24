import math

import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import Dinov2Config, Dinov2Model

EMBED_DIM = 384


class PetEmbedder(nn.Module):
    def __init__(self, pretrained: bool = True):
        super().__init__()
        if pretrained:
            self.backbone = Dinov2Model.from_pretrained("facebook/dinov2-small")
        else:
            self.backbone = Dinov2Model(
                Dinov2Config(hidden_size=EMBED_DIM, num_hidden_layers=12, num_attention_heads=6, patch_size=14, image_size=224)
            )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        emb = self.backbone(x).pooler_output  # [N, 384]
        return F.normalize(emb, dim=1)


class ArcMarginProduct(nn.Module):
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
