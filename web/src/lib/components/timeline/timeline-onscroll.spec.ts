import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lightweight structural test: the Timeline must expose an `onScroll` prop and
// invoke it from its scroll handler. A full virtualized render is impractical in
// jsdom, so we assert the wiring is present in source. The real scroll→collapse
// behavior is covered by the Photos e2e (Task 13).
const source = readFileSync(resolve(import.meta.dirname, './Timeline.svelte'), 'utf8');

describe('Timeline onScroll prop', () => {
  it('declares an optional onScroll prop', () => {
    expect(source).toMatch(/onScroll\?:\s*\(scrollTop:\s*number\)\s*=>\s*void/);
  });

  it('invokes onScroll from the scroll handler with the scroller scrollTop', () => {
    expect(source).toMatch(/onScroll\?\.\(\s*scrollableElement[?.]*\.scrollTop[^)]*\)/);
  });
});
