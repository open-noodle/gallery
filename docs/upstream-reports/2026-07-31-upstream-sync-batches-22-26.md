# Upstream Sync Report — 2026-07-31 (batches 22–26)

Continuation of `2026-07-31-upstream-sync-batches-15-21.md` (arc 1). This report covers arc 2 —
batches **22–26** — which brings the rolling branch **fully level with `upstream/main`**.

## Summary

- **Rolling branch**: `rebase/upstream-rolling-v3.1.1`
- **Upstream base**: `56fbca910eb` (batch 21) → **`aa565f5ca07`** (batch 26)
- **Commits behind `upstream/main`**: **0**
- **Upstream commits pulled**: 6 (batches 22–26)
- **Fork commits replayed**: 1036
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED — full CI set (10 workflows) GREEN

## Incoming Upstream Changes

| SHA           | Summary                                                          | Batch | Area   | Risk     | Notes                                                    |
| ------------- | ---------------------------------------------------------------- | ----- | ------ | -------- | -------------------------------------------------------- |
| `9732bebb55a` | fix(server): store null instead of '' for user password (#30223) | 22    | server | MEDIUM   | Migration; `user.password` nullable                      |
| `7149dd803`   | fix(docs): remove unraid as an "official" deployment (#30323)    | 23    | docs   | LOW      |                                                          |
| `6b99f0223`   | fix(docs): revise config file instructions (#30418)              | 23    | docs   | LOW      | Renames the example to `immich-config.json`              |
| `e7aace436d2` | chore(mobile): stricter linting — correctness (#30372)           | 24    | mobile | **HIGH** | 9 new rules; 95 fork sites, none auto-fixable            |
| `6b6058c4631` | feat: store null instead of '' for album.description (#30123)    | 25    | server | **HIGH** | Migration + DTO + **sync contract**; broke a fork stream |
| `aa565f5ca07` | chore(deps): update github-actions (major) (#30309)              | 26    | CI     | LOW      | `actions/labeler` v6→v7; `setup-uv` v8→v9                |

## Batch 25 (HIGH) — the fork's third album sync stream

Upstream made `album.description` nullable in the database but **deliberately kept the sync wire
contract non-nullable**, coercing `?? ''` at its two album send sites with a
`// TODO: return null instead of '' in v4` marker.

The fork has a **third** stream over the same `SyncAlbumV2` shape — `syncSharedSpaceAlbumsV1` — which
upstream obviously did not update. `tsc` caught it, but the type error understates the consequence:
mobile decodes `SyncAlbumV2.description` as non-nullable, so shipping a null would have broken the
client at runtime, not just the build. Fixed with the identical coercion and the same TODO
(`d16a561bb0a`).

**Recurring lesson**: when upstream applies a compatibility shim at N call sites, grep for fork-only
siblings of the same shape. The type checker found this one only because the DTO is typed; a
loosely-typed stream would have shipped silently.

Fork code was otherwise unaffected by the nullability change — the only non-test `description === ''`
comparison in the tree is OpenAPI spec post-processing in `server/src/utils/misc.ts`, unrelated to
albums.

## Batch 24 (HIGH) — the correctness lint sweep

95 fork sites. **`dart fix` has no automated fix for either rule that fired**, so every one was
applied mechanically and verified.

| Rule                            | Count | Fix                      |
| ------------------------------- | ----- | ------------------------ |
| `discarded_futures`             | 85    | wrap in `unawaited(...)` |
| `cast_nullable_to_non_nullable` | 10    | `x as T` → `x! as T`     |

There is **no per-site judgement** to make, for a reason worth recording: `discarded_futures` fires
only in **synchronous** contexts, where `await` is not available — that is exactly what separates it
from `unawaited_futures`. Every site is an `initState` / `onTap` / builder callback. So `unawaited()`
is the only available fix, and it is behaviour-preserving: it documents intent without changing
execution. (The pre-arc estimate of ~169 sites was measured against a different baseline.)

The other batch-24 rules (`close_sinks`, `cancel_subscriptions`, `unawaited_futures`,
`no_adjacent_strings_in_list`, `throw_in_finally`, `collection_methods_unrelated_type`,
`no_self_assignments`) produced zero fork violations.

### Two scripting traps worth remembering

Applying 95 edits by script hit two bugs, both caught before commit:

1. **`dart analyze` reports `discarded_futures` at the _method name_, not the statement start.**
   Inserting at the reported column produces `context.unawaited(maybePop(ids))`. The wrap must scan
   **backward** to the true statement start.
2. **A block-opening `{` is a statement boundary, not "inside an argument list".** Treating `{` like
   `(` and `[` made the scanner refuse 59 valid sites. Separately, the backward scan must stop at a
   `//` comment or it wraps from inside the comment text — that produced the one syntax error.

## Deliberate divergences taken in this arc

| File                                    | Upstream wanted                        | Taken as                  | Why                                                                                                                           |
| --------------------------------------- | -------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/prepare-release.yml` | batch 26 `setup-uv` v8→v9              | **file stays deleted**    | fork removed the whole workflow in `chore: unified release versioning from git tags (#207)`; it has its own release workflows |
| `docs/docs/install/config-file.md`      | rename example to `immich-config.json` | rename **+** fork rebrand | fork rebrands prose Immich→Gallery; both apply                                                                                |

`actions/labeler` v6→v7 in `pr-labeler.yml` **was** taken — that workflow is upstream's, only patched
by the fork for `PUSH_O_MATIC` removal, and it neither pushes images nor signs builds. This does not
disturb the deliberate pre-existing drift on the fork's _own_ workflows.

## Generated artifacts

`open-api/immich-openapi-specs.json` was **stale after the rebase**: upstream #30123 added an
`x-immich-history` annotation to `AlbumResponseDto.description` that did not survive the merge of the
committed spec. `test.yml`'s "OpenAPI Clients" job would have failed its `verify-changed-files` check.
Regenerated via `sync-open-api` (`1bf46929918`); re-running is now a no-op. The TypeScript SDK is
unchanged (history annotations are metadata only) and the Dart client is generated at build time.

**This is worth checking every rebase** — the post-rebase audit's "Generated Artifact Review" passed,
so the audit does not catch spec staleness on its own.

## `revert-to-immich.sql` (skill step 7i)

Both new migrations needed entries or `gallery-revert-to-immich-validation` fails on this branch
**and every branch based on it**:

- `1784664555996-AlbumDescriptionNullable`
- `1784986754473-ConvertUserPasswordEmptyStringToNull`

Section 7 restores the data and the `NOT NULL`; step 8 deletes the `kysely_migrations` rows. The
`UPDATE` must run **before** `SET NOT NULL` in each — rows written since the migration carry NULL and
would violate the constraint. No existence guards are needed here: unlike the `DROP COLUMN` reversals
above them, these columns exist in both schemas and only their nullability differs, so all six
statements are idempotent.

Verified end-to-end, not just by the coverage grep — see Remote CI below.

## Automated gate results

| Check                                    | Status | Notes                                            |
| ---------------------------------------- | ------ | ------------------------------------------------ |
| `upstream-postrebase-audit BATCH=26`     | OK     | 7/7; Gallery migration count 49 (expected 49)    |
| `ci-invariants-check`                    | OK     | 3/3                                              |
| `fork-patches-check`                     | OK     | `@immich/ui` patch consistent                    |
| `mobile-drift-rebase-check BATCH=26`     | OK     | schemaVersion / snapshots / callbacks consistent |
| `revert-to-immich.sql` coverage detector | OK     | clean after the two additions                    |

## Local CI Verification

| Check                                        | Status | Notes                                 |
| -------------------------------------------- | ------ | ------------------------------------- |
| `server pnpm build` (+ migration sync)       | PASS   | "Synced 49 … 1 compatibility aliases" |
| `server pnpm check` (tsc)                    | PASS   | after the sync.service.ts fix         |
| `server pnpm lint`                           | PASS   | `--max-warnings 0`                    |
| Server unit tests                            | PASS   | 5262 passed / 14 skipped              |
| `web check:typescript`                       | PASS   |                                       |
| `web check:svelte`                           | PASS   | 571 files, 0 errors                   |
| web eslint (`tscompat` off)                  | PASS   | 0 errors; 1 pre-existing warning      |
| Web unit tests                               | PASS   | 4003 passed                           |
| `mobile dart analyze --fatal-infos lib test` | PASS   | 0 issues                              |
| `mobile dart format`                         | PASS   | idempotent                            |
| `flutter test`                               | PASS   | 2982 passed / 1 skipped               |
| `sync-open-api` idempotence                  | PASS   | no drift on re-run                    |
| dart-nullable-array-items regression         | PASS   | 2/2 (the check `test.yml` runs)       |
| docs prettier                                | PASS   |                                       |

## Remote CI Verification

- **Test branch**: `rebase/upstream-arc2-b26`
- **Commit validated**: `1bf46929918`
- **Result**: **10 / 10 GREEN**

| Workflow                                  | Status | Notes                                            |
| ----------------------------------------- | ------ | ------------------------------------------------ |
| `test.yml`                                | GREEN  |                                                  |
| `docker.yml`                              | GREEN  |                                                  |
| `static_analysis.yml`                     | GREEN  | validates the 95-site batch-24 sweep             |
| `gallery-build-mobile.yml`                | GREEN  | iOS **and** Android compile after the sweep      |
| `gallery-mobile-smoke.yml`                | GREEN  |                                                  |
| `gallery-ml-smoke.yml`                    | GREEN  |                                                  |
| `gallery-rebase-smoke.yml`                | GREEN  | green on re-run — registry rate limit, see below |
| `storage-migration-tests.yml`             | GREEN  |                                                  |
| `storage-migration-e2e.yml`               | GREEN  |                                                  |
| `gallery-revert-to-immich-validation.yml` | GREEN  | green on re-run; **reached `validation PASSED`** |

### The revert validation pass is the real one

The skill warns that a passing coverage grep is necessary but **not** sufficient — drift only shows
in the Docker-boot half. This run reached the end of that half:

```
Pre-phase baseline drift (0 item(s)):
Post-phase drift (0 item(s)):
::notice::post: no new schema drift compared to pre-phase baseline
::notice::revert-to-immich validation PASSED
```

So the two migration reversals were exercised against a Gallery-migrated database, upstream Immich
v3.1.0 booted on it, and zero schema drift was introduced.

### Two confirmed environmental failures

`Gallery Revert-to-Immich Validation` and `Gallery Rebase Smoke` both failed on the first pass with:

```
docker: toomanyrequests: retry-after: …, allowed: 44000/minute
```

Both died at their **first image pull**, before running any project code — the known consequence of
dispatching ~10 workflows simultaneously. Both green on re-run. **Stagger dispatches** (or accept one
re-run round) on future full-suite runs.

## Post-Rebase Verification

- Batches 22–26 tips: all ancestors of HEAD
- `git log HEAD..upstream/main` → **0** — the branch is level with upstream
- Working tree clean; `mise.lock` and `mobile/pubspec.yaml` untouched

## Follow-up work

1. **Non-idempotent e2e upload retry** (carried from arc 1, still open) — `e2e/vitest.config.ts`
   `retry: 4` re-uploads identical bytes, so one slow upload becomes a guaranteed 5-attempt failure
   with `duplicate` errors. Fix at the root: tolerate `duplicate` on retry, or drop blanket retry for
   upload specs.
2. **`x-immich-history` spec staleness** — worth a cheap guard, since the post-rebase audit does not
   catch it and only `test.yml`'s `verify-changed-files` does.
3. The fork's **own** workflows remain on older action majors (checkout v4/v6, setup-node v6, cache
   v5). Pre-existing, deliberate — they push images, sign mobile builds and deploy docs.
