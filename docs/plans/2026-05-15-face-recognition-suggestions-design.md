# Face Recognition Suggestion & Confirmation Workflow — Design

> Source: GitHub discussion [#580](https://github.com/open-noodle/gallery/discussions/580).
> Status: APPROVED design. Each phase below gets its own implementation plan via
> `superpowers:writing-plans`. Reviewed twice via `superpowers:code-reviewer`.

## Problem

The Facial Recognition job auto-assigns an unassigned face to a person only when the embedding
distance to an existing person is within `machineLearning.facialRecognition.maxDistance` **and**
the cluster meets `minFaces`. Faces that are _similar but not confident enough_ are left
unassigned forever. For large libraries this is the dominant pain point: there is no way to say
"yes, that near-miss face is Anna" short of manually digging through unassigned faces. Mature
tools (Lightroom, QuMagie, Apple/Google Photos, digiKam) solve this with a per-person
**suggestion → confirm/dismiss** workflow.

## Goals

- Surface near-miss unassigned faces as **suggestions on the named person's detail page**.
- One-at-a-time guided review with **full-photo context** (per QuMagie reference UX).
- **Confirm** assigns the face to the person; **Dismiss** suppresses that suggestion forever.
- **Works for existing libraries** (the common flow is import → auto-cluster → _name later_).
- **Fully automatic generation** — the user uploads photos and does nothing else.
- **Zero regression**: no face changes its assignment because of this feature; with the
  feature disabled the recognition path is byte-for-byte unchanged.

## Non-goals (YAGNI — explicitly out for v1)

- Gamification / review score / progress leaderboard (floated in the discussion — deferred).
- Bulk confirm/dismiss or a grid mode (chosen UX is guided one-at-a-time — user-confirmed).
- Pre-clustering unassigned faces into groups (per-face ranked is sufficient).
- Mobile UI (Flutter) — Phase 6, documented only; the server API is client-agnostic.
- "Create a separate person" from Dismiss — v1 Dismiss = ignore; the face stays unassigned.
- ML model retraining. Recognition is embedding kNN; a confirmed face automatically improves
  future matching because it joins the person's face set / identity. "Feed back into the
  model" from the discussion means exactly this — no retraining exists or is needed.
- Server-side persisted snooze. "Not now" is a soft UX nicety stored client-side
  (localStorage); a server-side per-person snooze is a future addition if needed.
- Manual "rescan" button/endpoint. Generation is fully automatic; can be added later.
- **Pets.** `person.type` can be `pet`; v1 scans `type = 'person'` named identities only.
  Pet suggestions are out of scope (noted so the scan query filters `type='person'`).

## Decisions (locked with the user)

| Decision                    | Choice                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Relationship to auto-assign | **Additive band.** `[0, maxDistance]` auto-assign (unchanged); `(maxDistance, suggestionMaxDistance]` becomes a suggestion; beyond that ignored. |
| Suggestion unit             | **Per-face, one at a time**, ranked best-match-first.                                                                                            |
| UX                          | QuMagie model: per-person banner → focused review modal with full photo.                                                                         |
| Platforms                   | Web only for v1 (Phases 1–4); mobile documented only (Phase 6).                                                                                  |
| Scope                       | Phased; personal (Phases 1–4) ships independently of shared-space (Phase 5).                                                                     |
| Generation                  | Dedicated **scan jobs** persist suggestions (no request-time vector matching — mandated by the global-face-identities design).                   |
| Triggers                    | Fully automatic: (1) chained after the existing post-recognition maintenance; (2) single-person scan on naming. No user-facing button.           |

## Development methodology (mandatory)

Mirrors the global-face-identities plans' Safety Notes:

- **Strict TDD.** Every task starts with a failing test, verifies the _expected_ failure
  message, then adds the smallest code to make it pass. No production code without a
  red test first.
- **Commit after each task.** Schema, repository, jobs, API, and web are independently
  reviewable commits.
- **Permission tests assert presence _and_ absence.** A passing positive case is not enough;
  every access-controlled path must also prove the unauthorized case is denied/empty.
- **No request-time vector matching.** All embedding comparison happens in jobs.
- **No flake allowance.** Fix flakes at root cause; never add retry-if-flaky (cf. memory
  `feedback_no_flake_allowance`).
- **Each phase below is a separate plan.** Do not start a phase's plan until the prior
  phase's exit criteria are met and merged. Phase 5 may be split again when its plan is
  written.

## Architecture

### Why a scan job, not an inline recognition hook

The self-review established that `handleRecognizeFaces` (`server/src/services/person.service.ts:905`)
has **no single point** where "the face is left unassigned": a genuine near-miss face has 0–1
matches within `maxDistance`, so it exits early via the `matchedOnlySelf` skip
(`person.service.ts:972-977`) or the non-core defer (`982-993`) **before** any post-assign
hook. Worse, recognition only ever runs on _new or changed_ faces — for the common workflow
(import → auto-cluster → name a cluster later) it would never revisit a person's historical
near-miss faces, so the feature would produce almost no suggestions for existing libraries.

Both problems are solved by generating suggestions in a **dedicated per-person scan job**
(`JobName.PersonSuggestionScan`, data `{ personId }`) instead of touching the hot, multi-exit
recognition function:

- **Required repository change**: `searchFaces` currently treats `hasPerson` as
  `.$if(!!hasPerson, …personId IS NOT NULL)` (`search.repository.ts:922`), so `hasPerson:false`
  returns _all_ faces, not unassigned ones. Make `hasPerson` tri-state — `true` → `personId
IS NOT NULL` (unchanged for existing callers, which all pass `true` or omit it), `false` →
  `personId IS NULL`, `undefined` → no filter.
- **Required repository method (new)**: no method returns a person's assigned-face
  embeddings. Add `personRepository.getAssignedFaceEmbeddings(personId, limit)` joining
  `asset_face → face_search` where `personId = ?`, `isVisible`, `deletedAt IS NULL`,
  `LIMIT 20`.
- **Direction**: for a _named, non-hidden, `type='person'`_ person, take that person's
  assigned-face embeddings (representative + ≤20 sample) and for each call
  `searchRepository.searchFaces({ userIds:[ownerId], embedding, hasPerson:false, maxDistance: suggestionMaxDistance, numResults: K })`
  to find the owner's **unassigned** faces near the person. `searchFaces` returns
  `{ id, personId, distance }` (`search.repository.ts:199-203`).
- The band is enforced **service-side**: `searchFaces` only applies an upper bound, so call
  it with `suggestionMaxDistance` then keep only candidates with `distance > maxDistance` →
  the open band `(maxDistance, suggestionMaxDistance]`. Take the **minimum** distance per
  candidate across the sampled source embeddings.
- Conditionally upsert `pending` rows (see "Regeneration safety").

`PersonSuggestionScan` runs on `QueueName.PeopleBackfill` (where `FaceIdentityBackfill`
lives) — **never** on the hot `FacialRecognition` queue.

### Triggers — both fully automatic, no user-facing button

1. **Primary — after FacialRecognition _and_ PeopleIdentityMaintenance complete.**
   Recognition then identity maintenance (`FaceIdentityBackfill`) both change which faces are
   assigned to whom, so suggestions must be computed against the _post-maintenance_ state.
   `handleFaceIdentityMaintenanceAfterRecognition` (`person.service.ts:871-902`) is only a
   queue-drain gate that enqueues one `FaceIdentityBackfill`. Add a **new chunked queue-all
   job** `PersonSuggestionScanQueueAll`, chained to run **after `FaceIdentityBackfill`
   completes**, following the cursor/chunk pattern of `handleFaceIdentityBackfill`
   (`person.service.ts:510-554`, `FACE_IDENTITY_BACKFILL_CHUNK_SIZE`). It enumerates only
   named, non-hidden, `type='person'` people that have unassigned faces in scope and enqueues
   one bounded `PersonSuggestionScan` per person.
2. **Secondary — person named/renamed (single person, automatic).** On a stable library no
   new photos arrive, so the FR+PIM cycle may not run for a long time; a user who names many
   clusters expects suggestions promptly. `PersonService.update` also enqueues a
   **single-person** `PersonSuggestionScan` when the person transitions into a scannable
   state — `name !== '' && !isHidden && type='person'` **and** (the name changed or it was
   previously unnamed). Requires a pre-update read of the prior row
   (`person.service.ts:419-457` currently doesn't read it); the gate avoids firing on
   color/birthDate/favorite/visibility edits and excludes unnamed-cluster and hidden persons.

### End-to-end automatic chain on upload (no new upload hook needed)

Trigger 1 hangs off the tail of the pipeline an upload _already_ starts:

```
upload → AssetDetectFaces (per asset, person.service.ts:665)
       → FacialRecognition (queued per detected face, :741)
       → [#589] FaceIdentityMaintenanceAfterRecognition (auto-queued on FR drain, :871)
       → FaceIdentityBackfill  (PeopleIdentityMaintenance)
       → PersonSuggestionScanQueueAll  ← new, chained after backfill completes
       → PersonSuggestionScan per named person → pending suggestion rows
```

We intercept _nothing_ at upload time; we only append one job to the end of an existing
auto-running chain.

### Regeneration safety (the "never reappear" guarantee)

The scan upserts on the unique key `(personId, assetFaceId)` with a **conditional** statement
that never resurrects a resolved decision:

```sql
INSERT INTO person_face_suggestion (personId, assetFaceId, distance, status)
VALUES (..., 'pending')
ON CONFLICT (personId, assetFaceId) DO UPDATE
  SET distance = EXCLUDED.distance, updatedAt = now()
  WHERE person_face_suggestion.status = 'pending';
```

New pairs insert `pending`. Still-`pending` pairs only get `distance` refreshed.
`confirmed`/`dismissed` rows hit the conflict, fail the `WHERE`, and are left untouched. (SQL
illustrative; implemented via Kysely — actual column identifiers are quoted camelCase.)

### Schema (fork migration in `server/src/schema/migrations-gallery/`)

One table, `server/src/schema/tables/person-face-suggestion.table.ts`:

| Column                                                                                                          | Type                                                                                             | Notes                                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                                            | uuid PK (`PrimaryGeneratedUuidV7Column`)                                                         |                                                                                                                |
| `personId`                                                                                                      | uuid `@ForeignKeyColumn(() => PersonTable, { onDelete: 'CASCADE' })`                             | candidate named person                                                                                         |
| `assetFaceId`                                                                                                   | uuid `@ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE' })`                          | the unassigned face                                                                                            |
| `distance`                                                                                                      | double precision                                                                                 | embedding distance, best-match ordering                                                                        |
| `status`                                                                                                        | `character varying` + **`@Check`** `IN ('pending','confirmed','dismissed')`, default `'pending'` | follows `face-identity-face.table.ts:20-23`; **not** a Postgres enum, **not** the upstream `enums.ts` registry |
| `createdAt` `@CreateDateColumn`, `updatedAt` `@UpdateDateColumn`, `updateId` `@UpdateIdColumn({ index: true })` | audit                                                                                            |                                                                                                                |

Also required (mirroring `1778700000000-AddSharedSpaceFaceMatchBackfillTarget.ts`):

- `@UpdatedAtTrigger('person_face_suggestion_updatedAt')`; migration `up()` inserts the
  matching `migration_overrides` row, `down()` deletes it.
- Unique `(personId, assetFaceId)` (upsert target).
- Index `(personId, status, distance)` — banner count + ordered queue read.
- Index `(assetFaceId)` — drives the "resolve all suggestions for this face when it is
  assigned elsewhere" `UPDATE`/`DELETE` (FK `CASCADE` already covers face _deletion_).
- Registration in `server/src/schema/index.ts`: the `tables = [...]` array **and** the
  `DB` interface map. A named domain type in `server/src/database.ts` is **optional** — add
  `export type PersonFaceSuggestion = Selectable<PersonFaceSuggestionTable>` only if
  service/repository code wants a named type (as `Album`/`Workflow` do); `face_identity` has
  no `database.ts` entry, so it is not mandatory.
- `down()` drops trigger, indexes, table, and the `migration_overrides` row.
- Round migration timestamp `1778800000000` (free; latest existing is `1778700000000`).

Snooze is **client-side localStorage** (keyed by personId) — no second table.

### Config

Add `machineLearning.facialRecognition.suggestionMaxDistance: number` to `server/src/config.ts`
and `FacialRecognitionConfigSchema` in `server/src/dtos/system-config.dto.ts`, surfaced in the
existing Facial Recognition admin settings panel.

- Default `0` → **feature disabled** (conservative, opt-in). When disabled no scan jobs are
  enqueued and the recognition path is byte-for-byte unchanged.
- Effective only when `suggestionMaxDistance > maxDistance`; otherwise no generation, no banner.

### Lifecycle & state transitions

- **Generate**: scan job conditionally upserts `pending` rows (see Regeneration safety).
- **Confirm**: delegate to the existing `PersonService.reassignFacesById`
  (`person.service.ts:228-244`) — access check + `reassignFace` + `replaceFaceIdentity(…,
'manual')` + `createNewFeaturePhoto` when the person has no feature photo. Then set the row
  `confirmed` and resolve sibling `pending` rows for the same `assetFaceId`.
- **Dismiss**: `UPDATE … SET status='dismissed' WHERE status='pending'`. Face stays
  unassigned; never re-suggested for this person. It **can still be auto-assigned** to this
  or any person by the unchanged auto-assign path — Dismiss suppresses _suggestions only_
  (preserves zero-regression to auto-assign; deliberate, see Edge cases).
- **Assigned elsewhere / face or person deleted**: FK `CASCADE` handles deletion; an explicit
  resolve (`DELETE/UPDATE WHERE assetFaceId = ?`) in the existing reassign path clears
  now-invalid `pending` rows when a face becomes assigned.
- **Idempotency**: confirm/dismiss are `… WHERE status='pending'`; if 0 rows the API still
  returns **200** with the resolved state so the client simply advances.

### HTTP API (`person.controller.ts` + new DTOs)

- `GET  /people/:id/face-suggestions?page=&size=` → `{ total, items: [{ assetFaceId, asset:<summary for full photo>, boundingBox, distance }] }`.
- `POST /people/:id/face-suggestions/:assetFaceId/confirm` → 200 (idempotent).
- `POST /people/:id/face-suggestions/:assetFaceId/dismiss` → 200 (idempotent).

OpenAPI: regenerate TS SDK (web) and Dart client (repo convention) plus `make sql`.

### Web UI (`web/src/routes/(user)/people/[personId]/[[photos=photos]]/`)

- `PersonSuggestionBanner.svelte` — on the person header when `total > 0` and not snoozed
  (localStorage): "Faces found that could be this person: N" + ≤5 candidate face-crop
  thumbnails + **Review** / **Not now** (Not now → localStorage snooze ~30 days).
- `PersonSuggestionReviewModal.svelte` — focused modal: full asset photo with the candidate
  face bbox highlighted; prev/next; `k / N` counter; lazy next-page near the end; reference
  person face (`getPeopleThumbnailUrl(person)` — memory `feedback_people_thumbnail_url`;
  **not** `getAssetMediaUrl`) vs. candidate face crop; **Same**(confirm)/**Different**(dismiss),
  advance on action; empty/all-done closes modal & banner; treats every confirm/dismiss
  response as "advance".

### Authorization

- **Personal (Phases 1–4)**: person owned by `auth.user.id` — reuse the access check
  `reassignFacesById` already performs; candidates constrained to the owner's assets.
- **Shared space (Phase 5)**: space-person suggestions require space **owner/editor**; a
  viewer cannot confirm/dismiss. Candidate faces scoped to space-accessible assets;
  confirming goes through the identity graph and respects metadata inheritance / source
  locks. Full presence/absence permission matrix.

## Edge cases (full list — each gets a test)

1. **Dismissed then auto-assigned to the same person** — _deliberate, documented_: Dismiss
   suppresses suggestions only; a later within-`maxDistance` match still auto-assigns
   (zero-regression promise). Surfaced in user-facing docs.
2. Concurrent scan regenerating while the user reviews → only `pending` served; conditional
   upsert never touches resolved rows; confirm/dismiss status-guarded.
3. `suggestionMaxDistance` lowered below an existing pair's distance → such `pending` rows
   filtered out at read time (read query also enforces the band) and not regenerated.
4. `suggestionMaxDistance` raised → new candidates appear next scan; existing resolved
   decisions remain resolved.
5. Unnamed / auto-created clusters never get suggestions; the on-name trigger backfills the
   moment the user names the cluster.
6. Person renamed A→B (already named) → on-name trigger still fires (name changed).
7. Person un-named (name set to '') or hidden → no new scans; existing rows untouched (no
   destructive cleanup); banner hidden because the read gate excludes non-scannable persons.
8. Person merged into another → `reassignFacesById`/merge path resolves the moved face's
   suggestions; surviving person re-scanned via the maintenance chain.
9. Person deleted mid-review → FK `CASCADE`; client gets benign 200 and advances.
10. Face deleted mid-review → FK `CASCADE`; client benign-advances.
11. Face auto-assigned by recognition between scan and review → resolve step + read-time
    filter exclude it; client benign-advances.
12. Two people both suggested the same face → confirming for one resolves the other's
    `pending` row for that face.
13. Feature toggled **off** after rows exist → no banner (read gate); rows preserved;
    toggled back **on** → rows still valid, scans resume.
14. Very large person (e.g. 10k assigned faces) → embedding sample cap (≤20) bounds work.
15. Person with zero assigned faces / no embeddings → scan is a no-op (nothing to scan from).
16. Pet identity (`type='pet'`) → never scanned (scan filters `type='person'`).
17. Re-running a scan twice → idempotent; unique constraint prevents duplicates; distances
    refreshed for still-`pending` rows only.
18. Non-owner requests another user's person suggestions / confirm / dismiss → denied,
    no state change (absence test).
19. `PersonSuggestionScanQueueAll` ordered strictly **after** `FaceIdentityBackfill`
    completes (not before) so suggestions reflect post-maintenance assignments.

## Phases (each is a separate `writing-plans` plan)

### Phase 1 — Schema, repository foundations & config (no user-visible behavior)

**Scope:** `person_face_suggestion` table + schema class + `@Check` + `@UpdatedAtTrigger`;
migration `1778800000000` with `migration_overrides` up/down; dual registration in
`schema/index.ts`; `searchFaces` `hasPerson` tri-state change;
`personRepository.getAssignedFaceEmbeddings`; suggestion repository (conditional upsert,
band read with pagination + total, resolve-on-assign); `suggestionMaxDistance` config +
schema validation. **Exit:** persistence + plumbing exist; no generation, no API, no UI.

**TDD coverage:**

- Migration up creates table, columns, unique `(personId,assetFaceId)`, both indexes, the
  `@Check` rejecting an invalid status, the trigger; `migration_overrides` row present.
  `down()` removes table, indexes, trigger, and the `migration_overrides` row. (medium/DB)
- Schema dual-registration: table present in `tables` array and `DB` interface (boot/type).
- `searchFaces`: `hasPerson:true` → `personId IS NOT NULL` (regression on existing callers);
  `hasPerson:false` → `personId IS NULL` only; omitted → both; results ordered by `distance`
  ascending and include `distance`.
- `getAssignedFaceEmbeddings`: ≤ limit rows; only that person's faces; excludes
  `isVisible=false` and `deletedAt` rows; empty when person has no faces; respects cap.
- Conditional upsert: new → `pending`; existing `pending` → distance refreshed only; existing
  `dismissed` → unchanged (both status and distance preserved — explicit regression for the
  headline guarantee); existing `confirmed` → unchanged.
- Band read: returns only `status='pending'` with `distance ∈ (maxDistance, suggestionMaxDistance]`,
  ordered ascending, paginated, correct `total`; excludes assigned/deleted faces; **read
  gate** — returns empty when the person is not currently scannable (unnamed / hidden /
  `type='pet'`) or when the feature is disabled (`suggestionMaxDistance ≤ maxDistance`) even
  if `pending` rows still exist.
- Resolve-on-assign: given a now-assigned `faceId`, all its `pending` rows (every person)
  resolved.
- Config: default `0`; rejects negative / non-number; feature-disabled gate when
  `suggestionMaxDistance ≤ maxDistance`.
- Edge cases tested here: 3, 4, 7 (read gate), 13, 17.

### Phase 2 — Generation jobs & triggers (suggestions appear automatically)

**Scope:** `PersonSuggestionScan` job; `PersonSuggestionScanQueueAll` chunked queue-all
chained after `FaceIdentityBackfill`; on-name single-person trigger with pre-update read +
gating; `QueueName.PeopleBackfill` placement; `JobName` enum additions. **Exit:** suggestions
generated automatically end-to-end; still no API/UI.

**TDD coverage:**

- `PersonSuggestionScan`: feature-disabled → no rows; unnamed/hidden/pet person → skipped;
  named person → fetches ≤20 embeddings, searches unassigned, keeps band only, upserts
  `pending`; candidates restricted to owner's assets; MIN distance across samples; never
  resurrects resolved (integration regression); bounded (caps asserted); idempotent on rerun;
  zero assigned faces → no-op.
- `PersonSuggestionScanQueueAll`: enumerates only named/non-hidden/`type='person'` people
  with ≥1 unassigned face; chunked cursor like `FaceIdentityBackfill`; one
  `PersonSuggestionScan` per person; runs on `PeopleBackfill`; empty library → no jobs;
  strictly ordered after `FaceIdentityBackfill` completes.
- On-name trigger: enqueues single-person scan on '' → named and on rename-of-named **and**
  `!isHidden && type='person'`; does **not** enqueue on color/birthDate/favorite/visibility
  edits, on becoming hidden, on name-cleared, or while still unnamed.
- Queue-placement assertion: jobs never enqueued onto `FacialRecognition`.
- `handleRecognizeFaces` unchanged when feature disabled (no scan enqueued; behavior identical).
- Dismiss does **not** block auto-assign: with the feature enabled, when recognition later
  finds a `dismissed` face within `maxDistance` of that same person, the unchanged auto-assign
  path still assigns it (edge 1 — proves Dismiss suppresses suggestions only; zero-regression).
- Edge cases tested here: 1, 2, 5, 6, 7 (no-new-scans branch), 14, 15, 16, 19.

### Phase 3 — HTTP API & DTOs

**Scope:** `GET /people/:id/face-suggestions` (paginated + total), `POST …/confirm`,
`POST …/dismiss`; DTOs; idempotency; owner-only auth; OpenAPI (TS + Dart) + `make sql`.
**Exit:** working, documented API over generated suggestions.

**TDD coverage:**

- GET: `{ total, items{ assetFaceId, asset summary, boundingBox, distance } }`; ordered by
  distance asc; pagination bounds; only in-band `pending`; empty for person with none;
  **owner-only** (non-owner → denied, absence assertion); invalid UUID → 400.
- Confirm: delegates to `reassignFacesById` (face assigned, identity `manual`, feature photo
  created when `faceAssetId` null — assert all three); row → `confirmed`; sibling `pending`
  rows for that face resolved; idempotent (already-confirmed/vanished → 200, no error);
  **owner-only** absence test (no state change for non-owner).
- Dismiss: row → `dismissed`; face stays unassigned; a subsequent scan does **not** recreate
  it (regression); idempotent; owner-only absence test.
- Merge: merging person A into B via the existing `mergePerson` path resolves `pending`
  suggestion rows for faces moved by the merge (edge 8). GET for a no-longer-scannable person
  (un-named / hidden) returns empty even if rows exist (edge 7, API read gate).
- OpenAPI: generated TS SDK + Dart client build; `make sql` regenerated for decorated repo
  queries (cf. memory `feedback_openapi_dart_and_sql`, `feedback_ci_generated_files`).
- Edge cases tested here: 7 (API read gate), 8, 9, 10, 11, 12, 18.

### Phase 4 — Web UI (personal)

**Scope:** `PersonSuggestionBanner.svelte`, `PersonSuggestionReviewModal.svelte`,
localStorage snooze, full-photo bbox highlight, `getPeopleThumbnailUrl` usage; web unit
tests; Playwright E2E with seeded fixture rows. **Exit:** end-to-end personal feature usable
in a browser. **Verify in a running browser before claiming done** (golden path + edge cases).

**TDD coverage:**

- Banner: hidden when `total=0`; shows count + ≤5 preview crops when `>0`; "Not now" sets
  localStorage snooze and hides until expiry; reappears after expiry or when count increases;
  uses `getPeopleThumbnailUrl` not `getAssetMediaUrl` (regression, memory
  `feedback_people_thumbnail_url`).
- Modal: opens from Review; full photo with candidate bbox highlight; prev/next; `k/N`
  counter; lazy next-page near end; reference vs candidate rendered; Same → confirm + advance;
  Different → dismiss + advance; last item → all-done + close + banner gone; stale item
  (benign 200) still advances; empty queue → no modal; bits-ui modal teardown drain
  (memory `feedback_bits_ui_body_scroll_lock_drain`).
- E2E (Playwright, ML disabled): seed `person_face_suggestion` rows; banner shows on person
  page; confirm assigns face (verify via API); dismiss suppresses; snooze hides banner.
- Edge cases tested here (UI side): 1 (user-facing doc note), 7 (banner hidden), 9, 10, 11
  (benign-advance), 13 (no banner).

### Phase 5 — Shared-space suggestions (effort-flagged; its plan may split further)

**Scope:** space-scoped scan via the identity graph; RBAC (owner/editor act, viewer cannot);
candidate faces scoped to space-accessible assets; identity merge + metadata
inheritance/source-lock interactions; reuses the Phase 1 table and Phase 4 UI. **Exit:**
shared-space people get the same workflow with a full presence/absence permission matrix.

**TDD coverage (high level; detailed in its own plan):** space scan respects identity graph
and space-accessible assets only; owner/editor confirm/dismiss allowed, viewer denied
(presence **and** absence for every path); confirming links via identity respecting
inheritance/source locks; no leakage of inaccessible faces/thumbnails; permission matrix
across personal + timeline-enabled space people. The permission matrix and identity
interactions are the dominant cost — materially heavier than Phases 1–4; split this plan if
it grows large.

### Phase 6 — Mobile (documentation only)

No implementation in this effort. Documented so a later Flutter plan reuses the Phase 3
endpoints 1:1 (banner + review screen, Dart OpenAPI, Riverpod, mobile tests).

## Effort summary

- **v1 = Phases 1–4** (personal, web): self-contained — new isolated table + new isolated
  jobs; the only touches to existing hot code are enqueuing on person-rename and chaining the
  queue-all after existing post-recognition maintenance. No surgery inside
  `handleRecognizeFaces`. Lower risk than the originally-drafted inline hook.
- **Phase 5** (shared-space): materially heavier (identity graph + RBAC matrix); ships as a
  fast follow, independently of v1.
- **Phase 6** (mobile): not built; documented.

Recommended sequencing: 1 → 2 → 3 → 4 (ship v1), then 5, mirroring the established phased
rollout used for global face identities.
