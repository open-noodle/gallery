import { crossfadeNavigation } from '#lib/gallery/motion/page-transition.ts';
import { installPressFeedback } from '#lib/gallery/motion/press.ts';
import { installThumbnailLift } from '#lib/gallery/motion/thumbnail-lift.ts';
import { installTilt } from '#lib/gallery/motion/tilt.ts';
import { installViewerZoom, viewerZoomBeforeNavigate } from '#lib/gallery/motion/viewer-zoom.ts';
import { onMount } from 'svelte';
import { beforeNavigate, onNavigate } from '$app/navigation';

export { celebrate, pop, pulse } from '#lib/gallery/motion/celebrate.ts';
export { countMotion, flipMotion, slideFrom, staggerDelay, type ListMotion } from '#lib/gallery/motion/list.ts';
export { nameSharedElements, SHARED_ELEMENT_ATTR } from '#lib/gallery/motion/page-transition.ts';
export { animateRemoval, type RemovalKind, type RemovalTarget } from '#lib/gallery/motion/removal.ts';
export { duration, ease, spring, springEasing } from '#lib/gallery/motion/tokens.ts';

/**
Root-layout hook, called once during the layout's initialisation: installs the site-wide press
feedback, the card tilt, the timeline photo lift and the crossfade between pages. Design: specs/2026-10-23-web-motion-language-design.md.
*/
export const setupMotion = (): void => {
  onMount(() => {
    const uninstallPress = installPressFeedback();
    const uninstallTilt = installTilt();
    const uninstallThumbnailLift = installThumbnailLift();
    const uninstallViewerZoom = installViewerZoom();
    return () => {
      uninstallPress();
      uninstallTilt();
      uninstallThumbnailLift();
      uninstallViewerZoom();
    };
  });
  beforeNavigate(viewerZoomBeforeNavigate);
  onNavigate(crossfadeNavigation);
};
