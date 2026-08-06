import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { describe, it } from 'node:test';
import { createRuntimeFromEnv, startServer } from './server.mjs';

const parseSse = (body) =>
  body
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length);
      const data = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length);
      return { event, data: data ? JSON.parse(data) : null };
    })
    .filter((frame) => frame.data !== null);

const readSse = async (response) => parseSse(await response.text());

const waitForCondition = async (condition, milliseconds = 250) => {
  const deadline = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${milliseconds}ms`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }
};

const withServer = async (runtime, test) => {
  const server = await startServer({ port: 0, runtime });
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

const createSessionBody = (overrides = {}) => ({
  gallerySessionId: '00000000-0000-4000-8000-000000000100',
  credential: {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: 'openai',
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
    secret: 'sk-session-secret',
  },
  model: 'gpt-5.1',
  permissionPreset: 'careful',
  permissionPlan: {},
  approvalMode: 'strict',
  initialContext: {},
  ...overrides,
});

const createRuntime = ({ createSession, sendMessage, resumeSession, disposeSession } = {}) => {
  const calls = { createSession: [], disposeSession: [], sendMessage: [], resumeSession: [] };

  return {
    calls,
    async createSession(body) {
      calls.createSession.push(body);
      if (createSession) {
        return createSession(body);
      }

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
    async disposeSession(runnerSessionId) {
      calls.disposeSession.push(runnerSessionId);
      if (disposeSession) {
        return disposeSession(runnerSessionId);
      }
    },
    async *sendMessage(body) {
      calls.sendMessage.push(body);
      if (sendMessage) {
        yield* sendMessage(body);
        return;
      }

      yield {
        type: 'assistant-message-delta',
        sessionId: body.gallerySessionId,
        runnerSessionId: body.runnerSessionId,
        delta: 'Runtime says hello',
        sequence: 1,
      };
      yield {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId: body.runnerSessionId,
        providerMessageId: 'provider-message-1',
        content: { blocks: [{ type: 'text', text: 'Runtime says hello' }] },
      };
    },
    async *resumeSession(body) {
      calls.resumeSession.push(body);
      if (resumeSession) {
        yield* resumeSession(body);
        return;
      }

      yield {
        type: 'assistant-message-delta',
        sessionId: body.gallerySessionId,
        runnerSessionId: body.runnerSessionId,
        delta: 'Runtime continued',
        sequence: 1,
      };
      yield {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId: body.runnerSessionId,
        providerMessageId: 'provider-message-2',
        content: { blocks: [{ type: 'text', text: 'Runtime continued' }] },
      };
    },
  };
};

const messageBody = {
  gallerySessionId: '00000000-0000-4000-8000-000000000100',
  messageId: '00000000-0000-4000-8000-000000000200',
  content: { blocks: [{ type: 'text', text: 'Hello runner' }] },
};

describe('agent runner server', () => {
  it('can be imported when process argv path is undefined', async () => {
    const originalArgvPath = process.argv[1];
    process.argv[1] = undefined;

    try {
      const module = await import(`./server.mjs?argv-undefined=${Date.now()}`);

      assert.equal(typeof module.startServer, 'function');
    } finally {
      if (originalArgvPath === undefined) {
        delete process.argv[1];
      } else {
        process.argv[1] = originalArgvPath;
      }
    }
  });

  it('selects the e2e runtime from environment', async () => {
    const runtime = createRuntimeFromEnv({ GALLERY_AGENT_RUNNER_RUNTIME: 'e2e' });

    const session = await runtime.createSession(createSessionBody({ mcpGateway: null }));

    assert.equal(session.runnerSessionId, 'e2e-00000000-0000-4000-8000-000000000100');
    assert.equal(session.capabilities.runtime, 'e2e');
  });

  it('returns health capabilities', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        status: 'ok',
        version: '0.1.0',
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: [],
          models: [],
          runtime: 'pi',
        },
      });
    });
  });

  it('returns runtime-aware health capabilities', async () => {
    const runtime = {
      ...createRuntime(),
      getCapabilities: () => ({
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['mcp:gallery'],
        models: ['e2e-album-organizer'],
        runtime: 'e2e',
      }),
    };

    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        status: 'ok',
        version: '0.1.0',
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: ['mcp:gallery'],
          models: ['e2e-album-organizer'],
          runtime: 'e2e',
        },
      });
    });
  });

  it('creates a runtime-backed runner session without returning the credential secret', async () => {
    const runtime = createRuntime();

    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      assert.equal(response.status, 201);
      const responseBody = await response.text();
      assert.equal(responseBody.includes('sk-session-secret'), false);
      assert.deepEqual(JSON.parse(responseBody), {
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: [],
          models: ['gpt-5.1'],
          runtime: 'pi',
        },
      });
      assert.equal(runtime.calls.createSession.length, 1);
      assert.equal(runtime.calls.createSession[0].credential.secret, 'sk-session-secret');
    });
  });

  it('accepts a null Gallery MCP gateway and passes it to the runtime', async () => {
    const runtime = createRuntime();

    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody({ mcpGateway: null })),
      });

      assert.equal(response.status, 201);
      assert.equal(runtime.calls.createSession.length, 1);
      assert.equal(runtime.calls.createSession[0].mcpGateway, null);
    });
  });

  it('deletes a runner session by disposing the runtime session and rejecting future messages', async () => {
    const runtime = createRuntime();

    await withServer(runtime, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });
      const { runnerSessionId } = await createResponse.json();

      const deleteResponse = await fetch(`${baseUrl}/sessions/${encodeURIComponent(runnerSessionId)}`, {
        method: 'DELETE',
      });

      assert.equal(deleteResponse.status, 204);
      assert.deepEqual(runtime.calls.disposeSession, [runnerSessionId]);

      const messageResponse = await fetch(`${baseUrl}/sessions/${encodeURIComponent(runnerSessionId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });
      assert.equal(messageResponse.status, 404);
    });
  });

  it('keeps a runner session retryable when disposal fails', async () => {
    let attempts = 0;
    const runtime = createRuntime({
      disposeSession: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('transient cleanup failure');
        }
      },
    });

    await withServer(runtime, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });
      const { runnerSessionId } = await createResponse.json();

      const firstDeleteResponse = await fetch(`${baseUrl}/sessions/${encodeURIComponent(runnerSessionId)}`, {
        method: 'DELETE',
      });
      assert.equal(firstDeleteResponse.status, 502);

      const secondDeleteResponse = await fetch(`${baseUrl}/sessions/${encodeURIComponent(runnerSessionId)}`, {
        method: 'DELETE',
      });
      assert.equal(secondDeleteResponse.status, 204);
      assert.deepEqual(runtime.calls.disposeSession, [runnerSessionId, runnerSessionId]);
    });
  });

  it('deletes a runner session by aborting an active runtime message stream', async () => {
    let messageCancelled = false;
    const runtime = createRuntime();
    runtime.sendMessage = (body) => ({
      [Symbol.asyncIterator]() {
        let sentDelta = false;
        const iterator = {
          async next() {
            if (sentDelta) {
              return new Promise(() => {});
            }

            sentDelta = true;
            return {
              done: false,
              value: {
                type: 'assistant-message-delta',
                sessionId: body.gallerySessionId,
                runnerSessionId: body.runnerSessionId,
                delta: 'first chunk',
                sequence: 1,
              },
            };
          },
          async return() {
            messageCancelled = true;
            return { done: true };
          },
        };
        runtime.activeMessageIterator = iterator;
        return iterator;
      },
    });
    runtime.disposeSession = async (runnerSessionId) => {
      runtime.calls.disposeSession.push(runnerSessionId);
      await runtime.activeMessageIterator?.return?.();
    };

    await withServer(runtime, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });
      const { runnerSessionId } = await createResponse.json();

      const response = await fetch(`${baseUrl}/sessions/${encodeURIComponent(runnerSessionId)}/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });
      assert.equal(response.status, 200);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let body = '';
      while (!body.includes('event: assistant-message-delta')) {
        const { value, done } = await reader.read();
        assert.equal(done, false);
        body += decoder.decode(value);
      }

      const deleteResponse = await fetch(`${baseUrl}/sessions/${encodeURIComponent(runnerSessionId)}`, {
        method: 'DELETE',
      });

      assert.equal(deleteResponse.status, 204);
      await waitForCondition(() => messageCancelled);
      await reader.cancel();
    });
  });

  it('validates model setup with a temporary no-tools runtime session', async () => {
    const runtime = createRuntime();

    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/validate-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          createSessionBody({
            mcpGateway: {
              url: 'https://gallery.example.test/mcp/sessions/00000000-0000-4000-8000-000000000100',
              token: 'gateway-token-secret',
            },
          }),
        ),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: [],
          models: ['gpt-5.1'],
          runtime: 'pi',
        },
      });
      assert.equal(runtime.calls.createSession.length, 1);
      assert.equal(runtime.calls.createSession[0].mcpGateway, null);
      assert.equal(runtime.calls.sendMessage.length, 1);
      assert.equal(runtime.calls.sendMessage[0].content.blocks[0].text, 'Reply with exactly: OK');
      assert.deepEqual(runtime.calls.disposeSession, ['pi-00000000-0000-4000-8000-000000000100']);
    });
  });

  it('rejects failed model setup validation without leaking credential secrets', async () => {
    const runtime = createRuntime({
      sendMessage: async function* (body) {
        yield {
          type: 'runner-error',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          message: 'provider rejected sk-session-secret',
        };
      },
    });

    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/validate-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      assert.equal(response.status, 502);
      const body = await response.text();
      assert.equal(body.includes('sk-session-secret'), false);
      assert.deepEqual(JSON.parse(body), { error: 'runner model validation failed' });
      assert.deepEqual(runtime.calls.disposeSession, ['pi-00000000-0000-4000-8000-000000000100']);
    });
  });

  it('accepts a Gallery MCP gateway without returning the gateway token', async () => {
    const runtime = createRuntime({
      createSession: async (body) => ({
        runnerSessionId: `pi-${body.gallerySessionId}`,
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: ['mcp_gallery_searchAssets', 'mcp_gallery_readAssetMetadata'],
          models: [body.model],
          runtime: 'pi',
        },
      }),
    });

    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          createSessionBody({
            mcpGateway: {
              url: 'https://gallery.example.test/mcp/sessions/00000000-0000-4000-8000-000000000100',
              token: 'gateway-token-secret',
            },
          }),
        ),
      });

      assert.equal(response.status, 201);
      const responseBody = await response.text();
      assert.equal(responseBody.includes('gateway-token-secret'), false);
      assert.deepEqual(JSON.parse(responseBody).capabilities.tools, [
        'mcp_gallery_searchAssets',
        'mcp_gallery_readAssetMetadata',
      ]);
      assert.deepEqual(runtime.calls.createSession[0].mcpGateway, {
        url: 'https://gallery.example.test/mcp/sessions/00000000-0000-4000-8000-000000000100',
        token: 'gateway-token-secret',
      });
    });
  });

  it('rejects a Gallery MCP gateway without a token', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          createSessionBody({
            mcpGateway: {
              url: 'https://gallery.example.test/mcp/sessions/00000000-0000-4000-8000-000000000100',
            },
          }),
        ),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'mcpGateway.token is required' });
    });
  });

  it('rejects a Gallery MCP gateway without a URL', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          createSessionBody({
            mcpGateway: {
              token: 'gateway-token-secret',
            },
          }),
        ),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'mcpGateway.url is required' });
    });
  });

  it('rejects a non-object Gallery MCP gateway', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody({ mcpGateway: 'https://gallery.example.test/mcp' })),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'mcpGateway is required' });
    });
  });

  it('filters successful runtime session creation responses to protocol fields', async () => {
    const runtime = createRuntime({
      createSession: async () => ({
        runnerSessionId: 'pi-extra-fields',
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: [],
          models: ['gpt-5.1'],
          runtime: 'pi',
        },
        credential: { secret: 'sk-runtime-response-secret' },
        debug: 'runtime internals',
      }),
    });

    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      assert.equal(response.status, 201);
      const responseBody = await response.text();
      assert.equal(responseBody.includes('sk-runtime-response-secret'), false);
      assert.deepEqual(JSON.parse(responseBody), {
        runnerSessionId: 'pi-extra-fields',
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: [],
          models: ['gpt-5.1'],
          runtime: 'pi',
        },
      });
    });
  });

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

  it('rejects invalid runtime session creation responses without leaking or tracking them', async () => {
    const runtime = createRuntime({
      createSession: async () => ({
        runnerSessionId: 123,
        capabilities: {
          protocolVersion: '2026-05-14',
          streaming: true,
          tools: [],
          models: ['gpt-5.1'],
        },
        credential: { secret: 'sk-runtime-response-secret' },
      }),
    });

    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      assert.equal(response.status, 502);
      const responseBody = await response.text();
      assert.equal(responseBody.includes('sk-runtime-response-secret'), false);
      assert.deepEqual(JSON.parse(responseBody), { error: 'runner session creation failed' });

      const messageResponse = await fetch(`${baseUrl}/sessions/123/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });
      assert.equal(messageResponse.status, 404);
      assert.deepEqual(await messageResponse.json(), { error: 'runner session not found' });
    });
  });

  it('rejects session creation without a Gallery session id', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const body = createSessionBody();
      delete body.gallerySessionId;

      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'gallerySessionId is required' });
    });
  });

  it('rejects session creation without a credential', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const body = createSessionBody();
      delete body.credential;

      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'credential is required' });
    });
  });

  it('rejects session creation without a credential secret', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody({ credential: { label: 'OpenAI personal' } })),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'credential.secret is required' });
    });
  });

  it('rejects session creation with an empty credential secret', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody({ credential: { ...createSessionBody().credential, secret: '' } })),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'credential.secret is required' });
    });
  });

  it('rejects session creation without a model', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const body = createSessionBody();
      delete body.model;

      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'model is required' });
    });
  });

  it('rejects session creation with an empty model', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody({ model: '' })),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'model is required' });
    });
  });

  it('returns a generic error when runtime session creation fails without leaking secrets', async () => {
    const runtime = createRuntime({
      createSession: async () => {
        throw new Error('provider rejected sk-session-secret');
      },
    });

    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      assert.equal(response.status, 502);
      const responseBody = await response.text();
      assert.equal(responseBody.includes('sk-session-secret'), false);
      assert.deepEqual(JSON.parse(responseBody), { error: 'runner session creation failed' });
    });
  });

  it('rejects null session JSON without a Gallery session id', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(250),
        body: 'null',
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'gallerySessionId is required' });
    });
  });

  it('rejects non-string Gallery session ids', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody({ gallerySessionId: 123 })),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'gallerySessionId is required' });
    });
  });

  it('returns 400 for malformed session JSON', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'invalid JSON body' });
    });
  });

  it('streams runtime assistant message events for a message', async () => {
    const runtime = createRuntime();

    await withServer(runtime, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });
      assert.equal(createResponse.status, 201);

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/event-stream');
      assert.deepEqual(await readSse(response), [
        {
          event: 'assistant-message-delta',
          data: {
            type: 'assistant-message-delta',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            delta: 'Runtime says hello',
            sequence: 1,
          },
        },
        {
          event: 'assistant-message-completed',
          data: {
            type: 'assistant-message-completed',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            providerMessageId: 'provider-message-1',
            content: { blocks: [{ type: 'text', text: 'Runtime says hello' }] },
          },
        },
      ]);
      assert.deepEqual(runtime.calls.sendMessage, [
        {
          runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          messageId: '00000000-0000-4000-8000-000000000200',
          content: { blocks: [{ type: 'text', text: 'Hello runner' }] },
        },
      ]);
    });
  });

  it('sends message SSE chunks before the runtime stream completes', async () => {
    let releaseCompletion;
    const runtime = createRuntime({
      async *sendMessage(body) {
        yield {
          type: 'assistant-message-delta',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          delta: 'first chunk',
          sequence: 1,
        };
        await new Promise((resolve) => {
          releaseCompletion = resolve;
        });
        yield {
          type: 'assistant-message-completed',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          providerMessageId: null,
          content: { blocks: [{ type: 'text', text: 'first chunk done' }] },
        };
      },
    });

    await withServer(runtime, async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      await new Promise((resolve, reject) => {
        const request = httpRequest(
          `${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/messages`,
          {
            method: 'POST',
            headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
          },
          (response) => {
            assert.equal(response.statusCode, 200);
            response.setEncoding('utf8');

            let body = '';
            let released = false;
            const timeout = setTimeout(() => {
              releaseCompletion?.();
              reject(new Error('timed out waiting for streamed delta before completion'));
            }, 250);

            response.on('data', (chunk) => {
              body += chunk;
              if (!released && body.includes('event: assistant-message-delta') && body.includes('first chunk')) {
                released = true;
                assert.match(body, /first chunk/);
                releaseCompletion();
              }
            });
            response.on('end', () => {
              clearTimeout(timeout);
              assert.equal(released, true);
              assert.match(body, /event: assistant-message-completed/);
              resolve();
            });
          },
        );
        request.on('error', reject);
        request.end(JSON.stringify(messageBody));
      });
    });
  });

  it('passes runtime activity events through the message SSE stream', async () => {
    const runtime = createRuntime({
      async *sendMessage(body) {
        yield {
          type: 'activity',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          kind: 'plan-composing',
          status: 'running',
          summary: 'Composing a plan',
        };
        yield {
          type: 'assistant-message-completed',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          providerMessageId: null,
          content: { blocks: [{ type: 'text', text: 'Done.' }] },
        };
      },
    });

    await withServer(runtime, async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await readSse(response), [
        {
          event: 'activity',
          data: {
            type: 'activity',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            kind: 'plan-composing',
            status: 'running',
            summary: 'Composing a plan',
          },
        },
        {
          event: 'assistant-message-completed',
          data: {
            type: 'assistant-message-completed',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            providerMessageId: null,
            content: { blocks: [{ type: 'text', text: 'Done.' }] },
          },
        },
      ]);
    });
  });

  it('passes activity and deltas through the approval resume SSE stream for large approved results', async () => {
    const runtime = createRuntime({
      async *resumeSession(body) {
        assert.equal(body.toolResult.assets.length, 300);
        yield {
          type: 'activity',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          kind: 'tool-call-completed',
          status: 'running',
          summary: 'Continuing after approved Gallery result',
        };
        yield {
          type: 'assistant-message-delta',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          delta: 'Continuing',
          sequence: 1,
        };
        yield {
          type: 'assistant-message-completed',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          providerMessageId: null,
          content: { blocks: [{ type: 'text', text: 'Continuing after approval.' }] },
        };
      },
    });

    await withServer(runtime, async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/continue`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          toolCallId: '00000000-0000-4000-8000-000000000333',
          approvalDecision: 'approved',
          toolResult: {
            status: 'success',
            assets: Array.from({ length: 300 }, (_, index) => ({ id: `asset-${index}`, filename: `IMG-${index}.jpg` })),
          },
        }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await readSse(response), [
        {
          event: 'activity',
          data: {
            type: 'activity',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            kind: 'tool-call-completed',
            status: 'running',
            summary: 'Continuing after approved Gallery result',
          },
        },
        {
          event: 'assistant-message-delta',
          data: {
            type: 'assistant-message-delta',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            delta: 'Continuing',
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
            content: { blocks: [{ type: 'text', text: 'Continuing after approval.' }] },
          },
        },
      ]);
    });
  });

  it('continues an existing runner session and streams resumed assistant events', async () => {
    const runtime = createRuntime();

    await withServer(runtime, async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/continue`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          toolCallId: '00000000-0000-4000-8000-000000000333',
          approvalDecision: 'approved',
          toolResult: { status: 'success', albums: [{ id: 'album-1', albumName: 'Test Pierre' }] },
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
            delta: 'Runtime continued',
            sequence: 1,
          },
        },
        {
          event: 'assistant-message-completed',
          data: {
            type: 'assistant-message-completed',
            sessionId: '00000000-0000-4000-8000-000000000100',
            runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
            providerMessageId: 'provider-message-2',
            content: { blocks: [{ type: 'text', text: 'Runtime continued' }] },
          },
        },
      ]);
      assert.deepEqual(runtime.calls.resumeSession, [
        {
          runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          toolCallId: '00000000-0000-4000-8000-000000000333',
          approvalDecision: 'approved',
          toolResult: { status: 'success', albums: [{ id: 'album-1', albumName: 'Test Pierre' }] },
        },
      ]);
    });
  });

  it('returns JSON 404 for unknown continuation runner sessions without invoking the runtime', async () => {
    const runtime = createRuntime();

    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions/pi-missing/continue`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          toolCallId: '00000000-0000-4000-8000-000000000333',
          approvalDecision: 'approved',
        }),
      });

      assert.equal(response.status, 404);
      assert.equal(response.headers.get('content-type'), 'application/json');
      assert.deepEqual(await response.json(), { error: 'runner session not found' });
      assert.deepEqual(runtime.calls.resumeSession, []);
    });
  });

  it('rejects invalid continuation bodies before calling the runtime', async () => {
    const runtime = createRuntime();
    const cases = [
      {
        body: { toolCallId: '00000000-0000-4000-8000-000000000333', approvalDecision: 'approved' },
        error: 'gallerySessionId is required',
      },
      {
        body: { gallerySessionId: messageBody.gallerySessionId, toolCallId: 123, approvalDecision: 'approved' },
        error: 'toolCallId must be a string',
      },
      {
        body: {
          gallerySessionId: messageBody.gallerySessionId,
          toolCallId: '00000000-0000-4000-8000-000000000333',
          approvalDecision: 'maybe',
        },
        error: 'approvalDecision must be approved or denied',
      },
      {
        body: {
          gallerySessionId: messageBody.gallerySessionId,
          toolCallId: '00000000-0000-4000-8000-000000000333',
          approvalDecision: 'approved',
          toolResult: 'not-object',
        },
        error: 'toolResult must be an object',
      },
    ];

    await withServer(runtime, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });
      assert.equal(createResponse.status, 201);

      for (const testCase of cases) {
        const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/continue`, {
          method: 'POST',
          headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
          body: JSON.stringify(testCase.body),
        });

        assert.equal(response.status, 400);
        assert.equal(response.headers.get('content-type'), 'application/json');
        assert.deepEqual(await response.json(), { error: testCase.error });
      }

      assert.deepEqual(runtime.calls.resumeSession, []);
    });
  });

  it('rejects continuation requests whose Gallery session id does not match the runner session', async () => {
    const runtime = createRuntime();

    await withServer(runtime, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });
      assert.equal(createResponse.status, 201);

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/continue`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000999',
          toolCallId: '00000000-0000-4000-8000-000000000333',
          approvalDecision: 'approved',
        }),
      });

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'runner session not found' });
      assert.deepEqual(runtime.calls.resumeSession, []);
    });
  });

  it('streams a generic runner-error when runtime continuation throws without leaking secrets', async () => {
    const runtime = createRuntime({
      async *resumeSession() {
        throw new Error('provider rejected sk-session-secret');
      },
    });

    await withServer(runtime, async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/continue`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          toolCallId: '00000000-0000-4000-8000-000000000333',
          approvalDecision: 'approved',
        }),
      });

      assert.equal(response.status, 200);
      const responseBody = await response.text();
      assert.equal(responseBody.includes('sk-session-secret'), false);
      assert.deepEqual(parseSse(responseBody), [
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
    });
  });

  it('continues with default Accept headers and still returns an SSE stream', async () => {
    const runtime = createRuntime();

    await withServer(runtime, async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          approvalDecision: 'denied',
        }),
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/event-stream');
      assert.equal((await readSse(response)).at(-1).event, 'assistant-message-completed');
    });
  });

  it('stops the runtime continuation stream when the client disconnects', async () => {
    let continuationCancelled = false;
    const runtime = createRuntime();
    runtime.resumeSession = (body) => ({
      [Symbol.asyncIterator]() {
        let sentDelta = false;
        return {
          async next() {
            if (sentDelta) {
              return new Promise(() => {});
            }

            sentDelta = true;
            return {
              done: false,
              value: {
                type: 'assistant-message-delta',
                sessionId: body.gallerySessionId,
                runnerSessionId: body.runnerSessionId,
                delta: 'first resumed chunk',
                sequence: 1,
              },
            };
          },
          async return() {
            continuationCancelled = true;
            return { done: true };
          },
        };
      },
    });

    await withServer(runtime, async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      await new Promise((resolve, reject) => {
        const request = httpRequest(
          `${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/continue`,
          {
            method: 'POST',
            headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
          },
          (response) => {
            assert.equal(response.statusCode, 200);
            response.setEncoding('utf8');

            response.on('data', (chunk) => {
              if (chunk.includes('event: assistant-message-delta')) {
                response.destroy();
                resolve();
              }
            });
          },
        );
        request.on('error', reject);
        request.end(
          JSON.stringify({
            gallerySessionId: '00000000-0000-4000-8000-000000000100',
            toolCallId: '00000000-0000-4000-8000-000000000333',
            approvalDecision: 'approved',
          }),
        );
      });

      await waitForCondition(() => continuationCancelled);
    });
  });

  it('returns 404 for unknown runner sessions', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions/pi-missing/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'runner session not found' });
    });
  });

  it('returns 400 for malformed message JSON before checking runner session existence', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions/pi-missing/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: '{',
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'invalid JSON body' });
    });
  });

  it('returns a JSON error for malformed encoded runner session ids', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions/%E0%A4%A/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'runner session not found' });
    });
  });

  it('rejects invalid message bodies before calling the runtime', async () => {
    const runtime = createRuntime();
    const cases = [
      {
        body: { messageId: messageBody.messageId, content: messageBody.content },
        error: 'gallerySessionId is required',
      },
      {
        body: { ...messageBody, gallerySessionId: 123 },
        error: 'gallerySessionId is required',
      },
      {
        body: { gallerySessionId: messageBody.gallerySessionId, content: messageBody.content },
        error: 'messageId is required',
      },
      {
        body: { ...messageBody, messageId: 123 },
        error: 'messageId is required',
      },
      {
        body: { gallerySessionId: messageBody.gallerySessionId, messageId: messageBody.messageId },
        error: 'content is required',
      },
      {
        body: { ...messageBody, content: { blocks: 'not-array' } },
        error: 'content is required',
      },
    ];

    await withServer(runtime, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });
      assert.equal(createResponse.status, 201);

      for (const testCase of cases) {
        const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/messages`, {
          method: 'POST',
          headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
          body: JSON.stringify(testCase.body),
        });

        assert.equal(response.status, 400);
        assert.equal(response.headers.get('content-type'), 'application/json');
        assert.deepEqual(await response.json(), { error: testCase.error });
      }

      assert.deepEqual(runtime.calls.sendMessage, []);
    });
  });

  it('rejects message requests whose Gallery session id does not match the runner session', async () => {
    const runtime = createRuntime();

    await withServer(runtime, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });
      assert.equal(createResponse.status, 201);

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...messageBody,
          gallerySessionId: '00000000-0000-4000-8000-000000000999',
        }),
      });

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'runner session not found' });
      assert.deepEqual(runtime.calls.sendMessage, []);
    });
  });

  it('streams runtime runner-error events', async () => {
    const runtime = createRuntime({
      async *sendMessage(body) {
        yield {
          type: 'runner-error',
          sessionId: body.gallerySessionId,
          runnerSessionId: body.runnerSessionId,
          message: 'Provider request failed',
        };
      },
    });

    await withServer(runtime, async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
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
    });
  });

  it('streams a generic runner-error when runtime message streaming throws without leaking secrets', async () => {
    const runtime = createRuntime({
      async *sendMessage() {
        throw new Error('provider rejected sk-session-secret');
      },
    });

    await withServer(runtime, async (baseUrl) => {
      await fetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSessionBody()),
      });

      const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/messages`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });

      assert.equal(response.status, 200);
      const responseBody = await response.text();
      assert.equal(responseBody.includes('sk-session-secret'), false);
      assert.deepEqual(parseSse(responseBody), [
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
    });
  });

  it('returns 404 for unknown routes', async () => {
    await withServer(createRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/unknown`);

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'not found' });
    });
  });
});
