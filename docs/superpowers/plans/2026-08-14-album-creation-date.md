# Editable Album Creation Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an album's owner or editor change its creation date, so albums of old photos sort chronologically instead of by upload order.

**Architecture:** `album.createdAt` is already carried end to end — response DTO, sync stream, mobile Drift model, both sort implementations. The only missing link is that it is not writable. This adds one optional field to `UpdateAlbumSchema`, one pass-through in `AlbumService.update`, a date field in each of the two existing album-edit surfaces (web `AlbumEditModal`, mobile `_EditAlbumDialog`), and relaxes three ownership gates to owner-or-editor. No migration, no schema change, no sync change.

**Tech Stack:** NestJS 11 + Zod DTOs + Kysely (server), Vitest (unit/e2e/medium), SvelteKit 5 + `@immich/ui` + Luxon (web), Flutter + Riverpod + mocktail (mobile), OpenAPI → `@immich/sdk` + Dart client.

**Spec:** `docs/superpowers/specs/2026-08-14-album-creation-date-design.md`

## Global Constraints

- **Endpoint is `PATCH /albums/:id`** (not PUT).
- **Permission model:** owner ∪ album editor. `Permission.AlbumUpdate` already grants exactly this (`server/src/utils/access.ts:208-216`) — no server-side access change.
- **Wire format:** `createdAt` must be an ISO 8601 string **with a timezone designator** (`Z` or `±HH:MM`). A bare local datetime is rejected with 400.
- **Zero new i18n keys.** Use the existing `date_created` key, present in `en` + all nine required locales. If a genuinely new string appears, it lands in `de fr it nl pl es ru zh_Hans zh_Hant` in the same commit followed by `npx prettier --write i18n/*.json`.
- **Never run `make open-api` or `mise open-api`** — see Task 2.
- **`pnpm test -- --run <path>` silently runs the whole suite.** Always `pnpm test --run <path>`, no `--`.
- **Check reported test counts.** A vitest run of zero files reports green.
- Run `pnpm install` once before starting; a fresh worktree has no `node_modules`.

---

## File Structure

| File                                                                                          | Responsibility                     | Task |
| --------------------------------------------------------------------------------------------- | ---------------------------------- | ---- |
| `server/src/dtos/album.dto.ts`                                                                | accept `createdAt` on update       | 1    |
| `server/src/services/album.service.ts`                                                        | pass `createdAt` to the repository | 1    |
| `server/src/services/album.service.spec.ts`                                                   | pass-through unit tests            | 1    |
| `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`, `mobile/openapi/**` | generated clients                  | 2    |
| `e2e/src/specs/server/api/album.e2e-spec.ts`                                                  | permissions + validation grammar   | 3    |
| `server/test/medium/specs/sync/sync-album.spec.ts`                                            | sync stream carries the new date   | 4    |
| `web/src/lib/utils/album-utils.ts`                                                            | `isAlbumEditor` helper             | 5    |
| `web/src/lib/utils/album-utils.spec.ts`                                                       | helper + sort characterization     | 5    |
| `web/src/lib/modals/AlbumEditModal.svelte`                                                    | the date field                     | 6    |
| `web/src/lib/modals/AlbumEditModal.spec.ts`                                                   | modal behaviour                    | 6    |
| `web/src/lib/components/album-page/AlbumsList.svelte`                                         | context-menu gating                | 7    |
| `web/src/lib/managers/command-items.ts` + `.spec.ts`                                          | command-palette gating             | 7    |
| `mobile/lib/repositories/drift_album_api_repository.dart`                                     | `createdAt` → `UpdateAlbumDto`     | 8    |
| `mobile/lib/domain/services/remote_album.service.dart`                                        | thread the parameter               | 8    |
| `mobile/lib/providers/infrastructure/remote_album.provider.dart`                              | thread the parameter               | 8    |
| `mobile/lib/presentation/pages/drift_remote_album.page.dart`                                  | date row + kebab gating            | 9    |

---

### Task 1: Server accepts `createdAt` on album update

**Files:**

- Modify: `server/src/dtos/album.dto.ts:12` (import), `:57-65` (`UpdateAlbumSchema`)
- Modify: `server/src/services/album.service.ts:231-241`
- Test: `server/src/services/album.service.spec.ts:525-579` (`describe('update')`)

**Interfaces:**

- Consumes: nothing.
- Produces: `UpdateAlbumDto.createdAt?: Date` (decoded from an ISO string by the `isoDatetimeToDate` codec). Tasks 2, 3, 4 depend on this field existing.

- [ ] **Step 1: Write the failing tests**

Append these three tests inside `describe('update', ...)` in `server/src/services/album.service.spec.ts`, after the existing `'should allow the owner to update the album'` test:

```ts
it('should allow the owner to update the album created date', async () => {
  const album = AlbumFactory.create();
  const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
  const createdAt = new Date('1996-06-15T14:30:00.000Z');
  mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
  mocks.album.getById.mockResolvedValue(getForAlbum(album));
  mocks.album.update.mockResolvedValue(getForAlbum(album));

  await sut.update(AuthFactory.create(owner), album.id, { createdAt });

  expect(mocks.album.update).toHaveBeenCalledWith(album.id, { id: album.id, createdAt }, owner.id);
});

it('should update the album name and created date together', async () => {
  const album = AlbumFactory.create();
  const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
  const createdAt = new Date('1996-06-15T14:30:00.000Z');
  mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
  mocks.album.getById.mockResolvedValue(getForAlbum(album));
  mocks.album.update.mockResolvedValue(getForAlbum(album));

  await sut.update(AuthFactory.create(owner), album.id, { albumName: 'Summer 1996', createdAt });

  expect(mocks.album.update).toHaveBeenCalledWith(
    album.id,
    { id: album.id, albumName: 'Summer 1996', createdAt },
    owner.id,
  );
});

it('should leave the created date undefined when the dto omits it', async () => {
  const album = AlbumFactory.create();
  const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
  mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
  mocks.album.getById.mockResolvedValue(getForAlbum(album));
  mocks.album.update.mockResolvedValue(getForAlbum(album));

  await sut.update(AuthFactory.create(owner), album.id, { albumName: 'Renamed' });

  const [, update] = mocks.album.update.mock.calls[0];
  expect(update.createdAt).toBeUndefined();
});
```

`toHaveBeenCalledWith` uses `toEqual` semantics, which ignore keys whose value is `undefined` — that is why the first two tests can assert an exact object even though the service passes six keys.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && pnpm test --run src/services/album.service.spec.ts`

Expected: the first two FAIL — the received object has no `createdAt` because Zod strips unknown keys and the service never forwards it. The third passes already (it asserts absence); that is fine, it is a regression guard for Step 3.

- [ ] **Step 3: Add the field to the DTO**

In `server/src/dtos/album.dto.ts`, widen the `src/validation` import on line 12:

```ts
import { isoDatetimeToDate, stringToBool } from 'src/validation';
```

Then add `createdAt` to `UpdateAlbumSchema` (line 57), after `description`:

```ts
const UpdateAlbumSchema = z
  .object({
    albumName: z.string().optional().describe('Album name'),
    description: z.string().optional().describe('Album description'),
    createdAt: isoDatetimeToDate
      .optional()
      .describe('Album creation date. Must include a timezone designator (Z or ±HH:MM).'),
    albumThumbnailAssetId: z.uuidv4().optional().describe('Album thumbnail asset ID'),
    isActivityEnabled: z.boolean().optional().describe('Enable activity feed'),
    order: AssetOrderSchema.optional(),
  })
  .meta({ id: 'UpdateAlbumDto' });
```

- [ ] **Step 4: Forward it in the service**

In `server/src/services/album.service.ts`, add one line to the object passed to `albumRepository.update` (line 233-240):

```ts
const updatedAlbum = await this.albumRepository.update(
  album.id,
  {
    id: album.id,
    albumName: dto.albumName,
    description: dto.description,
    createdAt: dto.createdAt,
    albumThumbnailAssetId: dto.albumThumbnailAssetId,
    isActivityEnabled: dto.isActivityEnabled,
    order: dto.order,
  },
  auth.user.id,
);
```

No repository change: `update(id, album: Updateable<AlbumTable>, authUserId)` (`album.repository.ts:621`) already accepts `createdAt` because the column is `Generated<Timestamp>`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && pnpm test --run src/services/album.service.spec.ts`
Expected: PASS, including the four pre-existing `update` tests.

- [ ] **Step 6: Run the type and lint gates**

Run: `cd server && pnpm check && pnpm lint && pnpm format`
Expected: all clean. `vitest` does not typecheck, and eslint-green is not prettier-green — these are three separate CI gates.

- [ ] **Step 7: Commit**

```bash
git add server/src/dtos/album.dto.ts server/src/services/album.service.ts server/src/services/album.service.spec.ts
git commit -m "feat(server): allow updating an album's creation date"
```

---

### Task 2: Regenerate the OpenAPI clients

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `packages/sdk/src/fetch-client.ts`
- Modify: `mobile/openapi/lib/model/update_album_dto.dart` (+ any other regenerated files)

**Interfaces:**

- Consumes: `UpdateAlbumDto.createdAt` from Task 1.
- Produces: TypeScript `UpdateAlbumDto.createdAt?: string` for web (Tasks 6, 7); Dart `api.UpdateAlbumDto({Optional<DateTime?> createdAt})` for mobile (Tasks 8, 9).

- [ ] **Step 1: Regenerate**

**Do not run `make open-api`** — it is a removed stub that prints a message and `exit 1`. **Do not run `mise open-api`** — that task hardcodes `//server:install`, `//server:build`, `//server:sync-open-api`, and `//` resolves to the **main checkout**, so it would generate clients from main's server source instead of this branch's.

From the worktree root:

```bash
cd server && pnpm build && node ./dist/bin/sync-open-api.js
cd .. && mise run open-api-typescript && mise run open-api-dart
```

`open-api-dart` needs Java (JDK 21 works).

- [ ] **Step 2: Verify the field actually landed**

`mobile/openapi/**/*.dart` is marked `-diff -merge` in `.gitattributes`, so git shows those files as `Bin N -> M bytes` with no textual diff. Verify with grep, not `git diff`:

```bash
grep -n "createdAt" mobile/openapi/lib/model/update_album_dto.dart
grep -n "createdAt" open-api/immich-openapi-specs.json | head -3
```

Expected: `update_album_dto.dart` declares `createdAt` and serializes it via `value.toUtc().toIso8601String()`.

- [ ] **Step 3: Verify the generation is deterministic**

Run Step 1 again. Expected: `git status` shows no further change. A second run that dirties the tree means the generator picked up something else — stop and investigate before committing.

- [ ] **Step 4: Commit**

```bash
git add open-api packages/sdk mobile/openapi
git commit -m "chore: regenerate api clients for album createdAt"
```

Skipping the Dart half passes locally and fails CI's **OpenAPI Clients** job.

---

### Task 3: Server e2e — permissions and validation grammar

**Files:**

- Modify: `e2e/src/specs/server/api/album.e2e-spec.ts:589-634` (`describe('PATCH /albums/:id')`)

**Interfaces:**

- Consumes: `UpdateAlbumDto.createdAt` (Task 1), the regenerated `@immich/sdk` (Task 2).
- Produces: nothing.

Every test below creates its **own** album rather than reusing the `user1Albums` / `user2Albums` fixtures. Those are built once in `beforeAll` and shared with the `GET /albums` and `DELETE /albums/:id/assets` blocks; the server orders album listings by `album.createdAt desc` (`album.repository.ts:148,283,421`), so backdating a shared fixture to 1996 would reorder other suites' expectations.

- [ ] **Step 1: Write the permission tests**

Add inside `describe('PATCH /albums/:id', ...)`:

```ts
it('should set the album created date as the owner', async () => {
  const album = await utils.createAlbum(user1.accessToken, { albumName: 'Backdated' });

  const { status, body } = await request(app)
    .patch(`/albums/${album.id}`)
    .set('Authorization', `Bearer ${user1.accessToken}`)
    .send({ createdAt: '1996-06-15T14:30:00.000Z' });

  expect(status).toBe(200);
  expect(body.createdAt).toBe('1996-06-15T14:30:00.000Z');
  expect(body.updatedAt).not.toBe(album.updatedAt);

  const after = await getAlbumInfo({ id: album.id }, { headers: asBearerAuth(user1.accessToken) });
  expect(after.createdAt).toBe('1996-06-15T14:30:00.000Z');
});

it('should set the album created date as an editor', async () => {
  const album = await utils.createAlbum(user1.accessToken, {
    albumName: 'Editor may re-date',
    albumUsers: [{ userId: user2.userId, role: AlbumUserRole.Editor }],
  });

  const { status, body } = await request(app)
    .patch(`/albums/${album.id}`)
    .set('Authorization', `Bearer ${user2.accessToken}`)
    .send({ createdAt: '1996-06-15T14:30:00.000Z' });

  expect(status).toBe(200);
  expect(body.createdAt).toBe('1996-06-15T14:30:00.000Z');
});

it('should not set the album created date as a viewer', async () => {
  const album = await utils.createAlbum(user1.accessToken, {
    albumName: 'Viewer may not re-date',
    albumUsers: [{ userId: user2.userId, role: AlbumUserRole.Viewer }],
  });

  const { status, body } = await request(app)
    .patch(`/albums/${album.id}`)
    .set('Authorization', `Bearer ${user2.accessToken}`)
    .send({ createdAt: '1996-06-15T14:30:00.000Z' });

  expect(status).toBe(400);
  expect(body).toEqual(errorDto.badRequest('Not found or no album.update access'));
});

it('should not set the album created date as a non-member', async () => {
  const album = await utils.createAlbum(user2.accessToken, { albumName: 'Not yours' });

  const { status, body } = await request(app)
    .patch(`/albums/${album.id}`)
    .set('Authorization', `Bearer ${user1.accessToken}`)
    .send({ createdAt: '1996-06-15T14:30:00.000Z' });

  expect(status).toBe(400);
  expect(body).toEqual(errorDto.badRequest('Not found or no album.update access'));
});

it('should leave the created date alone when the request omits it', async () => {
  const album = await utils.createAlbum(user1.accessToken, { albumName: 'Keep my date' });

  const { status, body } = await request(app)
    .patch(`/albums/${album.id}`)
    .set('Authorization', `Bearer ${user1.accessToken}`)
    .send({ albumName: 'Renamed' });

  expect(status).toBe(200);
  expect(body.albumName).toBe('Renamed');
  expect(body.createdAt).toBe(album.createdAt);
});

it('should accept an empty body without changing anything', async () => {
  const album = await utils.createAlbum(user1.accessToken, { albumName: 'Untouched' });

  const { status, body } = await request(app)
    .patch(`/albums/${album.id}`)
    .set('Authorization', `Bearer ${user1.accessToken}`)
    .send({});

  expect(status).toBe(200);
  expect(body.albumName).toBe('Untouched');
  expect(body.createdAt).toBe(album.createdAt);
});
```

- [ ] **Step 2: Write the grammar table**

The accepted grammar is fixed by the regex Zod emits for `isoDatetimeToDate` into `open-api/immich-openapi-specs.json`. It enforces a **required** timezone designator and **real calendar validity** (leap years, month lengths). Add:

```ts
it.each([
  ['1996-06-15T14:30:00.000Z', 200, 'UTC with milliseconds'],
  ['1996-06-15T14:30:00+02:00', 200, 'a numeric offset'],
  ['1996-06-15T14:30Z', 200, 'omitted seconds'],
  ['1996-02-29T00:00:00.000Z', 200, 'a real leap day'],
  ['0001-01-01T00:00:00.000Z', 200, 'the earliest four-digit year'],
  ['1996-06-15T14:30:00', 400, 'no timezone designator'],
  ['1996-06-15', 400, 'a date with no time'],
  ['not-a-date', 400, 'a non-date string'],
  ['', 400, 'an empty string'],
  [null, 400, 'null'],
  ['12345-06-15T14:30:00Z', 400, 'a five-digit year'],
  ['1996-06-31T00:00:00.000Z', 400, 'the 31st of a 30-day month'],
  ['1997-02-29T00:00:00.000Z', 400, 'a leap day in a non-leap year'],
  ['1996-06-15T24:00:00.000Z', 400, 'hour 24'],
  ['1996-06-15t14:30:00z', 400, 'lowercase t and z'],
] as [createdAt: unknown, expected: number, label: string][])(
  'should answer %i for createdAt %s (%s)',
  async (createdAt, expected, label) => {
    const album = await utils.createAlbum(user1.accessToken, { albumName: `Grammar: ${label}` });

    const { status } = await request(app)
      .patch(`/albums/${album.id}`)
      .set('Authorization', `Bearer ${user1.accessToken}`)
      .send({ createdAt });

    expect(status).toBe(expected);
  },
);
```

The tuple is typed explicitly because the rows mix `string` and `null`; without it TypeScript widens the array and `expect(status).toBe(expected)` loses its `number`. Reorder the format arguments if the generated titles read badly — but keep the label in the album name, or fifteen failures all report against albums called `Grammar undefined`.

- [ ] **Step 3: Write the two deliberate-behaviour tests**

These pin decisions from the spec (§5 and the millisecond note) so a later change has to be a choice rather than an accident:

```ts
it('should accept a future created date', async () => {
  const album = await utils.createAlbum(user1.accessToken, { albumName: 'From the future' });
  const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const { status, body } = await request(app)
    .patch(`/albums/${album.id}`)
    .set('Authorization', `Bearer ${user1.accessToken}`)
    .send({ createdAt: future });

  expect(status).toBe(200);
  expect(body.createdAt).toBe(future);
});

it('should truncate sub-millisecond precision', async () => {
  const album = await utils.createAlbum(user1.accessToken, { albumName: 'Microseconds' });

  const { status, body } = await request(app)
    .patch(`/albums/${album.id}`)
    .set('Authorization', `Bearer ${user1.accessToken}`)
    .send({ createdAt: '1996-06-15T14:30:00.123456Z' });

  expect(status).toBe(200);
  expect(body.createdAt).toBe('1996-06-15T14:30:00.123Z');
});
```

- [ ] **Step 4: Run the suite**

The e2e stack must be running. Run: `cd e2e && pnpm test src/specs/server/api/album.e2e-spec.ts`

Expected: PASS. `make e2e-api-dev` does not exist. Check the reported test count matches what you added — a path that matches nothing reports green.

- [ ] **Step 5: Commit**

```bash
git add e2e/src/specs/server/api/album.e2e-spec.ts
git commit -m "test(e2e): cover album createdAt permissions and validation"
```

---

### Task 4: Server medium — the sync stream carries the edited date

**Files:**

- Modify: `server/test/medium/specs/sync/sync-album.spec.ts` (inside `describe(SyncRequestType.AlbumsV1, ...)`)

**Interfaces:**

- Consumes: `AlbumRepository.update(id, { createdAt }, authUserId)`.
- Produces: nothing.

This proves mobile picks up an edit made anywhere. `AlbumTable` carries `@UpdatedAtTrigger('album_updatedAt')`, so writing `createdAt` bumps `updatedAt` and `updateId`, which is what puts the row in the next sync batch.

- [ ] **Step 1: Write the failing test**

```ts
it('should detect and sync a changed album created date', async () => {
  const { auth, ctx } = await setup();
  const albumRepo = ctx.get(AlbumRepository);
  const { album } = await ctx.newAlbum({ ownerId: auth.user.id });

  const initial = await ctx.syncStream(auth, [SyncRequestType.AlbumsV1]);
  await ctx.syncAckAll(auth, initial);
  await ctx.assertSyncIsComplete(auth, [SyncRequestType.AlbumsV1]);

  const createdAt = new Date('1996-06-15T14:30:00.000Z');
  await albumRepo.update(album.id, { createdAt }, auth.user.id);

  const response = await ctx.syncStream(auth, [SyncRequestType.AlbumsV1]);
  const entry = response.find((item) => item.type === SyncEntityType.AlbumV1);

  expect(entry).toBeDefined();
  expect(entry!.data).toEqual(expect.objectContaining({ id: album.id }));
  // Compare instants, not representations: the medium harness may hand back a Date
  // or the encoded ISO string depending on serialization.
  expect(new Date((entry!.data as { createdAt: string | Date }).createdAt).toISOString()).toBe(
    '1996-06-15T14:30:00.000Z',
  );

  await ctx.syncAckAll(auth, response);
  await ctx.assertSyncIsComplete(auth, [SyncRequestType.AlbumsV1]);
});
```

- [ ] **Step 2: Run it**

Medium tests need Docker, and in a fresh worktree the SDKs must be built first:

```bash
pnpm --filter @immich/sdk build
pnpm --filter @immich/plugin-sdk build
cd server && pnpm test:medium --run test/medium/specs/sync/sync-album.spec.ts
```

Expected: PASS. This test exercises only existing plumbing, so it should pass immediately — that is the point of it. To prove it is meaningful, temporarily change the expected string to `1997-…` and confirm it fails, then change it back.

- [ ] **Step 3: Commit**

```bash
git add server/test/medium/specs/sync/sync-album.spec.ts
git commit -m "test(server): pin album createdAt propagation through the sync stream"
```

---

### Task 5: Web — `isAlbumEditor` helper and the sort characterization

**Files:**

- Modify: `web/src/lib/utils/album-utils.ts:1` (import), append the helper near the sorting section
- Create: `web/src/lib/utils/album-utils.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `isAlbumEditor(album: AlbumResponseDto, userId: string): boolean` — true when `userId` holds an `albumUsers` role of `Owner` or `Editor`. Task 7 consumes it.

The helper exists so the gating logic is unit-testable. `AlbumsList.svelte` has no spec and rendering it would pull in `authManager`, the preferences stores and `modalManager` for very little return; testing the predicate plus a type-checked template edit is the honest trade. Note this duplicates the inline `isAlbumEditor` at `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte:94-99` — leave that copy alone, converging it is out of scope.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/utils/album-utils.spec.ts`:

```ts
import { AlbumUserRole, type AlbumResponseDto } from '@immich/sdk';
import { AlbumSortBy, SortOrder } from '$lib/stores/preferences.store';
import { isAlbumEditor, sortAlbums } from '$lib/utils/album-utils';

const A = (o: Partial<AlbumResponseDto>): AlbumResponseDto =>
  ({
    id: 'a',
    albumName: 'A',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    albumThumbnailAssetId: null,
    shared: false,
    hasSharedLink: false,
    assetCount: 0,
    isActivityEnabled: false,
    albumUsers: [],
    ...o,
  }) as never;

const withUsers = (roles: [userId: string, role: AlbumUserRole][]) =>
  A({ albumUsers: roles.map(([id, role]) => ({ user: { id }, role })) as never });

describe('isAlbumEditor', () => {
  it('is true for the owner', () => {
    expect(isAlbumEditor(withUsers([['u1', AlbumUserRole.Owner]]), 'u1')).toBe(true);
  });

  it('is true for an editor', () => {
    expect(
      isAlbumEditor(
        withUsers([
          ['u1', AlbumUserRole.Owner],
          ['u2', AlbumUserRole.Editor],
        ]),
        'u2',
      ),
    ).toBe(true);
  });

  it('is false for a viewer', () => {
    expect(
      isAlbumEditor(
        withUsers([
          ['u1', AlbumUserRole.Owner],
          ['u2', AlbumUserRole.Viewer],
        ]),
        'u2',
      ),
    ).toBe(false);
  });

  it('is false for someone with no role on the album', () => {
    expect(isAlbumEditor(withUsers([['u1', AlbumUserRole.Owner]]), 'u3')).toBe(false);
  });
});

describe('sortAlbums by DateCreated', () => {
  it('orders by the stored createdAt, newest first', () => {
    const albums = [
      A({ id: 'old', albumName: '1996', createdAt: '1996-06-15T14:30:00.000Z' }),
      A({ id: 'mid', albumName: '2010', createdAt: '2010-01-01T00:00:00.000Z' }),
      A({ id: 'new', albumName: '2026', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];

    const sorted = sortAlbums(albums, { sortBy: AlbumSortBy.DateCreated, orderBy: SortOrder.Desc });

    expect(sorted.map(({ albumName }) => albumName)).toEqual(['2026', '2010', '1996']);
  });

  it('orders oldest first when ascending', () => {
    const albums = [
      A({ id: 'new', albumName: '2026', createdAt: '2026-01-01T00:00:00.000Z' }),
      A({ id: 'old', albumName: '1996', createdAt: '1996-06-15T14:30:00.000Z' }),
    ];

    const sorted = sortAlbums(albums, { sortBy: AlbumSortBy.DateCreated, orderBy: SortOrder.Asc });

    expect(sorted.map(({ albumName }) => albumName)).toEqual(['1996', '2026']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test --run src/lib/utils/album-utils.spec.ts`
Expected: FAIL to import — `isAlbumEditor` is not exported. The `sortAlbums` tests describe existing behaviour and will pass once the import resolves.

- [ ] **Step 3: Add the helper**

In `web/src/lib/utils/album-utils.ts`, change line 1 from a type-only import to a value import:

```ts
import { AlbumUserRole, type AlbumResponseDto } from '@immich/sdk';
```

Then add, immediately above the `Album Sorting` banner comment:

```ts
/**
 * Whether `userId` may edit `album`'s metadata.
 *
 * Mirrors the server's `Permission.AlbumUpdate`, which grants owner ∪ shared-with-editor
 * (`server/src/utils/access.ts:208-216`). Deletion is owner-only server-side
 * (`Permission.AlbumDelete`, :218-220). Sharing is **not** — `Permission.AlbumShare`
 * (:222-230) grants owner ∪ editor exactly as `AlbumUpdate` does — but the albums-list UI
 * has always gated Share on ownership and this change does not widen it, so callers must
 * keep using their own ownership check for Share and Delete.
 */
export const isAlbumEditor = (album: AlbumResponseDto, userId: string) =>
  album.albumUsers.some(
    ({ user, role }) => user.id === userId && (role === AlbumUserRole.Owner || role === AlbumUserRole.Editor),
  );
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `cd web && pnpm test --run src/lib/utils/album-utils.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the sort tests can fail**

Temporarily flip an expectation to `['1996', '2010', '2026']` and re-run. Expected: FAIL. Restore it. A characterization test over untouched code is worth nothing until you have seen it go red.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/utils/album-utils.ts web/src/lib/utils/album-utils.spec.ts
git commit -m "feat(web): add isAlbumEditor helper and pin the DateCreated sort"
```

---

### Task 6: Web — the date field in `AlbumEditModal`

**Files:**

- Modify: `web/src/lib/modals/AlbumEditModal.svelte` (whole file)
- Create: `web/src/lib/modals/AlbumEditModal.spec.ts`

**Interfaces:**

- Consumes: `UpdateAlbumDto.createdAt?: string` (Task 2), `handleUpdateAlbum(album, dto)` from `$lib/services/album.service`.
- Produces: nothing consumed by later tasks.

Two traps to design around:

1. **Comparison must be on instants.** The input is local-zone, `album.createdAt` is normally `…Z`. String comparison reports every album as changed and rewrites `createdAt` on every rename.
2. **The offset must be historical.** Luxon resolves `Europe/Berlin` in June 1996 to `+02:00` from the IANA database. `new Date().getTimezoneOffset()` would stamp today's offset onto a 1996 date.

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/modals/AlbumEditModal.spec.ts`. It follows `SpaceEditModal.spec.ts` — the same `vi.hoisted` service mock, `data-testid` queries (`@immich/ui`'s `Field`/`Label` wiring uses `aria-labelledby`, which happy-dom does not reliably associate), and the capitalised `Save` button label (which comes from `@immich/ui`'s own translation service, not svelte-i18n).

`web/vite.config.ts` pins `TZ: 'UTC'` for unit tests, so the runner's zone cannot exercise the local↔UTC conversion. Force a zone through Luxon instead, which is what the component reads:

```ts
import { type AlbumResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { Settings } from 'luxon';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import AlbumEditModal from './AlbumEditModal.svelte';

const handleUpdateAlbumMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/album.service', () => ({ handleUpdateAlbum: handleUpdateAlbumMock }));

const originalZone = Settings.defaultZone;

const album = (o: Partial<AlbumResponseDto> = {}): AlbumResponseDto =>
  ({
    id: 'a1',
    albumName: 'Summer',
    description: 'Trip',
    createdAt: '1996-06-15T12:30:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    albumUsers: [],
    ...o,
  }) as never;

const createdAtInput = () => screen.getByTestId('album-edit-created-at') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save' });

// `userEvent.type` is unreliable against `datetime-local`, which browsers and happy-dom
// treat as segmented rather than free text. Set the whole value at once — the same
// input+change pair AssetChangeDateModal.spec.ts:57-62 uses on this element.
const setDate = async (value: string) => {
  await fireEvent.input(createdAtInput(), { target: { value } });
  await fireEvent.change(createdAtInput(), { target: { value } });
};

beforeEach(() => {
  // 1996-06-15T12:30Z is 14:30 in Berlin summer time (+02:00). Pinning the zone here
  // rather than via TZ makes the local <-> UTC conversion observable under the
  // config's TZ: 'UTC'.
  Settings.defaultZone = 'Europe/Berlin';
  handleUpdateAlbumMock.mockResolvedValue(true);
});

afterAll(() => {
  Settings.defaultZone = originalZone;
});

describe('AlbumEditModal', () => {
  it('pre-fills the created date in local time', () => {
    render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    expect(createdAtInput().value).toBe('1996-06-15T14:30:00.000');
  });

  it('submits the edited date as an ISO string with the historical offset', async () => {
    const onClose = vi.fn();
    render(AlbumEditModal, { props: { album: album(), onClose } });

    await setDate('1996-06-15T09:00:00.000');
    await userEvent.click(saveButton());

    await waitFor(() => expect(handleUpdateAlbumMock).toHaveBeenCalled());
    const [, dto] = handleUpdateAlbumMock.mock.calls[0];
    expect(dto.createdAt).toBe('1996-06-15T09:00:00.000+02:00');
    expect(onClose).toHaveBeenCalled();
  });

  it('omits the created date when it was not touched', async () => {
    render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    await userEvent.click(saveButton());

    await waitFor(() => expect(handleUpdateAlbumMock).toHaveBeenCalled());
    const [, dto] = handleUpdateAlbumMock.mock.calls[0];
    expect(dto).not.toHaveProperty('createdAt');
    expect(dto.albumName).toBe('Summer');
  });

  it('omits the created date when the input is cleared, and still saves the name', async () => {
    render(AlbumEditModal, { props: { album: album(), onClose: vi.fn() } });

    await setDate('');
    await userEvent.click(saveButton());

    await waitFor(() => expect(handleUpdateAlbumMock).toHaveBeenCalled());
    const [, dto] = handleUpdateAlbumMock.mock.calls[0];
    expect(dto).not.toHaveProperty('createdAt');
    expect(dto.albumName).toBe('Summer');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test --run src/lib/modals/AlbumEditModal.spec.ts`
Expected: FAIL — `getByTestId('album-edit-created-at')` finds nothing.

- [ ] **Step 3: Implement the modal**

Replace `web/src/lib/modals/AlbumEditModal.svelte` with:

```svelte
<script lang="ts">
  import AlbumCover from '$lib/components/album-page/AlbumCover.svelte';
  import DateInput from '$lib/elements/DateInput.svelte';
  import { handleUpdateAlbum } from '$lib/services/album.service';
  import { type AlbumResponseDto, type UpdateAlbumDto } from '@immich/sdk';
  import { Field, FormModal, Input, Textarea } from '@immich/ui';
  import { mdiRenameOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    album: AlbumResponseDto;
    onClose: () => void;
  };

  let { album, onClose }: Props = $props();

  const LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSS";

  let albumName = $state(album.albumName);
  let description = $state(album.description);
  // `datetime-local` carries no zone, so this is the album's instant rendered in the
  // browser's zone. Luxon applies the historical offset for the date being edited.
  let createdAt = $state(DateTime.fromISO(album.createdAt).toFormat(LOCAL_FORMAT));

  const onSubmit = async () => {
    const dto: UpdateAlbumDto = { albumName, description };

    const edited = DateTime.fromISO(createdAt);
    const original = DateTime.fromISO(album.createdAt);
    const iso = edited.toISO();
    // Compare instants, never strings: the input is local and album.createdAt is UTC,
    // so string equality would rewrite createdAt on every unrelated edit.
    if (edited.isValid && iso && edited.toMillis() !== original.toMillis()) {
      dto.createdAt = iso;
    }

    const success = await handleUpdateAlbum(album, dto);
    if (success) {
      onClose();
    }
  };
</script>

<FormModal icon={mdiRenameOutline} title={$t('edit_album')} size="medium" {onClose} {onSubmit}>
  <div class="m-4 flex items-center gap-8">
    <AlbumCover {album} class="hidden size-50 shadow-lg sm:flex" />

    <div class="flex grow flex-col gap-4">
      <Field label={$t('name')}>
        <Input bind:value={albumName} />
      </Field>

      <Field label={$t('date_created')}>
        <DateInput
          type="datetime-local"
          class="immich-form-input w-full"
          data-testid="album-edit-created-at"
          bind:value={createdAt}
        />
      </Field>

      <Field label={$t('description')}>
        <Textarea bind:value={description} />
      </Field>
    </div>
  </div>
</FormModal>
```

`DateInput` spreads `...rest` onto its `<input>`, so `data-testid` reaches the DOM. Its `step=".001"` keeps milliseconds, which is what stops backdated albums tying in the `DateCreated` sort.

- [ ] **Step 4: Run to verify the tests pass**

Run: `cd web && pnpm test --run src/lib/modals/AlbumEditModal.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the web gates**

Run: `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm format`
Expected: clean. `pnpm check:svelte` can scan zero files locally in some setups — check the reported file count before trusting it.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/modals/AlbumEditModal.svelte web/src/lib/modals/AlbumEditModal.spec.ts
git commit -m "feat(web): edit an album's creation date"
```

---

### Task 7: Web — relax the two edit gates to owner-or-editor

**Files:**

- Modify: `web/src/lib/components/album-page/AlbumsList.svelte:20` (import), `:173-175`, `:292-301`
- Modify: `web/src/lib/managers/command-items.ts:260`
- Test: `web/src/lib/managers/command-items.spec.ts:593-608`

**Interfaces:**

- Consumes: `isAlbumEditor` (Task 5).
- Produces: nothing.

The command-palette gate is **`isOwner || isEditor`**, not `isEditor` alone. `AlbumContext.isEditor` is derived from `albumUsers` (`command-context-manager.svelte.ts:203-206`), so a real owner has it true — but the spec fixture at `command-items.spec.ts:547-564` sets `isOwner: true, isEditor: false`, and more importantly the disjunction does not depend on the owner also appearing in `albumUsers`.

- [ ] **Step 1: Write the failing test**

In `web/src/lib/managers/command-items.spec.ts`, add an editor context beside the existing `ctxNonOwner` / `ctxLinkViewer` helpers (around line 571):

```ts
const ctxEditor = (): CommandContext => ({
  ...makeCtx(),
  album: { ...makeCtx().album!, isOwner: false, isEditor: true, isMember: true },
  userId: 'u-editor',
});
```

Then add one case inside `describe('cmd:album_rename', ...)`:

```ts
it('shows for an album editor', () => {
  expect(cmd().isAvailable!(ctxEditor())).toBe(true);
});
```

Leave the existing `hides for non-owners` case alone — `ctxNonOwner()` has `isEditor: false`, so it must keep returning false.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test --run src/lib/managers/command-items.spec.ts`
Expected: the new test FAILS (the gate is still `isOwner` only, and `ctxEditor` has `isOwner: false`). Every other case passes.

- [ ] **Step 3: Relax the command-palette gate**

In `web/src/lib/managers/command-items.ts`, change line 260:

```ts
    isAvailable: (ctx) => ctx.album !== null && (ctx.album.isOwner || ctx.album.isEditor),
```

Leave `cmd:album_share` on `ctx.album.isOwner`.

- [ ] **Step 4: Run to verify the tests pass**

Run: `cd web && pnpm test --run src/lib/managers/command-items.spec.ts`
Expected: PASS, including `shows for owner` and `hides for non-owners`.

- [ ] **Step 5: Split the albums-list gate**

In `web/src/lib/components/album-page/AlbumsList.svelte`, add `isAlbumEditor` to the existing `$lib/utils/album-utils` import on line 20:

```ts
import {
  getSelectedAlbumGroupOption,
  isAlbumEditor,
  sortAlbums,
  stringToSortOrder,
  type AlbumGroup,
} from '$lib/utils/album-utils';
```

Replace the single `showFullContextMenu` derivation at line 173 with two:

```ts
// Editing follows the server's Permission.AlbumUpdate (owner ∪ editor). Delete stays
// owner-only because Permission.AlbumDelete is. Share stays owner-only because this menu
// has always gated it that way — the server's Permission.AlbumShare is actually owner ∪
// editor, so the UI is deliberately the stricter of the two, and widening it is not this
// change's business. `allowEdit` gates all of them — only /albums passes it, and a list
// that opted out of editing must not sprout an Edit entry.
let canEditSelectedAlbum = $derived(allowEdit && !!selectedAlbum && isAlbumEditor(selectedAlbum, authManager.user.id));
let isSelectedAlbumOwner = $derived(
  allowEdit && !!selectedAlbum && selectedAlbum.albumUsers[0].user.id === authManager.user.id,
);
```

Then rewrite the context menu block (line 292-301):

```svelte
<RightClickContextMenu title={$t('album_options')} {...contextMenuPosition} {isOpen} onClose={closeAlbumContextMenu}>
  {#if canEditSelectedAlbum}
    <MenuOption icon={mdiRenameOutline} text={$t('edit_album')} onClick={() => handleSelect('edit')} />
  {/if}
  {#if isSelectedAlbumOwner}
    <MenuOption icon={mdiShareVariantOutline} text={$t('share')} onClick={() => handleSelect('share')} />
  {/if}
  <MenuOption icon={mdiDownload} text={$t('download')} onClick={() => handleSelect('download')} />
  {#if isSelectedAlbumOwner}
    <MenuOption icon={mdiDeleteOutline} text={$t('delete')} onClick={() => handleSelect('delete')} />
  {/if}
</RightClickContextMenu>
```

- [ ] **Step 6: Run the web gates**

Run: `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm format`
Expected: clean, and no remaining references to `showFullContextMenu`. Confirm with `grep -rn "showFullContextMenu" web/src` — expect no output.

- [ ] **Step 7: Verify by hand**

With `make dev` running, log in as a user who is an **editor** on someone else's album, open `/albums`, right-click that album. Expected: Edit album and Download only — no Share, no Delete. Right-click an album you own: all four.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/components/album-page/AlbumsList.svelte web/src/lib/managers/command-items.ts web/src/lib/managers/command-items.spec.ts
git commit -m "feat(web): let album editors open the album edit modal"
```

---

### Task 8: Mobile — thread `createdAt` through repository, service and provider

**Files:**

- Modify: `mobile/lib/repositories/drift_album_api_repository.dart:71-99`
- Modify: `mobile/lib/domain/services/remote_album.service.dart:137-160`
- Modify: `mobile/lib/providers/infrastructure/remote_album.provider.dart:154-183`
- Test: `mobile/test/repositories/drift_album_api_repository_test.dart`
- Test: `mobile/test/domain/services/remote_album_service_test.dart`

**Interfaces:**

- Consumes: Dart `api.UpdateAlbumDto({Optional<DateTime?> createdAt})` (Task 2).
- Produces: `DriftAlbumApiRepository.updateAlbum(..., {DateTime? createdAt})`, `RemoteAlbumService.updateAlbum(..., {DateTime? createdAt})`, `RemoteAlbumNotifier.updateAlbum(..., {DateTime? createdAt})`. Task 9 calls the provider method.

Nothing else on mobile changes: `toRemoteAlbum` already maps `createdAt` (`drift_album_api_repository.dart:143`) and `RemoteAlbumRepository.update` already writes it (`remote_album.repository.dart:227-240`).

- [ ] **Step 1: Write the failing repository tests**

In `mobile/test/repositories/drift_album_api_repository_test.dart`, add the `UserDto` import:

```dart
import 'package:immich_mobile/domain/models/user.model.dart';
```

register a fallback in the existing `setUpAll`:

```dart
    registerFallbackValue(api.UpdateAlbumDto());
```

and add a new group:

```dart
  group('updateAlbum', () {
    final owner = UserDto(id: 'u1', email: 'u1@example.com', name: 'u1', profileChangedAt: DateTime(2024));

    test('sends createdAt as Optional.present and serializes it as UTC', () async {
      when(() => mockApi.updateAlbumInfo(any(), any())).thenAnswer((_) async => _album(id: 'a1'));
      final createdAt = DateTime.utc(1996, 6, 15, 14, 30);

      await repository.updateAlbum('a1', owner, createdAt: createdAt);

      final dto = verify(() => mockApi.updateAlbumInfo('a1', captureAny())).captured.single as api.UpdateAlbumDto;
      expect(dto.createdAt.isPresent, isTrue);
      expect(dto.createdAt.value, createdAt);
      // The generated toJson branches on _isEpochMarker(pattern) — it emits a raw
      // millisecondsSinceEpoch *number* when a field's OpenAPI pattern is the literal
      // 'epoch' (mobile/openapi/lib/api.dart:576,583), and value.toUtc().toIso8601String()
      // otherwise. createdAt carries the long ISO regex, so it takes the string branch and
      // satisfies the server's required timezone designator whatever zone the picker used.
      // Assert it rather than trust it: this is invisible generated code.
      expect(dto.toJson()['createdAt'], endsWith('Z'));
    });

    test('omits createdAt when it is not supplied', () async {
      when(() => mockApi.updateAlbumInfo(any(), any())).thenAnswer((_) async => _album(id: 'a1'));

      await repository.updateAlbum('a1', owner, name: 'Renamed');

      final dto = verify(() => mockApi.updateAlbumInfo('a1', captureAny())).captured.single as api.UpdateAlbumDto;
      expect(dto.createdAt.isPresent, isFalse);
    });
  });
```

Never read `.value` without checking `.isPresent` first — on an absent three-state field it throws.

- [ ] **Step 2: Write the failing service test**

In `mobile/test/domain/services/remote_album_service_test.dart`, add imports:

```dart
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
```

and a new group:

```dart
  group('updateAlbum', () {
    final owner = UserDto(id: 'u1', email: 'u1@example.com', name: 'u1', profileChangedAt: DateTime(2024));
    final updated = RemoteAlbum(
      id: 'a1',
      name: 'Album',
      ownerId: 'u1',
      description: '',
      createdAt: DateTime.utc(1996, 6, 15, 14, 30),
      updatedAt: DateTime(2026),
      isActivityEnabled: false,
      order: AlbumAssetOrder.desc,
      assetCount: 0,
      ownerName: 'u1',
      isShared: false,
    );

    test('forwards createdAt to the api repository and stores the result locally', () async {
      when(() => repository.getOwner(any())).thenAnswer((_) async => owner);
      when(() => repository.update(any())).thenAnswer((_) async {});
      when(
        () => albumApiRepository.updateAlbum(
          any(),
          any(),
          name: any(named: 'name'),
          description: any(named: 'description'),
          thumbnailAssetId: any(named: 'thumbnailAssetId'),
          isActivityEnabled: any(named: 'isActivityEnabled'),
          order: any(named: 'order'),
          createdAt: any(named: 'createdAt'),
        ),
      ).thenAnswer((_) async => updated);

      final createdAt = DateTime.utc(1996, 6, 15, 14, 30);
      await sut.updateAlbum('a1', createdAt: createdAt);

      verify(
        () => albumApiRepository.updateAlbum(
          'a1',
          owner,
          name: null,
          description: null,
          thumbnailAssetId: null,
          isActivityEnabled: null,
          order: null,
          createdAt: createdAt,
        ),
      ).called(1);
      verify(() => repository.update(updated)).called(1);
    });
  });
```

Add to a `setUpAll` (create one if the file has none):

```dart
  setUpAll(() {
    registerFallbackValue(UserDto(id: 'fallback', email: 'f@e.com', name: 'f', profileChangedAt: DateTime(2024)));
  });
```

- [ ] **Step 3: Run both to verify they fail**

```bash
cd mobile && flutter test test/repositories/drift_album_api_repository_test.dart \
                          test/domain/services/remote_album_service_test.dart
```

Expected: compile errors — `updateAlbum` has no named parameter `createdAt`.

Use the Flutter version pinned in `mobile/mise.toml` (read it; the pin has moved before). One-time setup: `flutter pub get`, then `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`. Export `PATH` **before** `cd`, not chained after it — a failed `cd` short-circuits the `&&` and you silently get the default toolchain.

- [ ] **Step 4: Add the parameter to the API repository**

In `mobile/lib/repositories/drift_album_api_repository.dart`:

```dart
  Future<RemoteAlbum> updateAlbum(
    String albumId,
    UserDto owner, {
    String? name,
    String? description,
    String? thumbnailAssetId,
    bool? isActivityEnabled,
    AlbumAssetOrder? order,
    DateTime? createdAt,
  }) async {
    AssetOrder? apiOrder;
    if (order != null) {
      apiOrder = order == AlbumAssetOrder.asc ? AssetOrder.asc : AssetOrder.desc;
    }

    final responseDto = await checkNull(
      _api.updateAlbumInfo(
        albumId,
        UpdateAlbumDto(
          albumName: name == null ? const Optional.absent() : Optional.present(name),
          description: description == null ? const Optional.absent() : Optional.present(description),
          createdAt: createdAt == null ? const Optional.absent() : Optional.present(createdAt),
          albumThumbnailAssetId: thumbnailAssetId == null
              ? const Optional.absent()
              : Optional.present(thumbnailAssetId),
          isActivityEnabled: isActivityEnabled == null ? const Optional.absent() : Optional.present(isActivityEnabled),
          order: apiOrder == null ? const Optional.absent() : Optional.present(apiOrder),
        ),
      ),
    );

    return responseDto.toRemoteAlbum(owner);
  }
```

- [ ] **Step 5: Add the parameter to the service**

In `mobile/lib/domain/services/remote_album.service.dart:137`:

```dart
  Future<RemoteAlbum> updateAlbum(
    String albumId, {
    String? name,
    String? description,
    String? thumbnailAssetId,
    bool? isActivityEnabled,
    AlbumAssetOrder? order,
    DateTime? createdAt,
  }) async {
    final owner = await _repository.getOwner(albumId);
    final updatedAlbum = await _albumApiRepository.updateAlbum(
      albumId,
      owner,
      name: name,
      description: description,
      thumbnailAssetId: thumbnailAssetId,
      isActivityEnabled: isActivityEnabled,
      order: order,
      createdAt: createdAt,
    );

    // Update the local database
    await _repository.update(updatedAlbum);

    return updatedAlbum;
  }
```

- [ ] **Step 6: Add the parameter to the provider**

In `mobile/lib/providers/infrastructure/remote_album.provider.dart:154`, add `DateTime? createdAt,` to the parameter list and `createdAt: createdAt,` to the `_remoteAlbumService.updateAlbum(...)` call. Leave the rest of the method — the state splice and the error logging — untouched.

- [ ] **Step 7: Run both tests to verify they pass**

```bash
cd mobile && flutter test test/repositories/drift_album_api_repository_test.dart \
                          test/domain/services/remote_album_service_test.dart
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/lib/repositories/drift_album_api_repository.dart \
        mobile/lib/domain/services/remote_album.service.dart \
        mobile/lib/providers/infrastructure/remote_album.provider.dart \
        mobile/test/repositories/drift_album_api_repository_test.dart \
        mobile/test/domain/services/remote_album_service_test.dart
git commit -m "feat(mobile): plumb album createdAt through the update path"
```

---

### Task 9: Mobile — date row in the edit dialog, and let editors reach it

**Files:**

- Modify: `mobile/lib/presentation/pages/drift_remote_album.page.dart` — `_EditAlbumDialog` (`:242-380`) and `_AlbumKebabMenu` (`:441-465`)
- Test: `mobile/test/presentation/pages/drift_remote_album_page_test.dart`

**Interfaces:**

- Consumes: `RemoteAlbumNotifier.updateAlbum(..., {DateTime? createdAt})` (Task 8), `showDateTimePicker` from `mobile/lib/widgets/common/date_time_picker.dart`.
- Produces: nothing.

**Gating decision.** `_AlbumKebabMenu` already resolves owner-or-editor: a `FutureBuilder` over `remoteAlbumServiceProvider.getUserRole(album.id, user.id)` yields `canAddPhotos`, combined as `isOwner || canAddPhotos` for `onAddPhotos`, defaulting to `false` while pending. `onEditAlbum` is **already inside that same builder** — the change is one expression, not a restructure. Do **not** introduce a `canEditAlbum` predicate over `RemoteAlbum.currentUserRole`: that field is null unless `getAll` was passed `currentUserId`, `updateAlbum` replaces the state album with `toRemoteAlbum()` output which carries no role at all, and a fail-open predicate would contradict the fail-closed builder three lines above it.

`onEditTitle` (`:226`) stays on `isOwner` — that widget has no `FutureBuilder`, and adding one to the app bar to relax a title tap is out of proportion. Editors reach the dialog through the kebab.

- [ ] **Step 1: Write the failing gating tests**

**Two hard constraints on every test in this file, both learned the hard way:**

1. **Never call `pumpAndSettle`.** `pumpAlbumPage` documents why: the app bar runs a continuous zoom-pan background animation, so `pumpAndSettle` never returns and the test times out. Use explicit `pump()` frames, exactly as the existing tests do.
2. **Do not open the kebab menu to assert on it.** The changed expression is `onEditAlbum: isOwner || canAddPhotos ? onEditAlbum : null`. Read it straight off the widget instead — no overlay, no animation, and it cannot pass vacuously. (Driving the menu would also need `Icons.more_vert_rounded`, not `Icons.more_vert` — `drift_album_option.widget.dart:168`. A `find.byIcon` typo makes a `findsNothing` assertion pass for the wrong reason, which is exactly the failure mode this file has a history of.)

First parameterise `pumpAlbumPage` and have it return the mocked service so tests can verify calls against it. Add `import 'dart:async';` (for `Completer`) and `import 'package:immich_mobile/presentation/widgets/remote_album/drift_album_option.widget.dart';`.

Change its signature and the two stubs that need to vary; everything else in the body stays as it is, including the trailing `pump()` sequence:

```dart
  Future<_MockRemoteAlbumService> pumpAlbumPage(
    WidgetTester tester, {
    String ownerId = 'user-1',
    AlbumUserRole role = AlbumUserRole.viewer,
    Completer<AlbumUserRole?>? roleCompleter,
  }) async {
    final user = _user('user-1');
    final album = _albumFixture(ownerId);

    final albumService = _MockRemoteAlbumService();
    // ... existing watchAlbum / watchDateRange / getSharedUsers stubs unchanged ...

    // An unresolved completer lets a test observe the pending state of the role lookup.
    when(() => albumService.getUserRole(any(), any())).thenAnswer(
      (_) => roleCompleter?.future ?? Future.value(role),
    );
    when(
      () => albumService.updateAlbum(
        any(),
        name: any(named: 'name'),
        description: any(named: 'description'),
        createdAt: any(named: 'createdAt'),
      ),
    ).thenAnswer((_) async => album);

    // ... existing factory / userService setup and pumpWidget call unchanged ...

    return albumService;
  }
```

`_albumFixture` already takes the owner id. `RemoteAlbumNotifier.build()` only reads `remoteAlbumServiceProvider` and returns empty state — no eager fetch — so the un-overridden `remoteAlbumProvider` routes straight to this mock.

Then add a helper and the gating tests:

```dart
  DriftRemoteAlbumOption _albumOption(WidgetTester tester) =>
      tester.widget<DriftRemoteAlbumOption>(find.byType(DriftRemoteAlbumOption));

  testWidgets('owner gets the edit album affordance', (tester) async {
    await pumpAlbumPage(tester, ownerId: 'user-1');

    expect(_albumOption(tester).onEditAlbum, isNotNull);
  });

  testWidgets('editor gets the edit album affordance', (tester) async {
    await pumpAlbumPage(tester, ownerId: 'someone-else', role: AlbumUserRole.editor);

    expect(_albumOption(tester).onEditAlbum, isNotNull);
  });

  testWidgets('viewer does not get the edit album affordance', (tester) async {
    await pumpAlbumPage(tester, ownerId: 'someone-else', role: AlbumUserRole.viewer);

    expect(_albumOption(tester).onEditAlbum, isNull);
  });

  testWidgets('edit album affordance is withheld while the role is still resolving', (tester) async {
    final completer = Completer<AlbumUserRole?>();
    await pumpAlbumPage(tester, ownerId: 'someone-else', roleCompleter: completer);

    // FutureBuilder default is `snapshot.data ?? false` — fail closed, matching onAddPhotos.
    expect(_albumOption(tester).onEditAlbum, isNull);

    completer.complete(AlbumUserRole.editor);
    await tester.pump();
    await tester.pump();

    expect(_albumOption(tester).onEditAlbum, isNotNull);
  });
```

The pending case must use an unresolved `Completer`, not a resolved future — otherwise it silently duplicates the editor test.

- [ ] **Step 2: Write the failing dialog tests**

Open the dialog by invoking the callback the previous step just asserted on, rather than tapping through the menu overlay. Same reason: no `pumpAndSettle`, no icon lookup, and the dialog is what these tests are actually about.

```dart
  Future<void> _openEditDialog(WidgetTester tester) async {
    _albumOption(tester).onEditAlbum!();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  }

  testWidgets('edit dialog shows the album created date', (tester) async {
    await pumpAlbumPage(tester, ownerId: 'user-1');
    await _openEditDialog(tester);

    expect(find.byKey(const Key('album-edit-created-at')), findsOneWidget);
    // _albumFixture pins createdAt to 2026-01-01; DateFormat.yMMMd() renders "Jan 1, 2026".
    expect(find.text(DateFormat.yMMMd().format(DateTime(2026, 1, 1))), findsOneWidget);
  });

  testWidgets('saving without touching the date keeps the original created date', (tester) async {
    final albumService = await pumpAlbumPage(tester, ownerId: 'user-1');
    await _openEditDialog(tester);

    await tester.tap(find.byKey(const Key('album-edit-save')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    verify(
      () => albumService.updateAlbum(
        'album-1',
        name: 'Test Album',
        description: any(named: 'description'),
        createdAt: DateTime(2026, 1, 1),
      ),
    ).called(1);
  });
```

The second test is M7: dismissing the picker (or never opening it) must send the album's original instant, not `DateTime.now()`. Add `import 'package:intl/intl.dart';` to the test for `DateFormat`.

- [ ] **Step 3: Run to verify they fail**

Run: `cd mobile && flutter test test/presentation/pages/drift_remote_album_page_test.dart`
Expected: FAIL — the editor/viewer gating is still owner-only, and the dialog has no date row or keyed save button.

Prove each new test can go red before making it green: invert one expectation (`isNotNull` ↔ `isNull`, `findsOneWidget` ↔ `findsNothing`) and confirm the result flips. Widget tests in this file have a history of passing vacuously. If any test hangs instead of failing, you have reintroduced a `pumpAndSettle`.

- [ ] **Step 4: Relax the kebab gate**

In `mobile/lib/presentation/pages/drift_remote_album.page.dart`, inside the `FutureBuilder` builder (`:459`), change one line:

```dart
          onEditAlbum: isOwner || canAddPhotos ? onEditAlbum : null,
```

Leave `onDeleteAlbum`, `onAddUsers`, `onToggleAlbumOrder`, `onCreateSharedLink` and `onLinkToSpace` on `isOwner`.

`drift_album_option.widget.dart` itself needs no change — the tests read `onEditAlbum` off the widget rather than off the rendered menu, so its `BaseActionButton` needs no key.

- [ ] **Step 5: Add the date row to the dialog**

In `_EditAlbumDialogState`, add the imports at the top of the file:

```dart
import 'package:immich_mobile/widgets/common/date_time_picker.dart';
import 'package:intl/intl.dart';
```

`intl` is a direct dependency (`mobile/pubspec.yaml:44`, `intl: ^0.20.2`), so this needs no pubspec change.

Add state and a picker handler:

```dart
  late DateTime createdAt;

  @override
  void initState() {
    super.initState();
    titleController = TextEditingController(text: widget.album.name);
    descriptionController = TextEditingController(
      text: widget.album.description.isEmpty ? '' : widget.album.description,
    );
    createdAt = widget.album.createdAt;
  }

  Future<void> _pickCreatedAt() async {
    // Returns an ISO string with a +HH:MM offset, or null when dismissed —
    // same contract action.service.dart:202-219 consumes for asset dates.
    final picked = await showDateTimePicker(context: context, initialDateTime: createdAt);
    if (picked == null) {
      return;
    }
    setState(() => createdAt = DateTime.parse(picked));
  }
```

Pass it through in `_handleSave`:

```dart
      await ref
          .read(remoteAlbumProvider.notifier)
          .updateAlbum(widget.album.id, name: newTitle, description: newDescription, createdAt: createdAt);
```

Insert the row in `build`, after the Description `TextFormField` and before the `SizedBox(height: 24)` that precedes the action buttons:

```dart
                const SizedBox(height: 18),

                // Created date
                Text(
                  'date_created'.t(context: context).toUpperCase(),
                  style: context.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 4),
                ListTile(
                  key: const Key('album-edit-created-at'),
                  tileColor: context.colorScheme.surface,
                  shape: const RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
                  title: Text(DateFormat.yMMMd().format(createdAt), style: context.textTheme.bodyMedium),
                  trailing: Icon(Icons.edit_outlined, size: 18, color: context.colorScheme.primary),
                  onTap: _pickCreatedAt,
                ),
```

Give the dialog's save button `key: const Key('album-edit-save')`.

Note the shared picker hard-codes `lastDate: now`, so future dates are unreachable on mobile. That asymmetry with web is deliberate (spec §5) and matches how asset date editing already behaves.

- [ ] **Step 6: Run to verify the tests pass**

Run: `cd mobile && flutter test test/presentation/pages/drift_remote_album_page_test.dart`
Expected: PASS.

- [ ] **Step 7: Run the mobile gates**

```bash
cd mobile && dart analyze --fatal-infos
cd mobile && dart format --set-exit-if-changed --output=none \
  lib/presentation/pages/drift_remote_album.page.dart \
  lib/repositories/drift_album_api_repository.dart \
  lib/domain/services/remote_album.service.dart \
  lib/providers/infrastructure/remote_album.provider.dart
```

Format **only** the files you touched. `dart format .` reformats hundreds of files because the local Flutter formats differently from CI, and CI's task covers `lib` only.

- [ ] **Step 8: Commit**

```bash
git add mobile/lib/presentation/pages/drift_remote_album.page.dart \
        mobile/test/presentation/pages/drift_remote_album_page_test.dart
git commit -m "feat(mobile): edit an album's creation date from the album menu"
```

---

## Final verification

- [ ] **Run every gate**

```bash
cd server && pnpm test --run src/services/album.service.spec.ts
cd server && pnpm check && pnpm lint && pnpm format
cd web && pnpm test --run src/lib/modals/AlbumEditModal.spec.ts src/lib/utils/album-utils.spec.ts src/lib/managers/command-items.spec.ts
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm format
cd e2e && pnpm test src/specs/server/api/album.e2e-spec.ts
cd mobile && flutter test test/repositories/drift_album_api_repository_test.dart \
                          test/domain/services/remote_album_service_test.dart \
                          test/presentation/pages/drift_remote_album_page_test.dart
cd mobile && dart analyze --fatal-infos
```

- [ ] **Manual cross-platform check**

Backdate an album to 1996 on web, sort `/albums` by Date created descending, confirm it lands last **without a page reload** — that is spec scenario W11, the only one with no automated home, because there is no `/albums` page spec and `handleUpdateAlbum`'s `eventManager.emit('AlbumUpdate', …)` → re-derive → `sortAlbums` chain is not worth standing a page harness up for. Open the same album on mobile after a sync and confirm the kebab's Edit dialog shows 1996. Backdate a second album from mobile and confirm web agrees after a refresh.

Spec scenarios W6–W8 are likewise verified at two removes: the predicate is unit-tested in Task 5, and the menu wiring by Task 7's type-check plus its manual step. Task 7 Step 7 is not optional.

- [ ] **PR description**

Call out the two things a reviewer will not see in the diff:

1. **`createdAt` stops being an audit field.** The previous value is overwritten with no undo, and unsorted API/CLI listings (`album.repository.ts:148,283,421` order by `createdAt desc`) will show backdated albums at the bottom.
2. **On web the date is changed from the albums list, not from the album page.** `AlbumEditModal` is reachable from the `/albums` right-click menu and the command palette only; both album detail pages edit title and description inline and never open it. Mobile puts it in the kebab. Spec §3.1 records why.
