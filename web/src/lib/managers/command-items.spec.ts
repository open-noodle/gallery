import { authManager } from '$lib/managers/auth-manager.svelte';
import * as albumUtils from '$lib/utils/album-utils';
import * as fileUploader from '$lib/utils/file-uploader';
import { modalManager, toastManager } from '@immich/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShortcutsModal from '../modals/ShortcutsModal.svelte';
import SpaceCreateModal from '../modals/SpaceCreateModal.svelte';
import { COMMAND_ITEMS, isAlmostExactCommandMatch } from './command-items';

const { mockUser } = vi.hoisted(() => ({
  mockUser: { current: { id: 'test-user' } as { id: string } | null },
}));
vi.mock('$lib/stores/user.store', () => ({
  user: {
    subscribe: (run: (v: { id: string } | null) => void) => {
      run(mockUser.current);
      return () => {};
    },
  },
}));

vi.mock('@immich/ui', async (orig) => {
  const actual = await orig<typeof import('@immich/ui')>();
  return {
    ...actual,
    modalManager: { show: vi.fn().mockResolvedValue(undefined) },
    toastManager: { info: vi.fn(), primary: vi.fn(), success: vi.fn(), warning: vi.fn(), danger: vi.fn() },
  };
});

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { logout: vi.fn().mockResolvedValue(undefined) },
}));

describe('COMMAND_ITEMS', () => {
  it('has no duplicate ids', () => {
    const ids = new Set(COMMAND_ITEMS.map((c) => c.id));
    expect(ids.size).toBe(COMMAND_ITEMS.length);
  });
  it('all ids follow cmd:<slug> pattern', () => {
    for (const cmd of COMMAND_ITEMS) {
      expect(cmd.id).toMatch(/^cmd:[a-z][a-z0-9_]*$/);
    }
  });
  it('all entries have non-empty labelKey, descriptionKey, icon, handler', () => {
    for (const cmd of COMMAND_ITEMS) {
      expect(cmd.labelKey.length).toBeGreaterThan(0);
      expect(cmd.descriptionKey.length).toBeGreaterThan(0);
      expect(cmd.icon.length).toBeGreaterThan(0);
      expect(typeof cmd.handler).toBe('function');
    }
  });
  it('includes cmd:theme for Phase 1', () => {
    expect(COMMAND_ITEMS.find((c) => c.id === 'cmd:theme')).toBeDefined();
  });
});

describe('cmd:upload', () => {
  it('invokes openFileUploadDialog', async () => {
    const spy = vi.spyOn(fileUploader, 'openFileUploadDialog').mockResolvedValue(undefined as never);
    const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:upload')!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('cmd:new_album', () => {
  it('invokes createAlbumAndRedirect', async () => {
    const spy = vi.spyOn(albumUtils, 'createAlbumAndRedirect').mockResolvedValue(undefined as never);
    const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:new_album')!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('cmd:create_space', () => {
  it('opens SpaceCreateModal via modalManager', async () => {
    const spy = vi.mocked(modalManager.show).mockResolvedValue(undefined as never);
    spy.mockClear();
    const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:create_space')!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledWith(SpaceCreateModal, {});
  });
});

describe('cmd:signout', () => {
  it('shows signing-out toast and logs the user out', async () => {
    const infoSpy = vi.mocked(toastManager.info);
    const logoutSpy = vi.mocked(authManager.logout);
    infoSpy.mockClear();
    logoutSpy.mockClear();
    const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:signout')!;
    await cmd.handler();
    expect(infoSpy).toHaveBeenCalledOnce();
    expect(logoutSpy).toHaveBeenCalledOnce();
  });
});

describe('cmd:shortcuts', () => {
  it('opens ShortcutsModal via modalManager', async () => {
    const spy = vi.mocked(modalManager.show);
    spy.mockClear();
    const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:shortcuts')!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledWith(ShortcutsModal, {});
  });
});

describe('cmd:clear_recents', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUser.current = { id: 'test-user' };
  });

  it('clears recents when user is logged in', async () => {
    const key = 'cmdk.recent:test-user';
    localStorage.setItem(key, JSON.stringify([{ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 }]));
    const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:clear_recents')!;
    await cmd.handler();
    expect(localStorage.getItem(key)).toBe(JSON.stringify([]));
  });

  it('is a no-op when user is logged out (no crash, localStorage unchanged)', () => {
    mockUser.current = null;
    localStorage.setItem('some-other-key', 'untouched');
    const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:clear_recents')!;
    expect(() => cmd.handler()).not.toThrow();
    expect(localStorage.getItem('some-other-key')).toBe('untouched');
  });
});

describe('isAlmostExactCommandMatch', () => {
  it('returns false for queries shorter than 3 chars', () => {
    expect(isAlmostExactCommandMatch('up', 'Upload files')).toBe(false);
  });
  it('matches when a query word is a prefix of a label word', () => {
    expect(isAlmostExactCommandMatch('upload', 'Upload files')).toBe(true);
    expect(isAlmostExactCommandMatch('upl', 'Upload files')).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isAlmostExactCommandMatch('UPLOAD', 'Upload files')).toBe(true);
  });
  it('splits on non-alphanumerics', () => {
    expect(isAlmostExactCommandMatch('create-album', 'Create album')).toBe(true);
  });
});
