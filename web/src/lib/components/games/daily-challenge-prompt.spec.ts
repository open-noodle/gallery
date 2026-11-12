import DailyChallengePrompt from '#lib/components/games/daily-challenge-prompt.svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

describe('DailyChallengePrompt', () => {
  // No locale is registered in this file, so $t() returns the raw key and IGNORES interpolation
  // values entirely. Assertions here can only prove which key was chosen, never the copy.
  it('offers both an enable and a decline action', async () => {
    await render(DailyChallengePrompt, { pending: false, onEnable: vi.fn(), onDecline: vi.fn() });

    expect(page.getByTestId('daily-prompt-enable').element()).toBeInTheDocument();
    expect(page.getByTestId('daily-prompt-decline').element()).toBeInTheDocument();
  });

  it('calls onEnable when enabled', async () => {
    const onEnable = vi.fn();
    await render(DailyChallengePrompt, { pending: false, onEnable, onDecline: vi.fn() });

    // force: a real click on a disabled button would wait for it to enable; the point is that it never fires.
    await userEvent.click(page.getByTestId('daily-prompt-enable').element(), { force: true });

    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it('calls onDecline when declined', async () => {
    const onDecline = vi.fn();
    await render(DailyChallengePrompt, { pending: false, onEnable: vi.fn(), onDecline });

    await userEvent.click(page.getByTestId('daily-prompt-decline').element());

    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while the enable is in flight', async () => {
    // Enabling triggers generation on the reload - candidate queries plus CLIP prompts, seconds not
    // milliseconds. Without this the button looks broken on the one click that matters most, and a
    // second click would fire a second update.
    const onEnable = vi.fn();
    await render(DailyChallengePrompt, { pending: true, onEnable, onDecline: vi.fn() });

    expect(page.getByTestId('daily-prompt-enable').element()).toBeDisabled();
    expect(page.getByTestId('daily-prompt-decline').element()).toBeDisabled();

    // force: a real click on a disabled button would wait for it to enable; the point is that it never fires.
    await userEvent.click(page.getByTestId('daily-prompt-enable').element(), { force: true });
    expect(onEnable).not.toHaveBeenCalled();
  });

  it('shows a spinner in the enable button while pending, not just a disabled button', async () => {
    // Disabling alone is what a user reported as a freeze: generation takes ~10s, and a greyed-out
    // button says nothing is happening. The spinner is the difference between "working" and "broken".
    const { rerender } = await render(DailyChallengePrompt, { pending: false, onEnable: vi.fn(), onDecline: vi.fn() });

    expect(page.getByTestId('loading-spinner').query()).not.toBeInTheDocument();

    await rerender({ pending: true, onEnable: vi.fn(), onDecline: vi.fn() });

    // Scoped to the enable button: the decline write is a plain column update and needs no spinner.
    expect(
      page.getByTestId('daily-prompt-enable').element().querySelector('[data-testid="loading-spinner"]'),
    ).not.toBeNull();
    expect(
      page.getByTestId('daily-prompt-decline').element().querySelector('[data-testid="loading-spinner"]'),
    ).toBeNull();
  });
});
