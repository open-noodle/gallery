# Splitting shared person groups on an Immich-to-Gallery switch

**Date:** 2026-10-28 · **Status:** implemented as an interim measure ·
**Builds on:** `specs/2026-10-01-upstream-person-sharing-dormant-design.md`,
`specs/2026-08-21-cluster-groups-consolidation-exploration.md`

## Problem

An Immich instance whose users joined a cluster group cannot switch to Gallery.
`1791000000000-RepointFaceReviewToPersonGroup` refuses to run:

```
Migrations failed: Error: Cannot enforce one person per person_group: 4913 group(s) hold multiple person rows.
This instance has multi-user cluster groups, which Gallery does not support.
```

The ledger runs every pending migration in one transaction, so the failed boot leaves the database as Immich left it.
The user is not damaged, only stuck. Switching off sharing in Immich does not help: the rows are data, not a setting.

The blocker is option M's unique index `person_personGroupId_key` (one `person` row per `person_group`). The fork
addresses a person by `personGroupId` alone (`PersonRepository.getByGroupIdOnly`, `withPersonAnyOwner`,
`person_identity`, `person_pet`, the sync and mobile models), which is only unambiguous with one row per group.

## Where this sits

Gallery will adopt upstream's model, several owners' rows per group ("option 2"): drop `person_personGroupId_key`,
owner-scope the code that assumes one row per group, keep `person_identity` and `person_pet` keyed by `personGroupId`
(one identity per group, shared by every owner's row), then switch on upstream's cluster groups and person sharing
beside Spaces. That work is built on the rolling v3.4 branch, because v3.4 (immich-32523) rewrites upstream's person
queries around one row per owner, and lands with that cutover. Its design is
`specs/2026-10-28-adopt-upstream-person-groups-design.md`.

This split is the interim that unblocks switching users until then. It lands on `main` in fork files only
(`migrations-gallery`, `src/gallery`, `src/schema/tables`, the revert script) so the fork sync carries it onto
rolling. Three consequences:

- **The rejoin is a contract.** Option 2's "drop the index" slice starts by calling `rejoinSplitPersonGroups`. The
  split → rejoin round trip is therefore the most important guard here, and the rejoin is an exported function a
  later fork migration can call, not only `down()` and the revert script.
- **The side tables are temporary.** `person_group_split` and `person_group_split_share` are emptied and dropped by
  option 2. Nothing may read them besides the rejoin, and they are not exposed in the API.
- **No new one-row-per-group dependencies.** The split is plain SQL. It adds no `getByGroupIdOnly` or
  `withPersonAnyOwner` caller and no lookup keyed by `personGroupId` alone. Option 2 has to unwind every such
  dependency.

## How a group gets several person rows in Immich 3.3

Two upstream paths, both available only to users in the same cluster group (`user.clusterGroupId`):

1. **Facial recognition (the common one).** `PersonService.handleRecognizeFaces` searches faces with
   `clusterGroupId`, so user B's face can match a group A created. If B has no row in that group, upstream creates
   one (`personRepository.create({ ownerId, faceAssetId: face.id, personGroupId })`) and assigns the face. No
   `person_user` row is involved. This runs for every face once users join a cluster, which is how an instance reaches
   thousands of shared groups.
2. **Person sharing.** A `person_user (personGroupId, sharedById, sharedWithId, role)` insert fires
   `person_user_after_insert`, which creates the recipient's row in the sharer's group, copying `name` and
   `birthDate`. `person_user` has FK `(sharedById, personGroupId) -> person(ownerId, personGroupId)`
   `ON UPDATE CASCADE ON DELETE CASCADE`. `person_delete_shares` deletes a share when its recipient row is deleted.

In both cases each row holds per-user state that cannot be re-derived: `name`, `birthDate`, `isHidden`,
`isFavorite`, `thumbnailPath`, `color`, `faceAssetId`. Faces are group-level: `asset_face.personGroupId` points at
the group, and a face's owner is its `asset.ownerId`.

## Upstream already defines the split

When a user leaves or switches cluster group, upstream's `PersonRepository.reassignCluster` splits that user out of
every shared group:

- a group nobody else has a row in moves across whole;
- for every other group, the user gets a new `person_group`, their `person` row is repointed with
  `UPDATE person SET personGroupId = <new>`, and the faces in the old group whose `asset.ownerId` is the user move
  with it.

`reassignCluster` never touches `person_user`. Shares the user gave follow the `ON UPDATE CASCADE` FK, and shares
they received are left pointing at the old group. The split below takes the shares out first to avoid both.

The split applies the same per-row operation, keeps cluster membership, and records it so it can be undone. One-person
groups of different users inside one cluster are a state stock Immich creates itself, after a cluster join and before
`regenerate-people` reclusters, so stock Immich copes with a split database.

## Options

| Option                                                   | Unblocks   | Data on revert     | Adoption later                  | Verdict                                         |
| -------------------------------------------------------- | ---------- | ------------------ | ------------------------------- | ----------------------------------------------- |
| Keep refusing                                            | no         | n/a                | n/a                             | status quo                                      |
| User leaves the cluster group in Immich before switching | yes, today | lost in Immich too | starts over                     | interim advice only                             |
| Quarantine the extra rows in a side table                | yes        | restored           | restored                        | rejected: B loses their people while on Gallery |
| Drop `person_personGroupId_key` now                      | yes        | n/a                | it _is_ adoption                | option 2, on rolling v3.4                       |
| **Split on the way in, record, rejoin on the way out**   | yes        | restored           | rejoin is option 2's first step | **this spec**                                   |

## Design

Code: `server/src/gallery/utils/person-group-split.ts` (the statements, `splitSharedPersonGroups`,
`rejoinSplitPersonGroups`), `server/src/schema/migrations-gallery/1790900000000-SplitSharedPersonGroups.ts`,
`server/src/schema/tables/person-group-split{,-share}.table.ts`.

The migration carries a **frozen copy** of the statements, so editing the live module never changes a released
migration. The live module is what the revert script must match (`revert-to-immich.spec.ts` pins that) and what a
later fork migration, such as option 2's, calls.

### Tables

```
person_group_split (
  splitGroupId    uuid PK  FK person_group(id) ON DELETE CASCADE   -- new group the row moved to
  originalGroupId uuid     FK person_group(id) ON DELETE CASCADE   -- group it left
  ownerId         uuid     FK user(id)         ON DELETE CASCADE
)

person_group_split_share (                    -- verbatim copy of person_user
  personGroupId, sharedById, sharedWithId, role, createdAt, updatedAt, updateId
  PK (personGroupId, sharedById, sharedWithId)
  FK sharedById, sharedWithId -> user(id) ON DELETE CASCADE
)
```

`person_group_split_share` has no FK onto `person`: it holds shares whose recipient row now lives in another group.
The five FKs onto upstream keys are listed in `server/src/schema/gallery-upstream-fks.json`.

### Migration `1790900000000-SplitSharedPersonGroups`

A deliberate pre-step for the fork's own `1791000000000`, numbered between them. Name order matters only where both
run in one pass: a switch from Immich, where every fork migration runs after the upstream ones, and a fresh install.
`1790616293884-PersonSharing` sorts before it, so `person_user` always exists. On a Gallery database that already ran
`1791000000000`, it runs last and finds nothing to split because of the unique index.

`up()` is idempotent (`CREATE TABLE IF NOT EXISTS`, and it only acts on groups that still hold several rows), for the
downgrade path below. Three statements:

1. **Snapshot every `person_user` row** into `person_group_split_share` and empty `person_user`. Every share sits in
   a multi-row group (the trigger guarantees a recipient row). Emptying it means no `ON UPDATE CASCADE` fires in
   step 3, and it matches Gallery, where sharing is dormant and nothing writes or syncs `person_user`.
2. (Same statement as 3.) **Keep the oldest row** per group (`person.createdAt`, ties by `ownerId`), in practice the
   row of the user whose face created the group.
3. **Split every other row**, in one statement:
   - insert a `person_group` with a new id and the same `clusterGroupId`;
   - repoint the `person` row (an UPDATE, so all per-user state stays);
   - move the faces in the old group whose `asset.ownerId` is that owner, as `reassignCluster` does;
   - write `person_audit (<old group>, owner)`;
   - record a `person_group_split` row.

A move is an UPDATE, so no delete trigger fires. Sync sends person deletes from `person_audit` filtered by `ownerId`
with `personGroupId as personId`, and the mobile `person` table is keyed by that id, so the audit row removes the
stale `(owner, old group)` row. The UPDATE bumps `updateId` (`updated_at` trigger), so the moved row is upserted under
its new id, and the moved faces are re-sent the same way.

Faces in a group whose asset owner has no row in it stay with the kept row. `cluster_group`, `cluster_group_request`
and `user.clusterGroupId` are untouched. Gallery's recognition is owner-scoped and never searches by
`clusterGroupId`, so no new multi-row group forms while on Gallery.

### Rejoin

`rejoinSplitPersonGroups` runs the inverse. It needs `person_personGroupId_key` gone.

- On a switched database, `down()` gets that from `1791000000000`'s `down()`, which runs first: Kysely undoes
  migrations in execution order (`#getExecutedMigrations` sorts by timestamp, then name), and the pre-step ran before
  `1791…`.
- Anywhere else the pre-step ran last and is undone first, with the index in place. That is harmless while nothing is
  split. If something is split there (option 2's index-drop `down()` can re-split any database), `down()` refuses with
  a message naming the way out, instead of failing on a unique violation.

1. For each split row whose person still exists in its split group: move the row and every face in the split group
   back to the original group. That includes faces merged in on Gallery, which follow the person. Write
   `person_audit (<split group>, owner)`.
2. Delete each split group left with no person and no faces (`person_group_delete_audit` records it).
3. Restore the shares with `person_user_after_insert` disabled. Otherwise its `ON CONFLICT DO UPDATE` refills a
   recipient's emptied name from the sharer and the round trip is not exact; the medium test fails without it.
   A share is skipped unless both its sharer's and its recipient's rows are in its group: the FK forbids the first,
   and upstream's delete trigger would have pruned the second.
4. Empty both split tables.

A person deleted or merged away on Gallery stays that way. Its faces stay in its split group.

**Fork rows on a split group** follow the group's FKs when step 2 deletes it:

- `person_identity`, `person_pet` and `face_repair_decline` cascade (the latter through both `personGroupId` and
  `suspectedOwnerId`);
- `face_person_verdict.personGroupId` is set to null;
- `face_repair_scan_flagged_face` holds plain ids with no FK, so a stale scan keeps the split group's id. The precedent
  for clearing those is `1793300000000-ClearPreOptionMFaceRepairScans`.

For the revert script and `down()` that is correct, since those tables are dropped anyway.

**At split time those tables hold nothing for the split groups.** The split only finds multi-row groups on a database
switching from Immich. There every fork table is new and empty, and the face-review tables, though created before the
split, have not been written. So the moved owner's verdicts and declines staying on the kept group cannot arise; no
move is needed. Option 2 keeps them, so before it calls the rejoin it moves each split group's fork rows onto
`originalGroupId`:

- the split group's `person_identity` row is dropped, since there is one identity per group;
- `person_pet`: the original group's row wins;
- verdicts and declines go through `retargetVerdictPersonId` / `retargetDeclinePersonId`.

Its medium test asserts that no fork row is lost across the rejoin.

**Revert script.** `scripts/revert-to-immich.sql` section 0b runs the same statements (whitespace aside), after
`DROP INDEX IF EXISTS "person_personGroupId_key"` and before section 2 drops the split tables.
`revert-to-immich.spec.ts` checks the text and its position. A medium test runs the block taken from the script.

### Downgrades to an older Gallery build

On a switched-and-split database, undoing the pre-step means undoing everything applied after it, including
`1791…`, which an older build would re-run and fail on exactly as today. The older build is fine with the split state,
since every group holds one row. So `docs/docs/install/upgrading.md` tells that user to delete only the pre-step's
`gallery_migrations` row and keep the tables. Upgrading again re-runs the idempotent pre-step, and reverting to Immich
must be done from a build that has the rejoin.

On every other Gallery database the pre-step was applied last and is undone first: an empty rejoin, then the tables
are dropped. The guide now also says to check every listed name, not only the newest, since the command undoes the
most recently applied migration.

### What users notice while on Gallery

User B's copy of a shared person shows only faces on B's assets. A's faces of the same human stay under A's person.
Every person keeps its name, birth date, hidden and favourite state, and thumbnail. Shares are invisible, as they
already are (sharing is dormant). Upstream's `getVisiblePeopleQuery` also counts faces on partner and shared-album
assets; Gallery's global People page counts own assets and timeline-enabled Spaces only, so those drop out too
(reported by a parallel session reading upstream, not re-checked here). Option 2 makes the global People page count
partner and shared-album faces for everyone.

## Follow-up: link the split rows to one face identity

Not needed to unblock the switch. It keeps the "same human" fact as Gallery data instead of only as a revert payload,
and matches option 2's end state: one `face_identity` per person group, shared by every owner's row in it.

A multi-row group has the shape of one Gallery identity with several owners' people on it. Upstream's PK
`(ownerId, personGroupId)` allows one person per owner per group, and `person_identity_ownerId_identityId_key` allows
one person per owner per identity. After the split each owner has at most one row per original group, so the kept row
and its split rows can share one identity without breaking that key.

It cannot run inside `1790900000000`. On a switched database, `person_identity` does not exist yet (it is created by
`1798600000000-AddPersonIdentityTable`), and identities are created afterwards, one per person, by the backfill job
(`FaceIdentityRepository.backfillPersonalIdentities` → `ensurePersonIdentity`). So it is a job that runs after that
backfill:

- it reads `person_group_split` and, per original group, merges the identities of the kept row and its split rows
  with `FaceIdentityRepository.mergeIdentities`, using source `'import'`;
- that reuses the existing guards: the owner/space profile-conflict count, and the embedding-consistency check that
  refuses automatic merges of embedding-distinct clusters, which also protects against a bad upstream cluster;
- it must be keyed by the original group, not by `personGroupId` alone.

**Scope (decided by Pierre, 2026-10-28): every split group is linked**, not only groups with an explicit
`person_user` share. The users who pooled recognition joined the cluster group, and option 2's end state (upstream
behaviour, one card per human) treats every multi-row group as one human. The job therefore walks all of
`person_group_split` and does not consult `person_group_split_share`.

## Interim advice for a user who cannot wait

Untested, and it changes their Immich data. In Immich, every member but one leaves the cluster group (Account settings
→ Sharing). Upstream's `reassignCluster` performs the split above, after which the switch passes `1791…`. The cost:
the cross-user grouping is gone in Immich too, until they rejoin and run `regenerate-people`. Take a `pg_dump` first.

## Guards

- `server/test/medium/specs/migrations/split-shared-person-groups.migration.spec.ts` seeds a three-user cluster
  through upstream's paths:
  - a recognition-style second row, and a face whose asset owner has no row;
  - shares in a chain, with the recipient's name cleared afterwards;
  - hidden and favourite rows, and a one-owner control group.

  It checks:
  - the split state, and that `person_personGroupId_key` can be created on it;
  - the idempotent second `up()`;
  - `down()` restoring `person`, `person_group`, `asset_face`, `person_user` and `user` exactly, minus
    `updatedAt`/`updateId`;
  - a person deleted on Gallery staying deleted, with no orphaned share;
  - the revert script's block giving the same result;
  - that a database with nothing to split is left untouched, and undone cleanly with the index present;
  - `down()` refusing, and changing nothing, while groups are split and the index exists.

- `server/test/medium/specs/services/database-migration.service.spec.ts` ("Switching from Immich 3.3 with people shared between users"), the switch end to end. It sits beside the other from-scratch scenarios because upstream's `1746636476623-DropExtraIndexes` runs `ALTER DATABASE`, a cluster-wide catalog write, so two files migrating fresh databases at once collide:
  - it builds a database with upstream's migrations alone (the folder is Immich v3.3.5's) and stock Immich's migrator
    settings;
  - it seeds 150 multi-owner groups with random owners, creation orders, per-user state, soft-deleted and hidden
    faces, rowless faces, chained shares and cleared names, plus a pending cluster request and an outsider;
  - it boots Gallery through `DatabaseRepository.runMigrations` (the call that failed) and checks the split row by row:
    every person and face kept with its state and lineage, faces with their owner, shares verbatim, audit rows;
  - it reboots Gallery (nothing to do), trial-boots stock Immich's migrator (nothing pending, order intact), runs the
    full `revert-to-immich.sql` and requires Immich's tables to equal the seed exactly, boots stock again, then
    switches a second time;
  - it runs Gallery's identity backfill on the split database, reads every person of every user through
    `PersonService` (`getById`, `getStatistics` equal to that owner's photos, `getAll` own-only and unique), renames
    and merges on Gallery, then reverts and checks the rename and merged faces land in Immich's group;
  - it round-trips the CI fixture below on the same path.
- `server/test/medium/specs/sync/sync-person-group-split.spec.ts`: a phone applying the sync stream in order ends with
  the server's people and faces after the split, after the rejoin, and across both while offline.
- `.github/scripts/revert-to-immich-shared-people.sql`, seeded by the Gallery Revert-to-Immich Validation workflow
  into stock Immich before Gallery's first boot. The workflow checks the split after the Gallery boot, the stock trial
  boot and the return to Gallery, and after the revert requires a digest of the fixture's Immich rows to equal the
  seed's. This runs the real stock Immich server.
- `src/schema/revert-to-immich.spec.ts`: same statements, after the index drop, before section 2; plus the existing
  table, guard-list and migration-list checks.
- `gallery-upstream-fks.spec.ts`, `migrations-gallery/ORDER`, `test/medium/specs/schema-drift.spec.ts`.
- Checked by breaking the code on purpose: without the trigger disable, moving faces by the wrong owner, or without
  the audit rows, the tests above fail.

**Scale, measured:** 5,000 multi-owner groups, 11,666 people, 180,000 faces and 6,666 moves split in 1.1 s and rejoin in
1.2 s on a local Postgres.

## Open questions

1. **Clients after the switch** on a real device. The sync test covers the stream the server sends; it does not run
   the mobile app.
