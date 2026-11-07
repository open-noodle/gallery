import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import SortToggle from '../sort-toggle.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('SortToggle', () => {
  it('should show descending by default', async () => {
    const { getByTestId } = await render(SortToggle, {
      sortOrder: 'desc',
      onToggle: () => {},
    });

    const button = getByTestId('sort-toggle');
    await expect.element(button).toBeInTheDocument();
    expect(button.element().getAttribute('title')).toBe('Sort: newest first');
  });

  it('should toggle direction on click', async () => {
    let toggled: 'asc' | 'desc' | undefined;
    const onToggle = (order: 'asc' | 'desc') => {
      toggled = order;
    };

    const { getByTestId } = await render(SortToggle, {
      sortOrder: 'desc',
      onToggle,
    });

    await getByTestId('sort-toggle').click();
    expect(toggled).toBe('asc');
  });

  it('should toggle from asc to desc', async () => {
    let toggled: 'asc' | 'desc' | undefined;
    const onToggle = (order: 'asc' | 'desc') => {
      toggled = order;
    };

    const { getByTestId } = await render(SortToggle, {
      sortOrder: 'asc',
      onToggle,
    });

    const button = getByTestId('sort-toggle');
    expect(button.element().getAttribute('title')).toBe('Sort: oldest first');

    await button.click();
    expect(toggled).toBe('desc');
  });
});
