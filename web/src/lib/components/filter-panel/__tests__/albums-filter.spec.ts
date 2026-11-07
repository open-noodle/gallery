import AlbumsFilter from '#lib/components/filter-panel/albums-filter.svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

describe('AlbumsFilter', () => {
  it('should render All, Has album, and Has no album buttons', async () => {
    const screen = await render(AlbumsFilter, { selected: 'all', onChange: vi.fn() });

    await expect.element(screen.getByTestId('albums-all')).toBeInTheDocument();
    await expect.element(screen.getByTestId('albums-has')).toBeInTheDocument();
    await expect.element(screen.getByTestId('albums-none')).toBeInTheDocument();
  });

  it('should highlight All when selected is all', async () => {
    const screen = await render(AlbumsFilter, { selected: 'all', onChange: vi.fn() });

    expect(screen.getByTestId('albums-all').element().className).toContain('border-immich-primary');
  });

  it('should highlight Has album when selected is has', async () => {
    const screen = await render(AlbumsFilter, { selected: 'has', onChange: vi.fn() });

    expect(screen.getByTestId('albums-has').element().className).toContain('border-immich-primary');
  });

  it('should highlight Has no album when selected is none', async () => {
    const screen = await render(AlbumsFilter, { selected: 'none', onChange: vi.fn() });

    expect(screen.getByTestId('albums-none').element().className).toContain('border-immich-primary');
  });

  it('should call onChange with has when Has album is clicked', async () => {
    const onChange = vi.fn();
    const screen = await render(AlbumsFilter, { selected: 'all', onChange });

    await screen.getByTestId('albums-has').click();

    expect(onChange).toHaveBeenCalledWith('has');
  });

  it('should call onChange with none when Has no album is clicked', async () => {
    const onChange = vi.fn();
    const screen = await render(AlbumsFilter, { selected: 'all', onChange });

    await screen.getByTestId('albums-none').click();

    expect(onChange).toHaveBeenCalledWith('none');
  });

  it('should call onChange with all when All is clicked', async () => {
    const onChange = vi.fn();
    const screen = await render(AlbumsFilter, { selected: 'has', onChange });

    await screen.getByTestId('albums-all').click();

    expect(onChange).toHaveBeenCalledWith('all');
  });
});
