import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import GlobalSearchSection from '../global-search-section.svelte';

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
});
