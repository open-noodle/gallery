# Pi Agent MCP Tool Contracts Design

Status: approved design, pending written spec review
Date: 2026-05-18
Worktree: `/home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm`
Branch: `explore/pi-agent-brainstorm`

## Context

Gallery now exposes the first-party Pi runner tools through a server-owned MCP
endpoint. The current MCP registry derives `inputSchema` from the existing Zod
DTOs, and the runtime prompt gives Pi broad behavioral guidance. That is enough
for capable models, but smaller models still call tools with the wrong shape:

- sending the wrong JSON-RPC wrapper or omitting `params.arguments`;
- mixing new-request fields with approved retry fields, such as `assetIds` and
  `toolCallId`;
- omitting fields that are required by DTO refinements but not obvious from the
  generated JSON Schema;
- using the wrong `targetKind` for an operation type;
- proposing direct write/apply tool calls instead of reviewable operation plans;
- failing to retry approved read tools with the existing `toolCallId`.

The weak point is not only documentation. Important tool rules live in Zod
refinements, service policy, and runner prompt prose. Those rules are validated
correctly, but they are not all visible to the model through the MCP tool
schema. Human docs alone will not reliably help smaller models, because the
model primarily sees the MCP tool list, tool descriptions, tool schemas, and
tool error responses at call time.

## Goals

- Make the MCP tool surface harder for smaller models to misuse.
- Keep the server as the only source of truth for Gallery tool names, schemas,
  examples, descriptions, validation hints, and generated docs.
- Add executable examples for every supported tool and common call mode.
- Improve model-facing validation errors so a model can correct malformed calls
  without guessing.
- Generate human-readable MCP endpoint and tool documentation from the same
  contract used by runtime metadata.
- Preserve the existing permission, approval, plan review, and apply behavior.
- Use test-driven development for each implementation slice.

## Non-Goals

- Do not add new Gallery domain tools in the first implementation.
- Do not add public or third-party MCP support.
- Do not add direct apply or mutation tools.
- Do not bypass Gallery approval UI or operation plan review.
- Do not replace DTO validation with example-only validation.
- Do not rely on hand-written docs as the source of truth.
- Do not change provider selection, session setup UX, or open-noodle
  provisioning in this design.

## Recommended Direction

Add an explicit `AgentMcpToolContract` layer next to the current MCP tool
registry. The contract should describe how a model should call each tool in
terms the model can use directly:

- tool purpose;
- supported argument modes;
- JSON examples that are known to parse;
- required mutual exclusions;
- common mistakes;
- recovery hints for validation errors;
- approval retry behavior;
- safety and non-apply constraints.

The MCP registry should still derive structural validation from Zod DTOs. The
new contract adds model-facing guidance around the structural schema, especially
where Zod refinements cannot be expressed clearly in generated JSON Schema.

This contract becomes the input for four outputs:

1. enriched `tools/list` metadata;
2. actionable `tools/call` validation error payloads;
3. a compact runner prompt cheat sheet;
4. generated human documentation for the MCP endpoint and tools.

## Architecture

```text
Agent DTO Zod schemas
  -> structural JSON Schema

AgentMcpToolContract definitions
  -> descriptions, examples, modes, common mistakes, correction hints

AgentMcpToolRegistryService
  -> MCP tool definitions for tools/list

AgentMcpService
  -> validation errors with model-actionable hints

Agent runner prompt builder
  -> compact tool-use cheat sheet

Docs generator
  -> docs/superpowers/generated/pi-agent-mcp-tools.md
```

The contract must be server-owned. The runner may consume generated prompt text,
but it must not duplicate Gallery tool names, DTO shapes, route paths, or
examples.

## Contract Shape

Use a typed contract for each tool:

```ts
type AgentMcpToolContract = {
  name: AgentToolName;
  title: string;
  description: string;
  usage: string;
  argumentModes: AgentMcpArgumentMode[];
  examples: AgentMcpToolExample[];
  commonMistakes: AgentMcpCommonMistake[];
  approvalRetry?: AgentMcpApprovalRetryContract;
  safety: AgentMcpToolSafetyContract;
};

type AgentMcpArgumentMode = {
  name: string;
  description: string;
  requiredFields: string[];
  forbiddenFields?: string[];
  whenToUse: string;
};

type AgentMcpToolExample = {
  name: string;
  description: string;
  arguments: Record<string, unknown>;
};

type AgentMcpCommonMistake = {
  match: {
    issuePath?: string;
    messageIncludes?: string;
    missingField?: string;
    unexpectedField?: string;
  };
  hint: string;
  exampleName?: string;
};
```

The exact TypeScript names can change during implementation, but the contract
needs these capabilities. It should not embed live IDs in examples. Use stable
placeholder UUIDs that pass UUID validation.

## Tool Guidance Requirements

### Read Tools

Read tools that can start either a new request or retry an approved request
need explicit modes:

- new request mode: provide `assetIds`, `albumId`, search filters, or no fields
  depending on the tool;
- approved retry mode: provide only `toolCallId`;
- never combine `toolCallId` with the original request fields.

Examples:

```json
{
  "assetIds": ["00000000-0000-4000-8000-000000000001"]
}
```

```json
{
  "toolCallId": "00000000-0000-4000-8000-000000000111"
}
```

`searchAssets` needs examples for:

- empty search with default limit;
- bounded date/location search;
- favorites or rating search;
- approved retry with `toolCallId`.

`listAlbums` needs examples for:

- normal call with `{}`;
- approved retry with `toolCallId`.

`readAlbum` needs examples for:

- normal call with `albumId`;
- approved retry with `toolCallId`.

### Planning Tools

Planning tools need examples for supported operations. At minimum:

- create an empty album;
- create an album and add assets using a shared `temporaryTargetId`;
- add assets to an existing album;
- update album details;
- set an album cover;
- create or update spaces when those operations are supported by the current DTO;
- asset batch operations, such as rotate, favorite, archive, add tag, and remove
  tag, when those operations are supported by the current DTO.

Examples must show the correct `type`, `targetKind`, `targetId` or
`temporaryTargetId`, `assetIds`, and `payload` combinations. Examples must avoid
unsupported direct apply behavior.

### Approval Flow

The contract should make the approval flow visible to the model:

1. A read tool may return `status: "approval-required"` with a `toolCall.id`.
2. The assistant should stop that turn.
3. Gallery displays the approval UI and resumes the runner after the user
   decides.
4. If Gallery resumes with an approved result, use that result.
5. If Gallery resumes without an approved result, retry the same tool with
   `{ "toolCallId": "<id>" }`.
6. Do not ask the user to approve in chat and do not create a new request with
   the old arguments.

## Enriched MCP Metadata

`tools/list` should remain valid MCP metadata, but each tool should become more
instructive:

- `description` should include the most important mode rule in one or two
  sentences.
- `inputSchema` should include property descriptions where generated JSON Schema
  allows them.
- `inputSchema.examples` should include valid argument examples from the
  contract when MCP clients tolerate the field.
- Keep tool `inputSchema` as a top-level JSON Schema object without root-level
  unions such as `oneOf`; Pi and OpenAI function calling require object
  parameter schemas. Represent argument modes through descriptions,
  `inputSchema.examples`, and `x-gallery-argumentModes` metadata instead.
- Tool annotations should remain unchanged: read tools are read-only, planning
  tools are not read-only, and no apply tool is exposed.

If a client ignores `examples` or `x-gallery-argumentModes`, the improved
descriptions and validation hints still provide value.

## Validation Error Response

Malformed tool arguments should continue returning an MCP tool result with
`isError: true`, not a JSON-RPC protocol error. The structured error should add
fields designed for model self-correction:

```json
{
  "status": "error",
  "error": "Invalid tool arguments",
  "toolName": "readAssetPreviews",
  "retryable": true,
  "issues": [
    {
      "path": "assetIds",
      "message": "assetIds must be unique",
      "hint": "Provide each asset id once, or retry an approved request with only toolCallId."
    }
  ],
  "expected": "Use either assetIds for a new request or toolCallId for an approved request, not both.",
  "exampleArguments": {
    "assetIds": ["00000000-0000-4000-8000-000000000001"]
  }
}
```

The current `content[0].text` JSON copy must stay in sync with
`structuredContent`, because some Pi MCP integrations still read textual tool
content.

The error payload must not include runner tokens, provider secrets, internal
routes, stack traces, filesystem paths, or raw request bodies beyond the
validated issue paths.

## Generated Documentation

Generate a concise MCP guide from the contract. The generated document should
be committed at `docs/superpowers/generated/pi-agent-mcp-tools.md` and should
cover:

- endpoint URL shape and authentication at a high level;
- JSON-RPC request wrappers for `initialize`, `tools/list`, and `tools/call`;
- one example for each tool and major argument mode;
- approval-required and approved retry flow;
- planning examples for common album workflows;
- common mistakes and how to fix them;
- explicit reminder that no apply tool exists and final writes happen through
  Gallery plan review UI.

The generated docs should be committed so reviewers can read them in GitHub.
Tests should fail when examples in docs drift from DTO validation.

## Runner Prompt Cheat Sheet

The first-party runner prompt should consume a short generated or centrally
owned cheat sheet from the contract. It should stay compact because long prompts
can dilute the task:

- use `mcp_gallery_<toolName>` names in examples, because that is what Pi sees;
- show the approved retry shape;
- show create album and create-plus-add-assets planning examples;
- state that direct apply is unavailable;
- state that validation errors with `exampleArguments` should be retried once
  when the correction is obvious.

The runner should not own or hand-maintain these examples separately.

## Testing Strategy

Implementation must use TDD for every slice:

1. Write or update focused tests for the next visible behavior.
2. Run the focused tests and confirm they fail for the expected reason.
3. Implement the smallest change to make the focused tests pass.
4. Refactor with the same tests green.
5. Run the relevant regression suite before the next slice.

Each implementation plan derived from this spec must name its red, green, and
regression commands before implementation starts. A slice is complete only after
the new focused tests and relevant existing regression suite are green.

### Contract Tests

- every tool has a contract;
- every contract has at least one valid example;
- every example parses through the same Zod schema used by `tools/call`;
- every read tool with approval retry supports a valid `toolCallId` example;
- every example uses stable valid UUID placeholders where IDs are needed;
- no example includes `applyAlbumOperations`, direct mutation routes, tokens, or
  provider secrets;
- every common mistake references a valid example or a clear correction hint.

### MCP Metadata Tests

- `tools/list` still returns exactly the expected Gallery MCP tools;
- enriched descriptions do not include internal URLs, bearer token language, or
  service implementation details;
- input schemas remain object schemas;
- examples added to schemas are valid against DTOs;
- read tool annotations and planning tool annotations remain correct;
- no apply or direct write tool appears in the registry.

### Validation Error Tests

- missing `arguments` returns `isError: true` with `toolName`, `retryable`, and
  an example where possible;
- non-object `arguments` produces a clear correction hint;
- `assetIds` plus `toolCallId` produces a hint to choose one mode;
- missing `assetIds`/`albumId`/`toolCallId` produces the correct mode hint;
- duplicate IDs produce a specific hint;
- invalid UUIDs produce a UUID-specific hint;
- wrong planning `targetKind` produces an operation-specific hint;
- missing `temporaryTargetId` for new album or space dependencies produces a
  dependency hint;
- unknown tool names remain protocol errors;
- service exceptions remain protocol errors without secret leakage.

### Generated Docs Tests

- generated docs are up to date with the contract;
- full JSON-RPC examples for `initialize`, `tools/list`, and `tools/call` parse
  through the MCP request handling path;
- `tools/call` examples use `params.arguments`, not `input`, top-level
  arguments, or another wrapper shape;
- every JSON example block marked as tool arguments parses through the right DTO;
- docs distinguish bare server-owned MCP tool names in JSON-RPC from
  Pi-visible `mcp_gallery_` names in the runner prompt;
- docs include approval retry flow;
- docs include at least one create album and create-plus-add-assets example;
- docs state that apply is not available through MCP;
- docs do not include secrets, bearer tokens, or internal implementation routes
  beyond the documented endpoint shape.

### Runner Prompt Tests

- the runner prompt includes the generated retry guidance;
- the runner prompt includes at least one valid planning example or compact
  reference generated from the contract;
- prompt text uses Pi-visible `mcp_gallery_` tool names;
- prompt text does not drift from contract examples;
- prompt text does not include secrets or internal endpoint details.

### Small-Model Failure Matrix Tests

Add table-driven tests for known malformed calls observed or expected from
smaller models:

- wrapper shape: `arguments` missing, `input` used instead of `arguments`, or
  arguments placed at the wrong level;
- retry shape: `toolCallId` combined with original request fields;
- read shape: missing asset or album IDs;
- planning shape: direct album mutation attempt instead of plan proposal;
- planning shape: new album dependency missing `temporaryTargetId`;
- planning shape: dependent add-assets operation references the wrong temporary
  target;
- planning shape: wrong `targetKind` for album, space, or asset-batch operation;
- search shape: date and location filters placed outside `filters`;
- limits: excessive `limit`, too many IDs, empty arrays, duplicate IDs;
- safety: attempts to call or invent an apply tool.

Each case should assert not only that validation fails, but that the returned
hint gives a smaller model enough information to retry with the correct shape.

## Edge Cases

- MCP clients that ignore non-standard JSON Schema `examples`.
- Zod refinements that cannot be represented in JSON Schema.
- Multiple tools sharing the same field name but needing different hints.
- Planning schemas expanding with new operation types.
- Generated docs getting stale after DTO or contract changes.
- Validation errors with multiple issues where the first issue is not the root
  cause.
- Approval retries where the old request fields are tempting but invalid.
- Tool names with Pi's `mcp_gallery_` prefix in the runner prompt versus bare
  server-owned names in MCP JSON-RPC.
- Examples accidentally using invalid UUID versions.
- Error payloads becoming too verbose and increasing model confusion.

## Vertical Implementation Slices

### Slice 1: Failure Matrix And Contract Skeleton

Create failing tests for known malformed calls and add the typed contract shell
with validated examples for read tools. Keep runtime behavior unchanged until
the tests define the desired correction hints.

### Slice 2: Enriched Validation Errors

Use the contract to add `toolName`, `retryable`, `expected`, `hint`, and
`exampleArguments` to `isError: true` validation results. Preserve JSON-RPC
errors for protocol failures.

### Slice 3: Enriched `tools/list` Metadata

Attach contract usage, property descriptions, examples, and
`x-gallery-argumentModes` metadata without weakening DTO validation, adding
root-level schema unions, or changing tool behavior.

### Slice 4: Planning Examples And Operation Guidance

Add validated examples and mistake hints for album, space, and asset-batch plan
operations. Cover temporary target dependencies and target-kind constraints.

### Slice 5: Generated MCP Guide

Generate and commit human-readable MCP endpoint/tool docs from the contract.
Add tests that docs are up to date and all documented examples parse.

### Slice 6: Runner Prompt Contract Integration

Replace hand-maintained runner tool-shape prose with a compact prompt cheat
sheet generated from or centrally owned by the contract. Add prompt drift tests.

### Slice 7: Evaluation And Hardening

Run the small-model failure matrix against the full MCP service and tighten
hints where models still produce the wrong structure. Keep this slice focused on
evidence from observed failures, not speculative new tool design.

## Success Criteria

- Smaller models receive valid examples in the tool metadata, prompt guidance,
  validation errors, and generated docs.
- Every example is executable as a test fixture against the real DTO schema.
- Validation errors become actionable without exposing internals.
- The runner no longer needs hand-maintained Gallery tool-shape examples.
- Generated docs make endpoint behavior understandable for humans and stay in
  sync with runtime contracts.
- No new apply/direct mutation tool is exposed through MCP.
- Existing MCP, approval, planning, runner, and plan-review behavior remains
  green.
