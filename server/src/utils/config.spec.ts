import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { deriveSuggestionBand, foldLegacyFaceSuggestionConfig, getConfig } from 'src/utils/config';
import { mockEnvData, newConfigRepositoryMock } from 'test/repositories/config.repository.mock';
import { newSystemMetadataRepositoryMock } from 'test/repositories/system-metadata.repository.mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacy = (suggestionMaxDistance: number, maxDistance?: number) => ({
  machineLearning: {
    facialRecognition: {
      ...(maxDistance !== undefined && { maxDistance }),
      suggestionMaxDistance,
    },
  },
});

describe('foldLegacyFaceSuggestionConfig', () => {
  it('enables suggestions when the legacy value exceeds the default recognition distance', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.7)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: true, maxDistance: 0.7 });
    expect(result.machineLearning.facialRecognition.suggestionMaxDistance).toBeUndefined();
  });

  it('disables suggestions and restores the default band when the legacy value is 0', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.7 });
  });

  it('disables suggestions but retains a legacy value below the recognition distance', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.4)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.4 });
  });

  it('restores the default band when the legacy value is below the 0.1 schema minimum', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.05)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.7 });
  });

  it('keeps the legacy value exactly at the 0.1 schema minimum instead of falling back to the default', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.1)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.1 });
  });

  it('compares against an overridden recognition distance, not the default', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.7, 0.8)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.7 });
  });

  it('disables suggestions when the legacy value exactly equals the default recognition distance', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.5)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.5 });
  });

  it('disables suggestions when the legacy value exactly equals an overridden recognition distance', () => {
    const result = foldLegacyFaceSuggestionConfig(legacy(0.8, 0.8)) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: false, maxDistance: 0.8 });
  });

  it('lets an existing suggestions block win and drops the legacy key', () => {
    const partial = {
      machineLearning: {
        facialRecognition: { suggestionMaxDistance: 0.9, suggestions: { enabled: true, maxDistance: 0.6 } },
      },
    };
    const result = foldLegacyFaceSuggestionConfig(partial) as any;
    expect(result.machineLearning.facialRecognition.suggestions).toEqual({ enabled: true, maxDistance: 0.6 });
    expect(result.machineLearning.facialRecognition.suggestionMaxDistance).toBeUndefined();
  });

  it('passes through a partial with no legacy key untouched', () => {
    const partial = { machineLearning: { facialRecognition: { maxDistance: 0.6 } } };
    expect(foldLegacyFaceSuggestionConfig(partial)).toEqual(partial);
  });

  it('tolerates a null or non-object partial', () => {
    const noPartial: unknown = undefined;
    expect(foldLegacyFaceSuggestionConfig(null)).toBeNull();
    expect(foldLegacyFaceSuggestionConfig(noPartial)).toBeUndefined();
  });

  it('preserves sibling facialRecognition keys and other machineLearning sections during the fold', () => {
    const partial = {
      machineLearning: {
        facialRecognition: { enabled: true, modelName: 'buffalo_l', minFaces: 3, suggestionMaxDistance: 0.7 },
        clip: { enabled: true, modelName: 'ViT-B-32__openai' },
      },
    };
    const result = foldLegacyFaceSuggestionConfig(partial) as any;
    expect(result.machineLearning.facialRecognition).toEqual({
      enabled: true,
      modelName: 'buffalo_l',
      minFaces: 3,
      suggestions: { enabled: true, maxDistance: 0.7 },
    });
    expect(result.machineLearning.clip).toEqual({ enabled: true, modelName: 'ViT-B-32__openai' });
  });

  it('does not mutate the input partial', () => {
    const partial = legacy(0.7);
    foldLegacyFaceSuggestionConfig(partial);
    expect(partial.machineLearning.facialRecognition.suggestionMaxDistance).toBe(0.7);
    expect((partial.machineLearning.facialRecognition as any).suggestions).toBeUndefined();
  });
});

function partialFor(band: { enabled: boolean; suggestionsMaxDistance: number; facialRecognitionMaxDistance: number }) {
  return {
    machineLearning: {
      facialRecognition: {
        maxDistance: band.facialRecognitionMaxDistance,
        suggestions: { enabled: band.enabled, maxDistance: band.suggestionsMaxDistance },
      },
    },
  };
}

function yamlFor(band: { enabled: boolean; suggestionsMaxDistance: number; facialRecognitionMaxDistance: number }) {
  return `
machineLearning:
  facialRecognition:
    maxDistance: ${band.facialRecognitionMaxDistance}
    suggestions:
      enabled: ${band.enabled}
      maxDistance: ${band.suggestionsMaxDistance}
`;
}

// B1: the upgrade shape — a config that predates `suggestions` entirely, so the merge supplies the default.
function yamlNoSuggestions(facialRecognitionMaxDistance: number) {
  return `
machineLearning:
  facialRecognition:
    maxDistance: ${facialRecognitionMaxDistance}
`;
}

// Slice 13 (F35): the `suggestions.maxDistance > facialRecognition.maxDistance` invariant is enforced by the
// `ConfigValidate` event hook (person.service.ts), which only fires from `updateSystemConfig` — a call the
// config-file path refuses outright. A config file with an inverted band therefore boots cleanly and silently
// disables suggestions, with no admin UI available to diagnose it. buildConfig gets its own check.
describe('buildConfig suggestion band invariant', () => {
  const inverted = { enabled: true, suggestionsMaxDistance: 0.4, facialRecognitionMaxDistance: 0.5 };

  let configRepo: ReturnType<typeof newConfigRepositoryMock>;
  let metadataRepo: ReturnType<typeof newSystemMetadataRepositoryMock>;
  let logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    configRepo = newConfigRepositoryMock(); // also clears the module-level config cache (see the mock factory).
    metadataRepo = newSystemMetadataRepositoryMock();
    logger = { warn: vi.fn(), error: vi.fn() };
  });

  const repos = () => ({
    configRepo: configRepo as unknown as ConfigRepository,
    metadataRepo: metadataRepo as unknown as SystemMetadataRepository,
    logger: logger as unknown as LoggingRepository,
  });

  it('S13.7 throws for a config-file source with an inverted band, naming both values', async () => {
    configRepo.getEnv.mockReturnValue(mockEnvData({ configFile: '/data/config.yaml' }));
    metadataRepo.readFile.mockResolvedValue(yamlFor(inverted));

    await expect(getConfig(repos(), { withCache: false })).rejects.toThrow(/0\.4/);
    await expect(getConfig(repos(), { withCache: false })).rejects.toThrow(/0\.5/);
  });

  it('S13.8 does not throw when suggestions are disabled, even with an inverted band', async () => {
    configRepo.getEnv.mockReturnValue(mockEnvData({ configFile: '/data/config.yaml' }));
    // Positive control: the identical band with `enabled: true` DOES throw (S13.7) — this is what proves the
    // gate is `suggestions.enabled`, not some accidental reason the check never fires.
    metadataRepo.readFile.mockResolvedValue(yamlFor({ ...inverted, enabled: true }));
    await expect(getConfig(repos(), { withCache: false })).rejects.toThrow();

    metadataRepo.readFile.mockResolvedValue(yamlFor({ ...inverted, enabled: false }));
    await expect(getConfig(repos(), { withCache: false })).resolves.toBeDefined();
  });

  it('S13.9 logs (does not throw) for a database source with an inverted band', async () => {
    configRepo.getEnv.mockReturnValue(mockEnvData({})); // no configFile => database source.
    metadataRepo.get.mockResolvedValue(partialFor(inverted));

    await expect(getConfig(repos(), { withCache: false })).resolves.toBeDefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message] = logger.error.mock.calls[0];
    expect(String(message)).toMatch(/0\.4/);
    expect(String(message)).toMatch(/0\.5/);
  });

  it('S13.10 (pin) accepts a valid band on both a config-file and a database source', async () => {
    const valid = { enabled: true, suggestionsMaxDistance: 0.7, facialRecognitionMaxDistance: 0.5 };

    configRepo.getEnv.mockReturnValue(mockEnvData({ configFile: '/data/config.yaml' }));
    metadataRepo.readFile.mockResolvedValue(yamlFor(valid));
    await expect(getConfig(repos(), { withCache: false })).resolves.toBeDefined();

    configRepo.getEnv.mockReturnValue(mockEnvData({}));
    metadataRepo.get.mockResolvedValue(partialFor(valid));
    await expect(getConfig(repos(), { withCache: false })).resolves.toBeDefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('S13.11 (pin) accepts a legacy suggestionMaxDistance whose folded value is valid, using the folded numbers', async () => {
    configRepo.getEnv.mockReturnValue(mockEnvData({})); // database source: a rejection would log, not throw.
    // Legacy key only — no `suggestions` block. facialRecognition.maxDistance is left at its 0.5 default.
    // foldLegacyFaceSuggestionConfig turns this into { enabled: true, maxDistance: 0.9 } before the invariant
    // check ever runs; without the fold, `suggestions` stays at the disabled default and this would look
    // different (see the mutation evidence in the report for this test).
    // `suggestionMaxDistance` is the retired key and is deliberately absent from the current config type,
    // so the stored partial has to be cast — that is exactly the shape an already-deployed database holds.
    metadataRepo.get.mockResolvedValue(legacy(0.9) as any);

    const config = await getConfig(repos(), { withCache: false });
    expect(config.machineLearning.facialRecognition.suggestions).toEqual({ enabled: true, maxDistance: 0.9 });
    expect(logger.error).not.toHaveBeenCalled();
  });

  // B1: an install that raised `facialRecognition.maxDistance` before `suggestions` existed carries no
  // suggestions block, so the merge fills in the 0.7 default — which inverts against any recognition
  // distance >= 0.7 and hard-failed boot in config-file mode. `deriveSuggestionBand` keeps the band valid
  // for exactly the bands the admin did NOT set; an explicitly inverted band must still surface.
  it('B1 boots a config-file install whose recognition distance exceeds the suggestion default', async () => {
    configRepo.getEnv.mockReturnValue(mockEnvData({ configFile: '/data/config.yaml' }));
    metadataRepo.readFile.mockResolvedValue(yamlNoSuggestions(0.8));

    const config = await getConfig(repos(), { withCache: false });

    expect(config.machineLearning.facialRecognition.suggestions.maxDistance).toBe(1);
    expect(config.machineLearning.facialRecognition.suggestions.enabled).toBe(true);
  });

  it('B1 positive control: an EXPLICIT inverted band still throws, so this is not a blanket repair', async () => {
    configRepo.getEnv.mockReturnValue(mockEnvData({ configFile: '/data/config.yaml' }));
    metadataRepo.readFile.mockResolvedValue(
      yamlFor({ enabled: true, suggestionsMaxDistance: 0.6, facialRecognitionMaxDistance: 0.8 }),
    );

    await expect(getConfig(repos(), { withCache: false })).rejects.toThrow(/0\.6/);
  });

  it('B1 leaves a valid default band untouched', async () => {
    configRepo.getEnv.mockReturnValue(mockEnvData({ configFile: '/data/config.yaml' }));
    metadataRepo.readFile.mockResolvedValue(yamlNoSuggestions(0.5));

    const config = await getConfig(repos(), { withCache: false });

    expect(config.machineLearning.facialRecognition.suggestions.maxDistance).toBe(0.7);
  });

  it('B1 a database install with a high recognition distance no longer logs an invariant error', async () => {
    configRepo.getEnv.mockReturnValue(mockEnvData({}));
    metadataRepo.get.mockResolvedValue({
      machineLearning: { facialRecognition: { maxDistance: 0.9 } },
    } as never);

    const config = await getConfig(repos(), { withCache: false });

    expect(config.machineLearning.facialRecognition.suggestions.maxDistance).toBeCloseTo(1.1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

function merged(facialRecognitionMaxDistance: number, suggestions: { enabled: boolean; maxDistance: number }) {
  return {
    machineLearning: { facialRecognition: { maxDistance: facialRecognitionMaxDistance, suggestions } },
  } as never;
}

describe('deriveSuggestionBand', () => {
  it('raises an unset default band above the recognition distance', () => {
    const result = deriveSuggestionBand(
      { machineLearning: { facialRecognition: { maxDistance: 0.8 } } },
      merged(0.8, { enabled: true, maxDistance: 0.7 }),
    );
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(1);
  });

  it('does not touch a band the admin set explicitly, even an inverted one', () => {
    const partial = {
      machineLearning: { facialRecognition: { maxDistance: 0.8, suggestions: { maxDistance: 0.6 } } },
    };
    const result = deriveSuggestionBand(partial, merged(0.8, { enabled: true, maxDistance: 0.6 }));
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(0.6);
  });

  it('clamps to the schema ceiling of 2 and disables when no valid band exists', () => {
    const result = deriveSuggestionBand(
      { machineLearning: { facialRecognition: { maxDistance: 2 } } },
      merged(2, { enabled: true, maxDistance: 0.7 }),
    );
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(2);
    expect(result.machineLearning.facialRecognition.suggestions.enabled).toBe(false);
  });

  // The equality boundary, and the single most common upgrade shape: an install sitting exactly at the
  // 0.7 default band. Mutating the guard from `>` to `>=` left the whole file green without this case,
  // while reintroducing the crash for precisely these users.
  it('derives when the recognition distance EQUALS the default band', () => {
    const result = deriveSuggestionBand(
      { machineLearning: { facialRecognition: { maxDistance: 0.7 } } },
      merged(0.7, { enabled: true, maxDistance: 0.7 }),
    );
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(0.9);
  });

  // The derived value is persisted by updateConfig and rendered into the admin number input, so an
  // IEEE-754 artefact (0.7 + 0.2 === 0.8999999999999999) would leak into both.
  it('rounds the derived value to two decimals', () => {
    const result = deriveSuggestionBand(
      { machineLearning: { facialRecognition: { maxDistance: 0.7 } } },
      merged(0.7, { enabled: true, maxDistance: 0.7 }),
    );
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(0.9);
    expect(String(result.machineLearning.facialRecognition.suggestions.maxDistance)).toBe('0.9');
  });

  // At the ceiling the feature switches itself off, and the invariant check in buildConfig is gated on
  // `enabled` — so it cannot fire afterwards. Without a warning the admin gets no diagnostic at all.
  it('warns when it disables the feature at the ceiling', () => {
    const logger = { warn: vi.fn() };
    deriveSuggestionBand(
      { machineLearning: { facialRecognition: { maxDistance: 2 } } },
      merged(2, { enabled: true, maxDistance: 0.7 }),
      logger,
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Face suggestions disabled'));
  });

  it('does not warn when it derives a valid band (control)', () => {
    const logger = { warn: vi.fn() };
    deriveSuggestionBand(
      { machineLearning: { facialRecognition: { maxDistance: 0.8 } } },
      merged(0.8, { enabled: true, maxDistance: 0.7 }),
      logger,
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('leaves an already-valid band alone', () => {
    const result = deriveSuggestionBand(
      { machineLearning: { facialRecognition: { maxDistance: 0.5 } } },
      merged(0.5, { enabled: true, maxDistance: 0.7 }),
    );
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(0.7);
  });

  it('tolerates a partial with no facialRecognition section at all', () => {
    const result = deriveSuggestionBand(
      { server: { externalDomain: 'https://example.com' } },
      merged(0.5, { enabled: true, maxDistance: 0.7 }),
    );
    expect(result.machineLearning.facialRecognition.suggestions.maxDistance).toBe(0.7);
  });
});
