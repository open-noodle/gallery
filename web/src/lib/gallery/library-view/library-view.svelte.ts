import { LibraryView } from '@immich/sdk';
import { persisted } from 'svelte-persisted-store';
import { fromStore } from 'svelte/store';
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

/** "View in timeline" must find its photo, whatever the view hides. */
export const resetLibraryView = () => {
  libraryView.current = 'both';
};
