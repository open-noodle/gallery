# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = [
#   "numpy",
#   "onnx==1.23.2",
#   "onnxruntime==1.31.1",
#   "onnxscript==0.7.2",
#   "torch==2.15.0",
#   "transformers==5.22.0",
# ]
# ///
"""Export a Spatial Scene depth model to the layout Gallery's ML service downloads from open-noodle/<name>.

Writes one Hugging Face repository's worth of files (see README.md):
  <out>/<name>/depth/model.onnx          fp32
  <out>/<name>/depth/model_int8.onnx     dynamic int8 weights, for the small models only
  <out>/<name>/config.json               provenance and preprocessing
  <out>/<name>/README.md                 model card

usage: uv run --script export.py <name> <out_dir>
"""

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModelForDepthEstimation


@dataclass(frozen=True)
class Model:
    source: str
    title: str
    license: str
    arxiv: str
    # Matches INT8_MODELS in immich_ml/models/depth_estimation/depth.py: int8 kept only 85% of the large model's
    # suitability decisions, so it ships fp32 only.
    int8: bool


MODELS = {
    "depth-anything-v2-small": Model(
        "depth-anything/Depth-Anything-V2-Small-hf", "Depth Anything V2 Small", "apache-2.0", "2406.09414", True
    ),
    "distill-any-depth-small": Model(
        "xingyang1/Distill-Any-Depth-Small-hf", "Distill-Any-Depth Small", "mit", "2502.19204", True
    ),
    "distill-any-depth-large": Model(
        "xingyang1/Distill-Any-Depth-Large-hf", "Distill-Any-Depth Large", "mit", "2502.19204", False
    ),
}

# Portrait, landscape and wide inputs at the service's 518 short side, all multiples of the 14 px patch.
CHECK_SIZES = ((518, 686), (686, 518), (518, 924))


def head_scale(model: torch.nn.Module) -> float:
    """The ratio of the image size to the depth head's input size, which must not depend on the image size."""
    seen: list[tuple[int, int]] = []
    hook = model.head.conv1.register_forward_hook(lambda _m, _i, out: seen.append(tuple(out.shape[2:])))
    with torch.no_grad():
        for h, w in CHECK_SIZES:
            model(pixel_values=torch.zeros(1, 3, h, w))
    hook.remove()
    ratios = {r for (h, w), (sh, sw) in zip(CHECK_SIZES, seen) for r in (h / sh, w / sw)}
    if len(ratios) != 1:
        raise ValueError(f"head input is not a fixed fraction of the image: {ratios}")
    return ratios.pop()


def resize_by_scale(head: torch.nn.Module, scale: float) -> None:
    """Make the depth head's final resize a scale factor instead of a size.

    Transformers computes the size as `int(patch_height * patch_size)`, which every exporter freezes at the dummy
    input's size, so a portrait photo would come back with landscape dimensions. The head's input is always the same
    fraction of the image (checked by `head_scale`), so the equivalent scale factor exports with symbolic shapes.
    """

    def forward(hidden_states, patch_height, patch_width):  # noqa: ARG001 - the original's signature
        predicted_depth = head.conv1(hidden_states[head.head_in_index])
        predicted_depth = torch.nn.functional.interpolate(
            predicted_depth, scale_factor=scale, mode="bilinear", align_corners=True
        )
        predicted_depth = head.activation1(head.conv2(predicted_depth))
        predicted_depth = head.activation2(head.conv3(predicted_depth)) * head.max_depth
        return predicted_depth.squeeze(dim=1)

    head.forward = forward


def name_dims(path: Path) -> None:
    """Name the free dims `height`/`width`: the ML service's ShapePolicy pins those names on static-shape providers
    (`immich_ml/sessions/ort.py`). The exporter names them after its own symbols (`14*rows`)."""
    model = onnx.load(str(path))
    for value in (*model.graph.input, *model.graph.output):
        for dim, name in zip(value.type.tensor_type.shape.dim[-2:], ("height", "width")):
            dim.ClearField("dim_value")
            dim.dim_param = name
    del model.graph.value_info[:]  # stale symbolic shapes; ONNX Runtime re-infers them
    onnx.save(model, str(path))


class Wrapper(torch.nn.Module):
    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
        return self.model(pixel_values=pixel_values).predicted_depth


def check(fp32: Path, int8: Path | None) -> None:
    """Every check size must come back at its own size, and the int8 copy must agree with fp32."""
    rng = np.random.default_rng(0)
    inputs = [rng.random((1, 3, h, w), dtype=np.float32) for h, w in CHECK_SIZES]
    sessions = {
        path: ort.InferenceSession(str(path), providers=["CPUExecutionProvider"]) for path in (fp32, int8) if path
    }
    outputs = {path: [s.run(None, {"pixel_values": x})[0] for x in inputs] for path, s in sessions.items()}
    for path, outs in outputs.items():
        shapes = [out.shape[-2:] for out in outs]
        if shapes != list(CHECK_SIZES):
            raise ValueError(f"{path.name}: output sizes {shapes} do not match the inputs {list(CHECK_SIZES)}")
    print(f"output sizes match the inputs: {list(CHECK_SIZES)}")
    if int8:
        corr = min(np.corrcoef(a.ravel(), b.ravel())[0, 1] for a, b in zip(outputs[fp32], outputs[int8]))
        print(f"int8 vs fp32 correlation (lowest of {len(inputs)}): {corr:.4f}")


def model_card(model: Model) -> str:
    files = "| `depth/model.onnx`       | fp32, opset 18                          |\n"
    if model.int8:
        files += "| `depth/model_int8.onnx`  | dynamic int8 weights, used on CPU only  |\n"
    return f"""---
license: {model.license}
tags:
  - onnx
  - depth-estimation
  - spatial-scene
library_name: onnx
pipeline_tag: depth-estimation
base_model: {model.source}
---

# {model.title} (ONNX), Spatial Scene for Gallery

ONNX export of [{model.title}](https://huggingface.co/{model.source})
([arXiv:{model.arxiv}](https://arxiv.org/abs/{model.arxiv})), used by
[Gallery](https://github.com/open-noodle/gallery) for Spatial Scene depth maps.

Unmodified weights, exported by `machine-learning/depth-model-export/export.py` in the Gallery repository. The only
graph change is the depth head's final resize, which becomes a scale factor so height and width stay dynamic.

## Files

| Path                     | Description                             |
| ------------------------ | --------------------------------------- |
{files}| `config.json`            | source and preprocessing                |

## Inference contract

**Input**: `pixel_values`, shape `[1, 3, height, width]`, float32. RGB scaled to 0..1, then normalised with ImageNet
mean `[0.485, 0.456, 0.406]` and std `[0.229, 0.224, 0.225]`. Height and width are multiples of 14; Gallery resizes the
short side to 518.

**Output**: `predicted_depth`, shape `[1, height, width]`, float32. Relative inverse depth (disparity): larger is
nearer, with no fixed scale.

## Licence

{"Apache-2.0" if model.license == "apache-2.0" else "MIT"}, as the source model.
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("name", choices=sorted(MODELS), help="Gallery model name")
    parser.add_argument("out", type=Path, help="output folder; the repository is written to <out>/<name>")
    args = parser.parse_args()
    model = MODELS[args.name]

    target = args.out / args.name / "depth"
    target.mkdir(parents=True, exist_ok=True)
    depth_model = AutoModelForDepthEstimation.from_pretrained(model.source).eval()
    scale = head_scale(depth_model)
    print(f"head scale factor: {scale}")
    resize_by_scale(depth_model.head, scale)

    fp32 = target / "model.onnx"
    # The TorchScript exporter casts traced shapes to int and freezes the resize anyway; the dynamo exporter keeps
    # height and width symbolic. 160 patches is the service's cap on the long side (2240 px).
    rows, cols = torch.export.Dim("rows", min=8, max=160), torch.export.Dim("cols", min=8, max=160)
    program = torch.onnx.export(
        Wrapper(depth_model),
        (torch.randn(1, 3, 518, 686),),
        input_names=["pixel_values"],
        output_names=["predicted_depth"],
        dynamic_shapes={"pixel_values": {2: 14 * rows, 3: 14 * cols}},
        opset_version=18,
        dynamo=True,
        external_data=False,
    )
    program.save(str(fp32), external_data=False)
    name_dims(fp32)

    int8 = None
    if model.int8:
        int8 = target / "model_int8.onnx"
        quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QUInt8)

    (args.out / args.name / "README.md").write_text(model_card(model))
    (args.out / args.name / "config.json").write_text(
        json.dumps(
            {
                "source": f"https://huggingface.co/{model.source}",
                "architecture": "depth-anything-v2",
                "output": "relative inverse depth (disparity), larger is nearer",
                "input": {
                    "shortSide": 518,
                    "multipleOf": 14,
                    "mean": [0.485, 0.456, 0.406],
                    "std": [0.229, 0.224, 0.225],
                },
            },
            indent=2,
        )
        + "\n"
    )
    check(fp32, int8)
    for path in sorted((args.out / args.name).rglob("*.*")):
        print(f"{path.relative_to(args.out)}: {path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
