# Research: Cmd/Ctrl+K Multi-Entity Search

**Date:** 2026-04-12
**Context:** User wants a Datadog-style global command palette that previews results across photos, people, locations, tags, and more — surfaced full-screen like the existing smart search page.
**Status:** Research only — no implementation

---

## The Goal

Introduce a keyboard-first global search surface (Cmd/Ctrl+K) that:

1. Opens instantly from anywhere in the app.
2. Returns **mixed entity types** in a single view — photos, people, places, tags, albums, spaces, actions.
3. Shows **live previews** as the user types (photo thumbnails, person faces, place maps).
4. Degrades gracefully when ML is slow or offline (each section streams independently).
5. Feels like Datadog / Linear / Raycast, not a generic search bar.

---

## Current State of Search in Gallery

### The existing search bar

- **Component:** `web/src/lib/components/shared-components/search-bar/search-bar.svelte`
- **Legacy element wrapper:** `web/src/lib/elements/SearchBar.svelte`
- **Results route:** `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte` — renders **only photo assets**, no mixed entities.
- **Shape:** inline in the header, not modal. Dropdown chooses one of four search types (smart, metadata/filename, description, OCR), then navigates to `/search?query=...` via `Route.search()` in `web/src/lib/route.ts`.
- **Ctrl+K is already taken**: `search-bar.svelte:246` focuses the input; `Ctrl+Shift+K` opens the `SearchFilterModal`. Both are documented in `web/src/lib/modals/ShortcutsModal.svelte:34–35`. A new cmdk surface would need to repurpose `Ctrl+K` (selecting-the-input is redundant because the input lives in the palette itself).

### Keyboard shortcut infrastructure

- **Action:** `web/src/lib/actions/shortcut.ts` (re-exports the `shortcut` action from `@immich/ui`).
- **Usage pattern:** `use:shortcuts={[...]}` on `<svelte:document>` or specific elements. Global bindings live in `web/src/routes/+layout.svelte:234–238` (Ctrl+Shift+M for copy link, etc.).
- **ShortcutsModal:** `web/src/lib/modals/ShortcutsModal.svelte` — the `?` help dialog; we'd add a new row here.
- **No central hotkey registry** — shortcuts are registered per-component, which is fine: we can register Ctrl+K once in `+layout.svelte` to toggle a global `cmdkOpen` state.

### `@immich/ui`'s `CommandPalette*` is not what we want

`+layout.svelte:192` already wraps the tree in `CommandPaletteDefaultProvider` from `@immich/ui`. This is an **action registry** — pages push `ActionItem[]` with `onAction` callbacks (theme toggles, navigation commands). It does not know about entity search, doesn't talk to the server, doesn't render mixed result lists. **We reuse the name pattern but build a new component.** We should, however, bridge to the existing registry so admin/context actions appear as one of the cmdk sections for free.

### Backend APIs we can compose

All already exist on the server. A new cmdk service would fan out to these in parallel:

| Entity  | Endpoint                          | SDK method             | Returns                                |
| ------- | --------------------------------- | ---------------------- | -------------------------------------- |
| Photos  | `POST /search/smart`              | `searchSmart`          | `SearchResponseDto` (paginated assets) |
| Photos  | `POST /search/metadata`           | `searchAssets`         | `SearchResponseDto`                    |
| People  | `GET /search/person`              | `searchPerson`         | `PersonResponseDto[]`                  |
| Places  | `GET /search/places`              | `searchPlaces`         | `PlacesResponseDto[]`                  |
| Tags    | `GET /search/suggestions/tags`    | `getTagSuggestions`    | `TagSuggestionResponseDto[]`           |
| Filters | `GET /search/suggestions/filters` | `getFilterSuggestions` | unified facets (countries, cameras, …) |
| Explore | `GET /search/explore`             | `getExploreData`       | popular items (empty-state fodder)     |

Files: `server/src/controllers/search.controller.ts`, consumers in `web/src/lib/components/search/smart-search-results.svelte:35` (smart) and `web/src/lib/components/faces-page/people-search.svelte:7` (people).

**Gaps:**

- No single aggregator endpoint returning mixed types in one response. Two options, explored below: (a) fan out in the browser, (b) a new `POST /search/global` server endpoint that calls each service internally.
- No albums/spaces search — would need new endpoints or client-side filtering of `getAllAlbums` / the spaces list.

### Filter suggestion unification exists and is a model to copy

`web/src/lib/components/filter-panel/filter-panel.ts:34` defines `suggestionsProvider: (filters) => Promise<FilterSuggestionsResponse>`, and the filter panel already coordinates faceted suggestions via one endpoint. **The cmdk aggregator should follow this provider-shaped pattern:** each entity section is a provider, all providers stream results into a shared store, and the UI subscribes. The unit test at `web/src/lib/components/filter-panel/__tests__/unified-suggestions.spec.ts` is the reference for how the web tests faceted search.

---

## Prior Art: How Other Apps Do This

### Library choice — Bits UI `Command`, not `cmdk-sv`

- `cmdk` by Paco Coursey is the React reference (<https://github.com/pacocoursey/cmdk>). Headless, exposes `Command.Root / Input / List / Item / Group / Separator / Empty / Loading`, custom `filter` prop with 0–1 scoring, `shouldFilter={false}` to drive results from a server. Self-describes as a combobox.
- **Svelte port landscape:** `cmdk-sv` (huntabyte) was the direct port — **archived 2025-05-22**. The maintained successor is **Bits UI `Command`** (<https://bits-ui.com/docs/components/command>), Svelte 5 native, runes throughout, same API shape (`Root / Input / List / Viewport / Group / GroupHeading / GroupItems / Item / LinkItem / Empty / Loading / Separator`), `bind:value`, `shouldFilter`, VIM bindings (`Ctrl+N/J/P/K`) plus arrow keys with optional looping. `shadcn-svelte` ships a styled wrapper over Bits UI.
- **Recommendation:** use Bits UI `Command`. It's the successor to the archived port, it's Svelte 5 native, and `@immich/ui` is already Bits-aligned. Don't hand-roll.

### Reference implementations

**Datadog Quick Nav (`Cmd+K` / `Ctrl+K`)** — the specific inspiration. Opens with quick-action shortcuts at the top (Widget Clipboard, "new dashboard"), then a `RECENT` section of recently-visited dashboards/monitors, then links to major features. Flat-ish grouped list, real-time filter, **no side preview panel**. Reference: <https://www.datadoghq.com/blog/datadog-quick-nav-menu/>.

**GitHub command palette** — the most prefix-driven of the set (<https://docs.github.com/en/get-started/accessibility/github-command-palette>):

- `#` → issues/PRs/discussions/projects
- `@` → users/orgs/repos
- `!` → projects
- `/` → files in repo
- `>` → run commands
- `?` → help
- **Scope bar** top-left shows current scope; `Tab` narrows scope (adds highlighted item to it), `Backspace/Delete` widens it, `Cmd+Enter` opens in new tab, `Cmd+Shift+K` jumps straight to command mode.

**Linear** — groups commands by category with keybinds rendered inline on the right of each row. Distinguishes "navigate" actions (`G`-prefix: `GI` inbox, `GM` my issues, etc.) from in-palette commands. Heavy on actions, light on entity search.

**Vercel dashboard** — early `cmdk` adopter, the cmdk demo site ships a "Vercel" theme. Flat dark list, hard section grouping (Projects → Teams → Settings), keybinds inline.

**Raycast** — the only one in the set with a real **side preview panel**: `List` API takes `isShowingDetail` and items expose `List.Item.Detail` (markdown + metadata) rendered to the right of the highlighted item. Reference: <https://developers.raycast.com/api-reference/user-interface/list>, `/detail`. **Rare on the web but the closest precedent for what a photo app needs.**

### Pattern menu

**Grouping / ranking across entity types.** Every web implementation surveyed uses **hard section ordering** with a fixed priority (Datadog: Recent → Features; GitHub: prefix-determined; Linear: Suggestions → Navigation → Commands; Vercel: Projects → Teams → Settings). **Cross-entity score-mixing is rare on the web** — hard to reason about, surprising. Escape hatches:

- **Prefix scoping** (GitHub-style) — `#tag`, `@person`, `/album`, `>command` — explicit opt-in to a single entity.
- **Frecency within the "Recent" group only** — `cmdk-engine` explicitly records frecency on `select()`. We already have `SearchHistoryBox`; its data is the seed.

For Gallery, the natural order is **Photos → People → Places → Tags → Albums → Spaces → Commands**, with photos first because they're the headline entity.

**Latency / streaming.** None of the surveyed palettes block on a slow backend. Standard pattern: input debounced ~150 ms, each backend section renders its own `Command.Loading` skeleton independently, results stream in per-section as queries resolve. Bits UI/cmdk both expose top-level `Command.Loading` and per-group indicators. `cmdk` issue #269 documents that the empty state must only show when **no** results across **all** groups — important for partial-results rendering.

**Preview panel.** Rare on the web but high leverage for a photo app. The visual nature of the content (thumbnails, faces, map pins) makes a right-hand preview panel a real differentiator. Cost: palette widens from ~560 px to ~720–820 px, and small viewports need a no-preview fallback (<~640 px). Raycast is the only prior art; none of Datadog/Linear/Vercel/GitHub ship one. **Recommend adopting it as our one divergence from web norm.**

**Empty state (before the user types).** Two dominant patterns:

- Datadog/Vercel — Recent items + top navigation.
- Linear — context-aware suggestions based on the current page, plus most-used commands.
- GitHub — location-scoped suggestions ("you're in repo X, here are issues in X").

For Gallery, the equivalent is: **recent searches** (reuse `SearchHistoryBox` data) + **recently-viewed entities** + **context-aware** ("you're on a space → top people in this space", "you're on /map → nearby places"). This is almost free — all data sources already exist.

### Accessibility model

Per the **WAI-ARIA Authoring Practices** (<https://www.w3.org/WAI/ARIA/apg/patterns/combobox/>), a command palette is a **combobox with a popup**, not a plain listbox or dialog:

- DOM focus stays on the `combobox` (the input). Active option tracked via **`aria-activedescendant`** pointing at the highlighted item ID. cmdk and Bits UI both do this — they do **not** move DOM focus into the list.
- Input: `role="combobox"`, `aria-expanded`, `aria-controls` pointing at the listbox ID, `aria-autocomplete="list"`.
- Popup: `role="listbox"`. Items: `role="option"`, `aria-selected` on the active one.
- Groups: `role="group"` with `aria-labelledby` on the heading.
- If we wrap in a modal, the **dialog** wraps the combobox; we do not replace the combobox role. cmdk's `Command.Dialog` does this correctly.
- **Keyboard:** `ArrowDown`/`ArrowUp` (optional wrap), `Home`/`End`, `Enter` activates, `Esc` closes (APG says `Esc` clears input first, then closes), `Tab` moves focus **out** of the widget — GitHub deliberately diverges to use `Tab` for scope narrowing; that's a conscious design call to flag. Bits UI ships VIM bindings as a power-user alternative.

---

## Design Options for Gallery

### Surfacing: modal vs full-page

**Option A — Modal overlay (Datadog/Linear/Vercel standard).** Opens as a centered dialog, 640–820 px wide, blurred backdrop, closes on `Esc`. Fastest to build, feels lightweight, coexists with whatever page you were on.

**Option B — Full-page takeover (current Gallery search page style).** Matches the existing `/search` route. More real estate for previews, but heavier to open/close, and loses the "peek and dismiss" feel that makes cmdk palettes satisfying.

**Option C — Modal with "open full results" escape hatch.** Modal is the default; `Enter` on a photos section's "See all N matches" row navigates to `/search?query=...` with the existing full-page renderer. Best of both worlds — the user gets speed by default and depth on demand.

**Recommendation: Option C.** Preserves existing `/search` as the depth view, adds cmdk as the breadth/preview view on top. No code deleted from the current search page.

### Result layout

**Two-pane (list + preview) for ≥ 720 px, single-pane for smaller.**

```
┌────────────────────────────────────┬──────────────────┐
│ [🔍 Search everything…]            │                  │
├────────────────────────────────────┤                  │
│ PHOTOS ──────────── See all (342)  │                  │
│ 🖼 Sunset at the pier             │   [preview of    │
│ 🖼 Beach trip — Sept              │    highlighted   │
│ 🖼 Dog running on sand  ← active  │    item,         │
├────────────────────────────────────┤    thumbnail,    │
│ PEOPLE                              │    metadata,    │
│ 👤 Alice Nguyen                    │    quick actions]│
│ 👤 Alex Kim                        │                  │
├────────────────────────────────────┤                  │
│ PLACES                              │                  │
│ 📍 Santa Cruz, CA                  │                  │
├────────────────────────────────────┤                  │
│ TAGS                                │                  │
│ 🏷 beach                           │                  │
├────────────────────────────────────┤                  │
│ COMMANDS                            │                  │
│ ⚙ Toggle dark mode        ⌘D       │                  │
└────────────────────────────────────┴──────────────────┘
```

Sections in fixed order: **Photos → People → Places → Tags → Albums → Spaces → Commands**. Each section shows top 3–5 items plus a "See all N →" row. Active row's preview renders on the right (thumbnail for photos/people, mini-map for places, asset grid preview for tags/albums).

### Aggregator: client fan-out vs new `/search/global` endpoint

**Client fan-out.** New `cmdk-service.ts` in `web/src/lib/services/` kicks off `searchSmart`, `searchPerson`, `searchPlaces`, `getTagSuggestions` in parallel, debounced at ~150 ms, cancels in-flight on new input via `AbortController`. Each result stream pushes into a rune-based `$state` store and the component re-renders per-section.

- **Pros:** no server changes, per-section streaming falls out naturally, easy to add new sections.
- **Cons:** 4–6 HTTP requests per keystroke cadence (debouncing mitigates), client controls ranking logic, harder to add server-side frecency.

**Server `POST /search/global`.** New controller method orchestrates the same internal services and returns `{ photos, people, places, tags, albums, spaces }` in one response.

- **Pros:** one request, room for server-side frecency/personalization, consistent with how filter suggestions are unified.
- **Cons:** slowest section blocks all others (unless we stream with SSE), server code touch, SDK regeneration.

**Recommendation: start with client fan-out.** It's the shape that matches the unified filter suggestions pattern already in use, it's incremental, and if the keystroke cost becomes a problem we can consolidate later behind the same web-side interface. If we go server-side eventually, SSE (or chunked JSON) is the only sane way to keep the streaming UX.

### Prefix scoping: yes or no

GitHub-style prefixes (`#tag`, `@person`, `/place`, `>command`) are low cost — they're a parser hook over the same providers — and they give power users a clean way to skip straight to one entity. **Recommend shipping them in v1** but as a progressive enhancement: typing plain text shows all sections; typing `@alice` narrows to People; typing `>` toggles command-only mode. Document in `ShortcutsModal`.

### Frecency / recent

Seed from existing `SearchHistoryBox` and the asset view history. Store per-user in `localStorage` (key `cmdk.recent`) as `{ query, targetId, entityType, lastUsed, useCount }`. Order by recency × count on empty-state render. No server round-trip.

### Bridging existing `CommandPaletteDefaultProvider`

The `@immich/ui` provider already collects `ActionItem[]` from pages. Our cmdk modal should subscribe to the same registry and render them as the `COMMANDS` section — this makes every existing context menu's actions keyboard-accessible for free. If the subscription API isn't exposed, we either expose it upstream in `@immich/ui` or mirror the registration call into our own store.

---

## Key Risks and Open Questions

1. **Ctrl+K is currently bound to "focus the existing search bar."** Repurposing it will be visible to users. Options: (a) just repurpose, the existing behavior is essentially a no-op once cmdk exists; (b) keep `Ctrl+K` as focus and bind the palette to `Cmd+K` on Mac / `Ctrl+Shift+P` elsewhere. **Lean toward (a)** — a single universal binding is the whole point.
2. **Smart-search latency.** CLIP search is 200–600 ms on dev hardware, occasionally longer. The per-section streaming pattern saves us here: Photos can come in last while People/Places/Tags render instantly. But if Photos is empty for 400 ms every keystroke, the feel degrades. Mitigation: render a skeleton row the instant the query fires.
3. **ML server offline.** `project_ml_server_search_hang` in memory says smart search hangs when ML is unhealthy. We must `AbortController` smart search cleanly and never let it block other sections. Consider a soft timeout (e.g., 3 s) per provider.
4. **Albums + spaces search doesn't exist yet.** Two options: (a) client-side filter on an already-loaded list, (b) add a tiny `GET /search/albums` + `GET /search/spaces` endpoint. If the existing list is bounded (<1000) client filter is fine; otherwise we build the endpoints. Worth measuring before committing.
5. **Preview panel for photos requires a thumbnail URL per highlighted item.** The search APIs return `AssetResponseDto`, which already includes thumbnail paths — so the preview is a cheap `<img src={getAssetThumbnailUrl(...)} />`. Noted in memory that `createUrl()` is required for correct routing.
6. **`CommandPaletteDefaultProvider` already uses the name.** We'll need a new component name to avoid collision — candidates: `GlobalSearch`, `QuickSearch`, `CmdK`. Lean `QuickSearch` (matches Datadog's branding, doesn't hint at implementation detail).
7. **Mobile.** The palette is keyboard-first. On mobile, the existing header search should stay the primary entry point; a tap on it could open the same modal minus the preview pane. Out of scope for v1.

---

## Suggested Incremental Plan (for a follow-up design/plan doc)

Not a commitment — a skeleton for when we move from research to plan:

1. **v1 shell** — Bits UI `Command` modal, Ctrl+K binding, client fan-out to Photos + People + Places + Tags, no preview pane, no prefix scoping. Ships as a progressive enhancement; existing search bar stays.
2. **v1.1 preview pane** — right-side preview for photos/people/places, feature-gated ≥ 720 px.
3. **v1.2 prefix scoping** — `@`, `#`, `/`, `>` parser.
4. **v1.3 Recent & frecency** — localStorage store, empty-state rendering, merge with `SearchHistoryBox`.
5. **v1.4 Albums & spaces** — client-filter if small enough, new endpoints if not.
6. **v1.5 Commands bridge** — subscribe to `CommandPaletteDefaultProvider` registry.

Each step is independently shippable and independently reviewable.

---

## References

- Bits UI Command (Svelte 5): <https://bits-ui.com/docs/components/command>
- shadcn-svelte Command: <https://www.shadcn-svelte.com/docs/components/command>
- cmdk (React reference): <https://github.com/pacocoursey/cmdk>, <https://cmdk.paco.me>
- cmdk-sv (archived Svelte port): <https://github.com/huntabyte/cmdk-sv>
- Datadog Quick Nav: <https://www.datadoghq.com/blog/datadog-quick-nav-menu/>
- GitHub command palette: <https://docs.github.com/en/get-started/accessibility/github-command-palette>
- Linear "Invisible details": <https://medium.com/linear-app/invisible-details-2ca718b41a44>
- Raycast List/Detail API: <https://developers.raycast.com/api-reference/user-interface/list>
- WAI-ARIA Combobox pattern: <https://www.w3.org/WAI/ARIA/apg/patterns/combobox/>
