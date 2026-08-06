// agent-onboarding.spec.ts
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  ProviderType,
  type AgentProviderCredentialResponseDto,
} from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import AgentOnboarding from './agent-onboarding.svelte';

vi.mock('svelte-i18n', () => ({ t: readable((key: string) => key) }));

describe('agent-onboarding orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMock.createAgentProviderCredential.mockResolvedValue({
      id: 'cred-1',
      providerType: ProviderType.OpenaiCompatible,
    } as AgentProviderCredentialResponseDto);
    sdkMock.validateAgentSession.mockResolvedValue(undefined as never);
    sdkMock.deleteAgentProviderCredential.mockResolvedValue(undefined as never);
  });

  it('walks welcome → connect → access → approval → ready and completes with the chosen defaults', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboarding, { props: { onComplete } });

    // welcome
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_get_started' }));
    // connect (local default)
    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'llama3.1');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_test' }));
    await screen.findByText('assistant_onboarding_connected');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));
    // access defaults to Visual organizer → Continue enabled
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));
    // approval defaults to Plan-only → Continue enabled
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));
    // ready
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_open' }));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        credentialId: 'cred-1',
        model: 'llama3.1',
        permissionPreset: AgentPermissionPreset.VisualOrganizer,
        approvalMode: AgentApprovalMode.PlanOnly,
      }),
    );
  });

  it('keeps Continue disabled on the connect step until a successful test', async () => {
    const user = userEvent.setup();
    render(AgentOnboarding, { props: { onComplete: vi.fn() } });
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_get_started' }));
    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'llama3.1');
    expect(screen.getByRole('button', { name: 'assistant_onboarding_continue' })).toBeDisabled();
  });

  it('clicking an example prompt on the Ready step completes onboarding with that prompt as initialPrompt', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboarding, { props: { onComplete } });

    // welcome → connect → access → approval → ready
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_get_started' }));
    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'llama3.1');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_test' }));
    await screen.findByText('assistant_onboarding_connected');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));

    // Click the album example-prompt button
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_prompt_album' }));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        credentialId: 'cred-1',
        model: 'llama3.1',
        permissionPreset: AgentPermissionPreset.VisualOrganizer,
        approvalMode: AgentApprovalMode.PlanOnly,
        initialPrompt: 'assistant_onboarding_prompt_album',
      }),
    );
  });

  it('deletes the previous credential when the user edits from the Ready step and re-tests', async () => {
    sdkMock.createAgentProviderCredential
      .mockResolvedValueOnce({
        id: 'cred-1',
        providerType: ProviderType.OpenaiCompatible,
      } as AgentProviderCredentialResponseDto)
      .mockResolvedValueOnce({
        id: 'cred-2',
        providerType: ProviderType.OpenaiCompatible,
      } as AgentProviderCredentialResponseDto);

    const user = userEvent.setup();
    render(AgentOnboarding, { props: { onComplete: vi.fn() } });

    // welcome → connect
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_get_started' }));
    await user.type(screen.getByLabelText('assistant_onboarding_model'), 'llama3.1');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_test' }));
    await screen.findByText('assistant_onboarding_connected');
    // connect → access → approval → ready
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_continue' }));

    // on Ready, click the Model row's Edit button (first Edit button) → back to step 1
    const editButtons = screen.getAllByRole('button', { name: 'assistant_onboarding_edit' });
    await user.click(editButtons[0]);

    // re-test in connect (cred-1 was created inside the connect child, but orchestrator held it via onConnected)
    // The connect child remounts with a fresh createdCredentialId=null, so it won't delete cred-1 itself.
    // The orchestrator must delete it when it receives the new credentialId (cred-2) that differs from cred-1.
    await user.type(screen.getByLabelText('assistant_onboarding_model'), '2');
    await user.click(screen.getByRole('button', { name: 'assistant_onboarding_test' }));
    await screen.findByText('assistant_onboarding_connected');

    await waitFor(() => expect(sdkMock.deleteAgentProviderCredential).toHaveBeenCalledWith({ id: 'cred-1' }));
  });
});
