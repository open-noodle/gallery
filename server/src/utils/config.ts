import AsyncLock from 'async-lock';
import { load as loadYaml } from 'js-yaml';
import * as _ from 'lodash';
import { AdminConfigDto, SystemConfig, defaults } from 'src/dtos/config.dto';
import { DatabaseLock, SystemMetadataKey } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DeepPartial } from 'src/types';
import { getKeysDeep, unsetDeep } from 'src/utils/misc';

type RepoDeps = {
  configRepo: ConfigRepository;
  metadataRepo: SystemMetadataRepository;
  logger: LoggingRepository;
};

const asyncLock = new AsyncLock();
let config: SystemConfig | null = null;
let lastUpdated: number | null = null;

export const clearConfigCache = () => {
  config = null;
  lastUpdated = null;
};

export const getConfig = async (repos: RepoDeps, { withCache }: { withCache: boolean }): Promise<SystemConfig> => {
  if (!withCache || !config) {
    const timestamp = lastUpdated;
    await asyncLock.acquire(DatabaseLock[DatabaseLock.GetSystemConfig], async () => {
      if (timestamp !== lastUpdated) {
        return;
      }

      config = await buildConfig(repos);
      lastUpdated = Date.now();
    });
  }

  return config!;
};

export const updateConfig = async (repos: RepoDeps, newConfig: SystemConfig): Promise<SystemConfig> => {
  const { metadataRepo } = repos;
  // get the difference between the new config and the default config
  const partialConfig: DeepPartial<SystemConfig> = {};
  for (const property of getKeysDeep(defaults, [], { emptyObjectsAsLeaves: true })) {
    const newValue = _.get(newConfig, property);
    const isEmpty = [undefined, null, ''].includes(newValue);
    const defaultValue = _.get(defaults, property);
    const isEqual = newValue === defaultValue || _.isEqual(newValue, defaultValue);

    if (isEmpty || isEqual) {
      continue;
    }

    _.set(partialConfig, property, newValue);
  }

  await metadataRepo.set(SystemMetadataKey.SystemConfig, partialConfig);

  return getConfig(repos, { withCache: false });
};

const loadFromFile = async ({ metadataRepo, logger }: RepoDeps, filepath: string) => {
  try {
    const file = await metadataRepo.readFile(filepath);
    return loadYaml(file) as unknown;
  } catch (error: Error | any) {
    logger.error(`Unable to load configuration file: ${filepath}`);
    logger.error(error);
    throw error;
  }
};

// Typed as `string` rather than left as an inferred literal: lodash's `get` overload resolution
// picks a path-walking `GetFieldType<TObject, TPath>` for literal `TPath` string types, which
// resolves to `undefined` against the generic `object` type `_.isObject` narrows to below. Widening
// to `string` matches the dynamic-path call further down in this file and falls back to the `any`
// overload instead.
const LEGACY_SUGGESTION_PATH: string = 'machineLearning.facialRecognition.suggestionMaxDistance';
const SUGGESTIONS_PATH: string = 'machineLearning.facialRecognition.suggestions';

/**
 * Folds the pre-rename `facialRecognition.suggestionMaxDistance` sentinel into the nested
 * `facialRecognition.suggestions` block. Runs against the user-supplied partial (database or config
 * file) before it merges over defaults, so both config sources migrate identically. Without this,
 * the renamed key would land in the unknown-keys warn path and be silently dropped, switching the
 * feature off on every instance already running it.
 */
export const foldLegacyFaceSuggestionConfig = (partial: unknown): unknown => {
  if (!_.isObject(partial) || _.get(partial, LEGACY_SUGGESTION_PATH) === undefined) {
    return partial;
  }

  const folded = _.cloneDeep(partial);
  const legacy = _.get(folded, LEGACY_SUGGESTION_PATH) as number;
  unsetDeep(folded, LEGACY_SUGGESTION_PATH);

  if (_.get(folded, SUGGESTIONS_PATH) === undefined) {
    const maxDistance =
      (_.get(folded, 'machineLearning.facialRecognition.maxDistance') as number | undefined) ??
      defaults.machineLearning.facialRecognition.maxDistance;

    _.set(folded, SUGGESTIONS_PATH, {
      enabled: legacy > maxDistance,
      // The new field's minimum is 0.1, so a legacy 0 (or any sub-minimum value) must fall back to
      // the default rather than fold through into a config that fails its own schema.
      maxDistance: legacy >= 0.1 ? legacy : defaults.machineLearning.facialRecognition.suggestions.maxDistance,
    });
  }

  return folded;
};

const SUGGESTIONS_MAX_DISTANCE_PATH: string = 'machineLearning.facialRecognition.suggestions.maxDistance';
// FaceSuggestionConfigSchema caps maxDistance at 2 (dtos/model-config.dto.ts).
const SUGGESTION_MAX_DISTANCE_CEILING = 2;
const SUGGESTION_BAND_HEADROOM = 0.2;

/**
 * Keeps the suggestion band valid for installs that raised `facialRecognition.maxDistance` before
 * `suggestions` existed. Their stored partial carries no suggestions block, so the merge fills in the
 * 0.7 default — which inverts against any recognition distance >= 0.7. In config-file mode that made
 * `buildConfig` throw and the server crash-loop on upgrade; on a database source it disabled the feature
 * and 400'd every subsequent settings save, because the whole config is PUT on each one.
 *
 * Only ever adjusts a band the admin did NOT set. An explicitly configured inverted band is a real
 * misconfiguration and must still surface, or the admin never learns their setting does nothing.
 */
export const deriveSuggestionBand = (
  partial: unknown,
  merged: SystemConfig,
  logger?: { warn: (message: string) => void },
): SystemConfig => {
  if (_.get(partial, SUGGESTIONS_MAX_DISTANCE_PATH) !== undefined) {
    return merged;
  }

  const { maxDistance, suggestions } = merged.machineLearning.facialRecognition;
  if (suggestions.maxDistance > maxDistance) {
    return merged;
  }

  // Rounded to two decimals: 0.7 + 0.2 is 0.8999999999999999 in IEEE-754, and this value is persisted by
  // updateConfig and rendered into the admin number input, so an unrounded float leaks into both.
  const derived = Math.min(
    Math.round((maxDistance + SUGGESTION_BAND_HEADROOM) * 100) / 100,
    SUGGESTION_MAX_DISTANCE_CEILING,
  );
  const config = _.cloneDeep(merged);
  config.machineLearning.facialRecognition.suggestions.maxDistance = derived;
  // At the schema ceiling no valid band exists at all. Disable rather than ship a config that fails its
  // own invariant on every save — and say so, because the invariant check below is gated on `enabled`
  // and therefore cannot fire once we switch it off, leaving the admin with no diagnostic at all.
  if (derived <= maxDistance) {
    config.machineLearning.facialRecognition.suggestions.enabled = false;
    logger?.warn(
      `Face suggestions disabled: machineLearning.facialRecognition.maxDistance (${maxDistance}) leaves no room for a suggestion band below the maximum of ${SUGGESTION_MAX_DISTANCE_CEILING}.`,
    );
  }
  return config;
};

const buildConfig = async (repos: RepoDeps) => {
  const { configRepo, metadataRepo, logger } = repos;
  const { configFile } = configRepo.getEnv();

  // load partial
  const rawPartial = configFile
    ? await loadFromFile(repos, configFile)
    : await metadataRepo.get(SystemMetadataKey.SystemConfig);
  const partial = foldLegacyFaceSuggestionConfig(rawPartial);

  // merge with defaults. Enumerate the user-supplied partial WITHOUT emptyObjectsAsLeaves: an empty
  // object in the partial must yield no path so it can't `_.set` over (and wipe) a populated default
  // section. Only the defaults enumeration below opts into empty-object leaves.
  const rawConfig = _.cloneDeep(defaults);
  for (const property of getKeysDeep(partial)) {
    _.set(rawConfig, property, _.get(partial, property));
  }

  // check for extra properties. Enumerate defaults with empty objects kept as leaves so sparse-map
  // defaults (e.g. `memories.types: {}`) count as known keys instead of being reported as unknown.
  const unknownKeys = _.cloneDeep(rawConfig);
  for (const property of getKeysDeep(defaults, [], { emptyObjectsAsLeaves: true })) {
    unsetDeep(unknownKeys, property);
  }

  if (!_.isEmpty(unknownKeys)) {
    logger.warn(`Unknown keys found: ${JSON.stringify(unknownKeys, null, 2)}`);
  }

  // validate with Zod schema
  const result = AdminConfigDto.schema.safeParse(rawConfig);
  if (!result.success) {
    const messages = ['Invalid system config: '];
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      messages.push(`  - [${path}] ${issue.message}`);
    }
    if (configFile) {
      throw new Error(messages.join('\n'));
    }
    logger.error('Validation error', messages);
  }

  const config = deriveSuggestionBand(partial, (result.success ? result.data : rawConfig) as SystemConfig, logger);

  // The suggestion-band cross-field invariant (F35). `ConfigValidate` (person.service.ts) enforces the same rule
  // on the database-config path, but that event only fires from `updateSystemConfig`, which config-file mode
  // refuses outright — so a config file with an inverted band boots cleanly and silently disables the feature,
  // with no admin UI available to diagnose it. Deliberately NOT expressed as a Zod `.superRefine` on
  // FacialRecognitionConfigSchema/SystemConfigSchema: both are consumed by createZodDto and the OpenAPI
  // generator, and wrapping them turns them into a ZodEffects that can't be `.extend()`ed and may lose its
  // `.meta({ id })` — silently changing the generated spec. An explicit check here carries no such risk, and
  // reuses the same throw-vs-log split as the schema validation above.
  const { maxDistance: facialRecognitionMaxDistance, suggestions } = config.machineLearning.facialRecognition;
  if (suggestions.enabled && suggestions.maxDistance <= facialRecognitionMaxDistance) {
    const message = `Invalid system config: machineLearning.facialRecognition.suggestions.maxDistance (${suggestions.maxDistance}) must be greater than machineLearning.facialRecognition.maxDistance (${facialRecognitionMaxDistance}), otherwise no faces can ever be suggested.`;
    if (configFile) {
      throw new Error(message);
    }
    logger.error(message);
  }

  if (config.server.externalDomain.length > 0) {
    const domain = new URL(config.server.externalDomain);

    const externalDomain =
      domain.password && domain.username
        ? `${domain.protocol}//${domain.username}:${domain.password}@${domain.host}`
        : domain.origin;

    config.server.externalDomain = externalDomain;
  }

  if (!config.ffmpeg.acceptedVideoCodecs.includes(config.ffmpeg.targetVideoCodec)) {
    config.ffmpeg.acceptedVideoCodecs.push(config.ffmpeg.targetVideoCodec);
  }

  if (!config.ffmpeg.acceptedAudioCodecs.includes(config.ffmpeg.targetAudioCodec)) {
    config.ffmpeg.acceptedAudioCodecs.push(config.ffmpeg.targetAudioCodec);
  }

  return config;
};
