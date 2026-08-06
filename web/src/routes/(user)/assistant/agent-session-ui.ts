import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentSessionStatus,
  type AgentProviderCredentialResponseDto,
} from '@immich/sdk';
import type { Translations } from 'svelte-i18n';

export const permissionPresetOptions = [
  {
    value: AgentPermissionPreset.Careful,
    labelKey: 'assistant_permission_preset_careful' as Translations,
    descriptionKey: 'assistant_permission_preset_careful_description' as Translations,
    detailsKey: 'assistant_permission_preset_careful_details' as Translations,
  },
  {
    value: AgentPermissionPreset.VisualOrganizer,
    labelKey: 'assistant_permission_preset_visual_organizer' as Translations,
    descriptionKey: 'assistant_permission_preset_visual_organizer_description' as Translations,
    detailsKey: 'assistant_permission_preset_visual_organizer_details' as Translations,
  },
  {
    value: AgentPermissionPreset.LocalPowerUser,
    labelKey: 'assistant_permission_preset_local_power_user' as Translations,
    descriptionKey: 'assistant_permission_preset_local_power_user_description' as Translations,
    detailsKey: 'assistant_permission_preset_local_power_user_details' as Translations,
  },
] as const;

export const approvalModeOptions = [
  {
    value: AgentApprovalMode.Strict,
    labelKey: 'assistant_approval_behavior_all_actions' as Translations,
    descriptionKey: 'assistant_approval_behavior_all_actions_description' as Translations,
  },
  {
    value: AgentApprovalMode.AskOnEscalation,
    labelKey: 'assistant_approval_mode_ask_on_escalation' as Translations,
    descriptionKey: 'assistant_approval_mode_ask_on_escalation_description' as Translations,
  },
  {
    value: AgentApprovalMode.PlanOnly,
    labelKey: 'assistant_approval_behavior_apply_plans' as Translations,
    descriptionKey: 'assistant_approval_behavior_apply_plans_description' as Translations,
  },
  {
    value: AgentApprovalMode.DangerouslySkipPermissions,
    labelKey: 'assistant_approval_behavior_skip_prompts' as Translations,
    descriptionKey: 'assistant_approval_behavior_skip_prompts_description' as Translations,
  },
] as const;

export const assistantSettingsApprovalModeOptions = approvalModeOptions.filter(
  (option) =>
    option.value !== AgentApprovalMode.AskOnEscalation && option.value !== AgentApprovalMode.DangerouslySkipPermissions,
);

export const supportedPermissionPresets = [
  AgentPermissionPreset.Careful,
  AgentPermissionPreset.VisualOrganizer,
  AgentPermissionPreset.LocalPowerUser,
] as const;

export const supportedApprovalModes = [
  AgentApprovalMode.Strict,
  AgentApprovalMode.AskOnEscalation,
  AgentApprovalMode.PlanOnly,
  AgentApprovalMode.DangerouslySkipPermissions,
] as const;

export const DEFAULT_AGENT_PERMISSION_PRESET = AgentPermissionPreset.Careful;
export const DEFAULT_AGENT_APPROVAL_MODE = AgentApprovalMode.PlanOnly;

const permissionPresetLabelKeys = Object.fromEntries(
  permissionPresetOptions.map((option) => [option.value, option.labelKey]),
) as Record<(typeof supportedPermissionPresets)[number], string>;

const approvalModeLabelKeys = Object.fromEntries(
  approvalModeOptions.map((option) => [option.value, option.labelKey]),
) as Record<(typeof supportedApprovalModes)[number], string>;

export const getSessionStatusLabelKey = (status: AgentSessionStatus) =>
  `assistant_session_status_${status}` as Translations;

export const getInitialCredentialId = (credentials: AgentProviderCredentialResponseDto[]) => credentials[0]?.id ?? '';

export const getDefaultModel = (credential: AgentProviderCredentialResponseDto | undefined) => {
  if (!credential) {
    return '';
  }

  const { defaultModel, models } = credential;

  if (defaultModel && (models.length === 0 || models.includes(defaultModel))) {
    return defaultModel;
  }

  return models[0] ?? '';
};

export const getPermissionPresetLabelKey = (preset: AgentPermissionPreset) =>
  (permissionPresetLabelKeys[preset as (typeof supportedPermissionPresets)[number]] ?? preset) as Translations;

export const getApprovalModeLabelKey = (mode: AgentApprovalMode) =>
  (approvalModeLabelKeys[mode as (typeof supportedApprovalModes)[number]] ?? mode) as Translations;
