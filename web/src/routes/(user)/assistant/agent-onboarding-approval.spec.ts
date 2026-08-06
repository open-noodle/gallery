import { AgentApprovalMode } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import AgentOnboardingApproval from './agent-onboarding-approval.svelte';

vi.mock('svelte-i18n', () => ({ t: readable((key: string) => key) }));

describe('agent-onboarding-approval', () => {
  it('selects the provided approval mode and emits changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboardingApproval, { props: { approval: AgentApprovalMode.PlanOnly, onChange } });
    expect(screen.getByRole('button', { name: /assistant_onboarding_approval_plan/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /assistant_onboarding_approval_strict/ }));
    expect(onChange).toHaveBeenCalledWith(AgentApprovalMode.Strict);
  });
});
