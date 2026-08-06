# Slice 3.1 — `deleteContainers` write-scope

Spec: Phase 3. IDENTICAL mechanism to slice 2.1 (`lockAssets`): a High-risk scope granted
**only in LocalPowerUser**, OFF in Careful/base AND VisualOrganizer (eval preset) → L3
routing-only/propose-blocked.

TDD: failing tests first. Mirror `lockAssets` exactly — grep `lockAssets` across the 4
wiring files and add `deleteContainers` right after it at each.

## Wiring sites (same 9 as 1.1/2.1)

1. `server/src/types/agent-session.types.ts` — both writeScope interfaces (`deleteContainers?: boolean;` optional, `deleteContainers: boolean;` normalized).
2. `server/src/dtos/agent-session.dto.ts` — `legacyWriteScopeDefaults` (`false`) + `expandedWriteScopeShape` (`z.boolean()`).
3. `server/src/services/agent-session.service.ts` — static `legacyWriteScopeDefaults` (`false`); Careful (`false`); VisualOrganizer (`false`); LocalPowerUser (`true`).
4. `server/src/services/agent-operation-plan.service.ts` — static `legacyWriteScopeDefaults` (`false`).

## Tests (write first — RED)

`agent-session.service.spec.ts`: new `it` asserting `deleteContainers` false/false/true for
Careful/VisualOrganizer/LocalPowerUser; update the writeScope test constants + the LPU
override (like `lockAssets`: VO=false so it can't go in the shared `expandedWriteScope`
constant — assert per preset). Update the normalization snapshots + any full-writeScope
fixture (`dto.spec` `fullWriteScope` + `expandedWriteScopeKeys`, `controller.spec`
`makePermissionPlan`, `agent-operation-plan.service.spec` `expandedWriteScope`) with the
preset-appropriate value (Careful/VO/legacy/generic=false, LPU=true).

RED: `cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-session.service.spec.ts`.

## Implement → GREEN → regression

Wire the 9 sites; re-run → green. Then
`pnpm exec vitest run --config test/vitest.config.mjs src/dtos/agent-session.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/controllers/agent-session.controller.spec.ts`,
OpenAPI regen (`pnpm build && pnpm sync:open-api && make open-api`), `npx tsc --noEmit` clean.

## Commit

`feat(agent): add deleteContainers write-scope (LocalPowerUser only)`

## Out of scope

No `album.delete`/`space.delete` ops (3.2), no workflows (3.3/3.4).
