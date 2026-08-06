# Pi Agent Runner Protocol Stub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build vertical slice 7 from `docs/superpowers/specs/2026-05-14-pi-agent-album-assistant-design.md`: add a first-party runner stub, create Gallery runner sessions through a server-owned protocol, echo user messages, and stream runner events through Gallery to the Assistant UI.

**Architecture:** Gallery remains the authority for auth, session ownership, transcript persistence, websocket fanout, and runner endpoint configuration. A new dependency-free `agent-runner` workspace package exposes a stub sidecar protocol over HTTP; the server calls it from `AgentRunnerRepository`, persists runner session metadata on `agent_session`, and emits per-session websocket events as streamed runner messages arrive. This slice does not call Pi/model providers, expose more tools, implement approvals UI, or create album operation plans.

**Tech Stack:** Node.js built-in HTTP for the stub runner, NestJS services/repositories/controllers, existing Socket.IO websocket channel, Svelte 5, `@immich/sdk`, Vitest, Node `node:test` for the stub package.

---

## Design Source

The approved design defines slice 7 as:

```text
Runner protocol stub
- sidecar service skeleton;
- create session and echo messages;
- streaming event path from runner through Gallery to UI;
- tests around server-runner contract.
```

Slices 1-6 are already present on `explore/pi-agent-brainstorm`: credential storage, session shell, persisted messages, runner health, internal metadata tool gate, and Assistant session setup UI.

## Scope

This slice implements:

- A new `agent-runner` workspace package with a dependency-free HTTP stub.
- `GET /health` on the runner returning the existing health/capability shape.
- `POST /sessions` on the runner returning a stub `runnerSessionId`.
- `POST /sessions/:runnerSessionId/messages` on the runner returning `text/event-stream` echo events.
- Server runner protocol client methods for runner session creation and message streaming.
- Server session creation handoff that stores `runnerEndpoint`, `runnerSessionId`, `runnerCapabilitiesSnapshot`, and moves new sessions to `running`.
- Server message dispatch that persists the user message, forwards it to the runner, persists the echoed assistant message, and emits websocket events to the session owner.
- A minimal Assistant chat panel that sends messages after session creation and renders user, streaming, and assistant messages.
- Focused server, runner, and web tests.

This slice intentionally does not implement:

- Real Pi runtime/model calls.
- Provider secret transfer to the runner.
- Runner authentication headers.
- Read tool expansion beyond the metadata tool added in slice 5.
- Tool approval UI.
- YOLO read mode.
- Structured album operation storage, review, or apply behavior.
- Docker Compose production wiring for the runner.

## File Structure

Create:

- `agent-runner/package.json` - workspace package manifest and scripts.
- `agent-runner/src/server.mjs` - dependency-free HTTP stub runner.
- `agent-runner/src/server.test.mjs` - Node `node:test` coverage for health, session creation, and message streaming.
- `server/src/types/agent-runner.types.ts` - server-side runner protocol request/response/event types.
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte` - minimal chat transcript/input UI for a created session.
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts` - component tests for send and websocket events.

Modify:

- `pnpm-workspace.yaml` - register `agent-runner`.
- `server/src/repositories/agent-runner.repository.ts` - add runner session creation and SSE message streaming.
- `server/src/repositories/agent-runner.repository.spec.ts` - cover the new protocol methods.
- `server/src/services/agent-runner.service.ts` - add server-owned runner start and message dispatch behavior.
- `server/src/services/agent-runner.service.spec.ts` - cover create-session and streamed echo behavior.
- `server/src/services/agent-session.service.ts` - call runner start after persisting the Gallery session.
- `server/src/services/agent-session.service.spec.ts` - cover runner metadata snapshot, running status, and failed runner start.
- `server/src/services/agent-message.service.ts` - forward appended user messages to the runner.
- `server/src/services/agent-message.service.spec.ts` - cover dispatch and non-dispatch cases.
- `server/src/repositories/websocket.repository.ts` - add `on_agent_session_event` to `ClientEventMap`.
- `server/src/services/index.ts` only if constructor dependency registration requires ordering changes after edits.
- `web/src/lib/stores/websocket.ts` - add `on_agent_session_event` typing.
- `web/src/routes/(user)/assistant/agent-session-page-content.svelte` - render chat panel after session creation.
- `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts` - assert chat panel appears after creation.
- `i18n/en.json` - add chat labels and error copy.
- `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`, and `mobile/openapi/**` only if `make open-api` changes generated output after server DTO/controller behavior changes. No new public REST route is planned, so generated changes should be limited or absent.

## Protocol Contracts

Runner health remains the slice-4 contract:

```http
GET /health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "capabilities": {
    "protocolVersion": "2026-05-14",
    "streaming": true,
    "tools": ["echo"],
    "models": []
  }
}
```

Runner session creation:

```http
POST /sessions
Content-Type: application/json
```

```json
{
  "gallerySessionId": "00000000-0000-4000-8000-000000000100",
  "credential": {
    "id": "00000000-0000-4000-8000-000000000001",
    "providerType": "openai",
    "label": "OpenAI personal",
    "baseUrl": null,
    "models": ["gpt-5.1"],
    "defaultModel": "gpt-5.1"
  },
  "model": "gpt-5.1",
  "permissionPreset": "careful",
  "permissionPlan": {
    "read": { "metadata": true, "previews": false, "originals": false },
    "providerExposure": {
      "metadata": true,
      "previews": false,
      "originals": false,
      "allowOriginalsForExternalProviders": false
    },
    "assetScope": { "owned": true, "sharedSpaces": false, "locked": false },
    "writeScope": { "createAlbum": true, "addAssets": true, "updateDetails": true, "setCover": true },
    "limits": {
      "maxAssetsPerToolCall": 200,
      "maxAssetsPerSession": 2000,
      "maxPreviewsPerToolCall": 0,
      "maxOriginalsPerToolCall": 0,
      "expiresInMinutes": 120
    }
  },
  "approvalMode": "strict",
  "initialContext": {}
}
```

```json
{
  "runnerSessionId": "stub-00000000-0000-4000-8000-000000000100",
  "capabilities": {
    "protocolVersion": "2026-05-14",
    "streaming": true,
    "tools": ["echo"],
    "models": []
  }
}
```

Runner message stream:

```http
POST /sessions/stub-00000000-0000-4000-8000-000000000100/messages
Accept: text/event-stream
Content-Type: application/json
```

```json
{
  "gallerySessionId": "00000000-0000-4000-8000-000000000100",
  "messageId": "00000000-0000-4000-8000-000000000200",
  "content": {
    "blocks": [{ "type": "text", "text": "Organize my Portugal photos." }]
  }
}
```

The runner responds with SSE frames:

```text
event: assistant-message-delta
data: {"type":"assistant-message-delta","sessionId":"00000000-0000-4000-8000-000000000100","runnerSessionId":"stub-00000000-0000-4000-8000-000000000100","delta":"Echo: Organize my Portugal photos.","sequence":1}

event: assistant-message-completed
data: {"type":"assistant-message-completed","sessionId":"00000000-0000-4000-8000-000000000100","runnerSessionId":"stub-00000000-0000-4000-8000-000000000100","providerMessageId":"stub-echo-00000000-0000-4000-8000-000000000200","content":{"blocks":[{"type":"text","text":"Echo: Organize my Portugal photos."}]}}
```

Gallery emits websocket events to the session owner's room:

```ts
type AgentSessionClientEvent =
  | {
      type: 'assistant-message-delta';
      sessionId: string;
      delta: string;
      sequence: number;
      createdAt: string;
    }
  | {
      type: 'assistant-message-created';
      sessionId: string;
      message: AgentMessageResponseDto;
      createdAt: string;
    }
  | {
      type: 'runner-error';
      sessionId: string;
      message: string;
      createdAt: string;
    };
```

## Task 1: Stub Runner Package

**Files:**

- Create: `agent-runner/package.json`
- Create: `agent-runner/src/server.mjs`
- Create: `agent-runner/src/server.test.mjs`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing runner package tests**

Create `agent-runner/src/server.test.mjs`.

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startServer } from './server.mjs';

const readSse = async (response) => {
  const body = await response.text();
  return body
    .trim()
    .split('\n\n')
    .map((frame) => {
      const lines = frame.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length);
      const data = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length);
      return { event, data: data ? JSON.parse(data) : null };
    });
};

const withServer = async (test) => {
  const server = await startServer({ port: 0 });
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.notEqual(address, null);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await test(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
};

describe('agent runner stub', () => {
  it('returns health capabilities', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        status: 'ok',
        version: '0.1.0',
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: ['echo'],
          models: [],
        },
      });
    });
  });

  it('creates a deterministic stub runner session', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          credential: { label: 'OpenAI personal' },
          model: 'gpt-5.1',
          permissionPreset: 'careful',
          permissionPlan: {},
          approvalMode: 'strict',
          initialContext: {},
        }),
      });

      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), {
        runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: ['echo'],
          models: [],
        },
      });
    });
  });

  it('rejects session creation without a Gallery session id', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: { label: 'OpenAI personal' },
          model: 'gpt-5.1',
          permissionPreset: 'careful',
          permissionPlan: {},
          approvalMode: 'strict',
          initialContext: {},
        }),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'gallerySessionId is required' });
    });
  });

  it('returns 400 for malformed session JSON', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'invalid JSON body' });
    });
  });

  it('streams echo events for a message', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions/stub-00000000-0000-4000-8000-000000000100/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          messageId: '00000000-0000-4000-8000-000000000200',
          content: { blocks: [{ type: 'text', text: 'Hello runner' }] },
        }),
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/event-stream');
      assert.deepEqual(await readSse(response), [
        {
          event: 'assistant-message-delta',
          data: {
            type: 'assistant-message-delta',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
            delta: 'Echo: Hello runner',
            sequence: 1,
          },
        },
        {
          event: 'assistant-message-completed',
          data: {
            type: 'assistant-message-completed',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
            providerMessageId: 'stub-echo-00000000-0000-4000-8000-000000000200',
            content: { blocks: [{ type: 'text', text: 'Echo: Hello runner' }] },
          },
        },
      ]);
    });
  });
});
```

- [ ] **Step 2: Run runner tests to verify they fail**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL because `agent-runner/package.json` and `agent-runner/src/server.mjs` do not exist yet.

- [ ] **Step 3: Implement the stub runner**

Create `agent-runner/src/server.mjs`.

```js
import { createServer } from 'node:http';

const capabilities = {
  protocolVersion: '2026-05-14',
  streaming: true,
  tools: ['echo'],
  models: [],
};

const sendJson = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};

const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString('utf8');
  return body.length === 0 ? {} : JSON.parse(body);
};

const readJsonOrSendError = async (request, response) => {
  try {
    return await readJson(request);
  } catch {
    sendJson(response, 400, { error: 'invalid JSON body' });
    return null;
  }
};

const firstTextBlock = (content) => {
  const block = content?.blocks?.find((item) => item?.type === 'text' && typeof item.text === 'string');
  return block?.text ?? '';
};

const sendSse = (response, event, data) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
};

export const startServer = ({
  port = Number(process.env.PORT ?? 4477),
  host = process.env.HOST ?? '127.0.0.1',
} = {}) => {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { status: 'ok', version: '0.1.0', capabilities });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/sessions') {
      const body = await readJsonOrSendError(request, response);
      if (!body) {
        return;
      }
      if (typeof body.gallerySessionId !== 'string') {
        sendJson(response, 400, { error: 'gallerySessionId is required' });
        return;
      }

      sendJson(response, 201, {
        runnerSessionId: `stub-${body.gallerySessionId}`,
        capabilities,
      });
      return;
    }

    const messageMatch = url.pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (request.method === 'POST' && messageMatch) {
      const body = await readJsonOrSendError(request, response);
      if (!body) {
        return;
      }
      const runnerSessionId = decodeURIComponent(messageMatch[1]);
      const text = firstTextBlock(body.content);
      const echo = `Echo: ${text}`;

      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      sendSse(response, 'assistant-message-delta', {
        type: 'assistant-message-delta',
        sessionId: body.gallerySessionId,
        runnerSessionId,
        delta: echo,
        sequence: 1,
      });
      sendSse(response, 'assistant-message-completed', {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId,
        providerMessageId: `stub-echo-${body.messageId}`,
        content: { blocks: [{ type: 'text', text: echo }] },
      });
      response.end();
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startServer();
  const address = server.address();
  if (address && typeof address === 'object') {
    console.log(`agent-runner listening on http://${address.address}:${address.port}`);
  }
}
```

Create `agent-runner/package.json`.

```json
{
  "name": "@open-noodle/agent-runner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.mjs",
    "test": "node --test src/*.test.mjs"
  }
}
```

Modify `pnpm-workspace.yaml`:

```yaml
packages:
  - agent-runner
  - cli
  - docs
  - e2e
  - e2e-auth-server
  - i18n
  - open-api/typescript-sdk
  - server
  - plugins
  - tools/upstream-preflight
  - web
  - .github
```

- [ ] **Step 4: Refresh the workspace lockfile**

Run:

```bash
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` records the new `agent-runner` workspace importer without adding runtime dependencies.

- [ ] **Step 5: Run runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS for health, session creation validation, malformed JSON handling, and streamed echo events.

- [ ] **Step 6: Commit runner stub**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml agent-runner
git commit -m "feat: add pi agent runner stub"
```

## Task 2: Server Runner Protocol Client

**Files:**

- Create: `server/src/types/agent-runner.types.ts`
- Modify: `server/src/repositories/agent-runner.repository.ts`
- Modify: `server/src/repositories/agent-runner.repository.spec.ts`

- [ ] **Step 1: Add shared protocol types**

Create `server/src/types/agent-runner.types.ts`.

```ts
import { AgentApprovalMode, AgentPermissionPreset } from 'src/enum';
import { AgentMessageContent } from 'src/types/agent-message.types';
import { AgentCredentialSnapshot, AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';

export type AgentRunnerCreateSessionRequest = {
  gallerySessionId: string;
  credential: AgentCredentialSnapshot;
  model: string;
  permissionPreset: AgentPermissionPreset;
  permissionPlan: AgentPermissionPlanSnapshot;
  approvalMode: AgentApprovalMode;
  initialContext: Record<string, unknown>;
};

export type AgentRunnerCreateSessionResult = {
  runnerSessionId: string;
  capabilities: Record<string, unknown>;
};

export type AgentRunnerMessageRequest = {
  gallerySessionId: string;
  messageId: string;
  content: AgentMessageContent;
};

export type AgentRunnerStreamEvent =
  | {
      type: 'assistant-message-delta';
      sessionId: string;
      runnerSessionId: string;
      delta: string;
      sequence: number;
    }
  | {
      type: 'assistant-message-completed';
      sessionId: string;
      runnerSessionId: string;
      providerMessageId: string | null;
      content: AgentMessageContent;
    };
```

- [ ] **Step 2: Write failing repository tests**

Extend `server/src/repositories/agent-runner.repository.spec.ts` with these tests. Add this import at the top of the spec:

```ts
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType } from 'src/enum';
```

```ts
it('creates a runner session through the configured runner URL', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 201,
    json: () =>
      Promise.resolve({
        runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
        capabilities: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
      }),
  });

  await expect(
    sut.createSession({
      url: 'https://gateway.local/pi-runner/',
      timeoutMs: 2500,
      body: {
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        credential: {
          id: '00000000-0000-4000-8000-000000000001',
          providerType: AgentProviderType.OpenAI,
          label: 'OpenAI personal',
          baseUrl: null,
          models: ['gpt-5.1'],
          defaultModel: 'gpt-5.1',
        },
        model: 'gpt-5.1',
        permissionPreset: AgentPermissionPreset.Careful,
        permissionPlan: {
          read: { metadata: true, previews: false, originals: false },
          providerExposure: {
            metadata: true,
            previews: false,
            originals: false,
            allowOriginalsForExternalProviders: false,
          },
          assetScope: { owned: true, sharedSpaces: false, locked: false },
          writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
          limits: {
            maxAssetsPerToolCall: 200,
            maxAssetsPerSession: 2000,
            maxPreviewsPerToolCall: 0,
            maxOriginalsPerToolCall: 0,
            expiresInMinutes: 120,
          },
        },
        approvalMode: AgentApprovalMode.Strict,
        initialContext: {},
      },
    }),
  ).resolves.toEqual({
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    capabilities: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
  });

  expect(mockFetch).toHaveBeenCalledWith(new URL('https://gateway.local/pi-runner/sessions'), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: expect.stringContaining('"gallerySessionId":"00000000-0000-4000-8000-000000000100"'),
    signal: expect.any(AbortSignal),
  });
});

it('throws when runner session creation returns an invalid body', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 201,
    json: () => Promise.resolve({ runnerSessionId: 123 }),
  });

  await expect(
    sut.createSession({
      url: 'http://agent-runner:4477',
      timeoutMs: 2500,
      body: {
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        credential: {
          id: '00000000-0000-4000-8000-000000000001',
          providerType: AgentProviderType.OpenAI,
          label: 'OpenAI personal',
          baseUrl: null,
          models: [],
          defaultModel: null,
        },
        model: 'gpt-5.1',
        permissionPreset: AgentPermissionPreset.Careful,
        permissionPlan: {
          read: { metadata: true, previews: false, originals: false },
          providerExposure: {
            metadata: true,
            previews: false,
            originals: false,
            allowOriginalsForExternalProviders: false,
          },
          assetScope: { owned: true, sharedSpaces: false, locked: false },
          writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
          limits: {
            maxAssetsPerToolCall: 200,
            maxAssetsPerSession: 2000,
            maxPreviewsPerToolCall: 0,
            maxOriginalsPerToolCall: 0,
            expiresInMinutes: 120,
          },
        },
        approvalMode: AgentApprovalMode.Strict,
        initialContext: {},
      },
    }),
  ).rejects.toThrow('Agent runner returned an invalid session response');
});

it('throws when runner session creation returns a non-success status', async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 502,
    json: () => Promise.resolve({ error: 'bad gateway' }),
  });

  await expect(
    sut.createSession({
      url: 'http://agent-runner:4477',
      timeoutMs: 2500,
      body: {
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        credential: {
          id: '00000000-0000-4000-8000-000000000001',
          providerType: AgentProviderType.OpenAI,
          label: 'OpenAI personal',
          baseUrl: null,
          models: [],
          defaultModel: null,
        },
        model: 'gpt-5.1',
        permissionPreset: AgentPermissionPreset.Careful,
        permissionPlan: {
          read: { metadata: true, previews: false, originals: false },
          providerExposure: {
            metadata: true,
            previews: false,
            originals: false,
            allowOriginalsForExternalProviders: false,
          },
          assetScope: { owned: true, sharedSpaces: false, locked: false },
          writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
          limits: {
            maxAssetsPerToolCall: 200,
            maxAssetsPerSession: 2000,
            maxPreviewsPerToolCall: 0,
            maxOriginalsPerToolCall: 0,
            expiresInMinutes: 120,
          },
        },
        approvalMode: AgentApprovalMode.Strict,
        initialContext: {},
      },
    }),
  ).rejects.toThrow('Agent runner session creation failed with status 502');
});

it('streams and normalizes runner message events', async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          [
            'event: assistant-message-delta',
            'data: {"type":"assistant-message-delta","sessionId":"00000000-0000-4000-8000-000000000100","runnerSessionId":"stub-1","delta":"Echo: Hello","sequence":1}',
            '',
            'event: assistant-message-completed',
            'data: {"type":"assistant-message-completed","sessionId":"00000000-0000-4000-8000-000000000100","runnerSessionId":"stub-1","providerMessageId":"stub-echo-1","content":{"blocks":[{"type":"text","text":"Echo: Hello"}]}}',
            '',
          ].join('\n'),
        ),
      );
      controller.close();
    },
  });
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  });

  const events = [];
  for await (const event of sut.streamMessage({
    url: 'http://agent-runner:4477',
    runnerSessionId: 'stub-1',
    timeoutMs: 2500,
    body: {
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      messageId: '00000000-0000-4000-8000-000000000200',
      content: { blocks: [{ type: 'text', text: 'Hello' }] },
    },
  })) {
    events.push(event);
  }

  expect(events).toEqual([
    {
      type: 'assistant-message-delta',
      sessionId: '00000000-0000-4000-8000-000000000100',
      runnerSessionId: 'stub-1',
      delta: 'Echo: Hello',
      sequence: 1,
    },
    {
      type: 'assistant-message-completed',
      sessionId: '00000000-0000-4000-8000-000000000100',
      runnerSessionId: 'stub-1',
      providerMessageId: 'stub-echo-1',
      content: { blocks: [{ type: 'text', text: 'Echo: Hello' }] },
    },
  ]);
});

it('parses a final SSE frame without a trailing blank-line separator', async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          [
            'event: assistant-message-completed',
            'data: {"type":"assistant-message-completed","sessionId":"00000000-0000-4000-8000-000000000100","runnerSessionId":"stub-1","providerMessageId":null,"content":{"blocks":[{"type":"text","text":"Done"}]}}',
          ].join('\n'),
        ),
      );
      controller.close();
    },
  });
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  });

  const events = [];
  for await (const event of sut.streamMessage({
    url: 'http://agent-runner:4477',
    runnerSessionId: 'stub-1',
    timeoutMs: 2500,
    body: {
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      messageId: '00000000-0000-4000-8000-000000000200',
      content: { blocks: [{ type: 'text', text: 'Hello' }] },
    },
  })) {
    events.push(event);
  }

  expect(events).toEqual([
    {
      type: 'assistant-message-completed',
      sessionId: '00000000-0000-4000-8000-000000000100',
      runnerSessionId: 'stub-1',
      providerMessageId: null,
      content: { blocks: [{ type: 'text', text: 'Done' }] },
    },
  ]);
});

it('throws when runner message streaming returns a non-success status', async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 500,
    body: null,
    headers: new Headers(),
  });

  await expect(
    (async () => {
      for await (const _event of sut.streamMessage({
        url: 'http://agent-runner:4477',
        runnerSessionId: 'stub-1',
        timeoutMs: 2500,
        body: {
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          messageId: '00000000-0000-4000-8000-000000000200',
          content: { blocks: [{ type: 'text', text: 'Hello' }] },
        },
      })) {
        // Drain the stream.
      }
    })(),
  ).rejects.toThrow('Agent runner message stream failed with status 500');
});

it('throws when runner message streaming returns no response body', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: null,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  });

  await expect(
    (async () => {
      for await (const _event of sut.streamMessage({
        url: 'http://agent-runner:4477',
        runnerSessionId: 'stub-1',
        timeoutMs: 2500,
        body: {
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          messageId: '00000000-0000-4000-8000-000000000200',
          content: { blocks: [{ type: 'text', text: 'Hello' }] },
        },
      })) {
        // Drain the stream.
      }
    })(),
  ).rejects.toThrow('Agent runner message stream failed with status 200');
});

it.each([
  ['invalid JSON', 'data: {not json}\n\n'],
  [
    'invalid event shape',
    'data: {"type":"assistant-message-completed","sessionId":"00000000-0000-4000-8000-000000000100","runnerSessionId":"stub-1","providerMessageId":null,"content":{"blocks":"not-array"}}\n\n',
  ],
])('throws when runner stream contains %s', async (_name, frame) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  });

  await expect(
    (async () => {
      for await (const _event of sut.streamMessage({
        url: 'http://agent-runner:4477',
        runnerSessionId: 'stub-1',
        timeoutMs: 2500,
        body: {
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          messageId: '00000000-0000-4000-8000-000000000200',
          content: { blocks: [{ type: 'text', text: 'Hello' }] },
        },
      })) {
        // Drain the stream.
      }
    })(),
  ).rejects.toThrow('Agent runner returned an invalid stream event');
});
```

Keep the repository spec request bodies explicit. Do not import `AgentSessionService` into production repository code.

- [ ] **Step 3: Run repository tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-runner.repository.spec.ts
```

Expected: FAIL because `createSession()` and `streamMessage()` do not exist yet.

- [ ] **Step 4: Implement repository protocol methods**

Modify `server/src/repositories/agent-runner.repository.ts`.

Add imports:

```ts
import {
  AgentRunnerCreateSessionRequest,
  AgentRunnerCreateSessionResult,
  AgentRunnerMessageRequest,
  AgentRunnerStreamEvent,
} from 'src/types/agent-runner.types';
```

Add helper functions near `getRunnerHealthUrl`:

```ts
const getRunnerUrl = (url: string, path: string) => {
  const runnerUrl = new URL(url);
  runnerUrl.pathname = `${runnerUrl.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  return runnerUrl;
};

const isCreateSessionResult = (value: unknown): value is AgentRunnerCreateSessionResult => {
  const body = objectRecord(value);
  return typeof body.runnerSessionId === 'string' && body.capabilities !== undefined;
};

const isStreamEvent = (value: unknown): value is AgentRunnerStreamEvent => {
  const body = objectRecord(value);
  if (body.type === 'assistant-message-delta') {
    return (
      typeof body.sessionId === 'string' &&
      typeof body.runnerSessionId === 'string' &&
      typeof body.delta === 'string' &&
      typeof body.sequence === 'number'
    );
  }

  if (body.type === 'assistant-message-completed') {
    return (
      typeof body.sessionId === 'string' &&
      typeof body.runnerSessionId === 'string' &&
      (typeof body.providerMessageId === 'string' || body.providerMessageId === null) &&
      Array.isArray(objectRecord(body.content).blocks)
    );
  }

  return false;
};

const parseSseFrame = (frame: string): AgentRunnerStreamEvent | null => {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLine.slice('data: '.length));
  } catch {
    throw new Error('Agent runner returned an invalid stream event');
  }

  if (!isStreamEvent(parsed)) {
    throw new Error('Agent runner returned an invalid stream event');
  }

  return parsed;
};

async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AgentRunnerStreamEvent> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += value;
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event) {
        yield event;
      }
    }
  }

  if (buffer.trim().length > 0) {
    const event = parseSseFrame(buffer);
    if (event) {
      yield event;
    }
  }
}
```

Change `getRunnerHealthUrl(url)` to use `getRunnerUrl(url, 'health')`.

Add methods to `AgentRunnerRepository`:

```ts
async createSession({
  url,
  timeoutMs,
  body,
}: {
  url: string;
  timeoutMs: number;
  body: AgentRunnerCreateSessionRequest;
}): Promise<AgentRunnerCreateSessionResult> {
  const response = await fetch(getRunnerUrl(url, 'sessions'), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Agent runner session creation failed with status ${response.status}`);
  }

  const result = await response.json();
  if (!isCreateSessionResult(result)) {
    throw new Error('Agent runner returned an invalid session response');
  }

  return result;
}

async *streamMessage({
  url,
  runnerSessionId,
  timeoutMs,
  body,
}: {
  url: string;
  runnerSessionId: string;
  timeoutMs: number;
  body: AgentRunnerMessageRequest;
}): AsyncGenerator<AgentRunnerStreamEvent> {
  const response = await fetch(getRunnerUrl(url, `sessions/${encodeURIComponent(runnerSessionId)}/messages`), {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Agent runner message stream failed with status ${response.status}`);
  }

  yield* parseSseStream(response.body);
}
```

- [ ] **Step 5: Run repository tests**

Run:

```bash
pnpm --dir server test agent-runner.repository.spec.ts
```

Expected: PASS for existing health tests plus create-session and message-stream tests.

- [ ] **Step 6: Commit protocol client**

```bash
git add server/src/types/agent-runner.types.ts server/src/repositories/agent-runner.repository.ts server/src/repositories/agent-runner.repository.spec.ts
git commit -m "feat: add agent runner protocol client"
```

## Task 3: Server Session Create Handoff

**Files:**

- Modify: `server/src/services/agent-runner.service.ts`
- Modify: `server/src/services/agent-runner.service.spec.ts`
- Modify: `server/src/services/agent-session.service.ts`
- Modify: `server/src/services/agent-session.service.spec.ts`
- Modify: `server/src/controllers/agent-session.controller.spec.ts`

- [ ] **Step 1: Write failing runner service start tests**

Extend `server/src/services/agent-runner.service.spec.ts`. Add these imports at the top of the spec:

```ts
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType } from 'src/enum';
```

```ts
it('creates a runner session through the configured runner', async () => {
  configRepository.getEnv.mockReturnValue({
    agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
  } as never);
  agentRunnerRepository.createSession.mockResolvedValue({
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    capabilities: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
  });

  await expect(
    sut.createSession({
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      credential: {
        id: '00000000-0000-4000-8000-000000000001',
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
        baseUrl: null,
        models: ['gpt-5.1'],
        defaultModel: 'gpt-5.1',
      },
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlan: {
        read: { metadata: true, previews: false, originals: false },
        providerExposure: {
          metadata: true,
          previews: false,
          originals: false,
          allowOriginalsForExternalProviders: false,
        },
        assetScope: { owned: true, sharedSpaces: false, locked: false },
        writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
        limits: {
          maxAssetsPerToolCall: 200,
          maxAssetsPerSession: 2000,
          maxPreviewsPerToolCall: 0,
          maxOriginalsPerToolCall: 0,
          expiresInMinutes: 120,
        },
      },
      approvalMode: AgentApprovalMode.Strict,
      initialContext: {},
    }),
  ).resolves.toEqual({
    runnerEndpoint: 'http://agent-runner:4477',
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
  });
  expect(agentRunnerRepository.createSession).toHaveBeenCalledWith({
    url: 'http://agent-runner:4477',
    timeoutMs: 3000,
    body: expect.objectContaining({
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      model: 'gpt-5.1',
    }),
  });
});

it('rejects runner session creation when the runner is not configured', async () => {
  configRepository.getEnv.mockReturnValue({
    agent: { runnerHealthTimeoutMs: 2000 },
  } as never);

  await expect(
    sut.createSession({
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      credential: {
        id: '00000000-0000-4000-8000-000000000001',
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
        baseUrl: null,
        models: [],
        defaultModel: null,
      },
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlan: {
        read: { metadata: true, previews: false, originals: false },
        providerExposure: {
          metadata: true,
          previews: false,
          originals: false,
          allowOriginalsForExternalProviders: false,
        },
        assetScope: { owned: true, sharedSpaces: false, locked: false },
        writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
        limits: {
          maxAssetsPerToolCall: 200,
          maxAssetsPerSession: 2000,
          maxPreviewsPerToolCall: 0,
          maxOriginalsPerToolCall: 0,
          expiresInMinutes: 120,
        },
      },
      approvalMode: AgentApprovalMode.Strict,
      initialContext: {},
    }),
  ).rejects.toThrow('Agent runner is not configured');
  expect(agentRunnerRepository.createSession).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run runner service tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-runner.service.spec.ts
```

Expected: FAIL because `AgentRunnerService.createSession()` does not exist.

- [ ] **Step 3: Implement runner service start method**

Modify `server/src/services/agent-runner.service.ts`.

Add imports:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentRunnerCreateSessionRequest } from 'src/types/agent-runner.types';
```

Add this method to `AgentRunnerService`:

```ts
async createSession(body: AgentRunnerCreateSessionRequest) {
  const { runnerUrl, runnerHealthTimeoutMs } = this.configRepository.getEnv().agent;
  if (!runnerUrl) {
    throw new BadRequestException('Agent runner is not configured');
  }

  const result = await this.agentRunnerRepository.createSession({
    url: runnerUrl,
    timeoutMs: runnerHealthTimeoutMs,
    body,
  });

  return {
    runnerEndpoint: runnerUrl,
    runnerSessionId: result.runnerSessionId,
    runnerCapabilitiesSnapshot: result.capabilities,
  };
}
```

- [ ] **Step 4: Write failing session service tests for runner handoff**

Extend `server/src/services/agent-session.service.spec.ts`.

```ts
it('starts a configured runner session and returns a running Gallery session', async () => {
  const createdSession = makeSession({
    id: '00000000-0000-4000-8000-000000000100',
    userId: auth.user.id,
    status: AgentSessionStatus.Created,
    runnerEndpoint: null,
    runnerSessionId: null,
    runnerCapabilitiesSnapshot: null,
  });
  const runningSession = makeSession({
    ...createdSession,
    status: AgentSessionStatus.Running,
    runnerEndpoint: 'http://agent-runner:4477',
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
  });

  credentials.getById.mockResolvedValue(credentialResponse);
  repository.create.mockResolvedValue(createdSession);
  repository.update.mockResolvedValue(runningSession);
  agentRunnerService.createSession.mockResolvedValue({
    runnerEndpoint: 'http://agent-runner:4477',
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
  });

  await expect(
    sut.create(auth, {
      providerCredentialId: credentialId,
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.Careful,
      approvalMode: AgentApprovalMode.Strict,
    }),
  ).resolves.toMatchObject({
    id: createdSession.id,
    status: AgentSessionStatus.Running,
    runnerEndpoint: 'http://agent-runner:4477',
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
  });
  expect(agentRunnerService.createSession).toHaveBeenCalledWith({
    gallerySessionId: createdSession.id,
    credential: createdSession.credentialSnapshot,
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.Careful,
    permissionPlan: createdSession.permissionPlanSnapshot,
    approvalMode: AgentApprovalMode.Strict,
    initialContext: {},
  });
  expect(repository.update).toHaveBeenCalledWith(auth.user.id, createdSession.id, {
    status: AgentSessionStatus.Running,
    runnerEndpoint: 'http://agent-runner:4477',
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
  });
});

it('marks the created session failed when runner start fails', async () => {
  const createdSession = makeSession({
    id: '00000000-0000-4000-8000-000000000100',
    userId: auth.user.id,
    status: AgentSessionStatus.Created,
  });

  credentials.getById.mockResolvedValue(credentialResponse);
  repository.create.mockResolvedValue(createdSession);
  agentRunnerService.createSession.mockRejectedValue(new BadRequestException('Agent runner is not configured'));

  await expect(
    sut.create(auth, {
      providerCredentialId: credentialId,
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.Careful,
      approvalMode: AgentApprovalMode.Strict,
    }),
  ).rejects.toThrow('Agent runner is not configured');
  expect(repository.update).toHaveBeenCalledWith(auth.user.id, createdSession.id, {
    status: AgentSessionStatus.Failed,
    endedAt: expect.any(Date),
  });
});
```

Add `AgentRunnerService` to the automock setup in this spec:

```ts
let agentRunnerService: ReturnType<typeof automock<AgentRunnerService>>;
```

Construct the SUT with the additional dependency:

```ts
agentRunnerService = automock(AgentRunnerService);
sut = new AgentSessionService(repository, credentials, agentRunnerService);
```

Update the existing `AgentSessionService.create()` success-path tests in the same TDD pass:

- Successful create tests must mock `agentRunnerService.createSession()` and `repository.update()` and expect a returned `AgentSessionStatus.Running` session with `runnerEndpoint`, `runnerSessionId`, and `runnerCapabilitiesSnapshot`.
- Existing tests that assert the initial `repository.create()` payload should keep asserting `status: AgentSessionStatus.Created` and `runnerEndpoint: dto.runnerEndpoint ?? null`, then additionally assert the second `repository.update()` call transitions the same session to `Running`.
- Validation and credential lookup failure tests must assert `agentRunnerService.createSession` is not called.
- Failure-path tests after `repository.create()` must assert the session is updated to `Failed` with `endedAt`.

Update `server/src/controllers/agent-session.controller.spec.ts` successful create expectations so the controller response includes the running session returned by `AgentSessionService`, not the pre-runner created state.

- [ ] **Step 5: Run session service and controller tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-session.service.spec.ts agent-session.controller.spec.ts
```

Expected: FAIL because `AgentSessionService` does not call the runner, its constructor does not accept `AgentRunnerService`, and controller expectations still reflect the old created-state response.

- [ ] **Step 6: Implement session create handoff**

Modify `server/src/services/agent-session.service.ts`.

Add import:

```ts
import { AgentRunnerService } from 'src/services/agent-runner.service';
```

Change the constructor:

```ts
constructor(
  private readonly repository: AgentSessionRepository,
  private readonly credentialService: AgentProviderCredentialService,
  private readonly agentRunnerService: AgentRunnerService,
) {}
```

Replace the return at the end of `create()` with runner handoff:

```ts
try {
  const runnerSession = await this.agentRunnerService.createSession({
    gallerySessionId: session.id,
    credential: session.credentialSnapshot,
    model: session.modelSnapshot.model,
    permissionPreset: session.permissionPreset,
    permissionPlan: session.permissionPlanSnapshot,
    approvalMode: session.approvalMode,
    initialContext: session.initialContextSnapshot,
  });

  const runningSession = await this.repository.update(auth.user.id, session.id, {
    status: AgentSessionStatus.Running,
    runnerEndpoint: runnerSession.runnerEndpoint,
    runnerSessionId: runnerSession.runnerSessionId,
    runnerCapabilitiesSnapshot: runnerSession.runnerCapabilitiesSnapshot,
  });

  return this.map(runningSession);
} catch (error) {
  await this.repository.update(auth.user.id, session.id, {
    status: AgentSessionStatus.Failed,
    endedAt: new Date(),
  });
  throw error;
}
```

Keep the existing `runnerEndpoint: dto.runnerEndpoint ?? null` assignment in the initial create payload for backward compatibility, but the successful runner handoff must overwrite it with the configured runner endpoint.

- [ ] **Step 7: Run session and runner service tests**

Run:

```bash
pnpm --dir server test agent-runner.service.spec.ts agent-session.service.spec.ts agent-session.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit server handoff**

```bash
git add server/src/services/agent-runner.service.ts server/src/services/agent-runner.service.spec.ts server/src/services/agent-session.service.ts server/src/services/agent-session.service.spec.ts server/src/controllers/agent-session.controller.spec.ts
git commit -m "feat: start runner sessions from agent sessions"
```

## Task 4: Message Dispatch And Websocket Events

**Files:**

- Modify: `server/src/services/agent-runner.service.ts`
- Modify: `server/src/services/agent-runner.service.spec.ts`
- Modify: `server/src/services/agent-message.service.ts`
- Modify: `server/src/services/agent-message.service.spec.ts`
- Modify: `server/src/repositories/websocket.repository.ts`
- Modify: `web/src/lib/stores/websocket.ts`

- [ ] **Step 1: Add websocket event typing**

Modify `server/src/repositories/websocket.repository.ts`.

Add import:

```ts
import { AgentMessageResponseDto } from 'src/dtos/agent-message.dto';
```

Add type near `ClientEventMap`:

```ts
export type AgentSessionClientEvent =
  | {
      type: 'assistant-message-delta';
      sessionId: string;
      delta: string;
      sequence: number;
      createdAt: string;
    }
  | {
      type: 'assistant-message-created';
      sessionId: string;
      message: AgentMessageResponseDto;
      createdAt: string;
    }
  | {
      type: 'runner-error';
      sessionId: string;
      message: string;
      createdAt: string;
    };
```

Add to `ClientEventMap`:

```ts
on_agent_session_event: [AgentSessionClientEvent];
```

Modify `web/src/lib/stores/websocket.ts`.

Add import:

```ts
import type { AgentMessageResponseDto } from '@immich/sdk';
```

Add the matching web type:

```ts
export type AgentSessionClientEvent =
  | {
      type: 'assistant-message-delta';
      sessionId: string;
      delta: string;
      sequence: number;
      createdAt: string;
    }
  | {
      type: 'assistant-message-created';
      sessionId: string;
      message: AgentMessageResponseDto;
      createdAt: string;
    }
  | {
      type: 'runner-error';
      sessionId: string;
      message: string;
      createdAt: string;
    };
```

Add to `Events`:

```ts
on_agent_session_event: (event: AgentSessionClientEvent) => void;
```

- [ ] **Step 2: Write failing runner service message tests**

Extend `server/src/services/agent-runner.service.spec.ts`. Add `AgentMessageRole` and `AgentSessionStatus` to the existing `src/enum` import, add automocks for `AgentMessageRepository`, `AgentSessionRepository`, and `WebsocketRepository` to the existing setup, then add this test.

Freeze system time for this describe block or these tests so websocket `createdAt` values are deterministic:

```ts
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-14T10:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});
```

```ts
it('streams a user message to the runner, emits deltas, and persists the completed assistant message', async () => {
  configRepository.getEnv.mockReturnValue({
    agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
  } as never);
  agentRunnerRepository.streamMessage.mockImplementation(async function* () {
    yield {
      type: 'assistant-message-delta',
      sessionId: '00000000-0000-4000-8000-000000000100',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      delta: 'Echo: Hello',
      sequence: 1,
    };
    yield {
      type: 'assistant-message-completed',
      sessionId: '00000000-0000-4000-8000-000000000100',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      providerMessageId: 'stub-echo-00000000-0000-4000-8000-000000000200',
      content: { blocks: [{ type: 'text', text: 'Echo: Hello' }] },
    };
  });
  messageRepository.create.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000201',
    sessionId: '00000000-0000-4000-8000-000000000100',
    role: AgentMessageRole.Assistant,
    content: { blocks: [{ type: 'text', text: 'Echo: Hello' }] },
    providerMessageId: 'stub-echo-00000000-0000-4000-8000-000000000200',
    toolCallId: null,
    createdAt: new Date('2026-05-14T10:00:00.000Z'),
  } as never);

  await sut.sendMessage({
    userId: '00000000-0000-4000-8000-000000000010',
    sessionId: '00000000-0000-4000-8000-000000000100',
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    messageId: '00000000-0000-4000-8000-000000000200',
    content: { blocks: [{ type: 'text', text: 'Hello' }] },
  });

  expect(agentRunnerRepository.streamMessage).toHaveBeenCalledWith({
    url: 'http://agent-runner:4477',
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    timeoutMs: 3000,
    body: {
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      messageId: '00000000-0000-4000-8000-000000000200',
      content: { blocks: [{ type: 'text', text: 'Hello' }] },
    },
  });
  expect(websocketRepository.clientSend).toHaveBeenCalledWith(
    'on_agent_session_event',
    '00000000-0000-4000-8000-000000000010',
    {
      type: 'assistant-message-delta',
      sessionId: '00000000-0000-4000-8000-000000000100',
      delta: 'Echo: Hello',
      sequence: 1,
      createdAt: '2026-05-14T10:00:00.000Z',
    },
  );
  expect(messageRepository.create).toHaveBeenCalledWith({
    sessionId: '00000000-0000-4000-8000-000000000100',
    role: AgentMessageRole.Assistant,
    content: { blocks: [{ type: 'text', text: 'Echo: Hello' }] },
    providerMessageId: 'stub-echo-00000000-0000-4000-8000-000000000200',
    toolCallId: null,
  });
  expect(websocketRepository.clientSend).toHaveBeenLastCalledWith(
    'on_agent_session_event',
    '00000000-0000-4000-8000-000000000010',
    {
      type: 'assistant-message-created',
      sessionId: '00000000-0000-4000-8000-000000000100',
      message: expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000201',
        role: AgentMessageRole.Assistant,
      }),
      createdAt: '2026-05-14T10:00:00.000Z',
    },
  );
});

it('marks the session interrupted and emits an error when runner message streaming fails', async () => {
  configRepository.getEnv.mockReturnValue({
    agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
  } as never);
  agentRunnerRepository.streamMessage.mockImplementation(async function* () {
    throw new Error('connection refused');
  });

  await expect(
    sut.sendMessage({
      userId: '00000000-0000-4000-8000-000000000010',
      sessionId: '00000000-0000-4000-8000-000000000100',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      messageId: '00000000-0000-4000-8000-000000000200',
      content: { blocks: [{ type: 'text', text: 'Hello' }] },
    }),
  ).rejects.toThrow('connection refused');
  expect(sessionRepository.update).toHaveBeenCalledWith(
    '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000100',
    { status: AgentSessionStatus.Interrupted },
  );
  expect(websocketRepository.clientSend).toHaveBeenCalledWith(
    'on_agent_session_event',
    '00000000-0000-4000-8000-000000000010',
    {
      type: 'runner-error',
      sessionId: '00000000-0000-4000-8000-000000000100',
      message: 'The assistant runner stopped while processing the message.',
      createdAt: '2026-05-14T10:00:00.000Z',
    },
  );
});

it('ignores runner stream events for another Gallery or runner session', async () => {
  configRepository.getEnv.mockReturnValue({
    agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
  } as never);
  agentRunnerRepository.streamMessage.mockImplementation(async function* () {
    yield {
      type: 'assistant-message-delta',
      sessionId: '00000000-0000-4000-8000-000000000999',
      runnerSessionId: 'stub-other',
      delta: 'Wrong session',
      sequence: 1,
    };
  });

  await sut.sendMessage({
    userId: '00000000-0000-4000-8000-000000000010',
    sessionId: '00000000-0000-4000-8000-000000000100',
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    messageId: '00000000-0000-4000-8000-000000000200',
    content: { blocks: [{ type: 'text', text: 'Hello' }] },
  });

  expect(messageRepository.create).not.toHaveBeenCalled();
  expect(websocketRepository.clientSend).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run runner service tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-runner.service.spec.ts
```

Expected: FAIL because `sendMessage()` is not implemented.

- [ ] **Step 4: Implement runner message dispatch**

Modify `server/src/services/agent-runner.service.ts`.

Add imports:

```ts
import { AgentMessageRole, AgentSessionStatus } from 'src/enum';
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { AgentMessageContent } from 'src/types/agent-message.types';
```

Extend the constructor:

```ts
constructor(
  private readonly configRepository: ConfigRepository,
  private readonly agentRunnerRepository: AgentRunnerRepository,
  private readonly messageRepository: AgentMessageRepository,
  private readonly sessionRepository: AgentSessionRepository,
  private readonly websocketRepository: WebsocketRepository,
) {}
```

Add helper:

```ts
private toIsoNow() {
  return new Date().toISOString();
}
```

Add method:

```ts
async sendMessage({
  userId,
  sessionId,
  runnerSessionId,
  messageId,
  content,
}: {
  userId: string;
  sessionId: string;
  runnerSessionId: string;
  messageId: string;
  content: AgentMessageContent;
}): Promise<void> {
  const { runnerUrl, runnerHealthTimeoutMs } = this.configRepository.getEnv().agent;
  if (!runnerUrl) {
    throw new BadRequestException('Agent runner is not configured');
  }

  try {
    for await (const event of this.agentRunnerRepository.streamMessage({
      url: runnerUrl,
      runnerSessionId,
      timeoutMs: runnerHealthTimeoutMs,
      body: { gallerySessionId: sessionId, messageId, content },
    })) {
      if (event.sessionId !== sessionId || event.runnerSessionId !== runnerSessionId) {
        continue;
      }

      if (event.type === 'assistant-message-delta') {
        this.websocketRepository.clientSend('on_agent_session_event', userId, {
          type: 'assistant-message-delta',
          sessionId,
          delta: event.delta,
          sequence: event.sequence,
          createdAt: this.toIsoNow(),
        });
        continue;
      }

      const message = await this.messageRepository.create({
        sessionId,
        role: AgentMessageRole.Assistant,
        content: event.content,
        providerMessageId: event.providerMessageId,
        toolCallId: null,
      });

      this.websocketRepository.clientSend('on_agent_session_event', userId, {
        type: 'assistant-message-created',
        sessionId,
        message: {
          id: message.id,
          sessionId: message.sessionId,
          role: message.role,
          content: message.content,
          providerMessageId: message.providerMessageId,
          toolCallId: message.toolCallId,
          createdAt: message.createdAt,
        },
        createdAt: this.toIsoNow(),
      });
    }
  } catch (error) {
    await this.sessionRepository.update(userId, sessionId, { status: AgentSessionStatus.Interrupted });
    this.websocketRepository.clientSend('on_agent_session_event', userId, {
      type: 'runner-error',
      sessionId,
      message: 'The assistant runner stopped while processing the message.',
      createdAt: this.toIsoNow(),
    });
    throw error;
  }
}
```

- [ ] **Step 5: Write failing message service dispatch tests**

Extend `server/src/services/agent-message.service.spec.ts`.

```ts
it('queues appended user messages to the runner when a runner session exists', async () => {
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.Running,
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
  });
  const message = makeMessage({
    sessionId: session.id,
    role: AgentMessageRole.User,
    content: { blocks: [{ type: 'text', text: 'Hello runner' }] },
  });
  sessionRepository.getById.mockResolvedValue(session);
  messageRepository.create.mockResolvedValue(message);
  agentRunnerService.sendMessage.mockReturnValue(new Promise<void>(() => undefined));

  await expect(
    sut.appendUserMessage(auth, session.id, { content: { blocks: [{ type: 'text', text: 'Hello runner' }] } }),
  ).resolves.toEqual(expect.objectContaining({ id: message.id, role: AgentMessageRole.User }));
  expect(agentRunnerService.sendMessage).toHaveBeenCalledWith({
    userId: auth.user.id,
    sessionId: session.id,
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
    messageId: message.id,
    content: message.content,
  });
});

it('does not fail the append request when asynchronous runner dispatch rejects', async () => {
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.Running,
    runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
  });
  const message = makeMessage({
    sessionId: session.id,
    role: AgentMessageRole.User,
    content: { blocks: [{ type: 'text', text: 'Hello runner' }] },
  });
  sessionRepository.getById.mockResolvedValue(session);
  messageRepository.create.mockResolvedValue(message);
  agentRunnerService.sendMessage.mockRejectedValue(new Error('connection refused'));

  await expect(
    sut.appendUserMessage(auth, session.id, { content: { blocks: [{ type: 'text', text: 'Hello runner' }] } }),
  ).resolves.toEqual(expect.objectContaining({ id: message.id, role: AgentMessageRole.User }));
});

it('persists the user message and skips dispatch before runner session creation', async () => {
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.Created,
    runnerSessionId: null,
  });
  const message = makeMessage({
    sessionId: session.id,
    role: AgentMessageRole.User,
    content: { blocks: [{ type: 'text', text: 'Draft before runner' }] },
  });
  sessionRepository.getById.mockResolvedValue(session);
  messageRepository.create.mockResolvedValue(message);

  await sut.appendUserMessage(auth, session.id, {
    content: { blocks: [{ type: 'text', text: 'Draft before runner' }] },
  });

  expect(agentRunnerService.sendMessage).not.toHaveBeenCalled();
});
```

Add `AgentRunnerService` to the SUT setup:

```ts
let agentRunnerService: ReturnType<typeof automock<AgentRunnerService>>;

agentRunnerService = automock(AgentRunnerService);
sut = new AgentMessageService(messageRepository, sessionRepository, agentRunnerService);
```

- [ ] **Step 6: Run message service tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-message.service.spec.ts
```

Expected: FAIL because `AgentMessageService` does not inject or call `AgentRunnerService`.

- [ ] **Step 7: Implement message service dispatch**

Modify `server/src/services/agent-message.service.ts`.

Add import:

```ts
import { AgentRunnerService } from 'src/services/agent-runner.service';
```

Change constructor:

```ts
constructor(
  private readonly messageRepository: AgentMessageRepository,
  private readonly sessionRepository: AgentSessionRepository,
  private readonly agentRunnerService: AgentRunnerService,
) {}
```

After creating the user message in `appendUserMessage()`, add:

```ts
if (session.runnerSessionId) {
  void this.agentRunnerService
    .sendMessage({
      userId: auth.user.id,
      sessionId: session.id,
      runnerSessionId: session.runnerSessionId,
      messageId: message.id,
      content: message.content,
    })
    .catch(() => undefined);
}
```

Return `this.map(message)` as before.

This dispatch is intentionally fire-and-report-via-websocket: once the user message is persisted, the HTTP append endpoint should return the user message immediately. Runner stream failures are handled inside `AgentRunnerService.sendMessage()` by marking the session interrupted and emitting `runner-error`.

- [ ] **Step 8: Run focused server tests**

Run:

```bash
pnpm --dir server test agent-runner.service.spec.ts agent-message.service.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit message dispatch**

```bash
git add server/src/services/agent-runner.service.ts server/src/services/agent-runner.service.spec.ts server/src/services/agent-message.service.ts server/src/services/agent-message.service.spec.ts server/src/repositories/websocket.repository.ts web/src/lib/stores/websocket.ts
git commit -m "feat: stream runner echo messages"
```

## Task 5: Assistant Chat UI

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Create: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-page-content.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing chat panel tests**

Create `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`.

```ts
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { websocketMock } from '$test-data/mocks/websocket.mock';
import {
  AgentApprovalMode,
  AgentMessageRole,
  AgentMessageTextBlockType,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  type AgentMessageResponseDto,
  type AgentSessionResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import AgentSessionChatPanel from './agent-session-chat-panel.svelte';

vi.mock('$lib/stores/websocket');
vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_chat: 'Chat',
    assistant_message: 'Message',
    assistant_message_load_error: 'Unable to load messages',
    assistant_send: 'Send',
    assistant_streaming_response: 'Assistant is responding',
    assistant_message_send_error: 'Unable to send message',
  };

  return { t: readable((key: string) => messages[key] ?? key) };
});

const session: AgentSessionResponseDto = {
  id: '00000000-0000-4000-8000-000000000100',
  status: AgentSessionStatus.Running,
  providerCredentialId: '00000000-0000-4000-8000-000000000001',
  credentialSnapshot: {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: AgentProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: { model: 'gpt-5.1', providerCredentialId: '00000000-0000-4000-8000-000000000001' },
  initialContextSnapshot: {},
  permissionPlanSnapshot: {
    assetScope: { locked: false, owned: true, sharedSpaces: false },
    limits: {
      expiresInMinutes: 120,
      maxAssetsPerSession: 2000,
      maxAssetsPerToolCall: 200,
      maxOriginalsPerToolCall: 0,
      maxPreviewsPerToolCall: 0,
    },
    providerExposure: { allowOriginalsForExternalProviders: false, metadata: true, originals: false, previews: false },
    read: { metadata: true, originals: false, previews: false },
    writeScope: { addAssets: true, createAlbum: true, setCover: true, updateDetails: true },
  },
  permissionPreset: AgentPermissionPreset.Careful,
  approvalMode: AgentApprovalMode.Strict,
  runnerEndpoint: 'http://agent-runner:4477',
  runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
  runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
  endedAt: null,
};

const userMessage: AgentMessageResponseDto = {
  id: '00000000-0000-4000-8000-000000000200',
  sessionId: session.id,
  role: AgentMessageRole.User,
  content: { blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Hello runner' }] },
  providerMessageId: null,
  toolCallId: null,
  createdAt: '2026-05-14T00:01:00.000Z',
};

const assistantMessage: AgentMessageResponseDto = {
  id: '00000000-0000-4000-8000-000000000201',
  sessionId: session.id,
  role: AgentMessageRole.Assistant,
  content: { blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Echo: Hello runner' }] },
  providerMessageId: 'stub-echo-00000000-0000-4000-8000-000000000200',
  toolCallId: null,
  createdAt: '2026-05-14T00:01:01.000Z',
};

describe(AgentSessionChatPanel.name, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMock.getAgentSessionMessages.mockResolvedValue([]);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(userMessage);
  });

  it('loads the transcript for the created session', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([userMessage, assistantMessage]);

    render(AgentSessionChatPanel, { props: { session } });

    expect(await screen.findByText('Hello runner')).toBeInTheDocument();
    expect(screen.getByText('Echo: Hello runner')).toBeInTheDocument();
    expect(sdkMock.getAgentSessionMessages).toHaveBeenCalledWith({ id: session.id });
  });

  it('shows an error when transcript loading fails', async () => {
    sdkMock.getAgentSessionMessages.mockRejectedValue(new Error('network failed'));

    render(AgentSessionChatPanel, { props: { session } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load messages');
  });

  it('sends a user message and clears the input', async () => {
    render(AgentSessionChatPanel, { props: { session } });

    await fireEvent.input(await screen.findByLabelText('Message'), { target: { value: ' Hello runner ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith({
        id: session.id,
        agentMessageCreateDto: {
          content: { blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Hello runner' }] },
        },
      }),
    );
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(screen.getByText('Hello runner')).toBeInTheDocument();
  });

  it('shows a send error and keeps the draft when append fails', async () => {
    sdkMock.appendAgentSessionMessage.mockRejectedValue(new Error('network failed'));

    render(AgentSessionChatPanel, { props: { session } });

    await fireEvent.input(await screen.findByLabelText('Message'), { target: { value: 'Hello runner' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to send message');
    expect(screen.getByLabelText('Message')).toHaveValue('Hello runner');
  });

  it('does not submit duplicate messages while a send is in progress', async () => {
    sdkMock.appendAgentSessionMessage.mockReturnValue(new Promise<AgentMessageResponseDto>(() => undefined));

    render(AgentSessionChatPanel, { props: { session } });

    await fireEvent.input(await screen.findByLabelText('Message'), { target: { value: 'Hello runner' } });
    const sendButton = screen.getByRole('button', { name: 'Send' });
    await fireEvent.click(sendButton);
    await fireEvent.click(sendButton);

    expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledTimes(1);
  });

  it('renders streaming deltas and completed assistant messages from websocket events', async () => {
    let handler: (event: unknown) => void = () => undefined;
    websocketMock.websocketEvents.on.mockImplementation((_event, nextHandler) => {
      handler = nextHandler as (event: unknown) => void;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });

    handler({
      type: 'assistant-message-delta',
      sessionId: session.id,
      delta: 'Echo: Hello',
      sequence: 1,
      createdAt: '2026-05-14T00:01:01.000Z',
    });
    expect(await screen.findByText('Echo: Hello')).toBeInTheDocument();

    handler({
      type: 'assistant-message-created',
      sessionId: session.id,
      message: assistantMessage,
      createdAt: '2026-05-14T00:01:02.000Z',
    });
    expect(await screen.findByText('Echo: Hello runner')).toBeInTheDocument();
    expect(screen.queryByText('Echo: Hello')).not.toBeInTheDocument();
  });

  it('ignores websocket events for other sessions', async () => {
    let handler: (event: unknown) => void = () => undefined;
    websocketMock.websocketEvents.on.mockImplementation((_event, nextHandler) => {
      handler = nextHandler as (event: unknown) => void;
      return vi.fn();
    });

    render(AgentSessionChatPanel, { props: { session } });

    handler({
      type: 'assistant-message-delta',
      sessionId: '00000000-0000-4000-8000-000000000999',
      delta: 'Wrong session',
      sequence: 1,
      createdAt: '2026-05-14T00:01:01.000Z',
    });
    expect(screen.queryByText('Wrong session')).not.toBeInTheDocument();
  });

  it('cleans up websocket listeners on destroy', () => {
    const unsubscribe = vi.fn();
    websocketMock.websocketEvents.on.mockReturnValue(unsubscribe);

    const { unmount } = render(AgentSessionChatPanel, { props: { session } });
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
```

Confirm `web/src/test-data/mocks/websocket.mock.ts` still exposes this event-agnostic mock shape:

```ts
websocketEvents: {
  on: vi.fn(() => vi.fn()),
  off: vi.fn(),
},
```

- [ ] **Step 2: Run chat tests to verify they fail**

Run:

```bash
pnpm --dir web test -- --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected: FAIL because `agent-session-chat-panel.svelte` does not exist.

- [ ] **Step 3: Implement the chat panel**

Create `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`.

```svelte
<script lang="ts">
  import { websocketEvents, type AgentSessionClientEvent } from '$lib/stores/websocket';
  import { handleError } from '$lib/utils/handle-error';
  import { AgentMessageTextBlockType, appendAgentSessionMessage, getAgentSessionMessages, type AgentMessageResponseDto, type AgentSessionResponseDto } from '@immich/sdk';
  import { Button, Input } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    session: AgentSessionResponseDto;
  }

  let { session }: Props = $props();
  let messages = $state<AgentMessageResponseDto[]>([]);
  let draft = $state('');
  let isSending = $state(false);
  let errorMessage = $state<string | null>(null);
  let streamingText = $state('');
  let cleanup: () => void = () => undefined;

  const textForMessage = (message: AgentMessageResponseDto) =>
    message.content.blocks
      .filter((block) => block.type === AgentMessageTextBlockType.Text)
      .map((block) => block.text)
      .join('\n');

  const handleSessionEvent = (event: AgentSessionClientEvent) => {
    if (event.sessionId !== session.id) {
      return;
    }

    if (event.type === 'assistant-message-delta') {
      streamingText = event.delta;
      return;
    }

    if (event.type === 'assistant-message-created') {
      streamingText = '';
      if (!messages.some((message) => message.id === event.message.id)) {
        messages = [...messages, event.message];
      }
      return;
    }

    errorMessage = event.message;
  };

  onMount(() => {
    cleanup = websocketEvents.on('on_agent_session_event', handleSessionEvent);
    void getAgentSessionMessages({ id: session.id })
      .then((result) => {
        messages = result;
      })
      .catch((error) => {
        errorMessage = $t('assistant_message_load_error');
        handleError(error, errorMessage);
      });
  });

  onDestroy(() => cleanup());

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || isSending) {
      return;
    }

    isSending = true;
    errorMessage = null;
    try {
      const message = await appendAgentSessionMessage({
        id: session.id,
        agentMessageCreateDto: { content: { blocks: [{ type: AgentMessageTextBlockType.Text, text }] } },
      });
      messages = [...messages, message];
      draft = '';
    } catch (error) {
      errorMessage = $t('assistant_message_send_error');
      handleError(error, errorMessage);
    } finally {
      isSending = false;
    }
  };
</script>

<section
  class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-10 text-black dark:text-white md:px-8"
  aria-labelledby="assistant-chat-title"
>
  <div class="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-immich-dark-gray">
    <h2 id="assistant-chat-title" class="text-lg font-semibold">{$t('assistant_chat')}</h2>

    {#if errorMessage}
      <div class="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{errorMessage}</div>
    {/if}

    <div class="mt-4 flex max-h-96 flex-col gap-3 overflow-y-auto" aria-live="polite">
      {#each messages as message (message.id)}
        <div class="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-700">
          <div class="mb-1 text-xs uppercase text-gray-500 dark:text-gray-400">{message.role}</div>
          <div class="whitespace-pre-wrap">{textForMessage(message)}</div>
        </div>
      {/each}

      {#if streamingText}
        <div class="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-700">
          <div class="mb-1 text-xs uppercase text-gray-500 dark:text-gray-400">{$t('assistant_streaming_response')}</div>
          <div class="whitespace-pre-wrap">{streamingText}</div>
        </div>
      {/if}
    </div>

    <form
      class="mt-4 flex gap-3"
      onsubmit={(event) => {
        event.preventDefault();
        void sendMessage();
      }}
    >
      <Input aria-label={$t('assistant_message')} bind:value={draft} disabled={isSending} autocomplete="off" />
      <Button type="submit" disabled={!draft.trim() || isSending} loading={isSending}>{$t('assistant_send')}</Button>
    </form>
  </div>
</section>
```

- [ ] **Step 4: Render chat after session creation**

Modify `web/src/routes/(user)/assistant/agent-session-page-content.svelte`.

Add import:

```svelte
import AgentSessionChatPanel from './agent-session-chat-panel.svelte';
```

After the created-session summary block, render:

```svelte
{#if createdSession}
  <AgentSessionChatPanel session={createdSession} />
{/if}
```

This can be in the same `{#if createdSession}` block as the summary or a second block immediately after it.

- [ ] **Step 5: Add translations**

Add these keys to `i18n/en.json`:

```json
{
  "assistant_chat": "Chat",
  "assistant_message": "Message",
  "assistant_message_load_error": "Unable to load messages",
  "assistant_message_send_error": "Unable to send message",
  "assistant_send": "Send",
  "assistant_streaming_response": "Assistant is responding"
}
```

Keep the file sorted according to the existing local style.

- [ ] **Step 6: Update page-content test for chat visibility**

In `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts`, add translations for the new keys in the `messages` object:

```ts
assistant_chat: 'Chat',
assistant_message: 'Message',
assistant_message_load_error: 'Unable to load messages',
assistant_message_send_error: 'Unable to send message',
assistant_send: 'Send',
assistant_streaming_response: 'Assistant is responding',
```

Add this default mock in `beforeEach()`:

```ts
sdkMock.getAgentSessionMessages.mockResolvedValue([]);
websocketMock.websocketEvents.on.mockReturnValue(vi.fn());
```

Import and mock the websocket store because page-content now renders `AgentSessionChatPanel`:

```ts
import { websocketMock } from '$test-data/mocks/websocket.mock';

vi.mock('$lib/stores/websocket');
```

Keep `vi.clearAllMocks()` in `beforeEach()` so the imported `websocketMock` listener state is reset between page-content tests.

Update these fields on the existing `createdSession` fixture so it matches the new create-session response shape:

```ts
status: AgentSessionStatus.Running,
runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
runnerEndpoint: 'http://agent-runner:4477',
runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
```

Update the status assertion in the created-session test:

```ts
expect(within(summary).getByText(`status:${AgentSessionStatus.Running}`)).toBeInTheDocument();
```

Extend the created-session test with this assertion:

```ts
expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
```

- [ ] **Step 7: Run web tests**

Run:

```bash
pnpm --dir web test -- --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' 'src/routes/(user)/assistant/agent-session-page-content.spec.ts' 'src/routes/(user)/assistant/agent-session-setup-panel.spec.ts'
```

Expected: PASS.

- [ ] **Step 8: Commit web chat UI**

```bash
git add 'web/src/routes/(user)/assistant/agent-session-chat-panel.svelte' 'web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' 'web/src/routes/(user)/assistant/agent-session-page-content.svelte' 'web/src/routes/(user)/assistant/agent-session-page-content.spec.ts' i18n/en.json web/src/test-data/mocks/websocket.mock.ts
git commit -m "feat: add assistant runner echo chat"
```

## Task 6: Generated Artifacts And Final Verification

**Files:**

- Verify: `pnpm-lock.yaml`
- Verify: `open-api/immich-openapi-specs.json`
- Verify: `open-api/typescript-sdk/src/fetch-client.ts`
- Verify: `mobile/openapi/**`
- Verify: `server/src/queries/**`

- [ ] **Step 1: Run server unit tests for the slice**

Run:

```bash
pnpm --dir server test agent-runner.repository.spec.ts agent-runner.service.spec.ts agent-session.service.spec.ts agent-message.service.spec.ts agent-message.controller.spec.ts agent-session.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 3: Run web Assistant tests**

Run:

```bash
pnpm --dir web test -- --run 'src/routes/(user)/assistant'
```

Expected: PASS for Assistant route tests.

- [ ] **Step 4: Check TypeScript**

Run:

```bash
pnpm --dir server check
pnpm --dir web check
```

Expected: PASS.

- [ ] **Step 5: Run formatting**

Run:

```bash
pnpm --dir server format
pnpm --dir web format
```

Expected: PASS. If either reports formatting differences, run the matching `format:fix`, review the diff, and commit the formatting-only changes.

- [ ] **Step 6: Regenerate API artifacts only if needed**

Run:

```bash
pnpm --dir server build
pnpm --dir server sync:open-api
make open-api
```

Expected: No generated diff unless Nest/OpenAPI metadata changed because constructor dependencies or DTO exports affected the generated spec. When generated files change, inspect that `/agent/sessions` and `/agent/sessions/{id}/messages` remain the same public route shapes, then commit the generated artifacts:

```bash
git add open-api mobile/openapi
git commit -m "chore: update agent runner api artifacts"
```

- [ ] **Step 7: Sync SQL snapshots**

Run:

```bash
pnpm --dir server sync:sql
```

Expected: No SQL snapshot diff, because this slice does not add tables or SQL-decorated repository methods. When `server/src/queries/**` changes due to existing generated metadata drift, inspect and commit only the relevant generated files:

```bash
git add server/src/queries
git commit -m "chore: update agent runner sql artifacts"
```

- [ ] **Step 8: Inspect final diff**

Run:

```bash
git diff --stat origin/explore/pi-agent-brainstorm...HEAD
git diff --name-only origin/explore/pi-agent-brainstorm...HEAD
```

Expected: The diff contains the runner stub package, runner protocol client/service changes, session/message service tests, websocket event typing, Assistant chat UI, translations, and this plan. It does not contain Pi provider integration, read tool expansion, YOLO mode, album operation tables, plan review UI, or apply endpoints.

No browser E2E is required in slice 7. This slice introduces a stub sidecar and component-level chat behavior; the end-to-end Assistant workflow remains deferred to the later E2E slice once the dev stack runner wiring and provider-backed execution exist.

- [ ] **Step 9: Final commit if verification changed files**

When verification commands produce reviewed changes, commit them:

```bash
git add agent-runner server web i18n open-api mobile pnpm-workspace.yaml pnpm-lock.yaml docs/superpowers/plans/2026-05-15-pi-agent-runner-protocol-stub.md
git commit -m "chore: finalize pi agent runner protocol stub"
```

## Self-Review

- Spec coverage: this plan covers slice 7 from the approved design: sidecar service skeleton, create-session protocol, echo-message protocol, server-runner contract tests, and streamed runner events reaching the Assistant UI.
- Deliberate exclusions: Pi/model provider calls, provider secret transfer, runner auth, additional read tools, approval UI, YOLO mode, album operation storage, plan review, and apply behavior remain in later slices.
- Security boundary: Gallery still owns session creation, auth, transcript persistence, and websocket recipient selection. The runner receives only redacted credential snapshots and session policy for this stub slice; it does not receive raw provider secrets.
- Type consistency: `AgentRunnerCreateSessionRequest`, `AgentRunnerCreateSessionResult`, `AgentRunnerMessageRequest`, `AgentRunnerStreamEvent`, `AgentSessionClientEvent`, `runnerSessionId`, `runnerCapabilitiesSnapshot`, and `AgentMessageContent` are used consistently across repository, service, websocket, and UI code.
- Test coverage: runner package tests cover health, create-session validation, malformed JSON, and SSE echo; server tests cover protocol parsing, non-2xx responses, invalid/truncated stream frames, runner start, failed start, message streaming, async append dispatch, assistant message persistence, mismatched runner events, and interrupted runner errors; web tests cover transcript load, load failure, message send, send failure, duplicate submit prevention, streaming deltas, completed assistant messages, unrelated-session event filtering, and websocket cleanup.

Plan complete and saved to `docs/superpowers/plans/2026-05-15-pi-agent-runner-protocol-stub.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
