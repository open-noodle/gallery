# Slice 1 Plan — Memory-type metadata module

Spec: `docs/superpowers/specs/2026-06-16-config-driven-memory-types-design.md` (Slice 1).

## Scope

Pure, additive. Add the registry metadata module + resolvers and a full unit spec. No behavior change elsewhere.

## Files

- NEW `server/src/services/memory-rules/memory-type.metadata.ts`
- NEW `server/src/services/memory-rules/memory-type.metadata.spec.ts`

## TDD

1. **Red:** write `memory-type.metadata.spec.ts` (below), run
   `cd server && pnpm test -- --run src/services/memory-rules/memory-type.metadata.spec.ts`.
   Expect failure: module `memory-type.metadata` does not resolve (import error).
2. **Green:** create `memory-type.metadata.ts` exactly per the spec's Architecture Overview. Re-run → green.
3. `cd server && pnpm check` clean.
4. Commit: `feat(memories): add declarative memory-type metadata registry`.

## Tests (exact behaviors)

- `MEMORY_TYPE_METADATA`: unique keys; equals the three entries `[on_this_day, birthday, recent_trip]` each
  `defaultEnabled: true, adminConfigurable: true` with kinds `on_this_day|rule|rule`; rule-kind keys non-empty.
- `MEMORY_TYPE_KEYS` = `['on_this_day','birthday','recent_trip']`.
- `buildDefaultMemoryTypeMap()` = `{ on_this_day: true, birthday: true, recent_trip: true }`.
- `getMemoryTypeMetadata('birthday')` defined; `('nope')` undefined.
- `getMemoryTypeKeyForMemory`: OnThisDay→`on_this_day`; Rule+`{ruleId:'birthday'}`→`birthday`;
  Rule+`{}`/`null`/`{ruleId:42}`→`undefined`.
- `getAdminAvailableMemoryTypeKeys`: `{}`→all three; `{types:{recent_trip:false}}`→omits recent_trip;
  `{birthday:false}`→omits birthday; `{birthday:false,types:{birthday:true}}`→birthday present;
  `{types:{unknown_key:true}}`→all three (unknown ignored).
- `isMemoryTypeEnabledForUser`: `(undefined,'birthday')`→true; `({birthday:false},'birthday')`→false;
  `({}, 'recent_trip')`→true; `(undefined,'unknown_key')`→false.
