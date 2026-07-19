import { screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { renderWithTooltips } from '$tests/helpers';
import AlbumsControls from './AlbumsControls.svelte';

describe('AlbumsControls toolbar order', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  it('renders Create album after the Cover/List view toggle', () => {
    renderWithTooltips(AlbumsControls, { albumGroups: [], searchQuery: '' });
    const create = screen.getByText('Create album').closest('button')!;
    const toggle = screen.getByText(/^(List|Covers)$/).closest('button')!;
    // create must come AFTER toggle in DOM order
    expect(toggle.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
