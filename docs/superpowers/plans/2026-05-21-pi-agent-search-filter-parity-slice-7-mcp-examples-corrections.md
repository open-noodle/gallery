# Pi Agent Search Filter Parity Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach smaller Pi models the correct MCP search workflow with parseable examples, scenario prompts, and targeted correction hints for common search mistakes.

**Architecture:** Keep MCP behavior contract-owned in `AgentMcpToolContractService`, then regenerate the docs and runner prompt from that contract. Add scenario examples directly to the `searchAssets` contract, expand the Slice 7 runtime failure matrix to cover every common search mistake named in the spec, and add one compact prompt line that maps natural-language patterns to valid search arguments.

**Tech Stack:** NestJS services, Zod DTO schemas, Vitest contract/docs/prompt tests, generated MCP docs, generated runner prompt.

---

## Scope

Implement only Slice 7 from `docs/superpowers/specs/2026-05-20-pi-agent-search-filter-parity-design.md`.

Included:

- Add parseable `searchAssets` examples for:
  - “Find unalbumed Berlin photos from May.”
  - “Find 5-star videos.”
  - “Find OCR invoice screenshots.”
- Add a parseable resolver-first example for “Find photos of Alex in Family space.”
- Add runtime failure matrix cases for every Slice 7 common search mistake:
  - filters placed at root instead of under `filters`
  - name strings passed where IDs are required
  - text query supplied in metadata mode
  - `spacePersonIds` used without `spaceId`
  - search fields combined with approved retry `toolCallId`
- Add compact runner prompt guidance for unalbumed, rating/video, OCR invoice, and resolver-first people/space flows.
- Regenerate:
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

Excluded:

- Do not add new search filters that are not in the live DTO schema.
- Do not add an `isScreenshot` filter in this slice; the screenshot prompt should be represented as OCR over image assets and can be narrowed further after metadata/previews.
- Do not change tool execution behavior.
- Do not add direct write or apply tools.
- Do not change Slice 8 assistant-flow acceptance tests.

## File Structure

- Modify `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add three scenario examples to `searchAssetsContract.examples`.
  - Add a `resolveAssetSearchFilters` example that resolves `Alex` within `Family`.
  - Add Slice 7 runtime failure matrix cases for the missing common mistakes.
- Modify `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Test that scenario examples exist, parse against `AgentReadToolRequestSchemas[SearchAssets]`, and encode the intended filters/modes.
  - Test that the Alex/Family resolver-first example exists and parses against `AgentReadToolRequestSchemas[ResolveAssetSearchFilters]`.
  - Test that every Slice 7 common mistake has a targeted correction and parseable correction example.
  - Test that the runtime failure matrix contains the new case IDs and links tool-validation cases to executable examples.
- Modify `server/src/services/agent-mcp-docs.service.spec.ts`
  - Test generated docs include the new scenario examples and still parse every documented example.
- Modify `server/src/services/agent-mcp-prompt.service.ts`
  - Add one compact scenario guidance line to the runner cheat sheet.
- Modify `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Test the prompt includes the compact scenario guidance while staying under the existing 2,850-character budget.
- Modify generated artifacts:
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

## Task 1: Scenario Search Examples

**Files:**

- Modify `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Write failing contract tests for scenario examples**

Add this test near `defines the required search examples from the spec` in `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

```ts
it('defines Slice 7 natural-language search examples that parse and map to supported filters', () => {
  const search = sut.getReadToolContract(AgentToolName.SearchAssets);
  const examplesByName = new Map(search?.examples.map((example) => [example.name, example]));

  const unalbumedBerlinMay = examplesByName.get('unalbumed-berlin-may-search');
  const fiveStarVideos = examplesByName.get('five-star-video-search');
  const ocrInvoiceScreenshots = examplesByName.get('ocr-invoice-screenshot-search');
  const resolver = sut.getReadToolContract(AgentToolName.ResolveAssetSearchFilters);
  const resolverExamplesByName = new Map(resolver?.examples.map((example) => [example.name, example]));
  const alexFamilySpace = resolverExamplesByName.get('resolve-alex-family-space-filters');

  expect(unalbumedBerlinMay?.arguments).toEqual({
    mode: 'metadata',
    filters: {
      takenAfter: '2026-05-01T00:00:00.000Z',
      takenBefore: '2026-05-31T23:59:59.999Z',
      city: 'Berlin',
      country: 'Germany',
      isNotInAlbum: true,
    },
    limit: 50,
    page: 1,
    order: 'desc',
  });
  expect(fiveStarVideos?.arguments).toEqual({
    filters: {
      rating: 5,
      type: 'VIDEO',
    },
    limit: 50,
  });
  expect(ocrInvoiceScreenshots?.arguments).toEqual({
    mode: 'ocr',
    query: 'invoice',
    filters: {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
      type: 'IMAGE',
    },
    limit: 50,
  });

  for (const example of [unalbumedBerlinMay, fiveStarVideos, ocrInvoiceScreenshots]) {
    expect(example, 'scenario example should exist').toBeDefined();
    expect(AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(example?.arguments).success).toBe(true);
  }

  expect(alexFamilySpace?.arguments).toEqual({
    people: ['Alex'],
    spaces: ['Family'],
  });
  expect(
    AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse(alexFamilySpace?.arguments).success,
  ).toBe(true);
});
```

Extend the existing `defines the required search examples from the spec` expected names:

```ts
expect(search?.examples.map((example) => example.name)).toEqual(
  expect.arrayContaining([
    'empty-search',
    'bounded-date-location-search',
    'favorite-rating-search',
    'space-filter-search',
    'resolved-id-filter-search',
    'unalbumed-berlin-may-search',
    'five-star-video-search',
    'ocr-invoice-screenshot-search',
    'approved-retry',
  ]),
);

const resolver = sut.getReadToolContract(AgentToolName.ResolveAssetSearchFilters);
expect(resolver?.examples.map((example) => example.name)).toEqual(
  expect.arrayContaining([
    'resolve-named-filters',
    'resolve-alex-family-space-filters',
    'resolve-space-person-filters',
  ]),
);
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts -- --runInBand
```

Expected:

- The new scenario-example test fails because the three search scenario examples and the Alex/Family resolver example are missing.

- [ ] **Step 3: Add scenario examples**

In `server/src/services/agent-mcp-tool-contract.service.ts`, add these examples to `searchAssetsContract.examples` after `metadata-next-page-search`:

```ts
{
  name: 'unalbumed-berlin-may-search',
  description: 'Find unalbumed Berlin photos from May.',
  arguments: {
    mode: 'metadata',
    filters: {
      takenAfter: '2026-05-01T00:00:00.000Z',
      takenBefore: '2026-05-31T23:59:59.999Z',
      city: 'Berlin',
      country: 'Germany',
      isNotInAlbum: true,
    },
    limit: 50,
    page: 1,
    order: 'desc',
  },
},
{
  name: 'five-star-video-search',
  description: 'Find five-star videos.',
  arguments: {
    filters: {
      rating: 5,
      type: 'VIDEO',
    },
    limit: 50,
  },
},
{
  name: 'ocr-invoice-screenshot-search',
  description: 'Find image assets with OCR text mentioning invoices from 2024.',
  arguments: {
    mode: 'ocr',
    query: 'invoice',
    filters: {
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
      type: 'IMAGE',
    },
    limit: 50,
  },
},
```

Also add this example to `resolveAssetSearchFiltersContract.examples` before `resolve-space-person-filters`:

```ts
{
  name: 'resolve-alex-family-space-filters',
  description: 'Resolve a user-facing person name inside a shared space before searching.',
  arguments: {
    people: ['Alex'],
    spaces: ['Family'],
  },
},
```

- [ ] **Step 4: Verify Task 1**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "docs: add pi search scenario examples"
```

## Task 2: Correction Hint And Runtime Matrix Coverage

**Files:**

- Modify `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Write failing tests for Slice 7 common mistakes**

Add this test inside `describe('validation correction lookup', ...)` in `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

```ts
it('returns targeted corrections for every Slice 7 search mistake', () => {
  const cases = [
    {
      label: 'root filters',
      issues: [{ path: '', message: 'Unrecognized keys: "isFavorite", "rating", "type"' }],
      mistakeId: 'search-filters-outside-filters',
      hint: 'inside the filters object',
    },
    {
      label: 'tag name in id field',
      issues: [{ path: 'filters.tagIds.0', message: 'Invalid UUID' }],
      mistakeId: 'search-filter-name-in-tag-ids',
      hint: 'Use resolveAssetSearchFilters',
    },
    {
      label: 'album name in id field',
      issues: [{ path: 'filters.albumIds.0', message: 'Invalid UUID' }],
      mistakeId: 'search-filter-name-in-album-ids',
      hint: 'Use resolveAssetSearchFilters',
    },
    {
      label: 'person name in id field',
      issues: [{ path: 'filters.personIds.0', message: 'Invalid UUID' }],
      mistakeId: 'search-filter-name-in-person-ids',
      hint: 'Use resolveAssetSearchFilters',
    },
    {
      label: 'space name in id field',
      issues: [{ path: 'filters.spaceId', message: 'Invalid UUID' }],
      mistakeId: 'search-filter-name-in-space-id',
      hint: 'Use resolveAssetSearchFilters',
    },
    {
      label: 'metadata query',
      issues: [
        { path: 'query', message: 'query is only supported for smart, description, ocr, and filename search modes' },
      ],
      mistakeId: 'search-query-with-metadata-mode',
      hint: 'Use mode smart, description, ocr, or filename with query',
    },
    {
      label: 'space person without space',
      issues: [{ path: 'filters.spacePersonIds', message: 'spacePersonIds requires spaceId' }],
      mistakeId: 'search-space-person-without-space',
      hint: 'spacePersonIds requires filters.spaceId',
    },
    {
      label: 'toolCallId with new search fields',
      issues: [{ path: '', message: 'Provide either search fields or toolCallId, not both' }],
      mistakeId: 'search-combined-filters-and-tool-call-id',
      hint: 'only toolCallId for an approved retry',
    },
  ] as const;

  for (const { label, issues, mistakeId, hint } of cases) {
    const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
      requestShape: 'tool-arguments',
      issues,
    });

    expect(correction?.mistakeId, label).toBe(mistakeId);
    expect(correction?.hint, label).toContain(hint);
    expect(
      AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(correction?.exampleArguments).success,
    ).toBe(true);
  }
});
```

Extend `expectedSlice7FailureCaseIds` with:

```ts
'search-tag-name-in-id-filter',
'search-album-name-in-id-filter',
'search-person-name-in-id-filter',
'search-space-name-in-id-filter',
'search-query-with-metadata-mode',
'search-space-person-without-space',
'search-fields-with-tool-call-id',
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts -- --runInBand
```

Expected:

- Correction tests should mostly pass with existing hints.
- Runtime matrix ID assertion fails until the new matrix cases are added.

- [ ] **Step 3: Add runtime failure matrix cases**

In `server/src/services/agent-mcp-tool-contract.service.ts`, append these objects to `slice7RuntimeFailureMatrixCases` after `search-root-favorite-rating-filters`:

```ts
{
  id: 'search-tag-name-in-id-filter',
  category: 'search',
  description: 'Model passes a user-facing tag name where searchAssets requires tagIds.',
  toolName: AgentToolName.SearchAssets,
  request: toolCallRequest('search-tag-name-in-id-filter', AgentToolName.SearchAssets, {
    filters: { tagIds: ['Travel'] },
    limit: 25,
  }),
  expectedResult: { kind: 'tool-validation', expectedIssuePath: 'filters.tagIds.0' },
  expectedContractMistakeId: 'search-filter-name-in-tag-ids',
},
{
  id: 'search-album-name-in-id-filter',
  category: 'search',
  description: 'Model passes a user-facing album name where searchAssets requires albumIds.',
  toolName: AgentToolName.SearchAssets,
  request: toolCallRequest('search-album-name-in-id-filter', AgentToolName.SearchAssets, {
    filters: { albumIds: ['Family'] },
    limit: 25,
  }),
  expectedResult: { kind: 'tool-validation', expectedIssuePath: 'filters.albumIds.0' },
  expectedContractMistakeId: 'search-filter-name-in-album-ids',
},
{
  id: 'search-person-name-in-id-filter',
  category: 'search',
  description: 'Model passes a user-facing person name where searchAssets requires personIds.',
  toolName: AgentToolName.SearchAssets,
  request: toolCallRequest('search-person-name-in-id-filter', AgentToolName.SearchAssets, {
    filters: { personIds: ['Alex'] },
    limit: 25,
  }),
  expectedResult: { kind: 'tool-validation', expectedIssuePath: 'filters.personIds.0' },
  expectedContractMistakeId: 'search-filter-name-in-person-ids',
},
{
  id: 'search-space-name-in-id-filter',
  category: 'search',
  description: 'Model passes a user-facing space name where searchAssets requires spaceId.',
  toolName: AgentToolName.SearchAssets,
  request: toolCallRequest('search-space-name-in-id-filter', AgentToolName.SearchAssets, {
    filters: { spaceId: 'Family' },
    limit: 25,
  }),
  expectedResult: { kind: 'tool-validation', expectedIssuePath: 'filters.spaceId' },
  expectedContractMistakeId: 'search-filter-name-in-space-id',
},
{
  id: 'search-query-with-metadata-mode',
  category: 'search',
  description: 'Model sends a text query while leaving searchAssets in metadata mode.',
  toolName: AgentToolName.SearchAssets,
  request: toolCallRequest('search-query-with-metadata-mode', AgentToolName.SearchAssets, {
    mode: 'metadata',
    query: 'invoice',
    filters: {},
    limit: 25,
  }),
  expectedResult: { kind: 'tool-validation', expectedIssuePath: 'query' },
  expectedContractMistakeId: 'search-query-with-metadata-mode',
},
{
  id: 'search-space-person-without-space',
  category: 'search',
  description: 'Model uses shared-space person ids without choosing the shared space.',
  toolName: AgentToolName.SearchAssets,
  request: toolCallRequest('search-space-person-without-space', AgentToolName.SearchAssets, {
    filters: { spacePersonIds: [exampleSpacePersonId] },
    limit: 25,
  }),
  expectedResult: { kind: 'tool-validation', expectedIssuePath: 'filters.spacePersonIds' },
  expectedContractMistakeId: 'search-space-person-without-space',
},
{
  id: 'search-fields-with-tool-call-id',
  category: 'read-retry',
  description: 'Model retries an approved search while also sending fresh search fields.',
  toolName: AgentToolName.SearchAssets,
  request: toolCallRequest('search-fields-with-tool-call-id', AgentToolName.SearchAssets, {
    toolCallId: exampleToolCallId,
    filters: { isFavorite: true },
    limit: 25,
  }),
  expectedResult: { kind: 'tool-validation', expectedIssuePath: '' },
  expectedContractMistakeId: 'search-combined-filters-and-tool-call-id',
},
```

- [ ] **Step 4: Verify Task 2**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "test: cover pi search mcp corrections"
```

## Task 3: Runner Prompt Scenario Guidance

**Files:**

- Modify `server/src/services/agent-mcp-prompt.service.ts`
- Modify `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify generated artifact:
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

- [ ] **Step 1: Write failing prompt tests**

Add this test near the existing search prompt tests in `server/src/services/agent-mcp-prompt.service.spec.ts`:

```ts
it('teaches compact natural-language search patterns for Slice 7 prompts', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('unalbumed');
  expect(prompt).toContain('isNotInAlbum');
  expect(prompt).toContain('rating 5');
  expect(prompt).toContain('type VIDEO');
  expect(prompt).toContain('OCR invoice');
  expect(prompt).toContain('mode ocr');
  expect(prompt).toContain('resolve names');
  expect(prompt.length).toBeLessThanOrEqual(2850);
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts -- --runInBand
```

Expected:

- The new test fails because the compact scenario line is missing.

- [ ] **Step 3: Add compact prompt line**

In `server/src/services/agent-mcp-prompt.service.ts`, add this line immediately after the `R:` search guidance line:

```ts
'Patterns: unalbumed=isNotInAlbum; 5-star videos=rating 5+type VIDEO; OCR invoice=mode ocr+query invoice; names=resolve names first.',
```

Check prompt size locally if needed:

```bash
node -e "import('./agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs').then(m=>console.log(m.galleryMcpPromptCheatSheet.length))"
```

- [ ] **Step 4: Regenerate prompt and verify**

Run:

```bash
pnpm --dir server build
pnpm --dir server sync:agent-mcp-prompt
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts -- --runInBand
```

Expected: PASS, prompt length <= 2850.

- [ ] **Step 5: Commit Task 3**

```bash
git add server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
git commit -m "docs: teach pi compact search patterns"
```

## Task 4: Generated MCP Documentation

**Files:**

- Modify `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify generated artifact:
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Write failing docs tests**

Add this test near `documents current search execution bounds for expanded contract fields` in `server/src/services/agent-mcp-docs.service.spec.ts`:

```ts
it('documents Slice 7 search scenario examples and correction hints', () => {
  const markdown = sut.generateMarkdown();
  const generatedPath = resolve(process.cwd(), '..', AGENT_MCP_GENERATED_DOC_RELATIVE_PATH);
  const committed = readFileSync(generatedPath, 'utf8');

  for (const exampleName of [
    'unalbumed-berlin-may-search',
    'five-star-video-search',
    'ocr-invoice-screenshot-search',
    'resolve-alex-family-space-filters',
    'resolve-space-person-filters',
    'create-album-and-add-assets',
  ]) {
    expect(markdown).toContain(exampleName);
    expect(committed).toContain(exampleName);
  }

  for (const mistakeId of [
    'search-filters-outside-filters',
    'search-filter-name-in-tag-ids',
    'search-filter-name-in-person-ids',
    'search-query-with-metadata-mode',
    'search-space-person-without-space',
    'search-combined-filters-and-tool-call-id',
  ]) {
    expect(markdown).toContain(mistakeId);
    expect(committed).toContain(mistakeId);
  }
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-docs.service.spec.ts -- --runInBand
```

Expected:

- The new docs test fails against the committed generated guide until `sync:agent-mcp-docs` writes the new examples.

- [ ] **Step 3: Regenerate MCP docs**

Run:

```bash
pnpm --dir server build
pnpm --dir server sync:agent-mcp-docs
```

- [ ] **Step 4: Verify Task 4**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts -- --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add server/src/services/agent-mcp-docs.service.spec.ts docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "docs: sync pi search mcp examples"
```

## Task 5: Slice Verification

**Files:**

- No production files beyond Tasks 1-4.

- [ ] **Step 1: Run focused MCP tests**

```bash
pnpm --dir server test \
  src/services/agent-mcp-tool-contract.service.spec.ts \
  src/services/agent-mcp-docs.service.spec.ts \
  src/services/agent-mcp-prompt.service.spec.ts \
  src/services/agent-mcp-tool-registry.service.spec.ts \
  -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run generated sync checks**

```bash
pnpm --dir server build
pnpm --dir server sync:agent-mcp-docs
pnpm --dir server sync:agent-mcp-prompt
git diff --exit-code docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Expected: commands pass and generated artifacts are already in sync.

- [ ] **Step 3: Run quality gates**

```bash
pnpm --dir server check
pnpm --dir server lint
pnpm --dir server format
pnpm --dir docs format
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Commit formatting changes if needed**

If formatting commands changed files:

```bash
git add .
git commit -m "style: format pi mcp examples slice"
```

- [ ] **Step 5: Push the completed slice**

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` is updated on `origin`.

## Self-Review Checklist

- TDD order is explicit for examples, corrections, prompt guidance, docs sync, and verification.
- Every documented example parses against the live schema through existing docs/contract tests.
- Each Slice 7 common mistake has a targeted correction and parseable example arguments.
- Resolver-first flows are covered by `resolve-named-filters`, `resolve-alex-family-space-filters`, and `resolve-space-person-filters`.
- Text-search modes are covered by `smart-text-search`, `ocr-text-search`, `description-text-search`, `filename-text-search`, and `ocr-invoice-screenshot-search`.
- Prompt stays compact and under the existing 2,850-character budget.
- No direct mutation or apply tools are introduced.
