# Slice 1 — ML service: `PetRecognizer`

- **Spec:** [`../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md`](../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md) § Slice 1
- **Scope:** `machine-learning/` only. Touch no server, web or mobile file.

## Objective

Add a `PetRecognizer` inference model that turns each detected pet box into a 512-d L2-normalized
embedding, served from the same `/predict` call as pet detection.

## Context you need

- `/predict` orchestration (`immich_ml/main.py:217-244`): models with `depends` run in a second
  phase; each entry writes `response[entry["task"]] = output`. Detection and recognition share the
  task key `pet-detection`, so **the recognizer's output is what the server receives** — it must
  therefore carry `boundingBox`, `score` and `label` through, not just embeddings.
- Dependency plumbing: `run_inference` builds `inputs = [payload, outputs[dep]]` and calls
  `model.predict(*inputs)`. So `_predict(self, inputs, pets)` receives the detector's output as the
  second positional argument. `PetDetectionOutput` is a **list of dicts** (`boundingBox/score/label`),
  unlike `FaceDetectionOutput` which is ndarray-based — there are no landmarks, so crop from the box.
- The published models live under the **`open-noodle`** org, while the pet _detectors_ live under
  `Deeds67`. Do not reuse `pet_detection.detection._HF_ORG`.
- Model I/O contract: input `input` `[N,3,224,224]` float32 **RGB**, ImageNet mean/std normalized;
  output `embedding` `[N,512]`, already L2-normalized by the graph.

## TDD steps

Run everything from `machine-learning/`. Test command: `uv run pytest -q -k PetRecognition`.

### Step 1 — RED: add `TestPetRecognition` to `test_main.py`

Write tests 1.1–1.9 from the spec. Pattern-match `TestFaceRecognition` (`test_main.py:821-860`)
for mocking and `TestPetDetection` (`test_main.py:1111-1213`) for pet fixtures:

```python
mocker.patch.object(PetRecognizer, "load")
recognizer = PetRecognizer("pet-recognition-base", cache_dir="test_cache")
recognizer.session = mock.Mock()
recognizer.session.run.return_value = [np.random.rand(2, 512).astype(np.float32)]
pets = [
    {"boundingBox": {"x1": 0, "y1": 0, "x2": 10, "y2": 10}, "score": 0.9, "label": "dog"},
    {"boundingBox": {"x1": 20, "y1": 20, "x2": 40, "y2": 40}, "score": 0.8, "label": "cat"},
]
result = recognizer.predict(cv_image, pets)
```

For test 1.3 (preprocessing) capture the session input:
`blob = recognizer.session.run.call_args[0][1][recognizer._input_name]` and assert shape/dtype, then
assert the R channel of the blob matches the **B** channel of the source cv2 (BGR) image after
`(x/255 - mean)/std`. This is the test that catches a BGR/RGB mix-up.

Expected red: `ImportError: cannot import name 'PetRecognizer' from 'immich_ml.models.pet_recognition'`
(tests 1.1–1.6, 1.9) and `ValueError: Unknown model combination` (test 1.7).

**Confirm the red output before writing any implementation.**

### Step 2 — GREEN: implement

1. `immich_ml/schemas.py` — add after `PetDetectionOutput`:

   ```python
   class RecognizedPet(TypedDict):
       boundingBox: BoundingBox
       score: float
       label: str
       embedding: str

   PetRecognitionOutput = list[RecognizedPet]
   ```

2. `immich_ml/models/constants.py` — `ModelSource.PET_RECOGNITION = "pet-recognition"`,
   `_PET_RECOGNITION_MODELS = {"pet-recognition-small", "pet-recognition-base", "pet-recognition-large"}`,
   and a `if cleaned_name in _PET_RECOGNITION_MODELS: return ModelSource.PET_RECOGNITION` branch in
   `get_model_source` (before the `_YOLO_MODELS` branch is fine; the sets are disjoint).
3. `immich_ml/models/pet_recognition/__init__.py` — `from .recognition import PetRecognizer`.
4. `immich_ml/models/pet_recognition/recognition.py` — the model. Structure:
   - `depends = [(ModelType.DETECTION, ModelTask.PET_DETECTION)]`
   - `identity = (ModelType.RECOGNITION, ModelTask.PET_DETECTION)`
   - `_download` → `snapshot_download(f"open-noodle/{clean_name(self.model_name)}", cache_dir=..., local_dir=...)`
   - `_load` → `self._make_session(self.model_path)`, capture `self._input_name`
   - `_predict(self, inputs, pets)` → `[]` when `not pets`; else crop/preprocess/batch/serialize
   - module-level `_INPUT_SIZE = 224`, `_MEAN`, `_STD` as `np.float32` arrays
   - crop helper clamps to `[0, w]` / `[0, h]` and guarantees at least 1px in each dimension
5. `immich_ml/models/__init__.py` — add the `case ModelSource.PET_RECOGNITION, ModelType.RECOGNITION, ModelTask.PET_DETECTION` branch with a local import (mirroring how `PetDetector` is imported inside the match).

### Step 3 — verify

```bash
cd machine-learning
uv run pytest -q                       # whole suite, not just the new class
uv run ruff check immich_ml test_main.py
uv run ruff format --check immich_ml test_main.py
uv run mypy --strict immich_ml
```

All four must pass. `mypy --strict` is a CI gate and will complain about untyped dict access — type
the crop helper and the return value explicitly.

## Edge cases that must be covered (not optional)

- empty `pets` list → `[]`, session never invoked
- box partially outside the image (negative or beyond-width coords) → clamped, no exception
- zero-area / inverted box → clamped to ≥1px, still returns an embedding entry
- `label` and `score` from detection are preserved verbatim in the output

## Done criteria

- Tests 1.1–1.9 green; full `uv run pytest` green; ruff + mypy --strict clean.
- No file outside `machine-learning/` modified.

## Commit

`feat(ml): pet recognition embedder (PetRecognizer)`
