import { Kysely } from 'kysely';
import { AgentProviderType } from 'src/enum';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const database = db || defaultDatabase;
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [],
    mock: [LoggingRepository],
  });

  return { ctx, sut: new AgentProviderCredentialRepository(database) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AgentProviderCredentialRepository.name, () => {
  it('persists credentials and scopes reads, updates, and deletes by user', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();

    const created = await sut.create({
      userId: user.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      encryptedSecret: 'v1:encrypted',
      secretVersion: 1,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
      createdAt: new Date('2026-05-14T11:00:00Z'),
    });

    expect(created).toMatchObject({
      userId: user.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      encryptedSecret: 'v1:encrypted',
      secretVersion: 1,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
      lastUsedAt: null,
    });
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeDefined();
    expect(created.updatedAt).toBeDefined();
    expect(created.updateId).toBeDefined();

    const second = await sut.create({
      userId: user.id,
      providerType: AgentProviderType.Anthropic,
      label: 'Anthropic work',
      baseUrl: null,
      encryptedSecret: 'v1:anthropic',
      models: ['claude-sonnet-4.5'],
      defaultModel: null,
      createdAt: new Date('2026-05-14T12:00:00Z'),
    });

    const ownCredentials = await sut.getByUserId(user.id);
    expect(ownCredentials.map(({ id }) => id)).toEqual([second.id, created.id]);
    await expect(sut.getById(user.id, created.id)).resolves.toMatchObject({ id: created.id });
    await expect(sut.getById(otherUser.id, created.id)).resolves.toBeUndefined();
    await expect(sut.getByUserId(otherUser.id)).resolves.toEqual([]);

    const lastUsedAt = new Date('2026-05-14T12:00:00Z');
    const updated = await sut.update(user.id, created.id, {
      label: 'Renamed',
      providerType: AgentProviderType.OpenAICompatible,
      baseUrl: 'http://localhost:11434/v1',
      encryptedSecret: 'v1:new-encrypted',
      secretVersion: 2,
      models: ['llama3.3'],
      defaultModel: 'llama3.3',
      lastUsedAt,
    });

    expect(updated).toMatchObject({
      id: created.id,
      label: 'Renamed',
      providerType: AgentProviderType.OpenAICompatible,
      baseUrl: 'http://localhost:11434/v1',
      encryptedSecret: 'v1:new-encrypted',
      secretVersion: 2,
      models: ['llama3.3'],
      defaultModel: 'llama3.3',
      lastUsedAt,
    });

    await expect(sut.update(otherUser.id, created.id, { label: 'Cross-user update' })).rejects.toThrow();
    await sut.delete(otherUser.id, created.id);
    await expect(sut.getById(user.id, created.id)).resolves.toMatchObject({ id: created.id });

    await sut.delete(user.id, created.id);
    await expect(sut.getById(user.id, created.id)).resolves.toBeUndefined();
  });

  it('cascades credentials when the owning user is deleted', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const created = await sut.create({
      userId: user.id,
      providerType: AgentProviderType.Anthropic,
      label: 'Anthropic',
      baseUrl: null,
      encryptedSecret: 'v1:encrypted',
      models: ['claude-sonnet-4.5'],
      defaultModel: 'claude-sonnet-4.5',
    });

    await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();

    await expect(sut.getById(user.id, created.id)).resolves.toBeUndefined();
  });
});
