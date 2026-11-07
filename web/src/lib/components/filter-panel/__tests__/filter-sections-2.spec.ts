import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import type { TagOption } from '../filter-panel';
import MediaTypeFilter from '../media-type-filter.svelte';
import RatingFilter from '../rating-filter.svelte';
import TagsFilter from '../tags-filter.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

const mockTags: TagOption[] = [
  { id: 't1', name: 'Vacation' },
  { id: 't2', name: 'Family' },
  { id: 't3', name: 'Nature' },
  { id: 't4', name: 'Work' },
];

describe('TagsFilter', () => {
  it('should render tags with checkboxes (multi-select)', async () => {
    const { getByTestId } = await render(TagsFilter, {
      props: {
        tags: mockTags.slice(0, 3),
        selectedIds: [],
        onSelectionChange: () => {},
      },
    });

    expect(getByTestId('tags-item-t1').element()).toBeTruthy();
    expect(getByTestId('tags-item-t2').element()).toBeTruthy();
    expect(getByTestId('tags-item-t3').element()).toBeTruthy();
  });

  it('should show all user tags (not space-scoped)', async () => {
    let selected: string[] = [];
    const onSelectionChange = (ids: string[]) => {
      selected = ids;
    };

    const { getByTestId, rerender } = await render(TagsFilter, {
      props: {
        tags: mockTags,
        selectedIds: [],
        onSelectionChange,
      },
    });

    // All 4 tags should be visible
    expect(getByTestId('tags-item-t1').element()).toBeTruthy();
    expect(getByTestId('tags-item-t2').element()).toBeTruthy();
    expect(getByTestId('tags-item-t3').element()).toBeTruthy();
    expect(getByTestId('tags-item-t4').element()).toBeTruthy();

    // Select first tag
    await userEvent.click(getByTestId('tags-item-t1'));
    expect(selected).toEqual(['t1']);

    // Rerender with new selectedIds, select second tag
    await rerender({
      tags: mockTags,
      selectedIds: ['t1'],
      onSelectionChange,
    });

    await userEvent.click(getByTestId('tags-item-t2'));
    expect(selected).toEqual(['t1', 't2']);
  });

  it('should show empty message when no tags', async () => {
    const { getByTestId } = await render(TagsFilter, {
      props: {
        tags: [],
        selectedIds: [],
        onSelectionChange: () => {},
      },
    });

    expect(getByTestId('tags-empty').element().textContent).toBe('No tags available');
  });
});

describe('RatingFilter', () => {
  it('should highlight stars up to selected rating', async () => {
    const { getByTestId } = await render(RatingFilter, {
      props: {
        selectedRating: 3,
        onRatingChange: () => {},
      },
    });

    // Stars 1-3 should be filled (amber), stars 4-5 should be unfilled
    for (const star of [1, 2, 3]) {
      const starButton = getByTestId(`rating-star-${star}`).element();
      const icon = starButton.querySelector('[class*="text-amber-400"]');
      expect(icon).toBeTruthy();
    }

    for (const star of [4, 5]) {
      const starButton = getByTestId(`rating-star-${star}`).element();
      const icon = starButton.querySelector('[class*="text-gray-300"]');
      expect(icon).toBeTruthy();
    }
  });

  it('should clear rating when same star clicked again', async () => {
    let rating: number | undefined = 3;
    const onRatingChange = (r?: number) => {
      rating = r;
    };

    const { getByTestId } = await render(RatingFilter, {
      props: {
        selectedRating: 3,
        onRatingChange,
      },
    });

    // Click the same star (3) to clear
    await userEvent.click(getByTestId('rating-star-3'));
    expect(rating).toBeUndefined();
  });

  it('should set rating when a star is clicked', async () => {
    let rating: number | undefined;
    const onRatingChange = (r?: number) => {
      rating = r;
    };

    const { getByTestId } = await render(RatingFilter, {
      props: {
        selectedRating: undefined,
        onRatingChange,
      },
    });

    await userEvent.click(getByTestId('rating-star-4'));
    expect(rating).toBe(4);
  });
});

describe('MediaTypeFilter', () => {
  it('should default to All', async () => {
    const { getByTestId } = await render(MediaTypeFilter, {
      props: {
        selected: 'all',
        onTypeChange: () => {},
      },
    });

    const allButton = getByTestId('media-type-all').element();
    expect(allButton.className).toContain('border-immich-primary');
    expect(allButton.className).toContain('bg-immich-primary/10');
  });

  it('should toggle between All, Photos, Videos', async () => {
    let selected: 'all' | 'image' | 'video' = 'all';
    const onTypeChange = (type: 'all' | 'image' | 'video') => {
      selected = type;
    };

    const { getByTestId } = await render(MediaTypeFilter, {
      props: {
        selected: 'all',
        onTypeChange,
      },
    });

    // Click Photos
    await userEvent.click(getByTestId('media-type-image'));
    expect(selected).toBe('image');

    // Click Videos
    await userEvent.click(getByTestId('media-type-video'));
    expect(selected).toBe('video');

    // Click All
    await userEvent.click(getByTestId('media-type-all'));
    expect(selected).toBe('all');
  });
});
