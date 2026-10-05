import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
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
  it('renders SpaceFaceEditor and NOT FaceEditor when canEditSpacePeople is true with a spaceId', () => {
    render(FaceEditorPanel, {
      htmlElement,
      containerWidth: 100,
      containerHeight: 100,
      assetId: 'asset-1',
      spaceId: 'space-1',
      canEditSpacePeople: true,
      onClose: vi.fn(),
    });

    const stub = screen.getByTestId('space-face-editor-stub');
    expect(stub).toHaveAttribute('data-asset-id', 'asset-1');
    expect(stub).toHaveAttribute('data-space-id', 'space-1');
    expect(screen.queryByTestId('face-editor-stub')).toBeNull();
  });

  it('renders FaceEditor and NOT SpaceFaceEditor when canEditSpacePeople is false', () => {
    render(FaceEditorPanel, {
      htmlElement,
      containerWidth: 100,
      containerHeight: 100,
      assetId: 'asset-1',
      spaceId: 'space-1',
      canEditSpacePeople: false,
      onClose: vi.fn(),
    });

    expect(screen.getByTestId('face-editor-stub')).toHaveAttribute('data-asset-id', 'asset-1');
    expect(screen.queryByTestId('space-face-editor-stub')).toBeNull();
  });

  it('renders FaceEditor (never both) when canEditSpacePeople is true but no spaceId is available', () => {
    render(FaceEditorPanel, {
      htmlElement,
      containerWidth: 100,
      containerHeight: 100,
      assetId: 'asset-1',
      canEditSpacePeople: true,
      onClose: vi.fn(),
    });

    expect(screen.getByTestId('face-editor-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('space-face-editor-stub')).toBeNull();
  });

  it('defaults canEditSpacePeople to false, rendering FaceEditor when the prop is omitted', () => {
    render(FaceEditorPanel, {
      htmlElement,
      containerWidth: 100,
      containerHeight: 100,
      assetId: 'asset-1',
      spaceId: 'space-1',
      onClose: vi.fn(),
    });

    expect(screen.getByTestId('face-editor-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('space-face-editor-stub')).toBeNull();
  });
});
