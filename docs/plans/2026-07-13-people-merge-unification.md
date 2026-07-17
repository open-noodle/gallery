# People merge: one engine, one policy

Design spec — 2026-07-13. Follow-up to issue #733 (a user on 5.1.0 still cannot merge people across
libraries; the error is now `Cannot merge people that already have separate profiles in the same scope`).

Implementation is sliced for `/impl-loop` (§7). Slices 1–6 are ordered so each one leaves the suite green and
ships working software on its own.

**Build status.** Slice 1 landed as `861263dfc8` — with its policy **inverted** during implementation: the
codebase already supported person↔pet merges deliberately (`pet-detection.e2e-spec.ts` pins both directions,
target type winning), so the space endpoint was brought in line with that rather than the reverse. Slice 2
landed as `87e1c7a295` (the reported bug; CI green including e2e). Slices 3 and 4 landed together as
`4957b3f972` — they are one coherent change to the gate and could not be split cleanly mid-file.

## 1. Why

Three user-facing merge paths exist. They disagree with each other in ways that produce both the reported
bug and a security hole.

| Path                                                  | Endpoint                                    | Engine                                        |
| ----------------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| Merge two of my own people (People page, suggestions) | `POST /people/:id/merge`                    | `IdentityMergePropagationService` — collapses |
| Merge where one person is only visible via a space    | `POST /people/same-person`                  | raw `mergeIdentities` — **cannot** collapse   |
| Merge two people inside a space                       | `POST /shared-spaces/:id/people/:pid/merge` | `IdentityMergePropagationService` — collapses |

Confirmed by e2e against a real stack (`e2e/src/specs/server/api/people-scoped-merge-same-space-conflict.e2e-spec.ts`):

- **B1 — the reported bug.** `mergeScopedPeople` calls the raw `mergeIdentities`, which no-ops when two
  profiles would land in the same scope, so `person.service.ts:212` pre-empts it with a terminal 400. In
  the #733 setup (both users' external libraries connected to one space) the conflict is unavoidable: a
  space grows a `shared_space_person` for every identity whose faces are on its assets, so both people hold
  a profile in that one space. The same pair merges fine through the in-space endpoint.
- **B2 — the cross-owner gate is bypassable.** `server.mergePeopleAcrossOwners` (default off + explicit
  confirmation) guards only `mergeScopedPeople`. The classic and in-space endpoints rewrite other owners'
  `person` rows with the toggle off — and can silently **delete** one of another user's people.
- **B3 — type mixing is inconsistent.** The space endpoint rejects person↔pet merges; the classic path
  deliberately supports them, target type winning (`pet-detection.e2e-spec.ts` pins both directions). The
  space path is the outlier and is brought in line.

## 2. The model

A person in the UI is an **identity** seen through a **profile**. Profiles are `person` rows (one per
owner) and `shared_space_person` rows (one per space):

```
        identity T                        identity S
        ├─ person       (me)              ├─ person       (userB)
        ├─ person       (userB)           └─ space-person (Space X)
        └─ space-person (Space X)
```

Unique indexes `person_ownerId_identityId_key` and `shared_space_person_spaceId_identityId_key` allow at
most **one profile per identity per scope**. So merging S into T requires that wherever both identities
hold a profile in the same scope, those two profiles are **collapsed into one**. Collapsing is what the
planner does and the raw path cannot.

### Two very different cross-owner effects

| Effect                                                       | What the other owner experiences                                         | What the automatic jobs do                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------ |
| **(a) Re-point** — they hold one profile on the identity set | Their row survives: same name, faces, thumbnail. Only `identityId` moves | Recognition **does this constantly, unattended** |
| **(b) Collapse** — they hold profiles on **both** identities | Two of **their** people are merged: one row **deleted**, faces moved     | Reconciliation **explicitly refuses** (skips)    |

The 5.1.0 toggle blocks both. That is why #733 users are stuck: their merge is only an (a), which the
machine performs automatically anyway.

## 3. Policy (decided)

1. **One engine.** All three endpoints go through `IdentityMergePropagationService`. The raw
   `mergeIdentities` stays only for the automatic jobs.
2. **Space profiles are system-derived, but collapsing them where you can't edit is still destructive.**
   Collapsing `shared_space_person` profiles is ungated in a space where the actor is Owner/Editor — the dedup
   job already does this unattended. In a space the actor is only a viewer of or not a member of, a **collapse**
   is governed by the same `server.mergePeopleAcrossOwners` toggle and confirmation as an other-owner collapse
   (off → refused, ask an administrator to enable it; on → explicit confirmation → commit); a **re-point** of a
   single space profile stays free in any space. Consequence: a merge of your own two people never fails merely
   because a stranger's space happens to contain one profile of each identity — only a collapse inside a space
   you cannot edit is gated. The earlier toggle-independent hard block (`hasInaccessibleAttachedSpaceProfile` → 403) is removed and folded into the toggle gate (see the revision note below).
3. **Only destructive cross-owner work is gated.** (a) re-point is free on all paths. (b) collapse of
   another owner's people — or of two people in a **shared space the actor cannot edit** — requires
   `server.mergePeopleAcrossOwners` **and** `confirmCrossOwner`.
4. **Refs stay RBAC-checked.** You may only name a person you can repair: your own `person`, or a
   `shared_space_person` in a space where you are Owner/Editor. Naming anything else is a 400.
5. **Types may mix on manual merges; the target's type wins.** Merging a mis-classified pet into the right
   person (or the reverse) is how that mistake is corrected — the classic path has always supported it and
   `pet-detection.e2e-spec.ts` pins it. The space path was the odd one out and refused; it now agrees.
   **Automatic** paths stay conservative and never fuse across types.
6. **Automatic fusion stays ungated.** The recognition job keeps fusing identities across owners (that is
   the cross-library recognition feature) and keeps skipping (b).

> **Revision (follow-up on the #733 review).** The earlier design refused an un-editable-space collapse with a
> separate toggle-independent hard block ("ask a space editor"). That block is **gone**: a collapse in a space
> the actor cannot edit (viewer or non-member) is now folded into the `server.mergePeopleAcrossOwners` gate and
> treated exactly like an other-owner collapse — off → refused with a message to ask an administrator to enable
> cross-owner merges, on → explicit confirmation → commit. Re-points in any space remain free and ungated.

Net effect for the reporter: their merge succeeds with **no admin toggle**. Net effect for
`/people/:id/merge`: stricter in exactly one case — where it currently deletes another user's person
without asking.

## 4. Architecture

### 4.1 `buildScopedMergePlan` (new)

`IdentityMergePropagationService` gains a third builder, keyed on scoped refs rather than a same-scope
profile-id set:

```ts
buildScopedMergePlan(
  input: { actorUserId: string; target: ScopedPersonProfileRefDto; sources: ScopedPersonProfileRefDto[] },
  db?: DbOrTransaction,
): Promise<IdentityMergePropagationPlan>
```

- Resolves each ref through the existing RBAC resolver (`face-identity.repository.ts` `resolveRepairProfile`:
  own `person`, or `shared_space_person` where the actor's role is Owner/Editor). Unresolvable → 400.
- Rejects mixed identity types (§4.3).
- `ensureOriginIdentities` on the origin profiles, then the **same** fan-out the other two builders use:
  load every attached profile by identity, group by owner and by space, choose a survivor per group, emit
  `personalProfileMerges` / `spaceProfileMerges` / `profileIdentityUpdates`.
- Survivor pin: the actor's origin target profile wins in its own group (matching `buildPersonalMergePlan`).

The three builders then differ **only** in how origins are resolved. The shared tail
(`ensure → fan-out → group → collapse → plan`) is extracted into one private method so they cannot drift
again.

### 4.2 The gate

The plan already computes `affectedOwnerIds` and uses it for nothing. Split it so the gate can see the
difference between (a) and (b):

```ts
interface IdentityMergePropagationPlan {
  // ...
  affectedOwnerIds: string[]; // unchanged, every owner touched
  repointedOwnerIds: string[]; // NEW: other owners whose single profile just changes identity  (a)
  collapsedOwnerIds: string[]; // NEW: other owners whose people would be MERGED (destructive)   (b)
}
```

Derived at build time from the personal groups: a group with ≥2 profiles whose `ownerId !== actorUserId` is
a collapse; a lone profile being re-identified is a re-point.

One policy function, applied by **all three** service entry points after the plan is built and before it
executes (inside the transaction, so a rejection rolls back any identity `ensure*` minted):

```ts
private async authorizeDestructiveCrossOwnerMerge(plan, dto: { confirmCrossOwner?: boolean }) {
  if (plan.collapsedOwnerIds.length === 0) return;                 // (a)-only or same-owner: free
  const { server } = await this.getConfig({ withCache: false });
  if (!server.mergePeopleAcrossOwners) {
    throw new ForbiddenException({ code: CROSS_OWNER_MERGE_ERROR_CODE.blocked, message: ... });
  }
  if (!dto.confirmCrossOwner) {
    throw new ConflictException({
      code: CROSS_OWNER_MERGE_ERROR_CODE.confirmationRequired,
      impactedOwnerCount: plan.collapsedOwnerIds.length,
      message: ...,
    });
  }
}
```

`confirmCrossOwner` is added to `MergePersonDto` and `SharedSpacePersonMergeDto` (it already exists on
`MergeScopedPeopleDto`). Both web flows gain the confirmation dialog they lack today.

The toggle's meaning narrows: it now governs **collapsing two of another user's people together — or two people
in a shared space the actor cannot edit — into one**, not any cross-owner identity write (a re-point is always
free). Admin description and i18n copy update accordingly. (Review P1 folded the un-editable-space collapse into
this same toggle; the `authorizeDestructiveCrossOwnerMerge` sketch above keys on `collapsedOwnerIds` **and**
`unrepairableSpaceCollapseIds`, and the single `blocked` / `confirmation_required` pair covers both.)

### 4.3 Type compatibility

Manual merges may mix types; the target's type wins (the merged identity is the target's, and the source
identities are deleted). The space endpoint's two type checks (`shared-space.service.ts` `mergeSpacePeople`
and `buildSpaceMergePlan`) and the scoped path's `incompatible-type` resolution are removed. The
repository-level guard in the raw `mergeIdentities` still rejects cross-type fusion for **non-manual**
sources, so the automatic jobs stay conservative.

### 4.4 Dead code removed

With the planner in place, `mergeScopedPeople` no longer needs the repairability pre-computation:
`hasRepairProfileConflict`, `resolveAttachedProfileRepairability`, and the `hasScopedProfileConflict` /
`allAttachedProfilesRepairable` / `hasInaccessibleAttachedSpaceProfile` fields of `RepairRefsResolution` are
deleted. Removing `hasInaccessibleAttachedSpaceProfile` drops only the toggle-independent hard block: an
un-editable-space collapse is no longer refused outright but is instead gated by `server.mergePeopleAcrossOwners`

- explicit confirmation, exactly like an other-owner collapse (see the §3 revision note). `resolveRepairRefs`
  slims to ref resolution + type compatibility.
  `mergeIdentitiesAfterProfileResolution`'s "unresolved profile conflicts" throw stays as an invariant
  assertion (a 500 there means the planner has a bug).

### 4.5 Client (web)

- **Error codes.** Every terminal merge error gets a machine-readable code (`merge_not_accessible`,
  `merge_incompatible_type`, `merge_self`, plus the two cross-owner codes). Web maps codes → localized
  strings; today these surface as a raw English server sentence truncated to 75 chars with
  `(Immich Server Error)` appended (`handle-error.ts:47`) — exactly what the user pasted into the issue.
- **Viewer gating.** The `Merge` menu item on the global person detail page is not role-gated
  (`+page.svelte:486`), so viewers are offered a flow that can only fail. Gate it on `canEditSpacePerson`, as
  every other write action there already is.
- **Confirmation reuse.** Generalize `runScopedMergeWithCrossOwnerConfirmation` to wrap any merge call, so
  the classic and in-space flows get the same 409 → dialog → retry-with-acknowledgement behavior.
- **Suggestion modal thumbnails.** `PersonMergeSuggestionModal` uses owner-only `getPeopleThumbnailUrl` for
  space-person candidates, which 404s. Route through the scoped resolver.

Mobile has no merge surface; out of scope.

## 5. BDD matrix

`P` = own personal person. `SP(role)` = space person, actor's role in that space. `Pet` = pet-typed
identity. "Other owner" = a `person` row belonging to someone else, attached to one of the identities (never
directly selectable — it comes along with the identity).

### 5.1 Ref admissibility (each ref, independent of topology)

| Ref named as target/source                           | Outcome                                               |
| ---------------------------------------------------- | ----------------------------------------------------- |
| Own `person`                                         | accepted                                              |
| `SP(Owner)` / `SP(Editor)`                           | accepted                                              |
| `SP(Viewer)`                                         | 400 `merge_not_accessible`                            |
| `SP(non-member)` / space with `showInTimeline=false` | 400 `merge_not_accessible`                            |
| Another owner's `person` id                          | 400 `merge_not_accessible` (not resolvable)           |
| `space-person` ref without `spaceId`                 | 400 validation (existing)                             |
| Person with `identityId = null` (legacy)             | accepted; identity minted by `ensureOriginIdentities` |
| Person with zero visible faces                       | accepted; plan degenerates safely, no crash           |

### 5.2 Pair admissibility

| Target | Source                     | Outcome                                                 |
| ------ | -------------------------- | ------------------------------------------------------- |
| person | person                     | proceed to topology                                     |
| pet    | pet                        | proceed to topology                                     |
| person | pet                        | 400 `merge_incompatible_type`                           |
| X      | X (same profile)           | 400 `merge_self`                                        |
| X      | Y, already on X's identity | 204, no-op (idempotent re-merge)                        |
| X      | > 20 sources               | 400 `merge_too_many_sources` (guardrail; web caps at 5) |

### 5.3 Topology → outcome (the core matrix)

Applies **identically to all three endpoints**. "Commit" = 204/200 + identity merged.

| #   | What else hangs off the two identities                  | Toggle   | `confirmCrossOwner` | Outcome                                                                                                                                                                                                     |
| --- | ------------------------------------------------------- | -------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Nothing                                                 | any      | any                 | **Commit.** Faces re-linked to the target identity                                                                                                                                                          |
| T2  | Actor's own `person` on both identities                 | any      | any                 | **Commit.** Actor's two people collapsed (this is the classic own-merge)                                                                                                                                    |
| T3  | Same space, profiles on both — actor Owner/Editor there | any      | any                 | **Commit.** Space profiles collapsed; aliases migrated; counts recounted                                                                                                                                    |
| T4  | Same space, profiles on both — actor **Viewer** there   | off / on | — / `true`          | Toggle **off** → **403** `cross_owner_merge_blocked` (ask an administrator to enable cross-owner merges). Toggle **on** + confirmed → **Commit**; space profiles collapsed — _was a toggle-independent 403_ |
| T5  | Same space, profiles on both — actor **not a member**   | off / on | — / `true`          | Toggle **off** → **403** `cross_owner_merge_blocked` (ask an administrator to enable). Toggle **on** + confirmed → **Commit**; space profiles collapsed — _was a toggle-independent 403_                    |
| T6  | Other owner, **one** person on the set → re-point (a)   | off      | —                   | **Commit.** Their `identityId` rewritten; row, name, faces untouched — _was 403_                                                                                                                            |
| T7  | Other owner, **two** people on the set → collapse (b)   | off      | —                   | **403** `cross_owner_merge_blocked`; nothing written                                                                                                                                                        |
| T8  | Other owner, **two** people on the set → collapse (b)   | on       | absent              | **409** `cross_owner_merge_confirmation_required` + `impactedOwnerCount`; nothing written                                                                                                                   |
| T9  | Other owner, **two** people on the set → collapse (b)   | on       | `true`              | **Commit.** Their two people merged (survivor: faceCount → named → id); loser row deleted, faces moved                                                                                                      |
| T10 | Two other owners, each with two people (b)×2            | on       | `true`              | **Commit.** The preceding 409 reported `impactedOwnerCount = 2`                                                                                                                                             |
| T11 | Mixed: same-space conflict **and** other-owner collapse | off      | —                   | **403** (the (b) gate governs; nothing written, space untouched)                                                                                                                                            |
| T12 | Multi-scope: 3 spaces + 2 owners, one with (b)          | on       | `true`              | **Commit.** Every scope collapsed; one metadata-backfill job; one dedup job per affected space; one `PersonMerge` activity row per affected space                                                           |
| T13 | Target hidden, source visible                           | any      | any                 | **Commit.** Survivor keeps the **target's** hidden/favorite flags                                                                                                                                           |
| T14 | Target has no name, source named                        | any      | any                 | **Commit.** Blank target fields (name, birthDate, color, species) filled from source; non-blank never overwritten                                                                                           |
| T15 | Target's feature face invalidated by the merge          | any      | any                 | **Commit.** Feature face repaired; `PersonGenerateThumbnail` queued; source thumbnail deleted post-commit                                                                                                   |

### 5.4 Entry-point parity

For every row of §5.3, the same topology driven through `POST /people/:id/merge`, `POST /people/same-person`,
and `POST /shared-spaces/:id/people/:pid/merge` (whichever can express it) must produce the **same** outcome.
This is the regression matrix that keeps the three paths from drifting apart again.

### 5.5 Automatic paths (unchanged, asserted as such)

| Job                                 | Cross-owner (a) | Cross-owner (b) | Same-space conflict    |
| ----------------------------------- | --------------- | --------------- | ---------------------- |
| `FacialRecognition` fusion          | performs        | skips + warns   | skips + warns          |
| `SharedSpaceIdentityReconciliation` | performs        | skips + warns   | collapses, then merges |
| `SharedSpacePersonDedup`            | performs        | no-op (raw)     | no-op (raw)            |

The toggle does **not** gate these. Tests pin this so the unification does not accidentally sweep them in.

### 5.6 Gherkin (representative — one per class)

```gherkin
Scenario: T3/T4 — merging a person from a connected library, both people also in the same space
  Given userA and userB each have an external library connected to space X
    And identity T has userA's person and a space-person in X
    And identity S has userB's person and a space-person in X
    And "mergePeopleAcrossOwners" is off
  When userA merges the space-person on S into their own person on T
  Then the merge commits
    And X holds exactly one space-person for the merged identity
    And userB's person is re-pointed to the merged identity, keeping its name and faces

Scenario: T7 — a merge that would merge two of someone else's people, toggle off
  Given identity T and identity S each have a person owned by userB
    And "mergePeopleAcrossOwners" is off
  When userA merges S into T
  Then the request fails with 403 and code "cross_owner_merge_blocked"
    And userB still has two people
    And identity S still exists

Scenario: T9 — the same merge, enabled and confirmed
  Given "mergePeopleAcrossOwners" is on
  When userA merges S into T with confirmCrossOwner = true
  Then the merge commits
    And userB has one person, keeping the survivor's name and both people's faces

Scenario: parity — the same topology through the classic endpoint
  Given the topology of T7
  When userA merges their own two people via POST /people/:id/merge
  Then the request fails with 403 and code "cross_owner_merge_blocked"   # today: silently deletes userB's person
```

## 6. Test commands (used by every slice)

```bash
# server unit
cd server && pnpm test -- --run src/services/identity-merge-propagation.service.spec.ts

# server medium (real DB) — NOT `pnpm test:medium -- --run <path>`, the `--` swallows the path
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/<file>

# e2e (stack must be up and left up; `mise e2e` is interactive and tears down when backgrounded)
cd e2e && COMPOSE_BAKE=true docker compose -f ./docker-compose.yml up -d --remove-orphans
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:2285/api/server/ping   # poll until 200
cd e2e && pnpm exec vitest --run src/specs/server/api/<file>
cd e2e && pnpm exec playwright test --project=web src/specs/web/<file>

# web unit
cd web && pnpm test -- --run src/lib/utils/cross-owner-merge.spec.ts

# gates
make check-server && make lint-server
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint
```

## 7. Slices

Each slice is red-first: write the listed tests, watch them fail for the stated reason, then implement.

---

### Slice 1 — Type handling agrees across the three paths

**Goal.** The space endpoint stops refusing person↔pet merges, matching the classic path's long-standing
behaviour (target type wins). Automatic paths keep refusing cross-type fusion.

**Depends on.** Nothing.

**Red.**

- `server/src/services/identity-merge-propagation.service.spec.ts` — new: `buildSpaceMergePlan` plans a mixed
  person/pet merge, target type winning. Expected red: `BadRequestException: Cannot merge people of different types`.
- `server/src/services/shared-space.service.spec.ts` — invert `rejects mixed person and pet space profiles
before delegation` (:7056) into `delegates mixed person and pet space merges so the target type wins`.
  Expected red: same exception.
- `e2e/src/specs/server/api/shared-space.e2e-spec.ts` — invert `cannot merge across types (person ↔ pet)`
  (:2134) into a 204 + the target keeping `type: 'person'` + the source row gone. Expected red: 400.

**Green.**

- Remove the type check in `identity-merge-propagation.service.ts` `buildSpaceMergePlan`.
- Remove the type check in `shared-space.service.ts` `mergeSpacePeople`.
- Remove the `incompatible-type` resolution from `face-identity.repository.ts` `resolveRepairRefs` and drop
  that variant from `RepairRefsResolution['reason']`.

**Must stay green** (the guardrails): `identity-merge-propagation.service.spec.ts:1101` (personal mixed merge
allowed), `pet-detection.e2e-spec.ts` (both cross-type directions retain the target type), and the automatic
paths' type refusals (`shared-space.service.spec.ts` dedup/reconciliation `should not merge people of
different types`).

**Covers.** §5.2 row 3.

**Commit.** `fix(spaces): allow person↔pet space merges, matching the classic merge (target type wins)`

### Slice 2 — One engine: route `mergeScopedPeople` through the planner

**Goal.** Kill B1 — the reported bug. The scoped path collapses same-scope profiles instead of refusing.
Gates are **unchanged** in this slice (the cross-owner policy shift is Slice 3), so the blast radius stays
small.

**Depends on.** Slice 1.

**Red.**

- `e2e/src/specs/server/api/people-scoped-merge-same-space-conflict.e2e-spec.ts` — rewrite the REPRO test
  (:133) from "refused with 400" to: the merge **commits**, the space holds exactly one space-person for the
  merged identity, and the other owner's person is re-pointed. Expected red: 400
  `Cannot merge people that already have separate profiles in the same scope`.
- `server/src/services/identity-merge-propagation.service.spec.ts` — new `buildScopedMergePlan` block: ref
  resolution (own person; space-person as Owner/Editor), rejection of a Viewer / non-member / other-owner ref
  (§5.1), survivor pinned to the actor's origin target, plan shape for a mixed personal+space ref set.
  Expected red: method does not exist.
- `server/test/medium/specs/services/identity-merge-propagation.service.spec.ts` — new, real DB: T1, T2, T3 —
  a scoped merge whose identities share a space collapses the two space profiles (aliases migrated, counts
  recounted, one profile left) and re-points the other owner. Expected red: method does not exist.
- `server/src/services/person.service.spec.ts` — update :4863 and :4878 (which assert the same-scope 400) to
  assert the merge is delegated to the planner instead. Expected red: still throws.

**Green.**

- Extract the shared tail of `buildPersonalMergePlan` / `buildSpaceMergePlan`
  (`ensure → fan-out → group → collapse → plan`) into one private method.
- Add `buildScopedMergePlan` (§4.1) and `mergeScopedProfiles(auth, dto)` on the propagation service, mirroring
  `mergePersonalPeople` / `mergeSpacePeople` (advisory lock → build → lock → execute → follow-ups).
- `person.service.ts` `mergeScopedPeople`: delete the `hasScopedProfileConflict` 400 and the raw
  `mergeIdentities` call; keep `resolveRepairRefs` for RBAC/type/`impactedOwnerIds` and keep both existing
  gates as-is; delegate execution to the planner.

**Covers.** T1, T2, T3 on `/people/same-person`; §5.1 ref admissibility.

**Not in this slice.** T4/T5/T6 still 403 (the old hard block and the old cross-owner gate remain until
Slice 3).

**Done when.** The e2e repro commits; unit + medium green; `make check-server && make lint-server` clean.

**Commit.** `fix(people): route the scoped merge through the propagation planner (#733)`

---

### Slice 3 — The policy shift: collapse is free, only destruction is gated

**Goal.** Space collapse is ungated anywhere; cross-owner **re-point** is free; only cross-owner **collapse**
is gated. Applied to the scoped path only — the siblings follow in Slice 4.

**Depends on.** Slice 2.

**Red.**

- `server/src/services/identity-merge-propagation.service.spec.ts` — new: the plan exposes
  `repointedOwnerIds` / `collapsedOwnerIds`, correctly classifying a one-profile other owner (re-point) vs a
  two-profile other owner (collapse). Expected red: fields do not exist.
- `server/src/services/person.service.spec.ts` — rewrite :4828 and :4844 (which assert the
  inaccessible-attached-space-profile 403) to assert the merge **commits** and the space profiles collapse
  (T4/T5). Rewrite the cross-owner tests so the gate fires on `collapsedOwnerIds`, not on any impacted owner:
  T6 commits with the toggle off; T7/T8/T9 behave as the matrix says. Expected red: 403 / gate fires on (a).
- `server/test/medium/specs/services/people-identity-rbac.spec.ts` — **rewrite** :3538 (asserts the old hard
  block) into its replacement: a merge whose identity has a space profile in a space the actor cannot repair
  now **commits and collapses it**, and the actor still cannot **name** that space person as a ref (§5.1).
  This is the deliberate loosening — the test must state the new intent explicitly, not be deleted.
- `e2e/src/specs/server/api/people-cross-owner-merge.e2e-spec.ts` — T6: with the toggle **off**, a merge whose
  only cross-owner effect is a re-point now **commits** (today: 403 `cross_owner_merge_blocked`). New (b)
  fixture — a second owner holding people on **both** identities — driving T7/T8/T9/T10. Expected red: T6 403s;
  the (b) fixture does not exist.

**Green.**

- Add `repointedOwnerIds` / `collapsedOwnerIds` to `IdentityMergePropagationPlan`, computed in the shared tail.
- Add `authorizeDestructiveCrossOwnerMerge(plan, dto)` (§4.2) and call it from `mergeScopedProfiles`.
- `person.service.ts`: delete `authorizeCrossOwnerMerge` and the `hasInaccessibleAttachedSpaceProfile` /
  `allAttachedProfilesRepairable` blocks.
- `face-identity.repository.ts`: delete `hasRepairProfileConflict` and `resolveAttachedProfileRepairability`;
  slim `RepairRefsResolution` to refs + type (§4.4).
- Update the admin toggle's description + i18n copy to say it governs merging **other users' people together**.

**Covers.** T4, T5, T6, T7, T8, T9, T10, T11 on `/people/same-person`.

**Done when.** All of the above green; the toggle's new meaning is reflected in `i18n/en.json`.

**Commit.** `feat(people): gate only destructive cross-owner merges, free same-space collapse`

---

### Slice 4 — Unify the gate across the other two endpoints

**Goal.** Close B2. The classic and in-space endpoints get the same gate; the automatic jobs are pinned as
unchanged. This is where the deliberate behavior change lands (§8).

**Depends on.** Slice 3.

**Red.**

- `e2e/src/specs/server/api/people-scoped-merge-same-space-conflict.e2e-spec.ts` — the two "documented bypass"
  tests (:151, :173) are rewritten against a **(b)** fixture: with the toggle off, `POST /people/:id/merge` and
  `POST /shared-spaces/:id/people/:pid/merge` now **403** rather than silently merging two of another owner's
  people; with the toggle on + `confirmCrossOwner`, they commit. Expected red: 200/204 with the toggle off.
- `server/src/services/person.service.spec.ts` / `shared-space.service.spec.ts` — the gate is applied before
  execution on both paths; `confirmCrossOwner` is threaded from the DTO. Expected red: no gate.
- `server/src/controllers/person.controller.spec.ts` / `shared-space.controller.spec.ts` — `confirmCrossOwner`
  is accepted on `MergePersonDto` and `SharedSpacePersonMergeDto`. Expected red: property stripped.
- `server/src/services/person.service.spec.ts` + `shared-space.service.spec.ts` — **§5.5 job pinning**: the
  recognition job still performs (a) and still skips (b) with the toggle off; reconciliation still collapses
  same-space conflicts. Expected red: none (these should pass) — they are the guardrail that the unification
  does not sweep the jobs in.
- Parity (§5.4): one medium test asserting the same (b) topology yields the same outcome through all three
  entry points.

**Green.**

- Add `confirmCrossOwner` to `MergePersonDto` and `SharedSpacePersonMergeDto`.
- Call `authorizeDestructiveCrossOwnerMerge` from `mergePersonalPeople` and `mergeSpacePeople`.
- Regenerate the API surface: `cd server && pnpm build && pnpm sync:open-api && make open-api` (Java required
  for the Dart client).

**Covers.** §5.4 parity for T7–T10; §5.5.

**Done when.** All three endpoints agree; OpenAPI + SDKs regenerated and committed.

**Commit.** `fix(people): apply the cross-owner merge gate to every merge endpoint`

---

### Slice 5 — Client: stop showing raw server errors, gate the viewer menu

**Goal.** The user-visible half. No more `...(Immich Server Error)` strings, no merge menu that can only fail,
and the confirmation dialog appears on the two flows that can now 409.

**Depends on.** Slice 4 (needs the codes and the regenerated SDK).

**Red.**

- `web/src/lib/utils/cross-owner-merge.spec.ts` — the helper wraps **any** merge call (classic, scoped,
  in-space), mapping 409 → dialog → retry with `confirmCrossOwner`. Expected red: helper is scoped-only.
- `web/src/lib/utils/handle-error.spec.ts` (new) — coded merge errors map to localized strings; no raw server
  sentence reaches the toast. Expected red: raw string.
- `web/src/routes/(user)/people/[personId]/.../person-detail-page.spec.ts` — the `Merge` menu item is absent
  when the person is a space-primary profile in a space the actor cannot edit. Expected red: present.
- `web/src/lib/modals/person-merge-suggestion-modal.spec.ts` — a space-person candidate renders the scoped
  thumbnail URL, not the owner-only one. Expected red: owner-only URL.
- `e2e/src/specs/web/cross-owner-people-merge.e2e-spec.ts` — the confirmation dialog appears for a **(b)** merge
  driven from the classic flow. Expected red: no dialog.

**Green.**

- Generalize `runScopedMergeWithCrossOwnerConfirmation` → `runMergeWithCrossOwnerConfirmation(mergeFn)`; use it
  in the classic, scoped, and in-space flows.
- Map merge error codes → i18n keys; add EN strings (other locales fall back).
- Gate the `Merge` menu item on `canEditSpacePerson` (`people/[personId]/.../+page.svelte:486`).
- Route `PersonMergeSuggestionModal` thumbnails through the scoped resolver.

**Covers.** §4.5.

**Done when.** Web unit + Playwright green; `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint`.

**Commit.** `fix(web): localized merge errors, viewer merge gating, cross-owner confirmation everywhere`

---

### Slice 6 — Close the coverage gaps

**Goal.** The audit found merge behavior with **no** real-DB coverage at any tier. Tests only, plus one small
guardrail.

**Depends on.** Slice 4 (Slice 5 not required).

**Red → Green (tests are the deliverable; each must fail if the behavior regresses).**

- **Post-merge outcomes, real DB** (today asserted only against a mocked in-memory row store): name/birthDate/
  color/species blank-fill (T14), hidden/favorite preservation (T13), feature-face repair + source thumbnail
  cleanup (T15), space alias migration, `faceCount`/`assetCount` recount, `GET /people/:id/statistics` after a
  merge.
- **Multi-source**: 3+ sources in one call on each endpoint; partial-failure response shape.
- **Idempotency**: re-issuing a completed merge → 204 no-op (§5.2 row 5); merging into a survivor of a merge.
- **Hidden people** through the manual paths (only the automatic paths cover this today).
- **Degenerate identities**: zero-face person; `identityId = null` legacy person (§5.1).
- **Concurrency**: merge vs `detachScopedPerson`, and merge vs a running dedup job, on the same identity.
- **Source cap**: `merge_too_many_sources` above 20 sources (§5.2 row 6). _Optional — drop this bullet if the
  cap is unwanted; it is a guardrail against a pathological plan holding the instance-wide advisory lock, not
  a requirement._

**Done when.** All tiers green; no production behavior changed except the (optional) cap.

**Commit.** `test(people): close the merge coverage gaps found by the #733 audit`

---

## 8. Risks

- **Behavior change on `/people/:id/merge`** (Slice 4). With the toggle off (default), a merge that would
  collapse another owner's two people now 403s instead of silently doing it. Intended, but visible — release-note
  it.
- **Space collapse in a space you can't edit is gated, not free** (Slice 3, T4/T5). A viewer or non-member can
  still **re-point** a single space profile unattended (the dedup job does this too), but a merge that would
  **collapse two profiles** in a space they cannot edit is now governed by the `server.mergePeopleAcrossOwners`
  toggle and explicit confirmation — exactly like an other-owner collapse (off → refused, ask an administrator to
  enable; on → confirmation → commit). This replaces the earlier toggle-independent hard block; the medium RBAC
  test that asserted that hard block is **rewritten** to assert the new gated behavior, so the new intent is
  explicit.
- **Advisory-lock contention.** All merges serialize on one instance-wide advisory lock. Routing a third endpoint
  through it does not change that; the optional source cap (Slice 6) keeps a pathological plan from holding it.

## 9. Out of scope

Mobile merge UI (none exists). Notifications to impacted owners (deliberately dropped in the #733 revision; the
space activity feed still records merges). Reworking the automatic fusion heuristics.
