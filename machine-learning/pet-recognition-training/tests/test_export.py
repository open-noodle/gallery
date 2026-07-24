import onnx
import torch

from petid.export_onnx import export, parity
from petid.model import PetEmbedder


def test_export_and_parity(tmp_path):
    ckpt = tmp_path / "best.pt"
    torch.save({"embedder": PetEmbedder(pretrained=False).state_dict(), "config": "full"}, ckpt)
    onnx_path = tmp_path / "m.onnx"
    export(str(ckpt), str(onnx_path), device="cpu")
    assert onnx_path.exists()

    model = onnx.load(str(onnx_path))
    assert model.opset_import[0].version == 17, f"expected opset 17, got {model.opset_import[0].version}"

    max_diff = parity(str(ckpt), str(onnx_path), device="cpu")
    assert max_diff < 1e-3
