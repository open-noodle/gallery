# Pi Agent Handle-First Tool Contract Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove provider-facing prompt, docs, MCP schema, recovery, and runner-compaction guidance that teaches Pi to traffic search-derived asset IDs.

**Architecture:** Keep Slice 1's handle-first search result contract as the baseline. Slice 2 updates the model-facing guidance and runner safety net so old or oversized search tool results are represented as handles, counts, source refs, and result-size metadata, never raw search asset IDs. It does not add handle metadata reads, curation transforms, planning raw-ID rejection, or raised limits; those remain later slices.

**Tech Stack:** TypeScript/NestJS/Zod/Vitest for MCP contracts and docs, Node ESM test runner for `agent-runner`, generated markdown/prompt artifacts from `AgentMcpDocsService` and `AgentMcpPromptService`.

---

## Slice Scope

Implement only Slice 2 from `docs/superpowers/specs/2026-05-27-pi-agent-handle-first-tool-contract-design.md`:

- Runner compaction redacts legacy/nested search result asset IDs even when the result is under the normal byte budget.
- Prompt guidance says `searchAssets` returns handles/source refs and does not ask Pi to copy selected search `assetIds`.
- Generated MCP docs and tool-list schema descriptions stop advertising `detail: "ids"` and `createSelectionHandle` as the normal search path.
- Compatibility remains: requests with `detail: "ids"` still parse, but the default and advertised examples use `detail: "handle"` or omit `detail`.
- Recovery guidance stops saying `createSelectionHandle: true`; it tells Pi to rerun `searchAssets` and use the returned `selectionHandle.id` or `selectionHandle.sourceRef`.

Out of scope:

- Do not add `readSelectionMetadata`.
- Do not add `curateSelection`.
- Do not reject planning `assetIds` or `assetSource.explicitAssets`.
- Do not raise search limits.
- Do not remove internal persisted `assetIds`.

## Files

- Modify: `agent-runner/src/pi-runtime.mjs`
  - Owns runner prompt text and compaction of prior/resumed Gallery tool results.
- Modify: `agent-runner/src/pi-runtime.test.mjs`
  - Adds runner regression coverage for legacy search asset ID redaction and updates prompt assertions.
- Modify: `server/src/dtos/agent-tool.dto.ts`
  - Defaults new `searchAssets` requests to `detail: "handle"` while keeping `detail: "ids"` compatibility.
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
  - Updates DTO default tests and adds compatibility assertions.
- Modify: `server/src/services/agent-tool.service.ts`
  - Uses normalized search response detail in request summaries and redacted request metadata.
- Modify: `server/src/services/agent-tool.service.spec.ts`
  - Updates request summary/redacted metadata expectations from `ids` to `handle` where the request omitted detail.
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`
  - Updates persisted approval-flow request summaries from `ids` to `handle` where detail is omitted.
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Rewords search/read/planning contract usage, examples, and common-mistake hints.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Contract tests for handle-first examples and no advertised search `detail: "ids"`.
- Modify: `server/src/services/agent-mcp-prompt-placeholders.ts`
  - Renames example asset placeholders so docs do not imply asset IDs came from `searchAssets`.
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
  - Tool-list property descriptions for `detail`, `assetIds`, and `assetSelectionHandleId`.
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Tool schema description tests for handle-first language.
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
  - Prompt cheat sheet text and selected examples.
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Prompt tests that fail on old search-ID guidance.
- Modify: `server/src/services/agent-mcp-docs.service.ts`
  - Static generated-doc workflow sections.
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
  - Docs tests that fail on advertised search `detail: "ids"` and `createSelectionHandle`.
- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Recovery wording only: no behavioral planning hardening in this slice.
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
  - Recovery wording expectations.
- Modify: `server/src/services/agent-mcp.service.spec.ts`
  - Any MCP validation/recovery expectation snapshots that include old handle creation wording.
- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Modify: this plan file only if review finds a gap before execution.

---

## Task 1: Runner Compaction Search-ID Redaction

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`

- [ ] **Step 1: Add failing runner compaction tests**

Add these tests near the existing compaction tests in `agent-runner/src/pi-runtime.test.mjs`.
Update the import at the top of the file so the test can call the compaction helper directly:

```js
import {
  compactGalleryToolResultForPrompt,
  compactGalleryToolTranscript,
  createPiRuntime,
  mapProviderType,
  redactSecret,
} from './pi-runtime.mjs';
```

```js
it('compacts legacy search results with asset ids even under the normal prompt budget', () => {
  const leakedAssetIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const compacted = compactGalleryToolResultForPrompt({
    status: 'success',
    summary: `Returned ${leakedAssetIds.length} asset ids`,
    toolCall: {
      id: '00000000-0000-4000-8000-000000000333',
      toolName: 'mcp_gallery_searchAssets',
      status: 'completed',
    },
    detail: 'ids',
    assetIds: leakedAssetIds,
    assets: { items: leakedAssetIds.map((id) => ({ id, originalFileName: `${id}.jpg` })) },
    selectionHandle: {
      id: '00000000-0000-4000-8000-000000000444',
      sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000444',
      assetCount: 2,
      sourceToolCallId: '00000000-0000-4000-8000-000000000333',
      expiresAt: '2026-05-27T12:00:00.000Z',
    },
    resultSize: {
      returnedItems: 2,
      hasMore: false,
      nextPage: null,
      estimatedBytes: 1024,
      truncated: false,
      omittedFields: [],
    },
  });

  const text = JSON.stringify(compacted);

  assert.equal(compacted.compacted, true);
  assert.equal(compacted.selectionHandle.id, '00000000-0000-4000-8000-000000000444');
  assert.equal(compacted.counts.assets, 2);
  assert.equal(JSON.parse(text).counts.assets, 2);
  assert.equal(Object.hasOwn(compacted, 'assets'), false);
  assert.equal(text.includes(leakedAssetIds[0]), false);
  assert.equal(text.includes(leakedAssetIds[1]), false);
  assert.equal(text.includes('"assetIds"'), false);
  assert.equal(text.includes('"assetIdsSample"'), false);
});

it('redacts nested legacy search asset ids from prior tool transcript compaction', () => {
  const leakedAssetId = '33333333-3333-4333-8333-333333333333';
  const messages = [
    {
      role: 'tool',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            toolCall: {
              id: '00000000-0000-4000-8000-000000000333',
              toolName: 'searchAssets',
              status: 'completed',
            },
            assets: { items: [{ id: leakedAssetId, city: 'Paris' }] },
            selectionHandle: {
              id: '00000000-0000-4000-8000-000000000444',
              sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000444',
              assetCount: 1,
              sourceToolCallId: '00000000-0000-4000-8000-000000000333',
              expiresAt: '2026-05-27T12:00:00.000Z',
            },
          }),
        },
      ],
    },
  ];

  compactGalleryToolTranscript({ messages });

  const compacted = JSON.parse(messages[0].content[0].text);
  assert.equal(compacted.compacted, true);
  assert.equal(compacted.selectionHandle.assetCount, 1);
  assert.equal(compacted.counts.assets, 1);
  assert.equal(Object.hasOwn(compacted, 'assets'), false);
  assert.equal(messages[0].content[0].text.includes(leakedAssetId), false);
});

it('resumes approval with a compact handle summary for legacy search results', async () => {
  const { sdk, ai, calls } = createFakeDependencies();
  const runtime = createPiRuntime({ sdk, ai });
  await runtime.createSession(createSessionBody());
  const leakedAssetId = '44444444-4444-4444-8444-444444444444';

  await collect(
    runtime.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'approved',
      toolResult: {
        status: 'success',
        toolCall: {
          id: '00000000-0000-4000-8000-000000000333',
          toolName: 'searchAssets',
          status: 'completed',
        },
        assetIds: [leakedAssetId],
        selectionHandle: {
          id: '00000000-0000-4000-8000-000000000444',
          sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000444',
          assetCount: 1,
          sourceToolCallId: '00000000-0000-4000-8000-000000000333',
          expiresAt: '2026-05-27T12:00:00.000Z',
        },
      },
    }),
  );

  assert.match(calls.prompts[0], /compact approved tool result summary/i);
  assert.match(calls.prompts[0], /selectionHandle/i);
  assert.equal(calls.prompts[0].includes(leakedAssetId), false);
  assert.equal(calls.prompts[0].includes('assetIdsSample'), false);
});
```

- [ ] **Step 2: Run runner tests and verify they fail for the expected reason**

Run:

```bash
node --test --test-name-pattern "legacy search|handle summary for legacy search" agent-runner/src/pi-runtime.test.mjs
```

Expected: FAIL. The first test returns the original under-budget search result or includes `assetIds`; transcript and approval resume do not compact legacy search payloads.

- [ ] **Step 3: Implement search-aware compaction**

In `agent-runner/src/pi-runtime.mjs`, update compaction helpers.

Use these concrete helper shapes:

```js
const searchToolNames = new Set(['searchAssets', 'mcp_gallery_searchAssets']);
const resultToolName = (toolResult) =>
  typeof toolResult?.toolCall?.toolName === 'string'
    ? toolResult.toolCall.toolName
    : typeof toolResult?.toolName === 'string'
      ? toolResult.toolName
      : undefined;
const isSearchAssetsToolResult = (toolResult) => searchToolNames.has(resultToolName(toolResult));
const countNestedAssetItems = (toolResult) =>
  Array.isArray(toolResult?.assets?.items)
    ? toolResult.assets.items.length
    : Array.isArray(toolResult?.assets)
      ? toolResult.assets.length
      : 0;
const containsLegacySearchAssetPayload = (toolResult) =>
  isSearchAssetsToolResult(toolResult) &&
  (Array.isArray(toolResult?.assetIds) || countNestedAssetItems(toolResult) > 0);
const shouldCompactGalleryToolResult = (toolResult, serialized, force) =>
  force ||
  containsLegacySearchAssetPayload(toolResult) ||
  !serialized ||
  byteLength(serialized) > galleryToolResultPromptBudgetBytes;
```

Change `compactGalleryToolResultForPrompt` to use `shouldCompactGalleryToolResult(...)` instead of the current early return:

```js
if (!shouldCompactGalleryToolResult(toolResult, serialized, force)) {
  return toolResult;
}
```

Add compact handle mapping:

```js
const compactSelectionHandle = (selectionHandle) => {
  if (!selectionHandle || typeof selectionHandle !== 'object') {
    return undefined;
  }

  return {
    id: typeof selectionHandle.id === 'string' ? selectionHandle.id : undefined,
    sourceRef: typeof selectionHandle.sourceRef === 'string' ? selectionHandle.sourceRef.slice(0, 160) : undefined,
    assetCount:
      Number.isInteger(selectionHandle.assetCount) && selectionHandle.assetCount >= 0
        ? selectionHandle.assetCount
        : undefined,
    sourceToolCallId:
      typeof selectionHandle.sourceToolCallId === 'string' ? selectionHandle.sourceToolCallId : undefined,
    expiresAt: typeof selectionHandle.expiresAt === 'string' ? selectionHandle.expiresAt : undefined,
  };
};
```

Remove `assetIdsSample` from the compacted `ids` object. Keep `operationIdsSample` because operation ids are not asset ids and existing plan-resume tests rely on them:

```js
ids: {
  albumIdsSample: sampleIds(toolResult.albumIds ?? toolResult.albums),
  spaceIdsSample: sampleIds(toolResult.spaceIds ?? toolResult.spaces),
  userIdsSample: sampleIds(toolResult.userIds ?? toolResult.users),
  operationIdsSample: operationIds.slice(0, 10),
},
selectionHandle: compactSelectionHandle(toolResult.selectionHandle),
omittedDetailInstruction:
  'Detailed rows were omitted. Continue with returned selection handles, source refs, counts, or the smallest Gallery MCP read tool for specific non-search assets when required.',
```

Update asset counts to count search handles and nested legacy search arrays:

```js
assets:
  Number.isInteger(toolResult?.selectionHandle?.assetCount) && toolResult.selectionHandle.assetCount >= 0
    ? toolResult.selectionHandle.assetCount
    : countArray(toolResult, 'assets') || countArray(toolResult, 'assetIds') || countNestedAssetItems(toolResult),
```

Update `compactGalleryToolTranscript` to compact when `containsLegacySearchAssetPayload(parsed)` is true even if the JSON is below `galleryToolResultPromptBudgetBytes`.

- [ ] **Step 4: Update runner behavior prompt tests**

In `agent-runner/src/pi-runtime.test.mjs`, replace expectations that require old raw-ID guidance:

```js
assert.equal(calls.loaders[0].systemPrompt.includes('Progressive: resolve names -> search detail ids'), false);
assert.equal(calls.loaders[0].systemPrompt.includes('selected assetIds only'), false);
assert.equal(calls.loaders[0].systemPrompt.includes('Technical metadata: search ids first'), false);
assert.equal(calls.loaders[0].systemPrompt.includes('searchAssets returns selection handles'), true);
```

- [ ] **Step 5: Run focused runner tests**

Run:

```bash
node --test --test-name-pattern "legacy search|prior Gallery tool result|compact approved result|system prompt" agent-runner/src/pi-runtime.test.mjs
```

Expected: PASS for the focused runner tests.

- [ ] **Step 6: Commit runner compaction**

Run:

```bash
git add agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs
git commit -m "fix: redact search asset ids in runner compaction"
```

---

## Task 2: Search Request Defaults And Audit Summary Language

**Files:**

- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Add failing DTO default and compatibility tests**

In `server/src/dtos/agent-tool.dto.spec.ts`, update the current default test and keep compatibility explicit:

```ts
it('defaults searchAssets to handle detail and a bounded limit', () => {
  const result = parseSearchAssetsRequest({});

  expect(result.success).toBe(true);
  if (!result.success) {
    return;
  }

  expect(result.data).toEqual({
    mode: 'metadata',
    filters: {},
    limit: 100,
    page: 1,
    order: 'desc',
    detail: 'handle',
    fields: [],
  });
});

it('keeps detail ids as a deprecated compatibility request alias', () => {
  const result = parseSearchAssetsRequest({ detail: 'ids', filters: {}, limit: 5 });

  expect(result.success).toBe(true);
  if (!result.success) {
    return;
  }

  expect(result.data.detail).toBe('ids');
});
```

Add a response-side test near the existing handle-first response tests:

```ts
it('does not advertise ids detail in search success response examples', () => {
  const encoded = encodeToolResponse({
    status: 'success',
    toolCall: makeToolCall({ toolName: AgentToolName.SearchAssets }),
    resultSize: makeResultSize({ returnedItems: 1 }),
    summary: 'Created a selection handle for 1 asset',
    detail: 'handle',
    selectionHandle: makeSelectionHandle({ assetCount: 1 }),
    returnedCount: 1,
    hasMore: false,
    nextPage: null,
  });

  expect(encoded.success).toBe(true);
  if (!encoded.success) {
    return;
  }
  expect(encoded.data.detail).toBe('handle');
  expect(JSON.stringify(encoded.data)).not.toContain('"detail":"ids"');
});
```

- [ ] **Step 2: Add failing service summary tests**

Update expectations where the request omits `detail` so they expect `handle`:

```ts
requestSummary: 'Search metadata assets (limit 1, handle)',
```

For tests that explicitly send `detail: 'ids'`, add or keep one compatibility assertion proving the request metadata can record the legacy request but the provider-visible response is normalized:

```ts
expect(result.content.detail).toBe('handle');
expect(result.toolCall.redactedRequestMetadata).toEqual(expect.objectContaining({ detail: 'ids' }));
```

Do not remove Slice 1 compatibility tests that call `detail: 'ids'`.

Add or keep one redacted response metadata assertion so Slice 2 proves useful handle metadata remains available after removing ID guidance:

```ts
expect(result.toolCall.redactedResponseMetadata).toEqual(
  expect.objectContaining({
    selectionHandleIds: [result.content.selectionHandle.id],
    selectionHandleSourceRefs: [result.content.selectionHandle.sourceRef],
    selectionHandleAssetCount: result.content.selectionHandle.assetCount,
  }),
);
expect(JSON.stringify(result.toolCall.redactedResponseMetadata)).not.toContain('"assetIds"');
```

- [ ] **Step 3: Run DTO/service tests and verify expected red failures**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
```

Expected: FAIL on default detail/request summary expectations. Search behavior remains handle-first; only defaults and persisted request summary text need implementation.

- [ ] **Step 4: Implement handle defaults and normalized request summaries**

In `server/src/dtos/agent-tool.dto.ts`, change the transformed default:

```ts
detail: value.detail ?? 'handle',
```

In `server/src/services/agent-tool.service.ts`, normalize the displayed detail for omitted values:

```ts
const requestDetail = request.detail ?? 'handle';
```

Use that in request summary, request metadata, and normalized execution request:

```ts
requestSummary: (request) =>
  `Search ${request.mode ?? 'metadata'} assets (limit ${this.getSearchLimit(request)}, ${request.detail ?? 'handle'})`,
```

```ts
detail: request.detail ?? 'handle',
```

Leave `normalizeSearchResponseDetail(detail)` so explicit `ids` requests still return `detail: 'handle'` provider content.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit default/audit updates**

Run:

```bash
git add server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-runner-flow.integration.spec.ts
git commit -m "fix: default search requests to handle detail"
```

---

## Task 3: MCP Contract, Prompt, Docs, Registry, And Recovery Guidance

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt-placeholders.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add failing contract tests for handle-first advertised examples**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, update the progressive search test to require handle-first examples:

```ts
expect(exampleByName.get('compact-date-location-search')?.arguments).toMatchObject({
  detail: 'handle',
  limit: 50,
});
expect(exampleByName.get('visual-curation-candidate-search')?.arguments).toMatchObject({
  detail: 'handle',
});
expect(JSON.stringify(search)).not.toContain('"detail":"ids"');
expect(JSON.stringify(search)).not.toContain('createSelectionHandle');
```

Update the large selection handle test:

```ts
expect(search?.usage).toContain('Search always returns selectionHandle');
expect(search?.usage).toContain('assetSelectionHandleId');
expect(search?.usage).not.toContain('createSelectionHandle');
expect(searchExample?.arguments).toMatchObject({
  detail: 'handle',
  sampleSize: 5,
  limit: 500,
});
expect(searchExample?.arguments).not.toHaveProperty('createSelectionHandle');
```

Update broad metadata and curation hint expectations:

```ts
expect(metadata?.usage).toContain('Use only for exact small asset IDs from non-search contexts');
expect(search?.commonMistakes.find((mistake) => mistake.id === 'search-broad-full-metadata')?.hint).toContain(
  'Search returns a selection handle',
);
expect(search?.commonMistakes.find((mistake) => mistake.id === 'search-preview-before-shortlist')?.hint).toContain(
  'Use the selection handle or source-backed workflow',
);
```

- [ ] **Step 2: Add failing placeholder and prompt tests for old guidance**

In `server/src/services/agent-mcp-prompt.service.spec.ts`, update the placeholder map expectation:

```ts
expect(agentMcpPromptPlaceholderMap).toEqual({
  '00000000-0000-4000-8000-000000000001': '<exact-asset-id-from-non-search-context>',
  '00000000-0000-4000-8000-000000000002': '<another-exact-asset-id-from-non-search-context>',
  '00000000-0000-4000-8000-000000000010': '<album.id from listAlbums/readAlbum>',
  '00000000-0000-4000-8000-000000000020': '<space.id from listSpaces/readSpace>',
  '00000000-0000-4000-8000-000000000021': '<spacePersonIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000030': '<tagIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000040': '<personIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000041': '<another-personIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000111': '<approved-toolCallId>',
  '00000000-0000-4000-8000-000000000222': '<plan.id from proposed plan>',
  '00000000-0000-4000-8000-000000000333': '<selectionHandle.id from searchAssets>',
  'asset-source:search:00000000-0000-4000-8000-000000000333': '<sourceRef from searchAssets>',
});
```

Update the nested placeholder render assertion:

```ts
assetIds: [
  '<exact-asset-id-from-non-search-context>',
  '<another-exact-asset-id-from-non-search-context>',
],
```

In `server/src/services/agent-mcp-prompt.service.spec.ts`, update old positive assertions into handle-first assertions:

```ts
expect(prompt).toContain('searchAssets returns selection handles');
expect(prompt).toContain('selectionHandle.id');
expect(prompt).toContain('sourceRef');
expect(prompt).not.toContain('Progressive: resolve names -> search detail ids');
expect(prompt).not.toContain('"detail":"ids"');
expect(prompt).not.toContain('search ids first');
expect(prompt).not.toContain('selected assetIds only');
expect(prompt).not.toContain('<asset-id-from-searchAssets>');
expect(prompt).not.toContain('createSelectionHandle');
expect(prompt).not.toContain('<exact-asset-id-from-non-search-context>');
```

Keep placeholder-map unit tests unchanged; they verify renderer behavior for fixture values and are not themselves model guidance.
Update the "selects existing search metadata preview and plan examples for highlight curation" test so it no longer expects `ReadAssetMetadata` or `ReadAssetPreviews` selected prompt examples. It should assert `SearchAssets` and planning examples remain selected, and that the prompt contains no raw-ID placeholder.

- [ ] **Step 3: Add failing docs and registry tests**

In `server/src/services/agent-mcp-docs.service.spec.ts`, add this exact helper below the existing `section` helper, then update the progressive workflow test:

```ts
const subsection = (markdown: string, title: string) => {
  const start = markdown.indexOf(title);
  expect(start, `${title} should exist`).toBeGreaterThanOrEqual(0);
  const remainder = markdown.slice(start + title.length);
  const next = remainder.search(/\n#{2,3} /);
  return markdown.slice(start, next === -1 ? undefined : start + title.length + next);
};
```

```ts
expect(markdown).toContain('Search returns selection handles');
expect(markdown).toContain('selectionHandle.id');
expect(markdown).toContain('sourceRef');
expect(markdown).not.toContain('Search compact IDs first');
expect(markdown).not.toContain('detail: "ids"');
expect(markdown).not.toContain('`detail: "ids"`');
expect(subsection(markdown, '### Large selections')).not.toContain('createSelectionHandle');
expect(markdown).not.toContain('<asset-id-from-searchAssets>');
```

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, update property description tests:

```ts
expect(searchProperties?.detail?.description).toContain('handle');
expect(searchProperties?.detail?.description).not.toContain('ids returns compact asset ids');
expect(searchProperties?.assetIds?.description).not.toContain('ids returned by Gallery tools');
```

- [ ] **Step 4: Add failing recovery guidance tests**

Update expectations in `server/src/services/agent-operation-plan.service.spec.ts` and `server/src/services/agent-mcp.service.spec.ts`:

```ts
expect(hint).toContain('Rerun searchAssets and use the returned selectionHandle.id');
expect(hint).not.toContain('createSelectionHandle true');
```

For source refs:

```ts
expect(hint).toContain('Rerun searchAssets and use the returned selectionHandle.sourceRef');
expect(hint).not.toContain('createSelectionHandle true');
```

- [ ] **Step 5: Run MCP/prompt/docs/recovery tests and verify expected red failures**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: FAIL on old `detail: "ids"`, `createSelectionHandle`, and selected `assetIds` guidance.

- [ ] **Step 6: Implement contract and registry wording**

In `server/src/services/agent-mcp-prompt-placeholders.ts`, update only the first two placeholder strings:

```ts
'00000000-0000-4000-8000-000000000001': '<exact-asset-id-from-non-search-context>',
'00000000-0000-4000-8000-000000000002': '<another-exact-asset-id-from-non-search-context>',
```

In `server/src/services/agent-mcp-tool-contract.service.ts`:

- Change `readAssetMetadataContract.usage` to:

```ts
'Legacy exact-asset read. Use only for exact small asset IDs from non-search contexts, or use only toolCallId when retrying a Gallery-approved request. Search results return selection handles and source refs; do not pass search-derived IDs into this tool. Use fields for exact metadata groups: type, dates, location, camera, tags, rating, filename, favorite, visibility.';
```

- Change `searchAssetsContract.usage` to:

```ts
'Known ID filters: people, spaces, visibility, dates, albums, tags, camera fields, ratings, and media types. Use returned personIds or spaceId plus spacePersonIds. Use mode smart, description, ocr, or filename with query for text search. Search always returns selectionHandle plus sourceRef, counts, paging, and optional samples; use selectionHandle.id as assetSelectionHandleId or sourceRef for source-backed planning instead of copying asset IDs. Do not use limit 1000; ask one narrowing question or repeat the same mode, query, filters, order, and limit using the returned nextPage value as page. When resolveAssetSearchFilters returns resolvedFilters, copy those fields into searchAssets.filters exactly. For people OR requests, use one personIds array with every resolved person id. For shared-space people, include both spaceId and spacePersonIds.';
```

- Replace search examples that advertise IDs:
  - `compact-date-location-search`: `detail: 'handle'`
  - `visual-curation-candidate-search`: `detail: 'handle'`
  - `large-album-page-search`: `detail: 'handle'`
  - `large-selection-handle-search`: `detail: 'handle'`, remove `createSelectionHandle: true`
  - `search-resolved-pierre-aurelia-people`: `detail: 'handle'`, remove `createSelectionHandle: true`
  - `search-resolved-family-space-people`: `detail: 'handle'`

- Replace search mistake hints:

```ts
hint: 'Search returns a selection handle first. Ask one narrowing question, page with nextPage, or use a later handle metadata read instead of requesting full metadata for a broad search.',
```

```ts
hint: 'For visual curation, search returns a selection handle. Use the selection handle or source-backed workflow, and defer preview reads until a bounded exact set is available.',
```

- Change planning guidance strings containing `createSelectionHandle` to:

```ts
'Create a reviewable Gallery operation plan. Put all writes in operations and let Gallery apply the plan after user review. For search selections, use assetSelectionHandleId from searchAssets selectionHandle.id instead of pasting asset IDs.';
```

```ts
hint: 'For hundreds or thousands of assets, call searchAssets and use the returned selectionHandle.id as assetSelectionHandleId in the plan.',
```

In `server/src/services/agent-mcp-tool-registry.service.ts`, update `propertyDescriptions`:

```ts
assetIds: 'Legacy explicit asset ids for exact small non-search reads or internal planning compatibility. Do not use search-derived ids.',
detail:
  'Result detail level. For searchAssets, handle returns selectionHandle/sourceRef/counts, summary adds a compact sample, and metadata adds bounded sample metadata without asset IDs. For readAssetMetadata, use basic, descriptive, technical, or allSafe metadata presets.',
assetSelectionHandleId:
  'Selection handle id returned by searchAssets.selectionHandle.id. Prefer this for asset-bearing plans instead of explicit assetIds.',
```

Add `assetSelectionHandleId` to `propertyDescriptions` if it is missing.

- [ ] **Step 7: Implement prompt and runner behavior wording**

In `server/src/services/agent-mcp-prompt.service.ts`, replace the old lines with concise handle-first text:

```ts
'Progressive: resolve names -> searchAssets returns selection handles/sourceRef/counts/samples; use selectionHandle.id or sourceRef for planning. Page or ask one narrowing question if truncated/hasMore.',
'Search handles: small results are still handles. Do not paste assetIds from search results.',
...
'Best/highlights require bounded source album/space/date/search/selection; suggested not objective quality scoring; use handle/source-backed planning until curation tools narrow selections.',
'Technical metadata: use exact non-search asset reads only for small inspected sets; do not turn search results into assetIds.',
...
`Low-level exact sets: prefer assetSelectionHandleId for search results; explicit IDs only for exact small non-search inspected sets. Example {"targetKind":"existing_space","targetId":"<target-id>","assetSelectionHandleId":"<selectionHandle.id from searchAssets>"}`,
```

Remove these selected raw-ID examples from `promptExampleSelections` in `server/src/services/agent-mcp-prompt.service.ts`:

```ts
{ toolName: AgentToolName.ReadAssetMetadata, exampleName: 'read-technical-fields-for-selected-assets' },
{ toolName: AgentToolName.ReadAssetPreviews, exampleName: 'read-selected-assets' },
```

Keep `{ toolName: AgentToolName.ReadAssetMetadata, exampleName: 'approved-retry' }` because it contains only `toolCallId`.

In `agent-runner/src/pi-runtime.mjs`, replace runner behavior prompt lines:

```js
'For metadata-only trip album requests, use mcp_gallery_searchAssets with location and taken-date metadata; searchAssets returns selection handles, counts, source refs, and bounded samples for planning.',
...
'After metadata-only narrowing, propose writes with selection handles or source-backed workflow tools; do not paste assetIds from search results.',
...
'Preview-assisted highlight requests must start from a bounded source. Do not copy search result asset IDs; use handle/source flows until a later curation/read tool provides an exact set.',
...
'Cover suggestions use album.setCover with exactly one exact asset only after Gallery has provided a bounded exact selection; otherwise ask a concise follow-up or propose a source-backed plan when supported.',
```

- [ ] **Step 8: Implement generated docs static workflow wording**

In `server/src/services/agent-mcp-docs.service.ts`, replace the progressive workflow block:

```ts
'Use the smallest useful payload first. Resolve names before search. Search returns selection handles, source refs, counts, paging, and bounded samples. Propose a plan from handles or source-backed workflow tools after the selected asset set is clear.',
'',
'- Broad search: use `searchAssets` with a bounded `limit` such as 25 or 50. If `hasMore` or `resultSize.truncated` is true, page with `nextPage` or ask a narrowing question; when hasMore is true, keep the same mode, query, filters, order, and limit.',
'- Visual curation: start with a bounded search handle and disclose metadata-only criteria until a later curation/read tool narrows the selection.',
'- Technical metadata: do not convert search results into asset ID arrays. Use exact non-search asset reads only for small inspected sets, and prefer handle/source-backed planning for search-derived sets.',
'- Large album: use `selectionHandle.id`, `selectionHandle.sourceRef`, or high-level from-search workflow tools. Do not paste result asset IDs.',
'- All photos: avoid loading the whole library. Ask for a narrower date, album, tag, person, space, rating, or media-type filter when the task does not require every asset.',
```

Replace the large selection block:

```ts
'- Search always returns `selectionHandle.id` and `selectionHandle.sourceRef` for the current bounded page.',
'- Use `selectionHandle.id` as `assetSelectionHandleId` in the plan instead of pasting `assetIds`.',
```

Update source-backed defaults so explicit IDs are not described as coming from search:

```ts
'Use high-level workflow tools first for album, space, and asset batch requests. Prefer `assetSource.search` when the user already gave the filter intent. Prefer `previousSearch.sourceRef` after an inspection search. Use explicit IDs only for exact small non-search inspected sets.';
```

- [ ] **Step 9: Implement recovery wording**

In `server/src/services/agent-operation-plan.service.ts`, replace guidance strings:

```ts
'Rerun searchAssets and use the returned selectionHandle.sourceRef.';
'Use a same-session selection handle returned by searchAssets, or use assetSource.search once available.';
'The attempted selection handle is expired. Rerun searchAssets and retry proposeAlbumOperations with the returned selectionHandle.id.';
'Rerun searchAssets and retry proposeAlbumOperations with the returned selectionHandle.id.';
```

Do not change validation behavior in this slice.

- [ ] **Step 10: Run focused server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 11: Commit contract/prompt/docs/recovery source updates**

Run:

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-prompt-placeholders.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/services/agent-mcp.service.spec.ts agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs
git commit -m "docs: advertise handle-first search flows"
```

If Task 1 already committed `agent-runner/src/pi-runtime.mjs` and `agent-runner/src/pi-runtime.test.mjs`, this commit should only stage their prompt-string changes, if any.

---

## Task 4: Regenerate Prompt And MCP Docs Artifacts

**Files:**

- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Build server bins**

Run:

```bash
pnpm --dir server run build
```

Expected: PASS and `server/dist/bin/sync-agent-mcp-docs.js` plus `server/dist/bin/sync-agent-mcp-prompt.js` exist.

- [ ] **Step 2: Regenerate artifacts**

Run:

```bash
pnpm --dir server run sync:agent-mcp-prompt
pnpm --dir server run sync:agent-mcp-docs
```

Expected output includes:

```text
Wrote agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
Wrote docs/superpowers/generated/pi-agent-mcp-tools.md
```

- [ ] **Step 3: Check generated artifacts for old search-ID guidance**

Run:

```bash
rg -n 'detail: "ids"|\"detail\": \"ids\"|search detail ids|Search compact IDs first|Search compact asset ids|createSelectionHandle|selected assetIds only|write selected assetIds' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
rg -n '<asset-id-from-searchAssets>' agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
```

Expected: no matches.

- [ ] **Step 4: Run generated sync tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: PASS and committed generated prompt/docs match renderer output.

- [ ] **Step 5: Commit generated artifacts**

Run:

```bash
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "chore: regenerate handle-first MCP guidance"
```

Skip this commit only if `git status --short` shows no generated changes after regeneration.

---

## Task 5: Slice 2 Verification

**Files:**

- All files changed in Tasks 1-4.

- [ ] **Step 1: Run runner test suite**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 2: Run server focused slice tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-runner-flow.integration.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck and diff hygiene**

Run:

```bash
pnpm --dir server run check
git diff --check
git status --short --branch
```

Expected: `pnpm check` exits 0, `git diff --check` exits 0, and the branch is ahead of origin with no unstaged changes except intentional committed changes.

- [ ] **Step 4: Run provider-facing guidance scan**

Run:

```bash
rg -n 'search detail ids|Search compact IDs first|Search compact asset ids|Default to compact asset ids|createSelectionHandle|selected assetIds only|write selected assetIds|Technical metadata: search ids first|\"detail\":\"ids\"|\"detail\": \"ids\"|<asset-id-from-searchAssets>' agent-runner/src/pi-runtime.mjs agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-docs.service.ts docs/superpowers/generated/pi-agent-mcp-tools.md server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-prompt-placeholders.ts
```

Expected: no matches. If this command reports a match, update the provider-facing source or generated artifact before finishing the slice.

---

## Review Checklist

- [ ] TDD red steps exist before implementation for runner compaction, DTO defaults, prompt/docs/contracts, registry descriptions, and recovery wording.
- [ ] `detail: "ids"` remains accepted as request compatibility but is no longer the default or advertised in provider-facing search docs/prompts/examples.
- [ ] Runner compaction redacts legacy search `assetIds`, nested `assets.items[].id`, and `assetIdsSample`.
- [ ] Prompt and generated prompt module do not contain `<asset-id-from-searchAssets>`, `selected assetIds only`, `search ids first`, or `createSelectionHandle`.
- [ ] Generated docs do not tell Pi to use `detail: "ids"` for `searchAssets` or `createSelectionHandle: true`.
- [ ] Recovery guidance says rerun `searchAssets` and use the returned handle/source ref, without `createSelectionHandle true`.
- [ ] No Slice 3-6 work is implemented.
- [ ] Final validation commands are recorded in the worker report and all pass before pushing Slice 2.
