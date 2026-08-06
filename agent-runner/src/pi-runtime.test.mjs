import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { galleryMcpPromptCheatSheet } from './generated/gallery-mcp-prompt-cheat-sheet.mjs';
import {
  compactGalleryToolResultForPrompt,
  compactGalleryToolTranscript,
  createPiRuntime,
  mapProviderType,
  redactSecret,
} from './pi-runtime.mjs';

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

const createMcpGateway = (overrides = {}) => ({
  url: 'https://gallery.example.test/mcp/sessions/00000000-0000-4000-8000-000000000100',
  token: 'mcp-token-secret',
  ...overrides,
});

const createDeferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

const withTimeout = async (promise, milliseconds = 250) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timed out after ${milliseconds}ms`)), milliseconds);
    }),
  ]);

const rejectAfter = (milliseconds, message) =>
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), milliseconds);
  });

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

const createMessageRequest = (overrides = {}) => ({
  runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
  gallerySessionId: '00000000-0000-4000-8000-000000000100',
  messageId: '00000000-0000-4000-8000-000000000200',
  content: { blocks: [{ type: 'text', text: 'Organize my photos.' }] },
  ...overrides,
});

const createFakeDependencies = ({ promptGate, sessionAbortGate, mcpToolNames = ['mcp_gallery_searchAssets'] } = {}) => {
  const calls = {
    runtimeApiKeys: [],
    loaders: [],
    createAgentSession: [],
    activeToolNames: [],
    bindExtensions: [],
    prompts: [],
    continues: 0,
    authCreate: 0,
    authInMemory: 0,
    modelRegistryCreate: 0,
    modelRegistryInMemory: 0,
    subscribed: 0,
    unsubscribed: 0,
    disposed: 0,
    sessionAborted: 0,
    agentAborted: 0,
    reloadEnvironments: [],
    bindEnvironments: [],
  };
  const registeredModels = [];
  let listener;
  const abortGate = createDeferred();
  const fakeAssistantMessage = (text) => ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-5-mini',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  });
  const session = {
    sessionId: 'pi-sdk-session-1',
    agent: {
      async continue() {
        calls.continues += 1;
        listener?.({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'Approved. Continuing.' },
        });
        this.messages?.push?.(fakeAssistantMessage('Approved. Continuing.'));
        session.messages.push(fakeAssistantMessage('Approved. Continuing.'));
        listener?.({ type: 'message_end' });
      },
      abort() {
        calls.agentAborted += 1;
        abortGate.resolve();
      },
    },
    messages: [],
    subscribe(next) {
      calls.subscribed += 1;
      listener = next;
      return () => {
        calls.unsubscribed += 1;
      };
    },
    emitAssistantDelta(delta) {
      listener?.({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta },
      });
    },
    emitMessageEnd() {
      listener?.({ type: 'message_end' });
    },
    async prompt(text) {
      calls.prompts.push(text);
      for (const message of this.messages) {
        if (message.role === 'assistant') {
          // Mirrors Pi's context accounting: assistant messages in the transcript must carry usage.
          void message.usage.totalTokens;
        }
      }
      this.emitAssistantDelta('I can help.');
      if (promptGate) {
        await Promise.race([promptGate.promise, abortGate.promise]);
      }
      this.messages.push(fakeAssistantMessage('I can help.'));
      this.emitMessageEnd();
    },
    dispose() {
      calls.disposed += 1;
    },
    async abort() {
      calls.sessionAborted += 1;
      if (sessionAbortGate) {
        await sessionAbortGate.promise;
      }
      abortGate.resolve();
    },
    async bindExtensions(input) {
      calls.bindExtensions.push(input);
      calls.bindEnvironments.push({ cwd: process.cwd(), home: process.env.HOME });
      calls.activeToolNames = mcpToolNames;
    },
    getActiveToolNames() {
      return calls.activeToolNames;
    },
  };

  class DefaultResourceLoader {
    constructor(options) {
      this.options = options;
      this.extensionsResult = { runtime: { pendingProviderRegistrations: [] } };
      calls.loaders.push(options);
    }

    async reload() {
      calls.reloadEnvironments.push({ cwd: process.cwd(), home: process.env.HOME });
      for (const factory of this.options.extensionFactories ?? []) {
        factory({
          registerProvider: (name, config) => {
            this.extensionsResult.runtime.pendingProviderRegistrations.push({ name, config, extensionPath: '<inline:1>' });
          },
        });
      }
    }

    getExtensions() {
      return this.extensionsResult;
    }
  }

  const sdk = {
    AuthStorage: {
      create: () => {
        calls.authCreate += 1;
        return {
          setRuntimeApiKey: (provider, secret) => calls.runtimeApiKeys.push({ provider, secret }),
        };
      },
      inMemory: () => {
        calls.authInMemory += 1;
        return {
          setRuntimeApiKey: (provider, secret) => calls.runtimeApiKeys.push({ provider, secret }),
        };
      },
    },
    ModelRegistry: {
      create: () => {
        calls.modelRegistryCreate += 1;
        return {
          find: (provider, model) => ({ provider, id: model, source: 'file-backed' }),
          registerProvider: (name, config) => {
            calls.registeredProvider = { name, config };
            for (const model of config.models ?? []) {
              registeredModels.push({
                provider: name,
                id: model.id,
                name: model.name,
                api: model.api ?? config.api,
                baseUrl: model.baseUrl ?? config.baseUrl,
                source: 'registered-provider',
              });
            }
          },
        };
      },
      inMemory: () => {
        calls.modelRegistryInMemory += 1;
        return {
          find: (provider, model) =>
            registeredModels.find((registeredModel) => registeredModel.provider === provider && registeredModel.id === model),
          registerProvider: (name, config) => {
            calls.registeredProvider = { name, config };
            for (const model of config.models ?? []) {
              registeredModels.push({
                provider: name,
                id: model.id,
                name: model.name,
                api: model.api ?? config.api,
                baseUrl: model.baseUrl ?? config.baseUrl,
                source: 'registered-provider',
              });
            }
          },
        };
      },
    },
    SessionManager: { inMemory: () => ({ kind: 'session-manager' }) },
    SettingsManager: { inMemory: (settings) => ({ kind: 'settings-manager', settings }) },
    DefaultResourceLoader,
    createAgentSession: async (options) => {
      calls.createAgentSession.push(options);
      return { session };
    },
  };

  // Default classifier intent: 'none' so the LLM path is deterministic and never
  // reaches a real provider. Recall tests override `ai.classifyIntent`. This is
  // the minimal-perturbation way to keep the default 'hybrid' router mode while
  // making existing tests deterministic (no real model call).
  const ai = {
    getModel: (provider, model) => (provider === 'openai' ? { provider, id: model, source: 'builtin' } : undefined),
    classifyIntent: async () => ({ workflow: 'none', slots: {}, confidence: 'low' }),
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

const strictTripCandidateHandleId = '00000000-0000-4000-8000-000000000921';
const strictTripPlanId = '00000000-0000-4000-8000-000000000923';

const makeStrictTripCandidate = (overrides = {}) => ({
  dedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
  title: 'Recent trip to New York, USA',
  subtitle: '28 photos over 10 days',
  takenAfter: '2026-05-03T00:00:00.000Z',
  takenBefore: '2026-05-12T23:59:59.000Z',
  albumAssetCount: 28,
  excludedDuplicateCount: 3,
  excludedStackChildCount: 1,
  placeLabels: ['New York, USA'],
  selectionHandle: {
    id: strictTripCandidateHandleId,
    sourceRef: `asset-source:search:${strictTripCandidateHandleId}`,
    assetCount: 28,
  },
  ...overrides,
});

const createStrictWorkflowFetch = ({
  candidates = [makeStrictTripCandidate()],
  recommendation = {
    action: 'use_top_candidate',
    candidateDedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
    reason: 'The only readable trip candidate is high confidence.',
  },
  planResponse = {
    status: 'success',
    summary: 'Stored proposed album from selection.',
    plan: { id: strictTripPlanId },
  },
  expectedAlbumName = 'USA Trip',
  expectedSelectionHandleId = strictTripCandidateHandleId,
  placeHint = 'USA',
} = {}) => {
  const calls = [];
  const fetchImplementation = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), headers: init?.headers, body });
    const requestId = body.id;
    const name = body?.params?.name;
    const args = body?.params?.arguments ?? {};

    if (name === 'findTripCandidates') {
      assert.deepEqual(args, { placeHint });
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          result: {
            structuredContent: {
              status: 'success',
              summary: `Found ${candidates.length} trip candidate(s) matching "${placeHint}".`,
              recommendation,
              candidates,
            },
          },
        }),
      );
    }

    if (name === 'proposeAlbumFromSelection') {
      assert.equal(args.albumName, expectedAlbumName);
      assert.equal(args.selectionHandleId, expectedSelectionHandleId);
      assert.equal(JSON.stringify(args).includes('assetIds'), false);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          result: {
            structuredContent: planResponse,
          },
        }),
      );
    }

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        error: { code: -32601, message: `Unexpected tool ${name}` },
      }),
      { status: 200 },
    );
  };

  return { calls, fetchImplementation };
};

describe('pi runtime adapter', () => {
  it('declares the Pi MCP extension dependency at the required version', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

    assert.equal(packageJson.dependencies['pi-mcp-extension'], '1.5.0');
  });

  it('maps built-in provider types to Pi provider names', () => {
    assert.equal(mapProviderType('openai', 'session-1'), 'openai');
    assert.equal(mapProviderType('anthropic', 'session-1'), 'anthropic');
    assert.equal(mapProviderType('openai-compatible', 'session-1'), 'gallery-session-1');
  });

  it('redacts provider secrets from error messages', () => {
    assert.equal(redactSecret('request failed for sk-openai-secret', 'sk-openai-secret'), 'request failed for [redacted]');
    assert.equal(redactSecret('request failed', 'sk-openai-secret'), 'request failed');
  });

  it('creates a Pi SDK session with runtime API key, selected model, and no enabled tools when MCP is absent', async () => {
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
    assert.equal(calls.createAgentSession[0].noTools, 'builtin');
    assert.deepEqual(calls.createAgentSession[0].tools, []);
    assert.deepEqual(calls.createAgentSession[0].customTools ?? [], []);
    assert.deepEqual(calls.loaders[0].additionalExtensionPaths ?? [], []);
    assert.equal(calls.bindExtensions.length, 0);
  });

  it('writes per-session Gallery MCP config and exposes active MCP tools when a gateway is present', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    const result = await runtime.createSession(
      createSessionBody({
        mcpGateway: createMcpGateway(),
      }),
    );

    const loaderOptions = calls.loaders[0];
    const configPath = join(loaderOptions.cwd, '.pi/mcp.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    assert.deepEqual(Object.keys(config.mcpServers), ['gallery']);
    assert.deepEqual(config.mcpServers.gallery, {
      transport: 'streamable-http',
      lifecycle: 'eager',
      url: 'https://gallery.example.test/mcp/sessions/00000000-0000-4000-8000-000000000100',
      headers: { Authorization: 'Bearer mcp-token-secret' },
    });
    assert.ok(loaderOptions.cwd.includes('.pi-runtime/sessions/'));
    assert.equal(relative(join(loaderOptions.agentDir, '..'), loaderOptions.cwd).startsWith('..'), false);
    assert.equal(loaderOptions.noExtensions, true);
    assert.equal(loaderOptions.additionalExtensionPaths.length, 1);
    assert.ok(loaderOptions.additionalExtensionPaths[0].endsWith('node_modules/pi-mcp-extension/src/index.ts'));
    assert.equal(calls.createAgentSession[0].noTools, 'builtin');
    assert.equal(calls.createAgentSession[0].cwd, loaderOptions.cwd);
    assert.equal(calls.createAgentSession[0].agentDir, loaderOptions.agentDir);
    assert.equal(calls.createAgentSession[0].tools, undefined);
    assert.deepEqual(calls.createAgentSession[0].customTools ?? [], []);
    assert.deepEqual(calls.bindExtensions, [{}]);
    assert.deepEqual(result.capabilities.tools, ['mcp_gallery_searchAssets']);
    assert.deepEqual(calls.reloadEnvironments[0], { cwd: loaderOptions.cwd, home: loaderOptions.homeDir });
    assert.deepEqual(calls.bindEnvironments[0], { cwd: loaderOptions.cwd, home: loaderOptions.homeDir });
    assert.notEqual(process.cwd(), loaderOptions.cwd);
  });

  it('does not use host global MCP config when the extension is loaded', async () => {
    const { sdk, ai, calls } = createFakeDependencies({ mcpToolNames: ['mcp_global_leaked', 'mcp_gallery_searchAssets'] });
    const runtime = createPiRuntime({ sdk, ai });

    const result = await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    assert.equal(calls.loaders[0].homeDir?.includes('.pi-runtime'), true);
    assert.deepEqual(result.capabilities.tools, ['mcp_gallery_searchAssets']);
  });

  it('redacts provider and MCP secrets from MCP startup failures', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.bindExtensions = async () => {
      throw new Error('bind failed with sk-openai-secret and mcp-token-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });

    await assert.rejects(
      () => runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() })),
      (error) => {
        assert.equal(error.message, 'bind failed with [redacted] and [redacted]');
        assert.equal(error.message.includes('sk-openai-secret'), false);
        assert.equal(error.message.includes('mcp-token-secret'), false);
        return true;
      },
    );
  });

  it('fails startup when no active Gallery MCP tool appears after binding extensions', async () => {
    const { sdk, ai } = createFakeDependencies({ mcpToolNames: ['mcp_other_search'] });
    const runtime = createPiRuntime({ sdk, ai });

    await assert.rejects(
      () => runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() })),
      (error) => {
        assert.equal(error.message.includes('mcp-token-secret'), false);
        assert.match(error.message, /No active Gallery MCP tools/);
        return true;
      },
    );
  });

  it('redacts provider and MCP secrets from Pi session creation failures', async () => {
    const { sdk, ai } = createFakeDependencies();
    sdk.createAgentSession = async () => {
      throw new Error('create failed with sk-openai-secret and mcp-token-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });

    await assert.rejects(
      () => runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() })),
      (error) => {
        assert.equal(error.message, 'create failed with [redacted] and [redacted]');
        return true;
      },
    );
  });

  it('writes isolated MCP config directories for concurrent Gallery sessions', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    await Promise.all([
      runtime.createSession(
        createSessionBody({
          gallerySessionId: 'session-a',
          mcpGateway: createMcpGateway({ url: 'https://one.example/mcp', token: 'token-one' }),
        }),
      ),
      runtime.createSession(
        createSessionBody({
          gallerySessionId: 'session-b',
          mcpGateway: createMcpGateway({ url: 'https://two.example/mcp', token: 'token-two' }),
        }),
      ),
    ]);

    const configs = await Promise.all(
      calls.loaders.map(async (loader) => JSON.parse(await readFile(join(loader.cwd, '.pi/mcp.json'), 'utf8'))),
    );
    assert.notEqual(calls.loaders[0].cwd, calls.loaders[1].cwd);
    assert.deepEqual(
      configs
        .map((config) => [config.mcpServers.gallery.url, config.mcpServers.gallery.headers.Authorization])
        .sort(),
      [
        ['https://one.example/mcp', 'Bearer token-one'],
        ['https://two.example/mcp', 'Bearer token-two'],
      ],
    );
  });

  it('keeps path-like Gallery session ids inside the runtime directory', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    await runtime.createSession(createSessionBody({ gallerySessionId: '../escape', mcpGateway: createMcpGateway() }));

    const runtimeDir = join(new URL('..', import.meta.url).pathname, '.pi-runtime');
    assert.equal(relative(runtimeDir, calls.loaders[0].cwd).startsWith('..'), false);
    assert.equal(existsSync(join(calls.loaders[0].cwd, '.pi/mcp.json')), true);
  });

  it('removes the token-bearing MCP config directory on dispose', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
    const sessionWorkspace = calls.loaders[0].cwd;

    await runtime.disposeSession('pi-00000000-0000-4000-8000-000000000100');

    assert.equal(existsSync(sessionWorkspace), false);
  });

  it('removes the old MCP config directory when replacing a deterministic session', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway({ token: 'old-token' }) }));
    const oldWorkspace = calls.loaders[0].cwd;

    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway({ token: 'new-token' }) }));

    assert.equal(existsSync(oldWorkspace), false);
    assert.notEqual(calls.loaders[1].cwd, oldWorkspace);
    await rm(calls.loaders[1].cwd, { recursive: true, force: true });
  });

  it('uses transient in-memory Pi auth storage and model registry', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    await runtime.createSession(createSessionBody());

    assert.equal(calls.authCreate, 0);
    assert.equal(calls.modelRegistryCreate, 0);
    assert.equal(calls.authInMemory, 1);
    assert.equal(calls.modelRegistryInMemory, 1);
  });

  it('constructs the Pi resource loader with concrete runtime paths', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    await runtime.createSession(createSessionBody());

    assert.equal(calls.loaders.length, 1);
    assert.equal(typeof calls.loaders[0].cwd, 'string');
    assert.notEqual(calls.loaders[0].cwd, '');
    assert.ok(calls.loaders[0].cwd.endsWith('agent-runner'));
    assert.equal(typeof calls.loaders[0].agentDir, 'string');
    assert.notEqual(calls.loaders[0].agentDir, '');
    assert.ok(calls.loaders[0].agentDir.endsWith('agent-runner/.pi-runtime'));
    assert.equal(calls.loaders[0].noContextFiles, true);
    assert.equal(calls.loaders[0].noSkills, true);
    assert.equal(calls.loaders[0].noPromptTemplates, true);
    assert.equal(calls.loaders[0].noThemes, true);
    assert.equal(calls.loaders[0].noExtensions, true);
    assert.ok(Array.isArray(calls.loaders[0].extensionFactories));
    assert.equal(calls.loaders[0].systemPrompt.startsWith('You are Gallery Assistant'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('Gallery MCP tool-use cheat sheet'), true);
    assert.equal(galleryMcpPromptCheatSheet.includes('mcp_gallery_searchAssets'), true);
    assert.equal(galleryMcpPromptCheatSheet.includes('mcp_gallery_readAssetMetadata'), true);
    assert.equal(galleryMcpPromptCheatSheet.includes('mcp_gallery_proposeAlbumOperations'), true);
    assert.equal(galleryMcpPromptCheatSheet.includes('toolCallId'), true);
    assert.equal(galleryMcpPromptCheatSheet.includes('album.create'), true);
    assert.equal(galleryMcpPromptCheatSheet.includes('album.addAssets'), true);
    assert.equal(galleryMcpPromptCheatSheet.includes('exampleArguments'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('mcp_gallery_searchAssets'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('mcp_gallery_readAssetMetadata'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('mcp_gallery_proposeAlbumOperations'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('Progressive: resolve names -> search detail ids'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('limit up to 1000'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('Do not use limit 1000'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('Best/highlights require bounded source'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('default to 10 only when the source is bounded'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('zero, negative, or above 1000'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('known count or total is above 1000'), true);
    assert.equal(
      calls.loaders[0].systemPrompt.includes('No matching highlight candidates: answer directly and do not create a plan'),
      true,
    );
    assert.equal(calls.loaders[0].systemPrompt.includes('metadata-only suggested highlights'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('prioritize existing favorites and ratings'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('selected assetIds only'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('do not use broad assetSource'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('No previews are required for metadata-only highlight plans'), true);
    assert.equal(
      calls.loaders[0].systemPrompt.includes(
        'Preview-assisted highlight requests must start from a bounded handle or exact small non-search selection',
      ),
      true,
    );
    assert.equal(calls.loaders[0].systemPrompt.includes('above 250 preview candidates'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('If previews are denied or unavailable'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('Cover suggestions require exactly one bounded exact selection'), true);
    assert.equal(
      calls.loaders[0].systemPrompt.includes('Cover suggestions use album.setCover with exactly one selected assetId'),
      false,
    );
    assert.equal(calls.loaders[0].systemPrompt.includes('Never call mcp_gallery_readAssetOriginals for highlight or cover curation'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('Slice 2 is read-only'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('Except for best/highlight requests during Slice 2'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('Technical metadata: search ids first'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('searchAssets returns selection handles'), true);
    assert.equal(
      calls.loaders[0].systemPrompt.includes(
        'For recent trip album requests, call mcp_gallery_findTripCandidates before asking for dates',
      ),
      true,
    );
    assert.equal(calls.loaders[0].systemPrompt.includes('Follow findTripCandidates.recommendation.action'), true);
    assert.equal(
      calls.loaders[0].systemPrompt.includes(
        'Generic trip albums pass candidate selectionHandle.id directly to mcp_gallery_proposeAlbumFromSelection',
      ),
      true,
    );
    assert.equal(calls.loaders[0].systemPrompt.includes('explicit top/best/highlights default to 10'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('use mcp_gallery_searchAssets with location and taken-date metadata'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('use readAssetMetadata only for specific non-search asset details'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('do not call mcp_gallery_readAssetPreviews or mcp_gallery_readAssetOriginals'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('If a metadata-only trip search returns more than 250 candidate assets'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('ask one concise follow-up question to narrow the date range or location'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('A chat-only answer is not enough for album creation requests'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('factual questions about albums, photo counts'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('use Gallery MCP read tools before answering'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('status "approval-required"'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('stop the turn without explaining the approval request'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('album.create'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('call mcp_gallery_proposeAlbumOperations'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('call proposeAlbumOperations'), false);
    assert.equal(calls.loaders[0].systemPrompt.includes('reviewable album operation plan'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('exampleArguments'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('Do not redirect the user to Apple Photos'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('no direct write tools'), true);
    assert.equal(calls.loaders[0].systemPrompt.includes('has no Gallery read tools'), false);
    assert.deepEqual(calls.loaders[0].appendSystemPrompt, []);
    assert.deepEqual(calls.loaders[0].settingsManager, {
      kind: 'settings-manager',
      settings: { compaction: { enabled: true } },
    });
    assert.equal(calls.loaders[0].systemPromptOverride, undefined);
    assert.equal(calls.loaders[0].appendSystemPromptOverride, undefined);
  });

  it('passes recoverable Gallery MCP retry guidance to the Pi system prompt', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    assert.match(calls.loaders[0].systemPrompt, /retry with corrected arguments/i);
    assert.match(calls.loaders[0].systemPrompt, /with exact <selectionHandle\.id from searchAssets>/i);
    assert.match(calls.loaders[0].systemPrompt, /not an internal Gallery issue/i);
    assert.match(calls.loaders[0].systemPrompt, /approval-required.*pauses?/i);
    assert.doesNotMatch(calls.loaders[0].systemPrompt, /denied .*recoverable/i);
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
    assert.deepEqual(calls.registeredProvider.config.models.map((model) => model.id), ['llama-local']);
    assert.equal(calls.createAgentSession[0].model.provider, 'gallery-00000000-0000-4000-8000-000000000100');
    assert.equal(calls.createAgentSession[0].model.id, 'llama-local');
    assert.equal(calls.createAgentSession[0].model.source, 'registered-provider');
  });

  it('redacts provider secrets from Pi session creation failures', async () => {
    const { sdk, ai } = createFakeDependencies();
    sdk.createAgentSession = async () => {
      throw new Error('create failed with sk-openai-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });

    await assert.rejects(
      () => runtime.createSession(createSessionBody()),
      (error) => {
        assert.equal(error.message, 'create failed with [redacted]');
        assert.equal(error.message.includes('sk-openai-secret'), false);
        return true;
      },
    );
  });

  it('redacts provider secrets from provider registration setup failures', async () => {
    const { sdk, ai } = createFakeDependencies();
    sdk.ModelRegistry.inMemory = () => ({
      find: () => undefined,
      registerProvider: () => {
        throw new Error('registration rejected local-secret');
      },
    });
    const runtime = createPiRuntime({ sdk, ai });

    await assert.rejects(
      () =>
        runtime.createSession(
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
        ),
      (error) => {
        assert.equal(error.message, 'Extension "<inline:1>" error: registration rejected [redacted]');
        assert.equal(error.message.includes('local-secret'), false);
        return true;
      },
    );
  });

  it('does not resolve OpenAI-compatible models from file-backed external model config', async () => {
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

    assert.notEqual(calls.createAgentSession[0].model.source, 'file-backed');
  });

  it('disposes the previous Pi SDK session when recreating the deterministic runner session', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    await runtime.createSession(createSessionBody());
    await runtime.createSession(createSessionBody({ model: 'gpt-4.1' }));

    assert.equal(calls.disposed, 1);
  });

  it('redacts old and new provider and MCP secrets when duplicate session disposal fails', async () => {
    const { sdk, ai } = createFakeDependencies();
    let createdSessions = 0;
    sdk.createAgentSession = async () => {
      createdSessions += 1;
      const sessionNumber = createdSessions;
      return {
        session: {
          messages: [],
          subscribe: () => () => {},
          async prompt() {},
          async bindExtensions() {},
          getActiveToolNames: () => ['mcp_gallery_searchAssets'],
          dispose() {
            if (sessionNumber === 1 && createdSessions === 2) {
              throw new Error('dispose failed with old-secret, new-secret, old-mcp-token, and new-mcp-token');
            }
          },
        },
      };
    };
    const runtime = createPiRuntime({ sdk, ai });

    await runtime.createSession(
      createSessionBody({
        credential: { ...createSessionBody().credential, secret: 'old-secret' },
        mcpGateway: createMcpGateway({ token: 'old-mcp-token' }),
      }),
    );

    await assert.rejects(
      () =>
        runtime.createSession(
          createSessionBody({
            credential: { ...createSessionBody().credential, secret: 'new-secret' },
            mcpGateway: createMcpGateway({ token: 'new-mcp-token' }),
          }),
        ),
      (error) => {
        assert.equal(error.message, 'dispose failed with [redacted], [redacted], [redacted], and [redacted]');
        assert.equal(error.message.includes('old-secret'), false);
        assert.equal(error.message.includes('new-secret'), false);
        assert.equal(error.message.includes('old-mcp-token'), false);
        assert.equal(error.message.includes('new-mcp-token'), false);
        return true;
      },
    );
  });

  it('disposes the newly-created Pi SDK session when duplicate session replacement fails', async () => {
    const { sdk, ai } = createFakeDependencies();
    const sessions = [];
    sdk.createAgentSession = async () => {
      const session = {
        messages: [],
        disposed: 0,
        subscribe: () => () => {},
        async prompt() {},
        dispose() {
          this.disposed += 1;
          if (sessions.length === 2 && this === sessions[0]) {
            throw new Error('old dispose failed with old-secret');
          }
        },
      };
      sessions.push(session);
      return { session };
    };
    const runtime = createPiRuntime({ sdk, ai });

    await runtime.createSession(
      createSessionBody({
        credential: { ...createSessionBody().credential, secret: 'old-secret' },
      }),
    );

    await assert.rejects(
      () =>
        runtime.createSession(
          createSessionBody({
            credential: { ...createSessionBody().credential, secret: 'new-secret' },
          }),
        ),
      /old dispose failed/,
    );

    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].disposed, 1);
    assert.equal(sessions[1].disposed, 1);
  });

  it('does not leak Pi SDK sessions when deterministic session creation overlaps', async () => {
    const { sdk, ai } = createFakeDependencies();
    const sessions = [];
    const creationGates = [createDeferred(), createDeferred()];
    sdk.createAgentSession = async () => {
      const sessionIndex = sessions.length;
      const session = {
        messages: [],
        disposed: 0,
        subscribe: () => () => {},
        async prompt() {},
        dispose() {
          this.disposed += 1;
        },
      };
      sessions.push(session);
      await creationGates[sessionIndex].promise;
      return { session };
    };
    const runtime = createPiRuntime({ sdk, ai });

    const first = runtime.createSession(createSessionBody());
    const second = runtime.createSession(createSessionBody());
    await waitForCondition(() => sessions.length >= 1);
    const overlapped = await waitForCondition(() => sessions.length >= 2, 25)
      .then(() => true)
      .catch(() => false);
    if (overlapped) {
      creationGates[0].resolve();
      creationGates[1].resolve();
    } else {
      creationGates[0].resolve();
      await waitForCondition(() => sessions.length >= 2);
      creationGates[1].resolve();
    }
    await Promise.all([first, second]);
    await runtime.disposeSession('pi-00000000-0000-4000-8000-000000000100');

    assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map((session) => session.disposed), [1, 1]);
  });

  it('streams Pi text deltas and completion content as Gallery runner events', async () => {
    const { sdk, ai } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(
      runtime.sendMessage(createMessageRequest()),
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

  it('routes strict recent-trip album prompts through MCP before provider orchestration', async () => {
    const { sdk, ai, calls, session } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch();
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const events = await collect(
      runtime.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
        }),
      ),
    );

    assert.equal(calls.prompts.length, 0);
    assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.deepEqual(mcpCalls.map((call) => call.body.method), ['tools/call', 'tools/call']);
    assert.equal(mcpCalls[0].headers.Authorization, 'Bearer mcp-token-secret');
    // Strict observability events (Slice 6) ride the same stream as debug/audit
    // `activity` events; they are not part of the user-facing message protocol.
    const protocolEvents = events.filter((event) => event.type !== 'activity');
    assert.equal(protocolEvents.length, 1);
    assert.equal(protocolEvents[0].type, 'assistant-message-completed');
    assert.equal(protocolEvents[0].sessionId, '00000000-0000-4000-8000-000000000100');
    assert.equal(protocolEvents[0].runnerSessionId, 'pi-00000000-0000-4000-8000-000000000100');
    assert.equal(protocolEvents[0].providerMessageId, null);
    assert.match(protocolEvents[0].content.blocks[0].text, /May 3-12, 2026/);
    assert.match(protocolEvents[0].content.blocks[0].text, /28 assets/);
    assert.match(protocolEvents[0].content.blocks[0].text, /skipped 3 known duplicate variants and 1 stack child/i);
    assert.match(protocolEvents[0].content.blocks[0].text, /Review the plan before applying it/);
    // The router decision and planned outcome are observable on the activity channel.
    const observed = events.filter((event) => event.type === 'activity');
    assert.deepEqual(
      observed.map((event) => event.kind),
      ['strict_router_decision', 'strict_workflow_outcome'],
    );
    assert.equal(session.messages.some((message) => message.role === 'user' && message.content[0].text.includes('recent trip to USA')), true);
    assert.equal(session.messages.some((message) => message.role === 'assistant' && message.content[0].text.includes('Review the plan')), true);
  });

  it('leaves unsupported prompts on open provider orchestration', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch();
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const events = await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Organize my photos.' }] } })));

    assert.deepEqual(mcpCalls, []);
    assert.deepEqual(calls.prompts, ['Organize my photos.']);
    assert.equal(events.at(-1).type, 'assistant-message-completed');
  });

  it('routes an LLM-classified paraphrase through the strict workflow (recall)', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    // The regex fast-path misses this paraphrase ("put my Japan trip ... into an
    // album"); the classifier recovers it via structured output.
    ai.classifyIntent = async () => ({
      workflow: 'create_recent_trip_album',
      slots: { placeHint: 'Japan' },
      confidence: 'high',
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
      candidates: [makeStrictTripCandidate({ placeLabels: ['Kyoto, Japan'] })],
      recommendation: {
        action: 'use_top_candidate',
        candidateDedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
        reason: 'The only readable trip candidate is high confidence.',
      },
      expectedAlbumName: 'Japan Trip',
      placeHint: 'Japan',
    });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const events = await collect(
      runtime.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'put my Japan trip from last week into an album' }] },
        }),
      ),
    );

    assert.equal(calls.prompts.length, 0);
    assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /Review the plan before applying it/);
  });

  it('falls through to the provider when STRICT_ROUTER_MODE=regex disables the LLM path', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    // Even with a high-confidence classifier result available, regex mode never
    // calls it, so the paraphrase falls through to open orchestration.
    ai.classifyIntent = async () => ({
      workflow: 'create_recent_trip_album',
      slots: { placeHint: 'Japan' },
      confidence: 'high',
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({ placeHint: 'Japan' });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation, routerMode: 'regex' });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const events = await collect(
      runtime.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'put my Japan trip from last week into an album' }] },
        }),
      ),
    );

    assert.deepEqual(mcpCalls, []);
    assert.deepEqual(calls.prompts, ['put my Japan trip from last week into an album']);
    assert.equal(events.at(-1).type, 'assistant-message-completed');
  });

  it('falls through to the provider when classifier slots fail parseSlots', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    // A known workflow but slots that normalize away to nothing (no usable name
    // or place hint) → parseSlots returns null → fall through, no plan.
    ai.classifyIntent = async () => ({
      workflow: 'create_recent_trip_album',
      slots: { placeHint: 'somewhere nice' },
      confidence: 'high',
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch();
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const events = await collect(
      runtime.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'put my recent vacation somewhere nice into an album set' }] },
        }),
      ),
    );

    assert.deepEqual(mcpCalls, []);
    assert.equal(calls.prompts.length, 1);
    assert.equal(events.at(-1).type, 'assistant-message-completed');
  });

  it('keeps a strict handled Pi runner session usable for a later open prompt', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { fetchImplementation } = createStrictWorkflowFetch();
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const strictEvents = await collect(
      runtime.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
        }),
      ),
    );
    const openEvents = await collect(
      runtime.sendMessage(
        createMessageRequest({
          messageId: '00000000-0000-4000-8000-000000000201',
          content: { blocks: [{ type: 'text', text: 'How many albums do I have?' }] },
        }),
      ),
    );

    assert.equal(strictEvents.at(-1).type, 'assistant-message-completed');
    assert.deepEqual(calls.prompts, ['How many albums do I have?']);
    assert.equal(openEvents.at(-1).type, 'assistant-message-completed');
  });

  it('pauses production strict recent-trip planning when the proposal needs approval', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
      planResponse: {
        status: 'approval-required',
        toolCall: { id: '00000000-0000-4000-8000-000000000999' },
      },
    });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const events = await collect(
      runtime.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
        }),
      ),
    );

    assert.equal(calls.prompts.length, 0);
    assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    // Strict observability rides the activity channel; the protocol events keep
    // their order (durable workflow-state-update then tool-approval-needed).
    const protocolEvents = events.filter((event) => event.type !== 'activity');
    assert.deepEqual(
      protocolEvents.map((event) => event.type),
      ['workflow-state-update', 'tool-approval-needed'],
    );
    const stateEvent = protocolEvents.find((event) => event.type === 'workflow-state-update');
    assert.equal(stateEvent.workflowState.kind, 'approval');
    assert.doesNotMatch(JSON.stringify(stateEvent.workflowState), /sourceRef|assetIds/);
    assert.deepEqual(protocolEvents.at(-1), {
      type: 'tool-approval-needed',
      sessionId: '00000000-0000-4000-8000-000000000100',
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000999',
    });
    // The approval_required outcome is observable (with no planId yet).
    assert.ok(
      events.some((event) => event.type === 'activity' && event.kind === 'strict_workflow_outcome'),
    );
  });

  it('resumes a production strict recent-trip album after candidate selection without provider prompting', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const candidates = [
      makeStrictTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
      makeStrictTripCandidate({
        dedupeKey: 'trip:ca',
        placeLabels: ['California, USA'],
        selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
      }),
    ];
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
      candidates,
      recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
      expectedSelectionHandleId: '00000000-0000-4000-8000-000000000930',
    });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } })));
    const events = await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Use California' }] } })));

    assert.equal(calls.prompts.length, 0);
    assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /Review the plan before applying it/);
  });

  it('does not plan from a blank pending production strict candidate follow-up', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
      recommendation: { action: 'ask_user', reason: 'Confirm the only possible recent trip.' },
    });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } })));
    const events = await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: '???' }] } })));

    assert.equal(calls.prompts.length, 0);
    assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
    assert.match(events.at(-1).content.blocks[0].text, /Which recent trip should I use/i);
  });

  it('renames a pending production strict recent-trip album from the follow-up', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
      candidates: [
        makeStrictTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
        makeStrictTripCandidate({
          dedupeKey: 'trip:ca',
          placeLabels: ['California, USA'],
          selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
        }),
      ],
      recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
      expectedAlbumName: 'West Coast',
      expectedSelectionHandleId: '00000000-0000-4000-8000-000000000930',
    });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } })));
    await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Use California called West Coast' }] } })));

    assert.equal(calls.prompts.length, 0);
    assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.equal(mcpCalls[1].body.params.arguments.albumName, 'West Coast');
  });

  it('asks the production user to rerun after pending strict trip choices expire', async () => {
    let nowMs = 1000;
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
      candidates: [
        makeStrictTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
        makeStrictTripCandidate({ dedupeKey: 'trip:ca', placeLabels: ['California, USA'] }),
      ],
      recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
    });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation, now: () => nowMs });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } })));
    nowMs += 10 * 60 * 1000 + 1;
    const events = await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'first one' }] } })));

    assert.equal(calls.prompts.length, 0);
    assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
    assert.match(events.at(-1).content.blocks[0].text, /expired/i);
  });

  it('resumes an approved production strict recent-trip plan without provider prompting', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
      planResponse: {
        status: 'approval-required',
        toolCall: { id: '00000000-0000-4000-8000-000000000999' },
      },
    });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } })));
    const events = await collect(runtime.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000999',
      approvalDecision: 'approved',
      toolResult: { status: 'success', plan: { id: strictTripPlanId } },
    }));

    assert.equal(calls.prompts.length, 0);
    assert.equal(calls.continues, 0);
    assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.match(events.at(-1).content.blocks[0].text, /Review the plan before applying it/);
  });

  it('pauses again when an approved strict recent-trip resume unexpectedly needs approval', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
      planResponse: {
        status: 'approval-required',
        toolCall: { id: '00000000-0000-4000-8000-000000000999' },
      },
    });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } })));
    const events = await collect(runtime.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000999',
      approvalDecision: 'approved',
      toolResult: {
        status: 'approval-required',
        toolCall: { id: '00000000-0000-4000-8000-000000000998' },
      },
    }));
    const deniedEvents = await collect(runtime.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000998',
      approvalDecision: 'denied',
      toolResult: { status: 'denied' },
    }));

    assert.equal(calls.prompts.length, 0);
    assert.equal(calls.continues, 0);
    assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    // The approval resume first clears the rehydrated pending state, then re-persists the new approval blob.
    // Strict observability `activity` events ride the same stream and are filtered out of the protocol assertion.
    const protocolEvents = events.filter((event) => event.type !== 'activity');
    assert.deepEqual(
      protocolEvents.map((event) => event.type),
      ['workflow-state-update', 'workflow-state-update', 'tool-approval-needed'],
    );
    assert.equal(protocolEvents[0].workflowState, null);
    assert.equal(protocolEvents[1].workflowState.kind, 'approval');
    assert.deepEqual(protocolEvents.at(-1), {
      type: 'tool-approval-needed',
      sessionId: '00000000-0000-4000-8000-000000000100',
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000998',
    });
    assert.match(deniedEvents.at(-1).content.blocks[0].text, /approval was denied/i);
  });

  it('resumes a denied production strict recent-trip plan without provider prompting', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { fetchImplementation } = createStrictWorkflowFetch({
      planResponse: {
        status: 'approval-required',
        toolCall: { id: '00000000-0000-4000-8000-000000000999' },
      },
    });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    await collect(runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } })));
    const events = await collect(runtime.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000999',
      approvalDecision: 'denied',
      toolResult: { status: 'denied' },
    }));

    assert.equal(calls.prompts.length, 0);
    assert.equal(calls.continues, 0);
    assert.match(events.at(-1).content.blocks[0].text, /approval was denied/i);
  });

  it('emits a scrubbed workflow-state-update event when a strict trip turn pauses for selection', async () => {
    const { sdk, ai } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { fetchImplementation } = createStrictWorkflowFetch({
      recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
      candidates: [
        makeStrictTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
        makeStrictTripCandidate({
          dedupeKey: 'trip:ca',
          placeLabels: ['California, USA'],
          selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
        }),
      ],
    });

    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
    const turn1 = await collect(
      runtime.sendMessage(
        createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } }),
      ),
    );

    const stateEvent = turn1.find((event) => event.type === 'workflow-state-update');
    assert.ok(stateEvent, 'expected a workflow-state-update event');
    assert.ok(stateEvent.workflowState, 'expected a non-null pending workflow blob');
    assert.equal(stateEvent.sessionId, '00000000-0000-4000-8000-000000000100');
    assert.equal(stateEvent.runnerSessionId, 'pi-00000000-0000-4000-8000-000000000100');
    // The persisted blob is scrubbed: no raw asset ids or source refs.
    assert.doesNotMatch(JSON.stringify(stateEvent.workflowState), /sourceRef|assetIds/);
  });

  it('rehydrates pending workflow state after a simulated runtime restart', async () => {
    const { sdk: sdkA, ai: aiA } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const candidates = [
      makeStrictTripCandidate({ dedupeKey: 'trip:ny', placeLabels: ['New York, USA'] }),
      makeStrictTripCandidate({
        dedupeKey: 'trip:ca',
        placeLabels: ['California, USA'],
        selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
      }),
    ];
    const fetchA = createStrictWorkflowFetch({
      candidates,
      recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
      expectedSelectionHandleId: '00000000-0000-4000-8000-000000000930',
    });

    // Turn 1 on runtime A: ask_user -> emits workflow-state-update with the pending blob.
    const runtimeA = createPiRuntime({ sdk: sdkA, ai: aiA, fetch: fetchA.fetchImplementation });
    await runtimeA.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
    const turn1 = await collect(
      runtimeA.sendMessage(
        createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } }),
      ),
    );
    const stateEvent = turn1.find((event) => event.type === 'workflow-state-update');
    assert.ok(stateEvent.workflowState);
    assert.doesNotMatch(JSON.stringify(stateEvent.workflowState), /sourceRef|assetIds/);

    // Turn 2 on a fresh runtime B (cold Map), seeded with the persisted state from the request.
    const { sdk: sdkB, ai: aiB } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const fetchB = createStrictWorkflowFetch({
      candidates,
      recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
      expectedSelectionHandleId: '00000000-0000-4000-8000-000000000930',
    });
    const runtimeB = createPiRuntime({ sdk: sdkB, ai: aiB, fetch: fetchB.fetchImplementation });
    await runtimeB.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
    const turn2 = await collect(
      runtimeB.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'Use California' }] },
          workflowState: stateEvent.workflowState,
        }),
      ),
    );

    assert.equal(turn2.at(-1).type, 'assistant-message-completed');
    assert.match(turn2.at(-1).content.blocks[0].text, /Review the plan before applying it/);
  });

  it('rehydrates approval-pending state so resume works on a cold runtime', async () => {
    const { sdk: sdkA, ai: aiA } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const approvalFetch = createStrictWorkflowFetch({
      planResponse: { status: 'approval-required', toolCall: { id: '00000000-0000-4000-8000-000000000999' } },
    });

    // Turn 1 on runtime A: approval-required -> emits tool-approval-needed + workflow-state-update (approval blob).
    const runtimeA = createPiRuntime({ sdk: sdkA, ai: aiA, fetch: approvalFetch.fetchImplementation });
    await runtimeA.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
    const turn1 = await collect(
      runtimeA.sendMessage(
        createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } }),
      ),
    );
    assert.ok(turn1.some((event) => event.type === 'tool-approval-needed'));
    const stateEvent = turn1.find((event) => event.type === 'workflow-state-update');
    assert.equal(stateEvent.workflowState.kind, 'approval');
    assert.doesNotMatch(JSON.stringify(stateEvent.workflowState), /sourceRef|assetIds/);

    // Approval resumes on a fresh runtime B, seeded only from the persisted blob (the approved plan result is supplied).
    const { sdk: sdkB, ai: aiB } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const resumeFetch = createStrictWorkflowFetch();
    const runtimeB = createPiRuntime({ sdk: sdkB, ai: aiB, fetch: resumeFetch.fetchImplementation });
    await runtimeB.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
    const resumed = await collect(
      runtimeB.resumeSession({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        toolCallId: '00000000-0000-4000-8000-000000000999',
        approvalDecision: 'approved',
        toolResult: { status: 'success', plan: { id: strictTripPlanId } },
        workflowState: stateEvent.workflowState,
      }),
    );

    assert.equal(resumed.at(-1).type, 'assistant-message-completed');
    assert.match(resumed.at(-1).content.blocks[0].text, /Review the plan before applying it/);
  });

  it('fails deterministically when a rehydrated approval resumes against a stale selection handle', async () => {
    const { sdk: sdkA, ai: aiA } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const approvalFetch = createStrictWorkflowFetch({
      planResponse: { status: 'approval-required', toolCall: { id: '00000000-0000-4000-8000-000000000999' } },
    });

    const runtimeA = createPiRuntime({ sdk: sdkA, ai: aiA, fetch: approvalFetch.fetchImplementation });
    await runtimeA.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
    const turn1 = await collect(
      runtimeA.sendMessage(
        createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] } }),
      ),
    );
    const stateEvent = turn1.find((event) => event.type === 'workflow-state-update');
    assert.equal(stateEvent.workflowState.kind, 'approval');

    // Cold runtime B: the approved plan was NOT supplied, so resume re-validates the selection
    // handle through proposeAlbumFromSelection, which now reports the handle is stale/invalid.
    const { sdk: sdkB, ai: aiB } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const staleFetchCalls = [];
    const staleFetch = async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      staleFetchCalls.push(body?.params?.name);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            structuredContent: {
              status: 'error',
              summary: 'The referenced selection handle has expired and can no longer be used.',
            },
          },
        }),
      );
    };
    const runtimeB = createPiRuntime({ sdk: sdkB, ai: aiB, fetch: staleFetch });
    await runtimeB.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
    const resumed = await collect(
      runtimeB.resumeSession({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        toolCallId: '00000000-0000-4000-8000-000000000999',
        approvalDecision: 'approved',
        workflowState: stateEvent.workflowState,
      }),
    );

    assert.equal(staleFetchCalls.join(','), 'proposeAlbumFromSelection');
    assert.equal(resumed.at(-1).type, 'assistant-message-completed');
    // Deterministic failure copy, not a false success.
    assert.doesNotMatch(resumed.at(-1).content.blocks[0].text, /Review the plan before applying it/);
    assert.match(resumed.at(-1).content.blocks[0].text, /could not|expired|stale|no longer|error/i);
  });

  it('aborts an active strict MCP call on dispose and allows a new session', async () => {
    const { sdk, ai, calls } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    let firstCall = true;
    let abortedSignal;
    const abortSeen = createDeferred();
    const fetchImplementation = async (_url, init) => {
      if (firstCall) {
        firstCall = false;
        abortedSignal = init.signal;
        init.signal.addEventListener('abort', () => abortSeen.resolve(init.signal.aborted), { once: true });
        await Promise.race([abortSeen.promise, rejectAfter(250, 'strict MCP call was not aborted')]);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: {} } }));
      }

      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            structuredContent: {
              status: 'success',
              recommendation: { action: 'none' },
              candidates: [],
            },
          },
        }),
      );
    };
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const streamPromise = collect(
      runtime.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
        }),
      ),
    );
    await waitForCondition(() => abortedSignal !== undefined);

    await runtime.disposeSession('pi-00000000-0000-4000-8000-000000000100');
    assert.equal(await withTimeout(abortSeen.promise), true);
    assert.equal(abortedSignal.aborted, true);
    await withTimeout(streamPromise);

    const created = await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
    const events = await collect(
      runtime.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
        }),
      ),
    );

    assert.equal(created.runnerSessionId, 'pi-00000000-0000-4000-8000-000000000100');
    assert.equal(calls.createAgentSession.length, 2);
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /could not find a likely recent trip/i);
  });

  for (const [name, response] of [
    [
      'HTTP non-OK body',
      new Response('Bearer other-secret api_key=raw-key', { status: 503 }),
    ],
    ['invalid JSON response', new Response('not json Bearer other-secret api_key=raw-key')],
    [
      'JSON-RPC error message',
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32001, message: 'Bearer other-secret api_key=raw-key' },
        }),
      ),
    ],
    [
      'MCP isError text',
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { isError: true, content: [{ type: 'text', text: 'Bearer other-secret api_key=raw-key' }] },
        }),
      ),
    ],
  ]) {
    it(`uses generic strict MCP errors for ${name}`, async () => {
      const { sdk, ai } = createFakeDependencies({
        mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
      });
      const runtime = createPiRuntime({ sdk, ai, fetch: async () => response.clone() });
      await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

      const events = await collect(
        runtime.sendMessage(
          createMessageRequest({
            content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
          }),
        ),
      );
      const serialized = JSON.stringify(events);

      assert.equal(serialized.includes('other-secret'), false);
      assert.equal(serialized.includes('raw-key'), false);
      assert.equal(serialized.includes('Bearer [redacted]'), false);
      assert.equal(events.at(-1).type, 'runner-error');
      assert.match(events.at(-1).message, /Gallery MCP/i);
    });

    it(`uses generic user-facing strict planning errors for ${name}`, async () => {
      const { sdk, ai } = createFakeDependencies({
        mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
      });
      let callCount = 0;
      const runtime = createPiRuntime({
        sdk,
        ai,
        fetch: async (_url, init) => {
          callCount += 1;
          if (callCount === 1) {
            const body = JSON.parse(init.body);
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: {
                  structuredContent: {
                    status: 'success',
                    recommendation: {
                      action: 'use_top_candidate',
                      candidateDedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
                    },
                    candidates: [makeStrictTripCandidate()],
                  },
                },
              }),
            );
          }
          return response.clone();
        },
      });
      await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

      const events = await collect(
        runtime.sendMessage(
          createMessageRequest({
            content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
          }),
        ),
      );
      const serialized = JSON.stringify(events);

      assert.equal(serialized.includes('other-secret'), false);
      assert.equal(serialized.includes('raw-key'), false);
      assert.equal(events.at(-1).type, 'assistant-message-completed');
      assert.match(events.at(-1).content.blocks[0].text, /could not create a reviewable album plan/i);
      assert.match(events.at(-1).content.blocks[0].text, /Gallery MCP/i);
    });
  }

  it('uses generic assistant text for structured planning tool failures', async () => {
    const { sdk, ai } = createFakeDependencies({
      mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
    });
    const { fetchImplementation } = createStrictWorkflowFetch({
      planResponse: { status: 'error', message: 'Bearer other-secret api_key=raw-key raw tool detail' },
    });
    const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const events = await collect(
      runtime.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
        }),
      ),
    );
    const text = events.at(-1).content.blocks[0].text;

    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(text, /could not create a reviewable album plan/i);
    assert.match(text, /planning tool returned status "error" for proposeAlbumFromSelection/i);
    assert.doesNotMatch(text, /other-secret|raw-key|raw tool detail/i);
    assert.doesNotMatch(text, /plan is ready|I created|I proposed|Review the plan/i);
  });

  it('streams multiple Pi text chunks in order before completion', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async () => {
      session.emitAssistantDelta('First ');
      session.emitAssistantDelta('second.');
      session.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'First second.' }] });
      session.emitMessageEnd();
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(runtime.sendMessage(createMessageRequest()));

    assert.deepEqual(events, [
      {
        type: 'assistant-message-delta',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        delta: 'First ',
        sequence: 1,
      },
      {
        type: 'assistant-message-delta',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        delta: 'second.',
        sequence: 2,
      },
      {
        type: 'assistant-message-completed',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        providerMessageId: null,
        content: { blocks: [{ type: 'text', text: 'First second.' }] },
      },
    ]);
  });

  it('compacts large prior Gallery tool result messages before the next user prompt', async () => {
    const { sdk, ai, calls, session } = createFakeDependencies();
    const hugeAssets = Array.from({ length: 300 }, (_, index) => ({
      id: `asset-${index}`,
      filename: `IMG-${index}.jpg`,
      exif: 'x'.repeat(300),
    }));
    session.messages.push({
      role: 'tool',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            summary: 'Returned 300 rows including IMG-299.jpg from /photos/private/originals/IMG-299.jpg',
            toolCall: {
              id: '00000000-0000-4000-8000-000000000333',
              toolName: 'mcp_gallery_readAssetMetadata',
              status: 'completed',
            },
            assets: hugeAssets,
            resultSize: {
              returnedItems: 300,
              hasMore: false,
              nextPage: null,
              estimatedBytes: 120000,
              truncated: false,
              omittedFields: [],
            },
          }),
        },
      ],
    });
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    await collect(runtime.sendMessage(createMessageRequest()));

    const compacted = JSON.parse(session.messages[0].content[0].text);
    assert.equal(compacted.status, 'success');
    assert.equal(compacted.compacted, true);
    assert.equal(compacted.toolCall.id, '00000000-0000-4000-8000-000000000333');
    assert.equal(compacted.counts.assets, 300);
    assert.match(compacted.omittedDetailInstruction, /smallest Gallery MCP read tool/);
    assert.equal(session.messages[0].content[0].text.includes('IMG-299.jpg'), false);
    assert.equal(session.messages[0].content[0].text.includes('/photos/private/originals'), false);
    assert.ok(session.messages[0].content[0].text.length < 8000);
    assert.deepEqual(calls.prompts, ['Organize my photos.']);
  });

  it('keeps invalid-handle correction context available before the next Pi prompt', async () => {
    const { sdk, ai, calls, session } = createFakeDependencies();
    const realHandleId = '11111111-1111-4111-8111-111111111111';
    session.messages.push({
      role: 'tool',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'error',
            error: 'Selection handle is expired or not available for this session',
            toolName: 'proposeAlbumOperations',
            retryable: true,
            hint: `Retry proposeAlbumOperations with the exact handle ${realHandleId} if that is the intended search selection.`,
            recovery: {
              kind: 'invalid-selection-handle',
              attemptedSelectionHandleId: '00000000-0000-4000-8000-000000000333',
              looksLikeExamplePlaceholder: true,
              availableSelectionHandles: [
                {
                  id: realHandleId,
                  assetCount: 42,
                  sourceToolCallId: null,
                  createdAt: '2026-05-22T07:00:00.000Z',
                  expiresAt: '2026-05-22T08:00:00.000Z',
                },
              ],
              instruction: 'Retry proposeAlbumOperations with a valid same-session selection handle.',
            },
          }),
        },
      ],
    });
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (text) => {
      const correction = JSON.parse(session.messages[0].content[0].text);
      assert.equal(correction.retryable, true);
      assert.equal(correction.recovery.availableSelectionHandles[0].id, realHandleId);
      assert.match(correction.hint, /Retry proposeAlbumOperations with the exact handle/);
      return originalPrompt(text);
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    await collect(runtime.sendMessage(createMessageRequest()));

    assert.equal(calls.prompts[0], 'Organize my photos.');
  });

  it('preserves pending approval state when compacting a large approval-required tool result', () => {
    const messages = [
      {
        role: 'tool',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'approval-required',
              summary: 'Approval required to read 300 previews',
              toolCall: {
                id: '00000000-0000-4000-8000-000000000333',
                toolName: 'mcp_gallery_readAssetPreviews',
                status: 'pending-approval',
              },
              previews: Array.from({ length: 300 }, (_, index) => ({
                id: `asset-${index}`,
                thumbhash: 'x'.repeat(300),
              })),
            }),
          },
        ],
      },
    ];

    compactGalleryToolTranscript({ messages });

    const compacted = JSON.parse(messages[0].content[0].text);
    assert.equal(compacted.status, 'approval-required');
    assert.equal(compacted.toolCall.id, '00000000-0000-4000-8000-000000000333');
    assert.equal(compacted.toolCall.status, 'pending-approval');
    assert.equal(compacted.compacted, true);
    assert.equal(messages[0].content[0].text.includes('thumbhash'), false);
  });

  it('compacts legacy search results with asset ids even under the normal prompt budget', () => {
    const leakedAssetIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const compacted = compactGalleryToolResultForPrompt({
      status: 'success',
      summary: `Returned ${leakedAssetIds.length} asset ids`,
      toolCall: {
        id: '00000000-0000-4000-8000-000000000333',
        toolName: 'mcp_gallery_searchAssets',
        status: 'completed',
      },
      detail: 'ids',
      assetIds: leakedAssetIds,
      assets: { items: leakedAssetIds.map((id) => ({ id, originalFileName: `${id}.jpg` })) },
      selectionHandle: {
        id: '00000000-0000-4000-8000-000000000444',
        sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000444',
        assetCount: 2,
        sourceToolCallId: '00000000-0000-4000-8000-000000000333',
        expiresAt: '2026-05-27T12:00:00.000Z',
      },
      resultSize: {
        returnedItems: 2,
        hasMore: false,
        nextPage: null,
        estimatedBytes: 1024,
        truncated: false,
        omittedFields: [],
      },
    });

    const text = JSON.stringify(compacted);

    assert.equal(compacted.compacted, true);
    assert.equal(compacted.selectionHandle.id, '00000000-0000-4000-8000-000000000444');
    assert.equal(compacted.counts.assets, 2);
    assert.equal(JSON.parse(text).counts.assets, 2);
    assert.equal(Object.hasOwn(compacted, 'assets'), false);
    assert.equal(text.includes(leakedAssetIds[0]), false);
    assert.equal(text.includes(leakedAssetIds[1]), false);
    assert.equal(text.includes('"assetIds"'), false);
    assert.equal(text.includes('"assetIdsSample"'), false);
  });

  it('redacts nested legacy search asset ids from prior tool transcript compaction', () => {
    const leakedAssetId = '33333333-3333-4333-8333-333333333333';
    const messages = [
      {
        role: 'tool',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              toolCall: {
                id: '00000000-0000-4000-8000-000000000333',
                toolName: 'searchAssets',
                status: 'completed',
              },
              assets: { items: [{ id: leakedAssetId, city: 'Paris' }] },
              selectionHandle: {
                id: '00000000-0000-4000-8000-000000000444',
                sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000444',
                assetCount: 1,
                sourceToolCallId: '00000000-0000-4000-8000-000000000333',
                expiresAt: '2026-05-27T12:00:00.000Z',
              },
            }),
          },
        ],
      },
    ];

    compactGalleryToolTranscript({ messages });

    const compacted = JSON.parse(messages[0].content[0].text);
    assert.equal(compacted.compacted, true);
    assert.equal(compacted.selectionHandle.assetCount, 1);
    assert.equal(compacted.counts.assets, 1);
    assert.equal(Object.hasOwn(compacted, 'assets'), false);
    assert.equal(messages[0].content[0].text.includes(leakedAssetId), false);
  });

  it('resumes approval with a compact handle summary for legacy search results', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const leakedAssetId = '44444444-4444-4444-8444-444444444444';

    await collect(
      runtime.resumeSession({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: {
          status: 'success',
          toolCall: {
            id: '00000000-0000-4000-8000-000000000333',
            toolName: 'searchAssets',
            status: 'completed',
          },
          assetIds: [leakedAssetId],
          selectionHandle: {
            id: '00000000-0000-4000-8000-000000000444',
            sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000444',
            assetCount: 1,
            sourceToolCallId: '00000000-0000-4000-8000-000000000333',
            expiresAt: '2026-05-27T12:00:00.000Z',
          },
        },
      }),
    );

    assert.match(calls.prompts[0], /compact approved tool result summary/i);
    assert.match(calls.prompts[0], /selectionHandle/i);
    assert.equal(calls.prompts[0].includes(leakedAssetId), false);
    assert.equal(calls.prompts[0].includes('assetIdsSample'), false);
  });

  it('pauses without assistant completion when a Gallery tool returns approval-required', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async () => {
      session.messages.push({
        role: 'tool',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'approval-required',
              toolCall: {
                id: '00000000-0000-4000-8000-000000000333',
                status: 'pending-approval',
              },
            }),
          },
        ],
      });
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(runtime.sendMessage(createMessageRequest()));

    assert.deepEqual(events, [
      {
        type: 'tool-approval-needed',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        toolCallId: '00000000-0000-4000-8000-000000000333',
      },
    ]);
    assert.equal(session.messages.filter((message) => message.role === 'assistant').length, 0);
  });

  it('resumes from a denied approval with safe denial context', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(
      runtime.resumeSession({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'denied',
      }),
    );

    assert.equal(calls.continues, 0);
    assert.equal(calls.prompts.length, 1);
    assert.match(calls.prompts[0], /denied Gallery tool call 00000000-0000-4000-8000-000000000333/);
    assert.equal(calls.prompts[0].includes('sk-openai-secret'), false);
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

  it('does not treat an older approval-required tool result as a new pause after approval resume', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.messages.push({
      role: 'tool',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'approval-required',
            toolCall: {
              id: '00000000-0000-4000-8000-000000000333',
              status: 'pending-approval',
            },
          }),
        },
      ],
    });
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(
      runtime.resumeSession({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: { status: 'success', assets: [] },
      }),
    );

    assert.equal(events.some((event) => event.type === 'tool-approval-needed'), false);
    assert.equal(events.at(-1)?.type, 'assistant-message-completed');
  });

  it('stops an open provider turn that exceeds the Gallery tool-call budget', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async function (text) {
      this.messages.push({ role: 'user', content: [{ type: 'text', text }] });
      for (let index = 0; index < 13; index += 1) {
        this.messages.push({
          role: 'tool',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                summary: `Search page ${index + 1}`,
                toolCall: {
                  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
                  toolName: 'mcp_gallery_searchAssets',
                  status: 'completed',
                },
                selectionHandle: { id: `handle-${index + 1}`, assetCount: 1000 },
                resultSize: { returnedItems: 1000, hasMore: index < 12, nextPage: String(index + 2) },
              }),
            },
          ],
        });
      }
      this.messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: 'Let me try a different approach.' }],
        usage: { totalTokens: 0 },
        stopReason: 'stop',
      });
    };
    const runtime = createPiRuntime({ sdk, ai, routerMode: 'regex' });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const events = await collect(
      runtime.sendMessage(
        createMessageRequest({
          content: { blocks: [{ type: 'text', text: 'inspect my whole library and keep trying formats' }] },
        }),
      ),
    );

    assert.deepEqual(events.filter((event) => event.type !== 'activity'), [
      {
        type: 'assistant-message-completed',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        providerMessageId: null,
        content: {
          blocks: [
            {
              type: 'text',
              text:
                'I stopped because this request used too many Gallery tool calls without reaching a safe plan. Narrow the scope, for example to the last 100 uploads, a date range, an album, or a tag, then try again.',
            },
          ],
        },
      },
    ]);
  });

  it('resumes approval with a compact approved result summary instead of replaying a large raw result', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const largeResult = {
      status: 'success',
      summary: 'Created plan for 500 photos including IMG-499.jpg from /photos/private/originals/IMG-499.jpg',
      toolCall: {
        id: '00000000-0000-4000-8000-000000000333',
        toolName: 'mcp_gallery_proposeAlbumOperations',
        status: 'completed',
      },
      plan: {
        id: '00000000-0000-4000-8000-000000000444',
        operations: Array.from({ length: 500 }, (_, index) => ({
          id: `operation-${index}`,
          assetId: `asset-${index}`,
          filename: `IMG-${index}.jpg`,
          rationale: 'x'.repeat(300),
        })),
      },
      resultSize: {
        returnedItems: 500,
        hasMore: false,
        nextPage: null,
        estimatedBytes: 220000,
        truncated: false,
        omittedFields: [],
      },
    };

    const events = await collect(
      runtime.resumeSession({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: largeResult,
      }),
    );

    assert.equal(calls.continues, 0);
    assert.equal(calls.prompts.length, 1);
    assert.match(calls.prompts[0], /compact approved tool result summary/i);
    assert.match(calls.prompts[0], /00000000-0000-4000-8000-000000000444/);
    assert.match(calls.prompts[0], /operation-0/);
    assert.match(calls.prompts[0], /"operationIds":500/);
    assert.match(calls.prompts[0], /smallest Gallery MCP read tool/);
    assert.equal(calls.prompts[0].includes('IMG-499.jpg'), false);
    assert.equal(calls.prompts[0].includes('/photos/private/originals'), false);
    assert.ok(calls.prompts[0].length < 10000);
    assert.equal(events[0].type, 'assistant-message-delta');
    assert.equal(events.at(-1).type, 'assistant-message-completed');
  });

  it('summarizes non-serializable approved results instead of failing approval resume', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const circularResult = { status: 'success', summary: 'Circular result' };
    circularResult.self = circularResult;

    await collect(
      runtime.resumeSession({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: circularResult,
      }),
    );

    assert.equal(calls.prompts.length, 1);
    assert.match(calls.prompts[0], /compact approved tool result summary/i);
    assert.equal(calls.prompts[0].includes('[Circular]'), false);
  });

  it('throws a sanitized not-found error when resuming an unknown runner session', async () => {
    const { sdk, ai } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    await assert.rejects(
      () =>
        collect(
          runtime.resumeSession({
            runnerSessionId: 'missing',
            gallerySessionId: '00000000-0000-4000-8000-000000000100',
            toolCallId: '00000000-0000-4000-8000-000000000333',
            approvalDecision: 'approved',
          }),
        ),
      /Runner session not found/,
    );
  });

  it('surfaces context-window provider errors as actionable runner errors', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async () => {
      session.messages.push({
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage:
          'Your input exceeds the context window of this model. Please adjust your input and try again. sk-openai-secret',
      });
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(runtime.sendMessage(createMessageRequest()));

    assert.deepEqual(events, [
      {
        type: 'runner-error',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        message:
          'The assistant hit the model context limit while processing Gallery data. Narrow the request or inspect fewer photos at a time.',
      },
    ]);
  });

  it('keeps runner restart errors actionable while preserving the existing not-found phrase', async () => {
    const { sdk, ai } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });

    await assert.rejects(
      () =>
        collect(
          runtime.resumeSession({
            runnerSessionId: 'missing',
            gallerySessionId: '00000000-0000-4000-8000-000000000100',
            toolCallId: '00000000-0000-4000-8000-000000000333',
            approvalDecision: 'approved',
          }),
        ),
      /Runner session not found; start a new assistant chat to reconnect/,
    );
  });

  it('surfaces provider compaction refusal as an actionable runner error', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async () => {
      session.messages.push({
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Provider refused the compaction request after summarization failed.',
      });
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(runtime.sendMessage(createMessageRequest()));

    assert.equal(
      events[0].message,
      'The assistant hit the model context limit while processing Gallery data. Narrow the request or inspect fewer photos at a time.',
    );
  });

  it('wakes an active approval resume stream with a runner-error when disposed while waiting on Pi', async () => {
    const promptGate = createDeferred();
    const { sdk, ai, calls } = createFakeDependencies({ promptGate });
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const stream = runtime.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'denied',
    })[Symbol.asyncIterator]();

    assert.equal((await stream.next()).value.type, 'assistant-message-delta');

    await runtime.disposeSession('pi-00000000-0000-4000-8000-000000000100');

    const next = await withTimeout(stream.next());
    assert.deepEqual(next, {
      done: false,
      value: {
        type: 'runner-error',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        message: 'Runner session disposed',
      },
    });
    await waitForCondition(() => calls.sessionAborted === 1);
    assert.equal((await withTimeout(stream.next())).done, true);
    assert.equal(calls.unsubscribed, 1);
    assert.equal(calls.disposed, 1);

    promptGate.resolve();
  });

  it('resumes the Pi agent after tool approval and streams the continued response', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(
      runtime.resumeSession({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
      }),
    );

    assert.equal(calls.continues, 1);
    assert.deepEqual(events, [
      {
        type: 'assistant-message-delta',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        delta: 'Approved. Continuing.',
        sequence: 1,
      },
      {
        type: 'assistant-message-completed',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        providerMessageId: null,
        content: { blocks: [{ type: 'text', text: 'Approved. Continuing.' }] },
      },
    ]);
  });

  it('prompts the Pi agent with approval context instead of continuing an assistant-ended turn', async () => {
    const { sdk, ai, calls, session } = createFakeDependencies();
    session.agent.continue = async () => {
      calls.continues += 1;
      throw new Error('Cannot continue from message role: assistant');
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(
      runtime.resumeSession({
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: { status: 'success', albums: [{ id: 'album-1', albumName: 'Test Pierre' }] },
      }),
    );

    assert.equal(calls.continues, 0);
    assert.equal(calls.prompts.length, 1);
    assert.match(calls.prompts[0], /approved/i);
    assert.match(calls.prompts[0], /00000000-0000-4000-8000-000000000333/);
    assert.match(calls.prompts[0], /Test Pierre/);
    assert.match(calls.prompts[0], /previous approval-required/i);
    assert.match(calls.prompts[0], /obsolete/i);
    assert.match(calls.prompts[0], /Do not mention pending approval/i);
    assert.match(calls.prompts[0], /mcp_gallery_readAlbum/);
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

  it('uses Pi session completed assistant text when SDK message internals differ', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async () => {};
    session.messages = [];
    session.getLastAssistantText = () => 'I can help from the Pi SDK.';
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(runtime.sendMessage(createMessageRequest()));

    assert.deepEqual(events, [
      {
        type: 'assistant-message-completed',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        providerMessageId: null,
        content: { blocks: [{ type: 'text', text: 'I can help from the Pi SDK.' }] },
      },
    ]);
  });

  it('returns a runner-error when Pi completes with an assistant error message', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async () => {
      session.messages.push({
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'provider rejected tool schema',
      });
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(runtime.sendMessage(createMessageRequest()));

    assert.deepEqual(events, [
      {
        type: 'runner-error',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        message: 'provider rejected tool schema',
      },
    ]);
    assert.doesNotMatch(events[0].message, /retry with corrected arguments/i);
  });

  it('redacts provider and MCP secrets from assistant error messages', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async () => {
      session.messages.push({
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'provider rejected sk-openai-secret and mcp-token-secret',
      });
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const events = await collect(runtime.sendMessage(createMessageRequest()));

    assert.deepEqual(events, [
      {
        type: 'runner-error',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        message: 'provider rejected [redacted] and [redacted]',
      },
    ]);
  });

  it('unsubscribes from Pi runtime events after a message stream completes', async () => {
    const { sdk, ai, calls } = createFakeDependencies();
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    await collect(
      runtime.sendMessage(createMessageRequest()),
    );

    assert.equal(calls.unsubscribed, 1);
  });

  it('clears in-flight and redacts the secret when Pi subscription setup fails', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    const originalSubscribe = session.subscribe.bind(session);
    let subscribeAttempts = 0;
    session.subscribe = (next) => {
      subscribeAttempts += 1;
      if (subscribeAttempts === 1) {
        throw new Error('subscribe failed for sk-openai-secret');
      }

      return originalSubscribe(next);
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    await assert.rejects(
      () => collect(runtime.sendMessage(createMessageRequest())),
      (error) => {
        assert.equal(error.message, 'subscribe failed for [redacted]');
        assert.equal(error.message.includes('sk-openai-secret'), false);
        return true;
      },
    );

    const events = await collect(runtime.sendMessage(createMessageRequest()));

    assert.equal(subscribeAttempts, 2);
    assert.equal(events[0].type, 'assistant-message-delta');
  });

  it('redacts provider and MCP secrets when Pi subscription setup fails', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.subscribe = () => {
      throw new Error('subscribe failed for sk-openai-secret and mcp-token-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    await assert.rejects(
      () => collect(runtime.sendMessage(createMessageRequest())),
      (error) => {
        assert.equal(error.message, 'subscribe failed for [redacted] and [redacted]');
        assert.equal(error.message.includes('sk-openai-secret'), false);
        assert.equal(error.message.includes('mcp-token-secret'), false);
        return true;
      },
    );
  });

  it('rejects overlapping message streams for the same runner session before subscribing or prompting again', async () => {
    const promptGate = createDeferred();
    const { sdk, ai, calls } = createFakeDependencies({ promptGate });
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const first = runtime.sendMessage(createMessageRequest())[Symbol.asyncIterator]();
    const second = runtime.sendMessage(
      createMessageRequest({ messageId: '00000000-0000-4000-8000-000000000201' }),
    )[Symbol.asyncIterator]();

    try {
      assert.equal((await first.next()).value.type, 'assistant-message-delta');

      await assert.rejects(() => second.next(), /already has an active message stream/);
      assert.equal(calls.subscribed, 1);
      assert.deepEqual(calls.prompts, ['Organize my photos.']);
    } finally {
      await second.return?.();
      promptGate.resolve();
      await first.return?.();
    }
  });

  it('unsubscribes the active listener and disposes the Pi SDK session when disposed mid-stream', async () => {
    const promptGate = createDeferred();
    const { sdk, ai, calls } = createFakeDependencies({ promptGate });
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const stream = runtime.sendMessage(createMessageRequest())[Symbol.asyncIterator]();

    try {
      assert.equal((await stream.next()).value.type, 'assistant-message-delta');

      await runtime.disposeSession('pi-00000000-0000-4000-8000-000000000100');

      assert.equal(calls.sessionAborted, 1);
      assert.equal(calls.agentAborted, 0);
      assert.equal(calls.unsubscribed, 1);
      assert.equal(calls.disposed, 1);
    } finally {
      await stream.return?.();
      promptGate.resolve();
    }

    assert.equal(calls.unsubscribed, 1);
  });

  it('wakes an active message stream with a runner-error when disposed while waiting on Pi', async () => {
    const promptGate = createDeferred();
    const { sdk, ai, calls } = createFakeDependencies({ promptGate });
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const stream = runtime.sendMessage(createMessageRequest())[Symbol.asyncIterator]();

    assert.equal((await stream.next()).value.type, 'assistant-message-delta');

    await runtime.disposeSession('pi-00000000-0000-4000-8000-000000000100');

    const next = await withTimeout(stream.next());
    assert.deepEqual(next, {
      done: false,
      value: {
        type: 'runner-error',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        message: 'Runner session disposed',
      },
    });
    await waitForCondition(() => calls.sessionAborted === 1);
    assert.equal(calls.sessionAborted, 1);
    assert.equal(calls.agentAborted, 0);
    assert.equal((await withTimeout(stream.next())).done, true);
    assert.equal(calls.unsubscribed, 1);
    assert.equal(calls.disposed, 1);

    promptGate.resolve();
  });

  it('aborts the active Pi prompt and keeps overlap rejection until early stream return settles', async () => {
    const promptGate = createDeferred();
    const sessionAbortGate = createDeferred();
    const { sdk, ai, calls } = createFakeDependencies({ promptGate, sessionAbortGate });
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const first = runtime.sendMessage(createMessageRequest())[Symbol.asyncIterator]();

    assert.equal((await first.next()).value.type, 'assistant-message-delta');

    const returnPromise = first.return();
    await Promise.resolve();
    const second = runtime.sendMessage(
      createMessageRequest({ messageId: '00000000-0000-4000-8000-000000000201' }),
    )[Symbol.asyncIterator]();

    await waitForCondition(() => calls.sessionAborted === 1);
    assert.equal(calls.sessionAborted, 1);
    assert.equal(calls.agentAborted, 0);
    await assert.rejects(() => second.next(), /already has an active message stream/);

    sessionAbortGate.resolve();
    promptGate.resolve();
    assert.equal((await withTimeout(returnPromise)).done, true);
    await second.return?.();

    assert.equal(calls.unsubscribed, 1);
  });

  it('waits for SDK abort before early stream return clears the in-flight guard', async () => {
    const promptGate = createDeferred();
    const sessionAbortGate = createDeferred();
    const { sdk, ai, calls } = createFakeDependencies({ promptGate, sessionAbortGate });
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const first = runtime.sendMessage(createMessageRequest())[Symbol.asyncIterator]();

    assert.equal((await first.next()).value.type, 'assistant-message-delta');

    const returnPromise = first.return();
    await Promise.resolve();

    await waitForCondition(() => calls.sessionAborted === 1);
    assert.equal(calls.sessionAborted, 1);
    assert.equal(calls.agentAborted, 0);
    await assert.rejects(() => withTimeout(returnPromise, 25), /timed out/);

    const second = runtime.sendMessage(
      createMessageRequest({ messageId: '00000000-0000-4000-8000-000000000201' }),
    )[Symbol.asyncIterator]();
    await assert.rejects(() => second.next(), /already has an active message stream/);

    sessionAbortGate.resolve();
    assert.equal((await withTimeout(returnPromise)).done, true);
    await second.return?.();
    promptGate.resolve();
  });

  it('cleans up and redacts the error when early stream return abort fails', async () => {
    const promptGate = createDeferred();
    const { sdk, ai, calls, session } = createFakeDependencies({ promptGate });
    session.abort = async () => {
      calls.sessionAborted += 1;
      throw new Error('abort failed for sk-openai-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const first = runtime.sendMessage(createMessageRequest())[Symbol.asyncIterator]();

    assert.equal((await first.next()).value.type, 'assistant-message-delta');

    const returnPromise = first.return();
    await waitForCondition(() => calls.sessionAborted === 1);
    promptGate.resolve();
    await assert.rejects(
      () => returnPromise,
      (error) => {
        assert.equal(error.message, 'abort failed for [redacted]');
        assert.equal(error.message.includes('sk-openai-secret'), false);
        return true;
      },
    );
    assert.equal(calls.unsubscribed, 1);

    const retryEvents = await collect(runtime.sendMessage(createMessageRequest()));

    assert.equal(retryEvents[0].type, 'assistant-message-delta');
  });

  it('redacts provider and MCP secrets when early stream return abort fails', async () => {
    const promptGate = createDeferred();
    const { sdk, ai, calls, session } = createFakeDependencies({ promptGate });
    session.abort = async () => {
      calls.sessionAborted += 1;
      throw new Error('abort failed for sk-openai-secret and mcp-token-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));
    const first = runtime.sendMessage(createMessageRequest())[Symbol.asyncIterator]();

    assert.equal((await first.next()).value.type, 'assistant-message-delta');

    const returnPromise = first.return();
    await waitForCondition(() => calls.sessionAborted === 1);
    promptGate.resolve();
    await assert.rejects(
      () => returnPromise,
      (error) => {
        assert.equal(error.message, 'abort failed for [redacted] and [redacted]');
        assert.equal(error.message.includes('sk-openai-secret'), false);
        assert.equal(error.message.includes('mcp-token-secret'), false);
        return true;
      },
    );
  });

  it('cleans up and redacts the error when unsubscribe fails during stream cleanup', async () => {
    const promptGate = createDeferred();
    const { sdk, ai, calls, session } = createFakeDependencies({ promptGate });
    const originalSubscribe = session.subscribe.bind(session);
    let subscribeAttempts = 0;
    session.subscribe = (next) => {
      subscribeAttempts += 1;
      const unsubscribe = originalSubscribe(next);
      if (subscribeAttempts === 1) {
        return () => {
          unsubscribe();
          throw new Error('unsubscribe failed sk-openai-secret');
        };
      }

      return unsubscribe;
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const first = runtime.sendMessage(createMessageRequest())[Symbol.asyncIterator]();

    assert.equal((await first.next()).value.type, 'assistant-message-delta');

    const returnPromise = first.return();
    promptGate.resolve();
    await assert.rejects(
      () => returnPromise,
      (error) => {
        assert.equal(error.message, 'unsubscribe failed [redacted]');
        assert.equal(error.message.includes('sk-openai-secret'), false);
        return true;
      },
    );

    const retryEvents = await collect(runtime.sendMessage(createMessageRequest()));

    assert.equal(subscribeAttempts, 2);
    assert.equal(calls.unsubscribed, 2);
    assert.equal(retryEvents[0].type, 'assistant-message-delta');
  });

  it('sanitizes public dispose abort failures and removes the runner session', async () => {
    const promptGate = createDeferred();
    const { sdk, ai, calls, session } = createFakeDependencies({ promptGate });
    session.abort = async () => {
      calls.sessionAborted += 1;
      throw new Error('dispose abort failed for sk-openai-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());
    const stream = runtime.sendMessage(createMessageRequest())[Symbol.asyncIterator]();
    assert.equal((await stream.next()).value.type, 'assistant-message-delta');

    await assert.rejects(
      () => runtime.disposeSession('pi-00000000-0000-4000-8000-000000000100'),
      (error) => {
        assert.equal(error.message, 'dispose abort failed for [redacted]');
        assert.equal(error.message.includes('sk-openai-secret'), false);
        return true;
      },
    );
    promptGate.resolve();
    try {
      await stream.return?.();
    } catch (error) {
      assert.equal(error.message, 'dispose abort failed for [redacted]');
      assert.equal(error.message.includes('sk-openai-secret'), false);
    }

    assert.equal(calls.unsubscribed, 1);
    assert.equal(calls.disposed, 1);
    await assert.rejects(
      () => collect(runtime.sendMessage(createMessageRequest())),
      /Runner session not found/,
    );
  });

  it('sanitizes public dispose failures and removes the runner session', async () => {
    const { sdk, ai, calls, session } = createFakeDependencies();
    session.dispose = () => {
      calls.disposed += 1;
      throw new Error('dispose failed for sk-openai-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    await assert.rejects(
      () => runtime.disposeSession('pi-00000000-0000-4000-8000-000000000100'),
      (error) => {
        assert.equal(error.message, 'dispose failed for [redacted]');
        assert.equal(error.message.includes('sk-openai-secret'), false);
        return true;
      },
    );

    assert.equal(calls.disposed, 1);
    await assert.rejects(
      () => collect(runtime.sendMessage(createMessageRequest())),
      /Runner session not found/,
    );
  });

  it('returns a sanitized runner-error event when Pi prompt fails', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async () => {
      throw new Error('provider rejected sk-openai-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(
      runtime.sendMessage(createMessageRequest()),
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

  it('redacts provider and MCP secrets from Pi prompt failures', async () => {
    const { sdk, ai, session } = createFakeDependencies();
    session.prompt = async () => {
      throw new Error('provider rejected sk-openai-secret and mcp-token-secret');
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

    const events = await collect(runtime.sendMessage(createMessageRequest()));

    assert.deepEqual(events, [
      {
        type: 'runner-error',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        message: 'provider rejected [redacted] and [redacted]',
      },
    ]);
  });

  it('returns a sanitized runner-error event when Pi prompt throws synchronously', async () => {
    const { sdk, ai, session, calls } = createFakeDependencies();
    let promptAttempts = 0;
    const originalPrompt = session.prompt.bind(session);
    session.prompt = (text) => {
      promptAttempts += 1;
      if (promptAttempts === 1) {
        throw new Error('provider sync rejected sk-openai-secret');
      }

      return originalPrompt(text);
    };
    const runtime = createPiRuntime({ sdk, ai });
    await runtime.createSession(createSessionBody());

    const events = await collect(runtime.sendMessage(createMessageRequest()));

    assert.deepEqual(events, [
      {
        type: 'runner-error',
        sessionId: '00000000-0000-4000-8000-000000000100',
        runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
        message: 'provider sync rejected [redacted]',
      },
    ]);
    assert.equal(calls.unsubscribed, 1);

    const retryEvents = await collect(runtime.sendMessage(createMessageRequest()));

    assert.equal(promptAttempts, 2);
    assert.equal(retryEvents[0].type, 'assistant-message-delta');
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

    await runtime.disposeSession('pi-00000000-0000-4000-8000-000000000100');

    assert.equal(calls.disposed, 1);
  });
});
