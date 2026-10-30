# Spatial Scene depth model export

Produces the ONNX models behind Spatial Scene (`specs/2026-10-29-spatial-scene-design.md`) in the layout the ML service
downloads from `open-noodle/<name>` on Hugging Face (`immich_ml/models/gallery_hosted.py`). Not part of the production
ML service, which only consumes the published files.

| Name                      | Source                                      | Licence    | Files                                            |
| ------------------------- | ------------------------------------------- | ---------- | ------------------------------------------------ |
| `depth-anything-v2-small` | `depth-anything/Depth-Anything-V2-Small-hf` | Apache-2.0 | `model.onnx` (101 MB), `model_int8.onnx` (29 MB) |
| `distill-any-depth-small` | `xingyang1/Distill-Any-Depth-Small-hf`      | MIT        | `model.onnx`, `model_int8.onnx`                  |
| `distill-any-depth-large` | `xingyang1/Distill-Any-Depth-Large-hf`      | MIT        | `model.onnx` (1.3 GB), no int8                   |

The large model has no int8 copy because int8 kept only 85% of its suitability decisions; the service never asks for
one (`INT8_MODELS` in `immich_ml/models/depth_estimation/depth.py`).

## Export

Requires [uv](https://docs.astral.sh/uv/). The script pins its own dependencies.

```bash
uv run --script export.py depth-anything-v2-small out/
uv run --script export.py distill-any-depth-small out/
uv run --script export.py distill-any-depth-large out/
```

Each run writes `out/<name>/` with `depth/model.onnx`, `depth/model_int8.onnx` (small models), `config.json` and a model
card `README.md`, then checks that portrait, landscape and wide inputs come back at their own size and that the int8
copy agrees with fp32 (correlation 0.996 for `depth-anything-v2-small`).

The one graph change is the depth head's final resize. Transformers sizes it from the patch grid, which every exporter
freezes at the example input's size, so a portrait photo would come back with landscape dimensions. The script replaces
it with the equivalent scale factor (1.75, checked against three sizes), exports with the dynamo exporter, and renames
the free dimensions to `height` and `width`, the names the service's `ShapePolicy` pins on static-shape providers.

## Publish

Each folder is one Hugging Face repository under `open-noodle`, named after the model:

```bash
hf upload open-noodle/depth-anything-v2-small out/depth-anything-v2-small . --repo-type model
```

Then check a fresh ML container downloads it: enable Spatial Scene, upload a photo, and look for
`Downloading depth model 'depth-anything-v2-small'` in the ML log followed by a depth map for the photo.
