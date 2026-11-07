import DataSaverVideoSettings from '#lib/gallery/components/admin/data-saver-video-settings.svelte';
import { MockRouter } from '#test/unit/mocks/router.ts';
import { DataSaverVideoCodec, DataSaverVideoResolution, type AdminConfigDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

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
  await page.getByText('admin.transcoding_data_saver', { exact: true }).click();
};

describe('DataSaverVideoSettings', () => {
  // The settings accordion records its open state in the URL through `goto`, which the global
  // `$app/navigation` fake routes to the active mock router. The accordion also closes (and so
  // navigates) as it unmounts, so the component is unmounted while the router is still active.
  const router = new MockRouter();
  let mounted: Awaited<ReturnType<typeof render>> | undefined;
  const renderSettings = async (props: Parameters<typeof render<typeof DataSaverVideoSettings>>[1]) => {
    mounted = await render(DataSaverVideoSettings, props);
  };
  beforeEach(() => router.setup());
  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
    router.teardown();
  });

  it('renders the switch, codec, resolution and cap', async () => {
    await renderSettings({ configToEdit: makeConfig(), config: makeConfig(), disabled: false });
    await open();

    await expect.element(page.getByText('admin.transcoding_data_saver_enabled', { exact: true })).toBeInTheDocument();
    await expect
      .element(page.getByText('admin.transcoding_data_saver_video_codec', { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText('admin.transcoding_data_saver_resolution', { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText('admin.transcoding_data_saver_max_bitrate', { exact: true }))
      .toBeInTheDocument();
  });

  it('turns the feature on in the bound config', async () => {
    const configToEdit = makeConfig();
    await renderSettings({ configToEdit, config: makeConfig(), disabled: false });
    await open();

    await page.getByRole('switch').click();

    expect(configToEdit.ffmpeg.dataSaver.enabled).toBe(true);
  });

  it('locks the copy settings while the feature is off', async () => {
    await renderSettings({
      configToEdit: makeConfig(false),
      config: makeConfig(false),
      disabled: false,
    });
    await open();

    await expect.element(page.getByRole('textbox')).toBeDisabled();
    const selects = page.getByRole('combobox').elements();
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      await expect.element(page.elementLocator(select)).toBeDisabled();
    }
  });

  it('unlocks them once it is on', async () => {
    await renderSettings({ configToEdit: makeConfig(true), config: makeConfig(true), disabled: false });
    await open();

    await expect.element(page.getByRole('textbox')).toBeEnabled();
    const selects = page.getByRole('combobox').elements();
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      await expect.element(page.elementLocator(select)).toBeEnabled();
    }
  });

  it('disables everything when the config comes from a file', async () => {
    await renderSettings({ configToEdit: makeConfig(true), config: makeConfig(true), disabled: true });
    await open();

    await expect.element(page.getByRole('switch')).toBeDisabled();
    await expect.element(page.getByRole('textbox')).toBeDisabled();
  });
});
