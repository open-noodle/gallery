import pytest
import torch
import torch.nn.functional as F

from petid.model import BACKBONES, OUT_DIM, ArcMarginProduct, PetEmbedder, PetProjection, hidden_size_for


def test_embedder_output_is_512d_and_normalized():
    m = PetEmbedder(backbone="facebook/dinov2-small", pretrained=False).eval()
    with torch.no_grad():
        emb = m(torch.randn(2, 3, 224, 224))
    assert emb.shape == (2, OUT_DIM)
    assert torch.allclose(emb.norm(dim=1), torch.ones(2), atol=1e-4)


def test_embedder_normalizes_backbone_features_before_projecting():
    """The projection is trained on L2-normalized backbone features (the cached ones).

    Dropping that intermediate normalize would silently change what the exported model
    computes relative to what was trained, so the fused forward must match
    proj(normalize(pooler)).
    """
    m = PetEmbedder(backbone="facebook/dinov2-small", pretrained=False).eval()
    # A non-trivial (non-identity, biased) projection: with an identity weight and a zero
    # bias the final normalize would mask a missing intermediate normalize.
    torch.manual_seed(0)
    with torch.no_grad():
        m.projection.linear.weight.normal_(0, 0.05)
        m.projection.linear.bias.normal_(0, 0.5)

    x = torch.randn(2, 3, 224, 224)
    with torch.no_grad():
        fused = m(x)
        pooled = m.backbone(x).pooler_output
        expected = F.normalize(m.projection.linear(F.normalize(pooled, dim=1)), dim=1)
        unnormalized_path = F.normalize(m.projection.linear(pooled), dim=1)

    assert torch.allclose(fused, expected, atol=1e-5)
    # guard: the two paths must actually differ, else the assertion above proves nothing
    assert not torch.allclose(expected, unnormalized_path, atol=1e-3)


def test_backbone_is_frozen_and_projection_is_trainable():
    m = PetEmbedder(backbone="facebook/dinov2-small", pretrained=False)
    assert not any(p.requires_grad for p in m.backbone.parameters())
    assert all(p.requires_grad for p in m.projection.parameters())


@pytest.mark.parametrize(("name", "hidden"), [("small", 384), ("base", 768), ("large", 1024)])
def test_hidden_size_per_backbone(name, hidden):
    assert hidden_size_for(BACKBONES[name]) == hidden


def test_projection_identity_init_preserves_input_directions():
    proj = PetProjection(in_dim=384, out_dim=OUT_DIM, init="identity")
    x = F.normalize(torch.randn(3, 384), dim=1)
    with torch.no_grad():
        out = proj(x)
    # 384 -> 512 identity init: inputs pass through, trailing dims stay zero
    assert torch.allclose(out[:, :384], x, atol=1e-5)
    assert torch.allclose(out[:, 384:], torch.zeros(3, OUT_DIM - 384), atol=1e-5)


def test_projection_xavier_init_differs_from_identity():
    torch.manual_seed(0)
    x = F.normalize(torch.randn(3, 768), dim=1)
    with torch.no_grad():
        ident = PetProjection(768, OUT_DIM, init="identity")(x)
        xavier = PetProjection(768, OUT_DIM, init="xavier")(x)
    assert not torch.allclose(ident, xavier, atol=1e-3)


def test_arcface_logits_shape_and_grad():
    head = ArcMarginProduct(OUT_DIM, out_features=5)
    emb = torch.randn(4, OUT_DIM, requires_grad=True)
    labels = torch.tensor([0, 1, 2, 3])
    logits = head(emb, labels)
    assert logits.shape == (4, 5)
    logits.sum().backward()
    assert emb.grad is not None


def test_arcface_applies_margin_and_is_stable():
    torch.manual_seed(0)
    head = ArcMarginProduct(OUT_DIM, out_features=3, s=30.0, m=0.5)
    # Embedding exactly aligned with class-0's weight vector -> target cosine ~1.
    emb = F.normalize(head.weight[0:1].detach().clone(), dim=1).requires_grad_(True)
    logits = head(emb, torch.tensor([0]))
    plain = head.s * F.linear(F.normalize(emb), F.normalize(head.weight)).clamp(-1, 1)
    # margin must REDUCE the target-class logit vs plain scaled cosine
    assert logits[0, 0] < plain[0, 0] - 1e-3
    # strongly-misaligned target (cosine ~ -1) must stay finite (no NaN/Inf) and differentiable
    emb2 = F.normalize(-head.weight[0:1].detach().clone(), dim=1).requires_grad_(True)
    out2 = head(emb2, torch.tensor([0]))
    out2.sum().backward()
    assert torch.isfinite(out2).all() and torch.isfinite(emb2.grad).all()
