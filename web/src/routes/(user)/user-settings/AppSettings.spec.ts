import { cropFacesFromAsset, showSpaceBadges } from '#lib/gallery/stores/preferences.store.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { get } from 'svelte/store';
import { expect } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import AppSettings from './AppSettings.svelte';

describe('AppSettings — crop faces switch', () => {
  beforeEach(() => {
    cropFacesFromAsset.set(true);
  });

  // The test harness's svelte-i18n instance (see test/unit/setup.ts) is initialised with
  // fallbackLocale: 'dev' and no registered dictionaries, so $t() resolves to the raw key rather
  // than translated English text — the same convention FeatureSettings.spec.ts relies on when it
  // matches `name: 'memory_type_on_this_day'` verbatim.
  it('reflects the store when cropping is on', async () => {
    await renderWithTooltips(AppSettings, {});
    await expect.element(page.getByRole('switch', { name: 'crop_faces_from_photo' })).toBeChecked();
  });

  it('writes false to the store when switched off', async () => {
    await renderWithTooltips(AppSettings, {});

    await userEvent.click(page.getByRole('switch', { name: 'crop_faces_from_photo' }));

    await expect.poll(() => get(cropFacesFromAsset)).toBe(false);
  });

  it('reflects an already-off store on mount', async () => {
    cropFacesFromAsset.set(false);
    await renderWithTooltips(AppSettings, {});
    await expect.element(page.getByRole('switch', { name: 'crop_faces_from_photo' })).not.toBeChecked();
  });
});

describe('AppSettings — space icons switch', () => {
  beforeEach(() => {
    showSpaceBadges.set(true);
  });

  it('is on by default', async () => {
    await renderWithTooltips(AppSettings, {});
    await expect.element(page.getByRole('switch', { name: 'show_space_badges' })).toBeChecked();
  });

  it('writes false to the store when switched off', async () => {
    await renderWithTooltips(AppSettings, {});

    await userEvent.click(page.getByRole('switch', { name: 'show_space_badges' }));

    await expect.poll(() => get(showSpaceBadges)).toBe(false);
  });
});
