# Trash + Duplicate Cleanup — Slice 5 Implementation Plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-trash-and-duplicate-cleanup-design.md`
Slice: 5 — Server `listDuplicateGroups` MCP read tool over the existing detection.

## Goal

Expose Gallery's existing duplicate detection (`DuplicateService.getDuplicates`)
as a scrubbed MCP **read** tool so the `cleanup_duplicates` workflow (Slice 6) can
rank each group and trash the non-keepers. Read-only; returns only the fields the
keep rule needs.

## Resolved contracts

- `DuplicateService.getDuplicates(auth)` → `DuplicateResponseDto[]` =
  `{ duplicateId, assets: AssetResponseDto[] }` (full asset responses; CLIP-
  embedding groups). The repository call it wraps is the data source for the
  descriptor's `execute` (OQ5: confirm the repository method + the per-asset
  fields available — `id`, `originalFileName`, `fileCreatedAt`, `isFavorite`,
  `exifInfo.rating`, `exifInfo.exifImageWidth/Height`).
- Read tools follow the `listSpaces` descriptor pattern
  (`agent-tool.service.ts` `listSpaces` + `listSpacesDescriptor`): `runReadTool`
  - a descriptor `{ toolName, dataClass, requestSummary, requestMetadata,
requestedAssetCount, requestedAlbumCount, perToolLimit, perSessionLimit,
validateAccess, execute }`.

## CI discipline (carried from Slice 1's CI failure)

vitest does NOT type-check or lint. After implementing, you MUST run and green:
`make lint-server`, `make check-server` (tsc), `make check-web` (the new DTO may
break web fixtures), and regenerate OpenAPI/SDK (`pnpm -C server build && pnpm
sync:open-api && make open-api`). Commit regenerated artifacts.

## Implementation

### 1. `server/src/enum.ts`

`AgentToolName.ListDuplicateGroups = 'listDuplicateGroups'` (near `ListSpaces`).
Add `Permission.DuplicateRead` is NOT needed — reuse the asset read scope.

### 2. `server/src/dtos/agent-tool.dto.ts`

- **Request** `AgentListDuplicateGroupsToolRequestSchema`: a strictObject with an
  optional `maxGroups` (int, 1..N, default e.g. 50) and the standard `toolCallId`
  approval field, mirroring `AgentListSpacesToolRequestSchema`. Register in
  `AgentReadToolRequestSchemas[AgentToolName.ListDuplicateGroups]`.
- **Scrubbed per-asset summary** `AgentDuplicateAssetSchema`:
  `{ id, originalFileName, fileCreatedAt, isFavorite, rating (nullable int),
width (nullable int), height (nullable int) }` — ONLY the keep-rule fields, no
  raw EXIF dump, no preview/original URLs.
- **Group** `AgentDuplicateGroupSchema`: `{ duplicateId, assets: AgentDuplicateAssetSchema[] }`.
- **Response** `AgentListDuplicateGroupsToolResponseSchema`: the discriminated
  union (approvalRequired / denied / success) like `AgentListSpacesToolResponseSchema`;
  success carries `{ groups: AgentDuplicateGroupSchema[], resultSize }`.
- Export the `*RequestDto` / `*ResponseDto` classes.

### 3. `server/src/services/agent-tool.service.ts`

- Inject the duplicate data source (the repository `DuplicateService` uses, or
  `DuplicateService` itself — pick the lighter one that returns the groups; OQ5).
- `async listDuplicateGroups(auth, sessionId, dto)` → `runReadTool(auth, sessionId, dto, this.listDuplicateGroupsDescriptor())`.
- `listDuplicateGroupsDescriptor()` mirrors `listSpacesDescriptor`:
  `dataClass: Metadata`, `requestSummary: () => 'List duplicate groups'`,
  `validateAccess`: owned-asset read is always allowed (return null), `execute`:
  fetch the user's duplicate groups, cap to `maxGroups`, map each asset to the
  scrubbed summary (id, originalFileName, fileCreatedAt, isFavorite, rating from
  exifInfo, width/height from exifInfo), return `{ groups }`. Skip groups of size
  ≤ 1 (nothing to clean).

### 4. `server/src/services/agent-mcp-tool-registry.service.ts`

Register `ListDuplicateGroups` (mirror the `ListSpaces` entry at ~`:272`): name,
schema `AgentReadToolRequestSchemas[ListDuplicateGroups]`, a description ("List
near-duplicate photo groups (CLIP-embedding detection) with the fields needed to
choose a keeper; read-only").

### 5. Contract / docs

If `agent-mcp-tool-contract.service.spec.ts` enumerates read tools (it asserts
`expectedReadToolNames` or similar), add `listDuplicateGroups`. Regenerate the MCP
docs guide if a snapshot test requires it (`pnpm sync:agent-mcp-docs`).

### 6. agent-runner fixture (for Slice 6)

In `contract-fixtures.mjs`, add a `listDuplicateGroups` handler returning a
config-driven set of groups (so Slice 6 can test the keep rule). Validate the
request shape (optional maxGroups). Return `{ groups: [...] }`.

## TDD steps

### Task 1: failing tests (red)

Server (`agent-tool.service.spec.ts` + dto spec):

- The request schema parses `{}` and `{ maxGroups: 10 }`; rejects `maxGroups: 0`.
- `listDuplicateGroups` returns scrubbed groups (only the keep-rule fields; assert
  NO raw EXIF / URLs leak); caps to `maxGroups`; skips size-≤1 groups; empty when
  no duplicates.
- Registered in the tool registry (`listTools()` includes `listDuplicateGroups`).

agent-runner (`contract-fixtures.test.mjs`): the `listDuplicateGroups` handler
returns configured groups; request validation.

### Task 2: implement (green)

Implement until the relevant suites are green, THEN run the full CI-gate set:

```bash
/opt/homebrew/bin/mise exec -- pnpm -C server test
/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test
/opt/homebrew/bin/mise exec -- make lint-server
/opt/homebrew/bin/mise exec -- make check-server
/opt/homebrew/bin/mise exec -- make check-web
/opt/homebrew/bin/mise exec -- pnpm -C server build && /opt/homebrew/bin/mise exec -- pnpm sync:open-api && /opt/homebrew/bin/mise exec -- make open-api
```

Commit regenerated OpenAPI/SDK artifacts.

## Edge cases

- No duplicates → empty `groups`.
- Group of size 1 → skipped (never offered for cleanup).
- `maxGroups` cap respected; large libraries don't dump everything.
- Scrubbed output only (no EXIF dump, no media URLs) — assert in a test.
- Read permission respected.

## Acceptance

- `listDuplicateGroups` read tool registered + returns scrubbed groups; server +
  agent-runner unit suites green; lint/tsc/check-web clean; OpenAPI/SDK regenerated.

## Commit

`feat(server): add listDuplicateGroups MCP read tool over existing duplicate detection (trash slice 5)`
