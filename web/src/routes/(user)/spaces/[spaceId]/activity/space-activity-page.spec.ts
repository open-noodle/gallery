import type { SharedSpaceActivityResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import ActivityPage from './+page.svelte';

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
  });
});
