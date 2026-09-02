# Space-Editor Face Assignment — Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An editor can create a space person from a face ("add a name") and detach a face from a space person.

**Architecture:** `POST /shared-spaces/:id/people` creates a `shared_space_person`, optionally attaching a seed face in the same transaction. `DELETE /shared-spaces/:id/people/:personId/faces/:assetFaceId` removes the space projection row — and only that. The face's global identity is left alone, because deleting it would mutate every other space sharing that identity.

**Tech Stack:** NestJS 11, Kysely, Zod DTOs, Vitest (unit + medium).

**Spec:** `specs/2026-08-23-space-editor-face-assignment-design.md` — §6.2, §6.4, §9.4

**Baseline (Slices 1–3, committed):** `isFaceAssignableInSpace`, `attachFaceToSpacePerson`, `linkFaceToSpacePerson`, `getAssetFacesForSpace`, the attach `PUT` route and the faces `GET` route.

## Global Constraints

- **No relative imports in `server/`** — use the `src/` path alias.
- **Do NOT touch** `server/src/utils/access.ts`, `person.controller.ts`, `face.controller.ts`.
- **Do NOT write `asset_face.personId`.**
- **Never put `--` before a vitest filter** — it discards the filter and runs all 161 medium files, producing fake `too many clients already` failures. Use `pnpm test --run shared-space.service`, `pnpm test:medium --run shared-space-face-assign --maxWorkers=4`.
- **ESLint runs `--max-warnings 0`.** `pnpm lint` is ESLint only; prettier is a separate gate. Run both.
- **Do NOT run `make sql`** or regenerate OpenAPI — deferred to Slice 9.
- **Guard check:** use `git diff --name-only <slice-4-base-sha>..HEAD`, never `origin/main...HEAD`.

## Two traps this slice exists to avoid

1. **Detach must recount.** `addPersonFaces` calls `recountPersons` on the way in (`shared-space.repository.ts:2660`). A detach that does not recount leaves `shared_space_person.faceCount` / `assetCount` overstated. Those columns are not cosmetic — the people-list index sorts unnamed people by `assetCount` (`shared_space_person_space_name_idx`) and `minimumFaceCount` filters read them (`:1688`, `:1783`). Drift silently reorders and hides people. **F-32 is the first test to write**, because a forgotten recount is invisible to every other test in this slice.
2. **Detach must NOT delete `face_identity_face`.** The projection row only. Deleting the identity link would blank the face's identity globally and mutate other spaces (§5.1, F-22).

---

### Task 1: Detach

**Files:** `server/src/repositories/shared-space.repository.ts`, `server/src/services/shared-space.service.ts`, `server/src/controllers/shared-space.controller.ts`, plus the medium spec.

**Interfaces:**

- Produces: `SharedSpaceRepository.removePersonFace(personId: string, assetFaceId: string, db?): Promise<void>` — deletes the one `shared_space_person_face` row **and calls `recountPersons([personId], db)`**.
- Produces: `SharedSpaceService.detachFaceFromSpacePerson(auth, spaceId, personId, assetFaceId): Promise<boolean>`
- Produces: `DELETE /shared-spaces/:id/people/:personId/faces/:assetFaceId` → `{ acted: boolean }`

The existing removals are bulk-only (`removePersonFacesByAssetIds`, `removePersonFacesByLibrary`, `removePersonFaceAssignmentsForSpaceFace`); none is a single-pair detach with a recount.

- [ ] **Step 1: Write F-32 and F-22 as failing medium tests**

Append to `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts`, reusing its `setup()` / `newSpaceWithEditorAndMember` / `reachPathBuilders` helpers.

```ts
describe("detach", () => {
  // F-32: the counts must come back down. Written FIRST — a missing recount is invisible
  // to every other test here and only surfaces later as mis-ordered, silently-hidden people.
  it("recounts faceCount/assetCount on detach (F-32)", async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: "Aurelia" });
    await spaceRepo.addPersonFaces([{ personId: person.id, assetFaceId: faceId }]);

    const before = await defaultDatabase.selectFrom("shared_space_person").selectAll().where("id", "=", person.id).executeTakeFirstOrThrow();
    expect(before.faceCount).toBe(1);

    await spaceRepo.removePersonFace(person.id, faceId);

    const after = await defaultDatabase.selectFrom("shared_space_person").selectAll().where("id", "=", person.id).executeTakeFirstOrThrow();
    expect(after.faceCount).toBe(0);
    expect(after.assetCount).toBe(0);
  });

  // F-22: the identity link survives, so other spaces sharing it are unaffected (§5.1).
  it("leaves face_identity_face untouched (F-22)", async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: "Aurelia" });
    const identity = await ctx.get(FaceIdentityRepository).ensureSpacePersonIdentity(person.id);
    await ctx.get(FaceIdentityRepository).replaceFaceIdentity({ assetFaceId: faceId, identityId: identity.id, source: "manual" });
    await spaceRepo.addPersonFaces([{ personId: person.id, assetFaceId: faceId }]);

    await spaceRepo.removePersonFace(person.id, faceId);

    const link = await defaultDatabase.selectFrom("face_identity_face").selectAll().where("assetFaceId", "=", faceId).executeTakeFirst();
    expect(link).toBeDefined();
    expect(link?.identityId).toBe(identity.id);
  });
});
```

- [ ] **Step 2: Run and confirm RED** — `cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4`. Expect `removePersonFace is not a function`.

- [ ] **Step 3: Implement `removePersonFace`, the service method and the route**

Service gates, in order: `requireRole(auth, spaceId, SharedSpaceRole.Editor)` → `requireSpacePersonInSpace(spaceId, personId)` → `isFaceAssignableInSpace(spaceId, assetFaceId)` (F-38: re-checked at write time, never trusted from the §6.1 read) → write a negative verdict via `markRejectedForSpacePerson` so the suggestion pipeline does not immediately re-offer the face → `removePersonFace`.

Route: `@Delete(':id/people/:personId/faces/:assetFaceId')`, `@Authenticated({ permission: Permission.SharedSpaceUpdate })`, `@HttpCode(HttpStatus.OK)`, returning `{ acted }` — matching the attach route's shape. Reuse `SpacePersonFaceParamsDto` from Slice 1.

- [ ] **Step 4: Run and confirm GREEN**, then add controller tests mirroring the file's real idiom (assert `ctx.authenticate` called with the expected permission; non-uuid `assetFaceId` → 400). No bare-401 test — the harness mocks `AuthService.authenticate` to return `undefined`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): detach a face from a space person

Removes the space projection row and recounts -- faceCount/assetCount drive
the people-list ordering index and the minimumFaceCount filters, so a missed
recount silently reorders and hides people. Deliberately leaves
face_identity_face alone: blanking it would mutate every other space sharing
that identity.

Covers F-22, F-32, F-38."
```

---

### Task 2: Create a space person

**Interfaces:**

- Produces: `SharedSpaceService.createSpacePerson(auth, spaceId, dto: { name?: string; assetFaceId?: string }): Promise<SharedSpacePersonResponseDto>`
- Produces: `POST /shared-spaces/:id/people`

Reuses the existing `SharedSpaceRepository.createPerson` (`:2236`) — **not a new method**.

**The `(spaceId, identityId)` unique index is the trap.** `shared_space_person_spaceId_identityId_key` forbids two people in one space carrying the same identity. If the seed face already has an identity and that identity already has a space person here, a plain `createPerson` violates the index. Use `createOrGetPersonForIdentity` (`:2245`) in that case, returning the existing person rather than failing (F-33).

- [ ] **Step 1: Write F-15 and F-33 as failing medium tests**

```ts
describe("createSpacePerson", () => {
  // F-15: person + attachment are one transaction. A crash between them would leave a
  // nameless orphan in the space's people list.
  it("creates the person and attaches the seed face atomically (F-15)", async () => {
    /* ... */
  });

  // F-15 negative: force the attach to throw and assert NO person row survives.
  it("rolls the person back when the attach fails (F-15)", async () => {
    /* ... */
  });

  // F-33: the seed face's identity already has a space person in this space.
  it("returns the existing person instead of violating the unique index (F-33)", async () => {
    /* ... */
  });
});
```

Fill these using the file's existing fixture helpers. For the rollback test, make the attach fail by passing a face id that passes the assignability check but breaks the FK — or spy the repository to throw — whichever the harness supports; the assertion that matters is that `shared_space_person` has no new row afterwards.

- [ ] **Step 2: Run and confirm RED.**

- [ ] **Step 3: Implement.** Gate on `requireRole(Editor)`. When `assetFaceId` is present, run create + `linkFaceToSpacePerson` inside **one** `databaseRepository.transaction`. When the seed face already carries an identity, route through `createOrGetPersonForIdentity`.

- [ ] **Step 4: Run and confirm GREEN.**

- [ ] **Step 5: Add the request DTO** (`name?: string`, `assetFaceId?: uuidv4()`) and the route, `@Authenticated({ permission: Permission.SharedSpaceUpdate })`, returning `SharedSpacePersonResponseDto`.

- [ ] **Step 6: Full gate**

```bash
cd server && pnpm check
cd server && pnpm test --run shared-space.service
cd server && pnpm test --run shared-space.controller
cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4
cd server && pnpm lint && npx prettier --check "src/**/*.ts" "test/**/*.ts"
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(server): create a space person, optionally from a seed face

Create-and-attach is one transaction -- a crash between them leaves a nameless
orphan in the space people list. Routes through createOrGetPersonForIdentity
when the seed face already carries an identity, since (spaceId, identityId) is
unique and a plain insert would violate it.

Covers F-15, F-33."
```

---

## Slice 4 Done When

- Detach removes the projection row, recounts, and leaves `face_identity_face` intact.
- Create makes a space person, optionally attaching a seed face atomically, without violating the identity unique index.
- F-15, F-22, F-32, F-33, F-38 pass.
- `git diff --name-only <base>..HEAD` touches no forbidden file.
