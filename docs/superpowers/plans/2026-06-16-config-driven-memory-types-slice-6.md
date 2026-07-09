# Slice 6 Plan — Server-config exposure + user toggles + i18n

Spec: `2026-06-16-config-driven-memory-types-design.md` (Slice 6).

## Order: server → regen SDK → web

## Server

- `server/src/dtos/server.dto.ts` — `ServerConfigSchema` adds `availableMemoryTypes: z.array(z.string())`.
- `server/src/services/server.service.ts` — `getSystemConfig()` returns
  `availableMemoryTypes: MEMORY_TYPE_KEYS.filter((k) => getAdminAvailableMemoryTypeKeys(config.memories).has(k))`.
- `server.service.spec.ts` — add `availableMemoryTypes` to the exact-match `toEqual`; add admin-disabled case
  (`systemMetadata.get` returns `{ memories: { types: { recent_trip: false } } }` for SystemConfig, `null` else
  — the get() return union accepts `null`, not `undefined`).

## SDK regen (consolidated for Slices 2/3/6)

`cd open-api && bash ./bin/generate-open-api.sh` (server build + spec sync + TS + Dart). CI's
`generated-api-up-to-date` job regenerates all and diffs `mobile/openapi`, `open-api/typescript-sdk`,
`immich-openapi-specs.json`, so commit all regenerated output.

## i18n (root `/i18n`, format-checked by CI `format:fix`)

Add to `en.json`, `de.json`, `fr.json` (sorted; `memory_type_on_this_day` already exists): `memory_type_birthday`,
`memory_type_birthday_description`, `memory_type_on_this_day_description`, `memory_type_recent_trip`,
`memory_type_recent_trip_description`. Run `pnpm --filter=immich-i18n format:fix`.

## Web user settings

- `feature-settings.svelte` — read `serverConfigManager.value.availableMemoryTypes`; seed
  `memoryTypes` state from `authManager.preferences.memories?.types?.[key] ?? true`; render one
  `<Field label={$t('memory_type_'+type)} description=...><Switch bind:checked={memoryTypes[type]} /></Field>`
  per available type inside the memories accordion; save `memories: { enabled, duration, types: {...memoryTypes} }`.
  (`Field` wrapping — not `<Switch label>` — is what gives the switch its accessible name.)
- NEW `feature-settings.spec.ts` — mock `authManager`, `serverConfigManager`, `@immich/sdk` (partial,
  keep real `AssetOrder`), and `setting-accordion-state.svelte` `getAccordionState` → `writable(new Set(['memories']))`
  (cast `as never`; the context store is otherwise undefined in isolation, and pre-opening avoids a click).
- Pre-existing `web/src/test-data/factories/preferences-factory.ts` — add `types: {}` (now required on `MemoriesResponse`).

## Outcome

Server spec green; web suite green (3144); `make check-web` clean (tsc + svelte-check). SDK + mobile client regenerated.

Commit: `feat(memories): per-type user toggles in settings`.
