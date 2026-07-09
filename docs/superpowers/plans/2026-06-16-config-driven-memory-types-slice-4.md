# Slice 4 Plan — Generation gating via the registry

Spec: `2026-06-16-config-driven-memory-types-design.md` (Slice 4).

## Files

- NEW `server/src/services/memory-rules/memory-type.registry.ts` (+ `.spec.ts`).
- `server/src/services/memory.service.ts` — registry-driven generation with admin + per-user gating.
- `server/src/services/memory.service.spec.ts` — new gating tests; legacy + spy tests stay green.

## TDD

1. Registry red→green: `createMemoryRules` instantiates rule-kind rules by key (parity + completeness +
   dedupe guards). `CI=true pnpm test -- --run src/services/memory-rules/memory-type.registry.spec.ts`.
2. Service red→green: add gating tests (OnThisDay per-user skip; OnThisDay admin skip; rule per-user gate;
   admin types-map gate; master-switch display-only). Then rewire.

## Rewire

- `onMemoriesCreate`: compute `availableTypes = getAdminAvailableMemoryTypeKeys(config.memories)` once;
  `userTypesById` from `getPreferences(user.metadata ?? []).memories.types`; `enabledRuleKeysById` (rule-kind
  ∩ available ∩ user-enabled) and `onThisDayUsers` (available + user-enabled). Window loop maps over
  `onThisDayUsers`; rule loop passes `enabledRuleKeysById.get(owner.id)` into `createRuleMemories`.
- `getMemoryRules(enabledKeys)` → `createMemoryRules(enabledKeys, { person, asset, memory })`.
- `createRuleMemories(ownerId, target, enabledRuleKeys)` / `evaluateRuleCandidates(ownerId, target, enabledRuleKeys)`.
- Gating only at `getMemoryRules`; NO candidate post-filter by `ruleId` (keeps spy tests' fake rules flowing).

## Outcome

- Registry spec green (7 tests). Service spec green (4653 total). `pnpm check` clean.
- The three legacy disable tests and the five spy scheduling/scoring tests passed unchanged (back-compat proof).
- Note: recent-trip rule calls `getMemoryLocationClusters` twice per evaluate (baseline + recent); the
  per-user test asserts it ran for both users by id rather than a brittle call count.

## SDK regen

None (no DTO change in this slice).

Commit: `feat(memories): gate generation by admin + per-user memory-type config`.
