import type { TimelineGrouping } from '#lib/managers/timeline-manager/types.ts';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TimelineGroupingControl from './TimelineGroupingControl.svelte';

const keyDown = (element: Element, key: string) => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

describe('TimelineGroupingControl', () => {
  it('renders Years, Months, and All with the active mode pressed', async () => {
    await render(TimelineGroupingControl, {
      props: {
        grouping: 'month',
        onGroupingChange: () => {},
      },
    });

    await expect.element(page.getByTestId('timeline-grouping-control')).toHaveAttribute('data-variant', 'inline');
    await expect.element(page.getByTestId('timeline-grouping-year')).toHaveTextContent('timeline_grouping_years');
    await expect.element(page.getByTestId('timeline-grouping-month')).toHaveTextContent('timeline_grouping_months');
    await expect.element(page.getByTestId('timeline-grouping-day')).toHaveTextContent('timeline_grouping_all');
    await expect.element(page.getByRole('group', { name: 'timeline_grouping_selector' })).toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'timeline_grouping_all' }))
      .toHaveAttribute('aria-pressed', 'false');
    await expect.element(page.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByTestId('timeline-grouping-year')).toHaveAttribute('aria-pressed', 'false');
  });

  it('emits a grouping change when a different mode is clicked', async () => {
    const changes: TimelineGrouping[] = [];
    await render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        onGroupingChange: (grouping: TimelineGrouping) => {
          changes.push(grouping);
        },
      },
    });

    await page.getByTestId('timeline-grouping-year').click();

    expect(changes).toEqual(['year']);
  });

  it('keeps the internal day grouping value when the All button is selected', async () => {
    const changes: TimelineGrouping[] = [];
    await render(TimelineGroupingControl, {
      props: {
        grouping: 'month',
        onGroupingChange: (grouping: TimelineGrouping) => {
          changes.push(grouping);
        },
      },
    });

    await page.getByRole('button', { name: 'timeline_grouping_all' }).click();

    await expect.element(page.getByTestId('timeline-grouping-day')).toHaveTextContent('timeline_grouping_all');
    expect(changes).toEqual(['day']);
  });

  it('does not emit when clicking the already active mode', async () => {
    const changes: TimelineGrouping[] = [];
    await render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        onGroupingChange: (grouping: TimelineGrouping) => {
          changes.push(grouping);
        },
      },
    });

    await page.getByTestId('timeline-grouping-day').click();

    expect(changes).toEqual([]);
  });

  it('supports arrow-key navigation between modes', async () => {
    const changes: TimelineGrouping[] = [];
    const { rerender } = await render(TimelineGroupingControl, {
      props: {
        grouping: 'month',
        onGroupingChange: (grouping: TimelineGrouping) => {
          changes.push(grouping);
        },
      },
    });

    const focusedButton = page.getByTestId('timeline-grouping-month').element() as HTMLElement;
    focusedButton.focus();
    keyDown(focusedButton, 'ArrowRight');

    await rerender({
      grouping: 'day',
      onGroupingChange: (grouping: TimelineGrouping) => {
        changes.push(grouping);
      },
    });
    keyDown(focusedButton, 'ArrowRight');

    expect(changes).toEqual(['day', 'year']);
  });

  it('supports reverse arrow-key navigation after controlled grouping changes', async () => {
    const changes: TimelineGrouping[] = [];
    const { rerender } = await render(TimelineGroupingControl, {
      props: {
        grouping: 'month',
        onGroupingChange: (grouping: TimelineGrouping) => {
          changes.push(grouping);
        },
      },
    });

    const focusedButton = page.getByTestId('timeline-grouping-month').element() as HTMLElement;
    focusedButton.focus();
    keyDown(focusedButton, 'ArrowLeft');

    await rerender({
      grouping: 'year',
      onGroupingChange: (grouping: TimelineGrouping) => {
        changes.push(grouping);
      },
    });
    keyDown(focusedButton, 'ArrowLeft');

    expect(changes).toEqual(['year', 'day']);
  });

  it('wraps arrow-key navigation at the start and end of the modes', async () => {
    const changes: TimelineGrouping[] = [];
    const { rerender } = await render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        onGroupingChange: (grouping: TimelineGrouping) => {
          changes.push(grouping);
        },
      },
    });

    keyDown(page.getByTestId('timeline-grouping-day').element(), 'ArrowRight');

    await rerender({
      grouping: 'year',
      onGroupingChange: (grouping: TimelineGrouping) => {
        changes.push(grouping);
      },
    });
    keyDown(page.getByTestId('timeline-grouping-year').element(), 'ArrowLeft');

    expect(changes).toEqual(['year', 'day']);
  });

  it('disables all mode buttons without emitting changes', async () => {
    const changes: TimelineGrouping[] = [];
    await render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        disabled: true,
        onGroupingChange: (grouping: TimelineGrouping) => {
          changes.push(grouping);
        },
      },
    });

    // A disabled button is not actionable for a real user click, so dispatch the click directly.
    page
      .getByTestId('timeline-grouping-year')
      .element()
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await expect.element(page.getByTestId('timeline-grouping-year')).toBeDisabled();
    await expect.element(page.getByTestId('timeline-grouping-month')).toBeDisabled();
    await expect.element(page.getByTestId('timeline-grouping-day')).toBeDisabled();
    expect(changes).toEqual([]);
  });

  it('marks the floating variant for mobile placement styling', async () => {
    await render(TimelineGroupingControl, {
      props: {
        grouping: 'year',
        variant: 'floating',
        onGroupingChange: () => {},
      },
    });

    await expect.element(page.getByTestId('timeline-grouping-control')).toHaveAttribute('data-variant', 'floating');
  });
});
