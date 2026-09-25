import { shouldIgnoreEvent, type ShortcutOptions } from '$lib/actions/shortcut';

export type CleanupShortcutHandlers = {
  keep: () => void;
  favorite: () => void;
  trash: () => void;
  left: () => void;
  right: () => void;
  up: () => void;
  down: () => void;
  open: () => void;
  undo: () => void;
  finish: () => void;
};

const isFormField = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.getAttribute('contenteditable') === 'true' ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
};

/**
 * A focused button, link or role="button" element that is not an asset tile. Asset tiles are
 * buttons too, but they carry `data-asset-id`; Space on a tile opens the viewer, while Space on
 * any other control (Keep, Trash, Finish day, ...) must press that control.
 */
const isNonTileControl = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  target.dataset.assetId === undefined &&
  target.matches('button, a[href], [role="button"], summary');

/** `leaveControls`: skip the shortcut when a non-tile control has focus, so the key presses it. */
type Binding = [ShortcutOptions['shortcut'], () => void, { leaveControls?: boolean }?];

const bind = (bindings: Binding[]): ShortcutOptions[] =>
  bindings.map(([shortcut, handler, options]) => ({
    shortcut,
    ignoreInputFields: false,
    preventDefault: false,
    onShortcut: (event) => {
      if (shouldIgnoreEvent(event) || isFormField(event.target)) {
        return;
      }
      if (options?.leaveControls && isNonTileControl(event.target)) {
        return;
      }
      event.preventDefault();
      handler();
    },
  }));

/**
 * Keyboard shortcuts for the Cleanup pages. They are all turned off while the asset viewer is
 * open, because the viewer already uses `z` for zoom and Space for video play/pause.
 *
 * `shouldIgnoreEvent` only covers text-like inputs; checkboxes, selects and contenteditable
 * elements are ignored here too, so Space still toggles the "Hide reviewed" checkbox. Space also
 * stays with a focused button or link that is not an asset tile, so it presses Keep, Trash or
 * Finish day. The default is only prevented once a shortcut actually runs.
 */
export const cleanupShortcuts = (handlers: CleanupShortcutHandlers, isViewing: () => boolean): ShortcutOptions[] => {
  if (isViewing()) {
    return [];
  }

  const bindings: Binding[] = [
    [{ key: 'k' }, handlers.keep],
    [{ key: 'f' }, handlers.favorite],
    [{ key: 'Delete' }, handlers.trash],
    // Mac keyboards label Backspace as delete; the legend still says Delete.
    [{ key: 'Backspace' }, handlers.trash],
    [{ key: 'ArrowLeft' }, handlers.left],
    [{ key: 'ArrowRight' }, handlers.right],
    [{ key: 'ArrowUp' }, handlers.up],
    [{ key: 'ArrowDown' }, handlers.down],
    [{ key: ' ' }, handlers.open, { leaveControls: true }],
    [{ key: 'z' }, handlers.undo],
    [{ key: 'Enter', shift: true }, handlers.finish],
  ];

  return bind(bindings);
};

export type QueueShortcutHandlers = {
  /** Trash the selection, or the focused item when nothing is selected. */
  trash: () => void;
  /** Keep the selection, or the focused item when nothing is selected. */
  keep: () => void;
  selectAll: () => void;
  clear: () => void;
  open: () => void;
};

/**
 * Keyboard shortcuts for the queue pages (space hogs, bursts, screenshots, blurry), with the same
 * form-field rules as `cleanupShortcuts`. `isDisabled` should cover the asset viewer and any modal.
 */
export const queueShortcuts = (handlers: QueueShortcutHandlers, isDisabled: () => boolean): ShortcutOptions[] => {
  if (isDisabled()) {
    return [];
  }

  return bind([
    [{ key: 'Delete' }, handlers.trash],
    [{ key: 'Backspace' }, handlers.trash],
    [{ key: 'k' }, handlers.keep],
    [{ key: 'a' }, handlers.selectAll],
    [{ key: 'Escape' }, handlers.clear],
    [{ key: ' ' }, handlers.open, { leaveControls: true }],
  ]);
};
