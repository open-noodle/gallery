import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import DateRound from '$lib/components/games/date-round.svelte';

describe('DateRound', () => {
  const base = { challengeId: 'c1', index: 0, minYear: 2009, maxYear: 2026 };

  it('renders the timeline', () => {
    render(DateRound, { ...base, onGuess: () => {} });
    expect(screen.getByTestId('date-round')).toBeInTheDocument();
    expect(screen.getByTestId('date-round-slider')).toBeInTheDocument();
  });

  it('emits a UTC calendar day for the selected year', async () => {
    const onGuess = vi.fn();
    render(DateRound, { ...base, onGuess });

    await userEvent.click(screen.getByTestId('date-round-guess'));

    expect(onGuess).toHaveBeenCalledTimes(1);
    const iso = onGuess.mock.calls[0][0] as string;
    // Must be midnight UTC - the server scores by UTC day index, so a local
    // midnight would silently land on the previous or next day.
    expect(iso).toMatch(/T00:00:00\.000Z$/);
    expect(new Date(iso).getUTCFullYear()).toBeGreaterThanOrEqual(2009);
    expect(new Date(iso).getUTCFullYear()).toBeLessThanOrEqual(2026);
  });

  it('gives the slider an accessible name', () => {
    render(DateRound, { ...base, onGuess: () => {} });
    // $t() is untranslated in this test environment (no locale catalog is loaded), so
    // the accessible name resolves to the raw i18n key rather than its English text.
    expect(screen.getByLabelText('game_when_was_this')).toBe(screen.getByTestId('date-round-slider'));
  });
});
