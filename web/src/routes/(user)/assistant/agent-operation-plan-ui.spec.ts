import {
  AgentOperationPlanStatus,
  AgentOperationReviewMetadataValueKind,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
} from '@immich/sdk';
import {
  AGENT_PLAN_THUMBNAIL_STRIP_DEFAULT_LIMIT,
  AGENT_PLAN_THUMBNAIL_STRIP_MAX_LIMIT,
  buildAgentPlanThumbnailStrip,
  buildApprovedOperationIds,
  buildGroupEnabledState,
  buildOperationItemSelectionState,
  buildOperationReviewApplyStateSummary,
  buildOperationReviewImpactSummary,
  buildOperationReviewModel,
  buildOperationTechnicalDetails,
  buildSelectionPayload,
  createInitialOperationEnabledState,
  createInitialOperationFieldOverrideState,
  createInitialOperationItemSelectionState,
  getOperationAssetCount,
  resetOperationFieldOverride,
  resetOperationItemSelection,
  setOperationFieldOverride,
  setOperationItemSelection,
  type OperationFieldOverrideState,
} from './agent-operation-plan-ui';

const rawText = (text: string) => ({ kind: 'raw' as const, text });
const translatedText = (key: string, values?: Record<string, string | number>) => ({
  kind: 'translation' as const,
  key,
  ...(values ? { values } : {}),
});

const planId = '00000000-0000-4000-8000-000000000100';
const createId = '00000000-0000-4000-8000-000000000101';
const addId = '00000000-0000-4000-8000-000000000102';
const coverId = '00000000-0000-4000-8000-000000000103';
const updateId = '00000000-0000-4000-8000-000000000104';
const spaceAddId = '00000000-0000-4000-8000-000000000105';
const spaceRemoveId = '00000000-0000-4000-8000-000000000106';
const spaceUpdateId = '00000000-0000-4000-8000-000000000107';
const metadataId = '00000000-0000-4000-8000-000000000108';
const albumId = '00000000-0000-4000-8000-000000000301';
const spaceId = '00000000-0000-4000-8000-000000000401';
const assetA = '00000000-0000-4000-8000-000000000201';
const assetB = '00000000-0000-4000-8000-000000000202';

const manyAssetIds = (count: number) =>
  Array.from({ length: count }, (_, index) => `asset-${String(index + 1).padStart(3, '0')}`);

const baseOperation = {
  planId,
  targetId: null,
  temporaryTargetId: null,
  assetIds: [],
  dependencyIds: [],
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  status: AgentOperationStatus.Proposed,
  result: null,
  error: null,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
} satisfies Omit<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>;

const operation = (
  operation: Partial<AgentOperationResponseDto> &
    Pick<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>,
): AgentOperationResponseDto => ({
  ...baseOperation,
  ...operation,
});

const plan = (operations: AgentOperationResponseDto[]): AgentOperationPlanResponseDto => ({
  id: planId,
  sessionId: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  status: AgentOperationPlanStatus.Proposed,
  summary: 'Organize Portugal holiday',
  operations,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
});

const thumbnailGroup = (assetCount: number) =>
  buildOperationReviewModel(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: `Add ${assetCount} assets`,
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: manyAssetIds(assetCount),
        payload: {},
      }),
    ]),
    { [addId]: true },
  ).groups[0];

describe('agent operation plan UI helpers', () => {
  it('builds spec-shaped review metadata for album operations', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal', description: 'Lisbon and Porto' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      { [createId]: true, [addId]: true },
    );

    expect(model.operationsById.get(createId)?.review).toEqual({
      operationId: createId,
      operationType: AgentOperationType.AlbumCreate,
      destination: {
        kind: 'album',
        temporaryId: 'album-portugal',
        name: 'Portugal',
        subtitle: 'New album',
      },
      summary: 'Create album "Portugal"',
      riskLevel: AgentOperationRiskLevel.Low,
      selection: {
        itemKind: 'asset',
        totalCount: 0,
        selectedCount: 0,
        mode: 'all',
        supportsItemSelection: false,
      },
      thumbnails: {
        totalCount: 0,
        representativeAssetIds: [],
        hasMore: false,
      },
      dependencies: [],
    });
    expect(model.operationsById.get(addId)?.review).toEqual({
      operationId: addId,
      operationType: AgentOperationType.AlbumAddAssets,
      destination: {
        kind: 'album',
        temporaryId: 'album-portugal',
        name: 'Portugal',
        subtitle: 'New album',
      },
      summary: 'Add 2 photos',
      riskLevel: AgentOperationRiskLevel.Low,
      selection: {
        itemKind: 'asset',
        totalCount: 2,
        selectedCount: 2,
        mode: 'all',
        supportsItemSelection: true,
      },
      thumbnails: {
        totalCount: 2,
        representativeAssetIds: [assetA, assetB],
        hasMore: false,
      },
      dependencies: [{ operationId: createId, summary: 'Create Portugal album', blocked: false }],
    });
  });

  it('derives human-readable summaries for current album operation types', () => {
    const existingAlbumId = '00000000-0000-4000-8000-000000000301';
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal', description: 'Lisbon and Porto' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: existingAlbumId,
          assetIds: [assetA],
          payload: {},
        }),
        operation({
          id: coverId,
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: existingAlbumId,
          assetIds: [assetA],
          payload: {},
        }),
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update details',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: existingAlbumId,
          payload: { albumName: 'Portugal Archive' },
        }),
      ]),
      { [createId]: true, [addId]: true, [coverId]: true, [updateId]: true },
    );

    expect(model.operationsById.get(createId)?.review.summary).toBe('Create album "Portugal"');
    expect(model.operationsById.get(addId)?.review.summary).toBe('Add 1 photo');
    expect(model.operationsById.get(coverId)?.review.summary).toBe('Set cover photo');
    expect(model.operationsById.get(updateId)?.review.summary).toBe('Rename album to "Portugal Archive"');
  });

  it('extracts highlight curation criteria from suggested-highlight plan summaries', () => {
    const model = buildOperationReviewModel(
      {
        ...plan([
          operation({
            id: createId,
            type: AgentOperationType.AlbumCreate,
            summary: 'Create Highlights',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'album-highlights',
            payload: { albumName: 'Highlights' },
          }),
          operation({
            id: addId,
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add 2 preview-assisted suggested highlights to Highlights.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'album-highlights',
            assetIds: [assetA, assetB],
            dependencyIds: [createId],
            payload: {},
          }),
        ]),
        summary:
          'Create Highlights with 2 preview-assisted suggested highlights considered previews, existing favorites, ratings, dates, tags, and location.',
      },
      { [createId]: true, [addId]: true },
    );

    expect(model.groups[0].curationCriteria).toBe(
      'Preview-assisted suggested highlights considered previews, existing favorites, ratings, dates, tags, and location.',
    );
  });

  it('derives metadata summaries, labels, field reviews, clears, and coordinate warnings', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: metadataId,
          type: AgentOperationType.AssetUpdateMetadata,
          summary: 'Set photo metadata',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [assetA, assetB],
          payload: { description: '', rating: null, latitude: 52.52, longitude: 13.405 },
          reviewMetadata: {
            assetMetadata: {
              fields: [
                {
                  key: 'description',
                  label: 'Description',
                  previousValues: [
                    { assetId: assetA, value: 'Old caption', valueKind: AgentOperationReviewMetadataValueKind.Known },
                    { assetId: assetB, value: null, valueKind: AgentOperationReviewMetadataValueKind.Empty },
                  ],
                  proposedValue: null,
                  proposedValueKind: AgentOperationReviewMetadataValueKind.Clear,
                },
                {
                  key: 'rating',
                  label: 'Rating',
                  previousValues: [
                    { assetId: assetA, value: '4', valueKind: AgentOperationReviewMetadataValueKind.Known },
                    { assetId: assetB, value: null, valueKind: AgentOperationReviewMetadataValueKind.Empty },
                  ],
                  proposedValue: null,
                  proposedValueKind: AgentOperationReviewMetadataValueKind.Clear,
                },
                {
                  key: 'location',
                  label: 'Location',
                  previousValues: [
                    {
                      assetId: assetA,
                      value: '48.8566, 2.3522',
                      valueKind: AgentOperationReviewMetadataValueKind.Known,
                    },
                    { assetId: assetB, value: null, valueKind: AgentOperationReviewMetadataValueKind.Unknown },
                  ],
                  proposedValue: '52.52, 13.405',
                  proposedValueKind: AgentOperationReviewMetadataValueKind.Known,
                },
              ],
              sampleAssetIds: [assetA, assetB],
              warnings: [],
            },
          },
        }),
      ]),
      { [metadataId]: true },
    );

    const item = model.operationsById.get(metadataId);

    expect(item?.typeLabelKey).toBe('assistant_operation_type_asset_update_metadata');
    expect(item?.review.summary).toBe('Update metadata for 2 photos');
    expect(item?.metadataReview).toEqual({
      fields: [
        {
          key: 'description',
          label: translatedText('assistant_operation_metadata_field_description'),
          currentValues: [
            { assetId: assetA, text: rawText('Old caption'), kind: 'known' },
            { assetId: assetB, text: translatedText('assistant_operation_metadata_value_empty'), kind: 'empty' },
          ],
          proposedText: translatedText('assistant_operation_metadata_value_clear'),
          proposedKind: 'clear',
        },
        {
          key: 'rating',
          label: translatedText('assistant_operation_metadata_field_rating'),
          currentValues: [
            {
              assetId: assetA,
              text: translatedText('assistant_operation_metadata_value_rating', { rating: 4 }),
              kind: 'known',
            },
            { assetId: assetB, text: translatedText('assistant_operation_metadata_value_unrated'), kind: 'empty' },
          ],
          proposedText: translatedText('assistant_operation_metadata_value_clear_rating'),
          proposedKind: 'clear',
        },
        {
          key: 'location',
          label: translatedText('assistant_operation_metadata_field_location'),
          currentValues: [
            { assetId: assetA, text: rawText('48.8566, 2.3522'), kind: 'known' },
            {
              assetId: assetB,
              text: translatedText('assistant_operation_metadata_value_unavailable'),
              kind: 'unknown',
            },
          ],
          proposedText: rawText('52.52, 13.405'),
          proposedKind: 'known',
        },
      ],
      warnings: [translatedText('assistant_operation_metadata_warning_coordinates_multi', { count: 2 })],
    });
  });

  it('uses applied metadata summary copy and tolerates unknown future metadata fields', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: metadataId,
          type: AgentOperationType.AssetUpdateMetadata,
          summary: 'Future metadata',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [assetA],
          payload: { placeName: 'Paris' },
          status: AgentOperationStatus.Applied,
          reviewMetadata: {
            assetMetadata: {
              fields: [
                {
                  key: 'futureField',
                  label: 'Future field',
                  previousValues: [
                    { assetId: assetA, value: 'Before', valueKind: AgentOperationReviewMetadataValueKind.Known },
                  ],
                  proposedValue: 'After',
                  proposedValueKind: AgentOperationReviewMetadataValueKind.Known,
                },
              ],
              sampleAssetIds: [assetA],
              warnings: [],
            },
          },
        }),
      ]),
      { [metadataId]: true },
    );

    expect(model.operationsById.get(metadataId)?.review.summary).toBe('Updated metadata for 1 photo');
    expect(model.operationsById.get(metadataId)?.metadataReview?.fields[0]).toEqual(
      expect.objectContaining({
        key: 'futureField',
        label: translatedText('assistant_operation_metadata_field_unknown'),
        proposedText: rawText('After'),
      }),
    );
  });

  it('updates metadata review samples and coordinate warnings from item selections', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: metadataId,
          type: AgentOperationType.AssetUpdateMetadata,
          summary: 'Set location',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [assetA, assetB],
          payload: { latitude: 52.52, longitude: 13.405 },
          reviewMetadata: {
            assetMetadata: {
              fields: [
                {
                  key: 'location',
                  label: 'Location',
                  previousValues: [
                    {
                      assetId: assetA,
                      value: '48.8566, 2.3522',
                      valueKind: AgentOperationReviewMetadataValueKind.Known,
                    },
                    {
                      assetId: assetB,
                      value: '40.7128, -74.006',
                      valueKind: AgentOperationReviewMetadataValueKind.Known,
                    },
                  ],
                  proposedValue: '52.52, 13.405',
                  proposedValueKind: AgentOperationReviewMetadataValueKind.Known,
                },
              ],
              sampleAssetIds: [assetA, assetB],
              warnings: ['Coordinates will be applied to multiple photos.'],
            },
          },
        }),
      ]),
      { [metadataId]: true },
      { [metadataId]: { itemKind: 'asset', mode: 'only', itemIds: [assetA] } },
    );

    expect(model.operationsById.get(metadataId)?.metadataReview).toEqual({
      fields: [
        {
          key: 'location',
          label: translatedText('assistant_operation_metadata_field_location'),
          currentValues: [{ assetId: assetA, text: rawText('48.8566, 2.3522'), kind: 'known' }],
          proposedText: rawText('52.52, 13.405'),
          proposedKind: 'known',
        },
      ],
      warnings: [],
    });
  });

  it('uses applied metadata result asset ids for history counts and warnings', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: metadataId,
          type: AgentOperationType.AssetUpdateMetadata,
          summary: 'Set location',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [assetA, assetB],
          payload: { latitude: 52.52, longitude: 13.405 },
          status: AgentOperationStatus.Applied,
          result: { assetIds: [assetA] },
          reviewMetadata: {
            assetMetadata: {
              fields: [
                {
                  key: 'location',
                  label: 'Location',
                  previousValues: [
                    {
                      assetId: assetA,
                      value: '48.8566, 2.3522',
                      valueKind: AgentOperationReviewMetadataValueKind.Known,
                    },
                    {
                      assetId: assetB,
                      value: '40.7128, -74.006',
                      valueKind: AgentOperationReviewMetadataValueKind.Known,
                    },
                  ],
                  proposedValue: '52.52, 13.405',
                  proposedValueKind: AgentOperationReviewMetadataValueKind.Known,
                },
              ],
              sampleAssetIds: [assetA],
              warnings: [],
            },
          },
        }),
      ]),
      { [metadataId]: true },
    );

    expect(model.operationsById.get(metadataId)?.review.summary).toBe('Updated metadata for 1 photo');
    expect(model.operationsById.get(metadataId)?.selectedAssetIds).toEqual([assetA]);
    expect(model.operationsById.get(metadataId)?.metadataReview).toEqual({
      fields: [
        {
          key: 'location',
          label: translatedText('assistant_operation_metadata_field_location'),
          currentValues: [{ assetId: assetA, text: rawText('48.8566, 2.3522'), kind: 'known' }],
          proposedText: rawText('52.52, 13.405'),
          proposedKind: 'known',
        },
      ],
      warnings: [],
    });
  });

  it('maps future target kinds into stable review destination kinds without throwing', () => {
    const futureOperation = operation({
      id: updateId,
      type: 'asset.rotate' as AgentOperationType,
      summary: 'Rotate landscape photos',
      targetKind: 'asset_batch' as AgentOperationTargetKind,
      assetIds: [assetA, assetB],
      payload: { angle: 90 },
    });

    expect(() => buildOperationReviewModel(plan([futureOperation]), { [updateId]: true })).not.toThrow();

    const model = buildOperationReviewModel(plan([futureOperation]), { [updateId]: true });
    expect(model.operationsById.get(updateId)?.review.destination).toEqual({
      kind: 'assetBatch',
      name: 'Rotate landscape photos',
    });
    expect(model.operationsById.get(updateId)?.review.summary).toBe('Rotate landscape photos');
  });

  it('exposes bounded thumbnail summaries for large operations and groups', () => {
    const assetIds = Array.from(
      { length: 1000 },
      (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    );
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add many assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          assetIds,
          payload: {},
        }),
      ]),
      { [addId]: true },
    );

    expect(model.operationsById.get(addId)?.review.thumbnails).toEqual({
      totalCount: 1000,
      representativeAssetIds: assetIds.slice(0, 12),
      hasMore: true,
    });
    expect(model.groups[0].thumbnailSummary).toEqual({
      totalCount: 1000,
      representativeAssetIds: assetIds.slice(0, 12),
      hasMore: true,
    });
  });

  it('groups existing-space add and remove operations by shared target with human summaries', () => {
    const assetIds = manyAssetIds(100);
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: spaceAddId,
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add screenshots to Family',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          assetIds,
          payload: { spaceName: 'Family' },
        }),
        operation({
          id: spaceRemoveId,
          type: AgentOperationType.SpaceRemoveAssets,
          summary: 'Remove blurry photos from Family',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          assetIds: [assetA, assetB],
          payload: { spaceName: 'Family' },
        }),
      ]),
      { [spaceAddId]: true, [spaceRemoveId]: true },
    );

    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]).toEqual(
      expect.objectContaining({
        id: `existing-space:${spaceId}`,
        title: 'Family',
        subtitle: '2 operations',
        destination: expect.objectContaining({
          kind: 'space',
          id: spaceId,
          name: 'Family',
          title: 'Family',
          subtitle: 'Existing space',
        }),
        assetCount: 102,
        representativeAssetIds: expect.arrayContaining(assetIds.slice(0, 11)),
      }),
    );
    expect(model.groups[0].thumbnailSummary).toEqual({
      totalCount: 102,
      representativeAssetIds: expect.arrayContaining(assetIds.slice(0, 11)),
      hasMore: true,
    });
    expect(model.groups[0].representativeAssetIds).toHaveLength(12);
    expect(model.operationsById.get(spaceAddId)?.review).toEqual(
      expect.objectContaining({
        destination: {
          kind: 'space',
          id: spaceId,
          name: 'Family',
          subtitle: 'Existing space',
        },
        summary: 'Add 100 photos',
      }),
    );
    expect(model.operationsById.get(spaceRemoveId)?.review).toEqual(
      expect.objectContaining({
        destination: {
          kind: 'space',
          id: spaceId,
          name: 'Family',
          subtitle: 'Existing space',
        },
        summary: 'Remove 2 photos',
      }),
    );
  });

  it('exposes editable existing-space detail fields and applies sparse overrides to the display model', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: spaceUpdateId,
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Update Family space details',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: { spaceName: 'Family', description: 'Shared family photos', color: 'green' },
        }),
      ]),
      { [spaceUpdateId]: true },
      {},
      { [spaceUpdateId]: { spaceName: 'Family 2026', description: '', color: 'blue' } },
    );

    expect(model.groups[0]).toEqual(
      expect.objectContaining({
        id: `existing-space:${spaceId}`,
        title: 'Family 2026',
        destination: expect.objectContaining({
          kind: 'space',
          id: spaceId,
          name: 'Family 2026',
          title: 'Family 2026',
          subtitle: 'Existing space',
        }),
      }),
    );
    expect(model.operationsById.get(spaceUpdateId)?.editableFields).toEqual([
      {
        key: 'spaceName',
        label: 'Space name',
        input: 'text',
        originalValue: 'Family',
        value: 'Family 2026',
        required: true,
        maxLength: 100,
      },
      {
        key: 'description',
        label: 'Description',
        input: 'textarea',
        originalValue: 'Shared family photos',
        value: '',
        required: false,
        maxLength: 500,
      },
      {
        key: 'color',
        label: 'Color',
        input: 'select',
        originalValue: 'green',
        value: 'blue',
        required: false,
        options: [
          { value: 'primary', label: 'Primary' },
          { value: 'pink', label: 'Pink' },
          { value: 'red', label: 'Red' },
          { value: 'yellow', label: 'Yellow' },
          { value: 'blue', label: 'Blue' },
          { value: 'green', label: 'Green' },
          { value: 'purple', label: 'Purple' },
          { value: 'orange', label: 'Orange' },
          { value: 'gray', label: 'Gray' },
          { value: 'amber', label: 'Amber' },
        ],
      },
    ]);
    expect(model.operationsById.get(spaceUpdateId)?.summary).toBe(
      'Renamed to "Family 2026"; Cleared description; Changed color to blue',
    );
    expect(buildSelectionPayload(model)).toEqual({
      planId,
      planRevision: 1,
      operationIds: [spaceUpdateId],
      fieldOverrides: {
        [spaceUpdateId]: { spaceName: 'Family 2026', description: '', color: 'blue' },
      },
    });
  });

  it('validates existing-space detail edits before building the apply payload', () => {
    const tooLongDescription = 'x'.repeat(501);
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: spaceUpdateId,
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Update Family space details',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: { spaceName: 'Family', description: 'Shared family photos', color: 'green' },
        }),
      ]),
      { [spaceUpdateId]: true },
      {},
      { [spaceUpdateId]: { spaceName: '   ', description: tooLongDescription, color: 'teal' } },
    );

    expect(model.operationsById.get(spaceUpdateId)?.fieldErrors).toEqual({
      spaceName: 'Space name is required.',
      description: 'Description must be 500 characters or fewer.',
      color: 'Choose a valid Gallery color.',
    });
    expect(model.operationsById.get(spaceUpdateId)?.enabled).toBe(false);
    expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [] });
  });

  describe('buildAgentPlanThumbnailStrip', () => {
    it('returns a bounded collapsed thumbnail set and overflow count for large plans', () => {
      const strip = buildAgentPlanThumbnailStrip(thumbnailGroup(20), 4);

      expect(strip).toEqual({
        totalCount: 20,
        assetIds: ['asset-001', 'asset-002', 'asset-003', 'asset-004'],
        overflowCount: 16,
        hasMore: true,
        hasThumbnails: true,
      });
    });

    it('uses the default collapsed strip limit and never exceeds the maximum supported strip size', () => {
      const defaultStrip = buildAgentPlanThumbnailStrip(thumbnailGroup(20));
      const oversizedStrip = buildAgentPlanThumbnailStrip(thumbnailGroup(20), 200);

      expect(defaultStrip.assetIds).toHaveLength(AGENT_PLAN_THUMBNAIL_STRIP_DEFAULT_LIMIT);
      expect(oversizedStrip.assetIds).toHaveLength(AGENT_PLAN_THUMBNAIL_STRIP_MAX_LIMIT);
      expect(oversizedStrip.overflowCount).toBe(8);
    });

    it('handles zero and negative limits without rendering thumbnails', () => {
      expect(buildAgentPlanThumbnailStrip(thumbnailGroup(5), 0)).toEqual({
        totalCount: 5,
        assetIds: [],
        overflowCount: 0,
        hasMore: false,
        hasThumbnails: false,
      });

      expect(buildAgentPlanThumbnailStrip(thumbnailGroup(5), -4).assetIds).toHaveLength(0);
    });

    it('returns a no-preview model when assets exist but representative thumbnail IDs are unavailable', () => {
      const group = thumbnailGroup(7);
      const strip = buildAgentPlanThumbnailStrip(
        {
          ...group,
          representativeAssetIds: [],
          thumbnailSummary: {
            totalCount: 7,
            representativeAssetIds: [],
            hasMore: true,
          },
        },
        6,
      );

      expect(strip).toEqual({
        totalCount: 7,
        assetIds: [],
        overflowCount: 0,
        hasMore: false,
        hasThumbnails: false,
      });
    });
  });

  it('marks disabled and blocked operations as unselected in review selection metadata', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      { [createId]: false, [addId]: true },
    );

    expect(model.operationsById.get(createId)?.review.selection).toEqual({
      itemKind: 'asset',
      totalCount: 0,
      selectedCount: 0,
      mode: 'none',
      supportsItemSelection: false,
    });
    expect(model.operationsById.get(addId)?.review.selection).toEqual({
      itemKind: 'asset',
      totalCount: 2,
      selectedCount: 0,
      mode: 'none',
      supportsItemSelection: true,
    });
    expect(model.operationsById.get(addId)?.review.dependencies).toEqual([
      { operationId: createId, summary: 'Create Portugal album', blocked: true },
    ]);
  });

  it('builds an empty review model and legacy empty selection payload for an empty operation plan', () => {
    const model = buildOperationReviewModel(plan([]), {});

    expect(model.groups).toEqual([]);
    expect(model.operationsById.size).toBe(0);
    expect(buildApprovedOperationIds(model)).toEqual([]);
    expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [] });
  });

  it('keeps legacy operation-id apply payload while exposing the richer review model', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      { [createId]: true, [addId]: true },
    );

    expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [createId, addId] });
    expect(model.groups[0]).toEqual(
      expect.objectContaining({
        id: 'new-album:album-portugal',
        title: 'New album "Portugal"',
        subtitle: '2 operations',
        assetCount: 2,
        representativeAssetIds: [assetA, assetB],
      }),
    );
    expect(model.operationsById.get(addId)).toEqual(
      expect.objectContaining({
        id: addId,
        summary: 'Add 2 photos',
        assetCount: 2,
        representativeAssetIds: [assetA, assetB],
      }),
    );
  });

  it('exposes editable field metadata and applies sparse text field overrides to review output', () => {
    const fieldOverrides: OperationFieldOverrideState = {
      [createId]: { albumName: 'Portugal highlights', description: 'Lisbon, Porto, and Douro' },
      [updateId]: { description: 'Existing album notes' },
    };
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal', description: 'Lisbon and Porto' },
        }),
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update details',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          payload: { albumName: 'Portugal Archive', description: 'Old notes' },
        }),
      ]),
      { [createId]: true, [updateId]: true },
      {},
      fieldOverrides,
    );

    expect(model.operationsById.get(createId)?.editableFields).toEqual([
      {
        key: 'albumName',
        label: 'Album name',
        input: 'text',
        originalValue: 'Portugal',
        value: 'Portugal highlights',
        required: true,
        maxLength: 200,
      },
      {
        key: 'description',
        label: 'Description',
        input: 'textarea',
        originalValue: 'Lisbon and Porto',
        value: 'Lisbon, Porto, and Douro',
        required: false,
        maxLength: 1000,
      },
    ]);
    expect(model.operationsById.get(createId)?.summary).toBe('Create album "Portugal highlights"');
    expect(model.groups[0]).toEqual(
      expect.objectContaining({
        id: 'new-album:album-portugal',
        title: 'New album "Portugal highlights"',
        destination: expect.objectContaining({
          name: 'Portugal highlights',
          title: 'Portugal highlights',
        }),
      }),
    );
    expect(model.operationsById.get(updateId)?.summary).toBe('Rename album to "Portugal Archive"');
    expect(buildSelectionPayload(model)).toEqual({
      planId,
      planRevision: 1,
      operationIds: [createId, updateId],
      fieldOverrides: {
        [createId]: { albumName: 'Portugal highlights', description: 'Lisbon, Porto, and Douro' },
        [updateId]: { description: 'Existing album notes' },
      },
    });
  });

  it('exposes cover override metadata only for multi-candidate set-cover operations and validates selected covers', () => {
    const currentPlan = plan([
      operation({
        id: coverId,
        type: AgentOperationType.AlbumSetCover,
        summary: 'Set cover',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        assetIds: [assetA, assetB],
        payload: {},
      }),
    ]);
    const model = buildOperationReviewModel(
      currentPlan,
      { [coverId]: true },
      {},
      { [coverId]: { albumThumbnailAssetId: assetB } },
    );

    expect(model.operationsById.get(coverId)?.editableFields).toEqual([
      {
        key: 'albumThumbnailAssetId',
        label: 'Cover photo',
        input: 'coverAsset',
        originalValue: assetA,
        value: assetB,
        assetIds: [assetA, assetB],
        required: true,
      },
    ]);
    expect(model.operationsById.get(coverId)?.fieldErrors).toEqual({});
    expect(buildSelectionPayload(model)).toEqual({
      planId,
      planRevision: 1,
      operationIds: [coverId],
      fieldOverrides: { [coverId]: { albumThumbnailAssetId: assetB } },
    });

    const excludedCoverState = setOperationItemSelection({}, coverId, {
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: [assetB],
    });
    const invalidModel = buildOperationReviewModel(currentPlan, { [coverId]: true }, excludedCoverState, {
      [coverId]: { albumThumbnailAssetId: assetB },
    });

    expect(invalidModel.operationsById.get(coverId)?.fieldErrors).toEqual({
      albumThumbnailAssetId: 'Choose a selected cover photo.',
    });
    expect(invalidModel.operationsById.get(coverId)?.enabled).toBe(false);
    expect(buildSelectionPayload(invalidModel)).toEqual({ planId, planRevision: 1, operationIds: [] });
  });

  it('validates field overrides and omits unchanged, disabled, and blocked field overrides from apply payloads', () => {
    const tooLongDescription = 'x'.repeat(1001);
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal', description: 'Lisbon and Porto' },
        }),
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update details',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          payload: { albumName: 'Portugal Archive', description: 'Old notes' },
        }),
      ]),
      { [createId]: false, [updateId]: true },
      {},
      {
        [createId]: { albumName: 'Disabled album' },
        [updateId]: { albumName: '   ', description: tooLongDescription },
      },
    );

    expect(model.operationsById.get(updateId)?.fieldErrors).toEqual({
      albumName: 'Album name is required.',
      description: 'Description must be 1,000 characters or fewer.',
    });
    expect(model.fieldErrors).toEqual([
      { operationId: updateId, fieldKey: 'albumName', message: 'Album name is required.' },
      {
        operationId: updateId,
        fieldKey: 'description',
        message: 'Description must be 1,000 characters or fewer.',
      },
    ]);
    expect(model.operationsById.get(updateId)?.enabled).toBe(false);
    expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [] });

    const unchangedModel = buildOperationReviewModel(
      plan([
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update details',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          payload: { albumName: 'Portugal Archive', description: 'Old notes' },
        }),
      ]),
      { [updateId]: true },
      {},
      { [updateId]: { albumName: 'Portugal Archive', description: 'Old notes' } },
    );

    expect(buildSelectionPayload(unchangedModel)).toEqual({ planId, planRevision: 1, operationIds: [updateId] });
  });

  it('builds and resets sparse field override state', () => {
    const currentPlan = plan([
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal', description: 'Lisbon and Porto' },
      }),
      operation({
        id: updateId,
        type: AgentOperationType.AlbumUpdateDetails,
        summary: 'Update details',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        payload: { albumName: 'Portugal Archive' },
      }),
    ]);
    const initialState = createInitialOperationFieldOverrideState(currentPlan);
    const editedState = setOperationFieldOverride(
      setOperationFieldOverride(
        setOperationFieldOverride(initialState, createId, 'albumName', 'Portugal highlights'),
        createId,
        'description',
        'Edited description',
      ),
      updateId,
      'description',
      'Keep this override',
    );

    expect(editedState).toEqual({
      [createId]: { albumName: 'Portugal highlights', description: 'Edited description' },
      [updateId]: { description: 'Keep this override' },
    });
    expect(resetOperationFieldOverride(editedState, createId, 'description')).toEqual({
      [createId]: { albumName: 'Portugal highlights' },
      [updateId]: { description: 'Keep this override' },
    });
    expect(resetOperationFieldOverride(editedState, createId)).toEqual({
      [updateId]: { description: 'Keep this override' },
    });
  });

  it('builds sparse allExcept payloads and mixed selection counts after excluding one asset', () => {
    const currentPlan = plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        assetIds: [assetA, assetB],
        payload: {},
      }),
    ]);
    const initialItemState = createInitialOperationItemSelectionState(currentPlan);
    const itemSelectionState = buildOperationItemSelectionState(currentPlan, initialItemState, addId, assetB, false);
    const model = buildOperationReviewModel(currentPlan, { [addId]: true }, itemSelectionState);

    expect(model.operationsById.get(addId)?.review.selection).toEqual({
      itemKind: 'asset',
      totalCount: 2,
      selectedCount: 1,
      mode: 'allExcept',
      itemIds: [assetB],
      supportsItemSelection: true,
    });
    expect(model.operationsById.get(addId)).toEqual(
      expect.objectContaining({
        selected: true,
        enabled: true,
        mixed: true,
        excludedAssetCount: 1,
      }),
    );
    expect(buildSelectionPayload(model)).toEqual({
      planId,
      planRevision: 1,
      operationIds: [addId],
      itemSelections: {
        [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
      },
    });
  });

  it('omits an operation when all selectable assets are excluded', () => {
    const currentPlan = plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        assetIds: [assetA, assetB],
        payload: {},
      }),
    ]);
    const itemSelectionState = setOperationItemSelection({}, addId, {
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: [assetA, assetB],
    });
    const model = buildOperationReviewModel(currentPlan, { [addId]: true }, itemSelectionState);

    expect(model.operationsById.get(addId)).toEqual(
      expect.objectContaining({
        enabled: false,
        mixed: false,
        excludedAssetCount: 2,
      }),
    );
    expect(buildApprovedOperationIds(model)).toEqual([]);
    expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [] });
  });

  it('preserves sparse only selections in the apply payload', () => {
    const currentPlan = plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        assetIds: [assetA, assetB],
        payload: {},
      }),
    ]);
    const itemSelectionState = setOperationItemSelection({}, addId, {
      itemKind: 'asset',
      mode: 'only',
      itemIds: [assetA],
    });
    const model = buildOperationReviewModel(currentPlan, { [addId]: true }, itemSelectionState);

    expect(model.operationsById.get(addId)?.review.selection.selectedCount).toBe(1);
    expect(buildSelectionPayload(model)).toEqual({
      planId,
      planRevision: 1,
      operationIds: [addId],
      itemSelections: {
        [addId]: { itemKind: 'asset', mode: 'only', itemIds: [assetA] },
      },
    });
  });

  it('resets item selection overrides back to default all selection', () => {
    const currentPlan = plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        assetIds: [assetA, assetB],
        payload: {},
      }),
    ]);
    const excludedState = buildOperationItemSelectionState(
      currentPlan,
      createInitialOperationItemSelectionState(currentPlan),
      addId,
      assetB,
      false,
    );
    const resetState = resetOperationItemSelection(excludedState, addId);
    const model = buildOperationReviewModel(currentPlan, { [addId]: true }, resetState);

    expect(resetState[addId]).toBeUndefined();
    expect(model.operationsById.get(addId)?.review.selection).toEqual({
      itemKind: 'asset',
      totalCount: 2,
      selectedCount: 2,
      mode: 'all',
      supportsItemSelection: true,
    });
    expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [addId] });
  });

  it('keeps large operations sparse without creating an eager selected id list', () => {
    const assetIds = Array.from(
      { length: 1000 },
      (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    );
    const currentPlan = plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add many assets',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        assetIds,
        payload: {},
      }),
    ]);
    const itemSelectionState = buildOperationItemSelectionState(
      currentPlan,
      createInitialOperationItemSelectionState(currentPlan),
      addId,
      assetIds[999],
      false,
    );
    const model = buildOperationReviewModel(currentPlan, { [addId]: true }, itemSelectionState);

    expect(model.operationsById.get(addId)?.review.selection.selectedCount).toBe(999);
    expect(model.operationsById.get(addId)?.review.selection.itemIds).toEqual([assetIds[999]]);
    expect(buildSelectionPayload(model).itemSelections?.[addId].itemIds).toHaveLength(1);
  });

  it('summarizes selected destinations, changes, and assets for the evidence ledger shell', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update existing Portugal description',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          payload: { description: 'Updated trip notes' },
        }),
      ]),
      { [createId]: true, [addId]: true, [updateId]: true },
    );

    expect(buildOperationReviewImpactSummary(model)).toEqual({
      destinationCount: 2,
      totalOperationCount: 3,
      selectedOperationCount: 3,
      blockedOperationCount: 0,
      totalAssetCount: 2,
      selectedAssetCount: 2,
    });
  });

  it('excludes disabled and blocked operations from selected evidence ledger impact counts', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update existing Portugal description',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          payload: { description: 'Updated trip notes' },
        }),
      ]),
      { [createId]: false, [addId]: true, [updateId]: true },
    );

    expect(buildOperationReviewImpactSummary(model)).toEqual({
      destinationCount: 2,
      totalOperationCount: 3,
      selectedOperationCount: 1,
      blockedOperationCount: 1,
      totalAssetCount: 2,
      selectedAssetCount: 0,
    });
  });

  it('summarizes partial apply states without treating failed per-asset rows as success', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          status: AgentOperationStatus.Applied,
          result: { albumId },
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetIds: [assetA, assetB],
          status: AgentOperationStatus.Failed,
          result: {
            albumId,
            assetIds: [assetA],
            assetResults: [
              { id: assetA, success: true },
              { id: assetB, success: false, errorMessage: 'Asset no longer exists' },
            ],
          },
          error: 'Failed to add 1 asset(s)',
          payload: {},
        }),
      ]),
      { [createId]: true, [addId]: true },
      {},
    );

    expect(buildOperationReviewApplyStateSummary(model)).toEqual({
      appliedCount: 1,
      skippedCount: 0,
      failedCount: 1,
      partialCount: 1,
      hasFailures: true,
    });
    expect(model.operationsById.get(addId)?.applyState).toMatchObject({
      kind: 'partial',
      appliedAssetCount: 1,
      failedAssetCount: 1,
    });
  });

  it('builds sanitized technical details with bounded arrays', () => {
    const item = buildOperationReviewModel(
      plan([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add many assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetIds: Array.from({ length: 1000 }, (_, index) => `asset-${index}`),
          payload: {},
        }),
      ]),
      { [addId]: true },
      {},
    ).operationsById.get(addId)!;

    expect(buildOperationTechnicalDetails(item)).toMatchObject({
      operationId: addId,
      operationType: AgentOperationType.AlbumAddAssets,
      assetIdPreview: expect.arrayContaining(['asset-0']),
      assetOverflowCount: 980,
    });
  });

  it('keeps skipped apply states and sanitized skipped reasons separate from failures', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetIds: [assetA, assetB],
          status: AgentOperationStatus.Skipped,
          result: { skippedReason: 'Dependency was disabled' },
          payload: {},
        }),
      ]),
      { [addId]: true },
    );
    const item = model.operationsById.get(addId)!;

    expect(item.applyState).toEqual({ kind: 'skipped', reason: 'Dependency was disabled' });
    expect(buildOperationReviewApplyStateSummary(model)).toEqual({
      appliedCount: 0,
      skippedCount: 1,
      failedCount: 0,
      partialCount: 0,
      hasFailures: false,
    });
    expect(buildOperationTechnicalDetails(item)).toMatchObject({
      resultSkippedReason: 'Dependency was disabled',
    });
  });

  it('treats failed operations with no per-asset results as failed instead of partial', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetIds: [assetA, assetB],
          status: AgentOperationStatus.Failed,
          result: { albumId },
          error: 'Album no longer exists',
          payload: {},
        }),
      ]),
      { [addId]: true },
    );

    expect(model.operationsById.get(addId)?.applyState).toEqual({ kind: 'failed', error: 'Album no longer exists' });
    expect(buildOperationReviewApplyStateSummary(model)).toMatchObject({
      failedCount: 1,
      partialCount: 0,
      hasFailures: true,
    });
  });

  it('sanitizes unknown future result shapes without exposing raw payloads', () => {
    const item = buildOperationReviewModel(
      plan([
        operation({
          id: updateId,
          type: 'album.future_operation' as AgentOperationType,
          summary: 'Future operation',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          status: AgentOperationStatus.Applied,
          result: {
            albumId,
            nested: { unsafe: '<script>alert(1)</script>' },
            ids: Array.from({ length: 50 }, (_, index) => `future-${index}`),
          },
          payload: { nested: { unsafe: '<script>alert(1)</script>' } },
        }),
      ]),
      { [updateId]: true },
    ).operationsById.get(updateId)!;

    expect(buildOperationTechnicalDetails(item)).toEqual(
      expect.objectContaining({
        operationId: updateId,
        operationType: 'album.future_operation',
        status: AgentOperationStatus.Applied,
        resultAlbumId: albumId,
      }),
    );
    expect(buildOperationTechnicalDetails(item)).not.toHaveProperty('payload');
    expect(buildOperationTechnicalDetails(item)).not.toHaveProperty('result');
    expect(buildOperationTechnicalDetails(item)).not.toHaveProperty('ids');
  });

  it('handles empty asset ids in technical details', () => {
    const item = buildOperationReviewModel(
      plan([
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update details',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetIds: [],
          payload: { description: 'Updated trip notes' },
        }),
      ]),
      { [updateId]: true },
    ).operationsById.get(updateId)!;

    expect(buildOperationTechnicalDetails(item)).toMatchObject({
      assetIdPreview: [],
      assetOverflowCount: 0,
    });
  });

  it('keeps existing field errors disabling apply while exposing proposed apply state', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update details',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          payload: { albumName: 'Portugal Archive' },
        }),
      ]),
      { [updateId]: true },
      {},
      { [updateId]: { albumName: '   ' } },
    );

    expect(model.operationsById.get(updateId)).toMatchObject({
      enabled: false,
      applyState: { kind: 'proposed' },
      fieldErrors: { albumName: 'Album name is required.' },
    });
    expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [] });
  });

  it('groups new-album operations by temporary target and keeps operation order', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal', description: 'Lisbon and Porto' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
        operation({
          id: coverId,
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      { [createId]: true, [addId]: true, [coverId]: true },
    );

    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]).toEqual(
      expect.objectContaining({
        id: 'new-album:album-portugal',
        title: 'New album "Portugal"',
        subtitle: '3 operations',
        assetCount: 2,
      }),
    );
    expect(model.groups[0].operations.map((operation) => operation.id)).toEqual([createId, addId, coverId]);
  });

  it('marks dependent operations blocked when their create-album dependency is disabled', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      { [createId]: false, [addId]: true },
    );

    expect(model.operationsById.get(addId)).toEqual(
      expect.objectContaining({
        blocked: true,
        enabled: false,
        blockedBy: ['Create Portugal album'],
      }),
    );
    expect(buildApprovedOperationIds(model)).toEqual([]);
  });

  it('blocks transitive dependents when an intermediate dependency is blocked', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
        operation({
          id: coverId,
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA],
          dependencyIds: [addId],
          payload: {},
        }),
      ]),
      { [createId]: false, [addId]: true, [coverId]: true },
    );

    expect(model.operationsById.get(addId)).toEqual(expect.objectContaining({ blocked: true, enabled: false }));
    expect(model.operationsById.get(coverId)).toEqual(
      expect.objectContaining({
        blocked: true,
        enabled: false,
        blockedBy: ['Add two assets'],
      }),
    );
    expect(model.operationsById.get(coverId)?.review.dependencies).toEqual([
      { operationId: addId, summary: 'Add two assets', blocked: true },
    ]);
    expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [] });
  });

  it('blocks operations that reference a missing dependency', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      { [addId]: true },
    );

    expect(model.operationsById.get(addId)).toEqual(
      expect.objectContaining({
        blocked: true,
        enabled: false,
        blockedBy: ['Missing dependency'],
      }),
    );
    expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [] });
  });

  it('builds group toggle state without changing operations outside the group', () => {
    const initialPlan = plan([
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal' },
      }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: [assetA, assetB],
        dependencyIds: [createId],
        payload: {},
      }),
      operation({
        id: updateId,
        type: AgentOperationType.AlbumUpdateDetails,
        summary: 'Update existing Portugal description',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        payload: { description: 'Updated trip notes' },
      }),
    ]);
    const initialState = { [createId]: true, [addId]: true, [updateId]: true };
    const initialModel = buildOperationReviewModel(initialPlan, initialState);

    const nextState = buildGroupEnabledState(initialState, initialModel.groups[0], false);
    const nextModel = buildOperationReviewModel(initialPlan, nextState);

    expect(nextState).toEqual({ [createId]: false, [addId]: false, [updateId]: true });
    expect(buildSelectionPayload(nextModel)).toEqual({ planId, planRevision: 1, operationIds: [updateId] });
  });

  it('preserves independent existing-album operations when a new-album dependency is disabled', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update existing Portugal description',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          payload: { description: 'Updated trip notes' },
        }),
      ]),
      { [createId]: false, [updateId]: true },
    );

    expect(buildApprovedOperationIds(model)).toEqual([updateId]);
    expect(model.groups.map((group) => group.id)).toEqual([
      'new-album:album-portugal',
      'existing-album:00000000-0000-4000-8000-000000000301',
    ]);
  });

  it('uses a generic existing-album group title when an existing-album operation has no target id', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update existing Portugal description',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: null,
          payload: { description: 'Updated trip notes' },
        }),
      ]),
      { [updateId]: true },
    );

    expect(model.groups[0]).toEqual(
      expect.objectContaining({
        id: `operation:${updateId}`,
        title: 'Existing album',
      }),
    );
  });

  it('creates the initial enabled state from server operation defaults', () => {
    expect(
      createInitialOperationEnabledState(
        plan([
          operation({
            id: createId,
            type: AgentOperationType.AlbumCreate,
            summary: 'Create album',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'album-portugal',
            enabled: false,
            payload: { albumName: 'Portugal' },
          }),
          operation({
            id: updateId,
            type: AgentOperationType.AlbumUpdateDetails,
            summary: 'Update album',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: '00000000-0000-4000-8000-000000000301',
            enabled: true,
            payload: { description: 'Updated trip notes' },
          }),
        ]),
      ),
    ).toEqual({ [createId]: false, [updateId]: true });
  });

  it('counts unique assets across operations', () => {
    expect(
      getOperationAssetCount([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          assetIds: [assetA, assetB],
          payload: {},
        }),
        operation({
          id: coverId,
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          assetIds: [assetA],
          payload: {},
        }),
      ]),
    ).toBe(2);
  });
});
