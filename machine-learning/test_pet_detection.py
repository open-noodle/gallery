from pathlib import Path
from typing import Any, cast
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
from immich_ml.config import MaxBatchSize, settings
from immich_ml.models.base import InferenceEntry
from immich_ml.models.constants import get_model_source
from immich_ml.models.pet_detection import PetDetector
from immich_ml.models.pet_recognition import PetRecognizer
from immich_ml.schemas import (
    ModelFormat,
    ModelSource,
    PetDetectionOptions,
    PetDetectionOutput,
    PetRecognitionOptions,
    Shape,
)


def _graph_session(batches: tuple[int, ...] = (2, 1)) -> mock.Mock:
    """A stub session that is also its only graph, as upstream's `stub_session` fixture builds one. `batches` are
    the batch sizes a non-dynamic provider would admit."""
    session = mock.Mock()
    session.batches = batches
    session.for_shape.return_value = session
    return session


class TestPetDetectionModelSource:
    def test_resolves_rfdetr_models(self) -> None:
        assert get_model_source("rfdetr-nano") == ModelSource.RFDETR
        assert get_model_source("rfdetr-small") == ModelSource.RFDETR

    def test_yolo_names_are_no_longer_recognised(self) -> None:
        assert get_model_source("yolo11n") is None
        assert get_model_source("yolo11s") is None
        assert get_model_source("yolo11m") is None


class TestPetDetection:
    @staticmethod
    def _make_rfdetr_output(
        detections: list[tuple[float, float, float, float, int, float]],
        num_queries: int = 300,
    ) -> list[NDArray[np.float32]]:
        """Build mock RF-DETR outputs: dets (1, N, 4) + labels (1, N, 91).

        Each detection is (cx, cy, w, h, class_id, probability), with the box
        normalised to [0, 1] and the probability given post-sigmoid. Logits are
        back-computed so the detector's own sigmoid recovers the probability.
        """
        dets = np.zeros((1, num_queries, 4), dtype=np.float32)
        # -30 -> sigmoid ~= 1e-13, i.e. "off" without risking overflow warnings.
        logits = np.full((1, num_queries, 91), -30.0, dtype=np.float32)
        for i, (cx, cy, w, h, class_id, prob) in enumerate(detections):
            dets[0, i] = (cx, cy, w, h)
            prob = min(max(prob, 1e-6), 1 - 1e-6)
            logits[0, i, class_id] = float(np.log(prob / (1 - prob)))
        return [dets, logits]

    @staticmethod
    def _detector(mocker: MockerFixture, input_size: int = 384) -> PetDetector:
        mocker.patch.object(PetDetector, "load")
        detector = PetDetector("rfdetr-nano", cache_dir="test_cache")
        session = _graph_session()
        model_input = mock.Mock()
        model_input.name = "input"
        model_input.shape = [1, 3, input_size, input_size]
        session.get_inputs.return_value = [model_input]
        detector.session = session
        detector._input_name = "input"
        detector._input_size = input_size
        return detector

    # ---- preprocessing (spec #1-#6) ----

    def test_feeds_rgb_not_bgr(self, mocker: MockerFixture) -> None:
        """Spec #1. The original defect: a red image must arrive red, not blue."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([])

        red = Image.new("RGB", (64, 48), (255, 0, 0))
        detector.predict(red, options=PetDetectionOptions())

        blob = cast(mock.Mock, detector.session).run.call_args[0][1]["input"]
        # After ImageNet normalisation the red channel is the largest of the three.
        assert blob[0, 0].mean() > blob[0, 1].mean()
        assert blob[0, 0].mean() > blob[0, 2].mean()

    def test_preprocess_honours_input_size(self, mocker: MockerFixture) -> None:
        """Spec #2, consumer half: the blob matches the configured size."""
        for size in (384, 512):
            detector = self._detector(mocker, input_size=size)
            cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([])
            detector.predict(Image.new("RGB", (100, 200), (10, 20, 30)), options=PetDetectionOptions())
            blob = cast(mock.Mock, detector.session).run.call_args[0][1]["input"]
            assert blob.shape == (1, 3, size, size)

    def test_load_reads_input_size_from_session(self, mocker: MockerFixture) -> None:
        """Spec #2, producer half: _load must take the size from the ONNX signature.

        Without this, the consumer test above would still pass against a
        hardcoded 384 and rfdetr-small would silently run at the wrong size.
        """
        for size in (384, 512):
            detector = PetDetector("rfdetr-small", cache_dir="test_cache")
            session = _graph_session()
            model_input = mock.Mock()
            model_input.name = "input"
            model_input.shape = [1, 3, size, size]
            session.get_inputs.return_value = [model_input]
            mocker.patch.object(PetDetector, "_make_session", return_value=session)
            mocker.patch.object(PetDetector, "model_path", Path("unused.onnx"))

            detector._load()

            assert detector._input_size == size
            assert detector._input_name == "input"

    def test_applies_imagenet_normalisation(self, mocker: MockerFixture) -> None:
        """Spec #3. Scale to [0,1], then (v - mean) / std."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([])

        detector.predict(Image.new("RGB", (32, 32), (255, 255, 255)), options=PetDetectionOptions())

        blob = cast(mock.Mock, detector.session).run.call_args[0][1]["input"]
        expected = [(1.0 - 0.485) / 0.229, (1.0 - 0.456) / 0.224, (1.0 - 0.406) / 0.225]
        for channel, value in enumerate(expected):
            assert blob[0, channel].mean() == pytest.approx(value, abs=1e-4)

    def test_blob_is_nchw_float32(self, mocker: MockerFixture) -> None:
        """Spec #4."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([])
        detector.predict(Image.new("RGB", (64, 48), (128, 128, 128)), options=PetDetectionOptions())
        blob = cast(mock.Mock, detector.session).run.call_args[0][1]["input"]
        assert blob.dtype == np.float32
        assert blob.shape == (1, 3, 384, 384)

    def test_does_not_letterbox(self, mocker: MockerFixture) -> None:
        """Spec #5. A letterboxed 2:1 image would carry a grey 114 band; RF-DETR stretches."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([])

        detector.predict(Image.new("RGB", (200, 100), (255, 255, 255)), options=PetDetectionOptions())

        blob = cast(mock.Mock, detector.session).run.call_args[0][1]["input"]
        padded = (114 / 255.0 - 0.485) / 0.229
        assert not np.any(np.isclose(blob[0, 0], padded, atol=1e-3))

    def test_converts_non_rgb_input(self, mocker: MockerFixture) -> None:
        """Spec #6. Greyscale and palette images are converted, not rejected."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([])

        for mode in ("L", "P"):
            detector.predict(Image.new(mode, (32, 32)), options=PetDetectionOptions())
            blob = cast(mock.Mock, detector.session).run.call_args[0][1]["input"]
            assert blob.shape == (1, 3, 384, 384)

    # ---- postprocessing (spec #7-#17) ----

    def test_applies_sigmoid_to_logits(self, mocker: MockerFixture) -> None:
        """Spec #7. A raw logit of 0 is probability 0.5."""
        detector = self._detector(mocker)
        dets = np.zeros((1, 300, 4), dtype=np.float32)
        logits = np.full((1, 300, 91), -30.0, dtype=np.float32)
        dets[0, 0] = (0.5, 0.5, 0.2, 0.2)
        logits[0, 0, 18] = 0.0
        cast(mock.Mock, detector.session).run.return_value = [dets, logits]

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions(min_score=0.4))

        assert len(results) == 1
        assert results[0]["score"] == pytest.approx(0.5, abs=1e-4)

    def test_maps_pet_labels(self, mocker: MockerFixture) -> None:
        """Spec #8. 91-class ids, not YOLO's 80-class space."""
        expected = {17: "cat", 18: "dog"}
        for class_id, label in expected.items():
            detector = self._detector(mocker)
            cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output(
                [(0.5, 0.5, 0.2, 0.2, class_id, 0.9)]
            )
            results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())
            assert len(results) == 1
            assert results[0]["label"] == label

    def test_excludes_non_pet_domestic_classes(self, mocker: MockerFixture) -> None:
        """bird/horse/sheep/cow are scored but never emitted — only cats and dogs are pets."""
        for class_id in (16, 19, 20, 21):
            detector = self._detector(mocker)
            cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output(
                [(0.5, 0.5, 0.2, 0.2, class_id, 0.99)]
            )
            results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())
            assert results == []

    def test_non_pet_animal_is_dropped_not_relabelled(self, mocker: MockerFixture) -> None:
        """A horse must stay scored so it wins its own argmax and is dropped.

        Removing horse from the scoring subspace instead would make this query surface as a
        0.40 dog, filing horses and cows under the dog entry rather than discarding them.
        """
        detector = self._detector(mocker)
        dets = np.zeros((1, 300, 4), dtype=np.float32)
        logits = np.full((1, 300, 91), -30.0, dtype=np.float32)
        dets[0, 0] = (0.5, 0.5, 0.2, 0.2)
        logits[0, 0, 19] = float(np.log(0.99 / 0.01))  # horse
        logits[0, 0, 18] = float(np.log(0.40 / 0.60))  # dog
        cast(mock.Mock, detector.session).run.return_value = [dets, logits]

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())

        assert results == []

    def test_excludes_safari_classes(self, mocker: MockerFixture) -> None:
        """Spec #9. elephant/bear/zebra/giraffe at 0.99 emit nothing — the reported bug."""
        for class_id in (22, 23, 24, 25):
            detector = self._detector(mocker)
            cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output(
                [(0.5, 0.5, 0.2, 0.2, class_id, 0.99)]
            )
            results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())
            assert results == []

    def test_excludes_non_animal_classes(self, mocker: MockerFixture) -> None:
        """Spec #10. person=1, car=3."""
        for class_id in (1, 3):
            detector = self._detector(mocker)
            cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output(
                [(0.5, 0.5, 0.2, 0.2, class_id, 0.99)]
            )
            results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())
            assert results == []

    def test_score_is_max_over_domestic_subspace(self, mocker: MockerFixture) -> None:
        """Spec #11. A query scoring bear 0.99 / dog 0.60 reports dog at 0.60."""
        detector = self._detector(mocker)
        dets = np.zeros((1, 300, 4), dtype=np.float32)
        logits = np.full((1, 300, 91), -30.0, dtype=np.float32)
        dets[0, 0] = (0.5, 0.5, 0.2, 0.2)
        logits[0, 0, 23] = float(np.log(0.99 / 0.01))  # bear
        logits[0, 0, 18] = float(np.log(0.60 / 0.40))  # dog
        cast(mock.Mock, detector.session).run.return_value = [dets, logits]

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())

        assert len(results) == 1
        assert results[0]["label"] == "dog"
        assert results[0]["score"] == pytest.approx(0.60, abs=1e-3)

    def test_converts_boxes_to_pixels(self, mocker: MockerFixture) -> None:
        """Spec #12. Normalised cxcywh -> pixel xyxy against ORIGINAL dimensions."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([(0.5, 0.5, 0.4, 0.2, 18, 0.9)])

        results = detector.predict(Image.new("RGB", (200, 100), (0, 0, 0)), options=PetDetectionOptions())

        box = results[0]["boundingBox"]
        assert box == {"x1": 60, "y1": 40, "x2": 140, "y2": 60}
        assert all(isinstance(v, int) for v in box.values())

    def test_clips_boxes_to_image_bounds(self, mocker: MockerFixture) -> None:
        """Spec #13. A box overhanging the edge is clipped, not emitted negative."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([(0.1, 0.1, 0.6, 0.6, 18, 0.9)])

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())

        box = results[0]["boundingBox"]
        assert box["x1"] == 0
        assert box["y1"] == 0
        assert box["x2"] <= 100
        assert box["y2"] <= 100

    def test_honours_min_score(self, mocker: MockerFixture) -> None:
        """Spec #14. Just below is dropped, just above is kept."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([(0.5, 0.5, 0.2, 0.2, 18, 0.49)])
        assert (
            detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions(min_score=0.5)) == []
        )

        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([(0.5, 0.5, 0.2, 0.2, 18, 0.51)])
        assert (
            len(detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions(min_score=0.5)))
            == 1
        )

    def test_resolves_outputs_by_shape_not_order(self, mocker: MockerFixture) -> None:
        """Spec #15. Export order is not guaranteed; identify by trailing dimension."""
        detector = self._detector(mocker)
        dets, logits = self._make_rfdetr_output([(0.5, 0.5, 0.2, 0.2, 17, 0.9)])
        cast(mock.Mock, detector.session).run.return_value = [logits, dets]  # swapped

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())

        assert len(results) == 1
        assert results[0]["label"] == "cat"

    def test_returns_multiple_detections(self, mocker: MockerFixture) -> None:
        """Spec #16."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output(
            [
                (0.25, 0.25, 0.2, 0.2, 18, 0.9),
                (0.75, 0.75, 0.2, 0.2, 17, 0.8),
            ]
        )

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())

        assert len(results) == 2
        assert {r["label"] for r in results} == {"dog", "cat"}

    def test_returns_empty_list_when_nothing_passes(self, mocker: MockerFixture) -> None:
        """Spec #17. Empty is a list, not an error."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([])
        assert detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions()) == []

    # ---- edge cases (spec #18-#25) ----

    def test_degenerate_box_does_not_raise(self, mocker: MockerFixture) -> None:
        """Spec #18. Zero width/height."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([(0.5, 0.5, 0.0, 0.0, 18, 0.9)])
        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())
        assert isinstance(results, list)

    def test_box_fully_outside_is_dropped(self, mocker: MockerFixture) -> None:
        """Spec #19. Clipping leaves zero area, so it must not be emitted."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([(1.8, 1.8, 0.2, 0.2, 18, 0.9)])
        assert detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions()) == []

    def test_extreme_aspect_ratio(self, mocker: MockerFixture) -> None:
        """Spec #20."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([(0.5, 0.5, 0.1, 0.5, 18, 0.9)])
        results = detector.predict(Image.new("RGB", (4000, 100), (0, 0, 0)), options=PetDetectionOptions())
        box = results[0]["boundingBox"]
        assert box["x1"] == 1800 and box["x2"] == 2200
        assert box["y1"] == 25 and box["y2"] == 75

    def test_tiny_image(self, mocker: MockerFixture) -> None:
        """Spec #21."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([(0.5, 0.5, 0.5, 0.5, 18, 0.9)])
        results = detector.predict(Image.new("RGB", (10, 10), (0, 0, 0)), options=PetDetectionOptions())
        assert isinstance(results, list)

    def test_all_queries_above_threshold(self, mocker: MockerFixture) -> None:
        """Spec #22. The 300-query maximum."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output(
            [(0.5, 0.5, 0.1, 0.1, 18, 0.9)] * 300
        )
        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)), options=PetDetectionOptions())
        assert len(results) == 300

    def test_min_score_follows_each_request(self, mocker: MockerFixture) -> None:
        """Spec #23. The model cache hands every request the instance the first one built, so a threshold the
        admin changes afterwards must come from the request itself, never from construction."""
        detector = self._detector(mocker)
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output([(0.5, 0.5, 0.2, 0.2, 18, 0.5)])

        assert detector.predict(Image.new("RGB", (100, 100)), options=PetDetectionOptions(min_score=0.6)) == []
        assert len(detector.predict(Image.new("RGB", (100, 100)), options=PetDetectionOptions(min_score=0.3))) == 1

    def test_min_score_from_request(self) -> None:
        """Spec #23, wire form: the server sends `minScore`, which must reach the detector as its options."""
        request = {"pet-detection": {"detection": {"modelName": "rfdetr-nano", "options": {"minScore": 0.8}}}}
        (entry,) = ml_main.PIPELINE_REQUEST.validate_json(orjson.dumps(request)).entries()
        assert entry.model is PetDetector
        assert entry.options == PetDetectionOptions(min_score=0.8)

    def test_detector_clamps_boxes_to_image_bounds(self, mocker: MockerFixture) -> None:
        """RF-DETR emits normalised centre/size; a query straddling the edge must not escape it."""
        detector = self._detector(mocker)
        # Boxes wider than the frame and centred on the edges: unclamped these produce negative
        # corners and corners past (600, 800).
        cast(mock.Mock, detector.session).run.return_value = self._make_rfdetr_output(
            [
                (0.95, 0.95, 0.5, 0.5, 18, 0.9),  # dog, overflows bottom-right
                (0.05, 0.05, 0.5, 0.5, 17, 0.85),  # cat, overflows top-left
            ]
        )

        results = detector.predict(Image.new("RGB", (600, 800)), options=PetDetectionOptions(min_score=0.5))

        assert len(results) == 2
        for detection in results:
            box = detection["boundingBox"]
            assert 0 <= box["x1"] <= box["x2"] <= 600
            assert 0 <= box["y1"] <= box["y2"] <= 800

    def test_model_path_prefers_standard_then_legacy(self, mocker: MockerFixture) -> None:
        """Spec #24."""
        mocker.patch.object(PetDetector, "load")
        detector = PetDetector("rfdetr-nano", cache_dir="test_cache")

        mocker.patch.object(Path, "is_file", return_value=True)
        assert detector.model_path.name == "model.onnx"

    def test_download_targets_expected_repo(self, mocker: MockerFixture) -> None:
        """Spec #25. Goes through `download()`, the entry point `load()` uses, so an override the base class
        stops calling fails here."""
        mocker.patch.object(settings, "model_revision", "v2")  # upstream's revisions do not exist in our org
        detector = PetDetector("rfdetr-nano", cache_dir="test_cache")
        mocker.patch.object(PetDetector, "cached", new_callable=mock.PropertyMock, side_effect=[False, True])
        snapshot_download = mocker.patch("immich_ml.models.gallery_hosted.snapshot_download")

        detector.download()

        snapshot_download.assert_called_once_with(
            "open-noodle/rfdetr-nano",
            cache_dir=detector.cache_dir,
            local_dir=detector.cache_dir,
            ignore_patterns=["*.armnn", "*.rknn"],
        )

    def test_default_cache_dir_ignores_model_revision(self, mocker: MockerFixture) -> None:
        mocker.patch.object(settings, "model_revision", "v2")
        detector = PetDetector("rfdetr-nano")

        assert detector.cache_dir == settings.cache_folder / "pet-detection" / "rfdetr-nano"

    def test_download_raises_when_the_format_is_missing(self, mocker: MockerFixture) -> None:
        """A repository with nothing in this format must raise, which is what sends a model back to ONNX."""
        detector = PetDetector("rfdetr-nano", cache_dir="test_cache", model_format=ModelFormat.RKNN)
        mocker.patch.object(PetDetector, "cached", new_callable=mock.PropertyMock, return_value=False)
        mocker.patch("immich_ml.models.gallery_hosted.snapshot_download")

        with pytest.raises(FileNotFoundError):
            detector.download()

    def test_legacy_model_path_is_onnx_only(self, mocker: MockerFixture) -> None:
        detector = PetDetector("rfdetr-nano", cache_dir="test_cache", model_format=ModelFormat.RKNN)
        # only the legacy ONNX file exists: an unguarded fallback would hand RKNN an .onnx path
        mocker.patch.object(Path, "is_file", autospec=True, side_effect=lambda path: path.suffix == ".onnx")

        assert detector.model_path.suffix == ".rknn"


class TestPetRecognition:
    @staticmethod
    def _pets() -> PetDetectionOutput:
        return [
            {"boundingBox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10}, "score": 0.9, "label": "dog"},
            {"boundingBox": {"x1": 20, "y1": 20, "x2": 40, "y2": 40}, "score": 0.8, "label": "cat"},
        ]

    def test_recognizer_returns_one_embedding_per_pet(self, pil_image: Image.Image, mocker: MockerFixture) -> None:
        mocker.patch.object(PetRecognizer, "load")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        recognizer.session = _graph_session()
        recognizer._input_name = "input"
        recognizer.session.run.return_value = [np.random.rand(2, 512).astype(np.float32)]
        pets = self._pets()

        results = recognizer.predict(pil_image, pets, options=PetRecognitionOptions())

        assert isinstance(results, list)
        assert len(results) == 2
        for pet, result in zip(pets, results):
            assert result["boundingBox"] == pet["boundingBox"]
            assert result["score"] == pet["score"]
            assert result["label"] == pet["label"]
            embedding_str = result.get("embedding")
            assert isinstance(embedding_str, str)
            embedding = orjson.loads(embedding_str)
            assert isinstance(embedding, list)
            assert len(embedding) == 512

    def test_recognizer_returns_empty_for_no_pets(self, pil_image: Image.Image, mocker: MockerFixture) -> None:
        mocker.patch.object(PetRecognizer, "load")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        recognizer.session = _graph_session()
        recognizer._input_name = "input"

        results = recognizer.predict(pil_image, [], options=PetRecognitionOptions())

        assert results == []
        recognizer.session.run.assert_not_called()

    def test_recognizer_preprocesses_rgb_imagenet_224(self, mocker: MockerFixture) -> None:
        mocker.patch.object(PetRecognizer, "load")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        recognizer.session = _graph_session()
        recognizer._input_name = "input"
        recognizer.session.run.return_value = [np.random.rand(1, 512).astype(np.float32)]

        # R=200, G=100, B=10. A B/R mix-up would swap the first and last channels.
        image = Image.new("RGB", (50, 50), (200, 100, 10))
        pets: PetDetectionOutput = [
            {"boundingBox": {"x1": 0, "y1": 0, "x2": 50, "y2": 50}, "score": 0.9, "label": "dog"},
        ]

        recognizer.predict(image, pets, options=PetRecognitionOptions())

        call_kwargs = recognizer.session.run.call_args[0][1]
        blob = call_kwargs[recognizer._input_name]
        assert blob.shape == (1, 3, 224, 224)
        assert blob.dtype == np.float32

        mean = [0.485, 0.456, 0.406]
        std = [0.229, 0.224, 0.225]
        expected_r = (200 / 255 - mean[0]) / std[0]
        expected_g = (100 / 255 - mean[1]) / std[1]
        expected_b = (10 / 255 - mean[2]) / std[2]

        assert blob[0, 0, 0, 0] == pytest.approx(expected_r, abs=1e-4)
        assert blob[0, 1, 0, 0] == pytest.approx(expected_g, abs=1e-4)
        assert blob[0, 2, 0, 0] == pytest.approx(expected_b, abs=1e-4)

    def test_recognizer_crops_each_bounding_box(self, mocker: MockerFixture) -> None:
        mocker.patch.object(PetRecognizer, "load")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        recognizer.session = _graph_session()
        recognizer._input_name = "input"
        recognizer.session.run.return_value = [np.random.rand(2, 512).astype(np.float32)]

        image = np.zeros((100, 100, 3), dtype=np.uint8)
        image[0:50, 0:50] = (0, 0, 255)  # region A: pure blue (arrays are RGB, as decode_pil reads them)
        image[50:100, 50:100] = (255, 0, 0)  # region B: pure red
        pets: PetDetectionOutput = [
            {"boundingBox": {"x1": 0, "y1": 0, "x2": 50, "y2": 50}, "score": 0.9, "label": "dog"},
            {"boundingBox": {"x1": 50, "y1": 50, "x2": 100, "y2": 100}, "score": 0.8, "label": "cat"},
        ]

        recognizer.predict(image, pets, options=PetRecognitionOptions())

        blob = recognizer.session.run.call_args[0][1][recognizer._input_name]
        assert blob.shape == (2, 3, 224, 224)
        assert not np.allclose(blob[0], blob[1])

        mean = [0.485, 0.456, 0.406]
        std = [0.229, 0.224, 0.225]
        # region A is pure blue: R and G are 0, B is 255
        assert blob[0, 0, 0, 0] == pytest.approx((0 / 255 - mean[0]) / std[0], abs=1e-4)
        assert blob[0, 2, 0, 0] == pytest.approx((255 / 255 - mean[2]) / std[2], abs=1e-4)
        # region B is pure red: R is 255, G and B are 0
        assert blob[1, 0, 0, 0] == pytest.approx((255 / 255 - mean[0]) / std[0], abs=1e-4)
        assert blob[1, 2, 0, 0] == pytest.approx((0 / 255 - mean[2]) / std[2], abs=1e-4)

    def test_recognizer_clamps_out_of_bounds_boxes(self, mocker: MockerFixture) -> None:
        mocker.patch.object(PetRecognizer, "load")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        recognizer.session = _graph_session()
        recognizer._input_name = "input"
        recognizer.session.run.return_value = [np.random.rand(1, 512).astype(np.float32)]

        # The crop shape is the load-bearing assertion, not "an embedding came back": numpy reads a
        # negative slice bound from the END of the axis, so an unclamped image[-10:1000, -20:1000]
        # still yields a non-empty (10, 20) crop and still embeds — just of the wrong region.
        mock_resize = mocker.patch(
            "immich_ml.models.pet_recognition.recognition.cv2.resize",
            return_value=np.zeros((224, 224, 3), dtype=np.uint8),
        )

        image = np.zeros((50, 50, 3), dtype=np.uint8)
        pets: PetDetectionOutput = [
            {"boundingBox": {"x1": -20, "y1": -10, "x2": 1000, "y2": 1000}, "score": 0.9, "label": "dog"},
        ]

        results = recognizer.predict(image, pets, options=PetRecognitionOptions())

        assert mock_resize.call_count == 1
        assert mock_resize.call_args_list[0].args[0].shape == (50, 50, 3)

        assert len(results) == 1
        embedding_str = results[0].get("embedding")
        assert isinstance(embedding_str, str)
        embedding = orjson.loads(embedding_str)
        assert len(embedding) == 512

    def test_recognizer_skips_degenerate_box_but_recognizes_valid_sibling(self, mocker: MockerFixture) -> None:
        mocker.patch.object(PetRecognizer, "load")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        recognizer.session = _graph_session()
        recognizer._input_name = "input"
        # only the valid sibling box is ever sent to the model -> one embedding row
        recognizer.session.run.return_value = [np.random.rand(1, 512).astype(np.float32)]

        image = np.zeros((50, 50, 3), dtype=np.uint8)
        pets: PetDetectionOutput = [
            {"boundingBox": {"x1": 10, "y1": 10, "x2": 10, "y2": 10}, "score": 0.9, "label": "cat"},
            {"boundingBox": {"x1": 0, "y1": 0, "x2": 50, "y2": 50}, "score": 0.8, "label": "dog"},
        ]

        results = recognizer.predict(image, pets, options=PetRecognitionOptions())

        assert len(results) == 2
        degenerate_result, valid_result = results
        assert degenerate_result["boundingBox"] == pets[0]["boundingBox"]
        assert degenerate_result["label"] == "cat"
        assert "embedding" not in degenerate_result

        assert valid_result["label"] == "dog"
        embedding_str = valid_result.get("embedding")
        assert isinstance(embedding_str, str)
        embedding = orjson.loads(embedding_str)
        assert len(embedding) == 512

    def test_recognizer_skips_fully_out_of_bounds_box(self, mocker: MockerFixture) -> None:
        mocker.patch.object(PetRecognizer, "load")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        recognizer.session = _graph_session()
        recognizer._input_name = "input"

        image = np.zeros((50, 50, 3), dtype=np.uint8)
        pets: PetDetectionOutput = [
            {"boundingBox": {"x1": 1000, "y1": 1000, "x2": 1010, "y2": 1010}, "score": 0.9, "label": "dog"},
        ]

        results = recognizer.predict(image, pets, options=PetRecognitionOptions())

        assert len(results) == 1
        assert "embedding" not in results[0]
        recognizer.session.run.assert_not_called()

    def test_recognizer_uses_area_interpolation_downscaling_and_linear_upscaling(self, mocker: MockerFixture) -> None:
        mocker.patch.object(PetRecognizer, "load")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        recognizer.session = _graph_session()
        recognizer._input_name = "input"
        recognizer.session.run.return_value = [np.random.rand(2, 512).astype(np.float32)]

        mock_resize = mocker.patch(
            "immich_ml.models.pet_recognition.recognition.cv2.resize",
            return_value=np.zeros((224, 224, 3), dtype=np.uint8),
        )

        image = np.zeros((500, 500, 3), dtype=np.uint8)
        pets: PetDetectionOutput = [
            # 400x400 crop: larger than 224x224 by area -> downscale -> INTER_AREA
            {"boundingBox": {"x1": 0, "y1": 0, "x2": 400, "y2": 400}, "score": 0.9, "label": "dog"},
            # 100x100 crop: smaller than 224x224 by area -> upscale -> INTER_LINEAR
            {"boundingBox": {"x1": 400, "y1": 400, "x2": 500, "y2": 500}, "score": 0.8, "label": "cat"},
        ]

        recognizer.predict(image, pets, options=PetRecognitionOptions())

        assert mock_resize.call_count == 2
        assert mock_resize.call_args_list[0].kwargs["interpolation"] == cv2.INTER_AREA
        assert mock_resize.call_args_list[1].kwargs["interpolation"] == cv2.INTER_LINEAR

    def test_recognizer_batches_predictions_by_configured_max_batch_size(self, mocker: MockerFixture) -> None:
        mocker.patch.object(settings, "max_batch_size", MaxBatchSize(pet_recognition=1))
        mocker.patch.object(PetRecognizer, "load")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        assert recognizer.shape_policy.dims == (Shape(batch=1),)

        recognizer.session = _graph_session(batches=(1,))
        recognizer._input_name = "input"

        call_sizes: list[int] = []

        def fake_run(_output_names: Any, feed: dict[str, NDArray[np.float32]]) -> list[NDArray[np.float32]]:
            blob = feed[recognizer._input_name]
            call_sizes.append(blob.shape[0])
            embedding = np.full((blob.shape[0], 512), len(call_sizes) - 1, dtype=np.float32)
            return [embedding]

        recognizer.session.run.side_effect = fake_run

        image = np.zeros((50, 50, 3), dtype=np.uint8)
        pets: PetDetectionOutput = [
            {"boundingBox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10}, "score": 0.9, "label": "dog"},
            {"boundingBox": {"x1": 10, "y1": 10, "x2": 20, "y2": 20}, "score": 0.8, "label": "cat"},
            {"boundingBox": {"x1": 20, "y1": 20, "x2": 30, "y2": 30}, "score": 0.7, "label": "bird"},
        ]

        results = recognizer.predict(image, pets, options=PetRecognitionOptions())

        assert recognizer.session.run.call_count == 3
        assert call_sizes == [1, 1, 1]
        assert [orjson.loads(r["embedding"])[0] for r in results] == [0.0, 1.0, 2.0]

    def test_recognizer_raises_on_embedding_count_mismatch(self, mocker: MockerFixture) -> None:
        mocker.patch.object(PetRecognizer, "load")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        recognizer.session = _graph_session()
        recognizer._input_name = "input"
        # two pets are sent to the model, but the session only returns one embedding row
        recognizer.session.run.return_value = [np.random.rand(1, 512).astype(np.float32)]

        image = np.zeros((50, 50, 3), dtype=np.uint8)
        pets = self._pets()

        with pytest.raises(ValueError):
            recognizer.predict(image, pets, options=PetRecognitionOptions())

    def test_pipeline_resolves_pet_recognition(self) -> None:
        request = {"pet-detection": {"recognition": {"modelName": "pet-recognition-base"}}}
        (entry,) = ml_main.PIPELINE_REQUEST.validate_json(orjson.dumps(request)).entries()
        assert entry.model is PetRecognizer

    def test_pipeline_resolves_pet_detector(self) -> None:
        request = {"pet-detection": {"detection": {"modelName": "rfdetr-nano"}}}
        (entry,) = ml_main.PIPELINE_REQUEST.validate_json(orjson.dumps(request)).entries()
        assert entry.model is PetDetector

    def test_pipeline_rejects_a_model_from_another_source(self) -> None:
        request = {"pet-detection": {"detection": {"modelName": "buffalo_l"}}}
        with pytest.raises(HTTPException) as e:
            ml_main.get_entries(orjson.dumps(request).decode())
        assert e.value.status_code == 422

    def test_download_uses_open_noodle_org(self, mocker: MockerFixture) -> None:
        snapshot_download = mocker.patch("immich_ml.models.gallery_hosted.snapshot_download")
        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        mocker.patch.object(PetRecognizer, "cached", new_callable=mock.PropertyMock, side_effect=[False, True])

        recognizer.download()

        snapshot_download.assert_called_once_with(
            "open-noodle/pet-recognition-base",
            cache_dir=recognizer.cache_dir,
            local_dir=recognizer.cache_dir,
            ignore_patterns=["*.armnn", "*.rknn"],
        )


class TestPetPipeline:
    @pytest.mark.asyncio
    async def test_recognition_overwrites_pet_detection_key_with_paired_embeddings(self, mocker: MockerFixture) -> None:
        """Endpoint-level pairing contract (F12/R7.6): the recognition entry's output overwrites the
        'pet-detection' response key produced by the detection entry, and each crop's deterministic
        fake embedding (mean pixel value, computed independently of the production zip) survives
        end-to-end through run_inference. A reversed zip inside PetRecognizer._predict would swap the
        two embeddings between labels and fail this test."""
        detector = PetDetector("rfdetr-nano", cache_dir="test_cache")
        detector.loaded = True
        detected_pets: PetDetectionOutput = [
            {"boundingBox": {"x1": 0, "y1": 0, "x2": 50, "y2": 50}, "score": 0.9, "label": "dog"},
            {"boundingBox": {"x1": 50, "y1": 50, "x2": 100, "y2": 100}, "score": 0.8, "label": "cat"},
        ]
        mocker.patch.object(PetDetector, "_predict", return_value=detected_pets)

        recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
        recognizer.loaded = True
        recognizer._input_name = "input"
        recognizer.session = _graph_session()

        def fake_run(_output_names: Any, feed: dict[str, NDArray[np.float32]]) -> list[NDArray[np.float32]]:
            blob = feed[recognizer._input_name]
            means = blob.reshape(blob.shape[0], -1).mean(axis=1).astype(np.float32)
            return [np.stack([np.full(512, m, dtype=np.float32) for m in means])]

        recognizer.session.run.side_effect = fake_run

        def fake_get(entry: InferenceEntry[Any], ttl: int | None = None) -> Any:
            return detector if entry.model is PetDetector else recognizer

        mocker.patch.object(ml_main.model_cache, "get", side_effect=fake_get)

        # region A (dog crop): pure blue; region B (cat crop): pure red
        image = np.zeros((100, 100, 3), dtype=np.uint8)
        image[0:50, 0:50] = (0, 0, 255)
        image[50:100, 50:100] = (255, 0, 0)
        pil_image = Image.fromarray(image)

        request = {
            "pet-detection": {
                "detection": {"modelName": "rfdetr-nano"},
                "recognition": {"modelName": "pet-recognition-base"},
            }
        }
        entries = list(ml_main.PIPELINE_REQUEST.validate_json(orjson.dumps(request)).entries())

        response = await ml_main.run_inference(pil_image, entries)

        pet_detection_result = response["pet-detection"]
        assert len(pet_detection_result) == 2
        dog_result, cat_result = pet_detection_result
        assert dog_result["label"] == "dog"
        assert cat_result["label"] == "cat"
        assert "embedding" in dog_result
        assert "embedding" in cat_result

        from immich_ml.models.pet_recognition.recognition import _MEAN, _STD

        def expected_mean(rgb: tuple[int, int, int]) -> float:
            channel_values = [(c / 255.0 - _MEAN[i]) / _STD[i] for i, c in enumerate(rgb)]
            return float(np.mean(channel_values))

        dog_expected = expected_mean((0, 0, 255))  # region A
        cat_expected = expected_mean((255, 0, 0))  # region B

        dog_embedding = orjson.loads(dog_result["embedding"])
        cat_embedding = orjson.loads(cat_result["embedding"])
        assert np.allclose(dog_embedding, dog_expected, atol=1e-4)
        assert np.allclose(cat_embedding, cat_expected, atol=1e-4)
