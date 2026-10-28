import type { OnNavigate } from '@sveltejs/kit';
import { prefersReducedMotion } from '$lib/gallery/motion/tokens';

/**
 * Section changes (Photos → Albums → Spaces) crossfade through the View Transitions API, with the
 * sidebar and top bar held still (motion.css names them). Only between different pages: a filter or
 * query change on the same page, and anything opening or closing the asset viewer, swaps instantly,
 * because the viewer has its own motion and a snapshot of the timeline would stall it.
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

/**
 * Elements that morph from one page to the next opt in with `data-shared-element="<name>"`: a hub photo
 * collage becoming the rewind header's photo stack, say. They are named only while a transition runs, since a
 * `view-transition-name` makes its element a stacking context (rule 6 in the motion design).
 */
export const SHARED_ELEMENT_ATTR = 'data-shared-element';

/** Names every opted-in element under `root` after its attribute; returns a function that clears them. */
export const nameSharedElements = (root: ParentNode): (() => void) => {
  const elements = [...root.querySelectorAll<HTMLElement>('[data-shared-element]')];
  for (const element of elements) {
    element.style.viewTransitionName = element.getAttribute(SHARED_ELEMENT_ATTR) ?? '';
  }
  return () => {
    for (const element of elements) {
      element.style.viewTransitionName = '';
    }
  };
};

/** `onNavigate` callback: SvelteKit waits for the returned promise before swapping the page. */
export const crossfadeNavigation = (navigation: OnNavigate): Promise<void> | void => {
  // Older browsers without View Transitions just swap pages.
  // eslint-disable-next-line tscompat/tscompat
  if (typeof document === 'undefined' || !document.startViewTransition || prefersReducedMotion()) {
    return;
  }
  if (!shouldCrossfade(navigation)) {
    return;
  }
  // The sidebar and top bar are named only for the transition's lifetime (see motion.css).
  const root = document.documentElement;
  root.classList.add(TRANSITION_CLASS);
  // The old page's shared elements are captured when the transition starts, the new page's once it rendered.
  const clearOld = nameSharedElements(document);
  let clearNew = () => {};
  return new Promise((resolve) => {
    // eslint-disable-next-line tscompat/tscompat
    const transition = document.startViewTransition(async () => {
      resolve();
      await navigation.complete;
      clearOld();
      clearNew = nameSharedElements(document);
    });
    // eslint-disable-next-line tscompat/tscompat
    void transition.finished.finally(() => {
      root.classList.remove(TRANSITION_CLASS);
      clearOld();
      clearNew();
    });
  });
};
