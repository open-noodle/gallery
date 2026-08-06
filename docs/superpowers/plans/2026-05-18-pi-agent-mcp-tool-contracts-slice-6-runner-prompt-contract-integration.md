# Pi Agent MCP Tool Contracts Slice 6 Runner Prompt Contract Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-maintained Pi runner MCP tool-shape prose with a compact prompt cheat sheet generated from the server-owned MCP tool contract, then wire that generated cheat sheet into the first-party runner prompt with drift tests.

**Architecture:** Add a server-side prompt cheat-sheet renderer that consumes `AgentMcpToolContractService`, validates every embedded example against the same DTO schemas used by MCP `tools/call`, and emits a committed ESM module for `agent-runner`. The runner imports that generated module and appends it to its stable behavioral prompt. The runner keeps product-level behavior guidance, but Gallery MCP tool names, retry shapes, operation examples, and no-apply guidance are owned by the contract renderer.

**Tech Stack:** NestJS injectable services, TypeScript, Zod DTO validation, Node `fs/promises` bin script, committed generated ESM for the Node runner, Node test runner for `agent-runner`, Vitest for server tests.

---

## Scope

This slice implements only `Slice 6: Runner Prompt Contract Integration` from `docs/superpowers/specs/2026-05-18-pi-agent-mcp-tool-contracts-design.md`.

In scope:

- Generate a compact runner prompt cheat sheet from `AgentMcpToolContractService`.
- Use Pi-visible `mcp_gallery_<toolName>` names in the generated runner prompt.
- Include approved retry guidance showing the shape `{ "toolCallId": "<id>" }` and warning not to mix old request fields.
- Include compact create-album and create-plus-add-assets planning examples from the contract.
- State that direct apply/write tools are unavailable and final writes require Gallery plan review.
- State that validation errors with `exampleArguments` should be retried once when the correction is obvious.
- Commit the generated runner prompt module under `agent-runner/src/generated/`.
- Import the generated prompt module from `agent-runner/src/pi-runtime.mjs`.
- Add prompt drift tests that fail when the committed generated module does not match the contract renderer.
- Add integration tests that the runner's actual `systemPrompt` includes the generated cheat sheet.
- Add coverage that the generated prompt lists every current contract tool with Pi-visible `mcp_gallery_` names.
- Add safety tests that the generated prompt does not include bearer tokens, provider secrets, filesystem paths, internal MCP endpoint details, or direct mutation tools.
- Keep the prompt compact with a hard size budget test.

Out of scope:

- Changing MCP runtime behavior, registry metadata, DTO schemas, or docs generation output.
- Adding new Gallery domain tools or new operation types.
- Changing provider/model/session setup UX.
- Public or third-party MCP support.
- Evaluating real small-model performance. That is Slice 7.
- Moving Gallery server code into the runner package at runtime.

## Recommended Implementation Shape

Use a committed generated module instead of making `agent-runner` import server TypeScript:

- `server/src/services/agent-mcp-prompt.service.ts`
  - Owns prompt rendering and example validation.
  - Depends on `AgentMcpToolContractService`.
  - Exposes structured prompt examples for tests.
- `server/src/bin/sync-agent-mcp-prompt.ts`
  - Builds the committed runner module.
- `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - Generated file exporting `galleryMcpPromptCheatSheet`.
  - Imported by `agent-runner/src/pi-runtime.mjs`.

This keeps the server contract as source of truth while preserving runner packaging. The runner image can continue to run without server source files present.

## TDD Commands

Red commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
pnpm --dir agent-runner test
```

Green commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
pnpm --dir agent-runner test
```

Regression commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir server run format
pnpm --dir agent-runner test
```

Generation command:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-prompt
git diff --exit-code -- agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Optional combined generation check after Slice 6:

```bash
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
git diff --exit-code -- docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

## File Structure

Create:

- `server/src/services/agent-mcp-prompt.service.ts`
  - Pure renderer for runner prompt cheat-sheet text and generated ESM module text.
- `server/src/services/agent-mcp-prompt.service.spec.ts`
  - TDD coverage for prompt content, prefixing, example validity, compactness, drift, and safety.
- `server/src/bin/sync-agent-mcp-prompt.ts`
  - Writes `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`.
- `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - Generated module committed to the repo.

Modify:

- `server/package.json`
  - Add `sync:agent-mcp-prompt`.
- `agent-runner/src/pi-runtime.mjs`
  - Import `galleryMcpPromptCheatSheet` and include it in `systemPrompt`.
  - Remove or shrink duplicated MCP tool-shape prose that is now generated.
- `agent-runner/src/pi-runtime.test.mjs`
  - Assert the constructed Pi resource loader prompt includes the generated cheat sheet.
  - Assert the prompt still includes non-contract behavioral guidance that should remain runner-owned.

Do not modify:

- `server/src/dtos/agent-operation.dto.ts`
- `server/src/dtos/agent-tool.dto.ts`
- `server/src/services/agent-mcp.service.ts`
- `server/src/services/agent-mcp-tool-registry.service.ts`
- `server/src/services/agent-mcp-tool-contract.service.ts`
- `docs/superpowers/generated/pi-agent-mcp-tools.md`, except if a shared sanitizer refactor changes formatting and Slice 5 drift tests stay green.

## Slice 6 Edge Case Matrix

| Area                | Case                                              | Expected Slice 6 Result                                                                                         |
| ------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Drift               | Contract examples change                          | Server drift test fails until `sync:agent-mcp-prompt` updates the generated runner module                       |
| Tool coverage       | Contract gains a tool                             | Generated prompt lists the new `mcp_gallery_<toolName>` name or a test fails                                    |
| Runtime integration | Runner creates a Pi session                       | `DefaultResourceLoader` receives a `systemPrompt` containing `galleryMcpPromptCheatSheet`                       |
| Prefix clarity      | Prompt examples mention tools                     | Uses `mcp_gallery_<toolName>` names, not bare server-owned MCP names                                            |
| Retry shape         | Approved read retry                               | Prompt shows only `toolCallId` and explicitly forbids mixing original request fields                            |
| Planning            | Create empty album                                | Prompt includes a valid contract-backed `album.create` example                                                  |
| Planning            | Create album and add assets                       | Prompt includes a valid contract-backed `temporaryTargetId` dependency example                                  |
| Validation recovery | Tool validation error includes `exampleArguments` | Prompt says to retry once when correction is obvious                                                            |
| Direct apply        | Model may invent apply tool                       | Prompt states no direct apply/write tool exists and writes happen only through plan review                      |
| Safety              | Generated prompt content                          | No real bearer tokens, provider credentials, filesystem paths, stack traces, or internal endpoint URLs          |
| Compactness         | Contract grows                                    | Prompt renderer keeps the cheat sheet under a defined size budget and uses selected examples, not every example |
| Packaging           | Runner image runs without server source           | Runner imports committed generated `.mjs`, not server TypeScript                                                |
| Escaping            | Prompt includes quotes/backticks/JSON             | Generated ESM module round-trips through dynamic import and exports exact text                                  |
| Existing UX         | MCP unavailable                                   | No runner capability behavior changes beyond prompt text                                                        |

---

### Task 1: Add Prompt Renderer Red Tests

**Files:**

- Create: `server/src/services/agent-mcp-prompt.service.spec.ts`

- [x] **Step 1: Define focused prompt renderer tests before implementation**

Create tests that instantiate `AgentMcpToolContractService` and a missing `AgentMcpPromptService`.

Required tests:

- `generates a compact runner cheat sheet from the contract`
  - Asserts header text like `Gallery MCP tool-use cheat sheet`.
  - Asserts length is under a conservative budget, for example `<= 3000` characters.
  - Asserts prompt includes `mcp_gallery_searchAssets`, `mcp_gallery_readAssetMetadata`, and `mcp_gallery_proposeAlbumOperations`.
- `uses Pi-visible tool names and does not use bare tool-call names as instructions`
  - For each contract, assert the generated tool list contains `mcp_gallery_${contract.name}`.
  - Assert runner-action phrases use Pi-visible names, for example `call mcp_gallery_proposeAlbumOperations`.
  - Assert bare action phrases like `call proposeAlbumOperations` are absent.
- `includes approval retry guidance from contract-owned read tool modes`
  - Asserts the prompt includes `toolCallId`.
  - Asserts it says retry uses only `toolCallId`.
  - Asserts it says not to combine `toolCallId` with old request fields.
- `includes create album and create-plus-add-assets planning examples`
  - Asserts examples include `album.create`, `album.addAssets`, and `temporaryTargetId`.
  - Asserts these examples come from the contract example names, not hand-written test fixtures.
- `documents validation-error recovery`
  - Asserts the prompt mentions `exampleArguments`.
  - Asserts the prompt says to retry once only when the correction is obvious.
- `does not expose direct apply or unsafe implementation details`
  - Reject bearer-looking tokens, `provider-key`, `stack trace`, absolute filesystem paths, `/agent/internal/mcp`, `applyAlbumOperations`, `applyOperations`, direct route names, and generated tool names beginning with `mcp_gallery_apply`.
  - Reject broad direct-mutation tool names, including generated names containing `apply`, `execute`, `mutate`, `write`, `delete`, `destroy`, or `directWrite`.
- `exports a generated ESM module that round-trips exact prompt text`
  - Calls a renderer method such as `generateAgentRunnerModule()`.
  - Verifies it contains a generated-file warning and `export const galleryMcpPromptCheatSheet =`.
  - Writes/imports through a temp file or parses the string safely enough to prove escaping is correct.
- `keeps the committed runner prompt module in sync with the renderer`
  - Reads `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`.
  - Compares it to `sut.generateAgentRunnerModule()`.
  - This should fail red because the generated module does not exist yet.

- [x] **Step 2: Add example parsing assertions**

Validate examples through structured renderer output, not by adding test-only markers to the model-facing prompt. The renderer should expose the selected examples through `listPromptExamples()`:

```ts
type AgentMcpPromptExample = {
  toolName: AgentToolName;
  piToolName: `mcp_gallery_${string}`;
  exampleName: string;
  arguments: Record<string, unknown>;
};
```

Tests should validate every returned example through:

- `AgentReadToolRequestSchemas` for read tools.
- `AgentOperationPlanToolRequestSchemas` for planning tools.

The rendered prompt may include JSON fences for model guidance, but it must not include HTML comments or test-only marker prose. This keeps the prompt compact and avoids exposing test harness syntax to smaller models.

- [x] **Step 3: Run red tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
```

Expected failure:

- Import failure for `AgentMcpPromptService`, or missing generated module once the service shell exists.
- No production behavior should be changed before observing this red state.

Do not commit after this task. These red tests are the implementation target for Tasks 2 and 3.

---

### Task 2: Implement Contract-Backed Prompt Renderer

**Files:**

- Create: `server/src/services/agent-mcp-prompt.service.ts`
- Modify if useful: `server/src/services/agent-mcp-docs.service.ts`

- [x] **Step 1: Add the renderer service**

Implement `AgentMcpPromptService` with methods along these lines:

- `generatePromptCheatSheet(): string`
- `generateAgentRunnerModule(): string`
- `listPromptExamples(): AgentMcpPromptExample[]`

Renderer rules:

- Pull all tool names, descriptions, modes, examples, and mistake hints from `AgentMcpToolContractService`.
- Prefix tool names as `mcp_gallery_${contract.name}` in runner-facing prose.
- Use selected examples only:
  - one read example that demonstrates a normal call;
  - one approved retry example with only `toolCallId`;
  - `create-empty-album`;
  - `create-album-and-add-assets`;
  - optionally one `reviseProposedOperations` or `summarizePlan` example if compactness remains within budget.
- Validate selected examples against the same DTO schemas before rendering.
- Throw a clear error if required examples are missing from the contract.
- Sanitize output using a shared or equivalent pattern for:
  - bearer-looking tokens;
  - provider credential labels;
  - stack traces;
  - absolute filesystem paths;
  - internal endpoint paths beyond what belongs in generated human docs.

- [x] **Step 2: Keep prompt shape compact and model-usable**

The generated text should be concise and direct. It should include:

- tool list with Pi-visible names;
- read approval retry rule;
- two small JSON argument examples;
- planning examples for album create and create-plus-add-assets;
- validation retry rule;
- no-direct-apply rule.

Do not generate the full human docs. The prompt is for model behavior, not reviewer documentation.

- [x] **Step 3: Run focused server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
```

Expected result:

- All renderer content, structured example, compactness, and safety tests pass.
- If the committed generated module drift test was added in Task 1, that one test may still fail until Task 3 creates the generated file.

Do not commit while any focused test remains red. Either carry these changes into Task 3, or keep the generated-module drift test out of the focused run until the generated file exists.

---

### Task 3: Add Sync Script And Generated Runner Module

**Files:**

- Create: `server/src/bin/sync-agent-mcp-prompt.ts`
- Create: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Modify: `server/package.json`

- [x] **Step 1: Add a server sync script**

Create a Node script that:

- Instantiates `AgentMcpToolContractService`.
- Instantiates `AgentMcpPromptService`.
- Writes `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`.
- Creates the generated directory if needed.
- Logs the generated relative path.

Add package script:

```json
"sync:agent-mcp-prompt": "node ./dist/bin/sync-agent-mcp-prompt.js"
```

- [x] **Step 2: Generate the committed runner module**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-prompt
```

Expected generated module properties:

- Generated warning at the top.
- ESM export named `galleryMcpPromptCheatSheet`.
- No imports.
- Stable trailing newline.

- [x] **Step 3: Re-run drift and safety tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
git diff --exit-code -- agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

The `git diff --exit-code` command should be run after regeneration from a clean generated file. It should pass when the committed generated file matches the renderer.

Commit:

```bash
git add server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/bin/sync-agent-mcp-prompt.ts server/package.json agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
git commit -m "$(cat <<'EOF'
feat(agent-runner): generate mcp prompt cheat sheet
EOF
)"
```

---

### Task 4: Wire Generated Prompt Into Pi Runtime

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`

- [x] **Step 1: Add runner red tests**

Update `agent-runner/src/pi-runtime.test.mjs`:

- Import `galleryMcpPromptCheatSheet` from `./generated/gallery-mcp-prompt-cheat-sheet.mjs`.
- In the existing resource loader prompt test, assert:
  - `calls.loaders[0].systemPrompt.includes(galleryMcpPromptCheatSheet)` is true.
  - prompt includes generated `mcp_gallery_` tool names.
  - prompt includes generated approved retry text.
  - prompt includes generated planning example text.
  - prompt does not include bare `call proposeAlbumOperations`.
  - prompt still includes runner-owned behavior guidance such as:
    - metadata-only trip album behavior;
    - factual album/photo questions require read tools;
    - staying inside Gallery instead of redirecting to other apps.

Run:

```bash
pnpm --dir agent-runner test
```

Expected failure:

- The generated module may import successfully, but the runtime prompt will not include it yet.

- [x] **Step 2: Import and append the generated cheat sheet**

In `agent-runner/src/pi-runtime.mjs`:

- Import:

```js
import { galleryMcpPromptCheatSheet } from './generated/gallery-mcp-prompt-cheat-sheet.mjs';
```

- Keep stable runner-owned product behavior instructions in `systemPrompt`.
- Replace duplicated contract-owned tool-shape lines with the generated cheat sheet.
- Ensure the final prompt still starts with `You are Gallery Assistant`.

Suggested structure:

```js
const runnerBehaviorPrompt = [
  'You are Gallery Assistant, a personal photo organization assistant.',
  // runner-owned behavior only
].join('\n');

const systemPrompt = [runnerBehaviorPrompt, galleryMcpPromptCheatSheet].join('\n\n');
```

- [x] **Step 3: Run runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected result:

- Existing runner session, MCP config, approval resume, busy streaming, and sanitization tests remain green.
- Prompt test verifies the generated guidance is included.

Commit:

```bash
git add agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs
git commit -m "$(cat <<'EOF'
feat(agent-runner): use generated mcp prompt guidance
EOF
)"
```

---

### Task 5: Regression And Drift Sweep

**Files:**

- No planned production edits unless tests expose issues.

- [x] **Step 1: Run full focused server MCP regression**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts
```

- [x] **Step 2: Run runner regression**

Run:

```bash
pnpm --dir agent-runner test
```

- [x] **Step 3: Run server gates**

Run:

```bash
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir server run format
```

- [x] **Step 4: Verify generation is reproducible**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
git diff --exit-code -- docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

- [x] **Step 5: Run safety scans**

Run:

```bash
rg -n "bearer [a-z0-9._-]{10,}|provider[- ]?key|stack trace|/(srv|home|tmp|var|etc|opt|mnt|Users)/|/agent/internal/mcp|applyAlbumOperations|applyOperations|mcp_gallery_apply" agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Expected:

- No matches.

Commit any fixes:

```bash
git add server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/bin/sync-agent-mcp-prompt.ts server/package.json agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs
git commit -m "$(cat <<'EOF'
fix(agent-runner): harden generated mcp prompt integration
EOF
)"
```

---

## Acceptance Checklist

- [x] Slice 6 uses TDD: red tests are observed before implementation, then made green.
- [x] Runner prompt tool-shape guidance is generated from or centrally owned by `AgentMcpToolContractService`.
- [x] The committed generated runner module is drift-tested against the renderer.
- [x] The runner imports the generated module and includes it in the actual Pi `systemPrompt`.
- [x] Prompt examples use Pi-visible `mcp_gallery_` names.
- [x] The generated prompt lists every current contract tool with Pi-visible `mcp_gallery_` names.
- [x] Structured prompt examples parse through the real DTO schemas.
- [x] Approved retry guidance uses only `toolCallId` and forbids mixing old request fields.
- [x] Planning examples include create album and create-plus-add-assets with `temporaryTargetId`.
- [x] Prompt states direct apply/write tools are unavailable through MCP.
- [x] Prompt states obvious validation errors with `exampleArguments` should be retried once.
- [x] Prompt remains compact under the configured size budget.
- [x] No secrets, bearer tokens, provider credentials, filesystem paths, stack traces, or internal MCP endpoint details leak into the generated runner prompt.
- [x] Existing MCP docs, contract, registry, runtime, controller, DTO, and runner tests remain green.
- [x] Re-running generation produces no diff.

## Review Notes For Implementers

- Prefer a generated committed `.mjs` artifact over cross-package runtime imports. This keeps Docker/runtime packaging simple.
- Do not duplicate tool examples in `agent-runner/src/pi-runtime.mjs`; add them to `AgentMcpToolContractService` first if the prompt needs them.
- Keep runner-owned behavioral policy separate from contract-owned tool-shape guidance. The trip-album heuristics and "stay inside Gallery" instructions belong in the runner prompt; DTO-shaped examples and retry mechanics belong in the generated cheat sheet.
- If the prompt budget test fails, reduce prose or examples before increasing the budget. The spec explicitly calls out long prompts as a risk.
