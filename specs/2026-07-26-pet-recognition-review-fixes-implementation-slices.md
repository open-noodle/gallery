# Pet Recognition — Review Fixes: Implementation Slices

- **Status:** Ready to implement (via `/impl-loop`). Reviewed 2026-07-26 by a two-agent
  grounding + adversarial pass; all findings folded back (see §5 for the two design changes that
  came out of it).
- **Date:** 2026-07-26
- **Fixes findings from:** the PR #843 full review (2026-07-26, conversation review of
  `feat/pet-recognition` @ `84764fb3a3b`)
- **Base spec:** [`2026-07-24-pet-recognition-phase2-design.md`](2026-07-24-pet-recognition-phase2-design.md)
  and [`2026-07-25-pet-recognition-phase2-implementation-slices.md`](2026-07-25-pet-recognition-phase2-implementation-slices.md)
- **Branch:** `feat/pet-recognition` (these slices land on the PR branch before merge)

## 1. Context — what the review found

PR #843's core pipeline is correct and well-mirrored from facial recognition, but the review found
four **cross-pipeline interference paths** (the human face pipeline destroys pet data because pet
faces share `sourceType: 'machine-learning'`), a **model-switch lifecycle that exists only in a
comment**, an **incomplete force purge**, and a set of moderate/minor defects plus enumerated test
gaps across unit, medium, and e2e layers.

### Finding → slice traceability

| #   | Finding (severity)                                                                                              | Slice |
| --- | --------------------------------------------------------------------------------------------------------------- | ----- |
| F1  | Human FR force reset unassigns pet faces; person cleanup then deletes all pet persons — named pets lost; the    | 2     |
|     | same reset's untyped shared-space person wipes also delete every space pet copy (major)                         |       |
| F2  | Human FR fan-outs (force + nightly `{personId: null}`) queue failing human jobs over pet faces (major)          | 2     |
| F3  | Human FD force reset `deleteFaces({sourceType: ML})` hard-deletes ALL pet faces + embeddings (major)            | 2     |
| F4  | Per-asset `handleDetectFaces` deletes pet faces as "stale ML faces"; IoU can cross-match a pet face (major)     | 3     |
| F5  | Force purge leaves unassigned pet faces as permanent orphans (`deleteAllPets` scope) (major)                    | 1     |
| F6  | Model switch: `state.modelName` write-only, no config hook, no per-job guard, no name validation (major)        | 5     |
| F7  | `refreshPetFaces` relies on `INSERT … RETURNING` order for positional embedding pairing (moderate)              | 4     |
| F8  | Persons created via queue-all/nightly get `species: null` (moderate)                                            | 4     |
| F9  | Force path doesn't empty the PetRecognition queue; no pending-work skip; no prewarm (minor parity)              | 5, 6  |
| F10 | Already-assigned branch skips shared-space re-match (sibling divergence) (minor)                                | 6     |
| F11 | Nightly `lastRun > latestPetDate` compares ISO-`T` vs pg-text — same-day pets skipped (inherited)               | 6     |
| F12 | ML: resize antialias train/serve skew; degenerate boxes embedded; no EP batch fallback; `zip` not strict;       | 7     |
|     | detector boxes unclamped; `_download` lacks base's `ignore_patterns`; missing combined-endpoint test; misnamed  |       |
|     | degenerate-box test                                                                                             |       |
| F13 | Web: dead toggle without detection; inaccurate Reset dialog; shared queue icon; badge a11y; raw species tooltip | 8     |
| F14 | Test gaps: unit (fallback/deferred/boundaries), medium (real-DB queries, dims, boundary), e2e (no recognition   | 6, 9  |
|     | flow, no force run), vacuous/misleading tests, mock hygiene                                                     |       |

## 2. Method

Every slice is **TDD**: write the failing test first, run it and confirm it fails **for the stated
reason**, write the minimum code to pass, re-run to green, then refactor. A test that passes on its
first run is a red flag — the test is wrong, not the code. **Exception protocol for pin tests**
(tests that deliberately pin existing behaviour — marked "pin" below): they are allowed to pass
first-run, but only after you mutate the pinned behaviour, watch the test go red, and revert — a pin
that can't go red pins nothing. This applies to R1.2, R1.3, R2.8, R3.3, R4.4, R5.14 and every test
marked "pin".

Where behaviour is user-visible (admin flows, resets, model switches), tests are expressed as
**BDD scenarios** (Given/When/Then) and implemented at the highest layer that can observe them
(medium tests with a real DB; component specs for web).

Each slice ends with: its own tests green, the previously-green suite still green, a commit, and a
push. Each slice leaves the server **bootable** and the app working.

## 3. Global invariants (apply to every slice)

- **Server imports use the `src/` alias** — no relative imports (eslint enforces).
- **Fork migrations live in `server/src/schema/migrations-gallery/`** with a round timestamp.
  **Never amend `1785000000000-CreatePetSearchTable.ts`** — it may already be applied on RC/test
  databases; schema changes go in a **new** migration.
- **Never run `make sql` / `mise //:sql` without a running database** — it deletes all query files.
  After repository-method changes, regenerate SQL docs (`mise //:sql` with the dev DB up) so
  `server/src/queries/*.sql` stays in sync (CI checks it).
- **`pnpm test -- --run <path>` drops the path filter** — run unit tests as
  `pnpm exec vitest --config test/vitest.config.mjs --run <path>`; medium tests as
  `pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>`.
- **Medium fixtures:** `test/medium.factory.ts` has no pet helpers — seed pet people, faces, and
  `pet_search` rows **inline** following the existing pattern in
  `test/medium/specs/services/pet-recognition.service.spec.ts` (test 5.14). Do not invent a shared
  helper per slice.
- **eslint green ≠ prettier green** — separate CI gates. One full lint/format pass happens in
  Slice 9; don't run slow full-package lint per-slice.
- **i18n:** only `i18n/en.json` gets new keys. `i18n/` is shared with mobile — grep both before
  renaming/removing a key.
- **This doc and everything under `docs/` must be prettier-formatted** before commit (CI Docs Build
  is strict and reaches `docs/superpowers/`).
- Do not add `Co-Authored-By` or "Generated with" trailers to commits.
- Kysely: never run `this.db` queries inside a `this.db.transaction()` callback — use the `trx`.

## 4. Decisions (locked)

| Decision                       | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human↔pet isolation mechanism  | **Pet-face SQL predicate** (`pet_search` row exists OR assigned to a `type='pet'` person), applied as `excludePetFaces` options on human paths                                                                                                                                                                                                                                                                                                                 |
| NOT a new `SourceType`         | Rejected: needs a pg enum migration + rewrites synced `sourceType` values → breaks older mobile clients' sync stream deserialization                                                                                                                                                                                                                                                                                                                           |
| No embedding ⇒ bucket          | A recognizable pet whose ML response carries no embedding is routed to the **species-bucket** writer, never written as an unassigned embedded-less face — such faces would match neither predicate arm and be unprotected zombies                                                                                                                                                                                                                              |
| Model-name validation          | Whitelist `PET_RECOGNITION_MODEL_NAMES = ['pet-recognition-small', 'pet-recognition-base', 'pet-recognition-large']`, `ConfigValidate` event                                                                                                                                                                                                                                                                                                                   |
| Model-switch purge is SCOPED   | A switch invalidates only **embeddings and recognition-created individuals**. Species buckets and their faces are detector output and **survive every switch**. (The admin Reset button keeps full-purge semantics — buckets rebuilt by the requeue.)                                                                                                                                                                                                          |
| Switch requeue gate            | Requeue `PetDetectionQueueAll {force: true}` iff recognition **and** detection are enabled in the new config; recognition-on/detection-off stamps `state.pendingReprocess` and defers the force run to detection re-enable; recognition-off purges scoped only (re-enable later follows the documented manual-reset flow)                                                                                                                                      |
| Switch idempotency             | Under the lock, **re-read state first**: `state.modelName === newModel` ⇒ no-op. This is what makes multi-worker/duplicate event delivery safe — `withLock` only serializes, it does not dedupe                                                                                                                                                                                                                                                                |
| Hook decorators (load-bearing) | `@OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })` and `@OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })` — copy exactly; ConfigInit fires per-worker at bootstrap, ConfigUpdate reaches non-API workers only via the `server: true` relay (`event.repository.ts:230-236`, precedent `smart-info.service.ts:18,23`). `ConfigInit`'s payload has **no** `oldConfig` (`event.repository.ts:30-38`) |
| Lock id                        | `DatabaseLock.PetRecognitionModelSwitch = 860` (ints; 860 verified free)                                                                                                                                                                                                                                                                                                                                                                                       |
| Mid-flight switch guard        | `handlePetDetection` re-fetches config after the ML call and skips the write if `petRecognition.modelName` changed (mirrors CLIP `smart-info.service.ts:132-136`; the config cache is invalidated on every worker on ConfigUpdate, so the re-fetch observes the new value)                                                                                                                                                                                     |
| Species persistence            | New nullable `species` text column on `pet_search` (migration `1785200000000`), written at embed time, used as person-creation fallback                                                                                                                                                                                                                                                                                                                        |
| Positional-pairing fix         | `refreshPetFaces` callers pre-generate face ids via `CryptoRepository.randomUUID()` (mirrors human `refreshFaces`) — no `RETURNING` reliance                                                                                                                                                                                                                                                                                                                   |
| Cross-species NN               | **Unchanged** — no species filter in `searchPets` (single embedding space is a validated Phase-2 design decision)                                                                                                                                                                                                                                                                                                                                              |
| Nightly date compare           | Fixed **pet-side only**: `getLatestPetDate` returns `Date`, service compares `Date`s. Upstream sibling quirk left alone (rebase hygiene)                                                                                                                                                                                                                                                                                                                       |
| e2e depth                      | e2e stack has no ML service — the full detect→embed→cluster integration lives in **medium** tests; e2e covers config, queues, and force purge                                                                                                                                                                                                                                                                                                                  |

The canonical predicate, defined once in `server/src/utils/database.ts` and reused everywhere:

```ts
/** A pet face: has a pet embedding, or is assigned to a pet person. Pet faces share
 *  sourceType 'machine-learning' with human faces, so this predicate is the ONLY way
 *  human-pipeline queries can avoid destroying pet data (F1–F4). */
export const petFacePredicate = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
  eb.or([
    eb.exists(
      eb
        .selectFrom('pet_search')
        .select(sql`1`.as('one'))
        .whereRef('pet_search.faceId', '=', 'asset_face.id'),
    ),
    eb.exists(
      eb
        .selectFrom('person')
        .select(sql`1`.as('one'))
        .whereRef('person.id', '=', 'asset_face.personId')
        .where('person.type', '=', 'pet'),
    ),
  ]);
```

Coverage note: with the "no embedding ⇒ bucket" decision (Slice 4) and purge completeness
(Slice 1), the pipeline **never produces** a pet face matching neither arm. The one residual gap is
a user manually unassigning a face from a species bucket (leaves it `personId: null` with no
`pet_search` row) — pre-existing, rare, and out of scope; it degrades to today's behaviour, not to
corruption.

## 5. Review fold-back — the two design changes

The 2026-07-26 spec review (grounding + adversarial agents) changed the original draft in two
load-bearing ways, recorded here so the intent survives:

1. **The model-switch purge was full-purge (`deleteAllPets`) in the draft.** That destroys species
   buckets — which are pure detector output and not model-coupled — and in every
   requeue-skipped configuration (detection off, recognition off, ML off) destroyed them with **no
   rebuild path** (non-force detection skips `petsDetectedAt`-stamped assets). The purge is now
   scoped (§4) and the requeue gate + `pendingReprocess` deferral cover every cell of the
   (recognition × detection × switch-path) matrix — see Slice 5's test table.
2. **The draft's hook had no idempotency and unspecified decorators.** ConfigUpdate can fire on
   multiple workers; two firings each carrying the stale `oldConfig` would purge + requeue twice,
   double-detecting every asset (both pet writers are additive). The state-first re-read under the
   lock, the exact decorator options, and emptying **both** pet queues before the purge are now
   locked in §4.

---

# Slice 1 — Purge completeness (F5)

**Goal:** a force purge removes **every** pet face, including unassigned ones that only a
`pet_search` row identifies — no orphan `asset_face` rows survive a reset, ever.

**Files**

- `server/src/repositories/person.repository.ts` (`deleteAllPets`)
- `server/test/medium/specs/services/pet-recognition.service.spec.ts`

**Implementation**

Extend `deleteAllPets()` — inside its existing transaction, **before** the current two deletes, add:

```ts
// Unassigned pet faces (recognition-written, not yet clustered) are invisible to the
// person-scoped delete below — the pet_search join is the only thing that identifies
// them. Delete them first, while their pet_search rows still exist (F5: the old order
// truncated pet_search first via deleteAllPetSearch, orphaning these rows forever).
await trx
  .deleteFrom('asset_face')
  .where('asset_face.id', 'in', (eb) => eb.selectFrom('pet_search').select('pet_search.faceId'))
  .execute();
```

`handleQueuePetRecognition`'s force path keeps calling `deleteAllPetSearch()` afterwards as the
belt-and-braces truncate — the fix is that the face delete now happens **before** the truncate,
via `deleteAllPets`, at both call sites (recognition force and detection force) for free.

**Tests (write first)**

| #    | Layer  | Test                                                                                                                                                                                                                            |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1.1 | medium | an **unassigned** face with a `pet_search` row is deleted by `deleteAllPets()` (fails on current code: face survives). This is also the ordering proof — it passes only when the face delete precedes the person-scoped deletes |
| R1.2 | medium | **pin:** an assigned pet face + person + `pet_search` row: all three gone after `deleteAllPets()` (existing behaviour)                                                                                                          |
| R1.3 | medium | **pin:** a human face with a `face_search` row survives `deleteAllPets()` untouched (isolation control)                                                                                                                         |
| R1.4 | medium | BDD force-reset: Given 1 assigned + 1 unassigned pet face plus seeded human faces, When `handleQueuePetRecognition({force: true})`, Then **only the seeded human faces remain** in `asset_face` and `pet_search` is empty       |

(The draft's R1.5 — unit-level statement-order assertion inside the repository transaction — was
dropped in review: unobservable through the service-spec's opaque repository mock; R1.1 proves the
ordering by outcome.)

**Verify:** `pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/pet-recognition.service.spec.ts`.

**Commit:** `fix(pet-recognition): purge unassigned pet faces in deleteAllPets`

---

# Slice 2 — Human reset & fan-out isolation (F1, F2, F3)

**Goal:** no human facial-recognition or face-detection **queue-level** operation can delete,
unassign, unlink, or enqueue jobs for pet faces — owner-side **and** shared-space pet data survive
any human reset. (Space-person copies of _humans_ keep today's wipe-and-rebuild behaviour.)

**Files**

- `server/src/utils/database.ts` (add `petFacePredicate` from §4)
- `server/src/repositories/person.repository.ts` (`unassignFaces`, `deleteFaces`, `getAllFaces`)
- `server/src/repositories/face-identity.repository.ts` (`unlinkFacesBySourceType`)
- `server/src/repositories/shared-space.repository.ts` (`deleteAllPersonFaces`, `deleteAllPersons`)
- `server/src/services/person.service.ts` (call sites `:742`, `:920-921`, `:928-929`, `:942-944`)
- `server/src/services/person.service.spec.ts`
- `server/test/medium/specs/services/` (new `pet-human-isolation.service.spec.ts`)

**Implementation**

1. Add `excludePetFaces?: boolean` to `UnassignFacesOptions`, `DeleteFacesOptions`, and
   `GetAllFacesOptions` (`person.repository.ts:73,84,107` — `UnassignFacesOptions` is an alias of
   `DeleteFacesOptions`, so one extension may cover both). In each repository method, apply
   `.$if(!!options.excludePetFaces, (qb) => qb.where((eb) => eb.not(petFacePredicate(eb))))`.
2. `unlinkFacesBySourceType` (`face-identity.repository.ts:2355-2361`) deletes
   `face_identity_face` rows via an `asset_face` subquery filtered by `sourceType` — attach the
   same `excludePetFaces` predicate to that subquery.
3. Shared-space wipes: `deleteAllPersonFaces()` and `deleteAllPersons()`
   (`shared-space.repository.ts:3178-3186`) are untyped and currently delete space **pet** copies
   too. Add `{ excludePets?: boolean }` filtering on the space-person `type` column (the pet-scoped
   `deleteAllPets` at `:3188-3195` shows the filter shape).
4. Human call sites pass the exclusions:
   - `handleQueueDetectFaces` force (`person.service.ts:742`):
     `deleteFaces({ sourceType: ML, excludePetFaces: true })`
   - `handleQueueRecognizeFaces` force (`:920-921`):
     `unassignFaces({ sourceType: ML, excludePetFaces: true })` and
     `unlinkFacesBySourceType(ML, { excludePetFaces: true })`
   - `handleQueueRecognizeFaces` force shared-space wipes (`:928-929`):
     `deleteAllPersonFaces({ excludePets: true })`, `deleteAllPersons({ excludePets: true })`
   - `handleQueueRecognizeFaces` fan-out (`:942-944` — **one** `getAllFaces` call serves both the
     force and `{personId: null}` branches via a ternary, so one option covers F2 in both modes):
     `excludePetFaces: true`
5. `handlePersonCleanup` / `getAllWithoutFaces` stay **generic** (no `type` filter): after 1–4, pet
   persons keep their faces through human resets, so cleanup no longer touches them — and a pet
   person with genuinely zero faces **should** still be garbage-collected.
6. Pet-side paths (`getUnassignedPetFaces`, `deleteAllPets`, `refreshPetFaces`) are already
   pet-scoped by construction — no change. Caller sweep (verified in review): the four repo methods
   above have exactly one caller each, all in `person.service.ts`; `face-repair` uses the
   person-scoped `unassignFacesFromPerson` whose eligibility stream inner-joins `face_search`, so
   pet faces can never be selected — safe without changes.

**Tests (write first)**

Note on medium mechanics: `handleQueueRecognizeFaces` **queues** fan-out jobs (captured by the
medium ctx's job mock) — it does not execute them. R2.1/R2.2 assert DB state after the handler
returns plus the captured job list; do **not** replay the captured `FacialRecognition` jobs (that
would need seeded human `face_search` embeddings and tests nothing new here). Seed fixtures inline
per §3.

| #    | Layer  | Test                                                                                                                                                                                                                                                                                           |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2.1 | medium | **BDD (F1):** Given a named pet person with faces + embeddings + `face_identity(type='pet')` and a human library, When `handleQueueRecognizeFaces({force: true})` returns, Then the pet person keeps its name, faces, embeddings, and identity links, and the human people are reset as before |
| R2.2 | medium | **BDD (F3):** same fixture, When `handleQueueDetectFaces({force: true})`, Then pet faces + `pet_search` rows survive; human ML faces are deleted                                                                                                                                               |
| R2.3 | medium | **BDD (F2):** Given one unassigned pet face (with `pet_search` row) and one unassigned human face, When the human recognize fan-out runs (`force: false`), Then exactly one `FacialRecognition` job is captured — for the human face                                                           |
| R2.4 | medium | human recognize fan-out with `force: true` also excludes assigned pet faces                                                                                                                                                                                                                    |
| R2.5 | medium | `handlePersonCleanup` after a human force reset deletes zero-face **human** persons but no pet person                                                                                                                                                                                          |
| R2.6 | medium | a pet person whose faces were all genuinely removed **is** deleted by `handlePersonCleanup` (cleanup stays generic)                                                                                                                                                                            |
| R2.7 | unit   | the five human call sites pass `excludePetFaces: true` / `excludePets: true` (one assertion per site)                                                                                                                                                                                          |
| R2.8 | medium | **pin:** with **no** pet data in the DB, R2.1's human-reset outcome is identical to before this slice (no human-path regression)                                                                                                                                                               |
| R2.9 | medium | **BDD (F1, spaces):** Given a space containing a pet person copy and a human person copy, When `handleQueueRecognizeFaces({force: true})`, Then the space **pet** copy and its face links survive; the human copy is wiped for the rebuild as before                                           |

**Verify:** new medium spec + `person.service.spec.ts` + full server unit suite (collateral check).

**Commit:** `fix(pet-recognition): isolate pet faces from human reset and fan-out paths`

---

# Slice 3 — Per-asset face-detection isolation (F4)

**Goal:** re-running human face detection on an asset never deletes its pet faces and never
IoU-matches a pet face (which would write a human `face_search` embedding onto it).

**Files**

- `server/src/repositories/asset-job.repository.ts` (`getForDetectFacesJob`)
- `server/src/services/person.service.ts` (`handleDetectFaces`)
- `server/src/services/person.service.spec.ts`
- `server/test/medium/specs/services/pet-human-isolation.service.spec.ts` (extend)

**Implementation**

1. In `getForDetectFacesJob` (`asset-job.repository.ts:238`), extend the face selection with a
   computed `isPet` column (the faces come via `withFaces(eb, true, true)`; either add a
   parameterized variant or a local jsonArrayFrom that selects `asset_face.*` plus
   `petFacePredicate(eb).as('isPet')`). Do **not** change `withFaces` for its other callers — the
   review verified they are all read-only selects.
2. In `handleDetectFaces`:
   - `mlFaceIds` only collects faces where `face.sourceType === ML && !face.isPet` — pet faces can
     never land in `faceIdsToRemove`.
   - the IoU `match` candidate scan skips `face.isPet` — a detected human box can never be matched
     to a pet face, so `embeddings.push({ faceId: match.id, … })` can never target one.

**Tests (write first)**

| #    | Layer  | Test                                                                                                                                                                                                           |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3.1 | unit   | asset has 1 pet face (isPet) + ML returns zero faces → `refreshFaces` is called with **empty** `faceIdsToRemove` (fails on current code: pet face removed)                                                     |
| R3.2 | unit   | asset has 1 pet face whose box IoU-overlaps a detected human face > 0.5 → a **new** human face is created; the pet face gets no `face_search` embedding                                                        |
| R3.3 | unit   | **pin:** stale human ML face on the asset is still removed (existing behaviour preserved)                                                                                                                      |
| R3.4 | medium | **BDD:** Given an asset with an assigned pet face and a stale human face, When `handleDetectFaces` re-runs with 0 detections, Then the pet face + `pet_search` row + person survive and the human face is gone |

**Verify:** `person.service.spec.ts` + medium isolation spec + full server unit suite.

**Commit:** `fix(pet-recognition): keep per-asset face detection away from pet faces`

---

# Slice 4 — Species persistence, id-based pairing, no-embedding ⇒ bucket (F7, F8)

**Goal:** every pet person carries its species regardless of which path created it; embedding
pairing is by explicit id, not `RETURNING` order; and the individual pipeline never writes a face
without an embedding — recognizable pets that arrive embedding-less go to the species bucket, where
the predicate protects them.

**Files**

- `server/src/schema/migrations-gallery/1785200000000-AddSpeciesToPetSearch.ts` (new)
- `server/src/schema/tables/pet-search.table.ts` (nullable `species` text column)
- `server/src/repositories/person.repository.ts` (`refreshPetFaces`, `getPetFaceForRecognition`)
- `server/src/services/pet-detection.service.ts` (`handlePetDetection`, `writeDetectedPetsForRecognition`)
- `server/src/services/pet-recognition.service.ts` (person creation fallback)
- specs for all of the above + `server/test/medium/specs/repositories/pet-search.repository.spec.ts`

**Implementation**

1. Migration `1785200000000-AddSpeciesToPetSearch`:
   `ALTER TABLE "pet_search" ADD COLUMN "species" text` (+ mirrored `down`). Nullable — rows
   written before this slice have no species; the recognition fallback tolerates `null`.
2. **No-embedding ⇒ bucket (review §5 change):** in `handlePetDetection`, the recognition-enabled
   routing becomes: recognizable **and embedded** → `writeDetectedPetsForRecognition`; everything
   else (non-recognizable species OR missing embedding — degenerate box, older ML service) →
   `writeDetectedPetsAsSpeciesBuckets`. The individual pipeline thus never writes an unassigned
   face without a `pet_search` row, which is what makes §4's predicate-coverage note true.
3. `refreshPetFaces` signature becomes
   `refreshPetFaces(facesToAdd: (Insertable<AssetFaceTable> & { id: string; assetId: string })[], embeddingsToAdd: { faceId: string; embedding: string; species: string | null }[]): Promise<void>`
   — the caller pre-generates each `id` with `this.cryptoRepository.randomUUID()` (human precedent:
   `person.service.ts:797,824`; `AssetFaceTable.id` is `Generated<string>` so the explicit-id
   typing has no obstacle) and pairs embeddings **by faceId**. With change 2, every face has
   exactly one embedding — the method **throws** on a length/id mismatch (broken-contract guard).
   The transaction inserts faces, then embeddings; no `RETURNING`, no return value, no ordering
   contract. Delete the ordering-workaround comment block and the
   `[...withEmbedding, ...withoutEmbedding]` reorder in `writeDetectedPetsForRecognition`
   (`pet-detection.service.ts:207-241`) — obsolete on both counts. Update the `@GenerateSql`
   decorator params for the new shape. **Plan the churn:** ~9 existing tests call the old
   `(facesToAdd, string[]) → string[]` shape (6 in `pet-detection.service.spec.ts`, 3+ in the
   medium `pet-search.repository.spec.ts`) — rework them all in this slice.
4. `writeDetectedPetsForRecognition` passes `species: pet.label` per embedding and queues
   `PetRecognition` jobs using its own generated ids.
5. `getPetFaceForRecognition` already selects the full `pet_search` row via `withPetSearch`
   (`selectAll('pet_search')`) — the new column flows automatically. Person creation becomes
   `species: label ?? face.petSearch.species ?? null`, which fixes F8 for the queue-all/nightly
   path (job data has no `label` there).

**Tests (write first)**

| #    | Layer  | Test                                                                                                                                                                                                                                                                                                           |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R4.1 | unit   | `writeDetectedPetsForRecognition` calls `refreshPetFaces` with caller-generated ids and `{faceId, embedding, species}` pairs, and queues each `PetRecognition` job with its own pet's id. (Contract test: against old code it fails only on call shape — the behavioural red test is R4.7 at the medium layer) |
| R4.2 | unit   | **red (review §5 change):** ML returns a recognizable dog **without** an embedding → routed to the bucket writer; `refreshPetFaces` not called for it; no recognition job; no unprotected face exists (fails on current code: unassigned embedded-less face written)                                           |
| R4.3 | unit   | `handlePetRecognition` with `label: undefined` and `petSearch.species: 'cat'` creates the person with `species: 'cat'` (F8 fix)                                                                                                                                                                                |
| R4.4 | unit   | **pin:** `handlePetRecognition` with `label: 'dog'` still prefers the job label over the stored species                                                                                                                                                                                                        |
| R4.5 | medium | species round-trip: embed with `species: 'dog'` → `pet_search.species` reads back `'dog'`; pre-slice rows (`species` null) still recognize                                                                                                                                                                     |
| R4.6 | medium | migration applied: column exists, is nullable, `down` drops it (schema-drift check stays green)                                                                                                                                                                                                                |
| R4.7 | medium | **behavioural red for F7:** 2 faces / 2 embeddings — each embedding lands on **its own** face by id against the real DB (fails under any ordering-dependent pairing)                                                                                                                                           |
| R4.8 | unit   | `refreshPetFaces` throws on an embeddings/faces mismatch (length or unknown faceId)                                                                                                                                                                                                                            |

**Verify:** unit + medium pet-search specs; `cd server && pnpm check`; regenerate SQL query docs.

**Commit:** `feat(pet-recognition): persist species, pair embeddings by id, bucket embedding-less pets`

---

# Slice 5 — Model lifecycle: validation, switch detection, scoped reprocess (F6, force half of F9)

**Goal:** switching the pet-recognition model can never silently mix embedding spaces **and** can
never destroy data the model doesn't own — every switch path (live save, offline config edit,
drift) converges to a **scoped** purge + gated reprocess, idempotent under multi-worker event
delivery; an unknown model name is rejected at validation time instead of breaking pet detection at
runtime.

**Files**

- `server/src/constants.ts` (`PET_RECOGNITION_MODEL_NAMES`)
- `server/src/enum.ts` (`DatabaseLock.PetRecognitionModelSwitch = 860`)
- `server/src/types.ts` (`PetRecognitionState` gains `pendingReprocess?: boolean`)
- `server/src/repositories/person.repository.ts` (scoped-purge helpers)
- `server/src/services/pet-recognition.service.ts`
- `server/src/services/pet-detection.service.ts` (mid-flight guard)
- `server/src/services/pet-recognition.service.spec.ts`, `pet-detection.service.spec.ts`
- `server/test/medium/specs/services/pet-recognition.service.spec.ts`

**Implementation**

1. `export const PET_RECOGNITION_MODEL_NAMES = ['pet-recognition-small', 'pet-recognition-base', 'pet-recognition-large'] as const;`
2. `onConfigValidate` (`@OnEvent({ name: 'ConfigValidate' })`): throw
   `Unknown pet recognition model: <name> …` when the new config's
   `machineLearning.petRecognition.modelName` is not whitelisted — mirrors
   `SmartInfoService.onConfigValidate` (`smart-info.service.ts:28-37`). This also closes the
   "typo'd model name breaks pet _detection_ too" hole (one `/predict` carries both tasks).
3. `onConfigInit` + `onConfigUpdate` → shared `handleModelSwitch(newConfig, oldConfig?)`, with the
   **exact decorator options from §4**, body under
   `withLock(DatabaseLock.PetRecognitionModelSwitch)`:

   a. **Idempotency first (inside the lock):** read `SystemMetadataKey.PetRecognitionState`; if
   `state?.modelName === newModel` → return. (Second firing of a duplicate event sees the
   completed switch — state is stamped before the requeue, which is what makes this sound.)

   b. Reference model = `oldConfig?.machineLearning.petRecognition.modelName ?? state?.modelName`.
   If the reference is **absent** (fresh install / ConfigInit before any state): when recognition
   is enabled, **stamp** `{ modelName: newModel }` and return — adopting the current model as the
   reference closes the enable→first-nightly window where an offline switch was undetectable.
   If reference equals `newModel` → return.

   c. **Scoped purge** (see §4 — species buckets and their faces must survive):
   `jobRepository.empty(QueueName.PetRecognition, true)` **and**
   `jobRepository.empty(QueueName.PetDetection, true)` (pending old-model detection jobs would
   re-embed with mixed state and duplicate faces against the requeued force run); then in
   `person.repository`: delete `asset_face` rows having a `pet_search` row (the Slice-1
   statement, extracted as `deleteEmbeddedPetFaces(trx)` so both purges share it); delete
   `person` rows of `type='pet'` that now have **zero remaining faces**, plus their
   `shared_space_person` copies; truncate `pet_search`. Add a code comment: `empty()` does not
   kill _active_ jobs — one in-flight recognition job may still create a person post-purge; it
   ends up face-less and generic person cleanup (R2.6) collects it.

   d. Stamp state `{ lastRun, modelName: newModel, pendingReprocess? }` (before any requeue — see a).

   e. **Requeue gate:** queue `PetDetectionQueueAll { force: true }` iff
   `isPetRecognitionEnabled(new) && isPetDetectionEnabled(new)`. Recognition on but detection off
   → set `pendingReprocess: true` in the stamp and `logger.warn` that a **force** pet-detection
   run is required once detection is re-enabled (non-force skips `petsDetectedAt`-stamped assets,
   so a plain Start rebuilds nothing). Recognition off → no requeue, no flag (buckets survived;
   re-enabling recognition later follows the documented manual-reset flow).

   f. **Deferred reprocess:** the same `onConfigUpdate` handler also checks: pet detection
   transitioned off→on **and** `state.pendingReprocess` → queue
   `PetDetectionQueueAll { force: true }` and clear the flag.

4. `handleQueuePetRecognition` changes:
   - **Force branch (admin Reset — full purge, buckets rebuilt by requeue, deliberately broader
     than the scoped switch purge):** first `jobRepository.empty(QueueName.PetRecognition, true)`
     (F9's force half), then the existing purge + requeue.
   - **Drift check (non-force), placed after the enabled check and BEFORE the nightly date-skip**
     (else an idle library's date-skip masks drift forever): if `state?.modelName` is set and
     differs from the config model, `logger.warn` and run `handleModelSwitch(config)` (the scoped
     routine — **not** the full force purge), then return `Success`. The Slice-6 pending-work skip
     must sit in the non-force path _after_ this drift check and can never gate it.
5. Mid-flight guard in `handlePetDetection`: after the ML call, when `recognitionEnabled`,
   re-fetch `getConfig({ withCache: true })` and if `petRecognition.modelName` differs from the one
   the request used, return `JobStatus.Skipped` (the switch hook has already requeued detection) —
   mirrors the CLIP guard (`smart-info.service.ts:132-136`).

**Tests (write first)**

| #     | Layer  | Test                                                                                                                                                                                                                                                                                                                      |
| ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R5.1  | unit   | `onConfigValidate` throws for `'pet-recognition-huge'`; passes for all three whitelisted names                                                                                                                                                                                                                            |
| R5.2  | unit   | live switch, rec+det on: empties **both** pet queues, scoped purge, stamps state with new model, queues detection force                                                                                                                                                                                                   |
| R5.3  | unit   | model unchanged (other ML field changed): no purge, no requeue                                                                                                                                                                                                                                                            |
| R5.4  | unit   | **idempotency:** second `onConfigUpdate` with the same (stale-oldConfig) payload after state was stamped → no purge, no requeue                                                                                                                                                                                           |
| R5.5  | unit   | switch with rec on / det off: scoped purge, `pendingReprocess: true` stamped, **no** requeue, warning names a **force** run                                                                                                                                                                                               |
| R5.6  | unit   | detection re-enabled while `pendingReprocess` set → detection force queued, flag cleared                                                                                                                                                                                                                                  |
| R5.7  | unit   | switch with recognition **off**: embedded faces + individuals + `pet_search` purged, **bucket persons and bucket faces untouched**, no requeue, no flag                                                                                                                                                                   |
| R5.8  | unit   | `ConfigInit` with no state and recognition enabled → stamps `{ modelName }`, no purge, no requeue; with recognition disabled → full no-op                                                                                                                                                                                 |
| R5.9  | unit   | `ConfigInit` with `state.modelName: 'pet-recognition-base'` and config `large` → scoped purge + gated requeue (offline drift)                                                                                                                                                                                             |
| R5.10 | unit   | drift check in non-force QueueAll runs **before** the nightly date-skip: nightly + no-new-pets + drifted state → switch routine runs (date-skip never masks drift)                                                                                                                                                        |
| R5.11 | unit   | force branch (admin Reset) empties the PetRecognition queue before purging, and keeps **full** purge semantics (buckets deleted — distinct from the scoped switch)                                                                                                                                                        |
| R5.12 | unit   | `handlePetDetection` mid-flight guard: config model changes between ML call and write → `Skipped`, no `refreshPetFaces`, no bucket write                                                                                                                                                                                  |
| R5.13 | medium | **BDD (F6):** Given clustered individuals **and** a bird species bucket built under `base`, When the admin saves config with `large` (rec+det on), Then `pet_search` is empty, individuals are gone, **the bird bucket and its faces survive**, state records `large`, and `PetDetectionQueueAll {force: true}` is queued |
| R5.14 | medium | **pin:** after a normal queue-all run, `state.modelName` equals the config model (existing behaviour, now load-bearing)                                                                                                                                                                                                   |

**BDD scenario (verified by R5.13 + web slice R8.4):**
Given an admin on the ML settings page with recognition enabled, When they change the model and
save, Then they are warned the whole library reprocesses, and on confirm the server purges scoped
and requeues — there is no path where two models' embeddings coexist in `pet_search`, and no path
where a switch deletes species buckets.

**Verify:** both unit specs + medium spec + full server unit suite.

**Commit:** `feat(pet-recognition): model whitelist, idempotent switch detection and scoped reprocess`

---

# Slice 6 — Queue parity, nightly-date fix, unit-test debt (rest of F9, F10, F11, part of F14)

**Goal:** the recognition queue behaves like its facial sibling on pending-work/prewarm, the
nightly skip check actually compares instants, and every unit-level gap the audit enumerated is
closed.

**Files**

- `server/src/services/pet-recognition.service.ts`
- `server/src/repositories/person.repository.ts` (`getLatestPetDate`)
- `server/src/repositories/machine-learning.repository.ts` (`detectPets` missing-key guard)
- `server/src/services/pet-recognition.service.spec.ts`, `pet-detection.service.spec.ts`
- `server/src/utils/misc.spec.ts`
- `server/src/repositories/machine-learning.repository.spec.ts`

**Implementation**

1. **Non-force parity** (`handleQueuePetRecognition`, non-force path, **after** the Slice-5 drift
   check — precedence is: enabled check → drift check → nightly date-skip → pending-work skip →
   prewarm → fan-out): skip with a debug log when the queue already has pending recognition work
   (`getJobCounts` — mirror `hasPendingRecognitionWork`, `person.service.ts:915-918`); then
   `await this.databaseRepository.prewarm(VectorIndex.Pet)` before the fan-out (mirror `:939`).
   (The force-branch queue-empty landed in Slice 5.)
2. **F10:** in `handlePetRecognition`'s already-assigned branch (`pet-recognition.service.ts:82-86`),
   queue `queueSharedSpaceFaceMatchesForAsset(face.assetId)` before returning `Skipped`, with the
   same "space may have been created after recognition" comment as the sibling
   (`person.service.ts:1058-1061`).
3. **F11:** `getLatestPetDate(): Promise<Date | undefined>` — drop the `::text` cast, return the
   `max` directly (`petsDetectedAt` is a `Timestamp`, the pg driver returns `Date`); the service
   compares `new Date(state.lastRun) > latestPetDate`. (Upstream's `getLatestFaceDate` keeps its
   quirk — do not touch it.)
4. **`detectPets` missing-key guard (needs a production change, unlike most of the debt list):**
   `pets: response[ModelTask.PET_DETECTION] ?? []` — today a missing key makes `pets.filter` throw
   in the caller (caught → `Failed`), not the "safe empty result" a naive pin would assert.
5. **Unit-test debt** (each is a named audit gap; apart from item 4, these need no production
   change):
   - `handlePetRecognition`: hasPerson-fallback asserted (called with `hasPerson: true`,
     `numResults: 1`, and its `personId` used); deferred-then-core creates; deferred-then-fallback
     assigns; exact `matches.length === minFaces` boundary is core; first search returns `[]` →
     deferred → `Skipped` via the final no-person exit; `face.asset === null` → `Failed`;
     first-search `numResults` asserted as `Math.max(minFaces, 1)`; shared-space queue dedupes
     duplicate `spaceId` rows (exactly one job).
   - `handlePetDetection`: `refreshPetFaces` rejection → `Failed` and `petsDetectedAt` **not**
     stamped; species routing accepts `'Dog'` (case-insensitivity through the service).
   - `misc.spec.ts`: `isRecognizablePetSpecies` — `'dog'`/`'cat'`/`'Dog'`/`'CAT'` true,
     `'bird'`/`''` false.
   - `machine-learning.repository.spec.ts`: recognition requested but response pets carry no
     `embedding` (older ML) → parsed with `embedding: undefined`; response missing the
     `pet-detection` key → `pets: []` (red against current code, per item 4).
   - Hygiene: nightly tests key `mocks.systemMetadata.get` by argument
     (`mockImplementation((key) => …)`) instead of one blob; rename unit 5.13 to what it asserts
     ("passes maxDistance through to searchPets").

**Tests:** the debt list above plus three parity tests — R6.16: non-force with pending counts
skips (and a drifted state still switches — composes with R5.10); R6.17: prewarm called with
`VectorIndex.Pet` before fan-out; R6.18: already-assigned face → space match queued for its asset
(red against current code — F10). Every debt bullet is written first and must fail; pure-pin
bullets follow §2's mutate-red-revert protocol.

**Verify:** all touched unit specs + full server unit suite.

**Commit:** `fix(pet-recognition): queue parity with facial recognition and nightly date compare`

---

# Slice 7 — ML service fixes (F12)

**Goal:** the serving path matches the validated training path, degenerate boxes never produce
garbage embeddings, constrained execution providers get the sibling's batch fallback, and the
combined-endpoint pairing contract is pinned by a test that would catch a reversed `zip`.

**Files**

- `machine-learning/immich_ml/models/pet_recognition/recognition.py`
- `machine-learning/immich_ml/models/pet_detection/detection.py`
- `machine-learning/immich_ml/config.py`
- `machine-learning/test_main.py`

**Implementation**

1. **Resize skew:** crop-to-224 resize uses `cv2.INTER_AREA` when downscaling (crop larger than
   224×224 by area) and `cv2.INTER_LINEAR` when upscaling — closest match to the antialiased PIL
   bilinear used in training/eval
   (`machine-learning/pet-recognition-training/src/petid/dataset.py:16`).
2. **Degenerate boxes:** after clamping, if either side of the crop is `< 2` px, return the pet
   **without** an `embedding` key. Server-side (post-Slice-4) such pets route to the species
   bucket — recorded, protected, recognition skipped. Rename `test_recognizer_skips_degenerate_box`
   (`test_main.py:1343-1361`, currently asserts the opposite of its name) to match the new contract
   and add the real skip assertion.
3. **EP batch fallback:** mirror `FaceRecognizer`'s batch handling — the
   `_batch_size_default` property (`facial_recognition/recognition.py:90-96`: MIGraphX/OpenVINO →
   1), its `settings.max_batch_size` consumption (`:32-33`), and the `_predict_batch` chunking loop
   (`:56-64`). Add a `pet_recognition` slot to the `MaxBatchSize` settings model
   (`config.py:38-40`; env prefix + `__` nesting make the var
   `MACHINE_LEARNING_MAX_BATCH_SIZE__PET_RECOGNITION`).
4. **Strictness:** `zip(pets, embeddings, strict=True)` (`recognition.py:96-105` currently
   non-strict) — a row-count mismatch from a broken model raises instead of silently dropping pets.
5. **Detector clamp:** `pet_detection/detection.py` clamps output boxes to
   `[0, width] × [0, height]` after scale+round — the raw boxes go over the wire into `asset_face`.
6. **Download hygiene:** mirror the **base class**'s `ignore_patterns`
   (`immich_ml/models/base.py:79`, `ignored_patterns.get(self.model_format, [])`) in **both** pet
   `_download` overrides — the pet detector's (`pet_detection/detection.py:54-61`) lacks it too;
   neither pet override currently passes any patterns. Untested (cosmetic — the HF repos contain
   only the ONNX + docs today); no dedicated test required.

**Tests (write first)**

| #    | Test                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R7.1 | downscale uses `INTER_AREA`, upscale uses `INTER_LINEAR` (monkeypatch `cv2.resize`, assert the interpolation arg per crop size)                                                                                                                                                       |
| R7.2 | a 1-px (post-clamp) box yields a pet dict with **no** `embedding` key; a valid sibling box in the same image still gets one                                                                                                                                                           |
| R7.3 | fully-out-of-bounds box → no embedding key, no crash                                                                                                                                                                                                                                  |
| R7.4 | with `MAX_BATCH_SIZE__PET_RECOGNITION=1` (settings-driven, exercising the new config slot), three pets → three `session.run` calls with `N==1` inputs; embeddings land on the right pets                                                                                              |
| R7.5 | session returning a wrong-count embedding array raises (strict zip), not a silent truncation                                                                                                                                                                                          |
| R7.6 | endpoint-level combined DETECTION+RECOGNITION request: recognition output overwrites the `pet-detection` response key; **deterministic per-crop fake embeddings** (e.g. embedding = f(mean pixel of the crop)) prove crop↔embedding pairing survives — a reversed zip fails this test |
| R7.7 | detector output boxes are within `[0,w]×[0,h]` for detections that overflow the image edge                                                                                                                                                                                            |

**Verify:** `cd machine-learning && uv run pytest test_main.py -k "pet"` then the full
`uv run pytest`.

**Commit:** `fix(ml): pet recognition serving parity, degenerate-box skip and EP batch fallback`

---

# Slice 8 — Web (F13)

**Goal:** the admin can't wander into silently-broken states (recognition without detection, model
switch without understanding the cost), the Reset dialog tells the truth, and the pet badge is
accessible and translated.

**Files**

- `web/src/routes/admin/system-settings/MachineLearningSettings.svelte` (+ new
  `MachineLearningSettings.spec.ts`)
- `web/src/routes/admin/queues/QueuePanel.svelte`
- `web/src/lib/services/queue.service.ts` (icon)
- `web/src/lib/components/asset-viewer/DetailPanelPeople.svelte` (+ spec)
- `web/src/lib/components/people/person-tile.svelte` (shared species label)
- `web/src/lib/utils/` (new `pet-species.ts` — species → i18n label map)
- `i18n/en.json`

**Implementation**

1. **Detection dependency hint:** inside the petRecognition accordion, when
   `config.machineLearning.petDetection.enabled === false`, render a warning line
   (`$t('admin.pet_recognition_requires_detection')`) under the enable switch. Soft dependency only
   — the server deliberately allows recognition of already-detected faces with detection off.
2. **Model-change confirm (pairs with Slice 5):** there is **no per-accordion save** — the page
   saves wholesale via one shared button row (`SystemConfigButtonRow`, aliased import, used at
   `MachineLearningSettings.svelte:452` with `keys={['machineLearning']}`). Hook its
   `onBeforeSave?: () => Promise<boolean>` prop (`SystemConfigButtonRow.svelte:13`, consumed at
   `:36-41` — save proceeds only when it resolves true; precedent `AuthSettings.svelte:31,308`):
   when `configToEdit.machineLearning.petRecognition.modelName !== config.machineLearning.petRecognition.modelName`
   (both already available, see `:418-419`), show `modalManager.showDialog({ prompt: $t('admin.pet_recognition_model_change_warning') })`
   ("Changing the model deletes all pet people and embeddings and reprocesses your entire
   library.") and return its result. Note: the model `<select>` is `disabled` while recognition is
   off (`:417`), so this confirm covers the recognition-on switch paths; recognition-off switches
   arrive only via API/config file and are handled server-side (Slice 5 R5.7).
3. **Reset dialog truth (QueuePanel):** the petRecognition force-reset confirm already exists with
   key `admin.confirm_reprocess_all_pet_recognition` (`QueuePanel.svelte:133-140`,
   `i18n/en.json:118`) — **update that key's text** (grep mobile first per §3; it is web-only
   today) to state the purge always happens and reprocessing runs **only while pet detection is
   enabled**. Do not add a second key.
4. **Icon:** petRecognition queue card gets `mdiPawOutline` (in the installed @mdi/js 7.4.47;
   detection keeps `mdiPaw`) — the pair mirrors the visually-distinct face pair.
5. **Badge a11y + i18n:** the paw badge in `DetailPanelPeople` (`:186-193`) and `person-tile`
   (`:73`), same markup, gets `role="img"` + `aria-label` and a translated species tooltip via
   `pet-species.ts`:
   `{ dog: 'species_dog', cat: 'species_cat', bird: 'species_bird', horse: 'species_horse', sheep: 'species_sheep', cow: 'species_cow', elephant: 'species_elephant', bear: 'species_bear', zebra: 'species_zebra', giraffe: 'species_giraffe' }`
   with raw-value fallback for unknown species. All keys in `en.json` only.

**Tests (write first)**

| #    | Test                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R8.1 | `DetailPanelPeople.spec.ts`: badge renders on the **space-viewer** data path (`asset.people` source with `spaceId` set) — closes the audited gap                             |
| R8.2 | badge has `aria-label` and the translated tooltip for `species: 'dog'`; raw fallback for `species: 'axolotl'`                                                                |
| R8.3 | `MachineLearningSettings.spec.ts`: detection-off + recognition accordion open → hint visible; detection-on → hidden                                                          |
| R8.4 | `MachineLearningSettings.spec.ts`: changed model + save → `onBeforeSave` opens the confirm dialog; cancel blocks the save; confirm proceeds (mock the save + `modalManager`) |
| R8.5 | `pet-species.ts` unit: known species map to keys, unknown returns the raw value                                                                                              |
| R8.6 | QueuePanel: the petRecognition reset dialog renders the updated `admin.confirm_reprocess_all_pet_recognition` copy (pin on the new text)                                     |

**Verify:** `cd web && pnpm exec vitest --run` for the touched specs, then the web gate
(`check:typescript`, `check:svelte`, `pnpm lint`) in Slice 9.

**Commit:** `feat(pet-recognition): admin guardrails, badge a11y and species translations`

---

# Slice 9 — Integration coverage, e2e, full verification (rest of F14)

**Goal:** the load-bearing SQL that has only ever run against mocks runs against a real database;
the flagship reset flow has e2e coverage; the vacuous tests are fixed; everything is green.

**Files**

- `server/test/medium/specs/repositories/pet-search.repository.spec.ts`
- `server/test/medium/specs/services/pet-recognition.service.spec.ts`
- `e2e/src/specs/server/api/pet-detection.e2e-spec.ts`, `e2e/src/utils.ts`

**Implementation & tests (write first)**

Medium — repository layer:

| #    | Test                                                                                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R9.1 | `getUnassignedPetFaces` against real DB: returns embedded+unassigned faces; excludes assigned, soft-deleted, invisible, and embedding-less faces (all four predicates)                                                                                                                                        |
| R9.2 | `getLatestPetDate` returns a `Date`; **same-day regression**: `lastRun` earlier the same day than `petsDetectedAt` → nightly queue-all **runs** (fails on pre-Slice-6 string compare)                                                                                                                         |
| R9.3 | `searchPets` inclusive boundary: read a row's exact distance with a loose search, re-query with `maxDistance` == that value → row still returned (pins `<=`)                                                                                                                                                  |
| R9.4 | wrong-dimension embedding: `refreshPetFaces` with a 3-d vector **rejects, and no `asset_face` row exists afterwards** (single-transaction rollback). The job-level half — rejection → `Failed`, no `petsDetectedAt` stamp — is Slice 6's unit test; this test pins only what the repository layer can observe |
| R9.5 | `getPetFaceForRecognition` excludes soft-deleted faces                                                                                                                                                                                                                                                        |
| R9.6 | scope the 6.7 whole-DB `face_search` count assertions by faceId (hygiene fix from the audit)                                                                                                                                                                                                                  |

Medium — service layer:

| #    | Test                                                                                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R9.7 | `minFaces: 2` end-to-end using `enablePetRecognition`'s overrides (un-deads the parameter): face A defers; face B becomes core and creates the person; face A's deferred run joins via the hasPerson fallback — one person, both faces assigned |
| R9.8 | full-pipeline: `handlePetDetection` (ML repo mocked with canned boxes+embeddings, real DB) → captured `PetRecognition` jobs replayed through the real handler → person exists with `type: 'pet'`, `species`, `face_identity(type='pet')`        |

E2E (`pet-detection.e2e-spec.ts` — the stack has no ML service; scope accordingly):

| #     | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R9.9  | force reset flow: seed a pet person + faces + `pet_search` rows via a new `utils.createPetWithEmbedding` (raw `pg` client like `utils.createPet` at `e2e/src/utils.ts:558`; inserting a 512-d vector literal is **uncharted** in e2e — no existing util writes `face_search`/`pet_search`; a `'[0.1, …]'::vector` cast on the existing client is the expected shape), pause the petDetection queue (`utils.queueCommand` / `QueueCommand.Pause`), `PUT /jobs/petRecognition {command: start, force: true}` → pet people gone from `GET /people`, and the petDetection queue's **waiting+paused** counts > 0 (a paused queue holds the requeued job under `paused`, not `waiting`) |
| R9.10 | starting the petRecognition queue with recognition disabled is a no-op (people survive)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| R9.11 | fix the vacuous `'should include pet in asset people list'` (`pet-detection.e2e-spec.ts:650-653`): assert `asset.people` actually contains an entry with `type: 'pet'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Full verification gate (run yourself — do not trust per-slice subagent greens):

- `cd server && pnpm exec vitest --config test/vitest.config.mjs --run` (full unit)
- `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run` (full medium, DB up)
- `cd machine-learning && uv run pytest`
- web gate from `web/`: `pnpm check:typescript && pnpm check:svelte && pnpm lint`
  (treat a `check:svelte` "0 files" result as an anomaly — CI is the authority)
- `make lint-server format-server` + prettier over `docs/`
- e2e API suite: `cd e2e && pnpm test -- pet-detection`
- OpenAPI: no DTO shape changed in these slices (`species` is not API-exposed; validation is
  server-side) — confirm with `cd server && pnpm build && mise run sync-open-api` producing **no
  diff** (there is no `pnpm sync:open-api` script — the task lives in `server/mise.toml`); if a
  diff appears, a slice leaked into the API surface and needs `make open-api` + committed clients.

**Commit:** `test(pet-recognition): real-DB coverage for recognition SQL, reset e2e, verification`

---

## Out of scope (explicitly not in these slices)

- **Upstream sibling quirks:** `getLatestFaceDate`'s identical same-day skip and `searchFaces`'
  missing `asset_face.deletedAt` filter stay untouched (rebase hygiene; candidate upstream PRs).
- **ML service in the e2e stack** — a canned-prediction ML stub would let e2e cover the true
  upload→recognize flow; medium R9.8 covers the integration seam instead. Revisit if the seam
  regresses.
- **Species-filtered NN search** — deliberate non-goal; the single 512-d space is a validated
  Phase-2 design decision.
- **A dedicated pet `SourceType`** — rejected in §4; revisit only with a mobile sync-compat plan.
- **Bucket-unassign residue** — a face a user manually unassigns from a species bucket matches
  neither predicate arm (no `pet_search` row, no pet person). Pre-existing, rare, degrades to
  today's behaviour; documented in §4, not fixed here.
- **Mobile surfaces** — unchanged from the Phase-2 non-goal.
