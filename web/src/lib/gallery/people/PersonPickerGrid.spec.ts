import { renderWithTooltips } from '#test/unit/helpers.ts';
import { expect } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import PersonPickerGrid from './PersonPickerGrid.svelte';

// Structural copy of `PickerCandidate`: the type lives in the component's module script, which
// `tsc` cannot reach from a .ts spec through the ambient `*.svelte` declaration.
type PickerCandidate = { id: string; name: string; isHidden?: boolean; thumbnailUrl: string; title?: string };

const candidate = (overrides: Partial<PickerCandidate> = {}): PickerCandidate => ({
  id: 'sp-1',
  name: 'Bob',
  thumbnailUrl: '/api/people/sp-1/thumbnail',
  ...overrides,
});

const renderGrid = (props: {
  candidates?: PickerCandidate[];
  isLoading?: boolean;
  emptyLabel?: string;
  onSelect?: (candidate: PickerCandidate) => void;
}) =>
  renderWithTooltips(PersonPickerGrid, {
    candidates: props.candidates ?? [candidate()],
    isLoading: props.isLoading ?? false,
    emptyLabel: props.emptyLabel ?? 'no_people_found',
    onSelect: props.onSelect ?? vi.fn(),
  });

describe('PersonPickerGrid', () => {
  it('hands the clicked candidate back to the caller', async () => {
    const onSelect = vi.fn();
    await renderGrid({
      candidates: [candidate({ id: 'sp-1', name: 'Bob' }), candidate({ id: 'sp-2', name: 'Carol' })],
      onSelect,
    });

    await userEvent.click(page.getByRole('button', { name: /Carol/ }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'sp-2', name: 'Carol' }));
  });

  // This grid backs both pickers, and a real library puts hundreds of people in it. Eager
  // thumbnails there are hundreds of requests fired the moment the picker opens -- over HTTP/1.1
  // (a plain-HTTP tailnet instance, say) they saturate the six-connection pool, so the PUT the
  // next tap issues queues behind them and the tap reads as having done nothing.
  it('loads the candidate thumbnails lazily', async () => {
    await renderGrid({
      candidates: [candidate({ id: 'sp-1', name: 'Bob' }), candidate({ id: 'sp-2', name: 'Carol' })],
    });

    // The card carries the name on both the image and its caption, so pick the image out by tag.
    const thumbnailFor = async (name: string) => {
      await expect.element(page.getByTitle(name).first()).toBeInTheDocument();
      const image = page
        .getByTitle(name)
        .elements()
        .find((element) => element.tagName === 'IMG');
      expect(image).toBeDefined();
      return image!;
    };

    await expect.element(page.elementLocator(await thumbnailFor('Bob'))).toHaveAttribute('loading', 'lazy');
    await expect.element(page.elementLocator(await thumbnailFor('Carol'))).toHaveAttribute('loading', 'lazy');
  });

  it('shows the empty label when nothing matches', async () => {
    await renderGrid({ candidates: [], emptyLabel: 'no_people_found' });

    await expect.element(page.getByText('no_people_found')).toBeInTheDocument();
    expect(page.getByRole('button').elements()).toHaveLength(0);
  });

  it('shows a spinner instead of the empty label while the candidates load', async () => {
    await renderGrid({ candidates: [], isLoading: true });

    await expect.element(page.getByTestId('loading-spinner')).toBeInTheDocument();
    await expect.element(page.getByText('no_people_found')).not.toBeInTheDocument();
  });
});
