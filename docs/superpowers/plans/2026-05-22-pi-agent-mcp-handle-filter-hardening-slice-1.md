# Pi Agent MCP Handle Filter Hardening Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render model-facing MCP prompt/docs examples with semantic placeholders instead of schema-valid fixture UUIDs, while keeping contract examples schema-valid.

**Architecture:** Add a small shared placeholder renderer used only by prompt/docs generation. Contract examples and validation-correction example arguments remain unchanged and schema-valid; generated prompt/docs text passes cloned examples through the renderer immediately before stringification.

**Tech Stack:** TypeScript, Nest service classes, Vitest, generated ESM/Markdown artifacts.

---

## Spec Context

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-mcp-handle-filter-hardening-design.md`

Slice 1 requires:

- Prompt/docs rendering replaces schema-valid example UUIDs with semantic placeholders.
- Generated MCP prompt and docs are updated.
- DTO/schema contract validation continues to use real fixture UUID values.
- Tests use TDD and cover every listed edge case.

Fixture placeholder map required by the spec:

```ts
const requiredPlaceholders = {
  '00000000-0000-4000-8000-000000000001': '<asset-id-from-searchAssets>',
  '00000000-0000-4000-8000-000000000002': '<another-asset-id-from-searchAssets>',
  '00000000-0000-4000-8000-000000000010': '<album.id from listAlbums/readAlbum>',
  '00000000-0000-4000-8000-000000000020': '<space.id from listSpaces/readSpace>',
  '00000000-0000-4000-8000-000000000021': '<spacePersonIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000030': '<tagIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000040': '<personIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000111': '<approved-toolCallId>',
  '00000000-0000-4000-8000-000000000222': '<plan.id from proposed plan>',
  '00000000-0000-4000-8000-000000000333': '<selectionHandle.id from searchAssets>',
} as const;
```

## Files

- Create: `server/src/services/agent-mcp-prompt-placeholders.ts`
- Test: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Test/Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`
- Regenerate: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Regenerate: `docs/superpowers/generated/pi-agent-mcp-tools.md`

## Baseline

- [ ] **Step 1: Confirm the current narrow MCP tests pass before writing Slice 1 tests**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: all tests pass before Slice 1 edits. If this fails, stop and report the pre-existing failure before changing production code.

---

## Task 1: Add Prompt Placeholder Renderer With Failing Unit Coverage

**Files:**

- Test: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Create: `server/src/services/agent-mcp-prompt-placeholders.ts`

- [ ] **Step 1: Write failing tests for the shared placeholder renderer**

Add imports near the top of `server/src/services/agent-mcp-prompt.service.spec.ts`:

```ts
import {
  agentMcpPromptPlaceholderMap,
  renderAgentMcpPromptPlaceholders,
} from 'src/services/agent-mcp-prompt-placeholders';
```

Add this `describe` block before `describe(AgentMcpPromptService.name, () => {`:

```ts
describe('agent MCP prompt placeholders', () => {
  const fixtureIds = Object.keys(agentMcpPromptPlaceholderMap);

  it('defines semantic placeholders for every schema-valid MCP fixture id', () => {
    expect(agentMcpPromptPlaceholderMap).toEqual({
      '00000000-0000-4000-8000-000000000001': '<asset-id-from-searchAssets>',
      '00000000-0000-4000-8000-000000000002': '<another-asset-id-from-searchAssets>',
      '00000000-0000-4000-8000-000000000010': '<album.id from listAlbums/readAlbum>',
      '00000000-0000-4000-8000-000000000020': '<space.id from listSpaces/readSpace>',
      '00000000-0000-4000-8000-000000000021': '<spacePersonIds value from resolveAssetSearchFilters>',
      '00000000-0000-4000-8000-000000000030': '<tagIds value from resolveAssetSearchFilters>',
      '00000000-0000-4000-8000-000000000040': '<personIds value from resolveAssetSearchFilters>',
      '00000000-0000-4000-8000-000000000111': '<approved-toolCallId>',
      '00000000-0000-4000-8000-000000000222': '<plan.id from proposed plan>',
      '00000000-0000-4000-8000-000000000333': '<selectionHandle.id from searchAssets>',
    });
  });

  it('replaces nested fixture ids without mutating the source value', () => {
    const source = {
      operationIds: ['00000000-0000-4000-8000-000000000333'],
      operations: [
        {
          targetId: '00000000-0000-4000-8000-000000000010',
          assetIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
          payload: {
            tagId: '00000000-0000-4000-8000-000000000030',
            untouched: 'not-a-fixture',
          },
        },
      ],
    };

    const rendered = renderAgentMcpPromptPlaceholders(source);

    expect(rendered).toEqual({
      operationIds: ['<selectionHandle.id from searchAssets>'],
      operations: [
        {
          targetId: '<album.id from listAlbums/readAlbum>',
          assetIds: ['<asset-id-from-searchAssets>', '<another-asset-id-from-searchAssets>'],
          payload: {
            tagId: '<tagIds value from resolveAssetSearchFilters>',
            untouched: 'not-a-fixture',
          },
        },
      ],
    });
    expect(source.operations[0].targetId).toBe('00000000-0000-4000-8000-000000000010');
  });

  it('leaves runtime-looking non-fixture ids unchanged', () => {
    const runtimeId = 'a4d2b718-2485-47aa-b45c-0d70f64cfd93';

    expect(renderAgentMcpPromptPlaceholders({ assetIds: [runtimeId] })).toEqual({ assetIds: [runtimeId] });
    expect(fixtureIds).not.toContain(runtimeId);
  });
});
```

- [ ] **Step 2: Run the narrow prompt test and verify it fails for the missing helper**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts
```

Expected red failure: module resolution/import failure for `src/services/agent-mcp-prompt-placeholders`.

- [ ] **Step 3: Add the minimal shared placeholder renderer**

Create `server/src/services/agent-mcp-prompt-placeholders.ts`:

```ts
export const agentMcpPromptPlaceholderMap = {
  '00000000-0000-4000-8000-000000000001': '<asset-id-from-searchAssets>',
  '00000000-0000-4000-8000-000000000002': '<another-asset-id-from-searchAssets>',
  '00000000-0000-4000-8000-000000000010': '<album.id from listAlbums/readAlbum>',
  '00000000-0000-4000-8000-000000000020': '<space.id from listSpaces/readSpace>',
  '00000000-0000-4000-8000-000000000021': '<spacePersonIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000030': '<tagIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000040': '<personIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000111': '<approved-toolCallId>',
  '00000000-0000-4000-8000-000000000222': '<plan.id from proposed plan>',
  '00000000-0000-4000-8000-000000000333': '<selectionHandle.id from searchAssets>',
} as const;

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike | unknown };

export const renderAgentMcpPromptPlaceholders = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return agentMcpPromptPlaceholderMap[value as keyof typeof agentMcpPromptPlaceholderMap] ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderAgentMcpPromptPlaceholders(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, JsonLike | unknown>).map(([key, entry]) => [
      key,
      renderAgentMcpPromptPlaceholders(entry),
    ]),
  );
};
```

- [ ] **Step 4: Run the prompt test and verify the helper tests pass**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts
```

Expected green result: prompt service spec passes, or only later placeholder-rendering expectations fail if the worker already added tests from Task 2.

---

## Task 2: Render Prompt Cheat Sheet With Placeholders

**Files:**

- Test: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`

- [ ] **Step 1: Write failing tests for prompt output and contract immutability**

Inside `describe(AgentMcpPromptService.name, () => {`, add:

```ts
it('renders model-facing prompt examples with semantic placeholders instead of fixture UUIDs', () => {
  const prompt = sut.generatePromptCheatSheet();

  for (const fixtureId of Object.keys(agentMcpPromptPlaceholderMap)) {
    expect(prompt).not.toContain(fixtureId);
  }

  expect(prompt).toContain('<asset-id-from-searchAssets>');
  expect(prompt).toContain('<space.id from listSpaces/readSpace>');
  expect(prompt).toContain('<approved-toolCallId>');
  expect(prompt).toContain('<selectionHandle.id from searchAssets>');
});

it('keeps structured prompt examples schema-valid and unmodified before rendering', () => {
  sut.generatePromptCheatSheet();

  const examples = sut.listPromptExamples();
  const serializedExamples = JSON.stringify(examples);

  expect(serializedExamples).toContain('00000000-0000-4000-8000-000000000001');
  expect(serializedExamples).toContain('00000000-0000-4000-8000-000000000020');
  expect(serializedExamples).toContain('00000000-0000-4000-8000-000000000111');

  for (const example of examples) {
    if (example.toolName in AgentReadToolRequestSchemas) {
      AgentReadToolRequestSchemas[example.toolName as AgentMcpReadToolName].parse(example.arguments);
      continue;
    }

    AgentOperationPlanToolRequestSchemas[example.toolName as AgentMcpPlanningToolName].parse(example.arguments);
  }
});

it('keeps validation-correction example arguments schema-valid and unmodified after prompt rendering', () => {
  sut.generatePromptCheatSheet();

  const correction = contractService.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
    requestShape: 'tool-arguments',
    issues: [{ path: 'operations.0.assetIds', message: 'expected array to have <=10000 items' }],
  });

  expect(correction?.mistakeId).toBe('planning-pasted-large-asset-ids');
  expect(JSON.stringify(correction?.exampleArguments)).toContain('00000000-0000-4000-8000-000000000333');
  AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].parse(correction?.exampleArguments);
});
```

- [ ] **Step 2: Run the prompt test and verify it fails because fixture IDs still render**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts
```

Expected red failure: `expected "...prompt..." not to contain "00000000-0000-4000-8000-..."`.

- [ ] **Step 3: Apply placeholders inside prompt JSON formatting only**

Modify imports in `server/src/services/agent-mcp-prompt.service.ts`:

```ts
import { renderAgentMcpPromptPlaceholders } from 'src/services/agent-mcp-prompt-placeholders';
```

Replace `formatJson` with:

```ts
  private formatJson(value: unknown): string {
    return JSON.stringify(renderAgentMcpPromptPlaceholders(this.compactPromptValue(value)));
  }
```

Do not change `listPromptExamples()` or `validatePromptExample()`.

- [ ] **Step 4: Run the prompt test and verify it passes**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts
```

Expected green result: all prompt service tests pass.

---

## Task 3: Render Generated MCP Docs With Placeholders

**Files:**

- Test/Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`

- [ ] **Step 1: Write failing docs tests for model-facing placeholder rendering**

Add import near the top of `server/src/services/agent-mcp-docs.service.spec.ts`:

```ts
import { agentMcpPromptPlaceholderMap } from 'src/services/agent-mcp-prompt-placeholders';
```

Add this test inside `describe(AgentMcpDocsService.name, () => {`:

```ts
it('renders model-facing docs examples with semantic placeholders instead of fixture UUIDs', () => {
  const markdown = sut.generateMarkdown();

  for (const fixtureId of Object.keys(agentMcpPromptPlaceholderMap)) {
    expect(markdown).not.toContain(fixtureId);
  }

  for (const placeholder of Object.values(agentMcpPromptPlaceholderMap)) {
    expect(markdown).toContain(placeholder);
  }
});
```

Replace the existing test named `parses every marked tool-argument JSON block from the generated Markdown through the referenced DTO schema` with:

````ts
it('renders every marked tool-argument JSON block as parseable JSON after placeholder rendering', () => {
  const markdown = sut.generateMarkdown();
  const blocks = [
    ...markdown.matchAll(
      /<!-- mcp-docs:tool-arguments tool="([^"]+)" example="([^"]+)" -->\n\n```json\n([\s\S]*?)\n```/g,
    ),
  ];

  expect(blocks).toHaveLength(sut.listDocumentedToolArgumentExamples().length);
  for (const [, toolNameValue, , jsonText] of blocks) {
    expect(Object.values(AgentToolName)).toContain(toolNameValue as AgentToolName);
    expect(() => JSON.parse(jsonText)).not.toThrow();
  }
});
````

Keep the existing `exposes structured documented examples that parse through the matching DTO schemas` test unchanged; that is the schema-valid contract-example coverage.

- [ ] **Step 2: Run docs tests and verify they fail because fixture IDs still render**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-docs.service.spec.ts
```

Expected red failure: generated markdown contains fixture UUIDs.

- [ ] **Step 3: Apply placeholders in docs Markdown rendering after schema validation**

Modify imports in `server/src/services/agent-mcp-docs.service.ts`:

```ts
import { renderAgentMcpPromptPlaceholders } from 'src/services/agent-mcp-prompt-placeholders';
```

Replace the current `markdownJson` helper with:

```ts
const markdownJson = (value: unknown): string => `\`\`\`json\n${json(renderAgentMcpPromptPlaceholders(value))}\`\`\``;
```

Keep `listDocumentedToolArgumentExamples()` unchanged. Keep `renderExample()` validating `example.arguments` before calling `markdownJson(example.arguments)`.

- [ ] **Step 4: Run docs tests and verify they pass**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-docs.service.spec.ts
```

Expected green result: docs tests pass.

---

## Task 4: Regenerate Artifacts And Validate Slice 1

**Files:**

- Regenerate: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Regenerate: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Build server so sync scripts use current compiled code**

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

- [ ] **Step 4: Run formatting/type safety checks for touched server files**

Run:

```bash
pnpm --dir server format
pnpm --dir server lint
pnpm --dir server check
git diff --check
```

Expected green result: all commands exit 0.

- [ ] **Step 5: Inspect generated text for Slice 1 requirements**

Run:

```bash
rg -n "00000000-0000-4000-8000-000000000(001|002|010|020|021|030|040|111|222|333)" agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
rg -n "<selectionHandle.id from searchAssets>|<asset-id-from-searchAssets>|<approved-toolCallId>" agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md
```

Expected:

- First command exits 1 with no matches.
- Second command exits 0 and shows placeholder matches in both generated files.

- [ ] **Step 6: Commit Slice 1**

Run:

```bash
git status --short
git add server/src/services/agent-mcp-prompt-placeholders.ts \
  server/src/services/agent-mcp-prompt.service.ts \
  server/src/services/agent-mcp-prompt.service.spec.ts \
  server/src/services/agent-mcp-docs.service.ts \
  server/src/services/agent-mcp-docs.service.spec.ts \
  agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs \
  docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "fix: render Pi MCP examples with safe placeholders"
```

Expected: one commit containing only Slice 1 implementation and generated artifacts.

---

## Plan Self-Review

- TDD order is explicit for helper, prompt output, docs output, and generated artifacts.
- Slice 1 scope is limited to prompt/docs placeholder rendering and contract-example preservation.
- All Slice 1 edge cases are covered:
  - Nested operation arrays: `renderAgentMcpPromptPlaceholders` nested test.
  - Runtime IDs unchanged: helper test.
  - Contract examples not mutated: prompt structured examples test and existing docs structured examples test.
  - Validation-correction examples remain contract-owned: generated docs/prompt rendering only uses cloned values; no contract service mutation is allowed.
  - Generated docs JSON blocks remain parseable JSON while schema validation stays on pre-rendered examples.
- Future slices are not implemented here.
