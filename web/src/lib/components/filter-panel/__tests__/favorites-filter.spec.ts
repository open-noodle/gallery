import FavoritesFilter from '#lib/components/filter-panel/favorites-filter.svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

describe('FavoritesFilter', () => {
  it('should render All and Favorites buttons', async () => {
    const screen = await render(FavoritesFilter, { selected: undefined, onToggle: vi.fn() });
    await expect.element(screen.getByTestId('favorites-all')).toBeInTheDocument();
    await expect.element(screen.getByTestId('favorites-only')).toBeInTheDocument();
  });

  it('should highlight All when selected is undefined', async () => {
    const screen = await render(FavoritesFilter, { selected: undefined, onToggle: vi.fn() });
    const allBtn = screen.getByTestId('favorites-all').element();
    expect(allBtn.className).toContain('border-immich-primary');
  });

  it('should highlight Favorites when selected is true', async () => {
    const screen = await render(FavoritesFilter, { selected: true, onToggle: vi.fn() });
    const favBtn = screen.getByTestId('favorites-only').element();
    expect(favBtn.className).toContain('border-immich-primary');
  });

  it('should call onToggle with true when Favorites clicked', async () => {
    const onToggle = vi.fn();
    const screen = await render(FavoritesFilter, { selected: undefined, onToggle });
    await screen.getByTestId('favorites-only').click();
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('should call onToggle with undefined when All clicked', async () => {
    const onToggle = vi.fn();
    const screen = await render(FavoritesFilter, { selected: true, onToggle });
    await screen.getByTestId('favorites-all').click();
    expect(onToggle).toHaveBeenCalledWith(undefined);
  });
});
