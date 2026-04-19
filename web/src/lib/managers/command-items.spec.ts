import { ADMIN_VISIBLE_QUEUES } from '$lib/constants';
import { authManager } from '$lib/managers/auth-manager.svelte';
import * as albumUtils from '$lib/utils/album-utils';
import * as fileUploader from '$lib/utils/file-uploader';
import * as sdk from '@immich/sdk';
import { QueueCommand, QueueName } from '@immich/sdk';
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

vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  runQueueCommandLegacy: vi.fn(),
  emptyQueue: vi.fn(),
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { logout: vi.fn().mockResolvedValue(undefined) },
}));

beforeEach(() => {
  vi.mocked(toastManager.primary).mockClear();
  vi.mocked(toastManager.warning).mockClear();
  vi.mocked(toastManager.info).mockClear();
  vi.mocked(toastManager.danger).mockClear();
  vi.mocked(sdk.runQueueCommandLegacy).mockClear();
  vi.mocked(sdk.emptyQueue).mockClear();
  vi.restoreAllMocks();
});

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

  it('has 15 entries (7 v1.3.0 + 8 v1.3.1)', () => {
    expect(COMMAND_ITEMS).toHaveLength(15);
  });

  it('all 8 v1.3.1 commands are adminOnly', () => {
    const v131Ids = [
      'cmd:run_thumbnail_gen',
      'cmd:run_metadata_extraction',
      'cmd:run_smart_search',
      'cmd:run_face_detection',
      'cmd:run_face_recognition',
      'cmd:pause_all_queues',
      'cmd:resume_all_queues',
      'cmd:clear_failed_jobs',
    ];
    for (const id of v131Ids) {
      const cmd = COMMAND_ITEMS.find((c) => c.id === id);
      expect(cmd, `expected ${id} in COMMAND_ITEMS`).toBeDefined();
      expect(cmd!.adminOnly, `expected ${id} to be adminOnly`).toBe(true);
    }
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

describe.each([
  ['cmd:run_thumbnail_gen', QueueName.ThumbnailGeneration],
  ['cmd:run_metadata_extraction', QueueName.MetadataExtraction],
  ['cmd:run_smart_search', QueueName.SmartSearch],
  ['cmd:run_face_detection', QueueName.FaceDetection],
  ['cmd:run_face_recognition', QueueName.FacialRecognition],
])('%s', (id, expectedQueue) => {
  it('dispatches Start + force:false against the expected queue, shows success toast', async () => {
    const spy = vi.spyOn(sdk, 'runQueueCommandLegacy').mockResolvedValue({} as never);
    const cmd = COMMAND_ITEMS.find((c) => c.id === id)!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledWith({
      name: expectedQueue,
      queueCommandDto: { command: QueueCommand.Start, force: false },
    });
    // Toast content assertion: svelte-i18n returns the raw key when no catalog
    // is loaded (setup uses fallbackLocale 'dev'), so the key IS the rendered
    // string. Catches a copy-paste firing the wrong i18n key.
    expect(toastManager.primary).toHaveBeenCalledWith(expect.stringContaining('cmdk_cmd_job_started'));
  });
});

// Shared helper — one rejection test covers the error branch for all 5 Run-X
// commands since they dispatch through `runQueue`.
it('cmd:run_thumbnail_gen: SDK rejection fires handleError (danger toast), no success toast', async () => {
  vi.spyOn(sdk, 'runQueueCommandLegacy').mockRejectedValue(new Error('boom') as never);
  const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:run_thumbnail_gen')!;
  await cmd.handler();
  expect(toastManager.primary).not.toHaveBeenCalled();
  // handleError calls toastManager.danger — see web/src/lib/utils/handle-error.ts:44.
  expect(toastManager.danger).toHaveBeenCalled();
});

describe.each([
  ['cmd:pause_all_queues', QueueCommand.Pause, 'cmdk_cmd_all_paused'],
  ['cmd:resume_all_queues', QueueCommand.Resume, 'cmdk_cmd_all_resumed'],
])('%s', (id, expectedCommand, successKey) => {
  it('dispatches to every admin-visible queue (not all QueueName values)', async () => {
    const spy = vi.spyOn(sdk, 'runQueueCommandLegacy').mockResolvedValue({} as never);
    const cmd = COMMAND_ITEMS.find((c) => c.id === id)!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledTimes(ADMIN_VISIBLE_QUEUES.length);
    for (const name of ADMIN_VISIBLE_QUEUES) {
      expect(spy).toHaveBeenCalledWith({ name, queueCommandDto: { command: expectedCommand } });
    }
    // Explicit negative: a system queue excluded from ADMIN_VISIBLE_QUEUES must NOT be touched.
    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ name: QueueName.Notifications }));
    expect(toastManager.primary).toHaveBeenCalledWith(expect.stringContaining(successKey));
  });

  it('partial failure: some reject → warning toast fires, no success toast', async () => {
    const spy = vi
      .spyOn(sdk, 'runQueueCommandLegacy')
      .mockImplementation(({ name }) =>
        name === QueueName.ThumbnailGeneration
          ? (Promise.reject(new Error('boom')) as never)
          : (Promise.resolve({}) as never),
      );
    const cmd = COMMAND_ITEMS.find((c) => c.id === id)!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledTimes(ADMIN_VISIBLE_QUEUES.length);
    // Toast assertion is key-only: svelte-i18n with no catalog loaded returns the
    // raw key AND skips ICU substitution, so interpolated {failed}/{total} values
    // can't be asserted. The reject-selection above proves the 1/14 breakdown.
    expect(toastManager.warning).toHaveBeenCalledWith(expect.stringContaining('cmdk_cmd_bulk_partial'));
    expect(toastManager.primary).not.toHaveBeenCalled();
  });

  it('total failure: all reject → warning toast fires, no success toast', async () => {
    const spy = vi.spyOn(sdk, 'runQueueCommandLegacy').mockRejectedValue(new Error('boom') as never);
    const cmd = COMMAND_ITEMS.find((c) => c.id === id)!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledTimes(ADMIN_VISIBLE_QUEUES.length);
    expect(toastManager.warning).toHaveBeenCalledWith(expect.stringContaining('cmdk_cmd_bulk_partial'));
    expect(toastManager.primary).not.toHaveBeenCalled();
  });
});

describe('cmd:clear_failed_jobs', () => {
  it('calls emptyQueue with failed:true for every admin-visible queue', async () => {
    const spy = vi.spyOn(sdk, 'emptyQueue').mockResolvedValue({} as never);
    const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:clear_failed_jobs')!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledTimes(ADMIN_VISIBLE_QUEUES.length);
    for (const name of ADMIN_VISIBLE_QUEUES) {
      expect(spy).toHaveBeenCalledWith({ name, queueDeleteDto: { failed: true } });
    }
    expect(toastManager.primary).toHaveBeenCalledWith(expect.stringContaining('cmdk_cmd_failed_cleared'));
  });

  it('partial failure: warning toast fires, no success toast', async () => {
    const spy = vi
      .spyOn(sdk, 'emptyQueue')
      .mockImplementation(({ name }) =>
        name === QueueName.FaceDetection
          ? (Promise.reject(new Error('boom')) as never)
          : (Promise.resolve({}) as never),
      );
    const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:clear_failed_jobs')!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledTimes(ADMIN_VISIBLE_QUEUES.length);
    expect(toastManager.warning).toHaveBeenCalledWith(expect.stringContaining('cmdk_cmd_bulk_partial'));
    expect(toastManager.primary).not.toHaveBeenCalled();
  });

  it('total failure: warning toast fires', async () => {
    const spy = vi.spyOn(sdk, 'emptyQueue').mockRejectedValue(new Error('boom') as never);
    const cmd = COMMAND_ITEMS.find((c) => c.id === 'cmd:clear_failed_jobs')!;
    await cmd.handler();
    expect(spy).toHaveBeenCalledTimes(ADMIN_VISIBLE_QUEUES.length);
    expect(toastManager.warning).toHaveBeenCalledWith(expect.stringContaining('cmdk_cmd_bulk_partial'));
  });
});
