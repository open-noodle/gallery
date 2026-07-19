# Slice 5 — Mobile sync safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close mobile-1 (version-skew total sync outage) and mobile-2 (library-unlink sweep deletes album-reachable assets) — two silent, near-total failures for real users of the space-albums feature.

**Architecture:** Two mobile fixes plus one defense-in-depth server fix, in three commits.
(1) **mobile-1** — the 5 new `SharedSpaceAlbum*` request types are added to the `/sync/stream` body **unconditionally** (`sync_api.repository.dart:99-104`); an older fork server's `z.enum` (`SyncRequestTypeSchema`) rejects the unknown values with a **400 for the whole request** → total sync outage on an app that is ahead of the server. Fix: gate the 5 types behind a **fork-server version** check, mirroring the existing collection-`if` gates. (2) **server filter** — make `/sync/stream` **drop** unknown request types instead of 400-ing the whole request, so future skew degrades gracefully (the service loop already ignores types it doesn't handle). (3) **mobile-2** — `deleteLibrariesV1`'s orphan sweep (`sync_stream.repository.dart:805-817`) preserves owner/partner/`shared_space_asset` but **not** `shared_space_album_asset` (the album path this feature encourages) nor `remote_album_asset` (a pre-existing classic-album gap); unlinking a library deletes the shared `remote_asset` row and the asset vanishes from album detail + space timeline. Fix: add both to the sweep keep-set.

**Tech Stack:** Flutter/Dart (mobile, Drift + mocktail + `flutter_test`, run via `mise exec -- flutter`/`mise exec -- dart`, pinned Flutter 3.44.1 from `mobile/mise.toml`); NestJS 11 + Zod v4.3.6 + nestjs-zod v5 (server DTO); vitest unit + e2e (`e2e/`) on the server side.

---

## 0. Orientation, key decisions, and environment constraints

Read this whole section before touching code. It resolves the version-boundary question (the crux of mobile-1), pins the exact Drift table/column names for mobile-2, settles the server-filter shape, and bakes in the local tooling reality.

### 0.1 The mobile-1 version threshold — the crucial investigation and decision

**Question:** what version does a Gallery/fork **server** report to the mobile app once it supports the 5 `SharedSpaceAlbum*` request types, so the client gate admits exactly the servers that have the enum values and no others?

**Evidence gathered (all confirmed against this worktree):**

1. **What the server reports = the `version` field of `server/package.json`.** `serverVersion` (`server/src/constants.ts:57-59`) is `new SemVer(JSON.parse(readFileSync('server/package.json')).version)`. `VersionService.getVersion()` (`version.service.ts:71-73`) returns it, and `GET /server/version` serves it. Mobile reads it via `_api.serverInfoApi.getServerVersion()` (`sync_stream.service.dart:60`).
2. **In source, that version is `3.0.1`** (the upstream Immich base after the v3 rebase). But **at Docker build time, `branding/scripts/apply-branding.sh` `patch_versions()` (lines 782-806) rewrites `server/package.json`'s `.version` to `FORK_VERSION`** (the fork release, e.g. `5.0.0`). `patch_versions` is in the branding `main()` flow (line 829); CI passes `FORK_VERSION` from the release input, falling back to the latest fork `vX.Y.Z` git tag (`.github/actions/apply-branding/action.yml:37`, script lines 48-53). This version-stamping was **added 2026-07-03** (commit `d7a1e3f177` "add version stamping to apply-branding script").
3. **Therefore a _deployed_ fork server reports the FORK release version (5.x), NOT the upstream Immich version (3.0.1).** Corroborated operationally: the whole deployed fleet reports `v5.0.0-rc.0` / `v5.0.0`. This **refutes** the spec/review assumption that "the fork server reports the upstream Immich version" — that was true _before_ 2026-07-03; the version-stamping commit changed the regime. It is why a naive `>= SemVer(3,0,0)` copied from the OCR gate would be **wrong** in the _opposite_ direction the spec expected: a fork server reports `5.x`, which is `>= 3.0.0` for the wrong reason (5 > 3 numerically), and the gate would fire against every already-released fork server that has **no** `SharedSpaceAlbum*` enum values → the exact 400 outage.
4. **When did the enum values ship?** `SharedSpaceAlbum*` was added to `server/src/enum.ts` `SyncRequestType` on branch `space-albums-onto-main` (dispatch wiring commit `d6ea4eb6c5`, 2026-07-03). **This feature is not yet merged/released** — `v5.0.0` (already tagged) does **not** contain space-albums. The enum values (and the server emitters) ship in the **first fork release after v5.0.0**.
5. **The `> 2.7.5` precedent** (`sync_stream.service.dart:142`) is a fork-version gate written under the _old_ (pre-stamping) regime; under the new regime a fork `5.x` server trivially satisfies `> 2.7.5`. It confirms the _shape_ (a fork-specific version gate) but its numeric value is not a usable analog for the album boundary.

**The boundary cannot be pinned to an exact release number from code alone** (the space-albums release is a future decision; the only known facts are: it is a fork version, strictly newer than the last release `v5.0.0`, and it ships mobile + server together). Per the spec's instruction for this case, the design uses the **server-side filter (Commit 2) as the primary robustness mechanism** and the **client gate as the best-available signal**:

**DECISION — client gate: `serverVersion > const SemVer(major: 5, minor: 0, patch: 0)`.** Reasons:

- **It excludes every currently-released fork server (≤ v5.0.0).** Those are exactly the servers that have **neither** the enum values **nor** the server filter — the real, existing outage surface. `>` (strictly greater) means `5.0.0` itself is excluded (correct: v5.0.0 lacks the enum).
- **It includes the feature release and its release-candidates.** The feature ships as some vNext > 5.0.0 (e.g. `5.0.1` or `5.1.0`) and is validated on RC builds (e.g. `5.1.0-rc.0`). With `>`, `SemVer(5,1,0,prerelease:0) > SemVer(5,0,0)` is `true` (minor 1 > 0), and `SemVer(5,0,1) > SemVer(5,0,0)` is `true` (patch 1 > 0) — so RC validation and the GA release both activate the types. (A `>= SemVer(5,1,0)` form would **exclude** `5.1.0-rc.0`, breaking RC validation, and would silently disable the feature if it shipped as a `5.0.x` patch — a worse failure mode.)
- **Failure mode is bounded and gracefully mitigated.** The only residual risk is a _non-feature_ `5.0.x` hotfix cut from the v5.0.0 line **before** the feature merges: it would report `> 5.0.0`, the client would send the album types, and — because that hotfix predates the server filter — it would 400. This is (a) controllable by release ordering (do not cut a `5.0.x` hotfix between now and the feature release, or cut the feature as the next release), and (b) flagged below as a release-time reconciliation.
- **`serverVersion` is never null here.** `SyncStreamService.sync()` (`sync_stream.service.dart:60-64`) aborts the entire sync (returns `false`) when `getServerVersion()` is null, _before_ `streamChanges` is called. So inside `sync_api.repository.dart` `serverVersion` is always a valid `SemVer`, and the spec's "missing/unparseable → treat as old / fail-safe" is satisfied two ways: (i) null aborts sync entirely upstream, and (ii) any parseable-but-old version (≤ 5.0.0) is excluded by `>`.

**RELEASE-TIME RECONCILIATION (call out in the PR):** before the space-albums feature is released, confirm the actual release tag and, if a non-feature `5.0.x` was (or will be) released first, tighten the gate to `>= SemVer(<exact feature version>)`. The `> 5.0.0` value is the correct, safe lower bound **given no `5.0.x` exists today** (`git tag -l 'v5.*'` shows only `v5.0.0-rc.0`, `v5.0.0`).

### 0.2 The mobile-2 Drift table/column names (confirmed against the entity classes)

Drift generates `snake_case` table names from the `PascalCase` entity class and `snake_case` column names from `camelCase` getters. Confirmed by reading the entity sources:

- `SharedSpaceAlbumAssetEntity` → table **`shared_space_album_asset_entity`**, columns **`album_id`**, **`asset_id`** (`mobile/lib/infrastructure/entities/shared_space_album_asset.entity.dart:16-17`; the index SQL literals in that file also spell `shared_space_album_asset_entity (album_id)` and `(asset_id, album_id)`).
- `RemoteAlbumAssetEntity` → table **`remote_album_asset_entity`**, columns **`album_id`**, **`asset_id`** (`mobile/lib/infrastructure/entities/remote_album_asset.entity.dart:12-14`; index literal `remote_album_asset_entity (album_id, asset_id)`).
- (existing, already in the sweep) `SharedSpaceAssetEntity` → `shared_space_asset_entity (space_id, asset_id)`.

Both new keep-set predicates select **`asset_id`** from these tables, matching the existing `... IN (SELECT asset_id FROM shared_space_asset_entity)` clause.

### 0.3 The server filter — shape, blast radius, and why no SDK regen

**Where the 400 comes from:** `SyncStreamSchema.types = z.array(SyncRequestTypeSchema)` (`sync.dto.ts:719`), and `SyncRequestTypeSchema = z.enum(SyncRequestType)` (`enum.ts:1128-1131`). Any array element not in the enum fails validation in the global `ZodValidationPipe` **before** the controller runs → 400 for the whole request.

**Why dropping unknowns is safe:** `SyncService.stream()` already iterates `SYNC_TYPES_ORDER.filter((type) => dto.types.includes(type))` (`sync.service.ts:260`) — it only ever handles types it knows and **silently ignores** any extra `dto.types` entry. So dropping unknown types at the DTO boundary changes nothing downstream; it only converts a hard 400 into graceful degradation.

**Chosen shape — `z.preprocess` filter (matches an existing in-repo pattern):**

```ts
const KNOWN_SYNC_REQUEST_TYPES = new Set<string>(Object.values(SyncRequestType));

const SyncStreamSchema = z
  .object({
    types: z
      .preprocess(
        (value) =>
          Array.isArray(value) ? value.filter((type) => KNOWN_SYNC_REQUEST_TYPES.has(type as string)) : value,
        z.array(SyncRequestTypeSchema),
      )
      .describe('Sync request types'),
    reset: z.boolean().optional().describe('Reset sync state'),
  })
  .meta({ id: 'SyncStreamDto' });
```

- **Unknown enum _values_ inside a valid array → dropped** (no 400). Known values validate normally.
- **Structural malformation is NOT masked:** a non-array `types` (e.g. a bare string) or a missing `types` passes straight through `preprocess` unchanged and still fails `z.array(...)` → 400. This preserves strict parsing for genuinely malformed requests.
- **No SDK regen.** `z.preprocess((v)=>…, z.array(X))` is exactly the pattern already used by `time-bucket.dto.ts:49-58` (`personIds`/`spacePersonIds`/`tagIds`), which renders in `open-api/immich-openapi-specs.json` as `{"type":"array","items":{…}}` — the OpenAPI generator uses the inner (output) schema, so `SyncStreamDto.types` stays `array of SyncRequestType`, byte-identical to today. Verified by inspecting the generated spec (the timeline/search/map endpoints' preprocess-array params all render as typed arrays, never `unknown`).

**Two existing tests assert the OLD 400 behavior and MUST be updated in Commit 2 (they will otherwise fail):**

- `server/src/controllers/sync.controller.spec.ts:33-44` — "should require sync request type enums" posts `{ types: ['invalid'] }` and asserts **400**. After the filter, `['invalid']` → `[]` (no 400). Repurpose this to assert a **structural** 400 (non-array `types`), keeping controller-level validation coverage without the mocked-service response-hang problem (the `SyncService` is mocked, so a 200 path never writes to `@Res()` and would hang). The unknown-drop behavior moves to the new `sync.dto.spec.ts` and the e2e.
- `e2e/src/specs/server/api/sync.e2e-spec.ts:79-90` — "rejects an invalid SyncRequestType enum value" posts `{ types: ['NotARealType'] }` and asserts **400**. Repurpose to assert the new drop-unknown behavior over the real HTTP seam.

The `DELETE /sync/ack` "should require sync response type enums" test (`sync.controller.spec.ts:77`) uses a **different** schema (`SyncEntityTypeSchema`, not `SyncRequestTypeSchema`) and is **unchanged** — the filter is scoped to `SyncStreamSchema.types` only.

### 0.4 Environment / tooling constraints (bake into commands)

- **Mobile Flutter is pinned to 3.44.1** (`mobile/mise.toml`). Run everything from the `mobile/` dir via `mise exec --`:
  - Single test file: `mise exec -- flutter test test/<path>_test.dart`
  - CI-equivalent analyze (whole package incl. `test/`): `mise exec -- dart analyze --fatal-infos lib test` (CI runs `dart analyze --fatal-infos`; passing `lib test` matches its scope — `lib`-only would miss test-file lints).
- **Codegen prerequisite:** the worktree has **no `.dart_tool/`** yet — run `mise exec -- flutter pub get` in `mobile/` **once** before the first `flutter test`/`dart analyze`. **`build_runner` is NOT needed:** the Drift accessors (`db.sharedSpaceAlbumAssetEntity`, `db.remoteAlbumAssetEntity`) and the generated `SyncRequestType` Dart enum symbols (`sharedSpaceAlbumsV1` … `sharedSpaceAlbumAssetExifsV1` in `mobile/openapi/lib/model/sync_request_type.dart`) already exist in-tree, and this slice changes **no** entity definition or OpenAPI surface. (Fallback only: if `flutter test` fails to compile citing a missing generated `*.g.dart` translation file, run `mise run codegen:translation` — but the two target test files touch no translations, so this should not arise.)
- **No mobile OpenAPI/SDK regen.** mobile-1 gates an existing request-type list; mobile-2 edits raw Drift SQL. Neither touches generated OpenAPI code.
- **Server unit tests run locally (no Docker):** `cd server && pnpm test --run <path>` (vitest; `sync.dto.spec.ts` is pure Zod, `sync.controller.spec.ts` uses an in-memory Nest + mocked service). **Medium tests and e2e need Docker, which is DOWN** — author the e2e exactly per this plan and mark it **"authored, CI-deferred."** Local server gate: `cd server && pnpm run check` (tsc) + `pnpm run lint` (eslint, zero-warnings).
- **REAL red→green for the two mobile test files** (runtime is available locally). For the server e2e, the local red→green substitute is `pnpm run check` compile + the reasoning in each step; CI runs the real e2e.

### 0.5 Commit boundaries (exactly three, no Claude co-author / "Generated with" trailers)

1. **Commit 1 — mobile-1 client gate** (`sync_api.repository.dart` + `sync_api_repository_test.dart`).
2. **Commit 2 — server drop-unknown filter** (`sync.dto.ts` + new `sync.dto.spec.ts` + `sync.controller.spec.ts` update + `sync.e2e-spec.ts` update). Separate because it is a **server** change in a mostly-mobile slice.
3. **Commit 3 — mobile-2 sweep** (`sync_stream.repository.dart` + `sync_stream_repository_test.dart`).

---

## File Structure

**Modify (mobile production):**

- `mobile/lib/infrastructure/repositories/sync_api.repository.dart:99-104` — wrap the 5 `SharedSpaceAlbum*` types in a `serverVersion > SemVer(5,0,0)` collection-`if` spread.
- `mobile/lib/infrastructure/repositories/sync_stream.repository.dart:795-817` — add two `AND id NOT IN (…)` clauses to the `deleteLibrariesV1` sweep + update the preceding comment.

**Modify (server production):**

- `server/src/dtos/sync.dto.ts` — add `SyncRequestType` to the `src/enum` import; wrap `SyncStreamSchema.types` in a `z.preprocess` drop-unknown filter.

**Create (server test):**

- `server/src/dtos/sync.dto.spec.ts` — Zod-level unit tests for the drop-unknown filter.

**Modify (server test):**

- `server/src/controllers/sync.controller.spec.ts:33-44` — repurpose the enum-400 test to a structural-400 test.
- `e2e/src/specs/server/api/sync.e2e-spec.ts:79-90` — repurpose the enum-400 test to a drop-unknown-200 test (CI-deferred run).

**Extend (mobile test):**

- `mobile/test/infrastructure/repositories/sync_api_repository_test.dart` — add a `mobile-1: SharedSpaceAlbum request-type version gate` group (capture + decode the request body).
- `mobile/test/domain/repositories/sync_stream_repository_test.dart` — add mobile-2 tests inside the existing `deleteLibrariesV1 orphan sweep` group.

---

## Commit 1 — mobile-1: version-gate the 5 SharedSpaceAlbum request types

### Task 1: Client version gate + tests (`sync_api.repository.dart`)

**Files:**

- Test: `mobile/test/infrastructure/repositories/sync_api_repository_test.dart`
- Modify: `mobile/lib/infrastructure/repositories/sync_api.repository.dart:99-104`

**Interfaces:**

- Consumes: `SyncApiRepository.streamChanges(onData, {required SemVer serverVersion, …, http.Client? httpClient})` (already exists); `SemVer` from `package:immich_mobile/utils/semver.dart` with `operator >`; the test's existing `streamChanges(onDataCallback, serverVersion)` helper and `mockHttpClient` capture.
- Produces: request body `types` list that includes the 5 `SharedSpaceAlbum*` values **iff** `serverVersion > SemVer(5,0,0)`.

- [ ] **Step 1: Ensure mobile deps are fetched (one-time)**

Run: `cd mobile && mise exec -- flutter pub get`
Expected: resolves dependencies; creates `.dart_tool/`. (Skip if already done.)

- [ ] **Step 2: Write the failing version-gate tests**

In `mobile/test/infrastructure/repositories/sync_api_repository_test.dart`, add — inside `void main()`, after the existing `streamChanges` helper (around line 84) — a body-capture helper and a new test group. The file already imports `dart:convert`, `package:http/http.dart as http`, `package:immich_mobile/utils/semver.dart`, `package:mocktail/mocktail.dart`, and `package:openapi/api.dart`, and already registers `FakeBaseRequest` as the fallback for `send`.

```dart
  // Drives one streamChanges call end-to-end (empty response stream), then
  // reads back the request body the SUT sent so we can assert on `types`.
  // The request is populated (body set) before client.send, and the mock
  // captures the object by reference, so reading .body afterwards is valid.
  Future<List<String>> capturedRequestTypes(SemVer serverVersion) async {
    final future = streamChanges((_, _, _) async {}, serverVersion);
    await Future.delayed(const Duration(milliseconds: 50));
    await responseStreamController.close();
    await future;

    final captured = verify(() => mockHttpClient.send(captureAny())).captured;
    final request = captured.single as http.Request; // AbortableRequest extends Request
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    return (body['types'] as List).cast<String>();
  }

  group('mobile-1: SharedSpaceAlbum request-type version gate', () {
    const albumTypes = <String>[
      'SharedSpaceAlbumsV1',
      'SharedSpaceAlbumLinksV1',
      'SharedSpaceAlbumToAssetsV1',
      'SharedSpaceAlbumAssetsV1',
      'SharedSpaceAlbumAssetExifsV1',
    ];

    test('v5.0.0 (last pre-feature release): EXCLUDES all 5 album types', () async {
      final types = await capturedRequestTypes(const SemVer(major: 5, minor: 0, patch: 0));
      expect(albumTypes.any(types.contains), isFalse, reason: 'v5.0.0 has no SharedSpaceAlbum enum values');
      // Unconditional fork types are unaffected.
      expect(types, contains('SharedSpacesV1'));
      expect(types, contains('SharedSpaceLibrariesV1'));
    });

    test('old upstream-numbered fork server (3.0.1): EXCLUDES all 5 album types (fail-safe to old)', () async {
      final types = await capturedRequestTypes(const SemVer(major: 3, minor: 0, patch: 1));
      expect(albumTypes.any(types.contains), isFalse);
    });

    test('v5.0.1 (first possible post-release): INCLUDES all 5 album types', () async {
      final types = await capturedRequestTypes(const SemVer(major: 5, minor: 0, patch: 1));
      expect(albumTypes.every(types.contains), isTrue);
    });

    test('feature release v5.1.0 (at/above the feature boundary): INCLUDES all 5 album types', () async {
      final types = await capturedRequestTypes(const SemVer(major: 5, minor: 1, patch: 0));
      expect(albumTypes.every(types.contains), isTrue);
    });

    test('feature release-candidate v5.1.0-rc.0: INCLUDES all 5 album types (RC validation)', () async {
      final types = await capturedRequestTypes(const SemVer(major: 5, minor: 1, patch: 0, prerelease: 0));
      expect(albumTypes.every(types.contains), isTrue);
    });

    test('far-future v6.0.0: INCLUDES all 5 album types', () async {
      final types = await capturedRequestTypes(const SemVer(major: 6, minor: 0, patch: 0));
      expect(albumTypes.every(types.contains), isTrue);
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail (RED)**

Run: `cd mobile && mise exec -- flutter test test/infrastructure/repositories/sync_api_repository_test.dart`
Expected: the two **EXCLUDES** tests **FAIL** (current code adds the 5 types unconditionally, so `albumTypes.any(types.contains)` is `true` for every version). The four **INCLUDES** tests pass even now (unconditional). This is the red proof that the gate is missing.

- [ ] **Step 4: Add the version gate to `sync_api.repository.dart`**

In `mobile/lib/infrastructure/repositories/sync_api.repository.dart`, replace lines 99-104:

```dart
          // --- gallery-fork: shared-space album sync types (Phase 2B) ---
          SyncRequestType.sharedSpaceAlbumsV1,
          SyncRequestType.sharedSpaceAlbumLinksV1,
          SyncRequestType.sharedSpaceAlbumToAssetsV1,
          SyncRequestType.sharedSpaceAlbumAssetsV1,
          SyncRequestType.sharedSpaceAlbumAssetExifsV1,
```

with:

```dart
          // --- gallery-fork: shared-space album sync types (Phase 2B) ---
          //
          // mobile-1: gate these 5 request types behind the fork-server version that
          // first ships the space-albums feature. An older fork server's
          // SyncRequestTypeSchema (z.enum) REJECTS unknown enum values with a 400 for
          // the WHOLE /sync/stream request → a total sync outage on an app that is
          // ahead of the server (mobile + server release independently). The boundary
          // is a FORK version: deployed fork servers report FORK_VERSION (stamped into
          // server/package.json by branding/scripts/apply-branding.sh patch_versions),
          // NOT the upstream Immich version — so do NOT copy the 3.0.0 OCR gate. v5.0.0
          // is the last release WITHOUT space-albums; the feature (and its enum values)
          // ship in the next release, so gate on strictly-after-5.0.0, which also admits
          // the feature's release-candidates. See slice-5 plan §0.1 for the full evidence
          // and the release-time reconciliation note. The server drop-unknown filter
          // (slice-5 Commit 2) is the complementary defense for future skew.
          if (serverVersion > const SemVer(major: 5, minor: 0, patch: 0)) ...[
            SyncRequestType.sharedSpaceAlbumsV1,
            SyncRequestType.sharedSpaceAlbumLinksV1,
            SyncRequestType.sharedSpaceAlbumToAssetsV1,
            SyncRequestType.sharedSpaceAlbumAssetsV1,
            SyncRequestType.sharedSpaceAlbumAssetExifsV1,
          ],
```

- [ ] **Step 5: Run the tests to verify they pass (GREEN)**

Run: `cd mobile && mise exec -- flutter test test/infrastructure/repositories/sync_api_repository_test.dart`
Expected: **all** tests PASS (the two EXCLUDES now pass because `5.0.0`/`3.0.1` fail the `> 5.0.0` gate; the four INCLUDES still pass).

- [ ] **Step 6: Analyze (CI-equivalent)**

Run: `cd mobile && mise exec -- dart analyze --fatal-infos lib test`
Expected: **No issues found!** (`if (cond) ...[…]` is an idiomatic collection-if + spread; no info/warning.)

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/infrastructure/repositories/sync_api.repository.dart \
  mobile/test/infrastructure/repositories/sync_api_repository_test.dart
git commit -m "fix(mobile): version-gate the SharedSpaceAlbum sync request types (mobile-1)

The 5 SharedSpaceAlbum* request types were added to the /sync/stream body
unconditionally. An older fork server's SyncRequestTypeSchema (z.enum) rejects
the unknown values with a 400 for the whole request, taking down the entire
sync stream (total outage) whenever the app is ahead of the server. Gate them
behind serverVersion > 5.0.0 — a FORK version, since deployed fork servers
report FORK_VERSION (stamped by apply-branding), not the upstream Immich
version. v5.0.0 is the last release without space-albums; the feature ships in
the next release, and > 5.0.0 also admits its release-candidates for validation."
```

---

## Commit 2 — server: drop unknown request types instead of 400 (defense-in-depth)

### Task 2: `z.preprocess` filter + DTO unit tests + update the two existing 400 tests + e2e

**Files:**

- Modify: `server/src/dtos/sync.dto.ts` (import + `SyncStreamSchema.types`)
- Create: `server/src/dtos/sync.dto.spec.ts`
- Modify: `server/src/controllers/sync.controller.spec.ts:33-44`
- Modify: `e2e/src/specs/server/api/sync.e2e-spec.ts:79-90`

**Interfaces:**

- Consumes: `SyncRequestType`, `SyncRequestTypeSchema` from `src/enum`; `SyncStreamDto.schema` (static, exposed by `createZodDto`).
- Produces: `SyncStreamDto.types` that silently drops unknown enum values but still rejects a non-array/missing `types`.

- [ ] **Step 1: Write the failing DTO-level unit tests**

Create `server/src/dtos/sync.dto.spec.ts`:

```ts
import { SyncStreamDto } from 'src/dtos/sync.dto';
import { SyncRequestType } from 'src/enum';

describe('SyncStreamDto', () => {
  it('accepts an array of known request types unchanged', () => {
    const result = SyncStreamDto.schema.safeParse({
      types: [SyncRequestType.UsersV1, SyncRequestType.AlbumsV1],
    });
    expect(result.success).toBe(true);
    expect(result.data?.types).toEqual([SyncRequestType.UsersV1, SyncRequestType.AlbumsV1]);
  });

  it('drops an unknown request type but keeps the known ones (no rejection)', () => {
    const result = SyncStreamDto.schema.safeParse({
      types: [SyncRequestType.UsersV1, 'TotallyNotARealType', SyncRequestType.AlbumsV1],
    });
    expect(result.success).toBe(true);
    expect(result.data?.types).toEqual([SyncRequestType.UsersV1, SyncRequestType.AlbumsV1]);
  });

  it('drops a future fork-only type this server does not recognise (skew safety)', () => {
    const result = SyncStreamDto.schema.safeParse({ types: [SyncRequestType.UsersV1, 'SomeFutureTypeV9'] });
    expect(result.success).toBe(true);
    expect(result.data?.types).toEqual([SyncRequestType.UsersV1]);
  });

  it('parses an all-unknown array to an empty types list (no 400)', () => {
    const result = SyncStreamDto.schema.safeParse({ types: ['nope', 'still-nope'] });
    expect(result.success).toBe(true);
    expect(result.data?.types).toEqual([]);
  });

  it('still REJECTS a non-array types field (structural error is not masked)', () => {
    const result = SyncStreamDto.schema.safeParse({ types: 'UsersV1' });
    expect(result.success).toBe(false);
  });

  it('still REJECTS a missing types field', () => {
    const result = SyncStreamDto.schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('preserves the reset flag alongside filtered types', () => {
    const result = SyncStreamDto.schema.safeParse({ types: [SyncRequestType.UsersV1, 'x'], reset: true });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ types: [SyncRequestType.UsersV1], reset: true });
  });
});
```

- [ ] **Step 2: Run the DTO tests to verify they fail (RED)**

Run: `cd server && pnpm test --run src/dtos/sync.dto.spec.ts`
Expected: the "drops …" and "all-unknown → empty" tests **FAIL** (current schema is strict `z.array(z.enum)` → `safeParse` returns `success: false` for any unknown element). The "REJECTS non-array/missing" and "accepts known" tests pass now.

- [ ] **Step 3: Add the `z.preprocess` filter to `sync.dto.ts`**

In `server/src/dtos/sync.dto.ts`, add `SyncRequestType` to the existing `src/enum` import (keep the list alphabetized, matching the file):

```ts
import {
  AlbumUserRole,
  AlbumUserRoleSchema,
  AssetOrderSchema,
  AssetTypeSchema,
  AssetVisibilitySchema,
  MemoryTypeSchema,
  SyncEntityType,
  SyncEntityTypeSchema,
  SyncRequestType,
  SyncRequestTypeSchema,
  UserAvatarColorSchema,
  UserMetadataKeySchema,
} from 'src/enum';
```

Then replace `SyncStreamSchema` (currently `sync.dto.ts:717-722`):

```ts
const SyncStreamSchema = z
  .object({
    types: z.array(SyncRequestTypeSchema).describe('Sync request types'),
    reset: z.boolean().optional().describe('Reset sync state'),
  })
  .meta({ id: 'SyncStreamDto' });
```

with:

```ts
// mobile-1 (defense-in-depth): drop request types this server does not recognise instead of
// rejecting the whole /sync/stream with a 400. A newer client sends fork-only enum values (e.g.
// the SharedSpaceAlbum* types) that an older server's z.enum would reject, taking down the entire
// sync stream (total outage). Filtering unknown values BEFORE the enum-array validation lets known
// types keep streaming; SyncService.stream already ignores any type not in SYNC_TYPES_ORDER
// (sync.service.ts). A non-array or missing `types` still fails validation — structural errors are
// NOT masked. The z.preprocess(fn, z.array(X)) shape renders in OpenAPI as an array of X (same as
// today), so no SDK regen is needed (see time-bucket.dto.ts personIds/tagIds for the same pattern).
const KNOWN_SYNC_REQUEST_TYPES = new Set<string>(Object.values(SyncRequestType));

const SyncStreamSchema = z
  .object({
    types: z
      .preprocess(
        (value) =>
          Array.isArray(value) ? value.filter((type) => KNOWN_SYNC_REQUEST_TYPES.has(type as string)) : value,
        z.array(SyncRequestTypeSchema),
      )
      .describe('Sync request types'),
    reset: z.boolean().optional().describe('Reset sync state'),
  })
  .meta({ id: 'SyncStreamDto' });
```

- [ ] **Step 4: Run the DTO tests to verify they pass (GREEN)**

Run: `cd server && pnpm test --run src/dtos/sync.dto.spec.ts`
Expected: **all 7 PASS.**

- [ ] **Step 5: Update the controller spec (it asserts the old 400 for unknown enums)**

In `server/src/controllers/sync.controller.spec.ts`, replace the existing test at lines 33-44:

```ts
it('should require sync request type enums', async () => {
  const { status, body } = await request(ctx.getHttpServer())
    .post('/sync/stream')
    .send({ types: ['invalid'] });
  expect(status).toBe(400);
  expect(body).toEqual(
    errorDto.validationError([
      { path: ['types', 0], message: expect.stringContaining('Invalid option: expected one of') },
    ]),
  );
  expect(ctx.authenticate).toHaveBeenCalled();
});
```

with (unknown enum values are now dropped, so the enforced boundary is structural — a non-array `types`):

```ts
it('should reject a non-array types field (structural validation still fires)', async () => {
  // Unknown enum VALUES are now dropped by the SyncStreamDto preprocess filter
  // (mobile-1 skew safety) rather than 400-ing the whole request. A structurally
  // invalid `types` (not an array) still fails validation cleanly.
  const { status, body } = await request(ctx.getHttpServer()).post('/sync/stream').send({ types: 'invalid' });
  expect(status).toBe(400);
  expect(body).toEqual(errorDto.validationError([{ path: ['types'], message: expect.stringContaining('array') }]));
  expect(ctx.authenticate).toHaveBeenCalled();
});
```

- [ ] **Step 6: Run the controller spec (GREEN)**

Run: `cd server && pnpm test --run src/controllers/sync.controller.spec.ts`
Expected: **all PASS** (the repurposed structural-400 test passes; the untouched `DELETE /sync/ack` enum-400 test — which uses `SyncEntityTypeSchema` — still passes).

> If the exact validation message for a non-array differs from `array` at runtime, relax the assertion to `expect(status).toBe(400)` plus `expect(body.error).toBe('Bad Request')` — the load-bearing assertion is the **400**, not the message text.

- [ ] **Step 7: Update the e2e (it asserts the old 400 for unknown enums) — authored, CI-deferred**

In `e2e/src/specs/server/api/sync.e2e-spec.ts`, replace the existing test at lines 79-90 with two tests exercising the drop-unknown behavior over real HTTP. Reuse the buffered jsonl parser shape already used by the "returns content-type …" test above it:

```ts
it('drops an unknown SyncRequestType and still streams the known types (no 400)', async () => {
  const { status, headers, body } = await request(app)
    .post('/sync/stream')
    .set(asBearerAuth(userA.accessToken))
    .send({ types: ['UsersV1', 'NotARealType'], reset: true })
    .buffer(true)
    .parse((res, callback) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        data += chunk;
      });
      res.on('end', () => {
        callback(null, data);
      });
    });
  // The unknown value is filtered out; UsersV1 still streams → 200 jsonl, not 400.
  expect(status).toBe(200);
  expect(headers['content-type']).toContain('application/jsonlines+json');
  const text = body as unknown as string;
  expect(text.length).toBeGreaterThan(0);
  const types = text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line).type as string);
  expect(types).toContain('UserV1'); // the UsersV1 request emits UserV1 entities
});

it('an all-unknown types array does not 400 (stream completes cleanly)', async () => {
  const { status, body } = await request(app)
    .post('/sync/stream')
    .set(asBearerAuth(userA.accessToken))
    .send({ types: ['NotARealType'], reset: true })
    .buffer(true)
    .parse((res, callback) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        data += chunk;
      });
      res.on('end', () => {
        callback(null, data);
      });
    });
  // No known types remain after filtering → the stream still opens (200) and
  // completes with a SyncCompleteV1 marker; it must NOT 400.
  expect(status).toBe(200);
  const text = body as unknown as string;
  const types = text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line).type as string);
  expect(types).toContain('SyncCompleteV1');
  expect(types).not.toContain('UserV1');
});
```

- [ ] **Step 8: Verify the e2e spec compiles (local RED substitute; Docker down)**

Run: `cd e2e && pnpm exec tsc --noEmit`
Expected: PASS (types compile). Against pre-Step-3 server code these two tests assert red (the server returns 400 for the unknown value); green after the filter. The actual e2e run is **CI-deferred**.

- [ ] **Step 9: Confirm no OpenAPI/SDK drift (expected: none)**

Run: `cd server && pnpm run check && pnpm run lint`
Expected: PASS (0 errors, 0 warnings). The `z.preprocess(fn, z.array(SyncRequestTypeSchema))` renders identically to the prior `z.array(SyncRequestTypeSchema)` in OpenAPI (see §0.3), so **do not** regenerate the SDK. `git status` must show **no** change under `open-api/` or `mobile/openapi/`.

- [ ] **Step 10: Commit**

```bash
git add server/src/dtos/sync.dto.ts \
  server/src/dtos/sync.dto.spec.ts \
  server/src/controllers/sync.controller.spec.ts \
  e2e/src/specs/server/api/sync.e2e-spec.ts
git commit -m "fix(sync): drop unknown /sync/stream request types instead of 400 (mobile-1 defense-in-depth)

SyncStreamDto.types rejected the whole request with a 400 on any unrecognised
SyncRequestType enum value, so a newer client sending fork-only types (e.g. the
SharedSpaceAlbum* types) to an older server took down the entire sync stream.
Filter unknown values before the enum-array validation via z.preprocess so known
types keep streaming; SyncService.stream already ignores types it does not
handle. Structural errors (non-array types) still 400. No OpenAPI/SDK change
(same array-of-enum shape as time-bucket.dto's preprocess arrays)."
```

---

## Commit 3 — mobile-2: keep album-reachable assets during the library sweep

### Task 3: Sweep keep-set + tests (`sync_stream.repository.dart`)

**Files:**

- Test: `mobile/test/domain/repositories/sync_stream_repository_test.dart` (existing `deleteLibrariesV1 orphan sweep` group)
- Modify: `mobile/lib/infrastructure/repositories/sync_stream.repository.dart:795-817`

**Interfaces:**

- Consumes (test helpers already defined in the enclosing group): `makeLibrary`, `makeLibraryAsset({id, checksum, ownerId, libraryId})`, `insertPartner`, `_createUser`, `sut.updateLibraryAssetsV1`, `sut.updateSharedSpaceAlbumToAssetsV1`, `sut.updateAlbumsV2`, `sut.updateAlbumToAssetsV1`, `sut.deleteLibrariesV1(data, {required currentUserId})`; `db.remoteAssetEntity`, `db.sharedSpaceAlbumAssetEntity`, `db.remoteAlbumAssetEntity`; openapi `SyncLibraryDeleteV1`, `SyncAlbumToAssetV1`, `SyncAlbumV2`, `AssetOrder`, `AssetVisibility`, `AssetTypeEnum`, `SyncAssetV1`.
- Produces: a sweep that also preserves `remote_asset` rows reachable via `shared_space_album_asset_entity` or `remote_album_asset_entity`.

- [ ] **Step 1: Write the failing preservation tests + regression guards**

In `mobile/test/domain/repositories/sync_stream_repository_test.dart`, append these tests **inside the existing `group('deleteLibrariesV1 orphan sweep', …)` block** (starts at line 811; the helpers `makeLibraryAsset`/`makeLibrary`/`insertPartner` are in scope there, and its `setUp` already seeds `user-1`, `user-partner`, `user-foreign` and `library-1` owned by `user-foreign`):

```dart
      test('preserves an asset also present in shared_space_album_asset (album path — mobile-2)', () async {
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'album-add', checksum: 'cA1', ownerId: 'user-foreign', libraryId: 'library-1'),
        ]);
        // The asset is a member of a space-linked album (no FK on assetId, so this
        // join row can reference the library asset directly).
        await sut.updateSharedSpaceAlbumToAssetsV1([
          SyncAlbumToAssetV1(albumId: 'album-1', assetId: 'album-add'),
        ]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        final rows = await db.remoteAssetEntity.select().get();
        expect(rows.map((r) => r.id), ['album-add']);
      });

      test('preserves an asset also present in remote_album_asset (classic album — pre-existing gap)', () async {
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'classic-add', checksum: 'cC1', ownerId: 'user-foreign', libraryId: 'library-1'),
        ]);
        // A personal (classic) album that also contains the asset. remote_album_asset
        // has FKs to remote_album AND remote_asset, so both must exist first.
        await sut.updateAlbumsV2([
          SyncAlbumV2(
            id: 'classic-album-1',
            name: 'Classic',
            description: '',
            isActivityEnabled: true,
            order: AssetOrder.asc,
            thumbnailAssetId: null,
            createdAt: DateTime(2026, 6, 1),
            updatedAt: DateTime(2026, 6, 1),
          ),
        ]);
        await sut.updateAlbumToAssetsV1([SyncAlbumToAssetV1(albumId: 'classic-album-1', assetId: 'classic-add')]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        final rows = await db.remoteAssetEntity.select().get();
        expect(rows.map((r) => r.id), ['classic-add']);
      });

      test('deletes a Hidden foreign asset reachable only via the removed library (no accidental retention)', () async {
        // Visibility is NOT part of the sweep predicate — an asset with no album/space/
        // partner/owner path is still swept regardless of Hidden.
        await sut.updateLibraryAssetsV1([
          SyncAssetV1(
            id: 'hidden-orphan',
            checksum: 'cH1',
            originalFileName: 'hidden-orphan.jpg',
            type: AssetTypeEnum.IMAGE,
            ownerId: 'user-foreign',
            isFavorite: false,
            fileCreatedAt: DateTime(2024, 1, 1),
            fileModifiedAt: DateTime(2024, 1, 1),
            localDateTime: DateTime(2024, 1, 1),
            createdAt: DateTime(2024, 1, 1),
            visibility: AssetVisibility.hidden,
            width: 100,
            height: 100,
            deletedAt: null,
            duration: null,
            libraryId: 'library-1',
            livePhotoVideoId: null,
            stackId: null,
            thumbhash: null,
            isEdited: false,
          ),
        ]);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        expect(await db.remoteAssetEntity.select().get(), isEmpty);
      });

      test('empty album/space-album sets: orphan sweep still deletes (no regression from new exclusions)', () async {
        await sut.updateLibraryAssetsV1([
          makeLibraryAsset(id: 'orphan-empty', checksum: 'cE1', ownerId: 'user-foreign', libraryId: 'library-1'),
        ]);
        expect(await db.sharedSpaceAlbumAssetEntity.select().get(), isEmpty);
        expect(await db.remoteAlbumAssetEntity.select().get(), isEmpty);

        await sut.deleteLibrariesV1([SyncLibraryDeleteV1(libraryId: 'library-1')], currentUserId: 'user-1');

        expect(await db.remoteAssetEntity.select().get(), isEmpty);
      });
```

- [ ] **Step 2: Run the tests to verify they fail (RED)**

Run: `cd mobile && mise exec -- flutter test test/domain/repositories/sync_stream_repository_test.dart`
Expected: the two **preserves …** tests **FAIL** — current sweep deletes the library asset even though it is album-reachable (`expect(rows.map((r)=>r.id), ['album-add'])` fails: `rows` is empty). The two guard tests (`deletes a Hidden …`, `empty album/space-album sets …`) **PASS** now (they assert deletion, which current code already does) — they are regression guards to prove the new clauses don't over-preserve.

- [ ] **Step 3: Add the two keep-set clauses to the sweep**

In `mobile/lib/infrastructure/repositories/sync_stream.repository.dart`, update the comment block (lines 795-801) and the `customStatement` (lines 805-817). Replace:

```dart
        // Sweep orphan library assets in chunks to stay under the SQLite
        // parameter limit. Preserves user-owned, partner-shared, and direct-add
        // (shared_space_asset) paths. Uses snake_case because Drift generates
        // snake_case table/column names from camelCase Dart identifiers — see
        // remote_asset.entity.dart for the `libraryId` column declaration that
        // becomes `library_id`. The chunks all run inside the same transaction
        // so the entire sweep is still atomic with the libraryEntity deletes.
        for (var offset = 0; offset < libraryIds.length; offset += _kSweepChunkSize) {
          final chunk = libraryIds.sublist(offset, (offset + _kSweepChunkSize).clamp(0, libraryIds.length));
          final placeholders = chunk.map((_) => '?').join(',');
          await _db.customStatement(
            '''
            DELETE FROM remote_asset_entity
            WHERE library_id IS NOT NULL
              AND library_id IN ($placeholders)
              AND owner_id != ?
              AND owner_id NOT IN (
                SELECT shared_by_id FROM partner_entity WHERE shared_with_id = ?
              )
              AND id NOT IN (SELECT asset_id FROM shared_space_asset_entity)
            ''',
            [...chunk, currentUserId, currentUserId],
          );
        }
```

with:

```dart
        // Sweep orphan library assets in chunks to stay under the SQLite parameter
        // limit. Preserves every path that still legitimately reaches the asset:
        // user-owned, partner-shared, direct-add (shared_space_asset), space-album
        // membership (shared_space_album_asset) and classic-album membership
        // (remote_album_asset). mobile-2: unlinking a library while an asset is also
        // in a linked album must NOT delete the shared remote_asset row, or the asset
        // vanishes from album detail + the space timeline (the "swap a library link
        // for curated album links" workflow the feature encourages). remote_album_asset
        // is the adjacent pre-existing classic-album gap. Uses snake_case because Drift
        // generates snake_case table/column names from camelCase Dart identifiers — see
        // remote_asset.entity.dart for the `libraryId` column that becomes `library_id`.
        // The chunks all run inside the same transaction so the entire sweep stays
        // atomic with the libraryEntity deletes.
        for (var offset = 0; offset < libraryIds.length; offset += _kSweepChunkSize) {
          final chunk = libraryIds.sublist(offset, (offset + _kSweepChunkSize).clamp(0, libraryIds.length));
          final placeholders = chunk.map((_) => '?').join(',');
          await _db.customStatement(
            '''
            DELETE FROM remote_asset_entity
            WHERE library_id IS NOT NULL
              AND library_id IN ($placeholders)
              AND owner_id != ?
              AND owner_id NOT IN (
                SELECT shared_by_id FROM partner_entity WHERE shared_with_id = ?
              )
              AND id NOT IN (SELECT asset_id FROM shared_space_asset_entity)
              AND id NOT IN (SELECT asset_id FROM shared_space_album_asset_entity)
              AND id NOT IN (SELECT asset_id FROM remote_album_asset_entity)
            ''',
            [...chunk, currentUserId, currentUserId],
          );
        }
```

(The bound-parameter count is unchanged — the two new subqueries add no `?` placeholders — so the `_kSweepChunkSize` headroom comment at lines 779-783 stays correct.)

- [ ] **Step 4: Run the tests to verify they pass (GREEN)**

Run: `cd mobile && mise exec -- flutter test test/domain/repositories/sync_stream_repository_test.dart`
Expected: **all** tests PASS — the two `preserves …` now retain the album-reachable asset; the Hidden-orphan and empty-set guards still delete; and the pre-existing sweep tests (owner/partner/direct-add preservation, foreign-orphan deletion, chunk-boundary, atomicity, multi-library) stay green.

- [ ] **Step 5: Analyze (CI-equivalent)**

Run: `cd mobile && mise exec -- dart analyze --fatal-infos lib test`
Expected: **No issues found!**

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/infrastructure/repositories/sync_stream.repository.dart \
  mobile/test/domain/repositories/sync_stream_repository_test.dart
git commit -m "fix(mobile): keep album-reachable assets during the library sweep (mobile-2)

deleteLibrariesV1's orphan sweep preserved owner/partner/direct-add
(shared_space_asset) paths but not shared_space_album_asset (the album path
this feature encourages) nor remote_album_asset (a pre-existing classic-album
gap). Unlinking a library while an asset was also in a linked album deleted the
shared remote_asset row, so the asset vanished from album detail and the space
timeline. Add both tables to the sweep keep-set. No new bound parameters."
```

---

## Validation (run before declaring done)

- [ ] **Mobile (authoritative local proof — runtime available):**
  - Run: `cd mobile && mise exec -- flutter pub get` → Expected: resolves (one-time).
  - Run: `cd mobile && mise exec -- flutter test test/infrastructure/repositories/sync_api_repository_test.dart` → Expected: PASS (mobile-1 gate group + pre-existing streamChanges tests).
  - Run: `cd mobile && mise exec -- flutter test test/domain/repositories/sync_stream_repository_test.dart` → Expected: PASS (mobile-2 sweep group + all pre-existing groups).
  - Run: `cd mobile && mise exec -- dart analyze --fatal-infos lib test` → Expected: **No issues found!**
- [ ] **Server (local — no Docker needed):**
  - Run: `cd server && pnpm test --run src/dtos/sync.dto.spec.ts src/controllers/sync.controller.spec.ts` → Expected: PASS.
  - Run: `cd server && pnpm run check` → Expected: PASS (0 errors).
  - Run: `cd server && pnpm run lint` → Expected: PASS (0 warnings).
- [ ] **e2e typecheck (run compiles; run itself CI-deferred):**
  - Run: `cd e2e && pnpm exec tsc --noEmit` → Expected: PASS.
- [ ] **No generated-code drift.** `git diff --stat` shows only: `mobile/lib/infrastructure/repositories/sync_api.repository.dart`, `mobile/lib/infrastructure/repositories/sync_stream.repository.dart`, the two mobile test files, `server/src/dtos/sync.dto.ts`, `server/src/dtos/sync.dto.spec.ts`, `server/src/controllers/sync.controller.spec.ts`, `e2e/src/specs/server/api/sync.e2e-spec.ts`. In particular **`open-api/`, `mobile/openapi/`, `server/src/queries/`, and `server/src/schema/migrations-gallery/` must be unchanged** (no SDK regen, no SQL regen, no migration).

**CI-deferred (Docker down — CI runs these):**

- `cd e2e && pnpm test` (or the API e2e job) — `sync.e2e-spec.ts` drop-unknown tests (real HTTP seam).

**Edge-case coverage map (every Slice 5 edge case → a named test):**

| Slice 5 edge case                                                       | Test                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverVersion` exactly at the feature boundary → included              | `sync_api_repository_test.dart` "feature release v5.1.0 … INCLUDES all 5" + "v5.0.1 (first possible post-release) … INCLUDES" (off-by-one guard against the excluded `v5.0.0`)                                       |
| `serverVersion` just below the boundary (`v5.0.0`) → excluded           | `sync_api_repository_test.dart` "v5.0.0 (last pre-feature release): EXCLUDES all 5"                                                                                                                                  |
| Missing/unparseable `serverVersion` → treat as old (exclude; fail-safe) | Null handled upstream (`sync_stream.service.dart:60-64` aborts sync before streaming; §0.1); any old parseable version → `sync_api_repository_test.dart` "old upstream-numbered fork server (3.0.1): EXCLUDES all 5" |
| Feature RC validation (`5.1.0-rc.0`) still activates the types          | `sync_api_repository_test.dart` "feature release-candidate v5.1.0-rc.0 … INCLUDES"                                                                                                                                   |
| Asset in a library + `remote_album_asset` (classic album) → retained    | `sync_stream_repository_test.dart` "preserves an asset also present in remote_album_asset …"                                                                                                                         |
| Asset in a library + `shared_space_album_asset` → retained              | `sync_stream_repository_test.dart` "preserves an asset also present in shared_space_album_asset …"                                                                                                                   |
| Asset in the removed library only, also Hidden → still deleted          | `sync_stream_repository_test.dart` "deletes a Hidden foreign asset reachable only via the removed library …"                                                                                                         |
| Sweep with empty album set → no regression                              | `sync_stream_repository_test.dart` "empty album/space-album sets: orphan sweep still deletes …"                                                                                                                      |
| Server: unknown type posted → known types still stream, no 400          | `sync.dto.spec.ts` "drops an unknown request type but keeps the known ones" + `sync.e2e-spec.ts` "drops an unknown SyncRequestType and still streams …" + "an all-unknown types array does not 400"                  |
| Server: structural malformation still 400s                              | `sync.dto.spec.ts` "still REJECTS a non-array/missing types" + `sync.controller.spec.ts` "should reject a non-array types field"                                                                                     |

---

## Self-Review notes (spec coverage confirmed)

- **mobile-1 (client gate):** the crux — the version boundary — resolved with evidence (§0.1): a deployed fork server reports the FORK version (5.x), not upstream 3.x, because `apply-branding.sh patch_versions` stamps `FORK_VERSION` into `server/package.json`. Gate is `> SemVer(5,0,0)` with a release-time reconciliation note; six version-boundary tests including the RC case (Task 1).
- **mobile-1 (server filter):** `z.preprocess` drop-unknown filter with 7 DTO unit tests, the two existing 400 tests repurposed, and two e2e drop-unknown tests; confirmed no SDK regen via the time-bucket precedent (Task 2, §0.3).
- **mobile-2 (sweep):** both `shared_space_album_asset_entity` and `remote_album_asset_entity` added to the keep-set with confirmed table/column names (§0.2); four tests covering both preservation paths + the Hidden-deletion and empty-set regression guards (Task 3).
- **No placeholders; exact file paths + line ranges + full code in every step.** Symbols verified against the worktree: `SemVer.operator >` (`utils/semver.dart`), `AbortableRequest extends Request` with `String get body` (`package:http`), `SyncRequestType.{UsersV1,AlbumsV1}` + `SharedSpaceAlbum*` enum members (`server/src/enum.ts`), `SyncStreamDto.schema` (nestjs-zod `createZodDto`), test helpers `makeLibraryAsset`/`updateSharedSpaceAlbumToAssetsV1`/`updateAlbumsV2`/`updateAlbumToAssetsV1` and accessors `db.sharedSpaceAlbumAssetEntity`/`db.remoteAlbumAssetEntity` (mobile test suite).
- **Three commits, no Claude co-author trailers.** Mobile changes touch no generated code; the server filter touches no OpenAPI/SDK/SQL/migration surface.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-08-space-albums-remediation-slice-5.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task (Tasks 1–3), review between tasks. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
2. **Inline Execution** — execute the three commits in this session with checkpoints. REQUIRED SUB-SKILL: superpowers:executing-plans.
