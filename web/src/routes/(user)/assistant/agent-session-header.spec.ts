import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  type AgentSessionResponseDto,
} from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'svelte';
import { readable } from 'svelte/store';
import AgentSessionHeader from './agent-session-header.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_approval_mode: 'Approval mode',
    assistant_approval_behavior_all_actions: 'Strict',
    assistant_close_session: 'Close session',
    assistant_details: 'Details',
    assistant_model: 'Model',
    assistant_new_chat: 'New chat',
    assistant_provider_credential: 'Provider credential',
    assistant_session_status_running: 'Running',
    assistant_session_status_waiting_for_plan_review: 'Waiting for plan review',
  };

  return { t: readable((key: string) => messages[key] ?? key) };
});

const makeSession = (overrides: Partial<AgentSessionResponseDto> = {}): AgentSessionResponseDto => ({
  id: '00000000-0000-4000-8000-000000000100',
  status: AgentSessionStatus.Running,
  providerCredentialId: '00000000-0000-4000-8000-000000000001',
  credentialSnapshot: {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: AgentProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: { model: 'gpt-5.1', providerCredentialId: '00000000-0000-4000-8000-000000000001' },
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
  permissionPreset: AgentPermissionPreset.Careful,
  approvalMode: AgentApprovalMode.Strict,
  runnerCapabilitiesSnapshot: null,
  runnerEndpoint: null,
  runnerSessionId: null,
  createdAt: '2026-05-16T09:00:00.000Z',
  updatedAt: '2026-05-16T09:30:00.000Z',
  endedAt: null,
  ...overrides,
});

const renderHeader = (props: Partial<ComponentProps<typeof AgentSessionHeader>> = {}) => {
  const onOpenDetails = vi.fn();
  const onCancel = vi.fn();

  render(AgentSessionHeader, {
    props: {
      session: makeSession(),
      title: null,
      onOpenDetails,
      ...props,
    },
  });

  return { onCancel, onOpenDetails };
};

describe(AgentSessionHeader.name, () => {
  it('renders the fallback title, status badge, provider, model, and approval mode', () => {
    renderHeader({
      session: makeSession({ status: AgentSessionStatus.WaitingForPlanReview }),
    });

    expect(screen.getByRole('heading', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByText('Waiting for plan review')).toBeInTheDocument();
    expect(screen.getByText('OpenAI personal')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.1')).toBeInTheDocument();
    expect(screen.getByText('Strict')).toBeInTheDocument();
  });

  it('renders a discovered title when provided', () => {
    renderHeader({ title: 'Organize the summer album' });

    expect(screen.getByRole('heading', { name: 'Organize the summer album' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'New chat' })).not.toBeInTheDocument();
  });

  it('keeps long title, credential, and model text in bounded elements', () => {
    renderHeader({
      title: 'A very long discovered assistant session title that should not push the action buttons off screen',
      session: makeSession({
        credentialSnapshot: {
          id: '00000000-0000-4000-8000-000000000001',
          providerType: AgentProviderType.Openai,
          label: 'A very long provider credential label that should remain visually bounded',
          baseUrl: null,
          models: ['a-very-long-model-name'],
          defaultModel: 'a-very-long-model-name',
        },
        modelSnapshot: {
          model: 'a-very-long-model-name-that-should-not-overlap-header-actions',
          providerCredentialId: '00000000-0000-4000-8000-000000000001',
        },
      }),
    });

    expect(screen.getByTestId('agent-session-header-title').className).toContain('truncate');
    expect(screen.getByTestId('agent-session-header-meta').className).toContain('min-w-0');
    expect(screen.getByTestId('agent-session-header-credential').className).toContain('truncate');
    expect(screen.getByTestId('agent-session-header-model').className).toContain('truncate');
  });

  it('allows header actions to wrap without forcing the title and metadata off screen', () => {
    renderHeader({
      onCancel: vi.fn(),
      title: 'A very long discovered assistant session title that should keep readable room',
    });

    expect(screen.getByTestId('agent-session-header').className).toContain('flex-wrap');
    expect(screen.getByTestId('agent-session-header-title-group').className).toContain('min-w-0');

    const actions = screen.getByTestId('agent-session-header-actions');
    expect(actions.className).toContain('min-w-0');
    expect(actions.className).toContain('flex-wrap');
    expect(actions.className).not.toContain('shrink-0');
  });

  it('does not render a standalone New chat button in the header actions', () => {
    renderHeader();

    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument();
  });

  it('opens details from the header pill', async () => {
    const user = userEvent.setup();
    const { onOpenDetails } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Details' }));

    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });

  it('renders pill-shaped header actions', () => {
    renderHeader({ onCancel: vi.fn() });

    expect(screen.getByRole('button', { name: 'Details' }).className).toContain('rounded-full');
    expect(screen.getByRole('button', { name: 'Close session' }).className).toContain('rounded-full');
  });

  it('does not render Cancel without a cancel callback', () => {
    renderHeader();

    expect(screen.queryByRole('button', { name: 'Close session' })).not.toBeInTheDocument();
  });

  it('fires Cancel from an accessible danger action when a callback is provided', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderHeader({ onCancel });

    await user.click(screen.getByRole('button', { name: 'Close session' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Cancel while cancellation is pending without disabling the Details button', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { onOpenDetails } = renderHeader({ cancelDisabled: true, onCancel });

    expect(screen.getByRole('button', { name: 'Close session' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Details' }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });
});
