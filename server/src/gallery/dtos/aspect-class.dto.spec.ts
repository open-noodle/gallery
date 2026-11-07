import { aspectClassesBody, aspectClassesQuery } from 'src/gallery/dtos/aspect-class.dto.js';

describe('aspectClasses request field', () => {
  describe('query', () => {
    it('leaves an absent field absent', () => {
      expect(aspectClassesQuery.parse(undefined)).toBeUndefined();
    });

    it('wraps a single value', () => {
      expect(aspectClassesQuery.parse('square')).toEqual(['square']);
    });

    it('accepts a list of classes', () => {
      expect(aspectClassesQuery.parse(['landscape', 'panorama-tall'])).toEqual(['landscape', 'panorama-tall']);
    });

    it('rejects an empty string and an unknown class', () => {
      expect(aspectClassesQuery.safeParse('').success).toBe(false);
      expect(aspectClassesQuery.safeParse('wide').success).toBe(false);
      expect(aspectClassesQuery.safeParse(['square', 'wide']).success).toBe(false);
    });
  });

  describe('body', () => {
    it('accepts an empty list, which means no filter', () => {
      expect(aspectClassesBody.parse([])).toEqual([]);
    });

    it('rejects an unknown class and a bare value', () => {
      expect(aspectClassesBody.safeParse(['wide']).success).toBe(false);
      expect(aspectClassesBody.safeParse('square').success).toBe(false);
    });
  });
});
