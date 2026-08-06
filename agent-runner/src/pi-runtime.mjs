import { complete, getModel, Type } from '@earendil-works/pi-ai';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { galleryMcpPromptCheatSheet } from './generated/gallery-mcp-prompt-cheat-sheet.mjs';
import { createIntentClassifier } from './strict-workflows/classifier.mjs';
import { createWorkflowDispatcher } from './strict-workflows/dispatcher.mjs';
import { WORKFLOW_MANIFEST } from './strict-workflows/manifest.mjs';
import { createWorkflowRegistry } from './strict-workflows/registry.mjs';

const protocolVersion = '2026-05-14';
const runnerBehaviorPrompt = [
  'You are Gallery Assistant, a personal photo organization assistant.',
  'Your goal is to help the user organize photos into albums by producing a reviewable album operation plan.',
  'For recent trip album requests, call mcp_gallery_findTripCandidates before asking for dates; include placeHint when the user names a place and omit it otherwise.',
  'Follow findTripCandidates.recommendation.action: use_top_candidate means create a reviewable plan for candidateDedupeKey, ask_user means ask one question with candidate labels, and none means ask for one concrete source before planning.',
  'Generic trip albums pass candidate selectionHandle.id directly to mcp_gallery_proposeAlbumFromSelection; explicit top/best/highlights default to 10 and use mcp_gallery_curateSelection before proposing.',
  'For trip album final copy, disclose the assumed trip window and duplicate/stack exclusions; disclose metadata-only curation only for explicit highlights.',
  'For best/highlight requests, require a bounded source; default to 10 only when the source is bounded and no count is specified; zero, negative, or above 1000 counts ask for a valid smaller count; ask to narrow only when known count or total is above 1000. No matching highlight candidates: answer directly and do not create a plan.',
  'For metadata-only suggested highlights, start from a bounded search handle, use returned counts/source refs/samples and source-backed workflows, prioritize existing favorites and ratings when available, disclose that no previews were inspected, and ask to narrow when handle-only metadata is insufficient.',
  'After metadata-only curation narrows candidates, propose writes with returned selection handles or source refs; do not use broad assetSource for curated highlight write plans, and do not copy search-derived asset IDs into provider-facing prompts.',
  'No previews are required for metadata-only highlight plans. Use mcp_gallery_readAssetPreviews later only for preview-assisted curation when allowed and the bounded candidate set is small.',
  'Preview-assisted highlight requests must start from a bounded handle or exact small non-search selection; above 250 preview candidates, ask the user to narrow before preview-assisted curation.',
  'If previews are denied or unavailable, or the provider cannot inspect images, continue with metadata-only highlight criteria when that satisfies the request, disclose the fallback, or ask one concise clarification.',
  'Cover suggestions require exactly one bounded exact selection before album.setCover. Prefer previews when allowed and bounded; otherwise use metadata-only criteria with disclosure or ask one concise follow-up.',
  'Never call mcp_gallery_readAssetOriginals for highlight or cover curation.',
  'When a user asks you to create or fill an album and metadata candidates are found, call mcp_gallery_proposeAlbumOperations with album.create and album.addAssets operations. A chat-only answer is not enough for album creation requests.',
  'For factual questions about albums, photo counts, video counts, asset counts, dates, places, tags, ratings, or asset details, use Gallery MCP read tools before answering. Do not guess from memory or say you cannot inspect Gallery while read tools are available.',
  'If a Gallery MCP read tool returns status "approval-required", stop the turn without explaining the approval request to the user. Gallery will show approval UI and resume you after the user decides.',
  'Gallery MCP validation/error results with retryable correction hints are recoverable: retry with corrected arguments once, but approval-required results pause for Gallery approval. A first-pass tool validation mistake is not an internal Gallery issue.',
  'After Gallery resumes you from an approval decision, treat any previous approval-required result as obsolete. Use the approved tool result or approved toolCallId Gallery provides, continue the original user task, and do not mention pending approval.',
  'If a user asks for an empty album, propose a single album.create operation with payload.albumName and an empty description; do not add asset operations.',
  'Prefer concise, useful album names and summaries. Only propose operations that are supported by the inspected assets, albums, and session permissions.',
  'Do not redirect the user to Apple Photos, Google Photos, Samsung Gallery, or another app. Stay inside Gallery and use Gallery plans.',
  'You have no direct write tools and must not apply album changes yourself.',
  'Never claim you changed albums. Album writes require a separate user-reviewed apply step.',
].join('\n');
const rewriteRunnerMcpPromptLine = (line) => {
  if (line.startsWith('Progressive:')) {
    return 'Progressive: resolve names -> searchAssets returns selection handles and source refs; use readAssetMetadata only for specific non-search asset details when required. Bounded handle-first searches may use limit up to 1000; if truncated/hasMore, page or ask one narrowing question.';
  }

  if (line.startsWith('Large:')) {
    return 'Large: use returned selectionHandle.id or sourceRef for planning.';
  }

  if (line.startsWith('Best/highlights require')) {
    return 'Best/highlights require bounded source album/space/date/search/selection; suggested not objective quality scoring; use returned handles or source refs for write planning.';
  }

  if (line.startsWith('Technical metadata:')) {
    return 'Technical metadata: search handles first; call readAssetMetadata only when specific non-search asset details are required.';
  }

  if (line.startsWith('Low-level ')) {
    return 'Low-level exact sets: prefer assetSelectionHandleId for search results; explicit IDs only for exact small non-search inspected sets. Example {"targetKind":"existing_space","targetId":"<target-id>","assetSelectionHandleId":"<selectionHandle.id from searchAssets>"}';
  }

  return line;
};

const runnerGalleryMcpPromptCheatSheet = galleryMcpPromptCheatSheet.split('\n').map(rewriteRunnerMcpPromptLine).join('\n');
const systemPrompt = [runnerBehaviorPrompt, runnerGalleryMcpPromptCheatSheet].join('\n\n');
const runtimePackageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runtimeAgentDir = join(runtimePackageRoot, '.pi-runtime');
const runtimeSessionRoot = join(runtimeAgentDir, 'sessions');
const requireFromRuntime = createRequire(import.meta.url);
let mcpEnvironmentQueue = Promise.resolve();

const resolvePiMcpExtensionPath = () =>
  join(dirname(requireFromRuntime.resolve('pi-mcp-extension/package.json')), 'src/index.ts');

const defaultDependencies = {
  ai: { getModel, complete, Type },
  sdk: {
    AuthStorage,
    createAgentSession,
    DefaultResourceLoader,
    ModelRegistry,
    SessionManager,
    SettingsManager,
  },
};

// The classifier's structured-output contract. The classifier returns this and
// the dispatcher then runs each workflow's `parseSlots` over `slots`.
const CLASSIFY_TOOL_NAME = 'classify_intent';

// Real `@earendil-works/pi-ai` one-shot structured-output adapter.
//
// The SDK exposes NO `generateStructured` on the model handle returned by
// `getModel(provider, model)` — that handle is a plain `Model<Api>` descriptor.
// The real non-streaming entry point is `complete(model, context, options) =>
// Promise<AssistantMessage>`. We force structured output by passing a single
// `classify_intent` tool whose parameters mirror CLASSIFY_SCHEMA, then read the
// forced tool-call's `arguments` off the returned message. No Gallery MCP tools
// are present (separate from the agent session), the call is low-temperature,
// and it is wrapped by the classifier so it never throws into the runtime.
// Exported for the eval harness (eval/) so it can drive the REAL classify path
// against a live provider. Not used elsewhere outside this module.
export const createPiClassifyIntent =
  ({ ai, apiKey }) =>
  async ({ getModel: resolveModel, system, prompt, signal }) => {
    const model = resolveModel();
    if (!model) {
      throw new Error('No model handle available for intent classification');
    }

    // Forward-compatible: if a future SDK adds a one-shot structured generate on
    // the handle, prefer it. Today this path is unused (handles are plain data).
    if (typeof model.generateStructured === 'function') {
      return model.generateStructured({ system, input: prompt, temperature: 0, signal });
    }

    const Type = ai.Type;
    const classifyTool = {
      name: CLASSIFY_TOOL_NAME,
      description: 'Report the single best-matching workflow intent for the user message.',
      parameters: Type.Object({
        workflow: Type.String({ description: 'Workflow kind, or "none".' }),
        slots: Type.Record(Type.String(), Type.String(), {
          description: 'Extracted slot values as strings.',
        }),
        confidence: Type.Union([Type.Literal('high'), Type.Literal('low')]),
      }),
    };

    const message = await ai.complete(
      model,
      {
        systemPrompt: system,
        messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
        tools: [classifyTool],
      },
      { temperature: 0, apiKey, signal },
    );

    const toolCall = Array.isArray(message?.content)
      ? message.content.find((block) => block?.type === 'toolCall' && block.name === CLASSIFY_TOOL_NAME)
      : undefined;
    if (!toolCall) {
      throw new Error('Classifier did not return a structured intent');
    }

    return toolCall.arguments;
  };

// Tool-free copy rephraser used by `copyMode: 'llm-polish'` (Slice 6). It is
// passed ONLY the scrubbed success summary (no ids/handles/sourceRefs) and may
// only REWORD — the success/failure decision and the "a plan exists" claim are
// made deterministically by `renderCopy` before this runs. It has NO tools and
// runs a single low-temperature `complete()` call. Any error propagates so
// `renderCopy` falls back to the deterministic template.
const POLISH_SYSTEM_PROMPT = [
  'You rewrite a short status sentence for a photo album plan that has already been created and is awaiting user review.',
  'You are given a scrubbed JSON summary. Rephrase it into one concise, friendly sentence.',
  'You have no tools and take no actions. Do not invent details not present in the summary.',
  'Always make clear the plan still needs the user to review and apply it before any change happens.',
].join(' ');

// Exported for the eval harness (eval/) — see createPiClassifyIntent above.
export const createPiPolishCopy =
  ({ ai, getModel, apiKey }) =>
  async (summary) => {
    const model = typeof getModel === 'function' ? getModel() : undefined;
    if (!model) {
      throw new Error('No model handle available for copy polish');
    }

    const message = await ai.complete(
      model,
      {
        systemPrompt: POLISH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(summary), timestamp: Date.now() }],
        tools: [],
      },
      { temperature: 0.3, apiKey },
    );

    const text = Array.isArray(message?.content)
      ? message.content
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('')
          .trim()
      : '';
    if (!text) {
      throw new Error('Copy polish returned empty text');
    }

    return text;
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

const redactSecrets = (message, secrets) =>
  secrets.reduce((redacted, secret) => redactSecret(redacted, secret), message);

const extractMcpTextContent = (result) =>
  result?.content
    ?.filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim() ?? '';

const parseGalleryMcpToolResult = (result, name) => {
  if (result?.isError) {
    throw new Error(`Gallery MCP tool ${name} returned an error`);
  }

  if (result?.structuredContent !== undefined) {
    return result.structuredContent;
  }

  const text = extractMcpTextContent(result);
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid Gallery MCP tool result JSON for ${name}`);
  }
};

const createGalleryMcpClient = ({ gateway, fetch: fetchImplementation }) => {
  let nextId = 1;

  return {
    async call(name, args, { signal } = {}) {
      const id = nextId++;
      const response = await fetchImplementation(gateway.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gateway.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args ?? {} },
        }),
        signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Gallery MCP request for ${name} failed with status ${response.status}`);
      }

      let envelope;
      try {
        envelope = text.length === 0 ? {} : JSON.parse(text);
      } catch (error) {
        throw new Error(`Invalid Gallery MCP JSON-RPC response for ${name}`);
      }

      if (envelope?.error) {
        const code = envelope.error.code === undefined ? 'unknown' : envelope.error.code;
        throw new Error(`Gallery MCP JSON-RPC error ${code} for ${name}`);
      }

      return parseGalleryMcpToolResult(envelope?.result, name);
    },
  };
};

const textPromptFromContent = (content) =>
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

const assistantTextFromSession = (session) => {
  const completedText = session.getLastAssistantText?.();
  if (typeof completedText === 'string' && completedText.length > 0) {
    return completedText;
  }

  return assistantTextFromMessages(session.messages);
};

const assistantErrorFromSession = (session) => {
  const assistant = [...(session.messages ?? [])].reverse().find((message) => message?.role === 'assistant');
  if (assistant?.stopReason !== 'error') {
    return undefined;
  }

  return typeof assistant.errorMessage === 'string' && assistant.errorMessage.length > 0
    ? assistant.errorMessage
    : 'Provider request failed';
};

const parseJsonObject = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const findApprovalRequiredToolCallId = (value) => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (value.status === 'approval-required' && typeof value.toolCall?.id === 'string') {
    return value.toolCall.id;
  }

  if (typeof value.text === 'string') {
    const parsed = parseJsonObject(value.text);
    const parsedToolCallId = findApprovalRequiredToolCallId(parsed);
    if (parsedToolCallId) {
      return parsedToolCallId;
    }
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const itemToolCallId = findApprovalRequiredToolCallId(item);
        if (itemToolCallId) {
          return itemToolCallId;
        }
      }
      continue;
    }

    const childToolCallId = findApprovalRequiredToolCallId(child);
    if (childToolCallId) {
      return childToolCallId;
    }
  }

  return undefined;
};

const galleryToolTurnBudget = 12;
const galleryToolBudgetExceededText =
  'I stopped because this request used too many Gallery tool calls without reaching a safe plan. Narrow the scope, for example to the last 100 uploads, a date range, an album, or a tag, then try again.';

const galleryToolResultPromptBudgetBytes = 16_000;
const compactedGalleryToolTextBudgetBytes = 8_000;

const safeJsonStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

const byteLength = (value) => Buffer.byteLength(value, 'utf8');

const countArray = (value, key) => (Array.isArray(value?.[key]) ? value[key].length : 0);

const searchToolNames = new Set(['searchAssets', 'mcp_gallery_searchAssets']);

const resultToolName = (toolResult) =>
  typeof toolResult?.toolCall?.toolName === 'string'
    ? toolResult.toolCall.toolName
    : typeof toolResult?.toolName === 'string'
      ? toolResult.toolName
      : undefined;

const isSearchAssetsToolResult = (toolResult) => searchToolNames.has(resultToolName(toolResult));

const countNestedAssetItems = (toolResult) =>
  Array.isArray(toolResult?.assets?.items)
    ? toolResult.assets.items.length
    : Array.isArray(toolResult?.assets)
      ? toolResult.assets.length
      : 0;

const containsLegacySearchAssetPayload = (toolResult) =>
  isSearchAssetsToolResult(toolResult) &&
  (Array.isArray(toolResult?.assetIds) || countNestedAssetItems(toolResult) > 0);

const shouldCompactGalleryToolResult = (toolResult, serialized, force) =>
  force ||
  containsLegacySearchAssetPayload(toolResult) ||
  !serialized ||
  byteLength(serialized) > galleryToolResultPromptBudgetBytes;

const sampleIds = (items) =>
  Array.isArray(items)
    ? items
        .map((item) => (typeof item === 'string' ? item : item?.id))
        .filter((id) => typeof id === 'string')
        .slice(0, 10)
    : [];

const compactResultSize = (resultSize) => {
  if (!resultSize || typeof resultSize !== 'object') {
    return undefined;
  }

  return {
    returnedItems:
      Number.isInteger(resultSize.returnedItems) && resultSize.returnedItems >= 0 ? resultSize.returnedItems : 0,
    hasMore: resultSize.hasMore === true,
    nextPage: typeof resultSize.nextPage === 'string' ? resultSize.nextPage.slice(0, 80) : null,
    estimatedBytes:
      Number.isInteger(resultSize.estimatedBytes) && resultSize.estimatedBytes >= 0 ? resultSize.estimatedBytes : null,
    truncated: resultSize.truncated === true,
    omittedFields: Array.isArray(resultSize.omittedFields)
      ? resultSize.omittedFields
          .filter((field) => typeof field === 'string')
          .map((field) => field.slice(0, 80))
          .slice(0, 20)
      : [],
  };
};

const compactSelectionHandle = (selectionHandle) => {
  if (!selectionHandle || typeof selectionHandle !== 'object') {
    return undefined;
  }

  return {
    id: typeof selectionHandle.id === 'string' ? selectionHandle.id : undefined,
    sourceRef: typeof selectionHandle.sourceRef === 'string' ? selectionHandle.sourceRef.slice(0, 160) : undefined,
    assetCount:
      Number.isInteger(selectionHandle.assetCount) && selectionHandle.assetCount >= 0
        ? selectionHandle.assetCount
        : undefined,
    sourceToolCallId:
      typeof selectionHandle.sourceToolCallId === 'string' ? selectionHandle.sourceToolCallId : undefined,
    expiresAt: typeof selectionHandle.expiresAt === 'string' ? selectionHandle.expiresAt : undefined,
  };
};

const compactOperationIds = (toolResult) => {
  if (Array.isArray(toolResult?.operationIds)) {
    return toolResult.operationIds.filter((id) => typeof id === 'string');
  }

  const operations = Array.isArray(toolResult?.operations)
    ? toolResult.operations
    : Array.isArray(toolResult?.plan?.operations)
      ? toolResult.plan.operations
      : [];

  return operations.map((operation) => operation?.id).filter((id) => typeof id === 'string');
};

const compactOperationCount = (toolResult, operationIds) => {
  if (Number.isInteger(toolResult?.operationCount) && toolResult.operationCount >= 0) {
    return toolResult.operationCount;
  }

  if (Number.isInteger(toolResult?.plan?.operationCount) && toolResult.plan.operationCount >= 0) {
    return toolResult.plan.operationCount;
  }

  if (Array.isArray(toolResult?.operations)) {
    return toolResult.operations.length;
  }

  if (Array.isArray(toolResult?.plan?.operations)) {
    return toolResult.plan.operations.length;
  }

  return operationIds.length;
};

const isGalleryToolResult = (value) =>
  value &&
  typeof value === 'object' &&
  typeof value.status === 'string' &&
  (value.toolCall || value.resultSize || typeof value.summary === 'string');

const countGalleryToolResults = (value) => {
  if (!value || typeof value !== 'object') {
    return 0;
  }

  if (typeof value.text === 'string') {
    const parsed = parseJsonObject(value.text);
    if (parsed) {
      return countGalleryToolResults(parsed);
    }
  }

  let count = isGalleryToolResult(value) ? 1 : 0;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        count += countGalleryToolResults(item);
      }
      continue;
    }

    count += countGalleryToolResults(child);
  }

  return count;
};

const galleryToolBudgetExceeded = (messages) =>
  messages.reduce((count, message) => count + (message?.role === 'tool' ? countGalleryToolResults(message) : 0), 0) >
  galleryToolTurnBudget;

const appendOpenGuardrailTranscript = (session, text, { model } = {}) => {
  if (Array.isArray(session.messages)) {
    session.messages.push(syntheticAssistantMessage({ text, model }));
  }
};

const compactToolSummary = (toolResult, resultSize, counts) => {
  const toolName = typeof toolResult?.toolCall?.toolName === 'string' ? ` ${toolResult.toolCall.toolName}` : '';
  const status = typeof toolResult?.status === 'string' ? toolResult.status : 'success';
  const returnedItems =
    resultSize?.returnedItems ??
    counts.assets ??
    counts.albums ??
    counts.spaces ??
    counts.users ??
    counts.operationIds ??
    0;
  const itemText = returnedItems > 0 ? ` ${returnedItems} item${returnedItems === 1 ? '' : 's'}` : '';
  return `Gallery${toolName} result (${status}) was compacted before continuing.${itemText}`;
};

export const compactGalleryToolResultForPrompt = (toolResult, { force = false } = {}) => {
  const serialized = safeJsonStringify(toolResult);
  if (!shouldCompactGalleryToolResult(toolResult, serialized, force)) {
    return toolResult;
  }

  if (!toolResult || typeof toolResult !== 'object') {
    return {
      status: 'success',
      compacted: true,
      summary: 'Gallery returned a non-object tool result that was compacted before continuing.',
      omittedDetailInstruction:
        'Detailed rows were omitted. If more detail is needed, call the smallest Gallery MCP read tool for specific ids and fields.',
    };
  }

  const resultSize = toolResult.resultSize ?? toolResult.toolCall?.resultSize;
  const compactedResultSize = compactResultSize(resultSize);
  const operationIds = compactOperationIds(toolResult);
  const operationCount = compactOperationCount(toolResult, operationIds);
  const assetCount =
    Number.isInteger(toolResult?.selectionHandle?.assetCount) && toolResult.selectionHandle.assetCount >= 0
      ? toolResult.selectionHandle.assetCount
      : countArray(toolResult, 'assets') || countArray(toolResult, 'assetIds') || countNestedAssetItems(toolResult);
  const counts = {
    assets: assetCount,
    albums: countArray(toolResult, 'albums') || countArray(toolResult, 'albumIds'),
    spaces: countArray(toolResult, 'spaces') || countArray(toolResult, 'spaceIds'),
    users: countArray(toolResult, 'users') || countArray(toolResult, 'userIds'),
    operationIds: operationCount,
  };

  const planId =
    typeof toolResult.planId === 'string'
      ? toolResult.planId
      : typeof toolResult.plan?.id === 'string'
        ? toolResult.plan.id
        : undefined;

  return {
    status: toolResult.status,
    summary: compactToolSummary(toolResult, compactedResultSize, counts),
    compacted: true,
    compactedReason: 'Large Gallery tool result exceeded runner prompt budget.',
    toolCall: toolResult.toolCall
      ? {
          id: toolResult.toolCall.id,
          toolName: toolResult.toolCall.toolName,
          status: toolResult.toolCall.status,
          resultSize: compactResultSize(toolResult.toolCall.resultSize),
        }
      : undefined,
    resultSize: compactedResultSize,
    counts,
    ids: {
      albumIdsSample: sampleIds(toolResult.albumIds ?? toolResult.albums),
      spaceIdsSample: sampleIds(toolResult.spaceIds ?? toolResult.spaces),
      userIdsSample: sampleIds(toolResult.userIds ?? toolResult.users),
      operationIdsSample: operationIds.slice(0, 10),
    },
    selectionHandle: compactSelectionHandle(toolResult.selectionHandle),
    plan: planId ? { planId, operationCount } : undefined,
    omittedDetailInstruction:
      'Detailed rows were omitted. Continue with returned selection handles, source refs, counts, or the smallest Gallery MCP read tool for specific non-search assets when required.',
  };
};

export const compactGalleryToolTranscript = (session) => {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (const message of messages) {
    if (message?.role !== 'tool' || !Array.isArray(message.content)) {
      continue;
    }

    for (const block of message.content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') {
        continue;
      }

      const parsed = parseJsonObject(block.text);
      if (!isGalleryToolResult(parsed)) {
        continue;
      }

      const serialized = safeJsonStringify(parsed);
      if (!shouldCompactGalleryToolResult(parsed, serialized, false)) {
        continue;
      }

      const compacted = compactGalleryToolResultForPrompt(parsed, { force: true });
      const compactedText = safeJsonStringify(compacted);
      block.text =
        compactedText && byteLength(compactedText) <= compactedGalleryToolTextBudgetBytes
          ? compactedText
          : JSON.stringify({
              status: parsed.status,
              summary: 'Gallery tool result was compacted before continuing.',
              compacted: true,
              toolCall: compacted.toolCall,
              resultSize: compacted.resultSize,
              omittedDetailInstruction: compacted.omittedDetailInstruction,
            });
    }
  }
};

const newMessagesSince = (session, startLength) => {
  const messages = session.messages ?? [];
  return Array.isArray(messages) ? messages.slice(startLength) : [];
};

const approvalResumePrompt = ({ toolCallId, approvalDecision, toolResult }) => {
  if (!toolCallId || !approvalDecision) {
    return undefined;
  }

  if (approvalDecision === 'approved') {
    if (toolResult !== undefined) {
      const compactedToolResult = compactGalleryToolResultForPrompt(toolResult);
      return [
        'This is an internal Gallery resume instruction, not a new user request.',
        `The previous approval-required response for Gallery tool call ${toolCallId} is obsolete.`,
        `The user approved Gallery tool call ${toolCallId}, and Gallery already executed it successfully.`,
        `Use this compact approved tool result summary as authoritative data to continue the user's original request: ${safeJsonStringify(compactedToolResult) ?? JSON.stringify(compactGalleryToolResultForPrompt(undefined, { force: true }))}.`,
        'If the summary says fields were omitted and the original request needs them, call the smallest Gallery MCP read tool for specific ids and fields.',
        'Do not mention pending approval or ask for approval again for this same tool result.',
        'If the original request still needs album details after mcp_gallery_listAlbums, find the matching album id in the approved result and call mcp_gallery_readAlbum. If it needs asset metadata or search, call the next appropriate Gallery MCP read tool.',
      ].join(' ');
    }

    return [
      'This is an internal Gallery resume instruction, not a new user request.',
      `The previous approval-required response for Gallery tool call ${toolCallId} is obsolete.`,
      `The user approved Gallery tool call ${toolCallId}.`,
      `Continue the user's request by calling the same Gallery MCP tool again with toolCallId "${toolCallId}" to execute the approved request.`,
      'Do not mention pending approval or ask for approval again.',
    ].join(' ');
  }

  return [
    `The user denied Gallery tool call ${toolCallId}.`,
    'Continue the conversation without using the denied data, and explain briefly if the task cannot be completed.',
  ].join(' ');
};

const sanitizedErrorMessage = (error, secret) => {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecret(message || 'Provider request failed', secret);
};

const contextWindowErrorPattern =
  /(context window|context length|maximum context|input exceeds|too many tokens|token limit)/i;
const compactionErrorPattern = /(compaction|summarization).*(failed|refused|rejected)/i;

const actionableRunnerErrorMessage = (message) => {
  if (contextWindowErrorPattern.test(message) || compactionErrorPattern.test(message)) {
    return 'The assistant hit the model context limit while processing Gallery data. Narrow the request or inspect fewer photos at a time.';
  }

  return message;
};

const sanitizedErrorMessageWithSecrets = (error, secrets) => {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = redactSecrets(message || 'Provider request failed', secrets);
  return actionableRunnerErrorMessage(redacted);
};

const sanitizeSessionError = (error, entry) =>
  sanitizedErrorMessageWithSecrets(error, [entry.credentialSecret, entry.mcpToken]);

const zeroUsage = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  }),
});

const syntheticAssistantMessage = ({ text, model }) => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'openai-responses',
  provider: 'openai',
  model: model ?? 'unknown',
  usage: zeroUsage,
  stopReason: 'stop',
  timestamp: Date.now(),
});

const syntheticUserMessage = (text) => ({
  role: 'user',
  content: [{ type: 'text', text }],
  timestamp: Date.now(),
});

const appendStrictWorkflowTranscript = (session, prompt, assistantText, { model } = {}) => {
  if (!Array.isArray(session.messages)) {
    return;
  }

  if (prompt) {
    session.messages.push(syntheticUserMessage(prompt));
  }
  if (assistantText) {
    session.messages.push(syntheticAssistantMessage({ text: assistantText, model }));
  }
};

const strictCompletedEvent = ({ gallerySessionId, runnerSessionId, text }) => ({
  type: 'assistant-message-completed',
  sessionId: gallerySessionId,
  runnerSessionId,
  providerMessageId: null,
  content: { blocks: [{ type: 'text', text }] },
});

const strictApprovalEvent = ({ gallerySessionId, runnerSessionId, toolCallId }) => ({
  type: 'tool-approval-needed',
  sessionId: gallerySessionId,
  runnerSessionId,
  toolCallId,
});

const strictWorkflowStateEvent = ({ gallerySessionId, runnerSessionId, workflowState }) => ({
  type: 'workflow-state-update',
  sessionId: gallerySessionId,
  runnerSessionId,
  workflowState: workflowState ?? null,
});

// Observability (Slice 6): the dispatcher's `observe(event)` events ride the
// existing `activity` runner-event channel so the server projects them into the
// debug/audit `agent_session_activity_event` table. They are NOT user chat and
// never become assistant messages. We also write a structured JSON log line so
// router recall and the success gate are measurable from logs alone.
//
// Activity summaries are scrubbed, bounded key=value strings — never prompts,
// ids, or raw summaries. A planId is reported as present/missing, never echoed.
const STRICT_OBSERVE_KINDS = new Set([
  'strict_router_decision',
  'strict_workflow_outcome',
  'strict_success_gate_block',
  'strict_continuation',
]);

const strictObserveStatus = (event) => {
  if (event.kind === 'strict_success_gate_block') {
    return 'failed';
  }
  if (event.kind === 'strict_workflow_outcome' && event.status === 'failed') {
    return 'failed';
  }
  if (event.kind === 'strict_workflow_outcome' && event.fellBackToOpen) {
    return 'skipped';
  }
  return 'completed';
};

const strictObserveSummary = (event) => {
  const parts = [];
  const push = (key, value) => {
    if (value !== undefined && value !== null) {
      parts.push(`${key}=${value}`);
    }
  };

  switch (event.kind) {
    case 'strict_router_decision': {
      push('matched', event.matched);
      push('workflow', event.workflowKind);
      push('via', event.via);
      push('confidence', event.confidence);
      push('latencyMs', event.latencyMs);
      break;
    }
    case 'strict_workflow_outcome': {
      push('workflow', event.workflowKind);
      push('status', event.status);
      push('planId', event.planId ? 'present' : 'missing');
      push('fellBackToOpen', event.fellBackToOpen);
      break;
    }
    case 'strict_success_gate_block': {
      push('workflow', event.workflowKind);
      parts.push('blocked=missing-planId');
      break;
    }
    case 'strict_continuation': {
      push('resumed', event.resumed);
      push('expired', event.expired);
      push('missing', event.missing);
      break;
    }
    default: {
      break;
    }
  }

  const summary = parts.join(' ');
  return summary.length > 0 ? summary.slice(0, 240) : undefined;
};

const strictObserveActivityEvent = ({ gallerySessionId, runnerSessionId, event }) => {
  const activityEvent = {
    type: 'activity',
    sessionId: gallerySessionId,
    runnerSessionId,
    kind: event.kind,
    status: strictObserveStatus(event),
  };
  const summary = strictObserveSummary(event);
  if (summary) {
    activityEvent.summary = summary;
  }
  return activityEvent;
};

// Per-turn observe sink: writes a structured JSON log line and emits the
// activity-shaped runner event so the server can persist it. `emit` pushes into
// the active turn's strict event buffer.
const createStrictObserve = ({ gallerySessionId, runnerSessionId, emit, log = console }) => (event) => {
  if (!event || typeof event.kind !== 'string' || !STRICT_OBSERVE_KINDS.has(event.kind)) {
    return;
  }

  try {
    log.info?.(JSON.stringify({ msg: 'strict_workflow_observability', gallerySessionId, ...event }));
  } catch {
    // Observability logging must never break the turn.
  }

  emit(strictObserveActivityEvent({ gallerySessionId, runnerSessionId, event }));
};

// Durability (Slice 5): the server is the source of truth for pendingWorkflow.
// A request's workflowState always wins over a stale in-memory Map value so a
// fresh runtime (or a second instance) rehydrates the continuation/approval
// state before routing the turn.
const seedPendingWorkflow = (entry, workflowState) => {
  if (workflowState !== undefined) {
    entry.pendingWorkflow = workflowState ?? undefined;
  }
};

const createMcpSessionWorkspace = async (gallerySessionId) => {
  const sessionHash = createHash('sha256').update(String(gallerySessionId)).digest('hex').slice(0, 24);
  const workspace = join(runtimeSessionRoot, `${sessionHash}-${randomUUID()}`);
  const homeDir = join(workspace, 'home');
  await mkdir(join(workspace, '.pi'), { recursive: true });
  await mkdir(join(homeDir, '.pi/agent'), { recursive: true });
  return { workspace, homeDir };
};

const writeMcpConfig = async ({ workspace, gateway }) => {
  const config = {
    mcpServers: {
      gallery: {
        transport: 'streamable-http',
        lifecycle: 'eager',
        url: gateway.url,
        headers: { Authorization: `Bearer ${gateway.token}` },
      },
    },
  };
  await writeFile(join(workspace, '.pi/mcp.json'), `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
};

const readActiveToolNames = (session) => {
  if (typeof session.getActiveToolNames === 'function') {
    return session.getActiveToolNames();
  }

  if (typeof session.getActiveTools === 'function') {
    return session.getActiveTools();
  }

  return [];
};

const galleryMcpToolNamesFromSession = (session) =>
  readActiveToolNames(session).filter((toolName) => typeof toolName === 'string' && toolName.startsWith('mcp_gallery_'));

const runWithMcpEnvironment = async (mcpRuntime, operation) => {
  if (!mcpRuntime) {
    return operation();
  }

  const previous = mcpEnvironmentQueue.catch(() => {});
  let releaseQueue;
  mcpEnvironmentQueue = previous.then(
    () =>
      new Promise((resolve) => {
        releaseQueue = resolve;
      }),
  );
  await previous;

  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalCwd = process.cwd();
  try {
    process.env.HOME = mcpRuntime.homeDir;
    process.env.USERPROFILE = mcpRuntime.homeDir;
    process.chdir(mcpRuntime.workspace);
    return await operation();
  } finally {
    process.chdir(originalCwd);
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    releaseQueue();
  }
};

const createOpenAiCompatibleProviderFactories = ({ providerName, credential, model }) => {
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

const applyPendingProviderRegistrations = (resourceLoader, modelRegistry) => {
  const extensionsResult = resourceLoader.getExtensions?.();
  const pendingRegistrations = extensionsResult?.runtime?.pendingProviderRegistrations ?? [];

  for (const { name, config, extensionPath } of pendingRegistrations) {
    try {
      modelRegistry.registerProvider(name, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Extension "${extensionPath}" error: ${message}`);
    }
  }

  if (extensionsResult?.runtime) {
    extensionsResult.runtime.pendingProviderRegistrations = [];
  }
};

export const createPiRuntime = ({
  sdk = defaultDependencies.sdk,
  ai = defaultDependencies.ai,
  fetch: fetchImplementation = fetch,
  now = () => Date.now(),
  // Router mode: 'regex' | 'llm' | 'hybrid'. Default 'hybrid' (regex fast-path →
  // LLM classify). Ops/tests can force 'regex' to disable the LLM path
  // deterministically. (`routerModel` override is reserved, not implemented.)
  routerMode = process.env.STRICT_ROUTER_MODE ?? 'hybrid',
  // Copy mode: 'template' (default) reproduces today's deterministic success
  // strings exactly; opt-in 'llm-polish' lets the session model REPHRASE only
  // the scrubbed success summary (never the success/failure decision). Default
  // behavior — and every existing test — stays identical to today.
  copyMode = process.env.STRICT_COPY_MODE ?? 'template',
  // Optional structured logger for observability events; defaults to console.
  log = console,
} = {}) => {
  const sessions = new Map();
  const createSessionQueues = new Map();

  const runSerializedCreateSession = async (runnerSessionId, operation) => {
    const previous = createSessionQueues.get(runnerSessionId) ?? Promise.resolve();
    let releaseQueue;
    const queueEntry = new Promise((resolve) => {
      releaseQueue = resolve;
    });
    const current = previous.catch(() => {}).then(() => queueEntry);
    createSessionQueues.set(runnerSessionId, current);
    await previous.catch(() => {});

    try {
      return await operation();
    } finally {
      releaseQueue();
      if (createSessionQueues.get(runnerSessionId) === current) {
        createSessionQueues.delete(runnerSessionId);
      }
    }
  };

  return {
    async createSession(body) {
      const runnerSessionId = `pi-${body.gallerySessionId}`;
      return runSerializedCreateSession(runnerSessionId, async () => {
        let sessionWorkspace;
        let newSession;
        try {
          const providerName = mapProviderType(body.credential.providerType, body.gallerySessionId);
          const authStorage = sdk.AuthStorage.inMemory ? sdk.AuthStorage.inMemory() : sdk.AuthStorage.create();
          authStorage.setRuntimeApiKey(providerName, body.credential.secret);

          const modelRegistry = sdk.ModelRegistry.inMemory
            ? sdk.ModelRegistry.inMemory(authStorage)
            : sdk.ModelRegistry.create(authStorage);
          const settingsManager = sdk.SettingsManager.inMemory({
            compaction: { enabled: true },
          });
          const extensionFactories = createOpenAiCompatibleProviderFactories({
            providerName,
            credential: body.credential,
            model: body.model,
          });
          const mcpGateway = body.mcpGateway ?? null;
          const mcpRuntime = mcpGateway ? await createMcpSessionWorkspace(body.gallerySessionId) : null;
          if (mcpRuntime) {
            sessionWorkspace = mcpRuntime.workspace;
            await writeMcpConfig({ workspace: mcpRuntime.workspace, gateway: mcpGateway });
          }
          const resourceLoader = new sdk.DefaultResourceLoader({
            cwd: mcpRuntime?.workspace ?? runtimePackageRoot,
            agentDir: runtimeAgentDir,
            homeDir: mcpRuntime?.homeDir,
            settingsManager,
            systemPrompt,
            appendSystemPrompt: [],
            noContextFiles: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noExtensions: true,
            additionalExtensionPaths: mcpGateway ? [resolvePiMcpExtensionPath()] : [],
            extensionFactories,
          });

          await runWithMcpEnvironment(mcpRuntime, () => resourceLoader.reload());
          applyPendingProviderRegistrations(resourceLoader, modelRegistry);

          const model = ai.getModel(providerName, body.model) ?? modelRegistry.find(providerName, body.model);
          if (!model) {
            throw new Error(`Model ${body.model} is not available for provider ${providerName}`);
          }

          // Build the per-session intent classifier behind the registry's
          // `classify`. It reuses the session model handle + credential — no
          // second auth path. Tests inject `ai.classifyIntent`; production uses
          // the real one-shot `complete()` adapter. The classifier never throws
          // into the runtime; uncertainty falls through to open orchestration.
          const classifyIntent =
            typeof ai.classifyIntent === 'function'
              ? ai.classifyIntent
              : createPiClassifyIntent({ ai, apiKey: body.credential.secret });
          const baseWorkflows = createWorkflowRegistry().listWorkflows();
          const classifier = createIntentClassifier({
            getModel: () => model,
            classifyIntent,
            manifest: WORKFLOW_MANIFEST,
            workflows: baseWorkflows,
            mode: routerMode,
          });
          const registry = createWorkflowRegistry({ classifier });

          // Tool-free copy rephraser for `copyMode: 'llm-polish'`. Tests may
          // inject `ai.polishCopy`; production builds one from the session model
          // handle. Only ever called by `renderCopy` with a scrubbed summary.
          const polishCopy =
            typeof ai.polishCopy === 'function'
              ? ai.polishCopy
              : createPiPolishCopy({ ai, getModel: () => model, apiKey: body.credential.secret });

          // Per-session observe sink holder. The dispatcher's `observe` delegates
          // to the active turn's sink (set in sendMessage/resumeSession) so each
          // observability event is logged and emitted on the right stream.
          const observeHolder = { current: () => {} };

          const { session } = await sdk.createAgentSession({
            cwd: mcpRuntime?.workspace ?? runtimePackageRoot,
            agentDir: runtimeAgentDir,
            model,
            authStorage,
            modelRegistry,
            sessionManager: sdk.SessionManager.inMemory(),
            settingsManager,
            resourceLoader,
            noTools: 'builtin',
            ...(mcpGateway ? {} : { tools: [] }),
          });
          newSession = session;

          const activeGalleryMcpToolNames = mcpGateway
            ? await runWithMcpEnvironment(mcpRuntime, () =>
                Promise.resolve(session.bindExtensions?.({})).then(() => galleryMcpToolNamesFromSession(session)),
              )
            : [];
          if (mcpGateway && activeGalleryMcpToolNames.length === 0) {
            throw new Error('No active Gallery MCP tools after extension startup');
          }

          const existingEntry = sessions.get(runnerSessionId);
          try {
            await this.disposeSession(runnerSessionId);
          } catch (error) {
            try {
              await session.dispose?.();
              newSession = undefined;
            } catch {
              // Preserve the replacement failure that prevented the new session from becoming owned by the runtime.
            }

            throw new Error(
              sanitizedErrorMessageWithSecrets(error, [
                body.credential.secret,
                body.mcpGateway?.token,
                existingEntry?.credentialSecret,
                existingEntry?.mcpToken,
              ]),
            );
          }
          sessions.set(runnerSessionId, {
            gallerySessionId: body.gallerySessionId,
            credentialSecret: body.credential.secret,
            mcpToken: mcpGateway?.token,
            mcpGateway,
            sessionWorkspace,
            model: body.model,
            session,
            inFlight: false,
            abortActiveStream: undefined,
            unsubscribe: undefined,
            pendingWorkflow: body.workflowState ?? undefined,
            observeHolder,
            dispatcher: mcpGateway
              ? createWorkflowDispatcher({
                  registry,
                  buildClient: () => createGalleryMcpClient({ gateway: mcpGateway, fetch: fetchImplementation }),
                  now,
                  copyMode,
                  polish: polishCopy,
                  observe: (event) => observeHolder.current(event),
                })
              : undefined,
          });

          return {
            runnerSessionId,
            capabilities: {
              protocolVersion,
              streaming: true,
              tools: activeGalleryMcpToolNames,
              models: [body.model],
              runtime: 'pi',
            },
          };
        } catch (error) {
          try {
            await newSession?.dispose?.();
          } catch {
            // Preserve the startup error that prevented session ownership.
          }
          if (sessionWorkspace) {
            await rm(sessionWorkspace, { recursive: true, force: true });
          }
          throw new Error(sanitizedErrorMessageWithSecrets(error, [body?.credential?.secret, body?.mcpGateway?.token]));
        }
      });
    },

    async *sendMessage({ runnerSessionId, gallerySessionId, messageId: _messageId, content, workflowState }) {
      const entry = sessions.get(runnerSessionId);
      if (!entry || entry.gallerySessionId !== gallerySessionId) {
        throw new Error('Runner session not found; start a new assistant chat to reconnect.');
      }
      if (entry.inFlight) {
        throw new Error('Runner session already has an active message stream');
      }
      entry.inFlight = true;
      seedPendingWorkflow(entry, workflowState);
      const promptText = textPromptFromContent(content);

      if (entry.mcpGateway) {
        const strictAbortController = new AbortController();
        const abortStrictStream = () => {
          strictAbortController.abort();
        };
        entry.abortActiveStream = abortStrictStream;
        const strictEvents = [];
        entry.observeHolder.current = createStrictObserve({
          gallerySessionId,
          runnerSessionId,
          emit: (event) => strictEvents.push(event),
          log,
        });
        try {
          const dispatch = await entry.dispatcher.routeTurn({
            prompt: promptText,
            signal: strictAbortController.signal,
            emit: (event) => strictEvents.push(event),
            appendTranscript: (prompt, assistantText) =>
              appendStrictWorkflowTranscript(entry.session, prompt, assistantText, { model: entry.model }),
            getPending: () => entry.pendingWorkflow,
            setPending: (next) => {
              entry.pendingWorkflow = next;
            },
            completedEvent: ({ text }) => strictCompletedEvent({ gallerySessionId, runnerSessionId, text }),
            approvalEvent: ({ toolCallId }) => strictApprovalEvent({ gallerySessionId, runnerSessionId, toolCallId }),
            workflowStateEvent: ({ workflowState: nextWorkflowState }) =>
              strictWorkflowStateEvent({ gallerySessionId, runnerSessionId, workflowState: nextWorkflowState }),
          });
          if (dispatch.handled) {
            yield* strictEvents;
            return;
          }
        } catch (error) {
          yield {
            type: 'runner-error',
            sessionId: gallerySessionId,
            runnerSessionId,
            message: sanitizeSessionError(error, entry),
          };
          return;
        } finally {
          entry.observeHolder.current = () => {};
          if (entry.abortActiveStream === abortStrictStream) {
            entry.abortActiveStream = undefined;
          }
          entry.inFlight = false;
        }
        // Not handled by a strict/hybrid workflow: fall through to provider orchestration.
        entry.inFlight = true;
      }

      let sequence = 0;
      const pendingEvents = [];
      let wake;
      let finished = false;
      let aborted = false;
      let promptSettled = false;
      let abortPromise;

      const enqueue = (event) => {
        pendingEvents.push(event);
        wake?.();
        wake = undefined;
      };
      const abortActiveStream = ({ emitError } = { emitError: true }) => {
        if (aborted) {
          return abortPromise;
        }

        aborted = true;
        abortPromise = Promise.resolve()
          .then(() => {
            if (entry.session.abort) {
              return entry.session.abort();
            }

            return entry.session.agent?.abort?.();
          })
          .finally(() => {
            if (emitError) {
              enqueue({
                type: 'runner-error',
                sessionId: gallerySessionId,
                runnerSessionId,
                message: 'Runner session disposed',
              });
              finished = true;
            }
            wake?.();
            wake = undefined;
          });
        return abortPromise;
      };

      let unsubscribe;
      let subscribed = false;
      const releaseSubscription = () => {
        if (!subscribed) {
          return;
        }

        subscribed = false;
        unsubscribe();
      };

      try {
        unsubscribe = entry.session.subscribe((event) => {
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
        subscribed = true;
      } catch (error) {
        entry.inFlight = false;
        throw new Error(sanitizeSessionError(error, entry));
      }

      entry.unsubscribe = releaseSubscription;
      entry.abortActiveStream = abortActiveStream;
      let promptPromise;
      const messageStartLength = Array.isArray(entry.session.messages) ? entry.session.messages.length : 0;

      try {
        promptPromise = Promise.resolve()
          .then(() => {
            compactGalleryToolTranscript(entry.session);
            return entry.session.prompt(promptText);
          })
          .then(() => {
            if (aborted) {
              return;
            }

            const assistantError = assistantErrorFromSession(entry.session);
            if (assistantError) {
              enqueue({
                type: 'runner-error',
                sessionId: gallerySessionId,
                runnerSessionId,
                message: sanitizeSessionError(assistantError, entry),
              });
              return;
            }

            const newMessages = newMessagesSince(entry.session, messageStartLength);
            const approvalRequiredToolCallId = findApprovalRequiredToolCallId(newMessages);
            if (approvalRequiredToolCallId) {
              enqueue({
                type: 'tool-approval-needed',
                sessionId: gallerySessionId,
                runnerSessionId,
                toolCallId: approvalRequiredToolCallId,
              });
              return;
            }

            if (galleryToolBudgetExceeded(newMessages)) {
              appendOpenGuardrailTranscript(entry.session, galleryToolBudgetExceededText, { model: entry.model });
              enqueue({
                type: 'assistant-message-completed',
                sessionId: gallerySessionId,
                runnerSessionId,
                providerMessageId: null,
                content: { blocks: [{ type: 'text', text: galleryToolBudgetExceededText }] },
              });
              return;
            }

            enqueue({
              type: 'assistant-message-completed',
              sessionId: gallerySessionId,
              runnerSessionId,
              providerMessageId: null,
              content: { blocks: [{ type: 'text', text: assistantTextFromSession(entry.session) }] },
            });
          })
          .catch((error) => {
            if (aborted) {
              return;
            }

            enqueue({
              type: 'runner-error',
              sessionId: gallerySessionId,
              runnerSessionId,
              message: sanitizeSessionError(error, entry),
            });
          })
          .finally(() => {
            promptSettled = true;
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
        let cleanupError;
        if (!promptSettled) {
          try {
            await abortActiveStream({ emitError: false });
          } catch (error) {
            cleanupError = error;
          }
          try {
            await promptPromise;
          } catch (error) {
            cleanupError ??= error;
          }
        }
        try {
          releaseSubscription();
        } catch (error) {
          cleanupError ??= error;
        }
        entry.inFlight = false;
        if (entry.abortActiveStream === abortActiveStream) {
          entry.abortActiveStream = undefined;
        }
        if (entry.unsubscribe === releaseSubscription) {
          entry.unsubscribe = undefined;
        }
        if (cleanupError) {
          throw new Error(sanitizeSessionError(cleanupError, entry));
        }
      }
    },

    async *resumeSession({ runnerSessionId, gallerySessionId, toolCallId, approvalDecision, toolResult, workflowState }) {
      const entry = sessions.get(runnerSessionId);
      if (!entry || entry.gallerySessionId !== gallerySessionId) {
        throw new Error('Runner session not found; start a new assistant chat to reconnect.');
      }
      if (entry.inFlight) {
        throw new Error('Runner session already has an active message stream');
      }
      entry.inFlight = true;
      seedPendingWorkflow(entry, workflowState);

      if (entry.dispatcher) {
        const strictEvents = [];
        entry.observeHolder.current = createStrictObserve({
          gallerySessionId,
          runnerSessionId,
          emit: (event) => strictEvents.push(event),
          log,
        });
        try {
          const dispatch = await entry.dispatcher.routeApproval({
            toolCallId,
            approvalDecision,
            toolResult,
            emit: (event) => strictEvents.push(event),
            appendTranscript: (prompt, assistantText) =>
              appendStrictWorkflowTranscript(entry.session, prompt, assistantText, { model: entry.model }),
            getPending: () => entry.pendingWorkflow,
            setPending: (next) => {
              entry.pendingWorkflow = next;
            },
            completedEvent: ({ text }) => strictCompletedEvent({ gallerySessionId, runnerSessionId, text }),
            approvalEvent: ({ toolCallId: nextToolCallId }) =>
              strictApprovalEvent({ gallerySessionId, runnerSessionId, toolCallId: nextToolCallId }),
            workflowStateEvent: ({ workflowState: nextWorkflowState }) =>
              strictWorkflowStateEvent({ gallerySessionId, runnerSessionId, workflowState: nextWorkflowState }),
          });
          if (dispatch.handled) {
            yield* strictEvents;
            return;
          }
        } catch (error) {
          yield {
            type: 'runner-error',
            sessionId: gallerySessionId,
            runnerSessionId,
            message: sanitizeSessionError(error, entry),
          };
          return;
        } finally {
          entry.observeHolder.current = () => {};
          entry.inFlight = false;
        }
        // Not a strict approval resume: fall through to the provider continue path.
        entry.inFlight = true;
      }

      let sequence = 0;
      const pendingEvents = [];
      let wake;
      let finished = false;
      let aborted = false;
      let promptSettled = false;
      let abortPromise;

      const enqueue = (event) => {
        pendingEvents.push(event);
        wake?.();
        wake = undefined;
      };
      const abortActiveStream = ({ emitError } = { emitError: true }) => {
        if (aborted) {
          return abortPromise;
        }

        aborted = true;
        abortPromise = Promise.resolve()
          .then(() => {
            if (entry.session.abort) {
              return entry.session.abort();
            }

            return entry.session.agent?.abort?.();
          })
          .finally(() => {
            if (emitError) {
              enqueue({
                type: 'runner-error',
                sessionId: gallerySessionId,
                runnerSessionId,
                message: 'Runner session disposed',
              });
              finished = true;
            }
            wake?.();
            wake = undefined;
          });
        return abortPromise;
      };

      let unsubscribe;
      let subscribed = false;
      const releaseSubscription = () => {
        if (!subscribed) {
          return;
        }

        subscribed = false;
        unsubscribe();
      };

      try {
        unsubscribe = entry.session.subscribe((event) => {
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
        subscribed = true;
      } catch (error) {
        entry.inFlight = false;
        throw new Error(sanitizeSessionError(error, entry));
      }

      entry.unsubscribe = releaseSubscription;
      entry.abortActiveStream = abortActiveStream;
      let promptPromise;
      const resumePrompt = approvalResumePrompt({ toolCallId, approvalDecision, toolResult });
      const messageStartLength = Array.isArray(entry.session.messages) ? entry.session.messages.length : 0;

      try {
        promptPromise = Promise.resolve()
          .then(() => {
            compactGalleryToolTranscript(entry.session);
            if (resumePrompt) {
              return entry.session.prompt(resumePrompt);
            }

            const continueTurn = entry.session.continue ?? entry.session.agent?.continue;
            if (typeof continueTurn !== 'function') {
              throw new Error('Runner session cannot continue after approval');
            }

            return continueTurn.call(entry.session.continue ? entry.session : entry.session.agent);
          })
          .then(() => {
            if (aborted) {
              return;
            }

            const assistantError = assistantErrorFromSession(entry.session);
            if (assistantError) {
              enqueue({
                type: 'runner-error',
                sessionId: gallerySessionId,
                runnerSessionId,
                message: sanitizeSessionError(assistantError, entry),
              });
              return;
            }

            const newMessages = newMessagesSince(entry.session, messageStartLength);
            const approvalRequiredToolCallId = findApprovalRequiredToolCallId(newMessages);
            if (approvalRequiredToolCallId) {
              enqueue({
                type: 'tool-approval-needed',
                sessionId: gallerySessionId,
                runnerSessionId,
                toolCallId: approvalRequiredToolCallId,
              });
              return;
            }

            if (galleryToolBudgetExceeded(newMessages)) {
              appendOpenGuardrailTranscript(entry.session, galleryToolBudgetExceededText, { model: entry.model });
              enqueue({
                type: 'assistant-message-completed',
                sessionId: gallerySessionId,
                runnerSessionId,
                providerMessageId: null,
                content: { blocks: [{ type: 'text', text: galleryToolBudgetExceededText }] },
              });
              return;
            }

            enqueue({
              type: 'assistant-message-completed',
              sessionId: gallerySessionId,
              runnerSessionId,
              providerMessageId: null,
              content: { blocks: [{ type: 'text', text: assistantTextFromSession(entry.session) }] },
            });
          })
          .catch((error) => {
            if (aborted) {
              return;
            }

            enqueue({
              type: 'runner-error',
              sessionId: gallerySessionId,
              runnerSessionId,
              message: sanitizeSessionError(error, entry),
            });
          })
          .finally(() => {
            promptSettled = true;
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
        let cleanupError;
        if (!promptSettled) {
          try {
            await abortActiveStream({ emitError: false });
          } catch (error) {
            cleanupError = error;
          }
          try {
            await promptPromise;
          } catch (error) {
            cleanupError ??= error;
          }
        }
        try {
          releaseSubscription();
        } catch (error) {
          cleanupError ??= error;
        }
        entry.inFlight = false;
        if (entry.abortActiveStream === abortActiveStream) {
          entry.abortActiveStream = undefined;
        }
        if (entry.unsubscribe === releaseSubscription) {
          entry.unsubscribe = undefined;
        }
        if (cleanupError) {
          throw new Error(sanitizeSessionError(cleanupError, entry));
        }
      }
    },

    async disposeSession(runnerSessionId) {
      const entry = sessions.get(runnerSessionId);
      if (!entry) {
        return;
      }

      let cleanupError;
      try {
        await entry.abortActiveStream?.();
      } catch (error) {
        cleanupError = error;
      }
      entry.abortActiveStream = undefined;
      try {
        entry.unsubscribe?.();
      } catch (error) {
        cleanupError ??= error;
      }
      entry.unsubscribe = undefined;
      try {
        await entry.session.dispose?.();
      } catch (error) {
        cleanupError ??= error;
      }
      if (entry.sessionWorkspace) {
        try {
          await rm(entry.sessionWorkspace, { recursive: true, force: true });
        } catch (error) {
          cleanupError ??= error;
        }
      }
      sessions.delete(runnerSessionId);
      if (cleanupError) {
        throw new Error(sanitizedErrorMessageWithSecrets(cleanupError, [entry.credentialSecret, entry.mcpToken]));
      }
    },
  };
};
