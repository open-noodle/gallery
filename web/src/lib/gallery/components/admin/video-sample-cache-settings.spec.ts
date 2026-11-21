import VideoSampleCacheSettings from '#lib/gallery/components/admin/video-sample-cache-settings.svelte';
import type { AdminConfigServerDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

const makeServer = (settings?: { maxSizeGiB: number; retentionHours: number }) =>
  ({ ...(settings && { videoSampleCache: settings }) }) as AdminConfigServerDto;

const numberField = (label: string) => {
  const input = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(label)}"]`)?.control;
  expect(input).toBeInstanceOf(HTMLInputElement);
  return page.elementLocator(input!);
};

describe('VideoSampleCacheSettings', () => {
  it('shows current values and binds edits including zero to the server settings draft', async () => {
    const server = makeServer({ maxSizeGiB: 2, retentionHours: 24 });
    await render(VideoSampleCacheSettings, { server, saved: structuredClone(server), disabled: false });
    const size = numberField('admin.video_sample_cache_size');
    const retention = numberField('admin.video_sample_cache_retention');
    await expect.element(size).toHaveValue(2);
    await expect.element(retention).toHaveValue(24);
    await size.fill('0');
    await retention.fill('72');
    await userEvent.tab();
    expect(server.videoSampleCache).toEqual({ maxSizeGiB: 0, retentionHours: 72 });
  });

  it('disables both controls when settings come from a config file', async () => {
    const server = makeServer({ maxSizeGiB: 2, retentionHours: 24 });
    await render(VideoSampleCacheSettings, { server, saved: server, disabled: true });
    await expect.element(numberField('admin.video_sample_cache_size')).toBeDisabled();
    await expect.element(numberField('admin.video_sample_cache_retention')).toBeDisabled();
  });

  it('hides the controls when an older server has no cache settings', async () => {
    await render(VideoSampleCacheSettings, { server: makeServer(), saved: makeServer(), disabled: false });
    expect(document.querySelector('input')).toBeNull();
  });
});
