# Pi Agent Search Filter Parity Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `resolveAssetSearchFilters` MCP tool that turns user-facing gallery names into canonical search filter IDs/values before Pi calls `searchAssets`.

**Architecture:** The resolver lives in the existing agent read-tool path so it inherits permission policy, audit trail, approval retry, MCP schema generation, correction hints, generated docs, and runner prompt sync. It resolves only entities visible in the current session scope, returns one canonical `resolvedFilters` object when matches are unambiguous, and returns explicit ambiguous/not-found items with choices instead of guessing.

**Tech Stack:** NestJS services, Zod DTO schemas, Kysely repositories, Vitest, generated MCP prompt/docs sync.

---

## File Structure

- Modify `server/src/enum.ts`: add `AgentToolName.ResolveAssetSearchFilters`.
- Modify `server/src/dtos/agent-tool.dto.ts`: add resolver request schema, response schema, DTO exports, and `AgentReadToolRequestSchemas` entry.
- Modify `server/src/types/agent-tool.types.ts`: add resolver metadata and result item types.
- Modify `server/src/services/agent-tool.service.ts`: add public method, approved-retry dispatch, descriptor, and visible-scope resolver helpers.
- Modify `server/src/services/agent-mcp.service.ts`: register and dispatch the read tool.
- Modify `server/src/types/agent-mcp-contract.types.ts`: include the resolver in `AgentMcpReadToolName`.
- Modify `server/src/services/agent-mcp-tool-contract.service.ts`: add the resolver contract, examples, common mistakes, and failure-matrix coverage.
- Modify `server/src/services/agent-mcp-tool-registry.service.ts`: expose the resolver in `tools/list` with enriched property descriptions.
- Modify `server/src/services/agent-mcp-prompt.service.ts`: include one compact resolver example and prompt guidance.
- Modify `server/src/services/agent-mcp-docs.service.ts`: no logic change expected unless generated examples require a docs JSON-RPC read example preference update.
- Modify generated artifacts:
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Test files:
  - `server/src/dtos/agent-tool.dto.spec.ts`
  - `server/src/services/agent-tool.service.spec.ts`
  - `server/src/services/agent-mcp.service.spec.ts`
  - `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - `server/src/services/agent-mcp-prompt.service.spec.ts`
  - `server/src/services/agent-mcp-docs.service.spec.ts`
  - `server/src/controllers/agent-runner-mcp.controller.spec.ts`

## Resolver Contract

The new MCP tool name is `resolveAssetSearchFilters`. It is a metadata read tool and uses the same approval behavior as `searchAssets`.

Request shape:

```ts
{
  people?: string[];
  tags?: string[];
  albums?: string[];
  spaces?: string[];
  cameraMakes?: string[];
  cameraModels?: string[];
  lensModels?: string[];
  scope?: {
    spaceId?: string;
    withSharedSpaces?: boolean;
    takenAfter?: Date;
    takenBefore?: Date;
  };
  toolCallId?: string;
}
```

Rules:

- Names are trimmed, non-empty, capped at 20 values per kind and 120 characters per value.
- `toolCallId` is mutually exclusive with all resolver fields.
- `scope.spaceId` and `scope.withSharedSpaces` are mutually exclusive.
- `scope.spaceId` must be visible to the session user.
- Inaccessible albums, spaces, people, and tags are not disclosed. The resolver only searches visible collections.
- Exact case-insensitive matches become `status: "matched"` when exactly one visible candidate matches.
- Multiple exact case-insensitive visible matches become `status: "ambiguous"` with visible choices and do not populate `resolvedFilters`.
- No exact match becomes `status: "not_found"` with up to five visible suggestions when available.
- Camera make/model/lens values are canonicalized to visible EXIF values; `cameraMakes` include related visible model choices when one make matches.

Success response shape:

```ts
{
  status: 'success';
  toolCall: AgentToolCallResponseDto;
  resolvedFilters: AgentSearchAssetsFilters;
  results: Array<{
    kind: 'person' | 'tag' | 'album' | 'space' | 'cameraMake' | 'cameraModel' | 'lensModel';
    query: string;
    status: 'matched' | 'ambiguous' | 'not_found';
    value?: string;
    id?: string;
    searchFilter?: Partial<AgentSearchAssetsFilters>;
    choices: Array<{ id?: string; value: string; label: string; searchFilter?: Partial<AgentSearchAssetsFilters> }>;
    message: string;
  }>;
}
```

## Task 1: DTO Schema And Type Foundation

**Files:**

- Modify `server/src/enum.ts`
- Modify `server/src/dtos/agent-tool.dto.ts`
- Modify `server/src/dtos/agent-tool.dto.spec.ts`
- Modify `server/src/types/agent-tool.types.ts`

- [ ] **Step 1: Write failing DTO tests**

Add tests to `server/src/dtos/agent-tool.dto.spec.ts` near the read-tool schema tests:

```ts
describe('AgentResolveAssetSearchFiltersToolRequestSchema', () => {
  it('accepts visible-name resolver fields and defaults to normal request mode', () => {
    const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({
      people: ['Pierre'],
      tags: ['Travel'],
      albums: ['Berlin'],
      spaces: ['Family'],
      cameraMakes: ['FUJIFILM'],
      cameraModels: ['X100V'],
      lensModels: ['23mm'],
      scope: { withSharedSpaces: true, takenAfter: '2026-05-01T00:00:00.000Z' },
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      people: ['Pierre'],
      tags: ['Travel'],
      albums: ['Berlin'],
      spaces: ['Family'],
      cameraMakes: ['FUJIFILM'],
      cameraModels: ['X100V'],
      lensModels: ['23mm'],
      scope: { withSharedSpaces: true },
    });
  });

  it('rejects toolCallId combined with resolver fields', () => {
    const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({
      toolCallId: factory.uuid(),
      tags: ['Travel'],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Provide either resolver fields or toolCallId, not both');
  });

  it('rejects empty requests that have no resolver fields', () => {
    const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Provide at least one resolver field');
  });

  it('rejects scope.spaceId mixed with scope.withSharedSpaces', () => {
    const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({
      people: ['Pierre'],
      scope: { spaceId: factory.uuid(), withSharedSpaces: true },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.join('.')).toBe('scope.withSharedSpaces');
    expect(result.error?.issues[0]?.message).toBe('Cannot use both scope.spaceId and scope.withSharedSpaces');
  });

  it('rejects too many or blank names with actionable paths', () => {
    const tooMany = Array.from({ length: 21 }, (_, index) => `tag-${index}`);
    const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({
      tags: tooMany,
      albums: ['  '],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['tags', 'albums.0']),
    );
  });
});
```

Run: `pnpm --dir server test src/dtos/agent-tool.dto.spec.ts -- --runInBand`

Expected: FAIL because `AgentToolName.ResolveAssetSearchFilters` and its schema do not exist.

- [ ] **Step 2: Add minimal enum, schema, response, and types**

In `server/src/enum.ts` add:

```ts
ResolveAssetSearchFilters = 'resolveAssetSearchFilters',
```

In `server/src/dtos/agent-tool.dto.ts` add constants:

```ts
const MAX_RESOLVE_FILTER_NAMES_PER_KIND = 20;
const MAX_RESOLVE_FILTER_NAME_LENGTH = 120;
const resolverNameList = z
  .array(z.string().trim().min(1).max(MAX_RESOLVE_FILTER_NAME_LENGTH))
  .min(1)
  .max(MAX_RESOLVE_FILTER_NAMES_PER_KIND);
```

Add schemas:

```ts
const AgentResolveAssetSearchFiltersScopeSchema = z
  .strictObject({
    spaceId: uuid.optional(),
    withSharedSpaces: z.boolean().optional(),
    takenAfter: isoDatetimeToDate.optional(),
    takenBefore: isoDatetimeToDate.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.spaceId && value.withSharedSpaces) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['withSharedSpaces'],
        message: 'Cannot use both scope.spaceId and scope.withSharedSpaces',
      });
    }
  })
  .meta({ id: 'AgentResolveAssetSearchFiltersScope' });

const AgentResolveAssetSearchFiltersToolRequestSchema = z
  .strictObject({
    people: resolverNameList.optional(),
    tags: resolverNameList.optional(),
    albums: resolverNameList.optional(),
    spaces: resolverNameList.optional(),
    cameraMakes: resolverNameList.optional(),
    cameraModels: resolverNameList.optional(),
    lensModels: resolverNameList.optional(),
    scope: AgentResolveAssetSearchFiltersScopeSchema.optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    const hasResolverFields = [
      value.people,
      value.tags,
      value.albums,
      value.spaces,
      value.cameraMakes,
      value.cameraModels,
      value.lensModels,
    ].some((field) => field !== undefined);

    if (value.toolCallId && (hasResolverFields || value.scope !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide either resolver fields or toolCallId, not both' });
    }

    if (!value.toolCallId && !hasResolverFields) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide at least one resolver field' });
    }
  })
  .meta({ id: 'AgentResolveAssetSearchFiltersToolRequestDto' });
```

Add to `AgentReadToolRequestSchemas`:

```ts
[AgentToolName.ResolveAssetSearchFilters]: AgentResolveAssetSearchFiltersToolRequestSchema,
```

Add response schemas:

```ts
const AgentResolvedAssetSearchFilterChoiceSchema = z
  .object({
    id: uuid.optional(),
    value: z.string(),
    label: z.string(),
    searchFilter: AgentSearchAssetsFiltersSchema.partial().optional(),
  })
  .meta({ id: 'AgentResolvedAssetSearchFilterChoice' });

const AgentResolvedAssetSearchFilterResultSchema = z
  .object({
    kind: z.enum(['person', 'tag', 'album', 'space', 'cameraMake', 'cameraModel', 'lensModel']),
    query: z.string(),
    status: z.enum(['matched', 'ambiguous', 'not_found']),
    id: uuid.optional(),
    value: z.string().optional(),
    searchFilter: AgentSearchAssetsFiltersSchema.partial().optional(),
    choices: z.array(AgentResolvedAssetSearchFilterChoiceSchema),
    message: z.string(),
  })
  .meta({ id: 'AgentResolvedAssetSearchFilterResult' });

const AgentResolveAssetSearchFiltersToolResponseSchema = z
  .discriminatedUnion('status', [
    approvalRequiredResponse('AgentResolveAssetSearchFiltersToolApprovalRequiredResponse'),
    deniedResponse('AgentResolveAssetSearchFiltersToolDeniedResponse'),
    z
      .object({
        status: z.literal('success'),
        toolCall: AgentToolCallResponseSchema,
        resolvedFilters: AgentSearchAssetsFiltersSchema,
        results: z.array(AgentResolvedAssetSearchFilterResultSchema),
      })
      .meta({ id: 'AgentResolveAssetSearchFiltersToolSuccessResponse' }),
  ])
  .meta({ id: 'AgentResolveAssetSearchFiltersToolResponseDto' });
```

Export:

```ts
export class AgentResolveAssetSearchFiltersToolRequestDto extends createZodDto(
  AgentResolveAssetSearchFiltersToolRequestSchema,
) {}
export const AgentResolveAssetSearchFiltersToolResponseDto = namedZodDto(
  'AgentResolveAssetSearchFiltersToolResponseDto',
  AgentResolveAssetSearchFiltersToolResponseSchema,
);
export type AgentResolveAssetSearchFiltersToolResponseDto = z.output<
  typeof AgentResolveAssetSearchFiltersToolResponseSchema
>;
```

In `server/src/types/agent-tool.types.ts` add:

```ts
export type AgentResolveAssetSearchFiltersScope = {
  spaceId?: string;
  withSharedSpaces?: boolean;
  takenAfter?: Date;
  takenBefore?: Date;
};

export type AgentToolResolveAssetSearchFiltersRequestMetadata = {
  people?: string[];
  tags?: string[];
  albums?: string[];
  spaces?: string[];
  cameraMakes?: string[];
  cameraModels?: string[];
  lensModels?: string[];
  scope?: AgentResolveAssetSearchFiltersScope;
};

export type AgentResolvedAssetSearchFilterKind =
  | 'person'
  | 'tag'
  | 'album'
  | 'space'
  | 'cameraMake'
  | 'cameraModel'
  | 'lensModel';

export type AgentResolvedAssetSearchFilterChoice = {
  id?: string;
  value: string;
  label: string;
  searchFilter?: Partial<AgentSearchAssetsFilters>;
};

export type AgentResolvedAssetSearchFilterResult = {
  kind: AgentResolvedAssetSearchFilterKind;
  query: string;
  status: 'matched' | 'ambiguous' | 'not_found';
  id?: string;
  value?: string;
  searchFilter?: Partial<AgentSearchAssetsFilters>;
  choices: AgentResolvedAssetSearchFilterChoice[];
  message: string;
};
```

Add `AgentToolResolveAssetSearchFiltersRequestMetadata` to `AgentToolRequestMetadata`.

- [ ] **Step 3: Run DTO tests green**

Run: `pnpm --dir server test src/dtos/agent-tool.dto.spec.ts -- --runInBand`

Expected: PASS for the new DTO tests and existing DTO tests.

- [ ] **Step 4: Commit**

```bash
git add server/src/enum.ts server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/types/agent-tool.types.ts
git commit -m "feat: add pi search filter resolver dto"
```

## Task 2: Agent Tool Resolver Execution

**Files:**

- Modify `server/src/services/agent-tool.service.ts`
- Modify `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Add resolver helpers to `server/src/services/agent-tool.service.spec.ts`:

```ts
const makeResolverSession = (auth: ReturnType<typeof AuthFactory.create>, overrides: Partial<AgentSession> = {}) =>
  makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    ...overrides,
  });
```

Add tests near the search/list tool tests:

```ts
describe('resolveAssetSearchFilters', () => {
  it('resolves exact visible people, tags, albums, spaces, and camera values into search filters', async () => {
    const auth = AuthFactory.create();
    const session = makeResolverSession(auth);
    const personId = newUuid();
    const tagId = newUuid();
    const album = makeAlbumSummary({ id: newUuid(), ownerId: auth.user.id, albumName: 'Berlin' });
    const space = makeSpaceRow({ id: newUuid(), name: 'Family' });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: ['FUJIFILM'],
      tags: [{ id: tagId, value: 'Travel' }],
      people: [{ id: personId, name: 'Pierre', primaryProfile: { type: 'user-person', id: personId } }],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });
    searchRepository.getCameraModels.mockResolvedValue(['X100V', 'X-T5']);
    searchRepository.getCameraLensModels.mockResolvedValue(['23mm']);
    albumRepository.getAgentAlbums.mockResolvedValue([album]);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([space]);

    const result = await sut.resolveAssetSearchFilters(auth, session.id, {
      people: ['pierre'],
      tags: ['travel'],
      albums: ['berlin'],
      spaces: ['family'],
      cameraMakes: ['fujifilm'],
      cameraModels: ['x100v'],
      lensModels: ['23mm'],
      scope: { withSharedSpaces: true },
    });

    expect(result).toMatchObject({
      status: 'success',
      resolvedFilters: {
        personIds: [personId],
        tagIds: [tagId],
        albumIds: [album.id],
        spaceId: space.id,
        make: 'FUJIFILM',
        model: 'X100V',
        lensModel: '23mm',
      },
    });
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'person', status: 'matched', id: personId }),
        expect.objectContaining({ kind: 'tag', status: 'matched', id: tagId }),
        expect.objectContaining({ kind: 'album', status: 'matched', id: album.id }),
        expect.objectContaining({ kind: 'space', status: 'matched', id: space.id }),
        expect.objectContaining({
          kind: 'cameraMake',
          status: 'matched',
          value: 'FUJIFILM',
          choices: expect.arrayContaining([expect.objectContaining({ value: 'X100V' })]),
        }),
      ]),
    );
    expect(searchRepository.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.objectContaining({ timelineSpaceIds: expect.any(Array) }),
    );
  });

  it('returns ambiguous choices for duplicate exact visible names without adding resolved filters', async () => {
    const auth = AuthFactory.create();
    const session = makeResolverSession(auth);
    const firstAlbum = makeAlbumSummary({ albumName: 'Trips', ownerId: auth.user.id });
    const secondAlbum = makeAlbumSummary({ albumName: 'trips', ownerId: auth.user.id });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.getFilterSuggestions.mockResolvedValue(emptyFilterSuggestions());
    albumRepository.getAgentAlbums.mockResolvedValue([firstAlbum, secondAlbum]);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([]);

    const result = await sut.resolveAssetSearchFilters(auth, session.id, { albums: ['Trips'] });

    expect(result.status).toBe('success');
    expect(result.resolvedFilters).toEqual({});
    expect(result.results).toContainEqual(
      expect.objectContaining({
        kind: 'album',
        query: 'Trips',
        status: 'ambiguous',
        choices: [
          expect.objectContaining({ id: firstAlbum.id, label: 'Trips' }),
          expect.objectContaining({ id: secondAlbum.id, label: 'trips' }),
        ],
      }),
    );
  });

  it('returns not_found with suggestions for missing names and does not leak inaccessible entities', async () => {
    const auth = AuthFactory.create();
    const session = makeResolverSession(auth);
    const visibleTagId = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [{ id: visibleTagId, value: 'Travel' }],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });
    albumRepository.getAgentAlbums.mockResolvedValue([]);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([]);

    const result = await sut.resolveAssetSearchFilters(auth, session.id, { tags: ['Private'], albums: ['Hidden'] });

    expect(result.status).toBe('success');
    expect(result.resolvedFilters).toEqual({});
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tag',
          query: 'Private',
          status: 'not_found',
          choices: [expect.objectContaining({ id: visibleTagId, label: 'Travel' })],
        }),
        expect.objectContaining({ kind: 'album', query: 'Hidden', status: 'not_found', choices: [] }),
      ]),
    );
  });

  it('denies space-scoped resolution when shared spaces are not allowed', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.resolveAssetSearchFilters(auth, session.id, {
      spaces: ['Family'],
      scope: { withSharedSpaces: true },
    });

    expect(result).toMatchObject({
      status: 'denied',
      reason: 'Shared spaces are not accessible for this session',
    });
    expect(searchRepository.getFilterSuggestions).not.toHaveBeenCalled();
  });

  it('executes an approved resolver retry from the stored request metadata', async () => {
    const auth = AuthFactory.create();
    const session = makeResolverSession(auth, { status: AgentSessionStatus.WaitingForToolApproval });
    const approved = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ResolveAssetSearchFilters,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { tags: ['Travel'] },
    });
    const tagId = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [{ id: tagId, value: 'Travel' }],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });
    albumRepository.getAgentAlbums.mockResolvedValue([]);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([]);

    const result = await sut.resolveAssetSearchFilters(auth, session.id, { toolCallId: approved.id });

    expect(result).toMatchObject({ status: 'success', resolvedFilters: { tagIds: [tagId] } });
  });
});
```

If `emptyFilterSuggestions()` is not present, add it near the existing `makeSpaceRow()` helper:

```ts
const emptyFilterSuggestions = () => ({
  countries: [],
  cameraMakes: [],
  tags: [],
  people: [],
  ratings: [],
  mediaTypes: [],
  hasUnnamedPeople: false,
});
```

Run: `pnpm --dir server test src/services/agent-tool.service.spec.ts -- --runInBand`

Expected: FAIL because `resolveAssetSearchFilters` is not implemented.

- [ ] **Step 2: Implement the resolver service**

In `server/src/services/agent-tool.service.ts`, import the new DTO and types:

```ts
AgentResolveAssetSearchFiltersToolRequestDto,
AgentResolveAssetSearchFiltersToolResponseDto,
```

```ts
AgentResolvedAssetSearchFilterChoice,
AgentResolvedAssetSearchFilterKind,
AgentResolvedAssetSearchFilterResult,
AgentToolResolveAssetSearchFiltersRequestMetadata,
```

Add public method:

```ts
async resolveAssetSearchFilters(
  auth: AuthDto,
  sessionId: string,
  dto: AgentResolveAssetSearchFiltersToolRequestDto,
): Promise<AgentResolveAssetSearchFiltersToolResponseDto> {
  return this.runReadTool(auth, sessionId, dto, this.resolveAssetSearchFiltersDescriptor());
}
```

Add approved dispatch:

```ts
case AgentToolName.ResolveAssetSearchFilters: {
  return this.resolveAssetSearchFilters(auth, session.id, { toolCallId: toolCall.id });
}
```

Add descriptor:

```ts
private resolveAssetSearchFiltersDescriptor(): AgentReadToolDescriptor<
  AgentResolveAssetSearchFiltersToolRequestDto,
  { resolvedFilters: AgentSearchAssetsFilters; results: AgentResolvedAssetSearchFilterResult[] }
> {
  return {
    toolName: AgentToolName.ResolveAssetSearchFilters,
    dataClass: AgentToolDataClass.Metadata,
    requestSummary: (request) => `Resolve asset search filters (${this.getResolverTermCount(request)} term(s))`,
    requestMetadata: (request) =>
      ({
        people: request.people,
        tags: request.tags,
        albums: request.albums,
        spaces: request.spaces,
        cameraMakes: request.cameraMakes,
        cameraModels: request.cameraModels,
        lensModels: request.lensModels,
        scope: request.scope,
      }) as AgentToolResolveAssetSearchFiltersRequestMetadata,
    requestedAssetCount: () => 0,
    requestedAlbumCount: () => 0,
    perToolLimit: () => Number.MAX_SAFE_INTEGER,
    perSessionLimit: () => Number.MAX_SAFE_INTEGER,
    validateAccess: (auth, session, request) => this.validateResolveAssetSearchFiltersRequest(auth, session, request),
    execute: (auth, session, request) => this.resolveAssetSearchFilterRequest(auth, session, request),
    responseSummary: (result) =>
      `Resolved ${result.results.filter((item) => item.status === 'matched').length} search filter(s)`,
    responseMetadata: (result) => ({
      albumIds: result.resolvedFilters.albumIds,
      spaceIds: result.resolvedFilters.spaceId ? [result.resolvedFilters.spaceId] : undefined,
    }),
    resultAssetCount: () => 0,
    resultAlbumCount: () => 0,
    failedReason: 'Search filter resolution failed',
  };
}
```

Add helpers using the existing visible repositories:

```ts
private getResolverTermCount(request: AgentResolveAssetSearchFiltersToolRequestDto): number {
  return [
    request.people,
    request.tags,
    request.albums,
    request.spaces,
    request.cameraMakes,
    request.cameraModels,
    request.lensModels,
  ].reduce((count, values) => count + (values?.length ?? 0), 0);
}

private async validateResolveAssetSearchFiltersRequest(
  auth: AuthDto,
  session: AgentSession,
  request: AgentResolveAssetSearchFiltersToolRequestDto,
): Promise<string | null> {
  if ((request.scope?.withSharedSpaces || request.scope?.spaceId || request.spaces?.length) &&
      !session.permissionPlanSnapshot.assetScope.sharedSpaces) {
    return 'Shared spaces are not accessible for this session';
  }

  if (request.scope?.spaceId) {
    return this.validateSharedSpaceAccess(auth, session, request.scope.spaceId);
  }

  return null;
}
```

Implement `resolveAssetSearchFilterRequest` to:

- Load `timelineSpaceIds` with `sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id)` when `scope.withSharedSpaces` is true.
- Call `searchRepository.getFilterSuggestions([auth.user.id], { ...scope, timelineSpaceIds })` once for people/tags/camera make candidates.
- Call `searchRepository.getCameraModels([auth.user.id], { make: canonicalMake, ...scope })` for matched makes.
- Call `searchRepository.getCameraLensModels([auth.user.id], { make: resolvedFilters.make, model: resolvedFilters.model, ...scope })` when resolving lens models.
- Call `albumRepository.getAgentAlbums(auth.user.id)` and filter by `permissionPlanSnapshot.assetScope.owned/sharedSpaces`.
- Call `sharedSpaceRepository.getAllByUserId(auth.user.id)` only when shared spaces are allowed and space names are requested.
- Use a generic helper:

```ts
private resolveNamedCandidates<TCandidate extends { label: string; id?: string; value?: string }>(
  kind: AgentResolvedAssetSearchFilterKind,
  query: string,
  candidates: TCandidate[],
  toSearchFilter: (candidate: TCandidate) => Partial<AgentSearchAssetsFilters>,
): AgentResolvedAssetSearchFilterResult
```

The helper should:

- Compare exact matches with `candidate.label.toLocaleLowerCase() === query.trim().toLocaleLowerCase()`.
- Return `matched` only for one exact match and include `searchFilter`.
- Return `ambiguous` for more than one exact match and include all exact choices.
- Return `not_found` with up to five visible suggestions where label includes query or query includes label, falling back to the first five candidates.

Merge matched filters into `resolvedFilters`:

- `personIds`, `tagIds`, `albumIds`: append unique IDs.
- `spaceId`: set only if one space matched; if more than one requested space matches, leave only the first matched space out and return the later one as ambiguous with message `Only one spaceId can be used in searchAssets`.
- `make`, `model`, `lensModel`: set canonical string value.

- [ ] **Step 3: Run service tests green**

Run: `pnpm --dir server test src/services/agent-tool.service.spec.ts -- --runInBand`

Expected: PASS, including exact match, ambiguity, no-match, inaccessible shared scope, and approved retry tests.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts
git commit -m "feat: resolve pi asset search filter names"
```

## Task 3: MCP Runtime Registration And Validation Corrections

**Files:**

- Modify `server/src/services/agent-mcp.service.ts`
- Modify `server/src/types/agent-mcp-contract.types.ts`
- Modify `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify `server/src/services/agent-mcp.service.spec.ts`
- Modify `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify `server/src/controllers/agent-runner-mcp.controller.spec.ts`

- [ ] **Step 1: Write failing MCP runtime and contract tests**

In `server/src/services/agent-mcp.service.spec.ts`, add expectations that:

```ts
it('dispatches resolveAssetSearchFilters as a read tool', async () => {
  const serviceResult = { status: 'success', resolvedFilters: { tagIds: [factory.uuid()] }, results: [], toolCall };
  toolService.resolveAssetSearchFilters.mockResolvedValue(serviceResult);

  const response = await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ResolveAssetSearchFilters, { tags: ['Travel'] }),
  );

  expectToolResult(response, `${AgentToolName.ResolveAssetSearchFilters}-call`, serviceResult);
  expect(toolService.resolveAssetSearchFilters).toHaveBeenCalledWith(auth, sessionId, { tags: ['Travel'] });
});
```

Update existing `tools/list` and read-tool arrays to include `AgentToolName.ResolveAssetSearchFilters`.

Add a validation correction test. The returned `exampleArguments` must be valid `searchAssets` arguments because corrections are scoped to the tool that failed; the hint tells Pi to call the resolver first.

```ts
it('returns resolver correction when names are sent to searchAssets as filter strings', () => {
  const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
    requestShape: 'tool-arguments',
    issues: [{ path: 'filters.tagIds.0', message: 'Invalid UUID' }],
  });

  expect(correction?.hint).toContain('Use resolveAssetSearchFilters');
  expect(correction?.exampleArguments).toEqual({
    filters: {
      tagIds: ['00000000-0000-4000-8000-000000000030'],
      albumIds: ['00000000-0000-4000-8000-000000000010'],
    },
    limit: 25,
  });
});
```

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, assert:

```ts
it('documents resolveAssetSearchFilters before searchAssets for name-based filters', () => {
  const contract = sut.getReadToolContract(AgentToolName.ResolveAssetSearchFilters);

  expect(contract?.usage).toContain('Use this before searchAssets when the user gives names');
  expect(contract?.examples).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'resolve-named-filters', arguments: { tags: ['Travel'], albums: ['Berlin'] } }),
    ]),
  );
});

it('returns resolver corrections for malformed resolver calls', () => {
  const missing = sut.getReadToolValidationCorrection(AgentToolName.ResolveAssetSearchFilters, {
    requestShape: 'tool-arguments',
    issues: [{ path: '', message: 'Provide at least one resolver field' }],
  });
  const combined = sut.getReadToolValidationCorrection(AgentToolName.ResolveAssetSearchFilters, {
    requestShape: 'tool-arguments',
    issues: [{ path: '', message: 'Provide either resolver fields or toolCallId, not both' }],
  });

  expect(missing?.hint).toContain('Provide at least one of people, tags, albums, spaces, or camera fields');
  expect(combined?.hint).toContain('Use resolver fields for a new request or only toolCallId for an approved retry');
});
```

Run:

```bash
pnpm --dir server test src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts -- --runInBand
```

Expected: FAIL because the MCP service, contract type, and controller list do not include the new tool.

- [ ] **Step 2: Register the tool through MCP**

In `server/src/types/agent-mcp-contract.types.ts`, add `AgentToolName.ResolveAssetSearchFilters` to `AgentMcpReadToolName`.

In `server/src/services/agent-mcp.service.ts`:

- Add to `readToolNames`.
- Add dispatch:

```ts
case AgentToolName.ResolveAssetSearchFilters: {
  return this.toolService.resolveAssetSearchFilters(auth, sessionId, dto);
}
```

In `server/src/services/agent-mcp-tool-contract.service.ts`:

- Add `examplePersonId`, or reuse existing IDs for examples.
- Define `resolveAssetSearchFiltersContract` with examples:

```ts
const resolveAssetSearchFiltersContract: AgentMcpToolContract<AgentToolName.ResolveAssetSearchFilters> = {
  name: AgentToolName.ResolveAssetSearchFilters,
  title: 'Resolve asset search filters',
  description:
    'Resolve visible people, tags, albums, spaces, and camera names into searchAssets filter IDs or canonical values.',
  usage:
    'Use this before searchAssets when the user gives names instead of IDs. Do not guess IDs from names. If results are ambiguous or not_found, ask the user or narrow the request before searching.',
  argumentModes: [
    {
      name: 'resolve-names',
      description: 'Resolve visible names before a search.',
      requiredFields: [],
      forbiddenFields: ['toolCallId'],
      whenToUse:
        'Use when the user asks for assets by person, tag, album, space, camera make, camera model, or lens model names.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'resolve-named-filters',
      description: 'Resolve tag and album names before searching.',
      arguments: { tags: ['Travel'], albums: ['Berlin'] },
    },
    {
      name: 'resolve-space-person-filters',
      description: 'Resolve names in shared-space scope before searching.',
      arguments: { people: ['Pierre'], spaces: ['Family'], scope: { withSharedSpaces: true } },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'resolver-missing-fields',
      match: { messageIncludes: 'Provide at least one resolver field' },
      hint: 'Provide at least one of people, tags, albums, spaces, cameraMakes, cameraModels, or lensModels.',
      exampleName: 'resolve-named-filters',
    },
    {
      id: 'resolver-combined-fields-and-tool-call-id',
      match: { messageIncludes: 'Provide either resolver fields or toolCallId, not both' },
      hint: 'Use resolver fields for a new request or only toolCallId for an approved retry.',
      exampleName: 'approved-retry',
    },
    {
      id: 'resolver-space-scope-conflict',
      match: { issuePath: 'scope.withSharedSpaces' },
      hint: 'Use either scope.spaceId for one known space or scope.withSharedSpaces to include timeline-visible spaces, not both.',
      exampleName: 'resolve-space-person-filters',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Put resolver arguments at params.arguments in the MCP tools/call request.',
      exampleName: 'resolve-named-filters',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object, not an array, primitive, or null.',
      exampleName: 'resolve-named-filters',
    },
  ],
  approvalRetry,
  safety,
};
```

Add it to `readToolContracts` before `searchAssetsContract`.

Add this valid search example to `searchAssetsContract.examples`:

```ts
{
  name: 'resolved-id-filter-search',
  description: 'Search with IDs returned by resolveAssetSearchFilters.',
  arguments: {
    filters: {
      tagIds: [exampleTagId],
      albumIds: [exampleAlbumId],
    },
    limit: 25,
  },
}
```

Add `SearchAssets` common mistakes for invalid UUIDs in ID fields:

```ts
{
  id: 'search-name-sent-as-id-filter',
  match: { issuePath: 'filters.tagIds.0' },
  hint: 'Use resolveAssetSearchFilters with names first, then pass the returned tagIds to searchAssets.',
  exampleName: 'resolved-id-filter-search',
}
```

Repeat for `filters.albumIds.0`, `filters.personIds.0`, `filters.spaceId`, and `filters.spacePersonIds.0` using `exampleName: 'resolved-id-filter-search'` for the array ID mistakes and the existing `space-filter-search` example for `spaceId` or `spacePersonIds`.

- [ ] **Step 3: Run MCP tests green**

Run:

```bash
pnpm --dir server test src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/agent-mcp.service.ts server/src/types/agent-mcp-contract.types.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/controllers/agent-runner-mcp.controller.spec.ts
git commit -m "feat: expose pi search filter resolver over mcp"
```

## Task 4: Tool Registry, Prompt Guidance, And Generated Docs

**Files:**

- Modify `server/src/services/agent-mcp-tool-registry.service.ts`
- Modify `server/src/services/agent-mcp-prompt.service.ts`
- Modify `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify generated files:
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Write failing registry and prompt tests**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, assert:

```ts
it('lists resolveAssetSearchFilters with object input schema examples', () => {
  const tool = sut.listTools().find((candidate) => candidate.name === AgentToolName.ResolveAssetSearchFilters);

  expect(tool).toMatchObject({
    name: AgentToolName.ResolveAssetSearchFilters,
    title: 'Resolve asset search filters',
    annotations: expect.objectContaining({ readOnlyHint: true }),
  });
  expect(tool?.inputSchema.type).toBe('object');
  expect(tool?.inputSchema.examples).toEqual(
    expect.arrayContaining([expect.objectContaining({ tags: ['Travel'], albums: ['Berlin'] })]),
  );
});
```

In `server/src/services/agent-mcp-prompt.service.spec.ts`, assert:

```ts
it('teaches Pi to resolve names before passing ID filters to searchAssets', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('mcp_gallery_resolveAssetSearchFilters');
  expect(prompt).toContain('Resolve names before searchAssets');
  expect(prompt).toContain('"tags":["Travel"]');
});
```

In `server/src/services/agent-mcp-docs.service.spec.ts`, add an expectation that generated Markdown includes a `Resolve asset search filters` tool section and that all examples parse.

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -- --runInBand
```

Expected: FAIL because registry and prompt selections do not include the resolver.

- [ ] **Step 2: Implement registry and prompt updates**

In `server/src/services/agent-mcp-tool-registry.service.ts`:

- Add property descriptions:

```ts
people: 'Visible person names to resolve before searchAssets personIds.',
tags: 'Visible tag names to resolve before searchAssets tagIds.',
albums: 'Visible album names to resolve before searchAssets albumIds.',
spaces: 'Visible shared-space names to resolve before searchAssets spaceId.',
cameraMakes: 'Camera make names to canonicalize before searchAssets make.',
cameraModels: 'Camera model names to canonicalize before searchAssets model.',
lensModels: 'Lens model names to canonicalize before searchAssets lensModel.',
scope: 'Optional visible search scope used while resolving names.',
```

- Add a `defineTool` entry before `SearchAssets`:

```ts
defineTool({
  name: AgentToolName.ResolveAssetSearchFilters,
  title: 'Resolve asset search filters',
  description: `Resolve visible names to searchAssets filters before searching.${approvedRequestInstruction}`,
  schema: AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters],
  annotations: readToolAnnotations,
}),
```

In `server/src/services/agent-mcp-prompt.service.ts`:

- Add `ResolveAssetSearchFilters` to `promptExampleSelections`.
- Render guidance before search guidance:

```ts
const resolver = this.getPromptExample(examples, AgentToolName.ResolveAssetSearchFilters, 'resolve-named-filters');
...
`Resolve names before searchAssets: ${resolver.piToolName}: ${this.formatJson(resolver.arguments)}`,
```

Run the sync scripts:

```bash
pnpm --dir server build
pnpm --dir server sync:agent-mcp-prompt
pnpm --dir server sync:agent-mcp-docs
```

- [ ] **Step 3: Run registry, prompt, and docs tests green**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-docs.service.spec.ts agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "docs: teach pi to resolve search filter names"
```

## Task 5: Full Slice Verification

**Files:**

- All files touched by Tasks 1-4.

- [ ] **Step 1: Run focused slice tests**

Run:

```bash
pnpm --dir server test src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run CI-equivalent server checks**

Run:

```bash
pnpm --dir server check
pnpm --dir server lint
pnpm --dir server format
pnpm --dir docs format
git diff --check
```

Expected: all commands PASS and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Commit verification fixes if needed**

If checks required formatting or type fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize pi search filter resolver"
```

- [ ] **Step 4: Push Slice 3**

```bash
git status --short --branch
git push
```

Expected: branch pushes cleanly to `origin/explore/pi-agent-brainstorm`.

## Edge Case Coverage Checklist

- Exact person names resolve to `personIds`.
- Duplicate visible person display names return `ambiguous` choices and do not guess.
- Exact tag names resolve to `tagIds`.
- Tags with case-only differences return `ambiguous`.
- Exact album names resolve to `albumIds`.
- Duplicate visible album names return `ambiguous`.
- Exact space names resolve to `spaceId`.
- Duplicate or similar visible space names return choices without guessing.
- Inaccessible spaces are not disclosed; sessions without shared-space scope get a generic denial.
- Missing names return `not_found` with visible suggestions only.
- Camera makes canonicalize to visible EXIF values and include related model choices.
- Camera model and lens model values canonicalize with visible EXIF values.
- Malformed resolver calls return correction hints and example arguments.
- Search calls that use names where UUID arrays are required point Pi to `resolveAssetSearchFilters`.
- Approved retry with `toolCallId` reuses stored resolver request metadata.
