import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  type AgentSessionResponseDto,
} from '@immich/sdk';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'svelte';
import { readable } from 'svelte/store';
import AgentSessionDetailsDrawer from './agent-session-details-drawer.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_approval_mode: 'Approval mode',
    assistant_approval_behavior_all_actions: 'Strict',
    assistant_close_details: 'Close details',
    assistant_created_at: 'Created',
    assistant_dismiss_details: 'Dismiss details',
    assistant_ended_at: 'Ended',
    assistant_model: 'Model',
    assistant_models: 'Models',
    assistant_not_available: 'Not available',
    assistant_permission_preset: 'Permission preset',
    assistant_permission_preset_careful: 'Careful',
    assistant_protocol_version: 'Protocol version',
    assistant_provider_credential: 'Provider credential',
    assistant_runner_capabilities: 'Runner capabilities',
    assistant_session_details: 'Session details',
    assistant_session_status_completed: 'Completed',
    assistant_session_status_running: 'Running',
    assistant_streaming: 'Streaming',
    assistant_tools: 'Tools',
    assistant_updated_at: 'Updated',
    assistant_yes: 'yes',
    status: 'Status',
  };

  return { t: readable((key: string) => messages[key] ?? key) };
});

const makeSession = (overrides: Partial<AgentSessionResponseDto> = {}): AgentSessionResponseDto => ({
  id: '00000000-0000-4000-8000-000000000100',
  status: AgentSessionStatus.Completed,
  providerCredentialId: '00000000-0000-4000-8000-000000000001',
  credentialSnapshot: {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: AgentProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: 'https://internal-runner.example.local/v1',
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: { model: 'gpt-5.1', providerCredentialId: '00000000-0000-4000-8000-000000000001' },
  initialContextSnapshot: { bearer: 'Bearer secret-token', requestMetadata: { internal: true } },
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
  permissionPreset: AgentPermissionPreset.Careful,
  approvalMode: AgentApprovalMode.Strict,
  runnerCapabilitiesSnapshot: {
    protocolVersion: '2026-05-14',
    streaming: true,
    tools: ['album.create', 'asset.search'],
    models: ['gpt-5.1', 'gpt-5.1-mini'],
  },
  runnerEndpoint: 'https://runner.internal.local/session',
  runnerSessionId: 'runner-session-secret-id',
  createdAt: '2026-05-16T09:00:00.000Z',
  updatedAt: '2026-05-16T09:30:00.000Z',
  endedAt: '2026-05-16T10:00:00.000Z',
  ...overrides,
});

const renderDrawer = (props: Partial<ComponentProps<typeof AgentSessionDetailsDrawer>> = {}) => {
  const onClose = vi.fn();

  render(AgentSessionDetailsDrawer, {
    props: {
      session: makeSession(),
      open: false,
      onClose,
      ...props,
    },
  });

  return { onClose };
};

describe(AgentSessionDetailsDrawer.name, () => {
  it('does not render details content while closed', () => {
    renderDrawer();

    expect(screen.queryByRole('dialog', { name: 'Session details' })).not.toBeInTheDocument();
    expect(screen.queryByText('OpenAI personal')).not.toBeInTheDocument();
  });

  it('shows session snapshot values and runner capability summary while open', () => {
    renderDrawer({ open: true });

    const dialog = screen.getByRole('dialog', { name: 'Session details' });
    expect(within(dialog).getByText('OpenAI personal')).toBeInTheDocument();
    expect(within(dialog).getByText('gpt-5.1')).toBeInTheDocument();
    expect(within(dialog).getByText('Completed')).toBeInTheDocument();
    expect(within(dialog).getByText('Careful')).toBeInTheDocument();
    expect(within(dialog).getByText('Strict')).toBeInTheDocument();
    expect(within(dialog).getByText('2026-05-14')).toBeInTheDocument();
    expect(within(dialog).getByText('yes')).toBeInTheDocument();
    expect(within(dialog).getByText('2 tools')).toBeInTheDocument();
    expect(within(dialog).getByText('2 models')).toBeInTheDocument();
    expect(within(dialog).getByText('2026-05-16T09:00:00.000Z')).toBeInTheDocument();
    expect(within(dialog).getByText('2026-05-16T09:30:00.000Z')).toBeInTheDocument();
    expect(within(dialog).getByText('2026-05-16T10:00:00.000Z')).toBeInTheDocument();
  });

  it('renders nullable fields gracefully', () => {
    renderDrawer({
      open: true,
      session: makeSession({
        runnerCapabilitiesSnapshot: null,
        runnerEndpoint: null,
        runnerSessionId: null,
        endedAt: null,
      }),
    });

    const dialog = screen.getByRole('dialog', { name: 'Session details' });
    expect(within(dialog).getByText('Runner capabilities')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Not available').length).toBeGreaterThanOrEqual(2);
  });

  it('calls the close callback from a stable accessible button', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer({ open: true });

    await user.click(screen.getByRole('button', { name: 'Close details' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Session details' })).not.toBeInTheDocument();
  });

  it('does not expose runner URLs, runner IDs, bearer tokens, or raw metadata objects', () => {
    renderDrawer({ open: true });

    const dialogText = screen.getByRole('dialog', { name: 'Session details' }).textContent ?? '';
    expect(dialogText).not.toContain('runner.internal.local');
    expect(dialogText).not.toContain('internal-runner.example.local');
    expect(dialogText).not.toContain('runner-session-secret-id');
    expect(dialogText).not.toContain('Bearer secret-token');
    expect(dialogText).not.toContain('[object Object]');
    expect(dialogText).not.toContain('requestMetadata');
  });
});
