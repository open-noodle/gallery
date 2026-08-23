# Upstream Sync Report — 2026-08-13 (addendum: person-model reconciliation)

Addendum to `2026-08-13-upstream-sync-quarantine-person-model.md`, which opened the quarantine. This
report closes it.

## Summary

- **Quarantine**: RELEASED. All 3 quarantined commits taken, plus the 6 that were held behind them.
- **Upstream commits pulled**: 9 (`943c11c0196..af33a78d180`)
- **Branch**: **level with `upstream/main`** (`git rev-list --count HEAD..upstream/main` = 0), batches **95 / 95**
- **Fork commits synced**: 0 (`origin/main` unchanged at `93f844e9aaa` since the #980 sync)
- **Conflicts resolved**: 5 in the final replay, plus the per-commit resolutions recorded below
- **Risk level**: MEDIUM — a model rework across the fork's largest mobile feature surface
- **Recommendation**: PROCEED to remote CI + a staging RC. Still **off `main`**; newest upstream tag is `v3.1.0`.

Driven from `docs/superpowers/specs/2026-08-13-mobile-person-model-reconciliation-design.md` and its
plan. The reconciliation itself is Phase 1–3 of that plan; this report covers the upstream-facing half.

## Incoming Upstream Changes

| #   | SHA           | Summary                                                        | Area   | Outcome                                     |
| --- | ------------- | -------------------------------------------------------------- | ------ | ------------------------------------------- |
| 3   | `52edcc0c74c` | refactor: unify person model (#30659)                          | mobile | TAKEN — fork fields carried onto `Person`   |
| 4   | `303a9f15b1a` | refactor: reactive `driftGetAllPeopleProvider` (#30660)        | mobile | TAKEN — invalidation split (see below)      |
| 5   | `1c3a5cf5087` | chore: remove old people provider (#30662)                     | mobile | TAKEN — rename + fork's family key kept     |
| 6   | `2a1691868e7` | chore: `import.meta.dirname` instead of `__dirname` (#30738)   | build  | TAKEN clean                                 |
| 7   | `ff5da0f84fc` | chore: `immich_mobile` path in openapi pubspec (#30643)        | config | TAKEN clean — genuine fix for our layout    |
| 8   | `db9e7c20d71` | chore(mobile): single mise checkout command (#30737)           | mobile | TAKEN — fork's Flutter pin preserved        |
| 9   | `b82d4805525` | fix(mobile): iOS status bar scroll during transitions (#30717) | mobile | TAKEN — 3 conflicts, all import/CRLF shaped |
| 10  | `a939561e70f` | feat: workflow asset tag trigger/filter/action (#29043)        | server | TAKEN — broke 2 fork-only specs (see below) |
| 11  | `af33a78d180` | fix: typos in debug log messages (#30742)                      | server | TAKEN clean                                 |

## The reconciliation — what the fork keeps

Upstream collapsed `PersonDto` + `DriftPerson` into one `Person { id, name, updatedAt?, birthDate? }`.
The fork's people surfaces are built on fields upstream dropped, so the unified model carries three
fork additions:

| Field            | Why it survives                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `spaceId`        | Routes edits to the editor-gated shared-space endpoint and thumbnails to the membership-gated one. Non-null ⇒ Space               |
| `numberOfAssets` | The photos-filter picker's per-row count, sourced from the already-fetched DTO                                                    |
| `isFavorite`     | `comparePeople`'s "favorites first" tier — the server-backed list is sorted **client-side**, so the flag must survive the mapping |

Dropped as upstream intended: `isHidden`, `ownerId`, `createdAt`, `color`, `thumbnailPath`,
`faceAssetId`. `isHidden`'s only remaining reader was a defence-in-depth filter in `PeopleGrid`;
it was deleted after confirming hidden people are excluded at all three sources (server
`withHidden: false` on both the global and space lists, and the local Drift `isHidden.equals(false)`).

### The invalidation split — the trap this quarantine existed for

Upstream made the **local** people list reactive and deleted the `ref.invalidate` calls at the two
edit modals and `tab_shell`. The fork paired every one of those with an invalidate of a
**server-backed** `FutureProvider`, which is not reactive. Taking upstream's deletion at face value
would have silently stopped the People page refreshing after a rename or birthday edit.

Resolution: take the deletion **only** for the local list, and route every server-backed list through
one helper — `ref.invalidateServerPeopleLists()`, over a `serverPeopleListProviders` registry — at all
five sites (`tab_shell`, `gallery_bottom_nav`, both edit modals, `person_picker`). The sixth site,
`space_people.page.dart`, deliberately stays a family-member-scoped invalidation, which the
argument-less helper cannot express; it carries a comment pointing at the helper.

`gallery_bottom_nav.widget.dart` is **fork-only**, so upstream's deletion never reached it and no
conflict fired — it was found by an explicit sweep, not by git.

### Other resolutions worth keeping

- `driftGetAllPeopleProvider` → upstream's `getAllPeopleProvider`, as a `StreamProvider.family` that
  keeps the fork's `PeopleSortBy` key. The repository grew a shared `_allPeopleQuery(...)` feeding both
  `watch()` and `getAllPeople()`, so the per-sort-mode SQL `ORDER BY` is written once.
- `updateBrithday` → upstream's spelling fix `updateBirthday`, while keeping the fork's `(Person, …)`
  signature — it needs the model, not an id, to route on `spaceId`.
- `PersonApiRepository`: `_personToDriftPerson` → `_toPerson`, `_toDriftPerson` → `_toAssetPerson`
  (both build `Person`); the epoch-0 `updatedAt` sentinel is gone now that the field is nullable.
- `SharedSpaceApiRepository._spacePersonToDriftPerson` → `_toPerson`.
- `mobile/lib/main.dart` conflicted **whole-file**: upstream's copy is CRLF, the fork's has been LF for
  ages. Resolved by keeping LF and re-applying upstream's one-line change onto it (same call as the
  earlier cycle recorded).

## Zero-conflict breaks caught (3)

All three merged cleanly and were found by tests or an explicit sweep — none by git, tsc or `dart analyze`:

1. **`isFavorite` dropped in `PersonApiRepository._toPerson`.** Analyze stayed clean because the field
   simply falls back to its `false` default; only the repository's ordering test failed. Left unfixed,
   "favorites first" would have silently stopped working on the People page and the filter picker.
2. **Upstream #29043 widened `AssetTag` to `{ assetId, userId }`.** Upstream has no test calling
   `handleTagAsset` directly — the fork does, in a fork-only `describe` block, so only the fork went red.
3. **Same commit added a third workflow trigger.** `workflow.service.spec.ts` is fork-only and asserts
   the trigger catalogue exhaustively, so it went stale the moment upstream added `AssetTagged`.

`packages/sdk/src/fetch-client.ts` nearly carried a fourth: a conflict in the generated `WorkflowTrigger`
enum offered `PersonRecognized` as one side. The source of truth (`packages/plugin-sdk/src/types.ts`) has
it **commented out on both sides**, so no generator emits it — resolved against the source, and a later
full regen confirmed the file byte-for-byte.

## Verification

Local, all green at `74b051ea9b4`:

| Gate                                                        | Result                                                                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flutter test` (Flutter 3.44.9)                             | 3266 passed / 1 skipped / 0 failed                                                                                                                                                              |
| `dart analyze --fatal-infos lib test`                       | No issues found                                                                                                                                                                                 |
| `dart format` (lib scope, CI's exact find-expression)       | 0 changed                                                                                                                                                                                       |
| `server pnpm check` / `pnpm test`                           | clean / 5685 passed, 12 skipped                                                                                                                                                                 |
| `web check:typescript` / `check:svelte` / `pnpm test`       | clean / 608 files 0 errors / 5633 passed                                                                                                                                                        |
| `node dist/bin/sync-open-api.js` then `git status open-api` | **zero drift**                                                                                                                                                                                  |
| oazapfts regen of `packages/sdk/src/fetch-client.ts`        | **zero drift**                                                                                                                                                                                  |
| `make mobile-drift-rebase-check`                            | OK                                                                                                                                                                                              |
| `make fork-ownership-coverage-check`                        | 3644 fork files covered                                                                                                                                                                         |
| `make ci-invariants-check` / `make fork-patches-check`      | OK / OK                                                                                                                                                                                         |
| `make upstream-postrebase-audit`                            | OK except the informational Generated Artifact Review — diffed: only the known fork-only #743 patch step in `generate-dart-sdk.sh`; the openapi pubspec patch is now byte-identical to upstream |

Spec verification hook (`\bDriftPerson\b|\bPersonDto\b|\bdriftGetAllPeopleProvider\b|\bupdateBrithday\b`
over `mobile/lib` + `mobile/test`): **0 hits**. The word boundaries matter — `FilterSuggestionsPersonDto`,
`DriftPersonRoute`, `DriftPersonPage` and `DriftPersonNameEditForm` are live, correct symbols.

## Still to do

- Remote CI: push the test branch and dispatch the full gate set (staggered).
- Stage an RC and validate the People surfaces by hand before any force-push: rename and birthday edits
  for a personal **and** a space person must refresh visibly, space-person thumbnails must render, and the
  library people card must update after a sync (that card is the surface that now relies on the reactive
  stream rather than an invalidation).
