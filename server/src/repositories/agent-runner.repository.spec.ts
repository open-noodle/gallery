import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType } from 'src/enum';
import { AgentRunnerRepository } from 'src/repositories/agent-runner.repository';
import type {
  AgentRunnerCreateSessionRequest,
  AgentRunnerMessageRequest,
  AgentRunnerResumeRequest,
} from 'src/types/agent-runner.types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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

const createSessionBody: AgentRunnerCreateSessionRequest = {
  gallerySessionId: 'gallery-session-1',
  credential: {
    id: 'credential-1',
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
    secret: 'sk-session-secret',
  },
  model: 'gpt-5.1',
  permissionPreset: AgentPermissionPreset.Careful,
  permissionPlan,
  approvalMode: AgentApprovalMode.Strict,
  initialContext: { albumId: 'album-1' },
};

const messageBody: AgentRunnerMessageRequest = {
  gallerySessionId: 'gallery-session-1',
  messageId: 'message-1',
  content: { blocks: [{ type: 'text', text: 'Organize these photos.' }] },
};

const resumeBody: AgentRunnerResumeRequest = {
  gallerySessionId: 'gallery-session-1',
};

const sseBody = (body: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });

const openSseBody = (body: string, cancel: () => void) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
    },
    cancel,
  });

const collectStream = async <T>(stream: AsyncGenerator<T>): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const validClarificationBlock = () => ({
  type: 'clarification',
  kind: 'person',
  query: 'Pierre',
  summary: 'I found two people named Pierre.',
  textFallback: 'Which Pierre should I use?',
  choices: [
    {
      choiceRef: 'choice:person:abcDEF1234567890',
      label: 'Pierre M.',
      description: '12 matching photos',
      thumbnailAssetId: '90c8090a-e461-4265-9bf0-7a8a191a6216',
    },
    {
      choiceRef: 'choice:person:defABC1234567890',
      label: 'Pierre',
      thumbnailAssetId: null,
    },
  ],
});

const completedClarificationEvent = (block: Record<string, unknown>) => ({
  type: 'assistant-message-completed',
  sessionId: 'gallery-session-1',
  runnerSessionId: 'runner-session-1',
  providerMessageId: 'provider-message-1',
  content: { blocks: [block] },
});

describe(AgentRunnerRepository.name, () => {
  let sut: AgentRunnerRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    sut = new AgentRunnerRepository();
  });

  it('probes the configured runner health endpoint and normalizes capabilities', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'ok',
          version: '0.1.0',
          capabilities: {
            protocolVersion: '2026-05-14',
            streaming: true,
            tools: ['mcp:gallery', 123, 'mcp_gallery_readAssetMetadata'],
            models: ['gpt-5.1', null],
          },
        }),
    });

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: true,
      reason: 'healthy',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['mcp:gallery', 'mcp_gallery_readAssetMetadata'],
        models: ['gpt-5.1'],
      },
    });
    expect(mockFetch).toHaveBeenCalledWith(new URL('/health', 'http://agent-runner:4477'), {
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
    expect(timeoutSpy).toHaveBeenCalledWith(2500);
  });

  it('preserves runner URL path prefixes when appending the health endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    });

    await sut.getStatus({ url: 'https://gateway.local/pi-runner/', timeoutMs: 2500 });

    expect(mockFetch).toHaveBeenCalledWith(new URL('https://gateway.local/pi-runner/health'), {
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
  });

  it('returns unhealthy for non-2xx responses', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'unhealthy',
      version: null,
      capabilities: null,
    });
  });

  it('returns invalid-response when healthy response is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('invalid json')),
    });

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'invalid-response',
      version: null,
      capabilities: null,
    });
  });

  it('returns invalid-response when status is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'starting' }),
    });

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'invalid-response',
      version: null,
      capabilities: null,
    });
  });

  it('returns invalid-response when healthy response body is null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(null),
    });

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'invalid-response',
      version: null,
      capabilities: null,
    });
  });

  it('returns timeout for abort timeout errors', async () => {
    const error = new Error('Timeout');
    error.name = 'TimeoutError';
    mockFetch.mockRejectedValue(error);

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'timeout',
      version: null,
      capabilities: null,
    });
  });

  it('returns timeout for body read timeout errors', async () => {
    const error = new Error('Timeout');
    error.name = 'TimeoutError';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(error),
    });

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'timeout',
      version: null,
      capabilities: null,
    });
  });

  it('returns unhealthy for network errors', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'));

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'unhealthy',
      version: null,
      capabilities: null,
    });
  });

  it('creates a runner session through the configured runner URL', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          runnerSessionId: 'runner-session-1',
          capabilities: { streaming: true },
        }),
    });

    await expect(
      sut.createSession({
        url: 'https://gateway.local/pi-runner/',
        timeoutMs: 3000,
        body: createSessionBody,
      }),
    ).resolves.toEqual({
      runnerSessionId: 'runner-session-1',
      capabilities: { streaming: true },
    });

    expect(mockFetch).toHaveBeenCalledWith(new URL('https://gateway.local/pi-runner/sessions'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(createSessionBody),
      signal: expect.any(AbortSignal),
    });
    expect(timeoutSpy).toHaveBeenCalledWith(3000);
  });

  it('throws when the runner session creation response body is invalid', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ runnerSessionId: 123 }),
    });

    await expect(
      sut.createSession({
        url: 'http://agent-runner:4477',
        timeoutMs: 3000,
        body: createSessionBody,
      }),
    ).rejects.toThrow('Agent runner returned an invalid session response');
  });

  it('throws when the runner session creation capabilities are null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ runnerSessionId: 'stub-1', capabilities: null }),
    });

    await expect(
      sut.createSession({
        url: 'http://agent-runner:4477',
        timeoutMs: 3000,
        body: createSessionBody,
      }),
    ).rejects.toThrow('Agent runner returned an invalid session response');
  });

  it('throws when runner session creation fails with a non-success response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });

    await expect(
      sut.createSession({
        url: 'http://agent-runner:4477',
        timeoutMs: 3000,
        body: createSessionBody,
      }),
    ).rejects.toThrow('Agent runner session creation failed with status 502');
  });

  it('cancels a runner session through the configured runner URL', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    await expect(
      sut.cancelSession({
        url: 'https://gateway.local/pi-runner/',
        runnerSessionId: 'runner/session 1',
        timeoutMs: 3000,
      }),
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(new URL('https://gateway.local/pi-runner/sessions/runner%2Fsession%201'), {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
    expect(timeoutSpy).toHaveBeenCalledWith(3000);
  });

  it('treats missing runner sessions as already cancelled', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    await expect(
      sut.cancelSession({
        url: 'http://agent-runner:4477',
        runnerSessionId: 'runner-session-1',
        timeoutMs: 3000,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws when runner session cancellation fails with a non-success response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });

    await expect(
      sut.cancelSession({
        url: 'http://agent-runner:4477',
        runnerSessionId: 'runner-session-1',
        timeoutMs: 3000,
      }),
    ).rejects.toThrow('Agent runner session cancellation failed with status 502');
  });

  it('streams and normalizes runner message SSE events', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const deltaEvent = {
      type: 'assistant-message-delta',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      delta: 'Hello',
      sequence: 1,
    };
    const completedEvent = {
      type: 'assistant-message-completed',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      providerMessageId: null,
      content: { blocks: [{ type: 'text', text: 'Hello there.' }] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(
        `event: delta\ndata: ${JSON.stringify(deltaEvent)}\n\n` + `data: ${JSON.stringify(completedEvent)}\n\n`,
      ),
    });

    await expect(
      collectStream(
        sut.streamMessage({
          url: 'https://gateway.local/pi-runner/',
          runnerSessionId: 'runner/session 1',
          timeoutMs: 3000,
          body: messageBody,
        }),
      ),
    ).resolves.toEqual([deltaEvent, completedEvent]);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL('https://gateway.local/pi-runner/sessions/runner%2Fsession%201/messages'),
      {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
        signal: expect.any(AbortSignal),
      },
    );
    expect(timeoutSpy).toHaveBeenCalledWith(3000);
  });

  it('parses a final SSE frame without a trailing blank-line separator', async () => {
    const completedEvent = {
      type: 'assistant-message-completed',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-1',
      content: { blocks: [{ type: 'text', text: 'Done.' }] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`data: ${JSON.stringify(completedEvent)}`),
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
    ).resolves.toEqual([completedEvent]);
  });

  it('accepts completed runner message content with clarification blocks', async () => {
    const completedEvent = completedClarificationEvent(validClarificationBlock());
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`data: ${JSON.stringify(completedEvent)}\n\n`),
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
    ).resolves.toEqual([completedEvent]);
  });

  it('throws when completed runner message content has an unsafe clarification choice ref', async () => {
    const block = validClarificationBlock();
    block.choices = [{ choiceRef: 'not-safe', label: 'Pierre', thumbnailAssetId: null }];
    const completedEvent = completedClarificationEvent(block);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`data: ${JSON.stringify(completedEvent)}\n\n`),
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

  it('throws when completed runner message content has a raw UUID clarification choice ref token', async () => {
    const block = validClarificationBlock();
    block.choices = [
      {
        choiceRef: 'choice:person:90c8090a-e461-4265-9bf0-7a8a191a6216',
        label: 'Pierre',
        thumbnailAssetId: null,
      },
    ];
    const completedEvent = completedClarificationEvent(block);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`data: ${JSON.stringify(completedEvent)}\n\n`),
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

  it.each([
    {
      name: 'invalid thumbnail UUID',
      mutate: (block: ReturnType<typeof validClarificationBlock>) => {
        block.choices[0].thumbnailAssetId = 'asset-1';
      },
    },
    {
      name: 'blank query',
      mutate: (block: ReturnType<typeof validClarificationBlock>) => {
        block.query = '   ';
      },
    },
    {
      name: 'overlong summary',
      mutate: (block: ReturnType<typeof validClarificationBlock>) => {
        block.summary = 'x'.repeat(1001);
      },
    },
    {
      name: 'overlong text fallback',
      mutate: (block: ReturnType<typeof validClarificationBlock>) => {
        block.textFallback = 'x'.repeat(1001);
      },
    },
    {
      name: 'blank choice label',
      mutate: (block: ReturnType<typeof validClarificationBlock>) => {
        block.choices[0].label = '   ';
      },
    },
    {
      name: 'overlong choice description',
      mutate: (block: ReturnType<typeof validClarificationBlock>) => {
        block.choices[0].description = 'x'.repeat(501);
      },
    },
    {
      name: 'raw choice id',
      mutate: (block: ReturnType<typeof validClarificationBlock>) => {
        Object.assign(block.choices[0], { id: '90c8090a-e461-4265-9bf0-7a8a191a6216' });
      },
    },
    {
      name: 'choice search filter',
      mutate: (block: ReturnType<typeof validClarificationBlock>) => {
        Object.assign(block.choices[0], { searchFilter: { personIds: ['90c8090a-e461-4265-9bf0-7a8a191a6216'] } });
      },
    },
    {
      name: 'extra block field',
      mutate: (block: ReturnType<typeof validClarificationBlock>) => {
        Object.assign(block, { searchFilter: { personIds: ['90c8090a-e461-4265-9bf0-7a8a191a6216'] } });
      },
    },
    {
      name: 'choice ref kind mismatch',
      mutate: (block: ReturnType<typeof validClarificationBlock>) => {
        block.choices[0].choiceRef = 'choice:album:abcDEF1234567890';
      },
    },
  ])('throws when completed runner message content has $name in a clarification block', async ({ mutate }) => {
    const block = validClarificationBlock();
    mutate(block);
    const completedEvent = completedClarificationEvent(block);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`data: ${JSON.stringify(completedEvent)}\n\n`),
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

  it.each([
    {
      name: 'empty block list',
      content: { blocks: [] },
    },
    {
      name: 'more than 100 blocks',
      content: { blocks: Array.from({ length: 101 }, () => ({ type: 'text', text: 'Hello.' })) },
    },
    {
      name: 'content JSON over 32 KiB',
      content: {
        blocks: Array.from({ length: 5 }, (_, index) => ({
          type: 'text',
          text: `${index}-${'x'.repeat(8000)}`,
        })),
      },
    },
  ])('throws when assistant-message-completed content has $name', async ({ content }) => {
    const completedEvent = {
      type: 'assistant-message-completed',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-1',
      content,
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`data: ${JSON.stringify(completedEvent)}\n\n`),
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

  it('streams runner resume SSE events from the continue endpoint', async () => {
    const deltaEvent = {
      type: 'assistant-message-delta',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      delta: 'Continuing',
      sequence: 1,
    };
    const completedEvent = {
      type: 'assistant-message-completed',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-2',
      content: { blocks: [{ type: 'text', text: 'Continuing now.' }] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`data: ${JSON.stringify(deltaEvent)}\n\n` + `data: ${JSON.stringify(completedEvent)}\n\n`),
    });

    await expect(
      collectStream(
        sut.streamResume({
          url: 'https://gateway.local/pi-runner/',
          runnerSessionId: 'runner/session 1',
          timeoutMs: 3000,
          body: resumeBody,
        }),
      ),
    ).resolves.toEqual([deltaEvent, completedEvent]);

    expect(mockFetch).toHaveBeenCalledWith(
      new URL('https://gateway.local/pi-runner/sessions/runner%2Fsession%201/continue'),
      {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(resumeBody),
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('parses CRLF-separated SSE frames as separate events', async () => {
    const deltaEvent = {
      type: 'assistant-message-delta',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      delta: 'Hello',
      sequence: 1,
    };
    const completedEvent = {
      type: 'assistant-message-completed',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-1',
      content: { blocks: [{ type: 'text', text: 'Hello.' }] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`data: ${JSON.stringify(deltaEvent)}\r\n\r\n` + `data: ${JSON.stringify(completedEvent)}\r\n\r\n`),
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
    ).resolves.toEqual([deltaEvent, completedEvent]);
  });

  it('streams runner-reported error SSE events', async () => {
    const runnerErrorEvent = {
      type: 'runner-error',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      message: 'Provider rejected the request.',
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`event: runner-error\ndata: ${JSON.stringify(runnerErrorEvent)}\n\n`),
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
    ).resolves.toEqual([runnerErrorEvent]);
  });

  it('streams tool approval-needed SSE events', async () => {
    const approvalEvent = {
      type: 'tool-approval-needed',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      toolCallId: '00000000-0000-4000-8000-000000000333',
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`event: tool-approval-needed\ndata: ${JSON.stringify(approvalEvent)}\n\n`),
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
    ).resolves.toEqual([approvalEvent]);
  });

  it('streams normalized runner activity SSE events', async () => {
    const activityEvent = {
      type: 'activity',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      kind: 'plan-composing',
      summary: 'Drafting a plan',
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`event: activity\ndata: ${JSON.stringify(activityEvent)}\n\n`),
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
    ).resolves.toEqual([
      {
        ...activityEvent,
        status: 'running',
      },
    ]);
  });

  it('normalizes unknown runner activity kinds to unknown', async () => {
    const activityEvent = {
      type: 'activity',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      kind: 'future-kind',
      status: 'completed',
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`event: activity\ndata: ${JSON.stringify(activityEvent)}\n\n`),
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
    ).resolves.toEqual([{ ...activityEvent, kind: 'unknown' }]);
  });

  it('ignores structurally invalid runner activity SSE events', async () => {
    const invalidActivityEvent = {
      type: 'activity',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      kind: 'apply-progress',
      status: 'running',
      counts: { total: -1 },
    };
    const completedEvent = {
      type: 'assistant-message-completed',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-1',
      content: { blocks: [{ type: 'text', text: 'Done.' }] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(
        `event: activity\ndata: ${JSON.stringify(invalidActivityEvent)}\n\n` +
          `data: ${JSON.stringify(completedEvent)}\n\n`,
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
    ).resolves.toEqual([completedEvent]);
  });

  it('throws when runner-reported error events are missing a non-empty message', async () => {
    const runnerErrorEvent = {
      type: 'runner-error',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      message: '',
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`event: runner-error\ndata: ${JSON.stringify(runnerErrorEvent)}\n\n`),
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

  it('throws when runner message stream fails with a non-success response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, body: sseBody('') });

    await expect(
      collectStream(
        sut.streamMessage({
          url: 'http://agent-runner:4477',
          runnerSessionId: 'runner-session-1',
          timeoutMs: 3000,
          body: messageBody,
        }),
      ),
    ).rejects.toThrow('Agent runner message stream failed with status 500');
  });

  it('throws when runner message stream response has no body', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: null });

    await expect(
      collectStream(
        sut.streamMessage({
          url: 'http://agent-runner:4477',
          runnerSessionId: 'runner-session-1',
          timeoutMs: 3000,
          body: messageBody,
        }),
      ),
    ).rejects.toThrow('Agent runner message stream failed with status 200');
  });

  it('throws when the runner message stream contains an invalid JSON SSE frame', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody('data: {invalid json}\n\n'),
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

  it('cancels the runner message stream when parsing fails', async () => {
    const cancel = vi.fn();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: openSseBody('data: {invalid json}\n\n', cancel),
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
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels the runner message stream when the consumer stops early', async () => {
    const cancel = vi.fn();
    const deltaEvent = {
      type: 'assistant-message-delta',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      delta: 'Hello',
      sequence: 1,
    };
    const completedEvent = {
      type: 'assistant-message-completed',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-1',
      content: { blocks: [{ type: 'text', text: 'Hello.' }] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: openSseBody(
        `data: ${JSON.stringify(deltaEvent)}\n\n` + `data: ${JSON.stringify(completedEvent)}\n\n`,
        cancel,
      ),
    });

    const events: unknown[] = [];
    for await (const event of sut.streamMessage({
      url: 'http://agent-runner:4477',
      runnerSessionId: 'runner-session-1',
      timeoutMs: 3000,
      body: messageBody,
    })) {
      events.push(event);
      break;
    }

    expect(events).toEqual([deltaEvent]);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('throws when the runner message stream contains an invalid event shape', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody('data: {"type":"assistant-message-delta","sessionId":"gallery-session-1"}\n\n'),
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

  it('throws when completed runner message content has malformed blocks', async () => {
    const completedEvent = {
      type: 'assistant-message-completed',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-1',
      content: { blocks: [123] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`data: ${JSON.stringify(completedEvent)}\n\n`),
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

  it.each([
    { name: 'blank text block', block: { type: 'text', text: '   ' } },
    { name: 'overlong text block', block: { type: 'text', text: 'x'.repeat(8001) } },
    { name: 'invalid asset UUID', block: { type: 'asset', assetId: 'asset-1' } },
    {
      name: 'overlong asset label',
      block: { type: 'asset', assetId: '90c8090a-e461-4265-9bf0-7a8a191a6216', label: 'x'.repeat(501) },
    },
    { name: 'extra text block key', block: { type: 'text', text: 'Hello.', id: 'raw-id' } },
  ])('throws when assistant-message-completed message content has malformed legacy block: $name', async ({ block }) => {
    const completedEvent = {
      type: 'assistant-message-completed',
      sessionId: 'gallery-session-1',
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-1',
      content: { blocks: [block] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody(`data: ${JSON.stringify(completedEvent)}\n\n`),
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
});
