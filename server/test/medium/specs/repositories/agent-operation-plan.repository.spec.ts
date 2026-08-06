import { Kysely } from 'kysely';
import {
  AgentApprovalMode,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
} from 'src/enum';
import { AgentOperationPlanRepository } from 'src/repositories/agent-operation-plan.repository';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { AgentAlbumOperationInput } from 'src/types/agent-operation.types';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const permissionPlanSnapshot = {
  read: { metadata: true, previews: true, originals: false },
  providerExposure: {
    metadata: true,
    previews: true,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: false, locked: false },
  writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
  limits: {
    maxAssetsPerToolCall: 100,
    maxAssetsPerSession: 1000,
    maxPreviewsPerToolCall: 50,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 60,
  },
};

const setup = (db?: Kysely<DB>) => {
  const database = db || defaultDatabase;
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [],
    mock: [LoggingRepository],
  });

  return {
    ctx,
    database,
    credentialRepository: new AgentProviderCredentialRepository(database),
    sessionRepository: new AgentSessionRepository(database),
    sut: new AgentOperationPlanRepository(database),
  };
};

const createSession = async (
  ctx: ReturnType<typeof setup>['ctx'],
  credentialRepository: AgentProviderCredentialRepository,
  sessionRepository: AgentSessionRepository,
) => {
  const { user } = await ctx.newUser();
  const credential = await credentialRepository.create({
    userId: user.id,
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    encryptedSecret: 'v1:encrypted',
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  });

  const session = await sessionRepository.create({
    userId: user.id,
    providerCredentialId: credential.id,
    credentialSnapshot: {
      id: credential.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId: credential.id, model: 'gpt-5.1' },
    permissionPreset: AgentPermissionPreset.Careful,
    permissionPlanSnapshot,
    approvalMode: AgentApprovalMode.Strict,
    runnerEndpoint: null,
    runnerSessionId: null,
    runnerCapabilitiesSnapshot: null,
    initialContextSnapshot: {},
  });

  return { user, session };
};

const createAlbumOperation = (temporaryTargetId = 'trip-album'): AgentAlbumOperationInput => ({
  type: AgentOperationType.AlbumCreate,
  summary: 'Create a trip album',
  targetKind: AgentOperationTargetKind.NewAlbum,
  temporaryTargetId,
  assetIds: [],
  payload: { albumName: 'Trip', description: 'Best trip photos' },
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
});

const addAssetsOperation = (temporaryTargetId = 'trip-album'): AgentAlbumOperationInput => ({
  type: AgentOperationType.AlbumAddAssets,
  summary: 'Add selected photos',
  targetKind: AgentOperationTargetKind.NewAlbum,
  temporaryTargetId,
  assetIds: [factory.uuid(), factory.uuid()],
  payload: {},
  riskLevel: AgentOperationRiskLevel.Medium,
  enabled: true,
});

const setCoverOperation = (temporaryTargetId = 'trip-album'): AgentAlbumOperationInput => ({
  type: AgentOperationType.AlbumSetCover,
  summary: 'Set cover photo',
  targetKind: AgentOperationTargetKind.NewAlbum,
  temporaryTargetId,
  assetIds: [factory.uuid()],
  payload: {},
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
});

const planRevisionInput = (
  sessionId: string,
  {
    revision,
    status = AgentOperationPlanStatus.Proposed,
    summary,
    operations,
  }: {
    revision: number;
    status?: AgentOperationPlanStatus;
    summary: string;
    operations: AgentAlbumOperationInput[];
  },
) => ({
  plan: {
    sessionId,
    revision,
    status,
    summary,
  },
  operations,
});

const replacementRevisionInput = (sessionId: string, summary: string, operations: AgentAlbumOperationInput[]) => ({
  plan: {
    sessionId,
    status: AgentOperationPlanStatus.Proposed,
    summary,
  },
  operations,
});

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AgentOperationPlanRepository.name, () => {
  it('creates a plan revision with operations returned in creation order', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    const plan = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Build a travel album',
        operations: [createAlbumOperation(), addAssetsOperation(), setCoverOperation()],
      }),
    );

    expect(plan).toMatchObject({
      sessionId: session.id,
      revision: 1,
      status: AgentOperationPlanStatus.Proposed,
      summary: 'Build a travel album',
    });
    expect(plan.operations).toHaveLength(3);
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      AgentOperationType.AlbumCreate,
      AgentOperationType.AlbumAddAssets,
      AgentOperationType.AlbumSetCover,
    ]);
    expect(plan.operations).toEqual(
      plan.operations.map(() =>
        expect.objectContaining({
          planId: plan.id,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
        }),
      ),
    );
  });

  it('stores dependency ids as inserted operation ids for new-album add-assets and set-cover operations', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    const plan = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Build a travel album',
        operations: [
          createAlbumOperation('new-album'),
          addAssetsOperation('new-album'),
          setCoverOperation('new-album'),
        ],
      }),
    );

    const createOperation = plan.operations[0];
    const dependentOperations = plan.operations.slice(1);
    expect(createOperation.temporaryTargetId).toBe('new-album');
    expect(dependentOperations).toHaveLength(2);
    expect(dependentOperations.map((operation) => operation.dependencyIds)).toEqual([
      [createOperation.id],
      [createOperation.id],
    ]);
    expect(dependentOperations.flatMap((operation) => operation.dependencyIds)).not.toContain('new-album');
  });

  it('resolves new-album dependencies to the matching create operation regardless of creation order', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    const plan = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Build a travel album',
        operations: [
          addAssetsOperation('late-album'),
          createAlbumOperation('late-album'),
          setCoverOperation('late-album'),
        ],
      }),
    );

    const createOperation = plan.operations[1];
    expect(plan.operations[0].dependencyIds).toEqual([createOperation.id]);
    expect(plan.operations[2].dependencyIds).toEqual([createOperation.id]);
  });

  it('creates replacement revisions by superseding previous proposed plans and incrementing revision per session', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    const original = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Original plan',
        operations: [createAlbumOperation('original-album')],
      }),
    );
    const replacement = await sut.createReplacementRevision(
      session.id,
      replacementRevisionInput(session.id, 'Replacement plan', [createAlbumOperation('replacement-album')]),
    );

    await expect(sut.getByIdForSession(session.id, original.id)).resolves.toMatchObject({
      id: original.id,
      status: AgentOperationPlanStatus.Superseded,
    });
    expect(replacement).toMatchObject({
      sessionId: session.id,
      revision: 2,
      status: AgentOperationPlanStatus.Proposed,
      summary: 'Replacement plan',
    });
    expect(replacement?.operations).toHaveLength(1);
  });

  it('does not create a replacement revision when the locked session is applying', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { user, session } = await createSession(ctx, credentialRepository, sessionRepository);
    const original = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Original plan',
        operations: [createAlbumOperation('original-album')],
      }),
    );
    await sessionRepository.update(user.id, session.id, { status: AgentSessionStatus.Applying });

    await expect(
      sut.createReplacementRevision(
        session.id,
        replacementRevisionInput(session.id, 'Late replacement', [createAlbumOperation('late-album')]),
      ),
    ).resolves.toBeUndefined();
    await expect(sut.getByIdForSession(session.id, original.id)).resolves.toMatchObject({
      status: AgentOperationPlanStatus.Proposed,
    });
  });

  it('serializes concurrent replacement revision calculations for the same session', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Original plan',
        operations: [createAlbumOperation('original-album')],
      }),
    );

    const replacements = await Promise.all([
      sut.createReplacementRevision(
        session.id,
        replacementRevisionInput(session.id, 'Replacement plan A', [createAlbumOperation('replacement-album-a')]),
      ),
      sut.createReplacementRevision(
        session.id,
        replacementRevisionInput(session.id, 'Replacement plan B', [createAlbumOperation('replacement-album-b')]),
      ),
    ]);

    expect(replacements).toEqual([expect.any(Object), expect.any(Object)]);
    expect(replacements.map((plan) => plan!.revision).toSorted()).toEqual([2, 3]);
    await expect(sut.getNextRevision(session.id)).resolves.toBe(4);
  });

  it('calculates next revision independently per session', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session: firstSession } = await createSession(ctx, credentialRepository, sessionRepository);
    const { session: secondSession } = await createSession(ctx, credentialRepository, sessionRepository);

    await sut.createRevision(
      planRevisionInput(firstSession.id, {
        revision: 1,
        summary: 'First session first plan',
        operations: [createAlbumOperation('first-1')],
      }),
    );
    await sut.createRevision(
      planRevisionInput(firstSession.id, {
        revision: 2,
        summary: 'First session second plan',
        operations: [createAlbumOperation('first-2')],
      }),
    );

    await expect(sut.getNextRevision(firstSession.id)).resolves.toBe(3);
    await expect(sut.getNextRevision(secondSession.id)).resolves.toBe(1);
  });

  it('cascades plan and operation deletion when the owning agent session is deleted', async () => {
    const { ctx, database, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const plan = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Temporary plan',
        operations: [createAlbumOperation(), addAssetsOperation()],
      }),
    );

    await database.deleteFrom('agent_session').where('id', '=', session.id).execute();

    await expect(sut.getByIdForSession(session.id, plan.id)).resolves.toBeUndefined();
    await expect(
      database.selectFrom('agent_operation_plan').select('id').where('id', '=', plan.id).execute(),
    ).resolves.toEqual([]);
    await expect(
      database.selectFrom('agent_operation').select('id').where('planId', '=', plan.id).execute(),
    ).resolves.toEqual([]);
  });

  it('returns the latest proposed plan for a session and ignores superseded older plans', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    const original = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Original plan',
        operations: [createAlbumOperation('original-album')],
      }),
    );
    const replacement = await sut.createReplacementRevision(
      session.id,
      replacementRevisionInput(session.id, 'Replacement plan', [
        createAlbumOperation('replacement-album'),
        addAssetsOperation('replacement-album'),
      ]),
    );

    const current = await sut.getCurrentBySessionId(session.id);

    expect(current).toMatchObject({
      id: replacement?.id,
      revision: 2,
      status: AgentOperationPlanStatus.Proposed,
      summary: 'Replacement plan',
    });
    expect(current?.id).not.toBe(original.id);
    expect(current?.operations.map((operation) => operation.temporaryTargetId)).toEqual([
      'replacement-album',
      'replacement-album',
    ]);
  });

  it('returns applied plans for a session and excludes proposed and superseded revisions', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    const firstApplied = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        status: AgentOperationPlanStatus.Applied,
        summary: 'First applied plan',
        operations: [createAlbumOperation('first-applied-album')],
      }),
    );
    const secondApplied = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 2,
        status: AgentOperationPlanStatus.Applied,
        summary: 'Second applied plan',
        operations: [createAlbumOperation('second-applied-album'), addAssetsOperation('second-applied-album')],
      }),
    );
    await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 3,
        status: AgentOperationPlanStatus.Superseded,
        summary: 'Superseded plan',
        operations: [createAlbumOperation('superseded-album')],
      }),
    );
    await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 4,
        status: AgentOperationPlanStatus.Proposed,
        summary: 'Current proposed plan',
        operations: [createAlbumOperation('proposed-album')],
      }),
    );

    const applied = await sut.getAppliedBySessionId(session.id);

    expect(applied.map((plan) => plan.id)).toEqual([firstApplied.id, secondApplied.id]);
    expect(applied.map((plan) => plan.status)).toEqual([
      AgentOperationPlanStatus.Applied,
      AgentOperationPlanStatus.Applied,
    ]);
    expect(applied[1].operations.map((operation) => operation.temporaryTargetId)).toEqual([
      'second-applied-album',
      'second-applied-album',
    ]);
  });

  it('returns operations in input order instead of uuid or createdAt tie-breaker order', async () => {
    const { ctx, database, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    const plan = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Ordered plan',
        operations: [
          createAlbumOperation('ordered-album'),
          addAssetsOperation('ordered-album'),
          setCoverOperation('ordered-album'),
        ],
      }),
    );
    await database
      .updateTable('agent_operation')
      .set({ createdAt: plan.operations[0].createdAt })
      .where('planId', '=', plan.id)
      .execute();

    const reloaded = await sut.getByIdForSession(session.id, plan.id);

    expect(reloaded?.operations.map((operation) => operation.id)).toEqual(
      plan.operations.map((operation) => operation.id),
    );
    expect(reloaded?.operations.map((operation) => operation.type)).toEqual([
      AgentOperationType.AlbumCreate,
      AgentOperationType.AlbumAddAssets,
      AgentOperationType.AlbumSetCover,
    ]);
  });

  it('claims a current proposed plan for apply by marking it applied', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { user, session } = await createSession(ctx, credentialRepository, sessionRepository);
    await sessionRepository.update(user.id, session.id, { status: AgentSessionStatus.WaitingForPlanReview });
    const plan = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Apply me',
        operations: [createAlbumOperation('apply-album'), addAssetsOperation('apply-album')],
      }),
    );

    const claimed = await sut.claimCurrentForApply(session.id, plan.id);

    expect(claimed).toMatchObject({
      id: plan.id,
      sessionId: session.id,
      status: AgentOperationPlanStatus.Applied,
    });
    expect(claimed?.operations.map((operation) => operation.id)).toEqual(
      plan.operations.map((operation) => operation.id),
    );
    await expect(sut.getCurrentBySessionId(session.id)).resolves.toBeUndefined();
    await expect(sessionRepository.getById(user.id, session.id)).resolves.toMatchObject({
      status: AgentSessionStatus.Applying,
    });
  });

  it('does not claim an already applied plan twice', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { user, session } = await createSession(ctx, credentialRepository, sessionRepository);
    await sessionRepository.update(user.id, session.id, { status: AgentSessionStatus.WaitingForPlanReview });
    const plan = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Apply once',
        operations: [createAlbumOperation('once-album')],
      }),
    );

    await expect(sut.claimCurrentForApply(session.id, plan.id)).resolves.toMatchObject({ id: plan.id });
    await expect(sut.claimCurrentForApply(session.id, plan.id)).resolves.toBeUndefined();
  });

  it('does not claim a plan when the locked session is no longer waiting for review', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { user, session } = await createSession(ctx, credentialRepository, sessionRepository);
    await sessionRepository.update(user.id, session.id, { status: AgentSessionStatus.Completed });
    const plan = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Do not apply after cancel',
        operations: [createAlbumOperation('cancelled-album')],
      }),
    );

    await expect(sut.claimCurrentForApply(session.id, plan.id)).resolves.toBeUndefined();
    await expect(sut.getByIdForSession(session.id, plan.id)).resolves.toMatchObject({
      status: AgentOperationPlanStatus.Proposed,
    });
  });

  it('persists operation apply statuses, results, and errors', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { user, session } = await createSession(ctx, credentialRepository, sessionRepository);
    await sessionRepository.update(user.id, session.id, { status: AgentSessionStatus.WaitingForPlanReview });
    const plan = await sut.createRevision(
      planRevisionInput(session.id, {
        revision: 1,
        summary: 'Persist results',
        operations: [createAlbumOperation('result-album'), addAssetsOperation('result-album')],
      }),
    );
    const [createOperation, addOperation] = plan.operations;
    await sut.claimCurrentForApply(session.id, plan.id);

    const updated = await sut.completeApply(plan.id, [
      {
        id: createOperation.id,
        status: AgentOperationStatus.Applied,
        result: { albumId: factory.uuid() },
        error: null,
      },
      {
        id: addOperation.id,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'Dependency was not applied' },
        error: null,
      },
    ]);

    expect(updated.status).toBe(AgentOperationPlanStatus.Applied);
    expect(updated.operations).toEqual([
      expect.objectContaining({ id: createOperation.id, status: AgentOperationStatus.Applied, error: null }),
      expect.objectContaining({
        id: addOperation.id,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'Dependency was not applied' },
      }),
    ]);
  });

  it('rejects new-album dependent operations without a matching create operation', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    await expect(
      sut.createRevision(
        planRevisionInput(session.id, {
          revision: 1,
          summary: 'Invalid plan',
          operations: [addAssetsOperation('missing-album')],
        }),
      ),
    ).rejects.toThrow('Missing album.create operation for temporary target missing-album');
  });

  it('rejects duplicate album.create temporary target ids', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    await expect(
      sut.createRevision(
        planRevisionInput(session.id, {
          revision: 1,
          summary: 'Invalid plan',
          operations: [createAlbumOperation('duplicate-album'), createAlbumOperation('duplicate-album')],
        }),
      ),
    ).rejects.toThrow('Duplicate album.create temporary target duplicate-album');
  });
});
