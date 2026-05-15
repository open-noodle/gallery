import { defaults } from 'src/config';
import { FacialRecognitionConfigSchema } from 'src/dtos/model-config.dto';
import { describe, expect, it } from 'vitest';

describe('FacialRecognitionConfigSchema suggestionMaxDistance', () => {
  const base = {
    enabled: true,
    modelName: 'buffalo_l',
    minScore: 0.7,
    maxDistance: 0.5,
    minFaces: 3,
  };

  it('accepts a valid suggestionMaxDistance', () => {
    const parsed = FacialRecognitionConfigSchema.parse({ ...base, suggestionMaxDistance: 0.7 });
    expect(parsed.suggestionMaxDistance).toBe(0.7);
  });

  it('accepts 0 (feature disabled)', () => {
    expect(FacialRecognitionConfigSchema.parse({ ...base, suggestionMaxDistance: 0 }).suggestionMaxDistance).toBe(0);
  });

  it('rejects a negative value', () => {
    expect(() => FacialRecognitionConfigSchema.parse({ ...base, suggestionMaxDistance: -1 })).toThrow();
  });

  it('defaults suggestionMaxDistance to 0 (disabled)', () => {
    expect(defaults.machineLearning.facialRecognition.suggestionMaxDistance).toBe(0);
  });
});
