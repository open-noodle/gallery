import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import RepresentativeFaceTile from './representative-face-tile.svelte';

const tile = () => page.getByRole('button', { name: 'select_representative_face' });

describe('RepresentativeFaceTile', () => {
  it('renders a selectable fixed-size face crop tile', async () => {
    const onSelect = vi.fn();
    await render(RepresentativeFaceTile, {
      faceId: 'face-1',
      thumbnailUrl: '/api/people/person-1/faces/face-1/thumbnail',
      selected: false,
      disabled: false,
      onSelect,
    });

    await expect.element(tile()).toHaveClass('aspect-square');
    await tile().click();
    expect(onSelect).toHaveBeenCalledWith('face-1');
  });

  it('marks the current representative face', async () => {
    await render(RepresentativeFaceTile, {
      faceId: 'face-1',
      thumbnailUrl: '/thumb.jpg',
      selected: true,
      disabled: false,
      onSelect: vi.fn(),
    });

    await expect.element(page.getByTestId('representative-face-selected')).toBeInTheDocument();
  });

  it('does not select while disabled', async () => {
    const onSelect = vi.fn();
    await render(RepresentativeFaceTile, {
      faceId: 'face-1',
      thumbnailUrl: '/thumb.jpg',
      selected: false,
      disabled: true,
      onSelect,
    });

    await expect.element(tile()).toBeDisabled();
    // Playwright refuses to click a disabled button; force a real pointer click at its position,
    // which the browser must not turn into a click event.
    await tile().click({ force: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a stable pending state while an update is running', async () => {
    await render(RepresentativeFaceTile, {
      faceId: 'face-1',
      thumbnailUrl: '/thumb.jpg',
      selected: false,
      disabled: false,
      pending: true,
      onSelect: vi.fn(),
    });

    await expect.element(tile()).toBeDisabled();
    await expect.element(page.getByTestId('representative-face-pending')).toHaveClass('absolute', 'inset-0');
  });

  it('keeps the tile size stable when the image fallback renders', async () => {
    await render(RepresentativeFaceTile, {
      faceId: 'face-1',
      thumbnailUrl: '/broken.jpg',
      selected: false,
      disabled: false,
      onSelect: vi.fn(),
    });

    // Images never load in the unit tier: the request 404s and the real error event renders the fallback.
    await expect.element(page.getByTestId('broken-asset')).toHaveClass('size-full');
  });
});
