# Slice 12 — Branding batch (M6 + M7 + M8 + LOW#20/#21/#22)

**Date:** 2026-07-02
**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 12"
**Findings doc:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` (M6/M7/M8)
**Branch/worktree:** `rebase/upstream-rolling-20260509-active`

All changes are confined to `branding/` plus one new guard spec in
`tools/upstream-preflight/`. **No branded output is committed** — the branding
script rewrites the whole tree, and per CLAUDE.md that rewritten output must
never be committed. Only the scripts / config / overrides / guard / this plan
land in the commit.

## Findings and exact edits

### M6 — renamed `ServerStatus.svelte`

Upstream renamed the sidebar server-status component from `server-status.svelte`
(kebab-case) to `ServerStatus.svelte` (Pascal-case). `apply-branding.sh` still
targets the old name, so the sidebar new-release link + repo check ship
**unbranded** (leak `immich-app/immich`).

- `apply-branding.sh` `patch_web`:
  `web/src/lib/components/shared-components/side-bar/server-status.svelte`
  → `web/src/lib/components/shared-components/side-bar/ServerStatus.svelte`
- `verify-branding.sh` `url_check_files`: same rename (so verify checks the real
  file instead of silently skipping a nonexistent path).

### M7 — 9 new upstream i18n keys leak "Immich"

`branding/i18n/overrides-en.json` does not cover 9 new keys whose en.json value
contains "Immich". Set difference (`en.json` Immich-valued keys minus override
leaf paths) yields these 9 (What's New, admin integrity page, notifications,
feature settings):

1. `admin.maintenance_integrity_checksum_mismatch_description`
2. `admin.maintenance_integrity_missing_file_description`
3. `admin.maintenance_integrity_untracked_file_description`
4. `notification_enabled_list_tile_content`
5. `ocr_body`
6. `open_in_immich_body`
7. `open_in_immich_title`
8. `recently_added_description`
9. `whats_new_settings_subtitle`

Add branded overrides (Immich → Noodle Gallery). The 3 admin keys nest under the
existing `admin` object (jq `*` recursive merge). `verify-branding.sh` only
inspects keys present in overrides, so adding them makes verify actually cover
them.

> Follow-up (out of scope, reported not fixed): 4 further en.json keys still leak
> "Immich" and are not among the finding's 9 — `admin.asset_offline_description`,
> `import_option_skip_duplicates`, `my_immich_title`, `my_immich_description`.
> These are not surfaced by verify (they're not in overrides). Left for a
> separate scoped fix.

### M8 — `config.json` upstream.version

`branding/config.json` `upstream.version` is `2.7.5`; this branch is rebased onto
Immich `3.0.0`. Set `upstream.version` → `3.0.0`. Feeds "Based on Immich vX"
release notes and the `gallery-revert-to-immich-validation.yml` upstream-tag
checkout (`v3.0.0` resolves as a real upstream tag).

### LOW#20 — `patch_cli` / `patch_versions` package moves

v3 moved `cli/` → `packages/cli` and `open-api/typescript-sdk/` → `packages/sdk`.

- `patch_cli`: `$REPO_ROOT/cli/package.json` → `$REPO_ROOT/packages/cli/package.json`
- `patch_versions`: `$REPO_ROOT/cli/package.json` → `$REPO_ROOT/packages/cli/package.json`
  and `$REPO_ROOT/open-api/typescript-sdk/package.json` → `$REPO_ROOT/packages/sdk/package.json`
- `verify-branding.sh` `check_files`: `cli/package.json` → `packages/cli/package.json`
- **`build-old-root` reference:** the task notes a dead `build-old-root` reference
  in `patch_versions` to remove — but a grep shows apply-branding.sh contains **no**
  `build-old-root` reference (patch_versions only listed `open-api/typescript-sdk/package.json`).
  Nothing to remove here; the directory deletion is Slice 19's job.

### LOW#21 — iOS debug/profile bundle-id patterns

Upstream (futo rename) changed the debug/profile bundle IDs from
`app.alextran.immich.vdebug` / `app.alextran.immich.profile` (with
`.Widget.debug` / `.ShareExtension.profile` suffix ordering) to
`app.futo.immich.debug` / `app.futo.immich.profile` (with the suffix now trailing:
`app.futo.immich.debug.Widget`, `app.futo.immich.profile.ShareExtension`).

- `patch_ios`: replace the 6 stale `app.alextran.immich.vdebug/.profile/.Widget.*/.ShareExtension.*`
  seds with 2 bare prefix swaps: `s/app\.futo\.immich\.debug/${BUNDLE_ID_DEBUG}/g`
  and `s/app\.futo\.immich\.profile/${BUNDLE_ID_PROFILE}/g`. A bare prefix swap
  covers the bare + `.Widget` + `.ShareExtension` variants because the suffix is
  preserved. The release `.Widget` / `.ShareExtension` / main targets still use
  `app.alextran.immich.*` and keep their existing seds.
- `verify-branding.sh` pbxproj check: extend the grep from `app.alextran.immich`
  to also match `app.futo.immich`, so verify actually catches a stale futo bundle
  ID (the current grep is blind to the futo rename — the branded output leaks
  `app.futo.immich.debug` and verify passes).

### LOW#22 — moved `ErrorLayout.svelte`

`ErrorLayout.svelte` lives at `web/src/routes/ErrorLayout.svelte` (both main and
rolling), but branding + verify still point at
`web/src/lib/components/layouts/ErrorLayout.svelte`.

- `apply-branding.sh` `patch_web`: retarget to `web/src/routes/ErrorLayout.svelte`
- `verify-branding.sh` `url_check_files`: same retarget

## Guard (repo-invariant)

New `tools/upstream-preflight/src/branding-targets.spec.ts`: for each critical
target (`ServerStatus.svelte`, `web/src/routes/ErrorLayout.svelte`,
`packages/cli/package.json`, `packages/sdk/package.json`, the iOS `project.pbxproj`)
assert both (a) `apply-branding.sh` references the current path, and (b) the path
exists in the tree; plus `config.json` `upstream.version === '3.0.0'`. This fails
the next rebase if a target file is renamed again (existence check) or the
branding target reverts to a stale path (reference check).

## TDD flow

- **RED:** run the new guard against the unfixed sources → M6/M8/LOW#20/#22
  assertions fail (script references stale paths / version is 2.7.5); the iOS
  pbxproj existence assertion passes. Supplementary: run pristine
  `apply-branding.sh` then scan `i18n/en.json` (13 keys still leak Immich, incl.
  the 9) and `grep app.futo.immich` the pbxproj (leaks present). Revert branded
  output.
- **GREEN:** make the source edits, run the guard → green, then
  `apply-branding.sh` + `verify-branding.sh` + `test-i18n-branding.sh` → zero
  leaks. Revert branded output.
- **Commit** source-only: `apply-branding.sh`, `verify-branding.sh`,
  `overrides-en.json`, `config.json`, the guard spec, this plan.
