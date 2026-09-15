import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  collectDirectoryImportSpecifiers,
  mergeStatements,
  normalizeLineSpecifiers,
  normalizeModule,
  parseStatement,
  resolveConflictedSource,
  specifierKeys,
} from './import-merge';

const conflict = (ours: string, theirs: string) =>
  ['<<<<<<< HEAD', ours, '=======', theirs, '>>>>>>> upstream/main'].join('\n');

describe('normalizeModule', () => {
  it('appends .js to path-alias specifiers', () => {
    expect(normalizeModule('src/services/base.service')).toBe(
      'src/services/base.service.js',
    );
    expect(normalizeModule('test/utils')).toBe('test/utils.js');
    expect(normalizeModule('../schema/tables/person.table')).toBe(
      '../schema/tables/person.table.js',
    );
  });

  it('leaves bare package specifiers and already-suffixed paths alone', () => {
    expect(normalizeModule('node:fs')).toBe('node:fs');
    expect(normalizeModule('kysely')).toBe('kysely');
    expect(normalizeModule('lodash-es')).toBe('lodash-es');
    expect(normalizeModule('src/enum.js')).toBe('src/enum.js');
  });

  // Deliberate default, not a bug: with no directory knowledge, normalizeModule cannot tell
  // "src/schema" (a directory, needs /index.js) from "src/services/base.service" (a file, needs
  // .js) — it stays filesystem-free so a caller with no tree to scan gets a pure, deterministic
  // answer. Do not "fix" this by making the bare form directory-aware; give the caller a set instead.
  it('without knownDirectories, appends .js even to a directory specifier (the pure default)', () => {
    expect(normalizeModule('src/schema')).toBe('src/schema.js');
  });

  describe('with knownDirectories', () => {
    const dirs = new Set(['src/schema']);

    it('resolves a known directory specifier via its index', () => {
      expect(normalizeModule('src/schema', dirs)).toBe('src/schema/index.js');
    });

    it('still appends a plain .js to a real file specifier', () => {
      expect(normalizeModule('src/enum', dirs)).toBe('src/enum.js');
    });

    it('does not add /index.js to a directory with no index.ts, since no such module exists', () => {
      // src/utils is a real directory but carries no index.ts — the set built from the tree would
      // never include it, and even if a caller mistakenly did, only exact membership matters here.
      expect(normalizeModule('src/utils', dirs)).toBe('src/utils.js');
    });

    it('leaves already-suffixed and bare package specifiers unchanged', () => {
      expect(normalizeModule('src/enum.js', dirs)).toBe('src/enum.js');
      expect(normalizeModule('kysely', dirs)).toBe('kysely');
      expect(normalizeModule('node:fs', dirs)).toBe('node:fs');
    });
  });
});

describe('collectDirectoryImportSpecifiers', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverRoot = join(here, '../../../server');
  const e2eRoot = join(here, '../../../e2e');

  it('finds every server/src directory that resolves via an index.ts', () => {
    const dirs = collectDirectoryImportSpecifiers(serverRoot);
    expect(dirs.has('src/schema')).toBe(true);
    expect(dirs.has('src/repositories')).toBe(true);
    expect(dirs.has('src/services')).toBe(true);
  });

  it('excludes a real directory that has no index.ts', () => {
    const dirs = collectDirectoryImportSpecifiers(serverRoot);
    expect(dirs.has('src/utils')).toBe(false);
    expect(dirs.has('src/dtos')).toBe(false);
  });

  it('builds an independent, and in this tree empty, set for e2e — src/foo means a different directory there', () => {
    const dirs = collectDirectoryImportSpecifiers(e2eRoot);
    expect(dirs.has('src/schema')).toBe(false);
  });
});

describe('parseStatement', () => {
  it('parses named, default, namespace, type-only and side-effect forms', () => {
    expect(
      parseStatement("import { A, B as C } from 'src/enum';"),
    ).toMatchObject({
      kind: 'import',
      module: 'src/enum',
      typeOnly: false,
      named: ['A', 'B as C'],
    });
    expect(
      parseStatement("import type { JobOf } from 'src/types';"),
    ).toMatchObject({
      typeOnly: true,
      named: ['JobOf'],
    });
    expect(parseStatement("import * as fs from 'node:fs';")).toMatchObject({
      namespaceName: 'fs',
    });
    expect(parseStatement("import React from 'react';")).toMatchObject({
      defaultName: 'React',
    });
    expect(parseStatement("import 'reflect-metadata';")).toMatchObject({
      sideEffectOnly: true,
    });
  });

  it('refuses anything that is not an import/export-from statement', () => {
    expect(parseStatement('export const x = 1;')).toBeNull();
    expect(parseStatement('const y = 2;')).toBeNull();
  });
});

describe('mergeStatements', () => {
  it('unions named specifiers from the same module and normalizes the specifier', () => {
    const ours = [parseStatement("import { A } from 'src/enum';")!];
    const theirs = [parseStatement("import { B } from 'src/enum.js';")!];
    const merged = mergeStatements([ours, theirs])!;
    expect(merged).toHaveLength(1);
    expect(merged[0].module).toBe('src/enum.js');
    expect(merged[0].named).toEqual(['A', 'B']);
  });

  it('refuses when two sides disagree on a default binding', () => {
    const ours = [parseStatement("import A from 'src/x';")!];
    const theirs = [parseStatement("import B from 'src/x';")!];
    expect(mergeStatements([ours, theirs])).toBeNull();
  });
});

describe('resolveConflictedSource', () => {
  it('resolves an import-only region, preserving every specifier from both sides', () => {
    const source = [
      conflict(
        "import { AssetFileType } from 'src/enum';\nimport { BaseService } from 'src/services/base.service';",
        "import { AssetFileType, AssetStatus } from 'src/enum.js';\nimport { BaseService } from 'src/services/base.service.js';",
      ),
      '',
      'export class Foo {}',
    ].join('\n');

    const result = resolveConflictedSource(source);

    expect(result.refused).toBe(0);
    expect(result.resolved).toBe(1);
    expect(result.text).not.toContain('<<<<<<<');
    expect(result.text).toContain(
      "import { AssetFileType, AssetStatus } from 'src/enum.js';",
    );
    expect(result.text).toContain(
      "import { BaseService } from 'src/services/base.service.js';",
    );
    expect(result.text).toContain('export class Foo {}');
  });

  it('REFUSES a region containing non-import content and leaves it untouched', () => {
    const source = conflict(
      "import { A } from 'src/enum';\nconst forkOnly = 1;",
      "import { A } from 'src/enum.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.resolved).toBe(0);
    expect(result.refused).toBe(1);
    expect(result.text).toContain('<<<<<<<');
    expect(result.text).toContain('const forkOnly = 1;');
  });

  it('specifierKeys accounts for every binding on both sides', () => {
    const ours = [parseStatement("import { Kept } from 'src/enum';")!];
    const merged = mergeStatements([ours, []])!;
    expect(specifierKeys(merged).has('src/enum.js::Kept')).toBe(true);
  });

  it('handles diff3-style regions with a base section', () => {
    const source = [
      '<<<<<<< HEAD',
      "import { A } from 'src/enum';",
      '||||||| base',
      "import { A } from 'src/enum';",
      '=======',
      "import { A } from 'src/enum.js';",
      '>>>>>>> upstream/main',
    ].join('\n');
    const result = resolveConflictedSource(source);
    expect(result.refused).toBe(0);
    expect(result.text).toContain("import { A } from 'src/enum.js';");
  });

  // Verbatim from the spike tree: e2e/src/specs/maintenance/server/database-backups.e2e-spec.ts.
  // This is the shape that actually occurs — a fork-added binding on a bare package specifier,
  // a fork-only import of a module upstream never mentions, and two modules upstream re-suffixed.
  it('merges a real zdiff3 region without losing fork bindings', () => {
    const source = [
      '<<<<<<< HEAD',
      "import { LoginResponseDto, ManualJobName, login } from '@immich/sdk';",
      "import { loginDto } from 'src/fixtures';",
      "import { errorDto } from 'src/responses';",
      "import { app, utils } from 'src/utils';",
      '||||||| 86ae0dd06c7',
      "import { LoginResponseDto, ManualJobName } from '@immich/sdk';",
      "import { errorDto } from 'src/responses';",
      "import { app, utils } from 'src/utils';",
      '=======',
      "import { LoginResponseDto, ManualJobName } from '@immich/sdk';",
      "import { errorDto } from 'src/responses.js';",
      "import { app, utils } from 'src/utils.js';",
      '>>>>>>> upstream/main',
      "import request from 'supertest';",
    ].join('\n');

    const result = resolveConflictedSource(source);

    expect(result.refused).toBe(0);
    expect(result.resolved).toBe(1);
    // fork's added binding survives on the bare specifier, which is NOT suffixed
    expect(result.text).toContain(
      "import { LoginResponseDto, ManualJobName, login } from '@immich/sdk';",
    );
    // fork-only import upstream never had, now suffixed
    expect(result.text).toContain(
      "import { loginDto } from 'src/fixtures.js';",
    );
    // upstream's suffixing adopted on the shared modules
    expect(result.text).toContain(
      "import { errorDto } from 'src/responses.js';",
    );
    expect(result.text).toContain("import { app, utils } from 'src/utils.js';");
    // the shared tail zdiff3 left outside the region is untouched
    expect(result.text).toContain("import request from 'supertest';");
  });
});

describe('specifier-only fallback (zdiff3-truncated regions)', () => {
  it('resolves a truncated import tail that differs only by the .js suffix', () => {
    // The real shape found in the spike tree: zdiff3 hoisted the identical opening lines of a
    // multi-line named import out of the region, leaving only the closing `} from '...';` line,
    // which the structured path refuses because it does not start on a statement boundary.
    const source = conflict(
      "} from 'src/dtos/foo.dto';",
      "} from 'src/dtos/foo.dto.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.refused).toBe(0);
    expect(result.resolved).toBe(1);
    expect(result.text).toContain("} from 'src/dtos/foo.dto.js';");
    expect(result.text).not.toContain('<<<<<<<');
  });

  it('resolves a multi-line truncated region that differs only by specifier form', () => {
    const source = conflict(
      "} from 'src/foo';\nimport { X } from 'src/bar';",
      "} from 'src/foo.js';\nimport { X } from 'src/bar.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.refused).toBe(0);
    expect(result.resolved).toBe(1);
    expect(result.text).toContain("} from 'src/foo.js';");
    expect(result.text).toContain("import { X } from 'src/bar.js';");
  });

  it('REFUSES when one side has an added binding the other lacks (line count differs)', () => {
    const source = conflict(
      "} from 'src/foo';\n  Extra,\nimport { X } from 'src/bar';",
      "} from 'src/foo.js';\nimport { X } from 'src/bar.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.resolved).toBe(0);
    expect(result.refused).toBe(1);
    expect(result.text).toContain('<<<<<<<');
    expect(result.text).toContain('Extra,');
  });

  it('REFUSES when the other side has a trailing added binding ours lacks (theirs longer)', () => {
    // Mirror of the previous case, constructed so it actually exercises the length guard rather
    // than an incidental same-index mismatch: every overlapping line matches after normalizing,
    // and the extra line is APPENDED at the end of theirs. `resolveSpecifierOnlyRegion` compares
    // via `normalizedOurs.every(...)`, which is bounded by ours's own (shorter) length — without
    // the explicit `ours.length !== theirs.length` guard, `.every` would never even look at
    // theirs' trailing extra line, and this region would falsely resolve, silently dropping the
    // `Extra` import theirs added.
    const source = conflict(
      "} from 'src/foo';\nimport { X } from 'src/bar';",
      "} from 'src/foo.js';\nimport { X } from 'src/bar.js';\nimport { Extra } from 'src/baz.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.resolved).toBe(0);
    expect(result.refused).toBe(1);
    expect(result.text).toContain('<<<<<<<');
    expect(result.text).toContain('Extra');
  });

  it('REFUSES when the sides differ in a non-specifier way on the same line', () => {
    const source = conflict(
      "} from 'src/foo';\nimport { A as B } from 'src/bar';",
      "} from 'src/foo.js';\nimport { A as C } from 'src/bar.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.resolved).toBe(0);
    expect(result.refused).toBe(1);
    expect(result.text).toContain('<<<<<<<');
  });

  it('normalizeLineSpecifiers leaves a bare package specifier unchanged', () => {
    expect(normalizeLineSpecifiers("import x from 'kysely';")).toBe(
      "import x from 'kysely';",
    );
    expect(normalizeLineSpecifiers("} from 'kysely';")).toBe(
      "} from 'kysely';",
    );
  });
});

describe('parseStatement refuses statements squished onto one physical line', () => {
  it('refuses two full import statements matched as one (the reviewer-found case)', () => {
    expect(
      parseStatement(
        "import { A } from 'src/m'; import { Lost } from 'src/m';",
      ),
    ).toBeNull();
  });

  it('resolveConflictedSource refuses a region built from the squished-statement case', () => {
    const source = conflict(
      "import { A } from 'src/m'; import { Lost } from 'src/m';",
      "import { A } from 'src/m.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.resolved).toBe(0);
    expect(result.refused).toBe(1);
    expect(result.text).toContain('<<<<<<<');
    expect(result.text).not.toContain(
      "import { A } from 'src/m'; import { Lost, A } from 'src/m.js';",
    );
  });

  it('refuses an illegal named specifier that does not start with a letter', () => {
    expect(parseStatement("import { A, 3bad } from 'src/m';")).toBeNull();
  });

  it('still parses every legal form (does not over-reject)', () => {
    expect(parseStatement("import type { A } from 'src/m';")).toMatchObject({
      typeOnly: true,
      named: ['A'],
    });
    expect(
      parseStatement("import { type A, B as C } from 'src/m';"),
    ).toMatchObject({
      named: ['type A', 'B as C'],
    });
    expect(
      parseStatement("import { default as D } from 'src/m';"),
    ).toMatchObject({
      named: ['default as D'],
    });
    expect(parseStatement("import X, { Y } from 'src/m';")).toMatchObject({
      defaultName: 'X',
      named: ['Y'],
    });
    expect(parseStatement("import * as ns from 'node:fs';")).toMatchObject({
      namespaceName: 'ns',
    });
    expect(parseStatement("import 'reflect-metadata';")).toMatchObject({
      sideEffectOnly: true,
    });
    expect(
      parseStatement("import {\n  A,\n  B,\n} from 'src/m';"),
    ).toMatchObject({
      named: ['A', 'B'],
    });
  });
});
