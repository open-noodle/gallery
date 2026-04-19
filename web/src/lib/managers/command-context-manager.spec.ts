import type { AlbumResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => ({ page: { route: { id: null }, params: {} } }));
vi.mock('$lib/stores/user.store', () => ({
  user: {
    subscribe: (fn: (v: null) => void) => {
      fn(null);
      return () => {};
    },
  },
}));

import { commandContextManager } from '$lib/managers/command-context-manager.svelte';

describe('CommandContextManager', () => {
  beforeEach(() => {
    commandContextManager.setAlbum(null);
    commandContextManager.setSpace(null);
  });

  it('returns null album and space by default', () => {
    const ctx = commandContextManager.getContext();
    expect(ctx.album).toBeNull();
    expect(ctx.space).toBeNull();
  });

  it('round-trips setAlbum / setSpace', () => {
    commandContextManager.setAlbum({
      id: 'a1',
      albumName: 'Test',
      ownerId: 'u1',
      isOwner: true,
      isMember: false,
      raw: { id: 'a1', albumName: 'Test', ownerId: 'u1' } as unknown as AlbumResponseDto,
    });
    expect(commandContextManager.getContext().album?.id).toBe('a1');
  });

  it('params is a snapshot — mutation does not leak into next read', () => {
    const ctx1 = commandContextManager.getContext();
    (ctx1.params as Record<string, string>).foo = 'bar';
    const ctx2 = commandContextManager.getContext();
    expect(ctx2.params.foo).toBeUndefined();
  });
});
