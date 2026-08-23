# Upstream Sync Report — 2026-07-31 (batches 15–21)

Continuation of `2026-07-31-upstream-sync.md` (batches 12–14). This report covers lifting the
batch-15 **Dart lint quarantine** and rolling batches **15–21**, stopping deliberately at a
mid-boundary before batch 22.

## Summary

- **Rolling branch**: `rebase/upstream-rolling-v3.1.1`
- **Upstream base**: `0293414abd9` (batch 14) → **`56fbca910eb`** (batch 21)
- **Upstream commits pulled**: 12 (batches 15–21)
- **Fork commits replayed**: 1032
- **Commits requiring conflict resolution**: ~37
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED for 15–21; batch 22+ held for arc 2

### Why the arc stops at batch 21

Pierre asked for a mid-boundary stop with full CI green before continuing. Batch 21 is the natural
cut: it is the last batch before the first of two upstream **migrations**, and it splits the Dart
lint overhaul cleanly in half.

| Batch  | Lint commit   | Rules enabled                                                                                                                                                                                 | Arc |
| ------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| **15** | `d864a908117` | Formatting — `prefer_final_locals`, `directives_ordering`, `always_declare_return_types`, `avoid_void_async`, `noop_primitive_operations`, `unnecessary_breaks`, `unnecessary_null_checks`, … | 1   |
| **20** | `858aeadce80` | Flutter + known issues — `use_colored_box`, `use_decorated_box`, `sized_box_for_whitespace`, `avoid_slow_async_io`, `avoid_type_to_string`                                                    | 1   |
| **24** | `e7aace436d2` | **Correctness** — `discarded_futures`, `unawaited_futures`, `cast_nullable_to_non_nullable`, `close_sinks`, `cancel_subscriptions`                                                            | 2   |

Arc 1 therefore carries the **mechanical** half (`dart fix`-able); arc 2 carries the
**judgement-heavy** half (`discarded_futures` alone is ~169 sites) alongside the two migrations.

## Incoming Upstream Changes

| SHA           | Summary                                                              | Batch | Area      | Risk     | Notes                                                                   |
| ------------- | -------------------------------------------------------------------- | ----- | --------- | -------- | ----------------------------------------------------------------------- |
| `d864a908117` | chore(mobile): stricter linting — formatting (#30370)                | 15    | mobile    | MEDIUM   | 208 files reformatted; drives most of this arc's conflicts              |
| `9d03a92b1`   | fix: assetFileFilter path matching (#30394)                          | 16    | plugins   | LOW      | `packages/plugin-core` only                                             |
| `7e70f90c1`   | fix: apply disabled styling to UI buttons (#30322)                   | 16    | mobile-ui | LOW      | `mobile/packages/ui` only                                               |
| `1f16fe16c`   | chore: enable merge queue batching (#30410)                          | 16    | CI        | LOW      | `.mergify.yml`; fork does not use mergify                               |
| `a316ba35c`   | fix: shared check for server setup availability (#30311)             | 17    | server    | **HIGH** | `AuthGuard` now **throws** for any route without `@Authenticated()`     |
| `6afcc39fb`   | chore: sequence pnpm installs in mise tasks (#30412)                 | 18    | build     | LOW      |                                                                         |
| `6e1e79585`   | chore: install mise tools from the lockfile in server image (#30416) | 19    | build     | LOW      | Superseded by fork Dockerfile shape — see divergences                   |
| `7c44c29a8`   | chore: deflake album to asset backfill sync test (#30417)            | 20    | server    | LOW      | Fork had made the same fix independently                                |
| `4a68a8753`   | fix: use trixie-slim base image for cli and e2e-auth-server (#30411) | 20    | build     | LOW      |                                                                         |
| `9a143f004`   | chore(mobile): remove Pigeon generated code (#30343)                 | 20    | mobile    | MEDIUM   | Third codegen-removal commit; co-resolved with the fork's #888 adoption |
| `858aeadce`   | chore(mobile): stricter linting — Flutter + known issues (#30373)    | 20    | mobile    | MEDIUM   |                                                                         |
| `56fbca910`   | chore: skip e2e tests when the stack fails to start (#30414)         | 21    | CI        | LOW      | Not adopted — see divergences                                           |

### Batch 17 (HIGH) — `@Authenticated()` now mandatory

`AuthGuard.canActivate` previously returned `true` for a route with no `@Authenticated()`
decorator; it now **throws**. `AuthenticatedOptions` also became a union (`AuthorizedRoute |
PublicRoute`) with new `public` / `setup` members, and the admin-setup guard moved out of
`AuthService.adminSignUp` into the guard, driven by `@Authenticated({ public: true, setup: true })`.

Verified before rebasing: every route in all six fork-only controllers
(`shared-space`, `storage-migration`, `user-group`, `classification`, `gallery-map`,
`library-manifest`) already declares `@Authenticated()`. The only pre-rebase mismatches were six
**upstream** controllers, all fixed by the commit itself. The fork's own added route
(`GET /server/ml-health`) already carried `@Authenticated({ permission: Permission.ServerAbout })`.

Upstream also converted `index.spec.ts`'s bootstrap-route test into
`should declare authentication on every route`, so a future fork route missing the decorator fails
CI loudly rather than silently becoming public.

One fork test had to go — see "Fork test removed" below.

## Deliberate divergences taken in this arc

| #   | File                           | Upstream wanted                                        | Resolved as                                           | Why                                                                                                                                                                                                                                                   |
| --- | ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `mobile/analysis_options.yaml` | Re-add `always_put_control_body_on_new_line`           | **Kept disabled**, all 15 new batch-15 rules taken    | The fork disabled this rule deliberately in `7060ec3abdb` (May 2026). Reversing a maintainer decision mid-rebase is out of scope; it also keeps ~97 sites out of this sweep.                                                                          |
| 2   | `.github/workflows/test.yml`   | `id: docker` + `if: steps.docker.outcome == 'success'` | **Fork's hardening kept**, upstream guard not adopted | The fork's `ci: harden e2e readiness diagnostics` removes `if: !cancelled()` from the e2e steps, so they already fail-fast when the stack doesn't start — the same goal, via default step gating. Fork also adds a `Capture Docker diagnostics` step. |
| 3   | `server/Dockerfile`            | `mise install --locked` in the plugins stage           | **Step absent** (fork removed it)                     | Fork commit `fix(rebase): repair batch 143` deleted the standalone `mise install` from the plugins stage; the stage now uses `mise exec` with an explicit tool spec. Nothing to add `--locked` to.                                                    |
| 4   | `mobile/lib/main.dart`         | CRLF (upstream's copy has CRLF line endings)           | **LF**                                                | The fork's copy has been LF since before this arc; upstream's batch-15 formatting was re-applied on top of the LF file rather than flipping every line ending.                                                                                        |

Divergences 2–4 are recorded here because they mean the corresponding upstream commits are
**effectively no-ops on this branch** — a future reader diffing against upstream will see the gap.

## Fork test removed

`server/src/services/auth.service.spec.ts` — `adminSignUp > should throw if admin setup is disabled`.

This was a **fork-added** test (absent from upstream's pre-batch-17 spec). Upstream moved the guard
into `AuthGuard`, so `AuthService.adminSignUp` no longer performs the check and the test failed with
`Cannot read properties of undefined (reading 'metadata')`. Coverage did not regress: upstream added
`auth.guard.spec.ts` cases (11 `setup` references) plus a medium test. A comment now points at the
new location.

## Pattern Propagation

| Refactor                          | Old → New                                               | Fork files affected | Decision     | Commit        |
| --------------------------------- | ------------------------------------------------------- | ------------------- | ------------ | ------------- |
| Dart lint (batches 15 + 20)       | ~25 new rules over `lib` + `test`                       | 47                  | **Bundled**  | `a7322eb452e` |
| Dart lint (batch 24, correctness) | `discarded_futures`, `cast_nullable_to_non_nullable`, … | TBD (~190 sites)    | **Deferred** | arc 2         |

The bundled sweep was far smaller than the pre-arc estimate (575). Measured after the rebase:

| Stage                                      | Issues |
| ------------------------------------------ | ------ |
| After codegen, before fixes                | 69     |
| After `dart fix --apply lib` / `test`      | 1      |
| After one hand fix (`use_named_constants`) | **0**  |

The gap versus the estimate is explained by (a) divergence #1 keeping ~97
`always_put_control_body_on_new_line` sites out of scope, (b) batch 24's ~190 correctness sites not
being enabled in this arc, and (c) upstream's own reformatting of shared files covering much of the
rest as it replayed.

## Fork Feature Verification

| Feature                    | Status | Notes                                                                              |
| -------------------------- | ------ | ---------------------------------------------------------------------------------- |
| Shared Spaces              | OK     | Post-rebase audit: fork-owned files + extension symbols all present                |
| Storage Migration          | OK     | S3 `serveFromBackend` + Range-request doc comment preserved in `base.service.ts`   |
| Pet Detection              | OK     |                                                                                    |
| Image Editing              | OK     |                                                                                    |
| Branding                   | OK     | `ci-invariants-check` green                                                        |
| Google Photos Import       | OK     |                                                                                    |
| Mobile filter parity       | OK     | Legacy `mobile/lib/widgets/search/search_filter/` deletion honoured (10 files)     |
| Mobile shared-space people | OK     | `person_edit_name_modal` signature change preserved                                |
| Smart search (untagged)    | OK     | `_tagIdsForSearch` / `_ExplicitNullTagIds*` intact in `search_api.repository.dart` |

## Automated gate results

| Check                                    | Status | Notes                                                      |
| ---------------------------------------- | ------ | ---------------------------------------------------------- |
| `upstream-postrebase-audit BATCH=15`     | OK     | 7/7 checks                                                 |
| `upstream-postrebase-audit BATCH=21`     | OK     | 7/7 checks; Gallery migration count 49 (expected 49)       |
| `ci-invariants-check`                    | OK     | no PUSH_O_MATIC, Gallery image names, docs-deploy disabled |
| `fork-patches-check`                     | OK     | `@immich/ui` patch consistent                              |
| `mobile-drift-rebase-check BATCH=21`     | OK     | schemaVersion / snapshots / Gallery callbacks consistent   |
| `revert-to-immich.sql` coverage detector | OK     | no MISSING entries — arc 1 adds no migrations              |

## Local CI Verification

| Check                                        | Status | Notes                                           |
| -------------------------------------------- | ------ | ----------------------------------------------- |
| `server pnpm build` (+ migration sync)       | PASS   | "Synced 49 … 1 compatibility aliases"           |
| `server pnpm check` (tsc)                    | PASS   |                                                 |
| `server pnpm lint`                           | PASS   | `--max-warnings 0`                              |
| Server unit tests                            | PASS   | 5262 passed / 14 skipped                        |
| `packages/sdk` build                         | PASS   | built into the worktree, not the main checkout  |
| `web check:typescript`                       | PASS   |                                                 |
| `web check:svelte`                           | PASS   | 571 files, 0 errors (did **not** no-op locally) |
| web eslint (`tscompat` off)                  | PASS   | 0 errors; 1 pre-existing warning (see below)    |
| Web unit tests                               | PASS   | 4003 passed                                     |
| `mobile dart analyze --fatal-infos lib test` | PASS   | 0 issues                                        |
| `mobile dart format` (CI scope)              | PASS   | idempotent, 0 changed on re-run                 |
| `mobile packages/ui dart analyze`            | PASS   |                                                 |
| `flutter test`                               | PASS   | 2982 passed / 1 skipped                         |
| docs prettier                                | PASS   |                                                 |
| OpenAPI / SQL regen                          | N/A    | no controller/DTO/repository change in this arc |

The single web lint warning (`searchResultTotal` assigned but never read, in the search route) is
**pre-existing** — identical at the pre-arc tip — and `web`'s lint script has no `--max-warnings 0`,
so it is not a gate.

## Remote CI Verification

- **Test branch**: `rebase/upstream-arc1-b21`
- **Commit validated**: `505268602e1`
- **Result**: **10 / 10 GREEN**

| Workflow                                  | Status | Notes                                                |
| ----------------------------------------- | ------ | ---------------------------------------------------- |
| `test.yml`                                | GREEN  | Green on re-run — one confirmed flake, see below     |
| `docker.yml`                              | GREEN  | Validates the `server/Dockerfile` resolutions        |
| `static_analysis.yml`                     | GREEN  | Confirms the Dart lint sweep + `dart format` in CI   |
| `gallery-build-mobile.yml`                | GREEN  | iOS **and** Android compile after the Pigeon removal |
| `gallery-mobile-smoke.yml`                | GREEN  |                                                      |
| `gallery-ml-smoke.yml`                    | GREEN  |                                                      |
| `gallery-rebase-smoke.yml`                | GREEN  |                                                      |
| `storage-migration-tests.yml`             | GREEN  |                                                      |
| `storage-migration-e2e.yml`               | GREEN  |                                                      |
| `gallery-revert-to-immich-validation.yml` | GREEN  | Coverage grep + Docker boot                          |

PR-gated workflows (codeql / zizmor / docs-build / cli) were not run; this arc is not HIGH-risk
overall and no PR was opened for the test branch.

### Confirmed flake — and the latent bug behind it

First `test.yml` run: `End-to-End Tests (Server & CLI)` failed with 1 of 1474 tests red —
`asset.e2e-spec.ts:995`, `expected 'duplicate' to be 'created'`. Green on re-run.

The mechanism is worth recording because "flaky" understates it:

1. Attempt 1 failed with `Timed out waiting for assetUpload event` on a 31 MB RICOH GR III raw
   file — the test itself carries a comment that raw thumbnail generation "can take a while".
2. `e2e/vitest.config.ts` sets `retry: process.env.CI ? 4 : 0`.
3. `utils.createAsset` re-uploads the **same bytes**, so every retry correctly returns `duplicate`.

One slow upload therefore becomes a guaranteed 5-attempt failure (`[2/5]` in the log): the retry is
**not idempotent for uploads**. Arc 1 did not touch this path — its only `e2e/` changes are
`mise.toml` (batch 18), `responses.ts` (batch 17 removing the now-dead `alreadyHasAdmin` DTO), and a
maintenance spec. This is upstream's test and upstream's retry config; fixing it properly (make the
retry tolerate `duplicate`, or exclude upload specs from blanket retry) is logged as follow-up
rather than accepted as background noise.

## Post-Rebase Verification

- Batches 15–21 tips: all ancestors of HEAD
- Batch 22 tip (`9732bebb55a`): **not** an ancestor — mid-boundary held as instructed
- Working tree clean

## Follow-up work (arc 2)

1. **Batch 22** — `ConvertUserPasswordEmptyStringToNull` migration → needs a `revert-to-immich.sql`
   entry (step 7i).
2. **Batch 24** — the correctness lint sweep (`discarded_futures` ≈169 sites, concentrated in
   `search_api.repository.dart`, `drift_memory.page.dart`, `space_detail.page.dart`, `main.dart`,
   `login_form.dart`). Each site needs a per-call decision between `unawaited(...)` and a real
   `await`.
3. **Batch 25** — `AlbumDescriptionNullable` migration → also needs a `revert-to-immich.sql` entry.
4. **Batch 26** — GitHub Actions major bump; note the fork's own workflows are deliberately behind
   (pre-existing drift).
5. **Non-idempotent e2e upload retry** (not arc-2 blocking) — `retry: 4` re-uploads identical bytes,
   so any slow upload turns one timeout into a hard failure. Worth fixing at the root rather than
   re-running: either tolerate `duplicate` on retry, or drop blanket retry for upload specs.
