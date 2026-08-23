# E2E API Test Coverage — Research & Backlog

**Status:** research / backlog
**Scope:** `e2e/src/specs/server/api/` (vitest + supertest, no browser)
**Goal:** Identify the highest-leverage API tests to add so that "click around the FE" stops being the primary verification loop, without paying the Playwright tax.

---

## 1. TL;DR

- The fork exposes **~282 endpoints across 45 controllers**.
- We have **29 spec files / ~681 tests** in `e2e/src/specs/server/api/`.
- Most "I shipped a feature and it didn't work" bugs in the project memory are **access-scoping bugs** (PRs #163, #172, #196, #200, #202, #205, #227, #231, #251, #260, #276, #291, #292…). They are API-shaped, not browser-shaped.
- **Eight controllers have zero coverage**, three of which are fork-only: `timeline`, `face`, `gallery-map`, `notification`, `notification-admin`, `view`, `workflow`, `plugin`. (`queue` and `sync` also have zero, lower priority.)
- **Several heavily-tested controllers have new endpoints with no coverage** — most importantly `shared-space.controller`'s `/people/*` and `/libraries` sub-trees, and `asset.controller`'s `/metadata`, `/ocr`, `/edits` (non-trim), `/copy` paths.
- A standard **Permission/Actor matrix** (§3) is missing — every spec invents its own actors. Codifying it as helpers in `e2e/src/utils.ts` is a precondition for the new specs.

This document lists, per-file, exactly which test cases to add. It is sized to be sliced into ~15 follow-up PRs, each ~1 spec file.

---

## 2. Where the gaps are

### 2.1 Controllers with **zero** coverage

| Controller                        | Endpoints                                           | Fork-only? | Priority | Why                                                                                                                                                                                                                       |
| --------------------------------- | --------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **timeline.controller**           | `GET /timeline/buckets`, `GET /timeline/bucket`     | Upstream   | **P0**   | The main timeline data path. EXIF filter pass-through is exercised inside `search.e2e-spec.ts:711` but the access matrix (`spaceId`, `withSharedSpaces`, `personId`, `tagId`, partner, libraries, archive, trash) is not. |
| **face.controller**               | `POST/GET /faces`, `PUT/DELETE /faces/:id`          | Upstream   | **P0**   | Face CRUD interacts with space-person dedup which has bitten us repeatedly (PRs #228, #233, #291, #292).                                                                                                                  |
| **gallery-map.controller**        | `GET /gallery/map/markers`                          | **Fork**   | **P1**   | Fork-only filtered map endpoint, distinct from `map.controller`. PRs #189, #202, #274 fixed map filter bugs that no test would have caught.                                                                               |
| **view.controller**               | `GET /view/folder/unique-paths`, `GET /view/folder` | Upstream   | **P2**   | Folder-by-path browsing. Library users hit this.                                                                                                                                                                          |
| **workflow.controller**           | full CRUD (5 endpoints)                             | **Fork**   | **P2**   | Plugin-backed workflows, fork-only. Owner-only access — small surface, easy win.                                                                                                                                          |
| **plugin.controller**             | `GET /plugins{,/triggers,/:id}`                     | **Fork**   | **P3**   | Read-only listing. Lower risk but fully untested.                                                                                                                                                                         |
| **notification.controller**       | full CRUD                                           | Upstream   | **P2**   | 6 endpoints, none tested. Owner-scoped.                                                                                                                                                                                   |
| **notification-admin.controller** | 3 endpoints                                         | Upstream   | **P3**   | Admin notification + email templates.                                                                                                                                                                                     |
| **queue.controller**              | 5 endpoints                                         | Upstream   | **P3**   | Admin queue control. There is a `jobs.e2e-spec.ts` but it tests the legacy `/jobs/*` controller, not the new `/queues/*`.                                                                                                 |
| **sync.controller**               | 6 endpoints                                         | Upstream   | **P3**   | Has unit tests but no API e2e. Mobile-only consumer.                                                                                                                                                                      |

### 2.2 Spec files with significant **endpoint holes**

These are controllers that have a spec file, but the spec doesn't cover the full surface — usually because endpoints were added after the spec was first written.

#### `shared-space.e2e-spec.ts` (1404 lines, missing 11 of 28 endpoints)

Existing `describe` blocks confirmed: spaces CRUD, members, assets (single/bulk add/remove), timeline preference, view marker, activities, map-markers. **Missing entirely**:

- `GET    /shared-spaces/:id/people`
- `GET    /shared-spaces/:id/people/:personId`
- `GET    /shared-spaces/:id/people/:personId/thumbnail`
- `PUT    /shared-spaces/:id/people/:personId`
- `DELETE /shared-spaces/:id/people/:personId`
- `POST   /shared-spaces/:id/people/:personId/merge`
- `PUT    /shared-spaces/:id/people/:personId/alias`
- `DELETE /shared-spaces/:id/people/:personId/alias`
- `GET    /shared-spaces/:id/people/:personId/assets`
- `POST   /shared-spaces/:id/people/deduplicate`
- `PUT    /shared-spaces/:id/libraries`
- `DELETE /shared-spaces/:id/libraries/:libraryId`

This is the **single largest fork-relevant hole**. Memory entries `project_space_person_data_fix`, `project_denormalize_space_people`, `project_space_person_dedup`, `project_hide_space_person`, `project_space_filter_cross_filtering`, `project_space_people_performance` all touched these endpoints and shipped without API tests.

#### `asset.e2e-spec.ts` (1243 lines, missing the new fork extensions)

Existing blocks: GET/PUT/DELETE/POST asset, statistics, random, faces, partner assets, thumbnail, original. **Missing**:

- `GET /assets/:id/metadata`, `PUT /assets/:id/metadata`
- `GET /assets/:id/metadata/:key`, `DELETE /assets/:id/metadata/:key`
- `GET /assets/:id/ocr`
- `GET /assets/:id/edits`, `PUT /assets/:id/edits`, `DELETE /assets/:id/edits` — `video-trim.e2e-spec.ts` covers `action=trim` only; **other edit actions and the GET listing have no tests**
- `PUT /assets/copy`
- `PUT /assets/metadata`, `DELETE /assets/metadata` (bulk)
- `POST /assets/jobs` (`runAssetJobs`)
- `POST /assets/bulk-upload-check`
- `PUT /assets/:id/original` (replace asset bytes)
- `GET /assets/:id/video/playback`
- `GET /assets/device/:deviceId`

#### `library.e2e-spec.ts` (1448 lines, missing space-link surface)

Library CRUD is well covered, but **the link-to-space code path is untested** — `linkLibrary` / `unlinkLibrary`, plus the resulting "library assets become visible to space members" behaviour. Memory entries `project_space_library_sync`, `project_library_space_search_fix`, `project_library_sync_param_limit`, `project_library_people_audit` all live here.

#### `search.e2e-spec.ts` (1282 lines, mostly good)

Good coverage of `spaceId` access on search, large-assets, random, smart, suggestions, temporal scoping. **Holes**:

- Sort order tests (PR #254 added two-phase CTE smart-search sorting — no tests).
- `searchPlaces`, `searchPerson` (no auth, no shared-space scoping case).

#### `map.e2e-spec.ts` (170 lines, thin)

Covers `GET /map/markers` and `reverse-geocode` happy path. **Missing**:

- `spaceId` scoping (PR #275)
- Space-linked library visibility on map
- People filter on map (PR #189, #202)
- Country/city filter (PR #274)
- The fork-only `gallery-map` endpoint entirely (see §2.1)

#### `classification.e2e-spec.ts` (92 lines, very thin)

Covers `POST /classification/scan` admin gate only. **Missing**:

- Effect tests: classification SystemConfig + scan → tags appear / archive flag set
- Negative case: disabled in config → scan no-ops
- Re-scan trigger when category similarity / prompts change (PR #235)

#### `tag.e2e-spec.ts` (603 lines, well-covered for owner)

**Missing**: tag-suggestions over space content with `withSharedSpaces=true` (PR #230). Currently tested in `filter-suggestions.e2e-spec.ts` but only via the `/search/suggestions/filters` endpoint, not the dedicated `/search/suggestions/tags`.

#### `person.e2e-spec.ts` (346 lines)

Covers global people CRUD. **Missing**:

- `searchPerson` global vs space-scoped behaviour (related to space-people).
- `reassignFaces` for a face that lives in a shared space asset.

#### `system-config.e2e-spec.ts` (51 lines, 2 tests, **basically empty**)

Should at minimum cover: read defaults, partial update validation, IMMICH_CONFIG_FILE locking (PR #297), classification config round-trip.

### 2.3 Other immediate cleanups

- **`e2e/src/api/specs/duplicate.e2e-spec.ts`** is in the wrong directory and almost certainly does not run with the rest of the suite. Move it to `e2e/src/specs/server/api/duplicate.e2e-spec.ts` and delete the empty parent directory.

---

## 3. The Permission / Actor Matrix

A reusable definition. Every new spec should pick the relevant subset and exercise it explicitly.

### 3.1 Actors

| ID               | Role                                              | How to set up                  |
| ---------------- | ------------------------------------------------- | ------------------------------ |
| `anon`           | No `Authorization` header                         | omit                           |
| `regularA`       | Owner of the resource under test                  | `userSetup()`                  |
| `regularB`       | Unrelated regular user                            | `userSetup()`                  |
| `partner`        | Has accepted partner share with `regularA`        | `apiUtils.createPartner()`     |
| `spaceOwner`     | Owner of the space                                | `createSpace()`                |
| `spaceEditor`    | Editor in the space                               | `addSpaceMember(role: Editor)` |
| `spaceViewer`    | Viewer in the space                               | `addSpaceMember(role: Viewer)` |
| `spaceNonMember` | Knows the space ID but is not in it               | a fresh `userSetup()`          |
| `libraryOwner`   | Owns the external library linked to the space     | admin + `createLibrary()`      |
| `admin`          | `isAdmin = true`                                  | `adminSetup()`                 |
| `apiKeyLow`      | API key with only the minimum-required permission | `createApiKey([Permission.X])` |
| `apiKeyEmpty`    | API key with **none** of the required permissions | `createApiKey([])`             |
| `sharedLink`     | Public visitor with a valid `key`                 | `createSharedLink()`           |

### 3.2 Resource scopes

Each test should annotate which scope it's exercising:

- `own` — owner's own asset
- `partnerShared` — visible via partner share only
- `space` — visible via direct `shared_space_asset` link
- `spaceLibrary` — visible via `shared_space_library` link
- `library` — admin's library, no space link
- `sharedLink` — public via shared link
- `none` — caller has no path to the resource

### 3.3 Expected outcomes

`200/201`, `400` (validation), `401` (no auth), `403` (forbidden / `missingPermission`), `404` (resource not found OR not visible — pick one and stick with it).

### 3.4 Helpers to add to `e2e/src/utils.ts`

These will pay back across all the new specs:

```ts
// Build a complete space context with all roles wired up
buildSpaceContext(): Promise<{
  admin, owner, editor, viewer, nonMember,
  spaceId, ownerAssetId, editorAssetId, libraryAssetId
}>

// Run an endpoint against every actor in a list and assert outcome
forEachActor(actors, fn: (actor) => Promise<request.Response>, expected: {actorId: status})

// Create a partner relationship in one call
addPartner(fromToken, toUserId)

// Create a face row + space_person row for a given asset
attachSpacePerson(spaceId, assetId, name)
```

The `forEachActor` helper turns the matrix from a 30-line copy-paste into a one-liner per endpoint. This is the single biggest reason existing specs don't have full matrices.

---

## 4. New spec files (priority ordered)

Each entry below is intended to be one PR. The "test cases" lists are deliberately specific so they can be turned into TDD checklists by a follow-up agent.

### P0 — Highest leverage, do these first

#### **NEW: `timeline.e2e-spec.ts`** — biggest hole, biggest catch

Covers `GET /timeline/buckets` and `GET /timeline/bucket`. Most filter-scoping bugs in project memory would be caught here.

Test cases:

1. **Auth**: `anon → 401`, `apiKeyEmpty → 403`, `apiKeyLow → 200`.
2. **Owner happy path**: `regularA` with no filter sees their own assets in both `/buckets` and `/bucket`.
3. **Visibility**: archive, hidden, trashed are excluded by default; `visibility=archive`/`hidden` includes them.
4. **`spaceId` scoping**:
   - `spaceOwner` sees only space assets when `spaceId=X` is set.
   - `spaceViewer` and `spaceEditor` see same.
   - `spaceNonMember` → 403.
   - `regularA` (own asset NOT in space) cannot leak own asset into the space view.
5. **`withSharedSpaces=true`**:
   - Returns own assets ∪ assets in any space where `showInTimeline=true`.
   - Setting `showInTimeline=false` hides that space's assets.
   - Library-linked space assets are included via the UNION.
6. **Filter combinations** (cross-product the most-broken ones):
   - `personId` + `spaceId` — uses **space** person ID (different from global; bug pattern from PR #260, #251).
   - `tagIds` + `spaceId` — tags must be reachable from the space content, not just `regularA`'s tag list.
   - `country` / `make` / `rating` + `spaceId` — must use space content.
7. **Partner share**: `regularA` with `withPartners=true` sees partner's timeline assets.
8. **Singular `/bucket`**: same access matrix as `/buckets` — easy to forget.

Estimate: ~25–30 tests, ~600 lines.

#### **NEW: `face.e2e-spec.ts`**

Covers `POST/GET /faces`, `PUT/DELETE /faces/:id`.

Test cases:

1. **Auth matrix**: 401 / 403 / 200 for each verb.
2. **Owner can create a face on own asset**, cannot create on someone else's.
3. **Reassign face**: from person A to person B (same owner), then validate person A's `assetCount` decreased and B's increased.
4. **Reassign cross-owner**: should 404/403 (cannot move to another user's person).
5. **Delete face**: removes the face row, person `assetCount` updates, no orphaned `shared_space_person` rows.
6. **Space-person side effect**: deleting a face that contributes to a `shared_space_person` triggers dedup queue. (Memory: `project_space_person_dedup_trigger`.)
7. **Faces below `minFaces` threshold** must not be addressable (PR #139).

Estimate: ~15 tests, ~350 lines.

#### **EXTEND: `shared-space.e2e-spec.ts`** — add `/people/*` and `/libraries`

This is the largest extension, but it's all under one file, so one PR. Could split into two if it gets too big.

##### People sub-tree

Standard auth matrix (`anon`, `nonMember`, `viewer`, `editor`, `owner`) on each endpoint. Then:

1. **GET `/people`**:
   - Returns space-scoped person IDs (different from global).
   - Excludes hidden persons (PR #200).
   - Excludes pets when `space.showPets=false` (memory: `project_space_pet_toggle`).
   - Excludes persons with face counts below `minFaces`.
   - Pagination via `top` param (PR #227).
2. **GET `/people/:personId`**: returns name, alias, thumbnail URL.
3. **GET `/people/:personId/thumbnail`**:
   - 200 with binary for member.
   - 404/403 for non-member.
   - Returns underlying face thumbnail via JOIN, no `thumbnailPath` column (PR #196).
4. **PUT `/people/:personId`**: rename and hide. Verify only `editor`/`owner` can.
5. **DELETE `/people/:personId`**: removes the space person; underlying global person untouched.
6. **POST `/people/:personId/merge`**: merge two space persons; assets move; non-merged person deleted; `assetCount` consistent.
7. **PUT/DELETE `/people/:personId/alias`**: per-space alias does not affect global person name; visible to all members.
8. **GET `/people/:personId/assets`**: returns only that space's assets containing the person; access-scoped.
9. **POST `/people/deduplicate`**: triggers dedup job; jobId deduplication (PR #292) — second call within window does not enqueue twice.

##### Libraries sub-tree

1. **PUT `/libraries`**:
   - Admin owner of space can link a library they own.
   - Admin editor can link.
   - Non-admin owner cannot.
   - Non-member cannot.
   - Linking same library twice is idempotent (or 409 — pin behaviour).
2. **DELETE `/libraries/:libraryId`**:
   - Editor/owner can.
   - Viewer cannot.
   - Non-existent link → 404.
3. **Side effect**: After link, library assets appear in `/timeline/buckets?spaceId=X` for all members. After unlink, they vanish on the next call.
4. **Library asset access via space**: `spaceViewer` can `GET /assets/:id/thumbnail` for a library asset reachable through their space membership; cannot for a library asset whose library is unlinked.

Estimate: ~40 tests, ~1000 lines added to the existing file.

#### **EXTEND: `library.e2e-spec.ts`** — add space-link side effects

Most of this overlaps with the shared-space extension above, but anchor the tests on the library side too:

1. After `linkLibrary`, the library's assets appear in `space.assetCount` and `getSpacePeople`.
2. After `deleteLibrary`, all `shared_space_library` rows are cascaded.
3. Soft-deleted asset in linked library is hidden from space members.
4. Offline asset (`isOffline=true`) is hidden from space members.

Estimate: ~10 tests, ~250 lines.

### P1 — Fork-only, smaller surface

#### **NEW: `gallery-map.e2e-spec.ts`** (or fold into `map.e2e-spec.ts`)

Covers `GET /gallery/map/markers` (fork-only filtered map endpoint).

Test cases:

1. Auth matrix.
2. Filters: `personIds`, `tagIds`, `country`, `city`, `make`, `model`, `rating`, `dateFrom/dateTo`, `withFavorite`, `withArchived`.
3. `spaceId` scoping (PR #275 — pre-selected photos in space map cluster).
4. `withSharedSpaces=true`.
5. Hidden persons excluded from people-filtered markers (PR #202).
6. `gallery-map` vs `map`: same data set when no filters; `gallery-map` honours filters that `map` ignores.

Estimate: ~15 tests, ~350 lines.

#### **EXTEND: `map.e2e-spec.ts`** — add the missing scoping

1. `spaceId` scoping happy + nonmember 403.
2. Space-linked library asset appears on space map.
3. `visibility=Timeline|Archive|Hidden` cases.

Estimate: ~6 tests, ~150 lines.

#### **NEW: `view.e2e-spec.ts`**

Covers `GET /view/folder/unique-paths`, `GET /view/folder`.

Test cases:

1. Auth matrix.
2. Returns only paths under the user's own assets.
3. Library-linked asset paths visible if the user has library access.
4. **Does NOT** leak space-linked library paths to other space members through the folder browse — folder browse is owner-scoped, not space-scoped (verify intent first).

Estimate: ~10 tests, ~250 lines.

#### **NEW: `workflow.e2e-spec.ts`**

Covers full CRUD on `/workflows`.

Test cases:

1. Auth matrix per verb.
2. Owner-scoped: `regularB` cannot read `regularA`'s workflows.
3. Validation: bad trigger ID → 400; circular references → 400.
4. Update changes propagate; delete cascades.

Estimate: ~12 tests, ~280 lines.

### P2 — Useful but lower bug-rate

#### **NEW: `notification.e2e-spec.ts`**

Full CRUD matrix for both `/notifications` and `/admin/notifications`. Auth + owner-scoping + admin-only routes. ~12 tests.

#### **NEW: `plugin.e2e-spec.ts`**

Read-only listing. Verify auth and that fork's bundled plugins (classification, pet-detection, etc.) are listed. ~6 tests.

#### **EXTEND: `asset.e2e-spec.ts`** — metadata K/V, OCR, edits, copy

This file is already 1243 lines — consider splitting into `asset-metadata.e2e-spec.ts`, `asset-edits.e2e-spec.ts`, etc.

1. **Metadata K/V** (`/assets/:id/metadata` + `/:key`):
   - PUT round-trips a key.
   - GET `/metadata` returns the full bag.
   - GET `/metadata/:key` returns single value, 404 for missing key.
   - DELETE removes the key.
   - Bulk PUT/DELETE on `/assets/metadata`.
   - Cross-owner: cannot read another user's asset metadata.
   - Space member CAN read metadata of a space asset; viewer cannot WRITE.
2. **OCR**: GET `/assets/:id/ocr` returns text for processed asset; access matrix.
3. **Edits (non-trim)**: GET `/edits`, PUT `/edits` for spatial actions, DELETE clears all edits. Verify combination rules.
4. **Copy** (`PUT /assets/copy`): creates a new asset, increments owner quota, retains EXIF, fails if source not visible.
5. **Replace** (`PUT /assets/:id/original`): owner-only, updates checksum, triggers re-extraction.
6. **`POST /assets/jobs`**: enqueues per-asset jobs; admin gating.
7. **`POST /assets/bulk-upload-check`**: returns existence map.

Estimate: ~30 tests, ~700 lines (or split into 2 PRs).

#### **EXTEND: `classification.e2e-spec.ts`**

1. SystemConfig round-trip for classification block.
2. Scan → expected category tag appears on a fixture asset.
3. Disabled in config → scan no-ops.
4. Smart re-scan when category similarity / prompts change (PR #235, memory `project_classification_smart_rescan`).
5. `IMMICH_CONFIG_FILE` lock blocks UI updates (PR #297).

Estimate: ~10 tests, ~250 lines.

#### **EXTEND: `system-config.e2e-spec.ts`**

Full read/write coverage for the config sections the fork has changed: classification, pet-detection, machineLearning.clip.maxDistance (PR #294), shared-space defaults.

Estimate: ~10 tests, ~250 lines.

### P3 — Completionist

| Spec                             | Notes                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `queue.e2e-spec.ts`              | The new `/queues/*` admin controller. `jobs.e2e-spec.ts` only covers the deprecated `/jobs/*`. ~10 tests. |
| `notification-admin.e2e-spec.ts` | Admin notification + email templates. ~6 tests.                                                           |
| `sync.e2e-spec.ts`               | Full + delta + ack flow. ~12 tests. Mobile-only consumer, lower priority.                                 |
| `auth.e2e-spec.ts` extension     | Add change-password, pin-code lifecycle, session lock/unlock. ~10 tests.                                  |

---

## 5. Cleanup work (no new tests)

1. **Move `e2e/src/api/specs/duplicate.e2e-spec.ts`** → `e2e/src/specs/server/api/duplicate.e2e-spec.ts`. Delete the parent dir if empty. Verify it actually runs in CI afterwards.
2. **Add the helpers from §3.4** to `e2e/src/utils.ts`. Single PR, no behavioural change. Unblocks every other PR.
3. **Audit `expect.poll` usage** — every "wait for queue" call in non-admin specs needs `expect.poll` instead of `waitForQueueFinish` (memory: `feedback_e2e_admin_only_queues`).

---

## 6. Suggested rollout order

Group into PRs that each take ~1 session and have a clean revert story.

| PR  | Content                                                                                         | Why this order                        |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | §5 cleanup + §3.4 helpers + move stray duplicate spec                                           | Unblocks everything; no new behaviour |
| 2   | NEW `timeline.e2e-spec.ts` (P0)                                                                 | Highest bug-catching ROI              |
| 3   | EXTEND `shared-space.e2e-spec.ts` — `/people/*` half                                            | Largest fork hole                     |
| 4   | EXTEND `shared-space.e2e-spec.ts` — `/libraries` half + `library.e2e-spec.ts` link side effects | Pairs naturally                       |
| 5   | NEW `face.e2e-spec.ts`                                                                          | Feeds into space-person dedup         |
| 6   | NEW `gallery-map.e2e-spec.ts` + EXTEND `map.e2e-spec.ts`                                        | Fork map surface                      |
| 7   | EXTEND `asset.e2e-spec.ts` — metadata K/V + OCR                                                 | Smaller PR                            |
| 8   | EXTEND `asset.e2e-spec.ts` — edits + copy + replace                                             | Smaller PR                            |
| 9   | NEW `view.e2e-spec.ts` + NEW `workflow.e2e-spec.ts`                                             | Both small fork-only                  |
| 10  | EXTEND `classification.e2e-spec.ts` + `system-config.e2e-spec.ts`                               | Config-driven features                |
| 11  | NEW `notification.e2e-spec.ts` + `plugin.e2e-spec.ts`                                           | Lower-risk fillers                    |
| 12  | NEW `queue.e2e-spec.ts` + `notification-admin.e2e-spec.ts`                                      | Admin endpoints                       |
| 13  | NEW `sync.e2e-spec.ts`                                                                          | Mobile sync flow                      |
| 14  | EXTEND `auth.e2e-spec.ts`                                                                       | Long tail                             |

PRs 1–6 cover the highest-value 80%; 7–10 are the long tail of fork features; 11–14 are completionism.

---

## 7. Non-goals & decisions to make later

- **Browser-side**: This plan is API-only on purpose. The Playwright suite stays small and focused on the things that genuinely require a browser (drag/drop, keyboard nav, scroll/intersection observers).
- **Mock-based component tests**: Some of the gaps could in principle be covered by Vitest component tests in `web/`. The trade-off (memory: `feedback_e2e_mock_filterpanel`) is that mock-based component tests for FilterPanel-like components are unreliable. Default to API e2e for anything access-control-shaped, and keep component tests for pure rendering logic.
- **Should some new specs be split files?** `asset.e2e-spec.ts` is already 1.2k lines and extensions push it to 2k. Splitting into `asset-core`, `asset-metadata`, `asset-edits` is probably worth it but is a separate cleanup PR.
- **Per-PR CI cost**: Each new spec file adds ~10-30s to the API e2e job (no extra Docker, no browser). The full plan adds ~5 minutes total — well below the Playwright tax.

---

## 8. Open questions for the maintainer

1. Do we want to enforce a "every new server endpoint must have an entry in `e2e/src/specs/server/api/`" CI check? It would prevent regressions but slow down feature PRs. Decision deferred.
2. Should `forEachActor` be a vitest-style `it.each` wrapper, or a synchronous matrix builder? Both work; pick whichever the first PR's author finds least painful.
3. Some of the boundary cases in §4 (e.g. "library asset visible after link, hidden after unlink") could equivalently be tested as **medium tests** in `server/`. Where the test really exercises HTTP semantics or DTO shape, e2e is correct. Where it's purely service logic, medium tests are faster. Each PR should ask this question explicitly.
