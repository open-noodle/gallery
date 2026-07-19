// album.service.spec.ts
import type { AlbumResponseDto } from '@immich/sdk';
import type { BulkIdResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SpacePickerModal from '$lib/modals/SpacePickerModal.svelte';
import { handleLinkAlbumToSpace, notifyAddToAlbum } from './album.service';

const linkAlbum = vi.fn();
const showModal = vi.fn();
const primary = vi.fn();
const info = vi.fn();
const warning = vi.fn();
const handleError = vi.fn();

vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  linkAlbum: (...a: unknown[]) => linkAlbum(...a),
}));

vi.mock('@immich/ui', async (orig) => ({
  ...(await orig<typeof import('@immich/ui')>()),
  modalManager: { show: (...a: unknown[]) => showModal(...a) },
  toastManager: {
    primary: (...a: unknown[]) => primary(...a),
    info: (...a: unknown[]) => info(...a),
    warning: (...a: unknown[]) => warning(...a),
  },
}));

vi.mock('$lib/utils/handle-error', () => ({ handleError: (...a: unknown[]) => handleError(...a) }));

vi.mock('$lib/utils/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/i18n')>()),
  getFormatter: () =>
    Promise.resolve(
      (key: string, opts?: { values?: Record<string, unknown> }) => `${key}:${JSON.stringify(opts?.values ?? {})}`,
    ),
}));

const album = { id: 'album-1', albumName: 'Trip' } as AlbumResponseDto;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleLinkAlbumToSpace', () => {
  it('opens the existing space picker', async () => {
    showModal.mockResolvedValue(undefined);
    await handleLinkAlbumToSpace(album);
    expect(showModal).toHaveBeenCalledWith(SpacePickerModal, {});
  });

  it('does nothing and returns false when the picker is dismissed without a selection', async () => {
    showModal.mockResolvedValue(undefined);
    await expect(handleLinkAlbumToSpace(album)).resolves.toBe(false);
    expect(linkAlbum).not.toHaveBeenCalled();
    expect(primary).not.toHaveBeenCalled();
  });

  it('links the album to the picked space, toasts, and returns true', async () => {
    showModal.mockResolvedValue({ id: 'space-1', name: 'Family' });
    linkAlbum.mockResolvedValue(undefined);

    await expect(handleLinkAlbumToSpace(album)).resolves.toBe(true);

    expect(linkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'album-1' });
    expect(primary).toHaveBeenCalledWith('album_linked_to_space:{"space":"Family"}');
  });

  it('shows an error and returns false when linking fails', async () => {
    showModal.mockResolvedValue({ id: 'space-1', name: 'Family' });
    const error = new Error('network');
    linkAlbum.mockRejectedValue(error);

    await expect(handleLinkAlbumToSpace(album)).resolves.toBe(false);

    expect(handleError).toHaveBeenCalledWith(error, 'spaces_linked_albums_error_link:{}');
  });
});

describe('notifyAddToAlbum — truthful severity (#764)', () => {
  const $t = ((key: string, opts?: { values?: Record<string, unknown> }) =>
    `${key}:${JSON.stringify(opts?.values ?? {})}`) as never;

  const ok = (id: string): BulkIdResponseDto => ({ id, success: true });
  const dup = (id: string): BulkIdResponseDto => ({ id, success: false, error: 'duplicate' as never });
  const denied = (id: string): BulkIdResponseDto => ({ id, success: false, error: 'no_permission' as never });

  it('all succeeded → green success toast (primary) with View album', () => {
    notifyAddToAlbum($t, 'album-1', ['a', 'b'], [ok('a'), ok('b')]);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
    const [item] = primary.mock.calls[0];
    expect(item.description).toBe('assets_added_to_album_count:{"count":2}');
    expect(item.button).toBeDefined();
  });

  it('nothing added (all no_permission) → warning toast, NEVER primary, no View album', () => {
    notifyAddToAlbum($t, 'album-1', ['a', 'b'], [denied('a'), denied('b')]);
    expect(primary).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    const [item] = warning.mock.calls[0];
    expect(item.description).toBe('assets_cannot_be_added_to_album_count:{"count":2}');
    expect(item.button).toBeUndefined();
  });

  it('all duplicates → info toast (already in album), not primary', () => {
    notifyAddToAlbum($t, 'album-1', ['a', 'b'], [dup('a'), dup('b')]);
    expect(primary).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0].description).toBe('assets_were_part_of_album_count:{"count":2}');
  });

  it('partial success → info toast (not full green), keeps View album', () => {
    notifyAddToAlbum($t, 'album-1', ['a', 'b'], [ok('a'), denied('b')]);
    expect(primary).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const [item] = info.mock.calls[0];
    expect(item.description).toBe('assets_added_to_album_partial_count:{"successCount":1,"totalCount":2}');
    expect(item.button).toBeDefined();
  });

  it('nothing added, mix of duplicate + no_permission → warning, not primary', () => {
    notifyAddToAlbum($t, 'album-1', ['a', 'b'], [dup('a'), denied('b')]);
    expect(primary).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
