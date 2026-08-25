# Reconciling upstream's memories view with the fork's memories surface

**Date:** 2026-08-25
**Upstream commit:** `351be957699` — `feat: memories view` (immich-28675), 49 files, +1191/-335
**Status:** approved, pending implementation

## Why this needed a decision

Upstream's memories view is the canonical case for the rolling rebase's product-direction
gate: it merges as an ordinary commit, but it **creates two files the fork already owns** —
`web/src/routes/(user)/memories/+page.svelte` and `+page.ts` — and rewrites two more the
fork has deltas on. Left to a mechanical resolution it would have produced either a
duplicated page body or a silent drop of fork behaviour.

It is also the **oldest** of the four commits pending on `upstream/main`
(`8dcfd36fa57..fbd5dc2c618`). The other three — a fetch-error fix, a GitHub Actions bump and
an ML `mise.lock` bump — are trivial and sit *behind* it, so quarantining at its boundary
would have yielded zero safe commits. The whole range was blocked on this decision.

## The collision

| Surface | Fork today | Upstream after immich-28675 |
| --- | --- | --- |
| `/memories/` index | Fork's own page (#455): search bar, all/saved tabs, month grouping, `memory-card.svelte`, `memory-index-utils.ts`, 4 spec files | New page: carousels, "upcoming" section, per-user filter modal, pagination |
| Memory viewer | `/memory/[[photos]]/[[assetId]]/` with a fork `memoryId` query param (#791) | Moved to `/memories/[id]/[[photos]]/[[assetId]]/` — memory scoping via route param; old path kept as a 307 redirect |
| `memory-manager.svelte.ts` | Fork delta extracting `memory-viewer-source.ts` (#791) | 374-line rewrite |
| Settings | Admin/system config for the rule engine | New per-user `MemoriesSettingsModal` + `sidebarWeb` preference |
| Mobile | Server-sourced memory lane (#997), fork-only `memory_api.repository.dart` | New `drift_memory_list.page.dart` reading local Drift |

## Decisions

### D1 — The rule engine is the differentiator; the UI follows upstream

The fork ships **11 memory rule types** (birthday, favorites-throwback, month-recap,
on-this-day-place, people-together, person-throwback, recent-trip, season-recap, themed,
trip-anniversary, video-moments), all emitted as `MemoryType.Rule`. That server-side engine
is the product. The browsing UI is a delivery mechanism, so tracking upstream's page keeps
the fork cheap and current and concentrates investment in rules.

Consequence: the fork stops owning the index page.

### D2 — Retire #791 rather than re-applying it

Upstream's restructure **subsumes** the fork's fix. Verified in upstream's rewritten manager:
it reads `memoryId` from `page.params.id`, builds a lookup keyed by memory id, and computes
`previous`/`next` strictly within `memory.assets` — both go `undefined` at the memory's
edges. Its `+page.ts` additionally redirects a stray `assetId` to the memory that owns it via
`getMemoryWithAsset`. That is #791's intent implemented structurally rather than through a
query parameter.

The fork's `memoryId` param and `memory-viewer-source.ts` are therefore deleted, not ported.

### D3 — Default `sidebarWeb` to `true` (standing divergence)

Upstream gates the sidebar item on `memories.enabled && memories.sidebarWeb` and defaults
`sidebarWeb` to `false`. The fork's link is live today on `enabled` alone. Adopting upstream
verbatim would **silently remove the memories link for every existing Gallery user**.

The fork defaults `sidebarWeb: true` in `server/src/utils/preferences.ts`. Because
`getDefaultPreferences()` supplies defaults for keys absent from a stored preferences row,
this restores the link for existing users, not only new ones. This is a permanent divergence
from an upstream default and must be recorded as a fork patch so later rebases do not quietly
revert it.

### D4 — One sourcing rule on mobile

The fork's `memory`/`memory_asset` sync streams are owner-scoped, which is why #997 made the
mobile memory **lane** server-sourced. Upstream's new list page reads local Drift via
`getAll(onlyToday: false)`, so adopted verbatim it would show only owned memories while the
lane on the same screen shows shared-space memories too.

The list page is routed through `MemoryApiRepository` with a local fallback, mirroring
`MemoryService.getMemoryLane`. This is done by adding a service/api method rather than
editing upstream's drift `getAll`, keeping upstream's widened
`getAll(ownerId, {onlyToday, onlyFavorites})` intact as the offline path — a smaller standing
delta on files upstream actively develops.

### D5 — Accept the loss of search and month grouping

Of the fork index's three features, **all/saved is subsumed** by upstream's `onlyFavorites`
filter, and **rule-aware titles and subtitles are preserved for free**: upstream's page
imports `memoryLaneTitle` from `$lib/utils`, which the fork already redirects to its
rule-aware `getMemoryTitle`. Only **search** and **month grouping** are genuinely lost.

Approved to ship. The decision is reversible — re-add search onto upstream's page only if
rule volume proves it necessary. Call the removal out in release notes rather than letting
users discover it.

## Resulting shape

**Web index** — take upstream's `+page.svelte` / `+page.ts`. Delete the fork's page,
`memory-card.svelte`, `memory-index-utils.ts` and their four spec files.

**Web viewer** — adopt `/memories/[id]/[[photos]]/[[assetId]]/`; delete the fork's `/memory/`
viewer components; keep upstream's `/memory/…/+page.ts` redirect. `Route.memoryViewer`
changes shape, so fork call sites must be updated. The #791 regression assertions from the
fork's `MemoryViewer.spec.ts` are **ported onto upstream's viewer** rather than dropped:
D2 claims upstream provides that behaviour structurally, so a test must go red if it stops.

**Settings** — both layers coexist. The fork's admin `MemoriesSettings` (retention, per-rule
toggles, theme max distance, person-throwback dormancy) configures the rule engine; upstream's
modal (`showUpcoming`, `onlyFavorites`) filters one user's view. No overlap.

**Server** — purely additive, taken verbatim apart from D3: `id` / `isUpcoming` / `page` on
`MemorySearchDto`, `sidebarWeb` on the preferences DTO, type and defaults. The rule engine is
untouched.

**Generated artifacts** — regenerate OpenAPI (spec, TypeScript SDK, Dart client) and run
`make sql` for the new `memory.repository.sql` queries.

**i18n** — upstream adds three `en.json` keys, so the fork's nine-locale rule applies.
Deleting the fork index orphans keys (`memory_filter_all`, `memory_filter_saved`, and the
index's error/type labels); grep **both web and mobile** before removing any, because
constructed keys are invisible to a plain grep.

## Risks

1. **Both sides own `/memories/+page.svelte`.** This is the conflict shape that produces two
   concatenated file bodies — two import blocks, two `<script>` tags. Assert on the resolved
   file rather than trusting a clean merge.
2. **D2 is verified but must be re-checked after the rewrite lands**, at the fork's own viewer
   call sites, not only in upstream's manager.
3. **D3 is invisible to every gate.** A default flipped back during a later rebase produces no
   conflict, no type error and no test failure — only a missing sidebar link. It needs a fork
   patch entry.
4. **D5 is a deliberate user-visible regression.** It belongs in release notes.

## Out of scope

Re-adding search or month grouping to upstream's page; any change to the rule engine itself;
the memory-by-id deep-link limitation on mobile, which remains local-only and is unchanged by
this work.
