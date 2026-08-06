// agent-onboarding-connect.spec.ts
import { ProviderType, type AgentProviderCredentialResponseDto } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import AgentOnboardingConnect from './agent-onboarding-connect.svelte';

vi.mock('svelte-i18n', () => ({ t: readable((key: string) => key) }));

const credential = { id: 'cred-1', providerType: ProviderType.OpenaiCompatible } as AgentProviderCredentialResponseDto;

describe('agent-onboarding-connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMock.createAgentProviderCredential.mockResolvedValue(credential);
    sdkMock.validateAgentSession.mockResolvedValue(undefined as never);
    sdkMock.deleteAgentProviderCredential.mockResolvedValue(undefined as never);
  });

  it('defaults to the local provider with its base url prefilled', () => {
    render(AgentOnboardingConnect, { props: { onConnected: vi.fn() } });
    expect(screen.getByRole('button', { name: /assistant_onboarding_provider_local/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('assistant_onboarding_base_url')).toHaveValue('http://localhost:11434/v1');
  });

  it('creates the credential then validates it, and reports the connected credential id + model', async () => {
    const onConnected = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboardingConnect, { props: { onConnected } });

    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'llama3.1');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_test' }));

    await waitFor(() => expect(sdkMock.createAgentProviderCredential).toHaveBeenCalledTimes(1));
    expect(sdkMock.createAgentProviderCredential).toHaveBeenCalledWith({
      agentProviderCredentialCreateDto: expect.objectContaining({
        providerType: ProviderType.OpenaiCompatible,
        baseUrl: 'http://localhost:11434/v1',
        models: ['llama3.1'],
        defaultModel: 'llama3.1',
        secret: 'local',
      }),
    });
    expect(sdkMock.validateAgentSession).toHaveBeenCalledWith({
      agentSessionCreateDto: expect.objectContaining({ providerCredentialId: 'cred-1', model: 'llama3.1' }),
    });
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('cred-1', 'llama3.1', 'local'));
    expect(await screen.findByText('assistant_onboarding_connected')).toBeInTheDocument();
  });

  it('shows an error and does not report connected when validation fails', async () => {
    sdkMock.validateAgentSession.mockRejectedValue(new Error('bad key'));
    const onConnected = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboardingConnect, { props: { onConnected } });

    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'gpt');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_test' }));

    expect(await screen.findByText('assistant_onboarding_test_error')).toBeInTheDocument();
    expect(onConnected).not.toHaveBeenCalledWith(expect.stringMatching(/.+/), expect.anything());
  });

  it('requires a secret for cloud providers before the test button enables', async () => {
    const user = userEvent.setup();
    render(AgentOnboardingConnect, { props: { onConnected: vi.fn() } });
    await user.click(screen.getByRole('button', { name: /assistant_onboarding_provider_openai/ }));
    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'gpt');
    expect(screen.getByRole('button', { name: 'assistant_onboarding_test' })).toBeDisabled();
    await user.type(screen.getByLabelText('assistant_onboarding_api_key'), 'sk-x');
    expect(screen.getByRole('button', { name: 'assistant_onboarding_test' })).toBeEnabled();
  });
});
