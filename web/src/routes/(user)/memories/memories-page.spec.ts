import { MemoryType, type MemoryResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import MemoriesPage from './+page.svelte';

// Fork delta guard. Upstream's memory card renders the title only, but the fork's rule engine
// emits a subtitle alongside it (`mapMemory` -> `getMemoryDisplay`; the recent-trip rule's
// "12 photos over 3 days"). Dropping the subtitle from the card orphans both
// `getMemorySubtitle` and the `recent_trip_subtitle` i18n key, with nothing else failing.
const { mockMemoryManager, mockUserPreferencesManager } = vi.hoisted(() => ({
  mockMemoryManager: {
    memories: [] as MemoryResponseDto[],
    total: 0 as number | undefined,
    loading: undefined as Promise<void> | undefined,
    applyPreferences: vi.fn(),
  },
  mockUserPreferencesManager: {
    hasMemoryPreferences: () => false,
    memories: { onlyFavorites: false, showUpcoming: true },
  },
}));

vi.mock('$lib/managers/memory-manager.svelte', () => ({ memoryManager: mockMemoryManager }));
vi.mock('$lib/managers/user-preferences-manager.svelte', () => ({
  userPreferencesManager: mockUserPreferencesManager,
}));

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

function memory(overrides: Partial<MemoryResponseDto> = {}): MemoryResponseDto {
  return {
    id: 'memory-1',
    ownerId: 'user-1',
    assets: [assetFactory.build({ id: 'asset-1' })],
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    deletedAt: undefined,
    type: MemoryType.OnThisDay,
    data: { year: 2015 },
    isSaved: false,
    memoryAt: '2020-01-01T00:00:00.000Z',
    seenAt: undefined,
    showAt: '2020-01-01T00:00:00.000Z',
    hideAt: undefined,
    ...overrides,
  };
}

function renderPage(memories: MemoryResponseDto[]) {
  mockMemoryManager.memories = memories;
  mockMemoryManager.total = memories.length;

  const props = { data: { meta: { title: 'Memories' } } };
  return render(TestWrapper as Component<{ component: typeof MemoriesPage; componentProps: typeof props }>, {
    component: MemoriesPage,
    componentProps: props,
  });
}

describe('Memories page', () => {
  it('renders the rule-aware subtitle the server sends with a memory', () => {
    renderPage([memory({ type: MemoryType.Rule, subtitle: 'Coastal weekend', title: 'Recent trip to Lisbon' })]);

    expect(screen.getByText('Recent trip to Lisbon')).toBeInTheDocument();
    expect(screen.getByText('Coastal weekend')).toBeInTheDocument();
  });

  it('derives the recent-trip subtitle from the rule context when the server sends none', () => {
    renderPage([
      memory({
        type: MemoryType.Rule,
        data: { ruleId: 'recent_trip', context: { placeLabel: 'Lisbon, Portugal', assetCount: 12, dayCount: 3 } },
      }),
    ]);

    // svelte-i18n is initialised without messages in tests, so `$t` echoes the key back. The
    // point of the assertion is that the recent-trip branch of `getMemorySubtitle` is reached
    // and rendered at all — it renders nothing when the fork delta is dropped.
    expect(screen.getByText('recent_trip_subtitle')).toBeInTheDocument();
  });

  it('renders no subtitle line for a memory that has none', () => {
    const { container } = renderPage([memory({ title: 'Years ago' })]);

    expect(screen.getByText('Years ago')).toBeInTheDocument();
    expect(container.querySelectorAll(':scope .item-card p')).toHaveLength(1);
  });
});
