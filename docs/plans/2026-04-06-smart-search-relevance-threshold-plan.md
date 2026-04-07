# Smart Search Relevance Threshold — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an opt-in `maxDistance` config to exclude low-relevance CLIP results when combined with metadata filters.

**Architecture:** A new `maxDistance` field in `machineLearning.clip` SystemConfig. When set to a positive value, `searchSmart()` adds a `WHERE (embedding <=> query) <= maxDistance` clause before pagination. Default `0` = disabled (original behavior). Configurable via admin UI and YAML config file.

**Tech Stack:** NestJS, Kysely, PostgreSQL (pgvector/VectorChord `<=>` operator), Svelte 5, Vitest

**Design doc:** `docs/plans/2026-04-06-smart-search-relevance-threshold-design.md`

---

## Task 1: Config type + default

**Files:**

- Modify: `server/src/config.ts:62-65` (type) and `server/src/config.ts:270-273` (default)

**Step 1: Add `maxDistance` to the clip type**

In `server/src/config.ts`, find the clip type (line 62-65):

```typescript
clip: {
  enabled: boolean;
  modelName: string;
}
```

Change to:

```typescript
clip: {
  enabled: boolean;
  modelName: string;
  maxDistance: number;
}
```

**Step 2: Add default value**

Find the clip defaults (line 270-273):

```typescript
    clip: {
      enabled: true,
      modelName: 'ViT-B-32__openai',
    },
```

Change to:

```typescript
    clip: {
      enabled: true,
      modelName: 'ViT-B-32__openai',
      maxDistance: 0,
    },
```

**Step 3: Verify types compile**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`

Expected: Clean compile. The `config.ts` type and defaults are self-consistent. The DTO class
(`CLIPConfig`) is separate and doesn't cause errors here.

**Step 4: Commit**

```bash
git add server/src/config.ts
git commit -m "feat(config): add maxDistance to machineLearning.clip (default 0 = disabled)"
```

---

## Task 2: DTO validation

**Files:**

- Modify: `server/src/dtos/model-config.dto.ts:18`

**Step 1: Add maxDistance to CLIPConfig**

Find (line 18):

```typescript
export class CLIPConfig extends ModelConfig {}
```

Change to:

```typescript
export class CLIPConfig extends ModelConfig {
  @IsNumber()
  @Min(0)
  @Max(2)
  @Type(() => Number)
  @ApiProperty({
    type: 'number',
    format: 'double',
    description: 'Maximum cosine distance for smart search results. 0 = disabled.',
  })
  maxDistance!: number;
}
```

You'll need to add `IsNumber`, `Min`, `Max` to the `class-validator` import and `Type` to the `class-transformer` import. Check what's already imported — `IsNumber`, `Min`, `Max` are already imported (used by other classes). `Type` is already imported. `ApiProperty` is already imported.

**Step 2: Verify types compile**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`

Expected: Clean compile (no errors).

**Step 3: Commit**

```bash
git add server/src/dtos/model-config.dto.ts
git commit -m "feat(dto): add maxDistance validation to CLIPConfig"
```

---

## Task 3: Search options type + repository implementation

**Files:**

- Modify: `server/src/repositories/search.repository.ts:83-86` (interface)
- Modify: `server/src/repositories/search.repository.ts:330-378` (searchSmart method + decorator)

**Step 1: Add maxDistance to SearchEmbeddingOptions**

Find (line 83-86):

```typescript
export interface SearchEmbeddingOptions {
  embedding: string;
  userIds: string[];
}
```

Change to:

```typescript
export interface SearchEmbeddingOptions {
  embedding: string;
  userIds: string[];
  maxDistance?: number;
}
```

**Step 2: Update @GenerateSql decorator**

Find the `@GenerateSql` params (line 330-343):

```typescript
  @GenerateSql({
    params: [
      { page: 1, size: 200 },
      {
        takenAfter: DummyValue.DATE,
        embedding: DummyValue.VECTOR,
        lensModel: DummyValue.STRING,
        withStacked: true,
        isFavorite: true,
        userIds: [DummyValue.UUID],
        spacePersonIds: [DummyValue.UUID],
        orderDirection: 'desc',
      },
    ],
  })
```

Change to:

```typescript
  @GenerateSql({
    params: [
      { page: 1, size: 200 },
      {
        takenAfter: DummyValue.DATE,
        embedding: DummyValue.VECTOR,
        lensModel: DummyValue.STRING,
        withStacked: true,
        isFavorite: true,
        userIds: [DummyValue.UUID],
        spacePersonIds: [DummyValue.UUID],
        orderDirection: 'desc',
        maxDistance: 0.75,
      },
    ],
  })
```

**Step 3: Implement the threshold in searchSmart**

Replace the `searchSmart` method body (line 345-378). The key changes:

1. Add a helper to check if threshold is active: `(options.maxDistance ?? 0) > 0 && (options.maxDistance ?? 0) < 2`
2. Use Kysely `.$if()` to conditionally add the WHERE clause with explicit parentheses
3. Apply the same condition in both the relevance-ordering and date-ordering paths

Find:

```typescript
  searchSmart(pagination: SearchPaginationOptions, options: SmartSearchOptions) {
    if (!isValidInteger(pagination.size, { min: 1, max: 1000 })) {
      throw new Error(`Invalid value for 'size': ${pagination.size}`);
    }

    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);

      const baseQuery = searchAssetBuilder(trx, options)
        .selectAll('asset')
        .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
        .orderBy(sql`smart_search.embedding <=> ${options.embedding}`);

      if (options.orderDirection) {
        const orderDirection = options.orderDirection.toLowerCase() as OrderByDirection;
        const candidates = baseQuery.limit(500).as('candidates');
        const items = await trx
          .selectFrom(candidates)
          .selectAll()
          // sql.raw is safe here — orderDirection is validated to 'asc'|'desc' by the AssetOrder enum
          .orderBy(sql`"candidates"."fileCreatedAt" ${sql.raw(orderDirection)} nulls last`)
          .limit(pagination.size + 1)
          .offset((pagination.page - 1) * pagination.size)
          .execute();
        return paginationHelper(items as MapAsset[], pagination.size);
      }

      const items = await baseQuery
        .limit(pagination.size + 1)
        .offset((pagination.page - 1) * pagination.size)
        .execute();
      return paginationHelper(items, pagination.size);
    });
  }
```

Replace with:

```typescript
  searchSmart(pagination: SearchPaginationOptions, options: SmartSearchOptions) {
    if (!isValidInteger(pagination.size, { min: 1, max: 1000 })) {
      throw new Error(`Invalid value for 'size': ${pagination.size}`);
    }

    const hasDistanceThreshold = (options.maxDistance ?? 0) > 0 && (options.maxDistance ?? 0) < 2;

    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);

      const baseQuery = searchAssetBuilder(trx, options)
        .selectAll('asset')
        .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
        .$if(hasDistanceThreshold, (qb) =>
          qb.where(sql`(smart_search.embedding <=> ${options.embedding}) <= ${options.maxDistance!}`),
        )
        .orderBy(sql`smart_search.embedding <=> ${options.embedding}`);

      if (options.orderDirection) {
        const orderDirection = options.orderDirection.toLowerCase() as OrderByDirection;
        const candidates = baseQuery.limit(500).as('candidates');
        const items = await trx
          .selectFrom(candidates)
          .selectAll()
          // sql.raw is safe here — orderDirection is validated to 'asc'|'desc' by the AssetOrder enum
          .orderBy(sql`"candidates"."fileCreatedAt" ${sql.raw(orderDirection)} nulls last`)
          .limit(pagination.size + 1)
          .offset((pagination.page - 1) * pagination.size)
          .execute();
        return paginationHelper(items as MapAsset[], pagination.size);
      }

      const items = await baseQuery
        .limit(pagination.size + 1)
        .offset((pagination.page - 1) * pagination.size)
        .execute();
      return paginationHelper(items, pagination.size);
    });
  }
```

**Step 4: Verify types compile**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`

Expected: Clean compile.

**Step 5: Commit**

```bash
git add server/src/repositories/search.repository.ts
git commit -m "feat(search): apply maxDistance threshold in searchSmart query"
```

---

## Task 4: Search service — pass config to repository

**Files:**

- Modify: `server/src/services/search.service.ts:163-166`

**Step 1: Pass maxDistance from config**

Find (line 163-166):

```typescript
const { hasNextPage, items } = await this.searchRepository.searchSmart(
  { page, size },
  { ...dto, userIds: await userIds, embedding, orderDirection: dto.order },
);
```

Change to:

```typescript
const { hasNextPage, items } = await this.searchRepository.searchSmart(
  { page, size },
  {
    ...dto,
    userIds: await userIds,
    embedding,
    orderDirection: dto.order,
    maxDistance: machineLearning.clip.maxDistance,
  },
);
```

**Step 2: Verify types compile**

Run: `cd server && npx tsc --noEmit 2>&1 | head -20`

Expected: Clean compile.

**Step 3: Commit**

```bash
git add server/src/services/search.service.ts
git commit -m "feat(search): pass clip.maxDistance config to searchSmart repository"
```

---

## Task 5: Fix existing tests + add new service tests

**Files:**

- Modify: `server/src/services/search.service.spec.ts`

**Step 1: Fix the `'should work'` test**

Find (around line 607-610):

```typescript
expect(mocks.search.searchSmart).toHaveBeenCalledWith(
  { page: 1, size: 100 },
  { query: 'test', embedding: '[1, 2, 3]', userIds: [authStub.user1.user.id] },
);
```

Change to:

```typescript
expect(mocks.search.searchSmart).toHaveBeenCalledWith(
  { page: 1, size: 100 },
  { query: 'test', embedding: '[1, 2, 3]', userIds: [authStub.user1.user.id], maxDistance: 0 },
);
```

**Step 2: Add test for maxDistance passthrough (text query)**

Add **before** the closing `});` of the `searchSmart` describe block (line 797). The new tests go
inside the describe block, after the `'should not pass orderDirection when order is not set'` test:

```typescript
it('should pass maxDistance from config to repository', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { clip: { maxDistance: 0.75 } },
  });

  await sut.searchSmart(authStub.user1, { query: 'test' });

  expect(mocks.search.searchSmart).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ maxDistance: 0.75 }),
  );
});
```

**Step 3: Add test for maxDistance passthrough (queryAssetId)**

Add right after:

```typescript
it('should pass maxDistance from config when using queryAssetId', async () => {
  const assetId = newUuid();
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  mocks.search.getEmbedding.mockResolvedValue('[4, 5, 6]');
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { clip: { maxDistance: 0.75 } },
  });

  await sut.searchSmart(authStub.user1, { queryAssetId: assetId });

  expect(mocks.search.searchSmart).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ maxDistance: 0.75 }),
  );
});
```

**Step 4: Add test for disabled maxDistance (default 0)**

Add right after:

```typescript
it('should pass maxDistance 0 (disabled) by default', async () => {
  await sut.searchSmart(authStub.user1, { query: 'test' });

  expect(mocks.search.searchSmart).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxDistance: 0 }));
});
```

**Step 5: Run tests**

Run: `cd server && pnpm test -- --run src/services/search.service.spec.ts`

Expected: All tests pass. If any other tests have exact-match assertions on `searchSmart` args that break, update them to include `maxDistance: 0`.

**Step 6: Commit**

```bash
git add server/src/services/search.service.spec.ts
git commit -m "test(search): update and add tests for maxDistance config passthrough"
```

---

## Task 6: Admin UI — settings field

**Files:**

- Modify: `web/src/lib/components/admin-settings/MachineLearningSettings.svelte:144-146`

**Step 1: Add the maxDistance input field**

Find (line 144-146):

```svelte
          </SettingInputField>
        </div>
      </SettingAccordion>
```

(This is the closing of the model name input, the div, and the smart-search accordion.)

Replace with:

```svelte
          </SettingInputField>

          <SettingInputField
            inputType={SettingInputFieldType.NUMBER}
            label={$t('admin.machine_learning_clip_max_distance')}
            description={$t('admin.machine_learning_clip_max_distance_description')}
            bind:value={configToEdit.machineLearning.clip.maxDistance}
            step="0.05"
            min={0}
            max={2}
            disabled={disabled || !configToEdit.machineLearning.enabled || !configToEdit.machineLearning.clip.enabled}
            isEdited={configToEdit.machineLearning.clip.maxDistance !== config.machineLearning.clip.maxDistance}
          />
        </div>
      </SettingAccordion>
```

**Step 2: Commit**

Note: Skip svelte-check here — the web types depend on the regenerated `@immich/sdk` which
won't have `maxDistance` until Task 9. Type checking is deferred to Task 10 (final verification).

```bash
git add web/src/lib/components/admin-settings/MachineLearningSettings.svelte
git commit -m "feat(web): add max search distance setting to smart search admin panel"
```

---

## Task 7: i18n keys

**Files:**

- Modify: `i18n/en.json`

**Step 1: Add the two new keys**

Find (around line 158 — after `machine_learning_clip_model_description`):

```json
    "machine_learning_clip_model_description": "The name of a CLIP model listed <link>here</link>. Note that you must re-run the 'Smart Search' job for all images upon changing a model.",
```

Add after it:

```json
    "machine_learning_clip_max_distance": "Max search distance",
    "machine_learning_clip_max_distance_description": "Maximum cosine distance for smart search results. Lower values return fewer but more relevant results. Values below 0.3 will likely return no results. Set to 0 to disable (default). Recommended: 0.75",
```

**Step 2: Sort i18n keys**

Run: `pnpm --filter=immich-i18n format:fix`

This ensures keys are sorted correctly (required by CI).

**Step 3: Commit**

```bash
git add i18n/en.json
git commit -m "feat(i18n): add max search distance label and description"
```

---

## Task 8: Documentation

**Files:**

- Modify: `docs/docs/install/config-file.md`
- Modify: `docs/docs/features/searching.md`

**Step 1: Update config-file.md**

Find (around line 133-136):

```json
    "clip": {
      "enabled": true,
      "modelName": "ViT-B-32__openai"
    },
```

Change to:

```json
    "clip": {
      "enabled": true,
      "modelName": "ViT-B-32__openai",
      "maxDistance": 0
    },
```

**Step 2: Update searching.md**

Find the end of the "CLIP models" subsection. It ends with a `:::note` block and link references
around line 1200. Insert the new subsection **before** the link reference definitions at the bottom
(before the `[huggingface-clip]` line, around line 1202):

```markdown
### Relevance threshold

Smart search can optionally exclude results with low similarity to the search query. This prevents irrelevant photos from appearing when combining text search with metadata filters (e.g., searching "forest" filtered to a specific country that has no forest photos).

By default this is disabled (set to 0). To enable, set `machineLearning.clip.maxDistance` in Administration > Machine Learning > Smart Search, or in your config file.

| Value  | Behavior                                                                |
| ------ | ----------------------------------------------------------------------- |
| `0`    | Disabled (default). All results returned regardless of similarity.      |
| `0.5`  | Very strict. Only strong visual matches. May miss borderline results.   |
| `0.75` | Recommended. Good balance of relevance and recall.                      |
| `1.0`  | Permissive. Includes weaker matches. Useful for broad/abstract queries. |
```

**Step 3: Format docs**

Run: `npx prettier --write docs/docs/install/config-file.md docs/docs/features/searching.md`

**Step 4: Commit**

```bash
git add docs/docs/install/config-file.md docs/docs/features/searching.md
git commit -m "docs: add relevance threshold to config reference and searching guide"
```

---

## Task 9: Regenerate OpenAPI + SQL

**Files:**

- Various generated files in `open-api/`, `server/src/queries/`

**Step 1: Build the server**

Run: `cd server && pnpm build`

This is required before regenerating specs.

**Step 2: Regenerate OpenAPI specs**

Run: `cd server && pnpm sync:open-api`

Then: `make open-api`

This regenerates both TypeScript SDK and Dart client.

**Step 3: Regenerate SQL query docs**

Run: `make sql`

Note: This requires a running database. If no DB is available, manually apply the diff from CI later (per project memory `feedback_make_sql_no_db`).

**Step 4: Run type checks**

Run: `cd server && npx tsc --noEmit && cd ../web && npx svelte-check --tsconfig tsconfig.json 2>&1 | tail -20`

Expected: Clean compile for both server and web.

**Step 5: Commit all generated files**

```bash
git add open-api/ server/src/queries/ mobile/openapi/
git commit -m "chore: regenerate OpenAPI specs and SQL query docs"
```

---

## Task 10: Final verification

**Step 1: Run server tests**

Run: `cd server && pnpm test`

Expected: All tests pass.

**Step 2: Run web tests**

Run: `cd web && pnpm test`

Expected: All tests pass.

**Step 3: Run type checks**

Run: `make check-server && make check-web`

Expected: Clean.

**Step 4: Squash into PR branch and push**

Create a feature branch, squash all work commits, and push for PR creation.
