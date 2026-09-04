from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image

from immich_ml.config import clean_name
from immich_ml.models.base import InferenceModel
from immich_ml.models.transforms import decode_pil
from immich_ml.schemas import BoundingBox, ModelFormat, ModelSession, ModelTask, ModelType, PetDetectionOutput

_HF_ORG = "open-noodle"

# The animals a household photo library actually contains, in RF-DETR's 91-class
# COCO id space. bear/zebra/giraffe/elephant are deliberately absent: their only
# practical effect was labelling bear-shaped dog breeds (newfoundland, keeshond,
# great pyrenees) as bears.
_ANIMAL_CLASSES: dict[int, str] = {
    16: "bird",
    17: "cat",
    18: "dog",
    19: "horse",
    20: "sheep",
    21: "cow",
}
_ANIMAL_IDS = np.array(sorted(_ANIMAL_CLASSES), dtype=np.int64)

# Only cats and dogs are surfaced. The remaining _ANIMAL_CLASSES entries stay in the
# scoring subspace above purely as distractors: a horse has to be able to win its own
# argmax so that it is discarded below. Dropping it from the subspace instead would
# force it onto its best cat/dog score and file horses and cows under the dog entry.
_PET_CLASSES: dict[int, str] = {
    17: "cat",
    18: "dog",
}
_PET_IDS = np.array(sorted(_PET_CLASSES), dtype=np.int64)

# RF-DETR inherits DINOv2's ImageNet normalisation.
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

_DEFAULT_INPUT_SIZE = 384


class PetDetector(InferenceModel):
    depends = []
    identity = (ModelType.DETECTION, ModelTask.PET_DETECTION)

    def __init__(self, model_name: str, min_score: float = 0.3, **model_kwargs: Any) -> None:
        self.min_score = model_kwargs.pop("minScore", min_score)
        self._input_size = _DEFAULT_INPUT_SIZE
        super().__init__(model_name, **model_kwargs)

    @property
    def model_path(self) -> Path:
        # Support both conventions:
        # 1. Standard: detection/model.onnx (matches base class)
        # 2. Legacy: <model_name>.onnx at cache root
        standard = super().model_path
        if standard.is_file():
            return standard
        alt = self.cache_dir / f"{self.model_name}.onnx"
        if alt.is_file():
            return alt
        return standard

    def _download(self) -> None:
        from huggingface_hub import snapshot_download

        ignored_patterns: dict[ModelFormat, list[str]] = {
            ModelFormat.ONNX: ["*.armnn", "*.rknn"],
            ModelFormat.ARMNN: ["*.rknn"],
            ModelFormat.RKNN: ["*.armnn"],
        }
        snapshot_download(
            f"{_HF_ORG}/{clean_name(self.model_name)}",
            cache_dir=self.cache_dir,
            local_dir=self.cache_dir,
            ignore_patterns=ignored_patterns.get(self.model_format, []),
        )

    def _load(self) -> ModelSession:
        session = self._make_session(self.model_path)
        model_input = session.get_inputs()[0]
        if model_input.name is None:
            raise ValueError("Model input name is None")
        self._input_name: str = model_input.name
        # nano is 384, small is 512 — never assume.
        shape = model_input.shape
        if len(shape) == 4 and isinstance(shape[2], int):
            self._input_size = shape[2]
        return session

    def _predict(self, inputs: Image.Image | bytes) -> PetDetectionOutput:
        # main.py:201 already decodes the upload to a PIL image, so in production
        # this receives an Image.Image. decode_pil passes one straight through.
        image = decode_pil(inputs)
        orig_w, orig_h = image.size

        blob = self._preprocess(image)
        outputs = self.session.run(None, {self._input_name: blob})

        return self._postprocess(outputs, orig_w, orig_h)

    def _preprocess(self, image: Image.Image) -> NDArray[np.float32]:
        # decode_pil only converts mode on the bytes path — handed an Image.Image
        # it returns it untouched, so greyscale and palette inputs must be
        # converted here or the normalisation below fails on a 2-D array.
        if image.mode != "RGB":
            image = image.convert("RGB")
        # Do NOT route through decode_cv2: its RGB->BGR conversion is the defect
        # this rewrite exists to remove.
        rgb: NDArray[np.uint8] = np.array(image)
        resized = cv2.resize(rgb, (self._input_size, self._input_size), interpolation=cv2.INTER_LINEAR)
        blob: NDArray[np.float32] = resized.astype(np.float32) / 255.0
        blob = (blob - _MEAN) / _STD
        blob = np.transpose(blob, (2, 0, 1))  # HWC -> CHW
        return np.expand_dims(blob, axis=0).astype(np.float32)

    def _postprocess(self, outputs: list[NDArray[np.float32]], orig_w: int, orig_h: int) -> PetDetectionOutput:
        boxes_raw, logits = self._resolve_outputs(outputs)
        boxes_cxcywh = boxes_raw[0]
        # RF-DETR emits pre-sigmoid logits over the 91-class COCO space.
        scores_all = 1.0 / (1.0 + np.exp(-logits[0]))

        # Restrict to the domestic subspace *before* taking the best class, so a
        # query that scores bear highest still surfaces as its best pet class.
        animal_scores = scores_all[:, _ANIMAL_IDS]
        best = np.argmax(animal_scores, axis=1)
        confidences = animal_scores[np.arange(len(best)), best]
        class_ids = _ANIMAL_IDS[best]

        keep = (confidences >= self.min_score) & np.isin(class_ids, _PET_IDS)
        boxes_cxcywh = boxes_cxcywh[keep]
        confidences = confidences[keep]
        class_ids = class_ids[keep]

        if len(boxes_cxcywh) == 0:
            return []

        cx, cy, w, h = (
            boxes_cxcywh[:, 0],
            boxes_cxcywh[:, 1],
            boxes_cxcywh[:, 2],
            boxes_cxcywh[:, 3],
        )
        x1 = np.clip((cx - w / 2) * orig_w, 0, orig_w)
        y1 = np.clip((cy - h / 2) * orig_h, 0, orig_h)
        x2 = np.clip((cx + w / 2) * orig_w, 0, orig_w)
        y2 = np.clip((cy + h / 2) * orig_h, 0, orig_h)

        # No NMS: RF-DETR's queries are already deduplicated by the decoder.
        results: PetDetectionOutput = []
        for i in range(len(confidences)):
            box: BoundingBox = {
                "x1": int(round(float(x1[i]))),
                "y1": int(round(float(y1[i]))),
                "x2": int(round(float(x2[i]))),
                "y2": int(round(float(y2[i]))),
            }
            # A box clipped away to nothing is not a detection.
            if box["x2"] <= box["x1"] or box["y2"] <= box["y1"]:
                continue
            results.append(
                {
                    "boundingBox": box,
                    "score": float(confidences[i]),
                    "label": _PET_CLASSES[int(class_ids[i])],
                }
            )

        return results

    @staticmethod
    def _resolve_outputs(
        outputs: list[NDArray[np.float32]],
    ) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
        """Identify boxes vs logits by trailing dimension, not export order."""
        if outputs[0].shape[-1] == 4:
            return outputs[0], outputs[1]
        return outputs[1], outputs[0]

    def configure(self, **kwargs: Any) -> None:
        self.min_score = kwargs.pop("minScore", self.min_score)
