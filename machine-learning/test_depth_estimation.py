import base64
from typing import cast
from unittest import mock

import cv2
import numpy as np
import orjson
import pytest
from fastapi import HTTPException
from numpy.typing import NDArray
from PIL import Image
from pytest_mock import MockerFixture

import immich_ml.main as ml_main
from immich_ml.config import settings
from immich_ml.models.constants import get_model_source
from immich_ml.models.depth_estimation import DepthEstimator
from immich_ml.models.depth_estimation.depth import CANVASES, depth_settings
from immich_ml.schemas import (
    DepthEstimationOptions,
    ModelSource,
    Shape,
)
from immich_ml.sessions.ort import GraphSpec, OrtSession


def _graph_session(batches: tuple[int, ...] = (2, 1)) -> mock.Mock:
    """A stub session that is also its only graph, as upstream's `stub_session` fixture builds one. `batches` are
    the batch sizes a non-dynamic provider would admit."""
    session = mock.Mock()
    session.batches = batches
    session.for_shape.return_value = session
    return session


class TestDepthEstimation:
    @staticmethod
    def _estimator(
        mocker: MockerFixture, *, cpu_only: bool = True, shapes: tuple[Shape, ...] = (Shape(batch=1),)
    ) -> DepthEstimator:
        mocker.patch("immich_ml.models.depth_estimation.depth._cpu_only", return_value=cpu_only)
        mocker.patch.object(DepthEstimator, "load")
        estimator = DepthEstimator("depth-anything-v2-small", cache_dir="test_cache")
        session = _graph_session()
        session.shapes = shapes
        model_input = mock.Mock()
        model_input.name = "pixel_values"
        session.get_inputs.return_value = [model_input]
        estimator.session = session
        return estimator

    @staticmethod
    def _disc(height: int, width: int, radius: float, blur: int = 0) -> NDArray[np.float32]:
        """A near disc (disparity 1) in front of a far plane (0.1): one subject with a sharp outline."""
        ys, xs = np.mgrid[0:height, 0:width]
        disc = np.where((ys - height / 2) ** 2 + (xs - width / 2) ** 2 <= radius**2, 1.0, 0.1).astype(np.float32)
        return cv2.GaussianBlur(disc, (0, 0), blur).astype(np.float32) if blur else disc

    def test_resolves_supported_models(self) -> None:
        for name in ("depth-anything-v2-small", "distill-any-depth-small", "distill-any-depth-large"):
            assert get_model_source(name) == ModelSource.DEPTH_ANYTHING

    def test_pipeline_resolves_depth_estimator(self) -> None:
        request = {"depth-estimation": {"depth": {"modelName": "distill-any-depth-large"}}}
        (entry,) = ml_main.PIPELINE_REQUEST.validate_json(orjson.dumps(request)).entries()
        assert entry.model is DepthEstimator
        assert entry.options == DepthEstimationOptions()

    def test_pipeline_rejects_a_model_from_another_source(self) -> None:
        request = {"depth-estimation": {"depth": {"modelName": "rfdetr-nano"}}}
        with pytest.raises(HTTPException) as e:
            ml_main.get_entries(orjson.dumps(request).decode())
        assert e.value.status_code == 422

    @pytest.mark.parametrize(
        ("size", "expected"),
        [
            ((4032, 3024), (518, 686)),  # 4:3 landscape keeps its own aspect
            ((3024, 4032), (686, 518)),
            ((1920, 1080), (518, 924)),
            ((8000, 1000), (518, 2240)),  # a panorama is capped at the export's 160 patches
        ],
    )
    def test_cpu_input_keeps_the_photo_aspect(
        self, mocker: MockerFixture, size: tuple[int, int], expected: tuple[int, int]
    ) -> None:
        estimator = self._estimator(mocker)
        assert estimator._input_size(size[1], size[0]) == expected

    @pytest.mark.parametrize(
        ("size", "expected"),
        [
            ((1000, 1000), (518, 518)),
            ((4032, 3024), (518, 686)),
            ((3024, 4032), (686, 518)),
            ((3000, 2000), (518, 770)),
            ((1080, 1920), (924, 518)),
            ((8000, 1000), (518, 924)),  # nothing wider is compiled, so a panorama takes the widest canvas
        ],
    )
    def test_static_input_snaps_to_the_nearest_canvas(
        self, mocker: MockerFixture, size: tuple[int, int], expected: tuple[int, int]
    ) -> None:
        estimator = self._estimator(mocker, cpu_only=False, shapes=CANVASES)
        assert estimator._input_size(size[1], size[0]) == expected

    def test_canvases_are_whole_patches(self) -> None:
        for shape in CANVASES:
            assert shape.height is not None and shape.width is not None
            assert shape.height % 14 == 0 and shape.width % 14 == 0
            assert min(shape.height, shape.width) == 518

    def test_predict_feeds_normalised_rgb_and_encodes_the_map(self, mocker: MockerFixture) -> None:
        estimator = self._estimator(mocker)
        graph = cast(mock.Mock, estimator.session)
        graph.run.return_value = [self._disc(518, 686, 150)[None] * 7.3 + 2.0]  # any scale and shift

        result = estimator.predict(Image.new("RGB", (4032, 3024), (255, 0, 0)), options=DepthEstimationOptions())

        feed = graph.run.call_args.args[1]["pixel_values"]
        assert feed.shape == (1, 3, 518, 686)
        assert feed.dtype == np.float32
        assert np.allclose(feed[0, 0], (1 - 0.485) / 0.229, atol=1e-4)  # red arrives in the first plane
        assert np.allclose(feed[0, 2], (0 - 0.406) / 0.225, atol=1e-4)
        assert (result["width"], result["height"]) == (686, 518)
        depth = cv2.imdecode(np.frombuffer(base64.b64decode(result["depth"]), np.uint8), cv2.IMREAD_UNCHANGED)
        assert depth is not None
        assert depth.shape == (518, 686) and depth.dtype == np.uint8
        assert depth[259, 343] == 255 and depth[5, 5] == 0  # near is bright, whatever the model's scale

    def test_predict_converts_non_rgb_input(self, mocker: MockerFixture) -> None:
        estimator = self._estimator(mocker)
        cast(mock.Mock, estimator.session).run.return_value = [self._disc(518, 518, 100)[None]]

        result = estimator.predict(Image.new("L", (800, 800), 128), options=DepthEstimationOptions())

        assert (result["width"], result["height"]) == (518, 518)

    def test_sharp_subject_scores_high(self) -> None:
        metrics = DepthEstimator.metrics(self._disc(518, 686, 150))

        assert metrics["boundarySharpness"] > 0.1
        assert metrics["foregroundRatio"] == pytest.approx(np.pi * 150**2 / (518 * 686), rel=0.05)
        assert metrics["focus"] == pytest.approx(1.0)

    @pytest.mark.parametrize(
        "disparity",
        [
            np.tile(np.linspace(0, 1, 518, dtype=np.float32)[:, None], (1, 686)),  # a ground plane
            np.zeros((518, 686), np.float32),  # nothing at all
        ],
    )
    def test_flat_scenes_score_low(self, disparity: NDArray[np.float32]) -> None:
        metrics = DepthEstimator.metrics(disparity)

        assert metrics["boundarySharpness"] < 0.01
        assert metrics["edgeDensity"] < 0.001

    def test_soft_blob_scores_low(self) -> None:
        """A screenshot's depth is a soft blur; normalising it must not make it look like a subject."""
        metrics = DepthEstimator.metrics(DepthEstimator._normalise(self._disc(518, 686, 150, blur=40)))

        assert metrics["boundarySharpness"] < 0.03
        assert metrics["edgeDensity"] < 0.02

    def test_cpu_loads_and_downloads_only_the_int8_copy(self, mocker: MockerFixture) -> None:
        estimator = self._estimator(mocker, cpu_only=True)

        assert estimator.model_path == estimator.model_dir / "model_int8.onnx"
        assert estimator.ignore_patterns == ["*.armnn", "*.rknn", "*/model.onnx"]

    def test_accelerators_load_and_download_only_fp32(self, mocker: MockerFixture) -> None:
        estimator = self._estimator(mocker, cpu_only=False)

        assert estimator.model_path == estimator.model_dir / "model.onnx"
        assert estimator.ignore_patterns == ["*.armnn", "*.rknn", "*/model_int8.onnx"]

    def test_large_model_runs_fp32_even_on_cpu(self, mocker: MockerFixture) -> None:
        """int8 kept only 85% of the large model's Spatial Scene decisions, so it never loads."""
        mocker.patch("immich_ml.models.depth_estimation.depth._cpu_only", return_value=True)
        mocker.patch.object(DepthEstimator, "load")
        estimator = DepthEstimator("distill-any-depth-large", cache_dir="test_cache")

        assert estimator.model_path == estimator.model_dir / "model.onnx"
        assert estimator.ignore_patterns == ["*.armnn", "*.rknn", "*/model_int8.onnx"]

    def test_static_provider_keeps_only_the_canvas_in_use_open(self, mocker: MockerFixture) -> None:
        """On an integrated GPU each canvas pins gigabytes of shared memory, so seven open at once ran hosts out of
        memory (issue #1282)."""

        def graph(spec: GraphSpec) -> mock.Mock:
            built = mock.Mock()
            built.get_inputs.return_value = [mock.Mock()]
            built.run.return_value = [self._disc(spec.pins["height"], spec.pins["width"], 100)[None]]
            return built

        estimator = self._estimator(mocker, cpu_only=False)
        build = mocker.patch("immich_ml.sessions.ort.OrtGraph", side_effect=graph)
        session = OrtSession("model.onnx", estimator.shape_policy, providers=["OpenVINOExecutionProvider"])
        estimator.session = session
        landscape, wide = Image.new("RGB", (4032, 3024)), Image.new("RGB", (1920, 1080))

        for image in (landscape, wide, wide):
            estimator.predict(image, options=DepthEstimationOptions())

        assert list(session.graphs) == [Shape(batch=1, height=518, width=924)]
        assert build.call_count == 2  # the repeated canvas reused its open graph

    def test_cpu_setting_runs_the_int8_copy_on_the_cpu(self, mocker: MockerFixture) -> None:
        mocker.patch.object(depth_settings, "cpu", True)
        estimator = self._estimator(mocker, cpu_only=False)
        make = mocker.patch("immich_ml.models.depth_estimation.depth.OrtSession")

        estimator._make_session()

        assert estimator.model_path == estimator.model_dir / "model_int8.onnx"
        assert make.call_args.kwargs["providers"] == ["CPUExecutionProvider"]

    def test_load_logs_the_file_precision_and_provider(self, mocker: MockerFixture) -> None:
        estimator = self._estimator(mocker, cpu_only=False)
        mocker.patch(
            "immich_ml.models.depth_estimation.depth.GalleryHostedModel._load",
            return_value=OrtSession("model.onnx", estimator.shape_policy, providers=["OpenVINOExecutionProvider"]),
        )
        log = mocker.patch("immich_ml.models.depth_estimation.depth.log")

        estimator._load()

        log.info.assert_called_once_with(
            "Depth model 'depth-anything-v2-small' runs model.onnx (fp32) on OpenVINOExecutionProvider, "
            "one of 7 canvases"
        )

    def test_download_targets_expected_repo(self, mocker: MockerFixture) -> None:
        mocker.patch("immich_ml.models.depth_estimation.depth._cpu_only", return_value=True)
        estimator = DepthEstimator("distill-any-depth-small", cache_dir="test_cache")
        mocker.patch.object(DepthEstimator, "cached", new_callable=mock.PropertyMock, side_effect=[False, True])
        snapshot_download = mocker.patch("immich_ml.models.gallery_hosted.snapshot_download")

        estimator.download()

        snapshot_download.assert_called_once_with(
            "open-noodle/distill-any-depth-small",
            cache_dir=estimator.cache_dir,
            local_dir=estimator.cache_dir,
            ignore_patterns=["*.armnn", "*.rknn", "*/model.onnx"],
        )

    def test_default_cache_dir(self, mocker: MockerFixture) -> None:
        mocker.patch.object(settings, "model_revision", "v2")
        estimator = DepthEstimator("depth-anything-v2-small")

        assert estimator.cache_dir == settings.cache_folder / "depth-estimation" / "depth-anything-v2-small"
