# Pi Agent MCP Slice 7 Legacy Gateway Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the retired first-party runner tool gateway path and hardcoded runner tool leftovers now that Gallery exposes the server-owned MCP endpoint.

**Architecture:** Gallery keeps the existing session-scoped runner token model, but the token guard becomes independent from the deleted legacy tool controller. The first-party runner accepts only the MCP gateway protocol and reports MCP capabilities, while static regression tests prevent the old route, old runner custom-tool modules, and old capability lists from returning.

**Tech Stack:** NestJS controllers/guards, Vitest server tests, Supertest, Node `node:test` runner tests, static source checks with Node `fs`, TypeScript, pnpm.

---

## Source Context

- Spec: `docs/superpowers/specs/2026-05-16-pi-agent-mcp-server-design.md`, section `Slice 7: Legacy Gateway Removal And Regression Sweep`.
- Slice 5 already replaced first-party Pi runner custom Gallery tool registration with Pi MCP configuration.
- Slice 6 already renamed deployment/config from `IMMICH_AGENT_TOOL_GATEWAY_URL` to `IMMICH_AGENT_MCP_GATEWAY_URL` and intentionally kept migration validation for the old env name.
- Current known legacy leftovers:
  - `server/src/controllers/agent-runner-tool.controller.ts` still serves `POST /agent/internal/tools/sessions/:id/...`.
  - `server/src/controllers/agent-runner-tool.controller.spec.ts` still tests the old hardcoded HTTP tool gateway.
  - `AgentRunnerMcpController` imports `AgentRunnerToolGuard` from the old tool controller file.
  - `server/src/controllers/index.ts` still registers `AgentRunnerToolController`.
  - `server/src/services/index.ts` still registers `AgentRunnerToolGuard` from the old controller file.
  - `agent-runner/src/server.mjs` still has a legacy `toolGateway` request-body rejection guard.
  - `agent-runner/src/server.test.mjs` still has tests and capability examples with old direct Gallery tool names.

## Non-Goals

- Do not remove the server-owned `AgentToolService`, tool DTOs, tool-call audit tables, or `AgentToolName` enum. Those are still used by MCP `tools/call` and the approval UI.
- Do not remove the Slice 6 migration validation for `IMMICH_AGENT_TOOL_GATEWAY_URL`. The old env name should remain rejected with a clear migration message.
- Do not rename `AgentRunnerToolTokenService` in this slice. The design spec explicitly reuses its token claims; this plan only removes legacy gateway route wiring and user-facing "tool token" wording.
- Do not change open-noodle provisioning. Shared-runner and stable-secret provisioning were Slice 6.
- Do not remove the MCP endpoint: `POST /agent/internal/mcp/sessions/:id`.

## File Structure

Create:

- `server/src/controllers/agent-runner-token.guard.ts`
  - Owns the shared runner-token HTTP guard used by the MCP controller after the old tool controller is deleted.
- `server/src/utils/agent-legacy-gateway-removal.spec.ts`
  - Static regression guard for deleted runner custom-tool modules, deleted old HTTP route wiring, removed `toolGateway` runner protocol plumbing, and MCP-only capability examples.

Modify:

- `server/src/controllers/agent-runner-mcp.controller.ts`
  - Import/use `AgentRunnerTokenGuard` from the new guard file.
- `server/src/controllers/agent-runner-mcp.controller.spec.ts`
  - Import/provide the new guard and assert runner-token error messages no longer mention the old tool gateway.
- `server/src/controllers/index.ts`
  - Remove `AgentRunnerToolController`.
- `server/src/services/index.ts`
  - Register `AgentRunnerTokenGuard` from the new guard file instead of `AgentRunnerToolGuard`.
- `server/src/services/agent-runner-tool-token.service.ts`
  - Keep the same service and token format, but rename user-visible token errors from "tool token" to "runner token".
- `server/src/services/agent-runner-tool-token.service.spec.ts`
  - Update the token-message regressions.
- `server/src/dtos/agent-runner.dto.ts`
  - Describe runner `tools` capabilities as MCP tool/capability identifiers.
- `server/src/repositories/agent-runner.repository.spec.ts`
  - Use MCP-shaped capability names in normalization tests.
- `server/src/services/agent-runner.service.spec.ts`
  - Use MCP-shaped capability names in runner session/status snapshots.
- `agent-runner/src/server.mjs`
  - Remove the legacy `toolGateway` validation branch and forward only supported create-session protocol fields to runtime code.
- `agent-runner/src/server.test.mjs`
  - Remove stale legacy `toolGateway` test and update capability fixtures to MCP names.

Delete:

- `server/src/controllers/agent-runner-tool.controller.ts`
- `server/src/controllers/agent-runner-tool.controller.spec.ts`

## TDD Rules

- Add or update tests before implementation for each task.
- Run the focused test command and capture the expected failure.
- Implement only enough code to make the focused command pass.
- Run the focused command again before moving to the next task.
- Commit after each green task if executing this plan directly.
- Do not commit generated `.pi-runtime`, `node_modules`, Docker build output, local `.env`, database dumps, or unrelated Slice 6 work.

## Test And Edge Case Matrix

Legacy route removal:

- `server/src/controllers/agent-runner-tool.controller.ts` is gone.
- `server/src/controllers/agent-runner-tool.controller.spec.ts` is gone.
- `server/src/controllers/index.ts` no longer imports or registers `AgentRunnerToolController`.
- `server/src/services/index.ts` no longer imports a guard from the deleted controller file.
- `POST /agent/internal/mcp/sessions/:id` still authenticates with bearer runner tokens.
- MCP route still rejects missing, malformed, expired, wrong-signature, and wrong-session runner tokens.
- MCP notifications still return `202` with no body.
- MCP `tools/list` and read/planning `tools/call` still delegate with runner auth and route session id.

Runner protocol cleanup:

- `agent-runner/src/server.mjs` no longer references `toolGateway`.
- The stale runner test for legacy `toolGateway` rejection is removed.
- Session creation still accepts missing or `null` `mcpGateway`.
- Session creation still rejects malformed non-null `mcpGateway`, missing `url`, and missing `token`.
- Session creation does not forward unknown top-level request fields to runtime code, which prevents retired gateway-shaped fields from remaining as inert compatibility payload.
- Runner startup/import does not require any old gateway env variable.

Retired custom runner files:

- `agent-runner/src/gallery-tools.mjs` does not exist.
- `agent-runner/src/gallery-tool-client.mjs` does not exist.
- No `agent-runner/src/*.mjs` imports either retired module.
- No runner source references `galleryToolNames`.

Capabilities and docs:

- Runner health and session capability examples use MCP identifiers such as `mcp:gallery` or `mcp_gallery_searchAssets`, not direct Gallery custom tool names.
- Server capability DTO text describes MCP tool/capability identifiers.
- Retired gateway names remain only where intentionally testing or documenting the `IMMICH_AGENT_TOOL_GATEWAY_URL` migration failure.

## Task 1: Add Static Legacy Removal Regression Guard

**Files:**

- Create: `server/src/utils/agent-legacy-gateway-removal.spec.ts`

- [ ] **Step 1: Write the failing static guard tests**

Create `server/src/utils/agent-legacy-gateway-removal.spec.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '..');

const repoPath = (path: string) => join(repoRoot, path);
const readRepo = (path: string) => readFileSync(repoPath(path), 'utf8');
const existsRepo = (path: string) => existsSync(repoPath(path));
const runnerSourceFiles = () =>
  readdirSync(repoPath('agent-runner/src'))
    .filter((path) => path.endsWith('.mjs'))
    .map((path) => `agent-runner/src/${path}`);

describe('legacy agent gateway removal', () => {
  it('does not keep retired first-party runner custom tool modules or imports', () => {
    expect(existsRepo('agent-runner/src/gallery-tools.mjs')).toBe(false);
    expect(existsRepo('agent-runner/src/gallery-tool-client.mjs')).toBe(false);

    for (const path of runnerSourceFiles()) {
      const source = readRepo(path);
      expect(source, path).not.toContain('gallery-tools');
      expect(source, path).not.toContain('gallery-tool-client');
      expect(source, path).not.toContain('galleryToolNames');
    }
  });

  it('does not keep the retired internal tools HTTP gateway controller wiring', () => {
    expect(existsRepo('server/src/controllers/agent-runner-tool.controller.ts')).toBe(false);
    expect(existsRepo('server/src/controllers/agent-runner-tool.controller.spec.ts')).toBe(false);

    expect(readRepo('server/src/controllers/index.ts')).not.toContain('AgentRunnerToolController');
    expect(readRepo('server/src/controllers/index.ts')).not.toContain('agent-runner-tool.controller');
    expect(readRepo('server/src/services/index.ts')).not.toContain('agent-runner-tool.controller');
    expect(readRepo('server/src/services/index.ts')).not.toContain('AgentRunnerToolGuard');
  });
});
```

- [ ] **Step 2: Run the static guard to verify it fails**

Run:

```bash
pnpm --dir server test agent-legacy-gateway-removal.spec.ts
```

Expected: FAIL because the old controller file still exists and `controllers/index.ts` still registers `AgentRunnerToolController`.

- [ ] **Step 3: Keep the red test for Task 2**

Expected: Do not commit this task yet. Task 2 is the matching implementation that makes the new static guard green, and the commit happens after Task 2 verification.

## Task 2: Delete Legacy Server HTTP Tool Gateway And Move Token Guard

**Files:**

- Create: `server/src/controllers/agent-runner-token.guard.ts`
- Modify: `server/src/controllers/agent-runner-mcp.controller.ts`
- Modify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`
- Modify: `server/src/controllers/index.ts`
- Modify: `server/src/services/index.ts`
- Modify: `server/src/services/agent-runner-tool-token.service.ts`
- Modify: `server/src/services/agent-runner-tool-token.service.spec.ts`
- Delete: `server/src/controllers/agent-runner-tool.controller.ts`
- Delete: `server/src/controllers/agent-runner-tool.controller.spec.ts`

- [ ] **Step 1: Update MCP controller/token tests before implementation**

In `server/src/controllers/agent-runner-mcp.controller.spec.ts`, change the guard import:

```ts
import { AgentRunnerTokenGuard } from 'src/controllers/agent-runner-token.guard';
```

Replace both provider arrays that currently include `AgentRunnerToolGuard` with:

```ts
AgentRunnerTokenGuard,
```

Replace the expected wrong-session message:

```ts
message: 'Invalid agent runner token',
```

Replace the verification-failure mock and expectation:

```ts
tokenService.verify.mockImplementation(() => {
  throw new UnauthorizedException('Agent runner token expired');
});
```

```ts
message: 'Agent runner token expired',
```

In `server/src/services/agent-runner-tool-token.service.spec.ts`, replace all expected unauthorized messages:

```ts
new UnauthorizedException('Invalid agent runner token');
```

and replace expired-token expectations:

```ts
new UnauthorizedException('Agent runner token expired');
```

- [ ] **Step 2: Run focused server tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-runner-mcp.controller.spec.ts agent-runner-tool-token.service.spec.ts agent-legacy-gateway-removal.spec.ts
```

Expected: FAIL because `server/src/controllers/agent-runner-token.guard.ts` does not exist yet, token errors still say "tool token", and the old controller still exists.

- [ ] **Step 3: Create the moved runner token guard**

Create `server/src/controllers/agent-runner-token.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { AuthRequest } from 'src/middleware/auth.guard';
import { AgentRunnerToolTokenService } from 'src/services/agent-runner-tool-token.service';

const INVALID_TOKEN = 'Invalid agent runner token';

@Injectable()
export class AgentRunnerTokenGuard implements CanActivate {
  constructor(private readonly tokenService: AgentRunnerToolTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = this.getBearerToken(request.headers.authorization);
    const claims = this.tokenService.verify(token);
    if (claims.sessionId !== request.params.id) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    request.user = { user: { id: claims.userId } } as AuthDto;
    return true;
  }

  private getBearerToken(authorization: string | undefined) {
    if (!authorization) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    const [scheme, token, extra] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token || extra !== undefined) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    return token;
  }
}
```

- [ ] **Step 4: Point MCP controller and service registration at the moved guard**

In `server/src/controllers/agent-runner-mcp.controller.ts`, replace:

```ts
import { AgentRunnerToolGuard } from 'src/controllers/agent-runner-tool.controller';
```

with:

```ts
import { AgentRunnerTokenGuard } from 'src/controllers/agent-runner-token.guard';
```

and replace:

```ts
@UseGuards(AgentRunnerToolGuard)
```

with:

```ts
@UseGuards(AgentRunnerTokenGuard)
```

In `server/src/services/index.ts`, replace:

```ts
import { AgentRunnerToolGuard } from 'src/controllers/agent-runner-tool.controller';
```

with:

```ts
import { AgentRunnerTokenGuard } from 'src/controllers/agent-runner-token.guard';
```

and replace the services array entry:

```ts
AgentRunnerToolGuard,
```

with:

```ts
AgentRunnerTokenGuard,
```

- [ ] **Step 5: Update runner token user-visible errors**

In `server/src/services/agent-runner-tool-token.service.ts`, replace:

```ts
const INVALID_TOKEN = 'Invalid agent runner tool token';
```

with:

```ts
const INVALID_TOKEN = 'Invalid agent runner token';
```

and replace:

```ts
throw new UnauthorizedException('Agent runner tool token expired');
```

with:

```ts
throw new UnauthorizedException('Agent runner token expired');
```

- [ ] **Step 6: Remove the old controller from the app controller list**

In `server/src/controllers/index.ts`, delete this import:

```ts
import { AgentRunnerToolController } from 'src/controllers/agent-runner-tool.controller';
```

Delete this controllers array entry:

```ts
AgentRunnerToolController,
```

- [ ] **Step 7: Delete the legacy gateway controller and stale tests**

Delete:

```bash
git rm server/src/controllers/agent-runner-tool.controller.ts server/src/controllers/agent-runner-tool.controller.spec.ts
```

- [ ] **Step 8: Run focused server tests to verify they pass**

Run:

```bash
pnpm --dir server test agent-runner-mcp.controller.spec.ts agent-runner-tool-token.service.spec.ts agent-legacy-gateway-removal.spec.ts
```

Expected: PASS. The static guard only covers retired module files and old HTTP controller wiring in this task.

- [ ] **Step 9: Commit**

```bash
git add server/src/controllers/agent-runner-token.guard.ts \
  server/src/controllers/agent-runner-mcp.controller.ts \
  server/src/controllers/agent-runner-mcp.controller.spec.ts \
  server/src/controllers/index.ts \
  server/src/services/index.ts \
  server/src/services/agent-runner-tool-token.service.ts \
  server/src/services/agent-runner-tool-token.service.spec.ts \
  server/src/utils/agent-legacy-gateway-removal.spec.ts
git add -u server/src/controllers/agent-runner-tool.controller.ts server/src/controllers/agent-runner-tool.controller.spec.ts
git commit -m "refactor: remove legacy agent tool gateway controller"
```

Expected: Commit contains only server guard/controller/token cleanup and the static removal guard.

## Task 3: Remove Legacy Runner Protocol Guard And MCP-Shape Capabilities

**Files:**

- Modify: `agent-runner/src/server.mjs`
- Modify: `agent-runner/src/server.test.mjs`
- Modify: `server/src/dtos/agent-runner.dto.ts`
- Modify: `server/src/repositories/agent-runner.repository.spec.ts`
- Modify: `server/src/services/agent-runner.service.spec.ts`
- Modify: `server/src/utils/agent-legacy-gateway-removal.spec.ts`

- [ ] **Step 1: Add failing runner protocol/capability static assertions**

Append these tests inside `describe('legacy agent gateway removal', () => { ... })` in `server/src/utils/agent-legacy-gateway-removal.spec.ts`:

```ts
it('does not keep legacy toolGateway runner protocol plumbing', () => {
  expect(readRepo('agent-runner/src/server.mjs')).not.toContain('toolGateway');
});

it('keeps runner capability examples MCP-shaped instead of direct Gallery custom tool names', () => {
  const serverTest = readRepo('agent-runner/src/server.test.mjs');

  expect(serverTest).not.toContain("tools: ['proposeAlbumOperations']");
  expect(serverTest).not.toContain("tools: ['searchAssets'");
  expect(serverTest).toContain("tools: ['mcp:gallery']");
});
```

- [ ] **Step 2: Run the static guard to verify it fails**

Run:

```bash
pnpm --dir server test agent-legacy-gateway-removal.spec.ts
```

Expected: FAIL because `agent-runner/src/server.mjs` still contains `toolGateway` and `agent-runner/src/server.test.mjs` still contains old direct capability examples.

- [ ] **Step 3: Update runner tests before implementation**

In `agent-runner/src/server.test.mjs`, update `returns runtime-aware health capabilities` so the runtime returns MCP-shaped capabilities:

```js
getCapabilities: () => ({
  protocolVersion: '2026-05-14',
  streaming: true,
  tools: ['mcp:gallery'],
  models: ['e2e-album-organizer'],
  runtime: 'e2e',
}),
```

and the expected response uses:

```js
tools: ['mcp:gallery'],
```

In `accepts a Gallery MCP gateway without returning the gateway token`, update the fake runtime capabilities:

```js
tools: ['mcp_gallery_searchAssets', 'mcp_gallery_readAssetMetadata'],
```

and update the assertion:

```js
assert.deepEqual(JSON.parse(responseBody).capabilities.tools, [
  'mcp_gallery_searchAssets',
  'mcp_gallery_readAssetMetadata',
]);
```

Delete the entire stale test:

```js
it('rejects legacy Gallery toolGateway', async () => {
  await withServer(createRuntime(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        createSessionBody({
          toolGateway: {
            url: 'https://gallery.example.test/tools',
            token: 'gateway-token-secret',
          },
        }),
      ),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'toolGateway is no longer supported; use mcpGateway' });
  });
});
```

Add this new failing test near the other `POST /sessions` tests:

```js
it('forwards only supported create-session protocol fields to the runtime', async () => {
  const runtime = createRuntime();

  await withServer(runtime, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        createSessionBody({
          unexpectedGateway: {
            url: 'https://gallery.example.test/legacy',
            token: 'legacy-token-secret',
          },
          debug: 'runtime-internal-field',
        }),
      ),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(runtime.calls.createSession[0]).sort(), [
      'approvalMode',
      'credential',
      'gallerySessionId',
      'initialContext',
      'model',
      'permissionPlan',
      'permissionPreset',
    ]);
    assert.equal(runtime.calls.createSession[0].unexpectedGateway, undefined);
    assert.equal(runtime.calls.createSession[0].debug, undefined);
  });
});
```

- [ ] **Step 4: Update server capability text/tests before implementation**

In `server/src/dtos/agent-runner.dto.ts`, replace:

```ts
tools: z.array(z.string()).describe('Tool names reported by the runner'),
```

with:

```ts
tools: z.array(z.string()).describe('MCP tool or capability identifiers reported by the runner'),
```

In `server/src/repositories/agent-runner.repository.spec.ts`, update the health normalization fixture from old direct names:

```ts
tools: ['echo', 123, 'read_asset_metadata'],
```

to MCP-shaped values:

```ts
tools: ['mcp:gallery', 123, 'mcp_gallery_readAssetMetadata'],
```

and update the expectation:

```ts
tools: ['mcp:gallery', 'mcp_gallery_readAssetMetadata'],
```

In `server/src/services/agent-runner.service.spec.ts`, replace runner capability fixtures that currently use `tools: ['echo']` for active first-party runner sessions/status with MCP-shaped examples:

```ts
tools: ['mcp:gallery'],
```

Keep tests that intentionally verify arbitrary legacy persisted snapshots untouched if they are unrelated to runner health/session creation. Do not edit `AgentToolName`, MCP tool registry names, or `AgentToolService` test names.

- [ ] **Step 5: Run runner/server tests to verify the static guard still fails**

Run:

```bash
pnpm --dir agent-runner test
pnpm --dir server test agent-runner.repository.spec.ts agent-runner.service.spec.ts agent-legacy-gateway-removal.spec.ts
```

Expected: `agent-runner` tests FAIL because unknown top-level fields are still forwarded to the runtime. Server repository/service tests should pass. `agent-legacy-gateway-removal.spec.ts` should still FAIL because `agent-runner/src/server.mjs` still contains `toolGateway`.

- [ ] **Step 6: Remove the runner `toolGateway` validation branch**

In `agent-runner/src/server.mjs`, add a sanitizer after `validateCreateSessionBody`:

```js
const createSessionProtocolBody = (body) => ({
  gallerySessionId: body.gallerySessionId,
  credential: body.credential,
  model: body.model,
  permissionPreset: body.permissionPreset,
  permissionPlan: body.permissionPlan,
  approvalMode: body.approvalMode,
  initialContext: body.initialContext,
  ...('mcpGateway' in body ? { mcpGateway: body.mcpGateway } : {}),
});
```

Delete this block from `validateCreateSessionBody`:

```js
if (body.toolGateway !== undefined) {
  return 'toolGateway is no longer supported; use mcpGateway';
}
```

Do not change the `mcpGateway` validation block:

```js
if (body.mcpGateway !== undefined && body.mcpGateway !== null) {
  if (typeof body.mcpGateway !== 'object') {
    return 'mcpGateway is required';
  }

  if (typeof body.mcpGateway.url !== 'string' || body.mcpGateway.url.length === 0) {
    return 'mcpGateway.url is required';
  }

  if (typeof body.mcpGateway.token !== 'string' || body.mcpGateway.token.length === 0) {
    return 'mcpGateway.token is required';
  }
}
```

In the `POST /sessions` handler, replace:

```js
const runnerSession = normalizeRuntimeCreateSessionResponse(await runtime.createSession(result.body));
runnerSessions.set(runnerSession.runnerSessionId, result.body.gallerySessionId);
```

with:

```js
const sessionBody = createSessionProtocolBody(result.body);
const runnerSession = normalizeRuntimeCreateSessionResponse(await runtime.createSession(sessionBody));
runnerSessions.set(runnerSession.runnerSessionId, sessionBody.gallerySessionId);
```

- [ ] **Step 7: Run focused tests to verify they pass**

Run:

```bash
pnpm --dir agent-runner test
pnpm --dir server test agent-runner.repository.spec.ts agent-runner.service.spec.ts agent-legacy-gateway-removal.spec.ts
```

Expected: PASS. Runner still accepts missing or `null` `mcpGateway`, still rejects malformed non-null `mcpGateway`, forwards only supported protocol fields to runtime code, and no runner source contains `toolGateway`.

- [ ] **Step 8: Commit**

```bash
git add agent-runner/src/server.mjs agent-runner/src/server.test.mjs \
  server/src/dtos/agent-runner.dto.ts \
  server/src/repositories/agent-runner.repository.spec.ts \
  server/src/services/agent-runner.service.spec.ts \
  server/src/utils/agent-legacy-gateway-removal.spec.ts
git commit -m "refactor: remove legacy runner gateway protocol"
```

Expected: Commit contains runner protocol cleanup, MCP capability fixture updates, and the now-green static guard.

## Task 4: Final Regression Sweep And Intentional Reference Audit

**Files:**

- Modify only if the commands below expose stale references outside intentional migration tests/docs.

- [ ] **Step 1: Run the full focused server agent suite**

Run:

```bash
pnpm --dir server test \
  agent-legacy-gateway-removal.spec.ts \
  agent-deployment-config.spec.ts \
  config.repository.spec.ts \
  agent-runner-mcp.controller.spec.ts \
  agent-runner-tool-token.service.spec.ts \
  agent-mcp-tool-registry.service.spec.ts \
  agent-mcp.service.spec.ts \
  agent-runner.repository.spec.ts \
  agent-runner.service.spec.ts \
  agent-runner.controller.spec.ts \
  agent-session.service.spec.ts \
  agent-session.controller.spec.ts \
  agent-tool.dto.spec.ts \
  agent-operation.dto.spec.ts \
  agent-tool.service.spec.ts \
  agent-operation-plan.service.spec.ts
```

Expected: PASS. The deleted `agent-runner-tool.controller.spec.ts` must not appear in this command.

- [ ] **Step 2: Run full runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 3: Run lint for changed TypeScript files**

Run:

```bash
pnpm --dir server exec eslint \
  src/controllers/agent-runner-token.guard.ts \
  src/controllers/agent-runner-mcp.controller.ts \
  src/controllers/agent-runner-mcp.controller.spec.ts \
  src/controllers/index.ts \
  src/services/index.ts \
  src/services/agent-runner-tool-token.service.ts \
  src/services/agent-runner-tool-token.service.spec.ts \
  src/dtos/agent-runner.dto.ts \
  src/repositories/agent-runner.repository.spec.ts \
  src/services/agent-runner.service.spec.ts \
  src/utils/agent-legacy-gateway-removal.spec.ts \
  --max-warnings 0
```

Expected: PASS.

- [ ] **Step 4: Verify retired runner custom-tool names are absent**

Run:

```bash
rg -n "gallery-tools|gallery-tool-client|galleryToolNames" agent-runner/src server/src docs/docs docker e2e \
  --glob '!server/src/utils/agent-legacy-gateway-removal.spec.ts'
```

Expected: no output.

- [ ] **Step 5: Verify retired route wiring is absent**

Run:

```bash
rg -n "agent/internal/tools|AgentRunnerToolController|AgentRunnerToolGuard|agent-runner-tool.controller" server/src agent-runner/src docs/docs docker e2e \
  --glob '!server/src/repositories/config.repository.spec.ts' \
  --glob '!server/src/utils/agent-legacy-gateway-removal.spec.ts'
```

Expected: no output. The old env migration tests in `config.repository.spec.ts` may still use an old URL string and are intentionally excluded.

- [ ] **Step 6: Verify retired `toolGateway` runner protocol plumbing is absent**

Run:

```bash
rg -n "toolGateway" agent-runner/src server/src docs/docs docker e2e \
  --glob '!server/src/repositories/config.repository.spec.ts' \
  --glob '!server/src/services/agent-runner.service.spec.ts' \
  --glob '!server/src/utils/agent-legacy-gateway-removal.spec.ts'
```

Expected: no output. The excluded server tests intentionally assert that the old config/request property is not present.

- [ ] **Step 7: Verify old env name appears only in migration guards and docs**

Run:

```bash
rg -n "IMMICH_AGENT_TOOL_GATEWAY_URL" docker e2e docs/docs server/src \
  --glob '!server/src/dtos/env.dto.ts' \
  --glob '!server/src/repositories/config.repository.spec.ts' \
  --glob '!server/src/utils/agent-deployment-config.spec.ts'
```

Expected: only this intentional docs migration note:

```text
docs/docs/install/environment-variables.md:...:`IMMICH_AGENT_TOOL_GATEWAY_URL` is retired. Use `IMMICH_AGENT_MCP_GATEWAY_URL`.
```

- [ ] **Step 8: Verify whitespace and status**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: `git diff --check` has no output. Status shows only intentional Slice 7 changes plus any uncommitted Slice 6 files that were already present before Slice 7 execution.

- [ ] **Step 9: Commit final sweep changes if any**

If Steps 4-8 required additional stale-reference edits, commit them:

```bash
git add .
git commit -m "test: sweep retired agent gateway references"
```

Expected: No commit is needed when Tasks 1-3 already addressed every stale reference.

## Slice 7 Acceptance Checklist

- [ ] Static test fails if `gallery-tools.mjs` or `gallery-tool-client.mjs` exists or is imported.
- [ ] Static test fails if `galleryToolNames` returns to runner source.
- [ ] Static test fails if `AgentRunnerToolController` or `agent-runner-tool.controller` returns.
- [ ] Old `/agent/internal/tools/sessions/:id/...` controller and tests are deleted.
- [ ] MCP controller still uses session-scoped runner-token auth.
- [ ] Missing/malformed/wrong-session/expired runner tokens are still covered.
- [ ] MCP `tools/list` and `tools/call` integration tests still pass.
- [ ] Runner no longer contains `toolGateway` request-body validation or tests.
- [ ] Runner still validates non-null `mcpGateway.url` and `mcpGateway.token`.
- [ ] Runner strips unknown create-session request fields before calling runtime code.
- [ ] Runner and server capability fixtures use MCP identifiers.
- [ ] Old `IMMICH_AGENT_TOOL_GATEWAY_URL` appears only in migration validation/tests/docs.
- [ ] Full focused server agent suite passes.
- [ ] Full `agent-runner` suite passes.
- [ ] Lint and `git diff --check` pass.

## Execution Notes

- Execute this plan on top of the completed Slice 6 branch so the MCP gateway env rename and compose/package changes are already present.
- If Slice 6 is still uncommitted, keep Slice 7 commits logically separate or ask before squashing.
- The old `AgentRunnerToolTokenService` name remains for compatibility with the existing design and dependency graph; only route/controller wiring and user-facing token messages change in this slice.
