# Phase A Slice A3 — ML-repo `analyzeAssetQuality` + per-asset job + queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Compute and store per-asset quality scores: a `machineLearningRepository.analyzeAssetQuality()` method, an `ImageQualityService` with a per-asset `@OnJob` handler (asset → ML → store into `asset_quality` + set `qualityScoredAt`) and a queue-all handler, a dedicated `QueueName.ImageQuality` + `JobName.ImageQuality`/`ImageQualityQueueAll`, and the eligible-asset stream/get repo methods.

**Architecture:** End-to-end mirror of the OCR feature and the **PetDetection fork feature** (which added its own `QueueName.PetDetection` exactly this way). Queue-all-only trigger (no per-asset auto-chain), gated on the global `machineLearning.enabled` flag (no new system-config sub-block — the heuristic predictor has no tunable params). Scores persist via a new `AssetRepository.upsertAssetQuality()`; completion via the existing `upsertJobStatus({ qualityScoredAt })` (shipped in A2).

**Tech Stack:** NestJS, Kysely, `@OnJob`/BullMQ, `@immich/sql-tools`, the ML FastAPI `/predict` (task `image-quality`), Vitest unit (`newTestService`) + medium (`newMediumService`), SvelteKit admin queue UI.

**ML string match (verified):** Python `ModelTask.IMAGE_QUALITY = "image-quality"`, `ModelType.VISUAL = "visual"` (`machine-learning/immich_ml/schemas.py`). The server `ModelTask` enum must add `IMAGE_QUALITY = 'image-quality'`; server `ModelType.VISUAL = 'visual'` already exists.

**CI gates this slice hits (all must stay green):**

- `make check-server` (tsc): exhaustive `Record<ConcurrentQueueName>` (config.ts), the `satisfies` records, the ML request union.
- `make check-web` (svelte-check/tsc): exhaustive `Record<QueueName, QueueItem>` in `web/src/lib/services/queue.service.ts:204` — a new `QueueName` breaks it until the entry is added; new `$t(...)` keys must exist in `i18n/en.json`.
- `pnpm sync:sql` git-clean gate: the new `@GenerateSql` repo methods regenerate `server/src/queries/asset-job.repository.sql` — must regen + commit.
- OpenAPI/SDK regen: `QueueName`/`JobName` enums are exposed in the spec — `pnpm -C server build && pnpm sync:open-api && make open-api`, commit the generated SDK/spec.
- `system-config.service.spec.ts` asserts the full default concurrency map — add `ImageQuality` there too.

---

## File Structure

**New files:**

- `server/src/services/image-quality.service.ts` — the service (2 `@OnJob` handlers).
- `server/src/services/image-quality.service.spec.ts` — unit spec (TDD gate, `newTestService`).
- `server/test/medium/specs/services/image-quality.service.spec.ts` — medium spec (real DB write).

**Modified — server:**

- `server/src/enum.ts` — `QueueName.ImageQuality`; `JobName.ImageQualityQueueAll` + `JobName.ImageQuality`.
- `server/src/repositories/machine-learning.repository.ts` — `ModelTask.IMAGE_QUALITY`; `ImageQuality`/`ImageQualityResponse`/`ImageQualityRequest` types; add to `MachineLearningRequest` union; `analyzeAssetQuality()`.
- `server/src/repositories/asset-job.repository.ts` — `streamForImageQualityJob(force?)` + `getForImageQuality(id)`.
- `server/src/repositories/asset.repository.ts` — `upsertAssetQuality(...)`.
- `server/src/utils/misc.ts` — `isImageQualityEnabled()` helper.
- `server/src/config.ts` — `[QueueName.ImageQuality]: { concurrency: 1 }` in the job concurrency map.
- `server/src/services/queue.service.ts` — `case QueueName.ImageQuality` in the start switch.
- `server/src/dtos/queue-legacy.dto.ts` — `[QueueName.ImageQuality]: QueueResponseLegacySchema` in `QueuesResponseLegacySchema`.
- `server/src/services/index.ts` — register `ImageQualityService`.
- `server/src/services/system-config.service.spec.ts` — add `[QueueName.ImageQuality]: { concurrency: 1 }` to the expected default concurrency map.

**Modified — web:**

- `web/src/lib/constants.ts` — `QueueName.ImageQuality` in `ADMIN_VISIBLE_QUEUES`.
- `web/src/lib/services/queue.service.ts` — `[QueueName.ImageQuality]` entry in the `Record<QueueName, QueueItem>` map (+ an `@mdi/js` icon import).
- `i18n/en.json` — `admin.machine_learning_image_quality` + `admin.image_quality_job_description`.

**Generated (regen, do not hand-edit):** `server/src/queries/asset-job.repository.sql`, `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/**`, `mobile/openapi/**`.

---

## Task 1: ML plumbing + repo methods + service (TDD via unit spec)

This is the cohesive unit the unit spec drives. Write the failing unit spec first, then implement the enums, ML method, repo methods, and service to green it.

**Files:**

- Create: `server/src/services/image-quality.service.spec.ts`
- Modify: `server/src/enum.ts`, `server/src/repositories/machine-learning.repository.ts`, `server/src/repositories/asset-job.repository.ts`, `server/src/repositories/asset.repository.ts`, `server/src/utils/misc.ts`
- Create: `server/src/services/image-quality.service.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Write the failing unit spec**

Create `server/src/services/image-quality.service.spec.ts` (mirrors `ocr.service.spec.ts`):

```ts
import { AssetVisibility, ImmichWorker, JobName, JobStatus } from 'src/enum';
import { ImageQualityService } from 'src/services/image-quality.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { systemConfigStub } from 'test/fixtures/system-config.stub';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

describe(ImageQualityService.name, () => {
  let sut: ImageQualityService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(ImageQualityService));

    mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
    mocks.assetJob.getForImageQuality.mockResolvedValue({
      visibility: AssetVisibility.Timeline,
      previewFile: '/uploads/user-id/thumbs/path.jpg',
    });
    mocks.machineLearning.analyzeAssetQuality.mockResolvedValue({
      sharpness: 82,
      exposure: 91,
      brightness: 47,
      quality: 78,
    });
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('handleQueueImageQuality', () => {
    it('should do nothing if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);

      await sut.handleQueueImageQuality({ force: false });

      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should queue unscored assets', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForImageQualityJob.mockReturnValue(makeStream([asset]));

      await sut.handleQueueImageQuality({ force: false });

      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.ImageQuality, data: { id: asset.id } }]);
      expect(mocks.assetJob.streamForImageQualityJob).toHaveBeenCalledWith(false);
    });

    it('should queue all assets when forced', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForImageQualityJob.mockReturnValue(makeStream([asset]));

      await sut.handleQueueImageQuality({ force: true });

      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.ImageQuality, data: { id: asset.id } }]);
      expect(mocks.assetJob.streamForImageQualityJob).toHaveBeenCalledWith(true);
    });

    it('should flush jobs in batches when exceeding pagination size', async () => {
      const assets = Array.from({ length: 1001 }, (_, i) => AssetFactory.create({ id: `asset-${i}` }));
      mocks.assetJob.streamForImageQualityJob.mockReturnValue(makeStream(assets));

      await sut.handleQueueImageQuality({ force: false });

      expect(mocks.job.queueAll).toHaveBeenCalledTimes(2);
      expect(mocks.job.queueAll.mock.calls[0][0]).toHaveLength(1000);
      expect(mocks.job.queueAll.mock.calls[1][0]).toHaveLength(1);
    });
  });

  describe('handleImageQuality', () => {
    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);

      expect(await sut.handleImageQuality({ id: '123' })).toEqual(JobStatus.Skipped);
      expect(mocks.machineLearning.analyzeAssetQuality).not.toHaveBeenCalled();
    });

    it('should fail when the asset is not found', async () => {
      mocks.assetJob.getForImageQuality.mockResolvedValue(void 0);

      expect(await sut.handleImageQuality({ id: 'missing' })).toEqual(JobStatus.Failed);
      expect(mocks.machineLearning.analyzeAssetQuality).not.toHaveBeenCalled();
    });

    it('should fail when the asset has no preview file', async () => {
      mocks.assetJob.getForImageQuality.mockResolvedValue({ visibility: AssetVisibility.Timeline, previewFile: null });

      expect(await sut.handleImageQuality({ id: 'no-preview' })).toEqual(JobStatus.Failed);
      expect(mocks.machineLearning.analyzeAssetQuality).not.toHaveBeenCalled();
    });

    it('should skip hidden assets', async () => {
      mocks.assetJob.getForImageQuality.mockResolvedValue({
        visibility: AssetVisibility.Hidden,
        previewFile: '/uploads/user-id/thumbs/path.jpg',
      });

      expect(await sut.handleImageQuality({ id: 'hidden' })).toEqual(JobStatus.Skipped);
      expect(mocks.machineLearning.analyzeAssetQuality).not.toHaveBeenCalled();
    });

    it('should score the asset and store the result', async () => {
      const asset = AssetFactory.create();

      expect(await sut.handleImageQuality({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.machineLearning.analyzeAssetQuality).toHaveBeenCalledWith('/uploads/user-id/thumbs/path.jpg');
      expect(mocks.asset.upsertAssetQuality).toHaveBeenCalledWith({
        assetId: asset.id,
        sharpness: 82,
        exposure: 91,
        brightness: 47,
        quality: 78,
      });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        qualityScoredAt: expect.any(Date),
      });
    });
  });
});
```

- [ ] **Step 2: Run to verify red**

Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run image-quality.service.spec`
Expected: RED — the import `ImageQualityService` fails to resolve (module not found) / `mocks.assetJob.getForImageQuality` etc. don't exist. (Under vitest+swc this surfaces as a module-resolution/type error; that's the expected red — the implementation doesn't exist yet.)

- [ ] **Step 3: Add the enum members**

In `server/src/enum.ts`:

- In `QueueName`, after `Ocr = 'ocr',` add: `ImageQuality = 'imageQuality',`
- In `JobName`, after the OCR block (`Ocr = 'Ocr',`) add:

```ts
  // Image Quality
  ImageQualityQueueAll = 'ImageQualityQueueAll',
  ImageQuality = 'ImageQuality',
```

- [ ] **Step 4: Add the ML task, types, and `analyzeAssetQuality`**

In `server/src/repositories/machine-learning.repository.ts`:

- Add to the `ModelTask` enum: `IMAGE_QUALITY = 'image-quality',` (server `ModelType.VISUAL = 'visual'` already exists).
- Add types near the other response types (after `OcrResponse`):

```ts
export type ImageQuality = { sharpness: number; exposure: number; brightness: number; quality: number };
export type ImageQualityResponse = { [ModelTask.IMAGE_QUALITY]: ImageQuality } & VisualResponse;
export type ImageQualityRequest = { [ModelTask.IMAGE_QUALITY]: { [ModelType.VISUAL]: ModelOptions } };
```

- Add `| ImageQualityRequest` to the `MachineLearningRequest` union.
- Add the method (mirror `ocr()`); the heuristic predictor dispatches by task and ignores `modelName`, so pass a fixed identifier:

```ts
  async analyzeAssetQuality(imagePath: string): Promise<ImageQuality> {
    const request: ImageQualityRequest = {
      [ModelTask.IMAGE_QUALITY]: { [ModelType.VISUAL]: { modelName: 'image-quality' } },
    };
    const response = await this.predict<ImageQualityResponse>({ imagePath }, request);
    return response[ModelTask.IMAGE_QUALITY];
  }
```

- [ ] **Step 5: Add the eligible-asset repo methods**

In `server/src/repositories/asset-job.repository.ts`, mirror `streamForOcrJob` / `getForOcr` (use `withFilePath`, `AssetFileType.Preview`, `DummyValue.UUID`, `AssetVisibility` — already imported there):

```ts
  @GenerateSql({ params: [], stream: true })
  streamForImageQualityJob(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb
          .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
          .where('asset_job_status.qualityScoredAt', 'is', null),
      )
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', AssetVisibility.Hidden)
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForImageQuality(id: string) {
    return this.db
      .selectFrom('asset')
      .select((eb) => ['asset.visibility', withFilePath(eb, AssetFileType.Preview).as('previewFile')])
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }
```

- [ ] **Step 6: Add `upsertAssetQuality`**

In `server/src/repositories/asset.repository.ts`, add (mirror `upsertFile`'s try/`isStaleAssetForeignKeyConstraint` pattern; `AssetQualityTable` is imported via the schema):

```ts
  async upsertAssetQuality(
    quality: Pick<Insertable<AssetQualityTable>, 'assetId' | 'sharpness' | 'exposure' | 'brightness' | 'quality'>,
  ): Promise<void> {
    try {
      await this.db
        .insertInto('asset_quality')
        .values(quality)
        .onConflict((oc) =>
          oc.column('assetId').doUpdateSet((eb) => ({
            sharpness: eb.ref('excluded.sharpness'),
            exposure: eb.ref('excluded.exposure'),
            brightness: eb.ref('excluded.brightness'),
            quality: eb.ref('excluded.quality'),
          })),
        )
        .execute();
    } catch (error) {
      if (isStaleAssetForeignKeyConstraint(error)) {
        return;
      }
      throw error;
    }
  }
```

Add the import `import { AssetQualityTable } from 'src/schema/tables/asset-quality.table';` (alongside the other table-type imports in that file; `Insertable` and `isStaleAssetForeignKeyConstraint` are already imported/used).

- [ ] **Step 7: Add the enable helper**

In `server/src/utils/misc.ts`, after `isOcrEnabled`:

```ts
export const isImageQualityEnabled = (machineLearning: SystemConfig['machineLearning']) =>
  isMachineLearningEnabled(machineLearning);
```

- [ ] **Step 8: Write the service**

Create `server/src/services/image-quality.service.ts` (mirror `ocr.service.ts`'s structure: `@OnJob`, `getConfig`, `JOBS_ASSET_PAGINATION_SIZE`, `JobItem[]` batching):

```ts
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { JobItem, JobOf } from 'src/types';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { AssetVisibility } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { isImageQualityEnabled } from 'src/utils/misc';

export class ImageQualityService extends BaseService {
  @OnJob({ name: JobName.ImageQualityQueueAll, queue: QueueName.ImageQuality })
  async handleQueueImageQuality({ force }: JobOf<JobName.ImageQualityQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isImageQualityEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForImageQualityJob(force);
    for await (const asset of assets) {
      jobs.push({ name: JobName.ImageQuality, data: { id: asset.id } });
      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }
    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.ImageQuality, queue: QueueName.ImageQuality })
  async handleImageQuality({ id }: JobOf<JobName.ImageQuality>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isImageQualityEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForImageQuality(id);
    if (!asset || !asset.previewFile) {
      return JobStatus.Failed;
    }
    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    const { sharpness, exposure, brightness, quality } = await this.machineLearningRepository.analyzeAssetQuality(
      asset.previewFile,
    );
    await this.assetRepository.upsertAssetQuality({ assetId: id, sharpness, exposure, brightness, quality });
    await this.assetRepository.upsertJobStatus({ assetId: id, qualityScoredAt: new Date() });

    return JobStatus.Success;
  }
}
```

(Confirm the exact imports/identifiers against `ocr.service.ts` — `OnJob` source, `getConfig`, repo accessor names `assetJobRepository`/`jobRepository`/`assetRepository`/`machineLearningRepository` on `BaseService`. Fix imports to match; `make check-server` is the gate.)

- [ ] **Step 9: Register the service**

In `server/src/services/index.ts`: add the import and add `ImageQualityService` to the `services` array (alongside `OcrService`).

- [ ] **Step 10: Run the unit spec to green**

Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run image-quality.service.spec`
Expected: PASS (all tests). If `mocks.asset.upsertAssetQuality` / `mocks.assetJob.getForImageQuality` aren't on the auto-mock, it means the repo method wasn't added to the class — fix Step 5/6.

- [ ] **Step 11: Commit**

```bash
cd /Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm
git add server/src/services/image-quality.service.ts server/src/services/image-quality.service.spec.ts \
        server/src/services/index.ts server/src/enum.ts \
        server/src/repositories/machine-learning.repository.ts \
        server/src/repositories/asset-job.repository.ts \
        server/src/repositories/asset.repository.ts server/src/utils/misc.ts
git commit -m "feat(server): ImageQualityService + analyzeAssetQuality ML method + queue (roadmap A3)"
```

---

## Task 2: Queue registration (tsc + spec exhaustiveness)

Adding `QueueName.ImageQuality` breaks several exhaustive maps. `ImageQuality` is a `ConcurrentQueueName` (only StorageTemplateMigration/FacialRecognition/DuplicateDetection/BackupDatabase/StorageBackendMigration are excluded), so it MUST appear in the concurrency `Record<ConcurrentQueueName>`.

**Files:** `server/src/config.ts`, `server/src/services/queue.service.ts`, `server/src/dtos/queue-legacy.dto.ts`, `server/src/services/system-config.service.spec.ts`

- [ ] **Step 1: Concurrency default** — In `server/src/config.ts`'s job concurrency map (the `Record<ConcurrentQueueName, { concurrency: number }>` literal), add next to the `[QueueName.Ocr]` entry: `[QueueName.ImageQuality]: { concurrency: 1 },`
- [ ] **Step 2: Queue start switch** — In `server/src/services/queue.service.ts`, after the `case QueueName.Ocr` block, add:

```ts
      case QueueName.ImageQuality: {
        return this.jobRepository.queue({ name: JobName.ImageQualityQueueAll, data: { force } });
      }
```

- [ ] **Step 3: Legacy queue DTO** — In `server/src/dtos/queue-legacy.dto.ts`, in `QueuesResponseLegacySchema`, add next to `[QueueName.Ocr]`: `[QueueName.ImageQuality]: QueueResponseLegacySchema,`
- [ ] **Step 4: System-config spec** — In `server/src/services/system-config.service.spec.ts`, in the expected default concurrency map, add `[QueueName.ImageQuality]: { concurrency: 1 },` next to the `[QueueName.Ocr]` entry (search the file for `QueueName.Ocr`; if OCR isn't asserted there, place it to keep the map matching `config.ts`).
- [ ] **Step 5: Type-check** — Run `/opt/homebrew/bin/mise exec -- make check-server`. Expected: clean. Fix any remaining exhaustive `Record<QueueName|ConcurrentQueueName>` / switch the compiler flags.
- [ ] **Step 6: Run the relevant unit specs** — `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run system-config queue.service` → green.
- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/services/queue.service.ts server/src/dtos/queue-legacy.dto.ts server/src/services/system-config.service.spec.ts
git commit -m "feat(server): register ImageQuality queue (concurrency, start switch, legacy dto) (roadmap A3)"
```

---

## Task 3: Web admin queue entry (check-web exhaustiveness + i18n)

The web `items: Record<QueueName, QueueItem>` (`web/src/lib/services/queue.service.ts:204`) is exhaustive once the SDK adds `QueueName.ImageQuality` (Task 5 regen). Add the entry + i18n keys now so `make check-web` passes after regen.

**Files:** `web/src/lib/services/queue.service.ts`, `web/src/lib/constants.ts`, `i18n/en.json`

- [ ] **Step 1: Queue item** — In `web/src/lib/services/queue.service.ts`, add after the `[QueueName.Ocr]` entry (and add an icon import from `@mdi/js`, e.g. `mdiImageCheckOutline`, alongside the existing `mdi*` imports):

```ts
    [QueueName.ImageQuality]: {
      icon: mdiImageCheckOutline,
      title: $t('admin.machine_learning_image_quality'),
      subtitle: $t('admin.image_quality_job_description'),
    },
```

- [ ] **Step 2: Admin visibility** — In `web/src/lib/constants.ts`, add `QueueName.ImageQuality,` to `ADMIN_VISIBLE_QUEUES` (next to `QueueName.Ocr`).
- [ ] **Step 3: i18n** — In `i18n/en.json`, in the `admin` section near `machine_learning_ocr`, add (keep keys alphabetical if the file is sorted; the i18n lint may require sorting):

```json
    "image_quality_job_description": "Score images for sharpness, exposure, and brightness",
    "machine_learning_image_quality": "Image Quality",
```

- [ ] **Step 4: Commit** (web check runs in Task 5 after SDK regen, since `QueueName.ImageQuality` must exist in the SDK first):

```bash
git add web/src/lib/services/queue.service.ts web/src/lib/constants.ts i18n/en.json
git commit -m "feat(web): Image Quality admin queue card + i18n (roadmap A3)"
```

---

## Task 4: Medium test (real-DB write path)

**Files:** Create `server/test/medium/specs/services/image-quality.service.spec.ts`

- [ ] **Step 1: Write the medium test** (mirror `ocr.service` medium spec):

```ts
import { Kysely } from 'kysely';
import { AssetFileType, JobStatus } from 'src/enum';
import { AssetJobRepository } from 'src/repositories/asset-job.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { ImageQualityService } from 'src/services/image-quality.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(ImageQualityService, {
    database: db || defaultDatabase,
    real: [AssetRepository, AssetJobRepository, ConfigRepository, SystemMetadataRepository],
    mock: [JobRepository, LoggingRepository, MachineLearningRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(ImageQualityService.name, () => {
  it('should score an asset and persist scores + qualityScoredAt', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' });

    const mlMock = ctx.getMock(MachineLearningRepository);
    mlMock.analyzeAssetQuality.mockResolvedValue({ sharpness: 60, exposure: 70, brightness: 55, quality: 62 });

    await expect(sut.handleImageQuality({ id: asset.id })).resolves.toBe(JobStatus.Success);

    await expect(
      ctx.database.selectFrom('asset_quality').selectAll().where('assetId', '=', asset.id).executeTakeFirst(),
    ).resolves.toEqual({ assetId: asset.id, sharpness: 60, exposure: 70, brightness: 55, quality: 62 });

    await expect(
      ctx.database
        .selectFrom('asset_job_status')
        .select('qualityScoredAt')
        .where('assetId', '=', asset.id)
        .executeTakeFirst(),
    ).resolves.toEqual({ qualityScoredAt: expect.any(Date) });
  });

  it('re-scoring updates existing scores (upsert)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' });

    const mlMock = ctx.getMock(MachineLearningRepository);
    mlMock.analyzeAssetQuality.mockResolvedValue({ sharpness: 10, exposure: 10, brightness: 10, quality: 10 });
    await sut.handleImageQuality({ id: asset.id });
    mlMock.analyzeAssetQuality.mockResolvedValue({ sharpness: 90, exposure: 80, brightness: 70, quality: 84 });
    await sut.handleImageQuality({ id: asset.id });

    await expect(
      ctx.database.selectFrom('asset_quality').selectAll().where('assetId', '=', asset.id).executeTakeFirst(),
    ).resolves.toEqual({ assetId: asset.id, sharpness: 90, exposure: 80, brightness: 70, quality: 84 });
  });
});
```

- [ ] **Step 2: Run** — `/opt/homebrew/bin/mise exec -- pnpm -C server test:medium -- --run image-quality.service.spec` → PASS. (`getForImageQuality` needs the preview asset_file row, which `ctx.newAssetFile` provides.)
- [ ] **Step 3: Commit**

```bash
git add server/test/medium/specs/services/image-quality.service.spec.ts
git commit -m "test(server): ImageQualityService medium spec (roadmap A3)"
```

---

## Task 5: Regen (SQL + OpenAPI/SDK) + full verification + push

- [ ] **Step 1: Regenerate query SQL docs** (new `@GenerateSql` methods):

```bash
cd /Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm/server
/opt/homebrew/bin/mise exec -- pnpm build
/opt/homebrew/bin/mise exec -- pnpm sync:sql
git status --porcelain server/src/queries   # expect asset-job.repository.sql changed
```

- [ ] **Step 2: Regenerate OpenAPI + SDK** (QueueName/JobName enums are exposed):

```bash
cd /Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm
/opt/homebrew/bin/mise exec -- pnpm -C server build
/opt/homebrew/bin/mise exec -- pnpm sync:open-api
/opt/homebrew/bin/mise exec -- make open-api
git status --porcelain open-api mobile/openapi   # expect spec + TS SDK + dart client changed
```

(Dart generation needs Java — see `feedback_openapi_dart_generation`. If Java/codegen is unavailable locally, regenerate the TypeScript SDK only with `make open-api-typescript` and note that the Dart client must be regenerated in CI/by a follow-up; the web build only needs the TS SDK.)

- [ ] **Step 3: Build the SDK so web type-checks see `QueueName.ImageQuality`**:

```bash
/opt/homebrew/bin/mise exec -- make build-sdk
```

- [ ] **Step 4: Full gates**

```bash
/opt/homebrew/bin/mise exec -- make check-server          # tsc
/opt/homebrew/bin/mise exec -- make lint-server           # eslint --max-warnings 0
/opt/homebrew/bin/mise exec -- make check-web             # svelte-check + tsc (the Record<QueueName> + i18n keys)
/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run             # full unit suite
/opt/homebrew/bin/mise exec -- pnpm -C server test:medium -- --run      # full medium suite (exiftool exif specs fail locally — pre-existing/env, ignore)
```

Expected: all green except the known local exiftool `exif/*` medium failures (no exiftool binary locally — they pass in CI).

- [ ] **Step 5: Commit the generated artifacts**

```bash
git add server/src/queries open-api mobile/openapi
git commit -m "chore(api): regen SQL + OpenAPI/SDK for ImageQuality queue (roadmap A3)"
```

- [ ] **Step 6: Push**

```bash
git push
```

---

## Self-Review (against spec A3)

- **`machineLearningRepository.analyzeAssetQuality` (mirror `ocr()`)** → Task 1 Step 4. ✅
- **`ImageQualityService` `@OnJob` per-asset (fetch → ML → store → `upsertJobStatus({qualityScoredAt})`) + queue-all** → Task 1 Step 8. ✅
- **`JobName`/`QueueName` enums** → Task 1 Step 3. ✅
- **`streamForImageQualityJob`/`getForImageQuality` (eligible = has preview + `qualityScoredAt IS NULL`)** → Task 1 Step 5. ✅
- **Wire the trigger (OQ-A4)** → queue-all-only, mirroring OCR/PetDetection (no per-asset auto-chain); admin-triggerable via the new queue (Task 2/3). Backfill = run the queue-all. ✅
- **TDD: per-asset job calls ML, stores scores, sets `qualityScoredAt`, returns Success; queue-all streams eligible; re-run skips already-scored (unless force); ML error → job failure (no partial write)** → unit spec (Task 1 Step 1) covers disabled/missing/no-preview/hidden/success + queue-all force/non-force/batch; medium spec (Task 4) covers real-DB persist + re-score upsert. "re-run skips already-scored" = `streamForImageQualityJob(false)` filters `qualityScoredAt IS NULL` (asserted via `streamForImageQualityJob` called with `false`); `force` streams all. "ML error → no partial write" = ML throws before `upsertAssetQuality`/`upsertJobStatus` (handler awaits ML first; BullMQ marks the job failed). ✅
- **Edge cases: asset without preview skipped; ML down → retry/fail; video asset skipped (images only)** → no-preview → Failed; ML throw → job Failed (retry by BullMQ); video assets have no preview file → Failed/skipped (image-only via preview-file requirement). ✅
- **CI discipline: lint/tsc/check-web + OpenAPI/SDK + sync:sql** → Task 5. ✅

**Out of scope (later slices):** agent read exposure `readAssetMetadata`/`listDuplicateGroups` + MCP contract (A4); keep-rule (A5); `visual_cleanup` workflow (A6); matrix + L3 (A7). No L1/L3 here — A3 adds no agent routing/workflow surface (the queue is admin/infra, not an agent tool).
