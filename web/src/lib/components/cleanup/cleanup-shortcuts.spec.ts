import { shortcuts } from '$lib/actions/shortcut';
import { cleanupShortcuts, type CleanupShortcutHandlers } from '$lib/components/cleanup/cleanup-shortcuts';

const makeHandlers = (): CleanupShortcutHandlers => ({
  keep: vi.fn(),
  favorite: vi.fn(),
  trash: vi.fn(),
  left: vi.fn(),
  right: vi.fn(),
  up: vi.fn(),
  down: vi.fn(),
  open: vi.fn(),
  undo: vi.fn(),
  finish: vi.fn(),
});

const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe('cleanupShortcuts', () => {
  let root: HTMLDivElement;
  let destroy: (() => void) | undefined;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    destroy?.();
    root.remove();
  });

  const bind = (handlers: CleanupShortcutHandlers, isViewing = () => false) => {
    const action = shortcuts(root, cleanupShortcuts(handlers, isViewing));
    destroy = action?.destroy;
  };

  it('returns no shortcuts while the asset viewer is open', () => {
    expect(cleanupShortcuts(makeHandlers(), () => true)).toEqual([]);
  });

  it('binds all eleven keys when the viewer is closed', () => {
    const keys = cleanupShortcuts(makeHandlers(), () => false).map(({ shortcut }) =>
      shortcut.shift ? `Shift+${shortcut.key}` : shortcut.key,
    );
    expect(keys.sort()).toEqual(
      [
        'k',
        'f',
        'Delete',
        'Backspace',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        ' ',
        'z',
        'Shift+Enter',
      ].sort(),
    );
  });

  it.each([
    ['k', {}, 'keep'],
    ['f', {}, 'favorite'],
    ['Delete', {}, 'trash'],
    // The key labelled delete on a Mac keyboard sends Backspace.
    ['Backspace', {}, 'trash'],
    ['ArrowLeft', {}, 'left'],
    ['ArrowRight', {}, 'right'],
    ['ArrowUp', {}, 'up'],
    ['ArrowDown', {}, 'down'],
    [' ', {}, 'open'],
    ['z', {}, 'undo'],
    ['Enter', { shiftKey: true }, 'finish'],
  ] as const)('invokes the handler for %j', (key, init, name) => {
    const handlers = makeHandlers();
    bind(handlers);

    const event = press(root, key, init);

    expect(handlers[name]).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    for (const [other, fn] of Object.entries(handlers)) {
      if (other !== name) {
        expect(fn).not.toHaveBeenCalled();
      }
    }
  });

  it('does not fire plain Enter as finish, nor Cmd+Z as undo', () => {
    const handlers = makeHandlers();
    bind(handlers);

    press(root, 'Enter');
    press(root, 'z', { metaKey: true });

    expect(handlers.finish).not.toHaveBeenCalled();
    expect(handlers.undo).not.toHaveBeenCalled();
  });

  it.each([
    ['a text input', () => Object.assign(document.createElement('input'), { type: 'text' })],
    ['a checkbox', () => Object.assign(document.createElement('input'), { type: 'checkbox' })],
    ['a textarea', () => document.createElement('textarea')],
    [
      'a contenteditable element',
      () => {
        const div = document.createElement('div');
        div.contentEditable = 'true';
        return div;
      },
    ],
  ])('ignores key presses from %s and leaves their default alone', (_, create) => {
    const handlers = makeHandlers();
    bind(handlers);
    const field = create();
    root.append(field);

    const keep = press(field, 'k');
    const space = press(field, ' ');

    expect(handlers.keep).not.toHaveBeenCalled();
    expect(handlers.open).not.toHaveBeenCalled();
    expect(keep.defaultPrevented).toBe(false);
    expect(space.defaultPrevented).toBe(false);
  });
});
