# Classification Rescan on Strictness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When an admin increases a classification category's similarity threshold, offer to remove existing auto-tags, unarchive affected photos, and rescan all photos.

**Architecture:** Add `rescan?: boolean` to the update DTO. When true, the service wipes `Auto/{name}` tag assignments, unarchives affected assets, and queues a full rescan. The web UI shows a confirmation dialog when similarity increases.

**Tech Stack:** NestJS, Kysely, PostgreSQL, SvelteKit, Svelte 5, Vitest

**Design doc:** `docs/plans/2026-03-30-classification-rescan-on-strictness-design.md`

---

### Task 1: Add `rescan` field to DTO

**Files:**

- Modify: `server/src/dtos/classification.dto.ts`

**Step 1: Add the field**

After the `enabled` field (line 60), add:

```typescript
  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Wipe existing auto-tags for this category and rescan all assets' })
  rescan?: boolean;
```

**Step 2: Commit**

```bash
git add server/src/dtos/classification.dto.ts
git commit -m "feat: add rescan field to classification update DTO"
```

---

### Task 2: Add `removeAutoTagAssignments` repository method (TDD)

**Files:**

- Modify: `server/src/repositories/classification.repository.ts`
- Modify: `server/test/medium/specs/repositories/classification.repository.spec.ts`

**Step 1: Write the failing medium tests**

Add to the `describe(ClassificationRepository.name)` block in the medium test file:

```typescript
describe('removeAutoTagAssignments', () => {
  it('should delete tag_asset rows for Auto/{name} tags and unarchive affected assets', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: asset1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: asset2 } = await ctx.newAsset({ ownerId: user.id });

    // Create Auto/Screenshots tag and assign to both assets
    const tag = await ctx.database
      .insertInto('tag')
      .values({ userId: user.id, value: 'Auto/Screenshots' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('tag_asset')
      .values([
        { tagId: tag.id, assetId: asset1.id },
        { tagId: tag.id, assetId: asset2.id },
      ])
      .execute();

    // Archive asset1 (simulating tag_and_archive)
    await ctx.database.updateTable('asset').set({ visibility: 'archive' }).where('id', '=', asset1.id).execute();

    await sut.removeAutoTagAssignments('Screenshots');

    // Verify tag_asset rows deleted
    const tagAssets = await ctx.database.selectFrom('tag_asset').selectAll().where('tagId', '=', tag.id).execute();
    expect(tagAssets).toHaveLength(0);

    // Verify asset1 unarchived
    const a1 = await ctx.database
      .selectFrom('asset')
      .select('visibility')
      .where('id', '=', asset1.id)
      .executeTakeFirstOrThrow();
    expect(a1.visibility).toBe('timeline');

    // Verify asset2 stayed at timeline (was never archived)
    const a2 = await ctx.database
      .selectFrom('asset')
      .select('visibility')
      .where('id', '=', asset2.id)
      .executeTakeFirstOrThrow();
    expect(a2.visibility).toBe('timeline');
  });

  it('should not affect other tags', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    // Create two tags
    const autoTag = await ctx.database
      .insertInto('tag')
      .values({ userId: user.id, value: 'Auto/Screenshots' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const manualTag = await ctx.database
      .insertInto('tag')
      .values({ userId: user.id, value: 'vacation' })
      .returning('id')
      .executeTakeFirstOrThrow();

    await ctx.database
      .insertInto('tag_asset')
      .values([
        { tagId: autoTag.id, assetId: asset.id },
        { tagId: manualTag.id, assetId: asset.id },
      ])
      .execute();

    await sut.removeAutoTagAssignments('Screenshots');

    // Auto tag removed
    const autoAssets = await ctx.database.selectFrom('tag_asset').selectAll().where('tagId', '=', autoTag.id).execute();
    expect(autoAssets).toHaveLength(0);

    // Manual tag untouched
    const manualAssets = await ctx.database
      .selectFrom('tag_asset')
      .selectAll()
      .where('tagId', '=', manualTag.id)
      .execute();
    expect(manualAssets).toHaveLength(1);
  });

  it('should be a no-op when no matching tags exist', async () => {
    const { sut } = setup();
    // Should not throw
    await expect(sut.removeAutoTagAssignments('NonExistent')).resolves.not.toThrow();
  });
});
```

**Step 2: Run to verify they fail**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/classification.repository.spec.ts`

Expected: FAIL — `removeAutoTagAssignments is not a function`

**Step 3: Implement the method**

Add to `classification.repository.ts` after `deletePromptEmbeddingsByCategory`:

```typescript
  async removeAutoTagAssignments(categoryName: string) {
    const tagValue = `Auto/${categoryName}`;

    // Find all tag IDs matching Auto/{categoryName} across all users
    const tags = await this.db
      .selectFrom('tag')
      .select('id')
      .where('value', '=', tagValue)
      .execute();

    if (tags.length === 0) {
      return;
    }

    const tagIds = tags.map((t) => t.id);

    // Find affected asset IDs before deleting
    const affectedAssets = await this.db
      .selectFrom('tag_asset')
      .select('assetId')
      .where('tagId', 'in', tagIds)
      .execute();

    const assetIds = affectedAssets.map((a) => a.assetId);

    // Unarchive affected assets
    if (assetIds.length > 0) {
      await this.db
        .updateTable('asset')
        .set({ visibility: AssetVisibility.Timeline })
        .where('id', 'in', assetIds)
        .where('visibility', '=', AssetVisibility.Archive)
        .execute();
    }

    // Delete tag-asset associations
    await this.db
      .deleteFrom('tag_asset')
      .where('tagId', 'in', tagIds)
      .execute();
  }
```

Add the import at top of file:

```typescript
import { AssetVisibility } from 'src/enum';
```

**Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/classification.repository.spec.ts`

Expected: All pass.

**Step 5: Commit**

```bash
git add server/src/repositories/classification.repository.ts server/test/medium/specs/repositories/classification.repository.spec.ts
git commit -m "feat: add removeAutoTagAssignments repository method"
```

---

### Task 3: Wire rescan into updateCategory service (TDD)

**Files:**

- Modify: `server/src/services/classification.service.ts`
- Modify: `server/src/services/classification.service.spec.ts`

**Step 1: Write the failing unit tests**

Add to the `describe('updateCategory')` block, after the existing tests:

```typescript
it('should wipe auto-tags and queue rescan when rescan is true', async () => {
  mocks.classification.getCategory.mockResolvedValue(existingCategory as any);
  mocks.classification.updateCategory.mockResolvedValue({ ...existingCategory, similarity: 0.9 } as any);
  mocks.classification.getPromptEmbeddings.mockResolvedValue([{ prompt: 'sunset sky' }] as any);
  mocks.classification.removeAutoTagAssignments.mockResolvedValue(void 0 as any);
  mocks.job.queue.mockResolvedValue(void 0 as any);

  await sut.updateCategory(authStub.user1, 'cat-1', { similarity: 0.9, rescan: true });

  expect(mocks.classification.removeAutoTagAssignments).toHaveBeenCalledWith('Sunsets');
  expect(mocks.job.queue).toHaveBeenCalledWith({
    name: JobName.AssetClassifyQueueAll,
    data: { force: true },
  });
});

it('should NOT wipe or rescan when rescan is false', async () => {
  mocks.classification.getCategory.mockResolvedValue(existingCategory as any);
  mocks.classification.updateCategory.mockResolvedValue({ ...existingCategory, similarity: 0.9 } as any);
  mocks.classification.getPromptEmbeddings.mockResolvedValue([{ prompt: 'sunset sky' }] as any);

  await sut.updateCategory(authStub.user1, 'cat-1', { similarity: 0.9, rescan: false });

  expect(mocks.classification.removeAutoTagAssignments).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalled();
});

it('should NOT wipe or rescan when rescan is undefined', async () => {
  mocks.classification.getCategory.mockResolvedValue(existingCategory as any);
  mocks.classification.updateCategory.mockResolvedValue({ ...existingCategory, similarity: 0.9 } as any);
  mocks.classification.getPromptEmbeddings.mockResolvedValue([{ prompt: 'sunset sky' }] as any);

  await sut.updateCategory(authStub.user1, 'cat-1', { similarity: 0.9 });

  expect(mocks.classification.removeAutoTagAssignments).not.toHaveBeenCalled();
  expect(mocks.job.queue).not.toHaveBeenCalled();
});

it('should use old category name for wipe when name also changes', async () => {
  mocks.classification.getCategory.mockResolvedValue(existingCategory as any);
  mocks.classification.updateCategory.mockResolvedValue({ ...existingCategory, name: 'New Name' } as any);
  mocks.classification.getPromptEmbeddings.mockResolvedValue([{ prompt: 'sunset sky' }] as any);
  mocks.classification.removeAutoTagAssignments.mockResolvedValue(void 0 as any);
  mocks.job.queue.mockResolvedValue(void 0 as any);

  await sut.updateCategory(authStub.user1, 'cat-1', { name: 'New Name', rescan: true });

  // Uses the OLD name "Sunsets" not the new name "New Name"
  expect(mocks.classification.removeAutoTagAssignments).toHaveBeenCalledWith('Sunsets');
});
```

**Step 2: Run to verify they fail**

Run: `cd server && pnpm test -- --run src/services/classification.service.spec.ts`

Expected: FAIL — `removeAutoTagAssignments` not called / `job.queue` not called

**Step 3: Implement the logic**

In `classification.service.ts`, in `updateCategory`, add after the prompts block and before the final `getPromptEmbeddings` call:

```typescript
if (dto.rescan) {
  await this.classificationRepository.removeAutoTagAssignments(existing.name);
  await this.jobRepository.queue({
    name: JobName.AssetClassifyQueueAll,
    data: { force: true },
  });
}
```

This goes after line 122 (after the prompts if-block closes) and before line 124 (`const promptRows`).

**Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/services/classification.service.spec.ts`

Expected: All pass.

**Step 5: Commit**

```bash
git add server/src/services/classification.service.ts server/src/services/classification.service.spec.ts
git commit -m "feat: wipe auto-tags and rescan when rescan flag is true"
```

---

### Task 4: Update web admin component with confirmation dialog

**Files:**

- Modify: `web/src/lib/components/admin-settings/ClassificationSettings.svelte`

**Step 1: Update `handleSave` to detect stricter similarity and show dialog**

In the `handleSave` function, in the `else if (editingId)` branch (around line 104-116), replace the direct `updateCategory` call with logic that checks similarity:

```typescript
      } else if (editingId) {
        const editedCategory = categories.find((c) => c.id === editingId);
        const isStricter = editedCategory && formSimilarity > editedCategory.similarity;
        const shouldRescan =
          isStricter &&
          confirm(
            'This category is now stricter. Would you like to remove existing auto-tags that may no longer match, unarchive affected photos, and rescan all photos?',
          );

        await updateCategory({
          id: editingId,
          classificationCategoryUpdateDto: {
            name: formName,
            prompts,
            similarity: formSimilarity,
            action: formAction,
            enabled: formEnabled,
            ...(shouldRescan ? { rescan: true } : {}),
          },
        });
        toastManager.primary(`Category "${formName}" updated`);
        if (shouldRescan) {
          toastManager.primary('Rescan started — existing auto-tags will be re-evaluated');
        }
      }
```

**Step 2: Commit**

```bash
git add web/src/lib/components/admin-settings/ClassificationSettings.svelte
git commit -m "feat: show confirmation dialog when similarity increases"
```

---

### Task 5: Add E2E test for rescan flag

**Files:**

- Modify: `e2e/src/specs/server/api/classification.e2e-spec.ts`

**Step 1: Add test**

Add to the `PUT /classification/categories/:id` describe block:

```typescript
it('should accept rescan flag on update', async () => {
  // Note: this test validates the API accepts the rescan field without error.
  // Full rescan behavior (tag wipe + re-classify) requires ML service.
  const { status } = await request(app)
    .put(`/classification/categories/${uuidDto.notFound}`)
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .send({ similarity: 0.5, rescan: true });
  // 404 because category doesn't exist, but validates the DTO accepts rescan
  expect(status).toBe(404);
});
```

**Step 2: Commit**

```bash
git add e2e/src/specs/server/api/classification.e2e-spec.ts
git commit -m "test: add E2E test for rescan flag on category update"
```

---

### Task 6: Regenerate OpenAPI + SQL, lint, format

**Step 1: Build server and regenerate**

```bash
cd server && pnpm build
cd server && pnpm sync:open-api
make open-api
```

**Step 2: Format and lint**

```bash
make format-server
make lint-server
make format-web
make lint-web
```

**Step 3: Type check**

```bash
make check-server
make check-web
```

**Step 4: Fix any issues, then commit**

```bash
git add -A
git commit -m "chore: regenerate OpenAPI specs, lint, and format"
```

---

### Task 7: Run full test suites

**Step 1: Server unit tests**

Run: `cd server && pnpm test`

Expected: All pass.

**Step 2: Web tests**

Run: `cd web && pnpm test`

Expected: All pass.

**Step 3: Server build**

Run: `cd server && pnpm build`

Expected: Clean build.
