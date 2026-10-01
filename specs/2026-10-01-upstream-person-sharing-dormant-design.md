# Upstream person sharing — pulled, dormant

**Date:** 2026-10-01 · **Decision:** dormant pull (approach A) · **Scope:** immich-31620 (`c12d5e6d35f`) and the
release/v3.3 commits that build on it: immich-31902 (`ceea058662a`), immich-31930 (`d1a4c8bbe1a`), immich-31931
(`b20bc5ed822`), immich-31960 (`f32a891d407`).

## Context

The rolling branch tracks `upstream/release/v3.3` (see `specs/upstream-reports/2026-10-01-upstream-sync.md`). Upstream's
v3.3 adds **person sharing**:

- `person_user (personGroupId, sharedById, sharedWithId, role ∈ read|write|admin)`; composite FK
  `(sharedById, personGroupId) → person(ownerId, personGroupId)`; check `sharedById != sharedWithId`.
- Trigger `person_user_after_insert` inserts a `person` row for the recipient **in the same person group**;
  `person_delete_shares` (AFTER DELETE ON `person`) prunes shares. Migration is additive, no backfill.
- Sharing is restricted to users in the caller's **cluster group**.
- Access is rebuilt around `PersonId {personGroupId, ownerId}`: you own a row in the group, or a share grants a role.
  `PersonRead/Update/Delete/Merge` move to `checkPersonAccess`.
- Routes `GET|PUT|DELETE /people/users`; `createAllForOwner`; `userId` overrides on person update/delete and face
  reassignment; `PersonResponseDto.otherPeople/sharedBy/sharedWith` (required arrays); `PersonSearchDto` gains
  `sharedById/sharedWithId/isFavorite/isHidden`.
- Name/birth-date edits sync to owners who granted write/admin (`updateForWritableOwners`), controlled by the new
  user preference `people.updateStrategy` (`self|everyone`, default `everyone`).
- Web: share-access, bulk-share, people-selection and filter modals; `PersonEditModal` replaces
  `PersonEditBirthDateModal`. Mobile: person timeline built from timeline users (self + partners) plus album assets.

## Why not converge

Upstream's model cannot function in Gallery as built:

1. **Option M** (`specs/2026-08-22-option-m-invariant-inventory.md`): `person_personGroupId_key` allows one `person`
   row per group. The share trigger inserts a second → every share fails at the database.
2. **Cluster groups are inert** (`people-merge-inert` invariant; `specs/2026-08-21-cluster-groups-consolidation-exploration.md`).
   Every share is refused by upstream's own "same cluster group" check first.
3. Gallery's cross-user people are **Shared Spaces people + `face_identity`** (`shared_space_person`, per-user aliases,
   identity-keyed name backfill). Upstream's access model assumes the viewer owns a row in the group, which a Space
   member never does under M — adopting it would 400 Space readers on get/statistics/thumbnail/createFace.

Converging means undoing Option M and rebuilding Space people on `person_user` — a multi-week data-model change that
reverses a settled decision. Not now.

**Revisit when** upstream makes sharing work without multi-row groups, or Gallery decides to adopt cluster groups.

## Design

### Schema — taken as-is

The `PersonSharing` migration, the `ceea` check-constraint migration, `person_user`, and both triggers land unchanged.
They are inert because nothing can insert into `person_user` (below). Keeping them keeps later upstream migrations
and schema diffs aligned.

Both migrations post-date `branding/config.json` `upstream.version` (3.2.4), so `scripts/revert-to-immich.sql` gains
idempotent reversal (drop triggers/functions/table/enum `IF EXISTS`) and `kysely_migrations` entries, per skill §7i.

### API — refuse or stay empty

| Surface | Behaviour |
| --- | --- |
| `PUT /people/users`, `DELETE /people/users` | 400 `Person sharing is not available in Gallery` (a shared `personSharingUnsupported()` helper, mirroring `newShapeUnsupported()`) |
| `GET /people/users` | `[]` |
| `createAllForOwner` | no caller reachable |
| `userId` on person update/delete, face reassignment, people delete | 400 unless equal to `auth.user.id` |
| `PersonResponseDto.otherPeople/sharedBy/sharedWith` | always `[]` |
| `PersonSearchDto.sharedById/sharedWithId` | accepted, no-op |
| `PersonSearchDto.isFavorite/isHidden` | **real** — kept as upstream features |
| `people.updateStrategy` preference | stored, no effect (sync only reaches owners via `person_user`) |

### Code paths — the fork's wins where upstream replaced it

- **Access**: `PersonRead` = owner ∪ Shared Space access; `PersonUpdate/Delete/Merge` = owner. Keep
  `checkOwnerAccess(userId, Set<string>)` and the fork's `checkOtherAccess` arms; do not adopt
  `checkPersonAccess`/`PersonAccess.checkAccess` for authorization.
- **Reads**: keep `findOrFail`/`getByGroupIdOnly` (no viewer-owns-a-row requirement), the fork's `getAllForUser`
  options (`type`, `minimumFaceCount`, `withSharedSpaces`), owner/Space-scoped statistics (no partner assets).
- **Merge/cleanup**: keep `mergePeople` + `mergeScopedPeople` + `confirmCrossOwner`; keep `deleteEmptyGroups` where the
  fork's cleanup callers expect it.
- **Faces**: keep `mapFaces(auth)` (#796).
- **Adopt** neutral upstream changes: `SharingDirection` rename, DTO/enum additions, query helpers that do not change
  fork semantics.

### Web and mobile

- Do not render share-access, bulk-share, "share all people", or the update-strategy toggle.
- Adopt upstream's `PersonEditModal` only if it routes Space people through `updateSpacePerson`; otherwise keep the
  fork's modal and treat `PersonEditBirthDateModal` deletion as keep-fork.
- Upstream's people-page URL filters and selection are adopted where they do not depend on sharing.
- Mobile: the person timeline keeps the fork's local-first source; upstream's partner + album timeline is declined.

## Guards

- **Invariant `person-sharing-dormant`** in `docs/fork/ownership.yml` (`make ci-invariants-check`): the
  `/people/users` mutation handlers call `personSharingUnsupported()`, and `PersonService` contains no call to
  `personUserRepository` mutation methods. A rebase resolving toward upstream fails the gate.
- **Unit** (each proven red against upstream's version first):
  - `upsertPeopleUsers` / `deletePeopleUsers` throw 400.
  - a `userId` override ≠ caller throws 400 on update, delete and face reassignment.
  - `PersonResponseDto` sharing arrays are empty.
  - a Space member with no row in the group can read the person, its statistics and its thumbnail.
- **Medium**:
  - a direct `person_user` insert violates `person_personGroupId_key` (pins *why* the feature is off).
  - deleting a person with the new `person_delete_shares` trigger present still succeeds.

## Rollout

1. Advance `upstreamTargetHead` to the `release/v3.3` tip and pull the 34 quarantined commits in their planned batches
   (49–74). Batch 49 (immich-31620) carries most of the hand resolution; batches 60/64/65/69 apply the same rules.
2. Implement the guards in the same cycle, in a fork commit after batch 49 so later batches replay against them.
3. Regenerate OpenAPI (TS + Dart) and SQL query docs; run the full local gate set and the full CI suite.
4. Record the resolution recipe as a standing divergence in the `rebase-upstream-report` skill.

## Non-goals

Per-user person favorites (#763 remains open), any change to Shared Spaces people, adopting cluster groups.
