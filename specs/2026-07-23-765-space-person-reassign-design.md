# Design — "Fix incorrect match" for space members (#765)

- **Issue:** [#765](https://github.com/open-noodle/gallery/issues/765) — _"Fix incorrect match" has no effect for a non-admin Editor in a Space; misassigned photos reappear immediately._
- **Branch:** `worktree-fix-765-space-editor-face-reassign`
- **Status:** Reviewed (4 adversarial codebase-verification passes folded in). One open question (Q1). Ready for writing-plans on confirmation.

---

## 1. Problem & root cause

A non-admin Editor opens a person in a Shared Space, selects a misassigned photo, uses **Fix incorrect match → Create new person / Reassign**, gets a **Success** toast — and the photo stays under the original person.

The Space-member view is reached through the fork's **scoped-person route** `/people/{id}`, which serves a space person via the _personal_ person page (it already has the "Fix incorrect match" button + `UnmergeFaceSelector`). For a non-owner member, `GET /api/people/{id}` returns (`person.service.ts:330` → `getAccessiblePersonByProfileId` → `mapAccessiblePerson`, `face-identity.repository.ts:2071-2092`):

```jsonc
{
  "id": "160b4f09…", // the shared_space_person id — NOT a global person.id
  "primaryProfile": { "type": "space-person", "id": "160b4f09…", "spaceId": "…" },
}
```

`UnmergeFaceSelector` builds the reassign payload with `personId = person.id`:

```
reassignFaces(newPersonId, { data: [{ assetId, personId: "160b4f09…" }] })
```

But `asset_face.personId` always holds the **global** person id. `getFacesByIds([{ personId: "160b4f09…", assetId }])` matches **zero rows** → nothing reassigned → `200` → the toast fires unconditionally (`UnmergeFaceSelector.svelte:73-74, 90-95` toast `count: assetIds.length`, never reading the response) → on refresh the photo is unchanged.

**Verified live (editor `b`):** `GET /people/160b4f09` returns `id:160b4f09` for the editor vs `id:01484ea7` (global) for the owner; the UI's exact call returns `200` with the target at **0 faces** and `asset_face.personId` unchanged; 3 "Create new person" clicks made 3 empty persons.

### Why the branch's backend-only fix does not close the bug

The branch correctly opened the _global_ `reassignFaces`/`reassignFacesById` to space editors + added projection refresh. But **the UI never sends a global id** for a space member; it sends the space-person id, so it's a zero-match no-op regardless. **#765 cannot be fixed without frontend + server-side id resolution.**

---

## 2. What has to change

For the `/people/{scopedId}` entry point (the reachable one — the button already exists there; no new `/spaces/people` UI needed):

| #      | Change                                                                                                                                                      | Layer    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **P1** | Resolve a **space-person source** → the real `asset_face`(s) for the selected assets, via `shared_space_person_face`                                        | Backend  |
| **P2** | Picker lists **space people** (`getAllPeople({ withSharedSpaces:true })`), and reassign/create for a space-person source routes to the new endpoint         | Frontend |
| **P3** | Resolve a **target** (own person, another member's space person, or "new") → the correct **owner-aligned, identity-linked** global person, create if absent | Backend  |

Create-new = P1 + P3; reassign-to-existing = P1 + P2 + P3.

---

## 3. Design decisions

### D1 — New / create-if-absent person is **owned by the asset's owner** ✅ (verified well-grounded)

When a face on admin's asset needs a fresh or newly-linked person, that global `person` is owned by the **asset's owner**, not the acting editor.

- **Grounding:** every codebase path that creates a person _to hold a face on an asset_ uses `ownerId: asset.ownerId` — `person.service.ts:1115` (the unattended `handleRecognizeFaces` job, `:1008-1146`), `pet-detection.service.ts:82-83`, `metadata.service.ts:1087`. The **only** actor-owned create (`person.service.ts:488-496`) makes an **empty** person with no face — not our case. No invariant blocks it: `personRepository.create` has no `ownerId` guard (`person.repository.ts:817-819`); the sole unique key is `(ownerId, identityId)` (`person.table.ts:34-39`). Owner-alignment also matches the fork's owner-scoped mobile sync (an editor-owned person carrying admin's face would be a cross-owner split).
- **Consequence:** creation moves server-side (into P3). A picked _existing own_ person is used as-is (owned by the editor, by their choice).

### D2 — A **dedicated fork endpoint**, delegating identity work to the shared identity service ✅

Add `POST /shared-spaces/:id/people/:personId/reassign` rather than overloading the upstream global endpoints.

- **Why:** keeps the change in **fork-only files** (`shared-space.*`), honoring "minimize upstream diff"; mirrors the established `mergeSpacePeople` pattern (client passes only space-person ids + `spaceId`, server resolves). RBAC pattern is the fork's own: controller `@Authenticated({ Permission.SharedSpaceUpdate })` (cf. `shared-space.controller.ts:434,507`) + service `requireRole(auth, spaceId, Editor)` (cf. `shared-space.service.ts:1256,1676`); viewers/non-members → `403` (`requireRole`/`requireMembership`, `:3041-3047/:3033-3039`).
- **Delegation (correction from review):** the identity-sensitive core (resolve target + reassign + relink + projection refresh, per face) lives in the shared **`IdentityMergePropagationService`** — it already holds `sharedSpaceRepository` + `jobRepository` (`base.service.ts:234-241`) and is reachable from both `PersonService` and `SharedSpaceService`, exactly like `mergeSpacePeople` delegates. `SharedSpaceService.reassignSpacePersonFaces` is the RBAC + source-resolution + delegation wrapper. (This is required because the existing refresh helper is `private` on `PersonService` and services don't inject each other — see §4.4.)

### D3 — **No cross-owner confirmation gate** ✅ (my earlier draft was wrong — removed)

An earlier draft added `confirmCrossOwner` mirroring merge. **Dropped.** A single-face reassign is a _re-point_, which the codebase's own policy leaves ungated: `merge-policy.ts:35-36` ("a re-point … is never gated — the recognition job does that unattended"), `person.service.ts:201-202`. The merge authorizer requires an `IdentityMergePropagationPlan` with `collapsedOwnerIds` that a reassign never computes, and the branch's existing editor `reassignFaces` already moves faces across owners with no such gate. Adding it would be over-engineering with no mechanism to wire it to.

---

## 4. Detailed design

### 4.1 Endpoint & DTO

```
POST /shared-spaces/:id/people/:personId/reassign
  @Authenticated({ permission: Permission.SharedSpaceUpdate })   // + service requireRole(Editor)
  :personId = the SOURCE shared_space_person

Body  SharedSpacePersonReassignDto:
  assetIds: string[]                      // selected photos whose face on :personId is misassigned
  target:
    | { type: "new" }                                     // create per asset owner (D1)
    | { type: "existing", profile: ScopedPersonProfileRefDto }   // reuse the fork's scoped ref

ScopedPersonProfileRefDto (existing, used by detach/merge — verified in src/dtos/person.dto.ts:59-64):
    { type: "person" | "space-person", id: string, spaceId?: string }
    NOTE: the global-person value is "person". Do not confuse it with PersonResponseDto.primaryProfile.type,
    a DIFFERENT enum whose value is "user-person" — the frontend must map between the two.

Returns 200:
  { reassigned: number }
```

**Why the response is just a count:** the target _space_ person is materialized asynchronously by the `SharedSpaceFaceMatch` job, so it cannot be reliably resolved within the request. `reassigned` is all the frontend needs to gate its toast; the client refetches to see the new projection.

**Why a scoped-ref target (correction from review):** the `withSharedSpaces` picker returns a heterogeneous list — the editor's **own** people carry a **global** `person.id` (`type:"user-person"`), while another member's people carry a **space-person id** (`type:"space-person"`) (`mapAccessiblePerson`, `face-identity.repository.ts:2071-2091`). Routing only on the _source_ being a space person is not enough; the _target_ must self-describe so the resolver disambiguates. The FE builds the ref from each candidate's `primaryProfile` via the existing `toScopedPersonRef` helper (same as the merge flow).

### 4.2 Backend flow — `SharedSpaceService.reassignSpacePersonFaces`

1. `requireRole(auth, :id, Editor)` — viewers/non-members → `403`.
2. **Resolve source faces (P1).** New `sharedSpaceRepository` query: for `:personId` (a `shared_space_person`) and each `assetId`, return the `asset_face`(s) via `shared_space_person_face ⋈ asset_face` (`shared-space-person-face.table.ts:8-12` maps `personId → assetFaceId`). Include the same **space-scope + visibility/membership guards** the sibling queries carry (parity with `getSpaceRepresentativeFaceForUpdate`, `:2146-2175`). An asset with several faces of `:personId` → all returned (loop reassigns each); an asset whose face doesn't project to `:personId` → 0 rows (contributes nothing).
3. **Delegate the resolved faces to `identityMergePropagationService.reassignSpaceFacesToTarget(faces, target)`** (as implemented: a batch call taking no `auth` — authorization is fully handled in step 1 by the calling service), which per face:
   1. **Resolve the target global person id**, owner-aligned:
      - `target.type==="existing"`, `profile.type==="person"` → use `profile.id` directly (a real global `person.id`; the editor's own choice). The calling service must first verify the caller owns it or has shared-space edit access to it — otherwise any UUID could inject a face into a stranger's person.
      - `target.type==="existing"`, `profile.type==="space-person"` → `identityId = ensureSpacePersonIdentity(profile.id)` (`face-identity.repository.ts:2225-2263`); `person = getPersonByIdentity(assetFace.asset.ownerId, identityId)` (`:2598` — **promote to public**); **if absent →** `personRepository.create({ ownerId: assetFace.asset.ownerId, identityId })`. Unique `(ownerId,identityId)` + `(spaceId,identityId)` make this 1:1 (`person.table.ts:34-39`, `shared-space-person.table.ts:25-30`).
      - `target.type==="new"` → `personRepository.create({ ownerId: assetFace.asset.ownerId })` **with no `identityId`** — **one new person per distinct asset owner** across the selection (D4).
   2. **⚠️ Identity-link is load-bearing (correction from review).** For the _existing space-person_ branch, the resolved/created person **must already carry `identityId = target identity` before the relink.** `replaceFaceIdentity` → `ensurePersonIdentity` **mints a brand-new identity when the person has none** (`face-identity.repository.ts:2095-2126`); an identity-less person here would spawn a **duplicate** space person and silently reproduce #765. (The `target:"new"` branch deliberately stays identity-less so a _new_ identity/space-person is minted — correct.)
   3. `personRepository.reassignFace(assetFace.id, targetPersonId)` (`person.repository.ts:583`, returns `numChangedRows`).
   4. `replaceFaceIdentity(targetPersonId, assetFace.id, 'manual')`.
   5. `refreshSharedSpaceFacesAfterReassign(assetFace.assetId, assetFace.id)` — **relocated here** from `PersonService` (§4.4). Order 3→4→5 is mandatory (`person.service.ts:1195-1196`).
4. Return `{ reassigned, targets }`.

This is the exact proven trio used by the existing single-face `reassignFacesById` (`person.service.ts:256-280`); recognition will **not** re-merge a reassigned face (assigned faces early-return without re-search, `:1034-1047`), and emptied source space people are reaped (`:1214-1217`).

### 4.3 Frontend — `UnmergeFaceSelector` + caller

- **P2 picker:** load candidates with `getAllPeople({ withHidden:false, withSharedSpaces:true })` (already used by `loadMergePeople`, `+page.svelte:215-219`) so space people appear.
- **Routing:** branch on `personAssets.primaryProfile?.type === 'space-person'` (the prop is the full `PersonResponseDto`, `UnmergeFaceSelector.svelte:23,30`):
  - space-person source → call `reassignSpacePersonFaces({ id: personAssets.primaryProfile.spaceId, personId: personAssets.primaryProfile.id, dto:{ assetIds, target } })`, building `target` from the picked candidate's `primaryProfile` (`toScopedPersonRef`) or `{type:"new"}`. **`spaceId` comes from `personAssets.primaryProfile.spaceId`** — there is no `spaceId` route param (correction from review).
  - otherwise (personal `user-person`) → unchanged global `reassignFaces` path.
- **Honest toast:** toast success only when `reassigned > 0` (from the new endpoint); a zero result surfaces a warning/error instead of the current unconditional success. Reuse existing strings first (`errors.unable_to_reassign_assets_*` `i18n/en.json:1364-1365`, `no_faces_found:2076`); add a distinct "no matching faces" fork string only if wanted.
- **Reaped-source nav:** if the reassign empties (and reaps) the currently-viewed source space person, navigate back to the space people list rather than refreshing a now-deleted person page.

### 4.4 Required refactor — relocate the projection-refresh helper (correction from review)

`refreshSharedSpaceFacesAfterReassign` is currently **`private` on `PersonService`** (`person.service.ts:1197`); `SharedSpaceService`/`IdentityMergePropagationService` cannot call it (no cross-service injection; `base.service.ts:157-242`). Its body uses only `sharedSpaceRepository` + `jobRepository`. **Move it to `IdentityMergePropagationService`** (holds both deps, reachable from both services); update `PersonService`'s two existing call sites (`:244,:271`) to the relocated method. Likewise promote `getPersonByIdentity` (`face-identity.repository.ts:2598`) from private to a public repository method. No behavior change to the owner path.

### 4.5 RBAC & precedent

Editors/owners only; viewers → `403` (`requireRole(Editor)`). Editor writing a face on **another member's** asset is already sanctioned: `updateSpacePersonRepresentativeFace` lets an editor set a representative face on any member's asset (`shared-space.service.ts:1250-1297`), and the branch's `requireReassignFaceAccess` falls back to `Permission.AssetUpdate` (owner-or-space-Editor) for exactly this ("The face … often sits on another member's asset", `person.service.ts:1181-1188`).

---

## 5. Acceptance criteria (BDD — maps to issue #765 "To reproduce")

**AC1 — reassign-to-new (the reported case).**

> **Given** editor `b` viewing a space person that includes a misassigned photo on admin's asset
> **When** `b` selects the photo, chooses **Fix incorrect match → Create new person**
> **Then** the photo leaves the original space person and appears under a new space person (backed by a global person **owned by the asset owner**), the toast reports **1** reassigned, and **after refresh the photo does not reappear** under the original.

**AC2 — reassign-to-existing (another member's person).**

> **Given** the same, and an existing space person "Grandma" (admin-owned identity)
> **When** `b` picks Grandma from the picker and confirms **Reassign**
> **Then** the face joins Grandma's identity (owner-aligned person resolved/created under admin), shows only under Grandma in the space, and persists.

**AC3 — permission.** A **viewer** performing AC1/AC2 is rejected (`403`) and nothing changes.

---

## 6. TDD/BDD test plan

Red-validation discipline (per project norm): green → revert the fix → confirm red → restore → green.

### 6.1 Backend unit — `server/src/services/shared-space.service.spec.ts` → `describe('reassignSpacePersonFaces')` (+ `identity-merge-propagation.service.spec.ts` for the delegated core)

`newTestService`, `mocks.sharedSpace.*`, `mocks.person.reassignFace`, `mocks.faceIdentity.*`, `mocks.job.queue` (all real per `test/utils.ts:261,269`).

1. resolves the source face for a selected asset via the projection query and calls `reassignFace(faceId, target)` once.
2. `target:"new"` creates the person with **`ownerId = assetFace.asset.ownerId`** and **no `identityId`** (asserts D1), then reassigns.
3. `target:"existing"` space-person, an asset-owner person already in the identity → resolves it, **no `create`**.
4. `target:"existing"` space-person, **no** asset-owner person in the identity → `create({ ownerId: assetOwner, identityId: targetIdentity })` **before** relink (asserts the §4.2.3.2 trap — identity set at creation).
5. `target:"existing"` `user-person` → uses `profile.id` directly, no identity resolution, no create.
6. **Viewer** role → `Forbidden` (403); **non-member** → `Forbidden`. `reassignFace` never called.
7. multiple `assetIds` → one `reassignFace` per resolved face; returns correct `reassigned`.
8. **multi-face on one asset:** one asset, two faces of `:personId` → both reassigned (the gap the earlier draft mislabeled).
9. asset with **no** projecting face for `:personId` → contributes 0, touches no other person, no throw.
10. per face: `reassignFace` → `replaceFaceIdentity` → refresh helper are invoked **in that order** (assert on the mockable repo/relocated-service calls, not the old `PersonService` privates).
11. `target:"existing"` equal to the **source** person → rejected/no-op (`400`).
12. mixed-owner `assetIds` with `target:"new"` → one new person **per distinct asset owner** (D4), returned in `targets`.

### 6.2 Backend medium (real DB) — extend `server/test/medium/specs/services/people-identity-rbac.spec.ts` or new `space-person-reassign.spec.ts`

13. **AC1 regression guard (BDD):** editor reassign-to-new → face leaves source space person, source reaped when emptied, new space person appears under the **asset owner's** global person, and re-read shows **no reappear**. (Explicitly asserts the #765 symptom is gone.)
14. **AC2:** reassign-to-existing cross-owner space person → owner-aligned person resolved/created **linked to the target identity**; the projection shows the face under the **target** (not a duplicate — guards the §4.2.3.2 trap end-to-end); `face_identity_face` repointed.
15. asset shared into **two** spaces → both projections refreshed. (Note limitation: `getSpaceIdsForAsset`, `:3593`, does **not** union cross-owner _album-contributed_ assets `#764`; assert the direct-membership case, and document the album-contribution gap.)
16. **AC3:** viewer reassign → `403`, projection untouched.
17. idempotency / re-run → no duplicate faces or persons.
18. reassigning the source's **representative** face updates `representativeFaceId` sensibly on both sides.

### 6.3 E2E API — `e2e/src/specs/server/api/person-search-reassign.e2e-spec.ts` + `shared-space.e2e-spec.ts`

19. editor: `POST /shared-spaces/:id/people/:sp/reassign` → `200`; `GET …/people/:sp/faces` no longer lists the asset; target lists it.
20. viewer → `403`; outsider → `403`.
21. `target:"new"` → the created person is **owned by the asset owner** — assert via the created person's `ownerId` in the response/DB (**not** via the owner's `/people` list, which hides fresh 1-face unnamed persons behind `people.minimumFaces`).

### 6.4 Frontend unit — mirror `web/.../person-detail-page.spec.ts` (vitest + `@testing-library/svelte` + `sdkMock`)

22. space-person context → picker loads via `getAllPeople({ withSharedSpaces:true })` (space people appear). — P2
23. space-person source → **create** and **reassign** call `reassignSpacePersonFaces` with `{ spaceId, sourcePersonId, target }` (target built from candidate `primaryProfile`); personal source still calls global `reassignFaces`.
24. toast shows success **only when `reassigned > 0`**; a `0` response surfaces a warning, not success.
25. picking the editor's **own** (`user-person`) candidate → `target:{type:"existing",profile:{type:"user-person",id}}`; picking another member's → `{…space-person…}`.
26. viewers are not offered the action.
27. reaped-source → navigates to the space people list, not a dead person page.

---

## 7. Files expected to change

- **Backend (fork-only + minimal shared):** `shared-space.controller.ts` (route), `shared-space.service.ts` (`reassignSpacePersonFaces`), `shared-space.repository.ts` (new `(spacePersonId, assetId) → asset_face[]` query, guarded), `identity-merge-propagation.service.ts` (**relocated** `refreshSharedSpaceFacesAfterReassign` + `reassignFaceToResolvedTarget`), `face-identity.repository.ts` (**expose** `getPersonByIdentity`), `person.service.ts` (repoint its 2 refresh call sites), new `SharedSpacePersonReassignDto` (reuses `ScopedPersonProfileRefDto`).
- **SDK/OpenAPI:** regenerate (`make open-api`).
- **Frontend:** `UnmergeFaceSelector.svelte` (picker source, `primaryProfile`-based routing, scoped-ref target, honest toast, reaped-source nav), its caller `+page.svelte`.
- **i18n:** reuse-first; new fork string only for a distinct "no matching faces" message.
- **Tests:** the four suites in §6.

## 8. Out of scope

- The `/spaces/{id}/people` asset-select "Fix incorrect match" button (a different surface; can be added later reusing this endpoint).
- Trimming the branch's global-endpoint editor-RBAC (D2 leaves it for the owner path).
- Mobile parity. Cross-owner _album-contributed_ asset projection refresh (`#764` helper gap, §6.2/15).

## 9. Resolved decisions

- **D4 (mixed-owner create-new):** if selected assets span multiple owners and `target:"new"`, create **one new person per distinct asset owner** (matches D1 per-face owner-alignment). Single-owner selection — the common case — yields exactly one. All created persons are returned in `targets`.

---

## Appendix — review verification (adversarial, 4 passes)

- **Identity model / P3 soundness:** SOUND — single-face reassign is per-face (`asset_face.personId`; `face_identity_face` PK on `assetFaceId`, `face-identity-face.table.ts:26`); projection identity-keyed (`COALESCE(identityId,id)`, `shared-space.repository.ts:1854,2018`); proven by existing `reassignFacesById`. **Trap:** identity-link-before-relink (§4.2.3.2).
- **P1 + projection:** projection map + `reassignFace` + `isAssetInSpace` guard confirmed; **refresh helper must relocate** (§4.4); `getSpaceIdsForAsset` album-contribution gap noted.
- **Ownership/RBAC/cross-owner:** D1 well-grounded (3 sites); RBAC pattern confirmed; **cross-owner gate dropped** (D3).
- **FE/tests:** routing feasible via `primaryProfile`; all referenced test files exist; **target-id ambiguity** fixed with the scoped-ref DTO (§4.1); honest-toast confirmed.
