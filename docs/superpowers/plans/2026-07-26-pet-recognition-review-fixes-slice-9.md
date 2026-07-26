# Slice 9 — Integration coverage, e2e, full verification

Plan for [the review-fixes spec](../specs/2026-07-26-pet-recognition-review-fixes-implementation-slices.md),
Slice 9. Baseline: Slices 1–8 landed.

**Goal:** the load-bearing SQL that has only ever run against mocks runs against a real database; the
flagship reset flow has e2e coverage; the vacuous tests are fixed; everything is green.

## Medium — repository layer (`test/medium/specs/repositories/pet-search.repository.spec.ts`)

| #    | Test                                                                                                               | Notes                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| R9.1 | `getUnassignedPetFaces` returns embedded+unassigned, excludes assigned / soft-deleted / invisible / embedding-less | all four predicates in one test, each asserted separately                  |
| R9.2 | `getLatestPetDate` returns a `Date`; same-day `lastRun` earlier than `petsDetectedAt` → nightly **runs**           | depends on Slice 6's F11 fix; fails against the pre-Slice-6 string compare |
| R9.3 | `searchPets` inclusive boundary: read a row's exact distance loosely, re-query with `maxDistance` == it            | pins `<=` rather than `<`                                                  |
| R9.4 | wrong-dimension embedding rejects **and** leaves no `asset_face` row (single-transaction rollback)                 | the job-level half is Slice 6's unit test                                  |
| R9.5 | `getPetFaceForRecognition` excludes soft-deleted faces                                                             | asserts defined before, undefined after                                    |
| R9.6 | scope 6.7's whole-DB `face_search` count by faceId                                                                 | **pulled forward into Slice 1** — Slice 1's own tests broke on it first    |

## Medium — service layer (`test/medium/specs/services/pet-recognition.service.spec.ts`)

| #    | Test                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R9.7 | `minFaces: 2` end-to-end — face A defers, face B becomes core and creates the person, A's deferred run rejoins via the hasPerson fallback. Un-deads `enablePetRecognition`'s `minFaces` override, which every other test leaves at the shipped default of 1                                |
| R9.8 | full pipeline: `handlePetDetection` (ML repo mocked, real DB) → replay the captured `PetRecognition` jobs through the real handler → person with `type: 'pet'`, `species`, and a `type: 'pet'` `face_identity`. Needs a second medium service (`setupDetection`) sharing the same database |

## E2E (`e2e/src/specs/server/api/pet-detection.e2e-spec.ts`, `e2e/src/utils.ts`)

The e2e stack has **no ML service**, so these cover config, queues and the force purge only — the
detect→embed→cluster seam is R9.8's job.

| #     | Test                                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R9.9  | force reset: seed via new `utils.createPetWithEmbedding`, pause the petDetection queue, `PUT /jobs/petRecognition {start, force}` → pet people gone, petDetection **waiting + paused** > 0 |
| R9.10 | starting petRecognition with recognition disabled is a no-op even under force                                                                                                              |
| R9.11 | the vacuous `'should include pet in asset people list'` now asserts a real `type: 'pet'` entry                                                                                             |

`createPetWithEmbedding` composes the existing `createPet` + `createFace` and adds the `pet_search`
row. The raw `pg` client has no notion of the `vector` type (unlike the Kysely inserts used in
medium tests, where the column's declared type coerces a string), so the 512-d literal needs an
explicit `$2::vector` cast **in the query text**.

## Full verification gate (run in the main session — do not trust per-slice subagent greens)

- `cd server && pnpm exec vitest --config test/vitest.config.mjs --run` (full unit)
- `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run` (full medium)
- `cd machine-learning && uv run pytest`
- web gate from `web/`: `pnpm check:typescript && pnpm check:svelte && pnpm lint`
- `make lint-server format-server` + prettier over `docs/`
- e2e API suite
- OpenAPI: `cd server && pnpm build && mise run sync-open-api` must produce **no diff**

### Gate gotchas found while running it

- **`check:svelte` scans 0 files locally.** It needs `--workspace "$(pwd)"`, and CI's `--no-tsconfig`
  flag zeroes it out even then. CI is the authority; the local substitute is
  `pnpm exec svelte-check --workspace "$(pwd)" --output human` filtered to the touched files. This
  gate caught a real `$t()` typing bug that `check:typescript` cannot see (tsc does not check
  `.svelte` files).
- **`mise run sql` executes `dist/bin/sync-sql.js`** — without `cd server && pnpm build` first it
  silently regenerates the _previous_ build's queries.
- **Running server tests while another agent edits `server/`** produces meaningless results; R9.7
  failed and then passed under the same command for exactly this reason. Re-verify after every
  concurrent slice lands.

## Commit

`test(pet-recognition): real-DB coverage for recognition SQL, reset e2e, verification`
