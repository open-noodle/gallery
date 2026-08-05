import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import {
  canDrop,
  getActiveDragPayload,
  readDragPayload,
  setActiveDragPayload,
  SPACE_ITEM_MIME,
  writeDragPayload,
} from '$lib/utils/space-album-folder-dnd';

const folder = (id: string, name: string, parentId: string | null = null) =>
  ({ id, spaceId: 's', parentId, name, createdById: null, createdAt: '', updatedAt: '' }) as SharedSpaceAlbumFolderDto;
const album = (id: string, folderId: string | null = null) =>
  ({ id, albumName: id, folderId }) as SharedSpaceLinkedAlbumDto;

const folders = [folder('trips', 'Trips'), folder('y2026', '2026', 'trips'), folder('family', 'Family')];
const albums = [album('a1', 'trips'), album('a2')];

const makeDataTransfer = () => {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    types: [...store.keys()],
  } as unknown as DataTransfer;
};

describe('space-album-folder-dnd', () => {
  // The custom MIME type is load-bearing: DragAndDropUploadOverlay watches for FILE drags,
  // and a generic payload would light the upload overlay up mid-drag.
  it('round-trips a payload under the gallery-specific MIME type', () => {
    const dt = makeDataTransfer();

    writeDragPayload(dt, { kind: 'album', id: 'a1' });

    expect(dt.getData(SPACE_ITEM_MIME)).toContain('a1');
    expect(readDragPayload(dt)).toEqual({ kind: 'album', id: 'a1' });
  });

  // The actually load-bearing half of the previous test: writeDragPayload must NOT also write
  // under a generic type like text/plain. Nothing in the app currently reads text/plain off a
  // drag, but that emptiness is what keeps this payload invisible to any code that keys off it —
  // asserting only the positive (SPACE_ITEM_MIME round-trips) would miss a regression that wrote
  // to both.
  it('does not also write the payload under a generic MIME type', () => {
    const dt = makeDataTransfer();

    writeDragPayload(dt, { kind: 'album', id: 'a1' });

    expect(dt.getData('text/plain')).toBe('');
  });

  it('returns null for a drag carrying no gallery payload', () => {
    expect(readDragPayload(makeDataTransfer())).toBeNull();
  });

  it('returns null rather than throwing on a malformed payload', () => {
    const dt = makeDataTransfer();
    dt.setData(SPACE_ITEM_MIME, 'not json');

    expect(readDragPayload(dt)).toBeNull();
  });

  // W-13: a folder cannot be dropped into itself or its own subtree.
  it.each([
    ['itself', 'trips', 'trips'],
    ['its descendant', 'trips', 'y2026'],
  ])('W-13: refuses dropping a folder onto %s', (_label, dragged, target) => {
    expect(canDrop(folders, albums, { kind: 'folder', id: dragged }, target)).toBe(false);
  });

  it('W-13: allows dropping a folder onto an unrelated folder or the root', () => {
    expect(canDrop(folders, albums, { kind: 'folder', id: 'trips' }, 'family')).toBe(true);
    expect(canDrop(folders, albums, { kind: 'folder', id: 'y2026' }, null)).toBe(true);
  });

  // W-14: dropping onto the parent it already has is a no-op, so no request should fire.
  it('W-14: refuses dropping an item onto the folder it already sits in', () => {
    expect(canDrop(folders, albums, { kind: 'album', id: 'a1' }, 'trips')).toBe(false);
    expect(canDrop(folders, albums, { kind: 'album', id: 'a2' }, null)).toBe(false);
    expect(canDrop(folders, albums, { kind: 'folder', id: 'y2026' }, 'trips')).toBe(false);
  });

  it('allows dropping an album into a different folder', () => {
    expect(canDrop(folders, albums, { kind: 'album', id: 'a1' }, 'family')).toBe(true);
    expect(canDrop(folders, albums, { kind: 'album', id: 'a1' }, null)).toBe(true);
  });

  it('refuses an unknown item or an unknown target', () => {
    expect(canDrop(folders, albums, { kind: 'album', id: 'ghost' }, 'trips')).toBe(false);
    expect(canDrop(folders, albums, { kind: 'folder', id: 'trips' }, 'ghost')).toBe(false);
  });

  // dragenter/dragover see the DataTransfer in the spec's "protected mode": real browsers
  // return '' from getData() there, so readDragPayload cannot be trusted inside an ondragover
  // handler. This module-level slot is the side channel components use instead — set at
  // dragstart, read during dragover, cleared at dragend. Reset between tests: it is bare module
  // state and this codebase's vitest config has no clearMocks/restoreMocks to do it for us.
  describe('active drag payload', () => {
    afterEach(() => {
      setActiveDragPayload(null);
    });

    it('is null until a drag sets it', () => {
      expect(getActiveDragPayload()).toBeNull();
    });

    it('returns whatever was last set', () => {
      setActiveDragPayload({ kind: 'folder', id: 'trips' });

      expect(getActiveDragPayload()).toEqual({ kind: 'folder', id: 'trips' });
    });

    it('clears back to null', () => {
      setActiveDragPayload({ kind: 'album', id: 'a1' });
      setActiveDragPayload(null);

      expect(getActiveDragPayload()).toBeNull();
    });
  });
});
