# Upstream Sync Report — 2026-09-24

## Summary

- **Cycle**: rolling, still targeting the next upstream release (expected **v3.3.0**, not yet tagged)
- **Branch**: `rebase/upstream-rolling-v3.3.0`, continuing from the 2026-09-20 cycle
- **Upstream base**: `202015ed95d` → **`e598e108966`** (level with `upstream/main`)
- **Upstream commits pulled**: **27**, in 16 batches (plan batches 18–33)
- **Fork commits synced from `main`**: #1123 (public-facing text pass), #1132 (release-notes CI)
- **Conflicts resolved**: ~60 logged resolutions (the notable ones are below)
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED. The branch stays off `main` because there is no upstream tag yet.
- **CI**: see [CI results](#ci-results)

**Character of the cycle: one product decision, then web and mobile refactor fallout.** The
product gate fired once, on upstream's birthday memories. It was brainstormed, specced and
implemented before the rebase passed that commit. The rest of the cycle was upstream reorganising
code the fork builds on:

- the web action/context-menu layer, rebuilt on the `@immich/ui` menus;
- the stack actions, moved into a service;
- the mobile tag and user-metadata stores, moved onto `Store`;
- a mobile dead-code sweep that now runs as a CI gate.

## Product-Direction Gate

### Birthday memories (`d6d09473836`, immich-30831) — **fork generator kept, upstream's dormant**

Upstream added `MemoryType.Birthday` and a generator. The fork has shipped a birthday memory since
#418, as a rule: `type='rule'` with `ruleId='birthday'`, from `memory-rules/birthday.rule.ts`.

Two things made the fork's version the one to keep:

- **Mobile enum collision.** Mobile's `MemoryTypeEnum` is persisted by index. Upstream put
  `birthday` at index 1, the slot the fork's `rule` has occupied since #418.
- **Space coverage.** Neither generator includes photos shared through a Space. The fork's rule
  pipeline is the one that can be extended to them.

The maintainer chose to **stick to the fork's generator (minimal)**. The design is in
`specs/2026-09-24-birthday-memories-upstream-coexistence-design.md`. Summary:

- `MemoryType.Birthday` is adopted for type and API parity. Upstream's `createBirthdayMemories` is
  kept but **never dispatched**. The invariant `birthday-memory-generator-not-dispatched` pins this,
  and a medium test proves it red with a probe dispatch.
- Birthday rows are withheld from:
  - `GET /memories` and statistics (`accessibleSearchBuilder`);
  - overlap reconcile (`isMemoryTypeVisible`);
  - the sync stream (`syncMemoriesV1`, for every client). Deletes still stream.
- Creating a birthday memory through the API requires `personId` and `personName` (`superRefine`).
- Mobile gets `MemoryTypeEnum { onThisDay, rule, birthday }`, with `birthday` appended so persisted
  indices do not move. The invariant `mobile-memory-type-enum-order` pins the order. Both
  exhaustive switches handle `birthday`. The offline memory lane queries `isInValues([onThisDay, rule])`.
- No break between mobile and server. Old apps never receive a birthday row, so they cannot
  mis-decode index 2. New apps still work against older Gallery servers.

The whole-branch review of the birthday work ran on a fresh reviewer. Its rulings and deferred
minors are listed under [Follow-up work](#follow-up-work).

## Incoming Upstream Changes

| SHA           | Summary                                                    | Area        | Risk     | Notes                                                                 |
| ------------- | ---------------------------------------------------------- | ----------- | -------- | --------------------------------------------------------------------- |
| `d6d09473836` | feat: birthday memories                                    | server, all | **HIGH** | Product gate. See above.                                              |
| `91247f14923` | migrate OCR, Tag and UserMetadata to Store                 | mobile      | **HIGH** | Deletes 4 files that fork photos-filter code depends on.              |
| `a9ce155cf84` | web actions + ui-lib context menu                          | web         | **HIGH** | Deleted handlers the fork's people menu calls (non-conflict).         |
| `1aedf1b41ca` | ui-lib context menu for the albums page                    | web         | MEDIUM   | Moved album Edit gating. #990's editor rule carried over.             |
| `5689b0c8f64` | stack service and actions                                  | web         | MEDIUM   | 12 fork pages/panels touched.                                         |
| `a4104368d32` | storage template onboarding                                | web         | MEDIUM   | Imports panels from a path the fork had moved them away from.         |
| `2ccd0effc8d` | enable mobile dead-code CI                                 | mobile      | MEDIUM   | New DCM gate. 76 fork findings, plus deletions of code the fork used. |
| `a4af86282d1` | resume after a background launch                           | mobile      | MEDIUM   | Ported onto the fork's #513 `syncRemoteThenLocal`.                    |
| `da5c2fedbee` | save `user_version` in the migration transaction           | mobile      | MEDIUM   | `database.dart`. Merged 3-way onto the fork tip.                      |
| `3e2e8e0fe8a` | retry background backup on reconnect                       | mobile      | MEDIUM   | Replay dropped #892's removals. Caught and fixed.                     |
| `20862f1d4a1` | refresh people after setting a person thumbnail            | web         | MEDIUM   | Removes the handler a fork spec tested.                               |
| `d7bd9613999` | `@immich/ui` 0.90.0                                        | web         | MEDIUM   | Fork patch re-created. `ActionItem.onAction` signature changed.       |
| `e66f2c7615b` | eslint-plugin-unicorn v75                                  | tooling     | MEDIUM   | 37 server fork violations, plus fork web code.                        |
| `959d46c6547` | `@types/node` ^24.13.5                                     | tooling     | LOW      | Fork's preflight tool range bumped to dedupe.                         |
| 13 others     | dependency bumps, docs, small mobile/web/server fixes      | mixed       | LOW      | No fork interaction beyond the conflicts logged below.                |

No new upstream server migrations. No new Drift schema version, since `da5c2fedbee` changes
transaction handling only. `upstream.version` stays at 3.2.2.

## Conflict Resolutions

Resolved per commit during the replay. The notable regions:

### Birthday batch (19)

- **`memory.dto.ts`** — took the fork commit's whole file. **Non-conflict trap:** upstream's
  object-shaped `MemoryDataSchema` sat outside the markers and would have redeclared the fork's
  record schema.
- **`memory.service.ts`** (at #418, #455, #707, #789 and #1059) — every replay kept both sets of
  methods, with the dispatch left out. **Non-conflict trap:** upstream's
  `this.createBirthdayMemories(...)` dispatch auto-merged outside the markers and was reverted.
- **`enum.ts` / `types.ts` / `memory.model.dart` / `sync_stream.repository.dart`** — union of both
  sides. `rule` keeps index 1.
- **Web `getMemoryTitle`** — upstream's Birthday branch was re-homed into
  `$lib/utils/memory-card.ts`, where #1045 had moved the function.

### Batch 22: mobile Store migration (immich-31704)

Upstream deleted `tags_api.repository.dart`, `tag.service.dart`, `tag.provider.dart` and
`user_metadata.provider.dart`. The fork's photos-filter tag picker, the people provider and their
tests all depend on them.

- Accepted the deletions.
- Ported the fork callers onto `Store.tags.all()` / `Store.userMetadata.preferences()`.
- Rewrote the test fakes as overrides.
- Made upstream's new `TagApiRepository` lazy (it takes `ApiService`), carrying #369's
  lazy-resolution pattern.

### Batch 23: web action/menu/stack refactors

- **`people/+page.svelte`** — **non-conflict trap**: immich-31729 deleted
  `handleHidePerson` / `handleToggleFavorite` in a clean hunk, while the fork's `ButtonContextMenu`
  still calls them. Restored both.
- **Album Edit gating** — immich-31725 moved the album menu into `getAlbumActions` with Edit gated on
  `isOwned`. #990 had widened Edit to editors, so Edit now uses `isAlbumEditor(album, user.id)`.
- **Photos / recently-added pages** — upstream's new `StackActions` wrapped in the fork's
  `{#if !showSearchResults}` guard. **`MapTimelinePanel`** — upstream's `withStacked: true` spread
  onto the fork's `buildMapTimelineOptions`.
- **`StorageTemplateSettings` + `Supported*Panel`s** — the fork had moved them under
  `routes/admin/system-settings/`. Upstream's new `StorageTemplateVariablesModal` imports them from
  `$lib/components/admin-settings/`, so they moved back to upstream's location.
- **Lockfile** — took the fork's side during the replay and regenerated once after the batch with
  `injectWorkspacePackages` guarded: 0 `file:` and 11 `link:` entries, frozen install green.

### Batches 25–33

- **`background_worker.service.dart` (b25)** — the fork tip equals upstream's pre-batch file.
  Resolving every conflict to ours was **wrong at #892**, whose own delta removed lines. The
  end-state assertion caught it, and the file was set to upstream's post-batch version.
- **`asset-viewer-space-context.spec.ts` (b25)** — deleted. It only asserted the
  `SET_PERSON_FEATURED_PHOTO` handler that immich-31744 removed.
- **`database.dart` (b26)** — replayed snapshots regress the file relative to their parents. Took
  theirs during the replay, then set the tip to a 3-way merge of `da5c2fedbee` onto the fork's file.
  826 Drift migration tests pass.
- **`@immich/ui` 0.90.0 (b27)** — the 0.86.0 patch was retired and re-created with `pnpm patch`.
  `ownership.yml` `expected_patch` was updated. 10 fork specs moved to
  `onAction({ action, event })`.
- **`app_life_cycle.provider.dart` (b29)** — immich-31557's `_fullSyncPending` ported onto the
  fork's `syncRemoteThenLocal(fullLocalSync:)`. Upstream's four background-launch tests adapted.
  `BackgroundWorkerApiImpl.swift` keeps both sides: upstream's `wasLaunchedInBackground` and the
  fork's non-crashing task lookup.
- **Dead-code sweep (b32)** — accepted the deletion of `map_marker.provider.dart` / `map.service.dart`
  (only self-referenced at the fork tip). **Non-conflict trap:** the sweep deleted
  `memory.service.dart`'s `log` field, which the fork's #997 server-fallback still uses. Restored.

## Zero-Conflict Semantic Breaks Found

| What                                                                                                   | How it surfaced                                    |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Upstream's birthday dispatch and object `MemoryDataSchema` auto-merged outside the markers             | Predicted by the spec, checked at #418             |
| Hide/favourite handlers deleted from the people page while the fork's menu calls them                  | `svelte-check` after batch 23                      |
| immich-31531's modal imports panels from the path the fork had moved away from                         | `tsc` after batch 23                               |
| Dead-code sweep deleted `MemoryService.log` and emitted events the fork's action button used           | `dart analyze` after batch 32                      |
| Upstream's new storage-template string names the upstream product                                      | `gallery-branding-check.sh`; override added        |
| DCM unused-code gate reports 76 fork declarations                                                      | `mise //mobile:analyze --full`                     |
| unicorn v75 rules fail fork code only                                                                   | Server and web lint                                |
| `bits-ui` debounce fires after happy-dom teardown (`Element is not defined`)                           | **CI Test Web only**. Fixed in the shared afterAll |

The last row is a timing race, not a rebase regression. The spec, the page and `bits-ui` 2.18.1
match `main`, and the spec passes locally. It was reproduced deterministically by removing `Element`
in a file-level `afterAll`, then fixed. The fix extends the existing body-scroll-lock drain in
`web/src/test-data/setup.ts` to wait one 10 ms debounce window while a dismissable layer is still
registered.

### Local environment trap (not a CI issue)

After several lockfile regenerations, the local `node_modules/.pnpm/node_modules/typescript` hoisted
`typescript@7.0.2`. `@koddsson/eslint-plugin-tscompat` imports bare `typescript` without declaring
it, so `pnpm lint` in `web/` crashed (`SymbolFlags` undefined). A fresh `--frozen-lockfile` install in
a clean worktree hoists `@typescript/typescript6`, and web lint passes there. If lint crashes in
`tscompat`, check this before touching the lockfile.

## Verification

All of the following were run locally on the tip:

| Gate                                                  | Result                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| Server `tsc` / lint / prettier                        | Clean                                                         |
| Server unit                                           | 6,447 passed                                                  |
| Server medium (memory, sync-memory, identity-merge)   | Passed                                                        |
| Web `tsc` / `svelte-check` / lint                     | Clean (lint on a fresh install, see above)                    |
| Web unit                                              | 390 files, 6,394 passed                                       |
| Mobile analyzer / format / DCM (`--full`)             | Clean                                                         |
| Mobile tests                                          | 4,011 passed. Drift migrations: 826 passed                    |
| e2e / CLI check + lint                                | Clean                                                         |
| Upstream-preflight tool                               | 293 passed                                                    |
| OpenAPI / SDK / SQL regen                             | No diff                                                       |
| `gallery-branding-check.sh`                           | Clean                                                         |
| `make ci-invariants-check`                            | Green, including the two new birthday invariants              |
| Post-rebase audits, `fork-patches-check`, drift check | Green for batches 18–33                                       |
| `make commit-autolink-check`                          | OK                                                            |

## CI results

Full set dispatched on `9b54be5ec69`: Test, Static Code Analysis, Gallery Build Mobile, Docker,
Rebase Smoke, Storage Migration Tests, Storage Migration E2E, Revert-to-Immich Validation, ML Smoke
and Mobile Smoke.

_Results to be recorded when the runs complete._

## Follow-up work

1. **`origin/main`'s ownership cursor is stale.** `last_verified_fork_head` was orphaned by the
   2026-09-15 cutover. It was re-anchored here; `main` needs the same one-line change or its next
   fork sync refuses again.
2. **Prune fork dead code flagged by DCM.** 72 `// ignore: unused-code` markers were added to get
   through the gate mid-rebase. Some are auto_route args or constructor fields, where deletion needs
   codegen care.
3. **Space-aware birthdays, and converting imported rows.** Neither generator sees Space photos yet.
   Birthday memories saved in Immich ≥ 3.3 before switching to Gallery stay hidden, not deleted. A
   follow-up should convert saved `type='birthday'` rows to `type='rule', ruleId='birthday'`.
4. **Birthday review — deferred minors:**
   - The Space medium test does not pin where the SQL filter sits.
   - The unit sync birthday test has no Rule row.
   - A stale comment in `sync.service.ts` (~line 251) says upstream's only memory type is
     `on_this_day`.
   - Birthday create validation checks presence only; upstream types `personId` as a uuid.
   - Mobile commits `ba898ce2c68` and `3ec7faa1812` do not compile at their own SHAs, because the
     single OpenAPI regen lands later (bisect only).
   - `PersonRepository` is registered twice in the medium memory spec setup.
5. **The lockfile lags upstream on ~112 transitive versions.** This is deliberate: re-basing onto
   upstream's lockfile would have moved 24 fork-only packages (aws-sdk, `@zip.js/zip.js`) untested.
6. **Resume full-sync retry (immich-31557 port).** The fork clears `_fullSyncPending` when the sync is
   scheduled, not when the local sync runs. If the deferred local sync is skipped, the one-off full
   sync waits for the next background launch.
7. Still open from 2026-09-20: port `RemoveFromAlbumAction` onto `asset.service.ts`, and move the
   fork's components to logical paddings (`ps-` / `pe-`).
