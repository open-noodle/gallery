import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB } from 'src/schema';

@Injectable()
export class PersonFaceSuggestionRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}
}
