# Space Albums Parity — Slice 1: Enriched linked-albums endpoint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /shared-spaces/:id/albums` returns `AlbumResponseDto`-shaped data plus the space fields (`showInTimeline`, `addedById`, `linkedAt`), with the per-album N+1 asset-count query removed, and existing web consumers migrated to the renamed fields so the app stays green.

**Architecture:** Enrich `SharedSpaceLinkedAlbumSchema` by extending `AlbumResponseSchema`. Rewrite the service `getLinkedAlbums` to mirror `AlbumService.getAll` — one rich repo query for album rows (via a fork-local replica of the private `withAlbumUsers`/`withSharedLink` selectors) + one bulk `albumRepository.getMetadataForIds` call, merged through the reused `mapAlbum` mapper. Rename the link timestamp `createdAt` → `linkedAt` and expose the album `id` (dropping `albumId`).

**Tech Stack:** NestJS, Kysely, nestjs-zod (Zod 4), Vitest (unit + medium/testcontainers), Playwright/vitest e2e, `@immich/sdk` (oazapfts).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-space-albums-page-parity-design.md` (§6 server architecture, §7 TDD, Slice 1).
- Fork-isolation: touch only fork files (`shared-space.*`, `spaces/[spaceId]/albums/*`, `space-album-card.svelte`) — do NOT edit `album.repository.ts`/`album.dto.ts`/`album.service.ts` (import/reuse only). `withAlbumUsers`/`withSharedLink` are **module-private** in `album.repository.ts` — **replicate** them in the fork repo; do not export them from upstream.
- `getLinkedAlbums` is `@GenerateSql`-decorated → after changing it run `make sql` (with a running DB) to regenerate `server/src/queries/shared.space.repository.sql`.
- After the DTO change, regenerate the SDK: `cd server && pnpm build && pnpm sync:open-api` then `make open-api-typescript`.
- Server code style: no relative imports (use `src/` alias); Prettier 120-col; ESLint `--max-warnings 0`.
- Commit style: no `Co-Authored-By`/`Generated-with` trailers.
- Run server tests from `server/`: `pnpm test -- --run <file>`.

## File Structure

- Modify `server/src/dtos/shared-space.dto.ts` — enrich `SharedSpaceLinkedAlbumSchema`.
- Modify `server/src/repositories/shared-space.repository.ts` — rich `getLinkedAlbums` + replicated selectors; remove `getAlbumAssetCount` once unused.
- Modify `server/src/services/shared-space.service.ts` — rewrite `getLinkedAlbums`.
- Modify `server/src/services/shared-space.service.spec.ts` — update + add unit cases.
- Create `server/src/services/shared-space.service.medium.spec.ts` — real-DB integration.
- Modify `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts` — enriched response-shape assertion.
- Modify `web/src/lib/components/spaces/space-album-card.svelte`, `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte`, and their specs — field renames.
- Regenerate `server/src/queries/shared.space.repository.sql` (via `make sql`) and the TS SDK.

---

## Task 1: Enrich the DTO + rewrite the service (unit-test driven)

**Files:**

- Modify: `server/src/dtos/shared-space.dto.ts:141-151` (schema) — `SharedSpaceLinkedAlbumSchema`.
- Modify: `server/src/services/shared-space.service.ts:695-711` — `getLinkedAlbums`.
- Test: `server/src/services/shared-space.service.spec.ts:8010-8059` (update) + new cases.

**Interfaces:**

- Consumes: `AlbumResponseSchema` (exported, `server/src/dtos/album.dto.ts:108`); `mapAlbum` (`album.dto.ts:169`, `(entity: MaybeDehydrated<MapAlbumDto>) => AlbumResponseDto`); `AlbumAssetCount` + `albumRepository.getMetadataForIds(ids: string[]): Promise<AlbumAssetCount[]>` (`album.repository.ts:23,162`); `asDateTimeString` (same import album.service.ts uses).
- Produces: enriched `SharedSpaceLinkedAlbumDto` = `AlbumResponseDto` + `{ showInTimeline: boolean; addedById: string | null; linkedAt: string }`; the repo now must return `MapAlbumDto`-shaped rows + `{ addedById, showInTimeline, linkedAt }` (implemented in Task 2 — the unit test mocks these rows).

- [ ] **Step 1: Update + extend the unit test (red-first).**

Replace the `describe('getLinkedAlbums', ...)` block at `shared-space.service.spec.ts:8010-8059` with tests that mock a **rich** repo row and `mocks.album.getMetadataForIds`. Use the existing helpers (`factory.auth`, `factory.sharedSpace`, `makeMemberResult`, `newUuid`). A rich row is a `MapAlbumDto` shape + space fields:

```ts
describe('getLinkedAlbums', () => {
  const makeRichRow = (over: Record<string, unknown> = {}) => {
    const albumId = newUuid();
    return {
      id: albumId,
      albumName: 'My Album',
      description: '',
      albumThumbnailAssetId: null,
      createdAt: new Date('2024-06-01T00:00:00.000Z'), // ALBUM created
      updatedAt: new Date('2024-06-02T00:00:00.000Z'),
      isActivityEnabled: true,
      order: AssetOrder.Desc,
      albumUsers: [{ role: AlbumUserRole.Owner, user: factory.user({ name: 'Owner One' }) }],
      sharedLinks: [],
      addedById: newUuid(),
      showInTimeline: true,
      linkedAt: new Date('2025-01-01T00:00:00.000Z'), // LINK created
      ...over,
    };
  };

  const arrange = (rows: Record<string, unknown>[], metadata: unknown[] = []) => {
    const auth = factory.auth({ user: { isAdmin: false } });
    const space = factory.sharedSpace();
    mocks.sharedSpace.getMember.mockResolvedValue(
      makeMemberResult({ spaceId: space.id, userId: auth.user.id, role: SharedSpaceRole.Viewer }),
    );
    mocks.sharedSpace.getLinkedAlbums.mockResolvedValue(rows as any);
    mocks.album.getMetadataForIds.mockResolvedValue(metadata as any);
    return { auth, space };
  };

  it('returns AlbumResponseDto-shaped data + space fields, with album createdAt distinct from linkedAt', async () => {
    const row = makeRichRow();
    const { auth, space } = arrange(
      [row],
      [
        {
          albumId: row.id,
          assetCount: 7,
          startDate: new Date('2024-06-01'),
          endDate: new Date('2024-06-30'),
          lastModifiedAssetTimestamp: new Date('2024-06-30'),
        },
      ],
    );

    const result = await sut.getLinkedAlbums(auth, space.id);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: row.id,
      albumName: 'My Album',
      showInTimeline: true,
      addedById: row.addedById,
      assetCount: 7,
      albumThumbnailAssetId: null,
      linkedAt: (row.linkedAt as Date).toISOString(),
      createdAt: (row.createdAt as Date).toISOString(),
    });
    expect(result[0].createdAt).not.toEqual(result[0].linkedAt);
    expect(result[0].albumUsers[0].user.name).toBe('Owner One');
  });

  it('bulk-fetches metadata once and never calls the per-album N+1 count', async () => {
    const rows = [makeRichRow(), makeRichRow()];
    const { auth, space } = arrange(
      rows,
      rows.map((r) => ({
        albumId: r.id,
        assetCount: 1,
        startDate: null,
        endDate: null,
        lastModifiedAssetTimestamp: null,
      })),
    );

    await sut.getLinkedAlbums(auth, space.id);

    expect(mocks.album.getMetadataForIds).toHaveBeenCalledTimes(1);
    expect(mocks.album.getMetadataForIds).toHaveBeenCalledWith(rows.map((r) => r.id));
    expect(mocks.sharedSpace.getAlbumAssetCount).not.toHaveBeenCalled();
  });

  it('returns [] for an empty space and skips the metadata query', async () => {
    const { auth, space } = arrange([]);
    const result = await sut.getLinkedAlbums(auth, space.id);
    expect(result).toEqual([]);
    expect(mocks.album.getMetadataForIds).not.toHaveBeenCalled();
  });

  it('reports 0 assetCount and null dates for an album with no assets', async () => {
    const row = makeRichRow();
    const { auth, space } = arrange([row], []); // no metadata row for this album
    const result = await sut.getLinkedAlbums(auth, space.id);
    expect(result[0].assetCount).toBe(0);
    expect(result[0].startDate).toBeUndefined();
    expect(result[0].endDate).toBeUndefined();
  });

  it('marks a multi-user album as shared', async () => {
    const row = makeRichRow({
      albumUsers: [
        { role: AlbumUserRole.Owner, user: factory.user({ name: 'Owner' }) },
        { role: AlbumUserRole.Editor, user: factory.user({ name: 'Editor' }) },
      ],
    });
    const { auth, space } = arrange(
      [row],
      [{ albumId: row.id, assetCount: 3, startDate: null, endDate: null, lastModifiedAssetTimestamp: null }],
    );
    const result = await sut.getLinkedAlbums(auth, space.id);
    expect(result[0].shared).toBe(true);
    expect(result[0].albumUsers).toHaveLength(2);
  });

  it('preserves null addedById, null thumbnail, and showInTimeline=false', async () => {
    const row = makeRichRow({ addedById: null, albumThumbnailAssetId: null, showInTimeline: false });
    const { auth, space } = arrange(
      [row],
      [{ albumId: row.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null }],
    );
    const result = await sut.getLinkedAlbums(auth, space.id);
    expect(result[0].addedById).toBeNull();
    expect(result[0].albumThumbnailAssetId).toBeNull();
    expect(result[0].showInTimeline).toBe(false);
  });

  it('rejects a non-member with ForbiddenException', async () => {
    const auth = factory.auth({ user: { isAdmin: false } });
    mocks.sharedSpace.getMember.mockResolvedValue(void 0 as any);
    await expect(sut.getLinkedAlbums(auth, newUuid())).rejects.toThrow(ForbiddenException);
  });
});
```

Add any missing imports to the spec top (`AssetOrder`, `AlbumUserRole` from `src/enum`; confirm `factory.user` exists in `small.factory.ts`). If `factory.user` is absent, build the user object inline with `{ id, name, email }` matching `mapUser`'s needs.

- [ ] **Step 2: Run the test — expect RED.**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t getLinkedAlbums`
Expected: FAIL — current service returns `albumId`/link-`createdAt` shape and calls `getAlbumAssetCount`; assertions on `id`/`linkedAt`/`getMetadataForIds` fail.

- [ ] **Step 3: Enrich the DTO schema.**

In `server/src/dtos/shared-space.dto.ts`, add the import and replace the schema (`:141-151`):

```ts
import { AlbumResponseSchema } from 'src/dtos/album.dto';
// ...
const SharedSpaceLinkedAlbumSchema = AlbumResponseSchema.extend({
  showInTimeline: z.boolean().describe('Include this album in the space timeline'),
  addedById: z.string().nullable().describe('User who linked the album into the space'),
  linkedAt: z.string().meta({ format: 'date-time' }).describe('Link creation timestamp'),
}).meta({ id: 'SharedSpaceLinkedAlbumDto' });
```

Keep the `export class SharedSpaceLinkedAlbumDto extends createZodDto(SharedSpaceLinkedAlbumSchema) {}` line. (If `AlbumResponseSchema.extend` is unavailable because the export is post-`.meta()`, import the raw object or use `AlbumResponseSchema.and(z.object({...}))` — verify `AlbumResponseSchema` is a `ZodObject` at `album.dto.ts:108`.)

- [ ] **Step 4: Rewrite the service `getLinkedAlbums`.**

In `server/src/services/shared-space.service.ts`, add imports (`mapAlbum` from `src/dtos/album.dto`; `AlbumAssetCount` from `src/repositories/album.repository`; `asDateTimeString` — copy the exact import album.service.ts uses) and replace `:695-711`:

```ts
async getLinkedAlbums(auth: AuthDto, spaceId: string): Promise<SharedSpaceLinkedAlbumDto[]> {
  await this.requireMembership(auth, spaceId);
  const rows = await this.sharedSpaceRepository.getLinkedAlbums(spaceId);
  if (rows.length === 0) {
    return [];
  }
  const metadata = await this.albumRepository.getMetadataForIds(rows.map((row) => row.id));
  const byId: Record<string, AlbumAssetCount> = {};
  for (const m of metadata) {
    byId[m.albumId] = m;
  }
  return rows.map((row) => ({
    ...mapAlbum(row),
    sharedLinks: undefined,
    startDate: asDateTimeString(byId[row.id]?.startDate ?? undefined),
    endDate: asDateTimeString(byId[row.id]?.endDate ?? undefined),
    assetCount: byId[row.id]?.assetCount ?? 0,
    lastModifiedAssetTimestamp: asDateTimeString(byId[row.id]?.lastModifiedAssetTimestamp ?? undefined),
    showInTimeline: row.showInTimeline,
    addedById: row.addedById,
    linkedAt: (row.linkedAt as unknown as Date).toISOString(),
  }));
}
```

Confirm `this.albumRepository` is available on the service (it is injected via `BaseService`; grep `this.albumRepository` elsewhere to confirm the property name). The `row` type comes from the repo (Task 2); until then TS may widen — the unit test mocks it, so unit tests pass now.

- [ ] **Step 5: Run the test — expect GREEN.**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t getLinkedAlbums`
Expected: PASS (all 7 cases).

- [ ] **Step 6: Typecheck + lint.**

Run: `cd server && pnpm check && pnpm lint`
Expected: no errors. (Type of `rows` may still be the thin repo type until Task 2; if `mapAlbum(row)` fails typecheck because the repo return type lacks `description`/`updatedAt`, proceed to Task 2 which fixes the repo return shape, then re-run.)

- [ ] **Step 7: Commit.**

```bash
git add server/src/dtos/shared-space.dto.ts server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(spaces): enrich linked-albums service to AlbumResponseDto shape + linkedAt"
```

---

## Task 2: Rich repo query (+ replicate selectors) + regenerate SQL & SDK (medium-test driven)

**Files:**

- Test: `server/src/services/shared-space.service.medium.spec.ts` (create).
- Modify: `server/src/repositories/shared-space.repository.ts:427-444` (`getLinkedAlbums`); remove `getAlbumAssetCount` (`:480-490`) if now unused (grep first).
- Regenerate: `server/src/queries/shared.space.repository.sql`, TS SDK.

**Interfaces:**

- Consumes: kysely helpers `jsonArrayFrom`/`jsonObjectFrom`, `columns` (`src/database`), `dummy` (`src/utils/database`) — the imports `album.repository.ts` uses for `withAlbumUsers`/`withSharedLink`.
- Produces: `sharedSpaceRepository.getLinkedAlbums(spaceId)` returning rows = `MapAlbumDto` fields (`id, albumName, description, albumThumbnailAssetId, createdAt, updatedAt, isActivityEnabled, order, albumUsers, sharedLinks`) + `{ addedById: string | null, showInTimeline: boolean, linkedAt: Date }`.

- [ ] **Step 1: Write the medium (real-DB) test first (red).**

Create `server/src/services/shared-space.service.medium.spec.ts`. Follow the medium harness (see `server/src/services/identity-merge-propagation.service.spec.ts` for the `newMediumService`/`getRepository` pattern and `test/medium.factory.ts` album seeding: `AlbumRepository.create`, `addAssetIds`). Seed: a space + an owner member + one album with 2 assets, one empty album, one album owned by a different user, one soft-deleted album linked. Assert `sut.getLinkedAlbums(auth, space.id)`:

- returns the non-deleted linked albums only (soft-deleted excluded);
- the 2-asset album has `assetCount === 2` and non-null `startDate`/`endDate`;
- the empty album has `assetCount === 0`, `startDate`/`endDate` undefined;
- the other-owner album's `albumUsers[0].user.id` is that other user;
- results are in `album.createdAt DESC` order (deterministic);
- `linkedAt` equals the link row's created timestamp and differs from the album `createdAt`.

Name each assertion explicitly; do not leave "assert edge cases". (If `newMediumService` for `SharedSpaceService` requires wiring extra real repos, register them via `getRepository(...)` per `medium.factory.ts` — `SharedSpaceRepository`, `AlbumRepository`, `AlbumUserRepository`, `AssetRepository` are already in `newRealRepository`.)

- [ ] **Step 2: Run the medium test — expect RED.**

Run: `cd server && pnpm test:medium -- --run src/services/shared-space.service.medium.spec.ts`
Expected: FAIL — the real repo still returns the thin shape, so `mapAlbum(row)` yields `undefined` album fields / missing `linkedAt`.

- [ ] **Step 3: Replicate the private selectors + rewrite the repo query.**

In `server/src/repositories/shared-space.repository.ts`, add (near the top, after imports) fork-local copies of the two private selectors from `album.repository.ts:35-53` (copy verbatim, adjusting the `ExpressionBuilder<DB, 'album'>` type param if the compiler requires the joined-table union), and add the imports they need (`jsonArrayFrom`, `jsonObjectFrom` from `kysely/helpers/postgres`; `columns` from `src/database`; `dummy` from `src/utils/database`). Then replace `getLinkedAlbums` (`:427-444`):

```ts
@GenerateSql({ params: [DummyValue.UUID] })
getLinkedAlbums(spaceId: string) {
  return this.db
    .selectFrom('shared_space_album')
    .innerJoin('album', 'album.id', 'shared_space_album.albumId')
    .selectAll('album')
    .select(withAlbumUsers())
    .select(withSharedLink)
    .select([
      'shared_space_album.addedById',
      'shared_space_album.showInTimeline',
      'shared_space_album.createdAt as linkedAt',
    ])
    .where('shared_space_album.spaceId', '=', spaceId)
    .where('album.deletedAt', 'is', null)
    .orderBy('album.createdAt', 'desc')
    .orderBy('album.id', 'asc')
    .execute();
}
```

- [ ] **Step 4: Remove the now-unused N+1 count method.**

Grep `getAlbumAssetCount` across `server/src`. If only its definition + the (now-removed) service call + its unit assertion remain, delete the method (`shared-space.repository.ts:480-490`). If any other caller exists, leave it. (Its `getAlbumAssetCount` mock assertion was already removed in Task 1.)

- [ ] **Step 5: Run the medium test — expect GREEN.**

Run: `cd server && pnpm test:medium -- --run src/services/shared-space.service.medium.spec.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate the query SQL (needs a running DB).**

Run: `make sql`
Expected: `server/src/queries/shared.space.repository.sql` updated — the `getLinkedAlbums` section now reflects the joined/aliased query; `getAlbumAssetCount` section removed. (Never run `make sql` without a DB up — it wipes query files.)

- [ ] **Step 7: Regenerate the SDK.**

Run: `cd server && pnpm build && pnpm sync:open-api` then from repo root `make open-api-typescript`
Expected: `open-api/typescript-sdk` `SharedSpaceLinkedAlbumDto` now carries the `AlbumResponseDto` fields + `showInTimeline`/`addedById`/`linkedAt`; `albumId`/link-`createdAt` gone.

- [ ] **Step 8: Server gate + commit.**

Run: `cd server && pnpm check && pnpm lint && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: green.

```bash
git add server/src/repositories/shared-space.repository.ts server/src/services/shared-space.service.medium.spec.ts server/src/queries/shared.space.repository.sql open-api/
git commit -m "feat(spaces): rich getLinkedAlbums query + bulk metadata, drop N+1; regen sql/sdk"
```

---

## Task 3: Update the API e2e response-shape contract

**Files:**

- Modify: `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts:228-244` (shape) + keep `:247-254` (absorbed invariant).

- [ ] **Step 1: Update the shape assertion + add an assets assertion.**

Rewrite the response-shape test (`:228-244`) to expect the enriched fields, and add a case asserting an album with assets reports the right count/date range:

```ts
it('response shape is AlbumResponseDto + space fields (id, albumName, showInTimeline, assetCount, linkedAt, addedById, albumUsers, shared)', async () => {
  const { body } = await listAlbums(owner.accessToken, spaceId); // helper already in file
  expect(body[0]).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      albumName: expect.any(String),
      showInTimeline: expect.any(Boolean),
      assetCount: expect.any(Number),
      albumThumbnailAssetId: expect.anything(),
      linkedAt: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      albumUsers: expect.any(Array),
      shared: expect.any(Boolean),
    }),
  );
  expect(body[0]).not.toHaveProperty('albumId');
});

it('reports the correct assetCount and date range for an album with assets', async () => {
  const { body } = await listAlbums(owner.accessToken, spaceId);
  const withAssets = body.find((a: any) => a.assetCount > 0);
  expect(withAssets).toBeDefined();
  expect(withAssets.startDate).toEqual(expect.any(String));
  expect(withAssets.endDate).toEqual(expect.any(String));
});
```

Keep the "absorbed invariant" test at `:247-254` unchanged (it asserts the linked album is absent from a plain member's `GET /albums`).

- [ ] **Step 2: Run e2e (needs the e2e stack) — expect GREEN.**

Run: `cd e2e && pnpm test -- --run src/specs/server/api/shared-space-album.e2e-spec.ts`
Expected: PASS (server already enriched via Tasks 1–2). If it references the SDK type, ensure the regenerated SDK is built.

- [ ] **Step 3: Commit.**

```bash
git add e2e/src/specs/server/api/shared-space-album.e2e-spec.ts
git commit -m "test(spaces): assert enriched linked-albums response shape (e2e)"
```

---

## Task 4: Migrate web consumers to the renamed fields (keep web green)

**Files:**

- Modify: `web/src/lib/components/spaces/space-album-card.svelte:54` (and any `album.albumId` reads).
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte:36,128` (`a.albumId` → `a.id`).
- Test: `web/src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts:66-77` (makeAlbum) and `web/src/lib/components/spaces/space-album-card.spec.ts:13-25` (inline album + href).

**Interfaces:**

- Consumes: regenerated SDK `SharedSpaceLinkedAlbumDto` (now `id`, not `albumId`; `linkedAt`, not link-`createdAt`).
- Produces: web reads `album.id`; routes `/spaces/{spaceId}/albums/{album.id}`.

- [ ] **Step 1: Update the specs first (red).**

In `space-albums-page.spec.ts` `makeAlbum` (`:66-77`), change `albumId` → `id` and `createdAt` → `linkedAt` (keep the rest). In `space-album-card.spec.ts` (`:13-21`) change the inline album `albumId` → `id`, `createdAt` → `linkedAt`; update the href assertion (`:25`) to `/spaces/s-1/albums/a-1` using `id: 'a-1'`.

- [ ] **Step 2: Run web tests — expect RED.**

Run: `cd web && pnpm test -- --run src/routes/\(user\)/spaces/\[spaceId\]/albums/space-albums-page.spec.ts src/lib/components/spaces/space-album-card.spec.ts`
Expected: FAIL — components still read `album.albumId`.

- [ ] **Step 3: Rename in the components.**

In `space-album-card.svelte`, replace `album.albumId` reads with `album.id` (the `href="/spaces/{spaceId}/albums/{album.id}"` and the `{#each}`/key if present). In `+page.svelte`, change `linkedAlbumIds = albums.map((a) => a.albumId)` → `a.id` (`:36`) and the `{#each albums as album (album.albumId)}` key → `(album.id)` (`:128`). Do NOT touch `SpaceLinkAlbumModal.svelte` (it uses `linkedAlbumIds: string[]` + `album.id`).

- [ ] **Step 4: Run web tests — expect GREEN + typecheck.**

Run: `cd web && pnpm test -- --run src/routes/\(user\)/spaces/\[spaceId\]/albums/space-albums-page.spec.ts src/lib/components/spaces/space-album-card.spec.ts && pnpm check:typescript`
Expected: PASS; typecheck clean against the regenerated SDK.

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/components/spaces/space-album-card.svelte web/src/routes/\(user\)/spaces/\[spaceId\]/albums/
git commit -m "refactor(spaces): migrate space-albums web consumers to id/linkedAt fields"
```

---

## Slice 1 exit gate

Run and confirm green (controller runs these itself, not just subagents):

- `cd server && pnpm test && pnpm check && pnpm lint`
- `cd server && pnpm test:medium -- --run src/services/shared-space.service.medium.spec.ts`
- `cd web && pnpm test && pnpm check:typescript && pnpm lint`
- `cd e2e && pnpm test -- --run src/specs/server/api/shared-space-album.e2e-spec.ts`
- SDK + `shared.space.repository.sql` regenerated and committed.

## Self-review checklist (author)

- Spec Slice 1 tests all present: enriched shape ✓, createdAt≠linkedAt ✓, N+1 gone ✓, empty→[] ✓, non-member Forbidden ✓, 0-asset ✓, shared ✓, null addedById/thumbnail/showInTimeline ✓, medium real-DB ✓, e2e shape + absorbed invariant + assets ✓, web renames ✓.
- No placeholders; every code step shows code.
- Type consistency: repo returns `MapAlbumDto`+space fields (Task 2) consumed by `mapAlbum` + service spread (Task 1); SDK regen (Task 2) precedes web typecheck (Task 4).
