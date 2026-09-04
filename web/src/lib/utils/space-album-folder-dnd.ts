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

/** Marks the transient node so tests and cleanup can find it unambiguously. */
const DRAG_CHIP_ATTRIBUTE = 'data-space-drag-chip';

/**
 * Replaces the browser's default drag image — a snapshot of the dragged element, which for a folder
 * card is a full tile with a four-up collage that covers the drop targets — with a small text chip.
 *
 * Three constraints, each a real failure if broken:
 *  - The chip must be RENDERED. `display: none` yields no drag image at all, so it is placed
 *    offscreen instead.
 *  - It must be in the DOM when `setDragImage` runs (the snapshot is taken synchronously) and gone
 *    afterwards, hence the next-tick removal rather than an immediate one.
 *  - `setDragImage` must be feature-detected. The unit tests hand-roll a `DataTransfer` with only
 *    `setData`/`getData`/`types`, and jsdom-family DOMs do not implement it either; without the
 *    guard, every dragstart test throws.
 */
export const setDragLabel = (dataTransfer: DataTransfer, label: string): void => {
  if (typeof document === 'undefined' || typeof dataTransfer.setDragImage !== 'function') {
    return;
  }

  const chip = document.createElement('div');
  chip.setAttribute(DRAG_CHIP_ATTRIBUTE, '');
  chip.textContent = label;
  chip.style.cssText = [
    'position:absolute',
    'top:-1000px',
    'inset-inline-start:0',
    // A zero-area element is rejected as a drag image by some browsers, so an
    // empty folder name still has to produce a box.
    'min-width:2rem',
    'max-width:16rem',
    'overflow:hidden',
    'white-space:nowrap',
    'text-overflow:ellipsis',
    'padding:0.25rem 0.5rem',
    'border-radius:0.375rem',
    'font-size:0.875rem',
    'background:#1f2937',
    'color:#ffffff',
  ].join(';');

  document.body.append(chip);
  dataTransfer.setDragImage(chip, 12, 12);
  setTimeout(() => chip.remove(), 0);
};
