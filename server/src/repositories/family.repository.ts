import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';

@Injectable()
export class FamilyRepository {
  constructor(
    @InjectKysely() private db: Kysely<DB>,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(FamilyRepository.name);
  }

  getAccess(userId: string) {
    return this.db.selectFrom('family_access').select('level').where('userId', '=', userId).executeTakeFirst();
  }
}
