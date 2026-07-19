# Slice 9 — Mobile parity (M4, M8, L12, L13) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD where a repo
> query changes. Phase 2 (deferred). **Mobile (Flutter/Dart).**

**Goal:** Bring the mobile app to parity with web on the space-album arm: show album-linked space photos
on the personal home timeline/map/video/place (M4), give mobile album owners the view+revoke recourse
(M8), stop dropping archived space-person assets (L12), and fix the misleading version-gate comment (L13).

## Toolchain (do this FIRST — Slice 9 is mobile)

- From `mobile/`, bring up the pinned Flutter SDK: try `mise exec -- flutter --version` (rolling uses
  Flutter 3.44.1; `mise install` first if needed). If mise doesn't provide it, locate the Dart/Flutter
  SDK (`which dart flutter`, check `mise.toml`/`.tool-versions`).
- **Generate the prerequisites** (per AGENTS.md): `flutter pub get`, then
  `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart` (the `lib/generated/*.g.dart`
  are gitignored).
- **M4 changes `merged_asset.drift` → generated Drift Dart is committed and MUST be regenerated:**
  `dart run build_runner build --delete-conflicting-outputs` (or the repo's codegen script). Commit the
  regenerated `.drift.dart`/`.g.dart`. If you cannot run build_runner, **do not** hand-edit generated
  code blindly — STOP and report M4 as blocked on codegen (still land M8/L12/L13).
- CI-equivalent static gate: `dart analyze --fatal-infos lib test` (CI runs `--fatal-infos` over the
  WHOLE package incl. `test/` — `flutter analyze lib` alone misses test lints). Then `flutter test <path>`
  for touched repos.

## Global Constraints (spec §0)

- TDD for the query changes (Drift repo tests). No co-author trailers. One commit per finding.
  Re-confirm exact lines. `dart analyze --fatal-infos lib test` + touched `flutter test` MUST pass;
  report clearly what you could/couldn't run if the toolchain is partial.

---

### M4 — personal timeline/map/video/place miss the space-ALBUM arm

**Files:** `mobile/lib/infrastructure/repositories/viewer_visibility.dart` (`buildViewerVisibilityJoins`
`:40`, `viewerVisibilityPredicate` `:84`), `mobile/lib/infrastructure/entities/merged_asset.drift`
(~`:60`), `mobile/lib/infrastructure/repositories/timeline.repository.dart` (six call sites ~875/908,
988/1029, 1171/1224 — re-confirm), + the regenerated Drift codegen.
**Problem (verified from spec):** the viewer-visibility joins/predicate + the raw `merged_asset.drift`
query cover only the **direct** (`shared_space_asset`) and **library** (`shared_space_library`) arms —
no `shared_space_album_asset ⋈ shared_space_album_link(showInTimeline)` arm. The server includes the
album leg (`asset.repository.ts`, `map.repository.ts`); mobile home/map/video/place drop album-linked
space photos. Under-inclusion, not a leak.

- [ ] **Test (Drift repo) RED:** a member with the space timeline toggle on, an album linked with
      `show_in_timeline=true` containing a visible asset → the personal-timeline query returns that asset.
      RED today (no album arm). Positive control: `show_in_timeline=false` per-album OR member toggle off →
      excluded.
- [ ] **Implement:** add a **third arm** to `viewerVisibilityPredicate` / `buildViewerVisibilityJoins`
      and `merged_asset.drift`, gating on **both** toggles (`shared_space_album_link.show_in_timeline` per
      album **AND** `shared_space_member.show_in_timeline` per member). Add the two album-entity `import`s to
      `merged_asset.drift` so `.watch()` reactivity tracks them. Add two LEFT JOINs + `isNotNull()` at the
      six `timeline.repository.dart` call sites. Regenerate Drift codegen.
- [ ] Commit: `feat(mobile): show space-album photos on the personal timeline/map/video/place (M4)`

### M8 — mobile album owners can't view/revoke space links

**Files:** mobile album detail / options sheet (grep `album` detail page + options sheet under
`mobile/lib/**`), the OpenAPI-generated `getAlbumInfo` (`GET /albums/:id`) + `unlinkAlbum`
(`DELETE /shared-spaces/{spaceId}/albums/{albumId}`) SDK calls.
**Problem (verified from spec):** `AlbumResponseDto.sharedSpaceLinks` (owner-only, not in the Drift sync
stream) is rendered on web but no mobile UI reads it, and all mobile unlink affordances are space-role
gated → a mobile-only album owner whose co-editor linked the album into a space can't discover or revoke it.

- [ ] **Implement:** add a "Linked spaces" section to the mobile album detail/options sheet for **owned**
      albums, fetching `GET /albums/:id` on demand (the field is owner-only, absent from the Drift stream),
      with a per-link unlink calling `DELETE /shared-spaces/{spaceId}/albums/{albumId}` (server already allows
      the owner path without space membership — Slice 4 preserved that). Gate the section to owned albums.
- [ ] **Test:** a widget/repo test for the fetch + unlink call if the surface is testable; else a
      provider/service unit test. At minimum `dart analyze` clean + the section renders for owned albums only.
- [ ] Commit: `feat(mobile): linked-spaces view + owner revoke on the album detail sheet (M8)`

### L12 — space-person timeline drops archived assets (7th site)

**File:** `mobile/lib/infrastructure/repositories/timeline.repository.dart:971`.
**Verified:** `filter: (row) => row.deletedAt.isNull() & row.visibility.equalsValue(AssetVisibility.timeline) & row.id.isIn(assetIds)`
— the space-person origin filters `visibility == timeline` only; the server returns Timeline+Archive.
Commit 9185ff58e2 fixed 6 sites, missed this one.

- [ ] **Test (Drift repo) RED:** a space-person's **archived** asset is returned by the space-person
      timeline query. RED today. Positive control: a Hidden/Locked asset stays excluded.
- [ ] **Implement:** change the predicate to
      `(row.visibility.equalsValue(AssetVisibility.timeline) | row.visibility.equalsValue(AssetVisibility.archive))`
      at `:971`, mirroring the 9185ff58e2 archive fixes.
- [ ] Commit: `fix(mobile): include archived assets in the space-person timeline (L12)`

### L13 — misleading version-gate comment

**File:** `mobile/lib/infrastructure/repositories/sync_api.repository.dart:110-114`.
**Verified:** gate is `if (serverVersion > const SemVer(major: 5, minor: 0, patch: 0)) ...[` the 5
`SharedSpaceAlbum*` request types. The comment (`:110-113`) still claims a complementary server
drop-unknown filter that was reverted (M14/L18 territory).

- [ ] **Implement (comment only here):** fix the `:110-113` comment to state the server **rejects**
      unknown request types with 400 and every future request type must be client version-gated (the server
      filter was reverted). Do NOT change the gate value — the enforcement (pin to the real first-feature
      version) is M14 in Slice 10. Add a `// TODO(M14)` cross-reference.
- [ ] Commit: `docs(mobile): correct the sync version-gate comment re reverted server filter (L13)`

---

## Definition of done

- M4 (with regenerated Drift codegen), M8, L12, L13 landed. `dart analyze --fatal-infos lib test` clean;
  `flutter test` green for touched repos (or clearly report which couldn't run + why). If build_runner
  was unavailable, M4 is reported BLOCKED (land the other three). Commits pushed. Scope-clean (mobile only).
