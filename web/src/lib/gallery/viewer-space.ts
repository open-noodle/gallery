import { getContext, setContext } from 'svelte';

/** The shared space an asset viewer is opened on: `spaceId` scopes reads, `space` gates actions (#889). */
export type ViewerSpace = { spaceId?: string; space?: { id: string; canWrite: boolean } };

export const viewerSpaceKey = Symbol('gallery-viewer-space');

/**
 * Called by the surface that opens the viewer (TimelineAssetViewer, space search results).
 * Portal.svelte keeps component context, so it reaches AssetViewer and its children. A getter,
 * so readers follow prop changes.
 */
export const setViewerSpace = (get: () => ViewerSpace) => setContext(viewerSpaceKey, get);

/** Call during component init; read the returned getter where the value is used. */
export const getViewerSpace = (): (() => ViewerSpace) =>
  getContext<(() => ViewerSpace) | undefined>(viewerSpaceKey) ?? (() => ({}));
