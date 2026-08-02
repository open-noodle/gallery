import type { ShortcutOptions } from '$lib/actions/shortcut';

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** True when the element is, or sits inside, something the user can type into. */
export const isEditableTarget = (element: Element | null): boolean =>
  element !== null && element.closest(EDITABLE_SELECTOR) !== null;

/**
 * Descriptors binding `/` to the global search palette.
 *
 * Two of them, because `matchesShortcut` compares modifiers strictly
 * (`Boolean(shortcut.shift) === event.shiftKey`) and several common layouts
 * produce `/` with Shift held — QWERTZ and Spanish use Shift+7, AZERTY Shift+:.
 * A lone `{ key: '/' }` would be dead for all of them. There is no clash with
 * `?`, which arrives as `event.key === '?'` on US layouts.
 */
export const searchShortcuts = (open: () => void): ShortcutOptions[] => {
  const openUnlessEditing = (event: KeyboardEvent) => {
    // `shouldIgnoreEvent` in @immich/ui only skips a fixed list of input types
    // (textarea, text, date, datetime-local, email, password), so `type="search"`
    // and `type="number"` fields would otherwise swallow a typed `/`.
    if (isEditableTarget(document.activeElement)) {
      return;
    }
    // `shortcuts()` in @immich/ui calls `event.preventDefault()` BEFORE invoking
    // `onShortcut` whenever a descriptor's `preventDefault` option is left at its
    // default of `true` — before we ever get a chance to check `isEditableTarget`.
    // Cancelling `keydown` suppresses the browser's own text-insertion behaviour,
    // so if we let that default stand, declining to open the palette above would
    // still swallow the `/` the user typed into a `type="search"` field. To keep
    // both outcomes correct we set `preventDefault: false` on both descriptors
    // below and call `event.preventDefault()` ourselves, only on the branch that
    // actually opens the palette. Do NOT delete this call or drop the
    // `preventDefault: false` options — that reintroduces a silent dead key on
    // every editable field on every page (see #862 follow-up regression).
    event.preventDefault();
    open();
  };

  return [
    { shortcut: { key: '/' }, onShortcut: openUnlessEditing, preventDefault: false },
    { shortcut: { key: '/', shift: true }, onShortcut: openUnlessEditing, preventDefault: false },
  ];
};
