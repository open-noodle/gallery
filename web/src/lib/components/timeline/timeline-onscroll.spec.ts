import { describe, expect, it } from 'vitest';
import source from './Timeline.svelte?raw';

// Lightweight structural test: the Timeline must expose an `onScroll` prop and
// invoke it from its scroll handler. A full virtualized render is impractical in
// a unit test, so we assert the wiring is present in source. The real scroll→collapse
// behavior is covered by the Photos e2e (Task 13).

describe('Timeline onScroll prop', () => {
  it('declares an optional onScroll prop', () => {
    expect(source).toMatch(/onScroll\?:\s*\(scrollTop:\s*number\)\s*=>\s*void/);
  });

  it('invokes onScroll from the scroll handler with the scroller scrollTop', () => {
    expect(source).toMatch(/onScroll\?\.\(\s*scrollableElement[?.]*\.scrollTop[^)]*\)/);
  });
});
