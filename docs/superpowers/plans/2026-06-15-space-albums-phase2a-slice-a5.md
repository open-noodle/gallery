# Space Albums Phase 2A — Slice A5: Dispatch + Checkpoint + OpenAPI + Sync E2E — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Wire the five A4 sync repository classes into the sync service dispatch (5 `SyncRequestType`s + `SYNC_TYPES_ORDER` + 5 handler methods), regenerate the OpenAPI spec + clients so the new wire types reach the Dart SDK (Sub-project B's contract), and pin the end-to-end sync behavior (the three `library_user` scenarios re-cast + the absorbed invariant). Also tighten the two under-assertive A4 ack-coupling tests (deferred from the A4 review).

**Architecture:** Clone the personal album dispatch handlers, swapping the repo accessor to `syncRepository.sharedSpaceAlbum*` and the entity types to `SharedSpaceAlbum*`. The membership/asset/exif per-album backfill loops key off `sharedSpaceAlbum.getCreatedAfter` (the grant watermark); the asset/exif `getUpdates` thread the `SharedSpaceAlbumToAsset` ack. Five request types mirror the personal album granularity.

**Tech Stack:** NestJS sync service, OpenAPI (`oazapfts` TS SDK + OpenAPI-Generator Dart), Vitest medium + e2e.

**Spec:** §6.1 (5 request types), §9 (dispatch + OpenAPI), §10 (E2E), §11 (A5).

**Depends on:** A4 (the five classes + entity types + DTOs + SyncItem map). **This is the final slice.**

> **Run-command note:** scope medium tests with `pnpm test:medium <path>`.

---

## Handler → clone-source map

| New handler (`sync.service.ts`)    | Clone of                     | repo accessor                                                                                                                 | entity types                                                                   | RequestType                    |
| ---------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------ |
| `syncSharedSpaceAlbumsV1`          | `syncAlbumsV1`               | `sharedSpaceAlbum`                                                                                                            | `SharedSpaceAlbumV1` (upsert, →`SyncAlbumV1`) / `SharedSpaceAlbumDeleteV1`     | `SharedSpaceAlbumsV1`          |
| `syncSharedSpaceAlbumLinksV1`      | `syncSharedSpaceLibrariesV1` | `sharedSpaceAlbumLink` (+ `sharedSpace.getCreatedAfter` for per-space backfill)                                               | `SharedSpaceAlbumLinkV1` / `…DeleteV1` / `…BackfillV1`                         | `SharedSpaceAlbumLinksV1`      |
| `syncSharedSpaceAlbumToAssetsV1`   | `syncAlbumToAssetsV1`        | `sharedSpaceAlbumToAsset` (+ `sharedSpaceAlbum.getCreatedAfter` for the per-album backfill loop)                              | `SharedSpaceAlbumToAssetV1` / `…DeleteV1` / `…BackfillV1`                      | `SharedSpaceAlbumToAssetsV1`   |
| `syncSharedSpaceAlbumAssetsV1`     | `syncAlbumAssetsV2`          | `sharedSpaceAlbumAsset` (+ `sharedSpaceAlbum.getCreatedAfter`; `getUpdates` ack = `checkpointMap[SharedSpaceAlbumToAssetV1]`) | `SharedSpaceAlbumAssetCreateV1` / `…UpdateV1` / `…BackfillV1` (→`SyncAssetV2`) | `SharedSpaceAlbumAssetsV1`     |
| `syncSharedSpaceAlbumAssetExifsV1` | `syncAlbumAssetExifsV1`      | `sharedSpaceAlbumAssetExif` (+ same backfill + ack)                                                                           | `SharedSpaceAlbumAssetExifCreateV1` / `…UpdateV1` / `…BackfillV1`              | `SharedSpaceAlbumAssetExifsV1` |

---

### Task 1: Dispatch wiring + handlers + handler-level sync tests

**Files:** `server/src/enum.ts`; `server/src/services/sync.service.ts`; test `server/test/medium/specs/sync/sync-shared-space-album.spec.ts`.

- [ ] **Step 1: Write the failing handler-level test** (mirror `sync-shared-space-library.spec.ts`). Cover the three scenarios + absorbed invariant:
  - **(1) Album linked to a space the user is already a member of** → `ctx.syncStream(auth, [SyncRequestType.SharedSpaceAlbumsV1, SyncRequestType.SharedSpaceAlbumLinksV1, SyncRequestType.SharedSpaceAlbumToAssetsV1, SyncRequestType.SharedSpaceAlbumAssetsV1, SyncRequestType.SharedSpaceAlbumAssetExifsV1])` emits `SharedSpaceAlbumV1` (metadata), `SharedSpaceAlbumLinkV1` (with the right `showInTimeline`), `SharedSpaceAlbumToAssetV1`/`BackfillV1` (membership), `SharedSpaceAlbumAsset*`/`Exif*` for the album's assets.
  - **(2) First-time invite to a space with a pre-linked album** → after adding the member, their next sync backfills the album + its assets.
  - **(3) Re-add to a space** → fresh grant `createId` re-delivers.
  - **Absorbed invariant** → the same album does **NOT** arrive as a personal `AlbumV1`/`AlbumV2` when the member requests `AlbumsV2` (assert no personal album event for a space-only member who doesn't own / isn't `album_user` on it).
  - **Viewer parity** → a Viewer (read-only) receives the same asset/exif events as an Editor (sync access is role-independent).

- [ ] **Step 2: Run, verify RED** — `cd server && pnpm test:medium test/medium/specs/sync/sync-shared-space-album.spec.ts` → FAIL (the request types are unknown / not handled). Capture the failure.

- [ ] **Step 3: Add the five `SyncRequestType` values** to `enum.ts` (after `SharedSpaceLibrariesV1`): `SharedSpaceAlbumsV1`, `SharedSpaceAlbumLinksV1`, `SharedSpaceAlbumToAssetsV1`, `SharedSpaceAlbumAssetsV1`, `SharedSpaceAlbumAssetExifsV1`.

- [ ] **Step 4: Add them to `SYNC_TYPES_ORDER`** (after `SharedSpaceLibrariesV1`), in this order (metadata + link before membership/assets/exif):

  ```
  SyncRequestType.SharedSpaceAlbumsV1,
  SyncRequestType.SharedSpaceAlbumLinksV1,
  SyncRequestType.SharedSpaceAlbumToAssetsV1,
  SyncRequestType.SharedSpaceAlbumAssetsV1,
  SyncRequestType.SharedSpaceAlbumAssetExifsV1,
  ```

- [ ] **Step 5: Add the five `handlers` Record entries + the five handler methods** (clone per the map above). Example for metadata (clone `syncAlbumsV1`):

  ```ts
  [SyncRequestType.SharedSpaceAlbumsV1]: () => this.syncSharedSpaceAlbumsV1(options, response, checkpointMap),
  // ...
  private async syncSharedSpaceAlbumsV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.SharedSpaceAlbumDeleteV1;
    const deletes = this.syncRepository.sharedSpaceAlbum.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) send(response, { type: deleteType, ids: [id], data });
    const upsertType = SyncEntityType.SharedSpaceAlbumV1;
    const upserts = this.syncRepository.sharedSpaceAlbum.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) send(response, { type: upsertType, ids: [updateId], data });
  }
  ```

  The membership/asset/exif handlers clone `syncAlbumToAssetsV1` / `syncAlbumAssetsV2` / `syncAlbumAssetExifsV1`: the per-album backfill loop uses `this.syncRepository.sharedSpaceAlbum.getCreatedAfter(...)` (the grant watermark) and `this.syncRepository.sharedSpaceAlbum<Stream>.getBackfill(..., album.id[, userId])`; the asset/exif `getUpdates` receive `checkpointMap[SyncEntityType.SharedSpaceAlbumToAssetV1]` as the `albumToAssetAck`. The link handler clones `syncSharedSpaceLibrariesV1` (per-space backfill via `this.syncRepository.sharedSpace.getCreatedAfter`).

- [ ] **Step 6: Run, verify GREEN** — same command → all scenario tests pass. `cd server && pnpm check` clean.

- [ ] **Step 7: Commit** — `git commit -am "feat(spaces): wire SharedSpaceAlbum* sync dispatch handlers (Phase 2A slice A5)"`

---

### Task 2: Tighten the two A4 ack-coupling tests (deferred from A4 review)

**Files:** `server/test/medium/specs/sync/shared-space-album-asset-sync.spec.ts`, `…-exif-sync.spec.ts`.

- [ ] **Step 1:** In each `getUpdates` test, set the `albumToAssetAck` to an `updateId` BELOW the asset's `album_asset.updateId` and assert the result is EMPTY (the coupling suppresses updates for assets the client doesn't yet know), AND with an ack ABOVE assert the asset IS returned. This makes the tests fail if the `album_asset.updateId <= albumToAssetAck.updateId` coupling is ever dropped. Run both specs → GREEN.
- [ ] **Step 2: Commit** — `git commit -am "test(spaces): pin the album-asset getUpdates ack coupling (A4 review follow-up)"`

---

### Task 3: OpenAPI regen (TS spec + SDK; Dart attempted, CI backstop)

**Files:** `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/*`, `mobile/openapi/*` (generated).

- [ ] **Step 1: Regenerate the spec + TS SDK** — `cd server && pnpm build && pnpm sync:open-api` then `make open-api-typescript`. Confirm the new DTOs appear: `grep -c "SyncSharedSpaceAlbumLinkV1" open-api/immich-openapi-specs.json` (>0) and in `open-api/typescript-sdk/`.
- [ ] **Step 2: Regenerate the Dart client** — `make open-api-dart` (needs Java/OpenAPI-Generator; see `feedback_openapi_dart_generation`). If it fails locally for tooling reasons, note it — CI regenerates + verifies; `/babysit` will surface any spec/SDK drift. Do NOT hand-edit generated files.
- [ ] **Step 3: Commit the regenerated artifacts** — `git add open-api mobile/openapi && git commit -m "chore(open-api): regenerate clients for SharedSpaceAlbum* sync types (Phase 2A slice A5)"`

---

### Task 4: Final gates + sync E2E

- [ ] **Step 1: tsc + targeted suites** — `cd server && pnpm check`; `pnpm test -- --run src/services/sync.service.spec.ts` (the handlers Record exhaustiveness + onAuditTableCleanup); `pnpm test:medium test/medium/specs/sync/sync-shared-space-album.spec.ts test/medium/specs/sync/sync-shared-space-library.spec.ts test/medium/specs/sync/sync-album.spec.ts` (new + regression).
- [ ] **Step 2: E2E (e2e/)** — if the repo has an API-level sync E2E for shared-space-library (`e2e/src/.../sync*`), add the album analogue (the three scenarios). If E2E sync infra is absent/heavy, the medium handler tests (Task 1) are the authoritative coverage; note E2E deferred and rely on the medium suite + CI.
- [ ] **Step 3: Lint (the deferred full gate)** — `cd server && pnpm lint` (eslint --max-warnings 0; watch floating-promises/`void`). Fix any warnings the new handlers/classes introduce.
- [ ] **Step 4: Commit** any fixes — `git commit -am "fix(spaces): A5 lint + gate fixes"`

---

## Self-Review (completed by plan author)

- **Spec coverage:** §6.1 five request types → Task 1 Steps 3–4. §9 dispatch handlers (clone-source map) + OpenAPI regen → Tasks 1 + 3. §10 E2E (3 scenarios + absorbed invariant + viewer parity) → Task 1 Step 1 (handler-level) + Task 4 Step 2 (API E2E if present). §11 A5 → all tasks. A4-review follow-up (ack-coupling tests) → Task 2. ✓
- **Scope:** A5 is the terminal slice — dispatch + OpenAPI + E2E + the deferred test tightening. No new schema/triggers/classes (A1–A4). ✓
- **No placeholders:** handler clone-sources + repo accessors + entity types are tabulated; the metadata handler is shown in full; OpenAPI commands are exact. Dart-regen-may-need-CI is an explicit, reasoned deferral (tooling), not a TODO. ✓
- **Type/name consistency:** five `SyncRequestType`s + five handler method names + the entity types match A4's `SyncEntityType` additions and the `SyncItem` map; the asset `getUpdates` ack uses `SharedSpaceAlbumToAssetV1` (A4). ✓
- **Exhaustiveness coupling noted:** adding a `SyncRequestType` requires its `handlers` Record entry (the Record is exhaustive) — Task 1 adds enum + order + handlers together so tsc stays green; the RED is the scenario test, not a compile error. ✓
