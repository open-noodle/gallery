import { get } from 'svelte/store';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { recentSpacesDropdown } from '$lib/stores/preferences.store';
import { userInteraction } from '$lib/stores/user.svelte';
import { sharedSpaceFactory } from '@test-data/factories/shared-space-factory';

describe('userInteraction.recentSpaces', () => {
  beforeEach(() => {
    userInteraction.recentSpaces = undefined;
  });

  it('defaults to undefined', () => {
    expect(userInteraction.recentSpaces).toBeUndefined();
  });

  it('resets to undefined on SpaceAddAssets event', () => {
    userInteraction.recentSpaces = [sharedSpaceFactory.build()];
    expect(userInteraction.recentSpaces).toBeDefined();

    eventManager.emit('SpaceAddAssets', { assetIds: ['a1'], spaceId: 's1' });
    expect(userInteraction.recentSpaces).toBeUndefined();
  });

  it('resets to undefined on SpaceRemoveAssets event', () => {
    userInteraction.recentSpaces = [sharedSpaceFactory.build()];
    expect(userInteraction.recentSpaces).toBeDefined();

    eventManager.emit('SpaceRemoveAssets', { assetIds: ['a1'], spaceId: 's1' });
    expect(userInteraction.recentSpaces).toBeUndefined();
  });

  it('resets recentSpaces and drops the space album cache on SpaceLinkAlbum', () => {
    userInteraction.recentSpaces = [sharedSpaceFactory.build()];
    userInteraction.spaceAlbums = { s1: [], s2: [] };

    eventManager.emit('SpaceLinkAlbum', { spaceId: 's1' });

    expect(userInteraction.recentSpaces).toBeUndefined();
    expect(userInteraction.spaceAlbums?.s1).toBeUndefined();
    expect(userInteraction.spaceAlbums?.s2).toBeDefined();
  });

  it('resets recentSpaces and drops the space album cache on SpaceUnlinkAlbum', () => {
    userInteraction.recentSpaces = [sharedSpaceFactory.build()];
    userInteraction.spaceAlbums = { s1: [] };

    eventManager.emit('SpaceUnlinkAlbum', { spaceId: 's1' });

    expect(userInteraction.recentSpaces).toBeUndefined();
    expect(userInteraction.spaceAlbums?.s1).toBeUndefined();
  });
});

describe('recentSpacesDropdown', () => {
  it('defaults to true', () => {
    expect(get(recentSpacesDropdown)).toBe(true);
  });
});
