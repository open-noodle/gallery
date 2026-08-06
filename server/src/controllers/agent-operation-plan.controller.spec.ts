// @nestjs/swagger 11.4+ no longer exports ./dist/constants; the metadata key is stable.
const DECORATORS = { API_RESPONSE: 'swagger/apiResponse' } as const;
import { AgentOperationPlanController } from 'src/controllers/agent-operation-plan.controller';
import {
  AgentOperationPlanApplyRequestDto,
  AgentOperationPlanApplyResponseDto,
  AgentOperationPlanResponseDto,
  AgentOperationPlanSummaryRequestDto,
  AgentOperationPlanToolResponseDto,
  AgentProposeAlbumOperationsDto,
  AgentReviseAlbumOperationsDto,
} from 'src/dtos/agent-operation.dto';
import {
  AgentOperationApplyStatus,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  Permission,
} from 'src/enum';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentOperationPlanController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentOperationPlanService, {
    args: [{} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never],
    strict: false,
  });
  const auth = AuthFactory.create();
  const sessionId = factory.uuid();
  const planId = factory.uuid();
  const operationId = factory.uuid();
  const assetId = factory.uuid();
  const createdAt = new Date('2026-05-15T12:00:00.000Z');
  const updatedAt = new Date('2026-05-15T12:00:01.000Z');
  const plan: AgentOperationPlanResponseDto = {
    id: planId,
    sessionId,
    revision: 1,
    status: AgentOperationPlanStatus.Proposed,
    summary: 'Portugal plan.',
    operations: [
      {
        id: operationId,
        planId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        targetId: null,
        temporaryTargetId: 'tmp-portugal',
        assetIds: [],
        payload: { albumName: 'Portugal' },
        dependencyIds: [],
        riskLevel: AgentOperationRiskLevel.Low,
        enabled: true,
        status: AgentOperationStatus.Proposed,
        result: null,
        error: null,
        createdAt,
        updatedAt,
      },
    ],
    createdAt,
    updatedAt,
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentOperationPlanController, [
      { provide: AgentOperationPlanService, useValue: service },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
    ctx.authenticate.mockResolvedValue(auth);
  });

  const expectPermission = (permission: Permission) => {
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission }),
      }),
    );
  };

  it.each([
    ['proposeAlbumOperations', AgentOperationPlanToolResponseDto, 'AgentOperationPlanToolResponseDto', 201],
    ['reviseProposedOperations', AgentOperationPlanToolResponseDto, 'AgentOperationPlanToolResponseDto', 201],
    ['summarizePlan', AgentOperationPlanToolResponseDto, 'AgentOperationPlanToolResponseDto', 201],
    ['applyApprovedOperations', AgentOperationPlanApplyResponseDto, 'AgentOperationPlanApplyResponseDto', 201],
  ] as const)('documents %s with a typed response DTO', (methodName, responseDto, schemaName, statusCode) => {
    const responses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      AgentOperationPlanController.prototype[methodName],
    ) as Record<number, { type?: unknown }> | undefined;

    expect(responses?.[statusCode]?.type).toBe(responseDto);
    expect(responseDto.name).toBe(schemaName);
  });

  it('documents getCurrentOperationPlan as a nullable plan response', () => {
    const responses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      AgentOperationPlanController.prototype.getCurrentOperationPlan,
    ) as Record<number, { schema?: unknown; type?: unknown }> | undefined;

    expect(responses?.[200]).toMatchObject({
      schema: {
        oneOf: [{ $ref: '#/components/schemas/AgentOperationPlanResponseDto' }, { type: 'null' }],
      },
    });
    expect(responses?.[200]?.type).toBeUndefined();
  });

  it('documents getAppliedOperationPlans as a typed plan array response', () => {
    const responses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      AgentOperationPlanController.prototype.getAppliedOperationPlans,
    ) as Record<number, { type?: unknown; isArray?: boolean }> | undefined;

    expect(responses?.[200]).toMatchObject({
      type: AgentOperationPlanResponseDto,
      isArray: true,
    });
  });

  describe('GET /agent/sessions/:id/operation-plan', () => {
    it('gets the current operation plan with read permission and serializes dates', async () => {
      service.getCurrentPlan.mockResolvedValue(plan);

      const { status, body } = await request(ctx.getHttpServer()).get(`/agent/sessions/${sessionId}/operation-plan`);

      expect(status).toBe(200);
      expectPermission(Permission.AgentSessionRead);
      expect(service.getCurrentPlan).toHaveBeenCalledWith(auth, sessionId);
      expect(body).toEqual({
        ...plan,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        operations: [
          {
            ...plan.operations[0],
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
          },
        ],
      });
    });

    it('returns the current operation plan directly from the controller method', async () => {
      service.getCurrentPlan.mockResolvedValue(plan);
      const controller = new AgentOperationPlanController(service);

      await expect(controller.getCurrentOperationPlan(auth, { id: sessionId })).resolves.toBe(plan);
    });

    it('returns null directly from the controller method when no current operation plan exists', async () => {
      service.getCurrentPlan.mockResolvedValue(null);
      const controller = new AgentOperationPlanController(service);

      await expect(controller.getCurrentOperationPlan(auth, { id: sessionId })).resolves.toBeNull();
    });

    it('returns 200 when no current operation plan exists', async () => {
      service.getCurrentPlan.mockResolvedValue(null);

      const { status, text } = await request(ctx.getHttpServer()).get(`/agent/sessions/${sessionId}/operation-plan`);

      expect(status).toBe(200);
      expect(text).toBe('');
      expect(service.getCurrentPlan).toHaveBeenCalledWith(auth, sessionId);
    });
  });

  describe('GET /agent/sessions/:id/operation-plan/applied', () => {
    it('gets applied operation plan history with read permission and serializes dates', async () => {
      const appliedPlan: AgentOperationPlanResponseDto = {
        ...plan,
        status: AgentOperationPlanStatus.Applied,
        operations: [
          { ...plan.operations[0], status: AgentOperationStatus.Applied, result: { albumId: factory.uuid() } },
        ],
      };
      service.getAppliedPlans.mockResolvedValue([appliedPlan]);

      const { status, body } = await request(ctx.getHttpServer()).get(
        `/agent/sessions/${sessionId}/operation-plan/applied`,
      );

      expect(status).toBe(200);
      expectPermission(Permission.AgentSessionRead);
      expect(service.getAppliedPlans).toHaveBeenCalledWith(auth, sessionId);
      expect(body).toEqual([
        {
          ...appliedPlan,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
          operations: [
            {
              ...appliedPlan.operations[0],
              createdAt: createdAt.toISOString(),
              updatedAt: updatedAt.toISOString(),
            },
          ],
        },
      ]);
    });

    it('returns applied operation plan history directly from the controller method', async () => {
      const appliedPlan = { ...plan, status: AgentOperationPlanStatus.Applied };
      service.getAppliedPlans.mockResolvedValue([appliedPlan]);
      const controller = new AgentOperationPlanController(service);

      await expect(controller.getAppliedOperationPlans(auth, { id: sessionId })).resolves.toEqual([appliedPlan]);
    });
  });

  describe('POST /agent/sessions/:id/operation-plan/proposals', () => {
    const dto: AgentProposeAlbumOperationsDto = {
      summary: 'Portugal plan.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal',
          payload: { albumName: 'Portugal', description: '' },
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    };

    it('proposes album operations with update permission', async () => {
      service.proposeAlbumOperations.mockResolvedValue({
        status: 'success',
        plan,
        toolCall: null,
        summary: 'Plan revision 1.',
      });

      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/proposals`)
        .send(dto);

      expect(status).toBe(201);
      expectPermission(Permission.AgentSessionUpdate);
      expect(service.proposeAlbumOperations).toHaveBeenCalledWith(auth, sessionId, dto);
    });

    it('validates proposal bodies before calling the service', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/proposals`)
        .send({ summary: 'Broken', operations: [] });

      expect(status).toBe(400);
      expect(service.proposeAlbumOperations).not.toHaveBeenCalled();
    });
  });

  describe('POST /agent/sessions/:id/operation-plan/:planId/revisions', () => {
    const dto: AgentReviseAlbumOperationsDto = {
      feedback: 'Use a shorter name.',
      summary: 'Revised Portugal plan.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal',
          payload: { albumName: 'Portugal', description: '' },
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    };

    it('revises a plan with update permission', async () => {
      service.reviseProposedOperations.mockResolvedValue({
        status: 'success',
        plan,
        toolCall: null,
        summary: 'Plan revision 2.',
      });

      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/revisions`)
        .send(dto);

      expect(status).toBe(201);
      expectPermission(Permission.AgentSessionUpdate);
      expect(service.reviseProposedOperations).toHaveBeenCalledWith(auth, sessionId, planId, dto);
    });

    it('validates revision params and body before calling the service', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/not-a-uuid/revisions`)
        .send({ ...dto, operations: [] });

      expect(status).toBe(400);
      expect(service.reviseProposedOperations).not.toHaveBeenCalled();
    });
  });

  describe('POST /agent/sessions/:id/operation-plan/:planId/summary', () => {
    const dto: AgentOperationPlanSummaryRequestDto = { focus: 'risk' };

    it('summarizes a plan with read permission', async () => {
      service.summarizePlan.mockResolvedValue({
        status: 'success',
        plan,
        toolCall: null,
        summary: 'Plan revision 1.',
      });

      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/summary`)
        .send(dto);

      expect(status).toBe(201);
      expectPermission(Permission.AgentSessionRead);
      expect(service.summarizePlan).toHaveBeenCalledWith(auth, sessionId, planId, dto);
    });

    it('validates summary params and body before calling the service', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/not-a-uuid/summary`)
        .send({ focus: '' });

      expect(status).toBe(400);
      expect(service.summarizePlan).not.toHaveBeenCalled();
    });
  });

  describe('POST /agent/sessions/:id/operation-plan/:planId/apply', () => {
    const dto: AgentOperationPlanApplyRequestDto = { operationIds: [operationId] };

    it('applies approved operations with update permission and serializes dates', async () => {
      service.applyApprovedOperations.mockResolvedValue({
        status: AgentOperationApplyStatus.Applied,
        plan: {
          ...plan,
          status: AgentOperationPlanStatus.Applied,
          operations: [
            { ...plan.operations[0], status: AgentOperationStatus.Applied, result: { albumId: factory.uuid() } },
          ],
        },
        appliedOperationIds: [operationId],
        skippedOperationIds: [],
        failedOperationIds: [],
        summary: 'Applied 1 operation(s), skipped 0, failed 0.',
      });

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/apply`)
        .send(dto);

      expect(status).toBe(201);
      expectPermission(Permission.AgentSessionUpdate);
      expect(service.applyApprovedOperations).toHaveBeenCalledWith(auth, sessionId, planId, dto);
      expect(body.plan.createdAt).toBe(createdAt.toISOString());
      expect(body.plan.operations[0].createdAt).toBe(createdAt.toISOString());
    });

    it('accepts sparse item selections and plan revision in the apply body', async () => {
      const dto: AgentOperationPlanApplyRequestDto = {
        operationIds: [operationId],
        itemSelections: {
          [operationId]: {
            itemKind: 'asset',
            mode: 'allExcept',
            itemIds: [assetId],
          },
        },
        planRevision: 1,
      };

      service.applyApprovedOperations.mockResolvedValue({
        status: AgentOperationApplyStatus.Applied,
        plan: {
          ...plan,
          status: AgentOperationPlanStatus.Applied,
          operations: [
            { ...plan.operations[0], status: AgentOperationStatus.Applied, result: { albumId: factory.uuid() } },
          ],
        },
        appliedOperationIds: [operationId],
        skippedOperationIds: [],
        failedOperationIds: [],
        summary: 'Applied 1 operation(s), skipped 0, failed 0.',
      });

      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/apply`)
        .send(dto);

      expect(status).toBe(201);
      expect(service.applyApprovedOperations).toHaveBeenCalledWith(auth, sessionId, planId, dto);
    });

    it('passes field overrides to the operation plan service', async () => {
      const dto: AgentOperationPlanApplyRequestDto = {
        operationIds: [operationId],
        itemSelections: {
          [operationId]: {
            itemKind: 'asset',
            mode: 'only',
            itemIds: [assetId],
          },
        },
        fieldOverrides: {
          [operationId]: {
            albumName: 'Edited Portugal',
          },
        },
        planRevision: 1,
      };

      service.applyApprovedOperations.mockResolvedValue({
        status: AgentOperationApplyStatus.Applied,
        plan: {
          ...plan,
          status: AgentOperationPlanStatus.Applied,
          operations: [{ ...plan.operations[0], status: AgentOperationStatus.Applied }],
        },
        appliedOperationIds: [operationId],
        skippedOperationIds: [],
        failedOperationIds: [],
        summary: 'Applied 1 operation(s), skipped 0, failed 0.',
      });

      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/apply`)
        .send(dto);

      expect(status).toBe(201);
      expect(service.applyApprovedOperations).toHaveBeenCalledWith(auth, sessionId, planId, dto);
    });

    it('validates apply params and body before calling the service', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/not-a-uuid/apply`)
        .send({ operationIds: [] });

      expect(status).toBe(400);
      expect(service.applyApprovedOperations).not.toHaveBeenCalled();
    });

    it('rejects invalid sparse item selections before calling the service', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/apply`)
        .send({
          operationIds: [operationId],
          itemSelections: {
            [operationId]: {
              itemKind: 'photo',
              mode: 'allExcept',
              itemIds: [assetId],
            },
          },
          planRevision: 1,
        });

      expect(status).toBe(400);
      expect(service.applyApprovedOperations).not.toHaveBeenCalled();
    });

    it('rejects duplicate sparse item ids before calling the service', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/apply`)
        .send({
          operationIds: [operationId],
          itemSelections: {
            [operationId]: {
              itemKind: 'asset',
              mode: 'only',
              itemIds: [assetId, assetId],
            },
          },
          planRevision: 1,
        });

      expect(status).toBe(400);
      expect(service.applyApprovedOperations).not.toHaveBeenCalled();
    });

    it('returns the apply response directly from the controller method', async () => {
      const response = {
        status: AgentOperationApplyStatus.Applied,
        plan: { ...plan, status: AgentOperationPlanStatus.Applied },
        appliedOperationIds: [operationId],
        skippedOperationIds: [],
        failedOperationIds: [],
        summary: 'Applied 1 operation(s), skipped 0, failed 0.',
      };
      service.applyApprovedOperations.mockResolvedValue(response);
      const controller = new AgentOperationPlanController(service);

      await expect(controller.applyApprovedOperations(auth, { id: sessionId, planId }, dto)).resolves.toBe(response);
    });
  });
});
