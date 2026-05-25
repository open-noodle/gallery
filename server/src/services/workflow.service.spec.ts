import { BadRequestException } from '@nestjs/common';
import { WorkflowTrigger, WorkflowType } from 'src/enum';
import { WorkflowService } from 'src/services/workflow.service';
import { factory, newUuid } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

const workflow = (overrides: Record<string, unknown> = {}) => ({
  id: newUuid(),
  trigger: WorkflowTrigger.AssetCreate,
  name: 'Test Workflow',
  description: 'A test workflow',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  enabled: true,
  steps: [],
  ...overrides,
});

describe(WorkflowService.name, () => {
  let sut: WorkflowService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(WorkflowService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  it('returns available workflow triggers', () => {
    expect(sut.getTriggers()).toEqual([
      { trigger: WorkflowTrigger.AssetCreate, types: [WorkflowType.AssetV1] },
      { trigger: WorkflowTrigger.PersonRecognized, types: [WorkflowType.AssetPersonV1] },
    ]);
  });

  it('scopes workflow search to the authenticated user', async () => {
    const auth = factory.auth();
    const item = workflow({ name: 'mine' });
    mocks.workflow.search.mockResolvedValue([item as any]);

    await expect(sut.search(auth, { enabled: true })).resolves.toEqual([
      expect.objectContaining({ id: item.id, name: 'mine' }),
    ]);

    expect(mocks.workflow.search).toHaveBeenCalledWith({ enabled: true, ownerId: auth.user.id });
  });

  it('creates a workflow with validated plugin method steps', async () => {
    const auth = factory.auth();
    const pluginMethodId = newUuid();
    mocks.plugin.getForValidation.mockResolvedValue([
      { id: pluginMethodId, pluginName: 'immich-core', name: 'asset-file', types: [WorkflowType.AssetV1] },
    ]);
    mocks.workflow.create.mockResolvedValue(
      workflow({
        name: 'Archive uploads',
        steps: [
          {
            pluginName: 'immich-core',
            methodName: 'asset-file',
            config: { extensions: ['jpg'] },
            enabled: true,
          },
        ],
      }) as any,
    );

    const result = await sut.create(auth, {
      trigger: WorkflowTrigger.AssetCreate,
      name: 'Archive uploads',
      steps: [{ method: 'immich-core#asset-file', config: { extensions: ['jpg'] } }],
    });

    expect(result).toEqual(
      expect.objectContaining({
        name: 'Archive uploads',
        trigger: WorkflowTrigger.AssetCreate,
        steps: [],
      }),
    );
    expect(mocks.workflow.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: auth.user.id,
        trigger: WorkflowTrigger.AssetCreate,
        name: 'Archive uploads',
      }),
      [{ pluginMethodId, config: { extensions: ['jpg'] }, enabled: true }],
    );
  });

  it('rejects an unknown plugin method', async () => {
    const auth = factory.auth();
    mocks.plugin.getForValidation.mockResolvedValue([]);

    await expect(
      sut.create(auth, {
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'missing#method', config: null }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mocks.workflow.create).not.toHaveBeenCalled();
  });

  it('rejects plugin methods incompatible with the workflow trigger', async () => {
    const auth = factory.auth();
    mocks.plugin.getForValidation.mockResolvedValue([
      { id: newUuid(), pluginName: 'immich-core', name: 'asset-file', types: [WorkflowType.AssetV1] },
    ]);

    await expect(
      sut.create(auth, {
        trigger: WorkflowTrigger.PersonRecognized,
        steps: [{ method: 'immich-core#asset-file', config: null }],
      }),
    ).rejects.toThrow(/incompatible with workflow trigger/);

    expect(mocks.workflow.create).not.toHaveBeenCalled();
  });

  it('requires access before updating and deleting workflows', async () => {
    const auth = factory.auth();
    const id = newUuid();
    mocks.access.workflow.checkOwnerAccess.mockResolvedValue(new Set([id]));
    mocks.workflow.get.mockResolvedValue(workflow({ id }) as any);
    mocks.workflow.update.mockResolvedValue(workflow({ id, name: 'Updated' }) as any);
    mocks.workflow.delete.mockResolvedValue();

    await sut.update(auth, id, { name: 'Updated' });
    await sut.delete(auth, id);

    expect(mocks.access.workflow.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([id]));
    expect(mocks.workflow.update).toHaveBeenCalledWith(id, { name: 'Updated' }, undefined);
    expect(mocks.workflow.delete).toHaveBeenCalledWith(id);
  });
});
