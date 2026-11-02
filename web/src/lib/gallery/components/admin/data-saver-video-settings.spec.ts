import { DataSaverVideoCodec, DataSaverVideoResolution, type AdminConfigDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import DataSaverVideoSettings from '$lib/gallery/components/admin/data-saver-video-settings.svelte';

const makeConfig = (enabled = false) =>
  ({
    ffmpeg: {
      dataSaver: {
        enabled,
        targetVideoCodec: DataSaverVideoCodec.Hevc,
        targetResolution: DataSaverVideoResolution.$720,
        maxBitrate: '1500k',
      },
    },
  }) as AdminConfigDto;

const open = async () => {
  await fireEvent.click(screen.getByText('admin.transcoding_data_saver'));
};

describe('DataSaverVideoSettings', () => {
  it('renders the switch, codec, resolution and cap', async () => {
    render(DataSaverVideoSettings, { configToEdit: makeConfig(), config: makeConfig(), disabled: false });
    await open();

    expect(screen.getByText('admin.transcoding_data_saver_enabled')).toBeInTheDocument();
    expect(screen.getByText('admin.transcoding_data_saver_video_codec')).toBeInTheDocument();
    expect(screen.getByText('admin.transcoding_data_saver_resolution')).toBeInTheDocument();
    expect(screen.getByText('admin.transcoding_data_saver_max_bitrate')).toBeInTheDocument();
  });

  it('turns the feature on in the bound config', async () => {
    const configToEdit = makeConfig();
    render(DataSaverVideoSettings, { configToEdit, config: makeConfig(), disabled: false });
    await open();

    await fireEvent.click(screen.getByRole('switch'));

    expect(configToEdit.ffmpeg.dataSaver.enabled).toBe(true);
  });

  it('locks the copy settings while the feature is off', async () => {
    render(DataSaverVideoSettings, { configToEdit: makeConfig(false), config: makeConfig(false), disabled: false });
    await open();

    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toBeDisabled();
    }
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('unlocks them once it is on', async () => {
    render(DataSaverVideoSettings, { configToEdit: makeConfig(true), config: makeConfig(true), disabled: false });
    await open();

    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toBeEnabled();
    }
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('disables everything when the config comes from a file', async () => {
    render(DataSaverVideoSettings, { configToEdit: makeConfig(true), config: makeConfig(true), disabled: true });
    await open();

    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
