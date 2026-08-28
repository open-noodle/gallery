# Upstream Sync Report — 2026-08-28 (batches 186–187, new-search-API quarantine)

## Summary

- **Upstream commits pulled**: 8 (`8178a01522f` → `25c60ef99e2`)
- **Upstream commits quarantined**: 12 (`25c60ef99e2` → `1a8fcf1b9f9`), held at `8b3d6b320bf`
- **Fork commits synced from `origin/main`**: 1 (#1033)
- **Conflicts resolved**: 17 across 9 files
- **Risk level**: MEDIUM (the pulled set), **HIGH for the quarantined commit**
- **Recommendation**: PROCEED with the pulled set; **the quarantined commit needs a product decision before it is pulled**

Branch tip `1d3d92b8f85`, 12 behind `upstream/main` by design, 1380 ahead of the
boundary. Still **off `main`** — the latest upstream _stable_ tag is still `v3.1.0`,
which `branding/config.json` already carries. `v3.2.0-rc.0` / `v3.2.0-rc.1` exist but
are release candidates, not the tagged release the standing landing rule requires.

## The quarantine — immich-30179 "new search API"

**This is the Search V3 trigger the coexistence spec was written for, and it has now
fired.** `specs/2026-07-23-search-v3-coexistence-design.md` says to stop and surface a
product question when upstream _finishes_ V3 or _wires V3 to an endpoint_. immich-30179
wires it.

### What upstream did

V3 is no longer dormant. `SearchService.searchMetadata`, `searchStatistics`,
`searchRandom` and `searchSmart` now each begin with:

```ts
if (isNewShapeRequest(dto)) {
  return this.searchMetadataV3(auth, dto); // …StatisticsV3 / …RandomV3 / …SmartV3
}
```

`isNewShapeRequest` is true when the request body carries any of `filter`, `orderBy` or
`cursor`. So V3 is reachable **through the existing endpoints** — there is no new route
to leave unrouted, and no feature flag. `searchAssetBuilderLegacy` still exists and the
flat-field path still works; upstream marks the legacy methods `TODO(v4): remove`.

### Why it collides with the fork

The fork's shared-space RBAC gate lives in `searchAssetBuilderLegacy` — the extended
builder in `src/utils/database.ts` that adds the `timelineSpaceIds` arm and re-gates
album results on Archive+Timeline visibility (the `security-1` cases in
`search.repository.spec.ts`).

Upstream's V3 `searchAssetBuilder` has neither. Its whole scope model is:

```ts
const ownershipPredicate = (eb) => eb("asset.ownerId", "=", anyUuid(scope.userIds));
```

plus a locked-visibility check — own + partner assets only, **no shared-space arm**. And
on album-confined branches it drops the ownership predicate _entirely_, relying on the
service having access-checked the album ids:

```ts
.$if(scopeGlobally, (qb) => qb.where(ownershipPredicate))
```

That album arm is precisely the one the fork found it had to re-gate. Pulling immich-30179
in as-is would therefore put a **second, live, un-gated search path** next to the fork's
gated one, reachable by any API client that sends the new body shape — while the fork's
own web and mobile clients continue to send the old shape and see none of it.

### Decision needed

Not a merge question. The options are roughly: (a) extend the fork's space scoping and
album re-gate into V3's builder before pulling it, (b) keep V3 dormant by not dispatching
to it, or (c) stay on the boundary until upstream's V3 stabilises. Worth brainstorming
before advancing `upstreamTargetHead` past `8b3d6b320bf`.

The 11 commits after it (an iOS map settings fix, translations, CLIP UTF-8, a web face-editor
fix, and upstream's `v3.2.0-rc.0` release-branch plumbing) are individually harmless but sit
downstream of it in a linear history, so they are held too.

## Incoming Upstream Changes (pulled)

| SHA           | Summary                                                             | Area     | Risk to Fork | Notes                                                                                  |
| ------------- | ------------------------------------------------------------------- | -------- | ------------ | -------------------------------------------------------------------------------------- |
| `302270a3b36` | fix: draggable Immich logo (immich-31055)                           | web/deps | MEDIUM       | Bumps `@immich/ui` 0.85.0 → 0.86.0 — silently unpatched the fork (see Inconsistencies) |
| `dc3d6eeec4a` | fix(server): kill pg_dump when a backup fails (immich-30851)        | server   | LOW          | No fork overlap                                                                        |
| `84adce7d439` | fix(web): misleading toast notification (immich-30976)              | web      | LOW          | Superseded by fork #752 (see Conflicts)                                                |
| `b3eb0b59ee2` | fix(web): map (immich-31056)                                        | web      | MEDIUM       | Rewrote the map visibility expression the fork gates by `spaceId`                      |
| `48b5f9c6a60` | docs: remote-machine-learning.md (immich-28728)                     | docs     | LOW          | —                                                                                      |
| `91d362eb9f5` | fix: external library statistics for excluded assets (immich-28462) | server   | LOW          | No fork overlap                                                                        |
| `1db4677cf81` | feat: same-second photos sub-sort by filename (immich-29528)        | server   | MEDIUM       | Ordering change; the fork's own `getTimeBucket` variants needed a SQL regen            |
| `25c60ef99e2` | feat(web): view assets in map viewport (immich-27492)               | web      | MEDIUM       | New `Map` props; the fork had restructured the map page around them                    |

Per-batch product-direction gate: applied to all three batches. It fired only on batch 188
(`8b3d6b320bf`), which is quarantined. immich-27492 and immich-29528 were both considered
and cleared — the first is upstream's own map UX with no data-model change, the second is
an additive sort tiebreak.

## Conflict Resolutions

### Fork sync — #1033 (hand-applied)

`make upstream-sync-fork-main` threw on conflicts, so this was resolved by hand and
`integratedForkHead` advanced manually, per the skill's escape hatch.

**`mobile/lib/infrastructure/repositories/sync_stream.repository.dart`**

- Fork side: #1033 adds a `_deferredMemoryAssets` set, keeping the old
  `SyncStreamRepository(super.db) : _db = db;` constructor.
- Rolling side: the constructor had already moved to
  `SyncStreamRepository(super.attachedDatabase);` + `Drift get _db => attachedDatabase;`
  during the Drift relocation.
- Resolution: rolling's constructor form + #1033's new field.
- Risk: LOW. Verified all seven `_deferredMemoryAssets` call sites resolve.

**`server/src/services/sync.service.spec.ts`**

- Union of rolling's `send` / `serialize` imports with #1033's `SYNC_TYPES_ORDER`.
- Risk: LOW. All three symbols confirmed exported.

### `web/src/lib/services/album.service.ts` — immich-30976 vs fork #752

- Upstream side: replaces a misleading success toast with a `primary`-or-`danger` split.
- Fork side: #752 had already replaced the same function with a four-branch version whose
  severity follows the result counts (all-succeeded → primary, all-duplicate → info,
  partial → info, nothing-added → **warning**).
- Resolution: **fork side**. It fully covers upstream's intent with more granularity, and
  it is also the only side that compiles — the unconflicted middle of the function
  references `total` / `viewButton` / `options`, which only the fork side defines.
- Risk: LOW. Verified no `toastManager.danger` leftovers and the four branches intact.

### The map surface — immich-31056 + immich-27492 vs fork #189 / #781

Five conflicts across three files, all from the same root cause: upstream changed the map
timeline options and added viewport props, while the fork had restructured the whole map
page around a FilterPanel and a `buildMapTimelineOptions` helper.

- **`MapTimelinePanel.svelte`**: resolved to the fork side. The fork's final state routes
  entirely through `buildMapTimelineOptions` → `mapTimelineScope`, which deliberately
  pins `visibility: AssetVisibility.Timeline` + `withSharedSpaces` and carries an explicit
  comment (_"No $mapSettings here: the cluster panel is scoped by the active filters and
  nothing else"_). Upstream's `withPartners` / `includeArchived` expression has no place
  left in the fork's design. Recorded as a **deliberate divergence**, not a dropped fix.
- **`map/+page.svelte`**: this one needed care. immich-27492's three new `Map` props
  (`onViewportClose`, `viewportGridActive`, `autoOpenPanel`) landed on a `<Map>` render
  that fork #189 had replaced and fork #781 had then moved again (`{#await}` →
  `{#if LazyMap.current}`). Both times git put upstream's render _inside_ the conflict and
  the fork's render in the shared tail, so a plain "take theirs" would have dropped
  upstream's whole viewport feature with zero conflict noise. The props were carried
  forward onto the fork's surviving render each time, and verified end-to-end against
  `Map.svelte`'s prop declarations.
- **Branded-spinner trap avoided**: upstream's import block re-adds `LoadingSpinner` from
  `@immich/ui`; the fork swaps in its own branded
  `$lib/components/shared-components/LoadingSpinner.svelte`. Taking upstream's import
  would have both duplicated the identifier and reverted the branded swap. The file now
  has exactly one `LoadingSpinner` import — the fork's.
- Risk: MEDIUM, mitigated by a whole-file audit (below).

### `server/test/medium/specs/repositories/asset.repository.spec.ts`

Repeated import unions plus one both-sides-added block where immich-29528's two ordering
tests and the fork's bucket-filter tests were inserted at the same point. See
Inconsistencies — the first attempt at this one was wrong.

### `pnpm-lock.yaml`

Taken from upstream (0.86.0) and regenerated once at the end, per the deferred-regen rule.
Workspace linking verified: 11 `version: link:` entries, 0 `version: file:` — matching the
pre-rebase baseline.

## Fork Feature Verification

| Feature               | Status | Notes                                                                                                                                                                       |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Spaces         | OK     | `Fork-Owned File Survival` + `Fork Extension Symbol Survival` green; space map scoping (`getSpaceMapMarkers`, `withSharedSpaces: true`) intact                              |
| Search V3 coexistence | OK     | 6 live `searchAssetBuilderLegacy` call sites; the only bare `searchAssetBuilder` uses are inside the dormant V3 block; all 3 `UPSTREAM SEARCH V3 — DORMANT` banners present |
| Storage Migration     | OK     | No upstream overlap this batch                                                                                                                                              |
| Pet Detection         | OK     | No upstream overlap this batch                                                                                                                                              |
| Image Editing         | OK     | No upstream overlap this batch                                                                                                                                              |
| Branding              | OK     | i18n branding-override detector clean; branded `LoadingSpinner` swap preserved; `@immich/ui` patch restored (see below)                                                     |
| Google Photos Import  | OK     | No upstream overlap this batch                                                                                                                                              |

## Database Migration Analysis

- New upstream migrations in the pulled range: **none**
- Gallery migration count: **62** (expected 62); no filename or timestamp collisions
- `postbuild` sync intact — _"Synced 62 Gallery migrations … 1 compatibility aliases"_
- `revert-to-immich.sql` coverage detector: **no missing entries**

## Mobile Drift Migration Analysis

- `schemaVersion` **36**, unchanged; no upstream mobile migrations in the pulled range
- `make mobile-drift-rebase-check BATCH=187`: schemaVersion, snapshots and Gallery
  callbacks consistent
- Shape L import-resolution detector: clean (0 unresolvable `package:immich_mobile/` imports)

## Inconsistencies Found

**1. `@immich/ui` 0.86.0 bump silently unpatched the fork — and `fork-patches-check` said OK.**

`patchedDependencies` pins the patch by exact version, so immich-31055's bump left the
`@immich/ui@0.85.0` key matching nothing. pnpm installed the package unpatched without
failing, and `make fork-patches-check` reported _"patch metadata is consistent"_ — it only
verifies the declared patch file exists and is referenced, never that the pinned version
resolves. Two fork behaviours were silently lost:

- the command-palette patch, which deliberately does **not** register upstream's
  Ctrl+K / Cmd+K / `/` handlers because Gallery owns those for its own cmdk palette,
  while still calling `enable()` so per-page `ActionItem` shortcuts keep dispatching;
- the carousel title wrap fix, whose anchor had also moved — 0.86.0 extracted the title
  out of `ImageCarousel.svelte` into a new `ImageCard.svelte` and renamed `start-4` to
  `inset-s-4`, so the old hunk had nothing to match.

Both re-derived against 0.86.0 and verified in the installed tree (`Gallery patch` present,
shortcut registration absent, wrap classes present, and `web` resolving to the patched copy).
**The gate gap is closed in this cycle** — `fork-patches-check` now also asserts against the
lockfile, so a bump that leaves a patch unapplied fails the check instead of passing it.

**2. A both-sides-added conflict produced an unparseable spec file.**

immich-29528's two ordering tests and the fork's bucket-filter tests were added at the same
point in the medium `asset.repository.spec.ts`. git aligned the region asymmetrically:
upstream's block sat inside the conflict, but the closing `});` that terminated it was in the
shared tail, where it ended up closing the fork's block instead. Keeping both sides therefore
left upstream's `createdAt` test unterminated. `tsc` reported a single `TS1005` at EOF — about
1000 lines from the cause. Fixed; both upstream tests and all fork tests retained.

**3. `server/src/queries/asset.repository.sql` drifted with no signature change.**

immich-29528 added `originalFileName` as a same-second tiebreak. Upstream regenerated its own
`.sql`, but the fork carries two extra shared-space-scoped `getTimeBucket` variants that emit
their own SQL, so their queries still lacked the ordering column. Nothing in `tsc`, lint or the
unit suite sees this — only `SQL Schema Checks`. Regenerated against the same postgres image
the CI job pins. This reconfirms that the skip condition is _"did anything touch
`server/src/repositories/`?"_, not _"did a method signature change?"_.

**4. `rolling-state.json` carried a non-existent `integratedForkHead`.**

The recorded value `4b484696575e4c2b2a5cb3b1dc17b9c1e0a37e33` does not resolve; the
abbreviation matches but the tail is wrong. The real commit is
`4b484696575e10f33179bd4a1db92cea8c2e8314` (#1032). `upstream-sync-fork-main` failed hard on
it (`fatal: Not a valid commit name`). Repaired, and the repair noted in `appendHistory`.

## Zero-Conflict Break Gate

| Detector                                                            | Result                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------- |
| Silent-noop (deleted URL literals vs fork literal-matching tooling) | clean                                                    |
| Shape I — upstream ADDs a file fork history touched                 | clean                                                    |
| Shape I — upstream RENAMEs onto a path fork history touched         | clean                                                    |
| Shape I corollary — zero-byte tracked files                         | clean (14 empty files, byte-identical set to pre-rebase) |
| Shape L — unresolvable mobile imports                               | clean                                                    |
| i18n branding-override gap                                          | clean                                                    |
| Shape K — whole-file fork-line audit on all 7 hand-resolved files   | clean, see below                                         |

The Shape K audit compared every hand-resolved file against its pre-rebase version and listed
fork lines now absent. Nine lines came back; all nine were verified as legitimate rewrites
(upstream widening two `Map.svelte` import lines and adding `|| undefined` to two date filters,
import unions, `<Map>` expanded to multi-line, and two lines #1033 itself rewrote). **No fork
content was lost.**

## Local CI Verification

| Check                                                         | Status | Notes                                                                                |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `server pnpm build` (+ postbuild migration sync)              | PASS   | 62 migrations, 1 compatibility alias                                                 |
| `server pnpm check` (tsc)                                     | PASS   | after fixing the unterminated test                                                   |
| `web check:typescript`                                        | PASS   |                                                                                      |
| `web check:svelte`                                            | PASS   | 627 files, 0 errors, 0 warnings                                                      |
| `server pnpm lint`                                            | PASS   |                                                                                      |
| web eslint (`tscompat` off)                                   | PASS   | 0 errors (13 warnings, all "unused eslint-disable" artifacts of the override itself) |
| prettier — server / web / e2e / docs / packages/cli / .github | PASS   | two files reformatted                                                                |
| Server unit tests                                             | PASS   | 196 files, 6093 tests                                                                |
| Web unit tests                                                | PASS   | 371 files, 5961 tests                                                                |
| `dart analyze --fatal-infos`                                  | PASS   | no issues                                                                            |
| `dart format`                                                 | PASS   | 870 files, 0 changed                                                                 |
| `flutter test` (mobile)                                       | PASS   | 3488 tests passed, 1 skipped                                                         |
| SQL regen (`mise //:sql`)                                     | PASS   | one drift found and committed                                                        |
| OpenAPI regen                                                 | N/A    | no controller/DTO/spec change in the pulled range                                    |
| `make commit-autolink-check`                                  | PASS   | 1378 messages scanned, fork PR ceiling 1033                                          |
| `make fork-patches-check`                                     | PASS   | after the 0.86.0 migration                                                           |
| `make ci-invariants-check`                                    | PASS   | 4/4                                                                                  |
| `make upstream-postrebase-audit BATCH=187`                    | PASS   | 7/7                                                                                  |
| `make mobile-drift-rebase-check BATCH=187`                    | PASS   |                                                                                      |

### Toolchain note — the mobile gate needs the pinned SDK

`mise //mobile:analyze` initially failed with five `uri_does_not_exist` errors for
`schema_v32.dart`…`schema_v36.dart`. Two causes, both previously recorded:
`test/drift/main/generated/` is gitignored and its mise task had a stale cache (generated only
through v31), and the build hook picked up the **Homebrew** Flutter rather than the pinned
3.47.1, producing `Can't load Kernel binary: Invalid kernel binary format version (expected 130,
found 138)`. Clearing `.dart_tool/hooks_runner` and invoking
`~/.local/share/mise/installs/aqua-flutter-flutter/3.47.1/flutter/bin/{flutter,dart}` directly
regenerated all 37 files and analyze went clean. `flutter pub get` rewrote `mobile/pubspec.lock`'s
dart constraint (`>=3.12.0` → `>=3.13.0`) as it always does — reverted. Both `mise.lock` files
verified byte-identical to their pre-run hashes.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-187`
- **Rebase content validated on**: `968a7250c81`
- **Final tip**: `0746a17a6c6` (adds only the preflight hardening + this report)

| Workflow                                  | Status | Run         | Notes                              |
| ----------------------------------------- | ------ | ----------- | ---------------------------------- |
| `test.yml`                                | GREEN  | 33166478219 | 21/21 non-skipped jobs             |
| `docker.yml`                              | GREEN  | 33166483536 |                                    |
| `static_analysis.yml`                     | GREEN  | 33166488985 |                                    |
| `gallery-build-mobile.yml`                | GREEN  | 33166514630 | iOS + Android compile              |
| `gallery-rebase-smoke.yml`                | GREEN  | 33166494128 |                                    |
| `storage-migration-tests.yml`             | GREEN  | 33166499320 |                                    |
| `storage-migration-e2e.yml`               | GREEN  | 33166509514 |                                    |
| `gallery-revert-to-immich-validation.yml` | GREEN  | 33166504296 | coverage grep + Docker boot        |
| `gallery-ml-smoke.yml`                    | GREEN  | 33166519234 |                                    |
| `gallery-mobile-smoke.yml`                | GREEN  | 33166523946 |                                    |
| `test.yml` (re-dispatch on final tip)     | GREEN  | 33168142048 | 21/21; covers the preflight change |

**10/10 green.** The nine workflows other than `test.yml` were validated on `968a7250c81`;
the only commits after it touch `tools/upstream-preflight/` and `specs/`, which none of those
nine build or test, so they were not re-dispatched. `test.yml` — the one workflow that does
exercise the preflight tooling — was re-dispatched and is green on the final tip.

- **Failures fixed**: none — every workflow was green first time.
- **Confirmed flakes**: none.

## Landing

**Not landing.** The standing rule requires an upstream **tag** plus a thoroughly tested
state. Upstream has cut `v3.2.0-rc.0` and `v3.2.0-rc.1`, but those are release candidates;
the latest stable tag remains `v3.1.0`, which `branding/config.json` already carries. Green
and level-to-the-boundary is the expected steady state for this branch.

## Follow-up work

- **immich-30179 product decision** — the quarantine above. Blocks advancing
  `upstreamTargetHead` past `8b3d6b320bf`.
- ~~**Harden `fork-patches-check`**~~ — **done this cycle.** The audit now reads
  `pnpm-lock.yaml` and asserts, for every importer depending on a patched package, that the
  resolved version matches the pinned one _and_ carries a `patch_hash`. Proved red against a
  faithful reconstruction of the pre-fix state and green against the current tree; the tool's
  suite is 253/253.
