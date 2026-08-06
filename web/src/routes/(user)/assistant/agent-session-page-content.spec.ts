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
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { websocketMock } from '@test-data/mocks/websocket.mock';
import AgentSessionPageContent from './agent-session-page-content.svelte';

vi.mock('$lib/stores/websocket');

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant: 'Assistant',
    assistant_approval_mode: 'Approval mode',
    assistant_approval_mode_ask_on_escalation: 'Ask on escalation',
    assistant_approval_mode_dangerously_skip_permissions: 'Dangerously skip read approvals',
    assistant_approval_mode_plan_only: 'Plan review only',
    assistant_approval_mode_strict: 'Strict',
    assistant_chat: 'Chat',
    assistant_configured: 'Configured',
    assistant_add_api_key: 'Add API key',
    assistant_credentials_empty_description:
      'Save a provider key once, add the models available for that key, then start a chat from here.',
    assistant_credentials_empty_title: 'Connect a model provider',
    assistant_created_session: 'Created session',
    assistant_healthy: 'Healthy',
    assistant_message: 'Message',
    assistant_message_load_error: 'Unable to load messages',
    assistant_message_send_error: 'Unable to send message',
    assistant_model: 'Model',
    assistant_no: 'no',
    assistant_no_credentials: 'Add an agent provider credential before starting a session.',
    assistant_no_credentials_setup: 'Connect a model provider before starting a session.',
    assistant_operation_apply_applying: 'Applying operations',
    assistant_operation_apply_error: 'Unable to apply proposed operations',
    assistant_operation_apply_selected: 'Apply {count} selected',
    assistant_operation_apply_success: 'Applied {applied} operations. {failed} failed.',
    assistant_operation_plan_empty: 'No proposed album plan yet.',
    assistant_permission_preset: 'Permission preset',
    assistant_permission_preset_careful: 'Careful',
    assistant_permission_preset_local_power_user: 'Local power user',
    assistant_permission_preset_visual_organizer: 'Visual organizer',
    assistant_protocol: 'Protocol {protocol}',
    assistant_provider_credential: 'Provider credential',
    assistant_runner: 'Runner {version}',
    assistant_runner_healthy: 'Runner healthy',
    assistant_runner_not_configured: 'Runner not configured',
    assistant_runner_unavailable: 'Runner unavailable',
    assistant_session_create_error: 'Unable to start assistant session',
    assistant_session_created: 'Assistant session started',
    assistant_session_setup: 'Session setup',
    assistant_send: 'Send',
    assistant_start_session: 'Start session',
    assistant_streaming: 'Streaming',
    assistant_streaming_response: 'Assistant is responding',
    assistant_subtitle: 'Album organization assistant',
    assistant_yes: 'yes',
    unknown: 'Unknown',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{applied}', String(options?.values?.applied ?? ''))
        .replace('{failed}', String(options?.values?.failed ?? ''))
        .replace('{protocol}', String(options?.values?.protocol ?? ''))
        .replace('{version}', String(options?.values?.version ?? '')),
    ),
  };
});

vi.mock('./agent-session-ui', () => ({
  DEFAULT_AGENT_APPROVAL_MODE: AgentApprovalMode.Strict,
  DEFAULT_AGENT_PERMISSION_PRESET: AgentPermissionPreset.Careful,
  approvalModeOptions: [
    {
      value: AgentApprovalMode.Strict,
      labelKey: 'assistant_approval_mode_strict',
      descriptionKey: 'assistant_approval_mode_strict_description',
    },
    {
      value: AgentApprovalMode.AskOnEscalation,
      labelKey: 'assistant_approval_mode_ask_on_escalation',
      descriptionKey: 'assistant_approval_mode_ask_on_escalation_description',
    },
    {
      value: AgentApprovalMode.PlanOnly,
      labelKey: 'assistant_approval_mode_plan_only',
      descriptionKey: 'assistant_approval_mode_plan_only_description',
    },
    {
      value: AgentApprovalMode.DangerouslySkipPermissions,
      labelKey: 'assistant_approval_mode_dangerously_skip_permissions',
      descriptionKey: 'assistant_approval_mode_dangerously_skip_permissions_description',
    },
  ],
  getApprovalModeLabelKey: (mode: AgentApprovalMode) => `approval:${mode}`,
  getDefaultModel: (credential: AgentProviderCredentialResponseDto | undefined) => credential?.defaultModel ?? '',
  getInitialCredentialId: (credentials: AgentProviderCredentialResponseDto[]) => credentials[0]?.id ?? '',
  getPermissionPresetLabelKey: (preset: AgentPermissionPreset) => `preset:${preset}`,
  getSessionStatusLabelKey: (status: AgentSessionStatus) => `status:${status}`,
  permissionPresetOptions: [
    {
      value: AgentPermissionPreset.Careful,
      labelKey: 'assistant_permission_preset_careful',
      descriptionKey: 'assistant_permission_preset_careful_description',
    },
    {
      value: AgentPermissionPreset.VisualOrganizer,
      labelKey: 'assistant_permission_preset_visual_organizer',
      descriptionKey: 'assistant_permission_preset_visual_organizer_description',
    },
    {
      value: AgentPermissionPreset.LocalPowerUser,
      labelKey: 'assistant_permission_preset_local_power_user',
      descriptionKey: 'assistant_permission_preset_local_power_user_description',
    },
  ],
}));

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

const createdSession: AgentSessionResponseDto = {
  id: '00000000-0000-4000-8000-000000000100',
  status: AgentSessionStatus.Running,
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
  permissionPreset: AgentPermissionPreset.VisualOrganizer,
  approvalMode: AgentApprovalMode.AskOnEscalation,
  runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
  runnerEndpoint: 'http://agent-runner:4477',
  runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
  endedAt: null,
};

const secondSession: AgentSessionResponseDto = {
  ...createdSession,
  id: '00000000-0000-4000-8000-000000000200',
  runnerSessionId: 'stub-00000000-0000-4000-8000-000000000200',
};

const makeMessage = (id: string, sessionId: string, text: string): AgentMessageResponseDto => ({
  id,
  sessionId,
  role: AgentMessageRole.Assistant,
  providerMessageId: null,
  toolCallId: null,
  content: {
    blocks: [{ type: AgentMessageTextBlockType.Text, text }],
  },
  createdAt: '2026-05-14T00:00:00.000Z',
});

describe(AgentSessionPageContent.name, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMock.validateAgentSession.mockResolvedValue(undefined as never);
    sdkMock.createAgentSession.mockResolvedValue(createdSession);
    sdkMock.getAgentSessionMessages.mockResolvedValue([]);
    websocketMock.websocketEvents.on.mockReturnValue(vi.fn());
  });

  it('renders runner status and setup for a healthy runner with credentials', () => {
    render(AgentSessionPageContent, { props: { runnerStatus: healthyRunner, credentials } });

    expect(screen.getByTestId('assistant-status-reason')).toHaveTextContent('Runner healthy');
    expect(screen.getByRole('heading', { name: 'Session setup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Created session' })).not.toBeInTheDocument();
  });

  it('renders created-session summary only after successful creation', async () => {
    render(AgentSessionPageContent, { props: { runnerStatus: healthyRunner, credentials } });

    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(await screen.findByRole('heading', { name: 'Created session' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Created session' });
    expect(within(summary).getByText('OpenAI personal')).toBeInTheDocument();
    expect(within(summary).getByText('gpt-5.1')).toBeInTheDocument();
    expect(within(summary).getByText(`status:${AgentSessionStatus.Running}`)).toBeInTheDocument();
    expect(within(summary).getByText(`preset:${AgentPermissionPreset.VisualOrganizer}`)).toBeInTheDocument();
    expect(within(summary).getByText(`approval:${AgentApprovalMode.AskOnEscalation}`)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
  });

  it('keeps the previous created-session summary when a later create attempt fails', async () => {
    sdkMock.createAgentSession.mockResolvedValueOnce(createdSession).mockRejectedValueOnce(new Error('failed'));
    render(AgentSessionPageContent, { props: { runnerStatus: healthyRunner, credentials } });

    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    const summary = await screen.findByRole('region', { name: 'Created session' });
    expect(within(summary).getByText('OpenAI personal')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to start assistant session');
    expect(screen.getByRole('region', { name: 'Created session' })).toBeInTheDocument();
    expect(sdkMock.createAgentSession).toHaveBeenCalledTimes(2);
  });

  it('resets the chat panel when a new session is created', async () => {
    sdkMock.createAgentSession.mockResolvedValueOnce(createdSession).mockResolvedValueOnce(secondSession);
    sdkMock.getAgentSessionMessages
      .mockResolvedValueOnce([makeMessage('message-old', createdSession.id, 'First transcript')])
      .mockResolvedValueOnce([makeMessage('message-new', secondSession.id, 'Second transcript')]);

    render(AgentSessionPageContent, { props: { runnerStatus: healthyRunner, credentials } });

    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(await screen.findByText('First transcript')).toBeInTheDocument();

    const input = await screen.findByRole('textbox', { name: 'Message' });
    await fireEvent.input(input, { target: { value: 'draft from first session' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(await screen.findByText('Second transcript')).toBeInTheDocument();
    expect(screen.queryByText('First transcript')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    expect(sdkMock.getAgentSessionMessages).toHaveBeenCalledWith({ id: secondSession.id });
  });

  it('mounts the operation plan review panel after a session is created', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(null);

    render(AgentSessionPageContent, { props: { runnerStatus: healthyRunner, credentials } });

    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(await screen.findByText('No proposed album plan yet.')).toBeInTheDocument();
    expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledWith({ id: createdSession.id });
  });

  it('renders setup disabled when the runner is unavailable', () => {
    render(AgentSessionPageContent, { props: { runnerStatus: unavailableRunner, credentials } });

    expect(screen.getByTestId('assistant-status-reason')).toHaveTextContent('Runner unavailable');
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
  });

  it('renders setup disabled when there are no credentials', () => {
    render(AgentSessionPageContent, { props: { runnerStatus: healthyRunner, credentials: [] } });

    expect(screen.getByText('Connect a model provider before starting a session.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Connect a model provider' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add API key' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
  });
});
