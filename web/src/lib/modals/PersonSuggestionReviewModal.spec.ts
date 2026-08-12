import type { PersonFaceSuggestionPageResponseDto, PersonResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PersonSuggestionReviewModal from '$lib/modals/PersonSuggestionReviewModal.svelte';
import { handleError } from '$lib/utils/handle-error';

vi.mock('svelte-i18n', () => ({
  t: { subscribe: (run: (f: (k: string) => string) => void) => (run((k) => k), () => {}) },
}));

vi.mock('$lib/utils/handle-error', () => ({ handleError: vi.fn() }));

vi.mock('@immich/ui', async (importOriginal: () => Promise<typeof import('@immich/ui')>) => {
  const actual = await importOriginal();
  return {
    ...actual,
    toastManager: {
      primary: vi.fn(),
      danger: vi.fn(),
    },
  };
});

// F24: the server states explicitly whether an action endpoint acted or was a no-op — see
// person.controller.ts / shared-space.controller.ts. S11b moved that signal out of the status code and into
// the response BODY (`{ acted }`, always under 200), because @oazapfts/runtime's ok() resolves to the body
// and discards the status for every success code, so a 200-vs-204 contract cannot be read by the generated
// SDK at all. The modal's confirm/dismiss/ignore props resolve to `{ acted: boolean }` on success and
// REJECT for every 4xx/5xx (including what
// used to be misread as "already resolved": a 400 is now always a genuine failure — see access.ts
// requireAccess).
const acted = (): { acted: boolean } => ({ acted: true });
const noOp = (): { acted: boolean } => ({ acted: false });
const authFailure = () => Object.assign(new Error('Not found or no access'), { status: 400 });
const serverError = () => Object.assign(new Error('Internal Server Error'), { status: 500 });

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
    confirm: overrides.confirm ?? vi.fn().mockResolvedValue(acted()),
    dismiss: overrides.dismiss ?? vi.fn().mockResolvedValue(acted()),
    ignore: overrides.ignore ?? vi.fn().mockResolvedValue(acted()),
    onClose: overrides.onClose ?? vi.fn(),
  };
  render(PersonSuggestionReviewModal, { props });
  return props;
}

describe('PersonSuggestionReviewModal', () => {
  beforeEach(() => {
    vi.mocked(handleError).mockClear();
    vi.mocked(toastManager.primary).mockClear();
  });

  // bits-ui's body-scroll-lock schedules `resetBodyStyle` on a 24ms `window.setTimeout` when a modal unmounts
  // (`body-scroll-lock.svelte.js`, the same-tick destroy/create guard). That callback touches `document.body`,
  // so if it is still pending when vitest tears the environment down it throws an UNHANDLED
  // `ReferenceError: document is not defined` — which fails the whole job even with every test passing.
  //
  // Unmounting EXPLICITLY here is the load-bearing part. @testing-library/svelte registers its auto-cleanup
  // afterEach at import time, so it runs AFTER this hook — meaning a bare sleep here waits BEFORE the unmount
  // that schedules the timer, and drains nothing. It only ever passed by winning a race, and lost that race
  // once this file's scheduling shifted. cleanup() forces the unmount first, then we outwait the 24ms.
  afterEach(async () => {
    cleanup();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('loads page 1 and shows the first candidate + reference + counter', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByTestId('suggestion-progress')).toHaveTextContent('face_suggestion_progress'),
    );
    expect(screen.getByTestId('suggestion-full-photo')).toBeInTheDocument();
    // Before the full photo has loaded (happy-dom never fires `onload` on its own — nothing here dispatches
    // it), only the placeholder renders. The REAL overlay (`suggestion-highlight`) and its computed geometry
    // are covered by the dedicated test below, once `load` is dispatched explicitly.
    expect(screen.getByTestId('suggestion-highlight-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-highlight')).not.toBeInTheDocument();
    // reference image uses getPeopleThumbnailUrl output, NOT an asset media url
    const ref = screen.getByTestId('suggestion-reference') as HTMLImageElement;
    expect(ref.getAttribute('src')).toContain('/api/people/p1/thumbnail');
  });

  it('renders the real highlight overlay (not the placeholder) with geometry computed from the loaded photo', async () => {
    setup();
    await waitFor(() => screen.getByTestId('suggestion-full-photo'));
    const img = screen.getByTestId('suggestion-full-photo') as HTMLImageElement;

    // A 1000x500 natural image rendered into a 400x300 box: scaleToFit picks the narrower-fitting axis
    // (400/1000 = 0.4 vs 300/500 = 0.6, so 0.4 wins), so the photo is horizontally full-bleed (400 wide) and
    // letterboxed top/bottom (200 tall, centered with a 50px offset on each side). happy-dom has no layout
    // engine, so both the "client" size and the "natural" size have to be stubbed explicitly — width/height
    // reflect content attributes (settable directly); naturalWidth/naturalHeight have no public setter.
    img.width = 400;
    img.height = 300;
    Object.defineProperties(img, {
      naturalWidth: { value: 1000, configurable: true },
      naturalHeight: { value: 500, configurable: true },
    });

    await fireEvent.load(img);

    await waitFor(() => expect(screen.getByTestId('suggestion-highlight')).toBeInTheDocument());
    expect(screen.queryByTestId('suggestion-highlight-placeholder')).not.toBeInTheDocument();

    // f1's box is (10,10)-(40,40) in a 100x100 metadata space, i.e. normalized 0.1..0.4 on both axes.
    // Expected pixel geometry, worked out independently of the component's own arithmetic:
    //   contentWidth = 1000 * 0.4 = 400, contentHeight = 500 * 0.4 = 200
    //   offsetX = (400 - 400) / 2 = 0,    offsetY = (300 - 200) / 2 = 50
    //   left = 0.1 * 400 + 0 = 40,   top    = 0.1 * 200 + 50 = 70
    //   width = 0.4 * 400 - 40 = 120, height = 0.4 * 200 + 50 - 70 = 60
    const overlay = screen.getByTestId('suggestion-highlight');
    expect(overlay.style.left).toBe('40px');
    expect(overlay.style.top).toBe('70px');
    expect(overlay.style.width).toBe('120px');
    expect(overlay.style.height).toBe('60px');
  });

  it('Same person calls confirm then advances; last item closes with confirmed count', async () => {
    const confirm = vi.fn().mockResolvedValue(acted());
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
    const dismiss = vi.fn().mockResolvedValue(acted());
    setup({ dismiss });
    await waitFor(() => screen.getByTestId('suggestion-different-btn'));
    await userEvent.click(screen.getByTestId('suggestion-different-btn'));
    expect(dismiss).toHaveBeenCalledWith('f1');
  });

  it('Ignore face calls ignore and advances without counting a confirmation', async () => {
    const ignore = vi.fn().mockResolvedValue(acted());
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
    const confirm = vi.fn().mockResolvedValue(acted());
    const dismiss = vi.fn().mockResolvedValue(acted());
    const ignore = vi.fn().mockResolvedValue(acted());
    setup({ confirm, dismiss, ignore });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));
    await userEvent.keyboard('{ArrowRight}'); // f1 → confirm
    expect(confirm).toHaveBeenCalledWith('f1');
    await userEvent.keyboard('{ArrowDown}'); // f2 → ignore
    expect(ignore).toHaveBeenCalledWith('f2');
  });

  it('keyboard: ArrowLeft dismisses', async () => {
    const dismiss = vi.fn().mockResolvedValue(acted());
    setup({ dismiss });
    await waitFor(() => screen.getByTestId('suggestion-different-btn'));
    await userEvent.keyboard('{ArrowLeft}'); // f1 → dismiss
    expect(dismiss).toHaveBeenCalledWith('f1');
  });

  // S11.1/F24: the modal must stop inferring "already resolved" from a status code that ALSO means "you're
  // not allowed to do this" — a 400 (or any 4xx/5xx) is now ALWAYS a genuine failure: handleError fires, the
  // face is NOT marked acted, and the modal does not advance (positive control: the same click DOES advance
  // and mark acted on a real acted() resolution — see "Same person calls confirm..." above).
  it('S11.1: confirm rejected with { status: 400 } surfaces via handleError, does not mark acted, does not advance', async () => {
    const confirm = vi.fn().mockRejectedValue(authFailure());
    const onClose = vi.fn();
    setup({ confirm, onClose });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    await userEvent.click(screen.getByTestId('suggestion-same-btn'));
    await waitFor(() => expect(handleError).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    // still on f1: not advanced, not acted (buttons stay enabled — currentActed is false)
    expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '1');
    expect(screen.getByTestId('suggestion-same-btn')).not.toBeDisabled();
    expect(screen.queryByTestId('suggestion-reviewed-badge')).not.toBeInTheDocument();
  });

  // S11.4: the same three cases (400 fails, acted:false no-op, acted:true) for dismiss and ignore.
  it('S11.4: dismiss rejected with { status: 400 } surfaces via handleError, does not mark acted, does not advance', async () => {
    const dismiss = vi.fn().mockRejectedValue(authFailure());
    const onClose = vi.fn();
    setup({ dismiss, onClose });
    await waitFor(() => screen.getByTestId('suggestion-different-btn'));

    await userEvent.click(screen.getByTestId('suggestion-different-btn'));
    await waitFor(() => expect(handleError).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '1');
    expect(screen.getByTestId('suggestion-different-btn')).not.toBeDisabled();
  });

  it('S11.4: ignore rejected with { status: 400 } surfaces via handleError, does not mark acted, does not advance', async () => {
    const ignore = vi.fn().mockRejectedValue(authFailure());
    const onClose = vi.fn();
    setup({ ignore, onClose });
    await waitFor(() => screen.getByTestId('suggestion-ignore-btn'));

    await userEvent.click(screen.getByTestId('suggestion-ignore-btn'));
    await waitFor(() => expect(handleError).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '1');
    expect(screen.getByTestId('suggestion-ignore-btn')).not.toBeDisabled();
  });

  // S11.2: an acted:false (no-op) resolution still marks the face acted and advances — but shows no toast and does not
  // increment `confirmed` (positive control: the default acted() resolution in "Same person calls confirm..."
  // above DOES increment/close with confirmed:2 via the identical click path).
  it('S11.2: confirm resolving acted:false marks acted and advances without a toast or incrementing the counter', async () => {
    const confirm = vi.fn().mockResolvedValue(noOp());
    const onClose = vi.fn();
    setup({ confirm, onClose });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f1 -> acted:false
    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f2 -> acted:false
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
    expect(handleError).not.toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();
  });

  it('S11.4: dismiss resolving acted:false marks acted and advances', async () => {
    const dismiss = vi.fn().mockResolvedValue(noOp());
    setup({ dismiss });
    await waitFor(() => screen.getByTestId('suggestion-different-btn'));
    await userEvent.click(screen.getByTestId('suggestion-different-btn'));
    await waitFor(() => expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '2'));
    expect(handleError).not.toHaveBeenCalled();
  });

  it('S11.4: ignore resolving acted:false marks acted and advances', async () => {
    const ignore = vi.fn().mockResolvedValue(noOp());
    setup({ ignore });
    await waitFor(() => screen.getByTestId('suggestion-ignore-btn'));
    await userEvent.click(screen.getByTestId('suggestion-ignore-btn'));
    await waitFor(() => expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '2'));
    expect(handleError).not.toHaveBeenCalled();
  });

  // S11.3: confirm resolving acted:true increments the counter AND shows the success toast (positive control on
  // the toast call itself — the acted:false case above asserts it is NOT called under identical conditions).
  it('S11.3: confirm resolving acted:true increments the counter and shows the success toast', async () => {
    const confirm = vi.fn().mockResolvedValue(acted());
    const onClose = vi.fn();
    setup({ confirm, onClose });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f1 -> acted:true
    await waitFor(() => expect(toastManager.primary).toHaveBeenCalledTimes(1));
    expect(toastManager.primary).toHaveBeenCalledWith('face_suggestion_confirmed_toast');

    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f2 -> acted:true
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 2 }));
    expect(toastManager.primary).toHaveBeenCalledTimes(2);
  });

  it('closes immediately with confirmed:0 when the first page is empty', async () => {
    const onClose = vi.fn();
    setup({ loadPage: vi.fn().mockResolvedValue({ total: 0, items: [] }), onClose });
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
  });

  // S11.6: reviewing the last candidate drains the queue to zero — the modal renders the all-done state
  // (positive control: it is absent while a candidate is still showing, in the same test body) and still
  // calls onClose with the final count.
  it('S11.6: the all-done state renders when the queue drains to zero', async () => {
    const confirm = vi.fn().mockResolvedValue(acted());
    const onClose = vi.fn();
    // loadPage keeps returning the single row unconditionally — the modal itself filters it out of `items`
    // once actedFaceIds has it (D8 head-refetch semantics), so the queue still drains to empty.
    const loadPage = vi.fn().mockResolvedValue({ total: 1, items: [item('f1')] });
    setup({ loadPage, confirm, onClose });

    await waitFor(() => screen.getByTestId('suggestion-same-btn'));
    // Positive control: the all-done panel is absent while a candidate is showing.
    expect(screen.queryByTestId('suggestion-all-done')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // confirms the only item, queue drains
    await waitFor(() => expect(screen.getByTestId('suggestion-all-done')).toBeInTheDocument());
    expect(screen.getByTestId('suggestion-all-done')).toHaveTextContent('face_suggestion_all_done');
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 1 }));
  });

  // D8: the server drains a face's row the moment it's acted on, so a fixed-offset "page 2" walks a moving
  // target and silently drops whatever shifted out from under it. The only stable cursor is the HEAD of the
  // list — every refetch re-reads page 1, and newly-seen rows are appended (not a wholesale replace, so the
  // buffer the user is currently stepping through never reorders or drops what they haven't acted on yet).
  it('re-fetches page 1 (not page 2) as the queue nears its end, and appends only genuinely-new rows', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({ total: 4, items: [item('f1'), item('f2'), item('f3')] })
      .mockResolvedValueOnce({ total: 4, items: [item('f1'), item('f2'), item('f3'), item('f4')] });
    setup({ loadPage });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));
    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // advance to index 1 (within PREFETCH of end)
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2));
    expect(loadPage).toHaveBeenLastCalledWith({ page: 1, size: 50 });

    // f4 was appended (not lost) even though the second response repeated f1-f3.
    await userEvent.click(screen.getByTestId('suggestion-next-btn'));
    await userEvent.click(screen.getByTestId('suggestion-next-btn'));
    expect(screen.getByTestId('suggestion-progress').dataset.current).toBe('4');
  });

  it('a top-up fetch failure once the buffer is exhausted surfaces via handleError and does NOT close', async () => {
    const confirm = vi.fn().mockResolvedValue(acted());
    const onClose = vi.fn();
    // onMount's fetch succeeds (2 items); every top-up refetch triggered by advance() thereafter rejects.
    const loadPage = vi.fn().mockResolvedValueOnce(page1).mockRejectedValue(new Error('network blip'));
    setup({ loadPage, confirm, onClose });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    // confirm f1 -> advance to f2. This also triggers a top-up (PREFETCH > buffer size) that fails, but the
    // buffer still has a valid next item (f2), so that failure is swallowed silently, same as before.
    await userEvent.click(screen.getByTestId('suggestion-same-btn'));
    await waitFor(() => expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '2'));
    expect(handleError).not.toHaveBeenCalled();

    // confirm f2 -> buffer is now exhausted; the top-up fetch fails too. Must NOT report a false "complete".
    await userEvent.click(screen.getByTestId('suggestion-same-btn'));
    await waitFor(() => expect(handleError).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    // left on the last valid item, not out-of-bounds
    expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '2');
  });

  it('shows every face exactly once across a shrinking server list and closes only on an empty fresh fetch', async () => {
    // Models the server draining acted rows: loadPage always returns the next unacted rows off a shared
    // `remaining` queue (regardless of the `page` argument — head-refetch semantics), and `confirm` drains
    // the confirmed id from that queue, same as the server would.
    const TOTAL = 120;
    let remaining = Array.from({ length: TOTAL }, (_, i) => `f${i}`);
    const confirm = vi.fn((id: string) => {
      remaining = remaining.filter((x) => x !== id);
      return Promise.resolve(acted());
    });
    const loadPage = vi.fn(({ size }: { page: number; size: number }) =>
      Promise.resolve({
        total: remaining.length,
        items: remaining.slice(0, size).map((id) => item(id)),
      }),
    );
    const onClose = vi.fn();
    setup({ loadPage, confirm, onClose });

    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    for (let i = 0; i < TOTAL; i++) {
      // D8 counter-denominator regression: the server's `total` SHRINKS as rows drain server-side while the
      // numerator (`index + 1`) walks the append-only `items` buffer and only grows. Rendering the raw
      // server `total` as the denominator lets the numerator overtake it mid-session (e.g. "74 of 73"). The
      // displayed denominator must stay >= the numerator at every step (waitFor rides out the in-flight
      // top-up refetch settling between clicks).
      await waitFor(() => {
        const progress = screen.getByTestId('suggestion-progress');
        expect(Number(progress.dataset.total)).toBeGreaterThanOrEqual(Number(progress.dataset.current));
      });
      await userEvent.click(screen.getByTestId('suggestion-same-btn'));
    }

    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: TOTAL }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const confirmedIds = confirm.mock.calls.map(([id]: [string]) => id);
    expect(confirmedIds).toHaveLength(TOTAL); // every face acted on exactly once — no repeats, none skipped
    expect(new Set(confirmedIds).size).toBe(TOTAL);
    expect(remaining).toHaveLength(0);
  });

  // S11.5 (pin): a 500 — like any 4xx/5xx now — surfaces via handleError and leaves the current face selected
  // and retryable. Mutated/reverted below (see "S11.5 pin mutation") to prove this can actually fail.
  it('S11.5 (pin): surfaces a 500 from an action via handleError, does NOT mark the row acted, and allows retry', async () => {
    const confirm = vi.fn().mockRejectedValueOnce(serverError()).mockResolvedValueOnce(acted());
    const onClose = vi.fn();
    setup({ confirm, onClose });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f1 500s
    await waitFor(() => expect(handleError).toHaveBeenCalledTimes(1));
    // still on f1: not marked acted, not advanced
    expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '1');
    expect(screen.getByTestId('suggestion-same-btn')).not.toBeDisabled(); // busy cleared — retry is possible

    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // retry succeeds
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '2'));
    expect(onClose).not.toHaveBeenCalled();
  });

  // F24: the mixed-sequence property the OLD 400-based "already resolved" test used to cover, now expressed
  // with the real signal (acted:false no-op, then a genuine acted:true) — a no-op must not inflate `confirmed`.
  it('an acted:false no-op followed by a real acted:true confirm only counts the real one', async () => {
    const confirm = vi.fn().mockResolvedValueOnce(noOp()).mockResolvedValueOnce(acted());
    const onClose = vi.fn();
    setup({ confirm, onClose });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f1 -> acted:false, advance silently
    await waitFor(() => expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '2'));
    expect(handleError).not.toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f2 -> acted:true, confirms for real
    // Only the real confirm counts — the no-op on f1 must not inflate the confirmed count.
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 1 }));
    expect(toastManager.primary).toHaveBeenCalledTimes(1);
  });

  it('marks acted rows read-only on back-navigation (no re-invocation of confirm/dismiss/ignore)', async () => {
    const confirm = vi.fn().mockResolvedValue(acted());
    setup({ confirm });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // confirm f1, advance to f2
    await waitFor(() => expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '2'));

    await userEvent.click(screen.getByTestId('suggestion-prev-btn')); // back to f1 (already acted)
    await waitFor(() => expect(screen.getByTestId('suggestion-progress')).toHaveAttribute('data-current', '1'));

    expect(screen.getByTestId('suggestion-same-btn')).toBeDisabled();
    expect(screen.getByTestId('suggestion-different-btn')).toBeDisabled();
    expect(screen.getByTestId('suggestion-ignore-btn')).toBeDisabled();
    expect(screen.getByTestId('suggestion-reviewed-badge')).toBeInTheDocument();

    // Bypass the disabled DOM attribute entirely — this exercises act()'s own internal guard, not just the
    // button's `disabled`.
    await userEvent.keyboard('{ArrowRight}');
    expect(confirm).toHaveBeenCalledTimes(1); // still just the original confirm, no re-invocation
  });

  // happy-dom has no layout engine, so this pins the STRUCTURE that makes the footer reflow, not the reflow
  // itself: the verdict buttons must be free to stack full-width below `sm` and only line up as a row from `sm`
  // up. Without it the row is a single non-wrapping line and the modal's `overflow-hidden` Card clips the
  // primary "Same person" button off-screen on a phone. The layout itself is asserted for real, at a 390px
  // viewport, in e2e/src/specs/web/person-face-suggestions.e2e-spec.ts.
  it('lets the verdict buttons stack below sm and line up from sm up', async () => {
    setup();
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    for (const testId of ['suggestion-different-btn', 'suggestion-ignore-btn', 'suggestion-same-btn']) {
      expect(screen.getByTestId(testId), testId).toHaveClass('w-full', 'sm:w-auto');
    }

    const group = screen.getByTestId('suggestion-actions');
    expect(group).toHaveClass('flex-col', 'grow');
    expect(group).toHaveClass('sm:flex-row', 'sm:grow-0');
  });
});
