# Upstream Sync Report — 2026-08-19 (batch 124)

## Summary

- **Upstream commits pulled**: 6 (`7918ad9f792..7cd0a7d30c1`)
- **Fork commits synced**: 0 (`integratedForkHead` already equalled `origin/main` at `690fd44e12c`)
- **Conflicts resolved**: 8 across 6 steps
- **Zero-conflict semantic breaks found**: 4
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED (stay off `main` — newest upstream tag is still `v3.1.0`)

The cycle's substance was a **product-direction decision**, not a merge: upstream #30279 rebuilt the
search UI that Gallery had deleted outright. Maintainer decision was to **carry upstream's search UI
dormant** rather than keep deleting it. See "Product-direction gate" below.

## Incoming Upstream Changes

Per-file fork divergence measured against the branch's **own** base (`7918ad9f792..HEAD`), not
`upstream/main..HEAD`: **24 of 56 touched files (43%)** carry fork divergence — high, and concentrated
almost entirely in the search surface.

| SHA           | Summary                                     | Area       | Risk to Fork     | Notes                                                   |
| ------------- | ------------------------------------------- | ---------- | ---------------- | ------------------------------------------------------- |
| `394996eb59e` | feat(web): new search ui (#30279)           | web        | **PRODUCT GATE** | Rebuilds the search-bar surface the fork deleted        |
| `2018e4f8c43` | chore(server): migrate library e2e (#27277) | server/e2e | **HIGH**         | Shape G — fork repository absent from medium DI         |
| `db3b31709de` | refactor: library controller tests (#30863) | server/e2e | LOW              | mechanical                                              |
| `d2759ec41e6` | refactor: library e2e (#30865)              | server/e2e | MEDIUM           | extends the same medium spec                            |
| `c63824bcea7` | refactor: library e2e (#30867)              | server/e2e | MEDIUM           | extends the same medium spec                            |
| `7cd0a7d30c1` | refactor: e2e tests (#30870)                | server/e2e | **HIGH**         | New reflective route spec with upstream-only allowlists |

No migrations, no mobile, no ML, no controllers/DTOs/repositories (non-spec) were touched — see
"Justified skips".

## Product-direction gate — FIRED on #30279, and resolved as coexistence

### What upstream did

#30279 rewrote `web/src/lib/components/shared-components/search-bar/`: it reshaped 10 components,
deleted `SearchHistoryBox.svelte` and `web/src/lib/modals/SearchFilterModal.svelte`, and **added five
new files** — `SearchButton.svelte`, `SearchFilters.svelte`, `SearchHistorySection.svelte`,
`search-bar-utils.ts`, and `web/src/lib/managers/search-manager.svelte.ts`.

### Why the gate fired

Of the 21 files it touches, **16 did not exist on the rolling branch**. Gallery had not patched
upstream's search bar — it deleted the whole surface and shipped two replacements:

- `web/src/lib/components/global-search/` (51 files) + `global-search-manager.svelte.ts` (2989 LOC) —
  the cmdk command palette
- `web/src/lib/components/filter-panel/` (46 files) — the filter panel, dynamic filter suggestions,
  contextual filters (#767/#778)

A blind rebase would have produced 10 loud delete/modify conflicts **and** silently applied the five
added files — dead code implementing a UI the fork does not render, plus a second search manager
sitting beside the fork's. Nothing would have failed: no test, no type check, no audit references them.

### Is this Search V3? No — verified, not assumed

The standing V3 coexistence decision (2026-07-23) names three triggers for revisiting: upstream
finishes V3, wires V3 to an endpoint, or deletes `searchAssetBuilderLegacy`. **None fired.**

1. `searchAssetBuilderLegacy` still exists on `upstream/main` (`search.repository.ts`,
   `utils/database.ts`).
2. `searchMetadataV3` / `searchStatisticsV3` return **zero** hits across `server/src/services` and
   `server/src/controllers` — still wired to nothing.
3. #30279 touches **no** `server/`, `open-api/`, or `mobile/` file. It is web + i18n only.
4. Upstream's new `search-manager.svelte.ts` imports the **legacy** `MetadataSearchDto` /
   `SmartSearchDto` and its only action is `goto(Route.search(...))`.

#30279 is a front-end reskin of legacy search.

### Decision — carry it dormant

Maintainer decision: keep pulling upstream's search work, do **not** switch onto it, and hold it
separate until upstream's search is ready. Implemented by keeping upstream's search-bar surface
**byte-identical to `upstream/main` and never mounted**, mirroring the server-side
`UPSTREAM SEARCH V3 — DORMANT` policy one layer up.

Rationale over the alternative (keep deleting it): deletion turns every future upstream search commit
into a batch of delete/modify conflicts _and_ silently admits each newly added file. Dormancy makes
them auto-merge. Verified viable before committing to it — every symbol the dormant UI needs
(`MediaType`, `QueryType`, `validQueryTypes`, `SearchFilter`, `Route.search`) exists on the branch, and
the fork's divergence in those files is purely additive (`constants.ts +41/-1`, `route.ts +61/-5`,
`types.ts` untouched). `svelte-check` covers all 622 files including the dormant ones: 0 errors.

Policy is documented at
`web/src/lib/components/shared-components/search-bar/DORMANT.md`, with a pointer from
`global-search-manager.svelte.ts`. Two invariants, both verified this cycle:

```bash
# 1. verbatim vs upstream (only the fork-authored DORMANT.md may differ)
git diff --stat upstream/main HEAD -- \
  web/src/lib/components/shared-components/search-bar/ \
  web/src/lib/managers/search-manager.svelte.ts

# 2. no live importer
git grep -n "search-bar/\|managers/search-manager" -- web/src e2e/src \
  | grep -v '^web/src/lib/components/shared-components/search-bar/'
```

## Zero-conflict semantic breaks (4)

None of these produced a merge conflict. Three were invisible to every gate but one.

| #   | Upstream change                                                        | What broke, elsewhere                                                      | Caught by                |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------ |
| 1   | #27277/#30863/#30865/#30867 e2e→medium library conversion              | fork's `SharedSpaceRepository` absent from the new spec's explicit DI list | **predicted pre-rebase** |
| 2   | #30870 reflective route spec with hardcoded allowlists                 | 6 fork-only routes read as "unexpected"                                    | server unit suite        |
| 3   | #30279 `hideLabel` → omit `<Label>` instead of `sr-only`               | hidden-label combobox loses its only accessible name                       | web unit suite           |
| 4   | #30279 added `searchManager.setQuery()` to the fork's live search page | live surface would depend on the dormant manager                           | reading the auto-merge   |

### 1 — Shape G, second occurrence, predicted before rebasing

The fork adds 15 lines to `library.service.ts` inside `handleSyncFiles`, calling
`this.sharedSpaceRepository.getSpacesLinkedToLibrary()` to queue `SharedSpaceFaceMatch` for linked
Spaces. An e2e spec boots the real DI container, so the repository was always present; a medium spec
declares dependencies **explicitly**, and upstream's lists name only upstream's repositories. Both
`describe('handleSyncFiles')` and the full-scan helper reach that handler, so it would have thrown in
every sync-files scenario.

Registered as `real`, not mocked: an unlinked library is a genuine empty round trip against the test
DB, and a stub would drift.

**This was caught at Checkpoint 1 by grepping the new spec's `real`/`mock` lists against the fork
repositories the code path reaches** — the procedure the previous Shape G occurrence produced. It
worked; keep doing it.

### 2 — New shape: an upstream reflective spec with a hardcoded allowlist of upstream's own surface

#30870 replaced per-route e2e auth assertions with `server/src/controllers/index.spec.ts`, which
enumerates every registered route by reflection and compares against `ADMIN_ROUTES` /
`SHARED_LINK_ROUTES` sets containing **only upstream's routes**. Every fork route with a matching
decorator is therefore automatically "unexpected".

Six fork routes surfaced. Each was verified deliberate before being added, rather than editing the sets
until green:

- `GET timeline/bucket-covers` — carries `@Authenticated({ permission: Permission.AssetRead, sharedLink: true })`,
  identical to its upstream siblings `timeline/bucket` and `timeline/buckets`.
- `GET storage-migration/estimate`, `GET storage-migration/status`,
  `POST storage-migration/start`, `POST storage-migration/rollback/:batchId` — all `admin: true`.
- `POST classification/scan` — `admin: true`.

**Generalise (this is the transferable part):** Shape G said an e2e→medium conversion drops a fork
_repository_ from a DI list. This is the same root cause with a different object — an e2e→reflective
conversion drops fork _routes_ from an allowlist. After any batch converting upstream e2e assertions
into an in-process spec, ask what that spec **enumerates**, and whether the fork adds members to that
set. `tsc` is blind to both.

### 3 — An upstream a11y regression that only the fork has a test for

#30279 changed `Combobox.svelte` from
`class="… {hideLabel ? 'sr-only' : ''}"` to `{#if !hideLabel}<Label …>{/if}`. That `<Label for={inputId}>`
is the combobox input's **only** accessible-name source (there is no `aria-label` / `aria-labelledby`
on it), so a `hideLabel` combobox now has no accessible name at all — `sr-only` exists precisely to
keep the name in the accessibility tree.

Checked upstream before scoping this as a fork bug: **upstream's own** `SettingsLanguageSelector.svelte`
and `SettingCombobox.svelte` pass `hideLabel`, so this regresses upstream too. Only the fork has a test
(`sidebar-settings.spec.ts`) that queries by accessible name, which is why only the fork sees it.

Fixed additively — `aria-label` on the input when the label is hidden — keeping upstream's `{#if}`
markup so the file does not re-conflict. Worth reporting upstream.

### 4 — The dormant surface's live tendril

#30279 also added `searchManager.setQuery(terms)` at two sites in
`web/src/routes/(user)/search/…/+page.svelte`, plus its import and an `onMount`. Those **auto-merged
into a live fork page** (the fork's pre-rebase copy contained neither `onMount` nor `searchManager`).

`setQuery` was read before deciding: it is a pure state setter (`this.#filter = this.#fromQuery(query)`)
with no navigation or URL side effect — only `submit()` navigates. On the fork's page it would write to
a store nothing reads, while making a live surface depend on the dormant manager. Removed, so the
dormant boundary stays clean and greppable. `onMount` was dropped from the `svelte` import with `tick`
and `untrack` confirmed still used.

## Conflict Resolutions

8 conflicts across 6 replay steps.

### `i18n/en.json` (×3, steps 1, 5, 6)

- **Fork side / upstream side**: both add top-level keys at the same alphabetical position.
- **Resolution**: union of both sides, then validated as JSON and asserted alphabetically sorted.
- **Risk**: LOW.
- **Verification**: the first union silently produced one out-of-order pair (`filter_by` before
  `filter_button_active`) against a pre-rebase file that was **fully sorted** — caught by the sort
  assertion, not by eye, and fixed. The resolver was then taught to sort merged blocks when every
  merged line is a simple single-line entry. Final: 2455 keys, sorted, `prettier` clean (the root
  config runs `prettier-plugin-sort-json` with lexical order, which is what enforces this).

### `web/src/lib/components/shared-components/search-bar/*.svelte` (×2, steps 1–2, plus 10 at step 3)

- **Fork side**: fork commits #349/#416 modified then deleted the surface.
- **Upstream side**: #30279 rewrote it.
- **Resolution**: upstream verbatim (`--ours` in rebase terms), per the dormancy decision.
- **Risk**: LOW — verified byte-identical to `upstream/main` and unreferenced afterwards.

### `web/src/routes/(user)/search/…/+page.svelte` (×2, steps 3 and 4)

- **Fork side**: #416 replaced the legacy `<SearchBar>` with a notice + "open palette" button; a later
  fork commit fixed its indentation and dropped a redundant `focus-visible:outline` class.
- **Upstream side**: #30279 changed the same region and the import block.
- **Resolution**: kept the fork's live palette notice; kept only the fork's `globalSearchManager`
  import; dropped upstream's `searchManager` usage (see break #4).
- **Risk**: MEDIUM — this is a live user-facing surface. Verified by `check:svelte` (0 errors) and the
  full web suite.

### `server/test/medium.factory.ts` (×2, steps 5 and 7)

- **Fork side**: adds `case FaceIdentityRepository:`.
- **Upstream side**: #27277 adds `case LibraryRepository:`.
- **Resolution**: union — both are additive labels in the same fallthrough switch.
- **Risk**: LOW; `pnpm check` and `pnpm build` verify it.

### `web/src/lib/components/shared-components/Combobox.svelte` (step 6)

- **Fork side**: #963 added `onscroll={onPositionChange}` + comment (iPad keyboard fix, #959).
- **Upstream side**: #30279 replaced the `sr-only` ternary with `{#if !hideLabel}`.
- **Resolution**: both — the changes are orthogonal. Then `aria-label` added for break #3.
- **Risk**: MEDIUM (live shared component, used by the filter panel). Covered by the web suite.

## Fork Feature Verification

| Feature               | Status | Notes                                                                    |
| --------------------- | ------ | ------------------------------------------------------------------------ |
| Shared Spaces         | OK     | `SharedSpaceRepository` restored to library medium DI; audits green      |
| Global Search Palette | OK     | untouched; now explicitly demarcated from upstream's dormant UI          |
| Filter Panel          | OK     | `Combobox` merge preserves the iPad fix and restores the accessible name |
| Storage Migration     | OK     | 4 admin routes re-declared in the new reflective spec                    |
| Auto-Classification   | OK     | `POST classification/scan` re-declared                                   |
| Face Identity         | OK     | `medium.factory.ts` case preserved through both conflicts                |
| Pet Detection         | OK     | untouched                                                                |
| Image Editing         | OK     | untouched                                                                |
| Branding              | OK     | URL-literal silent-noop detector clean                                   |

## Detector Results

| Detector                                    | Result                                       |
| ------------------------------------------- | -------------------------------------------- |
| Shape I (upstream adds a fork-deleted path) | clean — scoped to `origin/main`, not `--all` |
| URL-literal silent no-op (branding)         | clean                                        |
| Deleted-export symbols                      | 2 flagged, **both cleared** (see below)      |
| `revert-to-immich.sql` coverage             | complete — no new migrations this batch      |

Both deleted-export hits were false positives, and checking _what kind of thing the name refers to_
is what separated them:

- `clearSelection` — deleted from upstream's `SearchBar.svelte`, but `upstream/main` retains **3
  survivors**, so the fork's many hits are a different symbol (the selection-command handler).
- `deviceDto` — 0 upstream survivors, but #30870 removes its only usage in the same commit, and
  neither `e2e/src/responses.ts` nor `session.e2e-spec.ts` is fork-diverged.

## Justified Skips

Proven empty rather than assumed:

- **Mobile / Drift**: `git diff --name-only 7918ad9f792 upstream/main` lists no `mobile/` path.
  `make mobile-drift-rebase-check BATCH=124` OK regardless.
- **Machine learning**: no `machine-learning/` path in the batch.
- **Migrations**: no `server/src/schema/migrations/` path; audit reports 58/58 Gallery migrations and
  no timestamp collision.
- **OpenAPI / `make sql`**: no controller, DTO, or non-spec repository changed; the audit's Generated
  Artifact Review reports no artifact needing review. `make sql` additionally requires a running DB and
  **deletes every file under `server/src/queries/` without one**.

## Local CI Verification

| Check                                          | Status | Notes                                                         |
| ---------------------------------------------- | ------ | ------------------------------------------------------------- |
| `server pnpm build` (+ migration sync)         | PASS   | 58 Gallery migrations, 1 compatibility alias                  |
| `server pnpm check` (tsc)                      | PASS   |                                                               |
| `web check:typescript`                         | PASS   |                                                               |
| `web check:svelte`                             | PASS   | **622 files**, 0 errors, 0 warnings — includes the dormant UI |
| `server pnpm lint`                             | PASS   |                                                               |
| `server prettier --check`                      | PASS   |                                                               |
| web eslint (`tscompat` off, changed + dormant) | PASS   | caught `unicorn/no-negated-array-predicate` before CI         |
| Server unit tests                              | PASS   | 5722 passed; see contention note                              |
| Web unit tests                                 | PASS   | 363 files, 5694 passed                                        |
| `upstream-postrebase-audit BATCH=124`          | PASS   | 7/7 OK                                                        |
| `fork-patches-check`                           | PASS   |                                                               |
| `ci-invariants-check`                          | PASS   | 3/3 OK                                                        |
| `mobile-drift-rebase-check BATCH=124`          | PASS   |                                                               |
| `fork-ownership-coverage-check`                | PASS   | 3670 fork files covered                                       |

**Server-unit contention, not regressions.** A first full run reported 2 failures while the web suite
ran concurrently; a second identical run was fully green, and `--no-file-parallelism` was 5722/5722.
Shifting failure sets across identical runs is the documented local-contention signature.

**The web lint crash is back.** `pnpm lint` in `web/` aborts with the
`@koddsson/eslint-plugin-tscompat` `TypeError` (exit 2). The previous cycle recorded that it did _not_
crash and advised re-testing rather than assuming — re-tested, and it crashes again. The
`--rule '{"tscompat/tscompat":"off"}'` override works; a full-tree run takes >9 minutes, so the changed
and dormant files were linted directly. CI's Lint Web remains the authority.

**`mise.lock` guard.** `mise run //:sdk:build` rewrote `mise.lock` (+12/−12, macOS-only
`jellyfin-ffmpeg` platform block). Restored with `git checkout HEAD -- mise.lock`; both lockfiles are
clean in the final tree.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-124`
- **Commit validated**: `a4ca7f94882`

| Workflow                                  | Status  | Notes |
| ----------------------------------------- | ------- | ----- |
| `test.yml`                                | PENDING |       |
| `docker.yml`                              | PENDING |       |
| `static_analysis.yml`                     | PENDING |       |
| `gallery-build-mobile.yml`                | PENDING |       |
| `gallery-rebase-smoke.yml`                | PENDING |       |
| `storage-migration-tests.yml`             | PENDING |       |
| `storage-migration-e2e.yml`               | PENDING |       |
| `gallery-revert-to-immich-validation.yml` | PENDING |       |
| `gallery-ml-smoke.yml`                    | PENDING |       |
| `gallery-mobile-smoke.yml`                | PENDING |       |

## Post-Rebase Verification

- Fork commits ahead of `upstream/main`: **1199** (unchanged; commit-subject diff vs the pre-rebase tip
  is empty, so nothing was dropped or emptied)
- Commits behind `upstream/main`: **0**
- Pre-rebase backup ref: `rolling-backup-2026-08-19-pre-b124` (`d6d663c3798`)
- Fork diff looks clean: YES

## Landing

**Not landing.** Newest upstream tag is still `v3.1.0`, which `branding/config.json` already declares.
The branch stays off `main`, which is the expected steady state of this workflow.

## Follow-up work

1. **Report the `Combobox` `hideLabel` a11y regression upstream** — it affects upstream's own
   `SettingsLanguageSelector` and `SettingCombobox`.
2. **Revisit the dormancy decision when upstream finishes V3** — the trigger is upstream wiring V3 to
   an endpoint or deleting `searchAssetBuilderLegacy`. That is a product decision, not a rebase one.
