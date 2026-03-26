# Space Person Data Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix space person names and thumbnails by reading through to the personal person via JOINs, removing the stale stored `thumbnailPath`, and rendering real face thumbnails in the filter panel.

**Architecture:** Replace one-time copy-on-create with live LEFT JOINs through `shared_space_person → asset_face → person`. Remove the `thumbnailPath` column and `SharedSpacePersonThumbnail` job. The space person `name` field becomes an override-only field (empty by default).

**Tech Stack:** NestJS + Kysely (server), Svelte 5 (web), Vitest (tests), PostgreSQL migrations

---

### Task 1: Database Migration — Drop `thumbnailPath`, Clear Names

**Files:**

- Create: `server/src/schema/migrations-gallery/1775100000000-DropSpacePersonThumbnailPath.ts`

**Step 1: Write the migration**

```typescript
import { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Clear stale name copies (these were copied from personal person at creation,
  // not intentional overrides — no UI exposes manual naming)
  await db.updateTable('shared_space_person').set({ name: '' }).execute();

  await db.schema.alterTable('shared_space_person').dropColumn('thumbnailPath').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('shared_space_person')
    .addColumn('thumbnailPath', 'character varying', (col) => col.defaultTo('').notNull())
    .execute();
}
```

**Step 2: Commit**

```bash
git add server/src/schema/migrations-gallery/1775100000000-DropSpacePersonThumbnailPath.ts
git commit -m "feat: add migration to drop thumbnailPath from shared_space_person"
```

---

### Task 2: Update Schema, Types, and Factory — Remove `thumbnailPath`

**Files:**

- Modify: `server/src/schema/tables/shared-space-person.table.ts` — remove thumbnailPath column
- Modify: `server/src/database.ts` — remove thumbnailPath from SharedSpacePerson type
- Modify: `server/test/small.factory.ts` — remove thumbnailPath from factory

**Step 1: Remove `thumbnailPath` from table schema**

In `server/src/schema/tables/shared-space-person.table.ts`, remove:

```typescript
  @Column({ default: '', type: 'character varying' })
  thumbnailPath!: Generated<string>;
```

**Step 2: Remove `thumbnailPath` from database type**

In `server/src/database.ts`, remove `thumbnailPath: string;` from the `SharedSpacePerson` type (around line 368).

**Step 3: Remove `thumbnailPath` from factory**

In `server/test/small.factory.ts`, remove `thumbnailPath: '',` from the `sharedSpacePersonFactory` (around line 433).

**Step 4: Verify compile errors surface**

Run: `cd server && node_modules/.bin/tsc --noEmit 2>&1 | head -60`

Expected: Compile errors in shared-space.service.ts and shared-space.service.spec.ts where `thumbnailPath` is referenced. These will be fixed in subsequent tasks.

**Step 5: Commit**

```bash
git add server/src/schema/tables/shared-space-person.table.ts server/src/database.ts server/test/small.factory.ts
git commit -m "refactor: remove thumbnailPath from SharedSpacePerson schema and type"
```

---

### Task 3: Repository — Add JOINs for Personal Person Data

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` — update 3 query methods

**Step 1: Update `getPersonsBySpaceId()`**

Replace the existing method (around line 467-473) with:

```typescript
@GenerateSql({ params: [DummyValue.UUID] })
getPersonsBySpaceId(spaceId: string) {
  return this.db
    .selectFrom('shared_space_person')
    .leftJoin('asset_face', 'asset_face.id', 'shared_space_person.representativeFaceId')
    .leftJoin('person', 'person.id', 'asset_face.personId')
    .selectAll('shared_space_person')
    .select(['person.name as personalName', 'person.thumbnailPath as personalThumbnailPath'])
    .where('shared_space_person.spaceId', '=', spaceId)
    .orderBy('shared_space_person.name', 'asc')
    .execute();
}
```

**Step 2: Update `getPersonsBySpaceIdWithTemporalFilter()`**

Replace the existing method (around line 476-496). Add the same JOINs and alias the inner `asset_face` to `af2` to avoid ambiguity:

```typescript
@GenerateSql({ params: [DummyValue.UUID, { takenAfter: DummyValue.DATE, takenBefore: DummyValue.DATE }] })
getPersonsBySpaceIdWithTemporalFilter(spaceId: string, options?: { takenAfter?: Date; takenBefore?: Date }) {
  return this.db
    .selectFrom('shared_space_person')
    .leftJoin('asset_face', 'asset_face.id', 'shared_space_person.representativeFaceId')
    .leftJoin('person', 'person.id', 'asset_face.personId')
    .selectAll('shared_space_person')
    .select(['person.name as personalName', 'person.thumbnailPath as personalThumbnailPath'])
    .where('shared_space_person.spaceId', '=', spaceId)
    .$if(!!options?.takenAfter || !!options?.takenBefore, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom('shared_space_person_face')
            .innerJoin('asset_face as af2', 'af2.id', 'shared_space_person_face.assetFaceId')
            .innerJoin('asset', 'asset.id', 'af2.assetId')
            .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id')
            .$if(!!options?.takenAfter, (qb2) => qb2.where('asset.fileCreatedAt', '>=', options!.takenAfter!))
            .$if(!!options?.takenBefore, (qb2) => qb2.where('asset.fileCreatedAt', '<', options!.takenBefore!)),
        ),
      ),
    )
    .orderBy('shared_space_person.name', 'asc')
    .execute();
}
```

**Step 3: Update `getPersonById()`**

Replace the existing method (around line 500-502):

```typescript
@GenerateSql({ params: [DummyValue.UUID] })
getPersonById(id: string) {
  return this.db
    .selectFrom('shared_space_person')
    .leftJoin('asset_face', 'asset_face.id', 'shared_space_person.representativeFaceId')
    .leftJoin('person', 'person.id', 'asset_face.personId')
    .selectAll('shared_space_person')
    .select(['person.name as personalName', 'person.thumbnailPath as personalThumbnailPath'])
    .where('shared_space_person.id', '=', id)
    .executeTakeFirst();
}
```

**Step 4: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts
git commit -m "feat: add personal person JOINs to space person queries"
```

---

### Task 4: Service — TDD for `getSpacePeople()` Name and Thumbnail Resolution

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts` — update existing tests, add new tests
- Modify: `server/src/services/shared-space.service.ts` — update `getSpacePeople()` and `mapSpacePerson()`

**Step 1: Write failing test — resolves name from personal person**

In `shared-space.service.spec.ts`, find the `getSpacePeople` describe block (around line 2513). Update the mock data shape to include `personalName` and `personalThumbnailPath` (since the repository now returns these). Add this new test:

```typescript
it('should resolve name from personal person when space person has no name override', async () => {
  const person = factory.sharedSpacePerson({
    id: personId,
    name: '',
    representativeFaceId: faceId,
  });

  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ faceRecognitionEnabled: true }));
  mocks.sharedSpace.getPersonsBySpaceId.mockResolvedValue([
    { ...person, personalName: 'Alice', personalThumbnailPath: '/path/to/thumb.jpg' },
  ]);
  mocks.sharedSpace.getAliasesBySpaceAndUser.mockResolvedValue([]);
  mocks.sharedSpace.getPersonFaceCount.mockResolvedValue(3);
  mocks.sharedSpace.getPersonAssetCount.mockResolvedValue(2);

  const result = await sut.getSpacePeople(auth, spaceId);

  expect(result).toHaveLength(1);
  expect(result[0].name).toBe('Alice');
  expect(result[0].thumbnailPath).toBe('/path/to/thumb.jpg');
});
```

**Step 2: Write failing test — space person name overrides personal name**

```typescript
it('should use space person name as override when set', async () => {
  const person = factory.sharedSpacePerson({
    id: personId,
    name: 'Grandpa',
    representativeFaceId: faceId,
  });

  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ faceRecognitionEnabled: true }));
  mocks.sharedSpace.getPersonsBySpaceId.mockResolvedValue([
    { ...person, personalName: 'Hans', personalThumbnailPath: '/path/to/thumb.jpg' },
  ]);
  mocks.sharedSpace.getAliasesBySpaceAndUser.mockResolvedValue([]);
  mocks.sharedSpace.getPersonFaceCount.mockResolvedValue(3);
  mocks.sharedSpace.getPersonAssetCount.mockResolvedValue(2);

  const result = await sut.getSpacePeople(auth, spaceId);

  expect(result).toHaveLength(1);
  expect(result[0].name).toBe('Grandpa');
});
```

**Step 3: Write failing test — filters out persons with no thumbnail from either source**

```typescript
it('should exclude persons with no thumbnail from personal person', async () => {
  const person = factory.sharedSpacePerson({
    id: personId,
    name: '',
    representativeFaceId: faceId,
  });

  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ faceRecognitionEnabled: true }));
  mocks.sharedSpace.getPersonsBySpaceId.mockResolvedValue([
    { ...person, personalName: 'Alice', personalThumbnailPath: '' },
  ]);
  mocks.sharedSpace.getAliasesBySpaceAndUser.mockResolvedValue([]);

  const result = await sut.getSpacePeople(auth, spaceId);

  expect(result).toHaveLength(0);
});
```

**Step 4: Run tests to verify they fail**

Run: `cd server && node_modules/.bin/vitest run src/services/shared-space.service.spec.ts 2>&1 | tail -30`

Expected: Tests fail because the service still uses `person.thumbnailPath` (which no longer exists on the type) and doesn't read `personalName`/`personalThumbnailPath`.

**Step 5: Update existing tests to use new mock shape**

All existing `getSpacePeople` tests that mock `getPersonsBySpaceId` or `getPersonsBySpaceIdWithTemporalFilter` need their mock return values updated to include `personalName` and `personalThumbnailPath`. For example, the existing test "should return enriched person list" (around line 2533) should change its mock person from:

```typescript
const person = factory.sharedSpacePerson({
  id: personId,
  name: 'Alice',
  thumbnailPath: '/path/to/thumb.jpg',
});
```

to:

```typescript
const person = factory.sharedSpacePerson({
  id: personId,
  name: 'Alice',
  representativeFaceId: faceId,
});
// Mock return includes JOIN data:
mocks.sharedSpace.getPersonsBySpaceId.mockResolvedValue([
  { ...person, personalName: 'Alice', personalThumbnailPath: '/path/to/thumb.jpg' },
]);
```

The existing "should exclude people without thumbnails" test (around line 2609) should be updated to test against `personalThumbnailPath` being empty instead of `thumbnailPath`.

**Step 6: Implement `getSpacePeople()` changes**

In `shared-space.service.ts`, update `getSpacePeople()` (around line 569-589):

- Replace `if (!person.thumbnailPath) { continue; }` with `if (!person.personalThumbnailPath) { continue; }`
- Pass resolved name and thumbnail to `mapSpacePerson()`

Update `mapSpacePerson()` to accept the enriched person type:

```typescript
private mapSpacePerson(
  person: SharedSpacePerson & { personalName: string | null; personalThumbnailPath: string | null },
  faceCount: number,
  assetCount: number,
  alias: string | null,
): SharedSpacePersonResponseDto {
  return {
    id: person.id,
    spaceId: person.spaceId,
    name: person.name || person.personalName || '',
    thumbnailPath: person.personalThumbnailPath || '',
    isHidden: person.isHidden,
    birthDate: person.birthDate,
    representativeFaceId: person.representativeFaceId,
    faceCount,
    assetCount,
    alias,
    createdAt: (person.createdAt as unknown as Date).toISOString(),
    updatedAt: (person.updatedAt as unknown as Date).toISOString(),
    type: person.type,
  };
}
```

**Step 7: Run tests to verify they pass**

Run: `cd server && node_modules/.bin/vitest run src/services/shared-space.service.spec.ts 2>&1 | tail -30`

Expected: All tests pass.

**Step 8: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat: resolve space person name and thumbnail from personal person via JOIN"
```

---

### Task 5: Service — TDD for `getSpacePersonThumbnail()` Using JOIN Data

**Files:**

- Modify: `server/src/services/shared-space.service.spec.ts` — update thumbnail endpoint tests
- Modify: `server/src/services/shared-space.service.ts` — simplify `getSpacePersonThumbnail()`

**Step 1: Write failing test — serves thumbnail from personal person via JOIN**

Find the `getSpacePersonThumbnail` describe block in the spec file. Add:

```typescript
it('should serve thumbnail from personal person via JOIN data', async () => {
  const person = factory.sharedSpacePerson({
    id: personId,
    spaceId,
    representativeFaceId: faceId,
  });

  mocks.sharedSpace.getPersonById.mockResolvedValue({
    ...person,
    personalName: 'Alice',
    personalThumbnailPath: '/upload/thumbs/person.jpg',
  });

  await sut.getSpacePersonThumbnail(auth, spaceId, personId);

  expect(mocks.person.getFaceById).not.toHaveBeenCalled();
  expect(mocks.person.getById).not.toHaveBeenCalled();
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && node_modules/.bin/vitest run src/services/shared-space.service.spec.ts -t "should serve thumbnail from personal person via JOIN" 2>&1 | tail -20`

Expected: Fails because current code still calls `getFaceById` and `getById` in the fallback chain.

**Step 3: Implement simplified `getSpacePersonThumbnail()`**

Replace the method (around line 612-640) with:

```typescript
async getSpacePersonThumbnail(auth: AuthDto, spaceId: string, personId: string): Promise<ImmichMediaResponse> {
  await this.requireMembership(auth, spaceId);

  const person = await this.sharedSpaceRepository.getPersonById(personId);
  if (!person || person.spaceId !== spaceId) {
    throw new NotFoundException();
  }

  const thumbnailPath = person.personalThumbnailPath;
  if (!thumbnailPath) {
    throw new NotFoundException();
  }

  return this.serveFromBackend(thumbnailPath, mimeTypes.lookup(thumbnailPath), CacheControl.PrivateWithoutCache);
}
```

**Step 4: Update existing thumbnail tests**

Update existing tests to use the new mock shape (add `personalName` and `personalThumbnailPath` to `getPersonById` mock return values). Remove tests for the old fallback chain that no longer exists.

**Step 5: Run tests to verify they pass**

Run: `cd server && node_modules/.bin/vitest run src/services/shared-space.service.spec.ts 2>&1 | tail -30`

Expected: All tests pass.

**Step 6: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat: simplify space person thumbnail to use JOIN data"
```

---

### Task 6: Remove `SharedSpacePersonThumbnail` Job

**Files:**

- Modify: `server/src/services/shared-space.service.ts` — remove handler + queue calls
- Modify: `server/src/services/shared-space.service.spec.ts` — remove/update tests
- Modify: `server/src/enum.ts` — remove enum value
- Modify: `server/src/types.ts` — remove job type

**Step 1: Remove handler `handleSharedSpacePersonThumbnail()`**

Delete the method (around line 896-921) from `shared-space.service.ts`.

**Step 2: Remove queue calls in `processSpaceFaceMatch()`**

Remove the two `jobRepository.queue({ name: JobName.SharedSpacePersonThumbnail, ... })` calls (around lines 962-965 and 1006-1009).

**Step 3: Stop copying name at creation time**

In `processSpaceFaceMatch()` (around line 949-953), replace:

```typescript
let name = '';
const personalPerson = await this.personRepository.getById(face.personId);
if (personalPerson?.name) {
  name = personalPerson.name;
}
```

with just:

```typescript
const name = '';
```

Do the same for the pet face creation path (around line 993-997).

Note: Remove the `personalPerson` lookup calls since they're no longer needed. The `personRepository.getById` calls for name lookup can be removed entirely.

**Step 4: Remove enum value**

In `server/src/enum.ts`, remove:

```typescript
SharedSpacePersonThumbnail = 'SharedSpacePersonThumbnail',
```

**Step 5: Remove job type**

In `server/src/types.ts`, remove from the JobItem union:

```typescript
| { name: JobName.SharedSpacePersonThumbnail; data: IEntityJob }
```

**Step 6: Update tests**

- Delete the entire `handleSharedSpacePersonThumbnail` describe block (around line 2453-2511)
- Update `handleSharedSpaceFaceMatch` tests that assert `JobName.SharedSpacePersonThumbnail` was queued — remove those assertions
- Update tests that mock `personalPerson` lookup for name copying — they should now expect `name: ''` always

**Step 7: Run tests**

Run: `cd server && node_modules/.bin/vitest run src/services/shared-space.service.spec.ts 2>&1 | tail -30`

Expected: All tests pass.

**Step 8: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts server/src/enum.ts server/src/types.ts
git commit -m "refactor: remove SharedSpacePersonThumbnail job and name copying"
```

---

### Task 7: Web — TDD for Filter Panel Thumbnails

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.ts` — rename `thumbnailPath` to `thumbnailUrl`
- Modify: `web/src/lib/components/filter-panel/people-filter.svelte` — render `<img>` thumbnails
- Modify: `web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts` — add thumbnail tests

**Step 1: Write failing test — renders thumbnail image when URL provided**

In `filter-sections.spec.ts`, find the PeopleFilter describe block (around line 18). Add:

```typescript
it('should render thumbnail images when thumbnailUrl is provided', async () => {
  const people: PersonOption[] = [
    { id: '1', name: 'Alice', thumbnailUrl: '/shared-spaces/s1/people/1/thumbnail' },
    { id: '2', name: 'Bob', thumbnailUrl: '/shared-spaces/s1/people/2/thumbnail' },
  ];

  const { getAllByRole } = render(PeopleFilter, {
    props: { people, selectedIds: [], onSelectionChange: vi.fn() },
  });

  const images = getAllByRole('img');
  expect(images).toHaveLength(2);
  expect(images[0]).toHaveAttribute('src', '/shared-spaces/s1/people/1/thumbnail');
  expect(images[1]).toHaveAttribute('src', '/shared-spaces/s1/people/2/thumbnail');
});
```

**Step 2: Write failing test — falls back to gradient when no URL**

```typescript
it('should render gradient avatar when thumbnailUrl is not provided', async () => {
  const people: PersonOption[] = [{ id: '1', name: 'Alice' }];

  const { queryByRole, getByText } = render(PeopleFilter, {
    props: { people, selectedIds: [], onSelectionChange: vi.fn() },
  });

  expect(queryByRole('img')).toBeNull();
  expect(getByText('A')).toBeTruthy();
});
```

**Step 3: Run tests to verify they fail**

Run: `cd web && node_modules/.bin/vitest run src/lib/components/filter-panel/__tests__/filter-sections.spec.ts 2>&1 | tail -20`

Expected: Fails because `thumbnailUrl` doesn't exist on `PersonOption` and no `<img>` is rendered.

**Step 4: Update `PersonOption` interface**

In `filter-panel.ts`, change:

```typescript
export interface PersonOption {
  id: string;
  name: string;
  thumbnailUrl?: string;
}
```

**Step 5: Update `people-filter.svelte` — render thumbnails**

Replace the avatar div (around lines 140-146) with:

```svelte
<!-- Avatar -->
{#if person.thumbnailUrl}
  <img
    src={person.thumbnailUrl}
    alt={person.name}
    class="h-5 w-5 flex-shrink-0 rounded-full object-cover"
  />
{:else}
  <div
    class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
    style="background: {getAvatarGradient(person.name)}"
  >
    {getInitial(person.name)}
  </div>
{/if}
```

Do the same for the orphaned people avatar section (around lines 104-109).

**Step 6: Run tests to verify they pass**

Run: `cd web && node_modules/.bin/vitest run src/lib/components/filter-panel/__tests__/filter-sections.spec.ts 2>&1 | tail -20`

Expected: All tests pass.

**Step 7: Update existing tests**

Update any existing tests that create `PersonOption` objects with `thumbnailPath` to use `thumbnailUrl` instead.

**Step 8: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.ts web/src/lib/components/filter-panel/people-filter.svelte web/src/lib/components/filter-panel/__tests__/filter-sections.spec.ts
git commit -m "feat: render face thumbnails in filter panel people section"
```

---

### Task 8: Web — Update Filter Providers to Pass Thumbnail URLs

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` — space filter provider
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` — photos filter provider

**Step 1: Update space page filter provider**

In the space page `+page.svelte` (around line 166-176), update the people provider to construct thumbnail URLs:

```typescript
people: async (context?: FilterContext) => {
  const people = await getSpacePeople({
    id: space.id,
    takenAfter: context?.takenAfter,
    takenBefore: context?.takenBefore,
  });
  for (const p of people) {
    personNames.set(p.id, p.name || 'Unknown');
  }
  return people.map((p) => ({
    id: p.id,
    name: p.name || 'Unknown',
    thumbnailUrl: p.thumbnailPath
      ? createUrl(`/shared-spaces/${space.id}/people/${p.id}/thumbnail`, { updatedAt: p.updatedAt })
      : undefined,
  }));
},
```

**Step 2: Update photos page filter provider**

In the photos page `+page.svelte` (around line 72-80), update:

```typescript
people: async () => {
  const response = await getAllPeople({ withHidden: false });
  for (const p of response.people) {
    personNames.set(p.id, p.name || 'Unknown');
  }
  return response.people
    .filter((p) => p.thumbnailPath)
    .map((p) => ({
      id: p.id,
      name: p.name || 'Unknown',
      thumbnailUrl: `/people/${p.id}/thumbnail`,
    }));
},
```

**Step 3: Run web tests**

Run: `cd web && node_modules/.bin/vitest run 2>&1 | tail -20`

Expected: All tests pass.

**Step 4: Commit**

```bash
git add web/src/routes/\(user\)/spaces/\[spaceId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte web/src/routes/\(user\)/photos/\[\[assetId=id\]\]/+page.svelte
git commit -m "feat: pass thumbnail URLs to filter panel people providers"
```

---

### Task 9: Lint and Type Check

**Step 1: Run server lint + type check**

Run: `cd server && node_modules/.bin/tsc --noEmit 2>&1 | tail -20`
Run: `cd server && node_modules/.bin/eslint --fix 'src/**/*.ts' 2>&1 | tail -20`

Fix any issues.

**Step 2: Run web lint + type check**

Run: `cd web && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -20`

Fix any issues.

**Step 3: Run format**

Run: `cd server && npx prettier --write 'src/**/*.ts' 'test/**/*.ts'`
Run: `cd web && npx prettier --write 'src/**/*.svelte' 'src/**/*.ts'`

**Step 4: Commit any fixes**

```bash
git add -A && git commit -m "chore: lint and format fixes"
```

---

### Task 10: Final Verification

**Step 1: Run all server tests**

Run: `cd server && node_modules/.bin/vitest run 2>&1 | tail -30`

Expected: All tests pass.

**Step 2: Run all web tests**

Run: `cd web && node_modules/.bin/vitest run 2>&1 | tail -30`

Expected: All tests pass.

**Step 3: Verify no references to removed code**

Grep for `SharedSpacePersonThumbnail` — should only appear in the migration file (if at all).
Grep for `thumbnailPath` in `shared-space-person.table.ts` — should not exist.
Grep for `thumbnailPath` in `filter-panel.ts` — should not exist (replaced by `thumbnailUrl`).
