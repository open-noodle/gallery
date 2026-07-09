# Slice 5 Plan — Read-time filtering in `search`

Spec: `2026-06-16-config-driven-memory-types-design.md` (Slice 5).

## Files

- `server/src/services/memory.service.ts` — filter `search` results by type visibility.
- `server/src/services/memory.service.spec.ts` — `getMetadata` default mock + new cases.

## TDD

1. Add `mocks.user.getMetadata.mockResolvedValue([])` to the global `beforeEach` (keeps existing search
   tests green; the `?? []` guard also protects them). Add hide/keep cases. Run → 3 hide tests fail (no filter).
2. Implement the filter. Re-run → green (4659). `pnpm check` clean.

## Behavior

`search`: after access-filtering, load `availableTypes = getAdminAvailableMemoryTypeKeys(config.memories)`
and `userTypes = getPreferences((await userRepository.getMetadata(auth.user.id)) ?? []).memories.types`, then
keep a memory iff `isMemoryTypeVisible`:

- saved → always shown;
- key underivable (non-string/missing ruleId) → shown;
- key not in the registry (foreign/unknown ruleId) → shown;
- otherwise hide when the known key is admin-unavailable OR user-disabled.

This reconciles the spec's "unknown-key memories are always shown": only KNOWN registry keys are ever hidden.

## Cases

OnThisDay hidden when user-disabled / shown when enabled; rule hidden when user-disabled; hidden when
admin-disabled globally; saved exempt; unknown `ruleId` passthrough; existing access-permission filtering
preserved.

## SDK regen

None (no DTO change).

Commit: `feat(memories): hide disabled memory types from the memories feed`.
