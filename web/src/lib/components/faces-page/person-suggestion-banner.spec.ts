import type { PersonFaceSuggestionResponseDto, PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PersonSuggestionBanner from '$lib/components/faces-page/person-suggestion-banner.svelte';
import { snoozeSuggestions } from '$lib/utils/face-suggestion-snooze';

vi.mock('svelte-i18n', () => ({
  t: { subscribe: (run: (f: (k: string) => string) => void) => (run((k) => k), () => {}) },
}));

// Snooze is keyed per signed-in user (D17) — the banner drives isSuggestionSnoozed/snoozeSuggestions through
// a real (unmocked) face-suggestion-snooze module, which needs a stable authenticated user to key against.
vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { authenticated: true, user: { id: 'test-user' } },
}));

const person = { id: 'p1', name: 'Alice', isHidden: false, type: 'person' } as PersonResponseDto;
const REF = '/api/people/p1/thumbnail?updatedAt=x'; // what getPeopleThumbnailUrl(person) returns

function previews(n: number): PersonFaceSuggestionResponseDto[] {
  return Array.from({ length: n }, (_, i) => ({
    assetFaceId: `f${i}`,
    assetId: `a${i}`,
    distance: 0.6,
    imageWidth: 100,
    imageHeight: 100,
    boundingBoxX1: 10,
    boundingBoxX2: 40,
    boundingBoxY1: 10,
    boundingBoxY2: 40,
  }));
}

const base = (over: Record<string, unknown> = {}) => ({
  person,
  snoozeId: person.id,
  total: 3,
  previews: previews(3),
  referenceThumbnailUrl: REF,
  onReview: vi.fn(),
  ...over,
});

describe('PersonSuggestionBanner', () => {
  beforeEach(() => localStorage.clear());
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

  it('renders nothing when total is 0', () => {
    render(PersonSuggestionBanner, { props: base({ total: 0, previews: [] }) });
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
  });

  it('shows the count and at most 5 preview crops when total > 0', () => {
    render(PersonSuggestionBanner, { props: base({ total: 9, previews: previews(8) }) });
    expect(screen.getByTestId('person-suggestion-banner')).toBeInTheDocument();
    expect(screen.getAllByTestId('face-crop')).toHaveLength(5);
  });

  it('renders the reference avatar from the passed-in person-thumbnail URL, NOT an asset URL (regression)', () => {
    render(PersonSuggestionBanner, { props: base() });
    const ref = screen.getByTestId('suggestion-banner-reference') as HTMLImageElement;
    expect(ref.getAttribute('src')).toBe(REF);
    expect(ref.getAttribute('src')).not.toContain('/assets/');
  });

  it('Review fires onReview', async () => {
    const onReview = vi.fn();
    render(PersonSuggestionBanner, { props: base({ onReview }) });
    await userEvent.click(screen.getByTestId('suggestion-review-btn'));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it('Not now snoozes and hides the banner', async () => {
    render(PersonSuggestionBanner, { props: base() });
    await userEvent.click(screen.getByTestId('suggestion-snooze-btn'));
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
  });

  it('stays hidden while snoozed at the same count but reappears when the count grows', () => {
    snoozeSuggestions('p1', 3);
    const { unmount } = render(PersonSuggestionBanner, { props: base() });
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
    unmount();
    render(PersonSuggestionBanner, { props: base({ total: 5, previews: previews(5) }) });
    expect(screen.getByTestId('person-suggestion-banner')).toBeInTheDocument();
  });

  // S12.5/F32a (snooze keying): the banner must key snooze on the caller-supplied `snoozeId`, never on
  // `person.id` directly. The two happen to coincide in most fixtures (including `base()` above, which is
  // the positive control every other test in this file relies on), so this test deliberately makes them
  // DIFFER — proving the banner reads the explicit prop, not `person.id` — the exact drift the two routes
  // (space vs global) must not reintroduce by deriving the key themselves instead of being told it.
  it('keys snooze on the snoozeId prop, not on person.id, when the two differ', async () => {
    render(PersonSuggestionBanner, { props: base({ snoozeId: 'suggestion-target-id' }) });
    await userEvent.click(screen.getByTestId('suggestion-snooze-btn'));
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();

    // Snoozed under 'suggestion-target-id' (the prop), so a banner for the SAME person.id but a DIFFERENT
    // snoozeId must still show — the person's own id was never the key.
    render(PersonSuggestionBanner, { props: base({ snoozeId: 'other-target-id' }) });
    expect(screen.getByTestId('person-suggestion-banner')).toBeInTheDocument();
  });
});
