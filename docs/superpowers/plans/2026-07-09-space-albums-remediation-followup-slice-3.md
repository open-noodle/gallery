# Slice 3 — M2: Representative-face write gated by read permission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD, red→green.

**Goal:** `PUT /people/:id/representative-face` (`updateRepresentativeFace`) must be limited to the
person's **owner** OR an **Editor/Owner** of a space the person is shared through. A space **Viewer**
must be **denied** (today a Viewer can change the owner's global People-page cover for everyone).

**Architecture:** Extend the shared `SpaceScope.{ memberUserId }` with an optional `memberRole?`
(additive; the 3 Kysely path arms add a role predicate on the `shared_space_member` join when present).
Add `PersonAccess.checkSharedSpaceEditAccess` (mirror `checkSharedSpaceAccess` + `memberRole:[Owner,
Editor]`). Gate `updateRepresentativeFace` on `checkOwnerAccess` OR `checkSharedSpaceEditAccess` after
the existing `PersonRead` reachability check.

**Tech Stack:** NestJS, Kysely. Server-only, **no DTO/SDK change**.

## Global Constraints (spec §0)

- TDD, positive control before negative. No co-author trailers. Targeted specs + `make check-server` +
  lint only (no full suites); write e2e, defer running to CI. Re-confirm lines before editing.

## Key facts (verified)

- `updateRepresentativeFace` (`person.service.ts:367-396`): gates on `PersonRead` (`:375`), then writes
  `person.faceAssetId` (`:386`) + identity-level rep face (`:387-392`) + queues `PersonGenerateThumbnail`
  (`:394`). No role/owner gate → Viewer qualifies.
- `PersonAccess` (`access.repository.ts:675`): `checkOwnerAccess` (`:680`),
  `checkSharedSpaceAccess` (`:696`) uses `spaceAssetPathBranches({ memberUserId: userId })` with **no
  role filter** (`:721-729`).
- `SpaceScope` union (`shared-space-album-scope.ts:57-60`) has `{ memberUserId: string }`; the member
  join with `shared_space_member.userId = memberUserId` appears in 3 Kysely arms:
  `spaceDirectAssetExists` (~`:137`), `spaceAlbumAssetExists` (~`:180`), `spaceLibraryAssetExists`
  (~`:212`). (The raw-SQL `spaceAlbumAssetExistsSql` uses a `spaceScopeJoin` fragment, **not**
  `memberUserId` — no change there.)
- `SharedSpaceRole` enum (`enum.ts:73`): values `owner` / `editor` / `viewer`. Access repo already
  filters roles elsewhere (`.where('shared_space_member.role', 'in', [SharedSpaceRole.Owner,
SharedSpaceRole.Editor])` at `:158`).

---

### Task 1: Add optional `memberRole` to `SpaceScope.{ memberUserId }` + apply in the 3 arms

**Files:**

- Modify: `server/src/utils/shared-space-album-scope.ts` — `SpaceScope` type (`:57`), and the
  `.$if('memberUserId' in scope, …)` blocks in `spaceDirectAssetExists`, `spaceAlbumAssetExists`,
  `spaceLibraryAssetExists`.
- Test (medium): `server/test/medium/specs/utils/shared-space-album-scope*.spec.ts` (extend; find via
  `grep -rl "spaceAssetPathBranches\|memberUserId" server/test/medium`)

**Interfaces:**

- Produces: `SpaceScope` `{ memberUserId }` variant becomes `{ memberUserId: string; memberRole?:
SharedSpaceRole[] }`. When `memberRole` is set, each arm additionally requires
  `shared_space_member.role IN (memberRole)`. Existing callers (no `memberRole`) are **unchanged**.

- [ ] **Step 1: Write failing medium test.** Extend the scope helper medium spec: build a query using
      `spaceAssetPathBranches(eb, { …, scope: { memberUserId: V, memberRole: [SharedSpaceRole.Owner,
SharedSpaceRole.Editor] } })` against a fixture where V is a **Viewer** of the space linking the asset
      → asset **not** reachable (empty). With V as **Editor** → reachable. Positive control: without
      `memberRole`, the Viewer IS reachable (existing behavior).

- [ ] **Step 2: Run — expect RED.** `pnpm test:medium -- --run <scope helper spec>` (Docker; if none,
      write it + rely on Task 2 e2e). Expected: viewer still reachable with `memberRole` set (no filter yet).

- [ ] **Step 3: Implement.** In `SpaceScope`, change `{ memberUserId: string }` to
      `{ memberUserId: string; memberRole?: SharedSpaceRole[] }`. In **each** of the 3 arms, immediately
      after the existing `.where('shared_space_member.userId', '=', asUuid(...memberUserId))`, add:

```ts
.$if(!!(scope as { memberRole?: SharedSpaceRole[] }).memberRole?.length, (qb) =>
  qb.where('shared_space_member.role', 'in', (scope as { memberRole: SharedSpaceRole[] }).memberRole),
)
```

Import `SharedSpaceRole` from `src/enum` if not already imported.

- [ ] **Step 4: Run — expect GREEN.** Viewer excluded, Editor included with `memberRole`; no-`memberRole`
      path unchanged.

- [ ] **Step 5: Add `checkSharedSpaceEditAccess` to `PersonAccess`** (`access.repository.ts`, right after
      `checkSharedSpaceAccess` at `:734`). Copy `checkSharedSpaceAccess` verbatim but change the scope to
      `scope: { memberUserId: userId, memberRole: [SharedSpaceRole.Owner, SharedSpaceRole.Editor] }`, and add
      `@GenerateSql`/`@ChunkedSet` decorators identical to `checkSharedSpaceAccess`. Register it on the
      access repo's `person` surface if the access interface enumerates methods (check
      `src/repositories/access.repository.ts` `person = { … }` export / the `IAccessRepository` person type
      and add `checkSharedSpaceEditAccess` there).

- [ ] **Step 6: `make sql`** if any new `@GenerateSql` query doc is produced (Docker DB up, scratch only).
      A new decorated method (`checkSharedSpaceEditAccess`) WILL add a generated `.sql` doc — run `make sql`
      and include the new/updated `.sql` in the commit. If Docker is unavailable, note that CI/`make sql`
      must be run before merge.

- [ ] **Step 7: Commit.**

```bash
git add server/src/utils/shared-space-album-scope.ts server/src/repositories/access.repository.ts \
        server/test/medium/specs/utils server/src/queries 2>/dev/null
git commit -m "feat(spaces): role-filtered member scope + PersonAccess.checkSharedSpaceEditAccess (M2)"
```

---

### Task 2: Gate `updateRepresentativeFace` on owner ∪ editor

**Files:**

- Modify: `server/src/services/person.service.ts` — `updateRepresentativeFace` (`:367-396`)
- Test (unit): `server/src/services/person.service.spec.ts`
- Test (e2e): extend `e2e/src/specs/server/api/person-faces-picker-scope.e2e-spec.ts` (from Slice 2) or a
  shared-space person spec.

**Interfaces:**

- Consumes: `accessRepository.person.checkOwnerAccess`, `accessRepository.person.checkSharedSpaceEditAccess`.

- [ ] **Step 1: Write failing unit test** in `person.service.spec.ts`: `updateRepresentativeFace` when
      `checkOwnerAccess` = ∅ AND `checkSharedSpaceEditAccess` = ∅ (Viewer) → throws (403/Forbidden or
      BadRequest — match the pattern; use `ForbiddenException`), and `personRepository.update` +
      `jobRepository.queue(PersonGenerateThumbnail)` are **NOT** called. Second test: `checkOwnerAccess`
      contains the id (owner) → proceeds. Third: `checkSharedSpaceEditAccess` contains the id (editor) →
      proceeds. (`PersonRead` reachability + `AssetRead` on the face are mocked-true in all three.)

- [ ] **Step 2: Run — expect RED.** `pnpm test -- --run src/services/person.service.spec.ts`. Expected:
      the Viewer test FAILS (today it proceeds and mutates).

- [ ] **Step 3: Implement.** In `updateRepresentativeFace`, after the existing
      `await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [id] })` and `findOrFail`:

```ts
// Fork RBAC (Slice 3 / M2): PersonRead only proves reachability (viewers included). Mutating the
// owner's GLOBAL representative face must be limited to the owner or an Editor/Owner of a space the
// person is shared through — mirror album writes. A viewer is denied.
const ids = new Set([id]);
const isOwner = await this.accessRepository.person.checkOwnerAccess(auth.user.id, ids);
if (!isOwner.has(id)) {
  const canEdit = await this.accessRepository.person.checkSharedSpaceEditAccess(auth.user.id, ids);
  if (!canEdit.has(id)) {
    throw new ForbiddenException('Not authorized to change this person');
  }
}
```

(Place this BEFORE the `getRepresentativeFaceForUpdate` / write. Import `ForbiddenException` if needed.)

- [ ] **Step 4: Run — expect GREEN.** Viewer denied (no write/queue); owner + editor proceed.

- [ ] **Step 5: Write the e2e negatives** (write; CI runs): owner O's person P shared into space S; add
      Viewer V and Editor E to S; pick a face on a space-visible asset.
  - V `PUT /people/P/representative-face { assetFaceId }` → **403**; then `GET /people/P` (or re-read)
    shows `faceAssetId` unchanged. (If asserting the queue is hard in e2e, at minimum assert 403 + no
    change.)
  - E → **200** (positive control the gate admits editors).
  - O → **200** (unchanged).

- [ ] **Step 6: `make check-server` + lint, then commit.**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts e2e/src
git commit -m "fix(spaces): require owner or space-editor to set person representative face (M2)"
```

---

## Edge cases (assert each — spec §Slice 3)

- [ ] Viewer with `PersonRead` but not owner/editor → **denied** (the bug).
- [ ] Editor of a space the person is shared through → **allowed**.
- [ ] `identityId` set → the identity-level rep-face write is also gated (the gate runs before BOTH
      writes, so it covers `faceAssetId` and the identity update).
- [ ] Chosen face not reachable by caller → still `AssetRead`-denied (unchanged; the role gate runs first,
      then the existing `AssetRead` check on the face).
- [ ] Owner editing their own person → allowed, unchanged.
- [ ] Space-person profile write (`updateSpacePersonRepresentativeFace`) → untouched (already Editor-gated;
      regression-assert nothing changed there).

## Definition of done

- Medium (role scope) + unit (gate) green; e2e written (CI). `make check-server` + lint clean.
- `make sql` regenerated for the new access method (or flagged for CI if Docker unavailable).
- No DTO/SDK change. Two commits pushed. Scope-clean (only M2).
