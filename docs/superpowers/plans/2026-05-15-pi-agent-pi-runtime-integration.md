# Pi Agent Pi Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build vertical slice 8 from `docs/superpowers/specs/2026-05-14-pi-agent-album-assistant-design.md`: the first-party runner should call the Pi SDK/model through a constrained runtime boundary while Gallery keeps credentials, auth, persistence, and user-facing streaming authoritative.

**Architecture:** Gallery decrypts the selected provider credential only for the runner session creation request; it never stores the raw secret in `agent_session` snapshots or response DTOs. The `agent-runner` package gains a Pi runtime adapter behind an injectable runtime interface, so unit tests can mock Pi/provider behavior while production uses `@earendil-works/pi-coding-agent`. The runner exposes the same HTTP protocol created in slice 7, but message streams now come from the Pi runtime instead of the echo stub; no write tools, album operation tools, approval UI changes, or expanded read tools are included in this slice.

**Tech Stack:** NestJS services/repositories, existing encrypted credential service, Node.js HTTP/SSE runner, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, Vitest, Node `node:test`, existing Socket.IO websocket channel.

---

## Design Source

The approved design defines slice 8 as:

```text
Pi runtime integration
- runner calls Pi/model with a constrained tool registry;
- no write tools;
- tests with mocked provider/runner boundaries.
```

Relevant Pi SDK documentation checked on 2026-05-15:

- `https://pi.dev/docs/latest/sdk`: `createAgentSession()`, `session.prompt()`, `session.subscribe()`, runtime API key overrides through `AuthStorage.setRuntimeApiKey()`, `noTools: "all"`, `customTools`, and `SettingsManager.inMemory()`.
- `https://pi.dev/docs/latest/custom-provider`: custom provider registration shape for OpenAI-compatible providers.
- `https://pi.dev/docs/latest/extensions`: custom tool registration and active-tool constraints.

Slices 1-7 are already present on `explore/pi-agent-brainstorm`: credential storage, session shell, persisted chat, runner health, internal metadata tool gate, setup UI, and runner protocol stub with chat streaming.

## Scope

This slice implements:

- Transient provider secret handoff from Gallery server to runner session creation.
- Server tests proving the raw secret is never persisted in session snapshots or returned in session DTOs.
- `agent-runner` package dependencies for the Pi SDK and a mocked, injectable Pi runtime adapter.
- A constrained runner runtime that disables all Pi built-in tools in this slice.
- A runtime event bridge from Pi text deltas/completion/errors to the existing Gallery SSE protocol.
- Runner HTTP route changes that create runtime-backed sessions and stream runtime-backed message events.
- Server-side parsing and websocket propagation for runner-reported provider/runtime errors.
- Focused edge-case tests around missing credentials/secrets/models, unknown runner sessions, runtime errors, event validation, event subscription cleanup, and secret redaction.

This slice intentionally does not implement:

- Search/list/read preview/original tools.
- YOLO approval behavior.
- Tool grants or approval resumption from the runner.
- Structured album operation plans.
- Album writes or write tools.
- Plan review UI or apply UI.
- Production Docker Compose wiring for the runner.

## File Structure

Create:

- `agent-runner/src/pi-runtime.mjs` - Pi SDK adapter behind a small Gallery runner runtime interface.
- `agent-runner/src/pi-runtime.test.mjs` - Node `node:test` coverage with mocked Pi SDK/provider boundaries.

Modify:

- `agent-runner/package.json` - add Pi SDK dependencies and keep test/start scripts.
- `agent-runner/src/server.mjs` - inject runtime, create runtime sessions, stream runtime events, reject unknown sessions, and keep health endpoint.
- `agent-runner/src/server.test.mjs` - update tests from echo-only behavior to runtime-backed behavior.
- `pnpm-lock.yaml` - record new runner dependencies.
- `server/src/types/agent-runner.types.ts` - add transient credential material and runner error stream event type.
- `server/src/repositories/agent-runner.repository.ts` - parse `runner-error` SSE events and keep stream validation strict.
- `server/src/repositories/agent-runner.repository.spec.ts` - cover `runner-error`, invalid error event bodies, and secret-bearing create-session payloads.
- `server/src/services/agent-session.service.ts` - decrypt provider secret before runner start and pass it only in the runner request.
- `server/src/services/agent-session.service.spec.ts` - cover transient secret handoff and decrypt failure behavior.
- `server/src/services/agent-runner.service.ts` - convert runner-reported errors into interruption + websocket error events without assistant message persistence.
- `server/src/services/agent-runner.service.spec.ts` - cover runner-reported provider errors and existing transport errors.

## Protocol Updates

Runner session creation keeps the same endpoint:

```http
POST /sessions
Content-Type: application/json
```

The request body changes only inside the server-to-runner protocol. `credential.secret` is transient material and must not be stored in `agent_session`, returned by Gallery APIs, included in runner responses, or written to logs.

```json
{
  "gallerySessionId": "00000000-0000-4000-8000-000000000100",
  "credential": {
    "id": "00000000-0000-4000-8000-000000000001",
    "providerType": "openai",
    "label": "OpenAI personal",
    "baseUrl": null,
    "models": ["gpt-5.1"],
    "defaultModel": "gpt-5.1",
    "secret": "sk-redacted"
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

Runner stream events add a sanitized error event:

```text
event: runner-error
data: {"type":"runner-error","sessionId":"00000000-0000-4000-8000-000000000100","runnerSessionId":"pi-00000000-0000-4000-8000-000000000100","message":"Provider request failed"}
```

Gallery must treat `runner-error` as terminal for the current message dispatch: mark the session interrupted from an active state, emit `on_agent_session_event` with `type: "runner-error"`, and persist no assistant completion for that dispatch.

## Task 1: Transient Provider Secret Handoff

**Files:**

- Modify: `server/src/types/agent-runner.types.ts`
- Modify: `server/src/services/agent-session.service.ts`
- Modify: `server/src/services/agent-session.service.spec.ts`

- [ ] **Step 1: Write failing session-service tests for transient secret handoff**

Add these tests to `server/src/services/agent-session.service.spec.ts` near the existing create-session runner handoff tests.

```ts
it('passes decrypted provider secret to the runner without storing it in session snapshots', async () => {
  const auth = AuthFactory.create();
  const providerCredentialId = newUuid();
  const credential = makeCredential({
    id: providerCredentialId,
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  });
  const dto: AgentSessionCreateDto = {
    providerCredentialId,
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.Careful,
    approvalMode: AgentApprovalMode.Strict,
  };
  const created = makeSession({
    userId: auth.user.id,
    providerCredentialId,
    credentialSnapshot: {
      id: providerCredentialId,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId, model: 'gpt-5.1' },
  });
  const running = makeSession({
    ...created,
    status: AgentSessionStatus.Running,
    runnerEndpoint: 'http://agent-runner:4477',
    runnerSessionId: 'pi-session-1',
    runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: [], models: ['gpt-5.1'] },
  });

  credentialService.getById.mockResolvedValue(credential);
  credentialService.getSecret.mockResolvedValue('sk-session-secret');
  repository.create.mockResolvedValue(created);
  agentRunnerService.createSession.mockResolvedValue({
    runnerEndpoint: 'http://agent-runner:4477',
    runnerSessionId: 'pi-session-1',
    runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: [], models: ['gpt-5.1'] },
  });
  repository.markRunningFromCreated.mockResolvedValue(running);

  await expect(sut.create(auth, dto)).resolves.toMatchObject({
    id: running.id,
    credentialSnapshot: expect.not.objectContaining({ secret: expect.anything() }),
    runnerSessionId: 'pi-session-1',
  });

  expect(credentialService.getSecret).toHaveBeenCalledWith(auth, providerCredentialId);
  expect(repository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      credentialSnapshot: expect.not.objectContaining({ secret: expect.anything() }),
    }),
  );
  expect(agentRunnerService.createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      credential: {
        id: providerCredentialId,
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
        baseUrl: null,
        models: ['gpt-5.1'],
        defaultModel: 'gpt-5.1',
        secret: 'sk-session-secret',
      },
    }),
  );
});

it('does not create a Gallery session when provider secret decryption fails', async () => {
  const auth = AuthFactory.create();
  const providerCredentialId = newUuid();
  const credential = makeCredential({ id: providerCredentialId, models: ['gpt-5.1'] });
  const dto: AgentSessionCreateDto = {
    providerCredentialId,
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.Careful,
    approvalMode: AgentApprovalMode.Strict,
  };
  const error = new Error('decrypt failed');

  credentialService.getById.mockResolvedValue(credential);
  credentialService.getSecret.mockRejectedValue(error);

  await expect(sut.create(auth, dto)).rejects.toBe(error);

  expect(repository.create).not.toHaveBeenCalled();
  expect(agentRunnerService.createSession).not.toHaveBeenCalled();
  expect(repository.markFailedFromCreated).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify the new tests fail**

Run the focused server test through the chosen verification path.

```bash
pnpm --dir server test agent-session.service.spec.ts
```

Expected: FAIL because `AgentRunnerCreateSessionRequest.credential` has no `secret` field and `AgentSessionService.create()` does not call `credentialService.getSecret()`.

- [ ] **Step 3: Add transient credential material type**

Modify `server/src/types/agent-runner.types.ts`.

```ts
export type AgentRunnerCredentialMaterial = AgentCredentialSnapshot & {
  secret: string;
};

export type AgentRunnerCreateSessionRequest = {
  gallerySessionId: string;
  credential: AgentRunnerCredentialMaterial;
  model: string;
  permissionPreset: AgentPermissionPreset;
  permissionPlan: AgentPermissionPlanSnapshot;
  approvalMode: AgentApprovalMode;
  initialContext: Record<string, unknown>;
};
```

Keep `AgentCredentialSnapshot` unchanged in `server/src/types/agent-session.types.ts`; the raw secret is protocol material only.

- [ ] **Step 4: Update existing runner request fixtures for the new transient secret field**

Any existing `AgentRunnerCreateSessionRequest` fixture must include the new transient `secret` field so later typecheck/lint CI sees a consistent protocol. Update the existing `makeCreateSessionBody()` fixture in `server/src/services/agent-runner.service.spec.ts`.

```ts
credential: {
  id: '00000000-0000-4000-8000-000000000001',
  providerType: AgentProviderType.OpenAI,
  label: 'OpenAI personal',
  baseUrl: null,
  models: ['gpt-5.1'],
  defaultModel: 'gpt-5.1',
  secret: 'sk-session-secret',
},
```

Update the existing `createSessionBody` fixture in `server/src/repositories/agent-runner.repository.spec.ts`.

```ts
credential: {
  id: 'credential-1',
  providerType: AgentProviderType.OpenAI,
  label: 'OpenAI',
  baseUrl: null,
  models: ['gpt-5.1'],
  defaultModel: 'gpt-5.1',
  secret: 'sk-session-secret',
},
```

- [ ] **Step 5: Decrypt before creating the Gallery session and pass secret only to the runner**

Modify the create path in `server/src/services/agent-session.service.ts`.

```ts
const credentialSecret = await this.credentialService.getSecret(auth, dto.providerCredentialId);

const session = await this.repository.create({
  userId: auth.user.id,
  providerCredentialId: credential.id,
  credentialSnapshot,
  modelSnapshot: {
    providerCredentialId: credential.id,
    model: dto.model,
  },
  permissionPreset: dto.permissionPreset,
  permissionPlanSnapshot,
  approvalMode: dto.approvalMode,
  runnerEndpoint: dto.runnerEndpoint ?? null,
  runnerSessionId: null,
  runnerCapabilitiesSnapshot: null,
  status: AgentSessionStatus.Created,
  initialContextSnapshot: dto.initialContext ?? {},
});

runnerSession = await this.agentRunnerService.createSession({
  gallerySessionId: session.id,
  credential: { ...session.credentialSnapshot, secret: credentialSecret },
  model: session.modelSnapshot.model,
  permissionPreset: session.permissionPreset,
  permissionPlan: session.permissionPlanSnapshot,
  approvalMode: session.approvalMode,
  initialContext: session.initialContextSnapshot,
});
```

Place the `getSecret()` call after model validation and before `repository.create()`. This prevents durable orphan sessions when decryption fails.

- [ ] **Step 6: Verify the session-service tests pass**

```bash
pnpm --dir server test agent-session.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit server credential handoff**

```bash
git add server/src/types/agent-runner.types.ts server/src/services/agent-session.service.ts server/src/services/agent-session.service.spec.ts server/src/services/agent-runner.service.spec.ts server/src/repositories/agent-runner.repository.spec.ts
git commit -m "feat: pass transient agent provider secret to runner"
```

## Task 2: Pi Runtime Adapter With Mocked Provider Boundary

**Files:**

- Create: `agent-runner/src/pi-runtime.mjs`
- Create: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add failing runtime adapter tests**

Create `agent-runner/src/pi-runtime.test.mjs`.

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPiRuntime, mapProviderType, redactSecret } from './pi-runtime.mjs';

const permissionPlan = {
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
};

const createSessionBody = (overrides = {}) => ({
  gallerySessionId: '00000000-0000-4000-8000-000000000100',
  credential: {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: 'openai',
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
    secret: 'sk-openai-secret',
  },
  model: 'gpt-5.1',
  permissionPreset: 'careful',
  permissionPlan,
  approvalMode: 'strict',
  initialContext: {},
  ...overrides,
});

const createFakeDependencies = () => {
  const calls = {
    runtimeApiKeys: [],
    loaders: [],
    createAgentSession: [],
    prompts: [],
    unsubscribed: 0,
    disposed: 0,
  };
  let listener;
  const session = {
    sessionId: 'pi-sdk-session-1',
    messages: [],
    subscribe(next) {
      listener = next;
      return () => {
        calls.unsubscribed += 1;
      };
    },
    async prompt(text) {
      calls.prompts.push(text);
      listener?.({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'I can help.' },
      });
      this.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'I can help.' }] });
      listener?.({ type: 'message_end' });
    },
    dispose() {
      calls.disposed += 1;
    },
  };

  class DefaultResourceLoader {
    constructor(options) {
      this.options = options;
      calls.loaders.push(options);
    }

    async reload() {
      for (const factory of this.options.extensionFactories ?? []) {
        factory({
          registerProvider: (name, config) => {
            calls.registeredProvider = { name, config };
          },
        });
      }
    }
  }

  const sdk = {
    AuthStorage: {
      create: () => ({
        setRuntimeApiKey: (provider, secret) => calls.runtimeApiKeys.push({ provider, secret }),
      }),
    },
    ModelRegistry: {
      create: () => ({
        find: (provider, model) => ({ provider, id: model, source: 'registry' }),
      }),
    },
    SessionManager: { inMemory: () => ({ kind: 'session-manager' }) },
    SettingsManager: { inMemory: (settings) => ({ kind: 'settings-manager', settings }) },
    DefaultResourceLoader,
    createAgentSession: async (options) => {
      calls.createAgentSession.push(options);
      return { session };
    },
  };

  const ai = {
    getModel: (provider, model) => (provider === 'openai' ? { provider, id: model, source: 'builtin' } : undefined),
  };

  return { sdk, ai, calls, session };
};

const collect = async (stream) => {
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

describe('pi runtime adapter', () => {
  it('maps built-in provider types to Pi provider names', () => {
    assert.equal(mapProviderType('openai', 'session-1'), 'openai');
    assert.equal(mapProviderType('anthropic', 'session-1'), 'anthropic');
    assert.equal(mapProviderType('openai-compatible', 'session-1'), 'gallery-session-1');
  });

  it('redacts provider secrets from error messages', () => {
    assert.equal(
      redactSecret('request failed for sk-openai-secret', 'sk-openai-secret'),
      'request failed for [redacted]',
    );
    assert.equal(redactSecret('request failed', 'sk-openai-secret'), 'request failed');
  });

  it('creates a Pi SDK session with runtime API key, selected model, and no enabled tools', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    const result = await runtime.createSession(createSessionBody());

    assert.deepEqual(result, {
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: [],
        models: ['gpt-5.1'],
        runtime: 'pi',
      },
    });
    assert.deepEqual(calls.runtimeApiKeys, [{ provider: 'openai', secret: 'sk-openai-secret' }]);
    assert.equal(calls.createAgentSession.length, 1);
    assert.equal(calls.createAgentSession[0].model.provider, 'openai');
    assert.equal(calls.createAgentSession[0].model.id, 'gpt-5.1');
    assert.equal(calls.createAgentSession[0].noTools, 'all');
    assert.deepEqual(calls.createAgentSession[0].tools, []);
    assert.deepEqual(calls.createAgentSession[0].customTools, []);
  });

  it('registers an OpenAI-compatible provider without persisting the secret', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    await runtime.createSession(
      createSessionBody({
        credential: {
          id: '00000000-0000-4000-8000-000000000001',
          providerType: 'openai-compatible',
          label: 'Local model',
          baseUrl: 'http://localhost:11434/v1',
          models: ['llama-local'],
          defaultModel: 'llama-local',
          secret: 'local-secret',
        },
        model: 'llama-local',
      }),
    );

    assert.deepEqual(calls.runtimeApiKeys, [
      { provider: 'gallery-00000000-0000-4000-8000-000000000100', secret: 'local-secret' },
    ]);
    assert.equal(calls.registeredProvider.name, 'gallery-00000000-0000-4000-8000-000000000100');
    assert.equal(calls.registeredProvider.config.baseUrl, 'http://localhost:11434/v1');
    assert.equal(calls.registeredProvider.config.apiKey, 'local-secret');
    assert.equal(calls.registeredProvider.config.api, 'openai-completions');
    assert.deepEqual(
      calls.registeredProvider.config.models.map((model) => model.id),
      ['llama-local'],
    );
  });

  it('streams Pi text deltas and completion content as Gallery runner events', async () => {
    const { sdk, ai } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(
      runtime.sendMessage({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        messageId: '00000000-0000-4000-8000-000000000200',
        content: { blocks: [{ type: 'text', text: 'Organize my photos.' }] },
      }),
    );

    assert.deepEqual(events, [
      {
        type: 'assistant-message-delta',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        delta: 'I can help.',
        sequence: 1,
      },
      {
        type: 'assistant-message-completed',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        providerMessageId: null,
        content: { blocks: [{ type: 'text', text: 'I can help.' }] },
      },
    ]);
  });

  it('unsubscribes from Pi runtime events after a message stream completes', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    await collect(
      runtime.sendMessage({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        messageId: '00000000-0000-4000-8000-000000000200',
        content: { blocks: [{ type: 'text', text: 'Organize my photos.' }] },
      }),
    );

    assert.equal(calls.unsubscribed, 1);
  });

  it('returns a sanitized runner-error event when Pi prompt fails', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async () => {
      throw new Error('provider rejected sk-openai-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(
      runtime.sendMessage({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        messageId: '00000000-0000-4000-8000-000000000200',
        content: { blocks: [{ type: 'text', text: 'Organize my photos.' }] },
      }),
    );

    assert.deepEqual(events, [
      {
        type: 'runner-error',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        message: 'provider rejected [redacted]',
      },
    ]);
  });

  it('throws a sanitized not-found error for unknown runner sessions', async () => {
    const { sdk, ai } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    await assert.rejects(
      () =>
        collect(
          runtime.sendMessage({
            runnerSessionId: 'missing',
            gallerySessionId: '00000000-0000-4000-8000-000000000100',
            messageId: '00000000-0000-4000-8000-000000000200',
            content: { blocks: [{ type: 'text', text: 'Hello' }] },
          }),
        ),
      /Runner session not found/,
    );
  });

  it('disposes the Pi SDK session when the runtime session is deleted', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    runtime.disposeSession('pi-00000000-0000-4000-8000-000000000100');

    assert.equal(calls.disposed, 1);
  });
});
```

- [ ] **Step 2: Verify runtime tests fail**

```bash
pnpm --dir agent-runner test
```

Expected: FAIL because `agent-runner/src/pi-runtime.mjs` does not exist.

- [ ] **Step 3: Add Pi SDK dependencies**

Modify `agent-runner/package.json`.

```json
{
  "name": "@open-noodle/agent-runner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.mjs",
    "test": "node --test src/*.test.mjs"
  },
  "dependencies": {
    "@earendil-works/pi-ai": "^0.74.0",
    "@earendil-works/pi-coding-agent": "^0.74.0"
  }
}
```

Then resolve the exact package versions available to the workspace:

```bash
pnpm --dir agent-runner install
```

Expected: `pnpm-lock.yaml` records `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` for the `agent-runner` importer. Do not add `typebox` in this slice because the constrained registry intentionally exposes no custom Gallery tools yet.

- [ ] **Step 4: Implement `pi-runtime.mjs`**

Create `agent-runner/src/pi-runtime.mjs`.

```js
import { getModel } from '@earendil-works/pi-ai';
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

const protocolVersion = '2026-05-14';
const systemPrompt = [
  'You are Gallery Assistant, a personal photo organization assistant.',
  'You may discuss album organization ideas, but this runtime slice has no Gallery read tools and no write tools.',
  'Never claim you changed albums. Album writes require a separate user-reviewed apply step.',
].join('\n');

const defaultDependencies = {
  ai: { getModel },
  sdk: {
    AuthStorage,
    createAgentSession,
    DefaultResourceLoader,
    ModelRegistry,
    SessionManager,
    SettingsManager,
  },
};

export const mapProviderType = (providerType, gallerySessionId) => {
  if (providerType === 'openai') {
    return 'openai';
  }

  if (providerType === 'anthropic') {
    return 'anthropic';
  }

  if (providerType === 'openai-compatible') {
    return `gallery-${gallerySessionId}`;
  }

  throw new Error(`Unsupported provider type: ${providerType}`);
};

export const redactSecret = (message, secret) => {
  if (!secret) {
    return message;
  }

  return message.split(secret).join('[redacted]');
};

const firstTextPrompt = (content) =>
  content?.blocks
    ?.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim() ?? '';

const assistantTextFromMessages = (messages) => {
  const assistant = [...(messages ?? [])].reverse().find((message) => message?.role === 'assistant');
  const content = assistant?.content;
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
};

const normalizeErrorMessage = (error, secret) => {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecret(message || 'Provider request failed', secret);
};

const createOpenAiCompatibleProviderFactory = ({ providerName, credential, model }) => {
  if (credential.providerType !== 'openai-compatible') {
    return [];
  }

  if (!credential.baseUrl) {
    throw new Error('OpenAI-compatible credentials require baseUrl');
  }

  return [
    (pi) => {
      pi.registerProvider(providerName, {
        name: credential.label,
        baseUrl: credential.baseUrl,
        apiKey: credential.secret,
        api: 'openai-completions',
        models: [
          {
            id: model,
            name: model,
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      });
    },
  ];
};

export const createPiRuntime = ({ sdk = defaultDependencies.sdk, ai = defaultDependencies.ai } = {}) => {
  const sessions = new Map();

  return {
    async createSession(body) {
      const providerName = mapProviderType(body.credential.providerType, body.gallerySessionId);
      const runnerSessionId = `pi-${body.gallerySessionId}`;
      const authStorage = sdk.AuthStorage.create();
      authStorage.setRuntimeApiKey(providerName, body.credential.secret);

      const modelRegistry = sdk.ModelRegistry.create(authStorage);
      const settingsManager = sdk.SettingsManager.inMemory({
        compaction: { enabled: false },
      });
      const extensionFactories = createOpenAiCompatibleProviderFactory({
        providerName,
        credential: body.credential,
        model: body.model,
      });
      const resourceLoader = new sdk.DefaultResourceLoader({
        settingsManager,
        systemPromptOverride: () => systemPrompt,
        extensionFactories,
      });

      await resourceLoader.reload();

      const model = ai.getModel(providerName, body.model) ?? modelRegistry.find(providerName, body.model);
      if (!model) {
        throw new Error(`Model ${body.model} is not available for provider ${providerName}`);
      }

      const { session } = await sdk.createAgentSession({
        model,
        authStorage,
        modelRegistry,
        sessionManager: sdk.SessionManager.inMemory(),
        settingsManager,
        resourceLoader,
        noTools: 'all',
        tools: [],
        customTools: [],
      });

      sessions.set(runnerSessionId, {
        gallerySessionId: body.gallerySessionId,
        credentialSecret: body.credential.secret,
        model: body.model,
        session,
        unsubscribe: undefined,
      });

      return {
        runnerSessionId,
        capabilities: {
          protocolVersion,
          streaming: true,
          tools: [],
          models: [body.model],
          runtime: 'pi',
        },
      };
    },

    async *sendMessage({ runnerSessionId, gallerySessionId, messageId: _messageId, content }) {
      const entry = sessions.get(runnerSessionId);
      if (!entry || entry.gallerySessionId !== gallerySessionId) {
        throw new Error('Runner session not found');
      }

      let sequence = 0;
      const pendingEvents = [];
      let wake;
      let finished = false;

      const enqueue = (event) => {
        pendingEvents.push(event);
        wake?.();
        wake = undefined;
      };

      const unsubscribe = entry.session.subscribe((event) => {
        if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
          sequence += 1;
          enqueue({
            type: 'assistant-message-delta',
            sessionId: gallerySessionId,
            runnerSessionId,
            delta: event.assistantMessageEvent.delta,
            sequence,
          });
        }
      });
      entry.unsubscribe = unsubscribe;

      try {
        const prompt = firstTextPrompt(content);
        const promptPromise = entry.session
          .prompt(prompt)
          .then(() => {
            const text = assistantTextFromMessages(entry.session.messages);
            enqueue({
              type: 'assistant-message-completed',
              sessionId: gallerySessionId,
              runnerSessionId,
              providerMessageId: null,
              content: { blocks: [{ type: 'text', text }] },
            });
          })
          .catch((error) => {
            enqueue({
              type: 'runner-error',
              sessionId: gallerySessionId,
              runnerSessionId,
              message: normalizeErrorMessage(error, entry.credentialSecret),
            });
          })
          .finally(() => {
            finished = true;
            wake?.();
            wake = undefined;
          });

        while (!finished || pendingEvents.length > 0) {
          if (pendingEvents.length === 0) {
            await new Promise((resolve) => {
              wake = resolve;
            });
            continue;
          }

          yield pendingEvents.shift();
        }

        await promptPromise;
      } finally {
        unsubscribe();
        if (entry.unsubscribe === unsubscribe) {
          entry.unsubscribe = undefined;
        }
      }
    },

    disposeSession(runnerSessionId) {
      const entry = sessions.get(runnerSessionId);
      if (!entry) {
        return;
      }

      entry.unsubscribe?.();
      entry.session.dispose?.();
      sessions.delete(runnerSessionId);
    },
  };
};
```

- [ ] **Step 5: Verify runtime adapter tests pass**

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 6: Commit Pi runtime adapter**

```bash
git add agent-runner/package.json agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs pnpm-lock.yaml
git commit -m "feat: add pi runtime adapter for agent runner"
```

## Task 3: Runtime-Backed Runner HTTP Protocol

**Files:**

- Modify: `agent-runner/src/server.mjs`
- Modify: `agent-runner/src/server.test.mjs`

- [ ] **Step 1: Write failing runner HTTP tests**

Update `agent-runner/src/server.test.mjs` so `withServer()` can inject a runtime.

```js
const createRuntime = () => {
  const calls = { createSession: [], sendMessage: [] };
  return {
    calls,
    runtime: {
      async createSession(body) {
        calls.createSession.push(body);
        return {
          runnerSessionId: `pi-${body.gallerySessionId}`,
          capabilities: {
            protocolVersion: '2026-05-14',
            streaming: true,
            tools: [],
            models: [body.model],
            runtime: 'pi',
          },
        };
      },
      async *sendMessage(body) {
        calls.sendMessage.push(body);
        yield {
          type: 'assistant-message-delta',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          delta: 'I can help.',
          sequence: 1,
        };
        yield {
          type: 'assistant-message-completed',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          providerMessageId: null,
          content: { blocks: [{ type: 'text', text: 'I can help.' }] },
        };
      },
      disposeSession() {},
    },
  };
};

const withServer = async (test, options = {}) => {
  const server = await startServer({ port: 0, runtime: options.runtime });
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
```

Replace the echo session/message tests with runtime-backed tests.

```js
it('creates a runtime-backed runner session without returning credential secret', async () => {
  const { runtime, calls } = createRuntime();

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          credential: {
            id: '00000000-0000-4000-8000-000000000001',
            providerType: 'openai',
            label: 'OpenAI personal',
            baseUrl: null,
            models: ['gpt-5.1'],
            defaultModel: 'gpt-5.1',
            secret: 'sk-secret',
          },
          model: 'gpt-5.1',
          permissionPreset: 'careful',
          permissionPlan: {},
          approvalMode: 'strict',
          initialContext: {},
        }),
      });

      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), {
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: [],
          models: ['gpt-5.1'],
          runtime: 'pi',
        },
      });
    },
    { runtime },
  );

  assert.equal(calls.createSession.length, 1);
  assert.equal(calls.createSession[0].credential.secret, 'sk-secret');
});

it('rejects runtime session creation without a provider secret', async () => {
  const { runtime } = createRuntime();

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          credential: {
            id: '00000000-0000-4000-8000-000000000001',
            providerType: 'openai',
            label: 'OpenAI personal',
            baseUrl: null,
            models: ['gpt-5.1'],
            defaultModel: 'gpt-5.1',
          },
          model: 'gpt-5.1',
          permissionPreset: 'careful',
          permissionPlan: {},
          approvalMode: 'strict',
          initialContext: {},
        }),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'credential.secret is required' });
    },
    { runtime },
  );
});

it('rejects runtime session creation without credential metadata', async () => {
  const { runtime } = createRuntime();

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          model: 'gpt-5.1',
          permissionPreset: 'careful',
          permissionPlan: {},
          approvalMode: 'strict',
          initialContext: {},
        }),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'credential is required' });
    },
    { runtime },
  );
});

it('rejects runtime session creation without a model', async () => {
  const { runtime } = createRuntime();

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          credential: {
            id: '00000000-0000-4000-8000-000000000001',
            providerType: 'openai',
            label: 'OpenAI personal',
            baseUrl: null,
            models: ['gpt-5.1'],
            defaultModel: 'gpt-5.1',
            secret: 'sk-secret',
          },
          permissionPreset: 'careful',
          permissionPlan: {},
          approvalMode: 'strict',
          initialContext: {},
        }),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'model is required' });
    },
    { runtime },
  );
});

it('returns a generic create-session failure when runtime creation throws with a secret-bearing error', async () => {
  const runtime = {
    async createSession() {
      throw new Error('provider rejected sk-secret');
    },
    async *sendMessage() {},
    disposeSession() {},
  };

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          credential: {
            id: '00000000-0000-4000-8000-000000000001',
            providerType: 'openai',
            label: 'OpenAI personal',
            baseUrl: null,
            models: ['gpt-5.1'],
            defaultModel: 'gpt-5.1',
            secret: 'sk-secret',
          },
          model: 'gpt-5.1',
          permissionPreset: 'careful',
          permissionPlan: {},
          approvalMode: 'strict',
          initialContext: {},
        }),
      });

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: 'runner session creation failed' });
    },
    { runtime },
  );
});

it('streams runtime message events for a known runner session', async () => {
  const { runtime, calls } = createRuntime();

  await withServer(
    async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          credential: {
            id: '00000000-0000-4000-8000-000000000001',
            providerType: 'openai',
            label: 'OpenAI personal',
            baseUrl: null,
            models: ['gpt-5.1'],
            defaultModel: 'gpt-5.1',
            secret: 'sk-secret',
          },
          model: 'gpt-5.1',
          permissionPreset: 'careful',
          permissionPlan: {},
          approvalMode: 'strict',
          initialContext: {},
        }),
      });

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          messageId: '00000000-0000-4000-8000-000000000200',
          content: { blocks: [{ type: 'text', text: 'Hello runner' }] },
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await readSse(response), [
        {
          event: 'assistant-message-delta',
          data: {
            type: 'assistant-message-delta',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            delta: 'I can help.',
            sequence: 1,
          },
        },
        {
          event: 'assistant-message-completed',
          data: {
            type: 'assistant-message-completed',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            providerMessageId: null,
            content: { blocks: [{ type: 'text', text: 'I can help.' }] },
          },
        },
      ]);
    },
    { runtime },
  );

  assert.deepEqual(calls.sendMessage, [
    {
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      messageId: '00000000-0000-4000-8000-000000000200',
      content: { blocks: [{ type: 'text', text: 'Hello runner' }] },
    },
  ]);
});

it('returns 404 when posting a message to an unknown runner session', async () => {
  const { runtime } = createRuntime();

  await withServer(
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions/missing/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          messageId: '00000000-0000-4000-8000-000000000200',
          content: { blocks: [{ type: 'text', text: 'Hello runner' }] },
        }),
      });

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'runner session not found' });
    },
    { runtime },
  );
});

it('streams sanitized runtime errors as runner-error SSE events', async () => {
  const runtime = {
    async createSession(body) {
      return {
        runnerSessionId: `pi-${body.gallerySessionId}`,
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: [],
          models: [body.model],
          runtime: 'pi',
        },
      };
    },
    async *sendMessage(body) {
      yield {
        type: 'runner-error',
        sessionId: body.gallerySessionId,
        runnerSessionId: body.runnerSessionId,
        message: 'Provider request failed',
      };
    },
    disposeSession() {},
  };

  await withServer(
    async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          credential: {
            id: '00000000-0000-4000-8000-000000000001',
            providerType: 'openai',
            label: 'OpenAI personal',
            baseUrl: null,
            models: ['gpt-5.1'],
            defaultModel: 'gpt-5.1',
            secret: 'sk-secret',
          },
          model: 'gpt-5.1',
          permissionPreset: 'careful',
          permissionPlan: {},
          approvalMode: 'strict',
          initialContext: {},
        }),
      });

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          messageId: '00000000-0000-4000-8000-000000000200',
          content: { blocks: [{ type: 'text', text: 'Hello runner' }] },
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await readSse(response), [
        {
          event: 'runner-error',
          data: {
            type: 'runner-error',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            message: 'Provider request failed',
          },
        },
      ]);
    },
    { runtime },
  );
});

it('streams a generic runner-error when runtime message streaming throws', async () => {
  const runtime = {
    async createSession(body) {
      return {
        runnerSessionId: `pi-${body.gallerySessionId}`,
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: [],
          models: [body.model],
          runtime: 'pi',
        },
      };
    },
    async *sendMessage() {
      throw new Error('provider leaked sk-secret');
    },
    disposeSession() {},
  };

  await withServer(
    async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          credential: {
            id: '00000000-0000-4000-8000-000000000001',
            providerType: 'openai',
            label: 'OpenAI personal',
            baseUrl: null,
            models: ['gpt-5.1'],
            defaultModel: 'gpt-5.1',
            secret: 'sk-secret',
          },
          model: 'gpt-5.1',
          permissionPreset: 'careful',
          permissionPlan: {},
          approvalMode: 'strict',
          initialContext: {},
        }),
      });

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          messageId: '00000000-0000-4000-8000-000000000200',
          content: { blocks: [{ type: 'text', text: 'Hello runner' }] },
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await readSse(response), [
        {
          event: 'runner-error',
          data: {
            type: 'runner-error',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            message: 'Runner session failed',
          },
        },
      ]);
    },
    { runtime },
  );
});
```

- [ ] **Step 2: Verify runner HTTP tests fail**

```bash
pnpm --dir agent-runner test
```

Expected: FAIL because `startServer()` does not accept a runtime, `/sessions` does not require `credential.secret`, and message streaming still uses hard-coded echo events.

- [ ] **Step 3: Modify runner server to inject and use runtime**

Modify `agent-runner/src/server.mjs`.

```js
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPiRuntime } from './pi-runtime.mjs';

const capabilities = {
  protocolVersion: '2026-05-14',
  streaming: true,
  tools: [],
  models: [],
  runtime: 'pi',
};
```

Add body validation helpers.

```js
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const validateCreateSessionBody = (body) => {
  if (!isObject(body) || typeof body.gallerySessionId !== 'string') {
    return 'gallerySessionId is required';
  }

  if (!isObject(body.credential)) {
    return 'credential is required';
  }

  if (typeof body.credential.secret !== 'string' || body.credential.secret.length === 0) {
    return 'credential.secret is required';
  }

  if (typeof body.model !== 'string' || body.model.length === 0) {
    return 'model is required';
  }

  return null;
};
```

Change `startServer()` to accept a runtime and track created session ids.

```js
export const startServer = ({
  port = Number(process.env.PORT ?? 4477),
  host = process.env.HOST ?? '127.0.0.1',
  runtime = createPiRuntime(),
} = {}) => {
  const runnerSessions = new Set();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
```

Replace `/sessions` handling.

```js
if (request.method === 'POST' && url.pathname === '/sessions') {
  const result = await readJsonOrSendError(request, response);
  if (!result.ok) {
    return;
  }

  const error = validateCreateSessionBody(result.body);
  if (error) {
    sendJson(response, 400, { error });
    return;
  }

  try {
    const created = await runtime.createSession(result.body);
    runnerSessions.add(created.runnerSessionId);
    sendJson(response, 201, created);
  } catch (error) {
    sendJson(response, 502, { error: 'runner session creation failed' });
  }
  return;
}
```

Replace `/sessions/:runnerSessionId/messages` handling.

```js
if (request.method === 'POST' && messageMatch) {
  const result = await readJsonOrSendError(request, response);
  if (!result.ok) {
    return;
  }

  const runnerSessionId = decodeURIComponent(messageMatch[1]);
  if (!runnerSessions.has(runnerSessionId)) {
    sendJson(response, 404, { error: 'runner session not found' });
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    for await (const event of runtime.sendMessage({
      runnerSessionId,
      gallerySessionId: result.body.gallerySessionId,
      messageId: result.body.messageId,
      content: result.body.content,
    })) {
      sendSse(response, event.type, event);
    }
  } catch {
    sendSse(response, 'runner-error', {
      type: 'runner-error',
      sessionId: result.body.gallerySessionId,
      runnerSessionId,
      message: 'Runner session failed',
    });
  }

  response.end();
  return;
}
```

- [ ] **Step 4: Verify runner tests pass**

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 5: Commit runtime-backed runner protocol**

```bash
git add agent-runner/src/server.mjs agent-runner/src/server.test.mjs
git commit -m "feat: stream pi runtime events from agent runner"
```

## Task 4: Gallery Runner Error Event Handling

**Files:**

- Modify: `server/src/types/agent-runner.types.ts`
- Modify: `server/src/repositories/agent-runner.repository.ts`
- Modify: `server/src/repositories/agent-runner.repository.spec.ts`
- Modify: `server/src/services/agent-runner.service.ts`
- Modify: `server/src/services/agent-runner.service.spec.ts`

- [ ] **Step 1: Write failing repository tests for `runner-error` events**

Add to `server/src/repositories/agent-runner.repository.spec.ts`.

```ts
it('streams runner error events from SSE', async () => {
  const errorEvent = {
    type: 'runner-error',
    sessionId: 'gallery-session-1',
    runnerSessionId: 'runner-session-1',
    message: 'Provider request failed',
  };
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: sseBody(`event: runner-error\ndata: ${JSON.stringify(errorEvent)}\n\n`),
  });

  await expect(
    collectStream(
      sut.streamMessage({
        url: 'http://agent-runner:4477',
        runnerSessionId: 'runner-session-1',
        timeoutMs: 3000,
        body: messageBody,
      }),
    ),
  ).resolves.toEqual([errorEvent]);
});

it('throws when a runner error event omits its sanitized message', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    body: sseBody(
      'data: {"type":"runner-error","sessionId":"gallery-session-1","runnerSessionId":"runner-session-1"}\n\n',
    ),
  });

  await expect(
    collectStream(
      sut.streamMessage({
        url: 'http://agent-runner:4477',
        runnerSessionId: 'runner-session-1',
        timeoutMs: 3000,
        body: messageBody,
      }),
    ),
  ).rejects.toThrow('Agent runner returned an invalid stream event');
});
```

- [ ] **Step 2: Write failing service tests for runner-reported provider errors**

Add to `server/src/services/agent-runner.service.spec.ts`.

```ts
it('marks the session interrupted and emits the runner error when the runner reports a provider failure', async () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const sessionId = '00000000-0000-4000-8000-000000000100';
  const runnerSessionId = 'runner-session-1';
  const messageId = '00000000-0000-4000-8000-000000000200';
  const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };

  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      runnerHealthTimeoutMs: 3000,
      runnerMessageStreamTimeoutMs: 120_000,
    },
  } as never);
  agentRunnerRepository.streamMessage.mockReturnValue(
    streamEvents([
      {
        type: 'runner-error',
        sessionId,
        runnerSessionId,
        message: 'Provider request failed',
      },
    ]),
  );
  sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

  await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
    'Provider request failed',
  );

  expect(messageRepository.create).not.toHaveBeenCalled();
  expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(userId, sessionId);
  expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
    type: 'runner-error',
    sessionId,
    message: 'Provider request failed',
    createdAt: '2026-05-14T10:00:00.000Z',
  });
});

it('ignores runner error events for a different Gallery or runner session and treats the stream as incomplete', async () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const sessionId = '00000000-0000-4000-8000-000000000100';
  const runnerSessionId = 'runner-session-1';
  const messageId = '00000000-0000-4000-8000-000000000200';
  const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Organize my photos.' }] };

  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      runnerHealthTimeoutMs: 3000,
      runnerMessageStreamTimeoutMs: 120_000,
    },
  } as never);
  agentRunnerRepository.streamMessage.mockReturnValue(
    streamEvents([
      {
        type: 'runner-error',
        sessionId: '00000000-0000-4000-8000-000000000999',
        runnerSessionId,
        message: 'Wrong session',
      },
      {
        type: 'runner-error',
        sessionId,
        runnerSessionId: 'other-runner-session',
        message: 'Wrong runner',
      },
    ]),
  );
  sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

  await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
    'Agent runner message stream ended before completion',
  );

  expect(messageRepository.create).not.toHaveBeenCalled();
  expect(websocketRepository.clientSend).toHaveBeenLastCalledWith('on_agent_session_event', userId, {
    type: 'runner-error',
    sessionId,
    message: 'The assistant runner stopped while processing the message.',
    createdAt: '2026-05-14T10:00:00.000Z',
  });
});
```

- [ ] **Step 3: Verify repository and service tests fail**

```bash
pnpm --dir server test agent-runner.repository.spec.ts agent-runner.service.spec.ts
```

Expected: FAIL because `runner-error` is not part of `AgentRunnerStreamEvent` and `AgentRunnerService` only understands delta/completion events.

- [ ] **Step 4: Add `runner-error` to server runner stream types**

Modify `server/src/types/agent-runner.types.ts`.

```ts
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
    }
  | {
      type: 'runner-error';
      sessionId: string;
      runnerSessionId: string;
      message: string;
    };
```

- [ ] **Step 5: Validate `runner-error` in repository SSE parsing**

Modify `isStreamEvent()` in `server/src/repositories/agent-runner.repository.ts`.

```ts
if (body.type === 'runner-error') {
  return (
    typeof body.sessionId === 'string' &&
    typeof body.runnerSessionId === 'string' &&
    typeof body.message === 'string' &&
    body.message.trim().length > 0
  );
}
```

- [ ] **Step 6: Handle runner-reported errors in `AgentRunnerService`**

Modify `sendMessageToRunner()` in `server/src/services/agent-runner.service.ts`.

```ts
let runnerErrorMessage = 'The assistant runner stopped while processing the message.';

try {
  const { runnerUrl, runnerMessageStreamTimeoutMs } = this.configRepository.getEnv().agent;
  if (!runnerUrl) {
    throw new BadRequestException('Agent runner is not configured');
  }

  let completed = false;
  for await (const event of this.agentRunnerRepository.streamMessage({
    url: runnerUrl,
    runnerSessionId,
    timeoutMs: runnerMessageStreamTimeoutMs,
    body: { gallerySessionId: sessionId, messageId, content },
  })) {
    if (event.sessionId !== sessionId || event.runnerSessionId !== runnerSessionId) {
      continue;
    }

    if (event.type === 'runner-error') {
      runnerErrorMessage = event.message;
      throw new Error(event.message);
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

    completed = true;
    const session = await this.sessionRepository.getById(userId, sessionId);
    if (!session || !AgentRunnerService.completionActiveStatuses.includes(session.status)) {
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
      message: this.mapMessage(message),
      createdAt: this.toIsoNow(),
    });
  }

  if (!completed) {
    throw new Error('Agent runner message stream ended before completion');
  }
} catch (error) {
  await this.sessionRepository.markInterruptedFromActive(userId, sessionId).catch(() => {});
  this.websocketRepository.clientSend('on_agent_session_event', userId, {
    type: 'runner-error',
    sessionId,
    message: runnerErrorMessage,
    createdAt: this.toIsoNow(),
  });
  throw error;
}
```

- [ ] **Step 7: Verify server runner tests pass**

```bash
pnpm --dir server test agent-runner.repository.spec.ts agent-runner.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit server runner-error handling**

```bash
git add server/src/types/agent-runner.types.ts server/src/repositories/agent-runner.repository.ts server/src/repositories/agent-runner.repository.spec.ts server/src/services/agent-runner.service.ts server/src/services/agent-runner.service.spec.ts
git commit -m "feat: handle agent runner provider errors"
```

## Task 5: Verification, CI, and Review

**Files:**

- Verify only; no source file changes expected.

- [ ] **Step 1: Run formatting/lint-safe diff check**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 2: Run focused tests if local verification is allowed**

If following the current CI-only instruction, skip local execution and rely on PR CI after pushing. These are the focused commands to use only for reproducing CI failures:

```bash
pnpm --dir agent-runner test
pnpm --dir server test agent-session.service.spec.ts agent-runner.repository.spec.ts agent-runner.service.spec.ts
```

Expected when run locally or in CI: PASS.

- [ ] **Step 3: Run server typecheck through CI**

Push the branch and let the server typecheck/lint checks run in GitHub Actions.

```bash
git push origin explore/pi-agent-brainstorm
```

Expected CI result: server checks pass without TypeScript errors from the updated runner protocol types.

- [ ] **Step 4: Check generated OpenAPI artifacts**

No public API route is added in this slice. After CI and local diff review, confirm generated API files are unchanged unless existing generators update internal schema metadata.

```bash
git status --short
```

Expected: no untracked or modified `open-api/**` or `mobile/openapi/**` files caused by this slice.

- [ ] **Step 5: Review edge cases before merging**

Confirm these are covered by tests:

- Secret decryption failure happens before durable session creation.
- Raw credential secret appears only in the server-to-runner request and the runner runtime API key override.
- Runner session responses and Gallery session DTOs never include `credential.secret`.
- Runner create-session rejects missing `gallerySessionId`, missing `credential`, missing `credential.secret`, missing `model`, and invalid JSON.
- Runner message endpoint rejects unknown `runnerSessionId` with `404`.
- Pi runtime uses `noTools: "all"`, `tools: []`, and `customTools: []` in this slice.
- Pi runtime unsubscribes from per-message event listeners after each message stream completes.
- OpenAI-compatible credentials use a session-scoped provider name and base URL.
- Provider/runtime errors are redacted before becoming SSE events.
- Gallery treats valid `runner-error` as terminal and persists no assistant message.
- Gallery ignores stream events for the wrong Gallery session or runner session.

- [ ] **Step 6: Commit verification-only cleanup if needed**

If lint or generated formatting changes are needed, commit those concrete files separately.

```bash
git add agent-runner server pnpm-lock.yaml
git commit -m "fix: satisfy agent runner pi integration checks"
```

## Self-Review

- Spec coverage: This plan implements slice 8 only: Pi runtime/provider integration, constrained no-write tool configuration, transient credential handoff, runtime-backed streaming, and mocked provider boundary tests.
- TDD discipline: Every implementation task starts with failing tests, has a focused pass command, and ends with a commit.
- Edge cases: Secret leakage, decrypt failure, missing runner inputs, unknown runner sessions, invalid stream errors, provider errors, runtime creation/stream failures, per-message listener cleanup, wrong-session stream events, OpenAI-compatible provider setup, and no-write/no-built-in-tool constraints are covered.
- Out of scope: Expanded Gallery read tools, approval grants, YOLO behavior, album operation plans, plan review UI, and album writes remain reserved for later slices.
- Type consistency: The runner protocol uses `credential.secret` only in `AgentRunnerCreateSessionRequest`; persisted `AgentCredentialSnapshot` remains secret-free. `runner-error` is part of `AgentRunnerStreamEvent` and maps to the existing websocket `runner-error` client event.
