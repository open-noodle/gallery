# Per-user favorites — Slice 6: Mobile sync, Drift, un-gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mobile parity for per-user favorites — every sync stream carries the **recipient's** favorite instead of a masked/hardcoded value, favorite toggles propagate incrementally via a new `asset_favorite` sync entity (§4.3: favorite writes never bump `asset.updateId`), and the mobile heart works on non-owned assets with the E32 direction bug fixed.

**Architecture:** Two server halves + two mobile halves. (S1) The 16 masking/hardcoded `isFavorite` expressions in `sync.repository.ts` plus the `columns.syncAsset` raw read become `favoriteExistsFor(eb, userId)` overlay joins — every stream is authenticated as one user, so the emitted value is per-recipient. (S2) A new `AssetFavoritesV1` request type streams the caller's own `asset_favorite` rows (upserts) and `asset_favorite_audit` tombstones (deletes), modeled on the flat `AssetEditSync`/`AssetOcrSync` pattern — NOT the album_space_asset backfill machinery (favorites need no parent-grant backfill; the table is already caller-scoped). (M1) Mobile requests the new stream behind a fork-version gate and applies it to the single `remote_asset.isFavorite` column — valid per-account storage once all writes are recipient-resolved. (M2) The action un-gates (`ownerId` filter → any readable RemoteAsset), the direction derives from the same set that is mutated (E32), writes go to `PUT /assets/favorites`, and the Favorites-page/search read sites stop assuming owner-only favorites.

**Tech Stack:** NestJS + Kysely + zod sync DTOs (server), Drift + Riverpod (mobile, Flutter **3.44.1** — the CLAUDE.md 3.41.7 pin is stale; `mobile/pubspec.yaml:9` + `mobile/mise.toml:2` say 3.44.1), OpenAPI Generator (Dart client, committed), medium tests via `SyncTestContext` (`server/test/medium.factory.ts:410-447`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-per-user-favorites-design.md` §4.3, slice 6 (§9), edge rows E25, E26, E32. The §4.3 resolution is binding: favorite writes must NOT bump `asset.updateId`; propagation is via the dedicated entity stream.
- **No cross-user read** (§3): user A's favorite rows must never appear in user B's stream — every new/converted query filters or resolves on the syncing user's id. Asserted, not assumed.
- Server sync-stream registration is a fixed checklist (missing any item breaks tests or runtime): `enum.ts` (`SyncRequestType.AssetFavoritesV1`, `SyncEntityType.AssetFavoriteV1`/`AssetFavoriteDeleteV1`), `sync.dto.ts` payload schemas + item map, `sync.repository.ts` stream methods on the existing `AssetFavoriteSync` stub (`:865` — `cleanupAuditTable` already wired), `sync.service.ts` `SYNC_TYPES_ORDER` (**load-bearing**: `sync-types.spec.ts` asserts its length equals the enum's) + handler map + handler method.
- OpenAPI: after enum/DTO changes run the FULL regen (`mise open-api` → spec + TypeScript + Dart). TS-only regen leaves the Dart client stale and fails CI.
- SQL snapshots: regenerate with `mise sql` — **requires a built server (`pnpm build`) AND a running Postgres, and it DELETES `server/src/queries/` before connecting**. Never run it without the DB up. Use a THROWAWAY postgres container (image from `docker/docker-compose.dev.yml`, host port 5439) — never the shared `immich-dev` stack, which belongs to another session/worktree (`reference_mise_dev_singleton_across_worktrees`). `DB_URL=postgres://postgres:postgres@localhost:5439/immich`.
- Mobile version gate: the server 400s the whole `/sync/stream` request on an unknown enum value, and the ONLY protection is client-side (`sync_api.repository.dart:99-127`). The new request type must be gated `if (serverVersion > const SemVer(major: 5, minor: 2, patch: 0))` — strict `>` against the latest released fork version (5.2.0), exactly mirroring the space-albums gate pattern and its comment; do NOT use `>=` (`project_space_albums_mobile_version_gate`).
- Mobile test gates (CI parity): from `mobile/` on Flutter 3.44.1 — `flutter pub get`, `mise //mobile:codegen:translation`, then `flutter test` (or `mise //mobile:test`), plus `dart analyze --fatal-infos lib test` AND `dart format --set-exit-if-changed .` scoped to changed files (`dart format .` reformats hundreds of files — format only the files you touched).
- `local_asset` / `trashed_local_asset` favorite mirrors are device-local backup state — untouched.
- Server style: prettier 120/single-quote, `src/` alias imports, eslint zero warnings; prettier and eslint are separate gates.
- E2E API runs: `cd e2e && npx vitest --config vitest.config.ts run <path>`; e2e stack via `docker compose up -d --build --wait` from `e2e/` (full `down -v` first on "inconsistent media location").
- Commits: `feat(sync)/feat(mobile)/test(...): … (#763)`; never add Co-Authored-By trailers.

## File Map

| #   | File                                                                                                                                         | Change                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | `server/src/repositories/sync.repository.ts`                                                                                                 | 16 sites → `favoriteExistsFor`: album `:242,262,285`; partner `:663,683` (hardcoded false); shared-space `:1010,1041,1071`; library `:1322,1359`; shared-space-album `:1839,1864,1898,1921,1953,1977`; own-stream select at `:438-440`; comments `:997,1029,1060,1310-1312,1349,1822-1823` |
| S1  | `server/src/database.ts:508,581-583`                                                                                                         | Remove `'asset.isFavorite'` from `columns.syncAsset`; update the sibling comment                                                                                                                                                                                                           |
| S1  | `server/test/medium/specs/sync/*.spec.ts`                                                                                                    | Invert masking assertions → recipient-resolved                                                                                                                                                                                                                                             |
| S2  | `server/src/enum.ts`, `server/src/dtos/sync.dto.ts`, `server/src/repositories/sync.repository.ts:865`, `server/src/services/sync.service.ts` | New `AssetFavoritesV1` stream (model: `sync-asset-edit`)                                                                                                                                                                                                                                   |
| S2  | `server/test/medium/specs/sync/sync-asset-favorite.spec.ts`                                                                                  | New medium suite                                                                                                                                                                                                                                                                           |
| S2  | OpenAPI spec + `packages/sdk` + `mobile/openapi`                                                                                             | Full regen                                                                                                                                                                                                                                                                                 |
| S3  | `server/src/queries/sync.repository.sql`                                                                                                     | Regenerated blocks only                                                                                                                                                                                                                                                                    |
| M1  | `mobile/lib/infrastructure/repositories/sync_api.repository.dart` (~:99-127)                                                                 | Request `assetFavoritesV1` behind `> 5.2.0` gate                                                                                                                                                                                                                                           |
| M1  | `mobile/lib/domain/services/sync_stream.service.dart` (~:191-414)                                                                            | Dispatch arms for `assetFavoriteV1`/`assetFavoriteDeleteV1`                                                                                                                                                                                                                                |
| M1  | `mobile/lib/infrastructure/repositories/sync_stream.repository.dart`                                                                         | `updateAssetFavoritesV1` / `deleteAssetFavoritesV1` → flip `remote_asset.isFavorite` by assetId                                                                                                                                                                                            |
| M2  | `mobile/lib/presentation/widgets/actions/favorite.action.dart`                                                                               | E32 direction + un-gate `:22`                                                                                                                                                                                                                                                              |
| M2  | `mobile/lib/infrastructure/repositories/asset_api.repository.dart:45-46`                                                                     | → `updateAssetFavorites(AssetFavoriteUpdateDto(...))`                                                                                                                                                                                                                                      |
| M2  | `mobile/lib/infrastructure/repositories/timeline.repository.dart:829-842`                                                                    | Favorites page: drop owner scoping, add viewer-visibility                                                                                                                                                                                                                                  |
| M2  | `mobile/lib/infrastructure/repositories/search_api.repository.dart:50-63,85-98`                                                              | Drop the favorite→`withSharedSpaces` suppression mirrors                                                                                                                                                                                                                                   |
| M2  | legacy `action.provider.dart:108-116` favorite path                                                                                          | Investigate reachability; fix or document                                                                                                                                                                                                                                                  |
| M2  | `mobile/test/unit/presentation/actions/favorite_action_test.dart` + sync tests                                                               | TDD                                                                                                                                                                                                                                                                                        |

---

### Task 1: Server — recipient-resolved `isFavorite` in every sync stream

**Files:**

- Modify: `server/src/repositories/sync.repository.ts` (16 select sites + 7 comment blocks + import), `server/src/database.ts:508,581-583`
- Modify: medium specs under `server/test/medium/specs/sync/` that pin masking (at minimum `shared-space-album-asset-sync.spec.ts` — "masks isFavorite to false for non-owners" ~:82 — plus whatever `grep -rln "masks isFavorite\|isFavorite.*mask\|sql.val(false)" server/test/medium/specs/sync/` finds; also partner-asset sync specs asserting hardcoded false)

**Interfaces:**

- Consumes: `favoriteExistsFor(eb, userId)` from `src/utils/favorite.ts` — composes at every site (each query joins or selects from a table aliased `asset`; the helper's `assetIdRef` default `'asset.id'` resolves everywhere).
- Produces: every asset-payload stream emits the SYNCING user's favorite. Task 3 regenerates the snapshots these queries emit; Task 4's mobile column-write becomes correct.

- [ ] **Step 1: Write the failing medium tests.** For each stream family, seed via `SyncTestContext`/`mediumFactory` (patterns in the existing files): an asset owned by user A, shared to user B (album / partner / space / space-album / library as the family requires); B favorites it (direct `asset_favorite` insert); assert B's stream emits `isFavorite: true` AND A's stream for the same asset emits A's own state (false unless A favorited). Invert the existing masking assertions (e.g. `shared-space-album-asset-sync.spec.ts:82`) rather than deleting them — the negative ("A's favorite never leaks to B") must remain asserted with the new semantics: favorite the asset as A only, assert B's stream emits `false`. Partner arms: assert the recipient's own favorite of a partner asset now syncs `true` (was hardcoded `false` — E25).
- [ ] **Step 2: Run red.** `cd server && pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/sync/<the modified files>` (needs Docker/testcontainers). Expected: new/inverted assertions fail (masking still in place).
- [ ] **Step 3: Implement.** At each CASE-WHEN site replace the whole `.select((eb) => eb.case().when('asset.ownerId','=',userId).then(eb.ref('asset.isFavorite')).else(eb.val(false)).end().as('isFavorite'))` block with:

```ts
        .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
```

Partner sites `:663,683`: replace `.select(sql.val(false).as('isFavorite'))` the same way (the recipient's own rows are legitimate now; the `1777897107000-PartnerAssetSyncReset` reset existed because the OWNER's favorites leaked — the overlay resolves the RECIPIENT's, which is correct — update the comment accordingly). Own stream (`AssetSync.getUpserts` ~`:438-440`): remove `'asset.isFavorite'` from `columns.syncAsset` (`database.ts:508`) and add the same overlay select to the query (the syncing user IS the owner there, so behavior is identical post-backfill — state this in the commit body). Update every masking-rationale comment (`:997,1029,1060,1310-1312,1349,1822-1823`, `database.ts:581-583`) to describe the overlay join. Add the `favoriteExistsFor` import.

- [ ] **Step 4: Run green.** The modified medium files, then the WHOLE `test/medium/specs/sync/` directory (other sync specs may consume `columns.syncAsset`).
- [ ] **Step 5: Style + commit.**

```bash
cd server && pnpm exec prettier --check src/repositories/sync.repository.ts src/database.ts && pnpm exec eslint --max-warnings 0 src/repositories/sync.repository.ts src/database.ts
git add -A server/src/repositories/sync.repository.ts server/src/database.ts server/test/medium/specs/sync
git commit -m "feat(sync): resolve isFavorite per recipient in every asset sync stream (#763)"
```

(Snapshots intentionally stale until Task 3 — the sql-sync CI check runs on the final push, and Task 3 lands before then.)

---

### Task 2: Server — the `AssetFavoritesV1` entity stream

**Files:**

- Modify: `server/src/enum.ts` (two enums), `server/src/dtos/sync.dto.ts` (payload schemas + item map), `server/src/repositories/sync.repository.ts:865-869` (flesh out the stub), `server/src/services/sync.service.ts` (`SYNC_TYPES_ORDER` ~:117, handler map ~:199-258, handler method modeled on `syncAssetEditsV1` ~:439-452)
- Create: `server/test/medium/specs/sync/sync-asset-favorite.spec.ts` (model: `sync-asset-edit.spec.ts` / `sync-asset-ocr.spec.ts`)
- Regenerate: OpenAPI spec + both SDKs

**Interfaces:**

- Consumes: `BaseSync` generic helpers (`upsertQuery`/`auditQuery`, `sync.repository.ts:148-177`); `asset_favorite` (userId, assetId, createId, updateId) and `asset_favorite_audit` (slice 0; delete trigger exists; `cleanupAuditTable` already wired at `:867` + `sync.service.ts:281`).
- Produces: `SyncRequestType.AssetFavoritesV1` emitting `SyncEntityType.AssetFavoriteV1` payload `{ assetId: string }` (the stream is caller-scoped; no userId in the payload) and `AssetFavoriteDeleteV1` payload `{ assetId: string }`. Checkpoints/acks work generically once the enum entries exist. Task 4 consumes these from mobile.

- [ ] **Step 1: Write the failing medium tests** (`sync-asset-favorite.spec.ts`):
- initial sync: user's existing favorite rows stream as `AssetFavoriteV1` upserts; acking completes the stream.
- incremental: favorite → new upsert after checkpoint; unfavorite → `AssetFavoriteDeleteV1` from the audit tombstone.
- **isolation (§3)**: user B's favorites (same asset) never appear in user A's stream — both directions.
- **E26 convergence**: favorite → unfavorite → favorite again across checkpoints converges to favorited; no duplicate/stale terminal state.
- **§4.3 no-amplification**: a favorite write does NOT re-emit the asset on the `AssetsV1` stream (assert `asset.updateId` unchanged / no asset upsert after ack).
- [ ] **Step 2: Run red** (the new file — fails on missing enum/handler).
- [ ] **Step 3: Implement** per the registration checklist in Global Constraints. Stream methods on the existing stub:

```ts
class AssetFavoriteSync extends BaseSync {
  @GenerateSql({ params: [dummyUpsertOptions, DummyValue.UUID], stream: true })
  getUpserts(options: SyncUpsertOptions, userId: string) {
    return this.upsertQuery('asset_favorite', options)
      .select(['asset_favorite.assetId', 'asset_favorite.updateId'])
      .where('asset_favorite.userId', '=', userId)
      .stream();
  }

  @GenerateSql({ params: [dummyAuditOptions, DummyValue.UUID], stream: true })
  getDeletes(options: SyncAuditOptions, userId: string) {
    return this.auditQuery('asset_favorite_audit', options)
      .select(['asset_favorite_audit.assetId', 'asset_favorite_audit.id'])
      .where('asset_favorite_audit.userId', '=', userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('asset_favorite_audit', daysAgo);
  }
}
```

(Adapt method/option names to the exact `BaseSync` helper signatures — read `sync-asset-edit`'s class first and mirror it precisely, including how deletes carry the audit `id` for ack bookkeeping.) Handler `syncAssetFavoritesV1` mirrors `syncAssetEditsV1` (deletes first, then upserts). Add `AssetFavoritesV1` to `SYNC_TYPES_ORDER` in a position mirroring where `AssetEditsV1`-class types sit.

- [ ] **Step 4: Run green** — the new file plus `server/test/medium/specs/sync/sync-types.spec.ts` (the ORDER-array gate) plus the service-level unit suite `cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/sync.service.spec.ts` if it exists.
- [ ] **Step 5: Regenerate OpenAPI + SDKs.** `cd server && pnpm build && mise run sync-open-api` (or the repo's exact task — read `server/mise.toml:41-42`), then from root the full client regen (`mise open-api` — Dart requires Java). Verify `mobile/openapi/lib/model/sync_request_type.dart` and `sync_entity_type.dart` now contain the favorite entries, and `packages/sdk/src/fetch-client.ts` the type strings.
- [ ] **Step 6: Style + commit.**

```bash
git add server/src/enum.ts server/src/dtos/sync.dto.ts server/src/repositories/sync.repository.ts server/src/services/sync.service.ts server/test/medium/specs/sync/sync-asset-favorite.spec.ts open-api packages/sdk mobile/openapi
git commit -m "feat(sync): asset_favorite as its own synced entity — upserts + tombstones (#763)"
```

---

### Task 3: Server — regenerate SQL snapshots (isolated DB)

- [ ] **Step 1: Throwaway DB.** Read the postgres image/env from `docker/docker-compose.dev.yml`, then run it standalone on port 5439 (e.g. `docker run -d --name fav-sql-regen -p 5439:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=immich <that image>`). Do NOT touch the running `immich-dev` compose project — it belongs to another worktree.
- [ ] **Step 2: Regenerate.** `cd server && pnpm build`, then `DB_URL=postgres://postgres:postgres@localhost:5439/immich mise run sql` (or `DB_URL=... node ./dist/bin/sync-sql.js` from `server/`). If it fails partway the queries dir is already wiped — fix the DB and re-run; never commit a partial wipe.
- [ ] **Step 3: Verify scope.** `git diff --stat server/src/queries` — ONLY `sync.repository.sql` may change (favorite-related blocks + new `-- SyncRepository.assetFavorite.getUpserts`/`.getDeletes` blocks). Any other file changing means the DB or build was wrong — investigate, don't commit.
- [ ] **Step 4: Cleanup + commit.** `docker rm -f fav-sql-regen`

```bash
git add server/src/queries && git commit -m "chore(sql): regenerate sync query snapshots for per-user favorites (#763)"
```

---

### Task 4: Mobile — consume the favorite stream

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/sync_api.repository.dart` (~:99-127), `mobile/lib/domain/services/sync_stream.service.dart` (dispatch switch ~:191-414), `mobile/lib/infrastructure/repositories/sync_stream.repository.dart`
- Modify/extend: `mobile/test/domain/services/sync_stream_service_test.dart`, `mobile/test/domain/repositories/sync_stream_repository_test.dart`, `mobile/test/fixtures/sync_stream.stub.dart`, `mobile/test/infrastructure/repositories/sync_api_repository_test.dart`

**Interfaces:**

- Consumes: generated `SyncRequestType.assetFavoritesV1`, `SyncEntityType.assetFavoriteV1`/`assetFavoriteDeleteV1` and their payload models from `mobile/openapi` (Task 2's regen).
- Produces: `remote_asset.isFavorite` flipped by assetId on favorite events. Ordering note (accepted, document in code comment): a favorite event for a not-yet-synced asset updates zero rows and self-heals when the recipient-resolved asset payload arrives; a stale-ordered asset payload overwriting a newer favorite self-heals on the next favorite event or full resync — same eventual-consistency class as other cross-entity fields.

- [ ] **Step 1: Failing tests.** Stubs for the two new event types in `sync_stream.stub.dart`; service test asserting dispatch routes `assetFavoriteV1` → `updateAssetFavoritesV1` and `assetFavoriteDeleteV1` → `deleteAssetFavoritesV1`; repository test asserting the Drift row's `isFavorite` flips true/false by assetId and that unknown assetIds are a no-op (no throw); `sync_api_repository_test` asserting `assetFavoritesV1` is requested only when `serverVersion > 5.2.0` (both sides of the gate).
- [ ] **Step 2: Run red.** From `mobile/` (Flutter 3.44.1): `flutter pub get && dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart` once, then `flutter test test/domain test/infrastructure`.
- [ ] **Step 3: Implement.** Gate (mirror the `SharedSpaceAlbum*` block and its warning comment verbatim, adjusted):

```dart
      // #763 per-user favorites stream — fork server >= 5.3 only. Same rationale as the
      // space-albums gate above: an unknown enum value 400s the WHOLE /sync/stream request,
      // and this client-side gate is the only protection.
      if (serverVersion > const SemVer(major: 5, minor: 2, patch: 0)) ...[
        SyncRequestType.assetFavoritesV1,
      ],
```

Repository methods batch-update `remoteAssetEntity` (`isFavorite: Value(true/false)`) keyed by the payload assetIds, mirroring `updateFavorite`'s batch idiom in `remote_asset.repository.dart:119-124`.

- [ ] **Step 4: Green + gates.** `flutter test test/domain test/infrastructure`; `dart analyze --fatal-infos lib test`; `dart format --set-exit-if-changed <changed files>`.
- [ ] **Step 5: Commit.** `git add mobile && git commit -m "feat(mobile): sync per-user favorite upserts and tombstones into the local mirror (#763)"`

---

### Task 5: Mobile — un-gate the heart, fix E32, reroute writes, fix read sites

**Files:**

- Modify: `mobile/lib/presentation/widgets/actions/favorite.action.dart`, `mobile/lib/infrastructure/repositories/asset_api.repository.dart:45-46`, `mobile/lib/infrastructure/repositories/timeline.repository.dart:829-842`, `mobile/lib/infrastructure/repositories/search_api.repository.dart:50-63,85-98`
- Investigate: legacy `mobile/lib/providers/infrastructure/action.provider.dart:108-116` favorite path (standalone `FavoriteActionButton`/`UnFavoriteActionButton` widgets)
- Modify: `mobile/test/unit/presentation/actions/favorite_action_test.dart` (+ any timeline/search repo tests that pin owner-only favorites)

**Interfaces:**

- Consumes: `updateAssetFavorites(AssetFavoriteUpdateDto(ids: ids, isFavorite: isFavorite))` (`mobile/openapi/lib/api/assets_api.dart:1440`); viewer-visibility join helpers already used by the map favorite filter (`timeline.repository.dart:1198-1234` — `buildViewerVisibilityJoins`/`viewerVisibilityPredicate` or their actual names — read that section first).
- Produces: the mobile heart works on non-owned readable assets; Favorites page shows the viewer's favorites across own + shared content; search favorite filter composes with shared spaces (server slice 4).

- [ ] **Step 1: Failing tests** (`favorite_action_test.dart`, existing factories):
- **E32**: selection = [owned favorited, non-owned unfavorited] → `shouldFavorite` must be true AND the mutation set must be exactly the non-owned unfavorited asset (old code: direction true but mutation set empty after the owner filter).
- Un-gate: non-owned RemoteAsset is included in `filter(...)`; action visible for a non-owned-only selection.
- Endpoint: the service/repository write path is invoked with the full id set (mock-level assertion consistent with the file's existing style); `AssetBulkUpdateDto` no longer used for favorites.
- Regression: local optimistic Drift write still happens.
- [ ] **Step 2: Run red.** `flutter test test/unit/presentation/actions/favorite_action_test.dart`
- [ ] **Step 3: Implement.**

`favorite.action.dart` — compute direction from the same candidate set that is mutated (E32) and drop the owner term:

```dart
class FavoriteAction extends AssetAction<RemoteAsset> {
  final bool shouldFavorite;

  // #763 (E32): the direction must derive from the SAME set the action mutates. Candidates are
  // every remote asset in the selection — favorites are per-user, so read access (implied by the
  // asset being in the local mirror) is sufficient; ownership is irrelevant.
  FavoriteAction({required super.assets})
    : shouldFavorite = assets.whereType<RemoteAsset>().any((asset) => !asset.isFavorite);

  @override
  Iterable<RemoteAsset> filter(ActionScope scope) =>
      assets.whereType<RemoteAsset>().where((asset) => asset.isFavorite == !shouldFavorite);
  ...
```

(Adapt to the file's exact class shape — keep `isVisible`/`perform` structure; the two semantic changes are: no `ownerId == scope.authUser.id` term, and `shouldFavorite` computed over the same `whereType<RemoteAsset>()` candidates the filter uses.)

`asset_api.repository.dart:45-46`:

```dart
  Future<void> updateFavorite(List<String> ids, bool isFavorite) async {
    await _api.updateAssetFavorites(AssetFavoriteUpdateDto(ids: ids, isFavorite: isFavorite));
  }
```

`timeline.repository.dart` `favorite()` (~:836-837): remove `row.ownerId.equals(userId)`; add the same viewer-visibility joins/predicate the map favorite filter uses (`:1198-1234`) so the page lists readable favorites (own + space/album/library-shared), not unreadable leftovers. Mirror the map code's comment about diverging intentionally from the old owner-only semantics.

`search_api.repository.dart` (:60-63, :95-98): remove the `isFavorite`-conditional `withSharedSpaces` suppression — always `Optional.present(true)` where the non-favorite branch sent it — and delete the "favourites are owner-only" comments (server composes since slice 4).

Legacy path: grep usages of `FavoriteActionButton`/`UnFavoriteActionButton` widgets and `actionProvider.notifier).favorite`. If reachable from any live screen, apply the same un-gate + reroute to `action.provider.dart`/`action.service.dart`'s favorite arm (NOT to other actions) with a test; if dead code, leave untouched and record the finding in the report.

- [ ] **Step 4: Green + full mobile gates.** `flutter test` (full), `dart analyze --fatal-infos lib test`, `dart format --set-exit-if-changed <changed files>`.
- [ ] **Step 5: Commit.** `git add mobile && git commit -m "feat(mobile): per-user favorites — un-gate the heart, fix mixed-selection direction, canonical endpoint (#763)"`

---

### Task 6: Slice gate + push

- [ ] **Step 1: Server gate.** `cd server && pnpm exec vitest run --config test/vitest.config.mjs` (full unit); full medium SYNC directory `pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/sync`; `pnpm exec tsc --noEmit`; prettier + eslint on all server files modified this slice.
- [ ] **Step 2: E2E sanity.** Rebuild e2e stack; run `src/specs/server/api/asset-favorite.e2e-spec.ts src/specs/server/api/timeline.e2e-spec.ts` (favorites behavior unchanged at the REST layer).
- [ ] **Step 3: Mobile gate.** Full `flutter test`; `dart analyze --fatal-infos lib test`; `dart format --set-exit-if-changed` on changed files.
- [ ] **Step 4: Snapshot + OpenAPI drift check.** `git status --short server/src/queries open-api packages/sdk mobile/openapi` must be clean (everything committed in Tasks 2–3).
- [ ] **Step 5: Push.** `git push`
