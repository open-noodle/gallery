import type { AdminConfigDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import VideoFaceSettings from './video-face-settings.svelte';

const makeConfig = (
  video?: Partial<AdminConfigDto['machineLearning']['facialRecognition']['video']>,
  recognition = true,
) =>
  ({
    machineLearning: {
      enabled: true,
      facialRecognition: {
        enabled: recognition,
        ...(video && {
          video: {
            enabled: false,
            sampleInterval: 2,
            sceneDetection: true,
            maxFrames: 1800,
            tiledDetection: false,
            maxDistance: 0.5,
            minFaceSize: 20,
            minSightings: 1,
            createPeople: true,
            ...video,
          },
        }),
      },
    },
  }) as unknown as AdminConfigDto;

/**
The number field whose `<label for>` reads `label`. SettingInputField also sets `aria-labelledby` to an
id nothing carries, which Chromium's accessible-name computation honours, so the field has no
accessible name and `getByRole('spinbutton', { name })` cannot find it. Reach it through the label's
`for` target instead, and check it is the number input the role query used to match.
*/
const numberField = (label: string) => {
  const input = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(label)}"]`)?.control;
  expect(input).toBeInstanceOf(HTMLInputElement);
  expect((input as HTMLInputElement).type).toBe('number');
  return page.elementLocator(input!);
};

describe('VideoFaceSettings', () => {
  it('shows the switch and keeps the tuning fields disabled until the feature is on', async () => {
    const config = makeConfig({});
    await render(VideoFaceSettings, { configToEdit: makeConfig({}), config, disabled: false });

    await expect
      .element(page.getByRole('switch', { name: 'admin.machine_learning_video_faces_setting' }))
      .toBeEnabled();
    await expect.element(numberField('admin.machine_learning_video_faces_interval')).toBeDisabled();
    await expect.element(numberField('admin.machine_learning_video_faces_max_frames')).toBeDisabled();
  });

  it('enables the tuning fields when the feature is on', async () => {
    await render(VideoFaceSettings, {
      configToEdit: makeConfig({ enabled: true }),
      config: makeConfig({}),
      disabled: false,
    });

    await expect.element(numberField('admin.machine_learning_video_faces_interval')).toBeEnabled();
  });

  it('cannot be turned on while facial recognition is off', async () => {
    await render(VideoFaceSettings, { configToEdit: makeConfig({}, false), config: makeConfig({}), disabled: false });

    await expect
      .element(page.getByRole('switch', { name: 'admin.machine_learning_video_faces_setting' }))
      .toBeDisabled();
  });

  it('shows the same-person and filtering settings, enabled with the feature', async () => {
    await render(VideoFaceSettings, {
      configToEdit: makeConfig({ enabled: true }),
      config: makeConfig({}),
      disabled: false,
    });

    await expect.element(numberField('admin.machine_learning_video_faces_max_distance')).toBeEnabled();
    await expect.element(numberField('admin.machine_learning_video_faces_min_face_size')).toBeEnabled();
    await expect.element(numberField('admin.machine_learning_video_faces_min_sightings')).toBeEnabled();
    await expect
      .element(page.getByRole('switch', { name: 'admin.machine_learning_video_faces_create_people' }))
      .toBeEnabled();
  });

  it('hides the settings an older server does not send', async () => {
    const older = () => {
      const config = makeConfig({});
      const video = config.machineLearning.facialRecognition.video as Partial<
        AdminConfigDto['machineLearning']['facialRecognition']['video']
      >;
      delete video.maxDistance;
      delete video.minFaceSize;
      delete video.minSightings;
      delete video.createPeople;
      return config;
    };
    await render(VideoFaceSettings, { configToEdit: older(), config: older(), disabled: false });

    await expect.element(numberField('admin.machine_learning_video_faces_interval')).toBeInTheDocument();
    expect(document.querySelector('label[for="admin.machine_learning_video_faces_max_distance"]')).toBeNull();
    expect(page.getByRole('switch', { name: 'admin.machine_learning_video_faces_create_people' }).query()).toBeNull();
  });

  it('renders nothing against an older server that sends no video block', async () => {
    await render(VideoFaceSettings, { configToEdit: makeConfig(), config: makeConfig(), disabled: false });

    expect(page.getByRole('switch', { name: 'admin.machine_learning_video_faces_setting' }).query()).toBeNull();
  });
});
