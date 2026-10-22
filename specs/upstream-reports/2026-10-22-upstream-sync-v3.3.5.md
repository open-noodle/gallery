# Upstream Sync Report — 2026-10-22 (v3.3.3 → v3.3.5)

## Summary

- **Upstream commits pulled**: 10 (`v3.3.3..v3.3.5`, the tip of `release/v3.3`). Nothing on `release/v3.3` sits past the tag.
- **Source of the branch**: `origin/main` (`56418b9e780`), not the v3.4 rolling branch, so none of the v3.4 content is carried.
- **Replay**: batch 01 and batch 02 alone, then batches 03–09 in one step (version, CI, Docker and ML-pin chores that cleared the product gate).
- **Conflicts resolved**: about 16 stops across the replay (grouped below). None was a surprise product collision.
- **Risk level**: MEDIUM. One commit (immich-32593) touches `asset_face` and replay-owned person files; the rest is chores.
- **Recommendation**: PROCEED to remote CI.
- **Decision (Pierre)**: Option A. Take upstream's schema and types; keep Gallery's person queries. Option B is recorded in `specs/2026-10-22-person-queries-on-asset-face-state-design.md`.

## Incoming Upstream Changes

| SHA | Summary | Area | Risk | Notes |
| --- | --- | --- | --- | --- |
| `f50052842b9` | missing translation | web | LOW | Touches an `Access` action the fork removes; fork side kept. |
| `86774b709cc` | more efficient person queries (immich-32593) | server schema, person, sync | HIGH | See below. |
| `69e0cb86061`, `8303cb117e1` | version v3.3.4, v3.3.5 | many | LOW | Fork keeps its own app version in `pubspec.yaml` and `Info.plist`. |
| `a419c411f92` | Xcode 27.1 for CI builds | `build-mobile.yml` | LOW | Merged into the fork's token-free shape. |
| `cf414722ca0`, `a34a5fcbd9d` | node 24.22.1 | `.nvmrc`, `mise.*`, Dockerfiles | LOW | Applied cleanly. |
| `11a5f590ebc` | base image `202610211607` | Dockerfiles, e2e search spec | MEDIUM | Checked by running both images (below). |
| `53630a00795`, `15621ae1f45` | python digests, certifi | ML | LOW | |

### High-risk change: immich-32593

- **Upstream**: migration `1792213725597-AddAssetFaceAssetState` adds `ownerId`, `assetVisibility`, `assetDeletedAt` to `asset_face`, two triggers, a partial index, a `WHEN` clause on `asset_face_updatedAt`, a new `inSharedAlbum(userId, assetIdRef)` signature, and a rewrite of the people-list queries.
- **Fork surface**: faces and people, sync, eight fork foreign keys onto `asset_face_pkey`, and the replay-owned `person.repository.ts` / `person.service.ts`.
- **Why it is safe to take the schema**: the migration is additive and drops or rebuilds no key in `gallery-upstream-fks.json`. A fresh database ran all 101 upstream and 79 fork migrations; `migrations:generate` reported "No changes detected", which also validates the merged `asset.table.ts` triggers against the real migrations.
- **Zero-conflict breaks found and fixed**: two fork call sites still used `inSharedAlbum(eb, userId)` (`person.repository.ts` statistics, `asset.repository.ts` person arm). They merged without a conflict and only `tsc` would have seen them.
- **Not taken (Option A)**: upstream's rewrite of `getAllForUser` and `PersonService.getAll`. Gallery's queries are a different shape (owner-only counts, Space arms); the five person files are byte-identical to before the batch.

## Conflict Resolutions

| File | Fork side | Upstream side | Resolution | Risk |
| --- | --- | --- | --- | --- |
| `web/src/lib/services/person.service.ts` | removes the `Access` action (sharing dormant) | retitles that action | fork side | LOW |
| `asset.repository.ts` (3 stops over history) | timeline and space arms | `inSharedAlbum` signature | fork side per hunk, call form rewritten by script | MEDIUM |
| `schema/tables/asset.table.ts` (2 stops) | library audit and favorite triggers | new `AfterUpdateTrigger` | union of all triggers and imports | MEDIUM |
| `person.repository.ts`, `person.service.ts`, their 3 specs | whole fork file | rewrite | fork side whole (replay-owned) | MEDIUM |
| `queries/person.repository.sql` | | | fork side, then regenerated | LOW |
| `database.ts`, `asset-face.table.ts`, `editor.spec.ts` | `createdBy` (later removed) | three new fields | union, then ours minus `createdBy` at the side-table commit | LOW |
| `mobile/pubspec.yaml`, `Info.plist` | fork app version | upstream version | fork side | LOW |
| `.github/workflows/build-mobile.yml` | no token step | Xcode 27.1 | fork shape plus Xcode 27.1 | LOW |

**Verification of the replay**: for every file upstream touched in batches 03–09, the applied delta equals upstream's delta except `pubspec.yaml` and `Info.plist` (the fork's own version values). Resolver scripts exited non-zero on any unknown conflict.

## Fork Feature Verification

| Feature | Status | Notes |
| --- | --- | --- |
| Shared Spaces | OK | `rbac-oracle` (13) and `access-oracle` (190) snapshots unchanged. |
| Storage Migration | OK | No overlap. |
| Pet Detection | OK | Pet-face inserts target real assets; the new trigger fills `ownerId`. |
| Image Editing | OK | `1799000000000` migration runs and is now in the manifest. |
| Branding | OK | `Test Branding` is green on `main` in CI. Two `en_GB` failures seen locally were a macOS-only artifact (see Inconsistencies). |
| Google Photos Import | OK | No overlap. |

## CI and Infrastructure Verification

| Check | Status | Notes |
| --- | --- | --- |
| Workflow collisions | OK | Only `build-mobile.yml` changed. |
| Docker image refs | OK | Dockerfile stage paths agree; no stale `COPY --from=plugins /app/`. |
| Base image | OK | Debian trixie both; node 24.21.0 → 24.22.1; `binaryen` 120-4 installable in both. |
| Removed literals | OK | Only nodejs.org and certifi URLs; none matched by branding scripts. |
| `.github` formatting | not run | Only one workflow edited; run in CI. |

## Database Migration Analysis

| Timestamp | Migration | Tables | Risk | Notes |
| --- | --- | --- | --- | --- |
| 1792213725597 | AddAssetFaceAssetState | `asset_face`, `asset` triggers | MEDIUM | Additive; sorts below fork `1793…`/`1798…`. |

- Fresh install and existing-database order are both safe (ledger medium spec passes).
- Timestamp collisions: none. New `renamedMigrations` entries: none.
- FK-key audit: no listed key touched.
- Upstream tables the fork alters: `asset` gains upstream's own trigger beside the fork's two.
- Ledger intact; `migrations:run` still goes through `gallery-migrations.js`.
- Revert coverage detector against `v3.3.5`: 0 missing, 0 stale. The tag image is published.

## Mobile Drift Migration Analysis

No upstream mobile migration in the range. `mobile-drift-rebase-check BATCH=09` passes.

## Layering

- Upstream files whose fork diff changed against the tag: `asset.table.ts` +25 → +30 (the fork-function import now wraps at four names); `person.repository.ts` and `person.service.ts` are replay-owned and not merged; every other touched file is unchanged.
- Top-level `i18n/*.json` identical to the upstream tag: YES. `merge.mjs --check`: PASS (overlay tests 5/5).
- Access and RBAC oracle snapshots unchanged: YES.

## Inconsistencies Found

1. **`main` regression (fixed here and in #1230)**: `1799000000000-AddAssetImageAdjustTable` (from #1124) was missing from `docs/fork/ownership.yml`, so Gallery Migration Count read 79 against 78 on `main` itself.
2. **Not a `main` regression (local macOS artifact)**: `gallery-branding-check.sh` reported two `en_GB` failures on a clean `main` checkout. Cause: `i18n/gallery/merge.mjs` exits 0 without running when a parent directory is a symlink (macOS `mktemp` under `/var`), so the check folded no overlay. CI on Linux is unaffected and `Test Branding` is green on `main`. The first draft of this report called it a `main` regression; that was wrong. The CLI guard is fixed in #1230.
3. **Generated queries**: `person.repository.sql` changed by two lines, exactly upstream's dropped `::uuid` cast.

## Code Review Findings

Deferred to CI plus the reviewer's pass at Checkpoint 3.

## Local CI Verification

| Check | Status | Notes |
| --- | --- | --- |
| `server pnpm build` | PASS | |
| `server pnpm check` (tsc) | PASS | after building the plugin packages |
| `server pnpm lint` | PASS | |
| Server unit tests | PASS | 6786 passed, 14 skipped |
| Server prettier | PASS | |
| Medium: access-oracle, rbac-oracle, sync-asset-face, ledger | PASS | 190, 13, 18, 14 |
| Preflight suite | PASS | 304 passed, 1 skipped |
| OpenAPI spec and TS SDK regeneration | PASS | no drift |
| SQL regeneration and schema drift | PASS | 789 queries; "No changes detected" |
| Post-rebase audit (batch 02) | PASS | after the manifest fix |
| fork-patches, ci-invariants, autolink, i18n | PASS | 1693 commit messages scanned |
| Web, mobile, ML, e2e | skipped | version or dependency bumps only (tree-identity scan against `origin/main`) |

## Remote CI Verification

Pending. Nothing has been pushed.

## Post-Rebase Verification

- `v3.3.5` is an ancestor of `HEAD`; zero-byte files and conflict markers: none beyond three pre-existing empty files.
- Backups: `backup/rolling-v335-pre-01`, `-pre-02`, `-post-02`.
