# People Avatar Source — Slices 5 & 6: The Two Controls

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user two ways to flip `cropFacesFromAsset` — a persistent switch in app settings (slice 5) and a quick toggle in the Info panel itself (slice 6).

**Architecture:** Both controls write the same store, so no new state. Slice 5 is a `<Field><Switch bind:checked>` following the five existing switches in `AppSettings.svelte`. Slice 6 is an `IconButton` in the People section header, placed **outside** the `{#if isOwner}` gate (space viewers need it) and hidden when no visible person has a reachable profile face — a control that cannot change anything is worse than no control.

**Tech Stack:** Svelte 5, `@immich/ui` (`Field`, `Switch`, `IconButton`), `@mdi/js`, svelte-i18n, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-30-people-avatar-source-setting-design.md` §3.3, §3.6, §3.7, §5.4, §6 Slices 5–6.

## Global Constraints

- Run web unit tests as `cd web && pnpm test --run <path>`. **Never** `pnpm test -- --run <path>`.
- `pnpm lint` = `eslint . --concurrency 6`, no `--max-warnings`. Judge by **exit code**. `unicorn/consistent-conditional-object-spread` is error-level: `...(cond && { a })`, never `...(cond ? { a } : {})`.
- IDE `Cannot find name 'vi'/'describe'/'expect'` diagnostics are noise; `pnpm check:typescript` is the gate.
- `i18n/en.json` is sorted, and the root `.prettierrc` runs `prettier-plugin-sort-json` with `jsonRecursiveSort`. Add keys anywhere sensible and let prettier order them. **Only `en.json`** — never edit another locale.
- `i18n/` is shared by web and mobile. Do not rename or delete any existing key.
- Every earlier test must stay green and unedited — 30 in `DetailPanelPeople.spec.ts`, 17 in `person-avatar.spec.ts`, 8 in `preferences.store.spec.ts`.

---

## SLICE 5 — The settings switch

### Task 1: Strings and the switch

**Files:**

- Modify: `i18n/en.json`
- Modify: `web/src/routes/(user)/user-settings/AppSettings.svelte`

**Interfaces:**

- Consumes: `cropFacesFromAsset` from `$lib/stores/preferences.store`.
- Produces: i18n keys `crop_faces_from_photo`, `crop_faces_from_photo_description`, `show_profile_faces`, `show_faces_from_photo` — the last two are consumed by Slice 6.

- [ ] **Step 1: Add all four i18n keys to `i18n/en.json`**

```json
"crop_faces_from_photo": "Crop faces from the photo",
"crop_faces_from_photo_description": "Show each person's avatar cropped from the photo you are viewing. When off, their profile face is shown instead.",
"show_faces_from_photo": "Show faces from this photo",
"show_profile_faces": "Show profile faces",
```

Add all four now even though Slice 6 consumes the last two — there is no unused-key lint, and it keeps the string review in one place.

- [ ] **Step 2: Add the switch to `AppSettings.svelte`**

Extend the existing `preferences.store` import to include `cropFacesFromAsset` (keep the import alphabetically ordered — `prettier-plugin-organize-imports` will enforce it).

Insert this `Field` **immediately after** the `display_original_photos` field and before the `video_hover_setting` field, so display settings stay grouped:

```svelte
<Field label={$t('crop_faces_from_photo')} description={$t('crop_faces_from_photo_description')}>
  <Switch bind:checked={$cropFacesFromAsset} />
</Field>
```

- [ ] **Step 3: Verify it type-checks and lints**

Run: `cd web && pnpm check:typescript && pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Attempt the component spec — TIMEBOXED**

Create `web/src/routes/(user)/user-settings/AppSettings.spec.ts`, modelled on the sibling `FeatureSettings.spec.ts`:

```ts
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import { cropFacesFromAsset } from '$lib/stores/preferences.store';
import AppSettings from './AppSettings.svelte';

describe('AppSettings — crop faces switch', () => {
  beforeEach(() => {
    cropFacesFromAsset.set(true);
  });

  it('reflects the store when cropping is on', () => {
    render(AppSettings);
    expect(screen.getByRole('switch', { name: /crop faces from the photo/i })).toBeChecked();
  });

  it('writes false to the store when switched off', async () => {
    render(AppSettings);

    await userEvent.click(screen.getByRole('switch', { name: /crop faces from the photo/i }));

    expect(get(cropFacesFromAsset)).toBe(false);
  });

  it('reflects an already-off store on mount', () => {
    cropFacesFromAsset.set(false);
    render(AppSettings);
    expect(screen.getByRole('switch', { name: /crop faces from the photo/i })).not.toBeChecked();
  });
});
```

Run: `cd web && pnpm test --run "src/routes/(user)/user-settings/AppSettings.spec.ts"`
(quote the path — the brackets in `(user)` break shell globbing.)

**This step is timeboxed.** `AppSettings` mounts `themeManager` from `@immich/ui`, starts a `setInterval` in `onMount`, and renders `SettingsLanguageSelector` + `SettingCombobox`; `FeatureSettings.spec.ts` needed four module mocks to become mountable. Add mocks as needed — but if it is still not mounting after **three** genuine attempts, **delete the spec file and move on**. Record in your report exactly what failed and what you tried. The switch is three lines of markup over a store that already has 8 passing tests, and Slice 6 covers the same store through a component that is known to mount. Do not sink the slice into a test harness.

- [ ] **Step 5: Commit**

```bash
git add i18n/en.json "web/src/routes/(user)/user-settings/AppSettings.svelte" "web/src/routes/(user)/user-settings/AppSettings.spec.ts"
git commit -m "feat(web): add an app setting for the info-panel avatar source"
```

(Drop the spec path from `git add` if Step 4 was abandoned.)

---

## SLICE 6 — The in-panel toggle

### Task 2: The toggle button

**Files:**

- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.svelte`
- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`

**Interfaces:**

- Consumes: `getRepresentativeThumbnailUrl` from `$lib/utils/person-avatar`; `cropFacesFromAsset`; `mdiAccountBoxOutline`, `mdiCropFree` from `@mdi/js` (both verified to exist).

- [ ] **Step 1: Write the failing tests**

Append a new `describe` inside the top-level `describe('DetailPanelPeople', …)` in `DetailPanelPeople.spec.ts`:

```ts
describe('in-panel avatar source toggle', () => {
  const toggle = () => screen.queryByRole('button', { name: /show profile faces|show faces from this photo/i });

  it('offers the owner a toggle that flips the store and relabels itself', async () => {
    faceManagerMock.people = [person('Alice')];
    givePersonAFace('person-Alice');

    renderPanel({ isOwner: true });
    await tick();

    const button = screen.getByRole('button', { name: /show profile faces/i });
    await userEvent.click(button);

    expect(get(cropFacesFromAsset)).toBe(false);
    expect(screen.getByRole('button', { name: /show faces from this photo/i })).toBeInTheDocument();
  });

  it('offers the toggle to a space member who is not the owner', async () => {
    const bob = spacePerson('Bob', 'space-person-1');
    givePersonAFace('person-Bob');

    renderPanel({ isOwner: false, spaceId: 'space-1', people: [bob] });
    await tick();

    // Proves the button sits OUTSIDE the {#if isOwner} gate.
    expect(toggle()).toBeInTheDocument();
  });

  it('hides the toggle from a viewer with no reachable profile face', async () => {
    faceManagerMock.people = [person('Alice')];
    givePersonAFace('person-Alice');

    renderPanel({ isOwner: false });
    await tick();

    // Nothing to switch to — a control that cannot change anything must not be offered.
    expect(toggle()).not.toBeInTheDocument();
  });

  it('hides the toggle when the asset has no people, keeping the add-face affordance', async () => {
    faceManagerMock.people = [];
    faceManagerMock.data = [];
    faceManagerMock.facesByPersonId = new Map();

    renderPanel({ isOwner: true });
    await tick();

    expect(toggle()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tag people/i })).toBeInTheDocument();
  });
});
```

Add these imports to the spec file if not already present:

```ts
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
```

- [ ] **Step 2: Run and confirm red**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: the first two tests FAIL (no such button exists yet). The two "hides the toggle" tests PASS trivially — they are guards, not drivers, and Step 5 mutation-verifies them.

- [ ] **Step 3: Implement**

In the `<script>` block, extend the `person-avatar` import:

```ts
import { getRepresentativeThumbnailUrl, resolvePersonAvatar } from '$lib/utils/person-avatar';
```

extend the `@mdi/js` import with `mdiAccountBoxOutline` and `mdiCropFree`, and add after `visiblePeople`:

```ts
// Only offer the switch where it can actually do something. A viewer reaching this asset through
// an album or partner share has no profile face to switch to, so for them the crop is the only
// option and the button would be dead.
const canChooseAvatarSource = $derived(
  visiblePeople.some((person) => getRepresentativeThumbnailUrl(person, { isOwner, spaceId }) !== undefined),
);
```

In the markup, inside `<div class="flex items-center gap-2">` and **before** the `{#if isOwner}` block:

```svelte
{#if canChooseAvatarSource}
  <IconButton
    aria-label={$cropFacesFromAsset ? $t('show_profile_faces') : $t('show_faces_from_photo')}
    icon={$cropFacesFromAsset ? mdiAccountBoxOutline : mdiCropFree}
    size="medium"
    shape="round"
    color="secondary"
    variant="ghost"
    onclick={() => cropFacesFromAsset.set(!$cropFacesFromAsset)}
  />
{/if}
```

The icon and label describe the **action**, not the current state — clicking while cropping takes you to profile faces.

- [ ] **Step 4: Run to green**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: PASS, 34 tests.

**Watch `offers no face editing controls to a non-owner`** (an older test asserting `queryAllByRole('button')` has length 0). It must still pass: that scenario has no space, so `canChooseAvatarSource` is false and no button renders. **If it goes red, your visibility gate is wrong — fix the gate, never the test.**

- [ ] **Step 5: Mutation-verify the two guard tests**

| Test                                                | Mutation                                                | Must go red                                                                  |
| --------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| hides the toggle from a viewer with no profile face | Replace `{#if canChooseAvatarSource}` with `{#if true}` | yes — and `offers no face editing controls to a non-owner` should go red too |
| hides the toggle when the asset has no people       | Replace `{#if canChooseAvatarSource}` with `{#if true}` | yes                                                                          |

Revert with `git checkout web/src/lib/components/asset-viewer/DetailPanelPeople.svelte` and confirm 34/34 green again.

- [ ] **Step 6: Full gate and commit**

```bash
cd web && pnpm check:typescript   # exit 0
cd web && pnpm lint               # exit 0
cd web && pnpm test --run         # 0 failures
```

```bash
git add web/src/lib/components/asset-viewer/DetailPanelPeople.svelte web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts
git commit -m "feat(web): add an in-panel toggle for the info-panel avatar source"
```

---

## Completion Checklist

- [ ] Four i18n keys in `en.json` only; no other locale touched; no existing key renamed.
- [ ] Settings switch renders and binds; spec added **or** consciously abandoned with a written reason.
- [ ] In-panel toggle renders for owner and space member, hidden for album/partner viewer and for a people-less asset.
- [ ] `offers no face editing controls to a non-owner` still passes, unedited.
- [ ] `check:typescript`, `lint`, full suite all clean.
- [ ] Branch pushed.
