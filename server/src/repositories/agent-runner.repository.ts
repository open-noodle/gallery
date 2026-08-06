import { Injectable } from '@nestjs/common';
import { isAgentChoiceRef } from 'src/dtos/agent-asset-source.dto';
import { AgentRunnerCapabilities, AgentRunnerStatusReason } from 'src/dtos/agent-runner.dto';
import type {
  AgentRunnerActivityKind,
  AgentRunnerActivityStatus,
  AgentRunnerActivityStreamEvent,
  AgentRunnerCreateSessionRequest,
  AgentRunnerCreateSessionResult,
  AgentRunnerMessageRequest,
  AgentRunnerResumeRequest,
  AgentRunnerStreamEvent,
  AgentRunnerValidateSessionResult,
} from 'src/types/agent-runner.types';

type RunnerHealthBody = {
  status?: unknown;
  version?: unknown;
  capabilities?: unknown;
};

type AgentRunnerProbeConfig = {
  url: string;
  timeoutMs: number;
};

const MAX_CONTENT_BYTES = 32_768;

export type AgentRunnerProbeResult = {
  healthy: boolean;
  reason: Exclude<AgentRunnerStatusReason, 'not-configured'>;
  version: string | null;
  capabilities: AgentRunnerCapabilities | null;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const jsonByteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const objectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const isRunnerHealthBody = (value: unknown): value is RunnerHealthBody =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeCapabilities = (value: unknown): AgentRunnerCapabilities => {
  const capabilities = objectRecord(value);
  return {
    protocolVersion: typeof capabilities.protocolVersion === 'string' ? capabilities.protocolVersion : null,
    streaming: capabilities.streaming === true,
    tools: stringArray(capabilities.tools),
    models: stringArray(capabilities.models),
  };
};

const unavailable = (
  reason: Exclude<AgentRunnerStatusReason, 'not-configured' | 'healthy'>,
): AgentRunnerProbeResult => ({
  healthy: false,
  reason,
  version: null,
  capabilities: null,
});

const getRunnerUrl = (url: string, path: string) => {
  const runnerUrl = new URL(url);
  runnerUrl.pathname = `${runnerUrl.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  return runnerUrl;
};

const isCreateSessionResult = (value: unknown): value is AgentRunnerCreateSessionResult => {
  const body = objectRecord(value);
  return typeof body.runnerSessionId === 'string' && objectRecord(body.capabilities) === body.capabilities;
};

const isValidateSessionResult = (value: unknown): value is AgentRunnerValidateSessionResult => {
  const body = objectRecord(value);
  return body.ok === true && objectRecord(body.capabilities) === body.capabilities;
};

const isBoundedTrimmedString = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
const isUuidV4 = (value: unknown): boolean =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean =>
  Object.keys(value).every((key) => keys.has(key));
const textBlockKeys = new Set(['type', 'text']);
const toolCallBlockKeys = new Set(['type', 'toolCallId', 'summary']);
const assetBlockKeys = new Set(['type', 'assetId', 'label']);
const planBlockKeys = new Set(['type', 'planId', 'label']);
const clarificationKinds = new Set(['person', 'tag', 'album', 'space', 'cameraMake', 'cameraModel', 'lensModel']);
const clarificationBlockKeys = new Set(['type', 'kind', 'query', 'summary', 'textFallback', 'choices']);
const clarificationChoiceKeys = new Set(['choiceRef', 'label', 'description', 'thumbnailAssetId']);
const isChoiceRef = isAgentChoiceRef;
const activityKinds = new Set<AgentRunnerActivityKind>([
  'start-processing',
  'plan-composing',
  'apply-progress',
  'runner-recovery',
  'strict_router_decision',
  'strict_workflow_outcome',
  'strict_success_gate_block',
  'strict_continuation',
  'unknown',
]);
const activityStatuses = new Set<AgentRunnerActivityStatus>(['running', 'completed', 'failed', 'skipped']);
const activityCountKeys = new Set(['total', 'applied', 'skipped', 'failed']);

const isMessageBlock = (value: unknown): boolean => {
  const block = objectRecord(value);
  if (block.type === 'text') {
    return hasOnlyKeys(block, textBlockKeys) && isBoundedTrimmedString(block.text, 1, 8000);
  }

  if (block.type === 'tool-call') {
    return (
      hasOnlyKeys(block, toolCallBlockKeys) &&
      isUuidV4(block.toolCallId) &&
      (block.summary === undefined || isBoundedTrimmedString(block.summary, 1, 500))
    );
  }

  if (block.type === 'asset') {
    return (
      hasOnlyKeys(block, assetBlockKeys) &&
      isUuidV4(block.assetId) &&
      (block.label === undefined || isBoundedTrimmedString(block.label, 1, 500))
    );
  }

  if (block.type === 'plan') {
    return (
      hasOnlyKeys(block, planBlockKeys) &&
      isUuidV4(block.planId) &&
      (block.label === undefined || isBoundedTrimmedString(block.label, 1, 500))
    );
  }

  if (block.type === 'clarification') {
    return (
      hasOnlyKeys(block, clarificationBlockKeys) &&
      typeof block.kind === 'string' &&
      clarificationKinds.has(block.kind) &&
      isBoundedTrimmedString(block.query, 1, 500) &&
      isBoundedTrimmedString(block.summary, 1, 1000) &&
      isBoundedTrimmedString(block.textFallback, 1, 1000) &&
      Array.isArray(block.choices) &&
      block.choices.length > 0 &&
      block.choices.length <= 10 &&
      block.choices.every((choice) => {
        const normalizedChoice = objectRecord(choice);
        return (
          hasOnlyKeys(normalizedChoice, clarificationChoiceKeys) &&
          isChoiceRef(normalizedChoice.choiceRef) &&
          normalizedChoice.choiceRef.startsWith(`choice:${block.kind}:`) &&
          isBoundedTrimmedString(normalizedChoice.label, 1, 500) &&
          (normalizedChoice.description === undefined ||
            isBoundedTrimmedString(normalizedChoice.description, 1, 500)) &&
          (normalizedChoice.thumbnailAssetId === undefined ||
            normalizedChoice.thumbnailAssetId === null ||
            isUuidV4(normalizedChoice.thumbnailAssetId))
        );
      })
    );
  }

  return false;
};

const isMessageContent = (value: unknown): boolean => {
  const content = objectRecord(value);
  return (
    Array.isArray(content.blocks) &&
    content.blocks.length > 0 &&
    content.blocks.length <= 100 &&
    jsonByteLength(content) <= MAX_CONTENT_BYTES &&
    content.blocks.every((block) => isMessageBlock(block))
  );
};

const normalizeActivityEvent = (value: unknown): AgentRunnerActivityStreamEvent | null => {
  const body = objectRecord(value);
  if (
    body.type !== 'activity' ||
    typeof body.sessionId !== 'string' ||
    typeof body.runnerSessionId !== 'string' ||
    typeof body.kind !== 'string'
  ) {
    return null;
  }

  if (
    body.status !== undefined &&
    (typeof body.status !== 'string' || !activityStatuses.has(body.status as AgentRunnerActivityStatus))
  ) {
    return null;
  }

  const activityEvent: AgentRunnerActivityStreamEvent = {
    type: 'activity',
    sessionId: body.sessionId,
    runnerSessionId: body.runnerSessionId,
    kind: activityKinds.has(body.kind as AgentRunnerActivityKind) ? (body.kind as AgentRunnerActivityKind) : 'unknown',
    status: body.status === undefined ? 'running' : (body.status as AgentRunnerActivityStatus),
  };

  if (body.summary !== undefined) {
    if (typeof body.summary !== 'string') {
      return null;
    }
    activityEvent.summary = body.summary;
  }

  if (body.counts !== undefined) {
    const counts = objectRecord(body.counts);
    if (counts !== body.counts) {
      return null;
    }

    const normalizedCounts: NonNullable<AgentRunnerActivityStreamEvent['counts']> = {};
    for (const [key, count] of Object.entries(counts)) {
      if (!activityCountKeys.has(key) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        return null;
      }
      normalizedCounts[key as keyof typeof normalizedCounts] = count;
    }
    activityEvent.counts = normalizedCounts;
  }

  return activityEvent;
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
      isMessageContent(body.content)
    );
  }

  if (body.type === 'runner-error') {
    return (
      typeof body.sessionId === 'string' &&
      typeof body.runnerSessionId === 'string' &&
      typeof body.message === 'string' &&
      body.message.trim().length > 0
    );
  }

  if (body.type === 'tool-approval-needed') {
    return (
      typeof body.sessionId === 'string' &&
      typeof body.runnerSessionId === 'string' &&
      typeof body.toolCallId === 'string' &&
      body.toolCallId.trim().length > 0
    );
  }

  return false;
};

const parseSseFrame = (frame: string): AgentRunnerStreamEvent | null => {
  const dataLine = frame
    .replaceAll('\r\n', '\n')
    .split('\n')
    .find((line) => line.startsWith('data: '));
  if (!dataLine) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLine.slice('data: '.length));
  } catch {
    throw new Error('Agent runner returned an invalid stream event');
  }

  if (objectRecord(parsed).type === 'activity') {
    return normalizeActivityEvent(parsed);
  }

  if (!isStreamEvent(parsed)) {
    throw new Error('Agent runner returned an invalid stream event');
  }

  return parsed;
};

async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AgentRunnerStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replaceAll('\r\n', '\n');
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (event) {
          yield event;
        }
      }
    }

    buffer += decoder.decode();

    if (buffer.trim().length > 0) {
      const event = parseSseFrame(buffer);
      if (event) {
        yield event;
      }
    }

    completed = true;
  } finally {
    try {
      if (!completed) {
        await reader.cancel().catch(() => {});
      }
    } finally {
      reader.releaseLock();
    }
  }
}

@Injectable()
export class AgentRunnerRepository {
  async getStatus({ url, timeoutMs }: AgentRunnerProbeConfig): Promise<AgentRunnerProbeResult> {
    try {
      const response = await fetch(getRunnerUrl(url, 'health'), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        return unavailable('unhealthy');
      }

      let body: RunnerHealthBody;
      try {
        const value = await response.json();
        if (!isRunnerHealthBody(value)) {
          return unavailable('invalid-response');
        }
        body = value;
      } catch (error) {
        return unavailable(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'invalid-response');
      }

      if (body.status !== 'ok') {
        return unavailable('invalid-response');
      }

      return {
        healthy: true,
        reason: 'healthy',
        version: typeof body.version === 'string' ? body.version : null,
        capabilities: normalizeCapabilities(body.capabilities),
      };
    } catch (error) {
      return unavailable(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unhealthy');
    }
  }

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

  async validateSession({
    url,
    timeoutMs,
    body,
  }: {
    url: string;
    timeoutMs: number;
    body: AgentRunnerCreateSessionRequest;
  }): Promise<AgentRunnerValidateSessionResult> {
    const response = await fetch(getRunnerUrl(url, 'validate-session'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Agent runner model validation failed with status ${response.status}`);
    }

    const result = await response.json();
    if (!isValidateSessionResult(result)) {
      throw new Error('Agent runner returned an invalid validation response');
    }

    return result;
  }

  async cancelSession({
    url,
    runnerSessionId,
    timeoutMs,
  }: {
    url: string;
    runnerSessionId: string;
    timeoutMs: number;
  }): Promise<void> {
    const response = await fetch(getRunnerUrl(url, `sessions/${encodeURIComponent(runnerSessionId)}`), {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Agent runner session cancellation failed with status ${response.status}`);
    }
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

  async *streamResume({
    url,
    runnerSessionId,
    timeoutMs,
    body,
  }: {
    url: string;
    runnerSessionId: string;
    timeoutMs: number;
    body: AgentRunnerResumeRequest;
  }): AsyncGenerator<AgentRunnerStreamEvent> {
    const response = await fetch(getRunnerUrl(url, `sessions/${encodeURIComponent(runnerSessionId)}/continue`), {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Agent runner resume stream failed with status ${response.status}`);
    }

    yield* parseSseStream(response.body);
  }
}
