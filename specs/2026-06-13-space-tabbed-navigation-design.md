# Space tabbed navigation — design

**Date:** 2026-06-13
**Branch:** `feat/space-albums`
**Status:** Approved design, pre-implementation (reviewed & hardened 2026-06-13)
**Scope:** Web only (SvelteKit). No server or mobile/Flutter changes.

## Problem

The space detail view scatters its most-used destinations across two places and leans on
unlabeled icons:

- **Albums** and **Map** are small icons in the top-right app bar (hover-to-discover).
- **Members** appears both as a top-right icon **and** as a pill in the cover hero.
- **People** appears as a top-right overflow item, a "Manage people" pill in the hero, **and**
  a face strip below it.
- The cover hero carries a row of pills (photo count, members, manage-people, role, collapse
  chevron) — so identity, stats, navigation, and actions are tangled together.

The result: no single "what can I do here" surface, duplicated entry points, and discoverability
that depends on hovering icons. The cover photo itself is liked; the problem is the **split**
between cover-pills and header-icons.

## Goals

- One labeled navigation surface for the frequently-used destinations: **Photos, People, Albums,
  Map, Members**.
- End the split: every action has exactly one home (identity / navigation / actions cleanly
  separated).
- Keep the cover photo as identity, but button-free.
- No regressions in role-gating (viewer / editor / owner / admin) or existing space features.

## Non-goals

- Mobile (Flutter) parity — deferred.
- Server / API / DTO changes — the redesign works entirely from existing endpoints (see
  "Data model facts" for why this is possible without a new `albumCount` field).
- Redesigning the People, Albums, or Map pages' internal content — only how they are reached and
  framed (their existing toolbars move from a page-level app bar into the tab's content area).
- Changing the asset viewer, multi-select control bar, or filter/search behavior beyond where
  they mount.

## Decisions (from brainstorming)

| Question         | Decision                                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation model | **Labeled tab bar** — `Photos · People · Albums · Map · Members`                                                                                                                                                                                               |
| Scope            | **Web only**, no server changes                                                                                                                                                                                                                                |
| Cover treatment  | Keep the cover (it's liked); make it button-free identity (Direction A)                                                                                                                                                                                        |
| Members          | **Fifth tab** (new `/members` route), replacing the slide-in panel                                                                                                                                                                                             |
| Scroll behavior  | Tab bar always pinned above the Timeline; cover **auto-collapses on scroll** (no manual chevron). See note — the virtualized Timeline owns its scroller, so this is a height-collapse via a new `Timeline` `onScroll` callback, not a single-scroller parallax |
| Map tab          | **Routes out** to the existing `/map?spaceId=` (which already has a back-to-space button)                                                                                                                                                                      |
| Face strip       | **Dropped** — People tab is the single people surface                                                                                                                                                                                                          |

## Data model facts (verified)

These constrain the design and are confirmed against `server/src/dtos/shared-space.dto.ts` and the
generated `@immich/sdk` type:

- `SharedSpaceResponseDto` **has**: `assetCount`, `memberCount`, `faceRecognitionEnabled`,
  `hasPets`, `petsEnabled`, `thumbnailAssetId`, `thumbnailCropY`, `newAssetCount`, `lastViewedAt`,
  `color`, and an optional `members[]` array.
- It does **NOT** carry the **viewer's own role** — role is derived from the `members[]` array
  cross-referenced with `authManager.user.id` (today every space page fetches `getMembers` for
  this). The redesign keeps this: the layout loads members once.
- It does **NOT** carry an **album count**. The mockup's "Albums N" badge therefore needs the
  linked-albums list (`getSharedSpaceAlbums`). We get this without a server change by loading the
  albums list in the shared layout load (see Architecture) and reusing it for both the badge and
  the Albums tab — net zero extra fetches when on the Albums tab, one small extra fetch on other
  tabs (linked-album counts per space are small).

## Architecture — a shared space shell

Today there is **no layout** under `(user)/spaces/` — each page
(`[spaceId]/[[photos=photos]]/[[assetId=id]]`, `people`, `albums`) independently mounts its own
`UserPageLayout` and independently fetches `space` + `members` in its `+page.ts`. The redesign
introduces a **SvelteKit layout** at `web/src/routes/(user)/spaces/[spaceId]/` that owns the chrome
once and loads shared data once; each tab becomes a child route filling the content below.

```
(user)/spaces/[spaceId]/
  +layout.ts                      ← load space + members + linked albums once; derive role + counts
  +layout.svelte                  ← app bar (back · name · ＋Add photos · ⋮) + cover + sticky <SpaceTabs>
  [[photos=photos]]/[[assetId=id]]/+page.svelte         ← Photos tab (content only)
  people/+page.svelte                                   ← People tab (content only)
  people/[personId]/[[photos=photos]]/[[assetId=id]]/   ← person DETAIL (chrome suppressed)
  albums/+page.svelte                                   ← Albums tab (content only)
  albums/[albumId=id]/+page.svelte                      ← album DETAIL (chrome suppressed)
  members/+page.svelte                                  ← Members tab (NEW)
```

- **`+layout.ts`** loads `space`, `members`, and the `linkedAlbums` list in parallel, and returns
  `{ space, members, linkedAlbums }`. Child `+page.ts` loaders stop fetching `space`/`members`
  themselves and read them from the parent via `await parent()` (Photos, People, Albums all
  currently double-fetch these — that is removed).
- **`+layout.svelte`** computes the role helpers (`currentMember`, `isOwner`, `isEditor`,
  `showInTimeline`, `sharePersonMetadata`) from `members` + `authManager.user.id` (the exact
  pattern used on the Photos page today), renders the app bar, the cover (`SpaceHero`), and the
  sticky `SpaceTabs`, then `{@render children()}`. Role + space are exposed to children via Svelte
  context so child pages don't recompute or refetch.

### Chrome suppression on detail routes

The `[spaceId]/+layout` wraps the person-detail (`people/[personId]/…`) and album-detail
(`albums/[albumId=id]/…`) routes too. Those are drill-down views with their own back navigation and
must **not** show the cover + tab bar. The layout inspects `page.route.id` and renders the
cover + `SpaceTabs` only for the five top-level tab routes; on detail routes it renders a minimal
back header (or defers entirely to the child's existing header). This keeps the tab shell from
leaking into detail views.

### Scroll behavior (constrained by the virtualized Timeline)

Verified constraint: `Timeline.svelte` owns its own `overflow-y-auto` scroller (`#asset-grid`),
exposes **no** external-scroll prop, and positions month buckets with `transform: translate3d`,
which creates stacking contexts that **break `position: sticky` inside it**. So a single-scroller
"cover parallax-scrolls away under sticky tabs" is not achievable without re-architecting Timeline
(out of scope). Instead:

- **Tab bar** is rendered by the layout **directly above** the Timeline's scroller, so it is
  _always visible_ — structurally pinned, no `sticky` needed. This is the same end state the mockup
  shows after scrolling.
- **Cover** (`SpaceHero`) is rendered by the layout above the tab bar. On the **Photos** tab it
  starts tall (~220px) and **auto-collapses** (height → 0, animated) once the Timeline scrolls past
  a threshold (~64px). The collapse is driven by a new optional `onScroll?: (scrollTop: number) =>
void` callback added to `Timeline.svelte` (the component already has an internal `onscroll`
  handler; we additionally invoke the callback). The Photos page wires it to
  `spaceUiManager.setCoverCollapsed(scrollTop > 64)`.
- On **non-Photos** tabs the cover is a **compact** fixed height (identity only, as the Members
  mockup shows) and does not collapse.

This replaces the current manual expand/collapse chevron and the `collapsed`/`onToggleCollapse`
machinery in `space-hero.svelte`. **Known deviation from the mockup:** the cover height-collapses
rather than parallax-scrolling off-screen — a forced consequence of the Timeline owning its
scroller. Everything else matches the mockup.

## Tabs & routing

`web/src/lib/components/spaces/space-tabs.svelte` renders the labeled tabs with active-state from
the current route, count badges, and visibility gating. All tab labels reuse **existing** i18n keys
(`photos`, `people`, `albums`, `map`, `members`) — no new label strings needed.

| Tab         | Route                                 | Visible when                   | Badge (source)                      |
| ----------- | ------------------------------------- | ------------------------------ | ----------------------------------- |
| **Photos**  | `/spaces/[id]` (default/index)        | always                         | asset count (`space.assetCount`)    |
| **People**  | `/spaces/[id]/people`                 | `space.faceRecognitionEnabled` | — (none)                            |
| **Albums**  | `/spaces/[id]/albums`                 | always                         | album count (`linkedAlbums.length`) |
| **Map**     | → `/map?spaceId=[id]` (navigates out) | always                         | — (none)                            |
| **Members** | `/spaces/[id]/members`                | always                         | member count (`members.length`)     |

- Badges render only when the count is `> 0` (no "0" badges).
- Tabs render as an ARIA `tablist` (`role="tab"`, `aria-selected`, `aria-current="page"` for the
  active link, arrow-key navigation), but are real `<a>` links for deep-linking and middle-click.
- **Map** is a launch, not an in-shell section: clicking it navigates to `/map?spaceId=`. The map
  page **already** renders a "← back" button to `/spaces/[id]` when `spaceId` is set — we reuse it,
  no new work. `space-map.svelte`'s URL logic is absorbed into the Map tab entry.
- **People vs Members** naming: People = faces detected in photos; Members = users with access.
  Labels are distinct, never icon-only.

### Tab-specific content toolbars

The People and Albums pages today carry their own page-level controls in a `UserPageLayout`
`buttons` slot (People: search + sort + show/hide-people; Albums: "Link album" + count
description). When their `UserPageLayout` chrome is removed, these controls move into the **top of
the tab's content area**, beneath the shared tab bar — not into the global app bar (which stays
limited to ＋ Add photos + ⋮). This keeps the global chrome identical on every tab while preserving
each tab's own tools.

### Responsive (web)

On narrow widths the tab strip becomes horizontally scrollable (active tab auto-scrolled into
view); the app-bar **＋ Add photos** collapses to an icon-only `＋`. Tabs never wrap.

## Actions & role gating

The **only** app-bar actions, identical on every tab:

- **＋ Add photos** — editors+. Because the timeline's add-assets mode lives on the Photos page,
  this action navigates to the Photos route (if not already there) and enters `select-assets`
  mode (see "Cross-route intents").
- **⋮ overflow** — the existing management menu, minus "People" (now a tab):
  - Show / hide on timeline (toggle, any member)
  - Share / stop sharing person metadata (toggle, any member)
  - Add all photos (editor)
  - Link libraries (admin)
  - Hide / show people (owner), hide / show pets (owner, only when `faceRecognitionEnabled && hasPets`)
  - Change cover photo / Reposition cover (editor) — see cover affordance
  - Delete space (owner)

Gating is unchanged from today, just relocated to the layout. Viewers see no **＋** and no
owner/admin overflow items. **i18n note:** several of these strings are currently hardcoded English
in source (`"Link Libraries"`, `"Hide people"/"Show people"`, `"Hide pets"/"Show pets"`) — since we
are relocating them, replace them with new i18n keys (`spaces_link_libraries`,
`spaces_toggle_people`, `spaces_toggle_pets`) added to `i18n/en.json`.

### Cover edit affordance

The cover is button-free. Editors get a hover-revealed **✎** control offering **Change cover
photo** (`$t('change_cover_photo')`) and **Reposition** (`$t('reposition')`). With no cover set, the
cover shows a "Set cover photo" prompt (`$t('set_cover_photo')`, editors only). Reposition uses the
existing drag-to-reposition flow in `space-hero.svelte` (kept); "Change cover photo" routes to
Photos and enters `select-cover` mode.

### Cross-route intents

Two actions live in the layout but are fulfilled by the Photos page's selection modes
(`select-assets`, `select-cover`). A small runes-based manager at
`web/src/lib/managers/space-ui-manager.svelte.ts` (matching the fork's manager-singleton pattern)
carries the intent: the layout sets the intent and ensures the Photos route is active; the Photos
page consumes it on mount and **clears it immediately** (so a later manual visit to Photos does not
re-trigger a selection mode). The same manager holds the `chromeHidden` flag the shell reads to
hide its app bar + tabs during selection (see next section). The manager resets its state on space
change and on Photos-page teardown.

## Modes that must overlay the shell

The Photos page's full-screen modes — `select-assets`, `select-cover` (both via `ControlAppBar`),
and the multi-select `AssetSelectControlBar` — must suppress the shell's app bar + tabs while
active; the asset viewer overlay (`[[assetId=id]]`) continues to render above the shell. Today the
Photos page achieves this with `hideNavbar` on its own `UserPageLayout`; with the shell, the Photos
page instead sets `spaceUiManager.chromeHidden = true` on entering any of these modes and `false`
on exit, and the layout hides the cover + app bar + tabs while it is true. `chromeHidden` is the
single source of truth and is force-reset on navigation away from Photos.

## Members tab (from the slide-in panel)

`space-panel.svelte`'s content becomes `members/+page.svelte`:

- Member list with avatars, name/email, **role** (owner can change editor/viewer/owner via the
  existing role `Select`; others see a read-only `RoleBadge`), and contribution stats.
- **＋ Invite** (owner only) — reuses the existing add-member flow.
- A **Recent activity** section below the list, reusing `space-activity-feed.svelte` as-is
  (with load-more). Note the new layout puts the member list **primary** and activity **below**,
  replacing the panel's Activity/Members sub-tab toggle.

The slide-in `SpacePanel`, its `panelOpen` state, and every trigger that opened it (the header
members icon, the hero member-count pill, the onboarding "invite members" button) are removed;
those now route to the Members tab. **i18n note:** the panel's tab labels were hardcoded
(`"Activity"`, `"Members (n)"`); the new Members tab uses i18n (`members`, plus a new
`spaces_recent_activity` key for the activity section heading if one doesn't already exist).

## What's removed

- `space-people-strip.svelte` usage (verified: the Photos page is its only non-test consumer) —
  delete the component and its `space-people-strip.spec.ts`.
- The hero pill row in `space-hero.svelte`: photo count, member-count button, "Manage people"
  link, the collapse/expand chevron, and the `collapsed`/`onToggleCollapse`/`onShowMembers`/
  `memberCount`/`assetCount` props. The hero keeps: cover image, name, description, role badge
  (relocated to a top corner), reposition mode, and the new hover ✎.
- The scattered header icons on the Photos page (`mdiMapOutline`, `mdiImageMultipleOutline` albums,
  `mdiAccountMultipleOutline` members) and the members button — all replaced by tabs.
- The slide-in `SpacePanel` and its triggers.

## Data flow

- `+layout.ts` → `{ space, members, linkedAlbums }`; the layout derives `currentMember` / `isOwner`
  / `isEditor` and the badge counts, exposing space + role to children via `data` + context.
- Mutations that change shell data (role changes, invites, cover change/reposition, delete,
  visibility toggles, add-all-photos) call the existing shared-space APIs and `invalidate` the
  layout load so the shell + badges refresh. The Members tab `invalidate`s after member/role
  changes; the Albums tab `invalidate`s after link/unlink (so the Albums badge updates).

## File-by-file change list

**New**

- `web/src/routes/(user)/spaces/[spaceId]/+layout.ts` — load space + members + linked albums.
- `web/src/routes/(user)/spaces/[spaceId]/+layout.svelte` — app bar + cover + sticky `SpaceTabs`;
  role derivation; chrome suppression on detail routes; reads `chromeHidden`.
- `web/src/lib/components/spaces/space-tabs.svelte` — labeled tab bar (gating, badges, a11y).
- `web/src/routes/(user)/spaces/[spaceId]/members/+page.svelte` + `+page.ts` — Members tab.
- `web/src/lib/managers/space-ui-manager.svelte.ts` — cross-route intents + `chromeHidden` flag.

**Modified**

- `.../[[photos=photos]]/[[assetId=id]]/+page.svelte` + `+page.ts` — drop the `space`/`members`
  fetch (read from `parent()`); strip the `buttons`/`leading` snippets, the `SpaceHero` render, and
  the `SpacePeopleStrip`; read shell context; consume add-photos / change-cover intents; set
  `chromeHidden` for selection modes.
- `people/+page.svelte` + `+page.ts` and `albums/+page.svelte` + `+page.ts` — drop their `space`/
  `members` fetch + their `UserPageLayout` app-bar chrome; move their own toolbars (search/sort/
  show-hide; link-album) into the content area; read space/role from context.
- `web/src/lib/components/spaces/space-hero.svelte` — moderate default height; remove pill row +
  collapse chevron + the listed props; relocate role badge; add hover ✎ edit affordance; keep
  reposition.
- `web/src/lib/components/spaces/space-map.svelte` — URL logic folded into the Map tab entry
  (the global map page's existing back-to-space button is reused, not re-added).
- `web/src/lib/components/timeline/Timeline.svelte` — add an optional `onScroll?: (scrollTop:
number) => void` prop, invoked from the existing internal `onscroll` handler (no behavior change
  when the prop is absent). Used by the Photos tab to drive cover collapse.
- `i18n/en.json` — add `spaces_link_libraries`, `spaces_toggle_people`, `spaces_toggle_pets`, and
  `spaces_recent_activity` (only the ones not already present).

**Removed**

- `web/src/lib/components/spaces/space-panel.svelte` + `space-panel.spec.ts` (content → Members tab).
- `web/src/lib/components/spaces/space-people-strip.svelte` + `space-people-strip.spec.ts`.

## TDD approach

Implementation follows red → green → refactor; **every slice starts with a failing test**. Order
the slices so each is independently verifiable:

1. **`space-ui-manager`** (pure logic, easiest to TDD): tests for `requestAddPhotos` /
   `requestChangeCover` intent set→consume→clear (consume is idempotent — second consume is a
   no-op), `chromeHidden` toggle, and reset-on-space-change. Implement to green.
2. **`space-tabs.svelte`** (component): tests for tab set per gating (face-rec on/off → People
   shown/hidden), badge rendering (shown when `> 0`, hidden at `0`), active-state from route, and
   tablist a11y (roles, `aria-current`, arrow-key nav). Implement.
3. **`+layout.ts` load**: tests that it loads space+members+albums once and derives role; that
   child loaders read from `parent()` and no longer double-fetch.
4. **`+layout.svelte`**: tests for role-gated app-bar actions (viewer: no ＋/no owner overflow;
   editor: ＋ + add-all + change-cover; owner: + delete/hide-people/link-libraries), chrome
   suppression when `chromeHidden`, and chrome suppression on detail routes.
5. **`members/+page.svelte`**: tests for list render, owner role-change `Select` vs read-only
   `RoleBadge`, invite gated to owner, activity section render.
6. **Photos / People / Albums page edits**: update their existing route-page specs for the removed
   chrome, the context-sourced space, and (Photos) the consumed intents + `chromeHidden`.
7. **`space-hero.svelte`**: update its spec for the removed pill row / chevron and the new ✎.
8. **E2E** (last, integrates the above): extend the Playwright suites below.

The full `lint` pass is deferred to a final gate; keep `pnpm check` (svelte-check + tsc) and the
relevant `pnpm test --run <file>` in the inner loop.

## Test matrix

**Unit / component (Vitest + @testing-library/svelte)**

| Target                         | New/Extend | Cases                                                                                                                                                               |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space-ui-manager.svelte.ts`   | New        | intent set/consume/clear, idempotent consume, `chromeHidden` toggle, reset on space change                                                                          |
| `space-tabs.svelte`            | New        | tab set with face-rec on/off; badge shown `>0` / hidden `=0`; active state per route; tablist roles + `aria-current` + arrow-key nav; horizontal-scroll on overflow |
| `+layout.svelte`               | New        | role-gated app-bar (viewer/editor/owner/admin); cover present on tab routes; cover+tabs suppressed on detail routes; chrome hidden when `chromeHidden`              |
| `+layout.ts`                   | New        | single load of space+members+albums; role derived; child `parent()` dedup                                                                                           |
| `members/+page.svelte`         | New        | list render; owner editable role / non-owner read-only; invite owner-only; activity section + load-more                                                             |
| `spaces-page.spec.ts` (Photos) | Extend     | no hero pill row / no people strip / no header icons; space from context; ＋ intent consumed once; `chromeHidden` set/cleared per mode                              |
| `space-people-page.spec.ts`    | Extend     | no own app-bar; toolbar in content; reads context                                                                                                                   |
| `space-albums-page.spec.ts`    | Extend     | no own app-bar; link-album in content; badge invalidation after link/unlink                                                                                         |
| `space-hero.spec.ts`           | Extend     | pill row + chevron removed; role badge relocated; ✎ shown to editors only; no-cover prompt                                                                          |
| `space-panel.spec.ts`          | Remove     | component deleted                                                                                                                                                   |
| `space-people-strip.spec.ts`   | Remove     | component deleted                                                                                                                                                   |

**E2E (Playwright web — `e2e/src/specs/web/`, roles via `buildSpaceContext()` + `setAuthCookies`)**

- Extend `spaces-p1/p2/p3.e2e-spec.ts` and `spaces-albums.e2e-spec.ts`:
  - All five tabs present for a member; **People hidden** when face recognition is off; deep-link to
    `/spaces/[id]/people` with face-rec off **redirects** to the Photos tab.
  - Tab navigation routes correctly and shows active state; **Map** launches `/map?spaceId=` and its
    back button returns to the space.
  - **Viewer**: no ＋ Add photos, no owner/admin overflow items, no cover ✎, read-only roles on the
    Members tab. **Editor**: ＋, add-all, change-cover present; no delete/hide-people/link-libraries.
    **Owner**: full overflow. **Non-member**: navigating to `/spaces/[id]` is denied.
  - **Members tab**: list + role change (owner) + invite + activity render at `/members`; the
    slide-in panel no longer exists.
  - **Add photos from a non-Photos tab** lands on Photos in `select-assets` mode; canceling and
    re-opening Photos does not re-enter select mode.
  - Selection modes hide the tab bar + app bar; exiting restores them.
- Extend `space-map-markers.e2e-spec.ts` for the Map-tab entry path.

**Accessibility**: tablist semantics, keyboard navigation, focus order across the sticky region,
`aria-current` on the active tab.

## Edge cases

| Edge case                                     | Handling                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| No cover set                                  | Gradient fallback (`spaceGradient`); editors see "Set cover photo" prompt, viewers see plain gradient |
| `assetCount` / album / member count = 0       | Badge hidden (no "0"); tab still present                                                              |
| Face recognition **off**                      | People tab hidden; direct nav to `/people` redirects to Photos                                        |
| `hasPets` false / pets off                    | "Hide/Show pets" overflow item hidden                                                                 |
| Single member (owner only)                    | Members badge "1"; no editable role rows; invite present (owner)                                      |
| Large counts                                  | Badge formats compactly; tab strip scrolls rather than wraps                                          |
| Add-photos intent stale                       | Consumed once on Photos mount then cleared; manual Photos visit never auto-enters select mode         |
| Change-cover intent from another tab          | Routes to Photos → `select-cover`; cleared after consume                                              |
| Map round-trip                                | Back button returns to `/spaces/[id]` (Photos), regardless of originating tab                         |
| Asset viewer deep link (`/photos/[assetId]`)  | Layout still loads; viewer overlay renders above the (hidden) chrome                                  |
| Detail routes (person / album)                | Cover + tabs suppressed; child's own back navigation used                                             |
| Space deleted / membership revoked while open | Next load/mutation 403/404 → redirect to `/spaces` with a toast                                       |
| Role changed remotely                         | Reflected after the next `invalidate`; gating recomputed from fresh members                           |
| Selection mode + navigate away                | `chromeHidden` force-reset on Photos teardown so other tabs aren't left chromeless                    |
| Narrow viewport                               | Tab strip horizontally scrollable, active tab scrolled into view; ＋ collapses to icon                |

## Risks / open considerations

- **Shell vs. selection modes** — the show/hide of app bar + tabs during select-assets /
  select-cover / multi-select is the fiddliest part; `spaceUiManager.chromeHidden` is the single
  source of truth and must be reset on navigation away from Photos.
- **Detail-route chrome** — the `[spaceId]/+layout` wraps person/album detail routes; the
  `page.route.id` check that suppresses cover+tabs there must be covered by a test so a future route
  addition doesn't silently leak the shell.
- **Photos route shape** — the existing `[[photos=photos]]/[[assetId=id]]` optional-matcher route
  must remain the layout's index; verify the asset viewer overlay and deep links still resolve under
  the new `+layout`.
- **Load dedup** — child `+page.ts` loaders must read space/members from `await parent()`; verify no
  page double-fetches after the refactor.
- **Albums-badge cost** — loading the linked-albums list in the layout on every tab is acceptable
  for the expected small counts; if a space accumulates many linked albums, revisit with a
  server-side `albumCount` field (explicitly out of scope now).
