# Slice G2 — `asset.stack` / `asset.unstack` ops + stack/unstack workflows

Spec: `docs/superpowers/specs/2026-06-05-pi-agent-reorg-sharing-people-design.md` (Phase G2).
Two new reviewable batch ops wrapping `StackService`, a new `manageStacks` write-scope, and
two hybrid workflows. **Low risk, reversible.** TDD: server-unit RED→GREEN first, then
agent-runner RED→GREEN, then evals + regen.

## Reference patterns (read these before writing)

- The closest op analogs: **`asset.trash`** (AssetBatch target, `assetSource` selection
  handle, NO payload, apply = one service call over `operation.assetIds`) and **`asset.crop`**
  (a recently-added batch action — mirror it at every wiring site). The crop/OQ-F1 lesson:
  a new batch op must be added to ALL of summary / target-kind / payload / risk switches AND
  the apply switch AND the scope check, or it classifies but cannot propose/apply.
- Apply pattern: `applyRotateOperation` / `applyCropOperation` (server
  `agent-operation-plan.service.ts` ~3075/3141) and the `AssetTrash` apply case (~2801,
  `assetService.deleteAll(...)` over `operation.assetIds`).

## Part A — Server

### A1. `src/enum.ts` (~177)

Add after `AssetCrop = 'asset.crop'`:

```ts
AssetStack = 'asset.stack',
AssetUnstack = 'asset.unstack',
```

### A2. Write-scope type + presets

- Find the agent write-scope type (grep `editAssets` in `src/dtos/` — the
  `AgentPermissionWriteScope`-like shape). Add a `manageStacks: boolean` field.
- `src/services/agent-session.service.ts`:
  - `legacyWriteScopeDefaults` (~28): add `manageStacks: false`.
  - Careful preset writeScope (~47–66): add `manageStacks: false`.
  - VisualOrganizer preset writeScope (~87–106): add `manageStacks: true`.
  - LocalPowerUser preset writeScope (~127–146): add `manageStacks: true`.

### A3. `src/dtos/agent-operation.dto.ts`

- **Standalone operation union** (mirror the `asset.trash` entry, ~636, NOT crop — stacks
  use `AssetBatch` target and carry no payload): add two `z.object({...}).superRefine(...)`
  members validating `validateStandaloneTarget(operation, ctx, AgentOperationTargetKind.AssetBatch, AgentOperationType.AssetStack)`
  and `...AssetUnstack`. Each requires an `assetSource` selection handle, no payload (same as
  `asset.trash`/`asset.restore`).
- **Batch workflow action union** `AgentAssetBatchWorkflowActionSchema` (~788–812): add
  `z.object({ type: z.literal(AgentOperationType.AssetStack) })` and `...AssetUnstack` — no
  extra fields (mirror the `AssetRotate` member at ~800 but drop `angle`).

### A4. `src/services/agent-operation-plan.service.ts`

- **Constructor (~254)**: inject `private readonly stackService: StackService,` (import
  `StackService` from `src/services/stack.service`). Place it next to `assetService`.
  Verify the providers/module wires it (build + unit tests will catch a missing provider).
- **`getAssetBatchWorkflowActionSummary` (~510 switch)**: add
  `case AgentOperationType.AssetStack: return 'Stack matching photos';` and
  `case AgentOperationType.AssetUnstack: return 'Unstack matching photos';`.
- **`getAssetBatchWorkflowTargetKind` (~532)**: no code change needed (the else branch
  already returns `AssetBatch` for non-rotate/crop) — but ADD a test asserting stack/unstack
  map to `AssetBatch`.
- **`getAssetBatchWorkflowPayload` (~540 switch)**: add
  `case AgentOperationType.AssetStack:` and `case AgentOperationType.AssetUnstack: { return {}; }`.
- **`getAssetBatchWorkflowRiskLevel` (~580 switch)**: add both cases returning
  `AgentOperationRiskLevel.Low`.
- **Write-scope check (~1943, the shared `validateWriteScope`/`validateApplyAccess` fn)**:
  add `if ((type === AgentOperationType.AssetStack || type === AgentOperationType.AssetUnstack) && !writeScope.manageStacks) { throw new BadRequestException('Agent permission policy does not allow stacking assets'); }`.
  CONFIRM this function is the single shared site used at BOTH propose and apply (grep
  `editAssets` — only one usage outside the session service). If propose has a separate
  scope gate, add the check there too.
- **Apply switch (~2793)**: add
  `case AgentOperationType.AssetStack: { return this.applyStackOperation(auth, operation); }`
  and `case AgentOperationType.AssetUnstack: { return this.applyUnstackOperation(auth, operation); }`.
- **Any image-edit / batch type lists** at ~1099–1100 and ~1431–1432 (grep `AssetCrop` in
  this file): READ both. If they enumerate "image edit" ops, do NOT add stack/unstack (they
  are not image edits). If they enumerate "asset-batch ops that resolve a selection handle to
  `operation.assetIds`", stack/unstack MUST be added so the apply path resolves their handle.
  Decide per the surrounding comment; add a test that apply receives resolved `assetIds`.

- **New apply methods**:

```ts
private async applyStackOperation(auth, operation): Promise<AgentOperationApplyUpdate> {
  // operation.assetIds is the resolved set (>= 2 expected; <2 → StackCreateDto.min(2) rejects).
  // Primary = favorite > rating(desc, nulls last) > newest(fileCreatedAt desc) > id.
  // Fetch favorite/rating/fileCreatedAt for operation.assetIds via the SAME asset-metadata
  // read path readAssetMetadata uses (assetRepository; find the existing method that returns
  // the AgentAssetMetadataReviewRow / favorite+rating+date for a set of ids). Sort, pick
  // primary, then call stackService.create(auth, { assetIds: [primary, ...rest] }).
  // try/catch → on failure return { id, status: Failed, error }. On success
  // return this.appliedOperation(operation.id, { stackId, assetIds: operation.assetIds }).
}

private async applyUnstackOperation(auth, operation): Promise<AgentOperationApplyUpdate> {
  // Resolve operation.assetIds → distinct non-null stackIds (read each asset's stackId via
  // the appropriate repository; assets in no stack are skipped — absent-safe). Then
  // stackService.deleteAll(auth, { ids: distinctStackIds }) (dissolves those stacks).
  // If no stackIds, return appliedOperation with an empty result (no-op, disclosed).
  // try/catch → Failed on error; success → appliedOperation(operation.id, { assetIds }).
}
```

Use the existing `appliedOperation` / `AgentOperationApplyUpdate` / failure-shape helpers
(mirror `applyRotateOperation`'s return contract exactly).

### A5. Server unit tests (RED first)

- `src/services/agent-operation-plan.service.spec.ts`:
  - propose: `proposeAssetBatchFromSelection` with `action: { type: 'asset.stack' }` →
    operation has `summary` "Stack matching photos", `targetKind: AssetBatch`, `payload: {}`,
    `riskLevel: Low`. Same for `asset.unstack`.
  - apply stack: stub `stackService.create`; assert it is called once with
    `{ assetIds: [<primary>, ...] }` where primary is chosen by favorite>rating>newest
    (three ordered fixtures, one per tie-break); result recorded.
  - apply unstack: stub the asset→stackId read + `stackService.deleteAll`; assert deleteAll
    called with the distinct stackIds; absent-safe (asset with no stack → skipped/no-op).
  - scope: `manageStacks: false` session → propose blocked AND apply blocked
    (`/does not allow stacking/`); `manageStacks: true` → allowed.
- `src/services/agent-session.service.spec.ts`: preset snapshot — `manageStacks` true in
  VisualOrganizer + LocalPowerUser, false in Careful (+ legacy default false).
- `src/dtos/agent-operation.dto.spec.ts` (or wherever the crop batch-action parse test lives,
  see the matrix note "accepts proposeAssetBatch ... crop"): assert the batch action union
  accepts `{ type: 'asset.stack' }` and `{ type: 'asset.unstack' }`, and the standalone
  operation union accepts an `asset.stack`/`asset.unstack` op with `AssetBatch` target +
  selection-handle `assetSource` and rejects a payload.

Run `pnpm -C server test -- --run src/services/agent-operation-plan.service.spec.ts src/services/agent-session.service.spec.ts src/dtos/agent-operation.dto.spec.ts`
→ RED, then implement → GREEN.

## Part B — agent-runner

### B1. `contract-fixtures.mjs`

- Add `'asset.stack'`, `'asset.unstack'` to `KNOWN_OPERATION_TYPES` and
  `KNOWN_BATCH_ACTION_TYPES`. `validateBatchAction` needs no new case (no required fields).

### B2. Workflows (RED tests first)

`workflows/stack-assets.mjs` (kind `stack_assets`) and `workflows/unstack-assets.mjs`
(kind `unstack_assets`). Model on `archive-assets.mjs` (source resolve →
`proposeAssetBatchFromSelection` with a typed action). Behavior:

- **stack_assets**: verbs `stack`, `group … into a stack`. Pattern e.g.
  `/\b(?:stack|group)\s+(?<source>.+?)(?:\s+into\s+a\s+stack)?$/i`. Resolve source. If
  `assetCount < 2` → `needsInput` ("a stack needs at least two photos — broaden the
  selection"). Subjective → handoff. Propose `proposeAssetBatchFromSelection` with
  `action: { type: 'asset.stack' }`, `selectionHandleId`. Success text discloses the primary
  rule ("keeps the favorite / highest-rated as the stack cover").
- **unstack_assets**: verbs `unstack`, `ungroup`, `un-stack`. Resolve source (no <2 guard —
  one asset can be in a stack). Propose `action: { type: 'asset.unstack' }`.
- Decline cross-verbs: rotate/crop/trash/share must not match (disjoint verbs — add negative
  match tests). Empty source → needsInput; tool errors → failed; plan error → failed via
  `gatePlanResult`.

Test cases mirror `archive-assets.test.mjs` (identity, match incl. declines, parseSlots,
run: planned happy-path asserting the exact action object + `selectionHandleId` + no raw
assetIds, `<2` needsInput (stack only), subjective handoff, empty needsInput, search throws →
failed, plan error → failed, success copy + successSummary).

### B3. registry + manifest

- `registry.mjs`: import + register `stackAssetsWorkflow` and `unstackAssetsWorkflow` adjacent
  to `cropAssetsWorkflow`/`rotateAssetsWorkflow` (disjoint verbs → order is free; group for
  readability). Add an ordering comment.
- `manifest.mjs`: two entries (`flow: 'hybrid'`, `planTool: 'proposeAssetBatchFromSelection'`,
  `requiredReadTools: ['resolveAssetSearchFilters', 'searchAssets']`, `supportsContinuation:
false`, matrixRow capability "Stack photos" / "Unstack photos", tier "Solid now").
- Regenerate `manifest.generated.json`:
  `node -e "import('./src/strict-workflows/manifest.mjs').then(m=>require('fs').writeFileSync('./src/strict-workflows/manifest.generated.json', JSON.stringify(m.WORKFLOW_MANIFEST,null,2)+'\n'))"`
  (run from `agent-runner/`).
- If `disambiguation.test.mjs` has a "every kind appears" gate, add routing cases for the two
  new kinds (G1 hit this).

### B4. eval scenarios

- `classification-recall.mjs`: `recall.stack.basic` ("stack my 5 newest photos" →
  `stack_assets`), `recall.unstack.basic` ("unstack these photos" → `unstack_assets`).
- `slot-fidelity.mjs`: `slots.stack.source` (source slot fidelity).
- `classification-negatives.mjs`: e.g. `neg.stack.subjective` ("stack the best ones" →
  `none`).
- `l3-readonly.mjs`: `l3.recall.stack` / `l3.recall.unstack` (routing; holds on any stack),
  and `l3.plan.stack` (PROPOSE-ONLY; eval preset is VisualOrganizer which grants
  `manageStacks`, so the plan proposes live — assert `planProposed: SEEDED ? true : undefined`,
  data-dependent on ≥2 owned assets; the read-only audit confirms nothing applied). Document
  that VisualOrganizer grants manageStacks so this is the first NEW op the L3 preset can
  propose-but-never-apply.

## Part C — regen + verify

1. `pnpm -C server build` (compiles; surfaces missing-provider / exhaustiveness errors).
2. `pnpm -C server sync:open-api && make open-api` (new op + batch-action types into the
   SDK + Dart client). Commit the regenerated SDK/spec.
3. `make check-server` (tsc), `make lint-server` (eslint --max-warnings 0).
4. `pnpm -C server test -- --run src/services/agent-operation-plan.service.spec.ts src/services/agent-session.service.spec.ts src/dtos/agent-operation.dto.spec.ts` → GREEN.
5. `cd agent-runner && node --test 'src/**/*.test.mjs'` → GREEN, count up.
6. `make check-web` (the SDK change ripples; should be a no-op for the web but CI runs it).
7. Do NOT run server prettier on `agent-runner/**`. Run server prettier only on the server TS
   files you edited (it is the gate for server code).

## Commit

```bash
git add server/ agent-runner/ open-api/ mobile/openapi/ docs/superpowers/plans/2026-06-05-pi-agent-reorg-sharing-people-slice-2-stacks.md
git commit -m "feat(agent): asset.stack/asset.unstack ops + stack/unstack workflows (G2) + manageStacks scope"
```

## Done when

- Server unit tests green (propose mapping, apply stack/unstack, scope gate, preset snapshot,
  dto parse). Apply stack chooses primary by favorite>rating>newest (proved by 3 fixtures).
- agent-runner suite green; the two workflows route and decline cross-verbs; manifest mirror
  green.
- `pnpm -C server build`, `make check-server`, `make lint-server`, `make check-web` all green.
- OpenAPI/SDK regenerated and committed.

## Out of scope

- `StackService.update` (set primary on an existing stack) — not exposed this slice.
- Removing a single asset from a stack while keeping the rest (we dissolve via deleteAll).
- Matrix `.md` regen — deferred to a consolidated docs step after the server is built in a
  later slice (the agent-runner `manifest.generated.json` mirror is the per-slice gate).
