# Auto-Classification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-tag and optionally auto-archive assets based on CLIP similarity to user-defined text prompts.

**Architecture:** Two new DB tables (`classification_category`, `classification_prompt_embedding`), a new `ClassificationService` extending `BaseService`, a `ClassificationRepository` for queries, a `ClassificationController` for CRUD API, and a new Settings UI section. Classification jobs chain after SmartSearch via `job.service.ts` `onDone`.

**Tech Stack:** NestJS, Kysely, PostgreSQL (pgvector), BullMQ, SvelteKit, @immich/ui

**Design doc:** `docs/plans/2026-03-26-auto-classification-design.md`

---

### Task 1: Schema — Table Definitions

**Files:**

- Create: `server/src/schema/tables/classification-category.table.ts`
- Create: `server/src/schema/tables/classification-prompt-embedding.table.ts`
- Modify: `server/src/schema/tables/asset-job-status.table.ts:22` (add `classifiedAt`)
- Modify: `server/src/schema/index.ts:92-162` (register tables in `ImmichDatabase.tables`)
- Modify: `server/src/schema/index.ts:194-294` (add to `DB` interface)

**Step 1: Create `classification-category.table.ts`**

```typescript
import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
  UpdatedAtTrigger,
  UpdateIdColumn,
  Unique,
} from '@immich/sql-tools';
import { Generated } from 'kysely';
import { TagTable } from 'src/schema/tables/tag.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('classification_category')
@UpdatedAtTrigger('classification_category_updatedAt')
@Unique({ columns: ['userId', 'name'] })
export class ClassificationCategoryTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE', index: false })
  userId!: string;

  @Column()
  name!: string;

  @Column({ type: 'real', default: 0.28 })
  similarity!: Generated<number>;

  @Column({ type: 'character varying', default: "'tag'" })
  action!: Generated<string>;

  @Column({ type: 'boolean', default: true })
  enabled!: Generated<boolean>;

  @ForeignKeyColumn(() => TagTable, { nullable: true, onDelete: 'SET NULL' })
  tagId!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

**Step 2: Create `classification-prompt-embedding.table.ts`**

```typescript
import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { Generated } from 'kysely';
import { ClassificationCategoryTable } from 'src/schema/tables/classification-category.table';

@Table('classification_prompt_embedding')
export class ClassificationPromptEmbeddingTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => ClassificationCategoryTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  categoryId!: string;

  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'vector', length: 512, storage: 'external', synchronize: false })
  embedding!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}
```

**Step 3: Add `classifiedAt` to `asset-job-status.table.ts`**

After line 22 (`petsDetectedAt`), add:

```typescript
  @Column({ type: 'timestamp with time zone', nullable: true })
  classifiedAt!: Timestamp | null;
```

**Step 4: Register tables in `server/src/schema/index.ts`**

Import the two new table classes at the top of the file. Add them to both:

- The `tables` array (around line 92-162)
- The `DB` interface (around line 194-294):

```typescript
classification_category: ClassificationCategoryTable;
classification_prompt_embedding: ClassificationPromptEmbeddingTable;
```

**Step 5: Commit**

```
feat(server): add classification schema tables
```

---

### Task 2: Database Migration

**Files:**

- Create: `server/src/schema/migrations-gallery/1776000000000-AddClassificationTables.ts`

**Step 1: Create the migration file**

```typescript
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // classification_category table
  await sql`
    CREATE TABLE "classification_category" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "userId" uuid NOT NULL REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE,
      "name" character varying NOT NULL,
      "similarity" real NOT NULL DEFAULT 0.28,
      "action" character varying NOT NULL DEFAULT 'tag',
      "enabled" boolean NOT NULL DEFAULT true,
      "tagId" uuid REFERENCES "tag"("id") ON DELETE SET NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "UQ_classification_category_userId_name" UNIQUE ("userId", "name")
    )
  `.execute(db);

  await sql`
    CREATE INDEX "IDX_classification_category_updateId" ON "classification_category" ("updateId")
  `.execute(db);

  await sql`
    CREATE TRIGGER "classification_category_updatedAt"
    BEFORE UPDATE ON "classification_category"
    FOR EACH ROW EXECUTE FUNCTION updated_at('updatedAt')
  `.execute(db);

  // classification_prompt_embedding table
  await sql`
    CREATE TABLE "classification_prompt_embedding" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "categoryId" uuid NOT NULL REFERENCES "classification_category"("id") ON UPDATE CASCADE ON DELETE CASCADE,
      "prompt" text NOT NULL,
      "embedding" vector(512) NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
    )
  `.execute(db);

  // classifiedAt column on asset_job_status
  await sql`
    ALTER TABLE "asset_job_status" ADD "classifiedAt" timestamp with time zone
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_job_status" DROP COLUMN "classifiedAt"`.execute(db);
  await sql`DROP TABLE IF EXISTS "classification_prompt_embedding"`.execute(db);
  await sql`DROP TABLE IF EXISTS "classification_category"`.execute(db);
}
```

**Step 2: Verify migration compiles**

Run: `cd server && npx tsc --noEmit`

**Step 3: Commit**

```
feat(server): add classification database migration
```

---

### Task 3: Enums — Queue and Job Names

**Files:**

- Modify: `server/src/enum.ts:596-617` (add `QueueName.Classification`)
- Modify: `server/src/enum.ts:628-723` (add `JobName.AssetClassifyQueueAll` and `JobName.AssetClassify`)

**Step 1: Add queue name**

In the `QueueName` enum (after line 616, `StorageBackendMigration`), add:

```typescript
  Classification = 'classification',
```

**Step 2: Add job names**

In the `JobName` enum (after line 722, `SharedSpaceBulkAddAssets`), add:

```typescript
  // Classification
  AssetClassifyQueueAll = 'AssetClassifyQueueAll',
  AssetClassify = 'AssetClassify',
```

**Step 3: Commit**

```
feat(server): add classification queue and job name enums
```

---

### Task 4: DTOs

**Files:**

- Create: `server/src/dtos/classification.dto.ts`

**Step 1: Create the DTO file**

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Optional, ValidateUUID } from 'src/validation';

export class ClassificationCategoryCreateDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Category name' })
  name!: string;

  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ApiProperty({ description: 'Text prompts for CLIP matching', type: [String] })
  prompts!: string[];

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  @ApiPropertyOptional({ description: 'Similarity threshold (0-1, higher = stricter)', default: 0.28 })
  similarity?: number;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Action on match', default: 'tag', enum: ['tag', 'tag_and_archive'] })
  action?: string;
}

export class ClassificationCategoryUpdateDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Category name' })
  name?: string;

  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @IsOptional()
  @ApiPropertyOptional({ description: 'Text prompts for CLIP matching', type: [String] })
  prompts?: string[];

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  @ApiPropertyOptional({ description: 'Similarity threshold (0-1, higher = stricter)' })
  similarity?: number;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Action on match', enum: ['tag', 'tag_and_archive'] })
  action?: string;

  @IsOptional()
  @ApiPropertyOptional({ description: 'Enable or disable category' })
  enabled?: boolean;
}

export class ClassificationCategoryResponseDto {
  id!: string;
  name!: string;
  prompts!: string[];
  similarity!: number;
  action!: string;
  enabled!: boolean;
  tagId!: string | null;
  createdAt!: string;
  updatedAt!: string;
}
```

**Step 2: Commit**

```
feat(server): add classification DTOs
```

---

### Task 5: Repository

**Files:**

- Create: `server/src/repositories/classification.repository.ts`

**Step 1: Create the repository**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectKysely } from '@immich/sql-tools';
import { Insertable, Kysely, Updateable } from 'kysely';
import { DB } from 'src/schema';
import { ClassificationCategoryTable } from 'src/schema/tables/classification-category.table';
import { ClassificationPromptEmbeddingTable } from 'src/schema/tables/classification-prompt-embedding.table';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { GenerateSql } from 'src/sql-tools/generate-sql';
import { DummyValue } from 'src/sql-tools/dummy-value';

@Injectable()
export class ClassificationRepository {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(ClassificationRepository.name);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getCategories(userId: string) {
    return this.db
      .selectFrom('classification_category')
      .selectAll()
      .where('userId', '=', userId)
      .orderBy('name', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getCategory(id: string) {
    return this.db.selectFrom('classification_category').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async createCategory(values: Insertable<ClassificationCategoryTable>) {
    return this.db.insertInto('classification_category').values(values).returningAll().executeTakeFirstOrThrow();
  }

  async updateCategory(id: string, values: Updateable<ClassificationCategoryTable>) {
    return this.db
      .updateTable('classification_category')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deleteCategory(id: string) {
    await this.db.deleteFrom('classification_category').where('id', '=', id).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getPromptEmbeddings(categoryId: string) {
    return this.db
      .selectFrom('classification_prompt_embedding')
      .selectAll()
      .where('categoryId', '=', categoryId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getEnabledCategoriesWithEmbeddings(userId: string) {
    return this.db
      .selectFrom('classification_category as c')
      .innerJoin('classification_prompt_embedding as p', 'p.categoryId', 'c.id')
      .select([
        'c.id as categoryId',
        'c.name',
        'c.similarity',
        'c.action',
        'c.tagId',
        'p.id as promptId',
        'p.prompt',
        'p.embedding',
      ])
      .where('c.userId', '=', userId)
      .where('c.enabled', '=', true)
      .execute();
  }

  async upsertPromptEmbedding(values: Insertable<ClassificationPromptEmbeddingTable>) {
    return this.db
      .insertInto('classification_prompt_embedding')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deletePromptEmbeddingsByCategory(categoryId: string) {
    await this.db.deleteFrom('classification_prompt_embedding').where('categoryId', '=', categoryId).execute();
  }

  async resetClassifiedAt(userId: string) {
    await this.db
      .updateTable('asset_job_status')
      .set({ classifiedAt: null })
      .where('assetId', 'in', this.db.selectFrom('asset').select('id').where('ownerId', '=', userId))
      .execute();
  }

  async setClassifiedAt(assetId: string) {
    await this.db
      .updateTable('asset_job_status')
      .set({ classifiedAt: new Date().toISOString() })
      .where('assetId', '=', assetId)
      .execute();
  }

  streamUnclassifiedAssets(userId?: string) {
    let query = this.db
      .selectFrom('asset_job_status as ajs')
      .innerJoin('asset as a', 'a.id', 'ajs.assetId')
      .innerJoin('smart_search as ss', 'ss.assetId', 'a.id')
      .select(['a.id', 'a.ownerId'])
      .where('ajs.classifiedAt', 'is', null);

    if (userId) {
      query = query.where('a.ownerId', '=', userId);
    }

    return query.stream();
  }
}
```

**Step 2: Commit**

```
feat(server): add classification repository
```

---

### Task 6: Register Repository in BaseService

**Files:**

- Modify: `server/src/services/base.service.ts` (add import, add to `BASE_SERVICE_DEPENDENCIES` array, add to constructor)
- Modify: `server/test/utils.ts` (add to test mock setup)

**Step 1: Add to BaseService**

Add import at top:

```typescript
import { ClassificationRepository } from 'src/repositories/classification.repository';
```

Add `ClassificationRepository` to the `BASE_SERVICE_DEPENDENCIES` array (alphabetically after `ConfigRepository`).

Add to the constructor (alphabetically):

```typescript
    protected classificationRepository: ClassificationRepository,
```

**Step 2: Add to test utils**

Add the same import and mock entry in `server/test/utils.ts` following the existing pattern for other repositories.

**Step 3: Commit**

```
feat(server): register classification repository in BaseService
```

---

### Task 7: Classification Service

**Files:**

- Create: `server/src/services/classification.service.ts`

**Step 1: Create the service**

```typescript
import { Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  ClassificationCategoryCreateDto,
  ClassificationCategoryResponseDto,
  ClassificationCategoryUpdateDto,
} from 'src/dtos/classification.dto';
import { AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { upsertTags } from 'src/utils/tag';

@Injectable()
export class ClassificationService extends BaseService {
  // --- CRUD ---

  async getCategories(auth: AuthDto): Promise<ClassificationCategoryResponseDto[]> {
    const categories = await this.classificationRepository.getCategories(auth.user.id);
    const result: ClassificationCategoryResponseDto[] = [];

    for (const category of categories) {
      const prompts = await this.classificationRepository.getPromptEmbeddings(category.id);
      result.push({
        id: category.id,
        name: category.name,
        prompts: prompts.map((p) => p.prompt),
        similarity: category.similarity,
        action: category.action,
        enabled: category.enabled,
        tagId: category.tagId,
        createdAt: String(category.createdAt),
        updatedAt: String(category.updatedAt),
      });
    }

    return result;
  }

  async createCategory(
    auth: AuthDto,
    dto: ClassificationCategoryCreateDto,
  ): Promise<ClassificationCategoryResponseDto> {
    const { machineLearning } = await this.getConfig({ withCache: true });

    const category = await this.classificationRepository.createCategory({
      userId: auth.user.id,
      name: dto.name,
      similarity: dto.similarity,
      action: dto.action,
    });

    // Encode and store prompt embeddings
    for (const prompt of dto.prompts) {
      const embedding = await this.machineLearningRepository.encodeText(prompt, {
        modelName: machineLearning.clip.modelName,
      });
      await this.classificationRepository.upsertPromptEmbedding({
        categoryId: category.id,
        prompt,
        embedding,
      });
    }

    return {
      id: category.id,
      name: category.name,
      prompts: dto.prompts,
      similarity: category.similarity,
      action: category.action,
      enabled: category.enabled,
      tagId: category.tagId,
      createdAt: String(category.createdAt),
      updatedAt: String(category.updatedAt),
    };
  }

  async updateCategory(
    auth: AuthDto,
    id: string,
    dto: ClassificationCategoryUpdateDto,
  ): Promise<ClassificationCategoryResponseDto> {
    const existing = await this.classificationRepository.getCategory(id);
    if (!existing || existing.userId !== auth.user.id) {
      throw new Error('Category not found');
    }

    const updateValues: Record<string, unknown> = {};
    if (dto.name !== void 0) {
      // If name changed, delete old tag and clear tagId
      if (dto.name !== existing.name && existing.tagId) {
        await this.tagRepository.delete(existing.tagId);
        updateValues.tagId = null;
      }
      updateValues.name = dto.name;
    }
    if (dto.similarity !== void 0) {
      updateValues.similarity = dto.similarity;
    }
    if (dto.action !== void 0) {
      updateValues.action = dto.action;
    }
    if (dto.enabled !== void 0) {
      updateValues.enabled = dto.enabled;
    }

    const category = await this.classificationRepository.updateCategory(id, updateValues);

    // Re-encode prompts if changed
    if (dto.prompts !== void 0) {
      const { machineLearning } = await this.getConfig({ withCache: true });
      await this.classificationRepository.deletePromptEmbeddingsByCategory(id);
      for (const prompt of dto.prompts) {
        const embedding = await this.machineLearningRepository.encodeText(prompt, {
          modelName: machineLearning.clip.modelName,
        });
        await this.classificationRepository.upsertPromptEmbedding({
          categoryId: id,
          prompt,
          embedding,
        });
      }
    }

    const prompts = await this.classificationRepository.getPromptEmbeddings(id);
    return {
      id: category.id,
      name: category.name,
      prompts: prompts.map((p) => p.prompt),
      similarity: category.similarity,
      action: category.action,
      enabled: category.enabled,
      tagId: category.tagId,
      createdAt: String(category.createdAt),
      updatedAt: String(category.updatedAt),
    };
  }

  async deleteCategory(auth: AuthDto, id: string): Promise<void> {
    const category = await this.classificationRepository.getCategory(id);
    if (!category || category.userId !== auth.user.id) {
      throw new Error('Category not found');
    }

    // Delete associated tag
    if (category.tagId) {
      await this.tagRepository.delete(category.tagId);
    }

    await this.classificationRepository.deleteCategory(id);
  }

  async scanLibrary(auth: AuthDto): Promise<void> {
    await this.classificationRepository.resetClassifiedAt(auth.user.id);
    await this.jobRepository.queue({
      name: JobName.AssetClassifyQueueAll,
      data: { userId: auth.user.id },
    });
  }

  // --- Jobs ---

  @OnJob({ name: JobName.AssetClassifyQueueAll, queue: QueueName.Classification })
  async handleClassifyQueueAll(data: { userId?: string }): Promise<JobStatus> {
    const stream = this.classificationRepository.streamUnclassifiedAssets(data.userId);

    let queue: Array<{ name: JobName; data: { id: string } }> = [];
    for await (const asset of stream) {
      queue.push({ name: JobName.AssetClassify, data: { id: asset.id } });
      if (queue.length >= 1000) {
        await this.jobRepository.queueAll(queue);
        queue = [];
      }
    }

    await this.jobRepository.queueAll(queue);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetClassify, queue: QueueName.Classification })
  async handleClassify({ id }: { id: string }): Promise<JobStatus> {
    // Load asset with its embedding
    const asset = await this.assetRepository.getById(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    const embedding = await this.searchRepository.getEmbedding(id);
    if (!embedding) {
      return JobStatus.Skipped;
    }

    // Load owner's categories with prompt embeddings
    const rows = await this.classificationRepository.getEnabledCategoriesWithEmbeddings(asset.ownerId);
    if (rows.length === 0) {
      await this.classificationRepository.setClassifiedAt(id);
      return JobStatus.Skipped;
    }

    // Group by category
    const categories = new Map<
      string,
      { name: string; similarity: number; action: string; tagId: string | null; embeddings: string[] }
    >();
    for (const row of rows) {
      if (!categories.has(row.categoryId)) {
        categories.set(row.categoryId, {
          name: row.name,
          similarity: row.similarity,
          action: row.action,
          tagId: row.tagId,
          embeddings: [],
        });
      }
      categories.get(row.categoryId)!.embeddings.push(row.embedding);
    }

    // Classify
    const assetEmbedding = this.parseEmbedding(embedding);
    let shouldArchive = false;

    for (const [categoryId, category] of categories) {
      let bestSimilarity = -1;
      for (const promptEmbedding of category.embeddings) {
        const similarity = this.cosineSimilarity(assetEmbedding, this.parseEmbedding(promptEmbedding));
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
        }
      }

      if (bestSimilarity >= category.similarity) {
        // Ensure Auto/{name} tag exists
        let tagId = category.tagId;
        if (!tagId) {
          const tags = await upsertTags(this.tagRepository, {
            userId: asset.ownerId,
            tags: [`Auto/${category.name}`],
          });
          tagId = tags[0].id;
          await this.classificationRepository.updateCategory(categoryId, { tagId });
        }

        // Apply tag (idempotent)
        await this.tagRepository.upsertAssetIds(tagId, [id]);

        if (category.action === 'tag_and_archive') {
          shouldArchive = true;
        }
      }
    }

    // Archive if any matched category requires it and asset is on timeline
    if (shouldArchive && asset.visibility === AssetVisibility.Timeline) {
      await this.assetRepository.updateAll([id], { visibility: AssetVisibility.Archive });
    }

    await this.classificationRepository.setClassifiedAt(id);
    return JobStatus.Success;
  }

  // --- Helpers ---

  private parseEmbedding(raw: string): number[] {
    // PostgreSQL vector format: "[0.1,0.2,...]"
    return raw.replace(/[[\]]/g, '').split(',').map(Number);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

**Step 2: Commit**

```
feat(server): add classification service with CRUD and job handlers
```

---

### Task 8: Add `getEmbedding` to Search Repository

**Files:**

- Modify: `server/src/repositories/search.repository.ts`

**Step 1: Add a method to retrieve an asset's CLIP embedding**

Add this method to `SearchRepository`:

```typescript
  @GenerateSql({ params: [DummyValue.UUID] })
  getEmbedding(assetId: string) {
    return this.db
      .selectFrom('smart_search')
      .select('embedding')
      .where('assetId', '=', assetId)
      .executeTakeFirst()
      .then((row) => row?.embedding ?? null);
  }
```

**Step 2: Commit**

```
feat(server): add getEmbedding method to search repository
```

---

### Task 9: Add `upsertAssetIds` to Tag Repository (if missing)

**Files:**

- Modify: `server/src/repositories/tag.repository.ts`

**Step 1: Check if `upsertAssetIds` exists with a single-tag signature**

The existing `upsertAssetIds` takes an array of `{ tagId, assetId }`. We need a convenience method
that takes a single tagId and array of assetIds. Check if one exists; if not, the service can build
the items array inline (as `bulkTagAssets` does in `tag.service.ts:79-99`). If building inline, no
change is needed here.

**Step 2: Commit (if changes made)**

```
feat(server): add single-tag upsertAssetIds convenience method
```

---

### Task 10: Chain Classification in Job Service

**Files:**

- Modify: `server/src/services/job.service.ts:217-222`

**Step 1: Add classification chaining after SmartSearch**

In the `onDone` handler, after the `SmartSearch` case (line 217-222), update to also queue `AssetClassify`:

```typescript
      case JobName.SmartSearch: {
        if (item.data.source === 'upload') {
          await this.jobRepository.queue({ name: JobName.AssetDetectDuplicates, data: item.data });
        }
        await this.jobRepository.queue({ name: JobName.AssetClassify, data: { id: item.data.id } });
        break;
      }
```

Note: `AssetClassify` fires on ALL SmartSearch completions (not just uploads), so assets re-encoded
after a CLIP model change also get reclassified.

**Step 2: Commit**

```
feat(server): chain classification job after SmartSearch
```

---

### Task 11: Controller

**Files:**

- Create: `server/src/controllers/classification.controller.ts`

**Step 1: Create the controller**

```typescript
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  ClassificationCategoryCreateDto,
  ClassificationCategoryResponseDto,
  ClassificationCategoryUpdateDto,
} from 'src/dtos/classification.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { ClassificationService } from 'src/services/classification.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.Classification)
@Controller('classification/categories')
export class ClassificationController {
  constructor(private service: ClassificationService) {}

  @Get()
  @Authenticated()
  @Endpoint({
    summary: 'Get classification categories',
    history: new HistoryBuilder().added('v1'),
  })
  getCategories(@Auth() auth: AuthDto): Promise<ClassificationCategoryResponseDto[]> {
    return this.service.getCategories(auth);
  }

  @Post()
  @Authenticated()
  @Endpoint({
    summary: 'Create a classification category',
    history: new HistoryBuilder().added('v1'),
  })
  createCategory(
    @Auth() auth: AuthDto,
    @Body() dto: ClassificationCategoryCreateDto,
  ): Promise<ClassificationCategoryResponseDto> {
    return this.service.createCategory(auth, dto);
  }

  @Put(':id')
  @Authenticated()
  @Endpoint({
    summary: 'Update a classification category',
    history: new HistoryBuilder().added('v1'),
  })
  updateCategory(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: ClassificationCategoryUpdateDto,
  ): Promise<ClassificationCategoryResponseDto> {
    return this.service.updateCategory(auth, id, dto);
  }

  @Delete(':id')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a classification category',
    history: new HistoryBuilder().added('v1'),
  })
  deleteCategory(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.deleteCategory(auth, id);
  }

  @Post('scan')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Scan library for classification',
    history: new HistoryBuilder().added('v1'),
  })
  scanLibrary(@Auth() auth: AuthDto): Promise<void> {
    return this.service.scanLibrary(auth);
  }
}
```

**Step 2: Add `Classification` to `ApiTag` enum in `server/src/enum.ts`**

Find the `ApiTag` enum and add:

```typescript
  Classification = 'Classification',
```

**Step 3: Commit**

```
feat(server): add classification controller
```

---

### Task 12: Unit Tests — Classification Service

**Files:**

- Create: `server/src/services/classification.service.spec.ts`

**Step 1: Write tests for the classification job handler**

Use the `newTestService(ClassificationService)` pattern from `server/test/utils.ts`. Test:

1. `handleClassify` returns `Skipped` when no embedding exists
2. `handleClassify` returns `Skipped` when user has no categories
3. `handleClassify` tags asset when similarity exceeds threshold
4. `handleClassify` does not tag when similarity is below threshold
5. `handleClassify` archives when action is `tag_and_archive` and asset is on timeline
6. `handleClassify` does not archive when asset is already archived
7. `handleClassifyQueueAll` streams and queues jobs

**Step 2: Run tests**

Run: `cd server && pnpm test -- --run src/services/classification.service.spec.ts`

**Step 3: Commit**

```
test(server): add classification service unit tests
```

---

### Task 13: OpenAPI Generation

**Files:**

- Regenerate: OpenAPI spec and TypeScript SDK

**Step 1: Build server and regenerate**

```bash
cd server && pnpm build
cd server && pnpm sync:open-api
make open-api-typescript
```

**Step 2: Commit**

```
chore: regenerate OpenAPI spec for classification endpoints
```

---

### Task 14: Web — Settings UI Component

**Files:**

- Create: `web/src/lib/components/user-settings-page/classification-settings.svelte`
- Modify: `web/src/lib/components/user-settings-page/user-settings-list.svelte`

**Step 1: Create the classification settings component**

```svelte
<script lang="ts">
  import { mdiPlus, mdiDelete, mdiPencil, mdiMagnifyScan } from '@mdi/js';
  import {
    getClassificationCategories,
    createClassificationCategory,
    updateClassificationCategory,
    deleteClassificationCategory,
    scanClassificationLibrary,
  } from '@immich/sdk';
  import type { ClassificationCategoryResponseDto } from '@immich/sdk';
  import { Button, Input, Slider } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { notificationController } from '$lib/components/shared-components/notification/notification';

  let categories = $state<ClassificationCategoryResponseDto[]>([]);
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editPrompts = $state('');
  let editSimilarity = $state(0.28);
  let editAction = $state('tag');
  let isCreating = $state(false);
  let isLoading = $state(true);

  const similarityLabels = [
    { value: 0.2, label: 'Loose' },
    { value: 0.28, label: 'Normal' },
    { value: 0.35, label: 'Strict' },
  ];

  function getSimilarityLabel(value: number): string {
    if (value <= 0.23) return 'Loose';
    if (value <= 0.31) return 'Normal';
    return 'Strict';
  }

  async function loadCategories() {
    isLoading = true;
    try {
      categories = await getClassificationCategories();
    } finally {
      isLoading = false;
    }
  }

  function startCreate() {
    isCreating = true;
    editingId = null;
    editName = '';
    editPrompts = '';
    editSimilarity = 0.28;
    editAction = 'tag';
  }

  function startEdit(category: ClassificationCategoryResponseDto) {
    isCreating = false;
    editingId = category.id;
    editName = category.name;
    editPrompts = category.prompts.join('\n');
    editSimilarity = category.similarity;
    editAction = category.action;
  }

  function cancelEdit() {
    editingId = null;
    isCreating = false;
  }

  async function saveCategory() {
    const prompts = editPrompts
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);

    if (!editName || prompts.length === 0) {
      return;
    }

    try {
      if (isCreating) {
        await createClassificationCategory({
          classificationCategoryCreateDto: {
            name: editName,
            prompts,
            similarity: editSimilarity,
            action: editAction,
          },
        });
        notificationController.show({ message: `Category "${editName}" created`, type: 'info' });
      } else if (editingId) {
        await updateClassificationCategory({
          id: editingId,
          classificationCategoryUpdateDto: {
            name: editName,
            prompts,
            similarity: editSimilarity,
            action: editAction,
          },
        });
        notificationController.show({ message: `Category "${editName}" updated`, type: 'info' });
      }
      cancelEdit();
      await loadCategories();
    } catch (error) {
      notificationController.show({ message: 'Failed to save category', type: 'error' });
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete category "${name}"? This will also delete the Auto/${name} tag.`)) {
      return;
    }

    try {
      await deleteClassificationCategory({ id });
      notificationController.show({ message: `Category "${name}" deleted`, type: 'info' });
      await loadCategories();
    } catch (error) {
      notificationController.show({ message: 'Failed to delete category', type: 'error' });
    }
  }

  async function handleToggleEnabled(category: ClassificationCategoryResponseDto) {
    await updateClassificationCategory({
      id: category.id,
      classificationCategoryUpdateDto: { enabled: !category.enabled },
    });
    await loadCategories();
  }

  async function handleScanLibrary() {
    try {
      await scanClassificationLibrary();
      notificationController.show({
        message: 'Library scan queued. Classification will run in the background.',
        type: 'info',
      });
    } catch (error) {
      notificationController.show({ message: 'Failed to start library scan', type: 'error' });
    }
  }

  $effect(() => {
    loadCategories();
  });
</script>

<div class="flex flex-col gap-4">
  {#if isLoading}
    <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
  {:else}
    <!-- Category list -->
    {#each categories as category (category.id)}
      {#if editingId === category.id}
        <!-- Edit form (see below) -->
      {:else}
        <div class="flex items-center justify-between rounded-lg border p-3 dark:border-gray-700">
          <div class="flex flex-col gap-1">
            <span class="font-medium" class:opacity-50={!category.enabled}>{category.name}</span>
            <span class="text-xs text-gray-500">
              {category.prompts.length} prompt{category.prompts.length !== 1 ? 's' : ''} &middot;
              {getSimilarityLabel(category.similarity)} &middot;
              {category.action === 'tag_and_archive' ? 'Tag + Archive' : 'Tag only'}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-1">
              <input
                type="checkbox"
                checked={category.enabled}
                onchange={() => handleToggleEnabled(category)}
              />
            </label>
            <button onclick={() => startEdit(category)} class="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
              <svg class="h-4 w-4"><path d={mdiPencil} /></svg>
            </button>
            <button
              onclick={() => handleDelete(category.id, category.name)}
              class="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <svg class="h-4 w-4"><path d={mdiDelete} /></svg>
            </button>
          </div>
        </div>
      {/if}
    {/each}

    <!-- Create/Edit form -->
    {#if isCreating || editingId}
      <div class="rounded-lg border p-4 dark:border-gray-700">
        <div class="flex flex-col gap-3">
          <div>
            <label class="text-sm font-medium">Name</label>
            <input
              type="text"
              bind:value={editName}
              placeholder="e.g., Screenshots"
              class="mt-1 w-full rounded border px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            />
          </div>

          <div>
            <label class="text-sm font-medium">Prompts (one per line)</label>
            <textarea
              bind:value={editPrompts}
              placeholder="screenshot of a phone screen&#10;screenshot of a computer screen"
              rows="4"
              class="mt-1 w-full rounded border px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            ></textarea>
            <p class="mt-1 text-xs text-gray-500">Describe what these images look like. Multiple prompts improve accuracy.</p>
          </div>

          <div>
            <label class="text-sm font-medium">
              Sensitivity: {getSimilarityLabel(editSimilarity)} ({Math.round(editSimilarity * 100)}%)
            </label>
            <input
              type="range"
              bind:value={editSimilarity}
              min="0.15"
              max="0.45"
              step="0.01"
              class="mt-1 w-full"
            />
            <div class="flex justify-between text-xs text-gray-500">
              <span>Loose (more matches)</span>
              <span>Strict (fewer matches)</span>
            </div>
          </div>

          <div>
            <label class="text-sm font-medium">Action</label>
            <select
              bind:value={editAction}
              class="mt-1 w-full rounded border px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            >
              <option value="tag">Tag only</option>
              <option value="tag_and_archive">Tag and archive</option>
            </select>
          </div>

          <div class="flex gap-2">
            <button
              onclick={saveCategory}
              class="rounded bg-primary px-4 py-2 text-white"
            >
              Save
            </button>
            <button
              onclick={cancelEdit}
              class="rounded border px-4 py-2 dark:border-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Action buttons -->
    <div class="flex gap-2">
      {#if !isCreating && !editingId}
        <button onclick={startCreate} class="flex items-center gap-1 rounded border px-3 py-2 dark:border-gray-600">
          <svg class="h-4 w-4"><path d={mdiPlus} /></svg>
          Add Category
        </button>
      {/if}
      <button onclick={handleScanLibrary} class="flex items-center gap-1 rounded border px-3 py-2 dark:border-gray-600">
        <svg class="h-4 w-4"><path d={mdiMagnifyScan} /></svg>
        Scan Library
      </button>
    </div>
  {/if}
</div>
```

**Step 2: Add to user-settings-list.svelte**

Import the new component and add a new `SettingAccordion` section:

```svelte
import ClassificationSettings from '$lib/components/user-settings-page/classification-settings.svelte';
```

Add after an existing section (e.g., after the download settings accordion):

```svelte
  <SettingAccordion
    icon={mdiMagnifyScan}
    key="auto-classification"
    title="Auto-Classification"
    subtitle="Automatically tag and archive photos by category"
  >
    <ClassificationSettings />
  </SettingAccordion>
```

Import `mdiMagnifyScan` from `@mdi/js`.

**Step 3: Run web lint and type-check**

```bash
cd web && npx svelte-check --tsconfig ./tsconfig.json
```

**Step 4: Commit**

```
feat(web): add auto-classification settings UI
```

---

### Task 15: Web Unit Tests

**Files:**

- Create: `web/src/lib/components/user-settings-page/classification-settings.spec.ts`

**Step 1: Write basic tests**

Test:

1. Renders empty state with "Add Category" button
2. Opens create form when "Add Category" clicked
3. Displays categories when loaded

Use `@testing-library/svelte` with `render` and `screen` following existing test patterns in `web/src/lib/components/`.

**Step 2: Run tests**

Run: `cd web && pnpm test -- --run src/lib/components/user-settings-page/classification-settings.spec.ts`

**Step 3: Commit**

```
test(web): add classification settings component tests
```

---

### Task 16: CLIP Model Change Hook

**Files:**

- Modify: `server/src/services/classification.service.ts`

**Step 1: Add ConfigUpdate event handler**

Add an `init` method to `ClassificationService` that listens for CLIP model changes:

```typescript
  @OnEvent({ name: 'config.update' })
  async onConfigUpdate({ oldConfig, newConfig }: { oldConfig: SystemConfig; newConfig: SystemConfig }) {
    if (oldConfig.machineLearning.clip.modelName !== newConfig.machineLearning.clip.modelName) {
      this.logger.log('CLIP model changed, re-encoding classification prompt embeddings');
      await this.reEncodeAllPrompts(newConfig.machineLearning.clip.modelName);
      await this.jobRepository.queue({ name: JobName.AssetClassifyQueueAll, data: {} });
    }
  }

  private async reEncodeAllPrompts(modelName: string) {
    // Get all categories across all users
    const categories = await this.db
      .selectFrom('classification_category')
      .selectAll()
      .execute();

    for (const category of categories) {
      const prompts = await this.classificationRepository.getPromptEmbeddings(category.id);
      await this.classificationRepository.deletePromptEmbeddingsByCategory(category.id);
      for (const { prompt } of prompts) {
        const embedding = await this.machineLearningRepository.encodeText(prompt, { modelName });
        await this.classificationRepository.upsertPromptEmbedding({
          categoryId: category.id,
          prompt,
          embedding,
        });
      }
    }
  }
```

Note: The exact event decorator pattern should match `SmartInfoService.init()` — check the `@OnEvent`
decorator import and signature used there.

**Step 2: Commit**

```
feat(server): re-encode classification prompts on CLIP model change
```

---

### Task 17: SQL Generation and Final Checks

**Files:**

- Regenerate SQL query documentation

**Step 1: Run SQL generation**

```bash
make sql
```

**Step 2: Run all linters**

```bash
make check-server
make lint-server
make check-web
make lint-web
```

**Step 3: Run server tests**

```bash
cd server && pnpm test
```

**Step 4: Run web tests**

```bash
cd web && pnpm test
```

**Step 5: Commit any generated file changes**

```
chore: regenerate SQL queries and fix lint issues
```

---

### Task 18: E2E Test (API)

**Files:**

- Create: `e2e/src/specs/api/classification.e2e-spec.ts`

**Step 1: Write API E2E tests**

Test the full CRUD flow:

1. Create a category → 201 with correct response
2. Get categories → returns the created category
3. Update category name and prompts → 200 with updated values
4. Delete category → 204
5. Get categories → empty array
6. Scan library → 204

Follow existing E2E patterns in `e2e/src/specs/api/` (setup with admin/user tokens, cleanup).

**Step 2: Run E2E tests**

```bash
cd e2e && pnpm test -- --run src/specs/api/classification.e2e-spec.ts
```

**Step 3: Commit**

```
test(e2e): add classification API e2e tests
```
