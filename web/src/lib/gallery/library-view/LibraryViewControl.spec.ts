import { LibraryView } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import LibraryViewControl from './LibraryViewControl.svelte';
import { libraryView } from './library-view.svelte';

describe('LibraryViewControl', () => {
  afterEach(() => {
    libraryView.current = 'both';
  });

  it('offers both, personal and spaces, with the current view pressed', () => {
    libraryView.current = LibraryView.Personal;
    render(LibraryViewControl);

    expect(screen.getByRole('group', { name: 'library_view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'library_view_both' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'library_view_personal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'library_view_spaces' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('says which photos personal and spaces hold', () => {
    render(LibraryViewControl);

    expect(screen.getByRole('button', { name: 'library_view_personal' })).toHaveAttribute(
      'title',
      'library_view_personal_description',
    );
    expect(screen.getByRole('button', { name: 'library_view_spaces' })).toHaveAttribute(
      'title',
      'library_view_spaces_description',
    );
  });

  it('switches the view by click and with the arrow keys', async () => {
    render(LibraryViewControl);

    await fireEvent.click(screen.getByRole('button', { name: 'library_view_spaces' }));
    expect(libraryView.current).toBe(LibraryView.Spaces);
    expect(screen.getByRole('button', { name: 'library_view_spaces' })).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.keyDown(screen.getByRole('button', { name: 'library_view_spaces' }), { key: 'ArrowRight' });
    expect(libraryView.current).toBe('both');
  });
});
