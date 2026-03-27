# Video Trim Download Fix & Edited Indicator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix downloading trimmed videos (returns JPEG instead of MP4) and add an "Edited" badge in the asset viewer.

**Architecture:** Server-side query fix in `buildGetForOriginal` to prefer `EncodedVideo` over `FullSize` for edited files, plus a UI badge in the asset viewer nav bar.

**Tech Stack:** Kysely (SQL query builder), Svelte 5, `@immich/ui`, `@mdi/js` icons

---

### Task 1: Fix `buildGetForOriginal` query to return trimmed video instead of still frame

**Files:**

- Modify: `server/src/repositories/asset.repository.ts:1256-1273`

**Step 1: Write the fix**

Replace the current `buildGetForOriginal` method. The current LEFT JOIN filters `type = FullSize`, which returns the extracted JPEG frame for trimmed videos instead of the trimmed MP4 (`EncodedVideo`). Replace with a correlated subquery that checks both types, prioritizing `EncodedVideo`:

```typescript
private buildGetForOriginal(ids: string[], isEdited: boolean) {
  return this.db
    .selectFrom('asset')
    .select('asset.id')
    .select('originalFileName')
    .where('asset.id', 'in', ids)
    .$if(isEdited, (qb) =>
      qb.select((eb) =>
        eb
          .selectFrom('asset_file')
          .select('asset_file.path')
          .whereRef('asset_file.assetId', '=', 'asset.id')
          .where('asset_file.isEdited', '=', true)
          .where('asset_file.type', 'in', [AssetFileType.FullSize, AssetFileType.EncodedVideo])
          .orderBy(
            sql`case when ${sql.ref('asset_file.type')} = ${AssetFileType.EncodedVideo} then 0 else 1 end`,
          )
          .limit(1)
          .as('editedPath'),
      ),
    )
    .select('originalPath');
}
```

Note: The `sql` import comes from `kysely`. Check the existing imports at the top of `asset.repository.ts` — it should already be imported. If not, add `import { sql } from 'kysely';`.

The `getForVideo` method at line 1299 uses a similar subquery pattern for reference.

**Step 2: Regenerate SQL query docs**

Run: `cd server && pnpm build && pnpm sync:sql`

This updates `server/src/queries/asset.repository.sql` with the new query shape. Verify the generated SQL for `getForOriginal` now contains the subquery with the CASE expression.

**Step 3: Run server unit tests**

Run: `cd server && pnpm test -- --run src/services/asset-media.service.spec.ts src/services/download.service.spec.ts`

Expected: All existing tests pass. The tests mock `getForOriginal`/`getForOriginals` return values, so the query change doesn't break them — they test the service layer, not the repository.

**Step 4: Commit**

```bash
git add server/src/repositories/asset.repository.ts server/src/queries/asset.repository.sql
git commit -m "fix: download trimmed video returns video instead of still frame"
```

---

### Task 2: Add "Edited" badge to asset viewer nav bar

**Files:**

- Modify: `web/src/lib/components/asset-viewer/asset-viewer-nav-bar.svelte:43-50,114`
- Modify: `i18n/en.json` (add "edited" key)

**Step 1: Add the i18n translation key**

In `i18n/en.json`, find the `"edit"` key (line 993) and add `"edited"` nearby in alphabetical order:

```json
"edited": "Edited",
```

**Step 2: Add the badge to the nav bar**

In `web/src/lib/components/asset-viewer/asset-viewer-nav-bar.svelte`:

First, add the `mdiPencilOutline` import. In the existing `@mdi/js` import block (line 43-50), add `mdiPencilOutline`:

```typescript
import {
  mdiArrowLeft,
  mdiArrowRight,
  mdiCompare,
  mdiDotsVertical,
  mdiImageSearch,
  mdiPencilOutline,
  mdiPresentationPlay,
  mdiVideoOutline,
} from '@mdi/js';
```

Then add the `Icon` import from `@immich/ui`. Find the existing `@immich/ui` import (line 41) and add `Icon`:

```typescript
import { ActionButton, CommandPaletteDefaultProvider, Icon, Tooltip, type ActionItem } from '@immich/ui';
```

Then add the badge as the first element inside the right-side action div (after line 114, before the loading dots `{#if}`):

```svelte
{#if asset.isEdited}
  <div class="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs text-white">
    <Icon icon={mdiPencilOutline} size="14" />
    <span>{$t('edited')}</span>
  </div>
{/if}
```

**Step 3: Run the web unit tests**

Run: `cd web && pnpm test -- --run src/lib/components/asset-viewer/asset-viewer-nav-bar.spec.ts`

Expected: Existing tests pass (badge won't show since `isEdited` defaults to `false` in the factory).

**Step 4: Commit**

```bash
git add web/src/lib/components/asset-viewer/asset-viewer-nav-bar.svelte i18n/en.json
git commit -m "feat: add edited badge to asset viewer nav bar"
```

---

### Task 3: Add unit test for the edited badge

**Files:**

- Modify: `web/src/lib/components/asset-viewer/asset-viewer-nav-bar.spec.ts`

**Step 1: Write the test**

Add two test cases to the existing describe block in `asset-viewer-nav-bar.spec.ts`:

```typescript
it('shows edited badge when asset is edited', () => {
  const prefs = preferencesFactory.build({ cast: { gCastEnabled: false } });
  preferencesStore.set(prefs);

  const asset = assetFactory.build({ isEdited: true, isTrashed: false });
  const { getByText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
  expect(getByText('edited')).toBeInTheDocument();
});

it('does not show edited badge when asset is not edited', () => {
  const prefs = preferencesFactory.build({ cast: { gCastEnabled: false } });
  preferencesStore.set(prefs);

  const asset = assetFactory.build({ isEdited: false, isTrashed: false });
  const { queryByText } = renderWithTooltips(AssetViewerNavBar, { asset, ...additionalProps });
  expect(queryByText('edited')).not.toBeInTheDocument();
});
```

**Step 2: Run the test**

Run: `cd web && pnpm test -- --run src/lib/components/asset-viewer/asset-viewer-nav-bar.spec.ts`

Expected: All tests pass, including the two new ones.

**Step 3: Commit**

```bash
git add web/src/lib/components/asset-viewer/asset-viewer-nav-bar.spec.ts
git commit -m "test: add edited badge visibility tests for asset viewer nav bar"
```

---

### Task 4: Lint and type-check

**Step 1: Run server lint and type-check**

Run: `cd server && npx tsc --noEmit`

Expected: No type errors.

**Step 2: Run web lint and type-check**

Run: `make check-web`

Expected: No errors from svelte-check or tsc.

**Step 3: Run prettier on changed files**

Run: `npx prettier --write server/src/repositories/asset.repository.ts web/src/lib/components/asset-viewer/asset-viewer-nav-bar.svelte web/src/lib/components/asset-viewer/asset-viewer-nav-bar.spec.ts i18n/en.json`

**Step 4: Run ESLint on changed files**

Run: `cd server && npx eslint src/repositories/asset.repository.ts --max-warnings 0`
Run: `cd web && npx eslint src/lib/components/asset-viewer/asset-viewer-nav-bar.svelte src/lib/components/asset-viewer/asset-viewer-nav-bar.spec.ts --max-warnings 0`

**Step 5: Commit any formatting fixes**

```bash
git add -u && git diff --cached --quiet || git commit -m "style: format changed files"
```
