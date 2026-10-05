import { AssetVisibility, updateAsset, type AssetResponseDto } from '@immich/sdk';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import {
  canCopyImageToClipboard,
  getAssetFilename,
  getEditableAssetsWithWarning,
  getFilenameExtension,
  toggleArchive,
} from './asset-utils';

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    updateAsset: vi.fn(),
  };
});

vi.mock('@immich/ui', async (orig) => {
  const actual = await orig<typeof import('@immich/ui')>();
  return {
    ...actual,
    toastManager: { primary: vi.fn(), danger: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
  };
});

describe('get file extension from filename', () => {
  it('returns the extension without including the dot', () => {
    expect(getFilenameExtension('filename.txt')).toEqual('txt');
  });

  it('takes the last file extension and ignores the rest', () => {
    expect(getFilenameExtension('filename.txt.pdf')).toEqual('pdf');
    expect(getFilenameExtension('filename.txt.pdf.jpg')).toEqual('jpg');
  });

  it('returns an empty string when no file extension is found', () => {
    expect(getFilenameExtension('filename')).toEqual('');
    expect(getFilenameExtension('filename.')).toEqual('');
    expect(getFilenameExtension('filename..')).toEqual('');
    expect(getFilenameExtension('.filename')).toEqual('');
  });

  it('returns the extension from a filepath', () => {
    expect(getFilenameExtension('/folder/file.txt')).toEqual('txt');
    expect(getFilenameExtension('./folder/file.txt')).toEqual('txt');
    expect(getFilenameExtension('~/folder/file.txt')).toEqual('txt');
    expect(getFilenameExtension('./folder/.file.txt')).toEqual('txt');
    expect(getFilenameExtension('/folder.with.dots/file.txt')).toEqual('txt');
  });
});

describe('get asset filename', () => {
  it('returns the filename including file extension', () => {
    for (const { asset, result } of [
      {
        asset: {
          originalFileName: 'filename',
          originalPath: '/data/library/test/2016/2016-08-30/filename.jpg',
        },
        result: 'filename.jpg',
      },
      {
        asset: {
          originalFileName: 'new-filename',
          originalPath: '/data/library/89d14e47-a40d-4cae-a347-a914cdef1f22/2016/2016-08-30/filename.jpg',
        },
        result: 'new-filename.jpg',
      },
      {
        asset: {
          originalFileName: 'new-filename.txt',
          originalPath: '/data/library/test/2016/2016-08-30/filename.txt.jpg',
        },
        result: 'new-filename.txt.jpg',
      },
    ]) {
      expect(getAssetFilename(asset as AssetResponseDto)).toEqual(result);
    }
  });
});

describe('copy image to clipboard', () => {
  // This test is dubious, as it totally on the environment where the test is run which is mocked.
  it('should allow copy image to clipboard', () => {
    expect(canCopyImageToClipboard()).toEqual(true);
  });
});

describe('toggleArchive', () => {
  beforeEach(() => {
    vi.mocked(updateAsset).mockReset();
  });

  it('updates both isArchived and visibility when archiving', async () => {
    vi.mocked(updateAsset).mockResolvedValue({
      isArchived: true,
      visibility: AssetVisibility.Archive,
    } as AssetResponseDto);

    const asset = { id: '1', isArchived: false, visibility: AssetVisibility.Timeline } as AssetResponseDto;
    await toggleArchive(asset);

    expect(asset.isArchived).toBe(true);
    // regression: visibility must be refreshed so the timeline correctly excludes the archived asset
    expect(asset.visibility).toBe(AssetVisibility.Archive);
  });

  it('updates both isArchived and visibility when unarchiving', async () => {
    vi.mocked(updateAsset).mockResolvedValue({
      isArchived: false,
      visibility: AssetVisibility.Timeline,
    } as AssetResponseDto);

    const asset = { id: '1', isArchived: true, visibility: AssetVisibility.Archive } as AssetResponseDto;
    await toggleArchive(asset);

    expect(asset.isArchived).toBe(false);
    expect(asset.visibility).toBe(AssetVisibility.Timeline);
  });
});

describe('getEditableAssetsWithWarning (#734)', () => {
  const asset = (id: string): TimelineAsset => ({ id }) as unknown as TimelineAsset;

  it('returns the ids that are in editableAssetIds and warns of nothing when all are editable', async () => {
    const { toastManager } = await import('@immich/ui');

    const ids = getEditableAssetsWithWarning([asset('a'), asset('b')], ['a', 'b']);

    expect(ids).toEqual(['a', 'b']);
    expect(toastManager.warning).not.toHaveBeenCalled();
  });

  it('drops non-editable assets and reports the skipped count via a warning toast', async () => {
    const { toastManager } = await import('@immich/ui');

    const ids = getEditableAssetsWithWarning([asset('a'), asset('b'), asset('c')], ['a']);

    expect(ids).toEqual(['a']);
    expect(toastManager.warning).toHaveBeenCalledTimes(1);
  });
});
