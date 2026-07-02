# Upstream Sync Report — 2026-07-02 (batch 307)

## Summary

- **Upstream commits pulled**: 1 (`4b54fef82e..237734bb26`)
- **Fork commits synced**: 0 (`origin/main` already == `integratedForkHead` `31e7c05bcc`)
- **Conflicts resolved**: 0 (clean rebase across all 850 fork commits)
- **Fork adaptations**: 1 commit — two fork-only preference test fixtures gained the new
  required `recentlyAdded` field.
- **Concurrent fork work carried along**: 1 commit — `#739` (mobile filter/search facets for
  shared-space viewers) was pushed directly to the rolling branch during this rebase window and
  is preserved on top of the rebased fork commits (see "Concurrent Fork Work").
- **Risk level**: LOW.
- **Recommendation**: PROCEED (pending CI on the test branch).

Single, cleanly-scoped upstream feature: a user-preference-gated "Recently added" link in the
web sidebar (`#29039`). The planner flags it MEDIUM only because it matches the
`openapi-generated` risk pattern (it regenerates the OpenAPI clients); there is no logic risk.
Plan-local id **308**, report/global counter **307**. Fork stays on tagged base `2.7.5`.

## Incoming Upstream Changes

| SHA          | PR     | Summary                                   | Area                               | Risk to Fork | Notes                                                                                                 |
| ------------ | ------ | ----------------------------------------- | ---------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `237734bb26` | #29039 | feat(web): recently added link in sidebar | web / server pref / mobile openapi | LOW          | Adds a `recentlyAdded.sidebarWeb` user preference gating a new sidebar `NavbarItem`. Purely additive. |

### Change breakdown (all additive)

- **Server**: `types.ts`, `utils/preferences.ts`, `dtos/user-preferences.dto.ts` — new
  `recentlyAdded: { sidebarWeb }` preference (`RecentlyAddedUpdateSchema` / `RecentlyAddedResponseSchema`)
  appended to the existing preference structures + default.
- **Web**: `UserSidebar.svelte` (new gated `NavbarItem` + `mdiUploadOutline` import),
  `FeatureSettings.svelte` (new toggle accordion), `test-data/factories/preferences-factory.ts`.
- **Mobile**: `openapi_patching.dart` (+1 line, `RecentlyAddedResponse(sidebarWeb: false)` in the
  `UserPreferencesResponseDto` patch block) + regenerated Dart client.
- **i18n**: `en.json` +1 key (`recently_added_description`).
- **e2e**: two mock-preference fixtures.

## Conflict Resolutions

None. The rebase replayed all 850 fork commits with zero conflicts — every upstream hunk landed
in a region disjoint from the fork's edits (including `openapi_patching.dart`, where upstream
touches the `UserPreferencesResponseDto` block and the fork's edit is in the `ServerConfigDto`
OpenFreeMap block). The "lost upstream content" check confirmed all upstream additions survived
and the fork's OpenFreeMap patch is intact.

## Post-Rebase Fork Adaptations

Two **fork-only** test fixtures hand-build a preferences object and were missing the newly
required `recentlyAdded` field. Neither exists upstream, so `#29039` could not update them.

| File                                    | Symptom                                                                                                        | Fix                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `server/src/utils/preferences.spec.ts`  | Full `UserPreferences` literal → `tsc` error TS2741 (property `recentlyAdded` missing).                        | Added `recentlyAdded: { sidebarWeb: false }`. |
| `web/.../side-bar/user-sidebar.spec.ts` | Partial mock → `UserSidebar.svelte` read of `preferences.recentlyAdded.sidebarWeb` threw at runtime (2 tests). | Added `recentlyAdded: { sidebarWeb: false }`. |

Committed as `fix(server,web): add recentlyAdded preference to fork preference test fixtures (#29039)`.

## Fork Feature Verification

| Feature                            | Status | Notes                                                                    |
| ---------------------------------- | ------ | ------------------------------------------------------------------------ |
| Fork-owned file survival           | OK     | postrebase-audit: all literal fork-owned files present.                  |
| Fork extension symbols             | OK     | postrebase-audit: all manifest expected symbols present.                 |
| Shared Spaces / User Groups / etc. | OK     | No overlap with the incoming change; full fork surface untouched.        |
| OpenFreeMap map patch (mobile)     | OK     | Fork's `openapi_patching.dart` OpenFreeMap override survived the rebase. |

## CI and Infrastructure Verification

| Check                     | Status | Notes                                                       |
| ------------------------- | ------ | ----------------------------------------------------------- |
| `ci-invariants-check`     | OK     | no PUSH_O_MATIC, Gallery image names, docs-deploy disabled. |
| `fork-patches-check`      | OK     | `@immich/ui` patch metadata consistent.                     |
| Workflow / branding drift | OK     | Batch touches no CI, Docker, or branding files.             |

## Database Migration Analysis

- New upstream migrations: **none** (`#29039` adds no migration).
- Gallery migration count: **33** (expected 33) — unchanged.
- Timestamp collisions: none. Postbuild merge / `CompositeMigrationProvider`: intact.

## Mobile Drift Migration Analysis

- New upstream mobile migrations: **none**.
- `mobile-drift-rebase-check`: schemaVersion (34), snapshots, and Gallery callbacks consistent.
- No renumbering required.

## Generated Artifacts (OpenAPI / SQL)

- Ran full `mise //:open-api` (server build → spec sync → TS SDK → Dart with fork patches).
  Result: **zero drift** — the rebase's 3-way merge of the generated clients is byte-identical
  to a fresh deterministic regen, so CI's "OpenAPI Clients" job will pass with no extra commit.
- `mise //:sql`: **skipped** — no `@GenerateSql` repository changed (would need a live DB and
  would otherwise wipe the committed `.sql`).
- postrebase-audit "Generated Artifact Review" info flag reviewed: the regenerated artifacts are
  exactly the additive `recentlyAdded` DTOs/models plus all fork endpoints — expected for an
  `openapi-generated` batch.

## Local Verification

| Check                                                          | Status | Notes                                      |
| -------------------------------------------------------------- | ------ | ------------------------------------------ |
| `git rebase 237734bb26`                                        | PASS   | 0 conflicts.                               |
| `mise //:open-api`                                             | PASS   | 0 drift.                                   |
| server `tsc --noEmit`                                          | PASS   | after fixture fix.                         |
| web `tsc --noEmit`                                             | PASS   |                                            |
| web `svelte-check`                                             | PASS   | 0 errors (known `0 FILES` worktree quirk). |
| server unit tests                                              | PASS   | 4697 passed, 9 skipped, 0 failed.          |
| web unit tests                                                 | PASS   | 3286 passed, 2 skipped, 8 todo, 0 failed.  |
| `dart analyze` (openapi_patching.dart)                         | PASS   | No issues found (mise flutter 3.44.1).     |
| ESLint + Prettier (changed files)                              | PASS   |                                            |
| postrebase-audit / fork-patches / ci-invariants / mobile-drift | PASS   | survival + invariants all OK.              |

## Concurrent Fork Work

While this rebase was in flight, `#739`
(`fix(mobile): populate the filter/search facets for a shared-space viewer`) was pushed **directly
to the rolling branch** (not to `origin/main`, so it is outside the `sync-fork-main` /
`integratedForkHead` model). Detected before force-pushing via the origin-tip divergence check.

- It is a **mobile-only** change (11 files: `search_api.repository.dart`,
  filter-sheet people widgets, `city_suggestions`/`filter_suggestions` providers,
  `image_url_builder.dart`, + 5 unit tests) and is **fully disjoint** from `#29039`
  (no shared files).
- Preserved by cherry-picking it onto the rebased fork commits (clean, no conflict — its mobile
  files are identical between the old and new upstream bases), ordered **before** the batch-307
  adaptation + report so the report stays at the tip.
- Patch-id containment (`git cherry`) confirmed nothing from origin/rolling was dropped; the two
  patch-different commits are expected false-positives (`#316` OpenFreeMap — `openapi_patching.dart`
  adjacency to `#29039`; the batch-232 OpenAPI-regen commit — superseded by this batch's regen).
  `#316`'s `config.ts` / `helmet.json` are byte-identical to origin.

Because the CI test branch was re-pushed **with** `#739`, the mobile-affected workflows
(`test.yml`, `static_analysis.yml`, `gallery-build-mobile.yml`) were re-run on the combined branch;
the unaffected server/web/docker/storage workflows stay green from the first dispatch.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-307`
- First dispatch (batch 307 only, all GREEN): `test.yml`, `docker.yml`, `static_analysis.yml`,
  `gallery-build-mobile.yml`, `gallery-rebase-smoke.yml`, `storage-migration-tests.yml`,
  `storage-migration-e2e.yml`, `gallery-revert-to-immich-validation.yml`.
- Re-dispatch (after carrying `#739`): `test.yml`, `static_analysis.yml`, `gallery-build-mobile.yml`.

## Post-Rebase Verification

- Fork commits ahead of upstream: **853** (850 rebased fork + `#739` + 1 adaptation + this report).
- Commits behind upstream: **0**.
- Batch-308 tip `237734bb26` is an ancestor of HEAD: **YES**.
- `#739` preserved (patch-id verified); origin/rolling fully contained.
- Fork diff looks clean: YES.
