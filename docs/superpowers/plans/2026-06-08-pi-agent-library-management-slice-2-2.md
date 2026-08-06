# Slice 2.2 — `asset.setVisibility` op (locked-only)

Spec: Phase 2. Depends on: 2.1 (`lockAssets` scope). Adds the asset-batch operation that
moves a resolved asset set into the Locked folder. Mirror `asset.setArchive` end-to-end
(it is the closest sibling: an asset-batch visibility/state op, NOT a pixel edit).

TDD throughout. Grep `AssetSetArchive` to find EVERY site:
`grep -n "AssetSetArchive" server/src/dtos/agent-operation.dto.ts server/src/services/agent-operation-plan.service.ts`.

## Enum

`server/src/enum.ts`, `AgentOperationType` (in the asset group, near `AssetSetArchive`):

```ts
  AssetSetVisibility = 'asset.setVisibility',
```

## DTO — `server/src/dtos/agent-operation.dto.ts` (TWO union sites, mirror setArchive)

`AssetVisibility` is already imported in the service; import it here too (from `src/enum`).

Payload — constrained to `locked` so the op can't silently archive/unlock:

```ts
const assetSetVisibilityPayloadSchema = z.strictObject({
  visibility: z.literal(AssetVisibility.Locked),
});
```

Operation schema (mirror the `setArchive` standalone schema — `...assetBatchBase`, payload,
`validateAssetSelection` + `validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetSetVisibility)`):

```ts
const assetSetVisibilityOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetSetVisibility).meta({ id: 'AgentAssetSetVisibilityOperationType' }),
    ...assetBatchBase,
    payload: assetSetVisibilityPayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(
      operation,
      ctx,
      AgentOperationTargetKind.AssetBatch,
      AgentOperationType.AssetSetVisibility,
    );
  });
```

Register in BOTH union sites where `setArchive`'s schema is registered (the standalone
operation union AND the batch-operations union — grep where the setArchive schema name is
listed; add `assetSetVisibilityOperationSchema` alongside it in both).

## Plan service — `server/src/services/agent-operation-plan.service.ts`

Add an `AssetSetVisibility` arm at every `AssetSetArchive` site:

- **summary** (~529): e.g. `Move matching photos to the Locked folder`.
- **payload** (~590): `return { visibility: operation.payload.visibility };` (or `{ visibility: AssetVisibility.Locked }`).
- **risk** (~658): `return AgentOperationRiskLevel.High;`.
- **grouping list** (~1176, where setArchive is grouped for asset-batch resolution): add `AssetSetVisibility`.
- **type checks** (~1512 and any other `=== AssetSetArchive ||` chains): include `AssetSetVisibility` wherever setArchive is treated as an asset-batch op.
- **validateWriteScope** (~2044): `if (type === AgentOperationType.AssetSetVisibility && !writeScope.lockAssets) throw new BadRequestException('Agent permission policy does not allow moving photos to the Locked folder');`.
- **apply**: mirror the asset-batch apply (the favorite/archive apply calls `assetService.updateAll`). Add:
  `await this.assetService.updateAll(auth, { ids: operation.assetIds, visibility: AssetVisibility.Locked });`
  (grep where `AssetSetArchive` is applied — it calls `updateAll` with `visibility`; mirror exactly).

NOTE: `legacyWriteScopeDefaults` already has `lockAssets` (2.1) — no change.

## Contract fixtures

Add valid + malformed fixtures for `asset.setVisibility` (grep where `asset.setArchive`
fixtures live). Valid: `{ visibility: 'locked' }` on a selection/source. Malformed:
`{ visibility: 'archive' }` / `'timeline'` / `'hidden'` rejected; missing target rejected.

## Token baseline

Adding one op schema raises the catalog token count. Update `CATALOG_TOKENS_BASELINE`
(`agent-mcp-tool-registry.test-helpers.ts`) to the new measured value and the guard
comment, following the documented re-baseline convention (as slice 1.2 did). NOTE: the
"measurably below pre-opt original (52_350)" guard headroom is shrinking — if the new
count crosses ~50_256 (the current 4%-below bound), relax the guard one more step AND
flag in the commit body that the token-optimization headroom is nearly exhausted.

## OpenAPI regen

`cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api` (TS + Dart).

## Tests (write first — RED)

In `agent-operation-plan.service.spec.ts` + `agent-operation.dto.spec.ts` (mirror the
setArchive tests):

- DTO: `{ visibility: 'locked' }` parses; `'archive'`/`'timeline'`/`'hidden'`/missing
  rejected.
- validateWriteScope throws the lock message when `lockAssets` false; ok when true.
- summary/targetKind(`asset_batch`)/payload/risk(`high`) for the op.
- apply: calls `assetService.updateAll` with `{ ids, visibility: 'locked' }` (mock
  assetService; mirror the setArchive apply test).
- contract-fixture validator passes.

RED: `cd server && pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/dtos/agent-operation.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts`.

## Validate → GREEN

Re-run those specs → green. `npx tsc --noEmit` clean. OpenAPI git state clean after commit.

## Commit

`feat(agent): asset.setVisibility op (move photos to the Locked folder)`

## Out of scope

No `lock_assets` workflow (2.3), no matrix rows (2.4).
