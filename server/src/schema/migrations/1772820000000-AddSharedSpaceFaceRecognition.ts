import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add faceRecognitionEnabled to shared_space
  await db.schema
    .alterTable('shared_space')
    .addColumn('faceRecognitionEnabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .execute();

  // Create shared_space_person table
  await db.schema
    .createTable('shared_space_person')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('spaceId', 'uuid', (col) => col.notNull().references('shared_space.id').onDelete('cascade'))
    .addColumn('name', 'varchar', (col) => col.notNull().defaultTo(''))
    .addColumn('representativeFaceId', 'uuid', (col) => col.references('asset_face.id').onDelete('set null'))
    .addColumn('thumbnailPath', 'varchar', (col) => col.notNull().defaultTo(''))
    .addColumn('isHidden', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('birthDate', 'date')
    .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updatedAt', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('shared_space_person_spaceId_idx')
    .on('shared_space_person')
    .columns(['spaceId'])
    .execute();

  // Create updatedAt trigger for shared_space_person
  await sql`
    CREATE TRIGGER "shared_space_person_updatedAt"
    BEFORE UPDATE ON "shared_space_person"
    FOR EACH ROW EXECUTE FUNCTION updated_at()
  `.execute(db);

  // Create shared_space_person_face junction table
  await db.schema
    .createTable('shared_space_person_face')
    .addColumn('personId', 'uuid', (col) => col.notNull().references('shared_space_person.id').onDelete('cascade'))
    .addColumn('assetFaceId', 'uuid', (col) => col.notNull().references('asset_face.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('PK_shared_space_person_face', ['personId', 'assetFaceId'])
    .execute();

  await db.schema
    .createIndex('shared_space_person_face_assetFaceId_idx')
    .on('shared_space_person_face')
    .columns(['assetFaceId'])
    .execute();

  // Create shared_space_person_alias table
  await db.schema
    .createTable('shared_space_person_alias')
    .addColumn('personId', 'uuid', (col) => col.notNull().references('shared_space_person.id').onDelete('cascade'))
    .addColumn('userId', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('alias', 'varchar', (col) => col.notNull())
    .addPrimaryKeyConstraint('PK_shared_space_person_alias', ['personId', 'userId'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('shared_space_person_alias').ifExists().execute();
  await db.schema.dropTable('shared_space_person_face').ifExists().execute();
  await sql`DROP TRIGGER IF EXISTS "shared_space_person_updatedAt" ON "shared_space_person"`.execute(db);
  await db.schema.dropTable('shared_space_person').ifExists().execute();
  await db.schema.alterTable('shared_space').dropColumn('faceRecognitionEnabled').execute();
}
