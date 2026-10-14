import { cloneDeep, get, isObject, set } from 'lodash-es';
import { SystemConfig, defaults } from 'src/dtos/config.dto.js';
import { unsetDeep } from 'src/utils/misc.js';

// Gallery fork rewrites of stored system config, applied by buildConfig in src/utils/config.ts.

const LEGACY_PET_MODEL_PREFIX = 'yolo';
const DEFAULT_PET_MODEL = 'rfdetr-nano';

/**
 * Pet detection moved from YOLO11 to RF-DETR. Installs that persisted a `yolo*`
 * model name would otherwise keep requesting a model the ML service no longer
 * knows how to build, so rewrite it to the current default on read. Applied in
 * `buildConfig` rather than in the Zod schema on purpose: transforming the DTO
 * field would change the generated OpenAPI types and force an SDK regeneration.
 */
export const migrateLegacyPetDetectionModel = (config: SystemConfig): SystemConfig => {
  const { petDetection } = config.machineLearning;
  if (petDetection.modelName.toLowerCase().startsWith(LEGACY_PET_MODEL_PREFIX)) {
    petDetection.modelName = DEFAULT_PET_MODEL;
  }

  return config;
};

// Typed as `string` rather than left as an inferred literal: lodash's `get` overload resolution
// picks a path-walking `GetFieldType<TObject, TPath>` for literal `TPath` string types, which
// resolves to `undefined` against the generic `object` type `isObject` narrows to below. Widening
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
  if (!isObject(partial) || get(partial, LEGACY_SUGGESTION_PATH) === undefined) {
    return partial;
  }

  const folded = cloneDeep(partial);
  const legacy = get(folded, LEGACY_SUGGESTION_PATH) as number;
  unsetDeep(folded, LEGACY_SUGGESTION_PATH);

  if (get(folded, SUGGESTIONS_PATH) === undefined) {
    const maxDistance =
      (get(folded, 'machineLearning.facialRecognition.maxDistance') as number | undefined) ??
      defaults.machineLearning.facialRecognition.maxDistance;

    set(folded, SUGGESTIONS_PATH, {
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
  if (get(partial, SUGGESTIONS_MAX_DISTANCE_PATH) !== undefined) {
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
  const config = cloneDeep(merged);
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
