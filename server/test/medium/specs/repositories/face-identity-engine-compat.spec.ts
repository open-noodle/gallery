import { Kysely, sql } from 'kysely';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { DB } from 'src/schema';
import { getKyselyConfig } from 'src/utils/database';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Hagen's production database is the legacy Immich pgvecto.rs image. Its `vector` type has NO
// `avg` aggregate (VectorChord's does — which is why the vchord-based medium harness never caught
// this). The face-cluster merge/backfill guards compute cluster centroids, so their SQL must avoid
// `avg(vector)` or it throws on every guarded merge/backfill on his instance. This spec runs the
// real guard methods against the actual pgvecto.rs engine to prove they do.

type Internals = {
  filterFacesResemblingPerson(targetPersonId: string, assetFaceIds: string[]): Promise<string[]>;
  getEmbeddingInconsistentSourceIdentityIds(
    trx: Kysely<DB>,
    targetIdentityId: string,
    sourceIdentityIds: string[],
  ): Promise<string[]>;
};

let container: StartedTestContainer;
let db: Kysely<DB>;
let internals: Internals;

// Deterministic, valid UUIDs (version 4, variant 8) keyed by a small integer.
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const vec = (x: number, y: number, z: number) => `[${x},${y},${z}]`;

const insertFace = (faceId: string, embedding: string) =>
  sql`INSERT INTO face_search ("faceId", embedding) VALUES (${faceId}::uuid, ${embedding}::vector)`.execute(db);

const insertAssetFace = (id: string, personGroupId: string) =>
  sql`INSERT INTO asset_face (id, "personGroupId", "isVisible") VALUES (${id}::uuid, ${personGroupId}::uuid, true)`.execute(
    db,
  );

const linkIdentityFace = (assetFaceId: string, identityId: string) =>
  sql`INSERT INTO face_identity_face ("assetFaceId", "identityId") VALUES (${assetFaceId}::uuid, ${identityId}::uuid)`.execute(
    db,
  );

beforeAll(async () => {
  // This image redirects Postgres logs to a collector file, so the "ready to accept connections"
  // line never reaches stdout — wait on the listening TCP port (only the real server binds it, not
  // the init-phase socket-only server) and then confirm with a query.
  container = await new GenericContainer(
    'docker.io/tensorchord/pgvecto-rs:pg14-v0.2.0@sha256:739cdd626151ff1f796dc95a6591b55a714f341c737e27f045019ceabf8e8c52',
  )
    .withExposedPorts(5432)
    .withEnvironment({ POSTGRES_PASSWORD: 'postgres', POSTGRES_USER: 'postgres', POSTGRES_DB: 'test' })
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(120_000)
    .start();

  const url = `postgres://postgres:postgres@localhost:${container.getMappedPort(5432)}/test`;
  db = new Kysely<DB>(getKyselyConfig({ connectionType: 'url', url }));

  for (let attempt = 0; ; attempt++) {
    try {
      await sql`SELECT 1`.execute(db);
      break;
    } catch (error) {
      if (attempt >= 40) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Minimal schema: only the columns the guard methods touch, on the pgvecto.rs `vector` type.
  await sql`CREATE EXTENSION IF NOT EXISTS vectors`.execute(db);
  await sql`CREATE TABLE face_search ("faceId" uuid PRIMARY KEY, embedding vector(3))`.execute(db);
  await sql`CREATE TABLE asset_face (
    id uuid PRIMARY KEY,
    "personGroupId" uuid,
    "deletedAt" timestamptz,
    "isVisible" boolean NOT NULL DEFAULT true
  )`.execute(db);
  await sql`CREATE TABLE face_identity_face ("assetFaceId" uuid PRIMARY KEY, "identityId" uuid)`.execute(db);

  internals = new FaceIdentityRepository(db) as unknown as Internals;
}, 180_000);

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
});

describe('face-cluster guard centroid SQL on pgvecto.rs', () => {
  it('precondition: this engine has no avg(vector) aggregate (Hagen reproduction)', async () => {
    await expect(sql`SELECT avg(embedding) FROM face_search`.execute(db)).rejects.toThrow(
      /function avg\(vector\) does not exist/,
    );
  });

  it('filterFacesResemblingPerson keeps resembling faces and drops the outlier', async () => {
    const person = uuid(100);
    // Target person cluster on the x-axis -> centroid ~[0.95, 0.05, 0].
    for (const [n, e] of [
      [101, vec(1, 0, 0)],
      [102, vec(0.9, 0.1, 0)],
      [103, vec(0.95, 0.05, 0)],
    ] as const) {
      await insertAssetFace(uuid(n), person);
      await insertFace(uuid(n), e);
    }
    // Candidates: one near the cluster, one opposite it.
    const near = uuid(110);
    const far = uuid(111);
    await insertAssetFace(near, uuid(199));
    await insertFace(near, vec(0.9, 0.1, 0));
    await insertAssetFace(far, uuid(198));
    await insertFace(far, vec(-1, 0, 0));

    const result = await internals.filterFacesResemblingPerson(person, [near, far]);

    expect(result).toContain(near);
    expect(result).not.toContain(far);
  });

  it('filterFacesResemblingPerson keeps every candidate when the target has no embedded faces (cannot assess)', async () => {
    const emptyPerson = uuid(300); // a person with no faces -> no centroid to compare against
    const near = uuid(310);
    const far = uuid(311);
    await insertAssetFace(near, uuid(399));
    await insertFace(near, vec(1, 0, 0));
    await insertAssetFace(far, uuid(398));
    await insertFace(far, vec(-1, 0, 0));

    const result = await internals.filterFacesResemblingPerson(emptyPerson, [near, far]);

    expect(result).toEqual(expect.arrayContaining([near, far]));
    expect(result).toHaveLength(2);
  });

  it('filterFacesResemblingPerson keeps a candidate that has no embedding (cannot assess)', async () => {
    const person = uuid(400);
    await insertAssetFace(uuid(401), person);
    await insertFace(uuid(401), vec(1, 0, 0));
    const noEmbedding = uuid(410); // an asset_face row with no face_search row
    await insertAssetFace(noEmbedding, uuid(499));

    const result = await internals.filterFacesResemblingPerson(person, [noEmbedding]);

    expect(result).toEqual([noEmbedding]);
  });

  it('getEmbeddingInconsistentSourceIdentityIds flags only the embedding-distinct source', async () => {
    const target = uuid(200);
    const consistent = uuid(201);
    const inconsistent = uuid(202);

    // Target identity + a consistent source: both on the x-axis (centroid distance ~0).
    await insertFace(uuid(210), vec(1, 0, 0));
    await linkIdentityFace(uuid(210), target);
    await insertFace(uuid(211), vec(0.95, 0.05, 0));
    await linkIdentityFace(uuid(211), consistent);
    // Inconsistent source: opposite axis (centroid distance ~2 > 0.5 threshold).
    await insertFace(uuid(212), vec(-1, 0, 0));
    await linkIdentityFace(uuid(212), inconsistent);

    const result = await internals.getEmbeddingInconsistentSourceIdentityIds(db, target, [consistent, inconsistent]);

    expect(result).toContain(inconsistent);
    expect(result).not.toContain(consistent);
  });
});
