import { LibraryView } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import LibraryViewFilter from './LibraryViewFilter.svelte';
import { libraryView } from './library-view.svelte';

describe('LibraryViewFilter', () => {
  afterEach(() => {
    libraryView.current = 'both';
  });

  it('is a filter panel section offering both, personal and spaces, with the current view pressed', async () => {
    libraryView.current = LibraryView.Personal;
    await render(LibraryViewFilter);

    await expect.element(page.getByTestId('filter-section-library-view')).toMatchTextContent('library_view');
    await expect.element(page.getByRole('group', { name: 'library_view' })).toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'library_view_both' }))
      .toHaveAttribute('aria-pressed', 'false');
    await expect
      .element(page.getByRole('button', { name: 'library_view_personal' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect
      .element(page.getByRole('button', { name: 'library_view_spaces' }))
      .toHaveAttribute('aria-pressed', 'false');
  });

  it('says which photos personal and spaces hold', async () => {
    await render(LibraryViewFilter);

    await expect
      .element(page.getByRole('button', { name: 'library_view_personal' }))
      .toHaveAttribute('title', 'library_view_personal_description');
    await expect
      .element(page.getByRole('button', { name: 'library_view_spaces' }))
      .toHaveAttribute('title', 'library_view_spaces_description');
  });

  it('switches the view by click', async () => {
    await render(LibraryViewFilter);

    await page.getByRole('button', { name: 'library_view_spaces' }).click();
    expect(libraryView.current).toBe(LibraryView.Spaces);
    await expect
      .element(page.getByRole('button', { name: 'library_view_spaces' }))
      .toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'library_view_both' }).click();
    expect(libraryView.current).toBe('both');
  });
});
