# Pi Agent Highlight Curation Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the MCP prompt and capability matrix that highlight/best-photo curation is bounded, suggestive, built from existing tools, and not backed by `analyzeAssetQuality` yet.

**Architecture:** This slice changes only contract-facing guidance and docs. The server prompt renderer remains the source of truth, prompt examples continue to validate against existing DTO schemas, and the generated runner prompt module is resynced from the renderer. No curation flow, planner behavior, write operation semantics, UI, or E2E behavior is implemented in this slice.

**Tech Stack:** NestJS/TypeScript server services, Vitest server tests, markdown capability matrix, generated ESM runner prompt module.

---

## Scope Boundaries

This plan implements only Slice 1 from `docs/superpowers/specs/2026-05-26-pi-agent-highlight-curation-design.md`.

In scope:

- Prompt cheat sheet says "best"/"highlights" require a bounded source.
- Prompt cheat sheet says highlight output is a suggestion, not objective scoring.
- Prompt examples selected for the runner include existing search, metadata, preview, and plan tools for highlight-style workflows.
- Prompt/service tests assert no `analyzeAssetQuality` guidance is advertised.
- Capability matrix says bounded highlight curation is planned/behind implementation, not `Solid now`.
- Capability matrix keeps image quality scoring in `Needs New MCP Tool`.

Out of scope:

- No assistant-flow guardrails for unbounded prompts.
- No candidate-count handling.
- No album/favorite/cover highlight write plans.
- No preview-assisted orchestration.
- No UI changes.
- No E2E smoke prompts.

## Files

- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Add failing prompt-contract tests for bounded highlight guidance, selected prompt examples, and `analyzeAssetQuality` absence.
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
  - Select a preview read example for runner prompt validation.
  - Add a compact highlight guidance line to `generatePromptCheatSheet()`.
- Modify: `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`
  - Mark bounded highlight curation as planned/behind implementation, constrained until later slices complete.
- Modify: `server/src/services/agent-capability-matrix.spec.ts`
  - Add regression coverage for the matrix status and quality-scoring non-goal.
- Modify: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - Regenerate from `AgentMcpPromptService.generateAgentRunnerModule()`.

## Task 1: Add Prompt Contract Red Tests

**Files:**

- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Test: `server/src/services/agent-mcp-prompt.service.spec.ts`

- [ ] **Step 1: Add the failing bounded-highlight prompt test**

Near the top of `describe(AgentMcpPromptService.name, () => {`, add a shared prompt length ceiling:

```ts
const maxPromptLength = 4300;
```

Add this test after `it('includes compact visual and technical metadata guidance without direct writes', ...)` in `server/src/services/agent-mcp-prompt.service.spec.ts`:

```ts
it('teaches highlight curation as bounded suggestions without quality scoring', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toMatch(/highlights?.*bounded source/i);
  expect(prompt).toMatch(/best.*highlights?.*album.*space.*date.*search.*selection/i);
  expect(prompt).toMatch(/suggested|recommend/i);
  expect(prompt).toMatch(/not objective|no objective|not .*quality scoring/i);
  expect(prompt).toMatch(/selected assetIds only|selected ids only/i);
  expect(prompt).not.toContain('analyzeAssetQuality');
  expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);
});
```

Also replace the existing `expect(prompt.length).toBeLessThanOrEqual(4200);` prompt-size assertions in this file with `expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);` so all compactness checks share the same final ceiling. The added highlight contract increases the prompt slightly; keep unrelated prompt guidance intact and cap the final generated prompt at 4300 characters.

- [ ] **Step 2: Add the failing selected-example test**

Add this test immediately after the bounded-highlight prompt test:

```ts
it('selects existing search metadata preview and plan examples for highlight curation', () => {
  const examples = sut.listPromptExamples();

  expect(examples).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        toolName: AgentToolName.SearchAssets,
        exampleName: 'visual-curation-candidate-search',
      }),
      expect.objectContaining({
        toolName: AgentToolName.ReadAssetMetadata,
        exampleName: 'read-technical-fields-for-selected-assets',
      }),
      expect.objectContaining({
        toolName: AgentToolName.ReadAssetPreviews,
        exampleName: 'read-selected-assets',
      }),
      expect.objectContaining({
        toolName: AgentToolName.ProposeAlbumOperations,
        exampleName: 'create-album-and-add-assets',
      }),
    ]),
  );
});
```

- [ ] **Step 3: Run the prompt test file and verify the intended red failures**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
```

Expected: FAIL.

Expected failure details:

- `teaches highlight curation as bounded suggestions without quality scoring` fails because the current prompt does not contain the bounded highlight guidance.
- `selects existing search metadata preview and plan examples for highlight curation` fails because `ReadAssetPreviews` / `read-selected-assets` is not in `promptExampleSelections`.

If the `analyzeAssetQuality` absence assertion already passes, leave it in place as a regression guard.

## Task 2: Implement Minimal Prompt Guidance

**Files:**

- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Test: `server/src/services/agent-mcp-prompt.service.spec.ts`

- [ ] **Step 1: Select the existing preview read example**

In `server/src/services/agent-mcp-prompt.service.ts`, add this entry to `promptExampleSelections` after the selected metadata read examples:

```ts
  { toolName: AgentToolName.ReadAssetPreviews, exampleName: 'read-selected-assets' },
```

The surrounding block should become:

```ts
  { toolName: AgentToolName.SearchAssets, exampleName: 'summary-sample-search' },
  { toolName: AgentToolName.SearchAssets, exampleName: 'visual-curation-candidate-search' },
  { toolName: AgentToolName.ReadAssetMetadata, exampleName: 'read-technical-fields-for-selected-assets' },
  { toolName: AgentToolName.ReadAssetMetadata, exampleName: 'approved-retry' },
  { toolName: AgentToolName.ReadAssetPreviews, exampleName: 'read-selected-assets' },
  { toolName: AgentToolName.ListSpaces, exampleName: 'list-visible-spaces' },
```

- [ ] **Step 2: Add compact bounded-highlight guidance**

In `generatePromptCheatSheet()`, replace the current visual curation guidance line:

```ts
        'Visual curation: search ids first, then previews for shortlisted assetIds only.',
```

with this compact version:

```ts
        'Best/highlights require bounded source album/space/date/search/selection; suggested not objective quality scoring; search ids->metadata->preview if allowed; write selected assetIds only.',
```

Do not add `analyzeAssetQuality` anywhere in the generated prompt.

- [ ] **Step 3: Run the prompt test file and verify green except generated-module sync if applicable**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
```

Expected: either PASS or one failure in `keeps the committed runner prompt module in sync with the renderer`.

If the generated-module sync test fails, continue to Task 3.

## Task 3: Sync Generated Runner Prompt

**Files:**

- Modify: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Test: `server/src/services/agent-mcp-prompt.service.spec.ts`

- [ ] **Step 1: Build the server so the sync script uses the updated renderer**

Run:

```bash
pnpm --dir server run build
```

Expected: PASS with Nest build output and no TypeScript errors.

- [ ] **Step 2: Regenerate the committed prompt module**

Run:

```bash
pnpm --dir server run sync:agent-mcp-prompt
```

Expected output:

```text
Wrote agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

- [ ] **Step 3: Re-run the prompt tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
```

Expected: PASS.

## Task 4: Add Capability Matrix Red Test

**Files:**

- Modify: `server/src/services/agent-capability-matrix.spec.ts`
- Test: `server/src/services/agent-capability-matrix.spec.ts`

- [ ] **Step 1: Add a matrix regression test for planned highlight curation**

Append this test inside `describe('Pi agent capability matrix', () => { ... })`:

```ts
it('keeps bounded highlight curation planned while quality scoring remains a new-tool gap', () => {
  const markdown = readMatrix();

  const bestPhotosRow = markdown.split('\n').find((line) => line.includes('“Best photos” curation'));

  expect(bestPhotosRow).toBeDefined();
  expect(bestPhotosRow).toContain('planned implementation');
  expect(bestPhotosRow).toMatch(/Constrained now|behind implementation|not solid/i);
  expect(bestPhotosRow).not.toContain('Solid now');

  const needsNewToolHeadingIndex = markdown.indexOf('## Needs New MCP Tool');
  expect(needsNewToolHeadingIndex).not.toBe(-1);

  const needsNewToolSection = markdown.slice(needsNewToolHeadingIndex);
  expect(needsNewToolSection).toContain('Image quality scoring');
  expect(needsNewToolSection).toContain('analyzeAssetQuality');
  expect(needsNewToolSection).toMatch(/quality scoring/i);
});
```

- [ ] **Step 2: Run the capability matrix test and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-capability-matrix.spec.ts
```

Expected: FAIL because the “Best photos” row does not yet say `planned implementation` or `behind implementation`.

## Task 5: Update Capability Matrix Wording

**Files:**

- Modify: `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`
- Test: `server/src/services/agent-capability-matrix.spec.ts`

- [ ] **Step 1: Mark bounded highlight curation as planned, not solid**

In the `## High-Value Constrained Capabilities` table, replace the “Best photos” curation row:

```md
| “Best photos” curation | Users want the assistant to pick highlights. | Works only across bounded candidates using ratings, favorites, metadata, and previews. | Ask for a scope when broad: album, date range, place, or max count. |
```

with:

```md
| “Best photos” curation | Users want the assistant to pick highlights. | Constrained now and behind planned implementation; works only across bounded candidates using ratings, favorites, metadata, and previews, not quality scoring. | Ask for a scope when broad: album, shared space, date range, search/filter, selection, or max count. |
```

Do not move this row into the `Solid now` core matrix in this slice.

- [ ] **Step 2: Run the capability matrix test and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-capability-matrix.spec.ts
```

Expected: PASS.

## Task 6: Run Focused Verification

**Files:**

- Test: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Test: `server/src/services/agent-capability-matrix.spec.ts`

- [ ] **Step 1: Run both focused server test files together**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-capability-matrix.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Check formatting-sensitive diff issues**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 3: Inspect the final diff for scope creep**

Run:

```bash
git diff -- server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-capability-matrix.spec.ts docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Expected:

- Prompt service changes are limited to one selected example and one compact guidance line.
- Prompt tests cover bounded highlight guidance, existing search/metadata/preview/plan examples, and `analyzeAssetQuality` absence.
- Capability matrix changes keep highlight curation constrained/planned.
- Capability matrix tests keep quality scoring in `Needs New MCP Tool`.
- Generated runner prompt matches the renderer.

## Task 7: Commit Slice 1

**Files:**

- Stage all files modified in this plan.

- [ ] **Step 1: Review git status**

Run:

```bash
git status --short
```

Expected changed files:

```text
 M agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
 M docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md
 M server/src/services/agent-capability-matrix.spec.ts
 M server/src/services/agent-mcp-prompt.service.spec.ts
 M server/src/services/agent-mcp-prompt.service.ts
?? docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-1.md
```

There may also be the prior committed spec work in branch history; do not alter it.

- [ ] **Step 2: Commit**

Run:

```bash
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-1.md server/src/services/agent-capability-matrix.spec.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-prompt.service.ts
git commit -m "docs: plan highlight curation prompt guardrails"
```

Expected: commit succeeds.

This commit contains the Slice 1 plan and implementation together if executed in one pass by subagent-driven development. If the implementer commits the plan before execution, use this second commit message for implementation:

```bash
git commit -m "feat: add highlight curation prompt guardrails"
```

## Self-Review Checklist

- Slice 1 TDD red tests are explicit before implementation.
- The plan does not implement Slice 2 guardrail flow behavior.
- The plan does not implement Slice 3 metadata-only write plans.
- The plan does not implement Slice 4 preview-assisted orchestration or cover selection.
- The plan does not implement Slice 5 UI or sparse apply behavior.
- The plan does not mark highlight curation as solid; that remains for Slice 6.
- The plan keeps `analyzeAssetQuality` unavailable in prompt guidance and present only in the capability matrix's future-tool section.
- All code identifiers and example names exist in the current codebase.
