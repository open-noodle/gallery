import type { AdminConfigDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MachineLearningSettings from './MachineLearningSettings.svelte';

type FacialRecognitionOverrides = Partial<
  Omit<AdminConfigDto['machineLearning']['facialRecognition'], 'suggestions'> & {
    suggestions: Partial<AdminConfigDto['machineLearning']['facialRecognition']['suggestions']>;
  }
>;

const makeMachineLearningConfig = (facialRecognitionOverrides: FacialRecognitionOverrides = {}): AdminConfigDto =>
  ({
    machineLearning: {
      enabled: true,
      urls: ['http://localhost:3003'],
      availabilityChecks: { enabled: true, interval: 5, timeout: 30 },
      clip: { enabled: true, modelName: 'ViT-B-32__openai', maxDistance: 0.5 },
      duplicateDetection: { enabled: true, maxDistance: 0.01 },
      facialRecognition: {
        enabled: true,
        modelName: 'buffalo_l',
        minScore: 0.7,
        maxDistance: 0.5,
        minFaces: 3,
        ...facialRecognitionOverrides,
        suggestions: {
          enabled: false,
          maxDistance: 0.7,
          ...facialRecognitionOverrides.suggestions,
        },
      },
      ocr: {
        enabled: false,
        modelName: 'PP-OCRv5_mobile',
        minDetectionScore: 0.3,
        minRecognitionScore: 0.5,
        maxResolution: 736,
      },
      petDetection: { enabled: false, modelName: 'yolo11s', minScore: 0.7 },
    },
  }) as unknown as AdminConfigDto;

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false, duplicateDetection: true },
  systemConfig: {} as AdminConfigDto,
  defaultSystemConfig: {} as AdminConfigDto,
  cloneValue: vi.fn(),
  cloneDefaultValue: vi.fn(),
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: {
    get value() {
      return mocks.featureFlags;
    },
  } as never,
}));

vi.mock(import('$lib/managers/system-config-manager.svelte'), () => ({
  systemConfigManager: {
    get value() {
      return mocks.systemConfig;
    },
    get defaultValue() {
      return mocks.defaultSystemConfig;
    },
    cloneValue: mocks.cloneValue,
    cloneDefaultValue: mocks.cloneDefaultValue,
  } as never,
}));

// SettingAccordion drives open/close through accordionManager (which navigates via goto);
// stub it to keep the facial-recognition section open and avoid SvelteKit navigation in tests.
vi.mock(import('$lib/managers/accordion-manager.svelte'), () => ({
  accordionManager: {
    isOpen: (key: string) => key === 'facial-recognition',
    open: vi.fn(),
    close: vi.fn(),
  } as never,
}));

vi.mock(import('$lib/services/system-config.service'), () => ({
  handleSystemConfigSave: vi.fn(),
}));

// SettingInputField sets both `id` and the paired `<label for>` to the raw label string, but it also
// unconditionally sets `aria-labelledby="{label}-label"` on the input — an id this component never
// actually renders anywhere. That pre-existing (unrelated) quirk makes @testing-library's
// `getByLabelText` unreliable for any SettingInputField in this codebase: it prioritizes the dangling
// aria-labelledby over the real for/id association and reports the input as "non-labellable". Read the
// field directly by its (stable, app-assigned) DOM id instead of fighting that helper.
// The id is a dotted i18n key, so it must be matched as a quoted attribute value rather than a
// (dot-sensitive) CSS id selector.
const getSuggestionMaxDistanceInput = () =>
  document.querySelector('[id="admin.machine_learning_suggestion_max_distance"]') as HTMLInputElement;

describe('MachineLearningSettings face suggestions auto-fill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags = { configFile: false, duplicateDetection: true };
    mocks.systemConfig = makeMachineLearningConfig();
    mocks.defaultSystemConfig = makeMachineLearningConfig();
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));
    mocks.cloneDefaultValue.mockImplementation(() => structuredClone(mocks.defaultSystemConfig));
  });

  it('does not rewrite the displayed distance in config-file (disabled) mode, even when the loaded config already violates the invariant', async () => {
    // Config-file-sourced configs are validated only against the structural schema on boot, so this
    // combination (suggestions.maxDistance <= facialRecognition.maxDistance) is genuinely reachable.
    mocks.featureFlags.configFile = true;
    mocks.systemConfig = makeMachineLearningConfig({
      maxDistance: 0.6,
      suggestions: { enabled: true, maxDistance: 0.5 },
    });
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    render(MachineLearningSettings);

    // Give any (incorrectly unguarded) effect a chance to run before asserting it did not fire.
    await waitFor(() => expect(getSuggestionMaxDistanceInput()).toHaveValue(0.5));
  });

  it('auto-fills the distance to recognition distance + 0.2 when enabling with a sub-threshold band', async () => {
    const user = userEvent.setup();
    mocks.systemConfig = makeMachineLearningConfig({
      maxDistance: 0.5,
      suggestions: { enabled: false, maxDistance: 0.3 },
    });
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    render(MachineLearningSettings);

    await user.click(screen.getByRole('switch', { name: 'admin.machine_learning_face_suggestions_setting' }));

    await waitFor(() => expect(getSuggestionMaxDistanceInput()).toHaveValue(0.7));
  });

  it('leaves the distance untouched when enabling with a value that already exceeds the recognition distance', async () => {
    const user = userEvent.setup();
    mocks.systemConfig = makeMachineLearningConfig({
      maxDistance: 0.5,
      suggestions: { enabled: false, maxDistance: 0.9 },
    });
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    render(MachineLearningSettings);

    await user.click(screen.getByRole('switch', { name: 'admin.machine_learning_face_suggestions_setting' }));

    await waitFor(() => expect(getSuggestionMaxDistanceInput()).toHaveValue(0.9));
  });

  // S12.14: manually typing a value into the (already-enabled) field and then cycling the
  // suggestions switch off/on must not let the auto-fill effect clobber the admin's choice.
  it('preserves a manually-entered suggestions.maxDistance across a suggestions off/on cycle', async () => {
    const user = userEvent.setup();
    mocks.systemConfig = makeMachineLearningConfig({
      maxDistance: 0.5,
      suggestions: { enabled: true, maxDistance: 0.7 },
    });
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    render(MachineLearningSettings);

    const input = getSuggestionMaxDistanceInput();
    await user.clear(input);
    await user.type(input, '0.55');
    await waitFor(() => expect(getSuggestionMaxDistanceInput()).toHaveValue(0.55));

    const suggestionsSwitch = screen.getByRole('switch', { name: 'admin.machine_learning_face_suggestions_setting' });
    await user.click(suggestionsSwitch);
    await waitFor(() => expect(suggestionsSwitch).not.toBeChecked());
    await user.click(suggestionsSwitch);
    await waitFor(() => expect(suggestionsSwitch).toBeChecked());

    // Positive control in the same body: an unset (invariant-violating) value is still auto-filled
    // on the very same off/on cycle path, so this isn't merely "the effect never runs".
    expect(getSuggestionMaxDistanceInput()).toHaveValue(0.55);
  });

  // "Unset" reaches the form as `undefined` (a partial/legacy config that never wrote this key), not
  // `0` — and `undefined <= maxDistance` is always `false`, so a naive numeric-violation check alone
  // silently skips it. The invariant-violation branch (0.3) is the positive control in the same suite.
  it('auto-fills a genuinely unset (undefined) suggestions.maxDistance on enable', async () => {
    const user = userEvent.setup();
    mocks.systemConfig = makeMachineLearningConfig({
      maxDistance: 0.5,
      suggestions: { enabled: false, maxDistance: undefined as unknown as number },
    });
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    render(MachineLearningSettings);

    await user.click(screen.getByRole('switch', { name: 'admin.machine_learning_face_suggestions_setting' }));

    await waitFor(() => expect(getSuggestionMaxDistanceInput()).toHaveValue(0.7));
  });

  it('still auto-fills an invariant-violating value across the same off/on cycle', async () => {
    const user = userEvent.setup();
    mocks.systemConfig = makeMachineLearningConfig({
      maxDistance: 0.5,
      suggestions: { enabled: true, maxDistance: 0.3 },
    });
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    render(MachineLearningSettings);

    const suggestionsSwitch = screen.getByRole('switch', { name: 'admin.machine_learning_face_suggestions_setting' });
    await user.click(suggestionsSwitch);
    await waitFor(() => expect(suggestionsSwitch).not.toBeChecked());
    await user.click(suggestionsSwitch);
    await waitFor(() => expect(suggestionsSwitch).toBeChecked());

    await waitFor(() => expect(getSuggestionMaxDistanceInput()).toHaveValue(0.7));
  });
});

describe('MachineLearningSettings suggestions toggle availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags = { configFile: false, duplicateDetection: true };
    mocks.systemConfig = makeMachineLearningConfig();
    mocks.defaultSystemConfig = makeMachineLearningConfig();
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));
    mocks.cloneDefaultValue.mockImplementation(() => structuredClone(mocks.defaultSystemConfig));
  });

  // S12.13: the server deliberately supports suggestions with the ML master switch off
  // (server/src/utils/misc.ts, pinned by person.service.spec.ts) — the client must not block it.
  it('keeps the suggestions toggle enabled when the ML master switch is off', () => {
    mocks.systemConfig = makeMachineLearningConfig();
    mocks.systemConfig.machineLearning.enabled = false;
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    render(MachineLearningSettings);

    expect(screen.getByRole('switch', { name: 'admin.machine_learning_face_suggestions_setting' })).not.toBeDisabled();
  });

  it('disables the suggestions toggle when facial recognition itself is off (positive control)', () => {
    mocks.systemConfig = makeMachineLearningConfig({ enabled: false });
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));

    render(MachineLearningSettings);

    expect(screen.getByRole('switch', { name: 'admin.machine_learning_face_suggestions_setting' })).toBeDisabled();
  });
});
