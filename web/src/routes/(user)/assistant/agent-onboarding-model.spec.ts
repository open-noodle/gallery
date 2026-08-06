// agent-onboarding-model.spec.ts
import { AgentApprovalMode, AgentPermissionPreset, ProviderType } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import {
  buildCredentialCreateDto,
  buildValidateDto,
  isCloudProvider,
  isConnectComplete,
  ONBOARDING_DEFAULT_APPROVAL,
  ONBOARDING_DEFAULT_PRESET,
  ONBOARDING_PROVIDER_ORDER,
  ONBOARDING_PROVIDERS,
} from './agent-onboarding-model';

const base = { provider: 'local' as const, label: '', secret: '', baseUrl: '', model: '' };

describe('agent-onboarding-model', () => {
  it('orders providers local-first, then cloud, then other', () => {
    expect(ONBOARDING_PROVIDER_ORDER).toEqual(['local', 'openai', 'anthropic', 'other']);
  });

  it('defaults to Visual organizer access and Plan-only approval', () => {
    expect(ONBOARDING_DEFAULT_PRESET).toBe(AgentPermissionPreset.VisualOrganizer);
    expect(ONBOARDING_DEFAULT_APPROVAL).toBe(AgentApprovalMode.PlanOnly);
  });

  it('maps local and other to openai-compatible; cloud to their own types', () => {
    expect(ONBOARDING_PROVIDERS.local.providerType).toBe(ProviderType.OpenaiCompatible);
    expect(ONBOARDING_PROVIDERS.other.providerType).toBe(ProviderType.OpenaiCompatible);
    expect(ONBOARDING_PROVIDERS.openai.providerType).toBe(ProviderType.Openai);
    expect(ONBOARDING_PROVIDERS.anthropic.providerType).toBe(ProviderType.Anthropic);
  });

  it('requires a model always, base url for local/other, secret only for cloud', () => {
    expect(isConnectComplete({ ...base, provider: 'local', baseUrl: 'http://x/v1', model: 'm' })).toBe(true);
    expect(isConnectComplete({ ...base, provider: 'local', baseUrl: 'http://x/v1', model: '' })).toBe(false);
    expect(isConnectComplete({ ...base, provider: 'local', baseUrl: '', model: 'm' })).toBe(false);
    expect(isConnectComplete({ ...base, provider: 'openai', secret: 'sk', model: 'm' })).toBe(true);
    expect(isConnectComplete({ ...base, provider: 'openai', secret: '', model: 'm' })).toBe(false);
    expect(isConnectComplete({ ...base, provider: 'other', baseUrl: 'http://x/v1', model: 'm' })).toBe(true);
  });

  it('builds a credential DTO: local key optional uses placeholder, model becomes the single+default model', () => {
    expect(buildCredentialCreateDto({ ...base, provider: 'local', baseUrl: 'http://x/v1 ', model: ' llama ' })).toEqual(
      {
        providerType: ProviderType.OpenaiCompatible,
        label: 'Local model',
        secret: 'local',
        baseUrl: 'http://x/v1',
        models: ['llama'],
        defaultModel: 'llama',
      },
    );
    expect(
      buildCredentialCreateDto({ ...base, provider: 'openai', label: 'Work', secret: ' sk ', model: 'gpt' }),
    ).toEqual({
      providerType: ProviderType.Openai,
      label: 'Work',
      secret: 'sk',
      baseUrl: undefined,
      models: ['gpt'],
      defaultModel: 'gpt',
    });
  });

  it('builds a validate DTO with the onboarding defaults', () => {
    expect(buildValidateDto('cred-1', ' gpt ')).toEqual({
      providerCredentialId: 'cred-1',
      model: 'gpt',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
    });
  });

  it('flags cloud providers', () => {
    expect(isCloudProvider('openai')).toBe(true);
    expect(isCloudProvider('anthropic')).toBe(true);
    expect(isCloudProvider('local')).toBe(false);
    expect(isCloudProvider('other')).toBe(false);
  });
});
