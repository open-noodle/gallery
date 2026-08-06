# Trash + Duplicate Cleanup — Slice 1 Implementation Plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-trash-and-duplicate-cleanup-design.md`
Slice: 1 — Server `asset.trash` operation (schema + write-scope gate + High risk + reversible apply).

## Goal

A complete, reversible, gated `asset.trash` operation server-side: proposable
(validated, High risk, write-scope gated) and applyable (move to Trash via
`deleteAll(force: false)`), never hard-deleting.

## Resolved decisions

- **Reversible only:** apply calls `assetService.deleteAll(auth, { ids, force: false })`.
  `force` is NEVER `true` from this path.
- **Preset grant (OQ1 resolved):** `trashAssets: true` in **VisualOrganizer** and
  **LocalPowerUser**; `false` in **Careful** and the legacy default.
- **Risk:** `asset.trash` defaults to `AgentOperationRiskLevel.High`.

## Implementation (exact)

### 1. `server/src/enum.ts`

Add to `AgentOperationType` (near `AssetRemoveTag = 'asset.removeTag'`):
`AssetTrash = 'asset.trash',`.

### 2. `server/src/dtos/agent-session.dto.ts` — write-scope flag

- `legacyWriteScopeDefaults`: add `trashAssets: false,`.
- `expandedWriteScopeShape`: add `trashAssets: z.boolean(),`.

(These feed `AgentWriteScopeSchema`. The legacy default keeps existing sessions
trash-disabled.)

### 3. `server/src/services/agent-session.service.ts` — preset grants

In `permissionPresets`, set `trashAssets` in each preset's `writeScope`:

- `Careful`: `trashAssets: false`.
- `VisualOrganizer`: `trashAssets: true`.
- `LocalPowerUser`: `trashAssets: true`.

Also add `trashAssets: false` to the service's local default write-scope object
(the one mirroring `legacyWriteScopeDefaults`, ~line 20) so every preset object is
exhaustive.

### 4. `server/src/dtos/agent-operation.dto.ts` — `trashOperationSchema`

Mirror `removeTagOperationSchema` but with NO payload and a High default risk.
Add after `removeTagOperationSchema`:

```ts
const trashOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetTrash).meta({ id: 'AgentAssetTrashOperationType' }),
    ...assetBatchBase,
    riskLevel: AgentOperationRiskLevelSchema.optional().default(AgentOperationRiskLevel.High),
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetTrash);
  });
```

(`...assetBatchBase` already includes a `riskLevel` defaulting to Low; the explicit
`riskLevel` after the spread overrides the default to High. Confirm the spread
order makes the High default win; if `assetBatchBase` must stay untouched, define a
local base without `riskLevel` and add the High one. There is no `payload`.)

Add `trashOperationSchema` to the `AgentGalleryOperationInputSchema`
discriminated union (next to `removeTagOperationSchema`).

### 5. `server/src/services/agent-operation-plan.service.ts`

- **validateWriteScope** (`:1873` chain): add, in the asset-operation section
  (next to `AssetSetArchive`/`AssetAddTag`):
  ```ts
  if (type === AgentOperationType.AssetTrash && !writeScope.trashAssets) {
    throw new BadRequestException('Agent permission policy does not allow moving assets to trash');
  }
  ```
- **Risk level:** trash is proposed via `proposeAlbumOperations`, so the op's own
  `riskLevel` (DTO default High) should carry through. VERIFY this in a test
  (propose a trash op, assert persisted `riskLevel === High`). If the plan-build
  path normalizes risk per type (the `:297-451` assignments are for the
  batch-from-search/selection tools), add an `AssetTrash → High` mapping there too.
- **Apply** (`applySingleOperation`, after the `AssetAddTag`/`AssetRemoveTag`
  cases ~`:2745`):
  ```ts
  case AgentOperationType.AssetTrash: {
    await this.assetService.deleteAll(auth, { ids: operation.assetIds, force: false });
    return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
  }
  ```
  (No payload to read. `deleteAll` enforces `Permission.AssetDelete` and soft-
  deletes to Trash. OQ4: confirm non-deletable assets surface as a partial/blocked
  result rather than throwing the whole apply — match the existing bulk-op
  behavior; if `deleteAll` throws on a permission gap, that is the existing
  contract and the apply reports the failure.)

## TDD steps

### Task 1: failing tests (red)

Server unit tests (`agent-operation-plan.service.spec.ts` + the dto specs):

- **Schema:** `trashOperationSchema` parses a valid op (`type:'asset.trash'`,
  `targetKind:'asset_batch'`, one asset-selection mechanism, no payload) and
  defaults `riskLevel: 'high'`. Rejects: a `payload`, a `targetId`,
  zero/multiple selection mechanisms, `targetKind !== 'asset_batch'`.
- **Union:** `AgentGalleryOperationInputSchema` accepts a trash op.
- **Write-scope gate:** `validateWriteScope` THROWS `BadRequestException` for
  `AssetTrash` when `trashAssets` is `false`; does NOT throw when `true`.
- **Preset grants:** VisualOrganizer + LocalPowerUser presets have
  `writeScope.trashAssets === true`; Careful + legacy default have `false`.
- **Risk:** a proposed trash op persists `riskLevel === High`.
- **Apply — reversible:** applying an `asset.trash` op calls
  `assetService.deleteAll` with `{ ids, force: false }` (spy/mock) — assert
  `force === false` and that `force: true` is NEVER passed from the trash path.
- **Apply — result:** returns an applied-operation result with the asset ids.

Run red; confirm failures are "AssetTrash is not defined" / "unknown operation" /
"force undefined" — not typos.

### Task 2: implement (green)

Make the enum, dto, preset, validateWriteScope, and apply changes until the full
server unit suite is green:

```bash
/opt/homebrew/bin/mise exec -- pnpm -C server test
```

### Task 3: regenerate OpenAPI + SDK

The write-scope DTO and the operation union changed:

```bash
/opt/homebrew/bin/mise exec -- pnpm -C server build
/opt/homebrew/bin/mise exec -- pnpm sync:open-api
/opt/homebrew/bin/mise exec -- make open-api    # if Java available; else note for CI
```

Commit the regenerated `open-api/` artifacts. (CI "OpenAPI Clients" gate requires
this.)

## Edge cases (covered by tests)

- Hard delete is impossible from this path (`force` always `false`) — guard test.
- `trashAssets` ungranted → BadRequestException (no mutation).
- Empty/duplicate `assetIds` rejected by the selection rules.
- High risk survives (assert on the persisted op).
- Permission gap on some assets → existing bulk-op partial/blocked behavior (OQ4).

## Acceptance

- New trash schema/gate/risk/apply tests green; full server unit suite green.
- `force: false` proven; no path passes `force: true`.
- Preset grants correct (VisualOrganizer + LocalPowerUser only).
- OpenAPI/SDK regenerated and committed.

## Commit

`feat(server): add reversible asset.trash agent operation (High risk, trashAssets write-scope)`
