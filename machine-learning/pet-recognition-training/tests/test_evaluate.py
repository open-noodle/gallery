import torch

from petid.evaluate import evaluate
from petid.manifest import build
from petid.metrics import SWEEP_THRESHOLDS
from petid.model import OUT_DIM, PetProjection
from petid.train import train_run


def _manifest(data_root, tmp_path):
    path = tmp_path / "m.json"
    # test_frac=1.0: every identity lands in the test split, so each species has the >=2
    # identities scoring needs (this module only reads test/eval_only splits).
    build(str(data_root), str(path), min_images=2, test_frac=1.0, seed=0)
    return str(path)


def _checkpoint(tmp_path, init="identity"):
    proj = PetProjection(384, OUT_DIM, init)
    path = tmp_path / "best.pt"
    torch.save(
        {
            "backbone": "facebook/dinov2-small",
            "out_dim": OUT_DIM,
            "init": init,
            "seed": 0,
            "n_identities": 2,
            "projection": proj.state_dict(),
        },
        path,
    )
    return str(path)


def test_evaluate_scores_each_species_against_a_zeroshot_baseline(synthetic_data_root, tmp_path):
    manifest = _manifest(synthetic_data_root, tmp_path)
    ckpt = _checkpoint(tmp_path)
    report = tmp_path / "report.md"

    result = evaluate(
        manifest, ckpt, str(report), device="cpu", cache=str(tmp_path / "eval.pt"), pretrained=False, batch=2
    )

    assert report.exists()
    assert "dog" in result
    for split in result.values():
        assert {"zeroshot", "projection"} <= set(split)
        assert {"n", "identities", "eer", "auc", "top1", "map"} <= set(split["projection"])
    text = report.read_text()
    assert "zeroshot" in text and "projection" in text


def test_identity_projection_scores_exactly_like_zeroshot(synthetic_data_root, tmp_path):
    """384->512 identity init only zero-pads, so cosine similarities are unchanged.

    A mismatch means the projection is being fed something other than the normalized
    backbone features it is defined over.
    """
    manifest = _manifest(synthetic_data_root, tmp_path)
    ckpt = _checkpoint(tmp_path, init="identity")
    result = evaluate(
        manifest, ckpt, str(tmp_path / "r.md"), device="cpu", cache=str(tmp_path / "eval.pt"), pretrained=False, batch=2
    )
    for split in result.values():
        for metric in ("eer", "auc", "top1", "map"):
            assert split["projection"][metric] == split["zeroshot"][metric], metric


def test_evaluate_reuses_the_feature_cache(synthetic_data_root, tmp_path):
    manifest = _manifest(synthetic_data_root, tmp_path)
    ckpt = _checkpoint(tmp_path)
    cache = str(tmp_path / "eval.pt")
    evaluate(manifest, ckpt, str(tmp_path / "r1.md"), device="cpu", cache=cache, pretrained=False, batch=2)
    # a manifest that no longer exists proves the second run never re-read the images
    result = evaluate(
        str(tmp_path / "gone.json"), ckpt, str(tmp_path / "r2.md"), device="cpu", cache=cache, pretrained=False
    )
    assert "dog" in result


def test_evaluate_reports_a_clustering_threshold_sweep(synthetic_data_root, tmp_path):
    """Phase 2 has to pick a production `maxDistance`; the report supplies the evidence."""
    manifest = _manifest(synthetic_data_root, tmp_path)
    result = evaluate(
        manifest,
        _checkpoint(tmp_path),
        str(tmp_path / "r.md"),
        device="cpu",
        cache=str(tmp_path / "eval.pt"),
        pretrained=False,
        batch=2,
    )
    sweep = next(iter(result.values()))["projection"]["cluster_sweep"]
    assert [row["threshold"] for row in sweep] == list(SWEEP_THRESHOLDS)
    assert "cosine distance" in (tmp_path / "r.md").read_text()


def test_evaluate_writes_machine_readable_metrics(synthetic_data_root, tmp_path):
    """publish.py consumes these numbers for the model card, so they must be on disk."""
    import json

    manifest = _manifest(synthetic_data_root, tmp_path)
    ckpt = _checkpoint(tmp_path)
    metrics_path = tmp_path / "metrics.json"
    result = evaluate(
        manifest,
        ckpt,
        str(tmp_path / "r.md"),
        device="cpu",
        cache=str(tmp_path / "eval.pt"),
        pretrained=False,
        batch=2,
        json_path=str(metrics_path),
    )
    assert json.loads(metrics_path.read_text()) == result


def test_evaluate_accepts_a_trained_checkpoint(synthetic_data_root, tmp_path):
    """End-to-end: the checkpoint train_run writes is what evaluate consumes."""
    manifest = _manifest(synthetic_data_root, tmp_path)
    torch.manual_seed(0)
    feats = torch.nn.functional.normalize(torch.randn(16, 384), dim=1)
    cache = tmp_path / "train.pt"
    torch.save({"dim": 384, "train_emb": feats, "train_ids": (torch.arange(16) % 4).numpy()}, cache)
    ckpt = train_run(
        out_dir=str(tmp_path / "run"),
        backbone="facebook/dinov2-small",
        cache=str(cache),
        epochs=1,
        batch=8,
        device="cpu",
    )
    result = evaluate(
        manifest, ckpt, str(tmp_path / "r.md"), device="cpu", cache=str(tmp_path / "eval.pt"), pretrained=False, batch=2
    )
    assert result["dog"]["projection"]["n"] > 0
