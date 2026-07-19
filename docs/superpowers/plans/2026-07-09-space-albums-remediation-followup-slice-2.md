# Slice 2 — M1: `GET /people/:id/faces` scope leak — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD, red→green.

**Goal:** A non-owner (space-granted) caller of `GET /people/:id/faces` must receive **only** faces on
assets that are space-reachable-by-them AND pass `spaceVisibilityGate` — never the owner's
Hidden/Locked/never-shared faces, and never cross-user faces pulled in via the shared identity. The
owner keeps the full, unscoped list.

**Architecture:** `getFacesForPicker` decides owner vs non-owner via
`accessRepository.person.checkOwnerAccess`. For a non-owner it passes a `scope: { memberUserId }` into
`getRepresentativeFaces`, which adds an asset-level `spaceVisibilityGate` + `spaceAssetPathBranches({
memberUserId })` predicate. Because the gate is on the joined `asset` row (`asset.id`/`asset.libraryId`),
it filters faces matched via **both** the `personId` arm and the `face_identity_face` identity arm in one
predicate — no need to special-case the identity join.

**Tech Stack:** NestJS, Kysely. Server-only, **no DTO/SDK change** (response shape unchanged).

## Global Constraints (spec §0)

- TDD mandatory; positive control before every negative. No `this.db` in `transaction()`. No co-author
  trailers. Re-confirm lines before editing. Run targeted specs + `make check-server` + lint; leave
  full-suite + e2e to CI (write the e2e, don't block on running it).

## Key facts (verified)

- `getRepresentativeFaces` (`person.repository.ts:427-468`): joins `asset_face` via
  `personId OR EXISTS(face_identity_face … identityId = person.identityId)`, joins `asset`, filters only
  `asset_face.deletedAt/isVisible`, `asset.deletedAt/isOffline`. **No visibility/space scope.**
- `getFacesForPicker` (`person.service.ts:322-349`): `requireAccess(PersonRead)` then calls
  `getRepresentativeFaces({ personId, take, skip })`.
- `SpaceScope` supports `{ memberUserId: string }` (`shared-space-album-scope.ts` ~`:210`); passing it to
  `spaceAssetPathBranches` joins `shared_space_member` on `userId = memberUserId` per arm. Use
  `requireShowInTimeline: false` (default) — a face on any space-reachable album/direct/library asset is
  pickable regardless of the per-member timeline toggle.
- `spaceVisibilityGate`, `spaceAssetPathBranches` exported from `src/utils/shared-space-album-scope.ts`
  (add imports to `person.repository.ts` if missing).
- Owner check primitive: `accessRepository.person.checkOwnerAccess(userId, ids: Set<string>)` (used by
  `requireThumbnailAccess` at `person.service.ts:433`).

---

### Task 1: Add `scope` to `getRepresentativeFaces` (repository)

**Files:**

- Modify: `server/src/repositories/person.repository.ts` — `RepresentativeFaceListOptions` (`:85`) +
  `getRepresentativeFaces` (`:427`)
- Test (medium): `server/test/medium/specs/repositories/person.repository.spec.ts` (create/extend; find
  existing person repo medium spec via `grep -rl "getRepresentativeFaces\|personRepository" server/test/medium`)

**Interfaces:**

- Produces: `RepresentativeFaceListOptions.scope?: { memberUserId: string }`. When set, results are
  restricted to space-reachable + visibility-gated assets for that member.

- [ ] **Step 1: Write failing medium test.** Seed: owner O; person P owned by O with `identityId` set.
      Faces of P on three of O's assets — A1 (Timeline) linked into space S (via a linked album OR direct
      `shared_space_asset`); A2 (Hidden); A3 (Timeline, never in any space). Add member V (Viewer) to S.
  - `getRepresentativeFaces({ personId: P, take: 50, skip: 0, scope: { memberUserId: V } })` → returns
    **only** the A1 face; **excludes** A2 and A3.
  - `getRepresentativeFaces({ personId: P, take: 50, skip: 0 })` (owner path, no scope) → returns all
    three faces (regression: unscoped unchanged).
  - **Cross-identity (include if the fixture supports it, else add as a follow-up assertion):** second
    user U2 with person P2 sharing P's `identityId`, face on U2's own asset A4 → present for the owner
    unscoped call, **absent** for the `scope:{memberUserId:V}` call.

- [ ] **Step 2: Run — expect RED.** `cd server && pnpm test:medium -- --run <person repo medium spec>`
      (needs Docker; if `docker ps` fails, write the test, note it, and lean on Task 2's unit test + a
      careful read). Expected: the `scope` call returns A2/A3 (leak) → FAIL.

- [ ] **Step 3: Implement.** Add to `RepresentativeFaceListOptions`:

```ts
scope?: { memberUserId: string };
```

In `getRepresentativeFaces`, after the existing `.where('asset.isOffline', '=', false)` chain (and the
identity DISTINCT-FROM filter), add:

```ts
.$if(!!options.scope, (qb) =>
  qb.where((eb) =>
    eb.and([
      // Fork RBAC (Slice 2 / M1): a non-owner (space-granted) caller may only see faces on assets
      // they can reach through a space AND that pass the shareable visibility gate. Filters faces
      // matched via BOTH the personId arm and the identity-expansion arm (predicate is on the
      // joined asset row), so cross-user identity faces are also excluded.
      spaceVisibilityGate(eb),
      eb.or(
        spaceAssetPathBranches(eb, {
          correlateAssetId: 'asset.id',
          correlateLibraryId: 'asset.libraryId',
          scope: { memberUserId: options.scope!.memberUserId },
        }),
      ),
    ]),
  ),
)
```

Add imports for `spaceVisibilityGate`, `spaceAssetPathBranches` from `src/utils/shared-space-album-scope`
if not already imported.

- [ ] **Step 4: Run — expect GREEN.** Same medium command. Owner sees all; V sees only A1.

- [ ] **Step 5: `make sql`** only if the `@GenerateSql` example for `getRepresentativeFaces` changed the
      generated doc AND Docker DB is up (scratch DB only; never without a DB). The decorator params
      (`{ personId, take, skip }`) don't set `scope`, so the generated SQL is unchanged → likely skip; verify
      `git status` shows no unintended `.sql` diff.

- [ ] **Step 6: Commit.**

```bash
git add server/src/repositories/person.repository.ts server/test/medium/specs/repositories/person.repository.spec.ts server/src/queries 2>/dev/null
git commit -m "fix(spaces): scope person representative-faces to space-reachable assets for non-owners (M1)"
```

---

### Task 2: Wire owner-vs-non-owner scope in `getFacesForPicker` (service)

**Files:**

- Modify: `server/src/services/person.service.ts` — `getFacesForPicker` (`:322-349`)
- Test (unit): `server/src/services/person.service.spec.ts`
- Test (e2e): `e2e/src/**` — extend a people-faces or shared-space person spec (find via
  `grep -rl "people.*faces\|representative" e2e/src`)

**Interfaces:**

- Consumes: `RepresentativeFaceListOptions.scope` from Task 1;
  `accessRepository.person.checkOwnerAccess(userId, Set<string>)`.

- [ ] **Step 1: Write failing unit test** in `person.service.spec.ts`: with mocks,
      `checkOwnerAccess` returns an **empty** set (non-owner) → assert `getRepresentativeFaces` is called with
      `scope: { memberUserId: auth.user.id }`. Second test: `checkOwnerAccess` returns a set **containing**
      the id (owner) → assert `getRepresentativeFaces` called with `scope: undefined`. (Person is reachable
      via `requireAccess(PersonRead)` mock in both.)

- [ ] **Step 2: Run — expect RED.** `cd server && pnpm test -- --run src/services/person.service.spec.ts`.
      Expected: FAIL (today no `scope` is passed).

- [ ] **Step 3: Implement.** In `getFacesForPicker`, after `requireAccess(PersonRead)` + `findOrFail`:

```ts
const isOwner = await this.accessRepository.person.checkOwnerAccess(auth.user.id, new Set([id]));
const scope = isOwner.has(id) ? undefined : { memberUserId: auth.user.id };
const rows = await this.personRepository.getRepresentativeFaces({
  personId: id,
  take,
  skip: (dto.page - 1) * dto.size,
  scope,
});
```

(Prefer `person.ownerId === auth.user.id` if `findOrFail` already returns `ownerId` — either is fine;
`checkOwnerAccess` matches `requireThumbnailAccess`'s pattern. Pick one, keep it consistent.)

- [ ] **Step 4: Run — expect GREEN.** Same unit command.

- [ ] **Step 5: Write the e2e negative** (write; CI runs): owner O's person P shared into space S; syncs
      Viewer V. Positive control: owner `GET /people/P/faces` → full list incl. a hidden-asset face. Then V
      `GET /people/P/faces` → returns only space-visible faces (assert the hidden/never-shared face ids are
      absent); assert a 200 empty page (not 500) when P is only on hidden assets for V.

- [ ] **Step 6: `make check-server` + lint, then commit.**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts e2e/src
git commit -m "fix(spaces): gate person-faces picker owner-vs-space in getFacesForPicker (M1)"
```

---

## Edge cases (assert each — spec §Slice 2)

- [ ] Owner caller → full unscoped list (no behavior change).
- [ ] Non-owner, person only on Hidden/Locked → **empty page**, not a 500.
- [ ] Identity fan-out to another user's assets → cross-user faces excluded (asset-level gate covers it).
- [ ] Archived (shareable) space asset face → **included** (Archive passes `spaceVisibilityGate`).
- [ ] Pagination (`page`/`size`) → `hasNextPage` reflects the **scoped** row count (the `take+1` fetch is
      applied after the scope predicate).
- [ ] `getFaceThumbnail` on an excluded face → still `AssetRead`-denied (unchanged; assert no regression).

## Definition of done

- Medium (repo scope) + unit (service wiring) green; e2e written (CI). `make check-server` + lint clean.
- No DTO/SDK change. Two commits pushed. Scope-clean (only M1).
