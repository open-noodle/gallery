# Phase C — Restore from trash — impl-loop plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-capability-roadmap.md` (Phase C).
Branch: `explore/pi-agent-brainstorm`. Mirrors the shipped `asset.trash` op + `trash_assets` workflow.

## Autonomous decisions (OQ)

- **OQ-C1.** The agent `searchAssets` filter has **no `isTrashed`** today (verified); the asset repo supports
  trashed/`withDeleted` internally. Decision: **add `isTrashed?: boolean`** to the agent searchAssets filter,
  default excludes trashed; resolver maps "trashed"/"in the trash"/"in trash"/"from trash" → `isTrashed:true`.
- **OQ-C2.** Restore is non-destructive → **Low** risk; **reuse the `trashAssets` write-scope** (no new flag).

## Integration map (verified)

- Trash op template `asset.trash`: enum `server/src/enum.ts:182` (AssetTrash); schema `agent-operation.dto.ts:597-607`
  (`trashOperationSchema`, `assetBatchBase:393-401`, union `:641`); `validateWriteScope` `agent-operation-plan.service.ts:1948`;
  `requiresWritableAssets` `:1085-1094`; apply case `:2772-2775` (`assetService.deleteAll force:false`); risk High.
- Restore service: `trash.service.ts:12` `restoreAssets(auth, BulkIdsDto)`, `Permission.AssetDelete`.
- Agent searchAssets filter DTO: `server/src/dtos/agent-tool.dto.ts` (`make` at `:340`; add `isTrashed` near it).
  Asset repo supports trashed via `isTrashed`/status guard (`asset.repository.ts:66,81,1544-1545,1719`).
- Workflow template `trash-assets.mjs` (KIND `:11`, hybrid `:34`, match → resolve → `proposeAlbumOperations` type
  `asset.trash`). Contract: `contract-fixtures.mjs` `KNOWN_OPERATION_TYPES:13-33` (has `asset.trash`, not restore).
  Registry `registry.mjs` import `:16`, array `:69`, ordering comments `:49-56`. Manifest `manifest.mjs:297-331`.

## Slice C1 — `isTrashed` agent search filter (server, TDD)

**Tests first** (`agent-tool.service.spec.ts` + medium `asset.repository` if needed):

- searchAssets handler with `isTrashed:true` passes the trashed option to the asset repo (assert the repo search
  arg includes the trashed/withDeleted flag); default (omitted/false) excludes trashed (regression).
- (medium, if the repo path isn't already covered) a trashed asset is returned only when `isTrashed:true`.
- Resolver token: in agent-runner `asset-source-resolver.test.mjs`, "my trashed photos" / "photos in the trash"
  → resolved filter carries `isTrashed:true`. (Resolver work can also live in C3; keep the server filter here.)

**Implement:** add `isTrashed: z.boolean().optional()` to the agent searchAssets filter schema in
`agent-tool.dto.ts`; thread it through the searchAssets handler into the asset repo search options (set the repo's
`isTrashed`/`withDeleted` so trashed assets are included only when true). OpenAPI/SDK regen; `make check-web`
(new optional filter field — update web fixtures/exhaustive maps + i18n if the field surfaces). Edge cases:
combined with date ("trashed last week"); no trashed → empty; default never leaks trashed into normal searches.

Gates: `make lint-server check-server check-web`; server unit + (medium if added) green; SDK regen.
Commit `feat(agent): isTrashed search filter for trashed-asset sources (C1)`; push.

## Slice C2 — `asset.restore` operation (server, TDD)

**Tests first** (`agent-operation.dto.spec.ts` mirroring the `asset.trash operation schema` describe block +
`agent-operation-plan.service.spec.ts` for apply/scope):

- accepts a valid `asset.restore` (no payload, asset_batch target, default **Low** risk).
- rejects: payload field present; targetId present; wrong targetKind; no asset selection; multiple selection
  mechanisms (mirror the trash describe cases exactly).
- apply calls `trashService.restoreAssets(auth, { ids })` with the resolved ids; returns appliedOperation.
- write-scope: rejected unless `writeScope.trashAssets` (reuse); `requiresWritableAssets` includes restore.
- Low risk asserted.

**Implement:** enum `AgentOperationType.AssetRestore='asset.restore'`; `restoreOperationSchema` (strictObject,
literal type, `...assetBatchBase`, riskLevel default **Low**, superRefine `validateStandaloneTarget(...AssetBatch,
AssetRestore)`); add to `AgentGalleryOperationInputSchema` union; `validateWriteScope` reuse `trashAssets`;
`requiresWritableAssets` add restore; apply `case AssetRestore`: inject `TrashService` into
`agent-operation-plan.service` (constructor) and call `restoreAssets(auth, { ids })`. Add restore to the operation
contract/docs + the SDK enum (`AssetRestore = "asset.restore"` — see `agent-session.dto.spec.ts:353` pattern for
the trash/rotate enum SDK assertion; add the restore equivalent). OpenAPI/SDK regen; `make check-web` (new op type
ripples into web operation-rendering exhaustive maps + i18n — mirror what `asset.trash` needed). Edge cases:
restoring a non-trashed asset (service no-op/partial — assert it doesn't throw the whole plan); permission gap → partial.

Gates: `make lint-server check-server check-web`; server unit green; SDK regen.
Commit `feat(agent): asset.restore reversible operation (C2)`; push.

## Slice C3 — `restore_assets` workflow (agent-runner, TDD) + matrix + L1

**Tests first** (`restore-assets.test.mjs` mirroring `trash-assets.test.mjs`):

- match accepts "restore my newest 20 from trash", "recover the photos I just trashed", "untag"→NO, "untrash
  these", "get my photos back from the trash"; rejects non-restore phrasings.
- run resolves an `isTrashed` source and proposes `asset.restore` (type asset.restore, asset_batch, Low risk).
- empty selection → needs_input; nothing in trash → direct answer/needs_input; subjective source → handoff.
- resolver: "my trashed photos" resolves with `isTrashed:true` (the C1 token) — add to
  `asset-source-resolver.mjs` if not done in C1.

**Implement:** `restore-assets.mjs` (KIND `restore_assets`, hybrid) mirroring trash; register in `registry.mjs`
(import + array, placed adjacent to trash with an ordering comment); add `'asset.restore'` to
`KNOWN_OPERATION_TYPES` (`contract-fixtures.mjs`) + a `validateAssetRestore` fixture; add a `manifest.mjs` entry
(kind, flow hybrid, title, classifierDescription, positive/negative examples, requiredReadTools incl
resolveAssetSearchFilters+searchAssets, planTool proposeAlbumOperations, supportsContinuation false,
matrixRow {capability:'Restore from trash', tier, workflowOrBoundary}); regen `manifest.generated.json` via
`node src/bin/sync-strict-workflow-manifest.mjs`. Capability matrix: add the "Restore from trash" capability row +
Flow Ownership row to `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md` (the matrixRow.capability
string MUST appear there) and regen the generated block via `pnpm --dir server sync:agent-capabilities`; keep
`agent-capability-matrix.spec.ts` green (add a coverage assertion if the trash/restore section warrants).
**L1:** recall "restore my trashed photos"/"recover what I just trashed" → `restore_assets`; negatives (must not
steal `trash_assets` or `untag_assets`). Run `node eval/run.mjs --runs 5`, re-seed `--accept`, confirm 100%.

NOTE: agent-runner/docs are NOT prettier-gated — do NOT run server-prettier on `.mjs`/`.md`; keep single-quote style.

Gates: agent-runner full suite green; L1 100%; `make check-server` (matrix spec) green.
Commit `feat(agent): restore_assets workflow + matrix + L1 (C3)`; push.

## Slice C4 — Hardening: L3 scenarios

Add to `l3-readonly.mjs`: `l3.recall.restore` ("restore my newest 20 from trash" → `restore_assets`) and a
propose-only `l3.plan.restore` (`planProposed: SEEDED ? true : undefined` — needs trashed assets). Single-quote
style. (Live L3 run deferred to the consolidated end-of-roadmap RC.)
Commit `test(agent): restore L3 scenarios (C4)`; push.
