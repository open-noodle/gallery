# Roadmap Phase A — Slice A1 Implementation Plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-capability-roadmap.md` (Phase A).
Slice A1: ML heuristic image-quality predictor (machine-learning, pytest). ML-only —
no server/agent changes (those are A2–A4).

## Goal

A pure-Python (OpenCV/numpy) image-quality predictor in the ML service that, given
a decoded image, returns `{ sharpness, exposure, brightness, quality }` (each 0–100).
No model download; fits the existing `InferenceModel` framework.

## Resolved framework facts (grounded)

- `InferenceModel` (`immich_ml/models/base.py`): `load()` calls `self.download()`
  then `self.session = self._load(); self.loaded = True` — so a heuristic can make
  `_download()` a no-op and `_load()` return `None` (the session is unused).
  `predict()` calls `load()` then `_predict(*inputs)`. `_predict(image)` receives the
  decoded PIL `Image` (the `/predict` endpoint decodes via `decode_pil`).
- Registry: `get_model_class(model_name, model_type, model_task)`
  (`immich_ml/models/__init__.py`) matches `(source, type, task)`. For a no-model
  heuristic, add a **task-based** case (match `ModelTask.IMAGE_QUALITY` →
  `QualityScorer`) BEFORE the catch-all `case _: raise`, so it doesn't depend on a
  model-name→source mapping. (Confirm the match arm placement/shape by reading the
  file; the goal is "any image-quality request → QualityScorer".)
- Deps available: `numpy`, `opencv-python-headless` (cv2), `pillow`.
- `ModelTask`/`ModelType` enums in `immich_ml/schemas.py`.

## Open question resolved here (OQ-A2): heuristic formulas (0–100)

Compute on a grayscale numpy array (downscale to a max edge ~1024 for speed/
stability):

- **Sharpness** = `cv2.Laplacian(gray, cv2.CV_64F).var()` → normalized:
  `min(100, round(100 * variance / SHARPNESS_SCALE))` with a calibration constant
  `SHARPNESS_SCALE` (pick a sane default, e.g. tuned so a crisp photo lands ~70–100
  and a heavily-blurred one <20). Tests assert RELATIVE ordering, not absolutes.
- **Exposure** = `100 - clip%`, where `clip%` is the percentage of pixels in the
  luminance histogram's extreme bins (≤ `LOW` e.g. 4, or ≥ `HIGH` e.g. 251). A
  well-exposed image clips little → high score; a blown-out/black image clips a lot
  → low score.
- **Brightness** = `round(100 * mean(luminance) / 255)`.
- **quality** = a documented weighted composite, e.g.
  `round(0.5*sharpness + 0.3*exposure + 0.2*brightness)`.

Keep the constants module-level + named so they're tunable.

## Implementation

1. `immich_ml/schemas.py`: add `ModelTask.IMAGE_QUALITY = "image-quality"`. Add a
   `ModelType` value if the registry match needs one (e.g. reuse an existing type,
   or add `QUALITY = "quality"`); the predictor's `identity` is
   `(ModelType.<chosen>, ModelTask.IMAGE_QUALITY)`. If `InferenceEntries`/the entries
   validation enumerates tasks/types, add the new task there so a pipeline entry
   `{ "image-quality": { "<type>": { "modelName": "builtin-image-quality" } } }`
   validates.
2. `immich_ml/models/quality.py` (new): `class QualityScorer(InferenceModel)` with
   `identity = (ModelType.<chosen>, ModelTask.IMAGE_QUALITY)`, `_download()` → `pass`,
   `_load()` → `return None`, `_predict(self, image)` → the heuristic dict above
   (convert PIL→numpy, grayscale, downscale, compute, clamp/round to int 0–100).
3. `immich_ml/models/__init__.py`: import + add the task-based `get_model_class` case.
4. Confirm `/predict` returns `{ "image-quality": {...} }` for an image-quality
   pipeline (the response is keyed by task already).

## TDD steps

### Task 1: failing tests (red)

`immich_ml/models/test_quality.py` (or the repo's test convention — mirror an
existing predictor test; check `test_main.py`/conftest for fixtures + how images are
built, e.g. `PIL.Image.new` / numpy arrays):

- `_predict` on a SHARP synthetic image (high-frequency checkerboard/noise) returns
  higher `sharpness` than on a Gaussian-BLURRED version of the same image.
- A mostly-black image returns low `exposure` and low `brightness`; a mostly-white
  (blown-out) image returns low `exposure`, high `brightness`.
- A mid-gray, mildly-textured image returns mid-range scores.
- All four keys present; each is an int in 0–100; deterministic on a fixed image.
- `quality` is the documented composite of the three.

App/registry level:

- `get_model_class(<name>, <type>, ModelTask.IMAGE_QUALITY)` returns `QualityScorer`.
- (If feasible without a running server) a `/predict` call with an image-quality
  pipeline returns the quality block — else assert at the `run_inference`/model level.

Run red (predictor/enum not defined).

### Task 2: implement (green)

Add the enum(s), the `QualityScorer`, and the registry case. Green:

```bash
cd machine-learning && /opt/homebrew/bin/mise exec -- uv run pytest immich_ml/models/test_quality.py -q
# then the full ML suite:
cd machine-learning && /opt/homebrew/bin/mise exec -- uv run pytest -q
```

Run the ML lint/format the repo uses (ruff/black/mypy — check `pyproject.toml`
`[tool.*]` and any `make` target / CI "Test ML"): e.g.
`uv run ruff check immich_ml/models/quality.py && uv run ruff format --check`.

## Edge cases (named tests)

- Grayscale (single-channel) input.
- Very small image (e.g. 4×4) — no crash, valid scores.
- All-black and all-white extremes.
- An image with an alpha channel / RGBA (convert to RGB first).
- Non-image / corrupt bytes never reach `_predict` (the endpoint decodes), but
  `_predict` on an unexpected mode (e.g. "P"/"CMYK") converts safely.

## Acceptance

- `test_quality.py` green; full ML pytest green; ML lint/format clean.
- Relative-ordering assertions hold (sharp > blurry; black/white exposure low).
- No model download; no network; deterministic.

## Commit

`feat(ml): add heuristic image-quality predictor (sharpness/exposure/brightness)`
