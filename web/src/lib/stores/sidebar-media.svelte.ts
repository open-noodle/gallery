import { MediaQuery } from 'svelte/reactivity';
import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';

// Above this width `auto` mode shows the full sidebar; between here and the 850px
// `--breakpoint-sidebar` it shows the rail. Declared here rather than in upstream
// `media-query-manager.svelte.ts` to keep the change fork-only. 1279px, not 1280px, to
// match this codebase's own `--breakpoint-xl` (app.css) - 1280px sits exactly on the
// Playwright `web` project's 1280x720 viewport, which would otherwise straddle the
// threshold and make sidebar layout flaky under e2e.
const wideSidebar = new MediaQuery('min-width: 1279px');

export const sidebarMedia = {
  get isFullSidebar() {
    return mediaQueryManager.isFullSidebar;
  },
  get isWideSidebar() {
    return wideSidebar.current;
  },
};
