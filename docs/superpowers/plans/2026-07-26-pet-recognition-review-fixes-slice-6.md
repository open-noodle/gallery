# Slice 6 — Queue parity, nightly-date fix, unit-test debt (rest of F9, F10, F11, part of F14)

Plan for [the review-fixes spec](../specs/2026-07-26-pet-recognition-review-fixes-implementation-slices.md),
Slice 6. Baseline: Slices 1–5, 7, 8 landed.

## Precedence in `handleQueuePetRecognition`'s non-force path

The whole point of this slice's ordering. Final sequence:

```
enabled check → drift check (Slice 5) → nightly date-skip → pending-work skip → prewarm → fan-out
```

The pending-work skip must sit **after** the drift check and can never gate it: a library with
pending recognition work would otherwise never notice an offline model switch. Equally, the drift
check sits before the nightly date-skip so an idle library can't mask drift either.

## Production changes

1. **Non-force parity** (`pet-recognition.service.ts`) — skip with a debug log when
   `getJobCounts(QueueName.PetRecognition)` reports waiting/delayed/paused work or `active > 1`
   (mirroring `hasPendingRecognitionWork`, `person.service.ts:915-918`), then
   `databaseRepository.prewarm(VectorIndex.Pet)` before the fan-out.
2. **F10** — `handlePetRecognition`'s already-assigned branch queues
   `queueSharedSpaceFaceMatchesForAsset(face.assetId)` before returning `Skipped`; a space may have
   been created after the face was first recognized.
3. **F11** — `getLatestPetDate()` returns `Promise<Date | undefined>` (no `::text` cast), and the
   service compares `new Date(state.lastRun) > latestPetDate`. Previously an ISO-`T` string was
   compared against pg's space-separated text, where `'T' > ' '` made **any** same-day `lastRun`
   look newer and skipped the run. Upstream's `getLatestFaceDate` keeps its identical quirk
   deliberately (rebase hygiene).
   **No SQL-doc regeneration needed**: unlike its sibling, this method carries no `@GenerateSql`
   decorator and has no entry in `src/queries/person.repository.sql`.
4. **`detectPets` missing-key guard** (`machine-learning.repository.ts`) —
   `pets: response[ModelTask.PET_DETECTION] ?? []`. A missing key previously made the caller's
   `pets.filter(...)` throw rather than yield an empty result.

## Test debt closed

`pet-recognition.service.spec.ts`: R6.16 (pending-work skip across waiting/delayed/paused/active>1,
plus a composition test proving drift still fires **under** pending work), R6.17 (prewarm before
fan-out), R6.18 (F10), and eight `handlePetRecognition` pins — hasPerson-fallback arguments, the
`Math.max(minFaces, 1)` first-search size, the inclusive `>= minFaces` boundary,
deferred-then-core, deferred-then-fallback, the final no-person exit, `face.asset === null` →
`Failed`, and shared-space `spaceId` dedupe.

`pet-detection.service.spec.ts`: `refreshPetFaces` rejection → `Failed` with **no** `petsDetectedAt`
stamp; case-insensitive species routing (`'Dog'`).

`misc.spec.ts`: `isRecognizablePetSpecies` truth table.

`machine-learning.repository.spec.ts`: embedding-less pet parses with `embedding: undefined`;
missing `pet-detection` key yields `pets: []` (genuine red against the pre-guard code).

Hygiene: nightly tests key `systemMetadata.get` by argument rather than one shared blob; unit 5.13
renamed to what it actually asserts ("passes maxDistance through to searchPets").

Four pre-existing `getLatestPetDate` mocks returned ISO strings and had to become `Date`s to satisfy
the new signature — expected churn from change 3, not a regression.

Every pure pin followed §2's mutate-red-revert protocol.

## Verify

```
cd server && pnpm exec vitest --config test/vitest.config.mjs --run   # 5221 passed, 9 skipped
cd server && pnpm exec tsc --noEmit -p tsconfig.json
cd server && pnpm lint && pnpm exec prettier --check "src/**/*.ts" "test/**/*.ts"
```

## Commit

`fix(pet-recognition): queue parity with facial recognition and nightly date compare`
