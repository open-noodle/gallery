# Upstream Sync Report — 2026-09-15

## Summary

- **Upstream commits pulled**: 32 (`86ae0dd06c7..ca4637adc79`), replayed as 18 batches across ~1550
  fork commits
- **Upstream version**: Immich v3.2.0 → v3.2.1 (equivalent content; see "Version note" below —
  `branding/config.json` intentionally left at `3.2.0`, this cycle does not land on `main`)
- **Headline payload**: NestJS 11 → 12 + ESM (`"type": "module"`, `moduleResolution: nodenext`,
  `isolatedModules`, `tsc-alias`), Vitest 3 → 4, Kysely 0.28.17 → 0.29.5, `lodash` → `lodash-es`
  (immich-31237, immich-31537)
- **Branch**: `rebase/upstream-rolling-v3.2.1`, HEAD `3e4540f9109`, pushed to
  `origin/rebase/upstream-rolling-v3.2.1` (fast-forward from the branch base, no force)
- **Conflicts resolved**: ~280 hand-resolved commit-stops of ~1498 replayed (the rest auto-merged),
  ~315 file regions hand-resolved in the single largest batch (the ESM commit, 626 files touched by
  upstream)
- **Risk level**: HIGH (toolchain-major migration touching every server/e2e source file plus the
  fork's own migration loader)
- **Recommendation**: PROCEED (stay on the rolling branch — **landing on `main` is out of scope for
  this cycle and is not raised here**; see the skill's standing rule)

This cycle was executed as a 14-task SDD plan
(`.superpowers/sdd/2026-09-14-nestjs12-esm-migration/`), not as a single linear rebase pass, because
the payload required purpose-built tooling (a diff3 import-conflict resolver, a bulk ESM codemod, a
resolve-loop driver) before the batches could be replayed at all. That plan and its per-task briefs
and reports are the detailed record; this report distills the parts that matter for future rebases
and for anyone auditing this sync.

## Incoming Upstream Changes

| SHA               | Summary                                                                    | Area           | Risk to Fork | Notes                                                                                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------- | -------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d6dc6dcc3b1`     | refactor(mobile): `CropAspectRatio` → enhanced enum (immich-31119)         | mobile         | MEDIUM       | Fork's image-editing feature consumes it in 12 places incl. a freezed `@Default`. No `.value` trap fired; `dart analyze --fatal-infos` clean after replay.                                                                                                  |
| `c5fea7f32b8`     | chore(deps): update github-actions (immich-31328)                          | CI             | LOW          | No fork CI file collisions.                                                                                                                                                                                                                                 |
| **`2a626220415`** | **feat: NestJS 12 and ESM (immich-31237)**                                 | **server/e2e** | **HIGH**     | The cycle's payload commit, isolated ALONE in its own batch (batch 03) on purpose. 626 files touched. See "High-Risk Changes" below.                                                                                                                        |
| `7a6cfa65a94`     | chore(mobile): rename person form state class (immich-31428)               | mobile         | LOW          | Mechanical rename, no fork collision.                                                                                                                                                                                                                       |
| `f0b12b9bd2d`     | fix(web): "View asset owners" → "Hide asset owners" wording (immich-31393) | web            | LOW          | Copy-only.                                                                                                                                                                                                                                                  |
| `72f1034c585`     | fix: only run version check in production env (immich-31443)               | server         | LOW          | Fork disables the upstream version check outright (Upstream Infrastructure Detachment); no interaction.                                                                                                                                                     |
| `e039168e4ae`     | fix(server): vacuum after migrations, concurrent reindex (immich-31424)    | server/db      | LOW          | Runs after `CompositeMigrationProvider` completes; no fork-schema interaction.                                                                                                                                                                              |
| `f6501d2f5bb`     | fix: immich-dev (immich-31447)                                             | tooling        | LOW          | Dev-container script, unused by the fork's `make dev`.                                                                                                                                                                                                      |
| `be3bb2a952f`     | fix: show partner assets on people page (immich-31435)                     | server/web     | LOW          | People-page query change, disjoint from the fork's `withSharedSpaces` / cross-owner surface.                                                                                                                                                                |
| `c0eed4902ad`     | chore: version v3.2.0 (immich-31441)                                       | release        | —            | Upstream's own version-bump commit; fork's `branding/config.json` is the independent source of truth and is untouched by this cycle (no `main` landing).                                                                                                    |
| `6874c07dbe0`     | chore(mobile): static Store to unify reactivity (immich-31099)             | mobile         | **HIGH**     | The cycle's single most conflict-dense mobile commit — 13 Store/people files conflicted. All four fork mobile-people invariants verified intact by independent review, including `isFavorite` at `person.dart:73`.                                          |
| `2152191c242`     | fix(web): asset remains in timeline after archive (immich-31348)           | web            | LOW          | Timeline state fix, no fork guard overlap.                                                                                                                                                                                                                  |
| `f346fe1f94c`     | refactor: error handling (immich-31455)                                    | server         | MEDIUM       | Relocated `isConnectionAborted` → `isConnectionAbortedError` in `logger.ts`; fork's `misc.spec.ts` assertions moved intact to `logger.spec.ts:113` (verified byte-equivalent).                                                                              |
| `57470097f91`     | fix(web): preserve search type (immich-31394)                              | web            | LOW          | —                                                                                                                                                                                                                                                           |
| `9abb605b62f`     | fix: sync client disconnect (immich-31461)                                 | server         | LOW          | —                                                                                                                                                                                                                                                           |
| `7abd625af30`     | docs(server): document UTC timeBucket format (immich-31421)                | docs           | LOW          | Related to the fork's own separately-shipped `#1093` (midnight-UTC `timeBucket` acceptance, landed just before this cycle).                                                                                                                                 |
| **`0f901eea5ec`** | **fix(web): scroll timeline to top w/o scroll target (immich-31464)**      | **web**        | **HIGH**     | Split upstream's old `else` into `else if (scrollTarget)` + a new unguarded `else { scrollTo(0) }`. The replayed fork guard (#625, temporal-anchor) only covered the old branch — **shipped as a Critical, fixed in fix round 1**. See "High-Risk Changes". |
| `070ef032582`     | fix(web): show full path on hover in duplicates utility (immich-31468)     | web            | LOW          | —                                                                                                                                                                                                                                                           |
| `eb84a5ad7f3`     | chore: separate renovate groups for ml engines (immich-31516)              | CI             | LOW          | —                                                                                                                                                                                                                                                           |
| **`221ddd31c4a`** | **feat: server imports linting (immich-31537)**                            | **server**     | **MEDIUM**   | Adds `eslint-plugin-import-x` + `unrs-resolver: false` to `pnpm-workspace.yaml`. Fork's `pnpm-workspace.yaml` union-resolved cleanly (fork's two keys + upstream's third). `eslint --fix` autofixed 18 files + 3 manual import-order fixes.                 |
| `f4461c9d44e`     | chore(deps): update node.js to v24.21.0 (immich-28626)                     | deps           | LOW          | —                                                                                                                                                                                                                                                           |
| `aa8c5be42de`     | chore(mobile): name PR builds after PR number (immich-31541)               | CI             | LOW          | Fork's `gallery-build-mobile.yml` is separate.                                                                                                                                                                                                              |
| `acd91c26249`     | fix: honor memory filters on explore page (immich-31540)                   | server/web     | LOW          | Disjoint from the fork's memory-rules pipeline.                                                                                                                                                                                                             |
| `53395d0664a`     | fix: face label clipping again (immich-31402)                              | web            | LOW          | —                                                                                                                                                                                                                                                           |
| `ef9718e93d9`     | fix: feature face update ignores soft-deleted faces (immich-31533)         | server         | MEDIUM       | Face/person surface — fork's face-identity extensions checked for collision, none found.                                                                                                                                                                    |
| `49491d9a8b0`     | fix: put back search untagged button (immich-31476)                        | web            | LOW          | —                                                                                                                                                                                                                                                           |
| `c9eeedecc62`     | chore(mobile): shared DataController for data sources (immich-31457)       | mobile         | MEDIUM       | ~10 conflicts incl. mobile import churn, a modify/delete and a full-file rewrite. **`flutter test` caught two genuine replay regressions here that no static gate saw** — see "High-Risk Changes".                                                          |
| `db6a5b0d567`     | chore: reset `shouldChangePassword` on password change (immich-31276)      | server         | LOW          | 0 conflicts.                                                                                                                                                                                                                                                |
| `d2928cecce2`     | refactor: migrate to new changePassword endpoint (immich-31277)            | server         | MEDIUM       | 1 conflict — restored the fork's `passwordController.clear()`.                                                                                                                                                                                              |
| `a84de0188ee`     | fix: metadata extraction of faces (immich-31551)                           | server         | LOW          | 1 conflict, face-adjacent but disjoint from fork face-identity surface.                                                                                                                                                                                     |
| **`7b51c50a96c`** | **feat: people merge improvements (immich-31456)**                         | **server**     | **HIGH**     | The cluster-groups product-direction gate fires here — **pre-decided: pull, adopt inert.** ~12 conflicts. See "Section 4" analysis below and the confirmCrossOwner Critical.                                                                                |
| **`ca4637adc79`** | **refactor: reenable cloud ids (immich-30345)**                            | mobile         | MEDIUM       | The cycle's target commit, batch 18. 2 conflicts; `syncCloudIds` surviving at both restructured sites, verified by review.                                                                                                                                  |

**Product-direction gate: fired once**, at `7b51c50a96c` (people merge / cluster groups). This was
**pre-decided outside this cycle** — cluster groups as a product direction were already rejected
(`project_cluster_groups_30739_quarantine.md`, decided prior cycle) — so the gate's disposition was
"pull the commit, adopt its code, keep the fork's existing merge model authoritative" rather than a
fresh brainstorm. See Section 4 below.

### High-Risk Changes (detailed analysis)

**1. `2a626220415` — NestJS 12 + ESM (immich-31237).** Isolated alone in batch 03 (risk=high, n=1)
by design, so its blast radius was fully attributable. Converts the server and e2e packages to
`"type": "module"`, bumps NestJS 11→12, Vitest 3→4, Kysely 0.28.17→0.29.5, swaps `lodash` for
`lodash-es`, and adds `tsc-alias` to the build. This is the highest-severity change of the whole
cycle because it silently breaks the fork's own migration loader — the fork's
`CompositeMigrationProvider` (fork-only, upstream never touches it) inherited **none** of upstream's
three required adaptations, with **zero conflict, zero type error, lint green**. See Section 3 of
the design doc (`specs/2026-09-14-nestjs12-esm-migration-design.md`, corrected as part of this
task — see "Design doc correction" below) and Task 5/CI-fix-round below. Full-tree fork-content
preservation confirmed byte-identical across the batch (3414 files before/after, 0 lost, 0 gained;
626 upstream-touched files individually reconciled).

**2. `0f901eea5ec` — timeline scroll-to-top fallback (immich-31464).** Upstream split an `else`
branch the fork already guarded (#625, temporal-anchor) into `else if (scrollTarget) {…}` plus a
**new** unguarded `else { timelineManager.scrollTo(0) }`. The replayed fork commit re-applied its
guard only inside the surviving `if` arm, leaving the new arm's scroll-to-top fallback unguarded —
exactly what #625 exists to suppress. This shipped as a genuine Critical from Task 8's review
(`Timeline.spec.ts:411` red, 1/6393 web tests failing) and was fixed in fix round 1
(`07060152cc1`), proven red→green both by the original assertion and by an independent re-review
that reverted the guard and watched the test go red again.
**Generalisable lesson**: when upstream splits a branch the fork guards, check **every** resulting
arm — presence of the guarded symbol (`temporalAnchor` still had 8 references) says nothing about
whether the guard covers every branch upstream created.

**3. `6874c07dbe0` — mobile static Store refactor (immich-31099).** The most conflict-dense single
commit for mobile (13 files). All four fork mobile-people invariants (owner-scoped sync fallback,
`isFavorite` propagation, space-vs-personal edit gating, per-profile thumbnail routing) were
independently re-verified intact after replay, not merely re-asserted by the implementer.

**4. `c9eeedecc62` — mobile shared DataController (immich-31457).** `dart analyze --fatal-infos` was
clean throughout the whole cycle, but `flutter test` — only runnable once the machine's Xcode
license blocker was cleared mid-cycle (2026-09-15 morning) — caught two regressions invisible to
every other gate: `DataController` built API repositories with the wrong wrapper class (203 test
files failed to _compile_, not merely fail), and an unused ambiguous `Store` import in `main.dart`.
**Lesson, proven twice this cycle**: `dart analyze` does not compile the test tree; a mobile-touching
batch is not verified until `flutter test` has actually run.

**5. `7b51c50a96c` — people merge improvements / cluster groups (immich-31456).** See Section 4 below
and the confirmCrossOwner Critical (the single most important finding of this cycle).

## Conflict Resolutions

Full per-region resolutions are recorded in the SDD ledger
(`.superpowers/sdd/2026-09-14-nestjs12-esm-migration/progress.md`) and in `review-*.diff` packages
in the same directory; they are not reproduced verbatim here (they would run to hundreds of pages
across ~1498 commit-stops). The load-bearing resolution classes:

- **Import-block conflicts (the majority of the ESM batch's 626 files).** Resolved by a
  purpose-built resolver (`tools/upstream-preflight/src/import-merge.ts`, see "Pattern Propagation"
  and the fork-surface.md update below) that parses both sides, unions `(module, imported name)`
  bindings, and **refuses** — rather than guesses — any region it cannot safely merge. Final split:
  116 auto-resolved, 103 refused (hand-resolved), 0 wrongly resolved (traced and confirmed by an
  independent reviewer: 64/103 differ by line count — a genuine added/removed import, correctly
  refused — and 9/103 differ by more than the specifier alone).
- **The fork's own migration loader (`composite-migration-provider.ts`)** — see the design-doc
  correction below; not a conflict in the git sense (the file never conflicted), but a
  zero-conflict semantic break that needed the same investigative rigor.
- **The confirmCrossOwner Critical** (`server/src/controllers/person.controller.ts:319-325`) — the
  single most consequential resolution of this cycle. See its own subsection immediately below.
- **Shape K-style asymmetric regions** in the mobile Store refactor and the timeline changes,
  resolved with a whole-file fork-line-survival audit rather than trusting `ours`/`theirs` alone
  (`tools/*` fork-line-survival.py, purpose-built this cycle — see Pattern Propagation).

### The confirmCrossOwner Critical — a fork gate silently deleted by adopting upstream's body verbatim

`server/src/controllers/person.controller.ts:319-325`, replaying `7b51c50a96c`'s new body for the
legacy merge route, adopted upstream's controller body **verbatim**:

```ts
// what the replay produced (upstream's own form; upstream has no confirmCrossOwner):
return this.service.mergePeople(auth, { ids: [id, ...dto.ids] });
```

`origin/main`'s pre-cycle form passed the **whole DTO** through: `this.service.mergePerson(auth, id,
dto)`. Upstream's `MergePersonDto` has no `confirmCrossOwner` field, so building a fresh `{ ids:
[...] }` object silently dropped the fork's #733 cross-owner merge gate on this route.

**This is not a privilege escalation — it fails closed.** `merge-policy.ts:54` throws
`confirmationRequired` when the flag is falsy, so the _effect_ is inverted: a confirmed cross-owner
merge through `POST /people/{id}/merge` became **permanently impossible**. Both web entry points
retry with `confirmCrossOwner: true` on a 409, so the confirm dialog would loop forever. Proven live
by an existing assertion the replay itself broke:
`e2e/.../people-merge-space-collapse-block.e2e-spec.ts:244-250` posts with the flag set and asserts
a sub-300 status. The server **unit** suite passed throughout because it calls
`sut.mergePerson` directly and never exercises the route — only the e2e suite, and only the specific
route, saw it.

**Why every automated detector missed it.** The fork's own `fork-line-survival.py` (built this cycle
specifically to catch conflict resolutions that drop fork-added lines in files upstream also
touched) tracks fork-**added** lines. `return this.service.mergePerson(auth, id, dto);` was never a
fork addition — upstream wrote that line before immich-31456, and the fork's #733 gate merely
**depended** on it carrying the DTO through. A line the fork depends on but did not author is
invisible to an added-line detector; the real loss sat one layer up, in the controller, where
nothing was looking. **Generalisable for future cycles**: when upstream rewrites a call site the
fork relies on, the risk is not only "fork lines deleted" but "fork data no longer threaded through
an upstream line" — a class no line-diff detector can see.

**Fix** (`d630eae8d19`, Task 9 fix round 1): route `mergePersonLegacy` straight to
`this.service.mergePerson(auth, id, dto)`, which already threads the full DTO through
`crossOwnerMergeAuthorizer` — this also now matches `origin/main`'s body exactly, removing a fork
divergence rather than adding one. While on that line, `mergePeople`'s own per-owner grouping (a
Task 9 addition, not upstream's) had the identical problem one level up: a cross-owner target/source
pair became two independent single-person groups with no cross-reference and silently no-opped.
Both fixed together; independently re-reviewed and confirmed the DTO now reaches
`crossOwnerMergeAuthorizer` via the full object at both call sites.

## Fork Feature Verification

| Feature                                   | Status                               | Notes                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Spaces                             | OK                                   | All 39 fork-only tables (incl. `shared_space*`) present in all three registry locations (`.js` import, tables array, `DB` interface) — independently re-verified at Task 4's review, not just re-asserted.                  |
| Storage Migration / S3                    | OK                                   | No collision with any of this cycle's 32 commits.                                                                                                                                                                           |
| Pet Detection / Recognition               | OK                                   | Untouched by this cycle; `asset_duplicate_checksum` and `shared_space_library` tables confirmed present in both registry halves.                                                                                            |
| Image Editing / Video Trimming            | OK                                   | The `CropAspectRatio` enhanced-enum conversion (immich-31119) resolved with all 12 fork consumption sites intact, `dart analyze --fatal-infos` clean.                                                                       |
| Branding                                  | OK                                   | One new gap (`mobile/android/app/build.gradle` `resValue "app_name"`, immich-31456-adjacent chore) found by CI, fixed in the CI-fix round (`a0d6b23afaf`) with sed rules added to `apply-branding.sh`. See CI Verification. |
| Google Photos Import                      | OK                                   | Untouched.                                                                                                                                                                                                                  |
| Global Face Identity / Face Statistics    | OK                                   | No collision with `ef9718e93d9` (soft-deleted faces) or `a84de0188ee` (metadata extraction of faces).                                                                                                                       |
| Face Review & Cleanup Console             | OK                                   | Untouched.                                                                                                                                                                                                                  |
| Global Search / Command Palette           | OK                                   | Untouched.                                                                                                                                                                                                                  |
| Fork Memories                             | OK                                   | `acd91c26249` (explore-page memory filters) is disjoint from the fork's rule-pipeline/config-driven memory types.                                                                                                           |
| Mobile Shared-Space Faces & People (#727) | OK                                   | All 4 invariants re-verified after the static-Store refactor (immich-31099) — see High-Risk Changes.                                                                                                                        |
| Mobile filter-parity / people picker      | OK                                   | Untouched by this cycle's commits.                                                                                                                                                                                          |
| Timeline Grouping Display Modes           | OK                                   | The scroll-to-top fallback fix (see High-Risk Changes) is inside this surface's shared file; fixed and re-proven non-vacuous.                                                                                               |
| Cross-owner people merge (#733/#736)      | **FIXED (was broken by the replay)** | See the confirmCrossOwner Critical above. Restored in `d630eae8d19`, independently re-verified.                                                                                                                             |
| Cluster groups product decision           | **REAFFIRMED, inert**                | `ClusterGroupController` remains unmounted; the 1:1 `person`↔`personGroupId` index is untouched. See Section 4 below and the `people-merge-inert` CI invariant.                                                             |
| Immich→Gallery migration compatibility    | OK                                   | See "Database Migration Analysis" — the medium-test failure that first looked like a regression on this path was proven to be test-only (see "Inconsistencies Found").                                                      |

## CI and Infrastructure Verification

| Check                                                 | Status | Notes                                                                                                                                                                                                           |
| ----------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow files (no upstream collisions)               | OK     | No fork-only workflow deleted or overwritten by this batch range.                                                                                                                                               |
| Docker image references (`gallery-*`, not `immich-*`) | OK     | Confirmed for the pushed RC (`gallery-server:esm-rebase-v3.2.1-rc1`); the _default_ `gallery_image` input on `gallery-revert-to-immich-validation.yml` is `immich-server:main` — see finding below, not a leak. |
| Branding (no "Immich" leaks in CI/config)             | FIXED  | `mobile/android/app/build.gradle` gained two `resValue "string", "app_name", "Immich"` lines upstream-side; not allowlisted, sed rules added to `apply-branding.sh` (`a0d6b23afaf`).                            |
| Fork CI modifications intact                          | OK     | No workflow in `references/fork-surface.md`'s CI table was touched by this batch range.                                                                                                                         |
| New upstream workflows reviewed                       | OK     | None added in this range.                                                                                                                                                                                       |
| Action/tool versions compatible                       | OK     | `eslint-plugin-import-x` (immich-31537) installs and runs; `unrs-resolver: false` merged into `pnpm-workspace.yaml` alongside the fork's two existing keys.                                                     |

### The gate-validates-a-pulled-image finding

**`Gallery Revert-to-Immich Validation` passed on the first dispatch while booting a stale image that
was not this branch's code.** The workflow's coverage-grep half (does `revert-to-immich.sql` mention
every migration on disk) ran against the checked-out branch and passed correctly; its Docker-boot
half pulls an image named by the `gallery_image` **input**, whose default is
`ghcr.io/open-noodle/immich-server:main` — a name that does not even match the fork's real image
family (`gallery-server`). Confirmed from the job log of the first dispatch (run `34947937252`):

```
GALLERY_IMAGE: ghcr.io/open-noodle/immich-server:main
```

No image built from this branch existed at that point — the RC build in Task 13 Step 6 was the
first. So that green proved the coverage grep passes and that revert-to-immich still works against
whatever `:main` happens to be; it did **not** prove revert-to-immich works against this cycle's
NestJS 12 / Kysely 0.29 / ESM-migrated schema. Closed properly (not just documented as a limitation)
by re-dispatching with the real RC image:

```
GALLERY_IMAGE: ghcr.io/open-noodle/gallery-server:esm-rebase-v3.2.1-rc1
```

Run `34952047186` then genuinely passed — `##[notice]revert-to-immich validation PASSED` — booting
this cycle's actual build.

**Generalisable lesson: a gate whose subject is a pulled image validates whatever that tag currently
holds, not your branch — no matter which ref you dispatched the workflow on.** The dispatch ref only
controls which copy of the _workflow YAML_ runs; any `-f <image>=` input with a default pointing at
a floating tag needs that input set explicitly to the branch's own build before its green is
evidence about the branch. Both runs' `GALLERY_IMAGE` lines above are the proof, not the badge.

### Full CI suite — 10/10 green, job-by-job

Verified **job-by-job**, not by run conclusion — the brief's own caution ("a skipped job is
indistinguishable from a passing one in the summary") proved necessary in practice, since two jobs
genuinely are skipped by design:

| Workflow                                  | Jobs   | Status                                                                                        |
| ----------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `docker.yml`                              | 25     | 23 success, **2 skipped** (`Re-Tag Server`/`Re-Tag ML`, correctly gated to main/release refs) |
| `test.yml`                                | 22     | 22 success, 0 skipped                                                                         |
| `gallery-build-mobile.yml`                | 2      | 2 success                                                                                     |
| `static_analysis.yml`                     | 2      | 2 success                                                                                     |
| `gallery-ml-smoke.yml`                    | 1      | 1 success                                                                                     |
| `gallery-mobile-smoke.yml`                | 1      | 1 success                                                                                     |
| `gallery-rebase-smoke.yml`                | 1      | 1 success                                                                                     |
| `gallery-revert-to-immich-validation.yml` | 1      | 1 success (re-dispatched against the real RC — see above)                                     |
| `storage-migration-e2e.yml`               | 1      | 1 success (`branch` input verified honoured from the job log, not assumed)                    |
| `storage-migration-tests.yml`             | 1      | 1 success                                                                                     |
| **Total**                                 | **57** | **55 success, 2 skipped (correctly gated), 0 failed**                                         |

`test.yml`'s 22 green jobs include the ones that actually exercise this cycle's payload: `Medium
Tests (Server)` (the only place Kysely 0.29 meets a real database), `Unit Test Mobile` (the only gate
that actually **compiles** the Dart test tree, as opposed to `dart analyze`), `SQL Schema Checks`,
`OpenAPI Clients`, both `End-to-End Tests` matrices (`ubuntu-latest` and `ubuntu-24.04-arm`), `Test
Web`, `Lint Web`, `Test Branding`, `Test i18n`, and `Upstream Rebase Tooling` (the vitest suite for
`tools/upstream-preflight` itself, 293/293).

`migration-order.yml` is not in this dispatched set (it only fires on `main`/PR); its consistency
half is duplicated into `test.yml`'s `SQL Schema Checks`, which is covered above.

## Database Migration Analysis

### New Upstream Migrations

None. `git diff <branch-base>..HEAD -- server/src/schema/migrations/` shows 5 files modified (all
mechanical `.js`-suffix import rewrites from the ESM codemod, zero SQL/schema content changed), 0
added. This cycle's upstream range (`86ae0dd06c7..ca4637adc79`) contains no new upstream migration.

### Timestamp Ordering

- Gallery migration interleaving: OK — `allowUnorderedMigrations: true` unaffected.
- Timestamp collisions: NONE. `server/src/schema/migrations-gallery/` still holds 67 migration files
  (68 entries including the `ORDER` manifest); the count is unchanged from the pre-cycle fork
  surface, and `tools/upstream-preflight/src/migration-timestamps.spec.ts`'s three grandfathered
  same-timestamp pairs did not gain a fourth.

### Table Conflict Check

- Tables shared with gallery migrations: NONE new this cycle.
- Column/constraint conflicts: NONE.

### Schema File Changes

- Fork-extended schema tables modified by upstream: NONE this cycle. `server/src/schema/index.ts`'s
  registry (both the array and the `DB` interface halves) verified to still carry all 39 fork-only
  tables after the ESM batch's 626-file replay.

### Postbuild Merge

- `postbuild` script intact: YES. `server/bin/sync-gallery-migrations.mjs` still runs after `nest
build && tsc-alias`; verified the copy step reaches `dist/schema/migrations/` (`.js`-suffix imports
  survive `tsc-alias`'s rewrite — `grep "from 'src/" dist/schema/migrations/*.js` empty).
- Filename collisions: NONE.
- `CompositeMigrationProvider` intact: YES, but **only after Task 5's fix** — see "Design doc
  correction" and "Inconsistencies Found" below. Pre-fix, the provider silently could not load
  migrations at boot (zero conflict, zero type error, lint green). Post-fix: `dist/schema/migrations/`
  holds 165 `.js` files (96 upstream + 67 gallery + 2 compatibility-alias copies), all 165 apply
  cleanly against a fresh database, and both alias pairs (`ChangeDurationToInteger`,
  `ClearPreOptionMFaceRepairScans`) proven idempotent under ESM — a fresh install executes both the
  original and its alias copy under different recorded names, and the run still succeeds end to end.

## Mobile Drift Migration Analysis

### New Upstream Mobile Migrations

None in this range — the ESM/toolchain payload does not touch the mobile Drift schema.

### Fork-Owned Mobile Migrations

No renumbering needed; `schemaVersion` unchanged by this cycle.

### Collision Check

- Duplicate `drift_schema_vN.json` files: NONE.
- Gaps in migration chain: NONE.
- `schemaVersion` matches highest snapshot: YES.
- `fromXToY` callback chain contiguous: YES.

### Release Safety

- Any fork build with pre-rebase schemaVersion shipped to users? N/A — no mobile schema change this
  cycle.

## Inconsistencies Found

1. **The fork's migration loader inherited none of Kysely 0.29's required adaptations, silently.**
   Already covered above and in the design-doc correction; recorded here because it is the textbook
   example of the skill's zero-conflict semantic-break gate — the damage sat in a fork-only file
   upstream never touches, invisible to every audit until `pnpm test:medium` (or, eventually, boot)
   exercised it.

2. **A medium-test-only failure was initially mischaracterized as a product regression on the
   Immich→Gallery migration path.** CI's first push showed `database-migration.service.spec.ts >
"should apply fork migrations on top of an upstream-only database"` failing with `Cannot find
package 'src'`. This was first described (by the coordinator, to the user) as _"an ESM regression
   on the immich-to-gallery migration path, a shipped feature — the upgrade route for users switching
   from Immich"_. **That description was wrong**, and was corrected once checked: the real product
   path, `server/src/schema/composite-migration-provider.ts` used by
   `DatabaseRepository.createMigrator()`, was unchanged across the whole range
   (`git diff` on it empty at the time). The bug lived solely in the medium spec's own hand-built
   `FileMigrationProvider`, which _simulates_ the upgrade path and lacked the `import:` hook the
   product code already had. Fixed at the test layer (`11fae9f8006`), not the product layer.
   **Lesson**: a test that simulates a product path can break in ways the product path cannot; before
   calling a test failure a product regression, check whether the product code shares the failing
   construct.

3. **The Vitest-4 arrow-constructor break, and a misclassification that preceded it.** Four separate
   specs across this cycle used `vi.fn(() => ({...}))` / `mockImplementation(() => ...)` as a mocked
   _constructor_ (`memory.service.spec.ts`, `s3-storage.backend.spec.ts`, and two more). Vitest 4
   invokes a `new`-ed mock implementation via `Reflect.construct`, and an arrow function has no
   `[[Construct]]` slot — Vitest 3 tolerated this, Vitest 4 does not. `s3-storage.backend.spec.ts`
   (30 tests) was the most consequential instance: **it had been classified "pre-existing on
   `main`" by three separate parties in sequence** (the Task 6 implementer, the Task 8 implementer,
   and the Task 8 re-reviewer), all of whom verified "pre-existing" by reproducing the failure at an
   earlier commit **within this cycle** — but every commit they compared against already had Vitest
   4, because it arrived with the ESM batch at the very start of the cycle. The classification was
   overturned only when checked against `origin/main` itself (which does not have Vitest 4 and does
   not fail). Fixed by converting all seven `new`-ed mocks (`S3Client`, `Upload`, six `client-s3`
   Command classes) from arrow functions to function expressions; proven non-vacuous by reverting one
   and watching all 30 tests fail with the exact `is not a constructor` message, then restoring.
   **General lesson: "reproduces at an earlier commit" only proves pre-existence if that commit
   predates the change you suspect — name the baseline explicitly, and prefer `origin/main` over any
   commit inside the branch under test.**

4. **"Ran it twice and got the same answer" is an idempotency proof, not a prove-red.** Task 11's
   report cited running the SQL-query regeneration "once pre-build, once after a fresh `pnpm build`"
   as proof the generator was capable of detecting drift (i.e., could go red if something had
   changed). Independent review found this reasoning unsound — re-running the _same_ command twice
   proves the generator is deterministic, not that it is sensitive to a real change. The zero-diff
   result itself was still correct, but for an unrelated reason: this cycle touches zero files under
   `server/src/repositories/`, so no query content changed and zero diff was the only possible
   correct answer regardless of the generator's health. Downgraded from a would-be Critical to a
   report-rigor note. **Lesson for future report-writing: distinguish a determinism check from a
   capability check; only the latter tells you the gate actually works.**

5. **A zsh pathspec trap produced a false-zero scan during tooling development.** While building the
   reachability sweep for `branding/scripts/*.sh` (documented in the skill, `references/fork-surface.md`
   family), an early draft used `for c in $reach` with an unquoted shell variable holding a
   newline-separated list. Because **zsh does not word-split unquoted variables** (unlike bash), the
   loop ran once over the entire blob rather than once per line, every per-line lookup silently
   missed, and the script reported the naive (wrong) answer as if it were correct — a script that
   "ran clean" while testing nothing. Fixed with `printf '%s\n' "$reach" | while IFS= read -r c;
do …`. This is a standing zsh/bash divergence worth carrying into any future shell tooling written
   on this machine, not specific to this migration.

## Section 4 — People merge / cluster groups: pull, adopt inert

Immich-31456 (`7b51c50a96c`) reworks upstream's own people-merge flow toward a cluster-group model.
Cluster groups as a fork product direction were already decided **against** in a prior cycle
(`project_cluster_groups_30739_quarantine.md`) — the fork keeps its own 1:1 `person` ↔
`personGroupId` merge model and does not adopt upstream's grouping semantics. This cycle's job was
narrower: pull the commit (it cannot be skipped without diverging permanently from upstream's
`person.service.ts`), and keep the fork's existing behaviour **authoritative** — "adopt inert."

Verified intact after the replay: `ClusterGroupController` remains unmounted
(`controllers/index.ts:18,74`); the 1:1 index at `person.table.ts:54` is untouched;
`crossOwnerMergeAuthorizer` and `identityMergePropagationService` are both intact. Upstream's own
`getForMergePerson` repository method (which the fork's pre-cycle `mergePeople` used to call in a
per-owner loop) is now dead from the fork's perspective — Task 9's replay resolved `mergePeople`
toward `ids[0]`-as-target delegation into the fork's own `mergePerson`, which is the behaviour the
fork actually wants. `getForMergePerson` itself was deliberately **not deleted**: it is genuine
upstream surface (defined and called by upstream's own code at
`person.service.ts:597`), and deleting it would (a) create a permanent fork divergence in a file
upstream edits, re-conflicting on every future rebase, for zero benefit, and (b) remove the evidence
the pinning test below depends on.

**Pinned with a CI invariant, proven red→green.** `person.service.spec.ts` gained a
`describe('mergePeople')` block asserting `mocks.person.getForMergePerson` is **never** called (the
fork's `mergePeople` never takes the per-owner-loop path), and `docs/fork/ownership.yml` gained a
`people-merge-inert` `ci_invariant` forbidding the literal `'  ClusterGroupController,'` in
`server/src/controllers/index.ts`. Both proven non-vacuous: the pinning test goes red if `mergePeople`
is reverted to a `getForMergePerson`-based loop; the CI invariant goes red if the controller import is
un-commented.

## Pattern Propagation

| Refactor                                              | Old → New Pattern                                                                                                                           | Fork Files Affected                                                                                                                                                                                                                                                                                                                                                        | Decision           | Commit / Follow-up                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NestJS 11→12 + ESM** (immich-31237)                 | CJS (`__dirname`, `require`, `module.exports`) → ESM (`import.meta.dirname`, `import`, `.js` specifiers)                                    | **293 fork-only server files + 102 fork-only e2e files** codemodded; `composite-migration-provider.ts` hand-fixed (3 changes, see design-doc correction); `utils/config.ts`'s lodash namespace usage fixed; two unsuffixed specifiers in upstream-owned files (`album.service.ts`, `sync.repository.ts`) fixed by a tree-wide by-specifier sweep rather than a by-file one | **Bundled**        | `d4f239f230d`, `b17b5b66c21`, `d9562e73265`, `67bf7b5038d`                                                                                                                                                                                |
| Vitest 3→4 mock-construction semantics                | `mockImplementation(() => ({...}))` (arrow) → function expression, when `new`-ed                                                            | `memory.service.spec.ts`, `s3-storage.backend.spec.ts` (7 mocks), `composite-migration-provider.spec.ts`                                                                                                                                                                                                                                                                   | Bundled            | `342669e213c`; **deferred**: ~16 remaining spec files still use arrow-style mocks that are only ever _called_, never `new`-ed — currently safe, but a future `new`-ed one would reintroduce this silently. No lint rule added this cycle. |
| `import-x/order` lint rule (immich-31537)             | unordered/ungrouped imports → enforced grouping                                                                                             | 18 files autofixed, 3 manual reorders                                                                                                                                                                                                                                                                                                                                      | Bundled            | Task 8                                                                                                                                                                                                                                    |
| Timeline branch split (immich-31464)                  | single `else` → `else if (scrollTarget)` / `else`                                                                                           | `Timeline.svelte` fork guard (#625)                                                                                                                                                                                                                                                                                                                                        | Bundled            | `07060152cc1` — see High-Risk Changes                                                                                                                                                                                                     |
| Mobile static Store (immich-31099)                    | instance-scoped stores → static `Store`                                                                                                     | 13 fork mobile people-surface files                                                                                                                                                                                                                                                                                                                                        | Bundled            | Task 8 batch 08 replay                                                                                                                                                                                                                    |
| People-merge / cluster groups (immich-31456)          | per-owner `getForMergePerson` loop → single-target cluster-group merge                                                                      | `person.service.ts`, `person.controller.ts`                                                                                                                                                                                                                                                                                                                                | **Bundled, inert** | See Section 4; `bba67e6f1b8` (pinning test), `d630eae8d19` (confirmCrossOwner fix)                                                                                                                                                        |
| `mergePersonLegacy` SDK naming (fallout of the above) | one shared `mergePerson` operation → `mergePeople` (`/people/merge`) + restored `mergePerson` (`/people/{id}/merge`) as `mergePersonLegacy` | `packages/sdk/src/fetch-client.ts`, 4 callers (2 web, `face-cleanup.e2e-spec.ts`, `pet-detection.e2e-spec.ts`)                                                                                                                                                                                                                                                             | Bundled            | Task 9 fix round 1 + Task 11 regeneration; confirmed the naming **survives** regeneration because it derives from the controller method's literal name, not a hand patch                                                                  |

### Follow-up work

- **No web/mobile/ML propagation of the ESM conversion.** This cycle's ESM work is scoped to
  `server/` and `e2e/`; `web/`, `mobile/` and `machine-learning/` are untouched by it and remain on
  their existing module systems. Not a gap in this cycle — out of scope by design — but worth naming
  so a future reader does not assume the whole monorepo moved to ESM.
- **No client migration to `POST /people/merge`.** The fork's web/mobile clients continue to call the
  legacy `POST /people/{id}/merge` route (`mergePersonLegacy`); nothing in this cycle migrates them to
  upstream's new bulk `mergePeople` operation. `mergePersonLegacy` is intended as a durable fork-side
  route, not a shim pending removal — but if that changes, the four call sites above are the ones to
  touch.
- **~16 arrow-style Vitest mocks remain unguarded** against the Vitest-4 `new`-ed-arrow break (see the
  Pattern Propagation row above). No action taken this cycle beyond the 7 actually broken; a lint rule
  or a repo-wide sweep is a candidate for a future cycle, not urgent since the failure mode is
  compile/test-visible whenever it does fire.
- **Stale JSDoc above `mergePeople`** (`person.service.ts:1500-1514`) still describes the pre-Task-9
  per-owner-grouping behaviour. Doc-only, deferred to the next touch of that file (recorded in the
  ledger as a Task 9 minor).

## Code Review Findings

Every task in this cycle went through at least one independent review round before being marked
complete (11 of 14 tasks clean on first review pass; Tasks 3, 5, 8 and 9 each needed 1–2 fix rounds).
The findings worth carrying forward beyond what is already covered above:

- Task 3's resolver initially had a real safety-property gap: `parseStatement` misparsed two import
  statements squished onto one physical line, returning a syntactically-plausible-looking but
  garbage binding rather than refusing. Fixed with strict named-specifier validation and a rejection
  of any region body containing `;`; proven with 3 red / 7 green cases, each red case proven to
  actually fail without its guard. Did not occur in the real corpus (Prettier never emits two
  imports on one line) but the resolver runs unattended over generated files too, so it had to be
  ruled out categorically rather than empirically.
- Task 6 found and fixed a bug in the Task 3 tooling itself (`normalizeModule` mis-suffixing
  directory imports as `<dir>.js` instead of `<dir>/index.js`) at the source rather than only in the
  files it had already corrupted, specifically because Tasks 8 and 9 (batches 04–18) would otherwise
  have replayed the same bug unattended overnight.
- Task 12's flake classification (`oauth.controller.spec.ts`, `Test timed out in 5000ms`) was
  reviewed and found to over-claim a match to a previously-observed pattern. See "Systemic supertest
  flake" note in the memory section below — not restated here to avoid two slightly different
  phrasings of the same finding drifting apart.

## Local CI Verification

| Check                                                                | Status | Notes                                                                                                                                                                                         |
| -------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync)                     | PASS   | 165 `.js` migrations in `dist/schema/migrations/`, 0 `from 'src/` leaks post-`tsc-alias`.                                                                                                     |
| `server pnpm check` (tsc)                                            | PASS   | 0 errors (down from 2156 error lines mid-cycle, before Task 6's tree-wide codemod).                                                                                                           |
| `web check:typescript`                                               | PASS   | 0 errors.                                                                                                                                                                                     |
| `web check:svelte`                                                   | PASS   | 640 files scanned (verified against `find web/src -name '*.svelte'` — not the local svelte-check no-op trap).                                                                                 |
| `server pnpm lint`                                                   | PASS   | 0 (2 `import-x/order` + 1 pre-existing `no-misused-promises` fixed in Task 8 fix round 1).                                                                                                    |
| web eslint (`tscompat` off)                                          | PASS   | 13 warnings ("unused eslint-disable directive"), 0 errors — expected side effect of the required local override; superseded by CI's `Lint Web` running the same lint with `tscompat` enabled. |
| Server unit tests                                                    | PASS   | 201 files, 6431 passed on the clean re-run (first run hit the systemic supertest flake — see below).                                                                                          |
| Web unit tests                                                       | PASS   | 391 files, 6396 passed.                                                                                                                                                                       |
| Medium tests (server, real DB)                                       | PASS   | 181/181 files, 3218 passed — the only local gate that exercises Kysely 0.29 against a real database.                                                                                          |
| Mobile (`dart analyze --fatal-infos`, `dart format`, `flutter test`) | PASS   | "No issues found!"; 939 files 0 changed; 3853 test cases passed, 1 skipped, 0 failed.                                                                                                         |
| OpenAPI regeneration                                                 | PASS   | `jq -S` byte-identical before/after (178-line diff was pure key reordering); all 10 fork endpoint descriptions present; `mergePersonLegacy` unique, 4 callers intact.                         |
| `make commit-autolink-check`                                         | PASS   | 1518 commit messages scanned, fork PR ceiling 1106, no cross-repo autolink.                                                                                                                   |
| Lockfile invariant (`version: file:` count)                          | PASS   | 0, throughout.                                                                                                                                                                                |

**Environment note**: for most of this cycle, an unrelated machine-level blocker (`sudo xcodebuild
-license` not yet accepted) made `make` fail outright and `flutter test` / `dart analyze` impossible
to run at all (the native-asset build hook for `package:objective_c` calls `xcrun --show-sdk-path`,
which itself exited 69). Worked around via the `pnpm --filter @gallery/upstream-preflight run
<target>` direct-CLI form for `make`'s targets, and via CI's `Unit Test Mobile` job for mobile unit
tests during that window. Pierre accepted the license morning of 2026-09-15, after which both `make`
and `flutter test` ran locally for the remainder of the cycle (and immediately caught the two
`c9eeedecc62` regressions above).

### The systemic supertest flake

The server unit suite intermittently fails one controller spec under full-suite concurrency —
observed 25+ times this cycle across `activity`, `album`, `shared-space` and `asset-media` controller
specs (bare `ECONNRESET` or an assertion miss), all green alone or in small groups, unaffected by
shuffle / single-worker / CPU-load. Not order-dependent, not introduced by this cycle. Task 12's local
run hit a **different** file and symptom — `oauth.controller.spec.ts`, `Test timed out in 5000ms` —
established as a flake by one re-run (identical code, identical command, fail then pass). The triage
decision (flake, not a regression, nothing owed by this task) is correct regardless, but **this new
instance is not proven to be the same underlying defect** as the catalogued four-spec family — see
the memory note below; it is recorded as suspected, not folded into the existing signature.

## Remote CI Verification

- **Test branch**: `rebase/upstream-rolling-v3.2.1`
- **Commit validated**: `3e4540f9109` (final; two earlier commits on this branch, `aded70ed945` and
  `a0d6b23afaf`, were also dispatched and are superseded by this one)

| Workflow                                  | Status  | Run           | Notes                                                                                                                                                                 |
| ----------------------------------------- | ------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test.yml`                                | GREEN   | `34947922238` | 22/22 jobs, job-by-job verified                                                                                                                                       |
| `docker.yml`                              | GREEN   | —             | 23/25 success, 2 correctly-gated skips (`Re-Tag Server`/`Re-Tag ML`)                                                                                                  |
| `static_analysis.yml`                     | GREEN   | —             | 2/2                                                                                                                                                                   |
| `gallery-build-mobile.yml`                | GREEN   | —             | 2/2; needs `-f environment=development` — its jobs are `if:`-gated false on `pull_request`, so this dispatch is the only thing that validates the mobile build at all |
| `gallery-rebase-smoke.yml`                | GREEN   | —             | 1/1                                                                                                                                                                   |
| `gallery-mobile-smoke.yml`                | GREEN   | —             | 1/1                                                                                                                                                                   |
| `gallery-ml-smoke.yml`                    | GREEN   | —             | 1/1 — untouched ML pin, no rebuild needed (only `pyproject.toml`/`uv.lock` changed this cycle)                                                                        |
| `gallery-revert-to-immich-validation.yml` | GREEN   | `34952047186` | Re-dispatched with `-f gallery_image=gallery-server:esm-rebase-v3.2.1-rc1` — see finding above                                                                        |
| `storage-migration-e2e.yml`               | GREEN   | `34948533902` | `branch` input verified honoured from the job's own checkout log, not assumed from headSha                                                                            |
| `storage-migration-tests.yml`             | GREEN   | —             | 1/1                                                                                                                                                                   |
| PR-only (codeql/zizmor/docs-build/cli)    | SKIPPED | —             | Not required for this rolling-branch dispatch; unchanged by this cycle's payload                                                                                      |

- **Failures fixed**: OpenAPI Clients (Task 11 regeneration), End-to-End Lint (prettier formatting,
  Task 11), the two people-merge e2e specs (confirmCrossOwner fix), the medium-test-only ESM
  migration-loader simulation break, the Vitest-4 `JobRepository.empty` auto-mock strictness (3
  further real issues surfaced and fixed alongside it), the `require()`-based tailwindcss-preset-email
  import (`ReferenceError: require is not defined` under `"type": "module"`), and the
  `build.gradle` branding gap. All four of the last group were fixed at root cause in one dispatched
  CI-fix round (`11fae9f8006`, `ed396a2fc8f`, `8c0b41d607b`, `a0d6b23afaf`).
- **Confirmed flakes**: `s3-storage.backend.spec.ts` was investigated as a possible flake and turned
  out to be a real Vitest-4 regression (see Inconsistencies #3), not a flake. The genuine flakes are
  the systemic supertest family above (25+ occurrences, unrelated to this cycle) and one isolated
  `asset.service.spec.ts` failure in a full `pnpm test:medium` run that passed clean on isolated
  rerun.

## Post-Rebase Verification

- Fork commits ahead of upstream: ~1550 (from the branch base `07390535860` to `HEAD`)
- Commits behind upstream: 0 (`ca4637adc79` is an ancestor of `HEAD`)
- Fork diff looks clean: YES — fork-content preservation confirmed byte-identical across the ESM
  batch (3414 files before/after, 0 lost, 0 gained), with the two genuine semantic breaks
  (`composite-migration-provider.ts`, the confirmCrossOwner controller line) both caught by the
  investigative process rather than by a mechanical diff, fixed, and independently re-verified.
- Staging deployment: `esm-rebase-v3.2.1-rc1` deployed to `staging` (infra-gitops `b9965ed`), both
  Api and Microservices workers logging `Finished running migrations` → `No schema drift detected`,
  booting v5.7.0-rc.0. Pre-deploy migration parity: 165 on disk == 165 recorded in the live
  `kysely_migrations` table, 0 orphans, 0 pending. Smoke-tested with real counts (not bare status
  codes): albums 200 (4), shared-spaces 200 (2), timeline 200 (54 buckets / 6462 assets), people
  200 (376), search suggestions 200 (93) — three of these cross-checked against direct DB queries as
  an independent match.

## Design doc correction

`specs/2026-09-14-nestjs12-esm-migration-design.md` Section 3 said upstream's ESM commit changed the
migration loader "twice" (the `import:` hook, and `import.meta.dirname`) and that the fork must apply
"both fixes" by hand. **Corrected as part of this task**: added a third required change the doc never
mentioned — Kysely 0.29 moved `FileMigrationProvider`, `Migration` and `MigrationProvider` off the
`kysely` package root onto a `kysely/migration` subpath (the shipped code,
`server/src/schema/composite-migration-provider.ts:1`, now imports from `'kysely/migration'`). The
doc's prose, its "both fixes" phrasing and its "neither fix can be staged ahead of batch B" reasoning
were all updated to cover three fixes instead of two, with the subpath move's own diff and reasoning
added.

**Left alone, deliberately**: the doc's severity claim — that the missing `import:` hook is
specifically the _boot-breaking_ fix, invisible to every compile-time gate — was **not** rewritten.
Checked against the ledger first, as instructed: Task 5's review found that removing only the
`import:` hook still leaves the suite passing (Node's dynamic `import()` accepts absolute POSIX
paths without the hook, so the hook is not vestigial but also not load-bearing for the product's own
dist-path boot sequence on this platform), while the `kysely/migration` subpath omission is
compile-visible (the package types the un-migrated symbols as a `KyselyTypeError` stub). Since a
compile-time break is a different class of gate failure than a boot-time one, the doc's original
framing is plausibly still correct — it may just describe a narrower window than its prose implies.
This was **not** independently confirmed with a direct before/after `tsc` run isolating only the
subpath-omission line, so I added an addendum to Section 3 stating the correction made, what was
verified, and what remains unconfirmed, rather than asserting a rewritten severity claim on
inference. See the addendum at the end of Section 3 for the exact wording.

## Skill upkeep

- **`references/fork-surface.md`**: added a new Infrastructure row for the two preflight modules
  built this cycle, `tools/upstream-preflight/src/import-merge.ts` (diff3 import-conflict resolver)
  and `import-codemod.ts` (bulk ESM specifier codemod), noting both are general-purpose rebase
  tooling worth keeping past this specific migration.
- **Skill Sync Anchor**: **left unchanged** at `fe6999abdbf`. The anchor-bump procedure requires the
  _replayed, on-`main`_ copy of a fork feature commit (`git merge-base --is-ancestor <new-anchor>
main` must hold) — but this cycle deliberately does not land on `main`, so every commit on
  `rebase/upstream-rolling-v3.2.1`, including its final HEAD `3e4540f9109`, is **not** an ancestor of
  `main` (verified: `git merge-base --is-ancestor 3e4540f9109 origin/main` → false). Bumping to a
  rolling-only commit would leave a dangling/orphan anchor the next cycle's scan cannot use. The
  existing anchor is still valid (`fe6999abdbf` remains an ancestor of `origin/main`, currently at
  `07390535860`), so it stays until a future cutover cycle lands new fork feature work on `main`.

## One-line correction (Task 13 report)

`.superpowers/sdd/2026-09-14-nestjs12-esm-migration/task-13-report.md` named the RC image
`ghcr.io/open-noodle/immich-server:esm-rebase-v3.2.1-rc1` in three places (Step 6's result and both
"Concerns" bullets). Corrected to `ghcr.io/open-noodle/gallery-server:esm-rebase-v3.2.1-rc1` — that
is the fork's real image family; `immich-server:main` is only ever the _default_ input value on the
revert-to-immich workflow, a separate and unrelated name that happened to appear in the same cycle's
logs.

## Version note

This cycle's branch is named for Immich v3.2.1 and absorbs upstream through `ca4637adc79`, but
**`branding/config.json`'s `upstream.version` field is intentionally left at `3.2.0`** and `README.md`
/ the marketing site version strings are untouched. Per the skill's standing rule, those load-bearing
version references are updated only at a cutover that actually lands on `main` against a real tagged
release — this cycle stays on the rolling branch, so bumping them here would advertise a version the
public-facing `main` branch has not reached.

## Out of scope (explicitly, not oversights)

- No web, mobile, or machine-learning propagation of the ESM module-system change — scoped to
  `server/` and `e2e/` by the design doc from the outset.
- No client migration off `POST /people/{id}/merge` (`mergePersonLegacy`) onto upstream's new bulk
  `POST /people/merge` (`mergePeople`) operation.
- **Landing on `main` was out of scope for this cycle entirely.** Per the skill's standing rule,
  landing requires both an upstream-tagged release and thorough real-data validation of that exact
  tagged state; this cycle satisfies neither condition by design (it targets `upstream/main` at
  `ca4637adc79`, not a tag, and the branch stays on `rebase/upstream-rolling-v3.2.1`). The steady
  state at the end of this cycle — green, level with `upstream/main`, fork-synced, staging-validated
  — is the expected outcome, not a pending decision.
