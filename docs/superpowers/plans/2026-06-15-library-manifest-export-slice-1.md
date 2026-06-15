# Library Manifest Export — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GET /api/admin/users/:id/library-manifest` returning the first page (up to `MANIFEST_PAGE_SIZE`) of a user's owned, live, managed assets — fully mapped — with `albums: []`, `albumIds: []`, `nextCursor: null`. (Pagination = Slice 2; albums = Slice 3.)

**Architecture:** New dedicated `LibraryManifestController` (route group `admin/users`) → `LibraryManifestService` (extends `BaseService`) → a new narrow `AssetRepository.getOwnedManifestAssets` Kysely query. Zod DTOs via `createZodDto` + `.meta({ id })`, OpenAPI regenerated with `pnpm sync:open-api`.

**Tech Stack:** NestJS, Kysely (Postgres), nestjs-zod / Zod v4, Vitest (medium tests via testcontainers + controller specs), e2e (Vitest + supertest against the running stack).

**Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/library-manifest-export` (branch `feat/library-manifest-export`). Run all `pnpm` commands from `server/` unless noted. Prefix PATH with mise shims: `export PATH="$HOME/.local/share/mise/shims:$PATH"`.

**Spec:** `docs/superpowers/specs/2026-06-15-library-manifest-export-design.md`.

**Key decisions baked in (do not "fix"):**

- **404 via `NotFoundException`** for a missing user — deliberately more RESTful than the sibling `user-admin.service.findOrFail`, which throws `BadRequestException` (400). The manifest endpoint returns 404.
- User resolved **`withDeleted: true`** so a deactivated account is still exportable.
- Filter: `ownerId = :id AND deletedAt IS NULL AND status = 'active' AND libraryId IS NULL AND isExternal = false`, across all visibilities.
- `size` comes from `asset_exif.fileSizeInByte` (typed `number | null`) — JSON number, not string.
- `checksum` via the existing `hexOrBufferToBase64()` helper.

---

## Task 1: Constants

**Files:**

- Modify: `server/src/constants.ts`

- [ ] **Step 1: Add the constants** (after the existing `JOBS_*_PAGINATION_SIZE` lines, ~line 21)

```typescript
export const MANIFEST_PAGE_SIZE = 1000;
export const MANIFEST_SCHEMA_VERSION = 1;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/constants.ts
git commit -m "feat(manifest): add MANIFEST_PAGE_SIZE and MANIFEST_SCHEMA_VERSION constants"
```

---

## Task 2: DTOs

**Files:**

- Create: `server/src/dtos/library-manifest.dto.ts`

- [ ] **Step 1: Create the DTO file**

```typescript
import { createZodDto } from 'nestjs-zod';
import { AssetTypeSchema, ChecksumAlgorithm } from 'src/enum';
import z from 'zod';

const LibraryManifestOwnerSchema = z
  .object({
    id: z.uuidv4().describe('Owner user ID'),
    email: z.string().describe('Owner email'),
  })
  .meta({ id: 'LibraryManifestOwnerDto' });

const LibraryManifestAlbumSchema = z
  .object({
    id: z.uuidv4().describe('Album ID'),
    name: z.string().describe('Album name'),
  })
  .meta({ id: 'LibraryManifestAlbumDto' });

const LibraryManifestAssetSchema = z
  .object({
    assetId: z.uuidv4().describe('Asset ID'),
    objectKey: z.string().describe('Object-storage key (asset.originalPath)'),
    originalFileName: z.string().describe('Original file name'),
    checksum: z.string().describe('Base64 encoded SHA1 hash'),
    checksumAlgorithm: z.enum(ChecksumAlgorithm).describe('Checksum algorithm'),
    size: z.int().min(0).nullable().describe('Original file size in bytes; null if unknown'),
    type: AssetTypeSchema,
    fileCreatedAt: z.string().meta({ format: 'date-time' }).describe('File creation time'),
    fileModifiedAt: z.string().meta({ format: 'date-time' }).describe('File modification time'),
    albumIds: z.array(z.uuidv4()).describe('IDs of the owner-owned albums this asset belongs to'),
  })
  .meta({ id: 'LibraryManifestAssetDto' });

const LibraryManifestResponseSchema = z
  .object({
    manifestSchemaVersion: z.int().describe('Manifest schema version; consumers must guard'),
    generatedAt: z.string().meta({ format: 'date-time' }).describe('When this page was generated'),
    owner: LibraryManifestOwnerSchema,
    albums: z.array(LibraryManifestAlbumSchema).describe('All albums owned by the target user'),
    assets: z.array(LibraryManifestAssetSchema),
    nextCursor: z.uuidv4().nullable().describe('Pass as ?cursor for the next page; null when exhausted'),
  })
  .meta({ id: 'LibraryManifestResponseDto' });

export class LibraryManifestAssetDto extends createZodDto(LibraryManifestAssetSchema) {}
export class LibraryManifestResponseDto extends createZodDto(LibraryManifestResponseSchema) {}
```

- [ ] **Step 2: Typecheck the file compiles**

Run: `pnpm exec tsc --noEmit -p tsconfig.json` (from `server/`)
Expected: no errors referencing `library-manifest.dto.ts`. (If `z.enum(ChecksumAlgorithm)` errors, confirm `ChecksumAlgorithm` is exported from `src/enum.ts` — it is, lines 44-49.)

- [ ] **Step 3: Commit**

```bash
git add server/src/dtos/library-manifest.dto.ts
git commit -m "feat(manifest): add library manifest response/asset DTOs"
```

---

## Task 3: Repository query + service (TDD core)

**Files:**

- Modify: `server/src/repositories/asset.repository.ts` (add method; add imports if missing)
- Create: `server/src/services/library-manifest.service.ts`
- Modify: `server/src/services/index.ts` (register service)
- Test: `server/test/medium/specs/services/library-manifest.service.spec.ts`

- [ ] **Step 1: Write the failing medium test (happy path + owner scoping)**

Create `server/test/medium/specs/services/library-manifest.service.spec.ts`:

```typescript
import { Kysely } from 'kysely';
import { AssetStatus, AssetType, AssetVisibility, ChecksumAlgorithm } from 'src/enum';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { LibraryManifestService } from 'src/services/library-manifest.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(LibraryManifestService, {
    database: db || defaultDatabase,
    real: [AssetRepository, UserRepository, AlbumRepository],
    mock: [LoggingRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(LibraryManifestService.name, () => {
  describe('getManifest', () => {
    it('returns the owner and a mapped asset for an owned, active asset', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const checksum = Buffer.from('0123456789abcdef0123', 'utf8');
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        checksum,
        checksumAlgorithm: ChecksumAlgorithm.sha1File,
        type: AssetType.Image,
        originalPath: 'upload/library/user/2026/photo.jpg',
        originalFileName: 'photo.jpg',
      });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 123_456 });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.owner).toEqual({ id: user.id, email: user.email });
      expect(result.manifestSchemaVersion).toBe(1);
      expect(result.generatedAt).toEqual(expect.any(String));
      expect(result.albums).toEqual([]);
      expect(result.nextCursor).toBeNull();
      expect(result.assets).toEqual([
        expect.objectContaining({
          assetId: asset.id,
          objectKey: 'upload/library/user/2026/photo.jpg',
          originalFileName: 'photo.jpg',
          checksum: checksum.toString('base64'),
          checksumAlgorithm: ChecksumAlgorithm.sha1File,
          size: 123_456,
          type: AssetType.Image,
          albumIds: [],
        }),
      ]);
    });

    it("only returns the target user's assets", async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset: mine } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAsset({ ownerId: other.id });

      const auth = factory.auth({ user: { id: owner.id } });
      const result = await sut.getManifest(auth, owner.id);

      expect(result.assets.map((a) => a.assetId)).toEqual([mine.id]);
    });
  });
});
```

- [ ] **Step 2: Run the test — expect RED**

Run: `pnpm test:medium -- library-manifest`
Expected: FAIL — `Cannot find module 'src/services/library-manifest.service'` (service/repo method not yet created). This is the expected red (missing module), not a setup error.

- [ ] **Step 3: Add the repository method**

In `server/src/repositories/asset.repository.ts`, `AssetStatus` (line 21), `asUuid` (line 30), and `DummyValue` are **already imported** — do not add imports. Add this method to the `AssetRepository` class (near the other read queries, e.g. after `getByIds`):

```typescript
  @GenerateSql({ params: [DummyValue.UUID, 1000] })
  getOwnedManifestAssets(ownerId: string, limit: number) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.originalPath',
        'asset.originalFileName',
        'asset.checksum',
        'asset.checksumAlgorithm',
        'asset.type',
        'asset.fileCreatedAt',
        'asset.fileModifiedAt',
      ])
      .select('asset_exif.fileSizeInByte as size')
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where('asset.deletedAt', 'is', null)
      .where('asset.status', '=', AssetStatus.Active)
      .where('asset.libraryId', 'is', null)
      .where('asset.isExternal', '=', false)
      .orderBy('asset.id')
      .limit(limit)
      .execute();
  }
```

Note: `checksum` is selected as a `Buffer`; `size` aliases `asset_exif.fileSizeInByte` (`number | null`). If `AssetStatus`/`asUuid` are already imported in this file, do not duplicate the import.

- [ ] **Step 4: Create the service**

Create `server/src/services/library-manifest.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { MANIFEST_PAGE_SIZE, MANIFEST_SCHEMA_VERSION } from 'src/constants';
import { AuthDto } from 'src/dtos/auth.dto';
import { LibraryManifestAssetDto, LibraryManifestResponseDto } from 'src/dtos/library-manifest.dto';
import { BaseService } from 'src/services/base.service';
import { hexOrBufferToBase64 } from 'src/utils/bytes';
import { asDateString } from 'src/utils/date';

@Injectable()
export class LibraryManifestService extends BaseService {
  async getManifest(auth: AuthDto, id: string): Promise<LibraryManifestResponseDto> {
    const user = await this.userRepository.get(id, { withDeleted: true });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const rows = await this.assetRepository.getOwnedManifestAssets(id, MANIFEST_PAGE_SIZE);

    const assets: LibraryManifestAssetDto[] = rows.map((row) => ({
      assetId: row.id,
      objectKey: row.originalPath,
      originalFileName: row.originalFileName,
      checksum: hexOrBufferToBase64(row.checksum)!,
      checksumAlgorithm: row.checksumAlgorithm,
      size: row.size ?? null,
      type: row.type,
      fileCreatedAt: asDateString(row.fileCreatedAt),
      fileModifiedAt: asDateString(row.fileModifiedAt),
      albumIds: [],
    }));

    return {
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      owner: { id: user.id, email: user.email },
      albums: [],
      assets,
      nextCursor: null,
    };
  }
}
```

- [ ] **Step 5: Register the service** in `server/src/services/index.ts`

Add the import (alphabetical, near `LibraryService`):

```typescript
import { LibraryManifestService } from 'src/services/library-manifest.service';
```

Add `LibraryManifestService,` to the `services` array (near `LibraryService`).

- [ ] **Step 6: Run the test — expect GREEN**

Run: `pnpm test:medium -- library-manifest`
Expected: both tests PASS.

- [ ] **Step 7: Add the remaining filter/edge-case tests**

Append these `it(...)` blocks inside `describe('getManifest', ...)`:

```typescript
it('excludes trashed and permanently-deleted assets', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const { asset: active } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newAsset({ ownerId: user.id, status: AssetStatus.Trashed, deletedAt: new Date() });
  await ctx.newAsset({ ownerId: user.id, status: AssetStatus.Deleted, deletedAt: new Date() });

  const auth = factory.auth({ user: { id: user.id } });
  const result = await sut.getManifest(auth, user.id);

  expect(result.assets.map((a) => a.assetId)).toEqual([active.id]);
});

it('excludes external-library assets', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const { asset: managed } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newAsset({ ownerId: user.id, isExternal: true });

  const auth = factory.auth({ user: { id: user.id } });
  const result = await sut.getManifest(auth, user.id);

  expect(result.assets.map((a) => a.assetId)).toEqual([managed.id]);
});

it('includes assets of every visibility', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const ids = [];
  for (const visibility of [
    AssetVisibility.Timeline,
    AssetVisibility.Archive,
    AssetVisibility.Hidden,
    AssetVisibility.Locked,
  ]) {
    const { asset } = await ctx.newAsset({ ownerId: user.id, visibility });
    ids.push(asset.id);
  }

  const auth = factory.auth({ user: { id: user.id } });
  const result = await sut.getManifest(auth, user.id);

  expect(result.assets.map((a) => a.assetId).sort()).toEqual(ids.sort());
});

it('returns size null when the asset has no exif row', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });

  const auth = factory.auth({ user: { id: user.id } });
  const result = await sut.getManifest(auth, user.id);

  expect(result.assets).toEqual([expect.objectContaining({ assetId: asset.id, size: null })]);
});

it('returns an empty manifest for a user with no assets', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();

  const auth = factory.auth({ user: { id: user.id } });
  const result = await sut.getManifest(auth, user.id);

  expect(result.assets).toEqual([]);
  expect(result.nextCursor).toBeNull();
  expect(result.albums).toEqual([]);
});

it("still exports a deactivated (soft-deleted) user's library", async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser({ deletedAt: new Date() });
  const { asset } = await ctx.newAsset({ ownerId: user.id });

  const auth = factory.auth({ user: { id: user.id } });
  const result = await sut.getManifest(auth, user.id);

  expect(result.owner.id).toBe(user.id);
  expect(result.assets.map((a) => a.assetId)).toEqual([asset.id]);
});

it('throws NotFoundException for a user that does not exist', async () => {
  const { sut } = setup();
  const missingId = newUuid();
  const auth = factory.auth({ user: { id: missingId } });

  await expect(sut.getManifest(auth, missingId)).rejects.toBeInstanceOf(NotFoundException);
});
```

Add `NotFoundException` to the imports at the top of the spec, and add `newUuid` to the existing `test/small.factory` import:

```typescript
import { NotFoundException } from '@nestjs/common';
// update the small.factory import to:
import { factory, newUuid } from 'test/small.factory';
```

- [ ] **Step 8: Run all the service tests — expect GREEN**

Run: `pnpm test:medium -- library-manifest`
Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/repositories/asset.repository.ts server/src/services/library-manifest.service.ts server/src/services/index.ts server/test/medium/specs/services/library-manifest.service.spec.ts
git commit -m "feat(manifest): single-page library manifest service + asset query (TDD)"
```

---

## Task 4: Controller + registration

**Files:**

- Create: `server/src/controllers/library-manifest.controller.ts`
- Modify: `server/src/controllers/index.ts` (register controller)
- Test: `server/src/controllers/library-manifest.controller.spec.ts`

- [ ] **Step 1: Write the failing controller spec**

Create `server/src/controllers/library-manifest.controller.spec.ts`:

```typescript
import { LibraryManifestController } from 'src/controllers/library-manifest.controller';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { LibraryManifestService } from 'src/services/library-manifest.service';
import request from 'supertest';
import { automock, ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(LibraryManifestController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(LibraryManifestService);

  beforeAll(async () => {
    ctx = await controllerSetup(LibraryManifestController, [
      { provide: LoggingRepository, useValue: automock(LoggingRepository, { strict: false }) },
      { provide: LibraryManifestService, useValue: service },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /admin/users/:id/library-manifest', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get(
        `/admin/users/${'a'.repeat(8)}-0000-4000-8000-000000000000/library-manifest`,
      );
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should reject a non-uuid :id with 400', async () => {
      const { status } = await request(ctx.getHttpServer()).get('/admin/users/not-a-uuid/library-manifest');
      expect(status).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run the spec — expect RED**

Run: `pnpm test -- library-manifest.controller`
Expected: FAIL — `Cannot find module 'src/controllers/library-manifest.controller'`.

- [ ] **Step 3: Create the controller**

Create `server/src/controllers/library-manifest.controller.ts`:

```typescript
import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { LibraryManifestResponseDto } from 'src/dtos/library-manifest.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { LibraryManifestService } from 'src/services/library-manifest.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.UsersAdmin)
@Controller('admin/users')
export class LibraryManifestController {
  constructor(private service: LibraryManifestService) {}

  @Get(':id/library-manifest')
  @Authenticated({ permission: Permission.AdminUserRead, admin: true })
  @Endpoint({
    summary: 'Export a user library manifest',
    description: "Return a paginated manifest of a user's owned, non-trashed assets for data export.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getLibraryManifest(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<LibraryManifestResponseDto> {
    return this.service.getManifest(auth, id);
  }
}
```

`.added('v1').beta('v1')` is an established convention in this fork (38 existing uses). `history` is optional on `@Endpoint`, but omitting it logs a "Missing history" warning at boot — keep the chain.

- [ ] **Step 4: Register the controller** in `server/src/controllers/index.ts`

Add the import (alphabetical, near `LibraryController`):

```typescript
import { LibraryManifestController } from 'src/controllers/library-manifest.controller';
```

Add `LibraryManifestController,` to the `controllers` array (near `LibraryController`).

- [ ] **Step 5: Run the spec — expect GREEN**

Run: `pnpm test -- library-manifest.controller`
Expected: both tests PASS (`authenticate` called; non-uuid → 400 via `ZodValidationPipe`).

- [ ] **Step 6: Commit**

```bash
git add server/src/controllers/library-manifest.controller.ts server/src/controllers/index.ts server/src/controllers/library-manifest.controller.spec.ts
git commit -m "feat(manifest): add LibraryManifestController + admin guard (TDD)"
```

---

## Task 5: E2E (happy path + 403 + 404)

**Files:**

- Create: `e2e/src/specs/server/api/library-manifest.e2e-spec.ts`

E2E runs against the running stack. The endpoint is not yet in `@immich/sdk`, so call it with raw `supertest` (`request(app)`), mirroring the raw-request style already used in `user-admin.e2e-spec.ts`.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/src/specs/server/api/library-manifest.e2e-spec.ts`:

```typescript
import { LoginResponseDto } from '@immich/sdk';
import { createUserDto, uuidDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('/admin/users/:id/library-manifest', () => {
  let admin: LoginResponseDto;
  let nonAdmin: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    nonAdmin = await utils.userSetup(admin.accessToken, createUserDto.user1);
    await utils.createAsset(admin.accessToken);
  });

  it('requires authentication (401)', async () => {
    const { status } = await request(app).get(`/admin/users/${admin.userId}/library-manifest`);
    expect(status).toBe(401);
  });

  it('requires admin (403)', async () => {
    const { status } = await request(app)
      .get(`/admin/users/${admin.userId}/library-manifest`)
      .set(asBearerAuth(nonAdmin.accessToken));
    expect(status).toBe(403);
  });

  it('returns 404 for a non-existent user', async () => {
    const { status } = await request(app)
      .get(`/admin/users/${uuidDto.notFound}/library-manifest`)
      .set(asBearerAuth(admin.accessToken));
    expect(status).toBe(404);
  });

  it('returns the manifest for the admin (200)', async () => {
    const { status, body } = await request(app)
      .get(`/admin/users/${admin.userId}/library-manifest`)
      .set(asBearerAuth(admin.accessToken));
    expect(status).toBe(200);
    expect(body.manifestSchemaVersion).toBe(1);
    expect(body.owner.id).toBe(admin.userId);
    expect(body.assets.length).toBeGreaterThanOrEqual(1);
    expect(body.assets[0].objectKey).toEqual(expect.any(String));
    expect(body.assets[0].albumIds).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });
});
```

Implementer note: confirm `uuidDto.notFound` exists in `e2e/src/fixtures` (`grep -n "notFound" e2e/src/fixtures*`). If not, use a fixed valid-but-absent uuid string like `'00000000-0000-4000-8000-000000000000'`.

- [ ] **Step 2: Run the e2e spec — expect RED then GREEN**

Pre-implementation this would 404 on the route; after Tasks 1-4 the route exists. Ensure the stack/server has the new code (e2e runs against a built/served instance — follow the repo's e2e run instructions). Run from `e2e/`:
`pnpm test -- library-manifest`
Expected: all 4 tests PASS.

If running the full e2e stack locally is not feasible in this environment, record that the e2e spec is written and committed, and that it must pass in CI. Do **not** delete or skip the spec.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/server/api/library-manifest.e2e-spec.ts
git commit -m "test(manifest): e2e for library-manifest happy path + 401/403/404"
```

---

## Task 6: Regenerate OpenAPI + SDKs

**Files:**

- Modify (generated): `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/**`, and the dart SDK — whatever `make open-api` regenerates. CI verifies these are committed and in sync.

- [ ] **Step 1: Regenerate**

Run from the **repo root** (`/Users/pierre/dev/gallery/.claude/worktrees/library-manifest-export`):

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
make open-api
```

This runs `open-api/bin/generate-open-api.sh`, which builds the server, writes `immich-openapi-specs.json` (via `sync-open-api`), and regenerates the TypeScript (`@immich/sdk`) and Dart SDKs. If `make` is unavailable, run the steps in that script directly.

- [ ] **Step 2: Inspect the diff**

Run: `git status --short` and `git diff --stat`
Expected: `open-api/immich-openapi-specs.json` gains `LibraryManifestResponseDto`, `LibraryManifestAssetDto`, `LibraryManifestOwnerDto`, `LibraryManifestAlbumDto`, and the path `GET /admin/users/{id}/library-manifest`; the typescript-sdk gains the corresponding generated client. No unrelated churn.

- [ ] **Step 3: Commit**

```bash
git add open-api mobile/openapi 2>/dev/null; git add open-api
git commit -m "chore(manifest): regenerate OpenAPI spec + SDKs for library-manifest endpoint"
```

---

## Slice 1 Done Criteria

- `pnpm test:medium -- library-manifest` — all green (owner scoping, trash/deleted excluded, external excluded, all visibilities, size-null, empty, deactivated-user, 404).
- `pnpm test -- library-manifest.controller` — green (authenticated route; 400 on bad uuid).
- `e2e ... library-manifest` — green (401/403/404/200) or committed-and-pending-CI if the stack can't run locally.
- OpenAPI regenerated and committed.
- Branch pushed: `git push -u origin feat/library-manifest-export`.
