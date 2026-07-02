# Slice 22 — LOW#6: hide the inert release-channel selector

Spec: `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` § "Slice 22 — LOW[6]"

## Problem

Upstream v3 added a stable/RC "release channel" dropdown in
`web/src/routes/admin/system-settings/NewVersionCheckSettings.svelte`, bound to
`SystemConfigNewVersionCheckDto.channel` (`ReleaseChannel.Stable` /
`ReleaseChannel.ReleaseCandidate`). `getLatestRelease()` (server-side) appends
`?channel=` to the version-check request. But the fork overrides the
version-check URL entirely in
`server/src/repositories/server-info.repository.ts`, so the channel value is a
silent no-op — the dropdown promises behavior the fork doesn't deliver.

## Decision (locked)

Hide the dropdown from the rendered settings page. Keep the DTO field
(`channel`) accepted server-side — no API/DTO/regen change. This is a
web-only, presentation-layer fix.

## Approach

`NewVersionCheckSettings.svelte` is an upstream-owned file. To keep the diff
minimal and rebase-friendly (so future upstream changes to this file merge
cleanly), wrap only the `SettingSelect` block for the channel picker in
`{#if false}` with a short fork comment explaining why, rather than deleting
the markup or the `ReleaseChannel` import. This:

- Removes the control from the rendered DOM (satisfies the goal).
- Leaves the block's markup intentionally present textually, so an upstream
  diff to that same block still applies/conflicts visibly instead of silently
  vanishing.
- Requires no changes to the DTO, `system-config-manager`, or
  `server-info.repository.ts`.

The bound value `configToEdit.newVersionCheck.channel` is left untouched in
the model — `SettingButtonsRow` still saves the whole `newVersionCheck` key,
so the (now unedited, default) channel value round-trips harmlessly and the
server continues to silently ignore it per the existing repository override.

## Test plan (TDD)

New co-located test: `web/src/routes/admin/system-settings/NewVersionCheckSettings.spec.ts`

Pattern: mirror `MemoriesSettings.spec.ts` (mock `featureFlagsManager`,
`systemConfigManager`, `$lib/services/system-config.service`), `render()` the
real component from `@testing-library/svelte`.

Assertions:
1. RED (pre-fix): the channel select is rendered — `screen.getByText('admin.version_check_channel')` exists and a `<select>` (native `role=combobox`) is present for it, with both channel options.
2. GREEN (post-fix): `screen.queryByText('admin.version_check_channel')` is `null`, and the channel select is absent from the document.
3. Edge case coverage in the same file: the enabled switch (`admin.version_check_enabled_description`) still renders and still toggles/saves via `SettingButtonsRow` → `handleSystemConfigSave`, proving the rest of the settings panel is unaffected.

Run scoped: `cd web && npx vitest run src/routes/admin/system-settings/NewVersionCheckSettings.spec.ts`

## Out of scope

- No DTO/API/SDK regen.
- No change to `server-info.repository.ts` or any server code.
- No i18n key removal (`admin.version_check_channel`, `admin.release_channel_stable`, `admin.release_channel_release_candidate` stay — they may still be used/reachable via translation completeness scans elsewhere; removing them is a separate, riskier change not requested by this slice).
