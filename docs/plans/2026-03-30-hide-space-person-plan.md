# Hide Person from Space People Context Menu — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Hide person" option to the three-dot context menu on person cards in the space people page.

**Architecture:** Pure frontend change — add a menu item that calls the existing `updateSpacePerson` API with `{ isHidden: true }`, then update local state so the `visiblePeople` derived filters out the hidden person. One E2E test using direct DB setup.

**Tech Stack:** Svelte 5, @immich/sdk, Playwright, PostgreSQL (direct insert for test setup)

---

### Task 1: Add "Hide person" menu item and handler

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte`

**Step 1: Add imports**

Add `mdiEyeOffOutline` to the `@mdi/js` import (line 21-27) and `toastManager` to the `@immich/ui` import (line 20):

```diff
-  import { Button, Icon, IconButton } from '@immich/ui';
+  import { Button, Icon, IconButton, toastManager } from '@immich/ui';
   import {
     mdiAccountGroupOutline,
     mdiAccountMultipleCheckOutline,
     mdiArrowLeft,
     mdiDotsVertical,
+    mdiEyeOffOutline,
     mdiEyeOutline,
   } from '@mdi/js';
```

**Step 2: Add the handler function**

Add after the `handleMerge` function (after line 172):

```typescript
async function handleHide(person: SharedSpacePersonResponseDto) {
  try {
    await updateSpacePerson({
      id: space.id,
      personId: person.id,
      sharedSpacePersonUpdateDto: { isHidden: true },
    });
    const idx = people.findIndex((p) => p.id === person.id);
    if (idx !== -1) {
      people[idx] = { ...people[idx], isHidden: true };
    }
    toastManager.primary($t('changed_visibility_successfully'));
  } catch (error) {
    handleError(error, $t('errors.unable_to_hide_person'));
  }
}
```

**Step 3: Add the menu item**

Inside the `ButtonContextMenu` (line 258-263), add a `MenuOption` before the existing "Merge people" option:

```svelte
<MenuOption
  onClick={() => handleHide(person)}
  icon={mdiEyeOffOutline}
  text={$t('hide_person')}
/>
<MenuOption
  onClick={() => handleMerge(person.id)}
  icon={mdiAccountMultipleCheckOutline}
  text={$t('merge_people')}
/>
```

**Step 4: Verify it compiles**

Run: `cd web && pnpm check`
Expected: No errors

**Step 5: Commit**

```bash
git add web/src/routes/\(user\)/spaces/\[spaceId\]/people/+page.svelte
git commit -m "feat: add hide person option to space people context menu"
```

---

### Task 2: Add `createSpacePerson` helper to E2E utils

**Files:**

- Modify: `e2e/src/utils.ts`

**Step 1: Add the helper**

Add a `createSpacePerson` method to the `utils` object, after the `createPet` method (around line 542). Follow the same pattern as `createPet` (lines 529-542):

```typescript
createSpacePerson: async (spaceId: string, name: string) => {
  if (!client) {
    throw new Error('Database client not connected');
  }
  const result = await client.query(
    `INSERT INTO shared_space_person ("spaceId", name, "isHidden", "faceCount", "assetCount")
     VALUES ($1, $2, false, 1, 1) RETURNING id`,
    [spaceId, name],
  );
  return result.rows[0].id as string;
},
```

**Note:** The space person will have no `representativeFaceId`, so the thumbnail endpoint will 404. This is fine — the person card still renders (just with a placeholder), which is sufficient for testing the hide action.

**Step 2: Verify it compiles**

Run: `cd e2e && npx tsc --noEmit`
Expected: No errors

---

### Task 3: Add E2E test for hiding a space person

**Files:**

- Create: `e2e/src/specs/web/spaces-people.e2e-spec.ts`

**Step 1: Write the E2E test**

Space people are created by ML face detection — there's no creation API. The test uses the `createSpacePerson` helper from Task 2 to insert directly into the database.

```typescript
import type { LoginResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('Spaces People', () => {
  let admin: LoginResponseDto;
  let space: SharedSpaceResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Create a space with an asset
    space = await utils.createSpace(admin.accessToken, { name: 'People Test Space' });
    const asset = await utils.createAsset(admin.accessToken);
    await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

    // Insert a space person directly (no ML needed)
    await utils.createSpacePerson(space.id, 'Alice');
  });

  async function gotoSpacePeople(
    context: import('@playwright/test').BrowserContext,
    page: import('@playwright/test').Page,
  ) {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/spaces/${space.id}/people`);
    await page.waitForSelector('[role="group"]');
  }

  test('should hide person from context menu', async ({ context, page }) => {
    await gotoSpacePeople(context, page);

    // Verify person is visible
    const personCard = page.locator('[role="group"]').first();
    await expect(personCard).toBeVisible();

    // Hover to reveal context menu
    await personCard.hover();

    // Click three-dot menu
    await page.getByTitle('Show person options').click();

    // Click "Hide person"
    await page.getByText('Hide person').click();

    // Verify person disappears and empty state shows
    await expect(page.getByText('No people')).toBeVisible();
  });
});
```

**Step 2: Run the test locally (if E2E stack is available)**

Run: `cd e2e && pnpm test:web -- --grep "hide person"`
Expected: PASS

**Step 3: Commit**

```bash
git add e2e/src/utils.ts e2e/src/specs/web/spaces-people.e2e-spec.ts
git commit -m "test: e2e test for hiding person from space people menu"
```
