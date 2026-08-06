import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createE2eRuntime } from './e2e-runtime.mjs';
import { createPiRuntime } from './pi-runtime.mjs';

const defaultCapabilities = {
  protocolVersion: '2026-05-14',
  streaming: true,
  tools: [],
  models: [],
  runtime: 'pi',
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
    return { ok: true, body: await readJson(request) };
  } catch {
    sendJson(response, 400, { error: 'invalid JSON body' });
    return { ok: false };
  }
};

const sendSse = (response, event, data) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
};

const streamRuntimeEvents = async ({ response, stream, onRuntimeError }) => {
  const iterator = stream[Symbol.asyncIterator]();
  let clientClosed = false;
  const handleClose = () => {
    if (response.writableEnded) {
      return;
    }

    clientClosed = true;
    void iterator.return?.();
  };

  response.on('close', handleClose);
  try {
    while (true) {
      const { value, done } = await iterator.next();
      if (done || clientClosed || response.destroyed || response.writableEnded) {
        break;
      }

      sendSse(response, value.type, value);
    }
  } catch {
    if (!clientClosed && !response.destroyed && !response.writableEnded) {
      onRuntimeError();
    }
  } finally {
    response.off('close', handleClose);
    await iterator.return?.();
    if (!response.destroyed && !response.writableEnded) {
      response.end();
    }
  }
};

const decodeRunnerSessionId = (encodedRunnerSessionId) => {
  try {
    return decodeURIComponent(encodedRunnerSessionId);
  } catch {
    return undefined;
  }
};

export const createRuntimeFromEnv = (env = process.env) =>
  env.GALLERY_AGENT_RUNNER_RUNTIME === 'e2e' ? createE2eRuntime() : createPiRuntime();

const normalizeCapabilities = (capabilities) => {
  if (
    !capabilities ||
    typeof capabilities !== 'object' ||
    typeof capabilities.protocolVersion !== 'string' ||
    typeof capabilities.streaming !== 'boolean' ||
    !Array.isArray(capabilities.tools) ||
    !Array.isArray(capabilities.models)
  ) {
    throw new Error('invalid runtime capabilities');
  }

  const normalizedCapabilities = {
    protocolVersion: capabilities.protocolVersion,
    streaming: capabilities.streaming,
    tools: capabilities.tools,
    models: capabilities.models,
  };
  if (typeof capabilities.runtime === 'string') {
    normalizedCapabilities.runtime = capabilities.runtime;
  }

  return normalizedCapabilities;
};

const getRuntimeCapabilities = (runtime) =>
  typeof runtime.getCapabilities === 'function' ? normalizeCapabilities(runtime.getCapabilities()) : defaultCapabilities;

const validateCreateSessionBody = (body) => {
  if (typeof body?.gallerySessionId !== 'string') {
    return 'gallerySessionId is required';
  }

  if (!body.credential || typeof body.credential !== 'object') {
    return 'credential is required';
  }

  if (typeof body.credential.secret !== 'string' || body.credential.secret.length === 0) {
    return 'credential.secret is required';
  }

  if (typeof body.model !== 'string' || body.model.length === 0) {
    return 'model is required';
  }

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

  return undefined;
};

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

const validateModelSetup = async (runtime, body) => {
  const runnerSession = normalizeRuntimeCreateSessionResponse(
    await runtime.createSession(createSessionProtocolBody({ ...body, mcpGateway: null })),
  );

  try {
    let completed = false;
    for await (const event of runtime.sendMessage({
      runnerSessionId: runnerSession.runnerSessionId,
      gallerySessionId: body.gallerySessionId,
      messageId: `${body.gallerySessionId}:validation`,
      content: { blocks: [{ type: 'text', text: 'Reply with exactly: OK' }] },
    })) {
      if (event.type === 'runner-error') {
        throw new Error(event.message);
      }

      if (event.type === 'assistant-message-completed') {
        completed = true;
      }
    }

    if (!completed) {
      throw new Error('validation message did not complete');
    }

    return runnerSession;
  } finally {
    await runtime.disposeSession?.(runnerSession.runnerSessionId);
  }
};

const normalizeRuntimeCreateSessionResponse = (runnerSession) => {
  if (typeof runnerSession?.runnerSessionId !== 'string') {
    throw new Error('invalid runtime session response');
  }

  return {
    runnerSessionId: runnerSession.runnerSessionId,
    capabilities: normalizeCapabilities(runnerSession.capabilities),
  };
};

const validateMessageBody = (body) => {
  if (typeof body?.gallerySessionId !== 'string') {
    return 'gallerySessionId is required';
  }

  if (typeof body.messageId !== 'string') {
    return 'messageId is required';
  }

  if (!body.content || typeof body.content !== 'object' || !Array.isArray(body.content.blocks)) {
    return 'content is required';
  }

  if (body.workflowState !== undefined && body.workflowState !== null && typeof body.workflowState !== 'object') {
    return 'workflowState must be an object or null';
  }

  return undefined;
};

const validateResumeBody = (body) => {
  if (typeof body?.gallerySessionId !== 'string') {
    return 'gallerySessionId is required';
  }

  if (body.toolCallId !== undefined && typeof body.toolCallId !== 'string') {
    return 'toolCallId must be a string';
  }

  if (
    body.approvalDecision !== undefined &&
    body.approvalDecision !== 'approved' &&
    body.approvalDecision !== 'denied'
  ) {
    return 'approvalDecision must be approved or denied';
  }

  if (body.toolResult !== undefined && (body.toolResult === null || typeof body.toolResult !== 'object')) {
    return 'toolResult must be an object';
  }

  if (body.workflowState !== undefined && body.workflowState !== null && typeof body.workflowState !== 'object') {
    return 'workflowState must be an object or null';
  }

  return undefined;
};

const startSse = (response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  response.flushHeaders?.();
  response.write(': connected\n\n');
};

export const startServer = ({
  port = Number(process.env.PORT ?? 4477),
  host = process.env.HOST ?? '127.0.0.1',
  runtime = createRuntimeFromEnv(),
} = {}) => {
  const runnerSessions = new Map();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { status: 'ok', version: '0.1.0', capabilities: getRuntimeCapabilities(runtime) });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/sessions') {
      const result = await readJsonOrSendError(request, response);
      if (!result.ok) {
        return;
      }

      const validationError = validateCreateSessionBody(result.body);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      try {
        const sessionBody = createSessionProtocolBody(result.body);
        const runnerSession = normalizeRuntimeCreateSessionResponse(await runtime.createSession(sessionBody));
        runnerSessions.set(runnerSession.runnerSessionId, sessionBody.gallerySessionId);
        sendJson(response, 201, runnerSession);
      } catch {
        sendJson(response, 502, { error: 'runner session creation failed' });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/validate-session') {
      const result = await readJsonOrSendError(request, response);
      if (!result.ok) {
        return;
      }

      const validationError = validateCreateSessionBody(result.body);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      try {
        const runnerSession = await validateModelSetup(runtime, result.body);
        sendJson(response, 200, { ok: true, capabilities: runnerSession.capabilities });
      } catch {
        sendJson(response, 502, { error: 'runner model validation failed' });
      }
      return;
    }

    const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
    if (request.method === 'DELETE' && sessionMatch) {
      const runnerSessionId = decodeRunnerSessionId(sessionMatch[1]);
      if (!runnerSessionId || !runnerSessions.has(runnerSessionId)) {
        sendJson(response, 404, { error: 'runner session not found' });
        return;
      }

      try {
        await runtime.disposeSession?.(runnerSessionId);
        runnerSessions.delete(runnerSessionId);
        response.writeHead(204);
        response.end();
      } catch {
        sendJson(response, 502, { error: 'runner session disposal failed' });
      }
      return;
    }

    const messageMatch = url.pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (request.method === 'POST' && messageMatch) {
      const runnerSessionId = decodeRunnerSessionId(messageMatch[1]);
      if (!runnerSessionId) {
        sendJson(response, 404, { error: 'runner session not found' });
        return;
      }

      const result = await readJsonOrSendError(request, response);
      if (!result.ok) {
        return;
      }

      const { body } = result;
      const validationError = validateMessageBody(body);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      if (runnerSessions.get(runnerSessionId) !== body.gallerySessionId) {
        sendJson(response, 404, { error: 'runner session not found' });
        return;
      }

      startSse(response);

      await streamRuntimeEvents({
        response,
        stream: runtime.sendMessage({
          runnerSessionId,
          gallerySessionId: body.gallerySessionId,
          messageId: body.messageId,
          content: body.content,
          ...(body.workflowState === undefined ? {} : { workflowState: body.workflowState }),
        }),
        onRuntimeError: () =>
          sendSse(response, 'runner-error', {
            type: 'runner-error',
            sessionId: body.gallerySessionId,
            runnerSessionId,
            message: 'Runner session failed',
          }),
      });
      return;
    }

    const continueMatch = url.pathname.match(/^\/sessions\/([^/]+)\/continue$/);
    if (request.method === 'POST' && continueMatch) {
      const runnerSessionId = decodeRunnerSessionId(continueMatch[1]);
      if (!runnerSessionId) {
        sendJson(response, 404, { error: 'runner session not found' });
        return;
      }

      const result = await readJsonOrSendError(request, response);
      if (!result.ok) {
        return;
      }

      const { body } = result;
      const validationError = validateResumeBody(body);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      if (runnerSessions.get(runnerSessionId) !== body.gallerySessionId) {
        sendJson(response, 404, { error: 'runner session not found' });
        return;
      }

      if (typeof runtime.resumeSession !== 'function') {
        sendJson(response, 501, { error: 'runner session resume is not supported' });
        return;
      }

      startSse(response);

      await streamRuntimeEvents({
        response,
        stream: runtime.resumeSession({
          runnerSessionId,
          gallerySessionId: body.gallerySessionId,
          toolCallId: body.toolCallId,
          approvalDecision: body.approvalDecision,
          toolResult: body.toolResult,
          ...(body.workflowState === undefined ? {} : { workflowState: body.workflowState }),
        }),
        onRuntimeError: () =>
          sendSse(response, 'runner-error', {
            type: 'runner-error',
            sessionId: body.gallerySessionId,
            runnerSessionId,
            message: 'Runner session failed',
          }),
      });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve(server));
  });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer();
  const address = server.address();
  if (address && typeof address === 'object') {
    console.log(`agent-runner listening on http://${address.address}:${address.port}`);
  }
}
