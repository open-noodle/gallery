import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetVisibility } from 'src/enum';
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

  async removeAutoTagAssignments(categoryName: string) {
    const tagValue = `Auto/${categoryName}`;

    const tags = await this.db.selectFrom('tag').select('id').where('value', '=', tagValue).execute();

    if (tags.length === 0) {
      return;
    }

    const tagIds = tags.map((t) => t.id);

    const affectedAssets = await this.db
      .selectFrom('tag_asset')
      .select('assetId')
      .where('tagId', 'in', tagIds)
      .execute();

    const assetIds = affectedAssets.map((a) => a.assetId);

    if (assetIds.length > 0) {
      await this.db
        .updateTable('asset')
        .set({ visibility: AssetVisibility.Timeline })
        .where('id', 'in', assetIds)
        .where('visibility', '=', AssetVisibility.Archive)
        .execute();
    }

    await this.db.deleteFrom('tag_asset').where('tagId', 'in', tagIds).execute();
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
