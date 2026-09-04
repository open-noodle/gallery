// SpaceHideFromTimelineConfirmModal.spec.ts — #1041 follow-up.
//
// The bug this guards: hiding a 58,977-photo space reported "This removes 3 photos" and nothing
// else, because the other 56,417 were rescued by a second space the caller still showed. Correct,
// but it reads as broken. The retained sentence is the missing half.
//
// `$t` is not initialised in these specs, so it returns the KEY — which is exactly what makes
// "is the retained sentence part of the prompt?" a clean assertion.
import { render } from '@testing-library/svelte';
import '$lib/__mocks__/sdk.mock';
import SpaceHideFromTimelineConfirmModal from './SpaceHideFromTimelineConfirmModal.svelte';

const RETAINED_KEY = 'spaces_hide_from_timeline_confirm_retained';
const PROMPT_KEY = 'spaces_hide_from_timeline_confirm_prompt';

const renderModal = (props: { count: number; retainedCount?: number }) =>
  render(SpaceHideFromTimelineConfirmModal, {
    spaceName: 'All photos',
    onClose: () => {},
    ...props,
  });

// The modal is a thin wrapper over ConfirmModal; reading the whole rendered subtree keeps the
// assertion about the composed prompt rather than about ConfirmModal's internal markup.
const renderedText = () => document.body.textContent ?? '';

describe('SpaceHideFromTimelineConfirmModal', () => {
  it('appends the retained sentence when another visible path keeps photos on the timeline', () => {
    renderModal({ count: 3, retainedCount: 56_417 });

    expect(renderedText()).toContain(PROMPT_KEY);
    expect(renderedText()).toContain(RETAINED_KEY);
  });

  // The half that stops the test above passing for the wrong reason: with no overlap there is
  // nothing to explain, and a dangling "0 photos stay" sentence would be worse than silence.
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
