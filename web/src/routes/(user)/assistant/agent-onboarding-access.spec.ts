import { AgentPermissionPreset } from '@immich/sdk';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import AgentOnboardingAccess from './agent-onboarding-access.svelte';

vi.mock('svelte-i18n', () => ({ t: readable((key: string) => key) }));

describe('agent-onboarding-access', () => {
  it('marks the provided preset as selected', () => {
    render(AgentOnboardingAccess, {
      props: { provider: 'local', preset: AgentPermissionPreset.VisualOrganizer, onChange: vi.fn() },
    });
    expect(screen.getByRole('button', { name: /assistant_permission_preset_visual_organizer/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('emits onChange when a preset is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(AgentOnboardingAccess, {
      props: { provider: 'local', preset: AgentPermissionPreset.VisualOrganizer, onChange },
    });
    await user.click(screen.getByRole('button', { name: /assistant_permission_preset_careful/ }));
    expect(onChange).toHaveBeenCalledWith(AgentPermissionPreset.Careful);
  });

  it('warns when Power user is paired with a cloud provider, not a local one', () => {
    const { unmount } = render(AgentOnboardingAccess, {
      props: { provider: 'openai', preset: AgentPermissionPreset.LocalPowerUser, onChange: vi.fn() },
    });
    expect(screen.getByText('assistant_onboarding_access_cloud_caution')).toBeInTheDocument();
    unmount();
    render(AgentOnboardingAccess, {
      props: { provider: 'local', preset: AgentPermissionPreset.LocalPowerUser, onChange: vi.fn() },
    });
    expect(screen.queryByText('assistant_onboarding_access_cloud_caution')).not.toBeInTheDocument();
  });
});
