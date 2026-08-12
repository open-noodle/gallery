# Face Cleanup — persist scan-flagged faces (fast review page) — design

**Status:** approved (brainstorm 2026-06-29); ready for slice-by-slice implementation via `/impl-loop`.
**Branch / PR:** `feat/face-cleanup-console` (#664) — same branch as the console + add-faces work.
**Prereq:** the Face Cleanup Console scan + review screen are already on this branch
([`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md)). Key existing
primitives this design reuses: `FaceRepairService.runScan` / `buildRepairPlan` (produces `plan.toRepair` +
`plan.reviewOnlyFaces`, each a `FlaggedFace` with `assetFaceId` / `currentPersonId` / `suspectedOwnerId`),
`FaceRepairScanRepository` (scan lifecycle: `createScan` / `completeScan` / `getLatestScan` /
`pruneSupersededScans`), `FaceRepairDeclineRepository.getDeclineMaps`, and `applyDeclineFilters`
(`src/utils/face-repair.ts`).

## Motivation

The review page (`/admin/face-cleanup/[personId]`) calls `getFaceRepairPersonFaces`, which today **re-derives**
the person's flagged faces on every open by running `buildRepairPlan({ personIds: [personId] })` —
`findReattributionCandidates` does **one nearest-neighbour (KNN) vector search per eligible face, sequentially**
(`face-repair.service.ts:261`). Measured on a clone: **~500ms per KNN over 55k embeddings × 64 faces ≈ 32s** to
open one person. The cost is `clusterSize × perKnn`, and `perKnn` grows with library size — so a moderately large
cluster (hundreds of faces) is minutes, and large libraries are worse. (The ~500ms/KNN is _expected_ at this
scale: the vchordrq face index is a single-list flat index below 128k vectors by design — `targetListCount`
returns `1` — so this is not an index misconfiguration.)

The scan **already computes** every flagged face (`assetFaceId` + `suspectedOwnerId`) for every cluster when it
runs `buildRepairPlan` over the whole library; it currently discards that per-face detail and keeps only
per-person aggregates. **This design persists the per-face flagged list during the scan and has the review page
read it** — turning `getFaceRepairPersonFaces` into a bounded indexed lookup, **independent of cluster/library
size and with no KNN.**

## Requirements (locked in brainstorm)

1. **Review reads, never recomputes.** `getFaceRepairPersonFaces` returns the scan's stored flagged faces for the
   person; the `buildRepairPlan` recompute is removed from this read path. No KNN / vector search on review.
2. **Same contract.** The endpoint, `FaceRepairPersonFacesDto` (`{ personId, flaggedFaces: [{ assetFaceId,
suspectedOwnerId }] }`), and the web are **unchanged** — this is a server-internal change. No OpenAPI/SDK/web
   work.
3. **Faithful to today's result.** The stored set is `plan.toRepair` + `plan.reviewOnlyFaces` for the person
   (exactly what `getPersonFlaggedFaces` returns today), and the read path reproduces today's filtering: only
   faces **still on the person and still eligible** (visible, ML-sourced, not deleted, asset not deleted), and
   faces **declined since the scan** are filtered with the existing `applyDeclineFilters` semantics.
4. **Snapshot model (documented).** Review is a point-in-time snapshot read; **apply stays a live recompute**
   (`buildRepairPlan` with the scan's stored params, protected by `executeRepair`'s still-on-source re-check) —
   unchanged. This matches the existing "scan = snapshot" model the console is built on.
5. **Not released → no back-compat.** The feature is unreleased, so there are no pre-existing scans to migrate;
   every completed scan is assumed to have populated flagged-face rows. No fallback-recompute path.
6. **#2 deferred.** Parallelizing the scan's per-face KNN (and any deeper scan-scalability rethink) is **out of
   scope** here; revisit after this lands.

## Architecture (server-only)

### 1. New fork table `face_repair_scan_flagged_face`

| column             | type       | notes                                                  |
| ------------------ | ---------- | ------------------------------------------------------ |
| `id`               | uuid v7 PK | `@PrimaryGeneratedUuidV7Column` (fork convention)      |
| `scanId`           | uuid, FK   | → `face_repair_scan(id)` **ON DELETE CASCADE**         |
| `assetFaceId`      | uuid       | the flagged face                                       |
| `personId`         | uuid       | the reviewed cluster (source) the face is currently on |
| `suspectedOwnerId` | uuid       | the destination the scan suspects                      |

Index on `(scanId, personId)` (the read key). FK only on `scanId` (CASCADE) — no FK on `personId`/`assetFaceId`:
the read-path join to `asset_face` handles stale faces, and a person deleted by the add-faces auto-delete leaves
only inert rows that the next scan's prune reclaims. New `migrations-gallery` migration (round timestamp
`1782000000000`), schema registration in `src/schema/index.ts`, and a `revert-to-immich` `DROP TABLE` step
(mirrors `face_repair_scan` / `face_repair_decline`).

### 2. Repository (on `FaceRepairScanRepository`)

- `replaceScanFlaggedFaces(scanId, faces: { assetFaceId; personId; suspectedOwnerId }[]): Promise<void>` —
  chunked bulk insert (1000/chunk, mirroring existing bulk-insert patterns). `scanId` is always fresh per scan, so
  this is insert-only; a defensive `delete where scanId` first keeps it idempotent if a scan is somehow re-run.
- `getScanFlaggedFaces(scanId, personId): Promise<{ assetFaceId; suspectedOwnerId }[]>` — selects the stored rows
  for `(scanId, personId)` **inner-joined to `asset` + `asset_face` + `face_search`**, mirroring
  `streamEligibleFaces` **exactly** (`asset_face.personId = :personId`, `sourceType = MachineLearning`,
  `asset_face.deletedAt is null`, `asset_face.isVisible = true`, `asset.deletedAt is null`, **and a
  `face_search` row exists**), ordered by `asset_face.id`. Mirroring the same eligibility filter the scan used
  (incl. the `face_search` join — consistent with the add-faces `getClusterFacePage`) keeps the read **faithful to
  today's result and self-correcting**: a face moved off the person, made non-eligible, or whose embedding was
  removed since the scan is excluded, with no coupling to the apply path.

### 3. Write path — `runScan` persists what it already computed

In `runScan`, reuse the **existing** `allFlaggedFaces = [...plan.toRepair, ...plan.reviewOnlyFaces]` local
(already built at `face-repair.service.ts:347` to derive the per-person enrichment) and persist it as flagged-face
rows for the new `scanId`: `replaceScanFlaggedFaces(scanId, allFlaggedFaces.map(f => ({ assetFaceId: f.assetFaceId,
personId: f.currentPersonId, suspectedOwnerId: f.suspectedOwnerId })))`. (`applyDeclineFilters` already ran inside
`buildRepairPlan`, so faces declined _at scan time_ are already excluded — same as today.) Persist **before**
`completeScan` (line 387) so the rows exist once status flips to `completed`; `pruneSupersededScans` (line 390)
runs after and cascade-drops the superseded scans' rows. If `runScan` throws after the persist but before
`completeScan`, the scan is marked `failed` and the rows are inert — see E15.

### 4. Read path — `getPersonFlaggedFaces` (service)

```
const latest = await faceRepairScanRepository.getLatestScan();
if (!latest) return { personId, flaggedFaces: [] };
const stored = await faceRepairScanRepository.getScanFlaggedFaces(latest.id, personId);   // still-on-person, eligible
const declineMaps = await faceRepairDeclineRepository.getDeclineMaps();
const byPerson = new Map([[personId, stored.map(s => ({ assetFaceId: s.assetFaceId, currentPersonId: personId, suspectedOwnerId: s.suspectedOwnerId }))]]);
applyDeclineFilters(byPerson, declineMaps);                                                // filter faces declined since the scan
return { personId, flaggedFaces: (byPerson.get(personId) ?? []).map(({ assetFaceId, suspectedOwnerId }) => ({ assetFaceId, suspectedOwnerId })) };
```

No `buildRepairPlan`, no `searchFaces`. Reads the latest scan (consistent with the console/list page, which also
keys off `getLatestScan`); a running re-scan with no rows yet yields an empty list (transient, acceptable).

### 5. Lifecycle

- Superseding/old scans: `pruneSupersededScans` already deletes non-latest scan rows; **FK CASCADE** drops their
  flagged-face rows. No new cleanup code.
- After apply: no coordination needed — the read-path still-on-person join means moved faces stop appearing;
  rows for the (console-dropped) person are inert until the next scan supersedes this one.

## Edge cases (all must be covered by tests — see Testing)

| #   | Case                                                                                                                      | Expected behaviour                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Person with flagged faces, fresh scan                                                                                     | Review returns **exactly** the scan's `toRepair` + `reviewOnlyFaces` for the person (`{assetFaceId,suspectedOwnerId}`).                                                                                                          |
| E2  | A flagged face **moved off** the person after the scan                                                                    | Excluded from review (still-on-person join); no row deletion needed.                                                                                                                                                             |
| E3  | A flagged face **declined (face-level)** after the scan                                                                   | Excluded via `applyDeclineFilters` (same semantics as today).                                                                                                                                                                    |
| E4  | A **person-level decline** for the suspected owner created after the scan                                                 | All matching faces excluded via `applyDeclineFilters`.                                                                                                                                                                           |
| E5  | A flagged face becomes **non-visible / soft-deleted / on a deleted asset / loses its `face_search` embedding** after scan | Excluded by the eligibility join (mirrors `streamEligibleFaces`, incl. the `face_search` inner join).                                                                                                                            |
| E6  | No latest scan, or person not in the scan                                                                                 | Empty `flaggedFaces` (matches today's empty state).                                                                                                                                                                              |
| E7  | Scan **re-run** (new `scanId`)                                                                                            | Review reads the **new** scan's rows; old rows are cascade-dropped when prune runs.                                                                                                                                              |
| E8  | Scan row **deleted/superseded**                                                                                           | Its flagged-face rows are **cascade-deleted** (FK ON DELETE CASCADE).                                                                                                                                                            |
| E9  | Read path performance                                                                                                     | `getPersonFlaggedFaces` issues **no vector search** and does **not** call `buildRepairPlan` (asserted).                                                                                                                          |
| E10 | Person with **thousands** of flagged faces                                                                                | Bounded indexed read (no KNN); returns the full set.                                                                                                                                                                             |
| E11 | Two persons flagged in the same scan                                                                                      | `getScanFlaggedFaces` is scoped to `(scanId, personId)` — each person sees only their own faces.                                                                                                                                 |
| E12 | A re-scan is **running** (rows not yet written)                                                                           | Empty during the scan (transient); fills in on `completeScan`.                                                                                                                                                                   |
| E13 | Face flagged at scan time that a fresh recompute would no longer flag                                                     | **Still shown** (snapshot semantics) as long as it's still on the person + not declined — intended; asserted.                                                                                                                    |
| E14 | Both `toRepair` **and** `reviewOnlyFaces` for a person                                                                    | Both kinds are persisted and returned (union), matching today's `getPersonFlaggedFaces`.                                                                                                                                         |
| E15 | Scan **fails** after the flagged-face persist but before `completeScan`                                                   | Scan is marked `failed` and lists no persons (not reachable from the console); its rows are inert and the next scan's `pruneSupersededScans` cascade-drops them. Asserted at the repo level (cascade) — no special cleanup code. |
| E16 | A flagged face's `personId` deleted by the add-faces **auto-delete**                                                      | Orphaned rows (no FK on `personId`) are harmless: the person can't be reviewed, the read filters by `personId`, and the rows are pruned by the next scan.                                                                        |

## Testing — **TDD is mandatory**

**Every slice is written test-first:** (1) write the failing test that pins the behaviour, (2) run it and confirm
it fails for the right reason, (3) implement the minimum to pass, (4) refactor. The **medium tier (real Postgres
via testcontainers) is the core proof** — it exercises the real SQL (eligibility join, cascade) and the real scan
→ review flow. Every edge-case row above maps to at least one named test below.

### Server — medium (`server/test/medium/specs/...`, real DB)

- **Repository `getScanFlaggedFaces` / `replaceScanFlaggedFaces`** (`repositories/face-repair-scan.repository.spec.ts`):
  seed a scan + a cluster of faces; write flagged rows; assert the read returns them (E1); a face reassigned to
  another person → excluded (E2); a non-visible / soft-deleted / asset-deleted face → excluded (E5); rows scoped
  per `(scanId, personId)` (E11); deleting the scan row cascades the flagged rows away (E8); a second scan's rows
  are independent (E7).
- **End-to-end scan → review** (`services/face-repair-flagged-faces.spec.ts`, real `runScan` + real reads):
  seed a mixed library, run a real scan → flagged-face rows are written for the right persons with the union of
  `toRepair` + `reviewOnlyFaces` (E1, E14); `getPersonFlaggedFaces` returns that set; a face **moved off** the
  person afterward drops from the result (E2); a face **declined after** the scan is filtered (E3) and a
  **person-level decline** filters its faces (E4); a fresh recompute that would no longer flag a still-present
  face does **not** change the review (E13); no completed scan / unknown person → empty (E6).

### Server — unit (`server/src/services/face-repair.flagged-faces.spec.ts`, `newTestService`)

- `getPersonFlaggedFaces` reads `faceRepairScanRepository.getScanFlaggedFaces` (mocked) for the latest scan and
  applies `applyDeclineFilters` via mocked `getDeclineMaps`; **asserts `searchRepository.searchFaces` and
  `buildRepairPlan` are NOT called** (E9 perf guard); empty when `getLatestScan` returns undefined (E6).
- `runScan` calls `replaceScanFlaggedFaces` with the union of `toRepair` + `reviewOnlyFaces` mapped to
  `{ assetFaceId, personId, suspectedOwnerId }` (E14), before `completeScan`.

### Migration

- Reversibility: `up` creates and `down` drops `face_repair_scan_flagged_face` (medium migration-reversibility
  pattern from the console scan table), and `make sql` schema check is clean.

### Verification gate (before "done")

Run, and paste real output into the slice notes (no "should pass"):

- `cd server && pnpm test -- --run` (unit) and the new medium specs against a live test DB.
- `make check-server` (types) and a final `make lint-server` pass (defer-lint-to-end convention).
- `make sql` and confirm no schema drift.
- Web/OpenAPI: **none** — this change does not touch the API surface.

## Slices (for `/impl-loop`)

Ordered so each ships working, independently testable software; TDD throughout. No web/OpenAPI work.

### Slice 1 — Table + repository (write + read), medium-tested

- **Goal:** `face_repair_scan_flagged_face` table (decorator + `migrations-gallery` migration + `schema/index.ts`
  registration + `revert-to-immich` `DROP TABLE`) and the two `FaceRepairScanRepository` methods
  (`replaceScanFlaggedFaces`, `getScanFlaggedFaces` with the eligibility join).
- **Tests (medium):** repo write/read (E1), still-on-person + eligibility exclusion (E2, E5), `(scanId,personId)`
  scoping (E11), cascade on scan delete (E8), independent second scan (E7); migration reversibility. The cascade
  test (E8) + `(scanId, personId)` scoping (E11) + the read's `personId` filter also cover E15 (failed-scan rows
  pruned) and E16 (orphaned rows after a person auto-delete) — no extra code, but assert the cascade explicitly.
- **Edges:** E1, E2, E5, E7, E8, E11 (and E15/E16 via cascade + scoping).
- **Done when:** medium repo spec green; `make check-server` + `make sql` clean.

### Slice 2 — Service wiring (persist on scan, read on review), remove recompute

- **Goal:** `runScan` persists `toRepair` + `reviewOnlyFaces` via `replaceScanFlaggedFaces`; `getPersonFlaggedFaces`
  reads `getScanFlaggedFaces` + `applyDeclineFilters` and **no longer calls `buildRepairPlan`**.
- **Depends on:** Slice 1.
- **Existing tests to update:** the current `getPersonFlaggedFaces` unit tests in
  `server/src/services/face-repair.person.spec.ts` mock `buildRepairPlan` and assert it is called — they must be
  rewritten (or moved into the new `face-repair.flagged-faces.spec.ts`) to assert the new read-from-repo behaviour,
  since the recompute is removed.
- **Tests:** unit — read path reads the repo + applies declines, asserts **no `searchFaces` / no `buildRepairPlan`**
  (E9), empty on no scan (E6); `runScan` persists the union before `completeScan` (E14). Medium e2e — real scan →
  review returns the correct set (E1, E14); moved-after dropped (E2); declined-after filtered, face- and
  person-level (E3, E4); snapshot-still-shown (E13); large flagged set is a bounded read (E10); running re-scan
  yields empty until complete (E12).
- **Edges:** E3, E4, E6, E9, E10, E12, E13, E14.
- **Done when:** unit + medium specs green (pasted evidence); `make check-server` + final `make lint-server` clean.

## Out of scope (noted, not built)

- **#2 — parallelizing the scan's per-face KNN** (and any algorithmic scan-scalability rethink). The scan remains
  the only KNN consumer after this change; revisit its speed/complexity separately once this lands.
- **Apply-path optimization.** `applyRepair` keeps its live `buildRepairPlan` recompute (authoritative, protected
  by the still-on-source re-check). Reading stored faces in apply folds into the deferred scan rethink.
- **Web / OpenAPI / mobile.** The `getFaceRepairPersonFaces` contract is unchanged.
