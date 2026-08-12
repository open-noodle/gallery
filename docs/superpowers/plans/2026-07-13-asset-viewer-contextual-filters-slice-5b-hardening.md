# Asset Viewer Contextual Filters — Slice 5b (Hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Why this slice exists:** a six-agent audit of slices 1–5 (2026-07-13) found no authorization bypass and no data leak, but **4 Critical and ~10 Important** defects. Two themes:

1. **The tests don't guard the one field the spec calls the leak vector.** Disabling the `ownerId` clause in `searchAssetBuilder` leaves the **entire 4,799-test server unit suite green** (verified by mutation, twice).
2. **The "filter honesty" invariant this branch exists to establish is still violated** on the album grid, on the map's people/tag semantics, and on shared links (the temporal filter silently doesn't travel).

This slice fixes those before slices 6 (chips) and 7 (DetailPanel) build on top. **Slice 7 makes every one of these reachable in one click** — today most are only reachable by hand-typing a URL.

**Spec:** `docs/superpowers/specs/2026-07-12-asset-viewer-contextual-filters-design.md` (§4.4 RBAC, §5.6, §7, §8). NOTE: the spec has **drifted** — Task 10 corrects it.

## Decisions (made by the repo owner 2026-07-13 — implement exactly these, do not relitigate)

| #   | Decision                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **The map ANDs people/tags**, like every other surface. Drop `personMatchAny`/`tagMatchAny`.                                                                                           |
| D2  | **`year`/`month` go into the URL codec.** The temporal filter must survive a share and a reload. This lets `pendingFilterUrlSync` + `preserveTransientTemporalFilters` be **deleted**. |
| D3  | **`/photos` ANDs the album gate with the owner gate** (album ∩ my-own-scope). The album PAGE keeps its album-only scoping (intentional, medium-tested as E22).                         |
| D4  | **The album map matches the album grid on visibility** (`Archive \| Timeline`). Accepted caveat: another member's archived asset in the album gets a pin.                              |

## Global Constraints

- **Server:** `pnpm test -- --run <path>` (note the `--`). Zero-warning lint. `pnpm format:fix` before committing. No relative imports — use the `src/` alias.
- **Web:** run from `web/`; `pnpm test --run "<path>"` (NO `--`); quote bracketed paths. Lint has **no** `--max-warnings 0` (~641 pre-existing tailwind warnings, exits 0) — required **0 errors**. **Never** `eslint --fix` across the package. `svelte/prefer-svelte-reactivity` (a bare `new URLSearchParams` in a `.svelte` file) and `tscompat` (`URLSearchParams.size`) are real lint **ERRORS**.
- **Docker is now UP on this machine** — medium tests and e2e **can and MUST be run locally** for this slice. Do not defer them to CI. ⚠️ The medium suite is sensitive to **concurrent runs against the shared testcontainer** — run it once, serially; a parallel run produces phantom failures.
- Any DTO change ⇒ regenerate the SDK (`mise run open-api` from the repo root). Never hand-edit generated files.
- i18n keys only in `i18n/en.json` (repo root — shared by web AND mobile).
- No `Co-Authored-By` / `Generated-with` trailers.

---

### Task 1 — CRITICAL: pin `ownerId` on the search/map builder (RBAC)

`server/src/utils/database.ts:767` — `.$if(options.ownerId !== undefined, …)` — implements `ownerId` for **`GET /gallery/map/markers`** and **all four search endpoints** (`ownerId` is on `BaseSearchSchema`, so metadata/random/smart/statistics all inherit it). **Nothing tests it.**

Two undetected mutations, both in scope:

- **Delete the AND** ⇒ `?ownerId=<stranger>` returns the caller's whole visible scope instead of `[]` (violates E20/E21 on five endpoints).
- **Merge `ownerId` into `userIds`** at the repository level (e.g. `anyUuid([...options.userIds, options.ownerId])`) ⇒ a genuine **cross-owner widening leak**. The only current guards are service-level _mock_ assertions (`search.service.spec.ts:1474`, `shared-space.service.spec.ts:9658`), which a repository-level change bypasses entirely. The timeline path has E21b/E21c for exactly this vector; the search path has nothing.

- [ ] **Step 1 (RED):** add medium tests to `server/test/medium/specs/services/search.service.spec.ts`, reusing the **two-owner Space fixture** pattern `createTwoOwnerSpace` (`timeline.service.spec.ts:86-116` — anna + ben both contribute assets, plus a viewer and an editor who own nothing). ⚠️ **It is module-local and NOT exported**, and the search medium `setup()` yields a different `SearchCtx` — so **copy/adapt it**, or extract it into a shared medium helper. Say which you did.
  - `searchMetadata(viewerAuth, { spaceId, ownerId: anna.id })` ⇒ **only anna's** assets (and a **non-empty baseline first**, so the assertion can't pass vacuously on an empty result).
  - `searchMetadata(viewerAuth, { ownerId: stranger.id })` ⇒ `[]`, again with a non-empty baseline (mirror the pattern at `timeline.service.spec.ts:623`).
  - **The widening vector:** `searchMetadata(viewerAuth, { withSharedSpaces: true, ownerId: <a space member> })` ⇒ only that member's assets, and `{ withSharedSpaces: true, ownerId: <stranger> }` ⇒ `[]` (the E21b/E21c twins).
- [ ] **Step 2 (RED, e2e):** in `e2e/src/specs/server/api/gallery-map.e2e-spec.ts`, add `GET /gallery/map/markers?ownerId=<member>` ⇒ only that member's pins, and `?ownerId=<stranger>` ⇒ `[]`. Sanity-pin that the member's asset _does_ produce a marker unfiltered, or the `[]` assertion proves nothing.
- [ ] **Step 3 (verify the tests are load-bearing — BOTH mutations, spelled out):**
  1. **Delete-the-AND:** change `database.ts:767` to `.$if(false, …)`. Run the new medium + e2e tests → they MUST go **RED**. (Today the entire 4,799-test unit suite stays green under this mutation — that is the defect.)
  2. **Merge-into-`userIds` (the LEAK direction — this one MUST be pinned):** restore `:767`, then change the `userIds` clause at `:780` to `anyUuid([...options.userIds!, options.ownerId!])`. At least one new test MUST go **RED**. A service-level mock assertion cannot catch this, which is precisely why the medium/e2e tests are required.

  Restore after each and confirm `git diff` is empty. Report both RED outputs.

- [ ] **Step 4:** GREEN. Commit.

---

### Task 2 — CRITICAL: the album grid must apply the text filters it chips (#767c, album surface)

`web/src/lib/utils/album-filter-options.ts` (`applyCommonFilterFields`, `buildAlbumTimelineOptions`) never forwards `description`, `originalFileName`, `ocr`, `isInAlbum`, `isNotInAlbum` — but `hydrateAlbumFilters` (`albums/…/+page.svelte:128-132`) hydrates them from the URL, `getActiveFilterCount` counts them, and `ActiveFiltersBar` renders a removable chip for each. **And the same album's map (`buildAlbumMapMarkerOptions`) DOES forward them** — so the grid and the map of one album, showing identical chips, disagree.

- [ ] **Step 1 (RED):** in `album-filter-options.spec.ts`, assert `buildAlbumTimelineOptions` forwards all five. Add a page-level test: `/albums/{id}?description=beach` ⇒ the timeline options carry `description`.
- [ ] **Step 2 (GREEN):** hoist the five into `applyCommonFilterFields`, mirroring `space-filter-options.ts:35-58`.
- [ ] **Step 3 (the picker):** `buildAlbumAssetPickerOptions` drops `lensModel`/`state`/`ownerId` that its sibling forwards, and **both configs share one `sections` const** (`album-filter-config.ts:9`) — so adding `'text'` for the album grid turns the _picker_ into the same lie in one line. Either give the picker the same forwarding, or **pin the intentional drop with a test** so it cannot rot silently. Choose one and say which in the report.
- [ ] **Step 4:** GREEN; commit.

---

### Task 3 — CRITICAL: `pendingFilterUrlSync` stranding — deleted, not patched (D2)

`pendingFilterUrlSync` is a single slot cleared **only** when an incoming `page.url.search` string-matches the record it holds (album `+page.svelte:309-328`, map `+page.svelte:276-295`). An interceding navigation leaves the record **stale**; a later, unrelated navigation that produces the same search string then wrongly resurrects the old `selectedYear`. Reproduced.

**D2 removes the root cause instead of patching it:** once `year`/`month` are in the URL, there is no transient temporal state to carry across the round trip, and the whole mechanism can go.

- [ ] **Step 1 (RED — the codec):** in `filter-url.spec.ts`: `encodeFilterParams` emits `year`/`month`; `decodeFilterParams` parses them; a full round-trip preserves them. **Malformed input must be rejected** (`?year=abc`, `?year=0`, `?year=99999`, `?month=13`, `?month=0`, `?month=abc`) → `undefined`, no crash. Add `year`/`month` to `FILTER_URL_PARAMS` (so `clearFilterParams` clears them — otherwise `buildFilterStateUrl`'s REPLACE semantics break and a cleared year could never be removed). **`year`/`month` are verified-free param names** — nothing reads them today.

  **⚠️ Precedence (I2):** `buildFilterContext` (`filter-panel.ts:205-217`) prefers `dateAfter`/`dateBefore` over `selectedYear`, and the panel keeps them mutually exclusive. Once `year` is encodable, a hand-typed `?from=2024-01-01&year=2023` would decode to **both** — the year inert in the query but still **counted** by `getActiveFilterCount` and re-encoded on the next sync: exactly the counted-but-not-applied lie this slice exists to kill. So **`encodeFilterParams` must NOT emit `year`/`month` when `dateAfter`/`dateBefore` are set**, mirroring `buildFilterContext`'s precedence. Test both the encode suppression and the decode side.

- [ ] **Step 2 (RED — the surfaces):** a **shared link** carries the year: `/photos?year=2023` hydrates `selectedYear: 2023`, renders the chip, and the timeline options carry `takenAfter: 2023-01-01` / `takenBefore: 2024-01-01`. Same for `/spaces/{id}`, `/albums/{id}`, `/map`.
- [ ] **Step 3 (RED — the bug this retires):** on `/photos` **and** `/spaces`: pick a year → open an asset → close it (writes `?at=<id>`) → **the year survives**. Both pages **do** have the `pendingFilterUrlSync` machinery; what they lack is `withoutAtParam`, which is _why_ the `?at=` write strands the year there. D2 retires the whole problem.
- [ ] **Step 4 (GREEN — and the delete list is FOUR pages, not two):** encode/decode `year`/`month`, then delete the carry-over machinery from **every** consumer:
  - `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte` (`:128, 444, 519, 524, 527-528`)
  - `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` (`:801, 842, 911, 916, 919-920`)
  - the album page (`:309-328`) and the map page (`:276-295`)
  - `web/src/lib/utils/searchable-page-search.ts` — the `SearchablePageTransientTemporalState` type (`:17`) **and** `preserveTransientTemporalFilters` (`:135`); plus `searchable-page-search.spec.ts:8,137,147`
  - the now-stale comment in `web/src/test-data/mocks/reactive-page.mock.svelte.ts:8`

  **⚠️ Two existing tests explicitly pin "picking a year writes NOTHING to the URL" and MUST be inverted, not "fixed" by re-adding a no-write guard:**
  - `map-page.spec.ts:495-502` — `expect(gotoMock).not.toHaveBeenCalled()`, commented _"A year is transient — it is not in the URL codec, so it must not have triggered a write."_
  - `page.route.spec.ts:544-560` — labelled "THE pendingFilterUrlSync test", same assertion.

  Under D2 a year **does** write. Replace both assertions with: the `goto` target now contains `year=2015` / `year=2024`.

- [ ] **Step 5:** the `withoutAtParam` token guards on album/map now only avoid a pointless re-hydrate rather than preventing data loss — **keep them, but rewrite their comments**, which currently claim they stop the year being dropped. Run the FULL web suite (all four page specs).
- [ ] **Step 6:** commit.

---

### Task 4 — CRITICAL: the map ANDs people/tags (D1)

`server/src/services/shared-space.service.ts:807-808` sets `personMatchAny: true, tagMatchAny: true` — the **only** caller in the entire server that does (verified). Every timeline path ANDs (`database.ts:721,724`). So: filter by Alice **+** Bob, click the map → ~double the pins, identical chips. It also makes the cluster panel (which ANDs) contradict its own pin count, and makes "Add all N to…" show the OR count while collecting the AND set.

- [ ] **Step 1 (RED):** unit test — `getFilteredMapMarkers` does **not** pass `personMatchAny`/`tagMatchAny`. e2e — two people, one asset with **both** and one with **only one**: `?people=a,b` returns **only** the both-asset's marker.
- [ ] **Step 2 (GREEN):** remove both flags from the marker call.
- [ ] **Step 3 — three existing tests PIN the OR behavior. Invert them (do not delete):**
  - `server/src/services/shared-space.service.spec.ts:9373` — `'should pass personMatchAny and tagMatchAny flags to repository'`
  - `:9392` — `'should pass personMatchAny for space person IDs'`
  - `:9470` — a third `personMatchAny: true` assertion

  Each must now assert the flags are **absent**. Leave `search.repository.spec.ts:367,628` alone — those pass the flag explicitly at the _repository_ layer and remain valid (the repository still supports OR; the map just stops asking for it). Commit.

---

### Task 5 — `/photos` ANDs the album gate with the owner gate (D3)

`server/src/services/timeline.service.ts:127-133`: when `albumId` is present, `dto.userId` is **not** defaulted to `auth.user.id`, so `userIds` is `undefined` and the timeline is scoped **only** by the album. With the new album chip emitted from `/photos`, `?albumId=A&ownerId=<co-member>` shows that co-member's assets on your **personal** timeline, and the Favorites chip returns the **album owner's** favorites (`asset.isFavorite` is the owner's flag).

**⚠️ THE SERVER NEEDS NO QUERY CHANGE — and "fixing" it there would BREAK E22.** The query already ANDs correctly: the album join (`asset.repository.ts:333`) and the `userIds` scope (`:376`/`:379`) are independent `$if`s. The only reason `/photos?albumId=` loses the owner gate is that **`/photos` never sends `userId`** once `albumId` is present. `timeBucketChecks` must **keep** not defaulting `userId` under `albumId` — E22 (`test/medium/specs/services/timeline.service.spec.ts:740`, an album viewer filtering by the album owner's camera) depends on exactly that. A literal `dto.userId ||= auth.user.id` default would break it. **This is a WEB-ONLY fix.**

- [ ] **Step 1 (RED, medium) — and mind the fixture trap.** A `/photos`-shaped call (`userId` present) with `albumId` ⇒ album ∩ my-own-assets; a co-member's asset in the album is **excluded**.

  **The trap:** `/photos` also sends `withPartners: true, withSharedSpaces: true` (`photos-filter-options.ts:18-22`). With `userId` **and** `withSharedSpaces`, `buildTimeBucketOptions` (`timeline.service.ts:79-85`) computes `timelineSpaceIds`, and `asset.repository.ts:379` makes the scope `ownerId IN userIds` **OR** `in-a-timeline-space`. So a co-member's album asset that _also_ lives in one of the caller's timeline spaces **will still appear — correctly**. The fixture must therefore use an **album-only shared asset** (owned by a co-member, in the album, in **no** shared space), or the test is either vacuous or red for the wrong reason.

- [ ] **Step 2 (GREEN):** make `/photos` send `userId` alongside `albumId` — `web/src/lib/utils/photos-filter-options.ts`. **Server unchanged.** E22 staying green is the proof you did not over-fix. Check whether `POST /search/metadata` has the same web-side omission and fix it the same way if so.
- [ ] **Step 3 (Minor, same file):** `timeline.service.ts:127-131` is an `else if`, so with `spaceId` **and** `albumId` only `AlbumRead` is checked while the space predicate still applies — a caller with access to album A can learn _which of A's assets belong to a space S they are not a member of_ (a membership oracle; no asset leaks). The **map 400s this exact combination**; the timeline does not. Check **both** permissions when both are present, or mirror the map's 400. Test it.
- [ ] **Step 4:** commit.

---

### Task 6 — the album map matches the album grid on visibility (D4)

`shared-space.service.ts:806` hardcodes `visibility: AssetVisibility.Timeline`, but the album grid uses `withDefaultVisibility` = `Archive | Timeline` (`database.ts:104-106`), and the comment at `:737-742` **claims parity with the grid**. So an archived, geotagged asset in an album shows in the grid with **no pin** on the map.

⚠️ `searchAssetBuilder` has **no `Archive | Timeline` mode**: `visibility: undefined` skips the clause entirely (admitting Hidden **and** Locked — do NOT do that), and `'not-locked'` still admits Hidden. This needs a small, explicit builder extension (a visibility **list**, or a `withDefaultVisibility` equivalent) — not a one-line service tweak.

- [ ] **Step 1 (RED, e2e):** an **archived** geotagged asset in an album has a pin on the album map. Also assert **Hidden**, **Locked** and **Trashed** assets still have **NO** pin (this is the whole risk of the change — prove the widening is exactly one visibility state, not four).
- [ ] **Step 2 (GREEN):** extend the builder with an explicit `Archive | Timeline` mode and use it for the album-boundary query only. **Do not change any other caller's visibility.**
- [ ] **Step 3:** fix the misleading comment. Commit.

---

### Task 7 — escape ILIKE wildcards on the search/map path

`database.ts:756-780` (`searchAssetBuilder`) builds `ilike '%' || f_unaccent($1) || '%'` for `originalFileName` / `description` / `originalPath` with **no** `escapeLikePattern` and **no** `ESCAPE` clause. The time-bucket path **does** escape (`asset.repository.ts:261, 323, 408`). The map routes through `searchAssetBuilder` and **newly** accepts these filters, so the divergence is new to this branch.

Failure: a filename filter of `IMG_1234` — `_` is a single-char wildcard on the map, a literal in the timeline, so the map matches `IMG-1234` too and shows **more pins than the timeline has assets**. `_` is in nearly every camera filename prefix (`IMG_`, `DSC_`, `PXL_`), so this fires on essentially every filename filter. Not a security issue (values are parameterized; the wildcard only widens the _filter_ dimension, never the scope predicates).

- [ ] **Step 1 (RED):** medium/e2e — a filename filter of `IMG_0001` must **not** match an asset named `IMG-0001`. A `%` in a filter value must be a literal.
- [ ] **Step 2 (GREEN):** export `escapeLikePattern` (currently `asset.repository.ts:261` — move it to `src/utils/database.ts`) and apply it + `escape '\'` in `searchAssetBuilder`. This also corrects existing metadata-search behavior — **intentional; call it out in the commit message**. Escaping does not cost the trigram index. OCR is unaffected (both paths use the `%>>` operator, not ILIKE).
- [ ] **Step 3:** commit.

---

### Task 8 — over-the-wire pins + the inert e2e half

- [ ] **Step 1 — the e2e that proves nothing.** `e2e/src/specs/server/api/gallery-map.e2e-spec.ts:363-399` toggles `showInTimeline=false` and asserts the pins survive — but `needsTimelineSpaceIds` requires `withSharedSpaces === true`, and the request is a bare `?albumId=…`, so `timelineSpaceIds` is `undefined` **regardless of the toggle**. The PATCH block is inert; the scenario its 8-line comment claims to pin is never exercised. **Fix:** append `&withSharedSpaces=true` to the two album requests inside that test, and confirm it still passes.
- [ ] **Step 2 — wire pins for the new dimensions.** The only map-side tests for `lensModel`/`state`/`ownerId` cast `{ lensModel: … } as FilteredMapMarkerDto`, **bypassing the zod query schema entirely**, and the web builders return `Record<string, unknown>` so param names aren't typechecked client-side. That is exactly the bug class that let the map silently drop `description`/`ocr`. Add e2e "narrows over the wire" cases for `?lensModel=` and `?state=` (two distinct geotagged fixtures: `toContain` + `not.toContain`).
- [ ] **Step 3:** commit.

---

### Task 9 — URL hygiene + the vacuous tests

- [ ] **Step 1 — clamp `filename`/`ocr` (RED first).** `filter-url.ts:81-83` / `:137-139`: `description` is clamped to 200 chars on **both** sides; `originalFileName` and `ocr` are **unbounded**, encode and decode, and `text-filter.svelte` has no `maxlength`. A pasted 10KB value goes straight into the URL (reverse proxies commonly cap headers at ~8KB — the `description` clamp exists precisely to prevent this). Apply the same bound symmetrically.
- [ ] **Step 2 — surrogate-safe clamp.** `.slice(0, 200)` cuts UTF-16 code units, so an emoji straddling the boundary becomes a lone surrogate and serializes as U+FFFD — silent, irreversible corruption of one character. Clamp on code points.
- [ ] **Step 3 — fix the CONFIRMED vacuous test.** `filter-search-terms.spec.ts:108-116` asserts `expect(terms.takenAfter).toBeTruthy()`; mutation-checked — **swapping `takenAfter`/`takenBefore` (an inverted date range, a real bug) leaves it GREEN**. Assert the exact ISO values, as the album/map page tests already do.
- [ ] **Step 4 — delete the inert line.** `web/src/lib/components/album-page/__tests__/AlbumMap.spec.ts:175`: `await vi.waitFor(() => expect(handleErrorMock).not.toHaveBeenCalled())` — the stale response in that test _resolves_ (never throws), so the mock can never be called whether or not the ordering guard exists. Delete the line (the test's real assertion on the next line does the work). Also strengthen `shared-space.service.spec.ts:9658` from `expect(args.userIds).not.toContain(ownerId)` to `toEqual([auth.user.id])`.
- [ ] **Step 5 — pin the new `buildContextualFilterUrl` behavior (I3).** It merges `decodeFilterParams(url)` under the patch (`filter-target.ts:70-76`), so once `year` is in the codec a contextual-filter click on `/photos?year=2023` will **preserve** the year, where it previously dropped it. That is correct under D2 — but it is a behavior change with no test. Add one.
- [ ] **Step 6:** commit.

---

### Task 10 — the map's cluster panel, and the spec drift

- [ ] **Step 1 — the cluster panel can never widen.** `selectedClusterIds` is captured **once** from the already-filtered markers (`map/…/+page.svelte:338-344`) and fed to `assetFilter`, a **client-side** exclusion. No filter change recomputes it. So: click a 50-pin cluster → panel says "50 assets" → add a rating filter → the map drops to 5 pins but the panel still says **50**; and clearing a filter from _inside_ the panel can never surface the newly-matching assets. Recompute (or close) the cluster selection on any filter change, and drive the header count from the panel's own `timelineManager.assetCount` rather than `selectedClusterIds.size` (`+page.svelte:469`). Test both directions (narrow AND widen).
- [ ] **Step 2 — correct the spec.** It has drifted enough to mislead slice 6/7 planning. Fix at minimum: §4's table (album and map are **no longer** component-local/empty); §4.1 ("does not support lensModel/state/owner" — all three shipped); §8 E11 (`Route.map` **does** take a query now); §7(c) (the map already had a client-side `q` intersection loop from #412 — slice 5 shipped a server **feature-flag gate** on it, not the spec's "carry `q` + notice"); §9 Slice 4's file list (omits `shared-space.service.ts` and the e2e — the **#656** album-map RBAC fix; the spec says #655 throughout); §9 Slice 4's BDD ("the album **map link**" — `AlbumMap` is a **modal**, there is no album-map URL); §9 Slice 5's file list (omits `server.dto.ts` / `server.service.ts` / the SDK regen); and §5.4 (`applyContextualFilter` **does not exist** — Slice 7 must budget for writing it; the spec also never mentions the `buildFilterStateUrl` / `isFilterStateUrlUnchanged` / `withoutAtParam` write-half that slices 3/4 added).
- [ ] **Step 3:** run prettier over the docs (CI Docs Build is strict). Commit.

---

### Task 11 — two more honesty violations on the map (promoted from the audit)

Both are the **same failure class as D4/Task 6** (the map disagreeing with the surface it claims to mirror), and both live in the file Task 6 already opens.

- [ ] **Step 1 — the silent-empty map.** `?withSharedSpaces=true&isFavorite=true&personIds=space-person:<id>` returns an **empty map** for a legitimate member: `needsTimelineSpaceIds` (`shared-space.service.ts:756`) excludes `isFavorite === true`, so `timelineSpaceIds` is `undefined`; `spaceMatchesScope` (`face-identity.repository.ts:341-352`) then requires `timelineSpaceIds.size > 0`, so the token reads as inaccessible → `forceEmptyResult`. This is the **same bug** as the one fixed in `00a7fd6bac`, on the other arm of the condition — and slice 7 makes the person chip and the favourite chip one-click co-reachable. Fix: compute `timelineSpaceIds` whenever scoped person tokens are present (or 400, as the timeline does — `timeline.service.ts:158-168`). Add the regression test the earlier fix's comment asks for.
- [ ] **Step 2 — map markers exclude partner assets; the cluster panel includes them.** Markers force `userIds: [auth.user.id]` (`shared-space.service.ts:783`, no partner ids) while `buildMapTimelineOptions` passes `withPartners` (`map-filter-options.ts:182-183`). Masked today only by the client-side `assetFilter`, so it surfaces the moment Task 10 Step 1 un-constrains the panel. Make the two agree.
- [ ] **Step 3:** commit.

---

## Deferred / accepted (found by the audit; deliberately NOT in this slice)

Recorded so the next audit does not re-find them as new:

| Finding                                                                                                                                                                               | Why deferred                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rating: 0` does not round-trip (`encodeFilterParams` emits it; `parseRating` rejects `< 1`)                                                                                          | **Unreachable** — no 0-star affordance exists in `rating-filter.svelte`, and the map DTO is `min(1)`. Latent only.                                                                                                                              |
| Duplicate query params are first-wins (`?make=A&make=B` → `A`; `?people=p1&people=p2` → only `p1`)                                                                                    | Native `URLSearchParams.get` semantics; not reachable from the app's own encoder, which emits one instance per key. Cosmetic.                                                                                                                   |
| Filter **suggestions/facets** are computed over a wider set than the visible results, so a suggested value can yield zero hits                                                        | **No disclosure** — `applySuggestionScope` still gates by `userIds` / space membership / album participation. A UX wart; belongs with slice 6's picker work.                                                                                    |
| `withTimeBucketAssetFilters` has no per-owner visibility constraint under a space scope (other members' Archived assets are visible where `searchAssetBuilder` pins them to Timeline) | **Pre-existing and unchanged by this branch** (verified byte-identical at the merge base). The new `ownerId` filter makes it _targetable_, but it is a separate fork-wide RBAC question, not this feature's. Worth its own medium test + issue. |

---

### Task 12 — fold the audit's chip findings into the Slice 6 plan

Do **not** implement chips here — just correct the slice-6 plan (`docs/superpowers/plans/2026-07-13-…-slice-6.md`) so it covers what the audit found:

- [ ] `isFavorite === false` is **also** counted-but-not-chipped (`filter-panel.ts:109`), so `/photos?favorite=false` renders "N results" with **zero chips and no Clear-all** (that button is gated on `chips.length > 0`). It additionally flips `photos-filter-options.ts:18`, silently dropping `withPartners` + `withSharedSpaces`. Slice 6 must chip it.
- [ ] The chip ✕ handlers leave siblings set: `'location'` clears city+country but **not `state`**; `'camera'` clears make+model but **not `lensModel`**; `'albums'` clears the flags but **not `albumId`**. Removing a chip therefore drops the count while the result set is unchanged, and the orphan field is re-encoded into the URL on the next sync. (Slice 6's handler unification already plans the new cases — this makes the _sibling-clearing_ explicit.)
- [ ] `model` without `make` is a filter with **no UI at all**: all 8 builders forward it, `getActiveFilterCount` counts only `make`, and no chip renders.

---

## Done When

- [ ] Deleting the `ownerId` clause from `searchAssetBuilder` makes tests **FAIL** (it currently doesn't — that is the headline defect).
- [ ] Merging `ownerId` into `userIds` at the repository level makes tests **FAIL**.
- [ ] The album grid applies every filter it chips; the album grid and the album map agree.
- [ ] A shared link carries the temporal filter; `pendingFilterUrlSync` no longer exists.
- [ ] The map ANDs people/tags; the cluster panel's count matches what it shows.
- [ ] `?ownerId=<stranger>` returns `[]` on the map and on every search endpoint — pinned by a test.
- [ ] Full local gate: server unit + **medium** + **e2e** + web unit + typecheck + lint (Docker is up — run them all).
