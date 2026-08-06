import { Kysely, sql } from 'kysely';
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType, AgentSessionStatus } from 'src/enum';
import { DB } from 'src/schema';
import { up as backfillAgentReadSessionLimits } from 'src/schema/migrations-gallery/1778910000000-BackfillAgentReadSessionLimits';
import { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
import { SyncTestContext } from 'test/medium.factory';
import { newUuid } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const basePlan = {
  read: { metadata: true, previews: true, originals: true },
  providerExposure: {
    metadata: true,
    previews: true,
    originals: true,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: false, locked: false },
  writeScope: { createAlbum: false, addAssets: false, updateDetails: false, setCover: false },
  limits: {
    maxAssetsPerToolCall: 100,
    maxAssetsPerSession: 1000,
    maxPreviewsPerToolCall: 5,
    maxOriginalsPerToolCall: 2,
    expiresInMinutes: 60,
  },
};

const credentialSnapshot = {
  id: '00000000-0000-4000-8000-000000000001',
  providerType: AgentProviderType.OpenAI,
  label: 'OpenAI personal',
  baseUrl: null,
  models: ['gpt-5.1'],
  defaultModel: 'gpt-5.1',
};

const insertSession = async (db: Kysely<DB>, userId: string, permissionPlanSnapshot: unknown) => {
  const id = newUuid();

  await db
    .insertInto('agent_session')
    .values({
      id,
      userId,
      credentialSnapshot,
      modelSnapshot: { providerCredentialId: credentialSnapshot.id, model: 'gpt-5.1' },
      permissionPreset: AgentPermissionPreset.Custom,
      permissionPlanSnapshot: permissionPlanSnapshot as AgentPermissionPlanSnapshot,
      approvalMode: AgentApprovalMode.Strict,
      status: AgentSessionStatus.Running,
      initialContextSnapshot: {},
    })
    .execute();

  return id;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('agent read session limits migration backfill', () => {
  it('backfills missing preview/original session limits without widening old sensitive reads', async () => {
    const ctx = new SyncTestContext(defaultDatabase);
    const { user } = await ctx.newUser();

    const normalSessionId = await insertSession(defaultDatabase, user.id, {
      ...basePlan,
      limits: { ...basePlan.limits },
    });
    const partialSessionId = await insertSession(defaultDatabase, user.id, {
      ...basePlan,
      limits: { ...basePlan.limits, maxOriginalsPerSession: 1 },
    });
    const oldSessionId = await insertSession(defaultDatabase, user.id, {
      ...basePlan,
      limits: {
        maxAssetsPerToolCall: 100,
        maxAssetsPerSession: 1000,
        expiresInMinutes: 60,
      },
    });

    await backfillAgentReadSessionLimits(defaultDatabase as unknown as Kysely<unknown>);

    const rows = await sql<{ id: string; limits: Record<string, number> }>`
      SELECT "id", "permissionPlanSnapshot"->'limits' AS limits
      FROM "agent_session"
      WHERE "id" IN (${sql.join([normalSessionId, partialSessionId, oldSessionId])})
    `.execute(defaultDatabase);
    const byId = new Map(rows.rows.map((row) => [row.id, row.limits]));

    expect(byId.get(normalSessionId)).toMatchObject({ maxPreviewsPerSession: 5, maxOriginalsPerSession: 2 });
    expect(byId.get(partialSessionId)).toMatchObject({ maxPreviewsPerSession: 5, maxOriginalsPerSession: 1 });
    expect(byId.get(oldSessionId)).toMatchObject({ maxPreviewsPerSession: 0, maxOriginalsPerSession: 0 });
  });
});
