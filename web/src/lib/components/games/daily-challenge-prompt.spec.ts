import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import DailyChallengePrompt from '$lib/components/games/daily-challenge-prompt.svelte';

describe('DailyChallengePrompt', () => {
  // No locale is registered in this file, so $t() returns the raw key and IGNORES interpolation
  // values entirely. Assertions here can only prove which key was chosen, never the copy.
  it('offers both an enable and a decline action', () => {
    render(DailyChallengePrompt, { pending: false, onEnable: vi.fn(), onDecline: vi.fn() });

    expect(screen.getByTestId('daily-prompt-enable')).toBeInTheDocument();
    expect(screen.getByTestId('daily-prompt-decline')).toBeInTheDocument();
  });

  it('calls onEnable when enabled', async () => {
    const onEnable = vi.fn();
    render(DailyChallengePrompt, { pending: false, onEnable, onDecline: vi.fn() });

    await userEvent.click(screen.getByTestId('daily-prompt-enable'));

    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it('calls onDecline when declined', async () => {
    const onDecline = vi.fn();
    render(DailyChallengePrompt, { pending: false, onEnable: vi.fn(), onDecline });

    await userEvent.click(screen.getByTestId('daily-prompt-decline'));

    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while the enable is in flight', async () => {
    // Enabling triggers generation on the reload - candidate queries plus CLIP prompts, seconds not
    // milliseconds. Without this the button looks broken on the one click that matters most, and a
    // second click would fire a second update.
    const onEnable = vi.fn();
    render(DailyChallengePrompt, { pending: true, onEnable, onDecline: vi.fn() });

    expect(screen.getByTestId('daily-prompt-enable')).toBeDisabled();
    expect(screen.getByTestId('daily-prompt-decline')).toBeDisabled();

    await userEvent.click(screen.getByTestId('daily-prompt-enable'));
    expect(onEnable).not.toHaveBeenCalled();
  });

  it('shows a spinner in the enable button while pending, not just a disabled button', async () => {
    // Disabling alone is what a user reported as a freeze: generation takes ~10s, and a greyed-out
    // button says nothing is happening. The spinner is the difference between "working" and "broken".
    const { rerender } = render(DailyChallengePrompt, { pending: false, onEnable: vi.fn(), onDecline: vi.fn() });

    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();

    await rerender({ pending: true, onEnable: vi.fn(), onDecline: vi.fn() });

    // Scoped to the enable button: the decline write is a plain column update and needs no spinner.
    expect(screen.getByTestId('daily-prompt-enable').querySelector('[data-testid="loading-spinner"]')).not.toBeNull();
    expect(screen.getByTestId('daily-prompt-decline').querySelector('[data-testid="loading-spinner"]')).toBeNull();
  });
});
