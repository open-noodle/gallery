// AlbumHideFromMyTimelineConfirmModal.spec.ts — #1041 follow-up.
//
// The bug this guards is the one the #1041 reporter actually hit. Their photos reached the space
// through a linked external library AND through an album. Hiding the album changed nothing —
// correct under §3 ("any visible path wins") — but the dialog said "This removes 0 photos. Only
// your timeline changes." and offered no reason. The space-level dialog already had the retained
// sentence; this one did not.
//
// Its reason differs from the space dialog's: there the photos survive via ANOTHER SPACE, here via
// another path into the SAME space — so it gets its own string, not a reused one.
//
// `$t` is not initialised in these specs, so it returns the KEY, which makes "is the retained
// sentence part of the prompt?" a clean assertion.
import { render } from '@testing-library/svelte';
import '$lib/__mocks__/sdk.mock';
import AlbumHideFromMyTimelineConfirmModal from './AlbumHideFromMyTimelineConfirmModal.svelte';

const RETAINED_KEY = 'space_albums_hide_from_my_timeline_confirm_retained';
const PROMPT_KEY = 'space_albums_hide_from_my_timeline_confirm_prompt';

const renderModal = (props: { count: number; retainedCount?: number }) =>
  render(AlbumHideFromMyTimelineConfirmModal, {
    albumName: 'Iceland 2019',
    onClose: () => {},
    ...props,
  });

const renderedText = () => document.body.textContent ?? '';

describe('AlbumHideFromMyTimelineConfirmModal', () => {
  it('appends the retained sentence when another path into the space keeps photos on the timeline', () => {
    renderModal({ count: 0, retainedCount: 412 });

    expect(renderedText()).toContain(PROMPT_KEY);
    expect(renderedText()).toContain(RETAINED_KEY);
  });

  it('omits the retained sentence when nothing is rescued', () => {
    renderModal({ count: 3, retainedCount: 0 });

    expect(renderedText()).toContain(PROMPT_KEY);
    expect(renderedText()).not.toContain(RETAINED_KEY);
  });

  it('omits the retained sentence when the server did not send a count', () => {
    renderModal({ count: 3 });

    expect(renderedText()).not.toContain(RETAINED_KEY);
  });
});
