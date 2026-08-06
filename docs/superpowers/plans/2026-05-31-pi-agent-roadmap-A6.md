# Phase A Slice A6 — visual_cleanup Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `visual_cleanup` so prompts such as "trash my blurry photos from last week" resolve a bounded, quality-filtered source and propose a High-risk reversible `asset.trash` plan.

**Architecture:** `readSelectionMetadata` is sampled, so filtering must happen server-side in `searchAssets`. A6 adds optional quality threshold filters to the agent search surface, then uses the existing source resolver with an `extraFilters` overlay so the returned selection handle already represents the low-quality set.

**Tech Stack:** NestJS/Zod/Kysely/Postgres for server search; Node `node:test` strict workflows; agent-runner L1 eval against the local OpenAI-compatible model.

---

## Task 1: Server `searchAssets` Quality Filters

**Files:**

- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/services/agent-search-filter-mapper.ts`
- Modify: `server/src/repositories/search.repository.ts`
- Modify: `server/src/utils/database.ts`
- Test: `server/src/dtos/agent-tool.dto.spec.ts`
- Test: `server/src/services/agent-search-filter-mapper.spec.ts`
- Test: `server/src/repositories/search.repository.spec.ts`

- [ ] **Step 1: Write DTO RED tests.** In `server/src/dtos/agent-tool.dto.spec.ts`, add tests under `AgentSearchAssetsToolRequestDto` proving `filters.maxSharpness`, `filters.maxBrightness`, and `filters.maxQuality` accept integer `0..100` and reject `-1`/`101`.
      Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run agent-tool.dto.spec`
      Expected: RED with unrecognized filter keys.

- [ ] **Step 2: Write mapper RED test.** In `server/src/services/agent-search-filter-mapper.spec.ts`, extend the deterministic filter test to include `maxSharpness: 30`, `maxBrightness: 25`, and `maxQuality: 40`, and assert those values reach repository options.
      Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run agent-search-filter-mapper.spec`
      Expected: RED because the mapper drops those properties.

- [ ] **Step 3: Write SQL-shape RED test.** In `server/src/repositories/search.repository.spec.ts`, add `searchAssetBuilder quality filter semantics` asserting `buildAssetSearchSql({ maxSharpness: 30, maxBrightness: 25, maxQuality: 40 })` contains one `asset_quality` join and `sharpness <=`, `brightness <=`, and `quality <=` predicates. This proves unscored rows do not match because the query is an inner join.
      Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run search.repository.spec`
      Expected: RED because no `asset_quality` join/predicate exists.

- [ ] **Step 4: Implement minimal server support.**
      Add optional `z.number().int().min(0).max(100)` fields `maxSharpness`, `maxBrightness`, `maxQuality` to `AgentSearchAssetsFilterFields`; mirror them in `AgentSearchAssetsFilters`; pass them through `buildBaseSearch`; add a `SearchQualityOptions` interface to `search.repository.ts` and include it in metadata/smart search option types; in `searchAssetBuilder`, inner-join `asset_quality` and apply `asset_quality.sharpness <=`, `asset_quality.brightness <=`, and `asset_quality.quality <=` when present.

- [ ] **Step 5: Run GREEN server tests.**
      Run:
      `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run agent-tool.dto.spec agent-search-filter-mapper.spec search.repository.spec`
      Expected: PASS.

- [ ] **Step 6: Commit.**
      `git add server/src/dtos/agent-tool.dto.ts server/src/types/agent-tool.types.ts server/src/services/agent-search-filter-mapper.ts server/src/repositories/search.repository.ts server/src/utils/database.ts server/src/dtos/agent-tool.dto.spec.ts server/src/services/agent-search-filter-mapper.spec.ts server/src/repositories/search.repository.spec.ts && git commit -m "feat(server): add agent quality search filters (roadmap A6)"`

## Task 2: Resolver Overlay + visual_cleanup Workflow

**Files:**

- Modify: `agent-runner/src/strict-workflows/asset-source-resolver.mjs`
- Modify: `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`
- Create: `agent-runner/src/strict-workflows/workflows/visual-cleanup.mjs`
- Create: `agent-runner/src/strict-workflows/workflows/visual-cleanup.test.mjs`
- Modify: `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`
- Modify: `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`

- [ ] **Step 1: Write resolver RED test.** In `asset-source-resolver.test.mjs`, add a test that calls `resolveAssetSource({ sourceDescription: 'my newest 20 photos', extraFilters: { maxSharpness: 30 } })` and asserts the `searchAssets` call contains `filters.maxSharpness === 30` plus the normal recency/date filters. Existing calls without `extraFilters` must remain unchanged.
      Run: `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test -- src/strict-workflows/asset-source-resolver.test.mjs`
      Expected: RED because `extraFilters` is ignored.

- [ ] **Step 2: Write workflow RED tests.** Add `visual-cleanup.test.mjs` covering:
  - `match('trash my blurry photos')` -> `qualityMetric: 'sharpness'`, `sourceDescription: 'my photos'`.
  - `match('delete dark photos from last month')` -> `qualityMetric: 'brightness'`.
  - `match('clean up low-quality photos from recent uploads')` -> `qualityMetric: 'quality'`.
  - Plain `trash my newest 20 photos` returns `undefined`.
  - Duplicate cleanup prompts return `undefined`.
  - Subjective `delete the ugly ones` returns `undefined`.
  - Run proposes exactly one High-risk `asset.trash` using `assetSource.selectionHandle`.
  - The `searchAssets` call includes the expected quality threshold (`maxSharpness`, `maxBrightness`, or `maxQuality`) and no raw `assetIds`.
  - Empty matches return `needs_input` and do not propose.
    Run: `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test -- src/strict-workflows/workflows/visual-cleanup.test.mjs`
    Expected: RED because the file/workflow does not exist.

- [ ] **Step 3: Implement resolver overlay.** Change `resolveAssetSource({ client, sourceDescription, signal, now = new Date(), extraFilters = {} })` and merge `extraFilters` after normal filters/resolved filters are built, before `hasFilters`.

- [ ] **Step 4: Implement workflow.** Create `visual-cleanup.mjs` modeled on `trash-assets.mjs`. Use thresholds `maxSharpness: 35` for blurry, `maxBrightness: 30` for dark/poor light, and `maxQuality: 40` for low-quality. Require a quality keyword plus trash/delete/cleanup verb. Run `resolveAssetSource` with the threshold overlay and propose `asset.trash` via `proposeAlbumOperations`.

- [ ] **Step 5: Update contract fixtures.** Add `maxSharpness`, `maxBrightness`, and `maxQuality` to known search filter validation in `contract-fixtures.mjs`; add a fixture test proving quality filters are accepted.

- [ ] **Step 6: Run GREEN workflow tests.**
      Run:
      `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test -- src/strict-workflows/asset-source-resolver.test.mjs src/strict-workflows/workflows/visual-cleanup.test.mjs src/strict-workflows/workflows/contract-fixtures.test.mjs`
      Expected: PASS.

- [ ] **Step 7: Commit.**
      `git add agent-runner/src/strict-workflows/asset-source-resolver.mjs agent-runner/src/strict-workflows/asset-source-resolver.test.mjs agent-runner/src/strict-workflows/workflows/visual-cleanup.mjs agent-runner/src/strict-workflows/workflows/visual-cleanup.test.mjs agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs && git commit -m "feat(agent): add visual_cleanup workflow (roadmap A6)"`

## Task 3: Register Workflow, Manifest, Matrix Row, and L1

**Files:**

- Modify: `agent-runner/src/strict-workflows/registry.mjs`
- Modify: `agent-runner/src/strict-workflows/manifest.mjs`
- Generate: `agent-runner/src/strict-workflows/manifest.generated.json`
- Modify: `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`
- Modify: `server/src/services/agent-capability-matrix.spec.ts`
- Modify: `agent-runner/eval/scenarios/classification-recall.mjs`
- Modify: `agent-runner/eval/scenarios/classification-negatives.mjs`
- Generate: `agent-runner/eval/baseline.json`

- [ ] **Step 1: Write registry/manifest RED tests.** Add assertions to existing manifest/registry tests that `visual_cleanup` is present, uses flow `hybrid`, requires `resolveAssetSearchFilters` and `searchAssets`, plans with `proposeAlbumOperations`, and comes before `trash_assets` in regex routing for "trash my blurry photos".
      Run: `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test -- src/strict-workflows/manifest.test.mjs src/strict-workflows/classifier.test.mjs`
      Expected: RED because the workflow is not registered.

- [ ] **Step 2: Register workflow.** Import and place `visualCleanupWorkflow` after `cleanupDuplicatesWorkflow` and before `trashAssetsWorkflow` in `WORKFLOW_FACTORIES`. Add a manifest entry with capability `Visual cleanup`, tier `Constrained now` for A6 (A7 moves it), and Flow Ownership row text describing quality-filtered source -> `asset.trash`.

- [ ] **Step 3: Add L1 scenarios.** Add recall prompts "trash my blurry photos" and "delete dark photos from my recent uploads" expecting `visual_cleanup`. Add negatives proving "trash my newest 20 photos" remains `trash_assets` and "trash duplicate photos" remains `cleanup_duplicates`.

- [ ] **Step 4: Regenerate generated artifacts.**
      Run:
      `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner node src/bin/sync-strict-workflow-manifest.mjs`
      `/opt/homebrew/bin/mise exec -- pnpm -C server build`
      `/opt/homebrew/bin/mise exec -- pnpm -C server sync:agent-capabilities`
      Expected: `manifest.generated.json` and the capability matrix generated workflow block update.

- [ ] **Step 5: Run L1 and accept baseline.**
      Run:
      `/opt/homebrew/bin/mise exec -- node --env-file-if-exists=.env agent-runner/eval/run.mjs --runs 5`
      `/opt/homebrew/bin/mise exec -- node --env-file-if-exists=.env agent-runner/eval/run.mjs --accept`
      Expected: 100% pass, `agent-runner/eval/baseline.json` re-seeded.

- [ ] **Step 6: Run GREEN registration/docs tests.**
      Run:
      `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test -- src/strict-workflows/manifest.test.mjs src/strict-workflows/classifier.test.mjs`
      `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run agent-capability-matrix.spec`
      Expected: PASS.

- [ ] **Step 7: Commit.**
      `git add agent-runner/src/strict-workflows/registry.mjs agent-runner/src/strict-workflows/manifest.mjs agent-runner/src/strict-workflows/manifest.generated.json docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md server/src/services/agent-capability-matrix.spec.ts agent-runner/eval/scenarios/classification-recall.mjs agent-runner/eval/scenarios/classification-negatives.mjs agent-runner/eval/baseline.json && git commit -m "chore(agent): register visual_cleanup and L1 baseline (roadmap A6)"`

## Task 4: API/SQL Regeneration and A6 Verification

**Files:**

- Generated: `open-api/immich-openapi-specs.json`
- Generated: `open-api/typescript-sdk/src/fetch-client.ts`
- Generated: `mobile/openapi/**`
- Generated: `server/src/queries/*.sql`

- [ ] **Step 1: Regenerate API + SQL.**
      Run:
      `/opt/homebrew/bin/mise exec -- pnpm -C server build`
      `/opt/homebrew/bin/mise exec -- pnpm sync:open-api`
      `/opt/homebrew/bin/mise exec -- make open-api`
      `/opt/homebrew/bin/mise exec -- pnpm --filter immich sync:sql`
      Expected: generated OpenAPI/SDK and SQL files include the new quality filters.

- [ ] **Step 2: Format changed packages.**
      Run:
      `/opt/homebrew/bin/mise exec -- pnpm -C server prettier --write .`
      `/opt/homebrew/bin/mise exec -- pnpm --filter=immich-i18n format:fix`
      Expected: no prettier/i18n drift remains.

- [ ] **Step 3: Full A6 gates.**
      Run:
      `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run agent-tool.dto.spec agent-search-filter-mapper.spec search.repository.spec agent-capability-matrix.spec`
      `/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test`
      `/opt/homebrew/bin/mise exec -- make lint-server && /opt/homebrew/bin/mise exec -- make check-server && /opt/homebrew/bin/mise exec -- make check-web`
      Expected: PASS.

- [ ] **Step 4: Commit regen/format fixes.**
      `git add open-api mobile server/src/queries server agent-runner docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md && git commit -m "chore(api): regen quality search filter contracts (roadmap A6)"`

## Edge Cases Covered

- Unscored assets do not match quality filters because `searchAssetBuilder` uses an inner `asset_quality` join for threshold predicates.
- Quality filters compose with existing date/entity/recency filters and shared-space scoping.
- Plain trash and duplicate-cleanup prompts keep routing to their existing workflows.
- Subjective visual cleanup without an objective quality metric is declined/handoff.
- Empty quality-filtered matches produce no plan.
