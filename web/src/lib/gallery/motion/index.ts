import { crossfadeNavigation } from '#lib/gallery/motion/page-transition.ts';
import { installPressFeedback } from '#lib/gallery/motion/press.ts';
import { installTilt } from '#lib/gallery/motion/tilt.ts';
import { onMount } from 'svelte';
import { onNavigate } from '$app/navigation';

export { celebrate, pop } from '#lib/gallery/motion/celebrate.ts';
export { animateRemoval, type RemovalKind, type RemovalTarget } from '#lib/gallery/motion/removal.ts';
export { duration, ease, spring, springEasing } from '#lib/gallery/motion/tokens.ts';

/**
Root-layout hook, called once during the layout's initialisation: installs the site-wide press
feedback, the card tilt and the crossfade between pages. Design: specs/2026-10-23-web-motion-language-design.md.
*/
export const setupMotion = (): void => {
  onMount(() => {
    const uninstallPress = installPressFeedback();
    const uninstallTilt = installTilt();
    return () => {
      uninstallPress();
      uninstallTilt();
    };
  });
  onNavigate(crossfadeNavigation);
};
