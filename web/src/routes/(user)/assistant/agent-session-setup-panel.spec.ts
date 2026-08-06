import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentRunnerStatusReason,
  AgentSessionStatus,
  ProviderType,
  type AgentProviderCredentialResponseDto,
  type AgentRunnerStatusDto,
  type AgentSessionResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'svelte';
import { readable } from 'svelte/store';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import AgentSessionSetupPanel from './agent-session-setup-panel.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_approval_mode: 'Approval mode',
    assistant_approval_mode_ask_on_escalation: 'Ask on escalation',
    assistant_approval_mode_ask_on_escalation_description: 'Ask before risky actions.',
    assistant_approval_mode_dangerously_skip_permissions: 'Dangerously skip read approvals',
    assistant_approval_mode_dangerously_skip_permissions_description: 'Do not ask for approval.',
    assistant_approval_mode_help: 'Explain approval mode',
    assistant_approval_mode_plan_only: 'Plan review only',
    assistant_approval_mode_plan_only_description: 'Review the plan first.',
    assistant_approval_mode_strict: 'Strict',
    assistant_approval_mode_strict_description: 'Ask before tool actions.',
    assistant_model: 'Model',
    assistant_add_api_key: 'Add API key',
    assistant_manage_api_keys: 'Manage API keys',
    assistant_credentials_empty_description:
      'Save a provider key once, add the models available for that key, then start a chat from here.',
    assistant_credentials_empty_title: 'Connect a model provider',
    assistant_no_credentials: 'Add an agent provider credential before starting a session.',
    assistant_no_credentials_setup: 'Connect a model provider before starting a session.',
    assistant_permission_preset: 'Permission preset',
    assistant_permission_preset_careful: 'Careful',
    assistant_permission_preset_careful_description: 'Use conservative album permissions.',
    assistant_permission_preset_help: 'Explain permission preset',
    assistant_permission_preset_local_power_user: 'Local power user',
    assistant_permission_preset_local_power_user_description: 'Allow broader trusted local work.',
    assistant_permission_preset_visual_organizer: 'Visual organizer',
    assistant_permission_preset_visual_organizer_description: 'Use previews and metadata for curation.',
    assistant_provider_credential: 'Provider credential',
    assistant_runner_not_configured: 'Runner not configured',
    assistant_runner_unavailable: 'Runner unavailable',
    assistant_session_create_error: 'Unable to start assistant session',
    assistant_session_created: 'Assistant session started',
    assistant_session_setup: 'Session setup',
    assistant_session_validate_error: 'Unable to validate the selected model setup',
    assistant_start_session: 'Start session',
    assistant_validating_session: 'Testing setup',
  };

  return { t: readable((key: string) => messages[key] ?? key) };
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
  getDefaultModel: (credential: AgentProviderCredentialResponseDto | undefined) => {
    if (!credential) {
      return '';
    }

    if (
      credential.defaultModel &&
      (credential.models.length === 0 || credential.models.includes(credential.defaultModel))
    ) {
      return credential.defaultModel;
    }

    return credential.models[0] ?? credential.defaultModel ?? '';
  },
  getInitialCredentialId: (credentials: AgentProviderCredentialResponseDto[]) => credentials[0]?.id ?? '',
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
  capabilities: null,
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

const notConfiguredRunner: AgentRunnerStatusDto = {
  ...unavailableRunner,
  configured: false,
  reason: AgentRunnerStatusReason.NotConfigured,
};

const credentials: AgentProviderCredentialResponseDto[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: ProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1', 'gpt-5.1-mini'],
    defaultModel: 'gpt-5.1',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    lastUsedAt: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    providerType: ProviderType.Anthropic,
    label: 'Anthropic work',
    baseUrl: null,
    models: ['claude-4-sonnet'],
    defaultModel: 'not-listed',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    lastUsedAt: null,
  },
];

const manualModelCredential: AgentProviderCredentialResponseDto = {
  ...credentials[0],
  id: '00000000-0000-4000-8000-000000000003',
  label: 'OpenAI compatible',
  models: [],
  defaultModel: null,
};

const createdSession: AgentSessionResponseDto = {
  id: '00000000-0000-4000-8000-000000000100',
  status: AgentSessionStatus.Created,
  providerCredentialId: credentials[0].id,
  credentialSnapshot: {
    id: credentials[0].id,
    providerType: AgentProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1', 'gpt-5.1-mini'],
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
  runnerCapabilitiesSnapshot: null,
  runnerEndpoint: null,
  runnerSessionId: null,
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
  endedAt: null,
};

const renderPanel = (props: Partial<ComponentProps<typeof AgentSessionSetupPanel>> = {}) => {
  const onSessionCreated = vi.fn();
  render(AgentSessionSetupPanel, {
    props: {
      runnerStatus: healthyRunner,
      credentials,
      onSessionCreated,
      ...props,
    },
  });

  return { onSessionCreated };
};

describe(AgentSessionSetupPanel.name, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMock.validateAgentSession.mockResolvedValue(undefined as never);
    sdkMock.createAgentSession.mockResolvedValue(createdSession);
  });

  it('disables submit when runner is not configured, unhealthy, credentials are absent, or model is blank', async () => {
    const { rerender } = render(AgentSessionSetupPanel, {
      props: { runnerStatus: notConfiguredRunner, credentials, onSessionCreated: vi.fn() },
    });
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
    expect(screen.getByText('Runner not configured')).toBeInTheDocument();

    await rerender({ runnerStatus: unavailableRunner, credentials, onSessionCreated: vi.fn() });
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
    expect(screen.getByText('Runner unavailable')).toBeInTheDocument();

    await rerender({ runnerStatus: healthyRunner, credentials: [], onSessionCreated: vi.fn() });
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
    expect(screen.getByText('Connect a model provider before starting a session.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Connect a model provider' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add API key' })).toBeInTheDocument();

    await rerender({ runnerStatus: healthyRunner, credentials: [manualModelCredential], onSessionCreated: vi.fn() });
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('Model'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
  });

  it('opens credential setup from the empty provider state', async () => {
    const user = userEvent.setup();
    const onAddCredentials = vi.fn();
    renderPanel({ credentials: [], onAddCredentials });

    await user.click(screen.getByRole('button', { name: 'Add API key' }));

    expect(onAddCredentials).toHaveBeenCalledTimes(1);
  });

  it('opens credential setup from the configured provider state', async () => {
    const user = userEvent.setup();
    const onAddCredentials = vi.fn();
    renderPanel({ onAddCredentials });

    await user.click(screen.getByRole('button', { name: 'Manage API keys' }));

    expect(onAddCredentials).toHaveBeenCalledTimes(1);
  });

  it('explains permission presets and approval modes from inline help buttons', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Explain permission preset' }));

    expect(screen.getByText('Use conservative album permissions.')).toBeInTheDocument();

    await fireEvent.change(screen.getByLabelText('Approval mode'), {
      target: { value: AgentApprovalMode.AskOnEscalation },
    });
    await user.click(screen.getByRole('button', { name: 'Explain approval mode' }));

    expect(screen.queryByText('Use conservative album permissions.')).not.toBeInTheDocument();
    expect(screen.getByText('Ask before risky actions.')).toBeInTheDocument();
  });

  it('defaults selections, supports changes, and resets model when the credential changes', async () => {
    renderPanel();

    expect(screen.getByLabelText('Provider credential')).toHaveValue(credentials[0].id);
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-5.1');
    expect(screen.getByLabelText('Permission preset')).toHaveValue(AgentPermissionPreset.Careful);
    expect(screen.getByLabelText('Approval mode')).toHaveValue(AgentApprovalMode.Strict);
    expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled();
    expect(screen.queryByRole('option', { name: 'custom' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dangerously skip read approvals' })).toHaveValue(
      AgentApprovalMode.DangerouslySkipPermissions,
    );

    await fireEvent.change(screen.getByLabelText('Permission preset'), {
      target: { value: AgentPermissionPreset.VisualOrganizer },
    });
    await fireEvent.change(screen.getByLabelText('Approval mode'), {
      target: { value: AgentApprovalMode.AskOnEscalation },
    });
    await fireEvent.change(screen.getByLabelText('Provider credential'), { target: { value: credentials[1].id } });

    expect(screen.getByLabelText('Model')).toHaveValue('claude-4-sonnet');
    expect(screen.getByLabelText('Permission preset')).toHaveValue(AgentPermissionPreset.VisualOrganizer);
    expect(screen.getByLabelText('Approval mode')).toHaveValue(AgentApprovalMode.AskOnEscalation);
  });

  it('supports manual model entry when the selected credential has no model list', async () => {
    renderPanel({ credentials: [manualModelCredential] });

    await fireEvent.input(screen.getByLabelText('Model'), { target: { value: ' local-model ' } });

    expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled();
    expect(screen.getByLabelText('Model')).toHaveValue(' local-model ');
  });

  it('submits the trimmed payload, guards double submit, and calls success callback once', async () => {
    let resolveCreate: (session: AgentSessionResponseDto) => void = () => undefined;
    sdkMock.createAgentSession.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const { onSessionCreated } = renderPanel({ credentials: [manualModelCredential] });
    const user = userEvent.setup();
    await fireEvent.input(screen.getByLabelText('Model'), { target: { value: ' local-model ' } });
    const approvalModeSelect = screen.getByLabelText('Approval mode');
    await user.selectOptions(approvalModeSelect, AgentApprovalMode.DangerouslySkipPermissions);
    await waitFor(() => expect(approvalModeSelect).toHaveValue(AgentApprovalMode.DangerouslySkipPermissions));

    const submit = screen.getByRole('button', { name: 'Start session' });
    await fireEvent.click(submit);
    await fireEvent.click(submit);

    expect(submit).toBeDisabled();
    expect(sdkMock.validateAgentSession).toHaveBeenCalledTimes(1);
    expect(sdkMock.validateAgentSession).toHaveBeenCalledWith({
      agentSessionCreateDto: {
        providerCredentialId: manualModelCredential.id,
        model: 'local-model',
        permissionPreset: AgentPermissionPreset.Careful,
        approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      },
    });
    expect(sdkMock.createAgentSession).toHaveBeenCalledTimes(1);
    expect(sdkMock.createAgentSession).toHaveBeenCalledWith({
      agentSessionCreateDto: {
        providerCredentialId: manualModelCredential.id,
        model: 'local-model',
        permissionPreset: AgentPermissionPreset.Careful,
        approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      },
    });
    expect(sdkMock.createAgentSession.mock.calls[0][0].agentSessionCreateDto).not.toHaveProperty('permissionPlan');
    expect(sdkMock.createAgentSession.mock.calls[0][0].agentSessionCreateDto).not.toHaveProperty('runnerEndpoint');
    expect(sdkMock.createAgentSession.mock.calls[0][0].agentSessionCreateDto).not.toHaveProperty('initialContext');

    resolveCreate(createdSession);
    await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith(createdSession));
    expect(onSessionCreated).toHaveBeenCalledTimes(1);
  });

  it('does not submit when invalid or disabled', async () => {
    renderPanel({ runnerStatus: unavailableRunner });

    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(sdkMock.createAgentSession).not.toHaveBeenCalled();
  });

  it('keeps form values and clears in-flight state after failure', async () => {
    sdkMock.createAgentSession.mockRejectedValue(new Error('failed'));
    renderPanel({ credentials: [manualModelCredential] });
    await fireEvent.input(screen.getByLabelText('Model'), { target: { value: ' local-model ' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to start assistant session');
    expect(screen.getByLabelText('Model')).toHaveValue(' local-model ');
    expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled();
  });

  it('validates setup before creating and keeps the form ready when validation fails', async () => {
    sdkMock.validateAgentSession.mockRejectedValue(new Error('validation failed'));
    renderPanel({ credentials: [manualModelCredential] });
    await fireEvent.input(screen.getByLabelText('Model'), { target: { value: ' local-model ' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to validate the selected model setup');
    expect(sdkMock.createAgentSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Model')).toHaveValue(' local-model ');
    expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled();
  });
});
