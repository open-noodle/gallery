import base64
from pathlib import Path
from threading import Lock
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
from numpy.typing import NDArray
from PIL import Image
from pydantic_settings import BaseSettings, SettingsConfigDict

from immich_ml.config import log
from immich_ml.models.constants import SUPPORTED_PROVIDERS
from immich_ml.models.gallery_hosted import GalleryHostedModel
from immich_ml.models.transforms import decode_pil, widen
from immich_ml.schemas import (
    DepthEstimationOptions,
    DepthEstimationOutput,
    ModelFormat,
    ModelSession,
    ModelSource,
    ModelTask,
    ModelType,
    Shape,
)
from immich_ml.sessions.ort import GraphSpec, OrtSession
from immich_ml.sessions.policy import ShapePolicy

# Every supported model is a Depth Anything V2 network (DINOv2 encoder, DPT head), so they share preprocessing: a short
# side of 518 px in multiples of the 14 px patch, ImageNet normalisation, relative inverse depth out (larger = nearer).
PATCH = 14
SHORT_SIDE = 518
MAX_PATCHES = 160  # the exports admit up to 160 patches a side (2240 px)
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# A static-shape provider compiles one graph per shape, so a photo snaps to the canvas nearest its aspect ratio:
# square, 4:3, 3:2 and 16:9, both ways round. The CPU provider takes any size and gets the photo's own aspect. Only one
# canvas graph stays open at a time: see DepthEstimator._infer.
CANVASES = tuple(
    Shape(batch=1, height=h, width=w)
    for long in (518, 686, 770, 924)
    for h, w in {(SHORT_SIDE, long), (long, SHORT_SIDE)}
)

# A disparity step per pixel (normalised map, at the 518 px short side) that counts as an occlusion edge.
EDGE_STEP = 0.04

INT8_FILE = "model_int8.onnx"
# Dynamic int8 quantisation holds up on the small models (output correlation 0.999 with fp32, the same Spatial Scene
# decision on 95% of photos) but not on the large one, where only 85% of decisions survived it. The large model is meant
# for a GPU, so it always runs fp32 and its repository ships no int8 copy.
INT8_MODELS = frozenset({"depth-anything-v2-small", "distill-any-depth-small"})


class DepthSettings(BaseSettings):
    """`MACHINE_LEARNING_DEPTH_CPU=true` runs depth on the CPU provider, with the int8 copy of a small model, while the
    other models keep the accelerator. On an integrated GPU a canvas pins gigabytes of shared memory (about 6 GB for a
    16:9 canvas of the small model), and an older one runs depth no faster than the CPU does (issue #1282)."""

    model_config = SettingsConfigDict(env_prefix="MACHINE_LEARNING_DEPTH_", case_sensitive=False)

    cpu: bool = False


depth_settings = DepthSettings()


def _cpu_only() -> bool:
    available = set(ort.get_available_providers())
    return [provider for provider in SUPPORTED_PROVIDERS if provider in available][:1] == ["CPUExecutionProvider"]


class DepthEstimator(GalleryHostedModel[DepthEstimationOptions]):
    """Monocular depth for Spatial Scene (specs/2026-10-29-spatial-scene-design.md).

    Answers with an 8-bit depth map, normalised per photo, and the metrics the server decides eligibility from. Each
    model repository ships `depth/model.onnx` (fp32), and the small ones also `depth/model_int8.onnx` (dynamic int8
    weights). The int8 copy is used only when the CPU provider runs a small model: it is about a quarter faster there,
    while accelerators either cannot run its integer ops or gain nothing from them. See INT8_MODELS. The CPU provider
    runs depth when it is the only one, or when DepthSettings asks for it.
    """

    depends = []
    identity = (ModelType.DEPTH, ModelTask.DEPTH_ESTIMATION)
    sources = (ModelSource.DEPTH_ANYTHING,)
    shape_policy = ShapePolicy(dims=CANVASES)

    def __init__(self, model_name: str, **model_kwargs: Any) -> None:
        self.cpu = depth_settings.cpu or _cpu_only()
        self.int8 = model_name in INT8_MODELS and self.cpu
        self._switch = Lock()
        super().__init__(model_name, **model_kwargs)

    @property
    def model_path(self) -> Path:
        if self.int8 and self.model_format == ModelFormat.ONNX:
            return self.model_dir / INT8_FILE
        return super().model_path

    @property
    def ignore_patterns(self) -> list[str]:
        unused = "model.onnx" if self.int8 else INT8_FILE
        return [*super().ignore_patterns, f"*/{unused}"]

    def _make_session(self) -> ModelSession:
        if self.cpu and self.model_format == ModelFormat.ONNX:
            return OrtSession(
                self.model_path, self.shape_policy, providers=["CPUExecutionProvider"], threads=self.threads
            )
        return super()._make_session()

    def _load(self) -> ModelSession:
        session = super()._load()
        if isinstance(session, OrtSession):
            # the precision the session's graphs are prepared at, as GraphSpec decides it for this provider
            half = GraphSpec(self.model_path, {}, (), session.providers, []).half
            precision = "int8" if self.int8 else "fp16" if half else "fp32"
            canvases = "at each photo's own aspect" if session.dynamic else f"one of {len(session.shapes)} canvases"
            log.info(
                f"Depth model '{self.model_name}' runs {self.model_path.name} ({precision}) on {session.providers[0]}, "
                f"{canvases}{' (MACHINE_LEARNING_DEPTH_CPU)' if depth_settings.cpu else ''}"
            )
        return session

    def _predict(self, inputs: Image.Image | bytes, options: DepthEstimationOptions) -> DepthEstimationOutput:
        image = decode_pil(inputs)
        if image.mode != "RGB":
            image = image.convert("RGB")
        height, width = self._input_size(image.height, image.width)
        pixels = np.asarray(image.resize((width, height), Image.Resampling.BICUBIC), dtype=np.float32) / 255.0
        blob = ((pixels - _MEAN) / _STD).transpose(2, 0, 1)[None].astype(np.float32)
        raw = widen(self._infer(Shape(batch=1, height=height, width=width), blob))
        disparity = self._normalise(raw.reshape(raw.shape[-2:]))
        encoded = cv2.imencode(".png", (disparity * 255).round().astype(np.uint8))[1]
        metrics = self.metrics(disparity)
        return {
            "depth": base64.b64encode(encoded.tobytes()).decode(),
            "width": int(disparity.shape[1]),
            "height": int(disparity.shape[0]),
            "boundarySharpness": metrics["boundarySharpness"],
            "edgeDensity": metrics["edgeDensity"],
            "foregroundRatio": metrics["foregroundRatio"],
            "focus": metrics["focus"],
        }

    def _infer(self, shape: Shape, blob: NDArray[np.float32]) -> NDArray[Any]:
        session = self.session
        if not isinstance(session, OrtSession) or session.dynamic:
            graph = session.for_shape(shape)
            return graph.run(None, {graph.get_inputs()[0].name: blob})[0]
        # A static provider keeps a graph per canvas, and on an integrated GPU each pins 2-6 GB of shared memory, so
        # all seven open at once outgrow most hosts (issue #1282). Only the canvas this photo needs stays open:
        # reopening one from the compile cache takes a second or two. Photos run one at a time here, so a graph is never
        # dropped mid-run, and OpenVINO runs each graph it imports before importing the next (see OrtSession.warm).
        with self._switch:
            for other in [open_shape for open_shape in session.graphs if open_shape != shape]:
                del session.graphs[other]
            graph = session.for_shape(shape)
            return graph.run(None, {graph.get_inputs()[0].name: blob})[0]

    def _input_size(self, height: int, width: int) -> tuple[int, int]:
        canvases = [(shape.height, shape.width) for shape in self.session.shapes if shape.height and shape.width]
        if canvases:
            aspect = np.log(width / height)
            return min(canvases, key=lambda canvas: abs(np.log(canvas[1] / canvas[0]) - aspect))
        scale = SHORT_SIDE / min(height, width)

        def snap(side: int) -> int:
            return int(min(max(round(side * scale / PATCH), 8), MAX_PATCHES) * PATCH)

        return snap(height), snap(width)

    @staticmethod
    def _normalise(disparity: NDArray[np.float32]) -> NDArray[np.float32]:
        # Relative depth has an unknown scale and shift per photo, so the map is stretched to 0..1 between its 1st and
        # 99th percentiles: a few hot pixels must not squash the rest of the range.
        low, high = np.percentile(disparity, [1, 99])
        normalised: NDArray[np.float32] = np.clip((disparity - low) / max(high - low, 1e-6), 0, 1).astype(np.float32)
        return normalised

    @staticmethod
    def metrics(disparity: NDArray[np.float32]) -> dict[str, float]:
        """Suitability metrics on the normalised map, so they ignore the model's unknown scale and shift.

        boundarySharpness: median depth gradient along the Otsu foreground boundary. High where a subject is cut
                           out against its background; low on a ground plane (a line across a smooth ramp) or a
                           screenshot.
        edgeDensity:       share of pixels with an occlusion-sized step, for scenes of many thin edges (trunks,
                           railings).
        foregroundRatio:   share of pixels in the Otsu foreground.
        focus:             mean foreground disparity, the viewer's still plane.
        """
        as_u8 = (disparity * 255).astype(np.uint8)
        threshold, _ = cv2.threshold(as_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        foreground = as_u8 > threshold
        ratio = float(foreground.mean())

        gx = cv2.Sobel(disparity, cv2.CV_32F, 1, 0, ksize=3) / 8
        gy = cv2.Sobel(disparity, cv2.CV_32F, 0, 1, ksize=3) / 8
        gradient = np.hypot(gx, gy)
        boundary = cv2.morphologyEx(foreground.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0

        return {
            "boundarySharpness": float(np.median(gradient[boundary])) if boundary.any() else 0.0,
            "edgeDensity": float((gradient > EDGE_STEP).mean()),
            "foregroundRatio": ratio,
            "focus": float(disparity[foreground].mean()) if 0.0 < ratio < 1.0 else float(disparity.mean()),
        }
