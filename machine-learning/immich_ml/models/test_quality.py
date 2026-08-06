"""
Tests for the heuristic image-quality predictor (QualityScorer).
All assertions use RELATIVE ordering or structural guarantees, not absolute values.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from immich_ml.models import get_model_class
from immich_ml.models.quality import QualityScorer
from immich_ml.schemas import ModelTask, ModelType

# ---------------------------------------------------------------------------
# Helpers: synthetic test images
# ---------------------------------------------------------------------------


def _sharp_image(size: int = 128) -> Image.Image:
    """High-frequency checkerboard — maximises Laplacian variance."""
    arr = np.indices((size, size)).sum(axis=0) % 2
    arr = (arr * 255).astype(np.uint8)
    rgb = np.stack([arr, arr, arr], axis=-1)
    return Image.fromarray(rgb, mode="RGB")


def _blurred_image(size: int = 128) -> Image.Image:
    """Gaussian-blurred version of the checkerboard — low Laplacian variance."""
    import cv2

    sharp = np.array(_sharp_image(size))
    blurred = cv2.GaussianBlur(sharp, (21, 21), 10)
    return Image.fromarray(blurred, mode="RGB")


def _black_image(size: int = 64) -> Image.Image:
    return Image.new("RGB", (size, size), color=(0, 0, 0))


def _white_image(size: int = 64) -> Image.Image:
    return Image.new("RGB", (size, size), color=(255, 255, 255))


def _mid_gray_image(size: int = 64) -> Image.Image:
    return Image.new("RGB", (size, size), color=(128, 128, 128))


def _make_scorer() -> QualityScorer:
    return QualityScorer("builtin-image-quality")


# ---------------------------------------------------------------------------
# Registry tests
# ---------------------------------------------------------------------------


class TestRegistry:
    def test_get_model_class_returns_quality_scorer(self) -> None:
        from immich_ml.models.quality import QualityScorer

        cls = get_model_class("builtin-image-quality", ModelType.VISUAL, ModelTask.IMAGE_QUALITY)
        assert cls is QualityScorer

    def test_registry_independent_of_model_name(self) -> None:
        from immich_ml.models.quality import QualityScorer

        cls = get_model_class("any-name", ModelType.DETECTION, ModelTask.IMAGE_QUALITY)
        assert cls is QualityScorer


# ---------------------------------------------------------------------------
# Structural / contract tests
# ---------------------------------------------------------------------------


class TestQualityScorerContract:
    def test_all_four_keys_present(self) -> None:
        scorer = _make_scorer()
        result = scorer._predict(_sharp_image())
        assert set(result.keys()) == {"sharpness", "exposure", "brightness", "quality"}

    def test_all_values_are_int(self) -> None:
        scorer = _make_scorer()
        result = scorer._predict(_sharp_image())
        for key, value in result.items():
            assert isinstance(value, int), f"{key} should be int, got {type(value)}"

    def test_all_values_in_0_to_100(self) -> None:
        scorer = _make_scorer()
        result = scorer._predict(_sharp_image())
        for key, value in result.items():
            assert 0 <= value <= 100, f"{key}={value} out of [0, 100]"

    def test_deterministic(self) -> None:
        scorer = _make_scorer()
        img = _sharp_image()
        assert scorer._predict(img) == scorer._predict(img)

    def test_quality_is_weighted_composite(self) -> None:
        scorer = _make_scorer()
        result = scorer._predict(_sharp_image())
        expected = round(0.5 * result["sharpness"] + 0.3 * result["exposure"] + 0.2 * result["brightness"])
        assert result["quality"] == expected

    def test_load_is_noop_no_download(self, tmp_path: Path) -> None:
        """load() must complete without network access or file I/O errors."""
        scorer = QualityScorer("builtin-image-quality", cache_dir=tmp_path)
        scorer.load()  # must not raise
        assert scorer.loaded is True

    def test_predict_triggers_load(self) -> None:
        scorer = _make_scorer()
        assert scorer.loaded is False
        scorer.predict(_sharp_image())  # calls load() then _predict()
        assert scorer.loaded is True


# ---------------------------------------------------------------------------
# Relative-ordering / heuristic correctness tests
# ---------------------------------------------------------------------------


class TestSharpness:
    def test_sharp_higher_sharpness_than_blurred(self) -> None:
        scorer = _make_scorer()
        sharp_score = scorer._predict(_sharp_image())["sharpness"]
        blurred_score = scorer._predict(_blurred_image())["sharpness"]
        assert sharp_score > blurred_score, (
            f"Sharp image sharpness ({sharp_score}) should exceed blurred ({blurred_score})"
        )


class TestExposure:
    def test_black_image_low_exposure(self) -> None:
        scorer = _make_scorer()
        score = scorer._predict(_black_image())["exposure"]
        assert score < 50, f"Black image exposure should be < 50, got {score}"

    def test_white_image_low_exposure(self) -> None:
        scorer = _make_scorer()
        score = scorer._predict(_white_image())["exposure"]
        assert score < 50, f"White (blown-out) image exposure should be < 50, got {score}"

    def test_mid_gray_mid_exposure(self) -> None:
        scorer = _make_scorer()
        score = scorer._predict(_mid_gray_image())["exposure"]
        assert score >= 50, f"Mid-gray image exposure should be >= 50, got {score}"


class TestBrightness:
    def test_black_image_low_brightness(self) -> None:
        scorer = _make_scorer()
        score = scorer._predict(_black_image())["brightness"]
        assert score < 20, f"Black image brightness should be < 20, got {score}"

    def test_white_image_high_brightness(self) -> None:
        scorer = _make_scorer()
        score = scorer._predict(_white_image())["brightness"]
        assert score > 80, f"White image brightness should be > 80, got {score}"


# ---------------------------------------------------------------------------
# Edge-case tests
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_grayscale_input(self) -> None:
        scorer = _make_scorer()
        img = Image.new("L", (64, 64), color=128)
        result = scorer._predict(img)
        assert set(result.keys()) == {"sharpness", "exposure", "brightness", "quality"}
        for v in result.values():
            assert 0 <= v <= 100

    def test_tiny_image_no_crash(self) -> None:
        scorer = _make_scorer()
        img = Image.new("RGB", (4, 4), color=128)
        result = scorer._predict(img)
        assert set(result.keys()) == {"sharpness", "exposure", "brightness", "quality"}

    def test_all_black_extreme(self) -> None:
        scorer = _make_scorer()
        result = scorer._predict(_black_image())
        for v in result.values():
            assert 0 <= v <= 100

    def test_all_white_extreme(self) -> None:
        scorer = _make_scorer()
        result = scorer._predict(_white_image())
        for v in result.values():
            assert 0 <= v <= 100

    def test_rgba_converted_to_rgb(self) -> None:
        scorer = _make_scorer()
        arr = np.random.default_rng(42).integers(0, 255, (64, 64, 4), dtype=np.uint8)
        img = Image.fromarray(arr, mode="RGBA")
        result = scorer._predict(img)
        assert set(result.keys()) == {"sharpness", "exposure", "brightness", "quality"}

    def test_palette_mode_p(self) -> None:
        scorer = _make_scorer()
        base = Image.new("RGB", (64, 64), color=(100, 150, 200))
        img = base.convert("P")
        result = scorer._predict(img)
        assert set(result.keys()) == {"sharpness", "exposure", "brightness", "quality"}

    def test_cmyk_mode(self) -> None:
        scorer = _make_scorer()
        img = Image.new("CMYK", (64, 64), color=(0, 50, 100, 30))
        result = scorer._predict(img)
        assert set(result.keys()) == {"sharpness", "exposure", "brightness", "quality"}
