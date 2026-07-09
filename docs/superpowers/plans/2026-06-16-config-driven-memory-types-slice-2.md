# Slice 2 Plan — System-config admin gate

Spec: `2026-06-16-config-driven-memory-types-design.md` (Slice 2).

## Scope

Add `memories.types: Record<string, boolean>` to system config (sparse admin gate). No generation change.

## Files

- `server/src/config.ts` — add `types: Record<string, boolean>` to `SystemConfig['memories']`; default `types: {}`.
- `server/src/dtos/system-config.dto.ts` — `SystemConfigMemoriesSchema` adds
  `types: z.record(z.string(), z.boolean()).default({})`.
- `server/src/services/system-config.service.spec.ts` — new tests + add `types: {}` to the `updatedConfig` fixture.

## TDD

1. **Red:** add two cases to `system-config.service.spec.ts` (`describe('getConfig')`): default `memories.types`
   is `{}`; a stored override `{ memories: { types: { recent_trip: false } } }` resolves to `{ recent_trip: false }`.
   Run `CI=true pnpm test -- --run system-config.service.spec` → both fail (`memories.types` undefined).
2. **Green:** add the config field+default, the zod field, and `types: {}` to the typed fixture. Re-run → green.
3. `pnpm check` clean.
4. Commit `feat(memories): add per-type admin availability map to system config`.

## SDK regen

Deferred to Slice 6 (single regen of TS + Dart clients capturing all DTO changes). Server unit tests do not
depend on the generated SDK.

## Notes

- `types` default stays `{}` (sparse) so the resolver's legacy fold (`getAdminAvailableMemoryTypeKeys`) still
  honors pre-existing `birthday`/`recentTrips` admin overrides.
- `toMatchObject` assertions for memories are unaffected; the stored-partial diff assertion is unaffected
  (unchanged `types: {}` is not part of the diff).
