# Person queries on the denormalised `asset_face` state (immich-32593)

Status: **deferred**. The v3.3.5 cycle took upstream's schema and types (Option A) and left Gallery's
person queries as they were. This records what the rest would take, so it can be picked up without
re-deriving it.

## What upstream shipped (v3.3.4, immich-32593)

Migration `1792213725597-AddAssetFaceAssetState` copies three asset values onto every face:
`asset_face.ownerId`, `assetVisibility`, `assetDeletedAt`. A `BEFORE INSERT` trigger on `asset_face`
fills them, an `AFTER UPDATE` trigger on `asset` keeps them current, and the `asset_face_updatedAt`
trigger gets a `WHEN` clause so those copies never bump `updateId` (no sync churn). A partial index
`asset_face_personGroupId_ownerId_assetId_timeline_idx` serves `(personGroupId, ownerId, assetId)` for
visible, timeline, non-deleted faces. On top of that upstream rewrote the people list: one query
returns `total` and `hidden` with the page, `closestPersonId` is resolved in SQL, and
`inSharedAlbum(userId, assetIdRef)` no longer needs an `asset` row in scope.

## What Gallery has (Option A)

Taken verbatim: the migration, table and function definitions, the `AssetFace` type fields, test
factories, upstream's sync specs. Adapted: the two fork call sites of `inSharedAlbum`. Not taken:
the rewrite of `PersonRepository.getAllForUser` and `PersonService.getAll`. Both files are
replay-owned (`docs/fork/ownership.yml`) and Gallery's queries are a different shape, so upstream's
text cannot be applied to them.

## What Option B would change

Gallery's person reads join `asset` only to test `visibility`, `deletedAt` and, in
`getAllForUser`, `asset.ownerId = person.ownerId`. The new columns carry exactly those three values, so
the join can be dropped and the new index used.

| Method | Predicates that become column tests |
| --- | --- |
| `getAllForUser` | owner, timeline, not deleted. Cleanest case, no OR arms. |
| `getNumberOfPeople` | timeline, not deleted |
| `getDormantPeople` | timeline, not deleted |
| `getStatistics` | timeline, not deleted. Keeps `asset.isOffline` (not denormalised) and its owner / shared-album / Space OR arms, so it keeps the join. |
| `getRepresentativeFaces`, `getFaceByIdOnLiveAsset`, `getPeopleOverviewStatistics`, `getPeopleFaceStatistics` | `deletedAt` only. Check each before touching. |

Do `getAllForUser` and `getNumberOfPeople` first: identical results, no join, and they are the page
that loads the people grid. Fold `total` / `hidden` into the same query only after the first step is
measured.

## Decisions that are not mechanical

1. **Whose faces count.** Gallery counts a person's faces on the owner's own assets. Upstream counts
   the owner's, partners' and shared-album assets. Adopting upstream's shape changes the numbers and
   the minimum-faces threshold for real users. Keep owner-only unless that is chosen deliberately.
2. **Spaces.** A Space reader sees people through `spaceAssetPathBranches`, which keys on `asset.id`
   and `asset.libraryId`. Those arms stay as they are; the denormalised columns describe the asset's
   owner, not the viewer's route to it.
3. **`closestPersonId`.** Upstream resolves it inside the list query. Gallery's service still fetches
   the person first. Moving it saves one round trip but touches the #992 picker ordering, which sorts
   named people first on purpose. Do not drop that ordering.

## Invariants and gates

- Option M: a `person_group` holds one `person` row. `person-join-not-viewer-filtered` stays green.
- Person sharing stays dormant (`specs/2026-10-01-upstream-person-sharing-dormant-design.md`);
  upstream's `person_user` arms are not adopted.
- Same result sets before and after for an owner, a partner, a Space reader and a hidden-person
  fixture, asserted in `person.repository.spec.ts`. `rbac-oracle` and `access-oracle` snapshots must
  not change.
- Regenerate `server/src/queries/person.repository.sql` and compare `EXPLAIN (ANALYZE)` on a seeded
  library before claiming any speedup. No timing was measured in the v3.3.5 cycle.
- Pet faces live in the same table through `person_pet`; keep the pet-type branches of
  `getAllForUser` unchanged.
