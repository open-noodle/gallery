import { createWorkflowDispatcher } from './strict-workflows/dispatcher.mjs';
import { createWorkflowRegistry } from './strict-workflows/registry.mjs';

const protocolVersion = '2026-05-14';
const inaccessibleAssetId = '00000000-0000-4000-8000-000000000014';
const e2eToolNames = ['mcp:gallery'];

export const e2eCapabilities = {
  protocolVersion,
  streaming: true,
  tools: e2eToolNames,
  models: ['e2e-album-organizer'],
  runtime: 'e2e',
};

const getPromptText = (content) =>
  content?.blocks
    ?.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim() ?? '';

const completedEvent = ({ gallerySessionId, runnerSessionId, text }) => ({
  type: 'assistant-message-completed',
  sessionId: gallerySessionId,
  runnerSessionId,
  providerMessageId: 'e2e-provider-message',
  content: { blocks: [{ type: 'text', text }] },
});

const deltaEvent = ({ gallerySessionId, runnerSessionId, text }) => ({
  type: 'assistant-message-delta',
  sessionId: gallerySessionId,
  runnerSessionId,
  delta: text,
  sequence: 1,
});

const toolApprovalNeededEvent = ({ gallerySessionId, runnerSessionId, toolCallId }) => ({
  type: 'tool-approval-needed',
  sessionId: gallerySessionId,
  runnerSessionId,
  toolCallId,
});

const workflowStateUpdateEvent = ({ gallerySessionId, runnerSessionId, workflowState }) => ({
  type: 'workflow-state-update',
  sessionId: gallerySessionId,
  runnerSessionId,
  workflowState: workflowState ?? null,
});

const redactGatewayToken = (message, gateway) => {
  const token = gateway?.token;
  if (!token) {
    return String(message);
  }

  return String(message).split(token).join('[redacted]');
};

const requireMcpGateway = (entry) => {
  if (!entry.mcpGateway) {
    throw new Error('The e2e runner requires a Gallery MCP gateway');
  }

  return entry.mcpGateway;
};

const extractTextContent = (result) =>
  result?.content
    ?.filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim() ?? '';

const parseMcpToolResult = (result, name, gateway) => {
  if (result?.isError) {
    const message = extractTextContent(result) || `MCP tool ${name} returned an error`;
    throw new Error(redactGatewayToken(message, gateway));
  }

  if (result?.structuredContent !== undefined) {
    return result.structuredContent;
  }

  const text = extractTextContent(result);
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactGatewayToken(`Invalid MCP tool result JSON for ${name}: ${message}: ${text}`, gateway));
  }
};

const compactAssetIdsFromResult = (result) => {
  const ids = [];
  const addId = (id) => {
    if (typeof id === 'string' && !ids.includes(id)) {
      ids.push(id);
    }
  };

  if (Array.isArray(result.assetIds)) {
    for (const id of result.assetIds) {
      addId(id);
    }
  }

  for (const fieldName of ['assets', 'sample']) {
    if (!Array.isArray(result[fieldName])) {
      continue;
    }

    for (const asset of result[fieldName]) {
      addId(asset?.id);
    }
  }

  return ids;
};

const createE2eMcpClient = ({ gateway, fetch: fetchImplementation = fetch }) => {
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
        const bodyDetails = text.length === 0 ? '' : `: ${text}`;
        throw new Error(redactGatewayToken(`Gallery MCP request failed with status ${response.status}${bodyDetails}`, gateway));
      }

      let envelope;
      try {
        envelope = text.length === 0 ? {} : JSON.parse(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(redactGatewayToken(`Invalid Gallery MCP JSON-RPC response: ${message}: ${text}`, gateway));
      }

      if (envelope?.error) {
        const code = envelope.error.code === undefined ? 'unknown' : envelope.error.code;
        const message = envelope.error.message ?? JSON.stringify(envelope.error);
        throw new Error(redactGatewayToken(`Gallery MCP JSON-RPC error ${code}: ${message}`, gateway));
      }

      return parseMcpToolResult(envelope?.result, name, gateway);
    },
  };
};

const requireSearchSelectionHandle = async (client) => {
  const result = await client.call('searchAssets', { filters: { isNotInAlbum: true }, limit: 3, detail: 'handle' });
  if (result.status !== 'success') {
    throw new Error(`Asset search did not complete successfully: ${result.status}`);
  }

  const handle = result.selectionHandle;
  if (typeof handle?.id !== 'string' || handle.id.length === 0) {
    throw new Error('Asset search did not return a selection handle');
  }

  const assetCount = typeof handle.assetCount === 'number' ? handle.assetCount : (result.returnedCount ?? 0);
  if (assetCount < 2) {
    throw new Error('The e2e runner needs at least two visible loose assets');
  }

  return handle.id;
};

const requireCoverSelectionHandle = async (client, selectionHandleId) => {
  const result = await client.call('curateSelection', {
    selectionHandleId,
    targetCount: 1,
    strategy: 'cover-candidate',
    sampleSize: 0,
  });
  if (result.status !== 'success') {
    throw new Error(`Cover selection did not complete successfully: ${result.status}`);
  }

  const handle = result.selectionHandle;
  if (typeof handle?.id !== 'string' || handle.id.length === 0) {
    throw new Error('Cover selection did not return a selection handle');
  }

  const selectedAssetCount =
    typeof result.selectedAssetCount === 'number' ? result.selectedAssetCount : (handle.assetCount ?? 0);
  if (selectedAssetCount < 1) {
    throw new Error('Cover selection did not find an eligible image');
  }

  return handle.id;
};

const searchSelectionSourceRef = async (client, args) => {
  const result = await client.call('searchAssets', args);
  if (result.status !== 'success') {
    throw new Error(`Asset search did not complete successfully: ${result.status}`);
  }

  const sourceRef = result.selectionHandle?.sourceRef;
  if (typeof sourceRef !== 'string' || sourceRef.length === 0) {
    throw new Error('Asset search did not return a selection handle source reference');
  }

  return sourceRef;
};

const proposeMetadataBatchFromSearch = async (client, { searchArgs, action }) => {
  const sourceRef = await searchSelectionSourceRef(client, searchArgs);
  await client.call('proposeAssetBatchFromSearch', {
    action,
    assetSource: {
      kind: 'previousSearch',
      sourceRef,
    },
  });
};

const proposePortugalTrip = async (client) => {
  const selectionHandleId = await requireSearchSelectionHandle(client);
  const coverSelectionHandleId = await requireCoverSelectionHandle(client, selectionHandleId);
  await client.call('proposeAlbumOperations', {
    summary: 'Create Portugal Trip and add 2 loose assets.',
    operations: [
      {
        type: 'album.create',
        summary: 'Create Portugal Trip',
        targetKind: 'new_album',
        temporaryTargetId: 'portugal-trip',
        riskLevel: 'low',
        enabled: true,
        payload: {
          albumName: 'Portugal Trip',
          description: 'Organized by the deterministic e2e assistant.',
        },
      },
      {
        type: 'album.addAssets',
        summary: 'Add selected photos to Portugal Trip',
        targetKind: 'new_album',
        temporaryTargetId: 'portugal-trip',
        assetSelectionHandleId: selectionHandleId,
        riskLevel: 'medium',
        enabled: true,
        payload: {},
      },
      {
        type: 'album.setCover',
        summary: 'Use first photo as Portugal Trip cover',
        targetKind: 'new_album',
        temporaryTargetId: 'portugal-trip',
        assetSelectionHandleId: coverSelectionHandleId,
        riskLevel: 'low',
        enabled: true,
        payload: {},
      },
    ],
  });
};

const proposeDeniedTrip = async (client) => {
  await client.call('proposeAlbumOperations', {
    summary: 'Denied Trip would use inaccessible assets.',
    operations: [
      {
        type: 'album.create',
        summary: 'Create Denied Trip',
        targetKind: 'new_album',
        temporaryTargetId: 'denied-trip',
        riskLevel: 'low',
        enabled: true,
        payload: {
          albumName: 'Denied Trip',
          description: 'This operation plan is intentionally denied by Gallery.',
        },
      },
      {
        type: 'album.addAssets',
        summary: 'Add inaccessible photo to Denied Trip',
        targetKind: 'new_album',
        temporaryTargetId: 'denied-trip',
        assetSelectionHandleId: inaccessibleAssetId,
        riskLevel: 'high',
        enabled: true,
        payload: {},
      },
    ],
  });
};

const parseMetadataPrompt = (prompt) => {
  const descriptionMatch = prompt.match(
    /^set the description on the (\d+) newest photos to\s+(.+?)\.?$/i,
  );
  if (descriptionMatch) {
    return {
      kind: 'description',
      limit: Number(descriptionMatch[1]),
      description: descriptionMatch[2],
    };
  }

  const latitudeMatch = prompt.match(/\blatitude\s+(-?\d+(?:\.\d+)?)/i);
  const longitudeMatch = prompt.match(/\blongitude\s+(-?\d+(?:\.\d+)?)/i);
  if (latitudeMatch && longitudeMatch) {
    return {
      kind: 'coordinates',
      latitude: Number(latitudeMatch[1]),
      longitude: Number(longitudeMatch[1]),
    };
  }

  if (latitudeMatch) {
    return { kind: 'missing-longitude' };
  }

  if (/^set these photos to\s+.+\.?$/i.test(prompt)) {
    return { kind: 'place-name' };
  }

  return null;
};

const defaultHighlightCount = 10;
const metadataHighlightCandidateLimit = 1000;
const previewHighlightCandidateLimit = 250;
const highlightMetadataFields = ['type', 'dates', 'filename', 'favorite', 'rating', 'tags', 'location'];

const sessionSupportsImageInput = (body) =>
  body.initialContext?.providerSupportsImages === true ||
  body.credential?.supportsImageInput === true ||
  body.credential?.capabilities?.imageInput === true;

const usaTripDateFilters = (prompt) => {
  if (!/(?:\b(?:USA|United States)\b|\bU\.S\.(?=\s|$|[.,!?]))/i.test(prompt)) return null;
  if (/\bJanuary\s+2026\b/i.test(prompt)) {
    return { country: 'USA', takenAfter: '2026-01-01T00:00:00.000Z', takenBefore: '2026-02-01T00:00:00.000Z' };
  }
  return { country: 'USA' };
};

const isJanuary2026UsaTripFilter = (filters) =>
  filters?.country === 'USA' &&
  filters?.takenAfter === '2026-01-01T00:00:00.000Z' &&
  filters?.takenBefore === '2026-02-01T00:00:00.000Z';

const parseRecentTripPrompt = (prompt) => {
  if (!/\brecent\s+trip\b/i.test(prompt) || !/\balbum\b/i.test(prompt)) {
    return null;
  }

  const placeHint = /\b(?:USA|United States|U\.S\.)\b/i.test(prompt) ? 'USA' : null;
  const countMatch =
    prompt.match(/(?:^|\s)(-?\d+)\s+(?:best\s+)?(?:highlights?|photos?)\b/i) ??
    prompt.match(/\b(?:best|top|pick|choose|suggest)\s+(-?\d+)\s+(?:highlights?|photos?)\b/i);
  const requestedCount = countMatch ? Number(countMatch[1]) : null;
  const highlights = /\b(top|best|highlights?)\b/i.test(prompt);
  const albumName = /called\b/i.test(prompt)
    ? extractAlbumName(prompt)
    : highlights
      ? `${placeHint ?? 'Trip'} Highlights`
      : `${placeHint ?? 'Recent'} Trip`;

  return {
    placeHint,
    highlights,
    requestedCount,
    effectiveCount: highlights ? requestedCount ?? defaultHighlightCount : null,
    albumName,
  };
};

const tripCandidateDateRange = (candidate) => {
  const after = new Date(candidate.takenAfter);
  const before = new Date(candidate.takenBefore);
  const month = after.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const startDay = after.getUTCDate();
  const endDay = before.getUTCDate();
  const year = before.getUTCFullYear();
  return `${month} ${startDay}-${endDay}, ${year}`;
};

const tripCandidateLabel = (candidate) =>
  Array.isArray(candidate.placeLabels) && candidate.placeLabels.length > 0
    ? candidate.placeLabels.join(' and ')
    : candidate.title?.replace(/^Recent trip to\s+/i, '') || candidate.subtitle || 'that trip';

const duplicateExclusionText = (candidate) => {
  const duplicateCount = candidate.excludedDuplicateCount ?? 0;
  const stackCount = candidate.excludedStackChildCount ?? 0;
  if (duplicateCount === 0 && stackCount === 0) return '';
  const parts = [];
  if (duplicateCount > 0) parts.push(`${duplicateCount} known duplicate variant${duplicateCount === 1 ? '' : 's'}`);
  if (stackCount > 0) parts.push(`${stackCount} stack child${stackCount === 1 ? '' : 'ren'}`);
  return ` I skipped ${parts.join(' and ')}.`;
};

const parseHighlightPrompt = (prompt) => {
  if (!/\b(best|highlights?)\b/i.test(prompt)) {
    return null;
  }

  const usaFilters = usaTripDateFilters(prompt);
  const countMatch =
    prompt.match(/(?:^|\s)(-?\d+)\s+(?:best\s+)?(?:highlights?|photos?)\b/i) ??
    prompt.match(/\b(?:best|top|pick|choose|suggest)\s+(-?\d+)\s+(?:highlights?|photos?)\b/i);
  const requestedCount = countMatch ? Number(countMatch[1]) : null;
  const unbounded = /\b(my|entire|whole)?\s*library\b/i.test(prompt) || /\b(all photos|everything)\b/i.test(prompt);
  const bounded =
    !unbounded &&
    (Boolean(usaFilters) || /\b(this album|album|space|last weekend|weekend|from|selected|selection)\b/i.test(prompt));
  const filters = usaFilters ?? (/\b(last weekend|weekend)\b/i.test(prompt)
    ? {
        takenAfter: '2026-05-23T00:00:00.000Z',
        takenBefore: '2026-05-24T23:59:59.999Z',
      }
    : null);

  return {
    bounded,
    filters,
    requestedCount,
    effectiveCount: requestedCount ?? defaultHighlightCount,
    usedDefaultCount: requestedCount === null,
    usesCurrentAlbum: /\bthis album\b/i.test(prompt),
  };
};

const slugifyTemporaryTargetId = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'highlights';

const stripTrailingSourcePhrase = (value) =>
  value
    .replace(/\s+from\s+(?:last\s+weekend|weekend)\s*\.?$/i, '')
    .replace(/\.$/, '')
    .trim();

const extractAlbumName = (prompt) => {
  const quoted = prompt.match(/\balbum called\s+["']([^"']+)["']/i);
  if (quoted) {
    return quoted[1].trim();
  }

  const unquoted = prompt.match(/\balbum called\s+(.+?)\.?$/i);
  if (unquoted) {
    return stripTrailingSourcePhrase(unquoted[1]);
  }

  const called = prompt.match(/\bcalled\s+(.+?)\.?$/i);
  if (called) {
    return stripTrailingSourcePhrase(called[1]);
  }

  return 'Suggested Highlights';
};

const extractTargetAlbumName = (prompt) => {
  const beforeSource = prompt.match(/\bto\s+([A-Za-z][A-Za-z0-9 '&-]*?)\s+from\s+(?:last\s+weekend|weekend)\b/i);
  if (beforeSource) {
    return beforeSource[1].trim();
  }

  const match = prompt.match(/\bto\s+([A-Za-z][A-Za-z0-9 '&-]*?)\.?$/i);
  return match ? stripTrailingSourcePhrase(match[1]) : null;
};

const parseHighlightPlanIntent = (prompt) => {
  if (/\b(make|create)\b.*\balbum\b|\balbum called\b/i.test(prompt)) {
    const albumName = extractAlbumName(prompt);
    return {
      kind: 'create-album',
      albumName,
      temporaryTargetId: slugifyTemporaryTargetId(albumName),
    };
  }

  if (/\badd\b/i.test(prompt)) {
    const targetAlbumName = extractTargetAlbumName(prompt);
    return targetAlbumName ? { kind: 'add-to-album', targetAlbumName } : null;
  }

  if (/\bfavorite\b/i.test(prompt)) {
    return { kind: 'favorite' };
  }

  return null;
};

const parseCoverPrompt = (prompt) => {
  if (!/\bcover\b/i.test(prompt)) {
    return null;
  }

  const usesCurrentAlbum = /\bthis album\b/i.test(prompt);
  const namedAlbum = prompt.match(/\bcover\s+(?:for|from)\s+([A-Za-z][A-Za-z0-9 '&-]*?)\.?$/i);
  if (namedAlbum && !usesCurrentAlbum) {
    return { targetAlbumName: stripTrailingSourcePhrase(namedAlbum[1]), usesCurrentAlbum };
  }

  return { targetAlbumName: null, usesCurrentAlbum };
};

const highlightCandidateCount = (result, assetIds, candidateLimit = metadataHighlightCandidateLimit) => {
  if (typeof result.totalCount === 'number') {
    return result.totalCount;
  }

  if (typeof result.approximateTotal === 'number') {
    return result.approximateTotal;
  }

  if (typeof result.selectionHandle?.assetCount === 'number') {
    return result.selectionHandle.assetCount;
  }

  if (
    result.hasMore === true &&
    candidateLimit >= previewHighlightCandidateLimit &&
    (result.returnedCount ?? assetIds.length) >= candidateLimit
  ) {
    return candidateLimit + 1;
  }

  if (typeof result.returnedCount === 'number') {
    return result.returnedCount;
  }

  return assetIds.length;
};

const assertMcpResultSuccess = (result, label) => {
  if (typeof result.status === 'string' && result.status !== 'success') {
    throw new Error(`${label} did not complete successfully: ${result.status}`);
  }
};

const readHighlightCandidates = async (client, highlightPrompt, limit = highlightPrompt.effectiveCount) => {
  const result = await client.call('searchAssets', {
    filters: highlightPrompt.filters,
    detail: 'ids',
    limit,
  });
  assertMcpResultSuccess(result, 'Asset search');

  const assetIds = compactAssetIdsFromResult(result);
  return {
    assetIds,
    candidateCount: highlightCandidateCount(result, assetIds, limit),
  };
};

const readHighlightSelection = async (client, highlightPrompt, limit) => {
  const result = await client.call('searchAssets', { filters: highlightPrompt.filters, detail: 'handle', limit });
  assertMcpResultSuccess(result, 'Asset search');
  if (!result.selectionHandle?.id) throw new Error('Asset search did not return a selection handle');
  return { selectionHandle: result.selectionHandle, candidateCount: highlightCandidateCount(result, [], limit) };
};

const curateMetadataHighlights = async (client, selectionHandleId, targetCount, criteria) => {
  const result = await client.call('curateSelection', {
    selectionHandleId,
    targetCount,
    strategy: 'metadata-highlights',
    criteria,
    sampleSize: 10,
  });
  assertMcpResultSuccess(result, 'Selection curation');
  if (!result.selectionHandle?.id) throw new Error('Selection curation did not return a selection handle');
  return result;
};

const readHighlightMetadata = async (client, assetIds) => {
  const result = await client.call('readAssetMetadata', {
    assetIds,
    fields: highlightMetadataFields,
  });
  assertMcpResultSuccess(result, 'Asset metadata read');

  if (!Array.isArray(result.assets)) {
    throw new Error('Asset metadata read did not return assets');
  }

  return result.assets;
};

const readHighlightPreviews = async (client, assetIds) => {
  const result = await client.call('readAssetPreviews', { assetIds });
  if (result.status === 'denied' || result.status === 'unavailable') {
    return { status: 'unavailable', reason: result.status };
  }

  assertMcpResultSuccess(result, 'Asset preview read');

  if (!Array.isArray(result.previews)) {
    throw new Error('Asset preview read did not return previews');
  }

  return { status: 'available', previews: result.previews };
};

const assetRating = (asset) => {
  const rating = asset?.exifInfo?.rating;
  return typeof rating === 'number' ? rating : 0;
};

const selectMetadataHighlights = (assets, requestedCount, excludedAssetIds = new Set()) =>
  assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => typeof asset?.id === 'string' && !excludedAssetIds.has(asset.id))
    .sort((left, right) => {
      const favoriteDelta = Number(Boolean(right.asset.isFavorite)) - Number(Boolean(left.asset.isFavorite));
      if (favoriteDelta !== 0) {
        return favoriteDelta;
      }

      const ratingDelta = assetRating(right.asset) - assetRating(left.asset);
      if (ratingDelta !== 0) {
        return ratingDelta;
      }

      return left.index - right.index;
    })
    .slice(0, requestedCount)
    .map(({ asset }) => asset.id);

const highlightCriteriaSummary = (mode) =>
  mode === 'preview-assisted'
    ? 'preview-assisted suggested highlights considered previews, existing favorites, ratings, dates, tags, and location'
    : 'metadata-only suggested highlights prioritized existing favorites, ratings, dates, tags, and location; no previews were inspected';

const highlightOperationLabel = (mode) =>
  mode === 'preview-assisted' ? 'preview-assisted suggested highlights' : 'metadata-only suggested highlights';

const highlightAlbumDescription = (mode) =>
  mode === 'preview-assisted'
    ? 'Suggested highlights selected from preview and metadata signals.'
    : 'Suggested highlights selected from metadata signals. No previews were inspected.';

const proposeMetadataHighlightAlbum = async (client, intent, selectedAssetIds, criteriaMode = 'metadata-only') => {
  const criteriaSummary = highlightCriteriaSummary(criteriaMode);
  const operationLabel = highlightOperationLabel(criteriaMode);
  await client.call('proposeAlbumOperations', {
    summary: `Create ${intent.albumName} with ${selectedAssetIds.length} ${criteriaSummary}.`,
    operations: [
      {
        type: 'album.create',
        summary: `Create ${intent.albumName}`,
        targetKind: 'new_album',
        temporaryTargetId: intent.temporaryTargetId,
        riskLevel: 'low',
        enabled: true,
        payload: {
          albumName: intent.albumName,
          description: highlightAlbumDescription(criteriaMode),
        },
      },
      {
        type: 'album.addAssets',
        summary: `Add ${selectedAssetIds.length} ${operationLabel} to ${intent.albumName}.`,
        targetKind: 'new_album',
        temporaryTargetId: intent.temporaryTargetId,
        assetIds: selectedAssetIds,
        riskLevel: 'medium',
        enabled: true,
        payload: {},
      },
    ],
  });
};

const proposeMetadataHighlightAlbumFromSelection = async (client, intent, selectionHandleId, selectedCount) => {
  await client.call('proposeAlbumFromSelection', {
    summary: `Create ${intent.albumName} with ${selectedCount} metadata-only curated highlights.`,
    albumName: intent.albumName,
    description: highlightAlbumDescription('metadata-only'),
    selectionHandleId,
  });
};

const proposeTripAlbumFromSelection = async (client, { albumName, selectionHandleId, assetCount, candidate, highlights }) => {
  const label = tripCandidateLabel(candidate);
  await client.call('proposeAlbumFromSelection', {
    summary: highlights
      ? `Create ${albumName} with ${assetCount} metadata-only curated highlights from ${label}.`
      : `Create ${albumName} with ${assetCount} trip assets from ${label}.`,
    albumName,
    description: highlights
      ? 'Trip highlights selected from metadata signals. No previews were inspected.'
      : `Album-ready trip selection from ${label}. Known duplicate variants and stack children were excluded when detected.`,
    selectionHandleId,
  });
};

const resolveExistingAlbum = async (client, targetAlbumName) => {
  const result = await client.call('listAlbums', {});
  assertMcpResultSuccess(result, 'Album list');
  const matches = Array.isArray(result.albums)
    ? result.albums.filter((album) => album?.albumName?.toLowerCase() === targetAlbumName.toLowerCase())
    : [];

  if (matches.length !== 1) {
    return { status: 'needs-clarification', matchCount: matches.length };
  }

  const albumResult = await client.call('readAlbum', { albumId: matches[0].id });
  assertMcpResultSuccess(albumResult, 'Album read');
  return { status: 'resolved', album: albumResult.album };
};

const currentAlbumIdFromContext = (entry) => {
  const albumId = entry.initialContext?.albumId;
  return typeof albumId === 'string' && albumId.trim() ? albumId : null;
};

const readAlbumById = async (client, albumId) => {
  const albumResult = await client.call('readAlbum', { albumId });
  assertMcpResultSuccess(albumResult, 'Album read');
  return { status: 'resolved', album: albumResult.album };
};

const proposeMetadataHighlightAlbumAdd = async (client, album, selectedAssetIds, criteriaMode = 'metadata-only') => {
  const criteriaSummary = highlightCriteriaSummary(criteriaMode);
  const operationLabel = highlightOperationLabel(criteriaMode);
  await client.call('proposeAlbumOperations', {
    summary: `Add ${selectedAssetIds.length} ${criteriaSummary} to ${album.albumName}.`,
    operations: [
      {
        type: 'album.addAssets',
        summary: `Add ${selectedAssetIds.length} ${operationLabel} to ${album.albumName}.`,
        targetKind: 'existing_album',
        targetId: album.id,
        assetIds: selectedAssetIds,
        riskLevel: 'medium',
        enabled: true,
        payload: {},
      },
    ],
  });
};

const proposeMetadataHighlightFavorites = async (client, selectedAssetIds, criteriaMode = 'metadata-only') => {
  const criteriaSummary = highlightCriteriaSummary(criteriaMode);
  const operationLabel = highlightOperationLabel(criteriaMode);
  await client.call('proposeAlbumOperations', {
    summary: `Favorite ${selectedAssetIds.length} ${criteriaSummary}.`,
    operations: [
      {
        type: 'asset.setFavorite',
        summary: `Favorite ${selectedAssetIds.length} ${operationLabel}.`,
        targetKind: 'asset_batch',
        assetIds: selectedAssetIds,
        riskLevel: 'low',
        enabled: true,
        payload: { favorite: true },
      },
    ],
  });
};

const proposeMetadataHighlightFavoritesFromSelection = async (client, selectionHandleId, selectedCount) => {
  await client.call('proposeAssetBatchFromSelection', {
    summary: `Favorite ${selectedCount} metadata-only curated highlights.`,
    action: { type: 'asset.setFavorite', favorite: true },
    selectionHandleId,
  });
};

const proposeAlbumCover = async (client, album, assetId, criteriaMode) => {
  const criteriaSummary = highlightCriteriaSummary(criteriaMode);
  await client.call('proposeAlbumOperations', {
    summary: `Set ${album.albumName} cover using one ${criteriaSummary}.`,
    operations: [
      {
        type: 'album.setCover',
        summary: `Set ${album.albumName} cover to a suggested highlight.`,
        targetKind: 'existing_album',
        targetId: album.id,
        assetIds: [assetId],
        riskLevel: 'low',
        enabled: true,
        payload: {},
      },
    ],
  });
};

export const createE2eRuntime = ({ fetch: fetchImplementation = fetch, now = () => Date.now() } = {}) => {
  const sessions = new Map();
  const registry = createWorkflowRegistry();

  return {
    getCapabilities() {
      return e2eCapabilities;
    },

    async createSession(body) {
      const runnerSessionId = `e2e-${body.gallerySessionId}`;
      sessions.set(runnerSessionId, {
        gallerySessionId: body.gallerySessionId,
        model: body.model,
        mcpGateway: body.mcpGateway,
        supportsImageInput: sessionSupportsImageInput(body),
        initialContext: body.initialContext ?? {},
        pendingWorkflow: body.workflowState ?? undefined,
        dispatcher: body.mcpGateway
          ? createWorkflowDispatcher({
              registry,
              buildClient: () => createE2eMcpClient({ gateway: body.mcpGateway, fetch: fetchImplementation }),
              now,
            })
          : undefined,
      });

      return {
        runnerSessionId,
        capabilities: {
          ...e2eCapabilities,
          tools: body.mcpGateway ? e2eCapabilities.tools : [],
          models: [body.model],
        },
      };
    },

    async *sendMessage({ runnerSessionId, gallerySessionId, content, workflowState }) {
      const entry = sessions.get(runnerSessionId);
      if (!entry || entry.gallerySessionId !== gallerySessionId) {
        throw new Error('Runner session not found');
      }

      if (workflowState !== undefined) {
        entry.pendingWorkflow = workflowState ?? undefined;
      }

      const gateway = requireMcpGateway(entry);
      const client = createE2eMcpClient({
        gateway,
        fetch: fetchImplementation,
      });
      const prompt = getPromptText(content);
      const metadataPrompt = parseMetadataPrompt(prompt);

      const strictEvents = [];
      const dispatch = await entry.dispatcher.routeTurn({
        prompt,
        emit: (event) => strictEvents.push(event),
        appendTranscript: () => {},
        getPending: () => entry.pendingWorkflow,
        setPending: (next) => {
          entry.pendingWorkflow = next;
        },
        completedEvent: ({ text }) => completedEvent({ gallerySessionId, runnerSessionId, text }),
        approvalEvent: ({ toolCallId }) => toolApprovalNeededEvent({ gallerySessionId, runnerSessionId, toolCallId }),
        workflowStateEvent: ({ workflowState: nextWorkflowState }) =>
          workflowStateUpdateEvent({ gallerySessionId, runnerSessionId, workflowState: nextWorkflowState }),
      });
      if (dispatch.handled) {
        yield* strictEvents;
        return;
      }

      if (metadataPrompt?.kind === 'place-name') {
        yield completedEvent({
          gallerySessionId,
          runnerSessionId,
          text: 'Please provide explicit latitude and longitude before I propose a location metadata update.',
        });
        return;
      }

      if (metadataPrompt?.kind === 'missing-longitude') {
        yield completedEvent({
          gallerySessionId,
          runnerSessionId,
          text: 'Please provide the longitude before I propose a coordinate metadata update.',
        });
        return;
      }

      const coverPrompt = parseCoverPrompt(prompt);
      if (coverPrompt) {
        const contextAlbumId = currentAlbumIdFromContext(entry);
        if (!coverPrompt.targetAlbumName && !(coverPrompt.usesCurrentAlbum && contextAlbumId)) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'Please name the album before I suggest a cover.',
          });
          return;
        }

        try {
          const resolution = coverPrompt.usesCurrentAlbum
            ? await readAlbumById(client, contextAlbumId)
            : await resolveExistingAlbum(client, coverPrompt.targetAlbumName);
          if (resolution.status !== 'resolved') {
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: `I need one matching album named ${coverPrompt.targetAlbumName} before suggesting a cover. Which album should I use?`,
            });
            return;
          }

          const albumAssetIds = Array.isArray(resolution.album.assetIds) ? resolution.album.assetIds : [];
          if (albumAssetIds.length === 0) {
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: `I found no assets in ${resolution.album.albumName}, so I did not create a cover plan.`,
            });
            return;
          }

          const usePreviewAssistedCover = entry.supportsImageInput;
          if (usePreviewAssistedCover && albumAssetIds.length > previewHighlightCandidateLimit) {
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: 'That album has too many assets for preview-assisted cover selection. Please narrow the source or choose a smaller album.',
            });
            return;
          }

          const metadataAssets = await readHighlightMetadata(client, albumAssetIds);
          let criteriaMode = 'metadata-only';
          let previewUnavailable = false;
          if (usePreviewAssistedCover) {
            const previewResult = await readHighlightPreviews(client, albumAssetIds);
            if (previewResult.status === 'available') {
              criteriaMode = 'preview-assisted';
            } else {
              previewUnavailable = true;
            }
          }

          const [selectedCoverId] = selectMetadataHighlights(metadataAssets, 1);
          if (!selectedCoverId) {
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: `I found no eligible assets in ${resolution.album.albumName}, so I did not create a cover plan.`,
            });
            return;
          }

          await proposeAlbumCover(client, resolution.album, selectedCoverId, criteriaMode);
          const previewFallbackText = previewUnavailable
            ? ' Previews were unavailable, so I used metadata-only criteria.'
            : '';
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: `I proposed a ${criteriaMode} cover suggestion for ${resolution.album.albumName}.${previewFallbackText} Review the plan before applying it.`,
          });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: `Gallery could not inspect cover candidates: ${redactGatewayToken(message, gateway)}`,
          });
          return;
        }
      }

      const tripPrompt = parseRecentTripPrompt(prompt);
      if (tripPrompt) {
        const tripResult = await client.call('findTripCandidates', tripPrompt.placeHint ? { placeHint: tripPrompt.placeHint } : {});
        assertMcpResultSuccess(tripResult, 'Trip candidate lookup');
        const candidates = Array.isArray(tripResult.candidates) ? tripResult.candidates : [];
        const recommendation = tripResult.recommendation;

        if (tripPrompt.highlights && tripPrompt.requestedCount !== null && tripPrompt.requestedCount <= 0) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'Please choose a positive count before I suggest trip highlights.',
          });
          return;
        }

        if (tripPrompt.highlights && tripPrompt.effectiveCount > metadataHighlightCandidateLimit) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'Please choose 1000 or fewer trip highlights, or narrow the source before curation.',
          });
          return;
        }

        if (recommendation?.action === 'none' || candidates.length === 0) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'I could not find a likely recent trip from the available date and location metadata. Which date range or place should I use for the album?',
          });
          return;
        }

        if (recommendation?.action === 'ask_user') {
          const labels = candidates.map(tripCandidateLabel).slice(0, 5).join('; ');
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text:
              candidates.length === 1
                ? `I found one possible recent trip: ${labels}. Should I use it, or would you prefer to give me a date range or place?`
                : `I found multiple possible recent trips: ${labels}. Which one should I use?`,
          });
          return;
        }

        const candidate = candidates.find((item) => item.dedupeKey === recommendation?.candidateDedupeKey) ?? candidates[0];
        const selectionHandleId = candidate?.selectionHandle?.id;
        if (!candidate || !selectionHandleId) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'I found a trip candidate but could not get an album-ready selection handle. Please try again or give me a date range.',
          });
          return;
        }

        if (tripPrompt.highlights) {
          const tripSourceName = `${tripPrompt.placeHint ?? 'Recent'} Trip`;
          const curated = await curateMetadataHighlights(
            client,
            selectionHandleId,
            tripPrompt.effectiveCount,
            `top metadata-only highlights from ${tripSourceName}`,
          );
          const selectedCount =
            typeof curated.selectedAssetCount === 'number'
              ? curated.selectedAssetCount
              : curated.selectionHandle.assetCount ?? tripPrompt.effectiveCount;
          await proposeTripAlbumFromSelection(client, {
            albumName: tripPrompt.albumName,
            selectionHandleId: curated.selectionHandle.id,
            assetCount: selectedCount,
            candidate,
            highlights: true,
          });
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: `I found a likely ${tripCandidateLabel(candidate)} trip from ${tripCandidateDateRange(candidate)} and proposed ${selectedCount} metadata-only suggested highlights for ${tripPrompt.albumName}. Review the plan before applying it.`,
          });
          return;
        }

        const assetCount = candidate.selectionHandle.assetCount ?? candidate.albumAssetCount ?? 0;
        await proposeTripAlbumFromSelection(client, {
          albumName: tripPrompt.albumName,
          selectionHandleId,
          assetCount,
          candidate,
          highlights: false,
        });
        yield completedEvent({
          gallerySessionId,
          runnerSessionId,
          text: `I found a likely ${tripCandidateLabel(candidate)} trip from ${tripCandidateDateRange(candidate)} and proposed ${tripPrompt.albumName} with ${assetCount} assets.${duplicateExclusionText(candidate)} Review the plan before applying it.`,
        });
        return;
      }

      const highlightPrompt = parseHighlightPrompt(prompt);
      if (highlightPrompt) {
        if (!highlightPrompt.bounded) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'I can suggest highlights when you give me a bounded source, such as an album, shared space, date range, search/filter, or selected photos. Which set should I use?',
          });
          return;
        }

        if (highlightPrompt.requestedCount !== null && highlightPrompt.requestedCount <= 0) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'Please choose a positive count before I suggest highlights.',
          });
          return;
        }

        if (highlightPrompt.effectiveCount > metadataHighlightCandidateLimit) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'Please choose 1000 or fewer highlights, or narrow the source before curation.',
          });
          return;
        }

        const contextAlbumId = currentAlbumIdFromContext(entry);
        if (highlightPrompt.usesCurrentAlbum) {
          if (!contextAlbumId) {
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: 'I need the current album context before I suggest highlights from this album.',
            });
            return;
          }
        }

        if (!highlightPrompt.filters && !highlightPrompt.usesCurrentAlbum) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'I need a concrete searchable source for this read-only highlight check, such as a date range, search/filter, or selected photos. Which set should I use?',
          });
          return;
        }

        const planIntent = parseHighlightPlanIntent(prompt);
        const usePreviewAssistedCuration = Boolean(planIntent && entry.supportsImageInput);
        const planCandidateLimit = planIntent
          ? usePreviewAssistedCuration
            ? previewHighlightCandidateLimit
            : metadataHighlightCandidateLimit
          : highlightPrompt.effectiveCount;
        const activeCandidateLimit = usePreviewAssistedCuration
          ? previewHighlightCandidateLimit
          : metadataHighlightCandidateLimit;

        try {
          let targetAlbum = null;
          let existingIds = new Set();
          let sourceAlbumAssetIds = null;

          if (planIntent?.kind === 'add-to-album') {
            const resolution = await resolveExistingAlbum(client, planIntent.targetAlbumName);
            if (resolution.status !== 'resolved') {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: `I need one matching album named ${planIntent.targetAlbumName} before adding highlights. Which album should I use?`,
              });
              return;
            }

            targetAlbum = resolution.album;
            existingIds = new Set(Array.isArray(targetAlbum.assetIds) ? targetAlbum.assetIds : []);
          }

          if (highlightPrompt.usesCurrentAlbum) {
            const resolution = await readAlbumById(client, contextAlbumId);
            sourceAlbumAssetIds = Array.isArray(resolution.album?.assetIds) ? resolution.album.assetIds : [];
          }

          const shouldUseSelectionPlanning =
            !usePreviewAssistedCuration &&
            !sourceAlbumAssetIds &&
            (planIntent?.kind === 'create-album' || planIntent?.kind === 'favorite');

          if (shouldUseSelectionPlanning) {
            const { selectionHandle, candidateCount } = await readHighlightSelection(
              client,
              highlightPrompt,
              planCandidateLimit,
            );
            if (candidateCount === 0) {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: 'I found no matching candidates in that bounded source, so I did not create a plan.',
              });
              return;
            }

            if (candidateCount > activeCandidateLimit) {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: 'That source has too many candidate assets for this metadata-only highlight pass. Please narrow the album, space, date range, search/filter, or selected photos.',
              });
              return;
            }

            const criteria = isJanuary2026UsaTripFilter(highlightPrompt.filters)
              ? 'top highlights from January 2026 USA trip'
              : 'top metadata-only highlights from the bounded source';
            const curated = await curateMetadataHighlights(
              client,
              selectionHandle.id,
              highlightPrompt.effectiveCount,
              criteria,
            );
            const selectedCount =
              typeof curated.selectedAssetCount === 'number'
                ? curated.selectedAssetCount
                : curated.selectionHandle.assetCount ?? highlightPrompt.effectiveCount;

            if (selectedCount === 0) {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: planIntent.kind === 'favorite'
                  ? 'I found no eligible metadata candidates to favorite, so I did not create a plan.'
                  : 'I found no eligible metadata candidates in that bounded source, so I did not create a plan.',
              });
              return;
            }

            if (planIntent.kind === 'favorite') {
              await proposeMetadataHighlightFavoritesFromSelection(client, curated.selectionHandle.id, selectedCount);
              const shortage =
                selectedCount < highlightPrompt.effectiveCount
                  ? ` Only ${selectedCount} eligible candidates were available, though you requested ${highlightPrompt.effectiveCount}.`
                  : '';
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: `I proposed favorite operations for ${selectedCount} metadata-only suggested highlights. Review the plan before applying it.${shortage}`,
              });
              return;
            }

            await proposeMetadataHighlightAlbumFromSelection(
              client,
              planIntent,
              curated.selectionHandle.id,
              selectedCount,
            );
            const shortage =
              selectedCount < highlightPrompt.effectiveCount
                ? ` Only ${selectedCount} eligible candidates were available, though you requested ${highlightPrompt.effectiveCount}.`
                : '';
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: `I proposed ${selectedCount} suggested highlights using metadata-only criteria. Review the plan before applying it.${shortage}`,
            });
            return;
          }

          const candidateResult = sourceAlbumAssetIds
            ? { assetIds: sourceAlbumAssetIds, candidateCount: sourceAlbumAssetIds.length }
            : await readHighlightCandidates(client, highlightPrompt, planCandidateLimit);
          const { assetIds, candidateCount } = candidateResult;
          if (candidateCount === 0) {
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: 'I found no matching candidates in that bounded source, so I did not create a plan.',
            });
            return;
          }

          if (candidateCount > activeCandidateLimit) {
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: usePreviewAssistedCuration
                ? 'That source has too many candidate assets for preview-assisted curation. Please narrow the album, space, date range, search/filter, or selected photos.'
                : 'That source has too many candidate assets for this metadata-only highlight pass. Please narrow the album, space, date range, search/filter, or selected photos.',
            });
            return;
          }

          const readCurationContext = async () => {
            const metadataAssets = await readHighlightMetadata(client, assetIds);
            if (!usePreviewAssistedCuration) {
              return { metadataAssets, criteriaMode: 'metadata-only', previewUnavailable: false };
            }

            const previewResult = await readHighlightPreviews(client, assetIds);
            if (previewResult.status !== 'available') {
              return { metadataAssets, criteriaMode: 'metadata-only', previewUnavailable: true };
            }

            return { metadataAssets, criteriaMode: 'preview-assisted', previewUnavailable: false };
          };

          if (planIntent?.kind === 'add-to-album') {
            const { metadataAssets, criteriaMode, previewUnavailable } = await readCurationContext();
            const selectedAssetIds = selectMetadataHighlights(metadataAssets, highlightPrompt.effectiveCount, existingIds);
            if (selectedAssetIds.length === 0) {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: `I found no eligible metadata candidates outside ${targetAlbum.albumName}, so I did not create a plan.`,
              });
              return;
            }

            await proposeMetadataHighlightAlbumAdd(client, targetAlbum, selectedAssetIds, criteriaMode);
            const excludedCount = assetIds.filter((id) => existingIds.has(id)).length;
            const excludedText =
              excludedCount > 0 ? ` I excluded ${excludedCount} already in ${targetAlbum.albumName}.` : '';
            const previewFallbackText = previewUnavailable
              ? ' Previews were unavailable, so I used metadata-only criteria.'
              : '';
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: `I proposed ${selectedAssetIds.length} ${criteriaMode} suggested highlights for ${targetAlbum.albumName}.${excludedText}${previewFallbackText} Review the plan before applying it.`,
            });
            return;
          }

          if (planIntent?.kind === 'favorite') {
            const { metadataAssets, criteriaMode, previewUnavailable } = await readCurationContext();
            const selectedAssetIds = selectMetadataHighlights(metadataAssets, highlightPrompt.effectiveCount);
            if (selectedAssetIds.length === 0) {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: 'I found no eligible metadata candidates to favorite, so I did not create a plan.',
              });
              return;
            }

            await proposeMetadataHighlightFavorites(client, selectedAssetIds, criteriaMode);
            const previewFallbackText = previewUnavailable
              ? ' Previews were unavailable, so I used metadata-only criteria.'
              : '';
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: `I proposed favorite operations for ${selectedAssetIds.length} ${criteriaMode} suggested highlights.${previewFallbackText} Review the plan before applying it.`,
            });
            return;
          }

          if (planIntent?.kind === 'create-album') {
            const { metadataAssets, criteriaMode, previewUnavailable } = await readCurationContext();
            const selectedAssetIds = selectMetadataHighlights(metadataAssets, highlightPrompt.effectiveCount);
            if (selectedAssetIds.length === 0) {
              yield completedEvent({
                gallerySessionId,
                runnerSessionId,
                text: 'I found no eligible metadata candidates in that bounded source, so I did not create a plan.',
              });
              return;
            }

            await proposeMetadataHighlightAlbum(client, planIntent, selectedAssetIds, criteriaMode);
            const shortage =
              selectedAssetIds.length < highlightPrompt.effectiveCount
                ? ` Only ${selectedAssetIds.length} eligible candidates were available, though you requested ${highlightPrompt.effectiveCount}.`
                : '';
            const previewFallbackText = previewUnavailable
              ? ' Previews were unavailable, so I used metadata-only criteria.'
              : '';
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: `I proposed ${selectedAssetIds.length} suggested highlights using ${criteriaMode} criteria. Review the plan before applying it.${shortage}${previewFallbackText}`,
            });
            return;
          }

          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: highlightPrompt.usedDefaultCount
              ? `I found ${candidateCount} candidate assets. I would use the default count of 10 for suggested highlights from this bounded source. I did not create a plan.`
              : `I found ${candidateCount} candidate assets for ${highlightPrompt.effectiveCount} suggested highlights. I did not create a plan.`,
          });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: `Gallery could not inspect highlight candidates: ${redactGatewayToken(message, gateway)}`,
          });
          return;
        }
      }

      yield deltaEvent({
        gallerySessionId,
        runnerSessionId,
        text: metadataPrompt ? 'Drafting a metadata plan.' : 'Drafting an album plan.',
      });

      try {
        if (metadataPrompt?.kind === 'description') {
          await proposeMetadataBatchFromSearch(client, {
            searchArgs: {
              filters: {},
              order: 'desc',
              limit: metadataPrompt.limit,
              detail: 'ids',
              createSelectionHandle: true,
              sampleSize: 2,
            },
            action: {
              type: 'asset.updateMetadata',
              description: metadataPrompt.description,
            },
          });
        } else if (metadataPrompt?.kind === 'coordinates') {
          await proposeMetadataBatchFromSearch(client, {
            searchArgs: {
              filters: {},
              detail: 'ids',
              createSelectionHandle: true,
              sampleSize: 2,
            },
            action: {
              type: 'asset.updateMetadata',
              latitude: metadataPrompt.latitude,
              longitude: metadataPrompt.longitude,
            },
          });
        } else if (/\bdenied\b|\binaccessible\b/i.test(prompt)) {
          await proposeDeniedTrip(client);
        } else {
          await proposePortugalTrip(client);
        }

        yield completedEvent({
          gallerySessionId,
          runnerSessionId,
          text: metadataPrompt?.kind === 'coordinates'
            ? 'I proposed a coordinates metadata update. Review the operation before applying it.'
            : metadataPrompt?.kind === 'description'
              ? 'I proposed a metadata description update. Review the operation before applying it.'
              : 'I proposed a Portugal Trip album. Review the operations before applying them.',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        yield completedEvent({
          gallerySessionId,
          runnerSessionId,
          text: `Gallery denied the album organization request: ${redactGatewayToken(message, gateway)}`,
        });
      }
    },
  };
};
