# Face Recognition Suggestions Phase 5b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose shared-space face suggestions through HTTP APIs with the correct shared-space RBAC matrix, idempotent confirm/dismiss actions, and identity-graph linking for confirmed candidate faces.

**Architecture:** Reuse the Phase 5a `person_face_suggestion` space-person rows and repository read filters. Add shared-space route DTOs and controller endpoints under `/shared-spaces/:id/people/:personId/face-suggestions`. Add `SharedSpaceService` methods that return empty pages to viewers, require editor-or-owner for mutations, validate the route person belongs to the route space, and confirm by linking the candidate face to the space person's `face_identity` without mutating `asset_face.personId` or asset ownership.

**Tech Stack:** NestJS controllers and decorators, `nestjs-zod` DTOs, Kysely repositories, Vitest unit tests, Vitest medium tests with testcontainers Postgres, generated OpenAPI, TypeScript SDK, Dart client, and `@immich/sql-tools` generated SQL.

**Design Reference:** `docs/plans/2026-05-16-face-recognition-suggestions-phase-5-design.md`.

**Phase 5b Scope:** HTTP API, DTOs, controller metadata, shared-space RBAC/service methods, idempotent confirm/dismiss, identity graph linking via `ensureSpacePersonIdentity` and `replaceFaceIdentity`, direct-POST stale candidate hardening, medium tests for API-visible edge cases, and generated OpenAPI/SDK/SQL artifacts. No web UI or E2E; those are Phase 5c.

**Design Review Result:** The approved design is directionally correct and consistent with Phases 1-5a. Two implementation details must be made explicit to keep the API safe under direct calls and races:

1. Confirm/dismiss must validate that `personId` belongs to `spaceId` before identity or suggestion mutations. Existing shared-space person update/delete/merge methods already use this pattern.
2. Confirm/dismiss must not mutate stale candidates hidden by the Phase 5a read-time filters, such as asset unshared, library unlinked, assigned face, disabled band, hidden person, pet person, unnamed person, or disabled space. Add a repository candidate guard that uses the same read-gate as `getPendingForSpacePerson`, and return 200 with no mutation when it is false. This preserves idempotency and covers stale UIs/direct POSTs for edge 21.

**Conventions for every task:** strict TDD. Write the failing test first, run it, verify the expected failure, implement the minimal code, rerun green, then commit. Run all commands from `/home/pierre/dev/gallery/.worktrees/face-recognition-suggestions`.

- Unit test: `cd server && pnpm test -- --run <file>`
- Medium test: `cd server && pnpm test:medium -- --run <file>`
- Type check: `make check-server`
- Generated SQL: run `make sql` after repository methods with `@GenerateSql`
- Generated clients: run `make open-api-typescript` and `make open-api-dart` after controller/DTO changes

---

### Task 1: Add shared-space face-suggestion route DTOs

**Files:**

- Modify: `server/src/dtos/shared-space-person.dto.ts`
- Modify: `server/src/dtos/person-face-suggestion.dto.spec.ts`

- [ ] **Step 1: Write failing DTO tests**

Append these tests to `server/src/dtos/person-face-suggestion.dto.spec.ts` and update the import to include the two shared-space DTOs:

```ts
import { SpacePersonFaceSuggestionParamsDto, SpacePersonParamsDto } from 'src/dtos/shared-space-person.dto';

it('space person params schema requires shared space and person UUIDs', () => {
  expect(() => SpacePersonParamsDto.schema.parse({ id: 'bad', personId: 'x' })).toThrow();

  expect(
    SpacePersonParamsDto.schema.parse({
      id: '00000000-0000-4000-8000-000000000011',
      personId: '00000000-0000-4000-8000-000000000012',
    }),
  ).toEqual({
    id: '00000000-0000-4000-8000-000000000011',
    personId: '00000000-0000-4000-8000-000000000012',
  });
});

it('space person face suggestion params schema requires assetFaceId UUID', () => {
  expect(() =>
    SpacePersonFaceSuggestionParamsDto.schema.parse({
      id: '00000000-0000-4000-8000-000000000011',
      personId: '00000000-0000-4000-8000-000000000012',
      assetFaceId: 'bad',
    }),
  ).toThrow();

  const parsed = SpacePersonFaceSuggestionParamsDto.schema.parse({
    id: '00000000-0000-4000-8000-000000000011',
    personId: '00000000-0000-4000-8000-000000000012',
    assetFaceId: '00000000-0000-4000-8000-000000000013',
  });
  expect(parsed.assetFaceId).toBe('00000000-0000-4000-8000-000000000013');
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd server && pnpm test -- --run src/dtos/person-face-suggestion.dto.spec.ts
```

Expected: FAIL because `SpacePersonParamsDto` and `SpacePersonFaceSuggestionParamsDto` do not exist.

- [ ] **Step 3: Implement DTOs**

Add these schemas near the other route parameter DTOs in `server/src/dtos/shared-space-person.dto.ts`:

```ts
const SpacePersonParamsSchema = z
  .object({
    id: z.uuidv4().describe('Shared space ID'),
    personId: z.uuidv4().describe('Shared-space person ID'),
  })
  .meta({ id: 'SpacePersonParamsDto' });

const SpacePersonFaceSuggestionParamsSchema = SpacePersonParamsSchema.extend({
  assetFaceId: z.uuidv4().describe('Unassigned asset face ID being reviewed'),
}).meta({ id: 'SpacePersonFaceSuggestionParamsDto' });
```

Export:

```ts
export class SpacePersonParamsDto extends createZodDto(SpacePersonParamsSchema) {}
export class SpacePersonFaceSuggestionParamsDto extends createZodDto(SpacePersonFaceSuggestionParamsSchema) {}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd server && pnpm test -- --run src/dtos/person-face-suggestion.dto.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/dtos/shared-space-person.dto.ts server/src/dtos/person-face-suggestion.dto.spec.ts
git commit -m "feat(server): add shared-space face suggestion DTOs"
```

### Task 2: Add a read-gated candidate guard for direct POSTs

**Files:**

- Modify: `server/src/repositories/person-face-suggestion.repository.ts`
- Modify: `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`

- [ ] **Step 1: Write failing repository tests**

Append these tests under `describe('space-person suggestion methods')` in `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`:

```ts
it('hasPendingForSpacePerson returns true only for currently readable pending candidates', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
    .returningAll()
    .executeTakeFirstOrThrow();
  await sut.upsertPendingForSpacePerson([{ spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 }]);

  await expect(
    sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.8,
    }),
  ).resolves.toBe(true);

  await expect(
    sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.5,
    }),
  ).resolves.toBe(false);
});

it('hasPendingForSpacePerson returns false after an asset is unshared', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
    .returningAll()
    .executeTakeFirstOrThrow();
  await sut.upsertPendingForSpacePerson([{ spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 }]);

  await ctx.database
    .deleteFrom('shared_space_asset')
    .where('spaceId', '=', space.id)
    .where('assetId', '=', asset.id)
    .execute();

  await expect(
    sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.8,
    }),
  ).resolves.toBe(false);
});

it('hasPendingForSpacePerson returns false for assigned candidate faces', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Owner person' });
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
    .returningAll()
    .executeTakeFirstOrThrow();
  await sut.upsertPendingForSpacePerson([{ spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 }]);

  await ctx.database.updateTable('asset_face').set({ personId: person.id }).where('id', '=', assetFace.id).execute();

  await expect(
    sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.8,
    }),
  ).resolves.toBe(false);
});

it('hasPendingForSpacePerson mirrors space-person scannability filters', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  const { space: disabledSpace } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: false });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const rows = await ctx.database
    .insertInto('shared_space_person')
    .values([
      { spaceId: space.id, name: '   ', type: 'person', isHidden: false },
      { spaceId: space.id, name: 'Hidden', type: 'person', isHidden: true },
      { spaceId: space.id, name: 'Pet', type: 'pet', isHidden: false },
      { spaceId: disabledSpace.id, name: 'Disabled', type: 'person', isHidden: false },
    ])
    .returningAll()
    .execute();

  for (const person of rows) {
    await sut.upsertPendingForSpacePerson([{ spacePersonId: person.id, assetFaceId: assetFace.id, distance: 0.6 }]);
    await expect(
      sut.hasPendingForSpacePerson(person.spaceId, person.id, assetFace.id, {
        maxDistance: 0.5,
        suggestionMaxDistance: 0.8,
      }),
    ).resolves.toBe(false);
  }
});

it('hasPendingForSpacePerson returns false after a linked library is unlinked', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { library } = await ctx.newLibrary({ ownerId: user.id });
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });
  const { asset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
    .returningAll()
    .executeTakeFirstOrThrow();
  await sut.upsertPendingForSpacePerson([{ spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 }]);

  await ctx.database
    .deleteFrom('shared_space_library')
    .where('spaceId', '=', space.id)
    .where('libraryId', '=', library.id)
    .execute();

  await expect(
    sut.hasPendingForSpacePerson(space.id, spacePerson.id, assetFace.id, {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.8,
    }),
  ).resolves.toBe(false);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
```

Expected: FAIL because `hasPendingForSpacePerson` does not exist.

- [ ] **Step 3: Implement the guard using the same read-gate as `getPendingForSpacePerson`**

Add this public method to `PersonFaceSuggestionRepository`:

```ts
@GenerateSql({
  params: [DummyValue.UUID, DummyValue.UUID, DummyValue.UUID, { maxDistance: 0.5, suggestionMaxDistance: 0.8 }],
})
async hasPendingForSpacePerson(
  spaceId: string,
  spacePersonId: string,
  assetFaceId: string,
  opts: { maxDistance: number; suggestionMaxDistance: number },
): Promise<boolean> {
  if (opts.suggestionMaxDistance <= opts.maxDistance) {
    return false;
  }

  const row = await this.db
    .selectFrom('person_face_suggestion as pfs')
    .innerJoin('shared_space_person as ssp', 'ssp.id', 'pfs.spacePersonId')
    .innerJoin('shared_space as ss', 'ss.id', 'ssp.spaceId')
    .innerJoin('asset_face as af', 'af.id', 'pfs.assetFaceId')
    .innerJoin('asset', 'asset.id', 'af.assetId')
    .select('pfs.assetFaceId')
    .where('pfs.spacePersonId', '=', spacePersonId)
    .where('pfs.assetFaceId', '=', assetFaceId)
    .where('pfs.status', '=', 'pending')
    .where('pfs.distance', '>', opts.maxDistance)
    .where('pfs.distance', '<=', opts.suggestionMaxDistance)
    .where('ssp.spaceId', '=', spaceId)
    .where(sql`BTRIM("ssp"."name")`, '<>', '')
    .where('ssp.isHidden', 'is', false)
    .where('ssp.type', '=', 'person')
    .where('ss.faceRecognitionEnabled', 'is', true)
    .where('af.personId', 'is', null)
    .where('af.deletedAt', 'is', null)
    .where('af.isVisible', 'is', true)
    .where('asset.deletedAt', 'is', null)
    .where('asset.isOffline', 'is', false)
    .where('asset.visibility', 'in', [AssetVisibility.Archive, AssetVisibility.Timeline])
    .where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom('shared_space_asset')
            .select('shared_space_asset.assetId')
            .whereRef('shared_space_asset.assetId', '=', 'asset.id')
            .where('shared_space_asset.spaceId', '=', spaceId),
        ),
        eb.exists(
          eb
            .selectFrom('shared_space_library')
            .select('shared_space_library.libraryId')
            .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
            .where('shared_space_library.spaceId', '=', spaceId),
        ),
      ]),
    )
    .executeTakeFirst();

  return !!row;
}
```

Keep this method semantically aligned with `getPendingForSpacePerson`. If the implementation extracts a private helper instead of duplicating the filters, keep both tests green and keep generated SQL readable.

- [ ] **Step 4: Run tests, generated SQL, and commit**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
make sql
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/repositories/person-face-suggestion.repository.ts server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts server/src/queries/person.face.suggestion.repository.sql
git commit -m "feat(server): guard space face suggestion actions"
```

### Task 3: Add shared-space service read API with viewer-empty behavior

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Modify: `server/src/services/shared-space.service.spec.ts`

- [ ] **Step 1: Write failing service tests for GET**

Append a new `describe('getSpacePersonFaceSuggestions')` near the personal/face route service tests in `server/src/services/shared-space.service.spec.ts`:

```ts
describe('getSpacePersonFaceSuggestions', () => {
  const enabled = {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  };

  it('returns an empty page for viewers and does not query suggestions (edge 24)', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Viewer }));
    mocks.systemMetadata.get.mockResolvedValue(enabled);

    const result = await sut.getSpacePersonFaceSuggestions(factory.auth(), 'space-1', 'space-person-1', {
      page: 1,
      size: 50,
    });

    expect(result).toEqual({ total: 0, items: [] });
    expect(mocks.personFaceSuggestion.getPendingForSpacePerson).not.toHaveBeenCalled();
  });

  it('throws for removed members before querying suggestions (edge 20)', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(void 0);

    await expect(
      sut.getSpacePersonFaceSuggestions(factory.auth(), 'space-1', 'space-person-1', { page: 1, size: 50 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.personFaceSuggestion.getPendingForSpacePerson).not.toHaveBeenCalled();
  });

  it('returns mapped pending suggestions for editors', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.personFaceSuggestion.getPendingForSpacePerson.mockResolvedValue({
      total: 1,
      items: [
        {
          assetFaceId: 'face-1',
          distance: 0.62,
          assetId: 'asset-1',
          imageWidth: 4000,
          imageHeight: 3000,
          boundingBoxX1: 10,
          boundingBoxX2: 110,
          boundingBoxY1: 20,
          boundingBoxY2: 140,
          fileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    const result = await sut.getSpacePersonFaceSuggestions(factory.auth(), 'space-1', 'space-person-1', {
      page: 2,
      size: 10,
    });

    expect(mocks.personFaceSuggestion.getPendingForSpacePerson).toHaveBeenCalledWith('space-1', 'space-person-1', {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.8,
      page: 2,
      size: 10,
    });
    expect(result).toEqual({
      total: 1,
      items: [
        {
          assetFaceId: 'face-1',
          assetId: 'asset-1',
          distance: 0.62,
          imageWidth: 4000,
          imageHeight: 3000,
          boundingBoxX1: 10,
          boundingBoxX2: 110,
          boundingBoxY1: 20,
          boundingBoxY2: 140,
          fileCreatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('passes disabled suggestion bands through so the repository read-gate returns empty (edge 29)', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Owner }));
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.5, minFaces: 3 } },
    });
    mocks.personFaceSuggestion.getPendingForSpacePerson.mockResolvedValue({ total: 0, items: [] });

    await expect(
      sut.getSpacePersonFaceSuggestions(factory.auth(), 'space-1', 'space-person-1', { page: 1, size: 50 }),
    ).resolves.toEqual({ total: 0, items: [] });
    expect(mocks.personFaceSuggestion.getPendingForSpacePerson).toHaveBeenCalledWith('space-1', 'space-person-1', {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.5,
      page: 1,
      size: 50,
    });
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
```

Expected: FAIL because `getSpacePersonFaceSuggestions` does not exist.

- [ ] **Step 3: Implement the read method**

Update imports in `server/src/services/shared-space.service.ts`:

```ts
import {
  PeopleFaceStatisticsResponseDto,
  PersonFacePageQueryDto,
  PersonFacePageResponseDto,
  PersonFaceSuggestionPageQueryDto,
  PersonFaceSuggestionPageResponseDto,
  PersonStatisticsResponseDto,
} from 'src/dtos/person.dto';
```

Add this method near `getSpacePersonFaces`:

```ts
async getSpacePersonFaceSuggestions(
  auth: AuthDto,
  spaceId: string,
  personId: string,
  dto: PersonFaceSuggestionPageQueryDto,
): Promise<PersonFaceSuggestionPageResponseDto> {
  const member = await this.requireMembership(auth, spaceId);
  if (ROLE_HIERARCHY[member.role as SharedSpaceRole] < ROLE_HIERARCHY[SharedSpaceRole.Editor]) {
    return { total: 0, items: [] };
  }

  const { machineLearning } = await this.getConfig({ withCache: false });
  const result = await this.personFaceSuggestionRepository.getPendingForSpacePerson(spaceId, personId, {
    maxDistance: machineLearning.facialRecognition.maxDistance,
    suggestionMaxDistance: machineLearning.facialRecognition.suggestionMaxDistance,
    page: dto.page,
    size: dto.size,
  });

  return {
    total: result.total,
    items: result.items.map((item) => ({
      assetFaceId: item.assetFaceId,
      assetId: item.assetId,
      distance: item.distance,
      imageWidth: item.imageWidth,
      imageHeight: item.imageHeight,
      boundingBoxX1: item.boundingBoxX1,
      boundingBoxX2: item.boundingBoxX2,
      boundingBoxY1: item.boundingBoxY1,
      boundingBoxY2: item.boundingBoxY2,
      fileCreatedAt: item.fileCreatedAt?.toISOString(),
    })),
  };
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(server): read space face suggestions"
```

### Task 4: Add confirm/dismiss service methods with identity linking

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Modify: `server/src/services/shared-space.service.spec.ts`

- [ ] **Step 1: Write failing service tests for confirm/dismiss**

Append these tests after the GET service tests:

```ts
describe('confirmSpacePersonFaceSuggestion', () => {
  const enabled = {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  };

  beforeEach(() => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.sharedSpace.getPersonById.mockResolvedValue(
      factory.sharedSpacePerson({ id: 'space-person-1', spaceId: 'space-1' }),
    );
    mocks.personFaceSuggestion.hasPendingForSpacePerson.mockResolvedValue(true);
    mocks.faceIdentity.ensureSpacePersonIdentity.mockResolvedValue({ id: 'space-identity-1' } as any);
  });

  it('denies viewers with no state change (edge 24 absence)', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Viewer }));

    await expect(
      sut.confirmSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.personFaceSuggestion.hasPendingForSpacePerson).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.ensureSpacePersonIdentity).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markConfirmedForSpacePerson).not.toHaveBeenCalled();
  });

  it('denies removed members with no state change (edge 20 absence)', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(void 0);

    await expect(
      sut.confirmSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.sharedSpace.getPersonById).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.hasPendingForSpacePerson).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.ensureSpacePersonIdentity).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markConfirmedForSpacePerson).not.toHaveBeenCalled();
  });

  it('rejects a person from another space before identity creation', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.sharedSpace.getPersonById.mockResolvedValue(
      factory.sharedSpacePerson({ id: 'space-person-1', spaceId: 'other-space' }),
    );

    await expect(
      sut.confirmSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.faceIdentity.ensureSpacePersonIdentity).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markConfirmedForSpacePerson).not.toHaveBeenCalled();
  });

  it('no-ops stale or unreadable candidates with no identity creation (edge 21 direct POST)', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.personFaceSuggestion.hasPendingForSpacePerson.mockResolvedValue(false);

    await expect(
      sut.confirmSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).resolves.toBeUndefined();
    expect(mocks.faceIdentity.ensureSpacePersonIdentity).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markConfirmedForSpacePerson).not.toHaveBeenCalled();
  });

  it('ensures identity, marks confirmed, replaces identity link, then resolves other pending rows', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.personFaceSuggestion.markConfirmedForSpacePerson.mockResolvedValue(1);

    await sut.confirmSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1');

    expect(mocks.personFaceSuggestion.hasPendingForSpacePerson).toHaveBeenCalledWith(
      'space-1',
      'space-person-1',
      'face-1',
      {
        maxDistance: 0.5,
        suggestionMaxDistance: 0.8,
      },
    );
    expect(mocks.faceIdentity.ensureSpacePersonIdentity).toHaveBeenCalledWith('space-person-1');
    expect(mocks.personFaceSuggestion.markConfirmedForSpacePerson).toHaveBeenCalledWith('space-person-1', 'face-1');
    expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
      assetFaceId: 'face-1',
      identityId: 'space-identity-1',
      source: 'manual',
    });
    expect(mocks.personFaceSuggestion.resolveAssignedFace).toHaveBeenCalledWith('face-1');

    expect(mocks.personFaceSuggestion.markConfirmedForSpacePerson.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.faceIdentity.replaceFaceIdentity.mock.invocationCallOrder[0],
    );
    expect(mocks.faceIdentity.replaceFaceIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.personFaceSuggestion.resolveAssignedFace.mock.invocationCallOrder[0],
    );
  });

  it('is idempotent when the row vanishes between guard and mark', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Owner }));
    mocks.personFaceSuggestion.markConfirmedForSpacePerson.mockResolvedValue(0);

    await expect(
      sut.confirmSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).resolves.toBeUndefined();
    expect(mocks.faceIdentity.ensureSpacePersonIdentity).toHaveBeenCalledWith('space-person-1');
    expect(mocks.faceIdentity.replaceFaceIdentity).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.resolveAssignedFace).not.toHaveBeenCalled();
  });
});

describe('dismissSpacePersonFaceSuggestion', () => {
  const enabled = {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  };

  beforeEach(() => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.sharedSpace.getPersonById.mockResolvedValue(
      factory.sharedSpacePerson({ id: 'space-person-1', spaceId: 'space-1' }),
    );
    mocks.personFaceSuggestion.hasPendingForSpacePerson.mockResolvedValue(true);
  });

  it('denies viewers with no state change (edge 24 absence)', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Viewer }));

    await expect(
      sut.dismissSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.personFaceSuggestion.markDismissedForSpacePerson).not.toHaveBeenCalled();
  });

  it('denies removed members with no state change (edge 20 absence)', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(void 0);

    await expect(
      sut.dismissSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.sharedSpace.getPersonById).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.hasPendingForSpacePerson).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.markDismissedForSpacePerson).not.toHaveBeenCalled();
  });

  it('no-ops stale or already-resolved candidates', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.personFaceSuggestion.hasPendingForSpacePerson.mockResolvedValue(false);

    await expect(
      sut.dismissSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).resolves.toBeUndefined();
    expect(mocks.personFaceSuggestion.markDismissedForSpacePerson).not.toHaveBeenCalled();
  });

  it('marks the candidate dismissed without touching identity links or other suggestions', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(makeMemberResult({ role: SharedSpaceRole.Editor }));
    mocks.personFaceSuggestion.markDismissedForSpacePerson.mockResolvedValue(1);

    await expect(
      sut.dismissSpacePersonFaceSuggestion(factory.auth(), 'space-1', 'space-person-1', 'face-1'),
    ).resolves.toBeUndefined();
    expect(mocks.personFaceSuggestion.markDismissedForSpacePerson).toHaveBeenCalledWith('space-person-1', 'face-1');
    expect(mocks.faceIdentity.ensureSpacePersonIdentity).not.toHaveBeenCalled();
    expect(mocks.faceIdentity.replaceFaceIdentity).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.resolveAssignedFace).not.toHaveBeenCalled();
  });
});
```

If the strict TypeScript mock type does not expose `hasPendingForSpacePerson` or `ensureSpacePersonIdentity`, add the mock methods in `server/test/utils.ts` only if automock does not pick up the repository method after Task 2.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
```

Expected: FAIL because `confirmSpacePersonFaceSuggestion` and `dismissSpacePersonFaceSuggestion` do not exist.

- [ ] **Step 3: Implement service helpers and actions**

Add a private route-person helper near `requireRole` or near the methods that use it:

```ts
private async requireSpacePersonInSpace(spaceId: string, personId: string): Promise<SharedSpacePerson> {
  const person = await this.sharedSpaceRepository.getPersonById(personId);
  if (!person || person.spaceId !== spaceId) {
    throw new BadRequestException('Person not found');
  }
  return person;
}
```

Add a private config helper if it keeps both actions concise:

```ts
private async getFaceSuggestionDistanceConfig() {
  const { machineLearning } = await this.getConfig({ withCache: false });
  return {
    maxDistance: machineLearning.facialRecognition.maxDistance,
    suggestionMaxDistance: machineLearning.facialRecognition.suggestionMaxDistance,
  };
}
```

Add the actions:

```ts
async confirmSpacePersonFaceSuggestion(
  auth: AuthDto,
  spaceId: string,
  personId: string,
  assetFaceId: string,
): Promise<void> {
  await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
  const person = await this.requireSpacePersonInSpace(spaceId, personId);
  const distanceConfig = await this.getFaceSuggestionDistanceConfig();
  const isPending = await this.personFaceSuggestionRepository.hasPendingForSpacePerson(
    spaceId,
    person.id,
    assetFaceId,
    distanceConfig,
  );
  if (!isPending) {
    return;
  }

  const identity = await this.faceIdentityRepository.ensureSpacePersonIdentity(person.id);
  const updated = await this.personFaceSuggestionRepository.markConfirmedForSpacePerson(person.id, assetFaceId);
  if (updated === 0) {
    return;
  }

  await this.faceIdentityRepository.replaceFaceIdentity({
    assetFaceId,
    identityId: identity.id,
    source: 'manual',
  });
  await this.personFaceSuggestionRepository.resolveAssignedFace(assetFaceId);
}

async dismissSpacePersonFaceSuggestion(
  auth: AuthDto,
  spaceId: string,
  personId: string,
  assetFaceId: string,
): Promise<void> {
  await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
  const person = await this.requireSpacePersonInSpace(spaceId, personId);
  const distanceConfig = await this.getFaceSuggestionDistanceConfig();
  const isPending = await this.personFaceSuggestionRepository.hasPendingForSpacePerson(
    spaceId,
    person.id,
    assetFaceId,
    distanceConfig,
  );
  if (!isPending) {
    return;
  }

  await this.personFaceSuggestionRepository.markDismissedForSpacePerson(person.id, assetFaceId);
}
```

Confirm order is intentional: route role and person validation first, stale candidate no-op before identity creation, then `ensureSpacePersonIdentity`, then `markConfirmedForSpacePerson`, then `replaceFaceIdentity`, then `resolveAssignedFace`.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts server/test/utils.ts
git commit -m "feat(server): confirm space face suggestions"
```

If `server/test/utils.ts` was not changed, omit it from `git add`.

### Task 5: Add shared-space controller routes

**Files:**

- Modify: `server/src/controllers/shared-space.controller.ts`
- Modify: `server/src/controllers/shared-space.controller.spec.ts`

- [ ] **Step 1: Write failing controller tests**

Append this describe block to `server/src/controllers/shared-space.controller.spec.ts`:

```ts
describe('space person face suggestion routes', () => {
  it('GET should require shared-space read permission and call the service', async () => {
    const spaceId = factory.uuid();
    const personId = factory.uuid();
    service.getSpacePersonFaceSuggestions.mockResolvedValue({
      total: 1,
      items: [
        {
          assetFaceId: factory.uuid(),
          assetId: factory.uuid(),
          distance: 0.62,
          imageWidth: 4000,
          imageHeight: 3000,
          boundingBoxX1: 10,
          boundingBoxX2: 110,
          boundingBoxY1: 20,
          boundingBoxY2: 140,
          fileCreatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const { status, body } = await request(ctx.getHttpServer())
      .get(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions`)
      .query({ page: '2', size: '10' });

    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission: Permission.SharedSpaceRead }),
      }),
    );
    expect(status).toBe(200);
    expect(service.getSpacePersonFaceSuggestions).toHaveBeenCalledWith(undefined, spaceId, personId, {
      page: 2,
      size: 10,
    });
    expect(body.total).toBe(1);
  });

  it('GET should validate route and query DTOs', async () => {
    const { status, body } = await request(ctx.getHttpServer()).get(
      '/shared-spaces/not-a-uuid/people/also-bad/face-suggestions?size=101',
    );

    expect(status).toBe(400);
    expect(body.message).toEqual(
      expect.arrayContaining([
        '[id] Invalid UUID',
        '[personId] Invalid UUID',
        '[size] Too big: expected number to be <=100',
      ]),
    );
  });

  it('POST confirm should require shared-space update permission and return 200', async () => {
    const spaceId = factory.uuid();
    const personId = factory.uuid();
    const assetFaceId = factory.uuid();

    const { status } = await request(ctx.getHttpServer()).post(
      `/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/confirm`,
    );

    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
      }),
    );
    expect(status).toBe(200);
    expect(service.confirmSpacePersonFaceSuggestion).toHaveBeenCalledWith(undefined, spaceId, personId, assetFaceId);
  });

  it('POST dismiss should require shared-space update permission and return 200', async () => {
    const spaceId = factory.uuid();
    const personId = factory.uuid();
    const assetFaceId = factory.uuid();

    const { status } = await request(ctx.getHttpServer()).post(
      `/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/dismiss`,
    );

    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
      }),
    );
    expect(status).toBe(200);
    expect(service.dismissSpacePersonFaceSuggestion).toHaveBeenCalledWith(undefined, spaceId, personId, assetFaceId);
  });
});
```

Add `Permission` to the spec imports from `src/enum` if it is not already imported.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd server && pnpm test -- --run src/controllers/shared-space.controller.spec.ts
```

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement controller endpoints**

Update imports in `server/src/controllers/shared-space.controller.ts`:

```ts
import {
  PeopleFaceStatisticsResponseDto,
  PersonFacePageQueryDto,
  PersonFacePageResponseDto,
  PersonFaceSuggestionPageQueryDto,
  PersonFaceSuggestionPageResponseDto,
  PersonStatisticsResponseDto,
} from 'src/dtos/person.dto';
import {
  SharedSpacePeopleStatisticsResponseDto,
  SharedSpacePersonAliasDto,
  SharedSpacePersonMergeDto,
  SharedSpacePersonResponseDto,
  SharedSpacePersonUpdateDto,
  SpacePersonFaceSuggestionParamsDto,
  SpacePersonParamsDto,
  SpacePeopleQueryDto,
  SpaceRepresentativeFaceUpdateDto,
} from 'src/dtos/shared-space-person.dto';
```

Add these routes before `@Get(':id/people/:personId')`:

```ts
@Get(':id/people/:personId/face-suggestions')
@Authenticated({ permission: Permission.SharedSpaceRead })
@Endpoint({
  summary: 'Get space person face suggestions',
  description: 'Retrieve pending unassigned face suggestions for a person in a shared space.',
  history: new HistoryBuilder().added('v2').beta('v2'),
})
getSpacePersonFaceSuggestions(
  @Auth() auth: AuthDto,
  @Param() { id, personId }: SpacePersonParamsDto,
  @Query() dto: PersonFaceSuggestionPageQueryDto,
): Promise<PersonFaceSuggestionPageResponseDto> {
  return this.service.getSpacePersonFaceSuggestions(auth, id, personId, dto);
}

@Post(':id/people/:personId/face-suggestions/:assetFaceId/confirm')
@Authenticated({ permission: Permission.SharedSpaceUpdate })
@HttpCode(HttpStatus.OK)
@Endpoint({
  summary: 'Confirm a space person face suggestion',
  description: 'Link the suggested face to the shared-space person identity. Idempotent.',
  history: new HistoryBuilder().added('v2').beta('v2'),
})
confirmSpacePersonFaceSuggestion(
  @Auth() auth: AuthDto,
  @Param() { id, personId, assetFaceId }: SpacePersonFaceSuggestionParamsDto,
): Promise<void> {
  return this.service.confirmSpacePersonFaceSuggestion(auth, id, personId, assetFaceId);
}

@Post(':id/people/:personId/face-suggestions/:assetFaceId/dismiss')
@Authenticated({ permission: Permission.SharedSpaceUpdate })
@HttpCode(HttpStatus.OK)
@Endpoint({
  summary: 'Dismiss a space person face suggestion',
  description: 'Suppress this suggestion for the shared-space person. The face stays unassigned. Idempotent.',
  history: new HistoryBuilder().added('v2').beta('v2'),
})
dismissSpacePersonFaceSuggestion(
  @Auth() auth: AuthDto,
  @Param() { id, personId, assetFaceId }: SpacePersonFaceSuggestionParamsDto,
): Promise<void> {
  return this.service.dismissSpacePersonFaceSuggestion(auth, id, personId, assetFaceId);
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd server && pnpm test -- --run src/controllers/shared-space.controller.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/controllers/shared-space.controller.ts server/src/controllers/shared-space.controller.spec.ts
git commit -m "feat(server): add space face suggestion routes"
```

### Task 6: Add medium tests for RBAC and identity-graph edge cases

**TDD ordering:** write and run this task's medium tests immediately after Task 2, before implementing Task 4. The tests should be RED because the service methods do not exist yet. Keep the task here in the document because it is the integration coverage checkpoint, but do not defer writing these tests until after the service implementation when executing strictly.

**Files:**

- Create: `server/test/medium/specs/services/shared-space-face-suggestions.service.spec.ts`

- [ ] **Step 1: Create the failing medium test file**

Create `server/test/medium/specs/services/shared-space-face-suggestions.service.spec.ts` with this setup:

```ts
import { Kysely } from 'kysely';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AssetVisibility, SharedSpaceRole } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonFaceSuggestionRepository } from 'src/repositories/person-face-suggestion.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const setup = (db?: Kysely<DB>) =>
  newMediumService(SharedSpaceService, {
    database: db || defaultDatabase,
    real: [
      SharedSpaceRepository,
      PersonFaceSuggestionRepository,
      FaceIdentityRepository,
      ConfigRepository,
      SystemMetadataRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });

const authFor = (user: { id: string; name: string; email: string; isAdmin?: boolean }) =>
  factory.auth({ user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin } });

const createSuggestionFixture = async (
  ctx: ReturnType<typeof setup>['ctx'],
  input: { reviewerRole?: SharedSpaceRole; faceRecognitionEnabled?: boolean } = {},
) => {
  const { user: owner } = await ctx.newUser();
  const { user: reviewer } = await ctx.newUser();
  const { user: assetOwner } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({
    createdById: owner.id,
    faceRecognitionEnabled: input.faceRecognitionEnabled ?? true,
  });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({
    spaceId: space.id,
    userId: reviewer.id,
    role: input.reviewerRole ?? SharedSpaceRole.Editor,
  });
  const { asset } = await ctx.newAsset({ ownerId: assetOwner.id, visibility: AssetVisibility.Timeline });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false, identityId: null })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('person_face_suggestion')
    .values({ spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 })
    .execute();

  return { owner, reviewer, assetOwner, space, asset, assetFace, spacePerson };
};
```

Add these tests:

```ts
describe('SharedSpaceService space face suggestions', () => {
  it('returns suggestions to editors and an empty page to viewers (edge 24)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx, { reviewerRole: SharedSpaceRole.Viewer });

    await expect(
      sut.getSpacePersonFaceSuggestions(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, { page: 1, size: 50 }),
    ).resolves.toEqual({ total: 0, items: [] });

    await ctx.database
      .updateTable('shared_space_member')
      .set({ role: SharedSpaceRole.Editor })
      .where('spaceId', '=', fx.space.id)
      .where('userId', '=', fx.reviewer.id)
      .execute();

    const result = await sut.getSpacePersonFaceSuggestions(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, {
      page: 1,
      size: 50,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ assetFaceId: fx.assetFace.id, assetId: fx.asset.id }));
  });

  it('denies viewer confirm/dismiss without mutating rows (edge 24 absence)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx, { reviewerRole: SharedSpaceRole.Viewer });

    await expect(
      sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      sut.dismissSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const row = await ctx.database
      .selectFrom('person_face_suggestion')
      .select(['status'])
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
  });

  it('rejects a route person from another space with no identity mutation', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: fx.owner.id, faceRecognitionEnabled: true });

    await expect(
      sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), otherSpace.id, fx.spacePerson.id, fx.assetFace.id),
    ).rejects.toBeInstanceOf(BadRequestException);

    const person = await ctx.database
      .selectFrom('shared_space_person')
      .select(['identityId'])
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    expect(person.identityId).toBeNull();
  });

  it('confirm creates a missing space identity, links the candidate face, and keeps asset_face ownership unchanged (edges 26 and 31)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const person = await ctx.database
      .selectFrom('shared_space_person')
      .select(['identityId'])
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    expect(person.identityId).toEqual(expect.any(String));

    const link = await ctx.database
      .selectFrom('face_identity_face')
      .select(['identityId', 'source'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(link).toEqual({ identityId: person.identityId!, source: 'manual' });

    const face = await ctx.database
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select(['asset_face.personId', 'asset.ownerId'])
      .where('asset_face.id', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(face.personId).toBeNull();
    expect(face.ownerId).toBe(fx.assetOwner.id);
  });

  it('confirm clears other pending personal and space suggestions for the same face (edge 28)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    const { person } = await ctx.newPerson({ ownerId: fx.assetOwner.id, name: 'Personal Alice' });
    await ctx.database
      .insertInto('person_face_suggestion')
      .values({ personId: person.id, assetFaceId: fx.assetFace.id, distance: 0.61 })
      .execute();
    const otherSpacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: fx.space.id, name: 'Other Alice', type: 'person', isHidden: false })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('person_face_suggestion')
      .values({ spacePersonId: otherSpacePerson.id, assetFaceId: fx.assetFace.id, distance: 0.62 })
      .execute();

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const rows = await ctx.database
      .selectFrom('person_face_suggestion')
      .select(['personId', 'spacePersonId', 'status'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .execute();
    expect(rows).toEqual([expect.objectContaining({ spacePersonId: fx.spacePerson.id, status: 'confirmed' })]);
  });

  it('confirm overwrites an existing face identity link (edge 32)', async () => {
    const { ctx, sut } = setup();
    const faceIdentityRepository = ctx.get(FaceIdentityRepository);
    const fx = await createSuggestionFixture(ctx);
    const { person: oldPerson } = await ctx.newPerson({ ownerId: fx.assetOwner.id, name: 'Old' });
    const oldIdentity = await faceIdentityRepository.ensurePersonIdentity(oldPerson.id);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: fx.assetFace.id,
      identityId: oldIdentity.id,
      source: 'manual',
    });
    const otherSpacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: fx.space.id, name: 'Other Candidate', type: 'person', isHidden: false })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('person_face_suggestion')
      .values({ spacePersonId: otherSpacePerson.id, assetFaceId: fx.assetFace.id, distance: 0.62 })
      .execute();

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const spacePerson = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    const link = await ctx.database
      .selectFrom('face_identity_face')
      .select(['identityId', 'source'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(link).toEqual({ identityId: spacePerson.identityId!, source: 'manual' });
    const rows = await ctx.database
      .selectFrom('person_face_suggestion')
      .select(['spacePersonId', 'status'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .execute();
    expect(rows).toEqual([expect.objectContaining({ spacePersonId: fx.spacePerson.id, status: 'confirmed' })]);
  });

  it('confirm and dismiss no-op stale unshared candidates (edge 21)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    await ctx.database
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', fx.space.id)
      .where('assetId', '=', fx.asset.id)
      .execute();

    await expect(
      sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).resolves.toBeUndefined();
    await expect(
      sut.dismissSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).resolves.toBeUndefined();

    const person = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    const row = await ctx.database
      .selectFrom('person_face_suggestion')
      .select('status')
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(person.identityId).toBeNull();
    expect(row.status).toBe('pending');
  });

  it('dismiss marks only the target suggestion and leaves identity graph unchanged', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);

    await sut.dismissSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const row = await ctx.database
      .selectFrom('person_face_suggestion')
      .select('status')
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    const link = await ctx.database
      .selectFrom('face_identity_face')
      .select('assetFaceId')
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirst();
    expect(row.status).toBe('dismissed');
    expect(link).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and verify RED before Task 4 is implemented**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-face-suggestions.service.spec.ts
```

Expected before implementation: FAIL because `getSpacePersonFaceSuggestions`, `confirmSpacePersonFaceSuggestion`, and `dismissSpacePersonFaceSuggestion` do not exist yet. Expected after Tasks 2-4: PASS or reveal integration gaps.

- [ ] **Step 3: Fix only integration gaps found by the medium tests**

Likely fixes, if any:

- Add missing repository to the medium `real` list.
- Adjust fixture inserts to match generated schema defaults.
- If a stale candidate mutates, fix service ordering so `hasPendingForSpacePerson` runs before `ensureSpacePersonIdentity` and before status updates.
- If cross-member confirm changes `asset_face.personId`, remove any call that reassigns faces; Phase 5b confirm must only write `face_identity_face`.

- [ ] **Step 4: Run medium tests and commit**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-face-suggestions.service.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/test/medium/specs/services/shared-space-face-suggestions.service.spec.ts server/src/services/shared-space.service.ts server/src/repositories/person-face-suggestion.repository.ts
git commit -m "test(server): cover space face suggestion review edges"
```

If only the new test file changed in this task, commit only that file.

### Task 7: Regenerate OpenAPI, SDKs, SQL, and run final verification

**Files:**

- Generated: `open-api/immich-openapi-specs.json`
- Generated: `open-api/typescript-sdk/**`
- Generated: `mobile/openapi/**`
- Generated: `server/src/queries/person.face.suggestion.repository.sql`
- Any generated files reported by `git status --short`

- [ ] **Step 1: Regenerate generated artifacts**

Run:

```bash
make sql
make open-api-typescript
make open-api-dart
```

Expected: PASS. Do not hand-edit generated files.

- [ ] **Step 2: Run targeted regression tests**

Run:

```bash
cd server && pnpm test -- --run src/dtos/person-face-suggestion.dto.spec.ts
cd server && pnpm test -- --run src/controllers/shared-space.controller.spec.ts
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-face-suggestions.service.spec.ts
make check-server
```

Expected: PASS.

- [ ] **Step 3: Run a coverage audit against Phase 5 edge cases**

Verify the following mapping before final commit:

- Edge 20: removed/non-member read or mutate -> service unit test throws `ForbiddenException`; no repository mutation.
- Edge 21: unshared asset/library unlinked -> repository read-gate covered in Phase 5a; direct confirm/dismiss no-op covered in Phase 5b medium test.
- Edge 22: merge handling -> covered by Phase 5a merge/resolve tests.
- Edge 23: unnamed, whitespace, hidden, inherited-name loss -> covered by Phase 5a repository read-gate tests.
- Edge 24: viewer GET empty, confirm/dismiss 403, absence asserted -> service unit and medium tests.
- Edge 25: `faceRecognitionEnabled = false` -> covered by Phase 5a scan/read-gate tests.
- Edge 26: candidate owned by another member -> Phase 5b medium test asserts `asset_face.personId` and asset owner unchanged.
- Edge 27: pet -> covered by Phase 5a scan/read-gate tests.
- Edge 28: same candidate suggested elsewhere -> Phase 5b medium test asserts other pending rows are cleared.
- Edge 29: disabled band -> service unit passes config, Phase 5a repository read-gate returns empty.
- Edge 30: zero linked faces/no embeddings -> Phase 5a scan no-op tests.
- Edge 31: `identityId = NULL` -> Phase 5b medium confirm creates/back-links identity.
- Edge 32: existing face identity link -> Phase 5b medium confirm overwrites via `replaceFaceIdentity` and clears the other pending row for the same face.

- [ ] **Step 4: Inspect generated API names**

Run:

```bash
rg -n "SpacePersonFaceSuggestion|spacePersonFaceSuggestion|face-suggestions" open-api/immich-openapi-specs.json open-api/typescript-sdk mobile/openapi
```

Expected: generated clients expose the three shared-space endpoints and keep the personal endpoints unchanged.

- [ ] **Step 5: Commit generated artifacts**

Run:

```bash
git status --short
git add open-api/immich-openapi-specs.json open-api/typescript-sdk mobile/openapi server/src/queries/person.face.suggestion.repository.sql
git commit -m "chore(api): regenerate space face suggestion clients"
```

If `git status --short` reports additional generated files from the commands above, add them to the same commit. If no generated files changed, skip this commit and mention that in the handoff.

- [ ] **Step 6: Final branch check**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: clean working tree except intentionally untracked local files, with Phase 5b commits on top of Phase 5a.
