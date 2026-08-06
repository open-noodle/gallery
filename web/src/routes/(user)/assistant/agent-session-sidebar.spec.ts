import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  type AgentSessionResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'svelte';
import { readable } from 'svelte/store';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import AgentSessionSidebar from './agent-session-sidebar.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_new_chat: 'New chat',
    assistant_chat_menu: 'Chat options',
    assistant_collapse_sessions: 'Collapse sessions',
    assistant_rename_chat_title: 'Chat title',
    assistant_search_chats: 'Search chats',
    assistant_sessions: 'Sessions',
    assistant_session_status_applying: 'Applying',
    assistant_session_status_cancelled: 'Cancelled',
    assistant_session_status_completed: 'Completed',
    assistant_session_status_failed: 'Failed',
    assistant_session_status_interrupted: 'Interrupted',
    assistant_session_status_waiting_for_plan_review: 'Waiting for plan review',
    assistant_session_status_waiting_for_tool_approval: 'Waiting for tool approval',
    assistant_session_status_running: 'Running',
    cancel: 'Cancel',
    delete: 'Delete',
    rename: 'Rename',
    save: 'Save',
  };

  return { t: readable((key: string) => messages[key] ?? key) };
});

const makeSession = (
  id: string,
  status: AgentSessionStatus,
  createdAt: string,
  overrides: Partial<AgentSessionResponseDto> = {},
): AgentSessionResponseDto => ({
  id,
  status,
  providerCredentialId: `${id}-credential`,
  credentialSnapshot: {
    id: `${id}-credential`,
    providerType: AgentProviderType.Openai,
    label: `${id} credential`,
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: { model: `${id} model`, providerCredentialId: `${id}-credential` },
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
  createdAt,
  updatedAt: createdAt,
  endedAt: null,
  ...overrides,
});

const sessions = [
  makeSession('created-newer', AgentSessionStatus.Created, '2026-05-16T12:00:00.000Z'),
  makeSession('plan', AgentSessionStatus.WaitingForPlanReview, '2026-05-16T09:00:00.000Z', {
    credentialSnapshot: {
      id: 'plan-credential',
      providerType: AgentProviderType.Anthropic,
      label: 'Anthropic work',
      baseUrl: null,
      models: ['claude-4-sonnet'],
      defaultModel: 'claude-4-sonnet',
    },
    modelSnapshot: { model: 'claude-4-sonnet', providerCredentialId: 'plan-credential' },
  }),
  makeSession('approval', AgentSessionStatus.WaitingForToolApproval, '2026-05-16T08:00:00.000Z', {
    credentialSnapshot: {
      id: 'approval-credential',
      providerType: AgentProviderType.Openai,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { model: 'gpt-5.1', providerCredentialId: 'approval-credential' },
  }),
  makeSession('running-z', AgentSessionStatus.Running, '2026-05-16T07:00:00.000Z'),
  makeSession('running-a', AgentSessionStatus.Running, '2026-05-16T07:00:00.000Z'),
  makeSession('completed', AgentSessionStatus.Completed, '2026-05-16T11:00:00.000Z'),
  makeSession('failed', AgentSessionStatus.Failed, '2026-05-16T10:00:00.000Z'),
];

const renderSidebar = (props: Partial<ComponentProps<typeof AgentSessionSidebar>> = {}) => {
  const onSelectSession = vi.fn();
  const onNewChat = vi.fn();
  const onRenameSession = vi.fn();
  const onDeleteSession = vi.fn();

  render(AgentSessionSidebar, {
    props: {
      sessions,
      selectedSessionId: 'plan',
      titleBySessionId: {
        approval: 'Approve album cleanup',
        plan: 'Review summer trip plan',
      },
      onSelectSession,
      onNewChat,
      onRenameSession,
      onDeleteSession,
      ...props,
    },
  });

  return { onDeleteSession, onNewChat, onRenameSession, onSelectSession };
};

describe(AgentSessionSidebar.name, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders New chat, accessible search, helper-sorted rows, and selected current state', () => {
    renderSidebar();

    expect(screen.getByTestId('agent-session-sidebar-new-chat')).toHaveTextContent('New chat');
    expect(screen.getByRole('searchbox', { name: 'Search chats' })).toBeInTheDocument();
    expect(screen.getByText('Recents')).toBeInTheDocument();

    const rows = screen.getAllByTestId('agent-session-row');
    expect(rows.map((row) => row.dataset.sessionId)).toEqual([
      'created-newer',
      'completed',
      'failed',
      'plan',
      'approval',
      'running-z',
      'running-a',
    ]);

    expect(screen.getByRole('button', { name: /Review summer trip plan/ })).toHaveAttribute('aria-current', 'true');
  });

  it('calls selection callbacks from row and New chat buttons', async () => {
    const user = userEvent.setup();
    const { onNewChat, onSelectSession } = renderSidebar();

    await user.click(screen.getByRole('button', { name: /Approve album cleanup/ }));
    expect(onSelectSession).toHaveBeenCalledWith('approval');

    await user.click(screen.getByTestId('agent-session-sidebar-new-chat'));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('renders an optional collapse action', async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    renderSidebar({ onCollapse });

    await user.click(screen.getByRole('button', { name: 'Collapse sessions' }));

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('filters rows by title, model, credential, visible status, and raw status without mutating the input list', async () => {
    renderSidebar();
    const originalOrder = sessions.map((session) => session.id);

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search chats' }), {
      target: { value: 'waiting for plan review' },
    });
    expect(screen.getAllByTestId('agent-session-row').map((row) => row.dataset.sessionId)).toEqual(['plan']);

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search chats' }), { target: { value: 'GPT-5.1' } });
    expect(screen.getAllByTestId('agent-session-row').map((row) => row.dataset.sessionId)).toContain('approval');

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search chats' }), {
      target: { value: 'anthropic work' },
    });
    expect(screen.getAllByTestId('agent-session-row').map((row) => row.dataset.sessionId)).toEqual(['plan']);

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search chats' }), {
      target: { value: 'Waiting for Tool Approval' },
    });
    expect(screen.getAllByTestId('agent-session-row').map((row) => row.dataset.sessionId)).toEqual(['approval']);

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search chats' }), {
      target: { value: 'waiting_for_plan_review' },
    });
    expect(screen.getAllByTestId('agent-session-row').map((row) => row.dataset.sessionId)).toEqual(['plan']);
    expect(sessions.map((session) => session.id)).toEqual(originalOrder);
  });

  it('keeps rows visually simple without visible status pills and falls back to New chat titles', () => {
    renderSidebar();

    expect(
      within(screen.getByTestId('agent-session-row-approval')).queryByText('Waiting for tool approval'),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('agent-session-row-plan')).queryByText('Waiting for plan review'),
    ).not.toBeInTheDocument();
    expect(within(screen.getByTestId('agent-session-row-running-z')).queryByText('Running')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('agent-session-row-completed')).queryByText('Completed')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('agent-session-row-failed')).queryByText('Failed')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('agent-session-row-created-newer')).queryByText('created'),
    ).not.toBeInTheDocument();
    expect(within(screen.getByTestId('agent-session-row-created-newer')).getByText('New chat')).toBeInTheDocument();
  });

  it('does not call transcript or message APIs to populate sidebar rows', () => {
    renderSidebar();

    expect(sdkMock.getAgentSessionMessages).not.toHaveBeenCalled();
    expect(sdkMock.appendAgentSessionMessage).not.toHaveBeenCalled();
  });

  it('opens a compact row menu to rename and delete sessions', async () => {
    const user = userEvent.setup();
    const { onDeleteSession, onRenameSession } = renderSidebar();

    const planRow = screen.getByTestId('agent-session-row-plan');
    await user.click(within(planRow.parentElement as HTMLElement).getByRole('button', { name: 'Chat options' }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /Rename/ }));
    await user.clear(screen.getByRole('textbox', { name: 'Chat title' }));
    await user.type(screen.getByRole('textbox', { name: 'Chat title' }), 'Renamed plan');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onRenameSession).toHaveBeenCalledWith('plan', 'Renamed plan');

    const renamedPlanRow = screen.getByTestId('agent-session-row-plan');
    await user.click(within(renamedPlanRow.parentElement as HTMLElement).getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('menuitem', { name: /Delete/ }));

    expect(onDeleteSession).toHaveBeenCalledWith('plan');
  });

  it('keeps long labels inside bounded row containers with stable sizing classes', () => {
    renderSidebar({
      sessions: [
        makeSession('long-label', AgentSessionStatus.Interrupted, '2026-05-16T12:00:00.000Z', {
          credentialSnapshot: {
            id: 'long-label-credential',
            providerType: AgentProviderType.Openai,
            label: 'A very long provider credential label that should not force the row to expand unpredictably',
            baseUrl: null,
            models: ['gpt-5.1'],
            defaultModel: 'gpt-5.1',
          },
          modelSnapshot: {
            model: 'an-extremely-long-model-name-that-still-needs-to-fit',
            providerCredentialId: 'long-label-credential',
          },
        }),
      ],
      titleBySessionId: {
        'long-label': 'A very long generated chat title that should remain visually bounded in the sidebar row',
      },
    });

    const row = screen.getByTestId('agent-session-row-long-label');
    expect(row.className).toContain('min-h-');
    expect(row.className).toContain('overflow-hidden');
    expect(within(row).getByText(/very long generated chat title/).className).toContain('truncate');
  });
});
