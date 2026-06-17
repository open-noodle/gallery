# Upstream Sync Report — 2026-06-17 (batches 266–267)

Third sync of the day, on top of `2026-06-17-upstream-sync-batch-262-265.md` (batches 262–265).

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`)
- **Fork commits synced**: 1 — #709 `37224e0b` (`origin/main` `c1387721`→`37224e0b`)
- **Upstream commits pulled** (`3f2e51c5d4..cbe34d7931`): 8 (batches 266–267)
- **Conflicts resolved**: 2 files — `web/svelte.config.js` (C1), `web/src/lib/components/timeline/Timeline.svelte` (C2)
- **Post-rebase fixes**: 0
- **New migrations**: 0 — Gallery migration count steady at **33**, mobile Drift unchanged
- **Risk level**: LOW–MEDIUM
- **Recommendation**: PROCEED — local gate fully green (server 4653 + web 3166 unit tests, `tsc`/`svelte-check`, structural audits); remote CI pending dispatch on the batch branches.

> **Scope note:** held rolling branch — not pushed to `main`, no `branding.upstream.version` bump (stays `v2.7.5`).

## Fork sync (1)

| SHA        | PR   | Area                    | Outcome                                                                           |
| ---------- | ---- | ----------------------- | --------------------------------------------------------------------------------- |
| `37224e0b` | #709 | web (fork filter panel) | clean cherry-pick — sum day buckets per month in the filter-panel temporal picker |

## Upstream commits (8)

| SHA        | PR     | Area    | Risk    | Batch | Outcome                                                                                               |
| ---------- | ------ | ------- | ------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `f9db7643` | #29154 | CI/deps | LOW     | 266   | clean — `build-mobile.yml` github-actions → v1.313.0 (fork PUSH_O_MATIC edit on diff line)            |
| `a364b56b` | #28884 | server  | LOW-MED | 267   | clean — `album.service.ts` skip-existing-users on album share (1 line); fork doesn't extend this path |
| `3be803d0` | #29168 | docs    | LOW     | 267   | clean — Play App Signing certificate hash                                                             |
| `327521fa` | #29078 | docs    | LOW     | 267   | clean — point users to shared setup docs                                                              |
| `14f6f2c0` | #29102 | web     | LOW     | 267   | clean — `/places` controls use `@immich/ui` `Select` (upstream-owned route)                           |
| `ad9817c5` | #29175 | web     | LOW     | 267   | clean — i18n plumbing (`SettingsLanguageSelector`, `preferences.store`, `utils/i18n`)                 |
| `06c8d5a1` | #29172 | web     | MED     | 267   | **reconciled** `svelte.config.js` (C1) — both fix the `Date.now()` hash-mismatch bug                  |
| `cbe34d79` | #29022 | web     | MED     | 267   | **reconciled** `Timeline.svelte` (C2) — shift+click GPS asset extends range selection                 |

## Conflict resolutions

### C1 — `web/svelte.config.js` (at fork `eb5a69f691`)

#29172 changed the `version.name` fallback from `Date.now().toString()` to `process.env.npm_package_version || 'local'`. Fork commit `eb5a69f691` had already replaced the whole block with a conditional spread that **omits** `version.name` unless `IMMICH_BUILD` is set (→ SvelteKit's own stable default hash). Both fix the `__sveltekit_<hash>` mismatch bug (chunks vs. SPA-fallback HTML getting different hashes from a recomputed `Date.now()`).

**Resolution:** kept the fork's version (conditional spread) — the established, documented fork behavior. The fork now diverges from upstream's specific line; converging to `npm_package_version || 'local'` is a low-value optional follow-up (no functional need — both are deterministic).

### C2 — `web/src/lib/components/timeline/Timeline.svelte` (at fork `ce862ff9ee`, #625)

#29022 added an optional `event?: MouseEvent` to the thumbnail `onClick` (and to the `onThumbnailClick` prop type) so shift+click extends range selection in the geolocation utility. The **type-signature** change applied cleanly (line 79); only the onClick-handler hunk conflicted with fork #625's "timeline grouping display modes" restructure — `<Skeleton>` for not-loaded months + `{:else if isInOrNearViewport}` rendering `<Month customThumbnailLayout singleSelect onTimelineDaySelect>`.

**Resolution:** kept the fork's restructured `<Month>` block **and grafted upstream's `event` param** into its onClick:

```svelte
onClick={(asset, event) => {
  if (typeof onThumbnailClick === 'function') {
    onThumbnailClick(asset, timelineManager, timelineDay, _onClick, event);
  } else {
    _onClick(timelineManager, timelineDay.getAssets(), timelineDay.groupTitle, asset);
  }
}}
```

Preserves both the fork grouping feature and upstream's range-select fix; consistent with `Thumbnail.svelte` now calling `onClick($state.snapshot(asset), e)`. Verified by `check:svelte` (0 errors) + `tsc`.

## Audits & local verification

| Check                                   | Status | Notes                                                                                         |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| postrebase-audit (266 & 267)            | GREEN  | fork files/symbols, 33 migrations, no timestamp collisions, Generated-Artifact-Review no-diff |
| ci-invariants-check                     | GREEN  | no PUSH_O_MATIC reintroduced by #29154; gallery image names; upstream docs-deploy disabled    |
| fork-patches-check                      | GREEN  | `@immich/ui` patch metadata consistent                                                        |
| mobile-drift-rebase-check (267)         | GREEN  | schemaVersion / snapshots / Gallery callbacks consistent; no upstream mobile migration        |
| OpenAPI / SDK / SQL regen               | N/A    | no DTO/controller/`@GenerateSql` changes this batch (Generated-Artifact-Review green)         |
| Web `check:typescript` (`tsc --noEmit`) | PASS   | validates C1 + C2                                                                             |
| Web `check:svelte` (svelte-check)       | PASS   | 0 errors / 0 warnings                                                                         |
| Server `check` (`tsc --noEmit`)         | PASS   | —                                                                                             |
| Server unit tests                       | GREEN  | 4653 passed, 9 skipped, 0 failed (141 files)                                                  |
| Web unit tests                          | GREEN  | 3166 passed, 2 skipped, 8 todo, 0 failed (239 files)                                          |

## Remote CI verification

_Pending dispatch on `rebase/upstream-batch-266` / `rebase/upstream-batch-267`. To record after green._

| Workflow             | Result  | Validates                                               |
| -------------------- | ------- | ------------------------------------------------------- |
| Test                 | PENDING | web lint/tests (#29022, #29102, #29172, #29175) + suite |
| Docker               | PENDING | #29154 build-mobile action bump + Dockerfiles           |
| Static Code Analysis | PENDING | dart analyze + generated-file freshness                 |
| Gallery Build Mobile | PENDING | iOS + Android compile (#29154 / #29168 mobile docs)     |

## Post-rebase state

- Upstream base: `cbe34d7931` (`3f2e51c5d4..cbe34d7931`); fork commits ahead: **770**; behind: **0**.
- `integratedForkHead`: `37224e0b`; `upstreamTargetHead`: `cbe34d7931`.
- Canonical `rebase/upstream-rolling-20260509-active` updated to the rebased tip; not pushed to `main` (held for v3 cutover).
