# Pi Agent Space Capabilities Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reviewable Pi plans for shared-space member management: search users, add members, remove members, and update member roles without direct MCP writes.

**Architecture:** Add a narrow read-only `searchUsers` MCP tool for disambiguation, then add three plan-only operation types that target existing shared spaces. Keep all member writes inside `AgentOperationPlanService.applyApprovedOperations()` and delegate final mutations to `SharedSpaceService.addMember()`, `removeMember()`, and `updateMember()`.

**Tech Stack:** NestJS, Zod DTOs, MCP tool contracts, Vitest, Svelte/SvelteKit assistant UI, generated OpenAPI/SDK artifacts.

---

## Slice Scope

Implement only `Slice 4: Space Member Management Plans` from `docs/superpowers/specs/2026-05-19-pi-agent-space-capabilities-design.md`.

In scope:

- `mcp_gallery_searchUsers` read tool for narrow user lookup.
- New operation types:
  - `space.addMembers`
  - `space.removeMembers`
  - `space.updateMemberRole`
- New write-scope flags:
  - `addMembersToSpaces`
  - `removeMembersFromSpaces`
  - `updateSpaceMemberRoles`
- Plan validation, MCP guidance, generated docs, prompt cheat sheet, apply pipeline, review UI, applied history, and assistant-flow tests.

Out of scope:

- Direct MCP member mutation tools.
- Space deletion.
- Linked-library management.
- People/face search in spaces.
- Changing current user role or removing the current user through Pi.
- Granting owner role through Pi. Slice 4 may add/update members only to `viewer` or `editor`; existing owner removal/demotion must still be protected by current-user and last-owner checks.
- Exposing admin-only user fields, deleted users, storage details, OAuth ids, quota fields, or private metadata in `searchUsers`.

## Existing APIs To Reuse

- `server/src/services/shared-space.service.ts`
  - `addMember(auth, spaceId, { userId, role })`
  - `removeMember(auth, spaceId, userId)`
  - `updateMember(auth, spaceId, userId, { role })`
  - `getMembers(auth, spaceId)`
- `server/src/services/user.service.ts`
  - `search(auth)` returns users already visible to the authenticated user.
- `server/src/services/agent-tool.service.ts`
  - Existing read tool lifecycle, approval retry handling, and tool-call audit metadata.
- `server/src/services/agent-operation-plan.service.ts`
  - Existing plan proposal, write-scope validation, target access checks, apply selection, apply result mapping, and chat continuation behavior.
- `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
  - Existing grouping, labels, item selection model, field override model, and applied-state model.

## Data Shape Decisions

Use a write payload that is authoritative by id and role. The UI can use the operation summary for names because names are display context, not write identity. Member add/update roles are intentionally limited to `viewer` and `editor`; `owner` assignment is out of scope for Pi in this slice.

```ts
space.addMembers payload:
{
  members: [{ userId: string, role: "viewer" | "editor" }]
}

space.removeMembers payload:
{
  userIds: string[]
}

space.updateMemberRole payload:
{
  userIds: string[],
  role: "viewer" | "editor"
}
```

Selection should reuse the existing `AgentOperationItemSelection` model with `itemKind: "person"`. For member operations, selectable ids are payload user ids. Applying a partial selection filters payload members/user ids before calling `SharedSpaceService`.

`searchUsers` privacy rule: the tool must use `UserService.search(auth)` as the visibility gate and must not query `UserRepository` or admin DTOs directly. Email may be returned only from that already-visible `UserResponseDto` surface; no extra private user fields may be included in MCP responses, tool-call metadata, generated docs, or chat-visible payloads.

Member apply rule: load current members once before mutating a member operation, classify expected no-ops before writes, and return per-user result metadata. Already-member adds, missing-member remove/update, and same-role updates are skipped with reasons. Current-user removal/update, granting owner role, and last-owner removal/demotion reject before any member mutation is called. Unexpected service exceptions keep the existing apply failure behavior.

## TDD And Edge Coverage Matrix

| Area                | Required tests                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTO schemas         | Three operation types parse valid payloads; reject new-space targets, missing `targetId`, `temporaryTargetId`, duplicate user ids, empty arrays, invalid roles, owner target roles, missing role, missing members/userIds, and unsupported payload keys.                                                                                  |
| Session permissions | New write-scope flags are required in custom permission plans, legacy snapshots normalize them to `false`, presets expose them intentionally, and write-scope validation denies each operation when its flag is false.                                                                                                                    |
| User lookup         | `searchUsers` schema has object `inputSchema`, supports approved retry, filters by query/limit, delegates visibility to `UserService.search(auth)`, returns only allowed users, redacts private fields, handles zero and multiple matches, and never exposes deleted/admin/storage/OAuth fields.                                          |
| MCP contract        | Tool list includes `searchUsers`; planning examples cover add/remove/update role; common mistakes reject direct member mutation tools, missing user ids, wrong target kinds, and direct email-only member writes without resolved user ids.                                                                                               |
| Prompt/docs         | Prompt tells Pi to `listSpaces` -> `readSpace` -> `searchUsers` before member plans, ask on ambiguous/no user matches, avoid no-op same-role updates, and use reviewable plans only. Generated docs and prompt stay in sync.                                                                                                              |
| Apply service       | Calls existing shared-space member methods, skips disabled operations, honors selected person ids, rejects current-user removal/update, rejects owner assignment, rejects last owner removal/demotion before mutating, handles already-member/member-missing/same-role/stale-membership as per-user skipped results, and keeps chat open. |
| Frontend            | Plan review labels are human-readable, group member operations under space cards, show member counts instead of photo counts, support member selection, hide raw ids by default, and applied cards summarize member changes.                                                                                                              |
| Assistant flow      | Runner resolves space, resolves user or asks for clarification, proposes member plan, shows review card, applies plan, shows applied history, and composer remains usable.                                                                                                                                                                |

---

### Task 1: Operation Types, DTO Schemas, And Permission Flags

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/types/agent-session.types.ts`
- Modify: `server/src/dtos/agent-session.dto.ts`
- Modify: `server/src/dtos/agent-session.dto.spec.ts`
- Modify: `server/src/services/agent-session.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`

- [ ] **Step 1: Write failing operation DTO tests**

Add tests to `server/src/dtos/agent-operation.dto.spec.ts`:

```ts
it('accepts shared-space member management operations for existing spaces', () => {
  const spaceId = '00000000-0000-4000-8000-000000000020';
  const userId = '00000000-0000-4000-8000-000000000030';
  const otherUserId = '00000000-0000-4000-8000-000000000031';

  expect(
    AgentProposeAlbumOperationsDto.schema.parse({
      summary: 'Manage Family space members.',
      operations: [
        {
          type: AgentOperationType.SpaceAddMembers,
          summary: 'Add Alex as editor.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: { members: [{ userId, role: SharedSpaceRole.Editor }] },
        },
        {
          type: AgentOperationType.SpaceRemoveMembers,
          summary: 'Remove Chris.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: { userIds: [otherUserId] },
        },
        {
          type: AgentOperationType.SpaceUpdateMemberRole,
          summary: 'Make Sam a viewer.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: { userIds: [userId], role: SharedSpaceRole.Viewer },
        },
      ],
    }).operations,
  ).toHaveLength(3);
});

it.each([
  {
    name: 'add members without members',
    operation: {
      type: AgentOperationType.SpaceAddMembers,
      summary: 'Add member.',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: '00000000-0000-4000-8000-000000000020',
      payload: { members: [] },
    },
    path: ['operations', 0, 'payload', 'members'],
  },
  {
    name: 'add member as owner',
    operation: {
      type: AgentOperationType.SpaceAddMembers,
      summary: 'Add owner.',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: '00000000-0000-4000-8000-000000000020',
      payload: { members: [{ userId: '00000000-0000-4000-8000-000000000030', role: SharedSpaceRole.Owner }] },
    },
    path: ['operations', 0, 'payload', 'members', 0, 'role'],
  },
  {
    name: 'remove duplicate members',
    operation: {
      type: AgentOperationType.SpaceRemoveMembers,
      summary: 'Remove duplicate member.',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: '00000000-0000-4000-8000-000000000020',
      payload: {
        userIds: ['00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000030'],
      },
    },
    path: ['operations', 0, 'payload', 'userIds'],
  },
  {
    name: 'role update without target id',
    operation: {
      type: AgentOperationType.SpaceUpdateMemberRole,
      summary: 'Make Sam viewer.',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      payload: { userIds: ['00000000-0000-4000-8000-000000000030'], role: SharedSpaceRole.Viewer },
    },
    path: ['operations', 0, 'targetId'],
  },
  {
    name: 'role update to owner',
    operation: {
      type: AgentOperationType.SpaceUpdateMemberRole,
      summary: 'Make Sam owner.',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: '00000000-0000-4000-8000-000000000020',
      payload: { userIds: ['00000000-0000-4000-8000-000000000030'], role: SharedSpaceRole.Owner },
    },
    path: ['operations', 0, 'payload', 'role'],
  },
  {
    name: 'member operation with temporary target',
    operation: {
      type: AgentOperationType.SpaceRemoveMembers,
      summary: 'Remove member.',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: '00000000-0000-4000-8000-000000000020',
      temporaryTargetId: 'tmp-space',
      payload: { userIds: ['00000000-0000-4000-8000-000000000030'] },
    },
    path: ['operations', 0, 'temporaryTargetId'],
  },
])('rejects invalid shared-space member operation: $name', ({ operation, path }) => {
  expectIssue(
    {
      summary: 'Invalid member plan.',
      operations: [operation],
    },
    path,
  );
});
```

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts
```

Expected: FAIL because `AgentOperationType.SpaceAddMembers`, `SpaceRemoveMembers`, and `SpaceUpdateMemberRole` do not exist.

- [ ] **Step 2: Write failing permission tests**

Add to `server/src/dtos/agent-session.dto.spec.ts`:

```ts
it('requires shared-space member write-scope flags in custom permission plans', () => {
  const permissionPlan = makePermissionPlan();
  const writeScope = { ...permissionPlan.writeScope };
  delete (writeScope as Partial<typeof writeScope>).addMembersToSpaces;

  expectIssue(
    makeCustomCreateInput({ permissionPlan: { ...permissionPlan, writeScope } }),
    ['permissionPlan', 'writeScope', 'addMembersToSpaces'],
    'Required',
  );
});

it('keeps legacy shared-space member write-scope flags disabled when snapshots are old', () => {
  const response = AgentSessionResponseDto.schema.parse({
    id: '00000000-0000-4000-8000-000000000001',
    ownerId: '00000000-0000-4000-8000-000000000002',
    providerType: AgentProviderType.OpenAI,
    providerCredentialId,
    providerCredentialLabel: 'openapi',
    model: 'gpt-5',
    permissionPreset: AgentPermissionPreset.Custom,
    approvalMode: AgentApprovalMode.PlanOnly,
    status: AgentSessionStatus.Created,
    title: 'New chat',
    error: null,
    runnerSessionId: null,
    runnerStartedAt: null,
    runnerStoppedAt: null,
    lastActivityAt: null,
    createdAt: '2026-05-20T09:00:00.000Z',
    updatedAt: '2026-05-20T09:00:00.000Z',
    permissionPlanSnapshot: {
      ...makePermissionPlan(),
      writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
    },
  });

  expect(response.permissionPlanSnapshot.writeScope).toMatchObject({
    addMembersToSpaces: false,
    removeMembersFromSpaces: false,
    updateSpaceMemberRoles: false,
  });
});
```

Add to `server/src/services/agent-operation-plan.service.spec.ts`:

```ts
const makeExistingSpaceMemberOperation = (
  overrides: Partial<AgentOperationPlanWithOperations['operations'][number]> = {},
): AgentOperationPlanWithOperations['operations'][number] =>
  makeOperation({
    type: AgentOperationType.SpaceAddMembers,
    summary: 'Manage space members.',
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: '00000000-0000-4000-8000-000000000020',
    temporaryTargetId: null,
    assetIds: [],
    payload: {
      members: [{ userId: '00000000-0000-4000-8000-000000000030', role: SharedSpaceRole.Editor }],
    },
    ...overrides,
  });

it.each([
  [AgentOperationType.SpaceAddMembers, 'addMembersToSpaces', 'adding members to spaces'],
  [AgentOperationType.SpaceRemoveMembers, 'removeMembersFromSpaces', 'removing members from spaces'],
  [AgentOperationType.SpaceUpdateMemberRole, 'updateSpaceMemberRoles', 'updating space member roles'],
] as const)('denies %s when write scope %s is disabled', async (type, field, message) => {
  const session = makeSession({
    permissionPlanSnapshot: {
      ...expandedPermissionPlanSnapshot,
      writeScope: { ...expandedPermissionPlanSnapshot.writeScope, [field]: false },
    },
  });
  const operation = makeExistingSpaceMemberOperation({ type });

  await expect(
    sut.proposeAlbumOperations(auth, session.id, { summary: 'Manage members.', operations: [operation] }),
  ).rejects.toThrow(`Agent permission policy does not allow ${message}`);
});
```

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session.dto.spec.ts src/services/agent-operation-plan.service.spec.ts
```

Expected: FAIL because the write-scope fields and operation types are missing.

- [ ] **Step 3: Add enum values and DTO schemas**

Modify `server/src/enum.ts`:

```ts
export enum AgentOperationType {
  // existing values...
  SpaceUpdateDetails = 'space.updateDetails',
  SpaceAddMembers = 'space.addMembers',
  SpaceRemoveMembers = 'space.removeMembers',
  SpaceUpdateMemberRole = 'space.updateMemberRole',
  AssetRotate = 'asset.rotate',
  // existing values...
}
```

Modify imports in `server/src/dtos/agent-operation.dto.ts` to include `SharedSpaceRole`.

Add schemas near the existing space schemas:

```ts
const AgentAssignableSharedSpaceRoleSchema = z
  .enum([SharedSpaceRole.Editor, SharedSpaceRole.Viewer])
  .meta({ id: 'AgentAssignableSharedSpaceMemberRole' });

const uniqueUserIds = z
  .array(uuid)
  .min(1)
  .max(100)
  .superRefine((userIds, ctx) => {
    if (new Set(userIds).size !== userIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'userIds must be unique' });
    }
  });

const memberPayloads = z
  .array(
    z.strictObject({
      userId: uuid,
      role: AgentAssignableSharedSpaceRoleSchema,
    }),
  )
  .min(1)
  .max(100)
  .superRefine((members, ctx) => {
    const userIds = members.map((member) => member.userId);
    if (new Set(userIds).size !== userIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'members must contain unique userIds' });
    }
  });

const spaceAddMembersOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.SpaceAddMembers).meta({ id: 'AgentSpaceAddMembersOperationType' }),
    summary,
    targetKind: ExistingSpaceTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z.strictObject({ members: memberPayloads }),
  })
  .superRefine((operation, ctx) => validateSpaceTarget(operation, ctx));

const spaceRemoveMembersOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.SpaceRemoveMembers).meta({ id: 'AgentSpaceRemoveMembersOperationType' }),
    summary,
    targetKind: ExistingSpaceTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z.strictObject({ userIds: uniqueUserIds }),
  })
  .superRefine((operation, ctx) => validateSpaceTarget(operation, ctx));

const spaceUpdateMemberRoleOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.SpaceUpdateMemberRole).meta({ id: 'AgentSpaceUpdateMemberRoleOperationType' }),
    summary,
    targetKind: ExistingSpaceTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    riskLevel: operationDefaults.riskLevel,
    enabled: operationDefaults.enabled,
    payload: z.strictObject({
      userIds: uniqueUserIds,
      role: AgentAssignableSharedSpaceRoleSchema,
    }),
  })
  .superRefine((operation, ctx) => validateSpaceTarget(operation, ctx));
```

Add these schemas to `AgentGalleryOperationInputSchema`.

- [ ] **Step 4: Add permission flags and defaults**

Modify `server/src/types/agent-session.types.ts`:

```ts
writeScope: {
  createAlbum: boolean;
  addAssets: boolean;
  removeAssets?: boolean;
  updateDetails: boolean;
  setCover: boolean;
  createSpace?: boolean;
  addAssetsToSpaces?: boolean;
  removeAssetsFromSpaces?: boolean;
  updateSpaceDetails?: boolean;
  addMembersToSpaces?: boolean;
  removeMembersFromSpaces?: boolean;
  updateSpaceMemberRoles?: boolean;
  editAssets?: boolean;
  favoriteAssets?: boolean;
  archiveAssets?: boolean;
  tagAssets?: boolean;
};
```

Add the same three booleans as required normalized fields.

Modify `legacyWriteScopeDefaults` in `server/src/dtos/agent-session.dto.ts`, `server/src/services/agent-session.service.ts`, and `server/src/services/agent-operation-plan.service.ts`:

```ts
addMembersToSpaces: false,
removeMembersFromSpaces: false,
updateSpaceMemberRoles: false,
```

Modify `expandedWriteScopeShape` in `server/src/dtos/agent-session.dto.ts`:

```ts
addMembersToSpaces: z.boolean(),
removeMembersFromSpaces: z.boolean(),
updateSpaceMemberRoles: z.boolean(),
```

Modify `AgentSessionService.permissionPresets`:

```ts
// Careful
addMembersToSpaces: false,
removeMembersFromSpaces: false,
updateSpaceMemberRoles: false,

// VisualOrganizer
addMembersToSpaces: false,
removeMembersFromSpaces: false,
updateSpaceMemberRoles: false,

// LocalPowerUser
addMembersToSpaces: true,
removeMembersFromSpaces: true,
updateSpaceMemberRoles: true,
```

Modify `server/src/services/agent-operation-plan.service.ts` write-scope validation:

```ts
if (type === AgentOperationType.SpaceAddMembers && !writeScope.addMembersToSpaces) {
  throw new BadRequestException('Agent permission policy does not allow adding members to spaces');
}

if (type === AgentOperationType.SpaceRemoveMembers && !writeScope.removeMembersFromSpaces) {
  throw new BadRequestException('Agent permission policy does not allow removing members from spaces');
}

if (type === AgentOperationType.SpaceUpdateMemberRole && !writeScope.updateSpaceMemberRoles) {
  throw new BadRequestException('Agent permission policy does not allow updating space member roles');
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/dtos/agent-session.dto.spec.ts src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS for new DTO and permission coverage.

- [ ] **Step 6: Commit Task 1**

```bash
git add server/src/enum.ts server/src/types/agent-session.types.ts server/src/dtos/agent-session.dto.ts server/src/dtos/agent-session.dto.spec.ts server/src/services/agent-session.service.ts server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts
git commit -m "feat: add pi space member operation contracts"
```

---

### Task 2: `searchUsers` MCP Read Tool

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`

- [ ] **Step 1: Write failing DTO and registry tests**

Add to `server/src/dtos/agent-tool.dto.spec.ts`:

```ts
it('parses searchUsers requests and approved retries', () => {
  expect(AgentReadToolRequestSchemas[AgentToolName.SearchUsers].parse({ query: 'alex', limit: 5 })).toEqual({
    query: 'alex',
    limit: 5,
  });

  expect(
    AgentReadToolRequestSchemas[AgentToolName.SearchUsers].parse({
      toolCallId: '00000000-0000-4000-8000-000000000111',
    }),
  ).toEqual({ toolCallId: '00000000-0000-4000-8000-000000000111' });
});

it('rejects searchUsers retries mixed with a fresh query', () => {
  expectToolIssue(
    AgentToolName.SearchUsers,
    { query: 'alex', toolCallId: '00000000-0000-4000-8000-000000000111' },
    [],
    'Use either query/limit or toolCallId, not both',
  );
});

it('serializes searchUsers success without private user fields', () => {
  const result = AgentSearchUsersToolSuccessResponseDto.schema.parse({
    status: 'success',
    users: [
      {
        userId: '00000000-0000-4000-8000-000000000030',
        name: 'Alex',
        email: 'alex@example.com',
        avatarColor: 'blue',
        profileImagePath: null,
      },
    ],
    toolCall: makeToolCall({ toolName: AgentToolName.SearchUsers, assetCount: 0, albumCount: 0 }),
  });

  expect(result.users[0]).toEqual({
    userId: '00000000-0000-4000-8000-000000000030',
    name: 'Alex',
    email: 'alex@example.com',
    avatarColor: 'blue',
    profileImagePath: null,
  });
  expect(JSON.stringify(result)).not.toMatch(/isAdmin|quota|oauth|deletedAt|storage/i);
});
```

Add to `server/src/services/agent-mcp-tool-registry.service.spec.ts`:

```ts
it('lists searchUsers as a read-only MCP tool with object input schema', () => {
  const tool = sut.listTools().find((candidate) => candidate.name === AgentToolName.SearchUsers);

  expect(tool).toEqual(expect.objectContaining({ name: AgentToolName.SearchUsers }));
  expect(tool?.inputSchema).toEqual(expect.objectContaining({ type: 'object' }));
  expect(tool?.annotations).toEqual(expect.objectContaining({ readOnlyHint: true, destructiveHint: false }));
});
```

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected: FAIL because `AgentToolName.SearchUsers` and response DTOs do not exist.

- [ ] **Step 2: Write failing service tests for privacy and matching**

Add to `server/src/services/agent-tool.service.spec.ts`:

```ts
// In beforeEach(), add:
// let userService: ReturnType<typeof automock<UserService>>;
// userService = automock(UserService, { args: [{} as never] });
// Pass userService into the AgentToolService constructor after agentRunnerService.

it('searches users returned by UserService.search by name or email and redacts private fields', async () => {
  userService.search.mockResolvedValue([
    {
      id: '00000000-0000-4000-8000-000000000030',
      name: 'Alex Morgan',
      email: 'alex@example.com',
      avatarColor: 'blue',
      profileImagePath: '',
      profileChangedAt: '2026-05-20T09:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000031',
      name: 'Sam Lee',
      email: 'sam@example.com',
      avatarColor: 'green',
      profileImagePath: '',
      profileChangedAt: '2026-05-20T09:00:00.000Z',
    },
  ]);

  const response = await sut.executeTool(auth, session.id, AgentToolName.SearchUsers, { query: 'alex', limit: 10 });

  expect(response.status).toBe('success');
  expect(response.users).toEqual([
    {
      userId: '00000000-0000-4000-8000-000000000030',
      name: 'Alex Morgan',
      email: 'alex@example.com',
      avatarColor: 'blue',
      profileImagePath: null,
    },
  ]);
  expect(JSON.stringify(response)).not.toMatch(/profileChangedAt|isAdmin|deletedAt|quota|oauth|storage/i);
  expect(userService.search).toHaveBeenCalledWith(auth);
});

it('returns an empty searchUsers result when no visible user matches', async () => {
  userService.search.mockResolvedValue([
    {
      id: '00000000-0000-4000-8000-000000000030',
      name: 'Alex Morgan',
      email: 'alex@example.com',
      avatarColor: 'blue',
      profileImagePath: '',
      profileChangedAt: '2026-05-20T09:00:00.000Z',
    },
  ]);

  const response = await sut.executeTool(auth, session.id, AgentToolName.SearchUsers, { query: 'nobody', limit: 10 });

  expect(response.status).toBe('success');
  expect(response.users).toEqual([]);
});

it('does not broaden visibility beyond UserService.search results', async () => {
  userService.search.mockResolvedValue([
    {
      id: auth.user.id,
      name: auth.user.name,
      email: auth.user.email,
      avatarColor: 'primary',
      profileImagePath: '',
      profileChangedAt: '2026-05-20T09:00:00.000Z',
    },
  ]);

  const response = await sut.executeTool(auth, session.id, AgentToolName.SearchUsers, { query: '', limit: 10 });

  expect(response.status).toBe('success');
  expect(response.users).toEqual([
    {
      userId: auth.user.id,
      name: auth.user.name,
      email: auth.user.email,
      avatarColor: 'primary',
      profileImagePath: null,
    },
  ]);
  expect(JSON.stringify(response)).not.toContain('hidden@example.com');
});
```

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts
```

Expected: FAIL because `AgentToolService` has no searchUsers descriptor.

- [ ] **Step 3: Add request/response DTOs and types**

Modify `server/src/enum.ts`:

```ts
export enum AgentToolName {
  // existing values...
  ReadSpace = 'readSpace',
  SearchUsers = 'searchUsers',
  ProposeAlbumOperations = 'proposeAlbumOperations',
  // existing values...
}
```

Modify `server/src/types/agent-tool.types.ts`:

```ts
export type AgentToolSearchUsersRequestMetadata = {
  query: string;
  limit: number;
};

export type AgentUserLookupResult = {
  userId: string;
  name: string;
  email: string | null;
  avatarColor: string | null;
  profileImagePath: string | null;
};

export type AgentToolResponseIdsMetadata = {
  assetIds?: string[];
  albumIds?: string[];
  spaceIds?: string[];
  userIds?: string[];
};
```

Add `AgentToolSearchUsersRequestMetadata` to `AgentToolRequestMetadata`.

Modify `server/src/dtos/agent-tool.dto.ts`:

```ts
const AgentSearchUsersToolRequestSchema = z
  .strictObject({
    query: z.string().trim().min(1).max(120).optional(),
    limit: z.number().int().min(1).max(20).optional(),
    toolCallId: uuid.optional().describe('Approved tool call id when retrying after user approval'),
  })
  .superRefine((value, ctx) => {
    if (value.toolCallId && (value.query !== undefined || value.limit !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use either query/limit or toolCallId, not both',
      });
    }
  })
  .transform((value) => (value.toolCallId ? value : { query: value.query ?? '', limit: value.limit ?? 20 }))
  .meta({ id: 'AgentSearchUsersToolRequestDto' });
```

Add it to `AgentReadToolRequestSchemas`.

Add response schema:

```ts
const AgentUserLookupResultSchema = z
  .object({
    userId: uuid,
    name: z.string(),
    email: z.string().email().nullable(),
    avatarColor: z.string().nullable(),
    profileImagePath: z.string().nullable(),
  })
  .meta({ id: 'AgentUserLookupResult' });

const AgentSearchUsersToolSuccessResponseSchema = z
  .object({
    status: z.literal('success'),
    users: z.array(AgentUserLookupResultSchema),
    toolCall: AgentToolCallResponseSchema,
  })
  .meta({ id: 'AgentSearchUsersToolSuccessResponse' });

export class AgentSearchUsersToolSuccessResponseDto extends createZodDto(AgentSearchUsersToolSuccessResponseSchema) {}
```

- [ ] **Step 4: Implement `AgentToolService.searchUsers`**

Inject `UserService` if it is not already injected into `AgentToolService`. Do not inject or call `UserRepository` for this tool; `UserService.search(auth)` is the privacy boundary.

Add a read descriptor branch matching the existing read tool pattern:

```ts
case AgentToolName.SearchUsers:
  return {
    dataClass: AgentToolDataClass.Metadata,
    requestSummary: (request) => `Search users${request.query ? ` matching "${request.query}"` : ''}`,
    responseSummary: (response) => `Returned ${response.users.length} user(s)`,
    requestMetadata: (request) => ({ query: request.query, limit: request.limit }),
    responseMetadata: (response) => ({ userIds: response.users.map((user) => user.userId) }),
    execute: async (auth, session, request) => {
      const visibleUsers = await this.userService.search(auth);
      const query = request.query.trim().toLowerCase();
      const users = visibleUsers
        .filter((user) => {
          if (!query) {
            return true;
          }
          return user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
        })
        .slice(0, request.limit)
        .map((user) => ({
          userId: user.id,
          name: user.name,
          email: user.email ?? null,
          avatarColor: user.avatarColor ?? null,
          profileImagePath: user.profileImagePath || null,
        }));

      return { status: 'success' as const, users };
    },
  };
```

Use the real descriptor shape in the current file instead of copying this switch if the service uses a map.

- [ ] **Step 5: Register MCP tool**

Modify `server/src/services/agent-mcp-tool-registry.service.ts`:

```ts
defineTool({
  name: AgentToolName.SearchUsers,
  title: 'Search users',
  description: `Search users visible to the authenticated session user for shared-space member planning.${approvedRequestInstruction}`,
  schema: AgentReadToolRequestSchemas[AgentToolName.SearchUsers],
  annotations: readToolAnnotations,
}),
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected: PASS for `searchUsers` DTOs, service behavior, privacy assertions, and MCP tool registration.

- [ ] **Step 7: Commit Task 2**

```bash
git add server/src/enum.ts server/src/types/agent-tool.types.ts server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts
git commit -m "feat: add pi user lookup tool"
```

---

### Task 3: MCP Contracts, Prompt Guidance, And Generated Docs

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

- [ ] **Step 1: Write failing MCP contract tests**

Add to `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

```ts
it('defines searchUsers and shared-space member planning examples', () => {
  const searchUsers = sut.getToolContract(AgentToolName.SearchUsers);
  const planning = sut.getToolContract(AgentToolName.ProposeAlbumOperations);

  expect(searchUsers.examples).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'search-users-by-name', arguments: { query: 'alex', limit: 10 } }),
      expect.objectContaining({ name: 'approved-retry' }),
    ]),
  );

  for (const exampleName of ['add-space-member', 'remove-space-member', 'update-space-member-role'] as const) {
    const example = planning.examples.find((candidate) => candidate.name === exampleName);
    expect(example).toBeDefined();
    expect(() =>
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].parse(example?.arguments),
    ).not.toThrow();
  }
});

it('provides actionable hints for member-management planning mistakes', () => {
  const planning = sut.getToolContract(AgentToolName.ProposeAlbumOperations);
  const mistakeIds = planning.commonMistakes.map((mistake) => mistake.id);

  expect(mistakeIds).toEqual(
    expect.arrayContaining([
      'planning-space-member-missing-target-id',
      'planning-space-member-unresolved-user',
      'planning-space-member-direct-mutation',
      'planning-space-member-duplicate-user-id',
    ]),
  );
});
```

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: FAIL because the contract entries are missing.

- [ ] **Step 2: Write failing MCP service correction tests**

Add to `server/src/services/agent-mcp.service.spec.ts`:

```ts
it('returns a correction hint when a member operation omits targetId', async () => {
  const response = await sut.handleToolCall(
    auth,
    session.id,
    toolCallRequest('member-missing-target-id', AgentToolName.ProposeAlbumOperations, {
      summary: 'Add Alex to Family.',
      operations: [
        {
          type: AgentOperationType.SpaceAddMembers,
          summary: 'Add Alex as editor.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          payload: {
            members: [{ userId: '00000000-0000-4000-8000-000000000030', role: SharedSpaceRole.Editor }],
          },
        },
      ],
    }),
  );

  expect(response).toMatchObject({
    isError: true,
    structuredContent: expect.objectContaining({
      error: expect.objectContaining({
        hint: expect.stringMatching(/targetId.*listSpaces|readSpace/i),
      }),
    }),
  });
});

it('points direct member mutation tool names back to reviewable plans', async () => {
  const response = await sut.handleToolCall(auth, session.id, {
    method: 'tools/call',
    params: {
      name: 'mcp_gallery_addSpaceMember',
      arguments: { spaceId: '00000000-0000-4000-8000-000000000020' },
    },
  });

  expect(response).toMatchObject({
    isError: true,
    structuredContent: expect.objectContaining({
      error: expect.objectContaining({
        hint: expect.stringMatching(/proposeAlbumOperations|reviewable/i),
      }),
    }),
  });
});

it('returns a correction hint when a member plan tries to grant owner role', async () => {
  const response = await sut.handleToolCall(
    auth,
    session.id,
    toolCallRequest('member-owner-role', AgentToolName.ProposeAlbumOperations, {
      summary: 'Make Alex an owner.',
      operations: [
        {
          type: AgentOperationType.SpaceUpdateMemberRole,
          summary: 'Make Alex owner.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: '00000000-0000-4000-8000-000000000020',
          payload: { userIds: ['00000000-0000-4000-8000-000000000030'], role: SharedSpaceRole.Owner },
        },
      ],
    }),
  );

  expect(response).toMatchObject({
    isError: true,
    structuredContent: expect.objectContaining({
      error: expect.objectContaining({
        hint: expect.stringMatching(/viewer|editor|owner role/i),
      }),
    }),
  });
});
```

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: FAIL until common mistakes and unknown-tool hint mapping cover member operations.

- [ ] **Step 3: Add contract entries and examples**

Modify `server/src/services/agent-mcp-tool-contract.service.ts`.

Add `searchUsersContract`:

```ts
const searchUsersContract: AgentMcpToolContract<AgentToolName.SearchUsers> = {
  name: AgentToolName.SearchUsers,
  title: 'Search users',
  description: 'Search users visible to the session user for shared-space member planning.',
  usage:
    'Use query and optional limit for a new request. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [
    {
      name: 'search-users-by-name',
      description: 'Search visible users by display name or email.',
      requiredFields: ['query'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use after readSpace when adding a new space member and the user is not already in the member list.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'search-users-by-name',
      description: 'Find visible users matching Alex.',
      arguments: { query: 'alex', limit: 10 },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'search-users-combined-query-and-tool-call-id',
      match: { messageIncludes: 'Use either query/limit or toolCallId, not both' },
      hint: 'Use query/limit for a new user lookup, or only toolCallId for an approved retry.',
      exampleName: 'approved-retry',
    },
  ],
  approvalRetry,
  safety,
};
```

Add planning examples:

```ts
{
  name: 'add-space-member',
  description: 'Add a resolved visible user to an existing shared space.',
  arguments: {
    summary: 'Add Alex to Family as editor.',
    operations: [
      {
        type: AgentOperationType.SpaceAddMembers,
        summary: 'Add Alex as editor.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: exampleSpaceId,
        payload: { members: [{ userId: exampleUserId, role: SharedSpaceRole.Editor }] },
      },
    ],
  },
},
{
  name: 'remove-space-member',
  description: 'Remove an existing shared-space member.',
  arguments: {
    summary: 'Remove Chris from Project.',
    operations: [
      {
        type: AgentOperationType.SpaceRemoveMembers,
        summary: 'Remove Chris.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: exampleSpaceId,
        payload: { userIds: [exampleUserId] },
      },
    ],
  },
},
{
  name: 'update-space-member-role',
  description: 'Change an existing shared-space member role.',
  arguments: {
    summary: 'Make Sam a viewer in Vacation.',
    operations: [
      {
        type: AgentOperationType.SpaceUpdateMemberRole,
        summary: 'Make Sam a viewer.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: exampleSpaceId,
        payload: { userIds: [exampleUserId], role: SharedSpaceRole.Viewer },
      },
    ],
  },
},
```

Add common mistakes:

```ts
{
  id: 'planning-space-member-missing-target-id',
  match: { issuePath: 'operations.0.targetId', messageIncludes: 'targetId is required for existing space targets' },
  hint: 'Member operations require targetKind "existing_space" and targetId from listSpaces/readSpace.',
  exampleName: 'add-space-member',
},
{
  id: 'planning-space-member-unresolved-user',
  match: { messageIncludes: 'Invalid uuid', issuePath: 'operations.0.payload' },
  hint: 'Resolve people with readSpace members or searchUsers first. Member operation payloads require user ids, not names or email-only values.',
  exampleName: 'add-space-member',
},
{
  id: 'planning-space-member-direct-mutation',
  match: { messageIncludes: 'Unknown tool', requestShape: 'json-rpc' },
  hint: 'Do not call direct member mutation tools. Propose a reviewable space.addMembers, space.removeMembers, or space.updateMemberRole plan instead.',
  exampleName: 'add-space-member',
},
{
  id: 'planning-space-member-duplicate-user-id',
  match: { messageIncludes: 'unique', issuePath: 'operations.0.payload' },
  hint: 'Each member operation may include a user id only once.',
  exampleName: 'remove-space-member',
},
{
  id: 'planning-space-member-owner-role',
  match: { issuePath: 'operations.0.payload', messageIncludes: 'owner' },
  hint: 'Pi member plans may assign viewer or editor only. Do not grant owner role through the assistant.',
  exampleName: 'add-space-member',
},
```

- [ ] **Step 4: Write failing prompt/docs tests**

Add to `server/src/services/agent-mcp-prompt.service.spec.ts`:

```ts
it('guides the runner through shared-space member management without direct writes', () => {
  const prompt = sut.generatePromptCheatSheet();
  const examples = sut.listPromptExamples();

  expect(examples).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ exampleName: 'search-users-by-name' }),
      expect.objectContaining({ exampleName: 'add-space-member' }),
      expect.objectContaining({ exampleName: 'remove-space-member' }),
      expect.objectContaining({ exampleName: 'update-space-member-role' }),
    ]),
  );
  expect(prompt).toContain('mcp_gallery_searchUsers');
  expect(prompt).toContain('space.addMembers');
  expect(prompt).toContain('space.removeMembers');
  expect(prompt).toContain('space.updateMemberRole');
  expect(prompt).toMatch(/ambiguous|multiple users|ask/i);
  expect(prompt).toMatch(/already a member|same role|no-op/i);
  expect(prompt).toMatch(/viewer|editor/i);
  expect(prompt).toMatch(/owner role|do not.*owner/i);
  expect(prompt).not.toMatch(/mcp_gallery_(add|remove|update).*Member/i);
});
```

Add to `server/src/services/agent-mcp-docs.service.spec.ts`:

```ts
it('documents searchUsers and member management plans with privacy cautions', () => {
  const markdown = sut.generateMarkdown();

  expect(markdown).toContain('searchUsers');
  expect(markdown).toContain('add-space-member');
  expect(markdown).toContain('remove-space-member');
  expect(markdown).toContain('update-space-member-role');
  expect(markdown).toMatch(/not names or email-only values/i);
  expect(markdown).toMatch(/private|redact|visible/i);
  expect(markdown).toMatch(/viewer|editor/i);
  expect(markdown).toMatch(/owner role|do not.*owner/i);
});
```

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: FAIL until prompt selections and docs renderer include the new contracts.

- [ ] **Step 5: Update prompt guidance compactly**

Modify `server/src/services/agent-mcp-prompt.service.ts`.

Add these examples to `promptExampleSelections`:

```ts
{ toolName: AgentToolName.SearchUsers, exampleName: 'search-users-by-name' },
{ toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'add-space-member' },
{ toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'remove-space-member' },
{ toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'update-space-member-role' },
```

Add compact guidance:

```ts
'Member plans: listSpaces/readSpace first. Existing members come from readSpace.members. For new members call mcp_gallery_searchUsers, ask if no or multiple matches. Use user ids only. Plan space.addMembers, space.removeMembers, or space.updateMemberRole for existing_space targetId. Roles may be viewer/editor only. Do not grant owner role, remove current user, remove/demote last owner, or plan same-role no-ops.',
```

Keep the prompt under the existing size test limit by using one compact member example line instead of rendering all full JSON examples:

```ts
`Plan ${this.toPiToolName(AgentToolName.ProposeAlbumOperations)} member examples: space.addMembers payload {members:[{userId,role}]}; space.removeMembers payload {userIds}; space.updateMemberRole payload {userIds,role}.`,
```

- [ ] **Step 6: Regenerate docs and prompt**

Run:

```bash
pnpm --dir server build
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
```

Expected: generated files update without errors.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts
```

Expected: PASS for MCP contract, correction, generated-doc, and prompt tests.

- [ ] **Step 8: Commit Task 3**

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp-docs.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
git commit -m "feat: document pi space member planning"
```

---

### Task 4: Apply Pipeline, Access Checks, And Person Selection

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/types/agent-operation.types.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Write failing apply tests**

Add to `server/src/services/agent-operation-plan.service.spec.ts`:

```ts
const makeSharedSpaceMember = (overrides: { userId: string; role: SharedSpaceRole; name?: string }) => ({
  userId: overrides.userId,
  name: overrides.name ?? 'Member',
  email: `${overrides.userId}@example.com`,
  role: overrides.role,
  joinedAt: '2026-05-20T09:00:00.000Z',
  profileImagePath: undefined,
  profileChangedAt: undefined,
  avatarColor: undefined,
  showInTimeline: true,
  sharePersonMetadata: true,
});

const createProposedMemberPlan = ({
  session: sessionOverride,
  operations,
}: {
  session?: AgentSession;
  operations: AgentOperationPlanWithOperations['operations'];
}) => {
  const session =
    sessionOverride ??
    makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
  const plan = makePlan({ id: 'member-plan-id', sessionId: session.id, operations });

  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((_planId, updates) =>
    Promise.resolve(applyUpdatesToPlan(plan, updates)),
  );

  const spaceIds = new Set(operations.flatMap((operation) => (operation.targetId ? [operation.targetId] : [])));
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(spaceIds);
  sharedSpaceService.addMember.mockResolvedValue(
    makeSharedSpaceMember({
      userId: '00000000-0000-4000-8000-000000000030',
      role: SharedSpaceRole.Editor,
    }) as never,
  );
  sharedSpaceService.updateMember.mockResolvedValue(
    makeSharedSpaceMember({
      userId: '00000000-0000-4000-8000-000000000032',
      role: SharedSpaceRole.Viewer,
    }) as never,
  );
  sharedSpaceService.removeMember.mockResolvedValue(undefined);
  if (!sharedSpaceService.getMembers.getMockImplementation()) {
    sharedSpaceService.getMembers.mockResolvedValue([
      makeSharedSpaceMember({ userId: auth.user.id, role: SharedSpaceRole.Owner, name: 'Current user' }),
    ]);
  }

  return { session, plan };
};

it('applies selected shared-space member operations through SharedSpaceService', async () => {
  const spaceId = '00000000-0000-4000-8000-000000000020';
  const alexId = '00000000-0000-4000-8000-000000000030';
  const chrisId = '00000000-0000-4000-8000-000000000031';
  const samId = '00000000-0000-4000-8000-000000000032';
  const { session, plan } = createProposedMemberPlan({
    operations: [
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceAddMembers,
        targetId: spaceId,
        payload: { members: [{ userId: alexId, role: SharedSpaceRole.Editor }] },
      }),
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceRemoveMembers,
        targetId: spaceId,
        payload: { userIds: [chrisId] },
      }),
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceUpdateMemberRole,
        targetId: spaceId,
        payload: { userIds: [samId], role: SharedSpaceRole.Viewer },
      }),
    ],
  });
  sharedSpaceService.getMembers.mockResolvedValue([
    makeSharedSpaceMember({ userId: auth.user.id, role: SharedSpaceRole.Owner }),
    makeSharedSpaceMember({ userId: chrisId, role: SharedSpaceRole.Viewer }),
    makeSharedSpaceMember({ userId: samId, role: SharedSpaceRole.Editor }),
  ]);

  await sut.applyApprovedOperations(auth, session.id, plan.id, {
    planRevision: plan.revision,
    operationIds: plan.operations.map((operation) => operation.id),
  });

  expect(sharedSpaceService.addMember).toHaveBeenCalledWith(auth, spaceId, {
    userId: alexId,
    role: SharedSpaceRole.Editor,
  });
  expect(sharedSpaceService.removeMember).toHaveBeenCalledWith(auth, spaceId, chrisId);
  expect(sharedSpaceService.updateMember).toHaveBeenCalledWith(auth, spaceId, samId, { role: SharedSpaceRole.Viewer });
});

it('filters member operation payloads by selected person ids', async () => {
  const spaceId = '00000000-0000-4000-8000-000000000020';
  const alexId = '00000000-0000-4000-8000-000000000030';
  const beaId = '00000000-0000-4000-8000-000000000031';
  const { session, plan } = createProposedMemberPlan({
    operations: [
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceAddMembers,
        targetId: spaceId,
        payload: {
          members: [
            { userId: alexId, role: SharedSpaceRole.Editor },
            { userId: beaId, role: SharedSpaceRole.Viewer },
          ],
        },
      }),
    ],
  });

  await sut.applyApprovedOperations(auth, session.id, plan.id, {
    planRevision: plan.revision,
    operationIds: [plan.operations[0].id],
    itemSelections: {
      [plan.operations[0].id]: {
        itemKind: 'person',
        mode: 'only',
        itemIds: [beaId],
      },
    },
  });

  expect(sharedSpaceService.addMember).toHaveBeenCalledTimes(1);
  expect(sharedSpaceService.addMember).toHaveBeenCalledWith(auth, spaceId, {
    userId: beaId,
    role: SharedSpaceRole.Viewer,
  });
});
```

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: FAIL because apply does not handle member operation types or person selections.

- [ ] **Step 2: Write failing safety edge-case tests**

Add to `server/src/services/agent-operation-plan.service.spec.ts`:

```ts
it('rejects removing the current user through Pi', async () => {
  const { session, plan } = createProposedMemberPlan({
    operations: [
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceRemoveMembers,
        payload: { userIds: [auth.user.id] },
      }),
    ],
  });

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      planRevision: plan.revision,
      operationIds: [plan.operations[0].id],
    }),
  ).rejects.toThrow('Pi cannot remove the current user from a space');

  expect(sharedSpaceService.removeMember).not.toHaveBeenCalled();
});

it('rejects removing the last owner from a space', async () => {
  const spaceId = '00000000-0000-4000-8000-000000000020';
  const ownerId = '00000000-0000-4000-8000-000000000030';
  sharedSpaceService.getMembers.mockResolvedValue([
    makeSharedSpaceMember({ userId: ownerId, role: SharedSpaceRole.Owner }),
    makeSharedSpaceMember({ userId: '00000000-0000-4000-8000-000000000031', role: SharedSpaceRole.Viewer }),
  ]);
  const { session, plan } = createProposedMemberPlan({
    operations: [
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceRemoveMembers,
        targetId: spaceId,
        payload: { userIds: [ownerId] },
      }),
    ],
  });

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      planRevision: plan.revision,
      operationIds: [plan.operations[0].id],
    }),
  ).rejects.toThrow('Pi cannot remove the last owner from a space');
});

it('skips disabled shared-space member operations', async () => {
  const { session, plan } = createProposedMemberPlan({
    operations: [
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceAddMembers,
        enabled: false,
        payload: {
          members: [{ userId: '00000000-0000-4000-8000-000000000030', role: SharedSpaceRole.Editor }],
        },
      }),
    ],
  });

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      planRevision: plan.revision,
      operationIds: [plan.operations[0].id],
    }),
  ).rejects.toThrow('disabled');

  expect(sharedSpaceService.addMember).not.toHaveBeenCalled();
});

it('skips already-member, missing-member, and same-role member changes before mutating', async () => {
  const spaceId = '00000000-0000-4000-8000-000000000020';
  const alexId = '00000000-0000-4000-8000-000000000030';
  const beaId = '00000000-0000-4000-8000-000000000031';
  const missingId = '00000000-0000-4000-8000-000000000032';
  const samId = '00000000-0000-4000-8000-000000000033';
  sharedSpaceService.getMembers.mockResolvedValue([
    makeSharedSpaceMember({ userId: auth.user.id, role: SharedSpaceRole.Owner }),
    makeSharedSpaceMember({ userId: alexId, role: SharedSpaceRole.Editor }),
    makeSharedSpaceMember({ userId: samId, role: SharedSpaceRole.Viewer }),
  ]);
  const { session, plan } = createProposedMemberPlan({
    operations: [
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceAddMembers,
        targetId: spaceId,
        payload: {
          members: [
            { userId: alexId, role: SharedSpaceRole.Editor },
            { userId: beaId, role: SharedSpaceRole.Viewer },
          ],
        },
      }),
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceRemoveMembers,
        targetId: spaceId,
        payload: { userIds: [missingId] },
      }),
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceUpdateMemberRole,
        targetId: spaceId,
        payload: { userIds: [samId], role: SharedSpaceRole.Viewer },
      }),
    ],
  });

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    planRevision: plan.revision,
    operationIds: plan.operations.map((operation) => operation.id),
  });

  expect(sharedSpaceService.addMember).toHaveBeenCalledTimes(1);
  expect(sharedSpaceService.addMember).toHaveBeenCalledWith(auth, spaceId, {
    userId: beaId,
    role: SharedSpaceRole.Viewer,
  });
  expect(sharedSpaceService.removeMember).not.toHaveBeenCalled();
  expect(sharedSpaceService.updateMember).not.toHaveBeenCalled();
  expect(result.plan.operations[0].result).toMatchObject({
    userIds: [beaId],
    skippedUserIds: [{ userId: alexId, reason: 'already_member' }],
  });
  expect(result.plan.operations[1].result).toMatchObject({
    userIds: [],
    skippedUserIds: [{ userId: missingId, reason: 'not_member' }],
  });
  expect(result.plan.operations[2].result).toMatchObject({
    userIds: [],
    skippedUserIds: [{ userId: samId, reason: 'same_role' }],
  });
});

it('rejects owner assignment before mutating members', async () => {
  const spaceId = '00000000-0000-4000-8000-000000000020';
  const { session, plan } = createProposedMemberPlan({
    operations: [
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceAddMembers,
        targetId: spaceId,
        payload: { members: [{ userId: '00000000-0000-4000-8000-000000000031', role: SharedSpaceRole.Owner }] },
      }),
    ],
  });

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      planRevision: plan.revision,
      operationIds: plan.operations.map((operation) => operation.id),
    }),
  ).rejects.toThrow(/owner role/i);

  expect(sharedSpaceService.addMember).not.toHaveBeenCalled();
});

it('rejects last-owner demotion before mutating members', async () => {
  const spaceId = '00000000-0000-4000-8000-000000000020';
  const ownerId = '00000000-0000-4000-8000-000000000030';
  sharedSpaceService.getMembers.mockResolvedValue([
    makeSharedSpaceMember({ userId: ownerId, role: SharedSpaceRole.Owner }),
  ]);
  const { session, plan } = createProposedMemberPlan({
    operations: [
      makeExistingSpaceMemberOperation({
        type: AgentOperationType.SpaceUpdateMemberRole,
        targetId: spaceId,
        payload: { userIds: [ownerId], role: SharedSpaceRole.Viewer },
      }),
    ],
  });

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      planRevision: plan.revision,
      operationIds: [plan.operations[0].id],
    }),
  ).rejects.toThrow('Pi cannot change the last owner role in a space');

  expect(sharedSpaceService.updateMember).not.toHaveBeenCalled();
});

it('records member user ids in planning audit metadata without names or emails', async () => {
  const spaceId = '00000000-0000-4000-8000-000000000020';
  const alexId = '00000000-0000-4000-8000-000000000030';
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.Running,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const operationInput = {
    type: AgentOperationType.SpaceAddMembers,
    summary: 'Add Alex as editor.',
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    payload: { members: [{ userId: alexId, role: SharedSpaceRole.Editor }] },
  };
  const plan = makePlan({ sessionId: session.id, operations: [makeExistingSpaceMemberOperation(operationInput)] });
  sessionRepository.getById.mockResolvedValue(session);
  sessionRepository.update.mockResolvedValue({ ...session, status: AgentSessionStatus.WaitingForPlanReview });
  planRepository.createReplacementRevision.mockResolvedValue(plan);

  await sut.proposeAlbumOperations(auth, session.id, { summary: 'Add Alex.', operations: [operationInput] });

  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      redactedRequestMetadata: expect.objectContaining({
        spaceIds: [spaceId],
        userIds: [alexId],
      }),
    }),
  );
  expect(JSON.stringify(toolCallRepository.create.mock.calls)).not.toMatch(/alex@example.com|Alex Morgan/i);
});
```

Expected: FAIL until safety checks and member planning metadata exist.

- [ ] **Step 3: Generalize apply selection from assets to selectable items**

Modify `server/src/services/agent-operation-plan.service.ts`.

Replace `selectedAssetIdsByOperationId` with `selectedItemIdsByOperationId` in the internal `ApplySelection` type:

```ts
type ApplySelection = {
  selectedOperationIds: Set<string>;
  selectedItemIdsByOperationId: Map<string, string[]>;
  fieldOverridesByOperationId: Map<string, AgentOperationFieldOverride>;
};
```

Add helper methods:

```ts
private getSelectableItemIds(operation: AgentOperationPlanWithOperations['operations'][number]): {
  itemKind: 'asset' | 'person';
  itemIds: string[];
} {
  if (operation.assetIds.length > 0) {
    return { itemKind: 'asset', itemIds: [...new Set(operation.assetIds)] };
  }

  const payload = this.requireObjectPayload(operation.payload);
  if (operation.type === AgentOperationType.SpaceAddMembers && Array.isArray(payload.members)) {
    return {
      itemKind: 'person',
      itemIds: payload.members.flatMap((member) =>
        member && typeof member === 'object' && !Array.isArray(member) && typeof member.userId === 'string'
          ? [member.userId]
          : [],
      ),
    };
  }

  if (
    (operation.type === AgentOperationType.SpaceRemoveMembers ||
      operation.type === AgentOperationType.SpaceUpdateMemberRole) &&
    Array.isArray(payload.userIds)
  ) {
    return {
      itemKind: 'person',
      itemIds: payload.userIds.filter((userId): userId is string => typeof userId === 'string'),
    };
  }

  return { itemKind: 'asset', itemIds: [] };
}
```

Update selection validation to compare `selection.itemKind` to this helper. Keep the existing asset-selection behavior intact.

- [ ] **Step 4: Add apply handlers**

Modify `applyOperation()` in `server/src/services/agent-operation-plan.service.ts`:

```ts
case AgentOperationType.SpaceAddMembers: {
  const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
  const payload = this.requireSpaceAddMembersPayload(operation.payload, operation.summary);
  const currentMembers = await this.sharedSpaceService.getMembers(auth, spaceId);
  const currentUserIds = new Set(currentMembers.map((member) => member.userId));
  const skippedUserIds: Array<{ userId: string; reason: string }> = [];
  const membersToAdd = payload.members.filter((member) => {
    if (currentUserIds.has(member.userId)) {
      skippedUserIds.push({ userId: member.userId, reason: 'already_member' });
      return false;
    }
    return true;
  });

  for (const member of membersToAdd) {
    await this.sharedSpaceService.addMember(auth, spaceId, { userId: member.userId, role: member.role });
  }
  return this.appliedOperation(operation.id, {
    spaceId,
    userIds: membersToAdd.map((member) => member.userId),
    skippedUserIds,
  });
}

case AgentOperationType.SpaceRemoveMembers: {
  const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
  const payload = this.requireUserIdsPayload(operation.payload, operation.summary);
  const currentMembers = await this.sharedSpaceService.getMembers(auth, spaceId);
  await this.validateSafeSpaceMemberRemoval(auth, payload.userIds, currentMembers);
  const currentUserIds = new Set(currentMembers.map((member) => member.userId));
  const skippedUserIds: Array<{ userId: string; reason: string }> = [];
  const userIdsToRemove = payload.userIds.filter((userId) => {
    if (!currentUserIds.has(userId)) {
      skippedUserIds.push({ userId, reason: 'not_member' });
      return false;
    }
    return true;
  });

  for (const userId of userIdsToRemove) {
    await this.sharedSpaceService.removeMember(auth, spaceId, userId);
  }
  return this.appliedOperation(operation.id, { spaceId, userIds: userIdsToRemove, skippedUserIds });
}

case AgentOperationType.SpaceUpdateMemberRole: {
  const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
  const payload = this.requireSpaceUpdateMemberRolePayload(operation.payload, operation.summary);
  const currentMembers = await this.sharedSpaceService.getMembers(auth, spaceId);
  await this.validateSafeSpaceMemberRoleUpdate(auth, payload.userIds, currentMembers);
  const currentByUserId = new Map(currentMembers.map((member) => [member.userId, member]));
  const skippedUserIds: Array<{ userId: string; reason: string }> = [];
  const userIdsToUpdate = payload.userIds.filter((userId) => {
    const currentMember = currentByUserId.get(userId);
    if (!currentMember) {
      skippedUserIds.push({ userId, reason: 'not_member' });
      return false;
    }
    if (currentMember.role === payload.role) {
      skippedUserIds.push({ userId, reason: 'same_role' });
      return false;
    }
    return true;
  });

  for (const userId of userIdsToUpdate) {
    await this.sharedSpaceService.updateMember(auth, spaceId, userId, { role: payload.role });
  }
  return this.appliedOperation(operation.id, { spaceId, userIds: userIdsToUpdate, skippedUserIds });
}
```

Extend the operation apply result metadata type in `server/src/types/agent-operation.types.ts` so member operations can persist skipped no-ops without exposing raw private user fields:

```ts
export type AgentOperationMemberApplySkippedReason = 'already_member' | 'not_member' | 'same_role';

export type AgentOperationMemberApplyResultMetadata = {
  spaceId: string;
  userIds: string[];
  skippedUserIds?: Array<{ userId: string; reason: AgentOperationMemberApplySkippedReason }>;
};

export type AgentOperationResult = {
  albumId?: string;
  spaceId?: string;
  tagId?: string;
  assetIds?: string[];
  assetResults?: AgentOperationAssetResult[];
  userIds?: string[];
  skippedUserIds?: Array<{ userId: string; reason: AgentOperationMemberApplySkippedReason }>;
  skippedReason?: string;
};
```

Also extend `AgentToolOperationPlanRequestMetadata` with `userIds?: string[]`, collect user ids from member payloads in the existing planning metadata redaction helper, and include only ids in `redactedRequestMetadata`. Names/emails stay in `operation.summary` for UI display, not in tool-call metadata.

Add payload helpers with strict runtime checks even though DTO validation already exists:

```ts
const assignableSpaceMemberRoleSchema = z.enum([SharedSpaceRole.Editor, SharedSpaceRole.Viewer]);

private requireSpaceAddMembersPayload(payload: unknown, summary: string): {
  members: { userId: string; role: SharedSpaceRole.Editor | SharedSpaceRole.Viewer }[];
} {
  const parsed = z
    .strictObject({
      members: z.array(z.strictObject({ userId: z.uuidv4(), role: assignableSpaceMemberRoleSchema })).min(1),
    })
    .safeParse(payload);
  if (!parsed.success) {
    throw new BadRequestException(`${summary} has invalid member payload`);
  }
  return parsed.data;
}

private requireUserIdsPayload(payload: unknown, summary: string): { userIds: string[] } {
  const parsed = z.strictObject({ userIds: z.array(z.uuidv4()).min(1) }).safeParse(payload);
  if (!parsed.success) {
    throw new BadRequestException(`${summary} has invalid userIds payload`);
  }
  return parsed.data;
}

private requireSpaceUpdateMemberRolePayload(payload: unknown, summary: string): {
  userIds: string[];
  role: SharedSpaceRole.Editor | SharedSpaceRole.Viewer;
} {
  const parsed = z
    .strictObject({ userIds: z.array(z.uuidv4()).min(1), role: assignableSpaceMemberRoleSchema })
    .safeParse(payload);
  if (!parsed.success) {
    throw new BadRequestException(`${summary} has invalid member role payload`);
  }
  return parsed.data;
}
```

- [ ] **Step 5: Add current-user, owner-role, and last-owner protections**

Add to `server/src/services/agent-operation-plan.service.ts`:

```ts
private validateSafeSpaceMemberRemoval(
  auth: AuthDto,
  userIds: string[],
  members: Array<{ userId: string; role: SharedSpaceRole }>,
) {
  if (userIds.includes(auth.user.id)) {
    throw new BadRequestException('Pi cannot remove the current user from a space');
  }

  const ownerIds = members
    .filter((member) => member.role === SharedSpaceRole.Owner)
    .map((member) => member.userId);
  const removedOwnerIds = ownerIds.filter((ownerId) => userIds.includes(ownerId));

  if (ownerIds.length > 0 && removedOwnerIds.length >= ownerIds.length) {
    throw new BadRequestException('Pi cannot remove the last owner from a space');
  }
}

private validateSafeSpaceMemberRoleUpdate(
  auth: AuthDto,
  userIds: string[],
  members: Array<{ userId: string; role: SharedSpaceRole }>,
) {
  if (userIds.includes(auth.user.id)) {
    throw new BadRequestException('Pi cannot change the current user role in a space');
  }

  const ownerIds = members
    .filter((member) => member.role === SharedSpaceRole.Owner)
    .map((member) => member.userId);
  const changedOwnerIds = ownerIds.filter((ownerId) => userIds.includes(ownerId));
  if (ownerIds.length > 0 && changedOwnerIds.length >= ownerIds.length) {
    throw new BadRequestException('Pi cannot change the last owner role in a space');
  }
}
```

- [ ] **Step 6: Add access preflight for member operations**

Modify `validateNormalAccess()` so `space.addMembers`, `space.removeMembers`, and `space.updateMemberRole` require owner access:

```ts
const ownerSpaceIds = new Set(
  operations
    .filter(
      (operation) =>
        (operation.type === AgentOperationType.SpaceUpdateDetails ||
          operation.type === AgentOperationType.SpaceAddMembers ||
          operation.type === AgentOperationType.SpaceRemoveMembers ||
          operation.type === AgentOperationType.SpaceUpdateMemberRole) &&
        operation.targetKind === AgentOperationTargetKind.ExistingSpace &&
        operation.targetId,
    )
    .map((operation) => operation.targetId as string),
);
```

Keep asset add/remove operations under the existing editor role path.

- [ ] **Step 7: Write and pass assistant-flow member test**

Add an in-memory `AgentOperationPlanRepository` to `server/src/services/agent-runner-flow.integration.spec.ts`, instantiate `AgentOperationPlanService` in `setup()`, and expose it as `harness.operationPlanService`. The in-memory repository needs these methods for this test: `createReplacementRevision`, `getCurrentBySessionId`, `getAppliedBySessionId`, `getByIdForSession`, `claimCurrentForApply`, and `completeApply`.

Add this helper near the existing `space()` helper:

```ts
const makeSharedSpaceMember = (overrides: { userId: string; role: SharedSpaceRole; name?: string }) => ({
  spaceId: '00000000-0000-4000-8000-000000000401',
  userId: overrides.userId,
  role: overrides.role,
  joinedAt: now(),
  showInTimeline: true,
  sharePersonMetadata: true,
  lastViewedAt: null,
  name: overrides.name ?? 'Member',
  email: `${overrides.userId}@example.com`,
  profileImagePath: null,
  profileChangedAt: now(),
  avatarColor: null,
});
```

Then add this integration test:

```ts
it('resolves a space and user, proposes and applies a member plan, shows applied history, and keeps chat open', async () => {
  const harness = setup();
  const alexId = '00000000-0000-4000-8000-000000000030';
  const spaceId = '00000000-0000-4000-8000-000000000401';
  harness.userService.search.mockResolvedValue([
    {
      id: alexId,
      name: 'Alex',
      email: 'alex@example.com',
      avatarColor: 'blue',
      profileImagePath: '',
      profileChangedAt: '2026-05-20T09:00:00.000Z',
    },
  ]);
  harness.sharedSpaceService.getMembers.mockResolvedValue([
    makeSharedSpaceMember({ userId: harness.auth.user.id, role: SharedSpaceRole.Owner, name: 'Pierre' }),
  ]);
  harness.sharedSpaceService.addMember.mockResolvedValue(
    makeSharedSpaceMember({ userId: alexId, role: SharedSpaceRole.Editor, name: 'Alex' }),
  );
  harness.runnerRepository.streamMessage.mockImplementationOnce(async function* ({ body }) {
    const listResult = await harness.toolService.listSpaces(harness.auth, body.gallerySessionId, {});
    const readResult = await harness.toolService.readSpace(harness.auth, body.gallerySessionId, {
      spaceId,
    });
    const userResult = await harness.toolService.searchUsers(harness.auth, body.gallerySessionId, {
      query: 'Alex',
      limit: 10,
    });
    expect(listResult.status).toBe('success');
    expect(readResult.status).toBe('success');
    expect(userResult.status).toBe('success');
    const planResult = await harness.operationPlanService.proposeAlbumOperations(harness.auth, body.gallerySessionId, {
      summary: 'Add Alex to Family as editor.',
      operations: [
        {
          type: AgentOperationType.SpaceAddMembers,
          summary: 'Add Alex as editor.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: { members: [{ userId: alexId, role: SharedSpaceRole.Editor }] },
        },
      ],
    });
    expect(planResult.plan.status).toBe(AgentOperationPlanStatus.Proposed);
    yield {
      type: 'assistant-message-completed',
      sessionId: body.gallerySessionId,
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-1',
      content: { blocks: [{ type: 'text', text: 'I prepared a plan to add Alex as editor.' }] },
    };
  });

  const session = await harness.sessionService.create(harness.auth, {
    providerCredentialId: '00000000-0000-4000-8000-000000000201',
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.LocalPowerUser,
    approvalMode: AgentApprovalMode.PlanOnly,
    initialContext: {},
  });

  await harness.messageService.appendUserMessage(harness.auth, session.id, {
    content: { blocks: [{ type: 'text', text: 'Add Alex to the Family space as an editor.' }] },
  });

  await waitFor(async () => {
    const messages = await harness.messageService.getMessages(harness.auth, session.id);
    const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
    const currentPlan = await harness.operationPlanService.getCurrentPlan(harness.auth, session.id);
    expect(messages).toEqual([
      expect.objectContaining({ role: AgentMessageRole.User }),
      expect.objectContaining({
        role: AgentMessageRole.Assistant,
        content: { blocks: [{ type: 'text', text: 'I prepared a plan to add Alex as editor.' }] },
      }),
    ]);
    expect(currentPlan).toEqual(
      expect.objectContaining({
        status: AgentOperationPlanStatus.Proposed,
        operations: [
          expect.objectContaining({
            type: AgentOperationType.SpaceAddMembers,
            summary: 'Add Alex as editor.',
          }),
        ],
      }),
    );
    expect(reloadedSession?.status).toBe(AgentSessionStatus.WaitingForPlanReview);
  });

  const currentPlan = await harness.operationPlanService.getCurrentPlan(harness.auth, session.id);
  expect(currentPlan).not.toBeNull();
  const applyResult = await harness.operationPlanService.applyApprovedOperations(
    harness.auth,
    session.id,
    currentPlan!.id,
    {
      planRevision: currentPlan!.revision,
      operationIds: currentPlan!.operations.map((operation) => operation.id),
    },
  );

  expect(applyResult.plan.operations[0]).toMatchObject({
    status: AgentOperationStatus.Applied,
    result: { spaceId, userIds: [alexId], skippedUserIds: [] },
  });
  expect(harness.sharedSpaceService.addMember).toHaveBeenCalledWith(harness.auth, spaceId, {
    userId: alexId,
    role: SharedSpaceRole.Editor,
  });

  await waitFor(async () => {
    const appliedPlans = await harness.operationPlanService.getAppliedPlans(harness.auth, session.id);
    const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
    expect(appliedPlans).toHaveLength(1);
    expect(appliedPlans[0].operations[0]).toMatchObject({ type: AgentOperationType.SpaceAddMembers });
    expect(reloadedSession?.status).toBe(AgentSessionStatus.Running);
  });
});
```

Extend the local `setup()` helper to include `userService`, `sharedSpaceService`, `operationPlanService`, and the in-memory plan repository. Pass `userService` into `AgentToolService` when Task 2 adds that constructor dependency. The test must fail if the runner only emits a text message without storing a proposed plan, or if applying the plan ends the session instead of returning it to `Running`.

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
```

Expected: PASS for member apply and flow coverage.

- [ ] **Step 8: Commit Task 4**

```bash
git add server/src/types/agent-tool.types.ts server/src/types/agent-operation.types.ts server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/services/agent-runner-flow.integration.spec.ts
git commit -m "feat: apply pi space member plans"
```

---

### Task 5: Frontend Review UI And Applied Cards

**Files:**

- Modify: `i18n/en.json`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

- [ ] **Step 1: Write failing UI model tests**

Add to `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`:

```ts
it('summarizes shared-space member operations with person selection counts', () => {
  const plan = makePlan({
    operations: [
      makeOperation({
        type: AgentOperationType.SpaceAddMembers,
        summary: 'Add Alex as editor.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: spaceId,
        payload: {
          members: [
            { userId: alexId, role: 'editor' },
            { userId: beaId, role: 'viewer' },
          ],
        },
      }),
      makeOperation({
        type: AgentOperationType.SpaceUpdateMemberRole,
        summary: 'Make Sam a viewer.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: spaceId,
        payload: { userIds: [samId], role: 'viewer' },
      }),
    ],
  });

  const model = buildOperationReviewModel(plan, {
    selectedOperationIds: plan.operations.map((operation) => operation.id),
    itemSelections: {
      [plan.operations[0].id]: { itemKind: 'person', mode: 'only', itemIds: [beaId] },
    },
  });

  expect(model.groups[0].destination.kind).toBe('space');
  expect(model.groups[0].operations[0].summary).toBe('Add 2 members');
  expect(model.groups[0].operations[0].selection).toMatchObject({
    itemKind: 'person',
    totalCount: 2,
    selectedCount: 1,
  });
  expect(model.groups[0].operations[1].summary).toBe('Change 1 member to viewer');
});

it('builds apply selection payloads for selected people', () => {
  const operation = makeOperation({
    type: AgentOperationType.SpaceRemoveMembers,
    payload: { userIds: [alexId, beaId] },
  });

  const model = buildOperationReviewModel(makePlan({ operations: [operation] }), {
    selectedOperationIds: [operation.id],
    itemSelections: {
      [operation.id]: { itemKind: 'person', mode: 'allExcept', itemIds: [alexId] },
    },
  });

  expect(buildOperationSelectionPayload(model)).toMatchObject({
    operationIds: [operation.id],
    itemSelections: {
      [operation.id]: { itemKind: 'person', mode: 'allExcept', itemIds: [alexId] },
    },
  });
});
```

Run:

```bash
pnpm --dir web exec vitest --run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts'
```

Expected: FAIL because member operations are unknown and selection is asset-only.

- [ ] **Step 2: Implement member UI model support**

Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`.

Add type labels:

```ts
[AgentOperationType.SpaceAddMembers]: 'assistant_operation_type_space_add_members' as Translations,
[AgentOperationType.SpaceRemoveMembers]: 'assistant_operation_type_space_remove_members' as Translations,
[AgentOperationType.SpaceUpdateMemberRole]: 'assistant_operation_type_space_update_member_role' as Translations,
```

Add member helpers:

```ts
const getMemberIds = (operation: AgentOperationResponseDto) => {
  if (operation.type === AgentOperationType.SpaceAddMembers) {
    const members = operation.payload.members;
    return Array.isArray(members)
      ? members.flatMap((member) => (isRecord(member) && typeof member.userId === 'string' ? [member.userId] : []))
      : [];
  }

  if (
    operation.type === AgentOperationType.SpaceRemoveMembers ||
    operation.type === AgentOperationType.SpaceUpdateMemberRole
  ) {
    return getStringArray(operation.payload.userIds) ?? [];
  }

  return [];
};

const formatMemberCount = (count: number) => `${count} ${count === 1 ? 'member' : 'members'}`;
```

Generalize `buildOperationReviewSelection()` to use `getMemberIds()` when `operation.assetIds.length === 0`. For member operations, set `itemKind: 'person'`, `supportsItemSelection: true`, and counts from member ids.

Add summaries:

```ts
case AgentOperationType.SpaceAddMembers:
  return `Add ${formatMemberCount(getMemberIds(operation).length)}`;
case AgentOperationType.SpaceRemoveMembers:
  return `Remove ${formatMemberCount(getMemberIds(operation).length)}`;
case AgentOperationType.SpaceUpdateMemberRole: {
  const role = getRawStringPayloadValue(operation, 'role') || 'new role';
  return `Change ${formatMemberCount(getMemberIds(operation).length)} to ${role}`;
}
```

Keep using `operation.summary` in the rendered details so Pi-provided names such as `Add Alex as editor` remain visible.

For applied cards, read member apply result metadata from `operation.result.userIds` and `operation.result.skippedUserIds`. Render the primary count from the original operation payload, and render a compact result line such as `1 applied · 1 skipped` when skipped no-op member changes exist. Do not render raw user ids outside expanded technical details.

- [ ] **Step 3: Write failing review panel and applied card tests**

Add to `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`:

```ts
it('renders member-management plans without raw user ids by default', () => {
  render(AgentOperationPlanReviewPanel, {
    props: makeReviewProps({
      plan: makePlan({
        operations: [
          makeOperation({
            type: AgentOperationType.SpaceAddMembers,
            summary: 'Add Alex as editor.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            payload: { members: [{ userId: alexId, role: 'editor' }] },
          }),
        ],
      }),
    }),
  });

  expect(screen.getByText('Add 1 member')).toBeInTheDocument();
  expect(screen.getByText('Add Alex as editor.')).toBeInTheDocument();
  expect(screen.getByText('1 of 1 members selected')).toBeInTheDocument();
  expect(screen.queryByText(alexId)).not.toBeInTheDocument();
});
```

Add to `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`:

```ts
it('summarizes applied shared-space member operations', () => {
  render(AgentAppliedPlanTimelineCard, {
    props: {
      plan: makeAppliedPlan({
        operations: [
          makeAppliedOperation({
            type: AgentOperationType.SpaceUpdateMemberRole,
            summary: 'Make Sam a viewer.',
            payload: { userIds: [samId], role: 'viewer' },
            result: {
              spaceId,
              userIds: [samId],
              skippedUserIds: [{ userId: alexId, reason: 'same_role' }],
            },
          }),
        ],
      }),
    },
  });

  expect(screen.getByText('Change 1 member to viewer')).toBeInTheDocument();
  expect(screen.getByText('Make Sam a viewer.')).toBeInTheDocument();
  expect(screen.getByText('1 applied · 1 skipped')).toBeInTheDocument();
});
```

Run:

```bash
pnpm --dir web exec vitest --run 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts'
```

Expected: FAIL until rendering uses person counts, labels, and skipped-member result metadata.

- [ ] **Step 4: Update activity and approval labels**

Modify `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts` and `agent-activity-ui.ts` so:

```ts
AgentToolName.SearchUsers => 'Find people'
AgentOperationType.SpaceAddMembers => 'Add space members'
AgentOperationType.SpaceRemoveMembers => 'Remove space members'
AgentOperationType.SpaceUpdateMemberRole => 'Change space member roles'
```

Add tests to the matching `.spec.ts` files that assert low-information labels:

```ts
expect(formatAgentToolApprovalRequest(makeToolCall({ toolName: AgentToolName.SearchUsers })).title).toBe('Find people');
expect(formatAgentActivityStep(makeActivity({ operationTypes: [AgentOperationType.SpaceAddMembers] })).label).toBe(
  'Add space members',
);
```

Use the actual exported formatter names in those files.

- [ ] **Step 5: Add translations**

Modify `i18n/en.json`:

```json
"assistant_operation_type_space_add_members": "Add members",
"assistant_operation_type_space_remove_members": "Remove members",
"assistant_operation_type_space_update_member_role": "Change member role"
```

- [ ] **Step 6: Run focused web tests**

Run:

```bash
pnpm --dir web exec vitest --run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts' 'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts' 'src/routes/(user)/assistant/agent-activity-ui.spec.ts'
```

Expected: PASS for UI model, review panel, applied card, activity labels, and approval labels.

- [ ] **Step 7: Commit Task 5**

```bash
git add i18n/en.json 'web/src/routes/(user)/assistant/agent-operation-plan-ui.ts' 'web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' 'web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts' 'web/src/routes/(user)/assistant/agent-tool-approval-ui.ts' 'web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts' 'web/src/routes/(user)/assistant/agent-activity-ui.ts' 'web/src/routes/(user)/assistant/agent-activity-ui.spec.ts'
git commit -m "feat: show pi space member plans in review"
```

---

### Task 6: Generated API Artifacts And Full Slice Verification

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
- Modify: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Modify: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Regenerate server and API artifacts**

Run:

```bash
pnpm --dir server build
pnpm --dir server run sync:open-api
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
```

Expected: generated OpenAPI, SDK, MCP docs, and runner prompt update. If `sync:open-api` reports no changes because generated artifacts are already current, continue.

- [ ] **Step 2: Run focused server verification**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session.dto.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run focused web verification**

Run:

```bash
pnpm --dir web exec vitest --run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts' 'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts' 'src/routes/(user)/assistant/agent-activity-ui.spec.ts' 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected: PASS.

- [ ] **Step 4: Run final repository checks**

Run:

```bash
pnpm --filter immich check
git diff --check
git status --short
```

Expected:

- `pnpm --filter immich check` exits `0`.
- `git diff --check` prints no whitespace errors.
- `git status --short` shows only intended Slice 4 files.

- [ ] **Step 5: Commit generated artifacts and final fixes**

```bash
git add open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "chore: regenerate pi space member artifacts"
```

If Tasks 1-5 already included generated files in earlier commits and this task has no changes, skip this commit and record the clean status in the final handoff.

---

## Self-Review Checklist

- Spec coverage: Slice 4 requirements are covered by `searchUsers`, three member operation types, write-scope flags, MCP guidance, apply service calls, safety rejects, disabled-operation behavior, review UI, applied card, and assistant-flow tests that prove propose -> review -> apply -> applied history -> continued chat.
- TDD: Every task starts by adding focused failing tests before implementation and includes exact test commands.
- Edge cases: Multiple/no user matches, existing member, missing member, current-user removal/update, owner-role assignment, last-owner removal/demotion, same-role no-op apply skips, permission denial, stale membership, private-field redaction, disabled operations, selected member subsets, and skipped-member applied-card summaries are covered.
- Consistency: All writes stay behind operation-plan review; no direct mutation MCP tool is added; member operations target `existing_space` with `targetId`.
- Privacy: `searchUsers` uses `UserService.search(auth)` as the visibility gate and returns only `userId`, `name`, optional already-visible `email`, `avatarColor`, and `profileImagePath`; planning audit metadata stores member user ids only, not names/emails.
- Generated artifacts: OpenAPI/SDK, MCP docs, and runner prompt are regenerated after DTO/contract changes.
