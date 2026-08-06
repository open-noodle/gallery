import {
  AgentApprovalMode,
  AgentOperationApplyStatus,
  AgentOperationPlanStatus,
  AgentOperationReviewMetadataValueKind,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
  type AgentSessionResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { websocketMock } from '@test-data/mocks/websocket.mock';
import AgentOperationPlanReviewPanel from './agent-operation-plan-review-panel.svelte';

vi.mock('$lib/stores/websocket');

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_asset_count: '{count} assets',
    assistant_operation_asset_selection_summary: '{selected} of {total} photos selected',
    assistant_operation_apply_applying: 'Applying operations',
    assistant_operation_apply_bar_label: 'Review selected plan actions',
    assistant_operation_apply_error: 'Unable to apply proposed operations',
    assistant_operation_apply_forbidden:
      'These changes cannot be applied with the current permissions or target ownership. Review the plan and try again.',
    assistant_operation_apply_selected: 'Apply {count} selected',
    assistant_operation_apply_stale: 'This plan changed. Review the latest plan before applying.',
    assistant_operation_apply_summary: '{changes} changes · {assets} assets selected',
    assistant_operation_apply_success: 'Applied {applied} operations. {failed} failed.',
    assistant_operation_blocked_by: 'Blocked by {dependencies}',
    assistant_operation_curation_criteria: 'Criteria: {criteria}',
    assistant_operation_plan_collapse: 'Collapse plan',
    assistant_operation_plan_collapsed: 'Plan collapsed',
    assistant_operation_plan_expand: 'Expand plan',
    assistant_operation_destination_selected_summary: '{selected} of {total} changes selected',
    assistant_operation_destination_toggle: 'Select destination {name}',
    assistant_operation_detail_id: 'Operation ID',
    assistant_operation_detail_risk: 'Risk',
    assistant_operation_detail_status: 'Status',
    assistant_operation_detail_hide: 'Details',
    assistant_operation_detail_show: 'Details',
    assistant_operation_detail_toggle: 'Details',
    assistant_operation_detail_type: 'Type',
    assistant_operation_field_cover_option: 'Use photo {index} as cover',
    assistant_operation_field_cover_thumbnail_alt: 'Cover photo option {index}',
    assistant_operation_field_reset: 'Reset {field}',
    assistant_operation_field_thumbnail_unavailable: 'Preview unavailable',
    assistant_operation_item_change_selection: 'Change selection',
    assistant_operation_item_excluded_count: '{count} excluded',
    assistant_operation_item_exclude_videos: 'Exclude videos',
    assistant_operation_item_exclude_visible: 'Exclude visible',
    assistant_operation_item_filter_label: 'Filter photos',
    assistant_operation_item_filter_placeholder: 'Filter photos',
    assistant_operation_item_include_only_videos: 'Include only videos',
    assistant_operation_item_include_visible: 'Include visible',
    assistant_operation_item_media_all: 'All',
    assistant_operation_item_media_photos: 'Photos',
    assistant_operation_item_media_videos: 'Videos',
    assistant_operation_item_overflow: '+{count} not shown',
    assistant_operation_item_overflow_label: '{count} more affected photos are not shown',
    assistant_operation_item_quick_duplicates: 'Duplicates',
    assistant_operation_item_quick_screenshots: 'Screenshots',
    assistant_operation_item_reset: 'Reset selection',
    assistant_operation_item_review_label: 'Review photos for {summary}',
    assistant_operation_item_select_all_filtered: 'Select all filtered',
    assistant_operation_item_selected_count: '{selected} of {total} selected',
    assistant_operation_item_deselect_all_filtered: 'Deselect all filtered',
    assistant_operation_item_thumbnail_alt: 'Photo {index} of {count}',
    assistant_operation_item_thumbnail_unavailable: 'Preview unavailable',
    assistant_operation_item_toggle: 'Include photo {index}',
    assistant_operation_item_virtual_summary: 'Showing {visible} of {total} photos',
    assistant_operation_metadata_column_current: 'Current',
    assistant_operation_metadata_column_field: 'Field',
    assistant_operation_metadata_column_proposed: 'Proposed',
    assistant_operation_metadata_field_date_shift: 'Date shift',
    assistant_operation_metadata_field_date_taken: 'Date taken',
    assistant_operation_metadata_field_description: 'Description',
    assistant_operation_metadata_field_location: 'Location',
    assistant_operation_metadata_field_rating: 'Rating',
    assistant_operation_metadata_field_time_zone: 'Time zone',
    assistant_operation_metadata_field_unknown: 'Unknown field',
    assistant_operation_metadata_value_clear: 'Clear',
    assistant_operation_metadata_value_clear_rating: 'Clear rating',
    assistant_operation_metadata_value_empty: 'Empty',
    assistant_operation_metadata_value_rating: '{rating} stars',
    assistant_operation_metadata_value_shift_capture_time: 'Shift capture time',
    assistant_operation_metadata_value_shift_minutes: 'Shift {minutes} minutes',
    assistant_operation_metadata_value_unavailable: 'Unavailable',
    assistant_operation_metadata_value_unrated: 'Unrated',
    assistant_operation_metadata_warning_coordinates_multi: 'Coordinates will be applied to {count} photos.',
    assistant_operation_plan_empty: 'No proposed album plan yet.',
    assistant_operation_plan_error: 'Unable to load proposed album plan',
    assistant_operation_plan_loading: 'Loading proposed album plan',
    assistant_operation_plan_destination_count: '{count} destinations',
    assistant_operation_plan_no_destructive_changes: 'No photos will be deleted',
    assistant_operation_plan_review: 'Plan review',
    assistant_operation_plan_selected_asset_count: '{count} selected assets',
    assistant_operation_plan_selected_change_count: '{count} selected changes',
    assistant_operation_photo_review_close: 'Close',
    assistant_operation_photo_review_dismiss_backdrop: 'Dismiss photo review backdrop',
    assistant_operation_photo_review_done: 'Done reviewing',
    assistant_operation_photo_review_keep_original: 'Keep original selection',
    assistant_operation_photo_review_selection: 'Selection',
    assistant_operation_photo_review_title: 'Review photos for {summary}',
    assistant_operation_photo_stage_review: 'Review photos',
    assistant_operation_photo_stage_summary: '{count} selected trip photos',
    assistant_operation_photo_stage_title: 'Photos in this plan',
    assistant_operation_status_applied: 'Applied',
    assistant_operation_status_failed: 'Failed',
    assistant_operation_status_skipped: 'Skipped',
    assistant_operation_risk_high: 'High risk',
    assistant_operation_risk_low: 'Low risk',
    assistant_operation_risk_medium: 'Medium risk',
    assistant_operation_risk_unknown: 'Unknown risk',
    assistant_operation_selected_count: '{count} selected',
    assistant_operation_type_album_add_assets: 'Add assets',
    assistant_operation_type_album_create: 'Create album',
    assistant_operation_type_album_set_cover: 'Set cover',
    assistant_operation_type_album_update_details: 'Update details',
    assistant_operation_type_space_add_assets: 'Add to space',
    assistant_operation_type_space_remove_assets: 'Remove from space',
    assistant_operation_type_space_update_details: 'Update space details',
    assistant_operation_type_unknown: 'Review change',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{applied}', String(options?.values?.applied ?? ''))
        .replace('{failed}', String(options?.values?.failed ?? ''))
        .replace('{field}', String(options?.values?.field ?? ''))
        .replace('{dependencies}', String(options?.values?.dependencies ?? ''))
        .replace('{assets}', String(options?.values?.assets ?? ''))
        .replace('{changes}', String(options?.values?.changes ?? ''))
        .replace('{name}', String(options?.values?.name ?? ''))
        .replace('{criteria}', String(options?.values?.criteria ?? ''))
        .replace('{selected}', String(options?.values?.selected ?? ''))
        .replace('{total}', String(options?.values?.total ?? ''))
        .replace('{summary}', String(options?.values?.summary ?? ''))
        .replace('{visible}', String(options?.values?.visible ?? ''))
        .replace('{index}', String(options?.values?.index ?? ''))
        .replace('{rating}', String(options?.values?.rating ?? ''))
        .replace('{minutes}', String(options?.values?.minutes ?? '')),
    ),
  };
});

const session: AgentSessionResponseDto = {
  id: '00000000-0000-4000-8000-000000000001',
  status: AgentSessionStatus.WaitingForPlanReview,
  providerCredentialId: '00000000-0000-4000-8000-000000000010',
  credentialSnapshot: {
    id: '00000000-0000-4000-8000-000000000010',
    providerType: AgentProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: { model: 'gpt-5.1', providerCredentialId: '00000000-0000-4000-8000-000000000010' },
  initialContextSnapshot: {},
  permissionPlanSnapshot: {
    assetScope: { locked: true, owned: true, sharedSpaces: false },
    limits: {
      expiresInMinutes: null,
      maxAssetsPerSession: 200,
      maxAssetsPerToolCall: 50,
      maxOriginalsPerToolCall: 10,
      maxPreviewsPerToolCall: 50,
    },
    providerExposure: { allowOriginalsForExternalProviders: false, metadata: true, originals: false, previews: true },
    read: { metadata: true, originals: false, previews: true },
    writeScope: {
      addAssets: true,
      addAssetsToSpaces: true,
      addMembersToSpaces: true,
      archiveAssets: true,
      createAlbum: true,
      createSpace: true,
      editAssets: true,
      favoriteAssets: true,
      removeAssets: true,
      removeAssetsFromSpaces: true,
      removeMembersFromSpaces: true,
      setCover: true,
      tagAssets: true,
      updateDetails: true,
      updateAssetMetadata: true,
      updateSpaceDetails: true,
      updateSpaceMemberRoles: true,
      trashAssets: true,
      createSharedLinks: false,
      manageStacks: false,
      managePeople: false,
      shareAlbums: false,
      lockAssets: false,
      deleteContainers: false,
    },
  },
  permissionPreset: AgentPermissionPreset.VisualOrganizer,
  approvalMode: AgentApprovalMode.PlanOnly,
  runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: [], models: [] },
  runnerEndpoint: 'http://agent-runner:4477',
  runnerSessionId: 'runner-session',
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
  endedAt: null,
};

const planId = '00000000-0000-4000-8000-000000000100';
const createId = '00000000-0000-4000-8000-000000000101';
const addId = '00000000-0000-4000-8000-000000000102';
const existingId = '00000000-0000-4000-8000-000000000103';
const metadataId = '00000000-0000-4000-8000-000000000104';
const assetA = '00000000-0000-4000-8000-000000000201';
const assetB = '00000000-0000-4000-8000-000000000202';
const assetC = '00000000-0000-4000-8000-000000000203';

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

const plan = (
  operations: AgentOperationResponseDto[],
  revision = 1,
  summary = 'Organize Portugal holiday',
): AgentOperationPlanResponseDto => ({
  id: planId,
  sessionId: session.id,
  revision,
  status: AgentOperationPlanStatus.Proposed,
  summary,
  operations,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
});

const samplePlan = () =>
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
      id: existingId,
      type: AgentOperationType.AlbumUpdateDetails,
      summary: 'Update existing album description',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: '00000000-0000-4000-8000-000000000301',
      riskLevel: AgentOperationRiskLevel.Medium,
      payload: { description: 'Better description' },
    }),
  ]);

const highlightPlan = () =>
  plan(
    [
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Highlights',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-highlights',
        payload: { albumName: 'Highlights', description: 'Suggested highlights selected from metadata signals.' },
      }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add 3 metadata-only suggested highlights to Highlights.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-highlights',
        assetIds: [assetA, assetB, assetC],
        dependencyIds: [createId],
        payload: {},
      }),
    ],
    1,
    'Create Highlights with 3 metadata-only suggested highlights prioritized existing favorites, ratings, dates, tags, and location; no previews were inspected.',
  );

const appliedPlan = (): AgentOperationPlanResponseDto => ({
  ...samplePlan(),
  status: AgentOperationPlanStatus.Applied,
  operations: samplePlan().operations.map((operation) => ({
    ...operation,
    status: AgentOperationStatus.Applied,
    result: { albumId: '00000000-0000-4000-8000-000000000400' },
  })),
});

const completedPlan = (): AgentOperationPlanResponseDto => ({
  ...samplePlan(),
  status: AgentOperationPlanStatus.Applied,
  operations: samplePlan().operations.map((operation, index) => ({
    ...operation,
    status:
      index === 0
        ? AgentOperationStatus.Applied
        : index === 1
          ? AgentOperationStatus.Failed
          : AgentOperationStatus.Skipped,
    result: index === 0 ? { albumId: '00000000-0000-4000-8000-000000000400' } : null,
    error: index === 1 ? 'Asset permissions changed before apply' : null,
  })),
});

const partiallyAppliedPlan = (): AgentOperationPlanResponseDto => ({
  ...samplePlan(),
  status: AgentOperationPlanStatus.Applied,
  operations: samplePlan().operations.map((operation, index) => ({
    ...operation,
    status:
      index === 0
        ? AgentOperationStatus.Applied
        : index === 1
          ? AgentOperationStatus.Skipped
          : AgentOperationStatus.Failed,
    result: index === 0 ? { albumId: '00000000-0000-4000-8000-000000000400' } : null,
    error: index === 2 ? 'Album owner changed before apply' : null,
  })),
});

const metadataPlan = () =>
  plan([
    operation({
      id: metadataId,
      type: AgentOperationType.AssetUpdateMetadata,
      summary: 'Set metadata',
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds: [assetA, assetB],
      payload: { description: 'Berlin weekend', latitude: 52.52, longitude: 13.405 },
      reviewMetadata: {
        assetMetadata: {
          fields: [
            {
              key: 'description',
              label: 'Description',
              previousValues: [
                { assetId: assetA, value: 'Old caption', valueKind: AgentOperationReviewMetadataValueKind.Known },
              ],
              proposedValue: 'Berlin weekend',
              proposedValueKind: AgentOperationReviewMetadataValueKind.Known,
            },
            {
              key: 'location',
              label: 'Location',
              previousValues: [
                { assetId: assetA, value: '48.8566, 2.3522', valueKind: AgentOperationReviewMetadataValueKind.Known },
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
  ]);

const httpError = (statusCode: number, message: string) =>
  ({
    message,
    data: { statusCode, message },
  }) as unknown as Error;

describe('AgentOperationPlanReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    websocketMock.websocketEvents.on.mockReturnValue(vi.fn());
  });

  it('does not render a review region when the session has no current plan', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(null);

    render(AgentOperationPlanReviewPanel, { props: { session } });

    expect(await screen.findByText('No proposed album plan yet.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Plan review' })).not.toBeInTheDocument();
  });

  it('renders nothing in dock mode when there is no plan and hideEmpty is set', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(null);

    const { container } = render(AgentOperationPlanReviewPanel, {
      props: { session, variant: 'dock', hideEmpty: true },
    });

    await waitFor(() => expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledWith({ id: session.id }));
    await waitFor(() => expect(screen.queryByText('Loading proposed album plan')).not.toBeInTheDocument());
    expect(screen.queryByText('No proposed album plan yet.')).not.toBeInTheDocument();
    expect(container.children).toHaveLength(0);
  });

  it('loads and renders grouped proposed operations', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    const region = await screen.findByRole('region', { name: 'Plan review' });
    const heading = within(region).getByRole('heading', { name: 'Plan review' });
    expect(region).toHaveAttribute('aria-labelledby', 'assistant-operation-plan-title');
    expect(region).not.toHaveAttribute('aria-label');
    expect(heading).toHaveAttribute('id', 'assistant-operation-plan-title');
    expect(within(region).getByText('Organize Portugal holiday')).toBeInTheDocument();
    expect(within(region).getByText('2 destinations')).toBeInTheDocument();
    expect(within(region).getByText('3 selected changes')).toBeInTheDocument();
    expect(within(region).getByText('2 selected assets')).toBeInTheDocument();
    expect(within(region).getByText('No photos will be deleted')).toBeInTheDocument();
    expect(within(region).getByRole('region', { name: 'Portugal' })).toBeInTheDocument();
    expect(within(region).getByText('Create album "Portugal"')).toBeInTheDocument();
    expect(within(region).getByText('Add 2 photos')).toBeInTheDocument();
    expect(within(region).getByText('Update album details')).toBeInTheDocument();
    expect(within(region).queryByText(addId)).not.toBeInTheDocument();
    expect(within(region).queryByText('Add two assets')).not.toBeInTheDocument();
    expect(within(region).queryByText('00000000-0000-4000-8000-000000000301')).not.toBeInTheDocument();
    expect(within(region).getAllByRole('heading', { name: 'Plan review' })).toHaveLength(1);
    expect(within(region).getByText('3 changes · 2 assets selected')).toBeInTheDocument();
    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenLastCalledWith({
        planId,
        planRevision: 1,
        operationIds: [createId, addId, existingId],
      }),
    );
  });

  it('loads existing-space add and remove operations under one space destination', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(
      plan([
        operation({
          id: 'operation-space-add',
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add photos to Family',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: 'space-1',
          assetIds: ['asset-1', 'asset-2', 'asset-3'],
          payload: { spaceName: 'Family' },
        }),
        operation({
          id: 'operation-space-remove',
          type: AgentOperationType.SpaceRemoveAssets,
          summary: 'Remove photos from Family',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: 'space-1',
          assetIds: ['asset-4'],
          payload: { spaceName: 'Family' },
        }),
      ]),
    );

    render(AgentOperationPlanReviewPanel, { props: { session } });

    const region = await screen.findByRole('region', { name: 'Plan review' });
    expect(within(region).getByText('1 destinations')).toBeInTheDocument();
    const spaceGroup = within(region).getByRole('region', { name: 'Family' });
    expect(spaceGroup).toHaveTextContent('Existing space');
    expect(spaceGroup).toHaveTextContent('Add 3 photos');
    expect(spaceGroup).toHaveTextContent('Remove 1 photo');
    expect(within(region).queryByText('space-1')).not.toBeInTheDocument();
  });

  it('renders existing-space detail updates without raw IDs and applies sparse field overrides', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(
      plan([
        operation({
          id: 'operation-space-update',
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Update Family space details',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: 'space-1',
          payload: { spaceName: 'Family', description: 'Shared family photos', color: 'green' },
        }),
      ]),
    );
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.Applied,
      plan: appliedPlan(),
      appliedOperationIds: ['operation-space-update'],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 1 operation(s), skipped 0, failed 0.',
    });
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    const region = await screen.findByRole('region', { name: 'Plan review' });
    expect(within(region).getByRole('region', { name: 'Family' })).toBeInTheDocument();
    expect(
      within(region).getByText('Renamed to "Family"; Updated description; Changed color to green'),
    ).toBeInTheDocument();
    expect(within(region).queryByText('space-1')).not.toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText('Space name'), { target: { value: 'Family 2026' } });
    await fireEvent.input(screen.getByLabelText('Description'), { target: { value: '' } });
    await fireEvent.change(screen.getByLabelText('Color'), { target: { value: 'blue' } });

    expect(screen.getByRole('region', { name: 'Family 2026' })).toBeInTheDocument();
    expect(
      screen.getByText('Renamed to "Family 2026"; Cleared description; Changed color to blue'),
    ).toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      planRevision: 1,
      operationIds: ['operation-space-update'],
      fieldOverrides: {
        'operation-space-update': { spaceName: 'Family 2026', description: '', color: 'blue' },
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Apply 1 selected' }));

    expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
      id: session.id,
      planId,
      agentOperationPlanApplyRequestDto: {
        operationIds: ['operation-space-update'],
        fieldOverrides: {
          'operation-space-update': { spaceName: 'Family 2026', description: '', color: 'blue' },
        },
        planRevision: 1,
      },
    });
  });

  it('reveals technical operation identifiers only inside the row details disclosure', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    render(AgentOperationPlanReviewPanel, { props: { session } });

    const region = await screen.findByRole('region', { name: 'Plan review' });
    expect(within(region).queryByText(addId)).not.toBeInTheDocument();

    await fireEvent.click(within(region).getAllByText('Details')[1]);

    expect(within(region).getByText('Operation ID')).toBeInTheDocument();
    expect(within(region).getByText(addId)).toBeInTheDocument();
  });

  it('renders dock mode without the standalone page shell', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    const { container } = render(AgentOperationPlanReviewPanel, { props: { session, variant: 'dock' } });

    expect(await screen.findByRole('region', { name: 'Plan review' })).toBeInTheDocument();
    expect(container.querySelector('.max-w-3xl')).not.toBeInTheDocument();
  });

  it('collapses the plan sheet to a compact thumbnail summary without losing selected operations', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    render(AgentOperationPlanReviewPanel, { props: { session, variant: 'dock' } });

    await fireEvent.click(await screen.findByRole('checkbox', { name: 'Update album details' }));
    expect(screen.getByRole('button', { name: 'Apply 2 selected' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Collapse plan' }));

    expect(screen.queryByRole('checkbox', { name: 'Update album details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply 2 selected' })).not.toBeInTheDocument();
    expect(screen.getByText('Plan collapsed')).toBeInTheDocument();
    expect(screen.getByText('2 selected changes')).toBeInTheDocument();
    expect(screen.getByText('2 selected assets')).toBeInTheDocument();
    expect(screen.getByText('No photos will be deleted')).toBeInTheDocument();
    const collapsedSummary = screen.getByTestId('agent-operation-plan-collapsed-summary');
    expect(collapsedSummary).toBeInTheDocument();
    expect(within(collapsedSummary).getByTestId('agent-plan-thumbnail-strip')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Expand plan' }));

    expect(screen.getByRole('checkbox', { name: 'Update album details' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply 2 selected' })).toBeInTheDocument();
  });

  it('omits stale collapsed thumbnails when all asset items are excluded', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    render(AgentOperationPlanReviewPanel, { props: { session, variant: 'dock' } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Change selection' }));
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 1' }));
    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 2' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));

    expect(screen.getByRole('button', { name: 'Apply 2 selected' })).toBeInTheDocument();
    expect(screen.getByText('2 changes · 0 assets selected')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Collapse plan' }));

    const collapsedSummary = screen.getByTestId('agent-operation-plan-collapsed-summary');
    expect(within(collapsedSummary).getByText('2 selected changes')).toBeInTheDocument();
    expect(within(collapsedSummary).getByText('0 selected assets')).toBeInTheDocument();
    expect(within(collapsedSummary).queryByTestId('agent-plan-thumbnail-strip')).not.toBeInTheDocument();
  });

  it('preserves disabled operations, sparse selections, and field overrides after collapse while hiding raw IDs again', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    render(AgentOperationPlanReviewPanel, { props: { session, variant: 'dock' } });

    await screen.findByRole('region', { name: 'Portugal' });
    await fireEvent.input(screen.getAllByLabelText('Album name')[0], { target: { value: 'Madeira' } });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Update album details' }));

    await fireEvent.click(screen.getByRole('button', { name: 'Change selection' }));
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 2' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));

    const detailsButtons = screen.getAllByText('Details');
    await fireEvent.click(detailsButtons[1]);

    expect(screen.getByText(addId)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Madeira' })).toBeInTheDocument();
    expect(screen.getAllByText('1 of 2 photos selected')).toHaveLength(2);

    await fireEvent.click(screen.getByRole('button', { name: 'Collapse plan' }));
    expect(screen.queryByRole('checkbox', { name: 'Update album details' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Expand plan' }));
    expect(screen.getByRole('checkbox', { name: 'Update album details' })).not.toBeChecked();
    expect(screen.getByRole('region', { name: 'Madeira' })).toBeInTheDocument();
    expect(screen.getAllByText('1 of 2 photos selected')).toHaveLength(2);
    expect(screen.queryByText(addId)).not.toBeInTheDocument();
  });

  it('keeps the apply action in a sticky area with the selected count', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    const { container } = render(AgentOperationPlanReviewPanel, { props: { session, variant: 'dock' } });

    expect(await screen.findByRole('button', { name: 'Apply 3 selected' })).toBeInTheDocument();
    const applyArea = container.querySelector('[data-testid="agent-operation-plan-sticky-actions"]');
    expect(applyArea).toHaveClass('sticky');
    expect(applyArea).toHaveTextContent('3 changes · 2 assets selected');
  });

  it('reopens the plan card when an apply error arrives after collapse', async () => {
    let rejectApply: (error: Error) => void;
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockReturnValue(
      new Promise((_, reject) => {
        rejectApply = reject;
      }),
    );

    render(AgentOperationPlanReviewPanel, { props: { session, variant: 'dock' } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse plan' }));
    expect(screen.queryByRole('button', { name: 'Applying operations' })).not.toBeInTheDocument();

    rejectApply!(new Error('failed'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to apply proposed operations');
    expect(screen.getByRole('button', { name: 'Apply 3 selected' })).toBeInTheDocument();
  });

  it('shows read-only operation statuses and errors without dumping raw result JSON', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(completedPlan());

    render(AgentOperationPlanReviewPanel, { props: { session, variant: 'dock' } });

    const region = await screen.findByRole('region', { name: 'Plan review' });
    expect(within(region).getByText('Applied')).toBeInTheDocument();
    expect(within(region).getByText('Failed')).toBeInTheDocument();
    expect(within(region).getByText('Skipped')).toBeInTheDocument();
    expect(within(region).getByText('Asset permissions changed before apply')).toBeInTheDocument();
    expect(within(region).queryByText(/albumId/)).not.toBeInTheDocument();
    expect(within(region).queryByText(/\{/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Create album "Portugal"' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply 3 selected' })).toBeDisabled();
  });

  it('does not publish a selection when an in-flight load resolves after unmount', async () => {
    let resolveLoad: (plan: AgentOperationPlanResponseDto) => void;
    sdkMock.getCurrentOperationPlan.mockReturnValueOnce(
      new Promise<AgentOperationPlanResponseDto>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const onSelectionChange = vi.fn();

    const { unmount } = render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });
    await waitFor(() => expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledWith({ id: session.id }));

    unmount();
    resolveLoad!(samplePlan());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('disables dependent operations and removes them from the selection payload', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    const createToggle = await screen.findByRole('checkbox', { name: 'Create album "Portugal"' });
    await fireEvent.click(createToggle);

    const addToggle = screen.getByRole('checkbox', { name: 'Add 2 photos' });
    expect(addToggle).toBeDisabled();
    expect(screen.getByText('Blocked by Create Portugal album')).toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      planRevision: 1,
      operationIds: [existingId],
    });
  });

  it('toggles a whole operation group without changing other groups', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    const groupToggle = await screen.findByRole('checkbox', { name: 'Select destination Portugal' });
    await fireEvent.click(groupToggle);

    expect(screen.getByRole('checkbox', { name: 'Create album "Portugal"' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Add 2 photos' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Update album details' })).toBeChecked();
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      planRevision: 1,
      operationIds: [existingId],
    });
  });

  it('shows a mixed group checkbox state when only some child operations are enabled', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    render(AgentOperationPlanReviewPanel, { props: { session } });

    const addToggle = await screen.findByRole('checkbox', { name: 'Add 2 photos' });
    await fireEvent.click(addToggle);

    const groupToggle = screen.getByRole('checkbox', { name: 'Select destination Portugal' }) as HTMLInputElement;
    expect(groupToggle).not.toBeChecked();
    expect(groupToggle.indeterminate).toBe(true);
    expect(groupToggle).toHaveAttribute('aria-checked', 'mixed');
  });

  it('publishes and applies sparse item selections after a user excludes one photo from the review modal', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.Applied,
      plan: appliedPlan(),
      appliedOperationIds: [createId, addId, existingId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 3 operation(s), skipped 0, failed 0.',
    });
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    const reviewButton = await screen.findByRole('button', { name: 'Review photos' });
    await fireEvent.click(reviewButton);
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 2' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      planRevision: 1,
      operationIds: [createId, addId, existingId],
      itemSelections: {
        [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
      },
    });
    expect(screen.getAllByText('1 of 2 photos selected')).toHaveLength(2);
    expect(screen.getByText('3 changes · 1 assets selected')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Review photos for Add 2 photos' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Apply 3 selected' }));

    expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
      id: session.id,
      planId,
      agentOperationPlanApplyRequestDto: {
        operationIds: [createId, addId, existingId],
        itemSelections: {
          [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
        },
        planRevision: 1,
      },
    });
  });

  it('applies sparse user exclusions to a suggested highlight album plan', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(highlightPlan());
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.Applied,
      plan: appliedPlan(),
      appliedOperationIds: [createId, addId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 2 operation(s), skipped 0, failed 0.',
    });

    render(AgentOperationPlanReviewPanel, { props: { session } });

    const region = await screen.findByRole('region', { name: 'Plan review' });
    expect(within(region).getByText(/Criteria: Metadata-only suggested highlights prioritized/i)).toBeInTheDocument();
    expect(within(region).getByText('3 selected trip photos')).toBeInTheDocument();
    expect(within(region).getByTestId('agent-plan-thumbnail-strip')).toBeInTheDocument();

    await fireEvent.click(within(region).getByRole('button', { name: 'Review photos' }));
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 3 photos' });
    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 2' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));

    expect(screen.getAllByText('2 of 3 photos selected')).toHaveLength(2);
    expect(screen.getByText('2 changes · 2 assets selected')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Apply 2 selected' }));

    expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
      id: session.id,
      planId,
      agentOperationPlanApplyRequestDto: {
        operationIds: [createId, addId],
        itemSelections: {
          [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
        },
        planRevision: 1,
      },
    });
  });

  it('publishes and applies sparse item selections for metadata updates', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(metadataPlan());
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.Applied,
      plan: {
        ...metadataPlan(),
        status: AgentOperationPlanStatus.Applied,
        operations: metadataPlan().operations.map((operation) => ({
          ...operation,
          status: AgentOperationStatus.Applied,
          result: { assetIds: [assetA] },
        })),
      },
      appliedOperationIds: [metadataId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 1 operation(s), skipped 0, failed 0.',
    });
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    const region = await screen.findByRole('region', { name: 'Plan review' });
    expect(within(region).getByText('Description')).toBeInTheDocument();
    expect(within(region).getByText('Coordinates will be applied to 2 photos.')).toBeInTheDocument();

    await fireEvent.click(within(region).getByRole('button', { name: 'Change selection' }));
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Update metadata for 2 photos' });
    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 2' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      planRevision: 1,
      operationIds: [metadataId],
      itemSelections: {
        [metadataId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
      },
    });
    expect(screen.queryByText('Coordinates will be applied to 2 photos.')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Apply 1 selected' }));

    expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
      id: session.id,
      planId,
      agentOperationPlanApplyRequestDto: {
        operationIds: [metadataId],
        itemSelections: {
          [metadataId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
        },
        planRevision: 1,
      },
    });
  });

  it('applies visible bulk exclusion as a bounded allExcept item selection', async () => {
    const largeAssetIds = Array.from({ length: 1000 }, (_, index) => `large-asset-${index + 1}`);
    sdkMock.getCurrentOperationPlan.mockResolvedValue(
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
          summary: 'Add one thousand assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: largeAssetIds,
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
    );
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.Applied,
      plan: appliedPlan(),
      appliedOperationIds: [createId, addId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 2 operation(s), skipped 0, failed 0.',
    });

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Change selection' }));
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 1000 photos' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Exclude visible' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply 2 selected' }));

    const itemSelection =
      sdkMock.applyApprovedOperations.mock.calls[0][0].agentOperationPlanApplyRequestDto.itemSelections?.[addId];
    expect(itemSelection).toMatchObject({ itemKind: 'asset', mode: 'allExcept' });
    expect(itemSelection?.itemIds).toEqual(expect.arrayContaining(largeAssetIds.slice(0, 30)));
    expect(itemSelection?.itemIds).toHaveLength(30);
    expect(itemSelection?.itemIds?.length).toBeLessThan(80);
  });

  it('preserves bulk item selection after closing and reopening photo review', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(
      plan([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add three assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          assetIds: ['asset-1', 'asset-2', 'asset-3'],
          payload: {},
        }),
      ]),
    );

    render(AgentOperationPlanReviewPanel, { props: { session } });

    const changeSelection = await screen.findByRole('button', { name: 'Change selection' });
    await fireEvent.click(changeSelection);
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 3 photos' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Exclude visible' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));
    await fireEvent.click(changeSelection);

    expect(screen.getAllByText('0 of 3 selected').length).toBeGreaterThan(0);
  });

  it('reopens a collapsed large operation with sparse selection and a bounded virtual window', async () => {
    const largeAssetIds = Array.from({ length: 1000 }, (_, index) => `large-asset-${index + 1}`);
    sdkMock.getCurrentOperationPlan.mockResolvedValue(
      plan([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add one thousand assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          assetIds: largeAssetIds,
          payload: {},
        }),
      ]),
    );

    render(AgentOperationPlanReviewPanel, { props: { session } });

    const changeSelection = await screen.findByRole('button', { name: 'Change selection' });
    await fireEvent.click(changeSelection);
    let dialog = screen.getByRole('dialog', { name: 'Review photos for Add 1000 photos' });
    expect(within(dialog).getAllByTestId('agent-plan-item-thumbnail')).toHaveLength(30);

    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 1' }));
    expect(screen.getAllByText('999 of 1000 selected').length).toBeGreaterThan(0);

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));
    expect(screen.queryByTestId('agent-plan-item-review-grid')).not.toBeInTheDocument();

    await fireEvent.click(changeSelection);
    dialog = screen.getByRole('dialog', { name: 'Review photos for Add 1000 photos' });
    expect(screen.getAllByText('999 of 1000 selected').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('checkbox', { name: 'Include photo 1' })).not.toBeChecked();
    expect(within(dialog).getAllByTestId('agent-plan-item-thumbnail')).toHaveLength(30);
    expect(within(dialog).queryByRole('checkbox', { name: 'Include photo 1000' })).not.toBeInTheDocument();
  });

  it('publishes only the filtered assets when selecting all filtered items', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(
      plan([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add three assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          assetIds: ['asset-1', 'asset-2', 'asset-3'],
          payload: {},
        }),
      ]),
    );
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Change selection' }));
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 3 photos' });
    await fireEvent.input(within(dialog).getByRole('searchbox', { name: 'Filter photos' }), {
      target: { value: 'asset-2' },
    });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Select all filtered' }));

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      planRevision: 1,
      operationIds: [addId],
      itemSelections: {
        [addId]: { itemKind: 'asset', mode: 'only', itemIds: ['asset-2'] },
      },
    });
  });

  it('publishes and applies sparse field overrides after an inline album-name edit', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.Applied,
      plan: appliedPlan(),
      appliedOperationIds: [createId, addId, existingId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 3 operation(s), skipped 0, failed 0.',
    });
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    await screen.findByRole('region', { name: 'Portugal' });
    await fireEvent.input(screen.getAllByLabelText('Album name')[0], { target: { value: 'Madeira' } });

    expect(screen.getByRole('region', { name: 'Madeira' })).toBeInTheDocument();
    expect(screen.getByText('Create album "Madeira"')).toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      planRevision: 1,
      operationIds: [createId, addId, existingId],
      fieldOverrides: {
        [createId]: { albumName: 'Madeira' },
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Apply 3 selected' }));

    expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
      id: session.id,
      planId,
      agentOperationPlanApplyRequestDto: {
        operationIds: [createId, addId, existingId],
        fieldOverrides: {
          [createId]: { albumName: 'Madeira' },
        },
        planRevision: 1,
      },
    });
  });

  it('disables apply and publishes invalid field overrides while an inline field has validation errors', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    await screen.findByRole('region', { name: 'Portugal' });
    await fireEvent.input(screen.getAllByLabelText('Album name')[0], { target: { value: '' } });

    expect(screen.getByText('Album name is required.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 2 selected' })).toBeDisabled();
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      planRevision: 1,
      operationIds: [addId, existingId],
      fieldOverrides: {
        [createId]: { albumName: '' },
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Apply 2 selected' }));

    expect(sdkMock.applyApprovedOperations).not.toHaveBeenCalled();
  });

  it('clears field override state after a successful apply response', async () => {
    const updatedAppliedPlan = appliedPlan();
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.Applied,
      plan: updatedAppliedPlan,
      appliedOperationIds: [createId, addId, existingId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 3 operation(s), skipped 0, failed 0.',
    });
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    await screen.findByRole('region', { name: 'Portugal' });
    await fireEvent.input(screen.getAllByLabelText('Album name')[0], { target: { value: 'Madeira' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply 3 selected' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Applied 3 operations. 0 failed.');
    expect(screen.queryByRole('region', { name: 'Madeira' })).not.toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      planRevision: 1,
      operationIds: [createId, addId, existingId],
    });
  });

  it('clears local edits and proposed review controls after a partial apply response', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.PartiallyApplied,
      plan: partiallyAppliedPlan(),
      appliedOperationIds: [createId],
      skippedOperationIds: [addId],
      failedOperationIds: [existingId],
      summary: 'Applied 1 operation(s), skipped 1, failed 1.',
    });

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await screen.findByRole('region', { name: 'Portugal' });
    await fireEvent.input(screen.getAllByLabelText('Album name')[0], { target: { value: 'Madeira' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Change selection' }));
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 2' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply 3 selected' }));

    expect(await screen.findByText('Applied 1 operations. 1 failed.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Madeira' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Portugal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Create album "Portugal"' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply 3 selected' })).not.toBeInTheDocument();
  });

  it('clears the proposed plan after applying the current approved operation selection', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.Applied,
      plan: appliedPlan(),
      appliedOperationIds: [createId, addId, existingId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 3 operation(s), skipped 0, failed 0.',
    });

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));

    expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
      id: session.id,
      planId,
      agentOperationPlanApplyRequestDto: { operationIds: [createId, addId, existingId], planRevision: 1 },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Applied 3 operations. 0 failed.');
    expect(screen.queryByRole('button', { name: 'Apply 3 selected' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Plan review' })).not.toBeInTheDocument();
  });

  it('keeps local apply success visible when the same plan-applied event arrives', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.Applied,
      plan: appliedPlan(),
      appliedOperationIds: [createId, addId, existingId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 3 operation(s), skipped 0, failed 0.',
    });

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Applied 3 operations. 0 failed.');

    handler?.({
      type: 'operation-plan-applied',
      sessionId: session.id,
      planId,
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 3,
      skippedCount: 0,
      failedCount: 0,
    });

    expect(screen.getByRole('status')).toHaveTextContent('Applied 3 operations. 0 failed.');
    expect(screen.queryByText('Organize Portugal holiday')).not.toBeInTheDocument();
    expect(screen.queryByText('No proposed album plan yet.')).not.toBeInTheDocument();
    expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(1);
  });

  it('ignores same-plan plan-applied events while local apply is pending', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    let resolveApply: (response: Awaited<ReturnType<typeof sdkMock.applyApprovedOperations>>) => void;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan.mockImplementation(() =>
      Promise.resolve(sdkMock.getCurrentOperationPlan.mock.calls.length === 1 ? samplePlan() : null),
    );
    sdkMock.applyApprovedOperations.mockReturnValue(
      new Promise((resolve) => {
        resolveApply = resolve;
      }),
    );

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));

    handler?.({
      type: 'operation-plan-applied',
      sessionId: session.id,
      planId,
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 3,
      skippedCount: 0,
      failedCount: 0,
    });

    expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(1);

    resolveApply!({
      status: AgentOperationApplyStatus.Applied,
      plan: appliedPlan(),
      appliedOperationIds: [createId, addId, existingId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 3 operation(s), skipped 0, failed 0.',
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Applied 3 operations. 0 failed.');
    expect(screen.queryByText('Organize Portugal holiday')).not.toBeInTheDocument();
    expect(screen.queryByText('No proposed album plan yet.')).not.toBeInTheDocument();
  });

  it('uses a pending same-plan applied event when the apply response fails after server success', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    let rejectApply: (error: Error) => void;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan.mockImplementation(() =>
      Promise.resolve(sdkMock.getCurrentOperationPlan.mock.calls.length === 1 ? samplePlan() : null),
    );
    sdkMock.applyApprovedOperations.mockReturnValue(
      new Promise((_, reject) => {
        rejectApply = reject;
      }),
    );

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));

    handler?.({
      type: 'operation-plan-applied',
      sessionId: session.id,
      planId,
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 3,
      skippedCount: 0,
      failedCount: 0,
    });

    rejectApply!(new Error('network timeout'));

    expect(await screen.findByRole('status')).toHaveTextContent('Applied 3 operations. 0 failed.');
    expect(screen.queryByText('No proposed album plan yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(2);
  });

  it('disables operation selection while applying and after the plan is applied', async () => {
    let resolveApply: (response: Awaited<ReturnType<typeof sdkMock.applyApprovedOperations>>) => void;
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockReturnValue(
      new Promise((resolve) => {
        resolveApply = resolve;
      }),
    );

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));

    expect(screen.getByRole('checkbox', { name: 'Select destination Portugal' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Create album "Portugal"' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Update album details' })).toBeDisabled();

    resolveApply!({
      status: AgentOperationApplyStatus.Applied,
      plan: appliedPlan(),
      appliedOperationIds: [createId, addId, existingId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 3 operation(s), skipped 0, failed 0.',
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Applied 3 operations. 0 failed.');
    expect(screen.queryByRole('checkbox', { name: 'Select destination Portugal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Create album "Portugal"' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Update album details' })).not.toBeInTheDocument();
  });

  it('sends only enabled and unblocked operation ids when applying', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockResolvedValue({
      status: AgentOperationApplyStatus.PartiallyApplied,
      plan: samplePlan(),
      appliedOperationIds: [existingId],
      skippedOperationIds: [createId, addId],
      failedOperationIds: [],
      summary: 'Applied 1 operation(s), skipped 2, failed 0.',
    });

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('checkbox', { name: 'Select destination Portugal' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply 1 selected' }));

    expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        agentOperationPlanApplyRequestDto: { operationIds: [existingId], planRevision: 1 },
      }),
    );
  });

  it('disables apply when no operations are selected', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('checkbox', { name: 'Select destination Portugal' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Update album details' }));

    expect(screen.getByRole('button', { name: 'Apply 0 selected' })).toBeDisabled();
    expect(sdkMock.applyApprovedOperations).not.toHaveBeenCalled();
  });

  it('shows an apply error without clearing the loaded plan', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockRejectedValue(new Error('failed'));

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to apply proposed operations');
    expect(screen.getByText('Organize Portugal holiday')).toBeInTheDocument();
  });

  it('shows stale apply rejection copy and reloads the latest plan when available', async () => {
    sdkMock.getCurrentOperationPlan
      .mockResolvedValueOnce(samplePlan())
      .mockResolvedValueOnce({ ...samplePlan(), revision: 2, summary: 'Updated Portugal plan' });
    sdkMock.applyApprovedOperations.mockRejectedValue(
      httpError(409, 'This operation plan has changed. Review the latest revision before applying.'),
    );

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This plan changed. Review the latest plan before applying.',
    );
    expect(screen.getByText('Updated Portugal plan')).toBeInTheDocument();
    expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(2);
  });

  it('keeps the current plan and selections visible after an apply network failure', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockRejectedValue(new Error('network timeout'));

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await screen.findByRole('region', { name: 'Portugal' });
    await fireEvent.input(screen.getAllByLabelText('Album name')[0], { target: { value: 'Madeira' } });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Update album details' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Change selection' }));
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 2' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply 2 selected' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to apply proposed operations');
    expect(screen.getByRole('region', { name: 'Madeira' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Update album details' })).not.toBeChecked();
    expect(screen.getAllByText('1 of 2 photos selected')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Apply 2 selected' })).toBeInTheDocument();
  });

  it('shows permission and target ownership rejection copy without clearing the loaded plan', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    sdkMock.applyApprovedOperations.mockRejectedValue(httpError(403, 'Target album is not owned by the user'));

    render(AgentOperationPlanReviewPanel, { props: { session } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'These changes cannot be applied with the current permissions or target ownership. Review the plan and try again.',
    );
    expect(screen.getByText('Organize Portugal holiday')).toBeInTheDocument();
  });

  it('refetches the current plan for same-session plan-applied events from another client', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan.mockResolvedValueOnce(samplePlan()).mockResolvedValueOnce(null);

    render(AgentOperationPlanReviewPanel, { props: { session } });
    expect(await screen.findByText('Organize Portugal holiday')).toBeInTheDocument();

    handler?.({
      type: 'operation-plan-applied',
      sessionId: session.id,
      planId,
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 3,
      skippedCount: 0,
      failedCount: 0,
    });

    expect(await screen.findByText('No proposed album plan yet.')).toBeInTheDocument();
    expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(2);
  });

  it('refetches the current plan for same-session plan-ready events', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan
      .mockResolvedValueOnce(samplePlan())
      .mockResolvedValueOnce({ ...samplePlan(), revision: 2, summary: 'Updated plan' });

    render(AgentOperationPlanReviewPanel, { props: { session } });
    expect(await screen.findByText('Organize Portugal holiday')).toBeInTheDocument();

    handler?.({
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId,
      revision: 2,
    });

    expect(await screen.findByText('Updated plan')).toBeInTheDocument();
    expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(2);
  });

  it('ignores stale plan responses when a newer refresh completes first', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    let resolveFirstLoad: (plan: AgentOperationPlanResponseDto) => void;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan
      .mockReturnValueOnce(
        new Promise<AgentOperationPlanResponseDto>((resolve) => {
          resolveFirstLoad = resolve;
        }),
      )
      .mockResolvedValueOnce({ ...samplePlan(), revision: 2, summary: 'Newer plan' });

    render(AgentOperationPlanReviewPanel, { props: { session } });
    await waitFor(() => expect(handler).toBeDefined());

    handler?.({
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId,
      revision: 2,
    });

    expect(await screen.findByText('Newer plan')).toBeInTheDocument();
    resolveFirstLoad!(samplePlan());

    await waitFor(() => expect(screen.queryByText('Organize Portugal holiday')).not.toBeInTheDocument());
    expect(screen.getByText('Newer plan')).toBeInTheDocument();
  });

  it('ignores plan-ready events for another session', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    render(AgentOperationPlanReviewPanel, { props: { session } });
    expect(await screen.findByText('Organize Portugal holiday')).toBeInTheDocument();

    handler?.({
      type: 'operation-plan-ready',
      sessionId: '00000000-0000-4000-8000-000000000999',
      planId,
      revision: 2,
    });

    await waitFor(() => expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(1));
  });

  it('ignores plan-applied events for another session', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    render(AgentOperationPlanReviewPanel, { props: { session } });
    expect(await screen.findByText('Organize Portugal holiday')).toBeInTheDocument();

    handler?.({
      type: 'operation-plan-applied',
      sessionId: '00000000-0000-4000-8000-000000000999',
      planId,
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 3,
      skippedCount: 0,
      failedCount: 0,
    });

    await waitFor(() => expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(1));
  });

  it('shows a refresh error without clearing an already loaded plan', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan.mockResolvedValueOnce(samplePlan()).mockRejectedValueOnce(new Error('failed'));

    render(AgentOperationPlanReviewPanel, { props: { session } });
    expect(await screen.findByText('Organize Portugal holiday')).toBeInTheDocument();

    handler?.({
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId,
      revision: 2,
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load proposed album plan');
    expect(screen.getByText('Organize Portugal holiday')).toBeInTheDocument();
  });

  it('shows a load error when the plan request fails', async () => {
    sdkMock.getCurrentOperationPlan.mockRejectedValue(new Error('failed'));

    render(AgentOperationPlanReviewPanel, { props: { session } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load proposed album plan');
  });

  it('cleans up websocket listener on destroy', () => {
    const cleanup = vi.fn();
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    websocketMock.websocketEvents.on.mockReturnValue(cleanup);

    const { unmount } = render(AgentOperationPlanReviewPanel, { props: { session } });
    unmount();

    expect(cleanup).toHaveBeenCalled();
  });
});
