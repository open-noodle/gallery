import TestWrapper from '#lib/components/TestWrapper.svelte';
import { viewerSpaceKey, type ViewerSpace } from '#lib/gallery/viewer-space.ts';
import type { Component } from 'svelte';
import { render } from 'vitest-browser-svelte';

/** `renderWithTooltips` inside a viewer space scope, as TimelineAssetViewer sets it. */
export const renderInViewerSpace = <T extends Record<string, unknown>, K extends Component<T>>(
  component: K,
  props: T,
  viewerSpace: ViewerSpace,
) =>
  render(TestWrapper as Component<{ component: K; componentProps: T }>, {
    props: { component, componentProps: props },
    context: new Map([[viewerSpaceKey, () => viewerSpace]]),
  });
