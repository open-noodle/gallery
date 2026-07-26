from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
from huggingface_hub import snapshot_download
from numpy.typing import NDArray
from PIL import Image

from immich_ml.config import clean_name, settings
from immich_ml.models.base import InferenceModel
from immich_ml.models.transforms import decode_cv2, serialize_np_array
from immich_ml.schemas import (
    BoundingBox,
    DetectedPet,
    ModelFormat,
    ModelSession,
    ModelTask,
    ModelType,
    PetDetectionOutput,
    PetRecognitionOutput,
)

_HF_ORG = "open-noodle"

_INPUT_SIZE = 224
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# A crop this small on either side (post-clamp) yields a degenerate resize that the training
# pipeline never produced — skip recognition rather than embed garbage.
_MIN_CROP_SIDE = 2


class PetRecognizer(InferenceModel):
    depends = [(ModelType.DETECTION, ModelTask.PET_DETECTION)]
    identity = (ModelType.RECOGNITION, ModelTask.PET_DETECTION)

    def __init__(self, model_name: str, **model_kwargs: Any) -> None:
        super().__init__(model_name, **model_kwargs)
        max_batch_size = settings.max_batch_size and settings.max_batch_size.pet_recognition
        self.batch_size = max_batch_size if max_batch_size else self._batch_size_default

    def _download(self) -> None:
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
        input_name = session.get_inputs()[0].name
        if input_name is None:
            raise ValueError("Model input name is None")
        self._input_name: str = input_name
        return session

    def _predict(
        self, inputs: NDArray[np.uint8] | bytes | Image.Image, pets: PetDetectionOutput
    ) -> PetRecognitionOutput:
        if not pets:
            return []

        image = decode_cv2(inputs)
        height, width = image.shape[:2]

        results: PetRecognitionOutput = []
        embeddable_pets: list[DetectedPet] = []
        embeddable_indices: list[int] = []
        crops: list[NDArray[np.float32]] = []
        for i, pet in enumerate(pets):
            results.append({"boundingBox": pet["boundingBox"], "score": pet["score"], "label": pet["label"]})

            x1, y1, x2, y2 = self._clamp_box(pet["boundingBox"], width, height)
            if x2 - x1 < _MIN_CROP_SIDE or y2 - y1 < _MIN_CROP_SIDE:
                # Degenerate crop (e.g. fully out-of-bounds box clamped to a sliver) — recognizing it
                # would embed garbage. Server-side, a pet without an embedding routes to the species
                # bucket instead of being written as an unassigned embedding-less face.
                continue

            crop = image[y1:y2, x1:x2]
            crops.append(self._resize_and_normalize(crop))
            embeddable_pets.append(pet)
            embeddable_indices.append(i)

        if crops:
            blob: NDArray[np.float32] = np.stack(crops, axis=0)
            embeddings = self._predict_batch(blob)
            for idx, embedding in zip(embeddable_indices, embeddings, strict=True):
                results[idx]["embedding"] = serialize_np_array(embedding)

        return results

    def _predict_batch(self, blob: NDArray[np.float32]) -> NDArray[np.float32]:
        if not self.batch_size or len(blob) <= self.batch_size:
            outputs = self.session.run(None, {self._input_name: blob})
            embeddings: NDArray[np.float32] = outputs[0]
            return embeddings

        batch_embeddings: list[NDArray[np.float32]] = []
        for i in range(0, len(blob), self.batch_size):
            outputs = self.session.run(None, {self._input_name: blob[i : i + self.batch_size]})
            batch_embeddings.append(outputs[0])
        return np.concatenate(batch_embeddings, axis=0)

    @property
    def _batch_size_default(self) -> int | None:
        providers = ort.get_available_providers()
        if (
            self.model_format == ModelFormat.ONNX
            and "MIGraphXExecutionProvider" not in providers
            and "OpenVINOExecutionProvider" not in providers
        ):
            return None
        return 1

    @staticmethod
    def _clamp_box(box: BoundingBox, width: int, height: int) -> tuple[int, int, int, int]:
        x1 = min(max(box["x1"], 0), width)
        y1 = min(max(box["y1"], 0), height)
        x2 = min(max(box["x2"], 0), width)
        y2 = min(max(box["y2"], 0), height)

        if x2 <= x1:
            x2 = min(x1 + 1, width)
            x1 = max(x2 - 1, 0)
        if y2 <= y1:
            y2 = min(y1 + 1, height)
            y1 = max(y2 - 1, 0)

        return x1, y1, x2, y2

    def _resize_and_normalize(self, crop: NDArray[np.uint8]) -> NDArray[np.float32]:
        crop_h, crop_w = crop.shape[:2]
        # Closest match to the antialiased PIL bilinear resize used in training/eval: INTER_AREA
        # antialiases on downscale the way PIL does, INTER_LINEAR is the correct choice on upscale.
        interpolation = cv2.INTER_AREA if crop_h * crop_w > _INPUT_SIZE * _INPUT_SIZE else cv2.INTER_LINEAR
        resized = cv2.resize(crop, (_INPUT_SIZE, _INPUT_SIZE), interpolation=interpolation)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        normalized = (rgb.astype(np.float32) / np.float32(255.0) - _MEAN) / _STD
        chw: NDArray[np.float32] = np.transpose(normalized, (2, 0, 1))  # HWC -> CHW
        return chw
