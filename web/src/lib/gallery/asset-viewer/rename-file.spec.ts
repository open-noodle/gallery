import { eventManager } from '#lib/managers/event-manager.svelte.ts';
import { handleError } from '#lib/utils/handle-error.ts';
import { AssetRenameTargetState, checkAssetRename, getAssetInfo, renameAsset } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import { checkRenameState, isValidRenameName, normalizeExtension, renameFile, splitFileName } from './rename-file';

vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  checkAssetRename: vi.fn(),
  getAssetInfo: vi.fn(),
  renameAsset: vi.fn(),
  isHttpError: vi.fn((error: unknown) => typeof (error as { status?: unknown })?.status === 'number'),
}));
vi.mock('@immich/ui', async (orig) => ({
  ...(await orig<typeof import('@immich/ui')>()),
  modalManager: { showDialog: vi.fn() },
  toastManager: { primary: vi.fn(), danger: vi.fn() },
}));
vi.mock('#lib/utils/handle-error.ts', () => ({ handleError: vi.fn() }));

const asset = { id: 'asset-1', originalFileName: 'IMG_0007.JPEG' } as never;
const conflict = (state: string) => Object.assign(new Error('409'), { status: 409, data: { message: 'no', state } });
const renamed = { originalFileName: 'Beach.jpg', originalPath: '/library/Beach.jpg' };

describe('splitFileName', () => {
  it('splits the extension off and normalizes it as the server does', () => {
    expect(splitFileName('IMG_0007.JPEG')).toEqual({ name: 'IMG_0007', extension: '.jpg' });
    expect(splitFileName('clip.MPEG')).toEqual({ name: 'clip', extension: '.mpg' });
    expect(splitFileName('a.b.heic')).toEqual({ name: 'a.b', extension: '.heic' });
  });

  it('finds no extension in a name without one or a dot file', () => {
    expect(splitFileName('README')).toEqual({ name: 'README', extension: '' });
    expect(splitFileName('.hidden')).toEqual({ name: '.hidden', extension: '' });
  });
});

describe('normalizeExtension', () => {
  it.each([
    ['JPEG', 'jpg'],
    ['jpe', 'jpg'],
    ['tif', 'tiff'],
    ['3gpp', '3gp'],
    ['mpe', 'mpg'],
    ['m2t', 'mts'],
    ['HEIC', 'heic'],
  ])('maps %s to %s', (extension, expected) => {
    expect(normalizeExtension(extension)).toBe(expected);
  });
});

describe('isValidRenameName', () => {
  it('accepts an ordinary name, also with spaces around it', () => {
    expect(isValidRenameName('Beach 2006-08', '.jpg')).toBe(true);
    expect(isValidRenameName('  Beach  ', '.jpg')).toBe(true);
  });

  it.each(['', ' '.repeat(3), '.hidden', 'a/b', String.raw`a\b`, 'a\0b'])('rejects %j', (name) => {
    expect(isValidRenameName(name)).toBe(false);
  });

  it('counts bytes with the extension against the 255 limit', () => {
    expect(isValidRenameName('a'.repeat(251), '.jpg')).toBe(true);
    expect(isValidRenameName('a'.repeat(252), '.jpg')).toBe(false);
  });
});

describe('checkRenameState', () => {
  it('reports what the server found', async () => {
    vi.mocked(checkAssetRename).mockResolvedValue({ state: AssetRenameTargetState.Exists });

    await expect(checkRenameState('asset-1', 'Beach')).resolves.toBe(AssetRenameTargetState.Exists);
    expect(checkAssetRename).toHaveBeenCalledWith({ id: 'asset-1', fileName: 'Beach' });
  });

  it('knows nothing when the server has no such route or fails', async () => {
    vi.mocked(checkAssetRename).mockRejectedValue(Object.assign(new Error('404'), { status: 404 }));

    await expect(checkRenameState('asset-1', 'Beach')).resolves.toBeUndefined();
  });
});

describe('renameFile', () => {
  const options = { name: ' Beach ', extension: '.jpg', renameOnDisk: false };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(renameAsset).mockResolvedValue(renamed);
    vi.mocked(getAssetInfo).mockResolvedValue({ id: 'asset-1', originalFileName: 'Beach.jpg' } as never);
    vi.spyOn(eventManager, 'emit').mockImplementation(() => {});
  });

  it('renames the name only, refreshes the open asset and says so', async () => {
    await expect(renameFile(asset, options)).resolves.toBe('renamed');

    expect(renameAsset).toHaveBeenCalledWith({ id: 'asset-1', assetRenameDto: { fileName: 'Beach' } });
    expect(eventManager.emit).toHaveBeenCalledWith(
      'AssetUpdate',
      expect.objectContaining({ originalFileName: 'Beach.jpg' }),
    );
    expect(toastManager.primary).toHaveBeenCalledWith('rename_file_success');
  });

  it('asks for the rename on disk', async () => {
    await renameFile(asset, { ...options, renameOnDisk: true, state: AssetRenameTargetState.Free });

    expect(renameAsset).toHaveBeenCalledWith({
      id: 'asset-1',
      assetRenameDto: { fileName: 'Beach', renameOnDisk: true },
    });
    expect(modalManager.showDialog).not.toHaveBeenCalled();
  });

  it('does not ask about an offline item', async () => {
    await renameFile(asset, { ...options, renameOnDisk: true, state: AssetRenameTargetState.Offline });

    expect(modalManager.showDialog).not.toHaveBeenCalled();
  });

  describe('a trashed item at the new name', () => {
    it('asks first, and deletes it only when confirmed', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(true as never);

      await expect(
        renameFile(asset, { ...options, renameOnDisk: true, state: AssetRenameTargetState.Trashed }),
      ).resolves.toBe('renamed');

      expect(modalManager.showDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'rename_file_trashed_title', confirmColor: 'danger' }),
      );
      expect(renameAsset).toHaveBeenCalledWith({
        id: 'asset-1',
        assetRenameDto: { fileName: 'Beach', renameOnDisk: true, deleteTrashed: true },
      });
    });

    it('changes nothing when the user declines', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(false as never);

      await expect(
        renameFile(asset, { ...options, renameOnDisk: true, state: AssetRenameTargetState.Trashed }),
      ).resolves.toBe('cancelled');

      expect(renameAsset).not.toHaveBeenCalled();
      expect(toastManager.primary).not.toHaveBeenCalled();
    });

    it('asks then too when the server only finds it at submit time', async () => {
      vi.mocked(renameAsset)
        .mockRejectedValueOnce(conflict(AssetRenameTargetState.Trashed))
        .mockResolvedValueOnce(renamed);
      vi.mocked(modalManager.showDialog).mockResolvedValue(true as never);

      await expect(renameFile(asset, { ...options, renameOnDisk: true })).resolves.toBe('renamed');

      expect(renameAsset).toHaveBeenLastCalledWith({
        id: 'asset-1',
        assetRenameDto: { fileName: 'Beach', renameOnDisk: true, deleteTrashed: true },
      });
    });

    it('does not ask a second time after the user confirmed', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(true as never);
      vi.mocked(renameAsset).mockRejectedValue(conflict(AssetRenameTargetState.Trashed));

      await expect(
        renameFile(asset, { ...options, renameOnDisk: true, state: AssetRenameTargetState.Trashed }),
      ).resolves.toBe('failed');

      expect(modalManager.showDialog).toHaveBeenCalledOnce();
    });
  });

  it('leaves a taken name to the dialog, without a toast', async () => {
    vi.mocked(renameAsset).mockRejectedValue(conflict(AssetRenameTargetState.Exists));

    await expect(renameFile(asset, { ...options, renameOnDisk: true })).resolves.toBe('exists');

    expect(handleError).not.toHaveBeenCalled();
    expect(eventManager.emit).not.toHaveBeenCalled();
  });

  it('reports any other failure and leaves the dialog open', async () => {
    const error = Object.assign(new Error('409'), {
      status: 409,
      data: { message: 'Another file operation is running' },
    });
    vi.mocked(renameAsset).mockRejectedValue(error);

    await expect(renameFile(asset, { ...options, renameOnDisk: true })).resolves.toBe('failed');

    expect(handleError).toHaveBeenCalledWith(error, 'errors.unable_to_rename_file');
    expect(toastManager.primary).not.toHaveBeenCalled();
  });
});
