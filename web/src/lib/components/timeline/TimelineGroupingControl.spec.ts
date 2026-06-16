import { fireEvent, render, screen } from '@testing-library/svelte';

import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
import TimelineGroupingControl from './TimelineGroupingControl.svelte';

describe('TimelineGroupingControl', () => {
  it('renders Years, Months, and All with the active mode pressed', () => {
    render(TimelineGroupingControl, {
      props: {
        grouping: 'month',
        onGroupingChange: () => {},
      },
    });

    expect(screen.getByTestId('timeline-grouping-control')).toHaveAttribute('data-variant', 'inline');
    expect(screen.getByTestId('timeline-grouping-year')).toHaveTextContent('timeline_grouping_years');
    expect(screen.getByTestId('timeline-grouping-month')).toHaveTextContent('timeline_grouping_months');
    expect(screen.getByTestId('timeline-grouping-day')).toHaveTextContent('timeline_grouping_all');
    expect(screen.getByRole('group', { name: 'timeline_grouping_selector' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'timeline_grouping_all' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('timeline-grouping-year')).toHaveAttribute('aria-pressed', 'false');
  });

  it('emits a grouping change when a different mode is clicked', async () => {
    const changes: TimelineGrouping[] = [];
    render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

    expect(changes).toEqual(['year']);
  });

  it('keeps the internal day grouping value when the All button is selected', async () => {
    const changes: TimelineGrouping[] = [];
    render(TimelineGroupingControl, {
      props: {
        grouping: 'month',
        onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'timeline_grouping_all' }));

    expect(screen.getByTestId('timeline-grouping-day')).toHaveTextContent('timeline_grouping_all');
    expect(changes).toEqual(['day']);
  });

  it('does not emit when clicking the already active mode', async () => {
    const changes: TimelineGrouping[] = [];
    render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-grouping-day'));

    expect(changes).toEqual([]);
  });

  it('supports arrow-key navigation between modes', async () => {
    const changes: TimelineGrouping[] = [];
    const { rerender } = render(TimelineGroupingControl, {
      props: {
        grouping: 'month',
        onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
      },
    });

    const focusedButton = screen.getByTestId('timeline-grouping-month');
    focusedButton.focus();
    await fireEvent.keyDown(focusedButton, { key: 'ArrowRight' });

    await rerender({
      grouping: 'day',
      onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
    });
    await fireEvent.keyDown(focusedButton, { key: 'ArrowRight' });

    expect(changes).toEqual(['day', 'year']);
  });

  it('supports reverse arrow-key navigation after controlled grouping changes', async () => {
    const changes: TimelineGrouping[] = [];
    const { rerender } = render(TimelineGroupingControl, {
      props: {
        grouping: 'month',
        onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
      },
    });

    const focusedButton = screen.getByTestId('timeline-grouping-month');
    focusedButton.focus();
    await fireEvent.keyDown(focusedButton, { key: 'ArrowLeft' });

    await rerender({
      grouping: 'year',
      onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
    });
    await fireEvent.keyDown(focusedButton, { key: 'ArrowLeft' });

    expect(changes).toEqual(['year', 'day']);
  });

  it('wraps arrow-key navigation at the start and end of the modes', async () => {
    const changes: TimelineGrouping[] = [];
    const { rerender } = render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
      },
    });

    await fireEvent.keyDown(screen.getByTestId('timeline-grouping-day'), { key: 'ArrowRight' });

    await rerender({
      grouping: 'year',
      onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
    });
    await fireEvent.keyDown(screen.getByTestId('timeline-grouping-year'), { key: 'ArrowLeft' });

    expect(changes).toEqual(['year', 'day']);
  });

  it('disables all mode buttons without emitting changes', async () => {
    const changes: TimelineGrouping[] = [];
    render(TimelineGroupingControl, {
      props: {
        grouping: 'day',
        disabled: true,
        onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

    expect(screen.getByTestId('timeline-grouping-year')).toBeDisabled();
    expect(screen.getByTestId('timeline-grouping-month')).toBeDisabled();
    expect(screen.getByTestId('timeline-grouping-day')).toBeDisabled();
    expect(changes).toEqual([]);
  });

  it('marks the floating variant for mobile placement styling', () => {
    render(TimelineGroupingControl, {
      props: {
        grouping: 'year',
        variant: 'floating',
        onGroupingChange: () => {},
      },
    });

    expect(screen.getByTestId('timeline-grouping-control')).toHaveAttribute('data-variant', 'floating');
  });
});
