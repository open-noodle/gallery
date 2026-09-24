import { shortcuts } from '$lib/actions/shortcut';
import {
  cleanupShortcuts,
  queueShortcuts,
  type CleanupShortcutHandlers,
  type QueueShortcutHandlers,
} from '$lib/components/cleanup/cleanup-shortcuts';

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

describe('queueShortcuts', () => {
  const makeQueueHandlers = (): QueueShortcutHandlers => ({
    trash: vi.fn(),
    keep: vi.fn(),
    selectAll: vi.fn(),
    clear: vi.fn(),
    open: vi.fn(),
  });

  it('returns no shortcuts while the viewer or a modal is open', () => {
    expect(queueShortcuts(makeQueueHandlers(), () => true)).toEqual([]);
  });

  it('binds Delete, Backspace, k, a, Escape and Space', () => {
    const keys = queueShortcuts(makeQueueHandlers(), () => false).map(({ shortcut }) => shortcut.key);
    expect(keys.sort()).toEqual(['Delete', 'Backspace', 'k', 'a', 'Escape', ' '].sort());
  });

  it('runs each handler and leaves form fields alone', () => {
    const root = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'checkbox';
    root.append(input);
    document.body.append(root);
    const handlers = makeQueueHandlers();
    const action = shortcuts(
      root,
      queueShortcuts(handlers, () => false),
    );

    const pressed = press(root, 'Delete');
    press(root, 'k');
    press(root, 'a');
    press(root, 'Escape');
    press(root, ' ');
    press(input, 'a');

    expect(pressed.defaultPrevented).toBe(true);
    expect(handlers.trash).toHaveBeenCalledTimes(1);
    expect(handlers.keep).toHaveBeenCalledTimes(1);
    expect(handlers.selectAll).toHaveBeenCalledTimes(1);
    expect(handlers.clear).toHaveBeenCalledTimes(1);
    expect(handlers.open).toHaveBeenCalledTimes(1);
    action?.destroy?.();
    root.remove();
  });
});

describe('Space on a focused control', () => {
  const makeControl = (kind: 'button' | 'link' | 'role-button') => {
    if (kind === 'button') {
      return Object.assign(document.createElement('button'), { type: 'button' });
    }
    if (kind === 'link') {
      return Object.assign(document.createElement('a'), { href: '/trash' });
    }
    const div = document.createElement('div');
    div.setAttribute('role', 'button');
    div.tabIndex = 0;
    return div;
  };

  const makeTile = () => {
    const tile = Object.assign(document.createElement('button'), { type: 'button' });
    tile.dataset.assetId = 'asset-1';
    return tile;
  };

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

  const setups = [
    [
      'cleanupShortcuts (rewind)',
      () => {
        const handlers = makeHandlers();
        destroy = shortcuts(
          root,
          cleanupShortcuts(handlers, () => false),
        )?.destroy;
        return handlers;
      },
    ],
    [
      'queueShortcuts (queues)',
      () => {
        const handlers: QueueShortcutHandlers = {
          trash: vi.fn(),
          keep: vi.fn(),
          selectAll: vi.fn(),
          clear: vi.fn(),
          open: vi.fn(),
        };
        destroy = shortcuts(
          root,
          queueShortcuts(handlers, () => false),
        )?.destroy;
        return handlers;
      },
    ],
  ] as const;

  describe.each(setups)('%s', (_, setup) => {
    it.each(['button', 'link', 'role-button'] as const)(
      'leaves Space to a focused non-tile %s: no viewer, default not prevented',
      (kind) => {
        const handlers = setup();
        const control = makeControl(kind);
        root.append(control);

        const event = press(control, ' ');

        expect(handlers.open).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
      },
    );

    it('still opens the viewer when Space is pressed on a focused asset tile', () => {
      const handlers = setup();
      const tile = makeTile();
      root.append(tile);

      const event = press(tile, ' ');

      expect(handlers.open).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('still runs the other shortcuts from a focused non-tile button', () => {
      const handlers = setup();
      const control = makeControl('button');
      root.append(control);

      const event = press(control, 'k');

      expect(handlers.keep).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });
  });
});
