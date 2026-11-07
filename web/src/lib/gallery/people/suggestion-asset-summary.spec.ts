import { faceSuggestionContextExpanded as expanded } from '#lib/gallery/people/face-suggestion-context.store.ts';
import SuggestionAssetSummary from '#lib/gallery/people/suggestion-asset-summary.svelte';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

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
  it('shows the taken date from fileCreatedAt, with no request', async () => {
    await render(SuggestionAssetSummary, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    await expect.element(page.getByTestId('suggestion-context-date')).toMatchTextContent('Aug 12, 2015');
  });

  it('omits the date row entirely when the suggestion carries no fileCreatedAt', async () => {
    await render(SuggestionAssetSummary, { props: { assetId: ASSET_ID } });

    await expect.element(page.getByTestId('suggestion-context-date')).not.toBeInTheDocument();
  });

  it('links to the asset in a new tab, outside any space', async () => {
    await render(SuggestionAssetSummary, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    const link = page.getByTestId('suggestion-context-open');
    await expect.element(link).toHaveAttribute('href', `/photos/${ASSET_ID}`);
    // The whole point of a new tab: the review queue, its position and the append-only `items` buffer all
    // survive the trip. `noopener` because the opened tab must not get a handle on the review window.
    await expect.element(link).toHaveAttribute('target', '_blank');
    await expect.element(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('links into the space when the review is running inside one', async () => {
    await render(SuggestionAssetSummary, {
      props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z', spaceId: SPACE_ID },
    });

    // A space viewer may reach this asset ONLY through the space; /photos/{id} enforces the owner's
    // AssetView and would 403 for them.
    await expect
      .element(page.getByTestId('suggestion-context-open'))
      .toHaveAttribute('href', `/spaces/${SPACE_ID}/photos/${ASSET_ID}`);
  });

  it('Details flips the remembered preference and reports it to assistive tech', async () => {
    await render(SuggestionAssetSummary, { props: { assetId: ASSET_ID } });
    const toggle = page.getByTestId('suggestion-context-toggle');
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);

    expect(get(expanded)).toBe(true);
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
