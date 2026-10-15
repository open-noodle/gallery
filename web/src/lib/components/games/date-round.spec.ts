import DateRound from '#lib/components/games/date-round.svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

describe('DateRound', () => {
  const base = { challengeId: 'c1', index: 0, minYear: 2009, maxYear: 2026 };

  it('renders the timeline', async () => {
    await render(DateRound, { ...base, onGuess: () => {} });
    expect(page.getByTestId('date-round').element()).toBeInTheDocument();
    expect(page.getByTestId('date-round-slider').element()).toBeInTheDocument();
  });

  it('emits a UTC calendar day for the selected year', async () => {
    const onGuess = vi.fn();
    await render(DateRound, { ...base, onGuess });

    await userEvent.click(page.getByTestId('date-round-guess').element());

    expect(onGuess).toHaveBeenCalledTimes(1);
    const iso = onGuess.mock.calls[0][0] as string;
    // Must be midnight UTC - the server scores by UTC day index, so a local
    // midnight would silently land on the previous or next day.
    expect(iso).toMatch(/T00:00:00\.000Z$/);
    expect(new Date(iso).getUTCFullYear()).toBeGreaterThanOrEqual(2009);
    expect(new Date(iso).getUTCFullYear()).toBeLessThanOrEqual(2026);
  });

  // July is simply the mid-year default the month select opens on, so an untouched round still
  // emits the date it always did. It is no longer a scoring mitigation: the server now grades a
  // date round at month granularity (monthOffsetDays), so naming the right month scores full marks
  // and there is nothing left to "centre" against.
  it('defaults to July of the mid-range year', async () => {
    const onGuess = vi.fn();
    // minYear 2009 + maxYear 2026 averages to 2017.5, rounding to the default slider year 2018.
    await render(DateRound, { ...base, onGuess });

    await userEvent.click(page.getByTestId('date-round-guess').element());

    expect(onGuess).toHaveBeenCalledWith('2018-07-01T00:00:00.000Z');
  });

  it('gives the slider an accessible name', async () => {
    await render(DateRound, { ...base, onGuess: () => {} });
    // $t() is untranslated in this test environment (no locale catalog is loaded), so
    // the accessible name resolves to the raw i18n key rather than its English text.
    expect(page.getByLabelText('game_when_was_this').element()).toBe(page.getByTestId('date-round-slider').element());
  });

  // A year-only guess could never score full marks: the server graded the exact day, so whatever
  // the player picked the emitted date still missed the real capture day by up to half a year.
  // Picking the month is what makes a perfect score reachable.
  describe('month selection', () => {
    const monthSelect = () => page.getByTestId('date-round-month').element() as HTMLSelectElement;

    it('offers all twelve months', async () => {
      await render(DateRound, { ...base, onGuess: () => {} });
      expect(monthSelect().options).toHaveLength(12);
    });

    it('emits the first of the selected month', async () => {
      const onGuess = vi.fn();
      await render(DateRound, { ...base, onGuess });

      await userEvent.selectOptions(monthSelect(), '3');
      await userEvent.click(page.getByTestId('date-round-guess').element());

      // The 1st, at midnight UTC: the server grades by month, so the day only has to identify
      // which month was picked - and a local-midnight Date could land in the neighbouring one.
      expect(onGuess).toHaveBeenCalledWith('2018-03-01T00:00:00.000Z');
    });

    it('keeps the selected month when the year changes', async () => {
      const onGuess = vi.fn();
      await render(DateRound, { ...base, onGuess });

      await userEvent.selectOptions(monthSelect(), '11');
      await userEvent.fill(page.getByTestId('date-round-slider').element(), '2022');
      await userEvent.click(page.getByTestId('date-round-guess').element());

      expect(onGuess).toHaveBeenCalledWith('2022-11-01T00:00:00.000Z');
    });

    it('gives the month select an accessible name', async () => {
      await render(DateRound, { ...base, onGuess: () => {} });
      expect(page.getByLabelText('month').element()).toBe(monthSelect());
    });
  });
});
