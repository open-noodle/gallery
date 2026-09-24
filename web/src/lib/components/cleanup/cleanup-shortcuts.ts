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
 * Keyboard shortcuts for the Cleanup pages. They are all turned off while the asset viewer is
 * open, because the viewer already uses `z` for zoom and Space for video play/pause.
 *
 * `shouldIgnoreEvent` only covers text-like inputs; checkboxes, selects and contenteditable
 * elements are ignored here too, so Space still toggles the "Hide reviewed" checkbox. The default
 * is only prevented once a shortcut actually runs.
 */
export const cleanupShortcuts = (handlers: CleanupShortcutHandlers, isViewing: () => boolean): ShortcutOptions[] => {
  if (isViewing()) {
    return [];
  }

  const bindings: Array<[ShortcutOptions['shortcut'], () => void]> = [
    [{ key: 'k' }, handlers.keep],
    [{ key: 'f' }, handlers.favorite],
    [{ key: 'Delete' }, handlers.trash],
    // Mac keyboards label Backspace as delete; the legend still says Delete.
    [{ key: 'Backspace' }, handlers.trash],
    [{ key: 'ArrowLeft' }, handlers.left],
    [{ key: 'ArrowRight' }, handlers.right],
    [{ key: 'ArrowUp' }, handlers.up],
    [{ key: 'ArrowDown' }, handlers.down],
    [{ key: ' ' }, handlers.open],
    [{ key: 'z' }, handlers.undo],
    [{ key: 'Enter', shift: true }, handlers.finish],
  ];

  return bindings.map(([shortcut, handler]) => ({
    shortcut,
    ignoreInputFields: false,
    preventDefault: false,
    onShortcut: (event) => {
      if (shouldIgnoreEvent(event) || isFormField(event.target)) {
        return;
      }
      event.preventDefault();
      handler();
    },
  }));
};
