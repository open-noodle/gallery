# tests/test_train.py
import torch

from petid.evaluate import evaluate
from petid.manifest import build
from petid.train import train_run


def test_head_config_smoke(synthetic_data_root, tmp_path):
    manifest = tmp_path / "m.json"
    build(str(synthetic_data_root), str(manifest), min_images=2, test_frac=0.5, seed=0)
    ckpt = train_run(
        str(manifest), str(tmp_path / "run"), config="head", epochs=1, batch=2, bf16=False, device="cpu", limit=6
    )
    blob = torch.load(ckpt, map_location="cpu")
    assert "embedder" in blob and blob["config"] == "head"


def test_zeroshot_saves_without_training(synthetic_data_root, tmp_path):
    manifest = tmp_path / "m.json"
    build(str(synthetic_data_root), str(manifest), min_images=2, test_frac=0.5, seed=0)
    ckpt = train_run(
        str(manifest), str(tmp_path / "z"), config="zeroshot", epochs=1, batch=2, bf16=False, device="cpu", limit=6
    )
    assert torch.load(ckpt, map_location="cpu")["config"] == "zeroshot"


def test_evaluate_smoke(synthetic_data_root, tmp_path):
    manifest = tmp_path / "m.json"
    build(str(synthetic_data_root), str(manifest), min_images=2, test_frac=0.5, seed=0)
    ckpt = train_run(
        str(manifest), str(tmp_path / "z"), config="zeroshot", epochs=1, batch=2, bf16=False, device="cpu", limit=6
    )
    report = tmp_path / "report.md"
    result = evaluate(str(manifest), ckpt, str(report), device="cpu")
    assert report.exists()
    assert "dog" in result or "cat" in result  # at least one species evaluated


def test_full_config_smoke(synthetic_data_root, tmp_path):
    manifest = tmp_path / "m.json"
    build(str(synthetic_data_root), str(manifest), min_images=2, test_frac=0.5, seed=0)
    ckpt = train_run(
        str(manifest), str(tmp_path / "f"), config="full", epochs=1, batch=2, bf16=False, device="cpu", limit=6
    )
    blob = torch.load(ckpt, map_location="cpu")
    assert blob["config"] == "full" and "embedder" in blob
