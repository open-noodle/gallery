# Batch 15 (mobile cluster) integration — design

**Date:** 2026-07-17
**Branch:** `rebase/upstream-rolling-v3.0.3`
**Context:** Rolling rebase of the Gallery fork onto untagged upstream Immich commits above v3.0.3. Batches 1–14 (22 commits) are landed, validated, and pushed. Batch 15 was **quarantined by the per-batch product-direction gate** because its first commit (#29077) restructures a fork surface. This spec captures the integration decisions for batch 15 (and the 3 trailing commits in batch 16) and the plan to pull them in.

## Batch 15 commits

| Commit                                                               | Subject                                                                    | Class                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| `0af8284456` #29077                                                  | expose iOS signing + bundle identities through config (`Signing.xcconfig`) | **product-direction**            |
| `3a016f4451` #29780                                                  | drop support for iOS 14 (deployment target 14→15)                          | **product decision**             |
| `a5623c41ec` #29886                                                  | pump Flutter 3.44.1 → 3.44.6                                               | toolchain                        |
| `9cea3f2375` #29113                                                  | pump Drift                                                                 | toolchain (fork owns migrations) |
| `90dc328c22` #29772                                                  | maplibre_gl 0.26.2                                                         | mechanical                       |
| `fe3eb7d865` #27061                                                  | undo archive from toast (web)                                              | mechanical                       |
| `507448d797` #29981                                                  | pump home_widget                                                           | mechanical                       |
| `a3dd19cd2f` #29633                                                  | update typescript-projects deps                                            | mechanical                       |
| `f18065b3c2` #29892                                                  | @types/node bump                                                           | mechanical                       |
| `297316c7b8` #29382                                                  | mobile owned-action assets filter                                          | mechanical                       |
| batch 16: `f19f30ec6` #29380, `f2c00c107` #29999, `12fc8bac1` #30000 | kebab reset, workflow step order, workflow filter-by-path                  | mechanical                       |

## Decisions

### 1. #29077 iOS signing → **adopt upstream `Signing.xcconfig`** (Option A)

Upstream replaces hardcoded bundle IDs / `DEVELOPMENT_TEAM` in `project.pbxproj` with `$(IMMICH_*)` variables read from a new `mobile/ios/Signing.xcconfig`. The fork's `apply-branding.sh` currently rewrites the **hardcoded** strings in `project.pbxproj` (bundle IDs lines 664–670; `DEVELOPMENT_TEAM` line 679) — strings #29077 deletes, so those seds would silently no-op and ship an `app.alextran.immich` / Immich-team iOS build. (Provisioning itself is safe — the release runs through fastlane `gha_release_prod` with `FASTLANE_TEAM_ID` — but the built bundle identity would regress.)

**Chosen:** rework `apply-branding` to write the fork's values into `Signing.xcconfig` instead of rewriting `project.pbxproj`:

```
IMMICH_TEAM_ID        = 77MWNP37MV
IMMICH_BUNDLE_ID_PROD = de.opennoodle.gallery
IMMICH_BUNDLE_ID_DEV  = de.opennoodle.gallery
IMMICH_GROUP_ID       = group.de.opennoodle.gallery.share
```

Upstream's `project.pbxproj` then derives every suffix (`.debug` / `.profile` / `.Widget` / `.ShareExtension`) from those variables — work the fork does by hand today.

**Rationale:** `Signing.xcconfig` is a fork-stable override file upstream won't churn; `project.pbxproj` signing lines become upstream-owned and untouched by the fork, so **this collision never recurs**. This is strictly less apply-branding logic than today (4 value writes vs ~8 pbxproj seds). Rejected: reverting #29077's pbxproj changes (Option B) — smaller now but re-fights upstream's pbxproj every future rebase and leaves an unused file (the exact "two parallel systems" the gate exists to prevent).

**Out of scope / unchanged:** `PRODUCT_NAME` seds (#29077 doesn't touch them); app-group entitlements handling (confirm during implementation whether entitlements reference `$(IMMICH_GROUP_ID)` or stay on the fork's existing group sed).

### 2. #29780 drop iOS 14 → **adopt**

Bumps `IPHONEOS_DEPLOYMENT_TARGET` 14→15 (Podfile, 6 pbxproj targets, SPM `Package.resolved`). iOS 15 is 4+ years old; low product risk. Bonus: the fork's recurring **SwiftPM min-platform-14 archive failure** disappears when the floor is 15. The fork does not customize deployment targets, so it applies cleanly alongside #29077.

### 3. Flutter 3.44.6 (#29886) → **adopt**; Drift pump (#29113) → **adopt + regenerate**

Flutter is a patch bump within 3.44 (fork pins 3.44.1); take upstream's `mobile/mise.toml` + `mise.lock`. Drift is a package bump; the fork owns the Drift schema/migrations, so regenerate mobile Drift codegen and re-run `mobile-drift-check` + `flutter test` (a package bump can shift generated `*.drift.dart`).

## Implementation plan

1. **Advance the upstream target** to batch-16 tip `12fc8bac1` (pull batch 15 + the 3 trivial batch-16 commits together) and `git rebase` per the rolling recipe; resolve conflicts (expected: `project.pbxproj` for #29077/#29780/fork; `mise.toml`/`mise.lock` for Flutter; Drift generated files).
2. **Rework `apply-branding.sh`** iOS section: write the 4 `Signing.xcconfig` values; delete the now-dead pbxproj bundle-ID + `DEVELOPMENT_TEAM` seds; keep `PRODUCT_NAME` seds. Update `verify-branding.sh` to assert the branded bundle/team in `Signing.xcconfig` (not pbxproj).
3. **Regenerate artifacts**: mobile Drift codegen (`mise //mobile:codegen:dart` / build_runner), mobile OpenAPI + SQL if server changed.
4. **Reconcile** `revert-to-immich.sql` only if any commit adds a `server/src/schema/migrations/*.ts` (batch 15/16 are not expected to).

## Verification plan

- **Branded iOS build** (fork iOS build tooling / `gallery-build-mobile`): confirm the built app is `de.opennoodle.gallery` with team `77MWNP37MV` and correct suffixes for Widget/ShareExtension/debug/profile — a signing rework must be proven by a real build, not a diff read.
- `apply-branding` + `verify-branding` pass locally (gsed on macOS).
- Mobile `dart analyze --fatal-infos lib test` + `flutter test` on Flutter 3.44.6.
- `mobile-drift-check` + Drift snapshot integrity after the Drift bump.
- Server tsc / web tsc / lint / unit tests; the tooling audits (postrebase, ci-invariants, fork-patches).
- Full CI set incl. `gallery-build-mobile`, `gallery-ml-smoke`, `gallery-mobile-smoke`, `static_analysis` (Dart analyze/format), Docker.

## Risks

- **iOS signing rework is release-critical** — a wrong `Signing.xcconfig` mapping ships a mis-branded/mis-signed build. Mitigation: the branded-iOS-build verification above; `verify-branding` gate.
- **Drift package bump** can silently change generated code or migration behavior. Mitigation: regenerate + `mobile-drift-check` + `flutter test`.
- **Flutter 3.44.6** could surface new analyzer lints (CI `static_analysis` is `--fatal-infos`). Mitigation: run mobile analyze locally before push.
