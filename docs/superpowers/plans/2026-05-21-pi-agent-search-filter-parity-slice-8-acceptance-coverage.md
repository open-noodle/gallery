# Pi Agent Search Filter Parity Slice 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the search-filter parity project with user-level acceptance coverage and an updated capability matrix that reflects the completed MCP search surface.

**Architecture:** Keep the acceptance tests at the boundaries users actually exercise: runner/session flow for prompt-to-tool approval/resume behavior, assistant chat UI for applied-plan continuation, and the capability matrix for product documentation. The tests do not attempt to make the LLM deterministic; they prove that when the first-party runner chooses the expected structured tool calls for each acceptance prompt, Gallery displays the message, requests approval, resumes after approval, streams a response, preserves plan/applied-plan UI, and leaves the chat usable.

**Tech Stack:** NestJS/Vitest runner-flow integration tests, Svelte Testing Library assistant UI tests, docs markdown regression tests, Gallery Pi agent MCP/search services.

---

## Scope

Implement only Slice 8 from `docs/superpowers/specs/2026-05-20-pi-agent-search-filter-parity-design.md`.

Included:

- Add assistant-flow regressions for all Slice 8 acceptance prompts:
  1. “Find photos of Alex in Berlin from last summer that are not in any album.”
  2. “Create an album from 5-star videos from Japan.”
  3. “Find screenshots from 2024 that mention invoices.”
  4. “Add beach sunset photos from the Family space to a new album.”
  5. “Find photos taken with my Sony camera in May.”
- Verify the runner flow displays the user message, creates an approval-needed `searchAssets` tool call, approval resumes the runner with a successful tool result, assistant output streams back, and the session stays running.
- Verify the chat UI keeps applied-plan cards in the transcript and the composer usable after an applied plan.
- Verify activity preview summarizes search and apply work without exposing raw payloads by default.
- Update the capability matrix so completed search parity is no longer listed as missing, and the new acceptance prompts are documented.

Excluded:

- Do not add natural-language parsing in Gallery. The runner/LLM still decides which MCP calls to make.
- Do not change tool execution semantics unless a failing acceptance test proves a real runtime bug.
- Do not add new MCP tools, direct apply tools, or direct mutation shortcuts.
- Do not change visual plan review behavior beyond test coverage.

## File Structure

- Modify `server/src/services/agent-runner-flow.integration.spec.ts`
  - Add a table-driven Slice 8 acceptance prompt runner-flow test.
  - Extend the local harness only as needed for smart search and shared-space search approval/resume paths.
- Modify `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
  - Add a transcript regression showing an acceptance prompt, applied plan card, subsequent message, and usable composer.
- Modify `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
  - Add a low-noise activity preview regression for search/apply activity.
- Create `server/src/services/agent-capability-matrix.spec.ts`
  - Add a docs regression for the capability matrix.
- Modify `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`
  - Update current tool surface, capability rows, missing-tool rows, smoke prompts, and next steps.

## Task 1: Runner Acceptance Prompt Matrix

**Files:**

- Modify `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Write failing table-driven runner-flow tests**

Add these helpers near the existing `metadata` helper in `server/src/services/agent-runner-flow.integration.spec.ts`:

```ts
type AcceptanceSearchCase = {
  name: string;
  prompt: string;
  request: Parameters<AgentToolService['searchAssets']>[2];
  expectedRequestSummary: string;
  expectedRequestMetadata: Record<string, unknown>;
  expectedSearchPath: 'metadata' | 'smart';
};

const fixedAssetId = '00000000-0000-4000-8000-000000000501';
const alexPersonId = '00000000-0000-4000-8000-000000000601';
const familySpaceId = '00000000-0000-4000-8000-000000000401';
const acceptanceReferenceDate = '2026-05-21';
```

Add a local helper inside `describe('Pi agent runner flow harness', ...)` before the new test:

```ts
const expectAcceptanceSearchFlow = async (testCase: AcceptanceSearchCase) => {
  const harness = setup();
  const isSpaceScopedSearch = testCase.request.filters?.spaceId === familySpaceId;
  harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(
    isSpaceScopedSearch ? new Set() : new Set([fixedAssetId]),
  );
  harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(
    isSpaceScopedSearch ? new Set([fixedAssetId]) : new Set(),
  );
  harness.accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([alexPersonId]));
  harness.searchRepository.searchMetadata.mockResolvedValue({
    items: [{ id: fixedAssetId }] as never,
    hasNextPage: false,
  });
  harness.searchRepository.searchSmart.mockResolvedValue({
    items: [{ id: fixedAssetId }] as never,
    hasNextPage: false,
  });
  harness.assetRepository.getAgentMetadataByIds.mockResolvedValue([metadata(fixedAssetId)] as never);

  harness.configureRunnerMessage(async function* ({ body }) {
    expect(body.content).toEqual({ blocks: [{ type: 'text', text: testCase.prompt }] });
    const result = await harness.toolService.searchAssets(harness.auth, body.gallerySessionId, testCase.request);
    if (result.status !== 'approval-required') {
      throw new Error(`Expected searchAssets approval for ${testCase.name}`);
    }

    yield {
      type: 'tool-approval-needed',
      sessionId: body.gallerySessionId,
      runnerSessionId: 'runner-session-1',
      toolCallId: result.toolCall.id,
    };
  });

  const session = await harness.sessionService.create(harness.auth, {
    providerCredentialId: '00000000-0000-4000-8000-000000000201',
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.VisualOrganizer,
    approvalMode: AgentApprovalMode.Strict,
    initialContext: {
      entrypoint: 'assistant-page',
      acceptancePrompt: testCase.name,
      acceptanceReferenceDate,
    },
  });

  const userMessage = await harness.messageService.appendUserMessage(harness.auth, session.id, {
    content: { blocks: [{ type: 'text', text: testCase.prompt }] },
  });

  expect(userMessage.role).toBe(AgentMessageRole.User);
  await waitFor(async () => {
    const [pendingToolCall] = await harness.toolService.getToolCalls(harness.auth, session.id);
    expect(pendingToolCall).toEqual(
      expect.objectContaining({
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.PendingApproval,
        requestSummary: testCase.expectedRequestSummary,
      }),
    );
  });

  const [pendingToolCall] = await harness.toolService.getToolCalls(harness.auth, session.id);
  expect(
    harness.toolCalls.toolCalls.find((toolCall) => toolCall.id === pendingToolCall.id)?.redactedRequestMetadata,
  ).toEqual(testCase.expectedRequestMetadata);

  await harness.toolService.approveToolCall(harness.auth, session.id, pendingToolCall.id, {
    decision: AgentToolApprovalDecision.Approved,
  });

  await waitFor(() => {
    expect(harness.runnerRepository.streamResume).toHaveBeenCalledTimes(1);
    expect(harness.runnerResumeBodies).toEqual([
      expect.objectContaining({
        gallerySessionId: session.id,
        toolCallId: pendingToolCall.id,
        approvalDecision: AgentToolApprovalDecision.Approved,
        toolResult: expect.objectContaining({
          status: 'success',
          returnedCount: 1,
          hasMore: false,
        }),
      }),
    ]);
  });

  if (testCase.expectedSearchPath === 'smart') {
    expect(harness.searchRepository.searchSmart).toHaveBeenCalledWith(
      { page: 1, size: 50 },
      expect.objectContaining({
        query: 'beach sunset',
        embedding: '[1, 2, 3]',
        maxDistance: 0.42,
        spaceId: familySpaceId,
      }),
    );
    expect(harness.searchRepository.searchMetadata).not.toHaveBeenCalled();
  } else {
    expect(harness.searchRepository.searchMetadata).toHaveBeenCalled();
    expect(harness.searchRepository.searchSmart).not.toHaveBeenCalled();
  }

  await waitFor(async () => {
    const messages = await harness.messageService.getMessages(harness.auth, session.id);
    const toolCalls = await harness.toolService.getToolCalls(harness.auth, session.id);
    const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);

    expect(messages).toEqual([
      expect.objectContaining({
        role: AgentMessageRole.User,
        content: { blocks: [{ type: 'text', text: testCase.prompt }] },
      }),
      expect.objectContaining({
        role: AgentMessageRole.Assistant,
        providerMessageId: 'provider-message-1',
      }),
    ]);
    expect(toolCalls).toEqual([
      expect.objectContaining({
        id: pendingToolCall.id,
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Returned metadata for 1 asset',
        assetCount: 1,
      }),
    ]);
    expect(reloadedSession?.status).toBe(AgentSessionStatus.Running);
  });

  expect(harness.websocketEvents.map(({ event }) => event.type)).toEqual([
    'tool-approval-needed',
    'assistant-message-delta',
    'assistant-message-created',
  ]);
};
```

Add the table-driven test:

```ts
it.each<AcceptanceSearchCase>([
  {
    name: 'alex berlin last summer unalbumed',
    prompt: 'Find photos of Alex in Berlin from last summer that are not in any album.',
    request: {
      mode: 'metadata',
      filters: {
        personIds: [alexPersonId],
        city: 'Berlin',
        takenAfter: '2025-06-01T00:00:00.000Z',
        takenBefore: '2025-08-31T23:59:59.999Z',
        isNotInAlbum: true,
      },
      limit: 50,
      page: 1,
      order: 'desc',
    },
    expectedRequestSummary: 'Search metadata assets (limit 50)',
    expectedRequestMetadata: {
      mode: 'metadata',
      filters: {
        personIds: [alexPersonId],
        city: 'Berlin',
        takenAfter: '2025-06-01T00:00:00.000Z',
        takenBefore: '2025-08-31T23:59:59.999Z',
        isNotInAlbum: true,
      },
      limit: 50,
      page: 1,
      order: 'desc',
    },
    expectedSearchPath: 'metadata',
  },
  {
    name: 'five-star Japan videos',
    prompt: 'Create an album from 5-star videos from Japan.',
    request: {
      filters: { rating: 5, type: AssetType.Video, country: 'Japan' },
      limit: 50,
    },
    expectedRequestSummary: 'Search metadata assets (limit 50)',
    expectedRequestMetadata: {
      mode: 'metadata',
      filters: { rating: 5, type: AssetType.Video, country: 'Japan' },
      limit: 50,
      page: 1,
      order: 'desc',
    },
    expectedSearchPath: 'metadata',
  },
  {
    name: 'invoice OCR screenshots',
    prompt: 'Find screenshots from 2024 that mention invoices.',
    request: {
      mode: 'ocr',
      query: 'invoice',
      filters: {
        takenAfter: '2024-01-01T00:00:00.000Z',
        takenBefore: '2024-12-31T23:59:59.999Z',
        type: AssetType.Image,
      },
      limit: 50,
    },
    expectedRequestSummary: 'Search ocr assets (limit 50)',
    expectedRequestMetadata: {
      mode: 'ocr',
      filters: {
        takenAfter: '2024-01-01T00:00:00.000Z',
        takenBefore: '2024-12-31T23:59:59.999Z',
        type: AssetType.Image,
      },
      limit: 50,
      page: 1,
      order: 'desc',
      query: 'invoice',
    },
    expectedSearchPath: 'metadata',
  },
  {
    name: 'family beach sunset smart search',
    prompt: 'Add beach sunset photos from the Family space to a new album.',
    request: {
      mode: 'smart',
      query: 'beach sunset',
      filters: { spaceId: familySpaceId },
      limit: 50,
      page: 1,
    },
    expectedRequestSummary: 'Search smart assets (limit 50)',
    expectedRequestMetadata: {
      mode: 'smart',
      filters: { spaceId: familySpaceId },
      limit: 50,
      page: 1,
      query: 'beach sunset',
    },
    expectedSearchPath: 'smart',
  },
  {
    name: 'Sony camera May',
    prompt: 'Find photos taken with my Sony camera in May.',
    request: {
      filters: {
        make: 'Sony',
        takenAfter: '2026-05-01T00:00:00.000Z',
        takenBefore: '2026-05-21T23:59:59.999Z',
      },
      limit: 50,
    },
    expectedRequestSummary: 'Search metadata assets (limit 50)',
    expectedRequestMetadata: {
      mode: 'metadata',
      filters: {
        make: 'Sony',
        takenAfter: '2026-05-01T00:00:00.000Z',
        takenBefore: '2026-05-21T23:59:59.999Z',
      },
      limit: 50,
      page: 1,
      order: 'desc',
    },
    expectedSearchPath: 'metadata',
  },
])('supports Slice 8 acceptance prompt: $name', expectAcceptanceSearchFlow);
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts -- --runInBand
```

Expected:

- The new test fails because the harness does not yet expose all repositories required for shared-space/smart search paths, or because the new helper references missing harness fields.

- [ ] **Step 3: Implement minimal harness support**

In `setup()`:

- Replace the inline system metadata repository with a named mock:

```ts
const systemMetadataRepository = {
  get: vi.fn(() =>
    Promise.resolve({
      machineLearning: { clip: { enabled: true, modelName: 'ViT-Test', maxDistance: 0.42 } },
    }),
  ),
};
```

- Replace the inline machine learning repository with a named mock:

```ts
const machineLearningRepository = { encodeText: vi.fn(() => Promise.resolve('[1, 2, 3]')) };
```

- Expand `searchRepository`:

```ts
const searchRepository = {
  searchMetadata: vi.fn(() => Promise.resolve({ items: [] as Array<{ id: string }>, hasNextPage: false })),
  searchSmart: vi.fn(() => Promise.resolve({ items: [] as Array<{ id: string }>, hasNextPage: false })),
};
```

- Add `getMember` to `sharedSpaceRepository`:

```ts
getMember: vi.fn((spaceId: string, userId: string) =>
  Promise.resolve(spaceId === currentSpace.id && userId === auth.user.id ? { spaceId, userId, role: 'owner' } : null),
),
```

- Pass the named mocks into `AgentToolService` and return them from the harness:

```ts
machineLearningRepository,
systemMetadataRepository,
```

- [ ] **Step 4: Verify Task 1**

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add server/src/services/agent-runner-flow.integration.spec.ts
git commit -m "test: cover pi search acceptance prompts"
```

## Task 2: Assistant UI Acceptance Continuation

**Files:**

- Modify `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

- [ ] **Step 1: Write failing chat-panel test**

Add this test near the existing applied-plan continuation tests in `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`:

```ts
it('shows search acceptance results, applied plan history, and a usable composer after continuation', async () => {
  sdkMock.getAgentSessionMessages.mockResolvedValue([
    {
      ...makeMessage('message-before', AgentMessageRole.User, 'Find screenshots from 2024 that mention invoices.'),
      createdAt: '2026-05-16T10:00:00.000Z',
    },
    {
      ...makeMessage('message-after', AgentMessageRole.Assistant, 'I found matching invoice screenshots.'),
      createdAt: '2026-05-16T10:02:00.000Z',
    },
  ]);
  sdkMock.getAgentToolCalls.mockResolvedValue([
    makeToolCall({
      toolName: AgentToolName.SearchAssets,
      status: AgentToolCallStatus.Completed,
      requestSummary: 'Search ocr assets (limit 50)',
      responseSummary: 'Returned metadata for 4 assets',
      assetCount: 4,
      completedAt: '2026-05-16T10:01:00.000Z',
    }),
  ]);
  sdkMock.appendAgentSessionMessage.mockResolvedValue(
    makeMessage('message-created', AgentMessageRole.User, 'Now archive those.'),
  );
  setAppliedPlanHistory([
    makeAppliedPlan({
      summary: 'Archive invoice screenshots from 2024',
      updatedAt: '2026-05-16T10:01:30.000Z',
      operations: [
        makeOperation({
          id: 'operation-archive',
          type: AgentOperationType.AssetSetArchive,
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'],
          payload: { archive: true },
          status: AgentOperationStatus.Applied,
        }),
      ],
    }),
  ]);

  render(AgentSessionChatPanel, { props: { session: { ...session, status: AgentSessionStatus.Running } } });

  expect(await screen.findByText('Find screenshots from 2024 that mention invoices.')).toBeInTheDocument();
  expect(screen.getByText('I found matching invoice screenshots.')).toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'Activity summary' })).toHaveTextContent('Returned metadata for 4 assets');
  expect(
    screen.getByRole('article', { name: 'Applied plan: Archive invoice screenshots from 2024' }),
  ).toHaveTextContent('Applied plan');

  const input = screen.getByRole('textbox', { name: 'Message' });
  expect(input).not.toBeDisabled();
  await fireEvent.input(input, { target: { value: 'Now archive those.' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() => expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledTimes(1));
  expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith({
    id: session.id,
    agentMessageCreateDto: {
      content: { blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Now archive those.' }] },
    },
  });
});
```

- [ ] **Step 2: Write failing activity-preview test**

Add this test near `maps %s to safe activity copy` in `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`:

```ts
it('summarizes search acceptance activity without raw request payloads by default', () => {
  const model = buildModel({
    toolCalls: [
      makeToolCall({
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.Completed,
        requestSummary: 'Search ocr assets (limit 50)',
        responseSummary: 'Returned metadata for 4 assets',
        assetCount: 4,
      }),
    ],
    appliedPlans: [
      makePlan({
        status: AgentOperationPlanStatus.Applied,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetSetArchive,
            status: AgentOperationStatus.Applied,
            assetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'],
          }),
        ],
      }),
    ],
  });

  const userCopy = model.items.map((item) => `${item.title} ${item.summary}`).join(' ');
  expect(userCopy).toContain('Searching photos');
  expect(userCopy).toContain('Returned metadata for 4 assets');
  expect(userCopy).toContain('Applying changes');
  expect(userCopy).not.toContain('filters');
  expect(userCopy).not.toContain('asset-1');
  expect(userCopy).not.toContain('spacePersonIds');
  expect(model.items.find((item) => item.kind === 'search')?.technical?.toolName).toBe(AgentToolName.SearchAssets);
});
```

- [ ] **Step 3: Run tests and verify red**

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' 'src/routes/(user)/assistant/agent-activity-ui.spec.ts'
```

Expected:

- Tests should pass if current UI already satisfies the behavior. If they pass immediately, record that the red step was not possible because Slice 8 is adding regression coverage for already implemented UI behavior.

- [ ] **Step 4: Implement minimal UI fixes if needed**

Only change production UI if the tests expose a real bug. Expected possible fixes:

- Ensure `AgentSessionChatPanel` keeps the composer enabled for `AgentSessionStatus.Running` when applied-plan history is present.
- Ensure activity rows use safe `requestSummary` / `responseSummary` copy and keep raw payloads inside technical details only.

- [ ] **Step 5: Verify Task 2**

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' 'src/routes/(user)/assistant/agent-activity-ui.spec.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add web/src/routes/'(user)'/assistant/agent-session-chat-panel.spec.ts web/src/routes/'(user)'/assistant/agent-activity-ui.spec.ts
git commit -m "test: cover pi assistant search continuation UI"
```

## Task 3: Capability Matrix Update

**Files:**

- Create `server/src/services/agent-capability-matrix.spec.ts`
- Modify `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`

- [ ] **Step 1: Write failing docs regression**

Create `server/src/services/agent-capability-matrix.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Pi agent capability matrix', () => {
  const readMatrix = () =>
    readFileSync(resolve(process.cwd(), '../docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md'), 'utf8');

  it('documents completed search filter parity and acceptance prompts', () => {
    const markdown = readMatrix();

    expect(markdown).toContain('Smart, OCR, description, filename, and metadata search');
    expect(markdown).toContain('resolveAssetSearchFilters');
    expect(markdown).toContain('Natural-language filtered search');
    expect(markdown).toContain('Solid now');

    for (const prompt of [
      'Find photos of Alex in Berlin from last summer that are not in any album.',
      'Create an album from 5-star videos from Japan.',
      'Find screenshots from 2024 that mention invoices.',
      'Add beach sunset photos from the Family space to a new album.',
      'Find photos taken with my Sony camera in May.',
    ]) {
      expect(markdown).toContain(prompt);
    }

    const needsNewToolSection = markdown.slice(markdown.indexOf('## Needs New MCP Tool'));
    expect(needsNewToolSection).not.toContain('Natural-language semantic search');
    expect(needsNewToolSection).not.toContain('Large-library pagination');
    expect(markdown).toContain('semantic duplicate cleanup or quality scoring');
  });
});
```

- [ ] **Step 2: Run test and verify red**

Run:

```bash
pnpm --dir server test src/services/agent-capability-matrix.spec.ts -- --runInBand
```

Expected:

- FAIL because the matrix still describes older search limitations and does not list the Slice 8 acceptance prompts.

- [ ] **Step 3: Update current capability surface**

In `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`, replace the `searchAssets` and resolver bullets in **Current Capability Surface** with:

```md
- `searchAssets`: Smart, OCR, description, filename, and metadata search by
  date, created/updated ranges, location labels, camera fields, favorite state,
  album membership, tags, people, shared-space people, shared-space scope,
  visibility, rating including unrated, media type, bounded limit, order, and
  page continuation.
- `resolveAssetSearchFilters`: resolves user-facing people, tag, album, shared
  space, location, camera make/model, and lens names into `searchAssets` filters
  or structured ambiguity/denied/no-match results.
```

- [ ] **Step 4: Add a core matrix row**

Add this row to **Core Capability Matrix** after `People-based organization`:

```md
| Natural-language filtered search | “Find photos of Alex in Berlin from last summer that are not in any album.” | Solid now | `resolveAssetSearchFilters` for names, then `searchAssets` with metadata, smart, OCR, description, or filename mode plus structured filters and pagination. | Shows approval when needed, summarizes bounded results, asks to narrow large result sets, and feeds concrete asset IDs into reviewable plans. | People + place + date + unalbumed; 5-star videos by country; OCR invoice screenshots; smart search inside a Family space; Sony camera date filters. |
```

- [ ] **Step 5: Update Needs New MCP Tool and Next Steps**

In **Needs New MCP Tool**:

- Remove the `Natural-language semantic search` row.
- Remove the `Large-library pagination` row.
- Keep duplicate/similar, quality scoring, trash/delete, metadata edits, advanced edits, sharing/export rows.

In **Next Steps**, replace:

```md
3. Decide whether the next capability expansion should be semantic search or
   large-library pagination.
```

with:

```md
3. Decide whether the next capability expansion should be semantic duplicate cleanup or quality scoring.
```

- [ ] **Step 6: Add acceptance prompts**

In **Recommended Product Smoke Prompts**, append:

```md
13. “Find photos of Alex in Berlin from last summer that are not in any album.”
14. “Create an album from 5-star videos from Japan.”
15. “Find screenshots from 2024 that mention invoices.”
16. “Add beach sunset photos from the Family space to a new album.”
17. “Find photos taken with my Sony camera in May.”
```

- [ ] **Step 7: Verify Task 3**

Run:

```bash
pnpm --dir server test src/services/agent-capability-matrix.spec.ts -- --runInBand
pnpm --dir docs format
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add server/src/services/agent-capability-matrix.spec.ts docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md
git commit -m "docs: update pi search capability matrix"
```

## Task 4: Slice Verification

**Files:**

- No new production files expected beyond test/docs changes.

- [ ] **Step 1: Run focused server tests**

```bash
pnpm --dir server test \
  src/services/agent-runner-flow.integration.spec.ts \
  src/services/agent-capability-matrix.spec.ts \
  src/services/agent-mcp-tool-contract.service.spec.ts \
  src/services/agent-mcp-docs.service.spec.ts \
  src/services/agent-mcp-prompt.service.spec.ts \
  src/services/agent-mcp-tool-registry.service.spec.ts \
  src/services/agent-mcp.service.spec.ts \
  -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' 'src/routes/(user)/assistant/agent-activity-ui.spec.ts'
```

Expected: PASS.

- [ ] **Step 3: Run generated sync checks**

```bash
pnpm --dir server build
pnpm --dir server sync:agent-mcp-docs
pnpm --dir server sync:agent-mcp-prompt
git diff --exit-code docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Expected: generated artifacts remain in sync.

- [ ] **Step 4: Run quality gates**

```bash
pnpm --dir server check
pnpm --dir server lint
pnpm --dir server format
pnpm --dir web run check:svelte
pnpm --dir web run check:typescript
pnpm --dir web run lint
pnpm --dir web run format
pnpm --dir docs format
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit formatting if needed**

If formatting commands changed files:

```bash
git add .
git commit -m "style: format pi search acceptance slice"
```

- [ ] **Step 6: Push the completed slice**

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` is updated on `origin`.

## Self-Review Checklist

- TDD order is explicit for server acceptance flows, UI continuation/activity coverage, and capability matrix docs.
- All five Slice 8 acceptance prompts appear in automated tests and the capability matrix.
- Tests cover user message display, approval-needed tool call, approval resume, assistant streaming completion, session remaining running, applied-plan card visibility, and continued composer usage.
- Activity preview coverage proves low-noise user copy and keeps raw payload details out of default summaries.
- Capability matrix no longer lists completed search modes or pagination as missing tools.
- No new direct mutation tools or autonomous apply behavior are introduced.
