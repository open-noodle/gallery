# Image Adjustments — Slice 3: Agent operation family (`asset.adjust` + `asset.flip`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Two reviewable agent operations — `asset.adjust` (tonal/auto-enhance) and `asset.flip` (mirror) — with the same lifecycle as the shipped `asset.crop` (ImageEditBatch target, `editAssets` write-scope, Low risk, reversible via the editor), wired through the propose/plan/apply path.

**Architecture:** New `AgentOperationType.AssetAdjust` / `AssetFlip`. Payload schemas + both union sites in `agent-operation.dto.ts`. A shared `mergeEdits` util generalizes the editor merge. `agent-operation-plan.service.ts` gains `applyAdjustOperation` / `applyFlipOperation` (mirroring `applyCropOperation`) plus the new op types mirrored at every site `AssetCrop` appears. Contract descriptions + ≤2 examples.

**Tech Stack:** NestJS, Zod v4, Vitest. Reuses the `AssetEditAction.Adjust`/`Mirror` editor actions from Slice 1.

Spec: `docs/superpowers/specs/2026-06-06-pi-agent-image-adjustments-design.md` (Slice 3).

---

## File Structure

- **Modify** `server/src/enum.ts` — `AssetAdjust = 'asset.adjust'`, `AssetFlip = 'asset.flip'` in `AgentOperationType` (after `AssetCrop`).
- **Modify** `server/src/dtos/agent-operation.dto.ts` — payload schema/shape + standalone op schemas + add to BOTH unions.
- **Create** `server/src/utils/asset-edit.ts` (+ spec) — shared `mergeEdits`.
- **Modify** `server/src/services/agent-operation-plan.service.ts` — apply methods + mirror `AssetCrop` at every site.
- **Modify** `server/src/services/agent-mcp-tool-contract.service.ts` — action descriptions + ≤2 examples.
- Tests: `agent-operation.dto.spec.ts`, `agent-operation-plan.service.spec.ts`, `agent-mcp-tool-contract.service.spec.ts`, `asset-edit.spec.ts`.

---

## Task 1: enum + payload schemas + both union sites (dto)

**Files:**

- Modify: `server/src/enum.ts`, `server/src/dtos/agent-operation.dto.ts`
- Test: `server/src/dtos/agent-operation.dto.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `agent-operation.dto.spec.ts` (match the file's existing parse style — it validates via the exported request schemas / `AgentOperationPlanToolRequestSchemas`; reuse whatever helper the file already uses to build a proposeAssetBatch request and a revise request):

```ts
// adjust payload validation (via a proposeAssetBatchFromSelection request action)
it('accepts asset.adjust with one manual field', () => {
  expect(parseBatchAction({ type: 'asset.adjust', brightness: 'moderate_increase' }).success).toBe(true);
});
it('accepts asset.adjust autoEnhance alone', () => {
  expect(parseBatchAction({ type: 'asset.adjust', autoEnhance: true }).success).toBe(true);
});
it('rejects asset.adjust with no fields', () => {
  expect(parseBatchAction({ type: 'asset.adjust' }).success).toBe(false);
});
it('rejects asset.adjust autoEnhance + manual field', () => {
  expect(parseBatchAction({ type: 'asset.adjust', autoEnhance: true, brightness: 'slight_increase' }).success).toBe(
    false,
  );
});
it('rejects asset.adjust unknown key (strict)', () => {
  expect(parseBatchAction({ type: 'asset.adjust', sharpen: 'slight_increase' }).success).toBe(false);
});
it('accepts asset.flip with a valid axis', () => {
  expect(parseBatchAction({ type: 'asset.flip', axis: 'horizontal' }).success).toBe(true);
});
it('rejects asset.flip with no axis', () => {
  expect(parseBatchAction({ type: 'asset.flip' }).success).toBe(false);
});

// standalone-operation membership + target validation (via a proposeAlbumOperations / operations array request)
it('accepts an asset.adjust standalone operation with an ImageEditBatch target', () => {
  expect(parseOperation(adjustOperation({ brightness: 'moderate_increase' })).success).toBe(true);
});
it('rejects an asset.adjust operation with an AssetBatch target', () => {
  expect(parseOperation(adjustOperation({ brightness: 'moderate_increase' }, 'asset_batch')).success).toBe(false);
});

// iterate contract: revise accepts an asset.adjust replacement op
it('reviseProposedOperations accepts an asset.adjust replacement op', () => {
  expect(parseRevise([adjustOperation({ contrast: 'strong_increase' })]).success).toBe(true);
});
```

> Build `parseBatchAction`, `parseOperation`, `parseRevise`, `adjustOperation` helpers by reading the existing spec for how it constructs `proposeAssetBatchFromSelection` actions, `operations[]` items (with `targetKind`/selection), and revise requests. Mirror the existing `asset.crop` / `asset.rotate` test cases in this file exactly (find them) and adapt to adjust/flip. The default target for an ImageEdit op is `ImageEditBatch`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C server test -- --run src/dtos/agent-operation.dto.spec.ts`
Expected: FAIL — `'asset.adjust'`/`'asset.flip'` not in the enum / unions.

- [ ] **Step 3: Implement**

**enum.ts** — add after `AssetCrop = 'asset.crop'`:

```ts
  AssetAdjust = 'asset.adjust',
  AssetFlip = 'asset.flip',
```

**agent-operation.dto.ts:**

1. Payload shape + schema + refine (near `assetCropPayloadSchema` ~line 412). Use a SHAPE object so it can be inlined into the discriminated-union member (the `updateMetadata` precedent at line 908-913):

```ts
const tonalLevelValues = [
  'strong_decrease',
  'moderate_decrease',
  'slight_decrease',
  'slight_increase',
  'moderate_increase',
  'strong_increase',
] as const;
const assetAdjustPayloadShape = {
  brightness: z.enum(tonalLevelValues).optional(),
  contrast: z.enum(tonalLevelValues).optional(),
  saturation: z.enum(tonalLevelValues).optional(),
  autoEnhance: z.boolean().optional(),
};
const validateAdjustPayload = (
  payload: { brightness?: string; contrast?: string; saturation?: string; autoEnhance?: boolean },
  ctx: z.RefinementCtx,
) => {
  const manual = [payload.brightness, payload.contrast, payload.saturation].filter((v) => v !== undefined);
  if (payload.autoEnhance === undefined && manual.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'At least one adjustment is required' });
  }
  if (payload.autoEnhance && manual.length > 0) {
    ctx.addIssue({ code: 'custom', message: 'autoEnhance cannot be combined with manual adjustments' });
  }
};
const assetAdjustPayloadSchema = z.strictObject(assetAdjustPayloadShape).superRefine(validateAdjustPayload);
const assetFlipPayloadSchema = z.strictObject({ axis: z.enum(['horizontal', 'vertical']) });
```

> Reuse the `TonalLevel` enum from `src/dtos/editing.dto` if you prefer (`z.enum(TonalLevel)`); the literal-array form above is equivalent and avoids an import cycle if one exists — pick whichever lints clean. Keep the value strings identical to Slice 1's `TonalLevel`.

2. Standalone op schemas (after `cropOperationSchema` ~line 560), mirroring crop:

```ts
const adjustOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetAdjust).meta({ id: 'AgentAssetAdjustOperationType' }),
    ...assetBatchBase,
    payload: assetAdjustPayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.ImageEditBatch, AgentOperationType.AssetAdjust);
  });

const flipOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetFlip).meta({ id: 'AgentAssetFlipOperationType' }),
    ...assetBatchBase,
    payload: assetFlipPayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.ImageEditBatch, AgentOperationType.AssetFlip);
  });
```

3. Add both to the `AgentGalleryOperationInputSchema` discriminated union list (after `cropOperationSchema`, ~line 786):

```ts
  adjustOperationSchema,
  flipOperationSchema,
```

4. Add both to the `AgentAssetBatchWorkflowActionSchema` discriminated union (~line 905, mirroring the crop `.extend` and the refined `updateMetadata` member):

```ts
    z.strictObject({ type: z.literal(AgentOperationType.AssetAdjust), ...assetAdjustPayloadShape }).superRefine(validateAdjustPayload),
    assetFlipPayloadSchema.extend({ type: z.literal(AgentOperationType.AssetFlip) }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C server test -- --run src/dtos/agent-operation.dto.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/enum.ts server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts
git commit -m "feat(agent): asset.adjust + asset.flip operation schemas (both union sites)"
```

---

## Task 2: shared `mergeEdits` util

**Files:**

- Create: `server/src/utils/asset-edit.ts`, `server/src/utils/asset-edit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { AssetEditAction, MirrorAxis, TonalLevel } from 'src/dtos/editing.dto';
import { mergeEdits } from 'src/utils/asset-edit';

const adjust = (level: TonalLevel) => ({ action: AssetEditAction.Adjust, parameters: { brightness: level } }) as const;
const mirror = (axis: MirrorAxis) => ({ action: AssetEditAction.Mirror, parameters: { axis } }) as const;
const crop = { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 10, height: 10 } } as const;

describe('mergeEdits', () => {
  it('replaces an existing adjust, keeps a crop', () => {
    const merged = mergeEdits([crop, adjust(TonalLevel.SlightIncrease)], [adjust(TonalLevel.StrongIncrease)]);
    expect(merged.filter((e) => e.action === AssetEditAction.Adjust)).toHaveLength(1);
    expect(merged.find((e) => e.action === AssetEditAction.Adjust)?.parameters).toEqual({
      brightness: TonalLevel.StrongIncrease,
    });
    expect(merged[0].action).toBe(AssetEditAction.Crop); // crop stays first
  });

  it('keeps one mirror per axis (idempotent on same axis), allows both axes', () => {
    const merged = mergeEdits([mirror(MirrorAxis.Horizontal)], [mirror(MirrorAxis.Horizontal)]);
    expect(merged.filter((e) => e.action === AssetEditAction.Mirror)).toHaveLength(1);
    const both = mergeEdits([mirror(MirrorAxis.Horizontal)], [mirror(MirrorAxis.Vertical)]);
    expect(both.filter((e) => e.action === AssetEditAction.Mirror)).toHaveLength(2);
  });

  it('incoming crop replaces existing crop and stays first', () => {
    const merged = mergeEdits(
      [crop, adjust(TonalLevel.SlightIncrease)],
      [{ action: AssetEditAction.Crop, parameters: { x: 1, y: 1, width: 5, height: 5 } }],
    );
    expect(merged.filter((e) => e.action === AssetEditAction.Crop)).toHaveLength(1);
    expect(merged[0].action).toBe(AssetEditAction.Crop);
    expect(merged[0].parameters).toEqual({ x: 1, y: 1, width: 5, height: 5 });
  });

  it('empty existing returns incoming', () => {
    expect(mergeEdits([], [adjust(TonalLevel.SlightIncrease)])).toEqual([adjust(TonalLevel.SlightIncrease)]);
  });
});
```

- [ ] **Step 2: Run → fail** (`module not found`).

Run: `pnpm -C server test -- --run src/utils/asset-edit.spec.ts`

- [ ] **Step 3: Implement**

```ts
import { AssetEditActionItem, MirrorParameters } from 'src/dtos/editing.dto';
import { AssetEditAction } from 'src/dtos/editing.dto';

const editKey = (edit: AssetEditActionItem): string =>
  edit.action === AssetEditAction.Mirror ? `mirror:${(edit.parameters as MirrorParameters).axis}` : edit.action;

/** Merge incoming edits into existing: replace any edit with the same key (mirror keyed by axis); crop stays first. */
export const mergeEdits = (existing: AssetEditActionItem[], incoming: AssetEditActionItem[]): AssetEditActionItem[] => {
  const incomingKeys = new Set(incoming.map(editKey));
  const merged = [...existing.filter((e) => !incomingKeys.has(editKey(e))), ...incoming];
  const crop = merged.find((e) => e.action === AssetEditAction.Crop);
  return crop ? [crop, ...merged.filter((e) => e.action !== AssetEditAction.Crop)] : merged;
};
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/asset-edit.ts server/src/utils/asset-edit.spec.ts
git commit -m "feat(editing): shared mergeEdits util (replace-by-key, crop first)"
```

---

## Task 3: apply methods + mirror `AssetCrop` at every plan-service site

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Test: `server/src/services/agent-operation-plan.service.spec.ts`

### Mirror sites (add `AssetAdjust` + `AssetFlip` everywhere `AssetCrop` appears)

Run `grep -n "AssetCrop" server/src/services/agent-operation-plan.service.ts` and handle EACH:

| Site (approx line)                               | What it is                          | What to add for adjust/flip                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------- | --- | -------------------- | --- | ------------------- |
| ~529 summary switch                              | per-type plan summary               | adjust → `'Adjust matching photos'`; flip → `` `Flip matching photos ${dto.axis === 'horizontal' ? 'horizontally' : 'vertically'}` ``                                                                                                                         |
| ~547 `getAssetBatchWorkflowTargetKind`           | target kind                         | include adjust/flip → `ImageEditBatch`                                                                                                                                                                                                                        |
| ~568 `getAssetBatchWorkflowPayload`              | tool→op payload                     | adjust → spread the set fields (`brightness/contrast/saturation/autoEnhance`); flip → `{ axis: dto.axis }`                                                                                                                                                    |
| ~601 `getAssetBatchWorkflowRiskLevel`            | risk                                | adjust/flip → `Low` (same case group as crop)                                                                                                                                                                                                                 |
| ~1115 `requiresWritableAssets`                   | writable-asset list                 | add both                                                                                                                                                                                                                                                      |
| ~1446 op-type `                                  |                                     | ` list                                                                                                                                                                                                                                                        | (the editable/asset-op list) | add `     |     | type === AssetAdjust |     | type === AssetFlip` |
| ~1965 `editAssets` write-scope check             | gate                                | extend to `(AssetRotate                                                                                                                                                                                                                                       |                              | AssetCrop |     | AssetAdjust          |     | AssetFlip)`         |
| ~2212 field-override switch (`case AssetRotate`) | inline field overrides during apply | add `case AssetAdjust:` and `case AssetFlip:` that **reject** field overrides (mirror rotate's `throw new BadRequestException('Unsupported field override for operation type')` when any field is present) — v1 iterate uses full revise, not field overrides |
| ~2836 apply switch                               | dispatch                            | `case AssetAdjust: return this.applyAdjustOperation(auth, operation);` `case AssetFlip: return this.applyFlipOperation(auth, operation);`                                                                                                                     |

> The 4 batch-workflow switches (~529/547/568/601) are exhaustive over the action union — once Task 1 adds adjust/flip to `AgentAssetBatchWorkflowActionSchema`, **tsc will error until you add the cases**. Use that as your checklist. The `||` lists and the apply switch are NOT tsc-enforced — the grep is your checklist there.

### New apply methods (after `applyCropOperation` ~line 3253)

```ts
private requireAdjustPayload(payload: unknown): AdjustParameters {
  const p = this.requireObjectPayload(payload) as AdjustParameters;
  // structural trust: payload already validated by the op schema; just return the known fields
  return p;
}

private async applyAdjustOperation(auth: AuthDto, operation: AgentOperationPlanWithOperations['operations'][number]): Promise<AgentOperationApplyUpdate> {
  const params = this.requireAdjustPayload(operation.payload);
  return this.applyImageEditOperation(auth, operation, { action: AssetEditAction.Adjust, parameters: params }, 'adjust');
}

private async applyFlipOperation(auth: AuthDto, operation: AgentOperationPlanWithOperations['operations'][number]): Promise<AgentOperationApplyUpdate> {
  const payload = this.requireObjectPayload(operation.payload) as { axis: MirrorAxis };
  return this.applyImageEditOperation(auth, operation, { action: AssetEditAction.Mirror, parameters: { axis: payload.axis } }, 'flip');
}

/** Shared per-asset image-edit apply: getForEdit → image check → mergeEdits → editAsset. Mirrors applyCropOperation. */
private async applyImageEditOperation(
  auth: AuthDto,
  operation: AgentOperationPlanWithOperations['operations'][number],
  edit: AssetEditActionItem,
  verb: string,
): Promise<AgentOperationApplyUpdate> {
  const assetResults: BulkIdResponseDto[] = [];
  const successfulAssetIds: string[] = [];
  for (const assetId of operation.assetIds) {
    try {
      const editableAsset = await this.assetRepository.getForEdit(assetId);
      if (!editableAsset) throw new BadRequestException('Asset not found');
      if (editableAsset.type !== AssetType.Image) throw new BadRequestException('Only images can be edited');
      const { edits } = await this.assetService.getAssetEdits(auth, assetId);
      const mergedEdits = mergeEdits(edits.map(({ action, parameters }) => ({ action, parameters }) as AssetEditActionItem), [edit]);
      await this.assetService.editAsset(auth, assetId, { edits: mergedEdits });
      successfulAssetIds.push(assetId);
      assetResults.push({ id: assetId, success: true });
    } catch (error) {
      assetResults.push({ id: assetId, success: false, errorMessage: error instanceof Error ? error.message : `Failed to ${verb} asset` });
    }
  }
  const failedAssetCount = assetResults.length - successfulAssetIds.length;
  const result = { assetIds: successfulAssetIds, assetResults: assetResults.map(({ id, success, error, errorMessage }) => ({ id, success, error, errorMessage })) };
  if (failedAssetCount > 0) {
    return { id: operation.id, status: AgentOperationStatus.Failed, result, error: `Failed to ${verb} ${failedAssetCount} asset(s)` };
  }
  return this.appliedOperation(operation.id, result);
}
```

Imports: add `mergeEdits` from `src/utils/asset-edit`, `AdjustParameters` + `MirrorAxis` from `src/dtos/editing.dto` (alongside the existing `AssetEditAction, AssetEditActionItem, CropParameters` import).

- [ ] **Step 1: Write the failing tests** (in `agent-operation-plan.service.spec.ts`, mirroring the existing `applyCropOperation` tests — find them):

```ts
describe('applyAdjustOperation', () => {
  it('merges an adjust edit and calls editAsset, replacing an existing adjust', async () => {
    /* mock getForEdit→Image, getAssetEdits→[existing adjust], assert editAsset called with one adjust (the new params) */
  });
  it('skips a non-image asset (records failure)', async () => {
    /* getForEdit→Video → asset result success:false */
  });
});
describe('applyFlipOperation', () => {
  it('ensures one mirror of the axis', async () => {
    /* getAssetEdits→[], assert editAsset called with [{mirror, axis}] */
  });
});
describe('asset.adjust/flip maps', () => {
  it('summary, target=ImageEditBatch, risk=Low for adjust and flip', () => {
    /* call the summary/target/risk helpers (or build a plan and assert) */
  });
  it('editAssets ungranted blocks adjust/flip', async () => {
    /* writeScope without editAssets → blocked/disclosed */
  });
  it('apply switch routes asset.adjust → applyAdjustOperation, asset.flip → applyFlipOperation', async () => {
    /* spy or assert behavior */
  });
});
```

> Read the existing crop/rotate apply + write-scope tests in this spec and clone their structure (the mock setup for `assetRepository.getForEdit`, `assetService.getAssetEdits`/`editAsset`, write-scope snapshots). Keep assertions concrete.

- [ ] **Step 2: Run → fail.**

Run: `pnpm -C server test -- --run src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 3: Implement** the apply methods + all mirror-site cases.

- [ ] **Step 4: Run → pass** (and `make check-server` to confirm the exhaustive switches are complete).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts
git commit -m "feat(agent): apply asset.adjust + asset.flip; wire risk/target/scope/apply"
```

---

## Task 4: contract descriptions + ≤2 examples

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Test: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('asset.adjust + asset.flip contract examples parse and stay ≤2', () => {
  // find the proposeAssetBatchFromSearch/FromSelection contract entry; assert adjust + flip actions are documented,
  // each example validates against AgentAssetBatchWorkflowActionSchema, and examples.length <= 2 per tool (token-opt invariant).
});
```

> Mirror the existing crop/rotate contract test in this spec file (find it) — there is already an example-fidelity test that parses each example against the schema; ensure the new adjust/flip examples are included and pass.

- [ ] **Step 2: Run → fail** (adjust/flip not yet documented / example count).

- [ ] **Step 3: Implement** — in `agent-mcp-tool-contract.service.ts`, find the `proposeAssetBatchFromSearch` (and `FromSelection`) action documentation where crop/rotate are described, add `asset.adjust` and `asset.flip` to the action description, with **≤2 examples each**: adjust → `{ type: 'asset.adjust', brightness: 'moderate_increase', contrast: 'slight_increase' }` and `{ type: 'asset.adjust', autoEnhance: true }`; flip → `{ type: 'asset.flip', axis: 'horizontal' }` and `{ type: 'asset.flip', axis: 'vertical' }`. Keep total examples per tool within the existing ≤2 cap if the cap is per-tool; if examples are per-action, keep ≤2 per action.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "feat(agent): document asset.adjust + asset.flip in the proposeAssetBatch contract"
```

---

## Task 5: OpenAPI regen (TS + Dart) + gates

- [ ] **Step 1:** `make check-server && make lint-server` (zero warnings). Server prettier on every touched server file.
- [ ] **Step 2:** `pnpm -C server build && pnpm -C server sync:open-api && make open-api`
- [ ] **Step 3:** verify new op types in both clients:

```bash
git status --porcelain open-api/ mobile/openapi/
grep -rl "AssetAdjust\|asset.adjust\|AssetFlip\|asset.flip" open-api/typescript-sdk/src >/dev/null && echo "TS ok"
grep -rl "asset.adjust\|assetAdjust\|asset_adjust" mobile/openapi/lib >/dev/null && echo "Dart ok"
```

Run `make open-api-dart` if Dart didn't update.

- [ ] **Step 4:** re-run the Slice-3 specs together:

```bash
pnpm -C server test -- --run src/dtos/agent-operation.dto.spec.ts src/utils/asset-edit.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

- [ ] **Step 5:** commit generated clients:

```bash
git add open-api/ mobile/openapi/
git commit -m "chore(openapi): regenerate clients for asset.adjust + asset.flip (TS + Dart)"
```

---

## Edge cases covered (from the spec)

- adjust payload: one field ok; empty → rejected; autoEnhance+manual → rejected; unknown key → rejected (strict); bad level → rejected (Task 1).
- flip: valid axis ok; missing axis → rejected (Task 1).
- adjust/flip with AssetBatch target → rejected by `validateStandaloneTarget` (Task 1).
- both ops in the `proposeAssetBatch` action union (Task 1 — the crop-bug regression).
- `reviseProposedOperations` accepts an adjust replacement op — the iterate contract (Task 1).
- apply: merges + editAsset; replaces existing adjust; ensures one mirror per axis; skips non-image (Task 3).
- target=ImageEditBatch; risk=Low; `editAssets` ungranted blocks; apply routes correctly (Task 3).
- contract examples parse; ≤2 (Task 4).

## Self-review checklist

- Every Slice-3 spec test mapped to a task. ✅
- Both union sites updated (standalone op list + batch action union). ✅
- All `AssetCrop` mirror sites enumerated with line numbers + semantics. ✅
- `mergeEdits` shared util created here (deferred from Slice 2). ✅
- No future-slice work (no web, no runner). ✅

```

```
