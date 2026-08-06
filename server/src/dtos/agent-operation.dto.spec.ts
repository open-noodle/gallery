import {
  AgentOperationPlanApplyRequestDto,
  AgentOperationPlanApplyResponseDto,
  AgentOperationPlanParamsDto,
  AgentOperationPlanResponseDto,
  AgentOperationPlanSummaryRequestDto,
  AgentOperationPlanToolRequestSchemas,
  AgentOperationPlanToolResponseDto,
  AgentProposeAlbumOperationsDto,
  AgentReviseAlbumOperationsDto,
} from 'src/dtos/agent-operation.dto';
import {
  AgentOperationApplyStatus,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentToolName,
  AlbumUserRole,
  AssetType,
  AssetVisibility,
  SharedSpaceRole,
  UserAvatarColor,
} from 'src/enum';
import { factory } from 'test/small.factory';
import z from 'zod';

const parseBatchAction = (action: unknown) =>
  AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
    summary: 'Adjust matching photos.',
    action,
    assetSource: { kind: 'search', filters: { type: 'IMAGE' } },
  });

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

const parseSingleOperationProposal = (operation: Record<string, unknown>) =>
  AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
    summary: 'Update Family space.',
    operations: [operation],
  });

const makeCreateAlbumOperation = () => ({
  type: AgentOperationType.AlbumCreate,
  summary: 'Create Portugal highlights.',
  targetKind: AgentOperationTargetKind.NewAlbum,
  temporaryTargetId: 'tmp-portugal',
  payload: { albumName: 'Portugal highlights', description: '' },
});

const makePlanningToolRequest = () => ({
  summary: 'Create a Portugal highlights album.',
  operations: [makeCreateAlbumOperation()],
});

const makeSpaceCreateOperation = (temporaryTargetId = 'tmp-family-space') => ({
  type: AgentOperationType.SpaceCreate,
  summary: 'Create Family space.',
  targetKind: AgentOperationTargetKind.NewSpace,
  temporaryTargetId,
  payload: { spaceName: 'Family', description: 'Shared family photos.', color: 'blue' },
});

const makeAssetUpdateMetadataOperation = (payload: Record<string, unknown>) => ({
  type: AgentOperationType.AssetUpdateMetadata,
  summary: 'Update selected photo metadata.',
  targetKind: AgentOperationTargetKind.AssetBatch,
  assetIds: [factory.uuid()],
  payload,
});

const parsePlan = (input: unknown) => AgentProposeAlbumOperationsDto.schema.safeParse(input);

const makeValidTrashOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.AssetTrash,
  summary: 'Move matching photos to Trash.',
  targetKind: AgentOperationTargetKind.AssetBatch,
  assetIds: [factory.uuid()],
  ...overrides,
});

const makeValidRestoreOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.AssetRestore,
  summary: 'Restore matching photos from Trash.',
  targetKind: AgentOperationTargetKind.AssetBatch,
  assetIds: [factory.uuid()],
  ...overrides,
});

const makeValidSetVisibilityOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.AssetSetVisibility,
  summary: 'Move matching photos to the Locked folder.',
  targetKind: AgentOperationTargetKind.AssetBatch,
  assetIds: [factory.uuid()],
  payload: { visibility: AssetVisibility.Locked },
  ...overrides,
});

const makeValidCropOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.AssetCrop,
  summary: 'Crop image to region.',
  targetKind: AgentOperationTargetKind.ImageEditBatch,
  assetIds: [factory.uuid()],
  payload: { x: 10, y: 20, width: 400, height: 300 },
  ...overrides,
});

const makeValidShareLinkCreateOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.ShareLinkCreate,
  summary: 'Create a public share link for the selected photos.',
  targetKind: AgentOperationTargetKind.AssetBatch,
  assetIds: [factory.uuid()],
  payload: {},
  ...overrides,
});

const makeValidShareLinkCreateAlbumOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.ShareLinkCreateAlbum,
  summary: 'Create a public share link for the album.',
  targetKind: AgentOperationTargetKind.ExistingAlbum,
  targetId: factory.uuid(),
  payload: {},
  ...overrides,
});

const makeValidStackOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.AssetStack,
  summary: 'Stack matching photos.',
  targetKind: AgentOperationTargetKind.AssetBatch,
  assetIds: [factory.uuid()],
  ...overrides,
});

const makeValidUnstackOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.AssetUnstack,
  summary: 'Unstack matching photos.',
  targetKind: AgentOperationTargetKind.AssetBatch,
  assetIds: [factory.uuid()],
  ...overrides,
});

const makeValidPersonUpdateOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.PersonUpdate,
  summary: 'Rename person Alex to Alexander.',
  targetKind: AgentOperationTargetKind.Person,
  targetId: factory.uuid(),
  payload: { name: 'Alexander' },
  ...overrides,
});

const KEEP_PERSON_ID = factory.uuid();
const SOURCE_PERSON_ID = factory.uuid();

const makeValidPersonMergeOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.PersonMerge,
  summary: 'Merge Alejandra into Karina (irreversible).',
  targetKind: AgentOperationTargetKind.Person,
  targetId: KEEP_PERSON_ID,
  riskLevel: AgentOperationRiskLevel.High,
  payload: { sourcePersonIds: [SOURCE_PERSON_ID] },
  ...overrides,
});

const makeValidAlbumDeleteOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.AlbumDelete,
  summary: 'Delete the Test album (photos are kept in your library).',
  targetKind: AgentOperationTargetKind.ExistingAlbum,
  targetId: factory.uuid(),
  riskLevel: AgentOperationRiskLevel.High,
  enabled: true,
  ...overrides,
});

const makeValidSpaceDeleteOp = (overrides: Record<string, unknown> = {}) => ({
  type: AgentOperationType.SpaceDelete,
  summary: "Delete the Family space (photos stay in members' libraries).",
  targetKind: AgentOperationTargetKind.ExistingSpace,
  targetId: factory.uuid(),
  riskLevel: AgentOperationRiskLevel.High,
  enabled: true,
  ...overrides,
});

describe('Agent operation DTOs', () => {
  describe('asset source planning input', () => {
    it('accepts assetSelectionHandleId instead of explicit assetIds for asset-bearing operations', () => {
      const selectionHandleId = factory.uuid();
      const result = parsePlan({
        summary: 'Add handle-selected photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: factory.uuid(),
            assetSelectionHandleId: selectionHandleId,
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
            payload: {},
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.operations[0]).toMatchObject({ assetSelectionHandleId: selectionHandleId });
        expect(result.data.operations[0]).not.toHaveProperty('assetIds');
      }
    });

    it('rejects operations that provide both assetIds and assetSelectionHandleId', () => {
      const result = parsePlan({
        summary: 'Invalid mixed selection',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: factory.uuid(),
            assetIds: [factory.uuid()],
            assetSelectionHandleId: factory.uuid(),
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
            payload: {},
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain(
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('accepts previousSearch assetSource instead of explicit asset ids for asset-bearing operations', () => {
      const sourceRef = `asset-source:search:${factory.uuid()}`;
      const result = parsePlan({
        summary: 'Add prior search photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: factory.uuid(),
            assetSource: { kind: 'previousSearch', sourceRef },
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
            payload: {},
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.operations[0]).toMatchObject({
          assetSource: { kind: 'previousSearch', sourceRef },
        });
        expect(result.data.operations[0]).not.toHaveProperty('assetIds');
        expect(result.data.operations[0]).not.toHaveProperty('assetSelectionHandleId');
      }
    });

    it('accepts a declarative search assetSource for asset-bearing operations', () => {
      const result = parsePlan({
        summary: 'Add searched photos directly',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add matching photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: factory.uuid(),
            assetSource: {
              kind: 'search',
              mode: 'metadata',
              filters: {
                country: 'South Africa',
                takenAfter: '2026-01-01T00:00:00.000Z',
                takenBefore: '2026-02-01T00:00:00.000Z',
                people: { match: 'any', names: ['Pierre', 'Aurelia'] },
              },
              materialization: 'all-matches-with-limit',
            },
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
            payload: {},
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.operations[0]).toMatchObject({
          assetSource: {
            kind: 'search',
            mode: 'metadata',
            filters: {
              country: 'South Africa',
              people: { match: 'any', names: ['Pierre', 'Aurelia'] },
            },
          },
        });
      }
    });

    it('accepts provider planning assetSource.selectionHandle', () => {
      const selectionHandleId = '00000000-0000-4000-8000-000000000333';

      expect(
        AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
          summary: 'Create an album from a selection handle.',
          operations: [
            {
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add handle assets.',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: '00000000-0000-4000-8000-000000000111',
              assetSource: { kind: 'selectionHandle', selectionHandleId },
              payload: {},
            },
          ],
        }).success,
      ).toBe(true);
    });

    it.each([['explicitAssets', { kind: 'explicitAssets', assetIds: [factory.uuid()] }]])(
      'rejects %s assetSource in operation planning until that source kind is supported here',
      (_label, assetSource) => {
        const result = parsePlan({
          summary: 'Unsupported source kind',
          operations: [
            {
              type: AgentOperationType.AlbumAddAssets,
              summary: 'Add selected photos',
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: factory.uuid(),
              assetSource,
              riskLevel: AgentOperationRiskLevel.Medium,
              enabled: true,
              payload: {},
            },
          ],
        });

        expect(result.success).toBe(false);
        expectIssue(result, ['operations', 0, 'assetSource', 'kind'], 'Invalid input');
      },
    );

    it('rejects asset-bearing operations that provide assetSource and assetIds', () => {
      const result = parsePlan({
        summary: 'Invalid mixed selection',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: factory.uuid(),
            assetSource: { kind: 'previousSearch', sourceRef: `asset-source:search:${factory.uuid()}` },
            assetIds: [factory.uuid()],
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
            payload: {},
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain(
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('rejects asset-bearing operations that provide assetSource and assetSelectionHandleId', () => {
      const result = parsePlan({
        summary: 'Invalid mixed selection',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: factory.uuid(),
            assetSource: { kind: 'previousSearch', sourceRef: `asset-source:search:${factory.uuid()}` },
            assetSelectionHandleId: factory.uuid(),
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
            payload: {},
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain(
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('rejects asset-bearing operations that provide neither assetSource, assetIds nor assetSelectionHandleId', () => {
      const result = parsePlan({
        summary: 'Invalid missing selection',
        operations: [
          {
            type: AgentOperationType.SpaceAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: factory.uuid(),
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
            payload: {},
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain(
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });
  });

  it('accepts a create album operation proposal and defaults enabled/risk fields', () => {
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Create a Portugal trip album.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal 2026.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal-2026',
          payload: { albumName: 'Portugal 2026', description: 'Best travel photos.' },
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operations[0]).toMatchObject({
        enabled: true,
        riskLevel: AgentOperationRiskLevel.Low,
      });
    }
  });

  it('accepts add assets to a newly proposed album by temporary target id', () => {
    const assetId = factory.uuid();
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Create Portugal and add one photo.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal 2026.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal-2026',
          payload: { albumName: 'Portugal 2026' },
        },
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add beach photo.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal-2026',
          assetIds: [assetId],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts one valid sample for each expanded operation type', () => {
    const albumId = factory.uuid();
    const existingSpaceId = factory.uuid();
    const firstAssetId = factory.uuid();
    const secondAssetId = factory.uuid();
    const tagId = factory.uuid();

    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Organize spaces and asset batches.',
      operations: [
        {
          type: AgentOperationType.AlbumRemoveAssets,
          summary: 'Remove a duplicate from an album.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetIds: [firstAssetId],
          payload: {},
        },
        makeSpaceCreateOperation(),
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add a photo to the new space.',
          targetKind: AgentOperationTargetKind.NewSpace,
          temporaryTargetId: 'tmp-family-space',
          assetIds: [firstAssetId],
          payload: {},
        },
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add a photo to an existing space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: existingSpaceId,
          assetIds: [secondAssetId],
        },
        {
          type: AgentOperationType.SpaceRemoveAssets,
          summary: 'Remove a photo from an existing space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: existingSpaceId,
          assetIds: [firstAssetId],
        },
        {
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Rename an existing space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: existingSpaceId,
          payload: { spaceName: 'Family 2026', description: 'Updated highlights.', color: 'amber' },
        },
        {
          type: AgentOperationType.AssetRotate,
          summary: 'Rotate one image.',
          targetKind: AgentOperationTargetKind.ImageEditBatch,
          assetIds: [firstAssetId],
          payload: { angle: 90 },
        },
        {
          type: AgentOperationType.AssetSetFavorite,
          summary: 'Favorite one image.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [firstAssetId],
          payload: { favorite: true },
        },
        {
          type: AgentOperationType.AssetSetArchive,
          summary: 'Archive one image.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [secondAssetId],
          payload: { archived: true },
        },
        {
          type: AgentOperationType.AssetUpdateMetadata,
          summary: 'Update photo metadata.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [firstAssetId],
          payload: { description: 'Berlin weekend', rating: 5 },
        },
        {
          type: AgentOperationType.AssetAddTag,
          summary: 'Add an existing tag.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [firstAssetId],
          payload: { tagId },
        },
        {
          type: AgentOperationType.AssetRemoveTag,
          summary: 'Remove an existing tag.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [secondAssetId],
          payload: { tagId },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  describe('asset.updateMetadata planning operations', () => {
    it.each([
      ['description', { description: 'Berlin weekend' }],
      ['clear description', { description: '' }],
      ['rating', { rating: 5 }],
      ['clear rating', { rating: null }],
      ['absolute datetime', { dateTimeOriginal: '1998-06-01T12:00:00.000Z' }],
      ['relative datetime minutes', { dateTimeRelative: 120 }],
      ['timezone', { timeZone: 'Europe/Berlin' }],
      ['explicit coordinates', { latitude: 48.8566, longitude: 2.3522 }],
      [
        'combined metadata fields',
        {
          description: 'Paris scan',
          rating: 4,
          dateTimeOriginal: '1998-06-01T12:00:00.000Z',
          timeZone: 'Europe/Paris',
          latitude: 48.8566,
          longitude: 2.3522,
        },
      ],
    ])('accepts asset.updateMetadata with %s payload', (_name, payload) => {
      const result = AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Update selected photo metadata.',
        operations: [makeAssetUpdateMetadataOperation(payload)],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.operations[0]).toMatchObject({
          type: AgentOperationType.AssetUpdateMetadata,
          targetKind: AgentOperationTargetKind.AssetBatch,
          payload,
        });
      }
    });

    it('trims non-empty asset.updateMetadata descriptions', () => {
      const result = AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Update selected photo metadata.',
        operations: [makeAssetUpdateMetadataOperation({ description: '  Berlin weekend  ' })],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        if (op.type !== AgentOperationType.AssetUpdateMetadata) {
          throw new Error('unexpected op type');
        }
        expect(op.payload).toMatchObject({ description: 'Berlin weekend' });
      }
    });

    it('requires asset.updateMetadata to use an asset_batch target and one asset source mechanism', () => {
      expectIssue(
        AgentProposeAlbumOperationsDto.schema.safeParse({
          summary: 'Invalid metadata target.',
          operations: [
            {
              ...makeAssetUpdateMetadataOperation({ rating: 5 }),
              targetKind: AgentOperationTargetKind.ExistingAlbum,
              targetId: factory.uuid(),
            },
          ],
        }),
        ['operations', 0, 'targetKind'],
        'asset.updateMetadata requires an asset_batch target',
      );

      expectIssue(
        AgentProposeAlbumOperationsDto.schema.safeParse({
          summary: 'Invalid metadata selection.',
          operations: [{ ...makeAssetUpdateMetadataOperation({ rating: 5 }), assetIds: undefined }],
        }),
        ['operations', 0],
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it.each([
      {
        name: 'empty payload',
        payload: {},
        path: ['operations', 0, 'payload'],
        message: 'Provide at least one metadata field to update',
      },
      {
        name: 'unknown placeName field',
        payload: { placeName: 'Paris' },
        path: ['operations', 0, 'payload'],
        message: 'Unrecognized key',
      },
      {
        name: 'unknown city field',
        payload: { city: 'Paris' },
        path: ['operations', 0, 'payload'],
        message: 'Unrecognized key',
      },
      {
        name: 'unknown country field',
        payload: { country: 'France' },
        path: ['operations', 0, 'payload'],
        message: 'Unrecognized key',
      },
      {
        name: 'unknown title field',
        payload: { title: 'Paris scan' },
        path: ['operations', 0, 'payload'],
        message: 'Unrecognized key',
      },
      {
        name: 'overlong description',
        payload: { description: 'a'.repeat(1001) },
        path: ['operations', 0, 'payload', 'description'],
        message: 'Too big',
      },
      {
        name: 'rating zero',
        payload: { rating: 0 },
        path: ['operations', 0, 'payload', 'rating'],
        message: 'Too small',
      },
      {
        name: 'negative rating',
        payload: { rating: -1 },
        path: ['operations', 0, 'payload', 'rating'],
        message: 'Too small',
      },
      {
        name: 'rating above five',
        payload: { rating: 6 },
        path: ['operations', 0, 'payload', 'rating'],
        message: 'Too big',
      },
      {
        name: 'invalid datetime',
        payload: { dateTimeOriginal: 'June 1998' },
        path: ['operations', 0, 'payload', 'dateTimeOriginal'],
        message: 'Invalid ISO datetime',
      },
      {
        name: 'absolute and relative datetime',
        payload: { dateTimeOriginal: '1998-06-01T12:00:00.000Z', dateTimeRelative: 60 },
        path: ['operations', 0, 'payload'],
        message: 'Choose dateTimeOriginal or dateTimeRelative, not both',
      },
      {
        name: 'relative datetime zero alone',
        payload: { dateTimeRelative: 0 },
        path: ['operations', 0, 'payload', 'dateTimeRelative'],
        message: 'dateTimeRelative: 0 is a no-op unless another metadata field changes',
      },
      {
        name: 'relative datetime non-integer',
        payload: { dateTimeRelative: 1.5 },
        path: ['operations', 0, 'payload', 'dateTimeRelative'],
        message: 'Invalid input',
      },
      {
        name: 'blank timezone',
        payload: { timeZone: '   ' },
        path: ['operations', 0, 'payload', 'timeZone'],
        message: 'Invalid IANA time zone',
      },
      {
        name: 'invalid timezone',
        payload: { timeZone: 'Berlin' },
        path: ['operations', 0, 'payload', 'timeZone'],
        message: 'Invalid IANA time zone',
      },
      {
        name: 'latitude without longitude',
        payload: { latitude: 48.8566 },
        path: ['operations', 0, 'payload'],
        message: 'Provide both latitude and longitude',
      },
      {
        name: 'longitude without latitude',
        payload: { longitude: 2.3522 },
        path: ['operations', 0, 'payload'],
        message: 'Provide both latitude and longitude',
      },
      {
        name: 'null latitude',
        payload: { latitude: null, longitude: 2.3522 },
        path: ['operations', 0, 'payload', 'latitude'],
        message: 'Invalid input',
      },
      {
        name: 'null longitude',
        payload: { latitude: 48.8566, longitude: null },
        path: ['operations', 0, 'payload', 'longitude'],
        message: 'Invalid input',
      },
      {
        name: 'latitude above range',
        payload: { latitude: 91, longitude: 2.3522 },
        path: ['operations', 0, 'payload', 'latitude'],
        message: 'Too big',
      },
      {
        name: 'longitude above range',
        payload: { latitude: 48.8566, longitude: 181 },
        path: ['operations', 0, 'payload', 'longitude'],
        message: 'Too big',
      },
      {
        name: 'non-finite coordinate',
        payload: { latitude: Number.POSITIVE_INFINITY, longitude: 2.3522 },
        path: ['operations', 0, 'payload', 'latitude'],
        message: 'Invalid input',
      },
    ])('rejects asset.updateMetadata with $name', ({ payload, path, message }) => {
      expectIssue(
        AgentProposeAlbumOperationsDto.schema.safeParse({
          summary: 'Update selected photo metadata.',
          operations: [makeAssetUpdateMetadataOperation(payload)],
        }),
        path,
        message,
      );
    });
  });

  it('accepts shared-space member management operations for existing spaces', () => {
    const spaceId = factory.uuid();
    const userId = factory.uuid();
    const otherUserId = factory.uuid();

    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Manage Family space members.',
      operations: [
        {
          type: AgentOperationType.SpaceAddMembers,
          summary: 'Add Alex as editor.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: { members: [{ userId, role: SharedSpaceRole.Editor }] },
        },
        {
          type: AgentOperationType.SpaceRemoveMembers,
          summary: 'Remove Chris.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: { userIds: [otherUserId] },
        },
        {
          type: AgentOperationType.SpaceUpdateMemberRole,
          summary: 'Make Sam a viewer.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: { userIds: [userId], role: SharedSpaceRole.Viewer },
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operations).toHaveLength(3);
    }
  });

  it.each([
    {
      name: 'add members without members',
      operation: {
        type: AgentOperationType.SpaceAddMembers,
        summary: 'Add member.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: factory.uuid(),
        payload: { members: [] },
      },
      path: ['operations', 0, 'payload', 'members'],
      message: 'Too small',
    },
    {
      name: 'add member as owner',
      operation: {
        type: AgentOperationType.SpaceAddMembers,
        summary: 'Add owner.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: factory.uuid(),
        payload: { members: [{ userId: factory.uuid(), role: SharedSpaceRole.Owner }] },
      },
      path: ['operations', 0, 'payload', 'members', 0, 'role'],
      message: 'Invalid option',
    },
    {
      name: 'remove duplicate members',
      operation: {
        type: AgentOperationType.SpaceRemoveMembers,
        summary: 'Remove duplicate member.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: factory.uuid(),
        payload: {
          userIds: ['00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000030'],
        },
      },
      path: ['operations', 0, 'payload', 'userIds'],
      message: 'userIds must be unique',
    },
    {
      name: 'role update without target id',
      operation: {
        type: AgentOperationType.SpaceUpdateMemberRole,
        summary: 'Make Sam viewer.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        payload: { userIds: [factory.uuid()], role: SharedSpaceRole.Viewer },
      },
      path: ['operations', 0, 'targetId'],
      message: 'targetId is required',
    },
    {
      name: 'role update to owner',
      operation: {
        type: AgentOperationType.SpaceUpdateMemberRole,
        summary: 'Make Sam owner.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: factory.uuid(),
        payload: { userIds: [factory.uuid()], role: SharedSpaceRole.Owner },
      },
      path: ['operations', 0, 'payload', 'role'],
      message: 'Invalid option',
    },
    {
      name: 'member operation with temporary target',
      operation: {
        type: AgentOperationType.SpaceRemoveMembers,
        summary: 'Remove member.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: factory.uuid(),
        temporaryTargetId: 'tmp-space',
        payload: { userIds: [factory.uuid()] },
      },
      path: ['operations', 0, 'temporaryTargetId'],
      message: 'Use targetId',
    },
  ])('rejects invalid shared-space member operation: $name', ({ operation, path, message }) => {
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Invalid member plan.',
        operations: [operation],
      }),
      path,
      message,
    );
  });

  it('accepts album-user sharing operations for existing albums', () => {
    const albumId = factory.uuid();
    const userId = factory.uuid();
    const otherUserId = factory.uuid();

    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Manage Family album members.',
      operations: [
        {
          type: AgentOperationType.AlbumAddUsers,
          summary: 'Add Alex as viewer.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          payload: { albumUsers: [{ userId, role: AlbumUserRole.Viewer }] },
        },
        {
          type: AgentOperationType.AlbumRemoveUsers,
          summary: 'Remove Chris.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          payload: { userIds: [otherUserId] },
        },
        {
          type: AgentOperationType.AlbumUpdateUserRole,
          summary: 'Make Sam an editor.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          payload: { userId, role: AlbumUserRole.Editor },
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operations).toHaveLength(3);
    }
  });

  it.each([
    {
      name: 'addUsers without albumUsers',
      operation: {
        type: AgentOperationType.AlbumAddUsers,
        summary: 'Add user.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        payload: { albumUsers: [] },
      },
      path: ['operations', 0, 'payload', 'albumUsers'],
      message: 'Too small',
    },
    {
      name: 'addUsers with invalid role',
      operation: {
        type: AgentOperationType.AlbumAddUsers,
        summary: 'Add owner.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        payload: { albumUsers: [{ userId: factory.uuid(), role: 'owner' }] },
      },
      path: ['operations', 0, 'payload', 'albumUsers', 0, 'role'],
      message: 'Invalid option',
    },
    {
      name: 'removeUsers without targetId',
      operation: {
        type: AgentOperationType.AlbumRemoveUsers,
        summary: 'Remove user.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        payload: { userIds: [factory.uuid()] },
      },
      path: ['operations', 0, 'targetId'],
      message: 'targetId is required',
    },
    {
      name: 'removeUsers with duplicate userIds',
      operation: {
        type: AgentOperationType.AlbumRemoveUsers,
        summary: 'Remove duplicate.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        payload: {
          userIds: ['00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000030'],
        },
      },
      path: ['operations', 0, 'payload', 'userIds'],
      message: 'userIds must be unique',
    },
    {
      name: 'updateUserRole with invalid role',
      operation: {
        type: AgentOperationType.AlbumUpdateUserRole,
        summary: 'Make owner.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        payload: { userId: factory.uuid(), role: 'owner' },
      },
      path: ['operations', 0, 'payload', 'role'],
      message: 'Invalid option',
    },
    {
      name: 'updateUserRole without targetId',
      operation: {
        type: AgentOperationType.AlbumUpdateUserRole,
        summary: 'Update role.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        payload: { userId: factory.uuid(), role: AlbumUserRole.Editor },
      },
      path: ['operations', 0, 'targetId'],
      message: 'targetId is required',
    },
  ])('rejects invalid album-user sharing operation: $name', ({ operation, path, message }) => {
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Invalid album sharing plan.',
        operations: [operation],
      }),
      path,
      message,
    );
  });

  it('validates supported existing-space detail update payload shapes', () => {
    const spaceId = factory.uuid();
    const base = {
      summary: 'Update Family space.',
      operations: [
        {
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Update Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: {},
        },
      ],
    };

    for (const payload of [
      { spaceName: 'Family 2026' },
      { description: 'Photos for everyone.' },
      { description: '' },
      { color: 'blue' },
      { spaceName: 'Family 2026', description: '', color: 'amber' },
    ]) {
      expect(
        AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
          ...base,
          operations: [{ ...base.operations[0], payload }],
        }).success,
      ).toBe(true);
    }
  });

  it('rejects invalid existing-space detail update payloads with actionable messages', () => {
    const spaceId = factory.uuid();
    const base = {
      type: AgentOperationType.SpaceUpdateDetails,
      summary: 'Update Family space.',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
    };

    const emptyPayload = parseSingleOperationProposal({ ...base, payload: {} });
    expect(emptyPayload.success).toBe(false);
    if (emptyPayload.success) {
      throw new Error('Expected empty space update payload to fail validation');
    }
    expect(
      (z.treeifyError(emptyPayload.error).properties?.operations?.items?.[0]?.properties as any)?.payload?.errors,
    ).toContain('Provide spaceName, description, or color');

    for (const payload of [
      { thumbnailAssetId: factory.uuid() },
      { petsEnabled: false },
      { faceRecognitionEnabled: true },
      { linkedLibraryIds: [factory.uuid()] },
      { delete: true },
    ]) {
      const result = parseSingleOperationProposal({ ...base, payload });
      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error(`Expected unsupported space update payload ${JSON.stringify(payload)} to fail validation`);
      }
      expect(JSON.stringify(z.treeifyError(result.error))).toMatch(/Unrecognized key|unsupported/i);
    }

    const invalidColor = parseSingleOperationProposal({ ...base, payload: { color: '#80c7ff' } });
    expect(invalidColor.success).toBe(false);
    if (invalidColor.success) {
      throw new Error('Expected invalid space color to fail validation');
    }
    expect(JSON.stringify(z.treeifyError(invalidColor.error))).toMatch(/color/i);
  });

  it('requires existing-space target id and rejects temporary targets or asset ids for detail updates', () => {
    const spaceId = factory.uuid();
    const base = {
      type: AgentOperationType.SpaceUpdateDetails,
      summary: 'Update Family space.',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      payload: { spaceName: 'Family 2026' },
    };

    for (const operation of [
      { ...base, targetId: undefined },
      { ...base, targetKind: AgentOperationTargetKind.NewSpace, temporaryTargetId: 'tmp-space', targetId: undefined },
      { ...base, temporaryTargetId: 'tmp-space' },
      { ...base, assetIds: [factory.uuid()] },
    ]) {
      expect(
        AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
          summary: 'Update Family space.',
          operations: [operation],
        }).success,
      ).toBe(false);
    }
  });

  it('accepts asset.addTag with a new tag name', () => {
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Tag receipts.',
      operations: [
        {
          type: AgentOperationType.AssetAddTag,
          summary: 'Add Receipts tag.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [factory.uuid()],
          payload: { tagName: 'Receipts' },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid expanded operation target combinations', () => {
    const existingAlbumId = factory.uuid();
    const existingSpaceId = factory.uuid();

    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Invalid space create.',
        operations: [
          {
            type: AgentOperationType.SpaceCreate,
            summary: 'Create without temp id.',
            targetKind: AgentOperationTargetKind.NewSpace,
            payload: { spaceName: 'Family' },
          },
        ],
      }),
      ['operations', 0, 'temporaryTargetId'],
      'Required',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Missing new album dependency.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add to missing new album.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-missing-album',
            assetIds: [factory.uuid()],
          },
        ],
      }),
      ['operations', 0, 'temporaryTargetId'],
      'No matching create operation for temporaryTargetId',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Missing new space dependency.',
        operations: [
          {
            type: AgentOperationType.SpaceAddAssets,
            summary: 'Add to missing new space.',
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-missing-space',
            assetIds: [factory.uuid()],
          },
        ],
      }),
      ['operations', 0, 'temporaryTargetId'],
      'No matching create operation for temporaryTargetId',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Existing space missing target id.',
        operations: [
          {
            type: AgentOperationType.SpaceRemoveAssets,
            summary: 'Remove without target id.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            assetIds: [factory.uuid()],
          },
        ],
      }),
      ['operations', 0, 'targetId'],
      'targetId is required for existing space targets',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Asset batch cannot target albums.',
        operations: [
          {
            type: AgentOperationType.AssetSetFavorite,
            summary: 'Favorite with album target.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: existingAlbumId,
            assetIds: [factory.uuid()],
            payload: { favorite: true },
          },
        ],
      }),
      ['operations', 0, 'targetKind'],
      'asset.setFavorite requires an asset_batch target',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Image edit cannot target spaces.',
        operations: [
          {
            type: AgentOperationType.AssetRotate,
            summary: 'Rotate with space target.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: existingSpaceId,
            assetIds: [factory.uuid()],
            payload: { angle: 90 },
          },
        ],
      }),
      ['operations', 0, 'targetKind'],
      'asset.rotate requires an image_edit_batch target',
    );
  });

  it('requires existing-space asset operations to use targetId without temporaryTargetId', () => {
    const targetId = '00000000-0000-4000-8000-000000000020';
    const assetId = '00000000-0000-4000-8000-000000000001';

    expect(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].parse({
        summary: 'Add selected photos to Family.',
        operations: [
          {
            type: AgentOperationType.SpaceAddAssets,
            summary: 'Add selected photos to Family.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId,
            assetIds: [assetId],
            payload: {},
          },
        ],
      }).operations[0],
    ).toMatchObject({ targetKind: AgentOperationTargetKind.ExistingSpace, targetId });

    expectIssue(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
        summary: 'Add selected photos to Family.',
        operations: [
          {
            type: AgentOperationType.SpaceAddAssets,
            summary: 'Add selected photos to Family.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId,
            assetIds: [assetId],
            payload: {},
          },
        ],
      }),
      ['operations', 0, 'targetKind'],
      'space operations require a space target',
    );

    expectIssue(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
        summary: 'Remove selected photos from Family.',
        operations: [
          {
            type: AgentOperationType.SpaceRemoveAssets,
            summary: 'Remove selected photos from Family.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId,
            temporaryTargetId: 'tmp-family',
            assetIds: [assetId],
            payload: {},
          },
        ],
      }),
      ['operations', 0, 'temporaryTargetId'],
      'Use targetId for existing spaces',
    );
  });

  it('rejects invalid expanded operation payloads and bounds', () => {
    const assetId = factory.uuid();

    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Empty asset batch.',
        operations: [
          {
            type: AgentOperationType.AssetSetFavorite,
            summary: 'Favorite nothing.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [],
            payload: { favorite: true },
          },
        ],
      }),
      ['operations', 0, 'assetIds'],
      'Too small',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Duplicate asset batch.',
        operations: [
          {
            type: AgentOperationType.AssetSetArchive,
            summary: 'Archive duplicates.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [assetId, assetId],
            payload: { archived: true },
          },
        ],
      }),
      ['operations', 0, 'assetIds'],
      'assetIds must be unique',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Invalid rotate.',
        operations: [
          {
            type: AgentOperationType.AssetRotate,
            summary: 'Rotate badly.',
            targetKind: AgentOperationTargetKind.ImageEditBatch,
            assetIds: [factory.uuid()],
            payload: { angle: 45 },
          },
        ],
      }),
      ['operations', 0, 'payload', 'angle'],
      'angle must be 90, 180, or 270',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Missing favorite boolean.',
        operations: [
          {
            type: AgentOperationType.AssetSetFavorite,
            summary: 'Favorite without boolean.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [factory.uuid()],
            payload: {},
          },
        ],
      }),
      ['operations', 0, 'payload', 'favorite'],
      'Invalid input',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Missing archive boolean.',
        operations: [
          {
            type: AgentOperationType.AssetSetArchive,
            summary: 'Archive without boolean.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [factory.uuid()],
            payload: {},
          },
        ],
      }),
      ['operations', 0, 'payload', 'archived'],
      'Invalid input',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Missing tag.',
        operations: [
          {
            type: AgentOperationType.AssetAddTag,
            summary: 'Add no tag.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [factory.uuid()],
            payload: {},
          },
        ],
      }),
      ['operations', 0, 'payload'],
      'Provide exactly one of tagId or tagName',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Both tag fields.',
        operations: [
          {
            type: AgentOperationType.AssetAddTag,
            summary: 'Add ambiguous tag.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [factory.uuid()],
            payload: { tagId: factory.uuid(), tagName: 'Receipts' },
          },
        ],
      }),
      ['operations', 0, 'payload'],
      'Provide exactly one of tagId or tagName',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Remove missing tag.',
        operations: [
          {
            type: AgentOperationType.AssetRemoveTag,
            summary: 'Remove no tag.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [factory.uuid()],
            payload: {},
          },
        ],
      }),
      ['operations', 0, 'payload', 'tagId'],
      'Invalid input',
    );
  });

  it('rejects create album operations without a temporary target id', () => {
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid create.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create missing temp id.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          payload: { albumName: 'Portugal' },
        },
      ],
    });

    expectIssue(result, ['operations', 0, 'temporaryTargetId'], 'Required');
  });

  it('rejects duplicate asset ids within one operation', () => {
    const assetId = factory.uuid();
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid add.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Duplicate add.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          assetIds: [assetId, assetId],
        },
      ],
    });

    expectIssue(result, ['operations', 0, 'assetIds'], 'assetIds must be unique');
  });

  it('rejects existing album operations without targetId', () => {
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid target.',
      operations: [
        {
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover without target id.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          assetIds: [factory.uuid()],
        },
      ],
    });

    expectIssue(result, ['operations', 0, 'targetId'], 'targetId is required for existing album targets');
  });

  it('rejects existing album add-assets targets with temporary target ids', () => {
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid contradictory target.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add photos ambiguously.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          temporaryTargetId: 'tmp-portugal-2026',
          assetIds: [factory.uuid()],
        },
      ],
    });

    expectIssue(
      result,
      ['operations', 0, 'temporaryTargetId'],
      'temporaryTargetId is only valid for new album targets',
    );
  });

  it('rejects new album set-cover targets with persistent target ids', () => {
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid contradictory target.',
      operations: [
        {
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover ambiguously.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: factory.uuid(),
          temporaryTargetId: 'tmp-portugal-2026',
          assetIds: [factory.uuid()],
        },
      ],
    });

    expectIssue(result, ['operations', 0, 'targetId'], 'targetId is only valid for existing album targets');
  });

  it('enforces operation count, asset count, text limits, and create-description defaults', () => {
    const assetIds = Array.from({ length: 10_001 }, () => factory.uuid());
    const tooManyOperations = Array.from({ length: 501 }, (_, index) => ({
      type: AgentOperationType.AlbumCreate,
      summary: `Create album ${index}.`,
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: `tmp-album-${index}`,
      payload: { albumName: `Album ${index}` },
    }));

    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Too many operations.',
        operations: tooManyOperations,
      }),
      ['operations'],
      'Too big',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Too many assets.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add too many assets.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: factory.uuid(),
            assetIds,
          },
        ],
      }),
      ['operations', 0, 'assetIds'],
      'Too big',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Long album name.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create with long name.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-long-name',
            payload: { albumName: 'a'.repeat(201) },
          },
        ],
      }),
      ['operations', 0, 'payload', 'albumName'],
      'Too big',
    );
    expectIssue(
      AgentProposeAlbumOperationsDto.schema.safeParse({
        summary: 'Long description.',
        operations: [
          {
            type: AgentOperationType.AlbumUpdateDetails,
            summary: 'Update with long description.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: factory.uuid(),
            payload: { description: 'a'.repeat(1001) },
          },
        ],
      }),
      ['operations', 0, 'payload', 'description'],
      'Too big',
    );
    expectIssue(
      AgentReviseAlbumOperationsDto.schema.safeParse({
        feedback: 'a'.repeat(2001),
        summary: 'Revise with too much feedback.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create album.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-album',
            payload: { albumName: 'Album' },
          },
        ],
      }),
      ['feedback'],
      'Too big',
    );

    const validCreate = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Create album.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create with default description.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-default-description',
          payload: { albumName: 'Album' },
        },
      ],
    });

    expect(validCreate.success).toBe(true);
    if (validCreate.success) {
      const op = validCreate.data.operations[0];
      if (op.type !== AgentOperationType.AlbumCreate) {
        throw new Error('unexpected op type');
      }
      expect(op.payload).toMatchObject({ description: '' });
    }
  });

  it('accepts revision requests with a non-empty operation list', () => {
    const result = AgentReviseAlbumOperationsDto.schema.safeParse({
      feedback: 'Split Lisbon and Porto into separate albums.',
      summary: 'Separate city albums.',
      operations: [
        {
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Rename existing album.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          payload: { albumName: 'Lisbon highlights' },
          riskLevel: AgentOperationRiskLevel.Medium,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts summarize-plan requests', () => {
    const result = AgentOperationPlanSummaryRequestDto.schema.safeParse({
      focus: 'Explain high risk changes.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts operation plan params', () => {
    const result = AgentOperationPlanParamsDto.schema.safeParse({ id: factory.uuid(), planId: factory.uuid() });

    expect(result.success).toBe(true);
  });

  it('serializes persisted plan responses with dates and dependency ids', () => {
    const planId = factory.uuid();
    const operationId = factory.uuid();
    const dependencyId = factory.uuid();
    const result = AgentOperationPlanResponseDto.schema.safeParse({
      id: planId,
      sessionId: factory.uuid(),
      revision: 2,
      status: AgentOperationPlanStatus.Proposed,
      summary: 'Portugal album plan.',
      operations: [
        {
          id: operationId,
          planId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add photos.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: null,
          temporaryTargetId: 'tmp-portugal-2026',
          assetIds: [factory.uuid()],
          payload: {},
          dependencyIds: [dependencyId],
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
          createdAt: '2026-05-15T12:00:00.000Z',
          updatedAt: '2026-05-15T12:00:01.000Z',
        },
      ],
      createdAt: '2026-05-15T12:00:00.000Z',
      updatedAt: '2026-05-15T12:00:01.000Z',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdAt).toEqual(new Date('2026-05-15T12:00:00.000Z'));
      expect(result.data.operations[0].dependencyIds).toEqual([dependencyId]);
    }
  });

  it('encodes Date-backed persisted plan responses as ISO strings', () => {
    const planId = factory.uuid();
    const result = AgentOperationPlanResponseDto.schema.safeEncode({
      id: planId,
      sessionId: factory.uuid(),
      revision: 1,
      status: AgentOperationPlanStatus.Proposed,
      summary: 'Portugal album plan.',
      operations: [
        {
          id: factory.uuid(),
          planId,
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          temporaryTargetId: null,
          assetIds: [factory.uuid()],
          payload: {},
          dependencyIds: [],
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
          createdAt: new Date('2026-05-15T12:00:00.000Z'),
          updatedAt: new Date('2026-05-15T12:00:01.000Z'),
        },
      ],
      createdAt: new Date('2026-05-15T12:00:00.000Z'),
      updatedAt: new Date('2026-05-15T12:00:01.000Z'),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdAt).toBe('2026-05-15T12:00:00.000Z');
      expect(result.data.operations[0].updatedAt).toBe('2026-05-15T12:00:01.000Z');
    }
  });

  it('accepts a unique apply operation id list', () => {
    const firstOperationId = factory.uuid();
    const secondOperationId = factory.uuid();

    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
      operationIds: [firstOperationId, secondOperationId],
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ operationIds: [firstOperationId, secondOperationId] });
  });

  it('accepts sparse apply item selections and a numeric plan revision', () => {
    const operationId = factory.uuid();
    const assetId = factory.uuid();

    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
      operationIds: [operationId],
      itemSelections: {
        [operationId]: {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: [assetId],
        },
      },
      planRevision: 3,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      operationIds: [operationId],
      itemSelections: {
        [operationId]: {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: [assetId],
        },
      },
      planRevision: 3,
    });
  });

  it('accepts sparse field overrides with item selections and a numeric plan revision', () => {
    const operationId = factory.uuid();
    const assetId = factory.uuid();

    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
      operationIds: [operationId],
      itemSelections: {
        [operationId]: {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: [assetId],
        },
      },
      fieldOverrides: {
        [operationId]: {
          albumName: 'Portugal highlights',
          description: '',
        },
      },
      planRevision: 3,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      operationIds: [operationId],
      itemSelections: {
        [operationId]: {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: [assetId],
        },
      },
      fieldOverrides: {
        [operationId]: {
          albumName: 'Portugal highlights',
          description: '',
        },
      },
      planRevision: 3,
    });
  });

  it('rejects empty field override objects', () => {
    const operationId = factory.uuid();

    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
      operationIds: [operationId],
      fieldOverrides: {
        [operationId]: {},
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ message: 'fieldOverrides must not be empty' })]);
  });

  it('rejects field override objects with too many fields', () => {
    const operationId = factory.uuid();

    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
      operationIds: [operationId],
      fieldOverrides: {
        [operationId]: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`field${index}`, `${index}`])),
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ message: 'fieldOverrides may contain at most 20 fields per operation' }),
    ]);
  });

  it('rejects duplicate apply operation ids', () => {
    const operationId = factory.uuid();

    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
      operationIds: [operationId, operationId],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ message: 'operationIds must be unique' })]);
  });

  it('rejects duplicate sparse item ids', () => {
    const operationId = factory.uuid();
    const assetId = factory.uuid();

    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
      operationIds: [operationId],
      itemSelections: {
        [operationId]: {
          itemKind: 'asset',
          mode: 'only',
          itemIds: [assetId, assetId],
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ message: 'itemIds must be unique' })]);
  });

  it('rejects sparse item selections with more than 10000 item ids', () => {
    const operationId = factory.uuid();

    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
      operationIds: [operationId],
      itemSelections: {
        [operationId]: {
          itemKind: 'asset',
          mode: 'only',
          itemIds: Array.from({ length: 10_001 }, () => factory.uuid()),
        },
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ message: expect.stringContaining('Too big') })]);
  });

  it('accepts expanded sparse item kinds', () => {
    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
      operationIds: [factory.uuid(), factory.uuid(), factory.uuid(), factory.uuid(), factory.uuid()],
      itemSelections: {
        [factory.uuid()]: { itemKind: 'asset', mode: 'none' },
        [factory.uuid()]: { itemKind: 'album', mode: 'none' },
        [factory.uuid()]: { itemKind: 'space', mode: 'none' },
        [factory.uuid()]: { itemKind: 'person', mode: 'none' },
        [factory.uuid()]: { itemKind: 'tag', mode: 'none' },
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects unsupported sparse item kinds', () => {
    const operationId = factory.uuid();

    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
      operationIds: [operationId],
      itemSelections: {
        [operationId]: {
          itemKind: 'photo',
          mode: 'none',
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty apply operation id list', () => {
    const result = AgentOperationPlanApplyRequestDto.schema.safeParse({ operationIds: [] });

    expect(result.success).toBe(false);
  });

  it('accepts an apply response with per-operation result groups', () => {
    const planId = factory.uuid();
    const operationId = factory.uuid();
    const createdAt = '2026-05-16T12:00:00.000Z';
    const updatedAt = '2026-05-16T12:00:01.000Z';

    const result = AgentOperationPlanApplyResponseDto.schema.safeParse({
      status: AgentOperationApplyStatus.Applied,
      plan: {
        id: planId,
        sessionId: factory.uuid(),
        revision: 1,
        status: AgentOperationPlanStatus.Applied,
        summary: 'Portugal plan.',
        operations: [
          {
            id: operationId,
            planId,
            type: AgentOperationType.AlbumCreate,
            summary: 'Create Portugal.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            targetId: null,
            temporaryTargetId: 'tmp-portugal',
            assetIds: [],
            payload: { albumName: 'Portugal' },
            dependencyIds: [],
            riskLevel: AgentOperationRiskLevel.Low,
            enabled: true,
            status: AgentOperationStatus.Applied,
            result: { albumId: factory.uuid() },
            error: null,
            createdAt,
            updatedAt,
          },
        ],
        createdAt,
        updatedAt,
      },
      appliedOperationIds: [operationId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 1 operation.',
    });

    expect(result.success).toBe(true);
    expect(result.data?.plan.operations[0].createdAt).toEqual(new Date(createdAt));
  });

  it('serializes planning tool responses with no plan as null', () => {
    const result = AgentOperationPlanToolResponseDto.schema.safeParse({
      status: 'success',
      plan: null,
      toolCall: null,
      summary: 'No proposed plan exists.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts multiple set-cover candidate asset ids', () => {
    const coverAssetId = factory.uuid();
    const alternateCoverAssetId = factory.uuid();

    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Pick a cover.',
      operations: [
        {
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          assetIds: [coverAssetId, alternateCoverAssetId],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data?.operations[0]).toMatchObject({ assetIds: [coverAssetId, alternateCoverAssetId] });
  });

  it('rejects duplicate set-cover candidate asset ids', () => {
    const coverAssetId = factory.uuid();

    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Pick a cover.',
      operations: [
        {
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          assetIds: [coverAssetId, coverAssetId],
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ message: 'assetIds must be unique' })]);
  });

  describe('MCP planning tool request schemas', () => {
    it('does not require planId for proposeAlbumOperations', () => {
      const result =
        AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse(makePlanningToolRequest());

      expect(result.success).toBe(true);
    });

    it('accepts proposeAlbumFromSearch with a declarative search source', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse({
        summary: 'Create South Africa album.',
        albumName: 'South Africa with Pierre & Aurelia',
        description: 'Photos from the January 2026 South Africa trip.',
        assetSource: {
          kind: 'search',
          filters: {
            country: 'South Africa',
            takenAfter: '2026-01-01T00:00:00.000Z',
            takenBefore: '2026-02-01T00:00:00.000Z',
            people: { match: 'any', names: ['Pierre', 'Aurelia'] },
          },
          materialization: 'all-matches-with-limit',
        },
      });

      expect(result.success).toBe(true);
    });

    it('accepts proposeAddAssetsToAlbumFromSearch with exactly one existing album target', () => {
      const byId = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToAlbumFromSearch].safeParse({
        summary: 'Add January photos.',
        albumId: factory.uuid(),
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      });
      const byName = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToAlbumFromSearch].safeParse({
        summary: 'Add January photos.',
        albumName: 'South Africa',
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      });

      expect(byId.success).toBe(true);
      expect(byName.success).toBe(true);
    });

    it.each([
      ['missing target', {}],
      ['both targets', { albumId: factory.uuid(), albumName: 'South Africa' }],
    ])('rejects proposeAddAssetsToAlbumFromSearch with %s', (_label, target) => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToAlbumFromSearch].safeParse({
        summary: 'Add photos.',
        ...target,
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ message: 'Provide exactly one of albumId or albumName' }),
      ]);
    });

    it('rejects album workflow asset sources that require raw ids', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse({
        summary: 'Create album.',
        albumName: 'Manual ids',
        assetSource: { kind: 'explicitAssets', assetIds: [factory.uuid()] },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([expect.objectContaining({ path: ['assetSource', 'kind'] })]);
    });

    it('accepts proposeAlbumFromSearch with a selection handle source', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse({
        summary: 'Create album.',
        albumName: 'Handle album',
        assetSource: { kind: 'selectionHandle', selectionHandleId: factory.uuid() },
      });

      expect(result.success).toBe(true);
    });

    it('accepts proposeAlbumFromSelection with a selection handle', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSelection].safeParse({
        summary: 'Create album.',
        albumName: 'Handle album',
        description: 'Selected photos.',
        selectionHandleId: factory.uuid(),
      });

      expect(result.success).toBe(true);
    });

    it('keeps album workflow text validation aligned with album.create planning constraints', () => {
      const emptyName = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse({
        albumName: '',
        assetSource: { kind: 'search', filters: {} },
      });
      const longDescription = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse({
        albumName: 'South Africa',
        description: 'x'.repeat(1001),
        assetSource: { kind: 'search', filters: {} },
      });

      expect(emptyName.success).toBe(false);
      expect(longDescription.success).toBe(false);
    });

    it('accepts proposeSpaceFromSearch with a declarative search source', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
        summary: 'Create family trip space.',
        spaceName: 'Family South Africa',
        description: 'Shared January 2026 South Africa photos.',
        color: UserAvatarColor.Blue,
        assetSource: {
          kind: 'search',
          filters: {
            country: 'South Africa',
            takenAfter: '2026-01-01T00:00:00.000Z',
            takenBefore: '2026-02-01T00:00:00.000Z',
          },
          materialization: 'all-matches-with-limit',
        },
      });

      expect(result.success).toBe(true);
    });

    it('accepts proposeSpaceFromSearch with a previous search source', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
        spaceName: 'Previous search space',
        assetSource: {
          kind: 'previousSearch',
          sourceRef: `asset-source:search:${factory.uuid()}`,
        },
      });

      expect(result.success).toBe(true);
    });

    it('accepts proposeAddAssetsToSpaceFromSearch with exactly one existing space target', () => {
      const byId = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToSpaceFromSearch].safeParse({
        summary: 'Add January photos.',
        spaceId: factory.uuid(),
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      });
      const byName = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToSpaceFromSearch].safeParse({
        summary: 'Add January photos.',
        spaceName: 'Family South Africa',
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      });

      expect(byId.success).toBe(true);
      expect(byName.success).toBe(true);
    });

    it('accepts proposeAddAssetsToSpaceFromSearch with a previous search source', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToSpaceFromSearch].safeParse({
        spaceId: factory.uuid(),
        assetSource: {
          kind: 'previousSearch',
          sourceRef: `asset-source:search:${factory.uuid()}`,
        },
      });

      expect(result.success).toBe(true);
    });

    it.each([
      ['missing target', {}],
      ['both targets', { spaceId: factory.uuid(), spaceName: 'Family South Africa' }],
    ])('rejects proposeAddAssetsToSpaceFromSearch with %s', (_label, target) => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAddAssetsToSpaceFromSearch].safeParse({
        summary: 'Add photos.',
        ...target,
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ message: 'Provide exactly one of spaceId or spaceName' }),
      ]);
    });

    it('rejects space workflow asset sources that require raw ids', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
        summary: 'Create space.',
        spaceName: 'Manual ids',
        assetSource: { kind: 'explicitAssets', assetIds: [factory.uuid()] },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([expect.objectContaining({ path: ['assetSource', 'kind'] })]);
    });

    it('accepts proposeSpaceFromSearch with a selection handle source', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
        summary: 'Create space.',
        spaceName: 'Handle space',
        assetSource: { kind: 'selectionHandle', selectionHandleId: factory.uuid() },
      });

      expect(result.success).toBe(true);
    });

    it('keeps space workflow text validation aligned with space.create planning constraints', () => {
      const emptyName = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
        spaceName: '',
        assetSource: { kind: 'search', filters: {} },
      });
      const longName = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
        spaceName: 'x'.repeat(101),
        assetSource: { kind: 'search', filters: {} },
      });
      const longDescription = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
        spaceName: 'Family',
        description: 'x'.repeat(501),
        assetSource: { kind: 'search', filters: {} },
      });
      const invalidColor = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeSpaceFromSearch].safeParse({
        spaceName: 'Family',
        color: 'teal',
        assetSource: { kind: 'search', filters: {} },
      });

      expect(emptyName.success).toBe(false);
      expect(longName.success).toBe(false);
      expect(longDescription.success).toBe(false);
      expect(invalidColor.success).toBe(false);
    });

    it.each([
      [
        'favorite',
        {
          action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
          assetSource: { kind: 'search', filters: { isFavorite: false } },
        },
      ],
      [
        'archive',
        {
          action: { type: AgentOperationType.AssetSetArchive, archived: true },
          assetSource: { kind: 'search', filters: { rating: 1 } },
        },
      ],
      [
        'unarchive',
        {
          action: { type: AgentOperationType.AssetSetArchive, archived: false },
          assetSource: { kind: 'search', filters: { visibility: 'archive' } },
        },
      ],
      [
        'tag by name',
        {
          action: { type: AgentOperationType.AssetAddTag, tagName: 'Receipts' },
          assetSource: { kind: 'search', mode: 'ocr', query: 'receipt' },
        },
      ],
      [
        'tag by id',
        {
          action: { type: AgentOperationType.AssetAddTag, tagId: factory.uuid() },
          assetSource: { kind: 'search', filters: { city: 'Berlin' } },
        },
      ],
      [
        'rotate',
        {
          action: { type: AgentOperationType.AssetRotate, angle: 90 },
          assetSource: { kind: 'search', filters: { type: AssetType.Image } },
        },
      ],
      [
        'crop',
        {
          action: { type: AgentOperationType.AssetCrop, x: 100, y: 100, width: 800, height: 600 },
          assetSource: { kind: 'search', filters: { type: AssetType.Image } },
        },
      ],
      [
        'metadata update',
        {
          action: {
            type: AgentOperationType.AssetUpdateMetadata,
            description: 'Berlin weekend',
            rating: 5,
            timeZone: 'Europe/Berlin',
          },
          assetSource: { kind: 'search', filters: { city: 'Berlin' } },
        },
      ],
      [
        'previous search',
        {
          action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
          assetSource: { kind: 'previousSearch', sourceRef: `asset-source:search:${factory.uuid()}` },
        },
      ],
    ])('accepts proposeAssetBatchFromSearch for %s', (_label, request) => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
        summary: 'Update matching photos.',
        ...request,
      });

      expect(result.success).toBe(true);
    });

    it.each([
      ['remove tag', { type: AgentOperationType.AssetRemoveTag, tagId: factory.uuid() }],
      ['album operation', { type: AgentOperationType.AlbumAddAssets }],
      ['space operation', { type: AgentOperationType.SpaceAddAssets }],
    ])('rejects unsupported proposeAssetBatchFromSearch action %s', (_label, action) => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
        action,
        assetSource: { kind: 'search', filters: {} },
      });

      expect(result.success).toBe(false);
    });

    it.each([
      ['missing tag target', { type: AgentOperationType.AssetAddTag }],
      ['both tag targets', { type: AgentOperationType.AssetAddTag, tagId: factory.uuid(), tagName: 'Receipts' }],
    ])('rejects proposeAssetBatchFromSearch tag action with %s', (_label, action) => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
        action,
        assetSource: { kind: 'search', filters: {} },
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ message: 'Provide exactly one of tagId or tagName' }),
      ]);
    });

    it.each([0, 45, 91, 360])('rejects proposeAssetBatchFromSearch rotate angle %s', (angle) => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
        action: { type: AgentOperationType.AssetRotate, angle },
        assetSource: { kind: 'search', filters: {} },
      });

      expect(result.success).toBe(false);
    });

    it('accepts proposeAssetBatchFromSelection crop action', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSelection].safeParse({
        summary: 'Crop matching photos.',
        action: { type: AgentOperationType.AssetCrop, x: 0, y: 0, width: 1000, height: 1000 },
        selectionHandleId: factory.uuid(),
      });

      expect(result.success).toBe(true);
    });

    it.each([
      ['negative x', { type: AgentOperationType.AssetCrop, x: -1, y: 0, width: 800, height: 600 }],
      ['zero width', { type: AgentOperationType.AssetCrop, x: 0, y: 0, width: 0, height: 600 }],
      ['missing height', { type: AgentOperationType.AssetCrop, x: 0, y: 0, width: 800 }],
    ])('rejects proposeAssetBatchFromSearch crop geometry %s', (_label, action) => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
        action,
        assetSource: { kind: 'search', filters: {} },
      });

      expect(result.success).toBe(false);
    });

    it.each([
      [
        'empty metadata action',
        { type: AgentOperationType.AssetUpdateMetadata },
        ['action'],
        'Provide at least one metadata field to update',
      ],
      [
        'zero relative time as only metadata field',
        { type: AgentOperationType.AssetUpdateMetadata, dateTimeRelative: 0 },
        ['action', 'dateTimeRelative'],
        'dateTimeRelative: 0 is a no-op unless another metadata field changes',
      ],
      [
        'absolute and relative dates together',
        {
          type: AgentOperationType.AssetUpdateMetadata,
          dateTimeOriginal: '1998-06-01T12:00:00.000Z',
          dateTimeRelative: 120,
        },
        ['action'],
        'Choose dateTimeOriginal or dateTimeRelative, not both',
      ],
      [
        'latitude without longitude',
        { type: AgentOperationType.AssetUpdateMetadata, latitude: 48.8566 },
        ['action'],
        'Provide both latitude and longitude',
      ],
      [
        'place name field',
        { type: AgentOperationType.AssetUpdateMetadata, placeName: 'Paris' },
        ['action'],
        'Unrecognized key',
      ],
    ])('rejects proposeAssetBatchFromSearch metadata action with %s', (_label, action, path, message) => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
        action,
        assetSource: { kind: 'search', filters: {} },
      });

      expectIssue(result, path, message);
    });

    it('rejects proposeAssetBatchFromSearch raw id sources', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
        action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
        assetSource: { kind: 'explicitAssets', assetIds: [factory.uuid()] },
      });

      expect(result.success).toBe(false);
    });

    it('accepts proposeAssetBatchFromSearch with a selection handle source', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse({
        action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
        assetSource: { kind: 'selectionHandle', selectionHandleId: factory.uuid() },
      });

      expect(result.success).toBe(true);
    });

    it('accepts proposeAssetBatchFromSelection with a selection handle', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSelection].safeParse({
        summary: 'Favorite selected photos.',
        action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
        selectionHandleId: factory.uuid(),
      });

      expect(result.success).toBe(true);
    });

    it('keeps selection workflow DTOs handle-only', () => {
      const albumResult = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSelection].safeParse({
        summary: 'Create album.',
        albumName: 'Handle album',
        description: 'Selected photos.',
        selectionHandleId: factory.uuid(),
        assetIds: [factory.uuid()],
      });
      const batchResult = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSelection].safeParse({
        summary: 'Favorite selected photos.',
        action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
        selectionHandleId: factory.uuid(),
        assetSource: { kind: 'explicitAssets', assetIds: [factory.uuid()] },
      });

      expect(albumResult.success).toBe(false);
      expect(batchResult.success).toBe(false);
    });

    it('requires planId for reviseProposedOperations MCP calls and keeps the body fields', () => {
      const planId = factory.uuid();
      const valid = AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations].safeParse({
        planId,
        feedback: 'Use a shorter title.',
        ...makePlanningToolRequest(),
      });

      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data).toMatchObject({
          planId,
          feedback: 'Use a shorter title.',
          summary: 'Create a Portugal highlights album.',
          operations: expect.any(Array),
        });
      }

      expectIssue(
        AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations].safeParse(
          makePlanningToolRequest(),
        ),
        ['planId'],
        'Invalid input',
      );
      expectIssue(
        AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations].safeParse({
          planId: 'not-a-uuid',
          ...makePlanningToolRequest(),
        }),
        ['planId'],
        'Invalid UUID',
      );
    });

    it('requires planId for summarizePlan MCP calls and validates focus', () => {
      const planId = factory.uuid();
      const valid = AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan].safeParse({
        planId,
        focus: 'risk',
      });

      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data).toEqual({ planId, focus: 'risk' });
      }

      expectIssue(
        AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan].safeParse({ focus: 'risk' }),
        ['planId'],
        'Invalid input',
      );
      expectIssue(
        AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan].safeParse({
          planId: 'not-a-uuid',
          focus: 'risk',
        }),
        ['planId'],
        'Invalid UUID',
      );
      expectIssue(
        AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan].safeParse({
          planId,
          focus: '',
        }),
        ['focus'],
        'Too small',
      );
    });

    it('keeps strict object validation for planning MCP tool arguments', () => {
      expectIssue(
        AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
          ...makePlanningToolRequest(),
          unexpected: true,
        }),
        [],
        'Unrecognized key',
      );
      expectIssue(
        AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations].safeParse({
          planId: factory.uuid(),
          ...makePlanningToolRequest(),
          unexpected: true,
        }),
        [],
        'Unrecognized key',
      );
      expectIssue(
        AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan].safeParse({
          planId: factory.uuid(),
          focus: 'risk',
          unexpected: true,
        }),
        [],
        'Unrecognized key',
      );
    });
  });

  describe('asset.trash operation schema', () => {
    it('accepts a valid asset.trash operation with default High riskLevel', () => {
      const result = parseSingleOperationProposal(makeValidTrashOp());
      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        expect(op.type).toBe(AgentOperationType.AssetTrash);
        expect(op.riskLevel).toBe(AgentOperationRiskLevel.High);
      }
    });

    it('accepts a valid asset.trash operation with a selectionHandle', () => {
      const result = parseSingleOperationProposal(
        makeValidTrashOp({ assetIds: undefined, assetSelectionHandleId: factory.uuid() }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects asset.trash with a payload field', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidTrashOp({ payload: { foo: 'bar' } })),
        ['operations', 0],
        'Unrecognized key',
      );
    });

    it('rejects asset.trash with a targetId', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidTrashOp({ targetId: factory.uuid() })),
        ['operations', 0, 'targetId'],
        'targetId is not valid for asset batch targets',
      );
    });

    it('rejects asset.trash with wrong targetKind', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidTrashOp({ targetKind: AgentOperationTargetKind.ExistingAlbum })),
        ['operations', 0, 'targetKind'],
        'asset.trash requires an asset_batch target',
      );
    });

    it('rejects asset.trash with no asset selection mechanism', () => {
      expectIssue(
        parseSingleOperationProposal({ ...makeValidTrashOp(), assetIds: undefined }),
        ['operations', 0],
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('rejects asset.trash with multiple asset selection mechanisms', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidTrashOp({ assetSelectionHandleId: factory.uuid() })),
        ['operations', 0],
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidTrashOp());
      expect(result.success).toBe(true);
    });
  });

  describe('asset.restore operation schema', () => {
    it('accepts a valid asset.restore operation with default Low riskLevel', () => {
      const result = parseSingleOperationProposal(makeValidRestoreOp());
      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        expect(op.type).toBe(AgentOperationType.AssetRestore);
        expect(op.riskLevel).toBe(AgentOperationRiskLevel.Low);
      }
    });

    it('accepts a valid asset.restore operation with a selectionHandle', () => {
      const result = parseSingleOperationProposal(
        makeValidRestoreOp({ assetIds: undefined, assetSelectionHandleId: factory.uuid() }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects asset.restore with a payload field', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidRestoreOp({ payload: { foo: 'bar' } })),
        ['operations', 0],
        'Unrecognized key',
      );
    });

    it('rejects asset.restore with a targetId', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidRestoreOp({ targetId: factory.uuid() })),
        ['operations', 0, 'targetId'],
        'targetId is not valid for asset batch targets',
      );
    });

    it('rejects asset.restore with wrong targetKind', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidRestoreOp({ targetKind: AgentOperationTargetKind.ExistingAlbum })),
        ['operations', 0, 'targetKind'],
        'asset.restore requires an asset_batch target',
      );
    });

    it('rejects asset.restore with no asset selection mechanism', () => {
      expectIssue(
        parseSingleOperationProposal({ ...makeValidRestoreOp(), assetIds: undefined }),
        ['operations', 0],
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('rejects asset.restore with multiple asset selection mechanisms', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidRestoreOp({ assetSelectionHandleId: factory.uuid() })),
        ['operations', 0],
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidRestoreOp());
      expect(result.success).toBe(true);
    });
  });

  describe('asset.crop operation schema', () => {
    it('accepts a valid asset.crop operation with default Low riskLevel', () => {
      const result = parseSingleOperationProposal(makeValidCropOp());
      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        expect(op.type).toBe(AgentOperationType.AssetCrop);
        expect(op.riskLevel).toBe(AgentOperationRiskLevel.Low);
      }
    });

    it('accepts a valid asset.crop with x=0, y=0 (min boundary)', () => {
      const result = parseSingleOperationProposal(makeValidCropOp({ payload: { x: 0, y: 0, width: 1, height: 1 } }));
      expect(result.success).toBe(true);
    });

    it('accepts a valid asset.crop with a selectionHandle', () => {
      const result = parseSingleOperationProposal(
        makeValidCropOp({ assetIds: undefined, assetSelectionHandleId: factory.uuid() }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects asset.crop with missing payload', () => {
      const { payload: _payload, ...withoutPayload } = makeValidCropOp();
      const result = parseSingleOperationProposal(withoutPayload);
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path.join('.') === 'operations.0.payload')).toBe(true);
    });

    it('rejects asset.crop with missing x', () => {
      const result = parseSingleOperationProposal(makeValidCropOp({ payload: { y: 20, width: 400, height: 300 } }));
      expect(result.success).toBe(false);
      expect(
        result.error?.issues.some(
          (issue) => issue.path.join('.').includes('payload') && issue.path.join('.').includes('x'),
        ),
      ).toBe(true);
    });

    it('rejects asset.crop with missing y', () => {
      const result = parseSingleOperationProposal(makeValidCropOp({ payload: { x: 10, width: 400, height: 300 } }));
      expect(result.success).toBe(false);
      expect(
        result.error?.issues.some(
          (issue) => issue.path.join('.').includes('payload') && issue.path.join('.').includes('y'),
        ),
      ).toBe(true);
    });

    it('rejects asset.crop with missing width', () => {
      const result = parseSingleOperationProposal(makeValidCropOp({ payload: { x: 10, y: 20, height: 300 } }));
      expect(result.success).toBe(false);
      expect(
        result.error?.issues.some(
          (issue) => issue.path.join('.').includes('payload') && issue.path.join('.').includes('width'),
        ),
      ).toBe(true);
    });

    it('rejects asset.crop with missing height', () => {
      const result = parseSingleOperationProposal(makeValidCropOp({ payload: { x: 10, y: 20, width: 400 } }));
      expect(result.success).toBe(false);
      expect(
        result.error?.issues.some(
          (issue) => issue.path.join('.').includes('payload') && issue.path.join('.').includes('height'),
        ),
      ).toBe(true);
    });

    it('rejects asset.crop with negative x', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidCropOp({ payload: { x: -1, y: 20, width: 400, height: 300 } })),
        ['operations', 0, 'payload', 'x'],
        'Too small',
      );
    });

    it('rejects asset.crop with negative y', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidCropOp({ payload: { x: 10, y: -1, width: 400, height: 300 } })),
        ['operations', 0, 'payload', 'y'],
        'Too small',
      );
    });

    it('rejects asset.crop with zero width', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidCropOp({ payload: { x: 10, y: 20, width: 0, height: 300 } })),
        ['operations', 0, 'payload', 'width'],
        'Too small',
      );
    });

    it('rejects asset.crop with zero height', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidCropOp({ payload: { x: 10, y: 20, width: 400, height: 0 } })),
        ['operations', 0, 'payload', 'height'],
        'Too small',
      );
    });

    it('rejects asset.crop with negative width', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidCropOp({ payload: { x: 10, y: 20, width: -1, height: 300 } })),
        ['operations', 0, 'payload', 'width'],
        'Too small',
      );
    });

    it('rejects asset.crop with wrong targetKind', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidCropOp({ targetKind: AgentOperationTargetKind.ExistingAlbum })),
        ['operations', 0, 'targetKind'],
        'asset.crop requires an image_edit_batch target',
      );
    });

    it('rejects asset.crop with a targetId', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidCropOp({ targetId: factory.uuid() })),
        ['operations', 0, 'targetId'],
        'targetId is not valid for asset batch targets',
      );
    });

    it('rejects asset.crop with no asset selection mechanism', () => {
      expectIssue(
        parseSingleOperationProposal({ ...makeValidCropOp(), assetIds: undefined }),
        ['operations', 0],
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('rejects asset.crop with multiple asset selection mechanisms', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidCropOp({ assetSelectionHandleId: factory.uuid() })),
        ['operations', 0],
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidCropOp());
      expect(result.success).toBe(true);
    });
  });

  const adjustOperation = (
    payload: Record<string, unknown>,
    targetKind: string = AgentOperationTargetKind.ImageEditBatch,
  ) => ({
    type: AgentOperationType.AssetAdjust,
    summary: 'Adjust matching photos.',
    targetKind,
    assetIds: [factory.uuid()],
    payload,
  });

  const flipOperation = (payload: Record<string, unknown>) => ({
    type: AgentOperationType.AssetFlip,
    summary: 'Flip matching photos.',
    targetKind: AgentOperationTargetKind.ImageEditBatch,
    assetIds: [factory.uuid()],
    payload,
  });

  describe('asset.adjust operation schema', () => {
    // ── adjust payload validation (via proposeAssetBatchFromSearch action) ────

    it('accepts asset.adjust with one manual field', () => {
      expect(parseBatchAction({ type: AgentOperationType.AssetAdjust, brightness: 'moderate_increase' }).success).toBe(
        true,
      );
    });

    it('accepts asset.adjust autoEnhance alone', () => {
      expect(parseBatchAction({ type: AgentOperationType.AssetAdjust, autoEnhance: true }).success).toBe(true);
    });

    it('rejects asset.adjust with no fields', () => {
      expect(parseBatchAction({ type: AgentOperationType.AssetAdjust }).success).toBe(false);
    });

    it('rejects asset.adjust autoEnhance + manual field', () => {
      expect(
        parseBatchAction({ type: AgentOperationType.AssetAdjust, autoEnhance: true, brightness: 'slight_increase' })
          .success,
      ).toBe(false);
    });

    it('rejects asset.adjust unknown key (strict)', () => {
      expect(parseBatchAction({ type: AgentOperationType.AssetAdjust, sharpen: 'slight_increase' }).success).toBe(
        false,
      );
    });

    it('accepts asset.flip with a valid axis', () => {
      expect(parseBatchAction({ type: AgentOperationType.AssetFlip, axis: 'horizontal' }).success).toBe(true);
    });

    it('rejects asset.flip with no axis', () => {
      expect(parseBatchAction({ type: AgentOperationType.AssetFlip }).success).toBe(false);
    });

    // ── standalone operation membership + target validation ──────────────────

    it('accepts an asset.adjust standalone operation with an ImageEditBatch target', () => {
      expect(parseSingleOperationProposal(adjustOperation({ brightness: 'moderate_increase' })).success).toBe(true);
    });

    it('rejects an asset.adjust operation with an AssetBatch target', () => {
      expect(
        parseSingleOperationProposal(
          adjustOperation({ brightness: 'moderate_increase' }, AgentOperationTargetKind.AssetBatch),
        ).success,
      ).toBe(false);
    });

    it('accepts an asset.flip standalone operation with an ImageEditBatch target', () => {
      expect(parseSingleOperationProposal(flipOperation({ axis: 'horizontal' })).success).toBe(true);
    });

    it('rejects an asset.flip operation with an AssetBatch target', () => {
      expect(
        parseSingleOperationProposal({
          ...flipOperation({ axis: 'horizontal' }),
          targetKind: AgentOperationTargetKind.AssetBatch,
        }).success,
      ).toBe(false);
    });

    // ── iterate contract: reviseProposedOperations accepts an asset.adjust replacement op ──

    it('reviseProposedOperations accepts an asset.adjust replacement op', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations].safeParse({
        planId: factory.uuid(),
        summary: 'More contrast.',
        operations: [adjustOperation({ contrast: 'strong_increase' })],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('shareLink.create operation schema', () => {
    it('accepts a valid shareLink.create operation with default High riskLevel', () => {
      const result = parseSingleOperationProposal(makeValidShareLinkCreateOp());
      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        expect(op.type).toBe(AgentOperationType.ShareLinkCreate);
        expect(op.riskLevel).toBe(AgentOperationRiskLevel.High);
      }
    });

    it('accepts optional payload fields: password, expiresAt, showMetadata, allowDownload', () => {
      const futureDate = new Date(Date.now() + 86_400_000).toISOString();
      const result = parseSingleOperationProposal(
        makeValidShareLinkCreateOp({
          payload: { password: 'secret', expiresAt: futureDate, showMetadata: false, allowDownload: false },
        }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts minimal payload (all options omitted)', () => {
      const result = parseSingleOperationProposal(makeValidShareLinkCreateOp({ payload: {} }));
      expect(result.success).toBe(true);
    });

    it('accepts a valid shareLink.create with a selectionHandle', () => {
      const result = parseSingleOperationProposal(
        makeValidShareLinkCreateOp({ assetIds: undefined, assetSelectionHandleId: factory.uuid() }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects shareLink.create with expiresAt in the past', () => {
      const pastDate = new Date(Date.now() - 86_400_000).toISOString();
      expectIssue(
        parseSingleOperationProposal(makeValidShareLinkCreateOp({ payload: { expiresAt: pastDate } })),
        ['operations', 0, 'payload', 'expiresAt'],
        'expiresAt must be in the future',
      );
    });

    it('rejects shareLink.create with no asset selection mechanism', () => {
      expectIssue(
        parseSingleOperationProposal({ ...makeValidShareLinkCreateOp(), assetIds: undefined }),
        ['operations', 0],
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('rejects shareLink.create with multiple asset selection mechanisms', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidShareLinkCreateOp({ assetSelectionHandleId: factory.uuid() })),
        ['operations', 0],
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('rejects shareLink.create with wrong targetKind', () => {
      expectIssue(
        parseSingleOperationProposal(
          makeValidShareLinkCreateOp({ targetKind: AgentOperationTargetKind.ExistingAlbum }),
        ),
        ['operations', 0, 'targetKind'],
        'shareLink.create requires an asset_batch target',
      );
    });

    it('rejects shareLink.create with a targetId', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidShareLinkCreateOp({ targetId: factory.uuid() })),
        ['operations', 0, 'targetId'],
        'targetId is not valid for asset batch targets',
      );
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidShareLinkCreateOp());
      expect(result.success).toBe(true);
    });
  });

  describe('shareLink.createAlbum operation schema', () => {
    it('accepts a valid shareLink.createAlbum operation with default High riskLevel', () => {
      const result = parseSingleOperationProposal(makeValidShareLinkCreateAlbumOp());
      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        expect(op.type).toBe(AgentOperationType.ShareLinkCreateAlbum);
        expect(op.riskLevel).toBe(AgentOperationRiskLevel.High);
      }
    });

    it('accepts optional payload fields: password, expiresAt, showMetadata, allowDownload', () => {
      const futureDate = new Date(Date.now() + 86_400_000).toISOString();
      const result = parseSingleOperationProposal(
        makeValidShareLinkCreateAlbumOp({
          payload: { password: 'secret', expiresAt: futureDate, showMetadata: false, allowDownload: false },
        }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts minimal payload (all options omitted)', () => {
      const result = parseSingleOperationProposal(makeValidShareLinkCreateAlbumOp({ payload: {} }));
      expect(result.success).toBe(true);
    });

    it('rejects shareLink.createAlbum with expiresAt in the past', () => {
      const pastDate = new Date(Date.now() - 86_400_000).toISOString();
      expectIssue(
        parseSingleOperationProposal(makeValidShareLinkCreateAlbumOp({ payload: { expiresAt: pastDate } })),
        ['operations', 0, 'payload', 'expiresAt'],
        'expiresAt must be in the future',
      );
    });

    it('rejects shareLink.createAlbum with wrong targetKind (asset_batch)', () => {
      const result = parseSingleOperationProposal(
        makeValidShareLinkCreateAlbumOp({ targetKind: AgentOperationTargetKind.AssetBatch, targetId: undefined }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects shareLink.createAlbum with assetIds (no asset source allowed)', () => {
      const result = parseSingleOperationProposal(makeValidShareLinkCreateAlbumOp({ assetIds: [factory.uuid()] }));
      expect(result.success).toBe(false);
    });

    it('rejects shareLink.createAlbum missing targetId for existing_album', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidShareLinkCreateAlbumOp({ targetId: undefined })),
        ['operations', 0, 'targetId'],
        'targetId is required for existing album targets',
      );
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidShareLinkCreateAlbumOp());
      expect(result.success).toBe(true);
    });
  });

  describe('asset.stack operation schema', () => {
    it('accepts a valid asset.stack operation with default Low riskLevel', () => {
      const result = parseSingleOperationProposal(makeValidStackOp());
      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        expect(op.type).toBe(AgentOperationType.AssetStack);
        expect(op.riskLevel).toBe(AgentOperationRiskLevel.Low);
      }
    });

    it('accepts a valid asset.stack operation with a selectionHandle', () => {
      const result = parseSingleOperationProposal(
        makeValidStackOp({ assetIds: undefined, assetSelectionHandleId: factory.uuid() }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects asset.stack with a payload field', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidStackOp({ payload: { foo: 'bar' } })),
        ['operations', 0],
        'Unrecognized key',
      );
    });

    it('rejects asset.stack with wrong targetKind', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidStackOp({ targetKind: AgentOperationTargetKind.ExistingAlbum })),
        ['operations', 0, 'targetKind'],
        'asset.stack requires an asset_batch target',
      );
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidStackOp());
      expect(result.success).toBe(true);
    });
  });

  describe('asset.unstack operation schema', () => {
    it('accepts a valid asset.unstack operation with default Low riskLevel', () => {
      const result = parseSingleOperationProposal(makeValidUnstackOp());
      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        expect(op.type).toBe(AgentOperationType.AssetUnstack);
        expect(op.riskLevel).toBe(AgentOperationRiskLevel.Low);
      }
    });

    it('rejects asset.unstack with a payload field', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidUnstackOp({ payload: { foo: 'bar' } })),
        ['operations', 0],
        'Unrecognized key',
      );
    });

    it('rejects asset.unstack with wrong targetKind', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidUnstackOp({ targetKind: AgentOperationTargetKind.ExistingAlbum })),
        ['operations', 0, 'targetKind'],
        'asset.unstack requires an asset_batch target',
      );
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidUnstackOp());
      expect(result.success).toBe(true);
    });
  });

  describe('proposeAssetBatchFromSelection: asset.stack and asset.unstack actions', () => {
    it('accepts proposeAssetBatchFromSelection stack action', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSelection].safeParse({
        summary: 'Stack matching photos.',
        action: { type: AgentOperationType.AssetStack },
        selectionHandleId: factory.uuid(),
      });
      expect(result.success).toBe(true);
    });

    it('accepts proposeAssetBatchFromSelection unstack action', () => {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSelection].safeParse({
        summary: 'Unstack matching photos.',
        action: { type: AgentOperationType.AssetUnstack },
        selectionHandleId: factory.uuid(),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('person.update operation schema', () => {
    it('accepts a valid person.update op with name field and defaults to Low risk', () => {
      const result = parseSingleOperationProposal(makeValidPersonUpdateOp());
      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        expect(op.type).toBe(AgentOperationType.PersonUpdate);
        expect(op.riskLevel).toBe(AgentOperationRiskLevel.Low);
      }
    });

    it('accepts payload with birthDate (past date)', () => {
      const result = parseSingleOperationProposal(makeValidPersonUpdateOp({ payload: { birthDate: '1990-05-01' } }));
      expect(result.success).toBe(true);
    });

    it('accepts payload with isHidden', () => {
      const result = parseSingleOperationProposal(makeValidPersonUpdateOp({ payload: { isHidden: true } }));
      expect(result.success).toBe(true);
    });

    it('accepts payload with birthDate as null (clearing it)', () => {
      const result = parseSingleOperationProposal(makeValidPersonUpdateOp({ payload: { birthDate: null } }));
      expect(result.success).toBe(true);
    });

    it('rejects empty payload (no fields provided)', () => {
      const result = parseSingleOperationProposal(makeValidPersonUpdateOp({ payload: {} }));
      expect(result.success).toBe(false);
    });

    it('rejects payload with future birthDate', () => {
      const futureDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const result = parseSingleOperationProposal(makeValidPersonUpdateOp({ payload: { birthDate: futureDate } }));
      expect(result.success).toBe(false);
    });

    it('rejects person.update with wrong targetKind (asset_batch)', () => {
      const result = parseSingleOperationProposal(
        makeValidPersonUpdateOp({ targetKind: AgentOperationTargetKind.AssetBatch }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects person.update missing targetId', () => {
      const result = parseSingleOperationProposal(makeValidPersonUpdateOp({ targetId: undefined }));
      expect(result.success).toBe(false);
    });

    it('rejects person.update with assetIds (strict object)', () => {
      const result = parseSingleOperationProposal(makeValidPersonUpdateOp({ assetIds: [factory.uuid()] }));
      expect(result.success).toBe(false);
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidPersonUpdateOp());
      expect(result.success).toBe(true);
    });
  });

  describe('person.merge operation schema', () => {
    it('accepts a valid person.merge op and defaults to High risk', () => {
      const result = parseSingleOperationProposal(makeValidPersonMergeOp());
      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        expect(op.type).toBe(AgentOperationType.PersonMerge);
        expect(op.riskLevel).toBe(AgentOperationRiskLevel.High);
      }
    });

    it('accepts multiple sourcePersonIds', () => {
      const result = parseSingleOperationProposal(
        makeValidPersonMergeOp({ payload: { sourcePersonIds: [SOURCE_PERSON_ID, factory.uuid()] } }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects empty sourcePersonIds', () => {
      const result = parseSingleOperationProposal(makeValidPersonMergeOp({ payload: { sourcePersonIds: [] } }));
      expect(result.success).toBe(false);
    });

    it('rejects self-merge (targetId in sourcePersonIds)', () => {
      const result = parseSingleOperationProposal(
        makeValidPersonMergeOp({ payload: { sourcePersonIds: [KEEP_PERSON_ID] } }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects person.merge with wrong targetKind (asset_batch)', () => {
      const result = parseSingleOperationProposal(
        makeValidPersonMergeOp({ targetKind: AgentOperationTargetKind.AssetBatch }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects person.merge missing targetId', () => {
      const result = parseSingleOperationProposal(makeValidPersonMergeOp({ targetId: undefined }));
      expect(result.success).toBe(false);
    });

    it('rejects person.merge with assetSource (strict object)', () => {
      const result = parseSingleOperationProposal(
        makeValidPersonMergeOp({
          assetSource: { kind: 'selectionHandle', selectionHandleId: factory.uuid() },
        }),
      );
      expect(result.success).toBe(false);
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidPersonMergeOp());
      expect(result.success).toBe(true);
    });
  });

  describe('asset.setVisibility operation schema', () => {
    it('accepts a valid asset.setVisibility(locked) operation', () => {
      const result = parseSingleOperationProposal(makeValidSetVisibilityOp());
      expect(result.success).toBe(true);
      if (result.success) {
        const op = result.data.operations[0];
        expect(op.type).toBe(AgentOperationType.AssetSetVisibility);
        expect((op as any).payload).toEqual({ visibility: AssetVisibility.Locked });
      }
    });

    it('accepts asset.setVisibility with a selectionHandle', () => {
      const result = parseSingleOperationProposal(
        makeValidSetVisibilityOp({ assetIds: undefined, assetSelectionHandleId: factory.uuid() }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects asset.setVisibility with visibility=archive', () => {
      const result = parseSingleOperationProposal(
        makeValidSetVisibilityOp({ payload: { visibility: AssetVisibility.Archive } }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects asset.setVisibility with visibility=timeline', () => {
      const result = parseSingleOperationProposal(
        makeValidSetVisibilityOp({ payload: { visibility: AssetVisibility.Timeline } }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects asset.setVisibility with visibility=hidden', () => {
      const result = parseSingleOperationProposal(
        makeValidSetVisibilityOp({ payload: { visibility: AssetVisibility.Hidden } }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects asset.setVisibility with missing payload', () => {
      const result = parseSingleOperationProposal(makeValidSetVisibilityOp({ payload: undefined }));
      expect(result.success).toBe(false);
    });

    it('rejects asset.setVisibility with wrong targetKind', () => {
      expectIssue(
        parseSingleOperationProposal(makeValidSetVisibilityOp({ targetKind: AgentOperationTargetKind.ExistingAlbum })),
        ['operations', 0, 'targetKind'],
        'asset.setVisibility requires an asset_batch target',
      );
    });

    it('rejects asset.setVisibility with no asset selection mechanism', () => {
      expectIssue(
        parseSingleOperationProposal({ ...makeValidSetVisibilityOp(), assetIds: undefined }),
        ['operations', 0],
        'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
      );
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidSetVisibilityOp());
      expect(result.success).toBe(true);
    });
  });

  // ── album.delete + space.delete (Slice 3.2) ─────────────────────────────────

  describe('album.delete', () => {
    it('parses a valid album.delete op targeting an existing album', () => {
      const result = parseSingleOperationProposal(makeValidAlbumDeleteOp());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.operations[0].type).toBe(AgentOperationType.AlbumDelete);
        expect(result.data.operations[0].targetKind).toBe(AgentOperationTargetKind.ExistingAlbum);
      }
    });

    it('rejects album.delete with missing targetId', () => {
      const result = parseSingleOperationProposal(makeValidAlbumDeleteOp({ targetId: undefined }));
      expect(result.success).toBe(false);
    });

    it('rejects album.delete with wrong targetKind', () => {
      const result = parseSingleOperationProposal(
        makeValidAlbumDeleteOp({
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: undefined,
          temporaryTargetId: 'tmp-album',
        }),
      );
      expect(result.success).toBe(false);
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidAlbumDeleteOp());
      expect(result.success).toBe(true);
    });
  });

  describe('space.delete', () => {
    it('parses a valid space.delete op targeting an existing space', () => {
      const result = parseSingleOperationProposal(makeValidSpaceDeleteOp());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.operations[0].type).toBe(AgentOperationType.SpaceDelete);
        expect(result.data.operations[0].targetKind).toBe(AgentOperationTargetKind.ExistingSpace);
      }
    });

    it('rejects space.delete with missing targetId', () => {
      const result = parseSingleOperationProposal(makeValidSpaceDeleteOp({ targetId: undefined }));
      expect(result.success).toBe(false);
    });

    it('rejects space.delete with wrong targetKind', () => {
      const result = parseSingleOperationProposal(
        makeValidSpaceDeleteOp({
          targetKind: AgentOperationTargetKind.NewSpace,
          targetId: undefined,
          temporaryTargetId: 'tmp-space',
        }),
      );
      expect(result.success).toBe(false);
    });

    it('is accepted by the AgentGalleryOperationInputSchema union', () => {
      const result = parseSingleOperationProposal(makeValidSpaceDeleteOp());
      expect(result.success).toBe(true);
    });
  });
});
