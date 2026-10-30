# Upstream Sync Report — 2026-10-30 (v3.4 rolling → v3.4.0-rc.0)

## Summary

- **Upstream**: Immich tagged `v3.4.0-rc.0` (`81778c8c4a9`) on 2026-10-29 and cut `release/v3.4` from it.
  The rolling branch now tracks **`upstream/release/v3.4`** (`docs/fork/ownership.yml`
  `upstream_branch`, rolling state `upstreamRef`), per the standing "RC content only" policy. The two
  `upstream/main` commits past rc.0 (`4bdc4480b27` VAAPI nv12, `fc30140e6ec` upstream `CLAUDE.md`) are
  deliberately **not** pulled (Pierre).
- **Upstream commits pulled**: 16 (`e51de38c40a..81778c8c4a9`), batches 173–184.
- **Fork sync**: `main` → `390b52a3ef6` (#1252); the pick was empty, since rolling already carried the same
  fix (`44ba44657a4`). `integratedForkHead` advanced by hand.
- **Base**: `branding/config.json` `upstream.version` → `3.4.0-rc.0` (with AGENTS.md, README, two guides).
- **Product gate**: fired on immich-32268 (FUTO Backups). Pierre chose **take it dormant**.
- **Risk**: MEDIUM. **Recommendation**: PROCEED to remote CI.
- Backup of the pre-cycle tip: `backup/rolling-v34-pre-rc0-1030` (`c590dd2f0bd`).

## Upstream changes

| SHA | Summary | Area | Risk | Notes |
| --- | --- | --- | --- | --- |
| `2e0eb35e93d` | OCR extraction workflow filter (immich-32464) | server, plugins | MEDIUM | `getForAssetV1(assetId, trigger)`; fork #763 favorites test + fork `workflow.service.spec` trigger list updated |
| `257090aaaed` | onnxruntime 1.31.0 | ML | LOW | uv.lock only; ML gates green |
| `d31befb8514` | drop star-history from 16 translated READMEs | docs | LOW | fork #940 already drops the whole tail |
| `cb2ea1e308d` | `getCameraName` avoids duplicate maker (immich-32657) | web, mobile | LOW | merged into the fork's contextual camera filter |
| `d5918c00420` | `@immich/ui` 0.91.1 | web | MEDIUM | fork patch re-keyed, applies unchanged |
| `a56303f393e`, `a0c5b32fb8b` | base-image bumps | docker | LOW | Shape H check NOT run (Docker Desktop down); CI `docker.yml` covers it |
| `323e750eb50` | remove isar reference | mobile | LOW | clean |
| `56ed326acda` | mobile OCR delete by asset | mobile | LOW | test merged with fork #749/#752 blocks |
| `be8e4252670` | mobile context search after features load (immich-31800) | mobile | LOW | page is fork-deleted (#654/#758); upstream's new `search_page_test.dart` removed |
| `0808f24a37c` | oauth claim validation to zod (immich-32373) | server | MEDIUM | `profile` → `rawProfile`; fork S3 profile-picture tests followed |
| `aeee9be333f` | "f" favorites shortcut in multi-select (immich-31411) | web | **HIGH** | per-user favorites, see below |
| `5583cd7857a` | normalized face-box matching (immich-32486) | server (replay-owned) | MEDIUM | replayed by hand into the fork's `person.service.ts`, see below |
| `97af09ca3cb` | pigz database backups (immich-32806) | server | MEDIUM | merged with fork #1226 S3 backup store |
| `177b57b689b` | **FUTO Backups** (immich-32268) | server, web, docker | **HIGH** | product gate, see below |
| `2c3fc559ef0` | translations | i18n | LOW | `i18n/*.json` verbatim; two zh_Hant overlay entries now upstream |
| `81778c8c4a9` | version v3.4.0-rc.0 | all | MEDIUM | carried `release/v3.3` version commits dropped, see below |

No upstream migrations, no Drift schema change, no FK-registry key touched.

## FUTO Backups (immich-32268) — product gate, taken dormant

A restic-based backup integration with FUTO's paid service ("Product keys do not include FUTO Backups"):
`@futo-org/backups-orchestrator-api` (server) and `-ui` (web), `restic` + `restic-proxy` copied into the
server image from `ghcr.io/futo-org`, admin `/admin/backups` pages, a sidebar reminder, a maintenance
`rollback` action, and the OpenAPI `/futo-backups/*` routes. The UI and reminder show only when
`backup.beta` is set (off by default); package, controllers and binaries ship regardless.

Taken as upstream wrote it (rule 4). Known gaps, deliberately not addressed while dormant:

- It backs up the on-disk media location and libraries only. **Assets on Gallery's S3 backend are not
  covered.**
- Its `createDatabaseBackup` hook gets back what the fork's method returns, a **filename** in the backup
  store (#1226), where upstream returns a disk path. The `signal` it passes is honoured.
- The maintenance worker hard-codes `externalBaseUrl: 'https://my.immich.app'`. Left as upstream:
  `my.immich.app` is a shielded identifier the fork already keeps verbatim (`getExternalDomain`, passkeys).
- The Gallery Dockerfile still skips `mise install`, so mise's new `restic` tool is unused; the image
  gets restic from the COPY lines.

Turning it on in Gallery is a separate decision.

## Favorites shortcut (immich-31411)

Upstream moved the selection-bar favorite logic into `toggleFavoriteAssets` (`web/src/lib/services/asset.service.ts`)
and added an "f" shortcut that favorites only **owned** selected assets via `updateAssets({ isFavorite })`.
Gallery favorites are per user (#763): the button favorites the **whole** selection through
`updateAssetFavorites`, which space viewers (who lack `AssetUpdate`) can use. Resolution: keep upstream's
helper, with a one-line hook so it calls `updateAssetFavorites`. `FavoriteAction` and the shortcut both pass
`assetMultiSelectManager.assets`, so button and shortcut behave the same.

## Face matching (immich-32486) — replay-owned `person.service.ts`

Fork #601 had fixed the same scaling bug differently (scale the new box into each face's frame).
Upstream's normalization gives the same IoU and adds "prefer metadata faces over ML duplicates". Upstream's
form taken, keeping the fork's #843 rule that a human box never matches a pet face (`!face.isPet` in the
filter). Upstream's two new tests are present and pass.

## Version commits

The branch carried upstream's `release/v3.3` version bumps (`v3.3.0-rc.1` … `v3.3.5`, added when `main`
moved to v3.3.5). On the rc.0 base they would set every version back to 3.3.x, so all eight were skipped
during the replay (pure version-string commits). The fork's own `mobile/pubspec.yaml` `1.0.0+1` and
`Info.plist` `3.0.0` stay.

## How the replay was driven

Per-batch `git rebase <tip>` (rerere off), stopping on every conflict. The scratch driver auto-continued
only through:

- generated files (`open-api` spec, SDK `fetch-client.ts`), resolved to the fork side and regenerated at
  the end;
- `i18n/*.json` hunks provably safe: empty-base union, per-line 3-way, upstream-only deletions, or sorted
  fork additions, each checked to still parse as JSON. For fork commits before #1182 only, the fork side.

At #1182, `i18n/*.json` was reset to upstream verbatim. Three locales (es, ru, zh_Hant) still came out
stale through auto-merge, and a reconcile commit restored them.

Other notable resolutions: `database-backup.service.ts` (pigz + `signal` threaded into the fork's store
pipeline), `server.service.ts` (cached config + upstream's `backup` destructure), `app.module.ts` /
`services/index.ts` (FUTO registrations beside fork lines; #1181 still moves fork services out), the library
medium spec's DI lists (fork `SharedSpaceRepository` + upstream `WebsocketRepository`), `PurchaseContent`
(fork's community CTA, upstream's product-key lines dropped).

## Zero-conflict breaks found after the replay

- `auth.service.spec.ts`: fork profile-picture tests mocked `getProfileAndOAuthSid` with `profile`
  (immich-32373 renamed it `rawProfile`), so the S3 branch saw `undefined`.
- `database-backup.service.spec.ts`: upstream's abort test asserts disk `unlink`/`rename`; adapted to the
  backup store's `.tmp` delete.
- `workflow.service.spec.ts` (fork-only): enumerates triggers; added `AssetOcrExtraction` (Shape J).
- SDK `Type2` → `Type5`: new anonymous enums renumbered the scoped person profile type that three fork web
  files imported. The fork DTO now names it `ScopedPersonProfileType`.
- `sync_stream_service_test.dart`: fork `ServerFeaturesDto` helper lacked the new required `backups`.
- Web: dead `goto` import after the keyboard-actions merge.
- Branding: two new strings naming Immich got overrides. Preflight M8 pin moved to `3.4.0-rc.0`.

## Revert script

With `upstream.version` 3.4.0-rc.0, three entries became stale (the tag ships them):
`1792511451454-AddPasskeyTable`, `1792517020180-AddUpdateIdIndexes`,
`1792568637987-AddAssetOwnerIdUpdateIdIndex`. Their ledger deletes and schema rollbacks were removed, and the
revert no longer strips `passkey.*` / `clusterGroup.admin` from API keys. The coverage job's script, run
locally against `v3.4.0-rc.0`, passes. **The `v3.4.0-rc.0` image is not on GHCR yet**: dispatch the gate with
`-f upstream_image=ghcr.io/immich-app/immich-server:commit-81778c8c4a9e015511af21eada4bbf829296580d`.

## Layering

Fork diff vs upstream, before → after, for the upstream files resolved this cycle: shrank in
`person.service.ts` (939→918), `DetailPanel.svelte` (390→383), `FavoriteAction.svelte` (6→2); grew in
`TimelineKeyboardActions.svelte` (3→5, shortcut scope), `asset.service.ts` (239→242, per-user favorites
hook), `openapi_patching.dart` (19→20, `backups` default). Everything else unchanged.
`i18n/*.json` identical to the tag; `merge.mjs --check` passes.

## Local verification

| Check | Result |
| --- | --- |
| server build, `tsc`, eslint, prettier | PASS |
| server unit | PASS (7071; the one failure, the trigger list, fixed) |
| web `tsc`, svelte-check (666 files), eslint (fresh install, tscompat off), prettier | PASS |
| web unit | 6730 pass, 1 fail: `global-search-manager` "clears stale status…", passes 3/3 alone, file unchanged this cycle |
| mobile codegen, `dart analyze --fatal-infos`, format, `flutter test` (3901) | PASS (pinned Flutter 3.47.2) |
| ML ruff format/check, mypy, pytest | PASS |
| preflight suite (305), overlay check + tests, autolink check, `.github` prettier | PASS |
| structural: zero-byte files, retired dirs, duplicate imports, unresolved mobile imports | clean |
| **medium tests (oracles, ledger, workflow, library), `mise sql`, base-image diff** | **NOT RUN**: Docker Desktop would not start; left to CI |

## Follow-ups

- Base-image Shape H check and SQL regeneration: confirm via `docker.yml` and SQL Schema Checks.
- FUTO Backups stays dormant; enabling it needs an S3 answer and the hook return-path question above.
- `global-search-manager` spec flake under full-suite load.
- Landing blocker unchanged: the ML v2 pet-model check.

## Remote CI

Pending.
