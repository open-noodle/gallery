# Rolling-Rebase Audit Remediation — Spec (impl-loop)

**Date:** 2026-07-02
**Source findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` (36-agent audit, 16 confirmed + 24 low)
**Branch / worktree:** `rebase/upstream-rolling-20260509-active` in `.worktrees/rebase-upstream-rolling-20260509-active`
**Upstream base:** Immich `v3.0.0` (`237734bb26`, `v3.0.0-rc.4-15`) · **Known-good baseline:** `main` (Immich v2.7.5 fork lineage)
**Execution:** `/impl-loop` — one implementation plan per slice, strict TDD, commit per slice.

---

## 1. Purpose

The rolling upstream rebase is structurally sound, but 34 findings (2 HIGH, 8 MEDIUM, 24 LOW) are **upstream-integration gaps**: new Immich v3 code that does not route through fork constraints (RBAC, S3, video-trim, branding, mobile nav), plus fork logic quietly dropped or made stale during conflict resolution. CI is green, so none of these are compile/test failures — they are exactly the class CI cannot catch. This spec turns every finding into a TDD slice.

This is a continuously-rebased fork, so **many fixes ship with a permanent repo-invariant guard test** whose real job is to fail the _next_ rebase if the same regression recurs. That is a deliberate design goal, not test bloat.

## 2. Working agreements (apply to EVERY slice)

1. **Strict TDD, red-first.** For each slice: write the failing test(s) first, run it, capture the expected **RED** output, make the **minimal** change, run again and capture **GREEN**, then refactor if needed. No slice is complete without red→green evidence in its plan.
2. **Two legitimate test shapes.**
   - **Behavioral** — real logic. Server `vitest` unit (`pnpm test`) and medium/DB (`pnpm test:medium`), web `vitest` (`pnpm test`), mobile `mise exec -- flutter test`, e2e where a full stack is required.
   - **Repo-invariant guard** — red-first scan/grep assertions for config/script/rename/branding/build findings that no behavioral test reaches. Home: the existing `tools/upstream-preflight` vitest harness (repo-structure invariants) and `branding/scripts/verify-branding.sh` (branding leaks). Each guard must genuinely fail on the pre-fix tree.
3. **Location & git.** Work in `.worktrees/rebase-upstream-rolling-20260509-active` on `rebase/upstream-rolling-20260509-active`. **One commit per slice.** After each slice, update that finding's **Status** line in `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` to `FIXED (slice Sn)`.
4. **No force-push inside the loop.** #739 is already reconciled into local (`2c0e3c7d02`), so there is no divergence landmine — but the force-push is still a **manual, human-gated** step run via the `push-rebase` skill after the loop, never automatically.
5. **Lint deferred.** Do **not** run full-package `lint` per slice. Keep fast `tsc --noEmit` / `pnpm check` / `dart analyze` in the loop; run one `make lint-all` pass at the very end (final gate).
6. **Mobile test prerequisites.** Mobile lives in this worktree on Flutter 3.44.1 via `mise exec -- flutter`. Before running widget tests, regenerate the gitignored l10n + keys once per session:
   `cd mobile && mise exec -- dart run easy_localization:generate -S ../i18n -O lib/generated -o codegen_loader.g.dart && mise exec -- dart run bin/generate_keys.dart`
   Scope `dart analyze` to changed files (avoids unrelated private-named-param noise).
7. **No OpenAPI/SDK regen unless a slice changes server DTOs/controllers.** Only S16 (takeout uploader) touches a client payload, and it aligns to the _existing_ v3 DTO, so no regen. If any slice ends up changing an endpoint, run `mise //:open-api` (full, Java) before its commit.

## 3. Test-command reference

| Package | Unit                                                       | DB / integration                                            |
| ------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| server  | `cd server && pnpm test -- --run <spec>`                   | `cd server && pnpm test:medium -- --run <spec>` (Docker DB) |
| web     | `cd web && pnpm test -- --run <spec>`                      | —                                                           |
| mobile  | `cd mobile && mise exec -- flutter test <spec>`            | `mise exec -- dart analyze <files>`                         |
| e2e     | —                                                          | `cd e2e && pnpm test -- --run <spec>` (Docker stack)        |
| guards  | `cd tools/upstream-preflight && pnpm test -- --run <spec>` | `bash branding/scripts/verify-branding.sh`                  |

---

## 4. Slices

Ordered by the findings doc's priority: server RBAC → people threshold → mobile nav/sync → transcoding → branding → web hygiene → build/tooling hygiene. Each slice is independently testable and shippable.

---

### Slice 1 — H1: `/search/random` visibility fallback

- **Finding:** H1 · `server/src/services/search.service.ts` `searchRandom` (audit line ~212).
- **Decision:** sibling-consistent `not-locked` fallback (identical to `searchMetadata`/`searchSmart`/`searchStatistics`/`searchLargeAssets`).
- **Goal:** a non-elevated session calling `POST /api/search/random` with `visibility` omitted must **not** receive Locked, and the endpoint must resolve visibility exactly like its siblings.

**RED tests first** — `server/src/services/search.service.spec.ts`:

1. `searchRandom` with a **non-elevated** auth and no `dto.visibility` calls `searchRepository.searchRandom` with options where `visibility === 'not-locked'`.
2. `searchRandom` with an **elevated** session (`auth.session.hasElevatedPermission = true`) and no `dto.visibility` passes `visibility === undefined`.
3. `searchRandom` with explicit `dto.visibility = AssetVisibility.Archive` passes it through unchanged.
4. `searchRandom` with `dto.visibility = AssetVisibility.Locked` on a **non-elevated** session still throws / requires elevation (existing guard at the top of the method is unaffected).

Expected RED: assertions (1) and (2) fail because the current call passes `{ ...resolvedDto, userIds }` with `visibility` unset (repo adds no visibility clause → effectively "everything").

**Minimal implementation:** in `searchRandom`, resolve visibility with the sibling expression before the repo call:
`visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked')`
and pass it into the `searchRandom` options object (mirror how line ~156/187/238 build theirs).

**Edge cases (all covered by tests above + these):**

- Partner IDs: `getUserIdsToSearch` already includes partners; the visibility clause must apply to the whole result set, not just the caller's rows (assert repo receives both `userIds` and `visibility`).
- `dto.size` default (250) path unchanged.
- Explicit `visibility=Timeline` still returns Timeline only.
- **No-session auth (API key / shared link):** `auth.session` is undefined → `auth.session?.hasElevatedPermission` is `undefined` → falls to `'not-locked'` (treated as non-elevated). Add a test for this branch — it is the exact endpoint that leaked, and the `?.` makes the safe path silent.

**GREEN:** `cd server && pnpm test -- --run src/services/search.service.spec.ts`
**Commit:** `fix(server): close /search/random visibility leak (H1) — sibling not-locked fallback`

---

### Slice 2 — M3: space-scoped search excludes other members' archived/locked (per-owner elevation)

- **Finding:** M3 · `server/src/services/search.service.ts` (shared-space scoping combined with the v3 `undefined`-for-elevated default).
- **Decision:** restore fork exclusion — elevation unlocks only the **caller's own** locked folder; **other** shared-space members' assets are always Timeline-only in space-scoped search.
- **Goal:** an elevated caller searching a shared space cannot see another member's Archived / Hidden / Locked assets; the caller's own assets still honor the H1 rule.

**RED tests first** — `server/test/medium/specs/services/search.service.spec.ts` (real DB; needs two users in one shared space):

1. Owner A archives asset X into space S. Member B (elevated) runs a space-scoped metadata search over S → **X is absent**.
2. Owner A has Timeline asset Y in space S. Member B searches S → **Y present**.
3. Caller B's **own** archived asset Z: with B elevated + `visibility=undefined`, Z follows the H1/sibling rule for B's own rows (present when elevated, per the caller-owns-it path).
4. Non-elevated member B: never sees any other member's Archived/Hidden/Locked (baseline, must stay true).

Expected RED: test (1) currently returns X because the elevated `undefined` visibility default applies globally across all `userIds`, including other owners.

**Minimal implementation:** in the space-scoped search path, split visibility resolution by ownership — the caller's own `userId` may use the elevated `undefined`, but the _other_ space-member `userIds` are constrained to Timeline (or `not-locked` minus archive/hidden — see below). Prefer the smallest change that expresses "elevation is per-owner": constrain the non-caller portion of the query to `AssetVisibility.Timeline`.

**Edge cases:**

- Caller is the space **owner** vs. a **member** (owner sees own everything per elevation; still cannot see _other_ members' archived).
- Mixed spaces: asset shared by A and by C — each other-owner slice constrained independently.
- `visibility` explicitly set by caller (e.g. `Archive`) — an explicit request still must not expose _other_ members' archived; only the caller's own.
- Smart search and statistics variants exercise the same scoping helper — cover at least metadata + statistics.

**GREEN:** `cd server && pnpm test:medium -- --run src/services/search.service.spec.ts`
**Commit:** `fix(server): space-scoped search hides other members' archived/locked (M3)`

---

### Slice 3 — LOW[7]: filter-suggestion sources follow the `not-locked` default

- **Finding:** LOW · `server/src/repositories/search.repository.ts` (~:1295) filter-suggestion queries hard-pin `visibility = Timeline` while search/facet defaults moved to `not-locked`.
- **Goal:** dynamic filter suggestions cover the same asset set search now matches (Timeline + Archive + Hidden, minus Locked for non-elevated) so suggested values are not missing for results a search would return.

**RED tests first** — `server/src/repositories/search.repository.spec.ts` (or the medium repo spec):

1. Given an Archived asset with a distinct camera-make value, the suggestion source for that field **includes** the value for a non-elevated session (post-fix), and Locked-only values are **excluded**.
2. Non-elevated session never gets a Locked-only suggestion value.

Expected RED: suggestion query pins `visibility = Timeline`, so archived-only values are missing → test (1) fails.

**Minimal implementation:** replace the pinned `visibility = Timeline` in the suggestion-source query with the same `not-locked`/elevated resolution used by search facets; thread the caller's elevation.

**Edge cases:**

- Elevated session: Locked values may appear (matches search).
- Empty result set (no assets) returns empty suggestions, no error.
- Each suggestion field (make, model, city, etc.) uses the shared visibility clause — assert on ≥2 fields.

**GREEN:** `cd server && pnpm test:medium -- --run src/repositories/search.repository.spec.ts`
**Commit:** `fix(server): align filter-suggestion visibility with search default (LOW #7)`

---

### Slice 4 — LOW[1]: sync masks owner's `isFavorite` for non-owned space-synced assets

- **Finding:** LOW · `server/src/repositories/sync.repository.ts` (~:996) — fork shared-space sync streams the owner's raw `isFavorite` to all members; upstream v3 now masks it (`CASE WHEN asset.ownerId = userId THEN asset.isFavorite ELSE false END`) for album/partner sync.
- **Goal:** a space member syncing another owner's asset receives `isFavorite = false`; the owner still receives their true value.

**RED tests first** — `server/test/medium/specs/repositories/sync.repository.spec.ts`:

1. Owner A favorites asset X shared into space S. Member B's shared-space sync stream row for X → `isFavorite === false`.
2. Owner A's own sync stream row for X → `isFavorite === true`.

Expected RED: fork query selects raw `asset.isFavorite`, so test (1) sees `true`.

**Minimal implementation:** apply the same `CASE WHEN asset.ownerId = <syncing userId> THEN asset.isFavorite ELSE false END` mask to the fork's shared-space asset-sync select, matching upstream's album/partner masking.

**Edge cases:**

- Owner-owned asset unaffected (true value preserved).
- Multiple owners in one space — each member masked per row-owner.
- Delete/checkpoint rows unaffected (only the favorite projection changes).

**GREEN:** `cd server && pnpm test:medium -- --run src/repositories/sync.repository.spec.ts`
**Commit:** `fix(server): mask owner isFavorite in shared-space sync (LOW #1)`

---

### Slice 5 — M2: server People honors per-user `people.minimumFaces` (count == list)

- **Finding:** M2 · `server/src/services/person.service.ts:101–124` (and the other `withSharedSpaces` / people-stats call-sites at ~144/149/162/167) still read `machineLearning.facialRecognition.minFaces`.
- **Goal:** the `withSharedSpaces` People list and people-stats use the caller's `people.minimumFaces` preference (falling back to ML config when unset), so the People-page **count matches the list**.

**RED tests first** — `server/src/services/person.service.spec.ts`:

1. With user preference `people.minimumFaces = 5` and ML `minFaces = 3`, `getAllPeople({ withSharedSpaces: true })` passes `minimumFaceCount: 5` to the repository.
2. People-stats path passes `minimumFaceCount: 5` for the same user.
3. When `people.minimumFaces` is **unset**, both fall back to ML `minFaces` (3).
4. Count and list use the **same** threshold (assert both call-sites receive the identical resolved value).
5. **No double-filter:** the non-shared-space path must not be filtered twice — the threshold the service passes matches the SQL-side `people.minimumFaces` read at `person.repository.ts:334` (assert the resolved value the service uses equals the pref the SQL path already applies; no stricter-of-two mismatch).

Expected RED: current code passes ML `minFaces` (3) at all four call-sites → tests (1),(2),(4) fail.

**Minimal implementation:** resolve `const minimumFaceCount = preferences.people.minimumFaces ?? machineLearning.facialRecognition.minFaces;` once per request (load the caller's preferences) and pass it to every `withSharedSpaces` list variant **and** the people-stats query. Use `getPreferences(auth.user)` (or the existing preference accessor in `BaseService`).

**Edge cases:**

- `minimumFaces = 1` (min allowed) and a large value (e.g. 50) both threaded.
- Non-shared-space default path: confirm it is consistent (if upstream already honors the pref there via SQL at `person.repository.ts:334`, the fork's explicit `minimumFaceCount` must not override it inconsistently).
- Preference object missing entirely (older user row) → ML fallback, no throw.

**GREEN:** `cd server && pnpm test -- --run src/services/person.service.spec.ts`
**Commit:** `fix(server): honor per-user people.minimumFaces on shared-space People + stats (M2)`

---

### Slice 6 — LOW[12]: mobile offline shared-space People list honors `minimumFaces`

- **Finding:** LOW · `mobile/lib/domain/services/people.service.dart` — `getAllPeopleWithSharedSpaces` offline fallback calls `_repository.getAllPeople(...)` without the `prefs?.minimumFaces ?? 3` the online path uses (`people.provider.dart:46-50`).
- **Goal:** the offline shared-space People fallback filters by the user's `minimumFaces` preference, matching the online query.

**RED tests first** — `mobile/test/domain/services/people_service_test.dart` (create if absent):

1. With `prefs.minimumFaces = 5`, the offline `getAllPeopleWithSharedSpaces` fallback calls the repository with `minimumFaces: 5`.
2. With `prefs` null, it uses the default `3`.

Expected RED: fallback omits the argument → repository receives the repository default, not `5`.

**Minimal implementation:** pass `minimumFaces: prefs?.minimumFaces ?? 3` into the offline `getAllPeople` call in `getAllPeopleWithSharedSpaces`.

**Edge cases:** null prefs → 3; explicit 1; online path unchanged (regression-assert it still passes the pref).

**GREEN:** `cd mobile && mise exec -- flutter test test/domain/services/people_service_test.dart` (+ `mise exec -- dart analyze lib/domain/services/people.service.dart`)
**Commit:** `fix(mobile): offline shared-space People honors minimumFaces (LOW #12)`

---

### Slice 7 — H2 + M4 + LOW[14]: `GalleryTabShellRoute` rename misses + 3-tab index fix

- **Findings:** H2 `mobile/lib/providers/view_intent/view_intent_handler_android.dart:100`; M4 `mobile/lib/presentation/pages/drift_locked_folder.page.dart:46`; LOW[14] `mobile/lib/pages/common/tab_shell.page.dart` (off-by-one: upstream 4-tab constants vs fork 3-route `[MainTimeline, Spaces, DriftLibrary]`).
- **Goal:** every navigation into the shell uses the fork's `GalleryTabShellRoute`, and legacy `TabShellPage` tab-index invalidation matches the fork's 3-tab layout (Spaces=1, Library=2).

**RED tests first:**

1. **Guard (repo-invariant)** — `tools/upstream-preflight/src/mobile-nav.spec.ts` (new): scanning `mobile/lib/**/*.dart` finds **zero** push/navigation references to the bare upstream `TabShellRoute(` that are not `GalleryTabShellRoute(`. Expected RED: 2 hits (view-intent, locked-folder).
2. **Behavioral** — a widget/nav test asserting the Android view-intent handler and the locked-folder pause handler resolve to `GalleryTabShellRoute`. If a full widget test is impractical, assert via a unit test on the handler's target route symbol.
3. **Behavioral** — `tab_shell.page.dart` tab-index invalidation test: selecting the Spaces/Library tabs maps to indices 1/2 (not the 4-tab constants). Assert the invalidation no longer references `kSearchTabIndex`/`kLibraryTabIndex=3` for the 3-route router.

Expected RED: guard finds the two stale call-sites; tab-index test fails on off-by-one.

**Minimal implementation:** rename the two call-sites to `GalleryTabShellRoute`; fix `TabShellPage`'s tab-index constants to the fork's 3-route set (Photos=0, Spaces=1, Library=2).

**Edge cases:**

- Android share-to / "open with" deep-link lands on the correct 3-tab shell (H2).
- Locked-folder pause/resume returns to the fork shell (M4).
- Tab index at boundaries (first/last route) and an out-of-range guard.

**GREEN:** `cd tools/upstream-preflight && pnpm test -- --run src/mobile-nav.spec.ts` **and** `cd mobile && mise exec -- flutter test test/...tab_shell_test.dart && mise exec -- dart analyze lib/providers/view_intent/view_intent_handler_android.dart lib/presentation/pages/drift_locked_folder.page.dart lib/pages/common/tab_shell.page.dart`
**Commit:** `fix(mobile): route intents through GalleryTabShellRoute + 3-tab index (H2/M4/#14)`

---

### Slice 8 — M5: `assetV2` sync path applies the #627 motion-asset hide sweep

- **Finding:** M5 · `mobile/lib/infrastructure/repositories/sync_stream.repository.dart:246` — fork #627 sweep hiding live-photo motion parts runs on the old sync path but not the new v3 `assetV2` path, so motion assets reappear against a v3 server.
- **Goal:** the `assetV2` sync path hides live-photo motion parts identically to the legacy path.

**RED tests first** — `mobile/test/infrastructure/repositories/sync_stream_repository_test.dart`:

1. Feeding an `assetV2` sync batch containing a live-photo motion part results in that motion asset being marked hidden (same predicate #627 uses on the legacy path).
2. A non-motion asset in the same batch is unaffected.

Expected RED: motion asset remains visible on the `assetV2` path.

**Minimal implementation:** apply the #627 motion-part predicate to the `assetV2` ingestion in `sync_stream.repository.dart` (factor the shared predicate so both paths use one implementation).

**Edge cases:** motion part with/without a linked still; batch with mixed motion + normal; idempotent re-sync of the same batch.

**GREEN:** `cd mobile && mise exec -- flutter test test/infrastructure/repositories/sync_stream_repository_test.dart`
**Commit:** `fix(mobile): hide live-photo motion assets on assetV2 sync path (M5)`

---

### Slice 9 — LOW[11]/[13]: `peopleSortBy` StoreKey→SettingsKey upgrade migration

- **Finding:** LOW · `mobile/lib/utils/migration.dart` — legacy `StoreKey.peopleSortBy` (int 1015) removed with no migration to `SettingsKey.peopleSortBy` (`settings_key.dart:42`), so the People-page sort resets on upgrade.
- **Goal:** on upgrade, an existing `StoreKey(1015)` value is migrated into `SettingsKey.peopleSortBy`.

**RED tests first** — `mobile/test/utils/migration_test.dart`:

1. Given a legacy store with `StoreKey(1015)` = a known `PeopleSortBy` ordinal, running migration writes the equivalent `SettingsKey.peopleSortBy` value.
2. No legacy value → no write / default preserved.

Expected RED: no migration entry exists → target key stays default.

**Minimal implementation:** add a `StoreKey(1015) → SettingsKey.peopleSortBy` mapping to the migration routine, translating the legacy int ordinal to the new `PeopleSortBy` enum.

**Edge cases:** legacy value out of enum range → clamp to default; migration run twice is idempotent; fresh install (no legacy key) untouched.

**GREEN:** `cd mobile && mise exec -- flutter test test/utils/migration_test.dart`
**Commit:** `fix(mobile): migrate legacy peopleSortBy StoreKey to SettingsKey (LOW #11/#13)`

---

### Slice 10 — M1: realtime HLS transcoding — `ensureLocalFile` + trim-aware input

- **Finding:** M1 · `server/src/services/transcoding.service.ts` (~:240) — `getHlsCommand({ inputPath: asset.originalPath, ... })` spawns ffmpeg on a relative S3 key with no `ensureLocalFile`/`persistFile`, and ignores the fork's trimmed/encoded video.
- **Decision:** full fix — provide ffmpeg a real local path on S3-primary installs **and** prefer the fork's trimmed/encoded variant as input.
- **Goal:** on S3-primary storage the realtime-HLS ffmpeg gets a readable **local** input path (not a bare S3 key), the input is the fork's trimmed/encoded variant when present, and the downloaded temp file is materialized **once per session** and removed at session teardown.

**Architecture note (VERIFIED against the code — supersedes the earlier one-shot sketch):** HLS transcoding is **session-based and long-lived**, not one-shot. `startTranscode(session, variantIndex, startSegment)` (`transcoding.service.ts:180`) spawns a **persistent** ffmpeg via `processRepository.spawn` that streams segments into `variantDir` over the session's lifetime, and it is **re-invoked on seek / variant change** (kills the old process, spawns a new one on the same input). ffmpeg therefore reads `inputPath` for as long as the session lives — a `try/finally` cleanup around the spawn would delete the temp file **while ffmpeg is still reading it**. The local input must be materialized **once per session** and cleaned up in `onSessionEnd`.

**RED tests first** — `server/src/services/transcoding.service.spec.ts`:

1. With storage mocked as S3 (`asset.originalPath` a relative key), starting a transcode calls `ensureLocalFile(<trim-resolved input>)` and passes the returned `localPath` (not the raw key) to `getHlsCommand`.
2. When the fork's trimmed/encoded variant exists on `asset.files`, its path (not `originalPath`) is the input handed to `ensureLocalFile` — **mirror the fork's authoritative trim-input selection** (study how the non-realtime transcode / `handleVideoTrim` path in `media.service.ts` selects the trimmed input and replicate that predicate exactly; do not invent new `isEdited`/`EncodedVideo` semantics).
3. When no trimmed/encoded variant exists, `asset.originalPath` is used.
4. **Cleanup at session end:** the stored cleanup is invoked exactly once on `onSessionEnd` (and via `failSession`, which calls `onSessionEnd`), deleting the temp file. It is **NOT** invoked in a `finally` right after spawning ffmpeg.
5. **Re-transcode reuse:** a seek / variant-change re-invocation of `startTranscode` within the same session reuses the already-materialized local file (`ensureLocalFile` is called once per session, not per transcode).

Expected RED: current code passes `asset.originalPath` directly, never calls `ensureLocalFile`, and has no per-session input cleanup → (1),(2),(4),(5) fail.

**Minimal implementation:** resolve `inputSource = <fork trimmed/encoded variant path> ?? asset.originalPath`; materialize it once per session via `const { localPath, cleanup } = await this.ensureLocalFile(inputSource)` the first time the session starts a transcode, storing `localPath` + `cleanup` on the `Session` object (guard so later seek/variant transcodes reuse it); pass `inputPath: localPath` to `getHlsCommand`; in `onSessionEnd` invoke the stored `cleanup` (null-safe / idempotent). `ensureLocalFile` (`base.service.ts:398`) is a cheap passthrough on local storage (returns the original path, no-op cleanup), so disk installs are unaffected.

**Edge cases:**

- **Local (non-S3) storage:** `ensureLocalFile` returns the original path, cleanup is a no-op — assert a local asset still transcodes with the same effective path (no regression).
- Trim-variant selection mirrors the fork's exact selector (whatever predicate `handleVideoTrim` / media.service uses); assert it matches the non-realtime path, not a new rule.
- **Cleanup on every teardown path:** normal `onSessionEnd`, `failSession` (config/transcode failure), and the idle-session eviction (`cleanupInterval`) path each release the temp file exactly once; a session that never started a transcode has nothing to clean up (null-safe).
- **Re-transcode within a session** (seek/variant) reuses the cached local file — assert `ensureLocalFile` runs once per session, not per `startTranscode`.
- **Concurrent sessions** on the same asset get independent per-session temp files + independent cleanup (no shared-path clobber).
- No HLS output is persisted to S3 by this slice (segments stream from the local `variantDir` as upstream does) — do **not** add output persistence.

**GREEN:** `cd server && pnpm test -- --run src/services/transcoding.service.spec.ts`
**Commit:** `fix(server): realtime HLS uses local file + trimmed input on S3 (M1)`

---

### Slice 11 — LOW[4]: restore video-trim e2e transcoding coverage

- **Finding:** LOW · `e2e/src/specs/server/api/video-trim.e2e-spec.ts` sets `config.ffmpeg.transcode = Disabled` in `beforeAll` (main did not), dropping coverage of the trim-from-encoded-video input branch (`media.service.ts:294-295`).
- **Goal:** e2e exercises the trim path with transcoding **enabled**, covering the encoded-video input selection that Slice 10 also relies on.

**RED test first:** modify `video-trim.e2e-spec.ts` to add a case with transcoding enabled that trims an asset which has an encoded variant, asserting the trim reads the encoded input and produces a correctly trimmed output. Expected RED (before restoring): the new assertion fails / the branch is uncovered because transcoding is globally disabled in `beforeAll`.

**Minimal implementation:** stop force-disabling transcoding for the trim-from-encoded case (scope the `Disabled` override to only the tests that need it, or add an enabled variant), and assert the encoded-input branch.

**Edge cases:** trim from raw original (no encoded variant) still works; trim from encoded variant; S3 vs disk if the e2e matrix supports it.

**GREEN:** `cd e2e && pnpm test -- --run src/specs/server/api/video-trim.e2e-spec.ts`
**Commit:** `test(e2e): cover trim-from-encoded input with transcoding enabled (LOW #4)`

---

### Slice 12 — Branding batch: M6 + M7 + M8 + LOW[20] + LOW[21] + LOW[22]

- **Findings:**
  - M6 `branding/scripts/apply-branding.sh:158` — target string for renamed `ServerStatus.svelte` no longer matches (sidebar new-release link + repo check ship unbranded).
  - M7 `branding/i18n/overrides-en.json` — 9 new upstream i18n keys containing "Immich" (What's New, admin integrity, notifications, feature settings) uncovered.
  - M8 `branding/config.json:18` — `upstream.version` still `2.7.5`; set to **`3.0.0`** (the Immich base). Distinct from Gallery's own release version (5.0.0). Feeds "Based on Immich vX" release notes + `gallery-revert-to-immich-validation.yml` upstream-tag checkout.
  - LOW[20] `apply-branding.sh` `patch_cli`/`patch_versions` still target `cli/` + `open-api/typescript-sdk/` (moved to `packages/cli` + `packages/sdk` in v3).
  - LOW[21] iOS debug/profile bundle-id patterns stale (`app.alextran.immich.vdebug/.profile` → `app.futo.immich.debug/.profile`).
  - LOW[22] `ErrorLayout.svelte` moved to `web/src/routes/` — branding + verify still point at `web/src/lib/components/layouts/` (also affects `main`).
- **Goal:** `apply-branding.sh` rewrites every current-tree location and `verify-branding.sh` reports **zero** Immich leaks in built web + mobile artifacts, and `upstream.version` is correct.

**RED tests first (verification-driven):**

1. `bash branding/scripts/verify-branding.sh` on the pre-fix tree **fails** (ServerStatus link, 9 i18n keys, ErrorLayout, CLI/SDK paths). Capture the failing leak list as RED.
2. `bash branding/scripts/test-i18n-branding.sh` **fails** on the 9 uncovered keys.
3. **Guard** — `tools/upstream-preflight/src/branding-targets.spec.ts` (new): every file path referenced by `apply-branding.sh` (ServerStatus, ErrorLayout, `packages/cli/package.json`, `packages/sdk`, iOS pbxproj patterns) **exists** in the tree. Expected RED: several targets missing.
4. **Guard** — assert `branding/config.json` `upstream.version === '3.0.0'`. Expected RED: `2.7.5`.

**Minimal implementation:** update `apply-branding.sh` targets (ServerStatus, ErrorLayout, `patch_cli`/`patch_versions` → `packages/cli`/`packages/sdk` **and** remove the now-dead `build-old-root` reference from `patch_versions` [this slice owns that edit; Slice 19 only deletes the directory], iOS debug/profile bundle-id seds), add the 9 branded overrides to `overrides-en.json`, set `config.json` `upstream.version` to `3.0.0`, and update `verify-branding.sh` `url_check_files` for the moved ErrorLayout.

**Edge cases:**

- Run `apply-branding.sh` end-to-end (idempotent) then `verify-branding.sh` → clean.
- The 9 i18n keys map to correct branded wording (Immich→Gallery) and remain valid JSON; `$t` completeness scan passes.
- `gallery-revert-to-immich-validation.yml` would resolve `v3.0.0` as a real upstream tag (note in the plan; do not run the workflow).
- LOW[22] pre-exists on `main` — fix on rolling only; note it.

**GREEN:** `bash branding/scripts/apply-branding.sh && bash branding/scripts/verify-branding.sh && bash branding/scripts/test-i18n-branding.sh && cd tools/upstream-preflight && pnpm test -- --run src/branding-targets.spec.ts`
**⚠️ Do not commit branded output** (per CLAUDE.md) — commit only the _scripts/config/overrides_ changes; revert any files the script rewrote in the tree.
**Commit:** `fix(branding): retarget renamed files, cover 9 i18n keys, upstream.version 3.0.0 (M6-M8/#20-22)`

---

### Slice 13 — LOW[8]: restore branded loading spinner in `ActivityViewer` + `DetailPanel`

- **Finding:** LOW · `web/src/lib/components/asset-viewer/ActivityViewer.svelte` (+ DetailPanel) — fork swaps `@immich/ui` `LoadingSpinner` for the fork-local branded one in 25 files; the swap was dropped in these 2 during the rebase.
- **Goal:** both components render the fork-local branded `LoadingSpinner` (`$lib/components/shared-components/LoadingSpinner.svelte`).

**RED test first — guard** — `tools/upstream-preflight/src/branded-spinner.spec.ts` (new, repo import-scan): the set of files importing `@immich/ui`'s `LoadingSpinner` does **not** include any of the fork's 25 swapped files; `ActivityViewer.svelte` and `DetailPanel` import the fork-local `$lib/components/shared-components/LoadingSpinner.svelte`. Expected RED: those 2 import the generic one.

**Minimal implementation:** swap the two imports to the fork-local `LoadingSpinner`.

**Edge cases:** both light/dark asset variants referenced by the fork spinner exist; no other of the 25 files regressed (guard asserts the whole set).

**GREEN:** `cd tools/upstream-preflight && pnpm test -- --run src/branded-spinner.spec.ts` (+ `cd web && pnpm check`)
**Commit:** `fix(web): restore branded LoadingSpinner in ActivityViewer/DetailPanel (LOW #8)`

---

### Slice 14 — LOW[9]: `WorkflowSummary` close-button i18n

- **Finding:** LOW · `web/src/routes/(user)/workflows/[workflowId]/WorkflowSummary.svelte` — a fork i18n hunk (hardcoded string → `$t()`) was dropped when upstream moved the workflows route.
- **Goal:** the close-button label uses `$t(...)` with an existing i18n key.

**RED test first:** a component/guard test (co-located `WorkflowSummary.spec.ts`, or a web guard scanning the file) asserting `WorkflowSummary.svelte` contains no hardcoded English close-button string and references a valid translation key. Expected RED: hardcoded string present.

**Minimal implementation:** re-apply the `$t()` conversion using the existing key (same key `main` used).

**Edge cases:** key exists in `i18n/en.json`; no missing-key runtime warning; matches the other two workflow files already i18n'd.

**GREEN:** `cd web && pnpm test -- --run "src/routes/(user)/workflows/[workflowId]/WorkflowSummary.spec.ts"` (+ `pnpm check`)
**Commit:** `fix(web): i18n WorkflowSummary close button (LOW #9)`

---

### Slice 15 — LOW[10]: command-palette "Server Stats" → real route

- **Finding:** LOW · `web/src/lib/managers/navigation-items.ts` — Server Stats item hardcodes `route: '/admin/system-statistics'`, which does not exist; the real page is `web/src/routes/admin/server-status`, and the fork's `Route` helper already maps it.
- **Goal:** the palette entry points at the existing route (via the `Route` helper, not a hardcoded string).

**RED test first** — `web/src/lib/managers/navigation-items.spec.ts` (or existing nav spec): every command-palette `route` resolves to an existing route module; the Server Stats entry resolves to `/admin/server-status`. Expected RED: `/admin/system-statistics` resolves to nothing.

**Minimal implementation:** replace the hardcoded route with the `Route` helper's server-status mapping.

**Edge cases:** guard covers **all** palette routes (catches future stale entries), not just this one; deep-link navigation lands on the page.

**GREEN:** `cd web && pnpm test -- --run src/lib/managers/navigation-items.spec.ts` (+ `pnpm check`)
**Commit:** `fix(web): command-palette Server Stats targets real route (LOW #10)`

---

### Slice 16 — LOW[5]: takeout uploader drops removed DTO fields

- **Finding:** LOW · `web/src/lib/utils/google-takeout-uploader.ts` still sends `deviceAssetId`/`deviceId` form fields that v3 removed from `AssetMediaCreateDto` (canonical `file-uploader.ts` no longer sends them).
- **Goal:** the takeout upload payload matches the current `AssetMediaCreateDto` (no `deviceAssetId`/`deviceId`).

**RED test first** — `web/src/lib/utils/google-takeout-uploader.spec.ts`: the built upload form contains only the v3 DTO fields (`fileCreatedAt`, `fileModifiedAt`, `duration`, `filename`, `isFavorite`, `visibility`, `livePhotoVideoId`, `metadata`, `sidecarData`) and **not** `deviceAssetId`/`deviceId`. Expected RED: both stale fields present.

**Minimal implementation:** remove the two fields from the takeout uploader's form construction, matching `file-uploader.ts`.

**Edge cases:** livePhoto pairing still works; `filename`/`fileCreatedAt` preserved; server accepts the payload (no field newly required).

**GREEN:** `cd web && pnpm test -- --run src/lib/utils/google-takeout-uploader.spec.ts` (+ `pnpm check`)
**Commit:** `fix(web): drop removed deviceAssetId/deviceId from takeout upload (LOW #5)`

---

### Slice 17 — LOW[2]/[15]: rename colliding migration timestamp `1778800000000`

- **Finding:** LOW · `server/src/schema/migrations-gallery/1778800000000-ReconcileFaceIdentityIndexOverrides.ts` collides with `1778800000000-TrimSpacePersonNameIndex.ts`; Kysely orders by full name string so it is benign today but violates CLAUDE.md's unique-timestamp rule and is a latent postbuild-clobber risk.
- **Goal:** no two fork migrations share a timestamp.

**RED test first — guard** — `tools/upstream-preflight/src/migration-timestamps.spec.ts` (new): timestamps parsed from `server/src/schema/migrations-gallery/*.ts` are **unique**. Expected RED: `1778800000000` appears twice.

**Minimal implementation:** rename `ReconcileFaceIdentityIndexOverrides` to a new unique round timestamp **after** both current ones (preserve apply order; do not reorder relative to what has already run on staging/RC DBs — pick a timestamp greater than both to keep ordering identical). Update the class name suffix if convention requires.

**Edge cases:**

- New timestamp must not collide with any upstream `migrations/` timestamp either — guard scans both dirs.
- Ordering preserved: the renamed migration still runs after `TrimSpacePersonNameIndex` (choose `> 1778800000000`).
- Confirm no DB has recorded it under the old name yet (if staging/RC already ran it, coordinate — note in plan; likely not yet applied since it's a recent rebase migration).

**GREEN:** `cd tools/upstream-preflight && pnpm test -- --run src/migration-timestamps.spec.ts` (+ `cd server && pnpm check`)
**Commit:** `fix(server): unique timestamp for ReconcileFaceIdentityIndexOverrides migration (LOW #2/#15)`

---

### Slice 18 — LOW[16] + [17]: document the postbuild alias + guard it

- **Findings:** LOW[16] `server/bin/sync-gallery-migrations.mjs` writes a build-time alias (`1777667825574-ChangeDurationToInteger` → `1776735180298-ChangeDurationToInteger`) so v5-RC databases that ran the migration under its pre-rename upstream timestamp pass Kysely's missing-migration check; LOW[17] `CLAUDE.md` still describes the postbuild hook as a plain `cp`, hiding the alias + stale-cleanup behavior.
- **Decision:** **keep the alias** (load-bearing for the RC/staging upgrade path) — document it and guard it so a future rebase cannot silently drop it.
- **Goal:** `CLAUDE.md` accurately describes `sync-gallery-migrations.mjs` (Gallery-migration copy + stale-copy cleanup + compatibility alias, and _why_ the alias exists), and a test fails if the alias entry disappears.

**RED tests first:**

1. **Guard** — `server` vitest (e.g. `server/bin/sync-gallery-migrations.spec.ts` or a tools spec): the `compatibilityAliases` array includes the `1777667825574 → 1776735180298` `ChangeDurationToInteger` entry, and given a dist fixture with the source file, `syncCompatibilityAliases` produces the aliased copy. Expected RED: write the guard so it references the aliasing behavior; if a test already covers copy but not the alias, extend it — RED is the missing alias assertion.
2. **Doc guard** — assert `CLAUDE.md` mentions `sync-gallery-migrations.mjs` and no longer describes the postbuild as only a `cp` (grep-based content check). Expected RED: current CLAUDE.md says `cp`.

**Minimal implementation:** rewrite the "Fork migration layout — postbuild" section of `CLAUDE.md` to describe the three behaviors and the RC-compatibility rationale; add/extend the alias guard test.

**Edge cases:** alias only written when the source file exists (fresh trees without it don't error); guard tolerates future additional alias entries (asserts inclusion, not exact-equality).

**GREEN:** `cd server && pnpm test -- --run bin/sync-gallery-migrations.spec.ts` (+ doc grep guard)
**Commit:** `docs(server): document + guard the migration compatibility alias (LOW #16/#17)`

---

### Slice 19 — LOW[19]/[24] + LOW[18]: delete stale SDK build + re-wire orphaned Dart patch

- **Findings:** LOW[19]/[24] `open-api/typescript-sdk/build-old-root/` — ~285KB of stale compiled SDK (287 vs live 317 fns), dead directory, nothing references it; LOW[18] `open-api/bin/generate-dart-sdk.sh` — fork's `native_class_nullable_items_in_arrays.patch` (main applied it in `generate-open-api.sh`) is orphaned by upstream's script rewrite, so generated Dart models no longer type nullable-item arrays as `List<T?>`.
- **Goal:** the dead build directory is removed, and Dart generation re-applies the nullable-items patch.

**RED tests first:**

1. **Guard** — `tools/upstream-preflight/src/repo-hygiene.spec.ts` (new): `open-api/typescript-sdk/build-old-root/` does **not** exist in the tree. Expected RED: it exists.
2. **Guard/behavioral** — `generate-dart-sdk.sh` applies `native_class_nullable_items_in_arrays.patch` (assert the script references the patch; if feasible, assert a generated model uses `List<T?>` for a known nullable-item array). Expected RED: patch not referenced.

**Minimal implementation:** `git rm -r open-api/typescript-sdk/build-old-root/`; add the `patch ... < native_class_nullable_items_in_arrays.patch` step into `generate-dart-sdk.sh` at the equivalent point main used. (The `apply-branding.sh` `patch_versions` reference to `build-old-root` is removed in Slice 12 — this slice only deletes the directory and re-wires the Dart patch, so run Slice 12 first or confirm that edit landed.)

**Edge cases:** deleting the dir doesn't break any import (guard already proved nothing references it); patch applies cleanly against the current template (verify with a dry-run in the plan); Dart codegen (`mise //:open-api-dart`) still succeeds.

**GREEN:** `cd tools/upstream-preflight && pnpm test -- --run src/repo-hygiene.spec.ts`
**Commit:** `chore(open-api): drop stale build-old-root, re-wire Dart nullable-items patch (LOW #18/#19/#24)`

---

### Slice 20 — LOW[3]: fix stale `ownership.yml` owned_path

- **Finding:** LOW · `docs/fork/ownership.yml` lists `web/src/lib/components/users/**` (alias user-groups) which matches no files on either branch; the group UI lives in `web/src/lib/components/user-settings-page/` + `web/src/lib/modals/`.
- **Goal:** every `owned_path` glob in `ownership.yml` matches ≥1 file.

**RED test first — guard** — `tools/upstream-preflight/src/manifest.spec.ts` (extend existing): every `owned_path` in `ownership.yml` resolves to ≥1 tracked file. Expected RED: `web/src/lib/components/users/**` matches nothing.

**Minimal implementation:** replace the stale glob with the real group-UI paths (`web/src/lib/components/user-settings-page/**` and/or `web/src/lib/modals/**` as appropriate to the user-groups feature).

**Edge cases:** the replacement globs actually match the group UI (assert the feature's known component); no other `owned_path` regressed (guard covers all).

**GREEN:** `cd tools/upstream-preflight && pnpm test -- --run src/manifest.spec.ts`
**Commit:** `fix(fork): correct stale user-groups owned_path in ownership.yml (LOW #3)`

---

### Slice 21 — LOW[23]: sync `gallery-build-mobile` pigeon list

- **Finding:** LOW · `.github/workflows/gallery-build-mobile.yml` "Generate platform APIs" hardcodes a 7-file pigeon `--input` list, but `mobile/pigeon/` now has 9 inputs (upstream added `permission_api.dart`, `view_intent_api.dart`).
- **Goal:** the workflow's pigeon input list equals the set of `mobile/pigeon/*.dart`.

**RED test first — guard** — `tools/upstream-preflight/src/pigeon-inputs.spec.ts` (new): the pigeon `--input` paths parsed from `gallery-build-mobile.yml` equal the `mobile/pigeon/*.dart` set. Expected RED: 2 missing.

**Minimal implementation:** add the two inputs to the workflow's pigeon generation step.

**Edge cases:** guard is order-insensitive (set equality); catches future additions/removals; each listed input file exists.

**GREEN:** `cd tools/upstream-preflight && pnpm test -- --run src/pigeon-inputs.spec.ts`
**Commit:** `fix(ci): add permission/view-intent pigeon inputs to mobile build (LOW #23)`

---

### Slice 22 — LOW[6]: hide the no-op release-channel selector

- **Finding:** LOW · upstream v3 added a stable/RC "release channel" dropdown (`NewVersionCheckSettings.svelte`, `SystemConfigNewVersionCheckDto.channel`), and `getLatestRelease()` appends `?channel=`; but the fork overrides the version-check URL (`server-info.repository.ts`) so the channel is a silent no-op.
- **Decision:** **hide the dropdown** (no user-facing control that does nothing); do not wire the fork endpoint to serve channels.
- **Goal:** the release-channel dropdown is not rendered in the fork build.

**RED test first** — co-located component test `NewVersionCheckSettings.spec.ts` (path resolved from the component location at plan time): the stable/RC channel `<select>` is **absent** in the fork build. Expected RED: it renders.

**Minimal implementation:** conditionally omit the channel selector (fork branding/config flag or a straight removal in the fork-branded settings component). Keep the DTO field accepted server-side (harmless) so no API/regen churn.

**Edge cases:** the rest of the new-version-check settings still render/save; no console error from a missing bound value; the hidden control doesn't send `channel` (or sends the default, ignored by the fork endpoint).

**GREEN:** `cd web && pnpm test -- --run NewVersionCheckSettings.spec.ts` (+ `pnpm check`)
**Commit:** `fix(web): hide inert release-channel selector (LOW #6)`

---

## 5. Out of scope

- **#739 / local↔origin divergence** — already reconciled into local (`2c0e3c7d02`); no action.
- **The force-push itself** — manual, human-gated, via `push-rebase` after the loop; never automatic.
- **Coverage gaps 1–4** (memories rule-engine job-graph, `tools/upstream-preflight` self-audit, workflow/plugin asset-triggers vs space RBAC, DB-backup vs dual-backend) — a **separate second-pass audit**, not remediation.

## 6. Final gate (after all slices)

0. **Regenerate committed generated artifacts** (do this FIRST, as its own `chore:` commit): several server slices change `@GenerateSql`-decorated query SQL — S2 (`searchAssetBuilder` in `utils/database.ts`, consumed by `searchMetadata`/`searchStatistics`/`searchRandom`/`searchLargeAssets`) and S3 (`getAccessibleTags`) both alter the emitted SQL, so `server/src/queries/*.sql` is stale and **CI "SQL Schema Checks" will fail without regen**. Run `mise //:sql` (**requires a live Postgres** — spin a throwaway container first; running it with no DB deletes all `.sql`). If any slice ended up changing a server DTO/controller (none planned), also run `mise //:open-api`. Commit the regenerated files. CI only runs on push, so intermediate slice commits carrying stale generated files are harmless — only the pre-push tree must be regenerated.
1. `make check-all` (tsc/svelte-check across packages) — green.
2. `make lint-all` — the single deferred lint pass — green.
3. Server medium tests for the RBAC slices (`pnpm test:medium`) — green (needs Docker DB).
4. Mobile: scoped `dart analyze` over all changed files + `flutter test` for the changed suites — green.
5. All 34 findings' **Status** lines in the findings doc read `FIXED (slice Sn)`.
6. Present the diff summary + the force-push decision to the user; run `push-rebase` **only** on explicit approval.

## 7. Slice → finding traceability

| Slice | Findings                   | Package     | Primary test            |
| ----- | -------------------------- | ----------- | ----------------------- |
| S1    | H1                         | server      | unit                    |
| S2    | M3                         | server      | medium                  |
| S3    | LOW#7                      | server      | medium repo             |
| S4    | LOW#1                      | server      | medium repo             |
| S5    | M2                         | server      | unit                    |
| S6    | LOW#12                     | mobile      | flutter test            |
| S7    | H2, M4, LOW#14             | mobile      | guard + widget          |
| S8    | M5                         | mobile      | flutter test            |
| S9    | LOW#11/#13                 | mobile      | flutter test            |
| S10   | M1                         | server      | unit                    |
| S11   | LOW#4                      | e2e         | e2e                     |
| S12   | M6, M7, M8, LOW#20/#21/#22 | branding    | verify-branding + guard |
| S13   | LOW#8                      | web         | guard                   |
| S14   | LOW#9                      | web         | component               |
| S15   | LOW#10                     | web         | nav spec                |
| S16   | LOW#5                      | web         | unit                    |
| S17   | LOW#2/#15                  | server      | guard                   |
| S18   | LOW#16/#17                 | server/docs | guard + doc grep        |
| S19   | LOW#18/#19/#24             | open-api    | guard                   |
| S20   | LOW#3                      | tooling     | manifest guard          |
| S21   | LOW#23                     | ci          | guard                   |
| S22   | LOW#6                      | web         | component               |
