import { render, type RenderResult } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { viewerSpaceKey, type ViewerSpace } from '$lib/gallery/viewer-space';

/** `renderWithTooltips` inside a viewer space scope, as TimelineAssetViewer sets it. */
export const renderInViewerSpace = <T extends Record<string, unknown>, K extends Component<T>>(
  component: K,
  props: T,
  viewerSpace: ViewerSpace,
) =>
  render(TestWrapper as Component<{ component: K; componentProps: T }>, {
    props: { component, componentProps: props },
    context: new Map([[viewerSpaceKey, () => viewerSpace]]),
  }) as unknown as RenderResult<K>;
