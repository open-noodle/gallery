# Persist Filter Panel & Space Hero UI State in localStorage

## Goal

Remember user preferences for filter panel and space hero collapsed/expanded state
across page reloads and navigation, using inline localStorage (matching the existing
visible-sections pattern).

## What We're Persisting

| What                   | Key                                 | Type                      | Default            | Scope               |
| ---------------------- | ----------------------------------- | ------------------------- | ------------------ | ------------------- |
| Filter panel collapsed | `gallery-filter-collapsed`          | `boolean`                 | `false` (expanded) | Global              |
| Section accordions     | `gallery-filter-expanded-sections`  | `string[]`                | All expanded       | Global              |
| Space hero collapsed   | `gallery-space-hero-collapsed`      | `Record<string, boolean>` | `false` (expanded) | Per-space           |
| Visible sections       | `gallery-filter-visible-sections-*` | `string[]`                | All visible        | Per-page (existing) |

## Approach

Inline `localStorage.getItem`/`setItem` with `browser` guard and `try/catch`, following
the exact pattern already used for visible sections in `filter-panel.svelte`.

## 1. Filter Panel Collapsed/Expanded (Global)

**Key:** `gallery-filter-collapsed` -> `boolean`

**Changes to `filter-panel.svelte`:**

- Replace `let collapsed = $state(initialCollapsed)` with localStorage-aware init
- On mount: read `gallery-filter-collapsed`. If present, use it. If absent, default to
  `false` (expanded)
- Add `$effect` to persist `collapsed` on change
- Keep `initialCollapsed` prop but only as fallback when no localStorage entry exists
  (for backwards compat and first-visit behavior)

**Changes to parent pages:**

- Photos page: change `initialCollapsed={true}` to `initialCollapsed={false}` (or
  remove it) — first visit should show the filter panel so users discover it
- Map page: no change (already defaults to expanded)
- Spaces page: no change (already defaults to expanded)

**Add `persistCollapsed` prop** (default `true`):

- The map page renders two FilterPanel instances (desktop + mobile overlay). The mobile
  overlay is toggled by an external button and should always render expanded when the
  overlay opens. Pass `persistCollapsed={false}` to the mobile instance.

**Behavior:**

- First visit: panel expanded (users discover the feature)
- User collapses panel -> stored globally
- All subsequent visits on any page: collapsed
- User expands again -> stored, stays expanded

## 2. Filter Section Accordion State (Global)

**Key:** `gallery-filter-expanded-sections` -> `string[]` (JSON array of expanded
section type names)

**Changes to `filter-section.svelte`:**

- Make it fully controlled: add `expanded` prop and `onToggleExpanded` callback
- Remove internal `let expanded = $state(true)`
- Parent (FilterPanel) owns the state and passes it down
- Handle `isEmpty` in parent: do not expand a section with zero results

**Changes to `filter-panel.svelte`:**

- Add `expandedSections` state as `SvelteSet<FilterSectionType>` (mirrors
  `visibleSections` pattern)
- Add `loadExpandedSections()` function:
  - Read from localStorage
  - Validate against current `config.sections` (ignore unknown types)
  - Default: all sections in `config.sections` (all expanded on first visit)
- Add `$effect` to persist `expandedSections` on change
- Add `toggleSectionExpanded(section)` function
- Pass `expanded={expandedSections.has(section)}` and
  `onToggleExpanded={() => toggleSectionExpanded(section)}` to each FilterSection

**Behavior:**

- First visit: all sections expanded (users see full content)
- User collapses Timeline (40+ year entries) -> stored
- Next visit: Timeline stays collapsed, everything else expanded
- Global across all pages (photos, map, spaces)

## 3. Space Hero Collapsed/Expanded (Per-Space)

**Key:** `gallery-space-hero-collapsed` -> `Record<string, boolean>` (spaceId ->
collapsed)

**Changes to space page (`+page.svelte`):**

- Replace `let heroCollapsed = $state(false)` with localStorage-aware init
- On mount / space change: read the Record, look up current spaceId. If entry exists,
  use it. If absent, default to `false` (expanded)
- On **manual** toggle (chevron click): update Record and persist
- **Do NOT persist auto-collapse from filter activation** — only persist user-initiated
  toggles via the chevron button

**Why separate auto-collapse from manual toggle:**

The auto-collapse effect (`heroCollapsed = true` when filters activate) is a convenience
hint, not a user preference. If persisted, it becomes a one-way ratchet: apply filter ->
hero collapses and persists -> clear filters -> hero stays collapsed forever. Instead,
distinguish the source:

```typescript
function toggleHeroCollapsed() {
  heroCollapsed = !heroCollapsed;
  persistHeroCollapsed(space.id, heroCollapsed); // only here
}
```

The auto-collapse effect sets `heroCollapsed = true` without persisting.

**Space navigation:** When switching spaces, read the new space's persisted value from
localStorage in the navigation sync effect (not just on component mount).

**Unbounded growth:** Not a concern. Users won't visit thousands of spaces, and a few
hundred UUIDs with booleans is trivially small in localStorage's 5-10MB budget. No LRU
eviction needed.

## Edge Cases

- **SSR safety:** All localStorage access guarded by `browser` check from
  `$app/environment`
- **Corrupted data:** `try/catch` with silent fallback to defaults (same as existing
  pattern)
- **Section type changes:** `loadExpandedSections` validates against current
  `config.sections`, ignoring unknown types (graceful degradation if sections are
  added/removed)
- **Space deletion:** Stale entries in the hero Record are harmless dead keys
- **Map mobile overlay:** `persistCollapsed={false}` ensures mobile FilterPanel always
  renders expanded
- **`{#key space.id}` remount:** FilterPanel is destroyed/recreated on space navigation,
  correctly re-reading localStorage each time. The `$effect` write-on-mount is harmless.
- **Empty sections:** FilterPanel must not allow expanding a section with zero results
  (handle `isEmpty` logic in parent, not in FilterSection)

## Testing

- Unit tests for `loadExpandedSections` / persist / toggle (mirror existing
  visible-sections tests)
- Unit test for filter panel collapsed persistence (read/write/default)
- Unit test for space hero per-space persistence (read/write/toggle/space-switch)
- No E2E needed — localStorage behavior is well-covered by unit tests

## localStorage Keys Summary

All keys follow the existing `gallery-` prefix, kebab-case convention:

```
gallery-filter-collapsed              -> boolean
gallery-filter-expanded-sections      -> string[]
gallery-space-hero-collapsed          -> Record<string, boolean>
gallery-filter-visible-sections       -> string[]  (existing, default)
gallery-filter-visible-sections-photos -> string[] (existing, photos page)
gallery-filter-visible-sections-map   -> string[]  (existing, map page)
gallery-filter-visible-sections-spaces -> string[] (existing, spaces page)
```
