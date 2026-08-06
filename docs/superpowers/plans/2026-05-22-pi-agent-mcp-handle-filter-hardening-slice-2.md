# Pi Agent MCP Resolve Search Guidance Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Pi, through generated prompt/docs guidance, to carry `resolveAssetSearchFilters.resolvedFilters` into the next `searchAssets.filters` call, especially for people OR searches and shared-space people.

**Architecture:** Extend existing contract-owned examples/guidance and generated prompt/docs renderers. No runtime search inference is added; this slice only makes the model-facing resolver-to-search contract explicit and test-covered.

**Tech Stack:** TypeScript, Nest service classes, Vitest, generated ESM/Markdown artifacts.

---

## Spec Context

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-mcp-handle-filter-hardening-design.md`

Slice 2 requires:

- Generated prompt pattern for resolving named people and then searching with returned `personIds`.
- OR semantics: user language like "Pierre OR Aurelia" maps to one `personIds` array containing both resolved IDs.
- `spacePersonIds` must be carried together with `spaceId`.
- Resolver output with no matching person should lead to a question, not a broad unfiltered search.
- TDD coverage in prompt, contract/docs, and edge cases.

## Files

- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Test: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt-placeholders.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`
- Test: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Test: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Regenerate: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Regenerate: `docs/superpowers/generated/pi-agent-mcp-tools.md`

## Baseline

- [ ] **Step 1: Confirm current Slice 1 tests are green**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: all tests pass before Slice 2 edits. Current expected baseline after Slice 1 is 122 passing tests.

---

## Task 1: Add Contract Examples For People OR And Shared-Space Resolver-To-Search

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Test: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Write failing contract tests for the examples and guidance**

Add these tests near existing search/resolver contract tests in `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

```ts
it('documents people OR resolver and search examples that keep resolved personIds together', () => {
  const resolver = sut.getReadToolContract(AgentToolName.ResolveAssetSearchFilters);
  const search = sut.getReadToolContract(AgentToolName.SearchAssets);
  const resolverExample = resolver?.examples.find((example) => example.name === 'resolve-pierre-aurelia-people');
  const searchExample = search?.examples.find((example) => example.name === 'search-resolved-pierre-aurelia-people');

  expect(resolverExample?.description).toMatch(/Pierre OR Aurelia/i);
  expect(resolverExample?.arguments).toEqual({ people: ['Pierre', 'Aurelia'] });
  expect(searchExample?.description).toMatch(/same personIds array/i);
  expect(searchExample?.arguments).toEqual({
    detail: 'ids',
    createSelectionHandle: true,
    filters: {
      country: 'South Africa',
      takenAfter: '2026-01-01T00:00:00.000Z',
      takenBefore: '2026-01-31T23:59:59.999Z',
      personIds: ['00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000041'],
    },
    limit: 50,
  });
  expect(
    AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse(resolverExample?.arguments).success,
  ).toBe(true);
  expect(AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(searchExample?.arguments).success).toBe(
    true,
  );
});

it('documents shared-space resolver and search examples that keep spaceId with spacePersonIds', () => {
  const search = sut.getReadToolContract(AgentToolName.SearchAssets);
  const searchExample = search?.examples.find((example) => example.name === 'search-resolved-family-space-people');

  expect(searchExample?.description).toMatch(/spaceId.*spacePersonIds/is);
  expect(searchExample?.arguments).toEqual({
    detail: 'ids',
    filters: {
      spaceId: '00000000-0000-4000-8000-000000000020',
      spacePersonIds: ['00000000-0000-4000-8000-000000000021'],
    },
    limit: 50,
  });
  expect(AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(searchExample?.arguments).success).toBe(
    true,
  );
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected red failure: missing examples named `resolve-pierre-aurelia-people`, `search-resolved-pierre-aurelia-people`, and `search-resolved-family-space-people`.

- [ ] **Step 3: Add exact examples and contract guidance**

Modify `server/src/services/agent-mcp-tool-contract.service.ts`.

Add a second person fixture after `examplePersonId`:

```ts
const exampleSecondPersonId = '00000000-0000-4000-8000-000000000041';
```

Because this introduces a new schema-valid fixture ID, also extend the prompt
placeholder map from Slice 1. Modify
`server/src/services/agent-mcp-prompt-placeholders.ts`:

```ts
  '00000000-0000-4000-8000-000000000041': '<another-personIds value from resolveAssetSearchFilters>',
```

Update the placeholder map assertion in
`server/src/services/agent-mcp-prompt.service.spec.ts` to include the same
mapping. This is required by the spec rule that new contract fixture IDs must be
added to the renderer in the same change.

In `searchAssetsContract.usage`, append guidance:

```ts
' When resolveAssetSearchFilters returns resolvedFilters, copy those fields into searchAssets.filters exactly. For people OR requests, use one personIds array with every resolved person id. For shared-space people, include both spaceId and spacePersonIds.';
```

Add these `SearchAssets` examples in the existing `examples` array near the other people/space examples:

```ts
    {
      name: 'search-resolved-pierre-aurelia-people',
      description:
        'Search January 2026 South Africa photos after resolving "Pierre OR Aurelia"; keep both IDs in the same personIds array.',
      arguments: {
        detail: 'ids',
        createSelectionHandle: true,
        filters: {
          country: 'South Africa',
          takenAfter: '2026-01-01T00:00:00.000Z',
          takenBefore: '2026-01-31T23:59:59.999Z',
          personIds: [examplePersonId, exampleSecondPersonId],
        },
        limit: 50,
      },
    },
    {
      name: 'search-resolved-family-space-people',
      description:
        'Search after resolving a named person inside a shared space; spacePersonIds must be sent with the resolved spaceId.',
      arguments: {
        detail: 'ids',
        filters: {
          spaceId: exampleSpaceId,
          spacePersonIds: [exampleSpacePersonId],
        },
        limit: 50,
      },
    },
```

In `resolveAssetSearchFiltersContract.usage`, append guidance:

```ts
' If any requested people, albums, tags, spaces, or camera names cannot be resolved unambiguously, ask a clarifying question instead of running a broad search without the missing resolved filter.';
```

Add this resolver example in `resolveAssetSearchFiltersContract.examples`:

```ts
    {
      name: 'resolve-pierre-aurelia-people',
      description: 'Resolve people from "Pierre OR Aurelia" before searching.',
      arguments: { people: ['Pierre', 'Aurelia'] },
    },
```

- [ ] **Step 4: Run the contract test and verify it passes**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected green result: contract tests pass.

---

## Task 2: Add Runner Prompt Guidance For Resolve-Then-Search Fidelity

**Files:**

- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Test: `server/src/services/agent-mcp-prompt.service.spec.ts`

- [ ] **Step 1: Write failing prompt tests**

Add tests inside `describe(AgentMcpPromptService.name, () => {`:

```ts
it('shows an end-to-end people OR resolver-to-search sequence in the runner prompt', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('People OR');
  expect(prompt).toContain('Pierre');
  expect(prompt).toContain('Aurelia');
  expect(prompt).toContain('copy resolvedFilters into searchAssets.filters');
  expect(prompt).toContain(
    '"personIds":["<personIds value from resolveAssetSearchFilters>","<another-personIds value from resolveAssetSearchFilters>"]',
  );
  expect(prompt).toContain('"country":"South Africa"');
  expect(prompt).toContain('"createSelectionHandle":true');
});

it('shows shared-space person resolver-to-search guidance with spaceId and spacePersonIds together', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('Shared-space people');
  expect(prompt).toContain('"spaceId":"<space.id from listSpaces/readSpace>"');
  expect(prompt).toContain('"spacePersonIds":["<spacePersonIds value from resolveAssetSearchFilters>"]');
  expect(prompt).toMatch(/ask .*clarifying/i);
  expect(prompt).not.toMatch(/run .*broad search .*missing/i);
});
```

- [ ] **Step 2: Run prompt tests and verify they fail**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts
```

Expected red failure: prompt does not contain the new resolver-to-search sequence.

- [ ] **Step 3: Render selected resolver/search examples in the prompt**

Modify `server/src/services/agent-mcp-prompt.service.ts`.

Add prompt example selections:

```ts
  { toolName: AgentToolName.ResolveAssetSearchFilters, exampleName: 'resolve-pierre-aurelia-people' },
  { toolName: AgentToolName.SearchAssets, exampleName: 'search-resolved-pierre-aurelia-people' },
  { toolName: AgentToolName.SearchAssets, exampleName: 'search-resolved-family-space-people' },
```

Inside `generatePromptCheatSheet()`, retrieve the examples:

```ts
const peopleOrResolve = this.getPromptExample(
  examples,
  AgentToolName.ResolveAssetSearchFilters,
  'resolve-pierre-aurelia-people',
);
const peopleOrSearch = this.getPromptExample(
  examples,
  AgentToolName.SearchAssets,
  'search-resolved-pierre-aurelia-people',
);
const sharedSpacePeopleSearch = this.getPromptExample(
  examples,
  AgentToolName.SearchAssets,
  'search-resolved-family-space-people',
);
```

Add prompt lines after `Resolve names before searchAssets`:

```ts
        'Resolver fidelity: copy resolvedFilters into searchAssets.filters exactly; do not drop personIds, spaceId, or spacePersonIds. If a requested name is missing or ambiguous, ask one clarifying question instead of running a broad search without that filter.',
        `People OR: ${peopleOrResolve.piToolName} ${this.formatJson(peopleOrResolve.arguments)} -> ${peopleOrSearch.piToolName} ${this.formatJson(peopleOrSearch.arguments)}`,
        `Shared-space people: keep spaceId with spacePersonIds: ${sharedSpacePeopleSearch.piToolName} ${this.formatJson(sharedSpacePeopleSearch.arguments)}`,
```

- [ ] **Step 4: Run prompt tests and verify they pass**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts
```

Expected green result: prompt tests pass and prompt length remains within the existing compact limit.

---

## Task 3: Add Generated Docs Guidance For Resolve-Then-Search Fidelity

**Files:**

- Modify: `server/src/services/agent-mcp-docs.service.ts`
- Test: `server/src/services/agent-mcp-docs.service.spec.ts`

- [ ] **Step 1: Write failing docs tests**

Add test inside `describe(AgentMcpDocsService.name, () => {`:

```ts
it('documents resolver-to-search fidelity for people OR and shared-space people', () => {
  const markdown = sut.generateMarkdown();

  expect(markdown).toContain('### Resolver-to-search fidelity');
  expect(markdown).toContain('copy `resolvedFilters` into `searchAssets.filters` exactly');
  expect(markdown).toContain('Pierre OR Aurelia');
  expect(markdown).toContain('one `personIds` array');
  expect(markdown).toContain('spaceId` and `spacePersonIds` together');
  expect(markdown).toContain('ask a clarifying question');
  expect(markdown).toContain('resolve-pierre-aurelia-people');
  expect(markdown).toContain('search-resolved-pierre-aurelia-people');
  expect(markdown).toContain('search-resolved-family-space-people');
});
```

- [ ] **Step 2: Run docs tests and verify they fail**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-docs.service.spec.ts
```

Expected red failure: missing resolver-to-search fidelity section and examples.

- [ ] **Step 3: Add docs section**

Modify `server/src/services/agent-mcp-docs.service.ts`. In `generateMarkdown()`, after the existing `## Progressive Detail Workflow` bullet list and before `### Large selections`, insert:

```ts
      '### Resolver-to-search fidelity',
      '',
      '- After `resolveAssetSearchFilters`, copy `resolvedFilters` into `searchAssets.filters` exactly. Do not drop returned `personIds`, `spaceId`, `spacePersonIds`, `tagIds`, `albumIds`, or camera fields.',
      '- For people OR language such as `Pierre OR Aurelia`, resolve both names and search with one `personIds` array containing every resolved person id.',
      '- For shared-space people, send `spaceId` and `spacePersonIds` together. `spacePersonIds` without `spaceId` is invalid.',
      '- If a requested person, album, tag, space, camera make, camera model, or lens cannot be resolved unambiguously, ask a clarifying question instead of running a broad unfiltered search.',
      '',
```

The examples from Task 1 will appear automatically in the `## Tools` section because docs render every contract example.

- [ ] **Step 4: Run docs tests and verify they pass**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-docs.service.spec.ts
```

Expected green result: docs tests pass.

---

## Task 4: Regenerate Artifacts And Validate Slice 2

**Files:**

- Regenerate: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Regenerate: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Build server**

Run:

```bash
pnpm --dir server build
```

Expected: Nest build exits 0.

- [ ] **Step 2: Regenerate MCP prompt and docs artifacts**

Run:

```bash
pnpm --dir server sync:agent-mcp-prompt
pnpm --dir server sync:agent-mcp-docs
```

Expected output:

```text
Wrote agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
Wrote docs/superpowers/generated/pi-agent-mcp-tools.md
```

- [ ] **Step 3: Run combined narrow regression tests**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected green result: prompt, docs, and contract tests pass.

- [ ] **Step 4: Run formatting/type safety checks**

Run:

```bash
pnpm --dir server format
pnpm --dir server lint
pnpm --dir server check
git diff --check
```

Expected green result: all commands exit 0.

- [ ] **Step 5: Inspect generated text for Slice 2 requirements**

Run:

```bash
rg -n "People OR|Pierre|Aurelia|copy resolvedFilters into searchAssets\\.filters|spacePersonIds|search-resolved-pierre-aurelia-people|search-resolved-family-space-people" agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
rg -n "00000000-0000-4000-8000-000000000(020|021|040|041)" agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
```

Expected:

- First command exits 0 with matches in generated prompt/docs.
- Second command exits 1 with no fixture UUID matches in generated prompt/docs.

- [ ] **Step 6: Commit Slice 2**

Run:

```bash
git status --short
git add server/src/services/agent-mcp-tool-contract.service.ts \
  server/src/services/agent-mcp-tool-contract.service.spec.ts \
  server/src/services/agent-mcp-prompt-placeholders.ts \
  server/src/services/agent-mcp-prompt.service.ts \
  server/src/services/agent-mcp-prompt.service.spec.ts \
  server/src/services/agent-mcp-docs.service.ts \
  server/src/services/agent-mcp-docs.service.spec.ts \
  agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs \
  docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "docs: teach Pi resolver search fidelity"
```

Expected: one commit containing only Slice 2 implementation and generated artifacts.

---

## Plan Self-Review

- TDD order is explicit for contract, prompt, docs, and generated artifacts.
- Every Slice 2 spec test is covered:
  - Prompt includes resolver-to-search sequence.
  - Prompt names `personIds`, `spaceId`, and `spacePersonIds`.
  - Docs include the same guidance.
- Every Slice 2 edge case is covered:
  - Multiple people names: `Pierre OR Aurelia` resolver/search examples.
  - Shared-space people results: `search-resolved-family-space-people`.
  - Resolver output with no match/ambiguity: prompt/docs guidance to ask a clarifying question instead of broad search.
- No runtime inference of missing resolved filters is introduced.
