import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = resolve(__dirname, '..');
const BASE_URL = 'http://127.0.0.1:2285/api';
const DB_URL = 'postgres://postgres:postgres@127.0.0.1:5435/immich';
const COMPOSE = 'docker compose -f docker-compose.yml -f docker-compose.storage-migration.yml';
// Must match the server container's IMMICH_MEDIA_LOCATION (default in Docker)
const MEDIA_LOCATION = '/usr/src/app/upload';
// Cross-phase state file (persists asset IDs, content hashes, user credentials)
const STATE_FILE = resolve(E2E_DIR, '.storage-migration-state.json');

// ---------------------------------------------------------------------------
// File Generators
// ---------------------------------------------------------------------------
let pngCounter = 0;

export function createPng(): Buffer {
  const r = pngCounter % 256;
  const g = Math.floor(pngCounter / 256) % 256;
  const b = Math.floor(pngCounter / 65_536) % 256;
  pngCounter++;

  const image = new PNG({ width: 1, height: 1 });
  image.data[0] = r;
  image.data[1] = g;
  image.data[2] = b;
  image.data[3] = 255;
  return PNG.sync.write(image);
}

export function createXmpSidecar(): Buffer {
  const xmp = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:description>Test sidecar for storage migration e2e</dc:description>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;
  return Buffer.from(xmp, 'utf8');
}

// ---------------------------------------------------------------------------
// Cross-Phase State Helpers
// ---------------------------------------------------------------------------
function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function saveState(data: Record<string, unknown>): void {
  const existing = loadState();
  writeFileSync(STATE_FILE, JSON.stringify({ ...existing, ...data }, null, 2));
}

function loadState(): Record<string, any> {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  }
  return {};
}

// ---------------------------------------------------------------------------
// API Helpers
// ---------------------------------------------------------------------------
interface ApiOptions {
  body?: unknown;
  formData?: FormData;
  token?: string;
}

export async function api(method: string, path: string, opts?: ApiOptions): Promise<any> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {};

  if (opts?.token) {
    headers['Authorization'] = `Bearer ${opts.token}`;
  }

  let fetchBody: BodyInit | undefined;

  if (opts?.formData) {
    fetchBody = opts.formData;
  } else if (opts?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(opts.body);
  }

  const res = await fetch(url, { method, headers, body: fetchBody });

  const contentType = res.headers.get('content-type') ?? '';
  const responseBody = await (contentType.includes('application/json') ? res.json() : res.text());

  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed: ${res.status} ${JSON.stringify(responseBody)}`);
  }

  return responseBody;
}

const ADMIN_EMAIL = 'admin@immich.cloud';
const ADMIN_PASSWORD = 'password';
const ADMIN_NAME = 'Admin';

export async function signUpAdmin(): Promise<string> {
  await api('POST', '/auth/admin-sign-up', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME },
  });
  const loginRes = await api('POST', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  return loginRes.accessToken;
}

export async function loginAdmin(): Promise<string> {
  const loginRes = await api('POST', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  return loginRes.accessToken;
}

export async function uploadAsset(
  token: string,
  filename: string,
  data: Buffer,
  sidecar?: Buffer,
  extraFields?: Record<string, string>,
): Promise<{ id: string; status: number }> {
  const form = new FormData();
  form.append('assetData', new Blob([new Uint8Array(data)]), filename);
  form.append('deviceAssetId', `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  form.append('deviceId', 'e2e-storage-migration');
  form.append('fileCreatedAt', new Date().toISOString());
  form.append('fileModifiedAt', new Date().toISOString());

  if (sidecar) {
    form.append('sidecarData', new Blob([new Uint8Array(sidecar)]), `${filename}.xmp`);
  }

  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) {
      form.append(k, v);
    }
  }

  const url = `${BASE_URL}/assets`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const body = await res.json();

  if (!res.ok) {
    throw new Error(`Upload asset failed: ${res.status} ${JSON.stringify(body)}`);
  }

  return { id: body.id, status: res.status };
}

export async function uploadProfileImage(token: string, data: Buffer): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)]), 'profile.png');

  await api('POST', '/users/profile-image', { formData: form, token });
}

export async function createUser(adminToken: string, email: string, password: string, name: string): Promise<string> {
  await api('POST', '/admin/users', {
    body: { email, password, name },
    token: adminToken,
  });
  const loginRes = await api('POST', '/auth/login', {
    body: { email, password },
  });
  return loginRes.accessToken;
}

export async function loginUser(email: string, password: string): Promise<string> {
  const loginRes = await api('POST', '/auth/login', {
    body: { email, password },
  });
  return loginRes.accessToken;
}

export async function downloadAssetOriginal(token: string, assetId: string): Promise<Buffer> {
  const res = await fetch(`${BASE_URL}/assets/${assetId}/original`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.ok(res.status === 200, `Expected 200 for asset ${assetId} original, got ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForProcessing(token: string, timeoutMs = 60_000): Promise<void> {
  await sleep(2000);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const jobs = await api('GET', '/jobs', { token });

    let allIdle = true;
    for (const [, queueData] of Object.entries(jobs) as [string, any][]) {
      const counts = queueData.jobCounts;
      if (counts && (counts.active > 0 || counts.waiting > 0 || counts.delayed > 0)) {
        allIdle = false;
        break;
      }
    }

    if (allIdle) {
      return;
    }

    await sleep(500);
  }

  throw new Error(`waitForProcessing timed out after ${timeoutMs}ms`);
}

interface MigrationOptions {
  deleteSource?: boolean;
  fileTypes?: Partial<{
    originals: boolean;
    thumbnails: boolean;
    previews: boolean;
    fullsize: boolean;
    encodedVideos: boolean;
    sidecars: boolean;
    personThumbnails: boolean;
    profileImages: boolean;
  }>;
  concurrency?: number;
}

const ALL_FILE_TYPES = {
  originals: true,
  thumbnails: true,
  previews: true,
  fullsize: true,
  encodedVideos: true,
  sidecars: true,
  personThumbnails: true,
  profileImages: true,
};

export async function startMigration(
  token: string,
  direction: 'toS3' | 'toDisk',
  options?: MigrationOptions,
): Promise<string> {
  const body = {
    direction,
    deleteSource: options?.deleteSource ?? true,
    fileTypes: { ...ALL_FILE_TYPES, ...options?.fileTypes },
    concurrency: options?.concurrency ?? 5,
  };

  const res = await api('POST', '/storage-migration/start', { body, token });
  return res.batchId;
}

export async function waitForMigration(token: string, timeoutMs = 120_000): Promise<void> {
  // BullMQ queue counts are ephemeral — fast-completing jobs may finish before
  // we can poll. Instead, poll until the queue is idle AND stays idle for a
  // stabilization period, indicating all jobs (including the orchestrator that
  // queues worker jobs) have completed.
  await sleep(5000);

  const deadline = Date.now() + timeoutMs;
  let idleSince: number | null = null;
  const stabilizationMs = 5000; // queue must be idle for this long

  while (Date.now() < deadline) {
    const status = await api('GET', '/storage-migration/status', { token });
    const active = status.active ?? 0;
    const waiting = status.waiting ?? 0;

    console.log(`  migration status: active=${active} waiting=${waiting} isActive=${status.isActive}`);

    const isIdle = !status.isActive && active === 0 && waiting === 0;

    if (isIdle) {
      if (idleSince === null) {
        idleSince = Date.now();
      } else if (Date.now() - idleSince >= stabilizationMs) {
        return;
      }
    } else {
      idleSince = null;
    }

    await sleep(1000);
  }

  throw new Error(`waitForMigration timed out after ${timeoutMs}ms`);
}

export async function setStorageTemplate(token: string, opts: { enabled?: boolean; template?: string }): Promise<void> {
  const config = await api('GET', '/system-config', { token });
  if (opts.enabled !== undefined) {
    config.storageTemplate.enabled = opts.enabled;
  }
  if (opts.template !== undefined) {
    config.storageTemplate.template = opts.template;
  }
  await api('PUT', '/system-config', { body: config, token });
}

export async function setThumbnailFormat(token: string, format: string): Promise<void> {
  const config = await api('GET', '/system-config', { token });
  config.image.thumbnail.format = format;
  await api('PUT', '/system-config', { body: config, token });
}

export async function triggerQueueCommand(token: string, queueName: string): Promise<void> {
  await api('PUT', `/jobs/${queueName}`, { body: { command: 'start' }, token });
}

export async function countMoveHistory(assetId?: string): Promise<number> {
  const rows = assetId
    ? await queryDb<{ c: string }>('SELECT COUNT(*)::text c FROM move_history WHERE "entityId" = $1', [assetId])
    : await queryDb<{ c: string }>('SELECT COUNT(*)::text c FROM move_history');
  return Number(rows[0].c);
}

export function captureContainerLogsSince(service: string, sinceMs: number): string {
  // docker compose --since accepts ISO-8601 OR a relative duration (e.g. "42s").
  // Bare epoch seconds are NOT accepted — compute elapsed seconds.
  // Substring matches work regardless of JSON vs plaintext logger mode;
  // the warning text appears verbatim in either.
  const elapsedSec = Math.max(1, Math.ceil((Date.now() - sinceMs) / 1000));
  return execSync(`${COMPOSE} logs --since ${elapsedSec}s --no-color ${service}`, {
    cwd: E2E_DIR,
    timeout: 30_000,
    encoding: 'utf8',
  });
}

// How a move gives up, in upstream's disk move and the S3 mover (src/gallery/utils/backend-file-move.ts) alike:
// a failed rename/copy, a size or checksum mismatch, an old file left behind, or a throw out of the template's move.
const MOVE_FAILURE_MARKERS = [
  'Unable to complete move',
  'Skipping move',
  'Unable to delete old file',
  'Problem applying storage template',
];

export function assertNoMoveEnoent(logs: string, phaseTag: string): void {
  const bad = logs
    .split('\n')
    .filter((l) => MOVE_FAILURE_MARKERS.some((marker) => l.includes(marker)) || /ENOENT.*rename/.test(l));
  assert.equal(bad.length, 0, `[${phaseTag}] unexpected ENOENT/move warnings:\n${bad.join('\n')}`);
}

// ---------------------------------------------------------------------------
// DB Helpers
// ---------------------------------------------------------------------------
let db: pg.Client;

export async function connectDb(): Promise<void> {
  db = new pg.Client(DB_URL);
  await db.connect();
}

export async function queryDb<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

export async function disconnectDb(): Promise<void> {
  if (db) {
    await db.end();
  }
}

export interface MigrationState {
  assets: { id: string; originalPath: string }[];
  assetFiles: { id: string; path: string; type: string }[];
  persons: { id: string; thumbnailPath: string }[];
  users: { id: string; profileImagePath: string }[];
  migrationLogs: { id: string; entityType: string; direction: string; batchId: string }[];
}

export async function captureState(): Promise<MigrationState> {
  const [assets, assetFiles, persons, users, migrationLogs] = await Promise.all([
    queryDb<{ id: string; originalPath: string }>('SELECT id, "originalPath" FROM asset ORDER BY id'),
    queryDb<{ id: string; path: string; type: string }>('SELECT id, path, type FROM asset_file ORDER BY id'),
    queryDb<{ id: string; thumbnailPath: string }>(
      'SELECT "personGroupId" AS id, "thumbnailPath" FROM person WHERE "thumbnailPath" != \'\' ORDER BY "personGroupId"',
    ),
    queryDb<{ id: string; profileImagePath: string }>(
      'SELECT id, "profileImagePath" FROM "user" WHERE "profileImagePath" != \'\' ORDER BY id',
    ),
    queryDb<{ id: string; entityType: string; direction: string; batchId: string }>(
      'SELECT id, "entityType", direction, "batchId" FROM storage_migration_log ORDER BY id',
    ),
  ]);

  return { assets, assetFiles, persons, users, migrationLogs };
}

// ---------------------------------------------------------------------------
// Docker Exec Helpers
// ---------------------------------------------------------------------------
export function dockerExec(service: string, cmd: string): string {
  const escaped = cmd.replaceAll("'", String.raw`'\''`);
  return execSync(`${COMPOSE} exec -T ${service} sh -c '${escaped}'`, {
    cwd: E2E_DIR,
    timeout: 30_000,
    encoding: 'utf8',
  }).trim();
}

export function minioFileExists(key: string): boolean {
  try {
    dockerExec('minio', `mc stat local/immich-test/${key}`);
    return true;
  } catch {
    return false;
  }
}

export function diskFileExists(path: string): boolean {
  try {
    dockerExec('immich-server', `test -f "${path}"`);
    return true;
  } catch {
    return false;
  }
}

export function minioReadFile(key: string): string {
  return dockerExec('minio', `mc cat local/immich-test/${key}`);
}

export function minioSetupAlias(): void {
  dockerExec('minio', 'mc alias set local http://localhost:9000 minioadmin minioadmin');
}

export function minioCountPrefix(prefix: string): number {
  try {
    const out = dockerExec('minio', `mc ls --recursive local/immich-test/${prefix} 2>/dev/null | wc -l`);
    return Number(out);
  } catch {
    return 0;
  }
}

export function minioObjectSize(key: string): number {
  assert.ok(minioFileExists(key), `MinIO key missing: ${key}`);
  return Number(dockerExec('minio', `mc cat local/immich-test/${key} | wc -c`));
}

/** The `mc ls --recursive` lines under `prefix` that mention `needle`. */
export function minioListMatching(prefix: string, needle: string): string[] {
  try {
    const out = dockerExec('minio', `mc ls --recursive local/immich-test/${prefix} 2>/dev/null`);
    return out.split('\n').filter((line) => line.includes(needle));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Setup
// ---------------------------------------------------------------------------
async function phaseSetup(): Promise<void> {
  console.log('=== Phase 1: Setup ===');

  // Create admin user
  console.log('  Signing up admin...');
  const adminToken = await signUpAdmin();

  const contentHashes: Record<string, string> = {};

  // Upload test assets as admin
  console.log('  Uploading image asset...');
  const png1 = createPng();
  const asset1 = await uploadAsset(adminToken, 'test-image.png', png1);
  contentHashes[asset1.id] = sha256(png1);
  console.log(`  Uploaded asset: ${asset1.id}`);

  console.log('  Uploading image with XMP sidecar...');
  const png2 = createPng();
  const sidecar = createXmpSidecar();
  const asset2 = await uploadAsset(adminToken, 'test-sidecar.png', png2, sidecar);
  contentHashes[asset2.id] = sha256(png2);
  const sidecarHash = sha256(sidecar);
  console.log(`  Uploaded asset with sidecar: ${asset2.id}`);

  // Upload profile image for admin
  console.log('  Uploading profile image...');
  await uploadProfileImage(adminToken, createPng());

  // Create a person with a real thumbnail file
  console.log('  Creating person with thumbnail...');
  const person = await api('POST', '/people', { body: { name: 'Test Person' }, token: adminToken });
  console.log(`  Created person: ${person.id}`);

  dockerExec('immich-server', 'mkdir -p /usr/src/app/upload/thumbs');
  const pngBase64 = createPng().toString('base64');
  dockerExec('immich-server', `echo '${pngBase64}' | base64 -d > /usr/src/app/upload/thumbs/person-test.png`);
  await queryDb('UPDATE person SET "thumbnailPath" = $1 WHERE "personGroupId" = $2', [
    '/usr/src/app/upload/thumbs/person-test.png',
    person.id,
  ]);
  console.log('  Person thumbnail written and DB updated');

  // Create second user with their own assets
  console.log('  Creating second user...');
  const user2Email = 'user2@immich.cloud';
  const user2Password = 'password';
  const user2Token = await createUser(adminToken, user2Email, user2Password, 'User Two');

  console.log('  Uploading asset as second user...');
  const png3 = createPng();
  const asset3 = await uploadAsset(user2Token, 'user2-image.png', png3);
  contentHashes[asset3.id] = sha256(png3);
  console.log(`  Uploaded user2 asset: ${asset3.id}`);

  console.log('  Uploading profile image for second user...');
  await uploadProfileImage(user2Token, createPng());

  // Wait for processing (thumbnails, previews, etc.)
  console.log('  Waiting for job processing...');
  await waitForProcessing(adminToken);

  // Verify initial state
  console.log('  Capturing and verifying initial state...');
  const state = await captureState();

  assert.ok(state.assets.length >= 3, `Expected >= 3 assets, got ${state.assets.length}`);
  assert.ok(state.assetFiles.length > 0, `Expected > 0 asset files, got ${state.assetFiles.length}`);

  for (const asset of state.assets) {
    assert.ok(asset.originalPath.startsWith('/'), `Asset originalPath is not absolute: ${asset.originalPath}`);
  }
  for (const af of state.assetFiles) {
    assert.ok(af.path.startsWith('/'), `AssetFile path is not absolute: ${af.path}`);
  }
  for (const p of state.persons) {
    assert.ok(p.thumbnailPath.startsWith('/'), `Person thumbnailPath is not absolute: ${p.thumbnailPath}`);
  }
  for (const u of state.users) {
    if (u.profileImagePath) {
      assert.ok(u.profileImagePath.startsWith('/'), `User profileImagePath is not absolute: ${u.profileImagePath}`);
    }
  }

  // Verify multi-user: both users have profile images
  assert.ok(state.users.length >= 2, `Expected >= 2 users with profile images, got ${state.users.length}`);

  // Save state for later phases
  saveState({
    contentHashes,
    sidecarHash,
    sidecarAssetId: asset2.id,
    user2: { email: user2Email, password: user2Password },
    adminAssetIds: [asset1.id, asset2.id],
    user2AssetIds: [asset3.id],
  });

  console.log(`  Assets: ${state.assets.length}`);
  console.log(`  Asset files: ${state.assetFiles.length}`);
  console.log(`  Persons with thumbnails: ${state.persons.length}`);
  console.log(`  Users with profile images: ${state.users.length}`);
  console.log(`  Content hashes stored: ${Object.keys(contentHashes).length}`);
  console.log('=== Phase 1: Setup complete ===');
}

// ---------------------------------------------------------------------------
// Phase 2: Migrate to S3
// ---------------------------------------------------------------------------
async function phaseMigrateToS3(): Promise<void> {
  console.log('=== Phase 2: Migrate to S3 ===');

  // Login as both users (server was restarted, old sessions invalid)
  console.log('  Logging in as admin...');
  const token = await loginAdmin();
  const savedState = loadState();
  const user2Token = savedState.user2 ? await loginUser(savedState.user2.email, savedState.user2.password) : null;

  // Get migration estimate
  console.log('  Getting migration estimate...');
  const estimate = await api('GET', '/storage-migration/estimate?direction=toS3', { token });
  const counts = estimate.fileCounts;
  console.log(
    `  Estimate: total=${counts.total} originals=${counts.originals ?? 0} thumbnails=${counts.thumbnails ?? 0}`,
  );
  assert.ok(counts.total > 0, `Expected estimate total > 0, got ${counts.total}`);

  // Start migration
  console.log('  Starting migration to S3...');
  const batchId = await startMigration(token, 'toS3');
  console.log(`  Batch ID: ${batchId}`);

  // Wait for migration to complete
  console.log('  Waiting for migration to complete...');
  await waitForMigration(token);

  // Set up minio mc alias
  console.log('  Setting up MinIO mc alias...');
  minioSetupAlias();

  // Validate
  console.log('  Capturing and validating post-migration state...');
  const state = await captureState();

  // DB paths should be relative (not starting with /)
  for (const asset of state.assets) {
    assert.ok(
      !asset.originalPath.startsWith('/'),
      `Asset originalPath should be relative after S3 migration: ${asset.originalPath}`,
    );
  }
  for (const af of state.assetFiles) {
    assert.ok(!af.path.startsWith('/'), `AssetFile path should be relative after S3 migration: ${af.path}`);
  }
  for (const p of state.persons) {
    assert.ok(
      !p.thumbnailPath.startsWith('/'),
      `Person thumbnailPath should be relative after S3 migration: ${p.thumbnailPath}`,
    );
  }
  for (const u of state.users) {
    if (u.profileImagePath) {
      assert.ok(
        !u.profileImagePath.startsWith('/'),
        `User profileImagePath should be relative after S3 migration: ${u.profileImagePath}`,
      );
    }
  }

  // Multi-user verification: both users' assets migrated
  if (savedState.adminAssetIds && savedState.user2AssetIds) {
    const allUploadedIds = [...savedState.adminAssetIds, ...savedState.user2AssetIds];
    for (const id of allUploadedIds) {
      const asset = state.assets.find((a: { id: string }) => a.id === id);
      assert.ok(asset, `Expected uploaded asset ${id} to exist in DB`);
      assert.ok(
        !asset.originalPath.startsWith('/'),
        `Uploaded asset ${id} should have relative path after S3 migration: ${asset.originalPath}`,
      );
    }
    console.log(`  Multi-user: all ${allUploadedIds.length} uploaded assets have relative paths`);
  }

  // Multi-user verification: both users' profile images migrated
  assert.ok(
    state.users.length >= 2,
    `Expected >= 2 users with profile images after migration, got ${state.users.length}`,
  );
  for (const u of state.users) {
    if (u.profileImagePath) {
      assert.ok(
        !u.profileImagePath.startsWith('/'),
        `User ${u.id} profileImagePath should be relative: ${u.profileImagePath}`,
      );
    }
  }

  // API access: admin can access their own assets
  if (savedState.adminAssetIds) {
    console.log('  Verifying API access to assets (admin)...');
    for (const id of savedState.adminAssetIds as string[]) {
      const res = await fetch(`${BASE_URL}/assets/${id}/original`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status !== 200) {
        const body = await res.text();
        assert.fail(`Expected 200 for admin asset ${id} original, got ${res.status}: ${body}`);
      }
      await res.arrayBuffer();
    }
  }

  // API access: user2 can access their own assets
  if (user2Token && savedState.user2AssetIds) {
    console.log('  Verifying API access to assets (user2)...');
    for (const id of savedState.user2AssetIds as string[]) {
      const res: Response = await fetch(`${BASE_URL}/assets/${id}/original`, {
        headers: { Authorization: `Bearer ${user2Token as string}` },
      });
      if (res.status !== 200) {
        const body = await res.text();
        assert.fail(`Expected 200 for user2 asset ${id} original, got ${res.status}: ${body}`);
      }
      await res.arrayBuffer();
    }
  }

  // Content integrity: download originals and compare SHA-256 hashes (each user downloads their own)
  if (savedState.contentHashes) {
    console.log('  Verifying content integrity (SHA-256)...');
    const adminIds = new Set(savedState.adminAssetIds as string[]);
    for (const [assetId, expectedHash] of Object.entries(savedState.contentHashes)) {
      const dlToken = adminIds.has(assetId) ? token : (user2Token ?? token);
      const content = await downloadAssetOriginal(dlToken, assetId);
      const actualHash = sha256(content);
      assert.equal(
        actualHash,
        expectedHash,
        `Content hash mismatch for asset ${assetId}: expected ${expectedHash}, got ${actualHash}`,
      );
    }
    console.log(`  Content integrity verified for ${Object.keys(savedState.contentHashes).length} assets`);
  }

  // MinIO files exist (originals, asset files, person thumbnails, profile images)
  console.log('  Verifying MinIO files exist...');
  for (const asset of state.assets) {
    assert.ok(minioFileExists(asset.originalPath), `Expected MinIO file to exist: ${asset.originalPath}`);
  }
  for (const af of state.assetFiles) {
    assert.ok(minioFileExists(af.path), `Expected MinIO asset file to exist: ${af.path}`);
  }
  for (const p of state.persons) {
    assert.ok(minioFileExists(p.thumbnailPath), `Expected MinIO person thumbnail to exist: ${p.thumbnailPath}`);
  }
  for (const u of state.users) {
    if (u.profileImagePath) {
      assert.ok(minioFileExists(u.profileImagePath), `Expected MinIO profile image to exist: ${u.profileImagePath}`);
    }
  }

  // Disk files gone (deleteSource: true)
  console.log('  Verifying disk files are removed...');
  for (const asset of state.assets) {
    assert.ok(
      !diskFileExists(`${MEDIA_LOCATION}/${asset.originalPath}`),
      `Expected disk file to be deleted: ${MEDIA_LOCATION}/${asset.originalPath}`,
    );
  }

  // Migration log validation
  const s3Logs = state.migrationLogs.filter((l) => l.direction === 'toS3');
  assert.ok(s3Logs.length > 0, `Expected migration logs with direction=toS3, got ${s3Logs.length}`);
  const batchLogs = s3Logs.filter((l) => l.batchId === batchId);
  assert.ok(batchLogs.length > 0, `Expected migration logs with batchId=${batchId}, got ${batchLogs.length}`);

  // Save batchId for rollback phase
  saveState({ lastToS3BatchId: batchId });

  console.log(`  Assets: ${state.assets.length}, Asset files: ${state.assetFiles.length}`);
  console.log(`  Persons: ${state.persons.length}, Users with profile: ${state.users.length}`);
  console.log(`  Migration log entries (toS3): ${s3Logs.length}`);
  console.log('=== Phase 2: Migrate to S3 complete ===');
}

// ---------------------------------------------------------------------------
// Phase 3: Migrate to Disk
// ---------------------------------------------------------------------------
async function phaseMigrateToDisk(): Promise<void> {
  console.log('=== Phase 3: Migrate to Disk ===');

  // Login as both users
  console.log('  Logging in as admin...');
  const token = await loginAdmin();
  const savedState = loadState();
  const user2Token = savedState.user2 ? await loginUser(savedState.user2.email, savedState.user2.password) : null;

  // Start migration
  console.log('  Starting migration to disk...');
  const batchId = await startMigration(token, 'toDisk');
  console.log(`  Batch ID: ${batchId}`);

  // Wait for migration to complete
  console.log('  Waiting for migration to complete...');
  await waitForMigration(token);

  // Validate
  console.log('  Capturing and validating post-migration state...');
  const state = await captureState();

  // DB paths should be absolute (starting with /)
  for (const asset of state.assets) {
    assert.ok(
      asset.originalPath.startsWith('/'),
      `Asset originalPath should be absolute after disk migration: ${asset.originalPath}`,
    );
  }
  for (const af of state.assetFiles) {
    assert.ok(af.path.startsWith('/'), `AssetFile path should be absolute after disk migration: ${af.path}`);
  }
  for (const p of state.persons) {
    assert.ok(
      p.thumbnailPath.startsWith('/'),
      `Person thumbnailPath should be absolute after disk migration: ${p.thumbnailPath}`,
    );
  }
  for (const u of state.users) {
    if (u.profileImagePath) {
      assert.ok(
        u.profileImagePath.startsWith('/'),
        `User profileImagePath should be absolute after disk migration: ${u.profileImagePath}`,
      );
    }
  }

  // Multi-user verification: both users' assets migrated back
  if (savedState.adminAssetIds && savedState.user2AssetIds) {
    const allUploadedIds = [...savedState.adminAssetIds, ...savedState.user2AssetIds];
    for (const id of allUploadedIds) {
      const asset = state.assets.find((a: { id: string }) => a.id === id);
      assert.ok(asset, `Expected uploaded asset ${id} to exist in DB`);
      assert.ok(
        asset.originalPath.startsWith('/'),
        `Uploaded asset ${id} should have absolute path after disk migration: ${asset.originalPath}`,
      );
    }
    console.log(`  Multi-user: all ${allUploadedIds.length} uploaded assets have absolute paths`);
  }

  // Multi-user verification: both users' profile images migrated back
  assert.ok(
    state.users.length >= 2,
    `Expected >= 2 users with profile images after migration, got ${state.users.length}`,
  );

  // API access: admin can access their own assets
  if (savedState.adminAssetIds) {
    console.log('  Verifying API access to assets (admin)...');
    for (const id of savedState.adminAssetIds as string[]) {
      const res = await fetch(`${BASE_URL}/assets/${id}/original`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status !== 200) {
        const body = await res.text();
        assert.fail(`Expected 200 for admin asset ${id} original, got ${res.status}: ${body}`);
      }
      await res.arrayBuffer();
    }
  }

  // API access: user2 can access their own assets
  if (user2Token && savedState.user2AssetIds) {
    console.log('  Verifying API access to assets (user2)...');
    for (const id of savedState.user2AssetIds as string[]) {
      const res: Response = await fetch(`${BASE_URL}/assets/${id}/original`, {
        headers: { Authorization: `Bearer ${user2Token as string}` },
      });
      if (res.status !== 200) {
        const body = await res.text();
        assert.fail(`Expected 200 for user2 asset ${id} original, got ${res.status}: ${body}`);
      }
      await res.arrayBuffer();
    }
  }

  // Content integrity: download originals and compare SHA-256 hashes (each user downloads their own)
  if (savedState.contentHashes) {
    console.log('  Verifying content integrity (SHA-256)...');
    const adminIds = new Set(savedState.adminAssetIds as string[]);
    for (const [assetId, expectedHash] of Object.entries(savedState.contentHashes)) {
      const dlToken = adminIds.has(assetId) ? token : (user2Token ?? token);
      const content = await downloadAssetOriginal(dlToken, assetId);
      const actualHash = sha256(content);
      assert.equal(
        actualHash,
        expectedHash,
        `Content hash mismatch for asset ${assetId}: expected ${expectedHash}, got ${actualHash}`,
      );
    }
    console.log(`  Content integrity verified for ${Object.keys(savedState.contentHashes).length} assets`);
  }

  // Disk files exist (originals, asset files, person thumbnails, profile images)
  console.log('  Verifying disk files exist...');
  for (const asset of state.assets) {
    assert.ok(diskFileExists(asset.originalPath), `Expected disk file to exist: ${asset.originalPath}`);
  }
  for (const af of state.assetFiles) {
    assert.ok(diskFileExists(af.path), `Expected disk asset file to exist: ${af.path}`);
  }
  for (const p of state.persons) {
    assert.ok(diskFileExists(p.thumbnailPath), `Expected disk person thumbnail to exist: ${p.thumbnailPath}`);
  }
  for (const u of state.users) {
    if (u.profileImagePath) {
      assert.ok(diskFileExists(u.profileImagePath), `Expected disk profile image to exist: ${u.profileImagePath}`);
    }
  }

  // MinIO files gone (deleteSource: true)
  console.log('  Setting up MinIO mc alias...');
  minioSetupAlias();

  console.log('  Verifying MinIO files are removed...');
  const mediaPrefix = new RegExp(`^${MEDIA_LOCATION}/`);
  for (const asset of state.assets) {
    const s3Key = asset.originalPath.replace(mediaPrefix, '');
    assert.ok(!minioFileExists(s3Key), `Expected MinIO file to be deleted: ${s3Key}`);
  }

  // Migration log validation
  const diskLogs = state.migrationLogs.filter((l) => l.direction === 'toDisk');
  assert.ok(diskLogs.length > 0, `Expected migration logs with direction=toDisk, got ${diskLogs.length}`);

  // Save batchId for potential rollback testing
  saveState({ lastToDiskBatchId: batchId });

  console.log(`  Assets: ${state.assets.length}, Asset files: ${state.assetFiles.length}`);
  console.log(`  Persons: ${state.persons.length}, Users with profile: ${state.users.length}`);
  console.log(`  Migration log entries (toDisk): ${diskLogs.length}`);
  console.log('=== Phase 3: Migrate to Disk complete ===');
}

// ---------------------------------------------------------------------------
// Phase: Estimate Validation
// Precondition: files are on disk (run after setup or after migrate-to-disk)
// Backend: either disk or s3 (estimate is a DB query, no backend validation)
// ---------------------------------------------------------------------------
async function phaseEstimate(): Promise<void> {
  console.log('=== Phase: Estimate Validation ===');
  const token = await loginAdmin();

  // toS3 estimate: files are on disk, so should have counts
  console.log('  Getting toS3 estimate...');
  const toS3 = await api('GET', '/storage-migration/estimate?direction=toS3', { token });
  console.log(
    `  toS3: total=${toS3.fileCounts.total} originals=${toS3.fileCounts.originals} thumbnails=${toS3.fileCounts.thumbnails} previews=${toS3.fileCounts.previews}`,
  );
  assert.ok(toS3.fileCounts.total > 0, `Expected toS3 total > 0, got ${toS3.fileCounts.total}`);
  assert.ok(
    toS3.fileCounts.originals >= 3,
    `Expected originals >= 3 (3 uploaded assets), got ${toS3.fileCounts.originals}`,
  );
  assert.ok(toS3.fileCounts.thumbnails > 0, `Expected thumbnails > 0, got ${toS3.fileCounts.thumbnails}`);
  assert.ok(toS3.fileCounts.previews > 0, `Expected previews > 0, got ${toS3.fileCounts.previews}`);
  assert.ok(
    toS3.fileCounts.personThumbnails > 0,
    `Expected personThumbnails > 0, got ${toS3.fileCounts.personThumbnails}`,
  );
  assert.ok(toS3.fileCounts.profileImages >= 2, `Expected profileImages >= 2, got ${toS3.fileCounts.profileImages}`);
  assert.ok(toS3.estimatedSizeBytes > 0, `Expected estimatedSizeBytes > 0, got ${toS3.estimatedSizeBytes}`);

  // Verify total matches sum of individual counts
  const expectedTotal =
    toS3.fileCounts.originals +
    toS3.fileCounts.thumbnails +
    toS3.fileCounts.previews +
    toS3.fileCounts.fullsize +
    toS3.fileCounts.sidecars +
    toS3.fileCounts.encodedVideos +
    toS3.fileCounts.personThumbnails +
    toS3.fileCounts.profileImages;
  assert.equal(toS3.fileCounts.total, expectedTotal, `Total ${toS3.fileCounts.total} != sum ${expectedTotal}`);

  // toDisk estimate: files are already on disk, so should be 0
  console.log('  Getting toDisk estimate...');
  const toDisk = await api('GET', '/storage-migration/estimate?direction=toDisk', { token });
  console.log(`  toDisk: total=${toDisk.fileCounts.total}`);
  assert.equal(toDisk.fileCounts.total, 0, `Expected toDisk total = 0, got ${toDisk.fileCounts.total}`);
  assert.equal(toDisk.fileCounts.originals, 0, `Expected toDisk originals = 0, got ${toDisk.fileCounts.originals}`);

  // Save estimate for later comparison
  saveState({ initialEstimate: toS3 });

  console.log('=== Phase: Estimate Validation complete ===');
}

// ---------------------------------------------------------------------------
// Phase: Rollback
// Precondition: files are on S3 (run after migrate-to-s3)
// Backend: s3
// ---------------------------------------------------------------------------
async function phaseRollback(): Promise<void> {
  console.log('=== Phase: Rollback ===');
  const token = await loginAdmin();
  const savedState = loadState();

  // The last toS3 batch (delete-source-false's in the workflow). Rollback only reverts a row whose path is still
  // the one the batch wrote, so nothing may move files between that batch and this phase: a storage template
  // move in between would fail those rows as "concurrently modified".
  const batchId = savedState.lastToS3BatchId;
  assert.ok(batchId, 'No lastToS3BatchId in state — run migrate-to-s3 first');

  // Capture pre-rollback state (paths should be relative / S3)
  const preState = await captureState();
  for (const asset of preState.assets) {
    assert.ok(
      !asset.originalPath.startsWith('/'),
      `Pre-rollback: asset path should be relative: ${asset.originalPath}`,
    );
  }

  // Perform rollback
  console.log(`  Rolling back batch ${batchId}...`);
  const result = await api('POST', `/storage-migration/rollback/${batchId}`, { token });
  console.log(`  Rollback result: rolledBack=${result.rolledBack} failed=${result.failed} total=${result.total}`);

  assert.ok(result.total > 0, `Expected rollback total > 0, got ${result.total}`);
  assert.equal(result.failed, 0, `Expected 0 rollback failures, got ${result.failed}`);
  assert.equal(
    result.rolledBack,
    result.total,
    `Expected all ${result.total} entries rolled back, got ${result.rolledBack}`,
  );

  // Verify paths reverted to absolute (disk paths)
  console.log('  Verifying paths reverted to absolute...');
  const postState = await captureState();

  for (const asset of postState.assets) {
    assert.ok(
      asset.originalPath.startsWith('/'),
      `Post-rollback: asset originalPath should be absolute: ${asset.originalPath}`,
    );
  }
  for (const af of postState.assetFiles) {
    assert.ok(af.path.startsWith('/'), `Post-rollback: assetFile path should be absolute: ${af.path}`);
  }
  for (const p of postState.persons) {
    assert.ok(
      p.thumbnailPath.startsWith('/'),
      `Post-rollback: person thumbnailPath should be absolute: ${p.thumbnailPath}`,
    );
  }
  for (const u of postState.users) {
    if (u.profileImagePath) {
      assert.ok(
        u.profileImagePath.startsWith('/'),
        `Post-rollback: user profileImagePath should be absolute: ${u.profileImagePath}`,
      );
    }
  }

  // Note: rollback only reverts DB paths, NOT file locations.
  // Files are still on S3, so API access via disk paths will fail until re-migrated.
  // This is expected — rollback is a DB-only operation.
  console.log('  Verifying files still exist in MinIO (rollback is DB-only)...');
  minioSetupAlias();
  for (const asset of preState.assets) {
    assert.ok(
      minioFileExists(asset.originalPath),
      `MinIO file should still exist after rollback: ${asset.originalPath}`,
    );
  }

  // Verify migration log entries were deleted (successful rollback cleans up)
  const logEntries = postState.migrationLogs.filter((l) => l.batchId === batchId);
  assert.equal(
    logEntries.length,
    0,
    `Expected migration logs for batch ${batchId} to be deleted after rollback, got ${logEntries.length}`,
  );

  // Verify rollback of already-rolled-back batch returns zero counts
  console.log('  Verifying double-rollback returns zero...');
  const doubleResult = await api('POST', `/storage-migration/rollback/${batchId}`, { token });
  assert.equal(doubleResult.total, 0, `Expected double-rollback total = 0, got ${doubleResult.total}`);
  assert.equal(doubleResult.rolledBack, 0, `Expected double-rollback rolledBack = 0, got ${doubleResult.rolledBack}`);

  console.log('=== Phase: Rollback complete ===');
}

// ---------------------------------------------------------------------------
// Phase: No Files to Migrate
// Precondition: all files are already on S3 (run after migrate-to-s3)
// Backend: s3
// ---------------------------------------------------------------------------
async function phaseNoFiles(): Promise<void> {
  console.log('=== Phase: No Files to Migrate ===');
  const token = await loginAdmin();

  // Verify estimate shows 0 files for toS3 (everything already there)
  const estimate = await api('GET', '/storage-migration/estimate?direction=toS3', { token });
  console.log(`  toS3 estimate after migration: total=${estimate.fileCounts.total}`);
  assert.equal(estimate.fileCounts.total, 0, `Expected 0 files to migrate toS3, got ${estimate.fileCounts.total}`);

  // Verify toDisk estimate shows files (they're on S3, can be migrated back)
  const toDiskEstimate = await api('GET', '/storage-migration/estimate?direction=toDisk', { token });
  console.log(`  toDisk estimate: total=${toDiskEstimate.fileCounts.total}`);
  assert.ok(toDiskEstimate.fileCounts.total > 0, `Expected toDisk total > 0, got ${toDiskEstimate.fileCounts.total}`);

  // Try starting toS3 migration — should fail with "No files to migrate"
  console.log('  Attempting toS3 migration (should fail)...');
  try {
    await startMigration(token, 'toS3');
    assert.fail('Expected startMigration to throw "No files to migrate"');
  } catch (error: any) {
    assert.ok(
      error.message.includes('No files to migrate'),
      `Expected "No files to migrate" error, got: ${error.message}`,
    );
    console.log('  Correctly rejected: No files to migrate');
  }

  console.log('=== Phase: No Files to Migrate complete ===');
}

// ---------------------------------------------------------------------------
// Phase: Concurrent Migration Rejection
// Precondition: files need migrating (run after setup, migrate-to-disk, or rollback)
// Backend: s3
// ---------------------------------------------------------------------------
async function phaseConcurrentRejection(): Promise<void> {
  console.log('=== Phase: Concurrent Migration Rejection ===');
  const token = await loginAdmin();

  // Start first migration with low concurrency to widen the race window
  console.log('  Starting first migration (concurrency=1)...');
  const batchId = await startMigration(token, 'toS3', { concurrency: 1 });
  console.log(`  First migration started: ${batchId}`);

  // Immediately try to start a second migration
  console.log('  Attempting second concurrent migration...');
  try {
    await startMigration(token, 'toS3', { concurrency: 1 });
    // If we get here, the first migration completed before our second call.
    // This is acceptable — verify the second one also completed.
    console.log('  Note: first migration completed before second call (race not caught)');
  } catch (error: any) {
    const msg = error.message;
    // Accept either "already in progress" (caught the race) or "No files to migrate" (first completed)
    assert.ok(
      msg.includes('already in progress') || msg.includes('No files to migrate'),
      `Expected concurrent rejection or no-files error, got: ${msg}`,
    );
    console.log(`  Second migration correctly rejected: ${msg}`);
  }

  // Wait for the first migration to complete
  console.log('  Waiting for migration to complete...');
  await waitForMigration(token);

  // Save the batchId
  saveState({ lastToS3BatchId: batchId });

  console.log('=== Phase: Concurrent Migration Rejection complete ===');
}

// ---------------------------------------------------------------------------
// Phase: Selective Migration (originals only)
// Precondition: files are on disk (run after setup or migrate-to-disk)
// Backend: s3
// ---------------------------------------------------------------------------
async function phaseSelectiveToS3(): Promise<void> {
  console.log('=== Phase: Selective Migration (originals only) ===');
  const token = await loginAdmin();

  // Capture pre-migration state
  const preState = await captureState();

  // Verify all paths are absolute (on disk)
  for (const asset of preState.assets) {
    assert.ok(
      asset.originalPath.startsWith('/'),
      `Pre-selective: asset originalPath should be absolute: ${asset.originalPath}`,
    );
  }

  // Start migration with ONLY originals enabled
  console.log('  Starting selective migration (originals only)...');
  const batchId = await startMigration(token, 'toS3', {
    fileTypes: {
      originals: true,
      thumbnails: false,
      previews: false,
      fullsize: false,
      encodedVideos: false,
      sidecars: false,
      personThumbnails: false,
      profileImages: false,
    },
  });
  console.log(`  Batch ID: ${batchId}`);

  await waitForMigration(token);

  // Verify post-migration state
  console.log('  Verifying selective migration results...');
  const postState = await captureState();

  // Originals should be relative (migrated to S3)
  for (const asset of postState.assets) {
    assert.ok(
      !asset.originalPath.startsWith('/'),
      `After selective migration: asset originalPath should be relative: ${asset.originalPath}`,
    );
  }

  // Asset files (thumbnails, previews) should still be absolute (NOT migrated)
  for (const af of postState.assetFiles) {
    assert.ok(
      af.path.startsWith('/'),
      `After selective migration: assetFile path should still be absolute (not migrated): ${af.path}`,
    );
  }

  // Person thumbnails should still be absolute
  for (const p of postState.persons) {
    assert.ok(
      p.thumbnailPath.startsWith('/'),
      `After selective migration: person thumbnailPath should still be absolute: ${p.thumbnailPath}`,
    );
  }

  // User profile images should still be absolute
  for (const u of postState.users) {
    if (u.profileImagePath) {
      assert.ok(
        u.profileImagePath.startsWith('/'),
        `After selective migration: user profileImagePath should still be absolute: ${u.profileImagePath}`,
      );
    }
  }

  // Verify originals exist in MinIO
  console.log('  Verifying originals exist in MinIO...');
  minioSetupAlias();
  for (const asset of postState.assets) {
    assert.ok(minioFileExists(asset.originalPath), `Expected MinIO original to exist: ${asset.originalPath}`);
  }

  // Verify thumbnails still exist on disk
  console.log('  Verifying thumbnails still on disk...');
  for (const af of postState.assetFiles) {
    assert.ok(diskFileExists(af.path), `Expected disk asset file to still exist: ${af.path}`);
  }

  // Verify estimate: originals should be 0, but thumbnails/previews should remain
  const estimate = await api('GET', '/storage-migration/estimate?direction=toS3', { token });
  console.log(
    `  Remaining toS3 estimate: total=${estimate.fileCounts.total} originals=${estimate.fileCounts.originals}`,
  );
  assert.equal(
    estimate.fileCounts.originals,
    0,
    `Expected 0 originals remaining, got ${estimate.fileCounts.originals}`,
  );
  assert.ok(
    estimate.fileCounts.total > 0,
    `Expected remaining files (thumbnails, etc.) > 0, got ${estimate.fileCounts.total}`,
  );

  // Migration log should only contain original-type entries
  const batchLogs = postState.migrationLogs.filter((l) => l.batchId === batchId);
  assert.ok(batchLogs.length > 0, `Expected migration logs for batch ${batchId}`);
  for (const log of batchLogs) {
    assert.equal(
      log.entityType,
      'asset',
      `Selective migration should only have asset entity type, got ${log.entityType}`,
    );
  }

  saveState({ selectiveBatchId: batchId });

  console.log('=== Phase: Selective Migration complete ===');
}

// ---------------------------------------------------------------------------
// Phase: Selective Cleanup (migrate remaining file types)
// Precondition: originals on S3, other files on disk (run after selective-to-s3)
// Backend: s3
// ---------------------------------------------------------------------------
async function phaseSelectiveCleanup(): Promise<void> {
  console.log('=== Phase: Selective Cleanup ===');
  const token = await loginAdmin();

  // Migrate remaining file types (everything except originals)
  console.log('  Starting cleanup migration (everything except originals)...');
  const batchId = await startMigration(token, 'toS3', {
    fileTypes: {
      originals: false,
      thumbnails: true,
      previews: true,
      fullsize: true,
      encodedVideos: true,
      sidecars: true,
      personThumbnails: true,
      profileImages: true,
    },
  });
  console.log(`  Batch ID: ${batchId}`);

  await waitForMigration(token);

  // Verify all paths are now relative (everything on S3)
  console.log('  Verifying all paths are relative...');
  const state = await captureState();

  for (const asset of state.assets) {
    assert.ok(
      !asset.originalPath.startsWith('/'),
      `After cleanup: asset originalPath should be relative: ${asset.originalPath}`,
    );
  }
  for (const af of state.assetFiles) {
    assert.ok(!af.path.startsWith('/'), `After cleanup: assetFile path should be relative: ${af.path}`);
  }
  for (const p of state.persons) {
    assert.ok(
      !p.thumbnailPath.startsWith('/'),
      `After cleanup: person thumbnailPath should be relative: ${p.thumbnailPath}`,
    );
  }
  for (const u of state.users) {
    if (u.profileImagePath) {
      assert.ok(
        !u.profileImagePath.startsWith('/'),
        `After cleanup: user profileImagePath should be relative: ${u.profileImagePath}`,
      );
    }
  }

  // Verify estimate shows 0 for toS3
  const estimate = await api('GET', '/storage-migration/estimate?direction=toS3', { token });
  assert.equal(estimate.fileCounts.total, 0, `Expected 0 remaining files, got ${estimate.fileCounts.total}`);

  saveState({ lastToS3BatchId: batchId });

  console.log('=== Phase: Selective Cleanup complete ===');
}

// ---------------------------------------------------------------------------
// Phase: Delete Source False
// Precondition: files are on disk (run after setup or migrate-to-disk)
// Backend: s3
// ---------------------------------------------------------------------------
async function phaseDeleteSourceFalse(): Promise<void> {
  console.log('=== Phase: Delete Source False ===');
  const token = await loginAdmin();

  // Capture pre-migration state (all on disk)
  const preState = await captureState();
  const diskPaths = preState.assets.map((a) => a.originalPath);
  for (const path of diskPaths) {
    assert.ok(path.startsWith('/'), `Pre-migration: asset path should be absolute: ${path}`);
    assert.ok(diskFileExists(path), `Pre-migration: disk file should exist: ${path}`);
  }

  // Start migration with deleteSource=false
  console.log('  Starting migration with deleteSource=false...');
  const batchId = await startMigration(token, 'toS3', { deleteSource: false });
  console.log(`  Batch ID: ${batchId}`);

  await waitForMigration(token);

  // Verify DB paths are now relative (S3)
  console.log('  Verifying DB paths updated to relative...');
  const postState = await captureState();
  for (const asset of postState.assets) {
    assert.ok(
      !asset.originalPath.startsWith('/'),
      `After migration: asset originalPath should be relative: ${asset.originalPath}`,
    );
  }
  for (const af of postState.assetFiles) {
    assert.ok(!af.path.startsWith('/'), `After migration: assetFile path should be relative: ${af.path}`);
  }

  // Verify S3 files exist
  console.log('  Verifying S3 files exist...');
  minioSetupAlias();
  for (const asset of postState.assets) {
    assert.ok(minioFileExists(asset.originalPath), `Expected MinIO file to exist: ${asset.originalPath}`);
  }
  for (const af of postState.assetFiles) {
    assert.ok(minioFileExists(af.path), `Expected MinIO asset file to exist: ${af.path}`);
  }

  // CRITICAL: Verify disk files ALSO still exist (deleteSource=false)
  console.log('  Verifying disk files still exist (deleteSource=false)...');
  for (const path of diskPaths) {
    assert.ok(diskFileExists(path), `Disk file should still exist after deleteSource=false migration: ${path}`);
  }

  // Also check asset files on disk
  for (const af of preState.assetFiles) {
    assert.ok(diskFileExists(af.path), `Disk asset file should still exist: ${af.path}`);
  }
  for (const p of preState.persons) {
    assert.ok(diskFileExists(p.thumbnailPath), `Disk person thumbnail should still exist: ${p.thumbnailPath}`);
  }
  for (const u of preState.users) {
    if (u.profileImagePath) {
      assert.ok(diskFileExists(u.profileImagePath), `Disk profile image should still exist: ${u.profileImagePath}`);
    }
  }

  // API access should work (served from S3 now) — each user accesses their own assets
  const savedStateLocal = loadState();
  if (savedStateLocal.adminAssetIds) {
    console.log('  Verifying API access works (admin)...');
    for (const id of savedStateLocal.adminAssetIds as string[]) {
      const res = await fetch(`${BASE_URL}/assets/${id}/original`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status !== 200) {
        const body = await res.text();
        assert.fail(`Expected 200 for admin asset ${id} original, got ${res.status}: ${body}`);
      }
      await res.arrayBuffer();
    }
  }

  saveState({ lastToS3BatchId: batchId });

  console.log('=== Phase: Delete Source False complete ===');
}

// ---------------------------------------------------------------------------
// Phase: Content Verification
// Precondition: files are on S3 (run after migrate-to-s3)
// Backend: s3
// ---------------------------------------------------------------------------
async function phaseContentVerify(): Promise<void> {
  console.log('=== Phase: Content Verification ===');
  const token = await loginAdmin();
  const savedState = loadState();

  assert.ok(savedState.contentHashes, 'No contentHashes in state — run setup first');

  const contentHashes: Record<string, string> = savedState.contentHashes;

  // Download every asset original via API and compare SHA-256 hashes (each user downloads their own)
  const adminIds = new Set(savedState.adminAssetIds as string[]);
  const user2Token = savedState.user2 ? await loginUser(savedState.user2.email, savedState.user2.password) : null;

  console.log(`  Verifying content integrity for ${Object.keys(contentHashes).length} assets...`);
  for (const [assetId, expectedHash] of Object.entries(contentHashes)) {
    const dlToken = adminIds.has(assetId) ? token : (user2Token ?? token);
    const content = await downloadAssetOriginal(dlToken, assetId);
    const actualHash = sha256(content);
    assert.equal(
      actualHash,
      expectedHash,
      `Content hash mismatch for asset ${assetId}: expected ${expectedHash}, got ${actualHash}`,
    );
    console.log(`  Asset ${assetId}: hash verified (${actualHash.slice(0, 12)}...)`);
  }

  // Verify thumbnail download works (via /assets/:id/thumbnail) — each user's own assets
  console.log('  Verifying thumbnail API access...');
  if (savedState.adminAssetIds) {
    for (const id of savedState.adminAssetIds as string[]) {
      const res = await fetch(`${BASE_URL}/assets/${id}/thumbnail`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.ok(res.status === 200, `Expected 200 for admin asset ${id} thumbnail, got ${res.status}`);
      const body = await res.arrayBuffer();
      assert.ok(body.byteLength > 0, `Expected non-empty thumbnail for asset ${id}`);
    }
  }
  if (user2Token && savedState.user2AssetIds) {
    for (const id of savedState.user2AssetIds as string[]) {
      const res = await fetch(`${BASE_URL}/assets/${id}/thumbnail`, {
        headers: { Authorization: `Bearer ${user2Token}` },
      });
      assert.ok(res.status === 200, `Expected 200 for user2 asset ${id} thumbnail, got ${res.status}`);
      const body = await res.arrayBuffer();
      assert.ok(body.byteLength > 0, `Expected non-empty thumbnail for asset ${id}`);
    }
  }

  // Range requests: this stack runs with IMMICH_S3_SERVE_MODE=proxy, so the server streams
  // the object itself instead of redirecting. It used to drop the Range header and answer
  // 200 with the whole body, which makes WebKit abort <video> playback and breaks seeking.
  const [rangeAssetId] = Object.keys(contentHashes);
  if (rangeAssetId) {
    const rangeToken = adminIds.has(rangeAssetId) ? token : (user2Token ?? token);
    const expected = await downloadAssetOriginal(rangeToken, rangeAssetId);

    console.log('  Verifying proxied range requests...');
    const partial = await fetch(`${BASE_URL}/assets/${rangeAssetId}/original`, {
      headers: { Authorization: `Bearer ${rangeToken}`, Range: 'bytes=0-9' },
    });
    assert.equal(partial.status, 206, `Expected 206 for a ranged proxy read, got ${partial.status}`);
    assert.equal(
      partial.headers.get('content-range'),
      `bytes 0-9/${expected.length}`,
      'Expected the proxied response to relay S3 Content-Range',
    );
    assert.equal(partial.headers.get('accept-ranges'), 'bytes', 'Expected the proxied response to accept ranges');
    assert.equal(partial.headers.get('content-length'), '10', 'Expected Content-Length to cover only the range');
    const partialBody = Buffer.from(await partial.arrayBuffer());
    assert.equal(partialBody.length, 10, `Expected 10 bytes, got ${partialBody.length}`);
    assert.ok(partialBody.equals(expected.subarray(0, 10)), 'Ranged bytes do not match the start of the object');

    // a suffix range: S3 resolves it, we relay it — nothing in the server parses ranges
    const suffix = await fetch(`${BASE_URL}/assets/${rangeAssetId}/original`, {
      headers: { Authorization: `Bearer ${rangeToken}`, Range: 'bytes=-5' },
    });
    assert.equal(suffix.status, 206, `Expected 206 for a suffix range, got ${suffix.status}`);
    const suffixBody = Buffer.from(await suffix.arrayBuffer());
    assert.ok(suffixBody.equals(expected.subarray(-5)), 'Suffix range bytes do not match the end of the object');

    // unsatisfiable ranges must surface as 416, not as a masked 404
    const unsatisfiable = await fetch(`${BASE_URL}/assets/${rangeAssetId}/original`, {
      headers: { Authorization: `Bearer ${rangeToken}`, Range: `bytes=${expected.length + 1000}-` },
    });
    assert.equal(unsatisfiable.status, 416, `Expected 416 for an unsatisfiable range, got ${unsatisfiable.status}`);
    console.log(`  Range requests verified (206 partial, suffix range, 416 unsatisfiable) for ${rangeAssetId}`);
  }

  console.log('=== Phase: Content Verification complete ===');
}

// ---------------------------------------------------------------------------
// Phase: Sidecar Verification
// Precondition: files are on S3 (run after migrate-to-s3)
// Backend: s3
// ---------------------------------------------------------------------------
async function phaseSidecarVerify(): Promise<void> {
  console.log('=== Phase: Sidecar Verification ===');
  const savedState = loadState();

  assert.ok(savedState.sidecarAssetId, 'No sidecarAssetId in state — run setup first');
  assert.ok(savedState.sidecarHash, 'No sidecarHash in state — run setup first');

  const sidecarAssetId: string = savedState.sidecarAssetId;
  const expectedHash: string = savedState.sidecarHash;

  // Find the sidecar file in the asset_files table
  const sidecarFiles = await queryDb<{ id: string; path: string; type: string }>(
    `SELECT af.id, af.path, af.type FROM asset_file af
     JOIN asset a ON af."assetId" = a.id
     WHERE a.id = $1 AND af.type = 'sidecar'`,
    [sidecarAssetId],
  );

  assert.ok(sidecarFiles.length > 0, `Expected sidecar file for asset ${sidecarAssetId}, found none`);
  const sidecarFile = sidecarFiles[0];
  console.log(`  Sidecar file: ${sidecarFile.path} (type: ${sidecarFile.type})`);

  // Verify path is relative (on S3)
  assert.ok(
    !sidecarFile.path.startsWith('/'),
    `Sidecar path should be relative after S3 migration: ${sidecarFile.path}`,
  );

  // Verify sidecar exists in MinIO
  minioSetupAlias();
  assert.ok(minioFileExists(sidecarFile.path), `Expected MinIO sidecar to exist: ${sidecarFile.path}`);

  // Read sidecar content from MinIO and verify hash
  console.log('  Reading sidecar content from MinIO...');
  const sidecarContent = minioReadFile(sidecarFile.path);
  const actualHash = sha256(Buffer.from(sidecarContent, 'utf8'));
  assert.equal(actualHash, expectedHash, `Sidecar content hash mismatch: expected ${expectedHash}, got ${actualHash}`);

  // Verify the sidecar content is valid XMP
  assert.ok(
    sidecarContent.includes('x:xmpmeta'),
    `Sidecar should contain XMP metadata: ${sidecarContent.slice(0, 100)}`,
  );
  assert.ok(
    sidecarContent.includes('Test sidecar for storage migration e2e'),
    'Sidecar should contain our test description',
  );

  console.log('  Sidecar content verified: hash matches and XMP content valid');
  console.log('=== Phase: Sidecar Verification complete ===');
}

// ---------------------------------------------------------------------------
// Storage template on S3 (specs/2026-10-20-storage-template-s3-moves-design.md)
//
// The template moves an S3 original inside the bucket: a server-side copy to
// the templated key under library/<storageLabel or userId>/, a size check, the
// DB update, then a delete of the old key; its sidecar follows to <key>.xmp.
// A manual Storage Template Migration run also re-paths the S3 derivatives,
// and the Migration job moves S3 derivatives as it moves disk ones.
// Every phase disables the template first (invariant reset) and in `finally`.
// ---------------------------------------------------------------------------

// The template folders these phases render, as regex sources
const TEMPLATE_YEAR_MONTH = String.raw`\d{4}/\d{2}`; // {{y}}/{{MM}}
const TEMPLATE_YEAR_MONTH_NAME = String.raw`\d{4}/[A-Za-z]+`; // {{y}}/{{MMMM}}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

interface TemplateAsset {
  id: string;
  ownerId: string;
  originalPath: string;
  originalFileName: string;
  storageLabel: string | null;
}

async function getTemplateAssets(ids: string[]): Promise<TemplateAsset[]> {
  return queryDb<TemplateAsset>(
    `SELECT a.id, a."ownerId", a."originalPath", a."originalFileName", u."storageLabel"
     FROM asset a JOIN "user" u ON u.id = a."ownerId"
     WHERE a.id = ANY($1) ORDER BY a.id`,
    [ids],
  );
}

async function getSidecarPath(assetId: string): Promise<string | undefined> {
  const [row] = await queryDb<{ path: string }>(
    `SELECT path FROM asset_file WHERE type = 'sidecar' AND "assetId" = $1`,
    [assetId],
  );
  return row?.path;
}

/** Asserts the asset sits at the S3 key the template renders: library/<storageLabel or userId>/<folders>/<fileName>. */
function assertTemplatedKey(asset: TemplateAsset, folders: string, fileName: string, tag: string): void {
  const root = `library/${asset.storageLabel || asset.ownerId}/`;
  const pattern = new RegExp(`^${escapeRegExp(root)}${folders}/${escapeRegExp(fileName)}$`);
  assert.ok(
    pattern.test(asset.originalPath),
    `[${tag}] asset ${asset.id}: expected ${root}<${folders}>/${fileName}, got ${asset.originalPath}`,
  );
}

/** Asserts no object under the owner's upload/ prefix is still named after the asset: its upload key is gone. */
function assertUploadKeyGone(asset: { id: string; ownerId: string }, tag: string): void {
  const leftovers = minioListMatching(`upload/${asset.ownerId}/`, asset.id);
  assert.equal(leftovers.length, 0, `[${tag}] upload key of ${asset.id} still in MinIO:\n${leftovers.join('\n')}`);
}

/** Asserts the sidecar moved with its original to <originalKey>.xmp, content intact, and left nothing behind. */
async function assertSidecarFollowed(
  asset: TemplateAsset,
  preSidecarPath: string,
  expectedHash: string,
  tag: string,
): Promise<void> {
  const sidecarPath = await getSidecarPath(asset.id);
  const expected = `${asset.originalPath}.xmp`;
  assert.equal(sidecarPath, expected, `[${tag}] sidecar of ${asset.id} did not follow its original`);
  assert.ok(minioFileExists(expected), `[${tag}] sidecar missing from MinIO: ${expected}`);
  const actualHash = sha256(Buffer.from(minioReadFile(expected), 'utf8'));
  assert.equal(actualHash, expectedHash, `[${tag}] sidecar content changed in the move: ${expected}`);
  if (preSidecarPath !== expected) {
    assert.ok(!minioFileExists(preSidecarPath), `[${tag}] old sidecar key still in MinIO: ${preSidecarPath}`);
  }
}

interface S3Thumbnail {
  assetId: string;
  ownerId: string;
  path: string;
}

async function getS3Thumbnails(): Promise<S3Thumbnail[]> {
  return queryDb<S3Thumbnail>(
    `SELECT af."assetId", a."ownerId", af.path FROM asset_file af JOIN asset a ON a.id = af."assetId"
     WHERE af.type = 'thumbnail' AND af."isEdited" = false AND a."deletedAt" IS NULL AND af.path NOT LIKE '/%'
     ORDER BY af."assetId"`,
  );
}

/** The thumbnail format the S3 thumbnail keys do not carry, so a re-path to it has to move them. */
function otherThumbnailFormat(thumbnails: S3Thumbnail[]): string {
  return thumbnails.some((t) => t.path.endsWith('.webp')) ? 'jpeg' : 'webp';
}

/**
 * Asserts every S3 thumbnail was re-pathed to upstream's path for `format` (StorageCore.getImagePath, as a key),
 * the new key exists and the old one is gone, and that at least one of them actually moved.
 */
async function assertThumbnailsRepathed(pre: S3Thumbnail[], format: string, tag: string): Promise<void> {
  const post = await getS3Thumbnails();
  assert.equal(post.length, pre.length, `[${tag}] S3 thumbnail row count changed: ${pre.length} → ${post.length}`);

  let moved = 0;
  for (const before of pre) {
    const after = post.find((row) => row.assetId === before.assetId);
    assert.ok(after, `[${tag}] thumbnail row of ${before.assetId} disappeared`);
    const { assetId, ownerId } = before;
    const expected = `thumbs/${ownerId}/${assetId.slice(0, 2)}/${assetId.slice(2, 4)}/${assetId}_thumbnail.${format}`;
    assert.equal(after.path, expected, `[${tag}] thumbnail of ${assetId} not re-pathed to .${format}`);
    assert.ok(minioFileExists(expected), `[${tag}] re-pathed thumbnail missing from MinIO: ${expected}`);
    if (before.path !== expected) {
      assert.ok(!minioFileExists(before.path), `[${tag}] old thumbnail key still in MinIO: ${before.path}`);
      moved++;
    }
  }
  assert.ok(moved > 0, `[${tag}] no S3 thumbnail needed a re-path to .${format}`);
  console.log(`  ${moved}/${pre.length} S3 thumbnails re-pathed to .${format}`);
}

interface ParkedPersonThumbnail {
  id: string;
  ownerId: string;
  parkedKey: string;
}

/**
 * Moves a person's S3 thumbnail off upstream's path to a key of its own, as setup's thumbs/person-test.png was, so
 * the next derivative re-path has a person thumbnail to move. (The first manual template run re-pathed setup's.)
 */
async function parkPersonThumbnail(tag: string): Promise<ParkedPersonThumbnail> {
  const [person] = await queryDb<{ id: string; ownerId: string; thumbnailPath: string }>(
    `SELECT "personGroupId" AS id, "ownerId", "thumbnailPath" FROM person
     WHERE "thumbnailPath" != '' AND "thumbnailPath" NOT LIKE '/%' ORDER BY "personGroupId" LIMIT 1`,
  );
  assert.ok(person, `[${tag}] no person with an S3 thumbnail — run \`setup\` and \`migrate-to-s3\` first`);

  const parkedKey = `thumbs/person-${tag}.png`;
  dockerExec('minio', `mc mv local/immich-test/${person.thumbnailPath} local/immich-test/${parkedKey}`);
  await queryDb('UPDATE person SET "thumbnailPath" = $1 WHERE "personGroupId" = $2 AND "ownerId" = $3', [
    parkedKey,
    person.id,
    person.ownerId,
  ]);
  return { id: person.id, ownerId: person.ownerId, parkedKey };
}

/** Asserts the parked person thumbnail was re-pathed to upstream's path (StorageCore.getPersonThumbnailPath). */
async function assertPersonThumbnailRepathed(person: ParkedPersonThumbnail, tag: string): Promise<void> {
  const { id, ownerId, parkedKey } = person;
  const rows = await queryDb<{ thumbnailPath: string }>(
    'SELECT "thumbnailPath" FROM person WHERE "personGroupId" = $1 AND "ownerId" = $2',
    [id, ownerId],
  );
  const expected = `thumbs/${ownerId}/${id.slice(0, 2)}/${id.slice(2, 4)}/${id}.jpeg`;
  assert.equal(rows[0]?.thumbnailPath, expected, `[${tag}] person ${id} thumbnail not re-pathed`);
  assert.ok(minioFileExists(expected), `[${tag}] re-pathed person thumbnail missing from MinIO: ${expected}`);
  assert.ok(!minioFileExists(parkedKey), `[${tag}] old person thumbnail key still in MinIO: ${parkedKey}`);
}

// ---------------------------------------------------------------------------
// Phase: Template bulk migration moves S3 assets
// Precondition: S3 backend, seeded assets on S3 (run after migrate-to-s3)
// ---------------------------------------------------------------------------
async function phaseTemplateS3Bulk(): Promise<void> {
  const tag = 'template-s3-bulk';
  console.log(`=== Phase: ${tag} ===`);
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false }); // invariant reset
  const startMs = Date.now();
  minioSetupAlias();

  const saved = loadState();
  const seededIds: string[] = [...(saved.adminAssetIds ?? []), ...(saved.user2AssetIds ?? [])];
  assert.ok(seededIds.length > 0, 'No seeded asset IDs found — run `setup` and `migrate-to-s3` first');
  assert.ok(saved.sidecarAssetId && saved.sidecarHash, 'No sidecar asset in state — run `setup` first');

  const preCount = await countMoveHistory();
  const preAssets = await getTemplateAssets(seededIds);
  assert.equal(preAssets.length, seededIds.length, `Expected ${seededIds.length} seeded assets in pre-state`);

  // Precondition: every seeded asset is an S3 key
  const preSizes = new Map<string, number>();
  for (const a of preAssets) {
    assert.ok(!a.originalPath.startsWith('/'), `Precondition failed: asset ${a.id} path is absolute`);
    preSizes.set(a.id, minioObjectSize(a.originalPath));
  }
  const preSidecarPath = await getSidecarPath(saved.sidecarAssetId);
  assert.ok(preSidecarPath, `Expected a sidecar row for asset ${saved.sidecarAssetId}`);

  try {
    await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MM}}/{{filename}}' });
    await triggerQueueCommand(token, 'storageTemplateMigration');
    await waitForProcessing(token);

    const postAssets = await getTemplateAssets(seededIds);
    for (const post of postAssets) {
      const pre = preAssets.find((a) => a.id === post.id);
      assert.ok(pre, `Asset ${post.id} missing from pre-state`);

      // admin's storageLabel is 'admin' (admin-sign-up sets it); user2 has none, so the key holds their id
      assertTemplatedKey(post, TEMPLATE_YEAR_MONTH, post.originalFileName, tag);
      assert.equal(minioObjectSize(post.originalPath), preSizes.get(post.id), `[${tag}] size changed for ${post.id}`);
      if (pre.originalPath !== post.originalPath) {
        assert.ok(!minioFileExists(pre.originalPath), `[${tag}] old key still in MinIO: ${pre.originalPath}`);
      }
    }

    const sidecarAsset = postAssets.find((a) => a.id === saved.sidecarAssetId);
    assert.ok(sidecarAsset, 'Sidecar asset missing from post-state');
    await assertSidecarFollowed(sidecarAsset, preSidecarPath, saved.sidecarHash, tag);

    // move_history returns to baseline (each completed move deletes its own row)
    const postCount = await countMoveHistory();
    assert.equal(postCount, preCount, `move_history delta: ${preCount} → ${postCount}`);

    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, tag);

    console.log(`  Bulk template migration moved ${postAssets.length} seeded S3 assets to library/…`);
  } finally {
    await setStorageTemplate(token, { enabled: false });
  }
  console.log(`=== Phase: ${tag} complete ===`);
}

// ---------------------------------------------------------------------------
// Phase: A new S3 upload is moved by the template after metadata extraction
// Precondition: S3 backend
// ---------------------------------------------------------------------------
async function phaseTemplateS3Upload(): Promise<void> {
  const tag = 'template-s3-upload';
  console.log(`=== Phase: ${tag} ===`);
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false }); // invariant reset
  const startMs = Date.now();
  minioSetupAlias();

  // createPng() restarts at 0 in every tsx run, so its first PNGs repeat setup's and the server would answer
  // with setup's asset (checksum dedup). Start past every other phase's fixtures.
  for (let i = 0; i < 300; i++) {
    createPng();
  }

  try {
    await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MMMM}}/{{filename}}' });

    const png = createPng();
    const upload = await uploadAsset(token, 'template-upload.png', png);
    assert.equal(upload.status, 201, `[${tag}] upload ${upload.id} was deduplicated against an existing asset`);
    await waitForProcessing(token);

    const [asset] = await getTemplateAssets([upload.id]);
    assert.ok(asset, `Asset ${upload.id} not found`);
    assertTemplatedKey(asset, TEMPLATE_YEAR_MONTH_NAME, 'template-upload.png', tag);
    assert.equal(minioObjectSize(asset.originalPath), png.length, `[${tag}] size changed for ${asset.id}`);
    assertUploadKeyGone(asset, tag);

    // thumbnail generation is queued after the template job, so it read the moved key
    const thumbnails = await queryDb<{ path: string }>(
      `SELECT path FROM asset_file WHERE "assetId" = $1 AND type = 'thumbnail' AND "isEdited" = false`,
      [asset.id],
    );
    assert.equal(thumbnails.length, 1, `[${tag}] expected a thumbnail for ${asset.id}, got ${thumbnails.length}`);
    assert.ok(minioFileExists(thumbnails[0].path), `[${tag}] thumbnail missing from MinIO: ${thumbnails[0].path}`);

    const count = await countMoveHistory(asset.id);
    assert.equal(count, 0, `Expected 0 move_history rows for new asset, got ${count}`);

    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, tag);

    console.log(`  New S3 upload ${asset.id} moved to ${asset.originalPath}.`);
  } finally {
    await setStorageTemplate(token, { enabled: false });
  }
  console.log(`=== Phase: ${tag} complete ===`);
}

// ---------------------------------------------------------------------------
// Phase: The still's template job moves both parts of an S3 live photo
// Precondition: S3 backend
// ---------------------------------------------------------------------------
async function phaseTemplateS3LivePhoto(): Promise<void> {
  const tag = 'template-s3-live-photo';
  console.log(`=== Phase: ${tag} ===`);
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false }); // invariant reset
  const startMs = Date.now();
  minioSetupAlias();

  // past setup's PNGs and template-s3-upload's (checksum dedup, see there)
  for (let i = 0; i < 310; i++) {
    createPng();
  }

  try {
    // The motion part must be a real video: metadata extraction probes it, and the template skips an asset
    // without exif. The comment makes its checksum unique to this run.
    const base64 = dockerExec(
      'immich-server',
      'ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=1:size=192x144:rate=10 ' +
        `-c:v libx264 -pix_fmt yuv420p -metadata comment=lp-${Date.now()} /tmp/lp-motion.mp4 ` +
        String.raw`&& base64 /tmp/lp-motion.mp4 | tr -d "\n"`,
    );
    const motion = Buffer.from(base64, 'base64');
    assert.ok(motion.length > 1000, `Generated video looks too small: ${motion.length} bytes`);

    // The motion part goes up with the template off, so it is still at its upload key when the still's job
    // moves both parts (its own template job would otherwise race the still's upload).
    const motionUpload = await uploadAsset(token, 'lp-motion.mp4', motion);
    assert.equal(motionUpload.status, 201, `[${tag}] motion upload was deduplicated against an existing asset`);
    await waitForProcessing(token, 120_000);
    const [preMotion] = await getTemplateAssets([motionUpload.id]);
    assert.ok(
      preMotion?.originalPath.startsWith('upload/'),
      `[${tag}] precondition: motion part should be at its upload key, got ${preMotion?.originalPath}`,
    );

    await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MM}}/{{filename}}' });
    const png = createPng();
    const stillUpload = await uploadAsset(token, 'lp-still.png', png, undefined, {
      livePhotoVideoId: motionUpload.id,
    });
    assert.equal(stillUpload.status, 201, `[${tag}] still upload was deduplicated against an existing asset`);
    await waitForProcessing(token, 120_000);

    const assets = await getTemplateAssets([motionUpload.id, stillUpload.id]);
    const still = assets.find((a) => a.id === stillUpload.id);
    const motionAsset = assets.find((a) => a.id === motionUpload.id);
    assert.ok(still && motionAsset, `Expected both live photo parts, got ${assets.length}`);

    // The motion part takes the still's name and date (getLivePhotoMotionFilename), so both share a folder
    assertTemplatedKey(still, TEMPLATE_YEAR_MONTH, 'lp-still.png', tag);
    assertTemplatedKey(motionAsset, TEMPLATE_YEAR_MONTH, 'lp-still.mp4', tag);
    assert.equal(
      dirname(motionAsset.originalPath),
      dirname(still.originalPath),
      `[${tag}] live photo parts landed in different folders`,
    );

    assert.equal(minioObjectSize(still.originalPath), png.length, `[${tag}] still size changed`);
    assert.equal(minioObjectSize(motionAsset.originalPath), motion.length, `[${tag}] motion size changed`);
    assert.ok(!minioFileExists(preMotion.originalPath), `[${tag}] old motion key still in MinIO`);
    assertUploadKeyGone(still, tag);
    assertUploadKeyGone(motionAsset, tag);

    for (const id of [motionUpload.id, stillUpload.id]) {
      const c = await countMoveHistory(id);
      assert.equal(c, 0, `Asset ${id} has ${c} move_history rows, expected 0`);
    }

    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, tag);

    console.log(`  Live photo pair moved together: ${still.originalPath} + ${motionAsset.originalPath}`);
  } finally {
    await setStorageTemplate(token, { enabled: false });
  }
  console.log(`=== Phase: ${tag} complete ===`);
}

// ---------------------------------------------------------------------------
// Phase: The template moves an S3 sidecar with its original
// Precondition: S3 backend, setup's sidecar asset on S3 (run after template-s3-bulk,
// which left it in a {{MM}} folder, so this {{MMMM}} run has to move it)
// ---------------------------------------------------------------------------
async function phaseTemplateS3Sidecar(): Promise<void> {
  const tag = 'template-s3-sidecar';
  console.log(`=== Phase: ${tag} ===`);
  const token = await loginAdmin();
  const saved = loadState();
  assert.ok(saved.sidecarAssetId, 'No sidecarAssetId — run `setup` and `migrate-to-s3` first');
  assert.ok(saved.sidecarHash, 'No sidecarHash — run `setup` first');
  const sidecarAssetId: string = saved.sidecarAssetId;

  await setStorageTemplate(token, { enabled: false }); // invariant reset
  const startMs = Date.now();
  const preCount = await countMoveHistory(sidecarAssetId);
  minioSetupAlias();

  const [preAsset] = await getTemplateAssets([sidecarAssetId]);
  assert.ok(preAsset, `Asset ${sidecarAssetId} not found`);
  assert.ok(!preAsset.originalPath.startsWith('/'), `Precondition failed: ${preAsset.originalPath} is absolute`);
  const preSize = minioObjectSize(preAsset.originalPath);
  const preSidecarPath = await getSidecarPath(sidecarAssetId);
  assert.ok(preSidecarPath, `Expected a sidecar row for asset ${sidecarAssetId}`);

  try {
    await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MMMM}}/{{filename}}' });
    await triggerQueueCommand(token, 'storageTemplateMigration');
    await waitForProcessing(token);

    const [postAsset] = await getTemplateAssets([sidecarAssetId]);
    assert.ok(postAsset, `Asset ${sidecarAssetId} disappeared`);
    assert.notEqual(postAsset.originalPath, preAsset.originalPath, `[${tag}] template did not move ${sidecarAssetId}`);
    assertTemplatedKey(postAsset, TEMPLATE_YEAR_MONTH_NAME, postAsset.originalFileName, tag);
    assert.equal(minioObjectSize(postAsset.originalPath), preSize, `[${tag}] size changed for ${sidecarAssetId}`);
    assert.ok(!minioFileExists(preAsset.originalPath), `[${tag}] old key still in MinIO: ${preAsset.originalPath}`);
    await assertSidecarFollowed(postAsset, preSidecarPath, saved.sidecarHash, tag);

    const postCount = await countMoveHistory(sidecarAssetId);
    assert.equal(postCount, preCount, `move_history delta for ${sidecarAssetId}: ${preCount} → ${postCount}`);

    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, tag);

    console.log(`  Sidecar asset ${sidecarAssetId} and its .xmp moved to ${postAsset.originalPath}(.xmp).`);
  } finally {
    await setStorageTemplate(token, { enabled: false });
  }
  console.log(`=== Phase: ${tag} complete ===`);
}

// ---------------------------------------------------------------------------
// Phase: The Migration job re-paths S3 derivatives after a thumbnail format change
// Precondition: S3 backend, derivatives on S3
// ---------------------------------------------------------------------------
async function phaseTemplateS3QueueMigration(): Promise<void> {
  const tag = 'template-s3-queue-migration';
  console.log(`=== Phase: ${tag} ===`);
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false }); // invariant reset
  const startMs = Date.now();
  const preCount = await countMoveHistory();
  minioSetupAlias();

  const config = await api('GET', '/system-config', { token });
  const originalFormat: string = config.image.thumbnail.format;
  const preThumbs = await getS3Thumbnails();
  assert.ok(preThumbs.length > 0, `[${tag}] precondition: expected S3 thumbnails`);
  const flippedFormat = otherThumbnailFormat(preThumbs);

  try {
    const person = await parkPersonThumbnail(tag);
    await setThumbnailFormat(token, flippedFormat);

    // FileMigrationQueueAll fans out AssetFileMigration + PersonFileMigration, which move S3 keys now
    await triggerQueueCommand(token, 'migration');
    await waitForProcessing(token);

    await assertThumbnailsRepathed(preThumbs, flippedFormat, tag);
    await assertPersonThumbnailRepathed(person, tag);

    const postCount = await countMoveHistory();
    assert.equal(postCount, preCount, `move_history delta: ${preCount} → ${postCount}`);

    // also catches an ENOENT from handleQueueMigration's removeEmptyDirs on the S3 server
    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, tag);

    console.log(`  Thumbnail format flipped to ${flippedFormat}; the Migration job re-pathed the S3 keys.`);
  } finally {
    // Restores the configured format only: the keys keep the flipped extension, as upstream leaves disk files
    // until the next Migration run. template-s3-manual-derivatives moves them back.
    await setThumbnailFormat(token, originalFormat);
  }
  console.log(`=== Phase: ${tag} complete ===`);
}

// ---------------------------------------------------------------------------
// Phase: A manual Storage Template Migration run re-paths S3 derivatives too
// Precondition: S3 backend, derivatives on S3
// ---------------------------------------------------------------------------
async function phaseTemplateS3ManualDerivatives(): Promise<void> {
  const tag = 'template-s3-manual-derivatives';
  console.log(`=== Phase: ${tag} ===`);
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false }); // invariant reset
  const startMs = Date.now();
  const preCount = await countMoveHistory();
  minioSetupAlias();

  const config = await api('GET', '/system-config', { token });
  const originalFormat: string = config.image.thumbnail.format;
  const preThumbs = await getS3Thumbnails();
  assert.ok(preThumbs.length > 0, `[${tag}] precondition: expected S3 thumbnails`);
  // Flipped against the keys, not the config: after template-s3-queue-migration the keys carry the other format
  // than the configured one, so this run moves them back and leaves keys and config agreeing again.
  const flippedFormat = otherThumbnailFormat(preThumbs);

  try {
    const person = await parkPersonThumbnail(tag);
    await setThumbnailFormat(token, flippedFormat);
    // The template originals are already at this template's keys (template-s3-sidecar applied it), so the run
    // moves derivatives only. The derivative re-path needs the template enabled.
    await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{MMMM}}/{{filename}}' });

    // Started by hand, so QueueStart queues the derivative migration; the Migration queue is not started here
    await triggerQueueCommand(token, 'storageTemplateMigration');
    await waitForProcessing(token);

    await assertThumbnailsRepathed(preThumbs, flippedFormat, tag);
    await assertPersonThumbnailRepathed(person, tag);

    const postCount = await countMoveHistory();
    assert.equal(postCount, preCount, `move_history delta: ${preCount} → ${postCount}`);

    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, tag);

    console.log(`  Manual template run re-pathed the S3 thumbnails to .${flippedFormat}.`);
  } finally {
    await setThumbnailFormat(token, originalFormat);
    await setStorageTemplate(token, { enabled: false });
  }
  console.log(`=== Phase: ${tag} complete ===`);
}

// The once-decided gate on automatic S3 moves (BackendFileMigrationService.onBootstrap, isManualOnlyTemplateMove)
const TEMPLATE_S3_STATE_KEY = 'storage-template-s3-state';

interface TemplateS3State {
  pending: boolean;
  decidedAt: string;
  clearedAt?: string;
}

async function getTemplateS3State(): Promise<TemplateS3State | undefined> {
  const [row] = await queryDb<{ value: TemplateS3State }>('SELECT value FROM system_metadata WHERE key = $1', [
    TEMPLATE_S3_STATE_KEY,
  ]);
  return row?.value;
}

async function setTemplateS3State(state: TemplateS3State): Promise<void> {
  await queryDb(
    `INSERT INTO system_metadata (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [TEMPLATE_S3_STATE_KEY, JSON.stringify(state)],
  );
}

// The warning each worker logs on every start while the state is pending (BackendFileMigrationService.onBootstrap)
const TEMPLATE_S3_PENDING_WARNING =
  'The storage template does not move files in S3 until an admin runs Storage Template Migration from ' +
  'Administration > Job Queues; uploads keep their upload/ keys until then';

// What the manual run that lifts the gate logs (BackendFileMigrationService.onJobSuccess)
const TEMPLATE_S3_CLEARED_LOG =
  'Storage template migration finished: new uploads in S3 now move to their template path';

// The template the earlier phases left every S3 original at, so the manual run in template-s3-upgrade-pending has
// only that phase's upload to move
const TEMPLATE_S3_UPGRADE_TEMPLATE = '{{y}}/{{MMMM}}/{{filename}}';

// ---------------------------------------------------------------------------
// Phase: Sets up an upgrade's first start for template-s3-upgrade-pending. Deletes the state this database's first
// start decided ("not pending": the harness starts from an empty database, hence the automatic moves the phases
// above assert) and enables the template while the originals those phases left are in S3. The workflow then
// restarts the server, whose BackendFileMigrationService.onBootstrap finds no row and decides again, as the first
// start of this version does on an install that upgrades with originals in S3 and the template enabled.
// Precondition: S3 backend, the template-s3-* phases above run
// Leaves the row deleted and the template enabled for the restart; template-s3-upgrade-pending puts both back.
// ---------------------------------------------------------------------------
async function phaseTemplateS3UpgradePrepare(): Promise<void> {
  const tag = 'template-s3-upgrade-prepare';
  console.log(`=== Phase: ${tag} ===`);
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false }); // invariant reset

  const preState = await getTemplateS3State();
  assert.ok(preState, `[${tag}] precondition: no ${TEMPLATE_S3_STATE_KEY} row, which every server start decides`);
  assert.equal(
    preState.pending,
    false,
    `[${tag}] precondition: an empty database's first start must decide "not pending"`,
  );
  // what StorageMigrationRepository.hasBackendOriginals asks (trashed assets count too)
  const [{ c }] = await queryDb<{ c: string }>(`SELECT COUNT(*)::text c FROM asset WHERE "originalPath" NOT LIKE '/%'`);
  const backendOriginals = Number(c);
  assert.ok(backendOriginals > 0, `[${tag}] precondition: no original in S3 — run the template-s3-* phases first`);

  // saved before anything changes, so template-s3-upgrade-pending can put it back
  saveState({ templateS3PreState: preState });
  try {
    await setStorageTemplate(token, { enabled: true, template: TEMPLATE_S3_UPGRADE_TEMPLATE });
    await queryDb('DELETE FROM system_metadata WHERE key = $1', [TEMPLATE_S3_STATE_KEY]);
  } catch (error) {
    await setTemplateS3State(preState);
    await setStorageTemplate(token, { enabled: false });
    throw error;
  }
  // the restart's decision and its warning both come after this moment
  saveState({ templateS3RestartAfterMs: Date.now() });

  console.log(
    `  Deleted ${TEMPLATE_S3_STATE_KEY} and enabled the template with ${backendOriginals} originals in S3; ` +
      'restart the server (backend=s3) before template-s3-upgrade-pending.',
  );
  console.log(`=== Phase: ${tag} complete ===`);
}

// ---------------------------------------------------------------------------
// Phase: After an upgrade that found originals in S3 with the template enabled, a new S3 upload keeps its
// upload/ key until an admin finishes one Storage Template Migration by hand; that run moves it and lifts the gate
// Precondition: template-s3-upgrade-prepare, then a server restart (backend=s3), whose first start decided the state
// again: the decision under test (onBootstrap and the hasBackendOriginals query). `finally` puts back the state the
// database's first start decided and disables the template.
// ---------------------------------------------------------------------------
async function phaseTemplateS3UpgradePending(): Promise<void> {
  const tag = 'template-s3-upgrade-pending';
  console.log(`=== Phase: ${tag} ===`);
  const saved = loadState();
  const preState: TemplateS3State | undefined = saved.templateS3PreState;
  const restartAfterMs: number | undefined = saved.templateS3RestartAfterMs;
  assert.ok(
    preState && restartAfterMs,
    `[${tag}] no saved state — run template-s3-upgrade-prepare, then restart the server (backend=s3)`,
  );
  const token = await loginAdmin();
  // the restart's decision is in its row: the template setting no longer changes it
  await setStorageTemplate(token, { enabled: false }); // invariant reset
  const startMs = Date.now();
  const preCount = await countMoveHistory();
  minioSetupAlias();

  // past setup's PNGs and the other template phases' (checksum dedup, see template-s3-upload)
  for (let i = 0; i < 320; i++) {
    createPng();
  }

  try {
    // The restart found no row, the template enabled and originals in S3, and decided as an upgrade's first start does
    const decided = await getTemplateS3State();
    assert.ok(decided, `[${tag}] the restart did not decide ${TEMPLATE_S3_STATE_KEY}`);
    assert.deepEqual(
      decided,
      { pending: true, decidedAt: decided.decidedAt },
      `[${tag}] expected the restart to decide {"pending": true}, got ${JSON.stringify(decided)}`,
    );
    const decidedMs = Date.parse(decided.decidedAt);
    assert.ok(
      decidedMs >= restartAfterMs && decidedMs <= Date.now(),
      `[${tag}] decidedAt ${decided.decidedAt} is not from the restart (after ${new Date(restartAfterMs).toISOString()})`,
    );

    // the admin's only notice, logged on start while pending
    const bootLogs = captureContainerLogsSince('immich-server', restartAfterMs);
    const warnings = bootLogs.split('\n').filter((line) => line.includes(TEMPLATE_S3_PENDING_WARNING));
    assert.ok(warnings.length > 0, `[${tag}] no "${TEMPLATE_S3_PENDING_WARNING}" in the server logs since the restart`);

    await setStorageTemplate(token, { enabled: true, template: TEMPLATE_S3_UPGRADE_TEMPLATE });

    const png = createPng();
    const upload = await uploadAsset(token, 'template-pending.png', png);
    assert.equal(upload.status, 201, `[${tag}] upload ${upload.id} was deduplicated against an existing asset`);
    await waitForProcessing(token);

    // The per-asset template job left it alone; the upload is stored, served and thumbnailed from its upload key
    const [pending] = await getTemplateAssets([upload.id]);
    assert.ok(pending, `Asset ${upload.id} not found`);
    assert.ok(
      pending.originalPath.startsWith(`upload/${pending.ownerId}/`),
      `[${tag}] the template moved ${pending.id} while pending: ${pending.originalPath}`,
    );
    assert.equal(minioObjectSize(pending.originalPath), png.length, `[${tag}] size changed for ${pending.id}`);
    const served = await downloadAssetOriginal(token, pending.id);
    assert.equal(sha256(served), sha256(png), `[${tag}] original of ${pending.id} not served from its upload key`);

    // thumbnail generation follows the template job when it skips too
    const thumbnails = await queryDb<{ path: string }>(
      `SELECT path FROM asset_file WHERE "assetId" = $1 AND type = 'thumbnail' AND "isEdited" = false`,
      [pending.id],
    );
    assert.equal(thumbnails.length, 1, `[${tag}] expected a thumbnail for ${pending.id}, got ${thumbnails.length}`);
    assert.ok(minioFileExists(thumbnails[0].path), `[${tag}] thumbnail missing from MinIO: ${thumbnails[0].path}`);

    const pendingCount = await countMoveHistory();
    assert.equal(pendingCount, preCount, `[${tag}] move_history delta while pending: ${preCount} → ${pendingCount}`);
    const stillPending = await getTemplateS3State();
    assert.equal(stillPending?.pending, true, `[${tag}] the gate lifted without a manual run`);

    // The admin starts Storage Template Migration by hand: the bulk job moves the upload, and its success lifts the gate
    await triggerQueueCommand(token, 'storageTemplateMigration');
    await waitForProcessing(token);

    const [moved] = await getTemplateAssets([upload.id]);
    assert.ok(moved, `Asset ${upload.id} disappeared`);
    assertTemplatedKey(moved, TEMPLATE_YEAR_MONTH_NAME, 'template-pending.png', tag);
    assert.equal(minioObjectSize(moved.originalPath), png.length, `[${tag}] size changed for ${moved.id}`);
    assert.ok(!minioFileExists(pending.originalPath), `[${tag}] old key still in MinIO: ${pending.originalPath}`);
    assertUploadKeyGone(moved, tag);

    const cleared = await getTemplateS3State();
    assert.ok(cleared, `[${tag}] ${TEMPLATE_S3_STATE_KEY} row disappeared`);
    assert.equal(cleared.pending, false, `[${tag}] the manual run did not lift the gate`);
    assert.equal(cleared.decidedAt, decided.decidedAt, `[${tag}] lifting the gate rewrote decidedAt`);
    assert.ok(
      cleared.clearedAt && !Number.isNaN(Date.parse(cleared.clearedAt)),
      `[${tag}] expected a clearedAt timestamp, got ${cleared.clearedAt}`,
    );

    const postCount = await countMoveHistory();
    assert.equal(postCount, preCount, `move_history delta: ${preCount} → ${postCount}`);

    const logs = captureContainerLogsSince('immich-server', startMs);
    assertNoMoveEnoent(logs, tag);
    assert.ok(logs.includes(TEMPLATE_S3_CLEARED_LOG), `[${tag}] no "${TEMPLATE_S3_CLEARED_LOG}" in the server logs`);

    console.log(
      `  The restart decided "pending" (${warnings.length} startup warning(s)); upload ${moved.id} waited at its ` +
        `upload key, then the manual run moved it to ${moved.originalPath} and lifted the gate.`,
    );
  } finally {
    // the state as this database's first start decided it ("not pending", checked by template-s3-upgrade-prepare),
    // so the phases after this one see automatic moves; a rerun has to prepare and restart again
    await setTemplateS3State(preState);
    await setStorageTemplate(token, { enabled: false });
    saveState({ templateS3PreState: undefined, templateS3RestartAfterMs: undefined });
  }
  console.log(`=== Phase: ${tag} complete ===`);
}

async function phaseTemplateDiskBaseline(): Promise<void> {
  console.log('=== Phase: template-disk-baseline ===');
  const token = await loginAdmin();
  await setStorageTemplate(token, { enabled: false });
  const startMs = Date.now();

  // Set a predictable storageLabel on admin so library paths are stable.
  // Note: upload paths use userId (UUID), NOT storageLabel — only library paths use it.
  //
  // `PUT /users/me` does NOT accept storageLabel (UserUpdateMeDto omits it).
  // Use the admin endpoint `PUT /admin/users/:id` (UserAdminUpdateDto accepts storageLabel).
  // Admin users can update themselves via this endpoint.
  //
  // This write is idempotent — if a prior run on the same DB already set
  // storageLabel='admin', the re-update is a no-op from the asset path's
  // perspective. No teardown needed (last phase in the workflow).
  const me = await api('GET', '/users/me', { token });
  await api('PUT', `/admin/users/${me.id}`, { body: { storageLabel: 'admin' }, token });

  // Only assert against assets created in phaseSetup — later phases
  // (template-s3-upload, template-s3-live-photo, template-s3-upgrade-pending, copy-asset-sidecar-s3)
  // upload additional test assets whose paths depend on what those phases
  // did, which is not the regression we're guarding here. The seeded assets
  // arrive already templated: the S3 template phases moved them to
  // library/<label>/YYYY/<Month>/ keys, which the later migrations and the
  // rollback carried back to the same paths on disk.
  const saved = loadState();
  const seededIds: string[] = [...(saved.adminAssetIds ?? []), ...(saved.user2AssetIds ?? [])];
  assert.ok(seededIds.length > 0, 'No seeded asset IDs found — run `setup` first');

  const preCount = await countMoveHistory();
  const preState = await captureState();
  const preSeeded = preState.assets.filter((a) => seededIds.includes(a.id));
  assert.equal(
    preSeeded.length,
    seededIds.length,
    `Missing seeded assets in pre-state: expected ${seededIds.length}, got ${preSeeded.length}`,
  );

  // Every seeded asset is on disk (absolute) post-rollback
  for (const a of preSeeded) {
    assert.ok(a.originalPath.startsWith('/'), `Pre-baseline: seeded asset ${a.id} not absolute`);
  }
  const preAssetPaths = new Map(preSeeded.map((a) => [a.id, a.originalPath]));

  await setStorageTemplate(token, { enabled: true, template: '{{y}}/{{y}}-{{MM}}-{{dd}}/{{filename}}' });
  await triggerQueueCommand(token, 'storageTemplateMigration');
  await waitForProcessing(token);

  const postState = await captureState();
  const postSeeded = postState.assets.filter((a) => seededIds.includes(a.id));

  // Seeded assets land under library/<storageLabel-or-userUuid>/YYYY/YYYY-MM-DD/filename.
  // Per-user storageLabel: admin got 'admin'; user2 keeps their UUID in the path.
  const libraryTemplatePath = /\/usr\/src\/app\/upload\/library\/[^/]+\/\d{4}\/\d{4}-\d{2}-\d{2}\//;
  for (const a of postSeeded) {
    assert.ok(
      libraryTemplatePath.test(a.originalPath),
      `Expected library/<label>/YYYY/YYYY-MM-DD/ path, got ${a.originalPath}`,
    );
    assert.ok(diskFileExists(a.originalPath), `New disk path missing: ${a.originalPath}`);

    // Old path gone
    const prePath = preAssetPaths.get(a.id);
    assert.ok(prePath, `Seeded asset ${a.id} missing from pre-state`);
    if (prePath !== a.originalPath) {
      assert.ok(!diskFileExists(prePath), `Old disk path still exists: ${prePath}`);
    }
  }

  // Admin's storageLabel must have taken effect — at least one seeded asset under library/admin/.
  assert.ok(
    postSeeded.some((a) => a.originalPath.startsWith('/usr/src/app/upload/library/admin/')),
    'No seeded asset landed under library/admin/ — storageLabel=admin was not applied',
  );

  // Sidecar followed the asset
  if (saved.sidecarAssetId) {
    const sidecarAssetId: string = saved.sidecarAssetId;
    const asset = postSeeded.find((a) => a.id === sidecarAssetId);
    assert.ok(asset, 'Sidecar asset missing from post-state');
    const sidecar = postState.assetFiles.find((f) => f.type === 'sidecar' && f.path.startsWith(asset.originalPath));
    assert.ok(sidecar, `Sidecar .xmp did not follow asset to ${asset.originalPath}`);
  }

  // move_history returns to baseline (each successful move deletes its own row)
  const postCount = await countMoveHistory();
  assert.equal(postCount, preCount, `move_history delta: ${preCount} → ${postCount}`);

  const logs = captureContainerLogsSince('immich-server', startMs);
  assertNoMoveEnoent(logs, 'template-disk-baseline');

  console.log(`  Disk template migration moved ${postSeeded.length} seeded assets to library/…`);
  console.log('=== Phase: template-disk-baseline complete ===');
}

async function phaseCopyAssetSidecarS3(): Promise<void> {
  console.log('=== Phase: copy-asset-sidecar-s3 ===');
  const token = await loginAdmin();

  // createPng() resets its module counter each tsx invocation, so the first few PNGs of every
  // phase are deterministic (R=0,G=0,B=0 → test-image.png's checksum). Burn counter ahead so
  // our fixtures don't collide with setup or other phases via the server's checksum dedup.
  for (let i = 0; i < 200; i++) {
    createPng();
  }

  // Source: photo with XMP sidecar. Target: photo without.
  const { id: sourceId } = await uploadAsset(token, 'copy-sidecar-src.png', createPng(), createXmpSidecar());
  console.log(`  Uploaded source ${sourceId} (with sidecar)`);
  const { id: targetId } = await uploadAsset(token, 'copy-sidecar-dst.png', createPng());
  console.log(`  Uploaded target ${targetId} (no sidecar)`);

  // Drain metadata extraction so the sidecar row gets linked to the source asset.
  await waitForProcessing(token);
  console.log('  Processing drained');

  // Source must have exactly one sidecar row with a relative (S3) path.
  const srcSidecarRows = await queryDb<{ path: string }>(
    `SELECT path FROM asset_file WHERE "assetId" = $1 AND type = 'sidecar'`,
    [sourceId],
  );
  assert.equal(srcSidecarRows.length, 1, `Expected source to have 1 sidecar row, got ${srcSidecarRows.length}`);
  assert.ok(
    !srcSidecarRows[0].path.startsWith('/'),
    `Expected source sidecar path relative (S3), got ${srcSidecarRows[0].path}`,
  );

  // Target's originalPath must also be a relative S3 key (proves backend config).
  const targetRows = await queryDb<{ originalPath: string }>(`SELECT "originalPath" FROM asset WHERE id = $1`, [
    targetId,
  ]);
  assert.ok(targetRows[0], `Target asset ${targetId} not found`);
  assert.ok(
    !targetRows[0].originalPath.startsWith('/'),
    `Expected target originalPath relative, got ${targetRows[0].originalPath}`,
  );
  const targetSidecarKey = `${targetRows[0].originalPath}.xmp`;

  // Trigger copy with sidecar=true — this is the code path the bug fix targets.
  await api('PUT', '/assets/copy', { token, body: { sourceId, targetId, sidecar: true } });

  // Drain the AssetExtractMetadata job copySidecar queues.
  await waitForProcessing(token);

  // Target now has a sidecar row in asset_file, pointing at <targetOriginalPath>.xmp.
  const targetSidecarRows = await queryDb<{ path: string }>(
    `SELECT path FROM asset_file WHERE "assetId" = $1 AND type = 'sidecar'`,
    [targetId],
  );
  assert.equal(
    targetSidecarRows.length,
    1,
    `Expected target to have 1 sidecar row after copy, got ${targetSidecarRows.length}`,
  );
  assert.equal(
    targetSidecarRows[0].path,
    targetSidecarKey,
    `Expected target sidecar path ${targetSidecarKey}, got ${targetSidecarRows[0].path}`,
  );

  // Object must exist in MinIO AND be non-empty (cheap content guard).
  minioSetupAlias();
  assert.ok(minioFileExists(targetSidecarKey), `MinIO key missing: ${targetSidecarKey}`);
  const content = minioReadFile(targetSidecarKey);
  assert.ok(content.length > 0, `Sidecar in S3 is empty: ${targetSidecarKey}`);

  console.log(`  Copied sidecar from ${sourceId} → ${targetId} at ${targetSidecarKey} (${content.length} bytes).`);
  console.log('=== Phase: copy-asset-sidecar-s3 complete ===');
}

async function phaseUserDeleteS3Orphans(): Promise<void> {
  console.log('=== Phase: user-delete-s3-orphans ===');
  const adminToken = await loginAdmin();

  // Unique email per run so the phase is idempotent when re-run standalone against
  // a DB that already has a soft-deleted orphan-test user from a previous attempt.
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `orphan-test-${suffix}@example.com`;
  const password = 'orphanTest1234';

  const created = await api('POST', '/admin/users', {
    body: { email, password, name: 'Orphan Test User' },
    token: adminToken,
  });
  const userId: string = created.id;
  assert.ok(userId, 'Expected created user to have an id');

  const userToken = await loginUser(email, password);

  // Burn the createPng counter past any reuse overlap with other phases.
  for (let i = 0; i < 50; i++) {
    createPng();
  }

  // The template decides where an S3 upload ends up: with it off the first upload stays under upload/<userId>/,
  // with it on the second is moved to library/<userId>/ (the user has no storage label). Deletion must clean both.
  await setStorageTemplate(adminToken, { enabled: false }); // invariant reset
  try {
    const firstUpload = await uploadAsset(userToken, `orphan-${suffix}-1.png`, createPng());
    await waitForProcessing(adminToken);

    await setStorageTemplate(adminToken, { enabled: true, template: '{{y}}/{{MM}}/{{filename}}' });
    const secondUpload = await uploadAsset(userToken, `orphan-${suffix}-2.png`, createPng());
    assert.ok(firstUpload.id && secondUpload.id, 'Expected both uploads to return an id');
    await waitForProcessing(adminToken);
  } finally {
    await setStorageTemplate(adminToken, { enabled: false });
  }

  minioSetupAlias();

  const uploadPrefix = `upload/${userId}/`;
  const libraryPrefix = `library/${userId}/`;
  const profilePrefix = `profile/${userId}/`;
  const thumbsPrefix = `thumbs/${userId}/`;
  const encodedVideoPrefix = `encoded-video/${userId}/`;

  const preUpload = minioCountPrefix(uploadPrefix);
  const preLibrary = minioCountPrefix(libraryPrefix);
  const preThumbs = minioCountPrefix(thumbsPrefix);
  assert.ok(preUpload > 0, `Pre-delete: expected objects under ${uploadPrefix}, got ${preUpload}`);
  assert.ok(preLibrary > 0, `Pre-delete: expected objects under ${libraryPrefix}, got ${preLibrary}`);
  assert.ok(preThumbs > 0, `Pre-delete: expected objects under ${thumbsPrefix}, got ${preThumbs}`);
  console.log(
    `  Pre-delete: upload=${preUpload} library=${preLibrary} thumbs=${preThumbs} profile=${minioCountPrefix(
      profilePrefix,
    )} encoded-video=${minioCountPrefix(encodedVideoPrefix)}`,
  );

  await api('DELETE', `/admin/users/${userId}`, { body: { force: true }, token: adminToken });

  await waitForProcessing(adminToken);

  const postUpload = minioCountPrefix(uploadPrefix);
  const postLibrary = minioCountPrefix(libraryPrefix);
  const postProfile = minioCountPrefix(profilePrefix);
  const postThumbs = minioCountPrefix(thumbsPrefix);
  const postEncodedVideo = minioCountPrefix(encodedVideoPrefix);
  assert.equal(postUpload, 0, `Post-delete: ${uploadPrefix} should be empty, got ${postUpload}`);
  assert.equal(postLibrary, 0, `Post-delete: ${libraryPrefix} should be empty, got ${postLibrary}`);
  assert.equal(postProfile, 0, `Post-delete: ${profilePrefix} should be empty, got ${postProfile}`);
  assert.equal(postThumbs, 0, `Post-delete: ${thumbsPrefix} should be empty, got ${postThumbs}`);
  assert.equal(postEncodedVideo, 0, `Post-delete: ${encodedVideoPrefix} should be empty, got ${postEncodedVideo}`);

  console.log(`  User ${userId} deleted; all 5 S3 prefixes report 0 objects.`);
  console.log('=== Phase: user-delete-s3-orphans complete ===');
}

// ---------------------------------------------------------------------------
// Phase: video-trim-s3
//
// Covers gh#671. Trims a video on an S3-backed server and asserts every output
// (edited encoded video + edited thumbnails) is persisted to MinIO as a relative
// key, that the non-edited encoded object is not overwritten, and that nothing
// is left behind on the pod's local disk.
//
// Runs with the server in s3 write mode. Leaves suite state as it found it, so
// the later migrate-to-disk phase is unaffected.
// ---------------------------------------------------------------------------
async function phaseVideoTrimS3(): Promise<void> {
  console.log('=== Phase: video-trim-s3 ===');
  const token = await loginAdmin();

  // Force transcoding so a NON-edited EncodedVideo exists in S3. That object is
  // the trim job's preferred input, and it is what makes gh#671's defect 3
  // (an S3 key handed straight to ffmpeg) reachable.
  const originalConfig = await api('GET', '/system-config', { token });
  const trimConfig = structuredClone(originalConfig);
  trimConfig.ffmpeg.transcode = 'all';
  await api('PUT', '/system-config', { body: trimConfig, token });
  console.log('  ffmpeg.transcode = all');

  // Cleanup runs even when an assertion fails: a half-finished run must not leave
  // encoded-video rows behind for the later migrate-to-disk phase to trip over.
  let assetId: string | undefined;

  try {
    // 4s test video, tiny frame size. Must be >= 2s or the trim endpoint rejects it.
    //
    // -g 10 -keyint_min 10 -sc_threshold 0 puts a keyframe on every second (10fps).
    // MediaRepository.trim runs ffmpeg with `-c copy`, so its seek is keyframe-snapped:
    // with x264's default GOP a 4s clip has only the frame-0 keyframe, `-ss 1` would snap
    // back to 0, and the "2s" trim would come out 3.2s long. Real videos carry regular
    // keyframes; the fixture must too, or it tests a scenario that does not exist.
    const base64 = dockerExec(
      'immich-server',
      'ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=4:size=192x144:rate=10 ' +
        '-c:v libx264 -pix_fmt yuv420p -g 10 -keyint_min 10 -sc_threshold 0 /tmp/trim-src.mp4 ' +
        String.raw`&& base64 /tmp/trim-src.mp4 | tr -d "\n"`,
    );
    const video = Buffer.from(base64, 'base64');
    assert.ok(video.length > 1000, `Generated video looks too small: ${video.length} bytes`);
    console.log(`  Generated test video (${video.length} bytes)`);

    const uploaded = await uploadAsset(token, 'trim-s3.mp4', video);
    assetId = uploaded.id;
    console.log(`  Uploaded asset ${assetId}`);
    await waitForProcessing(token, 120_000);

    // Precondition 1: duration was probed; the trim endpoint rejects the trim without it.
    const assetRows = await queryDb<{ ownerId: string; duration: string | null; originalPath: string }>(
      'SELECT "ownerId", duration, "originalPath" FROM asset WHERE id = $1',
      [assetId],
    );
    assert.ok(assetRows[0], `Asset ${assetId} not found`);
    const { ownerId, originalPath } = assetRows[0];
    assert.ok(assetRows[0].duration, 'Asset duration was not probed, so the trim endpoint would reject it');
    assert.ok(!originalPath.startsWith('/'), `Expected S3 (relative) originalPath, got ${originalPath}`);

    // Precondition 2: a NON-edited EncodedVideo exists in S3.
    // NB: the asset_file.type enum value is 'encoded_video', not 'encodedVideo'.
    const encodedRows = await queryDb<{ path: string }>(
      `SELECT path FROM asset_file WHERE "assetId" = $1 AND type = 'encoded_video' AND "isEdited" = false`,
      [assetId],
    );
    assert.equal(encodedRows.length, 1, `Expected 1 non-edited encoded_video row, got ${encodedRows.length}`);
    const nonEditedKey = encodedRows[0].path;
    assert.ok(!nonEditedKey.startsWith('/'), `Expected relative encoded_video path, got ${nonEditedKey}`);
    assert.ok(minioFileExists(nonEditedKey), `Non-edited encoded video missing from MinIO: ${nonEditedKey}`);
    const nonEditedStatBefore = dockerExec('minio', `mc stat local/immich-test/${nonEditedKey}`);
    console.log(`  Precondition OK: transcoded video in S3 at ${nonEditedKey}`);

    // Act: trim 1s..3s out of the 4s video.
    await api('PUT', `/assets/${assetId}/trim`, { token, body: { startTime: 1, endTime: 3 } });
    console.log('  Trim submitted');
    await waitForProcessing(token, 120_000);

    const editedRows = await queryDb<{ path: string; type: string }>(
      `SELECT path, type FROM asset_file WHERE "assetId" = $1 AND "isEdited" = true ORDER BY type`,
      [assetId],
    );
    assert.ok(
      editedRows.length >= 3,
      `Expected >= 3 edited asset_file rows (video + preview + thumbnail), got ${editedRows.length}`,
    );

    for (const row of editedRows) {
      assert.ok(!row.path.startsWith('/'), `Edited ${row.type} path must be an S3 key, got ${row.path}`);
      assert.ok(minioFileExists(row.path), `Edited ${row.type} missing from MinIO: ${row.path}`);
    }

    const editedVideo = editedRows.find((r) => r.type === 'encoded_video');
    assert.ok(editedVideo, 'No edited encoded_video row');
    const expectedKey = `encoded-video/${ownerId}/${assetId.slice(0, 2)}/${assetId.slice(2, 4)}/${assetId}_edited.mp4`;
    assert.equal(editedVideo.path, expectedKey, 'Edited encoded video key mismatch');
    assert.notEqual(editedVideo.path, nonEditedKey, 'Edited video must not reuse the non-edited key');

    for (const row of editedRows) {
      if (row.type === 'encoded_video') {
        continue;
      }
      assert.ok(row.path.includes('_edited'), `Edited ${row.type} key must carry _edited: ${row.path}`);
    }

    // Collision guard: the transcoded original must be untouched.
    assert.ok(minioFileExists(nonEditedKey), 'Non-edited encoded video disappeared');
    const nonEditedStatAfter = dockerExec('minio', `mc stat local/immich-test/${nonEditedKey}`);
    assert.equal(nonEditedStatAfter, nonEditedStatBefore, 'Non-edited encoded video was overwritten by the trim');

    // No local leftovers: persistFile must upload AND unlink.
    const localEditedPath = `${MEDIA_LOCATION}/encoded-video/${ownerId}/${assetId.slice(0, 2)}/${assetId.slice(2, 4)}/${assetId}_edited.mp4`;
    assert.ok(!diskFileExists(localEditedPath), `Trimmed video left on local disk: ${localEditedPath}`);

    // Duration reflects the trim (~2s), not the original (4s). The trim is a `-c copy`
    // stream copy, so ffmpeg snaps to keyframes and the result is close to, not exactly,
    // the requested 2s — which is why handleVideoTrim re-probes the output instead of
    // trusting the requested duration. The window allows one keyframe interval of slack.
    const trimmedRows = await queryDb<{ duration: string | null }>(
      'SELECT duration FROM asset_video_trim WHERE "assetId" = $1',
      [assetId],
    );
    const durationMs = Number(trimmedRows[0].duration);
    assert.ok(
      durationMs >= 1500 && durationMs <= 2600,
      `Expected trimmed duration ~2000ms (keyframe-snapped), got ${trimmedRows[0].duration}`,
    );

    // Playback serves the trimmed video from S3.
    const playbackRes = await fetch(`${BASE_URL}/assets/${assetId}/video/playback`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(playbackRes.status, 200, `Expected 200 from playback, got ${playbackRes.status}`);
    await playbackRes.arrayBuffer();
    console.log('  Trim persisted to S3 and served');

    // Undo: the edited objects must be removed from the bucket.
    const editedKeys = editedRows.map((r) => r.path);
    await api('DELETE', `/assets/${assetId}/trim`, { token });
    await waitForProcessing(token, 120_000);

    for (const key of editedKeys) {
      assert.ok(!minioFileExists(key), `Undo left an edited object in MinIO: ${key}`);
    }

    const undoRes = await fetch(`${BASE_URL}/assets/${assetId}/video/playback`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(undoRes.status, 200, `Expected 200 from playback after undo, got ${undoRes.status}`);
    await undoRes.arrayBuffer();
    console.log('  Undo removed edited objects from S3');
  } finally {
    // Teardown: leave no trace for the later migrate-to-disk phase.
    if (assetId) {
      await api('DELETE', '/assets', { token, body: { ids: [assetId], force: true } });
      console.log(`  Asset ${assetId} deleted`);
    }
    await api('PUT', '/system-config', { body: originalConfig, token });
    console.log('  ffmpeg config restored');
  }

  console.log('=== Phase: video-trim-s3 complete ===');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const phase = process.argv[2];
  if (!phase) {
    throw new Error('Usage: storage-migration.ts <setup|migrate-to-s3|migrate-to-disk>');
  }

  try {
    await connectDb();

    switch (phase) {
      case 'setup': {
        await phaseSetup();
        break;
      }
      case 'estimate': {
        await phaseEstimate();
        break;
      }
      case 'migrate-to-s3': {
        await phaseMigrateToS3();
        break;
      }
      case 'migrate-to-disk': {
        await phaseMigrateToDisk();
        break;
      }
      case 'rollback': {
        await phaseRollback();
        break;
      }
      case 'no-files': {
        await phaseNoFiles();
        break;
      }
      case 'concurrent-rejection': {
        await phaseConcurrentRejection();
        break;
      }
      case 'selective-to-s3': {
        await phaseSelectiveToS3();
        break;
      }
      case 'selective-cleanup': {
        await phaseSelectiveCleanup();
        break;
      }
      case 'delete-source-false': {
        await phaseDeleteSourceFalse();
        break;
      }
      case 'content-verify': {
        await phaseContentVerify();
        break;
      }
      case 'sidecar-verify': {
        await phaseSidecarVerify();
        break;
      }
      case 'template-s3-bulk': {
        await phaseTemplateS3Bulk();
        break;
      }
      case 'template-s3-upload': {
        await phaseTemplateS3Upload();
        break;
      }
      case 'template-s3-live-photo': {
        await phaseTemplateS3LivePhoto();
        break;
      }
      case 'template-s3-sidecar': {
        await phaseTemplateS3Sidecar();
        break;
      }
      case 'template-s3-queue-migration': {
        await phaseTemplateS3QueueMigration();
        break;
      }
      case 'template-s3-manual-derivatives': {
        await phaseTemplateS3ManualDerivatives();
        break;
      }
      case 'template-s3-upgrade-prepare': {
        await phaseTemplateS3UpgradePrepare();
        break;
      }
      case 'template-s3-upgrade-pending': {
        await phaseTemplateS3UpgradePending();
        break;
      }
      case 'template-disk-baseline': {
        await phaseTemplateDiskBaseline();
        break;
      }
      case 'copy-asset-sidecar-s3': {
        await phaseCopyAssetSidecarS3();
        break;
      }
      case 'user-delete-s3-orphans': {
        await phaseUserDeleteS3Orphans();
        break;
      }
      case 'video-trim-s3': {
        await phaseVideoTrimS3();
        break;
      }
      default: {
        throw new Error(
          `Unknown phase: ${phase}. Valid phases: setup, estimate, migrate-to-s3, migrate-to-disk, rollback, no-files, concurrent-rejection, selective-to-s3, selective-cleanup, delete-source-false, content-verify, sidecar-verify, template-s3-bulk, template-s3-upload, template-s3-live-photo, template-s3-sidecar, template-s3-queue-migration, template-s3-manual-derivatives, template-s3-upgrade-prepare, template-s3-upgrade-pending, template-disk-baseline, copy-asset-sidecar-s3, user-delete-s3-orphans, video-trim-s3`,
        );
      }
    }
  } finally {
    await disconnectDb();
  }
}

void main();
