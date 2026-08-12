import { persisted } from 'svelte-persisted-store';

// Remembers the manual-review owner selection across navigation (e.g. reviewing a person and returning to
// the people grid, which fully remounts the page) and across reloads, so the owner picker doesn't fall back
// to whichever user happens to sort first alphabetically.
export const manualReviewOwnerId = persisted<string | null>('face-cleanup-manual-review-owner-id', null);
