import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultServerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compatibilityAliases = [
  {
    from: '1777667825574-ChangeDurationToInteger',
    to: '1776735180298-ChangeDurationToInteger',
  },
];

function migrationNames(folder, extension) {
  if (!existsSync(folder)) {
    return new Set();
  }

  return new Set(
    readdirSync(folder)
      .filter((file) => file.endsWith(extension))
      .map((file) => file.slice(0, -extension.length)),
  );
}

function migrationSuffix(migrationName) {
  return migrationName.replace(/^\d+-/, '');
}

function removeStaleCopiedGalleryMigrations({ distGalleryMigrations, distMigrations, srcMigrations }) {
  if (!existsSync(distMigrations)) {
    return 0;
  }

  const sourceMigrationNames = migrationNames(srcMigrations, '.ts');
  const galleryMigrationNames = migrationNames(distGalleryMigrations, '.js');
  const galleryMigrationSuffixes = new Set([...galleryMigrationNames].map(migrationSuffix));
  let removed = 0;

  for (const file of readdirSync(distMigrations)) {
    if (!file.endsWith('.js')) {
      continue;
    }

    const migrationName = file.slice(0, -'.js'.length);
    if (sourceMigrationNames.has(migrationName)) {
      continue;
    }

    if (galleryMigrationNames.has(migrationName)) {
      continue;
    }

    if (!galleryMigrationSuffixes.has(migrationSuffix(migrationName))) {
      continue;
    }

    rmSync(path.join(distMigrations, file), { force: true });
    rmSync(path.join(distMigrations, `${file}.map`), { force: true });
    rmSync(path.join(distMigrations, `${migrationName}.d.ts`), { force: true });
    removed += 1;
  }

  return removed;
}

function copyGalleryMigrations({ distGalleryMigrations, distMigrations }) {
  if (!existsSync(distGalleryMigrations)) {
    return 0;
  }

  mkdirSync(distMigrations, { recursive: true });
  let copied = 0;

  for (const file of readdirSync(distGalleryMigrations)) {
    if (!file.endsWith('.js')) {
      continue;
    }

    copyFileSync(path.join(distGalleryMigrations, file), path.join(distMigrations, file));
    copied += 1;
  }

  return copied;
}

function copyIfExists(source, target) {
  if (!existsSync(source)) {
    return;
  }

  copyFileSync(source, target);
}

function syncCompatibilityAliases({ distMigrations }) {
  if (!existsSync(distMigrations)) {
    return 0;
  }

  let aliased = 0;

  for (const { from, to } of compatibilityAliases) {
    const source = path.join(distMigrations, `${from}.js`);
    if (!existsSync(source)) {
      continue;
    }

    copyFileSync(source, path.join(distMigrations, `${to}.js`));
    copyIfExists(path.join(distMigrations, `${from}.js.map`), path.join(distMigrations, `${to}.js.map`));
    copyIfExists(path.join(distMigrations, `${from}.d.ts`), path.join(distMigrations, `${to}.d.ts`));
    aliased += 1;
  }

  return aliased;
}

export function syncGalleryMigrations({ logger = console, serverRoot = defaultServerRoot } = {}) {
  const paths = {
    srcMigrations: path.join(serverRoot, 'src/schema/migrations'),
    distMigrations: path.join(serverRoot, 'dist/schema/migrations'),
    distGalleryMigrations: path.join(serverRoot, 'dist/schema/migrations-gallery'),
  };

  const removed = removeStaleCopiedGalleryMigrations(paths);
  const copied = copyGalleryMigrations(paths);
  const aliased = syncCompatibilityAliases(paths);

  if (removed > 0 || copied > 0 || aliased > 0) {
    logger.log(
      `Synced ${copied} Gallery migrations into dist/schema/migrations; removed ${removed} stale files; wrote ${aliased} compatibility aliases.`,
    );
  }

  return { aliased, copied, removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncGalleryMigrations();
}
