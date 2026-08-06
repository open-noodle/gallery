# Pi Agent MCP Tool Contracts Slice 1 Failure Matrix And Contract Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first MCP tool-contract vertical slice: a server-owned read-tool contract skeleton with executable examples and a small-model failure matrix that future slices can use for validation hints.

**Architecture:** Add a focused contract service next to the existing MCP registry. This slice does not change `tools/list`, `tools/call`, validation error payloads, runner prompts, generated docs, or planning-tool guidance. It creates the typed contract foundation, validates read-tool examples against the existing Zod DTO schemas, and codifies malformed read-tool call cases so slice 2 can add actionable hints without inventing cases.

**Tech Stack:** NestJS injectable services, TypeScript types, existing `AgentReadToolRequestSchemas`, existing `AgentMcpService`, Vitest small tests, Zod DTO validation.

---

## Scope

This slice implements only `Slice 1: Failure Matrix And Contract Skeleton` from `docs/superpowers/specs/2026-05-18-pi-agent-mcp-tool-contracts-design.md`.

In scope:

- Typed MCP tool-contract data structures.
- Read-tool contracts for:
  - `searchAssets`
  - `readAssetMetadata`
  - `readAssetPreviews`
  - `readAssetOriginals`
  - `listAlbums`
  - `readAlbum`
- Valid examples for the read-tool call modes described in the spec.
- Common-mistake metadata for the read-tool edge cases this slice covers.
- A slice 1 small-model failure matrix for malformed read-tool calls and request-wrapper mistakes.
- Tests proving every read-tool example parses through the same DTO schema used by `AgentMcpService`.
- Tests proving the failure matrix is connected to contract mistakes where a tool contract owns the correction.
- Runtime baseline tests proving the failure matrix currently produces validation or protocol failures without changing the error payload shape yet.

Out of scope:

- Enriched validation error payloads with `toolName`, `retryable`, `expected`, `hint`, or `exampleArguments`.
- Enriched `tools/list` metadata.
- Planning-tool examples.
- Generated docs.
- Runner prompt changes.
- Public MCP support or new tools.

## TDD Commands

Red commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Green commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Regression commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/dtos/agent-tool.dto.spec.ts
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir server run format
```

## File Structure

Create:

- `server/src/types/agent-mcp-contract.types.ts`
  - Owns contract, example, common-mistake, safety, and failure-matrix types.
- `server/src/services/agent-mcp-tool-contract.service.ts`
  - Owns slice 1 read-tool contracts and failure matrix cases.
- `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Verifies read contracts, executable examples, safety constraints, defensive copies, approval retry examples, and mistake coverage.

Modify:

- `server/src/services/agent-mcp.service.spec.ts`
  - Adds table-driven runtime baseline coverage for the slice 1 failure matrix.
- `server/src/services/index.ts`
  - Registers `AgentMcpToolContractService` as a server-owned injectable for later slices.

Do not modify in this slice:

- `server/src/services/agent-mcp-tool-registry.service.ts`
- `server/src/services/agent-mcp.service.ts`
- `agent-runner/src/pi-runtime.mjs`
- `docs/superpowers/generated/`

## Slice 1 Edge Case Matrix

This slice must explicitly cover:

| Area            | Case                                                             | Expected Slice 1 Result                                                                        |
| --------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Request wrapper | `params.input` used instead of `params.arguments`                | Existing MCP service returns an `isError: true` tool validation result for missing `arguments` |
| Request wrapper | tool arguments placed at top level instead of `params.arguments` | Existing MCP service returns an `isError: true` tool validation result for missing `arguments` |
| Request wrapper | `params.arguments` is an array, primitive, or null               | Existing MCP service returns an `isError: true` tool validation result for invalid `arguments` |
| Read retry      | `assetIds` combined with `toolCallId`                            | Existing MCP service returns an `isError: true` tool validation result                         |
| Read request    | missing `assetIds` and `toolCallId` for asset read               | Existing MCP service returns an `isError: true` tool validation result                         |
| Read request    | empty `assetIds`                                                 | Existing MCP service returns an `isError: true` tool validation result                         |
| Read request    | invalid asset UUID                                               | Existing MCP service returns an `isError: true` tool validation result                         |
| Read request    | duplicate asset IDs                                              | Existing MCP service returns an `isError: true` tool validation result                         |
| Read request    | more than `10_000` asset IDs                                     | Existing MCP service returns an `isError: true` tool validation result                         |
| Album read      | missing `albumId` and `toolCallId`                               | Existing MCP service returns an `isError: true` tool validation result                         |
| Album read      | `albumId` combined with `toolCallId`                             | Existing MCP service returns an `isError: true` tool validation result                         |
| Album read      | invalid album UUID                                               | Existing MCP service returns an `isError: true` tool validation result                         |
| Search          | date/location filters outside `filters`                          | Existing MCP service returns an `isError: true` tool validation result                         |
| Search          | `toolCallId` combined with filters or limit                      | Existing MCP service returns an `isError: true` tool validation result                         |
| Search          | limit over `10_000`                                              | Existing MCP service returns an `isError: true` tool validation result                         |
| Safety          | invented apply tool                                              | Existing MCP service returns an unknown-tool protocol error                                    |

This slice records the cases and proves the current runtime rejects them. Slice 2 owns changing the validation payload into model-actionable hints.

---

### Task 1: Add Read-Tool Contract Red Tests

**Files:**

- Create: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Write the failing contract tests**

Create `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

```ts
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentToolName } from 'src/enum';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';

const expectedReadToolNames = [
  AgentToolName.SearchAssets,
  AgentToolName.ReadAssetMetadata,
  AgentToolName.ReadAssetPreviews,
  AgentToolName.ReadAssetOriginals,
  AgentToolName.ListAlbums,
  AgentToolName.ReadAlbum,
] as const;

const forbiddenContractPattern =
  /\/api|agent\/internal|bearer|token|secret|provider key|applyAlbumOperations|applyOperations|createAlbum|addAssetsToAlbum/i;

describe(AgentMcpToolContractService.name, () => {
  let sut: AgentMcpToolContractService;

  beforeEach(() => {
    sut = new AgentMcpToolContractService();
  });

  it('returns exactly the slice 1 read-tool contracts in stable order', () => {
    expect(sut.listReadToolContracts().map((contract) => contract.name)).toEqual(expectedReadToolNames);
  });

  it('does not expose planning contracts before the planning guidance slice', () => {
    const toolNames = sut.listReadToolContracts().map((contract) => contract.name);

    expect(toolNames).not.toContain(AgentToolName.ProposeAlbumOperations);
    expect(toolNames).not.toContain(AgentToolName.ReviseProposedOperations);
    expect(toolNames).not.toContain(AgentToolName.SummarizePlan);
  });

  it('defines executable examples for every read tool', () => {
    for (const contract of sut.listReadToolContracts()) {
      const schema = AgentReadToolRequestSchemas[contract.name];

      expect(contract.examples.length).toBeGreaterThan(0);
      for (const example of contract.examples) {
        const result = schema.safeParse(example.arguments);

        expect(result.success, `${contract.name} example "${example.name}" should parse`).toBe(true);
      }
    }
  });

  it('defines approved retry mode and example for every read tool', () => {
    for (const contract of sut.listReadToolContracts()) {
      expect(contract.argumentModes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'approved-retry',
            requiredFields: ['toolCallId'],
            forbiddenFields: expect.any(Array),
          }),
        ]),
      );
      expect(contract.approvalRetry).toMatchObject({
        field: 'toolCallId',
      });
      expect(contract.examples).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'approved-retry',
            arguments: {
              toolCallId: '00000000-0000-4000-8000-000000000111',
            },
          }),
        ]),
      );
    }
  });

  it('defines the required search examples from the spec', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);

    expect(search?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining([
        'empty-search',
        'bounded-date-location-search',
        'favorite-rating-search',
        'approved-retry',
      ]),
    );
  });

  it('defines the required list and album read examples from the spec', () => {
    const listAlbums = sut.getReadToolContract(AgentToolName.ListAlbums);
    const readAlbum = sut.getReadToolContract(AgentToolName.ReadAlbum);

    expect(listAlbums?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['list-visible-albums', 'approved-retry']),
    );
    expect(readAlbum?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['read-visible-album', 'approved-retry']),
    );
  });

  it('does not include secrets, internal routes, or direct apply language', () => {
    const serialized = JSON.stringify(sut.listReadToolContracts());

    expect(serialized).not.toMatch(forbiddenContractPattern);
  });

  it('marks read contracts as non-mutating and requiring Gallery apply for final writes', () => {
    for (const contract of sut.listReadToolContracts()) {
      expect(contract.safety).toEqual({
        allowsDirectMutation: false,
        exposesSecrets: false,
        requiresGalleryApplyForWrites: true,
      });
    }
  });

  it('defines common mistakes with usable correction hints', () => {
    for (const contract of sut.listReadToolContracts()) {
      const exampleNames = new Set(contract.examples.map((example) => example.name));

      expect(contract.commonMistakes.length).toBeGreaterThan(0);
      for (const mistake of contract.commonMistakes) {
        expect(mistake.id.trim().length).toBeGreaterThan(0);
        expect(mistake.hint.trim().length).toBeGreaterThan(20);
        if (mistake.exampleName) {
          expect(exampleNames.has(mistake.exampleName), `${contract.name} mistake ${mistake.id}`).toBe(true);
        }
      }
    }
  });

  it('returns defensive copies of contracts', () => {
    const firstContracts = sut.listReadToolContracts();
    firstContracts[0].description = 'mutated description';
    firstContracts[0].examples[0].arguments = { mutated: true };

    expect(sut.listReadToolContracts()[0].description).not.toBe('mutated description');
    expect(sut.listReadToolContracts()[0].examples[0].arguments).not.toEqual({ mutated: true });
  });
});
```

- [ ] **Step 2: Run the red contract test**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: FAIL because `src/services/agent-mcp-tool-contract.service` does not exist.

- [ ] **Step 3: Commit the red tests**

```bash
git add server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "test(server): define mcp read tool contract expectations"
```

---

### Task 2: Implement Contract Types And Read-Tool Contract Service

**Files:**

- Create: `server/src/types/agent-mcp-contract.types.ts`
- Create: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/index.ts`
- Test: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Add the contract types**

Create `server/src/types/agent-mcp-contract.types.ts`:

```ts
import type { AgentToolName } from 'src/enum';

export type AgentMcpArgumentMode = {
  name: string;
  description: string;
  requiredFields: string[];
  forbiddenFields: string[];
  whenToUse: string;
};

export type AgentMcpToolExample = {
  name: string;
  description: string;
  arguments: Record<string, unknown>;
};

export type AgentMcpCommonMistake = {
  id: string;
  match: {
    issuePath?: string;
    messageIncludes?: string;
    missingField?: string;
    unexpectedField?: string;
    requestShape?: 'json-rpc' | 'tool-arguments';
  };
  hint: string;
  exampleName?: string;
};

export type AgentMcpApprovalRetryContract = {
  field: 'toolCallId';
  instruction: string;
};

export type AgentMcpToolSafetyContract = {
  allowsDirectMutation: false;
  exposesSecrets: false;
  requiresGalleryApplyForWrites: true;
};

export type AgentMcpToolContract<TName extends AgentToolName = AgentToolName> = {
  name: TName;
  title: string;
  description: string;
  usage: string;
  argumentModes: AgentMcpArgumentMode[];
  examples: AgentMcpToolExample[];
  commonMistakes: AgentMcpCommonMistake[];
  approvalRetry?: AgentMcpApprovalRetryContract;
  safety: AgentMcpToolSafetyContract;
};

export type AgentMcpReadToolName =
  | AgentToolName.SearchAssets
  | AgentToolName.ReadAssetMetadata
  | AgentToolName.ReadAssetPreviews
  | AgentToolName.ReadAssetOriginals
  | AgentToolName.ListAlbums
  | AgentToolName.ReadAlbum;

export type AgentMcpReadToolContract = AgentMcpToolContract<AgentMcpReadToolName>;

export type AgentMcpFailureMatrixExpectedResult =
  | {
      kind: 'tool-validation';
      expectedIssuePath: string;
    }
  | {
      kind: 'protocol-error';
      expectedErrorMessage: string;
    };

export type AgentMcpFailureMatrixCase = {
  id: string;
  category: 'request-wrapper' | 'read-retry' | 'read-request' | 'album-read' | 'search' | 'safety';
  description: string;
  toolName?: AgentToolName;
  request: Record<string, unknown>;
  expectedResult: AgentMcpFailureMatrixExpectedResult;
  expectedContractMistakeId?: string;
};
```

- [ ] **Step 2: Add the contract service implementation**

Create `server/src/services/agent-mcp-tool-contract.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AgentToolName } from 'src/enum';
import type {
  AgentMcpArgumentMode,
  AgentMcpApprovalRetryContract,
  AgentMcpCommonMistake,
  AgentMcpReadToolContract,
  AgentMcpReadToolName,
  AgentMcpToolContract,
  AgentMcpToolExample,
  AgentMcpToolSafetyContract,
} from 'src/types/agent-mcp-contract.types';

const exampleAssetId = '00000000-0000-4000-8000-000000000001';
const exampleAlbumId = '00000000-0000-4000-8000-000000000010';
const exampleToolCallId = '00000000-0000-4000-8000-000000000111';

const safety: AgentMcpToolSafetyContract = {
  allowsDirectMutation: false,
  exposesSecrets: false,
  requiresGalleryApplyForWrites: true,
};

const approvalRetry: AgentMcpApprovalRetryContract = {
  field: 'toolCallId',
  instruction:
    'After Gallery approves a pending read request, retry the same read tool with only toolCallId unless Gallery already supplied the approved result.',
};

const approvedRetryMode: AgentMcpArgumentMode = {
  name: 'approved-retry',
  description: 'Retry a read request that Gallery already approved.',
  requiredFields: ['toolCallId'],
  forbiddenFields: ['assetIds', 'albumId', 'filters', 'limit'],
  whenToUse: 'Use only after Gallery resumes the assistant from an approved tool request.',
};

const approvedRetryExample: AgentMcpToolExample = {
  name: 'approved-retry',
  description: 'Retry an approved read request by id.',
  arguments: { toolCallId: exampleToolCallId },
};

const assetIdsMode: AgentMcpArgumentMode = {
  name: 'asset-ids',
  description: 'Start a new asset read request for selected assets.',
  requiredFields: ['assetIds'],
  forbiddenFields: ['toolCallId'],
  whenToUse: 'Use when the assistant already has concrete asset ids from search or album reads.',
};

const assetIdsExample: AgentMcpToolExample = {
  name: 'read-selected-assets',
  description: 'Read selected assets by id.',
  arguments: { assetIds: [exampleAssetId] },
};

const assetIdMistakes: AgentMcpCommonMistake[] = [
  {
    id: 'asset-read-missing-asset-ids-or-tool-call-id',
    match: { messageIncludes: 'Provide assetIds for a new tool request or toolCallId for an approved request' },
    hint: 'For a new asset read, provide assetIds. For an approved retry, provide only toolCallId.',
    exampleName: 'read-selected-assets',
  },
  {
    id: 'asset-read-combined-asset-ids-and-tool-call-id',
    match: { messageIncludes: 'Provide either assetIds or toolCallId, not both' },
    hint: 'Use either assetIds for a new request or toolCallId for an approved retry, not both.',
    exampleName: 'approved-retry',
  },
  {
    id: 'asset-read-empty-asset-ids',
    match: { issuePath: 'assetIds' },
    hint: 'Provide at least one valid asset id, or retry an approved request with only toolCallId.',
    exampleName: 'read-selected-assets',
  },
  {
    id: 'asset-read-invalid-asset-id',
    match: { issuePath: 'assetIds.0' },
    hint: 'Asset ids must be UUID strings returned by Gallery tools.',
    exampleName: 'read-selected-assets',
  },
  {
    id: 'asset-read-duplicate-asset-ids',
    match: { issuePath: 'assetIds', messageIncludes: 'assetIds must be unique' },
    hint: 'Provide each asset id only once.',
    exampleName: 'read-selected-assets',
  },
  {
    id: 'asset-read-too-many-asset-ids',
    match: { issuePath: 'assetIds' },
    hint: 'Asset read requests may include at most 10000 asset ids. Search or narrow the request before reading.',
    exampleName: 'read-selected-assets',
  },
  {
    id: 'tool-call-arguments-missing',
    match: { missingField: 'arguments', requestShape: 'json-rpc' },
    hint: 'Put the tool arguments object at params.arguments in the MCP tools/call request.',
    exampleName: 'read-selected-assets',
  },
  {
    id: 'tool-call-arguments-not-object',
    match: { issuePath: 'arguments', requestShape: 'json-rpc' },
    hint: 'The params.arguments value must be a JSON object, not an array, primitive, or null.',
    exampleName: 'read-selected-assets',
  },
];

const defineAssetReadContract = (
  name: AgentToolName.ReadAssetMetadata | AgentToolName.ReadAssetPreviews | AgentToolName.ReadAssetOriginals,
  title: string,
  description: string,
): AgentMcpToolContract<typeof name> => ({
  name,
  title,
  description,
  usage: 'Use assetIds for a new request. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [assetIdsMode, approvedRetryMode],
  examples: [assetIdsExample, approvedRetryExample],
  commonMistakes: assetIdMistakes,
  approvalRetry,
  safety,
});

const searchAssetsContract: AgentMcpToolContract<AgentToolName.SearchAssets> = {
  name: AgentToolName.SearchAssets,
  title: 'Search assets',
  description: 'Find assets using Gallery metadata filters and a bounded result limit.',
  usage: 'Put all search filters under filters. Use only toolCallId when retrying a Gallery-approved search.',
  argumentModes: [
    {
      name: 'empty-search',
      description: 'Search visible assets with default filters and default limit.',
      requiredFields: [],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use when the user asks a broad library question and no narrower filters are known.',
    },
    {
      name: 'filtered-search',
      description: 'Search visible assets with metadata filters.',
      requiredFields: ['filters'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use when the user provides date, place, favorite, rating, album, tag, camera, or media filters.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'empty-search',
      description: 'Search with default filters and limit.',
      arguments: {},
    },
    {
      name: 'bounded-date-location-search',
      description: 'Search photos from a known place and date window.',
      arguments: {
        filters: {
          takenAfter: '2026-05-01T00:00:00.000Z',
          takenBefore: '2026-05-18T23:59:59.999Z',
          city: 'Berlin',
          country: 'Germany',
        },
        limit: 50,
      },
    },
    {
      name: 'favorite-rating-search',
      description: 'Search favorite five-star assets.',
      arguments: {
        filters: {
          isFavorite: true,
          rating: 5,
        },
        limit: 25,
      },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'search-filters-outside-filters',
      match: { unexpectedField: 'city' },
      hint: 'Place date, location, favorite, rating, album, tag, camera, and media filters inside the filters object.',
      exampleName: 'bounded-date-location-search',
    },
    {
      id: 'search-combined-filters-and-tool-call-id',
      match: { messageIncludes: 'Provide either search filters or toolCallId, not both' },
      hint: 'Use either filters and limit for a new search or only toolCallId for an approved retry.',
      exampleName: 'approved-retry',
    },
    {
      id: 'search-limit-out-of-range',
      match: { issuePath: 'limit' },
      hint: 'Use a positive integer limit no greater than 10000.',
      exampleName: 'favorite-rating-search',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Put the search arguments object at params.arguments in the MCP tools/call request.',
      exampleName: 'empty-search',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object, not an array, primitive, or null.',
      exampleName: 'empty-search',
    },
  ],
  approvalRetry,
  safety,
};

const listAlbumsContract: AgentMcpToolContract<AgentToolName.ListAlbums> = {
  name: AgentToolName.ListAlbums,
  title: 'List albums',
  description: 'List albums visible to the session user.',
  usage: 'Use an empty object for a new request. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [
    {
      name: 'list-visible-albums',
      description: 'Start a new album list request.',
      requiredFields: [],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use before answering album count or album lookup questions.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'list-visible-albums',
      description: 'List visible albums.',
      arguments: {},
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'list-albums-unexpected-field',
      match: { unexpectedField: 'albumId' },
      hint: 'Use {} to list albums. Use readAlbum with albumId to inspect one album.',
      exampleName: 'list-visible-albums',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Use params.arguments: {} for a normal listAlbums tool call.',
      exampleName: 'list-visible-albums',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object. Use {} for a normal listAlbums call.',
      exampleName: 'list-visible-albums',
    },
  ],
  approvalRetry,
  safety,
};

const readAlbumContract: AgentMcpToolContract<AgentToolName.ReadAlbum> = {
  name: AgentToolName.ReadAlbum,
  title: 'Read album',
  description: 'Read one visible album and its asset ids.',
  usage: 'Use albumId for a new request. Use only toolCallId when retrying a Gallery-approved request.',
  argumentModes: [
    {
      name: 'album-id',
      description: 'Start a new album read request.',
      requiredFields: ['albumId'],
      forbiddenFields: ['toolCallId'],
      whenToUse: 'Use after listAlbums returns the album id to inspect.',
    },
    approvedRetryMode,
  ],
  examples: [
    {
      name: 'read-visible-album',
      description: 'Read an album by id.',
      arguments: { albumId: exampleAlbumId },
    },
    approvedRetryExample,
  ],
  commonMistakes: [
    {
      id: 'read-album-missing-album-id-or-tool-call-id',
      match: { messageIncludes: 'Provide albumId for a new tool request or toolCallId for an approved request' },
      hint: 'Use albumId for a new album read, or only toolCallId for an approved retry.',
      exampleName: 'read-visible-album',
    },
    {
      id: 'read-album-combined-album-id-and-tool-call-id',
      match: { messageIncludes: 'Provide either albumId or toolCallId, not both' },
      hint: 'Use either albumId for a new request or toolCallId for an approved retry, not both.',
      exampleName: 'approved-retry',
    },
    {
      id: 'read-album-invalid-album-id',
      match: { issuePath: 'albumId' },
      hint: 'Album ids must be UUID strings returned by listAlbums.',
      exampleName: 'read-visible-album',
    },
    {
      id: 'tool-call-arguments-missing',
      match: { missingField: 'arguments', requestShape: 'json-rpc' },
      hint: 'Put the album read arguments object at params.arguments in the MCP tools/call request.',
      exampleName: 'read-visible-album',
    },
    {
      id: 'tool-call-arguments-not-object',
      match: { issuePath: 'arguments', requestShape: 'json-rpc' },
      hint: 'The params.arguments value must be a JSON object, not an array, primitive, or null.',
      exampleName: 'read-visible-album',
    },
  ],
  approvalRetry,
  safety,
};

const readToolContracts: AgentMcpReadToolContract[] = [
  searchAssetsContract,
  defineAssetReadContract(
    AgentToolName.ReadAssetMetadata,
    'Read asset metadata',
    'Read timestamps, location labels, camera fields, ratings, favorites, visibility, and tags for selected assets.',
  ),
  defineAssetReadContract(
    AgentToolName.ReadAssetPreviews,
    'Read asset previews',
    'Read preview media references for selected assets.',
  ),
  defineAssetReadContract(
    AgentToolName.ReadAssetOriginals,
    'Read asset originals',
    'Read original media references for selected assets.',
  ),
  listAlbumsContract,
  readAlbumContract,
];

@Injectable()
export class AgentMcpToolContractService {
  listReadToolContracts(): AgentMcpReadToolContract[] {
    return structuredClone(readToolContracts);
  }

  getReadToolContract(name: AgentMcpReadToolName): AgentMcpReadToolContract | undefined {
    return this.listReadToolContracts().find((contract) => contract.name === name);
  }
}
```

- [ ] **Step 3: Register the service for server ownership**

Modify `server/src/services/index.ts`:

```ts
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
```

Add `AgentMcpToolContractService` near the existing MCP services:

```ts
  AgentMcpService,
  AgentMcpToolContractService,
  AgentMcpToolRegistryService,
```

- [ ] **Step 4: Run the contract tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the implementation**

```bash
git add server/src/types/agent-mcp-contract.types.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/index.ts
git commit -m "feat(server): add mcp read tool contracts"
```

---

### Task 3: Add Runtime Failure Matrix Red Tests

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Test: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add imports for the failure matrix**

Modify the imports in `server/src/services/agent-mcp.service.spec.ts`:

```ts
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
```

The top of the file should still import `AgentMcpService`, `AgentMcpToolRegistryService`, `AgentToolService`, and `AgentOperationPlanService`.

- [ ] **Step 2: Add a helper for baseline validation assertions**

Add this helper near `expectToolValidationError`:

```ts
const expectToolValidationErrorPath = (response: AgentMcpSuccessResponse, path: string) => {
  const result = response.result as AgentMcpToolCallResult;

  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    status: 'error',
    error: 'Invalid tool arguments',
    issues: expect.arrayContaining([expect.objectContaining({ path })]),
  });
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
};
```

- [ ] **Step 3: Add the slice 1 runtime failure matrix tests**

Add this `describe` block after the existing malformed argument tests and before planning argument validation:

```ts
describe('slice 1 small-model read failure matrix', () => {
  let contractService: AgentMcpToolContractService;

  beforeEach(() => {
    contractService = new AgentMcpToolContractService();
  });

  it.each(
    new AgentMcpToolContractService()
      .listSlice1RuntimeFailureMatrixCases()
      .filter((failureCase) => failureCase.expectedResult.kind === 'tool-validation'),
  )('keeps runtime validation baseline for $id', async (failureCase) => {
    const response = (await sut.handle(auth, sessionId, failureCase.request)) as AgentMcpSuccessResponse;

    if (failureCase.expectedResult.kind !== 'tool-validation') {
      throw new Error(`Expected tool-validation case for ${failureCase.id}`);
    }

    expectToolValidationErrorPath(response, failureCase.expectedResult.expectedIssuePath);
    expect(toolService.searchAssets).not.toHaveBeenCalled();
    expect(toolService.readAssetMetadata).not.toHaveBeenCalled();
    expect(toolService.readAssetPreviews).not.toHaveBeenCalled();
    expect(toolService.readAssetOriginals).not.toHaveBeenCalled();
    expect(toolService.listAlbums).not.toHaveBeenCalled();
    expect(toolService.readAlbum).not.toHaveBeenCalled();
  });

  it.each(
    new AgentMcpToolContractService()
      .listSlice1RuntimeFailureMatrixCases()
      .filter((failureCase) => failureCase.expectedResult.kind === 'protocol-error'),
  )('keeps runtime protocol-error baseline for $id', async (failureCase) => {
    const response = await sut.handle(auth, sessionId, failureCase.request);

    if (failureCase.expectedResult.kind !== 'protocol-error') {
      throw new Error(`Expected protocol-error case for ${failureCase.id}`);
    }

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: failureCase.request.id,
      error: {
        message: failureCase.expectedResult.expectedErrorMessage,
      },
    });
    expect(toolService.searchAssets).not.toHaveBeenCalled();
    expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
    expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
    expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
  });

  it('keeps all slice 1 failure cases unique and documented', () => {
    const cases = contractService.listSlice1RuntimeFailureMatrixCases();

    expect(new Set(cases.map((failureCase) => failureCase.id)).size).toBe(cases.length);
    for (const failureCase of cases) {
      expect(failureCase.description.trim().length).toBeGreaterThan(20);
      expect(failureCase.category).toEqual(expect.any(String));
    }
  });

  it('connects read-tool failure cases to contract common mistakes', () => {
    const expectedReadToolNameSet = new Set<AgentToolName>([
      AgentToolName.SearchAssets,
      AgentToolName.ReadAssetMetadata,
      AgentToolName.ReadAssetPreviews,
      AgentToolName.ReadAssetOriginals,
      AgentToolName.ListAlbums,
      AgentToolName.ReadAlbum,
    ]);
    const contractsByName = new Map(
      contractService.listReadToolContracts().map((contract) => [contract.name, contract]),
    );

    for (const failureCase of contractService.listSlice1RuntimeFailureMatrixCases()) {
      if (!failureCase.toolName || !expectedReadToolNameSet.has(failureCase.toolName)) {
        continue;
      }

      const mistakeIds = contractsByName.get(failureCase.toolName)?.commonMistakes.map((mistake) => mistake.id) ?? [];

      expect(mistakeIds, `${failureCase.id} should map to ${failureCase.toolName}`).toContain(
        failureCase.expectedContractMistakeId,
      );
    }
  });
});
```

- [ ] **Step 4: Run the red runtime test**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: FAIL because `AgentMcpToolContractService.listSlice1RuntimeFailureMatrixCases()` does not exist yet.

- [ ] **Step 5: Commit the red runtime tests**

```bash
git add server/src/services/agent-mcp.service.spec.ts
git commit -m "test(server): codify mcp small-model read failure matrix"
```

---

### Task 4: Implement Runtime Failure Matrix Cases

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Test: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add failure matrix imports**

Add `AgentMcpFailureMatrixCase` to the existing type import in `server/src/services/agent-mcp-tool-contract.service.ts`. The final import should include:

```ts
import type {
  AgentMcpArgumentMode,
  AgentMcpApprovalRetryContract,
  AgentMcpCommonMistake,
  AgentMcpFailureMatrixCase,
  AgentMcpReadToolContract,
  AgentMcpReadToolName,
  AgentMcpToolContract,
  AgentMcpToolExample,
  AgentMcpToolSafetyContract,
} from 'src/types/agent-mcp-contract.types';
```

- [ ] **Step 2: Add the request helper and failure matrix**

Add this code after `readToolContracts` in `server/src/services/agent-mcp-tool-contract.service.ts`:

```ts
const toolCallRequest = (id: string, name: string, args: unknown): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: {
    name,
    arguments: args,
  },
});

const toolCallRequestWithParams = (id: string, params: Record<string, unknown>): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params,
});

const oversizedAssetIds = Array.from(
  { length: 10_001 },
  (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
);

const slice1RuntimeFailureMatrixCases: AgentMcpFailureMatrixCase[] = [
  {
    id: 'read-input-instead-of-arguments',
    category: 'request-wrapper',
    description: 'Model sends params.input instead of params.arguments.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequestWithParams('read-input-instead-of-arguments', {
      name: AgentToolName.ReadAssetMetadata,
      input: { assetIds: [exampleAssetId] },
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'tool-call-arguments-missing',
  },
  {
    id: 'read-top-level-arguments',
    category: 'request-wrapper',
    description: 'Model sends arguments outside params.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: {
      ...toolCallRequestWithParams('read-top-level-arguments', { name: AgentToolName.ReadAssetMetadata }),
      arguments: { assetIds: [exampleAssetId] },
    },
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'tool-call-arguments-missing',
  },
  {
    id: 'read-arguments-array',
    category: 'request-wrapper',
    description: 'Model sends params.arguments as an array instead of an object.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('read-arguments-array', AgentToolName.ReadAssetMetadata, [exampleAssetId]),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'tool-call-arguments-not-object',
  },
  {
    id: 'read-arguments-primitive',
    category: 'request-wrapper',
    description: 'Model sends params.arguments as a primitive string instead of an object.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('read-arguments-primitive', AgentToolName.ReadAssetMetadata, 'not-an-object'),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'tool-call-arguments-not-object',
  },
  {
    id: 'read-arguments-null',
    category: 'request-wrapper',
    description: 'Model sends params.arguments as null instead of an object.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('read-arguments-null', AgentToolName.ReadAssetMetadata, null),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'tool-call-arguments-not-object',
  },
  {
    id: 'asset-read-combined-asset-ids-and-tool-call-id',
    category: 'read-retry',
    description: 'Model combines new request ids with approved retry id.',
    toolName: AgentToolName.ReadAssetPreviews,
    request: toolCallRequest('asset-read-combined-asset-ids-and-tool-call-id', AgentToolName.ReadAssetPreviews, {
      assetIds: [exampleAssetId],
      toolCallId: exampleToolCallId,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'asset-read-combined-asset-ids-and-tool-call-id',
  },
  {
    id: 'asset-read-missing-asset-ids-or-tool-call-id',
    category: 'read-request',
    description: 'Model sends an empty asset read argument object.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('asset-read-missing-asset-ids-or-tool-call-id', AgentToolName.ReadAssetMetadata, {}),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'asset-read-missing-asset-ids-or-tool-call-id',
  },
  {
    id: 'asset-read-empty-asset-ids',
    category: 'read-request',
    description: 'Model sends an empty asset id array.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('asset-read-empty-asset-ids', AgentToolName.ReadAssetMetadata, { assetIds: [] }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'assetIds' },
    expectedContractMistakeId: 'asset-read-empty-asset-ids',
  },
  {
    id: 'asset-read-invalid-asset-id',
    category: 'read-request',
    description: 'Model sends a non-UUID asset id.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('asset-read-invalid-asset-id', AgentToolName.ReadAssetMetadata, {
      assetIds: ['not-a-uuid'],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'assetIds.0' },
    expectedContractMistakeId: 'asset-read-invalid-asset-id',
  },
  {
    id: 'asset-read-duplicate-asset-ids',
    category: 'read-request',
    description: 'Model sends duplicate asset ids.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('asset-read-duplicate-asset-ids', AgentToolName.ReadAssetMetadata, {
      assetIds: [exampleAssetId, exampleAssetId],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'assetIds' },
    expectedContractMistakeId: 'asset-read-duplicate-asset-ids',
  },
  {
    id: 'asset-read-too-many-asset-ids',
    category: 'read-request',
    description: 'Model sends more asset ids than the read-tool maximum.',
    toolName: AgentToolName.ReadAssetMetadata,
    request: toolCallRequest('asset-read-too-many-asset-ids', AgentToolName.ReadAssetMetadata, {
      assetIds: oversizedAssetIds,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'assetIds' },
    expectedContractMistakeId: 'asset-read-too-many-asset-ids',
  },
  {
    id: 'read-album-missing-album-id-or-tool-call-id',
    category: 'album-read',
    description: 'Model sends an empty readAlbum argument object.',
    toolName: AgentToolName.ReadAlbum,
    request: toolCallRequest('read-album-missing-album-id-or-tool-call-id', AgentToolName.ReadAlbum, {}),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'read-album-missing-album-id-or-tool-call-id',
  },
  {
    id: 'read-album-combined-album-id-and-tool-call-id',
    category: 'album-read',
    description: 'Model combines albumId and toolCallId.',
    toolName: AgentToolName.ReadAlbum,
    request: toolCallRequest('read-album-combined-album-id-and-tool-call-id', AgentToolName.ReadAlbum, {
      albumId: exampleAlbumId,
      toolCallId: exampleToolCallId,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'read-album-combined-album-id-and-tool-call-id',
  },
  {
    id: 'read-album-invalid-album-id',
    category: 'album-read',
    description: 'Model sends a non-UUID album id.',
    toolName: AgentToolName.ReadAlbum,
    request: toolCallRequest('read-album-invalid-album-id', AgentToolName.ReadAlbum, { albumId: 'not-a-uuid' }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'albumId' },
    expectedContractMistakeId: 'read-album-invalid-album-id',
  },
  {
    id: 'search-filters-outside-filters',
    category: 'search',
    description: 'Model puts date or location filters at the argument root.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-filters-outside-filters', AgentToolName.SearchAssets, {
      city: 'Berlin',
      country: 'Germany',
      limit: 25,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'search-filters-outside-filters',
  },
  {
    id: 'search-combined-filters-and-tool-call-id',
    category: 'search',
    description: 'Model combines search filters and approved retry id.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-combined-filters-and-tool-call-id', AgentToolName.SearchAssets, {
      filters: { isFavorite: true },
      toolCallId: exampleToolCallId,
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
    expectedContractMistakeId: 'search-combined-filters-and-tool-call-id',
  },
  {
    id: 'search-limit-out-of-range',
    category: 'search',
    description: 'Model requests more than the maximum search limit.',
    toolName: AgentToolName.SearchAssets,
    request: toolCallRequest('search-limit-out-of-range', AgentToolName.SearchAssets, { limit: 10_001 }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'limit' },
    expectedContractMistakeId: 'search-limit-out-of-range',
  },
  {
    id: 'invented-apply-tool',
    category: 'safety',
    description: 'Model invents a direct apply tool.',
    request: toolCallRequest('invented-apply-tool', 'applyAlbumOperations', {
      planId: '00000000-0000-4000-8000-000000000222',
      operationIds: ['00000000-0000-4000-8000-000000000333'],
    }),
    expectedResult: { kind: 'protocol-error', expectedErrorMessage: 'Unknown tool' },
  },
];
```

- [ ] **Step 3: Add the service method**

Add this method to `AgentMcpToolContractService`:

```ts
  listSlice1RuntimeFailureMatrixCases(): AgentMcpFailureMatrixCase[] {
    return structuredClone(slice1RuntimeFailureMatrixCases);
  }
```

- [ ] **Step 4: Keep the expected paths aligned with current runtime behavior**

The failure matrix should use these expected paths:

```ts
const expectedPathByCaseId = {
  'read-input-instead-of-arguments': 'arguments',
  'read-top-level-arguments': 'arguments',
  'read-arguments-array': 'arguments',
  'read-arguments-primitive': 'arguments',
  'read-arguments-null': 'arguments',
  'asset-read-combined-asset-ids-and-tool-call-id': '',
  'asset-read-missing-asset-ids-or-tool-call-id': '',
  'asset-read-empty-asset-ids': 'assetIds',
  'asset-read-invalid-asset-id': 'assetIds.0',
  'asset-read-duplicate-asset-ids': 'assetIds',
  'asset-read-too-many-asset-ids': 'assetIds',
  'read-album-missing-album-id-or-tool-call-id': '',
  'read-album-combined-album-id-and-tool-call-id': '',
  'read-album-invalid-album-id': 'albumId',
  'search-filters-outside-filters': '',
  'search-combined-filters-and-tool-call-id': '',
  'search-limit-out-of-range': 'limit',
} as const;
```

- [ ] **Step 5: Run runtime matrix tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run contract tests again**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the failure matrix implementation**

Commit the matrix additions:

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts
git commit -m "test(server): add mcp read failure matrix"
```

---

### Task 5: Regression And Slice Handoff

**Files:**

- Read: `docs/superpowers/specs/2026-05-18-pi-agent-mcp-tool-contracts-design.md`
- Read: `server/src/services/agent-mcp-tool-contract.service.ts`
- Read: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/dtos/agent-tool.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run server typecheck**

Run:

```bash
pnpm --dir server run check
```

Expected: PASS.

- [ ] **Step 3: Run server lint**

Run:

```bash
pnpm --dir server run lint
```

Expected: PASS.

- [ ] **Step 4: Run server format check**

Run:

```bash
pnpm --dir server run format
```

Expected: PASS. If it fails, run `pnpm --dir server run format:fix`, inspect the diff, rerun `pnpm --dir server run format`, then commit the formatting-only diff with the relevant code changes.

- [ ] **Step 5: Confirm slice 1 scope boundaries**

Run:

```bash
git diff --name-only HEAD~4..HEAD
```

Expected changed files are limited to:

```text
server/src/types/agent-mcp-contract.types.ts
server/src/services/agent-mcp-tool-contract.service.ts
server/src/services/agent-mcp-tool-contract.service.spec.ts
server/src/services/agent-mcp.service.spec.ts
server/src/services/index.ts
```

If implementation required a different number of commits, run `git diff --name-only origin/explore/pi-agent-brainstorm...HEAD` and confirm the same slice-owned file set.

- [ ] **Step 6: Write the slice completion note**

Use this summary shape in the final implementation response:

```markdown
Implemented Slice 1: Failure Matrix And Contract Skeleton.

What changed:

- Added server-owned read-tool contract types and service.
- Added executable read-tool examples validated against existing DTO schemas.
- Added slice 1 small-model runtime failure matrix cases.
- Added baseline runtime tests proving current MCP behavior rejects malformed read calls without changing error payloads yet.

Verification:

- `pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/dtos/agent-tool.dto.spec.ts`
- `pnpm --dir server run check`
- `pnpm --dir server run lint`
- `pnpm --dir server run format`

Next slice:

- Slice 2 should consume these contracts and matrix cases to enrich `isError: true` validation payloads with model-actionable correction hints.
```

## Self-Review Checklist

- TDD is explicit for every task: red tests first, implementation second, focused and regression commands named.
- Slice 1 stays consistent with the spec by adding only read-tool contract skeleton and failure matrix coverage.
- Planning-tool examples are intentionally deferred to Slice 4.
- Validation payload changes are intentionally deferred to Slice 2.
- `tools/list` metadata changes are intentionally deferred to Slice 3.
- Generated docs are intentionally deferred to Slice 5.
- Runner prompt changes are intentionally deferred to Slice 6.
- Edge cases from the slice matrix are covered by contract tests or runtime baseline tests.
- No direct apply or mutation tool is introduced.
- No provider secrets, bearer tokens, internal routes, or live IDs appear in contract examples.
