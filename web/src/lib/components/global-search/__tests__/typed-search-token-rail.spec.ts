import TypedSearchTokenRail from '#lib/components/global-search/typed-search-token-rail.svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

describe('TypedSearchTokenRail', () => {
  it('renders recognized and pending tokens quietly', async () => {
    await render(TypedSearchTokenRail, {
      props: {
        tokens: [
          { raw: 'from:2025', key: 'from', value: '2025', status: 'recognized' },
          { raw: 'person:anna', key: 'person', value: 'anna', status: 'pending-entity' },
        ],
      },
    });

    await expect.element(page.getByText('from')).toBeVisible();
    await expect.element(page.getByText('2025')).toBeVisible();
    await expect.element(page.getByText('person')).toBeVisible();
    await expect.element(page.getByText('anna')).toBeVisible();
    await expect
      .element(page.getByTestId('typed-search-token-person'))
      .toHaveAttribute('data-status', 'pending-entity');
  });

  it('gives filter chips breathing room below the input row', async () => {
    await render(TypedSearchTokenRail, {
      props: {
        tokens: [{ raw: 'person:anna', key: 'person', value: 'anna', status: 'pending-entity' }],
      },
    });

    await expect.element(page.getByTestId('typed-search-token-rail')).toHaveClass('px-4', 'pt-2', 'pb-1');
  });

  it('renders typed filters as substantial key-value capsules', async () => {
    await render(TypedSearchTokenRail, {
      props: {
        tokens: [{ raw: 'person:anna', key: 'person', value: 'anna', status: 'pending-entity' }],
      },
    });

    await expect
      .element(page.getByTestId('typed-search-token-person'))
      .toHaveClass('min-h-7', 'overflow-hidden', 'rounded-full', 'text-xs');
    await expect
      .element(page.getByTestId('typed-search-token-person-key'))
      .toHaveClass('uppercase', 'tracking-[0.08em]');
    await expect.element(page.getByTestId('typed-search-token-person-value')).toHaveClass('px-2.5', 'py-1.5');
  });

  it('renders error tokens with issue text', async () => {
    await render(TypedSearchTokenRail, {
      props: {
        tokens: [
          {
            raw: 'person:anna',
            key: 'person',
            value: 'anna',
            status: 'error',
            issue: {
              code: 'no-match',
              raw: 'person:anna',
              key: 'person',
              value: 'anna',
              message: 'No person found for "anna"',
            },
          },
        ],
      },
    });

    await expect.element(page.getByTestId('typed-search-token-person')).toHaveAttribute('data-status', 'error');
    await expect.element(page.getByLabelText('No person found for "anna"')).toBeInTheDocument();
  });

  it('renders draft scalar errors with the error status color', async () => {
    await render(TypedSearchTokenRail, {
      props: {
        tokens: [
          {
            raw: 'rating:9',
            key: 'rating',
            value: '9',
            status: 'error',
            issue: {
              code: 'invalid-rating',
              raw: 'rating:9',
              key: 'rating',
              value: '9',
              message: 'Rating must be 0-5',
            },
          },
        ],
      },
    });

    await expect.element(page.getByTestId('typed-search-token-rating')).toHaveAttribute('data-status', 'error');
  });
});
