import { renderWithTooltips } from '#test/unit/helpers.ts';
import { page } from 'vitest/browser';
import AlbumsControls from './AlbumsControls.svelte';

describe('AlbumsControls toolbar order', () => {
  it('renders Create album after the Cover/List view toggle', async () => {
    await renderWithTooltips(AlbumsControls, { albumGroups: [], searchQuery: '' });
    const create = page.getByText('create_album').element().closest('button')!;
    const toggle = page
      .getByText(/^(list|covers)$/)
      .element()
      .closest('button')!;
    // create must come AFTER toggle in DOM order
    expect(toggle.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
