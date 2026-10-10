import { Expression, SelectQueryBuilder, SqlBool } from 'kysely';
import { DB } from 'src/schema/index.js';
import { anyUuid, asUuid, hasPeople, uniqueTruthyIds } from 'src/utils/database.js';

export function hasAnyPerson<O>(qb: SelectQueryBuilder<DB, 'asset', O>, personIds: string[]) {
  const ids = uniqueTruthyIds(personIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('asset_face')
        .select('assetId')
        .where('personGroupId', '=', anyUuid(ids))
        .where('deletedAt', 'is', null)
        .where('isVisible', 'is', true)
        .groupBy('assetId')
        .as('has_any_person'),
    (join) => join.onRef('has_any_person.assetId', '=', 'asset.id'),
  );
}

export function hasFaceIdentities<O>(qb: SelectQueryBuilder<DB, 'asset', O>, identityIds: string[]) {
  const ids = uniqueTruthyIds(identityIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('asset_face')
        .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
        .select('asset_face.assetId')
        .where('face_identity_face.identityId', '=', anyUuid(ids))
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .groupBy('asset_face.assetId')
        .having((eb) => eb.fn.count('face_identity_face.identityId').distinct(), '=', ids.length)
        .as('has_face_identities'),
    (join) => join.onRef('has_face_identities.assetId', '=', 'asset.id'),
  );
}

export function hasAnyFaceIdentity<O>(qb: SelectQueryBuilder<DB, 'asset', O>, identityIds: string[]) {
  const ids = uniqueTruthyIds(identityIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.innerJoin(
    (eb) =>
      eb
        .selectFrom('asset_face')
        .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
        .select('asset_face.assetId')
        .where('face_identity_face.identityId', '=', anyUuid(ids))
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .groupBy('asset_face.assetId')
        .as('has_any_face_identity'),
    (join) => join.onRef('has_any_face_identity.assetId', '=', 'asset.id'),
  );
}

export function hasSpacePerson<O>(qb: SelectQueryBuilder<DB, 'asset', O>, spacePersonId: string) {
  return qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .whereRef('asset_face.assetId', '=', 'asset.id')
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .where('shared_space_person_face.personId', '=', asUuid(spacePersonId)),
    ),
  );
}

export function hasAnySpacePerson<O>(qb: SelectQueryBuilder<DB, 'asset', O>, spacePersonIds: string[]) {
  const ids = uniqueTruthyIds(spacePersonIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .whereRef('asset_face.assetId', '=', 'asset.id')
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', 'is', true)
        .where('shared_space_person_face.personId', '=', anyUuid(ids)),
    ),
  );
}

export function hasSpacePeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, spacePersonIds: string[]) {
  const ids = uniqueTruthyIds(spacePersonIds);
  if (ids.length === 0) {
    return qb;
  }

  return qb.where((eb) =>
    eb.and(
      ids.map((spacePersonId) =>
        eb.exists(
          eb
            .selectFrom('shared_space_person_face')
            .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('shared_space_person_face.personId', '=', asUuid(spacePersonId)),
        ),
      ),
    ),
  );
}

type PeopleFilterIds = { personIds?: string[]; identityIds?: string[]; spacePersonIds?: string[] };

export function hasAllPeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, filters: PeopleFilterIds) {
  const personIds = uniqueTruthyIds(filters.personIds);
  const identityIds = uniqueTruthyIds(filters.identityIds);
  const spacePersonIds = uniqueTruthyIds(filters.spacePersonIds);

  return qb
    .$if(personIds.length > 0, (qb) => hasPeople(qb, personIds))
    .$if(identityIds.length > 0, (qb) => hasFaceIdentities(qb, identityIds))
    .$if(spacePersonIds.length > 0, (qb) => hasSpacePeople(qb, spacePersonIds));
}

export function hasAnyPeople<O>(qb: SelectQueryBuilder<DB, 'asset', O>, filters: PeopleFilterIds) {
  const personIds = uniqueTruthyIds(filters.personIds);
  const identityIds = uniqueTruthyIds(filters.identityIds);
  const spacePersonIds = uniqueTruthyIds(filters.spacePersonIds);

  if (personIds.length === 0 && identityIds.length === 0 && spacePersonIds.length === 0) {
    return qb;
  }

  return qb.where((eb) => {
    const predicates: Expression<SqlBool>[] = [];

    if (personIds.length > 0) {
      predicates.push(
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.personGroupId', '=', anyUuid(personIds)),
        ),
      );
    }

    if (identityIds.length > 0) {
      predicates.push(
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('face_identity_face.identityId', '=', anyUuid(identityIds)),
        ),
      );
    }

    if (spacePersonIds.length > 0) {
      predicates.push(
        eb.exists(
          eb
            .selectFrom('shared_space_person_face')
            .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
            .whereRef('asset_face.assetId', '=', 'asset.id')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('shared_space_person_face.personId', '=', anyUuid(spacePersonIds)),
        ),
      );
    }

    return eb.or(predicates);
  });
}
