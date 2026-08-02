import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchesShortcut, shortcuts } from '$lib/actions/shortcut';
import { isEditableTarget, searchShortcuts } from './search-shortcut';

const keydown = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

const countMatches = (event: KeyboardEvent) =>
  searchShortcuts(() => {}).filter((option) => matchesShortcut(event, option.shortcut)).length;

const fire = (open: () => void, event: KeyboardEvent) => {
  for (const option of searchShortcuts(open)) {
    if (matchesShortcut(event, option.shortcut)) {
      option.onShortcut(event as KeyboardEvent & { currentTarget: HTMLElement });
    }
  }
};

const focusHtml = (html: string) => {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild as HTMLElement;
  element.focus();
  return element;
};

describe('isEditableTarget', () => {
  it.each([
    ['a text input', '<input type="text" />'],
    ['a search input', '<input type="search" />'],
    ['a number input', '<input type="number" />'],
    ['a textarea', '<textarea></textarea>'],
    ['a select', '<select></select>'],
    ['a contenteditable element', '<div contenteditable="true"></div>'],
  ])('treats %s as editable', (_name, html) => {
    document.body.innerHTML = html;

    expect(isEditableTarget(document.body.firstElementChild)).toBe(true);
  });

  it('treats an element nested inside a contenteditable region as editable', () => {
    document.body.innerHTML = '<div contenteditable="true"><span id="inner">hi</span></div>';

    expect(isEditableTarget(document.querySelector('#inner'))).toBe(true);
  });

  it('does not treat an explicitly non-editable region as editable', () => {
    document.body.innerHTML = '<div contenteditable="false"></div>';

    expect(isEditableTarget(document.body.firstElementChild)).toBe(false);
  });

  it('does not treat an ordinary element as editable', () => {
    document.body.innerHTML = '<div></div>';

    expect(isEditableTarget(document.body.firstElementChild)).toBe(false);
  });

  it('returns false for null rather than throwing', () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('searchShortcuts', () => {
  it('registers a bare slash and a shifted slash, in that order', () => {
    expect(searchShortcuts(() => {}).map((option) => option.shortcut)).toEqual([
      { key: '/' },
      { key: '/', shift: true },
    ]);
  });

  it('matches a bare slash exactly once', () => {
    expect(countMatches(keydown({ key: '/' }))).toBe(1);
  });

  it('matches a shifted slash exactly once, for layouts where slash needs shift', () => {
    expect(countMatches(keydown({ key: '/', shiftKey: true }))).toBe(1);
  });

  it('leaves question mark to the keyboard shortcuts modal', () => {
    expect(countMatches(keydown({ key: '?', shiftKey: true }))).toBe(0);
  });

  it('leaves ctrl+slash to the search mode cycle', () => {
    expect(countMatches(keydown({ key: '/', ctrlKey: true }))).toBe(0);
  });

  it('ignores slash with alt or meta held', () => {
    expect(countMatches(keydown({ key: '/', altKey: true }))).toBe(0);
    expect(countMatches(keydown({ key: '/', metaKey: true }))).toBe(0);
  });

  it('opens search when nothing is being edited', () => {
    document.body.replaceChildren();
    const open = vi.fn();

    fire(open, keydown({ key: '/' }));

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens search from a shifted slash when nothing is being edited', () => {
    document.body.replaceChildren();
    const open = vi.fn();

    fire(open, keydown({ key: '/', shiftKey: true }));

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not open search while typing in a search input', () => {
    const field = focusHtml('<input type="search" />');
    expect(document.activeElement).toBe(field);
    const open = vi.fn();

    fire(open, keydown({ key: '/' }));

    expect(open).not.toHaveBeenCalled();
  });

  it('does not open search while typing in a textarea', () => {
    const field = focusHtml('<textarea></textarea>');
    expect(document.activeElement).toBe(field);
    const open = vi.fn();

    fire(open, keydown({ key: '/' }));

    expect(open).not.toHaveBeenCalled();
  });
});

// These tests drive the REAL `shortcuts` action from `$lib/actions/shortcut` — attached
// to a live DOM node, dispatching real `keydown` events at the focused element — rather
// than calling `option.onShortcut` directly like `fire()` above does. `fire()` cannot
// exercise `preventDefault` ordering because it bypasses the action entirely; the action
// itself calls `event.preventDefault()` *before* `onShortcut` runs whenever a descriptor's
// `preventDefault` option is left at its default of `true`. That ordering is exactly what
// regressed: `searchShortcuts` used to omit `preventDefault: false`, so typing `/` into a
// `type="search"` field (e.g. the space albums filter) got its keydown cancelled — and
// hence the character silently swallowed — even though `openUnlessEditing` correctly
// declined to open the palette. Revert the `preventDefault: false` / manual
// `event.preventDefault()` pairing in `search-shortcut.ts` and the `type="search"` case
// below fails: `defaultPrevented` becomes `true` even though `open` is never called.
describe('searchShortcuts wired through the real shortcuts action', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.replaceChildren();
  });

  const attach = (open: () => void) => {
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.append(root);
    const action = shortcuts(root, searchShortcuts(open));
    cleanup = () => {
      action.destroy?.();
      root.remove();
    };
    return root;
  };

  const dispatchSlash = (target: EventTarget) => {
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  it('opens search and marks the keydown as prevented when nothing is focused', () => {
    const open = vi.fn();
    const root = attach(open);
    const inert = document.createElement('div');
    root.append(inert);

    const event = dispatchSlash(inert);

    expect(open).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not open search and leaves the keydown unprevented while a search input is focused', () => {
    const open = vi.fn();
    const root = attach(open);
    const input = document.createElement('input');
    input.type = 'search';
    root.append(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    const event = dispatchSlash(input);

    expect(open).not.toHaveBeenCalled();
    // The regression: without `preventDefault: false` on the descriptors plus a manual
    // `event.preventDefault()` gated on actually opening, the action's own default
    // (`preventDefault: true`) cancels this keydown before `openUnlessEditing` ever runs,
    // silently swallowing the `/` the user typed instead of inserting it.
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not open search and leaves the keydown unprevented while a text input is focused', () => {
    const open = vi.fn();
    const root = attach(open);
    const input = document.createElement('input');
    input.type = 'text';
    root.append(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    const event = dispatchSlash(input);

    // Handled entirely by the action's own `shouldIgnoreEvent`, which recognises
    // `type="text"` and `continue`s past every descriptor without ever calling
    // `preventDefault` — this case never reaches `searchShortcuts`' own guard.
    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
