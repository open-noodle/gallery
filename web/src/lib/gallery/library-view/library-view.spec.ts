import { LibraryView, type SharedSpaceResponseDto } from '@immich/sdk';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { userInteraction } from '$lib/stores/user.svelte';
import { userAdminFactory } from '@test-data/factories/user-factory';
import {
  libraryView,
  libraryViewOptions,
  libraryViewShown,
  parseLibraryView,
  resetLibraryView,
} from './library-view.svelte';

const spaces = (...members: { userId: string; showInTimeline: boolean }[]) => [{ members }] as SharedSpaceResponseDto[];

describe('library view', () => {
  beforeEach(() => {
    authManager.setUser(userAdminFactory.build({ id: 'me' }));
  });

  afterEach(() => {
    libraryView.current = 'both';
    userInteraction.recentSpaces = undefined;
    authManager.reset();
  });

  it('leaves the timeline query alone on both', () => {
    expect(libraryViewOptions()).toEqual({});
  });

  it('narrows the timeline query to the chosen view', () => {
    libraryView.current = LibraryView.Personal;
    expect(libraryViewOptions()).toEqual({ libraryView: LibraryView.Personal });

    libraryView.current = LibraryView.Spaces;
    expect(libraryViewOptions()).toEqual({ libraryView: LibraryView.Spaces });
  });

  it('is remembered in the browser', () => {
    libraryView.current = LibraryView.Spaces;
    expect(parseLibraryView(localStorage.getItem('gallery-library-view'))).toBe(LibraryView.Spaces);
  });

  it('reads an unknown or broken stored value as both', () => {
    expect(parseLibraryView('"shared"')).toBe('both');
    expect(parseLibraryView('{')).toBe('both');
    expect(parseLibraryView(null)).toBe('both');
  });

  it('counts as both, and is not shown, while none of my spaces is on my timeline', () => {
    libraryView.current = LibraryView.Personal;
    userInteraction.recentSpaces = spaces(
      { userId: 'other', showInTimeline: true },
      { userId: 'me', showInTimeline: false },
    );
    expect(libraryViewShown()).toBe(false);
    expect(libraryViewOptions()).toEqual({});

    userInteraction.recentSpaces = spaces({ userId: 'me', showInTimeline: true });
    expect(libraryViewShown()).toBe(true);
    expect(libraryViewOptions()).toEqual({ libraryView: LibraryView.Personal });
  });

  it('keeps the remembered view, without showing it, until the spaces are loaded', () => {
    libraryView.current = LibraryView.Spaces;
    expect(libraryViewShown()).toBe(false);
    expect(libraryViewOptions()).toEqual({ libraryView: LibraryView.Spaces });
  });

  it('goes back to both for "view in timeline"', () => {
    libraryView.current = LibraryView.Personal;
    resetLibraryView();
    expect(libraryView.current).toBe('both');
  });
});
