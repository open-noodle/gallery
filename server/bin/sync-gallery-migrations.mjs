import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultServerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compiledSuffixes = ['.js', '.js.map', '.d.ts'];

// `nest build` never empties dist/, so the compiled migration folders keep files whose source is gone:
// Gallery migrations copied into dist/schema/migrations by builds before the ledger split, the old
// compatibility aliases, renamed or deleted migrations. A migrator runs (or demands) every compiled
// file it finds, so delete each one that has no source next to it in src/.
export function syncGalleryMigrations({ logger = console, serverRoot = defaultServerRoot } = {}) {
  let removed = 0;
  for (const folder of ['migrations', 'migrations-gallery']) {
    const srcMigrations = path.join(serverRoot, 'src/schema', folder);
    const distMigrations = path.join(serverRoot, 'dist/schema', folder);
    if (!existsSync(distMigrations)) {
      continue;
    }

    for (const file of readdirSync(distMigrations)) {
      const suffix = compiledSuffixes.find((candidate) => file.endsWith(candidate));
      if (!suffix || existsSync(path.join(srcMigrations, `${file.slice(0, -suffix.length)}.ts`))) {
        continue;
      }

      rmSync(path.join(distMigrations, file), { force: true });
      if (suffix === '.js') {
        removed += 1;
      }
    }
  }

  if (removed > 0) {
    logger.log(`Removed ${removed} compiled migrations without a source from dist/schema.`);
  }

  return { removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncGalleryMigrations();
}
