# People view sort option — design (issue #676)

**Issue:** [#676 — \[UX\] People view: sort order inconsistent between iOS and web](https://github.com/open-noodle/gallery/issues/676)

## Context

The People view sorts differently per platform:

- **Web** (`web/src/lib/utils/people-utils.ts:19-55`, applied client-side in
  `web/src/routes/(user)/people/+page.svelte:273`): hidden last, favorites first, named people
  A–Z (case-insensitive), unnamed people by asset count descending.
- **iOS/Android** (`mobile/lib/infrastructure/repositories/people.repository.dart:53-56`, local
  Drift query): named people first, then by recognized-face count descending. No favorites tier.

The issue asks for a user-controlled sort with two modes — by name (A–Z) and by frequency (most
photos first) — and, at minimum, an aligned default across platforms.

**Key data facts discovered during exploration:**

- Web always fetches people via `getAllPeople({ withHidden: true, withSharedSpaces: true })`
  (`web/src/routes/(user)/people/+page.ts:9-11`). The `withSharedSpaces` path
  (`server/src/repositories/face-identity.repository.ts:1949`) populates `numberOfAssets` for
  **every** returned person — own people included — so web already has a per-person photo count
  to sort by. **No server change is required.**
- Mobile reads people from its local Drift database, not the listing endpoint, and already has
  per-person face counts (`faces.id.count()`).
- The mobile person entity already has `isFavorite`
  (`mobile/lib/infrastructure/entities/person.entity.dart:21`), so a favorites tier on mobile is
  a pure `ORDER BY` change.

## Goals

1. User-controlled sort on the People view with two modes: **Name (A–Z)** and **Most photos**.
2. Identical default and identical tier model on web and mobile.
3. The choice persists per device and survives restarts.

## Non-goals

- Server API changes (`GET /people` sort parameter) — both clients sort client-side.
- Syncing the preference across devices (see Decisions).
- Changing the person picker (`person_picker.page.dart` — purpose-built A–Z list with letter
  scrubber), the recent-people strip, or search relevance ordering.
- Fixing the pre-existing web limitation that client-side sort only covers loaded pages
  (default page size 500; see Follow-ups).

## Decisions

These were resolved from the issue text and codebase precedent; flagged here for review.

1. **Default = Most photos, on both platforms.** This is the issue's own recommendation
   ("the default could remain frequency-based — current iOS behavior"). It **changes the web
   default** from alphabetical; web users who prefer A–Z switch once and the choice persists.
   To flip this decision, change one constant per platform (the store/setting default).
2. **Per-device persistence, no server sync.** Every existing view preference follows this
   pattern: web `albumViewSettings` in localStorage (`web/src/lib/stores/preferences.store.ts`),
   mobile `Setting<T>` via the settings store (timeline grouping, #625). A server-synced
   `UserPreferences.people.sortBy` would add server + OpenAPI + two client integrations for
   marginal value once defaults align. Revisit if users ask for sync.
3. **Unified tier model in both modes:** favorites → named → unnamed (hidden people stay
   excluded/last, unchanged per platform). This adds a favorites-first tier on mobile — a small,
   deliberate deviation from today's iOS order, matching web and making favorites useful.
4. **No ascending/descending flip.** Each mode has one sensible direction (A–Z, most-first).
   The albums-style direction toggle is omitted (YAGNI).

## Approaches considered

| Approach                                                                | Verdict                                                                                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Client-side sort + per-device preference (chosen)**                | Zero API churn, fully independent web/mobile slices, follows both platforms' existing view-preference patterns.                           |
| B. `orderBy` param on `GET /people`, server sorts                       | Doesn't help mobile (local DB); web still sorts client-side over loaded pages. Only useful for the >500-people pagination case (follow-up). |
| C. Server-synced preference (`UserPreferences.people.sortBy`)           | Best cross-device story, most churn (server DTO + OpenAPI regen + both clients). Deferred; aligned defaults already fix the issue's core complaint. |

## Sort semantics (both platforms)

Tiers apply in both modes; the mode only changes ordering **within** a tier.

| Tier             | Name (A–Z) mode                            | Most photos mode                            |
| ---------------- | ------------------------------------------ | ------------------------------------------- |
| 1. Favorites     | first (then rules below within the tier)   | first (then rules below within the tier)    |
| 2. Named people  | name A–Z, case-insensitive, locale-aware   | photo count desc, ties → name A–Z, then id  |
| 3. Unnamed people| photo count desc, ties → id                | photo count desc, ties → id                 |
| Hidden people    | unchanged: excluded (mobile) / filtered with existing toggle (web) | same                |

Whitespace-only names count as unnamed (existing web behavior, `getSortablePersonName`).

**Count metric per platform:** web uses `numberOfAssets` (distinct accessible assets, falling
back to `assetCount ?? 0` for space-scoped shapes — existing `getSortablePersonCount`); mobile
uses visible face rows (`faces.id.count()`, existing metric). The metrics differ slightly
(faces vs distinct assets) but both read as "how often this person appears"; exact parity is not
required for ordering.

## FE design

Design direction (from the frontend-design pass): **native coherence**. This is a utility
control inside two established design systems; it must look like it shipped with the page.
Craft goes into placement, alignment, states, and exact reuse of each platform's sort idiom —
not into novel visual language.

### Web

- **Component:** reuse `$lib/elements/Dropdown.svelte` exactly as the albums page does
  (`web/src/routes/(user)/albums/albums-controls.svelte:142-151`): a small ghost/secondary
  button showing the active mode's label + icon, opening a menu with a check on the selected
  option.
- **Placement:** in the `buttons()` snippet of `web/src/routes/(user)/people/+page.svelte`
  (lines 425–451), between the `SearchPeople` field and the "Show & hide people" button. The
  same control goes in the `buttons()` snippet of
  `web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte` (line 440).
- **Options & icons** (per-option icon shown on both trigger and menu row):
  - Name — `mdiSortAlphabeticalAscending`, label: existing `name` key ("Name")
  - Most photos — `mdiSortNumericDescending`, label: new `sort_people_most_photos` key
  - Dropdown title: new `sort_people_by` key ("Sort people by...")
- **Behavior:** selection updates the persisted store; the grid re-sorts reactively via
  `$derived` (applies to the searched list too, matching today's behavior). No scroll
  manipulation, no reorder animation — identical to the albums page repaint behavior. The
  control stays visible at all viewport widths (the search field already collapses below `sm`).
- **Accessibility:** `Dropdown.svelte` is the existing accessible menu-button primitive;
  nothing new beyond translated labels.

### Mobile

- **Trigger:** an `IconButton` (`Icons.swap_vert`, tooltip `sort_people_by`) added to the
  `AppBar` actions of `drift_people_collection.page.dart`, placed before the search action.
- **Menu:** `MenuAnchor` styled identically to the albums sort menu
  (`mobile/lib/presentation/widgets/album/album_selector.widget.dart:233+`): menu elevation 1,
  border radius 24, padding 4; items radius 12 with padding `LTRB(12, 12, 24, 12)`; selected
  item gets `colorScheme.primary` background and `onPrimary` text; unselected items use
  `labelLarge` at `onSurface.withAlpha(185)`.
- **Selection indicator:** leading `Icons.check_rounded` on the selected item and a transparent
  placeholder icon on the unselected one (the albums menu's alignment trick). The albums menu's
  direction arrows don't apply — these modes are fixed-direction.
- **Items:** `name` ("Name") and `sort_people_most_photos` ("Most photos").
- **Behavior:** tapping an item writes the setting via
  `ref.read(settingsProvider.notifier).set(...)`; the people provider watches the setting and
  re-queries; the grid rebuilds in the new order (no custom animation, matching the albums
  selector).

### i18n (shared `i18n/en.json`, used by both platforms)

```json
"sort_people_by": "Sort people by...",
"sort_people_most_photos": "Most photos"
```

`name` ("Name") already exists and is reused. Keys must stay alphabetically sorted
(`sort_people_by` and `sort_people_by_similarity` sort before `sort_people_most_photos`); run
the i18n format check before committing.

---

## Slice 1 — Web

All work in `web/` plus the two i18n keys. No SDK or OpenAPI changes.

1. **Preference store** (`web/src/lib/stores/preferences.store.ts`):
   - `export enum PeopleSortBy { PhotoCount = 'photoCount', Name = 'name' }`
   - `export interface PeopleViewSettings { sortBy: PeopleSortBy }`
   - `export const peopleViewSettings = persistedObject<PeopleViewSettings>('people-view-settings', { sortBy: PeopleSortBy.PhotoCount })`
2. **Comparator** (`web/src/lib/utils/people-utils.ts`): parameterize the existing comparator —
   `comparePeople(a, b, sortBy)` / `sortPeople(people, sortBy)` — preserving the hidden →
   favorite → named tiers and the unnamed-by-count rule, adding the within-named branch per the
   semantics table. Update the two call sites (`sortPeopleForManagement` has exactly two
   consumers: the people page and the spaces people page).
3. **People page** (`web/src/routes/(user)/people/+page.svelte`): add the `Dropdown` control to
   the `buttons()` snippet; derive `showPeople` from `$peopleViewSettings.sortBy`.
4. **Spaces people page** (`web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte`): same
   store, comparator, and control.
5. **i18n:** add the two keys to `i18n/en.json`.
6. **Tests:**
   - `people-utils.spec.ts`: both modes × tiers (favorites, named/unnamed, whitespace-only
     names, missing counts → 0, ties).
   - `people-page.spec.ts`: control renders; switching mode reorders the grid; choice persists
     (store-backed).

**Verification:** `pnpm -C web test -- --run src/lib/utils/people-utils.spec.ts src/routes/\(user\)/people/people-page.spec.ts`, `make check-web`. Note CI "Lint Web" is a separate
`eslint --max-warnings 0` gate not covered by `check-web`.

**Acceptance criteria:**

- /people defaults to Most photos order (favorites first, named-by-count, unnamed last).
- Switching to Name reorders instantly and survives reload (localStorage).
- Spaces people page honors the same preference.
- Search-filtered results follow the selected sort.

## Slice 2 — Mobile

All work in `mobile/` (the i18n keys land in Slice 1; if this slice ships first, add them here
instead). No OpenAPI regen — nothing in the API changes.

1. **Store key** (`mobile/lib/domain/models/store.model.dart`): append
   `peopleSortBy` with the next free integer id (ids are append-only).
2. **Setting** (`mobile/lib/domain/models/setting.model.dart`):
   `peopleSortBy<int>(StoreKey.peopleSortBy, 0)` with a small domain enum
   `PeopleSortBy { photoCount, name }` (index 0 = photoCount = default) and a
   `fromSettingIndex` helper — same shape as timeline grouping (#625).
3. **Repository** (`mobile/lib/infrastructure/repositories/people.repository.dart`):
   `getAllPeople({ PeopleSortBy sortBy })` with two `orderBy` lists (filters/`having` clause
   unchanged):
   - photoCount: `isFavorite desc, name != '' desc, faces.id.count() desc, name.lower() asc, id`
   - name: `isFavorite desc, name != '' desc, name.lower() asc, faces.id.count() desc, id`
     (named tier ties on equal names are negligible; the count term orders the unnamed tier,
     whose names are all empty)
4. **Service** (`mobile/lib/domain/services/people.service.dart`): pass the mode through.
5. **Provider** (`mobile/lib/providers/infrastructure/people.provider.dart`):
   `driftGetAllPeopleProvider` watches
   `settingsProvider.select(...)` for the sort setting and passes it to the service — a settings
   write invalidates and re-queries automatically.
6. **UI** (`mobile/lib/presentation/pages/drift_people_collection.page.dart`): add the
   `_PeopleSortButton` AppBar action per the FE design.
7. **Tests:**
   - Repository test with an in-memory Drift DB (precedent:
     `mobile/test/infrastructure/repositories/local_album_repository_test.dart`): both
     orderings, favorites tier, named/unnamed tiers, hidden exclusion unchanged.
   - Widget/provider test: menu selection writes the setting and reorders (precedent: the
     timeline grouping selector tests from #625/#674).

**Verification:** `dart analyze --fatal-infos lib test` (use the mise-pinned Flutter at
`~/.local/share/mise/installs/flutter/<ver>/bin`; bare `dart analyze` pulls in
`packages/ui/showcase`), `flutter test`.

**Acceptance criteria:**

- People view defaults to Most photos with favorites first (note: favorites-first is a small
  change from today's iOS order).
- Switching to Name shows favorites first, then A–Z, unnamed last; persists across app restarts.
- Hidden-people and ≥3-faces-or-named inclusion rules unchanged.

## Follow-ups (explicitly out of scope)

- **Web >500-people libraries:** the client sorts only loaded pages (pre-existing). True
  server-side sorted pagination would need an `orderBy` param on `GET /people`
  (approach B) — file separately if it bites.
- **Server-synced preference** (approach C) if cross-device sync is requested.
- **Other surfaces** (person picker, recent-people strip, search-page people row) keep their
  purpose-built orders.
