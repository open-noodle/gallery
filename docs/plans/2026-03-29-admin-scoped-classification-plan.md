# Admin-Scoped Auto-Classification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move classification categories from per-user to admin-only, with global asset scanning and a read-only user view.

**Architecture:** Drop `userId` and `tagId` columns from `classification_category`. Admin-only endpoints for mutations, any-user access for reads. Classification jobs process all assets globally. Tags are created per-asset-owner via `upsertTags`.

**Tech Stack:** NestJS, Kysely, PostgreSQL, SvelteKit, Svelte 5, Vitest

**Design doc:** `docs/plans/2026-03-29-admin-scoped-classification-design.md`

---

### Task 1: Database Migration

**Files:**

- Create: `server/src/schema/migrations-gallery/1777000000000-AdminScopedClassification.ts`

**Step 1: Write the migration**

```typescript
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Step 1: Find the admin user (first admin by creation date)
  const admin = await sql<{ id: string }>`
    SELECT "id" FROM "user" WHERE "isAdmin" = true ORDER BY "createdAt" ASC LIMIT 1
  `.execute(db);

  if (admin.rows.length === 0) {
    // No admin user exists (fresh install with no setup yet) — nothing to migrate
    // Just alter the schema
  } else {
    const adminId = admin.rows[0].id;

    // Step 2: Rename conflicting non-admin categories (suffix with username)
    // Must happen BEFORE reassigning userId to avoid unique constraint violations
    await sql`
      UPDATE "classification_category" cc
      SET "name" = cc."name" || ' (' || u."name" || ')'
      FROM "user" u
      WHERE cc."userId" = u."id"
        AND cc."userId" != ${adminId}
        AND EXISTS (
          SELECT 1 FROM "classification_category" admin_cc
          WHERE admin_cc."userId" = ${adminId}
            AND admin_cc."name" = cc."name"
        )
    `.execute(db);

    // Step 3: Reassign all categories to admin
    await sql`
      UPDATE "classification_category" SET "userId" = ${adminId}
      WHERE "userId" != ${adminId}
    `.execute(db);
  }

  // Step 4: Drop tagId column (FK + index dropped automatically)
  await sql`ALTER TABLE "classification_category" DROP COLUMN "tagId"`.execute(db);

  // Step 5: Drop the old unique constraint, then userId column
  await sql`ALTER TABLE "classification_category" DROP CONSTRAINT "classification_category_userId_name_uq"`.execute(db);
  await sql`ALTER TABLE "classification_category" DROP COLUMN "userId"`.execute(db);

  // Step 6: Add new unique constraint on name alone
  await sql`ALTER TABLE "classification_category" ADD CONSTRAINT "classification_category_name_uq" UNIQUE ("name")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  // This migration is not safely reversible (data merged, columns dropped)
  // Restore columns and constraint but data is lost
  await sql`ALTER TABLE "classification_category" DROP CONSTRAINT IF EXISTS "classification_category_name_uq"`.execute(
    db,
  );
  await sql`ALTER TABLE "classification_category" ADD COLUMN "userId" uuid REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE`.execute(
    db,
  );
  await sql`ALTER TABLE "classification_category" ADD COLUMN "tagId" uuid REFERENCES "tag"("id") ON DELETE SET NULL`.execute(
    db,
  );
  await sql`ALTER TABLE "classification_category" ADD CONSTRAINT "classification_category_userId_name_uq" UNIQUE ("userId", "name")`.execute(
    db,
  );
  await sql`CREATE INDEX "classification_category_tagId_idx" ON "classification_category" ("tagId")`.execute(db);
}
```

**Step 2: Commit**

```bash
git add server/src/schema/migrations-gallery/1777000000000-AdminScopedClassification.ts
git commit -m "feat: add migration for admin-scoped classification"
```

---

### Task 2: Update Schema Table

**Files:**

- Modify: `server/src/schema/tables/classification-category.table.ts`

**Step 1: Update the table definition**

Remove the `userId` field, `tagId` field, and their imports. Update the unique constraint.

The file should become:

```typescript
import {
  Column,
  CreateDateColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  Unique,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';

@Table('classification_category')
@UpdatedAtTrigger('classification_category_updatedAt')
@Unique({ columns: ['name'] })
export class ClassificationCategoryTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @Column()
  name!: string;

  @Column({ type: 'real', default: 0.28 })
  similarity!: Generated<number>;

  @Column({ type: 'character varying', default: 'tag' })
  action!: Generated<string>;

  @Column({ type: 'boolean', default: true })
  enabled!: Generated<boolean>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

**Step 2: Commit**

```bash
git add server/src/schema/tables/classification-category.table.ts
git commit -m "feat: remove userId and tagId from classification category schema"
```

---

### Task 3: Update Repository

**Files:**

- Modify: `server/src/repositories/classification.repository.ts`

**Step 1: Update all methods to remove userId/tagId filtering**

Changes:

- `getCategories()`: Remove `userId` param, remove `.where('userId', '=', userId)`.
- `getCategoriesWithPrompts()`: Remove `userId` param, remove `.where('c.userId', '=', userId)`.
- `getEnabledCategoriesWithEmbeddings()`: Remove `userId` param, remove `.where('c.userId', '=', userId)`, remove `'c.tagId'` from select list.
- `resetClassifiedAt()`: Remove `userId` param. Change the body to update all rows: `.set({ classifiedAt: null }).where('classifiedAt', 'is not', null)` (remove the subquery).
- `streamUnclassifiedAssets()`: Remove `userId` param and the conditional `if (userId)` block.
- `createCategory()`: No change needed (the Insertable type will automatically exclude userId/tagId since the schema table no longer has them).
- **Consolidation note**: After these changes, `getCategories()` and `getAllCategories()` are identical. Remove `getAllCategories()` and update `reEncodeAllPrompts()` in the service to call `getCategories()` instead.

The full updated file:

```typescript
import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { ClassificationCategoryTable } from 'src/schema/tables/classification-category.table';
import { ClassificationPromptEmbeddingTable } from 'src/schema/tables/classification-prompt-embedding.table';

@Injectable()
export class ClassificationRepository {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(ClassificationRepository.name);
  }

  @GenerateSql()
  getCategories() {
    return this.db.selectFrom('classification_category').selectAll().orderBy('name', 'asc').execute();
  }

  @GenerateSql()
  getCategoriesWithPrompts() {
    return this.db
      .selectFrom('classification_category as c')
      .leftJoin('classification_prompt_embedding as p', 'p.categoryId', 'c.id')
      .select(['c.id', 'c.name', 'c.similarity', 'c.action', 'c.enabled', 'c.createdAt', 'c.updatedAt', 'p.prompt'])
      .orderBy('c.name', 'asc')
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

  @GenerateSql()
  getEnabledCategoriesWithEmbeddings() {
    return this.db
      .selectFrom('classification_category as c')
      .innerJoin('classification_prompt_embedding as p', 'p.categoryId', 'c.id')
      .select([
        'c.id as categoryId',
        'c.name',
        'c.similarity',
        'c.action',
        'p.id as promptId',
        'p.prompt',
        'p.embedding',
      ])
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

  async resetClassifiedAt() {
    await this.db
      .updateTable('asset_job_status')
      .set({ classifiedAt: null })
      .where('classifiedAt', 'is not', null)
      .execute();
  }

  async setClassifiedAt(assetId: string) {
    await this.db
      .updateTable('asset_job_status')
      .set({ classifiedAt: new Date().toISOString() })
      .where('assetId', '=', assetId)
      .execute();
  }

  streamUnclassifiedAssets() {
    return this.db
      .selectFrom('asset_job_status as ajs')
      .innerJoin('asset as a', 'a.id', 'ajs.assetId')
      .innerJoin('smart_search as ss', 'ss.assetId', 'a.id')
      .select(['a.id', 'a.ownerId'])
      .where('ajs.classifiedAt', 'is', null)
      .stream();
  }
}
```

**Step 2: Run type check to verify schema alignment**

Run: `cd server && npx tsc --noEmit 2>&1 | head -30`

This will likely fail until the service is also updated (Task 4). That's expected.

**Step 3: Commit**

```bash
git add server/src/repositories/classification.repository.ts
git commit -m "feat: remove userId/tagId from classification repository queries"
```

---

### Task 4: Update DTOs and Job Type

**Files:**

- Modify: `server/src/dtos/classification.dto.ts`
- Modify: `server/src/types.ts:458-459`

These must be updated before the service (Task 5) to avoid TypeScript compilation errors.

**Step 1: Remove tagId from response DTO**

In `ClassificationCategoryResponseDto`, remove:

```typescript
  @ApiProperty({ nullable: true, type: String })
  tagId!: string | null;
```

**Step 2: Change the job data type**

In `server/src/types.ts`, change:

```typescript
| { name: JobName.AssetClassifyQueueAll; data: { userId?: string } }
```

To:

```typescript
| { name: JobName.AssetClassifyQueueAll; data: Record<string, never> }
```

**Step 3: Commit**

```bash
git add server/src/dtos/classification.dto.ts server/src/types.ts
git commit -m "feat: remove tagId from DTO and userId from classification job type"
```

---

### Task 5: Update Service

**Files:**

- Modify: `server/src/services/classification.service.ts`

**Step 1: Update all methods**

Changes:

- `mapCategory()`: Remove `tagId` from the input type and output mapping.
- `getCategories(auth)`: Change `getCategoriesWithPrompts(auth.user.id)` → `getCategoriesWithPrompts()`. Keep `auth` param (needed for auth guard).
- `createCategory(auth, dto)`: Remove `userId: auth.user.id` from the insert object.
- `updateCategory(auth, id, dto)`: Remove `existing.userId !== auth.user.id` ownership check. Remove the entire tag-rename-deletion block (`if (dto.name !== existing.name && existing.tagId) { ... }`). Remove `updateValues.tagId = null`.
- `deleteCategory(auth, id)`: Remove `category.userId !== auth.user.id` ownership check. Remove `tagRepository.delete(category.tagId)` block.
- `scanLibrary(auth)`: Change `resetClassifiedAt(auth.user.id)` → `resetClassifiedAt()`. Change job data from `{ userId: auth.user.id }` → `{}`.
- `handleClassifyQueueAll(data)`: Change param type from `{ userId?: string }` to `{}`. Change `streamUnclassifiedAssets(data.userId)` → `streamUnclassifiedAssets()`.
- `handleClassify({ id })`: Change `getEnabledCategoriesWithEmbeddings(asset.ownerId)` → `getEnabledCategoriesWithEmbeddings()`. Replace the tagId caching logic: remove the `if (!tagId)` block and the `category.tagId` usage. Always call `upsertTags` and use the returned tag ID. Remove `tagId` from the categories Map type.

The full updated file:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent, OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  ClassificationCategoryCreateDto,
  ClassificationCategoryResponseDto,
  ClassificationCategoryUpdateDto,
} from 'src/dtos/classification.dto';
import { AssetVisibility, ImmichWorker, JobName, JobStatus, QueueName } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';
import { upsertTags } from 'src/utils/tag';

@Injectable()
export class ClassificationService extends BaseService {
  private mapCategory(
    category: {
      id: string;
      name: string;
      similarity: number;
      action: string;
      enabled: boolean;
      createdAt: unknown;
      updatedAt: unknown;
    },
    prompts: string[],
  ): ClassificationCategoryResponseDto {
    return {
      id: category.id,
      name: category.name,
      prompts,
      similarity: category.similarity,
      action: category.action,
      enabled: category.enabled,
      createdAt: String(category.createdAt),
      updatedAt: String(category.updatedAt),
    };
  }

  async getCategories(auth: AuthDto): Promise<ClassificationCategoryResponseDto[]> {
    const rows = await this.classificationRepository.getCategoriesWithPrompts();

    const categoryMap = new Map<string, { category: (typeof rows)[0]; prompts: string[] }>();
    for (const row of rows) {
      if (!categoryMap.has(row.id)) {
        categoryMap.set(row.id, { category: row, prompts: [] });
      }
      if (row.prompt) {
        categoryMap.get(row.id)!.prompts.push(row.prompt);
      }
    }

    return [...categoryMap.values()].map(({ category, prompts }) => this.mapCategory(category, prompts));
  }

  async createCategory(
    auth: AuthDto,
    dto: ClassificationCategoryCreateDto,
  ): Promise<ClassificationCategoryResponseDto> {
    const { machineLearning } = await this.getConfig({ withCache: true });

    const category = await this.classificationRepository.createCategory({
      name: dto.name,
      similarity: dto.similarity,
      action: dto.action,
    });

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

    return this.mapCategory(category, dto.prompts);
  }

  async updateCategory(
    auth: AuthDto,
    id: string,
    dto: ClassificationCategoryUpdateDto,
  ): Promise<ClassificationCategoryResponseDto> {
    const existing = await this.classificationRepository.getCategory(id);
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    const updateValues: Record<string, unknown> = {};
    if (dto.name !== void 0) {
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

    const promptRows = await this.classificationRepository.getPromptEmbeddings(id);
    return this.mapCategory(
      category,
      promptRows.map((p) => p.prompt),
    );
  }

  async deleteCategory(auth: AuthDto, id: string): Promise<void> {
    const category = await this.classificationRepository.getCategory(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    await this.classificationRepository.deleteCategory(id);
  }

  async scanLibrary(auth: AuthDto): Promise<void> {
    await this.classificationRepository.resetClassifiedAt();
    await this.jobRepository.queue({
      name: JobName.AssetClassifyQueueAll,
      data: {},
    });
  }

  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    if (oldConfig.machineLearning.clip.modelName !== newConfig.machineLearning.clip.modelName) {
      this.logger.log('CLIP model changed, re-encoding classification prompt embeddings');
      await this.reEncodeAllPrompts(newConfig.machineLearning.clip.modelName);
      await this.jobRepository.queue({ name: JobName.AssetClassifyQueueAll, data: {} });
    }
  }

  private async reEncodeAllPrompts(modelName: string) {
    const categories = await this.classificationRepository.getCategories();
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

  @OnJob({ name: JobName.AssetClassifyQueueAll, queue: QueueName.Classification })
  async handleClassifyQueueAll(_data: Record<string, never>): Promise<JobStatus> {
    const stream = this.classificationRepository.streamUnclassifiedAssets();

    let queue: Array<{ name: JobName.AssetClassify; data: { id: string } }> = [];
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
    const asset = await this.assetRepository.getById(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    const embedding = await this.searchRepository.getEmbedding(id);
    if (!embedding) {
      return JobStatus.Skipped;
    }

    const rows = await this.classificationRepository.getEnabledCategoriesWithEmbeddings();
    if (rows.length === 0) {
      await this.classificationRepository.setClassifiedAt(id);
      return JobStatus.Skipped;
    }

    const categories = new Map<string, { name: string; similarity: number; action: string; embeddings: string[] }>();
    for (const row of rows) {
      if (!categories.has(row.categoryId)) {
        categories.set(row.categoryId, {
          name: row.name,
          similarity: row.similarity,
          action: row.action,
          embeddings: [],
        });
      }
      categories.get(row.categoryId)!.embeddings.push(row.embedding);
    }

    const assetEmbedding = this.parseEmbedding(embedding);
    let shouldArchive = false;

    for (const [, category] of categories) {
      let bestSimilarity = -1;
      for (const promptEmbedding of category.embeddings) {
        const similarity = this.cosineSimilarity(assetEmbedding, this.parseEmbedding(promptEmbedding));
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
        }
      }

      if (bestSimilarity >= category.similarity) {
        const tags = await upsertTags(this.tagRepository, {
          userId: asset.ownerId,
          tags: [`Auto/${category.name}`],
        });
        const tagId = tags[0].id;
        await this.tagRepository.upsertAssetIds([{ tagId, assetId: id }]);

        if (category.action === 'tag_and_archive') {
          shouldArchive = true;
        }
      }
    }

    if (shouldArchive && asset.visibility === AssetVisibility.Timeline) {
      await this.assetRepository.updateAll([id], { visibility: AssetVisibility.Archive });
    }

    await this.classificationRepository.setClassifiedAt(id);
    return JobStatus.Success;
  }

  private parseEmbedding(raw: string): number[] {
    return raw.replaceAll(/[[\]]/g, '').split(',').map(Number);
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

**Step 2: Run type check**

Run: `cd server && npx tsc --noEmit 2>&1 | head -30`

Expected: Pass (or only unrelated errors).

**Step 3: Commit**

```bash
git add server/src/services/classification.service.ts
git commit -m "feat: make classification service admin-scoped and global"
```

---

### Task 6: Update Controller (Admin Auth)

**Files:**

- Modify: `server/src/controllers/classification.controller.ts`

**Step 1: Add admin guards to mutation endpoints**

- `GET /` stays `@Authenticated()` (any user can read)
- `POST /` → `@Authenticated({ admin: true })`
- `PUT /:id` → `@Authenticated({ admin: true })`
- `DELETE /:id` → `@Authenticated({ admin: true })`
- `POST /scan` → `@Authenticated({ admin: true })`

The full updated file:

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
import { ApiTag } from 'src/enum';
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
  @Authenticated({ admin: true })
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
  @Authenticated({ admin: true })
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
  @Authenticated({ admin: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a classification category',
    history: new HistoryBuilder().added('v1'),
  })
  deleteCategory(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.deleteCategory(auth, id);
  }

  @Post('scan')
  @Authenticated({ admin: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Scan all libraries for classification',
    history: new HistoryBuilder().added('v1'),
  })
  scanClassification(@Auth() auth: AuthDto): Promise<void> {
    return this.service.scanLibrary(auth);
  }
}
```

**Step 2: Run type check and build server**

Run: `cd server && npx tsc --noEmit 2>&1 | head -30`

Expected: Pass.

**Step 3: Commit**

```bash
git add server/src/controllers/classification.controller.ts
git commit -m "feat: add admin auth guards to classification mutation endpoints"
```

---

### Task 7: Update Unit Tests

**Files:**

- Modify: `server/src/services/classification.service.spec.ts`

**Step 1: Update tests to match new behavior**

Key changes:

- `handleClassify` tests: Remove `tagId` from mock data. Replace tests that check `tagId` caching (`updateCategory` call with `{ tagId }`) with tests that always call `upsertTags`. Mock `tag.upsertValue` instead of relying on `tagId`.
- `getCategories`: Remove `auth.user.id` from `getCategoriesWithPrompts` expectation. Remove `tagId` from mock data.
- `createCategory`: Remove `userId` from `createCategory` mock expectation. Remove `tagId` from return mock.
- `updateCategory`: Remove "should throw NotFoundException for category owned by different user" test. Remove "should delete old tag when name changes" test. Remove `userId` from `existingCategory`. Remove `tagId` from `existingCategory`.
- `deleteCategory`: Remove "should delete associated tag" test. Replace with test that just deletes the category. Remove `userId` from mock. Remove `tagId` from mock.
- `handleClassifyQueueAll`: Change `{ userId: 'user-1' }` → `{}`. Change `streamUnclassifiedAssets` expectation from `('user-1')` → `()`.
- `scanLibrary`: Change `resetClassifiedAt` expectation from `('user-id')` → `()`. Change job data from `{ userId: 'user-id' }` → `{}`.
- `getEnabledCategoriesWithEmbeddings` mock calls: Remove the `asset.ownerId` argument.
- `onConfigUpdate` tests: Change `mocks.classification.getAllCategories` → `mocks.classification.getCategories` (method consolidated).
- **Mock data structure change**: `getEnabledCategoriesWithEmbeddings` no longer returns `tagId`. Remove `tagId` from all mock objects for this method. Tests that previously relied on `tagId: 'tag-1'` to skip `upsertTags` must now mock `tag.upsertValue` to return a tag, since `upsertTags` is always called.

See design doc for the full behavioral spec. Write tests that verify:

1. `handleClassify` always calls `upsertTags` with `asset.ownerId` (no tagId caching)
2. `handleClassify` loads categories without userId filter
3. `updateCategory` only checks existence, not ownership
4. `deleteCategory` only checks existence, not ownership, and does NOT call `tagRepository.delete`
5. `scanLibrary` resets all assets and queues with empty data
6. `handleClassifyQueueAll` streams all assets without userId

**Step 2: Run tests**

Run: `cd server && pnpm test -- --run src/services/classification.service.spec.ts`

Expected: All tests pass.

**Step 3: Commit**

```bash
git add server/src/services/classification.service.spec.ts
git commit -m "test: update classification unit tests for admin-scoped behavior"
```

---

### Task 8: Update Medium Tests

**Files:**

- Modify: `server/test/medium/specs/repositories/classification.repository.spec.ts`

**Step 1: Update tests for admin-scoped schema**

Key changes — the `userId` column no longer exists, so all `createCategory` calls lose the `userId` field, all parameterized queries lose their userId arguments, and user-scoping tests are replaced with global behavior tests:

- `createCategory({ userId, name, ... })` → `createCategory({ name, ... })` (all occurrences)
- `getEnabledCategoriesWithEmbeddings(user.id)` → `getEnabledCategoriesWithEmbeddings()`
- `getCategories(user.id)` → `getCategories()`
- `resetClassifiedAt(user.id)` → `resetClassifiedAt()`
- `streamUnclassifiedAssets(user1.id)` → `streamUnclassifiedAssets()`
- **Remove** "should filter by userId when provided" test (this functionality no longer exists)
- **Remove** "should cascade delete categories when user is deleted" test (no FK to user anymore)
- **Remove** "should allow same category name for different users" test (now globally unique)
- **Update** "should clear classifiedAt for only the specified user" → "should clear classifiedAt for all assets" (verify both users' assets get reset)
- **Update** unique constraint test: "should not allow two categories with the same name" (no userId, just name uniqueness)

**Step 2: Run medium tests**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/classification.repository.spec.ts`

Expected: All pass.

**Step 3: Commit**

```bash
git add server/test/medium/specs/repositories/classification.repository.spec.ts
git commit -m "test: update classification medium tests for admin-scoped schema"
```

---

### Task 9: Regenerate OpenAPI + SQL

**Step 1: Build server and regenerate specs**

Run:

```bash
cd server && pnpm build
cd server && pnpm sync:open-api
make open-api
make sql
```

**Step 2: Verify the generated SDK no longer has tagId in the response type**

Check TypeScript SDK: `grep -r 'tagId' open-api/typescript-sdk/src/` — should have no classification-related hits.
Check Dart SDK: `grep -r 'tagId' mobile/openapi/lib/model/classification_category_response_dto.dart` — file should no longer contain `tagId`.

**Step 3: Commit all generated files**

```bash
git add open-api/ server/src/queries/
git commit -m "chore: regenerate OpenAPI specs and SQL queries"
```

---

### Task 10: Move Web Component to Admin Settings

**Files:**

- Create: `web/src/lib/components/admin-settings/ClassificationSettings.svelte`
- Modify: `web/src/routes/admin/system-settings/+page.svelte`
- Modify: `web/src/lib/components/user-settings-page/user-settings-list.svelte`

**Step 1: Move the classification settings component**

Copy `web/src/lib/components/user-settings-page/classification-settings.svelte` to `web/src/lib/components/admin-settings/ClassificationSettings.svelte`.

Note the filename convention change: admin settings use PascalCase (`ClassificationSettings.svelte`).

Apply these changes to the copied component:

- Rename "Scan Library" button to "Scan All Libraries"
- Add a confirmation before scanning (e.g., use `confirm()` or a modal: "This will reclassify all assets across all users. Continue?")
- Remove `tagId` from any references if the SDK types have changed (the `ClassificationCategoryResponseDto` no longer has `tagId`)

**Step 2: Register in admin system settings page**

In `web/src/routes/admin/system-settings/+page.svelte`:

Add import:

```typescript
import ClassificationSettings from '$lib/components/admin-settings/ClassificationSettings.svelte';
```

Add icon import (add `mdiMagnifyScan` to the existing `@mdi/js` import block).

Add to the `settings` array (after MachineLearningSettings is a natural fit):

```typescript
{
  component: ClassificationSettings,
  title: $t('admin.classification_settings'),
  subtitle: $t('admin.classification_settings_description'),
  key: 'classification',
  icon: mdiMagnifyScan,
},
```

Note: The i18n keys `admin.classification_settings` ("Auto-Classification") and `admin.classification_settings_description` ("Manage classification categories for automatic photo tagging") need to be added to the i18n translation file. After adding, run `pnpm --filter=immich-i18n format:fix` to sort keys.

**Step 3: Commit**

```bash
git add web/src/lib/components/admin-settings/ClassificationSettings.svelte web/src/routes/admin/system-settings/+page.svelte
git commit -m "feat: move classification settings to admin panel"
```

---

### Task 11: Replace User Settings with Read-Only View

**Files:**

- Modify: `web/src/lib/components/user-settings-page/classification-settings.svelte`
- Modify: `web/src/lib/components/user-settings-page/user-settings-list.svelte`

**Step 1: Replace the user settings component with read-only view**

Rewrite `web/src/lib/components/user-settings-page/classification-settings.svelte` to be a read-only view:

```svelte
<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { getCategories, type ClassificationCategoryResponseDto } from '@immich/sdk';
  import { Text } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  let categories: ClassificationCategoryResponseDto[] = $state([]);

  const getSimilarityLabel = (value: number): string => {
    if (value < 0.22) {
      return 'Loose';
    }
    if (value > 0.35) {
      return 'Strict';
    }
    return 'Normal';
  };

  const actionLabels: Record<string, string> = {
    tag: 'Tag only',
    tag_and_archive: 'Tag and archive',
  };

  onMount(async () => {
    try {
      categories = await getCategories();
    } catch (error) {
      handleError(error, 'Unable to load classification categories');
    }
  });
</script>

<section class="my-4">
  <Text size="small" color="muted" class="mb-4">
    {$t('classification_managed_by_admin')}
  </Text>

  {#if categories.length > 0}
    {#each categories as category (category.id)}
      <div
        class="rounded-2xl border border-gray-200 dark:border-gray-800 mt-3 bg-slate-50 dark:bg-gray-900 p-4"
        class:opacity-50={!category.enabled}
      >
        <div class="flex items-center gap-2">
          <Text fontWeight="medium">{category.name}</Text>
          <span
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
              {category.action === 'tag_and_archive'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
              : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'}"
          >
            {actionLabels[category.action] ?? category.action}
          </span>
          {#if !category.enabled}
            <span class="text-xs text-gray-500 dark:text-gray-400">(Disabled)</span>
          {/if}
        </div>
        <Text size="tiny" color="muted">
          {getSimilarityLabel(category.similarity)} ({category.similarity.toFixed(2)})
        </Text>
      </div>
    {/each}
  {:else}
    <Text color="muted">{$t('no_classification_categories')}</Text>
  {/if}
</section>
```

Note: i18n keys `classification_managed_by_admin` ("Classification categories are managed by your administrator") and `no_classification_categories` ("No classification categories configured") need to be added to the translation file. Run `pnpm --filter=immich-i18n format:fix` after adding.

**Step 2: Update accordion subtitle in user-settings-list.svelte**

In `web/src/lib/components/user-settings-page/user-settings-list.svelte`, update the classification accordion entry (around line 110-117) subtitle:

Change: `subtitle="Automatically tag and archive photos by category"`
To: `subtitle="View classification categories configured by your administrator"`

**Step 3: Run web type check**

Run: `cd web && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -20`

Expected: Pass.

**Step 4: Commit**

```bash
git add web/src/lib/components/user-settings-page/classification-settings.svelte web/src/lib/components/user-settings-page/user-settings-list.svelte
git commit -m "feat: replace user classification settings with read-only view"
```

---

### Task 12: Update Web Component Tests

**Files:**

- Modify: `web/src/lib/components/user-settings-page/classification-settings.spec.ts`

**Step 1: Rewrite tests for read-only component**

The existing spec has 9 tests for CRUD functionality (Add Category button, Scan Library button, edit form, delete, toggle, similarity slider, create form validation). Since the component is now read-only, replace all CRUD tests with read-only behavior tests.

Key changes:

- Remove `tagId` from `makeCategory` factory (field no longer in DTO)
- Remove `Action2` import (use plain strings)
- Remove all SDK mutation mocks (`createCategory`, `deleteCategory`, `updateCategory`, `scanClassification`)
- Keep `getCategories` mock

New tests to write:

1. "renders admin info text" — verify "Classification categories are managed by your administrator" is visible
2. "displays category name and metadata" — load categories, verify name, action badge, similarity label
3. "shows disabled state for disabled categories" — verify `opacity-50` class
4. "shows empty state when no categories" — verify "No classification categories configured."
5. "does not render Add Category or Scan buttons" — verify these buttons are absent
6. "error notification shown when SDK call fails" — keep this test, it still applies

**Step 2: Run web tests**

Run: `cd web && pnpm test -- --run src/lib/components/user-settings-page/classification-settings.spec.ts`

Expected: All pass.

**Step 3: Commit**

```bash
git add web/src/lib/components/user-settings-page/classification-settings.spec.ts
git commit -m "test: rewrite classification settings spec for read-only component"
```

---

### Task 13: Update E2E Tests

**Files:**

- Modify: `e2e/src/specs/server/api/classification.e2e-spec.ts`

**Step 1: Update tests for admin-only mutations**

Key changes:

- POST/PUT/DELETE/scan: Use `admin.accessToken` instead of `user.accessToken`
- Add tests: non-admin user gets 403 on POST, PUT, DELETE, scan
- GET: non-admin user still gets 200 (read-only access)
- Scan test uses `admin.accessToken`

Updated file:

```typescript
import { LoginResponseDto } from '@immich/sdk';
import { createUserDto, uuidDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('/classification/categories', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();

    admin = await utils.adminSetup();
    user = await utils.userSetup(admin.accessToken, createUserDto.user1);
  });

  describe('GET /classification/categories', () => {
    it('should require authentication', async () => {
      const { status, body } = await request(app).get('/classification/categories');
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('should return empty array for any authenticated user', async () => {
      const { status, body } = await request(app)
        .get('/classification/categories')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });
  });

  describe('POST /classification/categories', () => {
    it('should require authentication', async () => {
      const { status, body } = await request(app)
        .post('/classification/categories')
        .send({ name: 'Test', prompts: ['test prompt'] });
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('should require admin access', async () => {
      const { status, body } = await request(app)
        .post('/classification/categories')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test', prompts: ['test prompt'] });
      expect(status).toBe(403);
      expect(body).toEqual(errorDto.forbidden);
    });

    it('should require name', async () => {
      const { status, body } = await request(app)
        .post('/classification/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ prompts: ['test prompt'] });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest(expect.any(Array)));
    });

    it('should require prompts', async () => {
      const { status, body } = await request(app)
        .post('/classification/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Test' });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest(expect.any(Array)));
    });
  });

  describe('PUT /classification/categories/:id', () => {
    it('should require authentication', async () => {
      const { status, body } = await request(app)
        .put(`/classification/categories/${uuidDto.notFound}`)
        .send({ name: 'Updated' });
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('should require admin access', async () => {
      const { status, body } = await request(app)
        .put(`/classification/categories/${uuidDto.notFound}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Updated' });
      expect(status).toBe(403);
      expect(body).toEqual(errorDto.forbidden);
    });

    it('should return 404 for non-existent category', async () => {
      const { status } = await request(app)
        .put(`/classification/categories/${uuidDto.notFound}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Updated' });
      expect(status).toBe(404);
    });

    it('should require a valid uuid', async () => {
      const { status, body } = await request(app)
        .put(`/classification/categories/${uuidDto.invalid}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Updated' });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest(['id must be a UUID']));
    });
  });

  describe('DELETE /classification/categories/:id', () => {
    it('should require authentication', async () => {
      const { status, body } = await request(app).delete(`/classification/categories/${uuidDto.notFound}`);
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('should require admin access', async () => {
      const { status, body } = await request(app)
        .delete(`/classification/categories/${uuidDto.notFound}`)
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(status).toBe(403);
      expect(body).toEqual(errorDto.forbidden);
    });

    it('should return 404 for non-existent category', async () => {
      const { status } = await request(app)
        .delete(`/classification/categories/${uuidDto.notFound}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(404);
    });

    it('should require a valid uuid', async () => {
      const { status, body } = await request(app)
        .delete(`/classification/categories/${uuidDto.invalid}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send();
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest(['id must be a UUID']));
    });
  });

  describe('POST /classification/categories/scan', () => {
    it('should require authentication', async () => {
      const { status, body } = await request(app).post('/classification/categories/scan');
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('should require admin access', async () => {
      const { status, body } = await request(app)
        .post('/classification/categories/scan')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(status).toBe(403);
      expect(body).toEqual(errorDto.forbidden);
    });

    it('should return 204 for admin', async () => {
      const { status } = await request(app)
        .post('/classification/categories/scan')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(204);
    });
  });
});
```

**Step 2: Run E2E tests (if stack is available)**

Run: `cd e2e && pnpm test -- --run src/specs/server/api/classification.e2e-spec.ts`

Note: This requires the dev stack running. If not available, the tests will be validated by CI.

**Step 3: Commit**

```bash
git add e2e/src/specs/server/api/classification.e2e-spec.ts
git commit -m "test: update classification e2e tests for admin-only mutations"
```

---

### Task 14: Lint, Format, Type Check

**Step 1: Run server lint and format**

Run:

```bash
make lint-server
make format-server
make check-server
```

**Step 2: Run web lint and format**

Run:

```bash
make lint-web
make format-web
make check-web
```

**Step 3: Fix any issues found, then commit**

```bash
git add -A
git commit -m "chore: fix lint and formatting issues"
```

---

### Task 15: Final Verification

**Step 1: Run server unit tests**

Run: `cd server && pnpm test -- --run src/services/classification.service.spec.ts`

Expected: All pass.

**Step 2: Run full server test suite**

Run: `cd server && pnpm test`

Expected: All pass (no regressions).

**Step 3: Run web tests**

Run: `cd web && pnpm test`

Expected: All pass.

**Step 4: Verify build**

Run: `cd server && pnpm build`

Expected: Clean build.
