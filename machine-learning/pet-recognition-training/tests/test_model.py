import torch

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
