import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AgentCurateSelectionToolResponseDto,
  AgentFindTripCandidatesToolRequestDto,
  AgentFindTripCandidatesToolResponseDto,
  AgentListAlbumsToolRequestDto,
  AgentListAlbumsToolResponseDto,
  AgentListSpacesToolRequestDto,
  AgentListSpacesToolResponseDto,
  AgentReadAlbumToolRequestDto,
  AgentReadAlbumToolResponseDto,
  AgentReadAssetMetadataToolRequestDto,
  AgentReadAssetMetadataToolResponseDto,
  AgentReadAssetOriginalsToolRequestDto,
  AgentReadAssetOriginalsToolResponseDto,
  AgentReadAssetPreviewsToolRequestDto,
  AgentReadAssetPreviewsToolResponseDto,
  AgentReadSelectionMetadataToolResponseDto,
  AgentReadSpaceToolRequestDto,
  AgentReadSpaceToolResponseDto,
  AgentReadToolRequestSchemas,
  AgentResolveAssetSearchFiltersToolResponseDto,
  AgentSearchAssetsToolRequestDto,
  AgentSearchAssetsToolResponseDto,
  AgentSearchUsersToolRequestDto,
  AgentSearchUsersToolResponseDto,
  AgentToolApprovalDto,
  AgentToolCallParamsDto,
  AgentToolCallResponseDto,
} from 'src/dtos/agent-tool.dto';
import {
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AssetType,
  AssetVisibility,
} from 'src/enum';
import { factory } from 'test/small.factory';
import z from 'zod';

type AgentReadAssetMetadataToolRequestInput = z.input<typeof AgentReadAssetMetadataToolRequestDto.schema>;
type AgentReadAssetPreviewsToolRequestInput = z.input<typeof AgentReadAssetPreviewsToolRequestDto.schema>;
type AgentReadAssetOriginalsToolRequestInput = z.input<typeof AgentReadAssetOriginalsToolRequestDto.schema>;
type AgentListAlbumsToolRequestInput = z.input<typeof AgentListAlbumsToolRequestDto.schema>;
type AgentListSpacesToolRequestInput = z.input<typeof AgentListSpacesToolRequestDto.schema>;
type AgentReadAlbumToolRequestInput = z.input<typeof AgentReadAlbumToolRequestDto.schema>;
type AgentReadSpaceToolRequestInput = z.input<typeof AgentReadSpaceToolRequestDto.schema>;
type AgentSearchUsersToolRequestInput = z.input<typeof AgentSearchUsersToolRequestDto.schema>;
type AgentToolApprovalInput = z.input<typeof AgentToolApprovalDto.schema>;

const parseRequest = (input: AgentReadAssetMetadataToolRequestInput) =>
  AgentReadAssetMetadataToolRequestDto.schema.safeParse(input);
const parseFindTripCandidatesRequest = (input: unknown) =>
  AgentFindTripCandidatesToolRequestDto.schema.safeParse(input);
const parseSearchAssetsRequest = (input: unknown) => AgentSearchAssetsToolRequestDto.schema.safeParse(input);
const parseReadAssetPreviewsRequest = (input: AgentReadAssetPreviewsToolRequestInput) =>
  AgentReadAssetPreviewsToolRequestDto.schema.safeParse(input);
const parseReadAssetOriginalsRequest = (input: AgentReadAssetOriginalsToolRequestInput) =>
  AgentReadAssetOriginalsToolRequestDto.schema.safeParse(input);
const parseListAlbumsRequest = (input: AgentListAlbumsToolRequestInput) =>
  AgentListAlbumsToolRequestDto.schema.safeParse(input);
const parseListSpacesRequest = (input: AgentListSpacesToolRequestInput) =>
  AgentListSpacesToolRequestDto.schema.safeParse(input);
const parseReadAlbumRequest = (input: AgentReadAlbumToolRequestInput) =>
  AgentReadAlbumToolRequestDto.schema.safeParse(input);
const parseReadSpaceRequest = (input: AgentReadSpaceToolRequestInput) =>
  AgentReadSpaceToolRequestDto.schema.safeParse(input);
const parseSearchUsersRequest = (input: AgentSearchUsersToolRequestInput) =>
  AgentSearchUsersToolRequestDto.schema.safeParse(input);

const parseApproval = (input: AgentToolApprovalInput) => AgentToolApprovalDto.schema.safeParse(input);

const expectIssue = (
  result: { success: boolean; error?: z.ZodError },
  path: Array<string | number>,
  message: string,
) => {
  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path,
        message: expect.stringContaining(message),
      }),
    ]),
  );
};

describe('Agent tool DTOs', () => {
  describe(AgentReadAssetMetadataToolRequestDto.name, () => {
    it('accepts assetIds with the basic metadata detail default', () => {
      const assetId = factory.uuid();
      const result = parseRequest({ assetIds: [assetId] });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ assetIds: [assetId], detail: 'basic' });
      }
    });

    it('accepts explicit metadata detail presets', () => {
      const assetId = factory.uuid();
      const result = parseRequest({ assetIds: [assetId], detail: 'technical' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ assetIds: [assetId], detail: 'technical' });
      }
    });

    it('accepts exact metadata fields for custom reads', () => {
      const assetId = factory.uuid();
      const result = parseRequest({ assetIds: [assetId], fields: ['filename', 'rating', 'tags'] });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ assetIds: [assetId], fields: ['filename', 'rating', 'tags'] });
      }
    });

    it('accepts toolCallId for approved-call resume', () => {
      const toolCallId = factory.uuid();
      const result = parseRequest({ toolCallId });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ toolCallId });
      }
    });

    it('rejects invalid toolCallId UUIDs', () => {
      const result = parseRequest({ toolCallId: 'not-a-uuid' });

      expectIssue(result, ['toolCallId'], 'Invalid UUID');
    });

    it('accepts exactly 10000 asset ids', () => {
      const result = parseRequest({ assetIds: Array.from({ length: 10_000 }, () => factory.uuid()) });

      expect(result.success).toBe(true);
    });

    it('rejects more than 10000 asset ids', () => {
      const result = parseRequest({ assetIds: Array.from({ length: 10_001 }, () => factory.uuid()) });

      expectIssue(result, ['assetIds'], 'Too big');
    });

    it('rejects requests without assetIds or toolCallId', () => {
      const result = parseRequest({});

      expectIssue(result, [], 'Provide assetIds for a new tool request or toolCallId for an approved request');
    });

    it('rejects requests containing both assetIds and toolCallId', () => {
      const result = parseRequest({ assetIds: [factory.uuid()], toolCallId: factory.uuid() });

      expectIssue(result, [], 'Provide either assetIds or toolCallId, not both');
    });

    it('rejects metadata reads that combine detail and fields', () => {
      const result = parseRequest({ assetIds: [factory.uuid()], detail: 'basic', fields: ['filename'] });

      expectIssue(result, [], 'Use either detail or fields, not both');
    });

    it('rejects metadata fields when retrying an approved tool call', () => {
      const result = parseRequest({ toolCallId: factory.uuid(), fields: ['filename'] });

      expectIssue(result, [], 'Provide either assetIds or toolCallId, not both');
    });

    it('rejects metadata detail when retrying an approved tool call', () => {
      const result = parseRequest({ toolCallId: factory.uuid(), detail: 'technical' });

      expectIssue(result, [], 'Provide either assetIds or toolCallId, not both');
    });

    it('rejects unsupported metadata fields such as previews, originals, and people', () => {
      for (const field of ['previews', 'originals', 'people']) {
        const result = parseRequest({ assetIds: [factory.uuid()], fields: [field] } as never);

        expectIssue(result, ['fields', 0], 'Invalid option');
      }
    });

    it('rejects unknown top-level keys that try to request media or raw internals', () => {
      for (const key of ['includePreviews', 'includeOriginals', 'rawPath', 'storageKey', 'checksum']) {
        const result = parseRequest({ assetIds: [factory.uuid()], [key]: true } as never);

        expectIssue(result, [], 'Unrecognized key');
      }
    });

    it('rejects invalid UUID asset ids', () => {
      const result = parseRequest({ assetIds: ['not-a-uuid'] });

      expectIssue(result, ['assetIds', 0], 'Invalid UUID');
    });

    it('rejects duplicate asset ids', () => {
      const assetId = factory.uuid();
      const result = parseRequest({ assetIds: [assetId, assetId] });

      expectIssue(result, ['assetIds'], 'assetIds must be unique');
    });

    it('rejects duplicate metadata fields', () => {
      const result = parseRequest({ assetIds: [factory.uuid()], fields: ['filename', 'filename'] });

      expectIssue(result, ['fields'], 'fields must be unique');
    });
  });

  describe('AgentReadSelectionMetadataToolRequestSchema', () => {
    const selectionHandleId = '00000000-0000-4000-8000-000000000333';

    it('defaults sample size and safe fields for selection metadata reads', () => {
      expect(AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].parse({ selectionHandleId })).toEqual({
        selectionHandleId,
        sampleSize: 10,
        fields: ['type', 'dates', 'location', 'camera', 'tags', 'rating', 'filename', 'favorite', 'visibility'],
      });
    });

    it('validates readSelectionMetadata argument modes and field/sample bounds', () => {
      expect(
        AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].safeParse({
          selectionHandleId,
          fields: ['dates', 'dates'],
        }).success,
      ).toBe(false);
      expect(
        AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].safeParse({
          selectionHandleId,
          sampleSize: 26,
        }).success,
      ).toBe(false);
      expect(
        AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].safeParse({
          selectionHandleId,
          toolCallId: '00000000-0000-4000-8000-000000000111',
        }).success,
      ).toBe(false);
      expect(
        AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].safeParse({
          toolCallId: '00000000-0000-4000-8000-000000000111',
          fields: ['dates'],
        }).success,
      ).toBe(false);
      expect(
        AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].parse({
          selectionHandleId,
          fields: ['dates', 'camera'],
          sampleSize: 0,
        }),
      ).toEqual({ selectionHandleId, fields: ['dates', 'camera'], sampleSize: 0 });
    });

    it('encodes selection metadata responses without asset UUID fields in samples', () => {
      const encoded = AgentReadSelectionMetadataToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall({ toolName: AgentToolName.ReadSelectionMetadata }),
        summary: 'Read selection metadata for 12 assets with 1 sample.',
        selectionHandle: {
          id: selectionHandleId,
          sourceRef: `asset-source:search:${selectionHandleId}`,
          assetCount: 12,
          sourceToolCallId: '00000000-0000-4000-8000-000000000444',
          expiresAt: new Date('2026-05-27T12:00:00.000Z'),
        },
        fields: ['dates', 'camera'],
        counts: { assets: 12, sampled: 1 },
        sample: {
          sampleSize: 1,
          items: [
            {
              itemRef: 'item:001',
              localDateTime: new Date('2026-05-20T10:00:00.000Z'),
              exifInfo: { make: 'Canon', model: 'R5' },
            },
          ],
        },
        resultSize: {
          returnedItems: 1,
          hasMore: false,
          nextPage: null,
          estimatedBytes: 512,
          truncated: false,
          omittedFields: [],
        },
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success) {
        throw new Error('Expected selection metadata response to encode');
      }

      expect(JSON.stringify(encoded.data)).not.toContain('"assetIds"');
      expect(JSON.stringify(encoded.data)).not.toContain('"assetId"');
      expect(JSON.stringify(encoded.data)).not.toContain('"id":"00000000-0000-4000-8000-000000000001"');
    });
  });

  describe('AgentCurateSelectionToolRequestSchema', () => {
    const selectionHandleId = '00000000-0000-4000-8000-000000000333';

    it('defaults strategy, constraints, and sample size for selection curation', () => {
      expect(
        AgentReadToolRequestSchemas[AgentToolName.CurateSelection].parse({
          selectionHandleId,
          targetCount: 15,
        }),
      ).toEqual({
        selectionHandleId,
        targetCount: 15,
        strategy: 'metadata-highlights',
        constraints: {},
        sampleSize: 10,
      });
    });

    it('accepts toolCallId for approved-call resume without curation defaults', () => {
      const toolCallId = '00000000-0000-4000-8000-000000000111';

      expect(AgentReadToolRequestSchemas[AgentToolName.CurateSelection].parse({ toolCallId })).toEqual({ toolCallId });
    });

    it('validates curation request modes and bounds', () => {
      expect(
        AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse({
          selectionHandleId,
          targetCount: 0,
        }).success,
      ).toBe(false);
      expect(
        AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse({
          selectionHandleId,
          targetCount: 1001,
        }).success,
      ).toBe(false);
      expect(
        AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse({
          selectionHandleId,
          targetCount: 5,
          toolCallId: '00000000-0000-4000-8000-000000000111',
        }).success,
      ).toBe(false);
      expect(
        AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse({
          toolCallId: '00000000-0000-4000-8000-000000000111',
          targetCount: 5,
        }).success,
      ).toBe(false);
      expect(
        AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse({
          selectionHandleId,
          targetCount: 5,
          constraints: { diversifyBy: ['date', 'date'] },
        }).success,
      ).toBe(false);
      expect(
        AgentReadToolRequestSchemas[AgentToolName.CurateSelection].parse({
          selectionHandleId,
          targetCount: 1,
          strategy: 'cover-candidate',
          constraints: {
            types: ['IMAGE'],
            minRating: 4,
            excludeVideos: true,
            diversifyBy: ['location'],
            maxSharpness: 20,
            maxBrightness: 30,
            maxQuality: 40,
          },
          sampleSize: 0,
        }),
      ).toEqual({
        selectionHandleId,
        targetCount: 1,
        strategy: 'cover-candidate',
        constraints: {
          types: ['IMAGE'],
          minRating: 4,
          excludeVideos: true,
          diversifyBy: ['location'],
          maxSharpness: 20,
          maxBrightness: 30,
          maxQuality: 40,
        },
        sampleSize: 0,
      });
    });

    it('encodes curation responses without selected asset UUID fields', () => {
      const encoded = AgentCurateSelectionToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall({ toolName: AgentToolName.CurateSelection }),
        summary: 'Curated 3 metadata-only highlights from 12 source assets.',
        strategy: 'metadata-highlights',
        selectionHandle: {
          id: selectionHandleId,
          sourceRef: `asset-source:search:${selectionHandleId}`,
          assetCount: 3,
          sourceToolCallId: '00000000-0000-4000-8000-000000000444',
          expiresAt: new Date('2026-05-27T12:00:00.000Z'),
        },
        sourceAssetCount: 12,
        selectedAssetCount: 3,
        criteriaSummary: ['Metadata-only curation used favorites, ratings, dates, tags, and location.'],
        warnings: ['Requested 5 assets but only 3 eligible assets were available.'],
        sample: { sampleSize: 1, items: [{ itemRef: 'item:001', isFavorite: true }] },
        resultSize: {
          returnedItems: 3,
          hasMore: false,
          nextPage: null,
          estimatedBytes: 512,
          truncated: false,
          omittedFields: [],
        },
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success) {
        throw new Error('Expected curation response to encode');
      }
      expect(JSON.stringify(encoded.data)).not.toContain('"assetIds"');
      expect(JSON.stringify(encoded.data)).not.toContain('"assetId"');
      expect(JSON.stringify(encoded.data)).not.toContain('"sampleAssetIds"');
    });
  });

  describe(AgentFindTripCandidatesToolRequestDto.name, () => {
    it('defaults trip candidate request bounds for recent trip discovery', () => {
      const result = parseFindTripCandidatesRequest({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          lookbackDays: 180,
          maxCandidates: 3,
        });
      }
    });

    it('accepts boundary lookbackDays and maxCandidates values', () => {
      expect(parseFindTripCandidatesRequest({ lookbackDays: 1, maxCandidates: 1 }).success).toBe(true);
      expect(parseFindTripCandidatesRequest({ lookbackDays: 365, maxCandidates: 10 }).success).toBe(true);
    });

    it('rejects out-of-bound lookbackDays and maxCandidates values', () => {
      expectIssue(parseFindTripCandidatesRequest({ lookbackDays: 0 }), ['lookbackDays'], 'Too small');
      expectIssue(parseFindTripCandidatesRequest({ lookbackDays: 366 }), ['lookbackDays'], 'Too big');
      expectIssue(parseFindTripCandidatesRequest({ maxCandidates: 0 }), ['maxCandidates'], 'Too small');
      expectIssue(parseFindTripCandidatesRequest({ maxCandidates: 11 }), ['maxCandidates'], 'Too big');
    });

    it('accepts ISO date or datetime targetDate values and trims placeHint', () => {
      const dateOnlyResult = parseFindTripCandidatesRequest({
        targetDate: '2026-05-27',
        placeHint: '  USA  ',
      });
      const datetimeResult = parseFindTripCandidatesRequest({
        targetDate: '2026-05-27T12:00:00.000Z',
        placeHint: '  USA  ',
      });

      expect(dateOnlyResult.success).toBe(true);
      if (dateOnlyResult.success) {
        expect(dateOnlyResult.data).toMatchObject({
          targetDate: new Date('2026-05-27'),
          placeHint: 'USA',
        });
      }
      expect(datetimeResult.success).toBe(true);
      if (datetimeResult.success) {
        expect(datetimeResult.data).toMatchObject({
          targetDate: new Date('2026-05-27T12:00:00.000Z'),
          placeHint: 'USA',
        });
      }
    });

    it('rejects targetDate more than one day in the future', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'));
      try {
        expect(parseFindTripCandidatesRequest({ targetDate: '2026-05-28T12:00:00.000Z' }).success).toBe(true);
        expectIssue(
          parseFindTripCandidatesRequest({ targetDate: '2026-05-28T12:00:00.001Z' }),
          ['targetDate'],
          'targetDate must not be more than one day in the future',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects invalid targetDate and overlong placeHint values', () => {
      expectIssue(parseFindTripCandidatesRequest({ targetDate: 'not-a-date' }), ['targetDate'], 'Invalid');
      expectIssue(parseFindTripCandidatesRequest({ placeHint: 'x'.repeat(81) }), ['placeHint'], 'Too big');
    });

    it('emits targetDate as a scalar string in the generated OpenAPI contract', () => {
      const openApi = JSON.parse(
        readFileSync(resolve(process.cwd(), '../open-api/immich-openapi-specs.json'), 'utf8'),
      ) as {
        components: {
          schemas: {
            AgentFindTripCandidatesToolRequestDto: {
              properties: {
                targetDate: Record<string, unknown>;
              };
            };
          };
        };
      };

      const targetDate = openApi.components.schemas.AgentFindTripCandidatesToolRequestDto.properties.targetDate;
      expect(targetDate).toMatchObject({ type: 'string' });
      expect(targetDate).not.toHaveProperty('anyOf');
    });

    it('accepts toolCallId for approved-call resume and rejects mixed retry fields', () => {
      const toolCallId = factory.uuid();
      const retry = parseFindTripCandidatesRequest({ toolCallId });

      expect(retry.success).toBe(true);
      if (retry.success) {
        expect(retry.data).toEqual({ toolCallId });
      }

      expectIssue(
        parseFindTripCandidatesRequest({ toolCallId, placeHint: 'USA' }),
        [],
        'Provide either trip search fields or toolCallId, not both',
      );
    });

    it('publishes the typed response DTO name', () => {
      expect(AgentFindTripCandidatesToolResponseDto.name).toBe('AgentFindTripCandidatesToolResponseDto');
    });

    it('accepts trip candidate response recommendations and requires a top candidate key for auto-use', () => {
      const successResponse = {
        status: 'success',
        toolCall: makeEncodedToolCall(),
        summary: 'Found 1 trip candidate matching "USA".',
        recommendation: {
          action: 'use_top_candidate',
          candidateDedupeKey: 'trip:usa:new-york:2026-04-15:2026-04-16',
          reason: 'The only readable trip candidate is high confidence.',
        },
        candidates: [],
        resultSize: makeResultSize(),
      };

      expect(AgentFindTripCandidatesToolResponseDto.schema.safeParse(successResponse).success).toBe(true);

      const missingKey = AgentFindTripCandidatesToolResponseDto.schema.safeParse({
        ...successResponse,
        recommendation: { action: 'use_top_candidate', reason: 'Missing key.' },
      });
      expectIssue(missingKey, ['recommendation', 'candidateDedupeKey'], 'Invalid input');

      const noneWithKey = AgentFindTripCandidatesToolResponseDto.schema.safeParse({
        ...successResponse,
        recommendation: { action: 'none', candidateDedupeKey: 'trip:usa', reason: 'No match.' },
      });
      expectIssue(noneWithKey, ['recommendation'], 'Unrecognized key');

      const askUserWithKey = AgentFindTripCandidatesToolResponseDto.schema.safeParse({
        ...successResponse,
        recommendation: { action: 'ask_user', candidateDedupeKey: 'trip:usa', reason: 'Multiple matches.' },
      });
      expectIssue(askUserWithKey, ['recommendation'], 'Unrecognized key');
    });
  });

  describe(AgentSearchAssetsToolRequestDto.name, () => {
    it('defaults searchAssets to handle detail and a bounded limit', () => {
      const result = parseSearchAssetsRequest({});

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data).toEqual({
        mode: 'metadata',
        filters: {},
        limit: 100,
        page: 1,
        order: 'desc',
        detail: 'handle',
        fields: [],
      });
    });

    it('accepts explicit ids detail for deprecated compatibility', () => {
      const result = parseSearchAssetsRequest({ detail: 'ids', limit: 25 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(
          expect.objectContaining({
            detail: 'ids',
            limit: 25,
          }),
        );
      }
    });

    it('accepts compact search detail, field selection, and sample size', () => {
      const result = parseSearchAssetsRequest({
        filters: { city: 'Berlin' },
        detail: 'summary',
        fields: ['dates', 'location', 'favorite'],
        sampleSize: 3,
        limit: 25,
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data).toEqual(
        expect.objectContaining({
          detail: 'summary',
          fields: ['dates', 'location', 'favorite'],
          sampleSize: 3,
          limit: 25,
        }),
      );
    });

    it('accepts search selection handle creation with compact samples', () => {
      const result = parseSearchAssetsRequest({
        filters: {},
        limit: 500,
        detail: 'ids',
        createSelectionHandle: true,
        sampleSize: 5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatchObject({
          limit: 500,
          detail: 'ids',
          createSelectionHandle: true,
          sampleSize: 5,
        });
      }
    });

    it('keeps metadata detail available when no fields are requested', () => {
      const result = parseSearchAssetsRequest({ detail: 'metadata', filters: {}, limit: 5 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.detail).toBe('metadata');
        expect(result.data.fields).toEqual([]);
      }
    });

    it('accepts quality threshold filters from 0 to 100', () => {
      const result = parseSearchAssetsRequest({
        filters: {
          maxSharpness: 0,
          maxBrightness: 100,
          maxQuality: 50,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.filters).toEqual(
          expect.objectContaining({
            maxSharpness: 0,
            maxBrightness: 100,
            maxQuality: 50,
          }),
        );
      }
    });

    it.each([
      ['maxSharpness', -1],
      ['maxSharpness', 101],
      ['maxBrightness', -1],
      ['maxBrightness', 101],
      ['maxQuality', -1],
      ['maxQuality', 101],
    ] as const)('rejects %s outside 0 to 100', (field, value) => {
      const result = parseSearchAssetsRequest({ filters: { [field]: value } });

      expectIssue(result, ['filters', field], 'Too');
    });

    it('rejects unknown search metadata fields', () => {
      const result = parseSearchAssetsRequest({ detail: 'summary', fields: ['fullExif'] });

      expectIssue(result, ['fields', 0], 'Invalid option');
    });

    it('rejects sample sizes above the compact-search cap', () => {
      const result = parseSearchAssetsRequest({ detail: 'summary', sampleSize: 26 });

      expectIssue(result, ['sampleSize'], 'Too big');
    });

    it('rejects detail and fields when retrying an approved search tool call', () => {
      const result = parseSearchAssetsRequest({ toolCallId: factory.uuid(), detail: 'ids', fields: ['dates'] });

      expectIssue(result, [], 'Provide either search fields or toolCallId, not both');
    });

    it('accepts filters and limit for a new tool request', () => {
      const result = parseSearchAssetsRequest({
        filters: {
          type: AssetType.Image,
          isFavorite: true,
          isNotInAlbum: true,
          takenAfter: '2026-05-01T00:00:00.000Z',
          takenBefore: '2026-05-31T23:59:59.999Z',
          city: 'Berlin',
          country: 'Germany',
          tagIds: [factory.uuid()],
        },
        limit: 25,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(25);
        const filters = result.data.filters;
        expect(filters).toEqual(
          expect.objectContaining({
            type: AssetType.Image,
            city: 'Berlin',
            country: 'Germany',
          }),
        );
        expect(filters?.takenAfter).toEqual(new Date('2026-05-01T00:00:00.000Z'));
        expect(filters?.takenBefore).toEqual(new Date('2026-05-31T23:59:59.999Z'));
      }
    });

    it('rejects requests containing both filters/limit and toolCallId', () => {
      const result = parseSearchAssetsRequest({ filters: {}, limit: 10, toolCallId: factory.uuid() });

      expectIssue(result, [], 'Provide either search fields or toolCallId, not both');
    });

    it('accepts toolCallId for approved-call resume without search defaults', () => {
      const toolCallId = factory.uuid();
      const result = parseSearchAssetsRequest({ toolCallId });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ toolCallId });
      }
    });

    it('accepts metadata search contract fields and defaults', () => {
      const tagId = factory.uuid();
      const albumId = factory.uuid();
      const result = parseSearchAssetsRequest({
        filters: {
          type: AssetType.Image,
          isFavorite: true,
          isNotInAlbum: true,
          takenAfter: '2026-05-01T00:00:00.000Z',
          takenBefore: '2026-05-31T23:59:59.999Z',
          city: 'Berlin',
          state: 'Berlin',
          country: 'Germany',
          make: 'Sony',
          model: 'A7',
          lensModel: 'FE 35mm',
          rating: null,
          tagIds: [tagId],
          albumIds: [albumId],
        },
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data).toEqual(
        expect.objectContaining({
          mode: 'metadata',
          limit: 100,
          page: 1,
          order: 'desc',
          detail: 'handle',
          fields: [],
        }),
      );
      expect(result.data).not.toHaveProperty('query');
      expect(result.data.filters).toEqual(
        expect.objectContaining({
          type: AssetType.Image,
          isFavorite: true,
          isNotInAlbum: true,
          city: 'Berlin',
          state: 'Berlin',
          country: 'Germany',
          make: 'Sony',
          model: 'A7',
          lensModel: 'FE 35mm',
          rating: null,
          tagIds: [tagId],
          albumIds: [albumId],
          takenAfter: new Date('2026-05-01T00:00:00.000Z'),
          takenBefore: new Date('2026-05-31T23:59:59.999Z'),
        }),
      );
    });

    it('accepts future search filter fields in the schema contract', () => {
      const personId = factory.uuid();
      const spaceId = factory.uuid();
      const spacePersonId = factory.uuid();
      const result = parseSearchAssetsRequest({
        filters: {
          createdAfter: '2026-04-01T00:00:00.000Z',
          createdBefore: '2026-04-30T23:59:59.999Z',
          updatedAfter: '2026-05-01T00:00:00.000Z',
          updatedBefore: '2026-05-20T23:59:59.999Z',
          personIds: [personId],
          spaceId,
          spacePersonIds: [spacePersonId],
          visibility: AssetVisibility.Timeline,
        },
        limit: 25,
        page: 2,
        order: 'asc',
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data).toEqual(
        expect.objectContaining({
          mode: 'metadata',
          limit: 25,
          page: 2,
          order: 'asc',
        }),
      );
      expect(result.data.filters).toEqual(
        expect.objectContaining({
          personIds: [personId],
          spaceId,
          spacePersonIds: [spacePersonId],
          visibility: AssetVisibility.Timeline,
          createdAfter: new Date('2026-04-01T00:00:00.000Z'),
          createdBefore: new Date('2026-04-30T23:59:59.999Z'),
          updatedAfter: new Date('2026-05-01T00:00:00.000Z'),
          updatedBefore: new Date('2026-05-20T23:59:59.999Z'),
        }),
      );

      const sharedSpacesResult = parseSearchAssetsRequest({ filters: { withSharedSpaces: true } });

      expect(sharedSpacesResult.success).toBe(true);
      if (sharedSpacesResult.success) {
        expect(sharedSpacesResult.data.filters).toEqual(expect.objectContaining({ withSharedSpaces: true }));
        if (!sharedSpacesResult.data.filters) {
          throw new Error('Expected parsed search request to include filters');
        }
        expect(sharedSpacesResult.data.filters.withSharedSpaces).toBe(true);
      }
    });

    it.each(['smart', 'description', 'ocr', 'filename'] as const)('accepts explicit %s mode with a query', (mode) => {
      const result = parseSearchAssetsRequest({ mode, query: 'beach sunset', filters: { city: 'Lisbon' }, limit: 5 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(
          expect.objectContaining({
            mode,
            query: 'beach sunset',
            limit: 5,
            page: 1,
          }),
        );
        if (mode === 'smart') {
          expect(result.data).not.toHaveProperty('order');
        } else {
          expect(result.data.order).toBe('desc');
        }
      }
    });

    it('does not default smart search order when omitted so relevance ranking is used', () => {
      const result = AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse({
        mode: 'smart',
        query: 'beach sunset',
        filters: { city: 'Berlin' },
        limit: 25,
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({
          mode: 'smart',
          query: 'beach sunset',
          filters: { city: 'Berlin' },
          limit: 25,
          page: 1,
          detail: 'handle',
          fields: [],
        }),
      );
    });

    it('keeps metadata-like search order defaulted to desc', () => {
      const result = AgentReadToolRequestSchemas[AgentToolName.SearchAssets].parse({
        mode: 'ocr',
        query: 'invoice',
        filters: {},
        limit: 10,
      });

      expect(result.order).toBe('desc');
    });

    it.each(['smart', 'description', 'ocr', 'filename'] as const)('rejects %s mode without a query', (mode) => {
      const result = parseSearchAssetsRequest({ mode, filters: {}, limit: 5 });

      expectIssue(result, ['query'], `${mode} search requires a non-empty query`);
    });

    it('rejects metadata mode with a query', () => {
      const result = parseSearchAssetsRequest({ mode: 'metadata', query: 'beach sunset', filters: {}, limit: 5 });

      expectIssue(result, ['query'], 'query is only supported for smart, description, ocr, and filename search modes');
    });

    it('rejects root-level filter fields', () => {
      const result = parseSearchAssetsRequest({ city: 'Berlin', createdAfter: '2026-05-01T00:00:00.000Z' });

      expectIssue(result, [], 'Unrecognized');
    });

    it('rejects invalid order and page values', () => {
      const invalidOrder = parseSearchAssetsRequest({ order: 'newest-first' });
      const invalidPage = parseSearchAssetsRequest({ page: 0 });

      expectIssue(invalidOrder, ['order'], 'Invalid option');
      expectIssue(invalidPage, ['page'], 'Too small');
    });

    it('rejects invalid date, rating, and limit values', () => {
      const invalidDate = parseSearchAssetsRequest({ filters: { takenAfter: 'yesterday' } });
      const invalidRating = parseSearchAssetsRequest({ filters: { rating: 6 } });
      const invalidLimit = parseSearchAssetsRequest({ limit: 10_001 });

      expectIssue(invalidDate, ['filters', 'takenAfter'], 'Invalid');
      expectIssue(invalidRating, ['filters', 'rating'], 'Too big');
      expectIssue(invalidLimit, ['limit'], 'Too big');
    });

    it('rejects spacePersonIds without spaceId', () => {
      const result = parseSearchAssetsRequest({ filters: { spacePersonIds: [factory.uuid()] } });

      expectIssue(result, ['filters', 'spacePersonIds'], 'spacePersonIds requires spaceId');
    });

    it('rejects spaceId with withSharedSpaces', () => {
      const result = parseSearchAssetsRequest({ filters: { spaceId: factory.uuid(), withSharedSpaces: true } });

      expectIssue(result, ['filters', 'withSharedSpaces'], 'Cannot use both spaceId and withSharedSpaces');
    });

    it('rejects requests containing any new search field and toolCallId', () => {
      for (const input of [
        { mode: 'smart', query: 'beach', toolCallId: factory.uuid() },
        { query: 'beach', toolCallId: factory.uuid() },
        { order: 'asc', toolCallId: factory.uuid() },
        { page: 2, toolCallId: factory.uuid() },
      ] as const) {
        const result = parseSearchAssetsRequest(input);

        expectIssue(result, [], 'Provide either search fields or toolCallId, not both');
      }
    });
  });

  describe('AgentResolveAssetSearchFiltersToolRequestSchema', () => {
    it('accepts people/tags/albums/spaces/cameraMakes/cameraModels/lensModels plus scope.withSharedSpaces and takenAfter', () => {
      const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({
        people: ['Pierre'],
        tags: ['Travel'],
        albums: ['Berlin'],
        spaces: ['Family'],
        cameraMakes: ['FUJIFILM'],
        cameraModels: ['X100V'],
        lensModels: ['23mm'],
        scope: { withSharedSpaces: true, takenAfter: '2026-05-01T00:00:00.000Z' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatchObject({
          people: ['Pierre'],
          tags: ['Travel'],
          albums: ['Berlin'],
          spaces: ['Family'],
          cameraMakes: ['FUJIFILM'],
          cameraModels: ['X100V'],
          lensModels: ['23mm'],
          scope: { withSharedSpaces: true },
        });
        expect(result.data.scope?.takenAfter).toEqual(new Date('2026-05-01T00:00:00.000Z'));
      }
    });

    it('rejects toolCallId combined with resolver fields', () => {
      const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({
        toolCallId: factory.uuid(),
        tags: ['Travel'],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('Provide either resolver fields or toolCallId, not both');
    });

    it('rejects toolCallId combined with scope', () => {
      const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({
        toolCallId: factory.uuid(),
        scope: { withSharedSpaces: true },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('Provide either resolver fields or toolCallId, not both');
    });

    it('rejects empty request', () => {
      const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({});

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('Provide at least one resolver field');
    });

    it('rejects scope-only requests without resolver name fields', () => {
      const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({
        scope: { withSharedSpaces: true },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe('Provide at least one resolver field');
    });

    it('rejects scope.spaceId combined with scope.withSharedSpaces', () => {
      const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({
        people: ['Pierre'],
        scope: { spaceId: factory.uuid(), withSharedSpaces: true },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path.join('.')).toBe('scope.withSharedSpaces');
      expect(result.error?.issues[0]?.message).toBe('Cannot use both scope.spaceId and scope.withSharedSpaces');
    });

    it('rejects too many names and blank names with paths tags and albums.0', () => {
      const tooMany = Array.from({ length: 21 }, (_, index) => `tag-${index}`);
      const result = AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse({
        tags: tooMany,
        albums: ['  '],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['tags', 'albums.0']),
      );
    });
  });

  describe.each([
    [AgentReadAssetPreviewsToolRequestDto.name, parseReadAssetPreviewsRequest],
    [AgentReadAssetOriginalsToolRequestDto.name, parseReadAssetOriginalsRequest],
  ])('%s', (_name, parseReadAssetRequest) => {
    it('rejects requests containing both assetIds and toolCallId', () => {
      const result = parseReadAssetRequest({ assetIds: [factory.uuid()], toolCallId: factory.uuid() });

      expectIssue(result, [], 'Provide either assetIds or toolCallId, not both');
    });

    it('rejects duplicate asset ids', () => {
      const assetId = factory.uuid();
      const result = parseReadAssetRequest({ assetIds: [assetId, assetId] });

      expectIssue(result, ['assetIds'], 'assetIds must be unique');
    });
  });

  describe(AgentReadAlbumToolRequestDto.name, () => {
    it('requires albumId or toolCallId', () => {
      const result = parseReadAlbumRequest({});

      expectIssue(result, [], 'Provide albumId for a new tool request or toolCallId for an approved request');
    });

    it('rejects requests containing both albumId and toolCallId', () => {
      const result = parseReadAlbumRequest({ albumId: factory.uuid(), toolCallId: factory.uuid() });

      expectIssue(result, [], 'Provide either albumId or toolCallId, not both');
    });
  });

  describe(AgentListAlbumsToolRequestDto.name, () => {
    it('accepts empty new tool requests', () => {
      const result = parseListAlbumsRequest({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
      }
    });

    it('accepts toolCallId for approved-call resume', () => {
      const toolCallId = factory.uuid();
      const result = parseListAlbumsRequest({ toolCallId });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ toolCallId });
      }
    });

    it('rejects unknown keys', () => {
      const result = parseListAlbumsRequest({ albumId: factory.uuid() } as AgentListAlbumsToolRequestInput);

      expectIssue(result, [], 'Unrecognized key');
    });
  });

  describe(AgentListSpacesToolRequestDto.name, () => {
    it('accepts empty new tool requests', () => {
      const result = parseListSpacesRequest({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({});
      }
    });

    it('accepts toolCallId for approved-call resume', () => {
      const toolCallId = factory.uuid();
      const result = parseListSpacesRequest({ toolCallId });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ toolCallId });
      }
    });

    it('rejects unknown keys including spaceId', () => {
      const result = parseListSpacesRequest({ spaceId: factory.uuid() } as AgentListSpacesToolRequestInput);

      expectIssue(result, [], 'Unrecognized key');
    });
  });

  describe(AgentReadSpaceToolRequestDto.name, () => {
    it('accepts spaceId for a new tool request', () => {
      const spaceId = factory.uuid();
      const result = parseReadSpaceRequest({ spaceId });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ spaceId });
      }
    });

    it('accepts toolCallId for approved-call resume', () => {
      const toolCallId = factory.uuid();
      const result = parseReadSpaceRequest({ toolCallId });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ toolCallId });
      }
    });

    it('requires spaceId or toolCallId', () => {
      const result = parseReadSpaceRequest({});

      expectIssue(result, [], 'Provide spaceId, or retry an approved tool call with toolCallId');
    });

    it('rejects requests containing both spaceId and toolCallId', () => {
      const result = parseReadSpaceRequest({ spaceId: factory.uuid(), toolCallId: factory.uuid() });

      expectIssue(result, [], 'Use either spaceId or toolCallId, not both');
    });

    it('rejects invalid spaceId UUIDs', () => {
      const result = parseReadSpaceRequest({ spaceId: 'not-a-uuid' });

      expectIssue(result, ['spaceId'], 'Invalid UUID');
    });
  });

  describe(AgentSearchUsersToolRequestDto.name, () => {
    it('accepts a query and limit for visible user lookup', () => {
      const result = parseSearchUsersRequest({ query: ' pierre ', limit: 5 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ query: 'pierre', limit: 5 });
      }
    });

    it('defaults to an empty query and bounded limit', () => {
      const result = parseSearchUsersRequest({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ query: '', limit: 20 });
      }
    });

    it('accepts toolCallId for approved-call resume', () => {
      const toolCallId = factory.uuid();
      const result = parseSearchUsersRequest({ toolCallId });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ toolCallId });
      }
    });

    it('rejects requests containing both lookup fields and toolCallId', () => {
      const result = parseSearchUsersRequest({ query: 'sam', limit: 2, toolCallId: factory.uuid() });

      expectIssue(result, [], 'Provide either user search fields or toolCallId, not both');
    });

    it('rejects empty queries after trim when query is provided', () => {
      const result = parseSearchUsersRequest({ query: '   ' });

      expectIssue(result, ['query'], 'Too small');
    });

    it('rejects limits outside the user lookup bound', () => {
      const result = parseSearchUsersRequest({ limit: 21 });

      expectIssue(result, ['limit'], 'Too big');
    });
  });

  describe(AgentToolApprovalDto.name, () => {
    it.each([AgentToolApprovalDecision.Approved, AgentToolApprovalDecision.Denied])(
      'accepts %s approval decisions',
      (decision) => {
        const result = parseApproval({ decision });

        expect(result.success).toBe(true);
      },
    );

    it('accepts denied decisions with a reason', () => {
      const result = parseApproval({ decision: AgentToolApprovalDecision.Denied, reason: 'Too broad.' });

      expect(result.success).toBe(true);
    });

    it('rejects blank denial reason after trim', () => {
      const result = parseApproval({ decision: AgentToolApprovalDecision.Denied, reason: '   ' });

      expectIssue(result, ['reason'], 'Too small');
    });
  });

  describe(AgentToolCallParamsDto.name, () => {
    it('accepts session and tool call params', () => {
      const result = AgentToolCallParamsDto.schema.safeParse({ id: factory.uuid(), toolCallId: factory.uuid() });

      expect(result.success).toBe(true);
    });

    it('rejects invalid UUID params', () => {
      const result = AgentToolCallParamsDto.schema.safeParse({ id: 'not-a-uuid', toolCallId: 'also-not-a-uuid' });

      expectIssue(result, ['id'], 'Invalid UUID');
      expectIssue(result, ['toolCallId'], 'Invalid UUID');
    });
  });

  describe(AgentToolCallResponseDto.name, () => {
    it('serializes tool call dates as ISO strings', () => {
      const result = AgentToolCallResponseDto.schema.safeEncode(makeToolCall());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.startedAt).toBe('2026-05-14T12:00:00.000Z');
        expect(result.data.completedAt).toBe('2026-05-14T12:01:00.000Z');
      }
    });

    it('serializes optional result-size telemetry on tool calls', () => {
      const result = AgentToolCallResponseDto.schema.safeEncode(
        makeToolCall({
          resultSize: {
            returnedItems: 2,
            hasMore: true,
            nextPage: '2',
            estimatedBytes: 1536,
            truncated: true,
            omittedFields: ['assets'],
          },
        }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resultSize).toEqual({
          returnedItems: 2,
          hasMore: true,
          nextPage: '2',
          estimatedBytes: 1536,
          truncated: true,
          omittedFields: ['assets'],
        });
      }
    });

    it('accepts unavailable result-size estimates', () => {
      const result = AgentToolCallResponseDto.schema.safeEncode(
        makeToolCall({
          resultSize: emptyResultSize(),
        }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resultSize?.estimatedBytes).toBeNull();
      }
    });

    it('rejects invalid negative result-size values', () => {
      const result = AgentToolCallResponseDto.schema.safeParse({
        ...makeEncodedToolCall(),
        resultSize: {
          returnedItems: -1,
          hasMore: false,
          nextPage: null,
          estimatedBytes: -5,
          truncated: false,
          omittedFields: [],
        },
      });

      expectIssue(result, ['resultSize', 'returnedItems'], 'Too small');
      expectIssue(result, ['resultSize', 'estimatedBytes'], 'Too small');
    });
  });

  describe(AgentReadAssetMetadataToolResponseDto.name, () => {
    it('serializes approval-required responses with embedded tool calls only', () => {
      const result = AgentReadAssetMetadataToolResponseDto.schema.safeEncode({
        status: 'approval-required',
        toolCall: makeToolCall({
          status: AgentToolCallStatus.PendingApproval,
          completedAt: null,
          resultSize: emptyResultSize(),
        }),
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toolCall.resultSize).toEqual(emptyResultSize());
        expect(result.data).toHaveProperty('toolCall');
        expect(result.data).not.toHaveProperty('toolCallId');
        expect(result.data).not.toHaveProperty('requestSummary');
        expect(result.data).not.toHaveProperty('assetCount');
      }
    });

    it('serializes denied responses with a reason and embedded tool call only', () => {
      const result = AgentReadAssetMetadataToolResponseDto.schema.safeEncode({
        status: 'denied',
        reason: 'User denied the request.',
        toolCall: makeToolCall({
          status: AgentToolCallStatus.Denied,
          approvalDecision: AgentToolApprovalDecision.Denied,
          error: 'User denied the request.',
          resultSize: emptyResultSize(),
        }),
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toolCall.resultSize).toEqual(emptyResultSize());
        expect(result.data).toHaveProperty('reason', 'User denied the request.');
        expect(result.data).toHaveProperty('toolCall');
        expect(result.data).not.toHaveProperty('toolCallId');
        expect(result.data).not.toHaveProperty('decision');
      }
    });

    it('serializes compact metadata success responses with selected fields only', () => {
      const asset = makeAssets()[0];
      const result = AgentReadAssetMetadataToolResponseDto.schema.safeEncode({
        status: 'success' as const,
        toolCall: makeToolCall(),
        summary: 'Returned basic metadata for 1 asset',
        detail: 'basic' as const,
        fields: ['type', 'dates'],
        resultSize: makeResultSize({ estimatedBytes: 768 }),
        assets: [
          {
            id: asset.id,
            type: asset.type,
            localDateTime: new Date('2026-05-14T12:00:00.000Z'),
            fileCreatedAt: new Date('2026-05-14T12:00:00.000Z'),
            fileModifiedAt: new Date('2026-05-14T12:00:00.000Z'),
            exifInfo: { dateTimeOriginal: new Date('2026-05-14T12:00:00.000Z') },
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success && result.data.status === 'success') {
        expect(result.data.toolCall.startedAt).toBe('2026-05-14T12:00:00.000Z');
        expect(result.data.summary).toBe('Returned basic metadata for 1 asset');
        expect(result.data.detail).toBe('basic');
        expect(result.data.fields).toEqual(['type', 'dates']);
        expect(result.data).not.toHaveProperty('toolCallId');
        expect(result.data.assets[0].localDateTime).toBe('2026-05-14T12:00:00.000Z');
        expect(result.data.assets[0]).not.toHaveProperty('originalFileName');
        expect(result.data.assets[0]).not.toHaveProperty('tags');
      }
    });

    it('serializes allSafe metadata rows with supported safe field groups only', () => {
      const asset = makeAssets()[0];
      const result = AgentReadAssetMetadataToolResponseDto.schema.safeEncode({
        status: 'success' as const,
        toolCall: makeToolCall(),
        summary: 'Returned allSafe metadata for 1 asset',
        detail: 'allSafe' as const,
        fields: ['type', 'dates', 'location', 'camera', 'tags', 'rating', 'filename', 'favorite', 'visibility'],
        resultSize: makeResultSize({ estimatedBytes: 768 }),
        assets: [asset],
      });

      expect(result.success).toBe(true);
      if (result.success && result.data.status === 'success') {
        expect(result.data.assets[0].originalFileName).toBe(asset.originalFileName);
        expect(result.data.assets[0].tags).toEqual(asset.tags);
        expect(result.data.assets[0]).not.toHaveProperty('ownerId');
        expect(result.data.assets[0]).not.toHaveProperty('originalPath');
        expect(result.data.assets[0]).not.toHaveProperty('previewPath');
        expect(result.data.assets[0]).not.toHaveProperty('thumbnailPath');
      }
    });
  });

  describe('expanded agent tool response DTOs', () => {
    it('encodes handle-first compact search responses without asset ids', () => {
      const handleId = factory.uuid();
      const toolCallId = factory.uuid();
      const sourceRef = `asset-source:search:${handleId}` as const;

      const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
        summary: 'Created a selection handle for 1 asset',
        detail: 'handle',
        selectionHandle: {
          id: handleId,
          sourceRef,
          assetCount: 1,
          sourceToolCallId: toolCallId,
          expiresAt: new Date('2026-05-21T12:30:00.000Z'),
        },
        returnedCount: 1,
        hasMore: false,
        nextPage: null,
        resultSize: makeResultSize({ returnedItems: 1 }),
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success || encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.detail).toBe('handle');
      expect(encoded.data).not.toHaveProperty('assetIds');
      expect(encoded.data).not.toHaveProperty('assets');
      expect(encoded.data.selectionHandle).not.toHaveProperty('sampleAssetIds');
      expect(JSON.stringify(encoded.data)).not.toContain('"assetIds"');
    });

    it('rejects legacy search success responses that expose assetIds', () => {
      const assetId = factory.uuid();
      const parsed = AgentSearchAssetsToolResponseDto.schema.safeParse({
        status: 'success',
        toolCall: { ...makeEncodedToolCall(), toolName: AgentToolName.SearchAssets },
        summary: 'Returned 1 asset id',
        detail: 'ids',
        assetIds: [assetId],
        returnedCount: 1,
        hasMore: false,
        nextPage: null,
        resultSize: makeResultSize({ returnedItems: 1 }),
      });

      expect(parsed.success).toBe(false);
    });

    it('encodes ID-free search samples with handle-local item refs', () => {
      const handleId = factory.uuid();
      const toolCallId = factory.uuid();
      const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
        summary: 'Created a selection handle for 2 assets with 1 sample',
        detail: 'summary',
        selectionHandle: {
          id: handleId,
          sourceRef: `asset-source:search:${handleId}`,
          assetCount: 2,
          sourceToolCallId: toolCallId,
          expiresAt: new Date('2026-05-21T12:30:00.000Z'),
        },
        sample: {
          sampleSize: 1,
          items: [
            {
              itemRef: 'item:001',
              localDateTime: new Date('2026-05-14T12:00:00.000Z'),
              exifInfo: { city: 'Berlin', state: 'Berlin', country: 'Germany' },
              tags: [{ value: 'travel', color: null }],
            },
          ],
        },
        returnedCount: 2,
        hasMore: false,
        nextPage: null,
        resultSize: makeResultSize({ returnedItems: 2, estimatedBytes: 512 }),
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success || encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.sample?.items[0]).toMatchObject({
        itemRef: 'item:001',
        localDateTime: '2026-05-14T12:00:00.000Z',
      });
      expect(encoded.data.sample?.items[0]).not.toHaveProperty('id');
      expect(JSON.stringify(encoded.data.sample)).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
      );
    });

    it('encodes and parses compact search responses without metadata assets', () => {
      const handleId = factory.uuid();
      const toolCallId = factory.uuid();
      const response = {
        status: 'success' as const,
        toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
        summary: 'Created a selection handle for 1 asset',
        detail: 'handle' as const,
        selectionHandle: {
          id: handleId,
          sourceRef: `asset-source:search:${handleId}` as const,
          assetCount: 1,
          sourceToolCallId: toolCallId,
          expiresAt: new Date('2026-05-21T12:30:00.000Z'),
        },
        returnedCount: 1,
        hasMore: false,
        nextPage: null,
        resultSize: makeResultSize({ estimatedBytes: 512 }),
      };

      const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

      expect(encoded.success).toBe(true);
      if (encoded.success && encoded.data.status === 'success') {
        expect(encoded.data.selectionHandle.assetCount).toBe(1);
        expect(encoded.data).not.toHaveProperty('assetIds');
        expect(encoded.data).not.toHaveProperty('assets');
        expect(encoded.data).not.toHaveProperty('sample');
      }
    });

    it('encodes and parses field-selected search samples', () => {
      const handleId = factory.uuid();
      const toolCallId = factory.uuid();
      const response = {
        status: 'success' as const,
        toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
        summary: 'Created a selection handle for 1 asset with 1 sample',
        detail: 'summary' as const,
        selectionHandle: {
          id: handleId,
          sourceRef: `asset-source:search:${handleId}` as const,
          assetCount: 1,
          sourceToolCallId: toolCallId,
          expiresAt: new Date('2026-05-21T12:30:00.000Z'),
        },
        sample: {
          sampleSize: 1,
          items: [
            {
              itemRef: 'item:001',
              localDateTime: new Date('2026-05-14T12:00:00.000Z'),
              exifInfo: { city: 'Berlin', state: 'Berlin', country: 'Germany' },
            },
          ],
        },
        returnedCount: 1,
        hasMore: false,
        nextPage: null,
        resultSize: makeResultSize({ estimatedBytes: 512 }),
      };

      const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

      expect(encoded.success).toBe(true);
      if (encoded.success && encoded.data.status === 'success') {
        expect(encoded.data.sample?.items[0].localDateTime).toBe('2026-05-14T12:00:00.000Z');
        expect(encoded.data.sample?.items[0]).not.toHaveProperty('originalFileName');
      }
    });

    it('encodes search responses with compact selection handle summaries', () => {
      const handleId = factory.uuid();
      const toolCallId = factory.uuid();
      const sourceRef = `asset-source:search:${handleId}` as const;
      const response = {
        status: 'success' as const,
        toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
        summary: 'Created a selection handle for 3 assets',
        detail: 'handle' as const,
        returnedCount: 3,
        hasMore: false,
        nextPage: null,
        resultSize: makeResultSize({ returnedItems: 1 }),
        selectionHandle: {
          id: handleId,
          sourceRef,
          assetCount: 3,
          sourceToolCallId: toolCallId,
          expiresAt: new Date('2026-05-21T12:30:00.000Z'),
        },
      };

      const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

      expect(encoded.success).toBe(true);
      if (encoded.success && encoded.data.status === 'success') {
        expect(encoded.data.selectionHandle).toMatchObject({
          id: handleId,
          sourceRef,
          assetCount: 3,
          sourceToolCallId: toolCallId,
        });
        expect(encoded.data.selectionHandle).not.toHaveProperty('sampleAssetIds');
        expect(encoded.data.selectionHandle?.sourceRef).not.toBe(handleId);
        expect(encoded.data.selectionHandle?.sourceRef).toMatch(/^asset-source:search:/);
        expect(encoded.data).not.toHaveProperty('assetIds');
      }
    });

    it('rejects bare UUID source refs in search selection handles', () => {
      const handleId = factory.uuid();
      const toolCallId = factory.uuid();

      const result = AgentSearchAssetsToolResponseDto.schema.safeParse({
        status: 'success',
        toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
        summary: 'Created a selection handle for 1 asset',
        detail: 'handle',
        returnedCount: 1,
        hasMore: false,
        nextPage: null,
        resultSize: makeResultSize({ returnedItems: 1 }),
        selectionHandle: {
          id: handleId,
          sourceRef: handleId,
          assetCount: 1,
          sourceToolCallId: toolCallId,
          expiresAt: '2026-05-21T12:30:00.000Z',
        },
      });

      expect(result.success).toBe(false);
      expectIssue(
        result,
        ['selectionHandle', 'sourceRef'],
        'sourceRef must use the asset-source:search:<token> format',
      );
    });

    it('encodes and parses search responses with result metadata', () => {
      const handleId = factory.uuid();
      const toolCallId = factory.uuid();
      const response = {
        status: 'success' as const,
        toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
        summary: 'Created a selection handle for 1 asset with 1 sample; more results available on page 2',
        detail: 'metadata' as const,
        selectionHandle: {
          id: handleId,
          sourceRef: `asset-source:search:${handleId}` as const,
          assetCount: 1,
          sourceToolCallId: toolCallId,
          expiresAt: new Date('2026-05-21T12:30:00.000Z'),
        },
        sample: {
          sampleSize: 1,
          items: [{ itemRef: 'item:001', localDateTime: new Date('2026-05-14T12:00:00.000Z') }],
        },
        returnedCount: 1,
        hasMore: true,
        nextPage: '2',
        totalCount: 12,
        approximateTotal: 15,
        resultSize: makeResultSize({ hasMore: true, nextPage: '2', estimatedBytes: 768 }),
      };
      const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

      expect(encoded.success).toBe(true);
      if (!encoded.success) {
        return;
      }

      if (encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.sample?.items[0].localDateTime).toBe('2026-05-14T12:00:00.000Z');
      expect(encoded.data.returnedCount).toBe(1);
      expect(encoded.data.hasMore).toBe(true);
      expect(encoded.data.nextPage).toBe('2');
      expect(encoded.data.totalCount).toBe(12);
      expect(encoded.data.approximateTotal).toBe(15);
      const parsed = AgentSearchAssetsToolResponseDto.schema.safeParse(encoded.data);
      expect(parsed.success).toBe(true);
      if (parsed.success && parsed.data.status === 'success') {
        expect(parsed.data.sample?.items[0].localDateTime).toEqual(new Date('2026-05-14T12:00:00.000Z'));
        expect(parsed.data.returnedCount).toBe(1);
        expect(parsed.data.hasMore).toBe(true);
        expect(parsed.data.nextPage).toBe('2');
        expect(parsed.data.totalCount).toBe(12);
        expect(parsed.data.approximateTotal).toBe(15);
      }
    });

    it('requires returnedCount and hasMore on search success responses', () => {
      const parsed = AgentSearchAssetsToolResponseDto.schema.safeParse({
        status: 'success',
        toolCall: makeEncodedToolCall(),
        assets: makeEncodedAssets(),
        nextPage: null,
      });

      expectIssue(parsed, ['returnedCount'], 'Invalid input');
      expectIssue(parsed, ['hasMore'], 'Invalid input');
    });

    it('encodes and parses final empty search pages', () => {
      const handleId = factory.uuid();
      const toolCallId = factory.uuid();
      const response = {
        status: 'success' as const,
        toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
        summary: 'Created a selection handle for 0 assets',
        detail: 'handle' as const,
        selectionHandle: {
          id: handleId,
          sourceRef: `asset-source:search:${handleId}` as const,
          assetCount: 0,
          sourceToolCallId: toolCallId,
          expiresAt: new Date('2026-05-21T12:30:00.000Z'),
        },
        returnedCount: 0,
        hasMore: false,
        nextPage: null,
        resultSize: makeResultSize({ returnedItems: 0, estimatedBytes: 128 }),
      };
      const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

      expect(encoded.success).toBe(true);
      if (!encoded.success) {
        return;
      }

      if (encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data).not.toHaveProperty('assets');
      expect(encoded.data).not.toHaveProperty('assetIds');
      expect(encoded.data.returnedCount).toBe(0);
      expect(encoded.data.hasMore).toBe(false);
      expect(encoded.data.nextPage).toBeNull();
      expect(encoded.data).not.toHaveProperty('totalCount');
      expect(encoded.data).not.toHaveProperty('approximateTotal');

      const parsed = AgentSearchAssetsToolResponseDto.schema.safeParse(encoded.data);
      expect(parsed.success).toBe(true);
      if (parsed.success && parsed.data.status === 'success') {
        expect(parsed.data).not.toHaveProperty('assets');
        expect(parsed.data.returnedCount).toBe(0);
        expect(parsed.data.hasMore).toBe(false);
        expect(parsed.data.nextPage).toBeNull();
      }
    });

    it('encodes and parses truncated search responses with omitted fields', () => {
      const handleId = factory.uuid();
      const toolCallId = factory.uuid();
      const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
        summary: 'Created a selection handle for 1 asset; response was truncated by budget',
        detail: 'handle',
        selectionHandle: {
          id: handleId,
          sourceRef: `asset-source:search:${handleId}` as const,
          assetCount: 1,
          sourceToolCallId: toolCallId,
          expiresAt: new Date('2026-05-21T12:30:00.000Z'),
        },
        returnedCount: 1,
        hasMore: false,
        nextPage: null,
        resultSize: {
          returnedItems: 1,
          hasMore: true,
          nextPage: null,
          estimatedBytes: 64_000,
          truncated: true,
          omittedFields: [],
        },
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success || encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.resultSize.truncated).toBe(true);
      expect(encoded.data.resultSize.omittedFields).toEqual([]);
      expect(AgentSearchAssetsToolResponseDto.schema.safeParse(encoded.data).success).toBe(true);
    });

    it('parses resolve filter success responses with resolved and choice search filters', () => {
      const tagId = factory.uuid();
      const albumId = factory.uuid();
      const result = AgentResolveAssetSearchFiltersToolResponseDto.schema.safeParse({
        status: 'success',
        toolCall: makeEncodedToolCall(),
        resolvedFilters: { tagIds: [tagId], albumIds: [albumId] },
        resultSize: makeResultSize({ returnedItems: 2 }),
        results: [
          {
            kind: 'tag',
            query: 'Travel',
            status: 'matched',
            id: tagId,
            value: 'Travel',
            searchFilter: { tagIds: [tagId] },
            choices: [
              {
                id: tagId,
                choiceRef: 'choice:tag:abcDEF1234567890',
                value: 'Travel',
                label: 'Travel',
                searchFilter: { tagIds: [tagId], takenAfter: '2026-05-01T00:00:00.000Z' },
              },
            ],
            message: 'Matched tag Travel.',
          },
          {
            kind: 'album',
            query: 'Berlin',
            status: 'matched',
            id: albumId,
            value: 'Berlin',
            searchFilter: { albumIds: [albumId] },
            choices: [],
            message: 'Matched album Berlin.',
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success && result.data.status === 'success') {
        expect(result.data.resolvedFilters.tagIds).toEqual([tagId]);
        expect(result.data.results[0].searchFilter).toEqual({ tagIds: [tagId] });
        expect(result.data.results[0].choices[0].searchFilter?.takenAfter).toEqual(
          new Date('2026-05-01T00:00:00.000Z'),
        );
      }
    });

    it('rejects resolve filter choices with raw UUID choice refs', () => {
      const tagId = factory.uuid();
      const result = AgentResolveAssetSearchFiltersToolResponseDto.schema.safeParse({
        status: 'success',
        toolCall: makeEncodedToolCall(),
        resolvedFilters: { tagIds: [tagId] },
        resultSize: makeResultSize({ returnedItems: 1 }),
        results: [
          {
            kind: 'tag',
            query: 'Travel',
            status: 'matched',
            id: tagId,
            value: 'Travel',
            searchFilter: { tagIds: [tagId] },
            choices: [
              {
                id: tagId,
                choiceRef: factory.uuid(),
                value: 'Travel',
                label: 'Travel',
                searchFilter: { tagIds: [tagId] },
              },
            ],
            message: 'Matched tag Travel.',
          },
        ],
      });

      expectIssue(result, ['results', 0, 'choices', 0, 'choiceRef'], 'choiceRef must use');
    });

    it('rejects resolve filter choices with raw UUID choice ref tokens', () => {
      const tagId = factory.uuid();
      const result = AgentResolveAssetSearchFiltersToolResponseDto.schema.safeParse({
        status: 'success',
        toolCall: makeEncodedToolCall(),
        resolvedFilters: { tagIds: [tagId] },
        resultSize: makeResultSize({ returnedItems: 1 }),
        results: [
          {
            kind: 'tag',
            query: 'Travel',
            status: 'matched',
            id: tagId,
            value: 'Travel',
            searchFilter: { tagIds: [tagId] },
            choices: [
              {
                id: tagId,
                choiceRef: `choice:tag:${factory.uuid()}`,
                value: 'Travel',
                label: 'Travel',
                searchFilter: { tagIds: [tagId] },
              },
            ],
            message: 'Matched tag Travel.',
          },
        ],
      });

      expectIssue(result, ['results', 0, 'choices', 0, 'choiceRef'], 'choiceRef token must not be a UUID');
    });

    it('rejects resolve filter choices with refs from a different result kind', () => {
      const tagId = factory.uuid();
      const result = AgentResolveAssetSearchFiltersToolResponseDto.schema.safeParse({
        status: 'success',
        toolCall: makeEncodedToolCall(),
        resolvedFilters: { tagIds: [tagId] },
        resultSize: makeResultSize({ returnedItems: 1 }),
        results: [
          {
            kind: 'tag',
            query: 'Travel',
            status: 'matched',
            id: tagId,
            value: 'Travel',
            searchFilter: { tagIds: [tagId] },
            choices: [
              {
                id: tagId,
                choiceRef: 'choice:person:abcDEF1234567890',
                value: 'Travel',
                label: 'Travel',
                searchFilter: { tagIds: [tagId] },
              },
            ],
            message: 'Matched tag Travel.',
          },
        ],
      });

      expectIssue(result, ['results', 0, 'choices', 0, 'choiceRef'], 'choiceRef kind must match result kind');
    });

    it('rejects resolve filter result search filters with spacePersonIds but no spaceId', () => {
      const result = AgentResolveAssetSearchFiltersToolResponseDto.schema.safeParse({
        status: 'success',
        toolCall: makeEncodedToolCall(),
        resolvedFilters: {},
        resultSize: makeResultSize(),
        results: [
          {
            kind: 'person',
            query: 'Pierre',
            status: 'matched',
            id: factory.uuid(),
            value: 'Pierre',
            searchFilter: { spacePersonIds: [factory.uuid()] },
            choices: [],
            message: 'Matched person Pierre.',
          },
        ],
      });

      expectIssue(result, ['results', 0, 'searchFilter', 'spacePersonIds'], 'spacePersonIds requires spaceId');
    });

    it('rejects resolve filter choice search filters with spaceId and withSharedSpaces', () => {
      const result = AgentResolveAssetSearchFiltersToolResponseDto.schema.safeParse({
        status: 'success',
        toolCall: makeEncodedToolCall(),
        resolvedFilters: {},
        resultSize: makeResultSize(),
        results: [
          {
            kind: 'space',
            query: 'Family',
            status: 'ambiguous',
            choices: [
              {
                id: factory.uuid(),
                value: 'Family',
                label: 'Family',
                searchFilter: { spaceId: factory.uuid(), withSharedSpaces: true },
              },
            ],
            message: 'Multiple spaces matched Family.',
          },
        ],
      });

      expectIssue(
        result,
        ['results', 0, 'choices', 0, 'searchFilter', 'withSharedSpaces'],
        'Cannot use both spaceId and withSharedSpaces',
      );
    });

    it('encodes and parses preview media reference responses', () => {
      const encoded = AgentReadAssetPreviewsToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall(),
        resultSize: makeResultSize(),
        previews: [makeMediaReference()],
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success) {
        return;
      }

      if (encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.previews[0]).toEqual(expect.objectContaining({ mediaUrl: '/api/assets/asset-1/preview' }));
      expect(AgentReadAssetPreviewsToolResponseDto.schema.safeParse(encoded.data).success).toBe(true);
    });

    it('encodes and parses original media reference responses', () => {
      const encoded = AgentReadAssetOriginalsToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall(),
        resultSize: makeResultSize(),
        originals: [makeMediaReference()],
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success) {
        return;
      }

      if (encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.originals[0]).toEqual(expect.objectContaining({ mediaUrl: '/api/assets/asset-1/preview' }));
      expect(AgentReadAssetOriginalsToolResponseDto.schema.safeParse(encoded.data).success).toBe(true);
    });

    it('encodes and parses list albums responses with empty and null date ranges', () => {
      const response = {
        status: 'success' as const,
        toolCall: makeToolCall({ albumCount: 2 }),
        resultSize: makeResultSize({ returnedItems: 2 }),
        albums: [
          makeAlbumSummary({ startDate: null, endDate: null }),
          makeAlbumSummary({ assetCount: 0, startDate: null, endDate: null }),
        ],
      };
      const encoded = AgentListAlbumsToolResponseDto.schema.safeEncode(response);

      expect(encoded.success).toBe(true);
      if (!encoded.success) {
        return;
      }

      if (encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.albums).toEqual([
        expect.objectContaining({ startDate: null, endDate: null }),
        expect.objectContaining({ assetCount: 0, startDate: null, endDate: null }),
      ]);
      expect(AgentListAlbumsToolResponseDto.schema.safeParse(encoded.data).success).toBe(true);
    });

    it('encodes and parses read album responses with assetIds and albumUsers', () => {
      const assetIds = [factory.uuid(), factory.uuid()];
      const sharedUserId = factory.uuid();
      const encoded = AgentReadAlbumToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall({ albumCount: 1, assetCount: assetIds.length }),
        resultSize: makeResultSize(),
        album: {
          ...makeAlbumSummary({ assetCount: assetIds.length }),
          assetIds,
          albumUsers: [{ userId: sharedUserId, role: 'editor' }],
        },
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success) {
        return;
      }

      if (encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.album.assetIds).toEqual(assetIds);
      expect(encoded.data.album.albumUsers).toEqual([{ userId: sharedUserId, role: 'editor' }]);
      expect(encoded.data.album.albumUsers[0]).not.toHaveProperty('email');
      expect(AgentReadAlbumToolResponseDto.schema.safeParse(encoded.data).success).toBe(true);
    });

    it('encodes and parses list spaces responses without assetIds', () => {
      const encoded = AgentListSpacesToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall({ toolName: AgentToolName.ListSpaces, albumCount: 0, assetCount: 0 }),
        resultSize: makeResultSize(),
        spaces: [makeSpaceSummary({ recentAssetIds: [factory.uuid()] })],
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success || encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.spaces[0]).not.toHaveProperty('assetIds');
      expect(AgentListSpacesToolResponseDto.schema.safeParse(encoded.data).success).toBe(true);
    });

    it('encodes and parses read space responses with redacted members and truncation metadata', () => {
      const assetIds = [factory.uuid(), factory.uuid()];
      const encoded = AgentReadSpaceToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall({ toolName: AgentToolName.ReadSpace, albumCount: 0, assetCount: assetIds.length }),
        resultSize: makeResultSize(),
        space: {
          ...makeSpaceSummary({ assetCount: assetIds.length }),
          assetIds,
          assetIdsReturned: assetIds.length,
          assetIdsTruncated: false,
          members: [
            {
              userId: factory.uuid(),
              name: 'Sam',
              role: 'viewer',
              avatarColor: null,
              profileImagePath: null,
            },
          ],
        },
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success || encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.space.assetIds).toEqual(assetIds);
      expect(encoded.data.space.assetIdsReturned).toBe(assetIds.length);
      expect(encoded.data.space.assetIdsTruncated).toBe(false);
      expect(encoded.data.space.members[0]).not.toHaveProperty('email');
      expect(AgentReadSpaceToolResponseDto.schema.safeParse(encoded.data).success).toBe(true);
    });

    it('encodes and parses search user responses without leaking unexpected user fields', () => {
      const encoded = AgentSearchUsersToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall: makeToolCall({ toolName: AgentToolName.SearchUsers, assetCount: 0, albumCount: 0 }),
        resultSize: makeResultSize(),
        users: [
          {
            userId: factory.uuid(),
            name: 'Pierre',
            email: 'pierre@example.com',
            avatarColor: 'blue',
            profileImagePath: null,
          },
        ],
      });

      expect(encoded.success).toBe(true);
      if (!encoded.success || encoded.data.status !== 'success') {
        return;
      }

      expect(encoded.data.users[0]).toEqual(expect.objectContaining({ name: 'Pierre', email: 'pierre@example.com' }));
      expect(encoded.data.users[0]).not.toHaveProperty('password');
      expect(AgentSearchUsersToolResponseDto.schema.safeParse(encoded.data).success).toBe(true);
    });
  });
});

const makeToolCall = (overrides: Partial<AgentToolCallResponseDto> = {}): AgentToolCallResponseDto => ({
  id: factory.uuid(),
  sessionId: factory.uuid(),
  toolName: AgentToolName.ReadAssetMetadata,
  status: AgentToolCallStatus.Completed,
  approvalDecision: AgentToolApprovalDecision.Approved,
  requestSummary: 'Read metadata for 1 asset',
  responseSummary: 'Returned metadata for 1 asset',
  dataClass: AgentToolDataClass.Metadata,
  assetCount: 1,
  albumCount: 0,
  startedAt: new Date('2026-05-14T12:00:00.000Z'),
  completedAt: new Date('2026-05-14T12:01:00.000Z'),
  error: null,
  ...overrides,
});

const makeEncodedToolCall = () => ({
  ...makeToolCall(),
  startedAt: '2026-05-14T12:00:00.000Z',
  completedAt: '2026-05-14T12:01:00.000Z',
});

const emptyResultSize = () => ({
  returnedItems: 0,
  hasMore: false,
  nextPage: null,
  estimatedBytes: null,
  truncated: false,
  omittedFields: [],
});

type TestResultSize = {
  returnedItems: number;
  hasMore: boolean;
  nextPage: string | null;
  estimatedBytes: number | null;
  truncated: boolean;
  omittedFields: string[];
};

const makeResultSize = (overrides: Partial<TestResultSize> = {}): TestResultSize => ({
  returnedItems: 1,
  hasMore: false,
  nextPage: null,
  estimatedBytes: 512,
  truncated: false,
  omittedFields: [],
  ...overrides,
});

const makeAssets = () => [
  {
    id: factory.uuid(),
    ownerId: factory.uuid(),
    type: AssetType.Image,
    originalFileName: 'IMG_0001.jpg',
    localDateTime: new Date('2026-05-14T12:00:00.000Z'),
    fileCreatedAt: new Date('2026-05-14T11:00:00.000Z'),
    fileModifiedAt: new Date('2026-05-14T11:30:00.000Z'),
    isFavorite: true,
    visibility: AssetVisibility.Timeline,
    exifInfo: {
      dateTimeOriginal: new Date('2026-05-14T10:00:00.000Z'),
      city: 'Berlin',
      state: 'Berlin',
      country: 'Germany',
      make: 'Fujifilm',
      model: 'X100V',
      lensModel: '23mm',
      latitude: 52.52,
      longitude: 13.405,
      rating: 5,
    },
    tags: [{ id: factory.uuid(), value: 'travel', color: '#00ff00' }],
  },
];

const makeEncodedAssets = () =>
  makeAssets().map((asset) => ({
    ...asset,
    localDateTime: '2026-05-14T12:00:00.000Z',
    fileCreatedAt: '2026-05-14T11:00:00.000Z',
    fileModifiedAt: '2026-05-14T11:30:00.000Z',
    exifInfo: {
      ...asset.exifInfo,
      dateTimeOriginal: '2026-05-14T10:00:00.000Z',
    },
  }));

const makeMediaReference = () => ({
  assetId: factory.uuid(),
  mediaUrl: '/api/assets/asset-1/preview',
  mimeType: 'image/jpeg',
  fileName: 'IMG_0001.jpg',
  width: 4000,
  height: 3000,
});

const makeAlbumSummary = (
  overrides: {
    assetCount?: number;
    startDate?: Date | null;
    endDate?: Date | null;
  } = {},
) => ({
  id: factory.uuid(),
  albumName: 'Berlin',
  description: '',
  ownerId: factory.uuid(),
  assetCount: 1,
  startDate: new Date('2026-05-01T00:00:00.000Z'),
  endDate: new Date('2026-05-31T23:59:59.999Z'),
  albumThumbnailAssetId: null,
  ...overrides,
});

const makeSpaceSummary = (overrides: Record<string, unknown> = {}) => ({
  id: factory.uuid(),
  name: 'Family',
  description: null,
  color: 'primary',
  createdById: factory.uuid(),
  assetCount: 0,
  memberCount: 1,
  thumbnailAssetId: null,
  recentAssetIds: [],
  ...overrides,
});
