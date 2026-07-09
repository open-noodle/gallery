# Slice 3 Plan — Per-user preference type map

Spec: `2026-06-16-config-driven-memory-types-design.md` (Slice 3).

## Files

- `server/src/types.ts` — add `types: Record<string, boolean>` to `UserPreferences.memories`.
- `server/src/utils/preferences.ts` — import `buildDefaultMemoryTypeMap`; set
  `getDefaultPreferences().memories.types = buildDefaultMemoryTypeMap()`.
- `server/src/dtos/user-preferences.dto.ts` — `MemoriesUpdateSchema` adds optional `types` record;
  `MemoriesResponseSchema` adds required `types` record.
- `server/src/utils/preferences.spec.ts` — new tests + add `types` to the local fixture.

## TDD

1. **Red:** add to `preferences.spec.ts`: getPreferences default `memories.types` map; single-type override
   keeps siblings; getPreferencesPartial persists only the changed type. Run
   `CI=true pnpm test -- --run src/utils/preferences.spec.ts` → 3 fail (default lacks `types`).
   (Two extra guards — unknown-future-key preserved, mergePreferences no-clobber — are generic and pass.)
2. **Green:** add the type field, registry-derived default, DTO fields, and `types` to the local spec fixture.
   Re-run → green (4641 passed).
3. `pnpm check` clean.
4. Commit `feat(memories): add per-user memory-type preference map`.

## SDK regen

Deferred to Slice 6.

## Notes

- User default is the FULL registry map (not sparse) so `getPreferencesPartial` (which iterates default keys)
  persists user overrides. New types appear at their default with no migration.
- `preferences.ts` importing `memory-type.metadata` introduces no cycle (metadata imports only `src/enum`).
