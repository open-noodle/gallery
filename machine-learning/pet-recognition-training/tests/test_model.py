import torch
import torch.nn.functional as F

from petid.model import ArcMarginProduct, PetEmbedder, EMBED_DIM


def test_embedder_output_is_normalized():
    m = PetEmbedder(pretrained=False).eval()
    with torch.no_grad():
        emb = m(torch.randn(2, 3, 224, 224))
    assert emb.shape == (2, EMBED_DIM)
    norms = emb.norm(dim=1)
    assert torch.allclose(norms, torch.ones(2), atol=1e-4)


def test_arcface_logits_shape_and_grad():
    head = ArcMarginProduct(EMBED_DIM, out_features=5)
    emb = torch.randn(4, EMBED_DIM, requires_grad=True)
    labels = torch.tensor([0, 1, 2, 3])
    logits = head(emb, labels)
    assert logits.shape == (4, 5)
    logits.sum().backward()
    assert emb.grad is not None


def test_arcface_applies_margin_and_is_stable():
    torch.manual_seed(0)
    head = ArcMarginProduct(EMBED_DIM, out_features=3, s=30.0, m=0.5)
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
