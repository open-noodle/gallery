# Cross-account identity joins (#1317)

Status: approved, 2026-11-22. Issue: #1317. Approach chosen by the owner: **B, join two accounts' people only on a shared photo**, with repair option **A** (record manual links, repair at boot and nightly).

## Why

Each account clusters its own faces into its own people. Behind them, `face_identity` groups profiles that are the same human: personal people (`person_identity`), space people (`shared_space_person.identityId`) and individual faces (`face_identity_face`). The May design (`2026-05-05-accessible-identity-merge-cases-design.md`) lets the server join two members' personal people into one identity when a shared space connects them, so a person "appears once" across a member's library and their spaces. It relied on every read enforcing access afterwards.

Two automatic paths make that join from a member's **private** photos, and two reads do not enforce access on what the join brings in. The result reported in #1317: Alice's representative-face picker lists Bob's private faces and renders them as "Error loading" tiles, and a name or birthday Bob typed on his own person can appear on the space person and on Alice's person. Image bytes are never served; every thumbnail route checks `asset.read`.

This change makes a join between two accounts depend on a photo actually shared into the space or a link a member made by hand, makes the face picker enforce access, and repairs joins that already exist. Names and birthdays stop crossing accounts once those joins are gone.

## What happens today

Reproduced on a local stack (Alice and Bob members of one space with face recognition on; Alice shares 3 photos of one person, Bob shares none), confirmed by reading every writer and reader of the identity tables, and reproduced again on a local copy of a real library (see "Verified on real data"). A step-through diagram of the same scenario: https://claude.ai/artifact/E2iRdqPB94nuRzj8joTTUH

### Paths that join two accounts' people

| Path | Trigger | Evidence it uses | Result |
|---|---|---|---|
| Member reconciliation, `SharedSpaceService.findStrictSpacePersonLocalIdentityClaim` | Member added, space face match, space person dedup, nightly `SharedSpaceIdentityReconciliationSweep` | `searchFaces({ userIds: [member] })`: the member's whole library | Joins from private photos |
| Recognition, `PersonService` recognition → `FaceIdentityMaintenanceService.mergeWithAccessibleSharedIdentity` → `FaceIdentityRepository.findClosestAccessibleIdentityForFace` | Every recognized face of a member of a timeline-enabled space | One private face matched against space people | Joins from private photos |
| Space person dedup (`mergeIdentitiesForSpacePersonEvidence`), editor merges of space people, editor face links | Space evidence or a human action | Faces in the space | Legitimate join |

Every automatic join goes through `FaceIdentityRepository.mergeIdentities`, which moves the **whole** source identity. A legitimate join therefore also carries the member's private faces into the shared identity (verified: one shared photo brought 4 private faces along). Automatic joins stamp `source = 'shared-space-evidence'` on the moved faces; human merges keep the existing source.

### Reads that show what a join brings in

| Read | What Alice sees | Status |
|---|---|---|
| `GET /people/{id}/faces` (`GalleryPersonRepository.getRepresentativeFaces`) | Bob's private face rows: id, assetId, bounding box, `fileCreatedAt`. Thumbnails return 400. Works in both directions | Owner callers skip the access scope on the identity arm |
| `GET /people/{id}/faces/{faceId}/thumbnail`, `PUT /people/{id}/representative-face` (`getRepresentativeFaceForUpdate`) | "No asset.read access" for Bob's face vs "Not Found" for an unrelated id | Denied, but distinguishable |
| Metadata inheritance (`SharedSpaceRepository.getMetadataInheritanceCandidates`) | Bob's private name and birthday on the space person, then on Alice's person through `GET /people/{id}`, `GET /people?withSharedSpaces=true`, `GET /assets/{id}`, `GET /faces?id=` and filter suggestions | Any person on the identity is a candidate, even with no face in the space |

Checked and unaffected: thumbnails and image bytes, people counts and statistics, search and timeline buckets, space people lists and their face projection (`shared_space_person_face`), face suggestions, mobile sync streams and websocket events.

## Approaches

- **A. Keep the joins, enforce access on every read.** The May design as intended. Smallest change, no data repair, keeps the automatic "one person" behaviour. Members' private faces stay inside other accounts' identities, and correctness depends on every current and future read filtering them out; two reads already did not.
- **B. Join only on a shared photo (chosen).** Both automatic paths use only faces in the space; the reads are fixed as in A; a job repairs existing joins. A member who shares nothing of a person is never joined to another account's identity for that person. Members can still link a personal person to a space person by hand (web merge picker, `POST /people/same-person`).
- **C. Like B, with the recognition join behind an admin setting, off by default.** Keeps the automatic behaviour for instances that want it, at the cost of a setting and a repair job that has to respect it.

B was chosen: sharing a photo into the space is the signal that a join across accounts is wanted, the data itself stays per account until then, and the manual link covers the rest.

## Goals

- Two accounts' personal people are joined automatically only when the member has a photo of that person in the space.
- No read returns another account's face rows the caller could not otherwise read.
- A name or birthday reaches another account only from a person whose owner shared a photo of them into the space or linked them by hand.
- Existing joins built without a shared photo are undone, without touching joins a human made or joins backed by a shared photo.
- A test fails if any covered read hands one account's private faces to another account.

## Non-goals

- Replacing identity merges with per-space links (approach "fix 2"). Joins backed by a shared photo still carry the member's private faces into the shared identity; the read fixes keep them out of view. A later design can remove them from the data.
- A new "this person looks like that space person" suggestion. Linking stays manual.
- A distinct "no access" tile in the picker. After the read fix the picker does not list those faces.
- Changing human merge paths, the cross-owner merge setting, or space person dedup.

## Anti-goals

- Detaching a join a human made.
- Changing any API shape (rule 6): no field is added, removed or retyped.
- Growing the fork's diff on upstream files.

## Design

### 1. Reconciliation searches only faces in the space

`findStrictSpacePersonLocalIdentityClaim` calls `FaceSearchRepository.searchFaces({ spaceId, spaceAssetOwnerId: memberUserId, ... })` instead of `{ userIds: [memberUserId] }`. `spaceAssetOwnerId` is a new optional field that narrows the existing space branch (direct, linked library, linked album, visibility gate) to one owner's assets. It requires `spaceId`; the owner branch and every other caller emit the same SQL as before. A plain `spaceId` search is not enough: its nearest results are usually the other member's faces already on the target identity, so the claim would never see the member's own shared faces. Already implemented on branch `fix/1317-identity-bridge`; add the `space-member` `@GenerateSql` entry to the committed SQL with `mise sql`.

### 2. Recognition stops joining accounts

Remove the fork hunks in `PersonService`'s recognition handler that use `findClosestAccessibleSharedIdentity` and `mergeWithAccessibleSharedIdentity`. The block keeps its other fork code (video face gates, `replaceFaceIdentity`, space face matching), but the fork's diff on this upstream file shrinks:

- the `accessibleIdentityMatch` lookup and its use in `matchedOnlySelf` and `isCore`, so a lone face that resembles a space person waits for `minFaces` like any other face, as upstream does;
- the `mergeWithAccessibleSharedIdentity` call after `replaceFaceIdentity`.

Then delete `mergeWithAccessibleSharedIdentity`, `findClosestAccessibleSharedIdentity` and `FaceIdentityRepository.findClosestAccessibleIdentityForFace`, which have no other callers, with their tests and SQL entries. When the member later shares a photo of that person, space face matching queues reconciliation (§1), which joins them on that evidence.

### 3. The face picker lists only faces the caller can read

In `GalleryPersonRepository.getRepresentativeFaces` and `getRepresentativeFaceForUpdate`, a face reached through the **identity arm** qualifies only if the caller can read its asset, for every caller, owner included. The `personGroupId` arm (the person's own faces) stays as it is for the owner; non-owner callers keep their existing, narrower scope on both arms.

"Can read" means: the caller's own asset, or an asset reachable for the caller through a shared space (`spaceAssetPathBranches` with `memberUserId`, plus `spaceVisibilityGate`), the same predicate non-owner callers already get. It is one SQL predicate (`identityFaceReadableBy`) shared by both queries. It is deliberately narrower than everything `Permission.AssetRead` grants: a face another account's person holds that Alice could open only through an album or a partner share is left out of her picker. That errs toward hiding, keeps `hasNextPage` paging correct (no filtering after the query), and reuses tested code instead of re-deriving `AssetRead` in SQL. Faces on the person's own cluster are never filtered.

`getRepresentativeFaceForUpdate` has no caller parameter today; it gains one, passed from both call sites (`getFaceThumbnail`, `updateRepresentativeFace`). A face the caller cannot read then gets the same answer as a face that does not belong to the person: 404 on the thumbnail route, 400 "Representative face must belong to the person" on `PUT .../representative-face`. Neither route tells it apart from an unrelated id any more.

### 4. Names and birthdays cross spaces only with their author

Owner decision (2026-11-23): a name crosses into a space only if the user who named the person is in that space. This replaces the space-to-space rule in `specs/2026-05-02-space-timeline-opt-in-identity-scope-design.md`, which checked only the member who added the photo.

`SharedSpaceRepository.getMetadataInheritanceCandidates` now applies these rules:

- A personal person lends its name and birthday while its owner is a member of the target space and shares person names there. Hiding the person does not change that: owner decision (2026-11-25), hiding only tidies the owner's own People page. Reads of the owner's person itself still refuse a hidden person (§4b).
- A space person lends a value only if someone typed it there, and only while that author is a member of the target space and shares person names there. The earlier gates on the member who added the photo still apply. Every path that stores a typed name records its author: renaming a space person, creating one with a name (with or without a starting face), and the space person dedup, which copies the name's source and author onto the person it keeps.
- `shared_space_person.nameSetById` and `birthDateSetById` record the author. Existing names take theirs from the first `person_update` activity that recorded the same name. A name with no such entry, and every existing birthday, has no author and stays in its own space.
- A personal alias is never a source: it belongs to the member who wrote it.
- An inherited copy is never a source. Otherwise two spaces can each keep the other's copy alive after the original is gone.

A rule requiring a face in the space (`supportingFaceCount > 0`) was considered and dropped: it would also stop names from people linked by hand, who have no photo in the space by definition. When the repair job detaches a profile, the existing metadata backfill recomputes the space person and resets a name or birthday whose source left.

### 4b. Reads of a person another account owns

`person` is the owner's private row. `PersonViewerReads` (`src/gallery/utils/person-viewer-reads.ts`, built once per service by `GalleryBaseService.initGallery`) gives another member what their space shows. A member reads a person only through a profile one of their spaces shows: a visible space person for it, which the owner has not hidden. Every person read applies that rule the same way (`requireShown`):

- `GET /people/{id}` returns the space's name and birthday, no favorite, color or file path, and the space profile (`primaryProfile`, `filterId`) that scopes their photos.
- `GET /people/{id}/faces` (the picker), `GET /people/{id}/faces/{faceId}/thumbnail` and `GET /people/{id}/statistics` refuse the same people `GET /people/{id}` refuses, so a member cannot learn which photos a hidden person is in.
- `GET /faces` does the same for a viewer who reaches the photo through a space. Shared albums and partner sharing have no space to publish a name, so they keep the behaviour chosen in #796. Owner decision (2026-11-23): keep this.
- The web person page sends another member to the space's page for that person, which works for a member who keeps the space off their timeline. A refused person shows a "not available" page. A member who cannot edit sees "Person" for an unnamed person, not "Add a name".
- `GET /people/{id}/thumbnail` refuses the same people. When the viewer cannot open the cover photo, it serves a crop of a face they can open.
- `GET /faces` leaves a face without a person when the space does not show that person, as the asset viewer already does (`AssetService.get`): the person's id would lead only to reads that refuse the member.
- Turning face recognition off keeps a space's people, and the asset viewer keeps showing them, so these reads do too.

`person-reads-other-members-matrix.medium.spec.ts` covers every actor (the owner, each space role, a non-member, a server admin who is not a member, a partner, a shared album member), every setting that could change the answer (the owner hid the person; the space shows a named, an unnamed or a hidden space person; recognition on or off, which changes nothing; a cover photo the space cannot see) and all six reads (rule 7).

### 5. Repair: record manual links, detach unbacked joins

Two parts, in separate commits.

#### 5a. Record manual links

`person_identity` (a fork table) gains a nullable `manualLinkAt timestamptz`. The human merge engine (`IdentityMergePropagationService`, which every manual path goes through: `POST /people/same-person`, `POST /people/{id}/merge`, `POST /people/merge`, space editor merges) sets it to `now()` on the `person_identity` row of every **personal** profile the request names, target and sources, once the merge commits, but only when the request also names a space person. A named person that the merge folds into another of its owner's people (the survivor `chooseSurvivor` keeps) is replaced by that survivor, so the stamp lands on a row that still exists. Any personal merge also carries the earliest stamp of the people it combines onto the person it keeps, so a person linked by hand stays linked after its owner merges duplicates. (The engine's personal merge resolves only the actor's own people, so no manual path names another owner's person.) A merge of two of the actor's own people says nothing about another account; marking it would make an earlier join from private photos permanent. Space editor merges name only space people and mark nothing. Detach (`detachScopedProfile`, user-initiated or by §5b) clears it on the row it re-keys. Nothing else writes it.

It exists because nothing else in the data says a human linked two profiles: manual merges keep each face's `source` (`mergeIdentitiesAfterProfileResolution`), and `person_identity` had no provenance. Links made before this version have no value; see "What members notice".

Migration `1800200000000-AddPersonIdentityManualLink` (fork folder, numbered above the newest fork migration). `down()` drops the column: the flag has no earlier home to move back to, and dropping it only means the next repair treats those links as automatic. Add it to the `migrations-gallery` ORDER manifest.

#### 5b. Repair job

A new job, `FaceIdentityCrossOwnerRepair`.

**Rule.** A personal profile (person P, owner U, identity I) is detached when all three hold:

1. **I is shared:** it also holds another owner's personal profile, or any space person;
2. **P is not backed:** U has no live face of P, or bound to I (`face_identity_face`), on an asset that a space holding a space person on I can see (`spaceAssetPathBranches` for that space: direct, linked library, linked album and album contributions, with `spaceVisibilityGate`). U does not have to be a member of that space;
3. **P was not linked by hand:** `person_identity.manualLinkAt` is null.

Condition 2 counts P's own faces without their `face_identity_face` row, because the identity backfill writes those rows and the nightly sweep does not wait for it; a face with no row yet would otherwise read as unbacked.

Condition 2 must accept everything any automatic or editor path joins on, or that path would re-join, every night, what the repair detaches. The paths are: the reconciliation claim (§1: a member's face on an asset the space can see), space face matching and dedup (faces projected into the space, which includes photos a non-member collaborator added to a linked album), and an editor linking a face to a space person (`getOrCreateOwnerPersonForIdentity` gives the face's owner a profile on I; the owner may not be a member). All of them rest on a face of U, bound to I, on an asset a space holding I can see; condition 2 is exactly that, without a membership requirement. Medium tests run reconciliation then the repair, and an editor face link then the repair, and assert the repair is a no-op.

The rule does not look at `face_identity_face.source`. On real data the side that carries `shared-space-evidence` depends on whose face created the space person, not on who was joined: the owner's long-standing identity was merged into the newcomer's and the owner's 764 faces got the marker, while the newly joined account's faces kept `owner-person` (see "Verified on real data"). Backing does not depend on direction, and flagged exactly the right profile in every scenario tested.

**Trigger.** `FaceIdentityMaintenanceService.onBootstrap` (microservices) runs the detection count and queues the job when it is non-zero, like `hasBackfillWork`, with a fixed job id so several microservices workers queue it once. Neither boot nor the nightly run waits for the identity backfill, because backing does not depend on the rows it writes (condition 2). `handleSharedSpaceIdentityReconciliationSweep` (nightly, fork file) queues it after queueing the per-space reconciliations. So a join that loses its shared photo (the member removes it from the space, or leaves) is undone at the next nightly run, and joins always follow shared photos or manual links.

**Repair.** For each detected profile, `FaceIdentityRepository.detachCrossOwnerCandidate(id)`: in one transaction it takes the merge engine's lock (`identity-merge-propagation`), checks the rule again for that person, and only then detaches it as `detachScopedProfile` does. A member who links their person by hand after the page was listed keeps the link and its stamp. A profile that fails (for example, its person was deleted since detection) is logged and skipped; the next run re-evaluates it. Detach gives a fresh identity and moves that person's `face_identity_face` rows to it with `source` unchanged. (When the detached faces include the remaining identity's `face_identity.representativeFaceId`, detach resets it to that identity's most recently updated face; nothing reads that column today, so this has no visible effect.) After the last batch, queue one unscoped `SharedSpacePersonMetadataBackfill`, as `detachScopedPerson` does; it recomputes inherited names and birthdays and resets ones whose source left.

**Locking.** The job holds `DatabaseLock.FacialRecognition` per batch, which serializes it with recognition (the only other holder); reconciliation and dedup do not take that lock. A join that lands mid-batch is caught by the next run, because the job is idempotent. Manual merges take a different lock, so each detach also takes the merge lock and checks the rule again (Repair).

**Batching and logging.** Page candidate profiles by `personGroupId` with a cursor, a fixed chunk per job, re-queueing until none are left. One log line per page: candidates found and detached. People linked by hand are not candidates, so they are not counted.

**What members notice.**
- A member joined from private photos sees their person on its own again: it stops showing the other account's space photos, and with `withSharedSpaces` their People list shows their person and the space person separately. An owner or editor of the space can link them by hand, which now sticks; a viewer cannot (`resolveScopedMergeOrigins` requires owner or editor on the space person), so for a viewer the link returns only with a shared photo.
- The other account loses a name or birthday that came from that private person.
- A member whose last photo of a person leaves every space holding that person (they remove it, or it was in an album they owned that leaving the space unlinks) is detached at the next nightly run. Leaving a space alone does not detach: photos the member added directly stay in the space (`removeMember` deletes only the membership row and unlinks the member's own albums), so the join stays backed.
- Owner decision (2026-11-23): this is accepted. Manual links made **before** this version carry no `manualLinkAt`, so the first run undoes them once if no shared photo backs them; the member re-links. On the real library tested, no identity spanned two accounts, so nothing is affected there.

### 6. Tests

- **Unit** (`shared-space.service.spec.ts`, fork-only service): the claim searches with `{ spaceId, spaceAssetOwnerId }` and never with `userIds`. Already updated. Extend the mock fixture `setupStrictReconciliationFixture` with a case where the search returns nothing for a member whose matching face is outside the space.
- **Medium, reconciliation** (new database fixture; none exists today): a member's face on an asset outside the space produces no claim and no join; with one of the member's photos shared into the space, the join happens.
- **Medium, recognition** (`test/medium/specs/gallery/**`, a fork test of upstream code): a member of a face-enabled space uploads a private photo that matches a space person; no `person_identity` row changes and no `shared-space-evidence` row is written.
- **Medium, picker**: on a joined identity the owner sees their own private faces and a space member's shared face, and not a space member's private face or a face they could open only through an album or partner share (§3), on all three routes. The unreadable face gets the same response as a face that does not belong to the person.
- **Medium, manual-link flag** (5a): each manual merge path (`POST /people/same-person`, `POST /people/{id}/merge`, `POST /people/merge`, space editor merge) sets `manualLinkAt` on every named personal profile, enumerated so a new merge path without it fails the test; detach clears it.
- **Medium, repair job** (5b): a join built from private photos is detached; a join backed by a shared photo is kept; a person linked by hand with no shared photo is kept; a join whose member removes the shared photo is detached; a member who leaves the space while their directly added photo stays is kept; a join backed only by a photo in an album the member owned is detached after they leave (the album is unlinked); a face owner who is not a member, linked by an editor or reached through a linked album, is kept; the rule picks the joined member regardless of which side carries `shared-space-evidence`; reconciliation followed by the repair is a no-op; a second run changes nothing; a reconciliation run after the repair does not join again; the inherited name and birthday reset after the detach.
- **RBAC oracle** (`test/medium/specs/utils/rbac-oracle.medium.spec.ts`): add a fixture where one member's private faces sit on another account's identity, and the person face picker as a surface. The snapshot must show none of those faces for the other account. Mutation-check once by removing the §3 predicate.

## Version pairings (rule 6)

No endpoint or response field is added, removed or retyped. The web app ships inside the server image, so its change (§4b: the person page opens the space's page for another member's person, and a refused person shows a "not available" page) adds no pairing; it reads only fields older servers already send and falls back to the old page when `primaryProfile` is absent. Three fork columns are added: `person_identity.manualLinkAt`, read only by the repair job, and `shared_space_person.nameSetById` and `birthDateSetById`, read only by metadata inheritance. Existing response fields keep their types; for a person another account owns, some now carry empty values.

- **Older Gallery app, new server**: the picker lists fewer faces; some person names and birthdays become empty where they came from another account's private person. No decoding change.
- **New app, older server**: no mobile change in this work.
- **Stock Immich apps**: unaffected; none of these reads are reachable through them.
- **Stock Immich server on a Gallery database**: unaffected; only fork tables change.
- **Older Gallery server on a database this version migrated**: it does not know `1800200000000-AddPersonIdentityManualLink` or `1800300000000-AddSpacePersonMetadataAuthor`, so the documented downgrade applies (revert the fork migration with the newer image first). It would also start joining from private photos again; upgrading repairs at boot.

## Switching back and downgrading

`scripts/revert-to-immich.sql` already drops `person_identity` with every fork table, so the new column needs no change there. The migration's `down()` drops the column (see 5a). The repair job only rewrites rows in fork tables (`face_identity`, `face_identity_face`, `person_identity`) and inherited metadata on `shared_space_person`.

## Verified on real data

A local copy of a real library (2 accounts, 13 spaces with face recognition, about 71,000 faces, 2,698 people; restored from a read-only dump, run against this branch's server on a laptop) with 30 private photos of one person moved to the second account in the copy:

| Scenario | Result |
|---|---|
| Current code | The second account's person joined the owner's identity through recognition; the owner's picker listed 28 of its private faces (thumbnails 400), and two single-face people appeared below `minFaces` |
| §2 only | One 29-face person on its own identity; no join, no single-face people |
| §2, nightly sweep without §1 (control) | The sweep alone joined it; all 29 faces stamped `shared-space-evidence` |
| §2 + §1, nightly sweep | 11,450 claim searches, all space- and owner-scoped; no join |
| Second account shares one photo | Join formed, as intended; the owner's identity was merged into the newcomer's, and the marker landed on the owner's 764 faces |
| §3 | Owner's picker 7,674 → 7,646 faces: exactly the 28 private ones gone, the one shared face kept; the second account's picker listed only faces on assets in its spaces; an unreadable face answers like a random id |
| Repair (prototype: backing-only detection + `POST /people/detach-profile`) | Flags only the bad profile on the joined copy, nothing on the shared-photo join, nothing among the 2,698 people of the untouched library; detach left no identity spanning accounts; the nightly sweep afterwards did not re-join |
| Second account removes its shared photo | Backing-only detection flags the second account's person |
| Second account links its person to the space person by hand, no shared photo | Backing-only detection flags it, which is why 5a exists |

## Upstream diff

- `server/src/services/person.service.ts` (upstream file): against `refs/upstream/v3.4.2` the diff goes from 499 added and 308 removed lines to 492 and 307. §2 removes fork hunks; §4b adds one call per read into `PersonViewerReads`.
- All other changes are in fork files: `server/src/gallery/**`, `server/src/services/shared-space.service.ts`, `server/src/repositories/face-identity.repository.ts` and fork test files. Report the before/after `git diff --stat refs/upstream/v3.4.2` for touched upstream files in the PR.

## Docs

`docs/docs/features/shared-spaces.md` and the facial recognition page: one or two sentences saying a personal person is linked to a space person automatically only when the member has a photo of that person in the space, and can be linked by hand otherwise.

## Calls made (check these while reading)

- §3 uses "own or through a space", not everything `AssetRead` grants (reasons in §3).
- §4: people linked by hand keep lending their names. The owner set the author rule; applying it to birthdays too, and leaving names with no recorded author in their own space, are my calls.
- §4b: shared albums and partner sharing keep #796's behaviour, because they have no space to publish a name.
- §5b uses backing only, not the `shared-space-evidence` marker, because real data showed the marker can land on either side.
- §5b's backing accepts every join path's evidence and does not require membership, so no job re-joins what the repair detaches. Checked on real data: same results as the earlier rule on all four copies, 0.2–0.3 s per run.
- §5b holds `DatabaseLock.FacialRecognition` and relies on idempotent re-runs for the automatic paths, and takes the merge engine's lock only around each detach, for manual links.
- §4b: a space with face recognition off still shows its people to other members, matching the asset viewer. Checked on the Android app (2026-11-24): the people strip, the person page and the People list show the space's name and only shared photos; a person the space hides shows no People section.

## Commits

One PR, one commit per part, so each can be reviewed and sized on its own: this spec; §1; §2; §3; 5a; 5b; docs; repair fix; §4b; §4; docs; then one commit each for the review's findings on the repair, typed names, and person reads.

## Left to the builder

- Chunk size and cursor shape for §5.
- Whether §5's detection lives in `FaceIdentityRepository` or a new fork repository under `server/src/gallery/repositories/`.
