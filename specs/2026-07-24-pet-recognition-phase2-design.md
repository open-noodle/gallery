# Pet Recognition — Phase 2: Productionize + Integrate (Design)

- **Status:** Approved design, pending implementation plan
- **Date:** 2026-07-24
- **Depends on:** Phase 1 spike — [`2026-07-24-pet-recognition-phase1-RESULTS.md`](../plans/2026-07-24-pet-recognition-phase1-RESULTS.md) (verdict: GO)
- **Feature line:** pet detection → pet **recognition** (individual dog/cat identity)

## 1. Context

Phase 1 validated the recipe: **a frozen DINOv2 backbone + a small trained projection head**
(whole-animal crops) gives license-clean individual re-ID — dog EER 0.023 (large) / cat 0.044,
beating fine-tuned SOTA. Three backbone sizes make a natural quality↔cost ladder. Phase 2
**productionizes those models and wires the recognition pipeline into the app**, mirroring the
existing human facial-recognition subsystem but kept **isolated** for pets.

Today `pet-detection.service.ts` creates **one `person` per `(owner, species)`** (a "dog"/"cat"
bucket) and never embeds or clusters. Phase 2 replaces that bucket with **per-individual pets**
clustered by embedding — the same detect→embed→cluster→person flow humans already use.

## 2. Goal, scope & non-goals

**Goal:** Ship user-facing individual pet recognition (server + web) with **3 selectable models**
(small/base/large), turning detected pets into named individuals.

**In scope (v1):** the 3 ONNX models; ML embedder; `pet_search` storage; server clustering
pipeline + jobs + config; admin model picker; the small web fixes; migration/reprocess; shared-space
propagation (existing pattern).

**Non-goals (v1):**

- **Mobile** — deferred to a fast-follow (the fork's mobile people machinery is extensive and has
  zero pet fields today; a separate effort).
- **Deep shared-space parity** — RBAC-projected pet people via a `withSharedSpaces`-style path
  (the human sibling) is a fast-follow; v1 follows the existing pet→space propagation only.
- **Phase-1.5 quality levers** — pet-face-crop route (dogs) and cleaned-LCW (cats); documented in
  the RESULTS, out of v1.

## 3. Key decisions (from brainstorming)

| Decision              | Choice                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Platform surface (v1) | **Server + web**; mobile deferred                                                           |
| Embedding storage     | **Separate `pet_search` table** (`vector(512)`), not shared with faces                      |
| Embedding dim         | **Uniform 512-d** for all 3 backbones (projection maps 384/768/1024→512)                    |
| Identity model        | Species buckets **replaced by named individuals**; `species` = metadata                     |
| Clustering threshold  | **Low `minFaces`** so sparse pets still surface (no "unassigned" bucket)                    |
| Migration             | Enabling recognition / switching model **reprocesses** (clear buckets → re-embed → cluster) |
| Shared spaces         | Follow the **existing pet→space propagation**; deep parity is fast-follow                   |
| Default model         | **base**                                                                                    |

**Why isolate (separate table/query/jobs):** the human-face path is RBAC/spaces-heavy; the pet
embedding space (DINOv2-projection) is incompatible with ArcFace faces; the clustering NN is always
single-type. Isolation avoids cross-species mis-clustering, keeps blast radius small, and matches
how `face_identity` already splits `type IN ('person','pet')`.

## 4. Architecture (mirror facial-recognition, isolated for pets)

### 4.1 Models (prerequisite)

For each of small/base/large: export a **fused ONNX** (DINOv2 backbone → projection → L2-normalize
→ 512-d), opset 17, input `[N,3,224,224]` float32 ImageNet-normalized, output `[N,512]` normalized,
dynamic batch. Upload to `Deeds67/pet-reid-{small,base,large}` with model cards documenting the I/O
contract (RF-DETR discipline). Training uses the Phase-1 projection recipe (extract frozen
embeddings once, train the projection, fuse + export).

### 4.2 ML service (`machine-learning/`)

- New `PetRecognizer` (`models/pet_recognition/recognition.py`): `identity=(RECOGNITION,
PET_DETECTION)`, `depends=[(DETECTION, PET_DETECTION)]` — mirrors `FaceRecognizer`
  (`facial_recognition/recognition.py`). Crops each RF-DETR box (whole-animal, resize 224), runs the
  embedder → serialized 512-d embedding. Register the `(RECOGNITION, PET_DETECTION)` case in
  `models/__init__.py`. Model resolved from `petRecognition.modelName` via `constants.py`.
- `machine-learning.repository.ts` `detectPets` extended to also request `RECOGNITION`, so one
  `/predict` returns boxes **and** embeddings (compare `detectFaces` requesting DETECTION+RECOGNITION).

### 4.3 Server storage (`server/src/schema/`)

- New table `pet_search`: `faceId` PK/FK → `asset_face` (`ON DELETE CASCADE`), `embedding`
  `vector(512)`, vchordrq HNSW cosine index — a structural copy of `face-search.table.ts`.
- **Fork migration** in `migrations-gallery/` (round timestamp), creating the table + index.

### 4.4 Server pipeline (`server/src/services/`)

- `handlePetDetection` (modify, `pet-detection.service.ts`): request detect+embed → for each pet,
  write the `asset_face` row (box) **and** insert the embedding into `pet_search` (a
  `refreshPets`-style bulk insert mirroring `person.repository.refreshFaces`) → queue
  `JobName.PetRecognition` per new pet face. **Remove** the `getByOwnerAndSpecies`/species-bucket
  creation (`:74-91`).
- `handleRecognizePets` (new, in a `pet-recognition.service.ts`): load the pet face's embedding →
  `searchPets` NN (own repo method, copy of `searchFaces` scoped to `pet_search`, `maxDistance`) →
  if a match already has a pet `personId`, reuse it; else create `person{type:'pet', species}` →
  link via `face_identity` (`type='pet'`). Mirrors `handleRecognizeFaces`
  (`person.service.ts:998-1073`), incl. the `minFaces`/core-cluster logic (with a low pet default).
- **Shared spaces:** propagate individual pet people into spaces via the existing pet-propagation
  path (`sharedSpaceRepository` pet handling used by `deleteAllPets`).

### 4.5 Config, jobs, enums

- `petRecognition { enabled, modelName, maxDistance, minFaces }` — `model-config.dto.ts` +
  `system-config.dto.ts` (sibling of `petDetection`/`facialRecognition`), defaults in `config.ts`
  (`modelName: 'pet-reid-base'`, low `minFaces`).
- `QueueName.PetRecognition`; `JobName.PetRecognition` / `PetRecognitionQueueAll` (mirror
  `FacialRecognition*` in `enum.ts`); concurrency in `config.ts`. State bookmark
  (`SystemMetadataKey.PetRecognitionState`).
- Triggers: manual (admin, `queue.service.ts`), nightly, and after pet-face edits — mirroring
  facial recognition. Detection fan-out (`job.service.ts:189-194`) unchanged (it already queues
  `PetDetection`); the new recognition job is queued from within `handlePetDetection`.

### 4.6 Web (`web/`)

- **Admin** (`MachineLearningSettings.svelte`): a `petRecognition` accordion — enable switch, model
  `SettingSelect` {`pet-reid-small`/`base`/`large`}, `maxDistance`/`minFaces` — following the
  `petDetection` accordion (`:341-388`) and `facialRecognition` block (`:205-221`).
- **People page:** already renders pet individuals (paw badge, `person-tile.svelte:68-75`); works
  as-is for named individuals — no new page.
- **Fix the gap:** the asset-viewer people strip (`DetailPanelPeople.svelte`) doesn't badge pets —
  add the paw badge + species so a pet in a photo reads as a pet.
- Auto-clustered pets are "unnamed," named via the existing unnamed-person affordance.

### 4.7 Migration / reprocess / model-switch

- Migration adds `pet_search` + `petRecognition` config defaults.
- Enabling recognition (or **switching the model**) reprocesses: clear species buckets
  (`deleteAllPets`, incl. space copies) → requeue detect→embed→cluster. Model switch **truncates
  `pet_search`** and rebuilds (clean, per the separate-table decision).

## 5. Data flow

```
upload → thumbnails → PetDetection job → ML (detect + embed)
      → asset_face (box) + pet_search (512-d)
      → PetRecognition job → searchPets NN cluster → individual pet person (type=pet, species)
      → People page (paw badge) + shared-space propagation
```

## 6. Testing

- Unit: `pet-recognition.service.spec.ts` (assign-vs-create, threshold, species metadata), mirroring
  the face-recognition specs; extend `pet-detection.service.spec.ts` for the embed+queue change.
- Medium (DB): clustering over real `pet_search` NN.
- E2E: update `pet-detection.e2e-spec.ts` for the recognition flow + config.
- OpenAPI regen after the config DTO change.

## 7. Risks / open items

- **Model-switch reprocess cost** — re-embedding a large library is heavy; gate behind the explicit
  admin action + progress, like a facial-recognition reset.
- **Threshold tuning** — `maxDistance`/`minFaces` for pets need tuning against real libraries; ship
  sensible defaults, expose in admin.
- **Cross-owner / space RBAC** — v1 uses the existing pet→space propagation; the deep
  `withSharedSpaces` projection (human sibling) is explicitly deferred and must not regress spaces.
- **DogFaceNet-style eval at scale** — final model quality should be re-validated on a scalable eval
  before the models are locked (Phase 1 eval was a capped sample).
