import cv2
import numpy as np
from huggingface_hub import snapshot_download
from numpy.typing import NDArray
from PIL import Image

from immich_ml.config import clean_name
from immich_ml.models.base import InferenceModel
from immich_ml.models.transforms import decode_cv2, serialize_np_array
from immich_ml.schemas import (
    BoundingBox,
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


class PetRecognizer(InferenceModel):
    depends = [(ModelType.DETECTION, ModelTask.PET_DETECTION)]
    identity = (ModelType.RECOGNITION, ModelTask.PET_DETECTION)

    def _download(self) -> None:
        snapshot_download(
            f"{_HF_ORG}/{clean_name(self.model_name)}",
            cache_dir=self.cache_dir,
            local_dir=self.cache_dir,
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
        crops = [self._crop_and_preprocess(image, pet["boundingBox"]) for pet in pets]
        blob: NDArray[np.float32] = np.stack(crops, axis=0)

        outputs = self.session.run(None, {self._input_name: blob})
        embeddings = outputs[0]

        results: PetRecognitionOutput = [
            {
                "boundingBox": pet["boundingBox"],
                "score": pet["score"],
                "label": pet["label"],
                "embedding": serialize_np_array(embedding),
            }
            for pet, embedding in zip(pets, embeddings)
        ]
        return results

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

    def _crop_and_preprocess(self, image: NDArray[np.uint8], box: BoundingBox) -> NDArray[np.float32]:
        height, width = image.shape[:2]
        x1, y1, x2, y2 = self._clamp_box(box, width, height)

        crop = image[y1:y2, x1:x2]
        resized = cv2.resize(crop, (_INPUT_SIZE, _INPUT_SIZE))
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        normalized = (rgb.astype(np.float32) / np.float32(255.0) - _MEAN) / _STD
        chw: NDArray[np.float32] = np.transpose(normalized, (2, 0, 1))  # HWC -> CHW
        return chw
