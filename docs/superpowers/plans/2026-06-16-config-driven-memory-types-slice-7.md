# Slice 7 Plan — Admin settings dynamic UI

Spec: `2026-06-16-config-driven-memory-types-design.md` (Slice 7). No SDK regen (no DTO change).

## Files

- `web/src/routes/admin/system-settings/MemoriesSettings.svelte` — render a `SettingSwitch` per memory-type
  key (local `memoryTypeKeys = ['on_this_day','birthday','recent_trip']`) instead of the hardcoded
  birthday/recentTrips switches; keep the retention input + `SettingButtonsRow keys={['memories']}`.
- `web/src/routes/admin/system-settings/MemoriesSettings.spec.ts` — `makeConfig`/mocks add `types`; rewrite
  the toggle render + save tests.
- `i18n/{en,de,fr}.json` — add `admin.memory_type_<key>_setting` / `_setting_description` (×3 types).

## Implementation notes

- `SystemConfigMemoriesDto.types` is optional in the SDK; seed `configToEdit.memories.types ??= {}` then
  default each known key to `true`, and bind the switches to a narrowed local `const memoryTypes =
configToEdit.memories.types` (shares the proxy ref, so toggles reach the save payload). Display default is
  the metadata default (`?? true`), not the legacy fold — matches the spec's admin-UI fallback.
- `SettingButtonsRow` saves `pick(configToEdit, ['memories'])`, so the saved object carries
  `retentionDays`, the deprecated `birthday`/`recentTrips`, and the new `types` map.
- Legacy `admin.birthday_memories_setting` / `admin.recent_trip_memories_setting` keys are left in place
  (unused, harmless) to avoid cross-locale churn.

## TDD

1. Rewrite the two toggle tests (red against the hardcoded component): render asserts a switch per type with
   unset→checked and explicit-false→unchecked; save asserts `handleSystemConfigSave` payload includes the
   `types` map and leaves `retentionDays` untouched.
2. Implement the dynamic loop + i18n. Re-run → web suite green (3144). `make check-web` clean (tsc + svelte-check).
3. `pnpm --filter=immich-i18n format:fix` (no diff). Format the component/spec.

Commit: `feat(memories): registry-driven admin memory-type settings`.
