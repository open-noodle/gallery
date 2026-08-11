import { Kysely } from 'kysely';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [FaceIdentityRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(FaceIdentityRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const collectIdentityQueryText = () => {
  const files = [
    join(process.cwd(), 'src/repositories/face-identity.repository.ts'),
    join(process.cwd(), 'src/repositories/search.repository.ts'),
    join(process.cwd(), 'src/queries/face.identity.repository.sql'),
  ].filter((path) => existsSync(path));

  return files.map((path) => readFileSync(path, 'utf8')).join('\n');
};

const collectGeneratedFaceIdentitySqlMethod = (methodName: string) => {
  const file = join(process.cwd(), 'src/queries/face.identity.repository.sql');
  const sqlText = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const marker = `-- ${methodName}`;
  const start = sqlText.indexOf(marker);
  if (start === -1) {
    return '';
  }

  const next = sqlText.indexOf('\n-- ', start + marker.length);
  return sqlText.slice(start, next === -1 ? undefined : next);
};

describe('Face identity query shape', () => {
  it('pages identity ids before hydrating scoped people rows', async () => {
    const { ctx, sut } = setup();
    const { user: viewer } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const accessiblePersonIds: string[] = [];
    const inaccessiblePersonIds: string[] = [];

    for (const ownerId of [viewer.id, viewer.id, viewer.id, viewer.id, stranger.id, stranger.id]) {
      const { person } = await ctx.newPerson({ ownerId, name: `Person ${ownerId} ${accessiblePersonIds.length}` });
      const { asset } = await ctx.newAsset({ ownerId });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
      const identity = await sut.ensurePersonIdentity(person.id);
      await sut.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });

      if (ownerId === viewer.id) {
        accessiblePersonIds.push(person.id);
      } else {
        inaccessiblePersonIds.push(person.id);
      }
    }

    const page = await sut.getAccessiblePeopleIdentityPage({
      userId: viewer.id,
      withHidden: true,
      limit: 3,
      offset: 0,
      minimumFaceCount: 1,
    });
    const hydrated = await sut.hydrateAccessiblePeople({
      userId: viewer.id,
      identityIds: page.map((row) => row.identityId),
      withHidden: true,
    });

    expect(accessiblePersonIds).toHaveLength(4);
    expect(page).toHaveLength(3);
    expect(hydrated).toHaveLength(3);
    expect(hydrated.map((person) => person.id)).not.toEqual(expect.arrayContaining(inaccessiblePersonIds));
  });

  it('does not run vector similarity for people, filters, or identity-token asset paths', () => {
    const sqlText = collectIdentityQueryText();
    // Each slice is delimited by method names. A rename that stops one matching used to yield ''
    // silently, which would make every `not.toContain` below pass while checking nothing — so a
    // miss is a hard failure instead.
    const slice = (pattern: RegExp): string => {
      const matched = pattern.exec(sqlText)?.[0];
      if (!matched) {
        throw new Error(`query-shape slice matched nothing: ${pattern} — did a method get renamed?`);
      }
      return matched;
    };
    const identityOnlyText = [
      slice(/private async queryAccessiblePeoplePage[\s\S]*?async hydrateAccessiblePeople/),
      slice(/async getAccessiblePeopleStatistics[\s\S]*?async getAccessiblePeopleIdentityPage/),
      slice(/async getAccessiblePeopleFaceStatistics[\s\S]*?async getAccessiblePersonByProfileId/),
      slice(/async getAccessiblePersonStatistics[\s\S]*?async getAccessibleProfileIdentityId/),
      slice(/async hydrateAccessiblePeople[\s\S]*?private mapAccessiblePerson/),
      slice(/async getAccessiblePersonFilterSuggestions[\s\S]*?async getAccessiblePeople/),
      slice(/async searchAccessiblePeople[\s\S]*?async getAccessiblePersonFilterSuggestions/),
      slice(/private async getFilteredIdentityPeople[\s\S]*?private async getFilteredRatings/),
      slice(/identity-filter-suggestions[\s\S]*?async getFilterSuggestions/),
    ].join('\n');

    expect(identityOnlyText).toContain('face_identity_face');
    expect(identityOnlyText).toContain('getAccessiblePeopleFaceStatistics');
    expect(identityOnlyText).not.toContain('<=>');
    expect(identityOnlyText).not.toContain('face_search.embedding');
    expect(identityOnlyText).not.toContain('clip_index');
  });

  it('does not run vector similarity for person detail statistics generated SQL', () => {
    const personStatisticsSql = collectGeneratedFaceIdentitySqlMethod(
      'FaceIdentityRepository.getAccessiblePersonStatistics',
    );

    expect(personStatisticsSql).toContain('FaceIdentityRepository.getAccessiblePersonStatistics');
    expect(personStatisticsSql).toContain('face_identity_face');
    expect(personStatisticsSql).not.toContain('<=>');
    expect(personStatisticsSql).not.toContain('face_search.embedding');
    expect(personStatisticsSql).not.toContain('clip_index');
    expect(personStatisticsSql).not.toMatch(/\bcosine\b/i);
    expect(personStatisticsSql).not.toMatch(/\bembedding\b/i);
  });

  it('keeps pagination in the identity page query instead of hydrating all identities first', () => {
    const sqlText = collectIdentityQueryText();
    const identityPageQuery = /private async queryAccessiblePeoplePage[\s\S]*?async hydrateAccessiblePeople/.exec(
      sqlText,
    )?.[0];

    expect(identityPageQuery).toContain('LIMIT ${input.limit}');
    expect(identityPageQuery).toContain('OFFSET ${input.offset}');
    expect(identityPageQuery).toContain('timeline_spaces');
    expect(identityPageQuery).toContain('accessible_faces');
    expect(identityPageQuery).not.toContain('face_search');
  });
});
