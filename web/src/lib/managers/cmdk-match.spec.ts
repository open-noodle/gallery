import { describe, expect, it } from 'vitest';
import { isAlmostExactWordMatch } from './cmdk-match';

describe('isAlmostExactWordMatch', () => {
  const MIN = 3;
  it('returns false for sub-MIN queries', () => {
    expect(isAlmostExactWordMatch('up', 'Upload', MIN)).toBe(false);
  });
  it('matches prefix on any word', () => {
    expect(isAlmostExactWordMatch('files', 'Upload files', MIN)).toBe(true);
  });
  it('case-insensitive + non-alnum split', () => {
    expect(isAlmostExactWordMatch('UPLOAD', 'upload-files', MIN)).toBe(true);
  });

  describe('close-prefix gate', () => {
    it('promotes a word the query spells out in full', () => {
      expect(isAlmostExactWordMatch('theme', 'Theme', MIN)).toBe(true);
    });

    it('tolerates a prefix one character short of the label word', () => {
      expect(isAlmostExactWordMatch('them', 'Theme', MIN)).toBe(true);
      expect(isAlmostExactWordMatch('album', 'Albums', MIN)).toBe(true);
      expect(isAlmostExactWordMatch('tag', 'Tags', MIN)).toBe(true);
    });

    it('rejects a prefix that leaves more than one character unspoken', () => {
      // The bug: "the" must not be treated as an attempt to type "Theme",
      // otherwise every smart search containing the word "the" is hijacked.
      expect(isAlmostExactWordMatch('the', 'Theme', MIN)).toBe(false);
      expect(isAlmostExactWordMatch('arch', 'Archive', MIN)).toBe(false);
      expect(isAlmostExactWordMatch('classif', 'Classification Settings', MIN)).toBe(false);
    });
  });

  describe('every-word gate', () => {
    it('rejects a sentence in which only one word incidentally matches', () => {
      expect(isAlmostExactWordMatch('theme park in paris', 'Theme', MIN)).toBe(false);
    });

    it('rejects a sentence colliding with a common word in a long label', () => {
      expect(isAlmostExactWordMatch('photos of the beach', 'Add photos to this space', MIN)).toBe(false);
    });

    it('promotes a multi-word query that spells out the whole label', () => {
      expect(isAlmostExactWordMatch('run face detection', 'Run face detection', MIN)).toBe(true);
    });

    it('ignores query words below the length floor when requiring every word to match', () => {
      expect(isAlmostExactWordMatch('add a member', 'Add a member to this space', MIN)).toBe(true);
    });

    it('promotes a compound word when any of its sub-tokens matches', () => {
      expect(isAlmostExactWordMatch('auto-classification', 'Classification Settings', MIN)).toBe(true);
    });

    it('returns false when the query has no word at or above the floor', () => {
      expect(isAlmostExactWordMatch('a b', 'Albums', MIN)).toBe(false);
      expect(isAlmostExactWordMatch('', 'Albums', MIN)).toBe(false);
    });
  });
});
