# Space Asset Add Limit — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Limit the number of assets that can be added/removed from a shared space in a single request to 10,000, with server-side validation and a frontend warning.

**Architecture:** Add `@ArrayMaxSize(10_000)` to both add and remove DTOs for server-side enforcement. On the frontend, disable the "Add" button and show a red warning when selection exceeds the limit.

**Tech Stack:** class-validator (server), Svelte 5 (web), vitest + @testing-library/svelte (tests)

---

### Task 1: Write DTO Validation Tests

**Files:**

- Create: `server/src/dtos/shared-space.dto.spec.ts`
- Reference: `server/src/dtos/shared-space.dto.ts:216-224`
- Pattern: `server/src/dtos/user.dto.spec.ts` (existing DTO test)

**Step 1: Write the failing tests**

Create `server/src/dtos/shared-space.dto.spec.ts`:

```typescript
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SharedSpaceAssetAddDto, SharedSpaceAssetRemoveDto } from 'src/dtos/shared-space.dto';

const makeUUIDs = (count: number) =>
  Array.from({ length: count }, (_, i) => `3fe388e4-2078-44d7-b36c-39d9dee3a65${String(i).padStart(1, '0')}`);

describe('SharedSpaceAssetAddDto', () => {
  it('should accept 10,000 asset IDs', async () => {
    const dto = plainToInstance(SharedSpaceAssetAddDto, {
      assetIds: makeUUIDs(10_000),
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject more than 10,000 asset IDs', async () => {
    const dto = plainToInstance(SharedSpaceAssetAddDto, {
      assetIds: makeUUIDs(10_001),
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('SharedSpaceAssetRemoveDto', () => {
  it('should accept 10,000 asset IDs', async () => {
    const dto = plainToInstance(SharedSpaceAssetRemoveDto, {
      assetIds: makeUUIDs(10_000),
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject more than 10,000 asset IDs', async () => {
    const dto = plainToInstance(SharedSpaceAssetRemoveDto, {
      assetIds: makeUUIDs(10_001),
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

Note: The `makeUUIDs` helper generates unique UUIDs by varying the last characters. For 10,000+ UUIDs, use `crypto.randomUUID()` or a counter-based approach that produces valid v4 UUIDs. Adjust as needed if the `ValidateUUID` decorator validates format strictly.

**Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/dtos/shared-space.dto.spec.ts`

Expected: The "should reject" tests FAIL (no `@ArrayMaxSize` yet, so validation passes for any array size).

**Step 3: Commit the failing tests**

```bash
git add server/src/dtos/shared-space.dto.spec.ts
git commit -m "test: add DTO validation tests for space asset limits"
```

---

### Task 2: Implement Server-Side Limit

**Files:**

- Modify: `server/src/dtos/shared-space.dto.ts:216-224`

**Step 1: Add the ArrayMaxSize decorator**

In `server/src/dtos/shared-space.dto.ts`, add the import and decorator:

```typescript
// Add to existing imports from 'class-validator':
import { ArrayMaxSize } from 'class-validator';
```

Then add the constant and decorators:

```typescript
export const MAX_SPACE_ASSETS_PER_REQUEST = 10_000;

export class SharedSpaceAssetAddDto {
  @ValidateUUID({ each: true, description: 'Asset IDs' })
  @ArrayMaxSize(MAX_SPACE_ASSETS_PER_REQUEST)
  assetIds!: string[];
}

export class SharedSpaceAssetRemoveDto {
  @ValidateUUID({ each: true, description: 'Asset IDs' })
  @ArrayMaxSize(MAX_SPACE_ASSETS_PER_REQUEST)
  assetIds!: string[];
}
```

**Step 2: Run the tests**

Run: `cd server && pnpm test -- --run src/dtos/shared-space.dto.spec.ts`

Expected: All 4 tests PASS.

**Step 3: Run lint and format**

Run: `cd server && npx prettier --write src/dtos/shared-space.dto.ts src/dtos/shared-space.dto.spec.ts && npx eslint --fix src/dtos/shared-space.dto.ts src/dtos/shared-space.dto.spec.ts`

**Step 4: Commit**

```bash
git add server/src/dtos/shared-space.dto.ts server/src/dtos/shared-space.dto.spec.ts
git commit -m "feat: add 10,000 asset limit to shared space add/remove DTOs"
```

---

### Task 3: Add i18n Key

**Files:**

- Modify: `i18n/en.json`

**Step 1: Add the warning message key**

Add to `i18n/en.json` (alphabetical placement):

```json
"space_asset_limit_warning": "Import your photos as an external library or use the Add All Photos background job. See the <link>documentation</link> for more info."
```

Note: Use the `<link>` tag pattern if the project's i18n library supports rich text interpolation. Otherwise use a plain string with the full URL. Check how other keys with links are handled in the codebase.

**Step 2: Commit**

```bash
git add i18n/en.json
git commit -m "feat: add i18n key for space asset limit warning"
```

---

### Task 4: Write Frontend Warning Test

**Files:**

- Create: `web/src/routes/(user)/spaces/space-asset-selection.spec.ts` (or co-locate with the page)
- Reference: `web/src/lib/components/spaces/space-hero.spec.ts` (test patterns)
- Reference: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:885-909` (selection control bar)

**Step 1: Write the failing test**

The space page is complex with many dependencies. The warning banner and disabled button should be testable by:

1. Adding a `data-testid="asset-limit-warning"` to the warning banner
2. Adding a `data-testid="add-assets-button"` to the add button in the selection control bar

Write a test that verifies:

- When `selectedAssets.length > 10_000`, the warning banner is visible and the add button is disabled
- When `selectedAssets.length <= 10_000`, no warning and button is enabled

Note: If the page component is too complex to render in isolation (common for route pages with many dependencies), consider extracting the warning logic into a small component or testing it at a higher level. The implementer should check if the existing page can be rendered in tests — if not, a simpler approach is to add the warning as a standalone component `SpaceAssetLimitWarning.svelte` that takes `selectedCount` as a prop and is independently testable.

**Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run <test-file-path>`

Expected: FAIL (component/warning doesn't exist yet).

**Step 3: Commit the failing test**

```bash
git add web/src/...
git commit -m "test: add space asset limit warning test"
```

---

### Task 5: Implement Frontend Warning

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte:885-909`

**Step 1: Add the constant and warning logic**

At the top of the script section, add:

```typescript
const MAX_SPACE_ASSETS_PER_REQUEST = 10_000;
```

**Step 2: Add the warning banner in the selection control bar**

In the `{#if viewMode === 'select-assets'}` block (around line 885), add a warning banner between the `ControlAppBar` and the timeline. The exact placement:

```svelte
{#if viewMode === 'select-assets'}
  <ControlAppBar onClose={handleCloseSelectAssets}>
    {#snippet leading()}
      <p class="text-lg dark:text-immich-dark-fg">
        {#if !timelineInteraction.selectionActive}
          {$t('add_to_space')}
        {:else}
          {$t('selected_count', { values: { count: timelineInteraction.selectedAssets.length } })}
        {/if}
      </p>
    {/snippet}

    {#snippet trailing()}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        aria-label={$t('add_to_space')}
        onclick={handleAddAssets}
        icon={mdiPlus}
        disabled={!timelineInteraction.selectionActive || timelineInteraction.selectedAssets.length > MAX_SPACE_ASSETS_PER_REQUEST}
        data-testid="add-assets-button"
      />
    {/snippet}
  </ControlAppBar>

  {#if timelineInteraction.selectedAssets.length > MAX_SPACE_ASSETS_PER_REQUEST}
    <div
      class="mx-4 mt-2 rounded-lg bg-red-100 p-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200"
      data-testid="asset-limit-warning"
    >
      {$t('space_asset_limit_warning', {
        link: (text) => `<a href="https://github.com/open-noodle/gallery/blob/main/docs/docs/features/shared-spaces.md#got-a-lot-of-photos" class="underline" target="_blank" rel="noopener">${text}</a>`,
      })}
    </div>
  {/if}
{/if}
```

Note: The exact i18n interpolation syntax for the link depends on what the project uses (svelte-i18n, paraglide, etc.). The implementer should check how links are rendered in other translated strings and follow the same pattern.

**Step 3: Run the tests**

Run: `cd web && pnpm test -- --run <test-file-path>`

Expected: All tests PASS.

**Step 4: Run lint and format**

Run: `cd web && npx prettier --write src/routes/\(user\)/spaces/\[spaceId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte && npx eslint --fix src/routes/\(user\)/spaces/\[spaceId\]/\[\[photos=photos\]\]/\[\[assetId=id\]\]/+page.svelte`

**Step 5: Commit**

```bash
git add web/src/routes/ i18n/en.json
git commit -m "feat: show warning and disable add button when space asset limit exceeded"
```

---

### Task 6: Regenerate OpenAPI Spec

The `@ArrayMaxSize` decorator is reflected in the OpenAPI spec as `maxItems`. Regenerate to keep specs in sync.

**Step 1: Regenerate**

Run: `cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api`

**Step 2: Verify the spec includes maxItems**

Check `open-api/immich-openapi-specs.json` for `SharedSpaceAssetAddDto` — it should now have `"maxItems": 10000` on the `assetIds` array.

**Step 3: Commit**

```bash
git add open-api/ mobile/openapi/
git commit -m "chore: regenerate OpenAPI specs with asset limit maxItems"
```

---

### Task 7: Final Verification

**Step 1: Run all server tests**

Run: `cd server && pnpm test`

**Step 2: Run all web tests**

Run: `cd web && pnpm test`

**Step 3: Run lint and format checks**

Run: `make check-server && make check-web && make lint-server && make lint-web`
