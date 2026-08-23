# Upstream Sync Report — 2026-08-23 (batch 146 + fork sync)

## Summary

- **Upstream commits pulled**: 1 (batch 146)
- **Fork commits synced from `origin/main`**: 14
- **Conflicts resolved**: 0 upstream, 16 across 6 of the 14 fork commits
- **Risk level**: MEDIUM — the upstream commit was trivial; the fork sync carried three
  independent zero-conflict break classes
- **Recommendation**: PROCEED (remote CI pending)

Branch `rebase/upstream-rolling-v3.1.1` @ `4ef89a440f1` — **level with `upstream/main`**
(`b26b0cc806a`), 1294 fork commits ahead, 0 behind. Still **off `main`**: upstream has
released no tag past `v3.1.0`, so the standing landing rule is not met and
`branding/config.json` stays at `3.1.0`.

## Incoming Upstream Changes

| SHA           | Summary                                                                           | Area   | Risk to Fork | Notes                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------- | ------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b26b0cc806a` | fix(server): let a second metadata extraction replace stored AV metadata (#30900) | server | LOW          | `upsertExif`'s audio/video/keyframe `ON CONFLICT DO UPDATE` lists self-assigned (`ref('asset_audio.bitrate')`); switched to `excluded`, plus `asset_video.frameCount` added to the update list. |

### Product-direction gate

Not triggered. The commit is a self-contained bugfix in one repository method plus its medium
spec. It introduces no feature, reshapes no data model, and sets no product direction.

### Zero-conflict detectors (run before the rebase)

| Detector                                                                                          | Result                                 |
| ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Shape I — files ADDED by the batch that fork history ever owned (scoped to `origin/main`)         | none                                   |
| Deleted string literals still literal-matched by `branding/scripts` / `tools` / `.github/actions` | none                                   |
| Batch touches `i18n/`, `mise.toml`, `Makefile`, package scripts, `.github/`, Dockerfile           | none                                   |
| Shape J — batch converts e2e assertions into an enumerating in-process spec                       | no (spec was modified, not introduced) |

The rebase applied with **zero conflicts**. Because the fork heavily rewrites both touched files,
the end state was verified directly rather than assumed: no `ref('asset_audio|video|keyframe.…')`
self-assignment survives, all three update lists use `excluded`, and `frameCount` is present.

## Fork Sync (`690fd44e12c..0d357bd73df`, 14 commits)

`make upstream-sync-fork-main` threw on the first commit and rolled the batch back, so the 14 were
cherry-picked by hand and `integratedForkHead` was advanced manually. **`rerere` was disabled on
every git invocation** (`git -c rerere.enabled=false`) — it is enabled repo-wide and globally, and
had already begun recording preimages on the failed script run.

Each replayed commit's file set was diffed against `origin/main`'s. All 14 match except two, both
deliberate:

- **#789** — drops `server/src/config.ts`, `server/src/dtos/system-config.dto.ts`,
  `mobile/openapi/lib/model/system_config_memories_dto.dart` and the two generated API artifacts;
  adds `server/src/gallery/config.dto.ts`.
- **#935** — drops two generated `mobile/openapi` models.

### Conflict resolutions

| #   | Commit | Files                                                          | Resolution                                                                                                                                                                                                                                                                                                                                       | Risk                                                                                                                     |
| --- | ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | #789   | `server/src/config.ts`, `server/src/dtos/system-config.dto.ts` | `git rm`. Upstream #30881 deleted both; the fork's memories config lives in the fork-owned leaf `server/src/gallery/config.dto.ts`. `themeMaxDistance` / `personThrowbackDormancyMonths` added to `GalleryMemoriesSchema` + `galleryTopLevelDefaults`. `SystemConfig` is `z.infer<…>` on rolling, so the hand-written type addition is subsumed. | MEDIUM — verified by `gallery/config.dto.spec.ts`, which exists to catch a fork field vanishing from the composed schema |
| 2   | #789   | spec JSON, `fetch-client.ts`, 3 × `mobile/openapi` models      | Deferred: one side taken / `git rm`, restored by a single regeneration at the end.                                                                                                                                                                                                                                                               | LOW                                                                                                                      |
| 3   | #789   | `memory.service.spec.ts` (medium)                              | Union — rolling's added import and `create` helper kept, plus #789's widened enum import and two seed helpers.                                                                                                                                                                                                                                   | LOW                                                                                                                      |
| 4   | #789   | `MemoriesSettings.spec.ts`                                     | Rolling's `AdminConfigDto` vocabulary + #789's two new fields. Asserted that ours-vs-base differed _only_ by the rename before taking theirs.                                                                                                                                                                                                    | LOW                                                                                                                      |
| 5   | #1013  | `sync.service.ts` / `.spec.ts`                                 | Rolling awaits `send`; took #1013's guard above rolling's `await send(...)`.                                                                                                                                                                                                                                                                     | LOW                                                                                                                      |
| 6   | #1014  | 3 files                                                        | Rolling's generated `context.t` accessor and freezed `copyWith` + the commit's `$displayLabel` / chips split.                                                                                                                                                                                                                                    | LOW                                                                                                                      |
| 7   | #990   | 5 files                                                        | Rolling's evolved lines (rich `description` zod, empty-string handling, `!mounted` early return, `context.t.save`, `description \|\| null`) + the commit's `createdAt` plumbing.                                                                                                                                                                 | MEDIUM — album update path; covered by the web/mobile suites                                                             |
| 8   | #1010  | `match_count_footer.widget.dart`                               | Took the commit's `SafeArea` + widget key, restated in `context.t`; paren/brace/bracket balance asserted 0/0/0.                                                                                                                                                                                                                                  | LOW                                                                                                                      |
| 9   | #1004  | `space_albums_shelf.widget.dart`                               | Rolling's generated-translations import and `(_, _)` wildcard + the commit's sort delta.                                                                                                                                                                                                                                                         | LOW                                                                                                                      |
| 10  | #935   | `e2e/src/utils.ts` (×4)                                        | Option-M renamed `asset_face.personId` → `personGroupId`; took the commit's `sourceType` delta in rolling's column vocabulary.                                                                                                                                                                                                                   | MEDIUM — raw SQL, invisible to tsc                                                                                       |
| 11  | #935   | 5 mobile files                                                 | Availability guards taken from the commit, restated with rolling's `unawaited(...)` / `context.t` / `FilterPerson` / freezed forms.                                                                                                                                                                                                              | LOW                                                                                                                      |

A staged-conflict-marker refusal ran before every `cherry-pick --continue`; it never fired.

## Zero-conflict semantic breaks found

Three independent classes, none of which conflicted. All were caught by a gate, not by reading.

1. **The config port (#30881).** #789 was authored on main where `src/config.ts` exists. Four
   files imported `SystemConfig` from it and `system-config.service.spec.ts` called
   `getSystemConfig` / `updateSystemConfig`. **Caught by `server pnpm build` / `pnpm check`.**
2. **Option-M cluster-groups schema.** #789's four new memory queries and two medium specs keyed
   faces on `asset_face.personId` / `person.id`; rolling uses `personGroupId` and a composite
   `person` PK. Spec renames were applied positionally from tsc's own (line, column), back-to-front,
   with a guard against rewriting a longer identifier. **Caught by `pnpm check`** — except one:
   - **`getDormantPeople` needed more than a rename.** On main `GROUP BY person.id` functionally
     determined `person.name` because `id` was the primary key. Under the composite
     `(ownerId, personGroupId)` key it does not, and Postgres rejects the query. `tsc` was green;
     **only SQL generation against a real database surfaced it.** It now groups by both columns.
     Verified by the medium suite.
   - The same rename in `e2e/src/utils.ts` left three `createFace({ personId: … })` call sites in
     cleanly-applied spec files. **Caught by `cd e2e && pnpm check`.**
3. **Rolling's mobile vocabulary.** Four separate moves main is behind on — the deleted
   `translate_extensions.dart`, `PersonDto` → `FilterPerson`, `RemoteAlbumRepository.update` →
   `updateAlbum`, and `SearchFilter` being freezed. **Caught by `dart analyze --fatal-infos` and
   `flutter test`.** The repository rename is the nastiest: `RemoteAlbumRepository` extends Drift's
   `DatabaseAccessor`, so the stale `update` still _resolved_ — to Drift's `update(TableInfo)` —
   and failed as a mocktail type error rather than an unknown method.

**A fourth, from a fork asset rather than code:** #983 replaced the inline logo (984×328 → 984×282),
and `remote_image_request_test.dart` hardcodes the decoded geometry. At the original 320 box the new,
shorter mark trips the loader's no-upscale rule and returns the native size — so simply updating the
numbers would have left the case silently no longer testing cover-downscaling. The box is now 200,
below the artwork's height, and the comment records the constraint.

## Fork Feature Verification

| Check                                            | Status | Notes                                                                                                                                    |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream-postrebase-audit BATCH=146` (7 checks) | OK     | fork-owned files, extension symbols, migration count 60, filename survival, manifest coverage, timestamp collisions, generated artifacts |
| `fork-patches-check`                             | OK     | `@immich/ui` patch metadata consistent                                                                                                   |
| `ci-invariants-check`                            | OK     | no PUSH_O_MATIC, Gallery image names, docs deploy dispatch-only, person-join not viewer-filtered                                         |
| `mobile-drift-rebase-check BATCH=146`            | OK     | schemaVersion, snapshots and Gallery callbacks consistent                                                                                |
| `fork-ownership-coverage-check`                  | OK     | manifest covers 3760 fork files                                                                                                          |
| `gallery-branding-check.sh`                      | OK     | branding + mobile image assets pass, incl. the new five-petal mark                                                                       |
| i18n branding-override detector                  | OK     | no `en.json` value names the upstream product without an override; simulated branded merge is clean                                      |
| `revert-to-immich.sql` migration coverage        | OK     | no migration added this cycle; every gallery + post-`v3.1.0` upstream migration still has an entry                                       |

## Database Migrations

No migrations were added by either side. Gallery migration count unchanged at 60; no timestamp
collisions; `postbuild` synced 60 migrations + 1 compatibility alias.

## Generated Artifacts

Regenerated once, at the end, per the deferred-artifact rule — this is what restores what the
per-commit resolutions dropped:

- `AdminConfigMemoriesDto` gained `themeMaxDistance` + `personThrowbackDormancyMonths`
- `UpdateAlbumDto` gained `createdAt`
- `FilterSuggestionsResponseDto` gained `hasFavorites`, `hasAssetsInAlbum`, `hasAssetsNotInAlbum`

`server/src/queries/*.sql` was regenerated against a **throwaway** Postgres matching CI's image and
migrated from this branch. The shared dev database on :5432 is a **pre-option-M schema**
(`asset_face.personId`, no `person_group`) — generating against it would have written wrong SQL.

`mobile/openapi/lib/model/update_album_dto.dart` was dropped: rolling tracks **zero** files under
`mobile/openapi` (upstream de-committed the generated Dart client; `974b7133758` adopted that and
generation moved to the gitignored `mobile/generated/openapi`). `origin/main` has not adopted it, so
its 551 tracked files ride along with any cherry-pick that touches one.

## Local Verification

| Check                                                | Status | Notes                                                                                                                                                                                                             |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild)                    | PASS   | 60 migrations, 1 alias                                                                                                                                                                                            |
| `server pnpm check` (tsc)                            | PASS   |                                                                                                                                                                                                                   |
| `server pnpm lint` (eslint)                          | PASS   |                                                                                                                                                                                                                   |
| `server prettier --check`                            | PASS   | separate gate from eslint                                                                                                                                                                                         |
| `web check:typescript`                               | PASS   |                                                                                                                                                                                                                   |
| `web check:svelte`                                   | PASS   | 622 files, 0 errors, 0 warnings                                                                                                                                                                                   |
| `web eslint`                                         | PASS   | 0 errors. The 13 warnings are `Unused eslint-disable directive … 'tscompat/tscompat'`, an artifact of the local `--rule off` workaround for the plugin crash; in CI the rule is on and those directives are used. |
| `web prettier --check`                               | PASS   |                                                                                                                                                                                                                   |
| `e2e pnpm check` (tsc)                               | PASS   | caught the three stale `createFace` call sites                                                                                                                                                                    |
| `e2e pnpm lint` / `prettier`                         | PASS   |                                                                                                                                                                                                                   |
| `.github prettier --check`                           | PASS   | own package + CI job                                                                                                                                                                                              |
| `docs` / `i18n` prettier                             | PASS   |                                                                                                                                                                                                                   |
| Server unit tests                                    | PASS   | 6004 passed, 12 skipped                                                                                                                                                                                           |
| Server medium (memory / asset / person)              | PASS   | 182 passed, real DB                                                                                                                                                                                               |
| Web unit tests                                       | PASS   | 5866 passed                                                                                                                                                                                                       |
| `dart analyze --fatal-infos lib test`                | PASS   |                                                                                                                                                                                                                   |
| `dart format` (real gate: `lib`, generated excluded) | PASS   | 866 files, 0 changed                                                                                                                                                                                              |
| `flutter test`                                       | PASS   | 3411 passed                                                                                                                                                                                                       |
| SQL generation                                       | PASS   | 63 files, 685 queries                                                                                                                                                                                             |
| OpenAPI regeneration                                 | PASS   | spec + TS SDK + Dart client                                                                                                                                                                                       |

### Two local-tooling notes

- **`mise run` overrides an exported `PATH`.** The session PATH carries a second mise Flutter
  install that self-reports 3.44.0; `mise run codegen` picked it up and failed with
  `Invalid SDK hash` and then `requires Flutter SDK version 3.44.9`. The codegen steps were run
  directly from `~/.local/share/mise/installs/aqua-flutter-flutter/3.44.9/flutter/bin`.
- **`dart format lib test` is NOT the gate.** `//mobile:format` covers `lib` only, excluding
  generated files. Six `test/` files are format-dirty at HEAD, untouched by this sync — confirmed
  by a control run against pre-sync content — and are therefore pre-existing, not a regression.
  They were restored rather than reformatted, to keep the diff honest.

## Follow-up

- Six `mobile/test/**` files do not satisfy `dart format`. Harmless today because the gate scopes to
  `lib`, but the drift is real and will surface if the gate is ever widened.
