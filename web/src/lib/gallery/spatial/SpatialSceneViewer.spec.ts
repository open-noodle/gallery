import source from './SpatialSceneViewer.svelte?raw';

describe('SpatialSceneViewer', () => {
  // S3 redirect mode serves the preview and depth map from another origin; without CORS the canvas reads throw
  it('sets anonymous CORS before loading an image', () => {
    const crossOriginIndex = source.indexOf("image.crossOrigin = 'anonymous';");
    const srcIndex = source.indexOf('image.src = src;');

    expect(crossOriginIndex).toBeGreaterThanOrEqual(0);
    expect(crossOriginIndex).toBeLessThan(srcIndex);
  });
});
