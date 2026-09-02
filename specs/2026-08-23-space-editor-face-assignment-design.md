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
- no _endpoint_ that creates a space person — `SharedSpaceRepository.createPerson`
  (`shared-space.repository.ts:2236`) and the race-safe `createOrGetPersonForIdentity` (`:2245`)
  both exist, but are reachable only from the backfill/ML pipeline,
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
- Assets in no space the viewer edits — see §5.2. (An earlier draft scoped this to the `/spaces/:id/…`
  route; the shipped boundary is asset reachability, not the URL.)
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

### 5.2 Every write names its space explicitly; the affordance follows the asset

Every write needs a `spaceId`, and `findSpaceForAssetAndUser` (`asset.service.ts:145`) picks _one_
space arbitrarily when an asset sits in several — fine for resolving a display name, not fine for
deciding which taxonomy a write lands in.

Therefore `spaceId` is a **path parameter on every endpoint**. No endpoint can be called without an
explicit space, and the server never guesses which taxonomy a write lands in.

**The client-side affordance is asset-scoped, not route-scoped.** An earlier draft of this section
said the affordances render only under `/spaces/:id/…`. That is not what ships, and the difference was
found by a Playwright test rather than by reading the code.

`AssetService.get` auto-detects a space for any single-asset read that carries no explicit `spaceId`
(`asset.service.ts:145-154`) and sets `resolvedSpaceId`. The web layer derives its capability from
that (`canEditSpacePeople` in `asset-editability.ts`), so the affordance appears **wherever a photo is
reachable through a space you edit** — the main timeline and albums included — and is absent only when
the asset belongs to no such space.

**Decision (2026-08-23): accept the asset-scoped behaviour.** It matches how #992's `canEdit` already
behaves for asset edits, so the People row and the rest of the detail panel agree with each other
rather than following different rules on the same screen. Route-scoping would also be the odd one out:
nothing else in the viewer changes what it offers based on which URL you arrived by.

What this does **not** loosen: the space a write lands in is still whichever space the server resolved,
named explicitly in the request path, and every server-side gate in §3 applies unchanged. The
multi-space ambiguity §5.2 originally worried about is handled by the server picking one space and the
client naming it — not by hiding the affordance.

The genuine negative boundary is therefore "the asset is in no space this user edits", not "the URL is
not a space URL" — which is what F-28 now asserts.

---

## 6. Architecture — server

All five endpoints live on the fork-only `SharedSpaceController`. The route decorator carries the
**API-key scope**, matching its siblings — `Permission.SharedSpaceRead` on the read (§6.1, like
`GET :id/people/:personId/faces` at `shared-space.controller.ts:406`) and
`Permission.SharedSpaceUpdate` on the four writes (like the suggestion confirm at `:472`). That
decorator is _not_ the RBAC gate: the real authority is enforced in the service via §3, which is why
§6.1 can be `SharedSpaceRead`-scoped and still be Editor-only.

**`server/src/utils/access.ts` is not touched, and neither are `person.controller.ts` /
`face.controller.ts`.** That is the point of Approach A: zero delta in upstream-hot files.

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

Reuses the existing `SharedSpaceRepository.createPerson` (`shared-space.repository.ts:2236`) — no new
repository method.

**The `(spaceId, identityId)` unique index is the trap here.**
`shared_space_person_spaceId_identityId_key` forbids two people in one space carrying the same
identity. If the chosen face already has an identity, and that identity already has a space person in
this space, a plain `createPerson` violates the index. `createOrGetPersonForIdentity` (`:2245`) exists
precisely for this race and must be used whenever the seed face already carries an identity —
returning the existing person rather than failing (F-33).

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

#### 6.3.2 The transaction needs an explicit row lock

Idempotence above covers a repeated attach to the **same** space person. It does **not** cover two
editors attaching the same face to **different** space people at once: `shared_space_person_face`'s
primary key is `(personId, assetFaceId)`, not unique on `assetFaceId` alone, so both inserts succeed
and the face ends up claimed twice in one space.

Nothing at the schema level prevents this. The transaction therefore takes
`SELECT ... FOR UPDATE` on the `asset_face` row **first**, before any read it will act on
(`FacePersonVerdictRepository.lockFaceForAssignment`). F-37 is a genuine race, not a formality — it
fails without the lock.

**Every repository method called from inside this transaction must take a trailing `db`/`trx`
parameter and use it.** `markRejectedForSpacePerson`, `markIgnoredForSpacePerson` and
`recordSpacePersonVerdict` did not when this work started — they always used `this.db`, which was
harmless only because nothing had ever called them from inside a transaction. Calling one from within
the attach transaction deadlocks until timeout: the transaction holds a connection while the
non-transactional insert waits for a second one the pool will not release. All three now take the
parameter. Check the signature before calling anything new from inside a transaction.

**Reassign is this endpoint**, not a sixth one: attaching a face already held by another space person
in the same space moves it. The transaction must additionally remove the old
`shared_space_person_face` row and write a **negative verdict** for the old person
(`clearNegativeForTarget`'s counterpart), or the ML pipeline re-suggests the face straight back
(F-13). Removing the old row must go through the same recount as adding it — see §6.4.

#### 6.3.1 When the face already belongs to one of the owner's own people

This is the case the suggestion path never has to handle, and the one most able to damage Bob.

`person.identityId` is unique per `(ownerId, identityId)` (`person.table.ts:35`), and
`replaceFaceIdentity` rewrites the face's identity unconditionally. So attaching a face that Bob has
already named — `asset_face.personId` is set, and Bob's person carries identity X — moves that face
onto the space person's identity Y. Bob's `asset_face.personId` still says "Dad", but the identity
layer now disagrees with the person layer for that face, and `applyResolvedPersonMetadata`
(`asset.service.ts:180`) resolves Bob's _own_ view of names and birthdays through exactly that
identity.

> **REVISED 2026-08-25 — the insulated model below was dropped.** The original decision kept a space
> editor's face edits inside `shared_space_person_face` and never touched `asset_face.personId`. In
> practice that produced a surface users read as simply broken: the asset-detail People row is seeded
> from `asset_face.personId`, so an editor's assignment never appeared there, and — worse — an
> editor's _detach_ never removed anyone, because the space-person lookup
> (`findSpacePersonsByLinkedPersonIds`) is not scoped to the asset and keeps resolving a person who
> is attached anywhere else in the space. That state could not converge on reload.
>
> **Current decision: a space-editor face edit propagates into the owner's layer.** Attach writes the
> face's identity AND `asset_face.personId`, creating a `person` for the asset owner when they have
> never named that human themselves (so an editor naming a face can add a person to the owner's
> People page). Detach clears `asset_face.personId` — but only when the owner's person carries the
> _same_ identity as the space person being detached, so an editor removing "Uncle Tom" can never
> null out the owner's unrelated "Dad" tag on that face.
>
> Both owner-side layers move together deliberately: propagating `personId` while pinning the
> identity would leave the owner's own person row and `face_identity_face` disagreeing about one
> face, which is the inconsistency the original text below was written to avoid.
>
> Consequence: the privacy guarantee in the paragraph below no longer holds — an editor CAN alter
> face tags on the owner's own copy of a photo shared into the space. That is intended. Scope is
> still bounded to assets actually shared into the space; an editor cannot reach anything else.
> F-36 now asserts the propagation rather than the insulation.

**Superseded decision (kept for context): the attach is allowed — an editor may override the owner's
naming _within the space_ — but it must not rewrite the identity.**

The two goals look opposed and are not, because **space people are read through the direct projection,
not the identity layer**: every space-person read joins `shared_space_person_face`
(`shared-space.repository.ts:1791`, `:2016`, `:2122`, `:2153`). So writing the projection alone is
sufficient for the space to show the face under "Uncle Tom", and skipping `replaceFaceIdentity` leaves
Bob's `person`, his `asset_face.personId`, and everything `applyResolvedPersonMetadata` resolves for
him exactly as they were. The space and the owner simply hold different opinions about the same face,
which is the honest model — a shared space is not entitled to relabel someone's private library, and
the owner is not entitled to dictate the space's.

Three sub-cases, all pinned (F-34 … F-36):

| Face state                                                          | Identity write | Space projection | Result                           |
| ------------------------------------------------------------------- | -------------- | ---------------- | -------------------------------- |
| `personId IS NULL` (unrecognised)                                   | yes            | yes              | ordinary path                    |
| `personId` set, owner person identity **equals** the space person's | no-op          | yes              | already the same human           |
| `personId` set, owner person identity **differs** or is null        | **skipped**    | yes              | override, owner's view untouched |

Row 3 is the one this section exists for. Because the identity link is skipped, the ML suggestion
pipeline would otherwise re-offer the face — so row 3 **must** also write the negative verdict that
§6.3's reassign path writes, or the suggestion comes straight back (F-36).

`linkFaceToSpacePerson` therefore takes a `writeIdentity: boolean`. The suggestion-confirm caller
always passes `true` (it only ever handles unassigned faces); the direct-attach caller passes `false`
for row 3. This is the one behavioural difference between the two callers of the shared helper, and it
is the thing a future refactor is most likely to flatten — hence F-36 asserts the _absence_ of an
identity rewrite, not merely a 200.

### 6.4 `DELETE /shared-spaces/:id/people/:personId/faces/:assetFaceId`

Detach. Removes the `shared_space_person_face` row and writes a negative verdict so the suggestion
pipeline does not immediately re-offer it.

**Does not** delete `face_identity_face`. Detaching from _this_ space's person must not blank the
face's global identity and thereby mutate space B (§5.1). New repository method
`removePersonFace(personId, assetFaceId)` — the existing removals are bulk-by-asset and
bulk-by-library only.

**It must call `recountPersons`.** `addPersonFaces` recounts on the way in
(`shared-space.repository.ts:2660`), so a detach that does not recount leaves
`shared_space_person.faceCount` / `assetCount` overstated — and those columns are not cosmetic: the
people-list ordering index sorts unnamed people by `assetCount`
(`shared_space_person_space_name_idx`) and `minimumFaceCount` filters read them (`:1688`, `:1783`).
Drift here silently reorders and hides people. Pinned by F-32.

### 6.5 `POST /shared-spaces/:id/assets/:assetId/faces`

Draw a box. Body `{ x, y, width, height, spacePersonId }`.

Must reuse `PersonService.createFace`'s **edit-aware coordinate transform**
(`person.service.ts:1519-1532`): coordinates arrive in the edited-preview space and are converted to
the original image's space using `asset.edits`. This is not optional here — #992 lets editors rotate a
member's asset, so an editor drawing on a rotated preview is a _likely_ path, not an exotic one
(F-16). Reject with 400 when dimensions are unavailable, same as the owner path.

The created `asset_face` gets `personId = NULL` (never the owner's person) and is attached to the
space person through §6.3's helper.

### 6.6 Editor-drawn boxes are deletable by the editor

An editor who draws a box must be able to remove it, or a misplaced rectangle is permanent for
everyone. `FaceDelete` stays owner-only for **detected** faces; a face created under §6.5 may be
deleted by an Owner/Editor of the space it was drawn in (F-18), while a detected face stays refused
(F-19).

**Decision: add `asset_face.createdBy` (nullable uuid, FK to `user`, `ON DELETE SET NULL`).** Written
only by §6.5; `NULL` for every existing row and for every face the detector produces. A face is
deletable under this section iff `createdBy IS NOT NULL` **and** it is reachable in a space where the
actor is Owner/Editor.

This needs a fork migration in `server/src/schema/migrations-gallery/` with a round timestamp, per
CLAUDE.md.

**Why not the two cheaper-looking routes**, both of which are wrong:

- Gating on `sourceType === Manual` would let a space editor delete boxes **the owner drew by hand**.
  `SourceType` has exactly three values — `machine-learning`, `exif`, `manual` (`enum.ts:462`) — and
  `PersonService.createFace` already writes `Manual` for owner-drawn boxes (`person.service.ts:1567`).
  That is a permission regression, and exactly the class #992's §2.3 was written to catch.
- Adding `SourceType.SpaceEditor` would force an audit of every live `sourceType` branch
  (`person.service.ts:876`, `:1094`, `:1193`) and risks the fork's recognition jobs mis-treating the
  new value. A nullable column is inert for every existing consumer; a new enum value is not.

`createdBy` also gives §6.7 the actor it wants for free, and answers "who drew this" as data rather
than encoding it in a type.

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
prop rather than widening `isOwner`, exactly as #734 did for `DetailPanelTags`' `canEdit`:

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

#### 7.2.1 One picker, two sources (added 2026-09-01)

Field testing of pr-992-rc.5 read the owner/space split as a defect, and the report was fair. Because
`canEditSpacePeople` is narrowed to `!isOwner` (§7.1), the picker you get on one photo in one space
turns on whether you OWN it: the editor got `SpacePersonSidePanel`'s short, named, alphabetical,
searchable list, while the owner got upstream's `AssignFaceSidePanel` — the whole library including
every unnamed cluster, ordered by resemblance, with the search behind a magnifier icon. On a real
library that reads as "an unstructured list of unlabeled faces instead of the named people list".

**Decision: unify the presentation, not the taxonomy.** `PersonPickerPanel.svelte` now owns the panel
chrome, the search field, the candidate ordering and the grid for both; `AssignFaceSidePanel` and
`SpacePersonSidePanel` supply only where candidates come from and what a click writes.
`orderPickerCandidates` (a stable partition, named people first) is what actually answers the report —
it is a no-op on the space list, which `getPersonsBySpaceId` already serves named-first, and it keeps
the owner list's `closestAssetId` resemblance order inside each group.

**Follow-up (2026-09-02): the ordering was only half of it.** Field testing of pr-992-rc.7 narrowed
the remaining complaint precisely: the picker looked right when opened on an already-named face and
wrong when opened on an unassigned one, on the SAME photo. That rules out anything role- or
space-shaped — the only input that differs between those two opens is `closestAssetId`, which feeds
the resemblance ordering. Ordering plus `LIMIT` is membership: `GET /people` serves one 500-row page,
`getAllForUser` sorted that page by resemblance ALONE on its `closestFaceAssetId` branch, and on a
library past 500 people (unnamed clusters dominate the count) the named people were simply cut from
the page — a different set of them for each face. No client-side re-ordering can recover a row the
response never contained, which is why the first fix improved the screen without curing it.
`getAllForUser` now applies the same named-first key its no-`closestFaceAssetId` branch always had,
ahead of the limit, with resemblance ordering within each group and `person.id` as a total-order
tiebreak for paging. Pinned by a medium test that gives the cluster the perfect embedding match and
`take: 1`, so the named person can only survive if the name outranks resemblance.

**What was deliberately NOT done: merging the two candidate lists.** They are different tables reached
through different endpoints (`person`/`reassignFacesById` vs `shared_space_person`/§6.3), so a merged
grid would hold two id namespaces and dispatch each click to a different endpoint, directly on top of
the §5.1/§6.3.1 propagation rules. The live consequence of leaving them separate: a space person named
only on ANOTHER member's assets has no owner-layer `person` for this owner, so the owner's picker
cannot reach them and "create person" makes a second identity. That is the residual duplicate-person
hole, and closing it is a change to this section's model, not to its presentation.

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

| #    | Given                                                                                | When                          | Then                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-13 | face held by space person P1 in A                                                    | Anna attaches to P2 in A      | moved; P1 row removed; negative verdict for P1 (§6.3)                                                                                                                     |
| F-14 | face already attached to P                                                           | Anna attaches to P again      | `{ acted: false }`, no duplicate row                                                                                                                                      |
| F-15 | no space person yet                                                                  | Anna creates one from a face  | person + attachment in one transaction (§6.2)                                                                                                                             |
| F-16 | Bob's asset carries a **rotate** edit from #992                                      | Anna draws a box              | stored in original-image coordinates (§6.5)                                                                                                                               |
| F-17 | asset lacks `exifImageWidth`/`Height`, has edits                                     | Anna draws a box              | 400, message matches the owner path                                                                                                                                       |
| F-18 | Anna drew the box in F-16                                                            | Anna deletes it               | 204 — editor-drawn only (§6.6)                                                                                                                                            |
| F-19 | a **detected** face                                                                  | Anna deletes it               | 400 — `FaceDelete` still owner-only                                                                                                                                       |
| F-32 | face attached to P, `faceCount`/`assetCount` at n                                    | Anna detaches                 | counts recount to n−1 (§6.4)                                                                                                                                              |
| F-33 | seed face's identity already has a person in A                                       | Anna creates a person from it | returns the existing person; no unique-index violation (§6.2)                                                                                                             |
| F-34 | face has `personId IS NULL`                                                          | Anna attaches                 | granted; identity written (§6.3.1 row 1)                                                                                                                                  |
| F-35 | face's owner person carries the **same** identity                                    | Anna attaches                 | granted; identity unchanged (§6.3.1 row 2)                                                                                                                                |
| F-36 | face's owner person carries a **different** identity                                 | Anna attaches                 | granted; space shows the new name; `face_identity_face` **unchanged**; negative verdict written (§6.3.1 row 3)                                                            |
| F-40 | the override in F-36                                                                 | Bob re-reads his own asset    | his `person`, `asset_face.personId` and resolved name/birthday all unchanged — the override is space-local                                                                |
| F-37 | Anna and a second editor attach the same face to different space people concurrently | both submit                   | one wins; the loser is a no-op or a clean 400 — never two `shared_space_person_face` rows, never a lost recount. Enforced by the §6.3.2 row lock, **not** by a constraint |
| F-38 | face listed by §6.1, then its asset leaves the space                                 | Anna attaches the stale id    | 400 — `isFaceReachableInSpace` re-checked at write time, not trusted from the read                                                                                        |

### 8.4 Cross-space propagation — the §5.1 contract (server)

| #    | Given                                                                     | When                   | Then                                                                               |
| ---- | ------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| F-20 | B has a person sharing the identity Anna attaches to                      | Anna attaches in A     | the face appears for B's person too — **documented, pinned**                       |
| F-21 | the same, B's person is named differently                                 | Anna attaches in A     | B's `shared_space_person.name` unchanged                                           |
| F-22 | Anna detaches in A                                                        | —                      | `face_identity_face` untouched; B unaffected (§6.4)                                |
| F-23 | Bob views the asset in his own timeline, no space context                 | after F-1              | `asset_face.personId` unchanged; his People page unchanged                         |
| F-39 | Bob's own person carries identity X; Anna attaches an unrelated face in A | Bob re-reads the asset | the name and birthday `applyResolvedPersonMetadata` resolves for Bob are unchanged |

F-20, F-23 and F-39 are what make the isolation claim falsifiable. Without them the design's central
safety argument is untested. F-39 is the strict one: F-23 only pins the `asset_face.personId` column,
but Bob's own view of names and ages resolves through `face_identity`
(`asset.service.ts:180` → `getResolvedPersonByIdentityId`), so a column-only assertion would pass
while Bob's People page changed underneath him.

### 8.5 Attribution (server)

| #    | Given                    | When        | Then                                          |
| ---- | ------------------------ | ----------- | --------------------------------------------- |
| F-24 | Anna, Bob's asset in A   | attach      | one `person_face_assign` row, `userId` = Anna |
| F-25 | Anna                     | detach      | one `person_face_detach` row                  |
| F-26 | **Bob** on his own asset | attach in A | no activity row — owner self-action           |

### 8.6 Web

| #    | Given                                                                               | When               | Then                                                                                          |
| ---- | ----------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| F-27 | Anna on `/spaces/A/...`, Bob's photo                                                | opens detail panel | tag/edit people affordances visible                                                           |
| F-28 | Anna views Bob's photo that is in **no space she edits** (reached by partner share) | opens detail panel | People row read-only — the real negative boundary is asset reachability, not the route (§5.2) |
| F-29 | **Vic** on `/spaces/A/...`                                                          | opens detail panel | read-only                                                                                     |
| F-30 | Bob on his own photo anywhere                                                       | opens detail panel | unchanged owner affordances, owner people                                                     |
| F-31 | Anna, §6.1 request fails                                                            | opens the panel    | error state, no affordance guessed (§7.3)                                                     |

---

## 9. TDD plan

Every slice is **red → green → refactor**: the listed spec is written and observed failing before the
implementation lands.

**Ordering principle: the attach path lands first.** Almost every scenario in §8 is phrased "Anna
attaches", so authority and reachability cannot be proved before an attach exists to exercise them.
The read endpoint (§6.1) depends on the same hidden-person predicate the write uses, so it follows
rather than leads. An earlier draft of this section had it the other way round; its Slice 1 could
never have gone green.

Each slice below leaves the tree green and ships something exercisable.

### 9.1 Slice 1 — attach, and the authority that guards it

The foundation: `PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId` (§6.3), gated by
`requireRole(Editor)` → `requireSpacePersonInSpace` → `isFaceReachableInSpace`, plus the
hidden-person exclusion as a **shared predicate** (Slice 3 reuses it for the read).

At this slice the transaction may call the existing confirm steps inline; the extraction is Slice 2's
job and must not be anticipated here.

**Tests first.** New `server/test/medium/specs/shared-space-face-assign.medium.spec.ts`.

Medium-only by necessity, for the same reason #992's Slice 1 was: `isFaceReachableInSpace` is a
three-branch path query with correlated visibility gates. Unit mocks prove nothing about it.

Table-driven over **F-1 … F-7** (authority), **F-9 … F-11** (reachability and the hidden-person
exclusion at the write) and **F-14** (idempotence). Each deny row must be **mutation-proved
non-vacuous** — flip the single property under test (role, membership, visibility, `isVisible`) and
observe it turn to grant. #992 established this discipline; a deny that passes for the wrong reason is
worse than no test.

**F-6 is the row to write first.** It is the one place this spec deliberately diverges from #992's
rule, and the failure mode is a reviewer "fixing" it into an owner-is-member check.

**F-9 is the hidden-person exclusion at the write**, and is the half that closes the hole: without it
an editor can attach a face they cannot see by guessing its id. Its read-side twin is F-8 in Slice 3;
§6.1 claims the exclusion is pinned at both ends, and this is the first end.

Working software at the end of this slice: an editor can attach an existing space person to a face.

### 9.2 Slice 2 — the shared helper, and the owner-named override

Tests: **F-13** (reassign between space people), **F-34 … F-36** (the three §6.3.1 rows) and **F-40**
(the override is space-local) in `shared-space.service.spec.ts`, plus a regression run of the existing
`confirmSpacePersonFaceSuggestion` specs. **F-37** (concurrent attach) belongs here too and is
medium-only — it needs two real transactions racing, which a mocked repository cannot express.

Write **F-36 first**, and assert the **absence** of an identity rewrite, not merely a 200. The
natural implementation — call `replaceFaceIdentity` unconditionally, as the suggestion path does —
returns 200 and passes every other scenario in this slice while silently re-pointing an identity the
owner's person depends on. A status-only assertion cannot see that. F-40 is its companion: it checks
the same event from Bob's side.

Then extract `linkFaceToSpacePerson(trx, person, assetFaceId, { writeIdentity })` (§6.3, §6.3.1) and
re-point the suggestion confirm at it, passing `writeIdentity: true`. The existing suggestion tests
passing unchanged _is_ the refactor's proof; if they need editing, the extraction changed behaviour
and is wrong.

### 9.3 Slice 3 — the space-scoped face read

`GET /shared-spaces/:id/assets/:assetId/faces` (§6.1), reusing Slice 1's hidden-person predicate and
adding the asset-level reachability check.

Tests: **F-8** (owner-hidden person's faces absent) and **F-12** (space-hidden person's faces absent).

F-8 is F-9's twin. Write it by asserting on a face the fixture proves _is_ present when the owner
un-hides the person — otherwise "absent" is indistinguishable from "the fixture never created it",
which is the vacuous-pass shape #992's Slice 1 comment warns about.

Working software: the client can list the faces on an asset and attach to them.

### 9.4 Slice 4 — create and detach

Tests: **F-15** (transactionality — assert no orphan person when the attach throws), **F-22**
(detach leaves `face_identity_face` untouched), **F-32** (recount on detach), **F-33** (the
`(spaceId, identityId)` unique index) and **F-38** (reachability re-checked at write time, not
trusted from §6.1's read).

Then §6.2 and §6.4, reusing `createPerson` / `createOrGetPersonForIdentity` and adding
`removePersonFace` to the repository.

F-32 is the one to write first: `addPersonFaces` recounts on the way in
(`shared-space.repository.ts:2660`), so a `removePersonFace` that forgets is invisible to every other
test in this slice and only shows up later as mis-ordered, silently-hidden people.

### 9.5 Slice 5 — cross-space propagation

Tests: **F-20, F-21, F-23, F-39** as medium tests. No implementation follows — this slice exists to
_pin existing behaviour_ before Slice 6 adds a second way to reach it. If F-20 fails, §5.1's premise
is wrong and the design needs revisiting before proceeding.

F-39 must assert the **resolved** name and birthday Bob sees, not the `person` row's columns. A
column-level assertion passes vacuously, because the whole point of §5.1 is that resolution happens
at read time through the identity.

### 9.6 Slice 6 — drawing boxes

Opens with the `asset_face.createdBy` migration (§6.6) in
`server/src/schema/migrations-gallery/`, with a round timestamp per CLAUDE.md, since F-18 cannot be
written without the column.

Tests: **F-16 … F-19**. F-16 first — the edit-aware coordinate transform is the subtle one, and #992
made rotated assets the common case rather than an exotic one.

**F-19 is the security half and must be written alongside F-18, not after it.** The two differ only
by whether `createdBy` is null, so an implementation that forgets the check passes F-18 and fails only
F-19. Assert on a genuinely detected face — one the fixture created through detection, not one with
`createdBy` nulled by hand — or the test proves less than it appears to.

Then §6.5 and §6.6.

### 9.7 Slice 7 — attribution

Tests: **F-24 … F-26**. Then §6.7, the enum members, the feed rendering, and the nine locales.

### 9.8 Slice 8 — web

Tests: **F-27 … F-31** as component specs on `DetailPanelPeople.spec.ts` and the new panels.

Per `feedback_web_test_assertions_that_cannot_fail`: assert **presence** with `getBy*` and absence
with `expect(queryBy...).toBeNull()` — a bare `queryBy` passes either way and would make F-28/F-29
(the read-only cases, i.e. the security half) vacuous.

Per `feedback_web_vitest_no_clearmocks`: this repo does not clear mocks between tests in a file;
reset SDK mocks explicitly or F-31's failure path leaks into neighbours.

### 9.9 Slice 9 — end-to-end journey

An `e2e/src/specs/server/api/` journey mirroring #992's: Anna opens Bob's photo in space A, names an
unrecognised face, corrects a wrong match, draws a box, sees both activity rows — and is refused when
she tries to rename Bob's _personal_ person or delete a detected face. The negative half is what
proves the line held.

Plus a Playwright spec for F-27/F-28 proving the affordance is visible on a space surface and absent
on the timeline, matching the precedent set by #992's own Playwright affordance spec
(`e2e/src/specs/web/spaces-editor-asset-viewer-affordances.e2e-spec.ts`) that gating claims get a real
browser. Cite the path, not a SHA — #992's branch is rebased routinely and any SHA here goes stale.

**OpenAPI regeneration happens once, here**, after every endpoint is final: `pnpm build` →
`pnpm sync:open-api` → `make open-api` (§10 trap 1).

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

## 11. Decisions taken, and follow-ups

### Settled 2026-08-23

1. **§6.6 — editor-drawn boxes.** Add `asset_face.createdBy`. Editors may delete boxes they drew;
   detected faces stay owner-only. Fork migration required.
2. **§6.3.1 — faces the owner already named.** An editor **may** override, and the override is
   space-local: the space projection is written, the identity link is not. Bob's own library and his
   resolved names and ages are untouched (F-36, F-40).

3. **§5.2 — where the affordance appears.** Asset-scoped, not route-scoped: it shows wherever a photo
   is reachable through a space the viewer edits, including the main timeline. The first draft said
   `/spaces/:id/…` only; the shipped behaviour differs because `AssetService.get` auto-resolves a space
   for any single-asset read. Accepted so the People row agrees with the rest of the detail panel,
   which already behaves this way for #992's `canEdit`. Pinned by F-28, whose negative case is now "in
   no space she edits" rather than "not on a space URL".

All three were open questions in the first draft; none should be reopened during implementation
without re-running the scenarios that pin them.

Item 3 is worth one caution for whoever reads this next: it was found by a **Playwright test failing**,
not by reading the code. The component tests passed throughout, because they set the props directly and
so never exercised how those props get derived. Route-versus-asset scoping is invisible below the
browser.

### Follow-ups

- Mobile parity (§4.3). The gating pattern already exists (`driftSpaceEditableProvider`,
  `SharedSpaceApiRepository.updateSpacePerson`); the asset-viewer people strip and a face editor do
  not.
- §6.1 returns every face on the asset with no limit. Bounded in practice by faces-per-photo, but
  worth a cap if group shots prove pathological.
- Bulk face assignment across a selection.
- #992's known gap: tag add/remove are still unattributed. Unrelated, but the same feed.
