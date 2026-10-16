import { persisted } from 'svelte-persisted-store';

/**
 * Whether the photo-context block in the face suggestion review is open (#1039).
 *
 * A preference, not per-candidate state: someone who reviews faces WITH the context open wants it open for
 * the next face too, and for the next session. Module scope so every instance — and both the personal and
 * the Space review route — share the one switch.
 */
export const faceSuggestionContextExpanded = persisted('face-suggestion-context-expanded', false);
