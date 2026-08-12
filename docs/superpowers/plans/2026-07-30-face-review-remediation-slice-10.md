# Slice 10 — Request bounds, published permissions, SQL docs

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 10, findings F20, F21, F22)
**Branch:** `feat/face-review-unified`

## Scope change from the spec

The spec's Slice 10 also carried **F23** (paginating `listNegativeVerdicts` and the resolutions page).
That is deferred to **Slice 11**, because the server change and the web change have to land together
and Slice 12 currently owns `web/src/routes/admin/face-cleanup/resolutions/+page.svelte`. This slice
is server-only. Record the move in your report; do not touch anything under `web/`.

## Goal

Every request array is bounded below the Postgres bind-parameter ceiling and chunked on the way to
the database; the published permission is the enforced one; and the generated SQL documentation is
correct.

## Part 1 — F20: cap and chunk the four unbounded arrays

`server/src/dtos/face-repair.dto.ts` has a comment (around `:140-142`) asserting that every
per-request face/owner array is capped and that every write path chunks its `IN`-lists at 1000.
**Both halves are false** for these four:

| DTO field                  | Where                | Downstream, unchunked                                                      |
| -------------------------- | -------------------- | -------------------------------------------------------------------------- |
| `assetFaceIds` (unconfirm) | `.min(1)` only       | `face-identity.repository.ts` `demoteManualFaceLinks`                      |
| `verdictIds`               | `.min(1).optional()` | `face-person-verdict.repository.ts` `removeVerdicts`                       |
| `clusterMuteIds` / `ids`   | `.min(1).optional()` | `face-repair-decline.repository.ts` (the removal method)                   |
| `excludeFaceIds`           | **no cap at all**    | `face-repair.repository.ts` `getClusterFacePage` (executed twice per call) |

The 10 MB body limit admits far more ids than Postgres's 65 535-parameter ceiling, and
`excludeFaceIds` is reachable from the shipped UI: `web/src/routes/admin/face-cleanup/[personId]/+page.svelte`
sends every flagged face of the reviewed person.

**Change.** Cap all four at `MAX_RESOLVE_FACES` (25 000 — already defined in the DTO file and already
enforced on the resolve buckets), then chunk each downstream `IN`. The repository files already
contain a chunking idiom (`BULK_CHUNK_SIZE` in `face-person-verdict.repository.ts`, and
`drainPendingForFaces`' loop) — reuse it rather than inventing a new one. Correct the DTO comment so
it describes what is now true.

Note `getClusterFacePage` builds a `base` query used twice (a count and a page). Chunking a `NOT IN`
is not the same as chunking an `IN` — `NOT IN` over chunks must be an intersection, not a union.
Think this through and say in your report how you handled it; if the cleanest correct form is a
single `NOT IN` that stays under the ceiling because the cap is 25 000, that is an acceptable answer,
but state it explicitly rather than leaving it implicit.

## Part 2 — F21: publish the permission that is actually enforced

| Endpoint                                                   | Publishes                   | Enforces                              |
| ---------------------------------------------------------- | --------------------------- | ------------------------------------- |
| `GET /people/{id}/face-suggestions`                        | `Permission.PersonRead`     | `PersonUpdate`                        |
| `POST /people/{id}/face-suggestions/{assetFaceId}/confirm` | `Permission.PersonReassign` | `PersonUpdate` **and** `PersonCreate` |

An API key scoped exactly as the spec documents passes the guard and then gets a 400 from
`requireAccess`.

**Change the decorators in `server/src/controllers/person.controller.ts` to publish what is
enforced** — do **not** relax the service. The owner-only read is deliberate: `PersonRead` resolves
via `access.person.checkSharedSpaceAccess` as well as ownership (`server/src/utils/access.ts`), which
would let a space member read the owner's whole-library review queue. That is finding F-D6 from the
original review and must not be undone.

For confirm, the guard can only carry one permission, so publish `PersonUpdate` (the person-level
requirement) and leave the face-level `PersonCreate` as a service-level check. Add a comment saying
so, so the next reader does not "fix" the mismatch in the wrong direction.

`server/src/controllers/person.controller.spec.ts` asserts the published permission for these routes
— update those assertions and keep them discriminating.

## Part 3 — F22: the stacked `@GenerateSql` decorator

`server/src/repositories/face-identity.repository.ts` has **two** `@GenerateSql` decorators stacked
on `getManualLinkedFaceIds` (around `:2290` and `:2297`). The first is a leftover from
`replaceFaceIdentity`, whose signature line was replaced without removing its decorator. `GenerateSql`
is `SetMetadata` — overwrite, not merge — and method decorators apply bottom-up, so the
object-shaped params win over the array-shaped ones.

The consequence is baked into the committed artifact: `server/src/queries/face.identity.repository.sql`
renders `"assetFaceId" in $1` (a scalar bind) for `getManualLinkedFaceIds`, while the correct sibling
form is `in ($1)`. The CI `sql` gate passes because the wrong-but-reproducible output is what got
committed. `replaceFaceIdentity` meanwhile has no SQL coverage at all.

**Change.** Remove the stray decorator from `getManualLinkedFaceIds`, keeping the array-shaped one.
Add a correct `@GenerateSql` to `replaceFaceIdentity` with params matching its actual signature.

**Do not run `mise //:sql`** — the controlling session regenerates all SQL docs in one pass with the
dev database up. Instead, state in your report exactly which blocks in
`server/src/queries/face.identity.repository.sql` you expect to change, so the regeneration can be
checked against your prediction.

## Tests

Every absence assertion needs a positive control in the same test body (spec §2).

| #     | Layer  | Test                                                                                                                                                                                                                             |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S10.1 | unit   | Each of the four schemas rejects `25_001` ids and accepts exactly `25_000` (table-driven over the four)                                                                                                                          |
| S10.2 | unit   | `excludeFaceIds` rejects over-cap input — it has **no** cap today, so this is a genuine red                                                                                                                                      |
| S10.3 | medium | `demoteManualFaceLinks`, `removeVerdicts`, the decline removal and `getClusterFacePage` each complete with 25 000 ids without a bind-parameter error, and each returns the right result for a small control set in the same test |
| S10.4 | unit   | `person.controller.spec.ts` asserts the GET publishes `PersonUpdate` and confirm publishes `PersonUpdate`; the service-level checks are unchanged (**pin** the service side)                                                     |
| S10.5 | —      | Not a test: your predicted diff for `face.identity.repository.sql`                                                                                                                                                               |

For S10.3, bulk-insert the fixture rows rather than looping 25 000 single inserts, or the test will
dominate the suite runtime. Slice 7 added a `seedFacesBulk` helper to
`server/test/medium/specs/services/face-repair.resolve.spec.ts` — look at it for the idiom.

## Verification

```bash
cd server
pnpm exec vitest --config test/vitest.config.mjs --run src/dtos/face-repair.dto.spec.ts src/controllers/person.controller.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/face-identity.repository.spec.ts \
  test/medium/specs/repositories/face-person-verdict.repository.spec.ts \
  test/medium/specs/repositories/face-repair-decline.repository.spec.ts \
  test/medium/specs/repositories/face-repair.repository.spec.ts
npx tsc --noEmit -p tsconfig.json
npx eslint src/dtos/face-repair.dto.ts src/controllers/person.controller.ts src/repositories/face-identity.repository.ts src/repositories/face-person-verdict.repository.ts src/repositories/face-repair-decline.repository.ts src/repositories/face-repair.repository.ts --max-warnings 0
npx prettier --check src/dtos/face-repair.dto.ts src/controllers/person.controller.ts src/repositories/face-identity.repository.ts src/repositories/face-person-verdict.repository.ts src/repositories/face-repair-decline.repository.ts src/repositories/face-repair.repository.ts
```

## Constraints

- Touch ONLY: `server/src/dtos/face-repair.dto.ts`, `server/src/controllers/person.controller.ts`,
  `server/src/controllers/person.controller.spec.ts`,
  `server/src/repositories/face-identity.repository.ts`,
  `server/src/repositories/face-person-verdict.repository.ts`,
  `server/src/repositories/face-repair-decline.repository.ts`,
  `server/src/repositories/face-repair.repository.ts`, and the spec files named above.
  Other agents own `web/`, `e2e/`, `server/src/services/person.service.ts`,
  `server/src/services/shared-space.service.ts`, `server/src/repositories/person.repository.ts` and
  `server/src/repositories/shared-space.repository.ts`.
- `pnpm test -- --run <path>` silently drops the path filter — use the forms above.
- Never run `make sql` / `mise //:sql`.
- The OpenAPI spec and generated SDKs will need regenerating for Part 2. Do not regenerate them —
  report it.
- Do not add `Co-Authored-By` or "Generated with" trailers. Do not commit.

## Commit

```
fix(face-review): bound request arrays and publish the enforced permissions
```
