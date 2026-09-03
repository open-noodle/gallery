import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import FaceTileOverlay from '$lib/components/face-cleanup/FaceTileOverlay.svelte';
import StopPropagationHost from '$lib/components/face-cleanup/FaceTileOverlay.stopPropagation.host.svelte';

describe('FaceTileOverlay', () => {
  it('renders a month-and-year pill — the cheapest signal that separates two similar children', () => {
    render(FaceTileOverlay, { localDateTime: '2019-07-04T10:30:00.000Z', onOpen: vi.fn() });

    expect(screen.getByTestId('face-tile-date')).toHaveTextContent('2019');
  });

  it('omits the pill for an unparseable date rather than rendering "Invalid DateTime"', () => {
    render(FaceTileOverlay, { localDateTime: 'not-a-date', onOpen: vi.fn() });

    expect(screen.queryByTestId('face-tile-date')).not.toBeInTheDocument();
    expect(screen.getByTestId('face-tile-view-photo')).toBeInTheDocument(); // positive control
  });

  it('calls onOpen and stops the click from reaching the tile beneath', async () => {
    // Uses StopPropagationHost rather than a raw `container.addEventListener` — see that file for why a
    // listener added directly to the render container cannot observe `stopPropagation()` under Svelte 5's
    // event delegation (it lands on the SAME node as Svelte's own delegated listener, and stopPropagation
    // never suppresses a later listener on the same node). The host renders a genuine ANCESTOR element so this
    // test actually exercises the propagation-stopping the component relies on.
    const onOpen = vi.fn();
    const onAncestorClick = vi.fn();
    render(StopPropagationHost, { localDateTime: '2019-07-04T10:30:00.000Z', onOpen, onAncestorClick });

    await fireEvent.click(screen.getByTestId('face-tile-view-photo'));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onAncestorClick).not.toHaveBeenCalled();

    // Positive control: the ancestor probe must actually respond to a real, unstopped click, or its absence
    // above would be meaningless.
    await fireEvent.click(screen.getByTestId('ancestor'));
    expect(onAncestorClick).toHaveBeenCalledOnce();
  });

  it('labels the magnifier for screen readers', () => {
    render(FaceTileOverlay, { localDateTime: '2019-07-04T10:30:00.000Z', onOpen: vi.fn() });

    expect(screen.getByTestId('face-tile-view-photo')).toHaveAccessibleName('admin.face_cleanup_view_photo');
  });
});
