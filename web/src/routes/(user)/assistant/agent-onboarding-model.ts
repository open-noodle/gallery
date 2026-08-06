// agent-onboarding-model.ts
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  ProviderType,
  type AgentProviderCredentialCreateDto,
  type AgentSessionCreateDto,
} from '@immich/sdk';

export type OnboardingProviderId = 'local' | 'openai' | 'anthropic' | 'other';

export interface OnboardingProviderMeta {
  id: OnboardingProviderId;
  providerType: ProviderType;
  defaultLabel: string;
  requiresBaseUrl: boolean;
  baseUrlPrefill: string;
  secretRequired: boolean;
  keyHelpUrl?: string;
}

export const ONBOARDING_PROVIDERS: Record<OnboardingProviderId, OnboardingProviderMeta> = {
  local: {
    id: 'local',
    providerType: ProviderType.OpenaiCompatible,
    defaultLabel: 'Local model',
    requiresBaseUrl: true,
    baseUrlPrefill: 'http://localhost:11434/v1',
    secretRequired: false,
  },
  openai: {
    id: 'openai',
    providerType: ProviderType.Openai,
    defaultLabel: 'OpenAI',
    requiresBaseUrl: false,
    baseUrlPrefill: '',
    secretRequired: true,
    keyHelpUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    id: 'anthropic',
    providerType: ProviderType.Anthropic,
    defaultLabel: 'Anthropic',
    requiresBaseUrl: false,
    baseUrlPrefill: '',
    secretRequired: true,
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
  },
  other: {
    id: 'other',
    providerType: ProviderType.OpenaiCompatible,
    defaultLabel: 'Custom provider',
    requiresBaseUrl: true,
    baseUrlPrefill: '',
    secretRequired: false,
  },
};

export const ONBOARDING_PROVIDER_ORDER: OnboardingProviderId[] = ['local', 'openai', 'anthropic', 'other'];
export const ONBOARDING_DEFAULT_PRESET = AgentPermissionPreset.VisualOrganizer;
export const ONBOARDING_DEFAULT_APPROVAL = AgentApprovalMode.PlanOnly;
// openai-compatible servers that need no key still require a non-empty secret server-side.
export const ONBOARDING_PLACEHOLDER_SECRET = 'local';

export interface OnboardingConnectState {
  provider: OnboardingProviderId;
  label: string;
  secret: string;
  baseUrl: string;
  model: string;
}

export const isCloudProvider = (provider: OnboardingProviderId): boolean =>
  provider === 'openai' || provider === 'anthropic';

export const isConnectComplete = (state: OnboardingConnectState): boolean => {
  const meta = ONBOARDING_PROVIDERS[state.provider];
  if (!state.model.trim()) {
    return false;
  }
  if (meta.requiresBaseUrl && !state.baseUrl.trim()) {
    return false;
  }
  if (meta.secretRequired && !state.secret.trim()) {
    return false;
  }
  return true;
};

export const buildCredentialCreateDto = (state: OnboardingConnectState): AgentProviderCredentialCreateDto => {
  const meta = ONBOARDING_PROVIDERS[state.provider];
  const model = state.model.trim();
  const secret = state.secret.trim() || (meta.secretRequired ? '' : ONBOARDING_PLACEHOLDER_SECRET);
  return {
    providerType: meta.providerType,
    label: state.label.trim() || meta.defaultLabel,
    secret,
    baseUrl: meta.requiresBaseUrl ? state.baseUrl.trim() : undefined,
    models: [model],
    defaultModel: model,
  };
};

export const buildValidateDto = (providerCredentialId: string, model: string): AgentSessionCreateDto => ({
  providerCredentialId,
  model: model.trim(),
  permissionPreset: ONBOARDING_DEFAULT_PRESET,
  approvalMode: ONBOARDING_DEFAULT_APPROVAL,
});
