import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentSessionStatus,
  ProviderType,
  type AgentProviderCredentialResponseDto,
} from '@immich/sdk';
import {
  approvalModeOptions,
  assistantSettingsApprovalModeOptions,
  DEFAULT_AGENT_APPROVAL_MODE,
  getApprovalModeLabelKey,
  getDefaultModel,
  getInitialCredentialId,
  getPermissionPresetLabelKey,
  getSessionStatusLabelKey,
  permissionPresetOptions,
  supportedApprovalModes,
  supportedPermissionPresets,
} from './agent-session-ui';

const credential = (
  overrides: Partial<AgentProviderCredentialResponseDto> = {},
): AgentProviderCredentialResponseDto => ({
  id: 'credential-1',
  providerType: ProviderType.Openai,
  label: 'OpenAI personal',
  baseUrl: null,
  models: [],
  defaultModel: null,
  createdAt: '2026-05-14T00:00:00.000Z',
  updatedAt: '2026-05-14T00:00:00.000Z',
  lastUsedAt: null,
  ...overrides,
});

describe('agent session UI helpers', () => {
  describe(getInitialCredentialId.name, () => {
    it('chooses the first credential id when credentials exist', () => {
      expect(getInitialCredentialId([credential({ id: 'credential-1' }), credential({ id: 'credential-2' })])).toBe(
        'credential-1',
      );
    });

    it('returns an empty id when no credentials exist', () => {
      expect(getInitialCredentialId([])).toBe('');
    });
  });

  describe(getDefaultModel.name, () => {
    it('uses an included default model', () => {
      expect(getDefaultModel(credential({ models: ['gpt-5', 'gpt-5-mini'], defaultModel: 'gpt-5-mini' }))).toBe(
        'gpt-5-mini',
      );
    });

    it('falls back to the first listed model when the default model is absent', () => {
      expect(getDefaultModel(credential({ models: ['claude-sonnet-5', 'claude-haiku-5'] }))).toBe('claude-sonnet-5');
    });

    it('falls back to the first listed model when the default model is not listed', () => {
      expect(getDefaultModel(credential({ models: ['gpt-5', 'gpt-5-mini'], defaultModel: 'retired-model' }))).toBe(
        'gpt-5',
      );
    });

    it('uses the default model when the model list is empty', () => {
      expect(getDefaultModel(credential({ models: [], defaultModel: 'custom-model' }))).toBe('custom-model');
    });

    it('returns an empty model when no model information exists', () => {
      expect(getDefaultModel(credential({ models: [], defaultModel: null }))).toBe('');
    });
  });

  it('exposes supported permission presets without Custom', () => {
    expect(supportedPermissionPresets).toEqual([
      AgentPermissionPreset.Careful,
      AgentPermissionPreset.VisualOrganizer,
      AgentPermissionPreset.LocalPowerUser,
    ]);
    expect(supportedPermissionPresets).not.toContain(AgentPermissionPreset.Custom);
    expect(permissionPresetOptions.map((option) => option.value)).toEqual(supportedPermissionPresets);
  });

  it('exposes supported approval modes', () => {
    expect(supportedApprovalModes).toEqual([
      AgentApprovalMode.Strict,
      AgentApprovalMode.AskOnEscalation,
      AgentApprovalMode.PlanOnly,
      AgentApprovalMode.DangerouslySkipPermissions,
    ]);
    expect(approvalModeOptions.map((option) => option.value)).toEqual(supportedApprovalModes);
    expect(assistantSettingsApprovalModeOptions.map((option) => option.value)).toEqual([
      AgentApprovalMode.Strict,
      AgentApprovalMode.PlanOnly,
    ]);
    expect(DEFAULT_AGENT_APPROVAL_MODE).toBe(AgentApprovalMode.PlanOnly);
  });

  it('has label keys for every exposed permission preset', () => {
    expect(supportedPermissionPresets.map((preset) => getPermissionPresetLabelKey(preset))).toEqual([
      'assistant_permission_preset_careful',
      'assistant_permission_preset_visual_organizer',
      'assistant_permission_preset_local_power_user',
    ]);
  });

  it('has label keys for every exposed approval mode', () => {
    expect(supportedApprovalModes.map((mode) => getApprovalModeLabelKey(mode))).toEqual([
      'assistant_approval_behavior_all_actions',
      'assistant_approval_mode_ask_on_escalation',
      'assistant_approval_behavior_apply_plans',
      'assistant_approval_behavior_skip_prompts',
    ]);
  });

  it('has label keys for session statuses', () => {
    expect(getSessionStatusLabelKey(AgentSessionStatus.Created)).toBe('assistant_session_status_created');
    expect(getSessionStatusLabelKey(AgentSessionStatus.WaitingForPlanReview)).toBe(
      'assistant_session_status_waiting_for_plan_review',
    );
  });
});
