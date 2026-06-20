import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import AlbumsFilter from '$lib/components/filter-panel/albums-filter.svelte';

describe('AlbumsFilter', () => {
  it('should render All, Has album, and Has no album buttons', () => {
    render(AlbumsFilter, { props: { selected: 'all', onChange: vi.fn() } });

    expect(screen.getByTestId('albums-all')).toBeInTheDocument();
    expect(screen.getByTestId('albums-has')).toBeInTheDocument();
    expect(screen.getByTestId('albums-none')).toBeInTheDocument();
  });

  it('should highlight All when selected is all', () => {
    render(AlbumsFilter, { props: { selected: 'all', onChange: vi.fn() } });

    expect(screen.getByTestId('albums-all').className).toContain('border-immich-primary');
  });

  it('should highlight Has album when selected is has', () => {
    render(AlbumsFilter, { props: { selected: 'has', onChange: vi.fn() } });

    expect(screen.getByTestId('albums-has').className).toContain('border-immich-primary');
  });

  it('should highlight Has no album when selected is none', () => {
    render(AlbumsFilter, { props: { selected: 'none', onChange: vi.fn() } });

    expect(screen.getByTestId('albums-none').className).toContain('border-immich-primary');
  });

  it('should call onChange with has when Has album is clicked', () => {
    const onChange = vi.fn();
    render(AlbumsFilter, { props: { selected: 'all', onChange } });

    screen.getByTestId('albums-has').click();

    expect(onChange).toHaveBeenCalledWith('has');
  });

  it('should call onChange with none when Has no album is clicked', () => {
    const onChange = vi.fn();
    render(AlbumsFilter, { props: { selected: 'all', onChange } });

    screen.getByTestId('albums-none').click();

    expect(onChange).toHaveBeenCalledWith('none');
  });

  it('should call onChange with all when All is clicked', () => {
    const onChange = vi.fn();
    render(AlbumsFilter, { props: { selected: 'has', onChange } });

    screen.getByTestId('albums-all').click();

    expect(onChange).toHaveBeenCalledWith('all');
  });
});
