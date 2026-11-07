import SpaceCollage from '#lib/components/spaces/space-collage.svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

// eslint-disable-next-line unicorn/no-unnecessary-parameters
const makeAsset = (id: string, thumbhash: string | null = null) => ({ id, thumbhash });

describe('SpaceCollage component', () => {
  it('should render gradient placeholder for 0 assets', async () => {
    await render(SpaceCollage, { assets: [], gradientClass: 'from-blue-400 to-blue-600' });
    expect(page.getByTestId('collage-empty').element()).toBeInTheDocument();
  });

  it('should render single image layout for 1 asset', async () => {
    const { container } = await render(SpaceCollage, { assets: [makeAsset('a1')] });
    expect(page.getByTestId('collage-single').element()).toBeInTheDocument();
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toContain('a1');
  });

  it('should render asymmetric layout for 2 assets', async () => {
    const { container } = await render(SpaceCollage, { assets: [makeAsset('a1'), makeAsset('a2')] });
    expect(page.getByTestId('collage-asymmetric').element()).toBeInTheDocument();
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
  });

  it('should render asymmetric layout for 3 assets', async () => {
    const { container } = await render(SpaceCollage, { assets: [makeAsset('a1'), makeAsset('a2'), makeAsset('a3')] });
    expect(page.getByTestId('collage-asymmetric').element()).toBeInTheDocument();
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(3);
  });

  it('should render 2x2 grid layout for 4 assets', async () => {
    const { container } = await render(SpaceCollage, {
      assets: [makeAsset('a1'), makeAsset('a2'), makeAsset('a3'), makeAsset('a4')],
    });
    expect(page.getByTestId('collage-grid').element()).toBeInTheDocument();
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(4);
  });

  it('should render 2x2 grid with only first 4 for 5+ assets', async () => {
    const { container } = await render(SpaceCollage, {
      assets: [makeAsset('a1'), makeAsset('a2'), makeAsset('a3'), makeAsset('a4'), makeAsset('a5')],
    });
    expect(page.getByTestId('collage-grid').element()).toBeInTheDocument();
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(4);
  });

  it('should use eager loading when preload is true', async () => {
    const { container } = await render(SpaceCollage, { assets: [makeAsset('a1')], preload: true });
    const img = container.querySelector('img');
    expect(img?.getAttribute('loading')).toBe('eager');
  });

  it('should use lazy loading by default', async () => {
    const { container } = await render(SpaceCollage, { assets: [makeAsset('a1')] });
    const img = container.querySelector('img');
    expect(img?.getAttribute('loading')).toBe('lazy');
  });
});
