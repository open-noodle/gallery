# Agent Provider Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first vertical slice for the Gallery agent by storing user-owned AI provider credentials encrypted in Gallery Postgres with authenticated CRUD APIs.

**Architecture:** Gallery remains the source of durable state. This slice adds a server-side encrypted-secret service keyed by an optional instance secret, a user-scoped credential table/repository/service, and authenticated API routes under `agent/provider-credentials`. No runner, chat, permission plans, album operations, or UI are implemented in this slice.

**Tech Stack:** NestJS, Kysely, `@immich/sql-tools`, Postgres, Zod DTOs via `nestjs-zod`, Vitest, Node `crypto` AES-256-GCM.

---

## Scope

This slice implements credential storage only:

- Store multiple credentials per user.
- Encrypt provider secrets before writing to Postgres.
- Redact provider secrets from every HTTP response.
- Allow create, list, get, update, and delete for the authenticated owner.
- Keep the feature inert unless a user configures credentials and `IMMICH_AGENT_SECRET_KEY` is present for secret writes/decrypts.

This slice intentionally does not implement:

- Agent chat sessions.
- Pi runner sidecar.
- Read/write permission plans.
- Album planning or album mutations.
- Assistant page UI.
- Local model execution.

## File Structure

Create:

- `server/src/services/encrypted-secret.service.ts` - AES-GCM encryption/decryption helper keyed by `IMMICH_AGENT_SECRET_KEY`.
- `server/src/services/encrypted-secret.service.spec.ts` - round-trip, redaction, missing-key, and invalid-key coverage.
- `server/src/schema/tables/agent-provider-credential.table.ts` - SQL-tools table for encrypted user credentials.
- `server/src/schema/migrations/1777000000000-AgentProviderCredential.ts` - manual migration for the credential table.
- `server/src/repositories/agent-provider-credential.repository.ts` - user-scoped Kysely CRUD queries.
- `server/test/medium/specs/repositories/agent-provider-credential.repository.spec.ts` - DB-backed persistence, scoping, update, delete, and FK cascade coverage.
- `server/src/dtos/agent-provider-credential.dto.ts` - create/update/response Zod DTOs.
- `server/src/services/agent-provider-credential.service.ts` - ownership, encryption, redaction, and service behavior.
- `server/src/services/agent-provider-credential.service.spec.ts` - TDD coverage for service behavior.
- `server/src/controllers/agent-provider-credential.controller.ts` - authenticated REST routes.
- `server/src/controllers/agent-provider-credential.controller.spec.ts` - route auth, UUID, and DTO validation coverage.

Modify:

- `server/src/dtos/env.dto.ts` - accept optional `IMMICH_AGENT_SECRET_KEY`.
- `server/src/repositories/config.repository.ts` - expose `env.agent.secretKey`.
- `server/src/schema/index.ts` - register the table and DB interface.
- `server/src/database.ts` - add type and selected column list.
- `server/src/repositories/index.ts` - register repository provider.
- `server/src/services/index.ts` - register service providers.
- `server/src/controllers/index.ts` - register controller.
- `server/src/enum.ts` - add `AgentProviderType`, credential permissions, and API tag.
- `server/src/constants.ts` - add API tag text.
- Generated OpenAPI/SDK files changed by `make open-api-typescript`.

## Naming and API Contracts

Provider enum:

```ts
export enum AgentProviderType {
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  OpenAICompatible = 'openai-compatible',
}
```

HTTP routes:

```text
POST   /agent/provider-credentials
GET    /agent/provider-credentials
GET    /agent/provider-credentials/:id
PUT    /agent/provider-credentials/:id
DELETE /agent/provider-credentials/:id
```

Create body:

```json
{
  "providerType": "openai",
  "label": "OpenAI personal",
  "secret": "sk-user-supplied",
  "models": ["gpt-5.1"],
  "defaultModel": "gpt-5.1"
}
```

OpenAI-compatible create body:

```json
{
  "providerType": "openai-compatible",
  "label": "Local gateway",
  "secret": "local-key",
  "baseUrl": "http://localhost:11434/v1",
  "models": ["llama3.3"],
  "defaultModel": "llama3.3"
}
```

Response shape:

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "providerType": "openai",
  "label": "OpenAI personal",
  "baseUrl": null,
  "models": ["gpt-5.1"],
  "defaultModel": "gpt-5.1",
  "createdAt": "2026-05-14T00:00:00.000Z",
  "updatedAt": "2026-05-14T00:00:00.000Z",
  "lastUsedAt": null
}
```

The response never includes `secret`, `encryptedSecret`, or `secretVersion`.

## Task 1: Encrypted Secret Service

**Files:**

- Create: `server/src/services/encrypted-secret.service.spec.ts`
- Create: `server/src/services/encrypted-secret.service.ts`
- Modify: `server/src/dtos/env.dto.ts`
- Modify: `server/src/repositories/config.repository.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Write the failing encrypted-secret tests**

Create `server/src/services/encrypted-secret.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EncryptedSecretService } from 'src/services/encrypted-secret.service';

describe(EncryptedSecretService.name, () => {
  const configRepository = {
    getEnv: vitest.fn(),
  } as unknown as ConfigRepository;

  const setSecretKey = (secretKey: string | undefined) => {
    vitest.mocked(configRepository.getEnv).mockReturnValue({
      agent: { secretKey },
    } as ReturnType<ConfigRepository['getEnv']>);
  };

  beforeEach(() => {
    vitest.mocked(configRepository.getEnv).mockReset();
  });

  it('encrypts without storing plaintext and decrypts the value', () => {
    setSecretKey('test-instance-secret');
    const sut = new EncryptedSecretService(configRepository);

    const encrypted = sut.encrypt('sk-test-secret');

    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain('sk-test-secret');
    expect(sut.decrypt(encrypted)).toBe('sk-test-secret');
  });

  it('uses random nonces so the same plaintext does not encrypt the same way twice', () => {
    setSecretKey('test-instance-secret');
    const sut = new EncryptedSecretService(configRepository);

    const first = sut.encrypt('sk-test-secret');
    const second = sut.encrypt('sk-test-secret');

    expect(first).not.toBe(second);
    expect(sut.decrypt(first)).toBe('sk-test-secret');
    expect(sut.decrypt(second)).toBe('sk-test-secret');
  });

  it('accepts a base64-prefixed 32 byte key', () => {
    setSecretKey(`base64:${Buffer.alloc(32, 7).toString('base64')}`);
    const sut = new EncryptedSecretService(configRepository);

    const encrypted = sut.encrypt('sk-test-secret');

    expect(sut.decrypt(encrypted)).toBe('sk-test-secret');
  });

  it('throws when the encryption key is missing', () => {
    setSecretKey(undefined);
    const sut = new EncryptedSecretService(configRepository);

    expect(() => sut.encrypt('sk-test-secret')).toThrow(BadRequestException);
    expect(() => sut.encrypt('sk-test-secret')).toThrow('Agent credential encryption key is not configured');
  });

  it('throws when a base64 key is not 32 bytes', () => {
    setSecretKey(`base64:${Buffer.alloc(16, 7).toString('base64')}`);
    const sut = new EncryptedSecretService(configRepository);

    expect(() => sut.encrypt('sk-test-secret')).toThrow(BadRequestException);
    expect(() => sut.encrypt('sk-test-secret')).toThrow('Agent credential encryption key must be 32 bytes');
  });

  it('throws for invalid encrypted payloads', () => {
    setSecretKey('test-instance-secret');
    const sut = new EncryptedSecretService(configRepository);

    expect(() => sut.decrypt('not-a-v1-payload')).toThrow(BadRequestException);
    expect(() => sut.decrypt('not-a-v1-payload')).toThrow('Invalid encrypted secret format');
  });

  it('throws when the ciphertext is tampered with', () => {
    setSecretKey('test-instance-secret');
    const sut = new EncryptedSecretService(configRepository);
    const encrypted = sut.encrypt('sk-test-secret');
    const [version, iv, tag] = encrypted.split(':');
    const tampered = [version, iv, tag, Buffer.from('tampered').toString('base64url')].join(':');

    expect(() => sut.decrypt(tampered)).toThrow(BadRequestException);
    expect(() => sut.decrypt(tampered)).toThrow('Invalid encrypted secret');
  });

  it('throws when decrypting with a different key', () => {
    setSecretKey('first-secret');
    const sut = new EncryptedSecretService(configRepository);
    const encrypted = sut.encrypt('sk-test-secret');

    setSecretKey('second-secret');

    expect(() => sut.decrypt(encrypted)).toThrow(BadRequestException);
    expect(() => sut.decrypt(encrypted)).toThrow('Invalid encrypted secret');
  });

  it('throws when a base64-prefixed key is malformed', () => {
    setSecretKey('base64:not-valid-base64');
    const sut = new EncryptedSecretService(configRepository);

    expect(() => sut.encrypt('sk-test-secret')).toThrow(BadRequestException);
    expect(() => sut.encrypt('sk-test-secret')).toThrow('Agent credential encryption key must be 32 bytes');
  });
});
```

- [ ] **Step 2: Run the encrypted-secret test and verify it fails**

Run:

```bash
pnpm --filter immich run test -- --run src/services/encrypted-secret.service.spec.ts
```

Expected: FAIL with a module resolution error for `src/services/encrypted-secret.service`.

- [ ] **Step 3: Add the env contract**

In `server/src/dtos/env.dto.ts`, add this field inside the `EnvSchema` object near the other `IMMICH_*` fields:

```ts
    IMMICH_AGENT_SECRET_KEY: z.string().optional(),
```

In `server/src/repositories/config.repository.ts`, add this section to `EnvData` after `peopleStatistics`:

```ts
  agent: {
    secretKey?: string;
  };
```

In the object returned by `getEnv()`, add this property after `peopleStatistics`:

```ts
    agent: {
      secretKey: dto.IMMICH_AGENT_SECRET_KEY,
    },
```

- [ ] **Step 4: Implement the encrypted-secret service**

Create `server/src/services/encrypted-secret.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ConfigRepository } from 'src/repositories/config.repository';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

@Injectable()
export class EncryptedSecretService {
  constructor(private configRepository: ConfigRepository) {}

  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [VERSION, this.encode(iv), this.encode(tag), this.encode(ciphertext)].join(':');
  }

  decrypt(payload: string): string {
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] = payload.split(':');
    if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra !== undefined) {
      throw new BadRequestException('Invalid encrypted secret format');
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, this.getKey(), this.decode(encodedIv));
      decipher.setAuthTag(this.decode(encodedTag));
      const plaintext = Buffer.concat([decipher.update(this.decode(encodedCiphertext)), decipher.final()]);

      return plaintext.toString('utf8');
    } catch {
      throw new BadRequestException('Invalid encrypted secret');
    }
  }

  private getKey(): Buffer {
    const secretKey = this.configRepository.getEnv().agent.secretKey;
    if (!secretKey) {
      throw new BadRequestException('Agent credential encryption key is not configured');
    }

    if (secretKey.startsWith('base64:')) {
      const key = Buffer.from(secretKey.slice('base64:'.length), 'base64');
      if (key.length !== KEY_BYTES) {
        throw new BadRequestException('Agent credential encryption key must be 32 bytes');
      }

      return key;
    }

    return createHash('sha256').update(secretKey).digest();
  }

  private encode(value: Buffer): string {
    return value.toString('base64url');
  }

  private decode(value: string): Buffer {
    return Buffer.from(value, 'base64url');
  }
}
```

- [ ] **Step 5: Register the service provider**

In `server/src/services/index.ts`, add the import:

```ts
import { EncryptedSecretService } from 'src/services/encrypted-secret.service';
```

Add `EncryptedSecretService` to the `services` array near `DatabaseService`:

```ts
  EncryptedSecretService,
```

- [ ] **Step 6: Run the encrypted-secret tests and typecheck**

Run:

```bash
pnpm --filter immich run test -- --run src/services/encrypted-secret.service.spec.ts
pnpm --filter immich run check
```

Expected: both commands PASS.

- [ ] **Step 7: Commit the encryption foundation**

Run:

```bash
git add server/src/services/encrypted-secret.service.ts server/src/services/encrypted-secret.service.spec.ts server/src/dtos/env.dto.ts server/src/repositories/config.repository.ts server/src/services/index.ts
git commit -m "feat: add encrypted agent secret service"
```

Expected: commit succeeds.

## Task 2: Credential Schema and Repository

**Files:**

- Create: `server/src/schema/tables/agent-provider-credential.table.ts`
- Create: `server/src/schema/migrations/1777000000000-AgentProviderCredential.ts`
- Create: `server/src/repositories/agent-provider-credential.repository.ts`
- Create: `server/test/medium/specs/repositories/agent-provider-credential.repository.spec.ts`
- Modify: `server/src/enum.ts`
- Modify: `server/src/schema/index.ts`
- Modify: `server/src/database.ts`
- Modify: `server/src/repositories/index.ts`

- [ ] **Step 1: Add provider enum**

In `server/src/enum.ts`, add this enum near the other domain enums:

```ts
export enum AgentProviderType {
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  OpenAICompatible = 'openai-compatible',
}
```

- [ ] **Step 2: Add the SQL-tools table**

Create `server/src/schema/tables/agent-provider-credential.table.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AgentProviderType } from 'src/enum';
import { UserTable } from 'src/schema/tables/user.table';

@Index({ columns: ['userId'] })
@Table('agent_provider_credential')
@UpdatedAtTrigger('agent_provider_credential_updatedAt')
export class AgentProviderCredentialTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  userId!: string;

  @Column()
  providerType!: AgentProviderType;

  @Column()
  label!: string;

  @Column({ nullable: true })
  baseUrl!: string | null;

  @Column({ type: 'text' })
  encryptedSecret!: string;

  @Column({ type: 'integer', default: 1 })
  secretVersion!: number;

  @Column({ array: true, type: 'character varying' })
  models!: string[];

  @Column({ nullable: true })
  defaultModel!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastUsedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

- [ ] **Step 3: Register the table and DB type**

In `server/src/schema/index.ts`, add the import:

```ts
import { AgentProviderCredentialTable } from 'src/schema/tables/agent-provider-credential.table';
```

Add the table to `ImmichDatabase.tables`:

```ts
    AgentProviderCredentialTable,
```

Add the DB interface entry:

```ts
agent_provider_credential: AgentProviderCredentialTable;
```

- [ ] **Step 4: Add database type and selected columns**

In `server/src/database.ts`, add the import:

```ts
import { AgentProviderCredentialTable } from 'src/schema/tables/agent-provider-credential.table';
```

Add this exported type near the existing `ApiKey` type:

```ts
export type AgentProviderCredential = Selectable<AgentProviderCredentialTable>;
```

Add the selected column list to `columns` near `apiKey`:

```ts
  agentProviderCredential: [
    'id',
    'userId',
    'providerType',
    'label',
    'baseUrl',
    'encryptedSecret',
    'secretVersion',
    'models',
    'defaultModel',
    'lastUsedAt',
    'createdAt',
    'updatedAt',
    'updateId',
  ],
```

- [ ] **Step 5: Create the migration**

Create `server/src/schema/migrations/1777000000000-AgentProviderCredential.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "agent_provider_credential" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "userId" uuid NOT NULL,
      "providerType" character varying NOT NULL,
      "label" character varying NOT NULL,
      "baseUrl" character varying,
      "encryptedSecret" text NOT NULL,
      "secretVersion" integer NOT NULL DEFAULT 1,
      "models" character varying[] NOT NULL,
      "defaultModel" character varying,
      "lastUsedAt" timestamp with time zone,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "PK_agent_provider_credential_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_agent_provider_credential_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "IDX_agent_provider_credential_userId" ON "agent_provider_credential" ("userId")`.execute(db);
  await sql`CREATE INDEX "IDX_agent_provider_credential_updateId" ON "agent_provider_credential" ("updateId")`.execute(
    db,
  );
  await sql`
    CREATE OR REPLACE TRIGGER "agent_provider_credential_updatedAt"
    BEFORE UPDATE ON "agent_provider_credential"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS "agent_provider_credential_updatedAt" ON "agent_provider_credential"`.execute(db);
  await sql`DROP TABLE "agent_provider_credential"`.execute(db);
}
```

- [ ] **Step 6: Write the failing DB-backed repository test**

Create `server/test/medium/specs/repositories/agent-provider-credential.repository.spec.ts`:

```ts
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
    });

    expect(created).toMatchObject({
      userId: user.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      encryptedSecret: 'v1:encrypted',
      secretVersion: 1,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    });

    await expect(sut.getById(user.id, created.id)).resolves.toMatchObject({ id: created.id });
    await expect(sut.getById(otherUser.id, created.id)).resolves.toBeUndefined();
    await expect(sut.getByUserId(otherUser.id)).resolves.toEqual([]);

    const updated = await sut.update(user.id, created.id, {
      label: 'Renamed',
      providerType: AgentProviderType.OpenAICompatible,
      baseUrl: 'http://localhost:11434/v1',
      encryptedSecret: 'v1:new-encrypted',
      secretVersion: 2,
      models: ['llama3.3'],
      defaultModel: 'llama3.3',
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
      secretVersion: 1,
      models: ['claude-sonnet-4.5'],
      defaultModel: 'claude-sonnet-4.5',
    });

    await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();

    await expect(sut.getById(user.id, created.id)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 7: Run the repository test and verify it fails**

Run:

```bash
pnpm --filter immich run test:medium -- --run test/medium/specs/repositories/agent-provider-credential.repository.spec.ts
```

Expected: FAIL with a module resolution error for `src/repositories/agent-provider-credential.repository`.

- [ ] **Step 8: Create the repository**

Create `server/src/repositories/agent-provider-credential.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { AgentProviderCredentialTable } from 'src/schema/tables/agent-provider-credential.table';
import { asUuid } from 'src/utils/database';

@Injectable()
export class AgentProviderCredentialRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: Insertable<AgentProviderCredentialTable>) {
    return this.db
      .insertInto('agent_provider_credential')
      .values(dto)
      .returning(columns.agentProviderCredential)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getByUserId(userId: string) {
    return this.db
      .selectFrom('agent_provider_credential')
      .select(columns.agentProviderCredential)
      .where('userId', '=', userId)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getById(userId: string, id: string) {
    return this.db
      .selectFrom('agent_provider_credential')
      .select(columns.agentProviderCredential)
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .executeTakeFirst();
  }

  update(userId: string, id: string, dto: Updateable<AgentProviderCredentialTable>) {
    return this.db
      .updateTable('agent_provider_credential')
      .set(dto)
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .returning(columns.agentProviderCredential)
      .executeTakeFirstOrThrow();
  }

  async delete(userId: string, id: string) {
    await this.db
      .deleteFrom('agent_provider_credential')
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .execute();
  }
}
```

- [ ] **Step 9: Register the repository**

In `server/src/repositories/index.ts`, add the import:

```ts
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
```

Add it to `repositories` near `ApiKeyRepository`:

```ts
  AgentProviderCredentialRepository,
```

- [ ] **Step 10: Run the repository test and typecheck**

Run:

```bash
pnpm --filter immich run test:medium -- --run test/medium/specs/repositories/agent-provider-credential.repository.spec.ts
pnpm --filter immich run check
```

Expected: both commands PASS.

- [ ] **Step 11: Commit the schema and repository**

Run:

```bash
git add server/src/enum.ts server/src/schema/index.ts server/src/database.ts server/src/schema/tables/agent-provider-credential.table.ts server/src/schema/migrations/1777000000000-AgentProviderCredential.ts server/src/repositories/agent-provider-credential.repository.ts server/src/repositories/index.ts server/test/medium/specs/repositories/agent-provider-credential.repository.spec.ts
git commit -m "feat: add agent provider credential storage"
```

Expected: commit succeeds.

## Task 3: Credential DTOs and Service Behavior

**Files:**

- Create: `server/src/dtos/agent-provider-credential.dto.ts`
- Create: `server/src/services/agent-provider-credential.service.spec.ts`
- Create: `server/src/services/agent-provider-credential.service.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Add DTOs**

Create `server/src/dtos/agent-provider-credential.dto.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { AgentProviderType } from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const AgentProviderTypeSchema = z
  .enum(AgentProviderType)
  .describe('Agent provider type')
  .meta({ id: 'AgentProviderType' });
const AgentCredentialLabelSchema = z.string().trim().min(1).max(120);
const AgentCredentialSecretSchema = z.string().min(1);
const AgentCredentialModelsSchema = z.array(z.string().trim().min(1));
const AgentCredentialBaseUrlSchema = z.url();

const AgentProviderCredentialCreateSchema = z
  .object({
    providerType: AgentProviderTypeSchema,
    label: AgentCredentialLabelSchema.describe('User-facing credential label'),
    secret: AgentCredentialSecretSchema.describe('Provider API key or token'),
    baseUrl: AgentCredentialBaseUrlSchema.optional().describe('Provider base URL for OpenAI-compatible providers'),
    models: AgentCredentialModelsSchema.optional().describe('Known model IDs for this credential'),
    defaultModel: z.string().trim().min(1).optional().describe('Default model ID for this credential'),
  })
  .superRefine((value, ctx) => {
    if (value.providerType === AgentProviderType.OpenAICompatible && !value.baseUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'baseUrl is required for openai-compatible providers',
      });
    }
  })
  .meta({ id: 'AgentProviderCredentialCreateDto' });

const AgentProviderCredentialUpdateSchema = z
  .object({
    providerType: AgentProviderTypeSchema.optional(),
    label: AgentCredentialLabelSchema.optional().describe('User-facing credential label'),
    secret: AgentCredentialSecretSchema.optional().describe('Replacement provider API key or token'),
    baseUrl: AgentCredentialBaseUrlSchema.nullable()
      .optional()
      .describe('Provider base URL for OpenAI-compatible providers'),
    models: z.array(z.string().trim().min(1)).optional().describe('Known model IDs for this credential'),
    defaultModel: z.string().trim().min(1).nullable().optional().describe('Default model ID for this credential'),
  })
  .meta({ id: 'AgentProviderCredentialUpdateDto' });

const AgentProviderCredentialResponseSchema = z
  .object({
    id: z.string().describe('Credential ID'),
    providerType: AgentProviderTypeSchema,
    label: z.string().describe('User-facing credential label'),
    baseUrl: z.string().nullable().describe('Provider base URL'),
    models: z.array(z.string()).describe('Known model IDs for this credential'),
    defaultModel: z.string().nullable().describe('Default model ID for this credential'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
    updatedAt: isoDatetimeToDate.describe('Last update date'),
    lastUsedAt: isoDatetimeToDate.nullable().describe('Last use date'),
  })
  .meta({ id: 'AgentProviderCredentialResponseDto' });

export class AgentProviderCredentialCreateDto extends createZodDto(AgentProviderCredentialCreateSchema) {}
export class AgentProviderCredentialUpdateDto extends createZodDto(AgentProviderCredentialUpdateSchema) {}
export class AgentProviderCredentialResponseDto extends createZodDto(AgentProviderCredentialResponseSchema) {}
```

- [ ] **Step 2: Write the failing service tests**

Create `server/src/services/agent-provider-credential.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { AgentProviderType } from 'src/enum';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { EncryptedSecretService } from 'src/services/encrypted-secret.service';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import { AuthFactory } from 'test/factories/auth.factory';
import { AutoMocked, automock } from 'test/utils';

describe(AgentProviderCredentialService.name, () => {
  const now = new Date('2026-05-14T12:00:00.000Z');
  let sut: AgentProviderCredentialService;
  let repository: AutoMocked<AgentProviderCredentialRepository>;
  let encryptedSecretService: AutoMocked<EncryptedSecretService>;

  const credential = (overrides = {}) => ({
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-000000000002',
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    encryptedSecret: 'v1:encrypted',
    secretVersion: 1,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    updateId: '00000000-0000-7000-8000-000000000003',
    ...overrides,
  });

  beforeEach(() => {
    repository = automock(AgentProviderCredentialRepository);
    encryptedSecretService = automock(EncryptedSecretService, { args: [{} as never] });
    sut = new AgentProviderCredentialService(repository, encryptedSecretService);
  });

  it('creates a credential encrypted for the authenticated user', async () => {
    const auth = AuthFactory.create();
    const saved = credential({ userId: auth.user.id });
    encryptedSecretService.encrypt.mockReturnValue('v1:encrypted');
    repository.create.mockResolvedValue(saved);

    const response = await sut.create(auth, {
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      secret: 'sk-secret',
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    });

    expect(encryptedSecretService.encrypt).toHaveBeenCalledWith('sk-secret');
    expect(repository.create).toHaveBeenCalledWith({
      userId: auth.user.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      encryptedSecret: 'v1:encrypted',
      secretVersion: 1,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    });
    expect(response).toEqual({
      id: saved.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    });
    expect(response).not.toHaveProperty('secret');
    expect(response).not.toHaveProperty('encryptedSecret');
    expect(response).not.toHaveProperty('secretVersion');
  });

  it('lists only credentials returned for the authenticated user and redacts secrets', async () => {
    const auth = AuthFactory.create();
    const saved = credential({ userId: auth.user.id });
    repository.getByUserId.mockResolvedValue([saved]);

    const response = await sut.getAll(auth);

    expect(repository.getByUserId).toHaveBeenCalledWith(auth.user.id);
    expect(response).toHaveLength(1);
    expect(response[0]).not.toHaveProperty('secret');
    expect(response[0]).not.toHaveProperty('encryptedSecret');
    expect(response[0]).not.toHaveProperty('secretVersion');
  });

  it('throws when fetching a missing credential', async () => {
    const auth = AuthFactory.create();
    repository.getById.mockResolvedValue(undefined);

    await expect(sut.getById(auth, '00000000-0000-4000-8000-000000000001')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates metadata without replacing the secret', async () => {
    const auth = AuthFactory.create();
    const saved = credential({ userId: auth.user.id });
    repository.getById.mockResolvedValue(saved);
    repository.update.mockResolvedValue({ ...saved, label: 'Renamed' });

    await sut.update(auth, saved.id, { label: 'Renamed' });

    expect(encryptedSecretService.encrypt).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(auth.user.id, saved.id, { label: 'Renamed' });
  });

  it('rejects clearing baseUrl on an OpenAI-compatible credential', async () => {
    const auth = AuthFactory.create();
    const saved = credential({
      userId: auth.user.id,
      providerType: AgentProviderType.OpenAICompatible,
      baseUrl: 'http://localhost:11434/v1',
    });
    repository.getById.mockResolvedValue(saved);

    await expect(sut.update(auth, saved.id, { baseUrl: null })).rejects.toThrow(
      'baseUrl is required for openai-compatible providers',
    );

    expect(repository.update).not.toHaveBeenCalled();
  });

  it('allows changing to OpenAI-compatible when an existing baseUrl remains valid', async () => {
    const auth = AuthFactory.create();
    const saved = credential({ userId: auth.user.id, baseUrl: 'http://localhost:11434/v1' });
    repository.getById.mockResolvedValue(saved);
    repository.update.mockResolvedValue({ ...saved, providerType: AgentProviderType.OpenAICompatible });

    await sut.update(auth, saved.id, { providerType: AgentProviderType.OpenAICompatible });

    expect(repository.update).toHaveBeenCalledWith(auth.user.id, saved.id, {
      providerType: AgentProviderType.OpenAICompatible,
    });
  });

  it('re-encrypts secret updates and increments the secret version', async () => {
    const auth = AuthFactory.create();
    const saved = credential({ userId: auth.user.id, secretVersion: 4 });
    repository.getById.mockResolvedValue(saved);
    encryptedSecretService.encrypt.mockReturnValue('v1:new-encrypted');
    repository.update.mockResolvedValue({ ...saved, encryptedSecret: 'v1:new-encrypted', secretVersion: 5 });

    await sut.update(auth, saved.id, { secret: 'sk-new-secret' });

    expect(encryptedSecretService.encrypt).toHaveBeenCalledWith('sk-new-secret');
    expect(repository.update).toHaveBeenCalledWith(auth.user.id, saved.id, {
      encryptedSecret: 'v1:new-encrypted',
      secretVersion: 5,
    });
  });

  it('throws on an empty update body', async () => {
    const auth = AuthFactory.create();
    const saved = credential({ userId: auth.user.id });
    repository.getById.mockResolvedValue(saved);

    await expect(sut.update(auth, saved.id, {})).rejects.toThrow('No credential fields to update');
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('does not leak secret fields from update responses', async () => {
    const auth = AuthFactory.create();
    const saved = credential({ userId: auth.user.id });
    repository.getById.mockResolvedValue(saved);
    repository.update.mockResolvedValue({ ...saved, label: 'Renamed' });

    const response = await sut.update(auth, saved.id, { label: 'Renamed' });

    expect(response).not.toHaveProperty('secret');
    expect(response).not.toHaveProperty('encryptedSecret');
    expect(response).not.toHaveProperty('secretVersion');
  });

  it('decrypts a secret for future session dispatch without exposing it over mapping', async () => {
    const auth = AuthFactory.create();
    const saved = credential({ userId: auth.user.id });
    repository.getById.mockResolvedValue(saved);
    encryptedSecretService.decrypt.mockReturnValue('sk-secret');

    await expect(sut.getSecret(auth, saved.id)).resolves.toBe('sk-secret');

    expect(encryptedSecretService.decrypt).toHaveBeenCalledWith('v1:encrypted');
  });

  it('does not decrypt a missing credential', async () => {
    const auth = AuthFactory.create();
    repository.getById.mockResolvedValue(undefined);

    await expect(sut.getSecret(auth, '00000000-0000-4000-8000-000000000001')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(encryptedSecretService.decrypt).not.toHaveBeenCalled();
  });

  it('deletes an owned credential', async () => {
    const auth = AuthFactory.create();
    const saved = credential({ userId: auth.user.id });
    repository.getById.mockResolvedValue(saved);

    await sut.delete(auth, saved.id);

    expect(repository.delete).toHaveBeenCalledWith(auth.user.id, saved.id);
  });

  it('does not delete a missing credential', async () => {
    const auth = AuthFactory.create();
    repository.getById.mockResolvedValue(undefined);

    await expect(sut.delete(auth, '00000000-0000-4000-8000-000000000001')).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the service tests and verify they fail**

Run:

```bash
pnpm --filter immich run test -- --run src/services/agent-provider-credential.service.spec.ts
```

Expected: FAIL with a module resolution error for `src/services/agent-provider-credential.service`.

- [ ] **Step 4: Implement the service**

Create `server/src/services/agent-provider-credential.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { Updateable } from 'kysely';
import { AgentProviderCredential } from 'src/database';
import {
  AgentProviderCredentialCreateDto,
  AgentProviderCredentialResponseDto,
  AgentProviderCredentialUpdateDto,
} from 'src/dtos/agent-provider-credential.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { AgentProviderType } from 'src/enum';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentProviderCredentialTable } from 'src/schema/tables/agent-provider-credential.table';
import { EncryptedSecretService } from 'src/services/encrypted-secret.service';

@Injectable()
export class AgentProviderCredentialService {
  constructor(
    private repository: AgentProviderCredentialRepository,
    private encryptedSecretService: EncryptedSecretService,
  ) {}

  async create(auth: AuthDto, dto: AgentProviderCredentialCreateDto): Promise<AgentProviderCredentialResponseDto> {
    const credential = await this.repository.create({
      userId: auth.user.id,
      providerType: dto.providerType,
      label: dto.label,
      baseUrl: dto.baseUrl ?? null,
      encryptedSecret: this.encryptedSecretService.encrypt(dto.secret),
      secretVersion: 1,
      models: dto.models ?? [],
      defaultModel: dto.defaultModel ?? null,
    });

    return this.map(credential);
  }

  async getAll(auth: AuthDto): Promise<AgentProviderCredentialResponseDto[]> {
    const credentials = await this.repository.getByUserId(auth.user.id);
    return credentials.map((credential) => this.map(credential));
  }

  async getById(auth: AuthDto, id: string): Promise<AgentProviderCredentialResponseDto> {
    const credential = await this.getOwned(auth, id);
    return this.map(credential);
  }

  async update(
    auth: AuthDto,
    id: string,
    dto: AgentProviderCredentialUpdateDto,
  ): Promise<AgentProviderCredentialResponseDto> {
    const existing = await this.getOwned(auth, id);
    const update: Updateable<AgentProviderCredentialTable> = {};

    if (dto.providerType !== undefined) {
      update.providerType = dto.providerType;
    }

    if (dto.label !== undefined) {
      update.label = dto.label;
    }

    if (dto.baseUrl !== undefined) {
      update.baseUrl = dto.baseUrl;
    }

    if (dto.models !== undefined) {
      update.models = dto.models;
    }

    if (dto.defaultModel !== undefined) {
      update.defaultModel = dto.defaultModel;
    }

    const nextProviderType = dto.providerType ?? existing.providerType;
    const nextBaseUrl = dto.baseUrl !== undefined ? dto.baseUrl : existing.baseUrl;
    if (nextProviderType === AgentProviderType.OpenAICompatible && !nextBaseUrl) {
      throw new BadRequestException('baseUrl is required for openai-compatible providers');
    }

    if (dto.secret !== undefined) {
      update.encryptedSecret = this.encryptedSecretService.encrypt(dto.secret);
      update.secretVersion = existing.secretVersion + 1;
    }

    if (Object.keys(update).length === 0) {
      throw new BadRequestException('No credential fields to update');
    }

    const credential = await this.repository.update(auth.user.id, id, update);
    return this.map(credential);
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    await this.getOwned(auth, id);
    await this.repository.delete(auth.user.id, id);
  }

  async getSecret(auth: AuthDto, id: string): Promise<string> {
    const credential = await this.getOwned(auth, id);
    return this.encryptedSecretService.decrypt(credential.encryptedSecret);
  }

  private async getOwned(auth: AuthDto, id: string): Promise<AgentProviderCredential> {
    const credential = await this.repository.getById(auth.user.id, id);
    if (!credential) {
      throw new BadRequestException('Agent provider credential not found');
    }

    return credential;
  }

  private map(entity: AgentProviderCredential): AgentProviderCredentialResponseDto {
    return {
      id: entity.id,
      providerType: entity.providerType,
      label: entity.label,
      baseUrl: entity.baseUrl,
      models: entity.models,
      defaultModel: entity.defaultModel,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      lastUsedAt: entity.lastUsedAt,
    };
  }
}
```

- [ ] **Step 5: Register the credential service**

In `server/src/services/index.ts`, add the import:

```ts
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
```

Add it to the `services` array near `ApiKeyService`:

```ts
  AgentProviderCredentialService,
```

- [ ] **Step 6: Run service tests and typecheck**

Run:

```bash
pnpm --filter immich run test -- --run src/services/agent-provider-credential.service.spec.ts
pnpm --filter immich run check
```

Expected: both commands PASS.

- [ ] **Step 7: Commit the credential service**

Run:

```bash
git add server/src/dtos/agent-provider-credential.dto.ts server/src/services/agent-provider-credential.service.ts server/src/services/agent-provider-credential.service.spec.ts server/src/services/index.ts
git commit -m "feat: add agent provider credential service"
```

Expected: commit succeeds.

## Task 4: Credential Controller, Permissions, and API Tag

**Files:**

- Create: `server/src/controllers/agent-provider-credential.controller.spec.ts`
- Create: `server/src/controllers/agent-provider-credential.controller.ts`
- Modify: `server/src/enum.ts`
- Modify: `server/src/constants.ts`
- Modify: `server/src/controllers/index.ts`

- [ ] **Step 1: Add permissions and API tag**

In `server/src/enum.ts`, add permissions near the existing API key permissions:

```ts
  AgentCredentialCreate = 'agentCredential.create',
  AgentCredentialRead = 'agentCredential.read',
  AgentCredentialUpdate = 'agentCredential.update',
  AgentCredentialDelete = 'agentCredential.delete',
```

In `server/src/enum.ts`, add an API tag near `ApiKeys`:

```ts
  AgentCredentials = 'Agent credentials',
```

In `server/src/constants.ts`, add this entry to `endpointTags`:

```ts
  [ApiTag.AgentCredentials]: 'AI agent provider credential management',
```

- [ ] **Step 2: Write the failing controller tests**

Create `server/src/controllers/agent-provider-credential.controller.spec.ts`:

```ts
import { AgentProviderCredentialController } from 'src/controllers/agent-provider-credential.controller';
import { AgentProviderType } from 'src/enum';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentProviderCredentialController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentProviderCredentialService, { args: [{} as never, {} as never], strict: false });
  const response = {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
    createdAt: new Date('2026-05-14T12:00:00.000Z'),
    updatedAt: new Date('2026-05-14T12:00:00.000Z'),
    lastUsedAt: null,
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentProviderCredentialController, [
      { provide: AgentProviderCredentialService, useValue: service },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /agent/provider-credentials', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/agent/provider-credentials').send({
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
        secret: 'sk-secret',
      });

      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('calls the service and returns a redacted response', async () => {
      const auth = AuthFactory.create();
      ctx.authenticate.mockResolvedValue(auth);
      service.create.mockResolvedValue(response);

      const { status, body } = await request(ctx.getHttpServer())
        .post('/agent/provider-credentials')
        .send({
          providerType: AgentProviderType.OpenAI,
          label: 'OpenAI personal',
          secret: 'sk-secret',
          models: ['gpt-5.1'],
          defaultModel: 'gpt-5.1',
        });

      expect(status).toBe(201);
      expect(service.create).toHaveBeenCalledWith(auth, {
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
        secret: 'sk-secret',
        models: ['gpt-5.1'],
        defaultModel: 'gpt-5.1',
      });
      expect(body).not.toHaveProperty('secret');
      expect(body).not.toHaveProperty('encryptedSecret');
      expect(body).not.toHaveProperty('secretVersion');
    });

    it('requires baseUrl for openai-compatible providers', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/agent/provider-credentials').send({
        providerType: AgentProviderType.OpenAICompatible,
        label: 'Gateway',
        secret: 'secret',
      });

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.badRequest([expect.stringContaining('baseUrl is required for openai-compatible providers')]),
      );
    });

    it('requires a secret', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/agent/provider-credentials').send({
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
      });

      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.badRequest(['[secret] Invalid input: expected string, received undefined']),
      );
    });

    it('requires a non-empty label', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/agent/provider-credentials').send({
        providerType: AgentProviderType.OpenAI,
        label: '',
        secret: 'sk-secret',
      });

      expect(status).toBe(400);
      expect(body).toEqual(factory.responses.badRequest([expect.stringContaining('[label]')]));
    });
  });

  describe('GET /agent/provider-credentials', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/agent/provider-credentials');

      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('calls the service with auth', async () => {
      const auth = AuthFactory.create();
      ctx.authenticate.mockResolvedValue(auth);
      service.getAll.mockResolvedValue([response]);

      const { status, body } = await request(ctx.getHttpServer()).get('/agent/provider-credentials');

      expect(status).toBe(200);
      expect(service.getAll).toHaveBeenCalledWith(auth);
      expect(body).toHaveLength(1);
      expect(body[0]).not.toHaveProperty('secret');
      expect(body[0]).not.toHaveProperty('encryptedSecret');
      expect(body[0]).not.toHaveProperty('secretVersion');
    });
  });

  describe('GET /agent/provider-credentials/:id', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get(`/agent/provider-credentials/${factory.uuid()}`);

      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('requires a valid uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer()).get('/agent/provider-credentials/not-a-uuid');

      expect(status).toBe(400);
      expect(body).toEqual(factory.responses.badRequest(['[id] Invalid UUID']));
    });

    it('calls the service with auth and id', async () => {
      const auth = AuthFactory.create();
      const id = factory.uuid();
      ctx.authenticate.mockResolvedValue(auth);
      service.getById.mockResolvedValue({ ...response, id });

      const { status, body } = await request(ctx.getHttpServer()).get(`/agent/provider-credentials/${id}`);

      expect(status).toBe(200);
      expect(service.getById).toHaveBeenCalledWith(auth, id);
      expect(body).not.toHaveProperty('secret');
      expect(body).not.toHaveProperty('encryptedSecret');
      expect(body).not.toHaveProperty('secretVersion');
    });
  });

  describe('PUT /agent/provider-credentials/:id', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).put(`/agent/provider-credentials/${factory.uuid()}`).send({
        label: 'Renamed',
      });

      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('requires a valid uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put('/agent/provider-credentials/not-a-uuid')
        .send({ label: 'Renamed' });

      expect(status).toBe(400);
      expect(body).toEqual(factory.responses.badRequest(['[id] Invalid UUID']));
    });

    it('calls the service with auth, id, and body', async () => {
      const auth = AuthFactory.create();
      const id = factory.uuid();
      ctx.authenticate.mockResolvedValue(auth);
      service.update.mockResolvedValue({ ...response, id, label: 'Renamed' });

      const { status, body } = await request(ctx.getHttpServer())
        .put(`/agent/provider-credentials/${id}`)
        .send({ label: 'Renamed' });

      expect(status).toBe(200);
      expect(service.update).toHaveBeenCalledWith(auth, id, { label: 'Renamed' });
      expect(body).not.toHaveProperty('secret');
      expect(body).not.toHaveProperty('encryptedSecret');
      expect(body).not.toHaveProperty('secretVersion');
    });
  });

  describe('DELETE /agent/provider-credentials/:id', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).delete(`/agent/provider-credentials/${factory.uuid()}`);

      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('requires a valid uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer()).delete('/agent/provider-credentials/not-a-uuid');

      expect(status).toBe(400);
      expect(body).toEqual(factory.responses.badRequest(['[id] Invalid UUID']));
    });

    it('returns 204 and calls the service with auth and id', async () => {
      const auth = AuthFactory.create();
      const id = factory.uuid();
      ctx.authenticate.mockResolvedValue(auth);

      const { status, body } = await request(ctx.getHttpServer()).delete(`/agent/provider-credentials/${id}`);

      expect(status).toBe(204);
      expect(body).toEqual({});
      expect(service.delete).toHaveBeenCalledWith(auth, id);
    });
  });
});
```

- [ ] **Step 3: Run the controller tests and verify they fail**

Run:

```bash
pnpm --filter immich run test -- --run src/controllers/agent-provider-credential.controller.spec.ts
```

Expected: FAIL with a module resolution error for `src/controllers/agent-provider-credential.controller`.

- [ ] **Step 4: Implement the controller**

Create `server/src/controllers/agent-provider-credential.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import {
  AgentProviderCredentialCreateDto,
  AgentProviderCredentialResponseDto,
  AgentProviderCredentialUpdateDto,
} from 'src/dtos/agent-provider-credential.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.AgentCredentials)
@Controller('agent/provider-credentials')
export class AgentProviderCredentialController {
  constructor(private service: AgentProviderCredentialService) {}

  @Post()
  @Authenticated({ permission: Permission.AgentCredentialCreate })
  @Endpoint({
    summary: 'Create an agent provider credential',
    description: 'Creates an encrypted AI provider credential for the current user.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  createCredential(
    @Auth() auth: AuthDto,
    @Body() dto: AgentProviderCredentialCreateDto,
  ): Promise<AgentProviderCredentialResponseDto> {
    return this.service.create(auth, dto);
  }

  @Get()
  @Authenticated({ permission: Permission.AgentCredentialRead })
  @Endpoint({
    summary: 'List agent provider credentials',
    description: 'Retrieves encrypted AI provider credential metadata for the current user.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getCredentials(@Auth() auth: AuthDto): Promise<AgentProviderCredentialResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.AgentCredentialRead })
  @Endpoint({
    summary: 'Retrieve an agent provider credential',
    description: 'Retrieves encrypted AI provider credential metadata by ID. The current user must own it.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getCredential(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AgentProviderCredentialResponseDto> {
    return this.service.getById(auth, id);
  }

  @Put(':id')
  @Authenticated({ permission: Permission.AgentCredentialUpdate })
  @Endpoint({
    summary: 'Update an agent provider credential',
    description: 'Updates encrypted AI provider credential metadata or replaces its secret.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  updateCredential(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentProviderCredentialUpdateDto,
  ): Promise<AgentProviderCredentialResponseDto> {
    return this.service.update(auth, id, dto);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.AgentCredentialDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete an agent provider credential',
    description: 'Deletes an encrypted AI provider credential. The current user must own it.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  deleteCredential(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.delete(auth, id);
  }
}
```

- [ ] **Step 5: Register the controller**

In `server/src/controllers/index.ts`, add the import:

```ts
import { AgentProviderCredentialController } from 'src/controllers/agent-provider-credential.controller';
```

Add it to `controllers` near `ApiKeyController`:

```ts
  AgentProviderCredentialController,
```

- [ ] **Step 6: Run controller tests and typecheck**

Run:

```bash
pnpm --filter immich run test -- --run src/controllers/agent-provider-credential.controller.spec.ts
pnpm --filter immich run check
```

Expected: both commands PASS.

- [ ] **Step 7: Commit the controller**

Run:

```bash
git add server/src/controllers/agent-provider-credential.controller.ts server/src/controllers/agent-provider-credential.controller.spec.ts server/src/controllers/index.ts server/src/enum.ts server/src/constants.ts
git commit -m "feat: add agent provider credential api"
```

Expected: commit succeeds.

## Task 5: Generated API Artifacts and Full Verification

**Files:**

- Modify: generated OpenAPI and TypeScript SDK files changed by `make open-api-typescript`

- [ ] **Step 1: Generate OpenAPI TypeScript artifacts**

Run:

```bash
make open-api-typescript
```

Expected: command exits 0 and updates generated OpenAPI/SDK files for the new `Agent credentials` endpoints.

- [ ] **Step 2: Run focused server tests**

Run:

```bash
pnpm --filter immich run test -- --run src/services/encrypted-secret.service.spec.ts src/services/agent-provider-credential.service.spec.ts src/controllers/agent-provider-credential.controller.spec.ts
pnpm --filter immich run test:medium -- --run test/medium/specs/repositories/agent-provider-credential.repository.spec.ts
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run server typecheck and lint**

Run:

```bash
pnpm --filter immich run check
pnpm --filter immich run lint
```

Expected: both commands PASS.

- [ ] **Step 4: Run generated SQL sync**

Run:

```bash
pnpm --filter immich run build
pnpm --filter immich run sync:sql
```

Expected: both commands exit 0. If `sync:sql` updates generated SQL snapshots, include those changes in the final commit.

- [ ] **Step 5: Review the final diff for secret leaks**

Run:

```bash
git diff --stat
git diff -- server/src/services/agent-provider-credential.service.ts server/src/controllers/agent-provider-credential.controller.ts server/src/dtos/agent-provider-credential.dto.ts
rg "encryptedSecret|secretVersion|secret" server/src/controllers/agent-provider-credential.controller.ts server/src/dtos/agent-provider-credential.dto.ts server/src/services/agent-provider-credential.service.ts
```

Expected:

- Controller has no route that returns `secret`, `encryptedSecret`, or `secretVersion`.
- Response DTO has no `secret`, `encryptedSecret`, or `secretVersion`.
- Service maps do not include `secret`, `encryptedSecret`, or `secretVersion`.
- Service only uses `secret` as request input and `encryptedSecret` as repository storage.

- [ ] **Step 6: Commit generated artifacts and verification-safe polish**

Run:

```bash
git status --short
git add open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts server/src/queries/agent.provider.credential.repository.sql
git commit -m "chore: update agent credential api artifacts"
```

Expected: commit succeeds if generated files changed. If `git status --short` is clean after verification, skip this commit.

## Self-Review Checklist

- Spec coverage: This plan implements only the first approved vertical slice, credential storage foundation, including encrypted table storage, DB-backed repository CRUD, HTTP CRUD APIs, ownership, redaction, and encryption/decryption boundaries.
- Out of scope is explicit: runner, chat, permission plans, album plans, album writes, Assistant UI, and local model execution are excluded from this first slice.
- TDD: Tasks 1, 2, 3, and 4 start from failing tests before implementation. Task 2 includes a medium repository test that proves the table, migration, selected columns, user scoping, updates, deletes, and user-delete cascade.
- Type consistency: The plan uses `AgentProviderCredential`, `AgentProviderCredentialTable`, `AgentProviderCredentialRepository`, `AgentProviderCredentialService`, and `AgentProviderCredentialController` consistently.
- Secret safety: HTTP response DTOs and service mapping omit `secret`, `encryptedSecret`, and `secretVersion`; only the internal `getSecret()` service method decrypts for future runner dispatch.
- Deployment behavior: `IMMICH_AGENT_SECRET_KEY` is optional so Gallery boots without agent configuration; credential writes and decrypts fail clearly when the key is missing.
