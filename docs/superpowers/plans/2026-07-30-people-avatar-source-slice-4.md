# People Avatar Source — Slice 4: Honour the Setting in the Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Info panel read `cropFacesFromAsset` so a user's choice actually changes the avatar — without demoting viewers who have no profile face to fall back on.

**Architecture:** One-line production change: the literal `cropFacesFromAsset: true` that slice 2 passed into `resolvePersonAvatar` becomes the store value. All the work is in tests, because the interesting behaviour is what must _not_ happen (no crop computed in profile mode; no demotion for album/partner viewers).

**Tech Stack:** Svelte 5 runes, `svelte-persisted-store`, Vitest, `@testing-library/svelte`.

**Spec:** `docs/superpowers/specs/2026-07-30-people-avatar-source-setting-design.md` §3.1, §3.2, §4, §6 Slice 4, §7.

## Global Constraints

- Run web unit tests as `cd web && pnpm test --run <path>`. **Never** `pnpm test -- --run <path>` — the `--` form drops the path filter and runs all 296 files.
- `pnpm lint` is `eslint . --concurrency 6`, **no `--max-warnings`**. Judge by exit code. `unicorn/consistent-conditional-object-spread` is an **error**: write `...(cond && { a })`, never `...(cond ? { a } : {})`.
- IDE diagnostics reading `Cannot find name 'vi'/'describe'/'expect'` in `.spec.ts` are language-server noise. `pnpm check:typescript` is the real gate.
- **Slice 1's 8 pins must stay green.** They encode default (crop-on) behaviour. If one goes red, you changed the default — that is a bug, not a pin to update.
- `cropFacesFromAsset` is a **real store backed by localStorage**. Any test that flips it MUST reset it, or the leaked value silently changes later tests in this file and in `preferences.store.spec.ts`. This is mandatory, not hygiene.

---

### Task 1: Read the store in the component

**Files:**

- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.svelte`
- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`

**Interfaces:**

- Consumes: `cropFacesFromAsset` from `$lib/stores/preferences.store` (slice 3); `resolvePersonAvatar` from `$lib/utils/person-avatar` (slice 2); `asset`, `renderPanel`, `spacePerson`, `givePersonAFace`, `settleCrop`, `CROP_DATA_URL` from slice 1's harness.
- Produces: `rerenderPanel(result, props)` test helper, used by Step 8.

- [ ] **Step 1: Add the store-reset guard to the spec file**

`cropFacesFromAsset` writes through to localStorage, so a flipped value survives into the next test. In `DetailPanelPeople.spec.ts`, import the store:

```ts
import { cropFacesFromAsset } from '$lib/stores/preferences.store';
```

and add to the **existing** `beforeEach`, as its first statement:

```ts
// Real localStorage-backed store: a flip in one test leaks into every later test (and into
// preferences.store.spec.ts) unless it is reset here.
cropFacesFromAsset.set(true);
```

- [ ] **Step 2: Run slice 1's pins to confirm the guard changed nothing**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: PASS, 21 tests.

- [ ] **Step 3: Write the failing behaviour tests**

Append a new `describe` inside the top-level `describe('DetailPanelPeople', …)`:

```ts
describe('avatar source setting', () => {
  it('shows the profile face and never computes a crop when the setting is off', async () => {
    faceManagerMock.people = [person('Alice')];
    givePersonAFace('person-Alice');
    zoomImageToBase64Mock.mockResolvedValue(CROP_DATA_URL);
    cropFacesFromAsset.set(false);

    const { container } = renderPanel({ isOwner: true });
    await tick();

    // Not merely "not displayed" — not attempted. The crop decodes the full-size image and runs
    // a canvas draw per person, so skipping it is the performance half of this feature.
    expect(zoomImageToBase64Mock).not.toHaveBeenCalled();
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/people/');
  });

  it('still crops when the setting is on', async () => {
    faceManagerMock.people = [person('Alice')];
    givePersonAFace('person-Alice');
    zoomImageToBase64Mock.mockResolvedValue(CROP_DATA_URL);
    cropFacesFromAsset.set(true);

    const { container } = renderPanel({ isOwner: true });
    await settleCrop();

    expect(container.querySelector('img')?.getAttribute('src')).toBe(CROP_DATA_URL);
  });

  it('shows the space profile face to a space member when the setting is off', async () => {
    const bob = spacePerson('Bob', 'space-person-1');
    givePersonAFace('person-Bob');
    cropFacesFromAsset.set(false);

    const { container } = renderPanel({ isOwner: false, spaceId: 'space-1', people: [bob] });
    await tick();

    expect(zoomImageToBase64Mock).not.toHaveBeenCalled();
    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      '/shared-spaces/space-1/people/space-person-1/thumbnail',
    );
  });

  it('KEEPS cropping for a viewer with no reachable profile face even when the setting is off', async () => {
    // The regression guard. Turning the setting off must not give an album/partner viewer the
    // whole photo as every person's avatar — they have no profile face to switch to.
    faceManagerMock.people = [person('Alice')];
    givePersonAFace('person-Alice');
    zoomImageToBase64Mock.mockResolvedValue(CROP_DATA_URL);
    cropFacesFromAsset.set(false);

    const { container } = renderPanel({ isOwner: false });
    await settleCrop();

    expect(zoomImageToBase64Mock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(CROP_DATA_URL);
  });

  it('uses the owner profile face for the owner inside a space when the setting is off', async () => {
    faceManagerMock.people = [person('Alice')];
    givePersonAFace('person-Alice');
    cropFacesFromAsset.set(false);

    const { container } = renderPanel({ isOwner: true, spaceId: 'space-1' });
    await tick();

    // The "not called" assertion is what makes this a driver rather than a passenger: without
    // it the URL assertion passes even before the fix, because the pending crop branch already
    // renders this same fallback.
    expect(zoomImageToBase64Mock).not.toHaveBeenCalled();
    const src = container.querySelector('img')?.getAttribute('src');
    expect(src).toContain('/people/');
    expect(src).not.toContain('/shared-spaces/');
  });

  it('does not fetch video media for a crop nobody will see when the setting is off', async () => {
    faceManagerMock.people = [person('Alice')];
    givePersonAFace('person-Alice');
    cropFacesFromAsset.set(false);

    renderPanel({ isOwner: true, assetType: AssetTypeEnum.Video });
    await tick();

    expect(zoomImageToBase64Mock).not.toHaveBeenCalled();
  });

  it('updates the rendered avatar when the setting is flipped on a live panel', async () => {
    faceManagerMock.people = [person('Alice')];
    givePersonAFace('person-Alice');
    zoomImageToBase64Mock.mockResolvedValue(CROP_DATA_URL);

    const { container } = renderPanel({ isOwner: true });
    await settleCrop();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(CROP_DATA_URL);

    cropFacesFromAsset.set(false);
    await tick();

    // Same container, no re-render call: the change must propagate through reactivity alone.
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/people/');
  });

  it('keeps hidden-people filtering, links and age rendering intact when the setting is off', async () => {
    const alice = person('Alice');
    const hidden = { ...person('Hidden'), isHidden: true } as PersonResponseDto;
    faceManagerMock.people = [alice, hidden];
    faceManagerMock.facesByPersonId = new Map();
    cropFacesFromAsset.set(false);

    renderPanel({ isOwner: true });
    await tick();

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run and confirm the expected failures**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: **5 failures** — the five tests that set the store to `false` and expect profile-face behaviour ("shows the profile face and never computes a crop", "shows the space profile face", "uses the owner profile face … inside a space", "does not fetch video media", "updates the rendered avatar when … flipped"). They fail because the component still hardcodes `cropFacesFromAsset: true`, so it keeps cropping.

The other three ("still crops when the setting is on", the regression guard, and the hidden-people test) are expected to **pass** already — they assert crop-on behaviour, which is the current hardcoded state. Record which failed and which passed.

- [ ] **Step 5: Make the component read the store**

In `DetailPanelPeople.svelte`, extend the existing `preferences.store` import:

```ts
import { cropFacesFromAsset, locale } from '$lib/stores/preferences.store';
```

and in the `{@const avatarSource = resolvePersonAvatar({ … })}` block, replace:

```ts
cropFacesFromAsset: true,
```

with:

```ts
cropFacesFromAsset: $cropFacesFromAsset,
```

That is the entire production change.

- [ ] **Step 6: Run to green**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: PASS, 29 tests (21 pins + 8 new). Slice 1's pins must be **unmodified**.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/components/asset-viewer/DetailPanelPeople.svelte web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts
git commit -m "feat(web): honour the crop-faces-from-asset setting in the info panel"
```

---

### Task 2: Guard against a stale avatar across an asset switch

**Files:**

- Modify: `web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`

**Interfaces:**

- Consumes: everything from Task 1.

- [ ] **Step 1: Add the rerender helper**

`renderWithTooltips` (`web/tests/helpers.ts`) renders `TestWrapper` with `{ component, componentProps }` and then **casts** the result to `RenderResult<K>`. That cast is a lie about `rerender`: it must be called with the wrapper's prop shape, not the component's. Add below `renderPanel`:

```ts
// renderWithTooltips casts away the TestWrapper indirection, so rerender must be fed the
// wrapper's own prop shape — passing the component's props directly silently does nothing.
const rerenderPanel = async (
  result: { rerender: (props: never) => Promise<void> },
  props: { isOwner: boolean; spaceId?: string; assetId: string },
) => {
  await result.rerender({
    component: DetailPanelPeople,
    componentProps: {
      asset: asset({ id: props.assetId }),
      isOwner: props.isOwner,
      previousRoute: '/photos',
      spaceId: props.spaceId,
    },
  } as never);
};
```

- [ ] **Step 2: Write the failing test**

Append inside `describe('avatar source setting', …)`:

```ts
it('resolves the fallback against the new asset after navigating to the next photo', async () => {
  // The {#await} lives inside an {#each} keyed on person.id, so a person present on both photos
  // keeps their DOM node across the switch. The avatar inputs must still be recomputed.
  faceManagerMock.people = [person('Alice')];
  givePersonAFace('person-Alice');
  zoomImageToBase64Mock.mockResolvedValue(null);

  const result = renderPanel({ isOwner: false });
  const { container } = result;
  await settleCrop();
  expect(container.querySelector('img')?.getAttribute('src')).toContain('/assets/asset-1/');

  await rerenderPanel(result as never, { isOwner: false, assetId: 'asset-2' });
  await tick();

  expect(container.querySelector('img')?.getAttribute('src')).toContain('/assets/asset-2/');
});
```

- [ ] **Step 3: Run it**

Run: `cd web && pnpm test --run src/lib/components/asset-viewer/DetailPanelPeople.spec.ts`
Expected: PASS, 30 tests.

If it fails because `rerender` did not update anything, report the exact failure — that means either the wrapper shape is wrong (fixable) or the component genuinely pins a stale avatar (a real bug worth its own fix).

- [ ] **Step 4: Mutation-verify this one**

Mutation: in `DetailPanelPeople.svelte`, hoist the asset thumbnail out of the loop by changing `assetThumbnailUrl: getAssetUrls(asset).thumbnail` to a `$derived` captured once — or simplest, replace it with the literal `'/api/assets/asset-1/thumbnail'`.
Expected: this test fails. Revert with `git checkout web/src/lib/components/asset-viewer/DetailPanelPeople.svelte`.

- [ ] **Step 5: Full gate and commit**

Run, in order:

```bash
cd web && pnpm check:typescript   # expect exit 0
cd web && pnpm lint               # expect exit 0
cd web && pnpm test --run         # expect 0 failures
```

```bash
git add web/src/lib/components/asset-viewer/DetailPanelPeople.spec.ts
git commit -m "test(web): guard the info-panel avatar against a stale asset after navigation"
```

---

## Slice Completion Checklist

- [ ] `DetailPanelPeople.svelte` reads `$cropFacesFromAsset`; the literal `true` is gone.
- [ ] 9 new tests; slice 1's 21 pins green and unmodified.
- [ ] `cropFacesFromAsset.set(true)` runs in `beforeEach` — no store leakage.
- [ ] `check:typescript`, `lint`, and the full suite all clean.
- [ ] Branch pushed.
