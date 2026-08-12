# Slice 4 — Face-level authorization on personal reject / ignore / dismiss

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 4, finding F8)
**Branch:** `feat/face-review-unified`
**Depends on:** Slice 3, which also edits `person.service.ts`. Start only after it is committed.

## Goal

A user cannot write a verdict row about a face they have no rights over. The personal path gets the
gate the space path already has and the confirm path already applies.

## The defect, and why the existing comment is now wrong

`rejectFaceSuggestion` and `ignoreFaceSuggestion` (`server/src/services/person.service.ts`, around
`:488` and `:500`) check only `Permission.PersonUpdate` on `personId`. `assetFaceId` is passed
straight through to `markRejected` / `markIgnored`. The comment above `rejectFaceSuggestion` argues
the check is unnecessary because "reject never touches the face (it only suppresses a
(personId, assetFaceId) suggestion row)". That reasoning predates the verdict layer and is now false
in three ways:

1. `verdictOpts` (around `:480`) calls `ensurePersonIdentity`, so **every** such row is written with a
   non-null `identityId`.
2. `face_identity.id` is a **cross-owner** key —
   `server/src/services/identity-merge-propagation.service.ts:360-370` assigns one identity to
   personal people belonging to _different_ owners (`person_ownerId_identityId_key` is unique per
   owner **and** identity, so sharing across owners is by design).
3. `getPendingForPerson`'s anti-join matches `neg.identityId = <target identity>` with **no ownership
   filter** (`server/src/repositories/face-person-verdict.repository.ts`, the D3 self-heal block). So
   a row written by one user suppresses another user's queue for that face.

Valid `assetFaceId`s of other owners' assets are enumerable by any space **viewer** via
`GET /shared-spaces/:id/people/:personId/faces` (`Permission.SharedSpaceRead`, returns
`PersonFaceResponseDto.id`). The FK on `assetFaceId` is the only thing standing between an
authenticated client and unbounded verdict-row creation against other people's faces.

`confirmFaceSuggestion` already applies the right gate; the space twin
(`resolveSpacePersonFaceSuggestion` in `shared-space.service.ts`) gates on `isFaceReachableInSpace`.
The personal path is the outlier.

## Files

| File                                                                   | Change                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| `server/src/services/person.service.ts`                                | add the face gate to both methods; replace the stale comment |
| `server/src/services/person.service.spec.ts`                           | S4.1–S4.3                                                    |
| `server/test/medium/specs/services/face-suggestion-exclusions.spec.ts` | S4.4, S4.6, S4.7                                             |
| `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`         | S4.8, S4.9                                                   |

Do not touch anything else. Other agents may be working under `web/`, `server/src/repositories/` and
`server/src/utils/`.

## Implementation

In both `rejectFaceSuggestion` and `ignoreFaceSuggestion`, immediately after the existing
`PersonUpdate` check on the person, add the same pair `confirmFaceSuggestion` uses:

```ts
await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [assetFaceId] });
```

`Permission.PersonCreate` resolves via `access.person.checkFaceOwnerAccess`
(`server/src/utils/access.ts:315-317`), which is `asset.ownerId = userId` with trashed assets
excluded. `dismissFaceSuggestion` inherits the gate through its delegation to
`rejectFaceSuggestion` — do not duplicate it there.

Replace the stale justification comment. State instead: the verdict is identity-keyed and read back
across scopes and owners, so the face must be one the caller owns; and note the accepted consequence
that a reject on a trashed asset now 400s (there is nothing readable to suppress, since every read
path filters `asset.deletedAt`).

## Tests

Every absence assertion needs a positive control in the same test body (spec §2).

| #    | Layer  | Test                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4.1 | unit   | `rejectFaceSuggestion` throws `BadRequestException` when `checkFaceOwnerAccess` returns empty, and `markRejected` is never called                                                                                                                                                                                                                                 |
| S4.2 | unit   | The same for `ignoreFaceSuggestion` (asserting `markIgnored`) and for `dismissFaceSuggestion`                                                                                                                                                                                                                                                                     |
| S4.3 | unit   | **pin** — the owner path passes both checks and still calls `markRejected` with `{ identityId, source: 'suggestion', actorId }`                                                                                                                                                                                                                                   |
| S4.4 | medium | **BDD, the cross-owner scenario.** **Given** users A and B whose personal people both named "Anna" share one identity `I`, and an unassigned near-miss face F in **B's** library with a pending suggestion for B's Anna, **When** A calls `rejectFaceSuggestion(authA, annaA.id, F)`, **Then** it throws and `getFaceSuggestions(authB, annaB.id)` still offers F |
| S4.6 | medium | A rejects a face in **A's own** library that is also visible to B through a space: still allowed. The gate is ownership, not exclusivity                                                                                                                                                                                                                          |
| S4.7 | medium | Rejecting a face whose asset is in the trash now throws, and writes no row (the accepted consequence)                                                                                                                                                                                                                                                             |
| S4.8 | e2e    | `POST /people/{personId}/face-suggestions/{foreignFaceId}/reject` as a second user → 400; a follow-up `GET` by the face's owner still lists it                                                                                                                                                                                                                    |
| S4.9 | e2e    | `reject` and `ignore` happy paths. **These two endpoints currently have zero e2e coverage in any scope** — only `confirm` and `dismiss` are exercised. Assert the row leaves the queue and does not return on a re-read                                                                                                                                           |

For S4.4, the cross-owner identity fixture is the fiddly part. Establish the shared identity the way
the production code does — do not hand-write two `person` rows with the same `identityId` unless you
have confirmed that is reachable. Read
`server/src/services/identity-merge-propagation.service.ts` and
`server/test/medium/specs/services/identity-merge-propagation.service.spec.ts` for how a cross-owner
identity is actually created, and drive it through that path. If it turns out not to be reachable in
a medium fixture, say so in your report and assert the narrower claim (A cannot write a row against
B's face at all), which is the security-relevant half.

## Verification

```bash
cd server
pnpm exec vitest --config test/vitest.config.mjs --run src/services/person.service.spec.ts
pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/face-suggestion-exclusions.spec.ts
npx tsc --noEmit -p tsconfig.json
npx eslint src/services/person.service.ts src/services/person.service.spec.ts test/medium/specs/services/face-suggestion-exclusions.spec.ts --max-warnings 0
npx prettier --check src/services/person.service.ts src/services/person.service.spec.ts
cd ../e2e && npx tsc --noEmit && npx eslint src/specs/server/api/person-face-suggestions.e2e-spec.ts --max-warnings 0
```

The e2e stack's database predates `face_person_verdict`, so the e2e suite cannot currently be run to
green — verify those two items by typecheck and lint and say so explicitly in your report rather than
claiming a run you did not perform. Do not start or restart any Docker stack; the e2e stack is a
machine-wide singleton shared with other sessions.

## Constraints

- `pnpm test -- --run <path>` silently drops the path filter — use the forms above.
- Run **tsc and eslint**, not only vitest. Two earlier slices shipped type and lint errors that
  vitest does not catch and that fail CI.
- Do not add `Co-Authored-By` or "Generated with" trailers. Do not commit.

## Commit

```
fix(face-suggestions): require face ownership to reject or ignore a suggestion
```
