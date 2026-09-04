"""Export the fused embedder (backbone -> projection -> L2-normalize) to one ONNX file.

The ML service runs a single ONNX session per model, so the backbone and the trained
projection ship fused: input `[N,3,224,224]` ImageNet-normalized float32, output
`embedding` `[N,512]` L2-normalized, dynamic batch.
"""

import argparse
import os

import numpy as np
import onnx
import onnxruntime as ort
import torch

from petid.model import PetEmbedder

#: ONNX protobuf limit for a single file; past it a model needs external-data format.
ONNX_SINGLE_FILE_LIMIT = 2 * 1024**3


def check_single_file_limit(onnx_path: str, limit: int = ONNX_SINGLE_FILE_LIMIT) -> int:
    size = os.path.getsize(onnx_path)
    if size >= limit:
        raise ValueError(
            f"{onnx_path} is {size / 1024**3:.2f} GB and crosses the ONNX 2 GB single-file limit "
            "— it would need external-data format, which the ML service does not load"
        )
    return size


def export(model: PetEmbedder, out_onnx: str, device: str = "cpu") -> str:
    """Export an already-loaded embedder. Callers pass the *same* instance to `parity`."""
    model = model.to(device).eval()
    dummy = torch.randn(1, 3, 224, 224, device=device)
    os.makedirs(os.path.dirname(os.path.abspath(out_onnx)), exist_ok=True)
    torch.onnx.export(
        model,
        dummy,
        out_onnx,
        input_names=["input"],
        output_names=["embedding"],
        dynamic_axes={"input": {0: "batch"}, "embedding": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    _pin_embedding_width(out_onnx, model.projection.linear.out_features)
    return out_onnx


def _pin_embedding_width(onnx_path: str, out_dim: int) -> None:
    """Declare the embedding width statically; only the batch axis is dynamic.

    The tracer leaves dim 1 symbolic (named after the normalize's Div node), which reads as
    "unknown width" to consumers of the model.
    """
    graph = onnx.load(onnx_path)
    dim = graph.graph.output[0].type.tensor_type.shape.dim[1]
    dim.ClearField("dim_param")
    dim.dim_value = out_dim
    onnx.save(graph, onnx_path)


def parity(model: PetEmbedder, onnx_path: str, device: str = "cpu", batch: int = 3) -> float:
    """Max absolute difference between the torch model and onnxruntime."""
    model = model.to(device).eval()
    x = torch.randn(batch, 3, 224, 224, device=device)
    with torch.no_grad():
        torch_out = model(x).cpu().numpy()
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    ort_out = sess.run(["embedding"], {"input": x.cpu().numpy()})[0]
    return float(np.abs(torch_out - ort_out).max())


def export_checkpoint(
    checkpoint: str,
    out_onnx: str,
    device: str = "cpu",
    pretrained: bool = True,
    atol: float = 1e-3,
) -> dict:
    """Load once, export, then verify size and torch<->onnxruntime parity."""
    model = PetEmbedder.from_checkpoint(checkpoint, device=device, pretrained=pretrained)
    export(model, out_onnx, device=device)
    size = check_single_file_limit(out_onnx)
    diff = parity(model, out_onnx, device=device)
    if diff >= atol:
        raise ValueError(f"parity check FAILED for {out_onnx}: {diff:.2e} >= {atol:.0e}")
    return {"path": out_onnx, "bytes": size, "parity": diff, "backbone": model.backbone_name}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--atol", type=float, default=1e-3)
    a = ap.parse_args()
    info = export_checkpoint(a.checkpoint, a.out, device=a.device, atol=a.atol)
    print(
        f"exported {info['path']}  ({info['bytes'] / 1024**2:.0f} MB, {info['backbone']})  "
        f"parity_max_diff={info['parity']:.2e}"
    )


if __name__ == "__main__":
    main()
