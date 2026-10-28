# Upstream Sync Report — 2026-10-28, second cycle (v3.4 rolling)

## Summary

- **Branch**: `rebase/upstream-rolling-v3.4` (tracks `upstream/main`; no v3.4 tag yet, so this does not land)
- **Upstream**: `11bf8753137` → `e51de38c40a`, 13 commits (planned batches 162–172), replayed in one step
- **Fork sync**: `d9ea8866515` → `387d598598a` (#1251, #1244)
- **Fork commits replayed**: 1,765; 16 files kept on the fork side during the replay, upstream's diff re-applied after
- **Risk level**: MEDIUM (one zero-conflict break of the S3 folder view, one duplicate-resolve behaviour change taken
  from upstream); **Recommendation**: PROCEED, pending remote CI
- **Base for branding**: unchanged (`upstream.version` stays 3.3.5)
- **Pre-cycle tip**: `ebd3d44388f` (backup `backup/rolling-v34-pre-162-1028`; pre-fork-sync `backup/rolling-v34-pre-forksync-1028b`)

## Upstream changes

| SHA           | Summary                                                     | Risk   | Outcome                                                                                                                      |
| ------------- | ----------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `72e2bc8b0bc` | eslint-plugin-unicorn v78 (immich-32588)                    | MEDIUM | Taken; propagated to fork server, web and e2e code (see "Pattern propagation")                                               |
| `73603bcafe5` | `asset (ownerId, updateId)` index (immich-32624)            | MEDIUM | Taken; `revert-to-immich.sql` drops the index and the `kysely_migrations` row                                                |
| `c76e1517321` | anchor the folder-view path match (immich-32612)            | HIGH   | Taken with a fork hook: S3 originals use relative keys, see "Folder view"                                                    |
| `7bb91afbe15` | scope duplicate resolution to the caller (immich-32603)     | MEDIUM | Taken as upstream; one fork medium test changed its expectation, see "Duplicates"                                            |
| `f26b9c83adb` | OpenTelemetry 0.300, tscompat 0.4 (immich-32759)            | MEDIUM | Taken; `telemetry.repository.ts` keeps the fork's `ObservableCallback` import; tscompat 0.4 no longer crashes local web lint |
| `f5d33ff6618` | passkey feature level 2 (immich-32791)                      | LOW    | Taken; rolling serves passkeys, so level 2 is accurate. Stock 3.3.5 apps ignore the field                                    |
| `9f273a604d5` | `clusterGroup.admin` permission (immich-32787)              | MEDIUM | Taken; inert (cluster-group routes stay unmounted). Revert line added, access-oracle entry accepted (`{}`)                   |
| `07956869158` | `gcTime: Infinity` on long-lived queries                    | LOW    | Clean                                                                                                                        |
| `4ea9c1f7c52` | docs deploy on terraform change                             | LOW    | Clean                                                                                                                        |
| `21ed7454836` | mobile person timeline includes partners                    | MEDIUM | Taken in `timeline.repository.dart`; the fork's own person route (owner-only, temporal scope) is unchanged, see below        |
| `d8aaa950099` | terraform cloudflare v5                                     | LOW    | Clean                                                                                                                        |
| `a1a80cb1c41` | workflow filter by missing EXIF property                    | LOW    | Clean                                                                                                                        |
| `e51de38c40a` | serialize exif only for returned search rows (immich-32620) | MEDIUM | Taken; `search.repository.sql` regenerated, it differs from the pre-cycle file only by this change (+84/−2)                  |

No commit tripped the product-direction gate.

## How the replay was driven

One `git rebase e51de38c40a` with a gated driver: a fork-deleted file is removed; generated SQL takes the base and is
regenerated afterwards; every other conflict keeps the fork commit's file. All 16 kept files were then byte-identical
to the pre-cycle tip, and upstream's `11bf8753137..e51de38c40a` diff was re-applied to each with `git apply --3way`.
Two applied cleanly; four of the 14 conflicts were the shape "fork lines next to a line upstream reformatted" and were
resolved by a script that stages nothing while markers remain; the other ten by hand.

Audit: for every file touched by either side, the sorted `+`/`−` lines of the fork's delta against upstream were
compared before (`11bf8753137..backup`) and after (`e51de38c40a..HEAD`). Thirteen files differed, each explained:
upstream took the same change itself (`medium.factory.ts` `ViewRepository`, the mobile repository test), the fork's
delta now sits against upstream's reformatted line (`truncatedDate`, `extractOriginalImage`, the OTel import,
`getKeysDeep`, the album contribution comment), the fork keeps its own route (mobile `timeline.service.dart`,
`person.page.dart`), a generated file (spec, SQL), or the new folder-path hook. No fork content was lost.

## Folder view (`c76e1517321`, immich-32612) — zero-conflict break

Upstream now matches `originalPath LIKE '/<dir>/%'`. Gallery stores S3 originals under relative keys
(`upload/<user>/…`, `isDiskPath` is `isAbsolute`), and the web tree sends both kinds back slash-less, so every S3
asset would have vanished from the folder view with no conflict and no type error.
`server/src/gallery/utils/folder-path.ts` (`folderPathMatch`) keeps upstream's anchoring and escaping and adds the
relative arm (`'<dir>/%'`); `view-repository.ts` calls it once in place of upstream's two `where`s. Two medium cases
in the fork's `view-repository.spec.ts` (an S3 folder is listed; a disk and an S3 folder of the same name do not leak
into each other) pass with the hook and fail with upstream's single anchor. Upstream's own `view.repository.spec.ts`
passes unchanged.

## Duplicates (`7bb91afbe15`, immich-32603)

`DuplicateRepository.get` now takes the caller and returns only their assets. A resolve that keeps another owner's
copy (reachable because `PUT /assets` once let a user join any group) used to be refused with `NO_PERMISSION`; now
that copy is outside the group, so it is ignored, nothing is kept and the caller's copy is trashed. Upstream pins
this in its new "should not merge metadata into an asset owned by someone else". The fork's medium test
"should not write onto another owner's keeper…" now expects that outcome and keeps its assertions that nothing lands
on the other owner's copy (favorite, description, tags, Space membership). The fork's `ownedKeepIds` check in
`resolveGroup` can no longer fail and could be dropped later to shrink the upstream diff.

## Mobile person timeline (`21ed7454836`, immich-32675)

Upstream's `TimelineRepository.person` now takes one user and adds partner-owned assets. That diff applied, but the
route the app uses is the fork's `SharedSpaceTimelineRepository.person` (temporal scope), and rolling's copy of
`timeline_repository_test.dart` runs against it, so upstream's new test failed: the fork route was owner-only. The
fork route now takes the same partner arm (`_personOwnerFilter`, in all three of its predicates). In practice it
matches little in Gallery: faces on another user's photo only sync through upstream's cluster-group arm, which
Gallery does not use. The fork route also lacks upstream's older album arm (no upstream test covers it); left as is
and listed under follow-ups.

## Fork sync (#1251, #1244)

`make upstream-sync-fork-main` threw on #1244 and this time rolled back fully (clean tree, no `CHERRY_PICK_HEAD`).
Both were cherry-picked by hand; `integratedForkHead` advanced with an `appendHistory` entry.

| PR    | On rolling                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1251 | Clean. Its migration `1790900000000-SplitSharedPersonGroups` was missing from `docs/fork/ownership.yml` (the post-rebase audit's migration count, 80 vs 79); added. Its medium spec's stock-Immich stand-in runs this branch's upstream folder, so after the revert it re-runs the post-tag migrations the script removes: the assertion now expects exactly those (an empty list at a tag, so `main` is unaffected). unicorn v78 flagged one destructuring in its new spec. |
| #1244 | One conflict: its Drift test went into `merged_asset_drift_test.dart`, which on rolling is upstream's file; the fork's Space timeline tests live in `mobile/test/gallery/shared_space_timeline_drift_test.dart` (#1182), so the test moved there verbatim. Its `checkSpaceStackAccess` imported `src/utils/set.js`, gone on rolling (native `Set` methods): `allowed.difference(denied)`. Found by `pnpm build`, not by the earlier tsc run, which predated the sync.        |

Those two breaks are rolling-only. A third is **already on `main`** (Test red at `387d598598a`): #1244 added the
`SharedSpaceStacksV1` sync type without re-recording the search-contract fixtures
(`mobile/test/fixtures/search_contract/*server-features.json`), so the e2e contract check fails. Fixed here in its own
commit (`44ba44657a4`); `main` needs the same one-line-per-file change.

## Pattern propagation — eslint-plugin-unicorn v78

| Rule                                                                                                                                  | Fork sites              | Handling                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `no-asterisk-prefix-in-documentation-comments`                                                                                        | ~870 (server, web, e2e) | autofix, as upstream                                                                  |
| `no-unnecessary-parameters`                                                                                                           | ~130                    | `eslint-disable-next-line` per site, upstream's own approach (57 sites in its commit) |
| `prefer-default-parameters`                                                                                                           | 14                      | two fixed (optional params); the rest disabled: their `??` also covers `null`         |
| `no-negated-condition`, `prefer-logical-operator-over-ternary`, `no-unnecessary-array-flat-map`, `prefer-single-object-destructuring` | 7                       | fixed, behaviour kept                                                                 |
| stale `tscompat/tscompat` disables (tscompat 0.4)                                                                                     | 2                       | removed, as upstream did                                                              |

Trap hit: `--fix` with a rule switched off deletes upstream's existing `eslint-disable` comments for that rule as
unused. In upstream-identical files that was reverted; in fork-modified files the comments were re-added where the
rule still fires, and two (`asset.repository.spec.ts`, `memory.repository.spec.ts` `setup`) stay removed because the
fork's calls make them genuinely unused.

The comment rewrite also broke `shared-space-album-scope.guard.spec.ts`, which skipped comment lines by their leading
`*`: a doc comment naming `shared_space_library` read as an unguarded scoping arm. The guard now tracks `/* … */`
blocks. `favorite-grep-gate.spec.ts` uses the same prefix test and still passes; it is the next candidate.

## Database / mobile migrations

- Upstream: `1792568637987-AddAssetOwnerIdUpdateIdIndex` (additive index on `asset`). Revert script: `DROP INDEX`,
  `kysely_migrations` entry. The coverage detector prints nothing.
- Fork (#1251): `1790900000000-SplitSharedPersonGroups`, a deliberate pre-step numbered below upstream's newest;
  its revert entries came with the PR.
- No FK-registry key touched; no mobile Drift schema change this cycle.

## Layering

- `view-repository.ts`: fork delta vs the pre-cycle tip +2/−3 (the hook call and import replace the two `where`s).
- `i18n/*.json` untouched; `merge.mjs --check` PASS.
- Access oracle: one new entry, `clusterGroup.admin` → `{}`. RBAC oracle: unchanged.

## Local verification

| Check                                                                                                                                                         | Result                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| server `pnpm build` / `pnpm check` / `pnpm lint` / prettier                                                                                                   | PASS                                                                                                                                          |
| web `check:typescript` / `check:svelte` (658 files)                                                                                                           | PASS                                                                                                                                          |
| web eslint on the 212 files with findings                                                                                                                     | PASS; 11 plain-JS `.svelte` files hit the local `JavaScriptFile` parser crash (pre-existing, also after a clean install; CI is the authority) |
| e2e lint / check / prettier, cli lint                                                                                                                         | PASS                                                                                                                                          |
| server unit                                                                                                                                                   | 7052 passed                                                                                                                                   |
| web unit                                                                                                                                                      | 6723 passed                                                                                                                                   |
| `tools/upstream-preflight`                                                                                                                                    | 305 passed                                                                                                                                    |
| i18n merge test + `--check`                                                                                                                                   | PASS                                                                                                                                          |
| medium: access + RBAC oracles, view (both specs), duplicate, database-migration, split-shared-person-groups, sync-shared-space-stack, sync-person-group-split | PASS                                                                                                                                          |
| `mise sql` against a migrated database; `mise run open-api`                                                                                                   | regenerated and committed                                                                                                                     |
| post-rebase audit, fork-patches, ci-invariants, mobile-drift, autolink                                                                                        | PASS (audit after the manifest line and the SQL regeneration)                                                                                 |
| zero-conflict detectors (literals, branding gap, retired dirs, Shape Y)                                                                                       | nothing found                                                                                                                                 |
| mobile codegen / `dart analyze --fatal-infos` / format / full `flutter test`                                                                                  | PASS (3892 passed)                                                                                                                            |

## Traps hit this cycle

- `eslint --fix --rule '{"X":"off"}'` removes existing `eslint-disable` comments for X as unused (see above).
- An `eslint --fix src` over the server lints `.tsx` too, which `pnpm lint` (`src/**/*.ts`) never does: it rewrote
  upstream's email templates. Use the package's own lint globs.
- Mobile tasks: last cycle's `MISE_DISABLE_TOOLS` + PATH trick now makes things worse. Inside a mise task
  `/opt/homebrew/bin/dart` (Homebrew Flutter 3.44, Dart 3.12) wins, and the Rust native core's hook needs Dart 3.13
  ("language version 3.13 … too high"). Plain mise with `/opt/homebrew/bin` removed from PATH resolves 3.47.2.
- `.dart_tool/hooks_runner` again had to be cleared after the SDK switch (`objective_c` hook, reserved exit 253).
- The first `tsc` ran before the fork sync, so #1244's import of the deleted `src/utils/set.js` surfaced only in the
  next `pnpm build`. Re-run the type gate after every fork sync.

## Follow-ups

- Mobile person timeline: decide whether the fork route takes upstream's album arm too.
- Drop `resolveGroup`'s `ownedKeepIds` check (unreachable after immich-32603).
- `favorite-grep-gate.spec.ts`: skip block comments the way the scope guard now does.
- Carried over: ML v2 pet-model FIND check before landing; Spaces TanStack port.

## Remote CI

Round 1 on `694742eb138` (dispatched in two waves; revert gate with `gallery_image=…:rolling-v34-rc5` and
`upstream_image=immich-server:commit-e51de38c40a…`):

| Workflow                        | Result  | Notes                                                                                                                                                   |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static Code Analysis            | GREEN   |                                                                                                                                                         |
| Gallery ML Smoke                | GREEN   |                                                                                                                                                         |
| Gallery Rebase Smoke            | GREEN   |                                                                                                                                                         |
| Gallery Mobile Smoke            | GREEN   |                                                                                                                                                         |
| Storage Migration E2E           | GREEN   |                                                                                                                                                         |
| Release Candidate Build         | GREEN   | `gallery-server:rolling-v34-rc5` (+ ML)                                                                                                                 |
| Gallery Revert-to-Immich Valid. | GREEN   | on the branch's RC, stock round trip on upstream `e51de38c40a`                                                                                          |
| Test                            | RED     | search-contract fixtures (#1244, also red on `main`); fork e2e pinning the old folder-view 500; `sync-partner` order flake (upstream spec, 5/5 locally) |
| Storage Migration Tests         | RED ×2  | `delete-source-false`: `fetch failed / other side closed` on the first GET after ~6 s of `execSync` docker checks                                       |
| Gallery Build Mobile            | RED     | iOS job never got a macOS runner ("not acquired … capacity"); Android green. Re-run                                                                     |
| Docker                          | pending |                                                                                                                                                         |

Storage: the server log shows no error; the full CI phase sequence passes locally. The phase verifies disk files
through `docker compose exec` (`execSync`) for ~6 s, past the server's 5 s keep-alive, with the event loop blocked,
so the next `fetch` reuses a socket the server already closed. `main`'s passing run had a 5.47 s gap. The test now
retries a GET once on `UND_ERR_SOCKET` (`85044be5f0e`).

Round 2 on `85044be5f0e`: Storage Migration Tests GREEN, Docker GREEN (`694742eb138`, the round-2 commits only
touch tests). Test: Medium GREEN (the `sync-partner` flake did not recur), folder-view e2e GREEN; the search
contract still failed on `featureLevel` (immich-32791). The contract check stops at the first mismatching fixture,
so the fixtures were re-recorded against an e2e stack built from this branch (`SEARCH_CONTRACT_RECORD=1`): only
the three server-version fixtures changed (`bd500d562fa`); the hand-written server-features edit matched the
recording. iOS: no macOS runner on two attempts (GitHub capacity), re-dispatched.

Round 3: _pending_
