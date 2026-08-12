# Slice 3 — Confirm applies the same gates as the read

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 3, findings F5–F7)
**Branch:** `feat/face-review-unified`
**Depends on:** Slice 1 (commit `eab47056a8a`), which added `reviewableAssetVisibility` and is already
committed. Build on it.

## Goal

A face the queue will not show cannot be confirmed through it. The write path and the read path share
one definition of "eligible".

## The defect

`getPendingForPerson` (`server/src/repositories/face-person-verdict.repository.ts:400-497`) applies
ten predicates. `claimPending` (`:117-129`) — the only gate `confirmFaceSuggestion` has — is a bare
delete:

```ts
await db
  .deleteFrom('face_person_verdict')
  .where('personId', '=', personId)
  .where('assetFaceId', '=', assetFaceId)
  .where('status', '=', 'pending')
  .executeTakeFirst();
```

No band, no `af.personId is null`, no `af.deletedAt` / `isVisible`, no `asset.deletedAt` /
`isOffline` / visibility, no manual-link anti-join, no negative-verdict anti-join. So a pending row
written before its asset was moved to the Locked folder (or trashed, or hidden) is still
confirmable, even though the queue no longer offers it. `claimPendingForSpacePerson` (`:132-140`) is
the same. `hasPendingForSpacePerson` (`:618-668`) reproduces the display gates but **omits** the two
anti-joins its read twin applies at `:558-586`.

`confirmFaceSuggestion` (`server/src/services/person.service.ts:428`) also has no
`isFaceSuggestionEnabled` check, while `confirmSpacePersonFaceSuggestion`
(`server/src/services/shared-space.service.ts:1317-1319`) does.

## Files

| File                                                                              | Change                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `server/src/repositories/face-person-verdict.repository.ts`                       | shared predicate; gate both claims; complete `hasPendingForSpacePerson` |
| `server/src/services/person.service.ts`                                           | `confirmFaceSuggestion` passes the band; feature gate                   |
| `server/src/services/shared-space.service.ts`                                     | `confirmSpacePersonFaceSuggestion` passes the band                      |
| `server/test/medium/specs/repositories/face-person-verdict.repository.spec.ts`    | S3.1–S3.7, S3.11                                                        |
| `server/src/services/person.service.spec.ts`                                      | S3.9                                                                    |
| `server/test/medium/specs/services/shared-space-face-suggestions.service.spec.ts` | S3.6, S3.8                                                              |

Do **not** touch `server/src/utils/config.ts`, `server/src/utils/config.spec.ts`,
`scripts/revert-to-immich.sql`, `server/test/medium/specs/migrations/`, anything under `web/`,
`e2e/`, `server/src/controllers/face-repair-admin.controller.spec.ts`,
`server/test/medium/specs/services/face-review-cross-flow.spec.ts`,
`face-verdict.merge-durability.spec.ts` or `face-verdict-safety.spec.ts` — concurrent agents own
those.

## Implementation

### 1. Extract the shared eligibility predicate

Add a private helper to `FacePersonVerdictRepository` that applies, to a query already joined to
`asset_face as af` and `asset`, everything both scopes share:

```ts
// The single definition of "this pending row is eligible". Used by the read (getPendingForPerson /
// getPendingForSpacePerson), the pendingness probe (hasPendingForSpacePerson) and — the point of
// Slice 3 — the CLAIM. A row the queue will not show must not be confirmable through it (F5/F6).
private applyPendingEligibility<T>(qb: T, opts: { maxDistance: number; suggestionMaxDistance: number }): T
```

It must cover: the band (`fpv.distance > maxDistance`, `<= suggestionMaxDistance`),
`af.personId is null`, `af.deletedAt is null`, `af.isVisible is true`, `asset.deletedAt is null`,
`asset.isOffline is false`, `reviewableAssetVisibility(eb)`, and the manual-link anti-join
(`NOT EXISTS face_identity_face where assetFaceId = fpv.assetFaceId and source = 'manual'`).

The **negative-verdict** anti-join is target-specific (`neg.personId = personId` OR
`neg.identityId = <resolved identity>` for the personal scope; `neg.spacePersonId` for the space
scope), so keep it as a second small helper parameterised by the target token pair, and call it from
all four sites. Do not duplicate the SQL a third time.

Refactor `getPendingForPerson`, `getPendingForSpacePerson` and `hasPendingForSpacePerson` onto these
helpers. `getPendingFor*` must emit the same SQL as before the refactor apart from the visibility
predicate Slice 1 already added — if a test that passed before now fails, the refactor changed
behaviour and is wrong.

`hasPendingForSpacePerson` **gains** both anti-joins (that is F6).

### 2. Gate both claims

`claimPending` and `claimPendingForSpacePerson` become a delete driven by an eligibility subquery:

```ts
async claimPending(
  personId: string,
  assetFaceId: string,
  opts: { maxDistance: number; suggestionMaxDistance: number },
  db: Kysely<DB> | Transaction<DB> = this.db,
): Promise<number>
```

Shape: `DELETE FROM face_person_verdict WHERE id IN (SELECT fpv.id FROM face_person_verdict fpv JOIN asset_face af … JOIN asset … WHERE fpv.personId = … AND fpv.assetFaceId = … AND fpv.status = 'pending' AND <eligibility>)`.

Requirements:

- **Keep the `db` parameter and keep it last-but-one so the personal path can still thread its
  `trx`.** `confirmFaceSuggestion` calls this inside a transaction — every statement must run on the
  passed handle. Never call `this.db` from inside it (issue #595). `claimPendingForSpacePerson`
  currently has no `db` parameter; add one (default `this.db`) for symmetry, but Slice 5 is the slice
  that actually threads it — leave its callers passing nothing.
- The personal variant needs the target's `identityId` for the negative anti-join. Resolve it in the
  same subquery via a correlated lookup on `person.identityId`, rather than making the caller pass
  it — `getPendingForPerson` resolves it in a separate round-trip because it needs it for other
  reasons, but the claim is a single statement and must stay one.
- Return the delete count unchanged, so both callers' existing `claimed === 0` idempotent paths keep
  working with no change in shape.

### 3. Callers

- `confirmFaceSuggestion` (`person.service.ts:428`): add the `isFaceSuggestionEnabled` short-circuit
  **before** the access checks (so a disabled feature is a cheap no-op, matching the space twin), read
  `maxDistance` / `suggestions.maxDistance` from the same config read, and pass them to
  `claimPending`.
- `confirmSpacePersonFaceSuggestion` (`shared-space.service.ts:1309`): it already computes
  `distanceConfig` for `hasPendingForSpacePerson` — pass the same object to
  `claimPendingForSpacePerson`.

## Tests

Every absence assertion needs a positive control in the same test body (spec §2).

| #     | Layer  | Test                                                                                                                                                                                                                         |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3.1  | medium | `claimPending` returns 0 and leaves the row intact for a pending row whose asset became `locked` after the row was written; returns 1 for an eligible control row in the same test                                           |
| S3.2  | medium | Table-driven: the same for a trashed asset, an offline asset, `visibility='hidden'`, `af.deletedAt` set, `af.isVisible=false`, and `af.personId` already set                                                                 |
| S3.3  | medium | `claimPending` returns 0 when the face has acquired a `source='manual'` link for **another** identity                                                                                                                        |
| S3.4  | medium | `claimPending` returns 0 when a negative verdict exists for the same target — two tests, one matched by `personId`, one matched by `identityId`                                                                              |
| S3.5  | medium | `claimPending` returns 0 when the row's distance falls outside the current band (both boundaries: `<= maxDistance` and `> suggestionMaxDistance`)                                                                            |
| S3.6  | medium | `claimPendingForSpacePerson` mirrors S3.1–S3.5                                                                                                                                                                               |
| S3.7  | medium | `hasPendingForSpacePerson` returns `false` for a face carrying a manual link, and for one carrying a negative verdict for that space person's identity; `true` for the control                                               |
| S3.8  | medium | **BDD** — **Given** a pending suggestion, **When** the owner moves the asset into the Locked folder and then calls confirm, **Then** the confirm is a no-op: no reassignment, no manual link, and the row is still `pending` |
| S3.9  | unit   | `confirmFaceSuggestion` returns early without calling `requireAccess` or any repository when `suggestions.enabled` is false                                                                                                  |
| S3.10 | medium | **pin** — the happy path still works end to end: an eligible pending row confirms, reassigns, drains and manual-links                                                                                                        |
| S3.11 | medium | `claimPending` honours a passed transaction: run it inside a transaction that then rolls back, and assert the row is still present                                                                                           |

S3.10 is the refactor's safety net. Run it first, before touching anything, and confirm it passes
against the current code — then keep it green throughout.

## Verification

```bash
cd server
pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
  test/medium/specs/services/shared-space-face-suggestions.service.spec.ts
pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts
```

`face-person-verdict.repository.spec.ts` has ~62 tests that exercise `getPendingFor*` heavily —
they are the regression net for the refactor. All must stay green.

## Constraints

- `pnpm test -- --run <path>` silently drops the path filter — use the forms above.
- Never run a `this.db` query inside a `this.db.transaction()` callback.
- Never run `make sql` / `mise //:sql` — the controlling session regenerates SQL docs in one pass.
  Note in your report that `face.person.verdict.repository.sql` will need regenerating.
- Server imports use the `src/` alias.
- Do not add `Co-Authored-By` or "Generated with" trailers. Do not commit.

## Commit

```
fix(face-suggestions): gate confirm on the same eligibility the queue read applies
```
