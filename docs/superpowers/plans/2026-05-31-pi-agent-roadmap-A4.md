# Phase A Slice A4 — Agent read exposure of quality scores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Surface the per-asset quality scores (from `asset_quality`) to the Pi agent: `readAssetMetadata` returns a `qualityInfo` block ({sharpness,exposure,brightness,quality}); `listDuplicateGroups` returns per-asset `sharpness` (for A5's keep-rule). Register in the MCP contract; regen OpenAPI/SDK.

**Architecture:** Mirror the existing `rating`/`exifInfo` path. `readAssetMetadata` already joins `asset_exif` via `withAgentExif` → `exifInfo` and maps it through `mapSelectedAssetMetadata` per selected field; add a parallel `withAgentQuality` → `qualityInfo` and a `'quality'` field/case. `listDuplicateGroups` maps `duplicateRepository.getAll()` rows to a scrubbed `AgentDuplicateAsset`; add `sharpness` via a contained `assetRepository.getAssetQualityByIds()` lookup merged in the descriptor (leaves the shared `MapAsset`/`getAll` query untouched). Scrubbing is a field whitelist — quality fields are added explicitly, no blanket dump.

**Decisions (resolved):**

- `readAssetMetadata` exposes all four scores as a nested `qualityInfo` object (parallels `exifInfo`). It is a NEW selectable field `'quality'`, included in the `technical` and `allSafe` detail presets. `searchAssets` is NOT changed — `readAssetMetadata` gets its own extended field-values list.
- `listDuplicateGroups` exposes only `sharpness` (what the keep-rule needs), `null` when unscored.
- These DTOs are in the OpenAPI spec → regen required.

**Grounded integration points:**

- `server/src/dtos/agent-tool.dto.ts`: field values `:57`, schemas `:72`, presets feed `:151-152`; `AgentAssetMetadataResult` `:769-784`; `AgentDuplicateAssetSchema` `:1199-1216`.
- `server/src/services/agent-tool.service.ts`: `readAssetMetadataDescriptor` `:1738`; `getReadAssetMetadataPresetFields` `:3478`; `mapSelectedAssetMetadata` `:3495` (the `rating` case `:3543`); `listDuplicateGroupsDescriptor` `:2035` (per-asset map `:2054-2063`).
- `server/src/repositories/asset.repository.ts`: `withAgentExif` `:270`; `getAgentMetadataByIds` `:921`.
- `server/src/repositories/duplicate.repository.ts`: `getAll` `:36`.
- `server/src/services/agent-mcp-tool-contract.service.ts`: `readAssetMetadata` `:204`, `listDuplicateGroups` `:1076`; contract test `agent-mcp-tool-contract.service.spec.ts`.
- Tests: `server/src/services/agent-tool.service.spec.ts` (readAssetMetadata `~:840-1563`; listDuplicateGroups scrub test `~:7946`).
- Types: `server/src/types/agent-tool.types.ts` (or wherever `AgentAssetMetadata`/`AgentDuplicateAsset`/`AgentAssetMetadataResult` TS types live — confirm and mirror).

---

## Task 1: `readAssetMetadata` exposes `qualityInfo`

**Files:** `agent-tool.dto.ts`, `agent-tool.service.ts`, `asset.repository.ts`, the agent-tool types file, `agent-tool.service.spec.ts`.

- [ ] **Step 1: Failing test** — In `agent-tool.service.spec.ts`, in the readAssetMetadata describe block, add tests:
  - With `detail: 'technical'` (or `fields: ['quality']`), the result includes `qualityInfo: { sharpness, exposure, brightness, quality }` when the asset has a quality row.
  - When the asset has NO quality row, `qualityInfo` is `null` (or omitted) — not an error.
  - Scrubbing preserved: requesting `fields: ['quality']` does NOT leak `exifInfo` or other unrequested fields.
    Mock `assetRepository.getAgentMetadataByIds` to return an asset with a `qualityInfo` object (and one with `qualityInfo: null`). Mirror the existing `rating`/exif tests' mocking style.
    Run: `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run agent-tool.service.spec` → RED (field `'quality'` not accepted / `qualityInfo` not mapped).

- [ ] **Step 2: Field values + presets** — In `agent-tool.dto.ts`:
  - Add a readAssetMetadata-only field list:
    ```ts
    const AgentReadAssetMetadataFieldValues = [...AgentAssetMetadataFieldValues, 'quality'] as const;
    ```
  - Change `AgentAssetMetadataFieldSchema` (line ~72) to `z.enum(AgentReadAssetMetadataFieldValues)`. Leave `AgentSearchAssetsFieldSchema` on `AgentAssetMetadataFieldValues` (searchAssets unchanged).
  - Add a `AgentAssetMetadataQualitySchema = z.object({ sharpness: z.number().int().nullable(), exposure: z.number().int().nullable(), brightness: z.number().int().nullable(), quality: z.number().int().nullable() })` and add `qualityInfo: AgentAssetMetadataQualitySchema.nullable().optional()` to `AgentAssetMetadataResult` (line ~769-784) and to the response schema (line ~927).

- [ ] **Step 3: Preset inclusion** — In `agent-tool.service.ts` `getReadAssetMetadataPresetFields` (:3478): add `'quality'` to the `technical` (:3487) and `allSafe` (:3490) return arrays.

- [ ] **Step 4: Repo join** — In `asset.repository.ts`, add (mirror `withAgentExif` :270):

  ```ts
  function withAgentQuality<O>(qb: SelectQueryBuilder<DB, 'asset', O>) {
    return qb.select((eb) =>
      jsonObjectFrom(
        eb
          .selectFrom('asset_quality')
          .select([
            'asset_quality.sharpness',
            'asset_quality.exposure',
            'asset_quality.brightness',
            'asset_quality.quality',
          ])
          .whereRef('asset_quality.assetId', '=', 'asset.id'),
      ).as('qualityInfo'),
    );
  }
  ```

  In `getAgentMetadataByIds` (:921) add `.$call(withAgentQuality)` after `.$call(withAgentExif)`.

- [ ] **Step 5: Type + mapping** — Add `qualityInfo` to the `AgentAssetMetadata` TS type (the type returned by `getAgentMetadataByIds` / consumed by `mapSelectedAssetMetadata`) and the `AgentAssetMetadataResult` type, both as `{ sharpness: number|null; exposure: number|null; brightness: number|null; quality: number|null } | null`. In `mapSelectedAssetMetadata` (:3495) add a case (mirror `rating` :3543):

  ```ts
  case 'quality': {
    result.qualityInfo = asset.qualityInfo ?? null;
    break;
  }
  ```

  (If the `switch` is exhaustively typed with no `default`, this case is required for tsc.)

- [ ] **Step 6: Green** — Run the readAssetMetadata spec → PASS. Then `/opt/homebrew/bin/mise exec -- make check-server` → clean.

- [ ] **Step 7: Commit** — `git commit -m "feat(server): readAssetMetadata exposes qualityInfo (roadmap A4)"`

---

## Task 2: `listDuplicateGroups` per-asset `sharpness`

**Files:** `asset.repository.ts`, `agent-tool.service.ts`, `agent-tool.dto.ts`, types file, `agent-tool.service.spec.ts`.

- [ ] **Step 1: Failing test** — In `agent-tool.service.spec.ts` listDuplicateGroups block (~:7946): extend the scrub test so each `AgentDuplicateAsset` includes `sharpness` (a number when scored, `null` when not), and assert no other quality field (exposure/brightness/quality) and no exif leak. Mock `duplicateRepository.getAll` as today AND mock the new `assetRepository.getAssetQualityByIds` to return sharpness for some assets, none for others.
      Run the spec → RED.

- [ ] **Step 2: Repo lookup** — In `asset.repository.ts` add:

  ```ts
  @GenerateSql({ params: [[DummyValue.UUID]] })
  getAssetQualityByIds(ids: string[]) {
    return this.db
      .selectFrom('asset_quality')
      .select(['asset_quality.assetId', 'asset_quality.sharpness'])
      .where('asset_quality.assetId', '=', anyUuid(ids))
      .execute();
  }
  ```

  (Mirror an existing `*ByIds` method's `anyUuid`/`@GenerateSql` usage in this repo.)

- [ ] **Step 3: Descriptor merge** — In `listDuplicateGroupsDescriptor` (:2035), after fetching groups, collect all asset ids, call `getAssetQualityByIds`, build a `Map<assetId, sharpness>`, and add `sharpness: sharpnessById.get(asset.id) ?? null` to the per-asset map (:2054-2063).

- [ ] **Step 4: DTO + type** — Add `sharpness: z.number().int().nullable()` to `AgentDuplicateAssetSchema` (:1199-1216) and `sharpness: number | null` to the `AgentDuplicateAsset` TS type.

- [ ] **Step 5: Green** — spec PASS; `make check-server` clean.

- [ ] **Step 6: Commit** — `git commit -m "feat(server): listDuplicateGroups exposes per-asset sharpness (roadmap A4)"`

---

## Task 3: MCP contract + regen + full gates + push

- [ ] **Step 1: Contract descriptions** — In `agent-mcp-tool-contract.service.ts`, update the `readAssetMetadata` (:204) and `listDuplicateGroups` (:1076) tool descriptions to mention the new quality fields (so the agent knows they exist). Keep the contract spec `agent-mcp-tool-contract.service.spec.ts` green (update any snapshot/expected description if it asserts text).
- [ ] **Step 2: Contract test** — Run `/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run agent-mcp-tool-contract.service.spec` → green (update expected shapes if the contract test asserts the response schema fields).
- [ ] **Step 3: Regen** —
  ```bash
  cd /Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm/server
  /opt/homebrew/bin/mise exec -- pnpm build && /opt/homebrew/bin/mise exec -- pnpm sync:sql
  cd .. && /opt/homebrew/bin/mise exec -- make open-api && /opt/homebrew/bin/mise exec -- make build-sdk
  ```
  Confirm the spec gains `qualityInfo` / `sharpness` on `AgentAssetMetadataResult` / `AgentDuplicateAsset`, and `asset.repository.sql` regenerated for `getAssetQualityByIds`.
- [ ] **Step 4: Full gates** —
  ```bash
  /opt/homebrew/bin/mise exec -- make check-server && /opt/homebrew/bin/mise exec -- make lint-server && /opt/homebrew/bin/mise exec -- make check-web
  /opt/homebrew/bin/mise exec -- pnpm -C server test -- --run
  /opt/homebrew/bin/mise exec -- pnpm -C server test:medium -- --run   # exiftool exif specs fail locally — ignore
  ```
  All green (except the known exiftool `exif/*` medium failures). `check-web`: a new DTO field can break the web i18n exhaustive `Record<AgentToolName>` / prompt-length guard ONLY if an agent TOOL was added — A4 adds none, so check-web should pass; if a web fixture references `AgentDuplicateAsset`/`AgentAssetMetadataResult` shape, update it.
- [ ] **Step 5: Commit generated** — `git add server/src/queries open-api mobile/openapi && git commit -m "chore(api): regen OpenAPI/SDK + SQL for quality read exposure (roadmap A4)"`
- [ ] **Step 6: Push** — `git push`

---

## Self-Review (against spec A4)

- **`readAssetMetadata` returns the quality fields when present (null otherwise)** → Task 1 (qualityInfo via `withAgentQuality`, `'quality'` field in technical/allSafe presets; null-row test). ✅
- **`listDuplicateGroups` includes `sharpness`** → Task 2. ✅
- **Scrubbing preserved (no leak)** → quality fields added explicitly to the whitelist/map; tests assert no exif/extra leak; `listDuplicateGroups` exposes only `sharpness`. ✅
- **Contract spec updated; OpenAPI regen** → Task 3. ✅
- **Edge cases: null scores (unscored asset); permission respected** → null-row tests in Tasks 1 & 2; permission/visibility unchanged (reuses `getAgentMetadataByIds`' `agentDirectReadVisibilities` + `getAll`'s ownerId filter). ✅

**Out of scope (later):** A5 keep-rule consumes `sharpness` (agent-runner); A6 visual_cleanup workflow; A7 matrix + L3. A4 adds no new tool/workflow → no L1/L3 here (the agent reads richer data through existing tools). If the contract test enumerates tool COUNT only, it stays green; if it asserts per-tool response field lists, extend it.
