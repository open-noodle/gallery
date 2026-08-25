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
| Memory viewer | `/memory/[[photos]]/[[assetId]]/` with a fork `memoryId` query param (#791) and a source-aware exit route | Moved to `/memories/[id]/[[photos]]/[[assetId]]/` — memory scoping via route param; old path kept as a 307 redirect |
| `memory-manager.svelte.ts` | Fork delta extracting `memory-viewer-source.ts` (#791) | 374-line rewrite |
| Preferences | Fork-only per-user `memories.types` map **and** admin system config | Adds per-user `sidebarWeb` + a `MemoriesSettingsModal` |
| Mobile | Server-sourced memory lane (#997), fork-only `memory_api.repository.dart` | New `drift_memory_list.page.dart` reading local Drift |

## Decisions

### D1 — The rule engine is the differentiator; the UI follows upstream

The fork ships **11 memory rule types** (birthday, favorites-throwback, month-recap,
on-this-day-place, people-together, person-throwback, recent-trip, season-recap, themed,
trip-anniversary, video-moments). Rules emit `MemoryRuleCandidate`s, which carry no type of
their own; `memory.service.ts` stamps them `MemoryType.Rule` centrally (`:160`, `:209`). That
server-side engine is the product. The browsing UI is a delivery mechanism, so tracking
upstream's page keeps the fork cheap and current and concentrates investment in rules.

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
`sidebarWeb` to `false`. The fork's link is live today on `enabled` alone
(`UserSidebar.svelte:103`). Adopting upstream verbatim would **silently remove the memories
link for every existing Gallery user**.

The fork defaults `sidebarWeb: true` in `server/src/utils/preferences.ts`. The mechanism is
verified: `getPreferences` (`preferences.ts:61-70`) starts from `getDefaultPreferences()` and
`_.set`s only the keys present in the stored metadata row, so a key absent from that row falls
back to the default. This restores the link for existing users, not only new ones.
`getPreferencesPartial` persists only non-default values, so a user who later turns the
sidebar off has that `false` stored explicitly.

This is a **deliberate inconsistency** with its siblings: `folders.sidebarWeb`,
`people.sidebarWeb` and `sharedLinks.sidebarWeb` all default `false`, and `memories` would be
the only one defaulting `true`. The justification is that memories is a fork flagship and is
already `enabled: true`, and that upstream ships a user-facing toggle for it in
`FeatureSettings.svelte` — a user who disagrees can turn it off. It must be recorded as a fork
patch, because nothing in CI detects a default silently reverting during a later rebase.

### D4 — Mobile list page is server-sourced, via upstream's new pagination

The fork's `memory`/`memory_asset` sync streams are owner-scoped, which is why #997 made the
mobile memory **lane** server-sourced. Upstream's new list page reads local Drift via
`getAll(onlyToday: false)`, so adopted verbatim it would show only owned memories while the
lane on the same screen shows shared-space memories too. One screen must have one sourcing
rule.

**It cannot reuse `getMemoryLane()`.** That method is hard-scoped to a single day —
`_searchMemoriesFor(DateTime.now())` issues `GET /memories?for=<today>` — and its own
docstring records why dropping `for` is not a workaround: the server only applies `hideAt`
when `for` is present, so an unscoped call returns every memory still inside the retention
window (365 days by default) with all of its assets attached.

The list page instead uses **the pagination immich-28675 itself adds** (`page` and `size` on
`MemorySearchDto`) through a new `MemoryApiRepository` method, with the local Drift query as
the offline fallback. Upstream's widened `getAll(ownerId, {onlyToday, onlyFavorites})` is kept
intact as that fallback path, so the standing fork delta stays off the files upstream actively
develops.

**Open question for the implementation plan:** because the paginated call omits `for`, the
server does not apply `hideAt`. The plan must decide whether the list is *supposed* to include
hidden memories (upstream's local query filters them only under `onlyToday`), and either
filter client-side or extend the server filter. This must be settled before coding, not
discovered in review.

### D5 — Accept the loss of search and month grouping

Of the fork index's three features, **all/saved is subsumed** by upstream's `onlyFavorites`
filter — and upstream's is strictly better, filtering server-side (`isSaved` on the search)
and threading the choice through the URL so it survives into the viewer. Only **search** and
**month grouping** are genuinely lost.

**Rule-aware _titles_ are preserved for free; rule-aware _subtitles_ are not.** Upstream's page
and viewer import `memoryLaneTitle` from `$lib/utils`, which the fork already redirects to its
rule-aware `getMemoryTitle` — so titles come across at zero cost. Nothing on either surface
imports `getMemorySubtitle`: its only caller was the fork's `memory-index-utils.ts`, which this
change deletes. Adopting upstream's card verbatim therefore drops the subtitle the rule engine
still produces (recent-trip's `"12 photos over 3 days"`, from the `assetCount`/`dayCount` rule
context), leaves `getMemorySubtitle` dead code with unreachable tests, and orphans
`recent_trip_subtitle` in all ten locales.

**Corrected disposition (2026-08-25, final fix wave):** the subtitle is **restored** on
upstream's card rather than deleted. Upstream's card body is a single absolutely-positioned
`<p>` holding the title; wrapping it in a bottom-anchored `<div>` and appending a conditional
second `<p>` is a small, self-contained fork delta that does not fight upstream's layout, and it
recovers real behaviour the server-side rule engine is already generating. Guarded by
`web/src/routes/(user)/memories/memories-page.spec.ts`, which goes red when the subtitle line is
removed.

Approved to ship. Reversible — re-add search onto upstream's page only if rule volume proves
it necessary. Call the removal out in release notes.

### D6 — Accept upstream's unconditional viewer exit

The fork's `getMemoryViewerExitRoute(source)` exits the viewer to `/photos` when it was opened
from the timeline memory lane and `/memories` when opened from the index. Upstream's viewer
exits unconditionally to `memoryManager.memoriesHref` (`MemoryViewer.svelte:93`, `:237`,
`:317`).

Approved to accept upstream's behaviour: the helper and its spec are deleted with
`memory-viewer-source.ts`, and no fork delta is added to the viewer. This **is** a user-visible
change on the most common entry point — timeline → memory → Escape now lands on `/memories`
rather than back on the timeline — and belongs in release notes alongside D5.

## Resulting shape

**Web index** — take upstream's `+page.svelte` / `+page.ts`. Delete the fork's page,
`memory-card.svelte`, `memory-index-utils.ts` and their four spec files.

**Web viewer** — adopt `/memories/[id]/[[photos]]/[[assetId]]/`; delete the fork's `/memory/`
viewer components and `memory-viewer-source.ts`; keep upstream's `/memory/…/+page.ts`
redirect. The #791 regression assertions from the fork's `MemoryViewer.spec.ts` are **ported
onto upstream's viewer** rather than dropped: D2 claims upstream provides that behaviour
structurally, so a test must go red if it stops.

One fork delta **must** be re-applied on upstream's viewer: the fork passes `enableGrouping` to
`GalleryViewer` on the memory gallery strip (feature #625). Upstream's viewer does not, and the
prop defaults `false`, so adopting the file byte-identically silently removes asset grouping
with no conflict, no type error and no test failure. Guarded by an `enableGrouping` assertion in
the ported `MemoryViewer.spec.ts`.

**Routing** — `Route.memories` exists on both sides with **different signatures**: upstream
repurposes it from the viewer (`/memory`, `{id}`) to the index (`/memories`, `{isSaved}`) and
adds `viewMemory` / `viewMemoryAsset`. The fork's `Route.memoryViewer` maps onto those. One
**surviving** non-spec call site must be migrated:
`web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte:586`. The other two
(`MemoryViewer.svelte:106`, `memory-card.svelte:27`) are deleted with their files.

**Preferences — the highest-risk merge in this change.** The fork carries a per-user
`memories.types` map alongside `enabled` / `duration`, in `server/src/types.ts:739`, both zod
schemas (`user-preferences.dto.ts:25-28`, `:147`), the web test factory
(`preferences-factory.ts:27`) and `FeatureSettings.svelte`. Upstream adds `sidebarWeb` to
every one of those. **`FeatureSettings.svelte` writes them in a single object literal** — the
fork at `:59` writes `{ enabled, duration, types }`, upstream writes
`{ enabled, duration, sidebarWeb }` — so resolving to either side silently drops the other
key, and dropping `types` resets every user's per-type memory preferences to default. It
type-checks clean and no existing test covers it. The resolved literal must carry **all four**
keys, and the same four-key check applies to each of the files listed above.

**Settings surfaces** — there are now three, and they are not interchangeable. The fork's
admin `MemoriesSettings` configures the rule engine system-wide (retention, per-rule toggles,
theme max distance, throwback dormancy). The fork's `FeatureSettings` memories accordion is
per-user and controls `enabled` / `duration` / `types`. Upstream's `MemoriesSettingsModal` is
per-user view filtering (`showUpcoming`, `onlyFavorites`) reached from the index page. All
three are kept; the plan should confirm the two per-user surfaces read consistently rather
than assuming they do.

**Server** — otherwise purely additive, taken verbatim: `id` / `isUpcoming` / `page` on
`MemorySearchDto`, `sidebarWeb` on the preferences DTO, type and defaults. The rule engine is
untouched.

**Generated artifacts** — regenerate OpenAPI (spec, TypeScript SDK, Dart client) and run
`make sql` for the new `memory.repository.sql` queries. `make sql` requires a running database
or it deletes every file under `server/src/queries/`.

**i18n** — upstream adds three `en.json` keys (`memories_current`, `memories_show_upcoming`,
`memories_upcoming`), so the fork's nine-locale rule applies to all three.

Deleting the fork index orphans some of its keys but not others, and the two cases were
resolved by inspection rather than left to the implementer:

- **Safe to delete** — `memory_filter_all`, `memory_filter_saved`, `memories_error`. Their
  only real consumer is the index page being removed.
- **Must survive** — the `memory_type_${type}` family. `memory-index-utils.ts` uses it and is
  being deleted, but it is also **constructed at runtime** by the surviving
  `FeatureSettings.svelte:125` and asserted by three surviving specs
  (`MemoriesSettings.spec.ts`, `FeatureSettings.spec.ts`, `AppSettings.spec.ts`).

Method note for whoever repeats this: grepping `mobile/lib` for an orphan check is useless
unless `lib/generated/` is excluded. `translations.g.dart` and `codegen_loader.g.dart` are
generated *from* `en.json`, so every key in `en.json` always matches there and every key looks
used.

## Test strategy

Adopting upstream's page removes fork tests; the replacements are not optional.

**Must be updated or they break, or pass for the wrong reason:**

- `user-sidebar.spec.ts` — `beforeEach` (`:83`) sets only `memories.enabled = true`. Once the
  gate is `enabled && sidebarWeb`, the positive assertion (`:~124`) **fails**, and "hides the
  memories link when memories are disabled" (`:128`) starts passing **vacuously** — hidden
  because `sidebarWeb` is false, not because `enabled` is. Needs explicit cases for both flags
  in both states, including one that would fail if D3's default regressed.
- `preferences-factory.ts` — must carry both `types` and `sidebarWeb`, or every web test using
  it gets a wrong-shaped preferences object.
- `photos-page.spec.ts` (`:257`, `:1178`) — asserts on `memories.enabled`; re-check under the
  new gate.

**Must be ported:** the #791 regression assertions from `MemoryViewer.spec.ts` (276 lines)
onto upstream's viewer.

**Must be confirmed still green, not assumed:** `MemoriesSettings.spec.ts` (admin, 212 lines);
the fork's server deltas on `memory.service.spec.ts` (+975) and the medium
`memory.service.spec.ts` (+1265) against the widened DTO.

**e2e** — upstream modifies `e2e/src/ui/specs/memory/memory-viewer.e2e-spec.ts`,
`specs/memory/utils.ts`, `mock-network/memory-network.ts` and
`generators/memory/model-objects.ts`. Take upstream's versions.

The fork **does** have its own memory e2e: `memory-index.e2e-spec.ts` is fork-only, and every
assertion in it targets something this change removes — the month-group headings, the `Saved`
tab, and the `/memory?id=…&source=history` URL. Upstream ships no memory-index e2e, so
deleting it outright would leave the index with zero coverage on either side. It is rewritten
to cover the surviving journey: the index lists memories and opens one in the viewer.

Note that `e2e/`'s `pnpm check` is a type-check only — it never runs a spec. The memory UI
specs must be run explicitly under the `ui` Playwright project.

**Mobile** — D4 needs new coverage for the server-first list path and its offline fallback,
alongside the fork's existing `memory_api_repository_test.dart` (240 lines),
`memory_service_test.dart`, `main_timeline_memory_lane_test.dart` and `memory_provider_test.dart`.

## Edge cases

| Edge case | Disposition |
| --- | --- |
| Bookmarked `/memory?id=…&memoryId=…` deep link | Upstream's shim redirects to `Route.memories()`, **dropping the asset** — the bookmark lands on the index, not the photo. Accepted; note in release notes with D5/D6. |
| Timeline → viewer → Escape | Lands on `/memories`, not the timeline. Accepted per D6. |
| Mobile list: server fails **and** local Drift empty | Not yet specified. The plan must define the empty-vs-error state; the lane's fallback only covers server failure with a populated local DB. |
| Mobile list: `hideAt` not applied on the paginated call | Open question in D4; must be settled before coding. |
| Mobile list: pagination exhaustion / duplicate pages | Plan must specify the stop condition; upstream's web page has one, the mobile page is new. |
| User explicitly sets `sidebarWeb: false` | Correct by construction — `getPreferencesPartial` persists non-defaults. |
| `memories.types` key dropped during the `FeatureSettings` merge | Silent per-user data loss. Covered by the four-key check above; add an assertion that the submitted payload carries all four keys. |
| Constructed `memory_type_${type}` i18n keys | Must survive; used by `FeatureSettings.svelte:125`. |

## Risks

1. **Both sides own `/memories/+page.svelte`.** This is the conflict shape that produces two
   concatenated file bodies — two import blocks, two `<script>` tags. Assert on the resolved
   file rather than trusting a clean merge.
2. **The preferences merge is the silent one.** Nothing in CI catches a dropped `types` key.
3. **D3 is invisible to every gate.** A default flipped back during a later rebase produces no
   conflict, no type error and no test failure — only a missing sidebar link.
4. **D5 and D6 are deliberate user-visible regressions.** They belong in release notes.

## Out of scope

Re-adding search or month grouping to upstream's page; any change to the rule engine itself;
reconciling the two per-user settings surfaces into one; the memory-by-id deep-link limitation
on mobile, which remains local-only and is unchanged by this work.
