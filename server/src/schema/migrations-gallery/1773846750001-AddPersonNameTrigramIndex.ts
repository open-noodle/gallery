import { Kysely } from 'kysely';

// Stub: upstream renamed this migration to 1775165531374-AddPersonNameTrigramIndex.
// This empty file exists so Kysely's missing-migration validation passes on databases
// that already ran the original migration under this name.
export async function up(_db: Kysely<any>): Promise<void> {}
export async function down(_db: Kysely<any>): Promise<void> {}
