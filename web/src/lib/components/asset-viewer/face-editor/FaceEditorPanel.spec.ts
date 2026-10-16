import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderInViewerSpace } from '$lib/gallery/viewer-space.test-helpers';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import FaceEditorPanel from './FaceEditorPanel.svelte';

// The single swap point PhotoViewer.svelte and VideoNativeViewer.svelte both render instead of
// duplicating the FaceEditor/SpaceFaceEditor decision (Slice 8 gap closure). Tested in isolation
// here because VideoNativeViewer's own dependency tree (hls.js, media-chrome custom elements) is
// too heavy to mount in a component test — this is the actual logic under test for BOTH call
// sites, so proving it here, plus proving each call site threads the right props, covers the gap.

vi.mock('./FaceEditor.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/face-editor.stub.svelte');
  return { default: MockComponent };
});

vi.mock('./SpaceFaceEditor.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/space-face-editor.stub.svelte');
  return { default: MockComponent };
});

const htmlElement = { naturalWidth: 100, naturalHeight: 100 } as unknown as HTMLImageElement;

describe('FaceEditorPanel', () => {
  const base = { htmlElement, containerWidth: 100, containerHeight: 100, assetId: 'asset-1', onClose: vi.fn() };

  beforeEach(() => {
    authManager.setUser(userAdminFactory.build({ id: 'space-member' }));
    authManager.setPreferences(preferencesFactory.build());
  });

  it('renders SpaceFaceEditor and NOT FaceEditor for a non-owner editor in a viewer space', () => {
    const asset = assetFactory.build({ id: 'asset-1', ownerId: 'space-owner', canEdit: true });
    renderInViewerSpace(FaceEditorPanel, { ...base, asset }, { spaceId: 'space-1' });

    const stub = screen.getByTestId('space-face-editor-stub');
    expect(stub).toHaveAttribute('data-asset-id', 'asset-1');
    expect(stub).toHaveAttribute('data-space-id', 'space-1');
    expect(screen.queryByTestId('face-editor-stub')).toBeNull();
  });

  it('falls back to the space the asset resolved to when the viewer has no space', () => {
    const asset = assetFactory.build({ ownerId: 'space-owner', canEdit: true, resolvedSpaceId: 'space-9' });
    render(FaceEditorPanel, { ...base, asset });

    expect(screen.getByTestId('space-face-editor-stub')).toHaveAttribute('data-space-id', 'space-9');
  });

  it('renders FaceEditor and NOT SpaceFaceEditor for the asset owner, even inside a space', () => {
    const asset = assetFactory.build({ ownerId: 'space-member', canEdit: true });
    renderInViewerSpace(FaceEditorPanel, { ...base, asset }, { spaceId: 'space-1' });

    expect(screen.getByTestId('face-editor-stub')).toHaveAttribute('data-asset-id', 'asset-1');
    expect(screen.queryByTestId('space-face-editor-stub')).toBeNull();
  });

  it('renders FaceEditor for a non-owner who may not edit the asset', () => {
    const asset = assetFactory.build({ ownerId: 'space-owner', canEdit: false });
    renderInViewerSpace(FaceEditorPanel, { ...base, asset }, { spaceId: 'space-1' });

    expect(screen.getByTestId('face-editor-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('space-face-editor-stub')).toBeNull();
  });

  it('renders FaceEditor (never both) for an editor when no space id is available', () => {
    const asset = assetFactory.build({ ownerId: 'space-owner', canEdit: true, resolvedSpaceId: undefined });
    render(FaceEditorPanel, { ...base, asset });

    expect(screen.getByTestId('face-editor-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('space-face-editor-stub')).toBeNull();
  });
});
