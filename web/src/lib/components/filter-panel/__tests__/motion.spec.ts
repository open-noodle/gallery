import { quintOut } from 'svelte/easing';
import { describe, expect, it } from 'vitest';
import { PANEL_DURATION_MS, SECTION_DURATION_MS, SETTLE_EASE, slideMotion } from '../motion';

describe('motion tokens', () => {
  it('exposes the agreed durations and settle easing', () => {
    expect(PANEL_DURATION_MS).toBe(420);
    expect(SECTION_DURATION_MS).toBe(300);
    expect(SETTLE_EASE).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
  });
});

describe('slideMotion', () => {
  it('returns an instant (zero-duration) config when reduced motion is requested', () => {
    expect(slideMotion(true)).toEqual({ duration: 0 });
  });

  it('returns the section duration and quintOut easing when motion is allowed', () => {
    const motion = slideMotion(false);
    expect(motion.duration).toBe(SECTION_DURATION_MS);
    expect(motion.easing).toBe(quintOut);
  });
});
