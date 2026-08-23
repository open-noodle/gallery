# Face Cleanup Console — persistent "decline" for reviewed-but-not-accepted faces — design

**Status:** approved (brainstorm 2026-06-05); ready for slice-by-slice implementation
**Branch / PR:** `feat/face-cleanup-console` (#664) — committed and shipped on the same branch as the console.
**Prereq:** the Face Cleanup Console and its engine
([`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md),
`FaceRepairService.buildRepairPlan` / `runScan` / `applyRepair`) are already on this branch. This feature is a
persistence layer that the scan/review/apply paths consult.

## Motivation

Today an admin can **accept** a flagged face (move it to its suspected owner) but there is no way to **decline**
one. The flag set is recomputed from face embeddings on every scan — both the dashboard scan
(`runScan` → `buildRepairPlan`) and the per-person review list (`getPersonFlaggedFaces` → `buildRepairPlan`).
No review decision is an input to that computation. The review screen's "exclude from this move" is an in-memory
`SvelteSet` (`review.svelte.ts`) that evaporates on apply/navigation, and not approving a person simply leaves it
in the snapshot. Eligibility is `asset_face.sourceType = MachineLearning` and a declined-but-not-moved face keeps
that sourceType **and** keeps its embedding voting for the "wrong" owner — so **every future scan re-flags it.**
There is no memory that a human already looked and said "leave it."

The result: an admin who works through a large review queue and decides some faces/clusters are actually correct
has no way to record that, and is forced to re-triage the same faces on every scan. We add a persistent
**decline** so a reviewed face/person stays off the board until the evidence materially changes.

## Requirements (locked in brainstorm)

1. **Two granularities.** Decline an individual flagged **face**, and dismiss an entire flagged **person**
   (cluster).
2. **Console-only mute.** A decline is recorded in a new cleanup-console table and the scan/review/apply paths
   filter it out. Identity and recognition are **untouched** — this is not a "confirm attribution / pin manual
   identity" action; it has no recognition side effects.
3. **Evidence-keyed re-surface.** A mute is keyed to the suspected owner(s) at decline time. If a later scan
   suspects a **different** owner (genuinely new evidence), the face/person re-surfaces; otherwise it stays
   muted. It does not expire on a timer.
4. **Decline is distinct from exclude.** The review screen keeps its transient "exclude from this move" gesture
   _and_ gains an explicit, separately-styled **Decline** ("stop flagging — until evidence changes"). They are
   two different actions.
5. **Manageable / reversible.** Declines are listable and can be undone (a dedicated `/declined` route).

## Storage model (chosen: "Option B")

A single fork table `face_repair_decline` with two row kinds discriminated by a `type` column.

> **Rejected alternative — store declines in the scan snapshot.** `face_repair_scan.persons` is a point-in-time
> snapshot and is pruned (`pruneSupersededScans`); declines must outlive scans, so they need their own table.
>
> **Rejected alternative — face rows only, person-dismiss expands to one row per flagged face.** Uniform single
> filter rule, but a dismissed over-cap cluster (thousands of flagged faces) writes thousands of rows, and the
> person re-surfaces if _any one_ new face is flagged even toward an already-suspected owner. Too noisy for the
> large clusters this console exists to handle.

### Table: `face_repair_decline`

Defined in `server/src/schema/tables/face-repair-decline.table.ts`, created by fork migration
`server/src/schema/migrations-gallery/1781000000000-AddFaceRepairDecline.ts`, registered in
`server/src/schema/index.ts`, and dropped in `scripts/revert-to-immich.sql`.

| column              | type                                    | notes                                              |
| ------------------- | --------------------------------------- | -------------------------------------------------- |
| `id`                | uuid v7 PK                              | `PrimaryGeneratedUuidV7Column`                     |
| `type`              | `character varying`                     | `'face'` or `'person'`                             |
| `assetFaceId`       | uuid FK→`asset_face`, **CASCADE**, null | set for face rows                                  |
| `suspectedOwnerId`  | uuid FK→`person`, **CASCADE**, null     | face row evidence key                              |
| `personId`          | uuid FK→`person`, **CASCADE**, null     | set for person rows                                |
| `suspectedOwnerIds` | `jsonb`, null                           | person row fingerprint — the suspected-owner _set_ |
| `declinedBy`        | uuid FK→`user`, SET NULL, null          | who declined                                       |
| `createdAt`         | `timestamp with time zone`              | default now                                        |

Indexes:

- Partial-unique `(assetFaceId, suspectedOwnerId)` `WHERE "assetFaceId" IS NOT NULL` — declines are idempotent.
- Index on `personId` — person-row lookups.
- Index on `assetFaceId` — the filter join.

The `ON DELETE CASCADE` FKs (`assetFaceId`, `suspectedOwnerId`, `personId`) mean a deleted/merged face, person,
or suspected owner auto-removes its decline rows — no orphans. `suspectedOwnerIds` (person-row fingerprint) is a
plain `jsonb` set with no FK; if one of its members is later deleted, the current scan's suspected set changes
and the subset comparison (below) naturally re-evaluates.

## Scan / review / apply integration (the filter)

The filter lives in the single chokepoint `FaceRepairService.buildRepairPlan`, which is used by the dashboard
scan, the per-person review list, **and** `applyRepair`. Routing it there keeps all three consistent: a declined
face is never shown **and** never moved.

A new repository `FaceRepairDeclineRepository` loads declines (scoped to the owner / persons being planned) into
two in-memory maps:

- `declinedFaceOwners: Map<assetFaceId, Set<suspectedOwnerId>>` (from `type='face'` rows)
- `dismissedPersons: Map<personId, Set<suspectedOwnerId>>` (from `type='person'` rows)

Applied in this order while building the plan:

1. **Face-level.** When a face would be flagged toward suspected owner `S`, if
   `declinedFaceOwners.get(assetFaceId)?.has(S)` → treat as **not flagged** (it is still counted as _eligible_).
   A later scan suspecting a different owner does not match → it re-flags.
2. **Person-level.** After aggregating each person's _remaining_ flagged faces, compute its current
   suspected-owner set. If the person has a dismiss row **and** that set ⊆ the stored `suspectedOwnerIds`
   fingerprint → drop all of the person's flagged faces. A brand-new suspected owner makes the current set a
   non-subset → the person re-surfaces.

Face-level is applied **before** person-level so that a face re-flagged toward a _new_ owner keeps its person on
the board even if the person was previously dismissed.

**Edge rule — decline beats approve.** A face-level decline is honored even if its person is in
`approvedPersonIds` for a bulk apply (the face is removed from the flagged set before the approved-exemption
runs), so an explicit "leave this one" is never silently overridden by a person-level approve.

**Eligible counts are unchanged.** Declines remove faces from the _flagged_ set only; `eligible` counts and
`flaggedFraction` denominators still reflect the true ML-face population.

## API

All endpoints are admin-only (`@Authenticated({ admin: true })`) on the existing
`FaceRepairAdminController` (`admin/face-repair`). DTOs in `server/src/dtos/face-repair.dto.ts`.

- **`POST admin/face-repair/decline`** — body
  `{ faces?: [{ assetFaceId, suspectedOwnerId }], persons?: [{ personId, suspectedOwnerIds }] }` →
  `{ created: number }`. The client already holds `suspectedOwnerId` per flagged face (from
  `getPersonFlaggedFaces`) and `suspectedOwners` per person (from the scan), so it supplies the evidence keys
  directly. Idempotent on the partial-unique index (re-declining the same face/owner is a no-op).
- **`GET admin/face-repair/decline`** — an enriched list for the management view: person/owner display names and
  representative-face thumbnail ids, joined **live** from the `person` table (mirroring `withCurrentNames`, since
  people get renamed after a decline).
- **`DELETE admin/face-repair/decline`** — body `{ ids: string[] }` → `{ removed: number }` (undo).

After the controller/DTO change: `pnpm -C server sync:open-api` then `make open-api` to regenerate the TypeScript
SDK and the Dart client.

## Web UI

- **Review screen** (`web/src/routes/admin/face-cleanup/[personId]/+page.svelte`, `review.svelte.ts`): each face
  tile keeps its transient **exclude** checkbox and gains a distinct, differently-styled **Decline** button
  ("stop flagging — until evidence changes"). Decline `POST`s that face's `{ assetFaceId, suspectedOwnerId }` and
  removes it from the list. `review.svelte.ts` stays a pure UI-state model; the page wires the API call.
- **Dashboard** (`web/src/routes/admin/face-cleanup/FaceCleanupTable.svelte`): each person row gains a
  **Dismiss** action → `POST`s `{ personId, suspectedOwnerIds }` (from the row's `suspectedOwners`) and removes
  the row.
- **Management / undo** — a new route `web/src/routes/admin/face-cleanup/declined/` listing declined faces and
  persons with thumbnails and an **Undo** (`DELETE`) action. New `web/src/lib/route.ts` entry
  (`faceCleanupDeclined`). New i18n keys in `i18n/en.json` for decline / dismiss / declined / undo copy.

## Testing

- **Server unit** (`server/src/services/face-repair.*.spec.ts` / new): the filter logic — a declined face is not
  flagged; a person dismiss with the current suspected set ⊆ fingerprint drops the person; a _new_ suspected
  owner re-surfaces it; face-level runs before person-level; decline beats approve.
- **Server medium** (`server/test/medium/specs/repositories/face-repair-decline.repository.spec.ts` + service
  specs): decline repo CRUD; `runScan` / `getPersonFlaggedFaces` / `applyRepair` all honor declines; re-surface
  on changed evidence; CASCADE cleanup when a face/person/suspected-owner is deleted.
- **Web unit:** the review-screen decline action, the dashboard dismiss action, the declined-list undo.
- **e2e** (`e2e/src/specs/web/face-cleanup.e2e-spec.ts`): decline a face → re-scan → it is gone; change the
  evidence (different suspected owner) → it reappears.
- **Fork CI lesson:** run `make check-server lint-server check-web` and the OpenAPI regen before pushing —
  `vitest` alone skips `tsc`, lint, and the web suite.

## Repository wiring (known fork footguns)

- Register `FaceRepairDeclineRepository` in `server/src/repositories/index.ts`.
- Add it to **both** the `BaseService` constructor **and** its positional `create()` list
  (`server/src/services/base.service.ts`) — a repo added to the ctor but not the `create()` list silently
  becomes `undefined` in plugin-host services.
- Register it in the `newRealRepository` switch in `server/test/medium.factory.ts` (simple DB repo →
  `new key(db)` block).

## Out of scope

- No "confirm attribution / pin manual identity" behavior — declines never write identity links or touch
  recognition (explicitly chosen: console-only mute).
- No timed expiry / snooze of declines.
- No bulk "decline all flagged faces" beyond the per-person dismiss.
