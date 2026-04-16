import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import GlobalSearchSection from '../global-search-section.svelte';
import SectionRootWrapper from './test-harness/section-root-wrapper.svelte';

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

describe('global-search-section truncation rendering (state-machine)', () => {
  // Produce a fresh mock per test case — do NOT share one vi.fn() across all
  // cases (common gotcha: the mock accumulates calls from earlier iterations
  // and inter-test assertions bleed through).
  const cases = (['idle', 'loading', 'ok', 'error'] as const).flatMap((status) =>
    [true, false].flatMap((truncated) =>
      [{ kind: 'no-handler' }, { kind: 'handler' }].map((seeAllKind) => ({ status, truncated, seeAllKind })),
    ),
  );

  it.each(cases)(
    'status=$status truncated=$truncated onSeeAll=$seeAllKind.kind',
    ({ status, truncated, seeAllKind }) => {
      const onSeeAll = seeAllKind.kind === 'handler' ? vi.fn() : undefined;
      const mockStatus =
        status === 'ok'
          ? ({ status: 'ok', items: [{ id: '1' }], total: truncated ? 8 : 1 } as const)
          : status === 'error'
            ? ({ status: 'error', message: 'boom' } as const)
            : ({ status } as const);
      const { container } = render(SectionRootWrapper, {
        props: {
          heading: 'Albums',
          status: mockStatus,
          idPrefix: 'album' as const,
          renderRow: createRawSnippet(() => ({ render: () => '<span></span>' })),
          onActivate: () => {},
          onSeeAll,
        },
      });

      const shouldRenderChip = status === 'ok' && truncated && !onSeeAll;
      const chip = container.querySelector('[data-testid="more-chip"]');
      expect(Boolean(chip)).toBe(shouldRenderChip);

      const heading = container.querySelector('[data-testid="section-heading"]');
      if (shouldRenderChip) {
        expect(heading?.textContent).toMatch(/\(1 of 8\)/);
      } else if (heading) {
        // When the heading is rendered (status='ok' without truncation, or status='error'),
        // it must NOT include a "(M of N)" suffix.
        expect(heading.textContent).not.toMatch(/\(/);
      }
      // idle/loading/empty statuses render no heading at all — that's covered by the
      // empty-state describe block above. Here we only gate on "when heading exists,
      // it must be clean".
    },
  );

  it('chip element has no role="option" and is aria-hidden', () => {
    const { container } = render(SectionRootWrapper, {
      props: {
        heading: 'Albums',
        status: { status: 'ok', items: [{ id: '1' }], total: 8 },
        idPrefix: 'album' as const,
        renderRow: createRawSnippet(() => ({ render: () => '<span></span>' })),
        onActivate: () => {},
      },
    });
    const chip = container.querySelector('[data-testid="more-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('role')).not.toBe('option');
    expect(chip?.getAttribute('aria-hidden')).toBe('true');
  });
});
