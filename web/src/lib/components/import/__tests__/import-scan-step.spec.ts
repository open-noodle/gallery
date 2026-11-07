import type { ScanProgress } from '#lib/utils/google-takeout-scanner.ts';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import ImportScanStep from '../import-scan-step.svelte';

function makeScanProgress(overrides?: Partial<ScanProgress>): ScanProgress {
  return {
    currentFile: 'Takeout/Google Photos/Vacation/IMG_1234.jpg',
    currentZip: 'takeout-20240101.zip',
    zipIndex: 1,
    zipCount: 3,
    mediaCount: 42,
    withLocation: 30,
    withDate: 40,
    favorites: 5,
    archived: 2,
    albumNames: new Set(['Vacation', 'Family']),
    ...overrides,
  };
}

describe('ImportScanStep', () => {
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders scanning title', async () => {
    const { getByText } = await render(ImportScanStep, { progress: makeScanProgress(), onCancel });

    await expect.element(getByText('import_scanning')).toBeInTheDocument();
  });

  it('shows current file being scanned', async () => {
    const progress = makeScanProgress({ currentFile: 'Photos/beach.jpg' });
    const { getByText } = await render(ImportScanStep, { progress, onCancel });

    await expect.element(getByText('Photos/beach.jpg')).toBeInTheDocument();
  });

  it('shows media count', async () => {
    const progress = makeScanProgress({ mediaCount: 42 });
    const { getByText } = await render(ImportScanStep, { progress, onCancel });

    await expect.element(getByText('42')).toBeInTheDocument();
  });

  it('cancel button calls onCancel', async () => {
    const { getByText } = await render(ImportScanStep, { progress: makeScanProgress(), onCancel });

    await userEvent.click(getByText('cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
