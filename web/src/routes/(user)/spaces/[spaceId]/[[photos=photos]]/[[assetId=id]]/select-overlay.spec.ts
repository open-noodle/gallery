import { describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';

// In select-assets / select-cover / multi-select mode the Photos page renders a ControlAppBar /
// AssetSelectControlBar. Under the shared space shell these must be pinned to the VIEWPORT top
// (position: fixed) so they don't overlap the timeline grid — mirroring the proven search-page
// pattern (`fixed inset-s-0 top-0 z-2 w-full`). This is a structural regression guard for the "Add to space" bar overlapping the photos.
const source = await commands.readFile(
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte',
);

describe('space Photos select-mode control bars', () => {
  it('pins each select-mode bar to the viewport top with a fixed overlay container', () => {
    const fixedWrappers = source.match(/class="[^"]*\bfixed\b[^"]*\btop-0\b[^"]*"/g) ?? [];
    // One wrapper each for: multi-select AssetSelectControlBar, select-assets ControlAppBar,
    // and select-cover ControlAppBar.
    expect(fixedWrappers.length).toBeGreaterThanOrEqual(3);
  });
});
