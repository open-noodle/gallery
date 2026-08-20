import { AdminConfigDto, defaults, mapPublicConfig, mapUserConfig } from 'src/dtos/config.dto';
import {
  GalleryClassificationSchema,
  GalleryFaceSuggestionSchema,
  GalleryMemoriesSchema,
  GalleryPetDetectionSchema,
  galleryConfigBool,
} from 'src/gallery/config.dto';
import { describe, expect, it } from 'vitest';
import z from 'zod';

describe('gallery config fragments', () => {
  it('coerces string booleans the way configBool does', () => {
    expect(galleryConfigBool.parse('true')).toBe(true);
    expect(galleryConfigBool.parse('false')).toBe(false);
    expect(galleryConfigBool.parse(true)).toBe(true);
  });

  it('rejects duplicate classification category names', () => {
    const category = {
      name: 'dupe',
      prompts: ['a'],
      similarity: 0.5,
      action: 'tag' as const,
      enabled: true,
      faceExclusion: 'off' as const,
    };
    expect(() => GalleryClassificationSchema.parse({ enabled: true, categories: [category, { ...category }] })).toThrow(
      /Category names must be unique/,
    );
  });

  it('accepts distinct classification category names', () => {
    const base = {
      prompts: ['a'],
      similarity: 0.5,
      action: 'tag' as const,
      enabled: true,
      faceExclusion: 'off' as const,
    };
    const parsed = GalleryClassificationSchema.parse({
      enabled: true,
      categories: [
        { ...base, name: 'one' },
        { ...base, name: 'two' },
      ],
    });
    expect(parsed.categories).toHaveLength(2);
  });

  it('defaults memories.types to an empty object', () => {
    const parsed = GalleryMemoriesSchema.parse({ retentionDays: 365, birthday: true, recentTrips: true });
    expect(parsed.types).toEqual({});
  });

  it('rejects a face-suggestion distance below the 0.1 minimum', () => {
    expect(() => GalleryFaceSuggestionSchema.parse({ enabled: false, maxDistance: 0 })).toThrow();
  });

  it('requires a suggestions block rather than defaulting one', () => {
    expect(() => GalleryFaceSuggestionSchema.parse(undefined)).toThrow();
  });

  // Guards spec S2: building pet detection from AdminConfigMachineLearningModelSchema would inherit
  // that schema's `enabled` leaf, which upstream annotates `visibility: User`.
  it('does not inherit a user-visible enabled leaf on pet detection', () => {
    expect(z.globalRegistry.get(GalleryPetDetectionSchema.shape.enabled)?.visibility).toBeUndefined();
  });
});

describe('fork config survives schema composition', () => {
  // The schema STRIPS unknown keys rather than rejecting them, and utils/config.ts uses the parsed
  // result as the live config. A fork field missing from the schema therefore vanishes silently at
  // runtime instead of erroring. This is the regression guard for that.
  const parsed = AdminConfigDto.schema.parse(defaults) as typeof defaults;

  it('keeps the fork top-level blocks', () => {
    expect(parsed.classification).toEqual({ enabled: true, categories: [] });
    expect(parsed.memories).toEqual({ retentionDays: 365, birthday: true, recentTrips: true, types: {} });
    expect(parsed.storageUsage).toEqual({ includeDerivatives: false });
  });

  it('keeps the fork machine-learning fields', () => {
    expect(parsed.machineLearning.clip.maxDistance).toBe(0);
    expect(parsed.machineLearning.facialRecognition.suggestions).toEqual({ enabled: true, maxDistance: 0.7 });
    expect(parsed.machineLearning.petDetection).toEqual({ enabled: false, modelName: 'yolo11s', minScore: 0.6 });
  });

  it('keeps the fork server flag and job concurrencies', () => {
    expect(parsed.server.mergePeopleAcrossOwners).toBe(false);
    expect(parsed.job.peopleBackfill).toEqual({ concurrency: 1 });
    expect(parsed.job.petDetection).toEqual({ concurrency: 1 });
    expect(parsed.job.classification).toEqual({ concurrency: 1 });
  });

  it('keeps the fork map-tile defaults', () => {
    expect(parsed.map.lightStyle).toBe('https://tiles.openfreemap.org/styles/positron');
    expect(parsed.map.darkStyle).toBe('https://tiles.openfreemap.org/styles/dark');
  });
});

const collectKeys = (value: unknown, path: string[] = [], out: string[] = []): string[] => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.push([...path, key].join('.'));
      collectKeys(child, [...path, key], out);
    }
  }
  return out;
};

describe('fork config is admin-only', () => {
  const forbidden = [
    'classification',
    'memories',
    'storageUsage',
    'petDetection',
    'suggestions',
    'mergePeopleAcrossOwners',
    'maxDistance',
  ];

  it.each([
    ['user', mapUserConfig(defaults)],
    ['public', mapPublicConfig(defaults)],
  ])('exposes no fork config key to the %s projection', (_name, projection) => {
    const leaked = collectKeys(projection).filter((key) => forbidden.some((f) => key.split('.').includes(f)));
    expect(leaked).toEqual([]);
  });

  it('still exposes the upstream fields clients rely on', () => {
    const userKeys = collectKeys(mapUserConfig(defaults));
    expect(userKeys).toContain('machineLearning.clip.enabled');
    expect(userKeys).toContain('map.lightStyle');
  });
});
