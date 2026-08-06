# Pi Agent Gallery MCP Server Design

Status: approved design, pending written spec review
Date: 2026-05-16
Worktree: `/home/pierre/dev/gallery/.worktrees/pi-mcp-server-design`
Branch: `pi-mcp-server-design-pr`

## Problem

The current Pi agent PR already implements a substantial first-party assistant:

- encrypted provider credentials;
- personal agent sessions;
- persisted chat messages;
- a first-party `agent-runner` sidecar;
- Pi runtime integration;
- server-owned read and planning tool gates;
- operation plan review and apply for album operations.

The weak point is the runner-to-Gallery tool boundary. The runner currently
defines Gallery tools by hand in `agent-runner/src/gallery-tools.mjs`, maps each
tool to an internal HTTP route, and uses a loose object schema for all tool
parameters. This duplicates Gallery's server-side DTO and policy contracts in
the runner and makes future tool expansion harder than it needs to be.

Gallery should expose a first-party MCP server so Pi can discover and call
Gallery tools through a standard structured protocol while Gallery remains the
authority for access control, permission plans, approval prompts, audit state,
operation-plan validation, and final apply.

## Goals

- Replace the runner's hardcoded Gallery custom tools with a Gallery-hosted MCP
  server.
- Scope the first implementation to the first-party Pi runner only.
- Keep the existing Gallery permission, approval, audit, operation planning, and
  apply behavior unchanged.
- Expose the same initial tool set already present in the PR.
- Keep final album mutation out of MCP. Applying operations remains a deliberate
  Gallery UI action.
- Support both simple co-located runner deployments and future shared runner
  infrastructure for one-click hosted Gallery.
- Package the production image so `agent-runner` can run from the same released
  Gallery server image.

## Non-Goals

- Do not expose a public or third-party MCP endpoint in the first slice.
- Do not add MCP resources, prompts, sampling, or OAuth authorization.
- Do not bypass Gallery's existing tool approval UI with MCP-native approval.
- Do not add new Gallery domain tools beyond the current read and planning
  tools.
- Do not implement shared runner infrastructure in this PR. The design must only
  keep that topology possible.
- Do not add direct write or apply tools to Pi.

## Architecture

Use a Gallery-hosted internal MCP endpoint with the existing runner token model.

```text
Pi runtime in agent-runner
  -> Pi MCP client support
    -> Gallery internal MCP endpoint
      -> session-scoped runner token guard
      -> AgentToolService / AgentOperationPlanService
      -> existing policy, approval, audit, websocket, and operation state
```

MCP changes only the transport and discovery layer. Gallery service behavior
stays authoritative.

The previous runner gateway:

```text
agent-runner defineTool() -> /api/agent/internal/tools/sessions/:id/<route>
```

becomes:

```text
Pi MCP client -> /api/agent/internal/mcp/sessions/:id
```

The first MCP endpoint is not browser-authenticated and not API-key
authenticated. It accepts only a session-scoped runner bearer token minted by
Gallery when creating the runner session.

## Protocol

Endpoint:

```text
POST /api/agent/internal/mcp/sessions/:id
Authorization: Bearer <runner-tool-token>
Content-Type: application/json
Accept: application/json, text/event-stream
```

The MCP replacement should implement Streamable HTTP MCP. Across the vertical
slices it must support at least:

- `initialize`;
- `tools/list`;
- `tools/call`;
- normal JSON-RPC error responses for malformed MCP requests.

The token guard should reuse the current `AgentRunnerToolTokenService` claims:

```ts
type AgentRunnerToolTokenClaims = {
  sessionId: string;
  userId: string;
  expiresAt: string;
};
```

Claims must match the `:id` path parameter. The guard sets `request.user` to the
claimed user so the existing services continue to enforce owned session access.

## Tool Registry

Create one server-owned registry for the MCP surface. It should define the tool
metadata, DTO schema, service delegate, and behavior annotations for each tool.
The runner must not own Gallery tool names, routes, schemas, or descriptions.

Initial tools:

```text
searchAssets
readAssetMetadata
readAssetPreviews
readAssetOriginals
listAlbums
readAlbum
proposeAlbumOperations
reviseProposedOperations
summarizePlan
```

There is no apply tool.

Each tool definition should include:

- `name`: same stable value as `AgentToolName`;
- `title`: short display label;
- `description`: clear model-facing description;
- `inputSchema`: JSON Schema derived from the existing DTO schema where
  practical;
- `outputSchema`: optional in the first slice, but preferred for the current
  discriminated response shapes;
- `annotations`.

Annotations:

```text
Read tools:
  readOnlyHint: true
  destructiveHint: false

Planning tools:
  readOnlyHint: false
  destructiveHint: false
  idempotentHint: false

All tools:
  openWorldHint: false
```

Planning tools are not direct writes, but they do persist proposed plan state and
notify the UI. They should therefore not be marked read-only.

## Tool Call Behavior

`tools/call` delegates to the existing services:

| MCP tool                   | Existing service method                                |
| -------------------------- | ------------------------------------------------------ |
| `searchAssets`             | `AgentToolService.searchAssets()`                      |
| `readAssetMetadata`        | `AgentToolService.readAssetMetadata()`                 |
| `readAssetPreviews`        | `AgentToolService.readAssetPreviews()`                 |
| `readAssetOriginals`       | `AgentToolService.readAssetOriginals()`                |
| `listAlbums`               | `AgentToolService.listAlbums()`                        |
| `readAlbum`                | `AgentToolService.readAlbum()`                         |
| `proposeAlbumOperations`   | `AgentOperationPlanService.proposeAlbumOperations()`   |
| `reviseProposedOperations` | `AgentOperationPlanService.reviseProposedOperations()` |
| `summarizePlan`            | `AgentOperationPlanService.summarizePlan()`            |

MCP tool results should include both:

```ts
{
  content: [{ type: 'text', text: JSON.stringify(result) }],
  structuredContent: result,
  isError?: boolean
}
```

Return the exact existing service response in `structuredContent`. Keep the JSON
text copy because Pi MCP integrations may still rely on text content.

Policy denials and approval prompts are normal Gallery tool results:

```json
{ "status": "denied", "reason": "...", "toolCall": { "...": "..." } }
```

```json
{ "status": "approval-required", "toolCall": { "...": "..." } }
```

They are not MCP protocol errors.

Use MCP/JSON-RPC errors for:

- malformed JSON-RPC;
- unknown MCP method;
- unknown tool name;
- token/session mismatch;
- missing or invalid bearer token;
- unexpected internal server failure.

Use `isError: true` tool results for recoverable tool-level issues such as DTO
validation failures where the model can retry with corrected arguments.

## Approval Flow

MCP must preserve the current Gallery approval model.

Strict read example:

1. Pi calls MCP `tools/call` for `readAssetPreviews`.
2. Gallery creates a pending `agent_tool_call`.
3. MCP returns `status: "approval-required"`.
4. The assistant tells the user approval is needed.
5. The user approves in the Gallery UI.
6. Pi retries the same tool with `toolCallId`.
7. Gallery revalidates session, access, policy, limits, and drift, then returns
   success or denial.

No separate MCP approval mechanism is introduced in the first slice. Existing
websocket events, pending tool call panels, and plan review UI remain the user
interaction surfaces.

## Runner Integration

The runner should stop defining Gallery tools with `defineTool()`.

Remove or retire:

```text
agent-runner/src/gallery-tools.mjs
agent-runner/src/gallery-tools.test.mjs
agent-runner/src/gallery-tool-client.mjs
agent-runner/src/gallery-tool-client.test.mjs
```

Replace the old `toolGateway` runner request field with an MCP gateway:

```ts
type AgentRunnerMcpGateway = {
  url: string;
  token: string;
};

type AgentRunnerCreateSessionRequest = {
  gallerySessionId: string;
  credential: AgentRunnerCredentialMaterial;
  model: string;
  permissionPreset: AgentPermissionPreset;
  permissionPlan: AgentPermissionPlanSnapshot;
  approvalMode: AgentApprovalMode;
  initialContext: Record<string, unknown>;
  mcpGateway: AgentRunnerMcpGateway | null;
};
```

Gallery creates the gateway URL from a configured base:

```text
IMMICH_AGENT_MCP_GATEWAY_URL=http://gallery-server:2283/api/agent/internal/mcp
```

For a session, Gallery sends:

```text
<base>/sessions/<sessionId>
```

The runner configures Pi MCP support with a `gallery` server:

```json
{
  "mcpServers": {
    "gallery": {
      "transport": "streamable-http",
      "url": "<mcpGateway.url>",
      "headers": {
        "Authorization": "Bearer <mcpGateway.token>"
      },
      "lifecycle": "eager"
    }
  }
}
```

Implementation should prefer the least file-based Pi integration available in
the installed Pi SDK. If Pi requires config files, write them inside the
runner's existing runtime directory, not user home or the repo root, and replace
them on session setup.

Built-in Pi tools remain disabled. Gallery MCP is the only tool source added by
this feature.

Runner capabilities should report MCP-discovered Gallery tools when the Pi MCP
integration exposes them. If that is not readily available in the first slice,
the runner may report `tools: ['mcp:gallery']` and server tests should own the
exact MCP tool list.

Secrets and tokens:

- provider credentials remain transient and redacted;
- MCP bearer tokens are transient and redacted;
- the runner never persists MCP config outside its runtime directory;
- the runner does not know `IMMICH_AGENT_SECRET_KEY`;
- shared-runner topology is supported because the MCP URL and token are provided
  per session.

## Configuration And Deployment

Rename the current tool gateway configuration to MCP-specific naming:

```text
IMMICH_AGENT_RUNNER_URL
IMMICH_AGENT_MCP_GATEWAY_URL
IMMICH_AGENT_SECRET_KEY
```

`IMMICH_AGENT_SECRET_KEY` remains Gallery-local. Gallery uses it for provider
credential encryption and runner MCP token signing. A shared runner must not
receive it.

Supported topologies:

### Self-hosted Docker Compose

Run one internal `agent-runner` service next to `immich-server`.

```text
IMMICH_AGENT_RUNNER_URL=http://agent-runner:4477
IMMICH_AGENT_MCP_GATEWAY_URL=http://immich-server:2283/api/agent/internal/mcp
```

The runner service does not need a public port.

`example.env` or the install flow should generate a stable
`IMMICH_AGENT_SECRET_KEY` so saved assistant provider credentials survive server
restarts and compose updates.

### One-Click Hosted Gallery

The design must support a future shared runner service in shared infrastructure,
similar in spirit to `ml-shared`.

Per-tenant Gallery config can point to:

```text
IMMICH_AGENT_RUNNER_URL=http://gallery-agent-runner.<shared-namespace>.svc.cluster.local:4477
IMMICH_AGENT_MCP_GATEWAY_URL=http://gallery-server.user-<uid>.svc.cluster.local:2283/api/agent/internal/mcp
```

This allows a shared stateless runner to call back into each tenant's Gallery
instance using only the per-session MCP URL and bearer token supplied during
session creation.

The first implementation does not need to create the shared runner deployment in
`open-noodle`. It only needs to avoid assuming the runner is tenant-local.

Per-tenant `IMMICH_AGENT_SECRET_KEY` must be stable. In the Dashboard
provisioning flow, generate and persist a `galleryAgentSecretKey` once on the
subscription row before applying the Kubernetes Secret. Provisioning retries
must reapply the same value.

### Production Image Packaging

The production `gallery-server` image must include a runnable `agent-runner`.
The current production Dockerfile only copies server, web, CLI, and plugins
outputs. This feature should add an `agent-runner` build/deploy stage and a
stable command such as:

```text
pnpm --dir agent-runner start
```

or a packaged bin wrapper copied into the final image.

## Data Model

No new durable tables are required for the MCP replacement.

Existing durable state remains:

- `agent_session`;
- `agent_message`;
- `agent_tool_call`;
- `agent_operation_plan`;
- `agent_operation`;
- `agent_provider_credential`.

The current `agent_tool_grant` table proposed in the original design remains a
future extension and is not required by this replacement.

## Security And Privacy

- MCP endpoint is internal and runner-token-only.
- Token must be session-scoped, user-scoped, and expiring.
- Gallery validates normal ownership and access inside existing services.
- MCP tool list must not include apply or direct mutation tools.
- Tool result payloads must not include raw filesystem paths, raw media bytes,
  provider secrets, MCP bearer tokens, or full provider request bodies.
- Media reference tools continue returning scoped API references only.
- Runner logs must redact provider secrets and MCP bearer tokens.
- Shared runner deployments are safe because each call uses a tenant-specific
  callback URL and session token. The runner has no database, S3, or Gallery
  secret material.

## Development Method

Implementation should use test-driven development for each vertical slice:

1. Write or update the focused tests for the next externally visible behavior.
2. Run the tests and confirm they fail for the expected reason.
3. Implement the smallest code change that makes those tests pass.
4. Refactor while keeping the same focused tests green.
5. Run the relevant slice regression suite before moving to the next slice.

Each implementation plan derived from this spec should name its red, green, and
regression commands. Do not batch multiple slices behind one large unverified
implementation step.

## Testing Strategy

Server unit/controller tests:

- `initialize` requires a valid runner token.
- `tools/list` requires a valid runner token.
- token/session mismatch is rejected.
- expired, malformed, missing, wrong-signature, and wrong-session bearer tokens
  are rejected.
- a valid token for one session cannot access another session's MCP endpoint.
- `tools/list` returns exactly the expected nine tools.
- `tools/list` does not include apply or direct write tools.
- each tool exposes a valid object `inputSchema`.
- each tool exposes the expected annotations for read, planning, destructive,
  idempotent, and open-world hints.
- malformed JSON-RPC and unsupported MCP methods return protocol errors.
- unknown tool names return JSON-RPC protocol errors.
- malformed tool arguments return an MCP tool result with `isError: true`.
- approval-required, denied, and success service responses are preserved in
  `structuredContent`.
- text `content` contains the same JSON result as `structuredContent`.
- each MCP tool delegates to the same existing service method used by the old
  gateway.
- service exceptions are converted to protocol errors without leaking stack
  traces, tokens, provider secrets, or filesystem paths.

Tool behavior tests:

- read tools preserve existing permission plan limits and approval behavior.
- approval retries with `toolCallId` preserve the current revalidation behavior.
- denied tool calls stay ordinary tool results, not protocol errors.
- DTO validation covers missing required fields, wrong primitive types, empty
  arrays, invalid asset IDs, invalid album IDs, excessive limit values, and
  unexpected object properties where DTOs disallow them.
- stale approvals are revalidated when permissions, ownership, or asset state
  changes between request and retry.
- planning tools persist the same operation plan state and websocket events as
  the old gateway.
- `summarizePlan` handles missing, stale, unauthorized, and already-applied
  plans consistently with the existing service.

Runner tests:

- runner session creation accepts `mcpGateway`.
- runner session creation still handles `mcpGateway: null` when the assistant is
  disabled or unavailable.
- Pi runtime config includes one Gallery MCP server using Streamable HTTP.
- MCP bearer token is passed only as an Authorization header.
- MCP bearer token is redacted from errors and logs.
- provider credentials remain redacted after adding MCP config.
- no Gallery `defineTool()` custom tools are registered.
- built-in Pi tools remain disabled.
- concurrent runner sessions do not share or overwrite MCP config.
- Pi startup failure or MCP connection failure is surfaced as a runner startup
  failure without leaking secrets.
- capabilities no longer depend on `galleryToolNames`.

Packaging and deployment tests:

- production Dockerfile includes the agent-runner package or bin.
- dev compose uses `IMMICH_AGENT_MCP_GATEWAY_URL`.
- self-hosted compose can run the runner without publishing port `4477`.
- missing `IMMICH_AGENT_MCP_GATEWAY_URL` disables assistant startup or fails with
  a clear configuration error.
- `IMMICH_AGENT_SECRET_KEY` is stable across restarts and provisioning retries.
- open-noodle provisioning can target a shared runner by changing
  `IMMICH_AGENT_RUNNER_URL` only.
- a shared runner does not receive `IMMICH_AGENT_SECRET_KEY`, database
  credentials, S3 credentials, or tenant-local secrets.

Regression tests:

- existing focused server agent suite remains green.
- `agent-runner` tests remain green after replacing custom tools with MCP.
- the old internal tool gateway tests are removed or rewritten so no dead
  hardcoded tool path remains as the source of truth.

## Edge Cases To Cover

Protocol and auth:

- request body is not valid JSON;
- JSON-RPC `id` is missing or has an unsupported type;
- batch requests are either explicitly unsupported with protocol errors or
  handled consistently;
- method is missing, unknown, or unsupported for the first slice;
- client calls `tools/call` before `initialize`;
- request has no bearer token, a malformed bearer token, an expired token, or a
  token signed by a different secret;
- token claims match the user but not the session path;
- session exists but is closed, deleted, or owned by another user;
- repeated calls reuse the same token until expiry without widening access.

Tool registry:

- registry accidentally exposes an apply/direct mutation tool;
- registry omits one of the nine required initial tools;
- generated JSON Schema drifts from the server DTO;
- read tools are marked read-only and planning tools are not marked read-only;
- schema descriptions remain model-facing and do not reveal internal routes.

Tool calls:

- unknown tool name;
- missing `arguments`;
- `arguments` is not an object;
- unknown fields in strict DTOs;
- approval-required response;
- denial response;
- successful response with `structuredContent` and matching text content;
- retry with a valid `toolCallId`;
- retry with another user's `toolCallId`;
- approval drift after assets, albums, permissions, or session state changed;
- service throws an unexpected error.

Runner:

- Pi SDK MCP integration is unavailable or changes shape;
- MCP config must be file-backed and the runtime directory is missing;
- two sessions start concurrently in the same runner process;
- runner startup fails after receiving provider credentials and MCP token;
- runner logs or thrown errors include token-like strings;
- `mcpGateway` is absent while legacy `toolGateway` fields have been removed.

Deployment:

- compose env still uses the old `IMMICH_AGENT_TOOL_GATEWAY_URL`;
- production image lacks `agent-runner` artifacts;
- runner service is accidentally exposed publicly;
- one-click provisioning retry would rotate `IMMICH_AGENT_SECRET_KEY`;
- shared runner cannot reach a tenant callback URL;
- shared runner receives tenant secrets it should not have.

## Vertical Implementation Slices

Each slice below is intended to become its own implementation plan. A slice is
complete only when its tests were written first, the new focused tests pass, and
the relevant existing regression suite remains green.

### Slice 1: MCP Protocol Skeleton And Auth

Behavior:

- add the internal MCP controller/service shell;
- route `POST /api/agent/internal/mcp/sessions/:id`;
- authenticate with the existing runner token claims;
- implement `initialize` and protocol error formatting.

TDD focus:

- missing token, malformed token, expired token, session mismatch, and valid
  token cases;
- malformed JSON-RPC and unsupported method cases;
- no Gallery domain tool behavior yet.

Verification:

- focused server MCP controller/service tests;
- existing `agent-session` and runner-token tests.

### Slice 2: Server-Owned Tool Registry And `tools/list`

Behavior:

- add the server-owned registry for the nine initial tools;
- expose names, descriptions, schemas, and annotations through `tools/list`;
- keep apply/direct mutation tools out of the list.

TDD focus:

- exact tool list;
- no apply tool;
- schema object validity;
- read/planning annotations;
- schema drift checks against DTO-derived contracts where practical.

Verification:

- focused server MCP registry/list tests;
- existing agent tool service tests.

### Slice 3: Read Tool Calls Over MCP

Behavior:

- implement `tools/call` delegation for read tools;
- preserve existing approval, denial, audit, and permission-plan behavior;
- map successful results to `structuredContent` and text `content`.

TDD focus:

- one delegation test per read tool;
- approval-required, denied, validation-error, and success result mapping;
- retry with `toolCallId`;
- access drift between approval request and retry.

Verification:

- focused MCP read-tool tests;
- existing `AgentToolService` tests.

### Slice 4: Planning Tool Calls Over MCP

Behavior:

- delegate `proposeAlbumOperations`, `reviseProposedOperations`, and
  `summarizePlan`;
- preserve persisted plan state, websocket notifications, and final apply being
  UI-only.

TDD focus:

- one delegation test per planning tool;
- missing/stale/unauthorized plan cases;
- plan revision and summary response shape;
- absence of any MCP apply tool.

Verification:

- focused MCP planning-tool tests;
- existing `AgentOperationPlanService` tests.

### Slice 5: Runner Pi MCP Integration

Behavior:

- replace `toolGateway` with `mcpGateway` in the runner protocol;
- configure Pi's Gallery MCP server for each session;
- remove hardcoded Gallery `defineTool()` registration and HTTP client usage;
- keep built-in Pi tools disabled.

TDD focus:

- session request accepts `mcpGateway`;
- generated Pi MCP config uses Streamable HTTP and Authorization header;
- token/provider redaction;
- concurrent sessions do not share MCP config;
- no custom Gallery tools are registered.

Verification:

- focused `agent-runner` tests;
- runner protocol tests in the server package where session creation sends the
  gateway payload.

### Slice 6: Config, Compose, And Packaging

Behavior:

- rename `IMMICH_AGENT_TOOL_GATEWAY_URL` to `IMMICH_AGENT_MCP_GATEWAY_URL`;
- update dev compose and self-hosted compose/env examples;
- package `agent-runner` into the production server image;
- document one-click shared-runner-compatible env values.

TDD focus:

- configuration validation for missing or old env names;
- compose files contain the MCP gateway env and do not publish runner port;
- production image build context includes `agent-runner`;
- stable `IMMICH_AGENT_SECRET_KEY` requirement is represented in provisioning
  docs or tests.

Verification:

- focused config tests;
- Dockerfile/compose static checks where available;
- existing packaging/build checks that are practical for the PR.

### Slice 7: Legacy Gateway Removal And Regression Sweep

Behavior:

- remove retired runner custom tool files and old gateway route wiring;
- remove stale tests whose only purpose was the hardcoded tool gateway;
- update docs and capability reporting to reference MCP.

TDD focus:

- tests fail if `gallery-tools.mjs` or `gallery-tool-client.mjs` is still
  imported;
- capabilities no longer depend on the old `galleryToolNames` list;
- no old gateway env variable is required for agent startup.

Verification:

- full focused server agent suite;
- full `agent-runner` test suite;
- `rg` check for retired gateway names with only intentional migration notes
  remaining.

## References

- Pi MCP extension package, checked 2026-05-16:
  `https://pi.dev/packages/pi-mcp-extension`
- Pi MCP adapter package, checked 2026-05-16:
  `https://pi.dev/packages/pi-mcp-adapter`
- MCP tools specification, checked 2026-05-16:
  `https://modelcontextprotocol.io/specification/2025-11-25/server/tools`
- MCP transports specification, checked 2026-05-16:
  `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports`
- One-click architecture context:
  `/home/pierre/dev/open-noodle/docs/one-click-gallery-architecture.md`
