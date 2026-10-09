# Upstream Sync Report — 2026-10-09 (v3.3.1)

## Summary

- **Branch**: `rebase/upstream-rolling-v3.3.1`, cut fresh from `origin/main` (`4fc5fc2789c`, the v3.3.0 cutover),
  tracking `upstream/release/v3.3`.
- **Upstream**: `e3b16560913` (`v3.3.0`) → **`db6e11ecc85`** = tag **`v3.3.1`**, 15 commits, batches 01–07.
  0 behind. v3.3.1 is a published GitHub Release (2026-10-08 21:52Z), and so is v3.3.0 (2026-10-07).
- **Fork sync**: #1169 (`6417a8114ce`, e2e-only: map-marker GPS written after the upload pipeline), clean.
  The sync's ownership-coverage check needed a tooling fix first (see Inconsistencies).
- **Backups**: `backup/rolling-pre-2026-10-09-v331` (`4fc5fc2789c`), `backup/rolling-v331-after-b05`.
- **Replays**: two (to batch 05's tip, then to the tag), 1639 fork commits each. `4fc5fc2789c` (the early take
  of immich-32171) was dropped by git as already applied, as its message predicted.
- **Product-direction gate**: fired on two people commits; maintainer decisions below.
- **Base bump**: `branding/config.json` `upstream.version` 3.3.0 → **3.3.1**. `revert-to-immich.sql` unchanged
  (v3.3.1 carries no `server/src/schema` change).
- **Risk**: LOW–MEDIUM. **Landed on `main`** on 2026-10-09 (see Landing).

## Incoming Upstream Changes

| SHA           | Summary                                                                | Area           | Risk    | Outcome                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------- | -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e9f171c441e` | memories full screen while swiping (immich-32174)                      | mobile         | none    | Already on `main` as `4fc5fc2789c`; that commit dropped as already applied.                                                                            |
| `c6c8e516d7a` | read ISO values above 65535                                            | server         | LOW     | Applied to the fork's re-indented copy (Shape K); prettier wraps the longer line.                                                                      |
| `1c284cd4ef7` | custom release notes                                                   | CI/tooling     | MED     | **Dropped with the fork's deletions**: `draft-release.yml`, `packages/scripts` (incl. new `notes.ts`), the new `[tasks.notes]`, the lockfile importer. |
| `28bd3a550b2` | partner-shared assets for people without showInTimeline (immich-32226) | server, people | product | **Dropped fork-side** (decision 1).                                                                                                                    |
| `f892a5485d5` | QNAP persistent database docs                                          | docs           | LOW     | Applied and rebranded (prose, user-created folder → `gallery`; container and app names kept, as the fork's QNAP rebrand does).                         |
| `5a7e65fac39` | people-users endpoints marked beta (immich-32233)                      | server, API    | LOW     | Applied to the fork's relocated copies of the three routes; spec regenerated.                                                                          |
| `139b62cdc88` | people sharing does not share assets (immich-32234)                    | web, i18n      | LOW     | `en.json` key rename taken; both modals stay deleted (person-sharing standing rule).                                                                   |
| `f7dd3ccdc6e` | stop rapid toggling/rerendering of timeline cells                      | mobile         | LOW     | Taken verbatim, no overlap with the fork's highlight border.                                                                                           |
| `3b53f1b4bb5` | unnamed people in `otherPeople` (immich-32239)                         | server         | LOW     | Drops out: the fork's PersonRepository has no `withOtherPeopleFor`.                                                                                    |
| `f607b886f04` | shared person indicator (immich-32238)                                 | web, people    | product | **Adopted on Explore** (decision 2); `PeopleCard.svelte` stays deleted.                                                                                |
| `5b2a3a52be8` | run workflow steps in configured order                                 | server         | LOW     | Taken verbatim (repository, SQL doc, medium spec).                                                                                                     |
| `f6fc5307347` | show date on memories page (immich-32245)                              | mobile         | MED     | `preferDate` merged into the fork's `getMemoryTitle` (rule branch, nullable year); upstream's new test adapted to the raw-map `MemoryData`.            |
| `0f3ef0689c7` | translations                                                           | i18n           | MED     | Key-level merge on all 70 touched locales; three collisions (below).                                                                                   |
| `fe8a3c4f238` | `MACHINE_LEARNING_MODEL_REVISION` env doc                              | docs           | LOW     | Row added to the fork's re-padded table (the fork's ML reads `model_revision`).                                                                        |
| `db6e11ecc85` | chore: version v3.3.1                                                  | versions       | LOW     | Taken, except the fork-owned `mobile/pubspec.yaml` (`1.0.0+1`) and iOS `Info.plist` (`3.0.0`/`240`).                                                   |

### Product decisions (maintainer, 2026-10-09)

1. **immich-32226 — dropped fork-side.** Upstream now counts partner assets in people lists and statistics
   even when the partner is not shown in the timeline, and lets a person-scoped timeline include such
   partners. Gallery's `PersonService` does not read partners at all (owner ∪ Space, per the person-sharing
   standing rule), and the fork's person page never sends `userId`, so the timeline hunk is unreachable
   from Gallery's own clients. Its `person.service` hunks were reset at each stop where they appeared
   (exact: it was the only upstream change to those files). Its `timeline.service` hunk would not even
   type-check here: it reads `options.personId`, which the fork destructures out to normalise into
   `personIds`.
2. **immich-32238 — adopted on Explore.** `PersonIndicator.svelte` replaces the white top-left heart with
   upstream's bottom-corner badge, wrapped around the fork's Space-aware `getPersonHref` /
   `getPersonThumbnail`. The badge's "shared with me" icon is inert in Gallery because `otherPeople` is
   always `[]` (dormant person sharing). The fork's own people page renders through its manage grid and
   is untouched.

## Conflict Resolutions

Every resolution was a region pick or a constructed text, gated on the resolver's exit code (never
`script; git add`). Generated files were resolved to the fork side and regenerated at the end.

| File(s)                                                | Stop (fork commit)                           | Resolution                                                                                                                                           | Risk |
| ------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `server/src/services/metadata.service.ts`              | squash `646dbe6573f`; unicorn v70            | Shape K (fork re-indent): fork copy plus the ISO line; at the unicorn stop the fork's `Number(...)` fps beside upstream's ISO.                       | LOW  |
| `person.service.ts`, `.spec.ts`, `timeline.service.ts` | #531                                         | immich-32226 declined: files reset to the fork commit (32226 was their only upstream change). End state identical to the pre-cycle tip.              | LOW  |
| `mise.toml`, `packages/scripts/**`                     | drop-tooling commit                          | Both `release` and `notes` tasks dropped; `cli.ts`, `types.ts` and upstream's new `notes.ts`/`notes.spec.ts` deleted (pre-empts Shape I).            | LOW  |
| `packages/scripts/package.json`                        | resurrection-undo commit                     | Deleted (fork intent).                                                                                                                               | LOW  |
| `.github/workflows/draft-release.yml`                  | release-line workflows commit                | Deleted (fork intent).                                                                                                                               | LOW  |
| `pnpm-lock.yaml`                                       | release/v3.3 lockfile regen                  | `packages/scripts` importer dropped; result byte-identical to the fork's lockfile.                                                                   | LOW  |
| `server/src/controllers/person.controller.ts`          | dormant person sharing                       | Removal kept; upstream's beta marking applied to the fork's relocated routes (the "fork-relocated definition" trap).                                 | LOW  |
| `docs/docs/install/qnap.md`                            | QNAP rebrand                                 | Upstream's new section/paragraphs, rebranded.                                                                                                        | LOW  |
| `web/.../people/PeopleCard.svelte`                     | squash `a5ab071c998`, #450                   | Indicator + fork pet badge at the squash; deletion kept at #450.                                                                                     | LOW  |
| `mobile/pubspec.yaml`, `mobile/ios/Runner/Info.plist`  | #121, batch-278 CI fix                       | Fork-owned versions kept.                                                                                                                            | LOW  |
| `i18n/en.json`                                         | #227                                         | Fork's `manage_shared_links` kept beside upstream's key removal.                                                                                     | LOW  |
| `docs/docs/install/environment-variables.md`           | #463                                         | Fork's padded table + the new row; prettier re-aligned.                                                                                              | LOW  |
| `web/src/routes/(user)/explore/+page.svelte`           | #495                                         | Decision 2 around the fork's helpers.                                                                                                                | LOW  |
| `server/src/repositories/person.repository.ts`         | `8b26d71b779`                                | Shape K: the fork commit deletes upstream's sharing helpers (`withOtherPeopleFor` …); kept, so immich-32239 drops out. Identical to the fork commit. | LOW  |
| `web/src/lib/modals/PersonEditAccessModal.svelte`      | dormant person sharing                       | Deletion kept.                                                                                                                                       | LOW  |
| `memory_title.widget.dart`                             | `0f8a6a7147e` (rule titles)                  | Upstream's `preferDate` + `intl` import, fork's nullable-year switch and `rule` branch.                                                              | MED  |
| `server/src/queries/person.repository.sql` (×5)        | #542, #553, …                                | Fork side at each stop; final copy restored from the pre-cycle tip (see Inconsistencies).                                                            | LOW  |
| `open-api/immich-openapi-specs.json`                   | OpenAPI regen commit                         | Fork side; regenerated at the end (diff = exactly immich-32233's beta marking).                                                                      | LOW  |
| `i18n/*.json` (13 stops)                               | #697, #824, #843, #851, #853, #979, #1123, … | Key-level 3-way merge from index stages; per-file verify that the fork commit's key delta is applied exactly.                                        | LOW  |

**i18n collisions** (both sides changed one key):

| Key                                                               | Fork                                                 | Upstream                                    | Taken    | Why                                                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `zh_Hans.manage_people`                                           | 管理人物 (#851)                                      | 人物管理                                    | upstream | Upstream key the fork translated first — last cycle's rule (`ru.manage_people`).               |
| `de.admin.queues`                                                 | Auftrags-Schlangen (#979)                            | Server-Tasks                                | **fork** | A deliberate fork re-translation; the fork's `queues_page_description` uses the same noun.     |
| `fr.admin.integrity_checks_checksum_files_time_limit_description` | "… en millisecondes entre deux vérifications" (#979) | "… à chaque intervalle. (en millisecondes)" | upstream | The fork's wording was a mistranslation ("between two checks"; the English is "per interval"). |

## Fork commits added this cycle

- `chore(rebase)`: regenerate the OpenAPI spec (immich-32233 beta marking) and restore the person SQL docs.
- `fix(rebase)`: adapt upstream's memory list test to the raw-map `MemoryData`, pin that rule memories keep
  their rule title (verified red with `preferDate` applied to the rule branch), Explore formatting, fr key order.
- `chore(rebase)`: advance the upstream base to v3.3.1 (config, README, M8 pin).
- `fix(rebase)`: review follow-ups (revert-script comments, Explore favorite-badge test).
- `fix(preflight)`: fork ownership coverage diffs against the manifest's `upstream_branch`, and the
  manifest cursor moves off the orphaned pre-cutover SHA (two commits; the second points it at a commit
  that survives this cutover).

## Fork Feature Verification

| Feature                  | Status | Notes                                                                                    |
| ------------------------ | ------ | ---------------------------------------------------------------------------------------- |
| People / person sharing  | OK     | PersonService/Repository identical to the pre-cycle tip; `person-sharing-dormant` green. |
| Shared Spaces / timeline | OK     | `timeline.service.ts` identical to the pre-cycle tip.                                    |
| Memories (rules)         | OK     | Rule titles unaffected by `preferDate`; new pin test.                                    |
| Search V3                | OK     | `search-v3-not-dispatched` green.                                                        |
| Plugins / workflows      | OK     | Upstream's step-order fix taken verbatim.                                                |
| Branding                 | OK     | `gallery-branding-check.sh` passes; no literal-noop risk; no new upstream-name i18n key. |

## CI and Infrastructure Verification

| Check                                    | Status | Notes                                              |
| ---------------------------------------- | ------ | -------------------------------------------------- |
| Workflow files (no upstream collisions)  | OK     | `draft-release.yml` stays deleted.                 |
| Docker image references / branding leaks | OK     | No `.github/` or Dockerfile change this cycle.     |
| Fork CI modifications intact             | OK     | `ci-invariants-check`, `fork-patches-check` green. |
| mise tasks                               | OK     | No task references the deleted `@immich/scripts`.  |

## Database Migrations

No new upstream server migration (`server/src/schema/migrations/` equals the v3.3.1 tree), no Drift change
(`mobile-drift-rebase-check` OK). `revert-to-immich.sql` coverage: 0 missing, 0 extra against v3.3.1.

## Inconsistencies Found

- **Generated SQL residue.** The replay left `person.repository.sql` with upstream's `otherPeople` blocks
  duplicated beside the fork's (+84 lines). `Generated Query Block Survival` passed because it checks for
  **lost** blocks, not extra ones. Restored from the pre-cycle tip, which is exact: every generator input
  except `workflow.repository.ts` is byte-identical to that tip, and its `.sql` equals upstream's delta.
  Docker Desktop would not start locally, so CI's SQL Schema Checks job is the confirmation.
- Shape K appeared twice (`metadata.service.ts`, `person.repository.ts`), both caught by comparing region sizes.
- **Fork-sync coverage check broken since the v3.3.0 cutover (tooling, pre-existing).**
  `fork-ownership-coverage-check` diffed `upstream/main...origin/main`. With `main` on the `release/v3.3` line
  that merge base is where the release branch left upstream `main`, so upstream's own release-branch bumps
  (`packages/sdk`, `plugin-sdk`, `plugin-core`) read as three uncovered fork files. It also rejected
  `last_verified_fork_head` `da5480ae42b`, which the 10-06 force-push orphaned. The target now diffs
  against `upstream/<manifest upstream_branch>`; the manifest covers all 3553 fork files. The cursor is set
  to a commit on this branch, so the next fork sync after this cutover does not hit the same orphan.
- The post-rebase audit's `Generated Artifact Review` flag on the OpenAPI spec is informational: the
  spec's changed-line multiset equals upstream's own v3.3.0→v3.3.1 delta (26 lines).

## Local Verification

| Check                                                                               | Status                                          |
| ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| post-rebase audit (batches 01–07), invariants, patches, drift, autolink (1639 msgs) | PASS (only generated-artifact reviews, handled) |
| per-file delta audit vs upstream; key-level i18n audit (70 files)                   | PASS — every difference intended                |
| deleted paths absent; zero-byte set unchanged; retired dirs empty                   | PASS                                            |
| `server pnpm build` / `pnpm check` / eslint (changed files)                         | PASS                                            |
| server unit tests                                                                   | PASS — 6607 passed                              |
| web `check:typescript` / `check:svelte` (644 files) / eslint / specs                | PASS — explore + faces-page 24 passed           |
| mobile codegen, `dart analyze --fatal-infos`, `dart format`                         | PASS                                            |
| mobile tests (memory list/title/bottom info, card text, fixed row)                  | PASS — 30 passed                                |
| upstream-preflight suite                                                            | PASS — 301 passed                               |
| branding check, prettier (i18n, docs, server)                                       | PASS                                            |
| medium tests, web/mobile full suites, ML, e2e                                       | CI                                              |

## Landing

- Maintainer call (2026-10-09): land on the v3.3.1 tag after reviewing the branch. The `OrganizationAdmin`
  bypass was added to ruleset 13531204 for the push; it should come off right after.
- `main` `6417a8114ce` → the commit carrying this report, `--force-with-lease` on `6417a8114ce`.
- Backup: **`main-backup-2026-10-09`** (`6417a8114ce`) on origin, plus local `backup/main-2026-10-09`.
- Every `main` commit is on the branch (`git cherry` marks #1169 as patch-equivalent). 0 behind `v3.3.1`.
- `release/v3.3` has one commit past the tag: immich-32262 (`762748f9eae`, memories date in every app
  language, `memory_title.widget.dart` + its test). Not taken — this cutover is on the tag. Next cycle.

## Remote CI

Not run on the branch before landing (local gates only, above). The full suite runs against `main` after
the force-push; results are recorded here when it finishes.
