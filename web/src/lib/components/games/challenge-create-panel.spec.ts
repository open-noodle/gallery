import ChallengeCreatePanel from '#lib/components/games/challenge-create-panel.svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

describe('ChallengeCreatePanel', () => {
  const base = { creating: false };

  const roundButton = (count: number) => page.getByTestId(`challenge-create-rounds-${count}`).element();
  const typeButton = (type: string) => page.getByTestId(`challenge-create-type-${type}`).element();

  it('offers the round counts and game types as buttons rather than a form', async () => {
    await render(ChallengeCreatePanel, { ...base, onCreate: () => {} });

    for (const count of [3, 5, 10]) {
      expect(roundButton(count)).toBeInTheDocument();
    }
    for (const type of ['mixed', 'location', 'date']) {
      expect(typeButton(type)).toBeInTheDocument();
    }
  });

  // The defaults are what a player who just presses Create gets, so they are worth pinning: five
  // rounds mixed is what the page created before this panel existed.
  it('creates five mixed rounds by default', async () => {
    const onCreate = vi.fn();
    await render(ChallengeCreatePanel, { ...base, onCreate });

    await userEvent.click(page.getByTestId('challenge-create-submit').element());

    expect(onCreate).toHaveBeenCalledWith({ roundCount: 5, type: 'mixed' });
  });

  it('creates with the chosen round count and type', async () => {
    const onCreate = vi.fn();
    await render(ChallengeCreatePanel, { ...base, onCreate });

    await userEvent.click(roundButton(10));
    await userEvent.click(typeButton('location'));
    await userEvent.click(page.getByTestId('challenge-create-submit').element());

    expect(onCreate).toHaveBeenCalledWith({ roundCount: 10, type: 'location' });
  });

  // aria-pressed rather than a colour alone: the selected round count and type are the only record
  // of what pressing Create will do, so the choice has to be exposed to assistive tech too.
  it('marks the selected round count and type as pressed', async () => {
    await render(ChallengeCreatePanel, { ...base, onCreate: () => {} });

    expect(roundButton(5)).toHaveAttribute('aria-pressed', 'true');
    expect(roundButton(3)).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(roundButton(3));

    expect(roundButton(3)).toHaveAttribute('aria-pressed', 'true');
    expect(roundButton(5)).toHaveAttribute('aria-pressed', 'false');
  });

  // Guards the double-submit that creates two challenges from one intent - generation is slow
  // enough (candidate queries plus CLIP prompts) for a second click to land comfortably.
  it('disables the create button while a challenge is being generated', async () => {
    await render(ChallengeCreatePanel, { creating: true, onCreate: () => {} });

    expect(page.getByTestId('challenge-create-submit').element()).toBeDisabled();
  });

  it('spins the create button while generating, so the wait does not read as a frozen page', async () => {
    // Disabling alone was reported as a freeze: generation takes several seconds, and a greyed-out
    // button communicates nothing. `loading` implies disabled, so the double-submit guard above
    // still holds - both assertions must keep passing together.
    await render(ChallengeCreatePanel, { creating: true, onCreate: () => {} });

    const submit = page.getByTestId('challenge-create-submit').element();
    expect(submit.querySelector('[data-testid="loading-spinner"]')).not.toBeNull();
    expect(submit).toBeDisabled();
  });

  it('shows no spinner when idle', async () => {
    await render(ChallengeCreatePanel, { ...base, onCreate: () => {} });

    expect(page.getByTestId('loading-spinner').query()).not.toBeInTheDocument();
  });

  // Solo only. game_solo_no_photos tells a player with no usable photos of their own to "include
  // partner or shared-space photos when you start a game" - so the toggles have to be here, on the
  // panel that starts one, and nowhere else for that copy to be true.
  describe('solo source toggles', () => {
    const sourceToggle = (source: 'partners' | 'spaces') =>
      page.getByTestId(`challenge-create-source-${source}`).element();

    it('offers no source toggles for a space challenge, whose pool is the space itself', async () => {
      await render(ChallengeCreatePanel, { ...base, onCreate: () => {} });

      // Deliberate absence - the panel itself must still render, so this cannot pass vacuously.
      expect(page.getByTestId('challenge-create-panel').element()).toBeInTheDocument();
      expect(page.getByTestId('challenge-create-source-partners').query()).toBeNull();
      expect(page.getByTestId('challenge-create-source-spaces').query()).toBeNull();
    });

    it('seeds the toggles from the stored preference', async () => {
      await render(ChallengeCreatePanel, {
        ...base,
        sources: { includePartners: true, includeSpaces: false },
        onCreate: () => {},
      });

      expect(sourceToggle('partners')).toBeChecked();
      expect(sourceToggle('spaces')).not.toBeChecked();
    });

    it('reports the chosen sources alongside the round count and type', async () => {
      const onCreate = vi.fn();
      await render(ChallengeCreatePanel, {
        ...base,
        sources: { includePartners: false, includeSpaces: false },
        onCreate,
      });

      await userEvent.click(sourceToggle('spaces'));
      await userEvent.click(page.getByTestId('challenge-create-submit').element());

      expect(onCreate).toHaveBeenCalledWith({
        roundCount: 5,
        type: 'mixed',
        sources: { includePartners: false, includeSpaces: true },
      });
    });
  });
});
