# Face Cleanup Console — see & select all cluster faces — design

**Status:** approved (brainstorm 2026-06-25); **revised 2026-06-25 post-review** — corrected against the real
`face-repair` code, added edge cases E17–E20, and split into numbered slices for `/impl-loop`. Ready for
slice-by-slice implementation.
**Branch / PR:** `feat/face-cleanup-console` — implemented and shipped on the same branch as the console.
**Prereq:** the Face Cleanup Console review screen
([`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md)),
its scan engine and the reattribution apply path
([`2026-05-31-face-reattribution-repair-design.md`](2026-05-31-face-reattribution-repair-design.md))
are already on this branch. Key existing primitives this design reuses:
`FaceRepairService.applyRepair` / `executeRepair`, `FaceRepairRepository.streamEligibleFaces` /
`reattributeFaces`, `PersonRepository.delete`, and `FaceRepairScanRepository.removePersonsFromLatestScan`.

## Motivation

The review screen (`/admin/face-cleanup/[personId]`) only ever shows the **scan-flagged** subset of a
cluster's faces — the 2-of-3 the detector suspected belong to another owner. The admin has no way to:

1. **See the rest of the cluster.** If the unnamed cluster is actually Pierre, the admin wants to move
   _every_ face into Pierre, not just the two the scan happened to flag.
2. **Add faces the scan missed.** A real-but-incomplete flag set leaves correct-but-unflagged faces
   stranded; the admin should be able to opt them into the same move.

This feature turns the review screen into a complete face-management surface for the cluster: the scan's
suggestions stay exactly as they are, and a new paginated section exposes the rest of the cluster so the
admin can add individual faces or move the whole cluster in one action.

## Requirements (locked in brainstorm)

1. **Extra faces follow the on-screen destination.** Faces the admin manually selects move to the same
   primary suspected owner already shown on the review screen (e.g. Pierre). No per-face destination
   picker — the screen has exactly one destination. (The primary owner is `suspectedOwners[0]`, the
   highest-count suspect, already surfaced as `primaryOwner`.)
2. **Two sections, distinct meaning.** The scan's flagged faces keep their own **Suggested by scan**
   section (pre-checked, decline/exclude unchanged — its audit meaning is preserved). A new **Rest of this
   cluster (M)** section lists every _other_ visible face, unchecked by default; the admin opts faces in.
3. **Pagination is mandatory.** A cluster can hold **thousands** of faces. The Rest section is
   server-paginated (lazy "Load more"); the client never loads the whole cluster to render or to move it.
4. **Move entire cluster.** A header action moves _every_ remaining visible face to the primary owner —
   flagged faces included — enumerated **server-side**, so it works without the client having paged through
   the cluster. It is confirmed (it empties the cluster).
5. **Auto-delete the emptied _unnamed_ cluster.** When a move leaves the source cluster with **0 visible
   faces** _and the source is unnamed_ (`person.name` empty), the source person row is deleted. Moving a
   whole unnamed cluster into Pierre therefore behaves like a clean merge — no orphan empty "Unnamed
   cluster" remains, and the console drops it. A **named** person emptied this way is **never** auto-deleted
   (its name is intentional state); the row is kept and simply leaves the console.
6. **No regression to the flagged path.** The existing approve-suggestions apply
   (`approvedPersonIds` + `excludeFaceIds`) is unchanged byte-for-byte; the manual capability is **additive**.

## Architecture

### Server

**1. List the rest of the cluster (paginated).** New admin endpoint — `POST` so the (small) flagged-id
exclude list rides in the body rather than a long URL:

```
POST /admin/face-repair/scan/person/:personId/cluster-faces
  body: { excludeFaceIds: string[]; page: number; size: number }
  → { faces: { assetFaceId: string }[]; total: number; hasMore: boolean }
```

(Path mirrors the existing `GET /admin/face-repair/scan/person/:personId` — same `scan/person/:personId`
prefix — rather than the spec's earlier `/person/:personId/...`, which did not match any existing route.)

Backed by a new `FaceRepairRepository.getClusterFacePage(personId, { excludeFaceIds, limit, offset })`
that reuses the existing eligibility filter (`asset_face.isVisible = true`,
`sourceType = MachineLearning`, `deletedAt is null`, `asset.deletedAt is null`),
`asset_face.personId = :personId`, `id NOT IN (excludeFaceIds)`, ordered by `asset_face.id`
(stable cursor for paging), `LIMIT size OFFSET page*size`. `total` is the same filter's `COUNT(*)`;
`hasMore = (page+1)*size < total`. The client passes the flagged ids it already holds from
`getFaceRepairPersonFaces`, so the two sections never overlap and the server does **no plan rebuild per
page** (cheap at thousands of faces). `size` is validated (1–200) and `page` (≥ 0).

**2. Apply: manual faces + whole cluster.** Extend `FaceRepairApplyRequestDto`. The existing fields are
untouched **except** that `approvedPersonIds` is relaxed from `z.array(uuid).min(1)` to allow an **empty**
array (an entire-cluster move sends none), guarded by a `.refine` so a request that would do nothing — empty
`approvedPersonIds` **and** no `manualMove` — is still rejected (400). One optional block is added:

```ts
manualMove?: {
  personId: string;            // the reviewed cluster (source)
  destinationPersonId: string; // its primary suspected owner (client-supplied; see note)
  faceIds?: string[];          // explicit extra faces to move (partial add)
  entireCluster?: boolean;     // move ALL remaining visible faces of the cluster
};
```

> **Destination provenance.** `getFaceRepairPersonFaces` returns only
> `{ personId, flaggedFaces: [{ assetFaceId, suspectedOwnerId }] }` — it carries **no** owner names. The
> review screen derives `primaryOwner = scanPerson.suspectedOwners[0]` from the **scan snapshot**
> (`getLatestScan`), and sends that owner's id as `destinationPersonId`. The server **trusts** the
> admin-supplied id (admin-only surface); it does not re-derive or re-validate it against the scan.

`executeRepair` already accepts a whole `RepairPlan` and routes `plan.toRepair` by
`(currentPersonId → suspectedOwnerId)`. So the manual move is expressed as **extra `toRepair` entries merged
into the same plan** as the flagged faces and run through **one** `executeRepair` call — one representative-face
reconcile, one thumbnail batch, and natural per-route dedup. `applyRepair` is restructured to:

- **Run the 409 guards first.** Today `applyRepair` early-returns `{0,0}` when `approvedPersonIds` is empty
  _before_ the guards (`face-repair.service.ts:509`). Reorder so the `FacialRecognition`-active and
  scan-pending/running guards (both `ConflictException`) run **before** any early-return, and early-return
  only when there is genuinely nothing to do (no approved persons **and** no manual work). This makes E10
  hold for an entire-cluster move (which sends an empty `approvedPersonIds`).
- **Build the flagged plan only when needed.** Non-empty `approvedPersonIds` → `buildRepairPlan` runs exactly
  as today and yields its `toRepair`. Empty → skip `buildRepairPlan` entirely (it streams the whole eligible
  set — wasted work for a pure manual move).
- **Resolve the manual face set.** Reject `destinationPersonId === personId` (no self-move,
  `BadRequestException`, E18). `entireCluster` → enumerate all visible ML faces of `personId` via
  `streamEligibleFaces({ personId })` (its filter _is_ the eligibility filter: `isVisible`,
  `sourceType = MachineLearning`, `asset_face.deletedAt is null`, `asset.deletedAt is null`); `entireCluster`
  **supersedes** `faceIds` when both are sent (E19). Otherwise use the explicit `faceIds`. Map each to a
  `FlaggedFace` `{ assetFaceId, currentPersonId: personId, suspectedOwnerId: destinationPersonId }`.
- **One execute.** Concatenate flagged `toRepair` + manual `toRepair` into a single `RepairPlan` and call
  `executeRepair` once. The per-route still-on-source re-check, destination-exists check, `manual` identity
  link (`replaceFaceIdentity({ source: 'manual' })`), representative-face reconcile and thumbnail-regen queue
  all apply unchanged. A face that is both flagged and in `entireCluster` is deduped by the route map / no-oped
  by the still-on-source re-check (E9).
- **Auto-delete + console-drop.** After the move, `countEligibleFaces({ personId })` gives the source's
  remaining visible-ML count. If it is **0**: drop the source from the latest scan snapshot so the console
  drops it — **for both named and unnamed** (E12); and, **iff the source is unnamed**
  (`isBlank(person.name)` — an unnamed cluster's `person.name` is the empty string `''` in this codebase,
  **never NULL**), `personRepository.delete([personId])`. Concretely: extend the existing
  `removePersonsFromLatestScan(approvedPersonIds)` call to drop `personId` too when the manual move emptied the
  source. A named source emptied this way is **kept** as a row (its name is deliberate) but still leaves the
  console.

> **Scale (entire-cluster of thousands).** `executeRepair` writes the `manual` identity **per face** in a loop
> (`for (assetFaceId of movedIds) await replaceFaceIdentity(...)`, `face-repair.service.ts:202`). The flagged
> path is naturally bounded; an entire-cluster move is not. For clusters in the thousands this loop dominates
> apply latency — the service slice must batch these identity writes (a single multi-row insert/upsert) or
> chunk the move so a large entire-cluster apply does not time out (E20). A medium test seeds a large cluster
> and asserts the full move completes.

**Entire-cluster vs. flagged-path interplay.** **Move entire cluster** sends `approvedPersonIds: []` and
`manualMove.entireCluster = true` (now accepted post-relax), so _all_ faces (flagged included) go to the
**primary** owner rather than their per-face suspected owners. A **partial add** sends both
`approvedPersonIds: [personId]` (flagged → their suspects, minus excludes/declines) and `manualMove.faceIds`
(the unflagged picks → primary owner); the two sets are disjoint, merged into one plan, and the
still-on-source re-check makes any accidental overlap a no-op.

### Web

**View model** (`[personId]/review.svelte.ts`) gains, alongside the existing `excluded` / `declined` sets:

- `manualSelected: SvelteSet<string>` — unflagged faces opted into the move.
- `entireCluster: boolean` — whole-cluster mode.
- `toggleManual(id)`, `selectAllLoaded(ids)`, `clearManual()`, `setEntireCluster(on)`.
- `movingCount` extended: `entireCluster` → `clusterTotal`; else flagged-not-excluded-not-declined +
  `manualSelected.size`.
- `applyPayload()` helper that produces the `{ approvedPersonIds, excludeFaceIds, manualMove }` body for
  the two cases above (entire-cluster vs. partial), keeping payload construction unit-testable in isolation
  from the Svelte component.

**Screen** (`[personId]/+page.svelte`): the top half (banner, Stays→Moves strip, and the existing flagged-faces
grid) is unchanged in behaviour — the current single flagged grid simply gains the **Suggested by scan** label
(Requirement 2); it is not a new component. Below it, the **Rest of this cluster (M)** section:

- Loads page 0 of `cluster-faces` on mount (passing the flagged ids as `excludeFaceIds`); a **Load more**
  button fetches subsequent pages. `M = total`.
- Each tile toggles `manualSelected`; selected tiles get the same `→ {owner}` treatment as suggested tiles.
- Header actions: **Select all** (adds the currently-loaded face ids to `manualSelected`) and **Move entire
  cluster** (sets `entireCluster`, opens a confirm dialog — "This moves all M faces to {owner} and removes
  the empty _Unnamed cluster_").
- The Stays/Moves strip counts and the sticky **Move N faces** button fold in manual picks / entire-cluster
  live. Apply calls the extended `applyFaceRepair`.

### OpenAPI

New endpoint + DTO fields require a **full `make open-api`** (Java — TS + Dart). A TS-only regen passes
locally but hides Dart drift and fails the "OpenAPI Clients" CI check. Commit `open-api/immich-openapi-specs.json`
and the regenerated Dart client alongside the TS SDK.

## Edge cases (all must be covered by tests — see Testing)

| #   | Case                                                                                                           | Expected behaviour                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Cluster with **only** flagged faces (Rest is empty)                                                            | Rest section shows empty state; `total = 0`, `hasMore = false`; Move-entire-cluster still moves the flagged faces.                                                           |
| E2  | Cluster with **thousands** of faces                                                                            | Rest paginates; first page renders fast; Move-entire-cluster moves all without the client paging through them.                                                               |
| E3  | `excludeFaceIds` covers a whole page boundary                                                                  | Pagination math stays correct (`total`/`hasMore` computed against the filtered count, not the raw count).                                                                    |
| E4  | Move **entire cluster**                                                                                        | Every visible face (flagged + unflagged) → primary owner; source ends with 0 faces → **deleted**; console drops it.                                                          |
| E5  | Partial add: some unflagged picks + some flagged excluded                                                      | Flagged-not-excluded → per-face suspects; picks → primary owner; counts reflect the union; source survives (faces remain) → **not** deleted.                                 |
| E6  | Manual face already moved by a concurrent job                                                                  | Still-on-source re-check skips it; `skipped` counts it; no error.                                                                                                            |
| E7  | Destination (primary owner) **deleted/merged** since the scan                                                  | Route's destination-exists check skips the whole route; nothing moved; surfaced as a no-op/conflict, never a corrupt write.                                                  |
| E8  | `manualMove.faceIds` contains an id **not in the cluster** / already on the destination / non-visible / non-ML | Filtered out by the still-on-source + eligibility re-check; never moved; counted as skipped.                                                                                 |
| E9  | `entireCluster = true` **and** the person also in `approvedPersonIds`                                          | Idempotent: flagged faces moved once (second attempt no-ops via still-on-source); final state identical to entire-cluster alone.                                             |
| E10 | Recognition queue active **or** scan pending/running at apply                                                  | 409 guard rejects the _entire_ request — including an entire-cluster move with empty `approvedPersonIds`, because guards now run **before** the early-return; nothing moved. |
| E11 | Empty `manualMove` (no `faceIds`, `entireCluster` false)                                                       | No-op manual move; behaves exactly like the legacy flagged-only apply.                                                                                                       |
| E12 | Source person becomes empty but is a **named** person (not an unnamed cluster)                                 | **Not** auto-deleted — the named row is kept (name is deliberate state); only unnamed clusters are pruned. Asserted by test.                                                 |
| E13 | Representative face of the destination/source changes after the move                                           | Reconcile repoints it and queues a thumbnail regen (reused `executeRepair` behaviour) — asserted.                                                                            |
| E14 | `size`/`page` out of range on `cluster-faces`                                                                  | Validation rejects (`size` 1–200, `page` ≥ 0).                                                                                                                               |
| E15 | Web: **Select all** then deselect a few, then **Move entire cluster**                                          | Entire-cluster supersedes individual selection; count = cluster total; payload uses `entireCluster`.                                                                         |
| E16 | Web: apply returns 409                                                                                         | Existing conflict banner shown; manual selection state preserved (not lost).                                                                                                 |
| E17 | Destination unknown — scan snapshot pruned, so `primaryOwner` / `destinationPersonId` is null                  | Web disables **Select all** / **Move entire cluster** / manual apply; server rejects a `manualMove` missing `destinationPersonId` (400).                                     |
| E18 | `manualMove.destinationPersonId === personId` (move a cluster into itself)                                     | Rejected (`BadRequestException`, 400); nothing moved.                                                                                                                        |
| E19 | `manualMove.entireCluster = true` **and** `faceIds` also supplied                                              | `entireCluster` supersedes; `faceIds` ignored; all visible faces → primary owner.                                                                                            |
| E20 | Entire-cluster move of **thousands** of faces                                                                  | The per-face `manual` identity writes are batched/chunked; the apply completes without timeout and every visible face lands on the primary.                                  |

## Testing — **TDD is mandatory**

**Every slice is written test-first.** For each unit below: (1) write the failing test that pins the
behaviour, (2) run it and confirm it fails for the right reason, (3) implement the minimum to pass, (4)
refactor. No production line lands without a test that fails before it and passes after. The brainstorm
explicitly calls for **full test and edge-case coverage** — every row in the Edge-cases table above maps to
at least one named test below.

### Server — unit (`server/src/...spec.ts`, vitest, `newTestService`)

- **`FaceRepairRepository.getClusterFacePage`** — covered in the medium tier (it is a real SQL query); the
  unit tier asserts the service wiring calls it with the right args.
- **`FaceRepairService.applyRepair` with `manualMove`** (mocked repos):
  - explicit `faceIds` → manual `toRepair` entries `personId → destinationPersonId` merged into the plan and
    `executeRepair` invoked once with the union (E5, E8).
  - `entireCluster` → enumerates all visible faces via `streamEligibleFaces({ personId })`, routes them all to
    primary; `faceIds` ignored when `entireCluster` is also set (E4, E19).
  - flagged path still runs and is unchanged when `manualMove` absent (E11) and when present (E5).
  - **guards run before the early-return**: an entire-cluster move with empty `approvedPersonIds` still hits the
    recognition-active / scan-running guards and is rejected with 409 (E10); `buildRepairPlan` is **not** called
    when `approvedPersonIds` is empty.
  - self-move guard: `destinationPersonId === personId` → `BadRequestException`, nothing moved (E18).
  - auto-delete + console-drop: `removePersonsFromLatestScan` is called with `personId` included when the source
    is emptied (E4, E12); `personRepository.delete([personId])` called **iff** source visible-face count hits 0
    **and** the source is unnamed (`name: ''`) — E4 deletes an unnamed cluster, E5 does not delete a surviving
    cluster, E12 keeps (but drops from the console) an emptied **named** person.
  - idempotency: a person in both `approvedPersonIds` and `entireCluster` does not double-count (E9).
- **`applyPayload()` builder is exercised** indirectly here via the controller DTO; see web unit for the
  client side.

### Server — controller (`face-repair-admin.controller.spec.ts`)

- `POST /admin/face-repair/scan/person/:personId/cluster-faces` — admin-guarded (401/403 without admin),
  validates body (`size`/`page` ranges → 400, E14), returns `{ faces, total, hasMore }`.
- `POST /admin/face-repair/apply` — DTO accepts the new optional `manualMove` block and an **empty**
  `approvedPersonIds` when `manualMove` is present, but rejects a request with empty `approvedPersonIds` **and**
  no `manualMove` (refine → 400); rejects malformed `manualMove` shapes (missing `destinationPersonId`,
  non-array `faceIds`, E17); passes the block through to the service.

### Server — medium (`server/test/medium/specs/services/face-repair*.spec.ts`, real DB via testcontainers)

These exercise the real SQL and the real reattribution, which is where the durability guarantees live.

- **`getClusterFacePage`**: seed a cluster of N visible ML faces + some non-visible / non-ML / deleted /
  other-person faces; assert only the eligible same-person faces are returned, `excludeFaceIds` removes the
  flagged ones, pagination returns disjoint pages whose union = filtered set, `total`/`hasMore` correct at
  the last-page boundary (E1, E2, E3).
- **apply `entireCluster`** (unnamed source, `name: ''`): seed a mixed cluster, move all → every visible face
  now on the destination, identities are `manual`, source person **row deleted**, representative/thumbnail
  reconcile observed, scan snapshot no longer lists the cluster (E4, E13).
- **apply `entireCluster`** (**named** source): same move, but the source row is **kept** (not deleted) while
  still being dropped from the scan snapshot so the console no longer lists it (E12).
- **apply partial add**: flagged-not-excluded land on their per-face suspects, manual picks land on the
  primary owner, source **survives** with its remaining faces, identities `manual`, source **not** deleted (E5).
- **concurrency / staleness**: a face moved out-of-band before apply is skipped not errored (E6); a
  destination deleted before apply skips the route (E7); ids outside the cluster / `destinationPersonId ===
personId` are no-ops/rejected (E8, E18).
- **scale**: seed a large cluster (hundreds–thousands of visible ML faces) and `entireCluster`-move it → all
  land on the destination and the apply completes within the test budget — proves the batched/chunked identity
  writes (E20).
- **guard**: apply while a scan row is `running` → 409, DB unchanged — asserted for an **entire-cluster** move
  (empty `approvedPersonIds`) so the guard-before-early-return reorder is covered (E10).

### Web — unit (`web/src/...spec.ts`, vitest + testing-library)

- **`review.svelte.ts` view model**: `toggleManual` add/remove; `selectAllLoaded` unions loaded ids;
  `movingCount` for partial (flagged−excluded−declined + manual) and for `entireCluster` (= cluster total);
  `entireCluster` supersedes individual picks (E15); `applyPayload()` emits the correct body for both cases —
  partial → `{ approvedPersonIds: [personId], excludeFaceIds, manualMove: { …, faceIds } }`; entire-cluster →
  `{ approvedPersonIds: [], manualMove: { …, entireCluster: true } }` (E15); `destinationPersonId` is taken
  from `primaryOwner.ownerPersonId`.
- **`[personId]/+page.svelte`**: Rest section renders the first page and a working **Load more**; empty Rest
  shows the empty state (E1); clicking a Rest tile updates Stays/Moves counts and the sticky button; **Move
  entire cluster** opens the confirm and, on confirm, issues an `entireCluster` apply; when `primaryOwner` is
  null (snapshot pruned) the **Select all** / **Move entire cluster** / apply actions are disabled (E17); a 409
  apply shows the conflict banner and preserves selection (E16). SDK calls mocked.

### E2E (optional, only if the existing console has an e2e lane)

If the branch already has a Playwright lane for the console, add one happy-path spec: open a flagged
cluster, expand the Rest section, select a couple of extra faces, Move, and assert the console no longer
lists the moved faces. If no such lane exists, do **not** add one for this feature — unit + medium coverage
is the bar.

### Verification gate (before "done")

Run, and paste real output into the slice notes (no "should pass"):

- `cd server && pnpm test -- --run` (unit) and the new medium specs against a live test DB.
- `cd web && pnpm test -- --run` (the new + existing review specs).
- `make check-web` and `make check-server` (types) and a final `make lint-*` pass at the end (per the
  defer-lint-to-end convention).
- `make open-api` and confirm the working tree shows the regenerated TS **and** Dart clients + specs.json.

## Slices (for `/impl-loop`)

Ordered so each slice ships working, independently testable software; later slices depend only on earlier ones.
**Every slice is TDD: red test first, confirm it fails for the right reason, minimal green, refactor.** This
feature adds **no** schema/migration (it reuses existing tables), so there is no migration or revert-script
work. Edge-case IDs reference the table above; the union of the per-slice edges covers E1–E20.

### Slice 1 — Repository: paginated cluster-face lister

- **Goal:** `FaceRepairRepository.getClusterFacePage(personId, { excludeFaceIds, limit, offset })` →
  `{ faces: { assetFaceId }[], total, hasMore }`, reusing the existing eligibility filter
  (`isVisible`, `sourceType = MachineLearning`, `asset_face.deletedAt is null`, `asset.deletedAt is null`,
  `personId = :personId`, `id NOT IN excludeFaceIds`), ordered by `asset_face.id` for a stable page cursor.
  `total` = the same filter's `COUNT(*)`; `hasMore = offset + faces.length < total`.
- **Depends on:** nothing (existing repo + medium harness).
- **Files:** modify `server/src/repositories/face-repair.repository.ts`; test
  `server/test/medium/specs/repositories/face-repair.repository.spec.ts`.
- **Tests (medium, real DB):** seed a cluster of N visible ML faces plus non-visible / non-ML / soft-deleted /
  asset-deleted / other-person faces; assert only eligible same-person faces return; `excludeFaceIds` removes
  the flagged ids; sequential pages are disjoint and their union = the filtered set; `total`/`hasMore` correct
  at the last-page boundary and when an exclude straddles a page boundary; empty result when all faces are
  excluded.
- **Edges:** E1, E2 (pagination), E3.
- **Done when:** medium spec green; `make check-server` clean.

### Slice 2 — DTO + controller endpoint + OpenAPI regen

- **Goal:** expose `POST /admin/face-repair/scan/person/:personId/cluster-faces` (admin-guarded, body
  `{ excludeFaceIds, page, size }`, `size` 1–200, `page` ≥ 0) returning `{ faces, total, hasMore }` via
  Slice 1; and extend `FaceRepairApplyRequestDto` with the optional `manualMove` block + relaxed
  `approvedPersonIds` (empty allowed) + a `.refine` rejecting "empty `approvedPersonIds` **and** no
  `manualMove`". Controller passes both through to the service (service logic is Slice 3 — here it can be a thin
  passthrough/stub returning the existing apply result so the controller test is meaningful).
- **Depends on:** Slice 1.
- **Files:** modify `server/src/dtos/face-repair.dto.ts`,
  `server/src/controllers/face-repair-admin.controller.ts`; tests `face-repair.dto.spec.ts`,
  `face-repair-admin.controller.spec.ts`. Then `make open-api` (full Java — TS **and** Dart) and commit
  `open-api/immich-openapi-specs.json`, the TS SDK, and the Dart client.
- **Tests:** DTO accepts `manualMove`; accepts empty `approvedPersonIds` with `manualMove`; **rejects** empty
  `approvedPersonIds` with no `manualMove`; rejects malformed `manualMove` (missing `destinationPersonId`,
  non-array `faceIds`). Controller: cluster-faces is admin-guarded (401/403), validates `size`/`page` ranges →
  400, returns the repo page; apply accepts the new shape and forwards it.
- **Edges:** E14, E17 (DTO rejects missing `destinationPersonId`).
- **Done when:** dto + controller specs green; working tree shows regenerated TS **and** Dart clients +
  `specs.json`; `make check-server` clean.

### Slice 3 — Service: manual move in `applyRepair`

- **Goal:** implement the manual move per the Architecture §2 — guard reorder (guards before early-return),
  skip `buildRepairPlan` on empty `approvedPersonIds`, self-move reject, `entireCluster` enumeration via
  `streamEligibleFaces({ personId })` (supersedes `faceIds`), merge flagged + manual `toRepair` into **one**
  `executeRepair` call, **batched** `manual` identity writes (E20), auto-delete unnamed emptied source +
  console-drop (`removePersonsFromLatestScan` including the emptied `personId`).
- **Depends on:** Slices 1–2 (DTO shape; replaces the Slice 2 passthrough).
- **Files:** modify `server/src/services/face-repair.service.ts` (and the identity write path for batching);
  tests `server/src/services/face-repair.apply.spec.ts` (unit, mocked repos via `newTestService`).
- **Tests (unit):** explicit `faceIds` merge; `entireCluster` enumerate-and-route-to-primary; `faceIds`
  ignored when `entireCluster` set; flagged path unchanged with/without `manualMove`; guards fire on an
  entire-cluster (empty `approvedPersonIds`) move and `buildRepairPlan` is not called; self-move rejected;
  idempotency for person in both `approvedPersonIds` and `entireCluster`; auto-delete iff emptied **and**
  unnamed, snapshot-drop includes the emptied source for both named and unnamed.
- **Edges:** E4, E5, E6, E8, E9, E10, E11, E12, E18, E19, E20 (impl).
- **Done when:** apply unit spec green; `make check-server` clean.

### Slice 4 — Medium service tests (real DB + real reattribution)

- **Goal:** prove the durability guarantees end-to-end against a real DB.
- **Depends on:** Slice 3.
- **Files:** `server/test/medium/specs/services/face-repair.apply.spec.ts` (and/or `face-repair-e2e.spec.ts`).
- **Tests (medium):** entire-cluster of an **unnamed** source → all faces on destination, identities `manual`,
  source row **deleted**, representative/thumbnail reconcile observed, scan snapshot drops the cluster;
  entire-cluster of a **named** source → row **kept** but dropped from the snapshot; partial add → source
  survives, not deleted; a face moved out-of-band is skipped; a deleted destination skips the route;
  ids-outside-cluster / self-move are no-ops/rejected; **large-cluster** entire-move completes within budget;
  apply during a `running` scan → 409, DB unchanged.
- **Edges:** E4, E5, E6, E7, E10, E12, E13, E20 (assert).
- **Done when:** medium specs green against a live test DB (paste real output).

### Slice 5 — Web view-model

- **Goal:** extend `review.svelte.ts` with `manualSelected: SvelteSet<string>`, `entireCluster: boolean`,
  `toggleManual` / `selectAllLoaded` / `clearManual` / `setEntireCluster`, an extended `movingCount`, and a
  pure `applyPayload()` builder (unit-testable in isolation from the component).
- **Depends on:** Slice 2 (SDK request type).
- **Files:** modify `web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts`; test
  `web/src/routes/admin/face-cleanup/[personId]/review.spec.ts`.
- **Tests (vitest, view-model in isolation):** `toggleManual` add/remove; `selectAllLoaded` unions; `movingCount`
  for partial vs `entireCluster`; `entireCluster` supersedes individual picks; `applyPayload()` emits the correct
  body for partial (`approvedPersonIds: [personId]` + `manualMove.faceIds`) and entire-cluster
  (`approvedPersonIds: []` + `manualMove.entireCluster`), with `destinationPersonId` from `primaryOwner`.
- **Edges:** E15.
- **Done when:** review spec green; `make check-web` clean.

### Slice 6 — Web component (Rest-of-cluster section)

- **Goal:** add the **Rest of this cluster (M)** section to `[personId]/+page.svelte` — page-0 load on mount
  (flagged ids as `excludeFaceIds`), **Load more**, **Select all**, **Move entire cluster** (confirm dialog),
  per-tile toggling that folds into the Stays/Moves strip + sticky **Move N faces** button, disabled actions
  when `primaryOwner` is null, and the 409 conflict banner preserving selection. Wire the generated
  cluster-faces SDK fn and the extended `applyFaceRepair` call (via `applyPayload()`).
- **Depends on:** Slices 2 (SDK), 5 (view-model).
- **Files:** modify `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` (+ `+page.ts` if load shape
  changes); test `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts`.
- **Tests (vitest + testing-library, SDK mocked):** Rest renders page 0 and a working Load more; empty Rest
  shows the empty state; clicking a Rest tile updates counts + sticky button; Move entire cluster opens the
  confirm and issues an `entireCluster` apply; null `primaryOwner` disables Select all / Move entire cluster /
  apply; a 409 apply shows the banner and preserves selection.
- **Edges:** E1 (empty state), E16, E17 (UI).
- **Done when:** page spec green; `make check-web` clean.

### Slice 7 — Verification gate + docs

- **Goal:** final green across the board and user-facing docs.
- **Depends on:** Slices 1–6.
- **Files:** `docs/docs/administration/face-cleanup.md` (document the see-all / add-faces / move-entire-cluster
  behaviour); E2E spec **only if** the console already has a Playwright lane (per §E2E).
- **Steps (paste real output, no "should pass"):** `cd server && pnpm test -- --run` + the new medium specs
  against a live DB; `cd web && pnpm test -- --run`; `make check-web` + `make check-server`; a final
  `make lint-*` pass (defer-lint-to-end); re-run `make open-api` and confirm the working tree shows regenerated
  TS **and** Dart clients + `specs.json` with no drift.
- **Edges:** none new — full-suite confirmation.
- **Done when:** all of the above is green with pasted evidence.

## Out of scope (noted, not built)

- Reaching this flexible view for **clean** clusters the scan never flagged — they don't appear in the
  console, so this would need a new entry point. Future work.
- Pulling faces **into** Pierre from _other_ clusters — that is Immich's existing merge / face-assignment
  surface, not this screen.
- A per-face destination picker — the screen has one destination by design (Requirement 1).
