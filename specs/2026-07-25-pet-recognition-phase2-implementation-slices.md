# Pet Recognition Phase 2 (§4.2+) — Implementation Slices

- **Status:** Ready to implement
- **Date:** 2026-07-25
- **Design:** [`2026-07-24-pet-recognition-phase2-design.md`](2026-07-24-pet-recognition-phase2-design.md) §4.2–§4.7
- **Models (done, published):** [`../plans/2026-07-24-pet-recognition-phase2-model-production-RESULTS.md`](../plans/2026-07-24-pet-recognition-phase2-model-production-RESULTS.md)
- **Branch/worktree:** `feat/pet-recognition` @ `.claude/worktrees/pet-recognition`

The design document describes the architecture but has no slice boundaries or test plan. This
document supplies both. §4.1 (model production) is complete; everything here is §4.2 onward.

## Method

Every slice is **TDD**: write the failing test first, run it and confirm it fails **for the stated
reason**, write the minimum code to pass, re-run to green, then refactor. A test that passes on its
first run is a red flag — the test is wrong, not the code.

Each slice ends with: its own tests green, the previously-green suite still green, a commit, and a
push. Each slice leaves the server **bootable** and the app working.

## Global invariants (apply to every slice)

- **Every `JobName` member must have exactly one `@OnJob` handler**, else the server throws
  `ImmichStartupError` at boot (`job.repository.ts:119-125`). Adding a `JobName` without a handler
  breaks everything, so enum + handler land in the same slice.
- **Server imports use the `src/` alias** — no relative imports (eslint enforces).
- **Fork migrations live in `server/src/schema/migrations-gallery/`** with a round timestamp, never
  in `migrations/` (which upstream rebases overwrite).
- **Never run `make sql` / `mise //:sql` without a running database** — it deletes all query files.
- **`pnpm test -- --run <path>` works for unit tests but NOT medium tests**; medium tests need
  `pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>`.
- **eslint green ≠ prettier green** — they are separate CI gates. Formatting is verified in Slice 8.
- **i18n:** only `i18n/en.json` gets new keys (other locales are translated externally). `i18n/` is
  shared with mobile — grep both before removing a key.
- Do not add `Co-Authored-By` or "Generated with" trailers to commits.

## Naming and defaults (locked)

| Thing          | Value                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Config block   | `machineLearning.petRecognition`                                                                                                      |
| Config fields  | `enabled` (default `false`), `modelName` (default `'pet-recognition-base'`), `maxDistance` (default `0.55`), `minFaces` (default `1`) |
| HF model names | `pet-recognition-small` / `pet-recognition-base` / `pet-recognition-large` (org `open-noodle`)                                        |
| Queue          | `QueueName.PetRecognition = 'petRecognition'`                                                                                         |
| Jobs           | `JobName.PetRecognitionQueueAll` / `JobName.PetRecognition`                                                                           |
| Table          | `pet_search` (`faceId` PK/FK → `asset_face` CASCADE, `embedding vector(512)`)                                                         |
| Vector index   | `VectorIndex.Pet = 'pet_index'`                                                                                                       |
| Metadata key   | `SystemMetadataKey.PetRecognitionState = 'pet-recognition-state'`                                                                     |
| ML identity    | `(ModelType.RECOGNITION, ModelTask.PET_DETECTION)` — **no new `ModelTask`**                                                           |

`maxDistance` 0.55 and `minFaces` 1 come from the §4.1 threshold sweep: cats need a looser threshold
than dogs (completeness 0.88 at 0.40 vs 0.93 at 0.50), and a low `minFaces` is what makes a pet
photographed once still surface as its own individual.

## Behavioural decision: recognition off ⇒ today's behaviour is preserved

`petRecognition.enabled` defaults to **false**. While it is off, `handlePetDetection` keeps creating
the existing per-species buckets (`getByOwnerAndSpecies`), so upgrading users see **no change** and
lose nothing. Only when an admin enables recognition does the pipeline switch to individuals, and
that transition is an explicit, purging reprocess (Slice 6). The design's "species buckets replaced
by named individuals" is therefore scoped to _recognition enabled_, which is what makes the change
shippable without a destructive migration.

---

# Slice 1 — ML service: `PetRecognizer`

**Goal:** the Python service can return a 512-d embedding per detected pet, in the same `/predict`
call as detection.

**Files**

- `machine-learning/immich_ml/schemas.py`
- `machine-learning/immich_ml/models/constants.py`
- `machine-learning/immich_ml/models/pet_recognition/__init__.py` (new)
- `machine-learning/immich_ml/models/pet_recognition/recognition.py` (new)
- `machine-learning/immich_ml/models/__init__.py`
- `machine-learning/test_main.py`

**Implementation**

1. `schemas.py`: add `embedding: str` to `DetectedPet`? **No** — keep `DetectedPet` as the detector's
   output and add:

   ```python
   class RecognizedPet(TypedDict):
       boundingBox: BoundingBox
       score: float
       label: str
       embedding: str

   PetRecognitionOutput = list[RecognizedPet]
   ```

2. `constants.py`: add `PET_RECOGNITION = "pet-recognition"` to `ModelSource`, add
   `_PET_RECOGNITION_MODELS = {"pet-recognition-small", "pet-recognition-base", "pet-recognition-large"}`,
   and a branch in `get_model_source` returning it. (The pet detectors stay `ModelSource.YOLO`.)
3. `pet_recognition/recognition.py`:

   ```python
   class PetRecognizer(InferenceModel):
       depends = [(ModelType.DETECTION, ModelTask.PET_DETECTION)]
       identity = (ModelType.RECOGNITION, ModelTask.PET_DETECTION)
   ```

   - `_HF_ORG = "open-noodle"`; `_download` uses `snapshot_download(f"{_HF_ORG}/{clean_name(self.model_name)}", ...)`,
     mirroring `PetDetector._download` but with the **different org**.
   - `_predict(self, inputs, pets: PetDetectionOutput) -> PetRecognitionOutput`: returns `[]`
     immediately if `pets` is empty; otherwise `decode_cv2(inputs)`, crop each `boundingBox`,
     preprocess, batch through the session, and return each input pet dict plus its `embedding`
     (`serialize_np_array`).
   - **Preprocessing must match the model card and is NOT the face path**: crop → `cv2.resize` to
     224×224 → `cv2.cvtColor(BGR2RGB)` → `/255` → ImageNet mean `[0.485,0.456,0.406]` std
     `[0.229,0.224,0.225]` → transpose HWC→CHW → float32. Getting channel order or normalisation
     wrong degrades embeddings silently with no error, so it is pinned by a test.
   - Clamp crop coordinates to the image bounds and clamp for degenerate boxes (see edge cases).

4. `models/__init__.py`: add
   `case ModelSource.PET_RECOGNITION, ModelType.RECOGNITION, ModelTask.PET_DETECTION: return PetRecognizer`.

**Tests (write first, in `machine-learning/test_main.py`, class `TestPetRecognition`)**

| #   | Test                                                                                                                                                                                                                                       | Expected red                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 1.1 | `test_recognizer_returns_one_embedding_per_pet` — 2 fake pets, mocked session returning `(2,512)`; asserts 2 results, each with `boundingBox`/`score`/`label` preserved and an `embedding` string                                          | `ImportError: cannot import name 'PetRecognizer'` |
| 1.2 | `test_recognizer_returns_empty_for_no_pets` — `predict(img, [])` returns `[]` **without** touching the session                                                                                                                             | as above                                          |
| 1.3 | `test_recognizer_preprocesses_rgb_imagenet_224` — capture the array fed to the session; assert shape `(N,3,224,224)`, dtype float32, and that channel 0 corresponds to **R** of the source BGR image and values match `(x/255 - mean)/std` | as above                                          |
| 1.4 | `test_recognizer_crops_each_bounding_box` — two distinct solid-colour regions; assert the two crops differ and each matches its box's colour                                                                                               | as above                                          |
| 1.5 | `test_recognizer_clamps_out_of_bounds_boxes` — box with negative x1 and x2 beyond width; assert no exception and a valid embedding                                                                                                         | as above                                          |
| 1.6 | `test_recognizer_skips_degenerate_box` — zero-area box (`x1 == x2`); assert it still yields an entry (embedding of a 1px-clamped crop) rather than raising                                                                                 | as above                                          |
| 1.7 | `test_get_model_class_resolves_pet_recognition` — `get_model_class('pet-recognition-base', ModelType.RECOGNITION, ModelTask.PET_DETECTION) is PetRecognizer`                                                                               | `ValueError: Unknown model combination`           |
| 1.8 | `test_pet_detector_still_resolves` — `get_model_class('yolo11s', ModelType.DETECTION, ModelTask.PET_DETECTION) is PetDetector` (regression guard)                                                                                          | passes already — keep as regression               |
| 1.9 | `test_download_uses_open_noodle_org` — mock `snapshot_download`; assert called with `open-noodle/pet-recognition-base`                                                                                                                     | `ImportError`                                     |

**Verify:** `cd machine-learning && uv run pytest -q` (all pass), plus `uv run mypy --strict` and
`uv run ruff check` clean (CI runs both).

**Commit:** `feat(ml): pet recognition embedder (PetRecognizer)`

---

# Slice 2 — Server: `pet_search` table, migration, vector plumbing

**Goal:** a place to store pet embeddings, indexed for cosine kNN.

**Files**

- `server/src/schema/tables/pet-search.table.ts` (new)
- `server/src/schema/index.ts` (tables array **and** `DB` interface — both required)
- `server/src/enum.ts` (`VectorIndex.Pet`)
- `server/src/constants.ts` (`VECTOR_INDEX_TABLES`)
- `server/src/repositories/database.repository.ts` (`probes`)
- `server/src/schema/migrations-gallery/1785000000000-CreatePetSearchTable.ts` (new)
- `server/test/medium/specs/repositories/pet-search.repository.spec.ts` (new)

**Implementation**

- `pet-search.table.ts` is a structural copy of `face-search.table.ts`: `@Table({ name: 'pet_search' })`,
  `@Index({ name: 'pet_index', using: 'hnsw', expression: 'embedding vector_cosine_ops', with: 'ef_construction = 300, m = 16' })`,
  `faceId` via `@ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE', primary: true })`,
  `embedding` `@Column({ type: 'vector', length: 512, synchronize: false })`.
- Migration `up`: `CREATE TABLE "pet_search" (...)` with the FK, then
  `await sql.raw(vectorIndexQuery({ vectorExtension, table: 'pet_search', indexName: 'pet_index' })).execute(db)`
  — same helper the initial migration uses for `face_search`, so vchordrq and pgvector installs both
  work. `down`: drop index then table.
- The migration must read the configured extension the same way `1744910873969-InitialMigration.ts`
  does; do not hardcode `hnsw`.

**Tests (write first)**

| #   | Test                                                                                                   | Expected red                      |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| 2.1 | medium: insert an `asset_face` + a `pet_search` row with `newEmbedding()`, read it back                | table `pet_search` does not exist |
| 2.2 | medium: deleting the `asset_face` row cascades away the `pet_search` row                               | as above                          |
| 2.3 | medium: `pet_index` exists — query `pg_indexes` for `indexname = 'pet_index'` on `pet_search`          | as above                          |
| 2.4 | unit: `VECTOR_INDEX_TABLES[VectorIndex.Pet] === 'pet_search'` and `probes[VectorIndex.Pet]` is defined | `VectorIndex.Pet` undefined       |

**Verify:** medium file green; `cd server && pnpm check` (tsc) clean; existing schema drift specs
(`migration-override-parity.spec.ts`, `trigger-override-parity.spec.ts`) still green — the fork has
had schema-drift regressions before, so run the whole `src/schema` unit suite.

**Commit:** `feat(pet-recognition): pet_search table + vector index`

---

# Slice 3 — Server: config, enums, job registration (no behaviour yet)

**Goal:** the config block, queue and jobs exist and the server still boots. Handlers are real but
gated: with recognition disabled they return `JobStatus.Skipped`.

**Files**

- `server/src/config.ts` (type + defaults + `job` concurrency)
- `server/src/enum.ts` (`QueueName`, `JobName`, `SystemMetadataKey`)
- `server/src/types.ts` (`JobItem` union entries)
- `server/src/dtos/model-config.dto.ts`, `server/src/dtos/system-config.dto.ts`
- `server/src/utils/misc.ts` (`isPetRecognitionEnabled`)
- `server/src/services/pet-recognition.service.ts` (new — handlers with `@OnJob`)
- `server/src/services/index.ts` (register the service)
- `server/src/services/queue.service.ts` (`start()` case)
- `server/src/services/system-config.service.spec.ts` (fixture updates)
- `server/src/services/pet-recognition.service.spec.ts` (new)

**Implementation**

- Config type sibling of `facialRecognition`; defaults per the locked table above.
- `job` concurrency default `[QueueName.PetRecognition]: { concurrency: 1 }` (clustering writes
  contend on the same rows; matches `FacialRecognition`'s conservative posture while staying a
  concurrent queue).
- `JobItem`: `{ name: JobName.PetRecognitionQueueAll; data: INightlyJob }` and
  `{ name: JobName.PetRecognition; data: IDeferrableJob & IEntityJob }` — the deferred flag is used
  in Slice 5, declared now so the type is stable.
- `system-config.dto.ts`: add `PetRecognitionConfigSchema` to `SystemConfigMachineLearningSchema`
  **and** `petRecognition: JobSettingsSchema` to `SystemConfigJobSchema` (the job-settings key is the
  `QueueName` **string value**).
- `queue.service.ts` `start()`: `case QueueName.PetRecognition: return this.jobRepository.queue({ name: JobName.PetRecognitionQueueAll, data: { force } });`
  — the switch has `default: throw`, so a missing case 400s at runtime.

**Tests (write first)**

| #   | Test                                                                                                                                   | Expected red                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 3.1 | `system-config.service.spec.ts` default-config fixtures updated to include `petRecognition` defaults and the new job concurrency entry | fixture mismatch (this test _will_ fail loudly if the defaults are wrong — that is the point) |
| 3.2 | `pet-recognition.service.spec.ts`: `handleQueuePetRecognition` returns `Skipped` when `petRecognition.enabled` is false                | module does not exist                                                                         |
| 3.3 | `handlePetRecognition` returns `Skipped` when disabled, and does not call the search repository                                        | as above                                                                                      |
| 3.4 | unit: `isPetRecognitionEnabled` is false when global ML is off even if the block is on                                                 | function missing                                                                              |
| 3.5 | unit: starting `QueueName.PetRecognition` queues `PetRecognitionQueueAll` (queue.service spec)                                         | `BadRequestException: Invalid job name`                                                       |

**Verify:** `cd server && pnpm test -- --run src/services/pet-recognition.service.spec.ts src/services/system-config.service.spec.ts src/services/queue.service.spec.ts`;
then **boot check** — the whole server unit suite, since a missing `@OnJob` handler surfaces as a
startup error in `job.repository.spec.ts`.

**Commit:** `feat(pet-recognition): config block, queue and job registration`

---

# Slice 4 — Server: ML client + repository read/write

**Goal:** the server can ask for embeddings, store them, and search them. No pipeline change yet.

**Files**

- `server/src/repositories/machine-learning.repository.ts`
- `server/src/repositories/person.repository.ts` (bulk pet write)
- `server/src/repositories/search.repository.ts` (`searchPets`)
- `server/src/repositories/machine-learning.repository.spec.ts`
- `server/test/medium/specs/repositories/search.repository.spec.ts` (extend or new pet spec)

**Implementation**

- `DetectedPet` gains `embedding?: string`. `PetDetectionRequest` gains an optional
  `[ModelType.RECOGNITION]: ModelOptions`.
- `detectPets(imagePath, { modelName, minScore }, recognition?: { modelName })` — when `recognition`
  is provided, include the `RECOGNITION` entry so one `/predict` returns boxes **and** embeddings
  (exactly how `detectFaces` does it). When absent, the request is byte-identical to today's.
- `personRepository.refreshPetFaces(facesToAdd, embeddingsToAdd)` — a CTE bulk insert into
  `asset_face` + `pet_search` modelled on `refreshFaces`, returning the created face ids so the
  caller can queue recognition per face.
- `searchRepository.searchPets({ userIds, embedding, numResults, maxDistance, hasPerson })` — a copy
  of `searchFaces` scoped to `pet_search`, with `set local vchordrq.probes` from `probes[VectorIndex.Pet]`.
  No `minBirthDate` (meaningless for pets).

**Tests (write first)**

| #   | Test                                                                                                                                                                         | Expected red                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 4.1 | ML repo unit: `detectPets` **without** recognition sends only the `detection` entry (regression guard for the disabled path)                                                 | passes today — keep                  |
| 4.2 | ML repo unit: `detectPets` **with** recognition sends both `detection` (with `minScore`) and `recognition` (with the recognition `modelName`) under the `pet-detection` task | assertion fails, only detection sent |
| 4.3 | ML repo unit: the parsed response maps `embedding` through onto each pet                                                                                                     | type/field missing                   |
| 4.4 | medium: `refreshPetFaces` inserts both rows and returns face ids                                                                                                             | method missing                       |
| 4.5 | medium: `searchPets` returns the nearer of two embeddings first and respects `maxDistance` (construct two embeddings with known cosine distances)                            | method missing                       |
| 4.6 | medium: `searchPets` only returns faces owned by the given user                                                                                                              | as above                             |
| 4.7 | medium: `searchPets` with `hasPerson: true` excludes unassigned faces                                                                                                        | as above                             |
| 4.8 | medium: `searchPets` never returns rows from `face_search` (insert a human face + embedding; assert it is not in the results) — proves the isolation decision                | as above                             |

**Verify:** unit + both medium files; `pnpm check`.

**Commit:** `feat(pet-recognition): embed request, pet_search writes and NN search`

---

# Slice 5 — Server: detect→embed→cluster pipeline

**Goal:** the feature works end to end on the server.

**Files**

- `server/src/services/pet-detection.service.ts`
- `server/src/services/pet-recognition.service.ts`
- `server/src/services/pet-detection.service.spec.ts`
- `server/src/services/pet-recognition.service.spec.ts`
- `server/test/medium/specs/services/pet-recognition.service.spec.ts` (new)

**Implementation — `handlePetDetection`**

- When `isPetRecognitionEnabled(config)`: pass the recognition model to `detectPets`, write faces
  **and** embeddings via `refreshPetFaces`, queue `JobName.PetRecognition` per created face, and do
  **not** create species buckets.
- When recognition is disabled: unchanged from today (species buckets, no embeddings).
- `petsDetectedAt` bookkeeping unchanged in both paths.

**Implementation — `handlePetRecognition`** (mirrors `handleRecognizeFaces`, simplified for pets)

1. Load the face + its `pet_search` embedding; `Failed` if the face is gone, `Skipped` if it has no
   embedding (recognition was enabled after detection ran).
2. If the face already has a `personId`, link `face_identity` (type `'pet'`) and return `Skipped` —
   recognition never reassigns an assigned face.
3. `searchPets({ userIds: [ownerId], embedding, maxDistance, numResults: max(minFaces, 1) })`.
4. `personId = matches.find(m => m.personId)?.personId`.
5. `isCore = matches.length >= minFaces`. If `!isCore && !deferred`, requeue once with
   `deferred: true` and return `Skipped`.
6. If no `personId` and `isCore`: create `person { ownerId, type: 'pet', species: <label>, name: '' }`
   (unnamed — the existing unnamed-person affordance names it).
7. Assign the face to the person, `replaceFaceIdentity(personId, faceId, 'owner-person')` so the
   existing shared-space `type: 'pet'` identity path activates, and queue `SharedSpaceFaceMatch` for
   the asset.

**Tests (write first)**

`pet-detection.service.spec.ts`:

| #   | Test                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | recognition **disabled**: still creates the species bucket and does not call `refreshPetFaces` or queue recognition (no-regression guard)                   |
| 5.2 | recognition **enabled**: requests embeddings, writes via `refreshPetFaces`, queues one `PetRecognition` per detected pet, and creates **no** species bucket |
| 5.3 | recognition enabled but ML returns a pet with no embedding: writes the face, logs, does not queue recognition (defensive — old ML service)                  |
| 5.4 | asset with zero detected pets: no writes, no jobs, still stamps `petsDetectedAt`                                                                            |

`pet-recognition.service.spec.ts`:

| #    | Test                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 5.5  | no matches and `isCore`: creates a new pet person with `type: 'pet'` and `species` from the label                     |
| 5.6  | a match that already has a `personId`: assigns to it, creates no person                                               |
| 5.7  | face already assigned: returns `Skipped`, no search performed                                                         |
| 5.8  | face has no embedding row: returns `Skipped`, does not throw                                                          |
| 5.9  | `!isCore && !deferred`: requeues with `deferred: true` and returns `Skipped`                                          |
| 5.10 | `!isCore && deferred`: does **not** requeue again (no infinite loop)                                                  |
| 5.11 | assigning links `face_identity` with type `'pet'` and source `'owner-person'`                                         |
| 5.12 | after assignment, queues `SharedSpaceFaceMatch` for the asset                                                         |
| 5.13 | a match whose distance exceeds `maxDistance` is not returned by the search ⇒ new person created (threshold respected) |

Medium (`pet-recognition.service.spec.ts` under `test/medium/specs/services/`):

| #    | Test                                                                             |
| ---- | -------------------------------------------------------------------------------- |
| 5.14 | two near-identical embeddings for the same owner cluster into **one** pet person |
| 5.15 | two distant embeddings produce **two** pet people                                |
| 5.16 | embeddings from two different owners never cluster together                      |

**Verify:** all three spec files, then the full server unit suite (`pnpm test -- --run`) to catch
collateral breakage in `person.service.spec.ts` / `shared-space.service.spec.ts`.

**Commit:** `feat(pet-recognition): detect, embed and cluster individual pets`

---

# Slice 6 — Reprocess, model switch, nightly

**Goal:** enabling recognition or switching model rebuilds cleanly; nightly picks up new pets.

**Files**

- `server/src/services/pet-recognition.service.ts` (`handleQueuePetRecognition`)
- `server/src/repositories/person.repository.ts` (`deleteAllPetSearch` / truncate)
- `server/src/services/queue.service.ts` (nightly)
- `server/src/config.ts` + `system-config.dto.ts` (`nightlyTasks.clusterNewPets`)
- specs for each

**Implementation**

- `handleQueuePetRecognition({ force, nightly })`:
  - `force`: purge — `personRepository.deleteAllPets()` (existing), `sharedSpaceRepository.deleteAllPets()`,
    and **truncate `pet_search`** — then requeue `PetDetectionQueueAll { force: true }` so assets are
    re-detected and re-embedded with the current model.
  - `nightly`: skip when `SystemMetadataKey.PetRecognitionState.lastRun` is newer than the newest pet
    face, mirroring `handleQueueRecognizeFaces`.
  - otherwise: queue `PetRecognition` for every pet face that has an embedding and no person.
  - always record `lastRun` (and the `modelName` used) in `SystemMetadataKey.PetRecognitionState`.
- Nightly task flag `nightlyTasks.clusterNewPets` (default `true`), pushed in `handleNightlyJobs`
  next to `clusterNewFaces`.

**Tests (write first)**

| #   | Test                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------- |
| 6.1 | `force: true` truncates `pet_search`, deletes pet people and space copies, and requeues detection with `force` |
| 6.2 | `force: false` queues recognition only for embedded, unassigned pet faces                                      |
| 6.3 | `nightly: true` with `lastRun` newer than the newest pet face returns `Skipped` without queueing               |
| 6.4 | `nightly: true` with older `lastRun` queues work                                                               |
| 6.5 | the run records `lastRun` **and** `modelName` in system metadata                                               |
| 6.6 | nightly job list includes `PetRecognitionQueueAll` when `clusterNewPets` is on, and omits it when off          |
| 6.7 | medium: after a force purge, `pet_search` is empty while human `face_search` rows are untouched                |

**Verify:** the specs above + `queue.service.spec.ts` + `system-config.service.spec.ts` (new nightly
flag appears in defaults).

**Commit:** `feat(pet-recognition): reprocess, model switch and nightly clustering`

---

# Slice 7 — Web

**Goal:** admins can configure it; pets read as pets in the asset viewer.

**Files**

- `web/src/routes/admin/system-settings/MachineLearningSettings.svelte`
- `web/src/lib/constants.ts` (`ADMIN_VISIBLE_QUEUES`)
- `web/src/lib/services/queue.service.ts` (`asQueueItem` record + job-type label)
- `web/src/routes/admin/queues/QueuePanel.svelte` (`queueDetails` + force confirm)
- `web/src/routes/admin/system-settings/JobSettings.svelte` (`queueTitles`)
- `web/src/lib/components/asset-viewer/DetailPanelPeople.svelte` (paw badge)
- `i18n/en.json`
- `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts` (new)

**Implementation**

- A `petRecognition` `SettingAccordion` after the `petDetection` one: enable switch, model
  `SettingSelect` (`pet-recognition-small` / `-base` / `-large`), `maxDistance` and `minFaces`
  number fields — following the `petDetection` block verbatim for structure and the
  `facialRecognition` block for the two numeric thresholds.
- The three `Record<QueueName, …>` maps are **exhaustive by type**: omitting the new queue is a
  TypeScript error, so `pnpm check:typescript` is the gate.
- `DetailPanelPeople.svelte`: render the paw badge + species for `person.type === 'pet'`, reusing the
  `mdiPaw` treatment from `person-tile.svelte:68-75`. `PersonResponseDto` already carries `type` and
  `species`, so no API change.
- New i18n keys in `i18n/en.json` only: `machine_learning_pet_recognition`,
  `..._description`, `..._setting`, `..._setting_description`, `..._model`, `..._model_description`,
  `..._max_distance`, `..._max_distance_description`, `..._min_faces`, `..._min_faces_description`,
  `pet_recognition_job_description`, `confirm_reprocess_all_pet_recognition`.

**Tests (write first)**

| #   | Test                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------ |
| 7.1 | `DetailPanelPeople.spec.ts`: a person with `type: 'pet'`, `species: 'dog'` renders the paw badge with the species as its title |
| 7.2 | a person with `type: 'person'` renders **no** paw badge                                                                        |
| 7.3 | existing `person-tile.spec.ts` still green (regression)                                                                        |

**Verify:** `cd web && pnpm test -- --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`,
then `pnpm check:typescript` and `pnpm check:svelte` (the latter is effectively a push-only gate
locally — it has been observed scanning 0 files; do not treat a 0-file run as a pass).

**Commit:** `feat(pet-recognition): admin settings and pet badge in the asset viewer`

---

# Slice 8 — OpenAPI, e2e, full verification

**Goal:** generated clients match the new DTO and the whole repo is green.

**Files**

- `open-api/**`, `packages/sdk/**`, `mobile/openapi/**` (generated)
- `e2e/src/specs/server/api/pet-detection.e2e-spec.ts` (extend) or a new
  `pet-recognition.e2e-spec.ts`

**Implementation**

1. `cd server && pnpm build && pnpm sync:open-api`, then `make open-api` from the repo root
   (regenerates the TypeScript SDK **and** the Dart client; Dart generation needs Java — if Java is
   unavailable, regenerate TypeScript only and say so explicitly in the PR body rather than
   committing a partial regen silently).
2. e2e coverage mirroring `pet-detection.e2e-spec.ts`: `petRecognition` appears in
   `GET /system-config` with the documented defaults; updating it round-trips; out-of-range
   `maxDistance` / `minFaces` are rejected; the `petRecognition` queue is listed by `GET /jobs` and
   accepts start/pause/resume/empty.

**Verify (the full gate, all from repo root unless noted)**

- `cd server && pnpm test -- --run` (unit) and the medium specs touched by slices 2/4/5/6
- `cd web && pnpm test -- --run`
- `make lint-server lint-web` (eslint, zero warnings) — deferred to here on purpose, one pass
- `make format-server format-web` then `git diff --exit-code` (prettier is a **separate** CI gate)
- `make check-web` (svelte-check + tsc); server types via `cd server && pnpm check`
- `npx prettier --check` on any touched markdown under `docs/` (CI Docs Build is strict)

**Commit:** `chore(pet-recognition): regenerate API clients and add e2e coverage`

---

## Out of scope (explicitly not in these slices)

- **Mobile** — deferred by the design; no Dart beyond the generated client.
- **Deep shared-space `withSharedSpaces` projection for pet people** — v1 uses the existing
  pet→space propagation, which Slice 5 activates by writing `face_identity` rows.
- **Phase-1.5 quality levers** (pet-face crops for dogs, cleaned-LCW for cats).
- Changing the pet **detector** (RF-DETR/YOLO) or its `Deeds67` HF org.
