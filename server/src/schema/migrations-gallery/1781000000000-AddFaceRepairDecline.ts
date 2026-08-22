import { Kysely, sql } from 'kysely';
import { personKeyTarget } from 'src/utils/cluster-groups-order';

export async function up(db: Kysely<any>): Promise<void> {
  // On an Immich-to-Gallery switch upstream's ClusterGroups has already run, so `person.id` is gone and
  // these keys must reference `person_group.id` from the start. On a fresh install `person.id` still
  // exists here and 1791 repoints them later. Either way the column keeps its original name so 1791's
  // rename applies in both worlds — see src/utils/cluster-groups-order.ts.
  const personTable = sql.table(await personKeyTarget(db));
  await sql`
    CREATE TABLE "face_repair_decline" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "type" character varying NOT NULL,
      "assetFaceId" uuid,
      "suspectedOwnerId" uuid,
      "personId" uuid,
      "suspectedOwnerIds" jsonb,
      "declinedBy" uuid,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "face_repair_decline_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "face_repair_decline_assetFaceId_fkey" FOREIGN KEY ("assetFaceId") REFERENCES "asset_face" ("id") ON DELETE CASCADE,
      CONSTRAINT "face_repair_decline_suspectedOwnerId_fkey" FOREIGN KEY ("suspectedOwnerId") REFERENCES ${personTable} ("id") ON DELETE CASCADE,
      CONSTRAINT "face_repair_decline_personId_fkey" FOREIGN KEY ("personId") REFERENCES ${personTable} ("id") ON DELETE CASCADE,
      CONSTRAINT "face_repair_decline_declinedBy_fkey" FOREIGN KEY ("declinedBy") REFERENCES "user" ("id") ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE INDEX "face_repair_decline_assetFaceId_idx" ON "face_repair_decline" ("assetFaceId")`.execute(db);
  await sql`CREATE INDEX "face_repair_decline_personId_idx" ON "face_repair_decline" ("personId")`.execute(db);
  await sql`CREATE UNIQUE INDEX "face_repair_decline_face_owner_uq" ON "face_repair_decline" ("assetFaceId", "suspectedOwnerId")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "face_repair_decline"`.execute(db);
}
