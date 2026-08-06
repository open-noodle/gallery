# Pi Agent MCP Slice 1 Protocol And Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first MCP vertical slice: an internal session-scoped MCP HTTP endpoint that authenticates runner tokens and handles `initialize` plus JSON-RPC protocol errors, with no Gallery domain tools yet.

**Architecture:** Gallery exposes `POST /api/agent/internal/mcp/sessions/:id` through a new Nest controller guarded by the existing runner token verifier. A small `AgentMcpService` owns JSON-RPC request validation, the `initialize` response, and protocol error formatting. The slice intentionally does not register `tools/list`, `tools/call`, `AgentToolService`, or `AgentOperationPlanService`.

**Tech Stack:** NestJS controllers/guards, existing `AgentRunnerToolTokenService`, Vitest, Supertest, TypeScript JSON-RPC types.

---

## Scope

This slice implements:

- Internal MCP route shell at `POST /agent/internal/mcp/sessions/:id` in controller tests and under `/api/...` in the running app.
- Bearer-token authentication using the existing session-scoped runner token claims.
- Rejection of missing, malformed, expired, wrong-signature, and wrong-session runner tokens.
- `initialize` JSON-RPC handling.
- JSON-RPC error responses for parsed but malformed protocol requests.
- An explicit first-slice decision that batch requests are unsupported.
- Regression coverage proving normal user auth is not invoked and Gallery domain tools are not wired into this slice.

This slice intentionally does not implement:

- `tools/list`.
- `tools/call`.
- Tool registry.
- DTO schema generation.
- Delegation to `AgentToolService` or `AgentOperationPlanService`.
- Runner Pi SDK MCP configuration.
- Config/env renames.

## Existing Context

Approved design spec:

- `docs/superpowers/specs/2026-05-16-pi-agent-mcp-server-design.md`

This plan covers only `Vertical Implementation Slices` -> `Slice 1: MCP
Protocol Skeleton And Auth` from the design. The design's top-level protocol
contract is completed across slices 1-4: this slice implements `initialize` and
protocol errors, slice 2 adds `tools/list`, and slices 3-4 add `tools/call`.

Relevant existing files:

- `server/src/controllers/agent-runner-tool.controller.ts`
  - Defines `AgentRunnerToolGuard`, which already parses `Authorization: Bearer ...`, verifies `AgentRunnerToolTokenService`, checks `claims.sessionId === request.params.id`, and sets `request.user`.
- `server/src/services/agent-runner-tool-token.service.ts`
  - Creates/verifies the signed session-scoped runner token.
- `server/src/controllers/agent-runner-tool.controller.spec.ts`
  - Existing guard/controller auth patterns for internal runner routes.
- `server/src/services/agent-runner-tool-token.service.spec.ts`
  - Existing malformed, tampered, expired, and missing-secret token coverage.
- `server/test/utils.ts`
  - Provides `controllerSetup`, global exception filter, `AuthGuard`, and `automock`.
- `server/src/controllers/index.ts`
  - Registers controllers in the API module.
- `server/src/services/index.ts`
  - Registers services in the API module.

## File Structure

Create:

- `server/src/types/agent-mcp.types.ts`
  - JSON-RPC request, response, error, and initialize-result types.
- `server/src/services/agent-mcp.service.ts`
  - Stateless JSON-RPC protocol handler for this slice.
- `server/src/services/agent-mcp.service.spec.ts`
  - TDD tests for `initialize`, malformed requests, unsupported methods, and unsupported batches.
- `server/src/controllers/agent-runner-mcp.controller.ts`
  - Internal runner-token-authenticated MCP HTTP endpoint.
- `server/src/controllers/agent-runner-mcp.controller.spec.ts`
  - TDD tests for route auth, session mismatch, HTTP status, invalid JSON transport behavior, and no normal user auth.

Modify:

- `server/src/controllers/index.ts`
  - Add `AgentRunnerMcpController`.
- `server/src/services/index.ts`
  - Add `AgentMcpService`.

Do not modify in this slice:

- `agent-runner/`
- `server/src/services/agent-tool.service.ts`
- `server/src/services/agent-operation-plan.service.ts`
- `server/src/types/agent-runner.types.ts`
- Docker or compose files

## Protocol Contract For Slice 1

Endpoint:

```http
POST /agent/internal/mcp/sessions/:id
Authorization: Bearer <runner-tool-token>
Content-Type: application/json
Accept: application/json, text/event-stream
```

Controller tests use the unprefixed path above. The running app exposes the same
route under the global `/api` prefix:

```http
POST /api/agent/internal/mcp/sessions/:id
```

Successful `initialize` request:

```json
{
  "jsonrpc": "2.0",
  "id": "init-1",
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {
      "name": "pi-agent-runner",
      "version": "0.1.0"
    }
  }
}
```

Successful `initialize` response:

```json
{
  "jsonrpc": "2.0",
  "id": "init-1",
  "result": {
    "protocolVersion": "2025-11-25",
    "serverInfo": {
      "name": "gallery-agent-mcp",
      "version": "<serverVersion>"
    },
    "capabilities": {}
  }
}
```

`capabilities` is empty in slice 1 because `tools/list` is not implemented yet. Slice 2 updates this response when the tool registry exists.

Protocol error shape:

```json
{
  "jsonrpc": "2.0",
  "id": "request-id-or-null",
  "error": {
    "code": -32600,
    "message": "Invalid Request"
  }
}
```

Unsupported method shape:

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "error": {
    "code": -32601,
    "message": "Method not found",
    "data": {
      "method": "tools/list"
    }
  }
}
```

Syntactically invalid JSON is rejected by the existing Express JSON parser before the MCP service receives it. This slice covers that transport edge with an HTTP `400` controller test and covers parsed malformed JSON-RPC bodies with JSON-RPC error response tests.

## Edge Case Matrix

| Edge Case                                                            | Expected Result                                                                                 | Test Location                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Missing bearer token                                                 | HTTP `401`, service not called                                                                  | `agent-runner-mcp.controller.spec.ts`     |
| `Basic` auth                                                         | HTTP `401`, token verifier not called                                                           | `agent-runner-mcp.controller.spec.ts`     |
| Empty `Bearer` token                                                 | HTTP `401`, token verifier not called                                                           | `agent-runner-mcp.controller.spec.ts`     |
| Extra bearer parts                                                   | HTTP `401`, token verifier not called                                                           | `agent-runner-mcp.controller.spec.ts`     |
| Token verifier throws expired/invalid                                | HTTP `401`, service not called                                                                  | `agent-runner-mcp.controller.spec.ts`     |
| Wrong-signature token                                                | HTTP `401`, covered by token verifier regression                                                | `agent-runner-tool-token.service.spec.ts` |
| Token claims session differs from route `:id`                        | HTTP `401`, service not called                                                                  | `agent-runner-mcp.controller.spec.ts`     |
| Valid token and `initialize`                                         | HTTP `200`, JSON-RPC initialize response                                                        | Both specs                                |
| Repeated requests reuse the same valid token without widening access | HTTP `200` for each same-session request                                                        | `agent-runner-mcp.controller.spec.ts`     |
| Normal Gallery `AuthGuard` would otherwise run                       | `ctx.authenticate` is not called                                                                | `agent-runner-mcp.controller.spec.ts`     |
| Request body is not syntactically valid JSON                         | HTTP `400`, MCP service not called                                                              | `agent-runner-mcp.controller.spec.ts`     |
| Parsed body is `null`                                                | JSON-RPC `-32600`, id `null`                                                                    | `agent-mcp.service.spec.ts`               |
| Parsed body is an array batch                                        | JSON-RPC `-32600`, id `null`, unsupported batch message                                         | `agent-mcp.service.spec.ts`               |
| Missing `jsonrpc`                                                    | JSON-RPC `-32600`                                                                               | `agent-mcp.service.spec.ts`               |
| Missing `id`                                                         | JSON-RPC `-32600`, id `null`                                                                    | `agent-mcp.service.spec.ts`               |
| Unsupported `id` type                                                | JSON-RPC `-32600`, id `null`                                                                    | `agent-mcp.service.spec.ts`               |
| Missing `method`                                                     | JSON-RPC `-32600`                                                                               | `agent-mcp.service.spec.ts`               |
| Unknown method                                                       | JSON-RPC `-32601` with method in `data`                                                         | `agent-mcp.service.spec.ts`               |
| `tools/list` before slice 2                                          | JSON-RPC `-32601`                                                                               | `agent-mcp.service.spec.ts`               |
| `tools/call` before slice 3                                          | JSON-RPC `-32601`                                                                               | `agent-mcp.service.spec.ts`               |
| Accidental domain service wiring                                     | `rg` verification finds no `AgentToolService` or `AgentOperationPlanService` in MCP slice files | Final verification                        |

The design's closed, deleted, or wrong-owner `agent_session` edge cases are not
loaded by this protocol skeleton. They remain covered by the existing service
validation in the later `tools/call` slices, where MCP delegates to
`AgentToolService` and `AgentOperationPlanService`.

## Implementation Tasks

### Task 1: Write Failing Unit Tests For The MCP Protocol Service

**Files:**

- Create: `server/src/services/agent-mcp.service.spec.ts`
- Later create: `server/src/services/agent-mcp.service.ts`
- Later create: `server/src/types/agent-mcp.types.ts`

- [ ] **Step 1: Add the service spec first**

Create `server/src/services/agent-mcp.service.spec.ts`:

```ts
import { serverVersion } from 'src/constants';
import { AgentMcpService } from 'src/services/agent-mcp.service';

describe(AgentMcpService.name, () => {
  let sut: AgentMcpService;

  beforeEach(() => {
    sut = new AgentMcpService();
  });

  it('returns the MCP initialize result without advertising tools in slice 1', () => {
    expect(
      sut.handle({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'pi-agent-runner', version: '0.1.0' },
        },
      }),
    ).toEqual({
      jsonrpc: '2.0',
      id: 'init-1',
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: {
          name: 'gallery-agent-mcp',
          version: serverVersion.toString(),
        },
        capabilities: {},
      },
    });
  });

  it('preserves numeric JSON-RPC request ids for initialize', () => {
    expect(
      sut.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    ).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: {
          name: 'gallery-agent-mcp',
          version: serverVersion.toString(),
        },
        capabilities: {},
      },
    });
  });

  it.each([
    ['null body', null],
    ['primitive body', 'not-an-object'],
    ['missing jsonrpc', { id: '1', method: 'initialize' }],
    ['wrong jsonrpc version', { jsonrpc: '1.0', id: '1', method: 'initialize' }],
    ['missing id', { jsonrpc: '2.0', method: 'initialize' }],
    ['null id', { jsonrpc: '2.0', id: null, method: 'initialize' }],
    ['object id', { jsonrpc: '2.0', id: { nested: true }, method: 'initialize' }],
    ['missing method', { jsonrpc: '2.0', id: '1' }],
    ['non-string method', { jsonrpc: '2.0', id: '1', method: 123 }],
  ] as const)('returns invalid request for %s', (_name, body) => {
    expect(sut.handle(body)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: 'Invalid Request',
      },
    });
  });

  it('explicitly rejects batch requests in the first slice', () => {
    expect(
      sut.handle([
        {
          jsonrpc: '2.0',
          id: 'init-1',
          method: 'initialize',
        },
      ]),
    ).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: 'Batch requests are not supported',
      },
    });
  });

  it.each(['tools/list', 'tools/call', 'resources/list'] as const)('returns method-not-found for %s', (method) => {
    expect(
      sut.handle({
        jsonrpc: '2.0',
        id: 7,
        method,
      }),
    ).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: {
        code: -32601,
        message: 'Method not found',
        data: { method },
      },
    });
  });
});
```

- [ ] **Step 2: Run the service spec and confirm the expected red failure**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts
```

Expected: FAIL because `src/services/agent-mcp.service` does not exist.

### Task 2: Implement The Minimal MCP Protocol Service

**Files:**

- Create: `server/src/types/agent-mcp.types.ts`
- Create: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/index.ts`
- Test: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add MCP JSON-RPC types**

Create `server/src/types/agent-mcp.types.ts`:

```ts
export type AgentMcpRequestId = string | number;

export type AgentMcpError = {
  code: number;
  message: string;
  data?: unknown;
};

export type AgentMcpSuccessResponse = {
  jsonrpc: '2.0';
  id: AgentMcpRequestId;
  result: unknown;
};

export type AgentMcpErrorResponse = {
  jsonrpc: '2.0';
  id: AgentMcpRequestId | null;
  error: AgentMcpError;
};

export type AgentMcpResponse = AgentMcpSuccessResponse | AgentMcpErrorResponse;

export type AgentMcpInitializeResult = {
  protocolVersion: string;
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities: Record<string, never>;
};
```

- [ ] **Step 2: Add the protocol service**

Create `server/src/services/agent-mcp.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { serverVersion } from 'src/constants';
import type {
  AgentMcpErrorResponse,
  AgentMcpInitializeResult,
  AgentMcpRequestId,
  AgentMcpResponse,
} from 'src/types/agent-mcp.types';

const MCP_PROTOCOL_VERSION = '2025-11-25';

@Injectable()
export class AgentMcpService {
  handle(request: unknown): AgentMcpResponse {
    if (Array.isArray(request)) {
      return this.error(null, -32600, 'Batch requests are not supported');
    }

    if (!this.isJsonObject(request)) {
      return this.invalidRequest();
    }

    const id = this.getRequestId(request.id);
    if (id === null || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return this.invalidRequest();
    }

    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: this.getInitializeResult(),
      };
    }

    return this.error(id, -32601, 'Method not found', { method: request.method });
  }

  private getInitializeResult(): AgentMcpInitializeResult {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: {
        name: 'gallery-agent-mcp',
        version: serverVersion.toString(),
      },
      capabilities: {},
    };
  }

  private invalidRequest(): AgentMcpErrorResponse {
    return this.error(null, -32600, 'Invalid Request');
  }

  private error(id: AgentMcpRequestId | null, code: number, message: string, data?: unknown): AgentMcpErrorResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: data === undefined ? { code, message } : { code, message, data },
    };
  }

  private getRequestId(value: unknown): AgentMcpRequestId | null {
    return typeof value === 'string' || typeof value === 'number' ? value : null;
  }

  private isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
```

- [ ] **Step 3: Register the service**

Modify `server/src/services/index.ts`:

```ts
import { AgentMcpService } from 'src/services/agent-mcp.service';
```

Add `AgentMcpService` to the `services` array near the other agent services:

```ts
  AgentMessageService,
  AgentMcpService,
  AgentOperationPlanService,
```

- [ ] **Step 4: Run the service spec and confirm green**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts
```

Expected: PASS for all `AgentMcpService` tests.

- [ ] **Step 5: Commit the service slice**

```bash
git add server/src/types/agent-mcp.types.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/index.ts
git commit -m "feat: add agent mcp protocol skeleton"
```

### Task 3: Write Failing Controller Tests For Runner Token Auth

**Files:**

- Create: `server/src/controllers/agent-runner-mcp.controller.spec.ts`
- Later create: `server/src/controllers/agent-runner-mcp.controller.ts`
- Use existing: `server/src/controllers/agent-runner-tool.controller.ts`
- Use existing: `server/src/services/agent-runner-tool-token.service.ts`

- [ ] **Step 1: Add the controller spec first**

Create `server/src/controllers/agent-runner-mcp.controller.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { AgentRunnerMcpController } from 'src/controllers/agent-runner-mcp.controller';
import { AgentRunnerToolGuard } from 'src/controllers/agent-runner-tool.controller';
import { AgentMcpService } from 'src/services/agent-mcp.service';
import { AgentRunnerToolTokenService } from 'src/services/agent-runner-tool-token.service';
import type { AgentMcpResponse } from 'src/types/agent-mcp.types';
import request from 'supertest';
import { factory } from 'test/small.factory';
import type { ControllerContext } from 'test/utils';
import { automock, controllerSetup } from 'test/utils';

describe(AgentRunnerMcpController.name, () => {
  let ctx: ControllerContext;

  const service = automock(AgentMcpService, { strict: false });
  const tokenService = automock(AgentRunnerToolTokenService, {
    args: [{} as never],
    strict: false,
  });

  const sessionId = factory.uuid();
  const userId = factory.uuid();
  const token = 'runner-mcp-token';
  const authorization = `Bearer ${token}`;
  const initializeRequest = {
    jsonrpc: '2.0',
    id: 'init-1',
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'pi-agent-runner', version: '0.1.0' },
    },
  };
  const initializeResponse = {
    jsonrpc: '2.0',
    id: 'init-1',
    result: {
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'gallery-agent-mcp', version: '2.7.5' },
      capabilities: {},
    },
  } satisfies AgentMcpResponse;

  beforeAll(async () => {
    ctx = await controllerSetup(AgentRunnerMcpController, [
      AgentRunnerToolGuard,
      { provide: AgentRunnerToolTokenService, useValue: tokenService },
      { provide: AgentMcpService, useValue: service },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    tokenService.resetAllMocks();
    ctx.reset();
    tokenService.verify.mockReturnValue({
      sessionId,
      userId,
      expiresAt: new Date('2026-05-16T12:00:00.000Z'),
    });
    service.handle.mockReturnValue(initializeResponse);
  });

  it('verifies the bearer token and returns the MCP response without normal Gallery auth', async () => {
    const { status, body } = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .set('Accept', 'application/json, text/event-stream')
      .send(initializeRequest);

    expect(status).toBe(200);
    expect(tokenService.verify).toHaveBeenCalledWith(token);
    expect(service.handle).toHaveBeenCalledWith(initializeRequest);
    expect(ctx.authenticate).not.toHaveBeenCalled();
    expect(body).toEqual(initializeResponse);
  });

  it('allows repeated requests with the same valid session token', async () => {
    const secondResponse = {
      jsonrpc: '2.0',
      id: 'init-2',
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'gallery-agent-mcp', version: '2.7.5' },
        capabilities: {},
      },
    } satisfies AgentMcpResponse;
    service.handle.mockReturnValueOnce(initializeResponse).mockReturnValueOnce(secondResponse);

    const first = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .send(initializeRequest);
    const second = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .send({ ...initializeRequest, id: 'init-2' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(tokenService.verify).toHaveBeenCalledTimes(2);
    expect(service.handle).toHaveBeenNthCalledWith(1, initializeRequest);
    expect(service.handle).toHaveBeenNthCalledWith(2, { ...initializeRequest, id: 'init-2' });
    expect(ctx.authenticate).not.toHaveBeenCalled();
  });

  it('rejects a valid token for a different session without calling the MCP service', async () => {
    tokenService.verify.mockReturnValue({
      sessionId: factory.uuid(),
      userId,
      expiresAt: new Date('2026-05-16T12:00:00.000Z'),
    });

    const { status, body } = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .send(initializeRequest);

    expect(status).toBe(401);
    expect(body).toMatchObject({
      error: 'Unauthorized',
      message: 'Invalid agent runner tool token',
      statusCode: 401,
    });
    expect(service.handle).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'Basic abc', 'Bearer ', 'Bearer token extra'])(
    'rejects missing or invalid bearer auth %s without verifying the token',
    async (header) => {
      const requestBuilder = request(ctx.getHttpServer())
        .post(`/agent/internal/mcp/sessions/${sessionId}`)
        .send(initializeRequest);
      if (header !== undefined) {
        requestBuilder.set('Authorization', header);
      }

      const { status } = await requestBuilder;

      expect(status).toBe(401);
      expect(tokenService.verify).not.toHaveBeenCalled();
      expect(service.handle).not.toHaveBeenCalled();
    },
  );

  it('returns 401 when token verification fails', async () => {
    tokenService.verify.mockImplementation(() => {
      throw new UnauthorizedException('Agent runner tool token expired');
    });

    const { status, body } = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .send(initializeRequest);

    expect(status).toBe(401);
    expect(body).toMatchObject({
      error: 'Unauthorized',
      message: 'Agent runner tool token expired',
      statusCode: 401,
    });
    expect(service.handle).not.toHaveBeenCalled();
  });

  it('rejects syntactically invalid JSON before the MCP service runs', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .set('Content-Type', 'application/json')
      .send('{"jsonrpc":');

    expect(status).toBe(400);
    expect(service.handle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the controller spec and confirm the expected red failure**

Run:

```bash
pnpm --dir server test agent-runner-mcp.controller.spec.ts
```

Expected: FAIL because `src/controllers/agent-runner-mcp.controller` does not exist.

### Task 4: Implement The Internal MCP Controller

**Files:**

- Create: `server/src/controllers/agent-runner-mcp.controller.ts`
- Modify: `server/src/controllers/index.ts`
- Test: `server/src/controllers/agent-runner-mcp.controller.spec.ts`

- [ ] **Step 1: Add the controller**

Create `server/src/controllers/agent-runner-mcp.controller.ts`:

```ts
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { ApiTag } from 'src/enum';
import { AgentRunnerToolGuard } from 'src/controllers/agent-runner-tool.controller';
import { AgentMcpService } from 'src/services/agent-mcp.service';
import type { AgentMcpResponse } from 'src/types/agent-mcp.types';

const history = () => new HistoryBuilder().added('v2.7.5').internal('v2.7.5');

@ApiTags(ApiTag.AgentSessions)
@Controller('agent/internal/mcp/sessions/:id')
@UseGuards(AgentRunnerToolGuard)
export class AgentRunnerMcpController {
  constructor(private readonly service: AgentMcpService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'MCP JSON-RPC response' })
  @Endpoint({
    summary: 'Handle the internal runner MCP endpoint',
    description: 'Internal runner MCP endpoint for a first-party Pi agent session.',
    history: history(),
  })
  handle(@Body() body: unknown): AgentMcpResponse {
    return this.service.handle(body);
  }
}
```

- [ ] **Step 2: Register the controller**

Modify `server/src/controllers/index.ts`:

```ts
import { AgentRunnerMcpController } from 'src/controllers/agent-runner-mcp.controller';
```

Add `AgentRunnerMcpController` near the other agent controllers:

```ts
  AgentProviderCredentialController,
  AgentRunnerController,
  AgentRunnerMcpController,
  AgentRunnerToolController,
```

- [ ] **Step 3: Run the controller spec and confirm green**

Run:

```bash
pnpm --dir server test agent-runner-mcp.controller.spec.ts
```

Expected: PASS for all `AgentRunnerMcpController` tests.

- [ ] **Step 4: Run the existing internal tool controller spec to catch guard regressions**

Run:

```bash
pnpm --dir server test agent-runner-tool.controller.spec.ts
```

Expected: PASS. The old hardcoded gateway still exists until the later legacy-removal slice.

- [ ] **Step 5: Commit the controller slice**

```bash
git add server/src/controllers/agent-runner-mcp.controller.ts server/src/controllers/agent-runner-mcp.controller.spec.ts server/src/controllers/index.ts
git commit -m "feat: add runner mcp endpoint auth"
```

### Task 5: Run Slice 1 Regression And Edge Verification

**Files:**

- Verify all files touched by Tasks 1-4.

- [ ] **Step 1: Run focused slice tests**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts agent-runner-mcp.controller.spec.ts agent-runner-tool-token.service.spec.ts agent-runner-tool.controller.spec.ts agent-session.service.spec.ts
```

Expected: PASS for all focused slice and nearby regression tests.

- [ ] **Step 2: Run TypeScript checking**

Run:

```bash
pnpm --dir server check
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Verify no Gallery domain tool service was wired into slice 1**

Run:

```bash
rg -n "AgentToolService|AgentOperationPlanService|['\"]tools/(list|call)['\"]" server/src/controllers/agent-runner-mcp.controller.ts server/src/services/agent-mcp.service.ts
```

Expected: no output and exit code `1`.

There must be no `AgentToolService` or `AgentOperationPlanService` matches. `tools/list` and `tools/call` may appear only in tests for unsupported methods, not in production MCP slice code.

- [ ] **Step 4: Run whitespace and formatting checks for the touched files**

Run:

```bash
git diff --check HEAD~2..HEAD
pnpm --dir server exec eslint src/services/agent-mcp.service.ts src/services/agent-mcp.service.spec.ts src/controllers/agent-runner-mcp.controller.ts src/controllers/agent-runner-mcp.controller.spec.ts --max-warnings 0
```

Expected: both commands PASS.

- [ ] **Step 5: Commit any verification-only fixes**

If Step 4 requires formatting or lint fixes, make only those mechanical fixes and commit:

```bash
git add server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/controllers/agent-runner-mcp.controller.ts server/src/controllers/agent-runner-mcp.controller.spec.ts server/src/controllers/index.ts server/src/services/index.ts
git commit -m "fix: polish agent mcp slice 1"
```

If Step 4 passes without edits, do not create an empty commit.

## Completion Checklist

- [ ] Service tests were written before `AgentMcpService`.
- [ ] Controller tests were written before `AgentRunnerMcpController`.
- [ ] Red failures were observed for missing service/controller files.
- [ ] `initialize` returns `protocolVersion`, `serverInfo`, and empty `capabilities`.
- [ ] Missing and malformed bearer headers return `401` before token verification.
- [ ] Token verification failures return `401` before the MCP service runs.
- [ ] Wrong-signature token rejection remains covered by `AgentRunnerToolTokenService`.
- [ ] Token/session mismatch returns `401` before the MCP service runs.
- [ ] Repeated same-session requests can reuse the same valid token until expiry.
- [ ] Valid runner token does not invoke normal Gallery user auth.
- [ ] Parsed malformed JSON-RPC bodies return JSON-RPC errors.
- [ ] Syntactically invalid JSON transport returns HTTP `400` and does not run the MCP service.
- [ ] Batch requests are explicitly unsupported with a protocol error.
- [ ] `tools/list` and `tools/call` return `Method not found` in slice 1.
- [ ] No Gallery domain tool services are imported by the MCP controller or service.
- [ ] Focused server tests pass.
- [ ] TypeScript check passes.

## Execution Handoff

Plan complete when this file is committed or accepted for execution. Use one of these execution modes:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, and keep commits small.

**2. Inline Execution** - execute tasks in this session using `superpowers:executing-plans`, with checkpoints after each task.
