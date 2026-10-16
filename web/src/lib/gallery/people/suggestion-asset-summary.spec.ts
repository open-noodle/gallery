import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { faceSuggestionContextExpanded as expanded } from '$lib/gallery/people/face-suggestion-context.store';
import SuggestionAssetSummary from '$lib/gallery/people/suggestion-asset-summary.svelte';

vi.mock('svelte-i18n', () => ({
  t: { subscribe: (run: (f: (k: string) => string) => void) => (run((k) => k), () => {}) },
  locale: { subscribe: (run: (v: string) => void) => (run('en-US'), () => {}) },
}));

const ASSET_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SPACE_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

// The open/closed preference is module-level and localStorage-backed BY DESIGN — it has to outlive both the
// candidate and the session. That makes it leak between tests, so every test states the state it starts from.
beforeEach(() => expanded.set(false));

describe('suggestion-asset-summary', () => {
  it('shows the taken date from fileCreatedAt, with no request', () => {
    render(SuggestionAssetSummary, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    expect(screen.getByTestId('suggestion-context-date')).toHaveTextContent('Aug 12, 2015');
  });

  it('omits the date row entirely when the suggestion carries no fileCreatedAt', () => {
    render(SuggestionAssetSummary, { props: { assetId: ASSET_ID } });

    expect(screen.queryByTestId('suggestion-context-date')).not.toBeInTheDocument();
  });

  it('links to the asset in a new tab, outside any space', () => {
    render(SuggestionAssetSummary, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    const link = screen.getByTestId('suggestion-context-open');
    expect(link).toHaveAttribute('href', `/photos/${ASSET_ID}`);
    // The whole point of a new tab: the review queue, its position and the append-only `items` buffer all
    // survive the trip. `noopener` because the opened tab must not get a handle on the review window.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('links into the space when the review is running inside one', () => {
    render(SuggestionAssetSummary, {
      props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z', spaceId: SPACE_ID },
    });

    // A space viewer may reach this asset ONLY through the space; /photos/{id} enforces the owner's
    // AssetView and would 403 for them.
    expect(screen.getByTestId('suggestion-context-open')).toHaveAttribute(
      'href',
      `/spaces/${SPACE_ID}/photos/${ASSET_ID}`,
    );
  });

  it('Details flips the remembered preference and reports it to assistive tech', async () => {
    render(SuggestionAssetSummary, { props: { assetId: ASSET_ID } });
    const toggle = screen.getByTestId('suggestion-context-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);

    expect(get(expanded)).toBe(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
