# Upstream Sync Report — 2026-06-18 (batches 272–273 / 9 upstream + 2 fork)

Third sync of the day, on top of `2026-06-18-upstream-sync-batch-270-272.md`. (The batch numbers re-slice when the target moves — the substance is the 9-commit upstream range `53fe26593c..9a5e7a8e47` + 2 fork commits.)

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`)
- **Fork commits synced**: 2 — #711 `c7a7a41c` (album map pins) + #710 `679acdd6` (face-picker access). **Hand-resolved** (see below): `upstream-sync-fork-main` threw on a #711 conflict.
- **Upstream commits pulled** (`53fe26593c..9a5e7a8e47`): 9
- **Conflicts resolved**: 3 — `pnpm-lock.yaml` (regen), `app_life_cycle.provider.dart` (mobile lifecycle), `Timeline.svelte` (keyboard refactor × fork grouping)
- **Post-rebase fixes**: 1 — `pnpm-lock.yaml` regeneration (`2d5c225b`)
- **New migrations**: 0 — Gallery migration count steady at **33**, mobile Drift unchanged
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED — local gate green (server + web unit tests; `tsc`/`svelte-check`; SDK build; structural audits; lockfile regen + faker verified stable); remote CI pending dispatch.

> **Scope note:** held rolling branch — not pushed to `main`, no `branding.upstream.version` bump (stays `v2.7.5`). No OpenAPI regen (no spec change this batch).

## Fork sync — hand-resolved (deviation noted)

`make upstream-sync-fork-main` **threw** while cherry-picking #711 (`c7a7a41c`) — conflict in `server/src/services/album.service.ts` (an import block). Per the skill's documented fallback, I resolved by hand:

1. **#711 import conflict**: batch-267's upstream #28884 had changed `album.service.ts`'s date import to `asDateTimeString` on the rolling branch; #711 (based on origin/main) dropped `getMyPartnerIds` from the `asset.util` import (it removed that usage). Kept **both** deltas — `import { addAssets, removeAssets }` + `import { asDateTimeString }` (verified 0 remaining `getMyPartnerIds` usages). Continued the cherry-pick.
2. Cherry-picked **#710** (`679acdd6`) on top — clean auto-merge.
3. **Manually advanced** `integratedForkHead` 37224e0b → `679acdd6` + recorded an `appendHistory` entry noting the hand-resolve. `rolling-status` confirms `Fork commits pending: 0`.

| SHA (orig) | PR   | Area                   | Outcome                                                                 |
| ---------- | ---- | ---------------------- | ----------------------------------------------------------------------- |
| `c7a7a41c` | #711 | server (album/map)     | hand-resolved import conflict (asDateTimeString + drop getMyPartnerIds) |
| `679acdd6` | #710 | server (person/access) | clean                                                                   |

## Upstream commits (9)

| SHA        | PR     | Area        | Risk    | Outcome                                                                                                                          |
| ---------- | ------ | ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `735f52a3` | #29130 | deps        | MED     | typescript-projects + opentelemetry bumps; **`server`/root `package.json` auto-merged** with fork S3 deps; lockfile regenerated. |
| `6d73bf4e` | #29181 | web         | MED     | move keyboard state into `keyboardManager` store; **reverts #29022's onClick `event` param**. Conflicted at fork #625 (C3).      |
| `c07cbe7c` | #29183 | deps        | LOW-MED | multer → v2.2.0 [security]; lockfile + `@types/multer@2.1.0`; server `tsc` clean.                                                |
| `f3cb3cf9` | #29195 | deps        | LOW-MED | nodemailer → v9 [security]; lockfile + `@types/nodemailer@8.0.0`; server `tsc` clean.                                            |
| `769c4015` | #29054 | mobile      | LOW     | dup login on share-intent warm start (clean)                                                                                     |
| `793487e5` | #28983 | mobile      | LOW-MED | refresh memories on resume — conflicted at fork #513 (C2)                                                                        |
| `c35abb2f` | #29089 | mobile      | LOW     | re-lock locked folder on background (clean)                                                                                      |
| `62c6bb27` | #29196 | plugin-core | LOW     | workflow asset-type-filter required (clean)                                                                                      |
| `9a5e7a8e` | #28994 | mobile      | LOW     | endless spinner on empty album selection (clean)                                                                                 |

## Conflict resolutions

### C1 — `pnpm-lock.yaml` (at squash base)

Fork S3 deps vs upstream's typescript/opentelemetry/multer/nodemailer bumps. `server/package.json` + root `package.json` **auto-merged** (kept both). Took `--theirs` to unblock, then `pnpm install --no-frozen-lockfile` regenerated authoritatively (+57/−54). **Faker verified stable**: pre/post-install identical, e2e's `^10.3.0` stayed resolved at **10.3.0** (seed-42-stable) — no drift, no pin needed. Committed `2d5c225b`.

### C2 — `mobile/lib/providers/app_life_cycle.provider.dart` (at fork #513)

#28983 added `_ref.invalidate(driftMemoryFutureProvider)` (refresh memories on resume) into the old sequential-sync block; fork #513 had restructured resume into `syncRemoteThenLocal(...)` (deferred local sync). Kept fork's #513 restructure **and grafted** upstream's memory-invalidate right after `await sync.remoteSync` (semantic equivalent — refresh memories as soon as remote sync completes). Import already present.

### C3 — `web/src/lib/components/timeline/Timeline.svelte` (at fork #625)

#29181 moved shift-key state into a `keyboardManager` store and **reverted #29022's onClick `event` param** (no longer needed — shift read from the store). All of that applied cleanly except the thumbnail-snippet region, which overlaps fork #625's grouping restructure. Kept fork's #625 `<Skeleton>` + `{:else if isInOrNearViewport}` + `<Month customThumbnailLayout singleSelect onTimelineDaySelect>` block **but dropped the `event` param** from its onClick (the new base's `onThumbnailClick` type no longer accepts it). This is the **inverse** of batch 266-267's resolution (which added the event param). `GalleryViewer.svelte` auto-merged. Verified by `tsc` + `svelte-check`.

## Audits & local verification

| Check                                       | Status | Notes                                                                               |
| ------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| postrebase-audit (273)                      | GREEN  | fork files/symbols, 33 migrations, no collisions, Generated-Artifact-Review OK      |
| ci-invariants / fork-patches / mobile-drift | GREEN  | no PUSH_O_MATIC; gallery images; docs-deploy disabled; @immich/ui; Drift consistent |
| svelte.config.js fork resolution            | INTACT | fork's omit-`version.name` block                                                    |
| pnpm-lock regen + faker                     | DONE   | regenerated for dep bumps; faker stable at 10.3.0 (no drift)                        |
| SDK build (`tsc`)                           | PASS   | —                                                                                   |
| Server `check` (`tsc`)                      | PASS   | nodemailer v9 / multer / ts bumps + fork-sync (#710/#711) all compile               |
| Web `check:typescript` / `check:svelte`     | PASS   | tsc clean; svelte-check 0 errors / 0 warnings (Timeline keyboard reconciliation)    |
| Server unit tests                           | GREEN  | 4672 passed, 9 skipped, 0 failed (141 files; +13 from #710/#711 specs)              |
| Web unit tests                              | GREEN  | 3166 passed, 2 skipped, 8 todo, 0 failed (239 files)                                |

## Remote CI verification

_Pending dispatch on `rebase/upstream-batch-273`. To record after green._

## Post-rebase state

- Upstream base: `9a5e7a8e47` (`53fe26593c..9a5e7a8e47`); fork commits ahead: **782**; behind: **0**.
- `integratedForkHead`: `679acdd6` (manually advanced); `upstreamTargetHead`: `9a5e7a8e47`.
- Tip `2d5c225b` (lock regen) → `4b9bff66` (#710) → `d97bfd30` (#711) → prior history.
- Canonical `rebase/upstream-rolling-20260509-active` to be updated to the rebased tip; not pushed to `main` (held for v3 cutover).
