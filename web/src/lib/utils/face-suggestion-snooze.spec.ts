import {
  SUGGESTION_SNOOZE_MS,
  isSuggestionSnoozed,
  snoozeSuggestions,
} from '$lib/utils/face-suggestion-snooze';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('face-suggestion-snooze', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it('is not snoozed when nothing is stored', () => {
    expect(isSuggestionSnoozed('p1', 3)).toBe(false);
  });

  it('snoozes a person at a given count and hides until the count grows', () => {
    snoozeSuggestions('p1', 3);
    expect(isSuggestionSnoozed('p1', 3)).toBe(true);
    expect(isSuggestionSnoozed('p1', 3)).toBe(true);
    // more suggestions than at snooze time → resurface
    expect(isSuggestionSnoozed('p1', 4)).toBe(false);
  });

  it('a fewer/equal count stays snoozed; other people are unaffected', () => {
    snoozeSuggestions('p1', 5);
    expect(isSuggestionSnoozed('p1', 2)).toBe(true);
    expect(isSuggestionSnoozed('p2', 1)).toBe(false);
  });

  it('expires after SUGGESTION_SNOOZE_MS', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T00:00:00Z'));
    snoozeSuggestions('p1', 3);
    expect(isSuggestionSnoozed('p1', 3)).toBe(true);

    vi.setSystemTime(new Date(Date.now() + SUGGESTION_SNOOZE_MS + 1000));
    expect(isSuggestionSnoozed('p1', 3)).toBe(false);
  });

  it('survives corrupt JSON without throwing', () => {
    localStorage.setItem('gallery-face-suggestion-snooze', '{not json');
    expect(isSuggestionSnoozed('p1', 1)).toBe(false);
    expect(() => snoozeSuggestions('p1', 1)).not.toThrow();
  });
});
