# Pi Agent Declarative Planning Sources Slice 11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generated MCP guide and runner prompt teach Pi to use source-backed workflow tools by default, with declarative source examples and recoverable clarification/error guidance.

**Architecture:** Keep the source of truth in `AgentMcpToolContractService`, render durable Markdown guidance through `AgentMcpDocsService`, and render the compact runner cheat sheet through `AgentMcpPromptService`. Regenerate the committed MCP guide and runner prompt module from those renderers after tests are green.

**Tech Stack:** NestJS services, Vitest, generated Markdown docs, generated ESM runner prompt module, Prettier.

---

## Scope

This is Slice 11 from `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`.

Implement only:

- generated MCP docs that make source-backed workflow tools the default for album, space, and batch tasks;
- runner prompt guidance that prefers high-level workflow tools, `assetSource.search`, and `previousSearch.sourceRef`;
- examples and tests that include the South Africa/Pierre/Aurelia regression prompt as a declarative source-backed album workflow;
- guidance that treats `wrong_id_domain` and `needs_clarification` as recoverable;
- generated `docs/superpowers/generated/pi-agent-mcp-tools.md`;
- generated `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`.

Do not implement:

- activity timeline wording or observability polish. That is Slice 12.
- new workflow tools or source resolution behavior. Slices 7-10 already added those contracts.
- UI rendering changes. Slice 10 already added clarification UI.
- direct apply or auto-apply behavior.
- CI babysitting after push; the user explicitly asked to skip babysitting for now.

## Files

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add any missing contract wording/examples needed by docs and prompt.
  - Keep existing low-level `proposeAlbumOperations` examples and correction hints.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add contract tests for declarative source workflow examples and old low-level mistake coverage.
- Modify: `server/src/services/agent-mcp-docs.service.ts`
  - Add a rendered `Source-Backed Planning Defaults` section and selected end-to-end examples.
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
  - Add docs tests for default workflow guidance, album/space/batch examples, raw UUID avoidance, and recoverable guidance.
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
  - Select high-level source-backed examples for the prompt.
  - Render compact declarative-source and previous-search guidance.
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Add prompt tests for high-level defaults, South Africa regression, sourceRef use after inspection, explicit-ID limits, and recoverable guidance.
- Modify generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Modify generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

## Design Decisions

- The generated guide can be verbose. It should include clear, inspectable JSON examples for album, space, batch, and previous-search workflows.
- The runner prompt must remain compact. It should keep the existing length guard close to the current budget and use one-line examples where possible.
- The South Africa/Pierre/Aurelia regression should appear in the source-backed album workflow, not only in the older resolver-to-search ID example.
- Existing resolver-to-search guidance stays for inspection and low-level search flows, but the write path must point Pi to source-aware workflow tools first.
- Raw fixture UUIDs may remain in structured contract examples before rendering so DTO validation keeps working. Rendered docs and prompt must use semantic placeholders.

## TDD Requirements

Use TDD for every implementation step:

1. Write or update the failing test first.
2. Run the exact focused command and verify the failure is for missing Slice 11 behavior.
3. Implement the smallest code change that makes that test pass.
4. Re-run the focused test and verify green.
5. Continue to the next behavior only after green.

## Edge Cases Required By This Slice

Every edge case below must be covered by automated tests in this slice:

- Generated docs include end-to-end examples for album, space, and batch workflows.
- Examples do not encourage copying raw UUIDs.
- Existing contract mistake tests still cover old low-level tools.
- The South Africa/Pierre/Aurelia prompt appears as a regression example.
- Runner instructions use high-level workflow tools first.
- Runner instructions use `assetSource.search` when filter intent is known.
- Runner instructions use `previousSearch.sourceRef` after inspection.
- Runner instructions use explicit IDs only for small inspected sets.
- Runner instructions treat `wrong_id_domain` and `needs_clarification` responses as recoverable.

## Task 1: Contract Examples And Guardrails

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`

- [ ] **Step 1: Write failing contract tests for source-backed examples**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, add tests near the existing high-level workflow contract tests:

```ts
it('defines source-backed workflow examples for album, space, batch, and previous search defaults', () => {
  const albumCreate = sut.getPlanningToolContract(AgentToolName.ProposeAlbumFromSearch)!;
  const albumAdd = sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToAlbumFromSearch)!;
  const spaceCreate = sut.getPlanningToolContract(AgentToolName.ProposeSpaceFromSearch)!;
  const spaceAdd = sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToSpaceFromSearch)!;
  const batch = sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSearch)!;

  const albumRegression = albumCreate.examples.find(
    (example) => example.name === 'create-south-africa-pierre-aurelia-album',
  );

  expect(albumRegression?.description).toMatch(/South Africa.*Pierre.*Aurelia/i);
  expect(albumRegression?.arguments).toMatchObject({
    albumName: expect.stringMatching(/South Africa/i),
    assetSource: {
      kind: 'search',
      filters: {
        country: 'South Africa',
        people: { match: 'any', names: ['Pierre', 'Aurelia'] },
      },
      materialization: 'all-matches-with-limit',
    },
  });
  expect(JSON.stringify(albumRegression?.arguments)).not.toContain('personIds');
  expect(JSON.stringify(albumRegression?.arguments)).not.toContain('assetIds');

  for (const [contract, exampleName] of [
    [albumCreate, 'create-south-africa-pierre-aurelia-album'],
    [albumCreate, 'create-album-from-previous-search'],
    [albumAdd, 'add-search-results-to-album-by-name'],
    [spaceCreate, 'create-space-from-declarative-search'],
    [spaceCreate, 'create-space-from-previous-search'],
    [spaceAdd, 'add-search-results-to-space-by-name'],
    [batch, 'favorite-search-results'],
    [batch, 'rotate-previous-search-results'],
  ] as const) {
    const example = contract.examples.find((candidate) => candidate.name === exampleName);

    expect(example, `${contract.name} ${exampleName}`).toBeDefined();
    expect(
      AgentOperationPlanToolRequestSchemas[contract.name].safeParse(example?.arguments).success,
      `${contract.name} ${exampleName}`,
    ).toBe(true);
  }
});

it('keeps low-level planning mistakes available while preferring source-backed workflow tools', () => {
  const lowLevel = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations)!;
  const workflowContracts = [
    sut.getPlanningToolContract(AgentToolName.ProposeAlbumFromSearch)!,
    sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToAlbumFromSearch)!,
    sut.getPlanningToolContract(AgentToolName.ProposeSpaceFromSearch)!,
    sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToSpaceFromSearch)!,
    sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSearch)!,
  ];

  expect(lowLevel.commonMistakes.map((mistake) => mistake.id)).toEqual(
    expect.arrayContaining([
      'planning-tool-arguments-missing',
      'planning-missing-temporary-target-dependency',
      'planning-pasted-large-asset-ids',
    ]),
  );

  for (const contract of workflowContracts) {
    expect(`${contract.description} ${contract.usage}`).toMatch(/preferred|before low-level/i);
    expect(JSON.stringify(contract.commonMistakes)).toMatch(/assetSource\.search|assetSource\.previousSearch/);
  }
});
```

- [ ] **Step 2: Run contract tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts -t "source-backed workflow examples|low-level planning mistakes"
```

Expected: the first test fails because the dedicated `create-south-africa-pierre-aurelia-album` example does not exist yet. The second test may also fail until add-to-album and add-to-space workflow contracts include raw-ID correction hints that point back to `assetSource.search` or `assetSource.previousSearch`.

- [ ] **Step 3: Add or rename the South Africa declarative album example**

In `server/src/services/agent-mcp-tool-contract.service.ts`, keep the existing `create-album-from-declarative-search` example for backward docs continuity and add a more explicit regression example before it:

```ts
{
  name: 'create-south-africa-pierre-aurelia-album',
  description:
    'Regression: create an album for South Africa in January 2026 with Pierre OR Aurelia using declarative people names.',
  arguments: {
    summary: 'Create South Africa January 2026 album for Pierre or Aurelia.',
    albumName: 'South Africa with Pierre & Aurelia',
    description: 'January 2026 South Africa photos featuring Pierre or Aurelia.',
    assetSource: {
      kind: 'search',
      filters: {
        country: 'South Africa',
        takenAfter: '2026-01-01T00:00:00.000Z',
        takenBefore: '2026-02-01T00:00:00.000Z',
        people: { match: 'any', names: ['Pierre', 'Aurelia'] },
      },
      materialization: 'all-matches-with-limit',
    },
  },
},
```

If the Task 3 prompt length guard fails, the prompt can select only this new example and stop selecting the older resolver/search pair.

- [ ] **Step 3a: Add workflow raw-ID correction hints for add-to-existing-target tools**

In `server/src/services/agent-mcp-tool-contract.service.ts`, add this mistake before `album-workflow-missing-target` in `proposeAddAssetsToAlbumFromSearchContract.commonMistakes`:

```ts
{
  id: 'album-add-workflow-raw-asset-ids',
  match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
  hint: 'Use assetSource.search or assetSource.previousSearch with this workflow tool; do not paste raw asset ids.',
  exampleName: 'add-search-results-to-album-by-name',
},
```

Add this mistake before `space-workflow-missing-target` in `proposeAddAssetsToSpaceFromSearchContract.commonMistakes`:

```ts
{
  id: 'space-add-workflow-raw-asset-ids',
  match: { unexpectedField: 'assetIds', requestShape: 'tool-arguments' },
  hint: 'Use assetSource.search or assetSource.previousSearch with this workflow tool; do not paste raw asset ids.',
  exampleName: 'add-search-results-to-space-by-name',
},
```

- [ ] **Step 4: Re-run contract tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts -t "source-backed workflow examples|low-level planning mistakes"
```

Expected: both tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "feat(server): add Pi source-backed MCP contract examples"
```

## Task 2: Generated MCP Guide Defaults

**Files:**

- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`

- [ ] **Step 1: Write failing docs tests for source-backed defaults**

In `server/src/services/agent-mcp-docs.service.spec.ts`, add tests before the existing sync test:

```ts
const section = (markdown: string, title: string) => {
  const start = markdown.indexOf(title);
  expect(start, `${title} should exist`).toBeGreaterThanOrEqual(0);
  const next = markdown.indexOf('\n## ', start + title.length);
  return markdown.slice(start, next === -1 ? undefined : next);
};

it('documents source-backed planning defaults before the tool catalog', () => {
  const markdown = sut.generateMarkdown();
  const defaults = section(markdown, '## Source-Backed Planning Defaults');

  expect(markdown.indexOf('## Source-Backed Planning Defaults')).toBeLessThan(markdown.indexOf('## Tools'));
  expect(defaults).toContain('Use high-level workflow tools first');
  expect(defaults).toContain('assetSource.search');
  expect(defaults).toContain('previousSearch.sourceRef');
  expect(defaults).toContain('explicit IDs');
  expect(defaults).toContain('small inspected sets');
  expect(defaults).toContain('wrong_id_domain');
  expect(defaults).toContain('needs_clarification');
  expect(defaults).toContain('choiceRefs');
});

it('documents end-to-end source-backed album, space, and batch examples without raw UUID copying', () => {
  const markdown = sut.generateMarkdown();
  const defaults = section(markdown, '## Source-Backed Planning Defaults');

  expect(defaults).toContain('create-south-africa-pierre-aurelia-album');
  expect(defaults).toContain('proposeAlbumFromSearch');
  expect(defaults).toContain('proposeSpaceFromSearch');
  expect(defaults).toContain('proposeAssetBatchFromSearch');
  expect(defaults).toContain('"people": {');
  expect(defaults).toContain('"names": ["Pierre", "Aurelia"]');
  expect(defaults).toContain('"sourceRef": "<sourceRef from searchAssets>"');
  expect(defaults).not.toContain('00000000-0000-4000-8000');
  expect(defaults).not.toContain('"personIds"');
  expect(defaults).not.toContain('"assetIds"');
});
```

If a top-level helper name conflicts with existing variables, keep it local to `describe(AgentMcpDocsService.name, ...)`.

- [ ] **Step 2: Run docs tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts -t "source-backed planning defaults|end-to-end source-backed"
```

Expected: fails because `## Source-Backed Planning Defaults` is not rendered yet.

- [ ] **Step 3: Add source-backed guide rendering**

In `server/src/services/agent-mcp-docs.service.ts`, insert this section between `## Progressive Detail Workflow` and `## Tools`:

```ts
'## Source-Backed Planning Defaults',
'',
'Use high-level workflow tools first for album, space, and asset batch requests. Prefer `assetSource.search` when the user already gave the filter intent. Prefer `previousSearch.sourceRef` after an inspection search. Use explicit IDs only for small inspected sets where the user is selecting exact assets.',
'',
'Treat `wrong_id_domain` as recoverable: retry with `assetSource.search`, `previousSearch.sourceRef`, or exact IDs from the correct tool domain. Treat `needs_clarification` as recoverable: ask the user to choose one Gallery-provided option, then pass the selected `choiceRefs` in the next declarative named filter.',
'',
...this.renderSourceBackedWorkflowExamples(),
```

Add a private helper below `renderExample()`:

```ts
private renderSourceBackedWorkflowExamples(): string[] {
  const examples = this.listDocumentedToolArgumentExamples();
  const pick = (toolName: AgentToolName, exampleName: string) => {
    const example = examples.find((candidate) => candidate.toolName === toolName && candidate.exampleName === exampleName);
    if (!example) {
      throw new Error(`Missing source-backed workflow docs example ${toolName} ${exampleName}`);
    }

    return example;
  };

  const selected = [
    pick(AgentToolName.ProposeAlbumFromSearch, 'create-south-africa-pierre-aurelia-album'),
    pick(AgentToolName.ProposeAlbumFromSearch, 'create-album-from-previous-search'),
    pick(AgentToolName.ProposeSpaceFromSearch, 'create-space-from-declarative-search'),
    pick(AgentToolName.ProposeAssetBatchFromSearch, 'favorite-search-results'),
  ];

  return selected.flatMap((example) => [
    `### ${example.description}`,
    '',
    `MCP tool name: \`${example.toolName}\``,
    '',
    `Example: \`${example.exampleName}\``,
    '',
    markdownJson(example.arguments),
    '',
  ]);
}
```

Keep `markdownJson()` so fixture IDs render as placeholders.

- [ ] **Step 4: Re-run docs tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts -t "source-backed planning defaults|end-to-end source-backed|renders parseable JSON code fences"
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts
git commit -m "feat(server): document Pi source-backed planning defaults"
```

## Task 3: Runner Prompt Defaults

**Files:**

- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`

- [ ] **Step 1: Write failing prompt tests for high-level defaults**

In `server/src/services/agent-mcp-prompt.service.spec.ts`, add tests near the existing prompt behavior tests:

```ts
it('teaches source-backed workflow tools as the default write path', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('Default write:');
  expect(prompt).toContain('mcp_gallery_proposeAlbumFromSearch');
  expect(prompt).toContain('mcp_gallery_proposeSpaceFromSearch');
  expect(prompt).toContain('mcp_gallery_proposeAssetBatchFromSearch');
  expect(prompt).toContain('assetSource.search');
  expect(prompt).toContain('previousSearch.sourceRef');
  expect(prompt).toMatch(/explicit IDs only for small inspected sets/i);
  expect(prompt).toContain('wrong_id_domain');
  expect(prompt).toContain('needs_clarification');
  expect(prompt).toContain('choiceRefs');
  expect(prompt.length).toBeLessThanOrEqual(4200);
});

it('renders the South Africa Pierre Aurelia regression as an assetSource.search workflow', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('South Africa');
  expect(prompt).toContain('Pierre');
  expect(prompt).toContain('Aurelia');
  expect(prompt).toContain('mcp_gallery_proposeAlbumFromSearch');
  expect(prompt).toContain('"assetSource":{"kind":"search"');
  expect(prompt).toContain('"people":{"match":"any","names":["Pierre","Aurelia"]}');
  expect(prompt).not.toContain('"personIds":["<personIds value from resolveAssetSearchFilters>"');
});
```

Update the existing length expectations in this spec from `3800` to `4200` only where the full prompt length is asserted. Keep the direct-write and raw-ID safety assertions.

- [ ] **Step 2: Run prompt tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts -t "source-backed workflow tools|South Africa Pierre Aurelia|compact runner cheat sheet"
```

Expected: fails because the prompt does not yet contain `Default write:` or the declarative workflow example.

- [ ] **Step 3: Select high-level examples for prompt rendering**

In `server/src/services/agent-mcp-prompt.service.ts`, update `promptExampleSelections`:

```ts
const promptExampleSelections = [
  { toolName: AgentToolName.ProposeAlbumFromSearch, exampleName: 'create-south-africa-pierre-aurelia-album' },
  { toolName: AgentToolName.ProposeAlbumFromSearch, exampleName: 'create-album-from-previous-search' },
  { toolName: AgentToolName.ProposeSpaceFromSearch, exampleName: 'create-space-from-declarative-search' },
  { toolName: AgentToolName.ProposeAssetBatchFromSearch, exampleName: 'favorite-search-results' },
  { toolName: AgentToolName.ResolveAssetSearchFilters, exampleName: 'resolve-named-filters' },
  { toolName: AgentToolName.SearchAssets, exampleName: 'summary-sample-search' },
  { toolName: AgentToolName.SearchAssets, exampleName: 'visual-curation-candidate-search' },
  { toolName: AgentToolName.ReadAssetMetadata, exampleName: 'read-technical-fields-for-selected-assets' },
  { toolName: AgentToolName.ReadAssetMetadata, exampleName: 'approved-retry' },
  { toolName: AgentToolName.ListSpaces, exampleName: 'list-visible-spaces' },
  { toolName: AgentToolName.ReadSpace, exampleName: 'read-space-details' },
  { toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'create-empty-album' },
  { toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'create-album-and-add-assets' },
  { toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'add-assets-to-existing-space' },
  { toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'remove-assets-from-existing-space' },
  { toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'rename-existing-space' },
  { toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'update-existing-space-description' },
  { toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'clear-existing-space-description' },
  { toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'update-existing-space-color' },
] as const;
```

This deliberately stops selecting the older resolver/search Pierre/Aurelia examples for the compact prompt. They remain in the generated guide and contract tests.

- [ ] **Step 4: Render compact source-backed defaults**

In `generatePromptCheatSheet()`, replace the older write/progressive lines with source-backed defaults while keeping read/progressive guidance. Add these local examples:

```ts
const albumSourceSearch = this.getPromptExample(
  examples,
  AgentToolName.ProposeAlbumFromSearch,
  'create-south-africa-pierre-aurelia-album',
);
const albumPreviousSearch = this.getPromptExample(
  examples,
  AgentToolName.ProposeAlbumFromSearch,
  'create-album-from-previous-search',
);
const spaceSourceSearch = this.getPromptExample(
  examples,
  AgentToolName.ProposeSpaceFromSearch,
  'create-space-from-declarative-search',
);
const batchSourceSearch = this.getPromptExample(
  examples,
  AgentToolName.ProposeAssetBatchFromSearch,
  'favorite-search-results',
);
```

Render lines like:

```ts
`Default write: album=${albumSourceSearch.piToolName}; space=${spaceSourceSearch.piToolName}; favorite/archive/tag/rotate=${batchSourceSearch.piToolName}; low-level only for explicit small inspected sets.`,
`assetSource.search when filter intent is known: ${albumSourceSearch.piToolName} ${this.formatJson(albumSourceSearch.arguments)}`,
`After inspection use previousSearch.sourceRef, not copied assetIds: ${albumPreviousSearch.piToolName} ${this.formatJson(albumPreviousSearch.arguments)}`,
`Space from search: ${spaceSourceSearch.piToolName} ${this.formatJson(spaceSourceSearch.arguments)}`,
`Batch from search: ${batchSourceSearch.piToolName} ${this.formatJson(batchSourceSearch.arguments)}`,
`Recoverable: wrong_id_domain -> retry with the right domain or assetSource.search; needs_clarification -> ask user, then include selected choiceRefs in people/tags/albums/space filter.`,
```

Keep these existing concepts in the prompt:

- `No direct apply/write tool exists; Gallery applies after plan review.`
- approval retry guidance;
- progressive read guidance;
- resolver fidelity for inspection searches;
- `createSelectionHandle` / `assetSelectionHandleId`;
- visual and technical metadata guidance;
- space lookup guidance;
- old low-level planning guidance for explicit small inspected sets.

If the prompt exceeds `4200`, remove redundant old example detail rather than increasing the limit.

- [ ] **Step 5: Re-run prompt tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
```

Expected: prompt tests pass, including module round-trip and committed generated prompt sync once Task 4 runs. Before Task 4, the committed generated prompt sync test may fail; if so, run only the focused behavior tests here and let Task 4 regenerate.

- [ ] **Step 6: Commit Task 3**

Commit only source/test changes if the committed generated prompt sync test is intentionally red until Task 4:

```bash
git add server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts
git commit -m "feat(server): teach Pi source-backed MCP prompt defaults"
```

## Task 4: Regenerate Docs And Prompt Artifacts

**Files:**

- Modify generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Modify generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

- [ ] **Step 1: Build server so sync scripts use current code**

Run:

```bash
pnpm --dir server build
```

Expected: exit code 0.

- [ ] **Step 2: Regenerate MCP docs and prompt**

Run:

```bash
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
```

Expected:

- prints `Wrote docs/superpowers/generated/pi-agent-mcp-tools.md`;
- prints `Wrote agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`.

- [ ] **Step 3: Check generated docs formatting**

Run:

```bash
pnpm --dir docs exec prettier --check superpowers/generated/pi-agent-mcp-tools.md
```

Expected: `All matched files use Prettier code style!`. If this check fails, update `AgentMcpDocsService` so the rendered generated guide already matches the formatter instead of manually editing the generated file.

- [ ] **Step 4: Verify generated artifacts are in sync**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts -t "committed generated guide|committed runner prompt|source-backed|South Africa|recoverable"
```

Expected: selected tests pass and both committed generated artifact sync tests pass.

- [ ] **Step 5: Commit generated artifacts**

```bash
git add docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
git commit -m "docs: regenerate Pi MCP source planning guidance"
```

If Task 4 produces no generated diff, do not create an empty commit; instead include the sync command output in the final verification notes.

## Task 5: Slice Verification And Push

**Files:**

- All files touched by Tasks 1-4.

- [ ] **Step 1: Run focused Slice 11 tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts
```

Expected: all tests in the three files pass.

- [ ] **Step 2: Run server typecheck**

Run:

```bash
pnpm --dir server run check
```

Expected: TypeScript check exits 0.

- [ ] **Step 3: Run docs formatting check**

Run:

```bash
pnpm --dir docs format
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 4: Run diff hygiene**

Run:

```bash
git diff --check
git status --short --branch
```

Expected:

- `git diff --check` prints no output and exits 0;
- status shows only intentional committed or staged work before the final push.

- [ ] **Step 5: Commit any final formatting-only changes**

If Step 3 or Step 4 changed files, commit only those files:

For the known Slice 11 files, use:

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/plans/2026-05-23-pi-agent-declarative-planning-sources-slice-11.md
git commit -m "docs: format Pi MCP source planning guidance"
```

If no files changed, skip this step.

- [ ] **Step 6: Push the branch**

Run:

```bash
git push
```

Expected: `explore/pi-agent-brainstorm` pushes to `origin/explore/pi-agent-brainstorm`.

Per the user's latest instruction, stop after the push and do not start CI babysitting.

## Plan Review Checklist

- TDD order is explicit for contract, docs, prompt, and generated artifact sync behavior.
- Every Slice 11 edge case is represented by automated tests.
- File paths match the current codebase.
- The plan does not implement Slice 12 activity polish.
- The generated docs/prompt artifacts are regenerated through existing sync scripts, not edited manually.
- Final push is included; CI babysitting is explicitly skipped per user instruction.
