import { BadRequestException } from '@nestjs/common';
import { AgentProviderCredential } from 'src/database';
import { AgentProviderType } from 'src/enum';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import { EncryptedSecretService } from 'src/services/encrypted-secret.service';
import { AuthFactory } from 'test/factories/auth.factory';
import { newUuid } from 'test/small.factory';
import { automock } from 'test/utils';

const now = new Date('2026-05-14T12:00:00.000Z');

const makeCredential = (overrides: Partial<AgentProviderCredential> = {}): AgentProviderCredential => ({
  id: newUuid(),
  userId: newUuid(),
  providerType: AgentProviderType.OpenAI,
  label: 'OpenAI personal',
  baseUrl: null,
  encryptedSecret: 'encrypted-secret',
  secretVersion: 1,
  models: ['gpt-5.1'],
  defaultModel: 'gpt-5.1',
  lastUsedAt: null,
  createdAt: now,
  updatedAt: now,
  updateId: newUuid(),
  ...overrides,
});

describe(AgentProviderCredentialService.name, () => {
  let sut: AgentProviderCredentialService;
  let repository: ReturnType<typeof automock<AgentProviderCredentialRepository>>;
  let encryptedSecret: ReturnType<typeof automock<EncryptedSecretService>>;

  beforeEach(() => {
    repository = automock(AgentProviderCredentialRepository);
    encryptedSecret = automock(EncryptedSecretService, { args: [{} as never] });
    sut = new AgentProviderCredentialService(repository, encryptedSecret);
  });

  it('creates a credential encrypted for authenticated user and response omits secret/encryptedSecret/secretVersion', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ userId: auth.user.id, encryptedSecret: 'encrypted-created' });

    encryptedSecret.encrypt.mockReturnValue('encrypted-created');
    repository.create.mockResolvedValue(credential);

    const result = await sut.create(auth, {
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      secret: 'sk-test',
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    });

    expect(encryptedSecret.encrypt).toHaveBeenCalledWith('sk-test');
    expect(repository.create).toHaveBeenCalledWith({
      userId: auth.user.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      encryptedSecret: 'encrypted-created',
      secretVersion: 1,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    });
    expect(result).toEqual({
      id: credential.id,
      providerType: credential.providerType,
      label: credential.label,
      baseUrl: credential.baseUrl,
      models: credential.models,
      defaultModel: credential.defaultModel,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
      lastUsedAt: credential.lastUsedAt,
    });
    expect(result).not.toHaveProperty('secret');
    expect(result).not.toHaveProperty('encryptedSecret');
    expect(result).not.toHaveProperty('secretVersion');
  });

  it('rejects creating a credential whose default model is not in the configured model list', async () => {
    const auth = AuthFactory.create();

    await expect(
      sut.create(auth, {
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
        secret: 'sk-test',
        models: ['gpt-5.1'],
        defaultModel: 'gpt-5.2',
      }),
    ).rejects.toThrow('defaultModel must be listed in models');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('lists only credentials returned for authenticated user and redacts secret/encryptedSecret/secretVersion', async () => {
    const auth = AuthFactory.create();
    const credentials = [
      makeCredential({ userId: auth.user.id, encryptedSecret: 'first-secret' }),
      makeCredential({ userId: auth.user.id, encryptedSecret: 'second-secret', secretVersion: 2 }),
    ];

    repository.getByUserId.mockResolvedValue(credentials);

    const result = await sut.getAll(auth);

    expect(repository.getByUserId).toHaveBeenCalledWith(auth.user.id);
    expect(result).toHaveLength(2);
    for (const credential of result) {
      expect(credential).not.toHaveProperty('secret');
      expect(credential).not.toHaveProperty('encryptedSecret');
      expect(credential).not.toHaveProperty('secretVersion');
    }
  });

  it('throws when fetching missing credential', async () => {
    const auth = AuthFactory.create();
    const id = newUuid();

    repository.getById.mockResolvedValue(void 0);

    await expect(sut.getById(auth, id)).rejects.toThrow(BadRequestException);
    await expect(sut.getById(auth, id)).rejects.toThrow('Agent provider credential not found');
  });

  it('updates metadata without replacing secret', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ userId: auth.user.id, encryptedSecret: 'existing-secret', secretVersion: 3 });
    const updated = makeCredential({ ...credential, label: 'Updated label', models: ['gpt-5.1', 'gpt-5.1-mini'] });

    repository.getById.mockResolvedValue(credential);
    repository.update.mockResolvedValue(updated);

    await sut.update(auth, credential.id, { label: 'Updated label', models: ['gpt-5.1', 'gpt-5.1-mini'] });

    expect(encryptedSecret.encrypt).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(auth.user.id, credential.id, {
      label: 'Updated label',
      models: ['gpt-5.1', 'gpt-5.1-mini'],
    });
  });

  it('rejects updating a credential to a default model outside the resulting model list', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ userId: auth.user.id, models: ['gpt-5.1'], defaultModel: 'gpt-5.1' });

    repository.getById.mockResolvedValue(credential);

    await expect(sut.update(auth, credential.id, { defaultModel: 'gpt-5.2' })).rejects.toThrow(
      'defaultModel must be listed in models',
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('rejects clearing baseUrl on OpenAI-compatible credential, and does not call repository.update or encryption', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({
      userId: auth.user.id,
      providerType: AgentProviderType.OpenAICompatible,
      baseUrl: 'http://localhost:11434/v1',
    });

    repository.getById.mockResolvedValue(credential);

    await expect(sut.update(auth, credential.id, { baseUrl: null })).rejects.toThrow(
      'baseUrl is required for openai-compatible providers',
    );
    expect(repository.update).not.toHaveBeenCalled();
    expect(encryptedSecret.encrypt).not.toHaveBeenCalled();
  });

  it('allows changing to OpenAI-compatible when existing baseUrl remains valid', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ userId: auth.user.id, baseUrl: 'https://gateway.example.com/v1' });
    const updated = makeCredential({ ...credential, providerType: AgentProviderType.OpenAICompatible });

    repository.getById.mockResolvedValue(credential);
    repository.update.mockResolvedValue(updated);

    await sut.update(auth, credential.id, { providerType: AgentProviderType.OpenAICompatible });

    expect(repository.update).toHaveBeenCalledWith(auth.user.id, credential.id, {
      providerType: AgentProviderType.OpenAICompatible,
    });
  });

  it('re-encrypts secret updates and increments secretVersion', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ userId: auth.user.id, encryptedSecret: 'old-secret', secretVersion: 4 });
    const updated = makeCredential({ ...credential, encryptedSecret: 'new-secret', secretVersion: 5 });

    repository.getById.mockResolvedValue(credential);
    encryptedSecret.encrypt.mockReturnValue('new-secret');
    repository.update.mockResolvedValue(updated);

    await sut.update(auth, credential.id, { secret: 'sk-updated' });

    expect(encryptedSecret.encrypt).toHaveBeenCalledWith('sk-updated');
    expect(repository.update).toHaveBeenCalledWith(auth.user.id, credential.id, {
      encryptedSecret: 'new-secret',
      secretVersion: 5,
    });
  });

  it('throws on empty update body and does not update', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ userId: auth.user.id });

    repository.getById.mockResolvedValue(credential);

    await expect(sut.update(auth, credential.id, {})).rejects.toThrow('No credential fields to update');
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not leak secret fields from update responses', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ userId: auth.user.id, encryptedSecret: 'existing-secret', secretVersion: 3 });
    const updated = makeCredential({ ...credential, label: 'Updated label' });

    repository.getById.mockResolvedValue(credential);
    repository.update.mockResolvedValue(updated);

    const result = await sut.update(auth, credential.id, { label: 'Updated label' });

    expect(result).not.toHaveProperty('secret');
    expect(result).not.toHaveProperty('encryptedSecret');
    expect(result).not.toHaveProperty('secretVersion');
  });

  it('decrypts a secret for future session dispatch', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ userId: auth.user.id, encryptedSecret: 'encrypted-dispatch-secret' });

    repository.getById.mockResolvedValue(credential);
    encryptedSecret.decrypt.mockReturnValue('sk-dispatch');

    await expect(sut.getSecret(auth, credential.id)).resolves.toBe('sk-dispatch');
    expect(encryptedSecret.decrypt).toHaveBeenCalledWith('encrypted-dispatch-secret');
  });

  it('does not decrypt missing credential', async () => {
    const auth = AuthFactory.create();
    const id = newUuid();

    repository.getById.mockResolvedValue(void 0);

    await expect(sut.getSecret(auth, id)).rejects.toThrow('Agent provider credential not found');
    expect(encryptedSecret.decrypt).not.toHaveBeenCalled();
  });

  it('deletes an owned credential', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ userId: auth.user.id });

    repository.getById.mockResolvedValue(credential);
    repository.delete.mockResolvedValue();

    await sut.delete(auth, credential.id);

    expect(repository.delete).toHaveBeenCalledWith(auth.user.id, credential.id);
  });

  it('does not delete missing credential', async () => {
    const auth = AuthFactory.create();
    const id = newUuid();

    repository.getById.mockResolvedValue(void 0);

    await expect(sut.delete(auth, id)).rejects.toThrow('Agent provider credential not found');
    expect(repository.delete).not.toHaveBeenCalled();
  });
});
