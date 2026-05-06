import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';

vi.mock('$lib/components/shared-components/navigation-bar/navigation-bar.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/side-bar/user-sidebar.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

describe('UserPageLayout header', () => {
  it('keeps long people statistics visible beside a truncating title', () => {
    render(UserPageLayout, {
      props: {
        title: 'People',
        description: '(60) \u00b7 2,901 faces',
      },
    });

    expect(screen.getByTestId('page-header-description')).toHaveTextContent('(60) \u00b7 2,901 faces');
    expect(screen.getByTestId('page-header-title-row')).toHaveClass('min-w-0', 'overflow-hidden');
    expect(screen.getByTestId('page-header')).toHaveClass('min-w-0', 'truncate');
    expect(screen.getByTestId('page-header-description')).toHaveClass('shrink-0', 'whitespace-nowrap');
  });
});
