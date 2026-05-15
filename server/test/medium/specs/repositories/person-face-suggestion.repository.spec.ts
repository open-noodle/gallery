import { Kysely } from 'kysely';
import { PersonFaceSuggestionRepository } from 'src/repositories/person-face-suggestion.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [PersonFaceSuggestionRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(PersonFaceSuggestionRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterAll(async () => {
  await defaultDatabase.destroy();
});

describe('PersonFaceSuggestionRepository', () => {
  it('is constructible via the medium service container', () => {
    const { sut } = setup();
    expect(sut).toBeInstanceOf(PersonFaceSuggestionRepository);
  });
});
