import { onMount } from 'svelte';
import { onNavigate } from '$app/navigation';
import { crossfadeNavigation } from '$lib/gallery/motion/page-transition';
import { installPressFeedback } from '$lib/gallery/motion/press';
import { installThumbnailLift } from '$lib/gallery/motion/thumbnail-lift';
import { installTilt } from '$lib/gallery/motion/tilt';

export { celebrate, pop, pulse } from '$lib/gallery/motion/celebrate';
export { countMotion, flipMotion, slideFrom, staggerDelay, type ListMotion } from '$lib/gallery/motion/list';
export { nameSharedElements, SHARED_ELEMENT_ATTR } from '$lib/gallery/motion/page-transition';
export { animateRemoval, type RemovalKind, type RemovalTarget } from '$lib/gallery/motion/removal';
export { duration, ease, spring, springEasing } from '$lib/gallery/motion/tokens';

/**
 * Root-layout hook, called once during the layout's initialisation: installs the site-wide press
 * feedback, the card tilt, the timeline photo lift and the crossfade between pages. Design: specs/2026-10-23-web-motion-language-design.md.
 */
export const setupMotion = (): void => {
  onMount(() => {
    const uninstallPress = installPressFeedback();
    const uninstallTilt = installTilt();
    const uninstallThumbnailLift = installThumbnailLift();
    return () => {
      uninstallPress();
      uninstallTilt();
      uninstallThumbnailLift();
    };
  });
  onNavigate(crossfadeNavigation);
};
