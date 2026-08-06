# Pi Agent MCP Slice 5 Runner Pi MCP Integration Implementation Plan

> **For:** subagent-driven development with TDD
> **Created:** 2026-05-16
> **Design:** `docs/superpowers/specs/2026-05-16-pi-agent-mcp-server-design.md`

## Goal

Replace the first-party Pi runner's hardcoded Gallery custom tools with per-session Pi MCP configuration. The runner should receive `mcpGateway`, load Gallery as a Pi MCP server, keep built-in Pi tools disabled, and stop owning Gallery tool names, routes, schemas, and descriptions.

## Architecture

Gallery continues to create short-lived runner-token credentials. `AgentRunnerService` sends the runner a session-specific `mcpGateway` payload:

```ts
{
  url: "<configured MCP base>/sessions/<gallerySessionId>",
  token: "<short-lived runner token>"
}
```

The runner writes the Pi MCP config for that session under an isolated runtime session directory, loads a Pi MCP extension explicitly through `DefaultResourceLoader.additionalExtensionPaths`, creates the Pi session with `noTools: 'builtin'`, then calls `session.bindExtensions({})` so the eager Gallery MCP connection starts before session creation is reported as successful.

Use `pi-mcp-extension@1.5.0` for this slice because it supports direct Pi tool registration after eager MCP startup, Streamable HTTP, static `headers`, and does not require a metadata cache to expose tools in the first session. Resolve its extension entry file from `node_modules` and pass the path explicitly. Do not enable arbitrary project/user extensions.

The runner must also isolate Pi's home/global config lookup. `pi-mcp-extension` reads project config from `<cwd>/.pi/mcp.json` but also checks `~/.pi/agent/mcp.json`; Slice 5 should set a runner-owned home directory before loading the MCP extension or otherwise prove global user MCP config cannot be loaded. This prevents local developer or host-level MCP servers from becoming tools in the Gallery runner.

`pi-mcp-adapter@2.6.1` remains a fallback only if `pi-mcp-extension` proves incompatible with Pi's current extension loader; it should not be implemented as the primary path because direct tools are cache-backed and may not appear until a restart.

## In Scope

- Rename runner protocol field from `toolGateway` to `mcpGateway`.
- Generate per-session Pi MCP config using Streamable HTTP and `Authorization: Bearer <token>`.
- Load the MCP extension explicitly while leaving all other extensions, skills, prompt templates, themes, and context files disabled.
- Remove runner-owned hardcoded Gallery custom tools and old runner-side tool-gateway client usage.
- Refactor the e2e runner to call Gallery through MCP JSON-RPC instead of the old `/internal/tools` endpoint.
- Keep server env rename and compose/provisioning changes for Slice 6. Slice 5 may still read the existing config field temporarily, but the runner request body must be `mcpGateway`.

## Out Of Scope

- Rename `IMMICH_AGENT_TOOL_GATEWAY_URL` to `IMMICH_AGENT_MCP_GATEWAY_URL`.
- Update Docker Compose, production image packaging, or open-noodle manifests.
- Add public/third-party MCP support, MCP OAuth, MCP resources, MCP prompts, MCP sampling, or any MCP apply/direct mutation tool.
- Reimplement Gallery tool schemas in the runner.

## Open-Noodle Compatibility

This slice must preserve the future shared-runner shape: the runner receives only the per-session MCP URL, bearer token, provider credential for that session, and model selection. It must not require tenant database credentials, `IMMICH_AGENT_SECRET_KEY`, or tenant-local DNS assumptions inside the runner.

The server-side URL builder should accept a fully configurable MCP base URL and append `/sessions/:id`, so Slice 6 and open-noodle can point a tenant Gallery instance at either a co-located runner or a shared runner by changing runner/gateway URLs in provisioning.

## TDD Rules

- Write or update failing tests before implementation for each task.
- Run the focused failing test command and confirm it fails for the expected reason.
- Implement the smallest change to pass.
- Run the focused test again and confirm it passes.
- Do not delete old gateway code until replacement coverage is red.
- Do not claim Pi MCP startup works until a test proves `bindExtensions()` runs and failures surface.

## Files

- Modify: `server/src/types/agent-runner.types.ts`
- Modify: `server/src/services/agent-runner.service.ts`
- Modify: `server/src/services/agent-runner.service.spec.ts`
- Modify: `agent-runner/package.json`
- Modify: `agent-runner/src/server.mjs`
- Modify: `agent-runner/src/server.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/e2e-runtime.mjs`
- Modify: `agent-runner/src/e2e-runtime.test.mjs`
- Delete: `agent-runner/src/gallery-tools.mjs`
- Delete: `agent-runner/src/gallery-tools.test.mjs`
- Delete: `agent-runner/src/gallery-tool-client.mjs`
- Delete: `agent-runner/src/gallery-tool-client.test.mjs`
- Update lockfile if adding `pi-mcp-extension`.

## Test And Edge Case Matrix

- Runner HTTP accepts `mcpGateway: null`.
- Runner HTTP accepts `mcpGateway: { url, token }` and never returns the token.
- Runner HTTP rejects missing `mcpGateway.url`, missing `mcpGateway.token`, non-object `mcpGateway`, and legacy `toolGateway`.
- Gallery server sends `mcpGateway`, not `toolGateway`.
- Gateway URL builder appends `/sessions/<sessionId>` with no duplicate slash and encodes the session id.
- Gateway token expiry still follows the permission plan, including default two-hour expiry when unset.
- Pi runtime writes one per-session `.pi/mcp.json` with `transport: "streamable-http"`, `lifecycle: "eager"`, `url`, and `headers.Authorization`.
- Pi runtime does not load any host/user global MCP config in addition to the per-session Gallery config.
- MCP bearer token is not present in runner capabilities, server responses, thrown errors, or logs.
- Provider secret redaction still works after MCP config is added.
- Built-in Pi tools stay disabled with `noTools: "builtin"`.
- When `mcpGateway` is present, `tools: []` is not passed as an allowlist that would block extension tools.
- When `mcpGateway` is absent, no MCP extension is loaded and `tools: []` remains passed to disable all tools.
- `session.bindExtensions({})` is called before runner session creation succeeds when MCP is configured.
- MCP startup failure or zero active Gallery MCP tools fails runner session creation.
- Concurrent sessions write distinct config directories and do not share or overwrite URLs/tokens.
- Deterministic replacement of the same Gallery session disposes the old Pi session and removes the old token-bearing config directory.
- Path-like `gallerySessionId` values cannot escape the runtime directory.
- E2E runtime calls MCP `tools/call` with Authorization header and JSON-RPC body.
- E2E runtime handles MCP JSON-RPC errors and MCP tool results with `isError: true` without leaking the token.
- Old hardcoded Gallery tool modules are gone and no production runner code imports `galleryToolNames`, `createGalleryTools`, or `createGalleryToolClient`.

## Task 1: Runner HTTP Protocol Red Tests

- [ ] **Step 1: Update `agent-runner/src/server.test.mjs` for `mcpGateway`**

Replace the existing tool-gateway tests with failing MCP protocol tests:

- `accepts a null Gallery MCP gateway and passes it to the runtime`
- `accepts a Gallery MCP gateway without returning the gateway token`
- `rejects a Gallery MCP gateway without a token`
- `rejects a Gallery MCP gateway without a URL`
- `rejects a non-object Gallery MCP gateway`
- `rejects legacy Gallery toolGateway`

Also update the e2e runtime selection test to send `mcpGateway: null`.

- [ ] **Step 2: Run the focused failing runner server tests**

```bash
pnpm --dir agent-runner exec node --test src/server.test.mjs
```

Expected: FAIL because `server.mjs` still validates `toolGateway` and ignores or accepts legacy fields.

## Task 2: Implement Runner HTTP Protocol Rename

- [ ] **Step 1: Replace validation in `agent-runner/src/server.mjs`**

Implement `validateCreateSessionBody()` rules:

- `toolGateway !== undefined` returns `toolGateway is no longer supported; use mcpGateway`.
- `mcpGateway` may be `undefined` or `null`.
- non-null `mcpGateway` must be an object with non-empty string `url` and `token`.

The runtime receives the request body unchanged except for normal JSON parsing; no response may include `mcpGateway.token`.

- [ ] **Step 2: Run focused runner server tests**

```bash
pnpm --dir agent-runner exec node --test src/server.test.mjs
```

Expected: PASS for protocol rename tests.

## Task 3: Gallery Server Request Red Tests

- [ ] **Step 1: Update server runner types tests by changing TypeScript types**

In `server/src/types/agent-runner.types.ts`, plan for:

```ts
export type AgentRunnerMcpGateway = { url: string; token: string };

export type AgentRunnerCreateSessionRequest = AgentRunnerCreateSessionBase & {
  mcpGateway?: AgentRunnerMcpGateway | null;
};
```

Update `makeCreateSessionBody()` in `agent-runner.service.spec.ts` to omit `mcpGateway`, not `toolGateway`.

- [ ] **Step 2: Add failing `AgentRunnerService` gateway tests**

Replace current tool-gateway assertions with MCP assertions:

- no configured gateway sends `mcpGateway: null`;
- configured MCP base URL sends `mcpGateway.url` as `<base>/sessions/<sessionId>`;
- base URL with trailing slash still produces exactly one `/sessions/`;
- token service receives `{ sessionId, userId, expiresAt }`;
- runner request body does not contain `userId`;
- service result never returns the token;
- default expiry remains two hours when `expiresInMinutes` is `null`.

For Slice 5, keep the existing config source field as temporary plumbing if needed, but name local variables `mcpGatewayBaseUrl`/`mcpGateway` and use MCP URLs in tests. Slice 6 owns the env variable rename and compose/provisioning updates.

- [ ] **Step 3: Run focused failing server tests**

```bash
pnpm --dir server test agent-runner.service.spec.ts
```

Expected: FAIL because `AgentRunnerService` still sends `toolGateway` and does not append `/sessions/:id`.

## Task 4: Implement Gallery Server Request Rename

- [ ] **Step 1: Update runner request types**

Rename `AgentRunnerToolGateway` to `AgentRunnerMcpGateway` and replace `toolGateway` with `mcpGateway` in `AgentRunnerCreateSessionRequest`.

- [ ] **Step 2: Update `AgentRunnerService.createSession()`**

Build:

```ts
const mcpGateway = mcpGatewayBaseUrl
  ? {
      url: buildMcpSessionUrl(mcpGatewayBaseUrl, body.gallerySessionId),
      token: this.toolTokenService.create(...),
    }
  : null;
```

Use URL-safe joining rather than string concatenation. The resulting runner body is `{ ...body, mcpGateway }`.

- [ ] **Step 3: Run focused server tests**

```bash
pnpm --dir server test agent-runner.service.spec.ts
```

Expected: PASS.

## Task 5: Pi Runtime MCP Config Red Tests

- [ ] **Step 1: Add dependency expectation**

Update `agent-runner/package.json` red test expectations around the MCP extension path. The implementation should add `pi-mcp-extension@1.5.0` and resolve its `src/index.ts` entry path for `DefaultResourceLoader.additionalExtensionPaths`.

- [ ] **Step 2: Update fake SDK in `pi-runtime.test.mjs`**

Extend the fake session with:

- `bindExtensions()` call tracking;
- `getActiveToolNames()` returning configured fake MCP tool names after bind;
- configurable bind failure and zero-tool behavior;
- dispose tracking.

- [ ] **Step 3: Replace the old custom-tools gateway test**

Add failing tests:

- creates a Pi session with no tools when `mcpGateway` is absent: `noTools: "builtin"`, `tools: []`, no MCP extension path, no custom tools;
- writes per-session `.pi/mcp.json` when `mcpGateway` is present;
- config contains exactly one `gallery` server using `streamable-http`, `lifecycle: "eager"`, URL, and `Authorization: Bearer <token>`;
- runner-owned home/global config isolation is set before MCP extension load, so a fake `~/.pi/agent/mcp.json` does not add tools;
- `session.bindExtensions({})` runs before success;
- capabilities report active MCP tool names from Pi, not `galleryToolNames`;
- `tools` allowlist is omitted when MCP is configured;
- `customTools` is omitted or empty for both paths.

- [ ] **Step 4: Add redaction and failure tests**

Add failing tests:

- `bindExtensions()` failure redacts both provider secret and MCP token;
- zero active `mcp_gallery_` tools after bind fails startup and redacts token;
- `createAgentSession()` failure redacts both provider secret and MCP token;
- duplicate session replacement redacts old provider secret, new provider secret, old MCP token, and new MCP token.

- [ ] **Step 5: Add isolation tests**

Add failing tests:

- two concurrent sessions with different `gallerySessionId` values write different config paths and retain their own URL/token;
- a path-like `gallerySessionId` such as `../escape` still writes under the runner runtime directory;
- `disposeSession()` removes the token-bearing MCP config directory;
- recreating the same deterministic session removes the old config directory after replacement.

- [ ] **Step 6: Run focused failing Pi runtime tests**

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: FAIL because the runtime still imports hardcoded Gallery custom tools and does not write/load MCP config.

## Task 6: Implement Pi Runtime MCP Integration

- [ ] **Step 1: Add package dependency**

Add `pi-mcp-extension@1.5.0` to `agent-runner/package.json` and update the lockfile.

- [ ] **Step 2: Add runtime helpers**

In `pi-runtime.mjs`, add focused helpers:

- `redactSecrets(message, secrets)` to replace provider and MCP secrets.
- `sessionWorkspacePath(gallerySessionId)` using a hash of the session id, not raw user input.
- `buildGalleryMcpConfig(mcpGateway)` returning the JSON config.
- `writeGalleryMcpConfig(sessionWorkspace, mcpGateway)` writing `.pi/mcp.json` with mode `0o600` where supported.
- `resolvePiMcpExtensionPath()` resolving `pi-mcp-extension/package.json` and returning `src/index.ts`.
- `ensureRunnerMcpHome()` creating a runner-owned home directory and preventing Pi MCP global config reads from the real user home.

- [ ] **Step 3: Replace custom tool setup**

Remove imports of `createGalleryToolClient`, `createGalleryTools`, and `galleryToolNames`.

When `body.mcpGateway` exists:

- create the per-session workspace;
- ensure Pi's MCP extension sees only the runner-owned home plus the per-session project config;
- write `.pi/mcp.json`;
- construct `DefaultResourceLoader` with `cwd` set to that workspace, `agentDir` inside the runtime area, `additionalExtensionPaths: [resolvePiMcpExtensionPath()]`, and `noExtensions: true`;
- keep `noSkills`, `noPromptTemplates`, `noThemes`, and `noContextFiles` true;
- call `sdk.createAgentSession({ ..., noTools: 'builtin' })` without `tools: []` and without Gallery `customTools`;
- call `await session.bindExtensions?.({})`;
- read `session.getActiveToolNames?.()` and require at least one active tool beginning `mcp_gallery_`;
- return those active MCP tool names in capabilities.

When `body.mcpGateway` is absent:

- do not write MCP config;
- do not load the MCP extension;
- keep `tools: []` so no built-in or extension tools are available;
- return empty `capabilities.tools`.

- [ ] **Step 4: Clean up session workspaces**

Track `sessionWorkspace` and MCP token in the session entry. On `disposeSession()` and duplicate replacement failure paths, dispose the Pi session and remove the workspace with `fs.rm(..., { recursive: true, force: true })`. Redact cleanup errors.

- [ ] **Step 5: Update the system prompt**

Keep the behavior guidance from the design but refer to Gallery MCP tools through the Pi-exposed names. Include the `mcp_gallery_` prefix examples for the first-party runner so Pi is not instructed to call unavailable bare names.

- [ ] **Step 6: Run focused Pi runtime tests**

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: PASS.

## Task 7: E2E Runtime MCP Refactor Red Tests

- [ ] **Step 1: Update `e2e-runtime.test.mjs`**

Replace `toolGateway` with `mcpGateway` in session setup. Add failing tests that assert:

- capabilities do not import or expose `galleryToolNames`;
- `searchAssets` and `proposeAlbumOperations` are sent as MCP JSON-RPC `tools/call`;
- requests go to `mcpGateway.url`, not tool-specific subpaths;
- bearer token is passed only as `Authorization`;
- JSON-RPC protocol errors are reported without token leakage;
- MCP tool results with `isError: true` are reported without token leakage.

- [ ] **Step 2: Run focused failing e2e runtime tests**

```bash
pnpm --dir agent-runner exec node --test src/e2e-runtime.test.mjs
```

Expected: FAIL because e2e runtime still uses the old tool-gateway HTTP client.

## Task 8: Implement E2E Runtime MCP Calls

- [ ] **Step 1: Replace old client usage**

In `e2e-runtime.mjs`, remove imports from `gallery-tool-client.mjs` and `gallery-tools.mjs`.

Add a tiny e2e-only MCP client:

- POST to `mcpGateway.url`;
- header `Authorization: Bearer <token>`;
- JSON body `{ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments } }`;
- parse normal result from `result.structuredContent` first, then JSON text content as fallback;
- treat JSON-RPC errors and `result.isError` as failures;
- redact the gateway token from user-visible text.

- [ ] **Step 2: Update e2e capabilities**

Return `runtime: 'e2e'`, model support, and `tools: ['mcp:gallery']` or the deterministic MCP tool names used by the e2e runtime. Do not import the old hardcoded tool list.

- [ ] **Step 3: Run focused e2e runtime tests**

```bash
pnpm --dir agent-runner exec node --test src/e2e-runtime.test.mjs
```

Expected: PASS.

## Task 9: Remove Old Runner-Owned Gallery Tools

- [ ] **Step 1: Delete dead modules and tests**

Delete:

- `agent-runner/src/gallery-tools.mjs`
- `agent-runner/src/gallery-tools.test.mjs`
- `agent-runner/src/gallery-tool-client.mjs`
- `agent-runner/src/gallery-tool-client.test.mjs`

- [ ] **Step 2: Run agent-runner tests**

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 3: Verify old production imports are gone**

```bash
rg -n "toolGateway|galleryToolNames|createGalleryTools|createGalleryToolClient|gallery-tools|gallery-tool-client" agent-runner/src server/src
```

Expected: no production references. Test files and docs should either be gone or use `mcpGateway`.

## Task 10: Final Verification

- [ ] **Step 1: Agent-runner full test suite**

```bash
pnpm --dir agent-runner test
```

- [ ] **Step 2: Focused server protocol tests**

```bash
pnpm --dir server test agent-runner.service.spec.ts agent-runner.repository.spec.ts agent-session.service.spec.ts agent-runner.controller.spec.ts
```

- [ ] **Step 3: Server type/lint check for touched files**

```bash
pnpm --dir server exec eslint src/types/agent-runner.types.ts src/services/agent-runner.service.ts src/services/agent-runner.service.spec.ts --max-warnings 0
```

- [ ] **Step 4: Secret-safety grep**

```bash
rg -n "gateway-token-secret|sk-session-secret|sk-openai-secret" agent-runner/src server/src
```

Expected: only test fixtures contain these literal test secrets.

- [ ] **Step 5: Old path grep**

```bash
rg -n "toolGateway|IMMICH_AGENT_TOOL_GATEWAY_URL|/agent/internal/tools|galleryToolNames|createGalleryTools|createGalleryToolClient" agent-runner/src server/src
```

Expected:

- no `toolGateway` production code;
- no agent-runner production imports of old Gallery tool modules;
- `IMMICH_AGENT_TOOL_GATEWAY_URL` may remain only in server env/config plumbing until Slice 6, if that temporary source was kept intentionally.

## Completion Checklist

- [ ] Runner request protocol uses `mcpGateway`.
- [ ] Gallery server sends `mcpGateway` with a session-specific MCP endpoint.
- [ ] Pi runner writes per-session MCP config under the runtime directory.
- [ ] Pi runner cannot load host/user global MCP config as an extra tool source.
- [ ] Pi MCP extension loads explicitly; arbitrary extensions remain disabled.
- [ ] Built-in Pi tools remain disabled.
- [ ] Runner-owned Gallery `defineTool()` definitions are removed.
- [ ] E2E runtime uses MCP JSON-RPC, not the old tool gateway.
- [ ] MCP and provider secrets are redacted in startup, replacement, streaming, and cleanup failures.
- [ ] Concurrent sessions cannot overwrite each other's MCP config.
- [ ] Token-bearing config directories are removed on dispose/replacement.
- [ ] Slice 6 remains responsible for env rename, compose, packaging, and open-noodle manifest/provisioning updates.
