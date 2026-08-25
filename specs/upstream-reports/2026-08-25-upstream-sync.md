# Upstream Sync Report — 2026-08-25 (batches 158–161)

## Summary

- **Upstream commits pulled**: 4 (`8dcfd36fa57..fbd5dc2c618`), batches 158–161
- **Also folded in**: fork sync of `#1027` (mobile filter sheet Done bar), cherry-picked before the rebase
- **Conflicts resolved**: 28 across batch 158, 1 in batch 160, 1 in batch 161
- **Net tree change**: 90 files, +1752/-1619
- **Final HEAD**: `7492093fe72`
- **Risk level**: HIGH — the range was gated on a product decision, not a mechanical merge
- **Recommendation**: PROCEED — all local gates green, off `main`, nothing pushed to `main`

The plan that scoped this cycle called it "batch 157", but 157 was already integrated before
work started (`git log --oneline HEAD..8dcfd36fa57` returned nothing). The four pending commits
are batches 158–161; the stale "157" label survives only in the throwaway CI branch name,
which was corrected to `rebase/upstream-batch-161`.

## The product-direction gate

The oldest of the four pending commits, `351be957699` (`feat: memories view`, immich-28675),
creates two files the fork already owns —
`web/src/routes/(user)/memories/+page.svelte` and `+page.ts` — and rewrites two more the fork
has deltas on. Because it is the **oldest** commit in the range, quarantining it and taking the
other three would still have blocked on it: there were no safe commits to land ahead of it. The
whole range sat behind a product decision, worked through in
`specs/2026-08-25-upstream-memories-view-reconciliation-design.md` before any code moved.

**The decision**: converge the web memories UI onto upstream's new page (carousels, an
"Upcoming" section, per-user filter modal, pagination), and keep the fork's 11-rule memory
engine as the differentiator. The browsing UI is a delivery mechanism; the rule engine —
which stamps every candidate `MemoryType.Rule` and is what upstream has no equivalent of — is
the product. Concretely this meant:

- Delete the fork's own index page, `memory-card.svelte`, `memory-index-utils.ts` and their
  four spec files; take upstream's `+page.svelte` / `+page.ts` wholesale.
- Retire `#791` (the fork's `memoryId` query-param fix) rather than re-port it — upstream's
  route-param-scoped viewer (`/memories/[id]/…`) provides the same previous/next behaviour
  structurally, verified by reading the rewritten manager before deleting anything.
- Accept two deliberate, user-visible regressions (below) and one standing preference-default
  divergence to keep the sidebar link from disappearing for existing users.

## Incoming Upstream Changes

| SHA           | Summary                                   | Area              | Risk to Fork | Notes                                                          |
| ------------- | ----------------------------------------- | ----------------- | ------------ | -------------------------------------------------------------- |
| `351be957699` | feat: memories view (immich-28675)        | web/server/mobile | **HIGH**     | The product-direction gate; see above and Conflict Resolutions |
| `6acd8703719` | chore(deps): lock file maintenance (mise) | ml                | LOW          | Applied clean                                                  |
| `3d71c0c8dc0` | chore(deps): update github-actions        | ci                | LOW          | Applied clean                                                  |
| `fbd5dc2c618` | fix: don't swallow fetch errors           | web               | LOW          | Merged with a fork logging fix on the same file, see below     |

No new upstream server migrations arrived in this range.

## Conflict Resolutions

28 conflicts landed while replaying 1326 fork commits onto `351be957699`, then one apiece
against batch 160 and 161. Full per-commit detail lives in
`.superpowers/sdd/2026-08-25-memories-view-reconciliation/task-2-report.md`; the substantive
ones:

| File                                                                                                                          | Fork side                                                             | Upstream side                                              | Resolution                                                                                                                                                                                                  | Risk                 |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `memories/+page.svelte`, `+page.ts`                                                                                           | Fork's own index page (#455)                                          | New carousels/upcoming/pagination page                     | **Upstream wholesale** (D1). Asserted `script-tags=1` on the resolved file — not a concatenation.                                                                                                           | HIGH                 |
| `memories/[id]/…/MemoryViewer.svelte`                                                                                         | #791's history-source machinery                                       | Route-param-scoped viewer                                  | **Upstream wholesale** (D2/D6). Two hunks had auto-merged without conflicting, which would have left dangling imports; checked out upstream's file wholesale instead.                                       | HIGH                 |
| `route.ts`, `constants.ts`, `photos/+page.svelte`, `MemoryViewer.svelte`, `memory-manager.svelte.ts` (#791)                   | `memoryId` query param, `Route.memoryViewer` widened signature        | Route-param scoping supersedes it                          | **Upstream side / wholesale**. `#791`'s param and `memory-viewer-source.ts` deleted, not ported.                                                                                                            | MEDIUM               |
| `types.ts`, `preferences.ts`, `preferences-factory.ts`, `user-preferences.dto.ts` (×2 schemas), `FeatureSettings.svelte` (×2) | per-user `memories.types` map                                         | new `sidebarWeb` field                                     | **Union — all four keys** (`enabled`, `duration`, `types`, `sidebarWeb`) in every file. The highest-risk merge — see below.                                                                                 | HIGH                 |
| `memory.repository.ts`                                                                                                        | fork's `accessibleSearchBuilder`, `ownerId` moved out of base builder | upstream's `isUpcoming` `$if` block on `baseSearchBuilder` | **Merged** — upstream's block placed inside the fork's restructured base builder. This is where the first Critical bug originated (below).                                                                  | HIGH                 |
| `web/src/lib/utils.ts` (`getMemoryTitle`)                                                                                     | #418's rule-aware title/subtitle rewrite                              | new date-aware "N years ago" vs. localized-date branch     | **Merged, not either side** — fork keeps rule titles and the recent-trip fallback; the `OnThisDay` branch adopts upstream's `isOnThisDay` test. Taking either side alone would have dropped real behaviour. | MEDIUM               |
| `app_life_cycle.provider.dart`                                                                                                | fork's #513 resume-refresh call, targeting the memory lane            | provider renamed to `driftAllMemoriesProvider`             | **Both** — invalidates `driftMemoryLaneProvider` and `driftAllMemoriesProvider`; following either side alone loses coverage of one surface.                                                                 | MEDIUM               |
| `UserSidebar.svelte`                                                                                                          | fork's own memories row under Library (`enabled` only, `mdiHistory`)  | new row gated `enabled && sidebarWeb` (`mdiCards`)         | Auto-merged with **zero conflict** into two memories rows — caught by inspection, not by any gate. Fork's duplicate row and its now-unused `mdiHistory` import removed.                                     | HIGH (zero-conflict) |
| `machine-learning.repository.ts` (batch 161)                                                                                  | fork's `AbortError` rethrow                                           | upstream's fixed logging call (`warn(msg, error)`)         | **Merged** — taking the fork side alone would have silently reverted upstream's batch-161 fix.                                                                                                              | LOW                  |

## Two Critical bugs found in review

Both were zero-conflict semantic breaks — the merge was clean, `tsc` was clean, and nothing
failed until a reviewer traced the data flow by hand.

**1. The fork's `#486` "hide not-yet-shown memories" guard made upstream's new "Upcoming"
section provably always empty.** `#486` added an unconditional `showAt is null OR showAt <=
now` predicate to the shared query builder; upstream's new `isUpcoming: true` filter asks for
`showAt > now`. Together those are `false` for every row.

The first attempted fix (`hideUnshown = dto.isUpcoming !== true`) was itself dead code: the web
manager only ever sends `isUpcoming: false` or omits the field entirely (`omitBy` strips
`undefined` before the request goes out), so `dto.isUpcoming` is never actually `true` on the
served path — the guard still ran unconditionally and the section stayed empty. The reviewer's
suggested alternative, `!== false`, would **also** not have fired, since `undefined !== false`
evaluates to `true`.

The repository cannot distinguish, from the DTO alone, upstream's index saying "show upcoming"
from a legacy fork caller relying on `#486`'s implicit default — both send nothing. The fix
moves that default onto the caller instead of the DTO: the fork's owner-scoped `searchBuilder`
keeps `hideUnshownByDefault: true` (rule engine, unaffected), while the new
`accessibleSearchBuilder` — the one behind `GET /memories` — sets it `false`, so an omitted
`isUpcoming` no longer implies "hide". The memory lane (`GET /memories?for=<today>`) keeps its
`showAt` bound on both paths via a `dto.for !== undefined` clause. Covered by a new Kysely
log-capture repository spec (`recordingRepository()`, since `searchAccessible` ends in
`.execute()` and its SQL isn't reachable via `.compile()`): 5 cases failed before the fix, all
pass after.

**Behavioural change to carry forward**: `GET /memories` with neither `for` nor `isUpcoming`
now returns upcoming memories — an explicit decision, not a side effect.

**2. Upstream's `search()` gained `id`, a `page` offset and `showAt` ordering; the fork's
`searchAccessible` — which actually serves `/memories` — got none of them.** Two silent
consequences: `page` was never applied as an offset, and `loadMemory(id)` on a deep link opened
an **arbitrary** memory rather than the one the link named, because `id` was never applied as a
filter. Ported all three (`id` filter, `page`/`size` offset, `showAt`-then-`memoryAt`
ordering) into `searchAccessible`, matched clause-for-clause against upstream's own `search()`
rather than a hardcoded string, and verified `statisticsAccessible` shares the same builder so
`#total` and the list agree (this also closes the pagination spin risk, since `#hasNextPage`
can now actually go false).

**Correction (final fix wave):** an earlier draft of this section said the missing offset made
pagination "return page 1 forever, capping the visible list at roughly 250". That rationale was
wrong, though the fix is not. On `/memories` the served request was **unpaginated**, not capped:
`MemoryManager` seeds `#filters` with `{ size: 250, order }`, but `applyPreferences()` calls
`setFilters()` with a **freshly constructed** object (`{ order, isSaved?, isUpcoming? }`) that
replaces `#filters` wholesale and drops `size`. The server applies `LIMIT` only under
`dto.size !== undefined` and `OFFSET` only under `page && size`, so with `size` gone every call
returned the whole result set in one response and page 1 was all there ever was. The user-visible
symptom was therefore an over-large single response, not a 250-item cap. The `id`/`page`/`size`/
ordering port is still required — it is what makes a `size`-carrying caller (the mobile list,
and `/memories` before any preference is applied) page correctly at all.

## Standing divergences created or confirmed this cycle

These must survive future rebases — none of them is caught by any existing gate:

- **`memories.sidebarWeb` defaults `true`** in `server/src/utils/preferences.ts`, where
  upstream defaults `false`. Every sibling (`folders.sidebarWeb`, `people.sidebarWeb`,
  `sharedLinks.sidebarWeb`) defaults `false`; `memories` is the only one that doesn't. Reason:
  the fork's memories link has been live on `enabled` alone since `#455`, and `getPreferences`
  falls back to defaults for any key absent from a user's stored metadata row — taking
  upstream's default verbatim would silently remove the sidebar link for every existing user,
  not just new ones. A user who explicitly disagrees can still turn it off (upstream ships the
  toggle); that write persists as an explicit `false` via `getPreferencesPartial`. Guarded by a
  new server test (`defaults the memories sidebar link to on, unlike upstream`) and three
  `user-sidebar.spec.ts` cases that each pin both flags, so a later regression of the default
  fails a test rather than only losing a nav link silently.
- **The mobile memories list is served from the API**, not local Drift, mirroring the fork's
  existing memory-lane behaviour (`#997`) — memory sync is owner-scoped, so a local-only list
  would hide shared-space memories that the lane on the same screen shows. It uses the
  pagination immich-28675 itself adds (`page`/`size` on `MemorySearchDto`) via a new
  `MemoryApiRepository.getAllMemories`, with the existing local-Drift `getAll` kept intact as
  the offline fallback. It sends `isUpcoming: false` unconditionally, per Critical 1's finding
  that omitting the flag now lets upcoming memories back in.
- **`e2e/src/ui/generators/memory/model-objects.ts` keeps fork-only `createdAt`/`showAt`/
  `title`/`subtitle` support** on `MemoryConfig`, needed for the fork's rule-based memories.
  Three of the four upstream e2e files upstream touched
  (`memory-viewer.e2e-spec.ts`, `specs/memory/utils.ts`, `mock-network/memory-network.ts`)
  already matched upstream byte-for-byte after the replay; this generator file is the one
  genuine, deliberate divergence and must not be "restored" to upstream in a later cycle.

## Deliberate user-visible regressions (for release notes)

- The memories index loses **search** and **month grouping**. Upstream's `onlyFavorites`
  filter subsumes the fork's all/saved tabs (and does it better — server-side, URL-persisted
  into the viewer), and rule-aware **titles** survive for free since upstream's page already
  calls into the fork's `getMemoryTitle`. Search and month grouping have no upstream
  equivalent and are accepted as lost; reversible if rule volume later demands them back.

  **Correction (final fix wave):** rule-aware **subtitles** did _not_ survive for free, contrary
  to design decision D5 as originally written. Nothing on upstream's page or viewer imports
  `getMemorySubtitle`; its only caller was the deleted `memory-index-utils.ts`. Left as adopted,
  a recent-trip memory would have lost its `"12 photos over 3 days"` line, `getMemorySubtitle`
  would have been dead code with unreachable tests, and `recent_trip_subtitle` would have been
  orphaned in all ten locales. **Fixed rather than accepted:** the subtitle is rendered on
  upstream's card as a small fork delta (a bottom-anchored wrapper plus a conditional second
  `<p>`), guarded by `web/src/routes/(user)/memories/memories-page.spec.ts`. D5 in the design doc
  has been corrected to match.

- The memory **viewer now always exits to `/memories`** instead of returning to `/photos` when
  it was opened from the timeline lane. Upstream's viewer exits unconditionally to
  `memoryManager.memoriesHref`; the fork's source-aware exit route and its helper
  (`getMemoryViewerExitRoute`) are deleted along with `#791`.
- A bookmarked `/memory?id=…` deep link now **lands on the memories index rather than the
  original photo** — upstream's redirect shim sends it to `Route.memories()` and drops the
  asset. Accepted alongside the two regressions above.
- The **`/explore` memories strip now surfaces not-yet-shown memories**, with no "Upcoming"
  affordance to explain them. `web/src/routes/(user)/explore/+page.ts:9` sends neither `for` nor
  `isUpcoming`, and Critical 1 of this cycle changed exactly that combination: the fork's `#486`
  hide-unshown default moved off the DTO and onto the caller, so `accessibleSearchBuilder` now
  passes `hideUnshownByDefault: false` and an omitted `isUpcoming` no longer implies "hide".
  `/memories` handles this — it splits upcoming into its own labelled section and offers a
  `showUpcoming` toggle — but `/explore` renders one flat strip and does neither. **Documented,
  not changed:** the alternatives (pinning `isUpcoming: false` on `/explore`, or restoring the
  DTO-level default) each re-introduce the ambiguity Critical 1 removed, and the strip is a
  browsing surface where a few days of lookahead is not harmful. Revisit if it confuses users.

## Final fix wave (post-review, same cycle)

A whole-branch review plus two red CI jobs produced one more pass. Everything below is in the
branch; the three doc corrections above came from the same wave.

| Finding                                                                                                | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `//web:format` red — `MemoryViewer.spec.ts` unformatted                                                | Ran prettier; `npx prettier --check .` clean across the `web` package.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Upstream Rebase Tooling` red — 2 assertions in `tools/upstream-preflight/src/branded-spinner.spec.ts` | **Real fork-branding regression.** `routes/(user)/memories/+page.svelte` is member 25 of the fork's 25-file branded-spinner swapped set; adopting upstream's file byte-identically reverted the swap and shipped `@immich/ui`'s generic spinner instead of the Gallery-branded `$lib/components/shared-components/LoadingSpinner.svelte` (`/gallery-loader.svg`). Re-applied the swap in the sibling pattern used by `routes/(user)/utilities/geolocation/+page.svelte`; both assertions pass. This is exactly the class of loss the preflight guard exists to catch — it worked.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Memory viewer lost `enableGrouping` (fork feature #625)                                                | Re-applied on upstream's `GalleryViewer` call site. The prop still exists and is still honoured (`GalleryViewer.svelte:60/93/103/508`), so this was a genuine silent loss, not an obsolete prop. Guarded by a new `MemoryViewer.spec.ts` case asserting the stub's `data-enable-grouping`; proven load-bearing by removing the prop and watching it fail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `getMemorySubtitle` dead code / D5 wrong                                                               | Rendered the subtitle on upstream's card (route (a), not deletion) — see the corrected regression bullet above and D5 in the design doc. New `memories-page.spec.ts` (3 cases), red without the delta.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Mobile list truncated after a filtered page                                                            | **Real bug.** `MemoryApiRepository.getAllMemories` stopped on `batch.length < pageSize`, but the server applies `LIMIT`/`OFFSET` in SQL and only _then_ drops memories of a viewer-disabled type and memories left with no viewable assets (`memory.service.ts` `search`). Any user who turned one memory type off got a short page 1 and the list stopped there, hiding everything behind it. Fixed by keying the stop on `GET /memories/statistics`, whose `statisticsAccessible` counts through the **same** `accessibleSearchBuilder` predicates _without_ the `LIMIT` — the only signal that reflects what the server actually paged over. Web's `memory-manager.svelte.ts` stops the same way. A statistics failure degrades to an empty-page stop (never back to the post-filter length) rather than failing the call into the offline fallback. `maxPages = 50` backstop kept. Test `keeps paging past a page the server filtered short` fails against the old condition (3 memories instead of 53) and passes now. |

## Fork Feature Verification

| Feature                                                   | Status                       | Notes                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory rule engine (11 rule types, server)                | OK                           | Untouched — `memory.service.ts` and every `*.rule.ts` file carry no delta from this cycle. Its rule-aware **subtitles** were unreachable on web until the final fix wave restored the card rendering                                                                                                                                                            |
| Memories admin settings (system-wide)                     | OK                           | `MemoriesSettings.spec.ts` (212 lines) confirmed still green, not assumed                                                                                                                                                                                                                                                                                       |
| Memories per-user settings (`FeatureSettings`)            | OK                           | Four-key merge verified in all five source-of-truth files; guarded by a new exact-match test                                                                                                                                                                                                                                                                    |
| Memories web index + viewer                               | OK (converged onto upstream) | See product-direction gate; #791 regression assertions ported onto upstream's viewer, proven load-bearing by temporarily reintroducing the bug they guard and watching them fail. Two fork deltas were **lost and restored in the final fix wave**: the branded `LoadingSpinner` on the index and `enableGrouping` (#625) on the viewer — both now test-guarded |
| Memory lane (mobile, #997)                                | OK                           | `getMemoryLane` untouched — still hard-scoped to `for=<today>`, unaffected by this cycle                                                                                                                                                                                                                                                                        |
| Memories list (mobile, new this cycle)                    | OK (fixed in final wave)     | Server-sourced with local-Drift fallback. The final wave fixed a real truncation: the page-exhaustion condition trusted the post-filter page length. See the final fix wave table; `memory_api_repository_test.dart` 20/20                                                                                                                                      |
| Shared Spaces, Storage Migration, Pet Detection, Branding | OK                           | No conflicts touched these; verified no regression in local gate run                                                                                                                                                                                                                                                                                            |

## Preferences merge detail

The riskiest single merge in this cycle: `FeatureSettings.svelte` writes its payload as a
single object literal, and the fork's version (`{ enabled, duration, types }`) and upstream's
(`{ enabled, duration, sidebarWeb }`) collide on the same position. Resolving to either side
alone silently drops the other key — dropping `types` would reset every user's per-type memory
preferences to default, invisibly, with a clean type-check and no failing test. The resolved
literal carries all four keys everywhere: `server/src/types.ts`,
`server/src/dtos/user-preferences.dto.ts` (both the update and response Zod schemas),
`server/src/utils/preferences.ts`, `web/src/test-data/factories/preferences-factory.ts`, and
`FeatureSettings.svelte`. A new exact-`toEqual` guard test (`FeatureSettings.spec.ts`) asserts
the full four-key payload the component actually sends, so a future rebase that drops one of
them fails a test instead of shipping silently.

## Database Migration Analysis

Batches 158–161 added **no new upstream server migrations**. Gallery migration count is
unchanged at 61 (1 compatibility alias). `revert-to-immich.sql` coverage detector: clean, no
new migrations to list.

## Mobile Drift Migration Analysis

No new upstream mobile migration in this range; `schemaVersion` and the fork's v32–v36
snapshots are unaffected.

## Generated Artifacts

- OpenAPI spec and TypeScript SDK regeneration was a **true no-op** — empty `git status` for
  `open-api/`, `packages/sdk/`, `mobile/generated/`, confirming the rebase's hand-unioned
  `immich-openapi-specs.json` / `fetch-client.ts` hunks were already correct.
- `server/src/queries/memory.repository.sql` needed a real fix during the rebase (not a
  regen): the two new `search (upcoming filter)` / `(not upcoming filter)` blocks it inherited
  from upstream ordered by `asset.fileCreatedAt`, one token off the fork's `asset.localDateTime`
  used everywhere else in the file. Proved by compiling all four `@GenerateSql` variants
  offline and diffing against the committed file — every clause matched except that one token,
  in exactly the two upstream-added blocks. Corrected by hand; this closes the file without
  needing a database.
- **The SQL query-doc regen (`mise sql`) was deliberately skipped.** A local postgres was
  reachable, but it had only 149 of the tree's 157 migrations applied — running the regen
  against it would have silently overwritten already-correct query docs with output from a
  stale schema. Verified `git status -- server/src/queries` was clean instead, which — after
  the manual token fix above — is real evidence of correctness, not just "nothing uncommitted".

## Plan/tooling corrections found this cycle

1. **`make sql` does not exist.** `Makefile:155-156` prints "This command has been removed.
   Please use: mise sql". The plan and the repo's own Global Constraints both still say
   `make sql`.
2. **`make open-api` does not exist either** — same removal, same replacement: `mise open-api`.
3. **The plan's sample regex for the new memory viewer URL was wrong.** It assumed
   `/\/memories\/[0-9a-f-]+\//`; the real shape is `/memories/<id>?assetId=` (query param, not
   a path segment) — confirmed against `route.ts:116-117` before writing the e2e assertion.

## i18n

Three new upstream keys (`memories_current`, `memories_show_upcoming`, `memories_upcoming`)
translated into all nine required locales, inserted alphabetically, prettier-formatted. One
review round: the initial zh_Hans/zh_Hant `memories_upcoming` translations (即将/即將) were bare
adverbs that read as unfinished sentences standalone as a heading — the same files only ever
use that word followed by a verb elsewhere. Corrected to 即将到来/即將到來 (verb-complement
compounds that stand alone, parallel to the existing 当前/目前). Three orphaned fork-only keys
(`memory_filter_all`, `memory_filter_saved`, `memories_error`) were deleted from `en.json` and
all nine locales after confirming zero real usages; the constructed `memory_type_${type}`
family was kept, since `FeatureSettings.svelte` still builds and asserts it at runtime.

## Local CI Verification

| Check                                          | Status | Notes                                                                            |
| ---------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild)              | PASS   | 61 Gallery migrations synced, 1 compatibility alias                              |
| `server pnpm check`                            | PASS   | tsc clean                                                                        |
| `server pnpm test`                             | PASS   | 6080 passed / 12 skipped                                                         |
| `server pnpm lint` / prettier                  | PASS   |                                                                                  |
| `web check:typescript`                         | PASS   |                                                                                  |
| `web check:svelte`                             | PASS   | 627 files, 0 errors, 0 warnings                                                  |
| `web` eslint                                   | PASS   |                                                                                  |
| `web pnpm test`                                | PASS   | 5949 passed                                                                      |
| `e2e pnpm check`                               | PASS   | tsc only — the memory e2e specs were run explicitly under the `ui` project       |
| `dart analyze --fatal-infos`                   | PASS   | clean after regenerating CI-side codegen (OpenAPI client, drift schemas, router) |
| `flutter test`                                 | PASS   | 3455 passed                                                                      |
| `.github` prettier (separate package + CI job) | PASS   |                                                                                  |
| `revert-to-immich` migration coverage detector | PASS   | no new migrations to cover                                                       |
| `make commit-autolink-check`                   | PASS   | 1330 commit messages scanned                                                     |

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-161`
- **Final commit validated**: `23ccee65f85`

**All 10 workflows green.** Two commits are cited below because the final fix wave touched only
`mobile/`, `web/` and `specs/` — never `server/`, `machine-learning/`, `scripts/` or `.github/`.
The four workflows whose inputs did not change were therefore not re-run, and the commit each was
green on is recorded rather than implied.

| Workflow                                  | Status | Green on      | Notes                                                      |
| ----------------------------------------- | ------ | ------------- | ---------------------------------------------------------- |
| `test.yml`                                | GREEN  | `23ccee65f85` | 20-job suite; see the infrastructure note below            |
| `docker.yml`                              | GREEN  | `23ccee65f85` | builds the shipped server/web/cli/ml images                |
| `static_analysis.yml`                     | GREEN  | `23ccee65f85` | `dart analyze --fatal-infos`, format, generated-file drift |
| `gallery-mobile-smoke.yml`                | GREEN  | `23ccee65f85` | Android codegen/analyze smoke                              |
| `gallery-build-mobile.yml`                | GREEN  | `23ccee65f85` | iOS + Android compile                                      |
| `gallery-rebase-smoke.yml`                | GREEN  | `23ccee65f85` | rebase-targeted e2e smoke                                  |
| `gallery-ml-smoke.yml`                    | GREEN  | `7492093fe72` | `machine-learning/` unchanged since                        |
| `storage-migration-tests.yml`             | GREEN  | `7492093fe72` | `server/` unchanged since                                  |
| `storage-migration-e2e.yml`               | GREEN  | `7492093fe72` | `server/` + storage e2e unchanged since                    |
| `gallery-revert-to-immich-validation.yml` | GREEN  | `7492093fe72` | `scripts/` + migrations unchanged since                    |

### Real failures found and fixed by CI

Two defects reached CI that no local gate caught, both worth recording:

1. **A fork-branding regression.** `web/src/routes/(user)/memories/+page.svelte` is member 25 of
   the fork's 25-file branded-`LoadingSpinner` swapped set, enforced by
   `tools/upstream-preflight/src/branded-spinner.spec.ts`. Adopting upstream's page
   byte-identically reverted the swap, so the page would have shipped upstream's generic spinner
   instead of `/gallery-loader.svg`. The guard's own comment says it exists to "fail the _next_
   rebase if any file in the fork's swapped set reverts" — it did exactly that.
   **Byte-identical-to-upstream is the correct resolution for most adopted files and the wrong one
   for these 25.**
2. **Two web lint violations** (`better-tailwindcss` class order; `unicorn/prefer-scoped-selector`)
   in files added by the fix wave. Neither was catchable locally: `eslint` crashes on every
   `.svelte` file in this worktree due to the known `@koddsson/eslint-plugin-tscompat` bug,
   confirmed by a control run against untouched files.

Also of note: web `prettier --check` was initially skipped locally in favour of `eslint`, which is
the documented "eslint green != prettier green" trap in this repo. CI's `//web:format` caught it.

### Infrastructure incident (not repo defects)

Three intermediate runs failed on GitHub infrastructure while `githubstatus.com` reported "All
Systems Operational". Recorded so a future reader does not mistake them for regressions:

- DNS: `Name or service not known (internal-api.service.iad.github.net:443)` when fetching the
  `actions/github-script` and `immich-app/devtools` actions — 3 attempts, then hard failure. No
  repository code ran.
- Registry: `toomanyrequests: retry-after: 1.095831ms, allowed: 44000/minute` pulling the e2e
  `database`/`redis` images, and a 404 pulling `ghcr.io/immich-app/postgres:14-vectorchord0.4.3`
  for the medium-test container.

The documented remedy applied: wait out the limit, then re-dispatch staggered rather than firing
the full set at once. Every affected job passed on the staggered re-run with no code change.

## Post-Rebase Verification

- Fork commits ahead of upstream: level with `upstream/main` at `fbd5dc2c618`
- Commits behind upstream: 0
- Conflict markers in the working tree: none
- Nothing pushed to `main`; branch stays `rebase/upstream-rolling-v3.1.1`
