# Pi Agent Search Filter Parity Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make people-based organization a supported Pi workflow for global people and shared-space people, with search results usable in album, space, tag, favorite, archive, and rotate plans while chat continues after apply.

**Architecture:** Keep `searchAssets` as the discovery tool and `resolveAssetSearchFilters` as the name-to-ID resolver. Extend resolver behavior so a named shared space plus named person resolves into search-ready `spaceId + spacePersonIds`, while global people continue resolving to `personIds`; then add assistant-flow and plan-apply regressions that prove people search can feed existing operation-plan mutations without ending the session.

**Tech Stack:** NestJS services, Zod DTO schemas, Gallery search suggestions, agent operation plans, Vitest, generated MCP docs and prompt artifacts.

---

## Scope

Implement only Slice 5 from `docs/superpowers/specs/2026-05-20-pi-agent-search-filter-parity-design.md`.

Included:

- Resolve global people names into `personIds`.
- Resolve people names in a unique shared-space scope into `spaceId + spacePersonIds`.
- Treat same-name global and shared-space people as choices when no unique shared-space scope is known.
- Preserve access safety: hidden, inaccessible, and no-match people do not leak hidden IDs or names.
- Prove `searchAssets` accepts resolved people filters with multiple people, tags, dates, and empty results.
- Prove people-derived asset IDs can feed existing album, space, tag, favorite, archive, and rotate operation plans.
- Prove applying a people-derived plan leaves the session running and chat can continue.
- Update MCP guidance and the capability matrix so people-based organization is no longer listed as a missing tool.

Excluded:

- No new mutation tools.
- No unbounded “all people photos” plan-selection contract; large result handling is Slice 6.
- No broad MCP example/correction overhaul beyond people-specific guidance; that is Slice 7.
- No broad acceptance prompt matrix updates beyond the people capability row; that is Slice 8.

## File Structure

- Modify `server/src/services/agent-tool.service.ts`
  - Resolve spaces before people when both are present.
  - Use `scope.spaceId` or a uniquely resolved requested space to resolve named people as `spacePersonIds`.
  - Preserve existing global `personIds` behavior when no shared-space scope is active.
  - Use `primaryProfile` from Gallery filter suggestions when available to build safe choices for global vs shared-space people.
- Modify `server/src/services/agent-tool.service.spec.ts`
  - Add service tests for global people, shared-space people, hidden/inaccessible people, ambiguity, no matches, multiple people, and mixed people + tag + date filters.
- Modify `server/src/services/agent-runner-flow.integration.spec.ts`
  - Add an assistant-flow regression where a user message triggers a people-filtered search approval, approval resumes the runner, the user message remains visible, the completed tool call appears in chat state, and the assistant continues.
- Modify `server/src/services/agent-operation-plan.service.spec.ts`
  - Add plan-apply regressions showing people-search asset IDs can feed supported operation families and leave the session `Running`.
- Modify `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add people-organization guidance and update the shared-space people resolver example.
- Modify `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add example parse tests and guidance expectations for global and shared-space people flows.
- Modify `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Ensure the compact runner prompt teaches `resolveAssetSearchFilters -> searchAssets -> propose plan` for people.
- Modify generated artifacts after server build:
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Modify `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`
  - Move people-based organization from “Needs New MCP Tool” into the supported matrix.

## Behavior Details

People resolution rules after this slice:

```ts
// Global people:
resolveAssetSearchFilters({ people: ['Alex'] });
// => { resolvedFilters: { personIds: ['person-id'] } }

// Shared-space people:
resolveAssetSearchFilters({ people: ['Alex'], spaces: ['Family'] });
// => { resolvedFilters: { spaceId: 'family-space-id', spacePersonIds: ['family-alex-space-person-id'] } }

// Explicit shared-space scope:
resolveAssetSearchFilters({ people: ['Alex'], scope: { spaceId: 'family-space-id' } });
// => { resolvedFilters: { spaceId: 'family-space-id', spacePersonIds: ['family-alex-space-person-id'] } }
```

When a person name can refer to a global person and a shared-space person and the user did not provide a unique space, return `ambiguous` choices. Choices must contain search-ready filters:

```ts
[
  { label: 'Alex', searchFilter: { personIds: ['global-person-id'] } },
  { label: 'Alex in Family', searchFilter: { spaceId: 'family-space-id', spacePersonIds: ['space-person-id'] } },
];
```

Never return `spacePersonIds` without `spaceId`. Never put `space-person:<id>` scoped tokens into `searchAssets.personIds`.

## Task 1: People Resolver And Search Service Coverage

**Files:**

- Modify `server/src/services/agent-tool.service.spec.ts`
- Modify `server/src/services/agent-tool.service.ts`

- [ ] **Step 1: Write failing resolver and search tests**

Add these tests near the existing `resolveAssetSearchFilters` tests in `server/src/services/agent-tool.service.spec.ts`:

```ts
it('resolveAssetSearchFilters resolves people in a named shared space to spacePersonIds', async () => {
  const auth = AuthFactory.create();
  const spaceId = newUuid();
  const spacePersonId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getAllByUserId.mockResolvedValue([makeSpaceRow({ id: spaceId, name: 'Family' })]);
  searchRepository.getFilterSuggestions.mockResolvedValue({
    countries: [],
    cameraMakes: [],
    tags: [],
    people: [
      {
        id: spacePersonId,
        name: 'Alex',
        primaryProfile: { type: 'space-person', id: spacePersonId, spaceId },
      },
    ],
    ratings: [],
    mediaTypes: [],
    hasUnnamedPeople: false,
  });

  const result = await sut.resolveAssetSearchFilters(auth, session.id, {
    people: ['Alex'],
    spaces: ['Family'],
  });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.resolvedFilters).toEqual({ spaceId, spacePersonIds: [spacePersonId] });
    expect(result.results).toEqual([
      expect.objectContaining({ kind: 'space', status: 'matched', id: spaceId }),
      expect.objectContaining({
        kind: 'person',
        status: 'matched',
        id: spacePersonId,
        searchFilter: { spaceId, spacePersonIds: [spacePersonId] },
      }),
    ]);
  }
  expect(searchRepository.getFilterSuggestions).toHaveBeenCalledWith(
    [auth.user.id],
    expect.objectContaining({ spaceId }),
  );
});

it('resolveAssetSearchFilters uses explicit shared-space scope for people before global personIds', async () => {
  const auth = AuthFactory.create();
  const spaceId = newUuid();
  const spacePersonId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getMember.mockResolvedValue(makeSpaceMember({ spaceId, userId: auth.user.id }));
  searchRepository.getFilterSuggestions.mockResolvedValue({
    countries: [],
    cameraMakes: [],
    tags: [],
    people: [{ id: spacePersonId, name: 'Alex', primaryProfile: { type: 'space-person', id: spacePersonId, spaceId } }],
    ratings: [],
    mediaTypes: [],
    hasUnnamedPeople: false,
  });

  const result = await sut.resolveAssetSearchFilters(auth, session.id, {
    people: ['Alex'],
    scope: { spaceId },
  });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.resolvedFilters).toEqual({ spaceId, spacePersonIds: [spacePersonId] });
  }
  expect(searchRepository.getFilterSuggestions).toHaveBeenCalledWith(
    [auth.user.id],
    expect.objectContaining({ spaceId }),
  );
});

it('resolveAssetSearchFilters returns choices for same-name global and shared people without a unique space', async () => {
  const auth = AuthFactory.create();
  const globalPersonId = newUuid();
  const spaceId = newUuid();
  const spacePersonId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
  searchRepository.getFilterSuggestions.mockResolvedValue({
    countries: [],
    cameraMakes: [],
    tags: [],
    people: [
      { id: globalPersonId, name: 'Alex', primaryProfile: { type: 'user-person', id: globalPersonId } },
      {
        id: `space-person:${spacePersonId}`,
        name: 'Alex',
        primaryProfile: { type: 'space-person', id: spacePersonId, spaceId },
      },
    ],
    ratings: [],
    mediaTypes: [],
    hasUnnamedPeople: false,
  });

  const result = await sut.resolveAssetSearchFilters(auth, session.id, {
    people: ['Alex'],
    scope: { withSharedSpaces: true },
  });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.resolvedFilters).toEqual({});
    expect(result.results).toEqual([
      expect.objectContaining({
        kind: 'person',
        status: 'ambiguous',
        choices: expect.arrayContaining([
          expect.objectContaining({ searchFilter: { personIds: [globalPersonId] } }),
          expect.objectContaining({ searchFilter: { spaceId, spacePersonIds: [spacePersonId] } }),
        ]),
      }),
    ]);
  }
});

it('resolveAssetSearchFilters does not leak hidden or inaccessible people as resolved filters', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.getFilterSuggestions.mockResolvedValue({
    countries: [],
    cameraMakes: [],
    tags: [],
    people: [],
    ratings: [],
    mediaTypes: [],
    hasUnnamedPeople: false,
  });

  const result = await sut.resolveAssetSearchFilters(auth, session.id, { people: ['Hidden Person'] });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.resolvedFilters).toEqual({});
    expect(result.results).toEqual([
      expect.objectContaining({ kind: 'person', status: 'not_found', query: 'Hidden Person', choices: [] }),
    ]);
  }
});
```

Add these search execution tests near the existing people `searchAssets` tests:

```ts
it('searchAssets sends multiple global people with tag and date filters to Gallery search', async () => {
  const auth = AuthFactory.create();
  const firstPersonId = newUuid();
  const secondPersonId = newUuid();
  const tagId = newUuid();
  const takenAfter = new Date('2026-05-01T00:00:00.000Z');
  const takenBefore = new Date('2026-05-31T23:59:59.999Z');
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([firstPersonId, secondPersonId]));
  accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set([tagId]));

  await sut.searchAssets(auth, session.id, {
    filters: { personIds: [firstPersonId, secondPersonId], tagIds: [tagId], takenAfter, takenBefore },
    limit: 25,
  });

  expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
    { page: 1, size: 25 },
    expect.objectContaining({
      personIds: [firstPersonId, secondPersonId],
      tagIds: [tagId],
      takenAfter,
      takenBefore,
    }),
  );
});

it('searchAssets returns an empty success page when a resolved person has no matching assets', async () => {
  const auth = AuthFactory.create();
  const personId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
  searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });

  const result = await sut.searchAssets(auth, session.id, { filters: { personIds: [personId] }, limit: 25 });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.returnedCount).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.assetIds).toEqual([]);
  }
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -- --runInBand
```

Expected: FAIL because the resolver currently resolves people before a named space and uses `personIds` instead of `spacePersonIds` for shared-space people.

- [ ] **Step 3: Implement minimal resolver changes**

In `server/src/services/agent-tool.service.ts`:

1. Resolve requested spaces before people.
2. Build a `peopleResolutionScope`:

```ts
const resolvedSpaceId = scope.spaceId ?? resolvedFilters.spaceId;
const peopleScope = resolvedSpaceId ? { ...scope, spaceId: resolvedSpaceId, withSharedSpaces: undefined } : scope;
```

3. Load people suggestions after `resolvedSpaceId` is known.
4. Map people candidates to search filters with a helper like:

```ts
private getPersonSearchFilter(
  candidate: { id?: string; value: string; primaryProfile?: { type: 'user-person' | 'space-person'; id: string; spaceId?: string } },
  scopeSpaceId?: string,
): Partial<AgentSearchAssetsFilters> {
  if (candidate.primaryProfile?.type === 'space-person') {
    const spaceId = candidate.primaryProfile.spaceId ?? scopeSpaceId;
    return spaceId ? { spaceId, spacePersonIds: [candidate.primaryProfile.id] } : {};
  }

  if (scopeSpaceId) {
    return { spaceId: scopeSpaceId, spacePersonIds: [candidate.id!] };
  }

  return { personIds: [candidate.primaryProfile?.id ?? candidate.id!] };
}
```

5. When a matched people filter contains `spacePersonIds`, merge it into `resolvedFilters.spacePersonIds` and set `resolvedFilters.spaceId`.
6. When a matched people filter contains `personIds`, merge it into `resolvedFilters.personIds`.
7. Do not add an empty `searchFilter` choice.

- [ ] **Step 4: Run tests to verify green**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts
git commit -m "$(cat <<'EOF'
feat: resolve pi shared-space people filters
EOF
)"
```

## Task 2: People Search Assistant Flow And Plan Continuation

**Files:**

- Modify `server/src/services/agent-runner-flow.integration.spec.ts`
- Modify `server/src/services/agent-operation-plan.service.spec.ts`
- Modify production files only if the failing tests expose a real gap.

- [ ] **Step 1: Write failing assistant-flow regression**

Extend the runner-flow harness with a people-search scenario. The runner's initial stream should call `searchAssets` with a resolved people filter, yield `tool-approval-needed`, and the resume stream should receive the tool result and complete an assistant response.

Add a test:

```ts
it('shows and resumes a people search tool call while keeping the chat running', async () => {
  const harness = setup();
  const personId = newUuid();
  const session = await harness.sessionService.create(harness.auth, {
    providerCredentialId: '00000000-0000-4000-8000-000000000201',
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.VisualOrganizer,
    approvalMode: AgentApprovalMode.Strict,
    initialContext: {},
  });

  harness.configureRunnerMessage(async function* ({ body }) {
    const result = await harness.toolService.searchAssets(harness.auth, body.gallerySessionId, {
      filters: { personIds: [personId] },
      limit: 25,
    });
    if (result.status !== 'approval-required') {
      throw new Error('Expected searchAssets to request approval');
    }
    yield {
      type: 'tool-approval-needed',
      sessionId: body.gallerySessionId,
      runnerSessionId: 'runner-session-1',
      toolCallId: result.toolCall.id,
    };
  });

  await harness.messageService.appendUserMessage(harness.auth, session.id, {
    content: { blocks: [{ type: 'text', text: 'Find photos of Alex.' }] },
  });

  await waitFor(async () => {
    const [toolCall] = await harness.toolService.getToolCalls(harness.auth, session.id);
    expect(toolCall).toEqual(
      expect.objectContaining({
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.PendingApproval,
        requestSummary: 'Search assets',
      }),
    );
  });

  const [pendingToolCall] = await harness.toolService.getToolCalls(harness.auth, session.id);
  await harness.toolService.approveToolCall(harness.auth, session.id, pendingToolCall.id, {
    decision: AgentToolApprovalDecision.Approved,
  });

  await waitFor(async () => {
    const messages = await harness.messageService.getMessages(harness.auth, session.id);
    const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
    expect(messages).toEqual([
      expect.objectContaining({ role: AgentMessageRole.User }),
      expect.objectContaining({ role: AgentMessageRole.Assistant }),
    ]);
    expect(reloadedSession?.status).toBe(AgentSessionStatus.Running);
  });
});
```

If the current harness hardcodes `listSpaces`, first add `configureRunnerMessage` and keep the original `listSpaces` behavior as the default.

- [ ] **Step 2: Write failing plan-apply continuation regressions**

Add or extend tests in `server/src/services/agent-operation-plan.service.spec.ts` so each operation family accepts asset IDs found through people search and leaves the session running:

```ts
it.each([
  AgentOperationType.AlbumAddAssets,
  AgentOperationType.SpaceAddAssets,
  AgentOperationType.AssetAddTag,
  AgentOperationType.AssetSetFavorite,
  AgentOperationType.AssetSetArchive,
  AgentOperationType.AssetRotate,
])('keeps chat running after applying a people-search %s plan', async (type) => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const operation = makeOperationForType(type, { assetIds: [assetId] });
  const plan = makePlan({ sessionId: session.id, operations: [operation] });

  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  mockSuccessfulMutationForType(type, auth, assetId);

  await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

  expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
    status: AgentSessionStatus.Running,
    endedAt: null,
  });
});
```

Use local helpers that build valid operation payloads for each operation type and stub the corresponding mutation service. Do not add a special “people source” field to operations; the guarantee is that people-search asset IDs remain normal plan assets.

- [ ] **Step 3: Run tests to verify red**

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts src/services/agent-operation-plan.service.spec.ts -- --runInBand
```

Expected: FAIL if the harness is missing configurable runner behavior or if any operation family incorrectly completes the session after apply.

- [ ] **Step 4: Implement minimal production or harness fixes**

If only the test harness lacks configurability, add the smallest harness helper:

```ts
let streamMessageImplementation = defaultStreamMessage;

runnerRepository.streamMessage.mockImplementation(async function* (args) {
  yield* streamMessageImplementation(args);
});

configureRunnerMessage: (implementation) => {
  streamMessageImplementation = implementation;
};
```

If an operation family still marks the session completed, update `AgentOperationPlanService.applyApprovedOperations` so successful apply always updates the current session to:

```ts
{ status: AgentSessionStatus.Running, endedAt: null }
```

- [ ] **Step 5: Run tests to verify green**

Run:

```bash
pnpm --dir server test src/services/agent-runner-flow.integration.spec.ts src/services/agent-operation-plan.service.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/agent-runner-flow.integration.spec.ts server/src/services/agent-operation-plan.service.spec.ts server/src/services/agent-operation-plan.service.ts
git commit -m "$(cat <<'EOF'
test: cover pi people search plan continuation
EOF
)"
```

If `server/src/services/agent-operation-plan.service.ts` is unchanged, omit it from `git add`.

## Task 3: MCP Guidance And Capability Matrix

**Files:**

- Modify `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`
- Modify generated artifacts:
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Write failing MCP guidance tests**

Add tests to `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

```ts
it('documents resolver-first people organization flows for global and shared-space people', () => {
  const contracts = sut.listToolContracts();
  const resolver = contracts.find((contract) => contract.name === AgentToolName.ResolveAssetSearchFilters);
  const search = contracts.find((contract) => contract.name === AgentToolName.SearchAssets);

  expect(resolver?.usage).toContain('For named people in a named shared space, resolve the space and person together');
  expect(resolver?.examples).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'resolve-space-person-filters',
        arguments: { people: ['Pierre'], spaces: ['Family'] },
      }),
    ]),
  );
  expect(search?.usage).toContain('Use returned personIds or spaceId plus spacePersonIds');
});

it('keeps every people organization example parseable against the live schemas', () => {
  const contracts = sut.listToolContracts();

  for (const contract of contracts) {
    for (const example of contract.examples.filter((item) => item.name.includes('person'))) {
      const result = AgentReadToolRequestSchemas[contract.name].safeParse(example.arguments);
      expect(result.success, `${contract.name} example ${example.name} should parse`).toBe(true);
    }
  }
});
```

Add a prompt test to `server/src/services/agent-mcp-prompt.service.spec.ts`:

```ts
it('teaches people organization as resolve, search, then plan', () => {
  const prompt = service.getPrompt();

  expect(prompt).toContain('Resolve names before searchAssets');
  expect(prompt).toContain('people');
  expect(prompt).toContain('spacePersonIds');
  expect(prompt).toContain('propose');
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts -- --runInBand
```

Expected: FAIL because people-specific resolver-first guidance still says broad shared-space scope or lacks `spacePersonIds` plan-flow wording.

- [ ] **Step 3: Update MCP contract and prompt guidance**

In `server/src/services/agent-mcp-tool-contract.service.ts`:

- Update resolver usage with:

```ts
'For named people in a named shared space, resolve the space and person together so the result can return spaceId plus spacePersonIds.';
```

- Change `resolve-space-person-filters` example arguments from:

```ts
{ people: ['Pierre'], spaces: ['Family'], scope: { withSharedSpaces: true } }
```

to:

```ts
{ people: ['Pierre'], spaces: ['Family'] }
```

- Update `searchAssets` usage with:

```ts
'Use returned personIds or spaceId plus spacePersonIds, then propose operation plans with the returned asset IDs.';
```

- Keep correction hints from Slice 4 intact.

- [ ] **Step 4: Update capability matrix**

In `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`:

- Add a core matrix row:

```md
| People-based organization | “Add photos of Alex to a Family album.” | Solid now | `resolveAssetSearchFilters` for person/space names, `searchAssets` with `personIds` or `spaceId + spacePersonIds`, then propose album/space/tag/favorite/archive/rotate operations. | Clarifies ambiguous people, shows selected assets before apply, and keeps chat open after apply. | Global person; shared-space person; same-name ambiguity; no matching assets; mixed people + tag + date filters. |
```

- Remove the existing `People-based organization` row from `Needs New MCP Tool`.
- Update the “next capability expansion” note so people search is no longer pending.

- [ ] **Step 5: Regenerate docs and prompt artifacts**

Run:

```bash
pnpm --dir server build
pnpm --dir server sync:agent-mcp-docs
pnpm --dir server sync:agent-mcp-prompt
```

Expected: generated docs and prompt cheat sheet update cleanly.

- [ ] **Step 6: Run tests to verify green**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  server/src/services/agent-mcp-tool-contract.service.ts \
  server/src/services/agent-mcp-tool-contract.service.spec.ts \
  server/src/services/agent-mcp-prompt.service.spec.ts \
  agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs \
  docs/superpowers/generated/pi-agent-mcp-tools.md \
  docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md
git commit -m "$(cat <<'EOF'
docs: mark pi people organization supported
EOF
)"
```

## Task 4: Slice Verification

**Files:**

- No planned production edits.
- Formatting may touch files already modified by Tasks 1-3.

- [ ] **Step 1: Run focused slice test suite**

Run:

```bash
pnpm --dir server test \
  src/services/agent-tool.service.spec.ts \
  src/services/agent-runner-flow.integration.spec.ts \
  src/services/agent-operation-plan.service.spec.ts \
  src/services/agent-mcp-tool-contract.service.spec.ts \
  src/services/agent-mcp-prompt.service.spec.ts \
  src/services/agent-mcp-docs.service.spec.ts \
  -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run server quality gates**

Run:

```bash
pnpm --dir server check
pnpm --dir server lint
pnpm --dir server format
pnpm --dir docs format
git diff --check
```

Expected: all PASS. If `format` fails, run `pnpm --dir server format:fix` or the relevant formatter, then rerun the check command.

- [ ] **Step 3: Commit any formatting-only changes**

If formatting changed files:

```bash
git add <formatted-files>
git commit -m "$(cat <<'EOF'
style: format pi people search slice
EOF
)"
```

- [ ] **Step 4: Push Slice 5**

Run:

```bash
git push
```

Expected: `explore/pi-agent-brainstorm -> explore/pi-agent-brainstorm`.
