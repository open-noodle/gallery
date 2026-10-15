// Static guard for asset."isFavorite" (#763). The column is the OWNER's favorite, kept in step with the
// `asset_favorite` overlay by the triggers in src/schema/functions.ts. Gallery code never writes the column;
// upstream's owner-only write paths do (listed below), and the reverse trigger mirrors them into the owner's
// overlay row. Raw reads are allowed only where the query is pinned to the owner it projects for (listed
// below). Everything else resolves the caller's own favorite with favoriteExistsFor. A bare `isFavorite` string is not matched: it is indistinguishable from the many
// other `isFavorite` names (DTO fields, person.isFavorite, `.as('isFavorite')` aliases).
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SERVER_ROOT = process.cwd();
const SRC_DIR = join(SERVER_ROOT, 'src');

// Table-qualified references, plus a bare `isFavorite` used as a Kysely where key (only `asset` has that column
// among the tables those builders select from).
const RAW_COLUMN_PATTERNS = [
  /'asset\.isFavorite'/g,
  /"asset\.isFavorite"/g,
  /asset\."isFavorite"/g,
  /\bwhere(?:Ref)?\(\s*'isFavorite'/g,
];

// file -> how many raw references it may hold, and why each is owner-scoped.
const OWNER_SCOPED_READS: Record<string, { count: number; reason: string }> = {
  'src/database.ts': {
    count: 3,
    reason:
      'columns.syncAsset (AssetSync streams only ownerId = the syncing user) and columns.workflowAssetV1 (listed twice, as upstream; workflow jobs act as the owner)',
  },
  'src/repositories/asset.repository.ts': {
    count: 1,
    reason:
      'getStatistics, upstream text: filters ownerId = the caller, so the owner projection is the caller favorite',
  },
  'src/schema/functions.ts': { count: 2, reason: 'the forward projection trigger bodies' },
  'src/utils/database.ts': {
    count: 1,
    reason:
      "search V3's upstream default when AssetSearchScope.favoriteUserId is unset; Gallery always sets it for users and rejects a favourite filter from a shared link",
  },
  'src/utils/favorite.ts': {
    count: 1,
    reason:
      "syncFavoriteFor, upstream's CASE for stock sync clients: the column only when asset.ownerId = the syncing user, false otherwise",
  },
};

// Upstream's own column writes, kept as upstream text because the writer is provably the asset's owner. Duplicate
// resolve's `assetUpdate.isFavorite` is the third: resolve requires the caller to own every keeper and trashed copy
// (AssetDelete), and PUT /assets refuses to join another owner's group. It is a property assignment, so the AST scan
// misses it and UPSTREAM_OWNER_ASSIGNMENTS lists it.
const UPSTREAM_OWNER_WRITES = [
  // upload: the uploader is the new asset's owner
  'src/services/asset-media.service.ts: isFavorite: dto.isFavorite',
  // copy: Permission.AssetCopy is owner-only on both assets, with no Gallery grant
  'src/services/asset.service.ts: isFavorite: sourceAsset.isFavorite',
];

const UPSTREAM_OWNER_ASSIGNMENTS = ['src/services/duplicate.service.ts'];

const collectTsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectTsFiles(full);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });

// Specs may seed the column like a stock server would; migrations keep their historical bodies.
const sources = collectTsFiles(SRC_DIR)
  .map((path) => ({ path: relative(SERVER_ROOT, path).replaceAll('\\', '/'), content: readFileSync(path, 'utf8') }))
  .filter(({ path }) => !path.endsWith('.spec.ts') && !/\/schema\/migrations[^/]*\//.test(path));

const withoutComments = (content: string) =>
  content
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');

const ASSET_WRITE_METHODS = new Set(['create', 'createAll', 'update', 'updateAll', 'upsert']);
const ASSET_REPOSITORY = /\bassetRepo(?:sitory)?$/i;
const KYSELY_ASSET_WRITE = /(updateTable|insertInto)\(\s*'asset'\s*\)/;
const IS_FAVORITE_ASSIGNMENT = /\.isFavorite\s*(?:\?\?|\|\||&&)?=[^=]/;

const keyName = (name: ts.PropertyName) => {
  if (ts.isComputedPropertyName(name)) {
    return ts.isStringLiteralLike(name.expression) ? name.expression.text : undefined;
  }
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
};

/**
 * `isFavorite` keys inside an asset write: an AssetRepository write or a Kysely asset INSERT/UPDATE (including an
 * INSERT's `onConflict` update), and Kysely's `.set('isFavorite', value)`. A pre-built object passed by reference
 * is not followed.
 */
const findColumnWrites = (path: string, content: string) => {
  const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const offenders: string[] = [];
  const report = (node: ts.Node) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    offenders.push(`${path}:${line + 1}: ${node.getText(file)}`);
  };
  const assetWriteMethod = (node: ts.Node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      return;
    }
    const method = node.expression.name.text;
    const receiver = node.expression.expression.getText(file);
    if (ASSET_WRITE_METHODS.has(method) && ASSET_REPOSITORY.test(receiver)) {
      return method;
    }
    return ['set', 'values', 'onConflict'].includes(method) && KYSELY_ASSET_WRITE.test(receiver) ? method : undefined;
  };
  const visit = (node: ts.Node, inWrite: boolean) => {
    const method = assetWriteMethod(node);
    if (method === 'set') {
      const [column] = (node as ts.CallExpression).arguments;
      if (column && ts.isStringLiteralLike(column) && column.text === 'isFavorite') {
        report(node);
      }
    }
    const write = inWrite || method !== undefined;
    if (
      write &&
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      keyName(node.name) === 'isFavorite'
    ) {
      report(node);
    }
    ts.forEachChild(node, (child) => visit(child, write));
  };
  visit(file, false);
  return offenders;
};

// Raw SQL statements that write the asset table (not asset_favorite or other asset_* tables).
const rawAssetWrites = (content: string) =>
  withoutComments(content)
    .split(';')
    .filter((statement) => /\b(?:update|insert\s+into)\s+"?asset(?:"|\s|\()/i.test(statement));

// Raw SQL statements that write the overlay table itself.
const rawOverlayWrites = (content: string) =>
  withoutComments(content)
    .split(';')
    .filter((statement) => /\b(?:insert\s+into|delete\s+from|update)\s+"?asset_favorite(?:"|\s|\()/i.test(statement));

describe('asset.isFavorite gate (#763)', () => {
  it('reads the raw column (table-qualified, or as a bare where key) only in the owner-scoped places listed here', () => {
    const counts: Record<string, number> = {};
    for (const { path, content } of sources) {
      const text = withoutComments(content);
      const count = RAW_COLUMN_PATTERNS.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);
      if (count > 0) {
        counts[path] = count;
      }
    }
    const allowed = Object.fromEntries(Object.entries(OWNER_SCOPED_READS).map(([path, { count }]) => [path, count]));
    expect(counts).toEqual(allowed);
  });

  it('writes the column only in the upstream owner-only paths listed here', () => {
    const writes = sources.flatMap(({ path, content }) => findColumnWrites(path, content));
    expect(writes.map((write) => write.replace(/:\d+:/, ':'))).toEqual(UPSTREAM_OWNER_WRITES);
    // Raw SQL: only the forward projection triggers write the column.
    const rawWriters = sources.filter(({ content }) =>
      rawAssetWrites(content).some((statement) => statement.includes('"isFavorite"')),
    );
    expect(rawWriters.map(({ path }) => path)).toEqual(['src/schema/functions.ts']);
    const assigners = sources.filter(({ content }) => IS_FAVORITE_ASSIGNMENT.test(withoutComments(content)));
    expect(assigners.map(({ path }) => path)).toEqual(UPSTREAM_OWNER_ASSIGNMENTS);
  });

  it('writes asset_favorite from trigger bodies only in the reverse projection trigger', () => {
    // The forward triggers fire at depth 0 only, so an overlay write from any other trigger would leave
    // asset."isFavorite" stale.
    const functions = sources.find(({ path }) => path === 'src/schema/functions.ts')!.content;
    const reverseBody = /name: 'asset_is_favorite_after_write'[\s\S]*?END`/.exec(functions)![0];
    expect(rawOverlayWrites(functions.replace(reverseBody, ''))).toEqual([]);
    expect(rawOverlayWrites(reverseBody)).toHaveLength(2);
  });

  it('maps responses from the caller-resolved favorite, never the owner projection', () => {
    const mapper = readFileSync(join(SRC_DIR, 'dtos/asset-response.dto.ts'), 'utf8');
    expect(withoutComments(mapper)).not.toMatch(/entity\.isFavorite\b(?!ForUser)/);
  });

  it('detects an isFavorite key passed to an asset write', () => {
    const sample = [
      `await this.assetRepository.updateAll(ids, { isFavorite: true });`,
      `await this.assetRepository.update({ id, isFavorite });`,
      `await db.updateTable('asset').set({ isFavorite: false }).execute();`,
      `await db.insertInto('asset').values({ ...asset, isFavorite: true }).execute();`,
      `await db.updateTable('asset').set('isFavorite', true).execute();`,
      `await this.assetRepo.update({ id, ['isFavorite']: true });`,
      `await db.insertInto('asset').values(row).onConflict((oc) => oc.column('id').doUpdateSet({ isFavorite: true }));`,
      `await this.assetRepository.updateAll(ids, { visibility });`,
      `await this.personRepository.update({ id, isFavorite: true });`,
      // Known miss: a pre-built object passed by reference.
      `const patch = { isFavorite: true }; await this.assetRepository.updateAll(ids, patch);`,
    ].join('\n');
    expect(findColumnWrites('sample.ts', sample)).toHaveLength(7);
    expect(rawAssetWrites(`UPDATE asset SET name = $1, "isFavorite" = $2`)).toHaveLength(1);
    expect(rawAssetWrites(`update "asset_favorite" set "userId" = $1`)).toEqual([]);
    const assignments = ['a.isFavorite = x', 'a.isFavorite ??= x', 'a.isFavorite ||= x', 'a.isFavorite &&= x'];
    expect(assignments.filter((line) => IS_FAVORITE_ASSIGNMENT.test(line))).toEqual(assignments);
    expect(
      ['a.isFavorite == x', 'a.isFavorite === x', 'a.isFavorite !== x'].some((line) =>
        IS_FAVORITE_ASSIGNMENT.test(line),
      ),
    ).toBe(false);
  });
});
