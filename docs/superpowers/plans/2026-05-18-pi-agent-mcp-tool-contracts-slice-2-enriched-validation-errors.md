# Pi Agent MCP Tool Contracts Slice 2 Enriched Validation Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make malformed MCP `tools/call` argument responses self-correcting for smaller models by adding contract-derived `toolName`, `retryable`, `expected`, `hint`, and `exampleArguments` fields to `isError: true` validation results.

**Architecture:** Keep JSON-RPC protocol failures as JSON-RPC errors, and keep successful tool calls unchanged. For known tool argument validation failures, build a typed error payload in `AgentMcpService`; read-tool payloads use `AgentMcpToolContractService` to select the best common mistake and valid example from the Slice 1 contracts. The textual MCP content remains a JSON copy of `structuredContent`.

**Tech Stack:** NestJS injectable services, TypeScript discriminated payload types, existing Zod DTO validation, existing `AgentMcpToolContractService`, Vitest service tests.

---

## Scope

This slice implements only `Slice 2: Enriched Validation Errors` from `docs/superpowers/specs/2026-05-18-pi-agent-mcp-tool-contracts-design.md`.

In scope:

- Add typed MCP validation error payload fields:
  - `toolName`
  - `retryable`
  - `issues[].path`
  - `issues[].message`
  - `issues[].hint` when a contract mistake matches that issue
  - `expected` for read tools with contracts
  - `hint` for read tools with matching common mistakes
  - `exampleArguments` for read tools when the matching mistake references an example
- Match Slice 1 read-tool failure matrix cases to read-tool common mistakes.
- Prefer specific mistake matches, for example duplicate IDs over generic `assetIds` errors.
- Preserve existing `content[0].text === JSON.stringify(structuredContent)` behavior.
- Preserve JSON-RPC protocol errors for unknown tools, malformed params, invalid requests, batch requests, method-not-found, and service exceptions.
- Avoid leaking raw request bodies, secrets, bearer tokens, internal routes, filesystem paths, or stack traces in validation payloads.

Out of scope:

- Enriching `tools/list` metadata.
- Adding planning-tool contracts or planning-specific examples.
- Generated docs.
- Runner prompt changes.
- Changing approval, permission, or plan-review behavior.
- Exposing any direct apply tool.

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

Modify:

- `server/src/types/agent-mcp-contract.types.ts`
  - Add reusable contract correction and validation issue types.
- `server/src/types/agent-mcp.types.ts`
  - Add the public shape of the structured MCP tool validation error payload.
- `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add a read-tool correction lookup that selects a matching `commonMistake` and its example arguments.
- `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add red tests for correction lookup, specificity ranking, fallback behavior, and defensive copies.
- `server/src/services/agent-mcp.service.ts`
  - Inject `AgentMcpToolContractService`, pass `toolName` into validation-result builders, add enriched payload construction, sanitize issue messages, and keep text/structured content synchronized.
- `server/src/services/agent-mcp.service.spec.ts`
  - Add red tests for enriched read-tool validation errors, Slice 1 failure matrix coverage, protocol error preservation, service error preservation, text sync, and redaction.

Do not modify in this slice:

- `server/src/services/agent-mcp-tool-registry.service.ts`
- `agent-runner/src/pi-runtime.mjs`
- `docs/superpowers/generated/`

## Slice 2 Edge Case Matrix

| Area              | Case                                                                                            | Expected Slice 2 Result                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Request wrapper   | Missing `params.arguments`                                                                      | `isError: true` with `toolName`, `retryable: true`, `issues[0].path: "arguments"`, wrapper hint, and valid `exampleArguments` |
| Request wrapper   | `params.input` instead of `params.arguments`                                                    | Same as missing `arguments`; no raw `input` body appears in payload                                                           |
| Request wrapper   | Arguments at top level                                                                          | Same as missing `arguments`; JSON-RPC wrapper remains valid                                                                   |
| Request wrapper   | `params.arguments` is array, primitive, or null                                                 | `arguments must be an object` issue with non-object hint                                                                      |
| Read retry        | `assetIds` combined with `toolCallId`                                                           | Hint says choose one mode, expected describes asset IDs vs approved retry                                                     |
| Asset read        | Missing `assetIds` and `toolCallId`                                                             | Hint says use `assetIds` for new reads or only `toolCallId` for approved retry                                                |
| Asset read        | Empty `assetIds`                                                                                | Hint says provide at least one valid asset id                                                                                 |
| Asset read        | Invalid asset UUID                                                                              | UUID-specific hint and valid UUID example                                                                                     |
| Asset read        | Duplicate asset IDs                                                                             | Duplicate-specific hint, not generic `assetIds` hint                                                                          |
| Asset read        | More than `10_000` IDs                                                                          | Limit-specific hint and no raw ID list in payload                                                                             |
| Album read        | Missing `albumId` and `toolCallId`                                                              | Album mode hint                                                                                                               |
| Album read        | `albumId` combined with `toolCallId`                                                            | Choose-one-mode hint                                                                                                          |
| Album read        | Invalid album UUID                                                                              | UUID-specific album hint                                                                                                      |
| Search            | Date/location filters outside `filters`                                                         | Hint says filters belong under `filters`                                                                                      |
| Search            | `toolCallId` combined with filters or limit                                                     | Choose search fields or approved retry, not both                                                                              |
| Search            | Limit over `10_000`                                                                             | Limit-specific hint                                                                                                           |
| Safety            | Invented apply tool                                                                             | Still JSON-RPC `Unknown tool`, not an `isError` tool result                                                                   |
| Security          | Malformed args contain token-like strings, bearer text, internal paths, or route-looking values | Payload does not include those values                                                                                         |
| Text sync         | Any validation error                                                                            | `content[0].text` exactly equals `JSON.stringify(structuredContent)`                                                          |
| Planning fallback | Planning tool malformed arguments before planning contracts exist                               | `isError: true` includes `toolName`, `retryable: true`, and issues, but no read-tool `exampleArguments`                       |

---

### Task 1: Add Contract Correction Lookup Red Tests

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Write failing tests for read-tool correction lookup**

Append these tests before the final `});` in `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

```ts
describe('validation correction lookup', () => {
  it('returns the matching hint, expected usage, and example arguments for a read-tool mistake', () => {
    const correction = sut.getReadToolValidationCorrection(AgentToolName.ReadAssetPreviews, {
      requestShape: 'tool-arguments',
      issues: [{ path: '', message: 'Provide either assetIds or toolCallId, not both' }],
    });

    expect(correction).toEqual({
      mistakeId: 'asset-read-combined-asset-ids-and-tool-call-id',
      issuePath: '',
      expected: 'Use assetIds for a new request. Use only toolCallId when retrying a Gallery-approved request.',
      hint: 'Use either assetIds for a new request or toolCallId for an approved retry, not both.',
      exampleArguments: {
        toolCallId: '00000000-0000-4000-8000-000000000111',
      },
    });
  });

  it('matches JSON-RPC wrapper mistakes separately from tool-argument mistakes', () => {
    const correction = sut.getReadToolValidationCorrection(AgentToolName.ReadAssetMetadata, {
      requestShape: 'json-rpc',
      issues: [{ path: 'arguments', message: 'arguments is required' }],
    });

    expect(correction).toMatchObject({
      mistakeId: 'tool-call-arguments-missing',
      issuePath: 'arguments',
      hint: 'Put the tool arguments object at params.arguments in the MCP tools/call request.',
      exampleArguments: {
        assetIds: ['00000000-0000-4000-8000-000000000001'],
      },
    });
  });

  it('prefers the most specific mistake when multiple issues share a path', () => {
    const correction = sut.getReadToolValidationCorrection(AgentToolName.ReadAssetMetadata, {
      requestShape: 'tool-arguments',
      issues: [
        { path: 'assetIds', message: 'Too small: expected array to have >=1 items' },
        { path: 'assetIds', message: 'assetIds must be unique' },
      ],
    });

    expect(correction?.mistakeId).toBe('asset-read-duplicate-asset-ids');
    expect(correction?.issuePath).toBe('assetIds');
    expect(correction?.hint).toBe('Provide each asset id only once.');
  });

  it('returns a read-tool fallback when no common mistake matches', () => {
    const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
      requestShape: 'tool-arguments',
      issues: [{ path: 'filters.rating', message: 'Too big: expected number to be <=5' }],
    });

    expect(correction).toEqual({
      expected: 'Put all search filters under filters. Use only toolCallId when retrying a Gallery-approved search.',
      hint: 'Put all search filters under filters. Use only toolCallId when retrying a Gallery-approved search.',
      exampleArguments: {},
    });
  });

  it('returns defensive copies of example arguments', () => {
    const firstCorrection = sut.getReadToolValidationCorrection(AgentToolName.ReadAlbum, {
      requestShape: 'tool-arguments',
      issues: [{ path: 'albumId', message: 'Invalid UUID' }],
    });

    firstCorrection!.exampleArguments = { mutated: true };

    expect(
      sut.getReadToolValidationCorrection(AgentToolName.ReadAlbum, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'albumId', message: 'Invalid UUID' }],
      })?.exampleArguments,
    ).toEqual({
      albumId: '00000000-0000-4000-8000-000000000010',
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: FAIL with TypeScript or runtime errors showing `getReadToolValidationCorrection` does not exist.

- [ ] **Step 3: Commit the red tests**

```bash
git add server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "$(cat <<'EOF'
test(server): define mcp validation correction lookup
EOF
)"
```

### Task 2: Implement Contract Correction Lookup

**Files:**

- Modify: `server/src/types/agent-mcp-contract.types.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Test: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Add correction lookup types**

In `server/src/types/agent-mcp-contract.types.ts`, add these exports after `AgentMcpReadToolContract`:

```ts
export type AgentMcpValidationIssue = {
  path: string;
  message: string;
};

export type AgentMcpValidationCorrectionRequest = {
  requestShape: 'json-rpc' | 'tool-arguments';
  issues: AgentMcpValidationIssue[];
};

export type AgentMcpValidationCorrection = {
  mistakeId?: string;
  issuePath?: string;
  expected: string;
  hint: string;
  exampleArguments?: Record<string, unknown>;
};
```

- [ ] **Step 2: Implement correction selection in the contract service**

Update imports in `server/src/services/agent-mcp-tool-contract.service.ts` to include:

```ts
  AgentMcpValidationCorrection,
  AgentMcpValidationCorrectionRequest,
  AgentMcpValidationIssue,
```

Add these helpers above `@Injectable()`:

```ts
const cloneArguments = (args: Record<string, unknown> | undefined): Record<string, unknown> | undefined =>
  args === undefined ? undefined : structuredClone(args);

const mistakeSpecificity = (mistake: AgentMcpCommonMistake): number =>
  Number(Boolean(mistake.match.issuePath)) +
  Number(Boolean(mistake.match.messageIncludes)) +
  Number(Boolean(mistake.match.missingField)) +
  Number(Boolean(mistake.match.unexpectedField)) +
  Number(Boolean(mistake.match.requestShape));

const issueMatchesMessage = (issue: AgentMcpValidationIssue, messageIncludes: string | undefined): boolean =>
  !messageIncludes || issue.message.includes(messageIncludes);

const issueMatchesPath = (issue: AgentMcpValidationIssue, issuePath: string | undefined): boolean =>
  issuePath === undefined || issue.path === issuePath;

const mistakeMatchingIssue = (
  mistake: AgentMcpCommonMistake,
  request: AgentMcpValidationCorrectionRequest,
): AgentMcpValidationIssue | undefined => {
  const { match } = mistake;

  if (match.requestShape && match.requestShape !== request.requestShape) {
    return;
  }

  if (match.missingField) {
    return request.issues.find((issue) => issue.path === match.missingField && issue.message.includes('required'));
  }

  if (match.unexpectedField) {
    return request.issues.find(
      (issue) =>
        issueMatchesPath(issue, match.issuePath) &&
        issueMatchesMessage(issue, match.messageIncludes) &&
        issue.message.includes(match.unexpectedField),
    );
  }

  return request.issues.find(
    (issue) => issueMatchesPath(issue, match.issuePath) && issueMatchesMessage(issue, match.messageIncludes),
  );
};
```

Add this public method to `AgentMcpToolContractService`:

```ts
  getReadToolValidationCorrection(
    name: AgentMcpReadToolName,
    request: AgentMcpValidationCorrectionRequest,
  ): AgentMcpValidationCorrection | undefined {
    const contract = this.getReadToolContract(name);
    if (!contract) {
      return;
    }

    const matchingCorrection = contract.commonMistakes
      .map((mistake) => ({ mistake, issue: mistakeMatchingIssue(mistake, request) }))
      .filter((correction): correction is { mistake: AgentMcpCommonMistake; issue: AgentMcpValidationIssue } =>
        Boolean(correction.issue),
      )
      .sort((left, right) => mistakeSpecificity(right.mistake) - mistakeSpecificity(left.mistake))[0];

    if (!matchingCorrection) {
      return {
        expected: contract.usage,
        hint: contract.usage,
        exampleArguments: cloneArguments(contract.examples[0]?.arguments),
      };
    }

    const { mistake: matchingMistake, issue: matchingIssue } = matchingCorrection;
    const example = matchingMistake.exampleName
      ? contract.examples.find((candidate) => candidate.name === matchingMistake.exampleName)
      : undefined;

    return {
      mistakeId: matchingMistake.id,
      issuePath: matchingIssue.path,
      expected: contract.usage,
      hint: matchingMistake.hint,
      exampleArguments: cloneArguments(example?.arguments),
    };
  }
```

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the green implementation**

```bash
git add server/src/types/agent-mcp-contract.types.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): select mcp validation correction hints
EOF
)"
```

### Task 3: Add Enriched MCP Validation Error Red Tests

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Update the test setup to include the contract service**

In `server/src/services/agent-mcp.service.spec.ts`, add a local variable next to `registry`:

```ts
let contractService: AgentMcpToolContractService;
```

In `beforeEach`, instantiate it and pass it to the SUT:

```ts
registry = new AgentMcpToolRegistryService();
contractService = new AgentMcpToolContractService();
toolService = automock(AgentToolService, { strict: false });
operationPlanService = automock(AgentOperationPlanService, { strict: false });
sut = new AgentMcpService(registry, contractService, toolService, operationPlanService);
```

- [ ] **Step 2: Replace the validation assertion helpers**

Replace `expectToolValidationError` and `expectToolValidationErrorPath` with this stricter helper:

```ts
const expectEnrichedToolValidationError = (
  response: AgentMcpSuccessResponse,
  expected: {
    toolName: AgentToolName;
    path: string;
    hintIncludes?: string;
    expectedIncludes?: string;
    exampleArguments?: Record<string, unknown>;
  },
) => {
  const result = response.result as AgentMcpToolCallResult;
  const structuredContent = result.structuredContent as Record<string, unknown>;

  expect(result.isError).toBe(true);
  expect(structuredContent).toMatchObject({
    status: 'error',
    error: 'Invalid tool arguments',
    toolName: expected.toolName,
    retryable: true,
    issues: expect.arrayContaining([expect.objectContaining({ path: expected.path })]),
  });

  if (expected.hintIncludes) {
    expect(structuredContent.hint).toEqual(expect.stringContaining(expected.hintIncludes));
    expect(structuredContent.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expected.path,
          hint: expect.stringContaining(expected.hintIncludes),
        }),
      ]),
    );
  }

  if (expected.expectedIncludes) {
    expect(structuredContent.expected).toEqual(expect.stringContaining(expected.expectedIncludes));
  }

  if (expected.exampleArguments) {
    expect(structuredContent.exampleArguments).toEqual(expected.exampleArguments);
  }

  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
};
```

Replace current calls like:

```ts
expectToolValidationError(response, expectedPath);
```

with:

```ts
expectEnrichedToolValidationError(response, {
  toolName: toolName ?? AgentToolName.SearchAssets,
  path: expectedPath,
});
```

Replace current calls like:

```ts
expectToolValidationErrorPath(response, failureCase.expectedResult.expectedIssuePath);
```

with:

```ts
expectEnrichedToolValidationError(response, {
  toolName: failureCase.toolName!,
  path: failureCase.expectedResult.expectedIssuePath,
});
```

- [ ] **Step 3: Add table-driven expectations for actionable read-tool hints**

Add this test inside `describe('slice 1 small-model read failure matrix', ...)` after the runtime validation baseline test:

```ts
it.each([
  {
    id: 'read-input-instead-of-arguments',
    hintIncludes: 'params.arguments',
    exampleArguments: { assetIds: ['00000000-0000-4000-8000-000000000001'] },
  },
  {
    id: 'read-arguments-array',
    hintIncludes: 'must be a JSON object',
    exampleArguments: { assetIds: ['00000000-0000-4000-8000-000000000001'] },
  },
  {
    id: 'asset-read-combined-asset-ids-and-tool-call-id',
    hintIncludes: 'not both',
    expectedIncludes: 'Use assetIds for a new request',
    exampleArguments: { toolCallId: '00000000-0000-4000-8000-000000000111' },
  },
  {
    id: 'asset-read-duplicate-asset-ids',
    hintIncludes: 'only once',
    exampleArguments: { assetIds: ['00000000-0000-4000-8000-000000000001'] },
  },
  {
    id: 'read-album-invalid-album-id',
    hintIncludes: 'Album ids must be UUID strings',
    exampleArguments: { albumId: '00000000-0000-4000-8000-000000000010' },
  },
  {
    id: 'search-filters-outside-filters',
    hintIncludes: 'inside the filters object',
    exampleArguments: {
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
    id: 'search-limit-out-of-range',
    hintIncludes: 'no greater than 10000',
    exampleArguments: {
      filters: {
        isFavorite: true,
        rating: 5,
      },
      limit: 25,
    },
  },
])('returns an actionable correction for $id', async (expectation) => {
  const failureCase = contractService
    .listSlice1RuntimeFailureMatrixCases()
    .find((candidate) => candidate.id === expectation.id)!;

  const response = (await sut.handle(auth, sessionId, failureCase.request)) as AgentMcpSuccessResponse;

  if (failureCase.expectedResult.kind !== 'tool-validation' || !failureCase.toolName) {
    throw new Error(`Expected tool-validation read case for ${failureCase.id}`);
  }

  expectEnrichedToolValidationError(response, {
    toolName: failureCase.toolName,
    path: failureCase.expectedResult.expectedIssuePath,
    hintIncludes: expectation.hintIncludes,
    expectedIncludes: expectation.expectedIncludes,
    exampleArguments: expectation.exampleArguments,
  });
});
```

- [ ] **Step 4: Add tests for every Slice 1 tool-validation case receiving a read correction**

Add this test in the same describe block:

```ts
it('adds correction fields for every read-tool failure matrix case', async () => {
  for (const failureCase of contractService
    .listSlice1RuntimeFailureMatrixCases()
    .filter((candidate) => candidate.expectedResult.kind === 'tool-validation')) {
    const response = (await sut.handle(auth, sessionId, failureCase.request)) as AgentMcpSuccessResponse;
    const result = response.result as AgentMcpToolCallResult;
    const structuredContent = result.structuredContent as Record<string, unknown>;

    expect(failureCase.toolName, failureCase.id).toBeDefined();
    expect(structuredContent.toolName, failureCase.id).toBe(failureCase.toolName);
    expect(structuredContent.retryable, failureCase.id).toBe(true);
    expect(typeof structuredContent.expected, failureCase.id).toBe('string');
    expect(typeof structuredContent.hint, failureCase.id).toBe('string');
    expect(structuredContent.exampleArguments, failureCase.id).toEqual(expect.any(Object));
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  }
});
```

- [ ] **Step 5: Add protocol and service error preservation tests**

Add these tests near the existing unknown-tool and service-exception tests:

```ts
it('keeps unknown tools as JSON-RPC protocol errors instead of tool validation results', async () => {
  const response = await sut.handle(auth, sessionId, {
    jsonrpc: '2.0',
    id: 'unknown-tool-protocol-error',
    method: 'tools/call',
    params: {
      name: 'mcp_gallery_applyAlbumOperations',
      arguments: { token: 'bearer abc' },
    },
  });

  expect(response).toEqual({
    jsonrpc: '2.0',
    id: 'unknown-tool-protocol-error',
    error: {
      code: -32_602,
      message: 'Unknown tool',
      data: { toolName: 'mcp_gallery_applyAlbumOperations' },
    },
  });
});

it('keeps service exceptions as redacted JSON-RPC internal errors', async () => {
  toolService.searchAssets.mockRejectedValue(new Error('bearer token abc /srv/gallery/internal-route'));

  await expect(sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.SearchAssets, {}))).resolves.toEqual({
    jsonrpc: '2.0',
    id: `${AgentToolName.SearchAssets}-call`,
    error: {
      code: -32_603,
      message: 'Internal error',
    },
  });
});
```

- [ ] **Step 6: Add validation redaction coverage**

Add this test near the malformed argument tests:

```ts
it('does not serialize raw malformed argument values, secrets, routes, or filesystem paths in validation errors', async () => {
  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.SearchAssets, {
      token: 'bearer abc123',
      internalRoute: '/api/agent/internal/mcp',
      file: '/srv/gallery/provider-key.json',
      filters: { isFavorite: true },
    }),
  )) as AgentMcpSuccessResponse;
  const result = response.result as AgentMcpToolCallResult;
  const serialized = JSON.stringify(result.structuredContent);

  expect(serialized).not.toMatch(
    /token|internalRoute|file|bearer|abc123|\/api\/agent\/internal|\/srv\/gallery|provider-key/i,
  );
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
});
```

- [ ] **Step 7: Add planning fallback coverage**

Add this test in `describe('planning argument validation', ...)`:

```ts
it('adds generic retry metadata for planning tools before planning contracts exist', async () => {
  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAlbumOperations, undefined),
  )) as AgentMcpSuccessResponse;
  const result = response.result as AgentMcpToolCallResult;

  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    status: 'error',
    error: 'Invalid tool arguments',
    toolName: AgentToolName.ProposeAlbumOperations,
    retryable: true,
    issues: [{ path: 'arguments', message: 'arguments is required' }],
  });
  expect(result.structuredContent).not.toHaveProperty('exampleArguments');
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
});
```

- [ ] **Step 8: Run the focused service test and verify it fails**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: FAIL because `AgentMcpService` does not accept `AgentMcpToolContractService` in its constructor and validation payloads do not include the new fields.

- [ ] **Step 9: Commit the red tests**

```bash
git add server/src/services/agent-mcp.service.spec.ts
git commit -m "$(cat <<'EOF'
test(server): define enriched mcp validation errors
EOF
)"
```

### Task 4: Implement Enriched Validation Errors In AgentMcpService

**Files:**

- Modify: `server/src/types/agent-mcp.types.ts`
- Modify: `server/src/services/agent-mcp.service.ts`
- Test: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add structured validation error payload types**

In `server/src/types/agent-mcp.types.ts`, add these exports after `AgentMcpToolCallResult`:

```ts
export type AgentMcpToolValidationIssue = {
  path: string;
  message: string;
  hint?: string;
};

export type AgentMcpToolValidationErrorContent = {
  status: 'error';
  error: 'Invalid tool arguments';
  toolName: AgentToolName;
  retryable: true;
  issues: AgentMcpToolValidationIssue[];
  expected?: string;
  hint?: string;
  exampleArguments?: AgentMcpJsonObject;
};
```

- [ ] **Step 2: Inject the contract service and pass `toolName` through validation**

In `server/src/services/agent-mcp.service.ts`, add:

```ts
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
```

Extend the constructor:

```ts
  constructor(
    private readonly toolRegistry: AgentMcpToolRegistryService,
    private readonly toolContractService: AgentMcpToolContractService,
    private readonly toolService: AgentToolService,
    private readonly operationPlanService: AgentOperationPlanService,
  ) {}
```

Change `invokeTool` to receive `toolName`:

```ts
  private async invokeTool<TDto>(
    id: AgentMcpRequestId,
    toolName: AgentToolName,
    args: unknown,
    schema: z.ZodType<TDto>,
    delegate: (dto: TDto) => Promise<unknown>,
  ): Promise<AgentMcpSuccessResponse | AgentMcpErrorResponse> {
    const argumentValidation = this.validateToolArguments(args);
    if (!argumentValidation.valid) {
      return this.success(
        id,
        this.argumentErrorResult(toolName, argumentValidation.path, argumentValidation.message),
      );
    }

    const parseResult = schema.safeParse(argumentValidation.value);
    if (!parseResult.success) {
      return this.success(id, this.validationErrorResult(toolName, parseResult.error));
    }

    try {
      return this.success(id, this.toolResult(await delegate(parseResult.data)));
    } catch {
      return this.error(id, -32_603, 'Internal error');
    }
  }
```

Update every call site from:

```ts
return this.invokeTool(id, args, schema, delegate);
```

to:

```ts
return this.invokeTool(id, toolName, args, schema, delegate);
```

For the read path, use:

```ts
return this.invokeTool(request.id, name, args, AgentReadToolRequestSchemas[name], (dto) =>
  this.callReadTool(auth, sessionId, name, dto),
);
```

- [ ] **Step 3: Add issue normalization and redaction helpers**

Add these private methods before `validationErrorResult`:

```ts
  private normalizeValidationIssues(
    issues: readonly { path: readonly unknown[]; message: string }[],
  ): { path: string; message: string }[] {
    return issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
  }

  private sanitizeIssueMessage(message: string): string {
    if (/unrecognized key/i.test(message)) {
      return 'Unexpected field in arguments';
    }

    return message
      .replace(/bearer\s+[a-z0-9._-]+/gi, 'bearer [redacted]')
      .replace(/\/(?:api|srv)\/[^\s"']+/gi, '[redacted-path]')
      .replace(/provider-key/gi, '[redacted-secret]');
  }

  private isReadToolNameForCorrection(toolName: AgentToolName): toolName is keyof typeof AgentReadToolRequestSchemas {
    return this.readToolNames.has(toolName);
  }
```

- [ ] **Step 4: Build contract-enriched validation payloads**

Replace `validationErrorResult`, `validationIssuesResult`, and `argumentErrorResult` with:

```ts
  private validationErrorResult(toolName: AgentToolName, error: z.ZodError): AgentMcpToolCallResult {
    return this.validationIssuesResult(toolName, this.normalizeValidationIssues(error.issues), 'tool-arguments');
  }

  private validationIssuesResult(
    toolName: AgentToolName,
    issues: readonly { path: string; message: string }[],
    requestShape: 'json-rpc' | 'tool-arguments',
  ): AgentMcpToolCallResult {
    const correction = this.isReadToolNameForCorrection(toolName)
      ? this.toolContractService.getReadToolValidationCorrection(toolName, {
          requestShape,
          issues: issues.map((issue) => ({ path: issue.path, message: issue.message })),
        })
      : undefined;
    const structuredContent: AgentMcpToolValidationErrorContent = {
      status: 'error',
      error: 'Invalid tool arguments',
      toolName,
      retryable: true,
      issues: issues.map((issue) => ({
        path: issue.path,
        message: this.sanitizeIssueMessage(issue.message),
        ...(correction?.hint && correction.issuePath === issue.path ? { hint: correction.hint } : {}),
      })),
      ...(correction?.expected ? { expected: correction.expected } : {}),
      ...(correction?.hint ? { hint: correction.hint } : {}),
      ...(correction?.exampleArguments ? { exampleArguments: correction.exampleArguments } : {}),
    };

    return {
      ...this.toolResult(structuredContent),
      isError: true,
    };
  }

  private argumentErrorResult(toolName: AgentToolName, path: string, message: string): AgentMcpToolCallResult {
    return this.validationIssuesResult(toolName, [{ path, message }], 'json-rpc');
  }
```

Also add `AgentMcpToolValidationErrorContent` to the type import list from `src/types/agent-mcp.types`.

- [ ] **Step 5: Run focused service tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run both Slice 2 focused suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the green implementation**

```bash
git add server/src/types/agent-mcp.types.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): enrich mcp validation error payloads
EOF
)"
```

### Task 5: Regression And Hardening Review

**Files:**

- Verify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Verify: `server/src/services/agent-mcp.service.spec.ts`
- Verify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Verify: `server/src/dtos/agent-tool.dto.spec.ts`

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

Expected: PASS.

- [ ] **Step 5: Inspect the final diff for scope**

Run:

```bash
git diff --stat HEAD~4..HEAD
git diff -- server/src/types/agent-mcp-contract.types.ts server/src/types/agent-mcp.types.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts
```

Expected:

- Only Slice 2 files changed.
- No changes to registry metadata, runner prompt, generated docs, approval handling, or plan review.
- No `applyAlbumOperations` or direct mutation tool added.
- No secrets, bearer tokens, internal routes, filesystem paths, or raw request body serialization added to validation payloads.

- [ ] **Step 6: Commit any review-only cleanup**

If regression review requires cleanup, make the smallest change, rerun the failed focused command, then commit:

```bash
git add server/src/types/agent-mcp-contract.types.ts server/src/types/agent-mcp.types.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(server): harden mcp validation corrections
EOF
)"
```

If no cleanup is needed, do not create an empty commit.

## Self-Review Checklist

- [ ] The plan uses TDD: every behavior task starts with red tests, then implementation, then green verification.
- [ ] Every Slice 2 spec field is tested: `toolName`, `retryable`, `issues`, `expected`, `hint`, `exampleArguments`.
- [ ] Every Slice 1 read-tool failure matrix category receives enriched payload coverage.
- [ ] Unknown tools and service exceptions remain JSON-RPC errors, not `isError` tool results.
- [ ] Text content stays synchronized with `structuredContent`.
- [ ] Redaction tests cover token-like strings, bearer text, internal route-looking values, and filesystem paths.
- [ ] Planning malformed arguments get generic retry metadata without inventing planning examples before Slice 4.
- [ ] The implementation does not change `tools/list`, runner prompts, docs generation, approval behavior, or plan-review behavior.
