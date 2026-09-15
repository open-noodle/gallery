import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type ImportKind = 'import' | 'export';

export interface ParsedStatement {
  kind: ImportKind;
  module: string;
  typeOnly: boolean;
  defaultName?: string;
  namespaceName?: string;
  named: string[];
  sideEffectOnly: boolean;
}

const ALIAS_OR_RELATIVE = /^(src\/|test\/|\.\.?\/)/;
const HAS_EXTENSION = /\.(js|json|css|svg|html)$/;
const STATEMENT_START = /^(import|export)\b/;
const FROM_FORM =
  /^(?<kind>import|export)\s+(?<body>[\s\S]*?)\s*from\s*['"](?<module>[^'"]+)['"]\s*;?$/;
const BARE_FORM = /^import\s*['"](?<module>[^'"]+)['"]\s*;?$/;
/** A legal `{ … }` binding: optional `type`, an identifier or `default`, optional `as <ident>`. */
const NAMED_SPECIFIER =
  /^(?:type\s+)?(?:[A-Za-z_$][\w$]*|default)(?:\s+as\s+[A-Za-z_$][\w$]*)?$/;

/**
 * Alias/relative specifiers (bare, no extension — e.g. "src/schema", "test/foo") that resolve to a
 * directory via an `index.ts` rather than a same-named `.ts` file. Exact-string keyed because the
 * directory set is small and known ahead of time; callers with filesystem access build one with
 * `collectDirectoryImportSpecifiers` below. Relative specifiers ("./foo") are never included here —
 * their meaning depends on the importing file's own directory, which this exact-string set cannot
 * express, and no relative directory import exists in the tree today (grepped for
 * `from '../…/index.js'` — zero hits), so the gap is real but currently empty.
 */
export type KnownDirectoryImports = ReadonlySet<string>;

/**
 * Pure by design: no filesystem access, so a caller with no tree to scan (a unit test, a fixture, a
 * one-off string) gets a deterministic answer. Without `knownDirectories` this appends `.js`
 * unconditionally, which is WRONG for a bare directory import (`src/schema` needs
 * `src/schema/index.js`, since `src/schema.ts` does not exist) — that is the documented, deliberate
 * default, not a bug to "simplify" away. A caller that can enumerate the tree's directories should
 * build a set with `collectDirectoryImportSpecifiers` and pass it in.
 */
export function normalizeModule(
  module: string,
  knownDirectories?: KnownDirectoryImports,
): string {
  if (!ALIAS_OR_RELATIVE.test(module)) return module;
  if (HAS_EXTENSION.test(module)) return module;
  if (knownDirectories?.has(module)) return `${module}/index.js`;
  return `${module}.js`;
}

/**
 * Builds a `KnownDirectoryImports` set for one package root (e.g. `server/`, `e2e/`) by walking its
 * `src/` and `test/` trees for directories containing an `index.ts`. The alias `src/foo` means a
 * different filesystem directory in each package, so build one set per package root and never share
 * one across `server` and `e2e` — a caller resolving a conflicted file must pick the set matching
 * that file's own package root (see rebase-resolve-loop.sh, which dispatches on the `server/`
 * vs `e2e/` path prefix before calling the resolver).
 */
export function collectDirectoryImportSpecifiers(
  packageRoot: string,
): Set<string> {
  const specifiers = new Set<string>();

  const walk = (dir: string, aliasPath: string): void => {
    if (existsSync(join(dir, 'index.ts'))) {
      specifiers.add(aliasPath);
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${aliasPath}/${entry.name}`);
      }
    }
  };

  for (const prefix of ['src', 'test']) {
    const base = join(packageRoot, prefix);
    if (existsSync(base)) walk(base, prefix);
  }

  return specifiers;
}

/** Splits a block into whole statements. Returns null if the block holds anything else. */
export function splitStatements(lines: string[]): string[] | null {
  const statements: string[] = [];
  let current: string[] = [];
  let depth = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (current.length === 0) {
      if (
        line === '' ||
        line.startsWith('//') ||
        line.startsWith('/*') ||
        line.startsWith('*')
      ) {
        continue;
      }
      if (!STATEMENT_START.test(line)) return null;
    }
    current.push(raw);
    depth += (raw.match(/\{/g) ?? []).length - (raw.match(/\}/g) ?? []).length;
    if (depth === 0 && line.endsWith(';')) {
      statements.push(current.join('\n'));
      current = [];
    }
  }

  return current.length === 0 ? statements : null;
}

export function parseStatement(text: string): ParsedStatement | null {
  const flat = text.trim();

  const bare = BARE_FORM.exec(flat);
  if (bare?.groups) {
    return {
      kind: 'import',
      module: bare.groups.module,
      typeOnly: false,
      named: [],
      sideEffectOnly: true,
    };
  }

  const match = FROM_FORM.exec(flat);
  if (!match?.groups) return null;

  const kind = match.groups.kind as ImportKind;
  const module = match.groups.module;
  let body = match.groups.body.trim();
  // A single import's body can never contain a statement terminator. If it does, the lazy
  // FROM_FORM regex backtracked past an embedded `;` to find a later `from '...'` — i.e. two (or
  // more) statements were squished onto one physical line and matched as one. Refuse rather than
  // silently absorb the extra statement's tail into this one's specifier list.
  if (body.includes(';')) return null;
  let typeOnly = false;
  if (/^type\b/.test(body)) {
    typeOnly = true;
    body = body.slice(4).trim();
  }

  let defaultName: string | undefined;
  let namespaceName: string | undefined;
  const named: string[] = [];

  const braceStart = body.indexOf('{');
  const head = (braceStart === -1 ? body : body.slice(0, braceStart))
    .replace(/,\s*$/, '')
    .trim();
  if (head.length > 0) {
    const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(head);
    if (namespace) {
      namespaceName = namespace[1];
    } else if (/^[A-Za-z_$][\w$]*$/.test(head)) {
      defaultName = head;
    } else {
      return null;
    }
  }

  if (braceStart !== -1) {
    const braceEnd = body.lastIndexOf('}');
    if (braceEnd < braceStart) return null;
    for (const piece of body.slice(braceStart + 1, braceEnd).split(',')) {
      const specifier = piece.trim().replace(/\s+/g, ' ');
      if (specifier.length === 0) continue;
      if (!NAMED_SPECIFIER.test(specifier)) return null;
      named.push(specifier);
    }
  }

  return {
    kind,
    module,
    typeOnly,
    defaultName,
    namespaceName,
    named,
    sideEffectOnly: false,
  };
}

export function mergeStatements(
  sides: ParsedStatement[][],
  knownDirectories?: KnownDirectoryImports,
): ParsedStatement[] | null {
  const byKey = new Map<string, ParsedStatement>();
  const order: string[] = [];

  for (const side of sides) {
    for (const statement of side) {
      const module = normalizeModule(statement.module, knownDirectories);
      const key = `${statement.kind}|${module}|${statement.typeOnly}|${statement.sideEffectOnly}`;
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, { ...statement, module, named: [...statement.named] });
        order.push(key);
        continue;
      }

      if (
        statement.defaultName &&
        existing.defaultName &&
        statement.defaultName !== existing.defaultName
      ) {
        return null;
      }
      if (
        statement.namespaceName &&
        existing.namespaceName &&
        statement.namespaceName !== existing.namespaceName
      ) {
        return null;
      }
      existing.defaultName ??= statement.defaultName;
      existing.namespaceName ??= statement.namespaceName;
      for (const specifier of statement.named) {
        if (!existing.named.includes(specifier)) existing.named.push(specifier);
      }
    }
  }

  return order.map((key) => byKey.get(key)!);
}

export function renderStatement(statement: ParsedStatement): string {
  if (statement.sideEffectOnly) return `import '${statement.module}';`;

  const clauses: string[] = [];
  if (statement.defaultName) clauses.push(statement.defaultName);
  if (statement.namespaceName) clauses.push(`* as ${statement.namespaceName}`);
  if (statement.named.length > 0)
    clauses.push(`{ ${statement.named.join(', ')} }`);

  const prefix = statement.typeOnly ? `${statement.kind} type` : statement.kind;
  return `${prefix} ${clauses.join(', ')} from '${statement.module}';`;
}

/** Every (module, binding) pair a statement list contributes. The loss detector. */
export function specifierKeys(
  statements: ParsedStatement[],
  knownDirectories?: KnownDirectoryImports,
): Set<string> {
  const keys = new Set<string>();
  for (const statement of statements) {
    const module = normalizeModule(statement.module, knownDirectories);
    if (statement.sideEffectOnly) {
      keys.add(`${module}::<side-effect>`);
      continue;
    }
    if (statement.defaultName)
      keys.add(`${module}::default ${statement.defaultName}`);
    if (statement.namespaceName)
      keys.add(`${module}::* ${statement.namespaceName}`);
    for (const specifier of statement.named)
      keys.add(`${module}::${specifier}`);
  }
  return keys;
}

interface Region {
  start: number;
  end: number;
  ours: string[];
  theirs: string[];
}

function findRegions(lines: string[]): Region[] {
  const regions: Region[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].startsWith('<<<<<<<')) {
      index += 1;
      continue;
    }
    const start = index;
    const ours: string[] = [];
    const theirs: string[] = [];
    let target = ours;
    let inBase = false;
    index += 1;

    while (index < lines.length && !lines[index].startsWith('>>>>>>>')) {
      const line = lines[index];
      if (line.startsWith('|||||||')) {
        inBase = true;
      } else if (line.startsWith('=======')) {
        inBase = false;
        target = theirs;
      } else if (!inBase) {
        target.push(line);
      }
      index += 1;
    }

    if (index < lines.length) regions.push({ start, end: index, ours, theirs });
    index += 1;
  }

  return regions;
}

/** Tries the structured statement-level merge. Returns rendered lines, or null to refuse. */
function resolveRegionStructured(
  ours: string[],
  theirs: string[],
  knownDirectories?: KnownDirectoryImports,
): string[] | null {
  const ourStatements = splitStatements(ours);
  const theirStatements = splitStatements(theirs);
  if (!ourStatements || !theirStatements) {
    return null;
  }

  const ourParsed = ourStatements.map((s) => parseStatement(s));
  const theirParsed = theirStatements.map((s) => parseStatement(s));
  if (ourParsed.includes(null) || theirParsed.includes(null)) {
    return null;
  }

  const ourSide = ourParsed as ParsedStatement[];
  const theirSide = theirParsed as ParsedStatement[];
  const merged = mergeStatements([ourSide, theirSide], knownDirectories);
  if (!merged) {
    return null;
  }

  // Post-condition: nothing either side contributed may be missing.
  const expected = new Set([
    ...specifierKeys(ourSide, knownDirectories),
    ...specifierKeys(theirSide, knownDirectories),
  ]);
  const actual = specifierKeys(merged, knownDirectories);
  if ([...expected].some((key) => !actual.has(key))) {
    return null;
  }

  return merged.map((s) => renderStatement(s));
}

/**
 * Per-line specifier normalizer for the fallback path below. Rewrites only the quoted module
 * string following `import '...'` or `... from '...'` — never touches bindings, so it cannot
 * paper over a real difference in what a line imports.
 */
const SPECIFIER = /(\bfrom\s*|^\s*import\s*)(['"])([^'"]+)\2/g;

export function normalizeLineSpecifiers(
  line: string,
  knownDirectories?: KnownDirectoryImports,
): string {
  return line.replace(
    SPECIFIER,
    (_m, head: string, q: string, mod: string) =>
      `${head}${q}${normalizeModule(mod, knownDirectories)}${q}`,
  );
}

/**
 * Fallback for regions the structured path refuses because they don't start on a statement
 * boundary (zdiff3 hoisted a shared multi-line import's opening lines out of the region, leaving
 * only a trailing fragment like `} from '...';`). Safe because it never reads outside the region:
 * if both sides become byte-identical after normalizing only the quoted module specifiers on each
 * line, they differed *only* in specifier form, so nothing can be lost — the same guarantee the
 * structured path's post-condition checks explicitly.
 */
function resolveSpecifierOnlyRegion(
  ours: string[],
  theirs: string[],
  knownDirectories?: KnownDirectoryImports,
): string[] | null {
  if (ours.length !== theirs.length) return null;
  const normalizedOurs = ours.map((line) =>
    normalizeLineSpecifiers(line, knownDirectories),
  );
  const normalizedTheirs = theirs.map((line) =>
    normalizeLineSpecifiers(line, knownDirectories),
  );
  return normalizedOurs.every((line, i) => line === normalizedTheirs[i])
    ? normalizedOurs
    : null;
}

export function resolveConflictedSource(
  text: string,
  knownDirectories?: KnownDirectoryImports,
): {
  text: string;
  resolved: number;
  refused: number;
} {
  const lines = text.split('\n');
  const regions = findRegions(lines);
  const replacements = new Map<number, { end: number; lines: string[] }>();
  let resolved = 0;
  let refused = 0;

  for (const region of regions) {
    const structured = resolveRegionStructured(
      region.ours,
      region.theirs,
      knownDirectories,
    );
    const rendered =
      structured ??
      resolveSpecifierOnlyRegion(region.ours, region.theirs, knownDirectories);

    if (!rendered) {
      refused += 1;
      continue;
    }

    replacements.set(region.start, { end: region.end, lines: rendered });
    resolved += 1;
  }

  const out: string[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const replacement = replacements.get(cursor);
    if (replacement) {
      out.push(...replacement.lines);
      cursor = replacement.end + 1;
      continue;
    }
    out.push(lines[cursor]);
    cursor += 1;
  }

  return { text: out.join('\n'), resolved, refused };
}
