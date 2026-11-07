import QueryRow from '#lib/components/global-search/rows/query-row.svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

describe('query-row', () => {
  it('renders the query recent row with a magnify icon and text', async () => {
    const { container } = await render(QueryRow, {
      props: { entry: { text: 'beach' } },
    });

    await expect.element(page.getByTestId('query-row')).toBeInTheDocument();
    await expect.element(page.getByText('beach')).toBeVisible();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
