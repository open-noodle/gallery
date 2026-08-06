# Slice 2.1 — `lockAssets` write-scope

Spec: Phase 2. Identical mechanism to Slice 1.1 (`shareAlbums`), but `lockAssets` is
High-risk: granted **only in LocalPowerUser**, OFF in Careful/base AND VisualOrganizer
(the eval preset) — so L3 stays routing-only/propose-blocked.

TDD: failing tests first.

## Wiring sites (exact — same 9 as slice 1.1, place after `shareAlbums`)

1. `server/src/types/agent-session.types.ts` — `AgentPermissionPlanSnapshot.writeScope`
   add `lockAssets?: boolean;`; `AgentNormalizedPermissionPlanSnapshot.writeScope` add
   `lockAssets: boolean;`.
2. `server/src/dtos/agent-session.dto.ts` — `legacyWriteScopeDefaults` add
   `lockAssets: false`; `expandedWriteScopeShape` add `lockAssets: z.boolean()`.
3. `server/src/services/agent-session.service.ts` — static `legacyWriteScopeDefaults`
   `lockAssets: false`; **Careful** preset `lockAssets: false`; **VisualOrganizer**
   preset `lockAssets: false` (OFF — unlike shareAlbums); **LocalPowerUser** preset
   `lockAssets: true`.
4. `server/src/services/agent-operation-plan.service.ts` — static
   `legacyWriteScopeDefaults` add `lockAssets: false`.

## Tests (write first — RED)

`server/src/services/agent-session.service.spec.ts`:

- Add `lockAssets: false` to `carefulWriteScope` AND `expandedWriteScope` test constants
  (NOTE: `expandedWriteScope` is shared by the VisualOrganizer + LocalPowerUser
  assertions, but they differ on lockAssets — VO=false, LPU=true. If the existing spec
  uses one shared `expandedWriteScope` constant for BOTH presets, you must split the
  lockAssets expectation per preset rather than reuse the shared constant. Inspect how
  the spec asserts each preset and assert lockAssets explicitly per preset.)
- New `it`: `Careful.writeScope.lockAssets === false`, `VisualOrganizer === false`,
  `LocalPowerUser === true`.
- Also update the normalization-snapshot expectations + any fixture that snapshots the
  full writeScope (dto.spec `fullWriteScope`, controller.spec `makePermissionPlan`,
  agent-operation-plan.service.spec `expandedWriteScope`) — add `lockAssets` with the
  preset-appropriate value.

RED run: `cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-session.service.spec.ts`.

## Implement → GREEN, then regression

Wire the 9 sites. Re-run the spec → green. Then:

- `pnpm exec vitest run --config test/vitest.config.mjs src/dtos/agent-session.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/controllers/agent-session.controller.spec.ts` → green.
- OpenAPI regen for the schema change (the writeScope is in the spec):
  `cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api`.
- `npx tsc --noEmit` clean.

## Commit

`feat(agent): add lockAssets write-scope (LocalPowerUser only)`

## Out of scope

No `asset.setVisibility` op (2.2), no workflow (2.3).
