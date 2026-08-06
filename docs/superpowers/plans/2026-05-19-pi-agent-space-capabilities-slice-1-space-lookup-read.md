# Pi Agent Space Capabilities Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only shared-space lookup tools to the first-party Pi MCP runner so Pi can discover visible spaces and inspect one visible space before later slices add mutations.

**Architecture:** Add `listSpaces` and `readSpace` as normal agent read tools. Wire them through DTO schemas, MCP registry/contracts, JSON-RPC dispatch, `AgentToolService`, generated MCP docs, prompt examples, REST controller schemas, SDK/frontend labels, and activity preview copy. Use the existing shared-space membership model and return Pi-shaped summaries instead of reusing full user-facing shared-space DTOs.

**Tech Stack:** NestJS, Zod DTOs, Kysely repositories, Vitest, Svelte/TypeScript frontend helpers, generated OpenAPI/SDK, generated MCP docs.

---

## Slice Scope

Implement only `Slice 1: Space Lookup And Read MCP Tools` from `docs/superpowers/specs/2026-05-19-pi-agent-space-capabilities-design.md`.

In scope:

- New MCP tools:
  - `listSpaces`
  - `readSpace`
- Read-only Pi responses:
  - visible shared-space summaries
  - one visible shared-space detail with member summaries and bounded asset ids
- Approval retry support using only `{ "toolCallId": "..." }`
- MCP contract examples, invalid-shape correction hints, generated docs, and prompt cheat-sheet update
- Frontend approval/activity labels for space reads

Out of scope:

- Creating, editing, deleting, or applying shared-space plans
- Adding/removing assets from spaces
- Member search, invite, role updates, or removals
- Plan preview UI changes beyond labels for these read tools

---

## Key Decisions

- Treat space reads as `AgentToolDataClass.Metadata`. The tools expose ids, names, counts, and member summaries, not image previews or originals.
- `listSpaces` returns summaries only and never includes full `assetIds`.
- `readSpace` returns `assetIds` up to `10_000` using `SharedSpaceRepository.getAssetIdsInSpacePage(spaceId, { limit: 10_001 })`, then trims to 10,000 and reports truncation.
- `readSpace` must not deny solely because the space contains more than the current permission preset's `maxAssetsPerToolCall`. The design requires a partial, explicitly-truncated asset-id list. Reserve the returned asset-id count against the metadata session limit, and deny only when that returned count would exceed the remaining session budget.
- `readSpace` rejects spaces where the current user is not a member or where `session.permissionPlanSnapshot.assetScope.sharedSpaces` is false.
- Member summaries must be redacted for Pi: include `userId`, `name`, `role`, `avatarColor`, and `profileImagePath`/avatar reference only if already exposed by existing space member DTOs. Do not include email in agent tool responses.
- Do not add database columns for `spaceCount` in this slice. Store `assetCount` for read-space asset exposure, store `albumCount` as `0`, and put `spaceIds` in redacted response metadata.

---

## Test Matrix

| Layer               | Cases                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTO schemas         | `listSpaces` accepts `{}` and approved retry `{ toolCallId }`; rejects unrelated root fields. `readSpace` accepts `{ spaceId }` and approved retry `{ toolCallId }`; rejects missing `spaceId`, invalid UUID, `spaceId + toolCallId`, and unrelated root fields.                                                                          |
| MCP registry        | `tools/list` includes `listSpaces` and `readSpace`; each has JSON Schema `type: "object"` and the expected required/optional fields.                                                                                                                                                                                                      |
| MCP dispatch        | JSON-RPC `tools/call` delegates `listSpaces` and `readSpace` to `AgentToolService`; invalid argument shapes return model-actionable correction hints; approved retries call the same tools with only `toolCallId`.                                                                                                                        |
| Tool contracts/docs | Contracts include normal examples, approved-retry examples, common mistakes, and failure matrix rows. Generated docs include both tools and examples that parse through real DTO schemas.                                                                                                                                                 |
| Tool service        | `listSpaces` returns only visible spaces; zero spaces returns `[]`; duplicate/similar and punctuation/emoji names are preserved; no asset list leaks. `readSpace` rejects non-visible spaces, no-longer-member spaces, and shared-space-disabled sessions; no-assets works; many assets truncate with metadata; member email is redacted. |
| Approval flow       | Strict sessions create pending audits; approval retry resumes with `toolCallId`; completed audit shows friendly summaries and `spaceIds` response metadata. Plan-only sessions execute immediately.                                                                                                                                       |
| Assistant flow      | A first-party runner turn can request `listSpaces`, wait for user approval, resume with the approved tool result, persist the assistant reply, and leave the session available for follow-up messages.                                                                                                                                    |
| Frontend labels     | Approval card labels describe space access in user language. Activity preview shows `Listing spaces` and `Reading space details` with `space` kind and stable coalescing.                                                                                                                                                                 |
| Edge cases          | zero visible spaces, duplicate names, similar names, punctuation/emoji names, inaccessible `spaceId`, removed membership, empty space, >10,000 assets, redacted member metadata.                                                                                                                                                          |

---

## Files To Modify

- `server/src/enum.ts`
- `server/src/types/agent-tool.types.ts`
- `server/src/types/agent-mcp-contract.types.ts`
- `server/src/dtos/agent-tool.dto.ts`
- `server/src/dtos/agent-tool.dto.spec.ts`
- `server/src/services/agent-tool.service.ts`
- `server/src/services/agent-tool.service.spec.ts`
- `server/src/services/agent-mcp.service.ts`
- `server/src/services/agent-mcp.service.spec.ts`
- `server/src/services/agent-mcp-tool-registry.service.ts`
- `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- `server/src/services/agent-mcp-tool-contract.service.ts`
- `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- `server/src/services/agent-mcp-docs.service.spec.ts`
- `server/src/services/agent-mcp-prompt.service.ts`
- `server/src/services/agent-mcp-prompt.service.spec.ts`
- `server/src/services/agent-runner-flow.integration.spec.ts`
- `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- `server/src/controllers/agent-tool.controller.ts`
- `server/src/controllers/agent-tool.controller.spec.ts`
- `server/src/controllers/agent-runner-mcp.controller.spec.ts`
- `docs/superpowers/generated/pi-agent-mcp-tools.md`
- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts`
- `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`
- `web/src/i18n/en.json`
- SDK generated files if this repo requires checked-in SDK updates after DTO/controller changes

---

## Step 1: Red Tests For DTOs And MCP Registry

- [ ] Add failing DTO tests in `server/src/dtos/agent-tool.dto.spec.ts`.

Test requirements:

- `AgentReadToolRequestSchemas[AgentToolName.ListSpaces]` accepts `{}`.
- `AgentReadToolRequestSchemas[AgentToolName.ListSpaces]` accepts `{ toolCallId }`.
- `AgentReadToolRequestSchemas[AgentToolName.ListSpaces]` rejects `{ spaceId }` with a strict object error.
- `AgentReadToolRequestSchemas[AgentToolName.ReadSpace]` accepts `{ spaceId }`.
- `AgentReadToolRequestSchemas[AgentToolName.ReadSpace]` accepts `{ toolCallId }`.
- `AgentReadToolRequestSchemas[AgentToolName.ReadSpace]` rejects `{}` with `Provide spaceId, or retry an approved tool call with toolCallId`.
- `AgentReadToolRequestSchemas[AgentToolName.ReadSpace]` rejects `{ spaceId, toolCallId }` with `Use either spaceId or toolCallId, not both`.
- Both new response DTOs accept success, approval-required, and denied shapes.
- `readSpace` success accepts a detail response with `assetIds`, `assetIdsTruncated`, `assetIdsReturned`, `assetCount`, and redacted `members`.

Example DTO assertions:

```ts
it('validates readSpace normal and approved retry payloads', () => {
  const spaceId = factory.uuid();
  const toolCallId = factory.uuid();

  expect(AgentReadToolRequestSchemas[AgentToolName.ReadSpace].safeParse({ spaceId }).success).toBe(true);
  expect(AgentReadToolRequestSchemas[AgentToolName.ReadSpace].safeParse({ toolCallId }).success).toBe(true);

  const missing = AgentReadToolRequestSchemas[AgentToolName.ReadSpace].safeParse({});
  expect(missing.success).toBe(false);
  expect(z.treeifyError(missing.error).errors).toContain(
    'Provide spaceId, or retry an approved tool call with toolCallId',
  );

  const mixed = AgentReadToolRequestSchemas[AgentToolName.ReadSpace].safeParse({ spaceId, toolCallId });
  expect(mixed.success).toBe(false);
  expect(z.treeifyError(mixed.error).errors).toContain('Use either spaceId or toolCallId, not both');
});
```

- [ ] Add failing registry tests in `server/src/services/agent-mcp-tool-registry.service.spec.ts`.

Test requirements:

- `buildTools()` includes `listSpaces` and `readSpace`.
- Both schemas are JSON Schema objects, never `type: "None"`.
- `readSpace` schema describes `spaceId` and approved retry `toolCallId`.
- `listSpaces` schema contains no required input fields.

Run and confirm failure:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected: FAIL because the enum values, schemas, and tool registry entries do not exist yet.

---

## Step 2: Implement Tool Names, Types, DTO Schemas, And Registry Entries

- [ ] Add tool names in `server/src/enum.ts`.

```ts
export enum AgentToolName {
  ...
  ListSpaces = 'listSpaces',
  ReadSpace = 'readSpace',
  ...
}
```

- [ ] Extend `server/src/types/agent-tool.types.ts`.

Add:

```ts
export type AgentToolReadSpaceRequestMetadata = {
  spaceId: string;
};

export type AgentToolListSpacesRequestMetadata = Record<string, never>;

export type AgentSpaceMemberSummary = {
  userId: string;
  name: string;
  role: string;
  avatarColor: string | null;
  profileImagePath: string | null;
};

export type AgentSpaceSummary = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdById: string;
  assetCount: number;
  memberCount: number;
  thumbnailAssetId: string | null;
  recentAssetIds: string[];
};

export type AgentSpaceDetail = AgentSpaceSummary & {
  members: AgentSpaceMemberSummary[];
  assetIds: string[];
  assetIdsReturned: number;
  assetIdsTruncated: boolean;
};
```

Extend `AgentToolResponseIdsMetadata` with `spaceIds?: string[]` and include the new request metadata types in `AgentToolRequestMetadata`.

- [ ] Extend `server/src/dtos/agent-tool.dto.ts`.

Add Zod schemas mirroring the types:

```ts
const AgentListSpacesToolRequestSchema = z
  .strictObject({
    toolCallId: uuid.optional().describe('Approved tool call id when retrying after user approval'),
  })
  .meta({ id: 'AgentListSpacesToolRequestDto' });

const AgentReadSpaceToolRequestSchema = z
  .strictObject({
    spaceId: uuid.optional().describe('Shared space id to inspect'),
    toolCallId: uuid.optional().describe('Approved tool call id when retrying after user approval'),
  })
  .superRefine((value, context) => {
    if (value.spaceId && value.toolCallId) {
      context.addIssue({ code: 'custom', message: 'Use either spaceId or toolCallId, not both' });
    }
    if (!value.spaceId && !value.toolCallId) {
      context.addIssue({
        code: 'custom',
        message: 'Provide spaceId, or retry an approved tool call with toolCallId',
      });
    }
  })
  .meta({ id: 'AgentReadSpaceToolRequestDto' });
```

Add `AgentSpaceSummarySchema`, `AgentSpaceMemberSummarySchema`, `AgentSpaceDetailSchema`, success response schemas, DTO classes, named response DTOs, and `AgentReadToolRequestSchemas` entries.

- [ ] Extend `server/src/services/agent-mcp-tool-registry.service.ts`.

Add `spaceId` to `propertyDescriptions` and add `listSpaces`/`readSpace` read tool definitions with `readOnlyHint: true`.

- [ ] Run the DTO and registry tests again.

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected: PASS for DTO/registry tests after this step.

---

## Step 3: Red Tests For MCP Contracts, Docs, And Prompt Cheat Sheet

- [ ] Add failing contract tests in `server/src/services/agent-mcp-tool-contract.service.spec.ts`.

Test requirements:

- `listReadToolContracts()` includes `listSpaces` and `readSpace`.
- `getReadToolContract(AgentToolName.ListSpaces)` has examples named `list-visible-spaces` and `approved-retry`.
- `getReadToolContract(AgentToolName.ReadSpace)` has examples named `read-space-details` and `approved-retry`.
- Approved retry mode forbids `spaceId` in addition to existing fields.
- Common mistakes include:
  - do not pass `spaceId` to `listSpaces`
  - use `spaceId`, not `id`, `name`, or `spaceName`, for `readSpace`
  - approved retry uses only `toolCallId`
- Failure matrix includes invalid root-field shapes for both tools and missing/mixed id shapes for `readSpace`.
- Corrections for invalid `readSpace` payloads are model-actionable and mention the exact expected shape.

- [ ] Add failing generated-doc tests in `server/src/services/agent-mcp-docs.service.spec.ts`.

Test requirements:

- Generated markdown includes `## listSpaces` and `## readSpace`.
- Documented examples for both tools parse through the real `AgentReadToolRequestSchemas`.
- Committed generated docs must match `AgentMcpDocsService.generateMarkdown()`.

- [ ] Add failing prompt tests in `server/src/services/agent-mcp-prompt.service.spec.ts`.

Test requirements:

- Prompt cheat sheet mentions `listSpaces`/`readSpace`.
- It includes one normal space lookup example.
- `listPromptExamples()` includes the selected `listSpaces` example, and every selected prompt example validates against the real request schema.
- It keeps approved retry guidance as `toolCallId` only.

Run and confirm failure:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts
```

Expected: FAIL because contracts/docs/prompt examples do not include spaces yet.

---

## Step 4: Implement MCP Contracts, Corrections, Docs, And Prompt Examples

- [ ] Extend `server/src/types/agent-mcp-contract.types.ts`.

Add `AgentToolName.ListSpaces` and `AgentToolName.ReadSpace` to `AgentMcpReadToolName`. Update approved retry contract typing if it has a fixed forbidden field list so `spaceId` is represented.

- [ ] Extend `server/src/services/agent-mcp-tool-contract.service.ts`.

Add contracts:

```ts
const listSpacesContract: AgentMcpToolContract = {
  name: AgentToolName.ListSpaces,
  category: 'read',
  summary: 'List shared spaces visible to the current Gallery user.',
  argumentShape: 'Use {} for a normal call. Use {"toolCallId":"..."} only when retrying after approval.',
  examples: [
    {
      name: 'list-visible-spaces',
      request: toolCallRequest('list-spaces-1', AgentToolName.ListSpaces, {}),
    },
    {
      name: 'approved-retry',
      request: toolCallRequest('list-spaces-approved-1', AgentToolName.ListSpaces, {
        toolCallId: exampleToolCallId,
      }),
    },
  ],
  ...
};
```

Add `readSpaceContract` with `spaceId: exampleSpaceId`.

Update approved retry mode common text:

- normal calls use semantic ids such as `spaceId`
- approved retries use only `toolCallId`
- never combine `toolCallId` with `assetIds`, `albumId`, `spaceId`, `filters`, or `limit`

Add validation correction cases for:

- `listSpaces({ spaceId })`
- `readSpace({})`
- `readSpace({ id })`
- `readSpace({ name })`
- `readSpace({ spaceName })`
- `readSpace({ spaceId, toolCallId })`
- `readSpace({ toolCallId, spaceId })`

- [ ] Update `server/src/services/agent-mcp-prompt.service.ts`.

Include one compact space lookup example in the prompt guide, ideally:

1. `listSpaces({})`
2. choose by `id`
3. `readSpace({ spaceId })`

Keep prompt budget small; do not paste every space example.

- [ ] Regenerate docs.

```bash
pnpm --dir server build
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
```

- [ ] Run contract/docs/prompt tests.

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts
```

Expected: PASS.

---

## Step 5: Red Tests For MCP Dispatch And Controller Wiring

- [ ] Add failing dispatch tests in `server/src/services/agent-mcp.service.spec.ts`.

Test requirements:

- `tools/list` returns both new tools.
- `tools/call listSpaces` delegates to `toolService.listSpaces(auth, sessionId, dto)`.
- `tools/call readSpace` delegates to `toolService.readSpace(auth, sessionId, dto)`.
- Approved retry for each delegates with only `{ toolCallId }`.
- Invalid `readSpace` args return a JSON-RPC error containing the correction hint.
- Normal and approved-retry examples from the tool contracts/generated docs for both tools execute through `AgentMcpService.handle()` and delegate to the expected tool-service method.

Add `listSpaces` and `readSpace` to the mocked `AgentToolService`, and add negative expectations to the existing helper that asserts unrelated service methods are not called.

- [ ] Add failing controller tests in `server/src/controllers/agent-tool.controller.spec.ts`.

Test requirements:

- Swagger/OpenAPI response DTO mapping includes `listSpaces` and `readSpace`.
- `POST /agent/sessions/:id/tools/list-spaces` calls `service.listSpaces`.
- `POST /agent/sessions/:id/tools/read-space` calls `service.readSpace`.

- [ ] Add failing runner MCP controller tests in `server/src/controllers/agent-runner-mcp.controller.spec.ts`.

Test requirements:

- Runner `tools/list` includes `listSpaces` and `readSpace`.
- Both are exposed with object input schemas.

Run and confirm failure:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts src/controllers/agent-tool.controller.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts
```

Expected: FAIL because dispatch/controller methods do not exist yet.

---

## Step 6: Implement MCP Dispatch And Internal Controller Routes

- [ ] Extend `server/src/services/agent-mcp.service.ts`.

Add `AgentToolName.ListSpaces` and `AgentToolName.ReadSpace` to `readToolNames`.

Add switch cases:

```ts
case AgentToolName.ListSpaces: {
  return this.toolService.listSpaces(auth, sessionId, dto);
}
case AgentToolName.ReadSpace: {
  return this.toolService.readSpace(auth, sessionId, dto);
}
```

- [ ] Extend `server/src/controllers/agent-tool.controller.ts`.

Import the new request/response DTOs and add:

```ts
@Post('tools/list-spaces')
...
listSpaces(...): Promise<AgentListSpacesToolResponseDto> {
  return this.service.listSpaces(auth, id, dto);
}

@Post('tools/read-space')
...
readSpace(...): Promise<AgentReadSpaceToolResponseDto> {
  return this.service.readSpace(auth, id, dto);
}
```

- [ ] Run dispatch/controller tests.

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts src/controllers/agent-tool.controller.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts
```

Expected: PASS.

---

## Step 7: Red Tests For AgentToolService Space Reads

- [ ] Add failing unit tests in `server/src/services/agent-tool.service.spec.ts`.

Mock dependencies needed:

- `sharedSpaceRepository.getAllByUserId`
- `sharedSpaceRepository.getMember`
- `sharedSpaceRepository.getById`
- `sharedSpaceRepository.getMembers`
- `sharedSpaceRepository.getAssetCount`
- `sharedSpaceRepository.getRecentAssets`
- `sharedSpaceRepository.getAssetIdsInSpacePage`

If the service currently does not inject `SharedSpaceRepository`, add it in implementation after tests fail.

Test cases:

1. `listSpaces` in plan-only mode returns only visible spaces.
   - Mock two spaces from `getAllByUserId`.
   - Assert response `status: success`.
   - Assert summaries include `id`, `name`, `description`, `color`, `assetCount`, `memberCount`, `recentAssetIds`, and no `assetIds`.
   - Assert `toolCall.redactedResponseMetadata.spaceIds` contains returned ids.

2. `listSpaces` returns an empty list for zero visible spaces.

3. `listSpaces` preserves duplicate/similar names and punctuation/emoji names without deduping or normalizing.

4. `listSpaces` denies when `session.permissionPlanSnapshot.assetScope.sharedSpaces` is false.
   - Expected denial reason: `Shared spaces are not accessible for this session`.

5. `readSpace` in plan-only mode returns one visible space detail.
   - Mock membership for current user.
   - Mock `assetCount = 2`, `getAssetIdsInSpacePage` returns two ids.
   - Assert members are present but email is not.
   - Assert `assetIdsReturned = 2`, `assetIdsTruncated = false`.
   - Assert response metadata includes `spaceIds` and `assetIds`.

6. `readSpace` rejects a non-visible or removed-membership space.
   - Mock `getMember` returning `undefined`.
   - Expected denial reason: `Space is not accessible`.

7. `readSpace` handles empty spaces.
   - `assetCount = 0`, `assetIds = []`.
   - Success with `assetIdsReturned = 0`, `assetIdsTruncated = false`.

8. `readSpace` truncates many assets.
   - `assetCount = 10_005`, repo page returns 10,001 ids.
   - Success with exactly 10,000 returned ids, `assetIdsReturned = 10_000`, `assetIdsTruncated = true`.
   - Response summary makes the truncation visible, for example `Returned space with 10000 of 10005 asset id(s)`.

9. `readSpace` truncates instead of denying when the total space asset count exceeds the permission preset's `maxAssetsPerToolCall`.
   - Set `maxAssetsPerToolCall` lower than the mocked `assetCount`.
   - Assert success, a bounded `assetIds` list, and `assetIdsTruncated = true`.
   - Assert it records only the returned asset-id count in the tool-call asset count.

10. `readSpace` denies when the returned asset-id count would exceed the remaining metadata session limit.
    - Reuse album-style session-limit behavior: denial reason `Session policy allows at most N assets per session`.

11. Strict approval flow for `listSpaces`.
    - First call creates `PendingApproval`.
    - Approved retry with `{ toolCallId }` resumes using stored empty request metadata.

12. Strict approval flow for `readSpace`.
    - First call creates `PendingApproval` storing `{ spaceId }`.
    - Approved retry with `{ toolCallId }` revalidates membership, executes, records completion.

13. Approved retry excludes the current tool call when checking metadata session limit for `readSpace`.

- [ ] Add a failing assistant runner flow regression in `server/src/services/agent-runner-flow.integration.spec.ts`.

Test requirements:

- Configure the flow harness so the first streamed runner turn calls `listSpaces` instead of `listAlbums`.
- The first user message persists before any tool approval.
- Strict mode creates a pending `listSpaces` tool call and moves the session to `WaitingForToolApproval`.
- Approving the tool call resumes the runner with a `toolResult.status === 'success'`.
- The completed tool call has `toolName: AgentToolName.ListSpaces`, `responseSummary: 'Returned 1 space(s)'`, `albumCount: 0`, and no asset ids.
- The resumed assistant message is persisted after the tool result, and the session stays available for follow-up messages.

Run and confirm failure:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
```

Expected: FAIL because `AgentToolService` does not implement space descriptors yet.

---

## Step 8: Implement AgentToolService Space Descriptors

- [ ] Update imports and constructor in `server/src/services/agent-tool.service.ts`.

Inject `SharedSpaceRepository` directly. `AgentToolService` does not extend `BaseService`, and this slice needs deterministic agent DTO mapping plus asset id pagination.

- [ ] Add public methods:

```ts
async listSpaces(auth: AuthDto, sessionId: string, dto: AgentListSpacesToolRequestDto) {
  return this.runReadTool(auth, sessionId, dto, this.listSpacesDescriptor());
}

async readSpace(auth: AuthDto, sessionId: string, dto: AgentReadSpaceToolRequestDto) {
  return this.runReadTool(auth, sessionId, dto, this.readSpaceDescriptor());
}
```

- [ ] Extend `executeApprovedToolCall` switch with both new tools.

- [ ] Add helpers:

```ts
const maxAgentSpaceAssetIds = 10_000;

private async validateSharedSpaceAccess(
  auth: AuthDto,
  session: AgentSession,
  spaceId: string,
): Promise<string | null> {
  if (!session.permissionPlanSnapshot.assetScope.sharedSpaces) {
    return 'Shared spaces are not accessible for this session';
  }
  if (!spaceId) {
    return 'Space is not accessible';
  }
  const member = await this.sharedSpaceRepository.getMember(spaceId, auth.user.id);
  return member ? null : 'Space is not accessible';
}
```

- [ ] Implement `listSpacesDescriptor()`.

Behavior:

- Data class: `Metadata`
- Request summary: `List spaces`
- Request metadata: `{}`
- Requested counts: 0 assets, 0 albums
- Validate: deny if `sharedSpaces` is false
- Execute:
  - read `sharedSpaceRepository.getAllByUserId(auth.user.id)`
  - for each space, collect `getMembers`, `getAssetCount`, `getRecentAssets`
  - map to `AgentSpaceSummary`
  - do not include full asset ids
- Response summary: `Returned N space(s)`
- Response metadata: `{ spaceIds }`

- [ ] Implement `readSpaceDescriptor()`.

Behavior:

- Data class: `Metadata`
- Request summary: `Read space ${request.spaceId}`
- Request metadata: `{ spaceId }`
- Requested counts before execution: 0, because asset count is unknown until space lookup
- Validate: `validateSharedSpaceAccess(...)`
- Execute:
  - fetch membership again through `validateSharedSpaceAccess`
  - fetch `space`, `members`, `assetCount`, `recentAssets`
  - deny if missing space after membership check
  - fetch asset ids with `limit: maxAgentSpaceAssetIds + 1`
  - trim to 10,000
  - set `assetIdsTruncated` when `assetCount > assetIds.length` or the repository returned more than 10,000 ids
  - reserve the returned asset-id count with `transitionWithSessionLimit`, matching `readAlbumDescriptor` session-limit accounting without denying solely on total space size
  - return `{ space }`
- Response summary: `Returned space with N asset id(s)` when complete, or `Returned space with N of M asset id(s)` when truncated
- Response metadata: `{ spaceIds: [space.id], assetIds: space.assetIds }`
- Result asset count: `space.assetIds.length` so tool-call accounting reflects only asset ids actually returned to Pi
- Result album count: `0`

- [ ] Add a mapper:

```ts
private mapAgentSpaceMember(member: SharedSpaceMemberRow): AgentSpaceMemberSummary {
  return {
    userId: member.userId,
    name: member.name,
    role: member.role,
    avatarColor: member.avatarColor ?? null,
    profileImagePath: member.profileImagePath ?? null,
  };
}
```

Do not include `email`.

- [ ] Run service tests.

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts
```

Expected: PASS.

---

## Step 9: Red Tests And Implementation For Frontend Labels

- [ ] Add failing frontend helper tests.

In `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`:

- `AgentToolName.ListSpaces` maps to kind `space`, title `Listing spaces`, completed summary `Found visible spaces`.
- `AgentToolName.ReadSpace` maps to kind `space`, title `Reading space details`, completed summary `Read space details`.
- Coalescing keeps `listSpaces` and `readSpace` separate from album activity.

In `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`:

- `getAgentToolNameLabelKey(AgentToolName.ListSpaces)` returns `assistant_agent_tool_name_listSpaces`.
- `getAgentToolNameLabelKey(AgentToolName.ReadSpace)` returns `assistant_agent_tool_name_readSpace`.
- Pending copy:
  - `Pi wants to check your spaces.`
  - `Pi wants to inspect a space.`
- Completed copy:
  - `Pi checked your spaces.`
  - `Pi inspected a space.`

Run and confirm failure:

```bash
pnpm --dir web exec vitest --run 'src/routes/(user)/assistant/agent-activity-ui.spec.ts' 'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts'
```

Expected: FAIL because the labels do not exist yet.

- [ ] Implement frontend labels.

Update `web/src/routes/(user)/assistant/agent-activity-ui.ts`:

```ts
[AgentToolName.ListSpaces]: {
  kind: 'space',
  title: 'Listing spaces',
  completedSummary: 'Found visible spaces',
  coalesceKey: 'list-spaces',
},
[AgentToolName.ReadSpace]: {
  kind: 'space',
  title: 'Reading space details',
  completedSummary: 'Read space details',
  coalesceKey: 'read-space',
},
```

Move `space` earlier in `typePriority`, near `album`, so space activity does not sort behind unknown/understanding.

Update `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts` with label keys and pending/completed copy.

Update `web/src/i18n/en.json`:

```json
"assistant_agent_tool_name_listSpaces": "List spaces",
"assistant_agent_tool_name_readSpace": "Read space"
```

- [ ] Run frontend helper tests.

```bash
pnpm --dir web exec vitest --run 'src/routes/(user)/assistant/agent-activity-ui.spec.ts' 'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts'
```

Expected: PASS.

---

## Step 10: SDK/OpenAPI Sync

- [ ] Regenerate the OpenAPI spec and TypeScript SDK because `AgentToolName` is consumed by the web app from `@immich/sdk`.

Run from the repo root:

```bash
pnpm --dir server build
pnpm --dir server run sync:open-api
make open-api-typescript
make build-sdk
```

Do not hand-edit generated SDK files except to resolve generator output conflicts.

- [ ] If generated SDK changes include `AgentToolName.ListSpaces` and `AgentToolName.ReadSpace`, update any TypeScript compile failures caused by exhaustive `Record<AgentToolName, ...>` maps.

---

## Step 11: Full Verification

- [ ] Run targeted server tests.

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs \
  src/dtos/agent-tool.dto.spec.ts \
  src/services/agent-mcp-tool-registry.service.spec.ts \
  src/services/agent-mcp-tool-contract.service.spec.ts \
  src/services/agent-mcp-docs.service.spec.ts \
  src/services/agent-mcp-prompt.service.spec.ts \
  src/services/agent-mcp.service.spec.ts \
  src/controllers/agent-tool.controller.spec.ts \
  src/controllers/agent-runner-mcp.controller.spec.ts \
  src/services/agent-tool.service.spec.ts \
  src/services/agent-runner-flow.integration.spec.ts
```

- [ ] Run targeted frontend tests.

```bash
pnpm --dir web exec vitest --run 'src/routes/(user)/assistant/agent-activity-ui.spec.ts' 'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts'
```

- [ ] Run docs drift check by regenerating and checking git diff.

```bash
pnpm --dir server build
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
git diff -- docs/superpowers/generated/pi-agent-mcp-tools.md
git diff -- agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Expected: no diff after generated docs and generated prompt cheat sheet are committed.

- [ ] Run CI lint only if the branch convention still asks for that during this feature:

```bash
pnpm lint
```

If repo scripts differ, use the same CI lint command used by nearby assistant work.

---

## Step 12: Self-Review Before Handoff

- [ ] Verify every new MCP tool schema has JSON Schema `type: "object"`.
- [ ] Verify `readSpace` rejects `name`/`spaceName` lookup attempts and tells the model to call `listSpaces` first.
- [ ] Verify approved retry examples use only `toolCallId`.
- [ ] Verify `listSpaces` responses do not leak `assetIds`.
- [ ] Verify `readSpace` responses do not leak member emails.
- [ ] Verify `readSpace` does not deny solely because the total space has more assets than `maxAssetsPerToolCall`; it returns a bounded list and explicit truncation metadata.
- [ ] Verify `assetIdsTruncated` is true only when more than 10,000 ids were available.
- [ ] Verify `readSpace` session asset limit accounting matches `readAlbum`.
- [ ] Verify activity labels are user-facing and not technical route names.
- [ ] Verify generated docs contain no secrets, local paths, stack traces, internal apply endpoints, or write examples from later slices.
- [ ] Verify generated runner prompt contains the space lookup example and no direct mutation guidance.

---

## Commit Guidance

Commit the slice after tests pass:

```bash
git add \
  server/src/enum.ts \
  server/src/types/agent-tool.types.ts \
  server/src/types/agent-mcp-contract.types.ts \
  server/src/dtos/agent-tool.dto.ts \
  server/src/dtos/agent-tool.dto.spec.ts \
  server/src/services/agent-tool.service.ts \
  server/src/services/agent-tool.service.spec.ts \
  server/src/services/agent-mcp.service.ts \
  server/src/services/agent-mcp.service.spec.ts \
  server/src/services/agent-mcp-tool-registry.service.ts \
  server/src/services/agent-mcp-tool-registry.service.spec.ts \
  server/src/services/agent-mcp-tool-contract.service.ts \
  server/src/services/agent-mcp-tool-contract.service.spec.ts \
  server/src/services/agent-mcp-docs.service.spec.ts \
  server/src/services/agent-mcp-prompt.service.ts \
  server/src/services/agent-mcp-prompt.service.spec.ts \
  server/src/services/agent-runner-flow.integration.spec.ts \
  agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs \
  server/src/controllers/agent-tool.controller.ts \
  server/src/controllers/agent-tool.controller.spec.ts \
  server/src/controllers/agent-runner-mcp.controller.spec.ts \
  docs/superpowers/generated/pi-agent-mcp-tools.md \
  web/src/routes/'(user)'/assistant/agent-activity-ui.ts \
  web/src/routes/'(user)'/assistant/agent-activity-ui.spec.ts \
  web/src/routes/'(user)'/assistant/agent-tool-approval-ui.ts \
  web/src/routes/'(user)'/assistant/agent-tool-approval-ui.spec.ts \
  web/src/i18n/en.json
git commit -m "feat: add pi space read tools"
```

Include generated SDK files in the same commit if the repo requires them.
