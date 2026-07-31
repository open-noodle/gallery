# Mobile Filter Parity — Collapsible, Searchable, Scalable Filters

**Date:** 2026-07-07
**Status:** Design approved (brainstorming complete) — ready for implementation planning
**Scope:** Fork mobile app (`mobile/lib/presentation/widgets/filter_sheet/`, `mobile/lib/presentation/pages/photos_filter/`, `mobile/lib/providers/photos_filter/`, plus small server-field plumbing on the mobile side only)
**Interactive prototype:** `docs/superpowers/specs/2026-07-07-mobile-filter-parity-mockup.html` (open in a browser; tap the deep-sheet section headers to try collapse)
**Tracking issue:** [#473 — Filter panel in iOS app not collapsible and not searchable](https://github.com/open-noodle/gallery/issues/473)
**Parity target:** the web filter panel (`web/src/lib/components/filter-panel/`) and its redesign spec `docs/superpowers/specs/2026-06-17-filter-panel-redesign-design.md`.

> **Visual source of truth.** The interactive mockup is the **canonical UI reference** for this work. Every section, picker, and interaction must reproduce its layout and anatomy. The "UI anatomy" section below transcribes each screen so this spec is self-contained, and every slice deep-links the exact mockup screen it builds. **Any deviation from the mockup requires explicit sign-off and a spec update** — the implementation plan must not invent alternative layouts. When prose and mockup disagree, the mockup wins. The plan produced from this spec must carry these mockup references into each slice's acceptance criteria.

## Problem

The mobile filter sheet renders **every** person, place and tag in a single flat, unbounded, non-collapsible, non-searchable list. From the issue reporter:

> "With hundreds of people, thousands of locations, and thousands or tens of thousands of tags, navigating the filters is very difficult because the filters cannot be opened and closed (collapsed)."

Concretely, in the live UI (the fork's custom `FilterSheet`, not the dead upstream `widgets/search/search_filter/`):

- **Everything renders eagerly, unbounded.** The deep sheet builds a `Wrap` over the full server list for People (`deep/people_section.widget.dart:47`), Places countries **and** cities (`deep/places_cascade_section.widget.dart:50` & `:98`), and Tags (`deep/tags_section.widget.dart:29`). The browse strips do the same with horizontal `ListView`s (`strips/people_strip.widget.dart:30`, `strips/places_strip.widget.dart:27`). The server applies no `LIMIT` (`search.repository.ts` `buildFilteredGlobalPeopleQuery`, `getFilteredCountries`, `getFilteredTags`), and the client applies no cap or windowing. With thousands of items this builds thousands of widgets at once.
- **No collapse, no hide.** Deep sections cannot be collapsed or removed. To reach "Media type" you scroll past every person and place. This is the exact ask in the issue title.
- **No search, and an inconsistent People escape hatch.** There is no inline "Search people / locations". People _does_ have a good full-screen picker (`pages/photos_filter/person_picker.page.dart`: search field + A–Z scrubber + selected/recent strips), but it reads the **local Drift** owner-scoped list (`peoplePickerAllProvider` → `driftGetAllPeopleProvider`), so it **misses shared-space people** and shows a different set than the sheet's server-sourced preview. **Places and Tags have no picker at all**, and **Camera (make/model) has no mobile UI at all**, despite existing in `SearchFilter` and the server suggestions payload.

## Goals

1. **Collapsible sections** — every deep section can be expanded/collapsed, remembered across sessions (web parity: `expanded-sections`).
2. **Hideable sections** — users can remove whole filter categories from the sheet (web parity: `visible-sections`), reachable from a clear entry point.
3. **Bounded rendering** — cap every preview to the first N items with an escalation path; never build thousands of widgets.
4. **Search at scale** — a dedicated full-screen searchable picker for each large dimension: People, Places, Tags, and the new Camera.
5. **Consistency & correctness** — the People picker sources the same server people (incl. shared spaces) as the sheet; no fabricated data; **no new network calls** beyond what already happens (lazy per-country / per-make only, exactly as web).
6. **Stay with reality** — do not restructure surfaces that already work (notably active-filter chips), and keep changes minimal until the core lands.

## Non-Goals (YAGNI)

- **Do not move active-filter chips into the sheet.** They stay exactly as today — the timeline subheader `PhotosFilterSubheader` (`presentation/widgets/photos_filter/filter_subheader.widget.dart`). (Locked with Pierre 2026-07-07.)
- **No multi-select for Places or Camera.** `SearchLocationFilter` and `SearchCameraFilter` are single-value (`models/search/search_filter.model.dart:9`, `:52`); web is single-select too. Keeping single-select is parity and low-risk.
- **No new server endpoints or `LIMIT` changes.** All data comes from existing endpoints (`getFilterSuggestions`, `getSearchSuggestions`, `getAllPeople?withSharedSpaces=true`, `getAllTags`).
- **No per-person stats call.** The photo count is taken from a field already in the response (see Data availability), never a separate `PersonStatistics` call.
- **No redesign of the timeline, no new filter dimensions** beyond Camera.

## Decisions (locked during brainstorming, 2026-07-07)

| Decision                    | Choice                                                                              | Why                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Search UX                   | **Full-screen picker per dimension**                                                | Best keyboard/long-list ergonomics on mobile; extends the pattern People already has. Typing in a draggable sheet is cramped. |
| Camera                      | **Include it**                                                                      | Closes the last gap vs the web filter panel; full parity in one effort.                                                       |
| Collapse model              | **Accordion + hide whole sections**                                                 | Full web parity — two independent axes (`expanded-sections` + `visible-sections`).                                            |
| People data source          | **Server + shared spaces** (`getAllPeopleWithSharedSpaces`), Drift fallback offline | Fixes the shared-space omission; consistent with the sheet's server-sourced preview and the People page.                      |
| Active-filter chips         | **Unchanged** (timeline subheader)                                                  | Stay with the current codebase; minimal changes before core lands.                                                            |
| Places / Camera cardinality | **Single-select**                                                                   | Matches the data model and web.                                                                                               |
| Cities / camera models      | **Lazy on expand only**                                                             | We do not have them upfront; fetch per-country / per-make on demand (web parity).                                             |
| Per-person photo count      | **Show it** (from `numberOfAssets`)                                                 | Already returned by the shared-spaces endpoint — no extra call (see below).                                                   |

## Data availability (verified against the codebase, 2026-07-07)

These findings shaped the decisions above — they guarantee **no extra network round-trips**.

| Data                              | Available before user action? | Source                                                                                                                                                         | Notes                                                                                                                                                                                                                                     |
| --------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Countries**                     | ✅ Yes                        | `getFilterSuggestions().countries` (`FilterSuggestionsResponseDto`, `search.dto.ts:239`)                                                                       | Names only.                                                                                                                                                                                                                               |
| **Camera makes**                  | ✅ Yes                        | `getFilterSuggestions().cameraMakes`                                                                                                                           | Names only.                                                                                                                                                                                                                               |
| **Cities**                        | ❌ No — lazy                  | `getSearchSuggestions(city, country)` via `citySuggestionsProvider` (`providers/photos_filter/city_suggestions.provider.dart:9`)                               | Fetched per-country on expand/search (≥2 chars), exactly like web `location-filter.svelte` (`ensureCities`).                                                                                                                              |
| **Camera models**                 | ❌ No — lazy                  | `getSearchSuggestions(cameraModel, make)`                                                                                                                      | Needs a **new** `cameraModelSuggestionsProvider(make)` mirroring `citySuggestionsProvider`.                                                                                                                                               |
| **Per-country / per-make counts** | ❌ No                         | —                                                                                                                                                              | Not in any response. Do **not** display counts.                                                                                                                                                                                           |
| **Per-person photo count**        | ✅ Yes, **no extra call**     | `numberOfAssets` on `PersonResponseDto` (`person.dto.ts:129`), returned by `getAllPeople?withSharedSpaces=true` (`face-identity.repository.ts:1833/1948/1983`) | Currently **discarded** by `_personToDriftPerson` (`repositories/person_api.repository.dart:91`). To show it: add a nullable count field to `DriftPerson` and stop dropping it. Absent on the local-Drift offline path → hide gracefully. |
| **Full tag list**                 | ✅ Yes                        | `tagProvider` → `TagService.getAllTags()` → `Set<Tag>` (`domain/services/tag.service.dart:16`)                                                                 | Flat; `Tag.value` is the full hierarchical path. Distinct from the context-narrowed `photosFilterSuggestionsProvider.tags`.                                                                                                               |
| **Shared-space people**           | ✅ Yes                        | `driftGetAllPeopleWithSharedSpacesProvider` → `getAllPeopleWithSharedSpaces` (`providers/infrastructure/people.provider.dart:55`)                              | Server-sourced, RBAC-projected, Drift fallback offline.                                                                                                                                                                                   |

## Architecture & component changes

The live surfaces are the draggable `FilterSheet` with two snaps — **Browse** (`browse_content.widget.dart`) and **Deep** (`deep_content.widget.dart`) — plus full-screen pickers under `pages/photos_filter/` routed in `routing/router.dart`. State is `SearchFilter` (`models/search/search_filter.model.dart`) via `photosFilterProvider` (`providers/photos_filter/photos_filter.provider.dart`).

### A. Section shell (collapse + hide)

- A **section registry** enumerates the deep sections in order: `people, places, tags, camera, when, rating, media, toggles`. Each entry knows its title, icon, and an "is-empty" predicate.
- **Collapse:** wrap each section in an accordion (chevron header + height-slide body, matching web `filter-section.svelte` / the app's `setting-accordion`). Expanded/collapsed state is a persisted set (mirror web's `expanded-sections`), stored via the app's existing preference mechanism. Empty sections auto-collapse and disable (show `(0)`).
- **Hide:** a **Manage Sections** bottom sheet toggles which sections appear; the visible set is persisted (mirror web's `visible-sections`). Reached from a **⚙ "manage" icon in the deep-sheet header, next to "Reset"** (deep snap only). Hidden sections are not built; their active filters keep applying and remain removable via the existing timeline chips.

### B. Capped previews

- Each deep section renders only the first N of its suggestion list (People **6**, Places/Tags/Camera **10** — matching web counts), followed by a **"Search N →"** row that opens that dimension's picker. Selected-but-hidden items are pinned and shown checked (web's "orphan" handling).
- Browse strips cap identically: first N tiles + a trailing **"+N / more"** tile that opens the same picker.

### C. Full-screen pickers (one shared anatomy)

A shared scaffold: nav bar (back + title + Done), a search field, optional contextual strips (Selected / Recent), and a **windowed** list (`ListView.builder`, never `Wrap`) that scales to any size. New/updated per dimension:

- **People** (`person_picker.page.dart`, exists): switch `peoplePickerAllProvider` from `driftGetAllPeopleProvider` → the shared-spaces source; carry `numberOfAssets` onto `DriftPerson` for the count; keep search + A–Z scrubber + Selected/Recent; multi-select → `SearchFilter.people`.
- **Places** (new page + route): countries upfront; expand a country → `citySuggestionsProvider(country)` lazy-loads its cities; search matches countries + loaded cities (≥2 chars triggers city fetch, debounced, like web); single-select (selecting a city also selects its country) → `SearchLocationFilter`.
- **Tags** (new page + route): `tagProvider` (full flat list, `value` = full path); client-side substring search; multi-select → `SearchFilter.tagIds`; windowed list for tens of thousands.
- **Camera** (new section + new page + route): makes upfront; new `cameraModelSuggestionsProvider(make)` lazy-loads models on expand; single make + single model → `SearchCameraFilter`.

### D. State & providers

- `SearchFilter` already supports all four dimensions (`people`, `location`, `tagIds`, `camera`); no model change except the new `DriftPerson.numberOfAssets` field.
- New providers: `cameraModelSuggestionsProvider(make)`; persisted `expandedSectionsProvider` and `visibleSectionsProvider` (section-shell state).
- `chip_id.dart` / `removeChip` already cover every dimension incl. camera/location — no change needed for the timeline chips.

### E. Cleanup (optional, last)

- The dead upstream `widgets/search/search_filter/` (people/location/camera/media/star pickers) and its providers (`providers/search/people.provider.dart`, `search_filter.provider.dart`, `search_page_state.provider.dart`) are unreferenced. Delete to reduce confusion.

## UI anatomy — the mockup is the source of truth

Each surface below transcribes the corresponding screen in `2026-07-07-mobile-filter-parity-mockup.html`. Implementation must reproduce this layout; the anchors deep-link the exact screen. (Visual styling — spacing/colour/typography — follows the app's own design system, not the mockup's demo fonts; the mockup governs **layout, elements, and interaction**, mirroring how the web redesign spec treats its prototype.)

### Deep sheet — [`#mockup-deep`](2026-07-07-mobile-filter-parity-mockup.html#mockup-deep)

- Header row: grabber; title "Filter"; a **⚙ manage icon** and **"Reset"** on the right.
- Accordion sections in this order: **People, Places, Tags, Camera, When, Rating, Media type, Toggles**.
- Section header: title (left), optional count (right), chevron that rotates (−90° when collapsed). Collapsed → header only. Empty → "(0)" and disabled.
- People (expanded): capped **6-avatar** grid (circular; selected shows a ✓ badge) then an amber **"Search N people →"** row (magnifier + label + → arrow).
- Places / Tags / Camera (expanded): capped **chip cloud** (first 10; selected chip filled) then a **"Search N →"** row.
- Rating: five tappable stars. Media type: segmented **All / Photos / Videos**. Toggles: switch rows.
- Sticky footer: "N results" (left) + amber **"Done"** button (right).

### Browse snap — [`#mockup-browse`](2026-07-07-mobile-filter-parity-mockup.html#mockup-browse)

- Header: grabber; title "Filter"; "Reset".
- A global text search bar ("Search your library…").
- Horizontal **strips**: People (circular avatars, capped, trailing **"+N / all"** tile), Places (rounded gradient tiles, capped, trailing "+N"), etc. The trailing tile opens that dimension's picker.
- **Active-filter chips render on the timeline above the sheet** (existing `PhotosFilterSubheader`), never inside the sheet.

### People picker — [`#mockup-people-picker`](2026-07-07-mobile-filter-parity-mockup.html#mockup-people-picker)

- Nav bar: back "‹", title "People", "Done".
- Search field (magnifier + placeholder / live query).
- **"Selected · N"** strip of avatars (and a Recent strip when applicable).
- **A–Z alpha scrubber** pinned to the right edge.
- Bucketed list (A, B, …): each row = avatar + name + **"N photos"** subtitle (from `numberOfAssets`; hidden offline) + a **checkbox** (✓ when selected; multi-select).

### Places picker — [`#mockup-places-picker`](2026-07-07-mobile-filter-parity-mockup.html#mockup-places-picker)

- Nav bar: back, "Places", "Done".
- Search field ("Search country or city…").
- Bucket label: "COUNTRIES · from filter suggestions (already loaded)".
- Country row: swatch + name + **expand chevron** (▾ collapsed / ▴ expanded). Expanding a country reveals **indented city rows with radios** (single-select). A subtle "cities fetched on expand" hint conveys the lazy load; no counts shown.

### Tags picker — [`#mockup-tags-picker`](2026-07-07-mobile-filter-parity-mockup.html#mockup-tags-picker)

- Nav bar: back, "Tags", "Done".
- Search field (live query).
- **"Selected · N"** chip cloud (selected tag shows its full path + ✕).
- "MATCHES" bucket; each row = tag name + **full-path subtitle** + checkbox (multi-select).

### Camera picker — [`#mockup-camera-picker`](2026-07-07-mobile-filter-parity-mockup.html#mockup-camera-picker)

- Nav bar: back, "Camera", "Done".
- Search field ("Search make or model…").
- Bucket label: "MAKE · from filter suggestions (already loaded)".
- Make row: name + **expand chevron**. Expanding a make reveals **indented model rows with radios** (single-select make + single model). "models fetched on expand" hint; no counts shown.

### Manage sections — [`#mockup-manage-sections`](2026-07-07-mobile-filter-parity-mockup.html#mockup-manage-sections)

- Nav bar: title "Manage sections", "Done".
- One row per section: leading icon + name + status subtitle ("Shown" / "Hidden" / "Shown · has N active") + a **toggle switch**.

## Slicing

Seven independently shippable, independently testable slices. **Slice 1 alone resolves the headline "collapsible" ask;** the picker slices (3–6) are largely parallelizable once the shell exists.

```
Slice 1 (Collapse)  ──►  Slice 2 (Hide/Manage Sections)
      │
      ├──►  Slice 3 (People picker + cap)
      ├──►  Slice 4 (Places picker + cap)
      ├──►  Slice 5 (Tags picker + cap)
      └──►  Slice 6 (Camera section + picker + cap)
                              │
                              └──►  Slice 7 (Retire dead upstream UI)
```

| #   | Slice                           | Delivers                                                                                                                      | Depends on | Touches                                                                                                                                   |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Collapsible sections**        | Accordion collapse/expand for all deep sections; persisted state; empty auto-collapse. Pure UI.                               | —          | section shell, `deep_content`, deep section widgets, new persisted `expandedSectionsProvider`                                             |
| 2   | **Manage Sections (hide/show)** | ⚙ entry + manage sheet; persisted visibility; hidden sections not built; filters still removable via timeline chips.          | 1          | section registry, `deep_content` header, new sheet, `visibleSectionsProvider`                                                             |
| 3   | **People picker + cap**         | Cap People preview (6) + "Search N →"; picker → server+shared-spaces source; `numberOfAssets` count. Cap browse People strip. | 1          | `people_section`, `people_strip`, `person_picker.page`, `people_picker.provider`, `DriftPerson`, `person_api.repository`                  |
| 4   | **Places picker + cap**         | New Places picker (countries upfront, lazy cities, single-select); cap Places preview/strip + "Search N →".                   | 1          | `places_cascade_section`, `places_strip`, new `places_picker.page` + route, `city_suggestions.provider`                                   |
| 5   | **Tags picker + cap**           | New Tags picker (`getAllTags`, search, multi-select, windowed); cap Tags preview/strip + "Search N →".                        | 1          | `tags_section`, `tags_strip`, new `tags_picker.page` + route, `tag.provider`                                                              |
| 6   | **Camera dimension**            | New Camera section + browse strip + picker (makes upfront, lazy models, single make+model); new provider.                     | 1          | new `camera_section`, `camera_strip`, `camera_picker.page` + route, new `cameraModelSuggestionsProvider`, `deep_content`/`browse_content` |
| 7   | **Retire dead upstream UI**     | Delete unreferenced `widgets/search/search_filter/` + its providers.                                                          | 3–6        | deletions only                                                                                                                            |

**Each slice reproduces a specific mockup screen** — that screen's layout (see "UI anatomy") is the slice's visual acceptance bar:

- **Slice 1** → accordion headers/chevrons + capped previews in the [Deep snap](2026-07-07-mobile-filter-parity-mockup.html#mockup-deep).
- **Slice 2** → the [Manage sections](2026-07-07-mobile-filter-parity-mockup.html#mockup-manage-sections) screen + the ⚙ entry in the [Deep snap](2026-07-07-mobile-filter-parity-mockup.html#mockup-deep).
- **Slice 3** → the [People picker](2026-07-07-mobile-filter-parity-mockup.html#mockup-people-picker) + the People section in the [Deep](2026-07-07-mobile-filter-parity-mockup.html#mockup-deep) / [Browse](2026-07-07-mobile-filter-parity-mockup.html#mockup-browse) snaps.
- **Slice 4** → the [Places picker](2026-07-07-mobile-filter-parity-mockup.html#mockup-places-picker).
- **Slice 5** → the [Tags picker](2026-07-07-mobile-filter-parity-mockup.html#mockup-tags-picker).
- **Slice 6** → the [Camera picker](2026-07-07-mobile-filter-parity-mockup.html#mockup-camera-picker) + the new Camera section in the [Deep snap](2026-07-07-mobile-filter-parity-mockup.html#mockup-deep).
- **Slice 7** → no UI (deletions only).

## Development approach

### Test-Driven Development (TDD)

Every slice is implemented **test-first**. For each behavior:

1. Write a failing test (Flutter widget test for UI, provider/unit test for logic) expressing the BDD scenario below.
2. Implement the minimum to make it pass.
3. Refactor with the test green.

Test layers per slice:

- **Widget tests** (`flutter test`) for each section and picker: rendering, cap behavior, tap → collapse/expand, tap → navigate-to-picker, selection toggling, empty/loading/error states.
- **Provider/unit tests** for persistence (`expandedSectionsProvider`, `visibleSectionsProvider`), the new `cameraModelSuggestionsProvider`, the `DriftPerson.numberOfAssets` mapping, and single- vs multi-select mutations on `SearchFilter`.
- **Golden/interaction** where useful (A–Z scrubber jump, windowed list of 10k tags stays responsive).

Local run (per CLAUDE.md; the generated `lib/generated/*.g.dart` are gitignored, so regenerate once): from `mobile/` with Flutter **3.44.1** — `flutter pub get`, then `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`, then `flutter test <path>`. CI runs `dart analyze --fatal-infos` over `lib` **and** `test`.

### Behavior-Driven Development (BDD)

Every use case is specified below as Given/When/Then. Each scenario maps to at least one TDD test. Scenarios are grouped by surface/slice.

---

### BDD — Slice 1: Collapsible sections

**Scenario: Collapse an expanded section**

- Given the deep filter sheet is open and the "People" section is expanded
- When I tap the "People" section header
- Then the section body collapses with a height-slide, the chevron rotates to the collapsed state, and the body content is removed from layout.

**Scenario: Expand a collapsed section**

- Given the "Places" section is collapsed
- When I tap the "Places" section header
- Then the body expands with a height-slide and the chevron rotates to the expanded state.

**Scenario: Collapsed state persists across app restarts**

- Given I have collapsed the "Tags" section
- When I close the sheet and reopen the app
- Then the "Tags" section is still collapsed.

**Scenario: An empty section auto-collapses and is disabled**

- Given the current filter context yields zero tag suggestions
- Then the "Tags" header shows a "(0)" affordance, is rendered collapsed, and tapping it does not expand it.

**Scenario: A section that becomes non-empty is re-enabled**

- Given the "Tags" section was empty and disabled
- When the filter context changes so tags are available
- Then the "Tags" header is enabled and can be expanded (respecting the user's last explicit expand/collapse choice, else the default — expanded).

**Note on defaults:** sections default to **expanded** (preserving today's "everything visible" UX and adding collapse on top). Persistence stores the set of **collapsed** section ids (a section is collapsed iff its id is in the stored set); empty sections always render collapsed + disabled regardless of the stored set, and are not written to it.

**Scenario: Reduced-motion disables the slide**

- Given the OS "reduce motion" setting is on
- When I collapse or expand a section
- Then the body shows/hides without an animated height slide.

**Scenario: Reset does not change collapse state**

- Given I collapsed several sections
- When I tap "Reset" (clears the filter)
- Then the filter selections clear but the collapse/expand state is unchanged.

---

### BDD — Slice 2: Manage Sections (hide/show)

**Scenario: Open Manage Sections**

- Given the sheet is at the deep snap
- When I tap the ⚙ "manage" icon next to "Reset"
- Then the Manage Sections sheet opens listing every section with a show/hide toggle.

**Scenario: The manage entry is deep-snap only**

- Given the sheet is at the browse snap
- Then the ⚙ manage icon is not shown.

**Scenario: Hide a section**

- Given the Manage Sections sheet is open and "Camera" is shown
- When I toggle "Camera" off and return to the sheet
- Then the "Camera" section no longer appears in the deep sheet.

**Scenario: Hidden state persists across restarts**

- Given I hid "Camera"
- When I restart the app
- Then "Camera" is still hidden.

**Scenario: Show a hidden section**

- Given "Camera" is hidden
- When I toggle it on in Manage Sections
- Then "Camera" reappears in the deep sheet in its registry position.

**Scenario: A hidden section keeps its active filter**

- Given I selected the tag "Travel" and then hid the "Tags" section
- Then results remain filtered by "Travel", and a removable "Travel" chip is still shown on the timeline subheader.

**Scenario: Default visibility**

- Given a fresh install
- Then all sections are visible.

---

### BDD — Slice 3: People (capped section + picker)

**Scenario: People preview is capped**

- Given the People suggestion set has 243 people
- When the "People" section is expanded
- Then at most 6 people are rendered, plus a "Search 243 people →" row.

**Scenario: Selected-but-hidden person stays visible**

- Given I have selected "Zara", who is not in the first 6
- Then "Zara" is still shown (checked) in the capped preview.

**Scenario: Open the People picker**

- When I tap "Search 243 people →"
- Then the full-screen People picker opens.

**Scenario: Picker includes shared-space people**

- Given a person exists only via a shared space I can view
- When the People picker loads
- Then that person appears in the list (source: `getAllPeopleWithSharedSpaces`).

**Scenario: Search filters the list**

- Given the picker is open
- When I type "al"
- Then only people whose name contains "al" (case-insensitive) are shown.

**Scenario: A–Z scrubber jumps to a bucket**

- Given the picker list is grouped A–Z
- When I drag the scrubber to "M"
- Then the list scrolls to the "M" bucket.

**Scenario: Multi-select toggles a person**

- Given "Bob" is unselected
- When I tap "Bob"
- Then "Bob" becomes checked and is added to `SearchFilter.people`; tapping again removes him.

**Scenario: Photo count is shown without an extra call**

- Given the picker loaded people from the shared-spaces endpoint
- Then each row shows its `numberOfAssets` (e.g. "1,204 photos"), with no additional network request.

**Scenario: Offline fallback hides the count**

- Given the device is offline
- When the People picker loads
- Then it falls back to the local Drift list and rows render without a photo count (no error).

**Scenario: Selected and Recent strips**

- Given I have selected people and recently used others
- Then the picker shows a "Selected" strip and a "Recent" strip above the list.

**Scenario: Done applies the selection**

- When I tap "Done"
- Then the picker closes and the sheet + timeline reflect the selected people.

**Scenario: Empty / no-match states**

- Given there are no people (or my search matches none)
- Then the picker shows an appropriate empty state, not a blank screen.

---

### BDD — Slice 4: Places (capped section + picker)

**Scenario: Places preview is capped, single-select**

- Given many countries are available
- When the "Places" section is expanded
- Then at most 10 countries are shown plus a "Search N places →" row, and at most one country/city can be selected.

**Scenario: Countries load without a fetch**

- When the Places picker opens
- Then the country list renders immediately from the already-loaded suggestions (no network call).

**Scenario: Cities load lazily on expand**

- Given the country "France" is collapsed with no cities loaded
- When I expand "France"
- Then its cities are fetched once via `citySuggestionsProvider('France')`, showing a loading indicator, then the city list.

**Scenario: Search filters countries + already-loaded cities (no proactive city fetch)**

- Given I type "par" in the picker search
- Then the country list is filtered to countries whose name matches, plus any country with an already-loaded (expanded) city that matches; the matching loaded cities are shown.
- And searching does NOT trigger city fetches for un-expanded countries — cities are fetched only when a country is expanded (honoring the "no network call unless the user acts" rule; this intentionally diverges from web's fetch-all-on-search).

**Scenario: Selecting a city selects its country**

- Given "France" is expanded
- When I select the city "Paris"
- Then `SearchLocationFilter` is set to country "France", city "Paris".

**Scenario: Selecting a country only**

- When I select "Spain" without choosing a city
- Then `SearchLocationFilter` is set to country "Spain" with no city.

**Scenario: Single-select replaces prior selection**

- Given "France / Paris" is selected
- When I select "Spain"
- Then the France/Paris selection is cleared and only "Spain" remains.

**Scenario: Per-country fetch error**

- Given expanding "Italy" fails to fetch cities
- Then an inline error/retry is shown for "Italy" only; other countries are unaffected.

**Scenario: Done applies the location**

- When I tap "Done"
- Then the sheet + timeline reflect the single selected location.

---

### BDD — Slice 5: Tags (capped section + picker)

**Scenario: Tags preview is capped**

- Given the Tags suggestion set is large
- When the "Tags" section is expanded
- Then at most 10 tags are shown plus a "Search N tags →" row.

**Scenario: Picker loads the full flat tag list**

- When the Tags picker opens
- Then it lists tags from `getAllTags` (flat), each showing its full path value (e.g. "Travel / Italy / Rome").

**Scenario: Search filters tags**

- When I type "rom"
- Then only tags whose value contains "rom" (case-insensitive) are shown.

**Scenario: Multi-select toggles a tag**

- When I tap a tag
- Then its id is added to `SearchFilter.tagIds`; tapping again removes it.

**Scenario: Selected-but-hidden tag stays removable**

- Given I selected a tag not in the current filtered view
- Then it remains shown as selected and can be deselected.

**Scenario: Large list stays responsive**

- Given tens of thousands of tags
- When I scroll and search
- Then the list uses a builder/windowed list and remains responsive (no full eager build).

**Scenario: Offline**

- Given the device is offline and tags are not cached
- Then the picker shows an empty/error state rather than hanging.

---

### BDD — Slice 6: Camera (new section + picker)

**Scenario: Camera section appears (respecting visibility)**

- Given the Camera section is visible
- When the deep sheet renders
- Then a "Camera" section shows the first 10 makes plus a "Search N cameras →" row.

**Scenario: Makes load without a fetch**

- When the Camera picker opens
- Then makes render immediately from the loaded suggestions (no network call).

**Scenario: Models load lazily on expand**

- Given "Canon" is collapsed
- When I expand "Canon"
- Then its models are fetched once via `cameraModelSuggestionsProvider('Canon')`, with a loading indicator.

**Scenario: Single make + single model**

- When I select make "Canon" and model "EOS R5"
- Then `SearchCameraFilter` is set to make "Canon", model "EOS R5"; selecting a different make/model replaces the prior value.

**Scenario: Make only**

- When I select "Sony" without a model
- Then `SearchCameraFilter` is set to make "Sony" with no model.

**Scenario: Search matches makes and loaded models**

- When I type "eos"
- Then matching makes and already-loaded models are shown.

**Scenario: Done applies the camera filter**

- When I tap "Done"
- Then the sheet + timeline reflect the selected camera.

---

### BDD — Cross-cutting (applies across slices)

**Scenario: Selections surface as timeline chips (unchanged behavior)**

- Given I selected people/places/tags/camera in the pickers
- Then removable chips for each appear on the timeline subheader, and the results are filtered accordingly.

**Scenario: Removing a chip clears that dimension**

- When I tap the × on a chip (e.g. "France")
- Then that dimension is cleared from `SearchFilter` (`removeChip`), even if its section is collapsed or hidden.

**Scenario: Clear all clears filters but preserves layout preferences**

- When I tap "Clear all" / "Reset"
- Then all selections clear, but section collapse and visibility preferences are preserved.

## Open questions (with recommended leans)

| #   | Question                                                                                                      | Lean                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tags picker: full `getAllTags` list client-side (fast search, larger payload) vs server search per keystroke? | **Full list, client-side** — already cached in `tagProvider`; windowed rendering handles size. Revisit only if payloads prove too large. |
| 2   | Should pickers browse the **full** set or the **context-narrowed** suggestion set?                            | **Full set**, with a live match count — friendlier for "find a specific person/tag"; mirrors web's orphan handling.                      |
| 3   | Places multi-select?                                                                                          | **No** — single-select (model + web parity).                                                                                             |
| 4   | Retire dead upstream UI (Slice 7) now or later?                                                               | **Now, as the final slice** — reduces confusion while we're in the area.                                                                 |

## Testing & CI notes

- Follow the CLAUDE.md mobile test recipe (Flutter 3.44.1; regenerate l10n/keys once; generated code is gitignored). CI is `dart analyze --fatal-infos lib test` — local `flutter analyze lib` misses test-only lints, so run both.
- Each slice must land with its BDD scenarios covered by widget/provider tests and be green before merge.
- No new server tests expected (no server changes); the only server-adjacent change is consuming an existing `numberOfAssets` field on the mobile side.
