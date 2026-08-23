# Space editors may assign faces and people on space members' assets (web)

Follow-up to #992 (`2026-08-14-space-editor-asset-permissions-design.md`), which widened
`AssetUpdate` so a space Owner/Editor may edit a member's asset. That work deliberately left the
People row owner-gated. This spec covers the people half.

Status: design. Cast, used throughout:

| Name      | Role                                                              |
| --------- | ----------------------------------------------------------------- |
| **Anna**  | Editor of space **A**                                             |
| **Bob**   | Member of space A, owner of the assets under test                 |
| **Carol** | Member of an album linked into A; **not** a space member          |
| **Vic**   | Viewer of space A                                                 |
| **Erin**  | Editor of a **second** space **B** that also contains Bob's asset |

Scenario ids (`F-n`) are **stable identifiers, not an ordering**. Cite by id; never renumber, or the
§9 slice mapping silently rots. They are namespaced `F-` so they never collide with #992's `S-`.

---

## 1. Problem

On a space surface, an Owner/Editor viewing a member's photo sees the People row rendered read-only:
no "tag people", no "edit people", no way to name an unrecognised face. #992 widened the asset-edit
permissions around it but left this untouched, because every person and face write resolves to pure
ownership:

| Permission                                       | Resolves to                   |
| ------------------------------------------------ | ----------------------------- |
| `PersonUpdate` / `PersonDelete` / `PersonMerge`  | `person.checkOwnerAccess`     |
| `PersonCreate` / `PersonReassign` / `FaceDelete` | `person.checkFaceOwnerAccess` |

`DetailPanel.svelte:246` therefore passes `DetailPanelPeople` the real `{isOwner}` while its siblings
get `isOwner={canEdit}`. That is correct today: widening those permissions would let an editor write
into **another member's private people library**, which is not what anyone wants.

The right door is a different one, and it already exists.

---

## 2. What already exists

Gallery has a space-scoped people model that is fully isolated from each member's personal one:

| Table                      | Meaning                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `shared_space_person`      | the space's own people (`spaceId`, `name`, `isHidden`, `identityId`)     |
| `shared_space_person_face` | space-local projection: which `asset_face` rows belong to a space person |
| `face_identity`            | cross-user identity                                                      |
| `face_identity_face`       | which `asset_face` belongs to which identity                             |

`SharedSpaceService.confirmSpacePersonFaceSuggestion` (`shared-space.service.ts:1388`) already
performs exactly the write this feature needs:

1. `requireRole(auth, spaceId, SharedSpaceRole.Editor)`
2. `faceIdentityRepository.ensureSpacePersonIdentity(person.id, trx)`
3. `faceIdentityRepository.replaceFaceIdentity({ assetFaceId, identityId, source: 'manual' }, trx)`
4. `facePersonVerdictRepository.resolveAssignedFace` + `clearNegativeForTarget`
5. `sharedSpaceRepository.addPersonFaces([{ personId, assetFaceId }], undefined, trx)`

all inside one `databaseRepository.transaction`, and it **never touches `asset_face.personId`** — the
owner's private taxonomy is untouched by construction.

**The gap is narrow.** That path is reachable only when the ML pipeline has produced a _pending
suggestion within a distance band_ for that space person (`hasPendingForSpacePerson`). There is:

- no direct "assign this face to this person" path,
- no `createSpacePerson` — space people are only born from the backfill/ML pipeline,
- no single-face detach (only bulk cleanup: `removePersonFacesByAssetIds` / `…ByLibrary`),
- no space-scoped way to read the face boxes on one asset,
- nothing in the asset viewer that surfaces any of it.

---

## 3. The authority rule

> An Owner/Editor of space S may assign, detach, create and draw faces **against S's own people**,
> for any face whose asset is reachable through S.

Two clauses, both already implemented as helpers:

- **Role** — `requireRole(auth, spaceId, SharedSpaceRole.Editor)` (`shared-space.service.ts:3487`;
  `ROLE_HIERARCHY` admits Owner too).
- **Reachability** — `facePersonVerdictRepository.isFaceReachableInSpace(spaceId, assetFaceId)`
  (`face-person-verdict.repository.ts:874`), which already enforces `asset_face.deletedAt IS NULL`,
  `asset_face.isVisible`, `asset.deletedAt IS NULL`, `asset.isOffline = false`,
  `reviewableAssetVisibility`, and the three space path branches.

**Deliberately _not_ the #992 rule.** #992's `checkSpaceEditAccess` additionally requires the asset
_owner_ to be a space member, because it grants write access over the owner's asset bytes and
metadata. Here nothing of the owner's is written — only the space's own taxonomy — so owner
membership is not the relevant authority. An editor may name Carol's face in the space's people even
though Carol never joined, exactly as the ML pipeline already does for her today.

**Consequence, stated plainly:** this is _not_ a subset of #992. A face on Carol's album-path asset is
assignable here (F-6) while her asset is not editable under #992 (S-4). Both are correct; they answer
different questions.

---

## 4. Scope

### 4.1 Granted to space Owner/Editor, on a space surface

1. Read the face boxes on an asset, space-scoped.
2. Attach an existing space person to a face; detach.
3. Create a new space person from a face ("add a name").
4. Reassign a face from one space person to another.
5. Draw a new face box manually.

### 4.2 Withheld

- Everything against the **owner's** `person` rows — rename, merge, delete, hide, birthday, set
  representative face. Unchanged, owner-only.
- `asset_face.personId` is never written by any path in this spec.
- Deleting a _detected_ face row (`DELETE /faces/:id`) stays owner-only (`FaceDelete` →
  `checkFaceOwnerAccess`). An editor may detach a face from a space person; they may not destroy the
  detection. Editor-drawn boxes are the one exception — see §6.6.
- Viewers get nothing (F-4).

### 4.3 Non-goals (YAGNI)

- Mobile. Deferred to a follow-up spec, matching how #992 handled it. Editors will see actions on web
  their phone does not offer.
- Any surface other than `/spaces/:id/…` — see §5.2.
- Merging space people from the asset viewer (`POST …/people/:personId/merge` already exists on the
  space person page).
- Bulk face assignment across a multi-asset selection.

---

## 5. Two constraints that shape everything

### 5.1 A face has exactly one identity, globally

`face_identity_face`'s primary key is `assetFaceId` **alone**, and `replaceFaceIdentity` upserts with
`onConflict('assetFaceId').doUpdateSet(...)` (`face-identity.repository.ts:2438`). One identity per
face, across all spaces and all users.

So attaching a face in space A **rewrites that face's global identity**. If space B has a person
carrying the same `identityId`, B's view of that person changes too. Anna's edit is visible to Erin.

This is pre-existing — `confirmSpacePersonFaceSuggestion` has the same property — but a direct-assign
path makes it trivially reachable where before it needed an ML suggestion to line up. It must be
tested (F-20, F-21), not discovered.

**Decision: accept the propagation, do not partition identities per space.** Partitioning would fork
`face_identity` per space, breaking the cross-user identity model that is the fork's whole answer to
cluster groups (see `project_cluster_groups_30739_quarantine`). The propagation is also _semantically
right_: identity means "this is the same human", which does not stop being true at a space boundary.

**What must not propagate is naming.** `shared_space_person.name` is per space, so B keeps its own
name for the shared identity. The design preserves this by never writing a name outside the acting
space (F-21).

### 5.2 Space surfaces only

Every write needs a `spaceId`, and `findSpaceForAssetAndUser` (`asset.service.ts:145`) picks _one_
space arbitrarily when an asset sits in several — fine for resolving a display name, not fine for
deciding which taxonomy a write lands in.

Therefore `spaceId` is a **path parameter on every endpoint**, and the web affordances render only
under `/spaces/:id/…`, where the route supplies it unambiguously. On the main timeline, albums and
search the People row stays read-only for non-owned assets. No disambiguation UI is needed, and no
endpoint can be called without an explicit space.

---

## 6. Architecture — server

All five endpoints live on the fork-only `SharedSpaceController`, guarded by
`@Authenticated({ permission: Permission.SharedSpaceUpdate })` (matching every sibling space-person
route) with the real authority enforced in the service via §3. **`server/src/utils/access.ts` is not
touched, and neither are `person.controller.ts` / `face.controller.ts`.** That is the point of
Approach A: zero delta in upstream-hot files.

### 6.1 `GET /shared-spaces/:id/assets/:assetId/faces`

Returns the face boxes on one asset, space-scoped.

Gate: `requireRole(Editor)` — this read exposes unnamed faces, so it is editor-only, not
member-visible. Then assert the _asset_ is reachable in the space (the asset-level twin of
`isFaceReachableInSpace`, reusing `spaceAssetPathBranches`).

Each row: `assetFaceId`, bounding box, `isEditorDrawn`, and the **space** person (`spacePersonId`,
`name`) if attached — never the owner's `person.name`.

**Filtering — three exclusions, all load-bearing:**

| Excluded                                                  | Why                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| faces whose owner `person.isHidden = true`                | §4 decision: preserve the owner's hide. Absent, indistinguishable from undetected |
| faces attached to a `shared_space_person` with `isHidden` | matches the existing read filter in `asset.service.ts:135`                        |
| `deletedAt IS NOT NULL` or `isVisible = false`            | consistent with `isFaceReachableInSpace`                                          |

The hidden-person exclusion is the one a refactor would silently relax, so it is pinned twice: once
here (F-8) and once at the write (F-9) — an editor must not be able to attach a face they cannot see
by guessing its id.

### 6.2 `POST /shared-spaces/:id/people`

Creates a `shared_space_person` in the space. Body: `{ name?, assetFaceId? }`.

When `assetFaceId` is present this is create-and-attach, and it must be **one transaction** — a crash
between the two leaves a nameless orphan person in the space's people list, which is exactly the
failure mode `confirmSpacePersonFaceSuggestion`'s Slice-5 comment records for the suggestion path.

New repository method `createPerson` on `SharedSpaceRepository`.

### 6.3 `PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId`

Attach. Gate: `requireRole(Editor)` → `requireSpacePersonInSpace(spaceId, personId)` →
`isFaceReachableInSpace(spaceId, assetFaceId)`.

Body is the same transaction as `confirmSpacePersonFaceSuggestion` steps 2–5, minus the
`hasPendingForSpacePerson` / `claimPendingForSpacePerson` gate. **Extract that transaction into one
private helper** (`linkFaceToSpacePerson(trx, person, assetFaceId)`) and have both the suggestion
confirm and this endpoint call it, so the two can never drift. This refactor is in scope — the whole
risk of a parallel path is two implementations of one rule.

Idempotent: `addPersonFaces` is `onConflict().doNothing()` and `replaceFaceIdentity` upserts, so a
double-submit is a no-op. Returns `{ acted: boolean }`, matching the sibling confirm/reject routes'
S11 convention (a 200-vs-204 signal is unreadable through `@oazapfts/runtime`'s `ok()`).

**Reassign is this endpoint**, not a sixth one: attaching a face already held by another space person
in the same space moves it. The transaction must additionally remove the old
`shared_space_person_face` row and write a **negative verdict** for the old person
(`clearNegativeForTarget`'s counterpart), or the ML pipeline re-suggests the face straight back
(F-13).

### 6.4 `DELETE /shared-spaces/:id/people/:personId/faces/:assetFaceId`

Detach. Removes the `shared_space_person_face` row and writes a negative verdict so the suggestion
pipeline does not immediately re-offer it.

**Does not** delete `face_identity_face`. Detaching from _this_ space's person must not blank the
face's global identity and thereby mutate space B (§5.1). New repository method
`removePersonFace(personId, assetFaceId)` — the existing removals are bulk-by-asset and
bulk-by-library only.

### 6.5 `POST /shared-spaces/:id/assets/:assetId/faces`

Draw a box. Body `{ x, y, width, height, spacePersonId }`.

Must reuse `PersonService.createFace`'s **edit-aware coordinate transform**
(`person.service.ts:1519-1532`): coordinates arrive in the edited-preview space and are converted to
the original image's space using `asset.edits`. This is not optional here — #992 lets editors rotate a
member's asset, so an editor drawing on a rotated preview is a _likely_ path, not an exotic one
(F-16). Reject with 400 when dimensions are unavailable, same as the owner path.

The created `asset_face` gets `personId = NULL` (never the owner's person) and is attached to the
space person through §6.3's helper. Mark it `sourceType = 'editor-drawn'` (or equivalent) so §6.6 can
distinguish it.

### 6.6 Editor-drawn boxes are deletable by the editor

An editor who draws a box must be able to remove it, or a misplaced rectangle is permanent for
everyone. `FaceDelete` stays owner-only for **detected** faces; a face created under §6.5 may be
deleted by an Owner/Editor of the space it was drawn in. This is the one place this spec creates an
`asset_face` row and therefore the one place it may destroy one (F-18).

### 6.7 Attribution

Two new `SharedSpaceActivityType` members, alongside the existing `PersonUpdate` / `PersonDelete` /
`PersonMerge`:

- `PersonFaceAssign = 'person_face_assign'`
- `PersonFaceDetach = 'person_face_detach'`

Data `{ personId, personName, count }`. Rendered by `space-activity-feed.svelte` under `MEDIUM_TYPES`
with new i18n keys in **all nine maintained locales** (`de fr it nl pl es ru zh_Hans zh_Hant`) — an
edited key is not enough, these are new (see CLAUDE.md i18n rules).

Owner self-action logs nothing, matching #992's `asset_edit` rule, which keeps the feed low-volume.

---

## 7. Architecture — web

### 7.1 Threading the capability

`DetailPanel.svelte:246` currently passes `DetailPanelPeople` the real `{isOwner}`. Add a sibling
prop rather than widening `isOwner`, exactly as §734 did for `DetailPanelTags`' `canEdit`:

```
<DetailPanelPeople {asset} {isOwner} canEditSpacePeople={...} {canFilter} {previousRoute} spaceId={effectiveSpaceId} />
```

`canEditSpacePeople` is true iff `spaceId` is present **and** the viewer is Owner/Editor of that
space **and** `!isOwner`. Keeping `isOwner` untouched matters: the owner path must continue to render
the owner's own affordances against the owner's own people, unchanged.

`DetailPanelPeople.svelte:141` and `:157` then render the tag/edit affordances under
`isOwner || canEditSpacePeople`, routing to the space components below when the latter wins.

### 7.2 Space-flavoured siblings of two components

The owner path uses `PersonSidePanel.svelte` (calls `reassignFacesById`, `createPerson`, `deleteFace`)
and `face-editor/FaceEditor.svelte` (calls `createFace`). Both are owner-shaped down to the SDK calls,
so this adds:

- `SpacePersonSidePanel.svelte` — lists §6.1's faces, attaches/detaches/creates via §6.2–6.4.
- `SpaceFaceEditor.svelte` — draws via §6.5.

Extract the shared presentation (crop rendering, drag geometry, the people search list) rather than
copying it; only the API calls and the gating differ.

### 7.3 Fallback

None. Unlike #992's `canEditAsset`, there is no client-side derivation to fall back to: the space role
is already known from the space route's data, and the face list only ever comes from the server. If
§6.1 fails the panel shows an error rather than guessing.

---

## 8. BDD scenarios

### 8.1 Authority (server)

| #   | Given                                                            | When                      | Then                                           |
| --- | ---------------------------------------------------------------- | ------------------------- | ---------------------------------------------- |
| F-1 | Bob's asset direct-added to A                                    | Anna attaches a face      | granted                                        |
| F-2 | Bob's asset via Bob's **linked library**                         | Anna attaches             | granted                                        |
| F-3 | Bob's asset via Bob's **linked album**                           | Anna attaches             | granted                                        |
| F-4 | Bob's asset in A                                                 | **Vic** (Viewer) attaches | 403 — `requireRole`                            |
| F-5 | Bob's asset in A                                                 | space **Owner** attaches  | granted — `ROLE_HIERARCHY` admits Owner        |
| F-6 | **Carol's** asset via the linked album, Carol not a space member | Anna attaches             | **granted** — §3, deliberately unlike #992 S-4 |
| F-7 | Anna is Editor of A; the face's asset is in **B** only           | Anna attaches via A       | 400 — `isFaceReachableInSpace` false           |

### 8.2 Visibility and reachability edges (server)

| #    | Given                                                   | When             | Then                                   |
| ---- | ------------------------------------------------------- | ---------------- | -------------------------------------- |
| F-8  | a face whose owner `person.isHidden = true`             | Anna lists faces | absent from the response (§6.1)        |
| F-9  | the same face, id guessed                               | Anna attaches    | 400 — write applies the same exclusion |
| F-10 | asset trashed (`deletedAt`) / offline / Hidden / Locked | Anna attaches    | 400 — `isFaceReachableInSpace`         |
| F-11 | `asset_face.isVisible = false` or `deletedAt` set       | Anna attaches    | 400                                    |
| F-12 | face attached to a space person with `isHidden`         | Anna lists faces | absent                                 |

### 8.3 Assignment semantics (server)

| #    | Given                                            | When                         | Then                                                  |
| ---- | ------------------------------------------------ | ---------------------------- | ----------------------------------------------------- |
| F-13 | face held by space person P1 in A                | Anna attaches to P2 in A     | moved; P1 row removed; negative verdict for P1 (§6.3) |
| F-14 | face already attached to P                       | Anna attaches to P again     | `{ acted: false }`, no duplicate row                  |
| F-15 | no space person yet                              | Anna creates one from a face | person + attachment in one transaction (§6.2)         |
| F-16 | Bob's asset carries a **rotate** edit from #992  | Anna draws a box             | stored in original-image coordinates (§6.5)           |
| F-17 | asset lacks `exifImageWidth`/`Height`, has edits | Anna draws a box             | 400, message matches the owner path                   |
| F-18 | Anna drew the box in F-16                        | Anna deletes it              | 204 — editor-drawn only (§6.6)                        |
| F-19 | a **detected** face                              | Anna deletes it              | 400 — `FaceDelete` still owner-only                   |

### 8.4 Cross-space propagation — the §5.1 contract (server)

| #    | Given                                                     | When               | Then                                                         |
| ---- | --------------------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| F-20 | B has a person sharing the identity Anna attaches to      | Anna attaches in A | the face appears for B's person too — **documented, pinned** |
| F-21 | the same, B's person is named differently                 | Anna attaches in A | B's `shared_space_person.name` unchanged                     |
| F-22 | Anna detaches in A                                        | —                  | `face_identity_face` untouched; B unaffected (§6.4)          |
| F-23 | Bob views the asset in his own timeline, no space context | after F-1          | `asset_face.personId` unchanged; his People page unchanged   |

F-20 and F-23 are the two that make the isolation claim falsifiable. Without them the design's central
safety argument is untested.

### 8.5 Attribution (server)

| #    | Given                    | When        | Then                                          |
| ---- | ------------------------ | ----------- | --------------------------------------------- |
| F-24 | Anna, Bob's asset in A   | attach      | one `person_face_assign` row, `userId` = Anna |
| F-25 | Anna                     | detach      | one `person_face_detach` row                  |
| F-26 | **Bob** on his own asset | attach in A | no activity row — owner self-action           |

### 8.6 Web

| #    | Given                                     | When               | Then                                      |
| ---- | ----------------------------------------- | ------------------ | ----------------------------------------- |
| F-27 | Anna on `/spaces/A/...`, Bob's photo      | opens detail panel | tag/edit people affordances visible       |
| F-28 | Anna on the **main timeline**, same photo | opens detail panel | People row read-only (§5.2)               |
| F-29 | **Vic** on `/spaces/A/...`                | opens detail panel | read-only                                 |
| F-30 | Bob on his own photo anywhere             | opens detail panel | unchanged owner affordances, owner people |
| F-31 | Anna, §6.1 request fails                  | opens the panel    | error state, no affordance guessed (§7.3) |

---

## 9. TDD plan

Every slice is **red → green → refactor**: the listed spec is written and observed failing before the
implementation lands. Slices are ordered so each is independently reviewable and leaves the tree
green.

### 9.1 Slice 1 — authority and reachability, against a real database

**Tests first.** New `server/test/medium/specs/shared-space-face-assign.medium.spec.ts`.

Medium-only by necessity, for the same reason #992's Slice 1 was: `isFaceReachableInSpace` is a
three-branch path query with correlated visibility gates. Unit mocks prove nothing about it.

Table-driven over **F-1 … F-12** — the whole of §8.1 and §8.2. Each deny row must be
**mutation-proved non-vacuous** — flip the single property under test (role, membership, visibility,
`isVisible`) and observe it turn to grant. #992 established this discipline; a deny that passes for
the wrong reason is worse than no test.

**F-6 is the row to write first.** It is the one place this spec deliberately diverges from #992's
rule, and the failure mode is a reviewer "fixing" it into an owner-is-member check.

**F-8 and F-9 are the pair that must not be separated.** §6.1 calls the hidden-person exclusion
load-bearing and claims it is pinned at both the read and the write; F-8 covers the read, F-9 the
write. Testing only F-8 leaves an editor able to attach a face they cannot see by guessing its id —
the exact hole the filter exists to close.

Then implement §6.1's filter and the service gates.

### 9.2 Slice 2 — the shared link helper

Tests: **F-13, F-14** in `shared-space.service.spec.ts`, plus a regression run of the existing
`confirmSpacePersonFaceSuggestion` specs.

Then extract `linkFaceToSpacePerson` (§6.3) and re-point the suggestion confirm at it. The existing
suggestion tests passing unchanged _is_ the refactor's proof; if they need editing, the extraction
changed behaviour and is wrong.

### 9.3 Slice 3 — create, attach, detach

Tests: **F-15** (transactionality — assert no orphan person when the attach throws), **F-22**.
Then §6.2 and §6.4, with `createPerson` / `removePersonFace` on the repository.

### 9.4 Slice 4 — cross-space propagation

Tests: **F-20, F-21, F-23** as medium tests. No implementation follows — this slice exists to _pin
existing behaviour_ before Slice 5 makes it easy to trigger. If F-20 fails, §5.1's premise is wrong
and the design needs revisiting before proceeding.

### 9.5 Slice 5 — drawing boxes

Tests: **F-16 … F-19**. F-16 first: the edit-aware transform is the subtle one, and #992 made rotated
assets the common case.

Then §6.5 and §6.6.

### 9.6 Slice 6 — attribution

Tests: **F-24 … F-26**. Then §6.7, the enum members, the feed rendering, and the nine locales.

### 9.7 Slice 7 — web

Tests: **F-27 … F-31** as component specs on `DetailPanelPeople.spec.ts` and the new panels.

Per `feedback_web_test_assertions_that_cannot_fail`: assert **presence** with `getBy*` and absence
with `expect(queryBy...).toBeNull()` — a bare `queryBy` passes either way and would make F-28/F-29
(the read-only cases, i.e. the security half) vacuous.

Per `feedback_web_vitest_no_clearmocks`: this repo does not clear mocks between tests in a file;
reset SDK mocks explicitly or F-31's failure path leaks into neighbours.

### 9.8 Slice 8 — end-to-end journey

An `e2e/src/specs/server/api/` journey mirroring #992's: Anna opens Bob's photo in space A, names an
unrecognised face, corrects a wrong match, draws a box, sees both activity rows — and is refused when
she tries to rename Bob's _personal_ person or delete a detected face. The negative half is what
proves the line held.

Plus a Playwright spec for F-27/F-28 proving the affordance is visible on a space surface and absent
on the timeline, matching `aaab4de2680`'s precedent that gating claims get a real browser.

---

## 10. Traps

1. **OpenAPI regeneration ordering.** Five new endpoints and new DTOs. Follow the CLAUDE.md sequence
   (`pnpm build` → `pnpm sync:open-api` → `make open-api`) once, at the end — not per slice. See
   `reference_rebase_generated_api_artifacts`.
2. **`@GenerateSql` regeneration.** New decorated repository methods change `server/src/queries/*.sql`.
   Never run `make sql` without a live database — it deletes every query file
   (`feedback_make_sql_no_db`).
3. **`tsc` green means nothing here.** The hidden-person filter, the negative verdicts and the
   cross-space contract are all invisible to the type checker. Slices 1 and 4 are the real gate.
4. **i18n is nine locales, not one**, and new keys must be inserted alphabetically then
   `npx prettier --write i18n/*.json`.
5. **Do not widen `access.ts`.** If a change starts needing a new arm in `checkOtherAccess`, the design
   has drifted toward Approach B and should stop.

---

## 11. Follow-ups

- Mobile parity (§4.3). The gating pattern already exists (`driftSpaceEditableProvider`,
  `SharedSpaceApiRepository.updateSpacePerson`); the asset-viewer people strip and a face editor do
  not.
- Bulk face assignment across a selection.
- #992's known gap: tag add/remove are still unattributed. Unrelated, but the same feed.
