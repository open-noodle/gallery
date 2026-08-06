# Pi Agent MCP Minimal Context Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Pi and smaller models to use the minimal-context MCP contract through generated prompt guidance, generated docs, examples, and correction hints.

**Architecture:** Keep the source of truth in `AgentMcpToolContractService`, then render the runner cheat sheet and generated MCP guide from that contract. Tests lock progressive-detail guidance, parse every JSON example through live DTO schemas, and keep generated files in sync.

**Tech Stack:** NestJS service tests with Vitest, generated Markdown docs, generated ESM runner prompt module, Pi runner prompt assertions.

---

## Scope

Slice 6 implements only:

- contract-owned progressive-detail guidance and examples;
- generated runner prompt cheat-sheet updates;
- generated MCP guide updates;
- correction hints that discourage broad full-metadata reads and `limit: 1000` style calls;
- tests proving all generated examples remain parseable and safe.

Slice 6 does not implement:

- new MCP response DTOs from earlier slices;
- runner transcript compaction from Slice 5;
- selection handles from Slice 7;
- new tools or direct write/apply behavior.

## Decisions

- The contract remains the source of truth. Generated prompt/docs files are updated only by running the sync scripts.
- Search examples should default to compact ID output (`detail: "ids"`) and bounded `limit`.
- `detail: "summary"` examples may use `fields` plus `sampleSize` for representative detail.
- `detail: "metadata"` examples are allowed only for bounded, explicit, small subsets and should not be used as the default discovery path.
- Visual curation guidance says to search compactly first, then request previews only for shortlisted `assetIds` when visual inspection is required.
- Exact technical metadata guidance says to search IDs first, then call `readAssetMetadata` with field groups such as `camera`, `dates`, or `filename` for selected IDs.
- "All photos" or very broad requests should use bounded pages and either page with `nextPage` or ask a narrowing question when the result is too broad, truncated, or not needed in full.
- The generated prompt can grow modestly but must remain compact. Increase its test budget from 2850 to 3800 characters and keep the generated guide safety checks unchanged.

## Files

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add progressive-detail wording to search and metadata contracts.
  - Add compact search, summary sample, visual curation, technical metadata, and large-album examples.
  - Add common-mistake hints discouraging `limit: 1000`, broad metadata detail, and preview reads before shortlisting.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add failing tests for progressive-detail examples, parseability, and correction hints.
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
  - Render compact progressive workflow guidance from selected examples.
  - Select prompt examples that demonstrate compact search, field-selected reads, visual curation, and broad narrowing.
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Add failing tests for runner cheat-sheet guidance and generated module sync.
- Modify: `server/src/services/agent-mcp-docs.service.ts`
  - Add a `Progressive Detail Workflow` section with concrete scenarios.
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
  - Add failing tests for docs workflow scenarios and safety.
- Modify: `agent-runner/src/pi-runtime.test.mjs`
  - Assert the runner system prompt includes the generated progressive-detail guidance.
- Regenerate: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Regenerate: `docs/superpowers/generated/pi-agent-mcp-tools.md`

## Task 1: Contract Progressive-Detail Guidance

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`

- [ ] **Step 1: Write failing contract tests**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, add tests near the existing search contract tests:

```ts
it('documents progressive detail search examples that parse through the live DTO schema', () => {
  const search = sut.getReadToolContract(AgentToolName.SearchAssets);
  const exampleByName = new Map(search?.examples.map((example) => [example.name, example]));

  for (const name of [
    'compact-date-location-search',
    'summary-sample-search',
    'visual-curation-candidate-search',
    'large-album-page-search',
  ]) {
    const example = exampleByName.get(name);
    expect(example, name).toBeDefined();
    expect(AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(example?.arguments).success).toBe(true);
  }

  expect(exampleByName.get('compact-date-location-search')?.arguments).toMatchObject({
    detail: 'ids',
    limit: 50,
  });
  expect(exampleByName.get('summary-sample-search')?.arguments).toMatchObject({
    detail: 'summary',
    fields: ['dates', 'location'],
    sampleSize: 3,
  });
  expect(JSON.stringify(exampleByName.get('large-album-page-search')?.arguments)).not.toContain('1000');
});

it('documents progressive metadata reads by exact field groups for selected ids', () => {
  const metadata = sut.getReadToolContract(AgentToolName.ReadAssetMetadata);
  const exactTechnical = metadata?.examples.find(
    (example) => example.name === 'read-technical-fields-for-selected-assets',
  );

  expect(metadata?.usage).toContain('Search compact asset ids first');
  expect(metadata?.usage).toContain('fields');
  expect(exactTechnical?.arguments).toEqual({
    assetIds: ['00000000-0000-4000-8000-000000000001'],
    fields: ['camera', 'dates', 'filename'],
  });
  expect(
    AgentReadToolRequestSchemas[AgentToolName.ReadAssetMetadata].safeParse(exactTechnical?.arguments).success,
  ).toBe(true);
});

it('discourages broad full-metadata and large-limit search calls with actionable hints', () => {
  const search = sut.getReadToolContract(AgentToolName.SearchAssets);
  const mistakeIds = search?.commonMistakes.map((mistake) => mistake.id);

  expect(search?.usage).toContain('Default to compact asset ids');
  expect(search?.usage).toContain('Do not use limit 1000');
  expect(search?.usage).toContain('ask one narrowing question');
  expect(mistakeIds).toEqual(
    expect.arrayContaining([
      'search-large-limit',
      'search-broad-full-metadata',
      'search-preview-before-shortlist',
      'search-truncated-needs-more-detail',
    ]),
  );
  expect(search?.commonMistakes.find((mistake) => mistake.id === 'search-large-limit')?.hint).toContain(
    'Use a bounded limit such as 25 or 50',
  );
  expect(search?.commonMistakes.find((mistake) => mistake.id === 'search-broad-full-metadata')?.hint).toContain(
    'Search compact ids first',
  );
});
```

- [ ] **Step 2: Run contract tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: fails because the new examples and mistake IDs do not exist.

- [ ] **Step 3: Update search and metadata contracts**

In `server/src/services/agent-mcp-tool-contract.service.ts`:

1. Update `readAssetMetadataContract.usage` to include:

```ts
'Search compact asset ids first, then call this tool for selected ids with the smallest useful detail preset or fields.';
```

2. Add metadata example:

```ts
const readTechnicalFieldsForSelectedAssetsExample: AgentMcpToolExample = {
  name: 'read-technical-fields-for-selected-assets',
  description: 'Read exact camera, date, and filename fields for selected assets.',
  arguments: { assetIds: [exampleAssetId], fields: ['camera', 'dates', 'filename'] },
};
```

Add it to `readAssetMetadataContract.examples` before `approvedRetryExample`.

3. Update `searchAssetsContract.usage` so it includes:

```ts
'Default to compact asset ids with detail ids. Use detail summary with fields and sampleSize for a small representative sample. Use detail metadata only after a bounded compact search proves the subset is small. Do not use limit 1000 or request all metadata for broad searches; page with nextPage or ask one narrowing question when hasMore or resultSize.truncated is true.';
```

4. Add search examples:

```ts
{
  name: 'compact-date-location-search',
  description: 'Search compact asset ids for a known date and place.',
  arguments: {
    detail: 'ids',
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
  name: 'summary-sample-search',
  description: 'Request a small representative sample with only needed fields.',
  arguments: {
    detail: 'summary',
    fields: ['dates', 'location'],
    sampleSize: 3,
    filters: { city: 'Berlin', country: 'Germany' },
    limit: 50,
  },
},
{
  name: 'visual-curation-candidate-search',
  description: 'Find visual curation candidates by compact ids before reading previews.',
  arguments: {
    mode: 'smart',
    query: 'best beach sunset photos',
    detail: 'ids',
    limit: 25,
  },
},
{
  name: 'large-album-page-search',
  description: 'Page a broad album-building search without requesting full metadata.',
  arguments: {
    detail: 'ids',
    filters: { isNotInAlbum: true },
    limit: 50,
    page: 1,
    order: 'desc',
  },
},
```

5. Add common mistakes:

```ts
{
  id: 'search-large-limit',
  match: { issuePath: 'limit', messageIncludes: 'limit 1000 ' },
  hint: 'Use a bounded limit such as 25 or 50. Do not use limit 1000; page with nextPage or ask a narrowing question for broad requests.',
  exampleName: 'large-album-page-search',
},
{
  id: 'search-broad-full-metadata',
  match: { messageIncludes: 'metadata detail is too broad' },
  hint: 'Search compact ids first, then call readAssetMetadata with fields for selected assetIds. Do not request full metadata for broad searches.',
  exampleName: 'compact-date-location-search',
},
{
  id: 'search-preview-before-shortlist',
  match: { messageIncludes: 'preview reads require selected asset ids' },
  hint: 'For visual curation, search compact ids first, shortlist candidates, then read previews only for selected assetIds.',
  exampleName: 'visual-curation-candidate-search',
},
{
  id: 'search-truncated-needs-more-detail',
  match: { messageIncludes: 'resultSize.truncated' },
  hint: 'When resultSize.truncated is true, request fewer assets, page with nextPage, or ask one narrowing question before requesting more fields.',
  exampleName: 'summary-sample-search',
},
```

- [ ] **Step 4: Run contract tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: contract tests pass.

## Task 2: Runner Prompt Cheat Sheet

**Files:**

- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify after generation: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

- [ ] **Step 1: Write failing prompt tests**

In `server/src/services/agent-mcp-prompt.service.spec.ts`, add:

```ts
it('teaches progressive detail before broad metadata reads', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('Progressive: resolve names -> search detail ids');
  expect(prompt).toContain('readAssetMetadata fields for selected ids');
  expect(prompt).toContain('Do not use limit 1000');
  expect(prompt).toContain('if truncated/hasMore, page or ask one narrowing question');
  expect(prompt).toContain('"detail":"ids"');
  expect(prompt).toContain('"fields":["dates","location"]');
  expect(prompt.length).toBeLessThanOrEqual(3800);
});

it('includes compact visual and technical metadata guidance without direct writes', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('Visual curation: search ids first, then previews for shortlisted assetIds only');
  expect(prompt).toContain('Technical metadata: search ids first, then readAssetMetadata fields camera/dates/filename');
  expect(prompt).not.toContain('"limit":1000');
  expect(prompt).not.toContain('mcp_gallery_apply');
});
```

Update existing prompt length expectations from `2850` to `3800`.

In `agent-runner/src/pi-runtime.test.mjs`, update `constructs the Pi resource loader with concrete runtime paths`:

```js
assert.equal(calls.loaders[0].systemPrompt.includes('Progressive: resolve names -> search detail ids'), true);
assert.equal(calls.loaders[0].systemPrompt.includes('Do not use limit 1000'), true);
assert.equal(calls.loaders[0].systemPrompt.includes('Visual curation: search ids first'), true);
assert.equal(calls.loaders[0].systemPrompt.includes('Technical metadata: search ids first'), true);
```

- [ ] **Step 2: Run prompt tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: both fail because progressive lines and the synced runner prompt guidance are absent.

- [ ] **Step 3: Update prompt example selections and rendering**

In `server/src/services/agent-mcp-prompt.service.ts`:

1. Replace the selected normal search example with `compact-date-location-search`.
2. Add `summary-sample-search`, `visual-curation-candidate-search`, and `read-technical-fields-for-selected-assets` to `promptExampleSelections`.
3. In `generatePromptCheatSheet()`, fetch these examples:

```ts
const compactSearch = this.getPromptExample(examples, AgentToolName.SearchAssets, 'compact-date-location-search');
const sampleSearch = this.getPromptExample(examples, AgentToolName.SearchAssets, 'summary-sample-search');
const visualSearch = this.getPromptExample(examples, AgentToolName.SearchAssets, 'visual-curation-candidate-search');
const technicalRead = this.getPromptExample(
  examples,
  AgentToolName.ReadAssetMetadata,
  'read-technical-fields-for-selected-assets',
);
```

4. Add compact lines to the prompt array:

```ts
'Progressive: resolve names -> search detail ids -> readAssetMetadata fields for selected ids -> plan. Do not use limit 1000; if truncated/hasMore, page or ask one narrowing question.',
`Compact search: ${compactSearch.piToolName} ${this.formatJson(compactSearch.arguments)}`,
`Sample fields: ${sampleSearch.piToolName} ${this.formatJson(sampleSearch.arguments)}`,
'Visual curation: search ids first, then previews for shortlisted assetIds only.',
`Visual search: ${visualSearch.piToolName} ${this.formatJson(visualSearch.arguments)}`,
'Technical metadata: search ids first, then readAssetMetadata fields camera/dates/filename.',
`Technical read: ${technicalRead.piToolName} ${this.formatJson(technicalRead.arguments)}`,
```

Keep older space and planning guidance intact.

- [ ] **Step 4: Regenerate the runner prompt module**

Run:

```bash
pnpm --dir server exec tsx src/bin/sync-agent-mcp-prompt.ts
```

Expected: writes `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`.

- [ ] **Step 5: Run prompt tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
```

Expected: prompt tests pass, including generated module sync.

## Task 3: Generated MCP Docs Workflow

**Files:**

- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`
- Modify after generation: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Write failing docs tests**

In `server/src/services/agent-mcp-docs.service.spec.ts`, add:

```ts
it('documents the progressive detail workflow and broad-search edge cases', () => {
  const markdown = sut.generateMarkdown();

  expect(markdown).toContain('## Progressive Detail Workflow');
  expect(markdown).toContain('Resolve names before search');
  expect(markdown).toContain('Search compact IDs first');
  expect(markdown).toContain('Request fields only for selected IDs');
  expect(markdown).toContain('Visual curation');
  expect(markdown).toContain('Technical metadata');
  expect(markdown).toContain('Large album');
  expect(markdown).toContain('All photos');
  expect(markdown).toContain('ask a narrowing question');
  expect(markdown).toContain('resultSize.truncated');
  expect(markdown).not.toContain('"limit": 1000');
});

it('documents progressive examples from the contract and keeps them parseable', () => {
  const markdown = sut.generateMarkdown();
  const documentedNames = sut.listDocumentedToolArgumentExamples().map((example) => example.exampleName);

  for (const name of [
    'compact-date-location-search',
    'summary-sample-search',
    'visual-curation-candidate-search',
    'large-album-page-search',
    'read-technical-fields-for-selected-assets',
  ]) {
    expect(markdown).toContain(name);
    expect(documentedNames).toContain(name);
  }
});
```

- [ ] **Step 2: Run docs tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts
```

Expected: fails because the progressive workflow section and new examples are absent.

- [ ] **Step 3: Add the docs workflow section**

In `server/src/services/agent-mcp-docs.service.ts`, add this section in `generateMarkdown()` between `Approval Flow` and `Tools`:

```ts
'## Progressive Detail Workflow',
'',
'Use the smallest useful payload first. Resolve names before search, search compact IDs first, request fields only for selected IDs, and propose a plan only after the selected asset set is clear.',
'',
'- Broad search: use `searchAssets` with `detail: "ids"` and a bounded `limit` such as 25 or 50. If `hasMore` or `resultSize.truncated` is true, page with `nextPage` or ask a narrowing question.',
'- Visual curation: search compact IDs first, then call preview reads only for shortlisted `assetIds` when visual inspection is needed.',
'- Technical metadata: search IDs first, then call `readAssetMetadata` with exact `fields` such as `camera`, `dates`, and `filename` for selected IDs.',
'- Large album: page compact search results and propose operations from returned asset IDs. Do not request full metadata for every candidate.',
'- All photos: avoid loading the whole library. Ask for a narrower date, album, tag, person, space, rating, or media-type filter when the task does not require every asset.',
'',
```

- [ ] **Step 4: Regenerate the MCP docs**

Run:

```bash
pnpm --dir server exec tsx src/bin/sync-agent-mcp-docs.ts
```

Expected: writes `docs/superpowers/generated/pi-agent-mcp-tools.md`.

- [ ] **Step 5: Run docs tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts
```

Expected: docs tests pass, including generated guide sync and safety checks.

## Task 4: Runner System Prompt Assertions

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Run runner prompt test after generation**

After Task 2 generation, run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: passes.

## Task 5: Final Verification And Commit

**Files:**

- Verify all touched files.

- [ ] **Step 1: Run focused Slice 6 tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 2: Run package checks**

Run:

```bash
pnpm --dir server run check
pnpm --dir agent-runner test
git diff --check
```

Expected: all commands pass with no whitespace errors.

- [ ] **Step 3: Review edge-case coverage**

Confirm the tests cover every Slice 6 edge case:

- Name resolution before search: prompt/docs and resolver examples assert resolve-before-search guidance.
- Broad search with many results: contract/docs tests assert bounded `detail: "ids"`, `hasMore`, `nextPage`, `resultSize.truncated`, and narrowing guidance.
- Visual curation: contract/prompt/docs tests assert search IDs first and previews only for shortlisted asset IDs.
- Exact technical metadata: contract/prompt/docs tests assert field-selected `readAssetMetadata` for `camera`, `dates`, and `filename`.
- Create a large album: docs and contract assert `large-album-page-search`, bounded pages, and no broad metadata load.
- "All photos" without a narrowing criterion: docs tests assert asking a narrowing question.
- The first-party internal endpoint and bearer-token placeholder remain documented for provisioning, but no real bearer token, host-private URL, storage path, raw result handle, or direct write/apply tool is emitted.

- [ ] **Step 4: Commit Slice 6**

Run:

```bash
git status --short
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts agent-runner/src/pi-runtime.test.mjs agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md docs/superpowers/plans/2026-05-21-pi-agent-mcp-minimal-context-slice-6.md
git commit -m "docs: teach Pi progressive MCP detail"
git push
```

Expected: commit and push succeed on `explore/pi-agent-brainstorm`.
