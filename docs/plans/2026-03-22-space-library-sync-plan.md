# Space-Library Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow admins to link external libraries to shared spaces so library assets appear in the space via query-through (no sync jobs).

**Architecture:** New `shared_space_library` junction table with composite PK `(spaceId, libraryId)`. Space asset queries UNION manual assets from `shared_space_asset` with library assets resolved via `shared_space_library` JOIN `asset`. Face matching uses an orchestrator job on link creation and per-asset jobs on ongoing library scans.

**Tech Stack:** NestJS, Kysely, PostgreSQL, Vitest, BullMQ

---

### Task 1: Schema — Create `shared_space_library` table

**Files:**

- Create: `server/src/schema/tables/shared-space-library.table.ts`
- Modify: `server/src/schema/index.ts` (add import, register in tables array and DB interface)

**Step 1: Create the table schema file**

Create `server/src/schema/tables/shared-space-library.table.ts`:

```typescript
import { CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { LibraryTable } from 'src/schema/tables/library.table';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('shared_space_library')
export class SharedSpaceLibraryTable {
  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', primary: true, index: false })
  spaceId!: string;

  @ForeignKeyColumn(() => LibraryTable, { onDelete: 'CASCADE', primary: true })
  libraryId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true })
  addedById!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
```

**Step 2: Register in schema index**

In `server/src/schema/index.ts`:

- Add import after line 64 (after `SharedSpaceAssetTable`):
  ```typescript
  import { SharedSpaceLibraryTable } from 'src/schema/tables/shared-space-library.table';
  ```
- Add to tables array after `SharedSpaceAssetTable` (after line 133):
  ```typescript
  SharedSpaceLibraryTable,
  ```
- Add to DB interface after `shared_space_asset` (after line 255):
  ```typescript
  shared_space_library: SharedSpaceLibraryTable;
  ```

**Step 3: Generate migration**

```bash
cd server && pnpm migrations:generate
```

This auto-generates a migration file in `server/src/schema/migrations/`. Verify it creates the `shared_space_library` table with the correct columns and foreign keys.

**Step 4: Commit**

```bash
git add server/src/schema/tables/shared-space-library.table.ts server/src/schema/index.ts server/src/schema/migrations/
git commit -m "feat(schema): add shared_space_library table"
```

---

### Task 2: Factory — Add `sharedSpaceLibrary` test factory

**Files:**

- Modify: `server/test/small.factory.ts`

**Step 1: Add the factory**

In `server/test/small.factory.ts`, add the factory function after `sharedSpacePersonAliasFactory` (around line 451):

```typescript
const sharedSpaceLibraryFactory = (data: Partial<SharedSpaceLibrary> = {}): SharedSpaceLibrary => ({
  spaceId: newUuid(),
  libraryId: newUuid(),
  addedById: newUuid(),
  createdAt: newDate(),
  ...data,
});
```

Add the `SharedSpaceLibrary` type to the imports from the DB types at the top of the file.

Add to the `factory` export object after `sharedSpacePersonAlias` (around line 515):

```typescript
sharedSpaceLibrary: sharedSpaceLibraryFactory,
```

**Step 2: Commit**

```bash
git add server/test/small.factory.ts
git commit -m "test: add sharedSpaceLibrary test factory"
```

---

### Task 3: Enum — Add `SharedSpaceLibraryFaceSync` job name and permission

**Files:**

- Modify: `server/src/enum.ts`

**Step 1: Add job name**

In `server/src/enum.ts`, add after `SharedSpacePersonThumbnail` (line 715):

```typescript
SharedSpaceLibraryFaceSync = 'SharedSpaceLibraryFaceSync',
```

**Step 2: Add permission**

Add after `SharedSpaceAssetDelete` (line 220):

```typescript
SharedSpaceLibraryCreate = 'sharedSpaceLibrary.create',
SharedSpaceLibraryDelete = 'sharedSpaceLibrary.delete',
```

**Step 3: Commit**

```bash
git add server/src/enum.ts
git commit -m "feat(enum): add SharedSpaceLibraryFaceSync job and library permissions"
```

---

### Task 4: Repository — Add library link CRUD methods

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`
- Test: `server/src/services/shared-space.service.spec.ts` (tested indirectly via service tests in later tasks)

**Step 1: Add repository methods**

In `server/src/repositories/shared-space.repository.ts`, add the following methods:

```typescript
addLibrary(values: Insertable<SharedSpaceLibraryTable>) {
  return this.db
    .insertInto('shared_space_library')
    .values(values)
    .onConflict((oc) => oc.doNothing())
    .returningAll()
    .executeTakeFirst();
}

@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
removeLibrary(spaceId: string, libraryId: string) {
  return this.db
    .deleteFrom('shared_space_library')
    .where('spaceId', '=', spaceId)
    .where('libraryId', '=', libraryId)
    .execute();
}

@GenerateSql({ params: [DummyValue.UUID] })
getLinkedLibraries(spaceId: string) {
  return this.db
    .selectFrom('shared_space_library')
    .selectAll()
    .where('spaceId', '=', spaceId)
    .execute();
}

@GenerateSql({ params: [DummyValue.UUID] })
getSpacesLinkedToLibrary(libraryId: string) {
  return this.db
    .selectFrom('shared_space_library')
    .innerJoin('shared_space', 'shared_space.id', 'shared_space_library.spaceId')
    .selectAll('shared_space_library')
    .select('shared_space.faceRecognitionEnabled')
    .where('shared_space_library.libraryId', '=', libraryId)
    .execute();
}
```

Add the `SharedSpaceLibraryTable` import from `src/schema/tables/shared-space-library.table` and `Insertable` from kysely if not already imported.

**Step 2: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts
git commit -m "feat(repo): add shared_space_library CRUD methods"
```

---

### Task 5: Repository — Update asset queries to UNION library assets

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` — `getAssetCount`, `getRecentAssets`, `getNewAssetCount`

**Step 1: Write failing tests for getAssetCount**

In `server/src/services/shared-space.service.spec.ts`, add tests that verify the service returns counts including library assets. These will fail until the repository queries are updated.

```typescript
describe('getAssetCount with linked libraries', () => {
  it('should include library assets in count', async () => {
    // Setup: space with a linked library
    // Mock getAssetCount to verify it's called
    // The actual UNION logic is in the repository SQL
  });
});
```

Note: Since repository queries are SQL-level, the real test is in medium tests (Task 11). Unit tests verify the service wiring.

**Step 2: Update `getAssetCount`**

Replace the existing `getAssetCount` method to UNION library assets:

```typescript
@GenerateSql({ params: [DummyValue.UUID] })
async getAssetCount(spaceId: string): Promise<number> {
  const result = await this.db
    .selectFrom(
      this.db
        .selectFrom('shared_space_asset')
        .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
        .select('asset.id')
        .where('shared_space_asset.spaceId', '=', spaceId)
        .where('asset.deletedAt', 'is', null)
        .union(
          this.db
            .selectFrom('shared_space_library')
            .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
            .select('asset.id')
            .where('shared_space_library.spaceId', '=', spaceId)
            .where('asset.deletedAt', 'is', null),
        )
        .as('combined'),
    )
    .select((eb) => eb.fn.countAll().as('count'))
    .executeTakeFirstOrThrow();
  return Number(result.count);
}
```

**Step 3: Update `getRecentAssets`**

Similar pattern — UNION the two sources, then ORDER BY and LIMIT:

```typescript
@GenerateSql({ params: [DummyValue.UUID], options: { limit: 4 } })
getRecentAssets(spaceId: string, limit = 4) {
  return this.db
    .selectFrom(
      this.db
        .selectFrom('shared_space_asset')
        .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
        .select(['asset.id', 'asset.thumbhash', 'asset.fileCreatedAt'])
        .where('shared_space_asset.spaceId', '=', spaceId)
        .where('asset.deletedAt', 'is', null)
        .union(
          this.db
            .selectFrom('shared_space_library')
            .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
            .select(['asset.id', 'asset.thumbhash', 'asset.fileCreatedAt'])
            .where('shared_space_library.spaceId', '=', spaceId)
            .where('asset.deletedAt', 'is', null),
        )
        .as('combined'),
    )
    .select(['combined.id', 'combined.thumbhash'])
    .orderBy('combined.fileCreatedAt', 'desc')
    .limit(limit)
    .execute();
}
```

**Step 4: Update `getNewAssetCount`**

For library assets, use `asset.createdAt` as the "added" timestamp since there is no `addedAt`:

```typescript
@GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE] })
async getNewAssetCount(spaceId: string, since: Date): Promise<number> {
  const result = await this.db
    .selectFrom(
      this.db
        .selectFrom('shared_space_asset')
        .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
        .select('asset.id')
        .where('shared_space_asset.spaceId', '=', spaceId)
        .where('shared_space_asset.addedAt', '>', since)
        .where('asset.deletedAt', 'is', null)
        .union(
          this.db
            .selectFrom('shared_space_library')
            .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
            .select('asset.id')
            .where('shared_space_library.spaceId', '=', spaceId)
            .where('asset.createdAt', '>', since)
            .where('asset.deletedAt', 'is', null),
        )
        .as('combined'),
    )
    .select((eb) => eb.fn.countAll().as('count'))
    .executeTakeFirstOrThrow();
  return Number(result.count);
}
```

**Step 5: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts
git commit -m "feat(repo): UNION library assets in space asset queries"
```

---

### Task 6: Repository — Update timeline queries to include library assets

**Files:**

- Modify: `server/src/repositories/asset.repository.ts`

The timeline queries use `timelineSpaceIds` to include space assets. Currently they only check `shared_space_asset`. We need to also check `shared_space_library` → `asset.libraryId`.

**Step 1: Update `getTimeBuckets` query**

In `server/src/repositories/asset.repository.ts`, find the `.$if(!!options.userIds && !!options.timelineSpaceIds, ...)` block (around line 748). Update the exists subquery to also check library-linked assets:

```typescript
.$if(!!options.userIds && !!options.timelineSpaceIds, (qb) =>
  qb.where((eb) =>
    eb.or([
      eb('asset.ownerId', '=', anyUuid(options.userIds!)),
      eb.exists(
        eb
          .selectFrom('shared_space_asset')
          .whereRef('shared_space_asset.assetId', '=', 'asset.id')
          .where('shared_space_asset.spaceId', '=', anyUuid(options.timelineSpaceIds!)),
      ),
      eb.exists(
        eb
          .selectFrom('shared_space_library')
          .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
          .where('shared_space_library.spaceId', '=', anyUuid(options.timelineSpaceIds!)),
      ),
    ]),
  ),
)
```

**Step 2: Update `getTimeBucket` query**

Same change in the `getTimeBucket` method (around line 858). Find the identical `.$if` block and apply the same pattern.

**Step 3: Update `spaceId` filter**

Also update the `.$if(!!options.spaceId, ...)` blocks in both methods (lines 731-734 and 843-851). These handle viewing a single space's timeline. Add a second exists check for library-linked assets:

```typescript
.$if(!!options.spaceId, (qb) =>
  qb.where((eb) =>
    eb.or([
      eb.exists(
        eb
          .selectFrom('shared_space_asset')
          .whereRef('shared_space_asset.assetId', '=', 'asset.id')
          .where('shared_space_asset.spaceId', '=', asUuid(options.spaceId!)),
      ),
      eb.exists(
        eb
          .selectFrom('shared_space_library')
          .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
          .where('shared_space_library.spaceId', '=', asUuid(options.spaceId!)),
      ),
    ]),
  ),
)
```

**Step 4: Commit**

```bash
git add server/src/repositories/asset.repository.ts
git commit -m "feat(repo): include library-linked assets in timeline queries"
```

---

### Task 7: DTO — Add library fields to space DTOs

**Files:**

- Modify: `server/src/dtos/shared-space.dto.ts`

**Step 1: Add link library DTO**

```typescript
export class SharedSpaceLibraryLinkDto {
  @ValidateUUID({ description: 'Library ID' })
  libraryId!: string;
}
```

**Step 2: Add linked library response DTO**

```typescript
export class SharedSpaceLinkedLibraryDto {
  libraryId!: string;
  libraryName!: string;
  addedById!: string | null;
  createdAt!: Date;
}
```

**Step 3: Add `linkedLibraries` to `SharedSpaceResponseDto`**

Add an optional field:

```typescript
@ApiPropertyOptional()
linkedLibraries?: SharedSpaceLinkedLibraryDto[];
```

**Step 4: Commit**

```bash
git add server/src/dtos/shared-space.dto.ts
git commit -m "feat(dto): add library link DTOs"
```

---

### Task 8: Service — Write failing tests for linkLibrary / unlinkLibrary

**Files:**

- Test: `server/src/services/shared-space.service.spec.ts`

**Step 1: Write failing tests**

Add the following test cases to `shared-space.service.spec.ts`:

```typescript
describe('linkLibrary', () => {
  it('should link a library when user is admin and space owner', async () => {
    const auth = factory.auth({ user: { isAdmin: true } });
    const space = factory.sharedSpace();
    const library = factory.library();
    const member = factory.sharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(member);
    mocks.library.get.mockResolvedValue(library);
    mocks.sharedSpace.addLibrary.mockResolvedValue(
      factory.sharedSpaceLibrary({ spaceId: space.id, libraryId: library.id }),
    );

    await sut.linkLibrary(auth, space.id, { libraryId: library.id });

    expect(mocks.sharedSpace.addLibrary).toHaveBeenCalledWith({
      spaceId: space.id,
      libraryId: library.id,
      addedById: auth.user.id,
    });
  });

  it('should link a library when user is admin and space editor', async () => {
    const auth = factory.auth({ user: { isAdmin: true } });
    const space = factory.sharedSpace();
    const library = factory.library();
    const member = factory.sharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Editor,
    });

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(member);
    mocks.library.get.mockResolvedValue(library);
    mocks.sharedSpace.addLibrary.mockResolvedValue(
      factory.sharedSpaceLibrary({ spaceId: space.id, libraryId: library.id }),
    );

    await sut.linkLibrary(auth, space.id, { libraryId: library.id });

    expect(mocks.sharedSpace.addLibrary).toHaveBeenCalled();
  });

  it('should reject when user is not admin', async () => {
    const auth = factory.auth({ user: { isAdmin: false } });
    const space = factory.sharedSpace();

    await expect(sut.linkLibrary(auth, space.id, { libraryId: newUuid() })).rejects.toThrow(ForbiddenException);
  });

  it('should reject when user is admin but only a viewer', async () => {
    const auth = factory.auth({ user: { isAdmin: true } });
    const space = factory.sharedSpace();
    const member = factory.sharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Viewer,
    });

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(member);

    await expect(sut.linkLibrary(auth, space.id, { libraryId: newUuid() })).rejects.toThrow(ForbiddenException);
  });

  it('should reject when user is admin but not a space member', async () => {
    const auth = factory.auth({ user: { isAdmin: true } });
    const space = factory.sharedSpace();

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(undefined);

    await expect(sut.linkLibrary(auth, space.id, { libraryId: newUuid() })).rejects.toThrow(ForbiddenException);
  });

  it('should reject linking a non-existent library', async () => {
    const auth = factory.auth({ user: { isAdmin: true } });
    const space = factory.sharedSpace();
    const member = factory.sharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(member);
    mocks.library.get.mockResolvedValue(undefined);

    await expect(sut.linkLibrary(auth, space.id, { libraryId: newUuid() })).rejects.toThrow(BadRequestException);
  });

  it('should queue face sync job when space has face recognition enabled', async () => {
    const auth = factory.auth({ user: { isAdmin: true } });
    const space = factory.sharedSpace({ faceRecognitionEnabled: true });
    const library = factory.library();
    const member = factory.sharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(member);
    mocks.library.get.mockResolvedValue(library);
    mocks.sharedSpace.addLibrary.mockResolvedValue(
      factory.sharedSpaceLibrary({ spaceId: space.id, libraryId: library.id }),
    );

    await sut.linkLibrary(auth, space.id, { libraryId: library.id });

    expect(mocks.job.queue).toHaveBeenCalledWith({
      name: JobName.SharedSpaceLibraryFaceSync,
      data: { spaceId: space.id, libraryId: library.id },
    });
  });

  it('should not queue face sync job when face recognition is disabled', async () => {
    const auth = factory.auth({ user: { isAdmin: true } });
    const space = factory.sharedSpace({ faceRecognitionEnabled: false });
    const library = factory.library();
    const member = factory.sharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(member);
    mocks.library.get.mockResolvedValue(library);
    mocks.sharedSpace.addLibrary.mockResolvedValue(
      factory.sharedSpaceLibrary({ spaceId: space.id, libraryId: library.id }),
    );

    await sut.linkLibrary(auth, space.id, { libraryId: library.id });

    expect(mocks.job.queue).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: JobName.SharedSpaceLibraryFaceSync }),
    );
  });
});

describe('unlinkLibrary', () => {
  it('should unlink a library when user is admin and space owner', async () => {
    const auth = factory.auth({ user: { isAdmin: true } });
    const space = factory.sharedSpace();
    const libraryId = newUuid();
    const member = factory.sharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(member);

    await sut.unlinkLibrary(auth, space.id, libraryId);

    expect(mocks.sharedSpace.removeLibrary).toHaveBeenCalledWith(space.id, libraryId);
  });

  it('should reject when user is not admin', async () => {
    const auth = factory.auth({ user: { isAdmin: false } });

    await expect(sut.unlinkLibrary(auth, newUuid(), newUuid())).rejects.toThrow(ForbiddenException);
  });

  it('should reject when user is admin but only a viewer', async () => {
    const auth = factory.auth({ user: { isAdmin: true } });
    const space = factory.sharedSpace();
    const member = factory.sharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Viewer,
    });

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(member);

    await expect(sut.unlinkLibrary(auth, space.id, newUuid())).rejects.toThrow(ForbiddenException);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
```

Expected: FAIL — `sut.linkLibrary is not a function` and `sut.unlinkLibrary is not a function`

**Step 3: Commit**

```bash
git add server/src/services/shared-space.service.spec.ts
git commit -m "test: add failing tests for linkLibrary/unlinkLibrary"
```

---

### Task 9: Service — Implement linkLibrary / unlinkLibrary

**Files:**

- Modify: `server/src/services/shared-space.service.ts`

**Step 1: Implement `linkLibrary`**

Add to `SharedSpaceService`:

```typescript
async linkLibrary(auth: AuthDto, spaceId: string, dto: SharedSpaceLibraryLinkDto): Promise<void> {
  if (!auth.user.isAdmin) {
    throw new ForbiddenException('Only admins can link libraries to spaces');
  }

  await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

  const library = await this.libraryRepository.get(dto.libraryId);
  if (!library) {
    throw new BadRequestException('Library not found');
  }

  await this.sharedSpaceRepository.addLibrary({
    spaceId,
    libraryId: dto.libraryId,
    addedById: auth.user.id,
  });

  const space = await this.sharedSpaceRepository.getById(spaceId);
  if (space?.faceRecognitionEnabled) {
    await this.jobRepository.queue({
      name: JobName.SharedSpaceLibraryFaceSync,
      data: { spaceId, libraryId: dto.libraryId },
    });
  }
}
```

**Step 2: Implement `unlinkLibrary`**

```typescript
async unlinkLibrary(auth: AuthDto, spaceId: string, libraryId: string): Promise<void> {
  if (!auth.user.isAdmin) {
    throw new ForbiddenException('Only admins can unlink libraries from spaces');
  }

  await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

  await this.sharedSpaceRepository.removeLibrary(spaceId, libraryId);
}
```

Add import for `SharedSpaceLibraryLinkDto` from `src/dtos/shared-space.dto`.

**Step 3: Run tests to verify they pass**

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
```

Expected: All new tests PASS.

**Step 4: Commit**

```bash
git add server/src/services/shared-space.service.ts
git commit -m "feat(service): implement linkLibrary/unlinkLibrary"
```

---

### Task 10: Controller — Add API endpoints

**Files:**

- Modify: `server/src/controllers/shared-space.controller.ts`

**Step 1: Add link library endpoint**

```typescript
@Put(':id/libraries')
@Authenticated({ permission: Permission.SharedSpaceLibraryCreate, admin: true })
@HttpCode(HttpStatus.NO_CONTENT)
@Endpoint({
  summary: 'Link a library to a shared space',
  description: 'Link an external library so its assets appear in the space.',
  history: new HistoryBuilder().added('v1').beta('v1'),
})
linkLibrary(
  @Auth() auth: AuthDto,
  @Param() { id }: UUIDParamDto,
  @Body() dto: SharedSpaceLibraryLinkDto,
): Promise<void> {
  return this.service.linkLibrary(auth, id, dto);
}
```

**Step 2: Add unlink library endpoint**

```typescript
@Delete(':id/libraries/:libraryId')
@Authenticated({ permission: Permission.SharedSpaceLibraryDelete, admin: true })
@HttpCode(HttpStatus.NO_CONTENT)
@Endpoint({
  summary: 'Unlink a library from a shared space',
  description: 'Remove a library link. Library assets will no longer appear in the space.',
  history: new HistoryBuilder().added('v1').beta('v1'),
})
unlinkLibrary(
  @Auth() auth: AuthDto,
  @Param() { id }: UUIDParamDto,
  @Param('libraryId') libraryId: string,
): Promise<void> {
  return this.service.unlinkLibrary(auth, id, libraryId);
}
```

Add imports for `SharedSpaceLibraryLinkDto` and new `Permission` entries.

**Step 3: Regenerate OpenAPI specs**

```bash
cd server && pnpm build && pnpm sync:open-api
make open-api-typescript
```

**Step 4: Run lint and type check**

```bash
make lint-server && make check-server
```

**Step 5: Commit**

```bash
git add server/src/controllers/shared-space.controller.ts open-api/ server/
git commit -m "feat(api): add library link/unlink endpoints"
```

---

### Task 11: Service — Include linked libraries in space response

**Files:**

- Modify: `server/src/services/shared-space.service.ts` — update `mapSpace` and `getAll`/`get` methods

**Step 1: Write failing test**

In `server/src/services/shared-space.service.spec.ts`:

```typescript
describe('get', () => {
  it('should include linked libraries in response when user is admin', async () => {
    const auth = factory.auth({ user: { isAdmin: true } });
    const space = factory.sharedSpace();
    const member = factory.sharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });
    const linkedLibrary = factory.sharedSpaceLibrary({
      spaceId: space.id,
      libraryId: newUuid(),
    });

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(member);
    mocks.sharedSpace.getMembers.mockResolvedValue([makeMemberResult({ ...member })]);
    mocks.sharedSpace.getAssetCount.mockResolvedValue(100);
    mocks.sharedSpace.getRecentAssets.mockResolvedValue([]);
    mocks.sharedSpace.getNewAssetCount.mockResolvedValue(0);
    mocks.sharedSpace.getLinkedLibraries.mockResolvedValue([linkedLibrary]);
    mocks.library.get.mockResolvedValue(factory.library({ id: linkedLibrary.libraryId, name: 'Family Photos' }));

    const result = await sut.get(auth, space.id);

    expect(result.linkedLibraries).toHaveLength(1);
    expect(result.linkedLibraries![0].libraryId).toBe(linkedLibrary.libraryId);
  });

  it('should not include linked libraries for non-admin users', async () => {
    const auth = factory.auth({ user: { isAdmin: false } });
    const space = factory.sharedSpace();
    const member = factory.sharedSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    mocks.sharedSpace.getById.mockResolvedValue(space);
    mocks.sharedSpace.getMember.mockResolvedValue(member);
    mocks.sharedSpace.getMembers.mockResolvedValue([makeMemberResult({ ...member })]);
    mocks.sharedSpace.getAssetCount.mockResolvedValue(0);
    mocks.sharedSpace.getRecentAssets.mockResolvedValue([]);
    mocks.sharedSpace.getNewAssetCount.mockResolvedValue(0);

    const result = await sut.get(auth, space.id);

    expect(result.linkedLibraries).toBeUndefined();
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
```

**Step 3: Implement — update `mapSpace` or calling code**

Modify the `get` and `getAll` methods to fetch and include linked libraries for admin users. The `mapSpace` helper or the calling code should conditionally include `linkedLibraries` when the requesting user is admin.

**Step 4: Run tests — verify they pass**

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
```

**Step 5: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(service): include linked libraries in space response for admins"
```

---

### Task 12: Library scan hook — Queue face match jobs for linked spaces

**Files:**

- Modify: `server/src/services/library.service.ts`
- Test: `server/src/services/library.service.spec.ts`

**Step 1: Write failing test**

In `server/src/services/library.service.spec.ts`, add:

```typescript
describe('handleSyncFiles', () => {
  it('should queue face match jobs for spaces linked to the library', async () => {
    // Setup: library with linked space that has face recognition enabled
    // After assets are created, verify SharedSpaceFaceMatch jobs are queued
  });

  it('should not queue face match jobs when library is not linked to any space', async () => {
    // Setup: library with no linked spaces
    // Verify no SharedSpaceFaceMatch jobs queued
  });

  it('should not queue face match jobs when linked space has face recognition disabled', async () => {
    // Setup: library linked to space with faceRecognitionEnabled: false
    // Verify no SharedSpaceFaceMatch jobs queued
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
cd server && pnpm test -- --run src/services/library.service.spec.ts
```

**Step 3: Implement the hook**

In `server/src/services/library.service.ts`, in the `handleSyncFiles` method, after the `queuePostSyncJobs(assetIds)` call (line 274), add:

```typescript
// Queue face match for spaces linked to this library
if (assetIds.length > 0) {
  const linkedSpaces = await this.sharedSpaceRepository.getSpacesLinkedToLibrary(job.libraryId);
  for (const link of linkedSpaces) {
    if (link.faceRecognitionEnabled) {
      for (const assetId of assetIds) {
        await this.jobRepository.queue({
          name: JobName.SharedSpaceFaceMatch,
          data: { spaceId: link.spaceId, assetId },
        });
      }
    }
  }
}
```

Add `SharedSpaceRepository` to the service's injected dependencies (via `BaseService` — it should already be available as `this.sharedSpaceRepository`).

**Step 4: Run tests — verify they pass**

```bash
cd server && pnpm test -- --run src/services/library.service.spec.ts
```

**Step 5: Commit**

```bash
git add server/src/services/library.service.ts server/src/services/library.service.spec.ts
git commit -m "feat(library): queue face match for spaces linked to library on scan"
```

---

### Task 13: Face sync orchestrator job

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Test: `server/src/services/shared-space.service.spec.ts`

**Step 1: Write failing tests**

```typescript
describe('handleSharedSpaceLibraryFaceSync', () => {
  it('should process library assets with faces in batches', async () => {
    const spaceId = newUuid();
    const libraryId = newUuid();

    // Mock: library link exists
    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true }));

    // Mock: assets with faces in the library
    // The handler should query assets and process face matching
    // Verify face matching logic is called for each asset with faces
  });

  it('should skip when library link no longer exists', async () => {
    const spaceId = newUuid();
    const libraryId = newUuid();

    mocks.sharedSpace.getById.mockResolvedValue(undefined);

    const result = await sut.handleSharedSpaceLibraryFaceSync({ spaceId, libraryId });

    expect(result).toBe(JobStatus.Skipped);
  });

  it('should skip when face recognition is disabled', async () => {
    const spaceId = newUuid();
    const libraryId = newUuid();

    mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: false }));

    const result = await sut.handleSharedSpaceLibraryFaceSync({ spaceId, libraryId });

    expect(result).toBe(JobStatus.Skipped);
  });
});
```

**Step 2: Run tests — verify they fail**

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
```

**Step 3: Implement the handler**

Add to `SharedSpaceService`:

```typescript
async handleSharedSpaceLibraryFaceSync(job: { spaceId: string; libraryId: string }): Promise<JobStatus> {
  const space = await this.sharedSpaceRepository.getById(job.spaceId);
  if (!space || !space.faceRecognitionEnabled) {
    return JobStatus.Skipped;
  }

  // Query assets in this library that have faces, process in batches
  const batchSize = 1000;
  let offset = 0;

  while (true) {
    const assets = await this.assetRepository.getByLibraryIdWithFaces(job.libraryId, batchSize, offset);
    if (assets.length === 0) {
      break;
    }

    for (const asset of assets) {
      await this.processSpaceFaceMatch(job.spaceId, asset.id);
    }

    offset += batchSize;
  }

  return JobStatus.Success;
}
```

Note: `getByLibraryIdWithFaces` may need to be added to `AssetRepository`. It should query assets where `libraryId` matches and there are related `asset_face` records. The `processSpaceFaceMatch` method should reuse the existing face matching logic from `handleSharedSpaceFaceMatch`.

**Step 4: Run tests — verify they pass**

```bash
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts
```

**Step 5: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts server/src/repositories/asset.repository.ts
git commit -m "feat(service): implement SharedSpaceLibraryFaceSync orchestrator"
```

---

### Task 14: Register job handler

**Files:**

- Modify: Job handler registration (check how existing `SharedSpaceFaceMatch` is registered)

**Step 1: Find and follow the registration pattern**

Look at how `SharedSpaceFaceMatch` and `SharedSpaceFaceMatchAll` are registered in the job system. Follow the same pattern to register `SharedSpaceLibraryFaceSync` pointing to `SharedSpaceService.handleSharedSpaceLibraryFaceSync`.

Check these files:

- `server/src/utils/misc.ts` or wherever job-to-handler mapping lives
- The worker setup files

**Step 2: Register the new job**

Follow the existing pattern exactly.

**Step 3: Commit**

```bash
git add <modified files>
git commit -m "feat(jobs): register SharedSpaceLibraryFaceSync handler"
```

---

### Task 15: SQL query regeneration

**Files:**

- Modify: `server/src/queries/shared.space.repository.sql` (auto-generated)

**Step 1: Regenerate SQL queries**

```bash
make sql
```

This regenerates the documented SQL queries from `@GenerateSql` decorated methods.

**Step 2: Regenerate OpenAPI**

```bash
cd server && pnpm build && pnpm sync:open-api
make open-api-typescript
```

**Step 3: Lint and type check**

```bash
make lint-server && make check-server
```

**Step 4: Commit**

```bash
git add server/src/queries/ open-api/
git commit -m "chore: regenerate SQL queries and OpenAPI specs"
```

---

### Task 16: Run full test suite

**Step 1: Run all server tests**

```bash
cd server && pnpm test
```

Fix any failures.

**Step 2: Run linting**

```bash
make lint-server && make check-server
```

**Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve test and lint issues"
```

---

### Task 17: Verification and cleanup

**Step 1: Verify the full flow manually**

Review the complete chain:

1. Schema table → migration → repository methods → service logic → controller endpoints
2. Timeline queries include library assets
3. Face sync orchestrator is wired up
4. Tests cover all permission edge cases

**Step 2: Run all checks**

```bash
make lint-server && make check-server && cd server && pnpm test
```

**Step 3: Final commit if needed**

```bash
git add -A && git commit -m "chore: final cleanup for space-library sync"
```
