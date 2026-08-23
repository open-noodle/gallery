# Upstream Sync Report — 2026-08-05 (batch 58b + fork sync)

Third cycle of 2026-08-05, and the direct follow-on to
`2026-08-05-upstream-sync-batch-58.md`: upstream shipped the fix for the break
that report documented.

> **Batch numbering note.** `make upstream-batch-plan` numbers batches
> **relative to the current plan**, not globally. This cycle's single-commit batch
> is also called **58** — the same number the previous cycle used for
> `1c7c28bb0d5..555fbde840e`. `make upstream-postrebase-audit BATCH=59` fails with
> `Unknown upstream batch 59`. Read the number out of `batch-plan.md` rather than
> incrementing the previous cycle's.

## Summary

- **Upstream commits pulled**: 1 (`555fbde840e..db2033a4b02`)
- **Fork commits synced**: 1 (#921)
- **Conflicts resolved**: 1 (the recurring `AA` on the backup test)
- **Risk level**: LOW
- **Recommendation**: PROCEED
- **Landing on `main`**: NO. Upstream's newest tag is still `v3.1.0` = the fork's
  base. Standing rule; not an open question.

## Incoming Upstream Changes

| SHA           | Summary                                                      | Area   | Risk to Fork | Notes                                                             |
| ------------- | ------------------------------------------------------------ | ------ | ------------ | ----------------------------------------------------------------- |
| `db2033a4b02` | chore: add reason for stopForegroundBackup in tests (#30573) | mobile | LOW          | Upstream fixing the exact build break the previous report raised. |

**Product-direction gate: did not fire** (a one-line test-string chore).
**Zero-conflict semantic break gate: literal detector clean**; no signature
changes in this batch.

## The predicted conflict, and what it revealed

The previous report ended: _"Expect a trivial conflict here when upstream fixes
its own break."_ Upstream fixed it ~3h later with `reason: "test"`; the fork's
repair commit had used `reason: "test pause"`.

**The interesting part is that it did NOT conflict.** Fork #892 deletes
`mobile/test/providers/backup/drift_backup_provider_test.dart`, and the fork's
repair commit **re-adds** it afterwards. A re-add always wins over whatever
upstream has at that path — so the replay completed silently and left the fork
carrying a gratuitous one-line divergence in an upstream-owned test:

```diff
-      notifier.stopForegroundBackup(reason: "test");        # upstream
+      notifier.stopForegroundBackup(reason: "test pause");  # fork
```

**Generalises to a rule worth keeping**: a fork commit that _re-adds_ a file
upstream also owns silently suppresses upstream's version of it — no conflict,
no audit signal. After any such restore, diff that path against `upstream/main`
rather than assuming the rebase reconciled it.

### Resolution

The repair commit was amended so the file is **byte-identical to
`upstream/main`**. Its two halves had different lifetimes:

- the **fix** (adding a `reason`) is now obsolete — upstream owns it;
- the **restore** is still required, because #892 still deletes the path.

The commit message was rewritten accordingly and now leads with the durable part
(_"restore upstream's test, which fork #892 deletes"_), keeping the build-break
history as background. Verified with `git range-diff` that only that one commit
changed; the four commits after it replayed byte-identically.

The one real conflict was the by-now-familiar `AA` at that same path when fork
#627 creates its own version. Resolved from the commit itself
(`git show <commit>:<path>`), per the rule recorded last cycle — never by parsing
conflict markers — and checked with marker count, brace balance, and the file
tail before continuing.

## Fork Sync

`make upstream-sync-fork-main` cherry-picked cleanly, 1 commit:

| SHA (new)     | Commit                                              |
| ------------- | --------------------------------------------------- |
| `191a2af6c2e` | feat(web): add a compact sidebar rail (#912) (#921) |

`integratedForkHead` → `1d4a447ecde` (= `origin/main`).

**This is substantial new fork surface** — 66 files, **27 new fork-only files**,
covering two features: the compact sidebar rail and a bundled filter-section
menu. Added to the skill's fork-feature tables (see "Skill Sync Anchor").

Per the standing rule that a clean fork sync is **not** CI-safe (the rolling
branch's toolchain runs ahead of `main`'s), the full CI suite is re-dispatched
rather than trusting #921's green status on `main` — this is exactly the class of
commit (large, web, many new spec files) that has twice tripped lint-rule drift.

## Inconsistencies Found

**A stale-generated-code false alarm worth recording.** The first
`dart analyze --fatal-infos lib test` of this cycle reported **199 errors**, all
in `mobile/test/medium/repository_context.dart`, of the form
`SharedSpaceAlbumAssetEntityCompanion isn't defined`. None of them were real: the
gitignored `lib/**/*.drift.dart` outputs were left over from the _previous_
cycle's tree and had not been regenerated after this replay. Running
`build_runner build --delete-conflicting-outputs` followed by
`drift_dev schema generate` took it to **No issues found**.

The trap is that the errors name fork-only Space-albums symbols, so they read
exactly like a rebase having dropped fork code. **Mobile codegen is gitignored
(#888) and is not refreshed by the rebase** — always regenerate before believing
a mobile analyze failure. Translation codegen alone is not enough; #921 touching
`i18n/` made it tempting to run only that.

Nothing else found. Unchanged pre-existing items from the previous report:
`drift_backup.page.dart`'s two `unawaited` removals, three unformatted files
under `mobile/test/` (CI formats `lib` only), and
`branding/scripts/verify-mobile-assets.sh` being called by neither a workflow nor
`gallery-branding-check.sh`.

## Fork Feature Verification

| Feature                     | Status | Notes                                         |
| --------------------------- | ------ | --------------------------------------------- |
| Shared Spaces               | OK     | Untouched                                     |
| Storage Migration           | OK     | Untouched                                     |
| Pet Detection               | OK     | Untouched                                     |
| Image Editing               | OK     | Untouched                                     |
| Branding                    | OK     | `gallery-branding-check.sh` passes            |
| Google Photos Import        | OK     | Untouched                                     |
| Mobile deferred sync (#513) | OK     | Untouched this batch                          |
| Compact sidebar rail (#921) | NEW    | Arrived via fork sync; 27 new fork-only files |

Automated audits (run with `BATCH=58`, see numbering note):

- `make upstream-postrebase-audit BATCH=58` — 7/7 OK
- `make fork-patches-check` — OK
- `make ci-invariants-check` — 3/3 OK
- `make mobile-drift-rebase-check BATCH=58` — OK

## Database / Mobile Drift Migration Analysis

**No migrations in this batch.** Gallery migration count **49** (unchanged), no
timestamp collisions, `postbuild` intact (`Synced 49 … 1 compatibility aliases`).
Mobile `schemaVersion` unchanged, no new snapshots, no renumbering.

`make open-api` / `make sql` deliberately not run: no controller, DTO or
repository changed, and the audit's Generated Artifact Review flagged nothing.

## Local CI Verification

| Check                                  | Status | Notes                                        |
| -------------------------------------- | ------ | -------------------------------------------- |
| `server pnpm build` (+ migration sync) | PASS   | 49 migrations, 1 alias                       |
| `server pnpm check` (tsc)              | PASS   |                                              |
| `mise //:sdk:build`                    | PASS   |                                              |
| `web check:typescript`                 | PASS   |                                              |
| `web check:svelte`                     | PASS   | **585** files (was 575 — #921), 0 errors     |
| `server pnpm lint`                     | PASS   |                                              |
| web eslint (`tscompat` off)            | PASS   |                                              |
| Server unit tests                      | PASS   | 5266 passed, 14 skipped                      |
| Web unit tests                         | PASS   | **4332** passed (was 4174 — #921), 310 files |
| `dart analyze --fatal-infos lib test`  | PASS   | after codegen refresh — see Inconsistencies  |
| mobile format (CI scope: `lib`)        | PASS   | 793 files, 0 changed                         |
| `flutter test`                         | PASS   | 3156 passed, 1 skipped                       |
| `gallery-branding-check.sh`            | PASS   |                                              |

`mise.lock` / `mobile/mise.lock`: not modified.

## Skill Sync Anchor

Anchor bumped to **`1d4a447ecde`** (#921). Unlike the previous two cycles this
one **does** add fork surface, now recorded in the skill's tables:

**Web Compact Sidebar Rail (#912 → #921)** — `web/src/lib/components/sidebar/`
(`sidebar-shell`, `sidebar-nav-group`, `sidebar-nav-item` + specs),
`web/src/lib/stores/sidebar-mode.svelte.ts`, `sidebar-media.svelte.ts`,
`web/src/lib/components/shared-components/side-bar/rail-storage.svelte`,
`web/src/routes/(user)/user-settings/sidebar-settings.svelte`, rail-aware
`NavigationBar`/`UserPageLayout`, `web/src/test-data/` stubs +
`reactive-props.svelte.ts`, and `e2e/src/ui/specs/sidebar/sidebar-rail.e2e-spec.ts`.
Bundled with it: **filter-section menu** —
`web/src/lib/components/filter-panel/filter-section-menu.svelte` (extends the
existing Filter Panel row). Specs:
`docs/superpowers/specs/2026-08-02-web-compact-sidebar-design.md`,
`…/2026-08-04-filter-section-menu-design.md`.

## Post-Rebase Verification

- Commits behind `upstream/main`: **0**
- Fork diff vs `upstream/main`: clean; the previously divergent backup test is
  now byte-identical to upstream
