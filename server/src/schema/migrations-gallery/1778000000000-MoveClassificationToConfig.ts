import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Step 1: Read existing categories
  const categories = await sql<{
    name: string;
    similarity: number;
    action: string;
    enabled: boolean;
    prompts: string[] | null;
  }>`
    SELECT c.name, c.similarity, c.action, c.enabled,
           array_remove(array_agg(p.prompt ORDER BY p."createdAt"), NULL) AS prompts
    FROM classification_category c
    LEFT JOIN classification_prompt_embedding p ON p."categoryId" = c.id
    GROUP BY c.id, c.name, c.similarity, c.action, c.enabled
    ORDER BY c.name
  `.execute(db);

  // Filter out categories with no prompts
  const validCategories = categories.rows.filter((c) => c.prompts && c.prompts.length > 0);

  if (categories.rows.length > validCategories.length) {
    const skipped = categories.rows.length - validCategories.length;
    console.log(`Classification migration: skipping ${skipped} category(ies) with no prompts`);
  }

  // Step 2: Merge into system_metadata if we have categories
  if (validCategories.length > 0) {
    const classificationConfig = {
      classification: {
        enabled: true,
        categories: validCategories.map((c) => ({
          name: c.name,
          prompts: c.prompts,
          similarity: c.similarity,
          action: c.action,
          enabled: c.enabled,
        })),
      },
    };

    // Read existing config
    const existing = await sql<{ value: any }>`
      SELECT value FROM system_metadata WHERE key = 'system-config'
    `.execute(db);

    if (existing.rows.length > 0) {
      const currentConfig = existing.rows[0].value || {};
      const merged = { ...currentConfig, ...classificationConfig };
      await sql`
        UPDATE system_metadata SET value = ${JSON.stringify(merged)}::jsonb
        WHERE key = 'system-config'
      `.execute(db);
    } else {
      await sql`
        INSERT INTO system_metadata (key, value)
        VALUES ('system-config', ${JSON.stringify(classificationConfig)}::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `.execute(db);
    }

    // Warn config file users
    if (process.env.IMMICH_CONFIG_FILE) {
      console.log(
        'Classification categories migrated to system config in database. ' +
          'You are using a config file (IMMICH_CONFIG_FILE) — add your categories to the YAML file manually.',
      );
    }

    console.log(`Classification migration: migrated ${validCategories.length} category(ies) to system config`);
  }

  // Step 3: Drop tables
  await sql`DROP TABLE IF EXISTS classification_prompt_embedding`.execute(db);
  await sql`DROP TABLE IF EXISTS classification_category`.execute(db);

  // Step 4: Clean up trigger override
  await sql`DELETE FROM migration_overrides WHERE name = 'trigger_classification_category_updatedAt'`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Recreate tables (empty)
  await sql`
    CREATE TABLE classification_category (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar NOT NULL,
      similarity real NOT NULL DEFAULT 0.28,
      action varchar NOT NULL DEFAULT 'tag',
      enabled boolean NOT NULL DEFAULT true,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT gen_random_uuid(),
      CONSTRAINT "classification_category_name_uq" UNIQUE (name)
    )
  `.execute(db);

  await sql`
    CREATE TABLE classification_prompt_embedding (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "categoryId" uuid NOT NULL REFERENCES classification_category(id) ON UPDATE CASCADE ON DELETE CASCADE,
      prompt text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  // Remove classification from system config
  await sql`
    UPDATE system_metadata
    SET value = value - 'classification'
    WHERE key = 'system-config'
  `.execute(db);
}
