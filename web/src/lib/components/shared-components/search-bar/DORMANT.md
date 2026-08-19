# UPSTREAM SEARCH UI — DORMANT

Everything in this directory, plus `web/src/lib/managers/search-manager.svelte.ts`, is **upstream
Immich's search UI, carried verbatim and deliberately not rendered**. Nothing in the fork imports it.

## Why it is here

Gallery replaced upstream's search bar with two fork-owned surfaces:

- `web/src/lib/components/global-search/` + `web/src/lib/managers/global-search-manager.svelte.ts` —
  the cmdk command palette
- `web/src/lib/components/filter-panel/` — the filter panel

Upstream is still iterating on its own search (`#30279 feat(web): new search ui` rebuilt this
directory). Rather than delete their files every rebase — which turns each upstream search commit into
a batch of delete/modify conflicts, and silently admits any *newly added* file — we keep this surface
byte-identical to `upstream/main` so it auto-merges, and simply never mount it.

This mirrors the server-side policy: grep `UPSTREAM SEARCH V3 — DORMANT` in `server/src`, where
upstream's unfinished V3 query builder likewise sits present-but-unwired while the fork's live search
runs on `searchAssetBuilderLegacy`.

## The invariants

1. **Keep these files byte-identical to `upstream/main`.** That is the whole point; it is what makes
   future upstream search work merge without conflicts. Verify with:
   ```bash
   git diff --stat upstream/main HEAD -- \
     web/src/lib/components/shared-components/search-bar/ \
     web/src/lib/managers/search-manager.svelte.ts   # expect empty
   ```
2. **Nothing outside this directory may import it.** Verify with:
   ```bash
   git grep -n "search-bar/\|managers/search-manager" -- web/src e2e/src \
     | grep -v '^web/src/lib/components/shared-components/search-bar/'   # expect no hits
   ```
   In particular, upstream's `#30279` added `searchManager.setQuery(terms)` calls to
   `web/src/routes/(user)/search/…/+page.svelte`. Those were removed during the batch-124 rebase: that
   page is a **live fork surface** and must not depend on the dormant manager.
3. **`i18n/en.json` keys for this UI are also dormant.** They are upstream's; they do not need the
   nine-locale fork translation pass, because no fork surface renders them.

## When this ends

Upstream search V3 is still unfinished — as of this writing `searchAssetBuilderLegacy` still exists and
`searchMetadataV3` / `searchStatisticsV3` are wired to no controller or service. When upstream finishes
V3 and switches its own UI onto it, revisit whether Gallery converges on upstream's search or keeps the
palette + filter panel. That is a product decision, not a rebase decision — see the per-batch
product-direction gate in the `rebase-upstream-report` skill.
