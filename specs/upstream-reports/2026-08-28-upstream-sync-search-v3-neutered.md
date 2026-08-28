# Upstream Sync Report — 2026-08-28 (batches 188–197, quarantine released)

## Summary

- **Upstream commits pulled**: 12 (`25c60ef99e2` → `1a8fcf1b9f9`) — the set quarantined earlier today
- **Branch is now level with `upstream/main`**: 0 behind, 1386 ahead, tip `e6bb4bd59c6`
- **Risk level**: HIGH (the batch), MEDIUM (as landed)
- **Recommendation**: PROCEED

This releases the quarantine opened in
`2026-08-28-upstream-sync-search-api-quarantine.md`. Pierre's decision: **pull immich-30179 but do
not dispatch to V3** — Gallery stays on the legacy search path until upstream's V3 has proven itself,
then adopts it deliberately.

Still **off `main`**: latest upstream _stable_ tag is `v3.1.0`, which `branding/config.json` already
carries. `v3.2.0-rc.0` / `rc.1` are release candidates.

## The decision, and what was built

Full analysis and the switch-over plan: `specs/2026-07-23-search-v3-coexistence-design.md`
(2026-08-28 section).

immich-30179 made `searchMetadata` / `searchStatistics` / `searchRandom` / `searchSmart` dispatch to
V3 whenever the body carries `filter`, `orderBy` or `cursor` — through the **existing** endpoints,
with no new route and no feature flag. V3's builder scopes only by `asset.ownerId`, and on
album-confined branches drops the ownership predicate entirely; it has **no shared-space arm** and
none of the Archive+Timeline re-gating `searchAssetBuilderLegacy` applies.

The four dispatch points now **throw a 400** instead. Rejecting rather than falling through is the
load-bearing choice: the legacy path ignores `filter` completely, so a fallthrough would answer a
filtered request with a **wider** result set than the caller asked for.

Upstream's V3 service/repository methods, filter schemas and `searchAssetBuilder` stay present and
unreachable — the same dormancy policy already applied to the V3 builder (immich-28686) and the web
search UI (immich-30279).

### Scope check that made this decision cheap

**The FilterPanel does not use the search API at all.** `FilterState` →
`buildPhotosTimelineOptions` / `buildMapTimelineOptions` / the album and space variants →
`TimelineManager` → `getTimeBuckets`, which lives in `asset.repository.ts`. The search endpoints back
the cmdk palette, the preview components, the legacy search page and the map's smart search. So the
fork's main filtered-browsing surface was never in the blast radius.

### Guards, both proved red before being trusted

| Guard                                                                                                                                                                | Proof                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `search-v3-not-dispatched` ci-invariant (`docs/fork/ownership.yml`) — forbids `return this.<x>V3(auth, dto);`                                                        | Re-adding one dispatch turns it red; restored → green |
| Reworked `new shape routing` tests — all four endpoints reject, every new-shape field rejected, no V3 repository method reached, flat requests still route to legacy | Re-adding one dispatch fails 3 of them                |

The invariant is the important one: a rebase resolving `search.service.ts` toward upstream would
re-enable V3 with **no conflict and no type error**.

### The trade-off, stated

The DTOs still carry `filter` / `orderBy` / `cursor`, so the OpenAPI spec advertises fields the server
rejects. Deliberate — removing them would widen the fork's already-large `search.dto.ts` divergence
and make every future upstream change to those schemas conflict. Carrying them dormant is what buys
the auto-merge; the 400 names the reason.

## Incoming Upstream Changes

| SHA                                                                                                           | Summary                                                                    | Risk       | Notes                                                                   |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `8b3d6b320bf`                                                                                                 | feat(server): new search API (immich-30179)                                | HIGH       | The quarantined commit — neutered, see above                            |
| `22a56a79f21`                                                                                                 | fix: ios map settings sheet (immich-31060)                                 | LOW        |                                                                         |
| `7078734df84`                                                                                                 | chore(web): update translations (immich-30296)                             | **MEDIUM** | Overwrote fork compliance disclosures — see Inconsistencies             |
| `b8400dfe30d` · `e61312084b0` · `5baf181409e` · `bbf201d16b1` · `b912dcfab8a` · `8a00ecda434` · `762f93798dd` | upstream release-line plumbing + `v3.2.0-rc.0` version bump                | LOW        | Fork keeps its own versions and drops the Immich-only release workflows |
| `c1a88dd9a33`                                                                                                 | fix(ml): read CLIP model configs as UTF-8 (immich-31075)                   | LOW        |                                                                         |
| `1a8fcf1b9f9`                                                                                                 | fix(web): face editor coordinates on a not-yet-loaded video (immich-31083) | LOW        |                                                                         |

## Conflict Resolutions

Resolved per commit. The mechanical shapes (import unions, both-sides-added blocks, generated
artifacts, fork-owned version lines, dropped upstream workflows) were driven by scripted resolvers;
everything below was decided by hand.

### `search.dto.ts` — upstream restructured, the fork's zod conversion replays on top

Upstream's V3 work relocated the search schemas and wrapped them in `withShapeExclusivity`, so the
fork's "complete zod conversion" commit and its successors conflicted with `ours` empty at the old
locations. Resolved by computing each fork commit's own delta (`base → theirs`) and applying it to
the restructured file, rather than hand-merging misaligned hunks.

Two fork-field decisions, applied consistently: fork fields (`spaceId`, `order`, `withSharedSpaces`,
`isInAlbum`, `ownerId`) are **not** marked `DEPRECATED_FLAT_FIELD`. That meta advertises a structured
V3 replacement, and either none exists or the replacement is one this server rejects.

### `search.service.ts` — upstream's `resolveEmbedding` assumed its own repository shape

Upstream extracted the smart-search embedding logic into `resolveEmbedding`, whose body does
`getEmbeddingResponse?.embedding`. The fork's `searchRepository.getEmbedding` returns the embedding
**directly** (`string | null`). The helper arrived outside any conflict; repointed at the fork's
signature.

The fork's own `searchSmart` keeps its inline instrumented block (immich-30179's extraction would
have deleted the phase-timing `encodeMs` / `embeddingSource` the fork's debug log consumes), and a
later fork commit replaces it with the shared `resolveSmartSearch` helper anyway.

### Fork-owned files upstream also changed

- `mobile/pubspec.yaml`, `mobile/ios/Runner/Info.plist` — the fork versions its mobile app
  independently (`de.opennoodle.gallery` is a separate listing). Fork's values kept.
- `.github/workflows/{prepare,draft}-release.yml`, `backport.yml` — fork deletions kept; these need
  Immich-only infrastructure. Note a `UD` resolution needs the documented recovery, since
  `stopped-sha` is left empty and `--continue` refuses.
- `i18n/{fa,ja,kn,…}.json` — resolved **per key**: the fork owns its compliance disclosures, upstream
  owns every other translation.

## Fork Feature Verification

| Feature                                                                  | Status | Notes                                                                                                                         |
| ------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Shared Spaces                                                            | OK     | Fork-owned file + extension-symbol survival green; no fork search symbol lost (checked explicitly against the pre-rebase tip) |
| Search (legacy path + RBAC gate)                                         | OK     | `searchAssetBuilderLegacy` intact; V3 dormant and guarded                                                                     |
| Dynamic filter suggestions                                               | OK     | `/search/smart/facets`, `/search/suggestions/{tags,filters}` present in the regenerated spec                                  |
| Storage Migration · Pet Detection · Image Editing · Google Photos Import | OK     | No upstream overlap this batch                                                                                                |
| Branding                                                                 | OK     | i18n override detector clean; location-disclosure policy test green across 89 locales                                         |

## Database / Mobile Drift

- New upstream migrations: **none**. Gallery migration count **62** (expected 62), no collisions.
- `revert-to-immich.sql` coverage: no missing entries.
- Mobile `schemaVersion` **36**, unchanged; `mobile-drift-rebase-check` green; `make-migrations`
  regenerated without refusing a snapshot (the Shape L signal).

## Inconsistencies Found

**1. immich-30179's `SearchFilter` DTO collides with the fork's model — 62 analyzer errors, zero conflicts.**

The V3 filter schema generates a `SearchFilter` class into the Dart client, and the fork already owns
`models/search/search_filter.model.dart`. Nine mobile files import both; the ambiguity degraded the
fork's own filter type to `Object` and cascaded into 62 errors. Gallery never uses upstream's V3
filter, so the generated one is hidden at the import. **Only `dart analyze` sees this** — no server
gate, no conflict, no type error elsewhere.

**2. immich-30296's translation update overwrote Play/App Store compliance copy.**

`location_permission_content`, `background_location_permission_content`,
`map_no_location_permission_content` and `map_location_service_disabled_content` are consent
disclosures the fork owns; they must name Noodle Gallery and must not name Immich.
`test/policy/location_disclosure_copy_test.dart` enforces that across all 89 locales.

- `fa`, `kn`: fork text replaced by a retranslation → restored.
- `fa`, `sq`: Immich-branded copy added for keys the fork has no translation for → dropped, so they
  fall back to `en.json`'s compliant text. Shipping upstream branding in a consent disclosure is
  worse than falling back to English.

Only `kn` and `sq` ever conflicted; the rest arrived clean and were caught solely by the policy test.

**3. `size` gained a zod `.default`, which surfaces as REQUIRED on the DTO output type.**

124 fork test call sites had to pass it explicitly. Mechanical, but not visible until `tsc` ran.

**4. Automated conflict resolution ate two block closers.**

Both the small and medium search specs lost a `});` where a both-sides-added region's closer lived in
the shared tail. Each surfaced as a single `TS1005` at EOF, ~1000 lines from the cause. **An
auto-resolver that concatenates on an empty base is only safe if the result is then checked to
parse.** The same resolver also reordered locale keys (prettier owns that ordering; restored) and
mangled the generated `packages/sdk/src/fetch-client.ts` (regenerated, not hand-repaired).

**5. `withSharedSpaces` validators ended up swapped.**

`stringToBool` landed on the smart-search POST body and `z.boolean()` on the filter-suggestions query
string — exactly backwards. Caught by existing fork tests, not by types: the OpenAPI spec renders
either form as `boolean`, so there was no generated-artifact drift to notice.

**6. immich-30296 also broke two branding gates — three workflows red from one defect each.**

The translation update is the gift that keeps giving. Two separate gates, neither visible to any
type-check or unit test:

- **Persian author sign-off.** `version_announcement_closing` was retranslated to
  `دوست شما، الکس`. `branding/config.json`'s `author_names` already carried `ایلکس`, but this is a
  different spelling (it drops the ی), so `apply-branding` left the upstream author's name in a
  user-facing string. Added the new spelling; verified by replaying `swap_author_name`'s own jq over
  all 89 locales — 58 carry the key, all 58 now resolve to Pierre.
- **Persian purchase CTA.** `fa` gained `buy` / `purchase_button_buy_immich` = `خرید Immich`. The
  generic name swap would render that as _buy Noodle Gallery_ — an offer to sell a fork that is not
  for sale, which `test-i18n-branding.sh` explicitly forbids. Added `branding/i18n/overrides-fa.json`
  with `حمایت از Noodle Gallery`, matching fa's own register (its buttons are nominal — خرید,
  فعال‌سازی, ذخیره — and it already renders support as `حمایت از پروژه`).

The first reddened **three** workflows (ML smoke, mobile smoke, build-mobile) because they all run the
`apply-branding` action — one defect, three red X's. **`branding/scripts/gallery-branding-check.sh`
reproduces the whole pipeline locally against a throwaway worktree** (and prepends Homebrew GNU tools
on macOS), so this class is cheap to verify without a CI round. Note it checks out `HEAD`, so changes
must be committed before it sees them.

**7. Upstream's V3 medium tests exercise the path we now reject.**

`new search shape` in the medium spec drives V3 through `sut.searchMetadata(auth, { filter })`; 11 of
its 13 cases now fail for exactly the reason the fork intends. Skipped rather than deleted, with a
comment tying it to the coexistence spec — V3 is carried dormant, and these are the tests that will
validate the builder when we adopt it. The reachable contract is covered in the small spec.

## Zero-Conflict Break Gate

| Detector                                                            | Result                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Silent-noop (deleted URL literals vs fork literal-matching tooling) | clean                                                                                            |
| Shape I — upstream ADDs / RENAMEs onto a fork-touched path          | clean                                                                                            |
| Shape I corollary — zero-byte tracked files                         | clean (identical set to pre-rebase)                                                              |
| Shape L — unresolvable mobile imports                               | clean                                                                                            |
| i18n branding-override gap                                          | clean                                                                                            |
| Shape K — fork-line audit on the four search files                  | clean; every missing line explained by upstream's own restructure, and no fork field/symbol lost |

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-197`
- **Validated on**: `a03aab142e5` — all ten workflows green on this one commit

| Workflow                                  | Status | Run                                  |
| ----------------------------------------- | ------ | ------------------------------------ |
| `test.yml`                                | GREEN  | 33178451811 (21/21 non-skipped jobs) |
| `docker.yml`                              | GREEN  | 33180544108                          |
| `static_analysis.yml`                     | GREEN  | 33180551911                          |
| `gallery-build-mobile.yml`                | GREEN  | 33180600836                          |
| `gallery-rebase-smoke.yml`                | GREEN  | 33180559526                          |
| `storage-migration-tests.yml`             | GREEN  | 33180565837                          |
| `storage-migration-e2e.yml`               | GREEN  | 33180594074                          |
| `gallery-revert-to-immich-validation.yml` | GREEN  | 33180572997                          |
| `gallery-ml-smoke.yml`                    | GREEN  | 33180580269                          |
| `gallery-mobile-smoke.yml`                | GREEN  | 33180587333                          |

**10/10 green.** Three CI rounds were needed, and both extra rounds were immich-30296's branding
fallout rather than the search work: round 1 red on ML smoke / mobile smoke / build-mobile (one
defect — the Persian author sign-off — surfacing in all three, since each runs `apply-branding`) plus
`Test` red on the Persian purchase CTA and the V3 medium tests. Round 2 fixed branding; round 3
confirmed everything on one commit.

- **Failures fixed**: 4 (Persian author name, Persian purchase CTA, V3 medium tests, and the
  `withSharedSpaces` validator swap caught locally before pushing).
- **Confirmed flakes**: none.

## Landing

**Not landing.** The standing rule wants an upstream **tag** plus a thoroughly tested state. Upstream
has `v3.2.0-rc.0` / `rc.1`, but those are release candidates; the latest stable tag is still `v3.1.0`,
which `branding/config.json` carries. Level-with-upstream and green is the steady state for this
branch.

## Local CI Verification

| Check                                                                                                     | Status | Notes                                               |
| --------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync)                                                          | PASS   | 62 migrations, 1 compatibility alias                |
| `server pnpm check` (tsc)                                                                                 | PASS   |                                                     |
| `web check:typescript` / `check:svelte`                                                                   | PASS   | 627 files, 0 errors                                 |
| `e2e pnpm check`                                                                                          | PASS   |                                                     |
| `server pnpm lint`                                                                                        | PASS   |                                                     |
| prettier — server / web / e2e / docs / packages/cli / .github / i18n                                      | PASS   |                                                     |
| Server unit tests                                                                                         | PASS   | 198 files, 6124 tests                               |
| Web unit tests                                                                                            | PASS   | 371 files, 5964 tests                               |
| `dart analyze --fatal-infos`                                                                              | PASS   | after hiding the colliding `SearchFilter`           |
| `dart format`                                                                                             | PASS   | 804 files, 0 changed                                |
| `flutter test`                                                                                            | PASS   | 3488 tests                                          |
| OpenAPI regen (spec + TS client + Dart)                                                                   | PASS   | one regen, deferred from the batch                  |
| SQL regen (`mise //:sql`)                                                                                 | PASS   | no drift                                            |
| `make upstream-postrebase-audit BATCH=197`                                                                | PASS   | 7/7                                                 |
| `make fork-patches-check` / `ci-invariants-check` / `mobile-drift-rebase-check` / `commit-autolink-check` | PASS   | invariants now 5/5 incl. `search-v3-not-dispatched` |
| `revert-to-immich.sql` coverage                                                                           | PASS   |                                                     |

**Toolchain note:** `mise //mobile:*` resolves the wrong Flutter on this machine (3.41.9 instead of
the pinned 3.47.1) and fails version solving even with the pinned SDK first on `PATH`. Run the
codegen/analyze/test steps directly from
`~/.local/share/mise/installs/aqua-flutter-flutter/<pin>/flutter/bin`. As always, `flutter pub get`
rewrote `mobile/pubspec.lock`'s dart constraint — reverted; both `mise.lock` files verified
unchanged.
