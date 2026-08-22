# Option M — inventory of the 1:1 invariant

Companion to `2026-08-21-cluster-groups-m-landing-plan.md`. That document says how M was landed;
this one says **what depends on it**, so that turning cluster groups on later is a checklist rather
than an archaeology project.

## The invariant

```sql
CREATE UNIQUE INDEX "person_personGroupId_key" ON "person" ("personGroupId");
```

One `person` row per `person_group`, enforced by Postgres. Upstream's schema permits N; Gallery
permits exactly 1, because shared spaces + `face_identity` are the fork's answer to cross-user
people and we do not adopt the cluster-groups feature.

**Everything below is sound only while that index exists.** None of it is visible to `tsc`:
`getByGroupIdOnly(id)` type-checks identically whether the group holds one row or five — it just
silently returns an arbitrary one.

## Why this file exists

The landing plan said the assumption "lives in three documented functions instead of ~229 scattered
call sites". That is true of the _primitives_ and understates the _exposure_: those three primitives
have **20 production call sites**, and three further places had to be actively converted from
upstream's multi-row semantics to single-row. Each of those three was found by a failing test, not
by design review — see "The recurring shape" below.

Keep this file current. A new call site added without a line here is an assumption nobody can find
later.

## 1. The primitives

### `PersonRepository.getByGroupIdOnly(personGroupId)` — 16 call sites

Resolves the single person in a group, ignoring ownership. Equivalent to the pre-#30739
`getById(id)`. Sound only under M.

| File                                             | Line                            | What it resolves                                                                  |
| ------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------- |
| `services/person.service.ts`                     | 583                             | thumbnail serve — owner-agnostic by design (`requireThumbnailAccess` is the gate) |
| `services/person.service.ts`                     | 637                             | `update` — reads the prior row to detect a name change                            |
| `services/person.service.ts`                     | 1491                            | `mergePerson` — per-source existence check                                        |
| `services/person.service.ts`                     | 1527                            | **`findOrFail`** — the load behind ~9 call sites; see §3                          |
| `services/shared-space.service.ts`               | 2226                            | space face-match → personal person                                                |
| `services/shared-space.service.ts`               | 3216                            | scoped merge → personal profile                                                   |
| `services/face-suggestion.service.ts`            | 33, 248                         | suggestion scan target                                                            |
| `services/identity-merge-propagation.service.ts` | 439                             | survivor feature-face repair                                                      |
| `services/face-repair.service.ts`                | 277, 869, 881, 1036, 1176, 1227 | review console — reads people the admin does not own                              |
| `services/pet-detection.service.ts`              | 104                             | pet person feature-photo                                                          |

### `PersonRepository.createWithGroup(person)` — 3 call sites

Creates the group and its single person together. Every use is a place where a 1:N world would need
to decide _which_ group to join instead.

| File                                | Line       |
| ----------------------------------- | ---------- |
| `services/face-repair.service.ts`   | 1183, 1291 |
| `services/pet-detection.service.ts` | 82         |

### `withPersonAnyOwner` — 1 call site

`repositories/person.repository.ts:622`. Owner-agnostic person join for the face-repair console,
which has no viewer to key on.

## 2. The recurring shape — upstream code keyed on "the viewer's own row"

This is the class that reaches production silently, and the one to grep on every rebase.

Upstream writes `WHERE person.ownerId = viewingUserId` because with cluster groups on it selects
among several rows. Under M the group holds one row — the **owner's** — so that predicate is either
a no-op (viewer is the owner) or a **nullifier** (viewer is anyone else).

| File                                | Line | Symptom if left as upstream wrote it                                                                                                                                     |
| ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `repositories/person.repository.ts` | 178  | `getFaces` / `getFaceById` / `getFacesByIds` return `person: null` for every non-owner                                                                                   |
| `utils/database.ts`                 | 329  | asset detail returns an empty `people` array for shared-album and Space viewers; hidden people stop being filtered, because there is no row left to read `isHidden` from |

Both now order by viewer-first and `LIMIT 1`, which resolves to the owner's row under M and degrades
back to upstream's exact behaviour if the index is ever dropped.

**Standing rebase check:**

```bash
grep -rn --include='*.ts' "viewingUserId" server/src/repositories/ server/src/utils/database.ts \
  | grep -v spec | grep -E "ownerId"
```

Two real hits today (plus the explanatory comment above the first). Any _new_ hit is upstream
assuming multiple rows per group. Decide deliberately; do not let the
"obvious" fix bake the 1:1 assumption one level deeper.

## 3. Owner-scoping vs. reachability — the other half

`PersonService.findOrFail` is owner-**agnostic** on purpose. Upstream's `getByGroupId({ ownerId,
personGroupId })` scopes the load to the caller, which is right for upstream and wrong here: in the
fork `requireAccess` is the authorization gate, and several permissions — `PersonRead` especially —
admit non-owner space-granted callers. Owner-scoping the _load_ 400s them on routes built to serve
them.

Three call sites keep upstream's owner-scoped `getByGroupId` deliberately, because the owner is known
rather than inferred from the caller: `person.service.ts` 215 (`getAll` closest-person), 1303
(recognition, scoped to the asset's owner), 1448 (`handlePersonMigration`, owner in the job payload).

## 4. The tripwire

`test/medium/specs/repositories/person.repository.spec.ts` →
_"should refuse to put a second owner's person into an existing group"_.

It asserts the unique index **rejects** the second insert. This is the executable statement of the
invariant. If it ever starts passing by deletion rather than by rejection, the index is gone and
every entry in §1 is unsound.

Upstream's two cross-user setups in that file were replaced by this test and a note; a third pair
lives in `cluster-group.service.spec.ts` and `person.service.spec.ts` (medium), documented in place.

## 5. What turning cluster groups ON would actually cost

Ordered by increasing difficulty. The first is trivial and the rest are why "M leaves the door open"
should be read as _a hold_, not _a cheap option_:

1. Drop `person_personGroupId_key` and mount `ClusterGroupController`. Minutes.
2. Revisit the **20 call sites** in §1. Each must decide which person in the group it means. No
   compiler help — the signatures do not change.
3. Revert §2 to upstream's viewer-keyed filters, and re-derive §3's reachability rules for a world
   where a viewer legitimately has their own row.
4. Reconcile with `face_identity`, which currently _is_ the cross-user mechanism. Two systems for one
   job is the real cost, and it is a product decision, not a refactor.

**This cost grows with every rebase.** Each upstream commit that assumes multi-row semantics arrives
as a bug here, and the natural fix pushes the assumption deeper. Re-read §2 whenever that happens.
