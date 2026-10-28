# Adopting upstream person groups, person sharing and cluster groups

**Date:** 2026-10-28 · **Status:** design, reviewed against the code, not implemented · **Replaces, once landed:**
`specs/2026-08-22-option-m-invariant-inventory.md` (option M), `specs/2026-10-01-upstream-person-sharing-dormant-design.md`
(dormant sharing) · **Builds on:** `specs/2026-10-28-shared-person-groups-split-design.md` (the interim split, built
separately on `main`), `specs/2026-08-21-cluster-groups-consolidation-exploration.md` (the August options; this is
close to its option K) · **Rules:** AGENTS.md "Gallery sits on top of Immich", `specs/2026-10-10-gallery-on-immich-layering-design.md`.

References below: ROLLING is `origin/rebase/upstream-rolling-v3.4` at `a2410689fa2`; UPSTREAM is Immich `main` at
`11bf8753137`. Paths are under `server/src/` unless they start with another top-level folder.

## Intent

Gallery adopted Immich's person groups inertly ("option M"): the fork index `person_personGroupId_key` allows one
`person` row per `person_group`, the cluster-group controller is unmounted, and Immich 3.3 person sharing is dormant.
Immich's model allows one row per user in a group, and Immich users who shared people have data in that shape. They
cannot switch to Gallery: `1791000000000-RepointFaceReviewToPersonGroup` refuses with "Cannot enforce one person per
person_group" (first report: 4913 groups).

The split (separate spec) unblocks them now by splitting those groups. This design is the long-term fix: Gallery
accepts Immich's data shape as Immich defines it, runs Immich's people code where it can, and switches Immich's
cluster groups and person sharing on, next to Spaces.

Why this direction, from the investigation of 2026-10-28:

- Upstream's model cannot replace Spaces people. A user is in exactly one cluster group (`user.clusterGroupId`), a face
  carries one `personGroupId`, and sharing a person is user-to-user with no context and grants no asset access. Each
  user keeps their own row with their own name: the share trigger copies the sharer's name and birth date once, and
  later edits reach other owners only through a write grant (`updateForWritableOwners`). Spaces overlap and carry one
  collaborative name, aliases and Editor roles.
- It can sit underneath them. Gallery's `person_identity` and upstream's `person` (PK `(ownerId, personGroupId)`)
  describe the same shape: a multi-row Immich group is what Gallery calls one identity with several owners' people on
  it. Spaces people are keyed on `face_identity` and face ids and have no foreign key onto `person`.
- Option M's cost grows every rebase: each upstream people commit assumes several rows per group and arrives as a bug.
  Upstream doubled down in v3.4 (immich-32523 copies the asset owner onto `asset_face.ownerId` and rewrites the person
  queries around one row per owner).
- The owner's standing tie-break is to stay as close to the Immich baseline as possible.

Making `person_group` Gallery's identity layer now (replacing `face_identity`) was considered and rejected: a person
group belongs to one cluster group while Gallery identities span users in different cluster groups, the per-face
evidence model still needs its own table, and Spaces people would have to be re-keyed. "One-way doors and the path to
full adoption" below records how this design keeps that option open.

## Goals

1. An Immich database with shared people (multi-row groups, `person_user` rows, cluster groups) switches to Gallery
   with its data unchanged.
2. Users can share people both ways: Immich-style (cluster groups and person sharing, exactly as Immich ships them)
   and through Spaces (unchanged).
3. The same human shows as **one person card** in Gallery, however it reaches the user (own library, a Space, an
   Immich share).
4. The person files move toward upstream's text. Each slice reports whether `repositories/person.repository.ts`,
   `services/person.service.ts`, `utils/access.ts`, `repositories/access.repository.ts` and `utils/database.ts` grew or
   shrank against the upstream tag.
5. Stock Immich at the base version boots on a Gallery database and serves every owner correctly, including shared
   people. Reverting to Immich keeps the sharing state (exception: pets, below).
6. Nothing in the end state makes a later full adoption of Immich's model harder than it is today.

## Non-goals

- Changing Spaces people: shared names, aliases, Editor roles, deduplication, the recognition pipeline.
- A Gallery variant of upstream's sharing or cluster groups. Upstream's rough edges are taken as they are and, where
  worth it, offered upstream: leaving a cluster group leaves received shares behind; `getRandomFace` can pick a
  thumbnail from a photo the viewer cannot see; `updateGroupId` and `reassignCluster` move a person to a new group id
  without a `person_audit` row, so synced clients keep a stale local person.
- Mobile sharing UI. Upstream's mobile app has none.
- Replacing `face_identity` with `person_group` now.

## Anti-goals

The design has failed, even if it works, if:

- one user's action changes another user's people in a way upstream would not;
- a Space member loses access to a person they can read today;
- a Space behaves differently in any way a user can notice, except through an Editor's own action;
- a downgrade to a pre-adoption Gallery on the same upstream base, or a revert to Immich, loses data;
- a slice ships a window where several rows per group can exist but some code still assumes one;
- a non-admin user can trigger an instance-wide destructive job.

## Constraints

- **Built on the rolling v3.4 branch** (`rebase/upstream-rolling-v3.4`), not `main`, and lands on `main` with the v3.4
  cutover. Reason: v3.4 rewrites the person queries this work touches, so building on `main` would resolve every
  slice twice. Same precedent as the August mobile person-model work. Slices get CI by dispatch, not PR CI, and are
  replayed by every rolling cycle.
  **Reopened, for the owner (found 2026-10-28 after the decision):** `main` moved to the Immich v3.3.5 base the same
  day. v3.3.5 already carries the person-query rewrite and `asset_face.ownerId` (immich-32593, identical to
  immich-32523; `git diff --stat refs/upstream/v3.3.3 refs/upstream/v3.3.5` shows the same 452-line
  `person.repository.ts` change). Between v3.3.5 and rolling's upstream base `cf719e733e6`, upstream's person files
  differ only by immich-28410 (recognition wrapped in `withLock(DatabaseLock.FacialRecognition)`), the native set
  operations refactor in `utils/access.ts` / `access.repository.ts`, and passkeys. So the "resolve twice" reason no
  longer holds. Building on `main` would ship sooner (no wait for the v3.4 tag), use PR CI, and keep downgrades to
  released builds on the same base. Until the owner decides, the rest of this document reads either way: replace
  ROLLING with `main` and drop the v3.4-only notes (the downgrade scope below, `upstream_image=commit-<sha>`).
- ROLLING took immich-32523's schema (`asset_face.ownerId`, `assetVisibility`, `assetDeletedAt`, the
  `asset_face_personGroupId_ownerId_assetId_timeline_idx` index) but kept Gallery's person queries
  (`specs/upstream-reports/2026-10-24-upstream-sync-v3.4-rolling.md`, "Option A"). This design adopts upstream's
  queries.
- Verified against UPSTREAM: nothing after v3.3.3 changes cluster groups, `person_user`, the
  person/person-group/cluster-group/user tables, or what person access grants. The 42 commits not yet on rolling touch
  only a web face-editor refactor and an album-share access fix.
- The index stays in place until slice 6. Every earlier slice must be safe and invisible with the index present. That
  includes switched Immich databases, which already hold multi-member cluster groups.
- The split ships first on `main` and reaches rolling by fork sync before slice 6 starts.
- AGENTS.md rules 1-5 apply. Fork logic goes in `server/src/gallery/` and the access seams; upstream files carry hooks.

## Design

### Data shape at the end

- `person`: upstream's table, no fork index. One row per user per group.
- `person_user`, `cluster_group`, `cluster_group_request`, `user.clusterGroupId`: upstream's, live.
- **Every row of a group shares one `face_identity`.** A group is one human for every owner in it. An identity may
  still span several groups (users in different cluster groups who share a Space, or one owner's unmerged people).
- **A face's identity equals its group's identity.** This invariant exists today: the identity backfill counts a
  mismatch as pending work (`gallery/repositories/face-identity.repository.ts` `getBackfillWork`) and repairs it
  (`repairPersonalIdentityAssignments`, then `repairSpacePersonIdentityAssignments`). Every path that changes a face's
  group or a group's identity must keep it, or the backfill job "repairs" it later and re-keys a Space without an
  Editor (see "Combining groups").
- **An owner may have several people on one identity.** Upstream allows an owner two unmerged groups that are the same
  human; cluster recognition creates exactly that. The unique `(ownerId, identityId)` on `person_identity` would
  block upstream's own recognition, so it is dropped. The person card stays single because Global People is keyed by
  identity.
- `person_identity` and `person_pet` stay keyed by `personGroupId` (identity and species belong to the human).
  `person_identity.ownerId` goes, with its FK registry entry `person_identity_ownerId_fkey`. Readers already join by
  group only (`gallery/utils/person-sidecar.ts`), so this matches what they assume. Writers that use `ownerId` or the
  uniqueness, all changed in slice 4: `person-sidecar.ts` `clearOrphanPersonIdentity` and `setPersonIdentity`;
  `person.repository.ts` `getOrCreateOwnerPersonForIdentity` (its `onConflict(['ownerId','identityId'])` is also its
  race guard and becomes an advisory lock on `(ownerId, identityId)`); `face-identity.repository.ts` `mergeIdentities`
  (the `NOT EXISTS … target_identity.ownerId` update) and the personal arm of `countMergeConflicts`; migration
  `1798600000000`'s `down()`; e2e and medium fixtures that insert `ownerId`.

### Reads: whose row

A read that needs "the person for this face" uses the viewer's row when the viewer has one, then the face owner's,
`(asset_face.ownerId, asset_face.personGroupId)`. That is upstream's order. The fork's third fallback, "any row", goes.
The Space case (a member with no row in the group) resolves to the face owner's row.

`getByGroupIdOnly`, `withPersonAnyOwner` and `createWithGroup` disappear: every caller names an owner. Where the
caller is a Space member reading someone else's person, the owner is the face owner or the space person's profile
owner, never "any".

Faces whose asset owner has no row in the face's group exist today: `createFace` lets a Space Editor put a face on a
member's asset into another owner's group, possibly across clusters. Stock Immich ignores them harmlessly, but under
the rule above they resolve to no person. Slice 0 counts them; slice 2 gives each such face's asset owner a row in the
group (copying the group owner's name, as the share trigger would) or moves the face, builder's choice, recorded.
After that, a Space Editor's `createFace` on another member's asset creates the asset owner's row the same way.

### Writes and group-level actions

Every write to `person` names an owner. Today `mergePersonProfile` updates and deletes by group alone
(`person.repository.ts:323`, `:346`); on a multi-row group it would overwrite, move the faces of, and delete other
owners' people.

Sidecars are group-keyed, so these actions change every owner's view of the group, and each needs an explicit rule:

| Action | Rule (my call) |
| --- | --- |
| Mark as pet / set species (`writePersonSidecars`) | Group-level: a pet is a pet for everyone. Allowed when the caller may edit every row in the group under upstream's roles (own row, or a write share from each other owner); otherwise 400. |
| Separate a profile from an identity (`detachScopedProfile`) | Per owner: moves the caller's row to a new group (with a new identity), never re-keys the group's identity for everyone. |
| Re-point one profile in the merge planner (`updatePersonIdentity`) | Same as "separate": moves the caller's row, not the group. |
| `ensurePersonIdentity` | Group-level and idempotent: one identity per group, shared by every row. |
| Identity name and birth-date write-back (`utils/person-identity.ts` `applyResolvedIdentityMetadata`) | Writes only rows whose own name (or birth date) is blank, and only the caller's own rows on an interactive action. Never overwrites another owner's chosen name. Slice 4 confirms where this runs today (the #808 overlay resolves at read time; the write-back path must be checked). |

### Access

Upstream's person checks live in a separate function, `checkPersonAccess` (`utils/access.ts:70-97`), keyed by
`{personGroupId, ownerId}`. Gallery's grant seam (`gallery/utils/access-grants.ts`, `withGalleryGrants`) hooks only the
string-id `checkAccess`, and today Gallery replaces the person cases inline (`utils/access.ts` ~368-381). Design:

- Upstream's `checkPersonAccess` becomes the person authorization. Gallery adds a **second seam inside it**: for
  `PersonRead` only, a `(personGroupId, viewerId)` pair is granted when a visible face of the group is on an asset the
  viewer reaches through a Space (`gallery/repositories/access.repository.ts` `checkSharedSpaceAccess`). One call into
  a fork module, same shape as the existing seam.
- **Read hooks per endpoint.** After the check, upstream reads the viewer's own row (`getByGroupId`, `getStatistics`,
  `getForThumbnail` with `ownerId: auth.user.id`), which a Space member does not have. Each endpoint a Space member
  reaches today gets a read hook that falls back to the face owner's row, keeping Gallery's narrowings:
  `GET /people/:id` (identity fallback `getAccessiblePersonByProfileId`), `GET /people/:id/statistics` (Space-scoped
  counts), `GET /people/:id/thumbnail` (with `checkUnlockedThumbnailAccess`; upstream has no Locked check),
  `GET /people/:id/faces` and `/faces/:faceId/thumbnail` (`gallery/services/gallery-people.service.ts`, scoped to the
  member), `POST /faces` (`createFace`, which needs only `PersonRead`).
- **Space Editor representative face** (`PUT /people/:id/representative-face`, `gallery-people.service.ts:155-197`)
  writes the owner's own row today, which upstream would never allow. My call: an Editor acting from a Space sets the
  Space person's representative face (`shared_space_person` already has one with `auto`/`manual` source), and the
  owner's own thumbnail no longer changes. The Space view looks the same; the owner's library stops being edited by
  others.
- Edit, delete and merge otherwise stay upstream's. The fork's inline person cases go. The access oracle changes and
  is reviewed permission by permission.

### Identity layer

- Automatic merges keep a **personal-conflict refusal**: a `shared-space-evidence` or reconciliation merge that would
  put two of one owner's people on one identity is refused (`shared-space.service.ts` ~3307-3314,
  `person.service.ts` ~1010, "Auto-collapsing a user's own people could be wrong"). Dropping the uniqueness must not
  let Space evidence fuse an owner's deliberately separate people.
- The merge planner (`services/identity-merge-propagation.service.ts` `buildPlanFromOrigins`) loses its per-owner
  collapse (one survivor per owner, the rest deleted). It keeps the per-Space collapse, because
  `shared_space_person_spaceId_identityId_key` stays, and keeps the gate that blocks collapsing people in a Space the
  actor cannot edit (`utils/merge-policy.ts` `unrepairableSpaceCollapseIds`, moved into the planner).
- Hydration in Global People already handles several own profiles (`primary_rn`, `face-identity.repository.ts` ~2129)
  and counts identity-wide. With several own profiles: the primary stays today's ranking; the card is hidden only when
  every own profile is hidden; rename and hide from the card act on the primary, and the person page lists the
  owner's other profiles on that identity so they can be merged with upstream's merge.
- Metadata inheritance (`shared-space.repository.ts` `getMetadataInheritanceCandidates`) counts one vote per owner,
  not per profile. `getOrCreateOwnerPersonForIdentity`'s pick gets a deterministic order (oldest first).

### Combining groups (my call)

Paths that put faces of one group into another, or merge groups: upstream's `mergePeople`, the rejoin in slice 6,
cluster recognition joining a member's group, and upstream's `reassignCluster` moving rows to fresh groups.

- **Merge** (`mergePeople`, `POST /people/:id/merge`): the identities of the merged groups are merged with
  `mergeIdentities` in the same request, after the person merge, so the face-equals-group invariant holds when the
  request returns. If `mergeIdentities` would refuse (one Space holds a space person on each identity), the identity
  merge goes through the planner, which collapses those Space people when the actor can edit that Space and refuses
  the whole person merge otherwise (400 naming the Space). This is the one place Gallery refuses something upstream
  allows; the alternative is the backfill re-keying a Space nobody chose to change.
- **Rejoin** (migration): with decision 3 every split group already shares the original group's identity, so nothing
  is merged. A split group whose identity differs (linking had not run, or a later separate) keeps its people
  out of the rejoin: the rejoin skips that row and records it, and a post-boot job offers the merge through the
  person's page. No Space changes inside a migration.
- **Cluster recognition**: the face takes the group it matched, and its identity link is set to that group's identity
  in the same job (`replaceFaceIdentity`). The asset owner's new row in the group shares the group's identity.
- **`reassignCluster`** (join or leave a cluster group) **and `deleteEmptyGroups`**: a hook copies the fork rows of each
  old group onto the user's new group before upstream's code runs (identity, species), and moves the leaving user's
  verdicts and declines. Without it, the new group has no identity (a second card appears) and the cascade on
  `deleteEmptyGroups` deletes fork rows. `updateGroupId` (merge moving a row) gets the same hook.

### Recognition

Adopt upstream's `handleRecognizeFaces` / queue-all and keep Gallery's behaviour as hooks. The list is long and each
item is behaviour users have today:

- candidate search drops soft-deleted faces (`asset_face.deletedAt`, the "not a face" tombstone);
- a Space identity match (`findClosestAccessibleSharedIdentity`) makes a face core and lifts the "matched only itself"
  skip; that check runs after the deferral;
- `skipSharedSpaceMatch`;
- already-assigned faces still get `replaceFaceIdentity` and Space face-match queueing;
- after assignment: `replaceFaceIdentity`, `mergeWithAccessibleSharedIdentity`, `queueSharedSpaceFaceMatchesForAsset`;
- queue-all: the bounded `PeopleBackfill` wait, `empty(FacialRecognition)` on force, `excludeManuallyPlaced`,
  `excludePetFaces`/`excludePets`, the identity/Space/verdict wipes, `SharedSpaceFaceMatchAll`,
  `FaceIdentityMaintenanceAfterRecognition`.

Slice 5 pins today's candidate-search SQL with a test before switching handlers.

**Pooled search waits for slice 6.** With the index present, a pooled match creates a second row in a group and the
job fails on every retry; switched Immich databases already have multi-member cluster groups. Slice 5 keeps the
search owner-scoped (`userIds: [ownerId]`); slice 6 switches it to the cluster.

**Force runs are scoped.** Upstream's `regeneratePeople` lets any cluster member queue
`FacialRecognitionQueueAll { clusterGroupId, force: true }` (`services/cluster-group.service.ts:75-81`). On Gallery's
force branch only `unassignFaces` and `getAllFaces` respect `clusterGroupId`; `unlinkFacesBySourceType`,
`deleteAllPersonFaces`, `deleteAllPersons` (every `shared_space_person` on the instance), the identity GC and the
queue `empty()` run instance-wide. Mounting the controller as is would let a non-admin wipe every Space's people.
Before slice 7 mounts it, every wipe on the force branch is scoped to the cluster's users (Space people: only faces on
those users' assets, and only space people left empty), the queue is not emptied for a cluster-scoped run, and a test
proves a cluster member's force run leaves other users' and other Spaces' data untouched.

### Merges (decision 1, restated precisely)

Upstream's `mergePeople` (`services/person.service.ts:662-729`):

- requires the caller to own a row in every merged group (`PersonMerge` checked as `{personGroupId, ownerId: me}`;
  a share never satisfies it), so cluster membership alone is not enough;
- then merges the other owners' rows in those groups (`getForMergePerson` filters by group only): an owner with no
  target row has their row and faces moved (`updateGroupId`); otherwise blank name and birth date are filled from the
  source, faces move per asset owner, the source row is deleted, and its hidden, favourite, colour and thumbnail are
  lost; an owner whose target and source rows both have a name, or both a birth date, is skipped;
- shares follow by cascade: moved rows keep their outgoing shares, deleted source rows lose theirs.

Gallery takes this as is and removes its own cross-owner policy: the instance setting `mergePeopleAcrossOwners`, the
`confirmCrossOwner` flag and the cross-owner half of `utils/merge-policy.ts`, with their web prompts
(`web/src/lib/utils/cross-owner-merge.ts`, the merge modals, the People and Space people pages) and admin setting
(`ServerSettings.svelte`, the system-settings and config-file docs). Released apps still send `confirmCrossOwner`;
the DTOs accept and ignore it. A stored `mergePeopleAcrossOwners` value is ignored. The Space-collapse gate stays (it
is a Space permission, not a cross-owner policy). Merging one's own person with someone else's (no own row in the
other group) is no longer `POST /people/:id/merge`; it stays available as an identity merge (`POST /people/same-person`,
Space merges), which after slice 4 never deletes another owner's people.

### Global People (decision 2)

`getAccessiblePeople` stays identity-keyed. Its face scope widens to own, partner and shared-album assets, plus Spaces
shown in the timeline, for everyone. Rules (my calls where upstream and Gallery differ):

- partner and shared-album faces **count** toward identities the viewer has a profile on; they do not create cards
  for identities the viewer has no profile on (upstream's rule);
- the new partner and shared-album arm follows upstream (Timeline only, partners regardless of `inTimeline`, per
  immich-32219); own and Space faces keep Gallery's rules (Timeline and Archive, `isOffline = false`);
- hidden as in "Identity layer".

The RBAC oracle snapshots change in slice 7 and are reviewed then. Release note required.

### Face review, verdicts, declines

Current keys: verdicts unique `(personGroupId, assetFaceId)` and `(spacePersonId, assetFaceId)`, and a rejection
also matches by identity, so "not Anna" covers every scope; declines unique `(assetFaceId, suspectedOwnerId)`, with
person-level declines keyed by group. In a shared group, today's pending queue (`getPendingForPerson`, group only, no
asset-owner filter) would show B the faces on A's assets, and B's confirm would write A's `asset_face`.

- Pending reads and claims filter `asset_face.ownerId = caller` (the column exists on ROLLING).
- Person-level declines and the repair scan key by `(ownerId, personGroupId)`; `face-repair-scan.repository.ts`
  stops mapping a group to one owner.
- Identity-keyed rejections keep applying across owners, as they do today through Spaces (my call: a rejection is
  about a face and a human, not about whose library it is).

### Switching the features on

- Mount `ClusterGroupController` (only after the force-run scoping above); remove `personSharingUnsupported()` and
  the `userId` override refusals; let `PersonResponseDto.otherPeople/sharedBy/sharedWith` and the `PersonSearchDto`
  filters carry upstream's values.
- Restore upstream's web: `SharingSettings.svelte` with its cluster-group half and its two modals
  `ClusterGroupUserSelectionModal.svelte` and `ClusterGroupUsersModal.svelte` (deleted on ROLLING and missing from
  `fork-deletions.spec.ts`), `person-user.service.ts`, `PeopleFilterModal`, `PeopleFilterUserPicker`,
  `PersonEditAccessModal`, `PersonEditModal`, `PeopleSelectionModal`, `PersonBulkShareModal`; upstream's
  `handleUpdatePerson` and `withUpdateStrategy` exports in `web/src/lib/services/person.service.ts`, which Gallery
  replaced; and the call sites on the `/people` and person pages, which Gallery forked. Where a screen touches a Space
  person it routes through the Space endpoints.
- Delete the invariants `person-sharing-dormant`, `people-merge-inert` and `person-join-not-viewer-filtered` in
  `docs/fork/ownership.yml`, their pinning specs, and the `fork-deletions.spec.ts` entries, in the change that makes
  each obsolete.

### Migrations

- **Numbering.** New fork migrations go above every existing fork migration (the newest on ROLLING is
  `1799000000000-AddAssetImageAdjustTable`; the newest upstream is `1792517020180-AddUpdateIdIndexes`), in slice
  order: slice 4 < slice 5 < slice 6. Numbered lower, they would run before `person_identity` (`1798600000000`) and
  `person_pet` (`1798700000000`) exist on a switched database.
- **Order per database type**, verified against `gallery-migration-ledger.ts` (one run in name order):
  Immich v3.3 switch: split, `1791000000000` (index), upstream `1792*`, slices 4-6 (drop and rejoin).
  Immich v3.4 switch: same, with `1792*` already applied. Fresh install: split and rejoin are no-ops, the index is
  created then dropped. Existing Gallery database: split already recorded, rejoin finds nothing, drop runs. Database
  that switched under the interim build: split tables full, rejoin restores them.
- **Frozen SQL only.** Migrations do not call repository methods (`mergeIdentities` opens its own transaction; the
  migration runs inside the ledger's) or live helpers that later slices change. Moves are plain survivor-wins SQL
  copied into the migration file. Anything that needs guards (identity merges) is a post-boot job.
- **Slice 6 migration `up()`**: drop `person_personGroupId_key`; move each split group's fork rows onto its
  `originalGroupId` (table below); call the frozen rejoin statements; drop the split tables; remove their entries from
  `gallery-upstream-fks.json` and their table classes from the schema registry.

  | Fork row on a split group | FK on `person_group` | Move |
  | --- | --- | --- |
  | `person_identity` | CASCADE | drop when equal to the original's; otherwise skip the row from the rejoin (see "Combining groups") |
  | `person_pet` | CASCADE | survivor-wins: copy species only when the original has none |
  | `face_person_verdict.personGroupId` | SET NULL | retarget, survivor-wins on the unique key (an orphan would lose its target silently) |
  | `face_repair_decline.personGroupId` and `.suspectedOwnerId` | CASCADE (both) | retarget both columns, survivor-wins |
  | `face_repair_scan_flagged_face.personGroupId`, `.suspectedOwnerId` | none (snapshot) | rewrite, or clear the stale scan as `1793300000000-ClearPreOptionMFaceRepairScans` did |

- **On a switch under the adoption build, no fork rows exist yet**: `person_identity` is created empty in the same
  run and identities come from the backfill job. Slice 4's backfill creates one identity per group across all its
  owners' rows (`ensurePersonIdentity` filtered by group only becomes correct, not accidental). The split's linking job
  never runs on this path, and does not need to.
- **Wasted work on a switch.** Under the adoption build a switched database runs the split and the rejoin in one pass:
  every face in a shared group is updated twice and clients re-sync those faces. Slice 6 measures this on a seeded
  database of 5000 shared groups. If it is too slow, the adoption build skips the split, the `1791000000000` guard and
  its index when the slice 6 migration is pending in the same run (all three are fork files); that needs a test per
  database type above.
- **Tests that pin the index move to slice 6**, not slice 7: `test/medium/specs/repositories/person-sharing-dormant.spec.ts`
  (expects the index error) and the tripwire in `test/medium/specs/repositories/person.repository.spec.ts` (~159-180,
  which also cites a stale `docs/superpowers/specs/…` path). The upstream tests Gallery removed
  (`cluster-group.service.spec.ts` ~302, `person.service.spec.ts` ~368 and ~1295) come back in slice 6.

### Downgrade

- **Scope** (corrected; applies if the work stays on rolling v3.4, see "Constraints"): a downgrade is supported to a
  pre-adoption build **on the same upstream base**, which in practice means rolling RC builds. Every released pre-adoption Gallery is on the v3.3 base, and its ledger bootstrap
  refuses the v3.4 upstream rows (`1792213725597`, `1792511451454`, `1792517020180`). Going back to a v3.3-based
  release is unsupported, like any downgrade across an upstream base; the upgrading doc says so.
- **Promise within that scope**: data created after adoption survives and comes back on re-upgrade. The older build
  runs owner-correct with sharing dormant; it does not have to show the shares.
- **`down()` order** is slice 6, then 5, then 4:
  - slice 6 `down()`: re-create the split tables from frozen DDL (not by importing `1790900000000`), split every
    multi-row group that exists then (3+ owners, chains and post-adoption cluster rows included; the split keeps the
    oldest row and parks all of `person_user`), copy the original group's identity onto each split group (allowed
    while slice 4's uniqueness is still gone), then re-create the index;
  - slice 5 `down()`: if verdicts or declines gained `ownerId`, use `person_group_split` to retarget the split-out
    owner's rows, or the key collapse collides on `face_person_verdict_personGroupId_assetFaceId_uq`;
  - slice 4 `down()`: restore `person_identity.ownerId` and the per-owner uniqueness by parking the extra people on an
    identity (unlink them, record the link in a fork table the re-upgrade restores).
- **The split's own `down()` must refuse cleanly** when the index exists and split rows remain (today it assumes
  `1791000000000.down()` already dropped the index, true only on switched databases), and the upgrading doc's
  exception must drop its "came from Immich" wording. Passed to the split's author.

### Revert to Immich

- After adoption the person tables are upstream's; there is nothing to undo on them. The split's rejoin block in
  `scripts/revert-to-immich.sql` is guarded by `to_regclass('public.person_group_split')` and stays for databases
  reverted before adoption or after a downgrade.
- Every new migration goes in the script's `kysely_migrations` / `gallery_migrations` handling as the revert workflow's
  "Verify migration coverage" step requires.
- **Pets** (my call, recorded): the revert deletes pet person groups whole (they are fork data Immich would show as
  people). A pet group shared by several owners loses every owner's row and its shares. Goal 5 has this one
  exception; the revert doc says so.
- If slice 6 changes the rejoin statements, the fork-row moves stay outside `personGroupRejoinStatements`, because
  `src/schema/revert-to-immich.spec.ts` requires the script to contain exactly those statements.

## One-way doors and the path to full adoption

**No step is irreversible in data.** Every schema step has a `down()` that keeps the data (above), and a revert to
Immich keeps the sharing state except shared pets. The soft doors are product commitments:

| Step | Reversible? | Why it is the right call |
| --- | --- | --- |
| Building on rolling v3.4 | Yes | Saves resolving every slice twice; only delays shipping. |
| Dropping the per-owner identity uniqueness | Yes (slice 4 `down()` parks extras) | Upstream's own recognition creates that state; keeping the rule would block upstream behaviour. |
| Dropping `person_personGroupId_key` | Yes (slice 6 `down()` splits) | The whole point: accept Immich's data. |
| Mounting cluster groups and sharing | Data yes; product no | Once users rely on sharing, removing it is a feature removal. Owner's decision. |
| Upstream merges across owners | Code yes; each merge no | Upstream's merges cannot be undone, in Immich either. Owner's decision. |
| Removing Gallery's cross-owner merge policy | Yes (code) | After slice 4 an identity merge no longer deletes other owners' people, so the policy protects nothing. |
| Widening Global People | Yes (code) | Matches upstream; needed for shared people to look as in Immich. |
| Linking every split group to one identity | Mostly | Identity links can be separated again per owner ("separate"), but not in bulk. Upstream already treats each group as one human. |

**Keeping full adoption open.** If upstream ever lets a person group span cluster groups (several clusters per user,
pools per album or context, anything Spaces-like), Gallery could replace `face_identity` with `person_group` and
re-key Spaces people onto it. This design keeps that mechanical by holding three invariants, each guarded by a test:

1. every person group maps to exactly one identity (structural: `person_identity` keyed by group);
2. a face's identity equals its group's identity (backfill invariant, kept on every path above);
3. Spaces people are keyed on identity and faces only, never on `person`.

Under these, full adoption is: for each identity, merge its groups with upstream's merge (owner by owner), after
which identity and group are 1:1 and `person_identity` is a rename table. A **collapse dry-run test** (T9 below) runs
that procedure on the coexistence fixture and proves nothing is lost. It is the executable form of goal 6.

## Tests

The aim is that no user loses data and nothing changes for anyone who did not act. Existing infrastructure to build
on: `test/medium/specs/services/database-migration.service.spec.ts` (`createRawDatabase`, `stockImmichMigrator`,
`preSplitGalleryMigrator`; scenario B migrates stock Immich then runs Gallery's migrations), the split's
`test/medium/specs/migrations/split-shared-person-groups.migration.spec.ts` (drops the index per test, seeds a
three-user cluster via `ctx.newUser({ clusterGroupId })`, `ctx.newPerson({ personGroupId })`, `ctx.newPersonUser`, and
has an exact-snapshot helper), `test/medium.factory.ts` (`newUser`, `newPerson`, `newPersonUser`, `newAssetFace`,
`insertClusterGroup`, `insertPersonGroup`), the access and RBAC oracles, `schema-drift.spec.ts`, the override-parity
and FK-registry specs, `revert-to-immich.spec.ts`, and `.github/workflows/gallery-revert-to-immich-validation.yml`
with `.github/scripts/revert-to-immich-data.sh`.

### T0 Invariant checker (slice 0)

A SQL invariant suite, run at the end of every migration test, every coexistence scenario and the e2e seed:
every person group with rows has exactly one `person_identity`; every face with a group is linked to that group's
identity or to none; every `person_user` row has both persons; no fork row points at a missing group, identity or
space person; every `shared_space_person` identity exists; every face's asset owner has a row in its group (after
slice 2); no group mixes owners from different cluster groups except through a recorded Space flow.

### T1 Per-slice invisibility (slices 0-5)

The access and RBAC oracles are unchanged after each slice. Each area changed in slices 1-5 has a test against the
multi-row fixture (index dropped in the test database) proving the new code is right with several rows, and the
existing suites prove it is unchanged with one.

### T2 Switch-in matrix from Immich (medium, slices 0 and 6)

Built on `database-migration.service.spec.ts` scenario B: run `stockImmichMigrator`, seed through upstream's own
tables and the `person_user` trigger, then run Gallery's migrations. Each scenario runs three ways: under the interim
build (split), under the adoption build (split and rejoin in one run), and switched under the interim build then
upgraded.

Scenarios: no sharing; one read share; shares both ways with write and admin roles; share-all (`createAllForOwner`)
including hidden and unnamed people; a chain A→B→C; a three-member cluster group with recognition-pooled groups and
no shares; recipient renamed, hid and favourited their copy; owner deleted a person after sharing (recipient copy
survives); a user who left a cluster (stale received shares); a pending `cluster_group_request`; an Immich cross-owner
merge already applied; a deleted user; faces whose asset owner has no row; a group with 3+ owners.

Assertions: upstream tables (`person`, `person_user`, `asset_face.personGroupId`, `person_group`, cluster tables)
equal the seed row for row, ignoring audit and `updateId` columns; T0 passes; each viewer's Global People shows one
card per human with the upstream face counts; access matches upstream's roles for every pair of users.

### T3 Real stock Immich in CI (slice 6)

The revert workflow gains a `stock-seed` phase in step 8: stock Immich creates a cluster group through its API
(invite and accept), shares people one by one and with share-all, and SQL adds faces including one whose asset
owner has no row. Then Gallery boots on that database (assert as T2), stock Immich boots on the live Gallery database
(each user's `/people` with `sharedBy`/`sharedWith` as before), the revert runs, and stock Immich is checked again.
On ROLLING the workflow needs `upstream_image=commit-<sha>`. A scale run seeds 5000 shared groups and records
migration time.

### T4 Round trips (slice 6)

- Immich → Gallery → revert → Immich: snapshot of the upstream person tables equal before and after.
- Adopted Gallery with post-adoption data (new shares, cluster-recognition rows, upstream merges, a 3-owner group) →
  `down()` slices 6, 5, 4 → older build boots and serves owners → re-upgrade: snapshot equal to before the downgrade,
  identities and verdicts included.
- The split's own `down()` refuses cleanly with the index present.

### T5 Coexistence (medium and e2e, slices 6-7)

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | A shares Grandma with B (same cluster); both in a Family Space | One Grandma card for A and for B; one Space person; Space name unchanged by B renaming their copy |
| 2 | A and B in a cluster; A and C in a Space only | C sees the Space person; C's recognition never pools with A's library |
| 3 | B merges two groups where A also has rows | A's rows merged by upstream's rules; Space person for that identity unchanged in membership; Space counts updated; T0 passes |
| 4 | B's merge would collapse Space people in a Space B cannot edit | 400 naming the Space; nothing changed |
| 5 | Space Editor merges space people whose identities sit on a multi-owner group | No other owner's `person` rows change |
| 6 | B leaves the cluster | B's new groups keep the identity (still one card); B's verdicts and declines follow; A unchanged |
| 7 | A deletes their person after sharing | B's copy and the Space person survive |
| 8 | A revokes a share; A is deleted; the Space is deleted | Each leaves T0 passing and nothing orphaned |
| 9 | B hides their copy | Hidden for B only; Space visibility unchanged |
| 10 | A marks a shared person as a pet | Allowed only with write on every row; then a pet for everyone |
| 11 | Face review: B opens their review queue on a shared group | Only faces on B's assets; B's confirm never writes A's faces |
| 12 | A cluster member force-runs recognition | Only that cluster's faces re-run; other users' people and other Spaces untouched |
| 13 | Recognition creates a row in a group while a merge runs on it | No duplicate rows, no lost faces (advisory lock on `getOrCreateOwnerPersonForIdentity`, `withLock(FacialRecognition)`) |
| 14 | Space evidence would merge two of B's own people | Refused (personal-conflict refusal) |
| 15 | Space Editor sets a representative face from a Space | Space person's face changes; owner's own thumbnail does not |
| 16 | Memories, birthdays and "people together" for A and B | Each owner's memories built from their own rows only |

The RBAC and access oracles gain actors in a shared cluster group with read, write and admin shares; their snapshots
change once, in slice 6 (shares) and slice 7 (face scope), each reviewed.

### T6 Cross-owner write guards (slices 1-4)

For every write (merge, delete, update, face reassignment, sidecar writes, name write-back, separate, detach), a
test with a multi-row group proves another owner's rows are unchanged unless upstream's roles allow it.

### T7 Raw SQL and payloads (each slice)

`sync-sql` against a live migrated database (only `does not exist` lines matter), a grep of `e2e/src` raw SQL on
`person`, `person_group` and `personGroupId`, and the JSON payloads (`face_repair_scan.persons`) — the surfaces option
M's landing missed.

### T8 Mobile (slices 6-7)

Gallery app and stock Immich app against a server with a two-user cluster and shares: People, the asset-viewer
people strip, person timeline, after a merge and after leaving a cluster. Records the upstream stale-row bug (no
`person_audit` on `updateGroupId`/`reassignCluster`) and, if cheap, a fork-side audit row as a fix offered upstream.

### T9 Collapse dry-run (slice 8)

On the T5 fixture, merge every identity's groups owner by owner with upstream's merge, then assert identity and group
are 1:1, T0 passes, and no face, share, name or Space person was lost.

## Slices

All on the rolling v3.4 branch, in order. Slices 0-5 change nothing a user can see; T1 holds after each.

| # | Slice | Done when |
| --- | --- | --- |
| 0 | **Inventory and harness.** Re-count on ROLLING every place that assumes one row per group: `getByGroupIdOnly` (20), `createWithGroup` (4), `withPersonAnyOwner` (2), ~26 `person` queries filtered by group alone, **~43** `asset_face`→`person` joins on group alone (about 4 already check owner), including `face-identity.repository.ts` (12 plus the backfill), `face-person-verdict.repository.ts` (4), `shared-space.repository.ts` (5), the gallery `access`, `filter-suggestion`, `smart-facet` and `pet-face` repositories and `utils/database.ts`; the sidecar helpers, `ensurePersonIdentity`, `updatePersonForTest`; keyed maps (`dtos/asset-response.dto.ts`, `gallery/utils/asset-response-overlay.ts`, `face-repair-scan.repository.ts`, `face-repair-decline.repository.ts`); faces whose asset owner has no row. Rewrite the option M inventory as this checklist. Lift the split's multi-row fixture into a shared helper. Build T0. | Checklist committed; fixture and T0 used by passing tests |
| 1 | **Writes.** Owner-scope every write to `person`; group-level sidecar rules (table above). | T6 for each write |
| 2 | **Reads.** Replace the three primitives and keyed maps with owner-keyed reads; adopt upstream's v3.4 person queries where Gallery has an equivalent; fix faces whose asset owner has no row. | Primitives deleted; multi-row fixture passes per area |
| 3 | **Access.** `checkPersonAccess` with the second seam; read hooks per endpoint; representative face through the Space person. | Oracles reviewed (person permissions unchanged for today's actors); Space-member endpoint tests pass |
| 4 | **Identity layer.** `person_identity` loses `ownerId` and the uniqueness (with advisory lock); personal-conflict refusal kept; planner loses only the per-owner collapse; hydration, inheritance and write-back rules; backfill one identity per group; hooks on `reassignCluster`, `deleteEmptyGroups`, `updateGroupId`. Migration above `1799000000000`. | Identity suites pass with multi-row groups; T0 |
| 5 | **Recognition and face review.** Upstream's handler with every hook; candidate SQL pinned; search still owner-scoped; force-run wipes scoped to the cluster; review and decline keys by owner. | Recognition suites pass; force-run scoping test (T5 #12) passes |
| 6 | **Drop the index.** Migration above slice 5's; fork-row moves and frozen rejoin; downgrade `down()`s; pooled search on; pinned tests flipped and upstream's removed tests restored; FK registry and schema registry cleaned; oracles gain cluster and share actors. Immich users with sharing can switch from here. | T2, T3, T4 green; scale run recorded |
| 7 | **Switch the features on.** Controller (after slice 5's scoping), routes, DTOs, web screens and services, invariants and fork-deletions entries, OpenAPI and SDK; remove the cross-owner policy; widen Global People. | Upstream's sharing and cluster-group tests pass; T5 and T8 green; oracle changes reviewed |
| 8 | **Docs and cleanup.** User docs for switching with shared people, the sharing settings, the merge behaviour change and the People page change; upgrading doc (downgrade scope); retire the dormant and option M docs; AGENTS.md drops the `person_personGroupId_key` exception. | T9 green; docs build |

Each slice lands as its own commits on rolling with a dispatched CI run, and states its person-file diff against the
tag.

## Owner decisions (2026-10-28)

1. **Cross-owner merges: upstream's rule, and Gallery's cross-owner policy goes.** See "Merges" for upstream's exact
   rule, which is narrower than first described: the caller must own a row in every merged group.
2. **Global People face scope: widened for everyone.**
3. **Identity linking at the split: every multi-row group**, not only explicit shares. Passed to the split's author.

## Calls made in writing this (owner to check)

- Build on rolling v3.4, land with the cutover.
- `person_identity` and `person_pet` stay group-keyed; `person_identity.ownerId` and the per-owner uniqueness go.
- An owner may have several people on one identity; automatic merges still refuse to fuse an owner's own people.
- Group-level sidecar rules: pets need write on every row; "separate" moves only the caller's row.
- A person merge that would force a Space change the actor cannot make is refused (the one divergence from upstream).
- A Space Editor's representative face changes the Space person, not the owner's own thumbnail.
- Global People details: partner and shared-album faces count but do not create cards; own and Space faces keep
  Gallery's Archive rule.
- Identity-keyed rejections keep applying across owners.
- Downgrade supported only on the same upstream base; data survives and returns on re-upgrade.
- The revert deletes shared pet groups whole.
- The Space-collapse gate stays when the cross-owner policy goes.

## Left to the builder

- Faces whose asset owner has no row: give the owner a row or move the face (slice 2), recorded.
- Whether to skip the split on an adoption-build switch, after the scale run.
- Slice boundaries inside 1-2 by area, as long as each lands green.

## Risks

- **No compiler help.** An owner-agnostic and an owner-scoped read type-check identically; raw SQL and JSON payloads
  are invisible to `tsc`. T1, T6 and T7 are the signal.
- **The backfill job as a hidden writer.** It enforces face identity = group identity and re-keys Spaces to do it. Any
  path that breaks the invariant without fixing it turns into a Space change hours later. T0 after every scenario is
  the guard.
- **Rolling timing.** The work reaches users only at the v3.4 cutover, whose date depends on Immich's tag.
- **Upstream keeps moving** the person files. Every rolling cycle replays these slices; keep them small and fork-shaped.
- **Mobile** keys local people by group id (`mobile/lib/data/db/main/table/people/person.dart`), which holds while
  sync sends only the user's own rows, as upstream's does. Upstream's stale-row bug on merge and cluster leave
  becomes live (T8).
