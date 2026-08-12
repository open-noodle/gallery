import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('physicalUsageInBytes column', () => {
  it('exists after migrations and defaults to zero', async () => {
    const result = await sql<{
      column_default: string | null;
      is_nullable: string;
    }>`SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_name = 'user' AND column_name = 'physicalUsageInBytes'`.execute(db);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].is_nullable).toBe('NO');
    expect(result.rows[0].column_default).toBe('0');
  });
});
