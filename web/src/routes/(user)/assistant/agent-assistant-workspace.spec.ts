import {
  AgentApprovalMode,
  AgentMessageRole,
  AgentMessageTextBlockType,
  AgentPermissionPreset,
  AgentProviderType,
  AgentRunnerStatusReason,
  AgentSessionStatus,
  ProviderType,
  type AgentMessageResponseDto,
  type AgentProviderCredentialResponseDto,
  type AgentRunnerStatusDto,
  type AgentSessionResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { readable } from 'svelte/store';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { websocketMock } from '@test-data/mocks/websocket.mock';
import AgentAssistantWorkspace from './agent-assistant-workspace.svelte';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/stores/websocket');

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    advanced: 'Advanced',
    assistant: 'Assistant',
    assistant_add_api_key: 'Add API key',
    assistant_add_api_key_collapsed_hint:
      'Add another provider account only when you need a different key, endpoint, or local model host.',
    assistant_approval_behavior: 'Approval behavior',
    assistant_approval_behavior_apply_plans: 'Ask before applying plans',
    assistant_approval_behavior_apply_plans_description:
      'Pi can inspect your gallery to prepare suggestions, but it must show you a plan before anything changes.',
    assistant_approval_behavior_all_actions: 'Ask before all actions',
    assistant_approval_behavior_all_actions_description:
      'Pi asks before reading photo details, previews, or using any tool. Most transparent, but slower.',
    assistant_approval_behavior_skip_prompts: 'Skip approval prompts',
    assistant_approval_behavior_skip_prompts_description:
      'Pi can inspect without asking. Changes still require plan approval unless auto-apply is enabled. Local testing only.',
    assistant_approval_request: 'Approval request',
    assistant_approval_tool_calls_error: 'Unable to load approval requests',
    assistant_close_session: 'Close session',
    assistant_session_delete_error: 'Unable to delete the chat',
    assistant_change: 'Change',
    assistant_chat: 'Chat',
    assistant_chat_menu: 'Chat options',
    assistant_collapse_sessions: 'Collapse sessions',
    assistant_configured: 'Configured',
    assistant_credentials_empty_description:
      'Save a provider key once, add the models available for that key, then start a chat from here.',
    assistant_credentials_empty_title: 'Connect a model provider',
    assistant_default_model: 'Default',
    assistant_delete_api_key: 'Delete API key',
    assistant_delete_api_key_confirm_description:
      'Delete {label}? Sessions that already started keep their snapshot, but this key will no longer be available for new sessions.',
    assistant_delete_api_key_confirm_title: 'Delete this API key?',
    assistant_edit_models: 'Edit models',
    assistant_api_key_base_url: 'Base URL',
    assistant_api_key_default_model: 'Default model',
    assistant_api_key_delete_error: 'Unable to delete API key',
    assistant_api_key_deleted: 'API key deleted',
    assistant_api_key_label: 'Name',
    assistant_api_key_masked: '************',
    assistant_api_key_models: 'Models',
    assistant_api_key_models_hint: 'Add multiple model IDs to one saved key, separated by commas.',
    assistant_api_key_models_save_error: 'Unable to update models',
    assistant_api_key_models_saved: 'Models updated',
    assistant_api_key_save_error: 'Unable to save API key',
    assistant_api_key_saved: 'API key saved',
    assistant_api_key_secret: 'API key',
    assistant_api_keys: 'API keys',
    assistant_api_keys_description: 'Save one key per provider account, then add all model IDs available for that key.',
    assistant_api_keys_menu: 'Manage API keys',
    assistant_existing_api_keys: 'Existing API keys',
    assistant_healthy: 'Healthy',
    assistant_hide_api_key: 'Hide API key',
    assistant_message: 'Message',
    assistant_message_disabled_placeholder: 'This session is read-only.',
    assistant_message_disabled_terminal: 'This session has ended. Start a new chat to continue.',
    assistant_message_placeholder: 'Ask the assistant to organize your albums.',
    assistant_new_chat_placeholder: 'Ask Gallery what to do with your photos.',
    assistant_new_chat_prompt: "What's on the agenda for today?",
    assistant_runner_ready: 'Assistant ready',
    assistant_settings: 'Assistant settings',
    assistant_settings_apply_to_new_chats: 'These defaults are used when you start a new chat.',
    assistant_control: 'Assistant control',
    assistant_control_description:
      'Choose what Pi is allowed to access and when it should ask you first. Existing chats keep their original settings.',
    assistant_unavailable_banner: 'Assistant runner unavailable. Check configuration.',
    assistant_message_refresh_error: 'Message was sent, but the latest session state could not be refreshed.',
    assistant_message_resume_placeholder: 'Describe what changed or what the assistant should try next.',
    assistant_manage_api_keys: 'Manage API keys',
    assistant_manage: 'Manage',
    assistant_model: 'Model',
    assistant_model_settings_summary: '{credential} · {model}',
    assistant_model_provider: 'Model provider',
    assistant_model_selector: 'Select model',
    assistant_new_chat: 'New chat',
    assistant_details: 'Details',
    assistant_no: 'no',
    assistant_no_api_keys: 'No API keys have been added yet.',
    assistant_no_credentials_setup: 'Connect a model provider before starting a session.',
    assistant_operation_plan_empty: 'No proposed album plan yet.',
    assistant_operation_plan_loading: 'Loading proposed album plan',
    assistant_ollama_no_api_key:
      'Ollama does not require an API key. The server will save a local placeholder secret for compatibility.',
    assistant_open_sessions: 'Open sessions',
    assistant_photo_access: 'Photo access',
    assistant_api_keys_summary: 'Manage provider keys and available models',
    assistant_permission_preset_careful: 'Careful',
    assistant_permission_preset_careful_description:
      'Metadata only. No previews or original files; limited organizing actions.',
    assistant_permission_preset_careful_details:
      'Metadata only for your own library. Pi can organize albums/spaces, set covers, favorites, and tags, but cannot see previews/original files or remove/archive/edit photos.',
    assistant_permission_preset_local_power_user: 'Local power user',
    assistant_permission_preset_local_power_user_description:
      'Metadata, previews, and limited originals for trusted local use.',
    assistant_permission_preset_local_power_user_details:
      'Metadata, previews, and limited original-file access for local trusted use. Pi can use the full organization/editing toolset across your library and shared spaces.',
    assistant_permission_preset_visual_organizer: 'Visual organizer',
    assistant_permission_preset_visual_organizer_description:
      'Metadata and previews. Full organizing actions, no original files.',
    assistant_permission_preset_visual_organizer_details:
      'Metadata and previews for your library and shared spaces. Pi can visually curate, organize, edit, favorite, archive, and tag photos, but cannot access original files.',
    assistant_protocol: 'Protocol {protocol}',
    assistant_provider_credential: 'Provider credential',
    assistant_provider_type: 'Provider',
    assistant_runner: 'Runner {version}',
    assistant_runner_healthy: 'Runner healthy',
    assistant_search_chats: 'Search chats',
    assistant_selected_session: 'Selected session',
    assistant_resume: 'Resume',
    assistant_rename_chat_title: 'Chat title',
    assistant_send: 'Send',
    assistant_session_cancel_error: 'Unable to cancel assistant session',
    assistant_session_created: 'Assistant session started',
    assistant_session_setup: 'Session setup',
    assistant_session_status_completed: 'Completed',
    assistant_session_status_created: 'Created',
    assistant_session_status_cancelled: 'Cancelled',
    assistant_session_status_interrupted: 'Interrupted',
    assistant_session_status_running: 'Running',
    assistant_session_status_waiting_for_plan_review: 'Waiting for plan review',
    assistant_sessions: 'Sessions',
    assistant_secret_not_retrievable: 'Saved key is encrypted and cannot be displayed.',
    assistant_save_api_key: 'Save API key',
    assistant_show_api_key: 'Show API key',
    assistant_start_session: 'Start session',
    assistant_start_new_chat: 'Start new chat',
    assistant_streaming: 'Streaming',
    assistant_subtitle: 'Album organization assistant',
    assistant_yes: 'yes',
    status: 'Status',
    cancel: 'Cancel',
    close: 'Close',
    delete: 'Delete',
    rename: 'Rename',
    save: 'Save',
    assistant_timeline_understanding: 'Understanding request…',
    assistant_timeline_thinking: 'Thinking…',
    assistant_timeline_verb_searching: 'Searching photos…',
    assistant_timeline_verb_browsing_albums: 'Browsing albums…',
    assistant_timeline_steps_one: '1 step',
    assistant_timeline_steps: '{steps} steps',
    assistant_timeline_failed_count: '{count} failed',
    assistant_timeline_cancelled: 'cancelled',
    assistant_timeline_denied: 'denied',
    assistant_timeline_request: 'Request',
    assistant_timeline_response: 'Response',
    assistant_timeline_error: 'Error',
    assistant_timeline_router_matched: 'Matched workflow {workflow} via {via}',
    assistant_timeline_router_none: 'No workflow matched (via {via})',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{protocol}', String(options?.values?.protocol ?? ''))
        .replace('{version}', String(options?.values?.version ?? ''))
        .replace('{credential}', String(options?.values?.credential ?? ''))
        .replace('{model}', String(options?.values?.model ?? ''))
        .replace('{label}', String(options?.values?.label ?? '')),
    ),
  };
});

const healthyRunner: AgentRunnerStatusDto = {
  configured: true,
  healthy: true,
  reason: AgentRunnerStatusReason.Healthy,
  version: '0.1.0',
  capabilities: {
    protocolVersion: '2026-05-14',
    streaming: true,
    tools: [],
    models: [],
  },
  checkedAt: '2026-05-14T00:00:00.000Z',
};

const unavailableRunner: AgentRunnerStatusDto = {
  configured: true,
  healthy: false,
  reason: AgentRunnerStatusReason.Timeout,
  version: null,
  capabilities: null,
  checkedAt: '2026-05-14T00:00:00.000Z',
};

const credentials: AgentProviderCredentialResponseDto[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: ProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    lastUsedAt: null,
  },
];

const makeSession = (overrides: Partial<AgentSessionResponseDto> = {}): AgentSessionResponseDto => {
  const id = overrides.id ?? '00000000-0000-4000-8000-000000000100';

  return {
    id,
    status: AgentSessionStatus.Created,
    providerCredentialId: credentials[0].id,
    credentialSnapshot: {
      id: credentials[0].id,
      providerType: AgentProviderType.Openai,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { model: 'gpt-5.1', providerCredentialId: credentials[0].id },
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
    runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
    runnerEndpoint: 'http://agent-runner:4477',
    runnerSessionId: `stub-${id}`,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    endedAt: null,
    ...overrides,
  };
};

const makeMessage = (sessionId: string, text: string): AgentMessageResponseDto => ({
  id: `${sessionId}-message`,
  sessionId,
  role: AgentMessageRole.Assistant,
  providerMessageId: null,
  toolCallId: null,
  content: {
    blocks: [{ type: AgentMessageTextBlockType.Text, text }],
  },
  createdAt: '2026-05-14T00:00:00.000Z',
});

const makeUserMessage = (sessionId: string, text: string): AgentMessageResponseDto => ({
  ...makeMessage(sessionId, text),
  role: AgentMessageRole.User,
});

const requestedSession = makeSession({
  id: '00000000-0000-4000-8000-000000000200',
  status: AgentSessionStatus.Completed,
  createdAt: '2026-05-15T00:00:00.000Z',
});

const actionableSession = makeSession({
  id: '00000000-0000-4000-8000-000000000300',
  status: AgentSessionStatus.Running,
  createdAt: '2026-05-16T00:00:00.000Z',
});

describe(AgentAssistantWorkspace.name, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    history.replaceState(null, '', '/assistant');
    gotoMock.mockResolvedValue(undefined);
    websocketMock.websocketEvents.on.mockReturnValue(vi.fn());
    sdkMock.getAgentSessionMessages.mockResolvedValue([]);
    sdkMock.getCurrentOperationPlan.mockResolvedValue(null);
    sdkMock.getToolCalls.mockResolvedValue([]);
    sdkMock.validateAgentSession.mockResolvedValue(undefined as never);
    sdkMock.createAgentSession.mockResolvedValue(actionableSession);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(makeUserMessage(actionableSession.id, 'Start organizing'));
    sdkMock.createAgentProviderCredential.mockResolvedValue(credentials[0]);
    sdkMock.getAgentProviderCredentials.mockResolvedValue(credentials);
    sdkMock.updateAgentProviderCredential.mockResolvedValue(credentials[0]);
    sdkMock.deleteAgentProviderCredential.mockResolvedValue(undefined as never);
    sdkMock.updateAgentSession.mockResolvedValue({ ...actionableSession, title: 'Renamed chat' });
    sdkMock.deleteAgentSession.mockResolvedValue(undefined as never);
  });

  it('selects a valid requested session and mounts chat and plan panels for it', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([makeMessage(requestedSession.id, 'Existing transcript')]);

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: requestedSession.id,
      },
    });

    expect(screen.queryByRole('heading', { name: 'Selected session' })).not.toBeInTheDocument();
    expect(await screen.findByText('Existing transcript')).toBeInTheDocument();
    expect(screen.queryByText('No proposed album plan yet.')).not.toBeInTheDocument();
    expect(gotoMock).not.toHaveBeenCalled();
    expect(sdkMock.getAgentSessionMessages).toHaveBeenCalledWith({ id: requestedSession.id });
    expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledWith({ id: requestedSession.id });
  });

  it('opens the assistant page to a fresh new chat even when previous sessions exist', () => {
    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [requestedSession, actionableSession],
        requestedSessionId: null,
      },
    });

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByTestId(`agent-session-row-${actionableSession.id}`)).not.toHaveAttribute('aria-current');
    expect(gotoMock).not.toHaveBeenCalledWith(
      `/assistant?session=${actionableSession.id}`,
      expect.objectContaining({ replaceState: true }),
    );
  });

  it('opens a fresh new chat when the requested session is unknown', () => {
    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [requestedSession, actionableSession],
        requestedSessionId: '00000000-0000-4000-8000-00000000dead',
      },
    });

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByTestId(`agent-session-row-${actionableSession.id}`)).not.toHaveAttribute('aria-current');
    expect(gotoMock).toHaveBeenCalledWith('/assistant', expect.objectContaining({ replaceState: true }));
  });

  it('uses push-style navigation when a user selects a session from a no-query new-chat state', async () => {
    const user = userEvent.setup();

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [requestedSession],
        requestedSessionId: null,
      },
    });

    await user.click(screen.getByTestId(`agent-session-row-${requestedSession.id}`));
    await tick();
    await tick();

    expect(gotoMock).toHaveBeenCalledTimes(1);
    expect(gotoMock).toHaveBeenCalledWith(
      `/assistant?session=${requestedSession.id}`,
      expect.objectContaining({ replaceState: false }),
    );
  });

  it('opens a chat-first new session surface without setup or runner detail cards', () => {
    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    expect(screen.queryByRole('heading', { name: 'Session setup' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('assistant-status-reason')).not.toBeInTheDocument();
    expect(screen.getByTestId('assistant-empty-chat-surface')).toHaveClass('justify-center');
    expect(screen.getByTestId('assistant-empty-chat-heading')).toHaveClass('text-center');
    expect(screen.getByRole('heading', { name: "What's on the agenda for today?" })).toBeInTheDocument();
    expect(screen.queryByText('Album organization assistant')).not.toBeInTheDocument();
    expect(screen.getByTestId('assistant-new-chat-composer')).toHaveClass('mt-4');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
      'placeholder',
      'Ask Gallery what to do with your photos.',
    );
    const settingsButton = screen.getByRole('button', { name: 'Assistant settings' });
    expect(screen.queryByRole('button', { name: 'Assistant ready' })).not.toBeInTheDocument();
    expect(settingsButton).toHaveAttribute('data-testid', 'assistant-settings-menu');
    expect(settingsButton.closest('header')).toBeInTheDocument();
  });

  it('creates a default session from the first message and sends the message immediately', async () => {
    const user = userEvent.setup();
    const createdSession = makeSession({
      id: '00000000-0000-4000-8000-000000000400',
      status: AgentSessionStatus.Running,
    });
    sdkMock.createAgentSession.mockResolvedValue(createdSession);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(
      makeUserMessage(createdSession.id, 'Make an album from last weekend'),
    );

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Make an album from last weekend');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(sdkMock.createAgentSession).toHaveBeenCalledWith({
        agentSessionCreateDto: {
          providerCredentialId: credentials[0].id,
          model: 'gpt-5.1',
          permissionPreset: AgentPermissionPreset.Careful,
          approvalMode: AgentApprovalMode.PlanOnly,
        },
      }),
    );
    await waitFor(() =>
      expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith({
        id: createdSession.id,
        agentMessageCreateDto: {
          content: {
            blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Make an album from last weekend' }],
          },
        },
      }),
    );
    expect(screen.getByTestId(`agent-session-row-${createdSession.id}`)).toHaveAttribute('aria-current', 'true');
    expect(gotoMock).toHaveBeenCalledWith(
      `/assistant?session=${createdSession.id}`,
      expect.objectContaining({ replaceState: false }),
    );
  });

  it('creates a default session from the first message when Enter is pressed', async () => {
    const createdSession = makeSession({
      id: '00000000-0000-4000-8000-000000000400',
      status: AgentSessionStatus.Running,
    });
    sdkMock.createAgentSession.mockResolvedValue(createdSession);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(makeUserMessage(createdSession.id, 'Make an album'));

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    const input = screen.getByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Make an album' } });
    const wasNotCancelled = await fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(wasNotCancelled).toBe(false);
    await waitFor(() => expect(sdkMock.createAgentSession).toHaveBeenCalledTimes(1));
    expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith({
      id: createdSession.id,
      agentMessageCreateDto: {
        content: {
          blocks: [{ type: AgentMessageTextBlockType.Text, text: 'Make an album' }],
        },
      },
    });
  });

  it('selects the new session and shows the chat after the first message is sent', async () => {
    const user = userEvent.setup();
    const createdSession = makeSession({
      id: '00000000-0000-4000-8000-000000000400',
      status: AgentSessionStatus.Running,
    });
    let resolveAppend: (message: AgentMessageResponseDto) => void;
    sdkMock.createAgentSession.mockResolvedValue(createdSession);
    sdkMock.appendAgentSessionMessage.mockReturnValue(
      new Promise<AgentMessageResponseDto>((resolve) => {
        resolveAppend = resolve;
      }),
    );

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Make an album from last weekend');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByTestId(`agent-session-row-${createdSession.id}`)).toHaveAttribute('aria-current', 'true');

    const transcript = await screen.findByTestId('agent-session-chat-transcript');
    resolveAppend!(makeUserMessage(createdSession.id, 'Make an album from last weekend'));
    expect(await within(transcript).findByText('Make an album from last weekend')).toBeInTheDocument();
    // After message arrives, the running timeline is shown
    expect(screen.getByTestId('agent-turn-timeline')).toBeInTheDocument();
  });

  it('uses permissions selected from the three-dot menu when creating the next session', async () => {
    const user = userEvent.setup();
    const createdSession = makeSession({
      id: '00000000-0000-4000-8000-000000000401',
      status: AgentSessionStatus.Running,
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.Strict,
    });
    sdkMock.createAgentSession.mockResolvedValue(createdSession);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(makeUserMessage(createdSession.id, 'Organize screenshots'));

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Assistant settings' }));
    const settingsDialog = screen.getByRole('dialog', { name: 'Assistant settings' });
    await user.click(within(settingsDialog).getByRole('button', { name: 'Change assistant control' }));
    await user.click(within(settingsDialog).getByRole('radio', { name: /Visual organizer/ }));
    await user.click(within(settingsDialog).getByRole('radio', { name: /Ask before all actions/ }));
    await user.click(within(settingsDialog).getByRole('button', { name: 'Close' }));

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Organize screenshots');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(sdkMock.createAgentSession).toHaveBeenCalledWith({
        agentSessionCreateDto: expect.objectContaining({
          permissionPreset: AgentPermissionPreset.VisualOrganizer,
          approvalMode: AgentApprovalMode.Strict,
        }),
      }),
    );
  });

  it('opens assistant settings as compact rows with assistant control collapsed by default', async () => {
    const user = userEvent.setup();

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Assistant settings' }));
    const settingsDialog = screen.getByRole('dialog', { name: 'Assistant settings' });

    expect(within(settingsDialog).getByRole('heading', { name: 'Model' })).toBeInTheDocument();
    expect(within(settingsDialog).getByText('OpenAI personal · gpt-5.1')).toBeInTheDocument();
    expect(within(settingsDialog).getByText('Manage provider keys and available models')).toBeInTheDocument();
    expect(within(settingsDialog).getByRole('heading', { name: 'Assistant control' })).toBeInTheDocument();
    expect(within(settingsDialog).getByText('Careful · Ask before applying plans')).toBeInTheDocument();
    expect(within(settingsDialog).getByText('These defaults are used when you start a new chat.')).toBeInTheDocument();

    expect(within(settingsDialog).queryByRole('group', { name: 'Photo access' })).not.toBeInTheDocument();
    expect(within(settingsDialog).queryByRole('group', { name: 'Approval behavior' })).not.toBeInTheDocument();
    expect(within(settingsDialog).queryByText(/no original files/i)).not.toBeInTheDocument();
    expect(within(settingsDialog).queryByText(/must show you a plan/i)).not.toBeInTheDocument();

    const manageApiKeysButton = within(settingsDialog).getByRole('button', { name: 'Manage API keys' });
    expect(manageApiKeysButton).toHaveClass('whitespace-nowrap');
  });

  it('expands assistant control settings into descriptive radio choices', async () => {
    const user = userEvent.setup();

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Assistant settings' }));
    const settingsDialog = screen.getByRole('dialog', { name: 'Assistant settings' });
    await user.click(within(settingsDialog).getByRole('button', { name: 'Change assistant control' }));

    expect(within(settingsDialog).getByRole('group', { name: 'Photo access' })).toBeInTheDocument();
    expect(within(settingsDialog).getByRole('group', { name: 'Approval behavior' })).toBeInTheDocument();

    expect(within(settingsDialog).getByRole('radio', { name: /Careful/ })).toBeChecked();
    expect(within(settingsDialog).getByRole('radio', { name: /Ask before applying plans/ })).toBeChecked();
    expect(within(settingsDialog).getByText(/Metadata only/i)).toBeInTheDocument();
    expect(within(settingsDialog).getByText(/Metadata and previews/i)).toBeInTheDocument();
    expect(within(settingsDialog).getByText(/limited originals/i)).toBeInTheDocument();
    expect(within(settingsDialog).getByLabelText(/cannot see previews/i)).toBeInTheDocument();
    expect(within(settingsDialog).getByLabelText(/visually curate/i)).toBeInTheDocument();
    expect(within(settingsDialog).getByLabelText(/full organization\/editing toolset/i)).toBeInTheDocument();
    expect(within(settingsDialog).getByText(/Most transparent, but slower/i)).toBeInTheDocument();
    expect(within(settingsDialog).getByText(/must show you a plan/i)).toBeInTheDocument();
    expect(within(settingsDialog).queryByText('Advanced')).not.toBeInTheDocument();
    expect(within(settingsDialog).queryByRole('radio', { name: /Skip approval prompts/ })).not.toBeInTheDocument();

    expect(within(settingsDialog).queryByText('Permission preset')).not.toBeInTheDocument();
    expect(within(settingsDialog).queryByText('Strict')).not.toBeInTheDocument();
    expect(within(settingsDialog).queryByText('Ask on escalation')).not.toBeInTheDocument();
  });

  it('ignores old skip-approval defaults when creating the next session', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'gallery.assistant.defaults',
      JSON.stringify({ approvalMode: AgentApprovalMode.DangerouslySkipPermissions }),
    );
    const createdSession = makeSession({
      id: '00000000-0000-4000-8000-000000000403',
      status: AgentSessionStatus.Running,
      approvalMode: AgentApprovalMode.PlanOnly,
    });
    sdkMock.createAgentSession.mockResolvedValue(createdSession);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(makeUserMessage(createdSession.id, 'Organize screenshots'));

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Organize screenshots');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(sdkMock.createAgentSession).toHaveBeenCalledWith({
        agentSessionCreateDto: expect.objectContaining({
          approvalMode: AgentApprovalMode.PlanOnly,
        }),
      }),
    );
  });

  it('uses the provider and model selected from assistant settings when creating the next session', async () => {
    const user = userEvent.setup();
    const modelCredentials: AgentProviderCredentialResponseDto[] = [
      {
        ...credentials[0],
        models: ['gpt-5.1', 'gpt-5.1-mini'],
        defaultModel: 'gpt-5.1',
      },
    ];
    const createdSession = makeSession({
      id: '00000000-0000-4000-8000-000000000402',
      status: AgentSessionStatus.Running,
      modelSnapshot: { model: 'gpt-5.1-mini', providerCredentialId: credentials[0].id },
    });
    sdkMock.createAgentSession.mockResolvedValue(createdSession);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(makeUserMessage(createdSession.id, 'Use the fast model'));

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials: modelCredentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Assistant settings' }));
    await user.click(screen.getByRole('button', { name: 'Change model' }));
    await user.selectOptions(screen.getByLabelText('Model'), 'gpt-5.1-mini');
    await user.click(
      within(screen.getByRole('dialog', { name: 'Assistant settings' })).getByRole('button', { name: 'Close' }),
    );

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Use the fast model');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(sdkMock.createAgentSession).toHaveBeenCalledWith({
        agentSessionCreateDto: expect.objectContaining({
          providerCredentialId: credentials[0].id,
          model: 'gpt-5.1-mini',
        }),
      }),
    );
    expect(JSON.parse(localStorage.getItem('gallery.assistant.defaults') ?? '{}')).toMatchObject({
      credentialId: credentials[0].id,
      model: 'gpt-5.1-mini',
    });
  });

  it('keeps healthy runner status hidden but exposes unhealthy runner details on demand', async () => {
    const user = userEvent.setup();

    const healthyView = render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    expect(screen.queryByRole('button', { name: 'Assistant ready' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Assistant runner unavailable. Check configuration.' }),
    ).not.toBeInTheDocument();

    await healthyView.rerender({
      runnerStatus: unavailableRunner,
      credentials,
      sessions: [],
      requestedSessionId: null,
    });

    const problemButton = screen.getByRole('button', { name: 'Assistant runner unavailable. Check configuration.' });
    expect(problemButton).toBeInTheDocument();
    await user.click(problemButton);

    expect(screen.getByRole('status')).toHaveTextContent('Assistant runner unavailable. Check configuration.');
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('no')).toBeInTheDocument();
  });

  it('keeps the composer visible but blocks sending with an inline runner-unavailable banner', () => {
    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: unavailableRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    expect(screen.queryByRole('heading', { name: 'Session setup' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Assistant runner unavailable. Check configuration.');
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Assistant runner unavailable. Check configuration.' }),
    ).toBeInTheDocument();
  });

  it('switches selected sessions through the sidebar and syncs the URL query', async () => {
    const user = userEvent.setup();

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: actionableSession.id,
      },
    });

    await user.click(screen.getByTestId('agent-session-sidebar-new-chat'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(gotoMock).toHaveBeenCalledWith('/assistant', expect.objectContaining({ replaceState: false }));

    await user.click(screen.getByTestId(`agent-session-row-${actionableSession.id}`));
    expect(gotoMock).toHaveBeenLastCalledWith(
      expect.stringContaining(`session=${actionableSession.id}`),
      expect.objectContaining({ replaceState: false }),
    );
  });

  it('renames a session through the sidebar menu and uses the persisted title', async () => {
    const user = userEvent.setup();
    const renamedSession = { ...actionableSession, title: 'Curated album cleanup' };
    sdkMock.updateAgentSession.mockResolvedValue(renamedSession);

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession],
        requestedSessionId: actionableSession.id,
      },
    });

    const row = screen.getByTestId(`agent-session-row-${actionableSession.id}`);
    await user.click(within(row.parentElement as HTMLElement).getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('menuitem', { name: /Rename/ }));
    await user.clear(screen.getByRole('textbox', { name: 'Chat title' }));
    await user.type(screen.getByRole('textbox', { name: 'Chat title' }), 'Curated album cleanup');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(sdkMock.updateAgentSession).toHaveBeenCalledWith({
        id: actionableSession.id,
        agentSessionUpdateDto: { title: 'Curated album cleanup' },
      }),
    );
    expect(screen.getByTestId(`agent-session-row-${actionableSession.id}`)).toHaveTextContent('Curated album cleanup');
  });

  it('deletes the selected session through the sidebar menu and returns to the new chat composer', async () => {
    const user = userEvent.setup();

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: actionableSession.id,
      },
    });

    const row = screen.getByTestId(`agent-session-row-${actionableSession.id}`);
    await user.click(within(row.parentElement as HTMLElement).getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('menuitem', { name: /Delete/ }));

    await waitFor(() => expect(sdkMock.deleteAgentSession).toHaveBeenCalledWith({ id: actionableSession.id }));
    expect(screen.queryByTestId(`agent-session-row-${actionableSession.id}`)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(gotoMock).toHaveBeenLastCalledWith('/assistant', expect.objectContaining({ replaceState: false }));
  });

  it('removes the chat locally when the server reports it already deleted', async () => {
    const user = userEvent.setup();
    sdkMock.deleteAgentSession.mockRejectedValue({ status: 400, message: 'Agent session not found' });

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: actionableSession.id,
      },
    });

    const row = screen.getByTestId(`agent-session-row-${actionableSession.id}`);
    await user.click(within(row.parentElement as HTMLElement).getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('menuitem', { name: /Delete/ }));

    await waitFor(() =>
      expect(screen.queryByTestId(`agent-session-row-${actionableSession.id}`)).not.toBeInTheDocument(),
    );
  });

  it('keeps the chat when deletion genuinely fails', async () => {
    const user = userEvent.setup();
    sdkMock.deleteAgentSession.mockRejectedValue({ status: 500, message: 'boom' });

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: actionableSession.id,
      },
    });

    const row = screen.getByTestId(`agent-session-row-${actionableSession.id}`);
    await user.click(within(row.parentElement as HTMLElement).getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('menuitem', { name: /Delete/ }));

    await waitFor(() => expect(sdkMock.deleteAgentSession).toHaveBeenCalled());
    expect(screen.getByTestId(`agent-session-row-${actionableSession.id}`)).toBeInTheDocument();
  });

  it('re-syncs the session list from the server after a delete', async () => {
    const user = userEvent.setup();
    sdkMock.getAgentSessions.mockResolvedValue([requestedSession]);

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: actionableSession.id,
      },
    });

    const row = screen.getByTestId(`agent-session-row-${actionableSession.id}`);
    await user.click(within(row.parentElement as HTMLElement).getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('menuitem', { name: /Delete/ }));

    await waitFor(() => expect(sdkMock.getAgentSessions).toHaveBeenCalled());
    expect(screen.queryByTestId(`agent-session-row-${actionableSession.id}`)).not.toBeInTheDocument();
  });

  it('keeps the explicit new-chat state when the URL query is cleared', async () => {
    const user = userEvent.setup();

    const view = render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: actionableSession.id,
      },
    });

    await user.click(screen.getByTestId('agent-session-sidebar-new-chat'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();

    await view.rerender({
      runnerStatus: healthyRunner,
      credentials,
      sessions: [actionableSession, requestedSession],
      requestedSessionId: null,
    });

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByTestId(`agent-session-row-${actionableSession.id}`)).not.toHaveAttribute('aria-current');
  });

  it('collapses and restores the desktop sessions panel', async () => {
    const user = userEvent.setup();

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: actionableSession.id,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Collapse sessions' }));

    expect(screen.queryByRole('searchbox', { name: 'Search chats' })).not.toBeInTheDocument();

    await user.click(screen.getByTestId('agent-session-sidebar-expand'));

    expect(screen.getByRole('searchbox', { name: 'Search chats' })).toBeInTheDocument();
  });

  it('manages provider keys and model lists from the workspace menu', async () => {
    const user = userEvent.setup();
    const createdCredential: AgentProviderCredentialResponseDto = {
      ...credentials[0],
      id: '00000000-0000-4000-8000-000000000009',
      label: 'OpenAI work',
      models: ['gpt-5.1', 'gpt-5.2'],
      defaultModel: 'gpt-5.2',
    };
    const updatedCredential: AgentProviderCredentialResponseDto = {
      ...credentials[0],
      models: ['gpt-5.1', 'gpt-5.2', 'gpt-5.2-mini'],
    };
    sdkMock.createAgentProviderCredential.mockResolvedValue(createdCredential);
    sdkMock.getAgentProviderCredentials
      .mockResolvedValueOnce([updatedCredential])
      .mockResolvedValueOnce([createdCredential]);
    sdkMock.updateAgentProviderCredential.mockResolvedValue(updatedCredential);

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Assistant settings' }));
    await user.click(screen.getByRole('button', { name: 'Manage API keys' }));

    const settingsDialog = screen.getByRole('dialog', { name: 'Assistant settings' });
    expect(screen.queryByRole('dialog', { name: 'API keys' })).not.toBeInTheDocument();
    expect(within(settingsDialog).getByRole('heading', { name: 'Existing API keys' })).toBeInTheDocument();
    expect(within(settingsDialog).getAllByText('OpenAI personal')).not.toHaveLength(0);
    expect(screen.getByTestId(`agent-api-key-secret-${credentials[0].id}`)).toHaveTextContent('************');

    await user.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(screen.getByText('Saved key is encrypted and cannot be displayed.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit models' }));
    await user.clear(screen.getByLabelText(`${credentials[0].label} Models`));
    await user.type(screen.getByLabelText(`${credentials[0].label} Models`), 'gpt-5.1, gpt-5.2, gpt-5.2-mini');
    await user.selectOptions(screen.getByLabelText(`${credentials[0].label} Default model`), 'gpt-5.2-mini');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(sdkMock.updateAgentProviderCredential).toHaveBeenCalledWith({
        id: credentials[0].id,
        agentProviderCredentialUpdateDto: {
          models: ['gpt-5.1', 'gpt-5.2', 'gpt-5.2-mini'],
          defaultModel: 'gpt-5.2-mini',
        },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Add API key' }));
    await user.selectOptions(screen.getByLabelText('Provider'), ProviderType.Openai);
    await user.type(screen.getByLabelText('Name'), 'OpenAI work');
    await user.type(screen.getByLabelText('API key'), 'sk-test');
    await user.type(screen.getByLabelText('Models'), 'gpt-5.1, gpt-5.2');
    await user.type(screen.getByLabelText('Default model'), 'gpt-5.2');
    await user.click(screen.getByRole('button', { name: 'Save API key' }));

    await waitFor(() =>
      expect(sdkMock.createAgentProviderCredential).toHaveBeenCalledWith({
        agentProviderCredentialCreateDto: {
          providerType: ProviderType.Openai,
          label: 'OpenAI work',
          secret: 'sk-test',
          baseUrl: undefined,
          models: ['gpt-5.1', 'gpt-5.2'],
          defaultModel: 'gpt-5.2',
        },
      }),
    );
    expect(await screen.findAllByText('OpenAI work')).not.toHaveLength(0);
  });

  it('adds Ollama credentials without asking for an API key', async () => {
    const user = userEvent.setup();
    const createdCredential: AgentProviderCredentialResponseDto = {
      ...credentials[0],
      id: '00000000-0000-4000-8000-000000000010',
      providerType: ProviderType.OpenaiCompatible,
      label: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      models: ['llama3.2'],
      defaultModel: 'llama3.2',
    };
    sdkMock.createAgentProviderCredential.mockResolvedValue(createdCredential);
    sdkMock.getAgentProviderCredentials.mockResolvedValue([createdCredential]);

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Assistant settings' }));
    // With an existing credential, the settings API-keys section opens in manage mode; add a second key from there.
    await user.click(screen.getByRole('button', { name: 'Manage API keys' }));
    await user.click(screen.getByRole('button', { name: 'Add API key' }));

    const settingsDialog = screen.getByRole('dialog', { name: 'Assistant settings' });
    expect(screen.queryByRole('dialog', { name: 'API keys' })).not.toBeInTheDocument();
    expect(within(settingsDialog).getByRole('heading', { name: 'Add API key' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Provider'), 'ollama');

    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    expect(screen.getByText(/Ollama does not require an API key/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Ollama');
    expect(screen.getByLabelText('Base URL')).toHaveValue('http://localhost:11434/v1');

    await user.type(screen.getByLabelText('Models'), 'llama3.2');
    await user.type(screen.getByLabelText('Default model'), 'llama3.2');
    await user.click(screen.getByRole('button', { name: 'Save API key' }));

    await waitFor(() =>
      expect(sdkMock.createAgentProviderCredential).toHaveBeenCalledWith({
        agentProviderCredentialCreateDto: {
          providerType: ProviderType.OpenaiCompatible,
          label: 'Ollama',
          secret: 'ollama',
          baseUrl: 'http://localhost:11434/v1',
          models: ['llama3.2'],
          defaultModel: 'llama3.2',
        },
      }),
    );
    await user.click(within(settingsDialog).getByRole('button', { name: 'Close' }));
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Use local model');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(sdkMock.createAgentSession).toHaveBeenCalledWith({
        agentSessionCreateDto: expect.objectContaining({
          providerCredentialId: createdCredential.id,
          model: 'llama3.2',
        }),
      }),
    );
  });

  it('deletes a configured API key entry after confirmation', async () => {
    const user = userEvent.setup();
    sdkMock.getAgentProviderCredentials.mockResolvedValue([]);

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Assistant settings' }));
    await user.click(screen.getByRole('button', { name: 'Manage API keys' }));
    await user.click(screen.getByRole('button', { name: 'Delete API key' }));

    expect(screen.getByText('Delete this API key?')).toBeInTheDocument();
    expect(screen.getByText(/Delete OpenAI personal/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(sdkMock.deleteAgentProviderCredential).toHaveBeenCalledWith({ id: credentials[0].id }));
    expect(sdkMock.getAgentProviderCredentials).toHaveBeenCalled();
    expect(await screen.findByText('No API keys have been added yet.')).toBeInTheDocument();
    // After all credentials are deleted, the onboarding flow replaces the composer.
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'assistant_onboarding_get_started' })).toBeInTheDocument();
  });

  it('opens API key management from assistant settings when credentials already exist', async () => {
    const user = userEvent.setup();

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Assistant settings' }));
    await user.click(screen.getByRole('button', { name: 'Manage API keys' }));

    const settingsDialog = screen.getByRole('dialog', { name: 'Assistant settings' });
    expect(screen.queryByRole('dialog', { name: 'API keys' })).not.toBeInTheDocument();
    expect(within(settingsDialog).getByRole('heading', { name: 'Existing API keys' })).toBeInTheDocument();
    expect(within(settingsDialog).getAllByText('OpenAI personal')).not.toHaveLength(0);
  });

  it('shows the onboarding flow when there are no credentials and the runner is healthy', () => {
    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials: [],
        sessions: [],
        requestedSessionId: null,
      },
    });
    expect(screen.getByRole('button', { name: 'assistant_onboarding_get_started' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
    // Chat chrome (sidebar toggle + settings menu) is hidden during first-run setup.
    expect(screen.queryByTestId('assistant-settings-menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'assistant_open_sessions' })).not.toBeInTheDocument();
  });

  it('shows the normal composer when a credential exists, not onboarding', () => {
    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'assistant_onboarding_get_started' })).not.toBeInTheDocument();
    expect(screen.getByTestId('assistant-settings-menu')).toBeInTheDocument();
  });

  it('adds a newly created session from the first message to the sidebar and selects it', async () => {
    const createdSession = makeSession({
      id: '00000000-0000-4000-8000-000000000400',
      status: AgentSessionStatus.Running,
    });
    sdkMock.createAgentSession.mockResolvedValue(createdSession);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(makeUserMessage(createdSession.id, 'Start organizing'));

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Start organizing' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findAllByRole('heading', { name: 'New chat' })).not.toHaveLength(0);
    await waitFor(() =>
      expect(sdkMock.appendAgentSessionMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: createdSession.id,
        }),
      ),
    );
    expect(screen.getByTestId(`agent-session-row-${createdSession.id}`)).toHaveAttribute('aria-current', 'true');
    expect(gotoMock).toHaveBeenCalledWith(
      `/assistant?session=${createdSession.id}`,
      expect.objectContaining({ replaceState: false }),
    );
  });

  it('persists the first message as the session title so it survives reloads', async () => {
    const createdSession = makeSession({
      id: '00000000-0000-4000-8000-000000000401',
      status: AgentSessionStatus.Running,
    });
    sdkMock.createAgentSession.mockResolvedValue(createdSession);
    sdkMock.appendAgentSessionMessage.mockResolvedValue(makeUserMessage(createdSession.id, 'Start organizing'));
    sdkMock.updateAgentSession.mockResolvedValue({ ...createdSession, title: 'Start organizing' });

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [],
        requestedSessionId: null,
      },
    });

    await fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Start organizing' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(sdkMock.updateAgentSession).toHaveBeenCalledWith({
        id: createdSession.id,
        agentSessionUpdateDto: { title: 'Start organizing' },
      }),
    );
  });

  it('updates the selected header and matching sidebar row from the selected transcript title', async () => {
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeUserMessage(requestedSession.id, 'Create a Porto family highlights album'),
    ]);

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: requestedSession.id,
      },
    });

    expect(await screen.findAllByRole('heading', { name: 'Create a Porto family highlights album' })).not.toHaveLength(
      0,
    );
    expect(screen.getByRole('button', { name: /Create a Porto family highlights album/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('lets sidebar search find a newly discovered selected-session title', async () => {
    const user = userEvent.setup();
    sdkMock.getAgentSessionMessages.mockResolvedValue([
      makeUserMessage(requestedSession.id, 'Find all mountain birthday photos'),
    ]);

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: requestedSession.id,
      },
    });

    expect(await screen.findByRole('button', { name: /Find all mountain birthday photos/ })).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'mountain birthday');

    expect(screen.getByTestId(`agent-session-row-${requestedSession.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`agent-session-row-${actionableSession.id}`)).not.toBeInTheDocument();
  });

  it('keeps discovered titles cached after switching sessions', async () => {
    const user = userEvent.setup();
    sdkMock.getAgentSessionMessages.mockImplementation(({ id }) =>
      Promise.resolve([
        makeUserMessage(
          id,
          id === requestedSession.id ? 'Review archived wedding favorites' : 'Prepare current cleanup plan',
        ),
      ]),
    );

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: requestedSession.id,
      },
    });

    expect(await screen.findAllByRole('heading', { name: 'Review archived wedding favorites' })).not.toHaveLength(0);

    await user.click(screen.getByTestId(`agent-session-row-${actionableSession.id}`));
    expect(await screen.findAllByRole('heading', { name: 'Prepare current cleanup plan' })).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: /Review archived wedding favorites/ })).toBeInTheDocument();

    await user.click(screen.getByTestId(`agent-session-row-${requestedSession.id}`));
    expect(await screen.findAllByRole('heading', { name: 'Review archived wedding favorites' })).not.toHaveLength(0);
  });

  it('does not load transcripts for unselected sidebar sessions', async () => {
    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: requestedSession.id,
      },
    });

    await waitFor(() => expect(sdkMock.getAgentSessionMessages).toHaveBeenCalled());
    expect(sdkMock.getAgentSessionMessages).not.toHaveBeenCalledWith({ id: actionableSession.id });
  });

  it('updates the selected header and matching sidebar row after cancel success', async () => {
    const cancelledSession = makeSession({ id: actionableSession.id, status: AgentSessionStatus.Cancelled });
    sdkMock.cancelAgentSession.mockResolvedValue(cancelledSession);

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [actionableSession, requestedSession],
        requestedSessionId: actionableSession.id,
      },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Close session' }));

    await waitFor(() => expect(sdkMock.cancelAgentSession).toHaveBeenCalledWith({ id: actionableSession.id }));
    await waitFor(() => expect(screen.getAllByText('Cancelled')).not.toHaveLength(0));
    expect(screen.getByTestId(`agent-session-row-${actionableSession.id}`)).toHaveTextContent('New chat');
    expect(gotoMock).not.toHaveBeenCalledWith('/assistant', expect.anything());
  });

  it('refreshes the selected header and sidebar row after an interrupted resume send', async () => {
    const interruptedSession = makeSession({
      id: '00000000-0000-4000-8000-000000000500',
      status: AgentSessionStatus.Interrupted,
    });
    const refreshedSession = makeSession({ id: interruptedSession.id, status: AgentSessionStatus.Running });
    sdkMock.appendAgentSessionMessage.mockResolvedValue(makeUserMessage(interruptedSession.id, 'Resume organizing'));
    sdkMock.getAgentSession.mockResolvedValue(refreshedSession);

    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [interruptedSession, requestedSession],
        requestedSessionId: interruptedSession.id,
      },
    });

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'Resume organizing' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(sdkMock.getAgentSession).toHaveBeenCalledWith({ id: interruptedSession.id }));
    expect(screen.getByTestId(`agent-session-row-${interruptedSession.id}`)).toHaveTextContent('Resume organizing');
    expect(screen.getAllByText('Running')).not.toHaveLength(0);
    expect(screen.queryByText('Interrupted')).not.toBeInTheDocument();
  });

  it('terminal composer Start new chat clears selection and URL query', async () => {
    render(AgentAssistantWorkspace, {
      props: {
        runnerStatus: healthyRunner,
        credentials,
        sessions: [requestedSession],
        requestedSessionId: requestedSession.id,
      },
    });

    await fireEvent.click(await screen.findByRole('button', { name: 'Start new chat' }));

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(gotoMock).toHaveBeenCalledWith('/assistant', expect.objectContaining({ replaceState: false }));
    expect(screen.getByTestId(`agent-session-row-${requestedSession.id}`)).not.toHaveAttribute('aria-current');
  });
});
