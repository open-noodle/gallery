import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// In select-assets / select-cover / multi-select mode the Photos page renders a ControlAppBar /
// AssetSelectControlBar. Under the shared space shell these must be pinned to the VIEWPORT top
// (position: fixed) so they don't overlap the timeline grid — mirroring the proven search-page
// pattern (`fixed inset-s-0 top-0 z-2 w-full`). jsdom has no layout engine, so this is a
// structural regression guard for the "Add to space" bar overlapping the photos.
const source = readFileSync(resolve(import.meta.dirname, './+page.svelte'), 'utf8');

describe('space Photos select-mode control bars', () => {
  it('pins each select-mode bar to the viewport top with a fixed overlay container', () => {
    const fixedWrappers = source.match(/class="[^"]*\bfixed\b[^"]*\btop-0\b[^"]*"/g) ?? [];
    // One wrapper each for: multi-select AssetSelectControlBar, select-assets ControlAppBar,
    // and select-cover ControlAppBar.
    expect(fixedWrappers.length).toBeGreaterThanOrEqual(3);
  });
});
