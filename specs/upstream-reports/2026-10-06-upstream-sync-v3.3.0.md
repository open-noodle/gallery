# Upstream Sync Report — 2026-10-06 (v3.3.0)

## Summary

- **Branch**: `rebase/upstream-rolling-v3.3.0` (tracks `upstream/release/v3.3`)
- **Upstream**: `d1c1a65ed3b` → **`e3b16560913`** = tag `v3.3.0` (12 commits, batches 84–90). 0 behind.
  The tag exists but is not yet a published release (no GitHub Release; `immich-server:v3.3.0` 404 on GHCR).
- **Fork sync**: none needed (`origin/main` = `integratedForkHead` = `84bc20b27bd`).
- **Backup**: local `backup/rolling-pre-2026-10-06-v330` (`2b232da81c9`).
- **Conflict stops**: 25 across the three conflicting batches (84, 86, 87); 88–90 replayed clean except the
  expected `mobile/pubspec.yaml` version line.
- **Product-direction gate**: fired on immich-32167 (memory sync V2). Decision: **adopt V2 under the fork's
  memory type policy** (maintainer, 2026-10-06).
- **Risk**: MEDIUM. **Recommendation**: PROCEED (CI below).
- `branding/config.json` `upstream.version` stays `3.2.4`: bumping it needs the published image and a
  `revert-to-immich.sql` prune, so it belongs to the cutover.

## Incoming Upstream Changes

| SHA           | Summary                                          | Area           | Risk to Fork | Outcome                                                                                                                                     |
| ------------- | ------------------------------------------------ | -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `d806bc002ce` | person without assets (immich-32117)             | server         | MED          | **Dropped on the fork side** — `getAllForUser`/`getNumberOfPeople` stay Gallery's (person-sharing standing rule); fork's version already inner-joins. |
| `8ebb3ef4ece` | PP-OCRv6 models                                  | ML, web        | LOW          | Taken verbatim.                                                                                                                             |
| `5e223fbb074` | allow translation backports                      | CI             | LOW          | Taken verbatim.                                                                                                                             |
| `86cc439e17a` | translations                                     | i18n           | LOW–MED      | Key-level merge into the fork's locales; 2 collisions resolved to upstream's wording (see below).                                            |
| `3eec2515969` | Escape on person name editor                     | web            | LOW          | Applied onto the fork's re-indented person page.                                                                                            |
| `bc87d064de8` | milder birthday memory text                      | web            | LOW          | Merged into the fork's subtitle wrapper in `MemoryCard.svelte`.                                                                             |
| `62bcb0601f9` | birthday memory on mobile (immich-32165)         | mobile         | MED          | Adopted; fork `rule` titles routed through upstream's switch (fork commit).                                                                  |
| `1aede8d8c3e` | memory upcoming query (immich-32166)             | server         | LOW          | Taken; same fix propagated to the fork's #486 default (fork commit).                                                                        |
| `ed3073624b5` | memories mobile sync for older clients (immich-32167) | sync contract | **HIGH**   | **Gate fired.** Adopted with the fork's type policy (fork commits).                                                                          |
| `c5343f3f351` | Intel Arc (alchemist/battlemage) ML fix          | ML deps        | MED          | Taken verbatim — pins `openvino==2026.5.0.dev20261005` from the OpenVINO **nightly** index.                                                  |
| `3ab7124506c` | face name label above box                        | web            | LOW          | Taken verbatim.                                                                                                                             |
| `e3b16560913` | chore: version v3.3.0                            | versions       | LOW          | Taken; mobile `pubspec.yaml` keeps the fork's `1.0.0+1`.                                                                                     |

### High-risk: immich-32167 (memory sync V2)

Upstream narrows `MemoriesV1` and its photo links to `on_this_day` and adds `MemoriesV2` /
`MemoryToAssetsV2` carrying every type; mobile picks V2 when `serverVersion >= 3.3.0`. On Gallery this
would have broken three things:

1. **Zero-conflict break** — `syncMemoryAssetsV1` merged **cleanly** onto upstream's `on_this_day`-only
   `getUpsertsV1`, so every installed Gallery app (V1 client, receives rule memories via #1013) would lose
   its rule memories' photos. Confirmed in the replayed tree before the fix.
2. A stock Immich 3.3+ app requests V2 from a Gallery server (5.x clears the 3.3.0 gate); V2 would send it
   `rule` rows it cannot decode — whole-sync abort, the #999 class — and `birthday` rows.
3. A Gallery app built from this branch requests V2 by version, so against released Gallery servers
   (≤ 5.7.1, no V2) the whole `/sync/stream` would 400.

**Pre-existing on rolling since 2026-09-20** (not this batch): item 3 already applied to `AuthUsersV2` and
`AssetFacesV3` — `main`/v5.7.1 knows neither type, and release builds stamp the 5.x version — so an app
built from rolling could not sync with any released Gallery server.

Resolution (decision record: `specs/2026-09-24-birthday-memories-upstream-coexistence-design.md`,
2026-10-06 section):

- Server: one `syncedMemoryTypes(isForkAwareClient)` policy for memories V1/V2 and links V1/V2
  (`on_this_day` + `rule` for Gallery apps, `on_this_day` alone otherwise, `birthday` never); links via
  new `MemoryToAssetSync.getUpsertsForTypes`; `MemoryTypeV1` = `on_this_day | rule`; V2 streams kept after
  the asset-bearing streams (#1033 invariant extended).
- Mobile: `AuthUsersV2`, `MemoriesV2`, `MemoryToAssetsV2`, `AssetFacesV3` requested only when
  `GET /server/features` declares them.

## Conflict Resolutions

Method this cycle, all mechanical and proven:

- **Replayed file + upstream delta** for files the fork owns end to end, where the upstream commit was the
  only upstream change since the old base: write `REBASE_HEAD:<file>`, apply the upstream commit's hunks
  at fuzz 0 (or an exact-once transform), and assert the resulting `+/-` multiset equals upstream's own.
  Used for the person repository/service/specs (drop d806), `sync_stream.repository.dart` (four stops,
  #313/#749/revert/#752), `sync_stream_service_test.dart`, and the person page Escape fix.
- **Key-level i18n merge** (`REBASE_HEAD` locale + upstream's key delta; sorted objects stay sorted,
  unsorted ones follow upstream's neighbour). Proven byte-identical to git's own merge on all ten
  locales before use. Stops: #697, #824, #843, #851, #1151.
- **Region picks / import unions** for the rest, each gated on the resolver's exit code.

| File(s)                                                | Stop(s)                  | Resolution                                                                                         | Risk |
| ------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------- | ---- |
| person repo/service/specs/e2e/sql (7 files)            | #495, #542               | Fork lineage; d806 dropped (standing rule). End state byte-identical to the pre-cycle tip.           | LOW  |
| `mobile/.../memory.model.dart`                         | #418                     | Fork raw-map `MemoryData`; `personName` getter added in the integration commit.                     | LOW  |
| `memory.page.dart`, `memory_lane.widget.dart`          | #418                     | Upstream's refactored call sites; fork helpers left until #1045 removed them.                       | LOW  |
| `memory_bottom_info.widget.dart`                       | #643, #886, #929, #1056  | Upstream's `(memory, asset)` API + layout, fork's view-in-timeline navigation (#929/#1047).          | MED  |
| `MemoryCard.svelte`                                    | fork 2183b81ef2f         | Fork's subtitle wrapper + upstream's layered cake icon / wrapping title.                            | LOW  |
| `infrastructure/repositories/memory.repository.dart`   | fork bbc420a3656         | Upstream's unfiltered local query; fork test narrowed to "rule memories stay on the lane".          | LOW  |
| `server/.../memory.repository.ts`                      | #749, revert, #752, #1060, #819 | Import unions (`asLocalTime` + fork imports).                                               | LOW  |
| `mobile/test/medium/repository_context.dart`           | fork d12bea0b435         | Fork raw-map form + upstream's `personName`.                                                        | LOW  |
| `server/src/services/sync.service.ts`                  | #1013, #1033             | Fork V1 policy + upstream's V2 methods; all memory streams moved last (V2 included).               | MED  |
| `mobile/pubspec.yaml`                                  | #121                     | Fork's `1.0.0+1`.                                                                                  | LOW  |

**i18n collisions** (fork had translated an upstream key first): `ru.manage_people` (#851) and
`zh_Hant.reset_sqlite_error_hint` (#1151 backport). Both are upstream keys → upstream's v3.3 wording
(fork commit).

## Fork commits added this cycle

- `chore(fork)`: list #819/#1158 migrations in `docs/fork/ownership.yml` (audit expected 68, found 71).
- `fix(mobile)`: title rule memories through upstream's memory title widget (immich-32165).
- `fix(i18n)`: upstream's v3.3 wording for the two collided keys.
- `fix(server)`: the #486 "already shown" default uses `asLocalTime(now)` like upstream's isUpcoming fix
  (unit test proven red without it).
- `fix(server)`: Gallery's memory sync policy on MemoriesV2 and links (4 unit tests proven red without it).
- `fix(mobile)`: 3.3-era sync request types only behind the server declaration.
- `chore`: regenerated OpenAPI (`MemoryTypeV1` + `rule`), SDK, `sync.repository.sql` (one new block).

## Fork Feature Verification

| Feature                   | Status | Notes                                                                                   |
| ------------------------- | ------ | --------------------------------------------------------------------------------------- |
| Shared Spaces / sync      | OK     | Memory streams stay after Space/library/album asset streams (#1033), now for V2 too.     |
| Memories (rules, #1045)   | OK     | Rule titles via upstream's switch; birthday rows still withheld server-side.              |
| People / person sharing   | OK     | Gallery repository unchanged; `person-sharing-dormant` invariant green.                   |
| Search V3                 | OK     | `search-v3-not-dispatched` green.                                                        |
| Pet detection / ML        | OK     | PP-OCRv6 + OpenVINO bump in upstream-owned files only.                                   |
| Branding                  | OK     | No literal-noop risk; no new upstream-name i18n key.                                      |

## Database Migrations

No new upstream server migrations, no Drift schema change (`mobile-drift-rebase-check` OK). Gallery
migration count 71, manifest now complete.

## Inconsistencies Found

- Zero-conflict break in `syncMemoryAssetsV1` (above) — fixed.
- Pre-existing: version-gated 3.3-era mobile sync types vs Gallery's 5.x versioning — fixed.
- Upstream's isUpcoming fix not reaching the fork's sibling #486 predicate — propagated.
- `docs/fork/ownership.yml` missing three gallery migrations — fixed on rolling; **`main` has the same gap**.

## Local Verification

| Check                                                     | Status                                          |
| --------------------------------------------------------- | ----------------------------------------------- |
| post-rebase audit (batches 84–90), invariants (10), patches, drift, autolink | PASS                         |
| per-file delta audit vs upstream (every batch)            | PASS — every DIFFERS is an intended integration  |
| `server pnpm build` / `pnpm check` / `pnpm lint`          | PASS                                            |
| server unit tests                                         | PASS — 6606 passed                              |
| medium: sync-memory, sync-memory-asset, memory repo/service | PASS — 103 passed                             |
| web `check:typescript` / `check:svelte` (643 files)       | PASS                                            |
| OpenAPI / SDK / SQL regeneration                          | done, committed                                 |
| web lint + unit, mobile, ML, e2e suites                   | left to CI (maintainer's call)                  |

## Remote CI

Pending — dispatched against the branch tip after push.
