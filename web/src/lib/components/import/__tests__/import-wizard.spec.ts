import type { TakeoutMediaItem } from '#lib/utils/google-takeout-parser.ts';
import { scanTakeoutFiles } from '#lib/utils/google-takeout-scanner.ts';
import { uploadTakeoutItem } from '#lib/utils/google-takeout-uploader.ts';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import ImportWizard from '../import-wizard.svelte';

vi.mock('#lib/utils/google-takeout-scanner.js', () => ({
  scanTakeoutFiles: vi.fn(),
}));

vi.mock('#lib/utils/google-takeout-uploader.js', () => ({
  uploadTakeoutItem: vi.fn(),
  createImportAlbums: vi.fn(),
}));

describe('ImportWizard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders step indicator', async () => {
    const { getByTestId } = await render(ImportWizard);
    // Step indicator renders step-0 through step-4
    await expect.element(getByTestId('step-0')).toBeInTheDocument();
    await expect.element(getByTestId('step-4')).toBeInTheDocument();
  });

  it('renders source step initially', async () => {
    const { getByTestId } = await render(ImportWizard);
    // Source step shows Google source card
    await expect.element(getByTestId('source-google')).toBeInTheDocument();
  });

  it('advances to files step when Next clicked on source', async () => {
    const { getByText, getByTestId } = await render(ImportWizard);

    // Click Next on source step
    await userEvent.click(getByText('next'));

    // Should now show files step (drop zone)
    await expect.element(getByTestId('drop-zone')).toBeInTheDocument();
  });

  it('imports name-only Takeout items', async () => {
    const file = new File(['bytes'], 'IMG_001.jpg', { lastModified: 1_609_459_200_000 });
    const item: TakeoutMediaItem = {
      path: 'Takeout/Google Photos/Trip/IMG_001.jpg',
      name: 'IMG_001.jpg',
      size: file.size,
      lastModified: file.lastModified,
      getFile: () => Promise.resolve(file),
      metadata: undefined,
      albumName: undefined,
    };
    vi.mocked(scanTakeoutFiles).mockResolvedValue({
      items: [item],
      albums: [],
      stats: {
        totalMedia: 1,
        withLocation: 0,
        withDate: 0,
        favorites: 0,
        archived: 0,
        dateRange: undefined,
      },
    });
    vi.mocked(uploadTakeoutItem).mockResolvedValue({ assetId: 'asset-1', status: 'imported' });

    const { container, getByText, getByTestId } = await render(ImportWizard);

    await userEvent.click(getByText('next'));

    const zipInput = container.querySelector('input[type="file"][accept=".zip"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File(['zip'], 'takeout.zip', { type: 'application/zip' }));
    zipInput.files = transfer.files;
    zipInput.dispatchEvent(new Event('change', { bubbles: true }));
    await userEvent.click(getByTestId('next-button'));

    await expect.element(getByTestId('import-button')).toBeInTheDocument();
    await userEvent.click(getByTestId('import-button'));

    await vi.waitFor(() => expect(uploadTakeoutItem).toHaveBeenCalledOnce());
    expect(vi.mocked(uploadTakeoutItem).mock.calls[0][0]).toMatchObject({
      path: 'Takeout/Google Photos/Trip/IMG_001.jpg',
      name: 'IMG_001.jpg',
      size: file.size,
      lastModified: file.lastModified,
    });
  });
});
