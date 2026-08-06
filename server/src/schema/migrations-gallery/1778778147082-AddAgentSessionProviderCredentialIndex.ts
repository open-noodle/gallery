import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE INDEX "agent_session_providerCredentialId_idx" ON "agent_session" ("providerCredentialId")`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX "agent_session_providerCredentialId_idx"`.execute(db);
}
