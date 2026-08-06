"""
Heuristic image-quality predictor.

No model download — all metrics are computed from the pixel data alone.
Returns a dict with four integer scores in [0, 100]:

  - sharpness:  Laplacian variance, normalised.
  - exposure:   fraction of non-clipped pixels (avoids blown/crushed histogram extremes).
  - brightness: mean luminance, normalised.
  - quality:    weighted composite (0.5·sharpness + 0.3·exposure + 0.2·brightness).

Tuning constants are module-level so they can be overridden in tests or downstream
without touching the logic.
"""

from __future__ import annotations

from typing import Any, ClassVar, TypedDict, cast

import cv2
import numpy as np
import numpy.typing as npt
from PIL import Image

from immich_ml.models.base import InferenceModel
from immich_ml.schemas import ModelIdentity, ModelSession, ModelTask, ModelType

# ---------------------------------------------------------------------------
# Tuning constants
# ---------------------------------------------------------------------------

# Laplacian variance of a sharp 128×128 checkerboard ≈ 10 000+.
# We map [0, SHARPNESS_SCALE] → [0, 100].  Lower values make the predictor more
# sensitive to subtle blur; higher values reserve the top of the scale for
# extremely crisp images.  Calibrated so a typical sharp photo lands 60-100 and
# a heavily blurred one lands <20.
SHARPNESS_SCALE: float = 500.0

# Histogram extreme bins: pixels ≤ LOW_BIN or ≥ HIGH_BIN are "clipped".
# Using 4 and 251 follows the plan's suggestion and matches common photo-editing
# conventions for highlight/shadow clipping.
CLIP_LOW_BIN: int = 4
CLIP_HIGH_BIN: int = 251

# Down-scale long edge to this before computing — fast & stable for large images.
MAX_EDGE: int = 1024

# Quality composite weights (must sum to 1.0).
WEIGHT_SHARPNESS: float = 0.5
WEIGHT_EXPOSURE: float = 0.3
WEIGHT_BRIGHTNESS: float = 0.2


# ---------------------------------------------------------------------------
# Output type
# ---------------------------------------------------------------------------


class QualityOutput(TypedDict):
    sharpness: int
    exposure: int
    brightness: int
    quality: int


# ---------------------------------------------------------------------------
# Predictor
# ---------------------------------------------------------------------------


class QualityScorer(InferenceModel):
    """Heuristic image-quality predictor — no model file, no network access."""

    depends: ClassVar[list[ModelIdentity]] = []
    identity: ClassVar[ModelIdentity] = (ModelType.VISUAL, ModelTask.IMAGE_QUALITY)

    # ------------------------------------------------------------------
    # InferenceModel overrides
    # ------------------------------------------------------------------

    @property
    def cached(self) -> bool:
        # No model file to check; always report "cached" so download() is a no-op.
        return True

    def _download(self) -> None:
        pass

    def _load(self) -> ModelSession:
        # No ONNX session needed; return a sentinel that satisfies the protocol.
        # _predict does not use self.session.
        return _NoOpSession()

    # ------------------------------------------------------------------
    # Prediction
    # ------------------------------------------------------------------

    def _predict(self, *inputs: Any, **kwargs: Any) -> Any:
        image: Image.Image = inputs[0]
        gray = _to_gray_uint8(image)
        gray = _downscale(gray)

        sharpness = _compute_sharpness(gray)
        exposure = _compute_exposure(gray)
        brightness = _compute_brightness(gray)
        quality = round(WEIGHT_SHARPNESS * sharpness + WEIGHT_EXPOSURE * exposure + WEIGHT_BRIGHTNESS * brightness)

        return QualityOutput(
            sharpness=sharpness,
            exposure=exposure,
            brightness=brightness,
            quality=quality,
        )


# ---------------------------------------------------------------------------
# No-op ModelSession sentinel
# ---------------------------------------------------------------------------


class _NoOpSession:
    """Minimal ModelSession implementation for the heuristic predictor."""

    def run(
        self,
        output_names: list[str] | None,
        input_feed: dict[str, npt.NDArray[np.float32]] | dict[str, npt.NDArray[np.int32]],
        run_options: Any = None,
    ) -> list[npt.NDArray[np.float32]]:  # pragma: no cover
        return []

    def get_inputs(self) -> list[Any]:  # pragma: no cover
        return []

    def get_outputs(self) -> list[Any]:  # pragma: no cover
        return []


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _to_gray_uint8(image: Image.Image) -> npt.NDArray[np.uint8]:
    """Convert any PIL mode to a single-channel uint8 luminance array."""
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    if image.mode == "L":
        result: npt.NDArray[np.uint8] = np.asarray(image, dtype=np.uint8)
        return result
    # PIL is RGB; reverse channel order to BGR for cv2.cvtColor
    rgb: npt.NDArray[np.uint8] = np.asarray(image, dtype=np.uint8)
    bgr: npt.NDArray[np.uint8] = np.ascontiguousarray(rgb[:, :, ::-1])
    return cast(npt.NDArray[np.uint8], cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))


def _downscale(gray: npt.NDArray[np.uint8]) -> npt.NDArray[np.uint8]:
    """Limit the long edge to MAX_EDGE pixels for speed and numeric stability."""
    h, w = gray.shape[:2]
    long_edge = max(h, w)
    if long_edge <= MAX_EDGE:
        return gray
    scale = MAX_EDGE / long_edge
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    return cast(npt.NDArray[np.uint8], cv2.resize(gray, (new_w, new_h), interpolation=cv2.INTER_AREA))


def _compute_sharpness(gray: npt.NDArray[np.uint8]) -> int:
    """Laplacian variance normalised to [0, 100]."""
    variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    score = min(100.0, 100.0 * variance / SHARPNESS_SCALE)
    return int(round(score))


def _compute_exposure(gray: npt.NDArray[np.uint8]) -> int:
    """Fraction of non-clipped pixels × 100, giving 100 for a perfectly-exposed image."""
    total = gray.size
    if total == 0:
        return 0
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
    clipped = float(hist[: CLIP_LOW_BIN + 1].sum() + hist[CLIP_HIGH_BIN:].sum())
    clip_pct = min(100.0, 100.0 * clipped / total)
    return int(round(100.0 - clip_pct))


def _compute_brightness(gray: npt.NDArray[np.uint8]) -> int:
    """Mean luminance normalised to [0, 100]."""
    mean = float(np.mean(gray))
    return int(round(100.0 * mean / 255.0))
