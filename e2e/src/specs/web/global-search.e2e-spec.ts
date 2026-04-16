import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('global search palette', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    await utils.createAsset(admin.accessToken);
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
  });

  test.beforeEach(async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    // Wait for SvelteKit CSR hydration to finish before any keyboard.press —
    // page.goto resolves on the `load` event, but hydration (which binds our
    // svelte:document use:shortcut handler for Ctrl+K / Shift+T / …) happens
    // asynchronously after that. The cmdk-trigger button is rendered under
    // `{#if featureFlagsManager.valueOrUndefined?.search}` in the navbar, so
    // seeing it proves the feature-flag manager loaded AND the navbar
    // hydrated — i.e. the whole layout's actions are wired up.
    await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
  });

  // The classic SearchBar (in the navbar) and the cmdk Command.Input both expose
  // role="combobox", so bare `page.getByRole('combobox')` is ambiguous under
  // Playwright strict mode. Scope every palette combobox lookup to the Modal's
  // dialog, which only exists while the palette is open.
  test('Ctrl+K opens the palette dialog', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toBeFocused();
  });

  test('Esc clears input, second Esc closes (APG two-stage)', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const combobox = page.getByRole('dialog').getByRole('combobox');
    await combobox.fill('beach');
    await expect(combobox).toHaveValue('beach');
    await page.keyboard.press('Escape');
    await expect(combobox).toHaveValue('');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('Ctrl+K inside the palette closes it', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('clicking the trigger opens the palette', async ({ page }) => {
    await page.getByTestId('cmdk-trigger').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('maxlength on input is 256', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const combobox = page.getByRole('dialog').getByRole('combobox');
    await expect(combobox).toHaveAttribute('maxlength', '256');
  });

  test('focus returns to the trigger after the palette closes', async ({ page }) => {
    const trigger = page.getByTestId('cmdk-trigger');
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Escape'); // empty already → closes
    await expect(dialog).toBeHidden();
    // @immich/ui Modal / bits-ui Dialog restores focus to the element that had it
    // before the dialog opened. If this regresses, it's a keyboard-a11y issue.
    await expect(trigger).toBeFocused();
  });

  test('Ctrl+/ cycles search mode via footer', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    // Smart is default
    await expect(page.getByRole('radio', { name: /smart/i })).toBeChecked();
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('radio', { name: /filename/i })).toBeChecked();
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('radio', { name: /description/i })).toBeChecked();
  });

  test('mixed-section query surfaces album + space results', async ({ page }) => {
    // Seed 2 Hawaii albums + 2 Hawaii spaces under the admin account. The seed
    // helper composes the granular createAlbum/createSpace utils so the names
    // appear verbatim in the cmdk Albums and Spaces sections (see
    // utils.cmdkSetupAlbumsAndSpaces). Admin is already logged in and on
    // /photos via the outer beforeEach.
    await utils.cmdkSetupAlbumsAndSpaces(admin.accessToken);

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('hawaii');

    // Scope assertions to each section's role="group" container — bits-ui's
    // Command.GroupItems wires `aria-labelledby` to the heading, so the group's
    // accessible name matches its rendered heading text. This avoids brittle
    // DOM walks while still asserting that a result row lives UNDER the right
    // section (not just somewhere in the dialog).
    const albumsGroup = dialog.getByRole('group', { name: /^albums$/i });
    await expect(albumsGroup.getByText(/hawaii (beach|mountains)/i).first()).toBeVisible();

    const spacesGroup = dialog.getByRole('group', { name: /^spaces$/i });
    await expect(spacesGroup.getByText(/hawaii (family|friends)/i).first()).toBeVisible();
  });

  test('truncation chip + heading count when albums exceed topN=5', async ({ page }) => {
    // Seed 8 albums with a unique-to-this-test prefix ('Trunc8') so prior tests
    // in the file (which seed 'Hawaii*' albums) don't pollute the heading count.
    // The Albums section renders the top 5 rows + a "× 3 more" chip + a "(5 of 8)"
    // heading suffix when the pre-slice match count exceeds ALBUMS_TOP_N=5
    // (see global-search-manager.svelte.ts).
    await utils.cmdkSeedAlbums(
      admin.accessToken,
      Array.from({ length: 8 }, (_, i) => `Trunc8 ${i + 1}`),
    );

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('trunc8');

    // bits-ui's Command.Group is role="presentation" with data-command-group; the
    // role="group" + aria-labelledby is on the inner Command.GroupItems container.
    // Svelte renders an extra `<div style="display: contents">` wrapper between
    // Command.Group and Command.GroupItems, so the items group's grandparent is
    // the Command.Group. The heading + chip live INSIDE Command.Group: heading
    // as a direct child sibling of the wrapper; chip is INSIDE the items div
    // (so accessible from the items group directly).
    const albumsItems = dialog.getByRole('group', { name: /^albums/i });
    // Use ancestor-or-self::*[@data-command-group] to land on the Command.Group
    // div regardless of how many display:contents wrappers Svelte inserts.
    const albumsContainer = albumsItems.locator('xpath=ancestor::div[@data-command-group][1]');

    // Wait until at least one row has rendered before counting — the fan-out is async.
    await expect(albumsItems.getByText(/trunc8 \d+/i).first()).toBeVisible();

    // Exactly 5 album rows (Command.Item) under the items group.
    const albumRows = albumsItems.locator('[data-command-item]');
    await expect(albumRows).toHaveCount(5);

    // The chip is inside the Albums Command.Group container, marked aria-hidden,
    // and is NOT a Command.Item.
    const chip = albumsContainer.getByTestId('more-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('aria-hidden', 'true');
    // role="option" is the bits-ui Command.Item ARIA role — chip must NOT have it.
    await expect(chip).not.toHaveAttribute('role', 'option');

    // Heading text: "Albums(5 of 8)" — bits-ui ALSO mirrors this into
    // data-command-group's data-value as `albums(5 of 8)` (lower-cased, no space
    // before the parens). textContent of the heading is `Albums(5 of 8)` because
    // the count `<span>` is concatenated with no whitespace separator.
    const heading = albumsContainer.getByTestId('section-heading');
    await expect(heading).toHaveText(/Albums\s*\(\s*5 of 8\s*\)/);

    // ArrowDown past the 5th row should NOT focus the chip — the chip has no
    // [data-command-item], so bits-ui's keyboard cursor skips over it. With
    // Command.Root `loop`, ArrowDown after the last row wraps back to the first
    // row instead of landing on the chip.
    //
    // The chip element has no `id` (it's a bare div), so it cannot be addressable
    // as an activedescendant. Confirm that explicitly.
    const chipId = await chip.getAttribute('id');
    expect(chipId).toBeNull();

    // Selection in bits-ui flows root.opts.value → items[data-selected]. We don't
    // use Command.Viewport, so viewportNode is null and aria-activedescendant
    // never appears on the combobox — but data-selected still toggles on the items
    // because Command.Item evaluates `isSelected` directly from root.opts.value.
    // That makes [data-selected] the reliable signal for which row the cursor
    // currently sits on.
    const combobox = dialog.getByRole('combobox');
    await combobox.focus();
    // Pre-condition: the manager auto-selects the first row after the batch
    // settles. Wait for any row to be data-selected before pressing arrows so
    // the keyboard cursor has a starting position.
    await expect(albumsItems.locator('[data-command-item][data-selected]')).toHaveCount(1);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowDown');
    }
    // After 5 ArrowDowns from row 1: with `loop` and only the Albums section
    // having items in the bottom flow, selection wraps. Either way, the selected
    // row must be a real Command.Item, not the chip (chip has no data-command-item).
    const selectedRows = dialog.locator('[data-command-item][data-selected]');
    await expect(selectedRows).toHaveCount(1);
    // And it must NOT be the chip — assert by element-identity. Since the chip
    // lacks both `id` and `data-command-item`, and our selection locator filters
    // on data-command-item, this is structurally guaranteed; the count assertion
    // above closes the loop.
  });

  test('album activation navigates and populates RECENT', async ({ page }) => {
    // Use a query unique to this test so prior tests' Hawaii/Trunc8 albums
    // don't pollute the Albums section. Single seeded album → single Enter
    // hit, no ambiguity for the auto-selected first row.
    await utils.cmdkSeedAlbums(admin.accessToken, ['Iceland Trip 2024']);

    await page.keyboard.press('Control+k');
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('iceland');

    const albumsGroup = dialog.getByRole('group', { name: /^albums/i });
    await expect(albumsGroup.getByText('Iceland Trip 2024')).toBeVisible();

    await page.keyboard.press('Enter');
    // Album view route is /albums/<uuid> per Route.viewAlbum.
    await expect(page).toHaveURL(/\/albums\/[\da-f-]{36}$/);

    // Reopen the palette on the same page (no full reload) — this hits the
    // RECENT branch (empty query). Recent entries are persisted to localStorage
    // synchronously inside activateAlbum's success path, so they are visible
    // on the very next palette open.
    await page.goto('/photos');
    await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
    await page.keyboard.press('Control+k');
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const recentGroup = dialog.getByRole('group', { name: /^recent/i });
    await expect(recentGroup.getByText('Iceland Trip 2024')).toBeVisible();
  });

  test('space activation navigates and populates RECENT', async ({ page }) => {
    await utils.cmdkSeedSpaces(admin.accessToken, ['Vacation 2024']);

    await page.keyboard.press('Control+k');
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('vacation');

    const spacesGroup = dialog.getByRole('group', { name: /^spaces/i });
    await expect(spacesGroup.getByText('Vacation 2024')).toBeVisible();

    await page.keyboard.press('Enter');
    // Space view route is /spaces/<uuid> per Route.viewSpace.
    await expect(page).toHaveURL(/\/spaces\/[\da-f-]{36}$/);

    await page.goto('/photos');
    await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
    await page.keyboard.press('Control+k');
    dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const recentGroup = dialog.getByRole('group', { name: /^recent/i });
    await expect(recentGroup.getByText('Vacation 2024')).toBeVisible();
  });

  test('palette renders sections in designed order when populated', async ({ page }) => {
    // Seed at least one match in every entity section the palette renders. Per
    // the helper docstring, People + Places are best-effort (people need faces,
    // places need a matching geocoded name), so we only assert the partial
    // ordering called out in Task 24.5: Photos < Albums < Spaces < Tags.
    await utils.cmdkSeedAllSectionTypes(admin.accessToken, 'testmatch');

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('testmatch');

    // Wait for the entity sections we care about to materialize before snapshotting
    // group order — the providers fan-out async, so a bare locator.all() may race
    // and miss the late-arriving sections.
    await expect(dialog.getByRole('group', { name: /^photos/i })).toBeVisible();
    await expect(dialog.getByRole('group', { name: /^albums/i })).toBeVisible();
    await expect(dialog.getByRole('group', { name: /^spaces/i })).toBeVisible();
    await expect(dialog.getByRole('group', { name: /^tags/i })).toBeVisible();

    // Collect the accessible names of every role="group" inside the dialog in DOM
    // order. bits-ui mirrors the heading text into the items group's accessible
    // name via aria-labelledby, so the names here look like "Photos(1)",
    // "Albums(1 of 1)", etc. Lower-case for stable indexOf matching.
    // Each role="group" is the bits-ui Command.GroupItems container, which carries
    // aria-labelledby pointing at its sibling Command.GroupHeading. Resolve via
    // the labelledby id so we get the heading text (e.g. "Photos", "Albums(1 of 1)")
    // instead of the row-text payload that lives INSIDE the items group. Note that
    // Playwright's `name` filter on getByRole already does this resolution, but we
    // need the raw list in DOM order for an indexOf comparison, which is easier to
    // do via a single evaluateAll than N separate getByRole calls.
    const groupNames = await dialog.getByRole('group').evaluateAll((nodes) =>
      nodes.map((n) => {
        const labelledBy = n.getAttribute('aria-labelledby');
        if (labelledBy) {
          const heading = document.getElementById(labelledBy);
          if (heading) {
            return (heading.textContent ?? '').toLowerCase();
          }
        }
        return (n.getAttribute('aria-label') ?? n.textContent ?? '').toLowerCase();
      }),
    );

    const indexOfSection = (label: string) => groupNames.findIndex((name) => name.startsWith(label));
    const photosIdx = indexOfSection('photos');
    const albumsIdx = indexOfSection('albums');
    const spacesIdx = indexOfSection('spaces');
    const tagsIdx = indexOfSection('tags');

    // All four required sections must be present — the seeded fixtures guarantee
    // a match in each. If indexOf returns -1, the assertions below will surface
    // it as a clear failure rather than a silent skip.
    expect(photosIdx).toBeGreaterThanOrEqual(0);
    expect(albumsIdx).toBeGreaterThanOrEqual(0);
    expect(spacesIdx).toBeGreaterThanOrEqual(0);
    expect(tagsIdx).toBeGreaterThanOrEqual(0);

    expect(photosIdx).toBeLessThan(albumsIdx);
    expect(albumsIdx).toBeLessThan(spacesIdx);
    expect(spacesIdx).toBeLessThan(tagsIdx);
  });

  test('album owned by user A and shared to user B appears once with Shared badge', async ({ page }) => {
    // Buddy is the recipient of the share — admin is both the owner AND the
    // sharer-out, which means admin's getAlbumNames returns the album under
    // BOTH the owned list (shared:false) AND the shared list (shared:true)
    // (per album.repository.ts:253 — "includes albums owned-and-shared-out by
    // the user"). The cmdk fetchAlbumsCatalog dedupes by id and prefers the
    // shared:true record, so a single "Vacation 2024" row should appear with
    // the Shared badge.
    const buddy = await utils.userSetup(admin.accessToken, {
      email: 'buddy-dedupe@cmdk.test',
      password: 'pw',
      name: 'Buddy Dedupe',
    });
    await utils.cmdkCreateAndShareAlbum(admin.accessToken, buddy.userId, 'Vacation 2024');

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('vacation');

    const albumsGroup = dialog.getByRole('group', { name: /^albums/i });
    await expect(albumsGroup).toBeVisible();

    // Exactly one album row matching /Vacation 2024/. If dedupe regressed, this
    // count would be 2 (one owned-record row, one shared-record row).
    const matchingRows = albumsGroup.locator('[data-command-item]', { hasText: 'Vacation 2024' });
    await expect(matchingRows).toHaveCount(1);

    // The dedupe keeper is the shared:true record, so AlbumRow renders the
    // Shared badge ($t('shared') → "Shared"). Use a regex anchored to whole-word
    // "Shared" so we don't false-positive against album titles that happen to
    // include the substring.
    await expect(matchingRows.getByText(/^shared$/i)).toBeVisible();
  });

  test.describe('ML unhealthy banner', () => {
    // CI runs with ML disabled, so /server/ml-health reports { smartSearchHealthy: false }.
    test('shows the smart-search-unavailable banner in smart mode after typing', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('combobox').fill('beach');
      await expect(page.getByText(/smart search is unavailable/i)).toBeVisible();
    });

    test('"Try Filename mode" button hides the banner', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('combobox').fill('beach');
      await expect(page.getByText(/smart search is unavailable/i)).toBeVisible();
      await page.getByRole('button', { name: /try filename mode/i }).click();
      await expect(page.getByText(/smart search is unavailable/i)).toBeHidden();
      await expect(page.getByRole('radio', { name: /filename/i })).toBeChecked();
    });
  });

  // NOTE: Feature-flag-off coverage (trigger hidden, Ctrl+K no-op) is intentionally
  // not an E2E test because `search` is hardcoded to `true` in
  // `server.service.ts:getFeatures()` — there is no SystemConfig path to flip it.
  // The unit-level trigger + manager tests (in web/src/lib/components/global-search/)
  // cover the flag-off branch via a mocked featureFlagsManager.

  test.describe('navigation provider', () => {
    test('type "auto" → Auto-Classification appears → Enter opens the settings accordion', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('combobox').fill('auto');
      await expect(page.getByText(/auto-classification/i)).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/system-settings\?isOpen=classification/);
    });

    test('type "toggle theme" → click Theme action → theme toggles', async ({ page }) => {
      // Click the row directly rather than relying on Enter + auto-select.
      // The palette's navigation section renders categories in a fixed order
      // (systemSettings → admin → userPages → actions), so any query that
      // weakly fuzzy-matches a systemSettings item will auto-select that
      // item ahead of the ACTIONS entry regardless of score. 'toggle' and
      // 'toggle theme' both fuzzy-match 'Storage Template' via
      // computeCommandScore's greedy subsequence matcher, so Enter on this
      // query lands on a settings panel rather than nav:theme. A real UX
      // fix would order sections by best item score; until then, click the
      // exact row.
      const initialDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('combobox').fill('toggle theme');
      await page.getByText(/toggle theme/i).click();
      await expect
        .poll(async () => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(!initialDark);
    });

    // SWR behavior (ok preserved, empty/error/timeout flip to loading) is covered
    // exhaustively by global-search-manager.svelte.spec.ts. An e2e equivalent would
    // need populated smart-search results to exercise the ok-preservation path, which
    // is impractical in the CI stack (ML is disabled, so searchSmart always returns
    // empty with the 1 asset test data — the empty-flip behavior is the correct
    // design, not a bug, so the original "does not flash skeleton rows" assertion
    // was misconceived).

    test('Ctrl+K reclaim: our palette opens (not the legacy @immich/ui one)', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog')).toBeVisible();
      // Positive signature of OUR palette: the mode-selector radiogroup. The legacy
      // @immich/ui action palette has no such element.
      await expect(page.getByRole('radio', { name: /smart/i })).toBeVisible();
    });

    test('Shift+T toggles the theme outside the palette', async ({ page }) => {
      // This shortcut was previously provided by @immich/ui's action palette. After
      // disabling that, we re-registered it directly on +layout.svelte.
      const initialDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      await page.keyboard.press('Shift+T');
      await expect
        .poll(async () => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(!initialDark);
    });
  });

  test.describe('navigation provider (non-admin)', () => {
    let nonAdmin: LoginResponseDto;

    test.beforeAll(async () => {
      nonAdmin = await utils.userSetup(admin.accessToken, {
        email: 'nonadmin-nav@cmdk.test',
        password: 'pw',
        name: 'NonAdmin Nav',
      });
    });

    test.beforeEach(async ({ context }) => {
      // Override the admin cookies set by the outer beforeEach with the non-admin user's.
      await utils.setAuthCookies(context, nonAdmin.accessToken);
    });

    test('System Settings and Admin sub-sections are absent', async ({ page }) => {
      await page.goto('/photos');
      await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('combobox').fill('classific');
      // 'classific' matches only admin system-settings item, which is gated out.
      // Expect no Auto-Classification row visible.
      await expect(page.getByText(/auto-classification/i)).toHaveCount(0);
    });

    test('admin demotion: stale admin recents are purged on next open', async ({ page, context }) => {
      // Step 1: as admin, navigate via palette to seed a recent entry.
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto('/photos');
      await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('combobox').fill('auto');
      await expect(page.getByText(/auto-classification/i)).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/classification/);
      // Step 2: swap to non-admin cookies (simulating a demotion).
      await utils.setAuthCookies(context, nonAdmin.accessToken);
      await page.goto('/photos');
      await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
      await page.keyboard.press('Control+k');
      // Empty query → Recent section should NOT contain Auto-Classification.
      await expect(page.getByText(/auto-classification/i)).toHaveCount(0);
    });
  });
});
