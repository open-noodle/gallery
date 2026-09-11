import { fireEvent, render, screen } from '@testing-library/svelte';
import ChallengeCreatePanel from '$lib/components/games/challenge-create-panel.svelte';

describe('ChallengeCreatePanel', () => {
  const base = { creating: false };

  const roundButton = (count: number) => screen.getByTestId(`challenge-create-rounds-${count}`);
  const typeButton = (type: string) => screen.getByTestId(`challenge-create-type-${type}`);

  it('offers the round counts and game types as buttons rather than a form', () => {
    render(ChallengeCreatePanel, { ...base, onCreate: () => {} });

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
    render(ChallengeCreatePanel, { ...base, onCreate });

    await fireEvent.click(screen.getByTestId('challenge-create-submit'));

    expect(onCreate).toHaveBeenCalledWith({ roundCount: 5, type: 'mixed' });
  });

  it('creates with the chosen round count and type', async () => {
    const onCreate = vi.fn();
    render(ChallengeCreatePanel, { ...base, onCreate });

    await fireEvent.click(roundButton(10));
    await fireEvent.click(typeButton('location'));
    await fireEvent.click(screen.getByTestId('challenge-create-submit'));

    expect(onCreate).toHaveBeenCalledWith({ roundCount: 10, type: 'location' });
  });

  // aria-pressed rather than a colour alone: the selected round count and type are the only record
  // of what pressing Create will do, so the choice has to be exposed to assistive tech too.
  it('marks the selected round count and type as pressed', async () => {
    render(ChallengeCreatePanel, { ...base, onCreate: () => {} });

    expect(roundButton(5)).toHaveAttribute('aria-pressed', 'true');
    expect(roundButton(3)).toHaveAttribute('aria-pressed', 'false');

    await fireEvent.click(roundButton(3));

    expect(roundButton(3)).toHaveAttribute('aria-pressed', 'true');
    expect(roundButton(5)).toHaveAttribute('aria-pressed', 'false');
  });

  // Guards the double-submit that creates two challenges from one intent - generation is slow
  // enough (candidate queries plus CLIP prompts) for a second click to land comfortably.
  it('disables the create button while a challenge is being generated', () => {
    render(ChallengeCreatePanel, { creating: true, onCreate: () => {} });

    expect(screen.getByTestId('challenge-create-submit')).toBeDisabled();
  });

  it('spins the create button while generating, so the wait does not read as a frozen page', () => {
    // Disabling alone was reported as a freeze: generation takes several seconds, and a greyed-out
    // button communicates nothing. `loading` implies disabled, so the double-submit guard above
    // still holds - both assertions must keep passing together.
    render(ChallengeCreatePanel, { creating: true, onCreate: () => {} });

    const submit = screen.getByTestId('challenge-create-submit');
    expect(submit.querySelector('[data-testid="loading-spinner"]')).not.toBeNull();
    expect(submit).toBeDisabled();
  });

  it('shows no spinner when idle', () => {
    render(ChallengeCreatePanel, { ...base, onCreate: () => {} });

    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
  });

  // Solo only. game_solo_no_photos tells a player with no usable photos of their own to "include
  // partner or shared-space photos when you start a game" - so the toggles have to be here, on the
  // panel that starts one, and nowhere else for that copy to be true.
  describe('solo source toggles', () => {
    const sourceToggle = (source: 'partners' | 'spaces') => screen.getByTestId(`challenge-create-source-${source}`);

    it('offers no source toggles for a space challenge, whose pool is the space itself', () => {
      render(ChallengeCreatePanel, { ...base, onCreate: () => {} });

      // Deliberate absence - the panel itself must still render, so this cannot pass vacuously.
      expect(screen.getByTestId('challenge-create-panel')).toBeInTheDocument();
      expect(screen.queryByTestId('challenge-create-source-partners')).toBeNull();
      expect(screen.queryByTestId('challenge-create-source-spaces')).toBeNull();
    });

    it('seeds the toggles from the stored preference', () => {
      render(ChallengeCreatePanel, {
        ...base,
        sources: { includePartners: true, includeSpaces: false },
        onCreate: () => {},
      });

      expect(sourceToggle('partners')).toBeChecked();
      expect(sourceToggle('spaces')).not.toBeChecked();
    });

    it('reports the chosen sources alongside the round count and type', async () => {
      const onCreate = vi.fn();
      render(ChallengeCreatePanel, {
        ...base,
        sources: { includePartners: false, includeSpaces: false },
        onCreate,
      });

      await fireEvent.click(sourceToggle('spaces'));
      await fireEvent.click(screen.getByTestId('challenge-create-submit'));

      expect(onCreate).toHaveBeenCalledWith({
        roundCount: 5,
        type: 'mixed',
        sources: { includePartners: false, includeSpaces: true },
      });
    });
  });
});
