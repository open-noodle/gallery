# Cluster Groups Consolidation — Exploration

**Date:** 2026-08-21
**Status:** Exploration. No decision taken, nothing implemented, nothing rebased.
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

| #   | Option                               | Summary                                                                                   | Verdict                                                                        |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A   | Full convergence                     | Adopt the spine _and_ ship cluster groups as a feature                                    | Only if we want the feature                                                    |
| B   | Bridge / dual spine                  | Keep `face_identity` authoritative, maintain `person_group` as a derived shadow           | Cheapest now, ages worst — two sources of truth                                |
| C   | Diverge                              | Revert the `personId` → `personGroupId` rename on every rebase                            | Toll grows monotonically as upstream builds on it                              |
| D   | Adopt the spine, ignore the grouping | Take `person_group`; never create cluster groups; space membership keeps deciding         | Leading candidate                                                              |
| E   | Contribute upstream                  | Propose the spine be scope-pluggable                                                      | Worth running in parallel; unblocks nothing today                              |
| F   | Hold                                 | Quarantine indefinitely                                                                   | Total upstream freeze; only for a bounded window                               |
| G   | Name propagation                     | Keep per-user `person` rows; propagate names across space members in the service layer    | Zero schema divergence; eventual-consistency and conflict semantics unresolved |
| J′  | Orthogonal, pure upstream            | Adopt 100%; space people are listed but dedupe only when members share a cluster group    | Zero divergence; bounded but real feature loss                                 |
| J″  | Upstream plus a fork-owned aggregate | Adopt 100%; a space person aggregates several `person_group`s via a fork-owned link table | Restores per-space dedupe at zero upstream cost                                |
| K   | Zero upstream-table divergence       | Adopt upstream tables byte-identical; every fork addition in fork-owned tables            | Same principle as J″, applied globally rather than per-space                   |

### The ranking principle

Divergence is not uniform. **Rebases conflict on upstream-owned files.** A fork-owned table costs
nothing at rebase time; a modified column on `person_group` costs on every future faces commit.
So "as close to upstream as possible" is best read as _minimise rebase friction_, not _minimise
schema difference_ — which means the goal is to touch **zero upstream tables**, not to delete fork
features.

Under that reading the ranking is **J″ > K > D > J′**, with J″ giving up essentially nothing.

## Option K — zero upstream-table divergence

Adopt `person_group`, `cluster_group`, `cluster_group_request` and `asset_face.personGroupId`
byte-identical to upstream, and place every fork addition in a fork-owned table:

| Fork concern                   | Home                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------- |
| Cross-cluster identity linkage | `face_identity` demoted to grouping `person_group`s, via a fork-owned link table |
| Per-space profile              | `shared_space_person.personGroupId` (fork table, repointed)                      |
| Evidence / proposals           | `face_identity_face` repointed to `personGroupId`                                |
| `type: person \| pet`          | fork-owned side table                                                            |
| `representativeFaceId`         | fork-owned side table, or dropped in favour of profile thumbnails                |
| `clusterGroupId NOT NULL`      | always assign the owner's group — never diverge on nullability                   |

The open question against K is whether the extra indirection layer pays for itself, versus J″ which
applies the same trick only inside a space, or versus D which accepts three small column
divergences for a flatter model.

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
