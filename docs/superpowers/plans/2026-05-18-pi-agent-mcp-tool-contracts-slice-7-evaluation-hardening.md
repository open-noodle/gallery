# Pi Agent MCP Tool Contracts Slice 7 Evaluation And Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the full small-model malformed-call failure matrix through the real Gallery MCP service and harden correction hints only where the matrix shows weak or missing guidance.

**Architecture:** Promote the existing Slice 1 read matrix and Slice 4 planning matrix into a single contract-owned runtime failure matrix, add the remaining malformed-call cases required by the design, and execute every case through `AgentMcpService.handle()`. Validation failures must return model-actionable `isError` tool results; protocol failures must remain JSON-RPC errors. Any hint changes stay in `AgentMcpToolContractService` so `tools/list`, validation errors, docs, and runner prompt remain contract-owned and drift-tested.

**Tech Stack:** NestJS injectable services, Vitest, existing MCP `AgentMcpService`, existing Zod DTO schemas, existing generated docs and generated runner prompt sync commands.

---

## Scope

This slice implements only `Slice 7: Evaluation And Hardening` from `docs/superpowers/specs/2026-05-18-pi-agent-mcp-tool-contracts-design.md`.

In scope:

- Add a full small-model runtime failure matrix exposed by `AgentMcpToolContractService`.
- Include all existing Slice 1 read-tool cases and Slice 4 planning cases.
- Add missing design-required cases for:
  - request wrapper mistakes: missing `arguments`, `input` instead of `arguments`, and top-level `arguments`;
  - retry mistakes: `toolCallId` combined with original request fields;
  - read shape mistakes: missing asset/album ids, empty arrays, duplicate ids, invalid UUIDs, too many ids;
  - search shape mistakes: date/location/favorite/rating filters outside `filters`;
  - planning direct-mutation attempts instead of reviewable plans;
  - planning dependencies where a dependent operation references a missing or mismatched `temporaryTargetId`;
  - wrong `targetKind` for album, space, asset-batch, and image-edit operations;
  - invalid planning payloads;
  - prefixed Pi-visible tool names incorrectly sent as bare MCP JSON-RPC tool names;
  - invented apply/direct-write tools.
- Run every matrix case through the full `AgentMcpService.handle()` path with the real registry, contract service, and mocked downstream domain services.
- Assert tool-validation cases return actionable `structuredContent` and matching `content[0].text`.
- Assert protocol-error cases remain protocol errors and do not call downstream tools.
- Harden only observed weak hints or matching gaps revealed by the matrix.
- Regenerate generated MCP docs and generated runner prompt if contract text changes.

Out of scope:

- Calling real LLMs or external providers.
- Adding new Gallery tools, operation types, or apply/direct mutation capabilities.
- Changing DTO schemas unless an existing validation path is demonstrably wrong.
- Changing frontend Assistant UI.
- Changing runner prompt structure beyond regenerated prompt output from contract changes.
- Public or third-party MCP support.

## TDD Commands

Red commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Green commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Regression commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir server run format
pnpm --dir agent-runner test
```

Generation drift command:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
git diff --exit-code -- docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

## File Structure

Likely modify:

- `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add full Slice 7 failure matrix and combined accessor.
  - Add or tighten common mistake hints only where tests show gaps.
- `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add matrix completeness, uniqueness, mistake-linking, and coverage tests.
- `server/src/services/agent-mcp.service.spec.ts`
  - Add full service-level matrix evaluation tests.
- `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - Regenerate only if contract hints/examples change.
- `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - Regenerate only if contract hints/examples used by the prompt change.

Do not modify:

- `server/src/dtos/agent-operation.dto.ts`
- `server/src/dtos/agent-tool.dto.ts`
- `server/src/services/agent-mcp-tool-registry.service.ts`
- `server/src/services/agent-mcp-docs.service.ts`
- `server/src/services/agent-mcp-prompt.service.ts`
- `agent-runner/src/pi-runtime.mjs`
- `agent-runner/src/pi-runtime.test.mjs`

If a test failure appears to require one of the do-not-modify files, stop and explain why before expanding the slice.

## Slice 7 Edge Case Matrix

| Area                     | Case                                                                                                          | Expected Slice 7 Result                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrapper                  | `params.input` used instead of `params.arguments`                                                             | `isError: true`, hint says to use `params.arguments`, no downstream service calls                                                                               |
| Wrapper                  | `arguments` at request root                                                                                   | `isError: true`, hint says to put tool arguments under `params.arguments`                                                                                       |
| Wrapper                  | `params.arguments` is array/string/null                                                                       | `isError: true`, hint says arguments must be a JSON object                                                                                                      |
| Retry                    | `toolCallId` combined with `assetIds`, `albumId`, `filters`, or `limit`                                       | Hint says choose new request fields or approved retry, not both                                                                                                 |
| Read                     | Missing `assetIds`/`albumId`/`toolCallId`                                                                     | Hint identifies the valid modes and returns a valid example                                                                                                     |
| Read limits              | Empty arrays, duplicate ids, invalid UUIDs, too many ids                                                      | Specific hint for the failing condition and valid example arguments                                                                                             |
| Search                   | Date/location/favorite/rating filters at root                                                                 | Hint says filters belong inside `filters`                                                                                                                       |
| Search                   | Excessive `limit`                                                                                             | Hint says max allowed limit and returns bounded example                                                                                                         |
| Planning wrapper         | Missing or wrong planning `arguments`                                                                         | Hint says to use `params.arguments` and reviewable plan shape                                                                                                   |
| Planning direct mutation | `createAlbum`, `addAssetsToAlbum`, `applyAlbumOperations`, or `mcp_gallery_apply...`                          | Protocol error, no domain service calls, no direct mutation tool exposed                                                                                        |
| Planning dependency      | Add/set-cover operation references missing `temporaryTargetId`                                                | Hint says create the new album/space first and reuse the same `temporaryTargetId`                                                                               |
| Planning dependency      | Dependent operation references the wrong temporary target kind                                                | Hint explains album dependencies require album create, space dependencies require space create                                                                  |
| Planning target kind     | Album operation targets a space, space operation targets an album, asset-batch/image-edit targets album/space | Operation-specific target-kind hint                                                                                                                             |
| Planning payload         | Duplicate asset ids, invalid rotate angle, ambiguous tag payload                                              | Payload-specific hint and valid example arguments                                                                                                               |
| Prefix clarity           | Pi-visible `mcp_gallery_<toolName>` sent as JSON-RPC `params.name`                                            | Protocol error, no service calls, and the prefixed name is not accepted; bare-name guidance may be added only if it falls out of existing unknown-tool handling |
| Multiple issues          | First Zod issue is not the most helpful root cause                                                            | Correction lookup selects the most specific contract mistake                                                                                                    |
| Safety                   | Error payload contains malformed input with tokens/routes/files                                               | Structured and text payloads contain no secrets or internals                                                                                                    |
| Payload size             | Representative validation payload has multiple issues or long invalid input                                   | `expected`, `hint`, issues, and serialized payload stay compact enough for a smaller model to retry                                                             |
| Text sync                | Any validation error                                                                                          | `content[0].text === JSON.stringify(structuredContent)`                                                                                                         |

---

### Task 1: Add Full Matrix Contract Red Tests

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Add failing tests for the combined matrix accessor**

Add tests that expect a new method, for example:

```ts
const cases = sut.listRuntimeFailureMatrixCases();
```

Required assertions:

- It returns all existing `listSlice1RuntimeFailureMatrixCases()` and `listSlice4PlanningFailureMatrixCases()` ids.
- Every id is unique.
- Every case has a category, description, request, and expected result.
- Every `tool-validation` case has `toolName`.
- Every `tool-validation` case has `expectedContractMistakeId`.
- Every `protocol-error` case has no expected contract mistake id.
- Every design-required category is present:
  - `request-wrapper`
  - `read-retry`
  - `read-request`
  - `album-read`
  - `search`
  - `safety`
  - `planning-wrapper`
  - `planning-dependency`
  - `planning-target`
  - `planning-payload`
  - `planning-safety`

- [ ] **Step 2: Add failing tests for missing Slice 7 cases**

Assert the matrix includes explicit ids for new hardening cases:

- `pi-prefixed-search-tool-name`
- `pi-prefixed-planning-tool-name`
- `invented-prefixed-apply-tool`
- `planning-dependent-add-assets-wrong-temporary-target-kind`
- `planning-dependent-set-cover-missing-new-album`
- `planning-direct-add-assets-tool`
- `search-root-taken-after-filter`
- `search-root-favorite-rating-filters`

Use exact ids so future removals are intentional.

- [ ] **Step 3: Add mistake-linking tests**

For every `tool-validation` case:

- Find the matching read or planning contract by `toolName`.
- Assert `expectedContractMistakeId` exists in `contract.commonMistakes`.
- Assert that mistake has a nonempty hint.
- If the mistake references `exampleName`, assert that example exists and parses through the right DTO schema.

- [ ] **Step 4: Run red contract tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected failure:

- `listRuntimeFailureMatrixCases()` does not exist or new Slice 7 ids are missing.

Do not implement runtime behavior before observing this red state.

---

### Task 2: Add Full MCP Service Matrix Red Tests

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add a full-matrix runtime describe block**

Add a new describe block after the existing Slice 1 and Slice 4 matrix coverage:

```ts
describe('slice 7 full small-model failure matrix', () => {
  const fullMatrix = new AgentMcpToolContractService().listRuntimeFailureMatrixCases();
});
```

For every `tool-validation` case, call:

```ts
const response = await sut.handle(auth, sessionId, failureCase.request);
```

Assert:

- response is a successful JSON-RPC tool result;
- `result.isError === true`;
- `structuredContent.status === 'error'`;
- `structuredContent.error === 'Invalid tool arguments'`;
- `structuredContent.toolName === failureCase.toolName`;
- `structuredContent.retryable === true`;
- `structuredContent.issues` contains `expectedIssuePath`;
- the issue matching `expectedIssuePath` has a nonempty `hint` when the selected correction targets that path;
- `structuredContent.expected` and `structuredContent.hint` are nonempty and actionable;
- `structuredContent.exampleArguments` is an object;
- `content[0].text` is exactly `JSON.stringify(structuredContent)`;
- `structuredContent.expected.length <= 500`;
- `structuredContent.hint.length <= 500`;
- `JSON.stringify(structuredContent).length <= 5000`;
- no read, planning, or summary service mock was called.

- [ ] **Step 2: Add protocol-error matrix tests**

For every `protocol-error` case, assert:

- response has `error.message` containing `expectedErrorMessage`;
- response does not include `result`;
- no downstream read/planning service mock was called;
- response does not leak tokens, provider credentials, raw filesystem paths, or internal routes.
- `JSON.stringify(response.error).length <= 1000`.

- [ ] **Step 3: Add representative actionable-hint expectations**

Add table-driven expectations for the most important categories:

- wrapper mistakes include `params.arguments`;
- non-object arguments include `JSON object`;
- retry mixes include `not both` or `only toolCallId`;
- root search filters include `inside the filters object`;
- missing temporary targets include `Create the new album or space first`;
- wrong target kinds include the correct target kind name;
- invalid rotate angle includes valid rotate angles;
- ambiguous tag payload includes `tagId` or `tagName`, not both;
- Pi-prefixed bare MCP names produce protocol errors mentioning bare server MCP names if that hint is implemented, otherwise at least `Unknown tool`.
- representative multi-issue payloads stay within the compact-size budget from Step 1.

- [ ] **Step 4: Add safety assertions**

Serialize every validation `structuredContent` and every protocol error. Assert no match for:

```regex
bearer\s+[a-z0-9._-]{10,}|provider[- ]?key|stack trace|/(srv|home|tmp|var|etc|opt|mnt|Users)/|/agent/internal/mcp|sk-[a-z0-9_-]+
```

- [ ] **Step 5: Run red runtime tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected failure:

- Missing combined matrix accessor, missing new Slice 7 cases, or weak hints for new cases.

---

### Task 3: Implement Full Matrix And Missing Cases

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify if required by tests: `server/src/types/agent-mcp-contract.types.ts`

- [ ] **Step 1: Add combined matrix accessor**

Add:

```ts
listRuntimeFailureMatrixCases(): AgentMcpFailureMatrixCase[] {
  return structuredClone([
    ...slice1RuntimeFailureMatrixCases,
    ...slice4PlanningFailureMatrixCases,
    ...slice7HardeningFailureMatrixCases,
  ]);
}
```

Keep `listSlice1RuntimeFailureMatrixCases()` and `listSlice4PlanningFailureMatrixCases()` intact for existing tests.

- [ ] **Step 2: Add Slice 7 hardening cases**

Add `slice7HardeningFailureMatrixCases` with only cases missing from the existing matrices.

Use existing helpers:

- `toolCallRequest()`
- `toolCallRequestWithParams()`
- existing placeholder UUID constants.

Do not add speculative new domain operation types.

- [ ] **Step 3: Add or tighten common mistakes only when required**

If a new `tool-validation` case does not map to a current common mistake:

- add a targeted `commonMistakes` entry to the existing relevant contract;
- set `exampleName` to an existing valid example whenever possible;
- keep hints concise and retry-oriented.

Examples:

- wrong dependency kind should point to the temporary target dependency example;
- root search filters should reuse bounded search example;
- ambiguous tag payload should point to tag examples.

- [ ] **Step 4: Keep protocol errors as protocol errors**

Do not convert unknown tools, direct apply tools, or Pi-prefixed JSON-RPC tool names into tool-validation results. The spec requires unknown tool names to remain protocol errors.

- [ ] **Step 5: Run contract tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected result:

- Full matrix contract tests pass.

---

### Task 4: Harden Runtime Hint Selection From Evidence

**Files:**

- Modify only if tests fail:
  - `server/src/services/agent-mcp-tool-contract.service.ts`
  - `server/src/services/agent-mcp.service.ts`

- [ ] **Step 1: Run runtime tests and inspect failures**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

For each failing full-matrix case, classify the cause:

- missing common mistake;
- common mistake match too broad or too narrow;
- first Zod issue hides the better issue;
- fallback hint not actionable enough;
- protocol error expectation wrong.

- [ ] **Step 2: Prefer contract fixes over runtime branching**

Make the smallest contract change that fixes the observed case:

- adjust `match.issuePath`;
- add `messageIncludes`;
- add `unexpectedField` or `unexpectedFields`;
- set a better `exampleName`;
- update hint text.

Only modify `AgentMcpService` if the runtime is not passing the right request-shape or issues into the contract correction lookup.

- [ ] **Step 3: Preserve payload shape**

Validation errors must keep:

- `status`
- `error`
- `toolName`
- `retryable`
- `issues`
- `expected`
- `hint`
- `exampleArguments`

The textual content must remain synchronized with `structuredContent`.

- [ ] **Step 4: Run runtime tests green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected result:

- Full matrix, existing Slice 1, existing Slice 4, malformed arguments, protocol error, and service exception tests pass.

---

### Task 5: Regenerate Contract Outputs If Hints Changed

**Files:**

- Modify if regenerated:
  - `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

- [ ] **Step 1: Build and regenerate**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
```

- [ ] **Step 2: Run drift tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts
git diff --exit-code -- docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

If the generated outputs changed because contract hints changed, commit those generated diffs with the implementation. The `git diff --exit-code` command should be run after the generated files are staged or after confirming they are the intended committed state.

- [ ] **Step 3: Run safety scans**

Run:

```bash
rg -n "bearer [a-z0-9._-]{10,}|provider[- ]?key|stack trace|/(srv|home|tmp|var|etc|opt|mnt|Users)/|/agent/internal/mcp|applyAlbumOperations|applyOperations|mcp_gallery_apply" docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Expected:

- No matches.

---

### Task 6: Regression Sweep

**Files:**

- No planned production edits unless tests expose issues.

- [ ] **Step 1: Run full focused MCP regression**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts
```

- [ ] **Step 2: Run gates**

Run:

```bash
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir server run format
pnpm --dir agent-runner test
```

- [ ] **Step 3: Verify no accidental runtime behavior changes**

Review diff and confirm:

- no new MCP tools were added;
- no apply/direct write tools were exposed;
- unknown tools still return protocol errors;
- valid read/planning calls still use existing service paths;
- generated docs/prompt changes, if any, only reflect contract hint/example changes.

---

## Acceptance Checklist

- [ ] Slice 7 uses TDD: red contract and runtime matrix tests are observed before implementation.
- [ ] A full small-model runtime matrix exists and combines existing Slice 1 and Slice 4 cases.
- [ ] The matrix includes all design-required malformed-call categories.
- [ ] Every `tool-validation` case is exercised through `AgentMcpService.handle()`.
- [ ] Every `tool-validation` result includes actionable `expected`, `hint`, issue hints, and valid `exampleArguments`.
- [ ] Every validation text payload stays synchronized with `structuredContent`.
- [ ] Validation and protocol error payloads stay compact enough for smaller models to use without confusion.
- [ ] Protocol-error cases remain protocol errors and do not call downstream services.
- [ ] Unknown tools, Pi-prefixed JSON-RPC names, and invented apply/direct mutation tools do not become valid tools.
- [ ] No validation or protocol error leaks tokens, provider credentials, stack traces, internal routes, filesystem paths, or raw secret-bearing request bodies.
- [ ] Common-mistake matching is hardened only for observed matrix gaps.
- [ ] Generated docs and generated runner prompt are regenerated if contract hint/example text changes.
- [ ] Focused MCP regression, server gates, and runner tests are green.

## Implementation Notes

- This slice is an evaluation and hardening pass, not a feature expansion.
- Prefer adding matrix cases and contract hints over adding runtime special cases.
- Keep hints short. The goal is enough information for a smaller model to retry with the correct shape, not full documentation.
- Avoid using real model output fixtures unless the observed malformed call has been reduced to a deterministic JSON-RPC request.
