# Design: cmdk palette follow-ups (v1.2.1)

Two small, post-merge polish fixes to the command palette shipped in PR #365
(`feat/cmdk-prefix-scoping`): broken face thumbnails, and poor discoverability
of the `@ # / >` scope prefixes.

## Issue 1 — face thumbnails render as empty circles

### Symptom

Under the `@` scope (and anywhere the palette lists people — search
results, recents, preview pane) every person row's avatar circle is a flat
grey placeholder. The preview pane's big round thumbnail is also empty,
though the 4-asset strip below the name _does_ render correctly.

### Root cause

`PersonResponseDto` in the generated SDK has a `thumbnailPath` field but
**no `faceAssetId`**. Both `person-row.svelte` and `person-preview.svelte`
type their prop as:

```ts
PersonResponseDto & { numberOfAssets?: number; faceAssetId?: string }
```

and build the thumbnail URL with:

```ts
item.faceAssetId ? getAssetMediaUrl({ id: item.faceAssetId, size: ... }) : ''
```

The intersection type made TS accept the property, but nothing upstream
populates it — so the ternary always falls through to `''` and the
placeholder `<div>` renders instead. The manager's `activate('person')`
path saves `thumbnailAssetId: p.faceAssetId` into recents, which also
resolves to `undefined` for the same reason.

### Fix

Switch every person thumbnail site to `getPeopleThumbnailUrl(person)`
(`web/src/lib/utils.ts:248`), which hits `/api/people/:id/thumbnail` — the
dedicated face-crop endpoint used everywhere else in the app
(`manage-people-visibility.svelte`, `PeoplePickerModal`, merge modal,
person-side-panel, the person page itself). It only needs `person.id`.

Concretely:

1. **`web/src/lib/components/global-search/rows/person-row.svelte`**
   - Drop `faceAssetId?: string` from the prop intersection.
   - Replace the `getAssetMediaUrl` call with `getPeopleThumbnailUrl(item)`.
   - Add an `onerror` fallback for the case where the server 404s
     (person whose thumbnail hasn't been generated yet — fresh ML
     pipeline, or deleted person referenced in stale recents). Concrete
     wiring with Svelte 5 runes:
     ```svelte
     let failed = $state(false);
     // reset when the person changes
     $effect(() => { void item.id; failed = false; });
     ```
     Then in the template:
     ```svelte
     {#if !failed}
       <img src={thumbUrl} ... onerror={() => (failed = true)} />
     {:else}
       <div class="h-10 w-10 rounded-full bg-subtle/40" aria-hidden="true"></div>
     {/if}
     ```

2. **`web/src/lib/components/global-search/previews/person-preview.svelte`**
   - Same change as `person-row`. Use the same `let failed = $state(false)`
     - `onerror` pattern. `size: AssetMediaSize.Preview` is no longer
       relevant — `getPeopleThumbnailUrl` returns a single-size face crop,
       which is what the design already assumed.

3. **`web/src/lib/managers/global-search-manager.svelte.ts`**
   - `activate('person')` (line ~990): drop `thumbnailAssetId: p.faceAssetId`
     from the recent entry payload.
   - `activeItemFromRecent` person branch (line ~852): drop
     `faceAssetId: entry.thumbnailAssetId` from the synthesised data
     object. The preview component only needs `id` + `name`.

4. **`web/src/lib/stores/cmdk-recent.ts`**
   - Remove `thumbnailAssetId?: string` from the `person` variant of
     `RecentEntry`. **Backward compatibility**: stored entries written by
     the old code still carry `thumbnailAssetId`; the JSON read path
     (`rawRead` → `JSON.parse` → cast to `RecentEntry[]`) does no
     narrowing, so legacy entries deserialise fine and the new code
     simply ignores the extra field. No migration needed.

5. **`web/src/lib/components/global-search/rows/recent-row.svelte`**
   - Stop passing `faceAssetId: entry.thumbnailAssetId` in the
     synthesised `PersonRow` props. After step 1, `PersonRow` derives the
     thumbnail URL itself via `getPeopleThumbnailUrl(item)` from
     `item.id` — so recent-row only needs to forward `id` (=
     `entry.personId`) and `name` (= `entry.label`).

6. **Tests to update**
   - `person-row.spec.ts`: remove `faceAssetId` from fixtures; assert that
     an `<img>` with a URL matching `/api/people/.*/thumbnail` is rendered.
     Replace the existing "renders a placeholder div when faceAssetId is
     missing" case with a new "swaps to placeholder on image error" case
     that renders the row, dispatches an `error` event on the `<img>`, and
     asserts the placeholder `<div>` is now in the DOM.
   - `person-preview.spec.ts`: same fixture cleanup, same URL assertion.
   - `cmdk-recent.spec.ts`: drop the `thumbnailAssetId` field from sample
     entries.
   - `global-search-manager.svelte.spec.ts`: lines 818, 2565, 2568 assert
     on `faceAssetId` directly — rewrite assertions to check `id` +
     `name` instead.
   - `recent-row.spec.ts`: no behavioural change expected; confirm the
     render still passes.

### Edge cases

- **Recents persisted before this change**: covered by step 4 — stored
  `thumbnailAssetId` field is harmless clutter on read; new writes won't
  include it.
- **Deleted person**: `getPeopleThumbnailUrl` returns a URL that 404s.
  Handle via the `failed` state + `onerror` pattern in step 1 → swap to
  the placeholder `<div>` (same UX shape as today, just triggered on
  network failure rather than missing field).
- **No `updatedAt` on recents**: `getPeopleThumbnailUrl(person, updatedAt)`
  cache-busts via `updatedAt ?? person.updatedAt`. Recent entries don't
  carry either, so the URL gets `updatedAt=undefined` → `createUrl` drops
  the param. Acceptable: recents are short-lived snapshots, and a thumbnail
  refresh on the live People page already busts the cache there. No need
  to extend the recent payload.
- **Shared-space people**: Spaces have their own `space_person` records.
  The current cmdk palette queries global people only (via smart search
  and search suggestions), so this fix does not need to disambiguate.

## Issue 2 — `@ # / >` prefixes are not discoverable

### Symptom

Users don't realise the prefixes exist. The only UI surface is a small
footer chip (`cmdk_scope_hint_footer`) and the `?` shortcut modal — both
require the user to look past the search input.

### Fix

Update the `cmdk_placeholder` i18n value from `"Search Gallery"` to:

```
Search Gallery — try @ for people, # tags, / albums, > pages
```

This is the most prominent surface on a fresh palette open, and a full
decomposition of each prefix → entity mapping is more educational than
a terse `@ # / >` chip. The footer chip stays as secondary reinforcement.

### Translation

`en.json` only; other locales inherit via fallback until re-translated.
Standard i18n flow.

### Trade-off

The placeholder is 62 chars and _will_ visually truncate on small
viewports (e.g. iPhone SE 360px renders ~30 chars). In LTR locales this
clips the tail (`/ albums, > pages`) — the high-value `try @ for people, #
tags` segment stays visible. In RTL locales the clip flips and may swallow
the prefix hint. Accepted: same string for all locales, no mobile-specific
fork. If RTL feedback comes in, we can revisit with a shorter string for
those locales.

## Out of scope

- First-run tooltip / callout animation for scope prefixes. Premature.
- Hover tooltips on the footer chip expanding each glyph. The placeholder
  already carries the full mapping; doubling up adds noise.
- Reworking `cmdk_helper` (the "Start typing — photos, people, places,
  tags." line). That string only renders when recents **and** quick links
  are both empty, which almost never happens in practice.

## Delivery shape

- Single branch: `fix/cmdk-people-thumbnails` (housing both commits).
- Two commits, in order:
  1. `fix(web): cmdk palette person thumbnails`
  2. `feat(web): cmdk placeholder hints scope prefixes`
- One PR, standard CI (`pnpm --filter=immich-web test` + lint + tsc).
- No server / SDK / DB changes. No OpenAPI regen.
