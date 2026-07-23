# Pet Detection RF-DETR — Slice 2: ML service detector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the YOLO11 pet detector with RF-DETR in the machine-learning service, restricted to the six domestic animal classes, with the preprocessing contract enforced by tests.

**Architecture:** `PetDetector` keeps its `InferenceModel` shape (same `identity`, same `_download`, same `configure`) but swaps its inference internals. Preprocessing moves from OpenCV-BGR-stretch to Pillow-RGB + ImageNet normalisation at a session-derived input size. Postprocessing moves from an anchor grid with hand-rolled NMS to RF-DETR's 300-query end-to-end head, which needs no NMS. The `ModelSource.YOLO` enum member and `_YOLO_MODELS` registry are renamed rather than added alongside — YOLO support is removed, not deprecated.

**Tech Stack:** Python 3.11+, ONNX Runtime, NumPy, OpenCV (resize only), Pillow (decode), pytest + pytest-mock.

## Global Constraints

Copied from the spec (`docs/superpowers/specs/2026-07-23-pet-detection-rfdetr-design.md`) — these apply to every task:

- **Colour order:** RGB. Never `decode_cv2` in this module — its RGB→BGR conversion is the original defect.
- **Resize:** plain square resize to the session's input size. **No letterbox.** RF-DETR is not YOLO.
- **Normalisation:** scale to `[0,1]`, then ImageNet mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]`.
- **Label space:** 91-class COCO ids — `bird=16, cat=17, dog=18, horse=19, sheep=20, cow=21`. **Not** YOLO's 80-class space where the same animals sit at 14–19.
- **Class set:** those six only. `bear`, `zebra`, `giraffe`, `elephant` must never be emitted.
- **Input size:** read from `session.get_inputs()[0].shape[2]`. Never hardcode — nano is 384, small is 512.
- **No NMS.** RF-DETR's 300 queries are already deduplicated.
- Scope is `machine-learning/` only. No server, web, docs, or e2e changes — those are Slices 3–5.
- Type annotations required (`mypy` runs in CI); the module is fully annotated today and must stay so.

## Input path — read this before writing `_predict`

`main.py:201` decodes the uploaded file with `decode_pil(image)` **before** dispatching, so
`_predict` receives a `PIL.Image.Image` that is already RGB. The shipped code then calls
`decode_cv2` on it, which routes to `pil_to_cv2` and applies `COLOR_RGB2BGR` — that is the
defect, stated precisely: the service is handed a correct RGB image and converts it to BGR
before inference.

Two consequences the implementation must respect:

1. The parameter type is `Image.Image | bytes`, not `NDArray[np.uint8] | bytes`. The old
   annotation described the `decode_cv2` era.
2. `decode_pil` returns an `Image.Image` **unchanged** — its `convert("RGB")` only runs on the
   bytes path. Greyscale or palette input therefore reaches `np.array()` as a 2-D array and
   breaks the channel-wise normalisation. Convert the mode explicitly.

## Scope

Slice 2 of 5. Slice 1 (publishing weights to HuggingFace) is blocked on a write token and is **not** required here — every test in this slice uses a mocked ONNX session.

---

## File Structure

| File                                                           | Status      | Responsibility                                                           |
| -------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `machine-learning/immich_ml/schemas.py`                        | **Modify**  | Rename `ModelSource.YOLO` → `ModelSource.RFDETR`.                        |
| `machine-learning/immich_ml/models/constants.py`               | **Modify**  | Replace `_YOLO_MODELS` with `_RFDETR_MODELS`; update `get_model_source`. |
| `machine-learning/immich_ml/models/__init__.py`                | **Modify**  | Update the `get_model_class` match arm.                                  |
| `machine-learning/immich_ml/models/pet_detection/detection.py` | **Rewrite** | RF-DETR preprocessing, inference and postprocessing.                     |
| `machine-learning/test_main.py`                                | **Modify**  | Replace `TestPetDetection` wholesale (spec tests #1–#25).                |

## Reference: commands

All commands run from `machine-learning/`. The `cpu` extra carries `onnxruntime` and is **not**
installed by a bare `uv sync` — without it every test in this file errors at import:

```bash
cd machine-learning
uv sync --extra cpu                                  # once per worktree
uv run pytest test_main.py -k PetDetection -v        # this slice's tests
uv run pytest test_main.py -q                        # full file (baseline: 114 passed, 3 skipped)
uv run mypy immich_ml/models/pet_detection/detection.py
```

Baseline before this slice: **114 passed, 3 skipped.** After it the count changes because seven
YOLO tests are deleted and ~25 RF-DETR tests are added.

---

## Task 1: Rename the model source and registry

**Files:**

- Modify: `machine-learning/immich_ml/schemas.py:55`
- Modify: `machine-learning/immich_ml/models/constants.py:91`, `:180-181`
- Modify: `machine-learning/immich_ml/models/__init__.py:39`

**Interfaces:**

- Produces: `ModelSource.RFDETR`, `_RFDETR_MODELS = {"rfdetr-nano", "rfdetr-small"}`. Task 2 onward relies on `get_model_source("rfdetr-nano")` returning `ModelSource.RFDETR`.

- [ ] **Step 1: Write the failing test**

Add to `machine-learning/test_main.py`, inside the existing `TestModelSource`-style area — place it immediately above `class TestPetDetection:`:

```python
class TestPetDetectionModelSource:
    def test_resolves_rfdetr_models(self) -> None:
        assert get_model_source("rfdetr-nano") == ModelSource.RFDETR
        assert get_model_source("rfdetr-small") == ModelSource.RFDETR

    def test_yolo_names_are_no_longer_recognised(self) -> None:
        assert get_model_source("yolo11n") is None
        assert get_model_source("yolo11s") is None
        assert get_model_source("yolo11m") is None
```

If `get_model_source` and `ModelSource` are not already imported in `test_main.py`, add them:

```python
from immich_ml.models.constants import get_model_source
from immich_ml.schemas import ModelSource
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest test_main.py -k TestPetDetectionModelSource -v`
Expected: FAIL with `AttributeError: RFDETR` (the enum member does not exist yet).

- [ ] **Step 3: Rename the enum member**

In `machine-learning/immich_ml/schemas.py`, replace line 55:

```python
    YOLO = "yolo"
```

with:

```python
    RFDETR = "rfdetr"
```

- [ ] **Step 4: Replace the model registry**

In `machine-learning/immich_ml/models/constants.py`, replace line 91:

```python
_YOLO_MODELS = {"yolo11n", "yolo11s", "yolo11m"}
```

with:

```python
_RFDETR_MODELS = {"rfdetr-nano", "rfdetr-small"}
```

and replace the branch at lines 180-181:

```python
    if cleaned_name in _YOLO_MODELS:
        return ModelSource.YOLO
```

with:

```python
    if cleaned_name in _RFDETR_MODELS:
        return ModelSource.RFDETR
```

- [ ] **Step 5: Update the model-class match arm**

In `machine-learning/immich_ml/models/__init__.py`, replace line 39:

```python
        case ModelSource.YOLO, ModelType.DETECTION, ModelTask.PET_DETECTION:
```

with:

```python
        case ModelSource.RFDETR, ModelType.DETECTION, ModelTask.PET_DETECTION:
```

- [ ] **Step 6: Run test to verify it passes**

Run: `uv run pytest test_main.py -k TestPetDetectionModelSource -v`
Expected: PASS (2 tests).

Then confirm nothing else referenced the old name:

Run: `grep -rn "ModelSource.YOLO\|_YOLO_MODELS" immich_ml/`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add machine-learning/immich_ml/schemas.py machine-learning/immich_ml/models/constants.py machine-learning/immich_ml/models/__init__.py machine-learning/test_main.py
git commit -m "refactor(ml): rename YOLO model source to RFDETR"
```

---

## Task 2: Replace the pet detector test suite (red)

**Files:**

- Modify: `machine-learning/test_main.py:1111-1212` (the whole `TestPetDetection` class)

**Interfaces:**

- Consumes: `ModelSource.RFDETR` from Task 1.
- Produces: `_make_rfdetr_output(detections, num_queries=300)` helper returning `[dets, labels]`, used by every test below.

This task writes **only tests**. They must all fail. Task 3 makes them pass.

- [ ] **Step 1: Replace the whole `TestPetDetection` class**

Delete `machine-learning/test_main.py` lines 1111-1212 (from `class TestPetDetection:` through `assert detector.min_score == 0.8`, i.e. everything before the `@pytest.mark.asyncio` decorating `class TestCache`) and replace with:

```python
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
    def _detector(mocker: MockerFixture, min_score: float = 0.3, input_size: int = 384) -> PetDetector:
        mocker.patch.object(PetDetector, "load")
        detector = PetDetector("rfdetr-nano", min_score=min_score, cache_dir="test_cache")
        session = mock.Mock()
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
        detector.session.run.return_value = self._make_rfdetr_output([])

        red = Image.new("RGB", (64, 48), (255, 0, 0))
        detector.predict(red)

        blob = detector.session.run.call_args[0][1]["input"]
        # After ImageNet normalisation the red channel is the largest of the three.
        assert blob[0, 0].mean() > blob[0, 1].mean()
        assert blob[0, 0].mean() > blob[0, 2].mean()

    def test_preprocess_honours_input_size(self, mocker: MockerFixture) -> None:
        """Spec #2, consumer half: the blob matches the configured size."""
        for size in (384, 512):
            detector = self._detector(mocker, input_size=size)
            detector.session.run.return_value = self._make_rfdetr_output([])
            detector.predict(Image.new("RGB", (100, 200), (10, 20, 30)))
            blob = detector.session.run.call_args[0][1]["input"]
            assert blob.shape == (1, 3, size, size)

    def test_load_reads_input_size_from_session(self, mocker: MockerFixture) -> None:
        """Spec #2, producer half: _load must take the size from the ONNX signature.

        Without this, the consumer test above would still pass against a
        hardcoded 384 and rfdetr-small would silently run at the wrong size.
        """
        for size in (384, 512):
            detector = PetDetector("rfdetr-small", cache_dir="test_cache")
            session = mock.Mock()
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
        detector.session.run.return_value = self._make_rfdetr_output([])

        detector.predict(Image.new("RGB", (32, 32), (255, 255, 255)))

        blob = detector.session.run.call_args[0][1]["input"]
        expected = [(1.0 - 0.485) / 0.229, (1.0 - 0.456) / 0.224, (1.0 - 0.406) / 0.225]
        for channel, value in enumerate(expected):
            assert blob[0, channel].mean() == pytest.approx(value, abs=1e-4)

    def test_blob_is_nchw_float32(self, mocker: MockerFixture) -> None:
        """Spec #4."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output([])
        detector.predict(Image.new("RGB", (64, 48), (128, 128, 128)))
        blob = detector.session.run.call_args[0][1]["input"]
        assert blob.dtype == np.float32
        assert blob.shape == (1, 3, 384, 384)

    def test_does_not_letterbox(self, mocker: MockerFixture) -> None:
        """Spec #5. A letterboxed 2:1 image would carry a grey 114 band; RF-DETR stretches."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output([])

        detector.predict(Image.new("RGB", (200, 100), (255, 255, 255)))

        blob = detector.session.run.call_args[0][1]["input"]
        padded = (114 / 255.0 - 0.485) / 0.229
        assert not np.any(np.isclose(blob[0, 0], padded, atol=1e-3))

    def test_converts_non_rgb_input(self, mocker: MockerFixture) -> None:
        """Spec #6. Greyscale and palette images are converted, not rejected."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output([])

        for mode in ("L", "P"):
            detector.predict(Image.new(mode, (32, 32)))
            blob = detector.session.run.call_args[0][1]["input"]
            assert blob.shape == (1, 3, 384, 384)

    # ---- postprocessing (spec #7-#17) ----

    def test_applies_sigmoid_to_logits(self, mocker: MockerFixture) -> None:
        """Spec #7. A raw logit of 0 is probability 0.5."""
        detector = self._detector(mocker, min_score=0.4)
        dets = np.zeros((1, 300, 4), dtype=np.float32)
        logits = np.full((1, 300, 91), -30.0, dtype=np.float32)
        dets[0, 0] = (0.5, 0.5, 0.2, 0.2)
        logits[0, 0, 18] = 0.0
        detector.session.run.return_value = [dets, logits]

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))

        assert len(results) == 1
        assert results[0]["score"] == pytest.approx(0.5, abs=1e-4)

    def test_maps_all_domestic_labels(self, mocker: MockerFixture) -> None:
        """Spec #8. 91-class ids, not YOLO's 80-class space."""
        expected = {16: "bird", 17: "cat", 18: "dog", 19: "horse", 20: "sheep", 21: "cow"}
        for class_id, label in expected.items():
            detector = self._detector(mocker)
            detector.session.run.return_value = self._make_rfdetr_output(
                [(0.5, 0.5, 0.2, 0.2, class_id, 0.9)]
            )
            results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))
            assert len(results) == 1
            assert results[0]["label"] == label

    def test_excludes_safari_classes(self, mocker: MockerFixture) -> None:
        """Spec #9. elephant/bear/zebra/giraffe at 0.99 emit nothing — the reported bug."""
        for class_id in (22, 23, 24, 25):
            detector = self._detector(mocker)
            detector.session.run.return_value = self._make_rfdetr_output(
                [(0.5, 0.5, 0.2, 0.2, class_id, 0.99)]
            )
            results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))
            assert results == []

    def test_excludes_non_animal_classes(self, mocker: MockerFixture) -> None:
        """Spec #10. person=1, car=3."""
        for class_id in (1, 3):
            detector = self._detector(mocker)
            detector.session.run.return_value = self._make_rfdetr_output(
                [(0.5, 0.5, 0.2, 0.2, class_id, 0.99)]
            )
            results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))
            assert results == []

    def test_score_is_max_over_domestic_subspace(self, mocker: MockerFixture) -> None:
        """Spec #11. A query scoring bear 0.99 / dog 0.60 reports dog at 0.60."""
        detector = self._detector(mocker)
        dets = np.zeros((1, 300, 4), dtype=np.float32)
        logits = np.full((1, 300, 91), -30.0, dtype=np.float32)
        dets[0, 0] = (0.5, 0.5, 0.2, 0.2)
        logits[0, 0, 23] = float(np.log(0.99 / 0.01))  # bear
        logits[0, 0, 18] = float(np.log(0.60 / 0.40))  # dog
        detector.session.run.return_value = [dets, logits]

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))

        assert len(results) == 1
        assert results[0]["label"] == "dog"
        assert results[0]["score"] == pytest.approx(0.60, abs=1e-3)

    def test_converts_boxes_to_pixels(self, mocker: MockerFixture) -> None:
        """Spec #12. Normalised cxcywh -> pixel xyxy against ORIGINAL dimensions."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output(
            [(0.5, 0.5, 0.4, 0.2, 18, 0.9)]
        )

        results = detector.predict(Image.new("RGB", (200, 100), (0, 0, 0)))

        box = results[0]["boundingBox"]
        assert box == {"x1": 60, "y1": 40, "x2": 140, "y2": 60}
        assert all(isinstance(v, int) for v in box.values())

    def test_clips_boxes_to_image_bounds(self, mocker: MockerFixture) -> None:
        """Spec #13. A box overhanging the edge is clipped, not emitted negative."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output(
            [(0.1, 0.1, 0.6, 0.6, 18, 0.9)]
        )

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))

        box = results[0]["boundingBox"]
        assert box["x1"] == 0
        assert box["y1"] == 0
        assert box["x2"] <= 100
        assert box["y2"] <= 100

    def test_honours_min_score(self, mocker: MockerFixture) -> None:
        """Spec #14. Just below is dropped, just above is kept."""
        detector = self._detector(mocker, min_score=0.5)
        detector.session.run.return_value = self._make_rfdetr_output(
            [(0.5, 0.5, 0.2, 0.2, 18, 0.49)]
        )
        assert detector.predict(Image.new("RGB", (100, 100), (0, 0, 0))) == []

        detector.session.run.return_value = self._make_rfdetr_output(
            [(0.5, 0.5, 0.2, 0.2, 18, 0.51)]
        )
        assert len(detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))) == 1

    def test_resolves_outputs_by_shape_not_order(self, mocker: MockerFixture) -> None:
        """Spec #15. Export order is not guaranteed; identify by trailing dimension."""
        detector = self._detector(mocker)
        dets, logits = self._make_rfdetr_output([(0.5, 0.5, 0.2, 0.2, 17, 0.9)])
        detector.session.run.return_value = [logits, dets]  # swapped

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))

        assert len(results) == 1
        assert results[0]["label"] == "cat"

    def test_returns_multiple_detections(self, mocker: MockerFixture) -> None:
        """Spec #16."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output([
            (0.25, 0.25, 0.2, 0.2, 18, 0.9),
            (0.75, 0.75, 0.2, 0.2, 17, 0.8),
        ])

        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))

        assert len(results) == 2
        assert {r["label"] for r in results} == {"dog", "cat"}

    def test_returns_empty_list_when_nothing_passes(self, mocker: MockerFixture) -> None:
        """Spec #17. Empty is a list, not an error."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output([])
        assert detector.predict(Image.new("RGB", (100, 100), (0, 0, 0))) == []

    # ---- edge cases (spec #18-#25) ----

    def test_degenerate_box_does_not_raise(self, mocker: MockerFixture) -> None:
        """Spec #18. Zero width/height."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output(
            [(0.5, 0.5, 0.0, 0.0, 18, 0.9)]
        )
        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))
        assert isinstance(results, list)

    def test_box_fully_outside_is_dropped(self, mocker: MockerFixture) -> None:
        """Spec #19. Clipping leaves zero area, so it must not be emitted."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output(
            [(1.8, 1.8, 0.2, 0.2, 18, 0.9)]
        )
        assert detector.predict(Image.new("RGB", (100, 100), (0, 0, 0))) == []

    def test_extreme_aspect_ratio(self, mocker: MockerFixture) -> None:
        """Spec #20."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output(
            [(0.5, 0.5, 0.1, 0.5, 18, 0.9)]
        )
        results = detector.predict(Image.new("RGB", (4000, 100), (0, 0, 0)))
        box = results[0]["boundingBox"]
        assert box["x1"] == 1800 and box["x2"] == 2200
        assert box["y1"] == 25 and box["y2"] == 75

    def test_tiny_image(self, mocker: MockerFixture) -> None:
        """Spec #21."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output(
            [(0.5, 0.5, 0.5, 0.5, 18, 0.9)]
        )
        results = detector.predict(Image.new("RGB", (10, 10), (0, 0, 0)))
        assert isinstance(results, list)

    def test_all_queries_above_threshold(self, mocker: MockerFixture) -> None:
        """Spec #22. The 300-query maximum."""
        detector = self._detector(mocker)
        detector.session.run.return_value = self._make_rfdetr_output(
            [(0.5, 0.5, 0.1, 0.1, 18, 0.9)] * 300
        )
        results = detector.predict(Image.new("RGB", (100, 100), (0, 0, 0)))
        assert len(results) == 300

    def test_configure_updates_min_score(self, mocker: MockerFixture) -> None:
        """Spec #23."""
        mocker.patch.object(PetDetector, "load")
        detector = PetDetector("rfdetr-nano", min_score=0.6, cache_dir="test_cache")
        assert detector.min_score == 0.6
        detector.configure(minScore=0.3)
        assert detector.min_score == 0.3

    def test_min_score_from_kwargs(self, mocker: MockerFixture) -> None:
        """Spec #23, constructor form."""
        mocker.patch.object(PetDetector, "load")
        detector = PetDetector("rfdetr-nano", minScore=0.8, cache_dir="test_cache")
        assert detector.min_score == 0.8

    def test_model_path_prefers_standard_then_legacy(self, mocker: MockerFixture) -> None:
        """Spec #24."""
        mocker.patch.object(PetDetector, "load")
        detector = PetDetector("rfdetr-nano", cache_dir="test_cache")

        mocker.patch.object(Path, "is_file", return_value=True)
        assert detector.model_path.name == "model.onnx"

    def test_download_targets_expected_repo(self, mocker: MockerFixture) -> None:
        """Spec #25."""
        mocker.patch.object(PetDetector, "load")
        detector = PetDetector("rfdetr-nano", cache_dir="test_cache")
        snapshot_download = mocker.patch("huggingface_hub.snapshot_download")

        detector._download()

        assert snapshot_download.call_args[0][0] == "Deeds67/rfdetr-nano"
```

Ensure these imports exist at the top of `test_main.py` (add any that are missing):

```python
from pathlib import Path
from PIL import Image
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest test_main.py -k PetDetection -v`
Expected: FAIL. Most tests error with `KeyError: 'input'` or `AttributeError: _input_size`, and the label/box tests fail because the current implementation reads a `(1, 84, 8400)` tensor. **No test in this class may pass yet** — if one does, the test is not actually exercising new behaviour and must be strengthened before continuing.

- [ ] **Step 3: Commit the red tests**

```bash
git add machine-learning/test_main.py
git commit -m "test(ml): specify RF-DETR pet detector contract (red)"
```

---

## Task 3: Implement the RF-DETR detector (green)

**Files:**

- Rewrite: `machine-learning/immich_ml/models/pet_detection/detection.py`

**Interfaces:**

- Consumes: `ModelSource.RFDETR` (Task 1); the test helper's `[dets, labels]` shape (Task 2).
- Produces: `PetDetector` with unchanged public surface — `identity`, `model_path`, `_download`, `_load`, `_predict`, `configure` — so `models/__init__.py` and the FastAPI layer need no changes.

- [ ] **Step 1: Replace the module**

Replace the entire contents of `machine-learning/immich_ml/models/pet_detection/detection.py` with:

```python
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image

from immich_ml.config import clean_name
from immich_ml.models.base import InferenceModel
from immich_ml.models.transforms import decode_pil
from immich_ml.schemas import BoundingBox, ModelSession, ModelTask, ModelType, PetDetectionOutput

_HF_ORG = "Deeds67"

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

        snapshot_download(
            f"{_HF_ORG}/{clean_name(self.model_name)}",
            cache_dir=self.cache_dir,
            local_dir=self.cache_dir,
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

    def _postprocess(
        self, outputs: list[NDArray[np.float32]], orig_w: int, orig_h: int
    ) -> PetDetectionOutput:
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

        keep = confidences >= self.min_score
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
                    "label": _ANIMAL_CLASSES[int(class_ids[i])],
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
```

- [ ] **Step 2: Run the pet detection tests**

Run: `uv run pytest test_main.py -k PetDetection -v`
Expected: PASS — all tests from Task 2 green.

- [ ] **Step 3: Run the whole file for regressions**

Run: `uv run pytest test_main.py -q`
Expected: PASS. Count differs from the 114-passed baseline because seven YOLO tests were removed and ~25 RF-DETR tests added; **zero failures** is the bar.

- [ ] **Step 4: Type-check**

Run: `uv run mypy immich_ml/models/pet_detection/detection.py`
Expected: `Success: no issues found`.

- [ ] **Step 5: Confirm no YOLO remnants in the service**

Run: `grep -rn "yolo\|YOLO" machine-learning/immich_ml/`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add machine-learning/immich_ml/models/pet_detection/detection.py
git commit -m "feat(ml): replace YOLO11 pet detector with RF-DETR

Fixes two defects in one rewrite: the image now reaches the model as RGB
(decode_cv2 was converting to BGR, costing 5.1 points of recall) and the
resize matches RF-DETR's contract. The class set drops bear/zebra/giraffe/
elephant, which is what actually caused dogs to be labelled as bears.

Postprocessing loses the hand-rolled NMS entirely — RF-DETR's 300 queries
are already deduplicated."
```

---

## Self-Review

**Spec coverage.** Tests #1–#6 → Task 2 preprocessing block. #7–#17 → postprocessing block. #18–#25 → edge-case block. #26–#30c are Slice 3, #31 is Slice 1 — correctly out of scope. The registry rename is not a numbered spec test but is required by the "YOLO support removed" decision; Task 1 covers it.

**Placeholders.** None. Every step carries literal code or a literal command.

**Type consistency.** `_ANIMAL_CLASSES` is `dict[int, str]` in both the implementation and the tests' expectations. `_make_rfdetr_output` returns `[dets, labels]`, matching `_resolve_outputs`' input. `_input_size` is set in `__init__` (so `configure`-only tests that never call `_load` still work) and refreshed in `_load`. `predict` accepts a PIL image because `decode_pil` passes `Image.Image` straight through.

**One risk flagged for the reviewer.** `test_model_path_prefers_standard_then_legacy` patches `Path.is_file` globally to `True`, so it asserts only the standard branch. The legacy branch is exercised in production by `Deeds67/yolo11s`'s flat layout, which is going away; a stronger test would use `tmp_path`. Acceptable for this slice — flagged rather than hidden.
