# Space-Editor Face Assignment — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A space Owner/Editor can attach an existing space person to a face on any asset reachable through that space, via `PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId`.

**Architecture:** A new SQL predicate answers "may this face be assigned in this space?" (reachability + the hidden-person exclusion). A new service method composes it with the existing `requireRole` / `requireSpacePersonInSpace` gates and runs the same transaction `confirmSpacePersonFaceSuggestion` already runs — inline for now. A new controller route wires it up. Nothing in `server/src/utils/access.ts` or the upstream person/face controllers changes.

**Tech Stack:** NestJS 11, Kysely, Zod DTOs (`createZodDto`), Vitest (unit + medium with testcontainers Postgres).

**Spec:** `specs/2026-08-23-space-editor-face-assignment-design.md` (§3, §6.1 filter, §6.3, §9.1)

## Global Constraints

- **No relative imports in `server/`** — use the `src/` path alias.
- **Do NOT touch `server/src/utils/access.ts`**, `person.controller.ts`, or `face.controller.ts`. If a change appears to need a new arm in `checkOtherAccess`, stop — the design has drifted (spec §10 trap 5).
- **Do NOT extract `linkFaceToSpacePerson` in this slice.** The transaction is inlined here deliberately; extraction is Slice 2's deliverable and its proof is that the existing suggestion tests pass unchanged.
- **Do NOT write `asset_face.personId`** on any path (spec §4.2).
- **Param DTO uuid version:** `asset_face.id`, `shared_space_person.id` and `shared_space.id` all use `@PrimaryGeneratedColumn()` (v4). Use `z.uuidv4()`. Using `z.uuidv7()` makes every route 400.
- **Medium tests need a live Postgres.** Run with `--maxWorkers=4`; default parallelism exhausts connections and the failure set shifts between runs.
- **Never put `--` before a vitest filter.** `pnpm test:medium -- --run <filter>` silently discards the filter and runs all 161 medium files, which then fail on Postgres connection contention that has nothing to do with your change. The correct form is `pnpm test:medium --run <substring>` — no `--`. Same trap applies to `pnpm test`.
- **`@GenerateSql` regeneration:** never run `make sql` without a running database — it deletes every query file.
- **No OpenAPI regeneration in this slice.** It happens once, in Slice 9 (spec §10 trap 1).

---

### Task 1: The `isFaceAssignableInSpace` SQL predicate

The authority rule's data half: a face is assignable in a space if its asset is reachable there (any of the three paths), the face is live and visible, and it does **not** belong to a person its owner marked hidden.

`isFaceReachableInSpace` (`face-person-verdict.repository.ts:874`) already covers everything except the hidden-person exclusion. This task adds a sibling that composes it with that exclusion, so read (Slice 3) and write (this slice) share one predicate.

**Files:**

- Modify: `server/src/repositories/face-person-verdict.repository.ts` (add method after `isFaceReachableInSpace`, which ends at `:896`)
- Test: `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts` (create)

**Interfaces:**

- Consumes: `spaceAssetPathBranches`, `reviewableAssetVisibility` — both already imported in this file.
- Produces: `FacePersonVerdictRepository.isFaceAssignableInSpace(spaceId: string, assetFaceId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing medium test**

Create `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts`. This mirrors the harness in `access-space-edit.repository.spec.ts:31-70` — read that file first for the fixture idiom.

```ts
/**
 * Medium tests for `FacePersonVerdictRepository.isFaceAssignableInSpace` — the data half
 * of the #734-follow-up authority rule (spec §3, §9.1).
 *
 * Rule: a face is assignable in space S if its asset is reachable through S by any of the
 * three paths, the face is live and visible, and the face does not belong to a person its
 * OWNER marked hidden.
 *
 * Deliberately NOT the #992 rule: there is no owner-is-member clause here (F-6). An editor
 * may name Carol's face even though Carol never joined the space, because nothing of
 * Carol's is written — only the space's own taxonomy.
 *
 * Discipline: every deny row below is mutation-proved non-vacuous. Each uses a fixture that
 * a GRANT row in the same block also uses, so a deny can only be explained by the specific
 * property under test.
 */
import { Kysely } from "kysely";
import { AuthDto } from "src/dtos/auth.dto";
import { AssetVisibility } from "src/enum";
import { DatabaseRepository } from "src/repositories/database.repository";
import { FaceIdentityRepository } from "src/repositories/face-identity.repository";
import { FacePersonVerdictRepository } from "src/repositories/face-person-verdict.repository";
import { LoggingRepository } from "src/repositories/logging.repository";
import { SharedSpaceRepository } from "src/repositories/shared-space.repository";
import { DB } from "src/schema";
import { BaseService } from "src/services/base.service";
import { SharedSpaceService } from "src/services/shared-space.service";
import { newMediumService } from "test/medium.factory";
import { getKyselyDB } from "test/utils";
import { beforeAll, describe, expect, it } from "vitest";
```

The `AuthDto`, `DatabaseRepository`, `FaceIdentityRepository` and `SharedSpaceService` imports are unused until Task 2 Step 5 adds the idempotence block. Add them now so Task 2 does not have to revisit the import list; ESLint's unused-import rule does not fire on type-only value imports referenced later in the same file, but if it does complain at Task 1, move these four lines into Task 2 Step 5 instead.

```ts
let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [FacePersonVerdictRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  return { ctx, verdictRepo: ctx.get(FacePersonVerdictRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/** Anna (Editor) + Bob (space Owner, asset owner) in one space. */
const newSpaceWithEditorAndMember = async (ctx: ReturnType<typeof setup>["ctx"]) => {
  const { user: anna } = await ctx.newUser();
  const { user: bob } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: bob.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: bob.id, role: "owner" });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: anna.id, role: "editor" });
  return { anna, bob, space };
};

type ReachPath = "direct" | "library" | "album";

const reachPathBuilders: Record<ReachPath, (ctx: ReturnType<typeof setup>["ctx"], args: { spaceId: string; ownerId: string }) => Promise<{ assetId: string }>> = {
  direct: async (ctx, { spaceId, ownerId }) => {
    const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId, assetId: asset.id });
    return { assetId: asset.id };
  },
  library: async (ctx, { spaceId, ownerId }) => {
    const { library } = await ctx.newLibrary({ ownerId });
    const { asset } = await ctx.newAsset({ ownerId, libraryId: library.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceLibrary({ spaceId, libraryId: library.id });
    return { assetId: asset.id };
  },
  album: async (ctx, { spaceId, ownerId }) => {
    const { result: album } = await ctx.newAlbum({ ownerId, albumName: "Face assign album" });
    const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId, albumId: album.id });
    return { assetId: asset.id };
  },
};

describe("isFaceAssignableInSpace", () => {
  // F-1, F-2, F-3: all three reach paths grant.
  describe.each<ReachPath>(["direct", "library", "album"])("reach path: %s", (path) => {
    it("grants for a face on a member-owned asset reachable by this path", async () => {
      const { ctx, verdictRepo } = setup();
      const { bob, space } = await newSpaceWithEditorAndMember(ctx);
      const { assetId } = await reachPathBuilders[path](ctx, { spaceId: space.id, ownerId: bob.id });
      const { result: faceId } = await ctx.newAssetFace({ assetId });

      await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(true);
    });
  });

  // F-6: the asset owner need NOT be a space member. This is the deliberate divergence
  // from #992's checkSpaceEditAccess, whose album arm requires owner-is-member.
  it("grants when the asset owner is NOT a space member (F-6)", async () => {
    const { ctx, verdictRepo } = setup();
    const { space } = await newSpaceWithEditorAndMember(ctx);
    const { user: carol } = await ctx.newUser();
    const { assetId } = await reachPathBuilders.album(ctx, { spaceId: space.id, ownerId: carol.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(true);
  });

  // F-7: reachability binds to the space asked about.
  it("denies when the asset is reachable only through a DIFFERENT space (F-7)", async () => {
    const { ctx, verdictRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: bob.id });
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: otherSpace.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    // Non-vacuous: the same fixture grants when asked about otherSpace.
    await expect(verdictRepo.isFaceAssignableInSpace(otherSpace.id, faceId)).resolves.toBe(true);
    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(false);
  });

  // F-9: the hidden-person exclusion at the WRITE. Its read-side twin is F-8 in Slice 3.
  it("denies a face belonging to a person the OWNER marked hidden (F-9)", async () => {
    const { ctx, verdictRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: person } = await ctx.newPerson({ ownerId: bob.id, isHidden: true });
    const { result: faceId } = await ctx.newAssetFace({ assetId, personId: person.id });

    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(false);

    // Non-vacuous: un-hide the same person and the same face becomes assignable.
    await defaultDatabase.updateTable("person").set({ isHidden: false }).where("id", "=", person.id).execute();
    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(true);
  });

  // F-10: asset-level gates, each mutation-proved.
  it.each([
    ["trashed", (db: Kysely<DB>, assetId: string) => db.updateTable("asset").set({ deletedAt: new Date() }).where("id", "=", assetId).execute()],
    ["offline", (db: Kysely<DB>, assetId: string) => db.updateTable("asset").set({ isOffline: true }).where("id", "=", assetId).execute()],
    ["hidden", (db: Kysely<DB>, assetId: string) => db.updateTable("asset").set({ visibility: AssetVisibility.Hidden }).where("id", "=", assetId).execute()],
    ["locked", (db: Kysely<DB>, assetId: string) => db.updateTable("asset").set({ visibility: AssetVisibility.Locked }).where("id", "=", assetId).execute()],
  ])("denies when the asset is %s (F-10)", async (_label, mutate) => {
    const { ctx, verdictRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    // Non-vacuous: granted before the mutation.
    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(true);
    await mutate(defaultDatabase, assetId);
    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(false);
  });

  // F-11: face-level gates.
  it.each([
    ["soft-deleted", { deletedAt: new Date(), isVisible: true }],
    ["not visible", { deletedAt: null, isVisible: false }],
  ])("denies when the face is %s (F-11)", async (_label, patch) => {
    const { ctx, verdictRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(true);
    await defaultDatabase.updateTable("asset_face").set(patch).where("id", "=", faceId).execute();
    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4`

Expected: FAIL — `verdictRepo.isFaceAssignableInSpace is not a function`.

If any test passes at this point, stop: the method already exists and this plan is stale.

- [ ] **Step 3: Implement the predicate**

Add to `server/src/repositories/face-person-verdict.repository.ts`, immediately after `isFaceReachableInSpace` (which closes at `:896`). Keep it a sibling rather than a parameter on the existing method — `isFaceReachableInSpace` has other callers whose semantics must not change.

```ts
  /**
   * "May an editor assign this face in this space?" — `isFaceReachableInSpace` plus the
   * hidden-person exclusion (spec §6.1).
   *
   * The exclusion is here, not at the call site, so the read (§6.1) and the write (§6.3)
   * cannot disagree: an editor must never be able to attach a face the list would not show
   * them by guessing its id (F-8/F-9).
   *
   * Scoped to the OWNER's `person.isHidden`. A space person's own `isHidden` is a separate
   * concern handled by the read's projection filter.
   */
  async isFaceAssignableInSpace(spaceId: string, assetFaceId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .leftJoin('person', 'person.id', 'asset_face.personId')
      .select('asset_face.id')
      .where('asset_face.id', '=', assetFaceId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', 'is', false)
      .where((eb) => reviewableAssetVisibility(eb))
      .where((eb) => eb.or([eb('person.id', 'is', null), eb('person.isHidden', '=', false)]))
      .where((eb) =>
        eb.or(
          spaceAssetPathBranches(eb as unknown as ExpressionBuilder<DB, keyof DB>, {
            correlateAssetId: 'asset.id',
            correlateLibraryId: 'asset.libraryId',
            scope: { spaceId },
          }),
        ),
      )
      .executeTakeFirst();
    return row !== undefined;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4`

Expected: PASS, all cases.

If the failure set differs between two runs, that is Postgres connection contention, not the code — re-run alone, then with `--no-file-parallelism`.

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/face-person-verdict.repository.ts server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts
git commit -m "feat(server): add isFaceAssignableInSpace, the space face-assign predicate

Reachability plus the owner-hidden-person exclusion, in one predicate so the
read (spec 6.1) and the write (6.3) cannot disagree. No owner-is-member clause:
unlike #992's checkSpaceEditAccess this writes nothing of the owner's, so an
editor may name a non-member's face (F-6).

Covers F-1, F-2, F-3, F-6, F-7, F-9, F-10, F-11."
```

---

### Task 2: The attach service method

**Files:**

- Modify: `server/src/services/shared-space.service.ts` (add after `confirmSpacePersonFaceSuggestion`, which ends at `:1455`)
- Test: `server/src/services/shared-space.service.spec.ts` (role gates), `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts` (idempotence)

**Interfaces:**

- Consumes: `this.requireRole(auth, spaceId, SharedSpaceRole.Editor)` (`:3487`), `this.requireSpacePersonInSpace(spaceId, personId)` (`:3495`), `FacePersonVerdictRepository.isFaceAssignableInSpace` (Task 1), `faceIdentityRepository.ensureSpacePersonIdentity(spacePersonId, db?)` (`face-identity.repository.ts:2291`), `faceIdentityRepository.replaceFaceIdentity(input, db?)` (`:2426`), `sharedSpaceRepository.addPersonFaces(values, options?, db?)` (`shared-space.repository.ts:2617`).
- Produces: `SharedSpaceService.attachFaceToSpacePerson(auth: AuthDto, spaceId: string, personId: string, assetFaceId: string): Promise<boolean>` — returns whether it acted.

- [ ] **Step 1: Write the failing role-gate unit tests**

Add to `server/src/services/shared-space.service.spec.ts`. Read the file's existing `confirmSpacePersonFaceSuggestion` describe block first and mirror its mocking idiom exactly.

```ts
describe("attachFaceToSpacePerson", () => {
  // F-4: a Viewer is refused. The fixture is otherwise identical to the F-5 grant below,
  // so this can only fail on the role gate.
  it("throws for a space Viewer (F-4)", async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as never);

    await expect(sut.attachFaceToSpacePerson(authStub.user1, "space-id", "person-id", "face-id")).rejects.toThrow(ForbiddenException);

    expect(mocks.sharedSpace.addPersonFaces).not.toHaveBeenCalled();
  });

  // F-5: a space Owner is granted — ROLE_HIERARCHY admits Owner as well as Editor, and
  // only Editor is otherwise exercised.
  it("permits a space Owner (F-5)", async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Owner } as never);
    mocks.sharedSpace.getPersonById.mockResolvedValue({ id: "person-id", spaceId: "space-id" } as never);
    mocks.facePersonVerdict.isFaceAssignableInSpace.mockResolvedValue(true);
    mocks.faceIdentity.ensureSpacePersonIdentity.mockResolvedValue({ id: "identity-id" } as never);

    await expect(sut.attachFaceToSpacePerson(authStub.user1, "space-id", "person-id", "face-id")).resolves.toBe(true);
  });

  // F-9 at the service boundary: an unassignable face is refused before any write.
  it("throws when the face is not assignable in this space", async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as never);
    mocks.sharedSpace.getPersonById.mockResolvedValue({ id: "person-id", spaceId: "space-id" } as never);
    mocks.facePersonVerdict.isFaceAssignableInSpace.mockResolvedValue(false);

    await expect(sut.attachFaceToSpacePerson(authStub.user1, "space-id", "person-id", "face-id")).rejects.toThrow(BadRequestException);

    expect(mocks.sharedSpace.addPersonFaces).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t attachFaceToSpacePerson`

Expected: FAIL — `sut.attachFaceToSpacePerson is not a function`.

- [ ] **Step 3: Implement the service method**

Add to `server/src/services/shared-space.service.ts` after `confirmSpacePersonFaceSuggestion`.

```ts
  /**
   * #734 follow-up (spec §6.3): attach a space person to a face directly — no pending ML
   * suggestion required, unlike `confirmSpacePersonFaceSuggestion` above.
   *
   * The transaction below is deliberately a near-copy of that method's. Slice 2 extracts the
   * shared `linkFaceToSpacePerson` helper and re-points both callers at it; do NOT anticipate
   * that here, or the extraction loses its regression proof.
   *
   * Idempotent: `addPersonFaces` is onConflict-doNothing and `replaceFaceIdentity` upserts, so
   * a double-submit is a no-op. Returns whether it acted, matching the S11 convention on the
   * sibling confirm/reject routes (a 200-vs-204 status signal is unreadable through
   * @oazapfts/runtime's ok()).
   */
  async attachFaceToSpacePerson(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
  ): Promise<boolean> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    const person = await this.requireSpacePersonInSpace(spaceId, personId);

    if (!(await this.facePersonVerdictRepository.isFaceAssignableInSpace(spaceId, assetFaceId))) {
      throw new BadRequestException('Face not found');
    }

    return this.databaseRepository.transaction(async (trx) => {
      const identity = await this.faceIdentityRepository.ensureSpacePersonIdentity(person.id, trx);
      await this.faceIdentityRepository.replaceFaceIdentity(
        { assetFaceId, identityId: identity.id, source: 'manual' },
        trx,
      );
      await this.facePersonVerdictRepository.resolveAssignedFace(assetFaceId, trx);
      await this.sharedSpaceRepository.addPersonFaces([{ personId: person.id, assetFaceId }], undefined, trx);
      return true;
    });
  }
```

The error message is deliberately `'Face not found'`, not "face is hidden": a caller who guessed the id of a hidden-person face must not be able to distinguish "hidden" from "does not exist".

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t attachFaceToSpacePerson`

Expected: PASS.

If `mocks.facePersonVerdict` does not exist, add `FacePersonVerdictRepository` to the spec's mock list — see `feedback_medium_factory_repo_registration` for the per-spec `real`/`mock` registration idiom.

- [ ] **Step 5: Add the idempotence medium test (F-14)**

Append to `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts`. This one needs the real service, so use a second `setup` that registers it.

```ts
describe("attach idempotence (F-14)", () => {
  it("a second identical attach is a no-op, with no duplicate projection row", async () => {
    const { ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [FacePersonVerdictRepository, SharedSpaceRepository, FaceIdentityRepository, DatabaseRepository],
      mock: [LoggingRepository],
    });
    const sut = ctx.get(SharedSpaceService);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const person = await ctx.get(SharedSpaceRepository).createPerson({ spaceId: space.id, name: "Aurelia" });

    const auth = { user: { id: anna.id } } as AuthDto;
    await sut.attachFaceToSpacePerson(auth, space.id, person.id, faceId);
    await sut.attachFaceToSpacePerson(auth, space.id, person.id, faceId);

    const rows = await defaultDatabase.selectFrom("shared_space_person_face").selectAll().where("assetFaceId", "=", faceId).execute();
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run the medium suite**

Run: `cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4`

Expected: PASS, all cases including F-14.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts
git commit -m "feat(server): attach a space person to a face directly

Composes requireRole(Editor), requireSpacePersonInSpace and the new
isFaceAssignableInSpace predicate, then runs the same transaction the
suggestion confirm runs. Inlined on purpose -- the shared helper is extracted
in slice 2, whose proof is that the existing confirm tests pass unchanged.

Covers F-4, F-5, F-14."
```

---

### Task 3: The controller route

**Files:**

- Modify: `server/src/controllers/shared-space.controller.ts` (add after the suggestion `dismiss` route, which ends around `:533`)
- Modify: `server/src/dtos/shared-space-person.dto.ts:68-70,105`

**Interfaces:**

- Consumes: `SharedSpaceService.attachFaceToSpacePerson` (Task 2), `FaceSuggestionActionResponseDto` from `src/dtos/person.dto.ts:269`.
- Produces: `PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId` → `{ acted: boolean }`.

- [ ] **Step 1: Add the param DTO**

The existing `SpacePersonFaceSuggestionParamsSchema` (`shared-space-person.dto.ts:68`) already has exactly the shape needed, but its name and its `assetFaceId` description both say "suggestion", which this route is not. Rename the base and alias the old name so the four suggestion routes keep compiling unchanged.

In `server/src/dtos/shared-space-person.dto.ts`, replace lines 68-70 with:

```ts
const SpacePersonFaceParamsSchema = SpacePersonParamsSchema.extend({
  assetFaceId: z.uuidv4().describe("Asset face ID"),
}).meta({ id: "SpacePersonFaceParamsDto" });

const SpacePersonFaceSuggestionParamsSchema = SpacePersonParamsSchema.extend({
  assetFaceId: z.uuidv4().describe("Unassigned asset face ID being reviewed"),
}).meta({ id: "SpacePersonFaceSuggestionParamsDto" });
```

and add beside line 105:

```ts
export class SpacePersonFaceParamsDto extends createZodDto(SpacePersonFaceParamsSchema) {}
```

Keep both schemas: they carry different `meta({ id })` values, and collapsing them renames a DTO in the generated clients, which is a breaking change for a slice that should have none.

- [ ] **Step 2: Write the failing controller test**

Add to `server/src/controllers/shared-space.controller.spec.ts` (create the describe if absent; mirror the file's existing route-test idiom).

```ts
describe("PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId", () => {
  it("requires authentication", async () => {
    const { status } = await request(ctx.getHttpServer()).put(`/shared-spaces/${factory.uuid()}/people/${factory.uuid()}/faces/${factory.uuid()}`);
    expect(status).toBe(401);
  });

  it("rejects a non-uuid assetFaceId", async () => {
    const { status } = await request(ctx.getHttpServer()).put(`/shared-spaces/${factory.uuid()}/people/${factory.uuid()}/faces/not-a-uuid`).set("Authorization", `Bearer ${factory.uuid()}`);
    expect(status).toBe(400);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd server && pnpm test -- --run src/controllers/shared-space.controller.spec.ts`

Expected: FAIL — the route 404s rather than 401/400.

- [ ] **Step 4: Add the route**

In `server/src/controllers/shared-space.controller.ts`, after the `dismiss` suggestion route:

```ts
  // Spec §6.3. The decorator carries the API-key SCOPE, matching the sibling writes; the real
  // authority (Editor role + face reachability) is enforced in the service.
  @Put(':id/people/:personId/faces/:assetFaceId')
  @Authenticated({ permission: Permission.SharedSpaceUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Assign a face to a person in a shared space',
    description:
      'Attach the face to the space person. Idempotent — the response reports whether it acted.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  async attachSpacePersonFace(
    @Auth() auth: AuthDto,
    @Param() { id, personId, assetFaceId }: SpacePersonFaceParamsDto,
  ): Promise<FaceSuggestionActionResponseDto> {
    return { acted: await this.service.attachFaceToSpacePerson(auth, id, personId, assetFaceId) };
  }
```

Add `SpacePersonFaceParamsDto` to the existing `src/dtos/shared-space-person.dto` import.

- [ ] **Step 5: Run to verify it passes**

Run: `cd server && pnpm test -- --run src/controllers/shared-space.controller.spec.ts`

Expected: PASS.

- [ ] **Step 6: Run the full slice gate**

All four must pass before committing:

```bash
cd server && pnpm check
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts src/controllers/shared-space.controller.spec.ts
cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4
cd server && pnpm lint && npx prettier --check "src/**/*.ts"
```

`pnpm lint` is ESLint only — prettier is a separate gate and has been missed four times in this repo. Run both.

- [ ] **Step 7: Commit**

```bash
git add server/src/controllers/shared-space.controller.ts server/src/controllers/shared-space.controller.spec.ts server/src/dtos/shared-space-person.dto.ts
git commit -m "feat(server): expose the space face-assign route

PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId, returning
{ acted } like its suggestion-confirm sibling.

Splits SpacePersonFaceParamsSchema out from the suggestion-specific one
rather than reusing it: both keep their own meta id, so no generated DTO is
renamed. OpenAPI regeneration is deferred to slice 9."
```

---

## Slice 1 Done When

- `PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId` attaches a space person to a face for an Owner/Editor and refuses a Viewer.
- F-1, F-2, F-3, F-4, F-5, F-6, F-7, F-9, F-10, F-11, F-14 all pass, every deny mutation-proved.
- `server/src/utils/access.ts`, `person.controller.ts` and `face.controller.ts` are untouched — verify with `git diff --name-only origin/main...HEAD | grep -E 'utils/access|person\.controller|face\.controller'` returning nothing.
- No OpenAPI or SQL regeneration has run.
