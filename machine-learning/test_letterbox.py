"""Fork tests of upstream's `letterbox` (#1278).

An image whose sides differ by more than the canvas size (640:1 for face detection) used to scale its short
side to 0 pixels, and `cv2.resize` raised `inv_scale_x > 0`, failing the whole `/predict` request with a 500.
"""

import itertools
from typing import Callable
from unittest import mock

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image

from immich_ml.models.facial_recognition.detection import FaceDetector
from immich_ml.models.transforms import letterbox
from immich_ml.schemas import FaceDetectionOptions

SIZE = 640


def upstream_letterbox(image: NDArray[np.uint8], size: int) -> tuple[NDArray[np.uint8], float]:
    """Upstream's letterbox as of v3.3.5, verbatim, to pin that the fix changes nothing it could handle."""
    height, width = image.shape[:2]
    if height > width:
        new_height, new_width = size, int(size * width / height)
    else:
        new_width, new_height = size, int(size * height / width)

    canvas = np.zeros((size, size, 3), dtype=np.uint8)
    cv2.resize(image, (new_width, new_height), dst=canvas[:new_height, :new_width])
    return canvas, new_height / height


def noise(height: int, width: int, seed: int) -> NDArray[np.uint8]:
    return np.random.default_rng(seed).integers(0, 256, (height, width, 3), dtype=np.uint8)


# Short sides around every threshold the truncation crosses, against long sides on both sides of SIZE.
SIDES = [1, 2, 3, 4, 5, 7, 8, 63, 64, 100, 320, 639, 640, 641, 642, 1000, 1023, 1024, 1280, 1281, 1282, 4000, 5000]
DEGENERATE = [
    (1024, 1),
    (1, 1024),
    (964, 1),
    (1, 964),
    (5000, 3),
    (3, 5000),
    (641, 1),
    (1, 641),
    (100_000, 1),
    (1, 100_000),
]


class TestLetterbox:
    @pytest.mark.parametrize(("height", "width"), DEGENERATE)
    def test_does_not_crash_on_extreme_aspect_ratios(self, height: int, width: int) -> None:
        with pytest.raises(cv2.error):  # the bug, so this test can only pass because of the fix
            upstream_letterbox(noise(height, width, 0), SIZE)

        canvas, scale = letterbox(noise(height, width, 0), SIZE)

        assert canvas.shape == (SIZE, SIZE, 3) and canvas.dtype == np.uint8
        assert np.isfinite(scale) and scale > 0  # detection divides box coordinates by it
        long_side = max(height, width)
        assert canvas[: SIZE * height // long_side or 1, : SIZE * width // long_side or 1].any()  # the strip is drawn
        if height > width:
            assert not canvas[:, 1:].any()  # in a 1-pixel column, the rest left black
        else:
            assert not canvas[1:].any()

    def test_matches_upstream_for_every_shape_upstream_could_letterbox(self) -> None:
        compared = 0
        rng = np.random.default_rng(1278)
        random_shapes = [tuple(int(side) for side in rng.integers(1, 8000, 2)) for _ in range(300)]
        for seed, (height, width) in enumerate([*itertools.product(SIDES, SIDES), *random_shapes]):
            image = noise(height, width, seed)
            try:
                expected_canvas, expected_scale = upstream_letterbox(image, SIZE)
            except cv2.error:
                continue  # only the degenerate shapes above, covered by the other test
            canvas, scale = letterbox(image, SIZE)
            assert scale == expected_scale, (height, width)
            assert np.array_equal(canvas, expected_canvas), (height, width)
            compared += 1
        assert compared > 750  # the grid really exercised the normal path

    @pytest.mark.parametrize(("height", "width"), [(1024, 1), (1, 1024), (480, 640), (4000, 3000)])
    def test_accepts_pil_images_too(self, height: int, width: int) -> None:
        image = noise(height, width, 1)

        canvas, scale = letterbox(Image.fromarray(image), SIZE)

        expected_canvas, expected_scale = letterbox(image, SIZE)
        assert np.array_equal(canvas, expected_canvas) and scale == expected_scale


class TestFaceDetectionOnExtremeAspectRatios:
    @pytest.mark.parametrize(("height", "width"), [(1024, 1), (1, 1024), (5000, 3)])
    def test_returns_no_faces_instead_of_failing(
        self, height: int, width: int, stub_session: Callable[..., mock.Mock], mocker: mock.Mock
    ) -> None:
        detector = FaceDetector("buffalo_l", cache_dir="test_cache")
        # SCRFD's nine heads (scores, boxes, landmarks at strides 8/16/32) with nothing above the threshold
        anchors = [(SIZE // stride) ** 2 * 2 for stride in (8, 16, 32)]
        heads = (
            [np.zeros((n, 1), np.float32) for n in anchors]
            + [np.zeros((n, 4), np.float32) for n in anchors]
            + [np.zeros((n, 10), np.float32) for n in anchors]
        )
        detector.session = stub_session((1, 3, SIZE, SIZE), outputs=heads)
        mocker.patch.object(detector, "_load")

        encoded = cv2.imencode(".png", noise(height, width, 2))[1].tobytes()  # an upload, as the server sends it

        output = detector._predict(encoded, FaceDetectionOptions(min_score=0.5))

        assert output["boxes"].shape[0] == 0 and output["scores"].shape[0] == 0
        fed = detector.session.run.call_args.args[1]["input.1"]
        assert fed.shape == (1, 3, SIZE, SIZE)
