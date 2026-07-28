# Slice 4 — `FilterContext` carries the location / camera / media dimensions (#858)

- **Spec:** `docs/superpowers/specs/2026-07-26-second-level-filter-narrowing-858-design.md` § "Slice 4" and §3.3
- **Branch:** `fix/858-second-level-filter-narrowing`
- **Depends on:** Slice 3 (`303960bd20b`) — the regenerated SDK now types `city?: string` and
  `mediaType?: AssetTypeEnum` on `getSearchSuggestions`. Without it this slice would not typecheck.
- **Scope:** two web files + three web test files. No server changes.

## Outcome

The filter panel actually sends the dimensions the server learned to honour in Slices 1-3. After this slice
the camera-model list narrows by an active location or media-type filter, and the city list narrows by an
active camera or media-type filter — completing #858 end to end.

## Why no call-site changes are needed

Every surface already spreads the context into its request — `map-filter-config.ts`,
`album-filter-config.ts`, `recently-added-filter-config.ts`, `routes/(user)/photos/…/+page.svelte`,
`routes/(user)/spaces/[spaceId]/…/+page.svelte` all do `{ $type: …, <parent>, ...context }`. Widening the
context is enough.

The explicit first argument is never clobbered: the `cities` provider is called with
`buildFilterContext(filters, ['country', 'city'])` and the `cameraModels` provider with
`buildFilterContext(filters, ['make', 'model'])`, so each dependent request excludes exactly the keys it
passes explicitly.

Nine other `buildFilterContext(filters)` consumers exist in `web/src/lib/utils/*-filter-options.ts` and
`space-search.ts`. Every one reads **only** `context.takenAfter` / `context.takenBefore` by name — none
spreads the context — so widening the type cannot leak new fields into timeline or smart-search payloads.
Verify this with `grep -n "buildFilterContext" -A 12 web/src/lib/utils/*.ts` before implementing; if any
consumer spreads the context, STOP and report.

## Out of scope

- Any server file. Any mobile file.
- `getFilterSuggestions` request builders (`*-filter-options.ts`) — those already send all five dimensions.
- Changing the cascade auto-clear policy in `camera-filter.svelte` / `location-filter.svelte`.

---

## Step 1 (RED) — Pure `buildFilterContext` tests

**File:** `web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts`

Add to the existing `describe('buildFilterContext', …)` block (starts around line 200). It currently imports
`{ buildFilterContext, clearFilters, createFilterState, getActiveFilterCount }` from `'../filter-panel'` —
add an `AssetTypeEnum` import from `@immich/sdk`.

| #   | `it(...)`                                                                    | State                                    | Expect                                                                      |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| 4.1 | `should include country and city`                                            | `country: 'Germany'`, `city: 'Berlin'`   | `{ country: 'Germany', city: 'Berlin' }`                                    |
| 4.2 | `should include make and model`                                              | `make: 'Canon'`, `model: 'Canon EOS R5'` | `{ make: 'Canon', model: 'Canon EOS R5' }`                                  |
| 4.3 | `should map mediaType image and video to the SDK enum`                       | `mediaType: 'image'` then `'video'`      | `{ mediaType: AssetTypeEnum.Image }` / `{ mediaType: AssetTypeEnum.Video }` |
| 4.4 | `should omit mediaType when set to all`                                      | `mediaType: 'all'`, `rating: 4`          | `{ rating: 4 }` — no `mediaType` key                                        |
| 4.5 | `should exclude country and city for the location context but keep the rest` | all five set + `tagIds: ['t1']`          | has `make`, `model`, `mediaType`, `tagIds`; no `country`, no `city`         |
| 4.6 | `should exclude make and model for the camera context but keep the rest`     | all five set + `tagIds: ['t1']`          | has `country`, `city`, `mediaType`, `tagIds`; no `make`, no `model`         |
| 4.7 | `should return undefined when only mediaType is all and nothing else is set` | `createFilterState()` untouched          | `toBeUndefined()`                                                           |
| 4.8 | `should return a defined context when only a country is set`                 | `country: 'Germany'` only                | `toEqual({ country: 'Germany' })`                                           |

Use `toEqual` for 4.1, 4.2, 4.4, 4.7, 4.8 so a stray extra key fails. For 4.5 / 4.6 assert the present keys
with `toEqual` on the whole object (it is deterministic) rather than a mix of `toHaveProperty` /
`not.toHaveProperty` — clearer failure output.

Also confirm the existing `'should include active filters for dependent suggestions'` test (around line 227)
still passes untouched — it uses `toEqual` on a state with no location/camera/media values, so it must be
unaffected. Do not edit it.

```bash
cd web
pnpm exec vitest run src/lib/components/filter-panel/__tests__/filter-state.spec.ts
```

**Expected RED:** 4.1, 4.2, 4.3, 4.5, 4.6, 4.8 fail because the new keys are absent (4.8 fails with
`undefined` instead of an object). 4.4 and 4.7 pass already — they assert absence, which is trivially true
today. Report the actual split; do not force 4.4 / 4.7 to fail.

## Step 2 (RED) — Provider call-argument tests

**File:** `web/src/lib/components/filter-panel/__tests__/contextual-refetch.spec.ts`

### 2a. Update the existing cross-dimension test

Find `it('should pass custom from date context to dependent city and camera model providers', …)` (around
line 417). It selects country `Germany` **and** make `Canon`, then asserts both providers were last called
with `{ takenAfter }` only. That expectation encodes the bug. Rename it to
`'should pass the full cross-dimension context to dependent city and camera model providers'` and update the
assertions:

```ts
await waitFor(() => {
  expect(cities).toHaveBeenLastCalledWith('Germany', {
    takenAfter: '2024-01-01T00:00:00.000Z',
    make: 'Canon',
  });
  expect(cameraModels).toHaveBeenLastCalledWith('Canon', {
    takenAfter: '2024-01-01T00:00:00.000Z',
    country: 'Germany',
  });
});
```

Note the asymmetry is correct and is the point of the slice: the city request carries the camera dimension
and excludes location; the camera request carries the location dimension and excludes camera.

### 2b. New media-type test

`createConfig`'s `sections` list is `['timeline', 'people', 'location', 'camera', 'tags']`. Add a test that
renders with `sections: [...'media' included]` — pass a config whose sections include `'media'`, e.g. build
it from `createConfig()` and override `sections`. `MediaTypeFilter` renders all three buttons when
`availableMediaTypes` is undefined, so no `suggestionsProvider` is needed.

```ts
it('should pass the media type to dependent city and camera model providers', async () => {
  const cities = vi.fn().mockResolvedValue(['Berlin']);
  const cameraModels = vi.fn().mockResolvedValue(['EOS R5']);
  const config = { ...createConfig({ cities, cameraModels }), sections: ['location', 'camera', 'media'] };
  render(FilterPanel, { props: { config, timeBuckets } });

  await vi.advanceTimersByTimeAsync(0);

  await fireEvent.click(screen.getByTestId('location-country-Germany'));
  await fireEvent.click(screen.getByTestId('camera-make-Canon'));
  await fireEvent.click(screen.getByTestId('media-type-video'));

  await waitFor(() => {
    expect(cities).toHaveBeenLastCalledWith('Germany', {
      make: 'Canon',
      mediaType: AssetTypeEnum.Video,
    });
    expect(cameraModels).toHaveBeenLastCalledWith('Canon', {
      country: 'Germany',
      mediaType: AssetTypeEnum.Video,
    });
  });
});
```

Type the config as `FilterPanelConfig` (the `sections` array needs the `FilterSection` element type — use
`sections: ['location', 'camera', 'media'] as FilterSection[]` or import the type) so `pnpm check:typescript`
stays clean. `AssetTypeEnum` imports from `@immich/sdk`.

Adjust the exact test-ids if the rendered markup differs — read `location-filter.svelte`,
`camera-filter.svelte` and `media-type-filter.svelte` for the real `data-testid` values rather than trusting
these snippets (`camera-make-{make}`, `media-type-{value}` are the current ones).

```bash
cd web
pnpm exec vitest run src/lib/components/filter-panel/__tests__/contextual-refetch.spec.ts
```

**Expected RED:** both fail — the providers are called without the new keys.

### 2c. Confirm `cascade-fix.spec.ts` stays green — do not edit it

`cascade-fix.spec.ts` asserts `citiesFn` / `modelsFn` are called with `('Germany', undefined)` and
`('Fujifilm', undefined)`. Those tests set no other filters, so both dependent contexts remain `undefined`
after this change. Run the file and confirm; if it goes red, STOP and report — that would mean
`buildFilterContext` is emitting a key it should not.

## Step 3 (RED) — Count-gate regression test

**File:** `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

`filter-panel.svelte:89`'s `filterContext` is **not** a request payload — it gates the per-section `count`
prop, and `count === 0` disables the section and appends `" (0)"` to its title
(`filter-section.svelte:21-39`). Widening it unchanged would start disabling empty sections in states where
they are enabled today. §3.3 keeps that behaviour; this test locks it in.

```ts
it('keeps empty sections enabled when only a section-local filter is active (#858 §3.3)', async () => {
  // Only a camera make is set — a section-local dimension. The People section is empty but must
  // stay enabled, exactly as before #858 widened FilterContext.
  const filters = { ...createFilterState(), make: 'Canon' };
  const config: FilterPanelConfig = {
    sections: ['people', 'camera'],
    providers: {
      people: vi.fn().mockResolvedValue([]),
      cameras: vi.fn().mockResolvedValue([{ value: 'Canon', type: 'make' as const }]),
    },
  };

  render(FilterPanel, { props: { config, timeBuckets: [], filters } });

  await waitFor(() => {
    expect(screen.getByTestId('camera-make-Canon')).toBeTruthy();
  });

  const peopleButton = within(screen.getByTestId('filter-section-people')).getByRole('button');
  expect(peopleButton).not.toBeDisabled();
  expect(peopleButton.textContent).not.toContain('(0)');
});
```

Read `filter-panel.spec.ts` first and match its existing imports, render helpers and timer conventions
(some files in this directory use `vi.useFakeTimers()`); adapt the snippet accordingly. `within` comes from
`@testing-library/svelte`; if the file does not already import it, use
`screen.getByTestId('filter-section-people').querySelector('button')` instead.

**Expected:** this test **passes before the implementation** (today `filterContext` is `undefined` with only
a make set) and must **still pass after** it. It is a regression guard, not a red test — the plan's
implementation Step 4b is what keeps it green. Report it as such.

To prove the guard has teeth, after implementing, temporarily change line 89 to plain
`buildFilterContext(filters)`, confirm this test FAILS, then restore the carve-out and confirm it passes.
Report both observations.

---

## Step 4 (GREEN) — Implementation

### 4a. `web/src/lib/components/filter-panel/filter-panel.ts`

Add the import at the top (the file currently imports only `{ browser } from '$app/environment'`):

```ts
import { AssetTypeEnum } from '@immich/sdk';
```

Extend the type:

```ts
export type FilterContext = {
  takenAfter?: string;
  takenBefore?: string;
  personIds?: string[];
  tagIds?: string[];
  rating?: number;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  isInAlbum?: boolean;
  country?: string;
  city?: string;
  make?: string;
  model?: string;
  mediaType?: AssetTypeEnum;
};
```

In `buildFilterContext`, after the `isInAlbum` block and before the `validDateAfter` / `validDateBefore`
lines:

```ts
if (includes('country') && state.country) {
  context.country = state.country;
}

if (includes('city') && state.city) {
  context.city = state.city;
}

if (includes('make') && state.make) {
  context.make = state.make;
}

if (includes('model') && state.model) {
  context.model = state.model;
}

if (includes('mediaType') && state.mediaType !== 'all') {
  context.mediaType = state.mediaType === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
}
```

The trailing `return Object.keys(context).length > 0 ? context : undefined;` is unchanged and now also
returns a context for a location-only or camera-only filter state.

### 4b. `web/src/lib/components/filter-panel/filter-panel.svelte`

Line 89 only. Keep lines 90-91 (`locationFilterContext`, `cameraFilterContext`) exactly as they are.

```ts
// The count gate answers "has a *cross-section* filter narrowed the panel?". It drives the
// empty-section disable in filter-section.svelte, not a request, so the location/camera/media
// dimensions added for #858 stay out of it — see the #858 design doc §3.3.
let filterContext = $derived(buildFilterContext(filters, ['country', 'city', 'make', 'model', 'mediaType']));
```

### Run — expect GREEN

```bash
cd web
pnpm exec vitest run src/lib/components/filter-panel
pnpm check:typescript
pnpm check:svelte
pnpm lint
```

---

## Step 5 — Validate

```bash
cd web
pnpm exec vitest run                # full web unit suite
pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm format
```

`pnpm lint` tolerates tailwind **warnings** but not errors. `check:svelte` has been seen scanning 0 files
locally on some machines — if it reports 0 files, say so rather than claiming it passed.

The full web suite matters: `buildFilterContext` is imported by nine other modules and their specs
(`map-filter-config.spec.ts`, `album-filter-config.spec.ts`, `recently-added-filter-config.spec.ts`,
`space-search.spec.ts`, `photos-filter-options` specs, the two `test-data/mocks/*.stub.svelte` harnesses).
If any of them assert on a whole context object, they may need updating — report any such change and justify
it against §3.3 before making it.

---

## Definition of done

- [ ] 8 new pure tests in `filter-state.spec.ts`, all green; red/green split reported honestly
- [ ] `contextual-refetch.spec.ts`: existing cross-dimension test updated + new media-type test, both green
- [ ] `cascade-fix.spec.ts` still green, unmodified
- [ ] Count-gate regression test added; teeth proven by temporarily removing the carve-out
- [ ] `FilterContext` widened; `buildFilterContext` emits all five, honouring `exclude`
- [ ] `filter-panel.svelte:89` carve-out with its comment; lines 90-91 untouched
- [ ] No server, mobile, or `*-filter-options.ts` changes
- [ ] Full web unit suite green; `check:typescript`, `check:svelte`, `lint`, `format` clean
- [ ] Nothing committed
