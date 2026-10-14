import { GalleryPluginService } from 'src/gallery/services/gallery-plugin.service.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(GalleryPluginService.name, () => {
  let sut: GalleryPluginService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(GalleryPluginService));
  });

  it('warns with the re-enable SQL when the gallery-core row exists but is disabled', async () => {
    mocks.plugin.getByName.mockResolvedValue({ name: 'gallery-core' } as any);
    mocks.plugin.getForLoad.mockResolvedValue([{ name: 'immich-plugin-core' }] as any);

    await sut.onPluginLoad();

    expect(mocks.plugin.getByName).toHaveBeenCalledWith('gallery-core');
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE plugin SET enabled = true WHERE name = 'gallery-core';"),
    );
  });

  it('stays quiet when the plugin is enabled', async () => {
    mocks.plugin.getByName.mockResolvedValue({ name: 'gallery-core' } as any);
    mocks.plugin.getForLoad.mockResolvedValue([{ name: 'gallery-core' }] as any);

    await sut.onPluginLoad();

    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });

  it('stays quiet when the plugin was never imported', async () => {
    mocks.plugin.getByName.mockResolvedValue(undefined);

    await sut.onPluginLoad();

    expect(mocks.plugin.getForLoad).not.toHaveBeenCalled();
    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });
});
