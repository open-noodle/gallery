import '@testing-library/jest-dom';
import { screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { renderWithTooltips } from '$tests/helpers';
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
    renderGrid({
      candidates: [candidate({ id: 'sp-1', name: 'Bob' }), candidate({ id: 'sp-2', name: 'Carol' })],
      onSelect,
    });

    await userEvent.click(screen.getByRole('button', { name: /Carol/ }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'sp-2', name: 'Carol' }));
  });

  // This grid backs both pickers, and a real library puts hundreds of people in it. Eager
  // thumbnails there are hundreds of requests fired the moment the picker opens -- over HTTP/1.1
  // (a plain-HTTP tailnet instance, say) they saturate the six-connection pool, so the PUT the
  // next tap issues queues behind them and the tap reads as having done nothing.
  it('loads the candidate thumbnails lazily', async () => {
    renderGrid({ candidates: [candidate({ id: 'sp-1', name: 'Bob' }), candidate({ id: 'sp-2', name: 'Carol' })] });

    // The card carries the name on both the image and its caption, so pick the image out by tag.
    const thumbnailFor = async (name: string) =>
      (await screen.findAllByTitle(name)).find((element) => element.tagName === 'IMG');

    expect(await thumbnailFor('Bob')).toHaveAttribute('loading', 'lazy');
    expect(await thumbnailFor('Carol')).toHaveAttribute('loading', 'lazy');
  });

  it('shows the empty label when nothing matches', () => {
    renderGrid({ candidates: [], emptyLabel: 'no_people_found' });

    expect(screen.getByText('no_people_found')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows a spinner instead of the empty label while the candidates load', () => {
    renderGrid({ candidates: [], isLoading: true });

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('no_people_found')).not.toBeInTheDocument();
  });
});
