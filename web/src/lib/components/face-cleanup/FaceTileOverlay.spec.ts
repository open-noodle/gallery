import FaceTileOverlay from '#lib/components/face-cleanup/FaceTileOverlay.svelte';
import StopPropagationHost from '#lib/gallery/__mocks__/face-tile-overlay-stop-propagation.host.stub.svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

describe('FaceTileOverlay', () => {
  it('renders a month-and-year pill — the cheapest signal that separates two similar children', async () => {
    await render(FaceTileOverlay, { localDateTime: '2019-07-04T10:30:00.000Z', onOpen: vi.fn() });

    await expect.element(page.getByTestId('face-tile-date')).toMatchTextContent('2019');
  });

  it('omits the pill for an unparseable date rather than rendering "Invalid DateTime"', async () => {
    await render(FaceTileOverlay, { localDateTime: 'not-a-date', onOpen: vi.fn() });

    await expect.element(page.getByTestId('face-tile-date')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('face-tile-view-photo')).toBeInTheDocument(); // positive control
  });

  it('calls onOpen and stops the click from reaching the tile beneath', async () => {
    // Uses StopPropagationHost rather than a raw `container.addEventListener` — see that file for why a
    // listener added directly to the render container cannot observe `stopPropagation()` under Svelte 5's
    // event delegation (it lands on the SAME node as Svelte's own delegated listener, and stopPropagation
    // never suppresses a later listener on the same node). The host renders a genuine ANCESTOR element so this
    // test actually exercises the propagation-stopping the component relies on.
    const onOpen = vi.fn();
    const onAncestorClick = vi.fn();
    await render(StopPropagationHost, { localDateTime: '2019-07-04T10:30:00.000Z', onOpen, onAncestorClick });

    await userEvent.click(page.getByTestId('face-tile-view-photo'));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onAncestorClick).not.toHaveBeenCalled();

    // Positive control: the ancestor probe must actually respond to a real, unstopped click, or its absence
    // above would be meaningless.
    await userEvent.click(page.getByTestId('ancestor'));
    expect(onAncestorClick).toHaveBeenCalledOnce();
  });

  it('labels the magnifier for screen readers', async () => {
    await render(FaceTileOverlay, { localDateTime: '2019-07-04T10:30:00.000Z', onOpen: vi.fn() });

    await expect
      .element(page.getByTestId('face-tile-view-photo'))
      .toHaveAccessibleName('admin.face_cleanup_view_photo');
  });
});
