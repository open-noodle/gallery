import { LibraryView } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import LibraryViewFilter from './LibraryViewFilter.svelte';
import { libraryView } from './library-view.svelte';

describe('LibraryViewFilter', () => {
  afterEach(() => {
    libraryView.current = 'both';
  });

  it('is a filter panel section offering both, personal and spaces, with the current view pressed', () => {
    libraryView.current = LibraryView.Personal;
    render(LibraryViewFilter);

    expect(screen.getByTestId('filter-section-library-view')).toHaveTextContent('library_view');
    expect(screen.getByRole('group', { name: 'library_view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'library_view_both' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'library_view_personal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'library_view_spaces' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('says which photos personal and spaces hold', () => {
    render(LibraryViewFilter);

    expect(screen.getByRole('button', { name: 'library_view_personal' })).toHaveAttribute(
      'title',
      'library_view_personal_description',
    );
    expect(screen.getByRole('button', { name: 'library_view_spaces' })).toHaveAttribute(
      'title',
      'library_view_spaces_description',
    );
  });

  it('switches the view by click', async () => {
    render(LibraryViewFilter);

    await fireEvent.click(screen.getByRole('button', { name: 'library_view_spaces' }));
    expect(libraryView.current).toBe(LibraryView.Spaces);
    expect(screen.getByRole('button', { name: 'library_view_spaces' })).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.click(screen.getByRole('button', { name: 'library_view_both' }));
    expect(libraryView.current).toBe('both');
  });
});
