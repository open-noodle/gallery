"""Stage and publish a trained pet re-ID model to the Hugging Face Hub.

Layout mirrors what the ML service downloads: `InferenceModel.model_path` resolves to
`<cache_dir>/<model_type>/model.onnx`, so a recognition model lives at
`recognition/model.onnx` inside the repo (same convention as the RF-DETR pet detector).
"""

import argparse
import json
import os
import shutil
from pathlib import Path

from petid.model import OUT_DIM, resolve_backbone

HF_ORG = "noodle-gallery"

_SHORT = {"facebook/dinov2-small": "small", "facebook/dinov2-base": "base", "facebook/dinov2-large": "large"}
_PARAMS = {"small": "22M", "base": "86M", "large": "300M"}


#: Repo name doubles as the user-facing `petRecognition.modelName` in the admin UI, so it
#: follows the product's vocabulary ("pet recognition") rather than the ML term "re-ID".
def repo_id_for(backbone: str, org: str = HF_ORG) -> str:
    return f"{org}/pet-recognition-{_SHORT[resolve_backbone(backbone)]}"


_SPLIT_LABELS = {
    "dog": "Dogs — Dogs-World (whole animal)",
    "cat": "Cats — Cat Individual Images (whole animal)",
    "dog_dogfacenet": "Dogs — DogFaceNet (unseen dataset, aligned faces)",
}


def _metrics_table(metrics: dict) -> str:
    rows = ["| Test set | Images | Identities | EER | Top-1 | AUC |", "| --- | --- | --- | --- | --- | --- |"]
    for split, variants in metrics.items():
        m = variants.get("projection", variants)
        rows.append(
            f"| {_SPLIT_LABELS.get(split, split)} | {int(m['n'])} | {int(m['identities'])} | "
            f"{m['eer']:.3f} | {m['top1']:.3f} | {m['auc']:.3f} |"
        )
    return "\n".join(rows)


def model_card(backbone: str, metrics: dict, out_dim: int = OUT_DIM) -> str:
    backbone = resolve_backbone(backbone)
    short = _SHORT[backbone]
    return f"""---
license: apache-2.0
pipeline_tag: image-feature-extraction
tags:
  - pet-re-identification
  - image-embeddings
  - onnx
  - dinov2
library_name: onnx
---

# pet-recognition-{short}

Individual **pet re-identification** embeddings (dogs and cats) — the "which pet is this"
layer used by [Gallery](https://opennoodle.de)'s pet recognition, on top of whole-animal
crops from its pet detector.

A **frozen [`{backbone}`](https://huggingface.co/{backbone})** backbone ({_PARAMS[short]}
parameters) plus a **trained linear projection** to {out_dim} dimensions. The projection's
L2-normalized output *is* the embedding; identity is compared with cosine similarity.
Fine-tuning the backbone was tried and rejected — it overfits the training identities and
forgets DINOv2's general features, while the frozen-backbone projection beats zeroshot on
both species.

## I/O contract

| | |
| --- | --- |
| Input | `input`, float32 `[N, 3, 224, 224]`, RGB, ImageNet mean/std normalized |
| Output | `embedding`, float32 `[N, {out_dim}]`, **L2-normalized** |
| Batch | dynamic |
| Opset | 17 |

Crop the detected animal's bounding box, resize to 224x224, normalize with ImageNet
statistics (mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]`). Compare embeddings
with cosine similarity (equivalently, dot product — the outputs are unit vectors).

## Quality

Verification EER and identification Top-1 on **held-out identities** — individuals never
seen in training — scored over the complete test splits:

{_metrics_table(metrics)}

## Training data & licensing

The backbone is Apache-2.0. The projection was trained **only** on openly-licensed data:

- **Dogs-World** (CC0) — whole-animal dog photos, identity from the per-image metadata
  sidecars; single-dog images only.
- **Cat Individual Images** (CC BY) — whole-animal cat photos, one directory per cat.

DogFaceNet (CC BY) is used for evaluation only. No restrictively-licensed pet re-ID
dataset (PetFace, AvitoTech, MegaDescriptor) was used for training or distillation, so
this model is safe for commercial use.

## Siblings

`pet-recognition-small` / `pet-recognition-base` / `pet-recognition-large` trade accuracy
against cost; `base` is Gallery's default.
"""


def stage_repo(onnx_path: str, backbone: str, metrics: dict, staging_dir: str, out_dim: int = OUT_DIM) -> Path:
    """Assemble the exact directory that gets uploaded."""
    backbone = resolve_backbone(backbone)
    staged = Path(staging_dir)
    if staged.exists():
        shutil.rmtree(staged)
    (staged / "recognition").mkdir(parents=True)
    shutil.copyfile(onnx_path, staged / "recognition" / "model.onnx")
    (staged / "README.md").write_text(model_card(backbone, metrics, out_dim))
    (staged / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return staged


def upload(staging_dir: str, repo_id: str, private: bool = False) -> str:
    from huggingface_hub import HfApi

    api = HfApi()
    api.create_repo(repo_id, repo_type="model", private=private, exist_ok=True)
    api.upload_folder(folder_path=staging_dir, repo_id=repo_id, repo_type="model")
    return f"https://huggingface.co/{repo_id}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--backbone", required=True)
    ap.add_argument("--metrics", required=True, help="metrics.json written by petid.evaluate --json")
    ap.add_argument("--staging", default=None)
    ap.add_argument("--org", default=HF_ORG)
    ap.add_argument("--upload", action="store_true", help="actually push to the Hub")
    a = ap.parse_args()

    with open(a.metrics) as f:
        metrics = json.load(f)
    repo_id = repo_id_for(a.backbone, a.org)
    staging = a.staging or os.path.join("runs", "publish", repo_id.split("/")[-1])
    staged = stage_repo(a.onnx, a.backbone, metrics, staging)
    print(f"staged {repo_id} at {staged}")
    if a.upload:
        print(f"uploaded: {upload(str(staged), repo_id)}")
    else:
        print("dry run — pass --upload to push")


if __name__ == "__main__":
    main()
