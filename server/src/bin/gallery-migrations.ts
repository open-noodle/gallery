#!/usr/bin/env node
// `sql-tools migrations run|revert` only know `kysely_migrations`, so they cannot apply or revert fork
// migrations. These commands go through the server's own migrator, which handles both ledgers.
import { Kysely } from 'kysely';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { getKyselyConfig } from 'src/utils/database.js';

const command = process.argv[2];
if (command !== 'run' && command !== 'revert') {
  console.error('Usage: gallery-migrations <run|revert>');
  process.exit(1);
}

const configRepository = new ConfigRepository();
const db = new Kysely<DB>(getKyselyConfig(configRepository.getEnv().database.config));
const repository = new DatabaseRepository(db, LoggingRepository.create(), configRepository);

(command === 'run' ? repository.runMigrations() : repository.revertLastMigration())
  .then(() => db.destroy())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
