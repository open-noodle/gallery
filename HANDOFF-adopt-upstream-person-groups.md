# Handoff: adopting upstream person groups (option 2)

**Delete this file before merging the branch.** AGENTS.md keeps session handoffs out of `specs/`; this one rides
the branch only so the next session can pick up. The durable record is
`specs/2026-10-28-adopt-upstream-person-groups-design.md`.

Written 2026-10-28 at the end of the session that produced the spec. Branch `spec/adopt-upstream-person-groups`,
based on `origin/main` `d9ea8866515`. Worktree: `.worktrees/spec-adopt-upstream-person-groups`.

## Where things stand

| Item | State |
| --- | --- |
| Option 2 spec | Written, reviewed against the code by three verification passes, all findings folded in. **Waiting for Pierre's approval.** |
| Next step after approval | `superpowers:writing-plans` for the slices, starting with slice 0, on the rolling v3.4 branch. Nothing is built yet. |
| Interim split (separate work) | Built and tested locally by another session in `.claude/worktrees/split-shared-person-groups` (branch `worktree-split-shared-person-groups`). **Uncommitted, unpushed**; that session is waiting for Pierre before any push or PR. Do not edit that worktree. It has applied this session's four review findings: its `down()` refuses cleanly when the index exists and split rows remain; the migration carries frozen copies of its statements (the live `src/gallery/utils/person-group-split.ts` is what the revert spec pins and what option 2's migration calls); the FK facts are corrected; and verdicts/declines need no move at split time, because fork tables are empty on a database switching from Immich. It also added an end-to-end switch test (stock Immich 3.3.5 schema → Gallery → stock migrator → full revert → second switch), a sync-continuity test, and a stock-Immich fixture in the revert workflow. |
| Rolling v3.4 | `origin/rebase/upstream-rolling-v3.4` is `a2410689fa2`. The local branch in `.worktrees/rebase-upstream-rolling-v3.4` was `fe5bac08c08`, 5 commits ahead (a fork sync done by another session on 2026-10-28). Re-check which is current before branching off it. |

## Open question to raise first: build on `main` instead of rolling?

Found while pushing this branch, after decision 4 below was taken: `origin/main` moved to the Immich **v3.3.5** base on
2026-10-28. v3.3.5 already contains the person-query rewrite and `asset_face.ownerId` (immich-32593, the v3.3.x
cherry-pick of immich-32523). Between `refs/upstream/v3.3.5` and rolling's upstream base `cf719e733e6`, upstream's
person files differ only by immich-28410 (`withLock` around recognition), the set-operations refactor in the access
files, and passkeys. Commands that show it:

```bash
git diff --stat refs/upstream/v3.3.3 refs/upstream/v3.3.5 -- server/src/repositories/person.repository.ts
git log --oneline refs/upstream/v3.3.5..cf719e733e6 -- server/src/services/person.service.ts
```

So the reason for building on rolling ("v3.4 rewrites the person queries, main would resolve every slice twice") no
longer holds. Building on `main` ships sooner, uses PR CI, and keeps downgrades to released builds possible. **Ask
Pierre before planning.** The spec's Constraints section records this; the rest of the spec reads either way.

## The problem in one paragraph

Gallery adopted upstream's cluster groups inertly ("option M"): the fork unique index `person_personGroupId_key`
allows one `person` row per `person_group`, `ClusterGroupController` is unmounted, and upstream v3.3 person sharing
(`person_user`) is dormant. Immich users who used person sharing have several rows per group, so their switch to
Gallery fails in `1791000000000-RepointFaceReviewToPersonGroup`: "Cannot enforce one person per person_group: 4913
group(s) hold multiple person rows" (first report).

## Decisions taken in the session (all Pierre's unless marked)

1. **Upstream's model cannot replace Spaces people**, but can sit underneath. One cluster group per user, one group per
   face and user-to-user shares can't express overlapping Spaces with one shared name and Editor roles.
2. **Long-term direction is option 2**: drop the index, make Gallery correct with one row per user per group, then
   switch upstream's cluster groups and person sharing on, next to Spaces (unchanged). Option 3 (make `person_group`
   Gallery's identity layer, replacing `face_identity`) was rejected even long term, unless upstream lets groups span
   cluster groups. Option 2 keeps that door open (see the spec's "One-way doors").
3. **Users can share both ways**; the same human shows as **one person card**; upstream's sharing is taken **as
   upstream ships it**, not a Gallery variant.
4. **Build option 2 on the rolling v3.4 branch**, landing with the v3.4 cutover (date depends on Immich's tag). Reason:
   v3.4 (immich-32523) adds `asset_face.ownerId` and rewrites upstream's person queries around one row per owner;
   rolling took the schema but kept Gallery's queries. Precedent: Pierre's 2026-08-13 call to do prep work on rolling.
5. **Ship the interim split now on `main`** (the other session's work) to unblock Immich users while option 2 waits.
   Pierre first said to skip it, then reinstated it once option 2 was tied to v3.4.
6. **Merges: upstream's rule, and Gallery's cross-owner merge policy goes** (`mergePeopleAcrossOwners`,
   `confirmCrossOwner`, the cross-owner half of `utils/merge-policy.ts` and its web prompts). Correction found in
   review: upstream's merge requires the caller to own a row in **every** merged group, then merges other owners' rows
   in those groups (skip on name/birth-date conflict, fill blanks). The Space-collapse gate stays (my call).
7. **Global People counts partner and shared-album faces for everyone** (upstream's scope), not only shared people.
8. **The split links every multi-row group to one identity**, not only explicit shares. Passed to the split session.

The spec's "Calls made in writing this" section lists the decisions I made myself for Pierre to check; the important
ones are refusing a person merge that would force a Space change the actor cannot make (the one divergence from
upstream), and a Space Editor's representative face changing the Space person instead of the owner's own thumbnail.

## What the review found (all folded into the spec)

Three read-only verification passes checked the first draft against `main`, ROLLING and upstream `main`
(`11bf8753137`). The findings that changed the design:

- **Severe:** upstream's `regeneratePeople` lets any cluster member queue a force recognition run; Gallery's force
  branch deletes Space people (`deleteAllPersons`), identity links and the queue instance-wide. Must be scoped to the
  cluster before the controller is mounted (slice 5).
- **Hidden writer:** the identity backfill enforces "a face's identity equals its group's identity" and re-keys Spaces
  to fix mismatches (`getBackfillWork`, `repairPersonalIdentityAssignments`, `repairSpacePersonIdentityAssignments`).
  Every path that combines groups must keep the invariant, or Spaces change without an Editor.
- **Access:** upstream's `checkPersonAccess` is a separate function the existing grant seam cannot reach; it needs a
  second seam, plus per-endpoint read hooks (upstream reads the viewer's own row after the check).
- **Upstream group-moving paths** (`reassignCluster`, `deleteEmptyGroups`, `updateGroupId`) leave fork sidecars on the
  old group: a leaving user gets a second card, and the cascade deletes fork rows. Hooks needed.
- **Migrations:** number above `1799000000000` (the newest fork migration), not just above upstream's newest; frozen
  SQL only (no repository calls inside the ledger transaction); verdicts are `ON DELETE SET NULL`, declines cascade
  through two columns; downgrade only on the same upstream base (released builds are v3.3-based and refuse v3.4 rows).
- **Pooled recognition** must wait for the index drop: switched Immich databases already have multi-member clusters,
  and a pooled match would violate the index on every retry.
- **Counts:** ~43 `asset_face`→`person` joins on group alone, not ~20.

Four findings about the split's own code were sent to the split session (its `down()` assumes the index is gone,
which is false on Gallery-only databases once option 2 can re-split; freeze a copy of its statements in the
migration; FK behaviours of verdicts and declines; the moved owner's verdicts stay on the kept group).

## Facts worth not re-deriving

- Nothing after Immich v3.3.3 changes cluster groups, `person_user`, the person/person-group/cluster-group/user
  tables or what person access grants (checked against upstream `main` `11bf8753137`). The 42 upstream commits not yet
  on rolling only touch a web face-editor refactor and an album-share access fix.
- Upstream's own leave-cluster (`reassignCluster`) does what the split does: groups shared with another owner get a
  fresh group for the leaving user.
- Gallery's `person_identity` (one person per owner per identity) and upstream's `person` PK `(ownerId,
  personGroupId)` are the same shape: a multi-row group is one identity with several owners' people.
- Spaces people (`shared_space_person*`) have no FK onto `person`; they are keyed on `face_identity` and face ids.
- Today a merge on a multi-row group would overwrite, move faces of, and delete other owners' people
  (`person.repository.ts` `mergePersonProfile`, ~323 and ~346).
- `specs/2026-08-22-option-m-invariant-inventory.md` is stale (it says 20 call sites; there are 26, and it misses the
  sidecars). Slice 0 rewrites it.

## Test infrastructure to reuse (from the review)

- `server/test/medium/specs/services/database-migration.service.spec.ts`: `createRawDatabase`, `stockImmichMigrator`,
  `preSplitGalleryMigrator`; scenario B migrates stock Immich and then runs Gallery's migrations, exactly the
  switch-in harness the T2 matrix needs.
- The split's `server/test/medium/specs/migrations/split-shared-person-groups.migration.spec.ts` (in the split
  worktree until it lands): drops the index per test, seeds a three-user cluster through the real `person_user`
  trigger, exact-snapshot helper.
- `server/test/medium.factory.ts`: `newUser` (mints a singleton cluster group), `newPerson`, `newPersonUser`,
  `newAssetFace`, `insertClusterGroup`, `insertPersonGroup`.
- Oracles: `access-oracle.medium.spec.ts` (6 actors), `rbac-oracle.medium.spec.ts` (8 actors); no shares or clusters
  yet.
- Revert CI: `.github/workflows/gallery-revert-to-immich-validation.yml` and `.github/scripts/revert-to-immich-data.sh`
  seed only after Gallery boots today; T3 adds a stock-Immich seed phase. On rolling it needs
  `upstream_image=ghcr.io/immich-app/immich-server:commit-<upstream sha>`.

## Traps hit this session

- **zsh history modifiers:** `git show $R:server/...` is parsed as `$R` with a `:s` modifier. Write
  `"${R}:server/..."`.
- `refs/upstream/v3.3.3` exists locally (`d2dac658fe1`); upstream's remote is `upstream`
  (`refs/remotes/upstream/main`). An extracted copy of upstream v3.3.3 was made in the session scratchpad; recreate
  with `git archive refs/upstream/v3.3.3 server/src web/src/lib/modals mobile/lib | tar x -C <dir>` if needed.
- The split session shows up in `ListAgents` under an auto-derived misleading name (`fix-mobile-jni-crash-1d` on
  2026-10-28). Find it by its socket or by `~/.claude/sessions/<pid>.json` whose `cwd` is the split worktree.

## Next steps

1. Pierre approves the spec (or asks for changes).
2. The split lands on `main` and is fork-synced onto rolling (the split session's job; slice 6 depends on it).
3. Write the implementation plan (`superpowers:writing-plans`), slice 0 first, in a worktree branched off the
   current rolling v3.4 tip.
4. Delete this file before the branch merges; move anything still useful into the spec.
