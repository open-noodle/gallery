import argparse

import numpy as np
import onnxruntime as ort
import torch

from petid.model import PetEmbedder


def _load(checkpoint: str, device: str) -> PetEmbedder:
    blob = torch.load(checkpoint, map_location=device)
    m = PetEmbedder(pretrained=False).to(device)
    m.load_state_dict(blob["embedder"])
    m.eval()
    return m


def export(checkpoint: str, out_onnx: str, device: str = "cpu") -> str:
    model = _load(checkpoint, device)
    dummy = torch.randn(1, 3, 224, 224, device=device)
    torch.onnx.export(
        model,
        dummy,
        out_onnx,
        input_names=["input"],
        output_names=["embedding"],
        dynamic_axes={"input": {0: "batch"}, "embedding": {0: "batch"}},
        opset_version=17,
    )
    return out_onnx


def parity(checkpoint: str, onnx_path: str, device: str = "cpu", atol: float = 1e-3) -> float:
    model = _load(checkpoint, device)
    x = torch.randn(3, 3, 224, 224, device=device)
    with torch.no_grad():
        torch_out = model(x).cpu().numpy()
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    ort_out = sess.run(["embedding"], {"input": x.cpu().numpy()})[0]
    return float(np.abs(torch_out - ort_out).max())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    path = export(a.checkpoint, a.out)
    diff = parity(a.checkpoint, a.out)
    print(f"exported {path}  parity_max_diff={diff:.2e}")


if __name__ == "__main__":
    main()
