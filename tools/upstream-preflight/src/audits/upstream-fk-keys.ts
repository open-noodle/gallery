import fs from 'node:fs';
import path from 'node:path';
import { runGit } from '../git';
import type { AuditResult } from '../types';

// server/src/schema/gallery-upstream-fks.json: every fork foreign key onto an upstream key, grouped by that key.
export const upstreamFkRegistryPath =
  'server/src/schema/gallery-upstream-fks.json';

export type UpstreamKey = {
  table: string;
  columns: string[];
  forkForeignKeys: string[];
};

export type MigrationText = { path: string; text: string };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Statements are split on `;`, which is how upstream migrations write one statement per sql`` call.
const statementsOf = (text: string) => text.split(';');

function findKeyChanges(
  keyName: string,
  key: UpstreamKey,
  migration: MigrationText,
): string[] {
  const table = `"${escape(key.table)}"`;
  const reasons: string[] = [];
  if (
    new RegExp(
      `(DROP|RENAME)\\s+(CONSTRAINT|INDEX)\\s+(IF\\s+EXISTS\\s+)?"${escape(keyName)}"`,
      'i',
    ).test(migration.text)
  ) {
    reasons.push(`drops or renames ${keyName}`);
  }
  for (const statement of statementsOf(migration.text)) {
    if (
      new RegExp(`DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?${table}`, 'i').test(
        statement,
      )
    ) {
      reasons.push(`drops table ${key.table}`);
    }
    if (
      !new RegExp(
        `ALTER\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?(ONLY\\s+)?${table}`,
        'i',
      ).test(statement)
    ) {
      continue;
    }
    if (/\bRENAME\s+TO\b/i.test(statement)) {
      reasons.push(`renames table ${key.table}`);
    }
    for (const column of key.columns) {
      if (
        new RegExp(
          `(DROP|ALTER|RENAME)\\s+COLUMN\\s+(IF\\s+EXISTS\\s+)?"${escape(column)}"`,
          'i',
        ).test(statement)
      ) {
        reasons.push(`changes column ${key.table}.${column}`);
      }
    }
  }
  return [...new Set(reasons)];
}

/**
 * Flags incoming upstream migrations that drop or alter an upstream key the fork has foreign keys on. Such a
 * migration fails with 2BP01 on a Gallery database unless a fork migration drops the dependent FKs before it and
 * recreates them after (1787100000000-DropPersonFksBeforeClusterGroups is the worked example), so the pair has to be
 * planned when the batch is taken.
 */
export function analyzeUpstreamFkKeys(
  registry: Record<string, UpstreamKey>,
  migrations: MigrationText[],
): AuditResult {
  const details: string[] = [];
  for (const migration of migrations) {
    for (const [keyName, key] of Object.entries(registry)) {
      const reasons = findKeyChanges(keyName, key, migration);
      if (reasons.length === 0) continue;
      details.push(
        `${path.basename(migration.path)} ${reasons.join(', ')}; fork FKs depending on ${keyName}: ${key.forkForeignKeys.join(', ')}. Plan a pre/post fork migration pair around it.`,
      );
    }
  }
  return {
    ok: details.length === 0,
    title: 'Upstream migrations vs fork FKs on upstream keys',
    details,
  };
}

export function runUpstreamFkKeyAudit(
  upstreamRef: string,
  upstreamFiles: string[],
  cwd: string,
): AuditResult {
  const registryFile = path.join(cwd, upstreamFkRegistryPath);
  if (!fs.existsSync(registryFile)) {
    return {
      ok: false,
      title: 'Upstream migrations vs fork FKs on upstream keys',
      details: [`Missing ${upstreamFkRegistryPath}`],
    };
  }
  const { keys } = JSON.parse(fs.readFileSync(registryFile, 'utf8')) as {
    keys: Record<string, UpstreamKey>;
  };
  const migrations = upstreamFiles
    .filter((file) => /^server\/src\/schema\/migrations\/[^/]+\.ts$/.test(file))
    .flatMap((file) => {
      try {
        return [
          { path: file, text: runGit(cwd, ['show', `${upstreamRef}:${file}`]) },
        ];
      } catch {
        // deleted upstream in this range: nothing will run
        return [];
      }
    });
  return analyzeUpstreamFkKeys(keys, migrations);
}
