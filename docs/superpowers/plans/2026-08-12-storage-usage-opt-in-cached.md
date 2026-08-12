# Storage Usage Opt-In for Cached Derivatives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert user storage usage to upstream Immich semantics (originals only) by default, and put the fork's derivative-inclusive accounting behind two independent admin opt-ins — one for the displayed number, one for quota enforcement.

**Architecture:** Two stored numbers on `user`. `quotaUsageInBytes` returns to exact upstream semantics (sum of `asset_exif.fileSizeInByte` where `libraryId is null`, maintained by the existing incremental deltas). A new fork column `physicalUsageInBytes` holds originals + thumbnails + transcodes as measured on disk/S3, refreshed by the nightly scan and nudged by the same live deltas. Two `SystemConfig` booleans select which column each surface reads, so display and enforcement move independently.

**The expensive walk is opt-in too.** The per-user filesystem/S3 scan only runs when at least one toggle is enabled. A default install therefore goes back to upstream's single cheap SQL statement for its nightly quota sync — reverting the cost, not just the number. Flipping a toggle on queues an immediate resync so the column is populated before anything reads it.

**Tech Stack:** NestJS 11 + Kysely + PostgreSQL (server), SvelteKit 5 runes (web), Vitest.

## Global Constraints

- Fork migrations go in `server/src/schema/migrations-gallery/` only — never `migrations/`. Use a round timestamp.
- No relative imports in `server/` — use the `src/` path alias.
- Prettier: 120 char width, single quotes, trailing commas.
- ESLint zero-warning policy (`--max-warnings 0`).
- Every user-facing string must land in `i18n/en.json` **and** these nine locales in the same commit: `de` `fr` `it` `nl` `pl` `es` `ru` `zh_Hans` `zh_Hant`. Keys alphabetically sorted, 2-space indent, unescaped Unicode; run `npx prettier --write i18n/*.json` afterwards.
- Both new config booleans default to **`false`** — a fresh or upgraded install behaves exactly like upstream Immich.
- Do not run `make sql` without a running database — it deletes all query files.

---

## Fork Ownership — read this before writing any code

This repository is rebased onto upstream Immich continuously, and `make fork-ownership-coverage-check` requires every file differing from `upstream/main` to be declared in `docs/fork/ownership.yml`. Two rules follow, and they shape the whole file layout below.

**Rule 1 — fork logic lives in the fork namespace.** `docs/fork/ownership.yml` declares `server/src/gallery/**` and `web/src/lib/gallery/**` as the preferred fork namespaces. Neither directory exists yet; this change creates the first files in both. Upstream will never touch those paths, so anything placed there is permanently conflict-free. **All real logic goes there.** What remains in upstream files must be a thin call.

**Rule 2 — every edit to an upstream file gets a `// Gallery-fork:` marker.** That comment is the existing convention (`asset.table.ts:31`, `shared-space.table.ts:31,41`). It is what makes a rebase conflict resolvable by someone who did not write this change: the marker says "this hunk is ours, keep it" rather than leaving the resolver guessing.

### Fork-owned files — zero rebase risk

| File                                                                            | Responsibility                                                 |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `server/src/gallery/storage-usage.ts`                                           | **New.** All physical-usage logic: filename parsing + the walk |
| `server/src/gallery/storage-usage.service.ts`                                   | **New.** Queues a resync when a toggle is switched on          |
| `server/src/schema/migrations-gallery/1785000000000-AddPhysicalUsageInBytes.ts` | **New.** Column + data backfill + quota reset                  |
| `web/src/lib/gallery/storage-usage.ts`                                          | **New.** The sidebar's used/available derivation               |
| `web/src/routes/admin/system-settings/StorageUsageSettings.svelte`              | **New.** Admin panel section                                   |
| `server/src/backends/*-storage.backend.ts`, `interfaces/storage-backend.ts`     | Fork-created (S3 support). `getPrefixUsage` gains a filter     |
| `web/src/lib/components/shared-components/side-bar/rail-storage.svelte`         | Fork-created (compact rail). Calls the shared derivation       |
| `server/test/medium/specs/repositories/user-physical-usage.spec.ts`             | **New.** Migration + restored-SQL coverage                     |

### Upstream files — keep the diff minimal and marked

| File                                                       | Fork footprint after this change                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `server/src/services/base.service.ts`                      | **Shrinks ~50 lines → ~12.** Thin delegate to the fork module       |
| `server/src/services/user.service.ts`                      | Unchanged by this plan (already 1 word from upstream)               |
| `server/src/services/user-admin.service.ts`                | Unchanged by this plan (already 1 word from upstream)               |
| `server/src/repositories/user.repository.ts`               | **Restores upstream `syncUsage` verbatim.** Adds `setPhysicalUsage` |
| `server/src/repositories/storage.repository.ts`            | `getFolderSize` (already fork-added) gains a filter                 |
| `server/src/repositories/asset.repository.ts`              | One appended method, `getExternalAssetIds`                          |
| `server/src/services/asset-media.service.ts`               | Two lines inside `requireQuota`                                     |
| `server/src/config.ts`, `dtos/system-config.dto.ts`        | One config group, following the existing `classification` precedent |
| `server/src/schema/tables/user.table.ts`                   | One column — the first fork column on this table                    |
| `server/src/database.ts`                                   | One field on two types, one entry in two column lists               |
| `server/src/dtos/user.dto.ts`, `dtos/server.dto.ts`        | One field each                                                      |
| `server/src/services/server.service.ts`                    | One line in `getConfig`                                             |
| `server/src/services/index.ts`                             | Two additive lines registering the fork service                     |
| `web/.../side-bar/StorageSpace.svelte`                     | Three lines — delegates to the shared derivation                    |
| `web/src/routes/admin/system-settings/+page.svelte`        | Import + one list entry                                             |
| `server/test/small.factory.ts`, `asset.repository.mock.ts` | One field / one method each                                         |
| `docs/fork/ownership.yml`                                  | Declares everything above (Task 11)                                 |

**Deliberately not touched:** `server/src/services/system-config.service.ts`. An earlier draft hooked the config-change resync there; the fork service listens to the existing `ConfigUpdate` event instead (`event.repository.ts:31-37`, the same pattern as `queue.service.ts:64`), which keeps that upstream service at zero divergence.

**Accepted approximations** (document in the PR description, do not fix here): HLS session segments, Android motion-photo sidecars, and person thumbnails are keyed on ids that are not asset ids, so they are always counted in `physicalUsageInBytes` even when they belong to an external-library asset. They are small and transient relative to previews and transcodes.

---

### Task 1: Config group + admin DTO

**Files:**

- Modify: `server/src/config.ts` (type block near `user: { deleteDelay }`, defaults block near the same)
- Modify: `server/src/dtos/system-config.dto.ts:453-458` (next to `SystemConfigUserSchema`), and register in `SystemConfigSchema:460`
- Test: `server/src/services/system-config.service.spec.ts`

**Interfaces:**

- Produces: `SystemConfig['storageUsage']` with shape `{ includeDerivativesInDisplay: boolean; includeDerivativesInQuota: boolean }`, both defaulting to `false`.

- [ ] **Step 1: Write the failing test**

In `server/src/services/system-config.service.spec.ts`, inside the existing top-level `describe`:

```ts
describe('storageUsage defaults', () => {
  it('should default both derivative toggles to off (upstream behavior)', async () => {
    const config = await sut.getConfig({ withCache: false });

    expect(config.storageUsage.includeDerivativesInDisplay).toBe(false);
    expect(config.storageUsage.includeDerivativesInQuota).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/system-config.service.spec.ts -t 'storageUsage defaults'`
Expected: FAIL — `Cannot read properties of undefined (reading 'includeDerivativesInDisplay')`

- [ ] **Step 3: Add the config type and defaults**

In `server/src/config.ts`, add to the `SystemConfig` type immediately before `user: { deleteDelay: number };`. The `classification` group at `:232` is the precedent for a fork-added config group in this file:

```ts
// Gallery-fork: opt-in accounting for server-generated files (thumbnails, transcodes).
storageUsage: {
  includeDerivativesInDisplay: boolean;
  includeDerivativesInQuota: boolean;
}
```

And in the frozen `defaults` object, immediately before `user: { deleteDelay: 7 },`:

```ts
  storageUsage: {
    includeDerivativesInDisplay: false,
    includeDerivativesInQuota: false,
  },
```

- [ ] **Step 4: Add the DTO schema**

In `server/src/dtos/system-config.dto.ts`, immediately before `const SystemConfigUserSchema`:

```ts
const SystemConfigStorageUsageSchema = z
  .object({
    includeDerivativesInDisplay: configBool.describe(
      'Include thumbnails and transcoded videos in the displayed storage usage',
    ),
    includeDerivativesInQuota: configBool.describe('Include thumbnails and transcoded videos in quota enforcement'),
  })
  .meta({ id: 'SystemConfigStorageUsageDto' });
```

Then register it in `SystemConfigSchema` (keep the object's existing key ordering style — insert next to `storageTemplate`):

```ts
    storageUsage: SystemConfigStorageUsageSchema,
```

Note: confirm the exact helper name for a boolean field by reading how `syncQuotaUsage` is declared in this file (around `SystemConfigNightlyTasksSchema`) and match it — if the file uses a bare `z.boolean()` rather than a `configBool` helper, use that instead.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/system-config.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/config.ts server/src/dtos/system-config.dto.ts server/src/services/system-config.service.spec.ts
git commit -m "feat(server): add storageUsage config group for derivative accounting"
```

---

### Task 2: `physicalUsageInBytes` column + migration

**Files:**

- Modify: `server/src/schema/tables/user.table.ts:75`
- Create: `server/src/schema/migrations-gallery/1785000000000-AddPhysicalUsageInBytes.ts`

**Interfaces:**

- Produces: `user.physicalUsageInBytes` — `bigint NOT NULL DEFAULT 0`.

The migration does three things, in order. Step 2 is what makes upgraded installs show correct numbers the moment they restart, instead of waiting for the nightly job: today's `quotaUsageInBytes` already holds the physical number, so it is moved across rather than thrown away.

- [ ] **Step 1: Add the column to the schema table**

In `server/src/schema/tables/user.table.ts`, immediately after the `quotaUsageInBytes` declaration. This is the first fork column on this table, so the marker matters — a rebase that rewrites the table should keep it:

```ts
  // Gallery-fork: originals + thumbnails + transcodes, as measured on disk/S3. Maintained only
  // while a storageUsage toggle is enabled; quotaUsageInBytes above stays upstream-exact.
  @Column({ type: 'bigint', default: 0 })
  physicalUsageInBytes!: Generated<ColumnType<number>>;
```

- [ ] **Step 2: Write the migration**

Create `server/src/schema/migrations-gallery/1785000000000-AddPhysicalUsageInBytes.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user" ADD COLUMN "physicalUsageInBytes" bigint NOT NULL DEFAULT 0;`.execute(db);

  // Before this migration "quotaUsageInBytes" held physical bytes (originals + thumbnails +
  // transcodes). Preserve that measurement in the new column so admins who opt in immediately
  // see a real number rather than zero until the next nightly scan.
  await sql`UPDATE "user" SET "physicalUsageInBytes" = "quotaUsageInBytes";`.execute(db);

  // Reset "quotaUsageInBytes" to upstream semantics: originals only, external libraries excluded.
  await sql`
    UPDATE "user"
    SET "quotaUsageInBytes" = (
      SELECT coalesce(sum("asset_exif"."fileSizeInByte"), 0)
      FROM "asset"
      LEFT JOIN "asset_exif" ON "asset_exif"."assetId" = "asset"."id"
      WHERE "asset"."libraryId" IS NULL
        AND "asset"."ownerId" = "user"."id"
    );
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "user" DROP COLUMN "physicalUsageInBytes";`.execute(db);
}
```

- [ ] **Step 3: Verify the timestamp does not collide**

Run: `ls server/src/schema/migrations-gallery/ | sort | tail -5`
Expected: no existing file starts with `1785000000000`. The highest existing timestamp should be lower (`1784800000000` at time of writing). If `1785000000000` is taken, bump to the next free round number and rename the file and this plan's references.

- [ ] **Step 4: Write a medium test proving the migration is picked up**

Fork migrations live in a second directory and only reach `dist/schema/migrations/` via the `postbuild` sync script, so "the migration file exists" and "the migration ran" are genuinely different claims. This test pins the latter.

Create `server/test/medium/specs/repositories/user-physical-usage.spec.ts`:

```ts
import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('physicalUsageInBytes column', () => {
  it('exists after migrations and defaults to zero', async () => {
    const result = await sql<{
      column_default: string | null;
      is_nullable: string;
    }>`SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_name = 'user' AND column_name = 'physicalUsageInBytes'`.execute(db);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].is_nullable).toBe('NO');
    expect(result.rows[0].column_default).toBe('0');
  });
});
```

- [ ] **Step 5: Run the medium test**

Requires Docker (testcontainers).

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/user-physical-usage.spec.ts`
Expected: PASS. Do **not** use `pnpm test:medium -- --run <path>` — it silently drops the path filter and runs the whole suite.

- [ ] **Step 6: Type-check**

Run: `cd server && pnpm check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/schema/tables/user.table.ts server/src/schema/migrations-gallery/1785000000000-AddPhysicalUsageInBytes.ts server/test/medium/specs/repositories/user-physical-usage.spec.ts
git commit -m "feat(server): add physicalUsageInBytes column and reset quota to upstream semantics"
```

---

### Task 3: Derivative filename parsing utility

This is the first file in the `server/src/gallery/**` fork namespace. Create the directory as part of this task.

**Files:**

- Create: `server/src/gallery/storage-usage.ts`
- Test: `server/src/gallery/storage-usage.spec.ts`

**Interfaces:**

- Produces: `getDerivativeAssetId(filename: string): string | null` — returns the asset UUID encoded in a derivative filename, or `null` when the filename is not asset-derived.

Derivative layouts, from `server/src/cores/storage.core.ts:118-142`:

- preview/thumbnail: `${asset.id}_${fileType}.${format}` and `${asset.id}_${fileType}_edited.${format}`
- transcode: `${asset.id}.mp4`
- person thumbnail: `${person.id}.jpeg` — a person id, deliberately **not** matched as an asset
- Android motion: `${uuid}-MP.mp4` — a fresh uuid, deliberately not matched

A UUID is exactly 36 characters. Any asset-derived filename therefore starts with 36 UUID characters followed by `_` or `.`. Person thumbnails also match that shape, which is why the caller checks membership in the _external asset id_ set rather than treating a match as authoritative — a person id will simply never be in that set.

- [ ] **Step 1: Write the failing test**

Create `server/src/gallery/storage-usage.spec.ts`:

```ts
import { getDerivativeAssetId } from 'src/gallery/storage-usage';

describe('getDerivativeAssetId', () => {
  const id = '0f9b1e2c-4a5d-4c8e-9f10-2b3c4d5e6f70';

  it('should extract the asset id from a preview filename', () => {
    expect(getDerivativeAssetId(`${id}_preview.webp`)).toBe(id);
  });

  it('should extract the asset id from an edited thumbnail filename', () => {
    expect(getDerivativeAssetId(`${id}_thumbnail_edited.webp`)).toBe(id);
  });

  it('should extract the asset id from a transcode filename', () => {
    expect(getDerivativeAssetId(`${id}.mp4`)).toBe(id);
  });

  it('should extract the asset id from an uppercase filename', () => {
    expect(getDerivativeAssetId(`${id.toUpperCase()}.mp4`)).toBe(id.toUpperCase());
  });

  it('should return null for a filename that is not asset derived', () => {
    expect(getDerivativeAssetId('not-a-uuid.webp')).toBeNull();
    expect(getDerivativeAssetId('segment-00001.ts')).toBeNull();
  });

  it('should return null for a filename shorter than a uuid', () => {
    expect(getDerivativeAssetId('short.webp')).toBeNull();
    expect(getDerivativeAssetId('')).toBeNull();
  });

  it('should return null when the uuid is not followed by a known separator', () => {
    expect(getDerivativeAssetId(`${id}extra.webp`)).toBeNull();
  });

  it('should return null for an Android motion sidecar', () => {
    // StorageCore.getAndroidMotionPath creates ${uuid}-MP.mp4 where uuid is fresh, not the asset id
    expect(getDerivativeAssetId(`${id}-MP.mp4`)).toBeNull();
  });
});
```

Note on the uppercase case: `getExternalAssetIds` returns ids exactly as Postgres stores them (lowercase), so an uppercase filename would not match the set and its file would be counted. That is the safe direction to fail — it over-counts rather than silently dropping bytes — and Immich writes lowercase uuids. The test pins the parser's behaviour, not a claim that both cases round-trip.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/gallery/storage-usage.spec.ts`
Expected: FAIL — cannot resolve `src/gallery/storage-usage`

- [ ] **Step 3: Write the implementation**

Create `server/src/gallery/storage-usage.ts`:

```ts
const UUID_LENGTH = 36;
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/**
 * Derivative files are laid out by owner, not by library, so a plain folder walk cannot tell an
 * external-library asset's thumbnail from an uploaded asset's thumbnail. Every asset-derived
 * filename starts with the asset UUID (see StorageCore.getImagePath / getEncodedVideoPath), so the
 * caller can recover the id and check it against the owner's external asset ids.
 *
 * Returns null for files that are not keyed on an asset id (HLS segments, Android motion sidecars).
 * Note: person thumbnails also match the <uuid>. pattern and ARE returned; the caller filters by
 * membership in the owner's external-asset-id set, so person ids are naturally excluded.
 */
export const getDerivativeAssetId = (filename: string): string | null => {
  const candidate = filename.slice(0, UUID_LENGTH);
  if (!UUID_PATTERN.test(candidate)) {
    return null;
  }

  const separator = filename[UUID_LENGTH];
  if (separator !== undefined && separator !== '_' && separator !== '.') {
    return null;
  }

  return candidate;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/gallery/storage-usage.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/gallery/storage-usage.ts server/src/gallery/storage-usage.spec.ts
git commit -m "feat(server): add derivative filename asset-id parser"
```

---

### Task 4: Filename filter on the size walkers

**Files:**

- Modify: `server/src/repositories/storage.repository.ts:266-288` (`getFolderSize`)
- Modify: `server/src/backends/disk-storage.backend.ts:57-95` (`getPrefixUsage` + private `getFolderSize`)
- Modify: `server/src/backends/s3-storage.backend.ts:178-193` (`getPrefixUsage`)
- Modify: `server/src/interfaces/storage-backend.interface.ts:55`
- Test: `server/src/repositories/storage.repository.spec.ts`, `server/src/backends/s3-storage.backend.spec.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `getFolderSize(folder: string, shouldCount?: (filename: string) => boolean): Promise<number>` and `getPrefixUsage(prefix: string, shouldCount?: (filename: string) => boolean): Promise<number>`. `shouldCount` receives the **basename** only. Omitting it counts everything, so all existing callers are unchanged.

- [ ] **Step 1: Write the failing tests**

In `server/src/repositories/storage.repository.spec.ts`, inside the existing `describe('getFolderSize')`:

```ts
it('skips files rejected by the filter', async () => {
  mockfs.restore();
  const testDir = join(tmpdir(), `immich-storage-filter-${Date.now()}`);
  try {
    await mkdir(join(testDir, 'aa'), { recursive: true });
    await writeFile(join(testDir, 'aa/keep.jpg'), 'one');
    await writeFile(join(testDir, 'aa/skip.jpg'), 'two!!');

    await expect(sut.getFolderSize(testDir, (filename) => filename !== 'skip.jpg')).resolves.toBe(3);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
});
```

In `server/src/backends/s3-storage.backend.spec.ts`, inside `describe('getPrefixUsage')`:

```ts
it('skips objects rejected by the filter', async () => {
  mockSend.mockResolvedValueOnce({
    Contents: [
      { Key: 'thumbs/user-a/aa/bb/keep.webp', Size: 10 },
      { Key: 'thumbs/user-a/aa/bb/skip.webp', Size: 20 },
    ],
    IsTruncated: false,
  });

  await expect(backend.getPrefixUsage('thumbs/user-a/', (filename) => filename !== 'skip.webp')).resolves.toBe(10);
});
```

Also in `server/src/repositories/storage.repository.spec.ts`, inside `describe('getFolderSize')` — the nightly scan walks a live directory that jobs are actively deleting from, so a file can vanish between `opendir` and `stat`. Today that aborts the entire user's sync:

```ts
it('ignores files deleted between listing and stat', async () => {
  mockfs({ '/data/thumbs/user-a/aa/one.webp': 'one' });
  const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  vi.spyOn(fs, 'stat').mockRejectedValueOnce(error as never);

  await expect(sut.getFolderSize('/data/thumbs/user-a')).resolves.toBe(0);
});
```

Import `fs` in the spec the same way `storage.repository.ts` does (`import fs from 'node:fs/promises'`), and drop the spy in an `afterEach` with `vi.restoreAllMocks()` if the file does not already do so.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/repositories/storage.repository.spec.ts src/backends/s3-storage.backend.spec.ts`
Expected: FAIL — the filter argument is ignored, so the sums come back `8` and `30`.

- [ ] **Step 3: Thread the filter through `StorageRepository.getFolderSize`**

Replace the body of `getFolderSize` in `server/src/repositories/storage.repository.ts`:

```ts
  async getFolderSize(folder: string, shouldCount?: (filename: string) => boolean): Promise<number> {
    let total = 0;
    let dir;
    try {
      dir = await fs.opendir(folder);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return 0;
      }
      throw error;
    }

    for await (const entry of dir) {
      const entryPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        total += await this.getFolderSize(entryPath, shouldCount);
      } else if (entry.isFile() && (!shouldCount || shouldCount(entry.name))) {
        try {
          const entryStat = await fs.stat(entryPath);
          total += entryStat.size;
        } catch (error: any) {
          // The nightly scan walks a live tree that delete jobs are writing to; a file that
          // disappears mid-walk must not abort the whole user's sync.
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
    }

    return total;
  }
```

- [ ] **Step 4: Thread the filter through both backends**

In `server/src/interfaces/storage-backend.interface.ts`, update the member:

```ts
  /** Return the total size in bytes for all objects/files under the given key prefix. */
  getPrefixUsage(prefix: string, shouldCount?: (filename: string) => boolean): Promise<number>;
```

In `server/src/backends/disk-storage.backend.ts`, mirror the repository change:

```ts
  async getPrefixUsage(prefix: string, shouldCount?: (filename: string) => boolean): Promise<number> {
    return this.getFolderSize(this.resolvePath(prefix), shouldCount);
  }
```

and in its private walker, replace the `else if (entry.isFile())` branch with `else if (entry.isFile() && (!shouldCount || shouldCount(entry.name)))`, passing `shouldCount` down the recursive call and wrapping its `stat` in the same ENOENT-tolerant `try`/`catch` shown above.

In `server/src/backends/s3-storage.backend.ts`:

```ts
  async getPrefixUsage(prefix: string, shouldCount?: (filename: string) => boolean): Promise<number> {
    let total = 0;
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }),
      );
      for (const object of page.Contents ?? []) {
        const filename = (object.Key ?? '').split('/').pop() ?? '';
        if (shouldCount && !shouldCount(filename)) {
          continue;
        }
        total += object.Size ?? 0;
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return total;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/repositories/storage.repository.spec.ts src/backends/s3-storage.backend.spec.ts src/backends/disk-storage.backend.spec.ts`
Expected: PASS, including the pre-existing unfiltered cases.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/storage.repository.ts server/src/backends server/src/interfaces/storage-backend.interface.ts
git commit -m "feat(server): allow filtering files out of storage size walks"
```

---

### Task 5: External asset id lookup

**Files:**

- Modify: `server/src/repositories/asset.repository.ts`
- Modify: `server/test/repositories/asset.repository.mock.ts`
- Test: `server/test/medium/specs/repositories/asset.repository.spec.ts`

**Interfaces:**

- Produces: `AssetRepository.getExternalAssetIds(ownerId: string): Promise<Set<string>>` — ids of the owner's assets that belong to an external library (`libraryId is not null`). Empty set when the owner has no external library, which is the common case and costs one indexed query.

**Build-breaking detail:** `test/repositories/asset.repository.mock.ts` is a hand-written exhaustive object literal typed `Mocked<RepositoryInterface<AssetRepository>>`. Adding a public method to `AssetRepository` without adding it to that literal fails `pnpm check` and takes down every spec that uses the asset mock. Step 2 below is not optional.

**Memory note:** this loads every external asset id for the owner into a `Set` — roughly 7 MB of strings for a 200k-asset external library, held for the duration of that user's walk. Acceptable for a nightly job that processes one user at a time; revisit if it shows up in memory profiles.

- [ ] **Step 1: Add the repository method**

In `server/src/repositories/asset.repository.ts`, **append at the end of the class** (match the file's existing `@GenerateSql` decoration style). Appending rather than inserting mid-class keeps the hunk away from upstream's edits and makes a rebase conflict here almost impossible:

```ts
  // Gallery-fork: derivative files are stored by ownerId with no library dimension, so the
  // physical-usage walk needs the owner's external asset ids to exclude their thumbnails and
  // transcodes — upstream excludes external assets from quota entirely.
  @GenerateSql({ params: [DummyValue.UUID] })
  async getExternalAssetIds(ownerId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.ownerId', '=', asUuid(ownerId))
      .where('asset.libraryId', 'is not', null)
      .execute();

    return new Set(rows.map((row) => row.id));
  }
```

Confirm `asUuid` and `DummyValue` are already imported in this file; add them to the existing import if not.

- [ ] **Step 2: Register the method on the hand-written mock**

In `server/test/repositories/asset.repository.mock.ts`, add to the returned literal (alphabetical position is not enforced in this file — match its existing grouping):

```ts
    getExternalAssetIds: vitest.fn().mockResolvedValue(new Set<string>()),
```

Defaulting to an empty set means every existing spec keeps its current behaviour without touching it.

- [ ] **Step 3: Write the medium test**

In `server/test/medium/specs/repositories/asset.repository.spec.ts`, using the file's existing `setup()` helper:

```ts
describe('getExternalAssetIds', () => {
  it('returns only assets belonging to an external library', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    const { asset: external } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
    await ctx.newAsset({ ownerId: user.id });

    await expect(sut.getExternalAssetIds(user.id)).resolves.toEqual(new Set([external.id]));
  });

  it('returns an empty set for a user with no external library', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user.id });

    await expect(sut.getExternalAssetIds(user.id)).resolves.toEqual(new Set());
  });
});
```

- [ ] **Step 4: Run the medium test**

Requires Docker.

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/asset.repository.spec.ts`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `cd server && pnpm check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/asset.repository.ts server/test/repositories/asset.repository.mock.ts server/test/medium/specs/repositories/asset.repository.spec.ts
git commit -m "feat(server): look up a user's external library asset ids"
```

---

### Task 6: Split the sync into quota and physical

**Files:**

- Modify: `server/src/repositories/user.repository.ts:300-318`
- Modify: `server/src/services/base.service.ts:599-639`
- Test: `server/src/services/user.service.spec.ts`

**Interfaces:**

- Consumes: `getDerivativeAssetId` (Task 3), the `shouldCount` filter (Task 4), `getExternalAssetIds` (Task 5).
- Produces: `UserRepository.syncUsage(id?: string)` (upstream SQL, originals only), `UserRepository.setPhysicalUsage(id: string, usage: number)`, and `BaseService.syncUsage(id?: string)` which updates both columns.

`updateUsage` now moves both columns by the same original-file delta. That keeps `physicalUsageInBytes` tracking uploads and deletes in real time; the nightly walk reconciles the derivative bytes it cannot see.

- [ ] **Step 1: Adapt the two existing tests**

`server/src/services/user.service.spec.ts:951-1010` already has a `handleUserSyncUsage` block with two tests, one of which covers the S3 path end to end. **Keep both** — they are the only coverage of the S3 prefix walk. Three mechanical changes are needed:

1. Every `(mocks.user as any).setUsage = vi.fn().mockResolvedValue(void 0)` becomes `setPhysicalUsage`, and the matching `expect((mocks.user as any).setUsage).toHaveBeenCalledWith(user.id, 1150)` becomes `setPhysicalUsage`. Keep the assigned-by-hand style the file already uses; do not assume automock provides it.
2. Both tests need `mocks.asset.getExternalAssetIds.mockResolvedValue(new Set<string>())` in their arrange block, and the config must enable a toggle (see change 3) or the walk no longer runs at all.
3. Both tests need the config stubbed so the physical walk is enabled:

```ts
mocks.systemMetadata.get.mockResolvedValue({
  storageUsage: { includeDerivativesInDisplay: true, includeDerivativesInQuota: false },
});
```

4. The exact-call-array assertions must gain the second argument. Thumbs and encoded-video now receive `shouldCount`; library, upload and profile do not:

```ts
expect(mocks.storage.getFolderSize.mock.calls).toEqual([
  ['/data/library/storage-label'],
  ['/data/upload/user-id'],
  ['/data/profile/user-id'],
  ['/data/thumbs/user-id', expect.any(Function)],
  ['/data/encoded-video/user-id', expect.any(Function)],
]);
```

and likewise for the S3 test:

```ts
expect(s3Backend.getPrefixUsage.mock.calls).toEqual([
  ['upload/user-id/'],
  ['profile/user-id/'],
  ['thumbs/user-id/', expect.any(Function)],
  ['encoded-video/user-id/', expect.any(Function)],
]);
```

- [ ] **Step 2: Add the new failing tests**

Append to the same `describe('handleUserSyncUsage')` block. These use `factory.userAdmin({...})`, matching the file's existing convention — not `userStub`:

```ts
it('should reset quota usage from the database, not from disk', async () => {
  const user = factory.userAdmin({ id: 'user-id', storageLabel: 'storage-label' });
  mocks.systemMetadata.get.mockResolvedValue({
    storageUsage: { includeDerivativesInDisplay: true, includeDerivativesInQuota: false },
  });
  (mocks.user as any).setPhysicalUsage = vi.fn().mockResolvedValue(void 0);
  mocks.user.getList.mockResolvedValue([user]);
  mocks.asset.getExternalAssetIds.mockResolvedValue(new Set<string>());
  mocks.storage.getFolderSize.mockResolvedValue(100);

  await expect(sut.handleUserSyncUsage()).resolves.toBe(JobStatus.Success);

  expect(mocks.user.syncUsage).toHaveBeenCalledWith();
  expect((mocks.user as any).setPhysicalUsage).toHaveBeenCalledWith(user.id, 500);
});

it('should skip the physical walk entirely when neither toggle is enabled', async () => {
  const user = factory.userAdmin({ id: 'user-id', storageLabel: 'storage-label' });
  mocks.systemMetadata.get.mockResolvedValue({
    storageUsage: { includeDerivativesInDisplay: false, includeDerivativesInQuota: false },
  });
  (mocks.user as any).setPhysicalUsage = vi.fn().mockResolvedValue(void 0);
  mocks.user.getList.mockResolvedValue([user]);

  await expect(sut.handleUserSyncUsage()).resolves.toBe(JobStatus.Success);

  expect(mocks.user.syncUsage).toHaveBeenCalledWith();
  expect(mocks.storage.getFolderSize).not.toHaveBeenCalled();
  expect((mocks.user as any).setPhysicalUsage).not.toHaveBeenCalled();
});

it('should exclude derivatives belonging to external library assets', async () => {
  const externalId = '0f9b1e2c-4a5d-4c8e-9f10-2b3c4d5e6f70';
  const user = factory.userAdmin({ id: 'user-id', storageLabel: 'storage-label' });
  mocks.systemMetadata.get.mockResolvedValue({
    storageUsage: { includeDerivativesInDisplay: true, includeDerivativesInQuota: false },
  });
  (mocks.user as any).setPhysicalUsage = vi.fn().mockResolvedValue(void 0);
  mocks.user.getList.mockResolvedValue([user]);
  mocks.asset.getExternalAssetIds.mockResolvedValue(new Set([externalId]));
  mocks.storage.getFolderSize.mockResolvedValue(0);

  await sut.handleUserSyncUsage();

  const thumbsCall = mocks.storage.getFolderSize.mock.calls.find(([folder]) => folder.includes('thumbs'))!;
  const shouldCount = thumbsCall[1] as (filename: string) => boolean;
  expect(shouldCount(`${externalId}_preview.webp`)).toBe(false);
  expect(shouldCount('0f9b1e2c-4a5d-4c8e-9f10-2b3c4d5e6f71_preview.webp')).toBe(true);
  expect(shouldCount('segment-00001.ts')).toBe(true);
});
```

The `500` is because `getDiskUsage` walks five folders and the mock returns `100` for each. The `shouldCount` function is located by folder name rather than by call index, so the assertion survives a reordering of the walk.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/user.service.spec.ts -t handleUserSyncUsage`
Expected: FAIL — `mocks.user.setPhysicalUsage is not a function`

- [ ] **Step 4: Restore the upstream repository method and add the physical setter**

In `server/src/repositories/user.repository.ts`, change `updateUsage` to move both columns, and replace `setUsage` with `setPhysicalUsage` plus the restored upstream `syncUsage`:

```ts
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER] })
  async updateUsage(id: string, delta: number): Promise<void> {
    await this.db
      .updateTable('user')
      .set({
        quotaUsageInBytes: sql`"quotaUsageInBytes" + ${delta}`,
        physicalUsageInBytes: sql`greatest(0, "physicalUsageInBytes" + ${delta})`,
        updatedAt: new Date(),
      })
      .where('id', '=', asUuid(id))
      .where('user.deletedAt', 'is', null)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER] })
  async setPhysicalUsage(id: string, usage: number): Promise<void> {
    await this.db
      .updateTable('user')
      .set({ physicalUsageInBytes: usage, updatedAt: new Date() })
      .where('id', '=', asUuid(id))
      .where('user.deletedAt', 'is', null)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async syncUsage(id?: string) {
    const query = this.db
      .updateTable('user')
      .set({
        quotaUsageInBytes: (eb) =>
          eb
            .selectFrom('asset')
            .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
            .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('asset_exif.fileSizeInByte'), eb.lit(0)).as('usage'))
            .where('asset.libraryId', 'is', null)
            .where('asset.ownerId', '=', eb.ref('user.id')),
        updatedAt: new Date(),
      })
      .where('user.deletedAt', 'is', null)
      .$if(id != undefined, (eb) => eb.where('user.id', '=', asUuid(id!)));

    await query.execute();
  }
```

Then extend the medium spec created in Task 2, `server/test/medium/specs/repositories/user-physical-usage.spec.ts`, to cover the restored SQL against a real database. This is the same expression the migration inlines, so it is the migration's real test too:

```ts
describe('UserRepository.syncUsage', () => {
  it('sums originals and ignores external library assets', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });

    const { asset: owned } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: owned.id, fileSizeInByte: 1000 });
    const { asset: external } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
    await ctx.newExif({ assetId: external.id, fileSizeInByte: 9_000_000 });

    await sut.syncUsage(user.id);

    const after = await ctx.get(UserRepository).get(user.id, { withDeleted: false });
    expect(after!.quotaUsageInBytes).toBe(1000);
  });
});

describe('UserRepository.updateUsage', () => {
  it('moves both the quota and the physical column', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    await sut.updateUsage(user.id, 500);

    const after = await ctx.get(UserRepository).get(user.id, { withDeleted: false });
    expect(after!.quotaUsageInBytes).toBe(500);
    expect(after!.physicalUsageInBytes).toBe(500);
  });

  it('clamps the physical column at zero', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    await sut.updateUsage(user.id, -500);

    const after = await ctx.get(UserRepository).get(user.id, { withDeleted: false });
    expect(after!.physicalUsageInBytes).toBe(0);
  });
});
```

Add a `setup()` helper to that spec mirroring the one in `test/medium/specs/repositories/asset.repository.spec.ts:22-28`, returning `sut: ctx.get(UserRepository)`.

Note the deliberate asymmetry: `physicalUsageInBytes` is clamped at zero, `quotaUsageInBytes` is not. The quota column keeps upstream's exact unclamped arithmetic so the fork does not silently diverge; the physical column is fork-owned and a negative physical size is meaningless.

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/user-physical-usage.spec.ts`
Expected: PASS

- [ ] **Step 5: Move the walk into the fork module**

The walk currently lives in upstream `base.service.ts` as ~50 lines of fork code. Move it wholesale into `server/src/gallery/storage-usage.ts`, taking its dependencies as arguments so the module has no framework coupling and is directly unit-testable. Append to the file created in Task 3:

```ts
import { StorageCore } from 'src/cores/storage.core';
import { UserAdmin } from 'src/database';
import { StorageFolder } from 'src/enum';
import { StorageBackend } from 'src/interfaces/storage-backend.interface';
import { AssetRepository } from 'src/repositories/asset.repository';
import { StorageRepository } from 'src/repositories/storage.repository';

type PhysicalUsageDeps = {
  user: Pick<UserAdmin, 'id' | 'storageLabel'>;
  assetRepository: AssetRepository;
  storageRepository: StorageRepository;
  s3: StorageBackend | undefined;
};

/**
 * Total bytes this user occupies on disk and in S3: originals, profile images, thumbnails and
 * transcodes. Upstream counts only originals and excludes external-library assets entirely
 * (user.repository.ts syncUsage, `libraryId is null`); derivative files are laid out by ownerId
 * with no library dimension, so external assets are filtered out here by asset id instead.
 */
export const computePhysicalUsage = async ({
  user,
  assetRepository,
  storageRepository,
  s3,
}: PhysicalUsageDeps): Promise<number> => {
  const externalAssetIds = await assetRepository.getExternalAssetIds(user.id);
  const shouldCount = (filename: string) => {
    const assetId = getDerivativeAssetId(filename);
    return assetId === null || !externalAssetIds.has(assetId);
  };

  // Originals (library/, upload/) and profile images are never external, so they are unfiltered.
  const disk = await Promise.all([
    storageRepository.getFolderSize(StorageCore.getLibraryFolder(user)),
    storageRepository.getFolderSize(StorageCore.getFolderLocation(StorageFolder.Upload, user.id)),
    storageRepository.getFolderSize(StorageCore.getFolderLocation(StorageFolder.Profile, user.id)),
    storageRepository.getFolderSize(StorageCore.getFolderLocation(StorageFolder.Thumbnails, user.id), shouldCount),
    storageRepository.getFolderSize(StorageCore.getFolderLocation(StorageFolder.EncodedVideo, user.id), shouldCount),
  ]);
  let total = disk.reduce((total, value) => total + value, 0);

  if (s3) {
    const remote = await Promise.all([
      s3.getPrefixUsage(`${StorageFolder.Upload}/${user.id}/`),
      s3.getPrefixUsage(`${StorageFolder.Profile}/${user.id}/`),
      s3.getPrefixUsage(`${StorageFolder.Thumbnails}/${user.id}/`, shouldCount),
      s3.getPrefixUsage(`${StorageFolder.EncodedVideo}/${user.id}/`, shouldCount),
    ]);
    total += remote.reduce((total, value) => total + value, 0);
  }

  return total;
};
```

Note the S3 backend now arrives as a parameter, which removes the `await import('./storage.service.js')` circular-dependency dodge that existed only because this code sat inside `BaseService`.

- [ ] **Step 6: Reduce the upstream `base.service.ts` footprint**

In `server/src/services/base.service.ts`, delete `getPhysicalUsage` and `getDiskUsage` entirely and replace `syncUsage` with a thin delegate. This is the whole fork footprint in that file:

```ts
  // Gallery-fork: upstream calls userRepository.syncUsage() directly from the two call sites
  // below this method. The fork keeps that behaviour as-is and layers the optional physical-usage
  // pass on top; all of its logic lives in src/gallery/storage-usage.ts.
  protected async syncUsage(id?: string): Promise<void> {
    await this.userRepository.syncUsage(id);

    // The walk is expensive — hundreds of thousands of stat calls on a large install. With both
    // toggles off nothing reads the column, so skip it and keep the nightly job as cheap as
    // upstream's.
    const { storageUsage } = await this.getConfig({ withCache: false });
    if (!storageUsage.includeDerivativesInDisplay && !storageUsage.includeDerivativesInQuota) {
      return;
    }

    const { StorageService } = await import('./storage.service.js');
    const s3 = StorageService.getS3Backend();
    const users = id
      ? [await this.userRepository.get(id, { withDeleted: false })].filter((user): user is UserAdmin => !!user)
      : await this.userRepository.getList({ withDeleted: false });

    for (const user of users) {
      const usage = await computePhysicalUsage({
        user,
        assetRepository: this.assetRepository,
        storageRepository: this.storageRepository,
        s3,
      });
      await this.userRepository.setPhysicalUsage(user.id, usage);
    }
  }
```

Add `import { computePhysicalUsage } from 'src/gallery/storage-usage';` to the imports, and remove the now-unused `StorageCore` / `StorageFolder` imports if nothing else in the file uses them.

Leave `user.service.ts:262-266` and `user-admin.service.ts:62-64` **untouched** — they already read `await this.syncUsage(...)`, one word from upstream, and that is as small as this fork's footprint gets there.

- [ ] **Step 7: Queue a resync from a fork-owned service**

Without this, enabling a toggle shows a stale or zero column until the next nightly run.

Do **not** edit `system-config.service.ts` for this. Upstream already broadcasts a `ConfigUpdate` event carrying both the old and new config (`event.repository.ts:31-37`), and several services subscribe to it (`queue.service.ts:64`, `integrity.service.ts:128`). A fork-owned subscriber gets the same result with zero upstream service divergence.

Create `server/src/gallery/storage-usage.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { SystemConfig } from 'src/config';
import { JobName, QueueName } from 'src/enum';
import { OnEvent } from 'src/decorators';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';

const derivativesEnabled = (config: SystemConfig) =>
  config.storageUsage.includeDerivativesInDisplay || config.storageUsage.includeDerivativesInQuota;

@Injectable()
export class StorageUsageService extends BaseService {
  /**
   * The physical-usage column is only maintained while at least one toggle is on, so switching one
   * on would otherwise show a stale or zero figure until the next nightly sync. Queue a resync on
   * the off -> on transition only; flipping the second toggle on, or turning one off, needs nothing.
   */
  @OnEvent({ name: 'ConfigUpdate', server: true })
  async onConfigUpdate({ newConfig, oldConfig }: ArgOf<'ConfigUpdate'>) {
    if (!derivativesEnabled(oldConfig) && derivativesEnabled(newConfig)) {
      await this.jobRepository.queue({ name: JobName.UserSyncUsage });
    }
  }
}
```

Confirm the import paths for `OnEvent` and `ArgOf` against `queue.service.ts:64` and match that file exactly — it is the closest working example. Drop the `QueueName` import if the queue call does not need it.

- [ ] **Step 8: Register the fork service**

In `server/src/services/index.ts`, add the import in alphabetical position and the class to the exported array — two additive lines, matching how `ClassificationService` (`:10`, `:71`) and `SharedSpaceService` (`:39`, `:100`) are registered.

- [ ] **Step 9: Test the resync hook**

Create `server/src/gallery/storage-usage.service.spec.ts`:

```ts
import { StorageUsageService } from 'src/gallery/storage-usage.service';
import { JobName } from 'src/enum';
import { newTestService, ServiceMocks } from 'test/utils';

describe(StorageUsageService.name, () => {
  let sut: StorageUsageService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(StorageUsageService));
  });

  const config = (display: boolean, quota: boolean) =>
    ({ storageUsage: { includeDerivativesInDisplay: display, includeDerivativesInQuota: quota } }) as never;

  it('queues a resync when the first toggle is switched on', async () => {
    await sut.onConfigUpdate({ oldConfig: config(false, false), newConfig: config(true, false) });

    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.UserSyncUsage });
  });

  it('does not queue a resync when both toggles stay off', async () => {
    await sut.onConfigUpdate({ oldConfig: config(false, false), newConfig: config(false, false) });

    expect(mocks.job.queue).not.toHaveBeenCalled();
  });

  it('does not re-queue when the second toggle is switched on', async () => {
    await sut.onConfigUpdate({ oldConfig: config(true, false), newConfig: config(true, true) });

    expect(mocks.job.queue).not.toHaveBeenCalled();
  });
});
```

Match `newTestService`'s actual return shape and the job mock's name against a neighbouring service spec.

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/user.service.spec.ts src/services/user-admin.service.spec.ts src/gallery/storage-usage.service.spec.ts`
Expected: PASS. `user-admin.service.spec.ts` asserts on the quota-change path — update its expectation from `mocks.user.setUsage` to `mocks.user.syncUsage` / `setPhysicalUsage` as needed.

- [ ] **Step 11: Commit**

```bash
git add server/src/repositories/user.repository.ts server/src/services/base.service.ts server/src/services/index.ts server/src/gallery server/src/services/user.service.spec.ts server/src/services/user-admin.service.spec.ts server/test/medium/specs/repositories/user-physical-usage.spec.ts
git commit -m "fix(server): restore upstream quota usage and track physical usage separately"
```

---

### Task 7: Quota enforcement reads the selected column

**Files:**

- Modify: `server/src/services/asset-media.service.ts:456-460`
- Modify: `server/src/database.ts:495` (`authUser` column list) and `:22-29` (`AuthUser` type)
- Modify: `server/test/small.factory.ts:113-124` (`authUserFactory`)
- Test: `server/src/services/asset-media.service.spec.ts:342`

**Interfaces:**

- Consumes: `SystemConfig['storageUsage'].includeDerivativesInQuota` (Task 1), `user.physicalUsageInBytes` (Task 2).
- Produces: `requireQuota` becomes `async`. There is exactly **one** call site, `asset-media.service.ts:154`, and `no-floating-promises` is enforced repo-wide, so a missed `await` is a lint error rather than a silent bug.

**Build-breaking detail:** `AuthUser` (`database.ts:22-29`) is constructed as an explicit object literal by `authUserFactory` (`test/small.factory.ts:113-124`). Adding a required field to the type without updating that factory fails `pnpm check`.

- [ ] **Step 1: Write the failing tests**

In `server/src/services/asset-media.service.spec.ts` — both directions, because the OFF case is the default and therefore the one worth guarding:

```ts
it('should enforce quota against physical usage when the toggle is enabled', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    storageUsage: { includeDerivativesInDisplay: false, includeDerivativesInQuota: true },
  });
  const auth = {
    ...authStub.admin,
    user: { ...authStub.admin.user, quotaSizeInBytes: 100, quotaUsageInBytes: 1, physicalUsageInBytes: 99 },
  };

  await expect(sut.uploadAsset(auth, createDto, file)).rejects.toThrow('Quota has been exceeded!');
});

it('should enforce quota against originals by default', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    storageUsage: { includeDerivativesInDisplay: false, includeDerivativesInQuota: false },
  });
  const auth = {
    ...authStub.admin,
    user: { ...authStub.admin.user, quotaSizeInBytes: 100, quotaUsageInBytes: 1, physicalUsageInBytes: 99 },
  };

  await expect(sut.uploadAsset(auth, createDto, file)).resolves.toBeDefined();
});
```

Adapt `createDto` / `file` to the names the surrounding tests in this file already use, and give `file` a size of at least 2. This file does not currently stub `systemMetadata.get`, so confirm `mocks.systemMetadata` is available from `newTestService` and that stubbing it does not disturb the other tests in the file — if it does, scope the stub with a local `beforeEach` inside the new `describe`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/asset-media.service.spec.ts -t 'physical usage'`
Expected: FAIL — no exception thrown, because enforcement still reads `quotaUsageInBytes` (1).

- [ ] **Step 3: Add the column to the auth user selection**

In `server/src/database.ts:495`, extend the `authUser` list:

```ts
  authUser: [
    'user.id',
    'user.name',
    'user.email',
    'user.isAdmin',
    'user.quotaUsageInBytes',
    'user.physicalUsageInBytes',
    'user.quotaSizeInBytes',
  ],
```

Also add `physicalUsageInBytes: number;` to the `AuthUser` type at `server/src/database.ts:22-29`, and update `authUserFactory` in `server/test/small.factory.ts:113-124` so the destructure and the returned literal both carry it:

```ts
const authUserFactory = (authUser: Partial<AuthUser> = {}) => {
  const {
    id = newUuid(),
    isAdmin = false,
    name = 'Test User',
    email = 'test@immich.cloud',
    quotaUsageInBytes = 0,
    physicalUsageInBytes = 0,
    quotaSizeInBytes = null,
  } = authUser;

  return { id, isAdmin, name, email, quotaUsageInBytes, physicalUsageInBytes, quotaSizeInBytes };
};
```

Do **not** touch `server/src/repositories/event.repository.ts:128-139`. That is an event payload type, not the auth user; adding a required field there would force every emit site to supply it for no benefit.

- [ ] **Step 4: Make enforcement config-aware**

In `server/src/services/asset-media.service.ts`:

```ts
  private async requireQuota(auth: AuthDto, size: number) {
    if (auth.user.quotaSizeInBytes === null) {
      return;
    }

    // Gallery-fork: enforce against physical usage when the admin has opted in; upstream always
    // enforces against quotaUsageInBytes, which is what the default branch below preserves.
    const { storageUsage } = await this.getConfig({ withCache: true });
    const used = storageUsage.includeDerivativesInQuota ? auth.user.physicalUsageInBytes : auth.user.quotaUsageInBytes;

    if (auth.user.quotaSizeInBytes < used + size) {
      throw new BadRequestException('Quota has been exceeded!');
    }
  }
```

Then `await` the single call site at `asset-media.service.ts:154` — confirm with `grep -n 'requireQuota' server/src/services/asset-media.service.ts` that no others have appeared.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/asset-media.service.spec.ts`
Expected: PASS, including the pre-existing quota test at line 342.

- [ ] **Step 6: Type-check, to catch any other AuthUser construction site**

Run: `cd server && pnpm check`
Expected: no errors. If this fails, another place builds `AuthUser` as a literal — add `physicalUsageInBytes` there too rather than widening the type to optional.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/asset-media.service.ts server/src/database.ts server/test/small.factory.ts server/src/services/asset-media.service.spec.ts
git commit -m "feat(server): enforce quota against physical usage when opted in"
```

---

### Task 8: Expose the new field and flag to clients

**Files:**

- Modify: `server/src/dtos/user.dto.ts:126-127` (schema) and `:148-151` (`mapUserAdmin`)
- Modify: `server/src/database.ts` (`userAdmin` column list ~line 500, and the `UserAdmin` type at `:140-148`)
- Modify: `server/test/small.factory.ts:193-225` (`userAdminFactory`)
- Modify: `server/src/dtos/server.dto.ts:113-129` (`ServerConfigSchema`)
- Modify: `server/src/services/server.service.ts` (`getConfig`)
- Test: `server/src/services/server.service.spec.ts`

**Interfaces:**

- Produces: `UserAdminResponseDto.physicalUsageInBytes: number | null` and `ServerConfigDto.storageUsageIncludesDerivatives: boolean`.

**Build-breaking detail:** same trap as Task 7, one type down. `UserAdmin` (`database.ts:140-148`) is built as an explicit literal by `userAdminFactory` (`test/small.factory.ts:193-225`) — add `physicalUsageInBytes = 0` to both its destructure and its returned object, or `pnpm check` fails.

The DTO field is declared `.nullable()` to match the neighbouring `quotaUsageInBytes` exactly, even though the column is `NOT NULL`. Consistency with the upstream field beats correcting it here; the web derivation's `|| 0` already absorbs a null.

- [ ] **Step 1: Write the failing test**

In `server/src/services/server.service.spec.ts`, inside the `getConfig` describe:

```ts
it('should report whether displayed usage includes derivatives', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    storageUsage: { includeDerivativesInDisplay: true, includeDerivativesInQuota: false },
  });

  await expect(sut.getConfig()).resolves.toMatchObject({ storageUsageIncludesDerivatives: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/server.service.spec.ts -t 'includes derivatives'`
Expected: FAIL — property missing.

- [ ] **Step 3: Add the DTO fields**

In `server/src/dtos/user.dto.ts`, next to the existing `quotaUsageInBytes` entry in the schema:

```ts
  physicalUsageInBytes: z.int().min(0).nullable().describe('Physical storage usage in bytes, including derivatives'),
```

and in `mapUserAdmin`:

```ts
    physicalUsageInBytes: entity.physicalUsageInBytes,
```

In `server/src/database.ts`, add `'physicalUsageInBytes'` to the `userAdmin` column list next to `'quotaUsageInBytes'`, and `physicalUsageInBytes: number;` to the `UserAdmin` type at `:140-148`. Then add it to `userAdminFactory` in `server/test/small.factory.ts` — `physicalUsageInBytes = 0` in the destructure at `:193-212`, and `physicalUsageInBytes` in the returned object at `:213-225`.

In `server/src/dtos/server.dto.ts`, add to `ServerConfigSchema`:

```ts
    storageUsageIncludesDerivatives: z
      .boolean()
      .describe('Whether displayed storage usage includes thumbnails and transcoded videos'),
```

In `server/src/services/server.service.ts` `getConfig()`, add to the returned object:

```ts
      storageUsageIncludesDerivatives: config.storageUsage.includeDerivativesInDisplay,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/server.service.spec.ts src/services/user.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Regenerate SQL and the OpenAPI clients**

The SQL regeneration **requires a running database** — start the dev stack first (`make dev`) or it will delete every query file.

```bash
make sql
cd server && pnpm build && pnpm sync:open-api
cd .. && make open-api-typescript
```

Dart regeneration (`make open-api-dart`) needs Java; run it only if mobile is in scope for this change.

- [ ] **Step 6: Commit**

```bash
git add server/src/dtos server/src/database.ts server/test/small.factory.ts server/src/services/server.service.ts server/src/queries open-api packages/sdk
git commit -m "feat(api): expose physical usage and the display toggle"
```

---

### Task 9: Web sidebar reads the selected number

**Files:**

- Modify: `web/src/lib/components/shared-components/side-bar/StorageSpace.svelte:11-21`
- Modify: `web/src/lib/components/shared-components/side-bar/rail-storage.svelte:15-25`
- Test: `web/src/lib/components/shared-components/side-bar/rail-storage.spec.ts`

**Interfaces:**

- Consumes: `ServerConfigDto.storageUsageIncludesDerivatives` (Task 8), `UserAdminResponseDto.physicalUsageInBytes` (Task 8).

`serverConfigManager.value` throws when the manager has not been initialised, which is exactly the state a component test renders in — so the derivation must not reach for it unguarded, and the spec must mock it.

This spec has a specific shape that must be matched: mocks are declared through `vi.hoisted` at `:7-12`, reset in a `beforeEach` at `:41-45`, and values are read back through the `bytes()` helper at `:25-28` (`screen.getByTestId('rail-storage').dataset.used` / `.available`) — **not** through `findByText`.

- [ ] **Step 1: Write the failing tests**

In `web/src/lib/components/shared-components/side-bar/rail-storage.spec.ts`, extend the hoisted mock block at `:7-12` so the user carries the new field and the server config is mockable:

```ts
const mocks = vi.hoisted(() => ({
  authManager: {
    authenticated: true,
    user: { quotaSizeInBytes: null as number | null, quotaUsageInBytes: 0, physicalUsageInBytes: 0 },
  },
  userInteraction: {
    serverInfo: { diskSizeRaw: 0, diskUseRaw: 0 } as { diskSizeRaw: number; diskUseRaw: number } | undefined,
  },
  serverConfigManager: { valueOrUndefined: { storageUsageIncludesDerivatives: false } },
}));

vi.mock('$lib/managers/server-config-manager.svelte', () => ({ serverConfigManager: mocks.serverConfigManager }));
```

Extend the existing `beforeEach` at `:41-45` so both new pieces of state reset between tests — this file has no `clearMocks`, so anything left mutated leaks into the tests that follow:

```ts
mocks.authManager.user = { quotaSizeInBytes: null, quotaUsageInBytes: 0, physicalUsageInBytes: 0 };
mocks.serverConfigManager.valueOrUndefined = { storageUsageIncludesDerivatives: false };
```

Then add both directions, using the file's own `bytes()` helper:

```ts
it('shows quota usage when the server excludes derivatives', () => {
  mocks.authManager.user = { quotaSizeInBytes: 1000, quotaUsageInBytes: 100, physicalUsageInBytes: 300 };

  render(RailStorage);

  expect(bytes()).toEqual({ used: 100, available: 1000 });
});

it('shows physical usage when the server includes derivatives', () => {
  mocks.serverConfigManager.valueOrUndefined = { storageUsageIncludesDerivatives: true };
  mocks.authManager.user = { quotaSizeInBytes: 1000, quotaUsageInBytes: 100, physicalUsageInBytes: 300 };

  render(RailStorage);

  expect(bytes()).toEqual({ used: 300, available: 1000 });
});

it('still shows server disk usage when the user has no quota, regardless of the toggle', () => {
  mocks.serverConfigManager.valueOrUndefined = { storageUsageIncludesDerivatives: true };
  mocks.authManager.user = { quotaSizeInBytes: null, quotaUsageInBytes: 100, physicalUsageInBytes: 300 };
  mocks.userInteraction.serverInfo = { diskSizeRaw: 50_000, diskUseRaw: 12_000 };

  render(RailStorage);

  expect(bytes()).toEqual({ used: 12_000, available: 50_000 });
});
```

That third case guards the interaction the two toggles do not change: the no-quota path still falls back to whole-server disk figures, which is the upstream behaviour Eddified described and is deliberately left alone by this work.

Add the equivalent assertion to the StorageSpace parity block at `:96-120` so both components stay pinned together.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/components/shared-components/side-bar/rail-storage.spec.ts`
Expected: FAIL on the "includes derivatives" case — `bytes()` reports `used: 100`, the quota number. The other two cases should already pass, which confirms the new mock wiring did not disturb existing behaviour.

- [ ] **Step 3: Update both components**

First add a non-throwing accessor to `web/src/lib/managers/server-config-manager.svelte.ts`, next to the existing `get value()`. The existing getter throws when the manager has not been initialised, which is a legitimate state for the sidebar to render in:

```ts
  get valueOrUndefined() {
    return this.#value;
  }
```

Then create the shared derivation in the web fork namespace — this is the first file in `web/src/lib/gallery/**`. Both sidebar components call it, so the logic exists once and the upstream component keeps a three-line diff.

Create `web/src/lib/gallery/storage-usage.ts`:

```ts
import type { ServerConfigDto, UserAdminResponseDto } from '@immich/sdk';

type StorageSpaceInput = {
  user: UserAdminResponseDto;
  authenticated: boolean;
  serverInfo?: { diskSizeRaw: number; diskUseRaw: number };
  serverConfig?: ServerConfigDto;
};

/**
 * Which pair of numbers the sidebar meter shows.
 *
 * A user with no quota sees whole-server disk figures — upstream behaviour, deliberately kept.
 * A user with a quota sees their own usage, reading either the upstream originals-only column or
 * the fork's physical column depending on the server-wide display toggle.
 */
export const getStorageSpace = ({ user, authenticated, serverInfo, serverConfig }: StorageSpaceInput) => {
  const hasQuota = user.quotaSizeInBytes !== null;
  if (!hasQuota || !authenticated) {
    return { usedBytes: serverInfo?.diskUseRaw || 0, availableBytes: serverInfo?.diskSizeRaw || 0 };
  }

  const includeDerivatives = serverConfig?.storageUsageIncludesDerivatives ?? false;
  const used = includeDerivatives ? user.physicalUsageInBytes : user.quotaUsageInBytes;

  return { usedBytes: used || 0, availableBytes: user.quotaSizeInBytes || 0 };
};
```

Then reduce both components to a call. In `StorageSpace.svelte` (upstream) replace the `hasQuota` / `availableBytes` / `usedBytes` block at `:11-21` with:

```ts
// Gallery-fork: derivation shared with rail-storage.svelte, see $lib/gallery/storage-usage.
let space = $derived(
  getStorageSpace({
    user: authManager.user,
    authenticated: authManager.authenticated,
    serverInfo: userInteraction.serverInfo,
    serverConfig: serverConfigManager.valueOrUndefined,
  }),
);
let availableBytes = $derived(space.availableBytes);
let usedBytes = $derived(space.usedBytes);
```

Apply the same block to `rail-storage.svelte` (fork-owned) at `:15-25`, and replace its "Duplicated from StorageSpace.svelte" comment with a note that the derivation now lives in `$lib/gallery/storage-usage` and is shared. Add the two imports to both files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm vitest run src/lib/components/shared-components/side-bar/rail-storage.spec.ts`
Expected: PASS, including the existing StorageSpace-parity block at lines 96-120 — which is now guaranteed by construction rather than by careful copying.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/gallery web/src/lib/components/shared-components/side-bar web/src/lib/managers/server-config-manager.svelte.ts
git commit -m "feat(web): show physical storage usage when the server opts in"
```

---

### Task 10: Admin settings panel + translations

**Files:**

- Create: `web/src/routes/admin/system-settings/StorageUsageSettings.svelte`
- Modify: `web/src/routes/admin/system-settings/+page.svelte` (register the section)
- Modify: `i18n/en.json` + the nine required locales

**Interfaces:**

- Consumes: `SystemConfigDto.storageUsage` (Task 1).

- [ ] **Step 1: Add the English strings**

In `i18n/en.json`, inside the `admin` object, in alphabetical position:

```json
    "storage_usage_include_derivatives_display_setting": "Include cached files in displayed usage",
    "storage_usage_include_derivatives_display_setting_description": "Count thumbnails and transcoded videos in the storage usage shown to users. Off by default, matching upstream Immich, where only original files are counted.",
    "storage_usage_include_derivatives_quota_setting": "Include cached files in quota enforcement",
    "storage_usage_include_derivatives_quota_setting_description": "Count thumbnails and transcoded videos against each user's storage quota. Enabling this reduces how much original media a user can upload within the same quota.",
    "storage_usage_settings": "Storage usage",
    "storage_usage_settings_description": "Choose whether server-generated files count toward user storage usage",
```

- [ ] **Step 2: Translate into the nine required locales**

Add the same six keys to `de` `fr` `it` `nl` `pl` `es` `ru` `zh_Hans` `zh_Hant`. Match each file's existing register: `de`/`it`/`es` address the user informally (`du`/`tu`/`tú`), `fr`/`ru` use formal `vous`/`вы`. Reuse each file's existing word for "thumbnail" and "quota" — look up the nearest existing key rather than inventing a synonym.

Then run: `npx prettier --write i18n/*.json`

- [ ] **Step 3: Create the settings section**

Create `web/src/routes/admin/system-settings/StorageUsageSettings.svelte`, modelled on `NightlyTasksSettings.svelte` — open that file and copy its exact props, imports, `SettingAccordion`/`SettingSwitch` structure and `SettingButtonsRow` usage, substituting:

```svelte
        <SettingSwitch
          title={$t('admin.storage_usage_include_derivatives_display_setting')}
          subtitle={$t('admin.storage_usage_include_derivatives_display_setting_description')}
          bind:checked={configToEdit.storageUsage.includeDerivativesInDisplay}
          {disabled}
        />
        <SettingSwitch
          title={$t('admin.storage_usage_include_derivatives_quota_setting')}
          subtitle={$t('admin.storage_usage_include_derivatives_quota_setting_description')}
          bind:checked={configToEdit.storageUsage.includeDerivativesInQuota}
          {disabled}
        />
```

with `<SettingButtonsRow bind:configToEdit keys={['storageUsage']} {disabled} />`.

- [ ] **Step 4: Register the section**

In `web/src/routes/admin/system-settings/+page.svelte`, add `import StorageUsageSettings from './StorageUsageSettings.svelte';` in alphabetical position among the sibling imports at `:11-21`, then add an entry to the settings list matching the shape of the `NightlyTasksSettings` entry at `:147-153`:

```ts
    {
      component: StorageUsageSettings,
      title: $t('admin.storage_usage_settings'),
      subtitle: $t('admin.storage_usage_settings_description'),
      key: 'storage-usage',
      icon: mdiChartPie,
    },
```

Place it next to the `StorageTemplateSettings` entry so the two storage sections sit together, and add `mdiChartPie` to the existing `@mdi/js` import — or reuse an icon already imported in this file if you prefer not to grow that import.

- [ ] **Step 5: Verify**

```bash
cd web && pnpm check:typescript && pnpm check:svelte
cd .. && npx prettier --check i18n/*.json
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/admin/system-settings i18n
git commit -m "feat(web): add admin settings for derivative storage accounting"
```

---

### Task 12: Document and pin config-file support

**Files:**

- Modify: `docs/docs/install/config-file.md`
- Test: `server/src/services/system-config.service.spec.ts`

**Interfaces:**

- Consumes: `SystemConfig['storageUsage']` (Task 1).

Both toggles are already settable from `IMMICH_CONFIG_FILE` with no additional code: `buildConfig` (`server/src/utils/config.ts:76-95`) loads the file and deep-merges it over `defaults`, then rejects any key not present in `defaults`. Task 1 added `storageUsage` to `defaults` and to `SystemConfigSchema`, which is exactly what makes the key both settable and valid. This task documents that surface and pins it with a test, so a future refactor cannot silently make the key unknown again.

- [ ] **Step 1: Write the failing test**

In `server/src/services/system-config.service.spec.ts`, alongside the existing config-file tests (there are already cases using `mockEnvData({ configFile: 'immich-config.json' })` around `:416-425` — follow their arrangement exactly, including how they stub the file read):

```ts
it('should accept storageUsage from a config file', async () => {
  mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));
  mocks.systemMetadata.readFile.mockResolvedValue(
    JSON.stringify({ storageUsage: { includeDerivativesInDisplay: true, includeDerivativesInQuota: true } }),
  );

  const config = await sut.getConfig({ withCache: false });

  expect(config.storageUsage.includeDerivativesInDisplay).toBe(true);
  expect(config.storageUsage.includeDerivativesInQuota).toBe(true);
});
```

Match the mock names to whatever the neighbouring config-file tests actually use — `mocks.systemMetadata.readFile` is the expected one given `loadFromFile` calls `metadataRepo.readFile`, but verify against the existing tests rather than assuming.

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `cd server && pnpm vitest --config test/vitest.config.mjs run src/services/system-config.service.spec.ts -t 'config file'`

**This test is expected to PASS without any production change** — it is a characterization test pinning behaviour Task 1 already delivered, not TDD for new code. If it FAILS, that is a real finding: it means the key is not reaching the merged config, and you should report it rather than changing the test to match. Note the difference from the other tasks in this plan and do not force a red phase.

- [ ] **Step 3: Document the option**

In `docs/docs/install/config-file.md`, the example JSON block lists every top-level config key in alphabetical order. Add `storageUsage` immediately after the `storageTemplate` block (which starts at `:234`), matching the file's two-space indentation and key ordering:

```json
  "storageUsage": {
    "includeDerivativesInDisplay": false,
    "includeDerivativesInQuota": false
  },
```

Then add a short prose note after the JSON block, in the style of the existing `nightlyTasks.generateMemories` note at `:337`, explaining what the two flags do and that both default to `false` so usage matches upstream Immich:

> `storageUsage` controls whether server-generated files — thumbnails and transcoded videos — count toward a user's storage usage. Both flags default to `false`, matching upstream Immich, where only original files are counted. `includeDerivativesInDisplay` changes the figure shown to users; `includeDerivativesInQuota` changes what their storage quota is enforced against. Enabling the quota flag reduces how much original media a user can upload within the same quota.

- [ ] **Step 4: Verify docs formatting**

Run: `npx prettier --check docs/docs/install/config-file.md`
Expected: clean. CI Docs Build is strict; run `--write` if it reports a diff.

- [ ] **Step 5: Commit**

```bash
git add docs/docs/install/config-file.md server/src/services/system-config.service.spec.ts
git commit -m "docs: document storageUsage config file options"
```

---

### Task 11: Declare the change in the fork ownership manifest

**Files:**

- Modify: `docs/fork/ownership.yml`

`make fork-ownership-coverage-check` diffs `upstream/main...origin/main` and fails if any differing file is not claimed by a feature in this manifest. Every file this plan creates or touches must be declared, or the check goes red after merge.

- [ ] **Step 1: Extend the `storage-and-media` feature**

This work belongs to the existing `storage-and-media` feature (`docs/fork/ownership.yml:95-137`), which already owns `server/src/backends/s3-storage.backend.ts` and lists `server/src/services/user.service.ts` as an upstream extension. Add an alias, the new owned paths, and the upstream files this plan touches:

```yaml
aliases:
  - storage-usage-accounting # <- add to the existing list
owned_paths:
  - server/src/gallery/storage-usage*.ts
  - web/src/lib/gallery/storage-usage.ts
  - web/src/routes/admin/system-settings/StorageUsageSettings.svelte
upstream_extension_paths:
  - server/src/services/base.service.ts
  - server/src/services/asset-media.service.ts
  - server/src/repositories/user.repository.ts
  - server/src/repositories/asset.repository.ts
  - server/src/repositories/storage.repository.ts
  - server/src/schema/tables/user.table.ts
  - server/src/database.ts
  - server/src/config.ts
  - server/src/dtos/system-config.dto.ts
  - server/src/dtos/user.dto.ts
  - server/src/dtos/server.dto.ts
  - server/src/services/server.service.ts
  - server/src/services/index.ts
  - web/src/lib/components/shared-components/side-bar/StorageSpace.svelte
  - web/src/routes/admin/system-settings/+page.svelte
database:
  migration_globs:
    - server/src/schema/migrations-gallery/*PhysicalUsage*.ts # <- add to the existing list
```

Merge these into the existing lists rather than replacing them — several entries (`server/src/services/user.service.ts`, the storage-migration globs) are already present and must stay. Check each path against the current file before adding it, since some may already be claimed by another feature; a path claimed twice is as much a problem as one claimed zero times.

- [ ] **Step 2: Run the coverage check**

Run: `make fork-ownership-coverage-check`
Expected: pass. Note it compares `origin/main` against `upstream/main`, so on a feature branch it reports the state of `main`, not your branch — the real signal comes after merge. If it fails on `last_verified_fork_head` rather than on paths, that field simply needs updating to the current `origin/main` and is not caused by this change.

- [ ] **Step 3: Commit**

```bash
git add docs/fork/ownership.yml
git commit -m "chore(fork): declare storage usage accounting in the ownership manifest"
```

---

## Final Verification

**The three lists that silently break.** Adding a repository method or a field to `AuthUser`/`UserAdmin` is not self-contained in this codebase — three hand-maintained places mirror those shapes and fail at type-check, often with an error pointing somewhere unrelated. Confirm each before running the suites:

- [ ] `server/test/repositories/asset.repository.mock.ts` carries `getExternalAssetIds` (Task 5)
- [ ] `server/test/small.factory.ts` `authUserFactory` carries `physicalUsageInBytes` (Task 7)
- [ ] `server/test/small.factory.ts` `userAdminFactory` carries `physicalUsageInBytes` (Task 8)

Then:

- [ ] `cd server && pnpm test --run` — full unit suite. Note the known pre-existing flake: `src/controllers/search.controller.spec.ts` can fail with `socket hang up` under full-suite parallelism; re-run that file alone to confirm it passes.
- [ ] `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/user-physical-usage.spec.ts test/medium/specs/repositories/asset.repository.spec.ts` — needs Docker.
- [ ] `cd server && pnpm check && pnpm lint`
- [ ] `cd web && pnpm test --run && pnpm check:typescript && pnpm check:svelte && pnpm lint`
- [ ] `make format-all`
- [ ] `make fork-ownership-coverage-check` — every touched file declared in `docs/fork/ownership.yml` (Task 11).
- [ ] `npx prettier --check docs/superpowers/plans/*.md` — CI Docs Build is strict.
- [ ] `git diff upstream/main -- server/src/services/base.service.ts` — confirm the fork footprint there is the single `syncUsage` delegate and nothing else; this change is supposed to _reduce_ that diff.
- [ ] `grep -rn "Gallery-fork" server/src web/src` — every upstream file this plan touches for behaviour (not just a type or list entry) should appear.
- [ ] Manual: with both toggles off, a user's sidebar figure matches `sum(fileSizeInByte)` for their non-external assets, **and** the nightly sync performs no filesystem walk (check logs / job duration).
- [ ] Manual: enable the display toggle — the resync job is queued immediately, and after it runs the figure rises to include thumbnails and transcodes. A user with an external library does **not** see the library's derivatives counted.
- [ ] Manual: enable the quota toggle with a small quota, confirm uploads are rejected against the physical figure.
- [ ] Manual: a user with no quota still sees whole-server disk figures in the sidebar, with either toggle on — unchanged upstream behaviour.

## Known limitations, to state in the PR description

- **Physical usage lags on derivative bytes between nightly runs.** Live deltas track original file sizes only, so deleting an asset leaves its thumbnail/transcode bytes counted until the next scan reconciles. Bounded and self-correcting.
- **A nightly scan racing an upload can clobber a delta.** `setPhysicalUsage` absolute-sets; an upload completing mid-scan may have its delta overwritten. Corrects itself on the next run. Pre-existing in the same shape today.
- **HLS segments, Android motion sidecars and person thumbnails are always counted**, even when they belong to an external-library asset, because they are not keyed on an asset id.

## Out of Scope

- **Mobile.** `mobile/lib/widgets/common/app_bar_dialog/app_bar_dialog.dart:142-171` shows `quotaUsageInBytes`, which after this change means upstream semantics — correct for the default configuration, but it will not follow the display toggle. Wiring it up needs `make open-api-dart` (Java) and a `physicalUsageInBytes` column on the Drift `auth_user` entity plus the sync-stream ingest. Track separately.
- **The admin server-status page.** `usageByUser[].usage` remains upstream originals-only, which now _agrees_ with the default `quotaUsageInBytes` — the pre-existing contradiction between the two cards on the admin user page disappears at the default setting, but returns if the display toggle is enabled. Reconciling that view is a separate change.
