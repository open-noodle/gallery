import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE "agent_session"
    SET "permissionPlanSnapshot" = jsonb_set(
      jsonb_set(
        "permissionPlanSnapshot",
        '{limits,maxPreviewsPerSession}',
        COALESCE(
          "permissionPlanSnapshot" #> '{limits,maxPreviewsPerSession}',
          "permissionPlanSnapshot" #> '{limits,maxPreviewsPerToolCall}',
          '0'::jsonb
        ),
        true
      ),
      '{limits,maxOriginalsPerSession}',
      COALESCE(
        "permissionPlanSnapshot" #> '{limits,maxOriginalsPerSession}',
        "permissionPlanSnapshot" #> '{limits,maxOriginalsPerToolCall}',
        '0'::jsonb
      ),
      true
    )
    WHERE "permissionPlanSnapshot" #> '{limits,maxPreviewsPerSession}' IS NULL
      OR "permissionPlanSnapshot" #> '{limits,maxOriginalsPerSession}' IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE "agent_session"
    SET "permissionPlanSnapshot" =
      ("permissionPlanSnapshot" #- '{limits,maxPreviewsPerSession}') #- '{limits,maxOriginalsPerSession}'
  `.execute(db);
}
