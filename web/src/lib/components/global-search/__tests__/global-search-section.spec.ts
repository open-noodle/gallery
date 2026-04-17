import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it } from 'vitest';
import GlobalSearchSection from '../global-search-section.svelte';

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

// Note: the `ok` rendering path requires a Command.Root ancestor context (bits-ui
// Command.Group throws without one). That path is covered by the integration tests in
// global-search.spec.ts. This spec covers only the side-fix concern: that empty/idle
// statuses produce zero DOM output, never hitting Command.Group at all.
describe('global-search-section empty-state', () => {
  const baseProps = {
    heading: 'Photos',
    idPrefix: 'photo' as const,
    onActivate: () => {},
    renderRow: createRawSnippet(() => ({ render: () => '<span></span>' })),
  };

  it('renders NOTHING when status is empty', () => {
    const { container } = render(GlobalSearchSection, {
      props: { ...baseProps, status: { status: 'empty' } },
    });
    expect(container.querySelector('[data-command-group-heading]')).toBeNull();
    expect(container.querySelector('[data-command-group]')).toBeNull();
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders nothing when status is idle', () => {
    const { container } = render(GlobalSearchSection, {
      props: { ...baseProps, status: { status: 'idle' } },
    });
    expect(container.textContent?.trim()).toBe('');
  });

  it('accepts album items via the album idPrefix', () => {
    const albumItem = {
      id: 'a1',
      albumName: 'x',
      shared: false,
      albumThumbnailAssetId: null,
      assetCount: 0,
    };
    expect(() =>
      render(GlobalSearchSection, {
        props: {
          heading: 'Albums',
          idPrefix: 'album' as const,
          onActivate: () => {},
          renderRow: createRawSnippet(() => ({ render: () => '<span></span>' })),
          status: { status: 'empty' },
          // Reference the item so the generic is inferred as the album shape even on the
          // `empty` render path — this exercises the T generic for the album variant.
          onSeeAll: () => void albumItem,
        },
      }),
    ).not.toThrow();
  });

  it('accepts space items via the space idPrefix', () => {
    const spaceItem = {
      id: 's1',
      name: 'My Space',
      ownerId: 'o1',
      assetCount: 0,
    };
    expect(() =>
      render(GlobalSearchSection, {
        props: {
          heading: 'Spaces',
          idPrefix: 'space' as const,
          onActivate: () => {},
          renderRow: createRawSnippet(() => ({ render: () => '<span></span>' })),
          status: { status: 'empty' },
          onSeeAll: () => void spaceItem,
        },
      }),
    ).not.toThrow();
  });
});
