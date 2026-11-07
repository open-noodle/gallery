import { renderInViewerSpace } from '#lib/gallery/viewer-space.test-helpers.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import FaceEditorPanel from './FaceEditorPanel.svelte';

// The single swap point PhotoViewer.svelte and VideoNativeViewer.svelte both render instead of
// duplicating the FaceEditor owner/space-mode decision (Slice 8 gap closure). Tested in isolation
// here because VideoNativeViewer's own dependency tree (hls.js, media-chrome custom elements) is
// too heavy to mount in a component test — this is the actual logic under test for BOTH call
// sites, so proving it here, plus proving each call site threads the right props, covers the gap.

vi.mock('./FaceEditor.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/face-editor.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/gallery/asset-viewer/space-face-editor.js', () => ({
  getFaceEditorSpace: (spaceId: string) => ({ spaceId }),
}));

const htmlElement = { naturalWidth: 100, naturalHeight: 100 } as unknown as HTMLImageElement;

describe('FaceEditorPanel', () => {
  const base = { htmlElement, containerWidth: 100, containerHeight: 100, assetId: 'asset-1' };

  beforeEach(() => {
    authManager.setUser(factory.user({ id: 'space-member' }));
    authManager.setPreferences(factory.preferences());
  });

  it('renders FaceEditor in its space mode for a non-owner editor in a viewer space', async () => {
    const asset = factory.asset({ id: 'asset-1', ownerId: 'space-owner', canEdit: true });
    await renderInViewerSpace(FaceEditorPanel, { ...base, asset }, { spaceId: 'space-1' });

    const stub = page.getByTestId('face-editor-stub');
    await expect.element(stub).toHaveAttribute('data-asset-id', 'asset-1');
    await expect.element(stub).toHaveAttribute('data-space-id', 'space-1');
  });

  it('falls back to the space the asset resolved to when the viewer has no space', async () => {
    const asset = factory.asset({ ownerId: 'space-owner', canEdit: true, resolvedSpaceId: 'space-9' });
    await render(FaceEditorPanel, { ...base, asset });

    await expect.element(page.getByTestId('face-editor-stub')).toHaveAttribute('data-space-id', 'space-9');
  });

  it('renders FaceEditor in its owner mode for the asset owner, even inside a space', async () => {
    const asset = factory.asset({ ownerId: 'space-member', canEdit: true });
    await renderInViewerSpace(FaceEditorPanel, { ...base, asset }, { spaceId: 'space-1' });

    await expect.element(page.getByTestId('face-editor-stub')).toHaveAttribute('data-asset-id', 'asset-1');
    await expect.element(page.getByTestId('face-editor-stub')).not.toHaveAttribute('data-space-id');
  });

  it('renders FaceEditor in its owner mode for a non-owner who may not edit the asset', async () => {
    const asset = factory.asset({ ownerId: 'space-owner', canEdit: false });
    await renderInViewerSpace(FaceEditorPanel, { ...base, asset }, { spaceId: 'space-1' });

    await expect.element(page.getByTestId('face-editor-stub')).toBeInTheDocument();
    await expect.element(page.getByTestId('face-editor-stub')).not.toHaveAttribute('data-space-id');
  });

  it('renders FaceEditor in its owner mode for an editor when no space id is available', async () => {
    const asset = factory.asset({ ownerId: 'space-owner', canEdit: true, resolvedSpaceId: undefined });
    await render(FaceEditorPanel, { ...base, asset });

    await expect.element(page.getByTestId('face-editor-stub')).toBeInTheDocument();
    await expect.element(page.getByTestId('face-editor-stub')).not.toHaveAttribute('data-space-id');
  });
});
