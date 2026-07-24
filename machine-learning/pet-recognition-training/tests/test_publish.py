import json

import pytest

from petid.publish import HF_ORG, model_card, repo_id_for, stage_repo


def _metrics():
    return {
        "dog": {"projection": {"n": 53830, "identities": 16469, "eer": 0.023, "top1": 0.919, "auc": 0.996}},
        "cat": {"projection": {"n": 2575, "identities": 102, "eer": 0.044, "top1": 0.915, "auc": 0.992}},
        "dog_dogfacenet": {"projection": {"n": 8363, "identities": 1393, "eer": 0.02, "top1": 0.97, "auc": 0.996}},
    }


def test_model_card_names_the_dataset_behind_each_split():
    card = model_card("facebook/dinov2-base", _metrics(), out_dim=512)
    assert "Dogs-World" in card and "Cat Individual Images" in card and "DogFaceNet" in card
    # the extra dog set is a different dataset AND a different domain (aligned faces)
    assert "dog_dogfacenet" not in card, "raw split keys should not leak into the card"


def test_repo_id_uses_the_gallery_org_and_product_naming():
    assert HF_ORG == "noodle-gallery"
    assert repo_id_for("facebook/dinov2-large") == "noodle-gallery/pet-recognition-large"
    assert repo_id_for("small") == "noodle-gallery/pet-recognition-small"


def test_repo_id_accepts_an_org_override():
    assert repo_id_for("base", org="someone-else") == "someone-else/pet-recognition-base"


def test_model_card_documents_the_io_contract_and_licensing():
    card = model_card("facebook/dinov2-base", _metrics(), out_dim=512)
    # I/O contract the ML service depends on
    assert "[N, 3, 224, 224]" in card and "[N, 512]" in card
    assert "L2-normalized" in card
    # licence + attribution of both the backbone and the training data
    assert "apache-2.0" in card
    assert "Dogs-World" in card and "CC0" in card
    assert "Cat Individual Images" in card and "CC BY" in card
    # measured quality, not vague claims
    assert "0.023" in card and "0.044" in card


def test_model_card_titles_the_model_by_its_repo_name():
    assert "# pet-recognition-base" in model_card("base", _metrics(), out_dim=512)


def test_model_card_frontmatter_is_first_and_well_formed():
    card = model_card("facebook/dinov2-small", _metrics(), out_dim=512)
    assert card.startswith("---\n")
    front = card.split("---\n")[1]
    assert "license: apache-2.0" in front
    assert "pipeline_tag: image-feature-extraction" in front


def test_stage_repo_lays_out_the_path_the_ml_service_downloads(tmp_path):
    onnx = tmp_path / "m.onnx"
    onnx.write_bytes(b"not-really-onnx")
    staged = stage_repo(str(onnx), "facebook/dinov2-base", _metrics(), str(tmp_path / "stage"), out_dim=512)

    # InferenceModel.model_path resolves to <cache_dir>/<model_type>/model.onnx
    assert (staged / "recognition" / "model.onnx").read_bytes() == b"not-really-onnx"
    assert (staged / "README.md").read_text().startswith("---\n")
    assert json.loads((staged / "metrics.json").read_text())["dog"]["projection"]["eer"] == 0.023


def test_stage_repo_rejects_an_unknown_backbone(tmp_path):
    onnx = tmp_path / "m.onnx"
    onnx.write_bytes(b"x")
    with pytest.raises(ValueError):
        stage_repo(str(onnx), "facebook/dinov2-giant", _metrics(), str(tmp_path / "stage"), out_dim=512)
