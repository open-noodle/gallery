import type { AdminConfigDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import VideoPetSettings from './video-pet-settings.svelte';

const makeConfig = (video?: Partial<AdminConfigDto['machineLearning']['petDetection']['video']>, detection = true) =>
  ({
    machineLearning: {
      enabled: true,
      petDetection: {
        enabled: detection,
        modelName: 'rfdetr-nano',
        minScore: 0.3,
        ...(video && {
          video: {
            enabled: false,
            sampleInterval: 2,
            sceneDetection: true,
            maxFrames: 900,
            maxDistance: 0.55,
            minSightings: 2,
            ...video,
          },
        }),
      },
    },
  }) as unknown as AdminConfigDto;

/** The number field whose `<label for>` reads `label` (see video-face-settings.spec.ts for why not by role). */
const numberField = (label: string) => {
  const input = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(label)}"]`)?.control;
  expect(input).toBeInstanceOf(HTMLInputElement);
  expect((input as HTMLInputElement).type).toBe('number');
  return page.elementLocator(input!);
};

describe('VideoPetSettings', () => {
  it('shows the switch and keeps the tuning fields disabled until the feature is on', async () => {
    await render(VideoPetSettings, { configToEdit: makeConfig({}), config: makeConfig({}), disabled: false });

    await expect.element(page.getByRole('switch', { name: 'admin.machine_learning_video_pets_setting' })).toBeEnabled();
    await expect.element(numberField('admin.machine_learning_video_faces_interval')).toBeDisabled();
    await expect.element(numberField('admin.machine_learning_video_pets_max_distance')).toBeDisabled();
  });

  it('enables the tuning fields when the feature is on', async () => {
    await render(VideoPetSettings, {
      configToEdit: makeConfig({ enabled: true }),
      config: makeConfig({}),
      disabled: false,
    });

    await expect.element(numberField('admin.machine_learning_video_faces_interval')).toBeEnabled();
    await expect.element(numberField('admin.machine_learning_video_faces_max_frames')).toBeEnabled();
    await expect.element(numberField('admin.machine_learning_video_pets_max_distance')).toBeEnabled();
    await expect.element(numberField('admin.machine_learning_video_pets_min_sightings')).toBeEnabled();
  });

  it('cannot be turned on while pet detection is off', async () => {
    await render(VideoPetSettings, { configToEdit: makeConfig({}, false), config: makeConfig({}), disabled: false });

    await expect
      .element(page.getByRole('switch', { name: 'admin.machine_learning_video_pets_setting' }))
      .toBeDisabled();
  });

  it('renders nothing against an older server that sends no video block', async () => {
    await render(VideoPetSettings, { configToEdit: makeConfig(), config: makeConfig(), disabled: false });

    expect(page.getByRole('switch', { name: 'admin.machine_learning_video_pets_setting' }).query()).toBeNull();
  });
});
