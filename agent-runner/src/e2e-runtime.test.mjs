import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createE2eRuntime } from './e2e-runtime.mjs';

const gallerySessionId = '00000000-0000-4000-8000-000000000100';
const runnerSessionId = `e2e-${gallerySessionId}`;
const token = 'gateway-token-secret';
const gateway = { url: 'http://gallery.example.test/api/agent/mcp/sessions/00000000-0000-4000-8000-000000000100', token };
const lastWeekendHighlightFilters = {
  takenAfter: '2026-05-23T00:00:00.000Z',
  takenBefore: '2026-05-24T23:59:59.999Z',
};
const usaTripSearchHandleId = '00000000-0000-4000-8000-000000000901';
const usaTripCuratedHandleId = '00000000-0000-4000-8000-000000000902';
const tripCandidateHandleId = '00000000-0000-4000-8000-000000000921';
const tripCandidateCuratedHandleId = '00000000-0000-4000-8000-000000000922';
const highlightAssetIds = [
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000403',
  '00000000-0000-4000-8000-000000000404',
];
const familyAlbumId = '00000000-0000-4000-8000-000000000501';
const familyOwnerId = '00000000-0000-4000-8000-000000000601';

const highlightMetadataAsset = (id, overrides = {}) => ({
  id,
  type: 'IMAGE',
  localDateTime: '2026-05-23T12:00:00.000Z',
  originalFileName: `${id.slice(-4)}.jpg`,
  isFavorite: false,
  exifInfo: { rating: 0, city: 'Porto', country: 'Portugal' },
  tags: [{ id: '00000000-0000-4000-8000-000000000701', value: 'Trip', color: 'blue' }],
  ...overrides,
});

const defaultHighlightMetadataAssets = () => [
  highlightMetadataAsset(highlightAssetIds[0], { exifInfo: { rating: 3, city: 'Porto', country: 'Portugal' } }),
  highlightMetadataAsset(highlightAssetIds[1], {
    isFavorite: true,
    exifInfo: { rating: 1, city: 'Porto', country: 'Portugal' },
  }),
  highlightMetadataAsset(highlightAssetIds[2], { exifInfo: { rating: 5, city: 'Lisbon', country: 'Portugal' } }),
  highlightMetadataAsset(highlightAssetIds[3], { exifInfo: { rating: 2, city: 'Lisbon', country: 'Portugal' } }),
];

const currentAlbumAssetIds = Array.from(
  { length: 8 },
  (_value, index) => `00000000-0000-4000-8000-${String(800 + index).padStart(12, '0')}`,
);

const currentAlbumMetadataAssets = () =>
  currentAlbumAssetIds.map((id, index) =>
    highlightMetadataAsset(id, {
      isFavorite: index === 1 || index === 4,
      exifInfo: {
        rating: [1, 5, 3, 2, 4, 0, 2, 1][index],
        city: index % 2 === 0 ? 'Porto' : 'Lisbon',
        country: 'Portugal',
      },
    }),
  );

const currentAlbumSessionContext = () => ({
  albumId: familyAlbumId,
});

const makeTripCandidateSummary = (overrides = {}) => ({
  dedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
  title: 'Recent trip to New York, USA',
  subtitle: '28 photos over 10 days',
  countries: ['USA'],
  states: ['New York'],
  cities: ['New York'],
  takenAfter: '2026-05-03T00:00:00.000Z',
  takenBefore: '2026-05-12T23:59:59.000Z',
  assetCount: 32,
  albumAssetCount: 28,
  excludedDuplicateCount: 3,
  excludedStackChildCount: 1,
  dayCount: 10,
  score: 90,
  confidence: 'high',
  placeLabels: ['New York, USA'],
  selectionHandle: {
    id: tripCandidateHandleId,
    sourceRef: `asset-source:search:${tripCandidateHandleId}`,
    assetCount: 28,
  },
  ...overrides,
});

const familyAlbumSummary = () => ({
  id: familyAlbumId,
  albumName: 'Family',
  description: 'Family album',
  ownerId: familyOwnerId,
  assetCount: 1,
  startDate: '2026-05-20T00:00:00.000Z',
  endDate: '2026-05-25T00:00:00.000Z',
  albumThumbnailAssetId: null,
});

const createSessionBody = (overrides = {}) => ({
  gallerySessionId,
  credential: {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: 'openai-compatible',
    label: 'E2E runner',
    baseUrl: 'http://provider.invalid/v1',
    models: ['e2e-album-organizer'],
    defaultModel: 'e2e-album-organizer',
    secret: 'e2e-secret',
  },
  model: 'e2e-album-organizer',
  permissionPreset: 'careful',
  permissionPlan: {},
  approvalMode: 'plan-only',
  initialContext: {},
  mcpGateway: gateway,
  ...overrides,
});

const messageBody = (text) => ({
  runnerSessionId,
  gallerySessionId,
  messageId: '00000000-0000-4000-8000-000000000200',
  content: { blocks: [{ type: 'text', text }] },
});

const collectEvents = async (runtime, text) => {
  const events = [];
  for await (const event of runtime.sendMessage(messageBody(text))) {
    events.push(event);
  }
  return events;
};

const createFetch = (handlers) => {
  const calls = [];
  const fetchImplementation = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const path = new URL(String(url)).pathname;
    calls.push({ url: String(url), path, body, authorization: init?.headers?.Authorization });

    const handler = handlers.find((candidate) => body?.params?.name === candidate.name);
    if (!handler) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: `unexpected tool ${body?.params?.name}` },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const result = await handler.handle(body.params?.arguments ?? {}, body);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { calls, fetchImplementation };
};

const successHandlers = () => [
  {
    name: 'searchAssets',
    handle: (args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            status: 'success',
            detail: args.detail === 'ids' ? 'handle' : (args.detail ?? 'handle'),
            returnedCount: 3,
            hasMore: false,
            nextPage: null,
            ...(args.detail === 'ids' || args.createSelectionHandle
              ? {
                  assets: [
                    { id: '00000000-0000-4000-8000-000000000201' },
                    { id: '00000000-0000-4000-8000-000000000202' },
                    { id: '00000000-0000-4000-8000-000000000203' },
                  ],
                  assetIds: [
                    '00000000-0000-4000-8000-000000000201',
                    '00000000-0000-4000-8000-000000000202',
                    '00000000-0000-4000-8000-000000000203',
                  ],
                }
              : {}),
            selectionHandle: {
              id: '00000000-0000-4000-8000-000000000333',
              sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000333',
              assetCount: 3,
            },
          },
        },
      },
    }),
  },
  {
    name: 'proposeAlbumOperations',
    handle: (args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                summary: 'Stored 3 proposed operations.',
                plan: { id: '00000000-0000-4000-8000-000000000301' },
                toolCall: null,
                received: args,
              }),
            },
          ],
        },
      },
    }),
  },
  {
    name: 'proposeAssetBatchFromSearch',
    handle: (args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            status: 'success',
            summary: 'Stored 1 proposed metadata operation.',
            plan: { id: '00000000-0000-4000-8000-000000000302' },
            received: args,
          },
        },
      },
    }),
  },
  {
    name: 'curateSelection',
    handle: (args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            status: 'success',
            summary: `Curated ${args.targetCount} asset(s).`,
            selectionHandle: {
              id: '00000000-0000-4000-8000-000000000334',
              assetCount: args.targetCount,
            },
            selectedAssetCount: args.targetCount,
            sourceAssetCount: 3,
            criteriaSummary: ['cover-candidate selected a deterministic cover candidate.'],
          },
        },
      },
    }),
  },
];

const metadataHighlightHandlers = ({
  assetIds = highlightAssetIds,
  metadataAssets = defaultHighlightMetadataAssets(),
  totalCount,
  albums = [],
  albumAssetIds = [],
  searchHandleId = '00000000-0000-4000-8000-000000000901',
  curatedHandleId = '00000000-0000-4000-8000-000000000902',
  curatedCount,
} = {}) => [
  {
    name: 'searchAssets',
    handle: (args, request) => {
      const returnedAssetIds = assetIds.slice(0, args.limit ?? assetIds.length);
      if (args.detail === 'handle') {
        return {
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              structuredContent: {
                status: 'success',
                summary: `Returned ${returnedAssetIds.length} highlight candidate(s).`,
                detail: 'handle',
                selectionHandle: {
                  id: searchHandleId,
                  assetCount: totalCount ?? assetIds.length,
                },
                returnedCount: returnedAssetIds.length,
                hasMore: assetIds.length > returnedAssetIds.length,
                nextPage: assetIds.length > returnedAssetIds.length ? '2' : null,
                resultSize: returnedAssetIds.length,
                ...(totalCount === undefined ? {} : { totalCount }),
              },
            },
          },
        };
      }

      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              summary: `Returned ${returnedAssetIds.length} highlight candidate(s).`,
              detail: 'ids',
              assetIds: returnedAssetIds,
              returnedCount: returnedAssetIds.length,
              hasMore: assetIds.length > returnedAssetIds.length,
              nextPage: assetIds.length > returnedAssetIds.length ? '2' : null,
              ...(totalCount === undefined ? {} : { totalCount }),
            },
          },
        },
      };
    },
  },
  {
    name: 'readAssetMetadata',
    handle: (args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            summary: `Returned metadata for ${args.assetIds.length} asset(s).`,
            fields: args.fields,
            assets: args.assetIds.map((id) => metadataAssets.find((asset) => asset.id === id)).filter(Boolean),
          },
        },
      },
    }),
  },
  {
    name: 'curateSelection',
    handle: (args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            status: 'success',
            summary: `Curated ${curatedCount ?? args.targetCount} highlight(s).`,
            selectionHandle: {
              id: curatedHandleId,
              assetCount: curatedCount ?? args.targetCount,
            },
            selectedAssetCount: curatedCount ?? args.targetCount,
            sourceAssetCount: assetIds.length,
            criteriaSummary: args.criteria,
          },
        },
      },
    }),
  },
  {
    name: 'proposeAlbumFromSelection',
    handle: (args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            status: 'success',
            summary: 'Stored proposed album from selection.',
            plan: { id: '00000000-0000-4000-8000-000000000303' },
            received: args,
          },
        },
      },
    }),
  },
  {
    name: 'proposeAssetBatchFromSelection',
    handle: (args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            status: 'success',
            summary: 'Stored proposed asset batch from selection.',
            plan: { id: '00000000-0000-4000-8000-000000000304' },
            received: args,
          },
        },
      },
    }),
  },
  {
    name: 'listAlbums',
    handle: (_args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: { albums },
        },
      },
    }),
  },
  {
    name: 'readAlbum',
    handle: (args, request) => {
      const album = albums.find((candidate) => candidate.id === args.albumId);
      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              album: {
                ...album,
                assetCount: albumAssetIds.length,
                assetIds: albumAssetIds,
              },
            },
          },
        },
      };
    },
  },
  successHandlers()[1],
];

const tripCandidateHandlers = ({
  candidates = [makeTripCandidateSummary()],
  recommendation = {
    action: 'use_top_candidate',
    candidateDedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
    reason: 'The only readable trip candidate is high confidence.',
  },
  expectedPlaceHint = 'USA',
  expectedAlbumName = 'USA Trip',
  expectedSelectionHandleId,
  expectedHighlightCount = 10,
  selectedAssetCount = expectedHighlightCount,
  planResponse,
  planError,
} = {}) => [
  {
    name: 'findTripCandidates',
    handle: (args, request) => {
      assert.deepEqual(args, expectedPlaceHint === null ? {} : { placeHint: expectedPlaceHint });
      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              summary: candidates.length === 0
                ? 'No trip candidates found matching "USA".'
                : `Found ${candidates.length} trip candidate(s) matching "USA".`,
              recommendation,
              candidates,
            },
          },
        },
      };
    },
  },
  {
    name: 'curateSelection',
    handle: (args, request) => {
      assert.deepEqual(args, {
        selectionHandleId: tripCandidateHandleId,
        targetCount: expectedHighlightCount,
        strategy: 'metadata-highlights',
        criteria: 'top metadata-only highlights from USA Trip',
        sampleSize: 10,
      });
      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              selectionHandle: { id: tripCandidateCuratedHandleId, assetCount: selectedAssetCount },
              selectedAssetCount,
              sourceAssetCount: candidates[0]?.selectionHandle?.assetCount ?? 0,
              criteriaSummary: ['metadata-only highlights from the trip candidate handle'],
            },
          },
        },
      };
    },
  },
  {
    name: 'proposeAlbumFromSelection',
    handle: (args, request) => {
      assert.equal(args.albumName, expectedAlbumName);
      if (expectedSelectionHandleId) {
        assert.equal(args.selectionHandleId, expectedSelectionHandleId);
      }
      if (planError) {
        return {
          body: {
            jsonrpc: '2.0',
            id: request.id,
            error: planError,
          },
        };
      }

      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: planResponse ?? {
              status: 'success',
              summary: 'Stored proposed album from selection.',
              plan: { id: '00000000-0000-4000-8000-000000000923' },
              received: args,
            },
          },
        },
      };
    },
  },
];

const usaTripHandleFirstHandlers = ({
  expectedFilters = {
    country: 'USA',
    takenAfter: '2026-01-01T00:00:00.000Z',
    takenBefore: '2026-02-01T00:00:00.000Z',
  },
  expectedTargetCount = 15,
  expectedCriteria = 'top highlights from January 2026 USA trip',
  searchAssetCount = 80,
  selectedAssetCount = expectedTargetCount,
  expectedAlbumName = 'USA Highlights',
} = {}) => [
  {
    name: 'searchAssets',
    handle: (args, request) => {
      assert.deepEqual(args, {
        filters: expectedFilters,
        detail: 'handle',
        limit: 1000,
      });
      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              selectionHandle: { id: usaTripSearchHandleId, assetCount: searchAssetCount },
              assetCount: searchAssetCount,
              detail: 'handle',
              returnedCount: searchAssetCount,
              hasMore: false,
              nextPage: null,
              resultSize: searchAssetCount,
            },
          },
        },
      };
    },
  },
  {
    name: 'curateSelection',
    handle: (args, request) => {
      assert.deepEqual(args, {
        selectionHandleId: usaTripSearchHandleId,
        targetCount: expectedTargetCount,
        strategy: 'metadata-highlights',
        criteria: expectedCriteria,
        sampleSize: 10,
      });
      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              selectionHandle: { id: usaTripCuratedHandleId, assetCount: selectedAssetCount },
              selectedAssetCount,
              sourceAssetCount: searchAssetCount,
              criteriaSummary: expectedCriteria,
            },
          },
        },
      };
    },
  },
  {
    name: 'proposeAlbumFromSelection',
    handle: (args, request) => {
      assert.deepEqual(args, {
        summary: `Create ${expectedAlbumName} with ${selectedAssetCount} metadata-only curated highlights.`,
        albumName: expectedAlbumName,
        description: 'Suggested highlights selected from metadata signals. No previews were inspected.',
        selectionHandleId: usaTripCuratedHandleId,
      });
      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              plan: { id: '00000000-0000-4000-8000-000000000305' },
            },
          },
        },
      };
    },
  },
];

const previewReference = (assetId) => ({
  assetId,
  mediaUrl: `/api/assets/${assetId}/thumbnail?size=preview`,
  mimeType: 'image/jpeg',
  fileName: `${assetId}.jpg`,
  width: 1024,
  height: 768,
});

const previewHighlightHandlers = (options = {}) => {
  const handlers = metadataHighlightHandlers(options);
  return [
    handlers[0],
    handlers[1],
    {
      name: 'readAssetPreviews',
      handle: (args, request) => ({
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              previews: args.assetIds.map(previewReference),
            },
          },
        },
      }),
    },
    handlers.find((handler) => handler.name === 'curateSelection'),
    handlers.find((handler) => handler.name === 'proposeAlbumFromSelection'),
    handlers.find((handler) => handler.name === 'proposeAssetBatchFromSelection'),
    handlers.find((handler) => handler.name === 'listAlbums'),
    handlers.find((handler) => handler.name === 'readAlbum'),
    handlers.find((handler) => handler.name === 'proposeAlbumOperations'),
  ];
};

describe('e2e runtime', () => {
  it('creates a runner session without exposing runner-owned Gallery tool names', async () => {
    const runtime = createE2eRuntime();

    const session = await runtime.createSession(createSessionBody());

    assert.equal(runtime.getCapabilities().runtime, 'e2e');
    assert.deepEqual(runtime.getCapabilities().tools, ['mcp:gallery']);
    assert.equal(session.runnerSessionId, runnerSessionId);
    assert.equal(session.capabilities.protocolVersion, '2026-05-14');
    assert.equal(session.capabilities.streaming, true);
    assert.equal(session.capabilities.models.includes('e2e-album-organizer'), true);
    assert.deepEqual(session.capabilities.tools, ['mcp:gallery']);
    assert.equal(JSON.stringify(session).includes(token), false);
  });

  it('searches visible assets and proposes a deterministic album plan through selection handles', async () => {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create a Portugal trip album.');

    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, gateway.url);
    assert.equal(calls[0].body.method, 'tools/call');
    assert.equal(calls[0].body.params.name, 'searchAssets');
    assert.deepEqual(calls[0].body.params.arguments, { filters: { isNotInAlbum: true }, limit: 3, detail: 'handle' });
    assert.equal(calls[0].authorization, `Bearer ${token}`);
    assert.equal(calls[1].url, gateway.url);
    assert.equal(calls[1].body.method, 'tools/call');
    assert.equal(calls[1].body.params.name, 'curateSelection');
    assert.deepEqual(calls[1].body.params.arguments, {
      selectionHandleId: '00000000-0000-4000-8000-000000000333',
      targetCount: 1,
      strategy: 'cover-candidate',
      sampleSize: 0,
    });
    assert.equal(calls[2].url, gateway.url);
    assert.equal(calls[2].body.method, 'tools/call');
    assert.equal(calls[2].body.params.name, 'proposeAlbumOperations');
    assert.equal(JSON.stringify(calls[0].body).includes(token), false);
    assert.equal(calls[2].body.params.arguments.summary, 'Create Portugal Trip and add 2 loose assets.');
    assert.deepEqual(
      calls[2].body.params.arguments.operations.map((operation) => operation.type),
      ['album.create', 'album.addAssets', 'album.setCover'],
    );
    assert.equal(
      calls[2].body.params.arguments.operations[1].assetSelectionHandleId,
      '00000000-0000-4000-8000-000000000333',
    );
    assert.equal(
      calls[2].body.params.arguments.operations[2].assetSelectionHandleId,
      '00000000-0000-4000-8000-000000000334',
    );
    assert.equal(JSON.stringify(calls[2].body.params.arguments).includes('assetIds'), false);
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /I proposed a Portugal Trip album/);
  });

  it('reports a missing search selection handle before creating a proposal', async () => {
    const { calls, fetchImplementation } = createFetch([
      {
        name: 'searchAssets',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              structuredContent: {
                status: 'success',
                returnedCount: 3,
                hasMore: false,
              },
            },
          },
        }),
      },
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create a Portugal trip album.');

    assert.equal(calls.length, 1);
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /Gallery denied the album organization request/);
    assert.match(events.at(-1).content.blocks[0].text, /selection handle/i);
  });

  it('proposes a metadata description plan from a newest-photos prompt', async () => {
    const { calls, fetchImplementation } = createFetch([
      ...successHandlers(),
      {
        name: 'proposeAssetBatchFromSelection',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              structuredContent: {
                status: 'success',
                summary: 'Stored proposed asset batch from selection.',
                plan: { id: '00000000-0000-4000-8000-000000000304' },
              },
            },
          },
        }),
      },
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Set the description on the 5 newest photos to Test batch.');

    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.params.name, 'searchAssets');
    assert.equal(calls[1].body.params.name, 'proposeAssetBatchFromSelection');
    assert.equal(calls[1].body.params.arguments.action.type, 'asset.updateMetadata');
    assert.equal(calls[1].body.params.arguments.action.description, 'Test batch.');
    assert.match(events.at(-1).content.blocks[0].text, /description/i);
  });

  it('proposes a metadata coordinate plan only when latitude and longitude are present', async () => {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Set these photos to latitude 48.8566 and longitude 2.3522.');

    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.params.name, 'proposeAssetBatchFromSearch');
    assert.deepEqual(calls[1].body.params.arguments.action, {
      type: 'asset.updateMetadata',
      latitude: 48.8566,
      longitude: 2.3522,
    });
    assert.match(events.at(-1).content.blocks[0].text, /coordinates/i);
  });

  it('asks for coordinates instead of planning a place-name metadata edit', async () => {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Set these photos to Paris.');

    assert.equal(calls.length, 0);
    assert.match(events.at(-1).content.blocks[0].text, /latitude and longitude/i);
  });

  it('asks for longitude instead of planning an incomplete coordinate edit', async () => {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Set these photos to latitude 48.8566.');

    assert.equal(calls.length, 0);
    assert.match(events.at(-1).content.blocks[0].text, /longitude/i);
  });

  it('asks for a bounded source before curating best photos from the whole library', async () => {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Pick the best photos from my library.');

    assert.equal(calls.length, 0);
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /bounded source/i);
    assert.match(events.at(-1).content.blocks[0].text, /which .*source|which .*set/i);
    assert.match(events.at(-1).content.blocks[0].text, /\?/);
    assert.match(events.at(-1).content.blocks[0].text, /album|shared space|date range|selected photos/i);
  });

  it('proposes a metadata-only highlight album planning through selection handles', async () => {
    const { calls, fetchImplementation } = createFetch(metadataHighlightHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(
      runtime,
      'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
    );

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets,curateSelection,proposeAlbumFromSelection');
    assert.deepEqual(calls[0].body.params.arguments, {
      filters: lastWeekendHighlightFilters,
      detail: 'handle',
      limit: 1000,
    });
    assert.equal(calls[1].body.params.arguments.selectionHandleId, usaTripSearchHandleId);
    assert.equal(calls[1].body.params.arguments.targetCount, 2);
    const plan = calls[2].body.params.arguments;
    assert.match(plan.summary, /metadata-only/i);
    assert.equal(plan.albumName, 'Weekend Highlights');
    assert.equal(plan.selectionHandleId, usaTripCuratedHandleId);
    assert.equal(JSON.stringify(plan).includes('assetIds'), false);
    assert.match(events.at(-1).content.blocks[0].text, /metadata-only/i);
    assert.match(events.at(-1).content.blocks[0].text, /2 suggested highlights/i);
    assert.match(events.at(-1).content.blocks[0].text, /Review/i);
  });

  it('creates a generic USA recent-trip album from the trip candidate handle without asking for dates', async () => {
    const { calls, fetchImplementation } = createFetch(tripCandidateHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.deepEqual(calls[0].body.params.arguments, { placeHint: 'USA' });
    assert.equal(calls[1].body.params.arguments.albumName, 'USA Trip');
    assert.equal(calls[1].body.params.arguments.selectionHandleId, tripCandidateHandleId);
    assert.equal(JSON.stringify(calls).includes('assetIds'), false);
    assert.doesNotMatch(events.at(-1).content.blocks[0].text, /need.*date|rough dates/i);
    assert.match(events.at(-1).content.blocks[0].text, /May 3-12, 2026/i);
    assert.match(events.at(-1).content.blocks[0].text, /skipped 3 known duplicate variants and 1 stack child/i);
    assert.match(events.at(-1).content.blocks[0].text, /Review/i);
  });

  it('creates a recent-trip album without a place hint after calling the detector with no arguments', async () => {
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({ expectedPlaceHint: null, expectedAlbumName: 'Recent Trip' }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.deepEqual(calls[0].body.params.arguments, {});
    assert.equal(calls[1].body.params.arguments.albumName, 'Recent Trip');
    assert.match(events.at(-1).content.blocks[0].text, /Review/i);
  });

  it('creates trip highlights through findTripCandidates, curation, and a reviewable album plan', async () => {
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        expectedHighlightCount: 15,
        selectedAssetCount: 15,
        expectedAlbumName: 'USA Highlights',
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(
      runtime,
      'Create an album of the top 15 highlights for my recent trip to USA called USA Highlights.',
    );

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,curateSelection,proposeAlbumFromSelection');
    assert.equal(calls[1].body.params.arguments.selectionHandleId, tripCandidateHandleId);
    assert.equal(calls[1].body.params.arguments.targetCount, 15);
    assert.equal(calls[2].body.params.arguments.albumName, 'USA Highlights');
    assert.equal(calls[2].body.params.arguments.selectionHandleId, tripCandidateCuratedHandleId);
    assert.equal(JSON.stringify(calls).includes('assetIds'), false);
    assert.match(events.at(-1).content.blocks[0].text, /15 metadata-only suggested highlights/i);
    assert.match(events.at(-1).content.blocks[0].text, /Review/i);
  });

  it('defaults recent-trip highlights to 10 when no count is provided', async () => {
    const { calls, fetchImplementation } = createFetch(tripCandidateHandlers({ expectedAlbumName: 'USA Highlights' }));
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    await collectEvents(runtime, 'Create an album of the top highlights for my recent trip to USA');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,curateSelection,proposeAlbumFromSelection');
    assert.equal(calls[1].body.params.arguments.targetCount, 10);
  });

  it('detects the recent trip before asking for a valid explicit highlight count', async () => {
    const { calls, fetchImplementation } = createFetch(tripCandidateHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album of the top 0 highlights for my recent trip to USA');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
    assert.match(events.at(-1).content.blocks[0].text, /positive count/i);
  });

  it('asks one question with candidate labels when the trip tool recommends asking the user', async () => {
    const candidates = [
      makeTripCandidateSummary({ title: 'Recent trip to New York, USA', dedupeKey: 'trip:ny', score: 95 }),
      makeTripCandidateSummary({
        title: 'Recent trip to California, USA',
        dedupeKey: 'trip:ca',
        placeLabels: ['California, USA'],
        score: 40,
      }),
    ];
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        candidates,
        recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
    assert.match(events.at(-1).content.blocks[0].text, /New York, USA/i);
    assert.match(events.at(-1).content.blocks[0].text, /California, USA/i);
    assert.match(events.at(-1).content.blocks[0].text, /\?$/);
  });

  it('asks about one possible trip when the trip tool asks for confirmation on a single candidate', async () => {
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        candidates: [makeTripCandidateSummary({ confidence: 'medium' })],
        recommendation: { action: 'ask_user', reason: 'The best matching trip candidate is not high confidence.' },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
    assert.match(events.at(-1).content.blocks[0].text, /New York, USA/i);
    assert.doesNotMatch(events.at(-1).content.blocks[0].text, /multiple possible recent trips/i);
    assert.match(events.at(-1).content.blocks[0].text, /\?$/);
  });

  it('does not plan when no trip candidate is found and asks for one concrete source', async () => {
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        candidates: [],
        recommendation: { action: 'none', reason: 'No readable trip candidates matched the request.' },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
    assert.match(events.at(-1).content.blocks[0].text, /could not find a likely recent trip/i);
    assert.match(events.at(-1).content.blocks[0].text, /date range or place/i);
    assert.doesNotMatch(events.at(-1).content.blocks[0].text, /Review the plan/i);
  });

  it('does not claim a strict recent-trip plan when planning returns no plan id', async () => {
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        planResponse: { status: 'success', summary: 'Stored proposal without a plan id.' },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.match(events.at(-1).content.blocks[0].text, /could not create a reviewable album plan/i);
    assert.doesNotMatch(events.at(-1).content.blocks[0].text, /plan is ready|I created|I proposed|Review the plan/i);
  });

  it('does not claim a strict recent-trip plan when planning is denied', async () => {
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        planResponse: { status: 'denied', reason: 'Search source did not match any assets raw tool detail' },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.match(events.at(-1).content.blocks[0].text, /planning tool returned status "denied" for proposeAlbumFromSelection/i);
    assert.doesNotMatch(events.at(-1).content.blocks[0].text, /Search source did not match any assets|raw tool detail/i);
    assert.doesNotMatch(events.at(-1).content.blocks[0].text, /plan is ready|I created|I proposed|Review the plan/i);
  });

  it('does not plan a strict recent-trip album for a zero-asset candidate handle', async () => {
    const zeroCandidate = makeTripCandidateSummary({ selectionHandle: { id: tripCandidateHandleId, assetCount: 0 } });
    const { calls, fetchImplementation } = createFetch(tripCandidateHandlers({ candidates: [zeroCandidate] }));
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
    assert.match(events.at(-1).content.blocks[0].text, /found no album-ready assets/i);
  });

  it('pauses strict recent-trip planning when proposal approval is required', async () => {
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        planResponse: {
          status: 'approval-required',
          toolCall: { id: '00000000-0000-4000-8000-000000000999' },
        },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.deepEqual(
      events.map((event) => event.type),
      ['workflow-state-update', 'tool-approval-needed'],
    );
    assert.equal(events[0].workflowState.kind, 'approval');
    assert.deepEqual(events.at(-1), {
      type: 'tool-approval-needed',
      sessionId: gallerySessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000999',
    });
  });

  it('resumes a strict recent-trip album after the user selects a candidate label', async () => {
    const candidates = [
      makeTripCandidateSummary({ title: 'Recent trip to New York, USA', dedupeKey: 'trip:ny', score: 90 }),
      makeTripCandidateSummary({
        title: 'Recent trip to California, USA',
        dedupeKey: 'trip:ca',
        placeLabels: ['California, USA'],
        selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
        score: 88,
      }),
    ];
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        candidates,
        recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
        expectedSelectionHandleId: '00000000-0000-4000-8000-000000000930',
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    await collectEvents(runtime, 'Create an album for my recent trip to USA');
    const followUp = await collectEvents(runtime, 'Use California');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.equal(calls[1].body.params.arguments.selectionHandleId, '00000000-0000-4000-8000-000000000930');
    assert.equal(calls[1].body.params.arguments.albumName, 'USA Trip');
    assert.match(followUp.at(-1).content.blocks[0].text, /Review the plan before applying it/);
  });

  it('pauses strict recent-trip planning when a candidate follow-up requires approval', async () => {
    const candidates = [
      makeTripCandidateSummary({ title: 'Recent trip to New York, USA', dedupeKey: 'trip:ny', score: 90 }),
      makeTripCandidateSummary({
        title: 'Recent trip to California, USA',
        dedupeKey: 'trip:ca',
        placeLabels: ['California, USA'],
        selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
        score: 88,
      }),
    ];
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        candidates,
        recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
        expectedSelectionHandleId: '00000000-0000-4000-8000-000000000930',
        planResponse: {
          status: 'approval-required',
          toolCall: { id: '00000000-0000-4000-8000-000000000999' },
        },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    await collectEvents(runtime, 'Create an album for my recent trip to USA');
    const followUp = await collectEvents(runtime, 'Use California');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.deepEqual(
      followUp.map((event) => event.type),
      ['workflow-state-update', 'tool-approval-needed'],
    );
    assert.equal(followUp[0].workflowState.kind, 'approval');
    assert.deepEqual(followUp.at(-1), {
      type: 'tool-approval-needed',
      sessionId: gallerySessionId,
      runnerSessionId,
      toolCallId: '00000000-0000-4000-8000-000000000999',
    });
  });

  it('renames a pending strict recent-trip album from the follow-up', async () => {
    const candidates = [
      makeTripCandidateSummary({ title: 'Recent trip to New York, USA', dedupeKey: 'trip:ny' }),
      makeTripCandidateSummary({
        title: 'Recent trip to California, USA',
        dedupeKey: 'trip:ca',
        placeLabels: ['California, USA'],
        selectionHandle: { id: '00000000-0000-4000-8000-000000000930', assetCount: 14 },
      }),
    ];
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        candidates,
        recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
        expectedAlbumName: 'West Coast',
        expectedSelectionHandleId: '00000000-0000-4000-8000-000000000930',
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    await collectEvents(runtime, 'Create an album for my recent trip to USA');
    await collectEvents(runtime, 'Use California called West Coast');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.equal(calls[1].body.params.arguments.albumName, 'West Coast');
  });

  it('asks the user to rerun after pending strict trip choices expire', async () => {
    let nowMs = 1000;
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        candidates: [
          makeTripCandidateSummary({ title: 'Recent trip to New York, USA', dedupeKey: 'trip:ny' }),
          makeTripCandidateSummary({
            title: 'Recent trip to California, USA',
            dedupeKey: 'trip:ca',
            placeLabels: ['California, USA'],
          }),
        ],
        recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation, now: () => nowMs });
    await runtime.createSession(createSessionBody());

    await collectEvents(runtime, 'Create an album for my recent trip to USA');
    nowMs += 10 * 60 * 1000 + 1;
    const followUp = await collectEvents(runtime, 'first one');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
    assert.match(followUp.at(-1).content.blocks[0].text, /expired/i);
    assert.match(followUp.at(-1).content.blocks[0].text, /rerun the recent trip album request/i);
  });

  it('does not pause strict recent-trip planning when proposal approval has no tool call id', async () => {
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        planResponse: {
          status: 'approval-required',
          toolCall: { id: '' },
        },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');
    const text = events.at(-1).content.blocks[0].text;

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(text, /could not create a reviewable album plan/i);
    assert.doesNotMatch(text, /plan is ready|I created|I proposed|Review the plan/i);
  });

  it('returns safe strict recent-trip failure text when planning JSON-RPC errors', async () => {
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        planError: {
          code: -32001,
          message: `gateway token ${token} secret-value rejected`,
        },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');
    const text = events.at(-1).content.blocks[0].text;

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.match(text, /\[redacted\]/);
    assert.doesNotMatch(text, new RegExp(token));
    assert.doesNotMatch(text, /secret-value|plan is ready|I created|I proposed|Review the plan/i);
  });

  it('redacts credential-shaped strict recent-trip JSON-RPC errors', async () => {
    const rawValues = [
      'auth-token-123',
      'bearer-token-456',
      'query-api-key-789',
      'header-api-key-abc',
      'spaced-api-key-def',
      'password-value-123',
      'password-value-456',
      'secret-equals-123',
      'secret-colon-456',
      'secret-word-789',
      'token-word-abc',
      'secret-value-extra',
    ];
    const { calls, fetchImplementation } = createFetch(
      tripCandidateHandlers({
        planError: {
          code: -32001,
          message: [
            'Authorization: Bearer auth-token-123',
            'Bearer bearer-token-456',
            'api_key=query-api-key-789',
            'apiKey: header-api-key-abc',
            'api-key spaced-api-key-def',
            'password=password-value-123',
            'password: password-value-456',
            'secret=secret-equals-123',
            'secret: secret-colon-456',
            'secret value secret-word-789',
            'token token-word-abc',
            'secret-value-extra',
          ].join(' '),
        },
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');
    const text = events.at(-1).content.blocks[0].text;

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
    assert.match(text, /\[redacted\]/);
    for (const rawValue of rawValues) {
      assert.equal(text.includes(rawValue), false, rawValue);
    }
    assert.doesNotMatch(text, /plan is ready|I created|I proposed|Review the plan/i);
  });

  it('creates USA trip highlights through search handle, curation handle, and selection plan without raw ids', async () => {
    const { calls, fetchImplementation } = createFetch(usaTripHandleFirstHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(
      runtime,
      'Create an album of the top 15 highlights from my January 2026 USA trip called USA Highlights.',
    );

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets,curateSelection,proposeAlbumFromSelection');
    assert.equal(JSON.stringify(calls).includes('assetIds'), false);
    assert.match(events.at(-1).content.blocks[0].text, /metadata-only/i);
    assert.match(events.at(-1).content.blocks[0].text, /15 suggested highlights/i);
    assert.match(events.at(-1).content.blocks[0].text, /Review/i);
  });

  it('creates January 2026 U.S. trip highlights with USA date filters', async () => {
    const { calls, fetchImplementation } = createFetch(
      usaTripHandleFirstHandlers({ expectedAlbumName: 'Trip Highlights' }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(
      runtime,
      'Create an album of the top 15 highlights from my January 2026 U.S. trip called Trip Highlights.',
    );

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets,curateSelection,proposeAlbumFromSelection');
    assert.equal(JSON.stringify(calls).includes('assetIds'), false);
    assert.match(events.at(-1).content.blocks[0].text, /15 suggested highlights/i);
  });

  it('uses generic metadata criteria for non-January USA trip highlights', async () => {
    const { calls, fetchImplementation } = createFetch(
      usaTripHandleFirstHandlers({
        expectedFilters: { country: 'USA' },
        expectedTargetCount: 5,
        expectedCriteria: 'top metadata-only highlights from the bounded source',
        searchAssetCount: 25,
        selectedAssetCount: 5,
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(
      runtime,
      'Create an album of the top 5 highlights from my USA trip called USA Highlights.',
    );

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets,curateSelection,proposeAlbumFromSelection');
    assert.equal(JSON.stringify(calls).includes('assetIds'), false);
    assert.match(events.at(-1).content.blocks[0].text, /5 suggested highlights/i);
  });

  it('reads previews after bounded candidates for preview-assisted highlight album planning', async () => {
    const { calls, fetchImplementation } = createFetch(previewHighlightHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

    const events = await collectEvents(
      runtime,
      'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
    );

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'searchAssets,readAssetMetadata,readAssetPreviews,proposeAlbumOperations',
    );
    assert.equal(calls[0].body.params.arguments.limit, 250);
    assert.deepEqual(calls[2].body.params.arguments, { assetIds: highlightAssetIds });
    const plan = calls[3].body.params.arguments;
    assert.match(plan.summary, /preview-assisted/i);
    assert.equal(JSON.stringify(plan).includes('readAssetOriginals'), false);
    assert.equal(JSON.stringify(plan.operations).includes('metadata-only'), false);
    assert.equal(JSON.stringify(plan.operations).includes('No previews were inspected'), false);
    assert.deepEqual(plan.operations[1].assetIds, [
      '00000000-0000-4000-8000-000000000402',
      '00000000-0000-4000-8000-000000000403',
    ]);
    assert.match(events.at(-1).content.blocks[0].text, /preview-assisted/i);
  });

  it('asks to narrow before preview-assisted highlight planning above the preview limit', async () => {
    const oversizedAssetIds = Array.from(
      { length: 251 },
      (_value, index) => `00000000-0000-4000-8000-${String(2000 + index).padStart(12, '0')}`,
    );
    const { calls, fetchImplementation } = createFetch(previewHighlightHandlers({ assetIds: oversizedAssetIds }));
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

    const events = await collectEvents(
      runtime,
      'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
    );

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets');
    assert.equal(calls[0].body.params.arguments.limit, 250);
    assert.match(events.at(-1).content.blocks[0].text, /too many/i);
    assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
  });

  it('falls back to metadata-only highlights when preview reads are denied', async () => {
    const handlers = previewHighlightHandlers();
    handlers[2] = {
      name: 'readAssetPreviews',
      handle: (_args, request) => ({
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'denied',
              summary: 'Preview reads are denied in this session',
            },
          },
        },
      }),
    };
    const { calls, fetchImplementation } = createFetch(handlers);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

    const events = await collectEvents(
      runtime,
      'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
    );

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'searchAssets,readAssetMetadata,readAssetPreviews,proposeAlbumOperations',
    );
    assert.match(calls.at(-1).body.params.arguments.summary, /metadata-only/i);
    assert.match(events.at(-1).content.blocks[0].text, /previews were unavailable/i);
  });

  it('keeps provider-without-image-input highlight planning metadata-only without preview reads', async () => {
    const { calls, fetchImplementation } = createFetch(previewHighlightHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: false } }));

    const events = await collectEvents(
      runtime,
      'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
    );

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets,curateSelection,proposeAlbumFromSelection');
    assert.match(calls.at(-1).body.params.arguments.summary, /metadata-only/i);
    assert.match(events.at(-1).content.blocks[0].text, /metadata-only/i);
  });

  it('proposes exactly one preview-assisted album cover operation from a named album', async () => {
    const albums = [familyAlbumSummary()];
    const { calls, fetchImplementation } = createFetch(
      previewHighlightHandlers({
        albums,
        albumAssetIds: highlightAssetIds,
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

    const events = await collectEvents(runtime, 'Pick a better cover for Family.');

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'listAlbums,readAlbum,readAssetMetadata,readAssetPreviews,proposeAlbumOperations',
    );
    const plan = calls.at(-1).body.params.arguments;
    assert.match(plan.summary, /cover/i);
    assert.match(plan.summary, /preview-assisted/i);
    assert.deepEqual(plan.operations, [
      {
        type: 'album.setCover',
        summary: 'Set Family cover to a suggested highlight.',
        targetKind: 'existing_album',
        targetId: familyAlbumId,
        assetIds: ['00000000-0000-4000-8000-000000000402'],
        riskLevel: 'low',
        enabled: true,
        payload: {},
      },
    ]);
    assert.match(events.at(-1).content.blocks[0].text, /cover/i);
    assert.match(events.at(-1).content.blocks[0].text, /Review/i);
  });

  it('supports simple named album cover prompts', async () => {
    const albums = [familyAlbumSummary()];
    const { calls, fetchImplementation } = createFetch(
      previewHighlightHandlers({
        albums,
        albumAssetIds: highlightAssetIds,
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

    await collectEvents(runtime, 'Pick a cover for Family.');

    const plan = calls.at(-1).body.params.arguments;
    assert.deepEqual(
      plan.operations.map((operation) => operation.type),
      ['album.setCover'],
    );
    assert.deepEqual(plan.operations[0].assetIds, ['00000000-0000-4000-8000-000000000402']);
  });

  it('falls back to metadata-only cover selection when preview reads are denied', async () => {
    const albums = [familyAlbumSummary()];
    const handlers = previewHighlightHandlers({ albums, albumAssetIds: highlightAssetIds });
    handlers[2] = {
      name: 'readAssetPreviews',
      handle: (_args, request) => ({
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'denied',
              summary: 'Preview reads are denied in this session',
            },
          },
        },
      }),
    };
    const { calls, fetchImplementation } = createFetch(handlers);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

    const events = await collectEvents(runtime, 'Pick a better cover for Family.');

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'listAlbums,readAlbum,readAssetMetadata,readAssetPreviews,proposeAlbumOperations',
    );
    assert.match(calls.at(-1).body.params.arguments.summary, /metadata-only/i);
    assert.match(events.at(-1).content.blocks[0].text, /Previews were unavailable/i);
  });

  it('keeps provider-without-image-input cover selection metadata-only without preview reads', async () => {
    const albums = [familyAlbumSummary()];
    const { calls, fetchImplementation } = createFetch(
      previewHighlightHandlers({
        albums,
        albumAssetIds: highlightAssetIds,
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: false } }));

    const events = await collectEvents(runtime, 'Pick a better cover for Family.');

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'listAlbums,readAlbum,readAssetMetadata,proposeAlbumOperations',
    );
    assert.match(calls.at(-1).body.params.arguments.summary, /metadata-only/i);
    assert.match(events.at(-1).content.blocks[0].text, /metadata-only/i);
  });

  it('asks to narrow cover selection when a preview-capable album exceeds the preview limit', async () => {
    const albums = [familyAlbumSummary()];
    const oversizedAssetIds = Array.from(
      { length: 251 },
      (_value, index) => `00000000-0000-4000-8000-${String(3000 + index).padStart(12, '0')}`,
    );
    const { calls, fetchImplementation } = createFetch(
      previewHighlightHandlers({
        albums,
        albumAssetIds: oversizedAssetIds,
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

    const events = await collectEvents(runtime, 'Pick a better cover for Family.');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'listAlbums,readAlbum');
    assert.match(events.at(-1).content.blocks[0].text, /too many assets/i);
    assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
  });

  it('never reads originals for highlight or cover curation', async () => {
    const albums = [familyAlbumSummary()];
    const { calls, fetchImplementation } = createFetch([
      ...previewHighlightHandlers({ albums, albumAssetIds: highlightAssetIds }),
      {
        name: 'readAssetOriginals',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: { structuredContent: { originals: [] } },
          },
        }),
      },
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody({ initialContext: { providerSupportsImages: true } }));

    await collectEvents(runtime, 'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.');
    await collectEvents(runtime, 'Pick a better cover for Family.');

    assert.equal(calls.some((call) => call.body.params.name === 'readAssetOriginals'), false);
  });

  it('keeps favorite in a requested album name from becoming a favorite operation', async () => {
    const { calls, fetchImplementation } = createFetch(metadataHighlightHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    await collectEvents(runtime, 'Pick the best 2 photos from last weekend and make an album called Favorite Highlights.');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets,curateSelection,proposeAlbumFromSelection');
    const plan = calls[2].body.params.arguments;
    assert.equal(plan.albumName, 'Favorite Highlights');
    assert.equal(plan.selectionHandleId, usaTripCuratedHandleId);
    assert.equal(JSON.stringify(plan).includes('assetIds'), false);
  });

  it('parses album names before trailing source phrases in highlight album requests', async () => {
    const { calls, fetchImplementation } = createFetch(metadataHighlightHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    await collectEvents(runtime, 'Pick the best 2 photos and make an album called Weekend Highlights from last weekend.');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets,curateSelection,proposeAlbumFromSelection');
    const plan = calls[2].body.params.arguments;
    assert.equal(plan.albumName, 'Weekend Highlights');
    assert.equal(plan.selectionHandleId, usaTripCuratedHandleId);
    assert.equal(JSON.stringify(plan).includes('assetIds'), false);
  });

  it('adds metadata highlights to an existing album while excluding assets already in the album', async () => {
    const albums = [familyAlbumSummary()];
    const { calls, fetchImplementation } = createFetch(
      metadataHighlightHandlers({
        albums,
        albumAssetIds: ['00000000-0000-4000-8000-000000000402'],
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Add 2 highlights from last weekend to Family.');

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'listAlbums,readAlbum,searchAssets,readAssetMetadata,proposeAlbumOperations',
    );
    assert.deepEqual(calls[1].body.params.arguments, { albumId: familyAlbumId });
    assert.equal(calls[2].body.params.arguments.limit, 1000);
    const plan = calls.at(-1).body.params.arguments;
    assert.equal(JSON.stringify(plan).includes('assetSource'), false);
    assert.equal(JSON.stringify(plan).includes('previousSearch'), false);
    assert.deepEqual(plan.operations, [
      {
        type: 'album.addAssets',
        summary: 'Add 2 metadata-only suggested highlights to Family.',
        targetKind: 'existing_album',
        targetId: familyAlbumId,
        assetIds: [
          '00000000-0000-4000-8000-000000000403',
          '00000000-0000-4000-8000-000000000401',
        ],
        riskLevel: 'medium',
        enabled: true,
        payload: {},
      },
    ]);
    assert.match(events.at(-1).content.blocks[0].text, /excluded 1 already in Family/i);
  });

  it('parses existing-album names before trailing source phrases in add-highlight requests', async () => {
    const albums = [familyAlbumSummary()];
    const { calls, fetchImplementation } = createFetch(
      metadataHighlightHandlers({
        albums,
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    await collectEvents(runtime, 'Add 2 highlights to Family from last weekend.');

    assert.equal(
      calls.map((call) => call.body.params.name).join(','),
      'listAlbums,readAlbum,searchAssets,readAssetMetadata,proposeAlbumOperations',
    );
    assert.deepEqual(calls[1].body.params.arguments, { albumId: familyAlbumId });
    assert.equal(calls.at(-1).body.params.arguments.operations[0].targetId, familyAlbumId);
  });

  it('proposes favorite operations for metadata-only highlight selections', async () => {
    const { calls, fetchImplementation } = createFetch(metadataHighlightHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Favorite the best 2 photos from last weekend.');

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets,curateSelection,proposeAssetBatchFromSelection');
    const plan = calls[2].body.params.arguments;
    assert.deepEqual(plan.action, { type: 'asset.setFavorite', favorite: true });
    assert.equal(plan.selectionHandleId, usaTripCuratedHandleId);
    assert.equal(JSON.stringify(plan).includes('assetIds'), false);
    assert.match(events.at(-1).content.blocks[0].text, /favorite/i);
    assert.match(events.at(-1).content.blocks[0].text, /metadata-only/i);
  });

  it('plans available metadata highlights when fewer candidates than requested exist', async () => {
    const { calls, fetchImplementation } = createFetch(
      metadataHighlightHandlers({
        assetIds: highlightAssetIds,
        curatedCount: 2,
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(
      runtime,
      'Pick the best 5 photos from last weekend and make an album called Weekend Highlights.',
    );

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets,curateSelection,proposeAlbumFromSelection');
    assert.equal(calls[0].body.params.arguments.limit, 1000);
    assert.equal(calls[2].body.params.arguments.selectionHandleId, usaTripCuratedHandleId);
    assert.equal(JSON.stringify(calls[2].body.params.arguments).includes('assetIds'), false);
    assert.match(events.at(-1).content.blocks[0].text, /Only 2 eligible/i);
    assert.match(events.at(-1).content.blocks[0].text, /requested 5/i);
  });

  it('asks to narrow metadata highlight plans when the bounded source exceeds the metadata candidate limit', async () => {
    const oversizedAssetIds = Array.from(
      { length: 1001 },
      (_value, index) => `00000000-0000-4000-8000-${String(1000 + index).padStart(12, '0')}`,
    );
    const { calls, fetchImplementation } = createFetch(
      metadataHighlightHandlers({
        assetIds: oversizedAssetIds,
      }),
    );
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(
      runtime,
      'Pick the best 2 photos from last weekend and make an album called Weekend Highlights.',
    );

    assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets');
    assert.equal(calls[0].body.params.arguments.limit, 1000);
    assert.match(events.at(-1).content.blocks[0].text, /too many/i);
    assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
  });

  it('uses a default count of 10 for bounded highlight prompts without creating a plan', async () => {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Suggest highlights from last weekend.');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.params.name, 'searchAssets');
    assert.deepEqual(calls[0].body.params.arguments, {
      filters: lastWeekendHighlightFilters,
      detail: 'ids',
      limit: 10,
    });
    assert.match(events.at(-1).content.blocks[0].text, /default/i);
    assert.match(events.at(-1).content.blocks[0].text, /\b10\b/);
    assert.match(events.at(-1).content.blocks[0].text, /3 candidate/i);
  });

  it('asks for a concrete searchable source instead of searching all assets for unresolved album highlights', async () => {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Suggest 10 highlights from this album.');

    assert.equal(calls.length, 0);
    assert.match(events.at(-1).content.blocks[0].text, /current album context/i);
  });

  it('asks for a positive highlight count for zero or negative requests without creating a plan', async () => {
    for (const prompt of ['Suggest 0 highlights from this album.', 'Pick -3 best photos from this album.']) {
      const { calls, fetchImplementation } = createFetch(successHandlers());
      const runtime = createE2eRuntime({ fetch: fetchImplementation });
      await runtime.createSession(createSessionBody());

      const events = await collectEvents(runtime, prompt);

      assert.equal(calls.length, 0);
      assert.match(events.at(-1).content.blocks[0].text, /positive count/i);
    }
  });

  it('asks to narrow oversized highlight requests without creating a plan', async () => {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Suggest 1001 highlights from this album.');

    assert.equal(calls.length, 0);
    assert.match(events.at(-1).content.blocks[0].text, /1000 or fewer/i);
    assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
  });

  it('asks to narrow oversized bounded candidate sets without creating a plan', async () => {
    const { calls, fetchImplementation } = createFetch([
      {
        name: 'searchAssets',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              structuredContent: {
                status: 'success',
                assetIds: ['00000000-0000-4000-8000-000000000201'],
                returnedCount: 1001,
                hasMore: true,
              },
            },
          },
        }),
      },
      successHandlers()[1],
      successHandlers()[2],
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Suggest 10 highlights from last weekend.');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.params.name, 'searchAssets');
    assert.deepEqual(calls[0].body.params.arguments.filters, lastWeekendHighlightFilters);
    assert.match(events.at(-1).content.blocks[0].text, /too many/i);
    assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
  });

  it('asks to narrow when Gallery reports a known highlight total above the candidate limit', async () => {
    const { calls, fetchImplementation } = createFetch([
      {
        name: 'searchAssets',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              structuredContent: {
                status: 'success',
                assetIds: [
                  '00000000-0000-4000-8000-000000000201',
                  '00000000-0000-4000-8000-000000000202',
                ],
                returnedCount: 10,
                totalCount: 1001,
                hasMore: true,
              },
            },
          },
        }),
      },
      successHandlers()[1],
      successHandlers()[2],
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Suggest 10 highlights from last weekend.');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.params.name, 'searchAssets');
    assert.deepEqual(calls[0].body.params.arguments.filters, lastWeekendHighlightFilters);
    assert.match(events.at(-1).content.blocks[0].text, /too many/i);
    assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
  });

  it('does not treat ordinary pagination as an oversized highlight candidate set', async () => {
    const { calls, fetchImplementation } = createFetch([
      {
        name: 'searchAssets',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              structuredContent: {
                status: 'success',
                assetIds: [
                  '00000000-0000-4000-8000-000000000201',
                  '00000000-0000-4000-8000-000000000202',
                ],
                returnedCount: 10,
                hasMore: true,
              },
            },
          },
        }),
      },
      successHandlers()[1],
      successHandlers()[2],
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Suggest 10 highlights from last weekend.');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.params.name, 'searchAssets');
    assert.deepEqual(calls[0].body.params.arguments.filters, lastWeekendHighlightFilters);
    assert.doesNotMatch(events.at(-1).content.blocks[0].text, /too many/i);
    assert.match(events.at(-1).content.blocks[0].text, /10 candidate/i);
    assert.match(events.at(-1).content.blocks[0].text, /did not create a plan/i);
  });

  it('answers directly when a bounded highlight source has no candidates without creating a plan', async () => {
    const { calls, fetchImplementation } = createFetch([
      {
        name: 'searchAssets',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              structuredContent: {
                status: 'success',
                assetIds: [],
                returnedCount: 0,
                hasMore: false,
              },
            },
          },
        }),
      },
      successHandlers()[1],
      successHandlers()[2],
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Suggest 10 highlights from last weekend.');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.params.name, 'searchAssets');
    assert.deepEqual(calls[0].body.params.arguments.filters, lastWeekendHighlightFilters);
    assert.match(events.at(-1).content.blocks[0].text, /no matching/i);
    assert.match(events.at(-1).content.blocks[0].text, /did not create a plan/i);
  });

  describe('highlight curation acceptance smoke', () => {
    it('creates a highlights album from the current album context', async () => {
      const albums = [familyAlbumSummary()];
      const { calls, fetchImplementation } = createFetch(
        metadataHighlightHandlers({
          albums,
          albumAssetIds: currentAlbumAssetIds,
          metadataAssets: currentAlbumMetadataAssets(),
        }),
      );
      const runtime = createE2eRuntime({ fetch: fetchImplementation });
      await runtime.createSession(createSessionBody({ initialContext: currentAlbumSessionContext() }));

      const events = await collectEvents(
        runtime,
        'Suggest 5 highlights from this album and make an album called Highlights.',
      );

      assert.equal(calls.map((call) => call.body.params.name).join(','), 'readAlbum,readAssetMetadata,proposeAlbumOperations');
      assert.deepEqual(calls[0].body.params.arguments, { albumId: familyAlbumId });
      const plan = calls.at(-1).body.params.arguments;
      assert.equal(JSON.stringify(plan).includes('assetSource'), false);
      assert.equal(JSON.stringify(plan).includes('previousSearch'), false);
      assert.equal(plan.operations[0].payload.albumName, 'Highlights');
      assert.deepEqual(
        plan.operations.map((operation) => operation.type),
        ['album.create', 'album.addAssets'],
      );
      assert.equal(plan.operations[1].assetIds.length, 5);
      assert.match(plan.summary, /metadata-only/i);
      assert.match(events.at(-1).content.blocks[0].text, /5 suggested highlights|5 .*highlights/i);
      assert.match(events.at(-1).content.blocks[0].text, /Review/i);
    });

    it('favorites the best 3 photos from last weekend', async () => {
      const { calls, fetchImplementation } = createFetch(metadataHighlightHandlers());
      const runtime = createE2eRuntime({ fetch: fetchImplementation });
      await runtime.createSession(createSessionBody());

      const events = await collectEvents(runtime, 'Favorite the best 3 photos from last weekend.');

      assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets,curateSelection,proposeAssetBatchFromSelection');
      const plan = calls.at(-1).body.params.arguments;
      assert.equal(plan.summary, 'Favorite 3 metadata-only curated highlights.');
      assert.deepEqual(plan.action, { type: 'asset.setFavorite', favorite: true });
      assert.equal(plan.selectionHandleId, usaTripCuratedHandleId);
      assert.equal(JSON.stringify(plan).includes('assetIds'), false);
      assert.match(events.at(-1).content.blocks[0].text, /3 metadata-only suggested highlights/i);
    });

    it('picks a cover from the current album context', async () => {
      const albums = [familyAlbumSummary()];
      const { calls, fetchImplementation } = createFetch(
        previewHighlightHandlers({
          albums,
          albumAssetIds: currentAlbumAssetIds,
          metadataAssets: currentAlbumMetadataAssets(),
        }),
      );
      const runtime = createE2eRuntime({ fetch: fetchImplementation });
      await runtime.createSession(
        createSessionBody({ initialContext: { ...currentAlbumSessionContext(), providerSupportsImages: true } }),
      );

      const events = await collectEvents(runtime, 'Pick a cover from this album.');

      assert.equal(
        calls.map((call) => call.body.params.name).join(','),
        'readAlbum,readAssetMetadata,readAssetPreviews,proposeAlbumOperations',
      );
      assert.deepEqual(calls[0].body.params.arguments, { albumId: familyAlbumId });
      const plan = calls.at(-1).body.params.arguments;
      assert.deepEqual(
        plan.operations.map((operation) => operation.type),
        ['album.setCover'],
      );
      assert.equal(plan.operations[0].assetIds.length, 1);
      assert.match(plan.summary, /cover/i);
      assert.match(events.at(-1).content.blocks[0].text, /cover/i);
      assert.match(events.at(-1).content.blocks[0].text, /Review/i);
    });

    it('asks for scope and creates no plan for best photos from the library', async () => {
      const { calls, fetchImplementation } = createFetch(successHandlers());
      const runtime = createE2eRuntime({ fetch: fetchImplementation });
      await runtime.createSession(createSessionBody());

      const events = await collectEvents(runtime, 'Pick the best photos from my library.');

      assert.equal(calls.length, 0);
      assert.match(events.at(-1).content.blocks[0].text, /bounded source/i);
      assert.match(events.at(-1).content.blocks[0].text, /\?/);
    });

    it('proposes the 7 eligible current-album assets when 20 are requested', async () => {
      const sevenAssetIds = currentAlbumAssetIds.slice(0, 7);
      const albums = [familyAlbumSummary()];
      const { calls, fetchImplementation } = createFetch(
        metadataHighlightHandlers({
          albums,
          albumAssetIds: sevenAssetIds,
          metadataAssets: currentAlbumMetadataAssets().slice(0, 7),
        }),
      );
      const runtime = createE2eRuntime({ fetch: fetchImplementation });
      await runtime.createSession(createSessionBody({ initialContext: currentAlbumSessionContext() }));

      const events = await collectEvents(
        runtime,
        'Suggest 20 highlights from this album and make an album called Highlights.',
      );

      assert.equal(calls.map((call) => call.body.params.name).join(','), 'readAlbum,readAssetMetadata,proposeAlbumOperations');
      const plan = calls.at(-1).body.params.arguments;
      assert.equal(plan.operations[1].assetIds.length, 7);
      assert.match(events.at(-1).content.blocks[0].text, /Only 7 eligible candidates/i);
      assert.match(events.at(-1).content.blocks[0].text, /requested 20/i);
    });

    it('reports no matches and creates no plan for an empty bounded source', async () => {
      const { calls, fetchImplementation } = createFetch([
        {
          name: 'searchAssets',
          handle: (_args, request) => ({
            body: {
              jsonrpc: '2.0',
              id: request.id,
              result: {
                structuredContent: {
                  status: 'success',
                  assetIds: [],
                  returnedCount: 0,
                  hasMore: false,
                },
              },
            },
          }),
        },
        successHandlers()[1],
      ]);
      const runtime = createE2eRuntime({ fetch: fetchImplementation });
      await runtime.createSession(createSessionBody());

      const events = await collectEvents(runtime, 'Suggest highlights from last weekend.');

      assert.equal(calls.map((call) => call.body.params.name).join(','), 'searchAssets');
      assert.match(events.at(-1).content.blocks[0].text, /no matching/i);
      assert.match(events.at(-1).content.blocks[0].text, /did not create a plan/i);
    });

    it('does not fall back to broad search when current album asset ids are unavailable', async () => {
      const { calls, fetchImplementation } = createFetch([
        {
          name: 'readAlbum',
          handle: (_args, request) => ({
            body: {
              jsonrpc: '2.0',
              id: request.id,
              result: {
                structuredContent: {
                  album: familyAlbumSummary(),
                },
              },
            },
          }),
        },
        {
          name: 'searchAssets',
          handle: (_args, request) => ({
            body: {
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32000, message: 'current album highlight curation must not search broadly' },
            },
          }),
        },
        successHandlers()[1],
      ]);
      const runtime = createE2eRuntime({ fetch: fetchImplementation });
      await runtime.createSession(createSessionBody({ initialContext: currentAlbumSessionContext() }));

      const events = await collectEvents(
        runtime,
        'Suggest 5 highlights from this album and make an album called Highlights.',
      );

      assert.equal(calls.map((call) => call.body.params.name).join(','), 'readAlbum');
      assert.match(events.at(-1).content.blocks[0].text, /no matching/i);
      assert.match(events.at(-1).content.blocks[0].text, /did not create a plan/i);
    });

    it('reports current album read failures instead of throwing out of highlight curation', async () => {
      const { calls, fetchImplementation } = createFetch([
        {
          name: 'readAlbum',
          handle: (_args, request) => ({
            body: {
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32000, message: `album lookup denied with ${token}` },
            },
          }),
        },
        successHandlers()[1],
      ]);
      const runtime = createE2eRuntime({ fetch: fetchImplementation });
      await runtime.createSession(createSessionBody({ initialContext: currentAlbumSessionContext() }));

      const events = await collectEvents(
        runtime,
        'Suggest 5 highlights from this album and make an album called Highlights.',
      );

      assert.equal(calls.map((call) => call.body.params.name).join(','), 'readAlbum');
      assert.match(events.at(-1).content.blocks[0].text, /could not inspect highlight candidates/i);
      assert.equal(events.at(-1).content.blocks[0].text.includes(token), false);
    });
  });

  it('reports a denied proposal without leaking the gateway token', async () => {
    const { calls, fetchImplementation } = createFetch([
      {
        name: 'proposeAlbumOperations',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32000, message: `denied with ${token}` },
          },
        }),
      },
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create a denied test album.');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.params.name, 'proposeAlbumOperations');
    assert.equal(calls[0].body.params.arguments.summary, 'Denied Trip would use inaccessible assets.');
    assert.equal(
      calls[0].body.params.arguments.operations[1].assetSelectionHandleId,
      '00000000-0000-4000-8000-000000000014',
    );
    assert.equal(JSON.stringify(calls[0].body.params.arguments).includes('assetIds'), false);
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /Gallery denied the album organization request/);
    assert.equal(events.at(-1).content.blocks[0].text.includes(token), false);
    assert.match(events.at(-1).content.blocks[0].text, /\[redacted\]/);
  });

  it('reports insufficient visible assets without creating a proposal or leaking the gateway token', async () => {
    const { calls, fetchImplementation } = createFetch([
      {
        name: 'searchAssets',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              structuredContent: {
                status: 'success',
                selectionHandle: {
                  id: '00000000-0000-4000-8000-000000000333',
                  assetCount: 1,
                },
                returnedCount: 1,
              },
            },
          },
        }),
      },
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create a Portugal trip album.');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.params.name, 'searchAssets');
    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /needs at least two visible loose assets/);
    assert.equal(events.at(-1).content.blocks[0].text.includes(token), false);
  });

  it('reports MCP tool result errors without leaking the gateway token', async () => {
    const { fetchImplementation } = createFetch([
      {
        name: 'searchAssets',
        handle: (_args, request) => ({
          body: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              isError: true,
              content: [{ type: 'text', text: `tool failed with ${token}` }],
            },
          },
        }),
      },
    ]);
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, 'Create a Portugal trip album.');

    assert.equal(events.at(-1).type, 'assistant-message-completed');
    assert.match(events.at(-1).content.blocks[0].text, /Gallery denied the album organization request/);
    assert.equal(events.at(-1).content.blocks[0].text.includes(token), false);
    assert.match(events.at(-1).content.blocks[0].text, /\[redacted\]/);
  });

  it('rejects messages for unknown runner sessions', async () => {
    const runtime = createE2eRuntime();

    await assert.rejects(() => collectEvents(runtime, 'Create an album.'), /Runner session not found/);
  });
});
