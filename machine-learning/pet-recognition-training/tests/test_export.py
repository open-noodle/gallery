import numpy as np
import onnx
import onnxruntime as ort
import pytest
import torch
import torch.nn.functional as F

from petid.export_onnx import (
    ONNX_SINGLE_FILE_LIMIT,
    check_single_file_limit,
    export,
    export_checkpoint,
    parity,
)
from petid.model import OUT_DIM, PetEmbedder, PetProjection


@pytest.fixture
def checkpoint(tmp_path):
    """A small-backbone checkpoint with a non-trivial (xavier, biased) projection."""
    torch.manual_seed(0)
    proj = PetProjection(384, OUT_DIM, "xavier")
    with torch.no_grad():
        proj.linear.bias.normal_(0, 0.1)
    path = tmp_path / "best.pt"
    torch.save({"backbone": "facebook/dinov2-small", "out_dim": OUT_DIM, "projection": proj.state_dict()}, path)
    return str(path)


@pytest.fixture
def model(checkpoint):
    # pretrained=False builds a randomly-initialized backbone, so the SAME instance must be
    # used for exporting and for checking parity.
    return PetEmbedder.from_checkpoint(checkpoint, device="cpu", pretrained=False)


def test_export_writes_an_opset17_dynamic_batch_512d_model(model, tmp_path):
    out = str(tmp_path / "m.onnx")
    export(model, out)

    graph = onnx.load(out)
    assert graph.opset_import[0].version == 17
    (inp,), (emb,) = graph.graph.input, graph.graph.output
    assert inp.name == "input" and emb.name == "embedding"
    in_dims = [d.dim_param or d.dim_value for d in inp.type.tensor_type.shape.dim]
    out_dims = [d.dim_param or d.dim_value for d in emb.type.tensor_type.shape.dim]
    assert in_dims == ["batch", 3, 224, 224]
    assert out_dims == ["batch", OUT_DIM]


def test_export_parity_with_torch(model, tmp_path):
    out = str(tmp_path / "m.onnx")
    export(model, out)
    assert parity(model, out) < 1e-3


def test_exported_model_computes_the_evaluated_pipeline(model, tmp_path):
    """ONNX output must equal projection(normalize(backbone_pooler(x))).

    That right-hand side is exactly what training and evaluation run on (the cached
    features are normalized backbone features), so this is what ties the published model
    to the reported numbers.
    """
    out = str(tmp_path / "m.onnx")
    export(model, out)

    x = torch.randn(2, 3, 224, 224)
    with torch.no_grad():
        cached_features = F.normalize(model.backbone(x).pooler_output, dim=1)
        expected = model.projection(cached_features).numpy()
    got = ort.InferenceSession(out, providers=["CPUExecutionProvider"]).run(None, {"input": x.numpy()})[0]

    assert np.abs(got - expected).max() < 1e-3
    assert np.allclose(np.linalg.norm(got, axis=1), 1.0, atol=1e-4)


def test_exported_model_accepts_any_batch_size(model, tmp_path):
    out = str(tmp_path / "m.onnx")
    export(model, out)
    sess = ort.InferenceSession(out, providers=["CPUExecutionProvider"])

    x = torch.randn(3, 3, 224, 224).numpy()
    one = sess.run(None, {"input": x[:1]})[0]
    three = sess.run(None, {"input": x})[0]
    assert one.shape == (1, OUT_DIM) and three.shape == (3, OUT_DIM)
    assert np.abs(one[0] - three[0]).max() < 1e-4


def test_export_checkpoint_reports_size_and_parity(checkpoint, tmp_path):
    info = export_checkpoint(checkpoint, str(tmp_path / "m.onnx"), pretrained=False)
    assert info["backbone"] == "facebook/dinov2-small"
    assert info["parity"] < 1e-3
    assert 0 < info["bytes"] < ONNX_SINGLE_FILE_LIMIT


def test_export_checkpoint_fails_loudly_on_bad_parity(checkpoint, tmp_path):
    with pytest.raises(ValueError, match="parity check FAILED"):
        export_checkpoint(checkpoint, str(tmp_path / "m.onnx"), pretrained=False, atol=1e-12)


def test_single_file_limit_guard(model, tmp_path):
    out = str(tmp_path / "m.onnx")
    export(model, out)
    assert check_single_file_limit(out) < ONNX_SINGLE_FILE_LIMIT  # small backbone is ~90 MB
    with pytest.raises(ValueError, match="2 GB"):
        check_single_file_limit(out, limit=1024)
