import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  type AgentSessionResponseDto,
  type AgentToolCallResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import AgentToolApprovalCard from './agent-tool-approval-card.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_approval_album_count: '{count} albums',
    assistant_approval_approve: 'Approve',
    assistant_approval_asset_count: '{count} assets',
    assistant_approval_data_access: 'Data access',
    assistant_approval_deny: 'Deny',
    assistant_approval_reason: 'Reason',
    assistant_approval_request: 'Approval request',
    assistant_agent_tool_data_class_metadata: 'Metadata',
    assistant_agent_tool_data_class_originals: 'Originals',
    assistant_agent_tool_data_class_plan: 'Plan',
    assistant_agent_tool_data_class_previews: 'Previews',
    assistant_agent_tool_name_searchAssets: 'Search photos',
    assistant_created_at: 'Created',
    assistant_provider_credential: 'Provider credential',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key).replace('{count}', String(options?.values?.count ?? '')),
    ),
  };
});

const session: AgentSessionResponseDto = {
  id: 'session-1',
  status: AgentSessionStatus.WaitingForToolApproval,
  providerCredentialId: 'credential-1',
  credentialSnapshot: {
    id: 'credential-1',
    providerType: AgentProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: { model: 'gpt-5.1', providerCredentialId: 'credential-1' },
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
  approvalMode: AgentApprovalMode.Strict,
  runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: [], models: [] },
  runnerEndpoint: 'http://agent-runner:4477',
  runnerSessionId: 'runner-session-secret',
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
  endedAt: null,
};

const toolCall = (overrides: Partial<AgentToolCallResponseDto> = {}): AgentToolCallResponseDto => ({
  id: overrides.id ?? 'tool-call-1',
  sessionId: overrides.sessionId ?? session.id,
  toolName: overrides.toolName ?? AgentToolName.SearchAssets,
  status: overrides.status ?? AgentToolCallStatus.PendingApproval,
  approvalDecision: overrides.approvalDecision ?? null,
  requestSummary: overrides.requestSummary ?? 'Find summer photos that may belong in a travel album.',
  responseSummary: overrides.responseSummary ?? null,
  dataClass: overrides.dataClass ?? AgentToolDataClass.Metadata,
  assetCount: overrides.assetCount ?? 12,
  albumCount: overrides.albumCount ?? 3,
  startedAt: overrides.startedAt ?? '2026-05-16T10:00:00.000Z',
  completedAt: overrides.completedAt ?? null,
  error: overrides.error ?? null,
  resultSize: overrides.resultSize,
});

describe(AgentToolApprovalCard.name, () => {
  it('renders a plain-language approval request with details collapsed', async () => {
    render(AgentToolApprovalCard, {
      props: { session, toolCall: toolCall(), onApprove: vi.fn(), onDeny: vi.fn() },
    });

    expect(screen.getByRole('article', { name: 'Approval request' })).toBeInTheDocument();
    expect(screen.getByText('Pi wants to search your photos.')).toBeInTheDocument();
    expect(screen.getByText('It may use 12 photos and 3 albums.')).toBeInTheDocument();
    expect(screen.queryByText('Search photos')).not.toBeInTheDocument();
    expect(screen.queryByText('Find summer photos that may belong in a travel album.')).not.toBeInTheDocument();
    expect(screen.queryByText('Metadata')).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenAI personal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/gpt-5.1/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByText('Search photos')).toBeInTheDocument();
    expect(screen.getByText('Find summer photos that may belong in a travel album.')).toBeInTheDocument();
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    expect(screen.getByText(/OpenAI personal/)).toBeInTheDocument();
    expect(screen.getByText(/gpt-5.1/)).toBeInTheDocument();
  });

  it('renders zero counts intentionally', () => {
    render(AgentToolApprovalCard, {
      props: { session, toolCall: toolCall({ assetCount: 0, albumCount: 0 }), onApprove: vi.fn(), onDeny: vi.fn() },
    });

    expect(screen.getByText('It may use no photos and no albums.')).toBeInTheDocument();
  });

  it('shows no-result telemetry in expanded approval details', async () => {
    render(AgentToolApprovalCard, {
      props: {
        session,
        toolCall: toolCall({
          resultSize: {
            returnedItems: 0,
            hasMore: false,
            nextPage: null,
            estimatedBytes: null,
            truncated: false,
            omittedFields: [],
          },
        }),
        onApprove: vi.fn(),
        onDeny: vi.fn(),
      },
    });

    expect(screen.queryByText('Response size')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByText('Response size')).toBeInTheDocument();
    expect(screen.getByText('not estimated')).toBeInTheDocument();
    expect(screen.getByText('Returned items')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('uses safe plain-language fallback copy for unknown future tools', async () => {
    render(AgentToolApprovalCard, {
      props: {
        session,
        toolCall: toolCall({
          toolName: 'futureGalleryTool' as AgentToolName,
          requestSummary: 'Use a future gallery capability',
          assetCount: 0,
          albumCount: 0,
        }),
        onApprove: vi.fn(),
        onDeny: vi.fn(),
      },
    });

    expect(screen.getByText('Pi wants to use your gallery.')).toBeInTheDocument();
    expect(screen.queryByText('futureGalleryTool')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByText('futureGalleryTool')).toBeInTheDocument();
    expect(screen.getByText('Use a future gallery capability')).toBeInTheDocument();
  });

  it('calls approve and deny callbacks with trimmed optional reason', async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    render(AgentToolApprovalCard, {
      props: { session, toolCall: toolCall(), onApprove, onDeny },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith('tool-call-1');

    await fireEvent.click(screen.getByRole('button', { name: 'Reason' }));
    await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: '  Use fewer assets  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenCalledWith('tool-call-1', 'Use fewer assets');
  });

  it('omits blank reasons and disables duplicate clicks while busy', async () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const view = render(AgentToolApprovalCard, {
      props: { session, toolCall: toolCall(), onApprove, onDeny, busy: true },
    });

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();

    await view.rerender({ session, toolCall: toolCall(), onApprove, onDeny, busy: false });
    await fireEvent.click(screen.getByRole('button', { name: 'Reason' }));
    await fireEvent.input(screen.getByLabelText('Reason'), { target: { value: '   ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenCalledWith('tool-call-1', undefined);
  });

  it('renders inline errors and does not expose internal runner fields', () => {
    render(AgentToolApprovalCard, {
      props: {
        session,
        toolCall: toolCall({ requestSummary: 'Search recent favorites' }),
        errorMessage: 'Unable to record approval decision',
        onApprove: vi.fn(),
        onDeny: vi.fn(),
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to record approval decision');
    expect(screen.queryByText('http://agent-runner:4477')).not.toBeInTheDocument();
    expect(screen.queryByText('runner-session-secret')).not.toBeInTheDocument();
    expect(screen.queryByText(/bearer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/gateway/i)).not.toBeInTheDocument();
  });
});
