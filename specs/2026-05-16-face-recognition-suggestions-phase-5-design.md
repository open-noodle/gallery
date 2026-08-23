# Face Recognition Suggestions — Phase 5 (Shared Spaces) Design

> Source: continuation of `specs/2026-05-15-face-recognition-suggestions-design.md` (Phase 5).
> Status: DRAFT design for review. Phases 1–4 (personal) are shipped. This covers shared-space
> people only. Each sub-phase below gets its own `superpowers:writing-plans` plan.

## Problem

Phases 1–4 surface near-miss unassigned faces as suggestions on a **personal** named person's
page. In shared spaces, a "space person" is a projection of a face **identity** across the
space's members. A space person is named either directly or — critically — by **metadata
inheritance** (`inheritSpacePersonMetadata` writes the inherited name to
`shared_space_person`, never to other members' personal `person` rows).

The Phase 2 personal scan gate `getScannablePeopleWithUnassignedFaces`
(`person.repository.ts:759`) filters `WHERE person.name != ''` on the **personal `person`
table** and scopes candidates to `asset.ownerId = person.ownerId`. Therefore a space member
who sees the space person "Alice" (named via inheritance) but never named their own cluster
has `person.name = ''` (or no personal person at all) and is **structurally invisible** to
the personal scan. **Hard requirement (locked with the user): such members must still get
suggestions for the space person.** This rules out any "reuse personal suggestions at read
time" model — there is no `personId` to key those rows on, and the design's standing
constraint forbids request-time vector matching.

## Goals

- Space people (named directly **or by inheritance**, non-hidden, `type='person'`) surface
  near-miss unassigned faces as suggestions, **scoped to assets accessible within the
  space** (Q1: library-wide across the space's shared assets/linked libraries).
- **Owner/editor** members can Confirm/Dismiss; **viewers cannot** (and do not see the
  banner at all). Full presence **and** absence permission matrix.
- Confirm links the face into the space person's **identity** via the identity graph
  (`replaceFaceIdentity`, source `manual`) — never mutating another member's personal
  `asset_face` ownership.
- Reuse the Phase 4 web components verbatim (banner + review modal); only the data loaders
  and the mount point differ.
- **Zero regression** to Phases 1–4 personal behaviour and to the unchanged auto-assign /
  identity pipelines.

## Non-goals (YAGNI — explicitly out for Phase 5 v1)

- Cross-identity embedding enrichment (using _other_ members' assigned-face embeddings to
  widen the source sample). The space person's own linked faces (≤20 sample) are sufficient;
  noted as a future enhancement.
- A second trigger type. Space scans piggyback on the **existing** terminal of the
  post-recognition / identity-maintenance chain — no new upload hook, no per-name space
  trigger beyond what identity reconciliation already does.
- Per-space server-side snooze (client-side localStorage snooze from Phase 4 is reused,
  keyed by space person id).
- Mobile (Phase 6, documented only).
- Pets (`type='pet'` space people are never scanned, mirroring Phase 1–4).
- Surfacing suggestions to viewers in read-only mode. Viewers get nothing (simplest,
  avoids candidate-face exposure to non-actors).

## Decisions (locked with the user)

| Decision          | Choice                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate scope   | **Library-wide within the space** — unassigned faces in any asset shared into the space (`shared_space_asset`) or in a library linked to the space (`shared_space_library`).                                                                                                                                                                                                 |
| Who can act       | **Owner + Editor.** Viewer cannot confirm/dismiss and does not see the banner.                                                                                                                                                                                                                                                                                               |
| Confirm mechanism | **Identity graph** — resolve the space person's identity with `faceIdentityRepository.ensureSpacePersonIdentity(spacePersonId)` (lazily creates + back-links the identity if `shared_space_person.identityId IS NULL`), then `faceIdentityRepository.replaceFaceIdentity({ assetFaceId, identityId, source: 'manual' })`. Never personal `reassignFace` (cross-user-unsafe). |
| Storage           | **Single `person_face_suggestion` table + nullable `spacePersonId`** (the Phase-5 migration), CHECK exactly one of `personId`/`spacePersonId`. Necessary, not an optimisation: space-scan rows have no owning `personId`.                                                                                                                                                    |
| Scan unit         | **Dedicated `SpacePersonSuggestionScan` job** (+ chunked queue-all), separate from the personal `PersonSuggestionScan`. Not redundant — it covers the case the personal scan structurally cannot.                                                                                                                                                                            |
| Scannable gate    | `BTRIM(shared_space_person.name) <> ''` (**inherited names qualify** — this is what solves the dealbreaker; `BTRIM` for parity with the system-wide "is named" semantics — `shared_space_person` carries a `NULLIF(BTRIM(name),'')` index), `isHidden = false`, `type = 'person'`, the space has `faceRecognitionEnabled = true`, and `suggestionMaxDistance > maxDistance`. |
| Trigger           | Chained at the **existing terminal** of the identity-maintenance pipeline (`person.service.ts:656–661`), alongside the existing personal `PersonSuggestionScanQueueAll`, same `suggestionMaxDistance > maxDistance` gate.                                                                                                                                                    |

## Architecture

### Why a dedicated space scan (not the personal one, not read-time)

`getScannablePeopleWithUnassignedFaces` keys on personal `person.name` and
`asset.ownerId = person.ownerId`. Inheritance writes names to `shared_space_person`, not to
members' personal `person` rows, so the personal scan can never cover a member who relies on
inherited naming. Read-time computation is forbidden ("no request-time vector matching") and
has no `personId` to persist against. Therefore the space scan is **structurally required**,
not a duplicate. Bounded overlap (a member who _also_ named the person personally has their
own library scanned by both jobs) is acceptable — the two result sets surface on two
correctly-scoped pages (personal vs space).

### Schema (fork migration in `server/src/schema/migrations-gallery/`)

Migrate the existing `person_face_suggestion` table (added in Phase 1):

- Make `personId` **nullable** (was `NOT NULL`).
- Add `spacePersonId uuid` `@ForeignKeyColumn(() => SharedSpacePersonTable, { onDelete: 'CASCADE' })`, nullable.
- Add `@Check` constraint: exactly one of `personId` / `spacePersonId` is non-null
  (`num_nonnulls("personId", "spacePersonId") = 1`).
- Replace the unique `(personId, assetFaceId)` with **two partial unique indexes**:
  `UNIQUE (personId, assetFaceId) WHERE personId IS NOT NULL` and
  `UNIQUE (spacePersonId, assetFaceId) WHERE spacePersonId IS NOT NULL`.
- Add index `(spacePersonId, status, distance)` (space banner count + ordered queue read).
- Existing `(personId, status, distance)` and `(assetFaceId)` indexes unchanged.
- `migration_overrides` up/down row pair (mirroring the Phase-1 migration convention).
- The latest existing fork migration is `1778900000000` — that **is** the Phase-1
  `AddPersonFaceSuggestion` table itself. The Phase-5 migration timestamp must be a free
  round value **strictly greater** than `1778900000000` and greater than any newer rebased
  upstream migration; the plan must re-check at implementation time.

`resolveAssignedFace(assetFaceId)` stays a **single `DELETE WHERE assetFaceId = ? AND
status = 'pending'`** — it now clears personal _and_ space pending rows for an assigned face
in one statement (the single-table win; edges 12/28).

### Repository changes

- `searchFaces` (`search.repository.ts:901`) gains an optional `spaceId`. When set, it
  applies the **existing** space-accessible predicate (the OR-EXISTS over
  `shared_space_asset` + `shared_space_library` used by `applySuggestionScope`,
  `search.repository.ts:1183`) and **omits** the `userIds` owner filter (space scope fully
  bounds access). `hasPerson` tristate (Phase 1) is reused (`hasPerson:false` → unassigned).
- New `getSpacePersonAssignedFaceEmbeddings(spacePersonId, limit)` mirroring
  `personRepository.getAssignedFaceEmbeddings`, joining `shared_space_person_face →
face_search` (the join pattern already in `getSpacePersonsWithEmbeddings`,
  `shared-space.repository.ts:1934`), `LIMIT 20`.
- New `getScannableSpacePeopleWithUnassignedFaces()` streaming enumeration: `shared_space_person`
  where `BTRIM(name) <> ''`, `isHidden = false`, `type = 'person'`, the parent space has
  `faceRecognitionEnabled = true`, and there EXISTS an unassigned (`personId IS NULL`,
  `isVisible`, `deletedAt IS NULL`, `sourceType = ML`) `asset_face` in a space-accessible
  asset. Mirrors `getScannablePeopleWithUnassignedFaces` but space-scoped.
- `PersonFaceSuggestionRepository`: `upsertPending`, `markConfirmed`, `markDismissed`,
  `getPendingForPerson` gain space-keyed siblings (or a `target: {personId}|{spacePersonId}`
  discriminator) — same conditional-upsert / status-guard / band-read / read-gate logic as
  Phase 1, just keyed on `spacePersonId`. The read-gate additionally re-applies the
  space-accessible predicate so a since-un-shared asset's stale row is filtered at read time
  (edge 21).

### Scan jobs (mirror Phase 2 structure)

- `JobName.SpacePersonSuggestionScan { id }` on `QueueName.PeopleBackfill` (never the hot
  `FacialRecognition` queue): **no identity resolution at scan time** — an
  inheritance-named space person can have `identityId = NULL` (the identity is created
  lazily only at confirm); requiring it here would skip exactly the members this phase
  exists to serve. Fetch ≤20 sample embeddings via `getSpacePersonAssignedFaceEmbeddings`
  (keyed on `spacePersonId` → `shared_space_person_face → face_search`, no identity
  needed), for each call
  `searchFaces({ spaceId, embedding, hasPerson:false, maxDistance: suggestionMaxDistance,
numResults: K })`, keep only the open band `(maxDistance, suggestionMaxDistance]`, take
  the **min** distance per candidate across samples, conditionally `upsertPending` keyed by
  `spacePersonId`. Feature-disabled / non-scannable / zero-embeddings → no-op. Bounded
  (same `PERSON_SUGGESTION_EMBEDDING_SAMPLE` / `_NUM_RESULTS` caps as Phase 2).
- `JobName.SpacePersonSuggestionScanQueueAll`: chunked cursor fan-out (like Phase 2's
  `PersonSuggestionScanQueueAll` and `handleFaceIdentityBackfill`) over
  `getScannableSpacePeopleWithUnassignedFaces`, one `SpacePersonSuggestionScan` per space
  person.
- **Trigger**: at the identity-maintenance terminal (`person.service.ts:656–661`), after
  `queueSpacePersonMetadataBackfill()` and alongside the existing
  `PersonSuggestionScanQueueAll`, guarded by the same `suggestionMaxDistance > maxDistance`
  check. One terminal, two independent queue-all jobs (personal + space).

### HTTP API (`shared-space.controller.ts` + DTOs)

Mirror the Phase 3 personal endpoints, on the shared-space person route prefix:

- `GET  /shared-spaces/:id/people/:personId/face-suggestions?page=&size=` → `{ total,
items: [{ assetFaceId, assetId, distance, imageWidth, imageHeight, boundingBox*,
fileCreatedAt? }] }`.
- `POST /shared-spaces/:id/people/:personId/face-suggestions/:assetFaceId/confirm` → 200 (idempotent).
- `POST /shared-spaces/:id/people/:personId/face-suggestions/:assetFaceId/dismiss` → 200 (idempotent).

**RBAC** (the dominant cost — full presence/absence matrix):

| Endpoint        | Coarse `@Authenticated` | Service-side role gate                                                                                                           | Viewer |
| --------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| GET suggestions | `SharedSpaceRead`       | role ≥ Editor (`ROLE_HIERARCHY`) **else `{ total:0, items:[] }`** (read-gate, mirrors Phase 1 — client never re-implements RBAC) | empty  |
| confirm         | `SharedSpaceUpdate`     | role ≥ Editor; else 403 (absence-tested)                                                                                         | denied |
| dismiss         | `SharedSpaceUpdate`     | role ≥ Editor; else 403 (absence-tested)                                                                                         | denied |

Confirm flow (the crux):

```
POST …/people/:personId/face-suggestions/:assetFaceId/confirm
  → requireAccess(SharedSpaceUpdate, [spaceId])  + member role ≥ Editor   (else 403; edge 24)
  → identityId = ensureSpacePersonIdentity(spacePersonId)   # lazily creates + back-links
                                                            #   identity if it was NULL (edge 31)
  → n = markConfirmed(spacePersonId, assetFaceId)   # WHERE status='pending'
  → if n === 0: return 200                          # idempotent (already resolved / vanished)
  → faceIdentityRepository.replaceFaceIdentity({ assetFaceId, identityId, source:'manual' })
        # cross-user-safe: adds/overwrites the identity link only; the asset_face row's
        # owner + personId are NOT mutated (the asset may belong to another member).
        # ON CONFLICT (assetFaceId) DO UPDATE → last-writer-wins: if the face already had
        # a face_identity_face link (any source, incl. 'manual'), it is overwritten with
        # this space person's identity + source='manual' (intended; edge 32).
  → resolveAssignedFace(assetFaceId)                # clears every other pending row
                                                    #   (personal + all space persons) — edges 12/28
  → 200 (void)
```

`markConfirmed` runs **before** `replaceFaceIdentity` so the embedded `resolveAssignedFace`
(pending-only delete) cannot wipe the row being confirmed (same ordering rule as Phase 3).

Dismiss: `markDismissed(spacePersonId, assetFaceId)` (status-guarded). Face stays
unassigned; the Phase-1 conditional upsert never resurrects it for this space person; other
space persons / personal persons are unaffected (separate rows).

OpenAPI: regenerate TS SDK + Dart client + `make sql` (memories
`feedback_openapi_dart_and_sql`, `feedback_ci_generated_files`). Neutral commit wording —
access scoping, not framed as a security fix (`feedback_no_security_in_commits`).

### Web UI

Reuse the Phase 4 components **verbatim** — `PersonSuggestionBanner.svelte`,
`PersonSuggestionReviewModal.svelte`, `FaceCrop.svelte`, the localStorage snooze util
(keyed by the space person id), `getFaceCropTransform`.

- Mount the banner on the shared-space person detail page
  `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`,
  in the person-header region (structurally the same as the personal page).
- Loaders point to the new space SDK functions; `referenceThumbnailUrl` uses the existing
  space-person thumbnail URL (`/shared-spaces/:spaceId/people/:id/thumbnail`, the
  `getScopedThumbnailUrl` pattern already in the personal page), **not**
  `getPeopleThumbnailUrl` (memory `feedback_people_thumbnail_url` — the space person is not
  a `PersonResponseDto`).
- Viewer gets `{ total: 0 }` from the read-gate → banner self-hides; the client does not
  re-implement RBAC (mirrors Phase 4's reliance on the server read-gate for edges 7/13/18).
- The personal `+page.svelte` already skips space-scoped persons in its Phase-4 loader
  (`isSpaceScopedPerson`), so there is no double banner; re-verify this guard holds.

### Edge cases (each gets a test; Phase 1–4 edges 1–19 still hold)

20. Member removed from space between scan and review → `requireAccess` fails → benign 403 /
    read-gate empty; client benign-advances.
21. Asset un-shared from the space (or library unlinked) after the scan → read-time
    space-accessible re-filter drops the row; client benign-advances. Not regenerated.
22. Space person merged into another (`mergeSpacePeople` → `mergeIdentities`) → moved faces'
    pending suggestions resolved; the surviving space person re-scanned by the maintenance
    chain.
23. Space person un-named — direct name cleared, inherited name lost when the source
    profile is un-named, **or name becomes whitespace-only** → read-gate excludes
    (`BTRIM(name)=''`, matching the system-wide "is named" semantics); no new scans;
    existing rows untouched (no destructive cleanup).
24. Viewer requests GET/confirm/dismiss → GET empty, confirm/dismiss 403 — **absence
    asserted for every path**.
25. Space `faceRecognitionEnabled = false` → no scan, read-gate empty, no banner.
26. Confirm a candidate owned by another member → identity link added; that member's
    `asset_face.personId` / ownership **unchanged** (assert the other member's personal data
    is untouched).
27. Pet space person (`type='pet'`) → never scanned.
28. Same candidate face suggested for a personal person _and_ a space person (or two space
    persons) → confirming one links the face to its identity; `resolveAssignedFace` clears
    all other pending rows for that face in the single `DELETE` (personal + space).
29. `suggestionMaxDistance ≤ maxDistance` → space read-gate empty even if rows exist;
    no generation.
30. Space person has zero linked faces / no embeddings → scan no-op.
31. Inheritance-named space person with `identityId = NULL` at confirm →
    `ensureSpacePersonIdentity` creates the identity and back-links it before
    `replaceFaceIdentity`. Assert: confirm succeeds, `shared_space_person.identityId` is
    populated, the face's `face_identity_face` row points at the new identity.
32. Candidate face already linked to a different identity (near-miss to two space persons
    in different spaces, confirmed elsewhere first) → `replaceFaceIdentity`'s `ON CONFLICT
(assetFaceId) DO UPDATE` overwrites the link (last-writer-wins). Assert: the surviving
    link is the just-confirmed identity, and the other space person's pending row is
    cleared by `resolveAssignedFace`.

## Sub-phase split (each a separate `writing-plans` plan)

Phase 5 is materially heavier than 1–4 (RBAC matrix + identity graph). Split:

- **Phase 5a — schema + scan + repository** (no API/UI): the migration (nullable `personId`
  - `spacePersonId` + CHECK + indexes + `migration_overrides`); `searchFaces` `spaceId`
    scope; `getSpacePersonAssignedFaceEmbeddings`; `getScannableSpacePeopleWithUnassignedFaces`;
    space-keyed repository methods; `SpacePersonSuggestionScan` + queue-all chained at the
    identity-maintenance terminal; **the merge→resolve wiring** (`mergeSpacePeople` /
    `mergeIdentities` resolving moved faces' pending rows lives in the repository layer here,
    not 5b). **Exit**: space suggestions generate automatically; no API/UI. Edges 21
    (read-filter), 27, 29, 30 + Phase-1/2 regression.
- **Phase 5b — HTTP API + RBAC matrix + identity-graph confirm**: the three endpoints,
  DTOs, the owner/editor/viewer presence-and-absence matrix, confirm via
  `ensureSpacePersonIdentity` + `replaceFaceIdentity` + `resolveAssignedFace`, idempotency,
  OpenAPI (TS + Dart) + `make sql`. **Exit**: documented space API with full permission
  matrix. Edges 20, 22 (test only — merge→resolve wiring is in 5a), 24, 26, 28, 31, 32.
- **Phase 5c — web UI + E2E**: mount the reused Phase-4 banner/modal on the space person
  page, snooze keyed by space person id, **an explicit task to re-verify the personal
  `+page.svelte` `isSpaceScopedPerson` guard still suppresses the personal banner for
  space-scoped persons** (no double banner), Playwright E2E with seeded rows + a
  viewer-denied path. **Exit**: end-to-end usable in a browser; verified in a running
  browser (golden path + viewer-denied + edges 21/23/25). Edges 23, 25 (UI side).

## Effort summary

- 5a/5b are the bulk (identity graph + permission matrix). 5b's presence/absence matrix is
  the single largest cost, as flagged in the original design.
- 5c is small — the Phase-4 components are reused unchanged; only loaders + mount + gating.
- Recommended sequencing: 5a → 5b → 5c, mirroring the 1→2→3→4 rollout. Personal (Phases
  1–4) is unaffected throughout.
