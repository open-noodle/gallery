# Cluster Groups Consolidation — Exploration

**Date:** 2026-08-21
**Status:** **SUPERSEDED — a decision was taken after this document was written.** Gallery does not
adopt cluster groups as a feature; it takes **option M** (inert adoption). Every ranking below,
including "Revised ranking: K > J″ > D > J′", predates that decision and is kept only as the record of
how it was reached. Read
[`2026-08-21-cluster-groups-m-landing-plan.md`](./2026-08-21-cluster-groups-m-landing-plan.md) for
what is actually being built.
**Trigger:** Upstream Immich `11b1aa5ecf7` — `feat: cluster groups (#30739)`, landing in Immich v3.2.0.

## Why this document exists

#30739 is the oldest of eight pending upstream commits on the rolling rebase branch. The rolling
flow's per-batch product-direction gate fired on it: it reworks the faces/people data model, the
sharing settings surface, and the access model simultaneously — all fork surfaces. Because it is the
**oldest** pending commit, linear history means nothing can be pulled until it is resolved. The
branch therefore sits at its pre-#30739 base (`f88fb628ff5`) and `rolling-state.json` is unchanged.

This document records what we learned while deciding what to do. It is deliberately not a plan.

## What cluster groups are

A cluster group is a set of users whose **face recognition is pooled**. Members' libraries agree on
which faces depict the same human. It is a fully user-facing feature: its own settings page, an
invite/accept/decline flow, an in-app notification, seven REST endpoints, five permissions.

It does **not** share photos — asset access control is untouched. What is shared is the identity
grouping, never the library.

Key semantics:

- Every user is always in exactly one cluster group. `user.clusterGroupId` is `NOT NULL` and the
  migration backfills a singleton group per existing user.
- Membership is symmetric — no owner, no roles. Any member may invite; any member may leave.
- Accepting an invite moves all of your people into the other group. Leaving mints a fresh group and
  splits your people back out.
- Upstream **deleted** `PartnerSettings.svelte` and folded partner sharing plus cluster groups into a
  new `SharingSettings.svelte`.

Sources: `server/src/services/cluster-group.service.ts`,
`server/src/controllers/cluster-group.controller.ts`,
`server/src/schema/migrations/1787148183729-ClusterGroups.ts`.

## How it actually works — one query

The whole mechanism reduces to the scoping clause on face search:

```ts
searchFaces({ clusterGroupId, embedding, ... })
  .where('asset.ownerId', 'in', (eb) =>
    eb.selectFrom('user').select('user.id')
      .where('user.clusterGroupId', '=', clusterGroupId))
```

When a face is detected, the server looks for similar-looking faces to match it against. **The
cluster group decides whose photos are in that candidate pool.** A match reuses that person; no match
mints a new one. By default the pool is just you; join a group and it becomes everyone in the group.

So a cluster group answers exactly one question: _whose photos count as candidates when deciding
"have I seen this face before?"_

Source: `server/src/repositories/search.repository.ts`, `server/src/services/person.service.ts`.

## The two models

Both designs insert an identity spine between `asset_face` and the per-scope profile row.

| Role                                       | Gallery                                 | Upstream #30739             |
| ------------------------------------------ | --------------------------------------- | --------------------------- |
| Identity spine                             | `face_identity`                         | `person_group`              |
| Per-user profile                           | `person.identityId`                     | `person.personGroupId`      |
| Per-space profile                          | `shared_space_person.identityId`        | _none_                      |
| Face → identity link                       | `face_identity_face` (`assetFaceId` PK) | `asset_face.personGroupId`  |
| Face → owner's person link                 | `asset_face.personId`                   | _folded into the above_     |
| Provenance on the link                     | `source` + `confidence`                 | _plain FK column_           |
| Non-human identities                       | `type: 'person' \| 'pet'`               | _people only_               |
| Identity-level representative face         | `face_identity.representativeFaceId`    | _none_                      |
| Rule deciding which profiles share a spine | space membership, structurally          | `cluster_group`, explicitly |

`cluster_group` is the object upstream had to invent because they have no Spaces. We derive the same
answer structurally.

## Verified findings

Each of these was read from the commit rather than inferred.

### 1. Upstream has independently converged on the fork's architecture

`mapPerson()` now returns `id: person.personGroupId` — not the `person` row id. The identity is the
public thing and `person` is demoted to a private per-scope profile. `mapFaces()` also drops its
`ownerId === auth.user.id` gate. This is the same bet Gallery made with `face_identity`, which makes
consolidation plausible rather than wishful.

Source: `server/src/dtos/person.dto.ts`, `server/src/dtos/asset-response.dto.ts`.

### 2. Cluster groups share the identity, never the name

`PersonId` is `{ ownerId, personGroupId }` and people queries `groupBy(['person.ownerId',
'person.personGroupId'])`. Each user keeps their own `person` row carrying their own name, birthdate
and thumbnail. `withFacesAndPeople` takes a `viewingUserId` option commented
`/** whose version of the person to select */`:

```ts
.whereRef('person.personGroupId', '=', 'asset_face.personGroupId')
.$if(!viewingUserId, (qb) => qb.whereRef('person.ownerId', '=', 'asset.ownerId'))
.$if(!!viewingUserId, (qb) => qb.where('person.ownerId', '=', viewingUserId!))
```

So you see your own label, falling back to the asset owner's. Names are never shared.

Source: `server/src/utils/database.ts`, `server/src/repositories/person.repository.ts`.

**Consequence:** Gallery's `shared_space_person` delivers a _richer_ shared-people story than cluster
groups do — one name per space, visible to every member, maintained collaboratively — but only for
photos inside a space. Upstream's model gives no shared label at all.

### 3. We have two links per face; upstream has one

```
Fork:      asset_face.personId      ──►  person         "owner filed this face under person P"
           face_identity_face       ──►  face_identity  "believed to be identity I, via <source>, confidence C"

Upstream:  asset_face.personGroupId ──►  person_group   "this face depicts identity G"
```

Upstream collapsed person-assignment and identity into one column, because in their model assigning
a face to a person _is_ assigning it to the group. We kept them separate. `linkFace()` is called
independently of person assignment, across six evidence sources (`owner-person`, `ml`, `backfill`,
`shared-space-evidence`, `manual`, `import`), so a face can carry an identity link the owner never
confirmed. Face suggestions, face repair and identity-merge propagation are built on exactly that
distinction.

Source: `server/src/repositories/face-identity.repository.ts`,
`server/src/services/face-suggestion.service.ts`, `server/src/services/face-repair.service.ts`.

### 4. Upstream decides "same identity" two ways, and neither is a bulk reconciliation on join

**Automatic, at facial-recognition job time** (`handleRecognizeFaces`): only runs for a currently
**unassigned** face. It runs an embedding-similarity search — `searchFaces({ clusterGroupId,
embedding, ... })` — scoped to the candidate pool defined by the face's `clusterGroupId`, and if a
match is found, the new face's `asset_face.personGroupId` is set to the matched group's id. This
never touches already-assigned faces and never reconciles two pre-existing `person_group`s — it only
extends the candidate pool for faces detected _after_ the fact.

**Manual, user-triggered** (`mergePerson`): an explicit "these are the same person" action, gated by
the `PersonMerge` permission, that reassigns every `asset_face` row from a losing `person_group` to a
winning one (`reassignFaces`). It does cross owners — it fetches each owner's own `person` profile for
the target group and merges name/birthDate onto the primary.

**The consequence that matters for consolidation:** `reassignCluster` (called when a user accepts a
cluster-group invite) never merges any `person_group`s together — it only moves the joining user's own
groups into the new `cluster_group`, splitting off a fresh group per identity that's already shared
with someone else. So when Anna and Ben join the same cluster group, their _historical_ Grandma faces
stay in two separate `person_group`s until either a new unassigned face happens to get re-matched, or a
human manually merges the two via `mergePerson`. There is no bulk reconciliation on join.

This resolves the "discovery vs. bookkeeping" gap the J″ spike found underspecified: a fork-owned
aggregate for J″ or K should mirror both of these mechanisms (scoped-candidate-pool matching for new
faces, permission-gated manual merge for existing ones) rather than inventing a separate evidence
pipeline from scratch.

Source: `server/src/services/person.service.ts` (`handleRecognizeFaces` ~L468-545, `mergePerson`
~L573+), `server/src/repositories/person.repository.ts` (`reassignCluster` ~L492-570).

## The hard constraint

An earlier draft of this document stated the constraint too broadly — that a single identity column
forces a choice between owner scope and space scope. That is **wrong**, and the correction matters:
both profiles can hang off the _same_ identity. `person.personGroupId = G` and
`shared_space_person.personGroupId = G` coexist without conflict, exactly as `identityId` does today.

The constraint that genuinely binds is narrower:

**`person_group` cannot link identities across users who are not in the same cluster group.
`face_identity` can.**

Worked example:

> Anna and Ben are in the **Family** space. Anna and Carla are in the **Hiking** space. Grandma
> appears in Anna's and Ben's photos; Dave appears in Anna's and Carla's photos.
>
> For Grandma to be one person, Anna and Ben must share a cluster group.
> For Dave to be one person, Anna and Carla must share a cluster group.
> Anna has one `clusterGroupId` column. She cannot be in both.

Nor can the pool be made per-space, because of where the decision lands: `asset_face.personGroupId`
is a **single column**. A face gets exactly one identity, decided once by one candidate pool.
Per-space answers would require a face to hold several identities simultaneously, and there is
nowhere to put them.

The obstacle is therefore not that Spaces are incompatible with cluster groups. It is one column
holding one answer, and a pool that is a property of the _user_ rather than of a _context_.

### What listing vs deduping costs

The two halves of "show a space's people" have different answers:

- **Listing** them is free — collect the `personGroupId`s on the space's assets. No fork table needed.
- **Deduping across contributors** is what needs help, and only when those contributors are not
  already in a shared cluster group.

## Evidence on what is tradeable

The README positions these as differentiators, not incidentals:

- Shared Spaces headline bullet: _"multi-owner collaborative timelines with Owner / Editor / Viewer
  roles, **cross-contributor face recognition**, and a per-space activity log."_
- **Global People** is a separately marketed feature: _"people, filters, and search results dedupe
  across your library and every Shared Space you can access… Naming and merging stay scoped to where
  they were entered."_
- The section opens by naming the gap the fork fixes: _"Immich's face recognition is
  account-scoped."_

Global People _is_ the cross-scope identity feature. It has its own opennoodle.de page. Treating it
as tradeable would delete a marketed feature.

The counter-pressure worth recording: cluster groups mean "Immich's face recognition is
account-scoped" is about to stop being true. Upstream is eroding this differentiator from their side
regardless of what the fork does.

## What a swap would cost

Adopting `person_group` as the spine is a swap **plus a graft**. `person_group` is a strictly simpler
object than `face_identity` + `face_identity_face`. Four things need homes:

| What                      | Candidate home                                        | Size             |
| ------------------------- | ----------------------------------------------------- | ---------------- |
| `type: person \| pet`     | additive column, or a fork-owned side table           | small            |
| `representativeFaceId`    | additive column, side table, or drop and use profiles | small            |
| `clusterGroupId NOT NULL` | make nullable, or always assign a group               | small            |
| `source` + `confidence`   | see "confirmed vs evidence" below                     | **the real one** |

### Confirmed vs evidence

Our two links map onto a distinction we have never named:

- `asset_face.personGroupId` — the **confirmed** link, upstream's semantics exactly
- `face_identity_face` — the **evidence** table: ML candidates, suggestions, repair proposals

Today `face_identity_face` holds both, distinguished only by `source`. If upstream's column takes
over the confirmed link, every `source: 'owner-person'` row becomes derivable and drops out, leaving
a coherent proposals table. This would make the fork _simpler_ than it is now, and it keeps face
review, repair and suggestions intact.

### Implementation weight

Not a rebase resolution:

- data migration on `asset_face`, backfilling `personGroupId` for every face row
- rename sweep across the fork's heaviest files — `person.repository.ts` (+685),
  `person.service.ts` (+962), `search.repository.ts` (+1450), `sync.repository.ts` (+1292), plus ~89
  references in shared-space code alone
- API contract change (person ids become group ids) rippling through the SDK, web and mobile
- mobile Drift schema and the owner-scoped person sync streams

## Options considered

| #   | Option                               | Summary                                                                                   | Verdict                                                                               |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A   | Full convergence                     | Adopt the spine _and_ ship cluster groups as a feature                                    | Only if we want the feature                                                           |
| B   | Bridge / dual spine                  | Keep `face_identity` authoritative, maintain `person_group` as a derived shadow           | Cheapest now, ages worst — two sources of truth                                       |
| C   | Diverge                              | Revert the `personId` → `personGroupId` rename on every rebase                            | Toll grows monotonically as upstream builds on it                                     |
| D   | Adopt the spine, ignore the grouping | Take `person_group`; never create cluster groups; space membership keeps deciding         | Spiked — small divergence confirmed, but merges are bulk and effectively irreversible |
| E   | Contribute upstream                  | Propose the spine be scope-pluggable                                                      | Worth running in parallel; unblocks nothing today                                     |
| F   | Hold                                 | Quarantine indefinitely                                                                   | Total upstream freeze; only for a bounded window                                      |
| G   | Name propagation                     | Keep per-user `person` rows; propagate names across space members in the service layer    | Zero schema divergence; eventual-consistency and conflict semantics unresolved        |
| J′  | Orthogonal, pure upstream            | Adopt 100%; space people are listed but dedupe only when members share a cluster group    | Zero divergence; bounded but real feature loss                                        |
| J″  | Upstream plus a fork-owned aggregate | Adopt 100%; a space person aggregates several `person_group`s via a fork-owned link table | Spiked — viable, but dedupe is per-space only                                         |
| K   | Zero upstream-table divergence       | Adopt upstream tables byte-identical; every fork addition in fork-owned tables            | Spiked — viable, global reach, weeks not months, **leading candidate**                |

### The ranking principle

Divergence is not uniform. **Rebases conflict on upstream-owned files.** A fork-owned table costs
nothing at rebase time; a modified column on `person_group` costs on every future faces commit.
So "as close to upstream as possible" is best read as _minimise rebase friction_, not _minimise
schema difference_ — which means the goal is to touch **zero upstream tables**, not to delete fork
features.

Under that reading the original ranking was **J″ > K > D > J′**, on the theory that K's extra
indirection layer wasn't worth paying for global reach. The 2026-08-21 spikes (below) change this in
two ways: K's actual cost came back "weeks not months," with risk concentrated in one service
(`identity-merge-propagation`) rather than smeared across the fork — closing most of the gap the
original ranking was based on, while still giving global cross-space dedup that J″ structurally
cannot. And D's cost turned out to be exactly the small column count the doc predicted, but its
_mechanism_ — a bulk, group-wide merge — trades away today's fine-grained, single-row undo, a
regression the doc never scoped as part of D's cost.

**Revised ranking: K > J″ > D > J′.** K matches J″'s zero-upstream-divergence property while
covering the case J″ can't (two contributors who don't share a space), for a bounded, now-measured
cost. J″ remains the fallback if K's merge-propagation work turns out to be harder than the spike's
single-function sample suggests. D's small schema footprint doesn't offset an irreversible-merge
regression the other two don't have.

## Option K — zero upstream-table divergence

Adopt `person_group`, `cluster_group`, `cluster_group_request` and `asset_face.personGroupId`
byte-identical to upstream, and place every fork addition in a fork-owned table:

| Fork concern                   | Home                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------- |
| Cross-cluster identity linkage | `face_identity` demoted to grouping `person_group`s, via a fork-owned link table |
| Per-space profile              | `shared_space_person.identityId` — **unchanged**, see stage-3 correction below   |
| Evidence / proposals           | `face_identity_face` repointed to `personGroupId`                                |
| `type: person \| pet`          | fork-owned side table                                                            |
| `representativeFaceId`         | fork-owned side table, or dropped in favour of profile thumbnails                |
| `clusterGroupId NOT NULL`      | always assign the owner's group — never diverge on nullability                   |

The open question against K was whether the extra indirection layer pays for itself, versus J″ which
applies the same trick only inside a space, or versus D which accepts three small column
divergences for a flatter model. **Resolved by the spikes below**: it does — see "The ranking
principle" above.

> [!WARNING]
> **Read before trusting any error-count or LOC number in the K, J″, D or D+ sections below.** All
> four spikes share one foundation commit (`1be40e6dced`, "merge upstream/main taking upstream's side
> wholesale"). That merge strategy resolves every conflicted file to upstream's side outright, with no
> attempt at line-level reconciliation — and a diagnostic run after the fact
> (`comm -12` on files both the fork and upstream changed since the shared base, filtered to ones now
> byte-identical to `upstream/main`) found **14 files, >13,500 lines of unrelated fork functionality
> silently discarded**: S3-compatible storage streaming (`download.service.ts`), video-trim
> serialization (`media.service.ts`), memory/timeline queries and search facets
> (`asset.repository.ts`, `search.repository.ts`, `search.service.ts`), space RBAC logic, pet
> identification (`person.type`/`species`), and nearly the entire fork test suite for people/search/
> timeline. It all compiles cleanly and type-checks green — that's the trap: **a clean `tsc --noEmit`
> is exactly what silently-deleted-but-compiling fork code looks like.** `asset.service.ts` lost 100%
> of its fork content this way (the merge commit shows zero combined-diff hunks for it — a full
> override, not a partial loss).
>
> None of this is specific to cluster groups — it's collateral damage from the wholesale-merge
> shortcut all four spikes used to reach a workable base quickly, and it would need a proper 3-way
> `git merge-file` reconciliation (the approach the sibling "option M" spike used from the start,
> see `2026-08-21-cluster-groups-m-spike-handoff.md`) regardless of which option — K, J″, D, or M — is
> chosen. The **relative** comparisons between options below (divergence surface, hop count,
> reversibility, mechanical-vs-semantic split) are likely still informative, since all three suffer
> this defect identically. The **absolute** numbers (error counts, "weeks not months," LOC deltas) are
> not trustworthy as stated — they were measured against a tree with a large, option-independent hole
> in it, and none of the four spikes has yet re-measured against a properly-reconciled base.

## Spike results — option K, 2026-08-21

A throwaway spike ran on branch `spike/cluster-groups-k` in `.worktrees/spike-cluster-groups`. Nothing
merges; the rolling branch and `rolling-state.json` were never touched. Type-check only — no tests, no
database, server only.

**Verdict: K is viable, and materially cheaper than the raw grep estimate of ~2,400 touch points
suggested.**

### Findings that apply to EVERY option (D and J″ included)

Anyone spiking D or J″ should read this section first — all of it is option-independent, and most of
it costs a wasted round trip to rediscover.

1. **Use `git merge`, not `git rebase`.** The rolling flow needs a rebase for linear history, which
   would replay 1,224 fork commits through #30739's conflict surface. A spike only needs the end
   state, so a merge gets there in **one** conflict pass.

2. **The merge is tractable: 39 files, 125 hunks, and every one is upstream-owned.** Zero fork-only
   files conflict. Concentration: `person.service.ts` (21), `person.service.spec.ts` (15),
   `person.repository.ts` (10) carry 37% of the hunks; the tail is 15 files with one hunk each. About
   11 hunks are not even #30739 — `server/Dockerfile` (6) and `test.yml` (4) come from the docker
   caching commit, plus a delete/modify on `activity.e2e-spec.ts`.

3. **Zero fork-only conflicts is a trap, not good news.** All 45 fork-only person files merge
   perfectly while referencing `asset_face.personId` and `person.id`, neither of which survives. This
   is the zero-conflict semantic break pattern at scale — the damage is invisible to git and surfaces
   only at type-check.

4. **Resolve the registry files as UNIONS before measuring anything.** Taking upstream's side
   wholesale on `enum.ts`, `schema/index.ts`, `services/index.ts`, `repositories/index.ts`,
   `base.service.ts`, `controllers/index.ts`, `types.ts`, `test/medium.factory.ts` and `test/utils.ts`
   deletes every fork enum, repository registration and test-factory helper. The resulting cascade is
   **87.5% of the error count and pure noise**:

   | Measurement                              | Errors     |
   | ---------------------------------------- | ---------- |
   | After wholesale "take upstream's side"   | **19,331** |
   | After restoring those 9 files as unions  | **2,406**  |
   | After registering the new tables in `DB` | **2,302**  |

   One example: `shared-space.service.spec.ts` reported 2,718 errors, of which 2,354 (87%) traced to a
   single deleted test-factory method. Do not report a raw census taken before this step.

5. **`server/src/schema/index.ts` needs BOTH edits.** Adding a table class to the schema array is not
   enough — it must also be added to the `export interface DB { ... }` block further down, or Kysely
   rejects the table name with `not assignable to parameter of type 'TableExpression<DB, …>'`. Note
   upstream's own four (`person_group`, `person_group_audit`, `cluster_group`, `cluster_group_request`)
   also need adding to the fork's `DB` interface when the fork side of that file is kept.

6. **`person.id` is deleted, and this is unavoidable in every option.** Upstream drops the column and
   makes the primary key composite:

   ```sql
   ALTER TABLE "person" DROP COLUMN "id";
   ALTER TABLE "person" ADD CONSTRAINT "person_pkey" PRIMARY KEY ("ownerId", "personGroupId");
   ```

   **229 call sites** need `person.id` → `person.personGroupId`. Five fork-owned tables FK `person.id`
   and must be repointed: `shared_space_person`, `shared_space_person_face`,
   `shared_space_person_alias`, `face_person_verdict`, `face_repair_decline`.

7. **A bounded re-graft list.** Fork methods dropped from upstream files that must be restored:
   `ensurePersonIdentity`, `createPerson`, `linkFace`, `addPersonFaces`, `upsertPending`,
   `mergePersonProfile`, `mergeScopedPeople` (on `person.repository.ts`); `getFilterSuggestions`,
   `getSmartSearchFacets`, `getTimeBucketCovers` (on `search.repository.ts`);
   `getByLibraryIdWithFaces` (on `asset.repository.ts`); `getBirthdaysForDay`; plus the fork's
   `PeopleFaceStatistics` type and `retryOnDeadlock` helper.

8. **Our `searchFaces` already generalizes upstream's.** Ours takes `{ userIds, spaceId }`; upstream's
   new one takes `{ clusterGroupId }` and resolves it to `asset.ownerId IN (…)`. Upstream's scoping is
   a strict special case of ours, so reconciling means resolving `clusterGroupId → userIds` at their
   call sites and keeping the fork signature. No behavioural loss either way.

### K-specific results

The K chain was proven end-to-end on one read path. A fork-owned link table was added:

```ts
@Table('face_identity_person_group')
export class FaceIdentityPersonGroupTable {
  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', primary: true, index: false })
  personGroupId!: string;
  @ForeignKeyColumn(() => FaceIdentityTable, { onDelete: 'CASCADE', index: false })
  identityId!: string;
}
```

and `getPersonalThumbnailForSpacePerson` in `shared-space.repository.ts` was adapted:

```ts
.selectFrom('person')
.innerJoin('face_identity_person_group',
           'face_identity_person_group.personGroupId', 'person.personGroupId')
.select(['person.personGroupId as personId', 'person.thumbnailPath'])
.where('face_identity_person_group.identityId', '=', input.identityId)
```

Those queries compile with zero errors. **The chain
`asset_face.personGroupId → person_group → face_identity → shared_space_person` type-checks.**

Two mechanical substitutions cover nearly all remaining work:

- `person.id` → `person.personGroupId` — **229 sites**
- `person.identityId` → a join through the link table — **123 sites**

Adapting one function cost roughly ten changed lines.

### Remaining work after the spike

| Bucket              | Errors | Files |
| ------------------- | -----: | ----: |
| fork production     |    232 |    23 |
| fork specs          |  1,517 |    59 |
| upstream production |     83 |    30 |
| upstream specs      |    470 |    33 |

Half the fork production errors sit in three files: `face-identity.repository.ts` (60),
`face-repair.repository.ts` (30), `shared-space.repository.ts` (25).

### What the spike did NOT prove

- **Only the read path.** Writes are untested — creating identities, linking `person_group`s, and
  above all `identity-merge-propagation.service.ts`, which under K must reason across **two** levels
  (merge person groups, then merge identities). That is semantic work, not mechanical, and is the
  likeliest place for K to get expensive.
- **No migration.** Backfilling the link table from `person.identityId` before dropping that column is
  untested.
- **Server only.** Web (~820 fork-added person-id lines), mobile and e2e are untouched.
- **Nothing was executed.** Type-check only.

### Estimate

~23 fork production files, ~350 mechanical substitutions, the bounded re-graft list above, plus
genuine design work in merge propagation and the migration. **Weeks, not months**, with the risk
concentrated in one service rather than smeared across the fork.

### Stage 3 — write path (merge propagation), 2026-08-21

The single biggest open risk from stages 1-2 — "writes are untested, above all
`identity-merge-propagation.service.ts`, which under K must reason across two levels" — was spiked
directly, on top of the stage-2 commit. Same worktree and branch, still type-check only, still nothing
executed against a database.

**The core question — can upstream's native `mergePerson` (direct `person_group` reassignment,
no knowledge `face_identity` exists) and the fork's own `IdentityMergePropagationService` coexist
without the two drifting out of sync — is answered: yes, but not for free.** Left unfixed, upstream's
merge doesn't error or orphan anything — `face_identity_person_group` cascade-deletes cleanly — it
just goes silently stale: a `person_group`'s evidence moves elsewhere while its identity link still
claims the old grouping. The fix is a **fork hook below the upstream call site** in
`PersonService.mergePerson`, the same pattern the fork already uses elsewhere (upstream and fork logic
share one file, no runtime subclass indirection): snapshot both sides' `face_identity_person_group`
links before upstream's reassignment runs, fold them together inside a transaction taking the _same_
advisory lock (`pg_advisory_xact_lock(hashtext('identity-merge-propagation'))`) the fork's own merge
service already uses, so the two mechanisms can't race. ~40 lines total (a 25-line hook, a 15-line
repository method) — a real, committed code change, not a documented gap.

**Correction to the table above**: `shared_space_person` needs **no schema change** under K. It's
100% fork-owned, so its `identityId` FK to `face_identity` stays exactly as it is today — stage 2's
`getPersonalThumbnailForSpacePerson` already relied on this, adapting only the `person` side of the
join. The "(fork table, repointed)" note earlier in this section was a misreading of the design; K
never touches this table at all.

**Mechanical vs. semantic split was closer to 55/45 than stage 1-2's near-total mechanical estimate.**
The one insight that matters most: **a `person` profile's true key under K is `(ownerId,
personGroupId)`, never `personGroupId` alone** (cluster-group sharing means a `personGroupId` is not
owner-unique) — get this wrong and it's a silently-wrong-owner bug, not a compile error, since both
are typed `string`. Every repository method the merge service depends on
(`ensurePersonIdentity`, `getMergePropagationProfiles`, `mergePersonProfile`, `lockPeopleForMerge`) had
to be re-derived around it. `mergeIdentitiesAfterProfileResolution` — replacing a `person.identityId`
column update with a bulk repoint of `face_identity_person_group` rows — was the actual crux; done
wrong, it would have broken the two-mechanism story this stage exists to resolve, not just added bugs
elsewhere.

**Estimate: unchanged, trending toward the lower end.** The flagged risk came back tractable in one
focused session — the service + its 3 declared repo dependencies (~400 changed lines total) plus the
~40-line hook, not an architectural rework. Error count went 2,302 → 2,261 (server-wide), confirmed via
full diff to introduce zero new errors outside the four files touched
(`face-identity.repository.ts`, `person.repository.ts`, `identity-merge-propagation.service.ts`,
`person.service.ts`).

**New open item, not spiked**: `face_person_verdict.personId` / `face_repair_decline.personId` (the
two fork-owned tables from finding #6's list not touched by stage 2's repoint) still key off a bare
single-column person id shaped for pre-K `person.id`. They currently compile only because Kysely
doesn't enforce FK types at the column level — a real composite-key repoint is still owed.

### Stage 4 — full spike to near-M-parity, 2026-08-22

**Context: this ran after the product decision (below, "Status" banner) — not to reopen it, but because
Pierre asked for K's real cost as a data point before committing to M's full implementation.** Everything
above this point predates the decision and was measured against the broken wholesale-merge base the
warning at the top of this section flags. This stage re-measures K against a properly-fixed tree, driven
all the way to the same bar the M spike proved: 0 type errors, migrations run clean against a real
Postgres with zero drift, and both `pnpm test`/`pnpm test:medium` actually passing.

Ran across ~25 sequential background-agent rounds and 90+ throwaway commits in a fresh worktree
(`.worktrees/spike-cluster-groups-k2`, branch `spike/cluster-groups-k2`, branched from stage-3's tip so
the two K worktrees could coexist). Nothing merges; still fully throwaway.

**Result — K reached near-parity, but cost meaningfully more than M:**

| Gate                    | K (final)                                                                                                                                                                                                                                          | M (reference, already proven) |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `pnpm check`            | 134 errors, all confirmed out-of-scope (pre-existing `getTimeBuckets`/`auth`-arg and `duration`/`onAssetHide`/`onAssetShow` gaps — unrelated to cluster groups, present in the shared wholesale-merge base, and left unfixed by M's own spike too) | 0                             |
| Migrations              | 157 apply clean, zero drift                                                                                                                                                                                                                        | 156 apply clean, zero drift   |
| `pnpm test` (unit)      | ~5,410 / 5,566                                                                                                                                                                                                                                     | 5,648 / 5,767                 |
| `pnpm test:medium`      | ~2,480 / 2,679                                                                                                                                                                                                                                     | 2,494 / 2,642                 |
| Total throwaway commits | 90+ across 25 rounds                                                                                                                                                                                                                               | 50                            |

**The composite-key finding this stage confirms and sharpens finding #6/Stage 3's open item**:
`face_person_verdict`/`face_repair_decline` need a genuinely **composite** `(ownerId, personGroupId)` FK
pair under K, not a single-column repoint — because K, unlike M, permits multiple owners per
`person_group`, so `personGroupId` alone doesn't uniquely identify an owner. This is real, K-specific
design weight M's simpler 1:1 invariant never has to pay, and it wasn't fully quantified until this stage.

**Three production-functionality gaps found, characterized, and deliberately left open** (Pierre's call,
2026-08-22 — explicitly declined both "port the missing functionality" and "skip silently"):

1. `handleQueueRecognizeFaces`/`handleRecognizeFaces` — K's implementation is substantially
   older/simpler than M's: missing shared-space-match suppression during force-reset,
   ML-identity-unlink-on-reset, a `deleteUnreferencedIdentities` call, bounded backfill-wait logic, and a
   terminal maintenance-completion marker. `JobName.FaceIdentityMaintenanceAfterRecognition` exists in
   K's enum (a merge leftover) but nothing anywhere in K's services queues or handles it.
2. `mergePerson`'s classic endpoint (a separate, older implementation from `mergeScopedPeople`, with its
   own manual per-person loop and `mergeIdentitiesAfterProfileResolution` hook) never calls
   `crossOwnerMergeAuthorizer` — that cross-owner gating only exists on `mergeScopedPeople`.
3. `getById` doesn't implement the shared-space profile resolution M's test suite exercises.

**Real bugs found and fixed along the way, unrelated to K vs M but required to actually reach parity** —
all pre-existing wholesale-merge casualties, same "compiles clean, silently wrong" or "silently deleted"
shape as finding #3 above, at larger scale than anticipated: a missing `#757` visibility-transition
cascade + rbac-3 ownership guard + reverse-geocoding in `asset.service.ts`; `PersonRepository.
createAssetFace` returning `void` instead of the new face's id (a one-line fix that closed 265 test
errors); `GetAllFacesOptions.excludeManuallyPlaced` missing entirely (recognition could silently
re-claim a manually-placed face); several raw-SQL blocks in `face-identity.repository.ts` still
referencing the dropped `person.identityId`/`person.id` columns directly — invisible to `tsc`, and
fixing them closed 108 medium-suite failures in one pass, the single biggest win of the whole stage;
`PersonService`'s `face_identity_person_group` _creation_ path (not just merge-propagation, already
closed in Stage 3) was missing outside `mergePerson` entirely; and `PersonService.getAll` was missing
its whole `withSharedSpaces` branch even though the repository method it needed already existed and was
already used elsewhere. Separately, whole test files (`person.service.spec.ts`, `search.service.spec.ts`,
`timeline.service.spec.ts`, `utils/misc.spec.ts`) had 90%+ of their content silently dropped by the
original wholesale merge — a file-level instance of the same defect, not specific to K.

**Net read**: confirms this section's original K-vs-M cost ranking was directionally right even though
its absolute numbers were explicitly untrustworthy — K is viable but costs more than M, and even driven
this deep it still surfaces real behavioral gaps M's simpler invariant avoids by construction. Does not
reopen the decision below. Full round-by-round record: memory `project_cluster_groups_k_full_spike_vs_m`.

## Spike results — option J″, 2026-08-21

A throwaway spike ran on branch `spike/cluster-groups-j2` in `.worktrees/spike-cluster-groups-j2`,
branched from the same wholesale-merge base as the K spike (`1be40e6dced`). Scope was narrower than
K's: schema and migration only, verified by type-checking the changed files — it did **not** attempt
the registry/factory union-restoration or chase the wider error count down, so its numbers are not
directly comparable to K's error-reduction progression above. Nothing merges; the rolling branch and
`rolling-state.json` were never touched.

**Verdict: J″ is viable at the schema level and achieves genuinely zero upstream-table divergence —
but it surfaced a real gap the doc's prose didn't anticipate, and the same gap likely applies to K's
`face_identity_person_group` link table.**

### What was built

- New fork-owned table `shared_space_person_group` (junction, composite PK `(personId,
personGroupId)`, ~158 LOC total including migration) aggregating one-or-more `person_group`s under
  one `shared_space_person`.
- `shared_space_person.identityId` was **kept**, narrowed to pets only via a new CHECK constraint —
  the K table above says this column is "repointed" but doesn't say what happens to it under J″.
  Dropping it would leave pets with no per-space aggregation at all, since `person_group` is
  upstream's people-only spine.
- Migration `1791000000000-AddSharedSpacePersonGroup.ts`: a plain `CREATE TABLE` + index + one
  `ALTER TABLE ... ADD CONSTRAINT CHECK`, following the existing `AddAlbumSpaceAssetTable` style — no
  `migration_overrides` needed, nothing here is a partial/expression index.
- The dedupe query (`shared_space_person` → `shared_space_person_group` → `person_group` →
  `asset_face`) type-checks and reuses an existing index
  (`asset_face_personGroupId_assetId_notDeleted_isVisible_idx`) — zero new indexes needed on
  upstream tables.

### Divergence surface

Zero upstream-owned files modified. All changes are new or edited fork-owned files
(`shared-space-person-group.table.ts` new; `shared-space-person.table.ts`, `face-identity.table.ts`,
`face-identity-face.table.ts` edited — the latter two only for header-comment narrowing, no
structural change).

### The gap: discovery vs. bookkeeping

The doc frames "aggregate person_groups under one shared_space_person" as pure bookkeeping — a place
to record confirmed pairs. It doesn't say what **decides** two person_groups are the same human in
the first place. Upstream's own mechanism for that (a shared `cluster_group`) is exactly what these
contributors, by construction, don't share. The spike's resolution: keep `face_identity_face`'s
evidence pipeline (ML / backfill / shared-space-evidence / manual sources) as the discovery engine,
with a confirmed proposal landing as a `shared_space_person_group` row. This is a real design
decision the doc left implicit, and it applies equally to K's `face_identity_person_group` link
table — K's spike proved the read chain type-checks but didn't test how a row gets created in the
first place.

### Other gaps found

- **Pets are not addressed by `person_group` at all** (people-only upstream spine) — under J″ (and
  presumably K), pet identity keeps routing entirely through the existing `face_identity` machinery,
  unchanged. Not new, but worth flagging as a permanent split, not a spike artifact.
- **No DB-level uniqueness invariant** stops the same `person_group` from being attached to two
  different `shared_space_person` rows within the same space, which would silently split one
  identity's evidence. Would need a denormalized `spaceId` on the junction table plus app-level or
  trigger sync — judged out of scope for the spike.
- **Real backfill complexity, deliberately left unresolved**: the pet-only CHECK on `identityId`
  would break on any existing `type='person'` row that still carries an `identityId` — there is no
  mechanical mapping from "faces linked to this identity" to "which `person_group`s those faces'
  `asset_face` rows carry," since a face's `personGroupId` reflects the owner's own (possibly
  unconfirmed) clustering. Flagged in the migration comment rather than solved.

### What the spike did NOT prove

Same caveats as K, at a narrower scope:

- Only the read query — no write/creation path for `shared_space_person_group` rows.
- No registry/factory reconciliation attempted — the wider fork (services, repositories, specs) was
  left exactly as the wholesale merge landed it (19,335 pre-existing errors, confirmed via an A/B
  diff to have zero delta from this spike's own files).
- No migration dry-run against a real database.
- Web, mobile and e2e untouched.

## Spike results — option D, 2026-08-21

A throwaway spike ran on branch `spike/cluster-groups-d` in `.worktrees/spike-cluster-groups-d`,
branched from the same wholesale-merge base as K and J″ (`1be40e6dced`). Schema and migration scope,
same depth as J″. Nothing merges; the rolling branch and `rolling-state.json` were never touched.

**Verdict: D is viable and its divergence surface is exactly as small as the doc predicted — but the
merge-based mechanism it relies on has a real feature-completeness gap the doc didn't anticipate:
merges are bulk and effectively irreversible, unlike today's single-row `face_identity_face` undo.**

### What was built

`person_group` fully replaces `face_identity` as the spine — not kept alongside it. `face_identity`
and `face_identity_face` are **deleted**; `shared_space_person.identityId` and
`face_person_verdict`'s identity FK are retargeted straight at `person_group.id`; the evidence table
is renamed `person_group_face` (for consistency with the fork's existing `shared_space_person_face`
naming). A new `person_group_merge_audit` table and an (unwired) `person-group-merge.repository.ts`
stub implement the merge operation the doc's option-D row implied but didn't specify.

### Divergence surface

Exactly one upstream-owned table touched, as predicted: `person-group.table.ts` gets **+2 columns**
(`type: 'person' | 'pet'` default `'person'`; `representativeFaceId` FK→`asset_face`, nullable),
**+1 check constraint**, **+1 partial index**. `clusterGroupId` is untouched — see judgment call
below. Zero changes to `cluster_group`, `cluster_group_request`, `person`, `person_group_audit`, or
any upstream column on `asset_face`. (`schema/index.ts` also gets new table registrations, but that's
the same one-line-per-table plumbing every existing fork table already requires, not new-in-kind
divergence.)

### Implementation weight

~618 insertions / 109 deletions across 10 files. The 301-line migration is mostly mechanical
rename/retarget SQL plus backfills — it's the fork's **first** migration that `ALTER TABLE`s an
already-upstream-migrated table, confirmed via `migrations-gallery/` grep to have no precedent; it
turned out to need only a plain `ALTER TABLE ... ADD COLUMN`, no `migration_overrides`, except for
the partial `representativeFaceId` index (same split upstream's own `AddFaceIdentities.ts` uses). The
merge-groups repository stub (129 lines) was 90% simple bulk `UPDATE ... WHERE personGroupId =
loser` — `asset_face`, `person_group_face`, `face_person_verdict` are all 1:1 keyed by `assetFaceId`
— and 10% genuinely hairy: `person`'s composite PK `(ownerId, personGroupId)` can collide on merge
via a "diamond" topology (the same user already has independent `person` rows under both groups
being merged), left as a documented TODO rather than inventing a second merge-conflict policy.

**Backfill is lossy, and flagged rather than glossed over**: `face_identity` and upstream's
`asset_face.personGroupId` were two independent parallel spines, so there's no natural mapping from
an old `face_identity` grouping to a `person_group`. The migration backfills each evidence/verdict
row's group from its own face's _current_ `personGroupId` — any cross-user grouping `face_identity`
used to encode is silently discarded unless a real deployment runs the merge operation once per
pre-existing grouping as a follow-up job.

### Feature completeness

New matches going forward are reproduced faithfully — the confirmed link is a real column
reassignment, no indirection. What's **not** preserved is undo parity: unlinking one evidence row
today via `face_identity_face` is a precise, single-row, side-effect-free operation. A `person_group`
merge is bulk and group-wide; reversing a wrong one needs to know exactly which `asset_face` rows
moved, and neither upstream's `person_group_audit` (records only "a group was deleted + its cluster
group") nor the new `person_group_merge_audit` (summary counts + winner/loser ids, not a per-row
snapshot) captures that. `person_group_merge_audit` gives auditability, not reversibility — a true
undo would need a per-row snapshot table, which is materially more weight than "three small
divergences" scoped this option to. **Closed by a follow-up spike, "D+" — see below.**

### Judgment calls / things the doc underspecified

1. **`clusterGroupId` nullability** (the doc's third listed divergence): resolved to **no schema
   change** — left `NOT NULL`, untouched. Every `person_group` already gets a singleton via
   upstream's own migration-time backfill, and this option never creates or surfaces additional
   cluster groups, so there's nothing to diverge on. The doc listed this as an open question; D
   resolves it to zero-touch.
2. **The wholesale-merge worktree's pre-existing breakage is option-independent.** `schema/index.ts`'s
   `DB` interface is missing nearly every fork table regardless of cluster-groups (confirmed via
   signature-diffed `tsc` runs: this spike's changes add zero new errors anywhere, only shift error
   counts inside already-fully-broken repository files). This will need fixing under D, J″ or K alike
   and isn't a cost specific to any one option.
3. **Table rename**: `face_identity_face` → `person_group_face`, matching the fork's existing
   `shared_space_person_face` naming convention for the same kind of evidence/join table.

## Spike results — option D+, 2026-08-21

A follow-up spike closed D's one real gap: reversibility. Ran on the same branch
(`spike/cluster-groups-d`), on top of the option-D spike, commit `0367d8388d7`. Same depth as the
original D spike — schema + repository-level logic, type-check only.

**Verdict: undo works, and D's flat-read property is unaffected — the fix costs comparable weight to
the original spike (~551 insertions vs. ~618), paid entirely at merge/undo time.**

### What was built

Four new fork-owned tables capture everything a merge needs to be undone:

- `person_group_merge_snapshot` — every moved `asset_face` id + its pre-merge `personGroupId`.
- `person_group_merge_verdict_snapshot` — every moved `face_person_verdict` row's own id, not just its
  `assetFaceId`: a face can carry up to two verdict rows (one per `personId` target, one per
  `spacePersonId` target), so `assetFaceId` alone isn't a precise enough key to avoid sweeping up a
  verdict row created after the merge.
- `person_group_merge_group_snapshot` — the losing `person_group`'s full row, to recreate it under its
  original id.
- `person_group_merge_person_snapshot` — any `person` rows the PK-collision branch deleted.

`person_group_face` gets no sibling snapshot table: its primary key **is** `assetFaceId`, so it's
exactly reconstructable from the `asset_face` snapshot alone — one less table than a naive "snapshot
every affected table" approach would need. `person_group_merge_audit` gains a nullable `reversedAt`,
set (not deleted) by undo, so "merged then later reversed" stays visible in review history.

`undoPersonGroupMerge(db, mergeId)` walks all of this in one transaction: refuses to run twice
(`reversedAt IS NOT NULL` guard), re-inserts the losing `person_group` and any deleted `person` rows,
moves the snapshotted `asset_face` ids back (guarded by `personGroupId = winner`, so a face moved again
by a _later_, independent merge is never clobbered), reconstructs `person_group_face` from the same id
set, moves `face_person_verdict` rows back by their own captured row id, then deletes the four snapshot
rows and stamps `reversedAt`.

### Confirmed: the read path stays flat

Every read still goes through `asset_face.personGroupId` (or `person_group_face`'s /
`face_person_verdict`'s own `personGroupId` column) with zero joins. Nothing outside
`undoPersonGroupMerge` itself ever queries the four new snapshot tables — this is the crux of why D+
is worth it over J″/K, and it holds. The only added cost is 1-4 extra `INSERT`s per merge inside the
existing transaction, proportional to the losing group's face count, paid once — the same trade D
always made, not a new one.

### Storage and retention

Storage is directly proportional to the losing group's face count: a merge of 10k faces (a popular
identity with thousands of photos) is a few MB; a small merge is negligible. Recommended, not built:
treat snapshot rows as TTL'd (a cleanup job deleting snapshot rows — **not** audit rows — for merges
older than a 30-90 day "someone reports a bad merge" window) while `person_group_merge_audit` itself
is kept forever. Already-reversed merges need no separate cleanup — `undoPersonGroupMerge` deletes
their snapshots immediately.

### What's still a known gap, not fixed by D+

- **Merge ordering**: undoing an older merge is safe against a face moved again by a later, independent
  merge (the `personGroupId = winner` guard prevents clobbering), but it does not retroactively repair
  that later merge's own now-partially-stale snapshot. Documented, not solved.
- **`shared_space_person.personGroupId`** is not touched by `mergePersonGroups` at all — this is a
  pre-existing gap in the original D stub, not introduced by D+. Postgres silently `SET NULL`s it when
  the losing `person_group` is deleted (an `ON DELETE SET NULL` FK), and undo cannot restore what was
  never captured. Worth folding into whichever spike next touches D's merge trigger/discovery path.

### Cost picture

~551 insertions across 7 files — comparable weight to the original D spike's ~618, confirming
reversibility is a bounded add-on rather than a rethink of the option. Zero new `tsc` errors beyond the
pre-existing wholesale-merge baseline (same order of magnitude as the original D spike's 19,331,
confirmed via before/after diff).

## Open questions

1. Does per-space collaborative naming survive, and if so how does it coexist with upstream's
   per-user labels? A resolution order (personal override → space default → asset owner) is one
   candidate, unvalidated.
2. Can shared naming be achieved with **zero** schema divergence — e.g. propagating names across
   members' `person` rows in the service layer instead of storing one shared row?
3. What is the freeze posture for the seven unrelated commits stuck behind #30739 (Dockerfile
   caching fix, maplibre bump, oauth URL, three e2e refactors, library exclusion fix)?
4. Which Spaces behaviours are genuinely fundamental, and which are tradeable for closeness to
   upstream?

## Standing constraint

Stated by the maintainer during this session: **stay as close to upstream as possible, even at the
cost of fork features, provided they are not fundamental to how Spaces work.** Designs should be
ranked by divergence surface first and feature completeness second.
