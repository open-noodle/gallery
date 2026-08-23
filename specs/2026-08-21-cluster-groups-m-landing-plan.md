# Cluster Groups (#30739) — Option M Landing Plan

**Date:** 2026-08-21
**Status:** Decision taken. Landing in progress on `rebase/upstream-rolling-v3.1.1`.

This is a **pointer**, not a design document. The design work is done and lives elsewhere; this file
exists so that whoever picks the landing up cold knows what was decided, where the artefacts are, and
which traps have already been paid for.

## The decision — do not re-open

**Gallery does not adopt upstream's cluster-groups feature.** Pierre's call, 2026-08-21, in answer to
a deliberately narrow question: _cluster groups are the only way two accounts share a "same human"
notion for photos they have never shared with each other — do you care about those unshared photos?_
Answer: **no**. Shared spaces plus `face_identity` remain Gallery's answer to cross-user people.

⇒ **Option M: inert adoption.** Absorb upstream's schema, never mount the feature, and add one
uniqueness constraint that makes the inertness a database-enforced fact rather than a convention.

The four alternatives (D, J″, K, M) were each spiked; the comparison and the reasoning are in
[`2026-08-21-cluster-groups-consolidation-exploration.md`](./2026-08-21-cluster-groups-consolidation-exploration.md),
which is **superseded** — it still ranks K first, because it was written before the product question
was answered. The earlier M handoff,
[`2026-08-21-cluster-groups-m-spike-handoff.md`](./2026-08-21-cluster-groups-m-spike-handoff.md), is a
mid-spike snapshot and is stale in two places: it says five fork tables FK `person.id` (it is **two**),
and it predates the migrations and the unique index.

## What M is, in one paragraph

Take upstream's `asset_face.personId` → `personGroupId` rename and its composite `person` primary key
`(ownerId, personGroupId)`. Keep `person.identityId` and its two partial indexes; leave
`face_identity`, `face_identity_face` and `shared_space_person.identityId` untouched. Never create a
multi-user cluster group, so a `person_group` always holds exactly one `person` row — which is what
lets the fork keep addressing a person by a single id. The two layers answer different questions and
do not compete: `person_group` = "which person rows are the same human inside a cluster group";
`face_identity` = "which faces are the same human across scopes".

Divergence on upstream tables is therefore exactly what the fork already carries today. M adds none.

## Artefacts — carry these verbatim

The reference tree is `.worktrees/spike-cluster-groups-m` (`spike/cluster-groups-m` @ `056cc98ee69`),
a **throwaway merge** of fork tip + `upstream/main` that proves M end-to-end: 0 type errors, 156
migrations applying with **zero schema drift**, 5,648 unit and 2,494 medium tests passing. It is the
target end state to diff against. **It is not the thing we ship** — the rolling branch needs a rebase,
resolved per commit.

1. **`server/src/schema/migrations-gallery/1787100000000-DropPersonFksBeforeClusterGroups.ts`**
   Upstream's `1787148183729-ClusterGroups` does `ALTER TABLE "person" DROP CONSTRAINT "person_pkey"`,
   and Postgres refuses while the fork's three foreign keys depend on that index. **Upstream's
   migration therefore fails outright on a Gallery database** with
   `2BP01 ... constraint face_repair_decline_suspectedOwnerId_fkey depends on index person_pkey`. This
   migration drops those FKs first; its timestamp being lower than upstream's is load-bearing.
2. **`server/src/schema/migrations-gallery/1791000000000-RepointFaceReviewToPersonGroup.ts`**
   Runs after upstream's. Renames the fork's `personId` columns, repoints the FKs at `person_group.id`,
   rewrites the partial-index `migration_overrides` payloads, and creates the unique index. **No data
   migration is needed** — upstream seeds `person.personGroupId` from `person.id`, so every id already
   stored in the fork's face-review tables stays valid.
3. **`CREATE UNIQUE INDEX person_personGroupId_key ON person ("personGroupId")`** — this is what makes
   M safe. All six person-insert paths were enumerated and are 1:1 by construction.

> **Update 2026-08-22:** the "three documented functions" framing below understates the exposure —
> those primitives have 20 production call sites, and three further joins had to be converted from
> upstream's multi-row semantics. See `2026-08-22-option-m-invariant-inventory.md` for the full list
> and the standing rebase grep.

4. **`PersonRepository.getByGroupIdOnly` / `createWithGroup` / `withPersonAnyOwner`** — the three
   places M's 1:1 invariant is load-bearing, named so the assumption lives in three documented
   functions instead of ~229 scattered call sites. **Keep the comments; they explain the bet.**
5. **`ClusterGroupController` stays UNMOUNTED** in `server/src/controllers/index.ts`. Upstream mounts
   it by default and the merge brings it in. Its request/accept flow is the only path to a multi-user
   cluster group, so leaving it live is a runtime violation of the invariant waiting to happen.

Plus: restore `person.type` / `person.species` (pet detection) and `IPersonJob`, and delete upstream's
**7 cross-user cluster-group test setups across 2 files**, with a comment recording that Gallery
declines the feature. Those tests deliberately put a second user in the first user's cluster group;
they are the only thing in 2,494 medium tests that violates the invariant.

## Traps — every one of these cost real time

- **`shared_space_person` is a trap for every rename.** It contains the string `person`, but it keeps
  its own `id` and never references `person.id`. A plain replace turned
  `shared_space_person.id AS "profileId"` into `shared_space_person."personGroupId"` in three places
  and broke **87 medium tests** — with no type error, because raw SQL is invisible to `tsc`.
- **Aliases lie.** `source_person` / `target_person` alias `person` in one query and
  `shared_space_person` in another, fifty lines apart in the same file.
- **Only two fork tables FK `person.id`** — `face_person_verdict` and `face_repair_decline`. The whole
  shared-spaces person layer keys on `face_identity` and is structurally insulated. Earlier notes
  claiming five were wrong, and that error made M look more expensive than it is.
- **A green `tsc` proves nothing here.** Run the migrations against a real Postgres and run the medium
  suite. On the spike the compiler was clean while upstream's migration still aborted, 87 tests failed
  on a corrupted raw-SQL identifier, and the medium factories generated FK-violating ids.
- **Medium factories must create real `cluster_group` / `person_group` rows**, or every insert fails a
  foreign key.
- **Renaming a column silently invalidates `migration_overrides`.** A bare `ALTER INDEX ... RENAME`
  does not update the recorded partial-index predicate; only `migrations:generate` reporting drift
  catches it.

## Invariants to re-verify before calling it done

- **Search V3 coexistence**: fork call sites on `searchAssetBuilderLegacy`; upstream's dormant V3
  `searchAssetBuilder` still present. `grep -rn 'UPSTREAM SEARCH V3' server/src`.
- `person.identityId` present with **both** partial indexes; `person.type` / `person.species` present.
- `git diff <fork-tip> -- server/src/schema/tables/face-identity*.ts` → **empty**.
- `pnpm migrations:run` on a fresh database, then `pnpm migrations:generate` → **"No changes
  detected"**.
- `scripts/revert-to-immich.sql` covers both new fork migrations and every new upstream migration.

## Scope note

The freeze quarantined eight upstream commits behind #30739; `upstream/main` has since moved to
**thirteen**. #30739 lands as its own batch, and the rest follow behind it.
