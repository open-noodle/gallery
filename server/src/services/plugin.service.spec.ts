import { WorkflowTrigger } from '@immich/plugin-sdk';
import { BadRequestException } from '@nestjs/common';
import { WorkflowType } from 'src/enum';
import { PluginService } from 'src/services/plugin.service';
import { newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

const plugin = (overrides: Record<string, unknown> = {}) => ({
  id: newUuid(),
  name: 'immich-core',
  title: 'Immich Core',
  description: 'Built-in workflow helpers',
  author: 'Immich',
  version: '1.0.0',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  methods: [],
  ...overrides,
});

const method = (overrides: Record<string, unknown> = {}) => ({
  id: newUuid(),
  pluginId: newUuid(),
  pluginName: 'immich-core',
  name: 'asset-file',
  title: 'Asset file',
  description: 'Filter by asset file',
  types: [WorkflowType.AssetV1],
  schema: null,
  hostFunctions: false,
  uiHints: [],
  ...overrides,
});

describe(PluginService.name, () => {
  let sut: PluginService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(PluginService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  it('maps plugin search results', async () => {
    const item = plugin({ methods: [method()] });
    mocks.plugin.search.mockResolvedValue([item as any]);

    await expect(sut.search({ name: 'immich-core' })).resolves.toEqual([
      expect.objectContaining({
        id: item.id,
        name: 'immich-core',
        methods: [expect.objectContaining({ key: 'immich-core#asset-file' })],
      }),
    ]);

    expect(mocks.plugin.search).toHaveBeenCalledWith({ name: 'immich-core' });
  });

  it('throws when a plugin cannot be found', async () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    mocks.plugin.get.mockResolvedValue(undefined);

    await expect(sut.get(newUuid())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters plugin methods by workflow trigger compatibility', async () => {
    const assetMethod = method({ name: 'asset-file', types: [WorkflowType.AssetV1] });
    const incompatibleMethod = method({ name: 'untyped-file', types: [] });
    mocks.plugin.searchMethods.mockResolvedValue([assetMethod, incompatibleMethod] as any);

    await expect(sut.searchMethods({ trigger: WorkflowTrigger.AssetCreate })).resolves.toEqual([
      expect.objectContaining({ key: 'immich-core#asset-file' }),
    ]);

    expect(mocks.plugin.searchMethods).toHaveBeenCalledWith({ trigger: WorkflowTrigger.AssetCreate });
  });
});
