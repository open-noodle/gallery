import { DatabaseExtension } from 'src/enum';
import {
  ASSET_CHECKSUM_CONSTRAINT,
  isAssetChecksumConstraint,
  removeUndefinedKeys,
  tokenizeForSearch,
  updateLockedColumns,
  vectorIndexQuery,
} from 'src/utils/database';
import { describe, expect, it } from 'vitest';

describe('tokenizeForSearch', () => {
  describe('Latin text', () => {
    it('should split a simple sentence into words', () => {
      expect(tokenizeForSearch('hello world')).toEqual(['hello', 'world']);
    });

    it('should handle a single word', () => {
      expect(tokenizeForSearch('hello')).toEqual(['hello']);
    });

    it('should return an empty array for empty string', () => {
      expect(tokenizeForSearch('')).toEqual([]);
    });

    it('should return an empty array for whitespace only', () => {
      expect(tokenizeForSearch(' '.repeat(3))).toEqual([]);
    });

    it('should handle multiple spaces between words', () => {
      expect(tokenizeForSearch('hello   world')).toEqual(['hello', 'world']);
    });

    it('should handle leading and trailing whitespace', () => {
      expect(tokenizeForSearch('  hello world  ')).toEqual(['hello', 'world']);
    });

    it('should keep punctuation attached to words', () => {
      expect(tokenizeForSearch('hello, world!')).toEqual(['hello,', 'world!']);
    });

    it('should handle tabs and other whitespace characters', () => {
      expect(tokenizeForSearch('hello\tworld')).toEqual(['hello', 'world']);
    });
  });

  describe('CJK text', () => {
    it('should tokenize a single CJK character as-is', () => {
      expect(tokenizeForSearch('\u{4E16}')).toEqual(['\u{4E16}']);
    });

    it('should tokenize two CJK characters into a single bigram', () => {
      expect(tokenizeForSearch('\u{4E16}\u{754C}')).toEqual(['\u{4E16}\u{754C}']);
    });

    it('should tokenize three CJK characters into overlapping bigrams', () => {
      // 世界杯 -> 世界, 界杯
      expect(tokenizeForSearch('\u{4E16}\u{754C}\u{676F}')).toEqual(['\u{4E16}\u{754C}', '\u{754C}\u{676F}']);
    });

    it('should tokenize four CJK characters into overlapping bigrams', () => {
      // 人工智能 -> 人工, 工智, 智能
      expect(tokenizeForSearch('\u{4EBA}\u{5DE5}\u{667A}\u{80FD}')).toEqual([
        '\u{4EBA}\u{5DE5}',
        '\u{5DE5}\u{667A}',
        '\u{667A}\u{80FD}',
      ]);
    });

    it('should handle Japanese Hiragana', () => {
      // こんにちは (5 chars) -> こん, んに, にち, ちは
      expect(tokenizeForSearch('\u{3053}\u{3093}\u{306B}\u{3061}\u{306F}')).toEqual([
        '\u{3053}\u{3093}',
        '\u{3093}\u{306B}',
        '\u{306B}\u{3061}',
        '\u{3061}\u{306F}',
      ]);
    });

    it('should handle Japanese Katakana', () => {
      // カタカナ (4 chars) -> カタ, タカ, カナ
      expect(tokenizeForSearch('\u{30AB}\u{30BF}\u{30AB}\u{30CA}')).toEqual([
        '\u{30AB}\u{30BF}',
        '\u{30BF}\u{30AB}',
        '\u{30AB}\u{30CA}',
      ]);
    });

    it('should handle Korean characters', () => {
      // 한국 (2 chars) -> 한국
      expect(tokenizeForSearch('\u{D55C}\u{AD6D}')).toEqual(['\u{D55C}\u{AD6D}']);
    });
  });

  describe('mixed text', () => {
    it('should handle CJK followed by Latin', () => {
      expect(tokenizeForSearch('\u{4E16}\u{754C} hello')).toEqual(['\u{4E16}\u{754C}', 'hello']);
    });

    it('should handle Latin followed by CJK', () => {
      expect(tokenizeForSearch('hello \u{4E16}\u{754C}')).toEqual(['hello', '\u{4E16}\u{754C}']);
    });

    it('should handle alternating Latin and CJK', () => {
      expect(tokenizeForSearch('test \u{4E16}\u{754C}\u{676F} more')).toEqual([
        'test',
        '\u{4E16}\u{754C}',
        '\u{754C}\u{676F}',
        'more',
      ]);
    });

    it('should handle CJK and Latin without spaces between them', () => {
      // CJK chars are split from Latin even without whitespace
      expect(tokenizeForSearch('\u{4E16}\u{754C}hello')).toEqual(['\u{4E16}\u{754C}', 'hello']);
    });

    it('should handle Latin followed by CJK without spaces', () => {
      expect(tokenizeForSearch('hello\u{4E16}\u{754C}')).toEqual(['hello', '\u{4E16}\u{754C}']);
    });

    it('should truncate input longer than 1000 characters', () => {
      const longText = 'a'.repeat(2000);
      const result = tokenizeForSearch(longText);
      expect(result).toEqual(['a'.repeat(1000)]);
    });

    it('should not truncate input at exactly 1000 characters', () => {
      const text = 'a'.repeat(1000);
      const result = tokenizeForSearch(text);
      expect(result).toEqual(['a'.repeat(1000)]);
    });

    it('should handle truncation mid-word', () => {
      const text = 'hello ' + 'x'.repeat(1000);
      const result = tokenizeForSearch(text);
      // 'hello' = 5 chars, space = 1, then 994 x's to reach 1000
      expect(result).toEqual(['hello', 'x'.repeat(994)]);
    });
  });
});

describe('vectorIndexQuery', () => {
  it('should generate a VectorChord index query', () => {
    const result = vectorIndexQuery({
      vectorExtension: DatabaseExtension.VectorChord,
      table: 'smart_search',
      indexName: 'clip_index',
    });
    expect(result).toContain('CREATE INDEX IF NOT EXISTS clip_index ON smart_search');
    expect(result).toContain('USING vchordrq');
    expect(result).toContain('vector_cosine_ops');
    expect(result).toContain('residual_quantization = false');
    expect(result).toContain('spherical_centroids = true');
    expect(result).toContain('lists = [1]');
  });

  it('should use custom lists parameter for VectorChord', () => {
    const result = vectorIndexQuery({
      vectorExtension: DatabaseExtension.VectorChord,
      table: 'smart_search',
      indexName: 'clip_index',
      lists: 100,
    });
    expect(result).toContain('lists = [100]');
  });

  it('should generate a pgvector (hnsw) index query', () => {
    const result = vectorIndexQuery({
      vectorExtension: DatabaseExtension.Vector,
      table: 'smart_search',
      indexName: 'clip_index',
    });
    expect(result).toContain('CREATE INDEX IF NOT EXISTS clip_index ON smart_search');
    expect(result).toContain('USING hnsw');
    expect(result).toContain('vector_cosine_ops');
    expect(result).toContain('ef_construction = 300');
    expect(result).toContain('m = 16');
  });

  it('should throw an error for an unsupported vector extension', () => {
    expect(() =>
      vectorIndexQuery({
        vectorExtension: 'unknown_ext' as any,
        table: 'smart_search',
        indexName: 'clip_index',
      }),
    ).toThrow("Unsupported vector extension: 'unknown_ext'");
  });

  it('should use the provided table name in the query', () => {
    const result = vectorIndexQuery({
      vectorExtension: DatabaseExtension.Vector,
      table: 'face_search',
      indexName: 'face_index',
    });
    expect(result).toContain('ON face_search');
    expect(result).toContain('face_index');
  });
});

describe('removeUndefinedKeys', () => {
  it('should remove keys from update that do not exist in the template', () => {
    const update = { a: 1, b: 2, c: 3 };
    const template = { a: 'x', b: 'y' };
    const result = removeUndefinedKeys(update, template);
    expect(result).toEqual({ a: 1, b: 2 });
    expect(result).not.toHaveProperty('c');
  });

  it('should remove keys from update that are undefined in the template', () => {
    const update = { a: 1, b: 2 };
    const template = { a: 'defined', b: undefined };
    const result = removeUndefinedKeys(update, template);
    expect(result).toEqual({ a: 1 });
    expect(result).not.toHaveProperty('b');
  });

  it('should keep all keys when they all exist in the template', () => {
    const update = { x: 10, y: 20 };
    const template = { x: 'any', y: 'any' };
    const result = removeUndefinedKeys(update, template);
    expect(result).toEqual({ x: 10, y: 20 });
  });

  it('should return an empty-like object when no keys match', () => {
    const update = { a: 1, b: 2 } as Record<string, number>;
    const template = {};
    const result = removeUndefinedKeys(update, template);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should mutate the original object', () => {
    const update = { a: 1, b: 2, extra: 3 };
    const template = { a: 0, b: 0 };
    removeUndefinedKeys(update, template);
    expect(update).not.toHaveProperty('extra');
  });

  it('should handle an empty update object', () => {
    const update = {};
    const template = { a: 1 };
    const result = removeUndefinedKeys(update, template);
    expect(result).toEqual({});
  });

  it('should keep a key when the template has it set to a falsy but defined value', () => {
    const update = { a: 1, b: 2 };
    const template = { a: 0, b: null };
    const result = removeUndefinedKeys(update, template);
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe('isAssetChecksumConstraint', () => {
  it('should return true when the constraint name matches', () => {
    const error = { constraint_name: ASSET_CHECKSUM_CONSTRAINT };
    expect(isAssetChecksumConstraint(error)).toBe(true);
  });

  it('should return false for a different constraint name', () => {
    const error = { constraint_name: 'some_other_constraint' };
    expect(isAssetChecksumConstraint(error)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isAssetChecksumConstraint(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isAssetChecksumConstraint(undefined)).toBe(false);
  });

  it('should return false for an object without constraint_name', () => {
    expect(isAssetChecksumConstraint({ message: 'some error' })).toBe(false);
  });

  it('should return false for a non-object value', () => {
    expect(isAssetChecksumConstraint('string error')).toBe(false);
    expect(isAssetChecksumConstraint(42)).toBe(false);
  });
});

describe('updateLockedColumns', () => {
  it('should add lockable properties that are present in the exif object', () => {
    const exif = { description: 'test', rating: 5 } as any;
    const result = updateLockedColumns(exif);
    expect(result.lockedProperties).toContain('description');
    expect(result.lockedProperties).toContain('rating');
  });

  it('should not include non-lockable properties', () => {
    const exif = { description: 'test', someOtherProp: 'value' } as any;
    const result = updateLockedColumns(exif);
    expect(result.lockedProperties).toContain('description');
    expect(result.lockedProperties).not.toContain('someOtherProp');
  });

  it('should return an empty array when no lockable properties are present', () => {
    const exif = { someRandomProp: 'value', anotherProp: 42 } as any;
    const result = updateLockedColumns(exif);
    expect(result.lockedProperties).toEqual([]);
  });

  it('should detect all lockable properties when all are present', () => {
    const exif = {
      description: 'desc',
      dateTimeOriginal: new Date(),
      latitude: 40.7,
      longitude: -74,
      rating: 3,
      timeZone: 'UTC',
      tags: ['tag1'],
    } as any;
    const result = updateLockedColumns(exif);
    expect(result.lockedProperties).toEqual([
      'description',
      'dateTimeOriginal',
      'latitude',
      'longitude',
      'rating',
      'timeZone',
      'tags',
    ]);
  });

  it('should mutate the original object', () => {
    const exif = { description: 'test' } as any;
    updateLockedColumns(exif);
    expect(exif.lockedProperties).toBeDefined();
  });

  it('should return the same object reference', () => {
    const exif = { description: 'test' } as any;
    const result = updateLockedColumns(exif);
    expect(result).toBe(exif);
  });

  it('should overwrite existing lockedProperties', () => {
    const exif = { description: 'test', lockedProperties: ['old'] } as any;
    const result = updateLockedColumns(exif);
    expect(result.lockedProperties).toEqual(['description']);
  });
});
