# Face Cleanup Console — admin review UI for re-attribution over-cap clusters — design

**Status:** approved (brainstorm 2026-06-03); ready for slice-by-slice implementation
**Branch / PR:** `worktree-hagen-face-cluster-corruption`, follow-up on the shipped
[face re-attribution repair](2026-05-31-face-reattribution-repair-design.md) (`FaceRepairService`).
**Prereq:** the re-attribution repair engine (`FaceRepairService.buildRepairPlan` / `executeRepair`) and the
#652 prevention guards are already on this branch and must be **deployed** — the console is a UI layer on top
of that engine.

> **Correction (2026-06-04) — the engine's move primitive was rewritten.** The original `executeRepair`
> _unassigned_ the impostor faces and re-queued `FacialRecognition`, on the assumption (below) that recognition
> would route each face to its true owner's cluster. Live testing on a real library disproved this: Immich
> recognition assigns an unassigned face to its **single nearest assigned neighbour's** person
> (`person.service.ts` `handleRecognizeFaces`), which on a contaminated cluster is the _original wrong person_ —
> so every face boomeranged back within seconds and the apply was a no-op. `executeRepair` now **assigns each
> flagged face directly to its detector-determined suspected owner with a `manual` identity link** (the same
> primitive the People page uses), which is durable (recognition never overrides a manual face) and requires no
> recognition re-queue. The apply also prunes the applied persons from the persisted scan snapshot so the list
> reflects the change on refetch (the "Stale reports" open question, below). Sections that still describe the old
> unassign-and-re-queue behaviour are kept for history and flagged inline.

## Motivation

The re-attribution repair auto-fixes a face only when its cluster is **less than 50% contaminated**
(`flaggedFraction <= maxFlaggedFraction`, default `0.5`). On Hagen's production instance the repair ran and
re-homed 2,760 faces, but left **10,486 faces across 627 people** in the `reviewOnly` / `over-cap` bucket —
the clusters where _more than half_ the faces are flagged. These are real, confirmed corruption (e.g. Jula
Kulz 77.7% → Armin Falkner; "Person A" 67.7% → Angelinde Falkner; Alexia Varga Arrieta 64.7%), all from the
2026-05-25 batch event. The repair correctly **diagnoses** them and refuses to **act**, and there is currently
no downstream action available to an admin — so they stay permanently broken regardless of how often the
repair runs. See [the corruption diagnosis](2026-05-30-hagen-face-cluster-corruption-diagnosis.md).

### Key insight: the over-cap cap is a default for _unreviewed bulk runs_, not a hard limit

The `over-cap` gate exists so an unattended, instance-wide repair never blindly rewrites a cluster that is
mostly-flagged (where the cluster's own identity is in doubt). But the re-attribution decision itself is
**robust under heavy contamination**: `decideReattribution` (`src/utils/face-repair.ts`) flags a face by its
absolute resemblance to a _suspected owner_ Q (`topOtherNearest <= maxAttributionDistance`, measured **to Q**,
with a vote margin), explicitly _"so co-located contamination on P cannot suppress it."_ So a 78%-contaminated
cluster does not poison the decision: Armin's faces flag → Armin; Jula's real faces stay on Jula.

Two facts make a human-confirmed override the correct primitive (verified in code, not assumed):

1. **The repair never empties a cluster.** `executeRepair` moves only the _flagged_ faces; the person keeps its
   unflagged faces, name, and thumbnail. _(Original design re-queued `FacialRecognition` to re-home them — see the
   2026-06-04 correction above; the engine now assigns each flagged face directly to its suspected owner with a
   `manual` identity link, which keeps this property and is durable.)_
2. **"Dissolve" (un-assign all faces) would be strictly worse.** Recognition is k-NN over assigned faces, so a
   person with zero faces can never receive faces again, and `handlePersonCleanup` deletes faceless people —
   the name is _lost_, not merely ghosted. Re-attributing only the impostor faces sidesteps this entirely.

The console therefore productizes a **per-person, admin-confirmed re-attribution override**: the admin reviews
the evidence for a contaminated person and approves moving its flagged faces to their true owners. The
existing `maxFlaggedFraction` / `personId` request params already prove this works for a single person; the
console makes it reviewable and safe at the scale of hundreds of clusters.

## Goals / non-goals

**Goals:** an admin-only console that (a) scans the instance for contaminated clusters and persists a
reviewable report, (b) classifies each flagged person as _confident_ or _review-first_, (c) lets the admin
bulk-approve the confident long tail and individually review the rest on a dedicated page (with per-face
deselect), and (d) applies an exact, audited re-attribution to the approved set. Names, thumbnails, and
unflagged faces are always preserved.

**Non-goals (explicit, per brainstorm):**

- **Literal "dissolve"** (un-assign all faces of a person + re-cluster) — rejected; technically inferior and
  loses names (see Motivation).
- **The `unAttributable` residue** (faces with no confident external owner — 173 on Hagen's instance): they
  have nowhere to be re-homed, so they stay assigned (`blank > wrong` does not apply — moving them nowhere
  helps no one). Surfaced in the totals as a documented, deliberate no-op.
- **A per-user / person-page surface.** The operation is admin-only (matches the existing
  `@Authenticated({ admin: true })` endpoint). A self-service entry point on `/people` is a possible later
  follow-up, not this work.
- **Server-side pagination of the report.** At hundreds–low-thousands of flagged persons the report is small
  enough to ship as one payload and sort/filter/select client-side. If an instance ever exceeds that, add
  pagination later (noted in Slice 1).

## Decisions locked in the brainstorm

| Decision                | Choice                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Primitive               | Per-person **re-attribution override** (re-home impostor faces), **not** dissolve                                   |
| Surface / audience      | **Admin-only** console under Administration                                                                         |
| Scale model             | List + multi-select bulk-approve with guardrails; **confident rows auto-selected**, **review-first surfaced first** |
| Scan execution          | **Background job** (BullMQ) with progress + persisted report (not a synchronous request)                            |
| Report storage          | Single `face_repair_scan` row with enriched persons as **JSONB** (client-side sort/filter/select)                   |
| Large-cluster threshold | **50 faces** (default; configurable) → forces a cluster into _review-first_                                         |

## Architecture overview

Two screens on top of three server capabilities — all extensions of the existing `FaceRepairService`, adding
no new face-moving logic:

```
                          ┌──────────────── server ────────────────┐
  [Re-scan] ──trigger──▶  FaceRepairScan job                        │
                          │  buildRepairPlan (existing)             │
                          │  → classifyFlaggedPerson (new, pure)    │
                          │  → enrich w/ names+thumbnails           │
                          │  → persist face_repair_scan (new)       │
  list page ◀──GET────────  latest scan report (JSONB)              │
       │                  │                                         │
  review page             │                                         │
       │                  │                                         │
  [Approve] ──POST───────▶  apply { approvedPersonIds, excludeFaceIds } │
                          │  buildRepairPlan(approved exempt cap)   │
                          │  → executeRepair (existing)             │
                          └─────────────────────────────────────────┘
```

UI reference mockups (this branch, `docs/plans/`): `face-cleanup-console-mockup.html` (triage list) and
`face-cleanup-review-page-mockup.html` (per-person review page).

## Server design

### S-A. Scan job + persisted report

New fork table `face_repair_scan` (one row per scan; the console reads the latest):

| column                                   | type                                          | notes                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                     | uuid pk                                       |                                                                                                                                            |
| `status`                                 | enum `pending`/`running`/`completed`/`failed` |                                                                                                                                            |
| `requestedBy`                            | uuid → `user.id`                              | which admin started it                                                                                                                     |
| `params`                                 | jsonb                                         | thresholds used (maxDistance, voteWindow, voteMargin, maxAttributionDistance, maxFlaggedFraction, largeClusterThreshold, optional ownerId) |
| `totals`                                 | jsonb                                         | the existing `RepairReport.totals` shape                                                                                                   |
| `persons`                                | jsonb                                         | enriched per-person rows (below)                                                                                                           |
| `progress`                               | jsonb `{ scanned, total }`                    | for the poll                                                                                                                               |
| `error`                                  | text null                                     |                                                                                                                                            |
| `startedAt` / `finishedAt` / `createdAt` | timestamptz                                   |                                                                                                                                            |

Enriched person row (what the UI needs beyond the raw report):
`{ personId, ownerId, personName|null, faceCount, thumbnailFaceId, eligible, flagged, flaggedFraction,
suspectedOwners:[{ ownerPersonId, ownerName|null, thumbnailFaceId, count }], recommendation, reviewReasons[] }`.

New `FaceRepairScanRepository`: `createScan`, `updateScanProgress`, `completeScan(result)`, `failScan(error)`,
`getLatestScan`, `getScanById`. **Engine note:** the enrichment joins `person` for names + `faceAssetId`
thumbnails; the heavy work reuses `buildRepairPlan` → `searchFaces` (k-NN, works on Hagen's legacy pgvecto.rs)
and `executeRepair` (unassign/unlink). **No `avg(vector)` anywhere** → none of the #652 engine-compat
landmines apply here.

Fork migration in `server/src/schema/migrations-gallery/` with a round timestamp (e.g. `1780000000000`); see
CLAUDE.md migration layout. The migration is **reversible** (the `down` drops `face_repair_scan`) and the table
is added to the revert-to-immich cleanup (see `feedback_rebase_revert_script_update`).

**Lifecycle / retention:** the console only ever reads the latest scan, so `completeScan`/`failScan` **prune
superseded scan rows** (keep the most recent only) — the `persons` JSONB can be hundreds of KB, so the table
must not grow one fat row per scan forever.

**Concurrency:** at most one scan at a time. The trigger is idempotent via a fixed/derived job id _and_ a
DB guard (reject a new scan while a row is in `pending`/`running`), so two simultaneous `POST .../scan` calls
produce exactly one job, not two.

### S-B. Confidence classification (pure)

Pure function `classifyFlaggedPerson(person, ctx) -> { recommendation: 'confident' | 'review-first', reviewReasons: string[] }`
where `ctx = { reviewOnlyPersonIds: Set, largeClusterThreshold: number }`. Rules (a person is **review-first**
if _any_ hold; otherwise **confident**):

- `named` — `personName != null` (don't silently touch a human-named person).
- `large-cluster` — `faceCount > largeClusterThreshold` (default 50; Hagen's "future family members").
- `multiple-owners` — more than one distinct `suspectedOwners` entry (ambiguous destination).
- `bad-target` — any suspected owner is itself in `reviewOnlyPersonIds` (re-homing would pour faces into
  another corrupt cluster).

Lives in `src/utils/face-repair.ts` next to `decideReattribution`; pure → fully unit-testable.

### S-C. Batch apply by approved person IDs

Extend the repair path with `approvedPersonIds: string[]` and optional `excludeFaceIds: string[]`:

- In `buildRepairPlan`, a person in `approvedPersonIds` is **exempted from the over-cap gate** → its flagged
  faces flow to `toRepair` instead of `reviewOnly`. Everyone else stays `reviewOnly` (unapproved corruption is
  provably untouched — safer and more legible than a blanket `maxFlaggedFraction=1`).
- **`bad-target` is also lifted for an approved person.** Today a flagged face is held as `reviewOnly` when its
  _suspected owner_ is itself over-cap. For an approved person we move its flagged faces anyway, because the
  detector says those faces genuinely belong to that owner (the owner's own contamination is a separate, later
  cleanup). The admin saw the `bad-target` warning on the review page and chose to proceed. (Suggested operating
  order is still owners-first; see Open questions.) _Per the 2026-06-04 correction, the move now writes the
  suspected owner directly (manual identity link); a suspected owner that was deleted/merged since the scan is
  skipped, not written._
- **Apply is scoped to `approvedPersonIds`, never a full re-scan.** `executeRepair` re-votes only the approved
  persons' faces — extend `streamEligibleFaces` to accept a person-id _set_ (or loop per person). This keeps an
  apply cheap (thousands of faces, not the ~450k instance), and re-checks each face at write so a face moved by
  a concurrent job since the scan is skipped.
- `excludeFaceIds` (the per-face deselects from the review page) are dropped from `toRepair` before
  `executeRepair`.
- `executeRepair` (per the 2026-06-04 correction) re-attributes each flagged face **directly to its suspected
  owner** (`reattributeFaces` write-time re-check → `ensurePersonIdentity` → `replaceFaceIdentity(source:'manual')`
  → `reconcileRepresentativeFaces` for source + destination). No `FacialRecognition` re-queue. The existing
  "refuse while `FacialRecognition` active" guard stays, **plus a refusal while a scan is `running`** (apply
  mutates the faces the scan is snapshotting). Because the apply no longer enqueues onto the recognition queue, it
  no longer trips its _own_ guard on the next call.
- **Best-effort + idempotent + resumable.** `executeRepair` is not one transaction, so a mid-apply failure can
  leave some faces moved and others not. That is safe: the write-time re-check (a face is moved only if still on
  its source person) makes a re-apply skip already-moved faces and converge, and a per-route failure is logged
  without aborting the rest. The endpoint returns the real `{ moved, skipped }` so the UI reports what happened.
- **A suspected owner deleted/merged between scan and apply is skipped, never written** (existence is checked
  before the move), so a stale destination cannot corrupt the apply.

### S-D. API endpoints (admin-guarded)

- `POST /admin/face-repair/scan` → `{ scanId }`; enqueues `JobName.FaceRepairScan`. Refuses (409) if a scan is
  already `running` or if `FacialRecognition` is active.
- `GET /admin/face-repair/scan/latest` → the latest `face_repair_scan` (status + progress + report).
- `POST /admin/face-repair/apply` → `{ approvedPersonIds, excludeFaceIds? }`; runs the override apply, returns
  the `{ moved, skipped }` result. Refuses (409) if `FacialRecognition` is active **or a scan is
  `running`**.

All three are `@Authenticated({ admin: true })`; a non-admin gets 403 on each.

The existing `POST /admin/face-repair` (parameterized dry-run/apply) stays as-is — the per-person
`maxFlaggedFraction` override it already supports is the **immediate workaround** for Hagen (below).

## Web design (admin console)

Both pages live under `web/src/routes/admin/face-cleanup/`, admin-guarded, in Immich's light theme
(`#4250af` primary, `GoogleSans`, `rounded-2xl/3xl`, `@immich/ui` primitives). The mockups are the visual
contract.

### List / triage page (`/admin/face-cleanup`)

**Visual contract:** [`face-cleanup-console-mockup.html`](./face-cleanup-console-mockup.html) — the
implementation must match its layout, grouping, colour semantics, columns, and component styling (rebuilt with
`@immich/ui` primitives; the mockup is hand-rolled HTML, so reproduce the _look_, not the markup).

- Header with **Re-scan** + last-scan timestamp; a 5-stat strip (Eligible / Flagged / Auto-repaired ✓ /
  Needs decision / Unattributable).
- A table inside a rounded card, **grouped**: _Review these first_ (amber) pinned on top, then _Confident —
  auto-selected_. Columns: checkbox, Person (thumbnail + name/"Unnamed cluster"), Owner, Flagged (% + bar +
  fraction), → Suspected owner (thumbnail + name + count), Status chip + reasons, **Review** button.
- **Confident rows are pre-checked; review-first rows are not checkable until opened** (the guardrail).
  Selection bar shows the count and a one-click **Re-attribute selected** that calls `POST .../apply` with the
  checked `personId`s.
- Filters (All / Review first / Confident / Named), search, sort.
- While a scan is `running`, the page polls `GET .../scan/latest` and shows progress.

### Review page (`/admin/face-cleanup/{personId}`)

**Visual contract:** [`face-cleanup-review-page-mockup.html`](./face-cleanup-review-page-mockup.html) —
match its banner, decision strip, faces-leaving grid, per-face deselect treatment, and sticky action bar.

Opened from a _review-first_ row (confident rows never need it). Answers "what am I deciding and how":

- A plain-language banner: _"1,956 of Jula's 2,738 faces actually match Armin Falkner… Jula keeps her 782 real
  faces, name and thumbnail."_
- A **decision strip**: `✓ Stays — Jula Kulz (782)` ──→ `Moves to Armin Falkner (1,956)`, each with a ringed
  reference face.
- The **faces-leaving grid** (the flagged crops, paged/lazy-loaded), each checked with a `→ owner` tag;
  clicking a tile **deselects** that face (it stays with the person) and updates the live count. A
  Leaving/Staying toggle.
- A sticky action bar with the exact outcome (_"1,955 faces will move to Armin · she'll have 783 after"_) and
  **Move N faces** / **Cancel**. Approving posts `approvedPersonIds:[personId]` + the `excludeFaceIds` of any
  deselected tiles, then returns to the list.

## Slices (each is its own impl plan; build in dependency order)

| #   | Slice                                                                                                                                                                         | Depends on | Layer      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| 1   | **Scan persistence** — migration + `FaceRepairScanRepository` + enrich-and-store from a `RepairPlan`                                                                          | —          | server     |
| 2   | **Confidence classification** — pure `classifyFlaggedPerson` + thresholds                                                                                                     | —          | server     |
| 3   | **Scan job + read API** — `JobName.FaceRepairScan` handler (buildRepairPlan → classify → enrich → persist → progress); `POST .../scan`, `GET .../scan/latest`; refusal guards | 1, 2       | server     |
| 4   | **Batch apply** — `approvedPersonIds` + `excludeFaceIds` in plan/exec; `POST .../apply`                                                                                       | 1          | server     |
| 5   | **List/triage page** — scan trigger + poll, grouped table, auto-select + review-first guardrail, bulk-approve                                                                 | 3, 4       | web        |
| 6   | **Review page** — decision strip + faces-leaving grid + per-face deselect + apply                                                                                             | 4, 5       | web        |
| 7   | **E2E + docs** — Playwright admin happy-path; user docs for the console + documented `unAttributable` no-op                                                                   | 5, 6       | e2e / docs |

OpenAPI/SDK regeneration (`pnpm build` → `pnpm sync:open-api` → `make open-api`; build the SDK so web value
imports resolve) is a task **inside** Slices 3 and 4, not a separate slice.

## Testing — TDD is mandatory

Every slice is implemented **test-first (RED → GREEN → refactor)** using the project harnesses: `vitest` +
`newTestService` for server unit, the real-DB **medium** harness for repository/job behavior, `vitest` +
`@testing-library/svelte` for web, and Playwright for E2E. No slice is "done" until its listed cases are green
plus `make check-server` / `make lint-server` / `make check-web` (the web `check:svelte` script is a local
no-op — rely on server `tsc` + CI). Each slice's impl plan **writes its listed tests first, watches them fail
(red), then implements to green** — the lists below are the minimum bar, not the ceiling; add cases if
implementation reveals more, never remove. Happy path _and_ failure/boundary path are both required for every
new method.

### Slice 1 — Scan persistence (medium, real DB)

- create → `getLatestScan` returns it; multiple scans → latest by `createdAt`.
- `updateScanProgress` / `completeScan` / `failScan` transition `status` and set `finishedAt`/`error`.
- enrichment: a flagged person row carries `personName`, `faceCount`, `thumbnailFaceId`, and each
  `suspectedOwners` entry carries `ownerName` + `thumbnailFaceId`; **unnamed person → `personName: null`**
  (not empty string); **owner with no thumbnail → `thumbnailFaceId: null`** (no crash).
- **clean instance → an empty, well-formed report** (`persons: []`, zeroed `totals`), not null/throw.
- JSONB round-trips a 600+ person report without loss.
- **retention:** `completeScan`/`failScan` prune superseded rows — after N scans only the latest remains; a
  concurrent-trigger guard rejects a second scan while one is `pending`/`running`.
- **migration:** `up` creates `face_repair_scan`; `down` drops it (assert the migration is reversible).
- **Register `FaceRepairScanRepository` in `test/medium.factory.ts`** (`newRealRepository` switch) — omission
  throws "Unable to create repository instance for key".

### Slice 2 — Confidence classification (pure unit, exhaustive)

- single clean suspected owner, unnamed, small → **confident**.
- `named` person → review-first (reason `named`), even with one clean owner.
- `faceCount` at the boundary: `50` → confident, `51` → review-first (reason `large-cluster`).
- two distinct suspected owners → review-first (`multiple-owners`).
- suspected owner ∈ `reviewOnlyPersonIds` → review-first (`bad-target`).
- multiple reasons accumulate (named **and** large → both reasons present, deterministic order).
- zero-flagged person is never classified (excluded upstream — assert it is not present).
- threshold is read from `ctx`, not hard-coded (pass a custom `largeClusterThreshold` and assert it moves the
  boundary).

### Slice 3 — Scan job + read API (medium + service unit)

- job runs `buildRepairPlan`, classifies, persists, sets `status=completed` + final `progress`.
- progress advances during the stream (assert at least one intermediate `updateScanProgress`).
- `POST .../scan` returns a `scanId` and enqueues exactly one `FaceRepairScan` job.
- **concurrent triggers:** two near-simultaneous `POST .../scan` enqueue exactly **one** job (fixed job id +
  DB guard), not two.
- **refusal:** `POST .../scan` 409s when a scan is already `running`; 409s when `FacialRecognition` is active
  (mock `jobRepository.isActive`).
- a thrown error inside the handler → `status=failed` + `error` populated (no half-written report).
- a clean instance completes with an empty report (0 flagged), not a failure.
- `GET .../scan/latest` with **no scan yet → `null`/empty** (defined, not a 500), distinct from a completed
  empty report.
- admin guard: non-admin → 403 on **all three** routes (`scan`, `scan/latest`, `apply`).
- OpenAPI: regenerated spec + SDK include the new DTOs (CI `make open-api` diff clean).

### Slice 4 — Batch apply (medium + unit)

- approve one over-cap person → its flagged faces move to `toRepair` and are unassigned/unlinked/re-queued;
  **a non-approved over-cap person in the same scan stays `reviewOnly` (untouched).**
- `excludeFaceIds` drops exactly those faces from the move (approve person, exclude 1 face → `unassigned`
  count is `flagged − 1`; the excluded face keeps its `personId`).
- **re-check at write:** a flagged face concurrently moved off the person since the scan is skipped
  (`unassignFacesFromPerson` only touches still-`personId`+ML faces) — count reflects the skip.
- **bad-target lifted on approval:** approving person P whose suspected owner Q is over-cap and **not** approved
  still re-homes P's flagged faces (per S-C: the override moves the approved person's flagged faces regardless
  of the owner's state) — assert P's faces are unassigned/re-queued **and** that approving P writes nothing to
  Q (Q is only touched later by recognition's k-NN, not by the apply).
- idempotent re-apply: second apply of the same set unassigns 0 (faces already moved).
- **partial failure is resumable:** simulate a failure partway through a multi-person apply → already-moved
  persons stay moved, the error surfaces, and a re-apply completes the remainder (write-time re-check skips the
  done faces). One person failing does not abort the others.
- **stale suspected owner:** the suspected owner referenced by the report was deleted/merged since the scan →
  apply still unassigns + re-queues the approved person's faces without error (apply never writes to the owner).
- empty `approvedPersonIds` → no-op `{ moved: 0, skipped: 0 }`.
- **refusal** when `FacialRecognition` active **or a scan is `running`** → 409, nothing mutated.
- admin guard: non-admin → 403.

### Slice 5 — List/triage page (web, vitest + testing-library)

- renders grouped: review-first rows before confident rows regardless of scan order.
- confident rows render **pre-checked**; review-first checkboxes render **disabled** until that row is opened
  (simulate open → becomes enabled).
- selection count + "Re-attribute selected (N)" reflect checkbox state; **Clear** empties it.
- bulk-approve posts the checked `personId`s to `apply` (assert the request body; override the SDK/provider
  call rather than a one-shot mock).
- filters (All/Review first/Confident/Named) and sort change the visible set.
- scan `running` state renders progress and polls; `completed` renders the table; `failed` renders an error
  with a retry affordance.
- **no scan ever run** → a distinct "Run a scan to begin" empty state (not the same as a completed-but-empty
  report); **completed empty report (0 flagged)** → an explicit "nothing to clean up" state.
- **apply error handling:** a 409 from `apply` (recognition/scan became active) surfaces a non-destructive
  error and keeps the selection; the bulk-approve button is disabled while a request is in flight (no
  double-submit).

### Slice 6 — Review page (web)

- banner + decision strip render the person's and suspected owner's names/counts from the report.
- faces-leaving grid renders the flagged crops; clicking a tile toggles it to **excluded** and the live
  "will move" count decrements (and re-increments on re-click).
- the action bar's after-counts update with deselects (move `N − excluded`, person keeps `kept + excluded`).
- **Approve** posts `approvedPersonIds:[personId]` + the exact `excludeFaceIds`; **Cancel** navigates back
  without a request.
- **deselect every face → "Move 0" is disabled** (no empty apply); approve is also disabled while the request
  is in flight.
- **apply error (409)** surfaces non-destructively and keeps the deselect state.
- the flagged grid **lazy-loads / pages** (1,956 faces must not all render at once); the Leaving/Staying toggle
  switches the grid source.
- a person not in the latest report (stale deep link) → graceful "no longer flagged / re-scan" state.

### Slice 7 — E2E + docs

- Playwright (admin): trigger scan (seeded fixture) → list shows a review-first + a confident person →
  bulk-approve confident → open review-first → deselect one face → approve → both reflected; faces re-queued.
- docs page under `docs/docs/` for the console + an explicit note that `unAttributable` faces are a
  deliberate no-op; run docs prettier (CI Docs Build is strict).

## Implementation notes / gotchas

- **No engine-compat risk** (unlike the #652 guards): scan = `searchFaces` k-NN, apply = unassign/unlink. Do
  **not** introduce `avg(vector)`; it throws on Hagen's pgvecto.rs (`feedback_pgvecto_rs_no_avg_vector`).
- **medium repo registration:** every new repository (`FaceRepairScanRepository`) must be hand-registered in
  `test/medium.factory.ts`’s `newRealRepository` switch.
- **OpenAPI workflow:** after Slices 3/4, `pnpm build` → `pnpm sync:open-api` → `make open-api`; the web build
  needs the SDK built for value imports.
- **Migrations:** fork migration in `migrations-gallery/` with a round timestamp; the `postbuild` copy merges
  it into `dist/schema/migrations/`.
- **Web checks:** `check:svelte` reports 0/0 locally (no-op) — gate on server `tsc` + CI Lint/Test Web.
- **No modals required** (the review is a page) — avoids the bits-ui body-scroll-lock teardown gotcha; if any
  small confirm modal is added, add the 50ms `afterEach` drain.

## Immediate workaround (no new code) — give to Hagen now

The three confirmed named clusters can be fixed today on `face-repair-rc3` via the existing endpoint, per
person, with the queue drained:

```jsonc
// dry-run first — confirms toRepair jumps from 0 to the flagged count
POST /admin/face-repair { "dryRun": true,  "personId": "ab714816-…", "maxFlaggedFraction": 1 }
// then apply — re-homes the impostor faces to their true owner, keeps the real faces + name
POST /admin/face-repair { "dryRun": false, "personId": "ab714816-…", "maxFlaggedFraction": 1 }
```

This is exactly what Slice 4 productizes (per-person exemption from the over-cap gate) with review UI around
it.

## Open questions / risks

- **Scan cost:** a full-instance scan is `eligibleFaces × k-NN` (Hagen: ~450k). The background job removes the
  HTTP-timeout risk; confirm it co-exists with the "refuse while `FacialRecognition` active" guard so a scan
  and recognition never thrash the concurrency-1 queue (Slice 3 should likely run the scan on a non-blocking
  path or yield).
- **`bad-target` chains:** approving a person whose owner is also corrupt re-homes into corruption. The
  classifier surfaces this as review-first; the safe operating procedure is to clean the **owners first**
  (smallest `flaggedFraction` first). Document this ordering in the user docs (Slice 7).
- **Stale reports:** applying mutates the DB but the persisted scan is a snapshot; the list should mark
  applied persons and prompt a re-scan rather than imply the report is live.
