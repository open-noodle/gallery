import type { SharedSpaceActivityResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import ActivityPage from './+page.svelte';

const { handleErrorMock } = vi.hoisted(() => ({ handleErrorMock: vi.fn() }));

vi.mock('$lib/utils/handle-error', () => ({ handleError: handleErrorMock }));

const space = (o: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto =>
  ({ id: 's1', name: 'Trip', color: 'primary', ...o }) as never;
const activity = (o: Partial<SharedSpaceActivityResponseDto> = {}): SharedSpaceActivityResponseDto =>
  ({ id: 'a1', type: 'asset_add', createdAt: '2024-01-01T00:00:00.000Z', data: { count: 1 }, ...o }) as never;

type PageProps = {
  data: {
    space: SharedSpaceResponseDto;
    activities: SharedSpaceActivityResponseDto[];
    hasMoreActivities: boolean;
  };
};

function renderPage(
  options: {
    activities?: SharedSpaceActivityResponseDto[];
    hasMoreActivities?: boolean;
  } = {},
) {
  const props: PageProps = {
    data: {
      space: space(),
      activities: options.activities ?? [],
      hasMoreActivities: options.hasMoreActivities ?? false,
    },
  };
  return render(TestWrapper as Component<{ component: typeof ActivityPage; componentProps: PageProps }>, {
    component: ActivityPage,
    componentProps: props,
  });
}

describe('Activity page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the activity feed wrapper', () => {
    renderPage({ activities: [activity()] });
    expect(screen.getByTestId('space-activity')).toBeInTheDocument();
  });

  it('renders an activity item from data.activities', () => {
    renderPage({ activities: [activity({ id: 'a1', type: 'asset_add', data: { count: 3 } })] });
    expect(screen.getByTestId('activity-item-a1')).toBeInTheDocument();
  });

  it('shows the empty state when there are no activities', () => {
    renderPage({ activities: [] });
    expect(screen.getByTestId('activity-empty-state')).toBeInTheDocument();
  });

  describe('load more activities', () => {
    it('fetches the next page at the current offset and appends the results', async () => {
      const initial = Array.from({ length: 20 }, (_, i) => activity({ id: `a${i}`, data: { count: i } }));
      sdkMock.getSpaceActivities.mockResolvedValue([activity({ id: 'a-next', type: 'space_color_change', data: {} })]);
      renderPage({ activities: initial, hasMoreActivities: true });

      await fireEvent.click(within(screen.getByTestId('load-more-button')).getByRole('button'));

      await waitFor(() => expect(sdkMock.getSpaceActivities).toHaveBeenCalledWith({ id: 's1', limit: 20, offset: 20 }));
      await waitFor(() => expect(screen.getByTestId('activity-item-a-next')).toBeInTheDocument());
    });

    // This feed grows at the head by design and pages by OFFSET over `createdAt desc`, so anything
    // anyone does in the space while it is open pushes the boundary down and page 2 re-sends a row
    // page 1 already showed. Items are keyed on the activity id, and a repeated key throws
    // `each_key_duplicate` — which aborts the render and leaves the feed frozen mid-update.
    it('renders each activity once when a new activity shifts the page boundary', async () => {
      const initial = Array.from({ length: 20 }, (_, i) => activity({ id: `a${i}`, data: { count: i } }));
      sdkMock.getSpaceActivities.mockResolvedValue([
        initial.at(-1)!,
        activity({ id: 'a-next', type: 'space_color_change', data: {} }),
      ]);
      renderPage({ activities: initial, hasMoreActivities: true });

      await fireEvent.click(within(screen.getByTestId('load-more-button')).getByRole('button'));

      await waitFor(() => expect(screen.getByTestId('activity-item-a-next')).toBeInTheDocument());
      expect(screen.getAllByTestId(/^activity-item-/)).toHaveLength(21);
    });

    it('keeps the feed and the load-more button when loading more fails', async () => {
      const initial = Array.from({ length: 20 }, (_, i) => activity({ id: `a${i}`, data: { count: i } }));
      sdkMock.getSpaceActivities.mockRejectedValueOnce(new Error('network'));
      renderPage({ activities: initial, hasMoreActivities: true });

      await fireEvent.click(within(screen.getByTestId('load-more-button')).getByRole('button'));

      await waitFor(() => expect(handleErrorMock).toHaveBeenCalled());
      expect(screen.getAllByTestId(/^activity-item-/)).toHaveLength(20);
      expect(screen.getByTestId('load-more-button')).toBeInTheDocument();
      expect(within(screen.getByTestId('load-more-button')).getByRole('button')).toBeInTheDocument();
    });
  });
});
