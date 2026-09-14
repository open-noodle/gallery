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

export function normalizeModule(module: string): string {
  if (!ALIAS_OR_RELATIVE.test(module)) return module;
  if (HAS_EXTENSION.test(module)) return module;
  return `${module}.js`;
}

/** Splits a block into whole statements. Returns null if the block holds anything else. */
export function splitStatements(lines: string[]): string[] | null {
  const statements: string[] = [];
  let current: string[] = [];
  let depth = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (current.length === 0) {
      if (line === '' || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
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
  let typeOnly = false;
  if (/^type\b/.test(body)) {
    typeOnly = true;
    body = body.slice(4).trim();
  }

  let defaultName: string | undefined;
  let namespaceName: string | undefined;
  const named: string[] = [];

  const braceStart = body.indexOf('{');
  const head = (braceStart === -1 ? body : body.slice(0, braceStart)).replace(/,\s*$/, '').trim();
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
      if (specifier.length > 0) named.push(specifier);
    }
  }

  return { kind, module, typeOnly, defaultName, namespaceName, named, sideEffectOnly: false };
}

export function mergeStatements(sides: ParsedStatement[][]): ParsedStatement[] | null {
  const byKey = new Map<string, ParsedStatement>();
  const order: string[] = [];

  for (const side of sides) {
    for (const statement of side) {
      const module = normalizeModule(statement.module);
      const key = `${statement.kind}|${module}|${statement.typeOnly}|${statement.sideEffectOnly}`;
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, { ...statement, module, named: [...statement.named] });
        order.push(key);
        continue;
      }

      if (statement.defaultName && existing.defaultName && statement.defaultName !== existing.defaultName) {
        return null;
      }
      if (statement.namespaceName && existing.namespaceName && statement.namespaceName !== existing.namespaceName) {
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
  if (statement.named.length > 0) clauses.push(`{ ${statement.named.join(', ')} }`);

  const prefix = statement.typeOnly ? `${statement.kind} type` : statement.kind;
  return `${prefix} ${clauses.join(', ')} from '${statement.module}';`;
}

/** Every (module, binding) pair a statement list contributes. The loss detector. */
export function specifierKeys(statements: ParsedStatement[]): Set<string> {
  const keys = new Set<string>();
  for (const statement of statements) {
    const module = normalizeModule(statement.module);
    if (statement.sideEffectOnly) {
      keys.add(`${module}::<side-effect>`);
      continue;
    }
    if (statement.defaultName) keys.add(`${module}::default ${statement.defaultName}`);
    if (statement.namespaceName) keys.add(`${module}::* ${statement.namespaceName}`);
    for (const specifier of statement.named) keys.add(`${module}::${specifier}`);
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

export function resolveConflictedSource(text: string): {
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
    const ourStatements = splitStatements(region.ours);
    const theirStatements = splitStatements(region.theirs);
    if (!ourStatements || !theirStatements) {
      refused += 1;
      continue;
    }

    const ourParsed = ourStatements.map((s) => parseStatement(s));
    const theirParsed = theirStatements.map((s) => parseStatement(s));
    if (ourParsed.includes(null) || theirParsed.includes(null)) {
      refused += 1;
      continue;
    }

    const ours = ourParsed as ParsedStatement[];
    const theirs = theirParsed as ParsedStatement[];
    const merged = mergeStatements([ours, theirs]);
    if (!merged) {
      refused += 1;
      continue;
    }

    // Post-condition: nothing either side contributed may be missing.
    const expected = new Set([...specifierKeys(ours), ...specifierKeys(theirs)]);
    const actual = specifierKeys(merged);
    if ([...expected].some((key) => !actual.has(key))) {
      refused += 1;
      continue;
    }

    replacements.set(region.start, { end: region.end, lines: merged.map((s) => renderStatement(s)) });
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
