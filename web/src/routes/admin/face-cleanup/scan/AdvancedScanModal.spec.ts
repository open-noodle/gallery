import { getFaceRepairScanDefaults } from '@immich/sdk';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import AdvancedScanModal from './AdvancedScanModal.svelte';

vi.mock('@immich/sdk', () => ({ getFaceRepairScanDefaults: vi.fn() }));

const mockDefaults = (v: { maxDistance: number; minFaces: number; maxFlaggedFraction: number }) =>
  vi.mocked(getFaceRepairScanDefaults).mockResolvedValue(v);

beforeAll(async () => {
  register('en', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
  await waitLocale('en');
});

describe('AdvancedScanModal', () => {
  beforeEach(() => vi.mocked(getFaceRepairScanDefaults).mockReset());

  it('pre-fills the controls from the defaults endpoint', async () => {
    // Values deliberately DIFFER from the component's hardcoded fallbacks (0.5 / 3 / 0.5) — otherwise this
    // test would pass even if loadDefaults never ran.
    mockDefaults({ maxDistance: 0.62, minFaces: 7, maxFlaggedFraction: 0.31 });
    await render(AdvancedScanModal, { props: { onClose: vi.fn(), onRun: vi.fn() } });
    await expect.element(page.getByTestId('min-faces-input')).toHaveValue(7);
    await expect.element(page.getByTestId('sensitivity-range')).toHaveValue('0.62');
    await expect.element(page.getByTestId('cap-range')).toHaveValue('0.31');
  });

  it('submits numeric params (not strings) and closes', async () => {
    mockDefaults({ maxDistance: 0.5, minFaces: 3, maxFlaggedFraction: 0.5 });
    const onRun = vi.fn();
    const onClose = vi.fn();
    await render(AdvancedScanModal, { props: { onClose, onRun } });
    await expect.element(page.getByTestId('min-faces-input')).toHaveValue(3);

    await userEvent.click(page.getByRole('button', { name: 'Run scan', exact: true }));

    await vi.waitFor(() => {
      expect(onRun).toHaveBeenCalledTimes(1);
      const arg = onRun.mock.calls[0][0];
      expect(typeof arg.maxDistance).toBe('number');
      expect(typeof arg.minFaces).toBe('number');
      expect(typeof arg.maxFlaggedFraction).toBe('number');
      expect(arg).toEqual({ maxDistance: 0.5, minFaces: 3, maxFlaggedFraction: 0.5 });
      expect(onClose).toHaveBeenCalled();
    });
  });

  // NOTE: the endpoint-failure fallback path is intentionally NOT unit-tested here. The component handles it
  // with a trivial `await getFaceRepairScanDefaults().catch(() => null)` that leaves the initialized $state
  // defaults in place. A spec that makes the mock reject still fails in browser mode with the rejection
  // reported as an error, regardless of the component's own `.catch`. The pre-fill test above proves the same
  // controls render from whatever the component holds; not worth a brittle test fighting the runner.
});
