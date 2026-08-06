import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
} from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import { buildOperationReviewModel } from './agent-operation-plan-ui';
import AgentPlanTechnicalDetails from './agent-plan-technical-details.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_detail_assets_overflow: '{count} more asset IDs',
    assistant_operation_detail_assets_preview: 'Asset IDs',
    assistant_operation_detail_hide: 'Hide technical details',
    assistant_operation_detail_id: 'Operation ID',
    assistant_operation_detail_risk: 'Risk',
    assistant_operation_detail_show: 'Show technical details',
    assistant_operation_detail_status: 'Status',
    assistant_operation_detail_type: 'Type',
    assistant_operation_risk_low: 'Low risk',
    assistant_operation_status_applied: 'Applied',
    assistant_operation_status_failed: 'Failed',
    assistant_operation_status_partial: 'Partially applied',
    assistant_operation_status_proposed: 'Proposed',
    assistant_operation_status_skipped: 'Skipped',
    assistant_operation_type_album_add_assets: 'Add assets',
    assistant_operation_type_album_create: 'Create album',
    assistant_operation_type_album_set_cover: 'Set cover',
    assistant_operation_type_album_update_details: 'Update details',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key).replace('{count}', String(options?.values?.count ?? '')),
    ),
  };
});

const planId = '00000000-0000-4000-8000-000000000100';
const addId = '00000000-0000-4000-8000-000000000102';
const assetIds = Array.from(
  { length: 1000 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 200).padStart(12, '0')}`,
);
const resultAssetIds = Array.from(
  { length: 1000 },
  (_, index) => `00000000-0000-4000-8001-${String(index + 200).padStart(12, '0')}`,
);

const baseOperation = {
  planId,
  targetId: null,
  temporaryTargetId: 'album-portugal',
  assetIds,
  dependencyIds: [],
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  status: AgentOperationStatus.Proposed,
  result: null,
  error: null,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
} satisfies Omit<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>;

const operation = (overrides: Partial<AgentOperationResponseDto> = {}): AgentOperationResponseDto => ({
  ...baseOperation,
  id: addId,
  type: AgentOperationType.AlbumAddAssets,
  summary: 'Add one thousand assets',
  targetKind: AgentOperationTargetKind.NewAlbum,
  payload: {},
  ...overrides,
});

const plan = (operation: AgentOperationResponseDto): AgentOperationPlanResponseDto => ({
  id: planId,
  sessionId: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  status: AgentOperationPlanStatus.Proposed,
  summary: 'Organize Portugal holiday',
  operations: [operation],
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
});

const item = (overrides: Partial<AgentOperationResponseDto> = {}) =>
  buildOperationReviewModel(plan(operation(overrides)), { [addId]: true }).operationsById.get(addId)!;

describe('AgentPlanTechnicalDetails', () => {
  it('hides operation ID while the disclosure is closed', () => {
    render(AgentPlanTechnicalDetails, { props: { item: item() } });

    expect(screen.queryByText(addId)).not.toBeInTheDocument();
    expect(screen.queryByText(assetIds[0])).not.toBeInTheDocument();
  });

  it('shows operation ID, type, risk, status, bounded asset ID preview, and overflow count when opened', async () => {
    const user = userEvent.setup();
    render(AgentPlanTechnicalDetails, { props: { item: item() } });

    await user.keyboard('{Tab}{Enter}');

    expect(screen.getByText(addId)).toBeInTheDocument();
    expect(screen.getByText('Add assets')).toBeInTheDocument();
    expect(screen.getByText('Low risk')).toBeInTheDocument();
    expect(screen.getByText('Proposed')).toBeInTheDocument();
    expect(screen.getByText(assetIds[0])).toBeInTheDocument();
    expect(screen.getByText('980 more asset IDs')).toBeInTheDocument();
  });

  it('bounds payload and result arrays without rendering every asset ID', async () => {
    const user = userEvent.setup();
    render(AgentPlanTechnicalDetails, {
      props: {
        item: item({
          status: AgentOperationStatus.Applied,
          result: { assetIds: resultAssetIds },
        }),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Show technical details' }));

    expect(screen.getByText(assetIds[19])).toBeInTheDocument();
    expect(screen.queryByText(assetIds[20])).not.toBeInTheDocument();
    expect(screen.getByText(resultAssetIds[19])).toBeInTheDocument();
    expect(screen.queryByText(resultAssetIds[20])).not.toBeInTheDocument();
    expect(screen.getAllByText('980 more asset IDs')).toHaveLength(2);
  });

  it('shows sanitized failed operation error text only inside the disclosure', async () => {
    const user = userEvent.setup();
    render(AgentPlanTechnicalDetails, {
      props: {
        item: item({
          status: AgentOperationStatus.Failed,
          error: 'Could not add asset\n    at applyOperation (/server/raw-path.ts:12)',
        }),
      },
    });

    expect(screen.queryByText('Could not add asset')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show technical details' }));

    expect(screen.getByText('Could not add asset')).toBeInTheDocument();
    expect(screen.queryByText(/raw-path/)).not.toBeInTheDocument();
  });

  it('has a role-reachable disclosure button that toggles with the keyboard', async () => {
    const user = userEvent.setup();
    render(AgentPlanTechnicalDetails, { props: { item: item() } });

    const button = screen.getByRole('button', { name: 'Show technical details' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Tab}{Enter}');

    expect(screen.getByRole('button', { name: 'Hide technical details' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(addId)).toBeInTheDocument();
  });
});
