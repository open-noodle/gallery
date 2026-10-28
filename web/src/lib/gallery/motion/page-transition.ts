import { prefersReducedMotion } from '#lib/gallery/motion/tokens.ts';
import type { OnNavigate } from '$app/navigation';

/**
Section changes (Photos → Albums → Spaces) crossfade through the View Transitions API, with the
sidebar and top bar held still (motion.css names them). Only between different pages: a filter or
query change on the same page, and anything opening or closing the asset viewer, swaps instantly,
because the viewer has its own motion and a snapshot of the timeline would stall it.
*/

/** The parts of a SvelteKit navigation end the decision reads. */
interface NavigationEnd {
  route: { id: string | null };
  params: Record<string, string> | null;
}

export const shouldCrossfade = (navigation: {
  from: NavigationEnd | null;
  to: NavigationEnd | null;
  willUnload: boolean;
}): boolean => {
  const from = navigation.from?.route.id;
  const to = navigation.to?.route.id;
  if (navigation.willUnload || !from || !to || from === to) {
    return false;
  }
  // Every route that can show the asset viewer carries it as an `assetId` param.
  return !navigation.from?.params?.assetId && !navigation.to?.params?.assetId;
};

const TRANSITION_CLASS = 'gallery-page-transition';

/** `onNavigate` callback: SvelteKit waits for the returned promise before swapping the page. */
export const crossfadeNavigation = (navigation: OnNavigate): Promise<void> | void => {
  // Older browsers without View Transitions just swap pages.

  if (typeof document === 'undefined' || !document.startViewTransition || prefersReducedMotion()) {
    return;
  }
  if (!shouldCrossfade(navigation)) {
    return;
  }
  // The sidebar and top bar are named only for the transition's lifetime (see motion.css).
  const root = document.documentElement;
  root.classList.add(TRANSITION_CLASS);
  return new Promise((resolve) => {
    const transition = document.startViewTransition(async () => {
      resolve();
      await navigation.complete;
    });
    // eslint-disable-next-line tscompat/tscompat
    void transition.finished.finally(() => root.classList.remove(TRANSITION_CLASS));
  });
};
