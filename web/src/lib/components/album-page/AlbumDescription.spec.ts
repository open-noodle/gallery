import { describe } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import AlbumDescription from './AlbumDescription.svelte';

describe('AlbumDescription component', () => {
  it('shows an AutogrowTextarea component when isOwned is true', async () => {
    await render(AlbumDescription, { isEditor: true, id: '', description: '' });
    const autogrowTextarea = page.getByTestId('autogrow-textarea').element();
    expect(autogrowTextarea).toBeInTheDocument();
  });

  it('does not show an AutogrowTextarea component when isOwned is false', async () => {
    await render(AlbumDescription, { isEditor: false, id: '', description: '' });
    const autogrowTextarea = page.getByTestId('autogrow-textarea').query();
    expect(autogrowTextarea).not.toBeInTheDocument();
  });
});
