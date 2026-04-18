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
});
