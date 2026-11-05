import { LibraryView } from '@immich/sdk';
import { mdiPin } from '@mdi/js';
import { persisted } from 'svelte-persisted-store';
import { fromStore } from 'svelte/store';
import type { PinnedFilterChip } from '$lib/components/filter-panel/filter-panel';
import { loadSpaces } from '$lib/gallery/stores/spaces-cache';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { userInteraction } from '$lib/stores/user.svelte';

/** #1038: which photos `/photos` shows; `both` is the whole timeline. */
export type LibraryViewMode = LibraryView | 'both';

export const parseLibraryView = (text: string | null): LibraryViewMode => {
  try {
    const value: unknown = JSON.parse(text ?? 'null');
    return value === LibraryView.Personal || value === LibraryView.Spaces ? value : 'both';
  } catch {
    return 'both';
  }
};

export const libraryView = fromStore(
  persisted<LibraryViewMode>('gallery-library-view', 'both', {
    serializer: { parse: parseLibraryView, stringify: JSON.stringify },
  }),
);

/** Whether one of my spaces is on my timeline; undefined until the spaces list is loaded. */
const hasTimelineSpace = () =>
  userInteraction.recentSpaces?.some((space) =>
    space.members?.some((member) => member.userId === authManager.user.id && member.showInTimeline),
  );

/**
 * The view reads the spaces list, which every space change drops (spaces-cache). Reload it whenever that happens,
 * or the view stays applied with its section and chip hidden until something else refetches the list.
 */
export const keepSpacesLoaded = () => {
  $effect(() => {
    if (!userInteraction.recentSpaces) {
      loadSpaces();
    }
  });
};

/** The view only means something once a space is on the timeline, so the control waits for the spaces list. */
export const libraryViewShown = () => hasTimelineSpace() === true;

/**
 * The timeline query fields of the current view: none without a space on the timeline. Spaces not loaded yet keep the
 * remembered view, so the timeline does not load twice.
 */
export const libraryViewOptions = (): { libraryView?: LibraryView } => {
  const view = libraryView.current;
  return view !== 'both' && hasTimelineSpace() !== false ? { libraryView: view } : {};
};

/**
 * The view's chip in the active filters bar. The view is the one remembered filter, so a narrowed timeline
 * always says so, even with the filter panel closed; Clear all leaves it, its own close button goes back to Both.
 */
export const libraryViewChips = (): PinnedFilterChip[] => {
  const view = libraryView.current;
  if (view === 'both') {
    return [];
  }
  return [
    {
      type: 'library-view',
      icon: mdiPin,
      labelKey: view === LibraryView.Personal ? 'library_view_chip_personal' : 'library_view_chip_spaces',
      titleKey: 'library_view_remembered',
      onRemove: () => (libraryView.current = 'both'),
    },
  ];
};

/** "View in timeline" must find its photo, whatever the view hides. */
export const resetLibraryView = () => {
  libraryView.current = 'both';
};
