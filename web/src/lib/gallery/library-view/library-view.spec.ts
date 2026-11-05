import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import { LibraryView, type SharedSpaceResponseDto } from '@immich/sdk';
import {
  librarySpaces,
  libraryView,
  libraryViewChips,
  libraryViewOptions,
  libraryViewShown,
  parseLibraryView,
  resetLibraryView,
} from './library-view.svelte.ts';

const spaces = (...members: { userId: string; showInTimeline: boolean }[]) => [{ members }] as SharedSpaceResponseDto[];

describe('library view', () => {
  beforeEach(() => {
    authManager.setUser(factory.user({ id: 'me' }));
  });

  afterEach(() => {
    libraryView.current = 'both';
    librarySpaces.list = undefined;
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
    librarySpaces.list = spaces(
      { userId: 'other', showInTimeline: true },
      { userId: 'me', showInTimeline: false },
    );
    expect(libraryViewShown()).toBe(false);
    expect(libraryViewOptions()).toEqual({});

    librarySpaces.list = spaces({ userId: 'me', showInTimeline: true });
    expect(libraryViewShown()).toBe(true);
    expect(libraryViewOptions()).toEqual({ libraryView: LibraryView.Personal });
  });

  it('keeps the remembered view, without showing it, until the spaces are loaded', () => {
    libraryView.current = LibraryView.Spaces;
    expect(libraryViewShown()).toBe(false);
    expect(libraryViewOptions()).toEqual({ libraryView: LibraryView.Spaces });
  });

  it('is a pinned chip under personal or spaces, whose removal goes back to both', () => {
    expect(libraryViewChips()).toEqual([]);

    libraryView.current = LibraryView.Personal;
    expect(libraryViewChips()).toEqual([
      expect.objectContaining({
        type: 'library-view',
        labelKey: 'library_view_chip_personal',
        titleKey: 'library_view_remembered',
      }),
    ]);

    libraryView.current = LibraryView.Spaces;
    const [chip] = libraryViewChips();
    expect(chip.labelKey).toBe('library_view_chip_spaces');

    chip.onRemove();
    expect(libraryView.current).toBe('both');
  });

  it('goes back to both for "view in timeline"', () => {
    libraryView.current = LibraryView.Personal;
    resetLibraryView();
    expect(libraryView.current).toBe('both');
  });
});
