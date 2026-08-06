# Pi Agent Trash + Duplicate Cleanup Design

Status: ready for impl-loop
Date: 2026-05-31
Branch: `explore/pi-agent-brainstorm` (PR #574)
Builds on: Phase 1–3 strict/hybrid workflows + the agent operation-plan apply path.

## How To Use This Spec

Written for `/impl-loop`. Every slice is planned, TDD-implemented, committed, and
pushed independently. Treat earlier slices as a completed baseline.

**TDD is mandatory.** No production code before a failing test:

1. Write the listed failing tests first.
2. Run them and confirm the **expected red** failure (assert on the real error).
3. Implement the smallest change that makes them green.
4. Run the full relevant suite and confirm **green** with no regressions.
5. Refactor under green.
6. Commit with the slice tag, then push.

A slice is done when its new tests are green, the **full** `server` unit suite is
green (when server files changed), the **full** `agent-runner` unit suite is green
(when agent-runner files changed), the L1 eval baseline is still 100% (re-seed in
the same slice if routing changed), and OpenAPI/SDK are regenerated when DTOs
change.

This is a **destructive** feature. Two hard rules apply to every slice:

- **Reversible only.** The agent may move assets to Trash (recoverable), never
  hard-delete. `force` is always `false`.
- **No L3 apply.** L3 runs against the real personal library; trash scenarios
  **propose** a plan and are verified by the read-only audit (no plan applied).
  Never apply a trash plan from an eval.

Commands (pnpm/node are not on PATH — use mise):

```bash
/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run src/services/agent-operation-plan.service.spec.ts
/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test
/opt/homebrew/bin/mise exec -- node --env-file-if-exists=.env agent-runner/eval/run.mjs --runs 5
/opt/homebrew/bin/mise exec -- pnpm -C server build && /opt/homebrew/bin/mise exec -- pnpm sync:open-api   # after DTO changes
/opt/homebrew/bin/mise exec -- pnpm -C server build && /opt/homebrew/bin/mise exec -- pnpm -C server sync:agent-capabilities  # matrix block
```

## Purpose

The agent can organize, tag, album, and archive — but it cannot **remove** a
photo. "Delete all my screenshots", "trash these blurry shots", and duplicate
cleanup all route to `none` today. Removal is the single missing verb and the
largest functional gap in the capability matrix's "Needs New MCP Tool" section.

This design adds a **reversible, plan-gated trash** capability and the
**duplicate-cleanup** workflow it unblocks:

1. **`asset.trash` operation + `trash_assets` workflow** — move a resolved
   selection to the recoverable Trash via the existing soft-delete path. Plan-
   reviewed, High risk, write-scope gated, never hard-delete.
2. **Duplicate cleanup** (follow-on) — a `listDuplicateGroups` read tool over the
   already-built duplicate detection, plus a `cleanup_duplicates` workflow that
   keeps one asset per group (deterministic rule) and proposes trashing the rest.

## Current State (Grounded)

Verified in the codebase on 2026-05-31. Re-verify any **Open Contract Question**
at its slice.

### Trash building blocks (all exist)

- **Soft-delete is reversible.** `AssetService.deleteAll(auth, { ids, force })`
  (`server/src/services/asset.service.ts:477`) sets
  `status: force ? AssetStatus.Deleted : AssetStatus.Trashed`, requires
  `Permission.AssetDelete`, and emits `AssetTrashAll` (vs `AssetDeleteAll`).
  `force: false` → recoverable Trash. `TrashService` handles restore/empty.
- **Operation apply** dispatches in `AgentOperationPlanService.applySingleOperation`
  (`agent-operation-plan.service.ts:2531`); asset-batch ops mutate via
  `this.assetService.<method>(auth, { ids: operation.assetIds, … })`
  (e.g. AssetSetArchive at `:2730`). A new case calls
  `this.assetService.deleteAll(auth, { ids: operation.assetIds, force: false })`.
- **Risk levels** `AgentOperationRiskLevel` = `Low | Medium | High`
  (`enum.ts:192`), assigned per-op-type at plan build (`agent-operation-plan.service.ts:297-451`).
- **Write-scope gating** `validateWriteScope(session, type)`
  (`agent-operation-plan.service.ts:1873`) maps each op type to a boolean flag in
  the write-scope schema (`agent-session.dto.ts:34-64`: `removeAssets`,
  `favoriteAssets`, `archiveAssets`, `tagAssets`, … all default `false`). Presets
  grant flags; an ungranted op throws before any mutation.
- **Operation DTOs** live in `agent-operation.dto.ts`; `removeTagOperationSchema`
  (`:586`) is the closest template — an asset-batch operation
  (`...assetBatchBase`, `targetKind: asset_batch`, `validateAssetSelection` +
  `validateStandaloneTarget(AssetBatch)`).
- **MCP operation contract / examples** registered in
  `agent-mcp-tool-contract.service.ts` (per-op examples, `:1244+`); the agent-
  runner contract fixture lists `KNOWN_OPERATION_TYPES`
  (`agent-runner/.../contract-fixtures.mjs`).

### Duplicate building blocks (Phase C)

- `DuplicateService.getDuplicates(auth)` (`duplicate.service.ts:69`) returns
  `DuplicateResponseDto[]` — `{ duplicateId, assets[] }` groups from CLIP-
  embedding detection. `Permission.DuplicateDelete` already exists.

## Scope

In scope:

- New reversible `asset.trash` operation (server) + `trash_assets` hybrid workflow.
- New `trashAssets` write-scope flag, default `false`, preset-gated.
- `listDuplicateGroups` MCP read tool + `cleanup_duplicates` workflow (follow-on).
- L1/L2/L3 coverage; capability-matrix move from "Needs New MCP Tool" → "Solid now".

## Non-Goals

- **No hard delete / permanent deletion.** `force` is always `false`.
- **No "empty trash"** (irreversible) and **no restore-from-trash** via the agent
  in v1 (restore is safe but out of scope; revisit later).
- No quality scoring, crop/enhance, geocoding, sharing (other matrix rows).
- No auto-apply: every trash is a reviewed, High-risk plan.
- No bypass of `Permission.AssetDelete` or the write-scope gate.

## Safety Model

1. **Reversible.** Only `deleteAll(force: false)` → Trash. Assets are restorable.
2. **Plan-gated.** Trash is always a reviewable operation plan; never a direct
   tool mutation (the universal agent invariant).
3. **High risk.** `asset.trash` is assigned `AgentOperationRiskLevel.High` at plan
   build, so the plan-review UI can style it as destructive.
4. **Write-scope gated.** `validateWriteScope` blocks `asset.trash` unless the
   session's `trashAssets` flag is granted. Default `false`. **Decision:** grant
   `trashAssets` in **VisualOrganizer** and **LocalPowerUser** (consistent with
   those presets already granting reversible archive + remove-from-album); leave
   it `false` in **Careful**. So trash works in the default personal sessions
   (VisualOrganizer) and the strongest preset, but not the cautious one.
5. **Permission gated.** Apply calls `deleteAll`, which requires
   `Permission.AssetDelete` against the asset ids.
6. **Empty-selection safety.** A resolved selection of zero assets never proposes
   a trash plan (asks for input), mirroring `remove_photos_from_album`.
7. **Subjective decline.** Subjective sources ("the bad ones") hand off; only a
   metadata-bounded selection is trashed.
8. **Eval never applies.** L3 trash scenarios are propose-only; the read-only
   audit must show no plan applied.

## Flow Ownership Additions

| Capability                | Flow                          | Owns (deterministic)                                                                                                   | Hands off / asks                                                                                                       |
| ------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Trash photos (reversible) | Hybrid (`trash_assets`)       | "trash/delete/remove `<source>`", "move `<source>` to trash" over a resolver-bounded source                            | Subjective source → handoff; empty selection → needs_input; trashAssets scope ungranted → blocked with a clear message |
| Duplicate cleanup         | Hybrid (`cleanup_duplicates`) | "clean up / remove duplicates", "find and trash duplicate photos" — keep one per group (deterministic), trash the rest | No duplicate groups → direct answer; ambiguous "which to keep" → use the deterministic rule and disclose it            |

## Architecture

### `asset.trash` operation (server)

A new asset-batch operation, mirroring `removeTagOperationSchema` but with **no
payload** and **High** default risk:

```
trashOperationSchema = strictObject({
  type: literal(AssetTrash),          // 'asset.trash'
  ...assetBatchBase,                  // summary, targetKind, assetSelection, enabled
  riskLevel: AgentOperationRiskLevelSchema.optional().default(High),
}).superRefine(validateAssetSelection + validateStandaloneTarget(AssetBatch))
```

- Enum: `AgentOperationType.AssetTrash = 'asset.trash'` (`enum.ts`).
- Plan build (`agent-operation-plan.service.ts`): assign `riskLevel: High` for
  `AssetTrash` and call `validateWriteScope(session, AssetTrash)`.
- `validateWriteScope`: `if (type === AssetTrash && !writeScope.trashAssets) throw`.
- Write-scope schema (`agent-session.dto.ts`): add `trashAssets: z.boolean()` +
  default `false`; the preset map (`agent-session.service.ts` `permissionPresets`)
  grants `trashAssets: true` in **VisualOrganizer** and **LocalPowerUser**, and
  leaves it `false` in **Careful** (and the legacy/default write-scope).
- Apply (`applySingleOperation`): `await this.assetService.deleteAll(auth, { ids: operation.assetIds, force: false }); return this.appliedOperation(operation.id, { assetIds: operation.assetIds });`
- MCP contract: register an `asset.trash` example + the op type.

### `trash_assets` workflow (agent-runner)

Mirror of `untag_assets`/`archive_assets` but proposing a trash operation:

```
match: "trash|delete|remove|bin <source>", "move <source> to (the) trash|bin",
       "put <source> in the trash"  (NOT "remove <photos> from <album/space>")
run:   resolveAssetSource(source)  → handoff/needs_input/empty handled
       → proposeAlbumOperations({ summary, operations: [{
           type:'asset.trash', summary, targetKind:'asset_batch',
           assetSource:{kind:'selectionHandle', selectionHandleId}, riskLevel:'high' }] })
       → gatePlanResult (success copy says "move N photos to Trash (recoverable)")
```

Registry order: before `remove_photos_from_album` and `archive_assets`-adjacent;
the "trash/bin/move to trash" verbs are distinct, but "remove `<source>`" must not
steal "remove `<photos>` from `<album>`" (require trash/bin/delete keyword or a
bare source with no "from `<album/space>`").

### `cleanup_duplicates` workflow + `listDuplicateGroups` (Phase C)

- `listDuplicateGroups` MCP read tool wraps `DuplicateService.getDuplicates` →
  returns scrubbed groups (`duplicateId`, asset summaries: id, fileName,
  fileCreatedAt, isFavorite, rating, resolution) for the agent to rank.
- `cleanup_duplicates` workflow: call `listDuplicateGroups` → for each group pick
  the **keeper** by a deterministic rule (favorite > higher rating > larger
  resolution > older `fileCreatedAt` > lexicographic id) → collect the non-keepers
  → propose one `asset.trash` over the explicit non-keeper `assetIds` → gate.
  Discloses the keep rule in the summary. No groups → direct answer, no plan.

## Open Contract Questions

| #   | Question                                                                                                                                                                                                                  | Pinned to | Fallback                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------- |
| OQ1 | RESOLVED: grant `trashAssets` in `permissionPresets` for **VisualOrganizer** + **LocalPowerUser**; `false` in **Careful** + legacy default. Confirm the exact `agent-session.service.ts` mapping shape at implementation. | Slice 1   | —                                                                |
| OQ2 | Exact `validateWriteScope` insertion + the per-op risk-level assignment site for `AssetTrash`.                                                                                                                            | Slice 1   | Mirror `AssetSetArchive` wiring, override risk to High           |
| OQ3 | The MCP operation-contract example shape for `asset.trash` (and whether the capability/risk surface needs a destructive flag).                                                                                            | Slice 2   | Mirror the `asset.setArchive` contract entry with riskLevel High |
| OQ4 | Does the agent apply path enforce `Permission.AssetDelete` for the session user, and how are non-deletable assets reported (partial result)?                                                                              | Slice 1   | Surface a partial/blocked result like other bulk ops             |
| OQ5 | `getDuplicates` response shape + the per-asset fields available for the keep rule (resolution? rating? favorite?).                                                                                                        | Slice 5   | Read only guaranteed fields; fall back to fileCreatedAt + id     |
| OQ6 | RESOLVED by OQ1: the L3/eval preset is VisualOrganizer, which now grants `trashAssets`, so the L3 trash plan can **propose live** (read-only audit must still show no apply). Confirm the eval preset at Slice 7.         | Slice 7   | Gate plan `SEEDED` if the live preset differs                    |

## Coverage By Eval Layer

- **L1**: `trash_assets` and `cleanup_duplicates` routing positives + the
  disambiguation negatives (trash must not steal album/space removals; "remove the
  Travel tag" stays `untag_assets`). Re-seed `baseline.json` if routing changes.
- **L2**: server unit tests for the schema, write-scope gate, risk level, and the
  apply→`deleteAll(force:false)` mapping (assert `force:false`, never `true`);
  agent-runner `match`/`parseSlots`/`run` + a `validateAssetTrash` contract
  fixture; `cleanup_duplicates` keep-rule unit tests.
- **L3**: routing for both; a **propose-only** trash plan gated
  `planProposed: SEEDED ? true : undefined` and proven by the read-only audit
  (no plan applied). OQ6 decides whether the live preset grants `trashAssets`.

## Slices

### Slice 1 — Server: `asset.trash` operation (schema + gating + risk + apply)

Goal: a complete, reversible, gated trash operation server-side.

Files: `server/src/enum.ts`, `server/src/dtos/agent-operation.dto.ts`,
`server/src/dtos/agent-session.dto.ts` (+ types), `server/src/services/agent-operation-plan.service.ts`
(+ `.spec.ts`), `server/src/services/agent-session.service.ts` (preset grant, OQ1).
Resolve OQ1/OQ2/OQ4 first by reading the write-scope/risk/preset code.

TDD tests (server unit):

- `trashOperationSchema` parses a valid trash op (`asset_batch`, selection, no
  payload, default `riskLevel: High`); rejects a `payload`, a `targetId`, zero or
  multiple asset-selection mechanisms, wrong `targetKind`.
- Plan build assigns `riskLevel: High` to `asset.trash`.
- `validateWriteScope` THROWS for `asset.trash` when `trashAssets` is `false`;
  passes when granted.
- Write-scope schema default `trashAssets: false`; the chosen higher-trust preset
  grants it; the default/visual-organizer preset does NOT (OQ1).
- Apply: `applySingleOperation(asset.trash)` calls
  `assetService.deleteAll(auth, { ids, force: false })` — assert `force: false`
  (a guard test asserting `force` is never `true` from this path), returns an
  applied result. Mock `assetService`.
- Apply enforces `Permission.AssetDelete` (or surfaces the block) — OQ4.

Edge cases: empty `assetIds` rejected by the schema/selection rules; a mix of
deletable + non-deletable assets reports a partial result (no throw); High risk
survives a revise.

Exit: server unit suite green; OpenAPI/SDK regenerated (write-scope + op-type DTO
changed): `pnpm -C server build && pnpm sync:open-api && make open-api`.

### Slice 2 — Server: MCP contract + agent-runner fixture

Goal: expose `asset.trash` to the model + the contract fixture.

Files: `agent-mcp-tool-contract.service.ts` (+ `.spec.ts`),
`agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs` (+ `.test.mjs`).
Resolve OQ3.

TDD tests:

- The MCP operation contract includes an `asset.trash` example (riskLevel High,
  reversible language) and the type appears in the exposed operation list; a
  malformed trash call returns an actionable correction hint.
- Contract fixture: `'asset.trash'` in `KNOWN_OPERATION_TYPES`; `validateAssetTrash`
  accepts a valid op and rejects payload/targetId/wrong-target/bad-selection.

Exit: server + agent-runner unit suites green.

### Slice 3 — Agent-runner: `trash_assets` workflow

Goal: route + propose a reversible trash plan.

Files: new `workflows/trash-assets.mjs` (+ `.test.mjs`), `registry.mjs`,
`manifest.mjs` (+ mirror), capability-matrix generated-block regen.

TDD tests:

- `match` accepts: "trash my newest 20 photos", "move my screenshots to the trash",
  "delete the blurry photos from last weekend" (source bounded), "bin my newest 50".
- `match` rejects so neighbors win: "remove my newest 20 from the Italy album"
  (→ remove_photos_from_album), "remove the Travel tag from my newest 20"
  (→ untag_assets), "delete the Family album" (album-level, not asset trash → none/handoff),
  subjective "trash the bad ones" (→ handoff).
- `run`: resolves source → proposes one `asset.trash` op (asset_batch,
  selectionHandle, riskLevel high) → gated; success copy states the count and
  "Trash (recoverable)". Empty selection → needs_input. Resolver
  needs_input/handoff/empty propagated. Plan-tool failure → failed.
- `manifest` entry: `matrixRow.capability: 'Trash photos'` (matches a Flow
  Ownership row added in Slice 7), `requiredReadTools`, `planTool:'proposeAlbumOperations'`.

Exit: agent-runner suite green; manifest mirror + matrix generated block
regenerated; server matrix spec green.

### Slice 4 — `trash_assets` L1 scenarios + baseline

- Recall: "trash my newest 20 photos" → `trash_assets`; slot fidelity for the
  source. Negatives preserved (album/space removals, tag removal).
- Run L1 `--runs 5`; re-seed `baseline.json` to 100%; re-check no neighbor
  regressions.

### Slice 5 — Server: `listDuplicateGroups` MCP read tool

Goal: expose the existing duplicate detection as a scrubbed read tool. Resolve OQ5.

Files: `agent-tool.dto.ts` (request/response), `agent-tool.service.ts`
(`listDuplicateGroups` over `getDuplicates`), `agent-mcp-tool-registry.service.ts`,
specs. OpenAPI/SDK regen.

TDD tests: returns groups with the keep-rule fields (id, fileName, fileCreatedAt,
isFavorite, rating, resolution where available); respects read permission; empty
when no duplicates; registered as an MCP read tool.

### Slice 6 — Agent-runner: `cleanup_duplicates` workflow

Goal: deterministic keep-best, trash-the-rest plan.

Files: new `workflows/cleanup-duplicates.mjs` (+ `.test.mjs`), `contract-fixtures.mjs`
(`listDuplicateGroups` handler), `registry.mjs`, `manifest.mjs` (+ mirror), matrix.

TDD tests:

- `match`: "clean up duplicates", "find and remove duplicate photos", "trash
  duplicates". Rejects unrelated.
- Keep rule: favorite > higher rating > larger resolution > older fileCreatedAt >
  id; one keeper per group; non-keepers collected. Unit-test the rule on crafted
  groups (ties resolved deterministically).
- `run`: `listDuplicateGroups` → propose one `asset.trash` over the explicit
  non-keeper `assetIds` (NOT a broad source) → gate; summary discloses the keep
  rule + counts. No groups → direct answer, no plan. Every group size 1 → no plan.
- L1 recall + baseline re-seed.

### Slice 7 — Hardening: disambiguation + L3 + matrix + RC + CI

- Disambiguation sweep: `trash_assets` and `cleanup_duplicates` route correctly
  and do not steal album/space/tag removals.
- L3 (live, **propose-only**): `l3.recall.trash` routing; `l3.plan.trash.recency`
  gated `SEEDED ? true : undefined` (propose-only, read-only audit must show no
  apply); `l3.recall.duplicates` routing. OQ6: if the live preset lacks
  `trashAssets`, assert the write-scope-block message instead of a plan.
- Capability matrix: move "Trash/delete" and "Duplicate/similar-photo cleanup"
  out of "Needs New MCP Tool"; add Flow Ownership rows ("Trash photos" Hybrid,
  "Duplicate cleanup" Hybrid); update the operation-types list (`asset.trash`);
  keep `agent-capability-matrix.spec.ts` green; regen the generated block;
  prettier the doc.
- Build an RC, pin personal (leave on the RC), run the full L3 (propose-only),
  re-seed `baseline.l3.json`.
- Branch CI green (Docs, Revert-to-Immich, Lint/Test Server, SQL Schema, OpenAPI
  Clients — the new DTOs make OpenAPI regen mandatory). `babysit-codex` until green.

## Edge Case Coverage Checklist

| Edge case                                    | Required behavior                                                   | Slice |
| -------------------------------------------- | ------------------------------------------------------------------- | ----- |
| Hard delete requested ("permanently delete") | Trash only; never `force:true`; disclose recoverable Trash          | 1, 3  |
| `trashAssets` scope ungranted                | Block with a clear "not permitted in this session" message; no plan | 1, 3  |
| Empty resolved selection                     | needs_input; no trash plan                                          | 3     |
| Subjective source ("the bad ones")           | handoff                                                             | 3     |
| "remove `<photos>` from `<album>`"           | remove_photos_from_album, not trash                                 | 3, 7  |
| "remove the `<tag>` tag"                     | untag_assets, not trash                                             | 3, 7  |
| Partial deletable set (some not permitted)   | partial result; no throw                                            | 1     |
| No duplicate groups                          | direct answer; no plan                                              | 6     |
| Duplicate group of size 1                    | skip; never trash a lone asset                                      | 6     |
| Keep-rule ties                               | deterministic tiebreak (resolution→date→id)                         | 6     |
| L3 trash                                     | propose only; read-only audit shows no apply                        | 7     |

## Acceptance Criteria

- Reversible `asset.trash` op: schema + High risk + `trashAssets` write-scope gate
  - apply via `deleteAll(force:false)`; never hard-deletes; `Permission.AssetDelete`
    enforced.
- `trash_assets` + `cleanup_duplicates` workflows with full `match`/`parseSlots`/
  `run` + contract fixtures.
- `listDuplicateGroups` MCP read tool over the existing detection.
- Full server + agent-runner unit suites green; L1 100%; L3 audits clean
  (propose-only, no apply); capability-matrix spec green; OpenAPI/SDK regenerated.
- Capability matrix reflects trash + duplicate cleanup as supported (out of
  "Needs New MCP Tool"); operation-types list includes `asset.trash`.
- No hard delete, no empty-trash, no agent restore in v1.

## Future Work

- Restore-from-trash and "empty trash" workflows (with stronger confirmation).
- Quality scoring (`analyzeAssetQuality`) to improve the duplicate keep rule and
  enable visual cleanup.
- Forward geocoding (place name → coordinates) for metadata location edits.
