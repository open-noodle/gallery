import PersonSuggestionReviewModal from '$lib/modals/PersonSuggestionReviewModal.svelte';
import type { PersonFaceSuggestionPageResponseDto, PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-i18n', () => ({
  t: { subscribe: (run: (f: (k: string) => string) => void) => (run((k) => k), () => {}) },
}));

const person = { id: 'p1', name: 'Alice', updatedAt: '2026-01-01T00:00:00.000Z' } as PersonResponseDto;

function item(id: string) {
  return {
    assetFaceId: id,
    assetId: `asset-${id}`,
    distance: 0.6,
    imageWidth: 100,
    imageHeight: 100,
    boundingBoxX1: 10,
    boundingBoxX2: 40,
    boundingBoxY1: 10,
    boundingBoxY2: 40,
  };
}
const page1: PersonFaceSuggestionPageResponseDto = { total: 2, items: [item('f1'), item('f2')] };

function setup(
  overrides: Partial<{
    loadPage: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    ignore: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const props = {
    person,
    referenceThumbnailUrl: '/api/people/p1/thumbnail',
    loadPage: overrides.loadPage ?? vi.fn().mockResolvedValue(page1),
    confirm: overrides.confirm ?? vi.fn().mockResolvedValue(undefined),
    dismiss: overrides.dismiss ?? vi.fn().mockResolvedValue(undefined),
    ignore: overrides.ignore ?? vi.fn().mockResolvedValue(undefined),
    onClose: overrides.onClose ?? vi.fn(),
  };
  render(PersonSuggestionReviewModal, { props });
  return props;
}

describe('PersonSuggestionReviewModal', () => {
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 50)); // bits-ui scroll-lock drain
  });

  it('loads page 1 and shows the first candidate + reference + counter', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByTestId('suggestion-progress')).toHaveTextContent('face_suggestion_progress'),
    );
    expect(screen.getByTestId('suggestion-full-photo')).toBeInTheDocument();
    expect(screen.getByTestId('suggestion-highlight')).toBeInTheDocument();
    // reference image uses getPeopleThumbnailUrl output, NOT an asset media url
    const ref = screen.getByTestId('suggestion-reference') as HTMLImageElement;
    expect(ref.getAttribute('src')).toContain('/api/people/p1/thumbnail');
  });

  it('Same person calls confirm then advances; last item closes with confirmed count', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    setup({ confirm, onClose });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    await userEvent.click(screen.getByTestId('suggestion-same-btn'));
    expect(confirm).toHaveBeenCalledWith('f1');
    await userEvent.click(screen.getByTestId('suggestion-same-btn'));
    expect(confirm).toHaveBeenCalledWith('f2');

    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 2 }));
  });

  it('Different person calls dismiss and advances', async () => {
    const dismiss = vi.fn().mockResolvedValue(undefined);
    setup({ dismiss });
    await waitFor(() => screen.getByTestId('suggestion-different-btn'));
    await userEvent.click(screen.getByTestId('suggestion-different-btn'));
    expect(dismiss).toHaveBeenCalledWith('f1');
  });

  it('Ignore face calls ignore and advances without counting a confirmation', async () => {
    const ignore = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    setup({ ignore, onClose });
    await waitFor(() => screen.getByTestId('suggestion-ignore-btn'));

    await userEvent.click(screen.getByTestId('suggestion-ignore-btn'));
    expect(ignore).toHaveBeenCalledWith('f1');
    await userEvent.click(screen.getByTestId('suggestion-ignore-btn'));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
  });

  it('Next then Prev step the queue WITHOUT confirm/dismiss; Prev disabled at start', async () => {
    const confirm = vi.fn();
    const dismiss = vi.fn();
    setup({ confirm, dismiss });
    await waitFor(() => screen.getByTestId('suggestion-progress'));

    // at index 0 → Prev disabled
    expect(screen.getByTestId('suggestion-prev-btn')).toBeDisabled();

    await userEvent.click(screen.getByTestId('suggestion-next-btn'));
    expect(screen.getByTestId('suggestion-progress').dataset.current).toBe('2'); // moved to 2 of 2
    await userEvent.click(screen.getByTestId('suggestion-prev-btn'));
    expect(screen.getByTestId('suggestion-progress').dataset.current).toBe('1');

    expect(confirm).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('keyboard: ArrowRight confirms, ArrowLeft dismisses, ArrowDown ignores', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const dismiss = vi.fn().mockResolvedValue(undefined);
    const ignore = vi.fn().mockResolvedValue(undefined);
    setup({ confirm, dismiss, ignore });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));
    await userEvent.keyboard('{ArrowRight}'); // f1 → confirm
    expect(confirm).toHaveBeenCalledWith('f1');
    await userEvent.keyboard('{ArrowDown}'); // f2 → ignore
    expect(ignore).toHaveBeenCalledWith('f2');
  });

  it('keyboard: ArrowLeft dismisses', async () => {
    const dismiss = vi.fn().mockResolvedValue(undefined);
    setup({ dismiss });
    await waitFor(() => screen.getByTestId('suggestion-different-btn'));
    await userEvent.keyboard('{ArrowLeft}'); // f1 → dismiss
    expect(dismiss).toHaveBeenCalledWith('f1');
  });

  it('a stale item (confirm rejects — edges 9/10/11) still advances', async () => {
    const confirm = vi.fn().mockRejectedValue(new Error('404'));
    const onClose = vi.fn();
    setup({ confirm, onClose });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));
    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f1 errors
    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f2
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
  });

  it('a stale item (dismiss rejects — edges 9/10/11) still advances (symmetry)', async () => {
    const dismiss = vi.fn().mockRejectedValue(new Error('404'));
    const onClose = vi.fn();
    setup({ dismiss, onClose });
    await waitFor(() => screen.getByTestId('suggestion-different-btn'));
    await userEvent.click(screen.getByTestId('suggestion-different-btn')); // f1 errors
    await userEvent.click(screen.getByTestId('suggestion-different-btn')); // f2
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
  });

  it('a stale item (ignore rejects — edges 9/10/11) still advances (symmetry)', async () => {
    const ignore = vi.fn().mockRejectedValue(new Error('404'));
    const onClose = vi.fn();
    setup({ ignore, onClose });
    await waitFor(() => screen.getByTestId('suggestion-ignore-btn'));
    await userEvent.click(screen.getByTestId('suggestion-ignore-btn')); // f1 errors
    await userEvent.click(screen.getByTestId('suggestion-ignore-btn')); // f2
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
  });

  it('closes immediately with confirmed:0 when the first page is empty', async () => {
    const onClose = vi.fn();
    setup({ loadPage: vi.fn().mockResolvedValue({ total: 0, items: [] }), onClose });
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
  });

  it('lazily loads the next page as the queue nears its end', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({ total: 4, items: [item('f1'), item('f2'), item('f3')] })
      .mockResolvedValueOnce({ total: 4, items: [item('f4')] });
    setup({ loadPage });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));
    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // advance to index 1 (within PREFETCH of end)
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2));
    expect(loadPage).toHaveBeenLastCalledWith({ page: 2, size: 50 });
  });
});
