# Dissolve a person — design

Status: revision 1 implemented (see "What shipped, and what did not" below); **revision 2 approved for build**
(see "Revision 2" below, which overrides any earlier section it contradicts)
Date: 2026-09-06, revised 2026-10-28
Surface: admin face cleanup console (`/admin/face-cleanup`)

## Revision 2 (2026-10-28): make a dissolve stick

### Why

Issue #1228 is the case this feature was asked for, and revision 1 does not fix it. The reporter has
"junk persons": hundreds to thousands of tiny, blurry or non-face **machine-learning** detections (patterns,
plush toys, backs of heads), every one with an embedding. Recognition chains them together: a face joins a
person because it is close to _one_ member, so the cluster has no coherent centre (average pairwise distance
0.84, the range of two unrelated people) and grows with every run. Their largest is 1,244 faces; about
11,000 faces sit in clusters like it. The cluster is also copied into the Space people of every Space holding
those photos (4 Spaces in their case).

Revision 1 cannot remove such a person for good:

- **`unassign` boomerangs.** The non-forced recognition pass streams every `personGroupId IS NULL`
  machine-learning face back through `FacialRecognition` (`getAllFaces({ personGroupId: null, ... })` in
  `PersonService.handleQueueRecognizeFaces`), with the same rules that built the cluster. The codebase already
  says so for single faces: "A bare unassign would therefore boomerang" (`face-repair.service.ts`, the
  "Unknown person" comment). For this reporter it is worse than a rebuild: 63% of the junk faces' five
  nearest neighbours belong to _other_ people (320 of them), so with Cluster A gone the faces are filed under
  whichever person is nearest, real people included.
- **`delete-faces` boomerangs.** It always re-detects. The same detector on the same preview finds the same
  boxes, which become new face rows, are queued for recognition and cluster again.
- **Spaces keep the junk after `unassign`.** `shared_space_person_face` rows are left in place, so the orphan
  check finds every Space person still linked and removes none.

### Decisions (owner, 2026-10-28)

1. **Detected faces are hidden, not unassigned or deleted.** "Hidden" is the existing "Not a face" tombstone:
   `asset_face.deletedAt` set, `personGroupId` cleared, `face_identity_face` rows removed. Every path that
   could bring the face back already skips it: `getAllFaces` and `searchFaces` filter
   `asset_face.deletedAt IS NULL`, so recognition never picks it up and it never serves as a neighbour that
   bridges other junk; and `handleDetectFaces` keeps it, because `getForDetectFacesJob` returns soft-deleted
   faces, so a fresh detection at IoU > 0.5 matches the tombstone and adds no new row. `deletedAt` is
   upstream's own soft-delete column, so stock Immich hides these faces too (layering rules 1, 2 and 4).
2. **Accept losing the occasional real face inside a junk person.** Reviewing 11,000 faces one by one is not
   a workflow anyone will follow, and a real face inside Cluster A is not under its person's name today
   anyway. The dialog says this and points at the console's existing per-face move as the way to rescue a
   face _before_ dissolving.
3. **Hiding is undoable.** The dissolve records which faces it hid. Restoring a dissolve brings every one of
   them back as an unnamed face, and recognition sorts them again. Restore is per dissolve, all or nothing.
   It does not recreate the dissolved person.
4. **The outcome picker goes.** The admin picks only _which_ faces (the existing `scope`). Each kind of face
   gets the one treatment that works for it (table below). `unassign` disappears as a choice.
5. **Spaces are cleaned up too,** but only for the faces this dissolve touched (detail below).
6. **No new discovery.** No cohesion or face-size signal and no junk-cluster detector: the owner's call is
   that people find these clusters on their own People page. The cheap signal (face size) is noisy on its
   own, and the reliable one (spread around the centroid) is expensive at 35k people. The existing Health
   tab stays exactly as revision 1 shipped it. **Finding a person in the console is by name:** the admin names
   the junk person on the People page ("junk 1"), then searches for it in Face Cleanup. The user docs
   (`docs/docs/administration/face-cleanup.md`) say so. No link from the People page into the console.

### Treatment per face

Within the chosen scope, each face of the person gets exactly one treatment:

| Face                                                                         | Treatment                                       | Undoable | Re-detect its photo |
| ---------------------------------------------------------------------------- | ----------------------------------------------- | -------- | ------------------- |
| Hand-drawn (`asset_face_creator` row) or `sourceType = 'manual'`             | Unassigned, left on the photo                   | n/a      | no                  |
| `sourceType = 'machine-learning'` (with or without an embedding), not pet    | **Hidden** (tombstone) and recorded for restore | yes      | no                  |
| `sourceType = 'exif'`                                                        | Deleted, photo re-scanned (revision 1 behaviour) | no       | yes                 |

- **Why imported faces are still deleted:** a hidden EXIF face would block the repair. `handleDetectFaces`
  matches any non-pet existing face at IoU > 0.5, soft-deleted ones included (L12), and writes the new
  embedding onto it instead of adding a face. So a hidden EXIF box would swallow the real face the re-scan
  is meant to find. Deleting it lets the detector add a fresh, visible face, which recognition then files
  normally.
- **Why manual faces are unassigned, not deleted (builder's note: this widens revision 1).** Revision 1
  kept only `asset_face_creator` boxes and deleted owner-drawn `manual` faces. Recognition never re-clusters
  a non-ML face, so unassigning a manual face cannot boomerang, and no re-scan can recreate a box a person
  drew. Unassigning is the safe treatment for both.
- **Detected faces are not re-scanned.** Re-scanning would find the same boxes; the tombstone already does
  the job. Only the photos of deleted EXIF faces get their `facesRecognizedAt` cleared, which also shrinks
  L3 (re-detection removing another person's face on a shared photo) to the EXIF part of a dissolve.
- **Pets** stay excluded from every scope, and pet persons are still refused (L6).
- Already soft-deleted faces of the person in scope: EXIF ones are hard-deleted as before (L12); ML ones
  are already hidden and get their `personGroupId` cleared; they are not recorded for restore, since this
  dissolve did not hide them.
- Faces with `isVisible = false` (hidden by an edit crop) are treated like visible ones by source. A
  detected one is hidden like the rest, so it cannot reappear on the person if the crop is undone.

### The person

After the treatments, if the person has no face left that still carries its `personGroupId`, the dissolve
deletes that one `person` row and queues `FileDelete` for its thumbnail (revision 1's
`delete-faces-and-person` path; never `PersonCleanup`, L2). If faces remain (a partial scope), the person
survives and its representative face is repointed the way the "Not a face" detach does it
(`faceRepairRepository.reconcileRepresentativeFaces`), with `PersonGenerateThumbnail` queued when it changed.
A surviving person must never show a hidden face as its thumbnail.

### Spaces

- For every face this dissolve **hides**, delete its `shared_space_person_face` rows inside the
  transaction. Deleted EXIF faces lose theirs by cascade, as today. Unassigned hand-drawn and manual faces
  keep theirs (revision 1 behaviour).
- Then remove only the Space persons left with no faces by this dissolve (existing L1 logic, still never
  `deleteAllOrphanedPersons()`).
- A Space person that survives because it still has faces from other photos stays. The preview reports how
  many Space persons will survive and in how many Spaces, so the admin is not surprised to still see them.
- A surviving Space person must not keep a hidden face as its `representativeFaceId`. Hiding does not null
  that FK (the row still exists), and `repairInvalidRepresentativeFaces` does not check
  `asset_face.deletedAt`. The builder repoints it inline or extends the repair; either is fine as long as a
  test proves it.
- Space face matching must not re-link a hidden face. It reads faces through queries that already filter
  `asset_face.deletedAt IS NULL`; the regression tests below pin it.

### Restore

- **Storage:** two fork tables, created by a new fork migration in `server/src/schema/migrations-gallery/`
  numbered above `1799000000000` (builder's choice of round number):
  - `face_dissolve`: `id` (uuid v7), `ownerId` (FK `user`, CASCADE), `personGroupId` (plain uuid, no FK: the
    person may be gone), `personName` (snapshot for the list), `scope`, `actorId` (FK `user`, SET NULL),
    `createdAt`, `restoredAt` (nullable), counts for the list (hidden, deleted, unassigned).
  - `face_dissolve_face`: (`dissolveId` FK CASCADE, `assetFaceId` FK `asset_face` CASCADE), primary key on
    both. Only hidden faces are recorded.
  - Every FK onto an upstream key (`user.id`, `asset_face.id`) is listed in
    `server/src/schema/gallery-upstream-fks.json`. `scripts/revert-to-immich.sql` drops both tables. The
    migration's `down()` drops them: the data has no upstream home, and the tombstones themselves stay in
    upstream's own column, so nothing is lost that stock Immich could use. Say so in the migration.
- **Restore** sets `deletedAt = NULL` on the recorded faces that still exist and are still hidden
  (`deletedAt IS NOT NULL AND personGroupId IS NULL`), stamps `restoredAt`, then queues
  `FacialRecognitionQueueAll { force: false }`. Faces return unnamed; the dissolved person is not recreated;
  Space links come back only if Space matching re-links them. Restoring an already-restored dissolve is a
  409. It refuses while recognition or detection is active, like the dissolve.
- **What breaks a restore, accepted:** a forced "Detect faces (all)" hard-deletes every ML face, hidden ones
  included, and the cascade empties the record. A photo deleted later takes its faces with it. A re-scan
  that no longer detects a hidden face (for example after raising the detection score) hard-deletes it. The
  list shows how many recorded faces still exist.
- **Expected:** restored junk will most likely re-cluster. The restore confirmation says so.
- **Web:** a "Dissolved" page under Face Cleanup (`/admin/face-cleanup/dissolved`, next to `declined` and
  `resolutions`), listing dissolves newest first with person name, owner, date, counts, faces still
  restorable, and a Restore button. Linked from the dashboard the same way the other two are.
- **Retention:** none. Records live until restored or until their faces are gone.

### API changes

- Preview and apply body becomes `{ scope, expectedFaceCount }`. `outcome` and `redetect` are removed
  (the PR is unmerged, so no compatibility shim). The named `DissolveOutcome` schema goes with them.
- Preview counts gain what the dialog must state: faces to hide, faces to delete, faces to unassign, whether
  the person will be removed (and how many faces it keeps otherwise), Space persons removed vs surviving
  and the number of Spaces, plus the existing `shared-assets`, `not-redetectable` and `metadata-import-on`
  inputs (now computed over the EXIF part only, since only those photos are re-scanned).
- Warnings that described `unassign` (`strands-faces`, `recluster-similar`, `person-will-be-cleaned-up`) are
  removed. `hand-drawn-kept` stays and now also covers manual faces.
- New: `GET /admin/face-repair/dissolves` (paged) and `POST /admin/face-repair/dissolves/:id/restore`.
  Admin-only, like the rest of the console.
- The active-job refusal (L13) covers both the FacialRecognition and FaceDetection queues.

### Web dialog

- One choice: which faces, the four scope buttons revision 1 shipped (all, imported, detected, without
  embedding). The outcome radio and the re-detect checkbox are removed. (Revision 1's planned quick-select
  chips never shipped; there is nothing to convert.)
- The preview states, in plain words, what happens to each kind of face, whether the person goes, what
  remains in Spaces, and that hidden faces can be restored from the Dissolved page.
- A line before the confirm: real faces caught in this person will be hidden too; move them to the right
  person first if you want to keep them.
- The typed-name confirmation stays.
- New strings go in `i18n/gallery/en.json` plus the nine overlay locales; strings removed with `unassign` are
  deleted from all ten.

### Regression tests: the dissolve must stick

Medium tests against a real database. Each must fail against revision 1's `unassign` and `delete-faces`.

| Test                       | Asserts                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-recluster`             | A chained junk person (embeddings A≈B≈C, A far from C) next to a real person P2 whose faces sit within `maxDistance` of some junk faces. Dissolve, then run the non-forced recognition queue and every queued `FacialRecognition` job, including the deferred pass. No dissolved face gets a `personGroupId`, no new person is created, P2's face count is unchanged. |
| `nightly-skips`            | The nightly `FacialRecognitionQueueAll` does not queue any hidden face.                                                                                                                                                                                 |
| `redetect-keeps-tombstone` | `handleDetectFaces` on a dissolved photo with the ML stub returning the same boxes: no new `asset_face` row, the hidden face stays hidden.                                                                                                               |
| `not-a-neighbour`          | A new face that is close only to hidden faces does not join anyone through them.                                                                                                                                                                        |
| `space-cleanup`            | The Space persons holding only dissolved faces are removed; one also holding another photo's face survives with the hidden face removed from it and a representative that is not hidden; Space face matching on the photo does not re-link a hidden face. |
| `restore`                  | Restore un-hides exactly the recorded faces, leaves faces hidden by the console's own "Not a face" alone, queues recognition once; a second restore is a 409; a recorded face hard-deleted in between is skipped and reported.                          |
| `exif-repair`              | Unchanged from revision 1: imported faces are deleted, their photos re-scanned, and a fresh visible face appears where the detector finds one.                                                                                                         |

Revision 1's isolation fixture and its blast-radius tests (L1 to L13) still apply and are updated to the new
treatments, not dropped. The e2e run dissolves an ML junk person and checks the faces are hidden and the
person is gone, then restores it.

### Out of scope, separately tracked

- **Stopping new junk from forming.** New uploads can still chain into a fresh junk person. The reporter's
  prevention ideas (a minimum face size for clustering, checking a face against the person as a whole rather
  than one nearest member) belong in recognition, behind fork hooks that default to upstream behaviour. A
  follow-up PR, linked from #1228.
- Recording the console's existing single-face "Not a face" action for restore.
- Any discovery of junk clusters (decision 6).

### Left to the builder

- Where the new code lives. New fork files go under `server/src/gallery/` (layering rule 5); moving revision
  1's `face-dissolve.*` files there in the same PR is the builder's call, as long as the PR reports whether
  upstream-file diffs grew or shrank.
- Whether the hide step reuses `faceRepairRepository.detachFaces` (it filters `isVisible = true` and
  `deletedAt IS NULL`, so it covers most but not all of the table above) or a dissolve-specific statement.
- Pending face suggestions for hidden faces are drained the way the "Not a face" detach drains them
  (`facePersonVerdictRepository.drainPendingForFaces`), in the same transaction.
- Confirm that stock mobile apps treat a soft-deleted face the same way they already do for the console's
  "Not a face" action; this revision adds no new sync behaviour.

## What shipped, and what did not

The feature shipped. Two pieces described below were **cut during implementation** and are recorded here so
the spec does not claim them:

- **Preview sample crops (§2).** The preview returns counts and warnings only. Rendering crops via
  `faces/:assetFaceId/thumbnail` was cut; the counts plus the typed-name confirmation carry the safety
  argument on their own. Deliberate scope cut, not an oversight.
- **The dashboard banner (§1).** No "Import faces from metadata is ON. N people have …" banner exists.
  Discovery is the Health tab on `/admin/face-cleanup/people` and nothing else.

Everything else in this document shipped as described, with the amendments marked **[shipped]** inline.

## Problem

Users report people that have become "contaminated": a person accumulates thousands of faces that are not
that person, frequently crops of non-person objects. Once a person reaches this state the user has no way
out. Every existing repair tool is blind to the faces causing it.

The goal is not to find the source bug. The goal is to give an admin a way to dissolve such a person and
have the library repair itself on the next detection/recognition run.

## Findings (verified against the code, not assumed)

The face cleanup console, the scan, manual review and "Reset all people" are **all** restricted to
machine-learning faces that have an embedding. Faces imported from file metadata satisfy neither condition.

| Mechanism                              | Why it cannot see the contaminating faces                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| "Reset all people" (force recognition) | `unassignFaces({ sourceType: MachineLearning })` — `person.service.ts:1076`. A comment at `:1147` concedes EXIF personIds survive. |
| Recognition fan-out                    | `getAllFaces` filters `sourceType: MachineLearning` on **both** the force and non-force arms — `person.service.ts:1113`.           |
| Cleanup scan / manual review           | Every query in `face-repair.repository.ts` is `innerJoin('face_search')` **and** `sourceType = 'machine-learning'` (`:224-226`).   |
| Ever gaining an embedding              | Only if ML detection later lands a box at IoU > 0.5 on the same region — `person.service.ts:967`. A region over a lamp never will. |
| `DELETE /people/:id`                   | `asset_face.personId` is `ON DELETE SET NULL`. The junk rows outlive the person as invisible orphans — strictly worse.             |

Where they come from: `applyTaggedFaces` (`metadata.service.ts:1039`) turns every `RegionInfo` region in a
file into an `asset_face` row with `sourceType: 'exif'`, auto-creating a person per distinct region name,
gated on `metadata.faces.import` (default `false`, so affected users enabled it). `orientRegionInfo`
(`:975`) rotates each box by EXIF orientation — correct names with mis-rotated boxes would produce exactly
the reported symptom. **Not in scope to fix here**, but it dictates that dissolve must be source-aware.

**Consequence for the design:** the two contamination causes need opposite treatments.

- **EXIF-sourced junk has no vector.** It can never be re-clustered. Deleting the rows _is_ the repair.
- **ML mis-clustering has vectors.** Those rows must survive and be re-clustered.

A single "dissolve" button cannot serve both. Scope and outcome are separate axes.

### The repair mechanism

`streamForDetectFacesJob` skips assets on `job_status.facesRecognizedAt IS NULL` **only when `force === false`**
(`asset-job.repository.ts:458`). Clearing `facesRecognizedAt` for just the dissolved assets therefore makes
the ordinary non-forced "Detect faces (missing)" pass re-process exactly those photos and nothing else.
Detection then writes fresh ML faces with embeddings and itself queues
`FacialRecognitionQueueAll { force: false }` (`person.service.ts:1003`), so clustering follows automatically.

## Scope

Decided:

- **Admin console only.** Consistent with manual review mode being admin-only.
- **Personal people only.** Space people are a projection; dissolving the underlying personal person is what
  repairs the space view.
- **Delete + warn inline.** No tombstone table, no silently flipping the global `metadata.faces.import`
  setting from inside a person-scoped action. The console warns and links to the setting.
- **Dry-run preview, then irreversible.** No undo page, no retention window.

Non-goals, recorded so they are not rediscovered as omissions: space people; undo; blocking re-import;
an owner-facing surface; fixing the EXIF import bug; pet people (see L6).

**[revision 2]** Three of these are reversed: detected faces are hidden (a tombstone), hiding is undoable, and
the Space persons holding dissolved faces are cleaned up. "No tombstone table" and "no undo page" no longer
hold. See "Revision 2" at the top.

## Design

### 1. Discovery

Contaminated people are currently unreachable in the console: `GET /admin/face-repair/owner/:ownerId/people`
is only the move-to-chosen-person **picker search**, and a scan never flags an EXIF face. Discovery is part
of the feature, not a nicety.

`GET /admin/face-repair/people` — admin, paged, `ownerId?`, `sort=exifFaces|facesWithoutEmbedding|faceCount`.
Per person: `id`, `name`, `ownerId`, `faceCount`, `bySource: { machineLearning, exif, manual }`,
`facesWithoutEmbedding`. One `GROUP BY person.id` over `asset_face` left-joined `face_search`, filtered
`deletedAt IS NULL AND isVisible`.

Surfaced on the existing `/admin/face-cleanup/people` page (the #838 browse-people surface, which already
renders a face count) as extra columns plus a sort — no new route. ~~The dashboard gains a banner:
"Import faces from metadata is ON. 4 people have 3,180 metadata-imported faces with no matching detection."~~
**[shipped]** The banner was cut; the Health tab is the whole of discovery.

**[shipped]** `ownerId` is **required**, not optional. Unfiltered, the aggregate GROUPs BY `person.id` over
every visible `asset_face` row on the instance and ORDERs BY an aggregate alias, so `LIMIT`/`OFFSET` prune
nothing and each page re-runs the whole thing. The one client always sends an owner, so the unbounded shape
is refused at the DTO with a 400 rather than left reachable from the API.

### 2. Preview

`POST /admin/face-repair/person/:personId/dissolve/preview`, same body as apply. Returns the affected face
count split by `sourceType` × has-embedding, affected asset count, **assets shared with other people**
(see L3), **assets that cannot be re-detected** (see L11), ~~sample crops via the existing
`faces/:assetFaceId/thumbnail`~~ (**[shipped]** cut — counts and warnings only), and `warnings[]`.

**[shipped] The displayed `faces` count is not the health row's face count, deliberately.** `getCounts`
counts every in-scope row, soft-deleted and invisible faces included, because those are rows the apply will
touch and an irreversible operation must show what it touches. `getPeopleHealth` excludes them
(`deletedAt IS NULL AND isVisible IS TRUE`), because it is answering "how contaminated does this person look
to a human". The two numbers can therefore disagree for the same person; that is intended, and the preview's
number is the authoritative one for the operation. `expectedFaceCount` is `getCounts`'s number, so the
concurrency guard is never compared against the health row's.

Four warnings are load-bearing honesty rather than decoration:

- On N assets the junk will be deleted but **nothing will be recovered**, because they are hidden, trashed
  or have no preview file (L11).

- Unassigning EXIF faces **strands** them — no embedding means `getAllFaces` never fans them out again.
- Unassign leaves the person with zero faces; the nightly `PersonCleanup` will delete it regardless. We do
  not trigger that ourselves (L2), but we must not imply the person survives. **[shipped]** as the
  `person-will-be-cleaned-up` warning, fired when the outcome is `unassign` and `remainingLiveFaces` — the
  person's faces the dissolve does _not_ touch, counted with `getAllWithoutFaces`'s own
  `deletedAt IS NULL AND isVisible IS TRUE` — is zero. Counted that way on purpose: that query, not the
  displayed face count, is what decides the person's fate.
- Unassigned ML faces re-cluster from scratch, which changes the outcome **only** if recognition settings
  changed. Otherwise expect a similar grouping.

### 3. Operations

**[revision 2]** The `outcome` and `redetect` fields below are removed; each face's treatment now follows
from its source ("Treatment per face" at the top). §2's `unassign` warnings and §5's chip table are replaced
in the same way. The text below records revision 1.

`POST /admin/face-repair/person/:personId/dissolve`

```ts
{
  scope: 'all' | 'exif' | 'machine-learning' | 'without-embedding',
  outcome: 'unassign' | 'delete-faces' | 'delete-faces-and-person',
  redetect: boolean,          // forced true for delete outcomes
  expectedFaceCount: number,  // 409 if drifted since preview
}
```

`expectedFaceCount` is the concurrency guard: the preview response returns it and the client passes it back
unchanged. Because the operation is irreversible, an apply must never act on a different set than the one
previewed. `redetect` is forced to `true` for both delete outcomes; an explicit `false` alongside a delete
outcome is a 400 rather than a silent override, so a client can never believe it opted out.

**[shipped] The guard is best-effort, not a lock.** It is a `getCounts` read compared _outside_ the write
transaction; nothing holds a lock between that read and the `DELETE`. So the edge-case row "concurrent
dissolve of the same person → second gets 409" holds for anything slower than the gap between the two
statements, and the L13 refusal covers the one racer that actually matters (a running recognition pass) —
but two simultaneous applies can in principle both pass the guard. Accepted: the console is admin-only and
single-operator, and the alternative is a `SELECT … FOR UPDATE` over every in-scope face row.

- **unassign** — `personId = NULL` on matching faces, **plus** delete their `face_identity_face` rows. Skipping
  the second half is the exact bug documented at `person.repository.ts:327`: stale manual links make faces
  permanently settled, excluded from recognition and suggestions forever.
- **delete-faces** — single indexed `DELETE`; the six `ON DELETE CASCADE` FKs do the rest.
- **delete-faces-and-person** — plus the person row and a `FileDelete` for `thumbnailPath` (mirrors
  `removeAllPeople`), skipped when the path is empty (L7).

**[shipped, 2026-10-09] A dissolve never deletes a hand-drawn face box.** A face with
`asset_face.createdBy IS NOT NULL` was drawn by a person, not produced by the detector or a metadata import.
`createdBy` is the **sole** deletability signal for such a box
(`specs/2026-08-23-space-editor-face-assignment-design.md` §6.6): the space editor who drew it may delete it,
and nothing else is allowed to treat it as disposable detector output. `sourceType` cannot stand in for it —
owner-drawn boxes are `manual` with `createdBy` NULL, and hand-drawn ones are not re-creatable by any
re-detection, so a bulk delete would destroy human work the "repair" can never put back.

So both delete outcomes split the in-scope set:

- in-scope faces with `createdBy` set get the **`unassign` treatment** — `face_identity_face` rows deleted
  (keyed by face id), then `personGroupId = NULL` — and stay on the photo, unnamed, ready to be assigned;
- every other in-scope face is deleted as before.

The rule lives in the shared predicate layer (`server/src/utils/face-dissolve.ts`):
`handDrawnFacePredicate` and `dissolveDeletableFacePredicate` (in-scope AND NOT hand-drawn). `getCounts`
counts the kept faces as `handDrawn` with the same predicate, and the service emits a `hand-drawn-kept`
warning on both delete outcomes, so the dialog says "N hand-drawn faces will be kept and unassigned" before
the admin confirms. `faces` (and therefore `expectedFaceCount`) still counts them: they are touched.

Ordering: the hand-drawn unassign runs **before** the delete and before the person row is removed. Nothing
would cascade into them anyway — `asset_face.personGroupId` references `person_group` with `ON DELETE SET NULL`,
and deleting a `person` row does not delete its `person_group` — but unassigning first means no statement of
`delete-faces-and-person` ever sees them carrying this person's id. The watermark clear is unchanged: it still
covers every in-scope face's asset, hand-drawn included. Re-detection over a kept box is pre-existing
behaviour, not new: `handleDetectFaces` matches any non-pet existing face at IoU > 0.5 and writes the
embedding onto it rather than adding a second box, and it only ever removes `machine-learning` faces, so a
kept hand-drawn box is neither duplicated nor deleted by the re-detection pass. (A soft-deleted hand-drawn box
is likewise kept, so it can still absorb a detection per L12 — the same as `unassign` has always behaved.)

Space links are treated exactly as `unassign` treats them: a kept hand-drawn face keeps its
`shared_space_person_face` row, so the space person it was drawn for is not counted as orphaned by this dissolve.

Deliberately **not** writing negative `face_person_verdict` rows on unassign. Negatives are the face-by-face
layer from the review unification work; 3,000 of them is the wrong tool. Dissolve is the bulk reset.

### 4. Execution

Synchronous, one Kysely transaction, no job and no new table. `asset_face_audit` is `scope: 'statement'`
with a transition table, so a bulk delete emits **one** `INSERT ... SELECT` rather than one per row — a
single indexed delete handles tens of thousands of rows well under a second. Chunking buys nothing.

Pass `trx` through explicitly; never `this.db` inside the transaction.

**Ordering constraint — getting this backwards silently no-ops the entire feature:** clear
`facesRecognizedAt` _before_ the delete, because afterwards there is no `personId` left to find the assets by.
For the same reason, capture the affected `shared_space_person` ids (L1) before the delete too — afterwards
the `shared_space_person_face` rows that identify them are already gone.

```sql
UPDATE asset_job_status SET "facesRecognizedAt" = NULL
WHERE "assetId" IN (SELECT DISTINCT "assetId" FROM asset_face WHERE "personId" = $1 AND <scope>);

DELETE FROM asset_face WHERE "personId" = $1 AND <scope>;
```

Then queue, outside the transaction: `PersonGenerateThumbnail` for surviving people whose `faceAssetId` was
nulled, and `AssetDetectFacesQueueAll { force: false }` when `redetect`.

**No migration.** All six referencing FKs already cascade; nothing new is stored. **[revision 2]** No longer
true: the restore record adds two fork tables and one fork migration.

### 5. Web

**[shipped]** The modal is `web/src/lib/modals/PersonDissolveModal.svelte` — shared, not route-local — and
has **two** entry points, because discovery and the modal live on different pages and this spec originally
connected neither:

| Launcher                                                   | Why it exists                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `routes/admin/face-cleanup/[personId]/+page.svelte`        | The original: the scan-result person page, opened from the header.                                       |
| `routes/admin/face-cleanup/people/[personId]/+page.svelte` | The manual-review page — **where the Health tab's rows actually link**. Without it, discovery dead-ends. |

Contents: scope/outcome controls, debounced preview, warnings, ~~sample crops~~ (cut), typed confirmation
(the person's name) before apply. Quick-select chips map the three original mental-model options onto the two
axes:

| Chip                           | scope  | outcome                   | redetect |
| ------------------------------ | ------ | ------------------------- | -------- |
| Remove imported metadata faces | `exif` | `delete-faces`            | true     |
| Start this person over         | `all`  | `delete-faces`            | true     |
| Delete person and its faces    | `all`  | `delete-faces-and-person` | true     |

### 6. i18n

New keys under the existing `admin.face_cleanup_*` namespace (251 keys already), inserted alphabetically, in
all nine locales in the same commit — `de fr it nl pl es ru zh_Hans zh_Hant` — informal in de/it/es, formal
in fr/ru. Then `npx prettier --write i18n/*.json`.

## Blast radius

A dissolve writes to `asset_face`, six cascading tables and `asset_job_status`. Each path below is a way the
operation could reach data outside the target person. Every one has a named test in the matrix.

| #   | Leak path                                                                                                                                                                                                                                                                                                                               | Decision                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | `sharedSpaceRepository.deleteAllOrphanedPersons()` is **unscoped**: `DELETE FROM shared_space_person WHERE id NOT IN (SELECT "personId" FROM shared_space_person_face)` (`shared-space.repository.ts:4090`) — instance-wide.                                                                                                            | **Do not call.** Capture affected `shared_space_person` ids before the delete; remove only those left with zero faces.                                                                                         |
| L2  | `PersonCleanup` uses `getAllWithoutFaces()` — library-wide. Queuing it makes our dissolve delete unrelated faceless people.                                                                                                                                                                                                             | **Do not queue.** `delete-faces-and-person` deletes the one target person directly. The nightly job handles the rest on its own schedule.                                                                      |
| L3  | Clearing `facesRecognizedAt` on an asset that also holds **other people's** faces re-detects that asset; `handleDetectFaces` hard-deletes any ML face not re-matched at IoU > 0.5 (`faceIdsToRemove` + `unlinkFaces`, `person.service.ts:990`).                                                                                         | **Cannot be prevented without abandoning the repair** — junk regions usually sit on photos that do contain real people. Surface the shared-asset count in the preview; test that still-matching faces survive. |
| L4  | Deleting `face_identity_face` by `identityId` would wipe manual links for other people sharing that identity after a merge.                                                                                                                                                                                                             | Key the delete by **our face ids only**, never by identity.                                                                                                                                                    |
| L5  | `faceIdentityRepository.deleteUnreferencedIdentities()` is a global GC.                                                                                                                                                                                                                                                                 | **Do not call.** Leave to the existing maintenance job.                                                                                                                                                        |
| L6  | Pet faces use `pet_search`, not `face_search`, so `scope: 'without-embedding'` matches **every pet face** of a pet person.                                                                                                                                                                                                              | Exclude pets with `petFacePredicate` (`utils/database.ts:1512`) on every scope; reject `person.type = 'pet'` with 400.                                                                                         |
| L7  | `FileDelete` queued with an empty `thumbnailPath`.                                                                                                                                                                                                                                                                                      | Skip the job when the path is empty.                                                                                                                                                                           |
| L8  | Another user's people/faces.                                                                                                                                                                                                                                                                                                            | Scope by `personId` only; assert non-interference explicitly.                                                                                                                                                  |
| L9  | `face_person_verdict` drain on unassign.                                                                                                                                                                                                                                                                                                | Scope to the affected face ids.                                                                                                                                                                                |
| L10 | Partial failure leaving faces deleted but the person alive (or vice versa).                                                                                                                                                                                                                                                             | One transaction; assert full rollback.                                                                                                                                                                         |
| L11 | `streamForDetectFacesJob` runs through `assetsWithPreviews()` (`asset-job.repository.ts:181`), requiring `visibility != Hidden`, `deletedAt IS NULL` and an existing `Preview` `asset_file`; `handleDetectFaces` gates again on `files.length === 1` and skips Hidden. On such assets the junk is deleted and **nothing is recovered**. | Cannot be repaired here. Count them in the preview and warn explicitly. Never claim repair for assets that cannot be re-detected.                                                                              |
| L12 | `getForDetectFacesJob`'s faces subquery has **no `deletedAt` filter** (`asset-job.repository.ts:246`), so a soft-deleted face still matches a fresh detection at IoU > 0.5, absorbs the embedding and stays soft-deleted — swallowing the real face and creating no visible one.                                                        | Delete outcomes **hard-delete** soft-deleted faces in scope, so re-detection can create a fresh visible face. `unassign` leaves them alone.                                                                    |
| L13 | A dissolve deleting faces underneath a running recognition pass races it.                                                                                                                                                                                                                                                               | Refuse with `ConflictException`, mirroring `face-repair.service.ts:572`.                                                                                                                                       |

**[shipped] L1 has a residue the row does not mention.** A `shared_space_person` that _survives_ the dissolve
(it still has other faces, so we correctly leave it alone) can nevertheless have pointed its
`representativeFaceId` at one of the faces we deleted. That FK is `ON DELETE SET NULL`, so the space person
is left alive with a null representative and drops out of `getSpacePersonsWithEmbeddings`, whose join on
`face_search` is an INNER JOIN. Nothing in the dissolve path repairs it. It self-heals only on the space
dedup job's next run, via `repairInvalidRepresentativeFaces` / `repairOrphanedRepresentativeFaces`
(`shared-space.service.ts:3223-3224`) — the same mechanism that already covers the force-detection reset.
Accepted rather than fixed here: repairing it inline would mean picking a new representative face inside the
dissolve transaction, and the existing job already owns that decision.

## Implementation — TDD

Every slice is red first. No production line is written before a test that fails for the right reason, and
each slice states the failure it must produce before the fix. Assertions must be able to fail: no `queryBy`
that passes whether or not the element exists.

**Slice 1 — scope predicate.** Unit-test the `scope` → Kysely predicate mapping in isolation, including pet
exclusion (L6) and the soft-deleted/invisible decisions below. Red: predicate does not exist.

**Slice 2 — `clearFacesRecognizedAt` repository method.** Medium test proving that after the call,
`streamForDetectFacesJob(false)` yields exactly the affected assets. Red: method does not exist.

**Slice 3 — the ordering constraint.** Medium test that runs the dissolve and asserts affected assets are
re-detectable. Deliberately implement the delete first to watch it fail, then reorder. This is the test that
proves the feature works at all.

**Slice 4 — cascade coverage.** Medium test asserting the six cascades fire and the three `SET NULL` columns
null out.

**Slice 5 — blast radius (L1–L13).** The isolation fixture below. Red before any scoping is applied.

**Slice 6 — outcomes and follow-up jobs.** Unit tests for outcome branching, `expectedFaceCount` 409, pet
rejection, empty-thumbnail skip, the active-recognition refusal (L13), and exactly which jobs are queued
(and that L1/L2/L5 are **not**).

**Slice 7 — preview endpoint.** Its own slice because for an irreversible operation the preview _is_ the
safety mechanism: counts by source × embedding, shared-asset count (L3), non-re-detectable count (L11), and
each of the four warnings. A wrong preview is as harmful as a wrong delete. Red: endpoint does not exist.

**Slice 8 — discovery endpoint.** Unit + medium for the aggregate and sort.

**Slice 9 — web modal.** Component tests for scope/outcome → preview payload, confirmation gating, and
warning rendering.

**Slice 10 — e2e.** One Playwright run dissolving an EXIF-contaminated person end to end.

Codegen and gates, per slice rather than deferred to the end:

- Touching `server/src/repositories/` means `mise sql` must be re-run — body edits drift the generated
  queries too, not just signatures.
- New endpoints mean `mise open-api` (not `make`), then the web SDK build.
- Server lint is `--max-warnings 0`, and `prettier --check` runs over `src/` **and** `test/` separately;
  eslint passing is not evidence prettier will.
- i18n changes touch all nine locales in the same commit, then `npx prettier --write i18n/*.json`.

## Test matrix

### The isolation fixture (`dissolve-blast-radius`)

One fixture, reused by every isolation test, built so that a missing `WHERE` clause cannot pass:

- **User A**, target person **P1** — 3 EXIF faces without embeddings, 2 ML faces with embeddings, 1 soft-deleted face.
- **User A**, unrelated person **P2** — 2 ML faces, one of them **on an asset it shares with P1**.
- **User A**, pet person **P3** — pet faces with `pet_search` rows and no `face_search` rows.
- **User A**, faceless person **P5** — proves no global cleanup is triggered (L2).
- **User B**, person **P4** — own assets, must be untouched (L8).
- A shared space over some of A's assets, with space persons projecting P1 **and** P2, plus a space person
  already orphaned before the run (L1).
- A `face_identity` shared by a P1 face and a P2 face, P2's carrying `source='manual'` (L4).
- Assets: one with only P1 faces; one with **P1 + P2** faces; one with only P2 faces.

### Medium (real DB) — where this feature is actually proven

Mocked repositories cannot see cascades or the re-detect gate, which are the whole design.

| Test                     | Asserts                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redetect-gate`          | After dissolve, `streamForDetectFacesJob(false)` yields **exactly** the dissolved assets — no more, no fewer.                                                                                                                                                       |
| `cascades`               | Matching `face_search`, `face_identity_face`, `face_person_verdict`, `face_repair_decline`, `pet_search`, `shared_space_person_face` rows removed.                                                                                                                  |
| `set-null`               | `person.faceAssetId`, `face_identity.representativeFaceId`, `shared_space_person.representativeFaceId` null out.                                                                                                                                                    |
| `sync-tombstones`        | `asset_face_audit` receives one row per deleted face, so mobile clients see the deletion.                                                                                                                                                                           |
| `isolation-P2`           | Every P2 face, its `face_identity_face` (incl. `source='manual'`), and its verdicts survive — **including on the shared asset**.                                                                                                                                    |
| `isolation-P3-pets`      | No pet face touched under any scope, `without-embedding` included (L6).                                                                                                                                                                                             |
| `isolation-P4-otheruser` | User B's faces, people and job status untouched (L8).                                                                                                                                                                                                               |
| `isolation-P5-cleanup`   | The unrelated faceless person still exists — no global cleanup ran (L2).                                                                                                                                                                                            |
| `isolation-space-orphan` | The pre-existing orphaned space person still exists; only space persons orphaned **by this dissolve** are removed (L1).                                                                                                                                             |
| `identity-not-gc`        | `face_identity` rows referenced elsewhere survive; no global identity GC ran (L5).                                                                                                                                                                                  |
| `shared-asset-redetect`  | After re-detection of a shared asset, P2 faces that still match at IoU > 0.5 keep their identity and gain a refreshed embedding (L3).                                                                                                                               |
| `rollback`               | A forced failure after the face delete leaves **every** row intact (L10) — **including `facesRecognizedAt`**: `dissolve()` passes `trx` into `clearFacesRecognizedAt`, and dropping that third argument silently moves the watermark clear outside the transaction. |
| `not-redetectable`       | A hidden asset, a trashed asset and one with no `Preview` file are counted by the preview and **excluded** from any repair claim (L11).                                                                                                                             |
| `soft-deleted-hard-gone` | A soft-deleted face in scope is hard-deleted by delete outcomes, so re-detection yields a fresh **visible** face rather than reviving a tombstone (L12).                                                                                                            |

### Edge cases

| Case                                                         | Expected                                                                                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person has zero faces                                        | 200, no-op, preview says nothing to do                                                                                                                                                  |
| `expectedFaceCount` drifted                                  | 409, **nothing** modified (assert row counts unchanged)                                                                                                                                 |
| Person not found / wrong id                                  | 404                                                                                                                                                                                     |
| Person is a pet (`type='pet'`)                               | 400 — pet re-detection is a separate pipeline; `facesRecognizedAt` would not repair it                                                                                                  |
| Empty `thumbnailPath` on person delete                       | No `FileDelete` queued (L7)                                                                                                                                                             |
| Soft-deleted faces (`deletedAt` not null)                    | **Hard-deleted** by delete outcomes — required, not tidiness (L12); left alone by `unassign`; excluded from displayed counts                                                            |
| `isVisible = false` faces                                    | Same as soft-deleted                                                                                                                                                                    |
| Facial recognition queue active                              | 409 `ConflictException`, mirroring `face-repair.service.ts:572` (L13)                                                                                                                   |
| Every affected asset hidden / trashed / no preview           | 200, but the preview states nothing will be recovered (L11)                                                                                                                             |
| `scope: 'without-embedding'` where all faces have embeddings | 200, zero affected                                                                                                                                                                      |
| Admin dissolving another user's person                       | Allowed (the console is cross-user by design); only that person's faces change                                                                                                          |
| `scope: 'exif'` on a person with only ML faces               | 200, zero affected, preview says so                                                                                                                                                     |
| `redetect: false` with a delete outcome                      | 400 — never a silent override                                                                                                                                                           |
| Non-admin caller                                             | 403                                                                                                                                                                                     |
| Hand-drawn face (`createdBy` set) in scope, delete outcome  | **Kept and unassigned**, never deleted; counted as `handDrawn` and warned about (`hand-drawn-kept`) — §3                                                                                |
| Concurrent dissolve of the same person                       | Second gets 409 via `expectedFaceCount` — **best-effort**: the guard is a read compared outside the write transaction, so two applies landing inside that gap can both pass it (see §3) |

### Unit / web / e2e

Unit: scope→predicate, outcome branching, the 409 guard, pet rejection, and exactly which jobs are and are
not queued. Web: modal scope/outcome → preview payload, confirmation gating, warning rendering. E2E: one
Playwright run dissolving an EXIF-contaminated person.

## Risks

1. **The feature rests on `.$if(force === false, …)`.** The `facesRecognizedAt` filter applies only when
   `force` is explicitly `false`; `undefined` skips it and re-detects the whole library. Pin the exact caller
   the console triggers and cover it in `redetect-gate`.
2. **L3 is a real, accepted data-loss path.** Re-detecting a shared asset can remove another person's ML face
   if the detector no longer finds it. Accepted because the alternative is skipping repair on exactly the
   photos that need it; mitigated by surfacing the shared-asset count.
3. ~~**`redetect` on an ML-scope dissolve discards good embeddings** to re-derive them.~~ **[revision 2]**
   Detected faces are no longer re-scanned.
4. **The discovery aggregate is library-wide.** The people page has been bitten by PG JIT before; measure on
   the personal clone rather than assume.
5. **[revision 2] Hiding real faces.** A junk person can hold a few real faces; they are hidden with it. Mitigated
   by restore and by the dialog pointing at per-face moves first.

## Rollout

Ship behind the existing admin gate; no feature flag. Validate on a personal clone against a real library
before release, since the reported symptom only exists at scale.
