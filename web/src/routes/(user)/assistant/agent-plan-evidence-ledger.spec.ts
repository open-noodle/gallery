import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { buildOperationReviewModel, setOperationFieldOverride } from './agent-operation-plan-ui';
import AgentPlanEvidenceLedger from './agent-plan-evidence-ledger.svelte';

vi.mock('$lib/utils', () => ({
  getAssetMediaUrl: ({ id, size }: { id: string; size: string }) => `/api/assets/${id}/thumbnail?size=${size}`,
}));

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_apply_applying: 'Applying operations',
    assistant_operation_apply_bar_label: 'Review selected plan actions',
    assistant_operation_apply_partial_summary:
      '{applied} applied · {skipped} skipped · {failed} failed. Review details before continuing.',
    assistant_operation_apply_selected: 'Apply {count} selected',
    assistant_operation_apply_summary: '{changes} changes · {assets} assets selected',
    assistant_operation_asset_count: '{count} assets',
    assistant_operation_asset_selection_summary: '{selected} of {total} photos selected',
    assistant_operation_blocked_by: 'Blocked by {dependencies}',
    assistant_operation_destination_selected_summary: '{selected} of {total} changes selected',
    assistant_operation_destination_toggle: 'Select destination {name}',
    assistant_operation_detail_id: 'Operation ID',
    assistant_operation_detail_risk: 'Risk',
    assistant_operation_detail_status: 'Status',
    assistant_operation_detail_hide: 'Hide technical details',
    assistant_operation_detail_show: 'Show technical details',
    assistant_operation_detail_type: 'Type',
    assistant_operation_field_cover_option: 'Use photo {index} as cover',
    assistant_operation_field_cover_thumbnail_alt: 'Cover photo option {index}',
    assistant_operation_field_reset: 'Reset {field}',
    assistant_operation_field_thumbnail_unavailable: 'Preview unavailable',
    assistant_operation_plan_destination_count: '{count} destinations',
    assistant_operation_plan_no_destructive_changes: 'No photos will be deleted',
    assistant_operation_plan_review: 'Plan review',
    assistant_operation_plan_selected_asset_count: '{count} selected assets',
    assistant_operation_plan_selected_change_count: '{count} selected changes',
    assistant_operation_photo_stage_review: 'Review photos',
    assistant_operation_photo_stage_summary: '{count} selected trip photos',
    assistant_operation_photo_stage_title: 'Photos in this plan',
    assistant_operation_photo_review_close: 'Close',
    assistant_operation_photo_review_dismiss_backdrop: 'Dismiss photo review backdrop',
    assistant_operation_photo_review_done: 'Done reviewing',
    assistant_operation_photo_review_keep_original: 'Keep original selection',
    assistant_operation_photo_review_selection: 'Selection',
    assistant_operation_photo_review_title: 'Review photos for {summary}',
    assistant_operation_status_applied: 'Applied',
    assistant_operation_status_failed: 'Failed',
    assistant_operation_status_partial: 'Partially applied',
    assistant_operation_status_proposed: 'Proposed',
    assistant_operation_status_skipped: 'Skipped',
    assistant_operation_item_excluded_count: '{count} excluded',
    assistant_operation_item_change_selection: 'Change selection',
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
    assistant_operation_item_empty_filter: 'No matching photos',
    assistant_operation_item_thumbnail_alt: 'Photo {index} of {count}',
    assistant_operation_item_thumbnail_unavailable: 'Preview unavailable',
    assistant_operation_item_toolbar_label: 'Photo review controls',
    assistant_operation_item_toggle: 'Include photo {index}',
    assistant_operation_item_virtual_summary: 'Showing {visible} of {total} photos',
    assistant_operation_risk_low: 'Low risk',
    assistant_operation_thumbnail_alt: 'Photo preview {index} of {count}',
    assistant_operation_thumbnail_empty: '{count} photos without previews',
    assistant_operation_thumbnail_overflow: '+{count}',
    assistant_operation_thumbnail_overflow_label: '{count} more photos',
    assistant_operation_thumbnail_strip_label: '{count} photo previews',
    assistant_operation_thumbnail_unavailable: 'Preview unavailable',
    assistant_operation_type_album_add_assets: 'Add assets',
    assistant_operation_type_album_create: 'Create album',
    assistant_operation_type_album_update_details: 'Update album details',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{assets}', String(options?.values?.assets ?? ''))
        .replace('{applied}', String(options?.values?.applied ?? ''))
        .replace('{changes}', String(options?.values?.changes ?? ''))
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{dependencies}', String(options?.values?.dependencies ?? ''))
        .replace('{index}', String(options?.values?.index ?? ''))
        .replace('{field}', String(options?.values?.field ?? ''))
        .replace('{name}', String(options?.values?.name ?? ''))
        .replace('{selected}', String(options?.values?.selected ?? ''))
        .replace('{skipped}', String(options?.values?.skipped ?? ''))
        .replace('{failed}', String(options?.values?.failed ?? ''))
        .replace('{summary}', String(options?.values?.summary ?? ''))
        .replace('{total}', String(options?.values?.total ?? ''))
        .replace('{visible}', String(options?.values?.visible ?? '')),
    ),
  };
});

const planId = '00000000-0000-4000-8000-000000000100';
const createId = '00000000-0000-4000-8000-000000000101';
const addId = '00000000-0000-4000-8000-000000000102';
const updateId = '00000000-0000-4000-8000-000000000103';
const assetA = '00000000-0000-4000-8000-000000000201';
const assetB = '00000000-0000-4000-8000-000000000202';
const existingAlbumId = '00000000-0000-4000-8000-000000000301';

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
): AgentOperationResponseDto => ({ ...baseOperation, ...operation });

const plan = (
  operations: AgentOperationResponseDto[],
  status: AgentOperationPlanStatus = AgentOperationPlanStatus.Proposed,
): AgentOperationPlanResponseDto => ({
  id: planId,
  sessionId: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  status,
  summary: 'Organize Portugal holiday',
  operations,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
});

const model = (itemSelectionByOperationId = {}) =>
  buildOperationReviewModel(
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
        summary: 'Update description',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: existingAlbumId,
        payload: { description: 'Better notes' },
      }),
    ]),
    { [createId]: true, [addId]: true, [updateId]: true },
    itemSelectionByOperationId,
  );

describe('AgentPlanEvidenceLedger', () => {
  it('renders the plan header, destination cards, and sticky apply summary without raw operation details', () => {
    render(AgentPlanEvidenceLedger, {
      props: {
        model: model(),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: true,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onResetItemSelection: vi.fn(),
        onApply: vi.fn(),
      },
    });

    const reviewRegion = screen.getByRole('region', { name: 'Plan review' });
    expect(reviewRegion).toHaveAttribute('aria-labelledby', 'assistant-operation-plan-title');
    expect(screen.getByRole('heading', { name: 'Plan review' })).toBeInTheDocument();
    expect(screen.getByText('Organize Portugal holiday')).toBeInTheDocument();
    expect(screen.getByText('2 destinations')).toBeInTheDocument();
    expect(screen.getByText('3 selected changes')).toBeInTheDocument();
    expect(screen.getByText('2 selected assets')).toBeInTheDocument();
    expect(screen.getByText('No photos will be deleted')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Portugal' })).toBeInTheDocument();
    expect(screen.queryByText('Create Portugal album')).not.toBeInTheDocument();
    expect(screen.queryByText('Add two assets')).not.toBeInTheDocument();
    expect(screen.queryByText('Update description')).not.toBeInTheDocument();
    expect(screen.queryByText('album-portugal')).not.toBeInTheDocument();
    expect(screen.queryByText(existingAlbumId)).not.toBeInTheDocument();
    expect(screen.queryByText('Better notes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 3 selected' })).toBeInTheDocument();
    expect(screen.getByText('3 changes · 2 assets selected')).toBeInTheDocument();
  });

  it('uses alert and status live roles for operation plan messages', () => {
    render(AgentPlanEvidenceLedger, {
      props: {
        model: model(),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: true,
        applying: false,
        errorMessage: 'Unable to refresh plan',
        applyErrorMessage: 'Unable to apply selected changes',
        applyMessage: 'Applied selected changes',
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onResetItemSelection: vi.fn(),
        onApply: vi.fn(),
      },
    });

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent('Unable to refresh plan');
    expect(alerts[1]).toHaveTextContent('Unable to apply selected changes');
    expect(screen.getByRole('status')).toHaveTextContent('Applied selected changes');
  });

  it('dispatches apply from the sticky apply bar', async () => {
    const onApply = vi.fn();
    render(AgentPlanEvidenceLedger, {
      props: {
        model: model(),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: true,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onResetItemSelection: vi.fn(),
        onApply,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Apply 3 selected' }));

    expect(onApply).toHaveBeenCalledOnce();
  });

  it('keeps the sticky apply bar compatible with narrow screens and the same apply button name', () => {
    render(AgentPlanEvidenceLedger, {
      props: {
        model: model(),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: true,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onResetItemSelection: vi.fn(),
        onApply: vi.fn(),
      },
    });

    const applyRegion = screen.getByTestId('agent-operation-plan-sticky-actions');

    expect(applyRegion).toHaveClass('sticky', 'bottom-3', 'flex', 'flex-col', 'gap-3', 'rounded-3xl');
    expect(applyRegion).not.toHaveClass('border-t');
    expect(applyRegion).toHaveClass('sm:flex-row');
    expect(screen.getByRole('button', { name: 'Apply 3 selected' })).toBeInTheDocument();
  });

  it('can omit the ledger header when embedded inside the collapsible review panel', () => {
    render(AgentPlanEvidenceLedger, {
      props: {
        model: model(),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: true,
        applying: false,
        showHeader: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onResetItemSelection: vi.fn(),
        onApply: vi.fn(),
      },
    });

    expect(screen.queryByRole('heading', { name: 'Plan review' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Portugal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 3 selected' })).toBeInTheDocument();
  });

  it('renders an empty ledger shell without destination cards or an enabled apply action', () => {
    render(AgentPlanEvidenceLedger, {
      props: {
        model: buildOperationReviewModel(plan([]), {}),
        selectedOperationIds: [],
        canChangeSelection: true,
        canApply: false,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onResetItemSelection: vi.fn(),
        onApply: vi.fn(),
      },
    });

    expect(screen.getByText('0 destinations')).toBeInTheDocument();
    expect(screen.getByText('0 selected changes')).toBeInTheDocument();
    expect(screen.getByText('0 selected assets')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Portugal' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 0 selected' })).toBeDisabled();
  });

  it('uses selected asset counts after item exclusion and threads item callbacks', async () => {
    const onToggleItem = vi.fn();
    const onResetItemSelection = vi.fn();
    render(AgentPlanEvidenceLedger, {
      props: {
        model: model({ [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] } }),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: true,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem,
        onResetItemSelection,
        onApply: vi.fn(),
      },
    });

    expect(screen.getByText('1 selected assets')).toBeInTheDocument();
    expect(screen.getByText('3 changes · 1 assets selected')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Change selection' }));
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 2' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Keep original selection' }));

    expect(onToggleItem).toHaveBeenCalledWith(addId, assetB, true);
    expect(onResetItemSelection).toHaveBeenCalledWith(addId);
  });

  it('opens the photo review modal from the photo stage and threads item callbacks', async () => {
    const onToggleItem = vi.fn();
    const onResetItemSelection = vi.fn();
    render(AgentPlanEvidenceLedger, {
      props: {
        model: model({ [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] } }),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: true,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem,
        onResetItemSelection,
        onApply: vi.fn(),
      },
    });

    const stage = screen.getByTestId('agent-plan-photo-stage');
    await fireEvent.click(within(stage).getByRole('button', { name: 'Review photos' }));

    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    expect(within(dialog).getByTestId('agent-plan-item-review-grid')).toBeInTheDocument();

    await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 2' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Keep original selection' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));

    expect(onToggleItem).toHaveBeenCalledWith(addId, assetB, true);
    expect(onResetItemSelection).toHaveBeenCalledWith(addId);
    expect(screen.queryByRole('dialog', { name: 'Review photos for Add 2 photos' })).not.toBeInTheDocument();
  });

  it('threads bulk item callbacks through destination cards', async () => {
    const onBulkSetItems = vi.fn();
    const onSetOnlyItems = vi.fn();
    render(AgentPlanEvidenceLedger, {
      props: {
        model: model(),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: true,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onBulkSetItems,
        onSetOnlyItems,
        onResetItemSelection: vi.fn(),
        onApply: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Change selection' }));
    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Exclude visible' }));
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Select all filtered' }));

    expect(onBulkSetItems).toHaveBeenCalledWith(addId, [assetA, assetB], false);
    expect(onSetOnlyItems).toHaveBeenCalledWith(addId, [assetA, assetB]);
  });

  it('disables apply when an inline field is invalid and threads field callbacks', async () => {
    const onApply = vi.fn();
    const onSetFieldOverride = vi.fn();
    const onResetFieldOverride = vi.fn();
    render(AgentPlanEvidenceLedger, {
      props: {
        model: buildOperationReviewModel(
          plan([
            operation({
              id: createId,
              type: AgentOperationType.AlbumCreate,
              summary: 'Create Portugal album',
              targetKind: AgentOperationTargetKind.NewAlbum,
              temporaryTargetId: 'album-portugal',
              payload: { albumName: 'Portugal' },
            }),
          ]),
          { [createId]: true },
          {},
          setOperationFieldOverride({}, createId, 'albumName', ''),
        ),
        selectedOperationIds: [createId],
        canChangeSelection: true,
        canApply: false,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onResetItemSelection: vi.fn(),
        onSetFieldOverride,
        onResetFieldOverride,
        onApply,
      },
    });

    expect(screen.getByText('Album name is required.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 1 selected' })).toBeDisabled();

    await fireEvent.input(screen.getByLabelText('Album name'), { target: { value: 'Madeira' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset Album name' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply 1 selected' }));

    expect(onSetFieldOverride).toHaveBeenCalledWith(createId, 'albumName', 'Madeira');
    expect(onResetFieldOverride).toHaveBeenCalledWith(createId, 'albumName');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('renders partial apply banner with applied skipped and failed counts', () => {
    const applied = operation({
      id: createId,
      type: AgentOperationType.AlbumCreate,
      summary: 'Create Portugal album',
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'album-portugal',
      payload: { albumName: 'Portugal' },
      status: AgentOperationStatus.Applied,
    });
    const partial = operation({
      id: addId,
      type: AgentOperationType.AlbumAddAssets,
      summary: 'Add two assets',
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'album-portugal',
      assetIds: [assetA, assetB],
      payload: {},
      status: AgentOperationStatus.Failed,
      result: {
        assetResults: [
          { id: assetA, success: true },
          { id: assetB, success: false, errorMessage: 'Asset is missing' },
        ],
      },
    });
    const skipped = operation({
      id: updateId,
      type: AgentOperationType.AlbumUpdateDetails,
      summary: 'Update description',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: existingAlbumId,
      payload: { description: 'Better notes' },
      status: AgentOperationStatus.Skipped,
      result: { skippedReason: 'Dependency was not applied' },
    });

    render(AgentPlanEvidenceLedger, {
      props: {
        model: buildOperationReviewModel(plan([applied, partial, skipped], AgentOperationPlanStatus.Applied), {
          [createId]: true,
          [addId]: true,
          [updateId]: true,
        }),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: false,
        canApply: false,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onResetItemSelection: vi.fn(),
        onApply: vi.fn(),
      },
    });

    expect(screen.getByText('1 applied · 1 skipped · 1 failed. Review details before continuing.')).toBeInTheDocument();
  });

  it('keeps raw operation IDs and payload values absent before opening technical details', () => {
    render(AgentPlanEvidenceLedger, {
      props: {
        model: model(),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: true,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onResetItemSelection: vi.fn(),
        onApply: vi.fn(),
      },
    });

    expect(screen.queryByText(createId)).not.toBeInTheDocument();
    expect(screen.queryByText(addId)).not.toBeInTheDocument();
    expect(screen.queryByText('album-portugal')).not.toBeInTheDocument();
    expect(screen.queryByText('Better notes')).not.toBeInTheDocument();
  });

  it('keeps selection controls disabled for applied plans while allowing read-only photo review', async () => {
    render(AgentPlanEvidenceLedger, {
      props: {
        model: buildOperationReviewModel(plan(model().plan.operations, AgentOperationPlanStatus.Applied), {
          [createId]: true,
          [addId]: true,
          [updateId]: true,
        }),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: false,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onToggleItem: vi.fn(),
        onResetItemSelection: vi.fn(),
        onApply: vi.fn(),
      },
    });

    expect(screen.getByRole('checkbox', { name: 'Select destination Portugal' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Add 2 photos' })).toBeDisabled();

    const stage = screen.getByTestId('agent-plan-photo-stage');
    const reviewButton = within(stage).getByRole('button', { name: 'Review photos' });
    expect(reviewButton).toBeEnabled();

    await fireEvent.click(reviewButton);

    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    expect(within(dialog).getByRole('checkbox', { name: 'Include photo 1' })).toBeDisabled();
  });
});
