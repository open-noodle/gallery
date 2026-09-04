# tests/test_train.py
import torch

from petid.model import OUT_DIM
from petid.train import train_projection, train_run


def _cache(tmp_path, n=64, dim=384, n_ids=8):
    """A synthetic backbone-feature cache: clustered, L2-normalized rows."""
    torch.manual_seed(0)
    centers = torch.nn.functional.normalize(torch.randn(n_ids, dim), dim=1)
    ids = torch.arange(n) % n_ids
    feats = torch.nn.functional.normalize(centers[ids] + 0.1 * torch.randn(n, dim), dim=1)
    path = tmp_path / "cache.pt"
    torch.save({"dim": dim, "train_emb": feats, "train_ids": ids.numpy()}, path)
    return path, feats, ids


def test_train_projection_reduces_arcface_loss(tmp_path):
    _, feats, ids = _cache(tmp_path)
    _proj, history = train_projection(feats, ids, epochs=20, batch=32, lr=1e-3, seed=0, device="cpu")
    assert len(history) == 20
    assert history[-1] < history[0]


def test_train_projection_is_seeded(tmp_path):
    _, feats, ids = _cache(tmp_path)
    a, _ = train_projection(feats, ids, epochs=3, batch=32, seed=7, device="cpu")
    b, _ = train_projection(feats, ids, epochs=3, batch=32, seed=7, device="cpu")
    c, _ = train_projection(feats, ids, epochs=3, batch=32, seed=8, device="cpu")
    assert torch.allclose(a.linear.weight, b.linear.weight)
    assert not torch.allclose(a.linear.weight, c.linear.weight)


def test_train_projection_outputs_512d_normalized_embeddings(tmp_path):
    _, feats, ids = _cache(tmp_path)
    proj, _ = train_projection(feats, ids, epochs=2, batch=32, seed=0, device="cpu")
    with torch.no_grad():
        out = proj(feats[:5])
    assert out.shape == (5, OUT_DIM)
    assert torch.allclose(out.norm(dim=1), torch.ones(5), atol=1e-5)


def test_train_run_writes_a_checkpoint_describing_the_model(tmp_path):
    cache, _, _ = _cache(tmp_path)
    ckpt = train_run(
        out_dir=str(tmp_path / "run"),
        backbone="facebook/dinov2-small",
        cache=str(cache),
        epochs=2,
        batch=32,
        seed=3,
        device="cpu",
    )
    blob = torch.load(ckpt, map_location="cpu")
    assert blob["backbone"] == "facebook/dinov2-small"
    assert blob["out_dim"] == OUT_DIM
    assert blob["init"] == "identity"
    assert blob["seed"] == 3
    assert blob["n_identities"] == 8
    # the checkpoint carries ONLY the projection - the backbone comes from the hub
    assert set(blob["projection"]) == {"linear.weight", "linear.bias"}
    assert blob["projection"]["linear.weight"].shape == (OUT_DIM, 384)


def test_train_run_uses_the_cache_without_touching_the_manifest(tmp_path):
    cache, _, _ = _cache(tmp_path)
    ckpt = train_run(
        out_dir=str(tmp_path / "run"),
        backbone="facebook/dinov2-small",
        cache=str(cache),
        manifest=str(tmp_path / "does-not-exist.json"),
        epochs=1,
        batch=32,
        device="cpu",
    )
    assert torch.load(ckpt, map_location="cpu")["projection"]["linear.weight"].shape == (OUT_DIM, 384)
