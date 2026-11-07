import SharedLinkExpirationHost from '#lib/gallery/__mocks__/shared-link-expiration-host.stub.svelte';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { Settings } from 'luxon';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

// The server validates `expiresAt` with Zod's `z.iso.datetime()`, which only accepts
// UTC ("Z") timestamps and rejects any string carrying a numeric timezone offset.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('SharedLinkExpiration component', () => {
  let originalZone: typeof Settings.defaultZone;

  beforeEach(() => {
    originalZone = Settings.defaultZone;
    // Reproduce a user behind a non-UTC timezone. Luxon's `DateTime.toISO()` emits the
    // local offset (e.g. `-04:00`) here — which the server rejects. A UTC test env would
    // mask the bug because the offset would collapse to `Z`.
    Settings.defaultZone = 'America/New_York';
  });

  afterEach(() => {
    Settings.defaultZone = originalZone;
  });

  // Preset buttons carry visible text; the date-picker trigger is icon-only.
  const getPresetButtons = () =>
    page
      .getByRole('button')
      .elements()
      .filter((button) => button.textContent?.trim())
      .map((button) => page.elementLocator(button));
  const expiresAt = () => page.getByTestId('expires-at-value');

  it('emits a UTC (Z) ISO 8601 string when an expiry preset is selected', async () => {
    await renderWithTooltips(SharedLinkExpirationHost, {});

    const presetButtons = getPresetButtons();
    expect(presetButtons.length).toBeGreaterThan(1);

    // The last preset is a positive duration ("in 1 year"); the first is "never".
    await presetButtons.at(-1)!.click();
    await expect.poll(() => expiresAt().element().textContent).not.toBe('');

    const value = expiresAt().element().textContent ?? '';
    expect(value).toMatch(ISO_UTC);
    expect(value).not.toContain('+');
    // Sanity: the emitted instant is a real, future date.
    expect(Number.isNaN(Date.parse(value))).toBe(false);
    expect(Date.parse(value)).toBeGreaterThan(Date.now());
  });

  it('clears the expiry when the "never" preset is selected', async () => {
    await renderWithTooltips(SharedLinkExpirationHost, {});

    const presetButtons = getPresetButtons();
    // Set a real expiry first, then "never" (the first preset) should clear it.
    await presetButtons.at(-1)!.click();
    await expect.poll(() => expiresAt().element().textContent).not.toBe('');

    await presetButtons[0].click();
    await expect.poll(() => expiresAt().element().textContent).toBe('');
  });
});
