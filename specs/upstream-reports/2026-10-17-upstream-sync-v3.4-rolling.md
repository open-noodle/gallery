# Upstream Sync Report — 2026-10-17 (v3.4 rolling, `upstream/main`)

## Summary

- **Branch**: `rebase/upstream-rolling-v3.4`, cut from `origin/main` (`5ddd0e8b667`), tracking **`upstream/main`**:
  upstream has no `release/v3.4` branch and no v3.4 tag yet. `docs/fork/ownership.yml` says `upstream_branch: main`
  on this branch only.
- **Upstream**: `d2dac658fe1` (`v3.3.3`) → **`188d64e4359`** (`upstream/main`, 2026-10-16). The planned 85 batches
  ended at `908222abfa5`; four commits that landed during the cycle were taken as a batch 86. 0 behind.
- **Parallel branches**: if Immich ships a **3.3.4** from `release/v3.3` before v3.4, it gets its own v3.3 rolling
  branch in a separate worktree (rolling state is per worktree); whichever lands on `main` first, the other is rebased
  onto it.
- **Base**: `branding/config.json` `upstream.version` stays **3.3.3**. Bump it when the branch lands on a v3.4 tag.
- **Release copies**: the fork sat on `v3.3.3`, whose history carries 82 cherry-picks from `release/v3.3` whose
  originals are on `upstream/main`. `rebase --onto` from v3.3.3 does not work (the new base lacks them until their
  batch), so each batch is a plain `git rebase <tip>`: a copy drops when its `main` twin lands (patch-id, or same
  subject and identical non-lockfile diff). One copy whose twin lands later (immich-32148 ↔ 6f356877f5d) was resolved
  to the twin's content at batch 34 and dropped at batch 40. What remains: the six `chore: version` commits and a
  two-line `uv.lock` churn left from immich-32148.
- **Backups**: `backup/rolling-pre-v34` (branch start), `backup/rolling-v34-pre-NN` per batch, `-post-54`, `-post-70`,
  `-post-86`. `main` untouched.
- **Fork commits**: 1711 on the branch (1687 on `main` above v3.3.3).
- **Risk**: HIGH, from the size of upstream's cycle (Rust core, ML v2, TanStack web, perf rewrites), not from any one
  resolution. See the landing blockers.

## Decisions taken at checkpoint 1 (maintainer, 2026-10-16)

1. Rust native core (immich-31254 and follow-ups): **taken**. The fork's workflows build and test it (below).
2. ML `MACHINE_LEARNING_MODEL_REVISION: v2` in the default compose (immich-32289): **taken**. **Landing blocker**, see
   below.
3. Shared-link and album perf (immich-32411, immich-32412, immich-32413): **taken**, with the fork's #1018 rule ported
   into upstream's new query shapes and album counts given scoped arguments. The access oracle must not change.
4. Mobile tags (immich-30753): **adopted** upstream's `Set<Tag>`; the fork's untagged filter stays a display flag that
   sends `tagIds: null`.
5. Server feature level (immich-32178): **mirrored**. Every version response goes through
   `ServerVersionResponseDto.fromSemVer`, so Gallery and stock clients both report upstream's level for the code they
   run.
6. CONTRIBUTING: **the fork's AI policy kept**, upstream's "human communication" paragraph not taken.
   `auto-closed:translations` (immich-32451): **dropped** with the rest of upstream's auto-close jobs.

## Landing blockers

- **ML model revision v2 (decision 2).** Gallery's own models (pet detection and recognition) download from the
  `open-noodle` org at `main`, but `sessions/ort.py` keys fp16 conversion and accelerator graph rewrites off the global
  `settings.legacy_models`, which v2 turns off. Those rewrites were never validated on the pet models. Validate pet
  detection and recognition (CPU and each accelerator Gallery ships) under v2 before this branch lands.
- **A v3.4 tag.** Per the standing rule, rolling branches land only on an upstream tag. At that point bump the base
  (`upstream.version`, `immichVersion`), drop the six `chore: version` copies against upstream's own, and re-check
  `revert-to-immich` against the v3.4 stock image.

## Conflict resolutions and reconcile commits

Mechanical conflicts (imports, union of tests, lockfiles regenerated from the base side, fork-deleted files kept
deleted, fork-stubbed workflows kept stubbed) are not listed. The judgement calls:

| Batch | Upstream                                                   | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 26    | `group_date` columns, Drift v35 (immich-30262)             | Upstream's v35 collides with the fork's shipped v35, so it is renumbered **v42** (`from41To42`, `drift_schema_v42.json`). The fork's timeline tests moved to `mobile/test/gallery/shared_space_timeline_drift_test.dart`; upstream's test file is verbatim.                                                                                                                                                                               |
| 27    | unused `disableAssetSelect` / `timelineElement` removed    | Removed from the fork's replayed code too.                                                                                                                                                                                                                                                                                                                                                                                           |
| 29    | iOS background cancel test (immich-31944)                  | A fork commit that had returned `backup_provider_test.dart` to upstream's text dropped the new test in replay; restored by fixup.                                                                                                                                                                                                                                                                                                    |
| 34/40 | GPU ML e2e job (immich-31998)                              | Dropped (`ci: drop upstream's GPU ML end-to-end job`): it needs Immich's self-hosted GPU runners and GitHub App. Re-dropped at each later upstream edit of the job.                                                                                                                                                                                                                                                                   |
| 52    | cold-start deep link via the splash (immich-32181)         | Taken; the fork's splash hands the link to `GalleryTabShellRoute` instead of `TabShellRoute`.                                                                                                                                                                                                                                                                                                                                        |
| 54    | native `Set` methods, `src/utils/set.ts` deleted            | The fork's `access.ts` arms rewritten in upstream's shapes; `gallery/utils/access-grants.ts` follows (zero-conflict break).                                                                                                                                                                                                                                                                                                         |
| 55    | Rust native core                                           | `native-tests` runs on `github.token` (CI invariant). The mobile builds failed with mise's "config not trusted" from the native-asset hook, which runs `rustup` without the workflow environment: `gallery-build-mobile` now saves the trust to disk (upstream's Fastfile does the same), and the fork workflows move to `use-mise` v3.2.3.                                                                                             |
| 70    | shared-link and album perf                                 | `checkSharedLinkAccess` keeps upstream's link/album arms; the link-asset arm is gated by `sharedLinkAssetIsServable` and a third arm serves the album's contributions through the link's space. Album responses use upstream's `mapWithMetadata` with a caller scope (`gallery/utils/album-metadata-scope.ts`); a link counts in its one space, only while its creator may still publish. The fork's payload tests moved to the count. |
| 72    | mobile tags (`Set<Tag>`)                                   | See decision 4. The photos filter stores `Tag`s; reads keep an id view through `gallery/utils/search_filter_tags.dart`; a tag tapped in upstream's new asset-details section opens the photos filter (`gallery/utils/open_tag_filter.dart`), since the fork has no `SearchRoute`.                                                                                                                                                       |
| 73    | feature level                                              | Fork version fixtures gain `featureLevel`.                                                                                                                                                                                                                                                                                                                                                                                           |
| 77    | mise 2026.10.9 Dockerfile stage                            | The fork's plugins stage (no `mise install --locked`, no `COPY ./.mise`) kept; the mise image bump taken.                                                                                                                                                                                                                                                                                                                             |
| 78/80 | dependency updates                                         | `pnpm-lock.yaml` regenerated from upstream's lock: shared dependencies match upstream exactly; fork-only ones re-resolved to their newest in-range versions (`@aws-sdk/*` 3.1143 → 3.1152, `@types/node` 24.19.2, `@axe-core/playwright` 4.14).                                                                                                                                                                                         |
| 81–85 | web TanStack Query refactors                               | The fork's layout gets upstream's `QueryClientProvider`; the fork-only Memories and Storage Usage settings and the rail storage widget read upstream's queries; their specs mock the query instead of the deleted managers.                                                                                                                                                                                                        |
| 86    | `search` flag unused on web (immich-32495), OG tags moved  | Flag checks unwrapped in the fork's sidebar; the generated spec and SDK regenerated (the replay had kept the fork's side and dropped two upstream DTO fixes).                                                                                                                                                                                                                                                                           |

Other fork commits added: the unicorn v76 `prefer-logical-operator-over-ternary` fixes in fork code (20 sites), the
offline-deletion test following immich-32077, and the ownership manifest's missing `1799000000000-AddAssetImageAdjust`
entry (also missing on `main`, from #1124).

## Known gap, not fixed

- **Timeline `group_date` (immich-30262)**: upstream groups and sorts its timeline by the new `group_date`. The fork's
  main timeline (`shared_space_timeline.drift`, `spaceMerged*`) still orders by `created_at` and buckets by
  `local_date_time`, so upstream's header/sort fix does not reach it. A fork follow-up can switch those queries to
  `group_date`.

## Verification

- Per batch: the delta of every upstream-touched file equals upstream's own (sorted `+`/`-` lines), or the fork's
  delta over the base is unchanged, or a line-survival count passes; every deviation was reviewed and is listed above.
  `upstream-postrebase-audit`, `ci-invariants-check`, `fork-patches-check`, `mobile-drift-rebase-check`, the i18n
  overlay check and `commit-autolink-check` ran after every batch.
- `i18n/*.json` byte-identical to upstream `188d64e4359`.
- Local gates on the final tree: server build, `tsc`, lint and unit suite (6800 tests); web `tsc`, svelte-check,
  lint and unit suite (6683 tests); e2e type check; preflight suite; layering guards; mobile `dart analyze` (no
  issues) and 3427 targeted mobile tests.
- Medium and e2e suites run in CI only (no local Docker); the SQL query docs were regenerated from CI's SQL Schema
  Checks diff.

## Layering

Diff of the fork against upstream over files that exist upstream (code only; generated, JSON, SQL and lockfiles
excluded): **95,568 → 94,494 lines (−1,074)**. Shrank: `merged_asset_drift_test.dart` (−1,150, fork tests moved to
`mobile/test/gallery/`), `access.repository.ts` (−94, upstream's new query shape), `NavigationBar.svelte` (−23),
`shared-link.repository.ts` (−16). Grew: `test.yml` (+76, the dropped GPU job and `native-tests` token),
`tag_details.widget.dart` (+29, the hook replacing upstream's search navigation), `auto-close.yml` (+29, the dropped
translations job), `shared-link.service.ts` (+28, scope plumbing for album counts), `database.dart` (+12, Drift v42).

## Remote CI

Full sets ran at three checkpoints: after batch 26 (`85d5e77f033`, 10/10 after GHCR rate-limit reruns), after
batch 54 (`3aa378b3286`; one stale fork test, fixed) and after batch 70 (`e86d15c5b6b`; the batch 70 reconcile's
medium-test gaps and the mobile builds' mise trust, fixed). Final: all ten green.

| Workflow                            | Run         | Commit        | Note                                                                    |
| ----------------------------------- | ----------- | ------------- | ----------------------------------------------------------------------- |
| Test                                | 38996560302 | `3584b89f712` | 23/23 jobs, none skipped                                                |
| Docker                              | 38995246155 | `73c724b3437` |                                                                         |
| Static Code Analysis                | 38994804743 | `73c724b3437` |                                                                         |
| Gallery Build Mobile                | 38995351388 | `73c724b3437` | iOS + Android, Rust native core built                                   |
| Gallery Mobile Smoke                | 38995278931 | `73c724b3437` |                                                                         |
| Gallery ML Smoke                    | 38994900929 | `73c724b3437` |                                                                         |
| Gallery Rebase Smoke                | 38994812477 | `73c724b3437` |                                                                         |
| Storage Migration Tests             | 38994820036 | `73c724b3437` |                                                                         |
| Storage Migration E2E               | 38995319166 | `73c724b3437` |                                                                         |
| Gallery Revert-to-Immich Validation | 38994893906 | `73c724b3437` | tests the `:main` image on dispatch; this cycle adds no fork migration |

`3584b89f712` is `73c724b3437` plus one `eslint-disable` comment (Lint Web's only finding at `73c724b3437`), so
the nine other runs cover it. Lint Web on `ubuntu-latest` needed two workers (`ci: lint web with two workers`):
with six it died three times with a runner shutdown signal after svelte-eslint-parser 1.9.0. Locally, a stale
`node_modules` had hoisted `typescript` 7.0.2 and made that parser crash on plain-JS `.svelte` files; a fresh install
hoists 6.0.2 like upstream and CI.

## Landing

Not landed. `main` is untouched. The branch lands only on an upstream v3.4 tag, after the landing blockers above.
