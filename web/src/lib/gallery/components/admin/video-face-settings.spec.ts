import type { AdminConfigDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
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
        ...(video && { video: { enabled: false, sampleInterval: 2, sceneDetection: true, maxFrames: 1800, ...video } }),
      },
    },
  }) as unknown as AdminConfigDto;

describe('VideoFaceSettings', () => {
  it('shows the switch and keeps the tuning fields disabled until the feature is on', () => {
    const config = makeConfig({});
    render(VideoFaceSettings, { configToEdit: makeConfig({}), config, disabled: false });

    expect(screen.getByRole('switch', { name: 'admin.machine_learning_video_faces_setting' })).toBeEnabled();
    expect(screen.getByRole('spinbutton', { name: 'admin.machine_learning_video_faces_interval' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'admin.machine_learning_video_faces_max_frames' })).toBeDisabled();
  });

  it('enables the tuning fields when the feature is on', () => {
    render(VideoFaceSettings, { configToEdit: makeConfig({ enabled: true }), config: makeConfig({}), disabled: false });

    expect(screen.getByRole('spinbutton', { name: 'admin.machine_learning_video_faces_interval' })).toBeEnabled();
  });

  it('cannot be turned on while facial recognition is off', () => {
    render(VideoFaceSettings, { configToEdit: makeConfig({}, false), config: makeConfig({}), disabled: false });

    expect(screen.getByRole('switch', { name: 'admin.machine_learning_video_faces_setting' })).toBeDisabled();
  });

  it('renders nothing against an older server that sends no video block', () => {
    render(VideoFaceSettings, { configToEdit: makeConfig(), config: makeConfig(), disabled: false });

    expect(
      screen.queryByRole('switch', { name: 'admin.machine_learning_video_faces_setting' }),
    ).not.toBeInTheDocument();
  });
});
