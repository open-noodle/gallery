import type { SharedSpaceAlbumFolderDto, SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { isDescendant } from '$lib/utils/space-album-folders';

/**
 * A gallery-specific MIME type, not text/plain. DragAndDropUploadOverlay listens for file
 * drags; a generic payload would risk being picked up by other code that keys off a common type.
 */
export const SPACE_ITEM_MIME = 'application/x-gallery-space-item';

export type DragPayload = { kind: 'album' | 'folder'; id: string };

export const writeDragPayload = (dataTransfer: DataTransfer, payload: DragPayload): void => {
  dataTransfer.setData(SPACE_ITEM_MIME, JSON.stringify(payload));
};

export const readDragPayload = (dataTransfer: DataTransfer): DragPayload | null => {
  const raw = dataTransfer.getData(SPACE_ITEM_MIME);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    return parsed?.id && (parsed.kind === 'album' || parsed.kind === 'folder') ? parsed : null;
  } catch {
    // A foreign drag that happens to claim our MIME type must not throw mid-drop.
    return null;
  }
};

/**
 * `dragenter`/`dragover` see the DataTransfer in the Drag and Drop spec's "protected mode": real
 * browsers return an empty string from getData() there — only `.types` is readable before the
 * drop itself. That makes readDragPayload unusable inside an `ondragover` handler in production,
 * even though a hand-rolled DataTransfer in a unit test won't reproduce that restriction.
 *
 * This module-level slot is the workaround: the dragged element records the payload here at
 * `ondragstart` (alongside writeDragPayload) and clears it at `ondragend`. Folder cards and
 * breadcrumb crumbs read it back during dragover to run the real canDrop check and decide
 * whether to preventDefault() — which is also what is needed for `drop` to fire at all.
 * `ondrop` itself still reads the authoritative payload off the DataTransfer via
 * readDragPayload, since read access there is unrestricted.
 */
let activeDragPayload: DragPayload | null = null;

export const setActiveDragPayload = (payload: DragPayload | null): void => {
  activeDragPayload = payload;
};

export const getActiveDragPayload = (): DragPayload | null => activeDragPayload;

/**
 * Decided entirely client-side, so an illegal drop fires no request at all — the user never
 * sees a spinner followed by an error the client could have predicted.
 */
export const canDrop = (
  folders: SharedSpaceAlbumFolderDto[],
  albums: SharedSpaceLinkedAlbumDto[],
  payload: DragPayload,
  targetFolderId: string | null,
): boolean => {
  if (targetFolderId !== null && folders.every((f) => f.id !== targetFolderId)) {
    return false;
  }

  if (payload.kind === 'album') {
    const album = albums.find((a) => a.id === payload.id);
    return !!album && (album.folderId ?? null) !== targetFolderId;
  }

  const folder = folders.find((f) => f.id === payload.id);
  if (!folder) {
    return false;
  }
  if (folder.id === targetFolderId) {
    return false;
  }
  if ((folder.parentId ?? null) === targetFolderId) {
    return false;
  }
  return targetFolderId === null || !isDescendant(folders, targetFolderId, folder.id);
};
